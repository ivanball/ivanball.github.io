# Observability by Default: OpenTelemetry and Azure Monitor in MMCA

> Series: MMCA.Common · Article #48 (deep-dive) · Pillar P2/P3 · Group G16 · Rubric §13 · ADR-041, ADR-062 ·
> Status: grounded in `Website/docs-src/adr/041-observability-and-telemetry.md`,
> `Website/docs-src/adr/062-slo-alerting-as-code.md`,
> `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs` (`AddServiceDefaults`),
> `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs` (`ConfigureOpenTelemetry`,
> `ConfigureMetrics`, `ConfigureAspNetCoreMetrics`, `AddOpenTelemetryExporters`, `TryGetTraceSampleRatio`,
> `IsInstrumentationDisabled`, `IsInstrumentationEnabled`, `IsProbeTelemetryFilterEnabled`),
> `MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureMonitorExporterExtensions.cs` (`AddAzureMonitorExporter`),
> `MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs`,
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

Every framework-consuming host calls `AddServiceDefaults()` early in `Program.cs`, and that method calls
`ConfigureOpenTelemetry()` (`Extensions.cs:33`, the call at `:35`) before anything module-specific. Only
host-level setup runs ahead of it, notably `AddCommonSerilog`, which has to come first so the OpenTelemetry
logging provider registered by `AddServiceDefaults` joins the same logging factory
(`MMCA.Store.Catalog.Service/Program.cs:69-71`). So a host opts in once and every project in the Aspire
model inherits the identical telemetry pipeline. There is no per-app ServiceDefaults copy: all four ADC
services and all three Store services consume this one implementation directly (for example
`MMCA.ADC.Conference.Service/Program.cs:117` and `MMCA.Store.Catalog.Service/Program.cs:74`), as do both
gateways and both web UIs.

`ConfigureOpenTelemetry` (`Extensions.Telemetry.cs:70`, in the partial `Extensions` file that holds all of
the telemetry wiring) does four things.

**It wires logging, metrics, and tracing.** Logs go through the OpenTelemetry logger with
`IncludeFormattedMessage` and `IncludeScopes` on (`Extensions.Telemetry.cs:72-76`) so a scope carries its
structured state. The metrics half is a separate private method, `ConfigureMetrics`
(`Extensions.Telemetry.cs:239`, called through a one-line lambda at `:79`), and it starts with the ASP.NET
Core instrumentation through `ConfigureAspNetCoreMetrics` (called at `:241`, declared at `:351`), which is
on unless a cost knob below drops it. Tracing adds four activity sources by name (`:82-85`) and then
ASP.NET Core and `HttpClient` instrumentation (`:105-108` or `:112-113`, depending on a knob below). That
is the free auto-instrumentation floor plus the framework's own sources.

**It instruments only where auto-instrumentation is blind.** Ten framework-owned meters carry custom
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
  (`OutboxProcessor.cs:181`), and a second gauge, `outbox.oldest_pending.age` in seconds tagged
  `data_source` (`:98-102`, fed by `SetOldestPendingAge` at `:115`). The two say different things: the
  histogram reports how late the messages that did get delivered were, the age gauge reports how late a
  backlog already is while it is still stuck, which is the number an alert on a wedged outbox fires on
  (`:81-86`). The dead-letter counter has two increment sites, tagged `event_type` and `reason`: an
  unresolvable event type (`OutboxProcessor.cs:1054-1057`, reason `type_unresolvable`; a row on its first
  attempt is retried once as transient before that unless the host set `MaxRetries` to 1, `:1038-1047`)
  and an exhausted retry budget (`:634-637`, reason `retries_exhausted`). The same activity source emits outbox spans
  (`OutboxProcessor.cs:101`).
- The durable internal-command queue owns `MMCA.Common.InternalCommands`
  (`InternalCommandMetrics.cs:20`, meter at `:22`) with the same shape one drain over a table needs:
  processed, failed and dead-letter counters (`:38`, `:48`, `:57`), a duration histogram (`:66`), a
  schedule-lag histogram (`:75`), a pending-depth gauge (`:92`) and an oldest-due-age gauge (`:104`). It is
  Article 51's subject; here it matters because it is the second background drain the trace filter has to
  know about.
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
- The recurring job scheduler (ADR-074) owns a meter `MMCA.Common.Scheduler`
  (`SchedulerMetrics.cs:19`, meter at `:21`) with three instruments: a `scheduler.job.runs` counter tagged
  by job name and by outcome, Succeeded, Failed or Skipped (`:28-31`), a `scheduler.job.duration`
  histogram in seconds measured around the job's own execution (`:39-42`), and a `scheduler.job.lag`
  histogram in seconds between an occurrence becoming due and actually starting (`:50-53`), which is the
  number that answers "is the scheduler keeping up." A host that never enables the scheduler simply
  publishes nothing on that meter, so the subscription costs it nothing.
- Four more meters cover paths a host opts into. The
  broker transport owns `MMCA.Common.Broker` (`BrokerMetrics.cs:21`, ADR-087) with two counters tagged
  `event_type`: `broker.fault.count` (`:30-33`) for integration events that exhausted their retry policy and
  were published as a MassTransit `Fault<TEvent>`, which is the natural alert target for consumer health,
  and `broker.circuit.open.count` (`:42-45`) for outbox publishes the open circuit breaker rejected before
  they ever reached the broker. The output-cache eviction consumer owns `MMCA.Common.OutputCache`
  (`OutputCacheMetrics.cs:19`) with one counter, `cache.eviction.failed` (`:29-32`) tagged `cache_tag`: a
  non-zero rate means this host is still serving cached responses it was told to drop, so it is the alert
  target for cross-service cache coherence. Best-effort side effects own `MMCA.Common.BestEffort`
  (`BestEffort.cs:102`) with `besteffort.dispatch.failed` (`:107-110`) tagged `operation`, the count of
  failures that were deliberately swallowed. That last one is a meter of its own rather than a counter
  folded into `MMCA.Common.Cqrs` precisely because best-effort dispatch is not part of the CQRS pipeline
  (hosts call it from handlers, hosted services and consumers alike), so an operator can drop or keep it
  independently of the RED metrics (`BestEffort.cs:92-97`). And the optional language-model package
  publishes its token spend and call duration under one name, `MMCA.Common.AI`, used as both meter and
  trace source (`Extensions.Telemetry.cs:43`, subscribed as a meter at `:314` and as a source at `:85`),
  inert in a host that never adds that package.
  All four publish nothing in a host that stays on the in-process bus, takes no output cache, dispatches no
  best-effort work, and calls no model.

