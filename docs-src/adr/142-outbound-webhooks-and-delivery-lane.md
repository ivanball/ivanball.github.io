# ADR-142: Outbound Webhooks (Signed Delivery over Internal Commands, with a Dedicated Delivery Lane)

## Status
Accepted (2026-11-12). Listed under `[Unreleased]` in `MMCA.Common/CHANGELOG.md:7` (entries at `:42`
and `:75`). Off unless the host calls `AddWebhooks(configuration)` and sets `Webhooks:Enabled`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/WebhookSettings.cs:16-17`, default false).

## Context
An integration event leaves its aggregate through the outbox ([ADR-003](003-outbox-dual-dispatch.md),
[ADR-100](100-outbox-opt-in-resolved-from-messaging-mode.md)) and reaches two kinds of receiver: the
in-process integration event handlers of the host and, under broker messaging, the consumers of other
services, which dedupe through the inbox ([ADR-021](021-consumer-inbox-idempotency.md)). Both are code the
operator deploys. A third party (a tenant's ticketing tool, a chat integration, a partner's server) had no
way to hear about an event without polling an API.

Five forces shaped the decision:

- **A receiver is untrusted and unreliable.** Its URL is operator input, so a naive client can be pointed
  at the host's own network (server-side request forgery). Its response time is unbounded, and it can be
  down for days.
- **Durable deferred work already exists.** Internal commands ([ADR-114](114-internal-commands-durable-job-queue.md))
  give a durable row per unit of work, retry with backoff, dead-letter and an operator console. A
  delivery is exactly one such unit.
- **The internal-command queue is shared.** Business commands run on the same queue, so a slow or dead
  receiver must not delay them.
- **Tenancy is per request** ([ADR-073](073-multi-tenancy-model.md)), and a subscription must belong to the
  tenant that created it, including in a host that never resolves a tenant.
- **Secrets must survive replicas.** A signing secret written by one replica must be readable by another,
  which is the job of the shared data-protection key ring ([ADR-069](069-shared-data-protection-key-ring.md)).

## Decision
**MMCA.Common ships opt-in outbound webhooks: subscriptions stored per host, HMAC-signed delivery
scheduled as internal commands, an outbound address policy enforced at validation time and again at
connect time, and a dedicated delivery lane so deliveries never delay other internal commands.**

1. **Opt-in registration in three calls.** `AddWebhooks(configuration)` binds the `Webhooks` section with
   data-annotation validation at startup and registers the store, the administration service, the target
   validator, the sender, the secret protector, the DNS resolver and the event catalog
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:67-108`).
   `AddWebhookEvent<TEvent>(eventType)` publishes one integration event contract under one webhook type
   name and registers its fan-out handler
   (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.Webhooks.cs:17-83`); the name is
   lower case, dot, dash or underscore separated, at most 100 characters
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/WebhookEventCatalog.cs:12-13`, `:55-60`), and
   the WHOLE event is the published payload, so only the terminal contract is registered
   (`DependencyInjection.Webhooks.cs:21-25`). `pipeline.AddWebhookDelivery()` inside
   `AddMmcaApplicationPipeline` registers the delivery handler so every decorator wraps it, plus a startup
   check that fails, naming `AddWebhooks`, when no subscription store is registered
   (`DependencyInjection.Webhooks.cs:88-102`;
   `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/WebhookRegistrationValidator.cs:17-22`). With
   `Webhooks:Enabled` false the fan-out stays inert, every administration endpoint answers 404 and no
   context maps the table (`WebhookServiceCollectionExtensions.cs:33-40`). Under broker messaging the
   fan-out runs only in a host that consumes the event (`DependencyInjection.Webhooks.cs:38-39`).

