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
Revised 2026-10-21: the source comments now document that monolith integration events run inside the breaker (the Decision no longer calls the inline comment distributed-only), the circuit-open Warning text is corrected to "Message bus circuit is open", the per-batch log latch is re-anchored in `DispatchRowsAsync`, and anchors are refreshed.
Revised 2026-10-23: the east-west gRPC breaker values moved into `HttpResilienceDefaults` (`Grpc`-prefixed), so the database-breaker search re-anchors the gRPC defaults and handler citations there; the broker breaker is unchanged.
Revised 2026-10-26: redelivery now runs through four pluggable transports (RabbitMQ alone gates it on the flag; Azure Service Bus, Amazon SQS and PostgreSQL apply it unconditionally, SQS with its own 900-second-capped default), `RedeliveryIntervalsSeconds` defaults to `null` with the framework default held separately and `[0]` as the off switch, the fault consumer only Debug-logs faults produced by other assemblies (no Error log, no count), the fault Trade-off records the alerts and runbooks both applications now carry, and anchors are refreshed.
Revised 2026-10-28: anchors refreshed after the MMCA.ADC `infra/OPERATIONS.md` runbook headings moved down one line.

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
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:194-197`). Azure
Service Bus, the production transport, has native scheduled delivery and needs no plugin.

## Decision
Three changes, each scoped to one failure: second-level redelivery configured per transport, a fault
consumer with its own meter, and a circuit breaker around the outbox's integration-event publish
(the broker hop in a distributed host) and nothing else.

### Second-level redelivery is transport-aware, and the flag exists only because of RabbitMQ
`MessageBusSettings` gains two members. `EnableDelayedRedelivery`
(`MessageBusSettings.cs:206`) is a `bool` with no initializer, so it **defaults to `false`**, and
`RedeliveryIntervalsSeconds` (`:240`) is an `IReadOnlyList<int>?` with no initializer, so it is `null`
until configured and the transport's default applies. The framework default is the static
`DefaultRedeliveryIntervalsSeconds` (`:217`), `[60, 600, 3600]`: one minute, ten minutes, one hour. A
configured list replaces that default rather than merging with it (`:224-226`); the property has no
initializer because the configuration binder appends a configured list to a non-null default
(`:228-230`). Both live in the `"MessageBus"` section (`:16`).

Each transport is a pluggable `IBrokerTransport` that decides for itself whether to apply
redelivery, and only RabbitMQ consults the flag
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/BrokerTransportPolicies.cs:18-22`;
the flag's own doc says the same at `MessageBusSettings.cs:200-203`). The asymmetry is the decision:

- **RabbitMQ consults the flag.** `RabbitMqBrokerTransport`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMqBrokerTransport.cs`)
  calls `UsingRabbitMq` (`:24`) and passes
  `applyDelayedRedelivery: settings.EnableDelayedRedelivery` to
  `BrokerTransportPolicies.ApplyReceivePolicies` (`:33`), whose flag overload resolves to an empty
  interval list when the flag is `false` (`BrokerTransportPolicies.cs:37`, `:42`). The plugin
  requirement is restated inline at the call (`RabbitMqBrokerTransport.cs:31-32`) and on the flag
  (`MessageBusSettings.cs:194-197`). Default-off is not timidity: the local
  Aspire broker cannot serve it, so a default-on setting would break every developer's first `F5`
  with a bus-start failure, which is the worst possible place to learn about a broker plugin.
- **Azure Service Bus, Amazon SQS and the built-in PostgreSQL transport do not consult it.**
  `AzureServiceBusTransport`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Messaging/AzureServiceBusTransport.cs`) calls
  `UsingAzureServiceBus` (`:33`) and passes `applyDelayedRedelivery: true` (`:52`), with the reasoning
  in the class doc (`:10-13`); `PostgreSqlBrokerTransport` does the same
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSqlBrokerTransport.cs:104`,
  doc `:24-27`). `AmazonSqsTransport`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Messaging/AmazonSqsTransport.cs`) applies redelivery
  unconditionally too (`:109`) but with its own default, `[60, 300, 900]` (`:55`), because SQS caps a
  message delay at 900 seconds (`:43`). These brokers schedule natively, there is no plugin to be
  missing, and a production transport that can express "try again later" should always express it.
  Making the operator opt in would mean the environment that most needs the behavior is the one most
  likely to be running without it.