The Aspire defaults subscribe all ten by literal name in one chain (`Extensions.Telemetry.cs:305-314`),
with a comment enumerating what nine of them carry (`:293-304`; it does not mention
`MMCA.Common.InternalCommands`), and then subscribe an eleventh meter that nobody in this repo defines:
Polly's own (`:321`). The standard resilience handler sits on every `HttpClient` and
every gRPC typed client, so it is the component that decides whether an inter-service call is retried,
timed out, or refused by an open circuit, and `resilience.polly.strategy.events` is what makes a brownout
look like a brownout rather than like latency (`:316-320`).

**It exposes cost knobs with deliberate defaults.** There are six, and the first three are about volume
for its own sake. ASP.NET Core metrics (`http.server.*`, `kestrel.*`, `aspnetcore.*`,
`signalr.server.*`) are on unless `Telemetry:DisableAspNetCoreMetrics` is set
(`Extensions.Telemetry.cs:353`). The source records why that knob exists: the family was 73% of both
production workspaces' ingestion over 2026-09-22..28, mostly gauges re-emitted on replicas serving no
traffic, and no alert reads any of it (`:342-348`), so both production templates set it
(`MMCA.ADC/infra/main.bicep:327-328`, `MMCA.Store/infra/main.bicep:258-259`). `HttpClient` connection and
request metrics are on unless `Telemetry:DisableHttpClientMetrics` is set (`Extensions.Telemetry.cs:250`),
and .NET runtime metrics (`dotnet.gc.*`, `jit.*`, `thread_pool.*`) unless `Telemetry:DisableRuntimeMetrics`
is set (`:278`). All three keys are read by `IsInstrumentationDisabled` (`Extensions.Telemetry.cs:204`, its
doc naming the three at `:197-199`), which drops the family only when the value parses as boolean `true`;
absent, blank, or unparseable keeps the instrumentation, so a typo cannot silently blind a whole metric
family. Skipping the `Add` call is not enough on its own, and the source says why (`:252-262`): a deployed
host may also register a vendor exporter distro (`AddAzureMonitorExporter()` from `MMCA.Common.Azure` calls
`UseAzureMonitor()`), and the Azure Monitor distro adds the `System.Net.Http` meter itself, so a skipped
`Add` alone leaves the toggle advisory. Each disabled branch therefore installs a drop `View`, over every
meter under the `Microsoft.AspNetCore.` prefix (`:358-361`), over `System.Net.Http` plus
`System.Net.NameResolution` (`:263-267`) and over `System.Runtime` (`:283-286`); a `View` applies to the
whole `MeterProvider` regardless of which component added the meter, which is what makes the knob
authoritative. The fourth knob is the mirror image: Polly's two duration histograms are dropped by a
`View` unless a host opts in with `Telemetry:EnablePollyDurationMetrics` (`:24`, read by
`IsInstrumentationEnabled` at `:217`, the `View` at `:331-339`), because they re-measure what
`http.client.request.duration` and the dependency traces already report (`:323-327`); absent, blank or
unparseable all mean "stay off" (`:207-213`), while the strategy-events counter is never dropped
(`:328-330`). Head-based trace sampling is the fifth: `Telemetry:TracesSampleRatio` (read at
`Extensions.Telemetry.cs:184`), parsed by `TryGetTraceSampleRatio` (`Extensions.Telemetry.cs:181`, called
at `:139`), is unset by default so a host samples everything, and both production templates set it to
`0.25` (`MMCA.ADC/infra/main.bicep:281-282`, `MMCA.Store/infra/main.bicep:212-213`). Set a ratio in the
open interval (0,1) and it installs a `TraceIdRatioBasedSampler` wrapped in a `ParentBasedSampler`
(`Extensions.Telemetry.cs:140`) so a sampled-in request keeps its whole trace intact across service
boundaries. A value that is absent, unparseable, or outside (0,1) falls back to sample-all
(`Extensions.Telemetry.cs:185-190`), so a typo can never silently drop all telemetry.

**It filters idle poll and probe spans out of export.** That is the sixth knob and the sharpest decision in
the file. More on it below.

Then `AddOpenTelemetryExporters` (`Extensions.Telemetry.cs:163`, called at `:143`) enables the one
built-in, vendor-neutral exporter: OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is present
(`Extensions.Telemetry.cs:165-171`), which the Aspire dashboard sets locally. The core package references no
cloud SDK, so Azure Monitor is an explicit adapter call: `AddAzureMonitorExporter()` from
`MMCA.Common.Azure` (`AzureMonitorExporterExtensions.cs:42`), which every deployed host makes right after
`AddServiceDefaults()` (all six ADC hosts and all five Store hosts, for example
`MMCA.ADC.Conference.Service/Program.cs:122` and `MMCA.Store.Catalog.Service/Program.cs:79`). It does
nothing when `APPLICATIONINSIGHTS_CONNECTION_STRING` is absent or blank (`AzureMonitorExporterExtensions.cs:58-61`),
so local development and tests take no Azure dependency, and calls `UseAzureMonitor()` when the cloud
deployment sets it (`:63`). Its ordering is enforced, not just documented: `ConfigureOpenTelemetry`
registers a `HostIntegrationMarker` after the filter processors (`Extensions.Telemetry.cs:145-147`), and
the adapter throws when that marker is missing (`AzureMonitorExporterExtensions.cs:44-52`), whether or not
the connection string is set, so a misordered host fails on a developer machine. The opposite mistake fails
too: a host that has the connection string but never makes the call fails startup through
`HostIntegrationTripwire`, naming the missing call (`HostIntegrationTripwire.cs:64-66`), rather than running
with no export. Both exporters can be active at once (`Extensions.Telemetry.cs:160`). Local development
ships to the Aspire dashboard; production ships to workspace-based Application Insights. The one-call-per-vendor-capability
pattern behind that adapter has its own article:
[Cloud-neutral vendor adapters](cloud-neutral-vendor-adapters.md).

