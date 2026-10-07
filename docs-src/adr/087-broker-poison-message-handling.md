# ADR-087: Broker Poison-Message Handling: Second-Level Redelivery and Fault Observability

## Status
Accepted (2026-08-18). **Amends [ADR-009](009-resilience-and-recovery-objectives.md)**: the outbox's
broker publish gains a circuit breaker, which is the first resilience policy this workspace applies to
something other than an outbound HTTP or gRPC client. [ADR-003](003-outbox-dual-dispatch.md)'s retry,
backoff and dead-letter ladder is reused unchanged rather than amended, and
[ADR-021](021-consumer-inbox-idempotency.md)'s dedup contract is untouched. The database resilience
posture is also unchanged, recorded below as an explicit rejection rather than an omission.
Revised 2026-10-01: broker wiring and Aspire meter citations moved, and the meter-count sentence corrected.
Revised 2026-10-06: the circuit-breaker search now names its one non-breaker hit in `HttpResultExecutor.cs`.
Revised 2026-10-07: the breaker scope now notes that monolith integration events pass through it via `InProcessMessageBus` (so failing in-process handlers can open it), the database posture names both relational engines and the Sqlite and Cosmos contexts that run on the provider default, the circuit-open log latch is stated per data source, and `OutboxProcessor.cs` anchors are refreshed.

## Context
Delivery in this workspace has always been at-least-once with retries on both legs: the outbox
retries a failed publish with jittered exponential backoff and eventually dead-letters
([ADR-003](003-outbox-dual-dispatch.md)), and MassTransit applies its own configured retry on the
consume side ([ADR-066](066-broker-transport-selection.md)). Retry answers the transient failure.
Neither leg answered the two failures that are not transient.

**A poison message exhausts its retries and then disappears from view.** MassTransit moves a message
whose retries are spent to the transport's error queue and the consumer moves on. That is correct
behavior and it is also silent: nothing in this workspace observed it. The outbox's own dead-letter
path is loud by design (a metric, an Error log, `DeadLetterRetentionDays`), but that covers the
*publish* side only. A message that left the outbox successfully, reached the broker, and then failed
every consume attempt produced no counter and no log in any of our meters. It was visible only to
whoever thought to look in the error queue.

**A broker outage turns the outbox into a hot loop.** The outbox processor leases a batch, publishes,
fails, re-leases with backoff and comes back. When the broker is unreachable rather than slow, every
message in every batch fails identically, and the processor spends the outage opening connections,
timing them out, and writing retry rows. The backoff bounds the damage per message but not the shape
of the failure: the process keeps paying full price for an answer it already knows.

The available fix for the first failure is MassTransit's **second-level redelivery**: after the
in-memory retries are spent, the message is scheduled for redelivery minutes or hours later rather
than retried immediately. It is the right tool for the failure that immediate retry cannot fix, which
is a dependency that will come back but not within seconds. It also carries a transport constraint
that is the reason this record exists rather than a one-line change: on RabbitMQ it requires the
`rabbitmq_delayed_message_exchange` plugin, and the Aspire dev container does not ship it. Enabling it
against a plugin-less broker fails at bus start
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:184-187`). Azure
Service Bus, the production transport, has native scheduled delivery and needs no plugin.

## Decision
Three changes, each scoped to one failure: second-level redelivery configured per transport, a fault
consumer with its own meter, and a circuit breaker around the outbox's integration-event publish
(the broker hop in a distributed host) and nothing else.

### Second-level redelivery is transport-aware, and the flag exists only because of RabbitMQ
`MessageBusSettings` gains two members. `EnableDelayedRedelivery`
(`MessageBusSettings.cs:195`) is a `bool` with no initializer, so it **defaults to `false`**, and
`RedeliveryIntervalsSeconds` (`:211`) is an `IReadOnlyList<int>` defaulting to `[60, 600, 3600]`: one
minute, ten minutes, one hour. Both live in the `"MessageBus"` section (`:14`).

The two transports consume them differently, and the asymmetry is the decision:

- **RabbitMQ consults the flag.** `ConfigureBrokerTransport`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:264`) calls
  `cfg.UseDelayedRedelivery(r => r.Intervals(intervals))` inside `UsingRabbitMq` (`:272`) only under
  `if (settings.EnableDelayedRedelivery)` (`:283`, the call at `:288`), with the plugin requirement
  restated at the registration site (`:252-257` in the method doc comment, `:279-282` inline). Default-off is not timidity: the local
  Aspire broker cannot serve it, so a default-on setting would break every developer's first `F5`
  with a bus-start failure, which is the worst possible place to learn about a broker plugin.
