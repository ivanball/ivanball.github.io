# ADR-041: Observability and Telemetry Strategy

## Status
Accepted (2026-07-10). Amended (2026-07-23) to document the `Telemetry:DisableHttpClientMetrics` and
`Telemetry:DisableRuntimeMetrics` cost knobs and to correct the meter/activity-source literal
citations. Amended (2026-07-25) to describe how the CQRS logging decorators actually record duration
(a per-path `RecordDuration` helper, not a `finally`) and to rebase the decorator outcome-tag, outbox
poll-span, and `OutboxProcess` parent-context citations onto their current lines. Amended
(2026-07-28) to rebase the Aspire service-defaults citations (the sampling and cost-knob helpers, the
two exporter reads) and the outbox dead-letter increment onto their current lines. Amended
(2026-08-01) to rebase the ASP.NET Core/`HttpClient` tracing citation, the CQRS duration-literal
citations, the outbox poll-span-filter clear statement, the outbox meter/counter/activity-source
declarations, the dead-letter increment call site, the poll-span open site, the `OutboxProcess`
span-start site, and the correlation-id response-header citation onto their current lines. Amended
(2026-08-07) to record that the outbox meter and dead-letter counter now live in a dedicated
`OutboxMetrics` type rather than in `OutboxProcessor`, to document the second dead-letter increment
on the retries-exhausted path and the `reason` tag that separates the two, and to rebase the Aspire
service-defaults, CQRS metric-literal, and outbox span citations onto their current lines. Amended
(2026-08-18) to record two new meter families (`MMCA.Common.OutputCache`, `MMCA.Common.BestEffort`), to
correct the meter inventory this record has been under-reporting, and to note that the correlation id
now starts one hop earlier, at the Gateway; see the Revision (2026-08-18) at the end. Amended
(2026-08-31) to record the application logging pipeline (Serilog as one additional provider beside the
OpenTelemetry one, never a replacement `ILoggerFactory`), its level and file-sink policy, the pre-DI
bootstrap logger, and which hosts adopt it; see the Amended (2026-08-31) section at the end. Amended
(2026-09-03): `MMCA.Store.UI.Web` now calls `AddCommonSerilog` instead of hand-rolling the same
configuration inline, so the "defaults exist in two shapes" cost that amendment recorded is gone and
eight hosts share one helper; its `Program.cs` citations and the per-host `AddCommonSerilog` /
bootstrap-factory line anchors are rebased onto their current lines. Amended again (2026-09-03) to
record the probe-telemetry cost knob (`Telemetry:FilterProbeTelemetry`, the one knob that is on by
default) and the metric-drop views that make the two metrics knobs authoritative over the Azure
Monitor distro, and to rebase the Aspire service-defaults, CQRS decorator and outbox citations (the
outbox processor and its metrics now live under `Persistence/Outbox/Processing/`) onto their current
lines; see the "Amended (2026-09-03): probe telemetry" section at the end.
Revised 2026-09-07 (the Log Analytics daily cap gained a cap-reached alert in both apps, SQL
auditing and resource diagnostics are deployed in ADC and Store, Store alerts on a security signal,
and Store scrubbed email addresses out of stored reviewer names).
Revised 2026-09-11 (the meter subscription block carries eight meters now, the eighth being
`MMCA.Common.InternalCommands`, which also adds a second trace source and a second poll span the
poll filter drops; the `MMCA.Common.AI` meter is defined but not subscribed there; and every
`Extensions.cs` and CQRS-decorator citation is rebased onto its current line. See the Revision
(2026-09-11) at the end).
Amended again (2026-09-11) to record a ninth subscribed meter, `Polly`, with the
`Telemetry:EnablePollyDurationMetrics` cost knob that keeps its two duration histograms off by
default, and to record that the CQRS logging decorators now log a thrown exception at Warning without
the exception object while their duration histograms and outcome tags stay exactly as this record
describes them. The eight-meter count in the entry above is superseded, and the metrics configuration
moved into its own `ConfigureMetrics` method, so the subscription block no longer sits at the lines
the earlier entries cite. See the "Amended (2026-09-11): the Polly meter" section at the end.
Revised 2026-09-19 (`MMCA.Common.AI` is now subscribed in the meter chain and added as a trace
source, so the block carries ten subscribed meters: nine `MMCA.Common.*` plus `Polly`. Both
2026-09-11 entries above are superseded on those two points, the one that records the AI meter as
defined but not subscribed and the one that counts nine. See the Revision (2026-09-19) at the end).
Revised 2026-09-25 (`MMCA.ADC.UI.Web` now calls `AddCommonSerilog` as well, so nine hosts share the
helper and the two Gateways are the only hosts without Serilog; the per-host `AddCommonSerilog`,
bootstrap-factory and call-order citations in the Amended (2026-08-31) section are rebased onto their
current lines. The "eight hosts" count in the first 2026-09-03 entry above is superseded).
Revised 2026-10-01 (ASP.NET Core metrics are now behind a third cost knob,
`Telemetry:DisableAspNetCoreMetrics`, which both production deployments turn on; see Revision below).
Revised 2026-10-06: the correlation middleware also discards a non-printable-ASCII id, Store's auth alert counts 401 and 429, the bootstrap logger factory lives until the host exits, and `GlobalExceptionHandler` writes its Error row only on its 500 path (cross-tenant and bad-request rejections log Warning).

## Context
The framework is a modular monolith whose modules extract into standalone services (ADR-008), so
the same telemetry has to make sense whether a request stays in one process or crosses a gateway and
several service hosts. OpenTelemetry auto-instrumentation (ASP.NET Core, `HttpClient`, the .NET
runtime) gives generic HTTP and runtime signals for free, but it is blind to the two paths that carry
almost all of the framework's own work: the CQRS use-case pipeline (ADR-014) and the outbox
(ADR-003). "How long is this command taking and how often does it fail" and "is the outbox
dead-lettering" are not questions auto-instrumentation can answer.