Here is the shape of the pipeline (condensed from `Extensions.Telemetry.cs:70-150` and `:239-367`,
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
        metrics.AddRuntimeInstrumentation();

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
to `300` on every service container app, four in `MMCA.ADC/infra/main.bicep` (`:1927`, `:2176`, `:2318`,
`:2474`) and three in `MMCA.Store/infra/main.bicep` (`:1589`, `:1767`, `:1903`), against the 2-second default in
`OutboxSettings.cs:31`). Each poll runs inside an `OutboxPoll`
activity (`OutboxProcessor.cs:308`, inside `FetchCandidatesAsync` at `:302`, named at `:75`), and under
the Azure Monitor distro that span gets a child SqlClient dependency span for the poll query. A second
`OutboxPoll` activity wraps the backlog-depth count that feeds the pending-depth gauge
(`OutboxProcessor.cs:282`, inside `CountPendingAsync` at `:270`, which only queries when the fetched batch
came back full, `:277-280`), deliberately reusing the same name so the same filter suppresses it. The
internal-command queue drains the same way, under its own `InternalCommandPoll` name
(`InternalCommandProcessor.cs:57`, opened at `:235` and `:268`). At fleet scale, that steady stream of
idle-poll spans would dominate Application Insights ingestion and spam the local dashboard, telemetry about
nothing happening, priced like something happening.

`OutboxPollFilterProcessor` (`OutboxPollFilterProcessor.cs:17`) is a `BaseProcessor<Activity>` that drops
exactly those spans. Its `OnEnd` (`:32`) walks the ending span's in-process parent chain
(`:42`) and clears the `Recorded` flag (`:49`) as soon as one ancestor matches `IsSuppressedPoll` (`:60-64`),
which is true for two pairs of literals: `OutboxPoll` on source `MMCA.Common.Outbox`, or
`InternalCommandPoll` on source `MMCA.Common.InternalCommands` (`:26-29`). Matching operation name and
source together is what stops an unrelated span that happens to be named "OutboxPoll" from being
suppressed. Clearing `Recorded` makes the batch exporters skip the activity, which is why the processor is
registered before the exporters (`Extensions.Telemetry.cs:123`, ahead of `AddOpenTelemetryExporters()` at
`:143` and of any vendor exporter, which `AddAzureMonitorExporter()` guarantees by refusing to run before
`AddServiceDefaults()`, `AzureMonitorExporterExtensions.cs:44-52`): its `OnEnd` runs first, and the
exporters never see the span. A second processor,
`ProbeTelemetryFilterProcessor`, is registered right behind it under the same ordering requirement
(`:130`), because the inbound filter refuses the probe request span itself while its dependency children
are sampled independently and need un-recording before the exporters look (`:127-129`).

Real work survives untouched. Each per-message `OutboxProcess` span is started under an explicit parent
context rebuilt from the message's stored trace and span ids and passed straight into `StartActivity`
(`OutboxProcessor.cs:1095`, the start call at `:1107`), so it is never a child of the poll span and never
matched by the parent-chain walk. Per-command `InternalCommandExecute` spans work the same way
(`OutboxPollFilterProcessor.cs:13-15`). The outbox counters, the lag histogram, and the two gauges are
metrics, not spans, so they are unaffected too. You lose the noise and keep the signal.

