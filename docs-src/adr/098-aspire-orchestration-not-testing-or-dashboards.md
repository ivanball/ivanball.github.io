# ADR-098: Aspire for Orchestration, Not for Testing or Production Dashboards

## Status
Accepted (2026-08-28). Revised 2026-08-31: the sanctioned nightly AppHost smoke test is implemented,
and every citation below is re-verified against current source. Revised 2026-09-10: the bounded
exception is now a framework tier rather than a one-repo test. `Aspire.Hosting.Testing` is pinned in
three repos, both consumers own an AppHost smoke project, and each of them subclasses the shared
`AppHostFixtureBase` from `MMCA.Common.Testing.Aspire` (ADR-117) instead of calling
`DistributedApplicationTestingBuilder` directly, so the canonical implementation is Common's, not any
one app's; the ADC bicep and workflow anchors are re-pinned to their current lines. Records two
standing divergences from the default .NET Aspire path as
decisions rather than as gaps. Both parts describe what the four repos already do, with the single
bounded exception recorded in Decision 1, and the value of writing them down is that a reader (or a
new module author) stops treating each absence as an oversight to be closed.

## Context
Aspire is used on exactly two surfaces here.

**Orchestration.** Each app has an AppHost that composes the local stack from one file: ADC's
provisions a persistent SQL Server container, one database per service, Redis and the RabbitMQ
broker, then the four services, the Gateway and the Blazor UI
(`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:1-6`, SQL at `:15-16`, the four databases at
`:37-40`, Redis at `:44-45`, the broker selection at `:89-101`); `MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:1-14`
is the same shape over its three services. Service discovery and health-based startup ordering come from Aspire's resource
model rather than from hand-written wiring.

**Service defaults.** Every host calls `AddServiceDefaults`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:46`), which wires OpenTelemetry, the
default health checks, warm-up readiness (ADR-025), service discovery and the Polly HTTP defaults
(ADR-009), with `MapDefaultEndpoints` (`:411`) adding `/health` (`:413`), the live-only `/alive`
(`:417`) and the readiness probe `/health/ready` (`:433`) that ACA ingress holds traffic behind.

Aspire offers two further things this workspace does **not** adopt, and both read from the outside
like an unfinished adoption:

1. `DistributedApplicationTestingBuilder` (the `Aspire.Hosting.Testing` package), which boots the
   whole app model in a test process. No integration tier here uses it, and the only projects that
   reference it are the framework's own AppHost testing package and the two nightly AppHost
   composition smoke tests it exists for, the bounded exception Decision 1 sanctions. The package is
   pinned in three repos (`MMCA.Common/Directory.Packages.props:344`,
   `MMCA.ADC/Directory.Packages.props:91`, `MMCA.Store/Directory.Packages.props:107`) and referenced
   by three projects: `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/MMCA.Common.Testing.Aspire.csproj:20`,
   which owns the only `DistributedApplicationTestingBuilder.CreateAsync` call in the workspace
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/Fixtures/AppHostFixtureBase.Generic.cs:31`),
   plus the two consumer smoke
   projects that take the framework package instead
   (`MMCA.ADC/Tests/Integration/MMCA.ADC.AppHost.SmokeTests/MMCA.ADC.AppHost.SmokeTests.csproj:29`
   and `:33`, `MMCA.Store/Tests/Integration/MMCA.Store.AppHost.SmokeTests/MMCA.Store.AppHost.SmokeTests.csproj:30`
   and `:31`).
2. The Azure Container Apps Aspire dashboard, the hosted version of the local dashboard, for looking
   at a deployed environment. No ACA dashboard resource or property exists in ADC's infrastructure.

Neither the bounded use nor the outright absence is an accident, but until this record neither had a
written basis, which is exactly how an incidental gap and a deliberate choice become
indistinguishable.

## Decision

### 1. Integration testing stays `WebApplicationFactory` plus Testcontainers

The tiers that exist keep their shape, and `DistributedApplicationTestingBuilder` stays out of them.

