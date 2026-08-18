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
now starts one hop earlier, at the Gateway; see the Revision (2026-08-18) at the end.

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
  (`Source/Hosting/MMCA.Common.Aspire/Extensions.cs:121`) wires OpenTelemetry logging with formatted
  messages and scopes (`Extensions.cs:125`), metrics from ASP.NET Core (unconditional,
  `Extensions.cs:132`) plus `HttpClient` and the runtime (each gated behind a cost knob, see below),
  and tracing from ASP.NET Core and `HttpClient` (`Extensions.cs:169`-`Extensions.cs:170`). It is
  called from `AddServiceDefaults` (`Extensions.cs:41`), so a host opts in once and every project in
  the Aspire model inherits the same pipeline.

- **Custom RED metrics from the CQRS pipeline.** A single meter `MMCA.Common.Cqrs`
  (`Source/Core/MMCA.Common.Application/UseCases/Decorators/CqrsMetrics.cs:19`) publishes two duration
  histograms: `cqrs.command.duration` (`CqrsMetrics.cs:25`) and `cqrs.query.duration`
  (`CqrsMetrics.cs:31`), both in milliseconds. Every path is measured without a `finally`: each
  logging decorator routes all three of its exits through a private `RecordDuration` helper, so the
  measurement cannot be skipped. The command helper calls `CqrsMetrics.CommandDuration.Record(...)`
  tagged by `command` and `outcome`
  (`Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingCommandDecorator.cs:70`) and the
  query helper does the same for `QueryDuration`
  (`Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingQueryDecorator.cs:68`).
  The `outcome` tag takes `completed`, `failed` (a `Result` failure), or `exception`, one call site per
  path (`LoggingCommandDecorator.cs:47`, `:42`, `:56`; the query equivalents at
  `LoggingQueryDecorator.cs:44`, `:39`, `:53`), so count gives rate, the tag gives errors, and the
  histogram gives duration. The Aspire host subscribes the meter by literal name
  (`Extensions.cs:161`).

- **An outbox dead-letter counter.** The outbox instruments live in their own static type
  (`Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMetrics.cs:15`), which owns the
  meter `MMCA.Common.Outbox` (`OutboxMetrics.cs:18`) and the counter `outbox.dead_letter.count`
  (`OutboxMetrics.cs:32`-`OutboxMetrics.cs:33`). `OutboxProcessor` increments it on both dead-letter
  paths, tagged by `event_type` and by a `reason` that tells them apart: `type_unresolvable` when a
  message's event type cannot be resolved (`OutboxProcessor.cs:475`-`OutboxProcessor.cs:478`), and
  `retries_exhausted` when a failing message reaches `MaxRetries` and drops out of the poll
  (`OutboxProcessor.cs:540`-`OutboxProcessor.cs:543`). The processor's activity source publishes outbox
  spans under the same name (`OutboxProcessor.cs:81`); both the meter and the trace source are
  registered by literal name in the Aspire defaults (`Extensions.cs:160`, `Extensions.cs:168`).

- **Correlation-ID middleware ties the request together.** `CorrelationIdMiddleware`
  (`Source/Presentation/MMCA.Common.API/Middleware/CorrelationIdMiddleware.cs:15`) uses the
  `X-Correlation-ID` header (`CorrelationIdMiddleware.cs:18`), reading it from the request or falling
  back to the current W3C trace id and then to `HttpContext.TraceIdentifier`
  (`CorrelationIdMiddleware.cs:32`), sets it on the scoped `ICorrelationContext`
  (`CorrelationIdMiddleware.cs:36`), and echoes it on the response
  (`CorrelationIdMiddleware.cs:39`, inside the `OnStarting` callback registered at
  `CorrelationIdMiddleware.cs:37`). The CQRS logging decorators stamp that same id into every log
  scope (`LoggingCommandDecorator.cs:23`, `:25`), so logs, the correlation id, and the trace id line
  up for one request.

- **Two high-volume metric families gated behind cost knobs, on by default.** ASP.NET Core metrics are
  always wired (`Extensions.cs:132`), but the two heaviest AppMetrics contributors on a low-traffic
  multi-service deployment are conditional. `HttpClient` connection and request metrics are added only
  when `Telemetry:DisableHttpClientMetrics` is unset or false (`Extensions.cs:141`, adding
  instrumentation at `Extensions.cs:143`), and .NET runtime metrics (`dotnet.gc.*`, `jit.*`,
  `thread_pool.*`) only when `Telemetry:DisableRuntimeMetrics` is unset or false (`Extensions.cs:150`,
  adding at `Extensions.cs:152`). Both keys are read by `IsInstrumentationDisabled`
  (`Extensions.cs:389`), which drops the family only when the value parses as boolean `true`; absent,
  blank, or unparseable falls back to keeping the instrumentation, so a typo cannot silently blind a
  whole metric family. A deployed host sets one or both to `true` to cut ingestion cost; outbound
  dependency latency is still captured as traces when `HttpClient` metrics are dropped.