The poll-span and source literals live on both sides of the package boundary: the filter
(`OutboxPollFilterProcessor.cs:26-29`) and the two processors that emit them, where the outbox declares its
pair across three sites, `PollActivityName` (`OutboxProcessor.cs:75`), the activity source (`:101`), and the
meter name (`OutboxMetrics.cs:19`). They are duplicated on purpose, with a sync comment on both sides
(`OutboxPollFilterProcessor.cs:19-25`, `OutboxProcessor.cs:70-73`, and for the meter name
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
and `severity` (`MMCA.ADC/infra/main.bicep:408`, `MMCA.Store/infra/main.bicep:331`), materialized
one-for-one into Log Analytics `scheduledQueryRules` named `${prefix}-alert-${spec.key}-v2`
(`MMCA.ADC/infra/main.bicep:509-513`) and evaluated every 15 minutes over a 15-minute window, a frequency
the template's own comment ties to the bill: a scheduled-query rule is billed per evaluation, and the
5-minute tier costs $1.47 per month per rule against about $0.50 at 15 minutes (`:529-533`; Store's rules
carry the same cadence and reasoning at `MMCA.Store/infra/main.bicep:396-404`). Both apps declare the same
five core SLOs at the same severities: `failed-requests` at severity 2
(`MMCA.ADC/infra/main.bicep:409-417`), `request-rejections` at severity 3 (`:418-426`),
`server-response-time` at severity 3 (`:427-435`), `dependency-failures` at severity 2 (`:436-444`), and
`resilience-circuit-open` at severity 2 with a threshold of 0 (`:448-456`, Store's at
`MMCA.Store/infra/main.bicep:371-379`), which queries the `resilience.polly.strategy.events` instrument for
an `OnCircuitOpened` event and so fires on the first breaker opening rather than on a rate
(`MMCA.ADC/infra/main.bicep:445-447`). ADC carries a sixth entry, `ai-scoring-token-ceiling` at severity 3
(`:494-506`), the one rule that overrides the cadence: it sums AI input and output tokens over a two-day
window evaluated every 12 hours (the override rationale at `:535-538`, the 15-minute defaults at `:540`
and `:542`), and it is enabled only when an AI key is deployed. An alert
clicked together in the portal is invisible to review, absent from the next environment, and impossible
to diff; an array in the template that provisions the workloads is all three.

**Why log-search rules and not metric alerts.** This is the decision worth stealing. A metric alert on
`requests/failed`, `requests/duration`, or `dependencies/failed` has no status-code or URL predicate, so at
this traffic level it pages on completely routine traffic. A 401 (expired or absent auth) and a 499 (client
disconnected mid-request) both count as failed requests, a long-lived SignalR hub connection reports its
**connection lifetime** as request duration, a crawler's first contact with a host is a `GET
/robots.txt` followed by a `GET /sitemap.xml`, and a scanner on a public host produces a 404 or 429 burst
with no fault behind it. ADC's own template records the pages that made the case
(`MMCA.ADC/infra/main.bicep:374-407`): one window held eight 401s plus two 499s plus a single readiness 503
and zero other failures, all from one browser session retrying with an expired token; five hub connections
averaging 11.3 seconds dragged the fleet-wide average to 5539ms against a 3000ms threshold with every real
request fast; twelve robots and sitemap 404s arrived from a single Azure-hosted crawler inside one
15-minute window (`:379-388`); three further pages were 11, 30 and 14 rows of scanner and crawler 404 and
429 traffic (`:389-393`); and a dependency call cancelled because its caller disconnected logs `ResultCode`
0, never 499 (`:394-396`). A metric alert has no way to say "exclude 401 and 499", "exclude `/hubs/` before
averaging", or "exclude a 404 on `/sitemap.xml`"; a KQL query says exactly that (`:412`, `:421`, `:430`).
Both apps' `failed-requests` excludes 401, 404, 429 and 499 and nothing else, with no path predicate
(`MMCA.ADC/infra/main.bicep:412`, `MMCA.Store/infra/main.bicep:335`), so a genuine 400, 409 or 5xx burst
still pages at the same threshold of 10 (`MMCA.ADC/infra/main.bicep:397-401`,
`MMCA.Store/infra/main.bicep:321-325`). The 404 and 429 volume is watched separately by
`request-rejections`, which pages at severity 3 on more than 50 such rows in a window and carries the
crawler etiquette exclusion for `/robots.txt` and `/sitemap.xml` (`MMCA.ADC/infra/main.bicep:421`,
`MMCA.Store/infra/main.bicep:344`), so a 404 burst below that volume pages nobody. `dependency-failures`
excludes 401 and 499 and also, through a `leftanti` join, every dependency row in an operation whose
request answered 499, which is what catches those `ResultCode` 0 cancellations
(`MMCA.ADC/infra/main.bicep:439`, `MMCA.Store/infra/main.bicep:362`). The response-time rule goes further:
beyond the `/hubs/` filter it drops `ResultCode` 101 (a hub or Blazor circuit connection, whose duration is
its lifetime) and rows with no `Url` (the background `InternalCommandExecute` and `OutboxProcess` spans),
it only evaluates a window holding at least five requests, so a single cold request cannot page, and it
skips any window in which `ContainerAppSystemLogs_CL` records a `RevisionCreation` or `RevisionUpdate`,
because during a deploy the window can hold only post-deploy probes, one of them a cold first request
(`MMCA.ADC/infra/main.bicep:430`, rationale `:402-407`; Store's at `MMCA.Store/infra/main.bicep:353`,
rationale `:326-330`). The exclusions are a precision fix; the five-request floor and the deploy skip are
a deliberate trade of sensitivity in quiet and rollout windows (a slow release pages in the next window,
`MMCA.ADC/infra/main.bicep:407`).

**The operational trap: a rule name is an identity.** An incremental ARM deployment never removes a
resource just because it left the template, and a name is how Azure decides whether a deployment updates a
resource or creates a second one. That cuts both ways when a metric alert is superseded by a query rule
covering the same signal: the old resource has to be deleted deliberately, and the replacement cannot
reuse its name, because the superseded metric alert still holds that name in the resource group and a
query rule under it would collide with a resource of a different type (`MMCA.Store/infra/main.bicep:384-386`;
ADR-062 at `Website/docs-src/adr/062-slo-alerting-as-code.md:183-186` and `:377-381`). So every
generated query rule carries the `-v2` suffix, and the template says in place that the suffix is part of
the rule's identity in Azure and must stay stable (`MMCA.ADC/infra/main.bicep:511-513`). Cheap to respect,
expensive to discover.

Two smaller properties matter as much. Every active rule routes to **one unconditional action group**:
`alertEmailAddress` is a required parameter with no default (`MMCA.ADC/infra/main.bicep:124`, Store's at
`MMCA.Store/infra/main.bicep:95`), so the email receiver is never conditional
(`MMCA.ADC/infra/main.bicep:358`, receivers at `:364-370`), every SLO rule points at it (`:566`), and the
gateway metric alert reaches the same group through its own `actions` block (`:938-942`). An alert wired
to no channel is worse than no alert, because it looks like coverage and pages nobody. And a saved
workbook renders the same signals off the same workspace, embedded at compile time from a JSON file in the
repo (`:954`, `:963`), so the dashboard cannot drift from the alerts by being maintained somewhere else.

The other half of ADR-062 is a build gate that fails when an alert has no severity-matching runbook
section, or when a runbook section outlives its alert. That belongs with the rest of the fitness tier, so
it is Article 34's subject rather than this one's.

Two honest limits. The gate covers only what sits inside the parsed spec window, and both apps provision
alerts outside it, more of them every time an incident teaches something. ADC has twelve. Eight are
severity 2 scheduled query rules generated from one `scheduledQueryAlertSpecs` array
(`MMCA.ADC/infra/main.bicep:624`, materialized at `:675-677`, severity at `:682`): `outbox-dead-letter`
(`:626`), `sql-dependency-failures` (`:632`), `revision-activation-failed` (`:638`),
`signalr-backplane-errors` (`:644`), which fires on any warning or error the Notification service's
SignalR Redis backplane logs, because while Redis is unreachable a push issued on one replica never
reaches a client connected to another (`:645-646`), `broker-error-queue` (`:650`), which fires when a
broker consumer exhausts its retries and an integration event lands in its `_error` queue (`:651-652`),
`outbox-backlog-age` (`:656`), which fires when the `outbox.oldest_pending.age` gauge passes 900 seconds,
because nothing dead-letters until every retry is spent (`:657-658`, rationale `:610-616`),
`outbox-broker-circuit-open` (`:662`), which reads `broker.circuit.open.count` because the outbox's own
broker breaker is built without Polly telemetry and so is invisible to `resilience-circuit-open`
(`:664`, rationale `:617-620`), and `live-broadcast-dropped` (`:668`), the only signal that Engagement shed
a live broadcast under backpressure (`:621-623`).
Then come a severity 2 `logIngestionCapAlert` that fires when the workspace approaches or hits its daily
ingestion cap, evaluated every 15 minutes over a one-hour window (`:729`, severity at `:736`, cadence at
`:739-740`, the `OverQuota` or `ApproachingQuota` match at `:745`); two security signals that stand alone
because the generated loop pins severity 2 (`:768-769`): a severity 2 `authFailureSpikeAlert` (`:797`,
severity at `:804`) and a severity 3 `forbiddenBurstAlert` (`:836`, severity at `:843`); and a severity 1
gateway-availability alert (`:915`, severity at `:921`) over a three-location web test against `/health`
(`:882`, locations at `:898-902`, the URL at `:904`). Store has seven, each its own resource:
`outboxDeadLetterAlert` (`MMCA.Store/infra/main.bicep:450`, severity 2 at `:457`),
`brokerErrorQueueAlert` (`:498`, severity 2 at `:505`), `revisionActivationAlert` (`:548`),
`authFailureSpikeAlert` (`:616`), `forbiddenBurstAlert` (`:656`), `logIngestionQuotaAlert` (`:702`), and
its own severity 1 `gatewayAvailabilityAlert` (`:783`, severity at `:789`) over the same kind of
three-location `/health` web test (`:750`, locations at `:766-770`, the URL at `:772`). All of them can be added,
renamed, or re-tiered with no runbook consequence. And MMCA.Helpdesk has no `infra/` template at all, so it
has neither the alerts nor anything for a pairing gate to check.

## Trade-offs, honestly

- **The literal names can drift.** The meter, activity-source, and poll-span names are duplicated as string
  literals across the Aspire package (`OutboxPollFilterProcessor.cs:26-29` and the eleven `AddMeter` calls
  at `Extensions.Telemetry.cs:305-314` and `:321`) and the defining assemblies (`CqrsMetrics.cs`,
  `OutboxMetrics.cs`, `InternalCommandMetrics.cs`, `IdempotencyMetrics.cs`, `ConcurrencyConflictMetrics.cs`,
  `SchedulerMetrics.cs`, `BrokerMetrics.cs`, `OutputCacheMetrics.cs`, `BestEffort.cs`, `OutboxProcessor.cs`,
  `InternalCommandProcessor.cs` for `InternalCommandPoll` (`:57`) and `AiUsageMeter.cs` in `MMCA.Common.AI`
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
  (`Extensions.Telemetry.cs:97-98`), but only while `Telemetry:DisableAspNetCoreMetrics` is off, and both
  production templates turn it on (`MMCA.ADC/infra/main.bicep:327-328`,
  `MMCA.Store/infra/main.bicep:258-259`), so in production probe traffic appears on neither the trace nor
  the metric dashboards. If you rely on poll or probe spans for a liveness check, chart the outbox metrics
  instead, and decide deliberately what answers the probe question.
- **Exporters are opt-in per host.** A host that sets no `OTEL_EXPORTER_OTLP_ENDPOINT` and makes no vendor
  adapter call emits to nothing, and a host that sets `APPLICATIONINSIGHTS_CONNECTION_STRING` without
  calling `AddAzureMonitorExporter()` does not start at all (`HostIntegrationTripwire.cs:64-66`). And four
  of the six cost knobs (the three `Disable*` metric knobs and the sample ratio) fail toward keeping data
  (higher cost), not toward silence, so a misconfigured value is a possible cost surprise, never a silent
  data gap. The two exceptions are deliberate and documented, and both fail toward a smaller bill: the
  Polly duration histograms stay off unless a host opts in, so a typo never adds a high-volume stream
  (`Extensions.Telemetry.cs:207-213`), and the probe-telemetry filter defaults to on, because probe chatter
  is ingestion nobody wants billed (`Extensions.Telemetry.cs:220-226`). That is the intended bias, but it
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
one `ConfigureOpenTelemetry` call in the shared Aspire defaults wires logs, metrics, and traces plus ten
framework meters (`MMCA.Common.Cqrs` RED histograms plus its cache and short-circuit counters, the
`MMCA.Common.Outbox` counters, histogram and two gauges, the `MMCA.Common.InternalCommands` drain
instruments, the `MMCA.Common.Idempotency` counters, the `MMCA.Common.Persistence`
`persistence.concurrency.conflict` counter, the
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

*Notes: 2026-10-29 structural refresh against Common v1.265.1, driven by the 2026-10-29 audit; every anchor below
was re-read in this run (2026-10-29, MMCA.Common v1.265.1) unless marked carried. Corrected this run:
`AddOpenTelemetryExporters` enables OTLP only (`Extensions.Telemetry.cs:163-172`); Azure Monitor is the adapter call
`AddAzureMonitorExporter()` (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureMonitorExporterExtensions.cs:42-66`), made
by all eleven deployed hosts, a no-op without the connection string, throwing ahead of `AddServiceDefaults()`, with
`HostIntegrationTripwire` failing startup on the connection string without the call (ADR-041 Revised 2026-10-24 `:62`);
the body, subtitle, code block, trade-off bullet, apply item 6 and recap no longer say the core picks Azure Monitor from an
environment variable; the framework meters went from nine to ten (`MMCA.Common.Persistence`, `ConcurrencyConflictMetrics.cs:27`,
counter `persistence.concurrency.conflict` tagged `entity_type` `:37-40`) and Polly is the eleventh subscription (ADR-041
Revised 2026-10-26 `:64`); ADC's ungated alerts went from nine to twelve (`outbox-backlog-age`, `outbox-broker-circuit-open`
and `live-broadcast-dropped` joined `scheduledQueryAlertSpecs`, now eight keys, `MMCA.ADC/infra/main.bicep:624-673`); every
`Extensions.Telemetry.cs`, `Extensions.cs`, host `Program.cs`, `OutboxProcessor.cs` dead-letter/activity, ADC `main.bicep`
and Store `main.bicep` anchor below re-anchored; one pointer link added to the cloud-neutral vendor adapters article. Verifier follow-up the same day: the `-v2`
rationale now names the name collision with the superseded alert (`MMCA.Store/infra/main.bicep:384-386`, ADR-062
`:183-186`, `:377-381`); the duplicated-literal list adds `InternalCommandProcessor.cs:57` and
`MMCA.Common/Source/Core/MMCA.Common.AI/Observability/AiUsageMeter.cs:26`, and the note claim is narrowed (the AI note is
Aspire-side only, `Extensions.Telemetry.cs:37-40`); the outbox sync comment is `OutboxProcessor.cs:70-73` with
`OutboxMetrics.cs:9-10`, and the class is `OutboxMetrics.cs:16`; the ADR-062 lead-in is stated in present tense.
Title kept: Azure Monitor remains the deployed exporter, reached through the adapter. Earlier history: 2026-10-22 refresh
against Common v1.250.0 (both apps declare five core SLOs with `request-rejections` at severity 3 and ADC's
`ai-scoring-token-ceiling` as its sixth entry; `failed-requests` excludes 401/404/429/499 with no path predicate and the
robots/sitemap exclusion sits on `request-rejections`; `dependency-failures` drops rows of operations whose request answered
499; `server-response-time` skips deploy windows; ADC's ungated alerts went from six to nine and Store's from six to seven;
the code block's `View` predicates match source and its comments are described as paraphrased), 2026-10-08 (v1.233.0) and
2026-10-02 (v1.221.0, the move of the telemetry code into the partial
`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs`, recorded in ADR-041's Revised 2026-10-01
entry). The code block is condensed from `Extensions.Telemetry.cs:70-150` and `:239-367` (comments paraphrased,
control flow, predicates and API calls as in source, not byte-for-byte). Header: rubric cell trimmed to section 13
(section 31, FinOps, is a recorded scope-out of the series; the cost content in the body stays, grounded in
source).*
- *Entry: `AddServiceDefaults` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:33`, `ConfigureOpenTelemetry()`
  call `:35`). Call sites `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:117` (after
  `ConfigureEndpointsWithHealthProbe` `:88`, `AddCommonSerilog` `:103`, and `AddAzureKeyVaultConfiguration` `:115`, whose
  must-run-before comment is at `:112`; `AddAzureMonitorExporter()` follows at `:122`) and
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:74` (after `AddCommonSerilog` `:73`; logging comment
  `:67-72`, the must-run-before at `:69-71`; `AddAzureMonitorExporter()` at `:79`). Re-counted 2026-10-29: 6 ADC and
  5 Store `Program.cs` files calling `AddServiceDefaults()` (ADC Conference `:117`, Notification `:101`, Engagement `:98`,
  Identity `:114`, Gateway `:70`, UI.Web `:65`; Store Sales `:90`, Identity `:79`, Catalog `:74`, Gateway `:69`, UI.Web `:65`),
  and the same 11 calling `AddAzureMonitorExporter()` (ADC `:122`/`:106`/`:103`/`:119`/`:75`/`:70`; Store `:95`/`:84`/`:79`/
  `:74`/`:70`, same order), no `*ServiceDefaults*.csproj` in either repo (carried).*
- *`ConfigureOpenTelemetry` (`Extensions.Telemetry.cs:70-150`): logging `:72-76`; `.WithMetrics` lambda `:79`; four trace sources
  `:82-85`; probe-knob read `:99`; filtered instrumentation pair `:105-108`, plain pair `:112-113`; `OutboxPollFilterProcessor`
  `:123` (order comment `:116-122`, naming `AddAzureMonitorExporter()`); `ProbeTelemetryFilterProcessor` `:130` (comment
  `:127-129`); sampler comment `:133-138`, guard `:139`, `SetSampler` `:140`; `AddOpenTelemetryExporters()` call `:143`;
  `HostIntegrationMarker(ServiceDefaultsTelemetry)` `:147` (comment `:145-146`). Metrics untouched by the probe filter: `:97-98`.*
- *Metrics: `ConfigureMetrics` `:239`; `ConfigureAspNetCoreMetrics` called `:241`, declared `:351`, knob read `:353`, prefix drop
  `View` `:358-361`, `AddAspNetCoreInstrumentation` `:365`, rationale (73% of both production workspaces' ingestion over
  2026-09-22..28, the figure at `:345`) `:342-348`; HttpClient knob `:250`, why-a-View comment `:252-262` (a host "may also
  register a vendor exporter distro", `AddAzureMonitorExporter()` calling `UseAzureMonitor()`), `View` `:263-267`
  (`string.Equals` predicates `:264-265`), `AddHttpClientInstrumentation` `:271`; runtime knob `:278`, `View` `:283-286`,
  `AddRuntimeInstrumentation` `:290`; meter comment `:293-304` (outbox, CQRS, idempotency, scheduler, broker, output cache,
  best-effort, optimistic-concurrency conflicts at `:302`, AI; no internal-command mention), ten-meter chain `:305-314`
  (InternalCommands `:312`, Persistence `:313`, AI `:314`); Polly rationale `:316-320`, `AddMeter(PollyMeterName)` `:321`,
  duration-histogram reasoning `:323-327`, never-dropped counter `:328-330`, Polly `View` `:331-339` (predicates `:334-336`).
  Constants: `FilterProbeTelemetryConfigKey` `:18`, `EnablePollyDurationMetricsConfigKey` `:24`, `PollyMeterName` `:30`,
  `AiTelemetryName` `:43`, Polly instrument names `:54`/`:57`.*
- *Cost knobs, six: `Telemetry:DisableAspNetCoreMetrics`, `Telemetry:DisableHttpClientMetrics`, `Telemetry:DisableRuntimeMetrics`
  (all via `IsInstrumentationDisabled` `:204`, the three keys named at `:197-199`), `Telemetry:EnablePollyDurationMetrics`
  (`IsInstrumentationEnabled` `:217`, opt-in doc `:207-213`), `Telemetry:TracesSampleRatio` (`TryGetTraceSampleRatio` `:181`, ratio
  1.0 `:183`, key read `:184`, fallback `:185-190`), `Telemetry:FilterProbeTelemetry` (`IsProbeTelemetryFilterEnabled` `:229-230`,
  default-true doc `:220-226`). Deployed values (values unchanged): `Telemetry__TracesSampleRatio` 0.25
  (`MMCA.ADC/infra/main.bicep:281-282`, `MMCA.Store/infra/main.bicep:212-213`); `Telemetry__DisableAspNetCoreMetrics` true (ADC
  `:327-328`, Store `:258-259`), which is why the probe trade-off bullet says probe traffic is on no production dashboard (ADR-041
  Revision 2026-10-01 says the same).*
- *Exporters: `AddOpenTelemetryExporters` `Extensions.Telemetry.cs:163`, OTLP `:165-171`, both-active doc `:160` (doc `:152-162`
  names `AddAzureMonitorExporter()` as an adapter registration made after it). `AddAzureMonitorExporter`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureMonitorExporterExtensions.cs:42`): `ConnectionStringKey`
  `APPLICATIONINSIGHTS_CONNECTION_STRING` `:18`, ordering guard and throw `:44-52`, `HostIntegrationMarker(AzureMonitorExporter)`
  `:56`, no-op without the connection string `:58-61`, `UseAzureMonitor()` `:63`. Tripwire:
  `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs` key `:20`, the Azure Monitor row
  `:64-66`.*
- *`OutboxPollFilterProcessor` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Telemetry/OutboxPollFilterProcessor.cs:17`), `OnEnd`
  `:32`, walk `:42`, `IsSuppressedPoll` `:44`/`:60-64`, `Recorded` cleared `:49`, literals `:26-29`, doc `:13-15`, sync comment
  ending `:25` naming `Extensions.Telemetry.cs`; single `ProjectReference` on `MMCA.Common.Shared`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/MMCA.Common.Aspire.csproj:81`) (carried from 2026-10-22, not flagged by
  the 2026-10-29 audit).*
- *`OutboxProcessor` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs`):
  `PollActivityName` `:75`; `OutboxActivitySource` `:101`; `SetPendingDepth` `:181`;
  `FetchCandidatesAsync` called `:205`, declared `:302`, its poll `StartActivity` `:308`; `CountPendingAsync` called `:206`, declared
  `:270` (saturated-batch guard `:277-280`, its `StartActivity` `:282`); `retries_exhausted` increment `:634-637`;
  `type_unresolvable` increment `:1054-1057` (moved this run), first-attempt transient retry `:1038-1047` (guard `:1040` requires
  `MaxRetries > 1`); still exactly two `DeadLetterCounter` increment sites; `StartOutboxActivity` `:1095`, `StartActivity` `:1107`
  (both moved this run).
  `InternalCommandProcessor` (`.../Persistence/InternalCommands/Processing/InternalCommandProcessor.cs`): `PollActivityName` `:57`,
  `ActivitySource` `:68`, poll `StartActivity` `:235` and `:268`, `InternalCommandExecute` `StartActivity` `:663-666` under an
  explicit parent context built at `:658-661` (carried).*