- **Per-service tier: one in-process host, real SQL, mocked cross-service edges.** Seven fixtures
  subclass the framework's `SqlServerIntegrationTestFixtureBase<TEntryPoint>`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/SqlServerIntegrationTestFixtureBase.cs:27`): four
  in ADC (`Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestFixture.cs:22`,
  and the Conference / Engagement / Notification siblings at `:17` each) and three in Store
  (Catalog `:16`, Identity `:15`, Sales `:17`).
- **Cross-service tier: three real hosts, a real broker, real containers.** ADC's `CrossServiceFixture`
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceFixture.cs:33`)
  extends the shared `CrossServiceFixtureBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/CrossServiceFixtureBase.cs:41`) and runs against
  Testcontainers SQL Server and RabbitMQ
  (`MMCA.ADC.CrossService.IntegrationTests.csproj:24-25`), exercising the outbox to broker to
  consumer round-trip and a genuine Conference to Engagement gRPC read; Store has the equivalent
  (`MMCA.Store/Tests/Integration/MMCA.Store.CrossService.IntegrationTests/Infrastructure/CrossServiceFixture.cs:29`).
- **The deferral is already on the record and stays.** The rework plan that produced these tiers
  states it in one line: Aspire's testing builder is deferred to the Playwright E2E lane, as too
  heavy for the integration tier and overlapping E2E
  (`Website/docs-src/guides/adc-IntegrationTestReworkPlan.md:50-51`).

Two properties of the hosts make the choice load-bearing rather than a preference.

**Hosts snapshot their configuration at configure time.** Each host reads its connection string,
`MessageBus` provider and JWT settings from `builder.Configuration` **before** `builder.Build()`,
which is before a `WebApplicationFactory`'s `ConfigureAppConfiguration` deltas apply, so in-memory
config injected through the factory arrives too late and **process environment variables are the only
override channel these hosts honour** (`CrossServiceFixtureBase.cs:26-38`, the same contract stated on
the per-service base at `SqlServerIntegrationTestFixtureBase.cs:16-24`). The consequence is
concrete: the one genuinely per-host key is the connection string, so hosts must be booted strictly
sequentially with the environment mutated between boots (`CrossServiceFixtureBase.cs:32-38`). A
harness that owns the app model has to own that channel too, and the fixtures that already own it are
the ones being replaced.

**The AppHost is not a local test dependency.** `dotnet run` on the AppHost stalls in a
non-interactive shell on a developer box and has to be launched interactively
(`MMCA.ADC/CLAUDE.md:13`). In CI, where Docker is available, it does come up, and that is precisely
the E2E lane (`MMCA.ADC/.github/workflows/e2e.yml:3-5`). So an app-model integration tier would be a
CI-only tier duplicating the coverage of a CI-only tier that already exists, while removing the fast
loop the current fixtures give.

**One sanctioned exception is allowed, and it is bounded on purpose:** a nightly AppHost smoke tier
that brings the app model up and probes the composition, on the existing non-gating cross-service
nightly (`MMCA.ADC/.github/workflows/cross-service-tests.yml:25-31`, never in `deploy.needs` by
design at `:17-22`). Its job is to catch a broken AppHost composition without putting the app model
in the gating path.

ADR-117 turns that exception into a framework tier, which is what keeps it bounded. The boot, the
readiness budget and the opt-in gate live once in `MMCA.Common.Testing.Aspire`
(`AppHostFixtureBase.cs:38`, the generic subclass a consumer names its AppHost through at
`AppHostFixtureBase.Generic.cs:20`, the assertion base at `AppHostTestBase.cs:29`), so each app
declares a fixture and its contracts rather than an orchestration harness. Both consumers own one:
ADC's `AdcAppHostFixture.cs:28` with five test methods on `AdcAppHostSmokeTests.cs:32` (gateway
health, JWKS through the gateway, h2c prior knowledge on the three Http2-only services and on
notification's `grpc` endpoint, a resolved per-service connection string each), and Store's
`StoreAppHostFixture.cs:23` with five on `AppHostCompositionSmokeTests.cs:26`. Each project sits
outside every `.slnx` and `.slnf` and is restored, built and run by explicit path in an
`apphost-smoke` job that stays `continue-on-error` (ADC: `cross-service-tests.yml:204`, the flag at
`:209`, the three explicit-path steps at `:220`, `:263` and `:287`; Store: `:199`, the flag at
`:204`, the steps at `:215`, `:257` and `:276`). Both runs set the framework's `MMCA_APPHOST_TESTS`
opt-in (ADC `:285`, Store `:274`); without it the fixture never boots an orchestrator and every test
skips with that reason, which is what a developer machine gets.

What stays out is the scope, not the assertion count: an app-model tier that starts carrying
behavioural coverage the per-service and E2E tiers already own is a reversal of this record, not an
extension of it.

### 2. Production observability is workspace-based App Insights, not the ACA Aspire dashboard

- **The sink is workspace-based Application Insights**, backed by the existing Log Analytics
  workspace, with telemetry landing in the workspace tables under its PerGB2018 pricing and retention
  (`MMCA.ADC/infra/main.bicep:222-232`, the workspace binding at `:229`); hosts export to it through
  `UseAzureMonitor` whenever the injected connection string is present (`:219-221`, the injected
  `APPLICATIONINSIGHTS_CONNECTION_STRING` entry at `:237-240`).
- **The stream is deliberately thinned, and each cut is priced in the template.** Head-based trace
  sampling keeps 25% (`Telemetry__TracesSampleRatio` = `0.25`, `:246-249`); the OpenTelemetry logging
  provider ships `Warning` and above while Serilog still writes `Information` to container stdout
  (`:257-260`); the two highest-volume instrument groups (`http.client.*` gauges and the `dotnet.*`
  runtime instruments, measured at about 65% of AppMetrics ingestion, `:262-267`) are switched off
  (`:268-275`); and the metric export interval is stretched from the 60-second default to 300 seconds,
  cutting roughly 80% of the remaining datapoints while five-minute alert windows keep the same signal
  (`:283-286`).
- **What an operator actually reads is alerts and a workbook, not a live console.** SLO rules ship as
  code (`main.bicep:357`, `:448`, and the Gateway availability alert at `:643`, all wired to
  the unconditional action group at `:294-308`), and a saved Azure Monitor workbook visualizes the
  same SLOs per service (`:682`), which is the deployed-environment view (ADR-062, ADR-041).
- **The ACA Aspire dashboard is not provisioned**, and that is the decision rather than a to-do. It is
  ephemeral (no retention behind it), full fidelity (it would be looking at the very stream this
  template thins), and it has no alert or saved-query surface, so it cannot be the thing that pages
  anyone. It stays what it is here: the development-time console the AppHost opens.

## Rationale
- **Test at the boundary that ships.** A service is deployed as its own container app
  (`MMCA.ADC/infra/main.bicep:1461`, `:1686`, `:1828`, `:1959`), configured entirely through
  environment variables. `WebApplicationFactory` plus an environment-variable override channel is a
  closer model of that than an app model the deployment does not use: production topology comes from
  Bicep (`MMCA.ADC/.github/workflows/deploy.yml:1585`), not from the AppHost.
- **The cheapest tier that could have failed.** The per-service tier needs no Docker at all, because
  `AddBrokerMessaging` returns early on the default `InProcess` provider, which is what an absent
  `MessageBus` section resolves to
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:746`, the missing-section
  fallback at `:752-753` and the early return at `:755-758`, over the `InProcess` default on
  `Messaging/MessageBusSettings.cs:17`), and only the
  genuinely cross-process flows pay for containers, on a nightly rather than in the deploy chain
  (`cross-service-tests.yml:12-22`). Booting the whole app model to assert a validation error would
  invert that.