- **Head-based sampling as a cost knob, off by default.** `Telemetry:TracesSampleRatio`
  (`Extensions.cs:181`, parsed by `TryGetTraceSampleRatio` at `Extensions.cs:366`, which reads the
  key at `Extensions.cs:369`) is unset by default, so a host samples everything and behavior does not
  change. A deployed host sets a ratio in
  the open interval (0,1) to keep that fraction of traces; the value wraps a `TraceIdRatioBasedSampler`
  in a `ParentBasedSampler` (`Extensions.cs:185`) so a sampled-in request keeps its whole trace across
  service boundaries. A key that is absent, unparseable, or outside (0,1) falls back to sample-all
  (`Extensions.cs:368`-`Extensions.cs:372`), so a typo can never silently drop all telemetry.

- **Outbox poll spans are filtered out of export.** `OutboxPollFilterProcessor`
  (`Source/Hosting/MMCA.Common.Aspire/Telemetry/OutboxPollFilterProcessor.cs:15`), registered before
  the exporters (`Extensions.cs:177`), clears the `Recorded` flag on the recurring `OutboxPoll` span
  and its children (`OutboxPollFilterProcessor.cs:45`). The poll query runs inside that span, opened at
  the top of `FetchCandidatesAsync` (`OutboxProcessor.cs:387`, span started at `OutboxProcessor.cs:393`,
  named at `OutboxProcessor.cs:69`), so steady-state polling does not flood Application Insights. Real
  outbox work is untouched: each per-message `OutboxProcess` span is started by `StartOutboxActivity`
  (called once per message at `OutboxProcessor.cs:466`, declared at `OutboxProcessor.cs:584`) under an
  explicit parent context restored from the message's stored trace and span ids
  (`OutboxProcessor.cs:591`-`OutboxProcessor.cs:594`), span started at
  `OutboxProcessor.cs:596`-`OutboxProcessor.cs:599`, so it is never a child of the poll span.

- **Dual exporters, either or both.** `AddOpenTelemetryExporters` enables OTLP when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is present (`Extensions.cs:282`, the Aspire dashboard sets it, exporter
  wired at `Extensions.cs:286`) and Azure Monitor via `UseAzureMonitor` (`Extensions.cs:294`) when
  `APPLICATIONINSIGHTS_CONNECTION_STRING` is present (read at `Extensions.cs:290`, checked at
  `Extensions.cs:292`, and set by the cloud deployment). Both can be active at once
  (`Extensions.cs:277`), so local development ships to the
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
- **Cost knobs default to safe.** Sampling, poll-span filtering, and the `HttpClient`/runtime metric
  toggles are the levers a FinOps owner reaches for (COST.md), and all fail toward keeping data:
  sampling is off unless configured, an out-of-range ratio is ignored, only idle poll spans are
  dropped, and a metric family drops only on an explicit boolean `true` (a typo keeps it on).
- **`ParentBased` keeps distributed traces coherent.** An extracted-service deployment (ADR-008) needs
  a sampled-in request to stay sampled end to end; a per-hop random sampler would shred cross-service
  traces.

## Trade-offs
- **Custom instrumentation carries a maintenance cost.** The Aspire package has no reference to
  Application or Infrastructure by design, so the meter and activity-source names are duplicated as
  literals (the meter subscriptions at `Extensions.cs:160`-`Extensions.cs:163` and the trace source at
  `Extensions.cs:168`, and the sync notes at `CqrsMetrics.cs:8`, `OutboxMetrics.cs:8` and
  `OutboxPollFilterProcessor.cs:17`). A rename on one side silently stops export until the literal is
  updated. That is the price of the decoupled package graph.
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
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:169-170`).

**The meter inventory in the Decision above is wrong and has been for a while.** This record names two
meters, and [ADR-087](087-broker-poison-message-handling.md) called `MMCA.Common.Broker` "a third",
which was already an undercount. The authoritative list is the subscription block itself
(`Extensions.cs:164-170`), which now carries **seven**: `MMCA.Common.Outbox`, `MMCA.Common.Cqrs`,
`MMCA.Common.Idempotency`, `MMCA.Common.Scheduler`, `MMCA.Common.Broker`, `MMCA.Common.OutputCache`,
`MMCA.Common.BestEffort`. Two of them (`Idempotency`, `Scheduler`) were never recorded here at all.
Read that block, not this prose, when the question is what the framework exports.

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
The duplicated-literal cost this record already records in Trade-offs now applies to seven names rather
than two.

## Related
ADR-003 (the outbox whose dead-letter counter and poll-span filtering this defines), ADR-014 (the
CQRS decorator pipeline that emits the RED histograms as a byproduct of its logging decorators),
ADR-009 (resilience and recovery objectives, configured alongside telemetry in the same
`AddServiceDefaults`; observability is the diagnostic layer under that posture), ADR-025 (startup
warm-up and readiness gating, whose health-check endpoints are the operational-signal sibling of these
telemetry signals in the same Aspire defaults), and COST.md (the FinOps companion that records
span-filtering and sampling as cost levers).