Two cost forces pull the other way. A deployed fleet polls every relational outbox around the clock,
so idle poll spans would dominate Application Insights ingestion if exported, and full-fidelity
tracing is the single largest observability line item. The framework needs custom instrumentation
where auto-instrumentation is blind, plus knobs that cut telemetry cost without going dark. This
cross-cutting observability decision was implemented but named by no existing ADR; this record
captures it.

## Decision
Standardize telemetry in the shared Aspire service defaults, add framework-specific instrumentation
for the CQRS and outbox paths, and expose cost knobs with fail-safe defaults.

- **One shared telemetry baseline on every host.** `ConfigureOpenTelemetry`
  (`Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:71`) wires OpenTelemetry logging with
  formatted messages and scopes (`Extensions.Telemetry.cs:73`, the two flags at `:75`-`:76`), metrics
  from ASP.NET Core, `HttpClient` and the runtime (each gated behind a cost knob, see below), and
  tracing from ASP.NET Core and `HttpClient`, added either with the probe-telemetry filters attached
  (`Extensions.Telemetry.cs:106`-`:109`) or plain (`Extensions.Telemetry.cs:113`-`:114`) depending on
  the knob the Amended (2026-09-03) section records. It is called from `AddServiceDefaults`
  (`Source/Hosting/MMCA.Common.Aspire/Extensions.cs:32`), so a host opts in once and
  every project in the Aspire model inherits the same pipeline.

- **Custom RED metrics from the CQRS pipeline.** A single meter `MMCA.Common.Cqrs`
  (`Source/Core/MMCA.Common.Application/UseCases/Decorators/CqrsMetrics.cs:24`) publishes two duration
  histograms: `cqrs.command.duration` (`CqrsMetrics.cs:30`) and `cqrs.query.duration`
  (`CqrsMetrics.cs:36`), both in milliseconds. Every path is measured without a `finally`: each
  logging decorator routes all three of its exits through a private `RecordDuration` helper, so the
  measurement cannot be skipped. The command helper calls `CqrsMetrics.CommandDuration.Record(...)`
  tagged by `command` and `outcome`
  (`Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingCommandDecorator.cs:98`, in the
  `RecordDuration` helper declared at `:97`) and the query helper does the same for `QueryDuration`
  (`Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingQueryDecorator.cs:92`, helper at
  `:91`).
  The `outcome` tag takes `completed`, `failed` (a `Result` failure), or `exception`, one call site per
  path (`LoggingCommandDecorator.cs:54`, `:49`, `:76`; the query equivalents at
  `LoggingQueryDecorator.cs:51`, `:46`, `:69`), so count gives rate, the tag gives errors, and the
  histogram gives duration. The Aspire host subscribes the meter by literal name
  (`Extensions.Telemetry.cs:308`).

- **An outbox dead-letter counter.** The outbox instruments live in their own static type
  (`Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxMetrics.cs:16`), which
  owns the meter `MMCA.Common.Outbox` (`OutboxMetrics.cs:19`) and the counter `outbox.dead_letter.count`
  (`OutboxMetrics.cs:41`-`OutboxMetrics.cs:42`). `OutboxProcessor`
  (`Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs`) increments
  it on both dead-letter paths, tagged by `event_type` and by a `reason` that tells them apart:
  `type_unresolvable` when a message's event type cannot be resolved and the row has been attempted before
  (`OutboxProcessor.cs:675`-`OutboxProcessor.cs:678`; on the row's first attempt, `RetryCount` 0, it is
  retried once as transient at `OutboxProcessor.cs:664`-`OutboxProcessor.cs:671`, unless `MaxRetries` is 1 or less), and
  `retries_exhausted` when a failing message reaches `MaxRetries` and drops out of the poll
  (`OutboxProcessor.cs:625`-`OutboxProcessor.cs:628`). The processor's activity source publishes outbox
  spans under the same name (`OutboxProcessor.cs:88`); both the meter and the trace source are
  registered by literal name in the Aspire defaults (`Extensions.Telemetry.cs:307`,
  `Extensions.Telemetry.cs:84`).

- **Correlation-ID middleware ties the request together.** `CorrelationIdMiddleware`
  (`Source/Presentation/MMCA.Common.API/Middleware/CorrelationIdMiddleware.cs:20`) uses the
  `X-Correlation-ID` header (`CorrelationIdMiddleware.cs:23`), reading it from the request
  (`CorrelationIdMiddleware.cs:40`; a blank header counts as absent, a supplied id is cut to 64
  characters, `CorrelationIdMiddleware.cs:26`, `:63`, and a cut id holding any character outside
  printable ASCII is discarded, `:64`, because Kestrel refuses to echo it in a response header) or
  falling back to the current W3C trace id and then to `HttpContext.TraceIdentifier`
  (`CorrelationIdMiddleware.cs:41`-`:43`), sets it on the scoped `ICorrelationContext`
  (`CorrelationIdMiddleware.cs:45`), and echoes it on the response
  (`CorrelationIdMiddleware.cs:48`, inside the `OnStarting` callback registered at
  `CorrelationIdMiddleware.cs:46`). The CQRS logging decorators stamp that same id into every log
  scope (read at `LoggingCommandDecorator.cs:26`, stamped by `BeginCommandScope` at `:32`), so logs,
  the correlation id, and the trace id line up for one request.

