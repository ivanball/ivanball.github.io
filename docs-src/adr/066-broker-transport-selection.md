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
Revised 2026-09-07 (the single shared client SAS is replaced by a rule per service in both
consumers, so broker rights and rotations are scoped to one service). Revised 2026-09-19 (no
`app-clients` rule is named anywhere in either template, so the tier-and-rights bullet, the `Manage`
trade-off and the 2026-09-07 revision are restated around the seven per-service rules that actually
exist and are named here; the claim that a namespace-level rule survives beside them is dropped,
because both templates record the opposite in a comment above the rules). Revised 2026-10-01
(Store's AppHost now carries the same `STORE_BROKER=servicebus` emulator opt-in as ADC, so both
consumers can run the production transport locally; see Revision below). Revised 2026-10-06: the
broker selector both AppHosts use is now the framework's `BrokerSelection` rather than a repo-local
helper, ADC's per-service broker secret is recorded alongside Store's, and anchors are re-verified.
Revised 2026-10-07: ADC's `cross-service-freshness` gate is now a step of one consolidated
`freshness` deploy job rather than a job of its own, so the gate citation is restated, and the ADC
anchors are refreshed after the v1.233.0 release.
Revised 2026-10-19: the Helpdesk broker registration is a `Register` step of
`AddMmcaApplicationPipeline`; anchor re-pointed (see Revision below).
Revised 2026-10-21: anchors refreshed after the Common Aspire hosting, both Bicep templates and both
deploy workflows grew; no change in what they show.
Revised 2026-10-24: `MessageBus:Provider` is a string resolved against registered `IBrokerTransport`s, Azure Service Bus and Amazon SQS are adapter transports, and a configured redelivery list now replaces the default ([ADR-134](134-cloud-neutral-core-vendor-adapters.md)); the Decision's provider, emulator and retry bullets are corrected in place. See Revision (2026-10-24) at the end.
Revised 2026-10-25: `PostgreSql` is a third built-in provider, MassTransit v8's SQL transport on PostgreSQL and the broker option for Google Cloud, recorded as a new Decision bullet with a hand-written Pub/Sub transport as a rejected alternative; the Decision's `AddBrokerMessaging` anchors are re-verified. See Revision (2026-10-25) at the end.
Revised 2026-10-26: anchors refreshed after later Common, AppHost, Bicep and deploy workflow edits moved them; the `CHANGELOG.md` citations now name their release heading. See Revision (2026-10-26) at the end.
Revised 2026-10-28: anchors refreshed after later edits to both Bicep templates and `CHANGELOG.md` moved them; the Store per-app secret names are spelled out. See Revision (2026-10-28) at the end.
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
Keep **one** `IMessageBus` abstraction with a **named transport selector** (three built-in values plus any registered adapter transport), choose the value at
the deployment edge (never in application code), configure both broker transports identically, and
carry a dedicated test tier for the transport that only production uses.

- **Named providers, one abstraction.** `MessageBusSettings.Provider` is a string: `InProcess`,
  `RabbitMq` and `PostgreSql` are built in
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/MessageBusProviders.cs:16`,
  `:19`, `:27`), and `AzureServiceBus` and `AmazonSqs` name the adapter transports MMCA.Common.Azure
  and MMCA.Common.Aws register (see the Revision (2026-10-24) at the end). The value is bound from the `MessageBus` section
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:16`) and
  defaults to `InProcess` (`:25`). `AddBrokerMessaging`
  returns the container untouched for `InProcess`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:57-59`); for any
  broker value it replaces `IMessageBus` with `BrokerMessageBus` (`:114`) and `IEventBus` with
  `BrokerEventBus` (`:120`), so the outbox becomes the only delivery channel. No application or
  domain code names a transport.
- **Local development defaults to RabbitMQ, wired by the AppHost.** `AddMessageBroker()` provisions
  the RabbitMQ container with the management plugin
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:172-177`), and the
  `WithBroker` overload taking a `RabbitMQServerResource` attaches it to a project resource with
  `WithReference` + `WaitFor` and sets `MessageBus__Provider=RabbitMq` (`:264-274`). Every extracted
  service gets a broker: ADC's four
  (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:129,158,201,229`) and Store's three
  (`MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:163,190,251`), each through
  `WithSelectedBroker(withBroker)`. The RabbitMQ branch is framework code: `BrokerSelection.AddSelectedBroker`
  calls `AddMessageBroker().WithLifetime(ContainerLifetime.Persistent)`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/BrokerSelection.cs:70-72`). The developer
  sets nothing: the orchestrator owns the choice.
