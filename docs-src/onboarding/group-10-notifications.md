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
forwarder) is chosen at the composition root, and a no-op default is always registered so nothing
has to be configured for DI to resolve.

There are really **four delivery channels** here, and it is worth separating them up front because
they have different durability guarantees:

1. **The durable in-app inbox.** Every send writes one [`UserNotification`](#usernotification) row
   per recipient, so a user who was offline at send time still sees the message when they next open
   their inbox
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:58-66`).
   This is the persistent half of the two-channel model (ADR-024).
2. **The transient SignalR push.** [`IPushNotificationSender`](#ipushnotificationsender) fans the
   same message out to any connections the recipient has open right now via the
   [`NotificationHub`](#notificationhub); clients not connected at send time simply never see this
   copy (the inbox is their catch-up). This is the real-time half of ADR-024.
3. **The OS-level native push (ADR-044).** A separate best-effort channel reaches devices the
   SignalR hub cannot (app backgrounded or killed), through `INativePushSender` and the device
   registrations managed by [`DevicesController`](#devicescontroller). The sender itself and its
   Azure Notification Hubs implementation live in
   [Group 07](group-07-persistence-ef-core.md#inativepushsender); this chapter covers only the
   request record and the registration endpoint.
4. **Ephemeral live-channel events (ADR-039).** A distinct, never-persisted fan-out to a *group*
   of subscribed connections (for example `event:1` or `session:123`), used by the ADC Engagement
   live layer for poll and question updates. This rides the same hub but through
   [`ILiveChannelPublisher`](#ilivechannelpublisher) and the hub's `JoinChannel`/`LeaveChannel`
   group membership rather than per-user targeting
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Hubs/NotificationHub.cs:43-59`).