- **Three high-volume metric families gated behind cost knobs, on by default.** ASP.NET Core metrics
  (`http.server.*`, `kestrel.*`, `aspnetcore.*`, `signalr.server.*`) are added only when
  `Telemetry:DisableAspNetCoreMetrics` is unset or false (`ConfigureAspNetCoreMetrics`,
  `Extensions.Telemetry.cs:352`, knob read at `:354`, adding instrumentation at `:366`), `HttpClient`
  connection and request metrics only when `Telemetry:DisableHttpClientMetrics` is unset or false
  (`Extensions.Telemetry.cs:254`, adding instrumentation at `:274`), and .NET runtime metrics
  (`dotnet.gc.*`, `jit.*`, `thread_pool.*`) only when `Telemetry:DisableRuntimeMetrics` is unset or
  false (`Extensions.Telemetry.cs:281`, adding at `:293`). Skipping the instrumentation is not enough
  on its own, so each disabled branch also drops the whole meter family with a `View`
  (`Extensions.Telemetry.cs:359`-`:362` for every meter under the `Microsoft.AspNetCore.` prefix,
  `:266`-`:270` for `System.Net.Http` plus `System.Net.NameResolution`, `:286`-`:289` for
  `System.Runtime`): the Azure Monitor distro adds those meters itself, and a `View` applies to the
  whole `MeterProvider` regardless of which component added them, which is what makes each knob
  authoritative rather than advisory. All three keys are read by `IsInstrumentationDisabled`
  (`Extensions.Telemetry.cs:208`-`:209`), which drops the family only when the value parses as boolean `true`; absent,
  blank, or unparseable falls back to keeping the instrumentation, so a typo cannot silently blind a
  whole metric family. A deployed host sets any of them to `true` to cut ingestion cost; outbound
  dependency latency is still captured as traces when `HttpClient` metrics are dropped, and request
  latency and failures still come from the request traces when ASP.NET Core metrics are dropped. Both
  production deployments set `Telemetry__DisableAspNetCoreMetrics` to `true`
  (`MMCA.ADC/infra/main.bicep:324`-`:325`, `MMCA.Store/infra/main.bicep:253`-`:254`), so neither
  exports the ASP.NET Core meter family.

- **Head-based sampling as a cost knob, off by default.** `Telemetry:TracesSampleRatio`
  (`Extensions.Telemetry.cs:137`, parsed by `TryGetTraceSampleRatio` at `Extensions.Telemetry.cs:185`,
  which reads the key at `Extensions.Telemetry.cs:188`) is unset by default, so a host samples everything and behavior does not
  change. A deployed host sets a ratio in
  the open interval (0,1) to keep that fraction of traces; the value wraps a `TraceIdRatioBasedSampler`
  in a `ParentBasedSampler` (`Extensions.Telemetry.cs:138`) so a sampled-in request keeps its whole
  trace across service boundaries. A key that is absent, unparseable, or outside (0,1) falls back to
  sample-all (`Extensions.Telemetry.cs:189`-`:194`), so a typo can never silently drop all telemetry.

- **Outbox poll spans are filtered out of export.** `OutboxPollFilterProcessor`
  (`Source/Hosting/MMCA.Common.Aspire/Telemetry/OutboxPollFilterProcessor.cs:17`), registered before
  the exporters (`Extensions.Telemetry.cs:122`), clears the `Recorded` flag on the recurring `OutboxPoll` span
  and its children (`OutboxPollFilterProcessor.cs:49`), and on the internal-command queue's
  `InternalCommandPoll` span the same way (`OutboxPollFilterProcessor.cs:60`-`:64`). The poll query runs inside that span, opened at
  the top of `FetchCandidatesAsync` (`OutboxProcessor.cs:327`, span started at `OutboxProcessor.cs:333`,
  named at `OutboxProcessor.cs:70`), and the backlog count in `CountPendingAsync` runs inside a second
  span of the same name (`OutboxProcessor.cs:268`, started at `OutboxProcessor.cs:280`), so
  steady-state polling does not flood Application Insights. Real
  outbox work is untouched: each per-message `OutboxProcess` span is started by `StartOutboxActivity`
  (called once per message at `OutboxProcessor.cs:512`, declared at `OutboxProcessor.cs:716`) under an
  explicit parent context restored from the message's stored trace and span ids
  (`OutboxProcessor.cs:723`-`OutboxProcessor.cs:726`), span started at
  `OutboxProcessor.cs:728`-`OutboxProcessor.cs:731`, so it is never a child of the poll span.

- **Dual exporters, either or both.** `AddOpenTelemetryExporters` enables OTLP when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is present (`Extensions.Telemetry.cs:161`-`:162`, the Aspire dashboard sets it, exporter
  wired at `Extensions.Telemetry.cs:166`) and Azure Monitor via `UseAzureMonitor` (`Extensions.Telemetry.cs:174`) when
  `APPLICATIONINSIGHTS_CONNECTION_STRING` is present (read at `Extensions.Telemetry.cs:169`-`:170`, checked at
  `Extensions.Telemetry.cs:172`, and set by the cloud deployment). Both can be active at once
  (`Extensions.Telemetry.cs:157`, on the method at `:159`), so local development ships to the
  Aspire dashboard and production ships to workspace-based Application Insights with no code change.

## Rationale
- **Instrument only where auto-instrumentation is blind.** The CQRS RED histograms and the outbox
  dead-letter counter cover the two framework-owned hot paths; everything else (HTTP, runtime) rides
  the free auto-instrumentation, so the custom surface stays small.
- **RED at the decorator, not in every handler.** The CQRS pipeline already wraps every handler in a
  logging decorator (ADR-014), so recording duration and outcome there makes metrics a byproduct of a
  pipeline layer that exists, with no per-handler discipline (the invariant-over-discipline posture, ADR-015).
- **A single correlation id with a W3C fallback.** Whether or not a client supplies
  `X-Correlation-ID`, one id stitches the logs of a request together and matches the trace, which is
  what an operator needs first when a distributed call goes wrong.
- **Cost knobs default to safe.** Sampling, poll-span filtering, and the ASP.NET Core, `HttpClient` and runtime
  metric toggles are the levers a FinOps owner reaches for (COST.md), and all fail toward keeping data:
  sampling is off unless configured, an out-of-range ratio is ignored, only idle poll spans are
  dropped, and a metric family drops only on an explicit boolean `true` (a typo keeps it on).
- **`ParentBased` keeps distributed traces coherent.** An extracted-service deployment (ADR-008) needs
  a sampled-in request to stay sampled end to end; a per-hop random sampler would shred cross-service
  traces.

