# ADR-024: Two-Channel User Notifications (Transient SignalR Push + Durable Inbox)

## Status
Accepted (2026-06-27, amended 2026-07-15). Revised 2026-08-07 (transactional email recorded as an
app-level concern outside the channel model; see Revision below). Revised 2026-08-14 (the opt-in
dedup short-circuit and the scope key recorded; the `Enabled` gate narrowed to the hub endpoint).
Revised 2026-08-31 (email adoption re-stated: `IEmailSender` is now consumed inside the framework
itself by the password-reset workflow, so it is no longer an app-level-only primitive).
Revised 2026-09-07 (a per-user cap on concurrent hub connections, and the notification backplane
channel is namespaced per application).
Revised 2026-09-11 (the Store order-email call sites moved onto ADR-114 durable internal commands, so
those paths now retry and dead-letter; `IEmailSender` itself is unchanged).
Revised 2026-10-01 (the opt-in dedup key is scoped to the sender; see Revision below).
Revised 2026-10-06: the dedup race is recorded as propagate-and-roll-back under the `ITransactional` send, not catch-and-requery.
## Context
The framework needs to deliver user-facing notifications (an organizer broadcasting a schedule change,
a per-user alert). Two delivery models each fail on their own. A pure real-time push over a WebSocket
reaches only users who are connected at that instant: anyone offline, on a flaky network, or who simply
has the app closed never sees it. A pure stored inbox is reliable but not live: the user only learns of
the notification the next time they poll or reload. A correct notification feature needs both at once,
and it must stay inert in deployments that do not use it (the monolith, a service with no UI) without
the calling code branching on whether notifications are wired. Separately, "who should receive this"
is domain-specific (all attendees of an event, the assignees of a ticket) and cannot live in the
framework.

## Decision
Deliver notifications over two channels from one application use case, with the transport and the
recipient policy both behind abstractions.

- **A durable per-user inbox plus a transient real-time push, written in that order.**
  `SendPushNotificationHandler` (`MMCA.Common.Application`) resolves recipients, creates a
  `PushNotification` aggregate (`MMCA.Common.Domain.Notifications.PushNotifications`, the audit record of
  what was sent, carrying the caller's optional `ScopeKey` alongside the title, body, sender and
  recipient count, `SendPushNotificationHandler.cs:86-92`), persists one `UserNotification` inbox row
  per recipient (`MMCA.Common.Domain.Notifications.UserNotifications`, carrying `IsRead` / `ReadOn` with
  an idempotent `MarkAsRead`), and only then dispatches the live push. The inbox is the durable source
  of truth; the push is the best-effort live layer over it. The three saves (audit row, inbox rows,
  terminal status, `:103`, `:113`, `:156`) are one unit: `SendPushNotificationCommand` is
  `ITransactional` (`SendPushNotificationCommand.cs:23`), so a fault anywhere rolls the whole send
  back, and the live legs run inside that unit, making live delivery at-least-once and the inbox rows
  exactly-once (`SendPushNotificationHandler.cs:21-31`).
- **A send is idempotent only when the caller opts in.** The command may carry a `DedupKey`; when it is
  present and not whitespace the handler scopes it to the sender (the stored key is the hex SHA-256 of
  `{sentByUserId}:{clientKey}`, `SendPushNotificationHandler.cs:168-170`), so another caller reusing the
  same client key neither suppresses this send nor is handed this sender's notification. It looks that
  scoped key up before doing anything else and, on a hit, returns the already-sent notification without
  resolving recipients, writing inbox rows, or pushing (`SendPushNotificationHandler.cs:60-71`, lookup
  in `FindByDedupKeyAsync` at `:188-197`). That lookup is a check-then-act, so two concurrent retries
  of the same send both pass it and the loser fails its first save on the filtered unique index on
  `DedupKey` (`PushNotificationConfiguration.cs:69-73`). The handler does not recover in place: the
  failure propagates (`SendPushNotificationHandler.cs:102-103`) as the persistence exception, surfaced
  as a 409 through `DbUpdateExceptionHandler`, the transactional decorator rolls the attempt back, and
  the client's retry is then answered by the dedup lookup with the winner's notification
  (`SendPushNotificationHandler.cs:33-41`, which also records why a requery is not possible: the failed
  insert stays tracked, and on PostgreSQL the violation has already aborted the transaction). With no
  key the path is unchanged: nothing is deduplicated by default.
