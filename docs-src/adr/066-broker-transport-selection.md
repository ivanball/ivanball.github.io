# ADR-066: Broker Transport Selection and Dev/Prod Parity

## Status
Accepted (2026-08-07). Revised 2026-08-14 (source citations re-anchored; the ADC AppHost comment
that used to say no `WithBroker()` was wired has been corrected in code, so the trade-off recording
it is restated). Revised 2026-09-01 (the Service Bus emulator parity tier is authoritative and
deploy-gating in BOTH consumers, ADC since 2026-08-31 as TD-17 and Store immediately after, so the
"both jobs are continue-on-error" record and the "no gating check exercises the production
transport" trade-off are rewritten; the dedicated `app-clients` SAS sourcing is recorded for both
repos rather than Store alone; and the emulator fixture is now framework code, `ServiceBusEmulatorFixtureBase`
in `MMCA.Common.Testing` since v1.178.0, subclassed by both consumers instead of hand-copied into
each, so the bullet that described a per-repo fixture shape is restated around the shipped base).
The same 2026-09-01 revision records the local Service Bus emulator path, which the Decision did not
mention at all: a second `WithBroker` overload and `AddServiceBusEmulatorBroker` ship in
`MMCA.Common.Aspire.Hosting`, and ADC's AppHost now selects between the two brokers on
`ADC_BROKER=servicebus` rather than calling `WithBroker()` per service, so the local-development
bullet is split in two and the source citations are re-anchored. Revised 2026-09-03 (citations
re-anchored after file moves inside `MMCA.Common`: `MessageBusSettings.cs` now sits under
`Messaging/` and the shared test fixture bases under `MMCA.Common.Testing/Fixtures/`; the Azure
Service Bus emulator host build moved out of `ConfigureBrokerTransport` into the
`ServiceBusEmulatorSupport` helper, so the bullet describing that branch is restated).

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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:199-215`), bound
  from the `MessageBus` section (`:14`) and defaulting to `InProcess` (`:17`). `AddBrokerMessaging`
  returns the container untouched for `InProcess`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:755-758`); for either
  broker value it replaces `IMessageBus` with `BrokerMessageBus` (`:785`) and `IEventBus` with
  `BrokerEventBus` (`:791`), so the outbox becomes the only delivery channel. No application or
  domain code names a transport.
- **Local development defaults to RabbitMQ, wired by the AppHost.** `AddMessageBroker()` provisions
  the RabbitMQ container with the management plugin
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:160-165`), and the
  `WithBroker` overload taking a `RabbitMQServerResource` attaches it to a project resource with
  `WithReference` + `WaitFor` and sets `MessageBus__Provider=RabbitMq` (`:252-262`). Every extracted
  service gets a broker: ADC's four
  (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:132,161,204,232`) and Store's three
  (`MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:130,152,194`, broker at `:48`). The
  developer sets nothing: the orchestrator owns the choice.
