# Observability by Default: OpenTelemetry and Azure Monitor in MMCA

> Series: MMCA.Common · Article #48 (deep-dive) · Pillar P2/P3 · Group G16 · Rubric §13 · ADR-041, ADR-062 ·
> Status: grounded in `Website/docs-src/adr/041-observability-and-telemetry.md`,
> `Website/docs-src/adr/062-slo-alerting-as-code.md`,
> `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs` (`AddServiceDefaults`),
> `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs` (`ConfigureOpenTelemetry`,
> `ConfigureMetrics`, `ConfigureAspNetCoreMetrics`, `AddOpenTelemetryExporters`, `TryGetTraceSampleRatio`,
> `IsInstrumentationDisabled`, `IsInstrumentationEnabled`, `IsProbeTelemetryFilterEnabled`),
> `MMCA.Common/Source/Hosting/MMCA.Common.Azure.Startup/AzureMonitorExporterExtensions.cs` (`AddAzureMonitorExporter`),
> `MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs` (`AddMmcaServiceHost`),
> `MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs`,
> `MMCA.Common.Application/Auth/AuthenticationServiceBase.cs`, `MMCA.Common.Infrastructure/Messaging/BrokerWire.cs`,
> `MMCA.Common.Aspire/Telemetry/OutboxPollFilterProcessor.cs`,
> `MMCA.Common.Application/UseCases/Decorators/CqrsMetrics.cs`,
> `MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxMetrics.cs`,
> `MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandMetrics.cs`,
> `MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandProcessor.cs`,
> `MMCA.Common.Infrastructure/Scheduling/SchedulerMetrics.cs`,
> `MMCA.Common.Infrastructure/Messaging/BrokerMetrics.cs`, `MMCA.Common.API/Caching/OutputCacheMetrics.cs`,
> `MMCA.Common.API/Concurrency/ConcurrencyConflictMetrics.cs`,
> `MMCA.Common.Application/Services/BestEffort.cs`,
> `MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs`, `MMCA.ADC/infra/main.bicep`,
> `MMCA.Store/infra/main.bicep`,
> `Website/docs-src/onboarding/group-16-aspire-orchestration.md`, and the §13 row of
> `Website/docs-src/governance/ArchitectureEvaluationCriteria.md`. No em dashes.

**Subtitle:** Auto-instrumentation gives you HTTP and runtime signals for free, but it is blind to the
two paths that carry almost all of your framework's own work: the CQRS pipeline and the outbox. Here is
how one shared hosting call wires OpenTelemetry logs, metrics, and traces, ships to the Aspire dashboard
locally over OTLP and to Azure Monitor in the cloud through one explicit adapter call, and filters idle
poll and probe spans so telemetry does not quietly become your biggest cloud line item.

---

You split the monolith into a handful of services, wire up OpenTelemetry because that is what you are
supposed to do, deploy, and open the dashboard. HTTP spans are there. Runtime counters are there. Then
someone asks the two questions that actually matter in an incident: "how long is this command taking and
how often is it failing" and "is the outbox dead-lettering." And you realize the traces cannot answer
either one.

That is not a gap in your setup. It is the ceiling of auto-instrumentation. The ASP.NET Core, `HttpClient`,
and .NET-runtime instrumentations give you generic transport and process signals, but they are structurally
blind to the two paths that carry almost all of a CQRS-and-outbox framework's real work: the use-case
pipeline and the background message drain. Nobody instruments those unless the framework does it for them.

And then the first Application Insights bill arrives. A deployed fleet polls every relational outbox table
around the clock, and if every idle poll ships a span (plus the SqlClient child the Azure Monitor distro
attaches to it), steady-state nothing becomes the loudest thing in your telemetry. Full-fidelity tracing
is already the single largest observability line item; idle polling piles on top of it.

MMCA.Common treats observability as a hosting-layer default: one call on the host builder, and every
service in the model gets the same logs, metrics, and traces, the same framework-specific instrumentation
where auto-instrumentation is blind, and the same cost knobs, each with a deliberate default that a typo
cannot flip.

## Why it matters

Observability is the category you do not miss until production, and by then retrofitting it is expensive.
The rubric names the bar directly: structured logging with correlation IDs across boundaries, distributed
tracing and RED metrics wired to a backend, health checks for orchestrators, and (the part most teams
skip) deliberate noise control so high-volume low-value telemetry does not run up the bill
(`ArchitectureEvaluationCriteria.md:408-413`). It is a weight-2 category (`:421`).

Two forces pull against each other here. You want enough signal to operate the system, and you do not want
the signal to cost more than the system. Most teams pick one end: they either instrument everything at full
fidelity and get a telemetry invoice that rivals compute, or they trim so hard that an incident becomes a
guessing game. The interesting engineering is in wiring the useful signal by default while making the
expensive fidelity a knob you turn per host, not a rewrite.

The other reason it matters: in a modular monolith that extracts into services (ADR-008), the same
telemetry has to make sense whether a request stays in one process or crosses a gateway and three service
hosts. If observability is bolted on per app, it drifts. If it lives in the shared hosting defaults, every
host, in-process or extracted, tells the same story the same way.

## The MMCA answer: one call, one baseline, on every host

Every framework-consuming host reaches `AddServiceDefaults()` before anything module-specific, and that
method calls `ConfigureOpenTelemetry()` (`Extensions.cs:35`, the call at `:37`). The service hosts get there
through one composed start-up call, `AddMmcaServiceHost` (for example `MMCA.ADC.Conference.Service/Program.cs:82`
and `MMCA.Store.Catalog.Service/Program.cs:32`), which runs `AddCommonSerilog` and then `AddServiceDefaults`
(`ServiceHostBuilderExtensions.cs:84-85`): Serilog has to come first so the OpenTelemetry logging provider
registered by `AddServiceDefaults` joins the same logging factory (`:83`). The web UIs reach it through
`AddMmcaBlazorWebHost` (`BlazorWebHostExtensions.cs:85`), and the two gateways call `AddServiceDefaults()`
directly (`MMCA.ADC.Gateway/Program.cs:77`, `MMCA.Store.Gateway/Program.cs:69`). So a host opts in once and
every project in the Aspire model inherits the identical telemetry pipeline. There is no per-app
ServiceDefaults copy: all four ADC services, all three Store services, both gateways and both web UIs
consume this one implementation.

`ConfigureOpenTelemetry` (`Extensions.Telemetry.cs:70`, in the partial `Extensions` file that holds all of
the telemetry wiring) does four things.