- **Transient delivery is an abstraction with a no-op default.** `IPushNotificationSender`
  (`MMCA.Common.Application`) is registered by default as `NullPushNotificationSender` (no-op), so a host
  that never calls the opt-in does nothing on send. `AddPushNotifications(configuration)`
  (`MMCA.Common.Infrastructure`) swaps in `SignalRPushNotificationSender`, which fans messages out
  through `IHubContext<NotificationHub>` to a user, a batched list of users (100 per batch), or all
  clients. The hub (`NotificationHub`) is `[Authorize]` and is mapped with `MapNotificationHub()`
  (`MMCA.Common.API`); the Blazor client wraps it in `NotificationHubService` (`MMCA.Common.UI`). The
  hub is no longer notification-only: it also carries an ephemeral live-channel role, exposing
  `JoinChannel` / `LeaveChannel` group management (`JoinChannelAsync` at `NotificationHub.cs:128`,
  `LeaveChannelAsync` at `:145`, the hub-method names declared at `:36` and `:39`) and a `ReceiveChannelEvent`
  push that backs `ILiveChannelPublisher` / `SignalRLiveChannelPublisher` for transient live-channel
  events, a path distinct from the durable notification delivery this ADR governs.
- **Recipient selection is the consumer's policy.** `INotificationRecipientProvider`
  (`MMCA.Common.Application`) defaults to `NullNotificationRecipientProvider` (returns no recipients);
  each app registers its own provider that knows its domain's audience. The framework ships the delivery
  machinery, not the address book.
- **Delivery failure is non-fatal.** If the live push throws, the handler records `MarkAsFailed` on the
  `PushNotification` and returns success: the inbox rows are already saved in the same unit and commit
  with the failed status, so the recipient still gets the notification on next load. A send is never
  rolled back because the WebSocket fan-out failed.
- **An optional third, native-push leg (ADR-044).** After the inbox write and the SignalR push,
  `SendPushNotificationHandler` also dispatches through `INativePushSender`
  (`SendPushNotificationHandler.cs:137-154`), an OS-level native-push channel that reaches devices the
  SignalR hub cannot (the app backgrounded or killed). It is best-effort by the same logic as the live
  push (a throw is logged, never fatal, and the SignalR leg has already decided the audit status), and it
  defaults to `NullNativePushSender` (`MMCA.Common.Infrastructure`, `DependencyInjection.cs:330`), so it
  stays inert until a native hub is configured. The design of that channel is ADR-044's scope; this ADR
  keeps its own on the inbox and SignalR channels, so the "Two-Channel" title names the durable and
  transient channels this record governs, not a hard cap on the number of delivery legs.
- **Horizontal scale-out is configuration, not code.** When a Redis connection string is present,
  `AddPushNotifications` adds a Redis backplane to SignalR (`AddStackExchangeRedis`) so a push reaches a
  user whose WebSocket is pinned to a different replica. `PushNotificationSettings.Enabled` (config
  section `"PushNotifications"`, `PushNotificationSettings.cs:11,14`) gates the hub endpoint only:
  `MapNotificationHub()` maps `NotificationHub` at the configured `HubPath` just when it is true
  (`SignalRExtensions.cs:25`). `AddPushNotifications` binds the section but registers SignalR,
  `SignalRPushNotificationSender` and `SignalRLiveChannelPublisher` unconditionally
  (`DependencyInjection.Notifications.cs:41-70`, `AddSignalR()` at `:48` and the two transient
  registrations at `:65-66`), so the opt-in registration, not the flag, is what decides whether
  a send goes through SignalR; with `Enabled: false` the sender is still wired and simply has no hub
  endpoint for clients to connect to.

## Rationale
- **Each channel covers the other's failure mode.** The inbox guarantees eventual delivery to offline
  users; the push gives connected users immediacy. Saving the inbox before pushing, inside one
  transactional unit, means a crash before commit rolls the whole send back for a retry rather than
  leaving a pushed notification with no inbox row, and a failed push never takes the inbox rows with it.