- **The same local stack can run the production transport, per developer and opt-in.** A second
  `WithBroker` overload takes a `ServiceBusEmulatorResource` and sets
  `MessageBus__Provider=AzureServiceBus` plus the emulator's AMQP connection string and
  `MessageBus__EmulatorAdminEndpoint` (`Extensions.cs:293-305`, the setting it binds to at
  `MessageBusSettings.cs:56`). The resource is framework code too: `AddServiceBusEmulatorBroker`
  runs the pinned `azure-messaging/servicebus-emulator:2.0.1` container against the AppHost's
  existing SQL Server rather than a second engine (`Extensions.cs:213-250`, image tag at `:119`).
  The infrastructure side keys off one marker and nothing else: when the connection string carries
  `UseDevelopmentEmulator=true`, the Azure Service Bus transport delegates the host build to
  `ServiceBusEmulatorSupport` (`IsEmulatorConnectionString`, then `ConfigureEmulatorHost`), which
  attaches the administration client MassTransit v8 needs; otherwise it takes the production
  `cfg.Host(connectionString)` path unchanged
  (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Messaging/AzureServiceBusTransport.cs:16`, delegation
  at `:41-43`, production path at `:48`; the helper is
  `MMCA.Common/Source/Hosting/MMCA.Common.Azure/Messaging/ServiceBusEmulatorSupport.cs:32`). Both
  consumers are wired for it, through one framework selector rather than per-repo code:
  `BrokerSelection` in `MMCA.Common.Aspire.Hosting` (shipped in v1.231.0) reads a named environment
  variable (`IsServiceBusSelected`,
  `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/BrokerSelection.cs:35`), provisions the
  emulator when it reads `servicebus` and RabbitMQ otherwise, and returns an attach delegate
  (`AddSelectedBroker`, `:57`) that `WithSelectedBroker` applies to each service (`:81`). The
  delegate exists because the two `WithBroker` overloads take different resource types, so the choice
  cannot be one variable handed to one call (`:13-17`). ADC's AppHost makes that choice once on
  `ADC_BROKER` (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:98`, rationale at `:69-97`) and
  Store's on `STORE_BROKER` (`MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:79`, rationale at
  `:50-78`). Unset is the default in both, so the everyday inner loop pays neither the extra container
  nor its warm-up.
- **Production is Azure Service Bus, injected by Bicep.** Each service container app receives
  `MessageBus__Provider=AzureServiceBus` plus a `MessageBus__ConnectionString` secret reference:
  ADC at `MMCA.ADC/infra/main.bicep:1980-1981` (identity, `:1858`), `:2205-2206` (conference,
  `:2111`), `:2349-2350` (engagement, `:2264`), `:2502-2503` (notification, `:2399`); Store at
  `MMCA.Store/infra/main.bicep:1608-1609` (identity, `:1515`), `:1776-1777` (catalog, `:1697`),
  `:1912-1913` (sales, `:1821`). Every service in both repos reads its own per-service secret: Store
  names a distinct secret reference per app (`service-bus-connection-string-identity`, `-catalog`,
  `-sales`), while ADC keeps the plain name `service-bus-connection-string` and resolves it to the
  Key Vault secret belonging to that one service (`MMCA.ADC/infra/main.bicep:1772-1791`, rationale at
  `:1769-1771`; each app's secret entry at `:1885`, `:2138`, `:2290`, `:2436`). The images are the same ones the AppHost runs locally; only the two environment variables
  differ.
- **PostgreSQL is a built-in broker for any host whose database can carry one.**
  `MessageBus:Provider=PostgreSql` selects `PostgreSqlBrokerTransport`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSqlBrokerTransport.cs:40`,
  name at `:43`), returned by `ResolveBrokerTransport` without an adapter call
  (`DependencyInjection.Messaging.cs:195-197`). It is MassTransit v8's SQL transport, which keeps
  queues, topics, subscriptions and scheduled messages in tables and functions of one PostgreSQL
  database, so any PostgreSQL is the broker (`PostgreSqlBrokerTransport.cs:10-14`), and it is the
  broker option for Google Cloud, which has no MassTransit v8 Pub/Sub transport
  (`MMCA.Common/CHANGELOG.md:129`, under `[1.257.0]`). It reads the shared broker connection string and fails at
  registration without one (`PostgreSqlBrokerTransport.cs:113-119`). When an
  `INpgsqlDataSourceConfigurator` is registered the bus runs on the shared `NpgsqlDataSource` for that
  connection string, otherwise on the string itself (`:94-102`), so an IAM token provider reaches the
  broker too ([ADR-113](113-postgresql-as-a-first-class-engine.md) decision 10). MassTransit's schema
  migrator opens its own connections from the connection string and cannot take that data source
  (`:33-37`), so `MessageBus:PostgreSql:MigrateOnStartup` (default `true`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSqlTransportSettings.cs:36`)
  lets an IAM-only host create the schema from a separate deployment step. The optional
  `MessageBus:PostgreSql:Schema` and `Role` keys (`:20`, `:26`, section at `:11`) both default to
  `transport` (`:14`, `:39`, `:42`). When the migration runs, its hosted service is registered ahead of
  the bus so the tables exist before any endpoint starts (`PostgreSqlBrokerTransport.cs:54-76`, called
  from `AddBrokerMessaging` at `DependencyInjection.Messaging.cs:78-80`).
- **One resolution order for the connection string.** `ResolveBrokerConnectionString` prefers an
  explicit `MessageBus:ConnectionString`, then `ConnectionStrings:rabbitmq`, then
  `ConnectionStrings:messaging` (`DependencyInjection.Messaging.cs:264`). Aspire's `WithReference` and
  Bicep's `secretRef` therefore both land on a path the host already reads, and the transport
  selector stays separate from the credential.
