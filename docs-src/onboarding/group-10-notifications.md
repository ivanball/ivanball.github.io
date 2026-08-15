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
be configured for DI to resolve: `NullPushNotificationSender` and `NullLiveChannelPublisher` are
no-ops (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:235-236`),
`IEmailSender` defaults to the real `SmtpEmailSender`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:234`), and
`INotificationRecipientProvider` gets its default in the Application layer
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:67`).

There are really **four delivery channels** here, and it is worth separating them up front because
they have different durability guarantees:

1. **The durable in-app inbox.** Every send writes one [`UserNotification`](#usernotification) row
   per recipient, so a user who was offline at send time still sees the message when they next open
   their inbox
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:104-112`).
   This is the persistent half of the two-channel model ([ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html)).
2. **The transient SignalR push.** [`IPushNotificationSender`](#ipushnotificationsender) fans the
   same message out to any connections the recipient has open right now via the
   [`NotificationHub`](#notificationhub); clients not connected at send time simply never see this
   copy (the inbox is their catch-up). This is the real-time half of [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html).
3. **The OS-level native push ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).** A separate best-effort channel reaches devices the
   SignalR hub cannot (app backgrounded or killed), through `INativePushSender` and the device
   registrations managed by [`DevicesController`](#devicescontroller). The sender itself and its
   Azure Notification Hubs implementation live in
   [Group 07](group-07-persistence-ef-core.md#inativepushsender); this chapter covers only the
   request record and the registration endpoint.
4. **Ephemeral live-channel events ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)).** A distinct, never-persisted fan-out to a *group*
   of subscribed connections (for example `event:1` or `session:123`), used by the ADC Engagement
   live layer for poll and question updates. This rides the same hub but through
   [`ILiveChannelPublisher`](#ilivechannelpublisher) and the hub's `JoinChannel`/`LeaveChannel`
   group membership rather than per-user targeting
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Hubs/NotificationHub.cs:43-59`).

A fifth transport, plain **email**, is present as [`IEmailSender`](#iemailsender) /
[`SmtpEmailSender`](#smtpemailsender) (MailDev locally, real SMTP in production) but is a
lower-traffic, fire-one-message helper rather than part of the broadcast pipeline: it builds and
disposes an `SmtpClient` per call and offers a "send to the configured default recipient" overload
for system mail (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/SmtpEmailSender.cs:23-54`).

## The layering, and why the pieces sit where they do

The dependency flow of the group mirrors the framework's Clean Architecture story
([Rubric §3, Clean Architecture]). The **Domain** layer holds the two aggregates,
[`PushNotification`](#pushnotification) (the audit record of a broadcast: title, body, sender,
recipient count, an optional deduplication key, and a
[`PushNotificationStatus`](#pushnotificationstatus) of `Pending`/`Sent`/`Failed`)
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
[`DeviceInstallationRequest`](#deviceinstallationrequest)) and the
[`NotificationFeatures`](#notificationfeatures) flag constant
(`Notification.PushNotifications`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/NotificationFeatures.cs:9`). The
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
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IPushNotificationSender.cs:7`,
`ILiveChannelPublisher.cs:9`, `INotificationRecipientProvider.cs:8`, `IEmailSender.cs:6`), not
Infrastructure. That keeps the send handler and the Engagement live layer depending on an
abstraction the way `IMessageBus` and the gRPC service interfaces do (the microservices-extraction
discipline in ADRs 007/008): the same application code runs unchanged whether the concrete sender is
an in-process SignalR call or a gRPC forward to another service.

## The broadcast send flow, end to end

Sending a notification is a command-side vertical slice ([Rubric §5, Vertical Slice],
[Rubric §6, CQRS & Event-Driven]). An organizer POSTs to
[`NotificationsController`](#notificationscontroller), which is gated four ways: API versioning,
`[FeatureGate(NotificationFeatures.PushNotifications)]`, `[Authorize(Policy = RequireOrganizer)]`,
and, on the POST action itself,
[`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:25-29,43-44`).
The controller reads the authenticated id from `ICurrentUserService` and refuses the call with an
`Error.Unauthorized` when there is none (`NotificationsController.cs:52-56`), then reads the raw
`Idempotency-Key` header and carries it into the domain as the command's `DedupKey`, treating a
whitespace-only header as absent (`NotificationsController.cs:60-67`). Header binding is done by
hand rather than with `[FromHeader]` precisely so the key stays protocol plumbing and does not leak
into the generated OpenAPI contract (`NotificationsController.cs:61`). The request is wrapped in a
[`SendPushNotificationCommand`](#sendpushnotificationcommand) and handed to
[`SendPushNotificationHandler`](#sendpushnotificationhandler) (`NotificationsController.cs:69-74`).

Those two idempotency mechanisms are deliberately stacked ([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)). The filter replays the
original HTTP *response* for a repeated key; the `DedupKey` protects *delivery* even when the
filter's cache is cold, evicted, or degraded (`NotificationsController.cs:37-41`). The handler runs
a deliberate ordering
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:26-156`):

- **Dedup lookup first** (lines 30-41). When a key is present the handler requeries for an existing
  [`PushNotification`](#pushnotification) with that key and, on a hit, returns it mapped to a DTO
  without sending anything again. The lookup goes through
  `unitOfWork.GetReadRepository<...>()` rather than an injected repository, so it reads the same
  data source the write below targets (`SendPushNotificationHandler.cs:163-172`).
- **Resolve recipients** through [`INotificationRecipientProvider`](#inotificationrecipientprovider),
  failing early with a `PushNotification.NoRecipients` validation error when the set is empty
  (lines 43-53).
- **Create and save the audit aggregate** (lines 55-73). Because the dedup lookup is a check-then-act,
  two concurrent retries of the same send both pass it, and the loser only fails here, on the insert,
  against the filtered unique index on `DedupKey`. The catch block requeries by key and, when the
  winner now exists, returns it; anything else rethrows, so a genuine persistence fault still reaches
  the exception middleware (lines 75-102). The requery deliberately uses `CancellationToken.None`,
  otherwise a save aborted by the caller's token could never be classified (lines 89-93). The index
  itself is the arbiter: unique, filtered to `[DedupKey] IS NOT NULL` and to live rows, so the many
  keyless sends coexist and a soft-deleted row does not occupy a key slot forever
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:46-63`).
- **Write the inbox rows**, one [`UserNotification`](#usernotification) per recipient, then save again
  (lines 104-112).
- **Attempt SignalR delivery** via [`IPushNotificationSender`](#ipushnotificationsender), catching any
  exception and recording `MarkAsSent()` or `MarkAsFailed()` accordingly, since delivery failure is
  non-fatal (lines 114-132).
- **Attempt the native-push leg** through `INativePushSender` ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)), whose failures are logged at
  Warning and never change the audit status (lines 134-151).
- **Save a third time and map** the aggregate to a [`PushNotificationDTO`](#pushnotificationdto) via
  [`PushNotificationDTOMapper`](#pushnotificationdtomapper) (lines 153-155).

The durable inbox write happening **before** the transient channels is the load-bearing choice: the
record of who should have been reached survives even when nobody is connected, and the audit status
records which of the two real-time legs succeeded ([Rubric §29, Resilience & Business Continuity]).

Who counts as a recipient is deliberately left to the consuming app.
[`INotificationRecipientProvider`](#inotificationrecipientprovider) is the extension point; the
framework registers [`NullNotificationRecipientProvider`](#nullnotificationrecipientprovider), which
returns an empty list, as a safe default
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:67`), and ADC
supplies [`AttendeeNotificationRecipientProvider`](#attendeenotificationrecipientprovider), which
bridges the Identity module's
[`IAttendeeQueryService`](group-24-identity-module.md#iattendeequeryservice) (over gRPC across
service boundaries) so a broadcast targets every conference attendee
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/AttendeeNotificationRecipientProvider.cs:10-16`).
The override works by ordering, not by configuration: ADC registers its provider with `AddScoped`
**before** calling `AddNotificationApplicationServices()`, whose `TryAddScoped` default then finds
the slot already taken
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/DependencyInjection.cs:24-31`).

## The inbox side

Reading and acknowledging notifications is the query/command counterpart, served by
[`InboxController`](#inboxcontroller) under the same feature gate and
`[Authorize(RequireAuthenticated)]`, so any user reaches only their own inbox
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationInboxController.cs:27-28`);
every action re-reads `ICurrentUserService.UserId` and builds the message from it rather than
trusting a client-supplied id ([Rubric §11, Security]). It exposes four use cases: the paged inbox
([`GetMyNotificationsQuery`](#getmynotificationsquery) /
[`GetMyNotificationsHandler`](#getmynotificationshandler), which joins the per-user
[`UserNotification`](#usernotification) rows to their [`PushNotification`](#pushnotification)
content newest-first and clamps paging through
[`PagingMath`](group-03-querying-specifications.md#pagingmath) with a 500-row page ceiling,
`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetInbox/GetMyNotificationsHandler.cs:21,32,36-60`),
an unread count ([`GetUnreadNotificationCountQuery`](#getunreadnotificationcountquery), served
`[ResponseCache(NoStore = true)]` so the bell badge is never stale,
`NotificationInboxController.cs:58-59`), a single mark-read
([`MarkNotificationReadCommand`](#marknotificationreadcommand)), and a mark-all-read
([`MarkAllNotificationsReadCommand`](#markallnotificationsreadcommand)).
[`MarkNotificationReadHandler`](#marknotificationreadhandler) matches on both the notification id
**and** the requesting user id, returning `UserNotification.NotFound` rather than a forbidden when
the row belongs to somebody else
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkRead/MarkNotificationReadHandler.cs:24-36`).
[`UserNotification`](#usernotification)`.MarkAsRead` is **idempotent** and takes the read timestamp
as a parameter (from an injected `TimeProvider`, `MarkNotificationReadHandler.cs:15,38`) so the
domain stays free of ambient clock access and the transition is deterministically testable
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/UserNotifications/UserNotification.cs:58-67`).

## The SignalR transport, and how it survives extraction

[`NotificationHub`](#notificationhub) is intentionally thin
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Hubs/NotificationHub.cs:16-17`): it is
`[Authorize]`d, and beyond ASP.NET's built-in per-user connection mapping it only manages channel
(SignalR group) membership through `JoinChannel`/`LeaveChannel`, validating each channel key against
a configured regex with a cached, one-second-timeout `Regex` so a bad key throws `HubException`
rather than opening an injection or ReDoS hole (`NotificationHub.cs:31-34,61-71`)
([Rubric §11, Security]). Actual delivery does not run inside the hub:
[`SignalRPushNotificationSender`](#signalrpushnotificationsender) and
[`SignalRLiveChannelPublisher`](#signalrlivechannelpublisher) both use `IHubContext<NotificationHub>`
so they can be called from any handler without a live connection. The push sender targets
`Clients.User` / `Clients.Users` / `Clients.All` and **batches large user lists in chunks of 100**
to avoid overwhelming the connection manager
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/SignalRPushNotificationSender.cs:15,42-59`)
([Rubric §12, Performance & Scalability]); the live publisher does a single `Clients.Group` send
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/SignalRLiveChannelPublisher.cs:15-19`).
Both are wired by `AddPushNotifications(configuration)`, which also attaches a Redis backplane when
a `redis` connection string is present, so the fan-out crosses replicas
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:290-313`).

The live channel is where the extracted-service topology shows through
([Rubric §7, Microservices Readiness]). In a monolith the default
[`NullLiveChannelPublisher`](#nulllivechannelpublisher) is registered, and a host that maps the hub
swaps in the real [`SignalRLiveChannelPublisher`](#signalrlivechannelpublisher). In extracted ADC,
Engagement is a *different* process from the one that owns the WebSocket, so Engagement's live layer
depends on [`ILiveChannelPublisher`](#ilivechannelpublisher) as usual but the composition root
`Replace`s the registration with
[`LiveChannelPublisherGrpcAdapter`](#livechannelpublishergrpcadapter)
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
named `grpc` (8081 in the container, 55996 locally) is declared in the `Kestrel:Endpoints` config
section and resolved by peers as `_grpc.notification` through the
`services__notification__grpc__0` entry
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:56-71`). The host maps the hub
itself at `/hubs/notifications` via `MapNotificationHub()` (`Program.cs:254-259`) and both gRPC
services on that dedicated endpoint (`Program.cs:264,272`). The two gRPC surfaces are **not**
protected alike, and the difference is deliberate: the live-channel ingress carries no `[Authorize]`
because it is reachable only on the internal service network and its caller (Engagement's background
drain) has no HttpContext and forwards no bearer
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/LiveChannelGrpcService.cs:13-20`),
while the export rpc is mapped with `.RequireAuthorization()` because its response carries personal
data keyed by a raw user id (`Program.cs:269-272`).

## The module host, native-device registration, and the privacy export

On the ADC side the whole capability is packaged by [`NotificationModule`](#notificationmodule)
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/NotificationModule.cs:15`), an
[`IModule`](group-14-module-system-composition.md#imodule) that declares a hard dependency on
Identity (`Dependencies => ["Identity"]`, `RequiresDependencies => true`, since it needs attendee
data, `NotificationModule.cs:21-24`) and whose `Register` calls `AddNotificationModule` to wire the
application handlers, the EF configurations, the SignalR push registration, the native-push channel,
and the Common controllers
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:21-35`). It
is a deliberately thin module (API + Application only, no Infrastructure project of its own). The
framework's own registration ([`DependencyInjection`](#dependencyinjection) in
`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:26`) uses
`TryAddScoped` throughout so a consuming app can override any handler or the recipient provider, and
the API-layer [`DependencyInjection`](#dependencyinjection)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Notifications/DependencyInjection.cs:19-23`) adds
the Common controllers as an MVC application part, because they ship in a NuGet assembly that
ASP.NET does not scan by default ([Rubric §16, Maintainability]).

Native-device management is the third channel's control plane.
[`DevicesController`](#devicescontroller) ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) lets an authenticated user upsert
(`PUT`, after login and on token rotation) or delete (`DELETE`, before logout) a device
installation, described by [`DeviceInstallationRequest`](#deviceinstallationrequest). Both verbs
scope ownership the same way: each reads `currentUserService.UserId` and passes it to the registrar,
so a PUT can only register *the caller's own* installation and a DELETE only removes one the caller
owns
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:37-44,61-68`).
The ownership check itself lives in the registrar
([`IPushDeviceRegistrar`](group-07-persistence-ef-core.md#ipushdeviceregistrar), Group 07): the
Azure Notification Hubs implementation reads the installation, compares its `user:{id}` tag, and
returns success without deleting when the tag does not match, so the response cannot be used as an
existence oracle for other users' installation ids
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/AzureNotificationHubDeviceRegistrar.cs:88-97`)
([Rubric §11, Security]).

Finally, the module carries the Notification half of the cross-service data-subject export
(PRIVACY.md §7), [`UserNotificationExportService`](#usernotificationexportservice), published across
modules as [`IUserNotificationExportService`](#iusernotificationexportservice) and reachable from
the Identity aggregator over gRPC via
[`UserNotificationExportGrpcService`](#usernotificationexportgrpcservice) and its client-side
[`UserNotificationExportServiceGrpcAdapter`](#usernotificationexportservicegrpcadapter), producing
[`UserNotificationExportItemDTO`](#usernotificationexportitemdto) rows scoped strictly to the
requesting user through a `where un.UserId == userId` filter on an unpaged, newest-first join
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/UserNotificationExportService.cs:27-41`).
When the module is disabled, [`NotificationModule`](#notificationmodule) registers
[`DisabledUserNotificationExportService`](#disabledusernotificationexportservice), which answers with
an empty list so the cross-module interface still resolves (`NotificationModule.cs:34-35`)
([Rubric §30, Compliance, Privacy & Data Governance]).

## Where this group sits

Upstream, this group depends on the domain building blocks of
[Group 02](group-02-domain-building-blocks.md) (both aggregates derive from
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)),
the [`Result`](group-01-result-error-handling.md#result) pattern of
[Group 01](group-01-result-error-handling.md), the CQRS pipeline and
[`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) of persistence
([Group 07](group-07-persistence-ef-core.md)), the idempotency filter of
[Group 12](group-12-api-hosting-mapping.md#idempotencyfilter), and the module system of
[Group 14](group-14-module-system-composition.md). Downstream, the Blazor UI of
[Group 15](group-15-common-ui-framework.md) consumes it: the notification bell, inbox, and send
pages call these REST endpoints, and the UI's SignalR client listens on the hub's
`ReceiveNotification` / `ReceiveChannelEvent` methods (`NotificationHub.cs:20-23`). The ADC
Engagement live layer ([Group 23](group-23-engagement-live-layer.md)) is the busiest producer of
live-channel events, and recipients are resolved through the
[Identity module](group-24-identity-module.md#iattendeequeryservice). Read this chapter as the
answer to one question: how does a single "notify everyone" intent become a durable inbox row, a
real-time toast, an OS push, and (for the live layer) an ephemeral group event, without any of the
four ever taking the others down, and without a retried request doing it twice.

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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:58-59`).
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationInboxController.cs:56`),
  then handled by [GetMyNotificationsHandler](#getmynotificationshandler). The controller bounds the
  scope string with `[StringLength(PushNotification.ScopeKeyMaxLength)]`
  (`NotificationInboxController.cs:47`), the same 128-character constant the entity publishes
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
  entry (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:56-57`).
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
  (`NotificationInboxController.cs:80`, scope bound at `NotificationInboxController.cs:71`) behind the
  [NotificationBell](group-15-common-ui-framework.md#notificationbell) badge; handled by
  [GetUnreadNotificationCountHandler](#getunreadnotificationcounthandler). That action is also marked
  `[ResponseCache(NoStore = true)]` (`NotificationInboxController.cs:68`), so a badge poll is never
  served from a stale cache.

### IEmailSender
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IEmailSender.cs:6` · Level 0 · interface

- **What it is**: the Application-layer port for sending email. Two `SendAsync` overloads: one to an
  explicit recipient, one to a default/system recipient (admin notifications). Infrastructure supplies
  the concrete transport.
- **Depends on**: BCL only (`Task`, `CancellationToken`). Implemented by [SmtpEmailSender](#smtpemailsender)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/SmtpEmailSender.cs:12`).
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
  address is `ISmtpSettings.To`, captured once in a field (`SmtpEmailSender.cs:19`) and forwarded to the
  explicit-recipient overload (`SmtpEmailSender.cs:54`).
- **Why it's built this way**: keeping the interface in Application (and the SMTP dependency in
  Infrastructure) is what lets a test host register a no-op sender and production register
  [SmtpEmailSender](#smtpemailsender). Registration is `TryAddTransient<IEmailSender, SmtpEmailSender>()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:472`), so the `TryAdd` lets
  a host pre-register its own sender and win.
- **Where it's used**: within MMCA.Common and MMCA.ADC there are **no injection sites** beyond that
  registration and the implementation itself: this is a capability the framework offers rather than one
  the ADC feature set currently calls. The other consumer app does use it: MMCA.Store's
  `OrderPaidHandler` and `OrderPaymentFailedSagaHandler` resolve it from a scope
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/DomainEventHandlers/OrderPaidHandler.cs:41`,
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Saga/OrderPaymentFailedSagaHandler.cs:31`),
  the arrangement [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html) describes.
- **Caveats / not-in-source**: the "default/system recipient" of the second overload is not defined by
  this interface; it is whatever the implementation's settings configure.

### ILiveChannelPublisher
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ILiveChannelPublisher.cs:9` · Level 0 · interface

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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:474`), replaced by
  [SignalRLiveChannelPublisher](#signalrlivechannelpublisher) when a host opts into the SignalR wiring
  (same file, line 547).
- **Where it's used**: ADC's conference-day live layer does **not** inject it into command handlers.
  Handlers enqueue a work item and a single-reader hosted drain,
  [LiveChannelPublishProcessor](group-22-engagement-module.md#livechannelpublishprocessor), resolves the
  publisher per work item from its own scope and calls `PublishAsync` in FIFO order
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:33-39`).
  `[Rubric §29, Resilience & Business Continuity]` assesses whether a degraded dependency stays contained:
  the drain logs and swallows every publish failure rather than rethrowing
  (`LiveChannelPublishProcessor.cs:47-51`), and returns quietly on host shutdown
  (`LiveChannelPublishProcessor.cs:41-45`), so a down Notification peer can never fail an Engagement
  command. The other consumer is the Notification host's gRPC ingress, which forwards a wire call onto
  the local SignalR publisher.
- **Caveats / not-in-source**: the interface itself makes no delivery or ordering guarantee; those are
  properties of the concrete SignalR, queue and gRPC wiring, not visible here.

### INotificationRecipientProvider
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/INotificationRecipientProvider.cs:8` · Level 0 · interface

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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:67`), which is
  the mechanical expression of "framework default, app override": whichever provider the app registers
  first wins, and the null default only fills the gap.
- **Where it's used**: [SendPushNotificationHandler](#sendpushnotificationhandler) takes it as a primary
  constructor dependency
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:19`),
  resolves the audience, then hands it to [IPushNotificationSender](#ipushnotificationsender). Until an
  app registers its own provider,
  [NullNotificationRecipientProvider](#nullnotificationrecipientprovider) returns an empty audience.

### IPushNotificationSender
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IPushNotificationSender.cs:7` · Level 0 · interface

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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:473`) so a host with no
  real-time transport still resolves the port; the SignalR wiring replaces it with `AddTransient` (same
  file, line 546), a deliberate override rather than a `TryAdd`.
- **Where it's used**: [SendPushNotificationHandler](#sendpushnotificationhandler) fans a message out
  through this port (`SendPushNotificationHandler.cs:20`) after persisting the
  [PushNotification](#pushnotification) record and its per-user
  [UserNotification](#usernotification) rows. That handler also carries a second, separate delivery leg,
  `INativePushSender` (`SendPushNotificationHandler.cs:21`), which is the OS-level channel of
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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs:25-26`),
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
  current user id and the optional scope (`NotificationInboxController.cs:114,123`), and dispatched
  through the injected `ICommandHandler<MarkAllNotificationsReadCommand, Result>`
  (`NotificationInboxController.cs:34`). Registered in DI at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:52-53`.

### UserNotificationExportItemDTO
> MMCA.ADC.Notification.Shared · `MMCA.ADC.Notification.Shared.UserNotifications` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/UserNotifications/UserNotificationExportItemDTO.cs:7` · Level 0 · record

- **What it is**: one notification-inbox row inside a user's *personal-data export* (the data-subject
  access artifact the XML doc ties to PRIVACY.md §7, `UserNotificationExportItemDTO.cs:4`): the
  notification id, title, and sent/read timestamps. This is an MMCA.ADC-specific contract, not a
  framework type.
- **Depends on**: the ADC `UserNotificationIdentifierType` alias; BCL `string` and `DateTime`. Returned by
  [IUserNotificationExportService](#iusernotificationexportservice); consumed by the Identity module's
  [NotificationUserDataExportSection](group-24-identity-module.md#notificationuserdataexportsection) and
  projected into
  [UserDataExportNotificationDTO](group-24-identity-module.md#userdataexportnotificationdto).
- **Concept introduced**: **export DTOs deliberately omit content.** The XML doc (line 5) records that the
  notification *body* is left out of the summary by design; the export carries the metadata a data
  subject is owed (that they were notified, when, whether they read it) without duplicating message
  bodies. `[Rubric §30, Compliance/Privacy/Data Governance]` assesses whether the codebase has concrete
  data-subject access and portability paths, and this DTO is the Notification module's contribution to
  that per-user export.
- **Walkthrough**: a `sealed record class` with `required NotificationId` (line 10), `required Title`
  (line 13), `required SentOn` (line 16, UTC), plus `IsRead` (line 19) and nullable `ReadOn` (line 22,
  null when unread). The `required` members force every export row to be fully populated at construction;
  the two optional members model the "never read" case without a sentinel date.
- **Why it's built this way**: a flat immutable record is the right shape for a serialized export line:
  value semantics, no behavior, self-describing timestamps in UTC. Being `init`-only means an export row
  cannot be edited after assembly.
- **Where it's used**: assembled by the in-process
  [UserNotificationExportService](#usernotificationexportservice) and returned across the export boundary
  to Identity; the disabled-module path substitutes
  [DisabledUserNotificationExportService](#disabledusernotificationexportservice) and the out-of-process
  path [UserNotificationExportServiceGrpcAdapter](#usernotificationexportservicegrpcadapter).

### IUserNotificationExportService
> MMCA.ADC.Notification.Shared · `MMCA.ADC.Notification.Shared.UserNotifications` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/UserNotifications/IUserNotificationExportService.cs:11` · Level 1 · interface

- **What it is**: the cross-module service contract for exporting the personal data the Notification
  module holds for one user: their inbox rows (ids, titles, sent and read dates). It is how the Identity
  module reaches into Notification-owned data to build a complete cross-service export.
- **Depends on**: [UserNotificationExportItemDTO](#usernotificationexportitemdto) (its return element) and
  the ADC `UserIdentifierType` alias. Implemented in-process by
  [UserNotificationExportService](#usernotificationexportservice) inside the Notification module
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/UserNotificationExportService.cs:15`)
  and, per the XML doc (`IUserNotificationExportService.cs:8-9`), by a gRPC adapter in
  `MMCA.ADC.Notification.Contracts` everywhere else; the disabled-module stub is
  [DisabledUserNotificationExportService](#disabledusernotificationexportservice).
- **Concept introduced**: **the "one interface, in-process or gRPC" extraction pattern.** The XML doc
  calls out that this mirrors Engagement's
  [IUserEngagementExportService](group-22-engagement-module.md#iuserengagementexportservice): a single
  interface the caller depends on, satisfied by an in-process implementation when the module is co-hosted
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/DependencyInjection.cs:28`)
  and by a gRPC adapter that `Replace`s that registration when it is not
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/DependencyInjection.cs:84`).
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
  (line 20), returning `IReadOnlyList<UserNotificationExportItemDTO>` newest-first. Note the token has
  **no default value** here, so every caller must pass one explicitly. The XML doc (lines 14-15) states
  the implementation joins the framework [UserNotification](#usernotification) rows with their
  [PushNotification](#pushnotification) content, which is the same join the inbox read performs.
- **Where it's used**: the Identity module wraps it in a per-section adapter,
  [NotificationUserDataExportSection](group-24-identity-module.md#notificationuserdataexportsection),
  which takes it as its single constructor dependency
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/NotificationUserDataExportSection.cs:18`),
  calls it (`NotificationUserDataExportSection.cs:29-31`) and projects the rows into the export document
  (`NotificationUserDataExportSection.cs:33-45`), unaware of which of the three implementations it
  received. `[Rubric §29, Resilience & Business Continuity]`: that section deliberately does **not** catch
  transport failures (`NotificationUserDataExportSection.cs:11-15`), because the export handler wraps
  every section and degrades an unreachable peer to one unavailable section rather than failing the whole
  export.

### NullNotificationRecipientProvider
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/NullNotificationRecipientProvider.cs:8` · Level 1 · class

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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:67`) means "safe
  by default, overridable without ceremony".
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
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/NotificationModule.cs:35`). Identity's
  export section still binds its dependency and simply gets no notification rows rather than a resolution
  failure.
- **Walkthrough**: `GetUserNotificationExportAsync` (lines 10-11) returns
  `Task.FromResult<IReadOnlyList<UserNotificationExportItemDTO>>([])`, ignoring both the `userId` and the
  token. Registered as a singleton (`NotificationModule.cs:35`), which is safe precisely because it holds
  no state.
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
  (`NotificationInboxController.cs:50,56`). The scope filter is explicitly **not** part of that boundary:
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
  because the `[Range]` attributes at the API boundary (`NotificationInboxController.cs:45-46`) do not
  protect a direct in-process caller.
- **Where it's used**: injected as a closed `IQueryHandler` into [InboxController](#inboxcontroller)
  (`NotificationInboxController.cs:31`), which is how it reaches the CQRS decorator pipeline described in
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
  (`NotificationInboxController.cs:32`), which serves the
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
  `ICommandHandler<MarkAllNotificationsReadCommand, Result>` (`NotificationInboxController.cs:34`) and
  invoked by the `PUT read-all` action (`NotificationInboxController.cs:124`), which returns 204 on
  success (`NotificationInboxController.cs:126`).

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

- **What it is**: the client request a native app (MAUI) sends to register or refresh *this* device
  for platform push delivery. It carries three strings: a client-generated stable `InstallationId`, a
  `Platform` discriminator, and the `PushChannel` platform handle (the FCM registration token or APNs
  device token).
- **Depends on**: nothing first-party. It uses `System.ComponentModel.DataAnnotations`
  (`[Required]`, `[MaxLength]`) from the BCL to bound the wire shape.
- **Concept introduced, the annotated request record.** This is the first push-side inbound contract,
  and it shows the framework's convention for a client-supplied DTO: a `sealed record` with `required
  init` members plus DataAnnotations that ASP.NET model-binding validates before a handler ever runs.
  Two `const string` platform values are published on the type itself, `FcmV1Platform = "fcmv1"`
  (`DeviceInstallationRequest.cs:15`) and `ApnsPlatform = "apns"`
  (`DeviceInstallationRequest.cs:18`), so the accepted platform tokens have one source of truth rather
  than being sprinkled as magic strings. `[Rubric §9, API & Contract Design]` assesses whether request
  contracts are explicit, bounded, and self-describing: the `[MaxLength(128/16/1024)]` caps
  (`DeviceInstallationRequest.cs:22,27,32`) pin the column and payload sizes right on the contract.
  `[Rubric §11, Security]` is visible in the doc comment's design rule (`DeviceInstallationRequest.cs:5-11`):
  ownership is stamped server-side from the authenticated user and is deliberately *not* a field on this
  request, so a client cannot register a device against someone else's account.
- **Walkthrough**: two platform constants (lines 15, 18), then three `required string` init members,
  `InstallationId` (line 23), `Platform` (line 28), and `PushChannel` (line 33), each with `[Required]`
  and a `[MaxLength]` cap. The `InstallationId` is client-stable by design so that re-registering after
  a token rotation updates the same installation rather than creating a duplicate.
- **Why it's built this way**: the doc comment attributes the shape to [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) (native push
  registration). A stable client id plus a rotating platform channel is the standard installation model
  both FCM v1 and APNs expect, and keeping ownership server-stamped keeps the trust boundary at the
  authenticated request.
- **Where it's used**: the device-registration endpoint on the push pipeline in
  `MMCA.Common.Infrastructure` (the SignalR/native push senders, see the group overview).

### MarkNotificationReadCommand
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkRead` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkRead/MarkNotificationReadCommand.cs:6` · Level 0 · record (sealed)

- **What it is**: the CQRS command to mark a single inbox notification as read for the current user. A
  two-parameter positional record: the `NotificationId` to mark and the `UserId` that must own it
  (`MarkNotificationReadCommand.cs:6-8`).
- **Depends on**: nothing first-party. It uses the `UserNotificationIdentifierType` and
  `UserIdentifierType` aliases (`MarkNotificationReadCommand.cs:7-8`), which are solution-wide `global
  using ... = int;` aliases linked via `Directory.Build.props`, so there is no first-party type edge.
- **Concept, a command carrying its own authorization key.** Unlike a request DTO, a command is the
  input to a [handler](#marknotificationreadhandler) in the CQRS pipeline (see
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)). The load-bearing
  detail is that `UserId` is part of the command, not looked up loosely later: the handler filters on it
  to enforce ownership. `[Rubric §6, CQRS & Event-Driven]` assesses whether writes flow through explicit
  command messages; this is the minimal shape of one.
- **Walkthrough**: two positional parameters (`MarkNotificationReadCommand.cs:6-8`). No decorators are
  declared on the type (no `ITransactional`/`ICacheInvalidating` marker interfaces), so it rides the
  default command pipeline unadorned.
- **Where it's used**: handled by [MarkNotificationReadHandler](#marknotificationreadhandler); the
  authenticated `UserId` is supplied by the controller from the token claim, never by the client body.

### NotificationFeatures
> MMCA.Common.Shared · `MMCA.Common.Shared.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/NotificationFeatures.cs:6` · Level 0 · class (static)

- **What it is**: the feature-flag key constants for the Notification module. Today it holds exactly
  one: `PushNotifications = "Notification.PushNotifications"` (`NotificationFeatures.cs:9`).
- **Depends on**: nothing first-party.
- **Concept, feature flags as named constants.** `[Rubric §10, Cross-Cutting Concerns]` assesses
  whether cross-cutting config lives in one place rather than copy-pasted string literals. Defining the
  flag key once as a `const string` keeps every gate that references it typo-free; the value is resolved
  at runtime by the feature-management layer that the `FeatureGate` command/query decorators consult
  (the outermost decorator in the CQRS pipeline, see
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Walkthrough**: one `public const string` on a `static` class (`NotificationFeatures.cs:6-10`).
- **Where it's used**: wherever push behavior is conditionally enabled, both the Notification handlers
  gated by the feature and the UI that hides push affordances when the flag is off.

### PushNotificationStatus
> MMCA.Common.Domain · `MMCA.Common.Domain.Notifications.PushNotifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotificationStatus.cs:6` · Level 0 · enum

- **What it is**: the delivery lifecycle status of a push notification: `Pending`, `Sent`, `Failed`.
- **Depends on**: nothing first-party.
- **Concept**: a domain lifecycle enum owned by the [PushNotification](#pushnotification) aggregate.
  Its members are unnumbered (`PushNotificationStatus.cs:9-15`), so the ordinal is implicit (`Pending`
  = 0); the value is persisted and read within a single store, so a pinned numeric contract is not
  required here. `[Rubric §4, DDD]` assesses whether state is modeled explicitly rather than as loose
  booleans; a three-state enum captures the send outcome precisely.
- **Walkthrough**: three members with the obvious transition, `Pending` moves to either `Sent` or
  `Failed`, driven by the aggregate's `MarkAsSent`/`MarkAsFailed` methods.
- **Where it's used**: the private-set `Status` property on [PushNotification](#pushnotification);
  surfaced (as its string name) on [PushNotificationDTO](#pushnotificationdto).

### SendPushNotificationRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Notifications.PushNotifications` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/PushNotifications/SendPushNotificationRequest.cs:6` · Level 0 · record (sealed)

- **What it is**: the broadcast request to push a notification to every recipient. A two-parameter
  positional record: `sealed record SendPushNotificationRequest(string Title, string Body)`
  (`SendPushNotificationRequest.cs:6`).
- **Depends on**: nothing first-party.
- **Concept**: a `sealed record` message DTO. A class-based record is the natural choice for a body
  that is not on a perf-sensitive hot path and reads as a message (contrast the `readonly record struct`
  payloads used on the auth hot path). `[Rubric §9, API & Contract Design]`: the minimal explicit
  contract for the send endpoint.
- **Walkthrough**: two positional parameters (line 6); no validation attributes here, the content
  invariants (title/body length) are enforced downstream by the
  [PushNotification](#pushnotification) aggregate's `Create` factory.
- **Where it's used**: the send endpoint on the push pipeline; the handler resolves recipients via
  [INotificationRecipientProvider](#inotificationrecipientprovider), builds a
  [PushNotification](#pushnotification), and fans out to the SignalR sender in Infrastructure.

### UserNotificationDTO
> MMCA.Common.Shared · `MMCA.Common.Shared.Notifications.UserNotifications` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/UserNotifications/UserNotificationDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: the read DTO for one item in a user's notification inbox. It merges the user's
  read-tracking (`IsRead`, `ReadOn`) with the underlying push content (`Title`, `Body`, `SentOn`) into
  the single shape the inbox UI renders.
- **Depends on**: nothing first-party. It uses the `UserNotificationIdentifierType` and
  `PushNotificationIdentifierType` aliases (`UserNotificationDTO.cs:10,13`), which are `global using
  ... = int;` aliases, so there is no first-party edge.
- **Concept, strongly-typed identifier aliases in a DTO.** `[Rubric §4, DDD]` assesses avoiding
  primitive obsession: the `Id` is typed `UserNotificationIdentifierType` and the foreign key
  `PushNotificationId` is typed `PushNotificationIdentifierType`, so the *names* carry intent even though
  both currently resolve to `int`. Change the alias in one file and every usage updates (see
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Walkthrough**: a `sealed record class` with `required init` values that must always be present,
  `Id`, `PushNotificationId`, `Title`, `Body`, `IsRead` (`UserNotificationDTO.cs:10-22`), plus plain
  `init` members for the nullable `ReadOn?` (line 25) and the always-present `SentOn` (line 28).
  `required` + `init` gives set-once, non-null-where-it-matters immutability without a hand-written
  constructor.
- **Why it's built this way**: the DTO flattens two persistence concepts (the per-user read row and
  the shared push content) into the one row the inbox needs `[Rubric §9]`, mirroring the two-table join
  the read handler performs.
- **Where it's used**: returned by the inbox query [GetMyNotificationsHandler](#getmynotificationshandler);
  note the ADC export path uses a separate `UserNotificationExportItemDTO` shape instead.

### AttendeeNotificationRecipientProvider
> MMCA.ADC.Notification.Application · `MMCA.ADC.Notification.Application` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/AttendeeNotificationRecipientProvider.cs:10` · Level 1 · class (sealed)

- **What it is**: the ADC-specific implementation of the framework's
  [INotificationRecipientProvider](#inotificationrecipientprovider) boundary. It answers the question
  "who are the recipients of a broadcast push?" with "every attendee," by delegating to the Identity
  module's attendee query.
- **Depends on**: [INotificationRecipientProvider](#inotificationrecipientprovider) (implements it) and
  [IAttendeeQueryService](group-24-identity-module.md#iattendeequeryservice) (constructor-injected).
- **Concept introduced, the app-supplied recipient strategy.** The framework defines *what* a recipient
  provider must return but deliberately does not decide *who* recipients are, that is an application
  policy each host plugs in. This is the `[Rubric §1, SOLID]` dependency-inversion story in miniature:
  `MMCA.Common` owns the [INotificationRecipientProvider](#inotificationrecipientprovider) abstraction,
  and ADC provides the concrete "all attendees" rule. `[Rubric §3, Clean Architecture]` is why the class
  lives in ADC's module rather than in Common: recipient policy is business-specific and must not leak
  into the reusable framework.
- **Walkthrough**: a primary-constructor class taking `IAttendeeQueryService`
  (`AttendeeNotificationRecipientProvider.cs:10-11`). Its single method
  `GetRecipientUserIdsAsync` (lines 14-16) is a one-line `await` forwarding to
  `attendeeQueryService.GetAttendeeUserIdsAsync`, an expression-bodied delegation with no added logic.
- **Why it's built this way**: keeping the provider a thin bridge means the "who is a recipient"
  decision has exactly one place to change, and the Identity module stays the owner of the attendee
  roster.
- **Where it's used**: registered in the Notification module's
  [DependencyInjection](#dependencyinjection) as the `INotificationRecipientProvider` implementation;
  consumed by the send handler when it fans a broadcast out to per-user rows.

### PushNotificationDTO
> MMCA.Common.Shared · `MMCA.Common.Shared.Notifications.PushNotifications` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/PushNotifications/PushNotificationDTO.cs:8` · Level 1 · record class

- **What it is**: the read DTO for a persisted [PushNotification](#pushnotification): id, title, body,
  the sender, the recipient count, a delivery-status string, and the creation timestamp.
- **Depends on**: [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)
  (implements `IBaseDTO<PushNotificationIdentifierType>`, `PushNotificationDTO.cs:8`).
- **Concept**: the standard `IBaseDTO` read-model shape (see
  [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)). Note that
  `Status` is a `string` (`PushNotificationDTO.cs:26`) even though the domain uses the
  [PushNotificationStatus](#pushnotificationstatus) enum: the DTO carries the serialized form so the API
  surface can evolve independently of the domain enum and stays readable in responses without a separate
  enum-to-string step. `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: `required init` members for the id, title, body, `SentByUserId`, `RecipientCount`,
  and `Status` (`PushNotificationDTO.cs:11-26`), plus a plain `init` `CreatedOn` (line 29).
- **Where it's used**: returned by the notification-history query and rendered on the organizer's
  push-notification admin view.

### PushNotification
> MMCA.Common.Domain · `MMCA.Common.Domain.Notifications.PushNotifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:14` · Level 5 · class (sealed)

- **What it is**: the framework-level aggregate root for a push-notification broadcast. It records the
  title, body, sender, recipient count, and delivery status, and it raises a domain event on creation so
  the send/fan-out machinery can react.
- **Depends on**:
  [AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (base class), `PushNotificationInvariants` (validation), [PushNotificationStatus](#pushnotificationstatus)
  (status), the `PushNotificationCreated` domain event, and [Result](group-01-result-error-handling.md#result)
  (factory return). It carries the [IdValueGeneratedAttribute](group-02-domain-building-blocks.md#idvaluegeneratedattribute)
  (`PushNotification.cs:13`).
- **Concept**: the aggregate-root factory idiom applied to a framework-owned entity (the canonical
  entity-chain teaching is [Group 02](group-02-domain-building-blocks.md)). Two design choices are worth
  naming. First, `[IdValueGenerated]` (`PushNotification.cs:13`) tells the persistence layer the
  database generates the id, so `Create` sets `Id = default` (line 72) and lets SQL Server fill the
  `IDENTITY`. Second, only `Create` raises a domain event, the state mutators do not, which is the
  `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §4, DDD]` distinction between a business-observable
  fact (a notification was created) and an internal delivery bookkeeping flip.
- **Walkthrough**: five `private set` properties, `Title`, `Body`, `SentByUserId`, `RecipientCount`,
  `Status` (`PushNotification.cs:17-29`). A private parameterless constructor (lines 32-36) seeds
  non-null strings for EF materialization; a private all-args constructor (lines 38-45) sets `Status =
  Pending` (line 44). The static `Create` factory (lines 56-78) combines the title and body invariants
  via `Result.Combine` (lines 62-64), returns a [Result.Failure](group-01-result-error-handling.md#result)
  on any broken invariant (lines 65-68), constructs the entity with `Id = default` (lines 70-73), and
  raises `PushNotificationCreated` (line 75) before returning success. `MarkAsSent` and `MarkAsFailed`
  (lines 83, 88) are one-line expression-bodied `void` transitions with no event, they record the
  delivery outcome for audit.
- **Why it's built this way**: living in `MMCA.Common.Domain`, this aggregate is reused by both ADC and
  Store without coupling to any app's module. The `Pending` to `Sent`/`Failed` bookkeeping is
  intentionally event-free because it is an infrastructure callback, not a business decision.
- **Where it's used**: created by the send handler (one per broadcast), which then fans out a
  [UserNotification](#usernotification) per recipient; read back through
  [PushNotificationDTO](#pushnotificationdto).

### MarkNotificationReadHandler
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkRead` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkRead/MarkNotificationReadHandler.cs:12` · Level 8 · class (sealed)

- **What it is**: the command handler that marks one inbox notification as read, but only if it belongs
  to the requesting user.
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (repository + save),
  [IQueryableExecutor](group-07-persistence-ef-core.md#iqueryableexecutor) (async materialization),
  `TimeProvider` (BCL, testable clock), [MarkNotificationReadCommand](#marknotificationreadcommand)
  (input), and [Result](group-01-result-error-handling.md#result) / [Error](group-01-result-error-handling.md#error)
  (outcome).
- **Concept, ownership enforced in the query, not after it.** `[Rubric §11, Security]` assesses whether
  authorization is enforced where the data is touched. This handler never loads a row by id and then
  checks the owner in memory; it filters on both `Id` and `UserId` in the same predicate
  (`MarkNotificationReadHandler.cs:26`), so a mismatched owner simply returns zero rows and the handler
  answers `NotFound` (lines 30-36) rather than leaking that the notification exists for someone else.
  `[Rubric §14, Testability]` shows in the injected `TimeProvider`: the read timestamp comes from
  `timeProvider.GetUtcNow().UtcDateTime` (line 38), not `DateTime.UtcNow`, so a test can pin the clock.
- **Walkthrough**: `HandleAsync` (lines 18-42) gets the `UserNotification` repository from the unit of
  work (line 22), builds a `Where(Id && UserId).Take(1)` query and materializes it through the queryable
  executor (lines 24-28), returns a `NotFound` failure (`"UserNotification.NotFound"`) when there is no
  match (lines 30-36), otherwise calls the aggregate's idempotent `MarkAsRead(...)` with the injected UTC
  time (line 38), saves through the unit of work (line 39), and returns success (line 41). Every await
  uses `ConfigureAwait(false)`.
- **Why it's built this way**: the `Take(1)` + owner-scoped filter is the cheapest safe read; the
  aggregate keeps the idempotency (a repeated mark is a no-op), so the handler stays a thin orchestrator.
- **Where it's used**: dispatched by the inbox controller's mark-read action, with the authenticated
  user id supplied server-side.

### UserNotificationExportService
> MMCA.ADC.Notification.Application · `MMCA.ADC.Notification.Application` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/UserNotificationExportService.cs:15` · Level 8 · class (sealed)

- **What it is**: the Notification half of ADC's cross-service data-subject export (PRIVACY.md §7). It
  returns every notification row for one user, joined to its push content, unpaged and newest-first, so
  Identity's export aggregator can include a person's inbox in their downloadable data.
- **Depends on**: `IUserNotificationExportService` (implements it, the interface lives in
  `MMCA.ADC.Notification.Shared`), [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork),
  [IQueryableExecutor](group-07-persistence-ef-core.md#iqueryableexecutor), the framework
  [UserNotification](#usernotification) and [PushNotification](#pushnotification) entities, and the
  `UserNotificationExportItemDTO` projection.
- **Concept, the privacy/GDPR export read.** `[Rubric §30, Compliance/Privacy/Data Governance]`
  assesses whether a person can obtain the data held about them; this is one section of that document.
  The service performs the same join as the inbox query but strips paging and always constrains to the
  requested user's rows (`UserNotificationExportService.cs:29`), so it can never return another
  subject's data. `[Rubric §12, Performance & Scalability]` shows in the two `TableNoTracking` reads
  (lines 27-28): the export is read-only, so change tracking is disabled.
- **Walkthrough**: `GetUserNotificationExportAsync` (lines 20-42) gets both repositories from the unit
  of work (lines 24-25), builds a LINQ join of `UserNotification` to `PushNotification` on
  `PushNotificationId` (lines 27-28), filters `where un.UserId == userId` and orders by `pn.CreatedOn
  descending` (lines 29-30), projects into `UserNotificationExportItemDTO` (lines 31-38), materializes
  through the queryable executor (line 40), and returns a fresh list via a collection expression
  (line 41).
- **Why it's built this way**: reusing the inbox join keeps the export consistent with what the user
  sees in-app, while the no-tracking, unpaged read matches a one-shot export rather than an interactive
  page.
- **Where it's used**: registered by the Notification module's
  [DependencyInjection](#dependencyinjection) as the in-process
  `IUserNotificationExportService`; consumed by Identity's export aggregation over the cross-module
  interface (in-process when co-hosted, cross-process via the Notification service's gRPC ingress when
  extracted).

### DependencyInjection
> MMCA.ADC.Notification.Application · `MMCA.ADC.Notification.Application` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/DependencyInjection.cs:12` · Level 9 · class (static)

- **What it is**: the Notification module's application-layer DI composition. Its single extension
  method `AddModuleNotificationApplication` wires ADC's recipient policy and export service, then pulls
  in the framework's shared notification handlers.
- **Depends on**: [ApplicationSettings](group-14-module-system-composition.md#applicationsettings)
  (parameter), [INotificationRecipientProvider](#inotificationrecipientprovider) +
  [AttendeeNotificationRecipientProvider](#attendeenotificationrecipientprovider),
  `IUserNotificationExportService` + [UserNotificationExportService](#usernotificationexportservice),
  and the framework's `AddNotificationApplicationServices()` registration.
- **Concept, the `extension(IServiceCollection)` registration block.** DI wiring here uses the C#
  preview extension-member syntax (`DependencyInjection.cs:14`), which lets the framework add methods
  directly to `IServiceCollection` (taught in the
  [primer](00-primer.md#2-architectural-styles-this-codebase-commits-to)). `[Rubric §3, Clean
  Architecture]` is visible in the split of responsibility: the module registers its *app-specific*
  choices (attendees as recipients, the export service) and then calls the framework's
  `AddNotificationApplicationServices()` (line 31) for the reusable handlers, mapper, validator, and
  entity query service, so shared and app-specific wiring stay separate.
- **Walkthrough**: `AddModuleNotificationApplication` (lines 19-34) discards the unused
  `applicationSettings` (line 21, reserved for future use), registers
  [AttendeeNotificationRecipientProvider](#attendeenotificationrecipientprovider) as the scoped
  `INotificationRecipientProvider` (line 24), registers
  [UserNotificationExportService](#usernotificationexportservice) as the scoped
  `IUserNotificationExportService` for the privacy export (line 28), calls the framework's
  `AddNotificationApplicationServices()` (line 31), and returns the collection for chaining (line 33).
- **Where it's used**: called from the Notification service host's composition root during module
  registration.

### LiveChannelGrpcService
> MMCA.ADC.Notification.Service · `MMCA.ADC.Notification.Service.Grpc` · `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/LiveChannelGrpcService.cs:22` · Level 1 · class (sealed)

- **What it is**: the gRPC **server** endpoint that other services call to fan an ephemeral "live"
  event out to connected clients. It implements the generated
  `LiveChannelPushService.LiveChannelPushServiceBase` and delegates each call to the framework's
  [ILiveChannelPublisher](#ilivechannelpublisher).
- **Depends on**: [ILiveChannelPublisher](#ilivechannelpublisher) (injected via the primary
  constructor, `LiveChannelGrpcService.cs:22`; in this host it resolves to
  [SignalRLiveChannelPublisher](#signalrlivechannelpublisher), registered by `AddPushNotifications`
  because Notification is the host that maps the SignalR [NotificationHub](#notificationhub)), the
  generated `LiveChannelPushService` base (compiled from the `.Contracts` `.proto`,
  `LiveChannelGrpcService.cs:23`), and `Grpc.Core.ServerCallContext`.
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
  endpoint is mapped without `RequireAuthorization` (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:280`).
  `[Rubric §11, Security]`: the doc comment (`LiveChannelGrpcService.cs:13-20`) gives two reasons. First,
  this surface is reachable only on the internal service network (a dedicated internal port in Azure
  Container Apps, never routed by the Gateway), the same posture as the other internal gRPC services (it
  names `BookmarkCountsGrpcService`). Second, authorization is **not addable** here: the publishing
  caller is Engagement's `LiveChannelPublishProcessor` background drain, which runs with no `HttpContext`
  and therefore forwards no bearer token. Transport-wise it rides the [ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html) mixed-endpoint
  profile: Notification keeps its default endpoint `Http1AndHttp2` for SignalR WebSockets
  (`Program.cs:71`) and serves this h2c gRPC ingress on a dedicated `Http2`-only endpoint named `grpc`
  (`Program.cs:56-66`).
- **Where it's used**: mapped by the Notification service's `Program.cs` (`Program.cs:280`); invoked by
  [LiveChannelPublisherGrpcAdapter](#livechannelpublishergrpcadapter) running inside Engagement.

---

### NullLiveChannelPublisher
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullLiveChannelPublisher.cs:11` · Level 1 · class (sealed)

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
  (`NullLiveChannelPublisher.cs:14`), whose whole body is `=> Task.CompletedTask`
  (`NullLiveChannelPublisher.cs:15`). No exception, no logging, no work.
- **Why it's built this way**: the class doc comment (`NullLiveChannelPublisher.cs:5-10`) states the
  contract: downstream apps override this with
  [SignalRLiveChannelPublisher](#signalrlivechannelpublisher) via `AddPushNotifications()`, or with their
  own transport (in ADC, a gRPC adapter that forwards to the host that maps the hub). Because the default
  resolves cleanly, no host is *forced* to configure a real-time transport
  ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html), live channels are best-effort by design).
- **Where it's used**: registered as the framework default with
  `services.TryAddTransient<ILiveChannelPublisher, NullLiveChannelPublisher>()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:474`) so the port is always
  resolvable; `AddPushNotifications` appends the SignalR implementation over it
  (`DependencyInjection.cs:547`), and in ADC Engagement's composition root `services.Replace(...)`
  overwrites it with the [LiveChannelPublisherGrpcAdapter](#livechannelpublishergrpcadapter) (see the
  Notification.Contracts DI section at the end of this chapter).

---

### NullPushNotificationSender
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullPushNotificationSender.cs:10` · Level 1 · class (sealed)

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
  (`NullPushNotificationSender.cs:13`), `SendToUsersAsync` (`NullPushNotificationSender.cs:17`), and
  `BroadcastAsync` (`NullPushNotificationSender.cs:21`). Together they mirror the full
  `IPushNotificationSender` surface (single user, batch, broadcast) so the interface is satisfied without
  behavior.
- **Why it's built this way**: the doc comment (`NullPushNotificationSender.cs:5-9`) notes downstream
  apps override this with [SignalRPushNotificationSender](#signalrpushnotificationsender) via
  `AddPushNotifications()`. The send handler always calls the port; whether anything reaches a browser is
  a composition-root decision.
- **Where it's used**: registered as the default `IPushNotificationSender` by `AddInfrastructure`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:473`); superseded by the
  SignalR sender in any host that calls `AddPushNotifications` (`DependencyInjection.cs:546`).

---

### SendPushNotificationCommand
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationCommand.cs:11` · Level 1 · record (sealed)

- **What it is**: the CQRS command that triggers a push-notification broadcast. It wraps a
  [SendPushNotificationRequest](#sendpushnotificationrequest) plus the sender's `UserIdentifierType`, and
  carries an optional deduplication key.
- **Depends on**:
  [ICommandWithRequest<out TRequest>](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  (Level 0), [SendPushNotificationRequest](#sendpushnotificationrequest) (Level 0).
- **Concept**: the *command-wraps-request* idiom (see
  [ICommandWithRequest<out TRequest>](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), G05).
  The public HTTP request is the small `Title`/`Body`/`ScopeKey` record; the command additionally carries
  server-derived context (`SentByUserId`, taken from the caller's token, not the body) so the client
  cannot spoof the sender. Exposing `Request` satisfies the
  `ICommandWithRequest<SendPushNotificationRequest>` contract, which lets the generic validating command
  decorator run [SendPushNotificationRequestValidator](#sendpushnotificationrequestvalidator)
  automatically in the pipeline. `[Rubric §6, CQRS & Event-Driven]`, `[Rubric §11, Security]`.
- **Walkthrough**: a two-parameter positional record implementing
  `ICommandWithRequest<SendPushNotificationRequest>` (`SendPushNotificationCommand.cs:11-13`), plus one
  body member.
  - `Request` (`SendPushNotificationCommand.cs:12`) is the validated DTO; `SentByUserId`
    (`SendPushNotificationCommand.cs:13`) is the audit/authorization context.
  - `DedupKey` (`SendPushNotificationCommand.cs:22`), an `init`-only `string?`, is the optional
    deduplication key, typically the caller's `Idempotency-Key` header. Its doc comment
    (`SendPushNotificationCommand.cs:15-21`) states the contract: when present, a send whose key has
    already been seen returns the existing notification instead of creating a second one and sending
    again; when null (the default every existing caller gets) the send behaves exactly as before.
    `[Rubric §29, Resilience & Business Continuity]` assesses whether a retry is safe: this property is
    what makes a retried broadcast at-most-once at the delivery level (see the matching logic in
    [SendPushNotificationHandler](#sendpushnotificationhandler)). It complements, and is distinct from,
    the HTTP-level [IdempotentAttribute](group-12-api-hosting-mapping.md#idempotentattribute) response
    cache ([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)).
- **Where it's used**: dispatched by the push-notification API endpoint (the organizer-only
  [NotificationsController](#notificationscontroller)); handled by
  [SendPushNotificationHandler](#sendpushnotificationhandler).

---

### SmtpEmailSender
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/SmtpEmailSender.cs:12` · Level 1 · class (sealed)

- **What it is**: the SMTP adapter for the [IEmailSender](#iemailsender) port. It sends mail through a
  `System.Net.Mail.SmtpClient` configured from
  [ISmtpSettings](group-14-module-system-composition.md#ismtpsettings). This is the entire "email
  channel" of the notification subsystem, independent of the push/inbox flow.
- **Depends on**: [IEmailSender](#iemailsender) (Level 0);
  [ISmtpSettings](group-14-module-system-composition.md#ismtpsettings) (Level 0, injected via the primary
  constructor, `SmtpEmailSender.cs:12`). Externals: `System.Net.Mail` (`SmtpClient`, `MailMessage`) and
  `System.Net` (`NetworkCredential`).
- **Concept introduced, the settings-bound infrastructure adapter.** `[Rubric §3, Clean Architecture]`
  assesses whether transport detail stays at the edge: the port `IEmailSender` lives in Application, and
  this SMTP concretion lives in Infrastructure, so nothing above it knows what "email" is made of.
  `[Rubric §10, Cross-Cutting Concerns]`: host, port, and credentials come from bound configuration
  (`ISmtpSettings`), never hard-coded, so the same code targets a real relay in production and the Aspire
  **MailDev** container locally (SMTP `localhost:1025`, web inbox `http://localhost:1080`).
- **Walkthrough**: the primary constructor copies seven settings into readonly fields (`_host`, `_port`,
  `_username`, `_password`, `_fromAddress`, `_toAddress`, `_enableSsl`, `SmtpEmailSender.cs:14-20`).
  - `SendAsync(to, subject, body, isHtml, cancellationToken)` (`SmtpEmailSender.cs:23`): guards each
    string with `ArgumentException.ThrowIfNullOrEmpty` (`SmtpEmailSender.cs:25-27`), then constructs a
    fresh `SmtpClient` with `NetworkCredential` and `EnableSsl` inside a `using`
    (`SmtpEmailSender.cs:30-34`, wrapped in a justified `#pragma warning disable S5332` at
    `SmtpEmailSender.cs:29` and `:35` because `EnableSsl` is config-driven and local dev targets MailDev,
    which does not offer TLS), builds a `MailMessage` (also `using`, `SmtpEmailSender.cs:37-40`), and
    awaits `SendMailAsync(message, cancellationToken)` (`SmtpEmailSender.cs:42`). The doc comment
    (`SmtpEmailSender.cs:8-11`) is explicit that a new client is created and disposed **per send**, no
    pooled long-lived connection.
  - `SendAsync(subject, body, isHtml, cancellationToken)` (`SmtpEmailSender.cs:53`): a convenience
    overload that sends to the default `_toAddress` from settings (`SmtpEmailSender.cs:54`), for
    admin/system mail with no explicit recipient.
- **Why it's built this way**: a per-send client keeps the sender stateless and thread-safe with no
  connection lifecycle to manage, acceptable for the low volume of system/admin mail this channel
  carries. Unlike push, email has **no** null-object default: `SmtpEmailSender` itself is what
  `AddInfrastructure` registers as `IEmailSender`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:472`), so a host that never
  configures SMTP settings still resolves a real sender that will fail at send time rather than silently
  no-op.
- **Where it's used**: injected as `IEmailSender` by callers (the port, not this class). It is not called
  from the push/inbox send flow.

---

### DependencyInjection
> MMCA.ADC.Notification.API · `MMCA.ADC.Notification.API` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:13` · Level 2 · class (static, `extension(IServiceCollection)`)

- **What it is**: the ADC Notification module's composition root. Its single `AddNotificationModule`
  method assembles the full module registration by chaining the Application, Infrastructure, push,
  native-push, and controller wiring in one call. (This is distinct from the Notification.Contracts
  `DependencyInjection` covered at the end of this chapter, which wires the consumer-side gRPC clients,
  and from the Common API/Application ones: all of them keep the raw type name as their heading.)
- **Depends on**: [ApplicationSettings](group-14-module-system-composition.md#applicationsettings)
  (Level 1); the Common API notification-controllers extension (`AddNotificationControllers`); the ADC
  Application facade (`AddModuleNotificationApplication`); the Common Infrastructure extensions
  `AddNotificationInfrastructure`, `AddPushNotifications`, and `AddNativePushNotifications`. Externals:
  `Microsoft.Extensions.DependencyInjection`, `Microsoft.Extensions.Configuration`.
- **Concept, layered DI composition with `extension(IServiceCollection)`.** `[Rubric §5, Vertical
  Slice]` assesses whether a feature owns its own end-to-end wiring: this one method registers the
  module's Application handlers, Infrastructure EF configs, real-time transport, OS-level native push,
  and REST controllers together, so a host adds the whole slice with a single call. `[Rubric §7,
  Microservices Readiness]`: this class is the boundary where the shared push framework becomes ADC's
  concrete behavior, which is what lets the module boot standalone in `MMCA.ADC.Notification.Service`.
- **Walkthrough**: the `extension(IServiceCollection services)` block (`DependencyInjection.cs:15`) holds
  one method, `AddNotificationModule(ApplicationSettings applicationSettings, IConfiguration
  configuration)` (`DependencyInjection.cs:21`), which runs five registrations in order and returns the
  collection (`DependencyInjection.cs:23-34`):
  1. `AddModuleNotificationApplication(applicationSettings)` (`DependencyInjection.cs:23`), the ADC
     Application facade. Order is load-bearing there: it registers
     [AttendeeNotificationRecipientProvider](#attendeenotificationrecipientprovider) and
     [UserNotificationExportService](#usernotificationexportservice)
     (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/DependencyInjection.cs:24`
     and `:28`) *before* calling Common's `AddNotificationApplicationServices()` (`:31`), whose recipient
     default is a `TryAddScoped<INotificationRecipientProvider, NullNotificationRecipientProvider>`
     (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:66-67`), so
     the ADC recipient source stays in place.
  2. `AddNotificationInfrastructure()` (`DependencyInjection.cs:24`), the Common Infrastructure extension
     that registers the assembly holding the EF configurations for the two notification aggregates
     (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:513-518`).
  3. `AddPushNotifications(configuration)` (`DependencyInjection.cs:25`), which binds
     [PushNotificationSettings](group-14-module-system-composition.md#pushnotificationsettings), calls
     `AddSignalR()`, adds the Redis backplane when a `redis` connection string is present, and appends
     the SignalR adapters over the null defaults
     (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:528-550`).
  4. `AddNativePushNotifications(configuration)` (`DependencyInjection.cs:29`), the [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) third channel: a
     **no-op unless** the `NativePush` config section is enabled and complete (inline comment
     `DependencyInjection.cs:27-28`), so it is safe to call in every environment.
  5. `services.AddControllers().AddNotificationControllers()` (`DependencyInjection.cs:32`), splicing the
     Common notification controllers in as MVC application parts so ASP.NET Core routing can discover
     them.
- **Why it's built this way**: keeping the ordering (the ADC provider before Common's `TryAdd*` defaults;
  controllers registered as an application part because they ship in a NuGet assembly; native push added
  defensively as a safe no-op) inside one named method means the host `Program.cs` stays clean and the
  sequence cannot drift per service.
- **Where it's used**: called by [NotificationModule](#notificationmodule)'s `Register`, which the
  [ModuleLoader](group-14-module-system-composition.md#moduleloader) invokes at startup.

---

### NotificationHub
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Hubs` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Hubs/NotificationHub.cs:17` · Level 2 · class (sealed)

- **What it is**: the SignalR hub that anchors the group's real-time transport. It is deliberately thin:
  it maps authenticated connections and manages channel (SignalR group) membership. It does not itself
  construct or fan out messages, that work lives in
  [SignalRPushNotificationSender](#signalrpushnotificationsender) and
  [SignalRLiveChannelPublisher](#signalrlivechannelpublisher), both of which push through
  `IHubContext<NotificationHub>` (doc comment `NotificationHub.cs:10-15`).
- **Depends on**: [PushNotificationSettings](group-14-module-system-composition.md#pushnotificationsettings)
  (read through `IOptions<T>` for the channel-key pattern); externals `Microsoft.AspNetCore.SignalR` (the
  `Hub` base class, `Groups`, `Context`, `HubException`, `[HubMethodName]`),
  `Microsoft.AspNetCore.Authorization` (`[Authorize]`), `Microsoft.Extensions.Options` (`IOptions<T>`),
  and the BCL `System.Text.RegularExpressions.Regex` plus `System.Collections.Concurrent.ConcurrentDictionary`.
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
    `[HubMethodName(JoinChannelMethod)]` (`NotificationHub.cs:43`), it validates the key then calls
    `Groups.AddToGroupAsync(Context.ConnectionId, channelKey)` (`NotificationHub.cs:46-47`).
  - `LeaveChannelAsync(string channelKey)` (`NotificationHub.cs:55`):
    `[HubMethodName(LeaveChannelMethod)]` (`NotificationHub.cs:54`), validates then
    `Groups.RemoveFromGroupAsync(...)` (`NotificationHub.cs:57-58`).
  - `EnsureValidChannelKey` (`NotificationHub.cs:61`): `GetOrAdd`s the cached `Regex` for
    `settings.Value.ChannelKeyPattern` (`NotificationHub.cs:63-65`); an empty or non-matching key throws
    `HubException("Invalid channel key.")` (`NotificationHub.cs:67-70`), which SignalR surfaces to the
    caller rather than tearing down the connection.
- **Why it's built this way**: routing delivery through `IHubContext` instead of hub instance methods
  lets the framework construct and send messages from anywhere (background senders, a gRPC ingress)
  without holding a live hub instance, and it is the shape SignalR scale-out (a Redis backplane) expects.
  The thin hub plus a configured channel-key pattern is the framework default; the pattern lives in
  [PushNotificationSettings](group-14-module-system-composition.md#pushnotificationsettings) so a host
  tunes which channels exist without touching code.
- **Where it's used**: mapped by a consuming host as a SignalR endpoint (in ADC, the Notification
  service); driven by [SignalRPushNotificationSender](#signalrpushnotificationsender) (per-user
  notification delivery) and [SignalRLiveChannelPublisher](#signalrlivechannelpublisher) (ephemeral
  channel events), both via `IHubContext<NotificationHub>`. `AddPushNotifications` registers the
  `IUserIdProvider` (`ClaimBasedUserIdProvider`) that maps a connection's claims to the user id the
  sender addresses (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:548`).
- **Caveats / not-in-source**: the concrete hub route path is set in host composition, not in this file.
  Not determinable from source here.

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
  `Title`, and `RecipientCount` (`PushNotificationCreated.cs:11-14`). Note the doc comment on
  `NotificationId` (`PushNotificationCreated.cs:8`), "default until persisted": the aggregate id is
  database-generated, so at `Create` time it is still `default`; the event captures intent, not the
  assigned key.
- **Walkthrough**: a positional `sealed record class` with three parameters, `NotificationId`, `Title`,
  `RecipientCount` (`PushNotificationCreated.cs:11-14`), deriving from `BaseDomainEvent`
  (`PushNotificationCreated.cs:15`). No body, no logic; the record is a pure payload.
- **Why it's built this way**: raising a domain event inside `PushNotification.Create` (with `default`
  for the not-yet-assigned id) makes creation an announceable fact that flows through the outbox like any
  other domain event ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)), giving a persistable record and a future extension
  point.
- **Where it's used**: added to the aggregate's event list by `PushNotification.Create` and captured as
  an [OutboxMessage](group-04-events-outbox.md#outboxmessage) on `SaveChangesAsync`. There is **no**
  `IDomainEventHandler<PushNotificationCreated>` in the codebase today: delivery happens synchronously
  inside [SendPushNotificationHandler](#sendpushnotificationhandler) after the inbox rows are written, so
  this event is currently a published, persistable record with no consumer wired to it.

---

### NotificationModule
> MMCA.ADC.Notification.API · `MMCA.ADC.Notification.API` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/NotificationModule.cs:15` · Level 3 · class (sealed)

- **What it is**: the ADC Notification bounded context's
  [IModule](group-14-module-system-composition.md#imodule) entry point. It is the discovery hook that
  lets the framework register the whole Notification slice in dependency order, and it declares the one
  cross-module service the context publishes.
- **Depends on**: [IModule](group-14-module-system-composition.md#imodule) (Level 2);
  [ApplicationSettings](group-14-module-system-composition.md#applicationsettings) (Level 1); the ADC
  [DependencyInjection](#dependencyinjection) (`AddNotificationModule`);
  [IUserNotificationExportService](#iusernotificationexportservice) and its disabled stub
  [DisabledUserNotificationExportService](#disabledusernotificationexportservice). Externals:
  `Microsoft.Extensions.DependencyInjection` and `Microsoft.Extensions.Configuration`.
- **Concept**: cross-reference the module system in
  [Group 14](group-14-module-system-composition.md#imodule). `[Rubric §7, Microservices Readiness]`
  assesses whether modules are independently composable: this module declares `Dependencies =>
  ["Identity"]` with `RequiresDependencies => true` (`NotificationModule.cs:21` and `:24`) because it
  needs the Identity attendee query to resolve recipients, and the
  [ModuleLoader](group-14-module-system-composition.md#moduleloader) uses that to register it after
  Identity (Kahn topological order). It **does** publish a cross-module service (doc comment
  `NotificationModule.cs:12-13`), so it implements `RegisterDisabledStubs` to keep that interface
  resolvable when the module is turned off.
- **Walkthrough**: three declarative members plus two actions.
  - `Name => "Notification"` (`NotificationModule.cs:18`); `Dependencies => ["Identity"]`
    (`NotificationModule.cs:21`); `RequiresDependencies => true` (`NotificationModule.cs:24`).
  - `Register(services, configuration, applicationSettings)` (`NotificationModule.cs:27`), whose whole
    body delegates to `services.AddNotificationModule(applicationSettings, (IConfiguration)configuration)`
    (`NotificationModule.cs:31`). Note the deliberate `(IConfiguration)configuration` cast:
    `IModule.Register` hands over an `IConfigurationBuilder`, which the module treats as the concrete
    configuration to read from.
  - `RegisterDisabledStubs(services)` (`NotificationModule.cs:34`) registers
    `AddSingleton<IUserNotificationExportService, DisabledUserNotificationExportService>()`
    (`NotificationModule.cs:35`) so a host that disables Notification can still satisfy the export
    interface the Identity service calls for the PRIVACY.md data-subject export.
- **Why it's built this way**: keeping the module thin (a name, its dependencies, a one-line delegation
  to the composition-root extension, and one stub registration) is the framework's convention: policy
  about *what* to register lives in the `DependencyInjection` class, and the `IModule` only declares
  *ordering*, *identity*, and its cross-module contract's disabled fallback.
- **Where it's used**: discovered by reflection and registered by the
  [ModuleLoader](group-14-module-system-composition.md#moduleloader) at startup; in the extracted
  topology it is the only enabled module in `MMCA.ADC.Notification.Service`.

---

### SignalRLiveChannelPublisher
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/SignalRLiveChannelPublisher.cs:12` · Level 3 · class (sealed)

- **What it is**: the real (non-null) adapter for [ILiveChannelPublisher](#ilivechannelpublisher). It
  fans an ephemeral channel event out to every connection subscribed to a channel by doing a SignalR
  **group send** through [NotificationHub](#notificationhub).
- **Depends on**: [ILiveChannelPublisher](#ilivechannelpublisher) (Level 0);
  [NotificationHub](#notificationhub) (Level 2, referenced for its group send and method-name constant).
  External: `Microsoft.AspNetCore.SignalR` (`IHubContext<THub>`).
- **Concept introduced, out-of-band delivery via `IHubContext<THub>`.** `[Rubric §12, Performance &
  Scalability]` assesses horizontal scale-out: because the publisher addresses the hub through
  `IHubContext<NotificationHub>` (injected, `SignalRLiveChannelPublisher.cs:12`) rather than holding a
  hub connection, it works from any host that maps the hub, and when a Redis backplane is configured the
  group send fans out across replicas (doc comment `SignalRLiveChannelPublisher.cs:7-11`).
  `[Rubric §1, SOLID]`: the same `ILiveChannelPublisher` abstraction is implemented by the null default,
  this SignalR adapter, and (in ADC) a gRPC adapter, port-and-adapter taken to its conclusion.
- **Walkthrough**: one method, `PublishAsync(channelKey, eventName, payloadJson, cancellationToken)`
  (`SignalRLiveChannelPublisher.cs:15`):
  `hubContext.Clients.Group(channelKey).SendAsync(NotificationHub.ReceiveChannelEventMethod, channelKey,
  eventName, payloadJson, cancellationToken)` (`SignalRLiveChannelPublisher.cs:16-19`). It invokes the
  hub's `ReceiveChannelEventMethod` constant so the client and server agree on the method name, and
  passes the channel key, event name, and opaque JSON payload straight through.
- **Why it's built this way**: live channels are transient by contract
  ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)), so this adapter just addresses the group and sends, with no
  persistence and no per-recipient bookkeeping. A connection that is not subscribed at publish time
  simply never receives the event.
- **Where it's used**: registered over [NullLiveChannelPublisher](#nulllivechannelpublisher) by
  `AddPushNotifications` in any host that maps the hub
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:547`); in ADC it is the
  *local* implementation the Notification service's gRPC ingress
  ([LiveChannelGrpcService](#livechannelgrpcservice)) delegates to. The browser side lives in
  [group 15](group-15-common-ui-framework.md).

---

### SignalRPushNotificationSender
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/SignalRPushNotificationSender.cs:13` · Level 3 · class (sealed)

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
  (`SignalRPushNotificationSender.cs:15`) caps how many user ids ride a single `Clients.Users(batch)`
  call, so broadcasting to a large attendee list is split into bounded sends rather than one giant
  fan-out. `[Rubric §27, i18n]` in miniature: user ids are stringified with
  `CultureInfo.InvariantCulture` (`SignalRPushNotificationSender.cs:20` and `:47`) so the SignalR user-id
  keys are locale-stable.
- **Walkthrough**
  - `SendToUserAsync(userId, title, body, metadata, cancellationToken)`
    (`SignalRPushNotificationSender.cs:18`): addresses
    `Clients.User(userId.ToString(CultureInfo.InvariantCulture))` and invokes
    `NotificationHub.ReceiveNotificationMethod` (`SignalRPushNotificationSender.cs:19-22`).
  - `SendToUsersAsync(userIds, ...)` (`SignalRPushNotificationSender.cs:25`): iterates
    `BatchUserIds(userIds)` and sends each batch to `Clients.Users(batch)`
    (`SignalRPushNotificationSender.cs:27-33`).
  - `BroadcastAsync(...)` (`SignalRPushNotificationSender.cs:37`): addresses `Clients.All`
    (`SignalRPushNotificationSender.cs:38-40`).
  - `BatchUserIds(userIds)` (`SignalRPushNotificationSender.cs:42`): a private static iterator that
    accumulates invariant-culture id strings into a `List` and `yield return`s each time it reaches
    `BatchSize`, flushing the remainder at the end (`SignalRPushNotificationSender.cs:44-58`).
- **Why it's built this way**: all three delivery shapes route through the one hub context and the one
  shared method-name constant, so the client listens on a single event regardless of how it was targeted.
  Batching keeps a broadcast to thousands of recipients from constructing one oversized argument list for
  the connection manager.
- **Where it's used**: registered over [NullPushNotificationSender](#nullpushnotificationsender) by
  `AddPushNotifications` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:546`);
  called by [SendPushNotificationHandler](#sendpushnotificationhandler) after the inbox rows are
  persisted, inside a swallow-everything `try/catch` so a transport hiccup never loses the durable inbox.

---

### UserNotification
> MMCA.Common.Domain · `MMCA.Common.Domain.Notifications.UserNotifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/UserNotifications/UserNotification.cs:12` · Level 5 · class (sealed)

- **What it is**: the framework-level aggregate root that tracks delivery of a single
  [PushNotification](#pushnotification) to one user, giving each recipient a per-user inbox row with
  `IsRead`/`ReadOn` state.
- **Depends on**:
  [AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (its base, closed over `UserNotificationIdentifierType`, `UserNotification.cs:12`);
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
  by the mark-read command handlers behind [InboxController](#inboxcontroller). Its rows are also the
  data [UserNotificationExportService](#usernotificationexportservice) projects into the data-subject
  export.

---

### PushNotificationInvariants
> MMCA.Common.Domain · `MMCA.Common.Domain.Notifications.PushNotifications.Invariants` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/Invariants/PushNotificationInvariants.cs:10` · Level 6 · class (static)

- **What it is**: the static invariants helper that validates a push notification's title and body,
  non-empty plus a maximum length, delegating the actual checks to
  [CommonInvariants](group-02-domain-building-blocks.md#commoninvariants).
- **Depends on**: [CommonInvariants](group-02-domain-building-blocks.md#commoninvariants);
  [Result](group-01-result-error-handling.md#result); `System.Globalization` for the invariant-culture
  message interpolation.
- **Concept**: this is the same "static invariants class plus max-length constants as a single source of
  truth" pattern first taught for value objects in
  [Group 02](group-02-domain-building-blocks.md#commoninvariants), here applied to a domain entity.
  `TitleMaxLength = 200` and `BodyMaxLength = 2000` are `public static readonly int`
  (`PushNotificationInvariants.cs:13` and `:16`), so the EF entity configuration and the request
  validator reuse the exact same numbers. `[Rubric §8, Data Architecture]` assesses whether validation
  and schema stay consistent: because the domain check, the API validator, and the DB column length all
  derive from one field, they cannot drift.
- **Walkthrough**: `EnsureTitleIsValid(title, source)` (`PushNotificationInvariants.cs:18`) and
  `EnsureBodyIsValid(body, source)` (`PushNotificationInvariants.cs:23`) each call `Result.Combine` over
  `CommonInvariants.EnsureStringIsNotEmpty` and `CommonInvariants.EnsureStringMaxLength`, passing the
  matching max-length field and a `source`/field name so any failure carries a precise
  [Error](group-01-result-error-handling.md#error) code (for example `PushNotification.Title.TooLong`,
  `PushNotificationInvariants.cs:21`, and `PushNotification.Body.Empty`,
  `PushNotificationInvariants.cs:25`). The over-length messages are built with
  `string.Create(CultureInfo.InvariantCulture, ...)` so the interpolated number is locale-stable.
- **Why it's built this way**: factoring the rules out of the entity keeps the
  [PushNotification](#pushnotification) factory readable and lets the constants be shared with
  persistence and validators, the same one-source-of-truth rationale as the rest of the invariants
  family.
- **Where it's used**: called by the [PushNotification](#pushnotification) entity factory when a
  notification is created; its two length fields are read by
  [SendPushNotificationRequestValidator](#sendpushnotificationrequestvalidator).
- **Caveats / not-in-source**: the two limits are `static readonly`, not `const`, so a consumer compiled
  against an older package picks up a changed value on upgrade rather than baking it in at compile time.

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
- **Walkthrough**: the constructor (`SendPushNotificationRequestValidator.cs:14`) defines three rules.
  - `Title` (`SendPushNotificationRequestValidator.cs:16-19`) gets `NotEmpty()` plus
    `MaximumLength(PushNotificationInvariants.TitleMaxLength)` (200).
  - `Body` (`SendPushNotificationRequestValidator.cs:21-24`) gets `NotEmpty()` plus
    `MaximumLength(PushNotificationInvariants.BodyMaxLength)` (2000).
  - `ScopeKey` (`SendPushNotificationRequestValidator.cs:27-29`) gets **only**
    `MaximumLength(PushNotification.ScopeKeyMaxLength)` (128,
    `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:22`),
    no `NotEmpty`: the inline comment (`SendPushNotificationRequestValidator.cs:26`) records that a null
    scope key is the unscoped send every existing caller makes.
  Each rule supplies a human-readable `WithMessage`, with the limit interpolated under
  `CultureInfo.InvariantCulture`.
- **Where it's used**: registered by `AddValidatorsFromAssemblyContaining<SendPushNotificationRequestValidator>(includeInternalTypes: true)`
  in the notification Application DI
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:64`), which also
  makes this class the assembly anchor for every notification validator; invoked by the Validating
  command decorator in the CQRS pipeline (against the embedded `Request`, via
  [ICommandWithRequest<out TRequest>](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)) before
  [SendPushNotificationHandler](#sendpushnotificationhandler) runs
  ([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)).

---

### SendPushNotificationHandler
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:17` · Level 9 · class (sealed partial)

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
  (all injected via the primary constructor, `SendPushNotificationHandler.cs:17-23`); the persisted
  aggregates are [PushNotification](#pushnotification) and [UserNotification](#usernotification).
  Implements
  [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  and returns `Result<PushNotificationDTO>` ([Result](group-01-result-error-handling.md#result)).
- **Concept introduced, one durable path plus two ephemeral push channels, guarded by a dedup key.**
  `[Rubric §6, CQRS & Event-Driven]`, `[Rubric §8, Data Architecture]`, `[Rubric §29, Resilience &
  Business Continuity]`. The handler writes to storage (the audit aggregate, then N inbox rows) and
  separately performs two best-effort real-time pushes (SignalR, then native OS push). These are
  different reliability tiers on purpose: the aggregate and inbox rows are the **durable** record a
  recipient can retrieve later, while the SignalR and native pushes are the **immediate** deliveries that
  an offline user may miss.
- **Walkthrough** (teaching order)
  1. **deduplication gate** (`SendPushNotificationHandler.cs:30-41`): the command's
     [DedupKey](#sendpushnotificationcommand) is normalized so whitespace counts as absent
     (`SendPushNotificationHandler.cs:32`, "a blank header cannot claim the single empty key"); when a
     key is present, `FindByDedupKeyAsync` looks for an already-persisted notification and, on a hit,
     logs and returns the existing one mapped to a DTO **without sending again**
     (`SendPushNotificationHandler.cs:35-40`).
  2. **resolve recipients** (`SendPushNotificationHandler.cs:44-45`) via the app-specific
     [INotificationRecipientProvider](#inotificationrecipientprovider) (in ADC,
     [AttendeeNotificationRecipientProvider](#attendeenotificationrecipientprovider)). An empty set
     short-circuits to a `Result.Failure` with an [Error](group-01-result-error-handling.md#error)
     `Validation` code `PushNotification.NoRecipients` (`SendPushNotificationHandler.cs:47-53`), before
     any rows are written.
  3. **create the audit aggregate** (`SendPushNotificationHandler.cs:56-62`) via
     `PushNotification.Create(title, body, sentByUserId, recipientIds.Count, dedupKey, scopeKey)`;
     propagate errors on failure (`SendPushNotificationHandler.cs:63-66`), then add to the repository
     (`SendPushNotificationHandler.cs:69-70`). This is where the aggregate's
     [PushNotificationCreated](#pushnotificationcreated) domain event is captured to the outbox
     ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).
  4. **first save, with a race requery** (`SendPushNotificationHandler.cs:72-103`): the save is wrapped
     in a `try/catch (Exception)` under a justified `#pragma warning disable CA1031`
     (`SendPushNotificationHandler.cs:76-78`). The long comment
     (`SendPushNotificationHandler.cs:80-91`) is the teaching point: the dedup lookup in step 1 is a
     check-then-act, so two concurrent retries of the same send both pass it and the loser only fails
     here, on the insert, against the filtered unique index on `DedupKey`. The catch requeries by key
     with `CancellationToken.None` (`SendPushNotificationHandler.cs:94`, so a cancelled save can still be
     classified) and, if a winner now exists, returns it (`SendPushNotificationHandler.cs:95-99`);
     anything else rethrows untouched (`SendPushNotificationHandler.cs:102`) so a genuine persistence
     fault still reaches the exception middleware. The broad catch is deliberate: Application has no EF
     Core dependency under the layer rule, so `DbUpdateException` is not a type this file can name, and
     the requery is what narrows it. Same shape as
     [EfInboxStore](group-04-events-outbox.md#efinboxstore)'s `MessageId` unique-index handling.
  5. **durable inbox** (`SendPushNotificationHandler.cs:106-113`): one
     `UserNotification.Create(recipientId, notification.Id)` row per recipient, added and saved. This is
     what lets a user retrieve a notification they missed while offline.
  6. **best-effort SignalR delivery** (`SendPushNotificationHandler.cs:116-133`):
     `pushNotificationSender.SendToUsersAsync(...)` inside a `try/catch` with its own justified `CA1031`
     suppression (`SendPushNotificationHandler.cs:127-129`). A delivery failure is **non-fatal**: success
     calls `notification.MarkAsSent()` plus an info log (`SendPushNotificationHandler.cs:124-125`),
     failure calls `notification.MarkAsFailed()` plus an error log
     (`SendPushNotificationHandler.cs:131-132`); the failure becomes recorded *status*, not a thrown
     exception.
  7. **best-effort native push** (`SendPushNotificationHandler.cs:135-152`,
     [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)): `nativePushSender.SendToUsersAsync(...)` in a third `try/catch`
     with its own suppression (`SendPushNotificationHandler.cs:147-149`). This is the OS-level channel
     that can reach devices whose app is backgrounded or killed (comment
     `SendPushNotificationHandler.cs:135-138`). It is **purely additive**: the SignalR leg above already
     decided the audit status, so a native-push failure only logs a warning (`LogNativePushFailed`,
     `SendPushNotificationHandler.cs:151`) and never touches `Status`. The default
     [NullNativePushSender](group-07-persistence-ef-core.md#nullnativepushsender) keeps this a no-op
     until a notification hub is configured.
  8. **persist final status** (`SendPushNotificationHandler.cs:154`) and **return** the mapped DTO
     (`SendPushNotificationHandler.cs:156`).
  - `FindByDedupKeyAsync` (`SendPushNotificationHandler.cs:164-173`) resolves the read repository from
    the unit of work (`unitOfWork.GetReadRepository<...>()`, `SendPushNotificationHandler.cs:166`), never
    an injected [IRepository<TEntity, TIdentifierType>](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype),
    so the lookup runs against the same data source as the write (its doc comment says exactly that,
    `SendPushNotificationHandler.cs:159-163`).
  - Five source-generated `[LoggerMessage]` methods close the file
    (`SendPushNotificationHandler.cs:175-188`): sent, delivery-failed, native-failed, dedup hit, and
    dedup race requery. `[Rubric §13, Observability]`.
- **Why it's built this way**: shipping the whole feature in the *framework* means both ADC and Store get
  push for free, with the audience and both transports as injected abstractions (`[Rubric §10,
  Cross-Cutting Concerns]`). Treating each delivery failure as a recorded status or a logged warning
  rather than an exception keeps the audit trail honest while the audit and inbox writes stay durable
  even when a live push does not land. The dedup key plus the filtered unique index gives the retry
  safety a broadcast needs: the database, not the application, is the arbiter of "already sent". Note the
  real-time sends are **not** the outbox: they are synchronous best-effort calls inside the handler; only
  the `PushNotificationCreated` domain event flows through the outbox.
- **Where it's used**: dispatched from [NotificationsController](#notificationscontroller) (mounted into
  ADC by the Notification DI facade); the real-time legs land on connected clients through
  [NotificationHub](#notificationhub) and, for native push, through the configured OS notification hub.
- **Caveats / not-in-source**: `SendPushNotificationCommand` is **not** marked `ITransactional`, so the
  Transactional decorator opens no ambient transaction; the three `SaveChangesAsync` calls
  (`SendPushNotificationHandler.cs:74`, `:113`, `:154`) are independent. A crash between the inbox writes
  and the final status save can therefore leave inbox rows persisted while the aggregate `Status` stays
  `Pending`. There is no automatic redelivery of a failed push: the outcome is recorded, not
  re-attempted. The filtered unique index the race path relies on is declared in the EF configuration,
  not in this file.

---

### UserNotificationExportGrpcService
> MMCA.ADC.Notification.Service · `MMCA.ADC.Notification.Service.Grpc` · `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/UserNotificationExportGrpcService.cs:27` · Level 9 · class (sealed)

- **What it is**: the gRPC **server** endpoint that exposes the in-process
  [IUserNotificationExportService](#iusernotificationexportservice) over the wire. The Identity service
  calls it to pull a user's notification inbox rows (ids, titles, sent/read dates) so it can assemble the
  data-subject export document (PRIVACY.md §7, the GDPR right of access).
- **Depends on**: [IUserNotificationExportService](#iusernotificationexportservice) (injected via the
  primary constructor, `UserNotificationExportGrpcService.cs:27`), the generated
  `UserNotificationExportService.UserNotificationExportServiceBase` (compiled from the `.Contracts`
  `.proto`, `UserNotificationExportGrpcService.cs:28`), and `Grpc.Core.ServerCallContext`. Uses
  `System.Globalization.CultureInfo` for invariant-culture date formatting.
- **Concept introduced, cross-service data-subject export over internal gRPC.** `[Rubric §30,
  Compliance, Privacy & Data Governance]` assesses whether the system can satisfy a subject-access
  request across service boundaries: each service owns its own database
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), so the user's inbox rows live in `ADC_Notification`, not in
  Identity; this RPC lets the Identity export aggregator gather that slice without a cross-database
  query. `[Rubric §7, Microservices Readiness]` and `[Rubric §9, API & Contract Design]`: the export
  contract is a versioned `.proto` shared through the `.Contracts` package, the same extraction pattern
  as the live-channel ingress. `[Rubric §27, i18n]`: timestamps are serialized with the round-trip `"O"`
  format under `CultureInfo.InvariantCulture` (`UserNotificationExportGrpcService.cs:47` and `:51`) so
  the export is locale-stable.
- **Walkthrough**: the single `GetUserNotificationExport` override
  (`UserNotificationExportGrpcService.cs:31`) null-guards `request` and `context`
  (`UserNotificationExportGrpcService.cs:35-36`), then awaits
  `inner.GetUserNotificationExportAsync(request.UserId, context.CancellationToken)`
  (`UserNotificationExportGrpcService.cs:38-40`) to get the in-process items. It builds a
  `GetUserNotificationExportResponse` (`UserNotificationExportGrpcService.cs:42`) and `AddRange`s a
  projection of each item into a `UserNotificationExportItem`
  (`UserNotificationExportGrpcService.cs:43-52`): `NotificationId`, `Title`, `SentOn`, `IsRead`, and
  `ReadOn` (`string.Empty` when the notification is unread,
  `UserNotificationExportGrpcService.cs:49-51`). Both timestamps pass through
  `DateTime.SpecifyKind(..., DateTimeKind.Utc)` before `ToString("O", ...)`: the doc comment
  (`UserNotificationExportGrpcService.cs:20-25`) explains why, SQL Server hands back
  `DateTimeKind.Unspecified` values and the `"O"` format omits the `Z` marker for that kind, so the
  stamp only restores the marker the wire contract promises (the stored values are already UTC).
- **Why it's built this way (security posture)**: unlike
  [LiveChannelGrpcService](#livechannelgrpcservice), this endpoint **requires authorization**: it is
  mapped with `.RequireAuthorization()`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:288`) and the class doc says why
  (`UserNotificationExportGrpcService.cs:14-19`). `[Rubric §11, Security]`, `[Rubric §30, Compliance,
  Privacy & Data Governance]`: internal-only ingress is **not sufficient** here because the response
  carries personal data keyed by a raw `UserId`, so the calling service forwards the end user's JWT via
  `JwtForwardingClientInterceptor` and ownership is enforced at the REST edge. It is served on the same
  dedicated `Http2`-only "grpc" Kestrel endpoint as the live-channel ingress
  ([ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html) mixed-endpoint profile, `UserNotificationExportGrpcService.cs:11-13`).
- **Where it's used**: mapped by the Notification service's `Program.cs` (`Program.cs:288`); the wire is
  dialed by its client half
  [UserNotificationExportServiceGrpcAdapter](#usernotificationexportservicegrpcadapter), which runs
  inside the Identity service's export aggregator and stitches this Notification slice into the full
  data-subject export. The in-process implementation it wraps is
  [UserNotificationExportService](#usernotificationexportservice); when the Notification module is
  disabled, [DisabledUserNotificationExportService](#disabledusernotificationexportservice) (registered
  by [NotificationModule](#notificationmodule)'s `RegisterDisabledStubs`) stands in for it.

### PushNotificationDTOMapper
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/DTOs/PushNotificationDTOMapper.cs:12` · Level 8 · class (sealed, partial)

- **What it is**: the Mapperly-generated mapper that projects the [PushNotification](#pushnotification)
  domain entity onto its [PushNotificationDTO](#pushnotificationdto) response shape. It implements
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
  - `MapToDTO(PushNotification entity)` (line 17) is `partial`: Mapperly writes the member-by-member copy.
    The single override is
    `[MapProperty(nameof(PushNotification.Status), nameof(PushNotificationDTO.Status), Use = nameof(MapStatusToString))]`
    (line 16), which routes the status through the custom converter instead of a straight assignment.
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
  `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:43-45`), and
  consumed through it by [SendPushNotificationHandler](#sendpushnotificationhandler) and
  [GetNotificationHistoryHandler](#getnotificationhistoryhandler) to shape what
  [NotificationsController](#notificationscontroller) returns.

---

### DevicesController
> MMCA.Common.API · `MMCA.Common.API.Controllers.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:25` · Level 9 · class (sealed)

- **What it is**: the REST controller that lets any authenticated user manage THEIR own native
  push-device installations ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).
  `PUT /Notifications/Devices` upserts the installation (called after login and on token rotation) and
  `DELETE /Notifications/Devices/{installationId}` removes it (called before logout), per the class
  documentation at `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:13-19`.
- **Depends on**: [ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase) (its base, line 27);
  [IPushDeviceRegistrar](group-07-persistence-ef-core.md#ipushdeviceregistrar) (primary-constructor
  parameter, line 26); [ICurrentUserService](group-08-auth.md#icurrentuserservice) (line 27);
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
  [IPushDeviceRegistrar](group-07-persistence-ef-core.md#ipushdeviceregistrar) verifies the owner tag and
  reports both cases as success
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IPushDeviceRegistrar.cs:40-48`),
  so the endpoint cannot be used as an existence oracle for other users' installation ids
  (`DevicesController.cs:47-53`).
  `[Rubric §11, Security]` assesses whether authorization and ownership are enforced at the boundary:
  class-level `[Authorize]` (line 24) plus server-side ownership stamping plus a uniform 204 on delete
  is the whole posture here.
  `[Rubric §9, API & Contract Design]` assesses REST-shape consistency: both actions declare typed
  `[ProducesResponseType]` results (204 on success, `ProblemDetails` on the failure paths, lines 31-32
  and 55-56) and share the `HandleFailure`-or-success return shape used across the group.
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
    ownership-scoped overload, and the action answers 204 either way (line 68).
- **Why it's built this way**: the controller is wrapped in
  `[FeatureGate(NotificationFeatures.PushNotifications)]` (line 23), so with the
  `Notification.PushNotifications` flag off the routes are simply not there rather than answering as
  dead endpoints. Routing all storage through
  [IPushDeviceRegistrar](group-07-persistence-ef-core.md#ipushdeviceregistrar) keeps the controller free
  of any push-provider detail, which is what lets the default implementation stay a no-op until a
  notification hub is configured
  ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).
- **Where it's used**: made routable by the API-layer [DependencyInjection](#dependencyinjection) helper
  below (`AddNotificationControllers`); called by a native client's login and logout flows.

---

### InboxController
> MMCA.Common.API · `MMCA.Common.API.Controllers.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationInboxController.cs:30` · Level 9 · class (sealed)

- **What it is**: the REST controller for one user's in-app notification inbox: read the inbox (paged),
  read the unread count, mark one notification read, and mark everything read. An authenticated caller
  reaches only their own inbox. Note the file name and the type name differ: the class is
  `InboxController` (so the `[controller]` token yields `Notifications/Inbox`, line 26) but it lives in
  `NotificationInboxController.cs`.
- **Depends on**: [ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase);
  [AuthorizationPolicies](group-08-auth.md#authorizationpolicies) (line 29);
  [ICurrentUserService](group-08-auth.md#icurrentuserservice) (line 35); the handler contracts
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) and
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  (lines 31-34); the four use cases [GetMyNotificationsQuery](#getmynotificationsquery),
  [GetUnreadNotificationCountQuery](#getunreadnotificationcountquery),
  [MarkNotificationReadCommand](#marknotificationreadcommand) and
  [MarkAllNotificationsReadCommand](#markallnotificationsreadcommand);
  [UserNotificationDTO](#usernotificationdto); [PushNotification](#pushnotification) (for the
  `ScopeKeyMaxLength` constant, line 47); [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
  [Result](group-01-result-error-handling.md#result), [Error](group-01-result-error-handling.md#error);
  [NotificationFeatures](#notificationfeatures). Externals: ASP.NET Core MVC, `Asp.Versioning`,
  `Microsoft.FeatureManagement.Mvc`, and `System.ComponentModel.DataAnnotations` (`[Range]`,
  `[StringLength]`).
- **Concept introduced, the feature-gated controller that injects handlers directly.** There is no
  service layer between HTTP and the use cases: the constructor takes the four
  `IQueryHandler`/`ICommandHandler` closures it needs (lines 31-34) and every action does exactly three
  things, resolve the caller, build the query or command, translate the `Result` to a status code.
  Everything cross-cutting (logging, caching, validation, transaction) is added by the CQRS decorator
  pipeline around those handlers, so none of it appears here.
  `[Rubric §6, CQRS & Event-Driven]` assesses whether presentation delegates to command/query handlers
  rather than to service wrappers: this class is the reference shape for that.
  `[Rubric §11, Security]` assesses boundary authorization: `[Authorize(Policy =
  AuthorizationPolicies.RequireAuthenticated)]` (line 29) gates the class, and every action re-scopes to
  `currentUserService.UserId` so the data read is user-scoped, not merely route-scoped.
  `[Rubric §9, API & Contract Design]` assesses contract consistency: `[ApiVersion("1.0")]` (line 27),
  typed `[ProducesResponseType]` on each action, and query-string paging with `[Range(1, int.MaxValue)]`
  validation (lines 45-46).
- **Concept introduced, the optional `scope` filter.** Three of the four actions take an optional
  `scope` query parameter bounded by `[StringLength(PushNotification.ScopeKeyMaxLength)]` (128
  characters, `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:22`),
  which narrows the inbox to notifications carrying that scope plus the unscoped ones; omitting it
  returns everything (documented lines 38-41). The parameter is threaded through the read, the badge
  count, and the bulk write on purpose: a scoped caller must never clear notifications its own inbox
  read hid from it (lines 106-110). See [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html).
- **Walkthrough**
  - Primary-constructor DI of two query handlers, two command handlers, and the current-user service
    (lines 30-35).
  - `GetInboxAsync` (line 44): `[HttpGet]` (line 42); `pageNumber` defaults to 1 and `pageSize` to 20
    (lines 45-46), both `[Range(1, int.MaxValue)]`; the optional `scope` is line 47. A null user
    short-circuits to `Error.Unauthorized("Notification.Unauthorized", ...)` (lines 50-54). It builds
    `new GetMyNotificationsQuery(userId.Value, pageNumber, pageSize, scope)` (line 56), awaits the
    handler (lines 57-58), and returns 200 with the
    [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) or
    `HandleFailure` (line 60).
  - `GetUnreadCountAsync` (line 70): route `unread-count` (line 67) and `[ResponseCache(NoStore = true)]`
    (line 68), so the badge count is never served from a cache. It issues
    `new GetUnreadNotificationCountQuery(userId.Value, scope)` (line 80) and returns the raw `int`
    (line 83).
  - `MarkReadAsync` (line 90): route `{id:int}/read` (line 87), the id bound as
    `UserNotificationIdentifierType` (line 91). It issues
    `new MarkNotificationReadCommand(id, userId.Value)` (line 100) and returns 204 or, per its declared
    contract, a 404 `ProblemDetails` (lines 88-89).
  - `MarkAllReadAsync` (line 113): route `read-all` (line 111), no body, optional `scope` (line 114). It
    issues `new MarkAllNotificationsReadCommand(userId.Value, scope)` (line 123) and returns 204
    (line 126).
- **Why it's built this way**: passing `userId` into every query and command keeps authorization a data
  concern rather than only a routing concern, which is what makes the same handlers reusable from a
  non-HTTP caller. The class-level `[FeatureGate(NotificationFeatures.PushNotifications)]` (line 28)
  makes the whole inbox surface disappear when the flag is off, so a host that has not opted into
  notifications does not advertise endpoints it cannot serve.
- **Where it's used**: registered into MVC application parts by `AddNotificationControllers`
  ([DependencyInjection](#dependencyinjection), API layer, below); consumed by the in-app inbox UI (the
  unread badge plus the notification list).

---

### NotificationsController
> MMCA.Common.API · `MMCA.Common.API.Controllers.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:30` · Level 9 · class (sealed)

- **What it is**: the organizer-only REST controller for push notifications: `POST /Notifications` sends
  a notification to all recipients and returns 201, `GET /Notifications` returns the paged send history.
- **Depends on**: the same controller family as [InboxController](#inboxcontroller)
  ([ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase),
  [AuthorizationPolicies](group-08-auth.md#authorizationpolicies),
  [ICurrentUserService](group-08-auth.md#icurrentuserservice),
  [Result](group-01-result-error-handling.md#result), [Error](group-01-result-error-handling.md#error),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
  [NotificationFeatures](#notificationfeatures)), plus
  [SendPushNotificationCommand](#sendpushnotificationcommand),
  [GetNotificationHistoryQuery](#getnotificationhistoryquery),
  [SendPushNotificationRequest](#sendpushnotificationrequest),
  [PushNotificationDTO](#pushnotificationdto),
  [IdempotentAttribute](group-12-api-hosting-mapping.md#idempotentattribute) (line 44) and
  [IdempotencyHeaders](group-08-auth.md#idempotencyheaders) (line 62). Externals: ASP.NET Core MVC,
  `Asp.Versioning`, `Microsoft.FeatureManagement.Mvc`, and `System.Globalization` (`CultureInfo`).
- **Concept**: the feature-gated, handler-injecting controller shape is taught at
  [InboxController](#inboxcontroller). What differs here is the authorization boundary:
  `[Authorize(Policy = AuthorizationPolicies.RequireOrganizer)]` (line 29) restricts both actions to
  organizers, because sending is a broadcast, while the inbox is per-user.
  `[Rubric §11, Security]` assesses least privilege: the write side carries its own stricter policy
  instead of reusing the authenticated-only one.
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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationCommand.cs:15-22`).
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
    whitespace-only value leaves `dedupKey` null, which is the legacy behavior where every send creates a
    new notification (comment lines 58-59). The header is read manually rather than bound with
    `[FromHeader]` (and Sonar's S6932 suppressed with that reason, lines 61 and 67) so protocol plumbing
    shared with the idempotency filter does not appear in the generated OpenAPI contract.
    It builds `new SendPushNotificationCommand(request, userId.Value) { DedupKey = dedupKey }` (line 69)
    and on success returns
    `Created(new Uri(string.Create(CultureInfo.InvariantCulture, $"/notifications/{result.Value!.Id}"), UriKind.Relative), result.Value)`
    (line 74).
  - `GetHistoryAsync` (line 80): `[HttpGet]` (line 78) with `[Range(1, int.MaxValue)]` paging,
    `pageSize` defaulting to 10 (lines 81-82). It runs
    `new GetNotificationHistoryQuery(pageNumber, pageSize)` (line 85) and returns 200 with the paged
    [PushNotificationDTO](#pushnotificationdto) collection (line 91). Unlike the inbox, history takes no
    user filter: an organizer sees every send.
- **Why it's built this way**: splitting the broadcast surface from the per-user inbox surface lets each
  controller carry exactly its own authorization policy, so widening the inbox policy can never widen the
  send policy by accident. Both stay behind
  `[FeatureGate(NotificationFeatures.PushNotifications)]` (line 28).
- **Where it's used**: registered via `AddNotificationControllers`
  ([DependencyInjection](#dependencyinjection), API layer, below); consumed by the organizer
  push-notification UI.

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
  they exist but are never routed. `AddNotificationControllers` is written as an `extension(IMvcBuilder
  builder)` member (line 11) that calls
  `builder.AddApplicationPart(typeof(NotificationsController).Assembly)` (line 21), which registers all
  three controllers in one call because they share an assembly.
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
  `AddControllers().AddNotificationControllers()` (see [primer §4](00-primer.md#c-extensiont-types-read-this-once)).
  This is the API counterpart to the Application-layer `AddNotificationApplicationServices` below: one
  call wires the handlers, the other exposes them over HTTP.
- **Where it's used**: called from a consuming host's MVC setup, alongside the Application-layer
  registration.

---

### DependencyInjection
> MMCA.Common.Application · `MMCA.Common.Application.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:26` · Level 10 · class (static)

*(Application-layer notification DI. Distinct from the API-layer `DependencyInjection` directly above;
both keep the raw type name as their heading.)*

- **What it is**: the Application-layer composition helper for the notification subsystem. Its single
  `extension(IServiceCollection)` member, `AddNotificationApplicationServices`, registers every
  notification command and query handler, the DTO mapper, the entity query service, the validators, and
  the default recipient provider.
- **Depends on**: [PushNotification](#pushnotification) and
  [`NullNavigationPopulator<TEntity>`](group-11-navigation-populators.md#nullnavigationpopulatortentity);
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  and [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype);
  [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype)
  and [PushNotificationDTOMapper](#pushnotificationdtomapper); the handler contracts
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
  assembly.** Application modules are normally auto-registered by
  `ScanModuleApplicationServices<TAssemblyMarker>()`, which scans a module's own assembly. The
  notification types have no module assembly of their own: they live in `MMCA.Common.Application`, so
  they are wired explicitly here (line 35). Every registration uses `TryAddScoped` (lines 38-67), which
  is the override contract: a consuming app that registers its own handler, mapper, or recipient
  provider **before** calling this helper keeps its own registration, because `TryAdd` never replaces an
  existing service descriptor.
  `[Rubric §1, SOLID]` assesses dependency inversion: the notification send path depends on
  [INotificationRecipientProvider](#inotificationrecipientprovider), and the default binding is the
  no-op [NullNotificationRecipientProvider](#nullnotificationrecipientprovider) (line 67), so the
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
    to batch-load.
  - The [PushNotificationDTOMapper](#pushnotificationdtomapper) twice, as the concrete type and as the
    `IEntityDTOMapper<...>` interface (lines 43-45), so both the query service (which resolves the
    interface) and any direct consumer get the same scoped instance shape.
  - Three command handlers: [SendPushNotificationHandler](#sendpushnotificationhandler) (lines 48-49),
    [MarkNotificationReadHandler](#marknotificationreadhandler) (lines 50-51), and
    [MarkAllNotificationsReadHandler](#markallnotificationsreadhandler) (lines 52-53).
  - Three query handlers: [GetNotificationHistoryHandler](#getnotificationhistoryhandler) (lines 56-57),
    [GetMyNotificationsHandler](#getmynotificationshandler) (lines 58-59), and
    [GetUnreadNotificationCountHandler](#getunreadnotificationcounthandler) (lines 60-61). These six
    registrations are exactly the closures the two controllers above inject.
  - The FluentValidation validators discovered from the
    [SendPushNotificationRequestValidator](#sendpushnotificationrequestvalidator) assembly with
    `includeInternalTypes: true` (line 64). Note this one is a plain `AddValidatorsFromAssemblyContaining`,
    not a `TryAdd`.
  - The default recipient provider (line 67), then `return services` for chaining (line 69).
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