**It wires logging, metrics, and tracing.** Logs go through the OpenTelemetry logger with
`IncludeFormattedMessage` and `IncludeScopes` on (`Extensions.Telemetry.cs:72-76`) so a scope carries its
structured state. The metrics half is a separate private method, `ConfigureMetrics`
(`Extensions.Telemetry.cs:240`, called through a one-line lambda at `:79`), and it starts with the ASP.NET
Core instrumentation through `ConfigureAspNetCoreMetrics` (called at `:242`, declared at `:357`), which is
on unless a cost knob below drops it. Tracing adds five activity sources by name (`:82-86`, among them
`MMCA.Common.Messaging`, the broker transport's source, `BrokerWire.cs:19`) and then ASP.NET Core and
`HttpClient` instrumentation (`:106-109` or `:113-114`, depending on a knob below). That is the free
auto-instrumentation floor plus the framework's own sources.

**It instruments only where auto-instrumentation is blind.** Eleven framework-owned meters carry custom
signals, subscribed here by literal name because the Aspire package deliberately has no project reference to
the assemblies that define them:

- The CQRS pipeline publishes RED metrics through a single meter `MMCA.Common.Cqrs`
  (`CqrsMetrics.cs:24`): two duration histograms, `cqrs.command.duration` (`CqrsMetrics.cs:29-32`) and
  `cqrs.query.duration` (`:35-38`), both in milliseconds, recorded by the logging decorators and tagged by
  the operation name and an `outcome` tag. Count gives rate, the tag gives errors, the histogram gives
  duration. RED falls out of a pipeline layer that already exists (the logging decorator), so there is no
  per-handler discipline to keep up. The same meter carries `cqrs.query.cache.hit` and
  `cqrs.query.cache.miss` counters (`:41-50`), recorded by the caching query decorator, so a hit ratio per
  query is chartable off the same subscription, plus two short-circuit counters recorded by the
  authorization and timeout decorators: `cqrs.authorization.denied.count` (`:53-56`) and `cqrs.timeout.count`
  (`:59-62`), both tagged `request_type`, so a permission denying more traffic than expected or a handler
  that keeps exhausting its execution budget is visible as a metric rather than only as a client-side error
  rate.
- The outbox owns a meter `MMCA.Common.Outbox`, declared with all of its instruments in a dedicated
  `OutboxMetrics` class rather than in the processor (`OutboxMetrics.cs:16`, meter name at `:19`, meter at `:21`), and it carries
  five: a dead-letter counter `outbox.dead_letter.count` (`:41-44`), a success counter
  `outbox.processed.count` (`:47-50`), an end-to-end dispatch-lag histogram in seconds (`:57-60`), an
  `ObservableGauge` for pending depth (`:75-79`) published each cycle from the depth the processor observed
  (`OutboxProcessor.cs:184`), and a second gauge, `outbox.oldest_pending.age` in seconds tagged
  `data_source` (`:98-102`, fed by `SetOldestPendingAge` at `:115`). The two say different things: the
  histogram reports how late the messages that did get delivered were, the age gauge reports how late a
  backlog already is while it is still stuck, which is the number an alert on a wedged outbox fires on
  (`:81-86`). The dead-letter counter has two increment sites, tagged `event_type` and `reason`: an
  unresolvable event type (`OutboxProcessor.cs:1094-1097`, reason `type_unresolvable`; a row on its first
  attempt is retried once as transient before that unless the host set `MaxRetries` to 1, `:1078-1087`)
  and an exhausted retry budget (`:686-689`, reason `retries_exhausted`). The same activity source emits outbox spans
  (`OutboxProcessor.cs:104`).
- The durable internal-command queue owns `MMCA.Common.InternalCommands`
  (`InternalCommandMetrics.cs:20`, meter at `:22`) with the same shape one drain over a table needs:
  processed, failed and dead-letter counters (`:38`, `:48`, `:58`), a duration histogram (`:67`), a
  schedule-lag histogram (`:76`), a pending-depth gauge (`:93`) and an oldest-due-age gauge (`:105`), plus
  five per-lane instruments: short-circuited, released and receiver-cooldown counters (`:129`, `:138`,
  `:144`) and a lane pending-depth and a lane oldest-due-age gauge (`:153`, `:160`). It is Article 51's
  subject; here it matters because it is the second background drain the trace filter has to know about.
- The API idempotency filter owns a meter `MMCA.Common.Idempotency` (`IdempotencyMetrics.cs:19`) with
  three counters: `idempotency.replayed` (`:36-39`), `idempotency.conflict` tagged by kind (`:41-44`), and
  `idempotency.degraded` (`:46-49`) for a request that ran without the guarantee because the cache or lock
  faulted.
- The API's optimistic-concurrency handling owns `MMCA.Common.Persistence` (`ConcurrencyConflictMetrics.cs:27`)
  with one counter, `persistence.concurrency.conflict` tagged `entity_type` (`:37-40`, the tag at `:33`),
  recorded at the two places a request turns a `DbUpdateConcurrencyException` into a response (a 412 under
  an explicit `If-Match`, a 409 everywhere else), so each conflict is counted once (`:14-17`). No alert
  ships on it: a sustained rate on one entity type points at contended rows, which is a design question,
  not an incident (`:20-21`).
- The authentication service owns `MMCA.Common.Auth` (`AuthenticationServiceBase.cs:1102`), whose
  `mmca.auth.signin` counter (`:1128-1130`) carries the password sign-in outcomes
  (`Extensions.Telemetry.cs:306-307`).
- The recurring job scheduler (ADR-074) owns a meter `MMCA.Common.Scheduler`
  (`SchedulerMetrics.cs:19`, meter at `:21`) with three instruments: a `scheduler.job.runs` counter tagged
  by job name and by outcome, Succeeded, Failed or Skipped (`:28-31`), a `scheduler.job.duration`
  histogram in seconds measured around the job's own execution (`:39-42`), and a `scheduler.job.lag`
  histogram in seconds between an occurrence becoming due and actually starting (`:50-53`), which is the
  number that answers "is the scheduler keeping up." A host that never enables the scheduler simply
  publishes nothing on that meter, so the subscription costs it nothing.
- Four more meters cover paths a host opts into. The
  framework's native broker transport owns `MMCA.Common.Broker` (`BrokerMetrics.cs:21`, ADR-118) with two
  counters: `broker.fault.count` (`:30-33`), tagged `event_type` and `queue`, for messages that exhausted
  their in-process retries and second-level redeliveries and were dead-lettered (`:25-29`), which is the
  natural alert target for consumer health, and `broker.circuit.open.count` (`:42-45`), tagged `event_type`,
  for outbox publishes the open circuit breaker rejected before they ever reached the broker. The output-cache eviction consumer owns `MMCA.Common.OutputCache`
  (`OutputCacheMetrics.cs:19`) with one counter, `cache.eviction.failed` (`:29-32`) tagged `cache_tag`: a
  non-zero rate means this host is still serving cached responses it was told to drop, so it is the alert
  target for cross-service cache coherence. Best-effort side effects own `MMCA.Common.BestEffort`
  (`BestEffort.cs:104`) with `besteffort.dispatch.failed` (`:109-112`) tagged `operation`, the count of
  failures that were deliberately swallowed. That last one is a meter of its own rather than a counter
  folded into `MMCA.Common.Cqrs` precisely because best-effort dispatch is not part of the CQRS pipeline
  (hosts call it from handlers, hosted services and consumers alike), so an operator can drop or keep it
  independently of the RED metrics (`BestEffort.cs:95-98`). And the optional language-model package
  publishes its token spend and call duration under one name, `MMCA.Common.AI`, used as both meter and
  trace source (`Extensions.Telemetry.cs:43`, subscribed as a meter at `:320` and as a source at `:86`),
  inert in a host that never adds that package.
  All four publish nothing in a host that stays on the in-process bus, takes no output cache, dispatches no
  best-effort work, and calls no model.

The Aspire defaults subscribe all eleven by literal name in one chain (`Extensions.Telemetry.cs:310-320`),
with a comment enumerating what each family carries (`:296-309`), and then subscribe a twelfth meter that
nobody in this repo defines: Polly's own (`:327`). The standard resilience handler sits on every
`HttpClient` and every gRPC typed client, so it is the component that decides whether an inter-service
call is retried, timed out, or refused by an open circuit, and `resilience.polly.strategy.events` is what
makes a brownout look like a brownout rather than like latency (`:322-326`).

**It exposes cost knobs with deliberate defaults.** There are six, and the first three are about volume
for its own sake. ASP.NET Core metrics (`http.server.*`, `kestrel.*`, `aspnetcore.*`,
`signalr.server.*`) are on unless `Telemetry:DisableAspNetCoreMetrics` is set
(`Extensions.Telemetry.cs:359`). The source records why that knob exists: the family was 73% of both
production workspaces' ingestion over 2026-09-22..28, mostly gauges re-emitted on replicas serving no
traffic, and no alert reads any of it (`:348-353`), so both production templates set it
(`MMCA.ADC/infra/main.bicep:356-357`, `MMCA.Store/infra/main.bicep:301-302`). `HttpClient` connection and
request metrics are on unless `Telemetry:DisableHttpClientMetrics` is set (`Extensions.Telemetry.cs:251`),
and .NET runtime metrics (`dotnet.gc.*`, `jit.*`, `thread_pool.*`, published by the runtime itself on its
`System.Runtime` meter and subscribed with `AddMeter`, `:293`) unless `Telemetry:DisableRuntimeMetrics`
is set (`:279`). All three keys are read by `IsInstrumentationDisabled` (`Extensions.Telemetry.cs:205`, its
doc naming the three at `:198-200`), which drops the family only when the value parses as boolean `true`;
absent, blank, or unparseable keeps the instrumentation, so a typo cannot silently blind a whole metric
family. Skipping the `Add` call is not enough on its own, and the source says why (`:253-263`): a deployed
host may also register a vendor exporter distro (`AddAzureMonitorExporter()`, from the
`MMCA.Common.Azure.Startup` adapter, calls `UseAzureMonitor()`), and the Azure Monitor distro adds the
`System.Net.Http` meter itself, so a skipped `Add` alone leaves the toggle advisory. Each disabled branch
therefore installs a drop `View`, over every meter under the `Microsoft.AspNetCore.` prefix (`:364-367`),
over `System.Net.Http` plus `System.Net.NameResolution` (`:264-268`) and over `System.Runtime`
(`:284-287`); a `View` applies to the whole `MeterProvider` regardless of which component added the meter,
which is what makes the knob authoritative. The fourth knob is the mirror image: Polly's two duration
histograms are dropped by a `View` unless a host opts in with `Telemetry:EnablePollyDurationMetrics`
(`:24`, read by `IsInstrumentationEnabled` at `:218`, the `View` at `:337-345`), because they re-measure
what `http.client.request.duration` and the dependency traces already report (`:329-333`); absent, blank or
unparseable all mean "stay off" (`:208-213`), while the strategy-events counter is never dropped
(`:334-336`). Head-based trace sampling is the fifth: `Telemetry:TracesSampleRatio` (read at
`Extensions.Telemetry.cs:185`), parsed by `TryGetTraceSampleRatio` (`Extensions.Telemetry.cs:182`, called
at `:140`), is unset by default so a host samples everything, and both production templates set it to
`0.25` (`MMCA.ADC/infra/main.bicep:310-311`, `MMCA.Store/infra/main.bicep:255-256`). Set a ratio in the
open interval (0,1) and it installs a `TraceIdRatioBasedSampler` wrapped in a `ParentBasedSampler`
(`Extensions.Telemetry.cs:141`) so a sampled-in request keeps its whole trace intact across service
boundaries. A value that is absent, unparseable, or outside (0,1) falls back to sample-all
(`Extensions.Telemetry.cs:186-191`), so a typo can never silently drop all telemetry.

**It filters idle poll and probe spans out of export.** That is the sixth knob and the sharpest decision in
the file. More on it below.

Then `AddOpenTelemetryExporters` (`Extensions.Telemetry.cs:164`, called at `:144`) enables the one
built-in, vendor-neutral exporter: OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is present
(`Extensions.Telemetry.cs:166-172`), which the Aspire dashboard sets locally. The core package references no
cloud SDK, so Azure Monitor is an explicit adapter call: `AddAzureMonitorExporter()` from the
`MMCA.Common.Azure.Startup` adapter package, which `MMCA.Common.Azure` includes
(`AzureMonitorExporterExtensions.cs:42`), and every deployed host makes it right after
`AddServiceDefaults()` (all six ADC hosts and all five Store hosts). The service hosts and web UIs pass it as
the `AfterServiceDefaults` delegate (for example `MMCA.ADC.Conference.Service/Program.cs:118` and
`MMCA.Store.Catalog.Service/Program.cs:46`), which `AddMmcaServiceHost` invokes immediately after
`AddServiceDefaults` (`ServiceHostBuilderExtensions.cs:86`), and the gateways call it directly
(`MMCA.ADC.Gateway/Program.cs:82`, `MMCA.Store.Gateway/Program.cs:74`). It does nothing when
`APPLICATIONINSIGHTS_CONNECTION_STRING` is absent or blank (`AzureMonitorExporterExtensions.cs:56-59`),
so local development and tests take no Azure dependency, and calls `UseAzureMonitor()` when the cloud
deployment sets it (`:65`). Its ordering is enforced, not just documented: `ConfigureOpenTelemetry`
registers a `HostIntegrationMarker` after the filter processors (`Extensions.Telemetry.cs:146-148`), and
the adapter throws when that marker is missing (`AzureMonitorExporterExtensions.cs:44-52`), whether or not
the connection string is set, so a misordered host fails on a developer machine. The opposite mistake fails
too: a host that has the connection string but never makes the call fails startup through
`HostIntegrationTripwire`, naming the missing call and its package (`HostIntegrationTripwire.cs:98-102`),
rather than running with no export. Both exporters can be active at once (`Extensions.Telemetry.cs:161`). Local development
ships to the Aspire dashboard; production ships to workspace-based Application Insights. The one-call-per-vendor-capability
pattern behind that adapter has its own article:
[Cloud-neutral vendor adapters](cloud-neutral-vendor-adapters.md).

Here is the shape of the pipeline (condensed from `Extensions.Telemetry.cs:70-151` and `:240-373`,
comments paraphrased, control flow, predicates and API calls as in source):

```csharp
public TBuilder ConfigureOpenTelemetry()
{
    builder.Logging.AddOpenTelemetry(logging =>
    {
        logging.IncludeFormattedMessage = true;
        logging.IncludeScopes = true;
    });

    builder.Services.AddOpenTelemetry()
        .WithMetrics(metrics => ConfigureMetrics(metrics, builder.Configuration))
        .WithTracing(tracing =>
        {
            tracing.AddSource(builder.Environment.ApplicationName)
                .AddSource("MMCA.Common.Outbox")
                .AddSource("MMCA.Common.Messaging")
                .AddSource("MMCA.Common.InternalCommands")
                .AddSource(AiTelemetryName);

            // On by default: health-probe requests and their dependency children stay out of traces.
            var filterProbeTelemetry = IsProbeTelemetryFilterEnabled(builder.Configuration);
            if (filterProbeTelemetry)
            {
                tracing.AddAspNetCoreInstrumentation(options =>
                        options.Filter = Telemetry.ProbeTelemetryFilter.ShouldCollectRequest)
                    .AddHttpClientInstrumentation(options =>
                        options.FilterHttpRequestMessage = Telemetry.ProbeTelemetryFilter.ShouldCollectOutgoing);
            }
            else
            {
                tracing.AddAspNetCoreInstrumentation()
                    .AddHttpClientInstrumentation();
            }

            // Both processors run before any exporter, so their OnEnd clears Recorded first:
            tracing.AddProcessor(new Telemetry.OutboxPollFilterProcessor());
            if (filterProbeTelemetry)
                tracing.AddProcessor(new Telemetry.ProbeTelemetryFilterProcessor());

            // Off by default; a deployed host opts into head-based sampling:
            if (TryGetTraceSampleRatio(builder.Configuration, out var traceSampleRatio))
                tracing.SetSampler(new ParentBasedSampler(new TraceIdRatioBasedSampler(traceSampleRatio)));
        });

    builder.AddOpenTelemetryExporters(); // OTLP only, when OTEL_EXPORTER_OTLP_ENDPOINT is set

    // The receipt AddAzureMonitorExporter() checks for, registered after the filter processors:
    builder.Services.AddSingleton(new Integrations.HostIntegrationMarker(Integrations.HostIntegrationNames.ServiceDefaultsTelemetry));
    return builder;
}

private static void ConfigureMetrics(MeterProviderBuilder metrics, IConfiguration configuration)
{
    ConfigureAspNetCoreMetrics(metrics, configuration);

    // HttpClient and runtime families, on by default. Disabling drops the whole meter with a View,
    // because a vendor distro such as Azure Monitor adds these meters itself:
    if (IsInstrumentationDisabled(configuration, "Telemetry:DisableHttpClientMetrics"))
        metrics.AddView(instrument =>
            string.Equals(instrument.Meter.Name, "System.Net.Http", StringComparison.Ordinal)
            || string.Equals(instrument.Meter.Name, "System.Net.NameResolution", StringComparison.Ordinal)
                ? MetricStreamConfiguration.Drop
                : null);
    else
        metrics.AddHttpClientInstrumentation();

    if (IsInstrumentationDisabled(configuration, "Telemetry:DisableRuntimeMetrics"))
        metrics.AddView(instrument =>
            string.Equals(instrument.Meter.Name, "System.Runtime", StringComparison.Ordinal)
                ? MetricStreamConfiguration.Drop
                : null);
    else
        metrics.AddMeter("System.Runtime"); // the runtime's own meter, same dotnet.* names

    // Framework meters, subscribed by literal name:
    metrics.AddMeter("MMCA.Common.Outbox")
        .AddMeter("MMCA.Common.Cqrs")
        .AddMeter("MMCA.Common.Idempotency")
        .AddMeter("MMCA.Common.Scheduler")
        .AddMeter("MMCA.Common.Broker")
        .AddMeter("MMCA.Common.OutputCache")
        .AddMeter("MMCA.Common.BestEffort")
        .AddMeter("MMCA.Common.InternalCommands")
        .AddMeter("MMCA.Common.Persistence")
        .AddMeter("MMCA.Common.Auth")
        .AddMeter(AiTelemetryName);

    // Polly's meter, minus its two duration histograms unless a host opts in:
    metrics.AddMeter(PollyMeterName);
    if (!IsInstrumentationEnabled(configuration, EnablePollyDurationMetricsConfigKey))
        metrics.AddView(instrument =>
            string.Equals(instrument.Meter.Name, PollyMeterName, StringComparison.Ordinal)
            && (string.Equals(instrument.Name, PollyAttemptDurationInstrument, StringComparison.Ordinal)
                || string.Equals(instrument.Name, PollyPipelineDurationInstrument, StringComparison.Ordinal))
                ? MetricStreamConfiguration.Drop
                : null);
}

private static void ConfigureAspNetCoreMetrics(MeterProviderBuilder metrics, IConfiguration configuration)
{
    // On by default; both production deployments drop the whole Microsoft.AspNetCore.* family:
    if (IsInstrumentationDisabled(configuration, "Telemetry:DisableAspNetCoreMetrics"))
        metrics.AddView(instrument =>
            instrument.Meter.Name.StartsWith("Microsoft.AspNetCore.", StringComparison.Ordinal)
                ? MetricStreamConfiguration.Drop
                : null);
    else
        metrics.AddAspNetCoreInstrumentation();
}
```

## The one that pays for itself: filtering idle poll spans

The `OutboxProcessor` polls every relational outbox table on a recurring cycle (both deployment templates
push the interval to 300 seconds precisely so idle polls cost less: `Outbox__PollingIntervalSeconds` is set
to `300` on every service container app, four in `MMCA.ADC/infra/main.bicep` (`:2385`, `:2656`, `:2806`,
`:2978`) and three in `MMCA.Store/infra/main.bicep` (`:2057`, `:2261`, `:2406`), against the 2-second default in
`OutboxSettings.cs:31`). Each poll runs inside an `OutboxPoll`
activity (`OutboxProcessor.cs:311`, inside `FetchCandidatesAsync` at `:305`, named at `:78`), and under
the Azure Monitor distro that span gets a child SqlClient dependency span for the poll query. A second
`OutboxPoll` activity wraps the backlog-depth count that feeds the pending-depth gauge
(`OutboxProcessor.cs:285`, inside `CountPendingAsync` at `:273`, which only queries when the fetched batch
came back full, `:280-283`), deliberately reusing the same name so the same filter suppresses it. The
internal-command queue drains the same way, under its own `InternalCommandPoll` name
(`InternalCommandProcessor.cs:58`, opened at `:248` and `:290`). At fleet scale, that steady stream of
idle-poll spans would dominate Application Insights ingestion and spam the local dashboard, telemetry about
nothing happening, priced like something happening.

`OutboxPollFilterProcessor` (`OutboxPollFilterProcessor.cs:17`) is a `BaseProcessor<Activity>` that drops
exactly those spans. Its `OnEnd` (`:32`) walks the ending span's in-process parent chain
(`:42`) and clears the `Recorded` flag (`:49`) as soon as one ancestor matches `IsSuppressedPoll` (`:60-64`),
which is true for two pairs of literals: `OutboxPoll` on source `MMCA.Common.Outbox`, or
`InternalCommandPoll` on source `MMCA.Common.InternalCommands` (`:26-29`). Matching operation name and
source together is what stops an unrelated span that happens to be named "OutboxPoll" from being
suppressed. Clearing `Recorded` makes the batch exporters skip the activity, which is why the processor is
registered before the exporters (`Extensions.Telemetry.cs:124`, ahead of `AddOpenTelemetryExporters()` at
`:144` and of any vendor exporter, which `AddAzureMonitorExporter()` guarantees by refusing to run before
`AddServiceDefaults()`, `AzureMonitorExporterExtensions.cs:44-52`): its `OnEnd` runs first, and the
exporters never see the span. A second processor,
`ProbeTelemetryFilterProcessor`, is registered right behind it under the same ordering requirement
(`:131`), because the inbound filter refuses the probe request span itself while its dependency children
are sampled independently and need un-recording before the exporters look (`:128-130`).

Real work survives untouched. Each per-message `OutboxProcess` span is started under an explicit parent
context rebuilt from the message's stored trace and span ids and passed straight into `StartActivity`
(`OutboxProcessor.cs:1142`, the start call at `:1155`), so it is never a child of the poll span and never
matched by the parent-chain walk. Per-command `InternalCommandExecute` spans work the same way
(`OutboxPollFilterProcessor.cs:13-15`). The outbox counters, the lag histogram, and the two gauges are
metrics, not spans, so they are unaffected too. You lose the noise and keep the signal.

The poll-span and source literals live on both sides of the package boundary: the filter
(`OutboxPollFilterProcessor.cs:26-29`) and the two processors that emit them, where the outbox declares its
pair across three sites, `PollActivityName` (`OutboxProcessor.cs:78`), the activity source (`:104`), and the
meter name (`OutboxMetrics.cs:19`). They are duplicated on purpose, with a sync comment on both sides
(`OutboxPollFilterProcessor.cs:19-25`, `OutboxProcessor.cs:72-77`, and for the meter name
`OutboxMetrics.cs:9-10`), because the Aspire package must not take a
project reference on Infrastructure: its one `ProjectReference` is `MMCA.Common.Shared`, which is what keeps
`AddServiceDefaults` usable from a host that takes no persistence stack. That is the honest price of a
decoupled package graph, and it is a trade-off, not an accident.

## The other half: which signal wakes a human

Everything above is emission. Which of those signals pages somebody, at what threshold, at what severity,
is a separate decision. ADR-062 (`Website/docs-src/adr/062-slo-alerting-as-code.md:4`, accepted
2026-08-01) records which signal pages, at what threshold and at what severity.

Each consuming app declares its SLO alerts as **data in its Bicep template**. `sloAlertSpecs` is one array
of records carrying `key`, `description`, `query`, `timeAggregation`, `metricMeasureColumn`, `threshold`,
and `severity` (`MMCA.ADC/infra/main.bicep:439`, `MMCA.Store/infra/main.bicep:374`), materialized
one-for-one into Log Analytics `scheduledQueryRules` named `${prefix}-alert-${spec.key}-v2`
(`MMCA.ADC/infra/main.bicep:540-544`) and evaluated every 15 minutes over a 15-minute window, a frequency
the template's own comment ties to the bill: a scheduled-query rule is billed per evaluation, and the
5-minute tier costs $1.47 per month per rule against about $0.50 at 15 minutes (`:560-564`; Store's rules
carry the same cadence and reasoning at `MMCA.Store/infra/main.bicep:439-447`). Both apps declare the same
five core SLOs at the same severities: `failed-requests` at severity 2
(`MMCA.ADC/infra/main.bicep:440-448`), `request-rejections` at severity 3 (`:449-457`),
`server-response-time` at severity 3 (`:458-466`), `dependency-failures` at severity 2 (`:467-475`), and
`resilience-circuit-open` at severity 2 with a threshold of 0 (`:479-487`, Store's at
`MMCA.Store/infra/main.bicep:414-422`), which queries the `resilience.polly.strategy.events` instrument for
an `OnCircuitOpened` event and so fires on the first breaker opening rather than on a rate
(`MMCA.ADC/infra/main.bicep:476-478`). ADC carries a sixth entry, `ai-scoring-token-ceiling` at severity 3
(`:525-537`), the one rule that overrides the cadence: it sums AI input and output tokens over a two-day
window evaluated every 12 hours (`:533-534`; the override rationale at `:566-569`, the 15-minute defaults at
`:571` and `:573`), and it is enabled only when an AI key is deployed. An alert
clicked together in the portal is invisible to review, absent from the next environment, and impossible
to diff; an array in the template that provisions the workloads is all three.

**Why log-search rules and not metric alerts.** This is the decision worth stealing. A metric alert on
`requests/failed`, `requests/duration`, or `dependencies/failed` has no status-code or URL predicate, so at
this traffic level it pages on completely routine traffic. A 401 (expired or absent auth) and a 499 (client
disconnected mid-request) both count as failed requests, a long-lived SignalR hub connection reports its
**connection lifetime** as request duration, a crawler's first contact with a host is a `GET
/robots.txt` followed by a `GET /sitemap.xml`, and a scanner on a public host produces a 404 or 429 burst
with no fault behind it. ADC's own template records the pages that made the case
(`MMCA.ADC/infra/main.bicep:403-438`): one window held eight 401s plus two 499s plus a single readiness 503
and zero other failures, all from one browser session retrying with an expired token; five hub connections
averaging 11.3 seconds dragged the fleet-wide average to 5539ms against a 3000ms threshold with every real
request fast; twelve robots and sitemap 404s arrived from a single Azure-hosted crawler inside one
15-minute window (`:408-417`); three further pages were 11, 30 and 14 rows of scanner and crawler 404 and
429 traffic (`:418-422`); and a dependency call cancelled because its caller disconnected logs `ResultCode`
0, never 499 (`:423-425`). A metric alert has no way to say "exclude 401 and 499", "exclude `/hubs/` before
averaging", or "exclude a 404 on `/sitemap.xml`"; a KQL query says exactly that (`:443`, `:452`, `:461`).
Both apps' `failed-requests` excludes 401, 404, 429 and 499 and nothing else, with no path predicate
(`MMCA.ADC/infra/main.bicep:443`, `MMCA.Store/infra/main.bicep:378`), so a genuine 400, 409 or 5xx burst
still pages at the same threshold of 10 (`MMCA.ADC/infra/main.bicep:426-430`,
`MMCA.Store/infra/main.bicep:364-368`). The 404 and 429 volume is watched separately by
`request-rejections`, which pages at severity 3 on more than 50 such rows in a window and carries the
crawler etiquette exclusion for `/robots.txt` and `/sitemap.xml` (`MMCA.ADC/infra/main.bicep:452`,
`MMCA.Store/infra/main.bicep:387`), so a 404 burst below that volume pages nobody. `dependency-failures`
excludes 401 and 499 and also, through a `leftanti` join, every dependency row in an operation whose
request answered 499, which is what catches those `ResultCode` 0 cancellations
(`MMCA.ADC/infra/main.bicep:470`, `MMCA.Store/infra/main.bicep:405`). The response-time rule goes further:
beyond the `/hubs/` filter it drops `ResultCode` 101 (a hub or Blazor circuit connection, whose duration is
its lifetime) and rows with no `Url` (the background `InternalCommandExecute` and `OutboxProcess` spans),
it only evaluates a window holding at least five requests, so a single cold request cannot page, and it
skips any window in which `ContainerAppSystemLogs_CL` records a `RevisionCreation` or `RevisionUpdate`,
because during a deploy the window can hold only post-deploy probes, one of them a cold first request
(`MMCA.ADC/infra/main.bicep:461`, rationale `:434-438`; Store's at `MMCA.Store/infra/main.bicep:396`,
rationale `:369-373`). ADC applies the same deploy skip to its `dependency-failures` rule, because a
rollout's own transient peer failures are not a dependency incident (`MMCA.ADC/infra/main.bicep:470`,
rationale `:431-434`); Store's `dependency-failures` carries no such skip
(`MMCA.Store/infra/main.bicep:405`), so on that one rule the two apps differ. The exclusions are a
precision fix; the five-request floor and the deploy skip are a deliberate trade of sensitivity in quiet
and rollout windows (a slow release pages in the next window, `MMCA.ADC/infra/main.bicep:438`).

**The operational trap: a rule name is an identity.** An incremental ARM deployment never removes a
resource just because it left the template, and a name is how Azure decides whether a deployment updates a
resource or creates a second one. That cuts both ways when a metric alert is superseded by a query rule
covering the same signal: the old resource has to be deleted deliberately, and the replacement cannot
reuse its name, because the superseded metric alert still holds that name in the resource group and a
query rule under it would collide with a resource of a different type (`MMCA.Store/infra/main.bicep:427-429`;
ADR-062 at `Website/docs-src/adr/062-slo-alerting-as-code.md:188-192`). So every
generated query rule carries the `-v2` suffix, and the template says in place that the suffix is part of
the rule's identity in Azure and must stay stable (`MMCA.ADC/infra/main.bicep:542-544`). Cheap to respect,
expensive to discover.

Two smaller properties matter as much. Every active rule routes to **one unconditional action group**:
`alertEmailAddress` is a required parameter with no default (`MMCA.ADC/infra/main.bicep:146`, Store's at
`MMCA.Store/infra/main.bicep:125`), so the email receiver is never conditional
(`MMCA.ADC/infra/main.bicep:387`, receivers at `:393`), every SLO rule points at it (`:597`), and the
gateway metric alert reaches the same group through its own `actions` block (`:1127-1131`). An alert wired
to no channel is worse than no alert, because it looks like coverage and pages nobody. And a saved
workbook renders the same signals off the same workspace, embedded at compile time from a JSON file in the
repo (`:1143`, `:1152`), so the dashboard cannot drift from the alerts by being maintained somewhere else.

The other half of ADR-062 is a build gate that fails when an alert has no severity-matching runbook
section, or when a runbook section outlives its alert. That belongs with the rest of the fitness tier, so
it is Article 34's subject rather than this one's.

Two honest limits. The gate covers only what sits inside the parsed spec window, and both apps provision
alerts outside it, more of them every time an incident teaches something. ADC has fifteen, none of them
gated. Nine are severity 2 scheduled query rules generated from one `scheduledQueryAlertSpecs` array
(`MMCA.ADC/infra/main.bicep:663`, materialized at `:723`, severity at `:730`): `outbox-dead-letter`
(`:665`), `sql-dependency-failures` (`:674`), `revision-activation-failed` (`:680`),
`signalr-backplane-errors` (`:686`), which fires on any warning or error the Notification service's
SignalR Redis backplane logs, because while Redis is unreachable a push issued on one replica never
reaches a client connected to another (`:687-688`), `outbox-backlog-age` (`:692`), which fires when the
`outbox.oldest_pending.age` gauge passes 900 seconds, because nothing dead-letters until every retry is
spent (`:694`, rationale `:641-647`), `outbox-broker-circuit-open` (`:698`), which reads
`broker.circuit.open.count` because the outbox's own broker breaker is built without Polly telemetry and
so is invisible to `resilience-circuit-open` (`:700`, rationale `:648-651`), `live-broadcast-dropped`
(`:704`), the only signal that Engagement shed a live broadcast under backpressure (`:652-654`),
`native-push-failed` (`:710`), which fires when an OS-level push send failed for at least one recipient
(`:655-658`), and `internal-command-backlog-age` (`:716`), the internal-command twin of the outbox age rule
on the `internal_commands.oldest_due.age` gauge (`:659-662`, query `:718`).
The consumer-side twin of the outbox dead-letter rule is a severity 2 metric alert, `brokerDeadLetterAlert`
(`:778`, severity at `:784`), on the Service Bus `DeadletteredMessages` metric of the three host queues, so
it catches every reason a consumer gave up on an event, not only the one the receive pipeline logs at
Error (`:760-777`).
Then come a severity 2 `logIngestionCapAlert` that fires when the workspace approaches or hits its daily
ingestion cap, evaluated every 15 minutes over a one-hour window (`:842`, severity at `:849`, cadence at
`:852-853`, the `OverQuota` or `ApproachingQuota` match at `:858`); two security signals that stand alone
because the generated loop pins severity 2 (`:881-882`): a severity 2 `authFailureSpikeAlert` (`:925`,
severity at `:932`) and a severity 3 `forbiddenBurstAlert` (`:966`, severity at `:973`); a severity 2
`keyRingAccessAlert` on authenticated access to the key-ring storage recorded in `StorageBlobLogs`
(`:1025`, severity at `:1032`, rationale ending `:1024`); and a severity 1 gateway-availability alert
(`:1104`, severity at `:1110`) over a three-location web test against `/health` (`:1071`, locations at
`:1087`, the URL at `:1093`). Store has seven always on, each its own resource:
`outboxDeadLetterAlert` (`MMCA.Store/infra/main.bicep:503`, severity 2 at `:510`), the same
`brokerDeadLetterAlert` metric alert (`:563`, severity 2 at `:569`), `revisionActivationAlert` (`:624`),
`authFailureSpikeAlert` (`:692`), `forbiddenBurstAlert` (`:732`), `logIngestionQuotaAlert` (`:778`), and
its own severity 1 `gatewayAvailabilityAlert` (`:992`, severity at `:998`) over the same kind of
three-location `/health` web test (`:959`, locations at `:975`, the URL at `:981`). Three more Store
security signals, `sqlAuthFailureAlert` (`:828`), `signInFailureAlert` (`:869`) and
`stripeWebhookSignatureAlert` (`:910`), deploy only when `enableSecuritySignalAlerts` is set (`:50`,
default false). All of them can be added, renamed, or re-tiered with no runbook consequence. And MMCA.Helpdesk has no `infra/` template at all, so it
has neither the alerts nor anything for a pairing gate to check.

## Trade-offs, honestly

- **The literal names can drift.** The meter, activity-source, and poll-span names are duplicated as string
  literals across the Aspire package (`OutboxPollFilterProcessor.cs:26-29`, the five `AddSource` calls at
  `Extensions.Telemetry.cs:82-86` and the twelve `AddMeter` calls at `:310-320` and `:327`) and the defining
  assemblies (`CqrsMetrics.cs`, `OutboxMetrics.cs`, `InternalCommandMetrics.cs`, `IdempotencyMetrics.cs`,
  `ConcurrencyConflictMetrics.cs`, `AuthenticationServiceBase.cs` for `MMCA.Common.Auth` (`:1102`),
  `SchedulerMetrics.cs`, `BrokerMetrics.cs`, `BrokerWire.cs` for the `MMCA.Common.Messaging` source (`:19`),
  `OutputCacheMetrics.cs`, `BestEffort.cs`, `OutboxProcessor.cs`,
  `InternalCommandProcessor.cs` for `InternalCommandPoll` (`:58`) and `AiUsageMeter.cs` in `MMCA.Common.AI`
  for `MMCA.Common.AI` (`:26`)), plus one name, `Polly`, that no assembly here owns at all. Every new meter
  family widens that surface. The duplicated-literal note sits in a doc comment on one side or both
  (`OutboxMetrics.cs:9-10`, `ConcurrencyConflictMetrics.cs:9-10`); for the AI family it is on the Aspire side
  only (`Extensions.Telemetry.cs:37-40`). A rename on one side
  silently stops the matching export or subscription until the literal is updated. The decoupled package
  graph is worth it; the sync discipline is real.
- **Sampling trades trace completeness for cost.** A sampled-out trace is gone, so deep debugging of one
  specific request can miss it. Metrics and logs are unaffected (sampling is trace-only), so RED rates and
  error counts stay whole even at a low ratio. Size the ratio to your debugging horizon, not to zero.
- **Poll-span and probe-span filtering hide steady-state activity by design.** "Is the poller alive and
  looping" and "are the probes passing" are not questions traces answer once both filters are on. The
  poller's signals live in metrics on purpose: `outbox.processed.count` (`OutboxMetrics.cs:47`), the
  dispatch-lag histogram (`:57`), the pending-depth gauge (`:75`), the oldest-pending-age gauge (`:98`) and
  the dead-letter counter (`:41-44`). Probe traffic is a sharper case. The probe filter itself leaves
  metrics alone, so `http.server.request.duration` and the Kestrel instruments keep it visible
  (`Extensions.Telemetry.cs:98-99`), but only while `Telemetry:DisableAspNetCoreMetrics` is off, and both
  production templates turn it on (`MMCA.ADC/infra/main.bicep:356-357`,
  `MMCA.Store/infra/main.bicep:301-302`), so in production probe traffic appears on neither the trace nor
  the metric dashboards. If you rely on poll or probe spans for a liveness check, chart the outbox metrics
  instead, and decide deliberately what answers the probe question.
- **Exporters are opt-in per host.** A host that sets no `OTEL_EXPORTER_OTLP_ENDPOINT` and makes no vendor
  adapter call emits to nothing, and a host that sets `APPLICATIONINSIGHTS_CONNECTION_STRING` without
  calling `AddAzureMonitorExporter()` does not start at all (`HostIntegrationTripwire.cs:98-102`). And four
  of the six cost knobs (the three `Disable*` metric knobs and the sample ratio) fail toward keeping data
  (higher cost), not toward silence, so a misconfigured value is a possible cost surprise, never a silent
  data gap. The two exceptions are deliberate and documented, and both fail toward a smaller bill: the
  Polly duration histograms stay off unless a host opts in, so a typo never adds a high-volume stream
  (`Extensions.Telemetry.cs:208-213`), and the probe-telemetry filter defaults to on, because probe chatter
  is ingestion nobody wants billed (`Extensions.Telemetry.cs:221-226`). That is the intended bias, but it
  is a bias worth naming.

## Apply this even without MMCA

The pattern ports to any OpenTelemetry stack, with or without Aspire:

1. **Put the telemetry baseline in one shared bootstrap** every host calls, not in each app. One place to
   change the meter list, tighten a timeout, or add a processor means every service moves in lockstep.
2. **Instrument only where auto-instrumentation is blind.** Let ASP.NET Core, `HttpClient`, and the runtime
   ride the free instrumentation. Add your own meters and activity sources for the paths that carry your
   real work (a use-case pipeline, a background drain), and emit RED from a layer you already have (a
   logging decorator) rather than sprinkling it through every handler.
3. **Make expensive fidelity a knob, not a rewrite, and pick each knob's failure direction on purpose.**
   Gate the highest-volume metric families and head-based trace sampling behind configuration. A knob that
   removes a family should drop it only on an explicit boolean, a knob that adds a redundant stream should
   stay off unless explicitly enabled, and an out-of-range sample ratio should mean sample-all, so a typo
   can neither blind you nor silently grow the bill.
4. **Check that a metrics toggle is actually authoritative.** If a vendor distro adds a meter behind your
   back, skipping your own `Add` call changes nothing; a drop `View` on the meter applies to the whole
   provider and does.
5. **Filter high-volume low-value spans before export.** A recurring poll, a health-check ping, an idle
   heartbeat: drop them with a processor that clears the `Recorded` flag, registered before your exporters,
   and match on both operation name and source so you never suppress an unrelated span by name alone.
6. **Keep the vendor exporter out of the shared core, and make its ordering checkable.** Ship OTLP from the
   bootstrap whenever its endpoint variable is set, and add a cloud backend through one explicit adapter call
   that does nothing without its connection string, refuses to run before your filter processors are
   registered, and is backed by a startup check that fails a host holding the connection string but missing
   the call. The same binary then runs from laptop to production, with both exporters active at once if you
   like.

The takeaway: **observability is a hosting-layer default, not a per-app afterthought. Wire the useful signal
once for every host, instrument the paths auto-instrumentation cannot see, and make the expensive fidelity a
knob whose typo can never blind you or silently grow the bill, because the two ways this goes wrong in
production are a telemetry bill you did not expect and a trace that cannot answer the question you actually
have.**

---

**What we covered:** why auto-instrumentation is structurally blind to the CQRS pipeline and the outbox, how
one `ConfigureOpenTelemetry` call in the shared Aspire defaults wires logs, metrics, and traces plus eleven
framework meters (`MMCA.Common.Cqrs` RED histograms plus its cache and short-circuit counters, the
`MMCA.Common.Outbox` counters, histogram and two gauges, the `MMCA.Common.InternalCommands` drain and lane
instruments, the `MMCA.Common.Idempotency` counters, the `MMCA.Common.Persistence`
`persistence.concurrency.conflict` counter, the `MMCA.Common.Auth` sign-in counter, the
`MMCA.Common.Scheduler` run, duration and lag instruments, and the `MMCA.Common.Broker`,
`MMCA.Common.OutputCache`, `MMCA.Common.BestEffort` and `MMCA.Common.AI` streams) plus Polly's resilience
meter on
every host, how six
cost knobs (`Telemetry:DisableAspNetCoreMetrics`, `Telemetry:DisableHttpClientMetrics`,
`Telemetry:DisableRuntimeMetrics`, `Telemetry:EnablePollyDurationMetrics`, `Telemetry:TracesSampleRatio`
and `Telemetry:FilterProbeTelemetry`)
trim spend without going dark, why a drop `View` is what makes a metrics toggle authoritative over the
Azure Monitor distro, how `OutboxPollFilterProcessor` drops idle poll spans from two drains before export
while real work survives, how the exporters are wired (OTLP from its environment variable in the core,
Azure Monitor through the explicit `AddAzureMonitorExporter()` adapter call every deployed host makes
after `AddServiceDefaults()`, with both misorderings failing loudly), and how the SLO alerts that actually page
a human are declared as data in each app's deployment template, as Log Analytics query rules rather than
metric alerts, under names whose `-v2` suffix is part of their identity in Azure.

**Next in the series:** Article 49, "Undo Is a Feature: Saga Compensation and the Reconciliation Backstop,"
the deep-dive on undoing a cross-boundary workflow when there is no two-phase commit to roll it back for you.

*MMCA.Common is open source. Star the repo, read the 2-minute ADR-041 behind this pattern, or
`dotnet add package MMCA.Common.Aspire` and call `AddServiceDefaults()`.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- This pattern's decision record: `Website/docs-src/adr/041-observability-and-telemetry.md`
- The full 34-category scorecard, §13 included, lives in `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Previous: Article 47, "Security Headers and CSP for Blazor: One Middleware, Every Host." Next: Article 49,
"Undo Is a Feature: Saga Compensation and the Reconciliation Backstop."*

*Tags: .NET, C Sharp, OpenTelemetry, Observability, Distributed Systems*

*Notes: 2026-11-25 refresh, re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`), driven by the
2026-11-25 audit (Needs-edit). Every anchor below was re-read in this run unless marked carried or "from the audit".
Changed this run: eleven framework meters, not ten (`MMCA.Common.Auth` at `Extensions.Telemetry.cs:319`, defined at
`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:1102`, counter `mmca.auth.signin`
`:1128-1130`), so Polly is the twelfth subscription (`:327`) and the meter comment `:296-309` covers every family
(internal commands `:297-298`, sign-in outcomes `:306-307`); five trace sources, not four (`MMCA.Common.Messaging` at
`:84`, defined at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerWire.cs:19`), both added to the
code block; `broker.fault.count` counts dead-lettered messages tagged `event_type` and `queue` (`BrokerMetrics.cs:25-33`;
MassTransit left the framework in v1.316.0, ADR-118), so the `Fault<TEvent>` wording is gone; the internal-command meter
carries five lane instruments (`InternalCommandMetrics.cs:129`/`:138`/`:144`/`:153`/`:160`); service hosts reach
`AddServiceDefaults` through `AddMmcaServiceHost` (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:83-86`),
web UIs through `AddMmcaBlazorWebHost` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs:85`),
gateways directly; `AddAzureMonitorExporter` lives in `MMCA.Common/Source/Hosting/MMCA.Common.Azure.Startup/AzureMonitorExporterExtensions.cs`
(header path corrected); the tripwire row is `HostIntegrationTripwire.cs:98-102`; ADC's `dependency-failures` also skips
deploy windows (`MMCA.ADC/infra/main.bicep:470`, rationale `:431-434`) while Store's does not (`MMCA.Store/infra/main.bicep:405`);
ADC's ungated alerts went from twelve to fifteen (`broker-error-queue` replaced by the metric alert `brokerDeadLetterAlert`;
`native-push-failed`, `internal-command-backlog-age` and `keyRingAccessAlert` added); Store's always-on seven swap
`brokerErrorQueueAlert` for `brokerDeadLetterAlert`, and three more are gated on `enableSecuritySignalAlerts`; every moved
anchor re-anchored. Earlier history: 2026-10-29 structural refresh (OTLP-only core, the Azure Monitor adapter call, the
`MMCA.Common.Persistence` meter), 2026-10-22, 2026-10-08 and 2026-10-02 (the move into the partial `Extensions.Telemetry.cs`,
ADR-041 Revised 2026-10-01). The code block is condensed from `Extensions.Telemetry.cs:70-151` and `:240-373` (comments
paraphrased, control flow, predicates and API calls as in source, not byte-for-byte). Header: rubric cell trimmed to
section 13 (section 31, FinOps, is a recorded scope-out of the series; the cost content in the body stays, grounded in source).*
- *Entry: `AddServiceDefaults` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:35`, `ConfigureOpenTelemetry()`
  call `:37`). `AddMmcaServiceHost`: Serilog-first comment `ServiceHostBuilderExtensions.cs:83`, `AddCommonSerilog` `:84`,
  `AddServiceDefaults` `:85`, `AfterServiceDefaults` invoked `:86`. ADC call sites: Conference `AddMmcaServiceHost` `:82`
  (exporter delegate `:118`), Engagement `:58` (`:75`), Identity `:79` (`:98`), Notification `:58` (`:85`), Gateway
  `AddServiceDefaults()` `:77` and `AddAzureMonitorExporter()` `:82`, UI.Web exporter `:46`. Store: Catalog `:32` (`:46`),
  Identity `:37` (`:56`), Sales `:51` (`:76`), Gateway `:69` and `:74`, UI.Web `AddMmcaBlazorWebHost` `:30` (exporter `:45`).
  Six ADC and five Store hosts make the exporter call.*
- *`ConfigureOpenTelemetry` (`Extensions.Telemetry.cs:70-151`): logging `:72-76`; `.WithMetrics` `:79`; five trace sources
  `:82-86`; metrics untouched by the probe filter `:98-99`; probe-knob read `:100`; filtered instrumentation pair `:106-109`,
  plain pair `:113-114`; `OutboxPollFilterProcessor` `:124` (order comment `:117-123`); `ProbeTelemetryFilterProcessor` `:131`
  (comment `:128-130`); sampler comment `:134-139`, guard `:140`, `SetSampler` `:141`; `AddOpenTelemetryExporters()` `:144`;
  `HostIntegrationMarker(ServiceDefaultsTelemetry)` `:148` (comment `:146-147`).*
- *Metrics: `ConfigureMetrics` `:240`; `ConfigureAspNetCoreMetrics` called `:242`, declared `:357`, knob read `:359`, prefix
  drop `View` `:364-367`, rationale doc `:348-353` (the 73% figure at `:351`); HttpClient knob `:251`, why-a-View comment
  `:253-263`, `View` `:264-268`; runtime knob `:279`, `View` `:284-287`, `AddMeter("System.Runtime")` `:293`; meter comment
  `:296-309`; eleven-meter chain `:310-320` (`Auth` `:319`, AI `:320`); Polly rationale `:322-326`, `AddMeter(PollyMeterName)`
  `:327`, duration-histogram reasoning `:329-333`, never-dropped counter `:334-336`, Polly `View` `:337-345`. Constants:
  `AiTelemetryName` `:43`, Polly instrument names `:54`/`:57`, `EnablePollyDurationMetricsConfigKey` `:24` (from the audit).*
- *Cost knobs, six: `TryGetTraceSampleRatio` `:182` (ratio 1.0 `:184`, key read `:185`, fallback `:186-191`);
  `IsInstrumentationDisabled` `:205` (keys named `:198-200`); `IsInstrumentationEnabled` `:218` (opt-in doc `:208-213`);
  `IsProbeTelemetryFilterEnabled` `:230-231` (default-true doc `:221-226`). Deployed: `Telemetry__TracesSampleRatio`
  (`MMCA.ADC/infra/main.bicep:310-311`, `MMCA.Store/infra/main.bicep:255-256`; 0.25, restated by ADC `:898`);
  `Telemetry__DisableAspNetCoreMetrics` (ADC `:356-357`, Store `:301-302`; value true, from the audit).*
- *Exporters: `AddOpenTelemetryExporters` `Extensions.Telemetry.cs:164`, OTLP `:166-172`, both-active doc `:161`.
  `AddAzureMonitorExporter` (`MMCA.Common/Source/Hosting/MMCA.Common.Azure.Startup/AzureMonitorExporterExtensions.cs:42`):
  ordering guard and throw `:44-52`, no-op without the connection string `:56-59`, receipt `:63`, `UseAzureMonitor()` `:65`.
  Tripwire: `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:98-102` (its message names
  `MMCA.Common.Azure.Startup` or `MMCA.Common.Azure`, which includes it, `:101`).*
- *`OutboxPollFilterProcessor` anchors (`:13-15`, `:17`, `:19-25`, `:26-29`, `:32`, `:42`, `:49`, `:60-64`) and the single
  `ProjectReference` (`MMCA.Common.Aspire.csproj:81`) carried, confirmed by the 2026-11-25 audit.*
- *`OutboxProcessor.cs`: `PollActivityName` `:78` (sync comment `:72-77`, from the audit), `OutboxActivitySource` `:104`,
  `SetPendingDepth` `:184`, `CountPendingAsync` `:273` (saturated-batch guard `:280-283`, `StartActivity` `:285`),
  `FetchCandidatesAsync` `:305` (`StartActivity` `:311`), `retries_exhausted` `:686-689`, `type_unresolvable` `:1094-1097`,
  first-attempt retry `:1078-1087` (guard `:1080` requires `MaxRetries > 1`), `StartOutboxActivity` `:1142`, `StartActivity`
  `:1155`. `InternalCommandProcessor.cs`: `PollActivityName` `:58`, poll `StartActivity` `:248` and `:290`,
  `InternalCommandExecute` `StartActivity` `:737` under an explicit remote parent built just above it (`:734-735`).*
- *Meter classes: `BrokerMetrics.cs` `:21`/`:25-33`/`:42-45`; `InternalCommandMetrics.cs` `:20`/`:38`/`:48`/`:58`/`:67`/
  `:76`/`:93`/`:105`, lanes `:129`/`:138`/`:144`/`:153`/`:160` (meter `:22` carried); `BestEffort.cs` rationale `:95-98`,
  `MeterName` `:104`, counter `:109-112`. Carried and confirmed by the audit: `CqrsMetrics.cs`, `OutboxMetrics.cs`,
  `IdempotencyMetrics.cs`, `SchedulerMetrics.cs`, `OutputCacheMetrics.cs`, `ConcurrencyConflictMetrics.cs`,
  `MMCA.Common/Source/Core/MMCA.Common.AI/Observability/AiUsageMeter.cs:26`.*
- *Deployment interval: `Outbox__PollingIntervalSeconds` 300 at `MMCA.ADC/infra/main.bicep:2385`, `:2656`, `:2806`, `:2978`
  and `MMCA.Store/infra/main.bicep:2057`, `:2261`, `:2406`; default 2 at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxSettings.cs:31` (carried).*