- **Retry policy is identical on every transport.** Each transport calls the shared
  `BrokerTransportPolicies.ApplyReceivePolicies`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/BrokerTransportPolicies.cs:37`,
  `:56`), which applies delayed redelivery when the interval list is non-empty (`:62`-`:66`), then the
  exponential `UseMessageRetry` through `ApplyMessageRetry` (`:68`, defined at `:80`, retry at `:85`),
  then `ApplyBackpressure` (`:69`, defined at `:103`). The values come from one settings object:
  `RetryLimit` 5, `RetryMinIntervalSeconds` 1, `RetryMaxIntervalSeconds` 30
  (`MessageBusSettings.cs:99,106,112`). Second-level redelivery is the one place the transports diverge
  by design: Azure Service Bus schedules messages natively, so it always asks for delayed redelivery
  (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Messaging/AzureServiceBusTransport.cs:52`), as does
  the PostgreSQL transport, whose SQL broker delays a message natively
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSqlBrokerTransport.cs:104`,
  rationale at `:24-27`), while RabbitMQ passes `EnableDelayedRedelivery`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMqBrokerTransport.cs:33`;
  default `false`, `MessageBusSettings.cs:206`) because it needs the delayed-message-exchange plugin the
  Aspire container does not ship.
- **Service Bus Standard tier and `Manage` rights are forced by the topology MassTransit builds.**
  Both namespaces are `Standard`/`Standard` (`MMCA.ADC/infra/main.bicep:1273-1276`,
  `MMCA.Store/infra/main.bicep:1083-1086`) because `UsingAzureServiceBus` configures a topic per
  message type plus a subscription per consumer, and Basic supports queues only
  (`MMCA.ADC/infra/main.bicep:1264-1265`, `MMCA.Store/infra/main.bicep:1075-1077`). There is no shared
  client rule: each container app owns a namespace authorization rule of its own, and every one of
  them carries `Send` + `Listen` + **`Manage`**. ADC declares four (`identity-service`,
  `conference-service`, `engagement-service`, `notification-service` at
  `MMCA.ADC/infra/main.bicep:1313`, `:1325`, `:1337`, `:1349`, rights at `:1317-1321` and repeated
  identically on the other three); Store declares three (`catalog-app`, `sales-app`, `identity-app`
  at `MMCA.Store/infra/main.bicep:1119`, `:1131`, `:1143`, rights at `:1123-1127`). `Manage` is on
  all seven so `ConfigureEndpoints` can provision that topology at startup; without it the first
  publish fails with an Unauthorized topology error, which is why neither template drops it
  (`MMCA.ADC/infra/main.bicep:1286-1298`, `MMCA.Store/infra/main.bicep:1109-1118`). Neither repo
  sources a connection string from `RootManageSharedAccessKey`, so a later move to managed identity
  can revoke these without touching the namespace root: each service reads its own
  `listKeys().primaryConnectionString` variable, four of them under a four-line rationale comment in
  ADC (`MMCA.ADC/infra/main.bicep:227-230`, variables at `:231-234`) and three under a five-line one
  in Store (`MMCA.Store/infra/main.bicep:158-162`, variables at `:163-165`).
- **Tests use the transport the tier is testing.** A per-service integration host configures no
  provider, so `AddBrokerMessaging` short-circuits and the in-process bus stands
  (`DependencyInjection.Messaging.cs:57-59`). The cross-service round-trip tier runs the real broker: the
  shared fixture base sets `MessageBus__Provider=RabbitMq` plus
  `ConnectionStrings__rabbitmq` against a Testcontainers RabbitMQ for every host it boots
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/CrossServiceFixtureBase.cs:255-256`).
- **A dedicated emulator tier exists to prove the production binding, and it gates the deploy.** The
  fixture is framework code, not a per-repo copy: `ServiceBusEmulatorFixtureBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Azure/Fixtures/ServiceBusEmulatorFixtureBase.cs:54`) ships in
  `MMCA.Common.Testing.Azure` (it was in `MMCA.Common.Testing` from v1.178.0 until v1.255.0), and both consumers subclass it, supplying only their
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
  on the weekday-nightly workflow: neither carries `continue-on-error` (ADC jobs
  `MMCA.ADC/.github/workflows/cross-service-tests.yml:79` and `:142`, rationale `:116-126`, cron `:32`;
  Store's `servicebus-emulator-smoke` job in
  `MMCA.Store/.github/workflows/cross-service-tests.yml`), and each repo's `cross-service-freshness`
  deploy gate requires BOTH the `cross-service` job and the `servicebus-emulator-smoke` job to have
  concluded success in the same nightly run (ADC `MMCA.ADC/.github/workflows/deploy.yml:901-904`, Store
  `MMCA.Store/.github/workflows/deploy.yml:843-846`). In both repos the gate is a step (ADC `:886`,
  Store `:828`) of one consolidated `freshness` job (ADC `:833`, Store `:777`), and the deploy asserts
  `needs.freshness.result == 'success'` (ADC `:1195`, with `freshness` in `deploy.needs` at `:1161`;
  Store `:1129`, `deploy.needs` at `:1099`). ADC
  promoted the tier on 2026-08-31 (TD-17)
  and Store followed immediately after, so the transport only production runs is a deploy
  precondition in both apps. Both gates count per-JOB conclusions rather than the run conclusion, so a
  still-advisory job elsewhere in the same workflow cannot drag a proven run down.

Adoption differs by repo. ADC and Store select a broker on every extracted service, local and
production alike. MMCA.Helpdesk stays on `InProcess`: its monolith host calls the same
`AddBrokerMessaging(builder.Configuration)` with no `MessageBus:Provider` configured, as a
`.Register(s => s.AddBrokerMessaging(builder.Configuration))` step of its application pipeline
(`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:139`), and its AppHost provisions no
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
  Service Bus binding would first be executed by a deploy. The local `ADC_BROKER=servicebus` (or
  `STORE_BROKER=servicebus`) stack
  runs the same transport on a developer machine, which is what makes a Service-Bus-only bug
  reproducible in the inner loop, but it is a debugging tool: nothing runs it on a schedule and
  nothing gates on it.

## Trade-offs
- **Two brokers means two behaviors to keep aligned.** Configuration parity is enforced by one code
  path, but the products still differ (Service Bus supports delayed redelivery natively, the Aspire
  RabbitMQ container does not, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/RabbitMqBrokerTransport.cs:33`), so a transport-specific behavior
  can still be adopted by accident. The local Service Bus emulator narrows that window but does not
  close it: it is opt-in and off by default, so the inner loop a developer actually runs is still the
  divergent one unless they set `ADC_BROKER=servicebus` or `STORE_BROKER=servicebus`.