- *Meter classes (carried from 2026-10-22, not flagged by the 2026-10-29 audit): `CqrsMetrics.cs`
  `:24`/`:29-32`/`:35-38`/`:41-50`/`:53-56`/`:59-62`; `OutboxMetrics.cs` `:19`/`:21`/`:41-44`/`:47-50`/`:57-60`/`:75-79`/`:98-102`/
  `:108`/`:115`; `InternalCommandMetrics.cs` `:20`/`:22`/`:38`/`:48`/`:57`/`:66`/`:75`/`:92`/`:104`; `IdempotencyMetrics.cs`
  (`MMCA.Common.API/Idempotency/`) `:16`/`:19`/`:36-39`/`:41-44`/`:46-49`; `SchedulerMetrics.cs` `:16`/`:19`/`:21`/`:28-31`/
  `:39-42`/`:50-53`; `BrokerMetrics.cs` `:18`/`:21`/`:23`/`:30-33`/`:42-45`; `OutputCacheMetrics.cs` `:16`/`:19`/`:29-32`;
  `BestEffort.cs` `:92-97`/`:102`/`:104`/`:107-110`. New this run, re-read: `ConcurrencyConflictMetrics.cs`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Concurrency/`) class `:24`, `MeterName` `:27`, `entity_type` tag `:33`,
  counter `:37-40`, the two recording sites `:14-17`, no-alert note `:20-21`.*
- *Deployment interval: `Outbox__PollingIntervalSeconds` 300 at `MMCA.ADC/infra/main.bicep:1927`, `:2176`, `:2318`, `:2474` (the
  four service apps) and `MMCA.Store/infra/main.bicep:1589`, `:1767`, `:1903`; default 2 at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxSettings.cs:31` (carried).*