2. **One subscription entity, scoped by its own store.** `WebhookSubscription` holds the target URL (at
   most 2048 characters, absolute http or https, no user info, no fragment), an optional description (200),
   1 to 20 event types or `*`, a nullable `TenantId`, the protected current and previous secrets, and the
   last-outcome columns
   (`MMCA.Common/Source/Core/MMCA.Common.Domain/Webhooks/WebhookSubscription.cs:40-62`, `:70-101`,
   `:273-281`). The table is mapped only where the host opts in, in the data source
   `Webhooks:DataSourceName` names (default `"Default"`, `WebhookSettings.cs:19-23`;
   `WebhookSubscription.cs:11-13`). `TenantId` is a plain column stamped at create, deliberately not the
   `ITenantEntity` marker (`WebhookSubscription.cs:21-24`): the marker's interceptor refuses an untenanted
   insert from an untenanted scope, and webhooks must work in a host that never resolves a tenant. The
   store filters every read on `TenantId == tenantId` explicitly, null matching only null
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Webhooks/EFWebhookSubscriptionStore.cs:45`,
   `:55`, `:63`, `:67`), and the tenancy architecture rule lists the entity as its one exemption with that
   reason (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Domain/ArchitectureRules.Tenancy.cs:15-20`).
   Administration goes through `WebhookSubscriptionsControllerBase`: list, event types, create, update,
   rotate secret, disable, enable and delete, each answering 404 while webhooks are off
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Webhooks/WebhookSubscriptionsControllerBase.cs:43-58`,
   `:67-73`, `:79`, `:106`, `:134`, `:155`, `:176`, `:197`), behind the permission `webhooks:manage`
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/Permissions/AdministrationPermissions.cs:54`).

3. **Standard Webhooks signatures with a rotation window.** A secret is `whsec_` plus Base64 of 32 random
   bytes; a signature is `v1,` plus Base64 HMAC-SHA256 over `{id}.{timestamp}.{body}`, sent in the
   `webhook-id`, `webhook-timestamp` and `webhook-signature` headers
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/WebhookSignature.cs:8-33`, `:61-69`).
   `WebhookSignature.Verify` gives receivers a tolerance-bounded, constant-time check (`:71-108`). The
   plaintext secret is generated, stored only protected and returned once, at create or rotate
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Subscriptions/WebhookSubscriptionService.cs:81-87`,
   `:143-146`). After a rotation the previous secret keeps signing beside the new one for
   `PreviousSecretGraceHours` (default 24, range 0 to 168, `WebhookSettings.cs:58-60`;
   `WebhookSubscription.cs:183-198`), so a delivery carries two space-separated signatures during the
   window. Secrets are protected by the host's data-protection key ring under the fixed purpose
   `MMCA.Common.Webhooks.Secret.v1`; an unreadable secret is a `Webhooks.SecretUnreadable` result, never an
   exception
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/DataProtectionWebhookSecretProtector.cs:9-19`,
   `:31-50`). An unreadable current secret means nothing is sent; an unreadable previous one is dropped
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/HttpWebhookSender.cs:54-59`, `:114-136`).