- **The production transport is gated nightly, not per commit.** Both emulator jobs are authoritative
  and both `cross-service-freshness` gates require them (`MMCA.ADC/.github/workflows/deploy.yml:901-904`
  and the Store equivalent), so a Service-Bus-only regression blocks the next deploy rather than the
  merge that introduced it: the tier needs a Docker daemon the gating jobs do not have, so it runs on
  the weekday nightly and reaches the deploy chain through a recency check. The residual is the window
  between a merge and the nightly that judges it, plus the recency tolerance itself (5 days on ADC, to
  absorb the weekday-only cadence, `MMCA.ADC/.github/workflows/deploy.yml:899`). The sanctioned way
  past a red job is a fix or a dispatched green run, never re-adding `continue-on-error`; the one
  escape hatch is `deploy.yml`'s break-glass `skip_freshness_gates` input (ADC `:13`,
  `MMCA.Store/.github/workflows/deploy.yml:26`), which forces a written
  justification into the run summary.
- **The emulator is not Azure Service Bus.** It imposes its own quotas (the one-hour entity TTL the
  shared fixture base works around in its static constructor,
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Azure/Fixtures/ServiceBusEmulatorFixtureBase.cs:70`, plus a throttled
  admin plane and a 10-connection namespace quota), so a green
  smoke proves the binding and the topology provisioning, not production behavior at volume.
- **`Manage` rights are broad, and splitting the credential did not narrow them.** Every per-service
  rule can create and delete entities anywhere in the namespace, which is the price of letting
  `ConfigureEndpoints` build the topology instead of declaring every topic in Bicep
  (`MMCA.ADC/infra/main.bicep:1313-1359`, `MMCA.Store/infra/main.bicep:1119-1153`). Both templates
  record the residual next to the rules: a compromised container still holds namespace-wide
  `Send` + `Listen` + `Manage`, so per-service rules buy credential separation and revocability, not
  privilege reduction (`MMCA.ADC/infra/main.bicep:1300-1312`, `MMCA.Store/infra/main.bicep:1109-1118`).
- **Provider selection is per host and silent when missing.** A service that never receives
  `MessageBus__Provider` keeps the in-process bus and publishes nothing to the broker, without an
  error (`DependencyInjection.Messaging.cs:57-59`); correctness depends on auditing the AppHost and the Bicep
  env lists, the same inventory caveat ADR-021 carries for the inbox.
- **The choice lives in AppHost prose that has to be maintained alongside the calls.** The note above
  ADC's Notification registration now states that `WithSelectedBroker(withBroker)` wires the
  transport the same way as the other services, and records that an earlier version of the same note
  said the broker was not wired yet (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:118-120`,
  the call it describes at `:129`). The `ADC_BROKER` opt-in adds a second block of the same kind, a
  rationale above the selection itself that ends in a pointer to the Common `BrokerSelection`
  (`:69-97`, the pointer at `:94-97`), and Store's `STORE_BROKER` opt-in carries its own
  (`MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:50-78`). Keeping the transport decision in
  orchestration code puts the explanation in comments, which are not checked by anything.