- **Two absences with one cause.** Both parts of this record decline an Aspire feature whose value is
  highest during development and lowest in the lane it would be added to: the testing builder
  duplicates the E2E lane, and the dashboard duplicates a workbook while undoing a cost decision.
- **Cost is the binding observability constraint at this size.** The thinning above is rubric section
  31 work with measured numbers attached, and a full-fidelity dashboard component is the one addition
  that would make those measurements moot.

## Trade-offs
- **Nothing below the E2E lane tests the AppHost's own wiring.** A bad reference or a missing
  environment injection in `Program.cs` is caught by the E2E gate or by a developer, and the E2E gate
  is ui-scoped and can legitimately skip (ADR-092 records the same property for the vitals budget).
  The nightly AppHost smoke tier exists precisely to close this, and being nightly and non-gating,
  it closes it a day late by design.
- **The environment-variable channel is global and order-sensitive.** Hosts must boot strictly
  sequentially and every pushed variable has to be restored on disposal
  (`SqlServerIntegrationTestFixtureBase.cs:17-24`, `CrossServiceFixtureBase.cs:32-38`), which is
  fragile in a way an in-memory configuration source would not be. It is the price of the hosts
  reading configuration at configure time, and it is paid in test infrastructure rather than in
  production code.
- **Sampling means a reported request may have no trace.** At 0.25, three of four traces are dropped
  at the head, so an operator investigating a specific user report will often find the request counted
  and not traced (`main.bicep:246-249`).