- *SLO alerting, ADC (`MMCA.ADC/infra/main.bicep`): incidents comment `:403-438` (the original pages `:408-417`, scanner pages
  `:418-422`, `ResultCode` 0 cancellations `:423-425`, scope summary `:426-430`, deploy-skip rationale `:431-438`, both rules
  `:431-434`); `sloAlertSpecs` `:439`: `failed-requests` `:440-448` (query `:443`), `request-rejections` `:449-457` (`:452`),
  `server-response-time` `:458-466` (`:461`), `dependency-failures` `:467-475` (`:470`, `leftanti` join plus `deploying == 0`),
  `resilience-circuit-open` `:479-487` (rationale `:476-478`), `ai-scoring-token-ceiling` `:525-537` (severity 3 `:532`,
  `P2D`/`PT12H` `:533-534`); `sloAlerts` loop `:540`, identity note `:542-543`, `-v2` name `:544`; cost rationale `:560-564`
  and override rationale `:566-569` (from the audit); defaults `:571`/`:573`; `actionGroups` `:597`; `actionGroup` `:387`,
  `emailReceivers` `:393`, `alertEmailAddress` `:146`; gateway `actions` `:1127-1131` (from the audit); `sloWorkbook` `:1143`,
  `loadTextContent` `:1152`. Store (`MMCA.Store/infra/main.bicep`): `alertEmailAddress` `:125`; `sloAlertSpecs` `:374`
  (queries `:378`/`:387`/`:396`/`:405`; only `:396` carries `deploying == 0`), `resilience-circuit-open` `:414-422`, scope
  summary `:364-368`, deploy-skip rationale `:369-373`, `-v2` note `:427-429`; cadence `:439-447` (from the audit).*