## Alternatives rejected
- **A hand-written Google Cloud Pub/Sub transport** (weighed 2026-10-25). An `IBrokerTransport` in
  MMCA.Common.Gcp written directly against the Pub/Sub SDK, because MassTransit v8 ships no Pub/Sub
  transport (`MMCA.Common/CHANGELOG.md:129`, under `[1.257.0]`). Rejected because it would hand-write consumer dispatch,
  retry, delayed redelivery and topology provisioning outside MassTransit for one cloud, the cost
  [ADR-118](118-message-transport-library-policy.md) assigns its raw-SDK floor option, while the
  built-in PostgreSQL transport already gives a Google Cloud host a broker on a PostgreSQL database
  with the shared receive policies
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSqlBrokerTransport.cs:10-14`,
  `:104`). Revisit if a MassTransit v8 Pub/Sub transport ships, or if a Google Cloud deployment needs
  throughput or fan-out that a PostgreSQL broker cannot carry.

## Revision (2026-09-07)
The transport selection is unchanged. The credential topology under it is (SEC-ADC-26 /
SEC-Store-38).

Both repos previously sourced their Service Bus connection strings from one shared authorization
rule on the namespace. Each service now has its own, and the shared rule is gone rather than kept
alongside them: ADC declares `identity-service`, `conference-service`, `engagement-service` and
`notification-service` (`MMCA.ADC/infra/main.bicep:980`, `:992`, `:1004`, `:1016`) and states the
absence in the template itself, "One rule per service (SEC-ADC-26): there is no namespace-wide
shared credential" (`:200`); Store declares `catalog-app`, `sales-app` and `identity-app`
(`MMCA.Store/infra/main.bicep:1005`, `:1017`, `:1029`) under the matching note, "One namespace
authorization rule per container app, and no namespace-wide shared credential" (`:981`). Store's
namespace keeps local auth enabled precisely because those three rules are SAS credentials
(`MMCA.Store/infra/main.bicep:984-985`).

The consequence for this record is operational rather than architectural: dev/prod parity is
unaffected (the emulator tier has no SAS at all), but a rotation is now a per-service action instead
of a synchronized restart of every service on the namespace, and a leaked connection string names
which service leaked it.

## Revision (2026-10-01)
The local Service Bus emulator path is no longer ADC-only. Store's AppHost selects its broker once
on `STORE_BROKER=servicebus`: set, it calls `AddServiceBusEmulatorBroker` over the existing SQL
Server; unset, it keeps `AddMessageBroker()`
(`MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:74-86`, rationale at `:51-73`, which
states that it mirrors ADC's `ADC_BROKER` switch). All three Store services attach through the same
repo-local `WithSelectedBroker(withBroker)` helper ADC uses (`:167`, `:193`, `:239`;
`MMCA.Store/Source/Hosting/MMCA.Store.AppHost/BrokerSelection.cs:21-26`), so the record that
Store's AppHost wires RabbitMQ unconditionally is replaced, and the Rationale and Trade-offs now
name both opt-in variables. The transport decision itself is unchanged: RabbitMQ stays the local
default and nothing schedules or gates on the local emulator stack.

The same pass re-anchors citations that drifted with file growth. The broker registration,
connection-string resolution and transport configuration now live in the partial file
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs`, so every
former `DependencyInjection.cs` anchor points there; the `MessageBusSettings.cs`, both
`main.bicep` templates, the ADC AppHost and workflow files, and the Helpdesk host anchors are
refreshed in place with no change in what they show. Store's Bicep now gives each service its own
`MessageBus__ConnectionString` secret reference (`MMCA.Store/infra/main.bicep:1513`, `:1679`,
`:1811`), consistent with the per-service rules recorded in the 2026-09-07 revision. The ADC
freshness gate now runs through the shared `freshness-gate` composite action
(`MMCA.ADC/.github/workflows/deploy.yml:915`) with the same same-run, per-job requirement
(`:923-926`).