- **The same local stack can run the production transport, per developer and opt-in.** A second
  `WithBroker` overload takes a `ServiceBusEmulatorResource` and sets
  `MessageBus__Provider=AzureServiceBus` plus the emulator's AMQP connection string and
  `MessageBus__EmulatorAdminEndpoint` (`Extensions.cs:280-292`, the setting it binds to at
  `MessageBusSettings.cs:49`). The resource is framework code too: `AddServiceBusEmulatorBroker`
  runs the pinned `azure-messaging/servicebus-emulator:2.0.1` container against the AppHost's
  existing SQL Server rather than a second engine (`Extensions.cs:201-238`, image tag at `:107`).
  The infrastructure side keys off one marker and nothing else: when the connection string carries
  `UseDevelopmentEmulator=true`, `ConfigureBrokerTransport` delegates the host build to
  `ServiceBusEmulatorSupport` (`IsEmulatorConnectionString`, then `ConfigureEmulatorHost`), which
  attaches the administration client MassTransit v8 needs; otherwise it takes the production
  `cfg.Host(connectionString)` path unchanged
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:973-987`, delegation
  at `:979-982`, production path at `:986`; the helper is
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/ServiceBusEmulatorSupport.cs`). ADC
  is the consumer wired for it: its AppHost picks the emulator over RabbitMQ when `ADC_BROKER=servicebus`
  is set, then applies that one choice to all four services through a repo-local `WithSelectedBroker`
  helper, because the two overloads take different resource types
  (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:89-101`, rationale at `:66-88`, helper at
  `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/BrokerSelection.cs:21-26`). Unset is the default, so the
  everyday inner loop pays neither the extra container nor its warm-up; Store's AppHost wires
  RabbitMQ unconditionally.
- **Production is Azure Service Bus, injected by Bicep.** Each service container app receives
  `MessageBus__Provider=AzureServiceBus` plus a `MessageBus__ConnectionString` secret reference:
  ADC at `MMCA.ADC/infra/main.bicep:1117-1118` (identity, `:1016`), `:1307-1308` (conference,
  `:1223`), `:1436-1437` (engagement, `:1357`), `:1575-1576` (notification, `:1484`); Store at
  `MMCA.Store/infra/main.bicep:1050-1051` (identity, `:967`), `:1195-1196` (catalog, `:1120`),
  `:1320-1321` (sales, `:1234`). The images are the same ones the AppHost runs locally; only the two environment variables
  differ.
- **One resolution order for the connection string.** `ResolveBrokerConnectionString` prefers an
  explicit `MessageBus:ConnectionString`, then `ConnectionStrings:rabbitmq`, then
  `ConnectionStrings:messaging` (`DependencyInjection.cs:880-889`). Aspire's `WithReference` and
  Bicep's `secretRef` therefore both land on a path the host already reads, and the transport
  selector stays separate from the credential.
- **Retry policy is identical on both transports.** Each branch of `ConfigureBrokerTransport` calls
  `cfg.UseMessageRetry(r => r.Exponential(...))` with the same four arguments before
  `ConfigureEndpoints`: RabbitMQ at `DependencyInjection.cs:961-965`, Azure Service Bus at
  `:1000-1004`. The values come from one settings object: `RetryLimit` 5, `RetryMinIntervalSeconds` 1,
  `RetryMaxIntervalSeconds` 30 (`MessageBusSettings.cs:76,83,89`). Second-level redelivery is the one
  place the two transports diverge by design: Azure Service Bus schedules messages natively, so
  `UseDelayedRedelivery` is applied unconditionally there (`DependencyInjection.cs:994-998`), while
  RabbitMQ keeps it opt-in behind `EnableDelayedRedelivery` (default `false`,
  `MessageBusSettings.cs:179`, documented at `:168-171`) because it needs the
  delayed-message-exchange plugin the Aspire container does not ship
  (`DependencyInjection.cs:948-959`, posture documented in the remarks at `:920-927`).
- **Service Bus Standard tier and `Manage` rights are forced by the topology MassTransit builds.**
  Both namespaces are `Standard`/`Standard` (`MMCA.ADC/infra/main.bicep:716-719`,
  `MMCA.Store/infra/main.bicep:690-693`) because `UsingAzureServiceBus` configures a topic per
  message type plus a subscription per consumer, and Basic supports queues only
  (`MMCA.ADC/infra/main.bicep:707-708`, `MMCA.Store/infra/main.bicep:682-684`). The `app-clients`
  authorization rule carries `Send` + `Listen` + **`Manage`** (`MMCA.ADC/infra/main.bicep:735-739`,
  rule at `:731-741`; `MMCA.Store/infra/main.bicep:709-713`, rule at `:705-715`) so
  `ConfigureEndpoints` can provision that topology at startup; without `Manage` the first publish
  fails with an Unauthorized topology error (`MMCA.ADC/infra/main.bicep:728-729`,
  `MMCA.Store/infra/main.bicep:702-703`). Both repos source the connection string from that dedicated
  rule rather than from `RootManageSharedAccessKey`, so a later move to managed identity can revoke it
  without touching the namespace root (`MMCA.ADC/infra/main.bicep:177-179`,
  `MMCA.Store/infra/main.bicep:137-139`, the same two-line rationale comment above the same
  `serviceBusAuthRule.listKeys().primaryConnectionString` expression in each).
- **Tests use the transport the tier is testing.** A per-service integration host configures no
  provider, so `AddBrokerMessaging` short-circuits and the in-process bus stands
  (`DependencyInjection.cs:755-758`). The cross-service round-trip tier runs the real broker: the
  shared fixture base sets `MessageBus__Provider=RabbitMq` plus
  `ConnectionStrings__rabbitmq` against a Testcontainers RabbitMQ for every host it boots
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/CrossServiceFixtureBase.cs:249-250`).
- **A dedicated emulator tier exists to prove the production binding, and it gates the deploy.** The
  fixture is framework code, not a per-repo copy: `ServiceBusEmulatorFixtureBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/ServiceBusEmulatorFixtureBase.cs`) ships in
  `MMCA.Common.Testing` as of v1.178.0, and both consumers subclass it, supplying only their
  `ReceiveQueueName`, their contract handlers through `ConfigureReceiveEndpoint`, the
  `[CollectionDefinition]` class (per test assembly by construction) and the assertions. The base owns
  everything that was hand-copied on both sides before: the pinned image (`DefaultEmulatorImage`,
  `mcr.microsoft.com/azure-messaging/servicebus-emulator:2.0.1`, 2.x on purpose because the HTTP
  management plane MassTransit provisions its topology through shipped in 2.0.0); the admin-plane
  connection string built against the mapped port 5300 (`AdminPlanePort`,
  `ComposeAdminConnectionString`, pure and static so it is unit-testable without a container); the
  MassTransit v8 bus started through `Bus.Factory.CreateUsingAzureServiceBus` with the custom-clients
  `Host` overload, the only v8 path onto the emulator; and a static constructor lowering MassTransit's
  process-global TTL and auto-delete defaults under the emulator's one-hour quota, which is why the
  tier runs in its own test process. Two shapes the base now enforces rather than suggests: the bus
  lives on the FIXTURE and starts once for the whole tier (a test class implementing `IAsyncLifetime`
  is re-instantiated per `[Fact]`, so a bus created there re-provisions the entire topology through an
  admin plane that throttles at roughly one admin operation per second), and exactly ONE receive
  endpoint is provisioned (`ReceiveQueueName`), so an added contract costs a topic plus a subscription
  rather than another queue. Both startup phases are wall-clock bounded by overridable budgets
  (`ContainerStartTimeout` 4 minutes, `BusStartTimeout` 3 minutes, `BusStopTimeout` 1 minute) that
  throw a named PHASE 1 or PHASE 2 `TimeoutException`: the point is not only failing sooner but
  keeping the evidence, since a step killed by the JOB timeout has its log discarded, which is what
  left ADC's 7-of-7 hang (2026-07-21 to 07-24) unlocalized for a week. Both jobs are **authoritative**
  on the weekday-nightly workflow: neither carries `continue-on-error` (ADC
  `MMCA.ADC/.github/workflows/cross-service-tests.yml:153-157`, rationale `:126-137`, cron `:31`;
  Store's `servicebus-emulator-smoke` job in
  `MMCA.Store/.github/workflows/cross-service-tests.yml`), and each repo's `cross-service-freshness`
  deploy gate requires BOTH the `cross-service` job and the `servicebus-emulator-smoke` job to have
  concluded success in the same nightly run (ADC `MMCA.ADC/.github/workflows/deploy.yml:874`, gate job
  `:815`, in `deploy.needs` at `:1054` and asserted at `:1089`; the Store gate enumerates the same two
  job names in `MMCA.Store/.github/workflows/deploy.yml`). ADC promoted the tier on 2026-08-31 (TD-17)
  and Store followed immediately after, so the transport only production runs is a deploy
  precondition in both apps. Both gates count per-JOB conclusions rather than the run conclusion, so a
  still-advisory job elsewhere in the same workflow cannot drag a proven run down.

