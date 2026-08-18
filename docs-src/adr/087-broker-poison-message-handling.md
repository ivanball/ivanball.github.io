# ADR-087: Broker Poison-Message Handling: Second-Level Redelivery and Fault Observability

## Status
Accepted (2026-08-18). **Amends [ADR-009](009-resilience-and-recovery-objectives.md)**: the outbox's
broker publish gains a circuit breaker, which is the first resilience policy this workspace applies to
something other than an outbound HTTP or gRPC client. [ADR-003](003-outbox-dual-dispatch.md)'s retry,
backoff and dead-letter ladder is reused unchanged rather than amended, and
[ADR-021](021-consumer-inbox-idempotency.md)'s dedup contract is untouched. The database resilience
posture is also unchanged, recorded below as an explicit rejection rather than an omission.

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
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:84-87`). Azure
Service Bus, the production transport, has native scheduled delivery and needs no plugin.

## Decision
Three changes, each scoped to one failure: second-level redelivery configured per transport, a fault
consumer with its own meter, and a circuit breaker around the outbox's broker publish and nothing
else.

### Second-level redelivery is transport-aware, and the flag exists only because of RabbitMQ
`MessageBusSettings` gains two members. `EnableDelayedRedelivery`
(`MessageBusSettings.cs:96`) is a `bool` with no initializer, so it **defaults to `false`**, and
`RedeliveryIntervalsSeconds` (`:112`) is an `IReadOnlyList<int>` defaulting to `[60, 600, 3600]`: one
minute, ten minutes, one hour. Both live in the `"MessageBus"` section (`:14`).

The two transports consume them differently, and the asymmetry is the decision:

- **RabbitMQ consults the flag.** `ConfigureBrokerTransport`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:794`) calls
  `cfg.UseDelayedRedelivery(r => r.Intervals(intervals))` inside `UsingRabbitMq` (`:802`) only under
  `if (settings.EnableDelayedRedelivery)` (`:813`, the call at `:818`), with the plugin requirement
  restated at the registration site (`:783-787`, `:809-812`). Default-off is not timidity: the local
  Aspire broker cannot serve it, so a default-on setting would break every developer's first `F5`
  with a bus-start failure, which is the worst possible place to learn about a broker plugin.
- **Azure Service Bus does not consult it.** `UsingAzureServiceBus` (`:832`) calls
  `UseDelayedRedelivery` unconditionally (`:846`), with the reasoning recorded inline (`:839-842`).
  Service Bus schedules natively, there is no plugin to be missing, and a production transport that
  can express "try again in an hour" should always express it. Making the operator opt in would mean
  the environment that most needs the behavior is the one most likely to be running without it.

Two details are worth stating so the words above are not read as stronger than the code.
"Unconditional" means "not gated on the flag": both call sites are still guarded by
`intervals.Length > 0` (`:816`, `:844`), so an operator who configures an empty interval list turns
the feature off everywhere. And `RedeliveryIntervalsSeconds` carries **no** DataAnnotations attribute,
unlike its neighbours `RetryLimit` and the two retry-interval settings, so the ADR-070 fail-fast
chain does not validate it; non-positive entries are filtered at use time in `BuildRedeliveryIntervals`
(`:873-876`) instead. In both transports the redelivery filter is registered **before**
`UseMessageRetry` (`:822`, `:849`), which is what keeps immediate retry innermost and delayed
redelivery outside it.

### A fault consumer makes an exhausted message visible
`FaultIntegrationEventConsumer<TEvent>`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/FaultIntegrationEventConsumer.cs:28-30`)
implements `IConsumer<Fault<TEvent>>`, the message MassTransit publishes when a consumer's retries are
spent. It does exactly two things: writes one source-generated **Error**-level log line naming the
event type and the faulted message id (`:59`, emitted at `:49`, id resolved as
`fault.FaultedMessageId ?? fault.FaultId` at `:40`), and increments a counter (`:51-53`). It never
throws and never replays the failed message (`:19-24`). That restraint is the point: a fault consumer
that tried to recover would be a second, undocumented retry policy layered on the two that already
exist.

Registration is automatic. `RegisterIntegrationEventConsumer<TEvent>`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/IntegrationEventConsumerExtensions.cs:38`)
takes `bool registerFaultConsumer = true` (`:39`) and adds the fault consumer under that guard
(`:46`), so a host that registers a consumer gets fault observability without asking. **That parameter
is the only opt-out, and it is per event type**: there is deliberately no host-wide configuration
switch, so turning fault observability off is a visible `false` at one call site rather than a setting
that silently disarms every consumer in a service.