## Revision (2026-10-06)
- The broker selector is framework code now. `BrokerSelection` in `MMCA.Common.Aspire.Hosting`
  (v1.231.0) owns `IsServiceBusSelected`, `AddSelectedBroker` and `WithSelectedBroker`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/BrokerSelection.cs:35`, `:57`, `:81`), and
  neither AppHost keeps a repo-local `BrokerSelection.cs`. Each AppHost selects in one line (ADC
  `Program.cs:94`, Store `Program.cs:78`), so the local-development bullets are restated around the
  Common helper. The 2026-10-01 record of Store's "repo-local helper ADC uses" and its anchors
  (`Program.cs:74-86`, `:51-73`, `:167`, `:193`, `:239`, `BrokerSelection.cs:21-26`) describe that
  date; today they are `Program.cs:78`, `:50-77`, `:162`, `:188`, `:234` and the Common file above.
- ADC, like Store, gives every service its own broker secret: each app's
  `service-bus-connection-string` resolves to a per-service Key Vault secret
  (`MMCA.ADC/infra/main.bicep:1562-1584`), so the production bullet no longer reads as Store-only.
- Both transport branches also apply the same `ApplyBackpressure(cfg, settings)` before
  `ConfigureEndpoints` (`DependencyInjection.Messaging.cs:297`, `:337`), now named in the retry bullet.
- The 2026-09-07 anchors moved: ADC rules are `MMCA.ADC/infra/main.bicep:1109`, `:1121`, `:1133`,
  `:1145` with the "One rule per service" line at `:229`; Store rules are
  `MMCA.Store/infra/main.bicep:1035`, `:1047`, `:1059`, the note at `:1011` and the local-auth
  remark at `:1014-1015`. The 2026-10-01 Store sales secret reference is now `:1814`, and the ADC
  composite action and required jobs are `deploy.yml:962` and `:970-973`.
- Every live-section anchor was re-verified against current source and re-anchored where it drifted.

## Revision (2026-10-07)
Re-verified against current source. The transport decision, the three provider values, the
per-service Standard-tier rules with `Send` + `Listen` + `Manage`, the authoritative emulator tier and
the same-run, two-job deploy requirement are unchanged. What moved is the shape of both repos' deploy
gate and every ADC anchor, shifted by the changes merged on 2026-10-07.

1. Neither repo's `cross-service-freshness` gate is a job of its own any more. Store made the same
   consolidation on the same day: the gate is a step (`MMCA.Store/.github/workflows/deploy.yml:825`)
   of one `freshness` job (`:774`), requires both jobs in the same run (`:840-843`), and the deploy
   asserts `needs.freshness.result == 'success'` (`:1113`). On ADC it is a step
   (`MMCA.ADC/.github/workflows/deploy.yml:870`) of one consolidated `freshness` job (`:817`) that
   runs four freshness steps and fails when any of them fails; `deploy.needs` names `freshness`
   (`:1145`) and the deploy asserts `needs.freshness.result == 'success'` (`:1179`). The step still
   calls the shared composite action (`:877`) with a 5-day window (`:883`) and requires
   `cross-service` and `servicebus-emulator-smoke` in the same run (`:885-888`), so the Decision
   bullet now cites each repo's step and parent job instead of a standalone gate job, and the
   Trade-offs bullet names both repos' `skip_freshness_gates` input.
2. Anchors re-verified against current source: ADC AppHost services
   `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:128`, `:157`, `:200`, `:228`, selection
   `:97`, rationale `:69-96` (Common pointer `:93-96`), Notification note `:117-119`; ADC Bicep
   container apps `MMCA.ADC/infra/main.bicep:1675`, `:1922`, `:2075`, `:2210`, broker env pairs
   `:1791-1792`, `:2016-2017`, `:2160-2161`, `:2313-2314`, per-service Key Vault secrets
   `:1586-1608`, Standard sku `:1089-1092`, Basic rationale `:1080-1081`, rules `:1129`, `:1141`,
   `:1153`, `:1165` (declarations `:1129-1175`, rights `:1133-1137`), `Manage` rationale
   `:1102-1114`, residual risk `:1116-1128`, `listKeys` rationale `:227-230` (the "One rule per
   service" line is `:230`) and variables `:231-234`; ADC cross-service workflow jobs
   `MMCA.ADC/.github/workflows/cross-service-tests.yml:79` and `:142`, authoritative rationale
   `:116-126`, cron `:32`; ADC `deploy.yml` window `:883` and break-glass `skip_freshness_gates`
   input `:13`. The 2026-10-06 revision's anchors and its re-verification note were accurate on
   that date and stay as written.

## Revision (2026-10-19)
Re-verified against current source. The transport decision is unchanged. The Helpdesk monolith host
composes its application pipeline through `AddMmcaApplicationPipeline`
(`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:121`), and the same
`AddBrokerMessaging(builder.Configuration)` call is now its second `Register` step (`:139`), after
module discovery (`:125-133`) so its `Replace` calls still win over the loader's. Helpdesk still
configures no `MessageBus:Provider` and stays on `InProcess`; the Adoption paragraph's dead `:130`
anchor is re-pointed to `:139`.

## Revision (2026-10-21)
Re-verified against current source. The transport decision, the three provider values, the
RabbitMQ and emulator `WithBroker` overloads, the pinned `servicebus-emulator:2.0.1` image, the
Standard-tier namespaces, the seven per-service rules with `Send` + `Listen` + `Manage`, the
per-service `listKeys()` variables and the same-run, two-job deploy gate are unchanged. Only line
anchors moved.

1. Anchors re-verified against current source: `AddMessageBroker`
   `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:172-177`, the RabbitMQ
   `WithBroker` overload `:264-274`, the emulator overload `:292-304`, `AddServiceBusEmulatorBroker`
   `:213-250` with `ServiceBusEmulatorImageTag` at `:119`; Store AppHost service attachments
   `MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:162`, `:189`, `:250` (selection still
   `:78`); ADC Bicep container apps `MMCA.ADC/infra/main.bicep:1825`, `:2078`, `:2231`, `:2366`,
   broker env pairs `:1947-1948`, `:2172-2173`, `:2316-2317`, `:2469-2470`, per-service Key Vault
   secrets `:1736-1758`, Standard sku `:1239-1242`, Basic rationale `:1230-1231`, rules `:1279`,
   `:1291`, `:1303`, `:1315` (declarations `:1279-1325`, rights `:1283-1287`), `Manage` rationale
   `:1252-1264`, residual risk `:1266-1278` (the `listKeys` comment `:227-230` and variables
   `:231-234` did not move); Store Bicep container apps `MMCA.Store/infra/main.bicep:1508`, `:1690`,
   `:1814`, broker env pairs `:1601-1602`, `:1769-1770`, `:1905-1906`, Standard sku `:1078-1081`,
   Basic rationale `:1070-1072`, rules `:1114`, `:1126`, `:1138` (declarations `:1114-1148`, rights
   `:1118-1122`), `Manage` rationale and residual `:1104-1113`, `listKeys` comment `:158-162` and
   variables `:163-165`; ADC `MMCA.ADC/.github/workflows/deploy.yml` `freshness` job `:832`,
   `cross-service-freshness` step `:885`, 5-day window `:898`, required jobs `:900-903`,
   `deploy.needs` `:1160`, assert `:1194` (break-glass input still `:13`); Store
   `MMCA.Store/.github/workflows/deploy.yml` `freshness` job `:776`, step `:827`, required jobs
   `:842-845`, `deploy.needs` `:1098`, assert `:1128` (break-glass input still `:26`). The earlier
   revisions' anchors were accurate on their dates and stay as written.

## Revision (2026-10-24)
[ADR-134](134-cloud-neutral-core-vendor-adapters.md) opens the transport selection to adapters. Which
broker runs where is unchanged: in-process for monoliths, RabbitMQ locally, Azure Service Bus in
production, injected by Bicep.

1. **A string provider and a transport extension point.** `MessageBusSettings.Provider` is a `string`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:25`); the
   `MessageBusProvider` enum is gone, values compare case-insensitively, blank means `InProcess` and a
   numeric value is rejected (`MMCA.Common/CHANGELOG.md:26`). `IBrokerTransport`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/IBrokerTransport.cs:24`) is
   registered through `AddBrokerTransport`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:148`) and
   resolved by name in `AddBrokerMessaging` (`:66`, `ResolveBrokerTransport` at `:177`, RabbitMQ built
   in at `:179`-`:181`). A name with no registered transport throws, naming the package and the call
   (`MessageBusProviders.cs:25`-`:29`; `DependencyInjection.Messaging.cs:199`-`:203`).