- **Azure Service Bus does not consult it.** `UsingAzureServiceBus` (`:303`) calls
  `UseDelayedRedelivery` unconditionally (`:329`), with the reasoning recorded inline (`:322-325`).
  Service Bus schedules natively, there is no plugin to be missing, and a production transport that
  can express "try again in an hour" should always express it. Making the operator opt in would mean
  the environment that most needs the behavior is the one most likely to be running without it.

Two details are worth stating so the words above are not read as stronger than the code.
"Unconditional" means "not gated on the flag": both call sites are still guarded by
`intervals.Length > 0` (`:286`, `:327`), so an operator who configures an empty interval list turns
the feature off everywhere. And `RedeliveryIntervalsSeconds` carries **no** DataAnnotations attribute,
unlike its neighbours `RetryLimit` and the two retry-interval settings, so the ADR-070 fail-fast
chain does not validate it; non-positive entries are filtered at use time in `BuildRedeliveryIntervals`
(`:381-384`) instead. In both transports the redelivery filter is registered **before**
`UseMessageRetry` (`:292`, `:332`), which is what keeps immediate retry innermost and delayed
redelivery outside it.

### A fault consumer makes an exhausted message visible
`FaultIntegrationEventConsumer<TEvent>`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/FaultIntegrationEventConsumer.cs:26-28`)
implements `IConsumer<Fault<TEvent>>`, the message MassTransit publishes when a consumer's retries are
spent. It does exactly two things: writes one source-generated **Error**-level log line naming the
event type and the faulted message id (`:57`, emitted at `:48`, id resolved as
`fault.FaultedMessageId ?? fault.FaultId` at `:39`), and increments a counter (`:50-52`). It never
throws and never replays the failed message (`:17-22`). That restraint is the point: a fault consumer
that tried to recover would be a second, undocumented retry policy layered on the two that already
exist.

Registration is automatic. `RegisterIntegrationEventConsumer<TEvent>`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:60`)
takes `bool registerFaultConsumer = true` (`:61`) and adds the fault consumer under that guard
(`:71`, the upcasted-consumer variant carries the same parameter and guard at `:124`, `:134`), so a host that registers a consumer gets fault observability without asking. **That parameter
is the only opt-out, and it is per event type**: there is deliberately no host-wide configuration
switch, so turning fault observability off is a visible `false` at one call site rather than a setting
that silently disarms every consumer in a service.

### One meter, `MMCA.Common.Broker`
`BrokerMetrics` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMetrics.cs:18`)
is an `internal static` class holding a single meter named `MMCA.Common.Broker` (`:21`, `:23`) with
two `Counter<long>` instruments, both in units of `messages` and both tagged `event_type`:
`broker.fault.count` (`:30-33`) and `broker.circuit.open.count` (`:42-45`). It is one of the
`MMCA.Common.*` meters, beside `MMCA.Common.Cqrs` and `MMCA.Common.Outbox` ([ADR-041](041-observability-and-telemetry.md)), and the
name is duplicated as a literal in `MMCA.Common.Aspire`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:311`, a duplication the Infrastructure
declaration records in its own doc comment at `BrokerMetrics.cs:9-11`) so the Aspire service defaults
can subscribe to it without a package reference.