4. **At-least-once delivery over internal commands, with a deterministic delivery id.** The fan-out handler
   lists the enabled subscriptions of the event's tenant, keeps those that list the event type (or `*`), and
   schedules one `DeliverWebhookInternalCommand` per match inside ONE transaction
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/WebhookFanOutHandler.cs:60-115`). A
   failed schedule throws so the outbox or the broker redelivers the event (`:117-123`), and an event over
   `MaxPayloadBytes` (default 65536, range 1024 to 1048576, `WebhookSettings.cs:51-56`) is skipped with one
   warning (`WebhookFanOutHandler.cs:80-86`). The `webhook-id` is the first 16 bytes of SHA-256 over the
   event id and the subscription id
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/WebhookDeliveryId.cs:11-27`), so a
   redelivered event schedules the same id and a receiver dedupes on it. The row is the delivery history,
   under the stable name `MMCA.Webhooks.Deliver.v1`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/DeliverWebhookInternalCommand.cs:5-23`),
   and retries come from the `InternalCommands:*` settings (`WebhookSettings.cs:8-9`). The handler maps the
   outcome (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/DeliverWebhookInternalCommandHandler.cs:73-124`):
   2xx completes the row; 410 Gone records the failure, disables the subscription and completes the row; a
   refused target records a fixed reason and completes the row, since retrying cannot change it; any other
   status (redirects included), a transport failure (timeouts included) or an unreadable secret fails the
   row so it retries with backoff and dead-letters after `MaxAttempts`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/WebhookSendStatus.cs:6-25`). A
   missing, deleted or disabled subscription completes the row without sending
   (`DeliverWebhookInternalCommandHandler.cs:52-57`). The handler is not `ITransactional`: the outcome is
   recorded on its own save (`:12-16`).

5. **The outbound address policy, enforced twice.** `OutboundAddressPolicy.IsPublicAddress` denies, for
   IPv4, `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.168/16`,
   `198.18/15`, `224/4`, `240/4` and the single cloud host address `168.63.129.16`. IPv6 is an allow-list,
   not a deny-list: only global unicast `2000::/3` is public, and inside it Teredo `2001::/32`, 6to4
   `2002::/16` and the documentation prefixes `2001:db8::/32` and `3fff::/20` are still denied. Everything
   outside `2000::/3` is therefore refused without being listed (`::`, `::1`, IPv4-compatible `::/96`, both
   NAT64 prefixes, `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8`), as is a range added to the address
   architecture later. An IPv4-mapped IPv6 address is judged as its IPv4 form, and any other address family
   is not public (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Http/OutboundAddressPolicy.cs:13-90`).
   `IsAcceptableTargetUri` requires https, a host that is not `localhost` or `*.localhost`, and a public
   address for an IP literal (`:92-130`). At create and update the target validator applies that rule,
   resolves the host and refuses when the answer is empty or ANY address is not public
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/DnsWebhookTargetValidator.cs:11-55`;
   `WebhookSubscriptionService.cs:250`). That answer is early feedback only. The authoritative check is the
   delivery client's connect callback: it resolves the host itself, refuses BEFORE opening a socket when any
   resolved address is not public, and dials only the addresses it checked, so the policy holds against DNS
   rebinding and against any handler that rewrites the request URI
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookConnectCallback.cs:7-71`). The
   sender re-applies the scheme rule at send time, so a stored `http://` row never goes out in plaintext
   on a production host (`HttpWebhookSender.cs:43-52`). `AllowInsecureTargetsInDevelopment` lifts these
   rules only when the environment is Development and is otherwise ignored with one startup warning
   (`WebhookSettings.cs:69-73`; `WebhookServiceCollectionExtensions.cs:104`).

6. **A client that runs its own handler and nothing else.** The `MMCA.Webhooks` client's primary handler
   follows no redirect, uses no proxy, keeps no cookies, propagates no activity headers and connects through
   the callback above; every additional handler a host default adds is cleared and its default loggers are
   removed (`WebhookServiceCollectionExtensions.cs:87-102`). The reasons are in the registration
   (`:41-55`): a host-wide resilience pipeline would add a second retry policy beside the queue's, which
   stays the only one ([ADR-009](009-resilience-and-recovery-objectives.md) still governs the host's other
   clients); the client loggers would write the target URL, which often carries the receiver's token in its
   path; and `traceparent`, `tracestate` and `baggage` would leak internal trace context to a third party.
   The request timeout is `TimeoutSeconds` (default 10, range 1 to 30, `WebhookSettings.cs:25-34`;
   `WebhookServiceCollectionExtensions.cs:87-88`), and the response body is never read
   (`HttpWebhookSender.cs:14-19`).