- **Null-default abstraction keeps it transport-at-the-edge.** Defaulting `IPushNotificationSender` and
  `INotificationRecipientProvider` to no-ops means application code calls the same handler whether or not
  a host wires SignalR, matching the framework's "depend on abstractions, choose transport at the edge"
  invariant (the same shape as the `IMessageBus` in-process/broker split).
- **Best-effort live layer.** Treating the push as advisory (record the failure, keep the commit) avoids
  coupling a business action's success to a transport that is inherently lossy; the inbox is the contract.
- **Recipients belong to the app.** Audience rules are domain logic; a framework provider would either be
  wrong or force every consumer into one model.

## Trade-offs
- **Fan-out write amplification.** One `UserNotification` row is written per recipient, so a broadcast to
  a large audience is a large insert. This is fine for the current per-event / per-tenant audiences but
  would need a different shape (or a pull model) for very large broadcast lists.
- **Silent no-op by default.** Because `NullPushNotificationSender` is the default, a host that forgets
  `AddPushNotifications` sends nothing live and shows no error. The behavior is intentional (inert until
  opted in) but is a discoverability foot-gun.
- **WebSocket auth is a special case.** SignalR cannot send an `Authorization` header on the connection
  upgrade, so the hub authenticates from the `access_token` query string on `/hubs` (ADR-004), a path
  that has to be kept exempt from other edge controls.
- **Read state is per-user, not on the aggregate.** `IsRead`/`ReadOn` live on each `UserNotification`,
  not on the `PushNotification`, so "how many recipients have read this" is a query across the inbox
  rows rather than a property of the sent notification.
- **Backplane is a deployment dependency for multi-replica correctness.** Without Redis, a push only
  reaches users connected to the same replica that handled the send; the inbox masks this for correctness
  but not for immediacy.

## Revision (2026-09-07)
Two bounds were added under the delivery model, from the 2026-09-07 security review.

1. **A connection cap per user.** `NotificationHub` refuses a connection once the caller already
   holds `PushNotifications:MaxConnectionsPerUser` open ones (default 20,
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/PushNotificationSettings.cs:42`,
   read at
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/NotificationHub.cs:56`). The
   default is generous on purpose: one person legitimately runs several tabs and a phone, and a
   reconnecting browser briefly holds two. It bounds the one resource an authenticated caller could
   otherwise take without limit, since a hub connection is long-lived state on the server rather than
   a request the rate limiter counts.
2. **The backplane channel is per application.** The SignalR Redis backplane's channel prefix now
   defaults to the resolved application namespace
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:827`, resolver at
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/ApplicationNamespace.cs:53`), so
   two applications sharing one Redis instance no longer publish notifications onto each other's
   channel. Adopting it moves the channel, so a rolling deploy has a window where old and new
   replicas do not see each other's broadcasts.

## Related
ADR-003 (the outbox dual-dispatch path, which is distinct: that carries service-to-service integration
events, this carries user-facing notifications), ADR-004 (the `/hubs` `access_token` query-string auth
the hub relies on), ADR-008 (extraction: ADC runs a dedicated `MMCA.ADC.Notification.Service` built on
these boundaries), ADR-012 (that Notification service is now a mixed-endpoint host: its default endpoint
stays Profile-B `Http1AndHttp2` for the SignalR WebSocket/HTTP/1.1 path, and since 2026-07-09 it also
serves an inbound `Http2`-only h2c gRPC edge on a dedicated named endpoint per ADR-039), ADR-022 (the
browser-edge auth context the UI client runs in), ADR-044 (the optional OS-level native-push channel
`SendPushNotificationHandler` fires after the inbox and SignalR legs, defaulting to `NullNativePushSender`),
ADR-114 (the durable internal-command processor the Store order emails are scheduled through, which is
where their retry and dead-letter posture comes from).

## Revision (2026-08-07)
Records transactional email, a delivery path the channel model above never mentions. The decision is
unchanged: this closes a documentation gap so the asymmetry reads as deliberate rather than unnoticed.