- *SLO alerting (`MMCA.ADC/infra/main.bicep`, every anchor +1 this run, content unchanged): incidents comment `:374-407` (the three
  original pages `:379-388`, scanner pages `:389-393`, `ResultCode` 0 cancellations `:394-396`, scope summary `:397-401`, deploy-skip
  rationale `:402-407`), `sloAlertSpecs` `:408` with six entries: `failed-requests` `:409-417` (query `:412`), `request-rejections`
  `:418-426` (query `:421`, threshold 50 `:424`), `server-response-time` `:427-435` (query `:430` adds `ResultCode != "101"`,
  `isnotempty(Url)`, `n >= 5` and the `deploying == 0` skip), `dependency-failures` `:436-444` (query `:439`, `leftanti` join),
  `resilience-circuit-open` `:448-456` (rationale `:445-447`), `ai-scoring-token-ceiling` `:494-506` (severity 3 `:501`,
  `P2D`/`PT12H` `:502-503`, `enabled: hasAiApiKey` `:505`); `sloAlerts` loop `:509-510`, identity note `:511-512`, `-v2` name
  `:513`; cost rationale `:529-533`, override rationale `:535-538`, `evaluationFrequency` default `:540`, `windowSize` default
  `:542`; `actionGroups` `:566`; `actionGroup` `:358`, `emailReceivers` `:364-370`, `alertEmailAddress` `:124`; gateway metric alert
  `actions` block `:938-942`; `sloWorkbook` `:954`, `loadTextContent` `:963`. Store (`MMCA.Store/infra/main.bicep`):
  `sloAlertSpecs` `:331` (five): `failed-requests` (query `:335`), `request-rejections` (query `:344`), `server-response-time`
  (query `:353`, deploy-skip rationale `:326-330`), `dependency-failures` (query `:362`), `resilience-circuit-open` `:371-379`;
  scope summary `:321-325`; fixed PT15M `:403-404` with rationale `:396-402`; `alertEmailAddress` `:95`.*