### One meter, `MMCA.Common.Broker`
`BrokerMetrics` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMetrics.cs:18`)
is an `internal static` class holding a single meter named `MMCA.Common.Broker` (`:21`, `:23`) with
two `Counter<long>` instruments, both in units of `messages` and both tagged `event_type`:
`broker.fault.count` (`:30-33`) and `broker.circuit.open.count` (`:42-45`). It is a third meter beside
`MMCA.Common.Cqrs` and `MMCA.Common.Outbox` ([ADR-041](041-observability-and-telemetry.md)), and the
name is duplicated as a literal in `MMCA.Common.Aspire` (`BrokerMetrics.cs:9-11`) so the Aspire
service defaults can subscribe to it without a package reference.

### A circuit breaker around the outbox broker publish, and nothing else
`OutboxProcessor` holds a per-instance Polly `ResiliencePipeline`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:99`, built
at `:639-650`) and wraps **exactly one call** in it: `state.Bus.PublishAsync(state.Event, ct)`
(`:516-520`). The in-process dispatch branch is deliberately outside it (`:512-515`, `:524`), no
database call is inside the delegate, and the intent is stated at the field (`:88-91`, "never the
database calls").

Its parameters live in `MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/BrokerResilienceDefaults.cs`
(`:24`) as static properties: `FailureRatio` 0.5 (`:32`), `MinimumThroughput` 10 (`:40`),
`SamplingDuration` 30 seconds (`:47`), `BreakDuration` 15 seconds (`:55`). The pipeline is a breaker
with **no retry strategy paired with it** (`BrokerResilienceDefaults.cs:17-22`,
`OutboxProcessor.cs:90-91`), because the outbox already is the retry: adding a Polly retry inside a
loop that re-leases and retries would multiply the attempt count without changing the outcome.
`ShouldHandle` excludes `OperationCanceledException` (`:647-648`) so a host shutdown never counts
toward opening the circuit.

**`BrokenCircuitException` follows the ordinary failure path.** It is caught by the same
`catch (Exception ex)` as any publish failure (`:551`), increments `RetryCount` (`:553`), records
`LastError` (`:554`) and re-leases the row with the usual backoff (`:562-563`); it dead-letters only
on `RetryCount >= MaxRetries` like everything else (`:587`). Only observability differs: the run sets
`circuitOpen` (`:573`), increments `broker.circuit.open.count` (`:576-578`), writes one
`LogBrokerCircuitOpen` line **per batch** rather than per message (`:581-585`), and suppresses the
per-message retry log for those rows (`:598`). A short-circuited publish is a failed publish, not a
new category of one; what the breaker buys is that it fails in microseconds instead of a connection
timeout, and that the log volume during an outage is one line per batch instead of one per message.

### A database circuit breaker was considered and rejected in this wave
The obvious symmetric move is a breaker on the query path, so a failing database sheds load instead of
queueing on it. It is **not** being made. A repository-wide search for `CircuitBreaker`,
`BrokenCircuitException` and `ResiliencePipeline` across `Source` finds the outbox breaker above and
otherwise only the HTTP and gRPC standard resilience handlers
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:99,107`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:16`,
`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:61`). There is no breaker in any
persistence path and none is added here.

The reason is that EF Core's connection resiliency and a Polly breaker do not compose: the
`EnableRetryOnFailure` execution strategy
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:64-67`,
5 retries, 10-second maximum delay) owns retrying at the EF layer, and it constrains how a
user-initiated transaction may be written (`SQLServerDbContext.cs:61-63`,
`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IUnitOfWork.cs:63`), which
is why `DbContextFactory` materializes the strategy explicitly
(`DbContextFactory.cs:526`). Wrapping a breaker around a call that is already being retried inside the
strategy would either count one logical failure many times or force the strategy to be replaced. That
is an EF execution-strategy rework, a much larger change than a breaker, and it is not what this wave
was for. **The EF retry strategy plus `CommandTimeoutSeconds` (`SQLServerDbContext.cs:56`) remains the
database resilience posture**, recorded here so the asymmetry is a decision rather than an oversight.

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
  a cost and a noise fix, and it is honest to describe it as only that.
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
  ADR-070 fail-fast chain, so a typo becomes a filtered-out entry at `:873-876` rather than a refusal
  to boot. An operator who writes `[0, 0, 0]` silently gets no delayed redelivery at all.
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
  (`BrokerMetrics.cs:9-11`) can drift from the Infrastructure declaration with no compiler error and
  no test: the symptom would be a meter that exports nothing.
- **The breaker is per processor instance, so its state is not shared.** The pipeline is a per-instance
  field (`OutboxProcessor.cs:99`, rationale `:92-97`), so with N replicas the broker sees up to N
  independent circuits and the effective failure threshold is N times the configured one, the same
  per-replica caveat ADR-019 records for the rate limiter.
- **Fifteen seconds of break can be worse than none for a slow broker.** With a 0.5 failure ratio over
  a 30-second window and a 10-request minimum, a broker that is degraded rather than down trips the
  circuit repeatedly, and each open period defers work the processor would partly have completed. The
  parameters are defaults chosen for an outage, not tuned against a brownout, and nothing measures the
  brownout case today.
- **The database keeps a different resilience model.** Retry-inside-EF for the database, breaker plus
  outbox retry for the broker. Both are defensible individually and together they mean there is no
  single answer to "what does this service do when a dependency fails".

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