Two details are worth stating so the words above are not read as stronger than the code.
"Unconditional" means "not gated on the flag": every transport passes through one shared guard,
`redeliveryIntervals.Count > 0` (`BrokerTransportPolicies.cs:62`), and non-positive entries are
dropped in `BuildRedeliveryIntervals` (`:144-152`, the filter at `:150`; the single-argument overload
at `:131-132` supplies the framework default), so an operator who configures `[0]` turns the feature
off on that transport (an empty array cannot be expressed in configuration,
`MessageBusSettings.cs:225-226`). And `RedeliveryIntervalsSeconds` carries **no** DataAnnotations
attribute, unlike its neighbours `RetryLimit` (`:98`) and the two retry-interval settings (`:105`,
`:111`), so the ADR-070 fail-fast chain does not validate it; the one registration-time check is
Amazon SQS's, which rejects a configured interval over 900 seconds (`AmazonSqsTransport.cs:159-161`).
In every transport the redelivery filter (`BrokerTransportPolicies.cs:65`) is registered **before**
`ApplyMessageRetry` (`:68`, which calls `UseMessageRetry` at `:85`), which is what keeps immediate
retry innermost and delayed redelivery outside it.

### A fault consumer makes an exhausted message visible
`FaultIntegrationEventConsumer<TEvent>`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/FaultIntegrationEventConsumer.cs:38-40`)
implements `IConsumer<Fault<TEvent>>`, the message MassTransit publishes when a consumer's retries are
spent. MassTransit publishes that fault to every service consuming the event, so the consumer first
filters: a fault whose `Host.Assembly` names a different assembly than this host's gets one Debug
line and nothing else (`:49-56`, `:83`), while a fault this host produced, or one missing the
assembly name on either side, is handled (`:27-32`). For those it does exactly two things: writes one
source-generated **Error**-level log line naming the event type, the faulted message id and the
exception messages (`:80`, emitted at `:70`, id resolved as `fault.FaultedMessageId ?? fault.FaultId`
at `:61`), and increments a counter tagged with the faulting assembly (`:72-75`). It never throws and
never replays the failed message (`:18-23`). That restraint is the point: a fault consumer
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
two `Counter<long>` instruments, both in units of `messages` and both tagged `event_type` (the fault
counter also `faulting_assembly`, `FaultIntegrationEventConsumer.cs:75`):
`broker.fault.count` (`:30-33`) and `broker.circuit.open.count` (`:42-45`). It is one of the
`MMCA.Common.*` meters, beside `MMCA.Common.Cqrs` and `MMCA.Common.Outbox` ([ADR-041](041-observability-and-telemetry.md)), and the
name is duplicated as a literal in `MMCA.Common.Aspire`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:309`, a duplication the Infrastructure
declaration records in its own doc comment at `BrokerMetrics.cs:9-11`) so the Aspire service defaults
can subscribe to it without a package reference.