7. **A dedicated delivery lane.** On a host where the lane is registered, delivery rows are drained by
   their own `InternalCommandLaneProcessor` and never by the shared loop
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookDeliveryLane.cs:14-19`). The lane
   and its registry are registered only when `Webhooks:Enabled` and `InternalCommands:Enabled` are both
   true (`WebhookDeliveryLane.cs:51-80`). A host that drains the queue with webhooks disabled registers no
   lane, so its shared loop still picks up a delivery row
   (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/InternalCommands/Processing/InternalCommandProcessorTests.cs:575`):
   every replica that drains a queue holding delivery rows needs the same `Webhooks:Enabled` value.
   - **One guarded predicate on the shared loop.** The registry `InternalCommandLanes` exists only together
     with the lane (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandLanes.cs:3-13`).
     The shared processor reads it once and, only when it is registered, adds `CommandType != excluded` to
     its fetch and its count
     (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandProcessor.cs:246-259`,
     `:288-301`, `:320-324`). A host without the lane polls exactly the pending predicate it polled before.
   - **The same row code.** The lane polls with the shared pending predicate, order, batch size and loop,
     and claims, renews and runs rows through the shared processor's row methods, so a delivery executes,
     retries and dead-letters through the same code as any other row
     (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandLaneProcessor.cs:18-25`).
   - **Bounded concurrency, never two rows for one receiver.** Up to `DeliveryConcurrency` rows of a claimed
     batch run at once per replica (default 4, range 1 to 16, `WebhookSettings.cs:36-41`); a row whose
     receiver already has a row running is passed over, earliest first
     (`InternalCommandLaneProcessor.cs:340-375`). The receiver key is the subscription id
     (`WebhookDeliveryLane.cs:40-47`).
   - **The receiver cooldown CHARGES an attempt without sending.** A failed real attempt cools its receiver
     down on this replica, from the instant the attempt failed; a success closes the cooldown
     (`InternalCommandLaneProcessor.cs:491-513`, `:556-572`). While a receiver cools down, each of its rows
     whose turn comes is not sent and its handler is not invoked: it is charged one failed attempt through
     the unchanged failure path, with the error code `InternalCommands.ReceiverCoolingDown` and the message
     "Receiver cooling down after a failed delivery." (`:60-64`, `:367-370`, `:515-536`), so it keeps the
     normal retry timeline and dead-letters on the normal attempt budget (`:35-42`). The configured
     `ReceiverCooldownSeconds` (default 60, range 5 to 120, `WebhookSettings.cs:43-49`) is clamped to
     `min(configured, S - TimeoutSeconds - 1 s)`, never below 1 second, where `S` is the shortest span from
     a row's first attempt to its last (when `S` is zero, which is `InternalCommands:MaxAttempts` 1, the
     cooldown is off); that is what guarantees a receiver answering from the moment a row
     is scheduled at least one real attempt on that row before it can dead-letter, on any number of
     replicas, unless the floor applied (`:89-116`). A clamp and a too-short retry span each log one startup
     warning (`:159-174`). The cooldown state is in memory, per replica
     (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/ReceiverCooldowns.cs:3-12`).
   - **The start budget.** No row of a batch starts once `TimeoutSeconds` has elapsed since the batch's
     first start; when every running row has finished, the rows that never started are released uncharged
     and are due again at once (`InternalCommandLaneProcessor.cs:31-33`, `:373`, `:378-380`, `:538-554`;
     `WebhookDeliveryLane.cs:48`).
   - **Visibility.** The lane emits the `lane` tag `webhooks` (`WebhookDeliveryLane.cs:22-23`), its own
     depth gauge (`InternalCommandLaneProcessor.cs:147`), a short-circuit counter for charged rows (`:535`),
     a cooldown-opened counter (`:569`) and a released counter (`:458`).

8. **The gates that keep it true.** In `MMCA.Common/Tests/`: the shared loop carries no command-type
   predicate without a lane and skips only lane rows with one
   (`Core/MMCA.Common.Infrastructure.Tests/Persistence/InternalCommands/Processing/InternalCommandProcessorTests.cs:557`,
   `:575`, `:593`, `:629`); the lane claims only its type, charges a cooling receiver's row without renew
   or handler, retries it on the normal backoff, dead-letters it on its last attempt and never opens or
   extends a cooldown from a charge
   (`.../InternalCommandLaneProcessorTests.cs:65`, `:271`, `:295`, `:318`, `:341`); host default handlers
   never wrap or replace the webhook client while still wrapping other clients, and the webhook client has
   no logging handler (`Core/MMCA.Common.Infrastructure.Tests/Webhooks/WebhookClientCompositionTests.cs:23`,
   `:39`, `:54`, `:73`, `:85`); the delivery handler stays decorated and a missing store fails startup
   naming `AddWebhooks` (`Core/MMCA.Common.Application.Tests/Webhooks/AddWebhookDeliveryTests.cs:26`,
   `:59`); the design-time model excludes the table by default
   (`Core/MMCA.Common.Infrastructure.Tests/Webhooks/WebhookSubscriptionModelGateTests.cs:140`).

## Rationale
- **Internal commands give delivery for free what a webhook system needs.** Durable rows, backoff,
  dead-letter and requeue already exist and are operated through one console
  ([ADR-114](114-internal-commands-durable-job-queue.md)); a delivery is one row
  (`DeliverWebhookInternalCommand.cs:5-8`), and the handler runs inside the full decorator pipeline
  (`DependencyInjection.Webhooks.cs:88-91`).