2. **Azure Service Bus is an adapter transport.** A host whose provider can be `AzureServiceBus` calls
   `AddAzureServiceBusTransport()`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureServiceCollectionExtensions.cs:117`-`:118`)
   before `AddBrokerMessaging`; it registers `AzureServiceBusTransport`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Messaging/AzureServiceBusTransport.cs:16`, name at
   `:19`), whose emulator and production host paths are the ones the Decision describes (`:41`-`:48`).
3. **Amazon SQS/SNS is a second adapter transport.** `AddAmazonSqsTransport()`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:79`) registers
   `AmazonSqsTransport` under `AmazonSqs`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Messaging/AmazonSqsTransport.cs:37`, `:40`), configured
   under `MessageBus:AmazonSqs` (`AmazonSqsTransportSettings.cs:8`; `MMCA.Common/CHANGELOG.md:12`). Its
   unconfigured redelivery default is `[60, 300, 900]` (`AmazonSqsTransport.cs:55`) under the 900-second
   SQS delay cap (`:43`), a longer configured interval fails `AddBrokerMessaging` (`:159`-`:161`), and the
   `MMCA-*` headers travel in the envelope body rather than as message attributes (`:30`-`:33`,
   `:134`-`:135`). No consumer selects it today.
4. **Redelivery binding fix.** `RedeliveryIntervalsSeconds` is now `IReadOnlyList<int>?` and `null`
   when unconfigured (`MessageBusSettings.cs:234`), with the framework default `[60, 600, 3600]` moved
   to `DefaultRedeliveryIntervalsSeconds` (`:212`) and the effective list built by
   `BrokerTransportPolicies.BuildRedeliveryIntervals` (`BrokerTransportPolicies.cs:131`, `:144`). The
   configuration binder used to append a configured list to the property's initializer, so
   `[60, 300, 900]` bound as six values and `[0]` never turned redelivery off
   (`MMCA.Common/CHANGELOG.md:21`). A configured list now replaces the default, and `[0]` yields an
   empty list (`BrokerTransportPolicies.cs:124`-`:125`), which skips delayed redelivery (`:62`-`:66`).
5. **Corrected in place:** the provider bullet (the enum and its `MessageBusSettings.cs:236-252`
   anchor), the emulator delegation (formerly inside `ConfigureBrokerTransport`, now in
   `AzureServiceBusTransport`), the connection-string resolution anchor, the retry bullet (formerly two
   branches of `ConfigureBrokerTransport`, now `BrokerTransportPolicies`), the `AddBrokerMessaging`
   early-return anchor, a Trade-offs anchor, and the fixture path, now in `MMCA.Common.Testing.Azure`.
   The anchors inside earlier revisions are left as recorded.

## Revision (2026-10-25)
Which broker runs where in ADC, Store and Helpdesk is unchanged.

1. **A third built-in provider.** `PostgreSql`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/MessageBusProviders.cs:27`)
   joins `InProcess` and `RabbitMq` (`:16`, `:19`) as a built-in transport: MassTransit v8's SQL
   transport for PostgreSQL with the shared receive policies and native delayed redelivery, on the
   shared `NpgsqlDataSource` when an `INpgsqlDataSourceConfigurator` is registered (else the connection
   string), and the broker option for Google Cloud (`MMCA.Common/CHANGELOG.md:24`).
   It is recorded as a new Decision bullet, and the retry bullet now names it among the transports
   that redeliver natively.
2. **Rejected alternative recorded:** a hand-written Pub/Sub transport (see Alternatives rejected).
3. **Corrected in place:** the opening sentence's "three-value" selector; the provider bullet's
   `MessageBusProviders.cs` anchors (`:15`, `:18`, now `:16`, `:19`); the `AddBrokerMessaging`
   early return (`DependencyInjection.Messaging.cs:54`, now `:57-59`, in the Decision, the tests
   bullet and Trade-offs); the `BrokerMessageBus` and `BrokerEventBus` replacements (`:95`, `:101`,
   now `:114`, `:120`); and `ResolveBrokerConnectionString` (`:248`, now `:264`, its doc-comment
   anchor dropped). The other Decision anchors and those inside earlier revisions are left as recorded.

## Revision (2026-10-26)
Re-verified against current source. Which broker runs where, the five provider names, the shared
receive policies with `RetryLimit` 5, `RetryMinIntervalSeconds` 1 and `RetryMaxIntervalSeconds` 30
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:99`, `:106`,
`:112`), `EnableDelayedRedelivery` defaulting to `false`, the Standard-tier namespaces, the seven
per-service rules with `Send` + `Listen` + `Manage` and the same-run, two-job deploy gate are
unchanged. Only line anchors moved, plus the `CHANGELOG.md` citations, which had pointed at lines
that later releases pushed down to unrelated bullets.

1. **`CHANGELOG.md` citations re-pointed.** The PostgreSQL broker and Pub/Sub absence bullet is now
   `MMCA.Common/CHANGELOG.md:86` under `[1.257.0]` (heading `:69`); the Decision and Alternatives
   rejected cite it there with the release named, since a changelog line moves with every release.
   The earlier revisions' `CHANGELOG.md` anchors (`:12`, `:21`, `:24`, `:26`) are left as recorded;
   the content they name sits under `[1.255.0]` (heading `:111`).
