# Observability by Default: OpenTelemetry and Azure Monitor in MMCA

> Series: MMCA.Common · Article #48 (deep-dive) · Pillar P2/P3 · Group G16 · Rubric §13,§31 · ADR-041, ADR-062 ·
> Status: grounded in `Website/docs-src/adr/041-observability-and-telemetry.md`,
> `Website/docs-src/adr/062-slo-alerting-as-code.md`,
> `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs` (`ConfigureOpenTelemetry`,
> `ConfigureMetrics`, `AddOpenTelemetryExporters`, `TryGetTraceSampleRatio`, `IsInstrumentationDisabled`,
> `IsInstrumentationEnabled`, `IsProbeTelemetryFilterEnabled`),
> `MMCA.Common.Aspire/Telemetry/OutboxPollFilterProcessor.cs`,
> `MMCA.Common.Application/UseCases/Decorators/CqrsMetrics.cs`,
> `MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxMetrics.cs`,
> `MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandMetrics.cs`,
> `MMCA.Common.Infrastructure/Scheduling/SchedulerMetrics.cs`,
> `MMCA.Common.Infrastructure/Messaging/BrokerMetrics.cs`, `MMCA.Common.API/Caching/OutputCacheMetrics.cs`,
> `MMCA.Common.Application/Services/BestEffort.cs`,
> `MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs`, `MMCA.ADC/infra/main.bicep`,
> `MMCA.Store/infra/main.bicep`,
> `Website/docs-src/onboarding/group-16-aspire-orchestration.md`, and the §13 row of
> `Website/docs-src/governance/ArchitectureEvaluationCriteria.md`. No em dashes.

**Subtitle:** Auto-instrumentation gives you HTTP and runtime signals for free, but it is blind to the
two paths that carry almost all of your framework's own work: the CQRS pipeline and the outbox. Here is
how one shared hosting call wires OpenTelemetry logs, metrics, and traces, ships to the Aspire dashboard
locally and to Azure Monitor in the cloud with no code change, and filters idle poll and probe spans so
telemetry does not quietly become your biggest cloud line item.

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
where auto-instrumentation is blind, and the same cost knobs that fail toward keeping data.

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

Every framework-consuming host calls `AddServiceDefaults()` first in `Program.cs`, and that method calls
`ConfigureOpenTelemetry()` (`Extensions.cs:87`, the call at `:89`) before anything module-specific. So a
host opts in once and every project in the Aspire model inherits the identical telemetry pipeline. There
is no per-app ServiceDefaults copy: all four ADC services and all three Store services consume this one
implementation directly (for example `MMCA.ADC.Conference.Service/Program.cs:103` and
`MMCA.Store.Catalog.Service/Program.cs:72`), as do both gateways and both web UIs.

`ConfigureOpenTelemetry` (`Extensions.cs:170`) does four things.

**It wires logging, metrics, and tracing.** Logs go through the OpenTelemetry logger with
`IncludeFormattedMessage` and `IncludeScopes` on (`Extensions.cs:172-176`) so a scope carries its
structured state. The metrics half is a separate private method, `ConfigureMetrics` (`Extensions.cs:534`,
called through a one-line lambda at `:179`), and it starts from ASP.NET Core instrumentation, always on
(`:536`). Tracing adds four activity sources by name (`:182-185`) and then ASP.NET Core and `HttpClient`
instrumentation (`:205-208` or `:212-213`, depending on a knob below). That is the free
auto-instrumentation floor plus the framework's own sources.

**It instruments only where auto-instrumentation is blind.** Nine framework-owned meters carry custom
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
  `OutboxMetrics` class rather than in the processor (`OutboxMetrics.cs:19`, meter at `:21`), and it carries
  five: a dead-letter counter `outbox.dead_letter.count` (`:41-44`), a success counter
  `outbox.processed.count` (`:47-50`), an end-to-end dispatch-lag histogram in seconds (`:57-60`), an
  `ObservableGauge` for pending depth (`:75-79`) published each cycle from the depth the processor observed
  (`OutboxProcessor.cs:251`), and a second gauge, `outbox.oldest_pending.age` in seconds tagged
  `data_source` (`:98-102`, fed by `SetOldestPendingAge` at `:115`). The two say different things: the
  histogram reports how late the messages that did get delivered were, the age gauge reports how late a
  backlog already is while it is still stuck, which is the number an alert on a wedged outbox fires on
  (`:81-86`). The dead-letter counter has two increment sites, tagged `event_type` and `reason`: an
  unresolvable event type (`OutboxProcessor.cs:752-755`, reason `type_unresolvable`) and an exhausted retry
  budget (`:707-710`, reason `retries_exhausted`). The same activity source emits outbox spans
  (`OutboxProcessor.cs:93`).
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
  trace source (`Extensions.cs:62`, subscribed at `:606`), inert in a host that never adds that package.
  All four publish nothing in a host that stays on the in-process bus, takes no output cache, dispatches no
  best-effort work, and calls no model.