- **The deterministic delivery id turns at-least-once into dedupable.** The outbox and the broker can both
  redeliver an event; the same (event, subscription) pair always yields the same `webhook-id`
  (`WebhookDeliveryId.cs:5-8`), which is the receiver-side equivalent of the inbox
  ([ADR-021](021-consumer-inbox-idempotency.md)).
- **The policy is checked where the socket opens.** A check at validation time alone is defeated by a DNS
  answer that changes after the check; the connect callback judges the addresses it actually dials
  (`WebhookConnectCallback.cs:7-14`).
- **The lane isolates the shared queue with the smallest change to it.** One SQL predicate, present only
  when the lane is registered, moves the shared fetch window past every delivery row
  (`InternalCommandProcessor.cs:246-259`). The rest of the change to the shared processor is access, not
  behaviour: the row methods and the settings became internal so the lane can call them, and the row
  runner takes an optional failed-attempt callback that the shared loop never passes (`:72`, `:413`,
  `:476`).
- **The charged cooldown bounds a dead receiver's cost.** A failing receiver costs one real attempt per
  cooldown window per replica; every other due row of that receiver costs one database write and one
  attempt, so its backlog drains on the normal retry budget instead of accumulating
  (`InternalCommandLaneProcessor.cs:35-42`). Only HTTP 410 disables a subscription
  (`DeliverWebhookInternalCommandHandler.cs:105-110`), so nothing else would bound that backlog.
- **The subscription keeps its own tenant filter** because the marker's interceptor would refuse it in an
  untenanted host (`ArchitectureRules.Tenancy.cs:16-19`).

## Trade-offs
- **Many distinct failing receivers still consume slots.** Each gets a real attempt per cooldown window per
  replica, and a receiver that hangs holds a slot for up to `TimeoutSeconds` (`WebhookSettings.cs:26-31`),
  so `DeliveryConcurrency` or more such receivers can fill the lane. One tenant can hold up to
  `MaxSubscriptionsPerTenant` subscriptions (default 25, range 1 to 500, a soft limit that concurrent
  creates can exceed, `WebhookSettings.cs:62-67`), so one tenant CAN dominate other tenants' delivery
  latency. It cannot delay the shared queue.
- **A slow but succeeding receiver never cools down.** A success closes the cooldown
  (`InternalCommandLaneProcessor.cs:509-512`), and one receiver never runs two rows at once, so its backlog
  drains at one row per response time per replica.
- **The cooldown is per replica.** It lives in memory (`ReceiverCooldowns.cs:3-7`), so R replicas each
  spend a real attempt per window on a failing receiver.
- **Targets are drained through the shared `PollingLoop.DrainAllAsync`** (`InternalCommandLaneProcessor.cs:136-145`),
  so under database per tenant one tenant database's batch precedes the next one's in each cycle.
- **Recovery after an outage costs a window.** Because a cooling receiver's rows are charged, a row is
  delivered after an outage only if the outage ends at least one cooldown before that row's last attempt
  (`InternalCommandLaneProcessor.cs:35-42`, `:89-98`). This is the stated price of the charged fail-fast.
- **The shared predicate scans past pending delivery rows.** `CommandType != X`
  (`InternalCommandProcessor.cs:257-259`) has no index of its own; the charged cooldown keeps that backlog
  bounded by event rate times the retry span. Adding `CommandType` to the pending index would be a
  migration in every adopter, because the internal-command table is mapped unconditionally.
- **The client trace still records the URL path.** Loggers and trace headers are removed, but the HTTP
  client span is not, so a host that exports traces to a shared backend filters the `MMCA.Webhooks` spans
  itself (`WebhookServiceCollectionExtensions.cs:53-54`).
- **The whole event is the payload.** There is no projection step; a contract registered with
  `AddWebhookEvent` is sent in full (`DependencyInjection.Webhooks.cs:21-25`).

## Alternatives rejected
Each was weighed on 2026-11-12, against these tests: the shared queue is not delayed by deliveries, one
dead endpoint cannot starve other receivers, no schema change, unchanged behaviour without opt-in, and a
dead receiver's backlog stays bounded.

- **A separate delivery worker or table.** A separate table is a migration for every adopter plus a
  second processor, retention sweep and operator surface, and the existing console would not see a
  dead-lettered delivery. Revisit if deliveries need retention or administration that the
  internal-command console cannot give.