- **The `Warning` floor moves `Information` logs off the queryable path.** They exist in container
  stdout only (`:251-260`), so the correlation-id story (ADR-041) is complete only for what the floor
  admits.
- **A 300-second export interval delays metric-driven signal.** Alert rules use five-minute windows,
  so the design holds, but a metric change is not visible in near real time (`:277-286`).
- **Neither absence is enforced.** Nothing fails a build if a project adds `Aspire.Hosting.Testing` or
  a dashboard resource: unlike the pins of ADR-016 or the fitness rules of ADR-015, this record is a
  convention, and its only guard is review.
- **Store carries the same posture, and Decision 2's numbers are cited from ADC's template.** The
  knobs match: Store's own bicep sets the same `Telemetry__TracesSampleRatio` of `0.25`
  (`MMCA.Store/infra/main.bicep:204`), the same `Logging__OpenTelemetry__LogLevel__Default` floor
  (`:215`), the same two instrument toggles (`:226`, `:230`) and the same
  `OTEL_METRIC_EXPORT_INTERVAL` (`:241`). Only the resource inventory differs, because Store deploys three services rather than
  four, so a reader after an exact line should read Store's template rather than translate ADC's.

## Related
[ADR-041](041-observability-and-telemetry.md) (the shared Aspire OpenTelemetry baseline and the
sampling / metric-toggle knobs this record's production half configures),
[ADR-062](062-slo-alerting-as-code.md) (the alert rules and the workbook that are the deployed-environment
view instead of a dashboard),
[ADR-025](025-startup-warmup-readiness.md) (the readiness gate `AddServiceDefaults` wires, which is
what makes health-based startup ordering meaningful),
[ADR-008](008-service-extraction-topology.md) (the four extracted hosts these tiers and this
orchestration exist to run),
[ADR-006](006-database-per-service.md) (why the fixtures provision one throwaway database per service
rather than one for the app),
[ADR-030](030-startup-sole-migrator.md) (each host applying its own migrations at boot, which is what
lets a fixture start against an empty database),
[ADR-081](081-cost-baseline-deploy-gate.md) (the cost posture the telemetry thinning belongs to),
[ADR-092](092-web-vitals-budget-gate.md) (the E2E lane this record defers app-model coverage to, and
the record of that lane's skip behavior),
[ADR-117](117-apphost-integration-test-base.md) (the framework AppHost fixture base, opt-in gate and
readiness budget that turn this record's bounded exception into a shared tier both consumers take).