The Aspire defaults subscribe all nine by literal name in one chain (`Extensions.cs:598-606`), with a
comment enumerating what each one carries (`:587-597`), and then subscribe a tenth meter that nobody in
this repo defines: Polly's own (`:613`). The standard resilience handler sits on every `HttpClient` and
every gRPC typed client, so it is the component that decides whether an inter-service call is retried,
timed out, or refused by an open circuit, and `resilience.polly.strategy.events` is what makes a brownout
look like a brownout rather than like latency (`:608-612`).

**It exposes cost knobs that default to safe.** There are five, and only the first two are about volume
for its own sake. `HttpClient` connection and request metrics are on unless
`Telemetry:DisableHttpClientMetrics` is set (`Extensions.cs:545`), and .NET runtime metrics
(`dotnet.gc.*`, `jit.*`, `thread_pool.*`) unless `Telemetry:DisableRuntimeMetrics` is set (`:572`). Both
keys are read by `IsInstrumentationDisabled` (`Extensions.cs:499`), which drops the family only when the
value parses as boolean `true`; absent, blank, or unparseable keeps the instrumentation, so a typo cannot
silently blind a whole metric family. Skipping the `Add` call is not enough on its own, and the source says
why (`:547-556`): a deployed host also calls `UseAzureMonitor()`, and the Azure Monitor distro adds the
`System.Net.Http` meter itself, so the toggle stayed advisory. Each disabled branch therefore installs a
drop `View`, over `System.Net.Http` plus `System.Net.NameResolution` (`:557-561`) and over `System.Runtime`
(`:577-580`); a `View` applies to the whole `MeterProvider` regardless of which component added the meter,
which is what makes the knob authoritative. The third knob is the mirror image: Polly's two duration
histograms are dropped by a `View` unless a host opts in with `Telemetry:EnablePollyDurationMetrics`
(`:43`, read by `IsInstrumentationEnabled` at `:512`, the `View` at `:623-631`), while the
strategy-events counter is never dropped (`:620-622`). Head-based trace sampling is the fourth:
`Telemetry:TracesSampleRatio` (read at `Extensions.cs:479`), parsed by `TryGetTraceSampleRatio`
(`Extensions.cs:476`, called at `:236`), is unset by default so a host samples everything. Set a ratio in
the open interval (0,1) and it installs a `TraceIdRatioBasedSampler` wrapped in a `ParentBasedSampler`
(`Extensions.cs:237`) so a sampled-in request keeps its whole trace intact across service boundaries. A
value that is absent, unparseable, or outside (0,1) falls back to sample-all (`Extensions.cs:478-485`), so
a typo can never silently drop all telemetry.

**It filters idle poll and probe spans out of export.** That is the fifth knob and the sharpest decision in
the file. More on it below.

Then `AddOpenTelemetryExporters` (`Extensions.cs:348`) decides where telemetry goes, from the environment,
with no code change: OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is present (`Extensions.cs:350-356`, the Aspire
dashboard sets it locally) and Azure Monitor via `UseAzureMonitor` when `APPLICATIONINSIGHTS_CONNECTION_STRING`
is present (`Extensions.cs:358-364`, set by the cloud deployment). Both can be active at once
(`Extensions.cs:346`). Local development ships to the Aspire dashboard; production ships to workspace-based
Application Insights; the same binary does both depending on which variable is set.

Here is the shape of the pipeline (condensed from `Extensions.cs:170-243` and `:534-632`, comments trimmed,
body faithful):

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

            // Both processors run before the exporters, so their OnEnd clears Recorded first:
            tracing.AddProcessor(new Telemetry.OutboxPollFilterProcessor());
            if (filterProbeTelemetry)
                tracing.AddProcessor(new Telemetry.ProbeTelemetryFilterProcessor());

            // Off by default; a deployed host opts into head-based sampling:
            if (TryGetTraceSampleRatio(builder.Configuration, out var traceSampleRatio))
                tracing.SetSampler(new ParentBasedSampler(new TraceIdRatioBasedSampler(traceSampleRatio)));
        });

    builder.AddOpenTelemetryExporters(); // OTLP and/or Azure Monitor, by env var
    return builder;
}