- **A wall-time or row budget for delivery rows inside the shared loop.** The shared batch is ordered by
  `ScheduledOn`, so a delivery row ahead of a business command still runs first and delays it up to
  `TimeoutSeconds` per cycle; and the rows the budget skipped stay due at the head of the oldest-first
  window, so a backlog of `BatchSize` delivery rows keeps every other command from being fetched. Revisit
  if the shared loop ever fetches per command type (an indexed partition key), which removes the window
  problem.
- **Parallel execution of delivery rows in the shared loop.** A shared batch ends only when its slowest row
  ends, so a dead endpoint holds the next fetch for `TimeoutSeconds`, and delivery rows still compete for
  the shared window. Running ALL commands in parallel would run every adopter's handlers concurrently on
  one replica for the first time. Bounded concurrency is kept, inside the lane only. Revisit if the shared
  loop adopts concurrent execution for its own reasons.
- **Free deferral during a cooldown.** Deferring a cooling receiver's rows without charging an attempt
  leaves a permanently dead receiver one real attempt per cooldown per replica, so at a 60-second cooldown
  and the default five attempts
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Administration/InternalCommandsSettings.cs:39`)
  its rows dead-letter at about 0.2 per minute; a subscription receiving more events
  than that accumulates pending rows forever, each one more row the shared predicate scans past. Revisit
  if a subscription is ever disabled on sustained failure (today only 410 does it,
  `DeliverWebhookInternalCommandHandler.cs:105-110`), which would bound the backlog another way.
- **A public "any command names a lane" API.** It needs a public attribute or key with validation, a
  registry several callers write, a receiver-key notion only webhooks have, and per-lane metric
  documentation. The lane is an internal record
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandLane.cs:23-29`),
  so a second lane is additive. Revisit when a second command type needs isolation from the shared queue
  (the long scoring pass of [ADR-052](052-background-job-execution.md) is the obvious candidate).

## Consequences
- **What an adopter adds.** MMCA.Helpdesk is the worked example: `services.AddWebhooks(builder.Configuration)`
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:107`), `.AddWebhookDelivery()` inside the
  pipeline (`:160`), one `AddWebhookEvent<TicketOpenedIntegrationEvent>("ticket.opened")` in the Tickets
  module (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/DependencyInjection.cs:60`),
  `"Webhooks": { "Enabled": true }` (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/appsettings.json:29-31`)
  with `AllowInsecureTargetsInDevelopment` set only in the Development file
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/appsettings.Development.json:10-12`), and a sealed
  `WebhookSubscriptionsController` deriving from the base that redeclares `webhooks:manage`
  (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.API/Controllers/WebhookSubscriptionsController.cs:25-26`),
  pinned by `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/Tickets/WebhookSubscriptionsControllerTests.cs:37`.
- **The migration.** The table is created on the `Webhooks:DataSourceName` database by setting
  `DesignTimeDbContextOptions.EnableWebhooks`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextOptions.cs:157`);
  Helpdesk sets it in its design-time factory
  (`MMCA.Helpdesk/Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets/DesignTimeSQLServerDbContextFactory.cs:46`)
  and ships `AddWebhookSubscriptions`
  (`MMCA.Helpdesk/Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets/Migrations/20261112163619_AddWebhookSubscriptions.cs:9`).
  The lane needs no migration: it reuses the internal-command table.
- **Multi-replica hosts need the shared key ring** ([ADR-069](069-shared-data-protection-key-ring.md)), or
  a replica cannot read a secret another wrote; that surfaces as `Webhooks.SecretUnreadable` and a retried
  row, never as an exception (`DataProtectionWebhookSecretProtector.cs:9-14`).
- **The lane needs the queue.** With `InternalCommands:Enabled` false no lane is registered
  (`WebhookDeliveryLane.cs:64-67`) and no delivery is drained in that host.
- **What to watch.** The lane's short-circuit, cooldown and released counters and its depth gauge
  (Decision 7) show a failing receiver before its rows dead-letter.
- **What is not verified.** Nothing here has been exercised against real third-party receivers or a
  Standard Webhooks library on the receiving side; the evidence is the unit and integration tiers named in
  Decision 8.