### A circuit breaker around the outbox integration-event publish, and nothing else
`OutboxProcessor` holds a per-instance Polly `ResiliencePipeline`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:105`,
built at `:868-879`) and wraps **exactly one call** in it: `state.Bus.PublishAsync(state.Event, ct)`
inside `DeliverAsync` (`:676-696`, the `ExecuteAsync` at `:685-689`, the publish at `:687`). The
branch for a domain event that is not an integration event (`IDomainEventDispatcher`, `:691-695`) is
outside it, no database call is inside the delegate, and the intent is stated at the field
(`:93-104`, "never the database calls" at `:94`). The wrapped call is `IMessageBus.PublishAsync`, so
what sits behind the breaker is whichever bus the host registers: the broker in a distributed host,
and `InProcessMessageBus`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/InProcessMessageBus.cs:19`, the default
`TryAddScoped` registration at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:321`)
in a monolith. That bus calls the same `IDomainEventDispatcher` (`InProcessMessageBus.cs:25`), so in a
monolith integration events pass through the breaker and only the non-integration domain-event branch
is outside it. The inline comment at `OutboxProcessor.cs:682-684` ("Only the broker hop is wrapped",
because an in-process call "has no transport to be dead") describes the distributed case only; in a
monolith the wrapped call is itself an in-process dispatch.

Its parameters live in `MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/BrokerResilienceDefaults.cs`
(`:24`) as static properties: `FailureRatio` 0.5 (`:32`), `MinimumThroughput` 10 (`:40`),
`SamplingDuration` 30 seconds (`:47`), `BreakDuration` 15 seconds (`:55`). The pipeline is a breaker
with **no retry strategy paired with it** (`BrokerResilienceDefaults.cs:17-22`,
`OutboxProcessor.cs:96-97`), because the outbox already is the retry: adding a Polly retry inside a
loop that re-leases and retries would multiply the attempt count without changing the outcome.
`ShouldHandle` excludes `OperationCanceledException` (`:876-877`) so a host shutdown never counts
toward opening the circuit.

**`BrokenCircuitException` follows the ordinary failure path.** It is caught by the same
`catch (Exception ex)` as any publish failure (`:532`, after the shutdown-cancellation rethrow at
`:524-531`), increments `RetryCount` (`:534`), records `LastError` (`:535`) and re-leases the row with
the usual backoff (`:543-544`); it dead-letters only on `RetryCount >= MaxRetries` like everything else
(`:568`). Only observability differs: the run sets `circuitOpen` (`:554`), increments
`broker.circuit.open.count` (`:557-559`), writes one `LogBrokerCircuitOpen` line naming the data source
**per batch** rather than per message (latch at `:480`, logged at `:562-566`, defined at `:945-946`),
and suppresses the per-message retry log for those rows (`:579-583`). A batch here is one
`DispatchMessagesAsync` call for one data-source target (`:467-474`), and each row's outcome is
persisted by `RecordOutcomeAsync` outside the `try` (`:592`). A short-circuited publish is a failed publish, not a
new category of one; what the breaker buys in a distributed host is that it fails in microseconds
instead of a connection timeout, and that the log volume during an outage is one line per batch instead of one per message.

### A database circuit breaker was considered and rejected in this wave
The obvious symmetric move is a breaker on the query path, so a failing database sheds load instead of
queueing on it. It is **not** being made. A repository-wide search for `CircuitBreaker`,
`BrokenCircuitException` and `ResiliencePipeline` across `Source` finds the outbox breaker above and
otherwise only the HTTP and gRPC standard resilience handlers and the defaults they read
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:127,138-141`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:170-179`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:16`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/GrpcResilienceDefaults.cs:21`,
`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:49,52`), plus one doc comment that
names `BrokenCircuitException` as a client-side transport fault the UI result executor classifies
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/HttpResultExecutor.cs:124`, in the
doc comment at `:118-126` on `IsTransportFault` at `:127-128`), which is
not a breaker. There is no breaker in any persistence path and none is added here.