Adoption differs by repo. ADC and Store select a broker on every extracted service, local and
production alike. MMCA.Helpdesk stays on `InProcess`: its monolith host calls the same
`AddBrokerMessaging(builder.Configuration)` with no `MessageBus:Provider` configured
(`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:118`), and its AppHost provisions no
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
- **The emulator tier is the only automated pre-production evidence for the production transport.**
  Every other tier that exercises messaging runs on RabbitMQ or in-process, so without it the Azure
  Service Bus binding would first be executed by a deploy. The local `ADC_BROKER=servicebus` stack
  runs the same transport on a developer machine, which is what makes a Service-Bus-only bug
  reproducible in the inner loop, but it is a debugging tool: nothing runs it on a schedule and
  nothing gates on it.

## Trade-offs
- **Two brokers means two behaviors to keep aligned.** Configuration parity is enforced by one code
  path, but the products still differ (Service Bus supports delayed redelivery natively, the Aspire
  RabbitMQ container does not, `DependencyInjection.cs:920-927`), so a transport-specific behavior
  can still be adopted by accident. The local Service Bus emulator narrows that window but does not
  close it: it is opt-in and off by default, so the inner loop a developer actually runs is still the
  divergent one unless they set `ADC_BROKER=servicebus`.
- **The production transport is gated nightly, not per commit.** Both emulator jobs are authoritative
  and both `cross-service-freshness` gates require them (`MMCA.ADC/.github/workflows/deploy.yml:874`
  and the Store equivalent), so a Service-Bus-only regression blocks the next deploy rather than the
  merge that introduced it: the tier needs a Docker daemon the gating jobs do not have, so it runs on
  the weekday nightly and reaches the deploy chain through a recency check. The residual is the window
  between a merge and the nightly that judges it, plus the recency tolerance itself (5 days on ADC, to
  absorb the weekday-only cadence, `MMCA.ADC/.github/workflows/deploy.yml:825`). The sanctioned way
  past a red job is a fix or a dispatched green run, never re-adding `continue-on-error`; the one
  escape hatch is `deploy.yml`'s break-glass `skip_freshness_gates` input, which forces a written
  justification into the run summary.