### A circuit breaker around the outbox integration-event publish, and nothing else
`OutboxProcessor` holds a per-instance Polly `ResiliencePipeline`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:118`,
built at `:1077-1088`) and wraps **exactly one call** in it: `state.Bus.PublishAsync(state.Event, ct)`
inside `DeliverAsync` (`:772-794`, the `ExecuteAsync` at `:783-787`, the publish at `:785`). The
branch for a domain event that is not an integration event (`IDomainEventDispatcher`, `:789-793`) is
outside it, no database call is inside the delegate, and the intent is stated at the field
(`:103-117`, "never the database calls" at `:107`). The wrapped call is `IMessageBus.PublishAsync`, so
what sits behind the breaker is whichever bus the host registers: the broker in a distributed host,
and `InProcessMessageBus`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/InProcessMessageBus.cs:19`, the default
`TryAddScoped` registration at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:342`)
in a monolith. That bus calls the same `IDomainEventDispatcher` (`InProcessMessageBus.cs:25`), so in a
monolith integration events pass through the breaker and only the non-integration domain-event branch
is outside it. Both the field summary (`OutboxProcessor.cs:104-107`) and the inline comment at
`:778-782` ("Only the IMessageBus publish is wrapped") state this: the broker hop with broker
messaging, the in-process integration-event handlers on a monolith. The inline comment alone adds the
consequence, that failing handlers can open the breaker too (`:780`); only the pure domain-event
branch is described as having "no transport to be dead".

Its parameters live in `MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/BrokerResilienceDefaults.cs`
(`:24`) as static properties: `FailureRatio` 0.5 (`:32`), `MinimumThroughput` 10 (`:40`),
`SamplingDuration` 30 seconds (`:47`), `BreakDuration` 15 seconds (`:55`). The pipeline is a breaker
with **no retry strategy paired with it** (`BrokerResilienceDefaults.cs:17-22`,
`OutboxProcessor.cs:109-110`), because the outbox already is the retry: adding a Polly retry inside a
loop that re-leases and retries would multiply the attempt count without changing the outcome.
`ShouldHandle` excludes `OperationCanceledException` (`:1085-1086`) so a host shutdown never counts
toward opening the circuit.

**`BrokenCircuitException` follows the ordinary failure path.** It is caught by the same
`catch (Exception ex)` as any publish failure (`:593`, after the shutdown-cancellation rethrow at
`:585-592`), increments `RetryCount` (`:595`), records `LastError` (`:596`) and re-leases the row with
the usual backoff (`:604-605`); it dead-letters only on `RetryCount >= MaxRetries` like everything else
(`:629`). Only observability differs: the run sets `circuitOpen` (`:615`), increments
`broker.circuit.open.count` (`:618-620`), writes one `LogBrokerCircuitOpen` line naming the data source
**per batch** rather than per message (latch at `:538`, logged at `:623-627`, defined at `:1154-1155`),
and suppresses the per-message retry log for those rows (`:640-643`). A batch here is one
`DispatchRowsAsync` pass (`:526`), which `DispatchMessagesAsync` (`:493`) makes once (`:506`) over the
rows claimed for one data-source target (`:247`), and each row's outcome is persisted by
`RecordOutcomeAsync` outside the `try` (`:654`). A short-circuited publish is a failed publish, not a
new category of one; what the breaker buys in a distributed host is that it fails in microseconds
instead of a connection timeout, and that the log volume during an outage is one line per batch instead of one per message.

### A database circuit breaker was considered and rejected in this wave
The obvious symmetric move is a breaker on the query path, so a failing database sheds load instead of
queueing on it. It is **not** being made. A repository-wide search for `CircuitBreaker`,
`BrokenCircuitException` and `ResiliencePipeline` across `Source` finds the outbox breaker above and
otherwise only the HTTP and gRPC standard resilience handlers and the defaults they read
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:141,160-163`, with a doc
comment at `:94` and an inline comment at `:133`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:19,82,88,94`, with
comments at `:62` and `:70`,
`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:60,63`), plus one doc comment that
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
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:602`). Wrapping a breaker around a call that is
already being retried inside the strategy would either count one logical failure many times or force
the strategy to be replaced. That
is an EF execution-strategy rework, a much larger change than a breaker, and it is not what this wave
was for. **The EF retry strategy plus `CommandTimeoutSeconds` remains the database resilience
posture** on both relational engines (SQL Server at `SQLServerDbContext.cs:55`, `:63-66`; PostgreSQL at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/PostgreSQLDbContext.cs:94`,
`:102-105`, the same 5 retries and 10-second maximum delay), recorded here so the asymmetry is a decision
rather than an oversight. The Sqlite and Cosmos contexts (`SqliteDbContext.cs`, `CosmosDbContext.cs`)
configure neither an EF retry strategy nor a command timeout, so on those engines the posture is the
provider default.

## Rationale
- **The transport asymmetry follows a real capability difference, not a preference.** RabbitMQ needs a
  plugin the dev container lacks; Azure Service Bus, Amazon SQS and PostgreSQL schedule natively. A
  single default would be wrong for RabbitMQ or for the others either way, so the setting exists to express exactly that difference, and the flag lives on the
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
  likely to run without second-level redelivery is RabbitMQ, the one transport that gates it. Nothing
  warns a RabbitMQ host that the feature it never enabled is not running.
- **The intervals are not validated at startup on most transports.** `RedeliveryIntervalsSeconds`
  sits outside the ADR-070 fail-fast chain, so a typo becomes a filtered-out entry at
  `BrokerTransportPolicies.cs:150` rather than a refusal to boot. An operator who writes
  `[0, 0, 0]` silently gets no delayed redelivery at all. Amazon SQS is the exception for one case
  only: it refuses to register with a configured interval over its 900-second cap
  (`AmazonSqsTransport.cs:159-161`).
- **An hour-long redelivery window widens the duplicate window with it.** A message redelivered at
  `+3600s` runs its handlers an hour after the original attempt, so ADR-021's inbox and every
  idempotent handler must stay correct across that span, not across a retry burst. Anything that was
  implicitly time-bounded by "retries finish in seconds" no longer is.
- **The fault consumer observes and stops there.** `broker.fault.count` incrementing means a message
  is in the error queue and will stay there until someone acts. Both applications alert on the
  Error log line rather than on the counter (MMCA.ADC `infra/main.bicep:650`, MMCA.Store
  `infra/main.bicep:498`) and document the manual inspect, replay or discard procedure (MMCA.ADC
  `infra/OPERATIONS.md:232`, MMCA.Store `infra/OPERATIONS.md:178`; see
  [ADR-062](062-slo-alerting-as-code.md)), but `broker.fault.count` itself drives no alert and no
  automated replay path is provided. The gap moved from invisible to visible-and-hand-actioned.
- **There is no host-wide way to turn fault consumers off.** The opt-out is per event type at the
  registration call, which is deliberate (see Rationale) and is also friction: a host that wanted to
  silence fault logging across the board would have to edit every `RegisterIntegrationEventConsumer`
  call rather than flip one setting.
- **`BrokerMetrics` is `internal` and its meter name is written twice.** A consumer cannot reference
  the class to add its own instruments to the meter, and the `MMCA.Common.Aspire` copy of the name
  (`Extensions.Telemetry.cs:309`) can drift from the Infrastructure declaration with no compiler error and
  no test: the symptom would be a meter that exports nothing.
- **The breaker is per processor instance, so its state is not shared.** The pipeline is a per-instance
  field (`OutboxProcessor.cs:118`, rationale `:112-115`), so with N replicas the broker sees up to N
  independent circuits and the effective failure threshold is N times the configured one, the same
  per-replica caveat ADR-019 records for the rate limiter.
- **In a monolith, failing handlers can open a "broker" circuit in a host with no broker.**
  `DomainEventDispatcher.DispatchAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/DomainEventDispatcher.cs:46-86`) has no
  catch, so an exception from an in-process integration-event handler surfaces through
  `InProcessMessageBus` into the breaker, and `ShouldHandle` counts every exception except
  cancellation (`OutboxProcessor.cs:1085-1086`). Enough handler failures inside the sampling window
  open the circuit for 15 seconds, deferring every integration event from that processor (not only
  the failing type), incrementing `broker.circuit.open.count` (`:618-620`) and writing the Warning
  "Message bus circuit is open for data source ..." (`:623-627`, `:1154`) although no broker exists.
  The source names this case (the field summary at `:104-107` and the comment at `:778-782`), so
  the behavior is documented rather than incidental.
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

## Revision (2026-10-19)
The error queue now has an operating procedure in both consumer applications. No framework decision
changed: the fault consumer still observes and stops there, and nothing replays automatically. What
moved is the Trade-off that read "no alert is wired to it in this record, no runbook section exists
for it": each application now alerts on the fault log line and documents how to act on it.

1. **Alert-as-code.** Each application declares a scheduled-query alert beside its outbox dead-letter
   rule that matches the static part of the `FaultIntegrationEventConsumer` Error log line, "moved to
   the error queue" (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/FaultIntegrationEventConsumer.cs:57`),
   at severity 2 over a 15-minute window with a zero threshold: MMCA.ADC `infra/main.bicep:634`
   (`adc-prod-alert-broker-error-queue`) and MMCA.Store `infra/main.bicep:494` and `:510`
   (`store-alert-broker-error-queue`). The match is on the log line rather than on
   `broker.fault.count`, so it rides the same log-alert family as the outbox dead-letter rule
   ([ADR-062](062-slo-alerting-as-code.md)).