The reason is that EF Core's connection resiliency and a Polly breaker do not compose: the
`EnableRetryOnFailure` execution strategy
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:63-66`,
5 retries, 10-second maximum delay) owns retrying at the EF layer, and it constrains how a
user-initiated transaction may be written (`SQLServerDbContext.cs:60-62`,
`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IUnitOfWork.cs:47-59`), which
is why `DbContextFactory` materializes the strategy explicitly
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:576`). Wrapping a breaker around a call that is
already being retried inside the strategy would either count one logical failure many times or force
the strategy to be replaced. That
is an EF execution-strategy rework, a much larger change than a breaker, and it is not what this wave
was for. **The EF retry strategy plus `CommandTimeoutSeconds` remains the database resilience
posture** on both relational engines (SQL Server at `SQLServerDbContext.cs:55`, `:63-66`; PostgreSQL at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/PostgreSQLDbContext.cs:66`,
`:74-77`, the same 5 retries and 10-second maximum delay), recorded here so the asymmetry is a decision
rather than an oversight. The Sqlite and Cosmos contexts (`SqliteDbContext.cs`, `CosmosDbContext.cs`)
configure neither an EF retry strategy nor a command timeout, so on those engines the posture is the
provider default.

## Rationale
- **The transport asymmetry follows a real capability difference, not a preference.** RabbitMQ needs a
  plugin the dev container lacks; Service Bus does not. A single default would be wrong for one of
  them either way, so the setting exists to express exactly that difference, and the flag lives on the
  transport that needs it rather than becoming a knob the production transport has to be told to turn.
- **Default-off protects the first-run experience, which is the one that has to work.** A developer
  cloning a repository and pressing `F5` is the worst audience for a bus-start failure explaining a
  RabbitMQ plugin. The cost is that a RabbitMQ production deployment must opt in deliberately.
- **A fault consumer that only observes is the correct scope.** Retry policy already exists twice
  (MassTransit's immediate retry, and now delayed redelivery). A third recovery mechanism hidden in a
  fault handler would make the delivery guarantee unreadable. Making the exhausted message *visible*
  is the missing capability; recovering it is a decision for a human with the log line in hand.
- **Auto-registration is what makes the observability real.** An opt-in fault consumer would be
  registered on the consumers someone remembered, which is the audit-the-inventory failure this
  workspace keeps recording against its opt-in capabilities. Defaulting the parameter to `true`
  inverts it: a host has to argue its way out.
- **A breaker on the publish is worth it precisely because the outbox already retries.** The breaker
  adds no delivery guarantee at all. It converts a broker outage from N connection timeouts per batch
  into N microsecond short-circuits, and the log from one line per message into one per batch. That is
  a cost and a noise fix, and it is honest to describe it as only that. It holds for a host with a
  broker; in a monolith there is no connection to time out, so the latency saving does not apply
  and the breaker's remaining effect is the one recorded under Trade-offs.
- **Feeding `BrokenCircuitException` into the normal path keeps one retry ladder.** A special case
  would give short-circuited rows a different retry count, a different backoff, or a different
  dead-letter threshold, and the outbox would then have two failure taxonomies to reason about during
  an incident.
- **Recording the database rejection is the point of recording it.** An engineer who finds a breaker
  on the broker and none on the database will otherwise conclude the second was forgotten and add it.

## Trade-offs
- **Delayed redelivery is off where the plugin problem lives.** RabbitMQ is the local transport and
  also a plausible self-hosted production transport; both get default-off, so the deployment shape most
  likely to run without second-level redelivery is the one that is not Azure Service Bus. Nothing
  warns a RabbitMQ host that the feature it never enabled is not running.
- **The intervals are not validated at startup.** `RedeliveryIntervalsSeconds` sits outside the
  ADR-070 fail-fast chain, so a typo becomes a filtered-out entry at
  `DependencyInjection.Messaging.cs:381-384` rather than a refusal to boot. An operator who writes
  `[0, 0, 0]` silently gets no delayed redelivery at all.
- **An hour-long redelivery window widens the duplicate window with it.** A message redelivered at
  `+3600s` runs its handlers an hour after the original attempt, so ADR-021's inbox and every
  idempotent handler must stay correct across that span, not across a retry burst. Anything that was
  implicitly time-bounded by "retries finish in seconds" no longer is.
- **The fault consumer observes and stops there.** `broker.fault.count` incrementing means a message
  is in the error queue and will stay there until someone acts. No alert is wired to it in this
  record, no runbook section exists for it ([ADR-062](062-slo-alerting-as-code.md)), and no automated
  replay path is provided. The gap moved from invisible to visible-and-unactioned.
- **There is no host-wide way to turn fault consumers off.** The opt-out is per event type at the
  registration call, which is deliberate (see Rationale) and is also friction: a host that wanted to
  silence fault logging across the board would have to edit every `RegisterIntegrationEventConsumer`
  call rather than flip one setting.
- **`BrokerMetrics` is `internal` and its meter name is written twice.** A consumer cannot reference
  the class to add its own instruments to the meter, and the `MMCA.Common.Aspire` copy of the name
  (`Extensions.Telemetry.cs:311`) can drift from the Infrastructure declaration with no compiler error and
  no test: the symptom would be a meter that exports nothing.
- **The breaker is per processor instance, so its state is not shared.** The pipeline is a per-instance
  field (`OutboxProcessor.cs:105`, rationale `:98-103`), so with N replicas the broker sees up to N
  independent circuits and the effective failure threshold is N times the configured one, the same
  per-replica caveat ADR-019 records for the rate limiter.
- **In a monolith, failing handlers can open a "broker" circuit in a host with no broker.**
  `DomainEventDispatcher.DispatchAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/DomainEventDispatcher.cs:46-86`) has no
  catch, so an exception from an in-process integration-event handler surfaces through
  `InProcessMessageBus` into the breaker, and `ShouldHandle` counts every exception except
  cancellation (`OutboxProcessor.cs:876-877`). Enough handler failures inside the sampling window open
  the circuit for 15 seconds, deferring every integration event from that processor (not only the
  failing type), incrementing `broker.circuit.open.count` (`:557-559`) and writing the Warning
  "Broker circuit is open for data source ..." (`:562-566`, `:945`) although no broker exists.
- **Fifteen seconds of break can be worse than none for a slow broker.** With a 0.5 failure ratio over
  a 30-second window and a 10-request minimum, a broker that is degraded rather than down trips the
  circuit repeatedly, and each open period defers work the processor would partly have completed. The
  parameters are defaults chosen for an outage, not tuned against a brownout, and nothing measures the
  brownout case today.
- **The database keeps a different resilience model.** Retry-inside-EF for the database, breaker plus
  outbox retry for the broker. Both are defensible individually and together they mean there is no
  single answer to "what does this service do when a dependency fails".

## Revision (2026-10-01)
No decision or rationale changed. The broker transport wiring now lives in
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs` (`ConfigureBrokerTransport`
at `:258`, `BuildRedeliveryIntervals` at `:375-378`) rather than `DependencyInjection.cs`, and the Aspire
meter subscription moved to `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:307-315`,
where `MMCA.Common.Broker` (`:311`) is one of several `MMCA.Common.*` meters rather than a third beside
`MMCA.Common.Cqrs` and `MMCA.Common.Outbox`; the Decision sentence that called it the third meter is corrected.
Citations into `MessageBusSettings.cs`, `OutboxProcessor.cs`, the gRPC and Aspire resilience handlers and
`DbContextFactory.cs:605` are refreshed, and the circuit-breaker search now also lists the typed HTTP service
client's standard handler (`DependencyInjection.Messaging.cs:167-172`), which leaves the "no persistence
breaker" finding unchanged.

## Revision (2026-10-06)
- The database-breaker search result now also names the one non-breaker hit it returns: a doc comment in
  `HttpResultExecutor.cs:122` that lists `BrokenCircuitException` as a client-side transport fault. The
  "no persistence breaker" finding is unchanged.
- The fault-consumer registration paragraph notes that the upcasted-consumer overload carries the same
  per-event `registerFaultConsumer` parameter (`IntegrationEventConsumerExtensions.cs:124`, `:134`); the
  per-event-only opt-out still holds.
- Anchors re-verified against current source: `ConfigureBrokerTransport` is now at
  `DependencyInjection.Messaging.cs:264` and `BuildRedeliveryIntervals` at `:381-384`, the typed client
  handler at `:170-179`, and `DbContextFactory.cs:576` replaces `:605` (both recorded in the 2026-10-01
  Revision); the `OutboxProcessor.cs`, `IntegrationEventConsumerExtensions.cs` and `IUnitOfWork.cs`
  citations in the live sections are refreshed.

## Revision (2026-10-07)
Re-verified against current source. No decision changed: the outbox still holds a breaker-only
Polly pipeline with no retry strategy, `BrokenCircuitException` still follows the ordinary failure
path, and there is still no breaker in any persistence path. What moved is the `OutboxProcessor.cs`
layout (the publish now sits in `DeliverAsync`, and each row's outcome is persisted by
`RecordOutcomeAsync`), plus three clarifications the earlier text left implicit; the first narrows
the publish rationale to distributed hosts and adds one trade-off.

1. The breaker wraps `IMessageBus.PublishAsync`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:687`),
   so in a monolith, where the registered bus is `InProcessMessageBus`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/InProcessMessageBus.cs:19`, registered
   by default at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:321`) and
   dispatches through `IDomainEventDispatcher` (`InProcessMessageBus.cs:25`), integration events still
   pass through it; only the non-integration domain-event branch (`OutboxProcessor.cs:691-695`) is
   outside it. The Decision heading and intro now say "integration-event publish" rather than "broker
   publish", the inline comment at `OutboxProcessor.cs:682-684` is recorded as describing the
   distributed case only, the Rationale's connection-timeout argument is scoped to hosts with a
   broker, and a Trade-off records that `DomainEventDispatcher.DispatchAsync`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/DomainEventDispatcher.cs:46-86`, no
   catch) lets failing in-process handlers open the circuit, with the counter (`:557-559`) and the
   "Broker circuit is open" Warning (`:945`) firing in a host with no broker.