1. **Email is a framework-registered primitive, not a channel of this ADR.** `IEmailSender`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Mail/IEmailSender.cs:6`) has a
   single implementation, `SmtpEmailSender`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpEmailSender.cs:15`), and it is
   TryAdd-registered in the same block as the push-sender defaults
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:723`, beside
   `IPushNotificationSender` at `:724`, `ILiveChannelPublisher` at `:725`, `INativePushSender` at `:729`
   and `IPushDeviceRegistrar` at `:730`). That block is `AddServices()` (`:693`), which
   `AddInfrastructure` (`:72`) always calls (`:240`), so every host gets it. Unlike the two push
   abstractions it has no null default and no opt-in `Add*` counterpart: the real SMTP sender is always
   the registration, and the framework's own password-reset workflow resolves it (item 3).
2. **It sits outside the inbox / SignalR / native model.** An email creates no `PushNotification` audit
   record, writes no `UserNotification` inbox row, and is never dispatched by
   `SendPushNotificationHandler`. Callers take `IEmailSender` as a dependency (or resolve it from their
   own scope) and send directly, so none of the guarantees this ADR makes (durable-first ordering,
   best-effort live layer, recorded send status) apply to it.
3. **Adoption spans the framework's own user workflows and the Store order emails.** The framework's
   password-reset workflow sends through the abstraction: `ForgotPasswordHandlerBase`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:39`)
   takes `IEmailSender` as a primary-constructor dependency and dispatches the reset mail, swallowing
   and logging a send failure so a delivery problem is never reported back to the caller (`:83-96`,
   which would turn the response into an account-existence oracle). The email-confirmation workflow
   takes the same dependency on the same base-class shape (`SendEmailConfirmationHandlerBase.cs:43`),
   and two Identity modules in two repos inherit those bases and pass their own sender through
   (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:24`,
   `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:25`).
   The app-level call sites are the Store Sales order emails, and they no longer send from a domain
   event handler. `OrderPaidHandler`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/DomainEventHandlers/OrderPaidHandler.cs:37-48`)
   and `OrderPaymentFailedSagaHandler`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Saga/OrderPaymentFailedSagaHandler.cs:32-42`)
   only schedule a durable internal command through `IInternalCommandScheduler` (ADR-114) and log a
   scheduling failure. The `IEmailSender` call, the inline HTML body and the failure policy live in the
   internal-command handlers under
   `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/InternalCommands`:
   `SendOrderPaidEmailInternalCommandHandler` (`IEmailSender` at `:33`, `BuildEmailBody` at `:75`,
   the send at `:68`), `SendOrderPaymentFailedEmailInternalCommandHandler` (`:22`, `:59`) and
   `SendOrderShippedEmailInternalCommandHandler` (`:27`, `:66`), the third of which this record did
   not previously name.
4. **The primitive has no templating, retry, or bounce posture; the caller supplies what it needs.**
   The contract is two `SendAsync` overloads over plain `subject` / `body` strings with an `isHtml`
   flag (`IEmailSender.cs:15,23`); bodies are concatenated at the call site. `SmtpEmailSender`
   constructs a fresh `SmtpClient` per call and awaits `SendMailAsync` once
   (`SmtpEmailSender.cs:61-81`, client at `:68`, send at `:80`): no retry, no dead-letter, no bounce
   or delivery-status handling, and no persisted send record equivalent to the `PushNotification`
   aggregate. Durability is a property of the call site instead. The Store order-email handlers
   deliberately leave the SMTP call unwrapped
   (`SendOrderPaidEmailInternalCommandHandler.cs:20-24`, `:68`), so an exception fails the
   `InternalCommands` row and the ADR-114 processor retries it with backoff and eventually
   dead-letters it, while a missing order or customer returns success because redelivery would reach
   the same conclusion forever (`:49-63`). The password-reset path keeps the opposite policy by
   design: it swallows the failure rather than retrying it.
5. **Accepted as-is.** Email stays a direct-send primitive outside this ADR's channel model, used by
   the framework's user workflows and by app code. Pulling it under this ADR's model (durable record,
   null default, opt-in registration, one dispatching handler) is not justified by the call sites
   there are: each wants a direct send rather than an audited per-recipient fan-out, the
   password-reset one deliberately treats a failed send as silent, and the order emails already get
   durability, retry and dead-lettering from ADR-114 without this ADR's machinery. The point of
   recording it
   here is only that a reader of ADR-024 or ADR-044 should not conclude the inbox, SignalR and native
   legs are the only delivery paths in the platform. Wider adoption, or a requirement that email
   delivery be auditable or retried, is the trigger to give it its own record instead of this
   amendment.

## Revision (2026-10-01)
The opt-in deduplication key is now scoped to the sender. `SendPushNotificationHandler` no longer
stores or looks up the client-supplied `DedupKey` as-is: it derives the persisted key as the hex
SHA-256 of `{sentByUserId}:{clientKey}`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:185-187`,
applied at `:49-51`), so a second caller reusing the same client key can neither suppress this
sender's send nor be returned this sender's notification, and the stored key is always 64 characters
whatever the client sent. The check-then-act lookup, the filtered unique index and the
catch-and-requery race handling are otherwise unchanged. The Decision text above is corrected to say
so, and its stale citations are refreshed: the lookup (`:45-60`), the `PushNotification.Create` call
carrying `ScopeKey` (`:75-81`), the race handling (`:91-122`), the native-push leg (`:154-171`), the
filtered index
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:69-73`),
the `NullNativePushSender` default
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:320`), and
`AddPushNotifications`, which now lives in the partial file
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Notifications.cs:41-70`
(`AddSignalR()` at `:48`, the two transient registrations at `:65-66`, still unconditional). Anchors
inside the earlier Revision sections are left as recorded.

## Revision (2026-10-06)
- **The dedup race is not caught in place.** `SendPushNotificationHandler` no longer catches the losing
  insert and requeries: the first save propagates the unique-index failure (a 409 through
  `DbUpdateExceptionHandler`), the transactional decorator rolls the attempt back, and the client's
  retry is answered by the dedup lookup
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:33-41`,
  `:102-103`). The 2026-10-01 statement that catch-and-requery handling was "unchanged" is superseded;
  the Decision text is corrected.
