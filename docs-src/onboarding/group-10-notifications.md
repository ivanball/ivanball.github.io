# 10. Notifications (Push + In-App Inbox + Email)

**What this group covers.** This is the notification subsystem, the machinery that turns "an
organizer wants to tell every attendee something" into messages that actually reach people across
several transports at once. It spans all five layers and both repositories: the framework
(`MMCA.Common`) owns the aggregates, the transport abstractions, the SignalR hub, the REST
controllers, and the CQRS handlers, while `MMCA.ADC` supplies the thin
[`NotificationModule`](#notificationmodule) host, the app-specific recipient rule, and the gRPC
edges that let an extracted service still deliver over the one WebSocket. The design principle is
the same one that runs through the whole codebase: application and domain code talk to
**abstractions** ([`IPushNotificationSender`](#ipushnotificationsender),
[`ILiveChannelPublisher`](#ilivechannelpublisher),
[`INotificationRecipientProvider`](#inotificationrecipientprovider),
[`IEmailSender`](#iemailsender)); the concrete transport (SignalR, SMTP, a native push hub, a gRPC
forwarder) is chosen at the composition root, and a default is always registered so nothing has to
be configured for DI to resolve. [`NullPushNotificationSender`](#nullpushnotificationsender) and
[`NullLiveChannelPublisher`](#nulllivechannelpublisher) are no-ops
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:574-575`),
`IEmailSender` defaults to the real [`SmtpEmailSender`](#smtpemailsender)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:573`), and
`INotificationRecipientProvider` gets its default in the Application layer
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:75`).

There are really **four delivery channels** here, and it is worth separating them up front because
they have different durability guarantees:

1. **The durable in-app inbox.** Every send writes one [`UserNotification`](#usernotification) row
   per recipient, so a user who was offline at send time still sees the message when they next open
   their inbox
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:115-123`).
   This is the persistent half of the two-channel model ([ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html)).
2. **The transient SignalR push.** [`IPushNotificationSender`](#ipushnotificationsender) fans the
   same message out to any connections the recipient has open right now via the
   [`NotificationHub`](#notificationhub); clients not connected at send time simply never see this
   copy (the inbox is their catch-up). This is the real-time half of [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html).
3. **The OS-level native push ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).** A separate best-effort channel reaches devices the
   SignalR hub cannot (app backgrounded or killed), through
   [`INativePushSender`](group-07-persistence-ef-core.md#inativepushsender) and the device
   registrations managed by [`DevicesController`](#devicescontroller). The sender itself and its
   Azure Notification Hubs implementation live in
   [Group 07](group-07-persistence-ef-core.md#inativepushsender); this chapter covers only the
   request record and the registration endpoint.
4. **Ephemeral live-channel events ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)).** A distinct, never-persisted fan-out to a *group*
   of subscribed connections (for example `event:1` or `session:123`), used by the ADC Engagement
   live layer for poll and question updates. This rides the same hub but through
   [`ILiveChannelPublisher`](#ilivechannelpublisher) and the hub's `JoinChannel`/`LeaveChannel`
   group membership rather than per-user targeting
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/NotificationHub.cs:43-67`).

A fifth transport, plain **email**, is present as [`IEmailSender`](#iemailsender) /
[`SmtpEmailSender`](#smtpemailsender) (MailDev locally, real SMTP in production) but is a
lower-traffic, fire-one-message helper rather than part of the broadcast pipeline: it builds and
disposes an `SmtpClient` per call and offers a "send to the configured default recipient" overload
for system mail
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpEmailSender.cs:17-48`).

## The layering, and why the pieces sit where they do

The dependency flow of the group mirrors the framework's Clean Architecture story
([Rubric §3, Clean Architecture]). The **Domain** layer holds the two aggregates,
[`PushNotification`](#pushnotification) (the audit record of a broadcast: title, body, sender,
recipient count, an optional deduplication key, an optional scope key, and a
[`PushNotificationStatus`](#pushnotificationstatus) of `Pending`/`Sent`/`Failed`,
`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:24-53`)
and [`UserNotification`](#usernotification) (one per-recipient inbox row with read/unread state),
plus the [`PushNotificationCreated`](#pushnotificationcreated) domain event and the
[`PushNotificationInvariants`](#pushnotificationinvariants) guards (title max 200 chars, body max
2000, both non-empty:
`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/Invariants/PushNotificationInvariants.cs:13-26`).
Both aggregates are `[IdValueGenerated]`, so the database assigns their ids
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:15`,
`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/UserNotifications/UserNotification.cs:11`).
The **Application** layer defines the four transport contracts and the CQRS use cases; the
**Shared** layer carries the wire types ([`PushNotificationDTO`](#pushnotificationdto),
[`UserNotificationDTO`](#usernotificationdto),
[`SendPushNotificationRequest`](#sendpushnotificationrequest),
[`DeviceInstallationRequest`](#deviceinstallationrequest)) and three constant holders:
[`NotificationFeatures`](#notificationfeatures) (the `Notification.PushNotifications` flag,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/NotificationFeatures.cs:9`),
[`NotificationPermissions`](#notificationpermissions) (the single `notifications:manage` capability,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/NotificationPermissions.cs:10`), and
[`NotificationScopeKey`](#notificationscopekey) (the `event:{id}` / `session:{id}` formatter and its
guard pattern,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/NotificationScopeKey.cs:23-32`). The
**Infrastructure** layer supplies the SignalR-backed implementations
([`SignalRPushNotificationSender`](#signalrpushnotificationsender),
[`SignalRLiveChannelPublisher`](#signalrlivechannelpublisher)), the SMTP email sender, and the
[`NotificationHub`](#notificationhub) itself, plus the no-op fallbacks
([`NullPushNotificationSender`](#nullpushnotificationsender),
[`NullLiveChannelPublisher`](#nulllivechannelpublisher),
[`NullNotificationRecipientProvider`](#nullnotificationrecipientprovider)). The **API** layer exposes
three controllers ([`NotificationsController`](#notificationscontroller),
[`InboxController`](#inboxcontroller), [`DevicesController`](#devicescontroller)).

The critical placement decision is that the four transport interfaces live in **Application**
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/IPushNotificationSender.cs:7`,
`ILiveChannelPublisher.cs:9`, `INotificationRecipientProvider.cs:8`, `IEmailSender.cs:6`), not
Infrastructure. That keeps the send handler and the Engagement live layer depending on an
abstraction the way `IMessageBus` and the gRPC service interfaces do (the microservices-extraction
discipline in [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)): the same
application code runs unchanged whether the concrete sender is an in-process SignalR call or a gRPC
forward to another service.

## The broadcast send flow, end to end

Sending a notification is a command-side vertical slice ([Rubric §5, Vertical Slice],
[Rubric §6, CQRS & Event-Driven]). An organizer POSTs to
[`NotificationsController`](#notificationscontroller), which is gated three ways at the class level
(API versioning, `[FeatureGate(NotificationFeatures.PushNotifications)]`, and
[`[HasPermission(NotificationPermissions.Manage)]`](group-08-auth.md#haspermissionattribute)) and a
fourth on the POST action itself,
[`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:25-29,43-44`).
The authorization is stated as a **capability, never a role**: the endpoint asks for
`notifications:manage`, and the consuming host decides who holds it. ADC grants it to the Organizer
role and to no other, in one line at the module's registration
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:38`), which
is what lets an attendee never broadcast and an administrator hold no notification capability it was
not explicitly given ([Rubric §11, Security]). The controller then reads the authenticated id from
`ICurrentUserService` and refuses the call with an `Error.Unauthorized` when there is none
(`NotificationsController.cs:52-56`), reads the raw `Idempotency-Key` header and carries it into the
domain as the command's `DedupKey`, treating a whitespace-only header as absent
(`NotificationsController.cs:60-67`). Header binding is done by hand rather than with `[FromHeader]`
precisely so the key stays protocol plumbing and does not leak into the generated OpenAPI contract
(`NotificationsController.cs:61`). The request is wrapped in a
[`SendPushNotificationCommand`](#sendpushnotificationcommand) and handed to
[`SendPushNotificationHandler`](#sendpushnotificationhandler) (`NotificationsController.cs:69-74`).

Those two idempotency mechanisms are deliberately stacked ([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)). The filter replays the
original HTTP *response* for a repeated key; the `DedupKey` protects *delivery* even when the
filter's cache is cold, evicted, or degraded (`NotificationsController.cs:37-41`). The command is
also [`ITransactional`](group-05-cqrs-pipeline.md#itransactional)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationCommand.cs:23`),
which is what keeps the dedup short-circuit honest: without a transaction, a fault between the audit
write and the recipient writes would leave a committed row carrying the key that nothing ever
delivered, and every retry of that key would then report success forever
(`SendPushNotificationCommand.cs:11-19`). Inside that transaction the handler runs a deliberate
ordering
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:36-167`):

- **Dedup lookup first** (lines 39-50). When a key is present the handler requeries for an existing
  [`PushNotification`](#pushnotification) with that key and, on a hit, returns it mapped to a DTO
  without sending anything again. The lookup goes through
  `unitOfWork.GetReadRepository<...>()` rather than an injected repository, so it reads the same
  data source the write below targets (`SendPushNotificationHandler.cs:174-183`).
- **Resolve recipients** through [`INotificationRecipientProvider`](#inotificationrecipientprovider),
  failing early with a `PushNotification.NoRecipients` validation error when the set is empty
  (lines 52-62).
- **Create and save the audit aggregate** (lines 64-83), stamping the caller's optional scope key
  onto the aggregate along with the dedup key (line 71). Because the dedup lookup is a
  check-then-act, two concurrent retries of the same send both pass it, and the loser only fails
  here, on the insert, against the filtered unique index on `DedupKey`. The catch block requeries by
  key and, when the winner now exists, returns it; anything else rethrows, so a genuine persistence
  fault still reaches the exception middleware (lines 85-112). The requery deliberately uses
  `CancellationToken.None`, otherwise a save aborted by the caller's token could never be classified
  (lines 99-103). The index itself is the arbiter: unique, filtered to `[DedupKey] IS NOT NULL` and
  to live rows, so the many keyless sends coexist and a soft-deleted row does not occupy a key slot
  forever
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:68-70`).
- **Write the inbox rows**, one [`UserNotification`](#usernotification) per recipient, then save again
  (lines 114-122).
- **Attempt SignalR delivery** via [`IPushNotificationSender`](#ipushnotificationsender), catching any
  exception and recording `MarkAsSent()` or `MarkAsFailed()` accordingly, since delivery failure is
  non-fatal (lines 124-142).
- **Attempt the native-push leg** through
  [`INativePushSender`](group-07-persistence-ef-core.md#inativepushsender)
  ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)), whose failures are
  logged at Warning and never change the audit status (lines 144-161).
- **Save a third time and map** the aggregate to a [`PushNotificationDTO`](#pushnotificationdto) via
  [`PushNotificationDTOMapper`](#pushnotificationdtomapper) (lines 163-165).

The durable inbox write happening **before** the transient channels is the load-bearing choice: the
record of who should have been reached survives even when nobody is connected, and the audit status
records which of the two real-time legs succeeded ([Rubric §29, Resilience & Business Continuity]).

Who counts as a recipient is deliberately left to the consuming app.
[`INotificationRecipientProvider`](#inotificationrecipientprovider) is the extension point; the
framework registers [`NullNotificationRecipientProvider`](#nullnotificationrecipientprovider), which
returns an empty list, as a safe default
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:75`), and ADC
supplies [`AttendeeNotificationRecipientProvider`](#attendeenotificationrecipientprovider), which
bridges the Identity module's
[`IAttendeeQueryService`](group-24-identity-module.md#iattendeequeryservice) (over gRPC across
service boundaries) so a broadcast targets every conference attendee
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/AttendeeNotificationRecipientProvider.cs:10-16`).
The override works by ordering, not by configuration: ADC registers its provider with `AddScoped`
**before** calling `AddNotificationApplicationServices()`, whose `TryAddScoped` default then finds
the slot already taken
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/DependencyInjection.cs:24-31`).

## Scope keys: one string that narrows a broadcast, an inbox, and a live channel

[`NotificationScopeKey`](#notificationscopekey) is the small type that ties three otherwise unrelated
paths together. It owns the format (`event:{id}` via `ForEvent`, `session:{id}` via `ForSession`,
both rendered under `InvariantCulture` so a culture with non-ASCII digits cannot produce a key the
guard rejects) and, in the same file, the regular expression that validates one:
`^(event|session):[0-9]+$`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/NotificationScopeKey.cs:32,37-44,51`),
compiled once through a source-generated `[GeneratedRegex]` with a one-second match timeout
(`NotificationScopeKey.cs:57`). That constant is also the default of
[`PushNotificationSettings`](group-14-module-system-composition.md#pushnotificationsettings)`.ChannelKeyPattern`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/PushNotificationSettings.cs:29`), which
is what [`NotificationHub`](#notificationhub) enforces before a client may join a group. Producer and
guard therefore cannot drift apart: keeping the format and its pattern in one type is the whole point
of the class ([Rubric §16, Maintainability]).

On the send side the key is optional and opaque. It arrives as an `init` property on
[`SendPushNotificationRequest`](#sendpushnotificationrequest) rather than a positional parameter, so
every pre-existing caller keeps compiling and an omitted key means "unscoped"
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/PushNotifications/SendPushNotificationRequest.cs:23-28`);
[`SendPushNotificationRequestValidator`](#sendpushnotificationrequestvalidator) caps its length at
128 and the domain re-checks the same bound in
[`PushNotification`](#pushnotification)`.Create`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationRequestValidator.cs:27-29`,
`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:22,114-120`).
On the read side the scope is a **view filter, not a security boundary**, and the code says so in as
many words: a read that supplies a scope sees the notifications carrying that scope *plus* every
unscoped one, and a read that supplies none still sees everything
(`PushNotification.cs:47-53`). Ownership is enforced separately, by the `un.UserId == query.UserId`
predicate that every inbox read carries. ADC's Engagement UI is the producer of the key in practice:
[`CurrentEventNotificationScopeProvider`](group-22-engagement-module.md#currenteventnotificationscopeprovider)
resolves `event:{EventId}` for the conference currently in focus, caches it for five minutes, and
deliberately answers `event:0` (a well-formed key no row carries, hence an empty inbox) rather than
`null` when it cannot resolve one, because on that contract `null` means unscoped and would widen an
attendee's inbox to every event
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/Notifications/CurrentEventNotificationScopeProvider.cs:35-48,67`).

## The inbox side

Reading and acknowledging notifications is the query/command counterpart, served by
[`InboxController`](#inboxcontroller) under the same feature gate and a plain `[Authorize]`, so any
authenticated user reaches only their own inbox
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationInboxController.cs:24-28`);
every action re-reads `ICurrentUserService.UserId` and builds the message from it rather than
trusting a client-supplied id ([Rubric §11, Security]). It exposes four use cases, three of which
accept the optional `scope` query parameter, length-checked against
`PushNotification.ScopeKeyMaxLength` at the boundary
(`NotificationInboxController.cs:46,70,113`):

- The **paged inbox** ([`GetMyNotificationsQuery`](#getmynotificationsquery) /
  [`GetMyNotificationsHandler`](#getmynotificationshandler)), which joins the per-user
  [`UserNotification`](#usernotification) rows to their [`PushNotification`](#pushnotification)
  content newest-first, applies the scope predicate to the `PushNotification` side only when one was
  supplied, and clamps paging through
  [`PagingMath`](group-03-querying-specifications.md#pagingmath) with a 500-row page ceiling
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetInbox/GetMyNotificationsHandler.cs:21,32,39-59`).
- The **unread count** ([`GetUnreadNotificationCountQuery`](#getunreadnotificationcountquery) /
  [`GetUnreadNotificationCountHandler`](#getunreadnotificationcounthandler)), served
  `[ResponseCache(NoStore = true)]` so the bell badge is never stale
  (`NotificationInboxController.cs:66-68`). Its join to `PushNotification` is introduced **only** for
  a scoped count, because an unconditional join would drag `PushNotification`'s soft-delete global
  query filter into the unscoped count and change a number no caller asked to change
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetUnreadCount/GetUnreadNotificationCountHandler.cs:27-40`).
- A **single mark-read** ([`MarkNotificationReadCommand`](#marknotificationreadcommand) /
  [`MarkNotificationReadHandler`](#marknotificationreadhandler)), which matches on both the
  notification id **and** the requesting user id, returning `UserNotification.NotFound` rather than a
  forbidden when the row belongs to somebody else
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkRead/MarkNotificationReadHandler.cs:24-36`).
- A **mark-all-read** ([`MarkAllNotificationsReadCommand`](#markallnotificationsreadcommand) /
  [`MarkAllNotificationsReadHandler`](#markallnotificationsreadhandler)), whose scoped variant keeps
  the write aligned with what the caller can see. Its conditional join deliberately uses the
  **tracked** `Table` rather than `TableNoTracking`: an `AsNoTracking` source anywhere in a composed
  EF query switches the whole query to no-tracking, the `UserNotification` rows would come back
  untracked, and the `MarkAsRead` mutations would silently never be saved
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkAllRead/MarkAllNotificationsReadHandler.cs:30-45`)
  ([Rubric §8, Data Architecture]).

[`UserNotification`](#usernotification)`.MarkAsRead` is **idempotent** and takes the read timestamp
as a parameter (from an injected `TimeProvider`, `MarkNotificationReadHandler.cs:15,38`) so the
domain stays free of ambient clock access and the transition is deterministically testable
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/UserNotifications/UserNotification.cs:58-67`).
The organizer-facing history read is the fifth use case and lives on the other controller:
[`GetNotificationHistoryQuery`](#getnotificationhistoryquery) /
[`GetNotificationHistoryHandler`](#getnotificationhistoryhandler) pages the
[`PushNotification`](#pushnotification) audit rows newest-first under the same 500-row clamp and maps
them through [`PushNotificationDTOMapper`](#pushnotificationdtomapper)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/GetHistory/GetNotificationHistoryHandler.cs:21,30-42`).
List reads that go through the generic query service take a different path again:
[`PushNotificationDTOProjector`](#pushnotificationdtoprojector) wraps the Mapperly-generated
[`PushNotificationDTOProjection`](#pushnotificationdtoprojection), and merely registering it switches
those reads onto server-side projection
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:48-53`)
([Rubric §12, Performance & Scalability]).

## The SignalR transport, and how it survives extraction

[`NotificationHub`](#notificationhub) is intentionally thin
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/NotificationHub.cs:16-17`): it is
`[Authorize]`d, and beyond ASP.NET's built-in per-user connection mapping it only manages channel
(SignalR group) membership through `JoinChannel`/`LeaveChannel`, validating each channel key against
the configured pattern with a cached, one-second-timeout `Regex` so a bad key throws `HubException`
rather than opening an injection or ReDoS hole (`NotificationHub.cs:31-34,69-79`)
([Rubric §11, Security]). Actual delivery does not run inside the hub:
[`SignalRPushNotificationSender`](#signalrpushnotificationsender) and
[`SignalRLiveChannelPublisher`](#signalrlivechannelpublisher) both use `IHubContext<NotificationHub>`
so they can be called from any handler without a live connection. The push sender targets
`Clients.User` / `Clients.Users` / `Clients.All` and **batches large user lists in chunks of 100**
to avoid overwhelming the connection manager
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/SignalRPushNotificationSender.cs:14,41-58`)
([Rubric §12, Performance & Scalability]); the live publisher does a single `Clients.Group` send
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Live/SignalRLiveChannelPublisher.cs:14-18`).
Both are wired by `AddPushNotifications(configuration)`, which also attaches a Redis backplane when
a `redis` connection string is present, so the fan-out crosses replicas
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:629-650`).

The live channel is where the extracted-service topology shows through
([Rubric §7, Microservices Readiness]). In a monolith the default
[`NullLiveChannelPublisher`](#nulllivechannelpublisher) is registered, and a host that maps the hub
swaps in the real [`SignalRLiveChannelPublisher`](#signalrlivechannelpublisher)
(`DependencyInjection.cs:645-646`). In extracted ADC, Engagement is a *different* process from the
one that owns the WebSocket, so Engagement's live layer depends on
[`ILiveChannelPublisher`](#ilivechannelpublisher) as usual but the composition root `Replace`s the
registration with [`LiveChannelPublisherGrpcAdapter`](#livechannelpublishergrpcadapter)
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/DependencyInjection.cs:42-51`). That
adapter forwards each event over gRPC with a tight 2-second deadline to the Notification service's
[`LiveChannelGrpcService`](#livechannelgrpcservice), which then delegates to the local
[`SignalRLiveChannelPublisher`](#signalrlivechannelpublisher), the only host whose `IHubContext` can
reach connected clients
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/LiveChannelGrpcService.cs:22-38`).
Both the adapter and the whole live path are **best-effort by contract** ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)): every transport,
resolution, or broken-circuit failure is logged and swallowed, never thrown, so a publishing command
can never fail because Notification is slow or down
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/LiveChannelPublisherGrpcAdapter.cs:26,43-48`)
([Rubric §29, Resilience & Business Continuity]).

Serving both a WebSocket and an h2c gRPC ingress from one host is the mixed-endpoint profile of
[ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html), and it is why the Notification host keeps its default endpoints on
`Http1AndHttp2` (the WebSocket Upgrade needs HTTP/1.1) while a second, `Http2`-only Kestrel endpoint
named `grpc` (8081 in the container, 5996 locally) is declared in the `Kestrel:Endpoints` config
section and resolved by peers as `_grpc.notification` through the
`services__notification__grpc__0` entry
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:56-71`). The host maps the hub
itself at `/hubs/notifications` via `MapNotificationHub()` (`Program.cs:257-262`, the path coming
from `PushNotificationSettings.HubPath`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/PushNotificationSettings.cs:17`) and both
gRPC services on that dedicated endpoint (`Program.cs:267,275`). The two gRPC surfaces are **not**
protected alike, and the difference is deliberate: the live-channel ingress carries no `[Authorize]`
because it is reachable only on the internal service network and its caller (Engagement's
[`LiveChannelPublishProcessor`](group-22-engagement-module.md#livechannelpublishprocessor) background
drain) has no HttpContext and forwards no bearer
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/LiveChannelGrpcService.cs:13-20`),
while the export rpc is mapped with `.RequireAuthorization()` because its response carries personal
data keyed by a raw user id (`Program.cs:269-275`).

## The module host, native-device registration, and the privacy export

On the ADC side the whole capability is packaged by [`NotificationModule`](#notificationmodule)
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/NotificationModule.cs:15`), an
[`IModule`](group-14-module-system-composition.md#imodule) that declares a hard dependency on
Identity (`Dependencies => ["Identity"]`, `RequiresDependencies => true`, since it needs attendee
data, `NotificationModule.cs:21-24`) and whose `Register` calls `AddNotificationModule` to wire the
application handlers, the EF configurations, the SignalR push registration, the native-push channel,
the one role-to-permission grant, and the Common controllers
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:28-44`). It
is a deliberately thin module (API + Application only, no Infrastructure project of its own). The
framework's own registration
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:36-78`) uses
`TryAddScoped` throughout so a consuming app can override any handler or the recipient provider, and
the API-layer registration
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Notifications/DependencyInjection.cs:19-23`) adds
the Common controllers as an MVC application part, because they ship in a NuGet assembly that
ASP.NET does not scan by default ([Rubric §16, Maintainability]).

Native-device management is the third channel's control plane.
[`DevicesController`](#devicescontroller) ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) lets an authenticated user upsert
(`PUT`, after login and on token rotation) or delete (`DELETE`, before logout) a device
installation, described by [`DeviceInstallationRequest`](#deviceinstallationrequest) (a
client-generated stable installation id, a platform of `fcmv1` or `apns`, and the platform push
handle,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/PushNotifications/DeviceInstallationRequest.cs:14-33`).
Both verbs scope ownership the same way: each reads `currentUserService.UserId` and passes it to the
registrar, so a PUT can only register *the caller's own* installation and a DELETE only removes one
the caller owns
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:38-45,62-69`).
The ownership check itself lives in the registrar
([`IPushDeviceRegistrar`](group-07-persistence-ef-core.md#ipushdeviceregistrar), Group 07): an id
that does not exist and an id belonging to another user both answer 204 without deleting anything,
so the response cannot be used as an existence oracle for other users' installation ids
(`DevicesController.cs:48-54`) ([Rubric §11, Security]).

Finally, the module carries the Notification half of the cross-service data-subject export
(PRIVACY.md §7), [`UserNotificationExportService`](#usernotificationexportservice), published across
modules as [`IUserNotificationExportService`](#iusernotificationexportservice) and reachable from
the Identity aggregator over gRPC via
[`UserNotificationExportGrpcService`](#usernotificationexportgrpcservice) and its client-side
[`UserNotificationExportServiceGrpcAdapter`](#usernotificationexportservicegrpcadapter), producing
[`UserNotificationExportItemDTO`](#usernotificationexportitemdto) rows (id, title, sent/read dates,
and the scope the notification was sent under, but never the body) scoped strictly to the requesting
user through a `where un.UserId == userId` filter on an unpaged, newest-first join
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/UserNotificationExportService.cs:27-42`,
`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/UserNotifications/UserNotificationExportItemDTO.cs:8-29`).
When the module is disabled, [`NotificationModule`](#notificationmodule) registers
[`DisabledUserNotificationExportService`](#disabledusernotificationexportservice), which answers with
an empty list so the cross-module interface still resolves (`NotificationModule.cs:34-35`)
([Rubric §30, Compliance, Privacy & Data Governance]).

## Where this group sits

Upstream, this group depends on the domain building blocks of
[Group 02](group-02-domain-building-blocks.md) (both aggregates derive from
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)),
the [`Result`](group-01-result-error-handling.md#result) pattern of
[Group 01](group-01-result-error-handling.md), the CQRS pipeline of
[Group 05](group-05-cqrs-pipeline.md#itransactional) and
[`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) of persistence
([Group 07](group-07-persistence-ef-core.md)), the permission attribute of
[Group 08](group-08-auth.md#haspermissionattribute), the idempotency filter of
[Group 12](group-12-api-hosting-mapping.md#idempotencyfilter), and the module system of
[Group 14](group-14-module-system-composition.md). Downstream, the Blazor UI of
[Group 15](group-15-common-ui-framework.md) consumes it: the
[`NotificationBell`](group-15-common-ui-framework.md#notificationbell), inbox, and send pages call
these REST endpoints, ask an
[`INotificationScopeProvider`](group-15-common-ui-framework.md#inotificationscopeprovider) for the
scope to pass, and the UI's SignalR client listens on the hub's `ReceiveNotification` /
`ReceiveChannelEvent` methods (`NotificationHub.cs:20-23`). The ADC Engagement live layer
([Group 23](group-23-engagement-live-layer.md)) is the busiest producer of live-channel events, and
recipients are resolved through the [Identity module](group-24-identity-module.md#iattendeequeryservice).
Read this chapter as the answer to one question: how does a single "notify everyone" intent become a
durable inbox row, a real-time toast, an OS push, and (for the live layer) an ephemeral group event,
without any of the four ever taking the others down, and without a retried request doing it twice.

### GetMyNotificationsQuery
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetInbox` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetInbox/GetMyNotificationsQuery.cs:11` · Level 0 · record

- **What it is**: the read request that backs a user's in-app notification inbox, "give me page N of my
  notifications". A `sealed record` carrying the caller's `UserId`, paging arguments, and an optional
  scope key.
- **Depends on**: the solution-wide `UserIdentifierType` alias (see
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)); BCL only otherwise.
  Handled by [GetMyNotificationsHandler](#getmynotificationshandler) through the query side of the CQRS
  pipeline ([IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)).
- **Concept introduced**: **the paged-query record shape.** This is the first notification query, so note
  the convention it shares with every read in the codebase: an immutable positional `record` with
  defaulted paging (`PageNumber = 1`, `PageSize = 20`,
  `GetMyNotificationsQuery.cs:13-14`) is the message, a matching handler is the behavior, and the two are
  joined by a closed generic registration rather than a direct call
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:66-67`).
  It also introduces **the scope key as an optional view filter**: `ScopeKey` defaults to `null`, and the
  XML doc states what that default means (`GetMyNotificationsQuery.cs:7-10`), namely that a null scope is
  the legacy read returning every notification, while a supplied scope narrows the inbox to notifications
  carrying that scope plus the unscoped ones. Making the narrowing opt-in is what keeps an existing
  caller's result set unchanged ([ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html)
  records the scope key on the sent artifact).
  `[Rubric §6, CQRS & Event-Driven]` assesses whether reads and writes are modeled as distinct,
  single-purpose messages; this record is a pure read with no side effects.
  `[Rubric §12, Performance & Scalability]` assesses guarding against unbounded work: the XML doc pins
  `PageSize` at "max 500" (`GetMyNotificationsQuery.cs:6`) and
  [GetMyNotificationsHandler](#getmynotificationshandler) enforces that ceiling as a `const`, so a client
  cannot request an unbounded page.
- **Walkthrough**: four positional members, `UserId` (the authenticated user, line 12), `PageNumber`
  defaulting to 1 (line 13), `PageSize` defaulting to 20 (line 14), and the nullable `ScopeKey`
  (line 15). No factory, no validation here: it is a plain carrier, and the page ceiling, the
  negative-offset guard and the scope join are all applied downstream in the handler.
- **Why it's built this way**: a positional record gives value equality and immutability for free, which
  is exactly what a query message wants (it is data in flight, never mutated). The default page size
  keeps the common "just show my inbox" call one-argument-simple, and the defaulted `ScopeKey` means
  adding scoping did not break a single existing construction site.
- **Where it's used**: constructed by [InboxController](#inboxcontroller) from the resolved caller id, the
  query-string paging values and the optional `scope` argument
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationInboxController.cs:55`),
  then handled by [GetMyNotificationsHandler](#getmynotificationshandler). The controller bounds the
  scope string with `[StringLength(PushNotification.ScopeKeyMaxLength)]`
  (`NotificationInboxController.cs:46`), the same 128-character constant the entity publishes
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:22`).

### GetNotificationHistoryQuery
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.UseCases.GetHistory` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/GetHistory/GetNotificationHistoryQuery.cs:6` · Level 0 · record

- **What it is**: the read request for the push-notification *sent history* (the admin-facing "what did
  we broadcast" list), as opposed to a single user's inbox. A `sealed record` of paging arguments only.
- **Depends on**: BCL only. Handled by [GetNotificationHistoryHandler](#getnotificationhistoryhandler).
- **Concept introduced**: none new; this is the same paged-query shape
  [GetMyNotificationsQuery](#getmynotificationsquery) introduced, minus a user filter and minus the scope
  key. History is global (it lists [PushNotification](#pushnotification) rows, the sent artifacts), so
  there is no `UserId` member and no per-reader narrowing. `[Rubric §6, CQRS & Event-Driven]`: a second
  read model (sent history) distinct from the inbox read model, each with its own query, handler and DI
  entry (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:64-65`).
- **Walkthrough**: two positional members, `PageNumber = 1` (line 7) and `PageSize = 10` (line 8). Note
  the default page size is 10 here versus 20 for the inbox; both are capped at 500 by their handlers, and
  both XML docs state the ceiling (`GetNotificationHistoryQuery.cs:5`).
- **Where it's used**: constructed by [NotificationsController](#notificationscontroller)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:85`),
  handled by [GetNotificationHistoryHandler](#getnotificationhistoryhandler).

### GetUnreadNotificationCountQuery
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetUnreadCount` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetUnreadCount/GetUnreadNotificationCountQuery.cs:9` · Level 0 · record

- **What it is**: the tiniest read in the group, "how many unread notifications does this user have?". A
  two-member `sealed record` wrapping `UserId` plus the same optional `ScopeKey` the inbox read takes.
  Its XML doc (`GetUnreadNotificationCountQuery.cs:3`) names the unread badge as the reason it exists.
- **Depends on**: the `UserIdentifierType` alias; BCL only otherwise. Handled by
  [GetUnreadNotificationCountHandler](#getunreadnotificationcounthandler).
- **Concept introduced**: none new; a purpose-built count query rather than fetching a page and counting
  client-side. The scope member exists for one reason, stated in its XML doc
  (`GetUnreadNotificationCountQuery.cs:5-8`): the badge must count exactly what the list will show, so
  both reads narrow by the same rule. `[Rubric §12, Performance & Scalability]`: a dedicated `COUNT`
  query avoids materializing rows just to size a badge, so the bell can poll cheaply.
- **Walkthrough**: two positional members, `UserId` (line 10) and the nullable `ScopeKey` (line 11). No
  paging: the answer is a single integer.
- **Where it's used**: constructed by [InboxController](#inboxcontroller)'s unread-count action
  (`NotificationInboxController.cs:79`, scope bound at `NotificationInboxController.cs:70`) behind the
  [NotificationBell](group-15-common-ui-framework.md#notificationbell) badge; handled by
  [GetUnreadNotificationCountHandler](#getunreadnotificationcounthandler). That action is also marked
  `[ResponseCache(NoStore = true)]` (`NotificationInboxController.cs:67`), so a badge poll is never
  served from a stale cache.

### IEmailSender
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Mail` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Mail/IEmailSender.cs:6` · Level 0 · interface

- **What it is**: the Application-layer port for sending email. Two `SendAsync` overloads: one to an
  explicit recipient, one to a default/system recipient (admin notifications). Infrastructure supplies
  the concrete transport.
- **Depends on**: BCL only (`Task`, `CancellationToken`). Implemented by [SmtpEmailSender](#smtpemailsender)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpEmailSender.cs:12`).
- **Concept introduced**: **the port/adapter split for outbound side effects.** Application code that
  needs to send mail depends on this interface, never on an SMTP client; the XML doc names SMTP or
  SendGrid as interchangeable backings (`IEmailSender.cs:4`). `[Rubric §3, Clean Architecture]` assesses
  whether the core depends inward on abstractions rather than outward on I/O libraries, and this
  interface is a textbook outbound port: the dependency arrow points from Infrastructure's
  [SmtpEmailSender](#smtpemailsender) *into* Application, so the transport is swappable without touching
  a handler. `[Rubric §1, SOLID]` (Dependency Inversion): the high-level policy owns the contract, the
  low-level detail implements it.
- **Walkthrough**: `SendAsync(string to, string subject, string body, bool isHtml = false, CancellationToken cancellationToken = default)`
  (line 15): explicit recipient, HTML flag defaulting to plain text.
  `SendAsync(string subject, string body, bool isHtml = false, CancellationToken cancellationToken = default)`
  (line 23): the same message routed to the implementation's configured default/system recipient, so
  callers that always mail the operators do not repeat the address. In the SMTP implementation that
  address is `SmtpSettings.To`, reached through a settings field captured once from `IOptions`
  (`SmtpEmailSender.cs:14`) and forwarded to the explicit-recipient overload (`SmtpEmailSender.cs:48`).
- **Why it's built this way**: keeping the interface in Application (and the SMTP dependency in
  Infrastructure) is what lets a test host register a no-op sender and production register
  [SmtpEmailSender](#smtpemailsender). Registration is `TryAddTransient<IEmailSender, SmtpEmailSender>()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:573`), so the `TryAdd` lets
  a host pre-register its own sender and win.
- **Where it's used**: the framework's own consumer is the password-reset flow:
  [ForgotPasswordHandlerBase<TUser, TCommand>](group-14-module-system-composition.md#forgotpasswordhandlerbasetuser-tcommand)
  takes it as a primary-constructor dependency
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:39`),
  and MMCA.ADC's concrete
  [ForgotPasswordHandler](group-24-identity-module.md#forgotpasswordhandler) passes its own sender through
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:24`).
  MMCA.Store uses it twice more, resolving it from a scope inside `OrderPaidHandler` and
  `OrderPaymentFailedSagaHandler`
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/DomainEventHandlers/OrderPaidHandler.cs:41`,
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Saga/OrderPaymentFailedSagaHandler.cs:31`),
  the arrangement [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html) describes.
- **Caveats / not-in-source**: the "default/system recipient" of the second overload is not defined by
  this interface; it is whatever the implementation's settings configure.

### ILiveChannelPublisher
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/ILiveChannelPublisher.cs:9` · Level 0 · interface

- **What it is**: the port for publishing *ephemeral* live events to a channel of currently-connected
  clients (for example `event:1` or `session:123`). Its defining property, stated in the XML doc
  (`ILiveChannelPublisher.cs:4-6`): channel events are **not persisted**, so a client that is not
  connected and subscribed at publish time never sees them.
- **Depends on**: BCL only. Contrast with [IPushNotificationSender](#ipushnotificationsender) (which
  persists a [PushNotification](#pushnotification) plus per-user [UserNotification](#usernotification)
  inbox rows), a contrast the XML doc draws explicitly via `<see cref="IPushNotificationSender"/>`
  (line 5). Implemented by [SignalRLiveChannelPublisher](#signalrlivechannelpublisher), the
  [NullLiveChannelPublisher](#nulllivechannelpublisher) no-op, and in MMCA.ADC by the out-of-process
  [LiveChannelPublisherGrpcAdapter](#livechannelpublishergrpcadapter)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/LiveChannelPublisherGrpcAdapter.cs:22`).
- **Concept introduced**: **ephemeral fan-out versus durable notification.** This is the distinction that
  splits the whole group in two: live channel events (poll-results-changed, a new session question) are
  fire-and-forget to whoever is watching *right now*, while push notifications are durable and land in an
  inbox ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)). The interface
  deliberately speaks in strings (a `channelKey`, an application-defined `eventName`, a `payloadJson`
  string) so it stays transport-agnostic; the XML doc names SignalR groups or a message fan-out service
  as candidate backings (line 7).
  `[Rubric §7, Microservices Readiness]` assesses whether cross-boundary calls go through abstractions
  that can be re-homed onto a network transport: in MMCA.ADC this exact interface is served over gRPC by
  the Notification host's [LiveChannelGrpcService](#livechannelgrpcservice)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/LiveChannelGrpcService.cs:22`) and
  consumed through a scoped adapter that `Replace`s the local registration in publishing services
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/DependencyInjection.cs:48`), so the boundary
  already survives extraction ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html),
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).
- **Walkthrough**: one method,
  `PublishAsync(string channelKey, string eventName, string payloadJson, CancellationToken cancellationToken = default)`
  (line 17): publish an event to every client currently subscribed to `channelKey`. No return value
  beyond the `Task`, because there is no delivery guarantee to report.
- **Why it's built this way**: a JSON-string payload plus a free-form event name keeps the framework out
  of the business of knowing each live event's schema; the presentation and UI layers agree on the
  contract. Non-delivery to absent clients is the intended semantics, not a gap. The default registration
  is the inert [NullLiveChannelPublisher](#nulllivechannelpublisher)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:575`), replaced by
  [SignalRLiveChannelPublisher](#signalrlivechannelpublisher) when a host opts into the SignalR wiring
  (same file, line 632).
- **Where it's used**: ADC's conference-day live layer does **not** inject it into command handlers.
  Handlers enqueue a work item and a single-reader hosted drain,
  [LiveChannelPublishProcessor](group-22-engagement-module.md#livechannelpublishprocessor), resolves the
  publisher from a fresh scope per work item and calls `PublishAsync` in FIFO order
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:50-56`).
  `[Rubric §29, Resilience & Business Continuity]` assesses whether a degraded dependency stays contained:
  the drain wraps each publish in [BestEffort](group-03-querying-specifications.md#besteffort)
  (`LiveChannelPublishProcessor.cs:45-58`), which turns any non-cancellation failure into one Warning log
  plus one metric increment instead of an exception
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/BestEffort.cs:65-71`), and it returns quietly
  when host shutdown is the reason a publish stopped (`LiveChannelPublishProcessor.cs:60-64`, the
  rethrow-on-cancellation half of `BestEffort` at `BestEffort.cs:59-64`). A down Notification peer can
  therefore never fail an Engagement command. The other consumer is the Notification host's gRPC ingress,
  which forwards a wire call onto the local SignalR publisher.
- **Caveats / not-in-source**: the interface itself makes no delivery or ordering guarantee; those are
  properties of the concrete SignalR, queue and gRPC wiring, not visible here.

### INotificationRecipientProvider
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/INotificationRecipientProvider.cs:8` · Level 0 · interface

- **What it is**: a single-method port returning the set of user IDs that should receive a broadcast push
  notification. The framework knows *how* to send; the consuming app implements this to answer *who* (the
  XML doc's examples, `INotificationRecipientProvider.cs:5-6`: all attendees, users in a role,
  subscribers to a topic).
- **Depends on**: the `UserIdentifierType` alias; BCL only otherwise. Works alongside
  [IPushNotificationSender](#ipushnotificationsender). The default framework registration is
  [NullNotificationRecipientProvider](#nullnotificationrecipientprovider); MMCA.ADC supplies
  [AttendeeNotificationRecipientProvider](#attendeenotificationrecipientprovider)
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/DependencyInjection.cs:24`).
- **Concept introduced**: **separating recipient policy from delivery mechanism.** "Who to notify" is
  app-specific domain knowledge; "how to notify" is framework infrastructure. Splitting them means the
  push pipeline never needs to understand ADC's attendee model.
  `[Rubric §7, Microservices Readiness]` assesses whether a shared component can be re-homed without its
  consumers changing; this is an inversion point that lets the shared framework host an app-defined
  audience query. `[Rubric §1, SOLID]` (Interface Segregation and Dependency Inversion): one focused
  method, and the sender depends on the abstraction rather than on a concrete audience source.
- **Walkthrough**:
  `Task<IReadOnlyList<UserIdentifierType>> GetRecipientUserIdsAsync(CancellationToken cancellationToken = default)`
  (lines 15-16): return the eligible recipient IDs. A read-only list, so callers cannot mutate the
  returned audience.
- **Why it's built this way**: registration is `TryAddScoped`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:75`), which is
  the mechanical expression of "framework default, app override": whichever provider the app registers
  first wins, and the null default only fills the gap. ADC registers its own with a plain `AddScoped`
  before calling `AddNotificationApplicationServices()`
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/DependencyInjection.cs:24,31`),
  so the `TryAdd` finds the slot already taken.
- **Where it's used**: [SendPushNotificationHandler](#sendpushnotificationhandler) takes it as a primary
  constructor dependency
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:29`),
  resolves the audience, then hands it to [IPushNotificationSender](#ipushnotificationsender). Until an
  app registers its own provider,
  [NullNotificationRecipientProvider](#nullnotificationrecipientprovider) returns an empty audience.

### IPushNotificationSender
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/IPushNotificationSender.cs:7` · Level 0 · interface

- **What it is**: the Application-layer port for real-time push delivery, with three targeting shapes:
  one user, a set of users, or a broadcast to everyone connected. The XML doc names SignalR or Firebase
  Cloud Messaging as interchangeable backings (`IPushNotificationSender.cs:4-5`).
- **Depends on**: the `UserIdentifierType` alias; BCL `Dictionary` for the optional metadata. Implemented
  by [SignalRPushNotificationSender](#signalrpushnotificationsender) (real delivery) and
  [NullPushNotificationSender](#nullpushnotificationsender) (the inert default). Paired with
  [INotificationRecipientProvider](#inotificationrecipientprovider) for audience resolution.
- **Concept introduced**: **the metadata dictionary as an open payload.** All three methods share
  `title`, `body`, and an optional `Dictionary<string, string>? metadata` (lines 16, 25, 33). That
  dictionary carries typed extras (a deep-link URL, a notification type, per the XML doc on line 13)
  without a bespoke strongly-typed payload per notification kind, so a new notification variety needs no
  interface change. `[Rubric §10, Cross-Cutting Concerns]` assesses whether a capability like push is
  factored once and reused broadly, and this single port serves every push-emitting feature. This is the
  *durable* counterpart to [ILiveChannelPublisher](#ilivechannelpublisher)'s ephemeral fan-out
  ([ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html)).
- **Walkthrough**:
  `SendToUserAsync(UserIdentifierType userId, string title, string body, Dictionary<string, string>? metadata = null, CancellationToken cancellationToken = default)`
  (line 16): one user. `SendToUsersAsync(IEnumerable<UserIdentifierType> userIds, ...)` (line 25): an
  explicit set. `BroadcastAsync(string title, string body, ...)` (line 33): all connected clients. The
  three methods differ only in targeting; body and metadata are identical.
- **Why it's built this way**: three targeting methods rather than one "audience" parameter keeps each
  call site's intent explicit and lets the SignalR implementation map user-targeting to hub groups
  directly. The default registration is the no-op
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:574`) so a host with no
  real-time transport still resolves the port; the SignalR wiring replaces it with `AddTransient` (same
  file, line 631), a deliberate override rather than a `TryAdd`.
- **Where it's used**: [SendPushNotificationHandler](#sendpushnotificationhandler) fans a message out
  through this port (`SendPushNotificationHandler.cs:30`) after persisting the
  [PushNotification](#pushnotification) record and its per-user
  [UserNotification](#usernotification) rows. That handler also carries a second, separate delivery leg,
  `INativePushSender` (`SendPushNotificationHandler.cs:31`), which is the OS-level channel of
  [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) rather than part of this
  port.

### MarkAllNotificationsReadCommand
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkAllRead` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkAllRead/MarkAllNotificationsReadCommand.cs:10` · Level 0 · record

- **What it is**: the only bulk write in the inbox, "clear my unread badge". A two-member `sealed record`
  wrapping the authenticated `UserId` and the same optional `ScopeKey` the two inbox reads accept.
- **Depends on**: the `UserIdentifierType` alias; BCL only otherwise. Handled by
  [MarkAllNotificationsReadHandler](#markallnotificationsreadhandler) via
  [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult).
  Its single-row sibling is [MarkNotificationReadCommand](#marknotificationreadcommand).
- **Concept introduced**: **commands opt into pipeline behavior through marker interfaces.** This record
  declares no base list at all (line 10), and neither does its single-row sibling
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkRead/MarkNotificationReadCommand.cs:6-8`).
  That is a decision, not an omission: the Transactional decorator only opens a transaction for a command
  that implements [ITransactional](group-05-cqrs-pipeline.md#itransactional) and otherwise passes it
  straight through
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs:27-29`),
  so marking notifications read runs on the handler's own single `SaveChangesAsync` rather than an
  ambient transaction. `[Rubric §6, CQRS & Event-Driven]` assesses whether the write path is modeled as
  explicit messages with explicit cross-cutting opt-ins; the decorator pipeline is described in
  [Group 05](group-05-cqrs-pipeline.md).
- **Walkthrough**: two positional members, `UserId` (line 11) and the nullable `ScopeKey` (line 12). The
  scope of the write is entirely implied by those two values; there is no id list to validate. The XML
  doc (`MarkAllNotificationsReadCommand.cs:5-9`) states the rule that motivates the second member: a
  scoped caller marks only the notifications it could see, "so a scoped client never silently clears rows
  it could not see". `[Rubric §11, Security]`: read and write narrow by the identical predicate, which is
  what keeps a scoped client from mutating rows outside its view.
- **Why it's built this way**: taking the user id as data rather than reading an ambient identity keeps
  the handler pure and testable; the controller is the one place that resolves "who is calling".
- **Where it's used**: constructed by [InboxController](#inboxcontroller)'s `PUT read-all` action from the
  current user id and the optional scope (`NotificationInboxController.cs:113,122`), and dispatched
  through the injected `ICommandHandler<MarkAllNotificationsReadCommand, Result>`
  (`NotificationInboxController.cs:33`). Registered in DI at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:60-61`.

### UserNotificationExportItemDTO
> MMCA.ADC.Notification.Shared · `MMCA.ADC.Notification.Shared.UserNotifications` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/UserNotifications/UserNotificationExportItemDTO.cs:8` · Level 0 · record

- **What it is**: one notification-inbox row inside a user's *personal-data export* (the data-subject
  access artifact the XML doc ties to PRIVACY.md §7, `UserNotificationExportItemDTO.cs:4`): the
  notification id, title, sent/read timestamps, and the scope it was sent under. This is an
  MMCA.ADC-specific contract, not a framework type.
- **Depends on**: the ADC `UserNotificationIdentifierType` alias; BCL `string` and `DateTime`. Returned by
  [IUserNotificationExportService](#iusernotificationexportservice); consumed by the Identity module's
  [NotificationUserDataExportSection](group-24-identity-module.md#notificationuserdataexportsection) and
  projected into
  [UserDataExportNotificationDTO](group-24-identity-module.md#userdataexportnotificationdto).
- **Concept introduced**: **export DTOs deliberately omit content.** The XML doc (lines 5-6) records that
  the notification *body* is left out of the summary by design; the export carries the metadata a data
  subject is owed (that they were notified, when, whether they read it, under which scope) without
  duplicating message bodies. `[Rubric §30, Compliance/Privacy/Data Governance]` assesses whether the
  codebase has concrete data-subject access and portability paths, and this DTO is the Notification
  module's contribution to that per-user export.
- **Walkthrough**: a `sealed record class` with `required NotificationId` (line 11), `required Title`
  (line 14), `required SentOn` (line 17, UTC), then three optional members: `IsRead` (line 20), nullable
  `ReadOn` (line 23, null when unread) and nullable `ScopeKey` (line 29, null for an unscoped
  notification, documented with the `event:1` example at lines 25-28). The `required` members force every
  export row to carry an identity, a title and a send time; the optional members model "never read" and
  "unscoped" without sentinel values.
- **Why it's built this way**: a flat immutable record is the right shape for a serialized export line:
  value semantics, no behavior, self-describing timestamps in UTC. Being `init`-only means an export row
  cannot be edited after assembly. Carrying `ScopeKey` keeps the export self-describing: two rows with
  the same title are distinguishable by the event they belonged to.
- **Where it's used**: assembled by the in-process
  [UserNotificationExportService](#usernotificationexportservice), which projects all six members
  server-side out of the inbox join
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/UserNotificationExportService.cs:31-39`),
  and returned across the export boundary to Identity; the disabled-module path substitutes
  [DisabledUserNotificationExportService](#disabledusernotificationexportservice) and the out-of-process
  path [UserNotificationExportServiceGrpcAdapter](#usernotificationexportservicegrpcadapter).

### IUserNotificationExportService
> MMCA.ADC.Notification.Shared · `MMCA.ADC.Notification.Shared.UserNotifications` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/UserNotifications/IUserNotificationExportService.cs:14` · Level 1 · interface

- **What it is**: the cross-module service contract for exporting the personal data the Notification
  module holds for one user: their inbox rows (ids, titles, sent and read dates). It is how the Identity
  module reaches into Notification-owned data to build a complete cross-service export.
- **Depends on**: [UserNotificationExportItemDTO](#usernotificationexportitemdto) (its return element),
  the ADC `UserIdentifierType` alias, and the `[ServiceContract]` marker from
  `MMCA.Common.Shared.Abstractions` (applied at `IUserNotificationExportService.cs:13`, imported at
  line 1). Implemented in-process by
  [UserNotificationExportService](#usernotificationexportservice) inside the Notification module
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/UserNotificationExportService.cs:15`)
  and, per the XML doc (`IUserNotificationExportService.cs:10-11`), by a gRPC adapter in
  `MMCA.ADC.Notification.Contracts` everywhere else; the disabled-module stub is
  [DisabledUserNotificationExportService](#disabledusernotificationexportservice).
- **Concept introduced**: **the "one interface, in-process or gRPC" extraction pattern.** The XML doc
  calls out that this mirrors Engagement's
  [IUserEngagementExportService](group-22-engagement-module.md#iuserengagementexportservice): a single
  interface the caller depends on, satisfied by an in-process implementation when the module is co-hosted
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/DependencyInjection.cs:28`)
  and by a gRPC adapter that `Replace`s that registration when it is not
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/DependencyInjection.cs:84`). The
  `[ServiceContract]` attribute is the machine-readable half of the same idea: it marks the interface as
  a cross-module boundary that architecture fitness tests can find and police.
  `[Rubric §7, Microservices Readiness]` assesses exactly this: whether a module boundary is expressed as
  an interface that can be re-homed onto a network transport without changing the caller
  ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) for gRPC extraction,
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) for topology).
  `[Rubric §30, Compliance/Privacy/Data Governance]`: it is one leg of the data-subject-access
  aggregation. `[Rubric §9, API & Contract Design]`: the contract is a plain async method over DTOs, so
  the same shape serves both the in-process and the wire binding (the `.proto` mirror lives at
  `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/Protos/user_notification_export.proto:17-19`,
  whose comments record that identifier aliases are `int` on the wire and dates travel as round-trip
  ISO 8601 strings, `user_notification_export.proto:14-16`).
- **Walkthrough**: one method,
  `GetUserNotificationExportAsync(UserIdentifierType userId, CancellationToken cancellationToken)`
  (line 23), returning `IReadOnlyList<UserNotificationExportItemDTO>` newest-first. Note the token has
  **no default value** here, so every caller must pass one explicitly. The XML doc (lines 17-18) states
  the implementation joins the framework [UserNotification](#usernotification) rows with their
  [PushNotification](#pushnotification) content, which is the same join the inbox read performs.
- **Where it's used**: the Identity module wraps it in a per-section adapter,
  [NotificationUserDataExportSection](group-24-identity-module.md#notificationuserdataexportsection),
  which takes it as its single constructor dependency
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/NotificationUserDataExportSection.cs:18`),
  calls it (`NotificationUserDataExportSection.cs:29-31`) and projects the rows into the export document
  (`NotificationUserDataExportSection.cs:33-44`), unaware of which of the three implementations it
  received. `[Rubric §29, Resilience & Business Continuity]`: that section deliberately does **not** catch
  transport failures (`NotificationUserDataExportSection.cs:11-15`), because the export handler wraps
  every section and degrades an unreachable peer to one unavailable section rather than failing the whole
  export.

### NullNotificationRecipientProvider
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/NullNotificationRecipientProvider.cs:8` · Level 1 · class

- **What it is**: the framework's default
  [INotificationRecipientProvider](#inotificationrecipientprovider), a Null Object that resolves an empty
  recipient list.
- **Depends on**: [INotificationRecipientProvider](#inotificationrecipientprovider) (the interface it
  fulfills); BCL only.
- **Concept introduced**: the **Null Object pattern**. `[Rubric §2, Design Patterns]` assesses idiomatic
  pattern use; here a benign default lets the push pipeline resolve and run in a host that has not (yet)
  declared an audience, so there is no null check in
  [SendPushNotificationHandler](#sendpushnotificationhandler) and no "provider not registered" failure at
  startup. MMCA.Common ships this as the default; a consuming app overrides it (in MMCA.ADC,
  [AttendeeNotificationRecipientProvider](#attendeenotificationrecipientprovider)).
- **Walkthrough**: a `sealed class` with one method. `GetRecipientUserIdsAsync` (lines 11-13) returns
  `Task.FromResult<IReadOnlyList<UserIdentifierType>>([])`, an empty collection expression: no I/O, and
  the explicit type argument keeps the returned task typed as the interface's read-only list.
- **Why it's built this way**: the XML doc (lines 4-6) states the expectation directly, that consuming
  apps should register their own provider. Pairing that with the `TryAddScoped` default registration
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:75`) means "safe
  by default, overridable without ceremony", and the comment on the line above says so in as many words
  (`DependencyInjection.cs:74`).
- **Where it's used**: registered by the notification DI extension; a broadcast that resolves recipients
  through this default simply reaches nobody until an app-specific provider replaces it.

### DisabledUserNotificationExportService
> MMCA.ADC.Notification.Shared · `MMCA.ADC.Notification.Shared.UserNotifications` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/UserNotifications/DisabledUserNotificationExportService.cs:7` · Level 2 · class

- **What it is**: the stub [IUserNotificationExportService](#iusernotificationexportservice) registered
  when the Notification module is disabled in a given host. It returns an empty inbox export.
- **Depends on**: [IUserNotificationExportService](#iusernotificationexportservice) and
  [UserNotificationExportItemDTO](#usernotificationexportitemdto); BCL only.
- **Concept introduced**: none new; it is the same Null Object idea as
  [NullNotificationRecipientProvider](#nullnotificationrecipientprovider), applied to the module-disabled
  path. `[Rubric §7, Microservices Readiness]`: the module system keeps cross-module interfaces
  resolvable even when a module is switched off, because
  [IModule](group-14-module-system-composition.md#imodule) has a dedicated `RegisterDisabledStubs` hook
  that [NotificationModule](#notificationmodule) implements with exactly this registration
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/NotificationModule.cs:34-35`).
  Identity's export section still binds its dependency and simply gets no notification rows rather than a
  resolution failure.
- **Walkthrough**: an `internal sealed class` (line 7) whose single method
  `GetUserNotificationExportAsync` (lines 10-11) returns
  `Task.FromResult<IReadOnlyList<UserNotificationExportItemDTO>>([])`, ignoring both the `userId` and the
  token. Registered as a singleton (`NotificationModule.cs:35`), which is safe precisely because it holds
  no state. `internal` is deliberate: the type is only ever named by the module that registers it, and
  every consumer sees it through the interface.
- **Why it's built this way**: a disabled module must not turn an unrelated feature (the data-subject
  export) into a 500. Returning an empty section is the honest answer: the module holds no data in this
  host.
- **Where it's used**: the disabled-stub path of [NotificationModule](#notificationmodule), so a host
  running without the Notification module still produces a valid (empty) notification section in a user
  data export.

### GetMyNotificationsHandler
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetInbox` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetInbox/GetMyNotificationsHandler.cs:16` · Level 8 · class

- **What it is**: the query handler that materializes a user's inbox page. It joins the per-user
  [UserNotification](#usernotification) rows with their shared [PushNotification](#pushnotification)
  content, optionally narrows that join by scope, and projects the pair into a single flat
  [UserNotificationDTO](#usernotificationdto).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (typed repositories) and
  [IQueryableExecutor](group-07-persistence-ef-core.md#iqueryableexecutor) (EF terminal operations kept
  out of Application), injected via primary constructor (lines 16-18), plus
  [PagingMath](group-03-querying-specifications.md#pagingmath). Implements
  [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)`<GetMyNotificationsQuery, Result<PagedCollectionResult<UserNotificationDTO>>>`.
  Returns [Result](group-01-result-error-handling.md#result),
  [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) and
  [PaginationMetadata](group-01-result-error-handling.md#paginationmetadata).
- **Concept introduced**: **the two-table inbox join and why the model is split.** A push notification is
  stored once (the [PushNotification](#pushnotification): title, body, created time, scope key) and fanned
  out into one lightweight [UserNotification](#usernotification) per recipient (which carries only
  per-user state: `IsRead`, `ReadOn`). The read side rejoins them. `[Rubric §8, Data Architecture]`
  assesses normalization and read/write model fit: the shared content is not duplicated per recipient,
  and the handler pays a join at read time to reassemble the inbox view. `[Rubric §3, Clean
  Architecture]`: the handler expresses the join as a LINQ `IQueryable` but never calls EF's
  `ToListAsync` or `CountAsync` directly, delegating those to
  [IQueryableExecutor](group-07-persistence-ef-core.md#iqueryableexecutor) so Application stays EF-free.
  `[Rubric §11, Security]`: the `where un.UserId == query.UserId` clause (line 48) is the entire tenancy
  boundary for an inbox, and the value comes from the resolved caller rather than from client input
  (`NotificationInboxController.cs:49,55`). The scope filter is explicitly **not** part of that boundary:
  the comment above it (lines 36-38) calls scope "a view filter, not a security boundary".
- **Walkthrough**: a `const int MaxPageSize = 500` states the ceiling on the type (line 21), matching the
  query's documented "max 500". `PagingMath.Clamp(query.PageNumber, query.PageSize, MaxPageSize)`
  (line 32) turns the requested page into a safe `(skip, take)` pair; the comment above it (lines 28-31)
  records why: the offset is computed in 64-bit because a 32-bit `(PageNumber - 1) * PageSize` wraps
  negative near `int.MaxValue`, and SQL Server rejects a negative `OFFSET` outright
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/PagingMath.cs:32-43`). Then: grab the
  two repositories from the unit of work, each typed by entity and identifier alias (lines 33-34); build
  the push-notification source, which is `TableNoTracking` unchanged for an unscoped read and gains a
  `pn.ScopeKey == null || pn.ScopeKey == scopeKey` predicate when a scope is supplied (lines 39-44, the
  local `string scopeKey` on line 42 giving the expression tree a non-nullable capture); build the LINQ
  query-syntax join of `UserNotification` to that source on `un.PushNotificationId equals pn.Id`,
  filtered to `query.UserId`, ordered by `pn.CreatedOn` descending, projected into `UserNotificationDTO`
  (lines 46-59, mapping id, push id, title, body, `IsRead`, `ReadOn`, and `SentOn = pn.CreatedOn`); count
  the joined set (line 61); page it with `Skip(skip).Take(take)` and materialize (lines 63-65); wrap
  total, page size and floored page number into
  [PaginationMetadata](group-01-result-error-handling.md#paginationmetadata) (line 69) and return a
  successful [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt)
  (line 70).
- **Why it's built this way**: both repositories are read through `TableNoTracking`, which is correct for
  a read (no change-tracking overhead since nothing is saved). Server-side projection into the DTO means
  only the needed columns cross the wire, and the count runs against the *same* joined expression so the
  total is consistent with the page. Note the count and the page are two round trips against one composed
  `IQueryable`, the standard cost of a paged read. The scope predicate is applied to the push-notification
  side *before* the join rather than after it, so an unscoped read composes exactly the query it always
  did. The metadata reports the clamped `take` and the floored page number (line 69) so the response
  describes the page actually served: the comment on lines 67-68 makes that explicit, and it matters
  because the `[Range]` attributes at the API boundary (`NotificationInboxController.cs:44-45`) do not
  protect a direct in-process caller.
- **Where it's used**: injected as a closed `IQueryHandler` into [InboxController](#inboxcontroller)
  (`NotificationInboxController.cs:30`), which is how it reaches the CQRS decorator pipeline described in
  [Group 05](group-05-cqrs-pipeline.md).

### GetUnreadNotificationCountHandler
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetUnreadCount` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetUnreadCount/GetUnreadNotificationCountHandler.cs:13` · Level 8 · class

- **What it is**: the query handler behind the unread badge: it counts a user's unread
  [UserNotification](#usernotification) rows, optionally narrowed to a scope, and returns the integer.
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) and
  [IQueryableExecutor](group-07-persistence-ef-core.md#iqueryableexecutor) (primary constructor,
  lines 13-15). Implements
  [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)`<GetUnreadNotificationCountQuery, Result<int>>`.
- **Concept introduced**: **a conditional join, and why the unscoped path must stay byte-for-byte the
  same.** The comment on lines 27-30 is the teaching moment: the join to
  [PushNotification](#pushnotification) is introduced **only** for a scoped count, because an
  unconditional join would drag `PushNotification`'s soft-delete global query filter into the legacy
  no-scope count and silently change a number no caller asked to change. A scoped count accepts that
  narrowing deliberately, since a scoped reader could not see a deleted parent anyway.
  `[Rubric §8, Data Architecture]` assesses awareness of how global query filters and joins interact;
  this is that awareness written into the code. `[Rubric §12, Performance & Scalability]`: the handler
  issues a server-side `COUNT` over `un.UserId == query.UserId && !un.IsRead` rather than fetching rows,
  so the bell can poll without materializing the inbox. It is also a good illustration of why
  [IQueryableExecutor](group-07-persistence-ef-core.md#iqueryableexecutor) exists: the handler composes
  the predicate in Application and hands the still-unexecuted `IQueryable` to Infrastructure to run.
- **Walkthrough**: get the [UserNotification](#usernotification) repository from the unit of work
  (line 22); compose the base filter over `TableNoTracking` for the user's unread rows (lines 24-25); when
  and only when a non-blank `ScopeKey` arrived, resolve the [PushNotification](#pushnotification)
  repository and re-form the query as a join keeping rows whose parent is unscoped or matches the scope
  (lines 31-40, with `select un` so the projection stays `UserNotification`); run
  `queryableExecutor.CountAsync` (line 42); return `Result.Success(count)` (line 44). No paging, no
  mapping, no failure branch: the count either comes back or the call throws through the pipeline.
- **Why it's built this way**: `string.IsNullOrWhiteSpace` (line 31) is the gate, so a blank query-string
  scope is treated as absent rather than as a scope nothing matches. Reassigning `unread` rather than
  branching into two separate counts keeps a single execution path for the terminal operator.
- **Where it's used**: injected into [InboxController](#inboxcontroller)
  (`NotificationInboxController.cs:31`), which serves the
  [NotificationBell](group-15-common-ui-framework.md#notificationbell) badge.

### MarkAllNotificationsReadHandler
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkAllRead` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkAllRead/MarkAllNotificationsReadHandler.cs:12` · Level 8 · class

- **What it is**: the command handler that clears a user's unread notifications (all of them, or just the
  ones in a scope): it loads the tracked unread rows, calls the domain method on each, and saves once.
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork),
  [IQueryableExecutor](group-07-persistence-ef-core.md#iqueryableexecutor) and the BCL `TimeProvider`
  (primary constructor, lines 12-15). Implements
  [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)`<MarkAllNotificationsReadCommand, Result>`
  and drives [UserNotification](#usernotification)'s `MarkAsRead`.
- **Concept introduced**: **write handlers read through `Table`, not `TableNoTracking`, and one
  no-tracking source poisons the whole composed query.** The two inbox reads in this part use
  `TableNoTracking`; this one uses `repository.Table` (line 24) precisely because the entities must stay
  attached to the change tracker for the subsequent `SaveChangesAsync` to see their mutations. The
  scoped join goes further and uses the **tracked** `Table` on the [PushNotification](#pushnotification)
  side too (line 42), and the comment on lines 35-40 explains why that is load-bearing: in EF Core an
  `AsNoTracking` source anywhere in a composed query switches the *whole* query to no-tracking, so the
  `UserNotification` rows would come back untracked and the `MarkAsRead` mutations would never be
  persisted, making a scoped read-all a silent no-op. Projecting `select un` (line 44) means only
  `UserNotification` instances are materialized, so no `PushNotification` is tracked by the join.
  `[Rubric §4, DDD]` assesses whether state changes go through the aggregate rather than around it: the
  handler never assigns `IsRead` itself, it calls `notification.MarkAsRead(readOnUtc)` (line 54) and the
  entity owns the transition, including the already-read early return
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/UserNotifications/UserNotification.cs:58-67`).
  `[Rubric §14, Testability]`: the read timestamp comes from an injected `TimeProvider`
  (line 15, used at line 51) rather than `DateTime.UtcNow`, which is what makes the clock substitutable
  in a unit test; the domain XML doc states that intent directly (`UserNotification.cs:53-57`).
- **Walkthrough**: get the [UserNotification](#usernotification) repository (line 22); compose the tracked
  unread query for this user (lines 24-25); apply the same conditional scope join the count handler uses,
  over tracked tables (lines 30-45); materialize through the executor (lines 47-49); take one UTC instant
  for the whole batch (line 51) so every row in one call reports the same read time; loop and call
  `MarkAsRead` (lines 52-55); persist **only if something changed**, guarded by `if (unread.Count > 0)`
  (lines 57-60); return `Result.Success()` (line 62).
- **Why it's built this way**: the `Count > 0` guard makes a repeated "mark all read" a genuine no-op at
  the database, which matters because the UI can fire it on every inbox open. This is a load-then-save
  loop rather than a set-based `ExecuteUpdate`, which keeps the transition inside the entity (and lets
  `MarkAsRead` stay the single place the invariant lives) at the cost of materializing the unread rows.
  Since [MarkAllNotificationsReadCommand](#markallnotificationsreadcommand) does not implement
  [ITransactional](group-05-cqrs-pipeline.md#itransactional), the single `SaveChangesAsync` is the atomic
  unit; see [Group 05](group-05-cqrs-pipeline.md) for the decorator order.
- **Where it's used**: injected into [InboxController](#inboxcontroller) as
  `ICommandHandler<MarkAllNotificationsReadCommand, Result>` (`NotificationInboxController.cs:33`) and
  invoked by the `PUT read-all` action (`NotificationInboxController.cs:123`), which returns 204 on
  success (`NotificationInboxController.cs:125`).

### GetNotificationHistoryHandler
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.UseCases.GetHistory` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/GetHistory/GetNotificationHistoryHandler.cs:15` · Level 9 · class

- **What it is**: the query handler for the push *sent history*: a reverse-chronological page of
  [PushNotification](#pushnotification) rows (no per-user join), mapped to
  [PushNotificationDTO](#pushnotificationdto).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork),
  [IQueryableExecutor](group-07-persistence-ef-core.md#iqueryableexecutor) and
  [PushNotificationDTOMapper](#pushnotificationdtomapper) (primary constructor, lines 15-18), plus
  [PagingMath](group-03-querying-specifications.md#pagingmath). Implements
  [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)`<GetNotificationHistoryQuery, Result<PagedCollectionResult<PushNotificationDTO>>>`.
- **Concept introduced**: none new; note the contrast with the inbox handler. History reads a *single*
  table (the sent artifacts) with no `UserId` filter and no scope narrowing, and maps entities to DTOs
  with an explicit [PushNotificationDTOMapper](#pushnotificationdtomapper) rather than an inline LINQ
  projection, which means it materializes whole entities before mapping. `[Rubric §6, CQRS &
  Event-Driven]`: a separate read model and handler for the admin history view, sharing nothing with the
  inbox read but the underlying table. `[Rubric §15, Best Practices & Code Quality]`: the paging
  arithmetic that both this handler and the inbox handler once open-coded now lives once in
  [PagingMath](group-03-querying-specifications.md#pagingmath), whose own remarks record that duplication
  as the reason it was extracted (`PagingMath.cs:14-18`).
- **Walkthrough**: `const int MaxPageSize = 500` (line 21) then
  `PagingMath.Clamp(query.PageNumber, query.PageSize, MaxPageSize)` (line 30); get the
  [PushNotification](#pushnotification) repository (line 31); ask the repository itself for the total via
  `repository.CountAsync` (line 33, note this one goes through the repository, not the queryable
  executor, because there is no composed predicate to count); page `TableNoTracking` ordered by
  `CreatedOn` descending with `Skip`/`Take` and materialize the entities through the executor
  (lines 35-40); run them through `dtoMapper.MapToDTOs` (line 42); build
  [PaginationMetadata](group-01-result-error-handling.md#paginationmetadata) from the total, the clamped
  `take` and the floored page number (line 46); return a successful
  [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) (line 48).
- **Why it's built this way**: history has no per-user state, so there is nothing to join; a dedicated
  mapper (versus an inline projection) is used because
  [PushNotificationDTO](#pushnotificationdto) is a richer contract reused across the push endpoints, and
  centralizing that mapping keeps the shape consistent (see
  [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) on manual/Mapperly mapping).
- **Where it's used**: injected into [NotificationsController](#notificationscontroller)'s history
  endpoint (`NotificationsController.cs:32`), which builds the query from its route arguments
  (`NotificationsController.cs:85`).

### DeviceInstallationRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Notifications.PushNotifications` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/PushNotifications/DeviceInstallationRequest.cs:12` · Level 0 · record (sealed)

- **What it is**: the client request a native app sends to register or refresh *this* device for
  platform push delivery. It carries three strings: a client-generated stable `InstallationId`, a
  `Platform` discriminator, and the `PushChannel` platform handle (the FCM registration token or the
  APNs device token).
- **Depends on**: nothing first-party. It uses `System.ComponentModel.DataAnnotations`
  (`[Required]`, `[MaxLength]`) from the BCL to bound the wire shape.
- **Concept introduced, the annotated request record.** This is the first push-side inbound contract in
  the chapter, and it shows the framework's convention for a client-supplied DTO: a `sealed record`
  with `required init` members plus DataAnnotations that ASP.NET model binding validates before a
  handler ever runs. Two `const string` platform values are published on the type itself,
  `FcmV1Platform = "fcmv1"` (`DeviceInstallationRequest.cs:15`) and `ApnsPlatform = "apns"`
  (`DeviceInstallationRequest.cs:18`), so the accepted platform tokens have one source of truth rather
  than being sprinkled around as magic strings. `[Rubric §9, API & Contract Design]` assesses whether
  request contracts are explicit, bounded, and self-describing: the `[MaxLength(128)]`,
  `[MaxLength(16)]`, and `[MaxLength(1024)]` caps (`DeviceInstallationRequest.cs:22,27,32`) pin the
  payload and column sizes right on the contract. `[Rubric §11, Security]` shows in the design rule the
  doc comment states (`DeviceInstallationRequest.cs:5-11`): ownership is stamped server-side from the
  authenticated user and is deliberately *not* a field on this request, so a client cannot register a
  device against someone else's account.
- **Walkthrough**: two platform constants (lines 15, 18), then three `required string` init members,
  `InstallationId` (line 23), `Platform` (line 28), and `PushChannel` (line 33), each with `[Required]`
  and a `[MaxLength]` cap. The `InstallationId` is client-stable by design so that re-registering after
  a token rotation updates the same installation rather than creating a duplicate
  (`DeviceInstallationRequest.cs:6-9`).
- **Why it's built this way**: the doc comment attributes the shape to
  [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) (native push delivery).
  A stable client id plus a rotating platform channel is the installation model both FCM v1 and APNs
  expect, and keeping ownership server-stamped keeps the trust boundary at the authenticated request.
- **Where it's used**: bound as the `[FromBody]` parameter of the registration action on
  [DevicesController](#devicescontroller) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:35`),
  which is routed at `Notifications/Devices`
  (`.../DevicesController.cs:21`) and gated by the
  [NotificationFeatures](#notificationfeatures)`.PushNotifications` flag (`.../DevicesController.cs:23`).

### MarkNotificationReadCommand
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkRead` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkRead/MarkNotificationReadCommand.cs:6` · Level 0 · record (sealed)

- **What it is**: the CQRS command to mark a single inbox notification as read for the current user. A
  two-parameter positional record: the `NotificationId` to mark and the `UserId` that must own it
  (`MarkNotificationReadCommand.cs:6-8`).
- **Depends on**: nothing first-party. It uses the `UserNotificationIdentifierType` and
  `UserIdentifierType` aliases (`MarkNotificationReadCommand.cs:7-8`), which are solution-wide
  `global using ... = int;` aliases linked via `Directory.Build.props`, so there is no first-party type
  edge here.
- **Concept, a command carrying its own authorization key.** Unlike a request DTO, a command is the
  input to a [handler](#marknotificationreadhandler) in the CQRS pipeline (see
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)). The load-bearing detail
  is that `UserId` is part of the command rather than looked up loosely later: the handler filters on
  it to enforce ownership. `[Rubric §6, CQRS & Event-Driven]` assesses whether writes flow through
  explicit command messages; this is the minimal shape of one.
- **Walkthrough**: two positional parameters (`MarkNotificationReadCommand.cs:6-8`). No decorator
  marker interfaces are declared on the type (no `ITransactional`, no cache-invalidation marker), so it
  rides the default command pipeline unadorned.
- **Where it's used**: handled by [MarkNotificationReadHandler](#marknotificationreadhandler); the
  authenticated `UserId` is supplied by the inbox controller from the token claim, never by the client
  body.

### NotificationFeatures
> MMCA.Common.Shared · `MMCA.Common.Shared.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/NotificationFeatures.cs:6` · Level 0 · class (static)

- **What it is**: the feature-flag key constants for the Notification module. It holds exactly one:
  `PushNotifications = "Notification.PushNotifications"` (`NotificationFeatures.cs:9`).
- **Depends on**: nothing first-party.
- **Concept, feature flags as named constants.** `[Rubric §10, Cross-Cutting Concerns]` assesses
  whether cross-cutting configuration lives in one place rather than as copy-pasted string literals.
  Defining the flag key once as a `const string` keeps every gate that references it typo-free; the
  value is resolved at runtime by the feature-management layer that the feature-gate decorators and
  the `[FeatureGate]` attribute consult (see
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Walkthrough**: one `public const string` on a `static` class (`NotificationFeatures.cs:6-10`).
- **Where it's used**: the constant is applied as `[FeatureGate(NotificationFeatures.PushNotifications)]`
  on all three notification controllers,
  [NotificationsController](#notificationscontroller)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:28`),
  `NotificationInboxController`
  (`.../NotificationInboxController.cs:27`), and
  [DevicesController](#devicescontroller) (`.../DevicesController.cs:23`), so turning the flag off
  removes the whole push surface at once.

### NotificationPermissions
> MMCA.Common.Shared · `MMCA.Common.Shared.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/NotificationPermissions.cs:7` · Level 0 · class (static)

- **What it is**: the permission-key constants for the Notification module. It holds exactly one:
  `Manage = "notifications:manage"` (`NotificationPermissions.cs:10`), covering both sending push
  notifications and reading the send history.
- **Depends on**: nothing first-party.
- **Concept, capability-named permissions instead of roles.** The doc comment states the rule
  (`NotificationPermissions.cs:3-6`): a host grants these constants to whichever roles it wants to hold
  them through `AddPermissions(...)`, and the endpoints state the *capability*, never a role.
  `[Rubric §11, Security]` assesses whether authorization is expressed as fine-grained capabilities
  that can be re-granted without touching endpoint code: because the controller carries
  `[HasPermission(NotificationPermissions.Manage)]`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:29`)
  rather than a role name, moving the capability from one role to another is a single line in the host's
  DI. The permission machinery itself ([HasPermissionAttribute](group-08-auth.md#haspermissionattribute),
  [PermissionRegistry](group-08-auth.md#permissionregistry)) is taught in
  [Group 08](group-08-auth.md). `[Rubric §16, Maintainability]`: a `const string` means the grant site
  and the check site cannot drift apart by a typo.
- **Walkthrough**: one `public const string` on a `static` class (`NotificationPermissions.cs:7-11`).
- **Where it's used**: granted to [RoleNames](group-08-auth.md#rolenames)`.Organizer` and to no other
  role by ADC's Notification module wiring
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:38`, see
  [DependencyInjection](#dependencyinjection)); enforced on the framework's
  [NotificationsController](#notificationscontroller).

### NotificationScopeKey
> MMCA.Common.Shared · `MMCA.Common.Shared.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/NotificationScopeKey.cs:20` · Level 0 · class (static partial)

- **What it is**: the canonical formatter *and* validator for a notification scope key (called a
  channel key on the SignalR join path): the `event:{id}` / `session:{id}` string that narrows a push
  notification, or a live channel, to one subject.
- **Depends on**: nothing first-party. It uses `System.Globalization.CultureInfo` and the source-generated
  `System.Text.RegularExpressions.Regex` from the BCL.
- **Concept introduced, keeping a format and its guard in one type.** A string format that is written in
  one place and validated in another is a latent bug: change either half and the other silently
  strands. This type collapses both halves onto one static class (`NotificationScopeKey.cs:11-19`).
  The `Pattern` constant (`NotificationScopeKey.cs:32`) is literally the default value of
  `PushNotificationSettings.ChannelKeyPattern`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/PushNotificationSettings.cs:29`), the
  regex [NotificationHub](#notificationhub) enforces before a client may join a group
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/NotificationHub.cs:72`), so every key the
  factories produce is a key the hub accepts by construction. `[Rubric §15, Best Practices & Code
  Quality]` assesses whether shared literals are centralized: the alternative here was a hand-written
  interpolation at each call site, which is what this replaced. `[Rubric §12, Performance &
  Scalability]` shows in `[GeneratedRegex]` (`NotificationScopeKey.cs:57`): the regex is compiled at
  build time by the source generator rather than parsed at runtime, and it carries a 1000 ms match
  timeout. `[Rubric §27, i18n]` is the subtle one: `ForEvent` and `ForSession` format the identifier
  under `CultureInfo.InvariantCulture` (`NotificationScopeKey.cs:38,44`) so a thread culture with
  non-ASCII digits cannot produce a key that its own `Pattern` would reject.
- **Walkthrough**: three constants first, `EventPrefix = "event"` (line 23), `SessionPrefix = "session"`
  (line 26), and `Pattern = "^(event|session):[0-9]+$"` (line 32). Then two factories,
  `ForEvent(long)` (lines 37-38) and `ForSession(long)` (lines 43-44), both built with
  `string.Create(CultureInfo.InvariantCulture, $"...")`, which formats into a stack buffer without an
  intermediate allocation. `IsValid(string?)` (lines 51-52) short-circuits on null or empty before
  running the generated matcher. The matcher itself is the private partial property `ScopeKeyRegex`
  (lines 57-58), declared `[GeneratedRegex(Pattern, RegexOptions.ExplicitCapture,
  matchTimeoutMilliseconds: 1000)]`; the comment above it (lines 54-56) records why `ExplicitCapture` is
  safe, it only suppresses the unused capture group of the alternation and leaves the pattern text and
  `IsMatch` semantics identical.
- **Why it's built this way**: a scope key crosses three subsystems (the send request, the persisted
  aggregate, and the SignalR group name), so its shape is a contract. Putting the format, the prefixes,
  and the regex on one type makes a change to any of them a compile-time coordinated edit.
- **Where it's used**: ADC's Engagement module builds every live-channel and points-subject key through
  it, [LivePollChannel](group-23-engagement-live-layer.md#livepollchannel)
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LivePolls/LivePollChannel.cs:25,30`),
  [PointsSubjectKeys](group-22-engagement-module.md#pointssubjectkeys)
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/Points/PointsSubjectKeys.cs:20,26`),
  and [CurrentEventNotificationScopeProvider](group-22-engagement-module.md#currenteventnotificationscopeprovider),
  which even builds its unresolved-state sentinel from `EventPrefix`
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/Notifications/CurrentEventNotificationScopeProvider.cs:39`)
  so the hub guard still accepts it. The `Pattern` constant is consumed as a settings default by
  [PushNotificationSettings](group-14-module-system-composition.md#pushnotificationsettings).

### PushNotificationStatus
> MMCA.Common.Domain · `MMCA.Common.Domain.Notifications.PushNotifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotificationStatus.cs:6` · Level 0 · enum

- **What it is**: the delivery lifecycle status of a push notification: `Pending`, `Sent`, `Failed`.
- **Depends on**: nothing first-party.
- **Concept**: a domain lifecycle enum owned by the [PushNotification](#pushnotification) aggregate.
  Its members are unnumbered (`PushNotificationStatus.cs:9-15`), so the ordinal is implicit
  (`Pending` = 0); the value is written and read within a single store, so a pinned numeric contract is
  not required here. `[Rubric §4, DDD]` assesses whether state is modeled explicitly rather than as
  loose booleans; a three-state enum captures the send outcome precisely.
- **Walkthrough**: three members with the obvious transition, `Pending` moves to either `Sent` or
  `Failed`, driven by the aggregate's `MarkAsSent`/`MarkAsFailed` methods
  (`PushNotification.cs:139,144`).
- **Where it's used**: the `private set` `Status` property on [PushNotification](#pushnotification)
  (`PushNotification.cs:37`); surfaced as its string name on
  [PushNotificationDTO](#pushnotificationdto).

### SendPushNotificationRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Notifications.PushNotifications` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/PushNotifications/SendPushNotificationRequest.cs:6` · Level 0 · record (sealed)

- **What it is**: the broadcast request to push a notification to every recipient. A two-parameter
  positional record, `sealed record SendPushNotificationRequest(string Title, string Body)`
  (`SendPushNotificationRequest.cs:6`), plus an optional `ScopeKey` init property and the two length
  limits both sides of the wire share.
- **Depends on**: nothing first-party.
- **Concept, publishing an invariant's number on the contract.** `TitleMaxLength = 200`
  (`SendPushNotificationRequest.cs:15`) and `BodyMaxLength = 2000`
  (`SendPushNotificationRequest.cs:21`) mirror the domain invariants
  `PushNotificationInvariants.TitleMaxLength` / `.BodyMaxLength`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/Invariants/PushNotificationInvariants.cs:13,16`),
  which the server enforces. The doc comment (`SendPushNotificationRequest.cs:8-14`) gives the reason:
  the contract is the one type both sides of the wire share, so a compose form can cap its input and
  draw its character counter from the same number the server rejects on, instead of restating it.
  `[Rubric §9, API & Contract Design]` assesses whether the contract is self-describing; publishing the
  bound is exactly that. `[Rubric §24, Forms/Validation/UX Safety]`: the UI validation and the server
  validation cannot disagree because they read the same constant, and the framework's send page test
  exercises the boundary through it
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Notifications/NotificationSendTests.cs:113`).
- **Walkthrough**: two positional parameters (line 6); two `public const int` limits (lines 15, 21);
  and `ScopeKey` as a nullable `init` property (line 28) rather than a third positional parameter,
  which the comment (lines 23-27) notes was deliberate so every existing caller keeps compiling. Null,
  the default, sends an unscoped notification that every read sees. No validation attributes live on
  this record: the content invariants are enforced server-side by the request validator and by the
  [PushNotification](#pushnotification) aggregate's `Create` factory.
- **Why it's built this way**: mirroring rather than importing the domain constant keeps
  `MMCA.Common.Shared` free of a dependency on `MMCA.Common.Domain`, which is what lets a client
  project reference the contracts assembly alone `[Rubric §3, Clean Architecture]`.
- **Where it's used**: bound as the `[FromBody]` parameter of the send action on
  [NotificationsController](#notificationscontroller)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:49`),
  which also reads the `Idempotency-Key` header and passes it on as the dedup key
  (`.../NotificationsController.cs:62`); consumed client-side by
  [PushNotificationService](group-15-common-ui-framework.md#pushnotificationservice).

### UserNotificationDTO
> MMCA.Common.Shared · `MMCA.Common.Shared.Notifications.UserNotifications` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/UserNotifications/UserNotificationDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: the read DTO for one item in a user's notification inbox. It merges the user's
  read-tracking (`IsRead`, `ReadOn`) with the underlying push content (`Title`, `Body`, `SentOn`) into
  the single shape the inbox UI renders.
- **Depends on**: nothing first-party. It uses the `UserNotificationIdentifierType` and
  `PushNotificationIdentifierType` aliases (`UserNotificationDTO.cs:10,13`), which are
  `global using ... = int;` aliases, so there is no first-party edge.
- **Concept, identifier-type aliases in a DTO.** `[Rubric §4, DDD]` assesses avoiding primitive
  obsession: the `Id` is typed `UserNotificationIdentifierType` and the foreign key
  `PushNotificationId` is typed `PushNotificationIdentifierType`, so the *names* carry intent even
  though both currently resolve to `int`. Change the alias in one file and every usage updates (see
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Walkthrough**: a `sealed record class` with `required init` values that must always be present,
  `Id`, `PushNotificationId`, `Title`, `Body`, and `IsRead` (`UserNotificationDTO.cs:10-22`), plus plain
  `init` members for the nullable `ReadOn` (line 25) and the always-present `SentOn` (line 28).
  `required` plus `init` gives set-once, non-null-where-it-matters immutability without a hand-written
  constructor.
- **Why it's built this way**: the DTO flattens two persistence concepts (the per-user read row and the
  shared push content) into the one row the inbox needs `[Rubric §9]`, mirroring the two-table join the
  read handler performs.
- **Where it's used**: returned by the inbox query
  [GetMyNotificationsHandler](#getmynotificationshandler). Note that the ADC privacy export uses a
  separate [UserNotificationExportItemDTO](#usernotificationexportitemdto) shape instead, because it
  carries the scope key and omits the body.

### AttendeeNotificationRecipientProvider
> MMCA.ADC.Notification.Application · `MMCA.ADC.Notification.Application` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/AttendeeNotificationRecipientProvider.cs:10` · Level 1 · class (sealed)

- **What it is**: the ADC-specific implementation of the framework's
  [INotificationRecipientProvider](#inotificationrecipientprovider) boundary. It answers the question
  "who are the recipients of a broadcast push?" with "every attendee", by delegating to the Identity
  module's attendee query.
- **Depends on**: [INotificationRecipientProvider](#inotificationrecipientprovider) (implements it) and
  [IAttendeeQueryService](group-24-identity-module.md#iattendeequeryservice) (constructor-injected,
  `AttendeeNotificationRecipientProvider.cs:10-11`).
- **Concept introduced, the app-supplied recipient strategy.** The framework defines *what* a recipient
  provider must return but deliberately does not decide *who* recipients are; that is an application
  policy each host plugs in. This is the `[Rubric §1, SOLID]` dependency-inversion story in miniature:
  `MMCA.Common` owns the [INotificationRecipientProvider](#inotificationrecipientprovider)
  abstraction, and ADC supplies the concrete "all attendees" rule, while a host that supplies nothing
  falls back to [NullNotificationRecipientProvider](#nullnotificationrecipientprovider).
  `[Rubric §3, Clean Architecture]` is why the class lives in ADC's module rather than in Common:
  recipient policy is business-specific and must not leak into the reusable framework.
  `[Rubric §7, Microservices Readiness]`: the provider talks to Identity through an interface, so when
  Identity is extracted the same call becomes a gRPC hop with no change here.
- **Walkthrough**: a primary-constructor class taking `IAttendeeQueryService`
  (`AttendeeNotificationRecipientProvider.cs:10-11`). Its single method `GetRecipientUserIdsAsync`
  (lines 14-16) is an expression-bodied `await` forwarding to
  `attendeeQueryService.GetAttendeeUserIdsAsync(cancellationToken)`, with no added logic.
- **Why it's built this way**: keeping the provider a thin bridge means the "who is a recipient"
  decision has exactly one place to change, and the Identity module stays the owner of the attendee
  roster.
- **Where it's used**: registered as the scoped `INotificationRecipientProvider` in the Notification
  module's application-layer [DependencyInjection](#dependencyinjection)
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/DependencyInjection.cs:24`);
  consumed by [SendPushNotificationHandler](#sendpushnotificationhandler) when it fans a broadcast out
  to per-user rows.

### DependencyInjection
> MMCA.ADC.Notification.API · `MMCA.ADC.Notification.API` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:16` · Level 1 · class (static)

- **What it is**: the Notification module's *outermost* DI composition. Its single extension method
  `AddNotificationModule` assembles the whole module: application services, EF configuration, the
  SignalR push pipeline, the optional native-push channel, the one permission grant, and the framework
  controllers.
- **Depends on**: [ApplicationSettings](group-14-module-system-composition.md#applicationsettings) and
  `IConfiguration` (parameters), the application-layer
  [DependencyInjection](#dependencyinjection)`.AddModuleNotificationApplication`,
  `AddNotificationInfrastructure()`, `AddPushNotifications(configuration)`,
  `AddNativePushNotifications(configuration)`, `AddPermissions(...)` plus
  [RoleNames](group-08-auth.md#rolenames) and [NotificationPermissions](#notificationpermissions), and
  `AddControllers().AddNotificationControllers()`.
- **Concept, the module composition root as a single ordered method.** Where the application-layer
  [DependencyInjection](#dependencyinjection) registers only ADC's policy choices, this one composes
  every layer of the module in one readable sequence, so a reader can see the module's entire surface
  without opening five files. `[Rubric §3, Clean Architecture]` assesses layer separation: the calls
  descend from application to infrastructure to presentation in that order, and the framework pieces
  (`AddPushNotifications`, `AddNotificationControllers`) come from `MMCA.Common` while only the
  permission grant is app-specific. `[Rubric §11, Security]` shows in that grant: the doc comment
  (lines 20-27) states the whole authorization story for the module in one place, that
  [NotificationPermissions](#notificationpermissions)`.Manage` is held by
  [RoleNames](group-08-auth.md#rolenames)`.Organizer` and by no other role, so an attendee cannot
  broadcast and an administrator holds no notification capability it was not explicitly given.
- **Walkthrough**: an `extension(IServiceCollection services)` block (line 18) containing
  `AddNotificationModule(ApplicationSettings, IConfiguration)` (lines 28-44). It calls
  `AddModuleNotificationApplication(applicationSettings)` (line 30) for ADC's handlers and policies,
  `AddNotificationInfrastructure()` (line 31) for the EF configuration, `AddPushNotifications(configuration)`
  (line 32) for the SignalR sender and hub, and `AddNativePushNotifications(configuration)` (line 36)
  for the native third channel. The comment on that last call (lines 34-35) records that it is a no-op
  unless the `NativePush` configuration section is enabled and complete, which is why it is safe to
  call unconditionally in every environment. Then the single grant,
  `services.AddPermissions(permissions => permissions.Grant(RoleNames.Organizer, NotificationPermissions.Manage))`
  (line 38), and finally `services.AddControllers().AddNotificationControllers()` (line 41), which
  registers the framework's notification controllers as ASP.NET Core application parts so their routes
  are discovered even though they live in a referenced assembly. The collection is returned for chaining
  (line 43).
- **Why it's built this way**: the framework ships the controllers, but a host only gets them if it opts
  in through the application-part registration, so a host that does not want a push surface simply does
  not load the module. Registering the native channel unconditionally and letting configuration decide
  keeps environment differences in `appsettings`, not in code
  ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).
- **Where it's used**: called from [NotificationModule](#notificationmodule)`.Register`
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/NotificationModule.cs:31`).

### PushNotificationDTO
> MMCA.Common.Shared · `MMCA.Common.Shared.Notifications.PushNotifications` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/PushNotifications/PushNotificationDTO.cs:8` · Level 1 · record class

- **What it is**: the read DTO for a persisted [PushNotification](#pushnotification): id, title, body,
  the sender, the recipient count, a delivery-status string, the optional scope key, and the creation
  timestamp.
- **Depends on**: [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)
  (implements `IBaseDTO<PushNotificationIdentifierType>`, `PushNotificationDTO.cs:8`).
- **Concept**: the standard `IBaseDTO` read-model shape (see
  [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)). Note that
  `Status` is a `string` (`PushNotificationDTO.cs:26`) even though the domain uses the
  [PushNotificationStatus](#pushnotificationstatus) enum: the DTO carries the serialized form so the API
  surface can evolve independently of the domain enum and stays readable in responses without a separate
  enum-to-string step at the client. `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: `required init` members for `Id`, `Title`, `Body`, `SentByUserId`, `RecipientCount`,
  and `Status` (`PushNotificationDTO.cs:11-26`), then two plain `init` members, the nullable `ScopeKey`
  (line 29) and `CreatedOn` (line 32). `ScopeKey` is optional rather than required precisely because
  unscoped notifications are the default (see [PushNotification](#pushnotification)). `DedupKey` is
  deliberately absent from the DTO: it is internal idempotency plumbing, not something a reader needs.
- **Where it's used**: returned by the notification-history query and rendered on the organizer's
  push-notification admin view.

### NotificationModule
> MMCA.ADC.Notification.API · `MMCA.ADC.Notification.API` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/NotificationModule.cs:15` · Level 3 · class (sealed)

- **What it is**: the [IModule](group-14-module-system-composition.md#imodule) entry point for the
  Notification bounded context. It is discovered at startup, declares its dependency on Identity, and
  hands registration off to the module's [DependencyInjection](#dependencyinjection).
- **Depends on**: [IModule](group-14-module-system-composition.md#imodule) (implements it),
  [ApplicationSettings](group-14-module-system-composition.md#applicationsettings),
  `IServiceCollection` / `IConfigurationBuilder`, the API-layer
  [DependencyInjection](#dependencyinjection), and, for the disabled path,
  [IUserNotificationExportService](#iusernotificationexportservice) plus
  [DisabledUserNotificationExportService](#disabledusernotificationexportservice).
- **Concept, the module manifest and its disabled stubs.** The module system is taught in
  [Group 14](group-14-module-system-composition.md); what this class shows is how thin a real module
  manifest is. Three properties describe the module to
  [ModuleLoader](group-14-module-system-composition.md#moduleloader), which registers modules in
  topological (Kahn) order, and two methods cover the two states a module can be in. `RequiresDependencies
  => true` (line 24) is the strict setting: Notification cannot come up without Identity, because its
  recipient provider needs the attendee roster. `[Rubric §7, Microservices Readiness]` assesses whether
  a module's boundary is explicit enough to extract: `Dependencies => ["Identity"]` (line 21) is that
  boundary stated as data, which is also what lets ADC run Notification as its own service host.
  `[Rubric §16, Maintainability]`: `RegisterDisabledStubs` (lines 34-35) means a host that turns the
  module off still resolves every cross-module contract the module publishes, so Identity's export
  aggregation keeps compiling and running instead of failing at container build.
- **Walkthrough**: `Name => "Notification"` (line 18) is the key
  [ModuleLoader](group-14-module-system-composition.md#moduleloader) uses to order and address the
  module; `Dependencies => ["Identity"]` (line 21) and `RequiresDependencies => true` (line 24) declare
  the hard edge. `Register` (lines 27-31) is a one-line expression body forwarding to
  `services.AddNotificationModule(applicationSettings, (IConfiguration)configuration)`; the cast is
  needed because the interface hands the module an `IConfigurationBuilder`.
  `RegisterDisabledStubs` (lines 34-35) registers
  [DisabledUserNotificationExportService](#disabledusernotificationexportservice) as a **singleton**
  [IUserNotificationExportService](#iusernotificationexportservice), a lifetime the live path does not
  use (the real service is scoped) because the stub holds no state and touches no database.
- **Why it's built this way**: the module publishes exactly one cross-module service, the Notification
  half of the PRIVACY.md §7 data-subject export (lines 12-13), and the stub keeps that contract
  satisfiable when the module is absent. Modules as data-declaring classes rather than hand-ordered
  startup calls is the pattern behind ADRs
  [007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and
  [008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html).
- **Where it's used**: discovered by [ModuleLoader](group-14-module-system-composition.md#moduleloader)
  in the ADC web host and in the standalone Notification service host.

### PushNotification
> MMCA.Common.Domain · `MMCA.Common.Domain.Notifications.PushNotifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:16` · Level 7 · class (sealed)

- **What it is**: the framework-level aggregate root for a push-notification broadcast. It records the
  title, body, sender, recipient count, delivery status, an optional deduplication key, and an optional
  scope key, and it raises a domain event on creation so the send and fan-out machinery can react.
- **Depends on**:
  [AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (base class), [PushNotificationInvariants](#pushnotificationinvariants) and
  [CommonInvariants](group-02-domain-building-blocks.md#commoninvariants) (validation),
  [PushNotificationStatus](#pushnotificationstatus), the
  [PushNotificationCreated](#pushnotificationcreated) domain event, and
  [Result](group-01-result-error-handling.md#result) (factory return). It carries the
  [IdValueGeneratedAttribute](group-02-domain-building-blocks.md#idvaluegeneratedattribute)
  (`PushNotification.cs:15`).
- **Concept, the aggregate-root factory idiom applied to a framework-owned entity** (the canonical
  entity-chain teaching is [Group 02](group-02-domain-building-blocks.md)). Three design choices are
  worth naming. First, `[IdValueGenerated]` (line 15) tells the persistence layer the database
  generates the id, so `Create` sets `Id = default` (line 128) and lets SQL Server fill the `IDENTITY`.
  Second, only `Create` raises a domain event; the state mutators do not, which is the
  `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §4, DDD]` distinction between a business-observable
  fact (a notification was created) and internal delivery bookkeeping. Third, and this is the
  interesting one, `DedupKey` (lines 39-45) is the aggregate's idempotency anchor:
  the doc comment records that a *filtered unique index* on the column lets the database arbitrate a
  race between two retried sends, so the same notification is never delivered twice.
  `[Rubric §29, Resilience & Business Continuity]` assesses whether retries are safe; here the
  guarantee is pushed down to a database constraint rather than trusted to a read-then-write check.
  `ScopeKey` (lines 47-53) is explicitly *not* a security boundary: the comment states that a read
  supplying a scope sees the notifications carrying that scope plus every unscoped one, and a read
  supplying none still sees everything, so it is an opaque view filter `[Rubric §11, Security]`.
- **Walkthrough**: two length constants first, `DedupKeyMaxLength = 128` (line 19) and
  `ScopeKeyMaxLength = 128` (line 22). Then seven `private set` properties, `Title`, `Body`,
  `SentByUserId`, `RecipientCount`, `Status` (lines 25-37), and the two nullable keys `DedupKey`
  (line 45) and `ScopeKey` (line 53). A private parameterless constructor (lines 56-60) seeds non-null
  strings for EF materialization; a private all-args constructor (lines 62-77) sets
  `Status = PushNotificationStatus.Pending` (line 74) and normalizes both optional keys, whitespace
  collapses to `null` (lines 75-76), so "empty string" can never become a distinct dedup identity.
  The static `Create` factory (lines 96-134) combines four invariant checks through `Result.Combine`
  (lines 104-120): title, body, and the two `EnsureStringMaxLength` guards for the dedup and scope keys,
  each carrying its own error code (`"PushNotification.DedupKey.TooLong"`, line 110;
  `"PushNotification.ScopeKey.TooLong"`, line 117) and an invariant-culture message. On any failure it
  returns `Result.Failure<PushNotification>(result.Errors)` (lines 121-124), aggregating every broken
  rule rather than reporting only the first. Otherwise it constructs the entity with `Id = default`
  (lines 126-129), raises `PushNotificationCreated(default, title, recipientCount)` (line 131), and
  returns success (line 133). `MarkAsSent` and `MarkAsFailed` (lines 139, 144) are one-line
  expression-bodied `void` transitions with no event: they record the delivery outcome for audit.
- **Why it's built this way**: living in `MMCA.Common.Domain`, this aggregate is reused by ADC and
  Store without coupling to any app's module. The `Pending` to `Sent`/`Failed` bookkeeping is
  intentionally event-free because it reflects an infrastructure callback, not a business decision.
  Both optional keys default to `null` so every pre-existing caller keeps its original behavior:
  no dedup key means every send creates a new notification, and no scope key means the notification is
  visible to every read (lines 87-94).
- **Caveats / not-in-source**: the filtered unique index that makes `DedupKey` a real race arbiter is
  described in the entity's doc comment (lines 40-43) but is declared in the EF configuration and
  migration, not here; the aggregate itself performs no uniqueness check.
- **Where it's used**: created by [SendPushNotificationHandler](#sendpushnotificationhandler) (one per
  broadcast), which then fans out a [UserNotification](#usernotification) per recipient; read back
  through [PushNotificationDTO](#pushnotificationdto) and joined for the privacy export by
  [UserNotificationExportService](#usernotificationexportservice).

### MarkNotificationReadHandler
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkRead` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkRead/MarkNotificationReadHandler.cs:12` · Level 8 · class (sealed)

- **What it is**: the command handler that marks one inbox notification as read, but only if it belongs
  to the requesting user.
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (repository plus save),
  [IQueryableExecutor](group-07-persistence-ef-core.md#iqueryableexecutor) (async materialization),
  `TimeProvider` (BCL, testable clock), [MarkNotificationReadCommand](#marknotificationreadcommand)
  (input), [UserNotification](#usernotification) (the aggregate it mutates), and
  [Result](group-01-result-error-handling.md#result) /
  [Error](group-01-result-error-handling.md#error) (outcome).
- **Concept, ownership enforced in the query, not after it.** `[Rubric §11, Security]` assesses whether
  authorization is enforced where the data is touched. This handler never loads a row by id and then
  checks the owner in memory; it filters on both `Id` and `UserId` in the same predicate
  (`MarkNotificationReadHandler.cs:26`), so a mismatched owner simply yields zero rows and the handler
  answers `NotFound` (lines 30-36) rather than leaking that the notification exists for someone else.
  `[Rubric §14, Testability]` shows in the injected `TimeProvider`: the read timestamp comes from
  `timeProvider.GetUtcNow().UtcDateTime` (line 38), not `DateTime.UtcNow`, so a test can pin the clock.
- **Walkthrough**: `HandleAsync` (lines 18-42) gets the `UserNotification` repository from the unit of
  work (line 22), builds a `Where(Id && UserId).Take(1)` query and materializes it through the queryable
  executor (lines 24-28), returns an `Error.NotFoundError` failure with code
  `"UserNotification.NotFound"` when there is no match (lines 30-36), otherwise calls the aggregate's
  `MarkAsRead(...)` with the injected UTC time (line 38), saves through the unit of work (line 39), and
  returns success (line 41). Every await uses `ConfigureAwait(false)`.
- **Why it's built this way**: the `Take(1)` plus owner-scoped filter is the cheapest safe read, and
  idempotency lives in the aggregate, not the handler:
  [UserNotification](#usernotification)`.MarkAsRead` returns immediately when `IsRead` is already true
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/UserNotifications/UserNotification.cs:58-67`),
  so a repeated mark neither overwrites the original `ReadOn` nor produces a spurious update. That keeps
  this handler a thin orchestrator.
- **Where it's used**: dispatched by the inbox controller's mark-read action, with the authenticated
  user id supplied server-side.

### UserNotificationExportService
> MMCA.ADC.Notification.Application · `MMCA.ADC.Notification.Application` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/UserNotificationExportService.cs:15` · Level 8 · class (internal sealed)

- **What it is**: the Notification half of ADC's cross-service data-subject export (PRIVACY.md §7). It
  returns every notification row for one user, joined to its push content, unpaged and newest first, so
  Identity's export aggregator can include a person's inbox in their downloadable data.
- **Depends on**: [IUserNotificationExportService](#iusernotificationexportservice) (implements it, the
  interface lives in `MMCA.ADC.Notification.Shared`),
  [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork),
  [IQueryableExecutor](group-07-persistence-ef-core.md#iqueryableexecutor), the framework
  [UserNotification](#usernotification) and [PushNotification](#pushnotification) entities, and the
  [UserNotificationExportItemDTO](#usernotificationexportitemdto) projection.
- **Concept, the privacy export read.** `[Rubric §30, Compliance/Privacy/Data Governance]` assesses
  whether a person can obtain the data held about them; this class is one section of that answer. It
  performs the same join as the inbox query but strips paging and always constrains to the requested
  user's rows (`UserNotificationExportService.cs:29`), so it can never return another subject's data.
  `[Rubric §12, Performance & Scalability]` shows in the two `TableNoTracking` reads (lines 27-28): the
  export is read-only, so change tracking is disabled. Note the class is `internal sealed` (line 15):
  only the interface is public, so nothing outside the assembly can bind to the implementation
  `[Rubric §1, SOLID]`.
- **Walkthrough**: `GetUserNotificationExportAsync` (lines 20-43) gets both repositories from the unit
  of work (lines 24-25), builds a LINQ query-syntax join of `UserNotification` to `PushNotification` on
  `PushNotificationId` (lines 27-28), filters `where un.UserId == userId` and orders by
  `pn.CreatedOn descending` (lines 29-30), projects into
  [UserNotificationExportItemDTO](#usernotificationexportitemdto) including the `ScopeKey` (lines 31-39),
  materializes through the queryable executor (line 41), and returns a fresh list via a collection
  expression (line 42).
- **Why it's built this way**: reusing the inbox join keeps the export consistent with what the user
  sees in-app, while the no-tracking, unpaged read matches a one-shot export rather than an interactive
  page.
- **Where it's used**: registered as the scoped
  [IUserNotificationExportService](#iusernotificationexportservice) by the module's application-layer
  [DependencyInjection](#dependencyinjection)
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/DependencyInjection.cs:28`);
  consumed by Identity's export aggregation over the cross-module interface (in-process when co-hosted,
  cross-process via the Notification service's gRPC ingress when extracted). When the module is
  disabled, [NotificationModule](#notificationmodule)`.RegisterDisabledStubs` substitutes
  [DisabledUserNotificationExportService](#disabledusernotificationexportservice) instead.

### DependencyInjection
> MMCA.ADC.Notification.Application · `MMCA.ADC.Notification.Application` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/DependencyInjection.cs:12` · Level 9 · class (static)

- **What it is**: the Notification module's application-layer DI composition. Its single extension
  method `AddModuleNotificationApplication` wires ADC's recipient policy and export service, then pulls
  in the framework's shared notification handlers.
- **Depends on**: [ApplicationSettings](group-14-module-system-composition.md#applicationsettings)
  (parameter), [INotificationRecipientProvider](#inotificationrecipientprovider) plus
  [AttendeeNotificationRecipientProvider](#attendeenotificationrecipientprovider),
  [IUserNotificationExportService](#iusernotificationexportservice) plus
  [UserNotificationExportService](#usernotificationexportservice), and the framework's
  `AddNotificationApplicationServices()` registration.
- **Concept, the `extension(IServiceCollection)` registration block.** DI wiring here uses the C#
  preview extension-member syntax (`DependencyInjection.cs:14`), which lets a library add methods
  directly to `IServiceCollection` (taught in the
  [primer](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
  `[Rubric §3, Clean Architecture]` is visible in the split of responsibility: this method registers the
  module's *app-specific* choices (attendees as recipients, the export service) and then calls the
  framework's `AddNotificationApplicationServices()` (line 31) for the reusable handlers, mapper,
  validator, and entity query service, so shared and app-specific wiring stay separate and only the
  app-specific half needs review when policy changes.
- **Walkthrough**: `AddModuleNotificationApplication` (lines 19-34) discards the unused
  `applicationSettings` with `_ = applicationSettings;` (line 21, commented "Reserved for future use",
  which also keeps the analyzers quiet about an unused parameter on a fixed signature), registers
  [AttendeeNotificationRecipientProvider](#attendeenotificationrecipientprovider) as the scoped
  `INotificationRecipientProvider` (line 24), registers
  [UserNotificationExportService](#usernotificationexportservice) as the scoped
  `IUserNotificationExportService` for the privacy export (line 28), calls the framework's
  `AddNotificationApplicationServices()` (line 31), and returns the collection for chaining (line 33).
- **Where it's used**: called first thing by the API-layer
  [DependencyInjection](#dependencyinjection)`.AddNotificationModule`
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:30`), which is
  itself driven by [NotificationModule](#notificationmodule)`.Register`.

### LiveChannelGrpcService
> MMCA.ADC.Notification.Service · `MMCA.ADC.Notification.Service.Grpc` · `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/LiveChannelGrpcService.cs:22` · Level 1 · class (sealed)

- **What it is**: the gRPC **server** endpoint that other services call to fan an ephemeral "live"
  event out to connected clients. It implements the generated
  `LiveChannelPushService.LiveChannelPushServiceBase` and delegates each call to the framework's
  [ILiveChannelPublisher](#ilivechannelpublisher).
- **Depends on**: [ILiveChannelPublisher](#ilivechannelpublisher) (injected via the primary
  constructor, `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/LiveChannelGrpcService.cs:22`;
  in this host it resolves to [SignalRLiveChannelPublisher](#signalrlivechannelpublisher), registered by
  `AddPushNotifications` because Notification is the host that maps the SignalR
  [NotificationHub](#notificationhub)), the generated `LiveChannelPushService` base (compiled from the
  `.Contracts` `.proto`, `LiveChannelGrpcService.cs:23`), and `Grpc.Core.ServerCallContext`.
- **Concept introduced, the live-channel ingress ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)).** `[Rubric §6, CQRS & Event-Driven]`
  assesses whether state changes travel as events; `[Rubric §7, Microservices Readiness]` assesses
  whether cross-process collaboration rides typed transports. The conference-day live layer (LivePolls,
  SessionQuestions) lives in the Engagement service, but only the Notification host owns the SignalR
  `IHubContext` that can reach browsers. So Engagement calls THIS gRPC endpoint **post-commit** to hand
  off an ephemeral event, which the service passes to the local publisher that fans it out over
  [NotificationHub](#notificationhub) (doc comment `LiveChannelGrpcService.cs:7-12`). This is the server
  half; its client half is [LiveChannelPublisherGrpcAdapter](#livechannelpublishergrpcadapter).
- **Walkthrough**: the single `PushToChannel` override (`LiveChannelGrpcService.cs:26`) null-guards
  `request` and `context` (`LiveChannelGrpcService.cs:30-31`), then awaits
  `publisher.PublishAsync(request.ChannelKey, request.EventName, request.PayloadJson, context.CancellationToken)`
  (`LiveChannelGrpcService.cs:33-35`) and returns an empty `PushToChannelResponse`
  (`LiveChannelGrpcService.cs:37`). The channel key, event name, and payload are opaque strings: the
  transport relays the event rather than modeling it.
- **Why it's built this way (security posture)**: there is deliberately **no `[Authorize]`**, and the
  endpoint is mapped without `RequireAuthorization`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:267`). `[Rubric §11, Security]`:
  the doc comment (`LiveChannelGrpcService.cs:13-20`) gives two reasons. First, this surface is reachable
  only on the internal service network (a dedicated internal port in Azure Container Apps, never routed
  by the Gateway), the same posture as the other internal gRPC services (it names
  `BookmarkCountsGrpcService`). Second, authorization is **not addable** here: the publishing caller is
  Engagement's [LiveChannelPublishProcessor](group-22-engagement-module.md#livechannelpublishprocessor)
  background drain, which runs with no `HttpContext` and therefore forwards no bearer token.
  Transport-wise it rides the [ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html)
  mixed-endpoint profile: Notification keeps its default endpoint `Http1AndHttp2` for SignalR WebSockets
  (`Program.cs:72`) and serves this h2c gRPC ingress on a dedicated `Http2`-only endpoint named `grpc`
  (port 8081 in the container, 5996 locally), declared in the `Kestrel:Endpoints` config section rather
  than in code; the full reasoning is spelled out at `Program.cs:56-71`.
- **Where it's used**: mapped by the Notification service's `Program.cs` (`Program.cs:267`); invoked by
  [LiveChannelPublisherGrpcAdapter](#livechannelpublishergrpcadapter) running inside Engagement.

---

### LiveChannelPublisherGrpcAdapter
> MMCA.ADC.Notification.Contracts · `MMCA.ADC.Notification.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/LiveChannelPublisherGrpcAdapter.cs:20` · Level 1 · class (sealed partial)

- **What it is**: the **client** half of the live-channel ingress. It is a hand-written adapter that
  implements the framework port [ILiveChannelPublisher](#ilivechannelpublisher) on top of the generated
  gRPC client, so a publishing service (Engagement) can keep calling the abstraction while the event
  actually travels to the Notification host over the wire.
- **Depends on**: [ILiveChannelPublisher](#ilivechannelpublisher) (Level 0, the implemented port); the
  generated `LiveChannelPushService.LiveChannelPushServiceClient` from the `.Contracts` `.proto`
  (injected via the primary constructor,
  `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/LiveChannelPublisherGrpcAdapter.cs:20-22`);
  `ILogger<LiveChannelPublisherGrpcAdapter>` and the source-generated `[LoggerMessage]` pattern. It talks
  to [LiveChannelGrpcService](#livechannelgrpcservice) on the far side.
- **Concept introduced, the hand-written adapter over a generated gRPC client.** `[Rubric §1, SOLID]`
  assesses dependency inversion: Engagement's live handlers depend only on `ILiveChannelPublisher`, and
  whether that resolves to the in-process SignalR publisher or this remote adapter is a composition-root
  decision (class doc, `LiveChannelPublisherGrpcAdapter.cs:7-12`). `[Rubric §7, Microservices Readiness]`
  assesses whether a module survives extraction: this class is exactly the piece that makes the extracted
  topology work without touching a single handler.
  `[Rubric §29, Resilience & Business Continuity]` assesses graceful degradation, and this adapter is the
  clearest example in the group: live channel events are ephemeral by contract
  ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)), so **every** failure
  (transport, name resolution, an open circuit) is logged and swallowed, never rethrown
  (`LiveChannelPublisherGrpcAdapter.cs:13-18`). A publishing command can therefore never fail because
  Notification is down or slow.
- **Walkthrough**
  - `PushDeadline` (`LiveChannelPublisherGrpcAdapter.cs:26`), a private `static readonly TimeSpan` of
    **2 seconds**. The comment above it (`:24-25`) explains the choice: it is deliberately tighter than
    the shared resilience pipeline's 30-second attempt timeout, because a live event that takes longer
    than two seconds is stale anyway and the publishing request should not be held hostage waiting for it.
  - `PublishAsync(channelKey, eventName, payloadJson, cancellationToken)`
    (`LiveChannelPublisherGrpcAdapter.cs:29`) builds a `PushToChannelRequest` from the three opaque
    strings and awaits `client.PushToChannelAsync(...)` with `deadline: DateTime.UtcNow.Add(PushDeadline)`
    and the caller's token (`:33-41`).
  - The `catch (Exception ex)` (`:44`) sits under a justified `#pragma warning disable CA1031`
    (`:43`, restored at `:45`) whose justification text is the contract itself: best-effort, no failure
    may escape. It calls `LogPushFailed(ex, channelKey, eventName)` (`:47`), a source-generated
    `[LoggerMessage]` at **Warning** level (`:51-52`). `[Rubric §13, Observability]`: the failure is
    invisible to the caller but not to the operator.
- **Why it's built this way**: writing the adapter by hand (rather than letting consumers inject the
  generated client directly) is what keeps the gRPC dependency out of the Engagement handlers, and it is
  the only place the best-effort policy has to be stated. Compare its sibling
  [UserNotificationExportServiceGrpcAdapter](#usernotificationexportservicegrpcadapter), which is
  deliberately the opposite: there, transport failures **do** propagate, because the caller needs to know
  the export section is unavailable.
- **Where it's used**: registered by the Notification.Contracts
  [DependencyInjection](#dependencyinjection)'s `AddNotificationLiveChannelClient`, which uses
  `services.Replace(...)` so the adapter overwrites the framework's
  [NullLiveChannelPublisher](#nulllivechannelpublisher) default
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/DependencyInjection.cs:48`). The one caller
  today is the Engagement service's composition root
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:283`).

---

### NullLiveChannelPublisher
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Live` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Live/NullLiveChannelPublisher.cs:11` · Level 1 · class (sealed)

- **What it is**: a no-op implementation of the [ILiveChannelPublisher](#ilivechannelpublisher) port. It
  is the default the container resolves when a host has not wired a real transport, so the live-channel
  path always has *something* to call.
- **Depends on**: [ILiveChannelPublisher](#ilivechannelpublisher) (Level 0). No externals beyond the BCL
  `Task`.
- **Concept introduced, the Null Object pattern for optional infrastructure.** `[Rubric §1, SOLID]`
  assesses the Dependency Inversion Principle: application handlers depend only on the abstraction, and
  the concrete adapter is chosen at the composition root. `[Rubric §29, Resilience & Business
  Continuity]` assesses graceful degradation: rather than leave the port unregistered (which would make
  DI throw when a handler asks for it), the framework registers a member that does nothing, so a host
  that never configures push simply publishes into the void without failing. This is the same idea behind
  [NullNotificationRecipientProvider](#nullnotificationrecipientprovider) and
  [NullNavigationPopulator<TEntity>](group-11-navigation-populators.md#nullnavigationpopulatortentity).
- **Walkthrough**: one method, `PublishAsync(channelKey, eventName, payloadJson, cancellationToken)`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Live/NullLiveChannelPublisher.cs:14`), whose
  whole body is `=> Task.CompletedTask` (`NullLiveChannelPublisher.cs:15`). No exception, no logging, no
  work.
- **Why it's built this way**: the class doc comment (`NullLiveChannelPublisher.cs:5-10`) states the
  contract: downstream apps override this with
  [SignalRLiveChannelPublisher](#signalrlivechannelpublisher) via `AddPushNotifications()`, or with their
  own transport (in ADC, a gRPC adapter that forwards to the host that maps the hub). Because the default
  resolves cleanly, no host is *forced* to configure a real-time transport
  ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html), live channels are
  best-effort by design).
- **Where it's used**: registered as the framework default with
  `services.TryAddTransient<ILiveChannelPublisher, NullLiveChannelPublisher>()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:575`) so the port is always
  resolvable; `AddPushNotifications` adds the SignalR implementation over it
  (`DependencyInjection.cs:646`), and in ADC Engagement's composition root `services.Replace(...)`
  overwrites it with the [LiveChannelPublisherGrpcAdapter](#livechannelpublishergrpcadapter)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/DependencyInjection.cs:48`).

---

### NullPushNotificationSender
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Push` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/NullPushNotificationSender.cs:10` · Level 1 · class (sealed)

- **What it is**: the no-op default for the [IPushNotificationSender](#ipushnotificationsender) port, the
  delivery-side counterpart of [NullLiveChannelPublisher](#nulllivechannelpublisher). It lets a host
  resolve and run the send pipeline even with no real-time transport configured.
- **Depends on**: [IPushNotificationSender](#ipushnotificationsender) (Level 0). Uses the solution-wide
  `UserIdentifierType` alias (see
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Concept**: cross-reference the Null Object pattern taught on
  [NullLiveChannelPublisher](#nulllivechannelpublisher). `[Rubric §29, Resilience]`: because push
  delivery is best-effort (the durable inbox is the source of truth), a missing transport must not break
  sending, it must simply deliver nothing.
- **Walkthrough**: three methods, each `=> Task.CompletedTask`: `SendToUserAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/NullPushNotificationSender.cs:13`),
  `SendToUsersAsync` (`NullPushNotificationSender.cs:17`), and `BroadcastAsync`
  (`NullPushNotificationSender.cs:21`). Together they mirror the full `IPushNotificationSender` surface
  (single user, batch, broadcast) so the interface is satisfied without behavior.
- **Why it's built this way**: the doc comment (`NullPushNotificationSender.cs:5-9`) notes downstream
  apps override this with [SignalRPushNotificationSender](#signalrpushnotificationsender) via
  `AddPushNotifications()`. The send handler always calls the port; whether anything reaches a browser is
  a composition-root decision.
- **Where it's used**: registered as the default `IPushNotificationSender` by `AddInfrastructure`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:574`); superseded by the
  SignalR sender in any host that calls `AddPushNotifications` (`DependencyInjection.cs:645`).

---

### SendPushNotificationCommand
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationCommand.cs:21` · Level 1 · record (sealed)

- **What it is**: the CQRS command that triggers a push-notification broadcast. It wraps a
  [SendPushNotificationRequest](#sendpushnotificationrequest) plus the sender's `UserIdentifierType`,
  carries an optional deduplication key, and marks the whole send as transactional.
- **Depends on**:
  [ICommandWithRequest<out TRequest>](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  (Level 0), [ITransactional](group-05-cqrs-pipeline.md#itransactional) (Level 0),
  [SendPushNotificationRequest](#sendpushnotificationrequest) (Level 0).
- **Concept**: the *command-wraps-request* idiom (see
  [ICommandWithRequest<out TRequest>](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), G05).
  The public HTTP request is the small `Title`/`Body`/`ScopeKey` record; the command additionally carries
  server-derived context (`SentByUserId`, taken from the caller's token, not the body) so the client
  cannot spoof the sender. Exposing `Request` satisfies the
  `ICommandWithRequest<SendPushNotificationRequest>` contract, which lets the generic validating command
  decorator run [SendPushNotificationRequestValidator](#sendpushnotificationrequestvalidator)
  automatically in the pipeline. `[Rubric §6, CQRS & Event-Driven]`, `[Rubric §11, Security]`.
- **Walkthrough**: a two-parameter positional record implementing both
  `ICommandWithRequest<SendPushNotificationRequest>` and `ITransactional`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationCommand.cs:21-23`),
  plus one body member.
  - `Request` (`SendPushNotificationCommand.cs:22`) is the validated DTO; `SentByUserId`
    (`SendPushNotificationCommand.cs:23`) is the audit/authorization context.
  - `DedupKey` (`SendPushNotificationCommand.cs:32`), an `init`-only `string?`, is the optional
    deduplication key, typically the caller's `Idempotency-Key` header. Its doc comment
    (`SendPushNotificationCommand.cs:25-31`) states the contract: when present, a send whose key has
    already been seen returns the existing notification instead of creating a second one and sending
    again; when null (the default every existing caller gets) the send behaves exactly as before.
    `[Rubric §29, Resilience & Business Continuity]` assesses whether a retry is safe: this property is
    what makes a retried broadcast at-most-once at the delivery level (see the matching logic in
    [SendPushNotificationHandler](#sendpushnotificationhandler)). It complements, and is distinct from,
    the HTTP-level [IdempotentAttribute](group-12-api-hosting-mapping.md#idempotentattribute) response
    cache ([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)).
- **Why it's built this way (the `ITransactional` marker)**: the class doc
  (`SendPushNotificationCommand.cs:11-19`) is unusually explicit, and it is the key to reading the
  handler. The handler writes the audit row first and the per-recipient inbox rows second, so **without**
  a transaction a fault between the two would leave a committed notification row carrying `DedupKey` that
  nothing ever delivered, and every later retry with that key would short-circuit on the dedup lookup and
  report success forever. Under `ITransactional` the Transactional decorator in the CQRS pipeline
  ([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)) rolls the failed
  attempt back whole, so the retry genuinely re-runs the send. The doc also names the accepted cost: the
  two sender calls run inside the transaction, bounded by their own timeouts and holding locks only on
  rows this request just inserted. `[Rubric §8, Data Architecture]`, `[Rubric §29, Resilience]`.
- **Where it's used**: dispatched by the push-notification API endpoint (the organizer-only
  [NotificationsController](#notificationscontroller)); handled by
  [SendPushNotificationHandler](#sendpushnotificationhandler).

---

### SmtpEmailSender
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Mail` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpEmailSender.cs:12` · Level 1 · class (sealed)

- **What it is**: the SMTP adapter for the [IEmailSender](#iemailsender) port. It sends mail through a
  `System.Net.Mail.SmtpClient` configured from bound
  [SmtpSettings](group-14-module-system-composition.md#smtpsettings). This is the entire "email channel"
  of the notification subsystem, independent of the push/inbox flow.
- **Depends on**: [IEmailSender](#iemailsender) (Level 0);
  [SmtpSettings](group-14-module-system-composition.md#smtpsettings) (Level 0), taken as
  `IOptions<SmtpSettings>` through the primary constructor and unwrapped once into a readonly field
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpEmailSender.cs:12` and `:15`).
  Externals: `Microsoft.Extensions.Options` (`IOptions<T>`), `System.Net.Mail` (`SmtpClient`,
  `MailMessage`) and `System.Net` (`NetworkCredential`).
- **Concept introduced, the options-bound infrastructure adapter.** `[Rubric §3, Clean Architecture]`
  assesses whether transport detail stays at the edge: the port `IEmailSender` lives in Application, and
  this SMTP concretion lives in Infrastructure, so nothing above it knows what "email" is made of.
  `[Rubric §10, Cross-Cutting Concerns]`: host, port, credentials, and the default from/to addresses come
  from configuration bound at startup by `AddInfrastructure`
  (`services.AddOptions<SmtpSettings>().Bind(configuration.GetSection(SmtpSettings.SectionName))`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:99-100`), never hard-coded,
  so the same code targets a real relay in production and a local SMTP container in development.
- **Walkthrough**: the primary constructor takes `IOptions<SmtpSettings>` and stores `smtpOptions.Value`
  in `_smtpSettings` (`SmtpEmailSender.cs:14`), so the options snapshot is read once at construction.
  - `SendAsync(to, subject, body, isHtml, cancellationToken)` (`SmtpEmailSender.cs:17`): guards the three
    strings with `ArgumentException.ThrowIfNullOrEmpty` (`SmtpEmailSender.cs:19-21`), then constructs a
    fresh `SmtpClient` from `Host`/`Port` with a `NetworkCredential` and the configured `EnableSsl`
    inside a `using` (`SmtpEmailSender.cs:24-28`, wrapped in a justified `#pragma warning disable S5332`
    at `:24` and restored at `:30` because `EnableSsl` is config-driven and local development targets
    MailDev, which does not offer TLS), builds a `MailMessage` from `_smtpSettings.From` (also `using`,
    `SmtpEmailSender.cs:31-34`), and awaits `SendMailAsync(message, cancellationToken)`
    (`SmtpEmailSender.cs:36`). The doc comment (`SmtpEmailSender.cs:8-11`) is explicit that a new client
    is created and disposed **per send**, no pooled long-lived connection.
  - `SendAsync(subject, body, isHtml, cancellationToken)` (`SmtpEmailSender.cs:47-48`): a convenience
    overload that forwards to the five-argument method with the default `_smtpSettings.To` recipient, for
    admin/system mail with no explicit addressee.
- **Why it's built this way**: a per-send client keeps the sender stateless and thread-safe with no
  connection lifecycle to manage, acceptable for the low volume of system/admin mail this channel
  carries. Unlike push, email has **no** null-object default: `SmtpEmailSender` itself is what
  `AddInfrastructure` registers as `IEmailSender`
  (`services.TryAddTransient<IEmailSender, SmtpEmailSender>()`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:573`), so a host that never
  configures SMTP settings still resolves a real sender that will fail at send time rather than silently
  no-op.
- **Where it's used**: injected as `IEmailSender` by callers (the port, not this class). It is not called
  from the push/inbox send flow.
- **Caveats / not-in-source**: `IOptions<T>` (not `IOptionsMonitor<T>`) plus the read-once field means a
  configuration change after startup is not picked up by an already-constructed instance. The registration
  is transient, so a new instance per resolve re-reads `.Value`, but the semantics of a live reload are
  not exercised anywhere in this file.

---

### NotificationHub
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/NotificationHub.cs:17` · Level 2 · class (sealed)

- **What it is**: the SignalR hub that anchors the group's real-time transport. It is deliberately thin:
  it maps authenticated connections and manages channel (SignalR group) membership. It does not itself
  construct or fan out messages, that work lives in
  [SignalRPushNotificationSender](#signalrpushnotificationsender) and
  [SignalRLiveChannelPublisher](#signalrlivechannelpublisher), both of which push through
  `IHubContext<NotificationHub>` (doc comment
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/NotificationHub.cs:10-15`).
- **Depends on**:
  [PushNotificationSettings](group-14-module-system-composition.md#pushnotificationsettings) (read
  through `IOptions<T>` for the channel-key pattern); externals `Microsoft.AspNetCore.SignalR` (the `Hub`
  base class, `Groups`, `Context`, `HubException`, `[HubMethodName]`),
  `Microsoft.AspNetCore.Authorization` (`[Authorize]`), `Microsoft.Extensions.Options` (`IOptions<T>`),
  and the BCL `System.Text.RegularExpressions.Regex` plus
  `System.Collections.Concurrent.ConcurrentDictionary`.
- **Concept introduced, the SignalR hub as a real-time transport endpoint.** A SignalR `Hub` is a
  server-side endpoint over a persistent connection (WebSockets where available). Clients invoke named
  hub methods on it, and the server pushes messages back to individual connections or to named *groups*
  (here called channels). This hub keeps only the membership half of that contract:
  `JoinChannelAsync`/`LeaveChannelAsync` add or remove the calling connection to a SignalR group, and
  delivery is done elsewhere through `IHubContext`. Keeping the hub free of message construction means
  the sender and publisher services can be tested and scaled independently of the connection surface.
  - `[Rubric §11, Security]` assesses whether the boundary authenticates and constrains input. The class
    carries a class-level `[Authorize]` (`NotificationHub.cs:16`), so only authenticated connections can
    open the hub, and every channel key is validated against a configured allow-pattern before a
    connection may join a group, so a client cannot subscribe to an arbitrary group name.
  - `[Rubric §12, Performance & Scalability]` assesses whether hot paths avoid repeated work. The
    compiled `Regex` is cached in a static `ConcurrentDictionary` keyed by the pattern string
    (`NotificationHub.cs:33-34`) so join/leave calls never recompile it, and each match runs under a
    1-second timeout (`NotificationHub.cs:31`) to bound worst-case matching (a defense against
    catastrophic-backtracking, ReDoS-style input).
- **Walkthrough**
  - Primary-constructor DI of `IOptions<PushNotificationSettings>`, over the `Hub` base
    (`NotificationHub.cs:17`).
  - The shared method-name constants: `ReceiveNotificationMethod` = `"ReceiveNotification"`
    (`NotificationHub.cs:20`) and `ReceiveChannelEventMethod` = `"ReceiveChannelEvent"`
    (`NotificationHub.cs:23`) are the client-listen method names the sender and publisher target;
    `JoinChannelMethod` = `"JoinChannel"` (`NotificationHub.cs:26`) and `LeaveChannelMethod` =
    `"LeaveChannel"` (`NotificationHub.cs:29`) are the server methods clients invoke. Exposing them as
    constants keeps both ends of the wire from drifting on a magic string.
  - `ChannelKeyMatchTimeout` (1 second, `NotificationHub.cs:31`) and the `ChannelKeyRegexCache`
    (`NotificationHub.cs:34`, `StringComparer.Ordinal`) back the validation helper.
  - `JoinChannelAsync(string channelKey)` (`NotificationHub.cs:44`): attributed
    `[HubMethodName(JoinChannelMethod)]` (`NotificationHub.cs:43`), it validates the key
    (`NotificationHub.cs:46`) then calls
    `Groups.AddToGroupAsync(Context.ConnectionId, channelKey, Context.ConnectionAborted)`
    (`NotificationHub.cs:51-52`).
  - `LeaveChannelAsync(string channelKey)` (`NotificationHub.cs:60`):
    `[HubMethodName(LeaveChannelMethod)]` (`NotificationHub.cs:59`), validates then
    `Groups.RemoveFromGroupAsync(...)` with the same connection token (`NotificationHub.cs:65-66`).
  - Both methods take **no `CancellationToken` parameter**, and the comment at `NotificationHub.cs:48-50`
    explains why: a hub method signature is the client-visible RPC contract bound by SignalR's dispatcher,
    so the cancellation token comes from the connection (`Context.ConnectionAborted`) instead, and the
    repo's `CancellationTokenConventionTests` carry an explicit exemption for it. `[Rubric §15, Best
    Practices & Code Quality]`: the convention is enforced by a test, and the deviation is documented at
    the deviation site.
  - `EnsureValidChannelKey` (`NotificationHub.cs:69`): `GetOrAdd`s the cached `Regex` for
    `settings.Value.ChannelKeyPattern` (`NotificationHub.cs:71-73`); an empty or non-matching key throws
    `HubException("Invalid channel key.")` (`NotificationHub.cs:75-78`), which SignalR surfaces to the
    caller rather than tearing down the connection.
- **Why it's built this way**: routing delivery through `IHubContext` instead of hub instance methods
  lets the framework construct and send messages from anywhere (background senders, a gRPC ingress)
  without holding a live hub instance, and it is the shape SignalR scale-out (a Redis backplane) expects.
  The thin hub plus a configured channel-key pattern is the framework default; the pattern lives in
  [PushNotificationSettings](group-14-module-system-composition.md#pushnotificationsettings) (it defaults
  to [NotificationScopeKey](#notificationscopekey)`.Pattern`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/PushNotificationSettings.cs:29`) so a host
  tunes which channels exist without touching code.
- **Where it's used**: mapped by a consuming host through the API-layer helper `MapNotificationHub`,
  which reads the path from settings and only maps when push is enabled
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/SignalRExtensions.cs:22-31`); the default
  path is `/hubs/notifications`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/PushNotificationSettings.cs:17`), and in
  ADC the Notification service calls it at
  `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:262`. It is driven by
  [SignalRPushNotificationSender](#signalrpushnotificationsender) (per-user notification delivery) and
  [SignalRLiveChannelPublisher](#signalrlivechannelpublisher) (ephemeral channel events), both via
  `IHubContext<NotificationHub>`. `AddPushNotifications` registers the `IUserIdProvider`
  ([ClaimBasedUserIdProvider](group-08-auth.md#claimbaseduseridprovider)) that maps a connection's claims
  to the user id the sender addresses
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:647`).

---

### PushNotificationCreated
> MMCA.Common.Domain · `MMCA.Common.Domain.Notifications.PushNotifications.DomainEvents` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/DomainEvents/PushNotificationCreated.cs:11` · Level 2 · record (sealed)

- **What it is**: the domain event raised when a [PushNotification](#pushnotification) is created. It
  records the notification's title and recipient count as a published fact.
- **Depends on**: [BaseDomainEvent](group-04-events-outbox.md#basedomainevent) (Level 1, its base
  record). Uses the `PushNotificationIdentifierType` alias.
- **Concept**: cross-reference the domain-event and outbox story in
  [Group 04](group-04-events-outbox.md). `[Rubric §6, CQRS & Event-Driven]` assesses whether state
  changes are announced as events carrying enough context to act on: this event carries `NotificationId`,
  `Title`, and `RecipientCount`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/DomainEvents/PushNotificationCreated.cs:11-14`).
  Note the doc comment on `NotificationId` (`PushNotificationCreated.cs:8`), "default until persisted":
  the aggregate id is database-generated, so at `Create` time it is still `default`; the event captures
  intent, not the assigned key.
- **Walkthrough**: a positional `sealed record class` with three parameters, `NotificationId`, `Title`,
  `RecipientCount` (`PushNotificationCreated.cs:11-14`), deriving from `BaseDomainEvent`
  (`PushNotificationCreated.cs:15`). No body, no logic; the record is a pure payload.
- **Why it's built this way**: raising a domain event inside `PushNotification.Create` (with `default`
  for the not-yet-assigned id,
  `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:131`)
  makes creation an announceable fact that flows through the outbox like any other domain event
  ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)), giving a persistable
  record and a future extension point.
- **Where it's used**: added to the aggregate's event list by `PushNotification.Create`
  (`PushNotification.cs:131`) and captured as an
  [OutboxMessage](group-04-events-outbox.md#outboxmessage) on `SaveChangesAsync`. There is **no**
  `IDomainEventHandler<PushNotificationCreated>` anywhere in Common, ADC, or Store today: delivery
  happens inside [SendPushNotificationHandler](#sendpushnotificationhandler) after the inbox rows are
  written, so this event is currently a published, persistable record with no consumer wired to it.

---

### SignalRLiveChannelPublisher
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Live` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Live/SignalRLiveChannelPublisher.cs:11` · Level 3 · class (sealed)

- **What it is**: the real (non-null) adapter for [ILiveChannelPublisher](#ilivechannelpublisher). It
  fans an ephemeral channel event out to every connection subscribed to a channel by doing a SignalR
  **group send** through [NotificationHub](#notificationhub).
- **Depends on**: [ILiveChannelPublisher](#ilivechannelpublisher) (Level 0);
  [NotificationHub](#notificationhub) (Level 2, referenced for its group send and method-name constant).
  External: `Microsoft.AspNetCore.SignalR` (`IHubContext<THub>`).
- **Concept introduced, out-of-band delivery via `IHubContext<THub>`.** `[Rubric §12, Performance &
  Scalability]` assesses horizontal scale-out: because the publisher addresses the hub through
  `IHubContext<NotificationHub>` (injected,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Live/SignalRLiveChannelPublisher.cs:11`) rather
  than holding a hub connection, it works from any host that maps the hub, and when a Redis backplane is
  configured the group send fans out across replicas (doc comment
  `SignalRLiveChannelPublisher.cs:6-10`). `[Rubric §1, SOLID]`: the same `ILiveChannelPublisher`
  abstraction is implemented by the null default, this SignalR adapter, and (in ADC) a gRPC adapter, port
  and adapter taken to its conclusion.
- **Walkthrough**: one method, `PublishAsync(channelKey, eventName, payloadJson, cancellationToken)`
  (`SignalRLiveChannelPublisher.cs:14`):
  `hubContext.Clients.Group(channelKey).SendAsync(NotificationHub.ReceiveChannelEventMethod, channelKey,
  eventName, payloadJson, cancellationToken)` (`SignalRLiveChannelPublisher.cs:15-18`). It invokes the
  hub's `ReceiveChannelEventMethod` constant so the client and server agree on the method name, and
  passes the channel key, event name, and opaque JSON payload straight through.
- **Why it's built this way**: live channels are transient by contract
  ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)), so this adapter just
  addresses the group and sends, with no persistence and no per-recipient bookkeeping. A connection that
  is not subscribed at publish time simply never receives the event.
- **Where it's used**: registered over [NullLiveChannelPublisher](#nulllivechannelpublisher) by
  `AddPushNotifications` in any host that maps the hub
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:646`); in ADC it is the
  *local* implementation the Notification service's gRPC ingress
  ([LiveChannelGrpcService](#livechannelgrpcservice)) delegates to. The browser side lives in
  [group 15](group-15-common-ui-framework.md).

---

### SignalRPushNotificationSender
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Notifications.Push` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/SignalRPushNotificationSender.cs:12` · Level 3 · class (sealed)

- **What it is**: the real adapter for [IPushNotificationSender](#ipushnotificationsender). It delivers a
  notification to specific users, a batch of users, or everyone, through
  [NotificationHub](#notificationhub), and chunks large audiences so one send does not overwhelm the
  SignalR connection manager.
- **Depends on**: [IPushNotificationSender](#ipushnotificationsender) (Level 0);
  [NotificationHub](#notificationhub) (Level 2). Externals: `Microsoft.AspNetCore.SignalR`
  (`IHubContext<THub>`), `System.Globalization` (invariant `ToString`).
- **Concept**: cross-reference out-of-band delivery via `IHubContext` taught on
  [SignalRLiveChannelPublisher](#signalrlivechannelpublisher). `[Rubric §12, Performance &
  Scalability]` here is about **batching**: a private `const int BatchSize = 100`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/SignalRPushNotificationSender.cs:14`)
  caps how many user ids ride a single `Clients.Users(batch)` call, so broadcasting to a large attendee
  list is split into bounded sends rather than one giant fan-out. `[Rubric §27, i18n]` in miniature: user
  ids are stringified with `CultureInfo.InvariantCulture` (`SignalRPushNotificationSender.cs:19` and
  `:47`) so the SignalR user-id keys are locale-stable.
- **Walkthrough**
  - `SendToUserAsync(userId, title, body, metadata, cancellationToken)`
    (`SignalRPushNotificationSender.cs:17`): addresses
    `Clients.User(userId.ToString(CultureInfo.InvariantCulture))` and invokes
    `NotificationHub.ReceiveNotificationMethod` (`SignalRPushNotificationSender.cs:18-21`).
  - `SendToUsersAsync(userIds, ...)` (`SignalRPushNotificationSender.cs:24`): iterates
    `BatchUserIds(userIds)` and sends each batch to `Clients.Users(batch)`
    (`SignalRPushNotificationSender.cs:26-32`).
  - `BroadcastAsync(...)` (`SignalRPushNotificationSender.cs:36`): addresses `Clients.All`
    (`SignalRPushNotificationSender.cs:37-39`).
  - `BatchUserIds(userIds)` (`SignalRPushNotificationSender.cs:41`): a private static iterator that
    accumulates invariant-culture id strings into a `List` and `yield return`s each time it reaches
    `BatchSize`, flushing the remainder at the end (`SignalRPushNotificationSender.cs:43-57`).
- **Why it's built this way**: all three delivery shapes route through the one hub context and the one
  shared method-name constant, so the client listens on a single event regardless of how it was targeted.
  Batching keeps a broadcast to thousands of recipients from constructing one oversized argument list for
  the connection manager.
- **Where it's used**: registered over [NullPushNotificationSender](#nullpushnotificationsender) by
  `AddPushNotifications`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:645`); called by
  [SendPushNotificationHandler](#sendpushnotificationhandler) after the inbox rows are persisted, inside
  a swallow-everything `try/catch` so a transport hiccup is recorded as a status rather than thrown.

---

### UserNotification
> MMCA.Common.Domain · `MMCA.Common.Domain.Notifications.UserNotifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/UserNotifications/UserNotification.cs:12` · Level 5 · class (sealed)

- **What it is**: the framework-level aggregate root that tracks delivery of a single
  [PushNotification](#pushnotification) to one user, giving each recipient a per-user inbox row with
  `IsRead`/`ReadOn` state.
- **Depends on**:
  [AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (its base, closed over `UserNotificationIdentifierType`,
  `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/UserNotifications/UserNotification.cs:12`);
  [IdValueGeneratedAttribute](group-02-domain-building-blocks.md#idvaluegeneratedattribute) (the
  `[IdValueGenerated]` marker, `UserNotification.cs:11`);
  [Result](group-01-result-error-handling.md#result); the identifier aliases
  `UserNotificationIdentifierType`, `UserIdentifierType`, and `PushNotificationIdentifierType`; and
  `TimeProvider` (BCL, the injectable clock the caller reads from).
- **Concept**: the fan-out-on-send inbox row. One [PushNotification](#pushnotification) produces N
  `UserNotification` rows, one per recipient, so read state is tracked per user. `[Rubric §4,
  Domain-Driven Design]` assesses whether behavior and invariants live inside the aggregate: state
  changes flow only through the factory and `MarkAsRead`, never through public setters (every property
  has a `private set`, `UserNotification.cs:15-24`). `[Rubric §14, Testability]` assesses whether time is
  injectable: `MarkAsRead` takes the read instant as a parameter rather than reading an ambient clock, so
  behavior is deterministic under test.
- **Walkthrough**
  - State: `UserId` (`UserNotification.cs:15`), `PushNotificationId` (`UserNotification.cs:18`), `IsRead`
    (`UserNotification.cs:21`), and the nullable `ReadOn` timestamp (`UserNotification.cs:24`), all
    `private set`. Two private constructors: the parameterless one EF Core needs
    (`UserNotification.cs:27`) and the state-setting one the factory calls
    (`UserNotification.cs:31-36`), which seeds `IsRead = false`.
  - `Create(userId, pushNotificationId)` (`UserNotification.cs:44-47`): a direct
    `Result.Success(new UserNotification(...) { Id = default })`. There is no validation, the only inputs
    are two foreign keys, and `Id = default` because `[IdValueGenerated]` (`UserNotification.cs:11`)
    hands id generation to the database.
  - `MarkAsRead(DateTime readOnUtc)` (`UserNotification.cs:58`): **idempotent**, an early
    `if (IsRead) return` (`UserNotification.cs:60-63`) preserves the original read time on repeat calls;
    otherwise it sets `IsRead = true` and `ReadOn = readOnUtc` (`UserNotification.cs:65-66`). The instant
    is supplied by the caller (from an injected `TimeProvider`, per the method's own doc at
    `UserNotification.cs:49-57`), so the domain stays free of ambient clock access. No domain event is
    raised on read.
- **Why it's built this way**: idempotent `MarkAsRead` shrugs off duplicate UI calls without corrupting
  the first read time, and passing the clock in keeps the entity pure. Database-generated ids
  (`[IdValueGenerated]`) suit a high-volume fan-out table where a factory-assigned sequence would be
  extra coordination.
- **Where it's used**: created by [SendPushNotificationHandler](#sendpushnotificationhandler) for each
  recipient; read by [GetMyNotificationsQuery](#getmynotificationsquery)'s handler for the inbox; flipped
  by [MarkNotificationReadHandler](#marknotificationreadhandler) and its mark-all sibling behind
  [InboxController](#inboxcontroller). Its rows are also the data
  [UserNotificationExportService](#usernotificationexportservice) projects into the data-subject export.

---

### SendPushNotificationRequestValidator
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationRequestValidator.cs:12` · Level 8 · class (sealed)

- **What it is**: the FluentValidation validator for
  [SendPushNotificationRequest](#sendpushnotificationrequest): it enforces that title and body are
  present and within the length limits declared by
  [PushNotificationInvariants](#pushnotificationinvariants), and that an optional scope key stays within
  the aggregate's limit.
- **Depends on**: [SendPushNotificationRequest](#sendpushnotificationrequest) (Level 0, the validated
  type), [PushNotificationInvariants](#pushnotificationinvariants) (the domain limits),
  [PushNotification](#pushnotification) (for `ScopeKeyMaxLength`), and
  `FluentValidation.AbstractValidator<T>` (NuGet base class).
- **Concept**: request validation as a pipeline concern, not handler code. `[Rubric §24, Forms,
  Validation & UX Safety]` (server-side validation with actionable messages) and `[Rubric §16,
  Maintainability]`. Reusing the *same* constants here and in the
  [PushNotification](#pushnotification) domain factory keeps the API limit and the entity limit from
  drifting apart.
- **Walkthrough**: the constructor
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationRequestValidator.cs:14`)
  defines three rules.
  - `Title` (`SendPushNotificationRequestValidator.cs:16-19`) gets `NotEmpty()` plus
    `MaximumLength(PushNotificationInvariants.TitleMaxLength)` (200,
    `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/Invariants/PushNotificationInvariants.cs:13`).
  - `Body` (`SendPushNotificationRequestValidator.cs:21-24`) gets `NotEmpty()` plus
    `MaximumLength(PushNotificationInvariants.BodyMaxLength)` (2000,
    `PushNotificationInvariants.cs:16`).
  - `ScopeKey` (`SendPushNotificationRequestValidator.cs:27-29`) gets **only**
    `MaximumLength(PushNotification.ScopeKeyMaxLength)` (128,
    `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:22`),
    no `NotEmpty`: the inline comment (`SendPushNotificationRequestValidator.cs:26`) records that a null
    scope key is the unscoped send every existing caller makes.

  Each rule supplies a human-readable `WithMessage`, with the limit interpolated under
  `CultureInfo.InvariantCulture`.
- **Where it's used**: registered by
  `AddValidatorsFromAssemblyContaining<SendPushNotificationRequestValidator>(includeInternalTypes: true)`
  in the notification Application DI
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:72`), which also
  makes this class the assembly anchor for every notification validator; invoked by the Validating
  command decorator in the CQRS pipeline (against the embedded `Request`, via
  [ICommandWithRequest<out TRequest>](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)) before
  [SendPushNotificationHandler](#sendpushnotificationhandler) runs
  ([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)).

---

### SendPushNotificationHandler
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:27` · Level 9 · class (sealed partial)

- **What it is**: the command handler for the push-notification broadcast. It short-circuits duplicate
  sends by deduplication key, resolves recipients, persists a sender-side audit aggregate plus one inbox
  row per recipient, attempts real-time delivery over SignalR **and** OS-level native push, records the
  resulting status, and returns a [PushNotificationDTO](#pushnotificationdto).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (repositories plus save),
  [INotificationRecipientProvider](#inotificationrecipientprovider) (the audience),
  [IPushNotificationSender](#ipushnotificationsender) (the SignalR transport),
  [INativePushSender](group-07-persistence-ef-core.md#inativepushsender) (the OS-level transport, added
  by [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)),
  [PushNotificationDTOMapper](#pushnotificationdtomapper) (the success-payload mapper), and `ILogger<>`
  (all injected via the primary constructor,
  `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:27-33`);
  the persisted aggregates are [PushNotification](#pushnotification) and
  [UserNotification](#usernotification). Implements
  [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  and returns `Result<PushNotificationDTO>` ([Result](group-01-result-error-handling.md#result)).
- **Concept introduced, one durable path plus two ephemeral push channels, guarded by a dedup key.**
  `[Rubric §6, CQRS & Event-Driven]`, `[Rubric §8, Data Architecture]`, `[Rubric §29, Resilience &
  Business Continuity]`. The handler writes to storage (the audit aggregate, then N inbox rows) and
  separately performs two best-effort real-time pushes (SignalR, then native OS push). These are
  different reliability tiers on purpose: the aggregate and inbox rows are the **durable** record a
  recipient can retrieve later, while the SignalR and native pushes are the **immediate** deliveries that
  an offline user may miss. The class doc (`SendPushNotificationHandler.cs:17-25`) states the atomicity
  contract that ties the durable half together: all three saves are one unit because
  [SendPushNotificationCommand](#sendpushnotificationcommand) is `ITransactional`.
- **Walkthrough** (teaching order)
  1. **deduplication gate** (`SendPushNotificationHandler.cs:40-51`): the command's
     [DedupKey](#sendpushnotificationcommand) is normalized so whitespace counts as absent
     (`SendPushNotificationHandler.cs:42`, "a blank header cannot claim the single empty key"); when a
     key is present, `FindByDedupKeyAsync` looks for an already-persisted notification and, on a hit,
     logs and returns the existing one mapped to a DTO **without sending again**
     (`SendPushNotificationHandler.cs:45-50`).
  2. **resolve recipients** (`SendPushNotificationHandler.cs:54-55`) via the app-specific
     [INotificationRecipientProvider](#inotificationrecipientprovider) (in ADC,
     [AttendeeNotificationRecipientProvider](#attendeenotificationrecipientprovider)). An empty set
     short-circuits to a `Result.Failure` with an [Error](group-01-result-error-handling.md#error)
     `Validation` code `PushNotification.NoRecipients` (`SendPushNotificationHandler.cs:57-63`), before
     any rows are written.
  3. **create the audit aggregate** (`SendPushNotificationHandler.cs:66-72`) via
     `PushNotification.Create(title, body, sentByUserId, recipientIds.Count, dedupKey, scopeKey)`;
     propagate errors on failure (`SendPushNotificationHandler.cs:73-76`), then add to the repository
     (`SendPushNotificationHandler.cs:79-80`). This is where the aggregate's
     [PushNotificationCreated](#pushnotificationcreated) domain event is captured to the outbox
     ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).
  4. **first save, with a race requery** (`SendPushNotificationHandler.cs:82-113`): the save is wrapped
     in a `try/catch (Exception)` under a justified `#pragma warning disable CA1031`
     (`SendPushNotificationHandler.cs:86-88`). The long comment
     (`SendPushNotificationHandler.cs:90-101`) is the teaching point: the dedup lookup in step 1 is a
     check-then-act, so two concurrent retries of the same send both pass it and the loser only fails
     here, on the insert, against the filtered unique index on `DedupKey`. The catch requeries by key
     with `CancellationToken.None` (`SendPushNotificationHandler.cs:104`, so a cancelled save can still
     be classified) and, if a winner now exists, returns it
     (`SendPushNotificationHandler.cs:105-109`); anything else rethrows untouched
     (`SendPushNotificationHandler.cs:112`) so a genuine persistence fault still reaches the exception
     middleware. The broad catch is deliberate: Application has no EF Core dependency under the layer
     rule, so `DbUpdateException` is not a type this file can name, and the requery is what narrows it.
     Same shape as [EfInboxStore](group-04-events-outbox.md#efinboxstore)'s `MessageId` unique-index
     handling.
  5. **durable inbox** (`SendPushNotificationHandler.cs:115-123`): one
     `UserNotification.Create(recipientId, notification.Id)` row per recipient, added and saved. This is
     what lets a user retrieve a notification they missed while offline.
  6. **best-effort SignalR delivery** (`SendPushNotificationHandler.cs:125-143`):
     `pushNotificationSender.SendToUsersAsync(...)` inside a `try/catch` with its own justified `CA1031`
     suppression (`SendPushNotificationHandler.cs:137-139`). A delivery failure is **non-fatal**: success
     calls `notification.MarkAsSent()` plus an info log (`SendPushNotificationHandler.cs:134-135`),
     failure calls `notification.MarkAsFailed()` plus an error log
     (`SendPushNotificationHandler.cs:141-142`); the failure becomes recorded *status*, not a thrown
     exception.
  7. **best-effort native push** (`SendPushNotificationHandler.cs:145-162`,
     [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)):
     `nativePushSender.SendToUsersAsync(...)` in a third `try/catch` with its own suppression
     (`SendPushNotificationHandler.cs:157-159`). This is the OS-level channel that can reach devices
     whose app is backgrounded or killed (comment `SendPushNotificationHandler.cs:145-148`). It is
     **purely additive**: the SignalR leg above already decided the audit status, so a native-push
     failure only logs a warning (`LogNativePushFailed`, `SendPushNotificationHandler.cs:161`) and never
     touches `Status`. The default
     [NullNativePushSender](group-14-module-system-composition.md#nullnativepushsender) keeps this a no-op
     until a notification hub is configured.
  8. **persist final status** (`SendPushNotificationHandler.cs:164`) and **return** the mapped DTO
     (`SendPushNotificationHandler.cs:166`).
  - `FindByDedupKeyAsync` (`SendPushNotificationHandler.cs:174-183`) resolves the read repository from
    the unit of work (`unitOfWork.GetReadRepository<...>()`, `SendPushNotificationHandler.cs:176`), never
    an injected
    [IRepository<TEntity, TIdentifierType>](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype),
    so the lookup runs against the same data source as the write (its doc comment says exactly that,
    `SendPushNotificationHandler.cs:169-173`).
  - Five source-generated `[LoggerMessage]` methods close the file
    (`SendPushNotificationHandler.cs:185-198`): sent (Information), delivery-failed (Error),
    native-failed (Warning), dedup hit (Information), and dedup race requery (Information).
    `[Rubric §13, Observability]`.
- **Why it's built this way**: shipping the whole feature in the *framework* means both ADC and Store get
  push for free, with the audience and both transports as injected abstractions (`[Rubric §10,
  Cross-Cutting Concerns]`). Treating each delivery failure as a recorded status or a logged warning
  rather than an exception keeps the audit trail honest while the audit and inbox writes stay durable
  even when a live push does not land. The dedup key plus the filtered unique index gives the retry
  safety a broadcast needs: the index is declared with `IsUnique()` and a soft-delete-aware
  `[DedupKey] IS NOT NULL` filter in the EF configuration
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:68-70`),
  so the database, not the application, is the arbiter of "already sent". Note the real-time sends are
  **not** the outbox: they are synchronous best-effort calls inside the handler; only the
  `PushNotificationCreated` domain event flows through the outbox.
- **Where it's used**: dispatched from [NotificationsController](#notificationscontroller) (mounted into
  ADC by the Notification DI facade); the real-time legs land on connected clients through
  [NotificationHub](#notificationhub) and, for native push, through the configured OS notification hub.
- **Caveats / not-in-source**: the three `SaveChangesAsync` calls
  (`SendPushNotificationHandler.cs:84`, `:122`, `:163`) are separate saves, not separate transactions:
  atomicity comes from the ambient transaction the Transactional decorator opens because the command
  implements `ITransactional`, so the decorator, not this file, is where the commit happens. A
  consequence the class doc accepts explicitly (`SendPushNotificationHandler.cs:17-25`) is that both
  sender calls run inside that transaction. There is still no automatic redelivery of a failed push: the
  outcome is recorded, not re-attempted.

---

### UserNotificationExportGrpcService
> MMCA.ADC.Notification.Service · `MMCA.ADC.Notification.Service.Grpc` · `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/UserNotificationExportGrpcService.cs:27` · Level 9 · class (sealed)

- **What it is**: the gRPC **server** endpoint that exposes the in-process
  [IUserNotificationExportService](#iusernotificationexportservice) over the wire. The Identity service
  calls it to pull a user's notification inbox rows (ids, titles, sent/read dates, scope key) so it can
  assemble the data-subject export document (PRIVACY.md §7, the GDPR right of access).
- **Depends on**: [IUserNotificationExportService](#iusernotificationexportservice) (injected via the
  primary constructor,
  `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/UserNotificationExportGrpcService.cs:27`),
  the generated `UserNotificationExportService.UserNotificationExportServiceBase` (compiled from the
  `.Contracts` `.proto`, `UserNotificationExportGrpcService.cs:28`), and `Grpc.Core.ServerCallContext`.
  Uses `System.Globalization.CultureInfo` for invariant-culture date formatting, and projects into
  [UserNotificationExportItemDTO](#usernotificationexportitemdto) shapes on the far side.
- **Concept introduced, cross-service data-subject export over internal gRPC.** `[Rubric §30,
  Compliance, Privacy & Data Governance]` assesses whether the system can satisfy a subject-access
  request across service boundaries: each service owns its own database
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), so the user's inbox
  rows live in `ADC_Notification`, not in Identity; this RPC lets the Identity export aggregator gather
  that slice without a cross-database query. `[Rubric §7, Microservices Readiness]` and `[Rubric §9, API
  & Contract Design]`: the export contract is a versioned `.proto` shared through the `.Contracts`
  package, the same extraction pattern as the live-channel ingress. `[Rubric §27, i18n]`: timestamps are
  serialized with the round-trip `"O"` format under `CultureInfo.InvariantCulture`
  (`UserNotificationExportGrpcService.cs:47` and `:51`) so the export is locale-stable.
- **Walkthrough**: the single `GetUserNotificationExport` override
  (`UserNotificationExportGrpcService.cs:31`) null-guards `request` and `context`
  (`UserNotificationExportGrpcService.cs:35-36`), then awaits
  `inner.GetUserNotificationExportAsync(request.UserId, context.CancellationToken)`
  (`UserNotificationExportGrpcService.cs:38-40`) to get the in-process items. It builds a
  `GetUserNotificationExportResponse` (`UserNotificationExportGrpcService.cs:42`) and `AddRange`s a
  projection of each item into a `UserNotificationExportItem`
  (`UserNotificationExportGrpcService.cs:43-56`): `NotificationId`, `Title`, `SentOn`, `IsRead`, `ReadOn`
  (`string.Empty` when the notification is unread, `UserNotificationExportGrpcService.cs:49-51`), and
  `ScopeKey` (also `string.Empty` when null, `UserNotificationExportGrpcService.cs:55`, because proto3
  has no null string, per the comment at `:53-54`). Both timestamps pass through
  `DateTime.SpecifyKind(..., DateTimeKind.Utc)` before `ToString("O", ...)`: the doc comment
  (`UserNotificationExportGrpcService.cs:20-25`) explains why, SQL Server hands back
  `DateTimeKind.Unspecified` values and the `"O"` format omits the `Z` marker for that kind, so the
  stamp only restores the marker the wire contract promises (the stored values are already UTC).
- **Why it's built this way (security posture)**: unlike
  [LiveChannelGrpcService](#livechannelgrpcservice), this endpoint **requires authorization**: it is
  mapped with `.RequireAuthorization()`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:275`) and the class doc says why
  (`UserNotificationExportGrpcService.cs:14-19`). `[Rubric §11, Security]`, `[Rubric §30, Compliance,
  Privacy & Data Governance]`: internal-only ingress is **not sufficient** here because the response
  carries personal data keyed by a raw `UserId`, so the calling service forwards the end user's JWT via
  [JwtForwardingClientInterceptor](group-13-grpc-contracts.md#jwtforwardingclientinterceptor) and
  ownership is enforced at the REST edge. It is served on the same dedicated `Http2`-only "grpc" Kestrel
  endpoint as the live-channel ingress
  ([ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html) mixed-endpoint profile,
  `UserNotificationExportGrpcService.cs:11-13`).
- **Where it's used**: mapped by the Notification service's `Program.cs` (`Program.cs:275`); the wire is
  dialed by its client half
  [UserNotificationExportServiceGrpcAdapter](#usernotificationexportservicegrpcadapter), which runs
  inside the Identity service's export aggregator and stitches this Notification slice into the full
  data-subject export. The in-process implementation it wraps is
  [UserNotificationExportService](#usernotificationexportservice); when the Notification module is
  disabled, [DisabledUserNotificationExportService](#disabledusernotificationexportservice) (registered
  by [NotificationModule](#notificationmodule)'s `RegisterDisabledStubs`) stands in for it.

---

### UserNotificationExportServiceGrpcAdapter
> MMCA.ADC.Notification.Contracts · `MMCA.ADC.Notification.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/UserNotificationExportServiceGrpcAdapter.cs:17` · Level 9 · class (internal sealed)

- **What it is**: the **client** half of the data-subject export RPC. It implements
  [IUserNotificationExportService](#iusernotificationexportservice) on top of the generated gRPC client,
  so Identity's export aggregator keeps depending on the plain C# interface from
  `MMCA.ADC.Notification.Shared` while the inbox rows are actually fetched from the Notification
  service's database over the wire.
- **Depends on**: [IUserNotificationExportService](#iusernotificationexportservice) (Level 1, the
  implemented port); the generated
  `UserNotificationExportService.UserNotificationExportServiceClient` (injected via the primary
  constructor,
  `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/UserNotificationExportServiceGrpcAdapter.cs:17-18`);
  [UserNotificationExportItemDTO](#usernotificationexportitemdto) (the returned shape); the
  `UserIdentifierType` alias; `System.Globalization` for invariant parsing. Its server counterpart is
  [UserNotificationExportGrpcService](#usernotificationexportgrpcservice).
- **Concept**: the mirror image of
  [LiveChannelPublisherGrpcAdapter](#livechannelpublishergrpcadapter)'s error policy, and the contrast is
  the lesson. `[Rubric §29, Resilience & Business Continuity]` assesses degradation strategy per call
  site: the live-channel adapter swallows everything because a dropped ephemeral event is harmless, while
  **this** adapter deliberately lets transport failures propagate to the caller, because the caller needs
  to mark the Notifications section of the export `Available = false` rather than silently emit an empty
  one (class doc, `UserNotificationExportServiceGrpcAdapter.cs:7-16`). Same transport, opposite contract.
  `[Rubric §9, API & Contract Design]` on version tolerance: the projection treats an empty proto3 string
  as "absent" in two places, so a peer replica that predates a field still deserializes.
- **Walkthrough**
  - `CallDeadline` (`UserNotificationExportServiceGrpcAdapter.cs:23`), a private `static readonly
    TimeSpan` of **5 seconds**. The comment (`:20-22`) explains the sizing: far tighter than the shared
    resilience pipeline's 30-second attempt and 90-second total budget, because export aggregation is
    best-effort per section, so a **hung** (as opposed to refused) Notification peer should degrade its
    section quickly instead of stalling the whole export request. `[Rubric §12, Performance &
    Scalability]`.
  - `GetUserNotificationExportAsync(userId, cancellationToken)`
    (`UserNotificationExportServiceGrpcAdapter.cs:26-28`) issues `client.GetUserNotificationExportAsync`
    with a `GetUserNotificationExportRequest { UserId = userId }`, the deadline, and the caller's token
    (`:30-36`). No `try/catch`: failures surface.
  - The projection (`:38-49`) maps each wire item back into a
    [UserNotificationExportItemDTO](#usernotificationexportitemdto) with a collection expression. Two
    fields undo the proto3 encoding: `ReadOn` becomes `null` when the string is empty (`:44`), and
    `ScopeKey` likewise (`:48`), with the comment at `:46-47` recording that a peer replica predating the
    field and a genuinely unscoped notification both arrive as the empty string and mean the same thing.
  - `ParseRoundtripUtc(value)` (`:59-63`) is the counterpart of the server's `"O"` formatting:
    `DateTime.Parse` under `CultureInfo.InvariantCulture` with
    `DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal`. The comment block (`:52-58`) is
    worth reading in full: those two flags defend against a peer replica that still emits the
    marker-less form during a rolling deploy (without them a suffix-less value parses as
    `Kind=Unspecified`, and `AssumeUniversal` alone yields `Kind=Local`), while a `Z`-suffixed value
    takes the same path and keeps its instant. `DateTimeStyles.RoundtripKind` is deliberately absent
    because `DateTime.Parse` rejects it alongside either flag with an `ArgumentException`, and its job
    (preserving a non-UTC kind) is the opposite of what this contract wants. `[Rubric §15, Best Practices
    & Code Quality]`: a subtle BCL interaction is documented at the point of use.
- **Why it's built this way**: keeping the class `internal` (`:17`) means nothing outside the `.Contracts`
  package can bind to the concretion; consumers get it only through the DI helper below, always behind
  the interface. The rolling-deploy tolerance in the parser and the two empty-string mappings are what
  let Identity and Notification deploy independently, which is the point of
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)'s topology.
- **Where it's used**: registered by the Notification.Contracts
  [DependencyInjection](#dependencyinjection)'s `AddNotificationUserExportClient` via
  `services.Replace(...)`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/DependencyInjection.cs:84`); the one caller
  today is the Identity service's composition root
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:291`), whose
  [ExportUserDataHandler](group-24-identity-module.md#exportuserdatahandler) consumes the interface.

---

### DependencyInjection
> MMCA.ADC.Notification.Contracts · `MMCA.ADC.Notification.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/DependencyInjection.cs:16` · Level 10 · class (static, `extension(IServiceCollection)`)

*(The consumer-side gRPC client DI for the Notification service. Several other classes in this chapter
are also named `DependencyInjection`, one per layer; all of them keep the raw type name as their
heading.)*

- **What it is**: the composition helper that a **consuming** service calls to point its notification
  ports at the extracted Notification service. Its two methods register a typed gRPC client and swap the
  local implementation for the matching adapter.
- **Depends on**: [LiveChannelPublisherGrpcAdapter](#livechannelpublishergrpcadapter) and
  [UserNotificationExportServiceGrpcAdapter](#usernotificationexportservicegrpcadapter) (the registered
  concretions); the ports [ILiveChannelPublisher](#ilivechannelpublisher) and
  [IUserNotificationExportService](#iusernotificationexportservice); the generated clients from the
  `.Contracts` `.proto`; and `AddTypedGrpcClient<TClient>` from `MMCA.Common.Grpc` (see the gRPC helper
  [DependencyInjection](group-13-grpc-contracts.md#dependencyinjection)), which brings the Aspire service
  discovery address, the [JwtForwardingClientInterceptor](group-13-grpc-contracts.md#jwtforwardingclientinterceptor),
  and the standard Polly resilience handler. Externals:
  `Microsoft.Extensions.DependencyInjection.Extensions` (`ServiceCollectionDescriptorExtensions.Replace`).
- **Concept introduced, `Replace` rather than `TryAdd` at a consumer composition root.** The framework
  registers defaults with `TryAdd*`, which is a no-op when something is already registered. A consumer
  that wants the remote adapter to win therefore cannot use `TryAdd`: it must overwrite. Both methods use
  `services.Replace(ServiceDescriptor.Scoped<TPort, TAdapter>())`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/DependencyInjection.cs:48` and `:84`), and
  each carries an inline comment saying exactly what it is overwriting: the framework's
  [NullLiveChannelPublisher](#nulllivechannelpublisher) in the first case (`:46-47`), a possible
  [DisabledUserNotificationExportService](#disabledusernotificationexportservice) stub in the second
  (`:82-83`). That in turn makes **call order load-bearing**, and the doc comments say so:
  `AddNotificationLiveChannelClient` must run after `AddInfrastructure(...)` (`:36-37`) and
  `AddNotificationUserExportClient` after `ModuleLoader.DiscoverAndRegister(...)` (`:72-73`).
  `[Rubric §7, Microservices Readiness]` and `[Rubric §3, Clean Architecture]`: the only thing that
  changes between the co-hosted monolith and the extracted topology is which descriptor sits in the
  container.
- **Walkthrough**: one `extension(IServiceCollection services)` block (`DependencyInjection.cs:18`) with
  two methods, each defaulting `serviceName` to `"_grpc.notification"` and returning the collection for
  chaining.
  - `AddNotificationLiveChannelClient(string serviceName = "_grpc.notification")`
    (`DependencyInjection.cs:42`) registers
    `AddTypedGrpcClient<LiveChannelPushService.LiveChannelPushServiceClient>(serviceName)` (`:44`) then
    `Replace`s `ILiveChannelPublisher` with
    [LiveChannelPublisherGrpcAdapter](#livechannelpublishergrpcadapter) as **scoped** (`:48`).
  - `AddNotificationUserExportClient(string serviceName = "_grpc.notification")`
    (`DependencyInjection.cs:78`) registers
    `AddTypedGrpcClient<UserNotificationExportService.UserNotificationExportServiceClient>(serviceName)`
    (`:80`) then `Replace`s `IUserNotificationExportService` with
    [UserNotificationExportServiceGrpcAdapter](#usernotificationexportservicegrpcadapter), also scoped
    (`:84`).
  - The **named-endpoint** default is the subtle part (`:26-33`). `"_grpc.notification"` is Aspire
    service-discovery syntax for a *named* endpoint, not the service's default one. Notification's
    default endpoint has to stay `Http1AndHttp2` for SignalR WebSockets, so its cleartext gRPC (h2c)
    lives on a separate `Http2`-only Kestrel endpoint named `grpc`
    ([ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html)). Discovery resolves
    `http://_grpc.notification` from the `services__notification__grpc__0` configuration entry, injected
    by the AppHost's `WithReference` locally and by `infra/main.bicep` in production.
- **Why it's built this way**: putting both registrations in the `.Contracts` package (next to the
  `.proto` and the adapters) means a consuming service adds one line and inherits the correct endpoint,
  interceptor, resilience policy, and lifetime, with no knowledge of Notification's Kestrel layout. The
  second method's doc (`:61-67`) also records the consumer-side contract: the export aggregation is
  best-effort per section, so if this peer stays unreachable after the resilience pipeline the Identity
  handler marks the Notifications section unavailable instead of failing the whole export.
- **Where it's used**: `AddNotificationLiveChannelClient` is called by the Engagement service's
  application pipeline (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:283`);
  `AddNotificationUserExportClient` by the Identity service's
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:291`). The matching AppHost references
  that inject the `services__notification__grpc__0` entry are
  `engagementService.WithReference(notificationService)`
  (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:281`) and
  `identityService.WithReference(notificationService)` (`Program.cs:292`), both deliberately without a
  `WaitFor` so neither consumer blocks on Notification at startup (comments at `Program.cs:274-280` and
  `:282-290`).

### PushNotificationInvariants
> MMCA.Common.Domain · `MMCA.Common.Domain.Notifications.PushNotifications.Invariants` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/Invariants/PushNotificationInvariants.cs:10` · Level 6 · class (static)

- **What it is**: the domain rule set for a push notification's text. It owns the two length limits
  (title 200, body 2000) and the two checks that enforce them, so nothing else has to restate what a
  valid notification title or body looks like.
- **Depends on**: [CommonInvariants](group-02-domain-building-blocks.md#commoninvariants) (every check
  delegates to it) and [Result](group-01-result-error-handling.md#result) (`Result.Combine`). Externals:
  `System.Globalization` (`CultureInfo.InvariantCulture` for the message text). It depends on no entity,
  not even [PushNotification](#pushnotification), which is what lets three different layers reference it
  without creating a cycle.
- **Concept**: the static invariant class is taught at
  [CommonInvariants](group-02-domain-building-blocks.md#commoninvariants); this is that pattern applied
  to one aggregate. What is worth studying here is the **single source of truth for a length limit**.
  `TitleMaxLength` and `BodyMaxLength` are read in three places that would otherwise drift apart: the
  domain factory
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:105-106`),
  the request validator that rejects bad input before a command ever reaches a handler
  ([SendPushNotificationRequestValidator](#sendpushnotificationrequestvalidator),
  `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationRequestValidator.cs:18-19,23-24`),
  and the EF column definition
  ([PushNotificationConfiguration](group-07-persistence-ef-core.md#pushnotificationconfiguration),
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:29,33`).
  Raising a limit is therefore one edit plus a migration, not four edits and a production truncation.
  `[Rubric §4, DDD]` assesses whether business rules live in the domain rather than in the layers that
  happen to call it: the rule is stated once, in the Domain assembly, and the Application and
  Infrastructure layers consume it rather than duplicate it.
  `[Rubric §8, Data Architecture]` assesses whether domain constraints and the physical schema agree:
  the `HasMaxLength` call literally reads the domain value, so the column can never be narrower or wider
  than the rule that guards it.
- **Walkthrough**
  - `TitleMaxLength = 200` (line 13) and `BodyMaxLength = 2000` (line 16) are `public static readonly
    int`, not `const`. The distinction has a visible consequence: a `static readonly` value is resolved
    at runtime, so it cannot be used as an attribute argument. That is why the one length an attribute
    needs, `PushNotification.ScopeKeyMaxLength` behind the inbox controller's `[StringLength(...)]`, is
    declared `public const int` on the entity instead (`PushNotification.cs:22`), while these two, which
    are only ever read from ordinary code, are not.
  - `EnsureTitleIsValid(string title, string source)` (line 18) returns `Result.Combine` over two
    `CommonInvariants` calls (lines 19-21): `EnsureStringIsNotEmpty` with code
    `"PushNotification.Title.Empty"`, then `EnsureStringMaxLength` with code
    `"PushNotification.Title.TooLong"` and a message interpolated from `TitleMaxLength` under
    `CultureInfo.InvariantCulture`. `Result.Combine` accumulates rather than short-circuits, so a caller
    sees every violated rule at once.
  - `EnsureBodyIsValid(string body, string source)` (line 23) is the same shape over `BodyMaxLength` and
    the `"PushNotification.Body.*"` codes (lines 24-26).
  - Both take a `source` string and forward it to the underlying helper, which puts it on the `Error`
    for tracing
    (`MMCA.Common/Source/Core/MMCA.Common.Domain/Invariants/CommonInvariants.cs:30-34`). Callers pass
    `nameof(Create)`, so a failure names the factory that rejected the input rather than the invariant
    helper.
  - Note the asymmetry inherited from the helpers: `EnsureStringMaxLength` lets null and empty pass
    (`CommonInvariants.cs:47-51`), which is exactly why each rule pairs it with the non-empty check.
- **Why it's built this way**: keeping the rules in a static class rather than on the entity lets the
  Application and Infrastructure layers reference them without referencing an aggregate they have no
  business constructing, and keeps the entity factory readable as a list of named rules.
- **Where it's used**: [PushNotification](#pushnotification)`.Create` combines both checks with its own
  dedup-key and scope-key length checks (`PushNotification.cs:104-120`);
  [SendPushNotificationRequestValidator](#sendpushnotificationrequestvalidator) reuses the values for
  its FluentValidation rules; the EF configuration reuses them for the column widths. Covered directly
  by `PushNotificationInvariantsTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Notifications/PushNotificationInvariantsTests.cs:7`).

---

### PushNotificationDTOMapper
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/DTOs/PushNotificationDTOMapper.cs:12` · Level 8 · class (sealed, partial)

- **What it is**: the Mapperly-generated mapper that projects the [PushNotification](#pushnotification)
  domain entity onto its [PushNotificationDTO](#pushnotificationdto) response shape, one instance at a
  time. It implements
  [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype)
  closed over `PushNotification` / `PushNotificationDTO` / `PushNotificationIdentifierType`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/DTOs/PushNotificationDTOMapper.cs:13`).
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype),
  [PushNotification](#pushnotification), [PushNotificationDTO](#pushnotificationdto),
  [PushNotificationStatus](#pushnotificationstatus); external `Riok.Mapperly.Abstractions` (`[Mapper]`,
  `[MapProperty]`) and the BCL `ArgumentNullException`.
- **Concept**: compile-time DTO mapping ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)).
  The `[Mapper]` attribute (line 11) makes the Mapperly source generator emit the body of the `partial`
  `MapToDTO` at build time, so the projection costs no reflection at runtime and a property that stops
  matching is a compile error rather than a silent null.
  `[Rubric §9, API & Contract Design]` assesses whether the domain type is kept off the wire: this
  mapper is the one place a `PushNotification` becomes a contract object, so the entity never leaks into
  a response body.
  `[Rubric §15, Best Practices & Code Quality]` assesses whether generated code replaces hand-copied
  boilerplate: the only hand-written lines here are the collection helper and one enum converter.
- **Walkthrough**
  - `MapToDTO(PushNotification entity)` (line 17) is `partial`: Mapperly writes the member-by-member
    copy. The single override is
    `[MapProperty(nameof(PushNotification.Status), nameof(PushNotificationDTO.Status), Use = nameof(MapStatusToString))]`
    (line 16), which routes the status through the custom converter instead of a straight assignment.
    The override is needed because the entity's `Status` is a `PushNotificationStatus` enum while the
    DTO's is a `required string`
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/PushNotifications/PushNotificationDTO.cs:26`).
  - `MapToDTOs(IReadOnlyCollection<PushNotification> entityCollection)` (line 20) is hand-written: it
    null-guards with `ArgumentNullException.ThrowIfNull` (line 22) and then projects with a collection
    expression over `Select(MapToDTO)` (line 23).
  - `MapStatusToString(PushNotificationStatus status)` (line 26) is the private converter, a plain
    `status.ToString()`, so a client reads `"Sent"` rather than a numeric enum value.
- **Why it's built this way**: Mapperly keeps mapping fast and analyzer-checked while still allowing a
  per-property override where a straight copy would be wrong (the enum-to-string case). Rendering the
  status as its name rather than its ordinal means adding an enum member cannot renumber an existing
  contract value.
- **Where it's used**: registered twice by the Application-layer [DependencyInjection](#dependencyinjection)
  below (as itself and as the `IEntityDTOMapper<...>` interface,
  `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:44-46`), and
  consumed through it by [SendPushNotificationHandler](#sendpushnotificationhandler) and
  [GetNotificationHistoryHandler](#getnotificationhistoryhandler) to shape what
  [NotificationsController](#notificationscontroller) returns. It is not the only path: the mapper
  serves by-id reads and the non-projectable fallback, while qualifying list reads are served by
  [PushNotificationDTOProjection](#pushnotificationdtoprojection)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:67`).

---

### PushNotificationDTOProjection
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/DTOs/PushNotificationDTOProjector.cs:22` · Level 8 · class (internal, static, partial)

- **What it is**: the Mapperly-generated **projection** from [PushNotification](#pushnotification) to
  [PushNotificationDTO](#pushnotificationdto). Where the mapper above converts an already-materialized
  entity, this converts an `IQueryable<PushNotification>` into an `IQueryable<PushNotificationDTO>`, so
  the database returns only the DTO's columns instead of whole notification rows that are mapped
  afterwards (documented at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/DTOs/PushNotificationDTOProjector.cs:8-12`).
- **Depends on**: [PushNotification](#pushnotification), [PushNotificationDTO](#pushnotificationdto);
  externals `Riok.Mapperly.Abstractions` (`[Mapper]`, line 21) and `System.Linq` (`IQueryable<T>`).
  It depends on no service: it is a static class with one generated member.
- **Concept introduced, mapping an expression tree instead of an object.** A normal mapper is compiled
  code that runs after rows arrive. A projection has to be an **expression tree** the database provider
  can translate into SQL, which means every step of the mapping must be expressible in that tree. That
  single constraint explains the whole design of this file. The instance mapper renders `Status` with a
  custom method (`Use = nameof(MapStatusToString)`), and a projection cannot call a method the provider
  has never heard of. Mapperly's enum-to-string mapping *is* expressible, so it is inlined here as a
  conditional over the known members, which the provider emits as a SQL `CASE`, producing exactly the
  strings `PushNotificationStatus.ToString()` would (explained at lines 13-20).
  `[Rubric §12, Performance & Scalability]` assesses whether reads move only the data they need: a
  projected list read transfers the DTO's columns rather than every mapped and unmapped column of the
  notification row, and it skips change-tracker materialization entirely.
  `[Rubric §8, Data Architecture]` assesses how the query layer shapes data at the source: pushing the
  shape into SQL is the difference between shaping at the database and shaping in the process.
- **Walkthrough**
  - `[Mapper]` (line 21) marks the class for the source generator; `internal static partial class`
    (line 22) keeps it out of the public package surface, because it is an implementation detail of the
    public wrapper below.
  - `ProjectToDTO(IQueryable<PushNotification> source)` (line 27) is the one member, declared
    `internal static partial` and returning `IQueryable<PushNotificationDTO>`. Mapperly writes the body:
    a `source.Select(x => new PushNotificationDTO { ... })` whose initializer includes the inlined
    status conditional. Nothing is enumerated here; the caller still composes paging and ordering on top
    of the returned queryable.
- **Why it's built this way**: a second generated artifact rather than an attribute on the existing
  mapper, because the two have genuinely different capability sets (one may call arbitrary C#, the other
  may not) and because keeping them separate is what makes the equivalence testable. See
  [ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html), which
  defines projection pushdown as an optional capability of the read contract.
- **Where it's used**: called only from
  [PushNotificationDTOProjector.ProjectTo](#pushnotificationdtoprojector)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/DTOs/PushNotificationDTOProjector.cs:43`).
  Its output is pinned equal to the mapper's by `PushNotificationDTOProjectorTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Notifications/PushNotificationDTOProjectorTests.cs:51-63`,
  a `[Theory]` over every `PushNotificationStatus` member), and its SQL translatability is covered by
  `PushNotificationProjectionTranslationTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/PushNotificationProjectionTranslationTests.cs:15`),
  which runs the projection through a real SQLite provider.
- **Caveats / not-in-source**: the generated body is not in the repository (it is emitted at build
  time), so the exact SQL `CASE` shape is not readable from these files; the tests above assert the
  observable result rather than the generated text.

---

### DevicesController
> MMCA.Common.API · `MMCA.Common.API.Controllers.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:26` · Level 9 · class (sealed)

- **What it is**: the REST controller that lets any authenticated user manage THEIR own native
  push-device installations ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).
  `PUT /Notifications/Devices` upserts the installation (called after login and on token rotation) and
  `DELETE /Notifications/Devices/{installationId}` removes it (called before logout), per the class
  documentation at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:14-20`.
- **Depends on**: [ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase) (its base,
  line 27); [IPushDeviceRegistrar](group-07-persistence-ef-core.md#ipushdeviceregistrar)
  (primary-constructor parameter, line 26);
  [ICurrentUserService](group-08-auth.md#icurrentuserservice) (line 27);
  [DeviceInstallationRequest](#deviceinstallationrequest) (the PUT body, line 34);
  [NotificationFeatures](#notificationfeatures) (line 23); [Result](group-01-result-error-handling.md#result)
  and [Error](group-01-result-error-handling.md#error). Externals: ASP.NET Core MVC (`[ApiController]`,
  `[Route]`, `[HttpPut]`, `[HttpDelete]`, `ProblemDetails`), `Asp.Versioning` (`[ApiVersion("1.0")]`,
  line 22), `Microsoft.AspNetCore.Authorization` (`[Authorize]`, line 24), and
  `Microsoft.FeatureManagement.Mvc` (`[FeatureGate]`, line 23).
- **Concept introduced, the ownership-stamped resource whose id comes from the client.** Every other
  controller in this group addresses server-generated ids. A device installation id is a
  **client-generated GUID** instead, because the device mints it before it has ever talked to the server
  (documented at lines 13-19). Two consequences are visible in the code. First, the owner is never taken
  from the request: both actions re-derive `userId` from `ICurrentUserService.UserId` (lines 37 and 61)
  and pass it to the registrar, so a caller cannot register or delete a device on someone else's behalf.
  Second, the delete is deliberately indistinguishable between "no such installation" and "not yours":
  [IPushDeviceRegistrar](group-07-persistence-ef-core.md#ipushdeviceregistrar) verifies the owning
  `user:{id}` tag and reports both cases as success
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/IPushDeviceRegistrar.cs:28-36`),
  so the endpoint cannot be used as an existence oracle for other users' installation ids (restated on
  the action itself, `DevicesController.cs:48-54`).
  `[Rubric §11, Security]` assesses whether authorization and ownership are enforced at the boundary:
  class-level `[Authorize]` (line 24) plus server-side ownership stamping plus a uniform 204 on delete
  is the whole posture here.
  `[Rubric §9, API & Contract Design]` assesses REST-shape consistency: both actions declare typed
  `[ProducesResponseType]` results (204 on success, plus a `ProblemDetails` failure shape, 400 on the
  upsert at lines 31-32 and 401 on the delete at lines 55-56) and share the `HandleFailure`-or-success
  return shape used across the group.
- **Walkthrough**
  - Primary-constructor DI of the registrar and the current-user service (lines 25-27); the class is
    `sealed` and derives from `ApiControllerBase`, which supplies `HandleFailure`.
  - `UpsertAsync([FromBody] DeviceInstallationRequest request, ...)` (line 33): reads
    `currentUserService.UserId` (line 37); a null user short-circuits through
    `HandleFailure([Error.Unauthorized("PushDevice.Unauthorized", "User is not authenticated.")])`
    (lines 38-41). Otherwise it awaits `registrar.UpsertAsync(userId.Value, request, cancellationToken)`
    (line 43) and returns `NoContent()` (204) or `HandleFailure(result.Errors)` (line 44).
  - `DeleteAsync(string installationId, ...)` (line 57): the id arrives from the route
    (`[HttpDelete("{installationId}")]`, line 54). The same null-user guard runs (lines 61-65), then
    `registrar.DeleteAsync(userId.Value, installationId, cancellationToken)` (line 67), the
    ownership-scoped overload, and the action answers 204 on any non-failure (line 68).
- **Why it's built this way**: the controller is wrapped in
  `[FeatureGate(NotificationFeatures.PushNotifications)]` (line 23), so with the
  `Notification.PushNotifications` flag off the routes are simply not there rather than answering as
  dead endpoints. Routing all storage through
  [IPushDeviceRegistrar](group-07-persistence-ef-core.md#ipushdeviceregistrar) keeps the controller free
  of any push-provider detail, which is what lets the default implementation stay a no-op until a
  notification hub is configured
  ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).
- **Where it's used**: made routable by the API-layer [DependencyInjection](#dependencyinjection) helper
  below (`AddNotificationControllers`); called by a native client's login and logout flows. Covered by
  `DevicesControllerTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Controllers/Notifications/DevicesControllerTests.cs:18`).

---

### InboxController
> MMCA.Common.API · `MMCA.Common.API.Controllers.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationInboxController.cs:29` · Level 9 · class (sealed)

- **What it is**: the REST controller for one user's in-app notification inbox: read the inbox (paged),
  read the unread count, mark one notification read, and mark everything read. An authenticated caller
  reaches only their own inbox. Note the file name and the type name differ: the class is
  `InboxController`, so the `[controller]` token in `[Route("Notifications/[controller]")]` (line 25)
  yields `Notifications/Inbox`, but it lives in `NotificationInboxController.cs`.
- **Depends on**: [ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase);
  [ICurrentUserService](group-08-auth.md#icurrentuserservice) (line 34); the handler contracts
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) and
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  (lines 30-33); the four use cases [GetMyNotificationsQuery](#getmynotificationsquery),
  [GetUnreadNotificationCountQuery](#getunreadnotificationcountquery),
  [MarkNotificationReadCommand](#marknotificationreadcommand) and
  [MarkAllNotificationsReadCommand](#markallnotificationsreadcommand);
  [UserNotificationDTO](#usernotificationdto); [PushNotification](#pushnotification) (for the
  `ScopeKeyMaxLength` constant, line 46);
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
  [Result](group-01-result-error-handling.md#result), [Error](group-01-result-error-handling.md#error);
  [NotificationFeatures](#notificationfeatures). Externals: ASP.NET Core MVC, `Asp.Versioning`,
  `Microsoft.FeatureManagement.Mvc`, and `System.ComponentModel.DataAnnotations` (`[Range]`,
  `[StringLength]`).
- **Concept introduced, the feature-gated controller that injects handlers directly.** There is no
  service layer between HTTP and the use cases: the constructor takes the four
  `IQueryHandler`/`ICommandHandler` closures it needs (lines 30-33) and every action does exactly three
  things, resolve the caller, build the query or command, translate the `Result` to a status code.
  Everything cross-cutting (logging, caching, validation, transaction) is added by the CQRS decorator
  pipeline around those handlers, so none of it appears here.
  `[Rubric §6, CQRS & Event-Driven]` assesses whether presentation delegates to command/query handlers
  rather than to service wrappers: this class is the reference shape for that.
  `[Rubric §11, Security]` assesses boundary authorization: a plain `[Authorize]` (line 28) gates the
  class, since any authenticated identity may have an inbox and no capability is required, and every
  action re-scopes to `currentUserService.UserId` so the data read is user-scoped, not merely
  route-scoped. Contrast [NotificationsController](#notificationscontroller) below, whose broadcast
  surface carries the `notifications:manage` capability instead.
  `[Rubric §9, API & Contract Design]` assesses contract consistency: `[ApiVersion("1.0")]` (line 26),
  typed `[ProducesResponseType]` on each action, and query-string paging with `[Range(1, int.MaxValue)]`
  validation (lines 44-45).
- **Concept introduced, the optional `scope` filter.** Three of the four actions take an optional
  `scope` query parameter bounded by `[StringLength(PushNotification.ScopeKeyMaxLength)]` (128
  characters,
  `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:22`),
  which narrows the inbox to notifications carrying that scope plus the unscoped ones; omitting it
  returns everything (documented lines 36-40). The parameter is threaded through the read, the badge
  count, and the bulk write on purpose: a scoped caller must never clear notifications its own inbox
  read hid from it (lines 105-109). See
  [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html).
- **Walkthrough**
  - Primary-constructor DI of two query handlers, two command handlers, and the current-user service
    (lines 29-34).
  - `GetInboxAsync` (line 43): `[HttpGet]` (line 41); `pageNumber` defaults to 1 and `pageSize` to 20
    (lines 44-45), both `[Range(1, int.MaxValue)]`; the optional `scope` is line 46. A null user
    short-circuits to `Error.Unauthorized("Notification.Unauthorized", ...)` (lines 49-53). It builds
    `new GetMyNotificationsQuery(userId.Value, pageNumber, pageSize, scope)` (line 55), awaits the
    handler (lines 56-57), and returns 200 with the
    [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) or
    `HandleFailure` (line 59).
  - `GetUnreadCountAsync` (line 69): route `unread-count` (line 66) and
    `[ResponseCache(NoStore = true)]` (line 67), so the badge count is never served from a cache. It
    issues `new GetUnreadNotificationCountQuery(userId.Value, scope)` (line 79) and returns the raw
    `int` (line 82).
  - `MarkReadAsync` (line 89): route `{id:int}/read` (line 86), the id bound `[FromRoute]` as
    `UserNotificationIdentifierType` (line 90). It issues
    `new MarkNotificationReadCommand(id, userId.Value)` (line 99) and returns 204 or, per its declared
    contract, a 404 `ProblemDetails` (lines 87-88).
  - `MarkAllReadAsync` (line 112): route `read-all` (line 110), no body, optional `scope` (line 113).
    It issues `new MarkAllNotificationsReadCommand(userId.Value, scope)` (line 122) and returns 204
    (line 125).
- **Why it's built this way**: passing `userId` into every query and command keeps authorization a data
  concern rather than only a routing concern, which is what makes the same handlers reusable from a
  non-HTTP caller. The class-level `[FeatureGate(NotificationFeatures.PushNotifications)]` (line 27)
  makes the whole inbox surface disappear when the flag is off, so a host that has not opted into
  notifications does not advertise endpoints it cannot serve.
- **Where it's used**: registered into MVC application parts by `AddNotificationControllers`
  ([DependencyInjection](#dependencyinjection), API layer, below); consumed by the in-app inbox UI (the
  unread badge plus the notification list). Covered by `NotificationInboxControllerTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Controllers/Notifications/NotificationInboxControllerTests.cs:17`).

---

### NotificationsController
> MMCA.Common.API · `MMCA.Common.API.Controllers.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:30` · Level 9 · class (sealed)

- **What it is**: the manage-only REST controller for push notifications: `POST /Notifications` sends a
  notification to all recipients and returns 201, `GET /Notifications` returns the paged send history.
  Both actions require the `notifications:manage` capability.
- **Depends on**: the same controller family as [InboxController](#inboxcontroller)
  ([ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase),
  [ICurrentUserService](group-08-auth.md#icurrentuserservice),
  [Result](group-01-result-error-handling.md#result), [Error](group-01-result-error-handling.md#error),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
  [NotificationFeatures](#notificationfeatures)), plus
  [HasPermissionAttribute](group-08-auth.md#haspermissionattribute) and
  [NotificationPermissions](#notificationpermissions) (line 29),
  [SendPushNotificationCommand](#sendpushnotificationcommand),
  [GetNotificationHistoryQuery](#getnotificationhistoryquery),
  [SendPushNotificationRequest](#sendpushnotificationrequest),
  [PushNotificationDTO](#pushnotificationdto),
  [IdempotentAttribute](group-12-api-hosting-mapping.md#idempotentattribute) (line 44) and
  [IdempotencyHeaders](group-08-auth.md#idempotencyheaders) (line 62). Externals: ASP.NET Core MVC,
  `Asp.Versioning`, `Microsoft.FeatureManagement.Mvc`, and `System.Globalization` (`CultureInfo`).
- **Concept**: the feature-gated, handler-injecting controller shape is taught at
  [InboxController](#inboxcontroller). What differs here is the authorization boundary:
  `[HasPermission(NotificationPermissions.Manage)]` (line 29) restricts both actions to callers holding
  the `notifications:manage` capability, because sending is a broadcast while the inbox is per-user.
  The gate names a capability rather than a role, so each host decides which of its roles holds it
  (stated at `NotificationsController.cs:20-24`); see
  [NotificationPermissions](#notificationpermissions) for the constant and
  [HasPermissionAttribute](group-08-auth.md#haspermissionattribute) for the machinery behind the
  attribute.
  `[Rubric §11, Security]` assesses least privilege: the write side carries its own stricter,
  capability-based gate instead of reusing the authenticated-only one the inbox uses.
  `[Rubric §9, API & Contract Design]` assesses REST correctness: `SendAsync` answers `Created(...)`
  with a relative `Location` URI built from the new notification's id (line 74).
- **Concept introduced, two-level retry safety (response replay plus delivery dedup).** The send path is
  protected twice over, and the doc comment at lines 35-42 spells out why one level is not enough.
  `[Idempotent]` (line 44) makes the [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter)
  replay the original HTTP response for a repeated `Idempotency-Key`
  ([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)). That protects the
  response, but only while the cached entry survives. So the action ALSO reads the raw header itself and
  carries it into the domain as the command's `DedupKey` (lines 60-69), where a key that has already
  been seen returns the existing notification instead of sending a second time
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationCommand.cs:25-32`).
  The filter protects the response; the `DedupKey` protects delivery when the cache is cold, evicted, or
  degraded. See [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html).
  `[Rubric §29, Resilience & Business Continuity]` assesses whether a retried or replayed request can
  cause duplicate side effects: the two levels together mean a client can retry a send freely.
- **Walkthrough**
  - Primary-constructor DI of the send command handler, the history query handler, and the current-user
    service (lines 30-33).
  - `SendAsync([FromBody] SendPushNotificationRequest request, ...)` (line 48): guards a null user with
    `Error.Unauthorized("Notification.Unauthorized", ...)` (lines 52-56). It then reads
    `IdempotencyHeaders.IdempotencyKey` off `Request.Headers` directly (lines 62-66); an absent or
    whitespace-only value leaves `dedupKey` null, which is the behavior where every send creates a new
    notification (comment lines 58-59). The header is read manually rather than bound with
    `[FromHeader]` (and Sonar's S6932 suppressed with that reason, lines 61 and 67) so protocol plumbing
    shared with the idempotency filter does not appear in the generated OpenAPI contract. It builds
    `new SendPushNotificationCommand(request, userId.Value) { DedupKey = dedupKey }` (line 69) and on
    success returns
    `Created(new Uri(string.Create(CultureInfo.InvariantCulture, $"/notifications/{result.Value!.Id}"), UriKind.Relative), result.Value)`
    (line 74).
  - `GetHistoryAsync` (line 80): `[HttpGet]` (line 78) with `[Range(1, int.MaxValue)]` paging,
    `pageSize` defaulting to 10 (lines 81-82). It runs
    `new GetNotificationHistoryQuery(pageNumber, pageSize)` (line 85) and returns 200 with the paged
    [PushNotificationDTO](#pushnotificationdto) collection (line 91). Unlike the inbox, history takes no
    user filter and no null-user guard: the capability gate already established who may read it, and a
    holder sees every send.
- **Why it's built this way**: splitting the broadcast surface from the per-user inbox surface lets each
  controller carry exactly its own authorization gate, so widening the inbox's gate can never widen the
  send gate by accident. Both stay behind
  `[FeatureGate(NotificationFeatures.PushNotifications)]` (line 28).
- **Where it's used**: registered via `AddNotificationControllers`
  ([DependencyInjection](#dependencyinjection), API layer, below); consumed by the organizer
  push-notification UI. Covered by `NotificationsControllerTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Controllers/Notifications/NotificationsControllerTests.cs:16`).

---

### PushNotificationDTOProjector
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/DTOs/PushNotificationDTOProjector.cs:35` · Level 9 · class (sealed)

- **What it is**: the injectable wrapper that adapts the static, generated
  [PushNotificationDTOProjection](#pushnotificationdtoprojection) to the framework's projection contract
  [`IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>`](group-05-cqrs-pipeline.md#ientitydtoprojectortentity-tentitydto-tidentifiertype),
  closed over `PushNotification` / `PushNotificationDTO` / `PushNotificationIdentifierType` (line 36).
  Registering it is what switches notification list reads onto the server-side projection path.
- **Depends on**: [`IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>`](group-05-cqrs-pipeline.md#ientitydtoprojectortentity-tentitydto-tidentifiertype),
  [PushNotificationDTOProjection](#pushnotificationdtoprojection), [PushNotification](#pushnotification),
  [PushNotificationDTO](#pushnotificationdto); BCL `ArgumentNullException` and `IQueryable<T>`. It has no
  constructor and no state, so it is trivially safe to resolve at any lifetime.
- **Concept introduced, opting a single aggregate into projection pushdown.**
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype)
  declares two constructors: a five-argument one and a six-argument one that additionally takes an
  `IEntityDTOProjector<...>`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:70-78`). The container
  picks the longer constructor when a projector is registered and the shorter one when it is not,
  because one parameter set is a strict superset of the other; that is the documented reason it is a
  second constructor rather than an optional parameter, since
  `Microsoft.Extensions.DependencyInjection` has no notion of an optional dependency
  (`EntityQueryService.cs:52-62`). So registering **this** class in
  [DependencyInjection](#dependencyinjection) below is the entire opt-in gesture: no query handler
  changes.
  The projection path is not taken unconditionally. The decision is taken per read at
  `EntityQueryService.cs:304`, and `CanProject` requires three things
  (`EntityQueryService.cs:490-493`): a projector is registered, the caller did not ask for tracking
  (a projection yields DTOs, which the change tracker has nothing to do with), and there are no
  unsupported cross-source includes (those are loaded row by row after materialization by the navigation
  populator, which a projection has no rows to hand it). Field shaping deliberately does not disqualify,
  because shaping runs after materialization over whatever object the pipeline produced
  (`EntityQueryService.cs:485-487`).
  `[Rubric §1, SOLID]` assesses dependency inversion and interface segregation: the contract has exactly
  one member, and the query service depends on that interface rather than on Mapperly or on this class.
  `[Rubric §12, Performance & Scalability]` assesses whether the read path scales with result shape: for
  notification history and inbox-style list reads, the row width sent over the wire drops to the DTO's
  columns.
- **Walkthrough**
  - `ProjectTo(IQueryable<PushNotification> source)` (line 39) is the whole class. It null-guards with
    `ArgumentNullException.ThrowIfNull(source)` (line 41), then returns
    `PushNotificationDTOProjection.ProjectToDTO(source)` (line 43). It composes, it does not execute:
    the returned queryable is still open for the pipeline's `Where`, `OrderBy`, `Skip`, and `Take`.
- **Why it's built this way**: the generated projection is a static method, and DI cannot resolve a
  static method. This short adapter is the minimum needed to make a generated artifact injectable and,
  in the same move, overridable: because the Application-layer registration uses `TryAddScoped`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:51-53`), a
  consuming app can register its own projector first and keep it. See
  [ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html), which
  also records the trade-off: nothing tells a caller which path ran, so a projector that stops being
  registered loses the optimization with no signal beyond query latency.
- **Where it's used**: registered twice by the Application-layer [DependencyInjection](#dependencyinjection)
  below (as itself and as the interface, lines 50-52), then resolved by
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype)
  closed over the notification triple, which serves
  [GetNotificationHistoryHandler](#getnotificationhistoryhandler)'s paged reads. Directly exercised by
  `PushNotificationDTOProjectorTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Notifications/PushNotificationDTOProjectorTests.cs:16`),
  which asserts among other things that `ProjectTo` returns a still-composable queryable rather than a
  materialized list (lines 100-110).

---

### DependencyInjection
> MMCA.Common.API · `MMCA.Common.API.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Notifications/DependencyInjection.cs:9` · Level 10 · class (static)

*(API-layer notification DI. A second `DependencyInjection`, the Application-layer one, follows below;
both keep the raw type name as their heading.)*

- **What it is**: the API-layer DI helper for the notification subsystem. Its one member,
  `AddNotificationControllers`, adds this package's assembly to the MVC application parts so ASP.NET Core
  routing can discover the three notification controllers.
- **Depends on**: the [NotificationsController](#notificationscontroller) type, used only as an assembly
  anchor (line 21); externals `Microsoft.Extensions.DependencyInjection` (`IMvcBuilder`) and ASP.NET Core
  MVC application parts.
- **Concept introduced, application parts for controllers that ship in a NuGet package.** ASP.NET Core
  discovers controllers by scanning the host's own assembly (and its application parts). The notification
  controllers live in `MMCA.Common.API`, a referenced package, so without an explicit application part
  they exist but are never routed (stated in the member's own documentation, lines 13-17).
  `AddNotificationControllers` is written as an `extension(IMvcBuilder builder)` member (line 11) that
  calls `builder.AddApplicationPart(typeof(NotificationsController).Assembly)` (line 21), which registers
  all three controllers in one call because they share an assembly.
  `[Rubric §7, Microservices Readiness]` assesses whether a capability packages cleanly for reuse across
  hosts: shipping the controllers together with their own one-line registration means the whole
  notification HTTP surface moves into an extracted service without editing the controllers.
  `[Rubric §3, Clean Architecture]` assesses whether composition stays at the edge: the host opts in
  explicitly, so nothing is routed by a package the host merely references.
- **Walkthrough**: inside the `extension(IMvcBuilder builder)` block (line 11),
  `AddNotificationControllers()` (line 19) adds the application part (line 21) and returns the builder
  for fluent chaining (line 22). There is no other member; the class is `static` (line 9).
- **Why it's built this way**: exposing the registration as a named `extension(IMvcBuilder)` member keeps
  a host's composition root declarative and reads as
  `AddControllers().AddNotificationControllers()` (see
  [primer §4](00-primer.md#c-extensiont-types-read-this-once)). This is the API counterpart to the
  Application-layer `AddNotificationApplicationServices` below: one call wires the handlers, the other
  exposes them over HTTP.
- **Where it's used**: called from a consuming host's MVC setup, alongside the Application-layer
  registration.

---

### DependencyInjection
> MMCA.Common.Application · `MMCA.Common.Application.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:27` · Level 10 · class (static)

*(Application-layer notification DI. Distinct from the API-layer `DependencyInjection` directly above;
both keep the raw type name as their heading.)*

- **What it is**: the Application-layer composition helper for the notification subsystem. Its single
  `extension(IServiceCollection)` member, `AddNotificationApplicationServices`, registers every
  notification command and query handler, the DTO mapper, the DTO projector, the entity query service,
  the validators, and the default recipient provider.
- **Depends on**: [PushNotification](#pushnotification),
  [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity)
  and [`NullNavigationPopulator<TEntity>`](group-11-navigation-populators.md#nullnavigationpopulatortentity);
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  and [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype);
  [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype)
  and [PushNotificationDTOMapper](#pushnotificationdtomapper);
  [`IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>`](group-05-cqrs-pipeline.md#ientitydtoprojectortentity-tentitydto-tidentifiertype)
  and [PushNotificationDTOProjector](#pushnotificationdtoprojector); the handler contracts
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  with the six concrete handlers named below;
  [SendPushNotificationRequestValidator](#sendpushnotificationrequestvalidator);
  [INotificationRecipientProvider](#inotificationrecipientprovider) and
  [NullNotificationRecipientProvider](#nullnotificationrecipientprovider);
  [Result](group-01-result-error-handling.md#result) and
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt). Externals:
  `Microsoft.Extensions.DependencyInjection.Extensions` (`TryAddScoped`) and `FluentValidation`
  (`AddValidatorsFromAssemblyContaining`).
- **Concept introduced, hand-registration with `TryAdd` for a module that lives inside the framework
  assembly.** Application modules are normally auto-registered by a scan over the module's own assembly.
  The notification types have no module assembly of their own: they live in `MMCA.Common.Application`, so
  they are wired explicitly here (line 35). Every registration except the validator scan uses
  `TryAddScoped` (lines 38-74), which is the override contract: a consuming app that registers its own
  handler, mapper, projector, or recipient provider **before** calling this helper keeps its own
  registration, because `TryAdd` never replaces an existing service descriptor. The class documentation
  states the same rule at lines 22-25.
  `[Rubric §1, SOLID]` assesses dependency inversion: the notification send path depends on
  [INotificationRecipientProvider](#inotificationrecipientprovider), and the default binding is the
  no-op [NullNotificationRecipientProvider](#nullnotificationrecipientprovider) (line 74), so the
  framework ships a working default while an app supplies its real audience.
  `[Rubric §3, Clean Architecture]` assesses whether wiring stays out of the domain: all of it is one
  static class in the Application layer, and nothing below Application knows these types exist.
- **Walkthrough**: `AddNotificationApplicationServices()` (line 35), inside
  `extension(IServiceCollection services)` (line 28), registers in reading order:
  - The [PushNotification](#pushnotification) aggregate's navigation populator
    (`NullNavigationPopulator<PushNotification>`, line 38) and its
    [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype)
    closed over `PushNotification` / `PushNotificationDTO` / `PushNotificationIdentifierType`
    (lines 39-40). The null populator is the explicit statement that this aggregate has no navigations
    to batch-load, which is also what keeps `CanProject` satisfiable (no unsupported includes).
  - The [PushNotificationDTOMapper](#pushnotificationdtomapper) twice, as the concrete type and as the
    `IEntityDTOMapper<...>` interface (lines 43-45), so both the query service (which resolves the
    interface) and any direct consumer get the same scoped instance shape.
  - The [PushNotificationDTOProjector](#pushnotificationdtoprojector) twice, as the concrete type
    (line 50) and as the `IEntityDTOProjector<...>` interface (lines 51-52). The comment at lines 47-49
    records why this pair matters: registering it is what switches notification list reads onto the
    server-side projection path, because the query service resolves it through its longer constructor,
    and the projected values are pinned equal to the mapper's by test.
  - Three command handlers: [SendPushNotificationHandler](#sendpushnotificationhandler) (lines 55-56),
    [MarkNotificationReadHandler](#marknotificationreadhandler) (lines 57-58), and
    [MarkAllNotificationsReadHandler](#markallnotificationsreadhandler) (lines 59-60).
  - Three query handlers: [GetNotificationHistoryHandler](#getnotificationhistoryhandler) (lines 63-64),
    [GetMyNotificationsHandler](#getmynotificationshandler) (lines 65-66), and
    [GetUnreadNotificationCountHandler](#getunreadnotificationcounthandler) (lines 67-68). These six
    registrations are exactly the closures the two controllers above inject.
  - The FluentValidation validators discovered from the
    [SendPushNotificationRequestValidator](#sendpushnotificationrequestvalidator) assembly with
    `includeInternalTypes: true` (line 71). Note this one is a plain
    `AddValidatorsFromAssemblyContaining`, not a `TryAdd`.
  - The default recipient provider (line 74), then `return services` for chaining (line 76).
- **Why it's built this way**: hand-registration keeps the notification subsystem self-contained inside
  the framework package while still honoring the framework-wide override contract, and the
  `extension(IServiceCollection)` preview syntax lets it read as a first-class
  `services.AddNotificationApplicationServices()` call (see
  [primer §4](00-primer.md#c-extensiont-types-read-this-once)).
- **Where it's used**: called from a consuming host's Application composition root. Ordering matters in
  one direction only: it must run before `AddApplicationDecorators()`, because Scrutor's `TryDecorate`
  can only wrap handlers that are already registered.
- **Caveats / not-in-source**: the infrastructure side of the subsystem (the SignalR sender, the device
  registrar, the email sender) is not registered here; those live in the Infrastructure-layer
  registration, which this file does not reference.


---
[⬅ Caching](group-09-caching.md)  •  [Index](00-index.md)  •  [Navigation Metadata & Populators (EF-decoupled eager loading) ➡](group-11-navigation-populators.md)