- *Ungated extras: ADC FIFTEEN, none gated: `scheduledQueryAlertSpecs` `:663` with nine keys (`outbox-dead-letter` `:665`,
  `sql-dependency-failures` `:674`, `revision-activation-failed` `:680`, `signalr-backplane-errors` `:686`,
  `outbox-backlog-age` `:692`, `outbox-broker-circuit-open` `:698`, `live-broadcast-dropped` `:704`, `native-push-failed`
  `:710`, `internal-command-backlog-age` `:716`; rationale `:636-662`), loop `:723`, severity 2 `:730`;
  `brokerDeadLetterAlert` `:778` (metric alert, severity 2 `:784`, rationale `:757-777`); `logIngestionCapAlert` `:842`
  (severity 2 `:849`, PT15M over PT1H `:852-853`, quota query `:858` from the audit); `authFailureSpikeAlert` `:925`
  (severity 2 `:932`) and `forbiddenBurstAlert` `:966` (severity 3 `:973`), standalone because the loop pins severity 2
  (`:881-882`); `keyRingAccessAlert` `:1025` (severity 2 `:1032`, rationale ending `:1024`); `gatewayAvailabilityAlert`
  `:1104` (severity 1 `:1110`) over `gatewayHealthWebTest` `:1071` (`Locations` `:1087`, `RequestUrl` `/health` `:1093`).
  Store: always on `outboxDeadLetterAlert` `:503` (severity 2 `:510`), `brokerDeadLetterAlert` `:563` (severity 2 `:569`),
  `revisionActivationAlert` `:624`, `authFailureSpikeAlert` `:692`, `forbiddenBurstAlert` `:732`, `logIngestionQuotaAlert`
  `:778`, `gatewayAvailabilityAlert` `:992` (severity 1 `:998`) over `gatewayHealthWebTest` `:959` (`Locations` `:975`,
  `RequestUrl` `:981`); gated on `enableSecuritySignalAlerts` (`:50`, default false): `sqlAuthFailureAlert` `:828`,
  `signInFailureAlert` `:869`, `stripeWebhookSignatureAlert` `:910`. MMCA.Helpdesk has no `infra/` directory (carried).
  The alert-to-runbook build gate is left to Article 34.*
- *Records: ADR-062 (`Website/docs-src/adr/062-slo-alerting-as-code.md:4`, accepted 2026-08-01, confirmed by the audit;
  `-v2` rationale `:181-192`, the name collision `:188-192`). ADR-041 revisions (`Website/docs-src/adr/041-observability-and-telemetry.md`)
  carried from 2026-10-29. Rubric section 13 at `Website/docs-src/governance/ArchitectureEvaluationCriteria.md:403`, criteria
  `:408-413`, weight 2 `:421` (carried). Group G16: `### OutboxPollFilterProcessor` in
  `Website/docs-src/onboarding/group-16-aspire-orchestration.md` (carried). Anchor facts this run: MMCA.Common v1.319.0
  (`MMCA.Common/FACTS.md:14`), 30 packages (`FACTS.md:20`), 147 ADRs, range 001-147 (`Website/docs-src/adr/README.md:6`);
  the article body states none of these numbers.*

- Full series index: https://ivanball.github.io/writing.html