2. The database posture is engine-specific: SQL Server (`SQLServerDbContext.cs:55`, `:63-66`) and
   PostgreSQL (`PostgreSQLDbContext.cs:66`, `:74-77`) both set `CommandTimeoutSeconds` and
   `EnableRetryOnFailure` with 5 retries and a 10-second maximum delay, while the Sqlite and Cosmos
   contexts configure neither and run on whatever the provider defaults to.
3. The circuit-open log latch is per `DispatchMessagesAsync` call, which is one data-source target
   (`OutboxProcessor.cs:467-474`, latch at `:480`), and the log line names that data source
   (`:945-946`).
4. Anchors re-verified against current source: in `OutboxProcessor.cs` the pipeline field is at `:105`
   (summary `:93-104`, "never the database calls" `:94`, no-retry text `:96-97`, per-instance rationale
   `:98-103`), `BuildBrokerPublishPipeline` at `:868-879` with `ShouldHandle` at `:876-877`,
   `DeliverAsync` at `:676-696` (`ExecuteAsync` `:685-689`, intent comment `:682-684`), and the failure
   path at `:524-531` (shutdown rethrow), `:532`, `:534`, `:535`, `:543-544`, `:554`, `:557-559`,
   `:562-566`, `:568`, `:579-583` and `:592`; the `HttpResultExecutor.cs` doc-comment hit is at `:124`
   (comment `:118-126`, `IsTransportFault` `:127-128`), not `:122`, which also supersedes the `:122`
   recorded in the 2026-10-06 Revision.