2. **Runbook.** Each `infra/OPERATIONS.md` carries an error-queue section (MMCA.ADC `:232`, MMCA.Store
   `:175`) with the application's `_error` queue names, derived from its MassTransit endpoint names,
   and three actions: inspect the faulted message, replay it to its source queue, or discard it, with
   when to choose each. Replay is manual, a human decision with the log line in hand, which is the
   posture the Rationale already took.
3. **Still open.** `broker.fault.count` itself drives no alert, and the RabbitMQ default-off redelivery
   Trade-off is unchanged.

## Revision (2026-10-21)
Re-verified against current source. No decision changed: the outbox still holds a per-instance,
breaker-only Polly pipeline around the `IMessageBus` publish, `BrokenCircuitException` still follows
the ordinary failure path, and there is still no breaker in any persistence path. What moved is the
`OutboxProcessor.cs` layout (the per-row loop now lives in `DispatchRowsAsync`) and the source's own
wording about the monolith case and the circuit-open log line.

1. The source now documents the monolith case itself: the field summary
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:101-105`)
   and the inline comment at `:776-780` say the default `InProcessMessageBus` runs integration-event
   handlers inside the breaker, and the inline comment adds that failing handlers can open it
   (`:778`). The Decision's statement that the
   inline comment "describes the distributed case only" is replaced, and the monolith Trade-off notes
   the behavior is documented in source.
2. The circuit-open Warning now reads "Message bus circuit is open for data source {DataSourceName}:
   skipping outbox publishes this cycle and retrying the affected messages on a later one"
   (`OutboxProcessor.cs:1149`); the Trade-off quoting "Broker circuit is open" is corrected.
3. The per-batch log latch now lives in `DispatchRowsAsync` (`:524`, latch `:536`), which
   `DispatchMessagesAsync` calls once per claimed batch (`:504`) for one data-source target (`:245`),
   so "one line per batch" still holds.
4. Anchors re-verified against current source: in `OutboxProcessor.cs` the pipeline field is at `:116`
   (summary `:101-115`, "never the database calls" `:105`, no-retry text `:107-108`, per-instance
   rationale `:110-113`), `BuildBrokerPublishPipeline` at `:1072-1083` with `ShouldHandle` at
   `:1080-1081`, `DeliverAsync` at `:770-792` (`ExecuteAsync` `:781-785`, publish `:783`, domain-event
   branch `:787-791`), the failure path at `:583-590` (shutdown rethrow), `:591`, `:593`, `:594`,
   `:602-603`, `:613`, `:616-618`, `:621-625`, `:627`, `:638-642` and `:652`, and `LogBrokerCircuitOpen`
   at `:1149-1150`; `AddMeter("MMCA.Common.Broker")` at
   `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:312` (meter chain
   `:308-316`); the default `InProcessMessageBus` registration at
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:327`; the gRPC standard
   handler at `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:129` with its
   breaker options at `:148-151`; `CreateExecutionStrategy` at `DbContextFactory.cs:602`; and the
   MMCA.ADC error-queue runbook heading at `infra/OPERATIONS.md:231`, which supersedes the `:232`
   recorded in the 2026-10-19 Revision.