## Trade-offs
- **Custom instrumentation carries a maintenance cost.** The Aspire package has no reference to
  Application or Infrastructure by design, so the meter and activity-source names are duplicated as
  literals (the ten meter subscriptions at `Extensions.Telemetry.cs:307`-`:315` and
  `Extensions.Telemetry.cs:322`, the trace sources at `Extensions.Telemetry.cs:84`-`:86`, and the sync
  notes at `CqrsMetrics.cs:9`,
  `OutboxMetrics.cs:9` and `OutboxPollFilterProcessor.cs:19`-`:25`). A rename on one side silently
  stops export until the literal is updated. That is the price of the decoupled package graph.
- **Sampling trades trace completeness for cost.** A sampled-out trace is simply gone; deep debugging
  of a specific request can miss it. Metrics and logs are unaffected (sampling is trace-only), so RED
  rates and error counts stay whole even at a low ratio.
- **Poll-span filtering hides steady-state outbox activity.** The dead-letter counter and per-message
  `OutboxProcess` spans remain, but "is the poller alive and looping" cannot be answered from traces
  alone, by design (that signal is metrics and the dead-letter counter, not spans).
- **Cross-service trace continuity depends on stored ids and the parent decision.** A linked
  `OutboxProcess` trace only reconnects when the producer captured the trace and span ids on the
  message; `ParentBased` sampling that dropped the originating trace also drops the linked span.
- **Exporters and sampling are opt-in per host.** A host that sets neither exporter variable emits to
  nothing, and a misconfigured ratio fails toward sample-all (higher cost) rather than toward silence:
  the intended bias, but it means a cost surprise is possible where a data gap is not.

## Revision (2026-08-18)
Two meters and one hop.

**Two new failure counters, each on its own meter.** `cache.eviction.failed`, tagged `cache_tag`, on
`MMCA.Common.OutputCache`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheMetrics.cs:19`, instrument at
`:29-37`) counts a cross-service output-cache eviction that failed for one tag
([ADR-026](026-caching-strategy.md)'s Revision (2026-08-18)); and `besteffort.dispatch.failed`, tagged
`operation`, on `MMCA.Common.BestEffort`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Services/BestEffort.cs:102`, instrument at `:107-115`)
counts a swallowed fire-and-forget side effect, the helper's whole purpose being that the caller does
not see the failure. Both are subscribed in the Aspire defaults
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:206-207`).

**The meter inventory in the Decision above is wrong and has been for a while.** This record names two
meters, and [ADR-087](087-broker-poison-message-handling.md) called `MMCA.Common.Broker` "a third",
which was already an undercount. The authoritative list is the subscription block itself
(`Extensions.cs:201`-`Extensions.cs:208`), which carried **seven** at that point:
`MMCA.Common.Outbox`, `MMCA.Common.Cqrs`, `MMCA.Common.Idempotency`, `MMCA.Common.Scheduler`,
`MMCA.Common.Broker`, `MMCA.Common.OutputCache`, `MMCA.Common.BestEffort`. Two of them
(`Idempotency`, `Scheduler`) were never recorded here at all. Read that block, not this prose, when
the question is what the framework exports (it carries ten today; see the Revision (2026-09-19)).

**Correlation now starts at the edge.** [ADR-088](088-gateway-edge-responsibilities.md) adds a
context-free `GatewayCorrelationMiddleware` that ensures `X-Correlation-ID` on the way in and echoes it
on the way out, writing it onto the forwarded request so the service-tier `CorrelationIdMiddleware`
adopts it rather than minting its own. The Decision's claim that one id stitches a request together
becomes true across the gateway hop, where it previously began at the first service and left the
Gateway's own logs unlinked. No meter, no span, one header, one hop earlier.

Two costs come with it. **Both new counters are failure-only**, so a healthy system emits nothing on
them and a zero is indistinguishable from a host that never wired the feature, which is exactly the
shape of signal that goes unnoticed until an incident. And neither is wired to an alert or a runbook
section, joining ADR-087's two counters in the gap [ADR-062](062-slo-alerting-as-code.md) describes.
The duplicated-literal cost this record already records in Trade-offs applied to seven names rather
than two from that point on.

## Amended (2026-08-31)
The log side of this record. Until now it named only the OpenTelemetry logging call inside
`ConfigureOpenTelemetry` (`Extensions.cs:132`); what a host actually WRITES its application log lines
through was undocumented.

**Serilog is registered as ONE additional provider, never through `UseSerilog()`.** `AddCommonSerilog`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Logging/SerilogHostExtensions.cs:48`) builds the
framework's logger configuration, publishes it as the global `Log.Logger`
(`SerilogHostExtensions.cs:54`), and adds it to the host's existing factory with
`builder.Logging.AddSerilog(Log.Logger, dispose: true)` (`:55`). The alternative is a silent-failure
trap no code reading surfaces, which is why the rationale lives on the type itself (`:16`-`:20`):
`UseSerilog()` replaces the whole `ILoggerFactory` and with it every other provider, including the
OpenTelemetry to Azure Monitor provider `AddServiceDefaults` wires (`Extensions.cs:48`,
`Extensions.cs:130`). A host that calls it publishes no application log line to Application Insights at
all, while its metrics, traces and health endpoints stay green, so the gap reads as a quiet service
rather than as a misconfiguration. Ordering carries the same weight in the other direction: the helper
runs BEFORE `AddServiceDefaults()` in every host that uses it (for example
`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:104`-`:105`), so the OpenTelemetry
provider joins the factory Serilog is already in. One fitness test pins the invariant: the built
container must contain exactly one `SerilogLoggerProvider`
(`MMCA.Common/Tests/Hosting/MMCA.Common.Aspire.Tests/Logging/SerilogHostExtensionsTests.cs:156`-`:158`).

**Level policy and sinks.** The minimum level is `Debug` in Development and `Information` everywhere
else (`ResolveMinimumLevel`, `SerilogHostExtensions.cs:76`-`:77`, applied at `:107`), with
`Microsoft.EntityFrameworkCore` and `Microsoft.AspNetCore` held at `Warning` (`:108`-`:109`) and a
console sink always (`:110`). The rolling daily file sink is environment-conditional: added everywhere
except Production (`ShouldWriteFileSink`, `:87`-`:88`, applied at `:112`-`:118`), because a production
container writes it to ephemeral disk nothing reads while stdout and the OpenTelemetry provider already
carry the same events, whereas outside Production (local runs and the CI E2E stack) that file is what a
failure gets diagnosed from. A host needing one extra sink or enricher passes the optional `configure`
hook (`:50`, invoked at `:120`) instead of forking the helper.