## Related
[ADR-003](003-outbox-dual-dispatch.md) (the outbox publish leg this breaker wraps, and the retry,
jittered backoff and dead-lettering that `BrokenCircuitException` reuses unchanged),
[ADR-066](066-broker-transport-selection.md) (the transport selection that makes the asymmetry between
RabbitMQ and Azure Service Bus expressible in one place, and the per-transport retry configuration
these filters sit outside of),
[ADR-021](021-consumer-inbox-idempotency.md) (the consume-edge dedup that must now hold across an
hour-long redelivery gap, not only across a retry burst),
[ADR-009](009-resilience-and-recovery-objectives.md) (the resilience contract this extends from
outbound HTTP and gRPC clients to the broker publish, and whose database posture is explicitly
unchanged), [ADR-041](041-observability-and-telemetry.md) (the meter family
`MMCA.Common.Broker` joins, beside `MMCA.Common.Cqrs` and `MMCA.Common.Outbox`),
[ADR-062](062-slo-alerting-as-code.md) (the alert-and-runbook gate that neither new counter is wired
into yet), [ADR-070](070-fail-fast-configuration-contract.md) (the validation chain
`RedeliveryIntervalsSeconds` sits outside of),
[ADR-054](054-saga-compensation-and-reconciliation.md) (the reconciliation backstop for the work a
poison message never completed, which is what a fault log line ultimately points an operator at).