private static void ConfigureMetrics(MeterProviderBuilder metrics, IConfiguration configuration)
{
    metrics.AddAspNetCoreInstrumentation();

    // Two highest-volume families, on by default. Disabling drops the whole meter with a View,
    // because the Azure Monitor distro adds these meters itself:
    if (IsInstrumentationDisabled(configuration, "Telemetry:DisableHttpClientMetrics"))
        metrics.AddView(instrument =>
            instrument.Meter.Name is "System.Net.Http" or "System.Net.NameResolution"
                ? MetricStreamConfiguration.Drop
                : null);
    else
        metrics.AddHttpClientInstrumentation();

    if (IsInstrumentationDisabled(configuration, "Telemetry:DisableRuntimeMetrics"))
        metrics.AddView(instrument =>
            instrument.Meter.Name is "System.Runtime" ? MetricStreamConfiguration.Drop : null);
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
        .AddMeter(AiTelemetryName);

    // Polly's meter, minus its two duration histograms unless a host opts in:
    metrics.AddMeter(PollyMeterName);
    if (!IsInstrumentationEnabled(configuration, EnablePollyDurationMetricsConfigKey))
        metrics.AddView(instrument =>
            instrument.Meter.Name == PollyMeterName
            && instrument.Name is PollyAttemptDurationInstrument or PollyPipelineDurationInstrument
                ? MetricStreamConfiguration.Drop
                : null);
}
```

## The one that pays for itself: filtering idle poll spans

The `OutboxProcessor` polls every relational outbox table on a recurring cycle (both deployment templates
push the interval to 300 seconds precisely so idle polls cost less: `Outbox__PollingIntervalSeconds` is set
to `300` on every container app, four in `MMCA.ADC/infra/main.bicep` (`:1591`, `:1812`, `:1950`, `:2102`)
and three in `MMCA.Store/infra/main.bicep` (`:1461`, `:1635`, `:1762`), against the 2-second default in
`OutboxSettings.cs:31`). Each poll runs inside an `OutboxPoll`
activity (`OutboxProcessor.cs:426`, named at `:75`), and under the Azure Monitor distro that span gets a
child SqlClient dependency span for the poll query. A second `OutboxPoll` activity wraps the backlog-depth
count that feeds the pending-depth gauge (`OutboxProcessor.cs:373`, inside `CountPendingAsync` at `:361`),
deliberately reusing the same name so the same filter suppresses it. The internal-command queue drains the
same way, under its own `InternalCommandPoll` name (`InternalCommandProcessor.cs:63`, opened at `:318` and
`:351`). At fleet scale, that steady stream of
idle-poll spans would dominate Application Insights ingestion and spam the local dashboard, telemetry about
nothing happening, priced like something happening.

`OutboxPollFilterProcessor` (`OutboxPollFilterProcessor.cs:17`) is a `BaseProcessor<Activity>` that drops
exactly those spans. Its `OnEnd` (`:32`) walks the ending span's in-process parent chain
(`:42`) and clears the `Recorded` flag (`:49`) as soon as one ancestor matches `IsSuppressedPoll` (`:60-64`),
which is true for two pairs of literals: `OutboxPoll` on source `MMCA.Common.Outbox`, or
`InternalCommandPoll` on source `MMCA.Common.InternalCommands` (`:26-29`). Matching operation name and
source together is what stops an unrelated span that happens to be named "OutboxPoll" from being
suppressed. Clearing `Recorded` makes the batch exporters skip the activity, which is why the processor is
registered before the exporters (`Extensions.cs:221`, ahead of `AddOpenTelemetryExporters()` at `:240`):
its `OnEnd` runs first, and the exporters never see the span. A second processor,
`ProbeTelemetryFilterProcessor`, is registered right behind it under the same ordering requirement
(`:228`), because the inbound filter refuses the probe request span itself while its dependency children
are sampled independently and need un-recording before the exporters look (`:225-227`).

Real work survives untouched. Each per-message `OutboxProcess` span is started under an explicit parent
context rebuilt from the message's stored trace and span ids and passed straight into `StartActivity`
(`OutboxProcessor.cs:808`, the start call at `:820`), so it is never a child of the poll span and never
matched by the parent-chain walk. Per-command `InternalCommandExecute` spans work the same way
(`OutboxPollFilterProcessor.cs:13-15`). The outbox counters, the lag histogram, and the two gauges are
metrics, not spans, so they are unaffected too. You lose the noise and keep the signal.

The poll-span and source literals live on both sides of the package boundary: the filter
(`OutboxPollFilterProcessor.cs:26-29`) and the two processors that emit them, where the outbox declares its
pair across three sites, `PollActivityName` (`OutboxProcessor.cs:75`), the activity source (`:93`), and the
meter name (`OutboxMetrics.cs:19`). They are duplicated on purpose, with a sync comment on both sides
(`OutboxPollFilterProcessor.cs:19-25`, `OutboxMetrics.cs:6-15`), because the Aspire package must not take a
project reference on Infrastructure: its one `ProjectReference` is `MMCA.Common.Shared`, which is what keeps
`AddServiceDefaults` usable from a host that takes no persistence stack. That is the honest price of a
decoupled package graph, and it is a trade-off, not an accident.

## The other half: which signal wakes a human

Everything above is emission. Which of those signals pages somebody, at what threshold, at what severity,
is a separate decision, and for a long time it lived in the deployment templates and an operations runbook
with no record behind it. ADR-062 (`Website/docs-src/adr/062-slo-alerting-as-code.md:4`, accepted
2026-08-01) is that record.

Each consuming app declares its SLO alerts as **data in its Bicep template**. `sloAlertSpecs` is one array
of records carrying `key`, `description`, `query`, `timeAggregation`, `metricMeasureColumn`, `threshold`,
and `severity` (`MMCA.ADC/infra/main.bicep:330`, `MMCA.Store/infra/main.bicep:282`), materialized
one-for-one into Log Analytics `scheduledQueryRules` named `${prefix}-alert-${spec.key}-v2`
(`MMCA.ADC/infra/main.bicep:372,376`) and evaluated every 15 minutes over a 15-minute window (`:390-391`),
a frequency the template's own comment ties to the bill: a scheduled-query rule is billed per evaluation,
and the 5-minute tier costs $1.47 per month per rule against about $0.50 at 15 minutes (`:385-389`). Both
apps declare the same four SLOs with the same numbers: `failed-requests` at severity 2 (`:332-338`),
`server-response-time` at severity 3 (`:341-347`), `dependency-failures` at severity 2 (`:350-356`), and
`resilience-circuit-open` at severity 2 with a threshold of 0 (`:362-368`, Store's at `:314-320`), which
queries the `resilience.polly.strategy.events` instrument for an `OnCircuitOpened` event and so fires on
the first breaker opening rather than on a rate (`:358-360`). An alert
clicked together in the portal is invisible to review, absent from the next environment, and impossible
to diff; an array in the template that provisions the workloads is all three.

**Why log-search rules and not metric alerts.** This is the decision worth stealing. A metric alert on
`requests/failed`, `requests/duration`, or `dependencies/failed` has no status-code or URL predicate, so at
this traffic level it pages on completely routine traffic. A 401 (expired or absent auth) and a 499 (client
disconnected mid-request) both count as failed requests, a long-lived SignalR hub connection reports its
**connection lifetime** as request duration, and a crawler's first contact with a host is a `GET
/robots.txt` followed by a `GET /sitemap.xml`. ADC's own template records three pages that made the case
(`MMCA.ADC/infra/main.bicep:318-327`): one window held eight 401s plus two 499s plus a single readiness 503
and zero other failures, all from one browser session retrying with an expired token; five hub connections
averaging 11.3 seconds dragged the fleet-wide average to 5539ms against a 3000ms threshold with every real
request fast; and twelve robots and sitemap 404s arrived from a single Azure-hosted crawler inside one
15-minute window. A metric alert has no way to say "exclude 401 and 499", "exclude `/hubs/` before
averaging", or "exclude a 404 on `/sitemap.xml`"; a KQL query says exactly that (`:334`, `:343`, `:352`).
Only those codes and the two crawler etiquette paths are excluded, so a genuine 400, 404 or 500 burst
still pages at the same number (`:328-329`). Thresholds and severities are unchanged by the exclusions, so
this is a precision fix, not a sensitivity cut.

**The operational trap: a rule name is an identity.** An incremental ARM deployment never removes a
resource just because it left the template, and a name is how Azure decides whether a deployment updates a
resource or creates a second one. That cuts both ways when a metric alert is superseded by a query rule
covering the same signal: the old resource has to be deleted deliberately, and the replacement must not
reuse its name, or the deployment renames the live metric alert instead of provisioning a rule. So every
generated query rule carries the `-v2` suffix, and the template says in place that the suffix is part of
the rule's identity in Azure and must stay stable (`MMCA.ADC/infra/main.bicep:374-376`). Cheap to respect,
expensive to discover.

Two smaller properties matter as much. Every active rule routes to **one unconditional action group**:
`alertEmailAddress` is a required parameter with no default (`MMCA.ADC/infra/main.bicep:124`, Store's at
`:91`), so the email receiver is never conditional (`:297`, receivers at `:303-307`) and every rule points
at it (`:414`, and the same `actionGroups: [ actionGroup.id ]` line on each ungated rule). An alert wired to
no channel is worse than no alert, because it looks like coverage and pages nobody. And a saved workbook
renders the same signals off the same workspace, embedded at compile time from a JSON file in the repo
(`:701`, `:710`), so the dashboard cannot drift from the alerts by being maintained somewhere else.

The other half of ADR-062 is a build gate that fails when an alert has no severity-matching runbook
section, or when a runbook section outlives its alert. That belongs with the rest of the fitness tier, so
it is Article 34's subject rather than this one's.

Two honest limits. The gate covers only what sits inside the parsed spec window, and both apps provision
alerts outside it, more of them every time an incident teaches something. ADC has four: the
`outbox-dead-letter`, `sql-dependency-failures` and `revision-activation-failed` scheduled query rules
(`scheduledQueryAlertSpecs` at `MMCA.ADC/infra/main.bicep:442`, keys at `:444`, `:450`, `:456`, materialized
at `:463`) and a severity 1 gateway-availability alert (`:662`, severity at `:668`) over a three-location
web test against `/health` (`:629`, locations at `:645-649`, the URL at `:651`). Store has six, each its own
resource: `outboxDeadLetterAlert` (`MMCA.Store/infra/main.bicep:389`, severity 2 at `:396`),
`revisionActivationAlert` (`:439`), `authFailureSpikeAlert` (`:507`), `forbiddenBurstAlert` (`:547`),
`logIngestionQuotaAlert` (`:593`), and its own severity 1 `gatewayAvailabilityAlert` (`:674`, severity at
`:680`) over the same kind of three-location `/health` web test (`:641`). All of them can be added,
renamed, or re-tiered with no runbook consequence. And MMCA.Helpdesk has no `infra/` template at all, so it
has neither the alerts nor anything for a pairing gate to check.

## Trade-offs, honestly

- **The literal names can drift.** The meter, activity-source, and poll-span names are duplicated as string
  literals across the Aspire package (`OutboxPollFilterProcessor.cs:26-29` and the ten `AddMeter` literals
  at `Extensions.cs:598-606` and `:613`) and the defining assemblies (`CqrsMetrics.cs`, `OutboxMetrics.cs`,
  `InternalCommandMetrics.cs`, `IdempotencyMetrics.cs`, `SchedulerMetrics.cs`, `BrokerMetrics.cs`,
  `OutputCacheMetrics.cs`, `BestEffort.cs` and `OutboxProcessor.cs`), plus one name, `Polly`, that no
  assembly here owns at all. Every new meter family widens that surface, and each family lands with the same
  duplicated-literal note in its own doc comment. A rename on one side silently stops the
  matching export or subscription until the literal is updated. The decoupled package graph is worth it;
  the sync discipline is real.
- **Sampling trades trace completeness for cost.** A sampled-out trace is gone, so deep debugging of one
  specific request can miss it. Metrics and logs are unaffected (sampling is trace-only), so RED rates and
  error counts stay whole even at a low ratio. Size the ratio to your debugging horizon, not to zero.
- **Poll-span and probe-span filtering hide steady-state activity by design.** "Is the poller alive and
  looping" and "are the probes passing" are not questions traces answer once both filters are on. Those
  signals live in metrics on purpose, and the metrics that answer them exist: `outbox.processed.count`
  (`OutboxMetrics.cs:47`), the dispatch-lag histogram (`:57`), the pending-depth gauge (`:75`), the
  oldest-pending-age gauge (`:98`) and the dead-letter counter (`:41-44`) on one side, and the untouched
  `http.server.request.duration` and Kestrel instruments on the other (`Extensions.cs:197-198`). If you rely
  on poll or probe spans for a liveness check, chart those instead.
- **Exporters are opt-in per host.** A host that sets neither `OTEL_EXPORTER_OTLP_ENDPOINT` nor
  `APPLICATIONINSIGHTS_CONNECTION_STRING` emits to nothing. And four of the five cost knobs fail toward
  keeping data (higher cost), not toward silence, so a misconfigured ratio is a possible cost surprise,
  never a silent data gap. The exception is deliberate and documented: the probe-telemetry filter defaults
  to on, because probe chatter is ingestion nobody wants billed (`Extensions.cs:515-525`). That is the
  intended bias, but it is a bias worth naming.

## Apply this even without MMCA

The pattern ports to any OpenTelemetry stack, with or without Aspire:

1. **Put the telemetry baseline in one shared bootstrap** every host calls, not in each app. One place to
   change the meter list, tighten a timeout, or add a processor means every service moves in lockstep.
2. **Instrument only where auto-instrumentation is blind.** Let ASP.NET Core, `HttpClient`, and the runtime
   ride the free instrumentation. Add your own meters and activity sources for the paths that carry your
   real work (a use-case pipeline, a background drain), and emit RED from a layer you already have (a
   logging decorator) rather than sprinkling it through every handler.
3. **Make expensive fidelity a knob, not a rewrite.** Gate the highest-volume metric families and
   head-based trace sampling behind configuration, and make every knob fail toward keeping data: drop a
   family only on an explicit boolean, ignore an out-of-range sample ratio, and treat a typo as sample-all.
4. **Check that a metrics toggle is actually authoritative.** If a vendor distro adds a meter behind your
   back, skipping your own `Add` call changes nothing; a drop `View` on the meter applies to the whole
   provider and does.
5. **Filter high-volume low-value spans before export.** A recurring poll, a health-check ping, an idle
   heartbeat: drop them with a processor that clears the `Recorded` flag, registered before your exporters,
   and match on both operation name and source so you never suppress an unrelated span by name alone.
6. **Choose the exporter from the environment.** Ship to a local dashboard when the OTLP endpoint variable is
   set and to your cloud backend when its connection-string variable is set, both at once if you like, so
   the same binary works from laptop to production with no code change.

The takeaway: **observability is a hosting-layer default, not a per-app afterthought. Wire the useful signal
once for every host, instrument the paths auto-instrumentation cannot see, and make the expensive fidelity a
knob that fails toward data, because the two ways this goes wrong in production are a telemetry bill you did
not expect and a trace that cannot answer the question you actually have.**

---

**What we covered:** why auto-instrumentation is structurally blind to the CQRS pipeline and the outbox, how
one `ConfigureOpenTelemetry` call in the shared Aspire defaults wires logs, metrics, and traces plus nine
framework meters (`MMCA.Common.Cqrs` RED histograms plus its cache and short-circuit counters, the
`MMCA.Common.Outbox` counters, histogram and two gauges, the `MMCA.Common.InternalCommands` drain
instruments, the `MMCA.Common.Idempotency` counters, the
`MMCA.Common.Scheduler` run, duration and lag instruments, and the `MMCA.Common.Broker`,
`MMCA.Common.OutputCache`, `MMCA.Common.BestEffort` and `MMCA.Common.AI` streams) plus Polly's resilience
meter on
every host, how five
cost knobs (`Telemetry:DisableHttpClientMetrics`, `Telemetry:DisableRuntimeMetrics`,
`Telemetry:EnablePollyDurationMetrics`, `Telemetry:TracesSampleRatio` and `Telemetry:FilterProbeTelemetry`)
trim spend without going dark, why a drop `View` is what makes a metrics toggle authoritative over the
Azure Monitor distro, how `OutboxPollFilterProcessor` drops idle poll spans from two drains before export
while real work survives, how the exporter (OTLP or Azure Monitor, or
both) is chosen from environment variables with no code change, and how the SLO alerts that actually page
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

*Notes: verified type/behavior names with path:line (re-read this run). The code block is condensed from
`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:170-243` and `:534-632` (comments trimmed,
control flow and API calls faithful, not byte-for-byte); it was re-cut this run because the metrics half
moved out of the `WithMetrics` lambda into a private `ConfigureMetrics` method, the meter chain grew to ten
`AddMeter` calls, the two metrics knobs gained drop `View`s, and tracing gained a second source pair, a
probe-filter branch and a second processor.*
- *`ConfigureOpenTelemetry` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:170`, ending `:243`), called from
  `AddServiceDefaults` (`Extensions.cs:87`, call at `:89`). Logging `IncludeFormattedMessage`/`IncludeScopes` (`:172-176`).*