- **The send is one transactional unit.** `SendPushNotificationCommand` is `ITransactional`
  (`SendPushNotificationCommand.cs:23`), so the audit, inbox and status saves (`:103`, `:113`, `:156`)
  commit together and the live legs run inside the unit (`SendPushNotificationHandler.cs:21-31`). The
  Decision and Rationale wording about the inbox being "already committed" before the push is corrected.
- **Current locations for facts recorded in earlier Revisions** (those sections are left as recorded):
  `MaxConnectionsPerUser` default 20 at `PushNotificationSettings.cs:46`, read in `OnConnectedAsync` at
  `NotificationHub.cs:63`; the backplane channel prefix now set in
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Notifications.cs:59-61`; the
  default registrations in `DependencyInjection.cs` (`IEmailSender` `:324`, `IPushNotificationSender`
  `:325`, `ILiveChannelPublisher` `:326`, `INativePushSender` `:330`, `IPushDeviceRegistrar` `:331`,
  inside `AddServices()` `:294`, called at `:234`); `SmtpEmailSender` creates its client through
  `CreateClient` at `SmtpEmailSender.cs:67` (factory `:97`) and sends at `:74` (method `:61-75`);
  `ForgotPasswordHandlerBase.cs` sends at `:84` and swallows at `:91`, with the ADC and Store handlers
  passing their sender to the base at `ForgotPasswordHandler.cs:27` and `:28`; the Store order-email
  handlers take `IEmailSender` at `SendOrderPaidEmailInternalCommandHandler.cs:34` (send `:83`,
  `BuildEmailBody` `:90`), `SendOrderPaymentFailedEmailInternalCommandHandler.cs:23` (send `:60`) and
  `SendOrderShippedEmailInternalCommandHandler.cs:28` (send `:67`, `BuildEmailBody` `:74`), scheduled
  from `OrderPaidHandler.cs:38`, `OrderPaymentFailedSagaHandler.cs:35` and
  `OrderShippedHandler.cs:34` (a scheduling site the 2026-08-07 record did not name).
- All `path:line` anchors in the live sections (Status through Trade-offs) were re-verified against
  current source.