- *Ungated extras: ADC TWELVE: `scheduledQueryAlertSpecs` `:624` with eight keys (`outbox-dead-letter` `:626`,
  `sql-dependency-failures` `:632`, `revision-activation-failed` `:638`, `signalr-backplane-errors` `:644` with description and
  `AppTraces` query `:645-646`, `broker-error-queue` `:650` with `:651-652`, `outbox-backlog-age` `:656` (`Max > 900` query `:658`),
  `outbox-broker-circuit-open` `:662` (`broker.circuit.open.count` query `:664`), `live-broadcast-dropped` `:668`; rationale for the
  three new keys `:610-623`), materialized `:675-677`, severity 2 `:682`; `logIngestionCapAlert` `:729` (severity 2 `:736`, PT15M
  over PT1H `:739-740`, `OverQuota`/`ApproachingQuota` query `:745`); `authFailureSpikeAlert` `:797` (severity 2 `:804`) and
  `forbiddenBurstAlert` `:836` (severity 3 `:843`), outside the loop because it pins severity 2 (`:768-769`);
  `gatewayAvailabilityAlert` `:915` (severity 1 `:921`) over `gatewayHealthWebTest` `:882` (`Locations` `:898-902`, `RequestUrl`
  `/health` `:904`). Store SEVEN (every resource +4 this run): `outboxDeadLetterAlert` `:450` (severity 2 `:457`),
  `brokerErrorQueueAlert` `:498` (severity 2 `:505`), `revisionActivationAlert` `:548`, `authFailureSpikeAlert` `:616`,
  `forbiddenBurstAlert` `:656`, `logIngestionQuotaAlert` `:702`, `gatewayAvailabilityAlert` `:783` (severity 1 `:789`),
  `gatewayHealthWebTest` `:750` (`Locations` `:766-770`, `RequestUrl` `:772`). MMCA.Helpdesk has no `infra/` directory (carried
  from 2026-10-22). The alert-to-runbook build gate is left to Article 34.*