- *Metrics: `ConfigureMetrics` (`Extensions.cs:534`) invoked from `.WithMetrics(...)` (`:179`);
  `AddAspNetCoreInstrumentation()` unconditional (`:536`); `Telemetry:DisableHttpClientMetrics` branch (`:545`) with the
  `System.Net.Http` + `System.Net.NameResolution` drop `View` (`:557-561`) and the comment explaining why skipping the
  `Add` is not enough (`:547-556`), else `AddHttpClientInstrumentation()` (`:565`); `Telemetry:DisableRuntimeMetrics`
  branch (`:572`) with the `System.Runtime` drop `View` (`:577-580`), else `AddRuntimeInstrumentation()` (`:584`);
  nine MMCA.Common meters chained at `:598-606` (`MMCA.Common.Outbox`, `.Cqrs`, `.Idempotency`, `.Scheduler`, `.Broker`,
  `.OutputCache`, `.BestEffort`, `.InternalCommands`, and `AiTelemetryName` = `"MMCA.Common.AI"` declared at `:62`), the
  enumerating comment at `:587-597`; Polly's meter `AddMeter(PollyMeterName)` (`:613`, constant `:49`, rationale `:608-612`)
  with its two duration histograms dropped by a `View` unless `Telemetry:EnablePollyDurationMetrics` is set
  (key `:43`, `IsInstrumentationEnabled` `:512`, `View` `:623-631`, the never-dropped events counter noted at `:620-622`).
  The meter count, the bullet list, the code block, the literal-drift trade-off and the "what we covered" paragraph were
  rewritten this run around ten `AddMeter` calls (nine MMCA.Common plus Polly), up from the seven this article carried.*