**A bootstrap logger for the pre-DI window.** Module discovery runs before the DI container exists, so
there is no `ILogger<T>` to resolve yet. `CreateBootstrapLoggerFactory()` (`:67`-`:68`) returns a
factory writing to the same global `Log.Logger`, which each host disposes once startup wiring is done
(`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:126`).

**Adoption is asymmetric, but there is only one shape of it.** Nine hosts call `AddCommonSerilog`,
each in its own `Program.cs` and each ahead of its `AddServiceDefaults()` call: the seven ADC/Store
service hosts, ADC Conference (`:104`), Engagement (`:83`), Identity (`:98`), Notification (`:89`), and
Store Catalog (`:71`), Identity (`:75`), Sales (`:86`), plus both Blazor UI hosts,
`MMCA.ADC.UI.Web` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:49`, `AddServiceDefaults` at
`:51`) and `MMCA.Store.UI.Web` (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:60`,
`AddServiceDefaults` at `:62`). Each of the seven service hosts pairs it with
`CreateBootstrapLoggerFactory()` in the same file (ADC `:366`, `:209`, `:254`, `:190`; Store `:126`,
`:120`, `:133`); the two UI hosts do not, because they discover no modules and so have no pre-DI
window to cover. The asymmetry that remains is the two Gateways, the only hosts with no Serilog at all:
neither references it in its `Program.cs`, and both take the plain OpenTelemetry logging
`AddServiceDefaults` gives them (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:58`,
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:65`).

Two costs come with it. **The invariant is guarded in the framework, not at the consumer**: the one
test above runs in MMCA.Common, and nothing in a host's own build stops a new service from reaching for
`UseSerilog()`, whose failure mode is silence in a place nobody watches for absence. And
**`Information` is not the level that reaches
the queryable store**: [ADR-098](098-aspire-orchestration-not-testing-or-dashboards.md) records the
production thinning that floors the OpenTelemetry logging provider at `Warning` while Serilog keeps
`Information` on container stdout, so the two providers this record puts side by side deliberately
carry different volumes.

## Amended (2026-09-03): probe telemetry
Health probes were the trace bill. Container Apps liveness and readiness probes, the gateway's
downstream aggregate probes, YARP active health checks and the availability web test accounted for
every AppRequests row in both production workspaces, and their children (the health check's SQL
`SELECT 1`, the Redis PING, the gateway's `HttpClient` calls to each backend's `/alive`) for most of
the AppDependencies rows. None of it carries end-user signal, and none of it is touched by
`Telemetry:TracesSampleRatio`, because probe spans are exactly what a ratio sampler is asked to keep
proportionally.

**A third cost knob, and the only one that defaults to on.** `Telemetry:FilterProbeTelemetry`
(`Extensions.cs:37`) is read by `IsProbeTelemetryFilterEnabled`
(`Extensions.cs:540`-`Extensions.cs:541`) at `Extensions.cs:228`. It inverts the fail-safe direction
of the other knobs on purpose: absent, blank or unparseable all mean "filter", and only an explicit
boolean `false` turns filtering off, for a host debugging its own probes. What a probe path is comes
from one place, `HealthEndpointPaths.IsProbePath`
(`Source/Hosting/MMCA.Common.Aspire/HealthEndpointPaths.cs:29`-`:33`): `/alive`, `/health`, and
anything below `/health/`, case-insensitively.

**Two instrumentation predicates plus one processor, because probe spans arrive by three routes.**
With the knob on, the tracing setup attaches both filters to the default-named instrumentation
options (`Extensions.cs:234`-`Extensions.cs:237`; the unfiltered branch at
`Extensions.cs:241`-`Extensions.cs:242` is plain `AddAspNetCoreInstrumentation` and
`AddHttpClientInstrumentation`). `ProbeTelemetryFilter.ShouldCollectRequest`
(`Source/Hosting/MMCA.Common.Aspire/Telemetry/ProbeTelemetryFilter.cs:40`) refuses the inbound probe
request span and stamps an `mmca.probe` marker tag on it (`ProbeTelemetryFilter.cs:33`, set at
`:51`), because a refused request never gets its `url.path` written and its descendants would
otherwise have no way to recognize their own ancestor.
`ProbeTelemetryFilter.ShouldCollectOutgoing` (`:62`-`:63`) refuses outbound probe calls that are not
descendants of any inbound request, the gateway's `DownstreamServiceHealthCheck` calls and YARP's
active checks, both driven by background timers. The descendants are handled by
`ProbeTelemetryFilterProcessor`
(`Source/Hosting/MMCA.Common.Aspire/Telemetry/ProbeTelemetryFilterProcessor.cs:20`), registered only
when the knob is on and, like the outbox poll filter, before the exporters
(`Extensions.cs:257`): it walks the in-process parent chain (`ProbeTelemetryFilterProcessor.cs:52`),
matches the marker or a server span whose path, route or display name is a probe (`:66`-`:79`), and
clears `Recorded` plus `IsAllDataRequested` (`:59`-`:60`) at both `OnStart` (`:29`) and `OnEnd`
(`:40`), since a client span carries no identifying tag yet when it starts. Unlike the two metrics
knobs, these filters need no view: configuring the default-named options also covers the
instrumentation the Azure Monitor distro adds.

Metrics are deliberately untouched (`Extensions.cs:226`-`Extensions.cs:227`):
`http.server.request.duration`, Kestrel and routing instruments keep flowing, so probe traffic stays
on dashboards.

Two costs come with it. **"Did the probe pass" is no longer answerable from traces**, the same
blindness poll-span filtering already accepts for the outbox, so that question belongs to metrics
and the health endpoints ([ADR-025](025-startup-warmup-readiness.md)) instead. And **this knob fails
toward dropping data** while sampling and the two metrics toggles fail toward keeping it: a host that
adds a real route below `/health/` has its traces filtered by `IsProbePath`'s prefix match with no
error and no log line.

