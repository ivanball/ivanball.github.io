# ADR-066: Broker Transport Selection and Dev/Prod Parity

## Status
Accepted (2026-08-07). Revised 2026-08-14 (source citations re-anchored; the ADC AppHost comment
that used to say no `WithBroker()` was wired has been corrected in code, so the trade-off recording
it is restated).

## Context
ADR-003 decides that integration events leave an aggregate through the outbox and are published by
`OutboxProcessor` via `IMessageBus`, and it settles the *dispatch* question ("in-process for the
monolith, a broker once a module is extracted"). ADR-016 decides the MassTransit **version** (v8, with
a fitness-function gate). Neither decides **which broker actually runs**: local development and
production run different products (RabbitMQ in a container versus a managed Azure Service Bus
namespace), and that difference is exactly the kind of thing that leaks into code, into per-service
appsettings, or into a class of failure that only appears after a deploy.

Three questions were open and are answered here: which transport each environment gets and who
supplies it, what keeps the two transports behaving the same, and how the production-only transport
gets exercised before production sees it.

## Decision
Keep **one** `IMessageBus` abstraction with a **three-value transport selector**, choose the value at
the deployment edge (never in application code), configure both broker transports identically, and
carry a dedicated test tier for the transport that only production uses.

- **Three provider values, one abstraction.** `MessageBusProvider` has exactly `InProcess = 0`,
  `RabbitMq = 1`, `AzureServiceBus = 2`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:116-132`), bound
  from the `MessageBus` section (`:14`) and defaulting to `InProcess` (`:17`). `AddBrokerMessaging`
  returns the container untouched for `InProcess`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:656-659`); for either
  broker value it replaces `IMessageBus` with `BrokerMessageBus` (`:676`) and `IEventBus` with
  `BrokerEventBus` (`:682`), so the outbox becomes the only delivery channel. No application or
  domain code names a transport.
- **Local development is RabbitMQ, wired by the AppHost.** `AddMessageBroker()` provisions the
  RabbitMQ container with the management plugin
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:47-52`), and `WithBroker()`
  attaches it to a project resource with `WithReference` + `WaitFor` and sets
  `MessageBus__Provider=RabbitMq` (`:66-76`). Every extracted service gets it: ADC's four
  (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:93,116,156,181`, broker declared at `:60`)
  and Store's three (`MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:111,132,170`, broker at
  `:44`). The developer sets nothing: the orchestrator owns the choice.
- **Production is Azure Service Bus, injected by Bicep.** Each service container app receives
  `MessageBus__Provider=AzureServiceBus` plus a `MessageBus__ConnectionString` secret reference:
  ADC at `MMCA.ADC/infra/main.bicep:1124-1125` (identity, `:1018`), `:1293` (conference, `:1219`),
  `:1419` (engagement, `:1343`), `:1555` (notification, `:1467`); Store at
  `MMCA.Store/infra/main.bicep:1023-1024` (identity, `:939`), `:1156` (catalog, `:1091`), `:1275`
  (sales, `:1190`). The images are the same ones the AppHost runs locally; only the two environment variables
  differ.
- **One resolution order for the connection string.** `ResolveBrokerConnectionString` prefers an
  explicit `MessageBus:ConnectionString`, then `ConnectionStrings:rabbitmq`, then
  `ConnectionStrings:messaging` (`DependencyInjection.cs:750-759`). Aspire's `WithReference` and
  Bicep's `secretRef` therefore both land on a path the host already reads, and the transport
  selector stays separate from the credential.
- **Retry policy is identical on both transports.** Each branch of `ConfigureBrokerTransport` calls
  `cfg.UseMessageRetry(r => r.Exponential(...))` with the same four arguments before
  `ConfigureEndpoints`: RabbitMQ at `DependencyInjection.cs:822-826`, Azure Service Bus at
  `:849-853`. The values come from one settings object: `RetryLimit` 5, `RetryMinIntervalSeconds` 1,
  `RetryMaxIntervalSeconds` 30 (`MessageBusSettings.cs:43,50,56`). Only in-process retry is
  configured, deliberately not `UseDelayedRedelivery`, because that needs the RabbitMQ
  delayed-message-exchange plugin the Aspire container does not ship
  (`DependencyInjection.cs:769-774`).
- **Service Bus Standard tier and `Manage` rights are forced by the topology MassTransit builds.**
  Both namespaces are `Standard`/`Standard` (`MMCA.ADC/infra/main.bicep:713-716`,
  `MMCA.Store/infra/main.bicep:665-668`) because `UsingAzureServiceBus` configures a topic per
  message type plus a subscription per consumer, and Basic supports queues only
  (`MMCA.ADC/infra/main.bicep:704-705`, `MMCA.Store/infra/main.bicep:656-660`). The `app-clients`
  authorization rule carries `Send` + `Listen` + **`Manage`** (`MMCA.ADC/infra/main.bicep:728-738`,
  `MMCA.Store/infra/main.bicep:680-690`) so `ConfigureEndpoints` can provision that topology at
  startup; without `Manage` the first publish fails with an Unauthorized topology error
  (`MMCA.ADC/infra/main.bicep:725-726`). Store sources the connection string from that dedicated rule
  rather than `RootManageSharedAccessKey`, so a later move to managed identity can revoke it without
  touching the namespace root (`MMCA.Store/infra/main.bicep:136,138`).