- *Tracing: four sources at `Extensions.cs:182-185` (`ApplicationName`, `"MMCA.Common.Outbox"`, `"MMCA.Common.InternalCommands"`,
  `AiTelemetryName`); `IsProbeTelemetryFilterEnabled` (`:199`, helper `:524`) selects filtered
  `AddAspNetCoreInstrumentation`/`AddHttpClientInstrumentation` with `ProbeTelemetryFilter` predicates (`:205-208`) or the
  plain pair (`:212-213`); `.AddProcessor(new Telemetry.OutboxPollFilterProcessor())` (`:221`) and, when the knob is on,
  `ProbeTelemetryFilterProcessor` (`:228`), both ahead of `builder.AddOpenTelemetryExporters()` (`:240`), with the
  registration-order reasoning in the comments at `:216-220` and `:225-227`;
  `SetSampler(new ParentBasedSampler(new TraceIdRatioBasedSampler(traceSampleRatio)))` (`:237`), guarded at `:236`.
  Metrics are deliberately untouched by the probe filter (`:197-198`).*
- *Cost knobs, five: `Telemetry:FilterProbeTelemetry` (key `:37`, `IsProbeTelemetryFilterEnabled` `:524`, the only one that
  defaults to true), `Telemetry:EnablePollyDurationMetrics` (key `:43`, opt-in, `IsInstrumentationEnabled` `:512`),
  `Telemetry:DisableHttpClientMetrics` and `Telemetry:DisableRuntimeMetrics` (both read by `IsInstrumentationDisabled` `:499`,
  which drops only on a parsed boolean `true`), and `Telemetry:TracesSampleRatio` (`TryGetTraceSampleRatio` `:476`, default
  ratio 1.0 `:478`, key read `:479`, returns false unless the value is in the open interval (0,1) `:480-485`). The
  probe knob and the Polly knob are new to this article.*