## Revision (2026-09-07)
Telemetry gained the properties that make it usable as evidence, from the 2026-09-07 security review.

1. **The daily ingestion cap is alerted on** (SEC-ADC-47 / SEC-Store-55). A workspace daily cap
   (`MMCA.ADC/infra/foundation.bicep:15`, applied at `:54`; `MMCA.Store/infra/foundation.bicep:57`)
   stops ingestion for every table until the next UTC midnight when it is hit, which silently blinds
   every log-based alert rule in the deployment. Both templates now carry a scheduled query rule that
   fires on the ingestion status event: ADC at `MMCA.ADC/infra/main.bicep:500` (query at `:510`),
   Store at `MMCA.Store/infra/main.bicep:571` (query at `:587`, matching both `ApproachingQuota` and
   `OverQuota` so the warning arrives before the outage). This is a detection outage, not a cost
   event, which is why it is alerted rather than left to the cost report.
2. **Control-plane and data-plane access is logged** (SEC-ADC-46 / SEC-Store-21). ADC deploys SQL
   auditing to the workspace (`MMCA.ADC/infra/main.bicep:790`, with the master-database diagnostic
   setting that carries the audit category at `:815`) and diagnostic settings on Service Bus
   (`:1034`), the avatar and key-ring storage account (`:1141`) and Key Vault (`:1330`). Store
   deploys the same pair (`MMCA.Store/infra/main.bicep:833` and `:819`, rationale at `:798-802`) plus
   diagnostics on the key-ring blob account (`:1173`) and Key Vault (`:1317`), and Defender for SQL
   threat protection behind a parameter (`:863`).
3. **Store alerts on an authentication signal** (SEC-Store-54 / SEC-ADC-51). The failed-request and
   failed-dependency SLO rules deliberately exclude 401 and 499
   (`MMCA.Store/infra/main.bicep:276`, `:294`), which meant a credential-stuffing run produced
   nothing but filtered-out rows. A dedicated rule now watches sustained 401s on the `/Auth` route
   (`:491`, query at `:501`), with the reasoning for keeping the two separate written above it
   (`:460-475`).
4. **Reviewer names no longer carry email addresses.** Store shipped a data migration that scrubs
   them out of the stored review rows
   (`MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Catalog/Migrations/20260907112935_ScrubEmailAddressesFromProductReviewerNames.cs`),
   because the reviewer name is rendered on an anonymous surface and the access token had been
   putting the address into the name claim it was captured from.

## Revision (2026-09-11)
An eighth meter, a second trace source, a second poll loop kept off the bill, and one meter this
pipeline does not carry.

**The durable internal-command queue exports through this record's pipeline.**
`InternalCommandMetrics`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandMetrics.cs:20`)
owns the meter `MMCA.Common.InternalCommands` and five instruments: processed, failed and
dead-letter counters (`:38`, `:48`, `:57`) plus a duration and a schedule-lag histogram (`:66`,
`:75`), the same RED-plus-dead-letter shape the outbox and CQRS paths already publish
([ADR-114](114-internal-commands-durable-job-queue.md)). The Aspire defaults subscribe it as the
eighth entry in the meter chain (`Extensions.cs:208`) and add its activity source beside the outbox
one (`Extensions.cs:214`). The authoritative list stays the block itself
(`Extensions.cs:201`-`Extensions.cs:208`), which now carries **eight**: the seven the Revision
(2026-08-18) names plus `MMCA.Common.InternalCommands`.

**The queue's poll loop is filtered like the outbox one.** `OutboxPollFilterProcessor` clears
`Recorded` on an `InternalCommandPoll` span from the internal-command activity source with the same
pass it applies to `OutboxPoll` (`OutboxPollFilterProcessor.cs:60`-`:64`), so a second always-on
poller does not restore the ingestion cost the outbox filter removes. The cost is the same one the
Trade-offs already accept: whether that poller is alive and looping is a metrics question, not a
trace one.

**One meter is defined and not subscribed here.** `MMCA.Common.AI`
(`MMCA.Common/Source/Core/MMCA.Common.AI/Observability/AiUsageMeter.cs:26`) carries the token-usage
instruments of the governed chat-client boundary
([ADR-120](120-governed-chat-client-boundary.md)) and is absent from the `AddMeter` chain, so a host
that takes the AI package exports nothing from it through `AddServiceDefaults` until it subscribes
the name itself. That is the duplicated-literal cost of the decoupled package graph in its other
direction, where the miss reads as an absence rather than as a rename.

## Alternatives rejected
- **An `ActivitySource` span per command and query in the CQRS pipeline, tagged by module.**
  Evaluated 2026-09-16 against a modular-monolith template that ships one, and declined. The pitch
  assumes production runs as a single process, and it does not: ADC and Store deploy one module per
  container app, so cross-module calls are already gRPC or HTTP spans and the module is implied by
  the cloud role name. The ASP.NET Core request span already names the route, which maps to one
  command or query; `LoggingCommandDecorator` already carries a CommandName plus ModuleName log
  scope, a query tag on the SQL, and a `CqrsMetrics` duration histogram tagged by command. Traces
  sample at 25% and trace ingestion is the largest observability cost line here, so an extra
  dependency row per command or query buys duplication at a measurable price. Revisit only on a
  concrete diagnostic gap (orphan SQL spans from scheduled jobs would be one), and scope any fix to
  that path rather than to the pipeline.

## Related
ADR-003 (the outbox whose dead-letter counter and poll-span filtering this defines), ADR-014 (the
CQRS decorator pipeline that emits the RED histograms as a byproduct of its logging decorators),
ADR-009 (resilience and recovery objectives, configured alongside telemetry in the same
`AddServiceDefaults`; observability is the diagnostic layer under that posture), ADR-025 (startup
warm-up and readiness gating, whose health-check endpoints are the operational-signal sibling of these
telemetry signals in the same Aspire defaults), ADR-114 (the durable internal-command queue whose
meter, activity source and poll-span filtering this pipeline carries), ADR-120 (the governed chat
client whose `MMCA.Common.AI` meter these defaults now subscribe), and COST.md (the FinOps companion that records
span-filtering and sampling as cost levers).

## Amended (2026-09-11): the Polly meter
A ninth meter, one cost knob, and one log level.

**Polly's meter is subscribed.** `AddServiceDefaults` puts the standard resilience handler on every
`HttpClient` and every gRPC typed client
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:83`, `:93`-`:98`,
[ADR-009](009-resilience-and-recovery-objectives.md)), so Polly is the component that decides whether
an inter-service call is retried, timed out, or refused by an open circuit. None of that left the
process: the subscription block carried the eight `MMCA.Common.*` meters and never the one named
`Polly`, so a backend brownout looked, from a dashboard, exactly like latency.
`metrics.AddMeter(PollyMeterName)` (`Extensions.cs:596`, the literal at `:49`) makes it the ninth.