2. Anchors re-verified against current source: `EmulatorAdminEndpoint` `MessageBusSettings.cs:56`,
   `EnableDelayedRedelivery` `:206`; the emulator `WithBroker` overload
   `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:293-305`; the fixture's
   static constructor
   `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Azure/Fixtures/ServiceBusEmulatorFixtureBase.cs:70`
   (class at `:54`); ADC AppHost service attachments
   `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:129`, `:158`, `:201`, `:229`, selection `:98`,
   rationale `:69-97` with the `BrokerSelection` pointer `:94-97`, Notification note `:118-120`;
   Store AppHost attachments `MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:163`, `:190`,
   `:251`, selection `:79`, rationale `:50-78`; ADC Bicep container apps
   `MMCA.ADC/infra/main.bicep:1861`, `:2114`, `:2267`, `:2402`, broker env pairs `:1983-1984`,
   `:2208-2209`, `:2352-2353`, `:2505-2506`, per-service Key Vault secrets `:1772-1794`, Standard sku
   `:1273-1276`, Basic rationale `:1264-1265`, rules `:1313`, `:1325`, `:1337`, `:1349`
   (declarations `:1313-1359`, rights `:1317-1321`), `Manage` rationale `:1286-1298`, residual risk
   `:1300-1312` (the `listKeys` comment `:227-230` and variables `:231-234` did not move); Store
   Bicep container apps `MMCA.Store/infra/main.bicep:1514`, `:1696`, `:1820`, broker env pairs
   `:1607-1608`, `:1775-1776`, `:1911-1912`, Standard sku `:1082-1085`, Basic rationale
   `:1074-1076`, rules `:1118`, `:1130`, `:1142` (declarations `:1118-1152`, rights `:1122-1126`),
   `Manage` rationale and residual `:1108-1117` (the `listKeys` comment `:158-162` and variables
   `:163-165` did not move); ADC `MMCA.ADC/.github/workflows/deploy.yml` `freshness` job `:833`,
   `cross-service-freshness` step `:886`, 5-day window `:899`, required jobs `:901-903` with
   `required-jobs-mode: same-run` at `:904`, `deploy.needs` `:1161`, assert `:1195` (break-glass
   input still `:13`); Store `MMCA.Store/.github/workflows/deploy.yml` `freshness` job `:777`, step
   `:828`, 5-day window `:841`, required jobs `:843-845` with same-run mode at `:846`,
   `deploy.needs` `:1099`, assert `:1129` (break-glass input still `:26`). The anchors inside earlier
   revisions are left as recorded.

## Revision (2026-10-28)
Re-verified against current source. Which broker runs where, the `MessageBus__Provider` plus
`MessageBus__ConnectionString` pair on every service container app, the per-service broker secrets
in both repos, the Standard-tier namespaces and the seven per-service rules with `Send` + `Listen` +
`Manage` are unchanged. Only line anchors moved, and the production bullet now names Store's three
per-app secret references.

1. **Store per-app secret names spelled out.** Store's three apps reference
   `service-bus-connection-string-identity`, `-catalog` and `-sales`
   (`MMCA.Store/infra/main.bicep:1609`, `:1777`, `:1913`); ADC's four apps keep the plain
   `service-bus-connection-string` and resolve it to `kvIdentityServiceBusConn`,
   `kvConferenceServiceBusConn`, `kvEngagementServiceBusConn` and `kvNotificationServiceBusConn`
   (`MMCA.ADC/infra/main.bicep:1885`, `:2138`, `:2290`, `:2436`). The ADC Key Vault secret range is
   narrowed to the four broker secrets (`:1772-1791`, rationale `:1769-1771`); the former
   `:1772-1794` ran into the unrelated notification hub secret at `:1792`.
2. Anchors re-verified against current source: ADC Bicep container apps
   `MMCA.ADC/infra/main.bicep:1858`, `:2111`, `:2264`, `:2399`, broker env pairs `:1980-1981`,
   `:2205-2206`, `:2349-2350`, `:2502-2503` (Standard sku `:1273-1276`, Basic rationale
   `:1264-1265`, rules `:1313`, `:1325`, `:1337`, `:1349`, rights `:1317-1321`, `Manage` rationale
   `:1286-1298` and residual risk `:1300-1312` did not move); Store Bicep container apps
   `MMCA.Store/infra/main.bicep:1515`, `:1697`, `:1821`, broker env pairs `:1608-1609`,
   `:1776-1777`, `:1912-1913`, Standard sku `:1083-1086`, Basic rationale `:1075-1077`, rules
   `:1119`, `:1131`, `:1143` (declarations `:1119-1153`, rights `:1123-1127`), `Manage` rationale and
   residual `:1109-1118` (the `listKeys` comment `:158-162` and variables `:163-165` did not move);
   the PostgreSQL broker and Pub/Sub absence bullet `MMCA.Common/CHANGELOG.md:129` under `[1.257.0]`
   (heading `:112`). The 2026-10-24 revision's `AddBrokerTransport`, `ResolveBrokerTransport` and
   `AddAmazonSqsTransport` anchors now read
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:159`, `:188`
   and `MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:85`; they and the
   other anchors inside earlier revisions are left as recorded.

## Related
ADR-003 (the outbox that feeds `IMessageBus`; this ADR picks the transport underneath it), ADR-016
(the MassTransit v8 pin the emulator tier must work within, which is why the custom-clients `Host`
overload is used), ADR-008 (module extraction, the reason a broker exists at all), ADR-021 (the
consumer-side inbox that deduplicates broker redeliveries), ADR-006 (database-per-service, the
sibling boundary the broker crosses).