- *Exporters: `AddOpenTelemetryExporters` (`Extensions.cs:348`) enables OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` set (`:350-356`)
  and Azure Monitor via `UseAzureMonitor()` when `APPLICATIONINSIGHTS_CONNECTION_STRING` set (`:358-364`); both can be active (`:346`).*
- *`OutboxPollFilterProcessor : BaseProcessor<Activity>` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Telemetry/OutboxPollFilterProcessor.cs:17`);
  four literals at `:26-29` (`OutboxActivitySourceName` / `PollActivityName` / `InternalCommandsActivitySourceName` /
  `InternalCommandsPollActivityName`); `OnEnd` null-safe (`:32-38`), walks parent chain (`:42`), tests `IsSuppressedPoll`
  (`:44`, method `:60-64`, which matches either poll family on operation name AND source), clears
  `ActivityTraceFlags.Recorded` (`:49`). The doc comment names per-message `OutboxProcess` and per-command
  `InternalCommandExecute` spans as the protected work (`:10-15`) and the sync comment names the four Infrastructure-side
  symbols plus the package's one `ProjectReference` on `MMCA.Common.Shared` (`:19-25`). Corrected this run: the processor
  suppresses two poll families, not one.*
- *`CqrsMetrics` (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CqrsMetrics.cs:21`); `MeterName = "MMCA.Common.Cqrs"` (`:24`),
  `Meter` (`:26`); `cqrs.command.duration` histogram in `ms` (`:29-32`); `cqrs.query.duration` histogram in `ms` (`:35-38`);
  `cqrs.query.cache.hit` (`:41-44`) / `cqrs.query.cache.miss` (`:47-50`) counters; `cqrs.authorization.denied.count` (`:53-56`) and
  `cqrs.timeout.count` (`:59-62`), both tagged `request_type`.*
- *`OutboxMetrics` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxMetrics.cs:16`), which with
  `OutboxProcessor` moved under `Persistence/Outbox/Processing/` this run (`OutboxSettings.cs` under `Persistence/Outbox/Administration/`;
  ADR-041's 2026-09-03 amendment records the move): `MeterName = "MMCA.Common.Outbox"` (`:19`), `Meter` (`:21`),
  `outbox.dead_letter.count` (`:41-44`), `outbox.processed.count` (`:47-50`), `outbox.dispatch.lag` histogram in seconds (`:57-60`),
  `outbox.pending.depth` `ObservableGauge` (`:75-79`) with `SetPendingDepth` (`:108`), and a fifth instrument new to this article,
  `outbox.oldest_pending.age` `ObservableGauge<double>` tagged `data_source` (`:98-102`) with `SetOldestPendingAge` (`:115`), described
  in source as the number an alert on a wedged outbox fires on (`:81-86`); sync comment (`:6-15`).*
- *`OutboxProcessor` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs`):
  `PollActivityName = "OutboxPoll"` (`:75`); `OutboxActivitySource = new("MMCA.Common.Outbox")` (`:93`); dead-letter increments at
  `:752-755` (reason `type_unresolvable`) and `:707-710` (reason `retries_exhausted`), both tagged `event_type`;
  `OutboxMetrics.SetPendingDepth` (`:251`) fed by `CountPendingAsync` (`:361`, called at `:284`), whose own
  `StartActivity(PollActivityName)` (`:373`) deliberately reuses the poll name so the same filter suppresses it; poll
  `StartActivity(PollActivityName)` (`:426`); per-message span started in `StartOutboxActivity` (`:808`) from a parent
  `ActivityContext` rebuilt from the stored trace and span ids, passed to `StartActivity` (`:820`). Behavior unchanged;
  every anchor moved this run.*
- *`InternalCommandMetrics` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandMetrics.cs`):
  `MeterName = "MMCA.Common.InternalCommands"` (`:20`), `Meter` (`:22`), processed (`:38`), failed (`:48`) and dead-letter (`:57`)
  counters, duration (`:66`) and lag (`:75`) histograms, pending-depth (`:92`) and oldest-due-age (`:104`) gauges;
  `InternalCommandProcessor.PollActivityName = "InternalCommandPoll"` (`:63`), its `ActivitySource` (`:83`) and the two poll
  `StartActivity` sites (`:318`, `:351`). New to this article; the queue itself is Article 51's subject.*