**`resilience.polly.strategy.events` is always exported** (`Extensions.cs:57`). It is a counter tagged
with the pipeline name, the strategy name, the event name (`OnRetry`, `OnCircuitOpened`,
`OnCircuitClosed`, `OnTimeout`), the event severity and the exception type, and it is the only
production signal that a client is retrying or that a circuit opened. It is low volume and low
cardinality, so it sits behind no knob.

**The two duration histograms are dropped unless a host asks for them.**
`resilience.polly.strategy.attempt.duration` (`Extensions.cs:60`) and
`resilience.polly.pipeline.duration` (`:63`) are removed by a metrics `View` unless
`Telemetry:EnablePollyDurationMetrics` parses as boolean `true` (`:598`-`:610`, the key at `:43`, read
through `IsInstrumentationEnabled` at `:490`). They are per-bucket streams on a pipeline that runs on
every outbound call and they re-measure what `http.client.request.duration` already reports, so they
stay off until someone is actually debugging a retry storm (rubric section 31). This knob is the
mirror image of `Telemetry:DisableHttpClientMetrics`: it is off by default and must be turned on, and
anything other than a parseable `true` leaves the histograms dropped.

**Where the block lives now.** The metrics configuration moved out of the `WithMetrics` lambda into a
dedicated `ConfigureMetrics` method (`Extensions.cs:534`, called at `:179`). The `MMCA.Common.*` meter
chain is at `Extensions.cs:598`-`:606`, the Polly subscription at `:613`, and the trace sources at
`:182`-`:185`. The earlier entries in this record cite the pre-move lines; the Trade-offs bullet above
is corrected to the current ones. The authoritative list is still the block itself, and it now carries
**nine**.

**The CQRS decorators log a thrown exception once.** `LoggingCommandDecorator` and
`LoggingQueryDecorator` still record the duration of a failed execution and still tag it
`outcome=exception`
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingCommandDecorator.cs:97`-`:101`,
`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingQueryDecorator.cs:91`-`:95`),
so the RED signal this record defines is unchanged in shape and in volume. What changed is the level
and the payload of the decorator's own log line: Warning, without the exception object
(`LoggingCommandDecorator.cs:117`-`:118`, `LoggingQueryDecorator.cs:106`), because the single Error row
with the full stack belongs to the boundary that handles the exception
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/GlobalExceptionHandler.cs:67`,
`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/DbUpdateExceptionHandler.cs:31`). Both
lines carry the same correlation id, so they still join; an alert built on the decorator's Error level
moves to the boundary's ([ADR-014](014-cqrs-decorator-pipeline.md)).

## Revision (2026-09-19): the AI meter is subscribed
A tenth meter, and a fourth trace source.

**`MMCA.Common.AI` is in the chain now.** The subscription block ends with
`.AddMeter(AiTelemetryName)`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:606`, the literal at `:62`), and the
same name is added as a trace source beside the application name, the outbox one and the
internal-command one (`Extensions.cs:185`). The meter carries the token-usage instruments of the
governed chat-client boundary ([ADR-120](120-governed-chat-client-boundary.md)): two token counters
and a call-duration histogram, created by `AiUsageMeter` from an `IMeterFactory`
(`MMCA.Common/Source/Core/MMCA.Common.AI/Observability/AiUsageMeter.cs:77`, `:81`, `:85`) on the
meter name it declares at `AiUsageMeter.cs:26`. A host that takes the AI package therefore exports
token spend and call duration through `AddServiceDefaults` with no per-host subscription, which is
what the Revision (2026-09-11) said it had to do for itself. That entry and the Related line that
restated it are superseded.

**The count is ten.** Reading the block itself, which stays the authoritative list: nine
`MMCA.Common.*` meters (`Outbox`, `Cqrs`, `Idempotency`, `Scheduler`, `Broker`, `OutputCache`,
`BestEffort`, `InternalCommands`, `AI`, at `Extensions.cs:598`-`:606`) plus `Polly`
(`Extensions.cs:613`). The **nine** in the Amended (2026-09-11) section counted eight
`MMCA.Common.*` names plus `Polly` and is superseded by this one.

**Subscribing a package this assembly cannot reference is still deliberate, and still free.** The
Aspire package has no project reference to `MMCA.Common.AI`, which is what keeps the optional
language-model dependency out of every host that never adopts it, so the name is a literal here and
the subscription is inert in a host that never takes the package (`Extensions.cs:55`-`:62`). The
cost is the one this record's Trade-offs already name, now spread over ten meter literals rather
than nine: a rename on the publishing side stops export silently until the literal follows.

## Revision (2026-10-01)
A third metrics cost knob, and the citations follow the telemetry code into its own file.

**ASP.NET Core metrics are no longer unconditional.** `ConfigureMetrics` now starts by calling
`ConfigureAspNetCoreMetrics`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:245`, declared at `:352`),
which reads `Telemetry:DisableAspNetCoreMetrics` through the same `IsInstrumentationDisabled` helper
as the other two metrics knobs (`:354`). When it parses as `true`, a `View` drops every meter named
under the `Microsoft.AspNetCore.` prefix (`:359`-`:362`); otherwise `AddAspNetCoreInstrumentation`
runs (`:366`). The reason is recorded on the method (`:343`-`:349`): that family was 73% of both
production workspaces' ingestion over 2026-09-22..28, mostly gauges re-emitted on idle replicas, and
no alert reads it, because request latency and failure alerts run off the request traces. Both
deployments turn it on (`MMCA.ADC/infra/main.bicep:298`-`:299`, `MMCA.Store/infra/main.bicep:253`-`:254`).
The Decision's cost-knob bullet now names three families, and two statements in the Amended
(2026-09-03) section are superseded on that point: the probe knob itself still leaves metrics alone
(`Extensions.Telemetry.cs:98`-`:99`), but with this knob on, `http.server.request.duration` and the
Kestrel and routing instruments are dropped in production, so probe traffic is not on production
dashboards; and there are three metrics toggles, not two, all failing toward keeping data.

