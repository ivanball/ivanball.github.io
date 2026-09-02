# ADR-098: Aspire for Orchestration, Not for Testing or Production Dashboards

## Status
Accepted (2026-08-28). Revised 2026-08-31: the sanctioned nightly AppHost smoke test is implemented,
so `Aspire.Hosting.Testing` now ships in exactly one place, and every citation below is re-verified
against current source. Records two standing divergences from the default .NET Aspire path as
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
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:39`), which wires OpenTelemetry, the
default health checks, warm-up readiness (ADR-025), service discovery and the Polly HTTP defaults
(ADR-009), with `MapDefaultEndpoints` (`:328`) adding `/health` (`:330`), the live-only `/alive`
(`:334`) and the readiness probe `/health/ready` (`:350`) that ACA ingress holds traffic behind.

Aspire offers two further things this workspace does **not** adopt, and both read from the outside
like an unfinished adoption:

1. `DistributedApplicationTestingBuilder` (the `Aspire.Hosting.Testing` package), which boots the
   whole app model in a test process. No integration tier here uses it, and it appears in exactly one
   project across the four .NET repos: ADC's nightly AppHost composition smoke test, the bounded
   exception Decision 1 sanctions. The package is pinned at
   `MMCA.ADC/Directory.Packages.props:92`, referenced only by
   `MMCA.ADC/Tests/Integration/MMCA.ADC.AppHost.SmokeTests/MMCA.ADC.AppHost.SmokeTests.csproj:29`,
   and called in one place (`AppHostCompositionSmokeTests.cs:46`).
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
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/SqlServerIntegrationTestFixtureBase.cs:27`): four
  in ADC (`Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestFixture.cs:22`,
  and the Conference / Engagement / Notification siblings at `:17` each) and three in Store
  (Catalog `:16`, Identity `:15`, Sales `:17`).
- **Cross-service tier: three real hosts, a real broker, real containers.** ADC's `CrossServiceFixture`
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceFixture.cs:33`)
  extends the shared `CrossServiceFixtureBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/CrossServiceFixtureBase.cs:41`) and runs against
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

**One sanctioned exception is allowed, and it is small on purpose:** a nightly AppHost smoke test that
brings the app model up and asserts the Gateway's `/health`, on the existing non-gating cross-service
nightly (`MMCA.ADC/.github/workflows/cross-service-tests.yml:25-31`, never in `deploy.needs` by
design at `:17-22`). Its job is to catch a broken AppHost composition without putting the app model
in the gating path. It ships as a single `[Fact]` that boots the real AppHost through
`DistributedApplicationTestingBuilder` and polls the gateway until it answers 200
(`MMCA.ADC/Tests/Integration/MMCA.ADC.AppHost.SmokeTests/AppHostCompositionSmokeTests.cs:42-59`, the
builder call at `:46`), in a project that sits outside every `.slnx` and `.slnf` and is restored,
built and run by explicit path in the `apphost-smoke` job (`cross-service-tests.yml:199`, its
explicit-path restore, build and run steps at `:215-264`, with `continue-on-error: true` at `:204`
while its headless behavior on the CI runner is unproven).
Anything beyond that single boot-and-probe is a reversal of this record, not an extension of it.

### 2. Production observability is workspace-based App Insights, not the ACA Aspire dashboard

- **The sink is workspace-based Application Insights**, backed by the existing Log Analytics
  workspace, with telemetry landing in the workspace tables under its PerGB2018 pricing and retention
  (`MMCA.ADC/infra/main.bicep:194-204`, the workspace binding at `:201`); hosts export to it through
  `UseAzureMonitor` whenever the injected connection string is present (`:191-193`, the injected
  `APPLICATIONINSIGHTS_CONNECTION_STRING` entry at `:209-212`).
- **The stream is deliberately thinned, and each cut is priced in the template.** Head-based trace
  sampling keeps 25% (`Telemetry__TracesSampleRatio` = `0.25`, `:218-221`); the OpenTelemetry logging
  provider ships `Warning` and above while Serilog still writes `Information` to container stdout
  (`:229-232`); the two highest-volume instrument groups (`http.client.*` gauges and the `dotnet.*`
  runtime instruments, measured at about 65% of AppMetrics ingestion, `:234-239`) are switched off
  (`:240-247`); and the metric export interval is stretched from the 60-second default to 300 seconds,
  cutting roughly 80% of the remaining datapoints while five-minute alert windows keep the same signal
  (`:255-258`).
- **What an operator actually reads is alerts and a workbook, not a live console.** SLO rules ship as
  code (`main.bicep:326`, `:400`, `:441`, and the Gateway availability alert at `:474`, all wired to
  the unconditional action group at `:271-279`), and a saved Azure Monitor workbook visualizes the
  same SLOs per service (`:508-520`), which is the deployed-environment view (ADR-062, ADR-041).
- **The ACA Aspire dashboard is not provisioned**, and that is the decision rather than a to-do. It is
  ephemeral (no retention behind it), full fidelity (it would be looking at the very stream this
  template thins), and it has no alert or saved-query surface, so it cannot be the thing that pages
  anyone. It stays what it is here: the development-time console the AppHost opens.

## Rationale
- **Test at the boundary that ships.** A service is deployed as its own container app
  (`MMCA.ADC/infra/main.bicep:984`, `:1185`, `:1312`, `:1439`), configured entirely through
  environment variables. `WebApplicationFactory` plus an environment-variable override channel is a
  closer model of that than an app model the deployment does not use: production topology comes from
  Bicep (`MMCA.ADC/.github/workflows/deploy.yml:1294`), not from the AppHost.
- **The cheapest tier that could have failed.** The per-service tier needs no Docker at all, because
  `AddBrokerMessaging` returns early on the default `InProcess` provider, which is what an absent
  `MessageBus` section resolves to
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:732`, the missing-section
  fallback at `:738-739` and the early return at `:741-744`, over the `InProcess` default on
  `Settings/MessageBusSettings.cs:17`), and only the
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
  The nightly AppHost smoke test exists precisely to close this, and being nightly and non-gating,
  it closes it a day late by design.
- **The environment-variable channel is global and order-sensitive.** Hosts must boot strictly
  sequentially and every pushed variable has to be restored on disposal
  (`SqlServerIntegrationTestFixtureBase.cs:17-24`, `CrossServiceFixtureBase.cs:32-38`), which is
  fragile in a way an in-memory configuration source would not be. It is the price of the hosts
  reading configuration at configure time, and it is paid in test infrastructure rather than in
  production code.
- **Sampling means a reported request may have no trace.** At 0.25, three of four traces are dropped
  at the head, so an operator investigating a specific user report will often find the request counted
  and not traced (`main.bicep:218-221`).
- **The `Warning` floor moves `Information` logs off the queryable path.** They exist in container
  stdout only (`:223-232`), so the correlation-id story (ADR-041) is complete only for what the floor
  admits.
- **A 300-second export interval delays metric-driven signal.** Alert rules use five-minute windows,
  so the design holds, but a metric change is not visible in near real time (`:249-258`).
- **Neither absence is enforced.** Nothing fails a build if a project adds `Aspire.Hosting.Testing` or
  a dashboard resource: unlike the pins of ADR-016 or the fitness rules of ADR-015, this record is a
  convention, and its only guard is review.
- **Store carries the same posture with less of it written down here.** The fixtures and the AppHost
  are cited above, but the observability half is grounded in ADC's template; Store's is not restated
  and may differ in detail.

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
the record of that lane's skip behavior).