- *`SchedulerMetrics` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/SchedulerMetrics.cs:16`):
  `MeterName = "MMCA.Common.Scheduler"` (`:19`), `Meter` (`:21`), `scheduler.job.runs` counter tagged by job and outcome (`:28-31`),
  `scheduler.job.duration` histogram in seconds (`:39-42`), `scheduler.job.lag` histogram in seconds (`:50-53`). The scheduler
  itself is ADR-074 (`Website/docs-src/adr/074-recurring-job-scheduler.md`), which this article only references in passing.*
- *The opt-in meter families, each carrying the same duplicated-literal note in its own doc comment:
  `BrokerMetrics` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMetrics.cs:18`), `MeterName = "MMCA.Common.Broker"` (`:21`),
  `Meter` (`:23`), `broker.fault.count` tagged `event_type` (`:30-33`) and `broker.circuit.open.count` (`:42-45`), the meter introduced by ADR-087
  (`Website/docs-src/adr/087-broker-poison-message-handling.md`); `OutputCacheMetrics`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheMetrics.cs:16`), `MeterName = "MMCA.Common.OutputCache"` (`:19`),
  `cache.eviction.failed` tagged `cache_tag` (`:29-32`) with `RecordEvictionFailure` (`:36-37`); `BestEffortMetrics`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/BestEffort.cs:99`), `MeterName = "MMCA.Common.BestEffort"` (`:102`),
  `besteffort.dispatch.failed` tagged `operation` (`:107-110`) with `RecordFailure` (`:114-115`), the reason it is a separate meter
  rather than a counter on `MMCA.Common.Cqrs` recorded in its own doc comment (`:92-97`); and the optional AI package's single
  telemetry name (`Extensions.cs:62`, doc comment `:51-61`).*