**Two smaller behavior details the Decision now records.** The outbox dead-letters an unresolvable
event type at once only when the row has been attempted before: on the row's first attempt
(`RetryCount` 0) it is retried as transient
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:667`-`:674`)
unless `MaxRetries` is 1 or less, and a second `OutboxPoll` span wraps the backlog count in
`CountPendingAsync` (`OutboxProcessor.cs:276`, `:288`). `CorrelationIdMiddleware` treats a blank header
as absent and cuts a supplied id to 64 characters
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/CorrelationIdMiddleware.cs:24`, `:39`-`:41`,
`:56`).

**Citations refreshed.** The OpenTelemetry configuration, exporters, knob helpers and meter chain now
live in `Extensions.Telemetry.cs`, so every Decision and Trade-offs citation into it is rebased, as are
the CQRS decorator, outbox processor and correlation middleware citations. The dated amendment and
revision sections keep the anchors they were written against.

## Revision (2026-10-06)
Four statements in earlier sections no longer match the code, and the anchors moved again.

- **The correlation id has a printable-ASCII filter.** After the 64-character cut, `Sanitize`
  discards any supplied id holding a character outside `' '`..`'~'`, so the middleware falls back to
  the trace id and then `TraceIdentifier`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/CorrelationIdMiddleware.cs:61`-`:65`, the
  filter at `:64`), because Kestrel refuses to echo such a value in a response header. The Gateway's
  `GatewayCorrelationMiddleware` applies the same cut and filter
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Gateway/GatewayCorrelationMiddleware.cs:89`-`:90`). The
  Decision bullet now says so.
- **Store's auth alert counts 401 or 429, not only 401.** The Revision (2026-09-07) item 3 describes a
  rule on sustained 401s; `authFailureSpikeAlert` (`MMCA.Store/infra/main.bicep:537`) queries
  `ResultCode in ("401", "429")` on the `/Auth` path (`:553`), because ADR-029 account lockout and the
  gateway's auth-tight limiter answer 429, so the rule also sees lockout storms (reasoning at
  `:525`-`:529`).
- **The bootstrap logger factory is not disposed once startup wiring is done.** Every service host
  declares it as a top-level `using var` (for example
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:124`), so it is disposed only when
  the program ends, after `await app.RunAsync()` (`:366`). The Amended (2026-08-31) wording is
  superseded on that point.
- **`GlobalExceptionHandler` writes its Error row only on its 500 path.** The Amended (2026-09-11)
  section says the single Error row with the stack belongs to the handling boundary;
  `GlobalExceptionHandler` logs it at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/GlobalExceptionHandler.cs:97` before
  answering 500 (`:99`), while a cross-tenant write (`:56`) and a `BadHttpRequestException` (`:77`)
  are logged at Warning. `DbUpdateExceptionHandler` still writes an Error row with the stack
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/DbUpdateExceptionHandler.cs:31`) and
  answers 409 Conflict (`:33`).
- **Current locations for facts the dated sections still carry.** Serilog adoption (nine hosts, each
  calling `AddCommonSerilog` before `AddServiceDefaults`, the Gateways without Serilog) is unchanged;
  the calls are now ADC Conference `Program.cs:102`, Engagement `:84`, Identity `:99`, Notification
  `:87`, `MMCA.ADC.UI.Web` `:50`, Store Catalog `:72`, Identity `:76`, Sales `:87`, `MMCA.Store.UI.Web`
  `:61`; bootstrap factories at ADC `:368`, `:212`, `:264`, `:194` and Store `:124`, `:118`, `:131`; the
  ADC Gateway's `AddServiceDefaults` at `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:69`. The
  telemetry code the Amended (2026-09-03) and (2026-09-11) sections cite in `Extensions.cs` now lives
  in `Extensions.Telemetry.cs`: `FilterProbeTelemetryConfigKey` `:19`, `IsProbeTelemetryFilterEnabled`
  `:233`, `ProbeTelemetryFilterProcessor` registered at `:129`, `ConfigureMetrics` `:243` (called at
  `:80`), the `MMCA.Common.*` meter chain `:307`-`:315`, the Polly subscription `:322`, the trace
  sources `:83`-`:86`. The Revision (2026-09-07) resources: ADC `logIngestionCapAlert`
  `MMCA.ADC/infra/main.bicep:638` (query `:654`), `sqlServerAuditing` `:872`, `sqlAuditDiagnostics`
  `:897`, `serviceBusDiagnostics` `:1166`, `avatarBlobDiagnostics` `:1270`, `keyVaultDiagnostics`
  `:1505`; Store `logIngestionQuotaAlert` `MMCA.Store/infra/main.bicep:623` (query `:639`),
  `sqlAuditDiagnostics` `:871`, `sqlAuditingSettings` `:885`, `sqlThreatProtection` `:915`,
  `dataProtectionBlobDiagnostics` `:1203`, `keyVaultDiagnostics` `:1376`, the SLO 401/499 exclusions
  `:316`, `:334`.
- Every anchor in the Status, Decision, Rationale, Trade-offs and Related sections was re-verified
  against current source; the outbox, correlation-middleware and ADC bicep anchors in the Decision were
  rebased.