- *Records: ADR-062 (`Website/docs-src/adr/062-slo-alerting-as-code.md:4`, accepted 2026-08-01; 2026-08-31 revision `:12-15`;
  2026-10-10 revision `:63` records `request-rejections`, 2026-10-11 `:77` the deploy skip, 2026-10-19 `:83` ADC's security rules
  and `ApproachingQuota`, 2026-10-21 `:84`; carried). ADR-041 (`Website/docs-src/adr/041-observability-and-telemetry.md`): 2026-09-03
  amendment `:28-33`, Revised 2026-09-19 `:49-52`, Revised 2026-09-25 `:53-56`, Revised 2026-10-01 `:57-58` with its body under
  "Revision (2026-10-01)" (the `DisableAspNetCoreMetrics` knob, the move to `Extensions.Telemetry.cs`, probe traffic off production
  dashboards), later revisions 2026-10-06 `:59`, 2026-10-07 `:60`, 2026-10-21 `:61`, 2026-10-24 `:62` (the Azure Monitor exporter
  moved to the `MMCA.Common.Azure` adapter) and 2026-10-26 `:64` (eleven meter subscriptions). Rubric section 13 at
  `Website/docs-src/governance/ArchitectureEvaluationCriteria.md:403`, criteria `:408-413`, weight 2 `:421` (carried).
  Group G16: `### OutboxPollFilterProcessor` at `Website/docs-src/onboarding/group-16-aspire-orchestration.md:1302`.
  Framework v1.265.1 (`MMCA.Common/FACTS.md:14`) / 26 packages (`FACTS.md:19`) / 136 ADRs, range 001-136
  (`Website/docs-src/adr/README.md:6`) this run; the article body states none of these numbers.*

- Full series index: https://ivanball.github.io/writing.html