- *Deployment interval: `Outbox__PollingIntervalSeconds` is set to `300` on every container app, four in `MMCA.ADC/infra/main.bicep`
  (`:1591`, `:1812`, `:1950`, `:2102`) and three in `MMCA.Store/infra/main.bicep` (`:1461`, `:1635`, `:1762`), against the
  `PollingIntervalSeconds` default of 2 in
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxSettings.cs:31`. Value and default
  unchanged this run; both templates and the settings file moved.*
- *`IdempotencyMetrics` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyMetrics.cs:16`);
  `MeterName = "MMCA.Common.Idempotency"` (`:19`); `idempotency.replayed` (`:36-39`), `idempotency.conflict` tagged by `kind` (`:41-44`),
  `idempotency.degraded` (`:46-49`).*
- *SLO alerting section: ADR-062 (`Website/docs-src/adr/062-slo-alerting-as-code.md:4`, accepted 2026-08-01). `sloAlertSpecs`
  (`MMCA.ADC/infra/main.bicep:330`, `MMCA.Store/infra/main.bicep:282`), four specs this run: `failed-requests` severity 2 (`:332-338`),
  `server-response-time` severity 3 (`:341-347`), `dependency-failures` severity 2 (`:350-356`) and the new
  `resilience-circuit-open` severity 2, threshold 0, over `resilience.polly.strategy.events` (`:362-368`, rationale `:358-360`;
  Store's at `:314-320`); the KQL exclusions (`:334`, `:343`, `:352`) and the summary of what stays in scope (`:328-329`); the
  three false-page incidents in the template's own comment (`:318-327`: eight 401s plus two 499s plus one 503 at `:319-321`, five hub
  connections averaging 11.3s against 5539ms vs a 3000ms threshold at `:322-324`, and twelve robots/sitemap 404s from one
  Azure-hosted crawler at `:325-327`); `sloAlerts` loop (`:372`), `-v2` name (`:376`) and the identity note that keeps it stable
  (`:374-375`); `evaluationFrequency` PT15M (`:390`) over `windowSize` PT15M (`:391`) with the 2026-09-02 FinOps rationale and its
  $1.47 vs about $0.50 per rule per month figures (`:385-389`; Store `:345-346`); routed to the action group (`:414`); required
  `alertEmailAddress` (`:124`, Store `:91`), unconditional action group (`:297`, `emailReceivers` `:303-307`,
  `emailAddress: alertEmailAddress` at `:306`); `sloWorkbook` (`:701`) embedding its JSON via `loadTextContent` at compile time
  (`:710`). Ungated extras, ADC four: `scheduledQueryAlertSpecs` (`:442`) carrying `outbox-dead-letter` (`:444`),
  `sql-dependency-failures` (`:450`) and `revision-activation-failed` (`:456`), materialized at `:463`, plus
  `gatewayAvailabilityAlert` (`:662`, `severity: 1` at `:668`) over `gatewayHealthWebTest` (`:629`, three `Locations` `:645-649`,
  `RequestUrl` ending `/health` at `:651`). Store six, each a separate resource: `outboxDeadLetterAlert` (`:389`, `severity: 2`
  at `:396`), `revisionActivationAlert` (`:439`), `authFailureSpikeAlert` (`:507`), `forbiddenBurstAlert` (`:547`),
  `logIngestionQuotaAlert` (`:593`) and `gatewayAvailabilityAlert` (`:674`, `severity: 1` at `:680`) over
  `gatewayHealthWebTest` (`:641`). Corrected this run: the superseded metric-alert declarations are gone from both templates
  (ADR-062's 2026-08-31 revision, `:12-15`), so the subsection that described them as disabled-in-place is rewritten around the
  `-v2` names, which is what actually keeps the supersede safe; the SLO count moved from three to four; the evaluation frequency
  moved to PT15M; a third false-page incident is on record; and the ungated-extras counts moved to four and six. MMCA.Helpdesk
  has no `infra/` directory. The alert-to-runbook build gate is deliberately left to Article 34.*
- *ADR-041 (`Website/docs-src/adr/041-observability-and-telemetry.md`), Accepted 2026-07-10, with amendments through
  2026-09-11 and a Revision dated 2026-09-19 that records `MMCA.Common.AI` as subscribed in the meter chain and added as a trace
  source, "so the block carries ten subscribed meters: nine `MMCA.Common.*` plus `Polly`" (`:49-52`); the 2026-09-03 amendment
  records the probe-telemetry knob, the metric-drop views and the move of the outbox processor and its metrics under
  `Persistence/Outbox/Processing/` (`:28-33`). Rubric §13 Observability & Operability starts at
  `Website/docs-src/governance/ArchitectureEvaluationCriteria.md:403`, criteria including poll-span noise control at `:408-413`,
  default weight 2 at `:421`. Group G16: the `OutboxPollFilterProcessor` walkthrough is at
  `Website/docs-src/onboarding/group-16-aspire-orchestration.md:1233`. The "no per-app ServiceDefaults copy" claim is cited to call
  sites (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:103`,
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:72`).
  Framework v1.205.0 (`MMCA.Common/FACTS.md:14`) / 19 packages (`FACTS.md:19`) / 125 ADRs, range 001-125
  (`Website/docs-src/adr/README.md:6`) this run.*

- Full series index: https://ivanball.github.io/writing.html