- **The emulator is not Azure Service Bus.** It imposes its own quotas (the one-hour entity TTL the
  shared fixture base works around in its static constructor,
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/ServiceBusEmulatorFixtureBase.cs`, plus a throttled
  admin plane and a 10-connection namespace quota), so a green
  smoke proves the binding and the topology provisioning, not production behavior at volume.
- **`Manage` rights are broad.** The `app-clients` rule can create and delete entities in the
  namespace, which is the price of letting `ConfigureEndpoints` build the topology instead of
  declaring every topic in Bicep (`MMCA.ADC/infra/main.bicep:731-741`).
- **Provider selection is per host and silent when missing.** A service that never receives
  `MessageBus__Provider` keeps the in-process bus and publishes nothing to the broker, without an
  error (`DependencyInjection.cs:755-758`); correctness depends on auditing the AppHost and the Bicep
  env lists, the same inventory caveat ADR-021 carries for the inbox.
- **The choice lives in AppHost prose that has to be maintained alongside the calls.** The note above
  ADC's Notification registration now states that `WithSelectedBroker(withBroker)` wires the
  transport the same way as the other services, and records that an earlier version of the same note
  said the broker was not wired yet (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:121-123`,
  the call it describes at `:132`). The `ADC_BROKER` opt-in adds a second block of the same kind, a
  23-line rationale above the selection itself (`:66-88`). Keeping the transport decision in
  orchestration code puts the explanation in comments, which are not checked by anything.

## Related
ADR-003 (the outbox that feeds `IMessageBus`; this ADR picks the transport underneath it), ADR-016
(the MassTransit v8 pin the emulator tier must work within, which is why the custom-clients `Host`
overload is used), ADR-008 (module extraction, the reason a broker exists at all), ADR-021 (the
consumer-side inbox that deduplicates broker redeliveries), ADR-006 (database-per-service, the
sibling boundary the broker crosses).