- **Tests use the transport the tier is testing.** A per-service integration host configures no
  provider, so `AddBrokerMessaging` short-circuits and the in-process bus stands
  (`DependencyInjection.cs:656-659`). The cross-service round-trip tier runs the real broker: the
  shared fixture base sets `MessageBus__Provider=RabbitMq` plus
  `ConnectionStrings__rabbitmq` against a Testcontainers RabbitMQ for every host it boots
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/CrossServiceFixtureBase.cs:249-250`).
- **A dedicated emulator tier exists to prove the production binding.** ADC's fixture pins
  `mcr.microsoft.com/azure-messaging/servicebus-emulator:2.0.1`
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.ServiceBusEmulator.IntegrationTests/Infrastructure/ServiceBusEmulatorFixture.cs:50`)
  and starts a MassTransit v8 bus through `Bus.Factory.CreateUsingAzureServiceBus` with the
  custom-clients `Host` overload, the only v8 path onto the emulator (`:119-141`); its static
  constructor lowers MassTransit's process-global TTL and auto-delete defaults under the emulator's
  one-hour quota (`:64-71`), which is why the tier runs in its own test process. Store carries the
  parallel tier with the bus created in the test class
  (`MMCA.Store/Tests/Integration/MMCA.Store.ServiceBusEmulator.IntegrationTests/ServiceBusRoundTripSmokeTests.cs:32`).
  Both jobs are `continue-on-error` on the weekday-nightly workflow
  (`MMCA.ADC/.github/workflows/cross-service-tests.yml:150,31`,
  `MMCA.Store/.github/workflows/cross-service-tests.yml:147`), so the smoke informs but never gates a
  deploy.

Adoption differs by repo. ADC and Store select a broker on every extracted service, local and
production alike. MMCA.Helpdesk stays on `InProcess`: its monolith host calls the same
`AddBrokerMessaging(builder.Configuration)` with no `MessageBus:Provider` configured
(`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:97-99`), and its AppHost provisions no
broker, so extraction later is an AppHost change rather than a code change.

## Rationale
- **The transport is a deployment fact, so it lives at the deployment edge.** The only difference
  between a laptop and production is two environment variables set by the AppHost or by Bicep. No
  service has a per-environment appsettings branch for messaging, and nothing has to be rebuilt to
  change transport.
- **RabbitMQ locally is the cheap, offline, inspectable broker.** It is a container with a
  management UI, it starts with the rest of the stack, and it needs no cloud subscription or
  credential to run the real outbox to broker to consumer path on a developer machine.
- **Azure Service Bus in production is the managed one.** It removes broker operations (patching,
  clustering, storage) from a two-app footprint that has no platform team, and the topic model is
  what MassTransit already targets.
- **Identical retry configuration is what makes the two brokers substitutable.** Retry semantics are
  the behavior most likely to differ between transports, so both branches are configured from the
  same settings object with the same call; a difference would have to be introduced deliberately.
- **Tier and rights are recorded because they are not obvious and fail late.** Basic tier and a
  `Send`+`Listen` rule both provision cleanly and then fail at the first publish, in production,
  when MassTransit tries to create a topic. Writing the constraint next to the resource is what keeps
  a cost-trimming pass from "downgrading" the namespace.
- **The emulator tier is the only pre-production evidence for the production transport.** Everything
  else that exercises messaging runs on RabbitMQ or in-process, so without it the Azure Service Bus
  binding would first be executed by a deploy.

## Trade-offs
- **Two brokers means two behaviors to keep aligned.** Configuration parity is enforced by one code
  path, but the products still differ (Service Bus supports delayed redelivery natively, the Aspire
  RabbitMQ container does not, `DependencyInjection.cs:769-774`), so a transport-specific behavior
  can still be adopted by accident.
- **Production runs a transport that no gating check exercises.** The emulator tiers are
  `continue-on-error` on a nightly schedule (`MMCA.ADC/.github/workflows/cross-service-tests.yml:150`,
  `MMCA.Store/.github/workflows/cross-service-tests.yml:147`), so a Service-Bus-only regression can
  merge; the tier is evidence, not a gate.
- **The emulator is not Azure Service Bus.** It imposes its own quotas (the one-hour entity TTL the
  fixture works around at `ServiceBusEmulatorFixture.cs:64-71`, a throttled admin plane), so a green
  smoke proves the binding and the topology provisioning, not production behavior at volume.
- **`Manage` rights are broad.** The `app-clients` rule can create and delete entities in the
  namespace, which is the price of letting `ConfigureEndpoints` build the topology instead of
  declaring every topic in Bicep (`MMCA.ADC/infra/main.bicep:722-727`).
- **Provider selection is per host and silent when missing.** A service that never receives
  `MessageBus__Provider` keeps the in-process bus and publishes nothing to the broker, without an
  error (`DependencyInjection.cs:656-659`); correctness depends on auditing the AppHost and the Bicep
  env lists, the same inventory caveat ADR-021 carries for the inbox.
- **The choice lives in AppHost prose that has to be maintained alongside the calls.** The note above
  ADC's Notification registration now states that `WithBroker(rabbit)` wires the transport the same
  way as the other services, and records that an earlier version of the same note said the broker was
  not wired yet (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:82-84`, the call it describes at
  `:93`). Keeping the transport decision in orchestration code puts the explanation in comments, which
  are not checked by anything.

## Related
ADR-003 (the outbox that feeds `IMessageBus`; this ADR picks the transport underneath it), ADR-016
(the MassTransit v8 pin the emulator tier must work within, which is why the custom-clients `Host`
overload is used), ADR-008 (module extraction, the reason a broker exists at all), ADR-021 (the
consumer-side inbox that deduplicates broker redeliveries), ADR-006 (database-per-service, the
sibling boundary the broker crosses).