## Revision (2026-10-26)
Re-verified against current source. No decision changed: RabbitMQ still gates second-level
redelivery behind a default-off flag, the fault consumer still observes and stops there, the outbox
still holds a per-instance, breaker-only Polly pipeline around the `IMessageBus` publish, and there
is still no breaker in any persistence path. What moved is the transport wiring (out of
`DependencyInjection.Messaging.cs` into pluggable `IBrokerTransport` classes sharing
`BrokerTransportPolicies`), the shape of the interval setting, and the fault consumer's scope.

1. **Four transports, one gate.** RabbitMQ passes the flag to
   `BrokerTransportPolicies.ApplyReceivePolicies`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMqBrokerTransport.cs:33`);
   Azure Service Bus (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Messaging/AzureServiceBusTransport.cs:52`)
   and the built-in PostgreSQL transport (`PostgreSqlBrokerTransport.cs:104`) pass `true`, and
   Amazon SQS (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Messaging/AmazonSqsTransport.cs:109`)
   applies its own `[60, 300, 900]` default (`:55`) under a 900-second delay cap. The Decision, the
   Rationale's capability bullet and the ADR-066 Related entry no longer describe two transports.
2. **Interval setting.** `RedeliveryIntervalsSeconds` is now `IReadOnlyList<int>?` with no
   initializer (`MessageBusSettings.cs:240`, reason `:228-230`), so it is `null` by default and the
   framework default `[60, 600, 3600]` lives in `DefaultRedeliveryIntervalsSeconds` (`:217`). A
   configured list replaces the default and `[0]` is the off switch, since an empty array cannot be
   expressed in configuration (`:224-226`); the Decision's "empty interval list" wording is replaced.
   One shared guard (`BrokerTransportPolicies.cs:62`) and one non-positive filter (`:150`) serve every
   transport.
3. **Startup validation.** The intervals still carry no DataAnnotations, but Amazon SQS rejects a
   configured interval over 900 seconds at registration (`AmazonSqsTransport.cs:159-161`); the
   Trade-off is narrowed accordingly.
4. **Fault consumer scope.** A fault produced by another assembly returns early with one Debug line,
   no Error log and no count (`FaultIntegrationEventConsumer.cs:49-56`, `:83`); the counter gains a
   `faulting_assembly` tag (`:75`), and the Error text now ends with the exception messages (`:80`).
5. **Fault Trade-off and ADR-062 link.** The Trade-off body still said no alert or runbook existed,
   contradicting the 2026-10-19 Revision; it now cites the alerts (MMCA.ADC `infra/main.bicep:650`,
   MMCA.Store `infra/main.bicep:498`) and runbooks (MMCA.ADC `infra/OPERATIONS.md:231`, MMCA.Store
   `infra/OPERATIONS.md:178`). MMCA.ADC also alerts on `broker.circuit.open.count`
   (`infra/main.bicep:662`, query `:664`, runbook `infra/OPERATIONS.md:384`); MMCA.Store does not, and
   `broker.fault.count` drives no alert in either, so the Related entry for ADR-062 is corrected.
6. Anchors re-verified against current source: `MessageBusSettings.cs` section `:16`, plugin note
   `:194-197`, `EnableDelayedRedelivery` `:206`; `ApplyReceivePolicies` flag overload
   `BrokerTransportPolicies.cs:37`, `:42`, `UseDelayedRedelivery` `:65` before `ApplyMessageRetry`
   `:68` (`UseMessageRetry` `:85`); `FaultIntegrationEventConsumer.cs` class `:38-40`, id `:61`, log
   emitted `:70`, never-throws doc `:18-23`; `AddMeter("MMCA.Common.Broker")` at
   `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:309` (meter chain
   `:305-314`); in `OutboxProcessor.cs` the pipeline field `:118` (summary `:103-117`, "never the
   database calls" `:107`, no-retry `:109-110`, per-instance rationale `:112-115`),
   `BuildBrokerPublishPipeline` `:1077-1088` with `ShouldHandle` `:1085-1086`, `DeliverAsync`
   `:772-794` (`ExecuteAsync` `:783-787`, publish `:785`, domain-event branch `:789-793`, comment
   `:778-782`), the failure path `:585-592`, `:593`, `:595`, `:596`, `:604-605`, `:615`, `:618-620`,
   `:623-627`, `:629`, `:640-643` and `:654`, `DispatchRowsAsync` `:526` (latch `:538`) called at
   `:506` from `DispatchMessagesAsync` (`:493`, called at `:247`), and `LogBrokerCircuitOpen`
   `:1154-1155`; the default `InProcessMessageBus` registration at
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:342`; the Aspire
   standard handler at `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:60` (breaker
   setting `:63`), with the typed-client handler formerly in `DependencyInjection.Messaging.cs` gone
   from the breaker search; and PostgreSQL `CommandTimeout` at `PostgreSQLDbContext.cs:94` with
   `EnableRetryOnFailure` at `:102-105`.

## Revision (2026-10-28)
Re-verified against current source. No decision changed: the fault consumer still observes and stops
there, both applications still alert on the fault log line and document a manual error-queue
procedure, and MMCA.ADC still alerts on the outbox broker breaker. What moved is one MMCA.ADC
runbook anchor cited in the live Trade-offs.

1. Anchors re-verified against current source: the MMCA.ADC error-queue runbook heading is at
   `infra/OPERATIONS.md:232` (the fault Trade-off is re-pointed from `:231`; the MMCA.Store heading
   stays at `infra/OPERATIONS.md:178`), and the MMCA.ADC `adc-prod-alert-outbox-broker-circuit-open`
   runbook heading is at `infra/OPERATIONS.md:385`, superseding the `:384` recorded in the
   2026-10-26 Revision.

## Related
[ADR-003](003-outbox-dual-dispatch.md) (the outbox publish leg this breaker wraps, and the retry,
jittered backoff and dead-lettering that `BrokenCircuitException` reuses unchanged),
[ADR-066](066-broker-transport-selection.md) (the transport selection that makes the asymmetry between
RabbitMQ and the natively scheduling transports (Azure Service Bus, Amazon SQS, PostgreSQL)
expressible per `IBrokerTransport`, and the per-transport retry configuration
these filters sit outside of),
[ADR-021](021-consumer-inbox-idempotency.md) (the consume-edge dedup that must now hold across an
hour-long redelivery gap, not only across a retry burst),
[ADR-009](009-resilience-and-recovery-objectives.md) (the resilience contract this extends from
outbound HTTP and gRPC clients to the broker publish, and whose database posture is explicitly
unchanged), [ADR-041](041-observability-and-telemetry.md) (the meter family
`MMCA.Common.Broker` joins, beside `MMCA.Common.Cqrs` and `MMCA.Common.Outbox`),
[ADR-062](062-slo-alerting-as-code.md) (the alert-and-runbook gate: both applications alert on the
fault log line, MMCA.ADC also on `broker.circuit.open.count`, and `broker.fault.count` drives no
alert), [ADR-070](070-fail-fast-configuration-contract.md) (the validation chain
`RedeliveryIntervalsSeconds` sits outside of),
[ADR-054](054-saga-compensation-and-reconciliation.md) (the reconciliation backstop for the work a
poison message never completed, which is what a fault log line ultimately points an operator at).