A fifth transport, plain **email**, is present as [`IEmailSender`](#iemailsender) /
[`SmtpEmailSender`](#smtpemailsender) (MailDev locally, real SMTP in production) but is a
lower-traffic, fire-one-message helper rather than part of the broadcast pipeline: it builds and
disposes an `SmtpClient` per call and offers a "send to the configured default recipient" overload
for system mail (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/SmtpEmailSender.cs:30-54`).

## The layering, and why the pieces sit where they do

The dependency flow of the group mirrors the framework's Clean Architecture story
([Rubric §3, Clean Architecture]). The **Domain** layer holds the two aggregates,
[`PushNotification`](#pushnotification) (the audit record of a broadcast: title, body, sender,
recipient count, and a [`PushNotificationStatus`](#pushnotificationstatus) of `Pending`/`Sent`/`Failed`)
and [`UserNotification`](#usernotification) (one per-recipient inbox row with read/unread state),
plus the [`PushNotificationCreated`](#pushnotificationcreated) domain event and the
[`PushNotificationInvariants`](#pushnotificationinvariants) guards (title max 200 chars, body max
2000, both non-empty:
`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/Invariants/PushNotificationInvariants.cs:12-25`).
Both aggregates are `[IdValueGenerated]`, so the database assigns their ids
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:13`,
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
[`NotificationsController`](#notificationscontroller), which is gated three ways:
`[FeatureGate(NotificationFeatures.PushNotifications)]`, `[Authorize(Policy = RequireOrganizer)]`,
and API versioning
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:25-27`).
The controller reads the authenticated id from `ICurrentUserService`, refuses the call with an
`Error.Unauthorized` when there is none, wraps the request in a
[`SendPushNotificationCommand`](#sendpushnotificationcommand) and hands it to
[`SendPushNotificationHandler`](#sendpushnotificationhandler)
(`NotificationsController.cs:42-53`).

The handler runs a deliberate ordering
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:31-109`):
resolve the recipient user ids through
[`INotificationRecipientProvider`](#inotificationrecipientprovider) (fail early with a
`PushNotification.NoRecipients` validation error if the set is empty, lines 34-40); create the
[`PushNotification`](#pushnotification) audit aggregate and save it (lines 43-56); then create one
[`UserNotification`](#usernotification) inbox row per recipient and save again, so a user can
retrieve a missed notification even if every real-time channel fails (lines 59-66); then attempt
SignalR delivery via [`IPushNotificationSender`](#ipushnotificationsender), catching any exception
and recording `MarkAsSent()` or `MarkAsFailed()` accordingly (delivery failure is non-fatal, lines
69-86); then a best-effort native-push leg through `INativePushSender` (ADR-044) whose failures are
logged at Warning but never change the audit status (lines 92-105); and finally a third save plus a
map of the aggregate to a [`PushNotificationDTO`](#pushnotificationdto) via
[`PushNotificationDTOMapper`](#pushnotificationdtomapper) (lines 107-109). The durable inbox write
happening **before** the transient channels is the load-bearing choice: the record of who should
have been reached survives even when nobody is connected.

Who counts as a recipient is deliberately left to the consuming app.
[`INotificationRecipientProvider`](#inotificationrecipientprovider) is the extension point; the
framework registers [`NullNotificationRecipientProvider`](#nullnotificationrecipientprovider), which
returns an empty list, as a safe default
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:67`), and ADC
supplies [`AttendeeNotificationRecipientProvider`](#attendeenotificationrecipientprovider), which
bridges the Identity module's
[`IAttendeeQueryService`](group-24-identity-module.md#iattendeequeryservice) (over gRPC across
service boundaries) so a broadcast targets every conference attendee. The override works by
ordering, not by configuration: ADC registers its provider with `AddScoped` **before** calling
`AddNotificationApplicationServices()`, whose `TryAddScoped` default then finds the slot already
taken
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/DependencyInjection.cs:24-31`).

## The inbox side

Reading and acknowledging notifications is the query/command counterpart, served by
[`InboxController`](#inboxcontroller) under the same feature gate and
`[Authorize(RequireAuthenticated)]`, so any user reaches only their own inbox
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationInboxController.cs:27-28`);
every action re-reads `ICurrentUserService.UserId` and builds the message from it rather than
trusting a client-supplied id. It exposes four use cases: the paged inbox
([`GetMyNotificationsQuery`](#getmynotificationsquery) /
[`GetMyNotificationsHandler`](#getmynotificationshandler), which joins the per-user
[`UserNotification`](#usernotification) rows to their [`PushNotification`](#pushnotification)
content newest-first and clamps the page size to 500,
`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetInbox/GetMyNotificationsHandler.cs:24-50`),
an unread count ([`GetUnreadNotificationCountQuery`](#getunreadnotificationcountquery), served
`[ResponseCache(NoStore = true)]` so the bell badge is never stale,
`NotificationInboxController.cs:59`), a single mark-read
([`MarkNotificationReadCommand`](#marknotificationreadcommand)), and a mark-all-read
([`MarkAllNotificationsReadCommand`](#markallnotificationsreadcommand)).
[`UserNotification`](#usernotification)`.MarkAsRead` is **idempotent** and takes the read timestamp
as a parameter (from an injected `TimeProvider`) so the domain stays free of ambient clock access
and the transition is deterministically testable
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/UserNotifications/UserNotification.cs:58-67`).

## The SignalR transport, and how it survives extraction

[`NotificationHub`](#notificationhub) is intentionally thin
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Hubs/NotificationHub.cs:17`): it is
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
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:250-272`).

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
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/LiveChannelGrpcService.cs:19-35`).
Both the adapter and the whole live path are **best-effort by contract** (ADR-039): every transport,
resolution, or broken-circuit failure is logged and swallowed, never thrown, so a publishing command
can never fail because Notification is slow or down
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/LiveChannelPublisherGrpcAdapter.cs:26,43-48`)
([Rubric §29, Resilience & Business Continuity]). Serving both a WebSocket and an h2c gRPC ingress
from one host is the mixed-endpoint profile of ADR-012, and it is why the Notification host keeps its
default endpoint on `Http1AndHttp2` (the WebSocket Upgrade needs HTTP/1.1) while the gRPC ingress
sits on a dedicated `Http2`-only named endpoint that peers resolve as `_grpc.notification`
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/KestrelConfiguration.cs:23-35`). That gRPC
surface carries no `[Authorize]`: it is reachable only on the internal service network, never routed
by the Gateway (`LiveChannelGrpcService.cs:13-17`).

## The module host, native-device registration, and the privacy export

On the ADC side the whole capability is packaged by [`NotificationModule`](#notificationmodule)
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/NotificationModule.cs:15`), an
[`IModule`](group-14-module-system-composition.md#imodule) that declares a hard dependency on
Identity (`RequiresDependencies => true`, since it needs attendee data) and whose `Register` calls
`AddNotificationModule` to wire the application handlers, the EF configurations, the SignalR push
registration, the native-push channel, and the Common controllers
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:21-34`). It
is a deliberately thin module (API + Application only, no Infrastructure project of its own). The
framework's own registration ([`DependencyInjection`](#dependencyinjection) in
`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:26`) uses
`TryAddScoped` throughout so a consuming app can override any handler or the recipient provider, and
the API-layer [`DependencyInjection`](#dependencyinjection)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Notifications/DependencyInjection.cs:19-23`) adds
the Common controllers as an MVC application part, because they ship in a NuGet assembly that
ASP.NET does not scan by default.

Native-device management is the third channel's control plane.
[`DevicesController`](#devicescontroller) (ADR-044) lets an authenticated user upsert
(`PUT`, after login and on token rotation) or delete (`DELETE`, before logout) a device
installation, described by [`DeviceInstallationRequest`](#deviceinstallationrequest). The two verbs
scope ownership differently, and only one actually stamps it: `UpsertAsync` reads
`currentUserService.UserId` and passes it to `registrar.UpsertAsync`, so a PUT can only ever register
*the caller's own* installation
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:33-45`).
`DeleteAsync`, by contrast, takes no ownership check at all: it calls
`registrar.DeleteAsync(installationId, ...)` with only the route-supplied id
(`DevicesController.cs:50-56`), so any authenticated caller who knows an installation id can remove
it. The only thing standing between that and cross-user deletion is that installation ids are
client-generated GUIDs and therefore not enumerable, not an ownership assertion. The class XML-doc
comment (`DevicesController.cs:13-19`) claims ownership "is stamped server-side from the
authenticated user" without qualification; that holds for PUT but overstates DELETE, so the code, not
the comment, is authoritative here ([Rubric §11, Security]). The registrar it delegates to lives in
[Group 07](group-07-persistence-ef-core.md#ipushdeviceregistrar).

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
[`DisabledUserNotificationExportService`](#disabledusernotificationexportservice) so the cross-module
interface still resolves (`NotificationModule.cs:34-35`)
([Rubric §30, Compliance, Privacy & Data Governance]).

## Where this group sits

Upstream, this group depends on the domain building blocks of
[Group 02](group-02-domain-building-blocks.md) (both aggregates derive from
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)),
the [`Result`](group-01-result-error-handling.md#result) pattern of
[Group 01](group-01-result-error-handling.md), the CQRS pipeline and
[`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) of persistence
([Group 07](group-07-persistence-ef-core.md)), and the module system of
[Group 14](group-14-module-system-composition.md). Downstream, the Blazor UI of
[Group 15](group-15-common-ui-framework.md) consumes it: the notification bell, inbox, and send
pages call these REST endpoints, and the UI's SignalR client listens on the hub's
`ReceiveNotification` / `ReceiveChannelEvent` methods (`NotificationHub.cs:20-23`). The ADC
Engagement live layer is the busiest producer of live-channel events, resolving attendees through the
[Identity module](group-24-identity-module.md#iattendeequeryservice). Read this chapter as the
answer to one question: how does a single "notify everyone" intent become a durable inbox row, a
real-time toast, an OS push, and (for the live layer) an ephemeral group event, without any of the
four ever taking the others down.

### GetMyNotificationsQuery
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetInbox` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetInbox/GetMyNotificationsQuery.cs:7` · Level 0 · record

- **What it is**: the read request that backs a user's in-app notification inbox: "give me page N of my notifications." A `sealed record` carrying the caller's `UserId` plus paging arguments.
- **Depends on**: the solution-wide `UserIdentifierType` alias (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)); BCL only otherwise. Consumed by [`GetMyNotificationsHandler`](#getmynotificationshandler) through the query side of the CQRS pipeline ([`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)).
- **Concept introduced**: **the paged-query record shape.** This is the first notification query, so note the convention it shares with every read in the codebase: an immutable positional `record` with defaulted paging (`PageNumber = 1`, `PageSize = 20`, lines 9-10) is the message, a matching handler is the behavior, and the two are joined by a closed generic registration rather than a direct call (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:58`). `[Rubric §6, CQRS & Event-Driven]` assesses whether reads and writes are modeled as distinct, single-purpose messages, and this record is a pure read with no side effects. `[Rubric §12, Performance & Scalability]` assesses guarding against unbounded work: the XML doc pins `PageSize` at "max 500" (line 6) and [`GetMyNotificationsHandler`](#getmynotificationshandler) enforces that ceiling, so a client cannot request an unbounded page.
- **Walkthrough**: three positional members: `UserId` (the authenticated user, line 8), `PageNumber` defaulting to 1 (line 9), `PageSize` defaulting to 20 (line 10). No factory, no validation here: it is a plain carrier, and the page ceiling is applied downstream in the handler.
- **Why it's built this way**: a positional record gives value equality and immutability for free, which is exactly what a query message wants (it is data in flight, never mutated). The default page size keeps the common "just show my inbox" call one-argument-simple.
- **Where it's used**: constructed by [`InboxController`](#inboxcontroller) from the resolved caller id and the query-string paging values (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationInboxController.cs:50`), then handled by [`GetMyNotificationsHandler`](#getmynotificationshandler).

---

### GetNotificationHistoryQuery
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.UseCases.GetHistory` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/GetHistory/GetNotificationHistoryQuery.cs:6` · Level 0 · record

- **What it is**: the read request for the push-notification *sent history* (the admin-facing "what did we broadcast" list), as opposed to a single user's inbox. A `sealed record` of paging arguments only.
- **Depends on**: BCL only. Handled by [`GetNotificationHistoryHandler`](#getnotificationhistoryhandler).
- **Concept introduced**: none new; this is the same paged-query shape [`GetMyNotificationsQuery`](#getmynotificationsquery) introduced, minus a user filter. History is global (it lists [`PushNotification`](#pushnotification) rows, the sent artifacts), so there is no `UserId` member. `[Rubric §6, CQRS & Event-Driven]`: a second read model (sent history) distinct from the inbox read model, each with its own query and handler.
- **Walkthrough**: two positional members, `PageNumber = 1` (line 7) and `PageSize = 10` (line 8). Note the default page size is 10 here versus 20 for the inbox; both are capped at 500 by their handlers, and both XML docs state the ceiling (line 5).
- **Where it's used**: constructed by [`NotificationsController`](#notificationscontroller) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:64`), handled by [`GetNotificationHistoryHandler`](#getnotificationhistoryhandler).

---

### GetUnreadNotificationCountQuery
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetUnreadCount` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetUnreadCount/GetUnreadNotificationCountQuery.cs:5` · Level 0 · record

- **What it is**: the tiniest read in the group: "how many unread notifications does this user have?" A single-line `sealed record` wrapping `UserId`. Its XML doc (line 3) names the unread badge as the reason it exists.
- **Depends on**: the `UserIdentifierType` alias; BCL only otherwise. Handled by [`GetUnreadNotificationCountHandler`](#getunreadnotificationcounthandler).
- **Concept introduced**: none new; a purpose-built count query rather than fetching a page and counting client-side. `[Rubric §12, Performance & Scalability]`: a dedicated `COUNT` query avoids materializing rows just to size a badge, so the bell can poll cheaply.
- **Walkthrough**: one positional member, `UserId` (line 5). No paging: the answer is a single integer.
- **Where it's used**: constructed by [`InboxController`](#inboxcontroller)'s unread-count action (`NotificationInboxController.cs:69`) behind the [`NotificationBell`](group-15-common-ui-framework.md#notificationbell) badge; handled by [`GetUnreadNotificationCountHandler`](#getunreadnotificationcounthandler).

---

### IEmailSender
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IEmailSender.cs:6` · Level 0 · interface

- **What it is**: the Application-layer port for sending email. Two `SendAsync` overloads: one to an explicit recipient, one to a default/system recipient (admin notifications). Infrastructure supplies the concrete transport.
- **Depends on**: BCL only (`Task`, `CancellationToken`). Implemented by [`SmtpEmailSender`](#smtpemailsender) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/SmtpEmailSender.cs:12`).
- **Concept introduced**: **the port/adapter split for outbound side effects.** Application code that needs to send mail depends on this interface, never on an SMTP client; the XML doc names SMTP or SendGrid as interchangeable backings (line 4). `[Rubric §3, Clean Architecture]` assesses whether the core depends inward on abstractions rather than outward on I/O libraries, and this interface is a textbook outbound port: the dependency arrow points from Infrastructure's [`SmtpEmailSender`](#smtpemailsender) *into* Application, so the transport is swappable without touching a handler. `[Rubric §1, SOLID]` (Dependency Inversion): the high-level policy owns the contract, the low-level detail implements it.
- **Walkthrough**: `SendAsync(string to, string subject, string body, bool isHtml = false, CancellationToken cancellationToken = default)` (line 15): explicit recipient, HTML flag defaulting to plain text. `SendAsync(string subject, string body, bool isHtml = false, CancellationToken cancellationToken = default)` (line 23): the same message routed to the implementation's configured default/system recipient (organizer or admin alerts), so callers that always mail the operators do not repeat the address.
- **Why it's built this way**: keeping the interface in Application (and the SMTP dependency in Infrastructure) is what lets a test host register a no-op sender and production register [`SmtpEmailSender`](#smtpemailsender). Registration is `TryAddTransient<IEmailSender, SmtpEmailSender>()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:194`), so the `TryAdd` lets a host pre-register its own sender and win.
- **Where it's used**: registered by the Infrastructure DI extension so any consuming app can inject it. As of this reading there are **no first-party injection sites in MMCA.Common or MMCA.ADC** beyond that registration and the [`SmtpEmailSender`](#smtpemailsender) implementation itself: this is a capability the framework offers rather than one the ADC feature set currently calls.
- **Caveats / not-in-source**: the "default/system recipient" of the second overload is not defined by this interface; it is whatever the implementation's SMTP settings configure.

---

### ILiveChannelPublisher
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ILiveChannelPublisher.cs:9` · Level 0 · interface

- **What it is**: the port for publishing *ephemeral* live events to a channel of currently-connected clients (for example `event:1` or `session:123`). Its defining property, stated in the XML doc (lines 4-6): channel events are **not persisted**, so a client that is not connected and subscribed at publish time never sees them.
- **Depends on**: BCL only. Contrast with [`IPushNotificationSender`](#ipushnotificationsender) (which persists a [`PushNotification`](#pushnotification) plus per-user [`UserNotification`](#usernotification) inbox rows), a contrast the XML doc draws explicitly via `<see cref="IPushNotificationSender"/>` (line 5). Implemented by [`SignalRLiveChannelPublisher`](#signalrlivechannelpublisher) and the [`NullLiveChannelPublisher`](#nulllivechannelpublisher) no-op.
- **Concept introduced**: **ephemeral fan-out versus durable notification.** This is the distinction that splits the whole group in two: live channel events (poll-results-changed, a new session question) are fire-and-forget to whoever is watching *right now*, while push notifications are durable and land in an inbox. The interface deliberately speaks in strings (a `channelKey`, an application-defined `eventName`, a `payloadJson` string) so it stays transport-agnostic; the XML doc names SignalR groups or a message fan-out service as candidate backings (line 7). `[Rubric §7, Microservices Readiness]` assesses whether cross-boundary calls go through abstractions that can be re-homed onto a network transport: in MMCA.ADC this exact interface is served over gRPC by the Notification host's [`LiveChannelGrpcService`](#livechannelgrpcservice) (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/LiveChannelGrpcService.cs:19`), so the boundary already survives extraction (ADR-007, ADR-008).
- **Walkthrough**: one method, `PublishAsync(string channelKey, string eventName, string payloadJson, CancellationToken cancellationToken = default)` (line 17): publish an event to every client currently subscribed to `channelKey`. No return value beyond the `Task`, because there is no delivery guarantee to report.
- **Why it's built this way**: a JSON-string payload plus a free-form event name keeps the framework out of the business of knowing each live event's schema; the presentation and UI layers agree on the contract. Non-delivery to absent clients is the intended semantics, not a gap. The default registration is the inert [`NullLiveChannelPublisher`](#nulllivechannelpublisher) (`MMCA.Common.Infrastructure/DependencyInjection.cs:196`), replaced by [`SignalRLiveChannelPublisher`](#signalrlivechannelpublisher) when a host opts into the SignalR wiring (line 269).
- **Where it's used**: ADC's conference-day live layer injects it into the Engagement command handlers that change live state, [`OpenLivePollHandler`](group-23-engagement-live-layer.md#openlivepollhandler) (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/LivePolls/UseCases/Open/OpenLivePollHandler.cs:22`), [`SubmitQuestionHandler`](group-23-engagement-live-layer.md#submitquestionhandler) (`SubmitQuestionHandler.cs:27`), plus the moderate and upvote handlers, and forwards them in FIFO order through [`LiveChannelPublishProcessor`](group-22-engagement-module.md#livechannelpublishprocessor).
- **Caveats / not-in-source**: the interface itself makes no delivery or ordering guarantee; those are properties of the concrete SignalR and gRPC wiring, not visible here.

---

### INotificationRecipientProvider
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/INotificationRecipientProvider.cs:8` · Level 0 · interface

- **What it is**: a single-method port returning the set of user IDs that should receive a broadcast push notification. The framework knows *how* to send; the consuming app implements this to answer *who* (the XML doc's examples, lines 5-6: all attendees, users in a role, subscribers to a topic).
- **Depends on**: the `UserIdentifierType` alias; BCL only otherwise. Works alongside [`IPushNotificationSender`](#ipushnotificationsender). The default framework registration is [`NullNotificationRecipientProvider`](#nullnotificationrecipientprovider); MMCA.ADC supplies [`AttendeeNotificationRecipientProvider`](#attendeenotificationrecipientprovider).
- **Concept introduced**: **separating recipient policy from delivery mechanism.** "Who to notify" is app-specific domain knowledge; "how to notify" is framework infrastructure. Splitting them means the push pipeline never needs to understand ADC's attendee model. `[Rubric §7, Microservices Readiness]`: an inversion point that lets the shared framework host an app-defined audience query. `[Rubric §1, SOLID]` (Interface Segregation and Dependency Inversion): one focused method, and the sender depends on the abstraction rather than on a concrete audience source.
- **Walkthrough**: `Task<IReadOnlyList<UserIdentifierType>> GetRecipientUserIdsAsync(CancellationToken cancellationToken = default)` (lines 15-16): return the eligible recipient IDs. A read-only list, so callers cannot mutate the returned audience.
- **Why it's built this way**: registration is `TryAddScoped` (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:67`), which is the mechanical expression of "framework default, app override": whichever provider the app registers first wins, and the null default only fills the gap.
- **Where it's used**: [`SendPushNotificationHandler`](#sendpushnotificationhandler) takes it as a constructor dependency (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:19`), resolves the audience, then hands it to [`IPushNotificationSender`](#ipushnotificationsender). Until an app registers its own provider, [`NullNotificationRecipientProvider`](#nullnotificationrecipientprovider) returns an empty audience.

---

### IPushNotificationSender
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IPushNotificationSender.cs:7` · Level 0 · interface

- **What it is**: the Application-layer port for real-time push delivery, with three targeting shapes: one user, a set of users, or a broadcast to everyone connected. The XML doc names SignalR or Firebase Cloud Messaging as interchangeable backings (lines 4-5).
- **Depends on**: the `UserIdentifierType` alias; BCL `Dictionary` for the optional metadata. Implemented by [`SignalRPushNotificationSender`](#signalrpushnotificationsender) (real delivery) and [`NullPushNotificationSender`](#nullpushnotificationsender) (the inert default). Paired with [`INotificationRecipientProvider`](#inotificationrecipientprovider) for audience resolution.
- **Concept introduced**: **the metadata dictionary as an open payload.** All three methods share `title`, `body`, and an optional `Dictionary<string, string>? metadata` (lines 16, 25, 33). That dictionary carries typed extras (a deep-link URL, a notification type, per the XML doc on line 13) without a bespoke strongly-typed payload per notification kind, so a new notification variety needs no interface change. `[Rubric §10, Cross-Cutting Concerns]` assesses whether a capability like push is factored once and reused broadly, and this single port serves every push-emitting feature. This is the *durable* counterpart to [`ILiveChannelPublisher`](#ilivechannelpublisher)'s ephemeral fan-out.
- **Walkthrough**: `SendToUserAsync(UserIdentifierType userId, string title, string body, Dictionary<string,string>? metadata = null, CancellationToken cancellationToken = default)` (line 16): one user. `SendToUsersAsync(IEnumerable<UserIdentifierType> userIds, ...)` (line 25): an explicit set. `BroadcastAsync(string title, string body, ...)` (line 33): all connected clients. The three methods differ only in targeting; body and metadata are identical.
- **Why it's built this way**: three targeting methods rather than one "audience" parameter keeps each call site's intent explicit and lets the SignalR implementation map user-targeting to hub groups directly. The default registration is the no-op (`MMCA.Common.Infrastructure/DependencyInjection.cs:195`) so a host with no real-time transport still resolves the port; the SignalR wiring replaces it with `AddTransient` (line 268), a deliberate override rather than a `TryAdd`.
- **Where it's used**: [`SendPushNotificationHandler`](#sendpushnotificationhandler) fans a message out through this port after persisting the [`PushNotification`](#pushnotification) record and its per-user [`UserNotification`](#usernotification) rows.

---

### KestrelConfiguration
> MMCA.ADC.Notification.Service · `MMCA.ADC.Notification.Service` · `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/KestrelConfiguration.cs:10` · Level 0 · class

- **What it is**: the Notification host's Kestrel endpoint wiring, lifted out of `Program.cs` into an `internal static` helper. It applies the mixed-protocol endpoint defaults the SignalR-plus-gRPC host needs and, when configured, adds a dedicated HTTP/1.1 health-probe listener.
- **Depends on**: ASP.NET Core hosting types only (`WebApplicationBuilder`, `HttpProtocols` from `Microsoft.AspNetCore.Server.Kestrel.Core`, line 1) and the host's `IConfiguration`. No first-party types. Three sibling classes of the same name exist in the Conference, Engagement, and Identity service hosts; this is the Notification one.
- **Concept introduced**: **per-endpoint protocol selection, not per-host.** This is the ADR-012 story in one method. The Notification service hosts the SignalR hub ([`NotificationHub`](#notificationhub)), whose WebSocket transport needs the HTTP/1.1 `Upgrade` handshake, *and* an inbound cleartext gRPC server ([`LiveChannelGrpcService`](#livechannelgrpcservice)) that needs h2c prior-knowledge HTTP/2. No single whole-host protocol profile satisfies both, so the protocols are split across two endpoints in one process: `appsettings.json` declares `http` on port 8080 as `Http1AndHttp2` and `grpc` on port 8081 as `Http2` (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.json:9-20`), and this class supplies the defaults plus the probe listener around them. `[Rubric §7, Microservices Readiness]` assesses whether a service's transport story survives being split out: here it does, at the cost of an explicit per-endpoint protocol map. `[Rubric §13, Observability & Operability]`: the separate probe listener exists so platform health probes never depend on the protocol choices the application traffic needs. `[Rubric §17, DevOps]`: the probe port is injected by infrastructure (`HealthProbe__Port`) rather than hardcoded, so local runs and Azure Container Apps share one code path.
- **Walkthrough**: one public method, `ConfigureMixedEndpointsWithHealthProbe(WebApplicationBuilder builder)` (line 23). It null-guards the builder (line 25), then calls `builder.WebHost.ConfigureKestrel` (line 27). Inside: `ConfigureEndpointDefaults` sets `HttpProtocols.Http1AndHttp2` (line 29), which is the default applied to endpoints that do not state their own protocol (the config-declared `http` and `grpc` endpoints keep their explicit values). Then `builder.Configuration.GetValue<int?>("HealthProbe:Port")` is pattern-matched with `is int probePort` (line 31), and only when the value is present does it `ListenAnyIP(probePort, o => o.Protocols = HttpProtocols.Http1)` (line 33). The XML doc records that the value arrives as `HealthProbe__Port`=8082 from `infra/main.bicep` and is absent locally (lines 15-16), so locally the third listener simply does not exist.
- **Why it's built this way**: two reasons are stated in source. First, config-declared Kestrel endpoints and explicit `Listen` calls coexist, so adding the probe listener is strictly additive rather than a replacement (XML doc, lines 17-18). Second, the class exists at all so `Program.cs` stays inside the S1541 cyclomatic-complexity budget the analyzers enforce (lines 7-8): a small structural concession to analyzers-as-errors. See ADR-012 for the transport convention this implements.
- **Where it's used**: called once from the Notification host's startup (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:70`).

---

### UserNotificationExportItemDTO
> MMCA.ADC.Notification.Shared · `MMCA.ADC.Notification.Shared.UserNotifications` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/UserNotifications/UserNotificationExportItemDTO.cs:7` · Level 0 · record

- **What it is**: one notification-inbox row inside a user's *personal-data export* (the data-subject access artifact the XML doc ties to PRIVACY.md §7, line 4): the notification id, title, and sent/read timestamps. This is an MMCA.ADC-specific contract, not a framework type.
- **Depends on**: the ADC `UserNotificationIdentifierType` alias; BCL `string` and `DateTime`. Returned by [`IUserNotificationExportService`](#iusernotificationexportservice); consumed by the Identity module's [`ExportUserDataHandler`](group-24-identity-module.md#exportuserdatahandler) and folded into [`UserDataExportNotificationDTO`](group-24-identity-module.md#userdataexportnotificationdto).
- **Concept introduced**: **export DTOs deliberately omit content.** The XML doc (line 5) records that the notification *body* is left out of the summary by design; the export carries the metadata a data subject is owed (that they were notified, when, whether they read it) without duplicating message bodies. `[Rubric §30, Compliance/Privacy/Data Governance]` assesses whether the codebase has concrete data-subject access and portability paths, and this DTO is the Notification module's contribution to that per-user export.
- **Walkthrough**: a `sealed record class` with `required NotificationId` (line 10), `required Title` (line 13), `required SentOn` (line 16, UTC), plus `IsRead` (line 19) and nullable `ReadOn` (line 22, null when unread). The `required` members force every export row to be fully populated at construction; the two optional members model the "never read" case without a sentinel date.
- **Why it's built this way**: a flat immutable record is the right shape for a serialized export line: value semantics, no behavior, self-describing timestamps in UTC. Being `init`-only means an export row cannot be edited after assembly.
- **Where it's used**: assembled by the in-process [`UserNotificationExportService`](#usernotificationexportservice) and returned across the export boundary to Identity; the disabled-module path substitutes [`DisabledUserNotificationExportService`](#disabledusernotificationexportservice) and the out-of-process path [`UserNotificationExportServiceGrpcAdapter`](#usernotificationexportservicegrpcadapter).

---

### IUserNotificationExportService
> MMCA.ADC.Notification.Shared · `MMCA.ADC.Notification.Shared.UserNotifications` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/UserNotifications/IUserNotificationExportService.cs:11` · Level 1 · interface

- **What it is**: the cross-module service contract for exporting the personal data the Notification module holds for one user: their inbox rows (ids, titles, sent and read dates). It is how the Identity module reaches into Notification-owned data to build a complete cross-service export.
- **Depends on**: [`UserNotificationExportItemDTO`](#usernotificationexportitemdto) (its return element) and the ADC `UserIdentifierType` alias. Implemented in-process by [`UserNotificationExportService`](#usernotificationexportservice) inside the Notification module and, per the XML doc (lines 8-9), by a gRPC adapter in `MMCA.ADC.Notification.Contracts` everywhere else; the disabled-module stub is [`DisabledUserNotificationExportService`](#disabledusernotificationexportservice).
- **Concept introduced**: **the "one interface, in-process or gRPC" extraction pattern.** The XML doc calls out that this mirrors Engagement's `IUserEngagementExportService`: a single interface the caller depends on, satisfied by an in-process implementation when the module is co-hosted (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Application/DependencyInjection.cs:28`) and by a gRPC adapter that `Replace`s that registration when it is not (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/DependencyInjection.cs:84`). `[Rubric §7, Microservices Readiness]` assesses exactly this: whether a module boundary is expressed as an interface that can be re-homed onto a network transport without changing the caller (ADR-007 for gRPC extraction, ADR-008 for topology). `[Rubric §30, Compliance/Privacy]`: it is one leg of the data-subject-access aggregation. `[Rubric §9, API & Contract Design]`: the contract is a plain async method over DTOs, so the same shape serves both the in-process and the wire binding.
- **Walkthrough**: one method, `GetUserNotificationExportAsync(UserIdentifierType userId, CancellationToken cancellationToken)` (line 20), returning `IReadOnlyList<UserNotificationExportItemDTO>` newest-first. Note the token has **no default value** here, so every caller must pass one explicitly. The XML doc (lines 14-15) states the implementation joins the framework [`UserNotification`](#usernotification) rows with their [`PushNotification`](#pushnotification) content, which is the same join the inbox read performs.
- **Where it's used**: the Identity module's [`ExportUserDataHandler`](group-24-identity-module.md#exportuserdatahandler) takes it as a constructor dependency (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:29`) and merges the result into the full export, unaware of which of the three implementations it received.

---

### NullNotificationRecipientProvider
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/NullNotificationRecipientProvider.cs:8` · Level 1 · class

- **What it is**: the framework's default [`INotificationRecipientProvider`](#inotificationrecipientprovider): a Null Object that resolves an empty recipient list.
- **Depends on**: [`INotificationRecipientProvider`](#inotificationrecipientprovider) (the interface it fulfills); BCL only.
- **Concept introduced**: the **Null Object pattern**. `[Rubric §2, Design Patterns]` assesses idiomatic pattern use; here a benign default lets the push pipeline resolve and run in a host that has not (yet) declared an audience, so there is no null check in [`SendPushNotificationHandler`](#sendpushnotificationhandler) and no "provider not registered" failure at startup. MMCA.Common ships this as the default; a consuming app overrides it (in MMCA.ADC, [`AttendeeNotificationRecipientProvider`](#attendeenotificationrecipientprovider)).
- **Walkthrough**: a `sealed class` with one method. `GetRecipientUserIdsAsync` (lines 11-13) returns `Task.FromResult<IReadOnlyList<UserIdentifierType>>([])`, an empty collection expression: no I/O, no allocation of a populated list, and the explicit type argument keeps the returned task typed as the interface's read-only list.
- **Why it's built this way**: the XML doc (lines 5-6) states the expectation directly, that consuming apps should register their own provider. Pairing that with the `TryAddScoped` default registration means "safe by default, overridable without ceremony."
- **Where it's used**: registered by the notification DI extension (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:67`); a broadcast that resolves recipients through this default simply reaches nobody until an app-specific provider replaces it.

---

### DisabledUserNotificationExportService
> MMCA.ADC.Notification.Shared · `MMCA.ADC.Notification.Shared.UserNotifications` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/UserNotifications/DisabledUserNotificationExportService.cs:7` · Level 2 · class

- **What it is**: the stub [`IUserNotificationExportService`](#iusernotificationexportservice) registered when the Notification module is disabled in a given host. It returns an empty inbox export.
- **Depends on**: [`IUserNotificationExportService`](#iusernotificationexportservice) and [`UserNotificationExportItemDTO`](#usernotificationexportitemdto); BCL only.
- **Concept introduced**: none new; it is the same Null Object idea as [`NullNotificationRecipientProvider`](#nullnotificationrecipientprovider), applied to the module-disabled path. `[Rubric §7, Microservices Readiness]`: the module system keeps cross-module interfaces resolvable even when a module is switched off, because [`IModule`](group-14-module-system-composition.md#imodule) has a dedicated `RegisterDisabledStubs` hook that [`NotificationModule`](#notificationmodule) implements with exactly this registration (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/NotificationModule.cs:35`). Identity's export handler still binds its dependency and simply gets no notification rows rather than a resolution failure.
- **Walkthrough**: `GetUserNotificationExportAsync` (lines 10-11) returns `Task.FromResult<IReadOnlyList<UserNotificationExportItemDTO>>([])`, ignoring both the `userId` and the token. Registered as a singleton, which is safe precisely because it holds no state.
- **Why it's built this way**: a disabled module must not turn an unrelated feature (the data-subject export) into a 500. Returning an empty section is the honest answer: the module holds no data in this host.
- **Where it's used**: the disabled-stub path of [`NotificationModule`](#notificationmodule), so a host running without the Notification module still produces a valid (empty) notification section in a user data export.

---

### GetMyNotificationsHandler
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetInbox` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetInbox/GetMyNotificationsHandler.cs:15` · Level 8 · class

- **What it is**: the query handler that materializes a user's inbox page. It joins the per-user [`UserNotification`](#usernotification) rows with their shared [`PushNotification`](#pushnotification) content and projects the pair into a single flat [`UserNotificationDTO`](#usernotificationdto).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (typed repositories) and [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) (EF terminal operations kept out of Application), injected via primary constructor (lines 15-17). Implements [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)`<GetMyNotificationsQuery, Result<PagedCollectionResult<UserNotificationDTO>>>`. Returns [`Result`](group-01-result-error-handling.md#result), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), and [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata).
- **Concept introduced**: **the two-table inbox join and why the model is split.** A push notification is stored once (the [`PushNotification`](#pushnotification): title, body, created time) and fanned out into one lightweight [`UserNotification`](#usernotification) per recipient (which carries only per-user state: `IsRead`, `ReadOn`). The read side rejoins them. `[Rubric §8, Data Architecture]` assesses normalization and read/write model fit: the shared content is not duplicated per recipient, and the handler pays a join at read time to reassemble the inbox view. `[Rubric §3, Clean Architecture]`: the handler expresses the join as a LINQ `IQueryable` but never calls EF's `ToListAsync` or `CountAsync` directly, delegating those to [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) so Application stays EF-free.
- **Walkthrough**: clamp the page size to a 500 ceiling with `Math.Min(query.PageSize, 500)` (line 24); grab the two repositories from the unit of work, each typed by entity and identifier alias (lines 25-26); build the LINQ query-syntax join of `UserNotification` to `PushNotification` on `un.PushNotificationId equals pn.Id`, filtered to `query.UserId`, ordered by `pn.CreatedOn` descending, projected into `UserNotificationDTO` (lines 28-41, mapping id, push id, title, body, `IsRead`, `ReadOn`, and `SentOn = pn.CreatedOn`); count the joined set (line 43); page it with `Skip((query.PageNumber - 1) * pageSize).Take(pageSize)` and materialize (lines 45-47); wrap total, page size, and page number into [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata) and return a successful [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) (lines 49-50).
- **Why it's built this way**: both repositories are read through `TableNoTracking`, which is correct for a read: no change-tracking overhead since nothing is saved. Server-side projection into the DTO means only the needed columns cross the wire, and the count runs against the *same* joined expression so the total is consistent with the page. Note the count and the page are two round trips against one composed `IQueryable`, the standard cost of a paged read.
- **Where it's used**: injected as a closed `IQueryHandler` into [`InboxController`](#inboxcontroller) (`NotificationInboxController.cs:30`), which is how it reaches the CQRS decorator pipeline described in [Group 05](group-05-cqrs-pipeline.md).

---

### GetNotificationHistoryHandler
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.UseCases.GetHistory` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/GetHistory/GetNotificationHistoryHandler.cs:14` · Level 8 · class

- **What it is**: the query handler for the push *sent history*: a reverse-chronological page of [`PushNotification`](#pushnotification) rows (no per-user join), mapped to [`PushNotificationDTO`](#pushnotificationdto).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor), and [`PushNotificationDTOMapper`](#pushnotificationdtomapper) (primary constructor, lines 14-17). Implements [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)`<GetNotificationHistoryQuery, Result<PagedCollectionResult<PushNotificationDTO>>>`.
- **Concept introduced**: none new; note the contrast with the inbox handler. History reads a *single* table (the sent artifacts) with no `UserId` filter, and maps entities to DTOs with an explicit [`PushNotificationDTOMapper`](#pushnotificationdtomapper) rather than an inline LINQ projection, which means it materializes whole entities before mapping. `[Rubric §6, CQRS & Event-Driven]`: a separate read model and handler for the admin history view, sharing nothing with the inbox read but the underlying table.
- **Walkthrough**: clamp page size to 500 (line 24); get the [`PushNotification`](#pushnotification) repository (line 25); ask the repository itself for the total via `repository.CountAsync` (line 27, note this one goes through the repository, not the queryable executor, because there is no composed predicate to count); page `TableNoTracking` ordered by `CreatedOn` descending with `Skip`/`Take` and materialize the entities through the executor (lines 29-34); run them through `dtoMapper.MapToDTOs` (line 36); build [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata) (line 37) and return a successful [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) (line 39).
- **Why it's built this way**: history has no per-user state, so there is nothing to join; a dedicated mapper (versus an inline projection) is used because [`PushNotificationDTO`](#pushnotificationdto) is a richer, reused contract mapped in several places, and centralizing that mapping keeps the shape consistent (see ADR-001 on manual/Mapperly mapping).
- **Where it's used**: injected into [`NotificationsController`](#notificationscontroller)'s history endpoint (`NotificationsController.cs:30`).

---

### GetUnreadNotificationCountHandler
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetUnreadCount` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetUnreadCount/GetUnreadNotificationCountHandler.cs:12` · Level 8 · class

- **What it is**: the query handler behind the unread badge: it counts a user's unread [`UserNotification`](#usernotification) rows and returns the integer.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) (primary constructor, lines 12-14). Implements [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)`<GetUnreadNotificationCountQuery, Result<int>>`.
- **Concept introduced**: none new; the smallest possible read, and a good illustration of why [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) exists: the handler composes a `Where` in Application and hands the still-unexecuted `IQueryable` to Infrastructure to run. `[Rubric §12, Performance & Scalability]`: it issues a server-side `COUNT` over `un.UserId == query.UserId && !un.IsRead` rather than fetching rows, so the bell can poll without materializing the inbox.
- **Walkthrough**: get the [`UserNotification`](#usernotification) repository from the unit of work (line 21); `queryableExecutor.CountAsync` over `TableNoTracking` filtered to the user's unread rows (lines 23-25); return `Result.Success(count)` (line 27). No paging, no mapping, no failure branch: the count either comes back or the call throws through the pipeline.
- **Where it's used**: injected into [`InboxController`](#inboxcontroller) (`NotificationInboxController.cs:31`), which serves the [`NotificationBell`](group-15-common-ui-framework.md#notificationbell) badge.

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
- **Why it's built this way**: the doc comment attributes the shape to ADR-044 (native push
  registration). A stable client id plus a rotating platform channel is the standard installation model
  both FCM v1 and APNs expect, and keeping ownership server-stamped keeps the trust boundary at the
  authenticated request.
- **Where it's used**: the device-registration endpoint on the push pipeline in
  `MMCA.Common.Infrastructure` (the SignalR/native push senders, see the group overview).

### MarkAllNotificationsReadCommand
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkAllRead` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkAllRead/MarkAllNotificationsReadCommand.cs:5` · Level 0 · record (sealed)

- **What it is**: the CQRS command to mark *every* unread inbox notification as read for one user. A
  single-parameter positional record carrying only the `UserId` that scopes the bulk update
  (`MarkAllNotificationsReadCommand.cs:5`).
- **Depends on**: nothing first-party. It uses the `UserIdentifierType` alias (a solution-wide `global
  using ... = int;` linked via `Directory.Build.props`), so there is no first-party type edge.
- **Concept**: the "mark all read" bulk sibling of
  [MarkNotificationReadCommand](#marknotificationreadcommand). Where the single-item command carries
  both a `NotificationId` and a `UserId`, this one carries only the owner: the target set is "all of
  the user's unread rows," so the row identity is implicit in the scope rather than passed explicitly.
  `[Rubric §6, CQRS & Event-Driven]` assesses whether writes flow through explicit command messages;
  this is the minimal shape of a scope-only command.
- **Walkthrough**: one positional parameter, `UserId` (`MarkAllNotificationsReadCommand.cs:5`). No
  marker interfaces are declared on the type, so it rides the default command pipeline unadorned.
- **Where it's used**: handled by [MarkAllNotificationsReadHandler](#markallnotificationsreadhandler);
  the authenticated `UserId` is supplied by the controller from the token claim, never by the client
  body.

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

### MarkAllNotificationsReadHandler
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkAllRead` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkAllRead/MarkAllNotificationsReadHandler.cs:11` · Level 8 · class (sealed)

- **What it is**: the command handler that marks *all* of one user's unread inbox notifications as read
  in a single pass.
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (repository + save),
  [IQueryableExecutor](group-07-persistence-ef-core.md#iqueryableexecutor) (async materialization),
  `TimeProvider` (BCL, testable clock), [MarkAllNotificationsReadCommand](#markallnotificationsreadcommand)
  (input), and [Result](group-01-result-error-handling.md#result) (outcome).
- **Concept, the owner-scoped bulk update.** This is the fan-in counterpart to the single-item
  [MarkNotificationReadHandler](#marknotificationreadhandler). `[Rubric §11, Security]` assesses whether
  authorization is enforced where the data is touched: the read filters on `un.UserId == command.UserId`
  (`MarkAllNotificationsReadHandler.cs:24`), so only the requesting user's rows are ever loaded and
  mutated. `[Rubric §14, Testability]` shows in the injected `TimeProvider`: the read timestamp comes
  from `timeProvider.GetUtcNow().UtcDateTime` (line 27), not `DateTime.UtcNow`, so a test can pin the
  clock.
- **Walkthrough**: `HandleAsync` (lines 17-39) gets the `UserNotification` repository from the unit of
  work (line 21), materializes every unread row for the user with a `Where(UserId == && !IsRead)` query
  through the queryable executor (lines 23-25), captures one shared `readOnUtc` (line 27), then loops
  and calls the aggregate's idempotent `MarkAsRead(readOnUtc)` on each (lines 28-31). It saves through
  the unit of work only when at least one row changed (`unread.Count > 0`, lines 33-36) and always
  returns `Result.Success()` (line 38). There is no `NotFound` path: an empty inbox is a successful
  no-op. Every await uses `ConfigureAwait(false)`.
- **Why it's built this way**: filtering to `!IsRead` up front keeps the write set minimal, and gating
  the save on `Count > 0` avoids opening a transaction (and stamping audit fields) when nothing changed.
  Keeping idempotency inside the aggregate's `MarkAsRead` means a re-run is harmless.
- **Where it's used**: dispatched by the inbox controller's mark-all-read action, with the authenticated
  user id supplied server-side.

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
> MMCA.ADC.Notification.Service · `MMCA.ADC.Notification.Service.Grpc` · `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/LiveChannelGrpcService.cs:19` · Level 1 · class (sealed)

- **What it is**: the gRPC **server** endpoint that other services call to fan an ephemeral "live"
  event out to connected clients. It implements the generated
  `LiveChannelPushService.LiveChannelPushServiceBase` and delegates each call to the framework's
  [ILiveChannelPublisher](#ilivechannelpublisher).
- **Depends on**: [ILiveChannelPublisher](#ilivechannelpublisher) (injected via the primary
  constructor, line 19; in this host it resolves to [SignalRLiveChannelPublisher](#signalrlivechannelpublisher),
  registered by `AddPushNotifications` because Notification is the host that maps the SignalR
  [NotificationHub](#notificationhub)), the generated `LiveChannelPushService` base (compiled from the
  `.Contracts` `.proto`, line 20), and `Grpc.Core.ServerCallContext`.
- **Concept introduced, the live-channel ingress (ADR-039).** `[Rubric §6, CQRS & Event-Driven]`
  assesses whether state changes travel as events; `[Rubric §7, Microservices Readiness]` assesses
  whether cross-process collaboration rides typed transports. The conference-day live layer (LivePolls,
  SessionQuestions) lives in the Engagement service, but only the Notification host owns the SignalR
  `IHubContext` that can reach browsers. So Engagement calls THIS gRPC endpoint **post-commit** to hand
  off an ephemeral event, which the service passes to the local publisher that fans it out over
  [NotificationHub](#notificationhub). This is the server half; its client half is
  [LiveChannelPublisherGrpcAdapter](#livechannelpublishergrpcadapter).
- **Walkthrough**: the single `PushToChannel` override (line 23) null-guards `request` and `context`
  (lines 27-28), then awaits
  `publisher.PublishAsync(request.ChannelKey, request.EventName, request.PayloadJson, context.CancellationToken)`
  (lines 30-32) and returns an empty `PushToChannelResponse` (line 34). The channel key, event name,
  and payload are opaque strings: the transport relays the event rather than modeling it.
- **Why it's built this way (security posture)**: there is deliberately **no `[Authorize]`** (doc
  comment lines 13-17). `[Rubric §11, Security]`: this surface is reachable only on the internal
  service network (a dedicated internal port in Azure Container Apps, never routed by the Gateway), the
  same posture as the other internal gRPC services (for example `AttendeesGrpcService`). The trust
  boundary is the network, not a bearer token. Transport-wise it rides the ADR-012 mixed-endpoint
  profile: Notification keeps its default endpoint `Http1AndHttp2` for SignalR WebSockets and serves
  this h2c gRPC ingress on a dedicated `Http2`-only endpoint.
- **Where it's used**: mapped by the Notification service's `Program.cs`; invoked by
  [LiveChannelPublisherGrpcAdapter](#livechannelpublishergrpcadapter) running inside Engagement.

---

### LiveChannelPublisherGrpcAdapter
> MMCA.ADC.Notification.Contracts · `MMCA.ADC.Notification.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/LiveChannelPublisherGrpcAdapter.cs:20` · Level 1 · class (sealed partial)

- **What it is**: the **client** half of the live-channel ingress. A hand-written adapter that
  implements the framework's [ILiveChannelPublisher](#ilivechannelpublisher) port on top of the
  generated gRPC `LiveChannelPushService.LiveChannelPushServiceClient`, so a publishing service (the
  Engagement live layer) keeps depending on the abstraction while its calls actually cross the wire to
  the Notification host. It is the counterpart to [LiveChannelGrpcService](#livechannelgrpcservice).
- **Depends on**: [ILiveChannelPublisher](#ilivechannelpublisher) (Level 0, the implemented port); the
  generated `LiveChannelPushService.LiveChannelPushServiceClient` (constructor param, line 21);
  `ILogger<LiveChannelPublisherGrpcAdapter>` (line 22). Externals: `Grpc.Core` (per-call deadline),
  the source-generated `[LoggerMessage]` logging.
- **Concept introduced, the best-effort cross-service adapter with a tight deadline.** `[Rubric §7,
  Microservices Readiness]` assesses whether a boundary crossing degrades gracefully; `[Rubric §29,
  Resilience & Business Continuity]` assesses whether a peer outage can take a caller down. This adapter
  is fire-and-forget by contract (ADR-039): a private `static readonly TimeSpan PushDeadline =
  TimeSpan.FromSeconds(2)` (line 26) is deliberately tighter than the shared resilience pipeline's 30s
  attempt timeout, because a live event that takes longer than that is already stale, and every failure
  (transport, resolution, broken circuit) is logged and swallowed, never thrown, so a publishing command
  can never fail because Notification is down or slow.
- **Walkthrough**
  - `PushDeadline` (line 26): the 2-second per-call ceiling.
  - `PublishAsync(channelKey, eventName, payloadJson, cancellationToken)` (line 29): inside a `try`,
    calls `client.PushToChannelAsync(...)` with a `PushToChannelRequest` carrying `ChannelKey`,
    `EventName`, and `PayloadJson` (lines 33-39), passing `deadline: DateTime.UtcNow.Add(PushDeadline)`
    (line 40) and the caller's token. The whole call is wrapped in a `catch (Exception ex)` guarded by a
    justified `#pragma warning disable CA1031` (lines 43-45): a failure calls `LogPushFailed(ex,
    channelKey, eventName)` (line 47) and returns, it never propagates.
  - `LogPushFailed` (lines 51-52): a source-generated `[LoggerMessage]` at `Warning` level.
- **Why it's built this way**: the deadline keeps a publishing request from being held hostage by a slow
  peer, and swallowing the exception keeps the best-effort contract (ADR-039) honest: the live event is
  a courtesy fan-out, not a guaranteed delivery, so its failure must not roll back the business command
  that produced it.
- **Where it's used**: registered by `AddNotificationLiveChannelClient` in the Notification.Contracts
  [DependencyInjection](#dependencyinjection), which `services.Replace(...)`s it over the framework's
  [NullLiveChannelPublisher](#nulllivechannelpublisher) default in ADC's Engagement composition root.
  The server half it dials is [LiveChannelGrpcService](#livechannelgrpcservice); inside the Notification
  host that in turn delegates to [SignalRLiveChannelPublisher](#signalrlivechannelpublisher).

---

### NullLiveChannelPublisher
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullLiveChannelPublisher.cs:11` · Level 1 · class (sealed)

- **What it is**: a no-op implementation of the [ILiveChannelPublisher](#ilivechannelpublisher)
  port. It is the default the container resolves when a host has not wired a real transport, so the
  live-channel path always has *something* to call.
- **Depends on**: [ILiveChannelPublisher](#ilivechannelpublisher) (Level 0). No externals beyond
  the BCL `Task`.
- **Concept introduced, the Null Object pattern for optional infrastructure.** `[Rubric §1, SOLID]`
  assesses the Dependency Inversion Principle: application handlers depend only on the abstraction, and
  the concrete adapter is chosen at the composition root. `[Rubric §29, Resilience & Business
  Continuity]` assesses graceful degradation: rather than leave the port unregistered (which would make
  DI throw when a handler asks for it), the framework registers a member that does nothing, so a host
  that never configures push simply publishes into the void without failing. This is the same idea
  behind [NullNotificationRecipientProvider](#nullnotificationrecipientprovider) and
  [NullNavigationPopulator<TEntity>](group-11-navigation-populators.md#nullnavigationpopulatortentity).
- **Walkthrough**: one method, `PublishAsync(channelKey, eventName, payloadJson, cancellationToken)`
  (line 14), whose whole body is `=> Task.CompletedTask` (line 15). No exception, no logging, no work.
- **Why it's built this way**: the class doc comment (lines 5-10) states the contract: downstream apps
  override this with [SignalRLiveChannelPublisher](#signalrlivechannelpublisher) via
  `AddPushNotifications()`, or with their own transport (in ADC, a gRPC adapter that forwards to the
  host that maps the hub). Because the default resolves cleanly, no host is *forced* to configure a
  real-time transport (ADR-039, live channels are best-effort by design).
- **Where it's used**: registered by the framework so `ILiveChannelPublisher` is always resolvable;
  `AddPushNotifications` swaps it for the SignalR implementation, and in ADC Engagement's composition
  root `services.Replace(...)` overwrites it with the [LiveChannelPublisherGrpcAdapter](#livechannelpublishergrpcadapter)
  (see the Notification.Contracts DI in [DependencyInjection](#dependencyinjection)).

---

### NullPushNotificationSender
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullPushNotificationSender.cs:10` · Level 1 · class (sealed)

- **What it is**: the no-op default for the [IPushNotificationSender](#ipushnotificationsender)
  port, the delivery-side counterpart of [NullLiveChannelPublisher](#nulllivechannelpublisher). It
  lets a host resolve and run the send pipeline even with no real-time transport configured.
- **Depends on**: [IPushNotificationSender](#ipushnotificationsender) (Level 0). Uses the
  solution-wide `UserIdentifierType` alias (see
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Concept**: cross-reference the Null Object pattern taught on
  [NullLiveChannelPublisher](#nulllivechannelpublisher). `[Rubric §29, Resilience]`: because push
  delivery is best-effort (the durable inbox is the source of truth), a missing transport must not
  break sending, it must simply deliver nothing.
- **Walkthrough**: three methods, each `=> Task.CompletedTask`: `SendToUserAsync` (line 13),
  `SendToUsersAsync` (line 17), and `BroadcastAsync` (line 21). Together they mirror the full
  `IPushNotificationSender` surface (single user, batch, broadcast) so the interface is satisfied
  without behavior.
- **Why it's built this way**: the doc comment (lines 5-8) notes downstream apps override this with
  [SignalRPushNotificationSender](#signalrpushnotificationsender) via `AddPushNotifications()`. The
  send handler always calls the port; whether anything reaches a browser is a composition-root decision.
- **Where it's used**: registered as the default `IPushNotificationSender`; replaced by the SignalR
  sender in any host that calls `AddPushNotifications`.

---

### SendPushNotificationCommand
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationCommand.cs:11` · Level 1 · record (sealed)

- **What it is**: the CQRS command that triggers a push-notification broadcast. It wraps a
  [SendPushNotificationRequest](#sendpushnotificationrequest) plus the sender's `UserIdentifierType`.
- **Depends on**:
  [ICommandWithRequest<out TRequest>](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)
  (Level 0), [SendPushNotificationRequest](#sendpushnotificationrequest) (Level 0).
- **Concept**: the *command-wraps-request* idiom (see
  [ICommandWithRequest<out TRequest>](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), G05). The public
  HTTP request is the small `Title`/`Body` record; the command additionally carries server-derived
  context (`SentByUserId`, taken from the caller's token, not the body) so the client cannot spoof the
  sender. Exposing `Request` satisfies the `ICommandWithRequest<SendPushNotificationRequest>` contract,
  which lets the generic validating command decorator run
  [SendPushNotificationRequestValidator](#sendpushnotificationrequestvalidator) automatically in the
  pipeline. `[Rubric §6, CQRS & Event-Driven]`, `[Rubric §11, Security]`.
- **Walkthrough**: a two-property positional record implementing
  `ICommandWithRequest<SendPushNotificationRequest>` (lines 11-13). `Request` is the validated DTO;
  `SentByUserId` is the audit/authorization context.
- **Where it's used**: dispatched by the push-notification API endpoint (the organizer-only
  notification controller); handled by [SendPushNotificationHandler](#sendpushnotificationhandler).

---

### SmtpEmailSender
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/SmtpEmailSender.cs:12` · Level 1 · class (sealed)

- **What it is**: the SMTP adapter for the [IEmailSender](#iemailsender) port. It sends mail through a
  `System.Net.Mail.SmtpClient` configured from
  [ISmtpSettings](group-14-module-system-composition.md#ismtpsettings). This is the entire "email
  channel" of the notification subsystem, independent of the push/inbox flow.
- **Depends on**: [IEmailSender](#iemailsender) (Level 0);
  [ISmtpSettings](group-14-module-system-composition.md#ismtpsettings) (Level 0, injected via the
  primary constructor). Externals: `System.Net.Mail` (`SmtpClient`, `MailMessage`) and `System.Net`
  (`NetworkCredential`).
- **Concept introduced, the settings-bound infrastructure adapter.** `[Rubric §3, Clean Architecture]`
  assesses whether transport detail stays at the edge: the port `IEmailSender` lives in Application,
  and this SMTP concretion lives in Infrastructure, so nothing above it knows what "email" is made of.
  `[Rubric §10, Cross-Cutting Concerns]`: host/port/credentials come from bound configuration
  (`ISmtpSettings`), never hard-coded, so the same code targets a real relay in production and the
  Aspire **MailDev** container locally (SMTP `localhost:1025`, web inbox `http://localhost:1080`).
- **Walkthrough**: the primary constructor copies seven settings into readonly fields (`_host`,
  `_port`, `_username`, `_password`, `_fromAddress`, `_toAddress`, `_enableSsl`, lines 14-20).
  - `SendAsync(to, subject, body, isHtml, cancellationToken)` (line 23): guards each string with
    `ArgumentException.ThrowIfNullOrEmpty` (lines 25-27), then constructs a fresh `SmtpClient` with
    `NetworkCredential` and `EnableSsl` inside a `using` (lines 30-34, wrapped in a justified
    `#pragma warning disable S5332` at lines 29/35 because `EnableSsl` is config-driven and local dev
    targets MailDev, which does not offer TLS), builds a `MailMessage` (also `using`, lines 37-40), and
    awaits `SendMailAsync(message, cancellationToken)` (line 42). The doc comment (lines 9-10) is
    explicit that a new client is created and disposed **per send**, no pooled long-lived connection.
  - `SendAsync(subject, body, isHtml, cancellationToken)` (line 53): a convenience overload that sends
    to the default `_toAddress` from settings (line 54), for admin/system mail with no explicit
    recipient.
- **Why it's built this way**: a per-send client keeps the sender stateless and thread-safe with no
  connection lifecycle to manage, acceptable for the low volume of system/admin mail this channel
  carries. There is deliberately **no** `NullEmailSender` analogue: email is registered only where a
  host opts in, unlike push where a null default keeps the pipeline resolvable.
- **Where it's used**: registered as `IEmailSender` where a host wires SMTP; callers inject the port,
  not this class. It is not called from the push/inbox send flow.

---

### DependencyInjection
> MMCA.ADC.Notification.API · `MMCA.ADC.Notification.API` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:13` · Level 2 · class (static, `extension(IServiceCollection)`)

- **What it is**: the ADC Notification module's composition root. Its single `AddNotificationModule`
  method assembles the full module registration by chaining the Application, Infrastructure, push,
  native-push, and controller wiring in one call. (This is distinct from the Notification.Contracts
  `DependencyInjection` covered at the end of this chapter, which wires the consumer-side gRPC clients.)
- **Depends on**: [ApplicationSettings](group-14-module-system-composition.md#applicationsettings)
  (Level 1); the Common API notification-controllers extension (`AddNotificationControllers`); the
  Common Application module wiring (`AddModuleNotificationApplication`), `AddPushNotifications`, and
  `AddNativePushNotifications`. Externals: `Microsoft.Extensions.DependencyInjection`,
  `Microsoft.Extensions.Configuration`.
- **Concept, layered DI composition with `extension(IServiceCollection)`.** `[Rubric §5, Vertical
  Slice]` assesses whether a feature owns its own end-to-end wiring: this one method registers the
  module's Application handlers, Infrastructure EF configs, real-time transport, OS-level native push,
  and REST controllers together, so a host adds the whole slice with a single call. `[Rubric §7,
  Microservices Readiness]`: this class is the boundary where the shared push framework becomes ADC's
  concrete behavior, which is what lets the module boot standalone in `MMCA.ADC.Notification.Service`.
- **Walkthrough**: `AddNotificationModule(ApplicationSettings applicationSettings, IConfiguration
  configuration)` (line 21) runs five registrations in order (lines 23-32):
  1. `AddModuleNotificationApplication(applicationSettings)` (line 23), the ADC Application facade that
     registers [AttendeeNotificationRecipientProvider](#attendeenotificationrecipientprovider) *before*
     Common's notification Application services, so the `TryAdd*` defaults leave the ADC recipient
     source in place.
  2. `AddNotificationInfrastructure()` (line 24), the Common Infrastructure extension registering the EF
     configs for the two notification aggregates.
  3. `AddPushNotifications(configuration)` (line 25), which swaps in the SignalR adapters (and the
     optional Redis backplane) over the null defaults.
  4. `AddNativePushNotifications(configuration)` (line 29), the ADR-044 third channel: a **no-op unless**
     the `NativePush` config section is enabled and complete (doc comment lines 27-28), so it is safe to
     call in every environment.
  5. `services.AddControllers().AddNotificationControllers()` (line 32), splicing the Common notification
     controllers in as MVC application parts so ASP.NET Core routing can discover them.
- **Why it's built this way**: keeping the ordering (Application before its `TryAdd*` defaults;
  controllers registered as an application part because they ship in a NuGet assembly; native push added
  defensively as a safe no-op) inside one named method means the host `Program.cs` stays clean and the
  sequence cannot drift per service.
- **Where it's used**: called by [NotificationModule.Register](#notificationmodule), which the
  [ModuleLoader](group-14-module-system-composition.md#moduleloader) invokes at startup.

---

### PushNotificationCreated
> MMCA.Common.Domain · `MMCA.Common.Domain.Notifications.PushNotifications.DomainEvents` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/DomainEvents/PushNotificationCreated.cs:11` · Level 2 · record (sealed)

- **What it is**: the domain event raised when a [PushNotification](#pushnotification) is created. It
  records the notification's title and recipient count as a published fact.
- **Depends on**: [BaseDomainEvent](group-04-events-outbox.md#basedomainevent) (Level 1, its base
  record). Uses the `PushNotificationIdentifierType` alias.
- **Concept**: cross-reference the domain-event / outbox story in
  [Group 04](group-04-events-outbox.md). `[Rubric §6, CQRS & Event-Driven]` assesses whether state
  changes are announced as events carrying enough context to act on: this event carries `NotificationId`,
  `Title`, and `RecipientCount` (lines 12-14). Note the doc comment on `NotificationId` (line 8),
  "default until persisted": the aggregate id is database-generated, so at `Create` time it is still
  `default`; the event captures intent, not the assigned key.
- **Walkthrough**: a positional `sealed record class` with three parameters, `NotificationId`, `Title`,
  `RecipientCount` (lines 11-14), deriving from `BaseDomainEvent`. No body, no logic; the record is a
  pure payload.
- **Why it's built this way**: raising a domain event inside `PushNotification.Create` (with `default`
  for the not-yet-assigned id) makes creation an announceable fact that flows through the outbox like any
  other domain event (ADR-003), giving a persistable record and a future extension point.
- **Where it's used**: added to the aggregate's event list by `PushNotification.Create` and captured by
  the outbox on `SaveChangesAsync`. There is **no** `IDomainEventHandler<PushNotificationCreated>` in
  the codebase today: delivery happens synchronously inside the send handler after the inbox rows are
  written, so this event is currently a published, persistable record with no consumer wired to it.

---

### NotificationModule
> MMCA.ADC.Notification.API · `MMCA.ADC.Notification.API` · `MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/NotificationModule.cs:15` · Level 3 · class (sealed)

- **What it is**: the ADC Notification bounded context's [IModule](group-14-module-system-composition.md#imodule)
  entry point. It is the discovery hook that lets the framework register the whole Notification slice in
  dependency order, and it declares the one cross-module service the context publishes.
- **Depends on**: [IModule](group-14-module-system-composition.md#imodule) (Level 2);
  [ApplicationSettings](group-14-module-system-composition.md#applicationsettings) (Level 1); the ADC
  [DependencyInjection](#dependencyinjection)
  (`AddNotificationModule`); [IUserNotificationExportService](#iusernotificationexportservice) and its
  disabled stub [DisabledUserNotificationExportService](#disabledusernotificationexportservice).
  Externals: `Microsoft.Extensions.DependencyInjection` / `Microsoft.Extensions.Configuration`.
- **Concept**: cross-reference the module system in
  [Group 14](group-14-module-system-composition.md#imodule). `[Rubric §7, Microservices Readiness]`
  assesses whether modules are independently composable: this module declares `Dependencies =>
  ["Identity"]` with `RequiresDependencies => true` (lines 21, 24) because it needs the Identity
  attendee query to resolve recipients, and the [ModuleLoader](group-14-module-system-composition.md#moduleloader)
  uses that to register it after Identity (Kahn topological order). It **does** publish a cross-module
  service (the doc comment lines 12-13), so it implements `RegisterDisabledStubs` to keep that interface
  resolvable when the module is turned off.
- **Walkthrough**: three declarative members plus two actions.
  - `Name => "Notification"` (line 18); `Dependencies => ["Identity"]` (line 21);
    `RequiresDependencies => true` (line 24).
  - `Register(services, configuration, applicationSettings)` (line 27), whose whole body delegates to
    `services.AddNotificationModule(applicationSettings, (IConfiguration)configuration)` (line 31). Note
    the deliberate `(IConfiguration)configuration` cast: `IModule.Register` hands over an
    `IConfigurationBuilder`, which the module treats as the concrete configuration to read from.
  - `RegisterDisabledStubs(services)` (line 34) registers
    `AddSingleton<IUserNotificationExportService, DisabledUserNotificationExportService>()` (line 35) so
    a host that disables Notification can still satisfy the export interface the Identity service calls
    for the PRIVACY.md data-subject export.
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
  `IHubContext<NotificationHub>` (injected, line 12) rather than holding a hub connection, it works from
  any host that maps the hub, and when a Redis backplane is configured the group send fans out across
  replicas (doc comment lines 8-10). `[Rubric §1, SOLID]`: the same `ILiveChannelPublisher` abstraction
  is implemented by the null default, this SignalR adapter, and (in ADC) a gRPC adapter, port-and-adapter
  taken to its conclusion.
- **Walkthrough**: one method, `PublishAsync(channelKey, eventName, payloadJson, cancellationToken)`
  (line 15): `hubContext.Clients.Group(channelKey).SendAsync(NotificationHub.ReceiveChannelEventMethod,
  channelKey, eventName, payloadJson, cancellationToken)` (lines 16-18). It invokes the hub's
  `ReceiveChannelEventMethod` constant so the client and server agree on the method name, and passes the
  channel key, event name, and opaque JSON payload straight through.
- **Why it's built this way**: live channels are transient by contract (ADR-039), so this adapter just
  addresses the group and sends, with no persistence and no per-recipient bookkeeping. A connection that
  is not subscribed at publish time simply never receives the event.
- **Where it's used**: swapped in over [NullLiveChannelPublisher](#nulllivechannelpublisher) by
  `AddPushNotifications` in any host that maps the hub; in ADC it is the *local* implementation the
  Notification service's gRPC ingress ([LiveChannelGrpcService](#livechannelgrpcservice)) delegates to.
  The browser side lives in [group 15](group-15-common-ui-framework.md).

---

### SignalRPushNotificationSender
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/SignalRPushNotificationSender.cs:13` · Level 3 · class (sealed)

- **What it is**: the real adapter for [IPushNotificationSender](#ipushnotificationsender). It delivers
  a notification to specific users, a batch of users, or everyone, through
  [NotificationHub](#notificationhub), and chunks large audiences so one send does not overwhelm the
  SignalR connection manager.
- **Depends on**: [IPushNotificationSender](#ipushnotificationsender) (Level 0);
  [NotificationHub](#notificationhub) (Level 2). Externals: `Microsoft.AspNetCore.SignalR`
  (`IHubContext<THub>`), `System.Globalization` (invariant `int.ToString`).
- **Concept**: cross-reference out-of-band delivery via `IHubContext` taught on
  [SignalRLiveChannelPublisher](#signalrlivechannelpublisher). `[Rubric §12, Performance &
  Scalability]` here is about **batching**: a private `const int BatchSize = 100` (line 15) caps how
  many user ids ride a single `Clients.Users(batch)` call, so broadcasting to a large attendee list is
  split into bounded sends rather than one giant fan-out. `[Rubric §27, i18n]` in miniature: user ids
  are stringified with `CultureInfo.InvariantCulture` (lines 20, 47) so the SignalR user-id keys are
  locale-stable.
- **Walkthrough**
  - `SendToUserAsync(userId, title, body, metadata, cancellationToken)` (line 18): addresses
    `Clients.User(userId.ToString(InvariantCulture))` and invokes `NotificationHub.ReceiveNotificationMethod`
    (lines 19-22).
  - `SendToUsersAsync(userIds, ...)` (line 25): iterates `BatchUserIds(userIds)` and sends each batch to
    `Clients.Users(batch)` (lines 27-33).
  - `BroadcastAsync(...)` (line 37): addresses `Clients.All` (lines 38-40).
  - `BatchUserIds(userIds)` (line 42): a private iterator that accumulates invariant-culture id strings
    into a `List` and `yield return`s each time it reaches `BatchSize`, flushing the remainder at the end
    (lines 44-58).
- **Why it's built this way**: all three delivery shapes route through the one hub context and the one
  shared method-name constant, so the client listens on a single event regardless of how it was
  targeted. Batching keeps a broadcast to thousands of recipients from constructing one oversized
  argument list for the connection manager.
- **Where it's used**: swapped in over [NullPushNotificationSender](#nullpushnotificationsender) by
  `AddPushNotifications`; called by [SendPushNotificationHandler](#sendpushnotificationhandler) after the
  inbox rows are persisted, inside a swallow-everything `try/catch` so a transport hiccup never loses the
  durable inbox.

---

### SendPushNotificationRequestValidator
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationRequestValidator.cs:10` · Level 5 · class (sealed)

- **What it is**: the FluentValidation validator for [SendPushNotificationRequest](#sendpushnotificationrequest):
  it enforces that title and body are present and within the length limits declared by
  [PushNotificationInvariants](#pushnotificationinvariants).
- **Depends on**: [SendPushNotificationRequest](#sendpushnotificationrequest) (Level 0, the validated
  type), [PushNotificationInvariants](#pushnotificationinvariants) (the domain invariant constants,
  Level 4), and `FluentValidation.AbstractValidator<T>` (NuGet base class).
- **Concept**: request validation as a pipeline concern, not handler code. `[Rubric §24, Forms,
  Validation & UX Safety]` (server-side validation with actionable messages) and `[Rubric §16,
  Maintainability]`. Reusing the *same* `PushNotificationInvariants` constants here and in the
  [PushNotification](#pushnotification) domain factory keeps the API limit and the entity limit from
  drifting apart.
- **Walkthrough**: the constructor (line 12) defines two rules. `Title` (lines 14-17) gets `NotEmpty()`
  plus `MaximumLength(PushNotificationInvariants.TitleMaxLength)` (200); `Body` (lines 19-22) gets
  `NotEmpty()` plus `MaximumLength(PushNotificationInvariants.BodyMaxLength)` (2000). Each rule supplies
  a human-readable `WithMessage`, with the limit interpolated into the over-length message.
- **Where it's used**: auto-discovered by the notification Application DI's validator scan; invoked by
  the validating command decorator in the CQRS pipeline (against the embedded `Request`, via
  [ICommandWithRequest<out TRequest>](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)) before
  [SendPushNotificationHandler](#sendpushnotificationhandler) runs.

---

### SendPushNotificationHandler
> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:17` · Level 8 · class (sealed partial)

- **What it is**: the command handler for the push-notification broadcast. It resolves recipients,
  persists a sender-side audit aggregate plus one inbox row per recipient, attempts real-time delivery
  over SignalR **and** OS-level native push, and records the resulting status, returning a
  [PushNotificationDTO](#pushnotificationdto).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (repositories plus save),
  [INotificationRecipientProvider](#inotificationrecipientprovider) (the audience),
  [IPushNotificationSender](#ipushnotificationsender) (the SignalR transport),
  [INativePushSender](group-07-persistence-ef-core.md#inativepushsender) (the OS-level transport, added
  by ADR-044), [PushNotificationDTOMapper](#pushnotificationdtomapper) (the success-payload mapper), and
  `ILogger<>`; the persisted aggregates are [PushNotification](#pushnotification) and
  [UserNotification](#usernotification). Implements
  [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  and returns [Result<PushNotificationDTO>](group-01-result-error-handling.md#result).
- **Concept introduced, one durable path plus two ephemeral push channels.** `[Rubric §6, CQRS &
  Event-Driven]`, `[Rubric §8, Data Architecture]`, `[Rubric §29, Resilience & Business Continuity]`.
  The handler writes to storage (the audit aggregate, then N inbox rows) and separately performs two
  best-effort real-time pushes (SignalR, then native OS push). These are different reliability tiers on
  purpose: the aggregate and inbox rows are the **durable** record a recipient can retrieve later, while
  the SignalR and native pushes are the **immediate** deliveries that an offline user may miss.
- **Walkthrough** (teaching order)
  1. **resolve recipients** (lines 31-32) via the app-specific
     [INotificationRecipientProvider](#inotificationrecipientprovider) (in ADC,
     [AttendeeNotificationRecipientProvider](#attendeenotificationrecipientprovider)). An empty set
     short-circuits to a `Result.Failure` with an [Error](group-01-result-error-handling.md#error)
     `Validation` code `PushNotification.NoRecipients` (lines 34-40), before any rows are written.
  2. **create the audit aggregate** (lines 43-47) via `PushNotification.Create(...)` with
     `recipientIds.Count`; propagate errors on failure (lines 48-51), then add plus save (lines 53-56).
     This is where the aggregate's [PushNotificationCreated](#pushnotificationcreated) domain event is
     captured to the outbox (ADR-003).
  3. **durable inbox** (lines 58-66): one `UserNotification.Create(recipientId, notification.Id)` row
     per recipient, added and saved. This is what lets a user retrieve a notification they missed while
     offline.
  4. **best-effort SignalR delivery** (lines 69-86): `pushNotificationSender.SendToUsersAsync(...)`
     inside a `try/catch` with a *justified* `#pragma warning disable CA1031` (line 80). A delivery
     failure is **non-fatal**: success calls `notification.MarkAsSent()` plus an info log (lines 77-78),
     failure calls `notification.MarkAsFailed()` plus an error log (lines 84-85); the failure becomes
     recorded *status*, not a thrown exception.
  5. **best-effort native push** (lines 88-105, ADR-044): `nativePushSender.SendToUsersAsync(...)` in a
     second `try/catch` with its own justified `CA1031` suppression (line 100). This is the OS-level
     channel that can reach devices whose app is backgrounded or killed (doc comment lines 88-91). It is
     **purely additive**: the SignalR leg above already decided the audit status, so a native-push
     failure only logs a warning (`LogNativePushFailed`, line 104) and never touches `Status`. The
     default [NullNativePushSender](group-07-persistence-ef-core.md#nullnativepushsender) keeps this a
     no-op until a notification hub is configured.
  6. **persist final status** (line 107) and **return** the mapped DTO (line 109).
  All three log paths use source-generated `[LoggerMessage]` methods (lines 112-119). `[Rubric §13,
  Observability]`.
- **Why it's built this way**: shipping the whole feature in the *framework* means both ADC and Store
  get push for free, with the audience and both transports as injected abstractions (`[Rubric §10,
  Cross-Cutting Concerns]`). Treating each delivery failure as a recorded status or a logged warning
  rather than an exception keeps the audit trail honest while the *audit plus inbox* writes stay durable
  even when a live push does not land. Note the real-time sends are **not** the outbox: they are
  synchronous best-effort calls inside the handler; only the `PushNotificationCreated` domain event flows
  through the outbox.
- **Where it's used**: dispatched from the Common organizer-only notification controller (mounted into
  ADC by the Notification DI facade); the real-time legs land on connected clients through
  [NotificationHub](#notificationhub) and, for native push, through the configured OS notification hub.
- **Caveats / not-in-source**: `SendPushNotificationCommand` is **not** marked `ITransactional`, so the
  Transactional decorator opens no ambient transaction; the three `SaveChangesAsync` calls (lines 56,
  66, 107) are independent. A crash between the inbox writes and the final status save can therefore
  leave inbox rows persisted while the aggregate `Status` stays `Pending`. There is no automatic
  redelivery of a failed push: the outcome is recorded, not re-attempted.

---

### UserNotificationExportGrpcService
> MMCA.ADC.Notification.Service · `MMCA.ADC.Notification.Service.Grpc` · `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/UserNotificationExportGrpcService.cs:20` · Level 9 · class (sealed)

- **What it is**: the gRPC **server** endpoint that exposes the in-process
  [IUserNotificationExportService](#iusernotificationexportservice) over the wire. The Identity service
  calls it to pull a user's notification inbox rows (ids, titles, sent/read dates) so it can assemble the
  data-subject export document (PRIVACY.md §7, the GDPR right of access).
- **Depends on**: [IUserNotificationExportService](#iusernotificationexportservice) (injected via the
  primary constructor, line 20), the generated
  `UserNotificationExportService.UserNotificationExportServiceBase` (compiled from the `.Contracts`
  `.proto`, line 21), and `Grpc.Core.ServerCallContext`. Uses `System.Globalization.CultureInfo` for
  invariant-culture date formatting.
- **Concept introduced, cross-service data-subject export over internal gRPC.** `[Rubric §30,
  Compliance, Privacy & Data Governance]` assesses whether the system can satisfy a subject-access
  request across service boundaries: each service owns its own database, so the user's inbox rows live in
  `ADC_Notification`, not in Identity; this RPC lets the Identity export aggregator gather that slice
  without a cross-database query. `[Rubric §7, Microservices Readiness]` and `[Rubric §9, API & Contract
  Design]`: the export contract is a versioned `.proto` shared through the `.Contracts` package, the same
  extraction pattern as the live-channel ingress. `[Rubric §27, i18n]`: timestamps are serialized with
  the round-trip `"O"` format and `CultureInfo.InvariantCulture` (lines 40, 42) so the export is
  locale-stable.
- **Walkthrough**: the single `GetUserNotificationExport` override (line 24) null-guards `request` and
  `context` (lines 28-29), then awaits
  `inner.GetUserNotificationExportAsync(request.UserId, context.CancellationToken)` (lines 31-33) to get
  the in-process items. It builds a `GetUserNotificationExportResponse` (line 35) and `AddRange`s a
  projection of each item into a `UserNotificationExportItem` (lines 36-43): `NotificationId`, `Title`,
  `SentOn` as an ISO-8601 invariant string (line 40), `IsRead`, and `ReadOn` as an invariant string or
  `string.Empty` when the notification is unread (line 42). It returns the assembled response (line 45).
- **Why it's built this way (security posture)**: there is deliberately **no `[Authorize]`** (doc
  comment lines 14-18). `[Rubric §11, Security]`: like [LiveChannelGrpcService](#livechannelgrpcservice)
  and the other internal gRPC surfaces, this endpoint is reachable only on the internal service network
  (a dedicated internal port in Azure Container Apps, never routed by the Gateway), so the trust boundary
  is the network. It is served on the same dedicated `Http2`-only "grpc" Kestrel endpoint as the
  live-channel ingress (ADR-012 mixed-endpoint profile).
- **Where it's used**: mapped by the Notification service's `Program.cs`; the wire is dialed by its
  client half [UserNotificationExportServiceGrpcAdapter](#usernotificationexportservicegrpcadapter),
  which runs inside the Identity service's export aggregator and stitches this Notification slice into
  the full data-subject export. When the Notification module is disabled,
  [DisabledUserNotificationExportService](#disabledusernotificationexportservice) (registered by
  [NotificationModule.RegisterDisabledStubs](#notificationmodule)) stands in for the in-process interface
  this service wraps.

---

### UserNotificationExportServiceGrpcAdapter
> MMCA.ADC.Notification.Contracts · `MMCA.ADC.Notification.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/UserNotificationExportServiceGrpcAdapter.cs:17` · Level 9 · class (sealed)

- **What it is**: the **client** half of the data-subject export RPC. A hand-written adapter that
  implements [IUserNotificationExportService](#iusernotificationexportservice) on top of the generated
  `UserNotificationExportService.UserNotificationExportServiceClient`, so Identity's
  `ExportUserDataHandler` keeps depending on the C# interface while its call crosses the wire to the
  Notification service (where the inbox rows actually live). It is the counterpart to
  [UserNotificationExportGrpcService](#usernotificationexportgrpcservice).
- **Depends on**: [IUserNotificationExportService](#iusernotificationexportservice) (Level 1, the
  implemented port); the generated `UserNotificationExportService.UserNotificationExportServiceClient`
  (constructor param, line 18); [UserNotificationExportItemDTO](#usernotificationexportitemdto) (the
  mapped result rows). Externals: `Grpc.Core` (per-call deadline), `System.Globalization`
  (`DateTime.Parse` with `InvariantCulture` + `RoundtripKind`).
- **Concept, failure that propagates rather than being swallowed.** `[Rubric §30, Compliance, Privacy
  & Data Governance]`, `[Rubric §7, Microservices Readiness]`, `[Rubric §29, Resilience]`. Unlike
  [LiveChannelPublisherGrpcAdapter](#livechannelpublishergrpcadapter) (fire-and-forget), this adapter's
  transport failures **do** propagate to the caller (doc comment lines 13-15), because the Identity
  export aggregator wants to know a section is missing so it can degrade that section to `Available =
  false` rather than silently returning an incomplete export. A private `static readonly TimeSpan
  CallDeadline = TimeSpan.FromSeconds(5)` (line 23), tighter than the shared 30s attempt / 90s total
  budget, ensures a HUNG (not refused) peer degrades its section quickly instead of stalling the whole
  export request.
- **Walkthrough**
  - `CallDeadline` (line 23): the 5-second per-call ceiling.
  - `GetUserNotificationExportAsync(userId, cancellationToken)` (line 26): awaits
    `client.GetUserNotificationExportAsync(...)` with a `GetUserNotificationExportRequest` carrying
    `UserId` (lines 31-34) and `deadline: DateTime.UtcNow.Add(CallDeadline)` (line 35), then materializes
    a collection expression (lines 38-45) mapping each response `Notification` to a
    `UserNotificationExportItemDTO`: `NotificationId`, `Title`, `SentOn` via `ParseRoundtripUtc`
    (line 42), `IsRead`, and `ReadOn` as `null` when the wire value is empty else parsed (line 44).
  - `ParseRoundtripUtc(value)` (line 48): `DateTime.Parse(value, CultureInfo.InvariantCulture,
    DateTimeStyles.RoundtripKind)` (line 49), the parse-side mirror of the server's `"O"` invariant
    format so the timestamp round-trips exactly across the boundary.
- **Why it's built this way**: propagating the transport failure (rather than swallowing it as the
  live-channel adapter does) is the right call for an export: a compliance document must not quietly omit
  a section, so the aggregator needs the exception to mark the section unavailable. The invariant
  round-trip parse pairs with the server's invariant round-trip format so no locale can corrupt the
  timestamps.
- **Where it's used**: registered by `AddNotificationUserExportClient` in the Notification.Contracts
  [DependencyInjection](#dependencyinjection), which `services.Replace(...)`s it over the
  [DisabledUserNotificationExportService](#disabledusernotificationexportservice) stub in Identity's
  composition root. The server half it dials is
  [UserNotificationExportGrpcService](#usernotificationexportgrpcservice).

---

### DependencyInjection
> MMCA.ADC.Notification.Contracts · `MMCA.ADC.Notification.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/DependencyInjection.cs:16` · Level 10 · class (static, `extension(IServiceCollection)`)

- **What it is**: the **consumer-side** DI helpers other services call to wire the two gRPC-backed
  adapters pointing at the Notification service's dedicated h2c ingress. This is a different
  `DependencyInjection` from the Notification.API module composition root covered earlier in this
  chapter: that one assembles the module *inside* the Notification host, while this one lets *other*
  hosts (Engagement, Identity) dial into it.
- **Depends on**: `AddTypedGrpcClient<TClient>` (`MMCA.Common.Grpc`);
  [ILiveChannelPublisher](#ilivechannelpublisher) and its adapter
  [LiveChannelPublisherGrpcAdapter](#livechannelpublishergrpcadapter);
  [IUserNotificationExportService](#iusernotificationexportservice) and its adapter
  [UserNotificationExportServiceGrpcAdapter](#usernotificationexportservicegrpcadapter);
  `ServiceCollectionDescriptorExtensions.Replace`. Externals:
  `Microsoft.Extensions.DependencyInjection(.Extensions)`.
- **Concept introduced, the `Replace`-not-`TryAdd` client swap plus named-endpoint discovery.**
  `[Rubric §7, Microservices Readiness]` assesses whether a module can be dialed as a remote service
  without changing application code; `[Rubric §17, DevOps]` covers configuration-driven service
  discovery. Two extension methods each register a typed gRPC client and then `services.Replace(...)`
  the corresponding abstraction, deliberately overwriting whatever default sits in the container
  (`NullLiveChannelPublisher` or the disabled export stub) rather than `TryAdd`-ing, so the gRPC adapter
  always wins. Both target the **named** Aspire endpoint `_grpc.notification`: Notification's default
  endpoint stays `Http1AndHttp2` for SignalR WebSockets, so its cleartext gRPC (h2c) lives on a dedicated
  `Http2`-only Kestrel endpoint named `grpc`, and discovery resolves `http://_grpc.notification` from the
  `services__notification__grpc__0` config entry (injected by the AppHost's `WithReference` locally and
  by `infra/main.bicep` in production). ADR-012.
- **Walkthrough**: one `extension(IServiceCollection services)` block (line 18) with two methods.
  - `AddNotificationLiveChannelClient(serviceName = "_grpc.notification")` (line 42): registers the
    typed `LiveChannelPushServiceClient` (line 44), then
    `services.Replace(ServiceDescriptor.Scoped<ILiveChannelPublisher, LiveChannelPublisherGrpcAdapter>())`
    (line 48). The doc comment (lines 46-47) is explicit that it is `Replace`, not `TryAdd`, because the
    framework already registered `NullLiveChannelPublisher`; call it from `Program.cs` after
    `AddInfrastructure(...)`.
  - `AddNotificationUserExportClient(serviceName = "_grpc.notification")` (line 78): registers the typed
    `UserNotificationExportServiceClient` (line 80), then
    `services.Replace(ServiceDescriptor.Scoped<IUserNotificationExportService, UserNotificationExportServiceGrpcAdapter>())`
    (line 84), overwriting the `DisabledUserNotificationExportService` stub a disabled module may have
    left; call it from `Program.cs` after `ModuleLoader.DiscoverAndRegister(...)`.
- **Why it's built this way**: keeping the client wiring (typed client with its JWT-forwarding
  interceptor and Polly resilience handler from `MMCA.Common.Grpc`, plus the `Replace` swap and the
  named-endpoint default) behind one named method per consumer keeps each host's `Program.cs`
  declarative, and centralizing the `_grpc.notification` default means the h2c endpoint name cannot drift
  between the two consumers.
- **Where it's used**: `AddNotificationLiveChannelClient` is called by the Engagement service host's
  composition root (its live layer publishes ephemeral events); `AddNotificationUserExportClient` is
  called by the Identity service host's composition root (its `ExportUserDataHandler` aggregates the
  data-subject export).

### NotificationHub

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Hubs` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Hubs/NotificationHub.cs:17` · Level 2 · class (sealed)

- **What it is**: the SignalR hub that anchors the group's real-time transport. It is deliberately thin: it maps authenticated connections and manages channel (SignalR group) membership. It does not itself construct or fan out messages, that work lives in [`SignalRPushNotificationSender`](#signalrpushnotificationsender) and [`SignalRLiveChannelPublisher`](#signalrlivechannelpublisher), both of which push through `IHubContext<NotificationHub>` (documented `NotificationHub.cs:10-15`).
- **Depends on**: [`PushNotificationSettings`](group-14-module-system-composition.md#pushnotificationsettings) (read through `IOptions<T>` for the channel-key pattern); externals `Microsoft.AspNetCore.SignalR` (the `Hub` base class, `Groups`, `Context`, `HubException`, `[HubMethodName]`), `Microsoft.AspNetCore.Authorization` (`[Authorize]`), `Microsoft.Extensions.Options` (`IOptions<T>`), and the BCL `System.Text.RegularExpressions.Regex` plus `System.Collections.Concurrent.ConcurrentDictionary`.
- **Concept introduced, the SignalR hub as a real-time transport endpoint.** A SignalR `Hub` is a server-side endpoint over a persistent connection (WebSockets where available). Clients invoke named hub methods on it, and the server pushes messages back to individual connections or to named *groups* (here called channels). This hub keeps only the membership half of that contract: `JoinChannelAsync`/`LeaveChannelAsync` add or remove the calling connection to a SignalR group, and delivery is done elsewhere through `IHubContext`. Keeping the hub free of message construction means the sender/publisher services can be tested and scaled independently of the connection surface.
  - `[Rubric §11, Security]` assesses whether the boundary authenticates and constrains input. The class carries a class-level `[Authorize]` (`NotificationHub.cs:16`), so only authenticated connections can open the hub, and every channel key is validated against a configured allow-pattern before a connection may join a group, so a client cannot subscribe to an arbitrary group name.
  - `[Rubric §12, Performance & Scalability]` assesses whether hot paths avoid repeated work. The compiled `Regex` is cached in a static `ConcurrentDictionary` keyed by the pattern string (`NotificationHub.cs:33-34`) so join/leave calls never recompile it, and each match runs under a 1-second timeout (`NotificationHub.cs:31`) to bound worst-case matching (a defense against catastrophic-backtracking, ReDoS-style input).
- **Walkthrough**
  - Primary-constructor DI of `IOptions<PushNotificationSettings>`, over the `Hub` base (`NotificationHub.cs:17`).
  - The shared method-name constants: `ReceiveNotificationMethod` = `"ReceiveNotification"` (`NotificationHub.cs:20`) and `ReceiveChannelEventMethod` = `"ReceiveChannelEvent"` (`NotificationHub.cs:23`) are the client-listen method names the sender/publisher target; `JoinChannelMethod` = `"JoinChannel"` (`NotificationHub.cs:26`) and `LeaveChannelMethod` = `"LeaveChannel"` (`NotificationHub.cs:29`) are the server methods clients invoke. Exposing them as constants keeps both ends of the wire from drifting on a magic string.
  - `ChannelKeyMatchTimeout` (1 second, `NotificationHub.cs:31`) and the `ChannelKeyRegexCache` (`NotificationHub.cs:34`, `StringComparer.Ordinal`) back the validation helper.
  - `JoinChannelAsync(string channelKey)` (`NotificationHub.cs:44`): attributed `[HubMethodName(JoinChannelMethod)]` (`NotificationHub.cs:43`), it validates the key then calls `Groups.AddToGroupAsync(Context.ConnectionId, channelKey)` (`NotificationHub.cs:47`).
  - `LeaveChannelAsync(string channelKey)` (`NotificationHub.cs:55`): `[HubMethodName(LeaveChannelMethod)]` (`NotificationHub.cs:54`), validates then `Groups.RemoveFromGroupAsync(...)` (`NotificationHub.cs:58`).
  - `EnsureValidChannelKey` (`NotificationHub.cs:61`): `GetOrAdd`s the cached `Regex` for `settings.Value.ChannelKeyPattern` (`NotificationHub.cs:63-65`); an empty or non-matching key throws `HubException("Invalid channel key.")` (`NotificationHub.cs:67-70`), which SignalR surfaces to the caller rather than tearing down the connection.
- **Why it's built this way**: routing delivery through `IHubContext` instead of hub instance methods lets the framework construct and send messages from anywhere (background senders, the outbox path) without holding a live hub instance, and it is the shape SignalR scale-out (a Redis backplane) expects. The thin hub plus a configured channel-key pattern is the framework default; the pattern lives in [`PushNotificationSettings`](group-14-module-system-composition.md#pushnotificationsettings) so a host tunes which channels exist without touching code.
- **Where it's used**: mapped by a consuming host as a SignalR endpoint; driven by [`SignalRPushNotificationSender`](#signalrpushnotificationsender) (per-user notification delivery) and [`SignalRLiveChannelPublisher`](#signalrlivechannelpublisher) (ephemeral channel events), both via `IHubContext<NotificationHub>`.
- **Caveats / not-in-source**: the concrete hub route path and the SignalR scale-out backplane (if any) are set in host composition, not in this file. Not determinable from source here.

---

### DevicesController

> MMCA.Common.API · `MMCA.Common.API.Controllers.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:25` · Level 4 · class (sealed)

- **What it is**: the REST controller that lets any authenticated user manage THEIR own native push-device installations (ADR-044): `PUT /Notifications/Devices` upserts the installation (called after login and on token rotation), `DELETE /Notifications/Devices/{installationId}` removes it (called before logout).
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase); [`IPushDeviceRegistrar`](group-07-persistence-ef-core.md#ipushdeviceregistrar) (the registry facade injected into the primary constructor, `DevicesController.cs:26`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (`DevicesController.cs:27`); [`Error`](group-01-result-error-handling.md#error) and [`Result`](group-01-result-error-handling.md#result); [`DeviceInstallationRequest`](group-10-notifications.md#deviceinstallationrequest); [`NotificationFeatures`](group-10-notifications.md#notificationfeatures). Externals: ASP.NET Core MVC (`[ApiController]`, `[Route]`, `[HttpPut]`, `[HttpDelete]`), `Asp.Versioning` (`[ApiVersion("1.0")]`), and `Microsoft.FeatureManagement.Mvc` (`[FeatureGate]`).
- **Concept introduced, the ownership-stamped device controller.** This is the first controller in the group whose resources are addressed by **client-generated GUID** installation ids rather than server sequence ids (documented `DevicesController.cs:13-18`). Because the id is unguessable and ownership is stamped server-side from the authenticated user, the endpoint never trusts a caller-supplied owner. `[Rubric §11, Security]` assesses whether authorization and ownership are enforced at the boundary: the class-level `[Authorize]` (`DevicesController.cs:24`) requires authentication, and `UpsertAsync` re-derives `userId` from `ICurrentUserService.UserId` (`DevicesController.cs:37`) rather than the request body, so a user can only register a device against their own identity. `[Rubric §9, API & Contract Design]` assesses REST-shape consistency: both actions declare typed `[ProducesResponseType]` results (204 on success, 400 `ProblemDetails` on failure) and follow the same `HandleFailure`-or-success return shape as the rest of the group.
- **Walkthrough**
  - Primary-constructor DI of the registrar and the current-user service (`DevicesController.cs:25-27`).
  - `UpsertAsync` (`DevicesController.cs:33`): reads `currentUserService.UserId`; a null user short-circuits to `Error.Unauthorized("PushDevice.Unauthorized", ...)` via `HandleFailure` (`DevicesController.cs:37-41`). Otherwise it calls `registrar.UpsertAsync(userId.Value, request, ...)` and returns `NoContent()` (204) or `HandleFailure(result.Errors)` (`DevicesController.cs:43-44`).
  - `DeleteAsync` (`DevicesController.cs:50`): takes the `installationId` from the route (`[HttpDelete("{installationId}")]`, `DevicesController.cs:48`) and calls `registrar.DeleteAsync`; the operation is idempotent (unknown ids succeed, per [`IPushDeviceRegistrar`](group-07-persistence-ef-core.md#ipushdeviceregistrar)), so a repeated logout-time delete still returns 204 (`DevicesController.cs:54-55`).
- **Why it's built this way**: the whole controller is wrapped in `[FeatureGate(NotificationFeatures.PushNotifications)]` (`DevicesController.cs:23`), so when the `Notification.PushNotifications` flag is off the routes return 404 rather than surfacing dead endpoints. The registry indirection through [`IPushDeviceRegistrar`](group-07-persistence-ef-core.md#ipushdeviceregistrar) keeps the controller free of any push-provider detail; the default implementation is a no-op until a hub is configured (ADR-044).
- **Where it's used**: registered into the MVC application parts by the API-layer [`DependencyInjection`](#dependencyinjection)'s `AddNotificationControllers`; called by the native-client login/logout flow.

---

### InboxController

> MMCA.Common.API · `MMCA.Common.API.Controllers.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationInboxController.cs:29` · Level 4 · class (sealed)

- **What it is**: the REST controller for a user's notification inbox: get the inbox (paged), get the unread count, mark one notification read, and mark all read. Any authenticated user reaches only their own inbox.
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase); [`AuthorizationPolicies`](group-08-auth.md#authorizationpolicies); [`Error`](group-01-result-error-handling.md#error); [`Result`](group-01-result-error-handling.md#result); [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt); [`UserNotificationDTO`](group-10-notifications.md#usernotificationdto); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice); the CQRS handler contracts [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); and the four use cases [`GetMyNotificationsQuery`](group-10-notifications.md#getmynotificationsquery), [`GetUnreadNotificationCountQuery`](group-10-notifications.md#getunreadnotificationcountquery), [`MarkNotificationReadCommand`](group-10-notifications.md#marknotificationreadcommand), [`MarkAllNotificationsReadCommand`](group-10-notifications.md#markallnotificationsreadcommand).
- **Concept introduced, the feature-gated, handler-injecting controller.** `[Rubric §6, CQRS & Event-Driven]` assesses whether presentation delegates to command/query handlers rather than to service wrappers: this controller injects four handlers directly and only translates HTTP to a query/command and back (`NotificationInboxController.cs:29-34`). `[Rubric §9, API & Contract Design]` (consistent structure: `[ApiVersion("1.0")]`, `[FeatureGate]`, typed `[ProducesResponseType]`). `[Rubric §11, Security]` (the class-level `[Authorize(Policy = AuthorizationPolicies.RequireAuthenticated)]` at `NotificationInboxController.cs:28` enforces authentication; every action re-scopes to `currentUserService.UserId` so a user reads only their own inbox). The class-level `[FeatureGate(NotificationFeatures.PushNotifications)]` (`NotificationInboxController.cs:27`) makes the whole controller 404 when the flag is off, not stubbed.
- **Walkthrough**
  - Primary-constructor DI of two query handlers, two command handlers, and the current-user service (`NotificationInboxController.cs:29-34`).
  - `GetInboxAsync` (`NotificationInboxController.cs:39`): reads `pageNumber`/`pageSize` from `[FromQuery]` with `[Range(1, int.MaxValue)]` validation, guards a null user with `Error.Unauthorized` (`NotificationInboxController.cs:44-48`), builds a `GetMyNotificationsQuery(userId.Value, pageNumber, pageSize)` (`NotificationInboxController.cs:50`), and returns 200 with the paged result or `HandleFailure` (`NotificationInboxController.cs:54`). Default `pageSize = 20` (`NotificationInboxController.cs:41`).
  - `GetUnreadCountAsync` (`NotificationInboxController.cs:61`): marked `[ResponseCache(NoStore = true)]` (`NotificationInboxController.cs:59`) so the badge count is never cached; returns the raw `int` from `GetUnreadNotificationCountQuery` (`NotificationInboxController.cs:69-72`).
  - `MarkReadAsync` (`NotificationInboxController.cs:79`): route `{id:int}/read` (`NotificationInboxController.cs:76`), builds a `MarkNotificationReadCommand(id, userId.Value)` (`NotificationInboxController.cs:89`), returns 204 or a 404 `ProblemDetails`.
  - `MarkAllReadAsync` (`NotificationInboxController.cs:98`): route `read-all` (`NotificationInboxController.cs:96`), no body; issues `MarkAllNotificationsReadCommand(userId.Value)` (`NotificationInboxController.cs:106`) and returns 204.
- **Why it's built this way**: inbox reads and writes go through the standard CQRS decorator pipeline (logging, caching, validation, transaction) that wraps every handler, so the controller carries no cross-cutting logic. Passing `userId` into every query/command keeps authorization data-scoped, not just route-scoped.
- **Where it's used**: registered into MVC via `AddNotificationControllers`; consumed by the in-app inbox UI (badge count plus the notifications list/detail).

---

### NotificationsController

> MMCA.Common.API · `MMCA.Common.API.Controllers.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:28` · Level 4 · class (sealed)

- **What it is**: the organizer-only REST controller for push notifications: send a notification to all recipients (`POST` -> 201) and read the send history (`GET`, paged).
- **Depends on**: the same controller family as [`InboxController`](#inboxcontroller): [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase), [`AuthorizationPolicies`](group-08-auth.md#authorizationpolicies), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), [`Error`](group-01-result-error-handling.md#error), [`Result`](group-01-result-error-handling.md#result), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt). It adds [`SendPushNotificationCommand`](group-10-notifications.md#sendpushnotificationcommand), [`GetNotificationHistoryQuery`](group-10-notifications.md#getnotificationhistoryquery), [`PushNotificationDTO`](group-10-notifications.md#pushnotificationdto), and [`SendPushNotificationRequest`](group-10-notifications.md#sendpushnotificationrequest).
- **Concept**: cross-reference [`InboxController`](#inboxcontroller) for the feature-gated, handler-injecting controller shape. What differs is the authorization boundary: `[Authorize(Policy = AuthorizationPolicies.RequireOrganizer)]` (`NotificationsController.cs:27`) restricts both actions to organizers. `[Rubric §11, Security]` (a distinct, stricter policy for the write side: only organizers may broadcast). `[Rubric §9, API & Contract Design]` (the `SendAsync` action returns `Created(...)` with a `Location` header pointing at the new resource, the REST-correct 201 shape).
- **Walkthrough**
  - Primary-constructor DI of the send command handler, the history query handler, and the current-user service (`NotificationsController.cs:28-31`).
  - `SendAsync` (`NotificationsController.cs:38`): guards a null user with `Error.Unauthorized` (`NotificationsController.cs:42-46`), wraps the `[FromBody] SendPushNotificationRequest` plus the caller's `userId` into a `SendPushNotificationCommand` (`NotificationsController.cs:48`), and on success returns `Created(new Uri(string.Create(CultureInfo.InvariantCulture, $"/notifications/{result.Value!.Id}"), UriKind.Relative), result.Value)` (`NotificationsController.cs:53`).
  - `GetHistoryAsync` (`NotificationsController.cs:59`): reads `[FromQuery]` paging (default `pageSize = 10`, `NotificationsController.cs:61`), runs `GetNotificationHistoryQuery` (`NotificationsController.cs:64`), and returns 200 with the paged `PushNotificationDTO` collection.
- **Why it's built this way**: the send path (a broadcast) is an organizer-privileged operation, so its policy is separated from the per-user inbox; keeping the two controllers apart lets each carry exactly its own authorization surface. Both stay behind `[FeatureGate(NotificationFeatures.PushNotifications)]` (`NotificationsController.cs:26`).
- **Where it's used**: registered via `AddNotificationControllers`; consumed by the organizer push-notification UI.

---

### PushNotificationInvariants

> MMCA.Common.Domain · `MMCA.Common.Domain.Notifications.PushNotifications.Invariants` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/Invariants/PushNotificationInvariants.cs:9` · Level 4 · class (static)

- **What it is**: the static invariants helper that validates a push notification's title and body: non-empty plus a maximum length, delegating the actual checks to [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants).
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants); [`Result`](group-01-result-error-handling.md#result).
- **Concept**: this is the same "static invariants class + `MaxLength` constants as a single source of truth" pattern first taught for value objects in [Group 02](group-02-domain-building-blocks.md#commoninvariants), here applied to a domain entity. `TitleMaxLength = 200` and `BodyMaxLength = 2000` are `public const` (`PushNotificationInvariants.cs:12-15`), so the EF entity configuration can reuse the exact same numbers for column constraints. `[Rubric §8, Data Architecture]` assesses whether validation and schema stay consistent: because both the domain check and the DB column length derive from one constant, they cannot drift.
- **Walkthrough**: `EnsureTitleIsValid` (`PushNotificationInvariants.cs:17`) and `EnsureBodyIsValid` (`PushNotificationInvariants.cs:22`) each call `Result.Combine` over `CommonInvariants.EnsureStringIsNotEmpty` and `CommonInvariants.EnsureStringMaxLength`, passing the matching `MaxLength` constant and a `source`/field name so any failure carries a precise `Error` code (e.g. `PushNotification.Title.TooLong`, `PushNotificationInvariants.cs:20`).
- **Why it's built this way**: factoring the rules out of the entity keeps the [`PushNotification`](group-10-notifications.md#pushnotification) factory readable and lets the constants be shared with persistence and validators, the same one-source-of-truth rationale as the rest of the invariants family.
- **Where it's used**: called by the [`PushNotification`](group-10-notifications.md#pushnotification) entity factory when a notification is created.

---

### DependencyInjection

> MMCA.Common.API · `MMCA.Common.API.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Notifications/DependencyInjection.cs:9` · Level 5 · class (static)

*(API-layer notification DI. There is a second `DependencyInjection` in this unit, the Application-layer one at Level 9 below; both keep the raw type name as their heading.)*

- **What it is**: the API-layer DI helper for the Notification module. Its one method, `AddNotificationControllers`, registers the group's controllers into the MVC application so ASP.NET Core routing can discover them.
- **Depends on**: the [`NotificationsController`](#notificationscontroller) type (used only as an assembly anchor); externals `Microsoft.Extensions.DependencyInjection` (`IMvcBuilder`) and ASP.NET Core MVC application parts.
- **Concept introduced, the application-part registration for controllers shipped in a NuGet assembly.** ASP.NET Core scans only the host's own assembly for controllers by default; the notification controllers live in the `MMCA.Common.API` package, so they are invisible until their assembly is added as an application part. `AddNotificationControllers` is written as an `extension(IMvcBuilder builder)` member (`DependencyInjection.cs:11`) that calls `builder.AddApplicationPart(typeof(NotificationsController).Assembly)` (`DependencyInjection.cs:21`) to make all three controllers discoverable. `[Rubric §7, Microservices Readiness]` assesses whether a capability packages cleanly for reuse across hosts: shipping the controllers plus their own registration helper means any host adds the whole notification surface with one call, whichever service it is extracted into.
- **Walkthrough**: inside the `extension(IMvcBuilder builder)` block (`DependencyInjection.cs:11`), `AddNotificationControllers()` (`DependencyInjection.cs:19`) adds the application part (`DependencyInjection.cs:21`) and returns the builder for fluent chaining (`DependencyInjection.cs:22`).
- **Why it's built this way**: controllers cannot be auto-discovered from a referenced package without an explicit application part; exposing that as a named `extension(IMvcBuilder)` member keeps host composition roots declarative and reads as a first-class `AddControllers().AddNotificationControllers()` call (see [primer §4](00-primer.md#c-extensiont-types-read-this-once)). This is the API counterpart to the Application-layer `DependencyInjection` (`AddNotificationApplicationServices`) below.
- **Where it's used**: called from a consuming host's MVC setup (`AddControllers().AddNotificationControllers()`), alongside the Application-layer registration.

---

### UserNotification

> MMCA.Common.Domain · `MMCA.Common.Domain.Notifications.UserNotifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/UserNotifications/UserNotification.cs:12` · Level 5 · class (sealed)

- **What it is**: the framework-level aggregate root that tracks delivery of a single [`PushNotification`](group-10-notifications.md#pushnotification) to one user, giving each recipient a per-user inbox row with `IsRead`/`ReadOn` state.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (its base, closed over `UserNotificationIdentifierType`); [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) (the `[IdValueGenerated]` marker, `UserNotification.cs:11`); [`Result`](group-01-result-error-handling.md#result); the identifier aliases `UserNotificationIdentifierType`, `UserIdentifierType`, and `PushNotificationIdentifierType`; and `TimeProvider` (BCL, the injectable clock the caller reads from).
- **Concept**: the fan-out-on-send inbox row. One [`PushNotification`](group-10-notifications.md#pushnotification) produces N `UserNotification` rows, one per recipient, so read state is tracked per user. `[Rubric §4, Domain-Driven Design]` assesses whether behavior and invariants live inside the aggregate: state changes flow only through the factory and `MarkAsRead`, never through public setters (every property has a `private set`, `UserNotification.cs:15-24`). `[Rubric §14, Testability]` assesses whether time is injectable: `MarkAsRead` takes the read instant as a parameter rather than reading an ambient clock, so behavior is deterministic under test (see below).
- **Walkthrough**
  - State: `UserId` (`UserNotification.cs:15`), `PushNotificationId` (`UserNotification.cs:18`), `IsRead` (`UserNotification.cs:21`), and the nullable `ReadOn` timestamp (`UserNotification.cs:24`), all `private set`.
  - `Create(userId, pushNotificationId)` (`UserNotification.cs:44-47`): a direct `Result.Success(new UserNotification(...) { Id = default })`. There is no validation, the only inputs are two foreign keys, and `Id = default` because `[IdValueGenerated]` (`UserNotification.cs:11`) hands ID generation to the database.
  - `MarkAsRead(DateTime readOnUtc)` (`UserNotification.cs:58`): **idempotent**, an early `if (IsRead) return` (`UserNotification.cs:60-63`) preserves the original read time on repeat calls; otherwise it sets `IsRead = true` and `ReadOn = readOnUtc` (`UserNotification.cs:65-66`). The instant is supplied by the caller (from an injected `TimeProvider`, per the method's own doc at `UserNotification.cs:53-57`), so the domain stays free of ambient clock access. No domain event is raised on read.
- **Why it's built this way**: idempotent `MarkAsRead` shrugs off duplicate UI calls without corrupting the first read time, and passing the clock in keeps the entity pure. Database-generated ids (`[IdValueGenerated]`) suit a high-volume fan-out table where a factory-assigned sequence would be extra coordination.
- **Where it's used**: created by [`SendPushNotificationHandler`](group-10-notifications.md#sendpushnotificationhandler) for each recipient; read by [`GetMyNotificationsQuery`](group-10-notifications.md#getmynotificationsquery)'s handler for the inbox; flipped by the mark-read command handlers behind [`InboxController`](#inboxcontroller).

---

### PushNotificationDTOMapper

> MMCA.Common.Application · `MMCA.Common.Application.Notifications.PushNotifications.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/DTOs/PushNotificationDTOMapper.cs:12` · Level 6 · class (sealed, partial)

- **What it is**: the Mapperly-generated mapper from the [`PushNotification`](group-10-notifications.md#pushnotification) domain entity to its [`PushNotificationDTO`](group-10-notifications.md#pushnotificationdto) response shape, implementing [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) over `PushNotification` / `PushNotificationDTO` / `PushNotificationIdentifierType` (`PushNotificationDTOMapper.cs:13`).
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), [`PushNotification`](group-10-notifications.md#pushnotification), [`PushNotificationDTO`](group-10-notifications.md#pushnotificationdto), [`PushNotificationStatus`](group-10-notifications.md#pushnotificationstatus); external `Riok.Mapperly.Abstractions` (`[Mapper]`, `[MapProperty]`).
- **Concept**: compile-time DTO mapping via Mapperly (ADR-001). Rather than hand-writing property copies, the `[Mapper]` attribute (`PushNotificationDTOMapper.cs:11`) makes Mapperly generate the body of the `partial` `MapToDTO` at build time, so there is no reflection cost at runtime. `[Rubric §9, API & Contract Design]` assesses whether the domain type is kept off the wire: the mapper is the single place the entity is projected to its contract shape.
- **Walkthrough**
  - `MapToDTO(PushNotification entity)` (`PushNotificationDTOMapper.cs:17`): the generated one-to-one map, with one override, `[MapProperty(nameof(PushNotification.Status), nameof(PushNotificationDTO.Status), Use = nameof(MapStatusToString))]` (`PushNotificationDTOMapper.cs:16`) routes the enum through a custom converter.
  - `MapToDTOs(IReadOnlyCollection<PushNotification>)` (`PushNotificationDTOMapper.cs:20`): null-guards with `ArgumentNullException.ThrowIfNull` (`PushNotificationDTOMapper.cs:22`) then projects the collection with `MapToDTO` (`PushNotificationDTOMapper.cs:23`).
  - `MapStatusToString(PushNotificationStatus status)` (`PushNotificationDTOMapper.cs:26`): the private converter that renders the [`PushNotificationStatus`](group-10-notifications.md#pushnotificationstatus) enum as its `ToString()` name, so clients see a readable status string rather than a numeric code.
- **Why it's built this way**: Mapperly keeps mapping fast and analyzer-checked while still allowing per-property overrides (the enum-to-string case) where a plain copy is wrong (ADR-001).
- **Where it's used**: registered by the Application-layer `DependencyInjection` below (both as itself and as the `IEntityDTOMapper<...>` interface); consumed by the notification query/history use cases to shape responses for [`NotificationsController`](#notificationscontroller).

---

### DependencyInjection

> MMCA.Common.Application · `MMCA.Common.Application.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:26` · Level 9 · class (static, extension)

*(Application-layer notification DI. Distinct from the API-layer `DependencyInjection` at Level 5 above; both keep the raw type name as their heading.)*

- **What it is**: the Application-layer composition helper for the Notification module. Its single `extension(IServiceCollection)` method, `AddNotificationApplicationServices`, registers every notification command/query handler, the DTO mapper, the query service, the validator, and the default recipient provider.
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) and [`PushNotificationDTOMapper`](#pushnotificationdtomapper); [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype) / [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype); [`NullNavigationPopulator<TEntity>`](group-11-navigation-populators.md#nullnavigationpopulatortentity); [`INotificationRecipientProvider`](group-10-notifications.md#inotificationrecipientprovider) / [`NullNotificationRecipientProvider`](group-10-notifications.md#nullnotificationrecipientprovider); the handler contracts [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); [`PushNotification`](group-10-notifications.md#pushnotification), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), [`Result`](group-01-result-error-handling.md#result), and the concrete use-case handlers plus [`SendPushNotificationRequestValidator`](group-10-notifications.md#sendpushnotificationrequestvalidator). Externals: `Microsoft.Extensions.DependencyInjection(.Extensions)` (`TryAddScoped`), `FluentValidation` (`AddValidatorsFromAssemblyContaining`).
- **Concept introduced, explicit `TryAdd` registration for a module that ships inside the framework assembly.** Most modules are auto-scanned by `ScanModuleApplicationServices<TAssemblyMarker>()`, but the Notification types live in `MMCA.Common.Application` itself, not a separate module assembly, so they are wired by hand here instead (`DependencyInjection.cs:35`). Every registration uses `TryAddScoped` (`DependencyInjection.cs:38-67`), the `TryAdd` semantic assessed under `[Rubric §3, Clean Architecture]`: a consuming app that registers its own handler or recipient provider *before* calling this helper keeps its override, because `TryAdd` never replaces an existing registration. `[Rubric §1, SOLID]` (Dependency Inversion): the default [`INotificationRecipientProvider`](group-10-notifications.md#inotificationrecipientprovider) is the no-op [`NullNotificationRecipientProvider`](group-10-notifications.md#nullnotificationrecipientprovider) (`DependencyInjection.cs:67`), documented as the extension point a real app overrides to supply its own audience.
- **Walkthrough**: `AddNotificationApplicationServices()` (`DependencyInjection.cs:35`), inside `extension(IServiceCollection services)` (`DependencyInjection.cs:28`), registers in reading order:
  - The [`PushNotification`](group-10-notifications.md#pushnotification) aggregate's navigation populator ([`NullNavigationPopulator<PushNotification>`](group-11-navigation-populators.md#nullnavigationpopulatortentity)) and its [`EntityQueryService<...>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype) (`DependencyInjection.cs:38-40`).
  - The [`PushNotificationDTOMapper`](#pushnotificationdtomapper), both as itself and as the `IEntityDTOMapper<...>` interface (`DependencyInjection.cs:43-45`).
  - Three command handlers (send, mark-one-read, mark-all-read) at `DependencyInjection.cs:48-53` and three query handlers (history, my-notifications, unread-count) at `DependencyInjection.cs:56-61`.
  - The FluentValidation validators from the [`SendPushNotificationRequestValidator`](group-10-notifications.md#sendpushnotificationrequestvalidator) assembly, `includeInternalTypes: true` (`DependencyInjection.cs:64`).
  - The default no-op recipient provider (`DependencyInjection.cs:67`), then returns the collection for chaining (`DependencyInjection.cs:69`).
- **Why it's built this way**: hand-registration keeps the notification sub-system self-contained inside the framework package while still honoring the framework-wide override contract (`TryAdd`), and the `extension(IServiceCollection)` C# preview syntax lets it read as a first-class `services.AddNotificationApplicationServices()` call (see [primer §4](00-primer.md#c-extensiont-types-read-this-once)). Its API counterpart is the `AddNotificationControllers` helper above.
- **Where it's used**: called from every consuming host's Application composition root, before `AddApplicationDecorators()` so the scanned handlers exist when the decorator pipeline wraps them.


---
[⬅ Caching](group-09-caching.md)  •  [Index](00-index.md)  •  [Navigation Metadata & Populators (EF-decoupled eager loading) ➡](group-11-navigation-populators.md)
