# ADR-024: Two-Channel User Notifications (Transient SignalR Push + Durable Inbox)

## Status
Accepted (2026-06-27, amended 2026-07-15). Revised 2026-08-07 (transactional email recorded as an
app-level concern outside the channel model; see Revision below). Revised 2026-08-14 (the opt-in
dedup short-circuit and the scope key recorded; the `Enabled` gate narrowed to the hub endpoint).

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
  recipient count, `SendPushNotificationHandler.cs:56-62`), persists one `UserNotification` inbox row
  per recipient (`MMCA.Common.Domain.Notifications.UserNotifications`, carrying `IsRead` / `ReadOn` with
  an idempotent `MarkAsRead`), and only then dispatches the live push. The inbox is the durable source
  of truth; the push is the best-effort live layer over it.
- **A send is idempotent only when the caller opts in.** The command may carry a `DedupKey`; when it is
  present and not whitespace the handler looks it up before doing anything else and, on a hit, returns
  the already-sent notification without resolving recipients, writing inbox rows, or pushing
  (`SendPushNotificationHandler.cs:30-41`). That lookup is a check-then-act, so two concurrent retries
  of the same send both pass it and the loser fails on the insert against the filtered unique index on
  `DedupKey` (`PushNotificationConfiguration.cs:67-69`). The handler catches that save failure,
  requeries the key on `CancellationToken.None`, and returns the winner's notification if the key now
  exists, rethrowing untouched otherwise (`SendPushNotificationHandler.cs:76-103`). With no key the path
  is unchanged: nothing is deduplicated by default.
- **Transient delivery is an abstraction with a no-op default.** `IPushNotificationSender`
  (`MMCA.Common.Application`) is registered by default as `NullPushNotificationSender` (no-op), so a host
  that never calls the opt-in does nothing on send. `AddPushNotifications(configuration)`
  (`MMCA.Common.Infrastructure`) swaps in `SignalRPushNotificationSender`, which fans messages out
  through `IHubContext<NotificationHub>` to a user, a batched list of users (100 per batch), or all
  clients. The hub (`NotificationHub`) is `[Authorize]` and is mapped with `MapNotificationHub()`
  (`MMCA.Common.API`); the Blazor client wraps it in `NotificationHubService` (`MMCA.Common.UI`). The
  hub is no longer notification-only: it also carries an ephemeral live-channel role, exposing
  `JoinChannel` / `LeaveChannel` group management (`NotificationHub.cs:43-59`) and a `ReceiveChannelEvent`
  push that backs `ILiveChannelPublisher` / `SignalRLiveChannelPublisher` for transient live-channel
  events, a path distinct from the durable notification delivery this ADR governs.
- **Recipient selection is the consumer's policy.** `INotificationRecipientProvider`
  (`MMCA.Common.Application`) defaults to `NullNotificationRecipientProvider` (returns no recipients);
  each app registers its own provider that knows its domain's audience. The framework ships the delivery
  machinery, not the address book.
- **Delivery failure is non-fatal.** If the live push throws, the handler records `MarkAsFailed` on the
  `PushNotification` and returns success: the inbox row is already committed, so the recipient still gets
  the notification on next load. A send is never rolled back because the WebSocket fan-out failed.
- **An optional third, native-push leg (ADR-044).** After the inbox write and the SignalR push,
  `SendPushNotificationHandler` also dispatches through `INativePushSender`
  (`SendPushNotificationHandler.cs:134-152`), an OS-level native-push channel that reaches devices the
  SignalR hub cannot (the app backgrounded or killed). It is best-effort by the same logic as the live
  push (a throw is logged, never fatal, and the SignalR leg has already decided the audit status), and it
  defaults to `NullNativePushSender` (`MMCA.Common.Infrastructure`, `DependencyInjection.cs:491`), so it
  stays inert until a native hub is configured. The design of that channel is ADR-044's scope; this ADR
  keeps its own on the inbox and SignalR channels, so the "Two-Channel" title names the durable and
  transient channels this record governs, not a hard cap on the number of delivery legs.
- **Horizontal scale-out is configuration, not code.** When a Redis connection string is present,
  `AddPushNotifications` adds a Redis backplane to SignalR (`AddStackExchangeRedis`) so a push reaches a
  user whose WebSocket is pinned to a different replica. `PushNotificationSettings.Enabled` (config
  section `"PushNotifications"`, `PushNotificationSettings.cs:9,12`) gates the hub endpoint only:
  `MapNotificationHub()` maps `NotificationHub` at the configured `HubPath` just when it is true
  (`SignalRExtensions.cs:25`). `AddPushNotifications` binds the section but registers SignalR,
  `SignalRPushNotificationSender` and `SignalRLiveChannelPublisher` unconditionally
  (`DependencyInjection.cs:541-564`), so the opt-in registration, not the flag, is what decides whether
  a send goes through SignalR; with `Enabled: false` the sender is still wired and simply has no hub
  endpoint for clients to connect to.

## Rationale
- **Each channel covers the other's failure mode.** The inbox guarantees eventual delivery to offline
  users; the push gives connected users immediacy. Persisting the inbox before pushing means a crash
  between the two leaves the notification recoverable, never lost.
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

## Related
ADR-003 (the outbox dual-dispatch path, which is distinct: that carries service-to-service integration
events, this carries user-facing notifications), ADR-004 (the `/hubs` `access_token` query-string auth
the hub relies on), ADR-008 (extraction: ADC runs a dedicated `MMCA.ADC.Notification.Service` built on
these boundaries), ADR-012 (that Notification service is now a mixed-endpoint host: its default endpoint
stays Profile-B `Http1AndHttp2` for the SignalR WebSocket/HTTP/1.1 path, and since 2026-07-09 it also
serves an inbound `Http2`-only h2c gRPC edge on a dedicated named endpoint per ADR-039), ADR-022 (the
browser-edge auth context the UI client runs in), ADR-044 (the optional OS-level native-push channel
`SendPushNotificationHandler` fires after the inbox and SignalR legs, defaulting to `NullNativePushSender`).

## Revision (2026-08-07)
Records transactional email, a delivery path the channel model above never mentions. The decision is
unchanged: this closes a documentation gap so the asymmetry reads as deliberate rather than unnoticed.

1. **Email is a framework-registered primitive, not a channel of this ADR.** `IEmailSender`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IEmailSender.cs:6`) has a
   single implementation, `SmtpEmailSender`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/SmtpEmailSender.cs:12`), and it is
   TryAdd-registered in the same block as the push-sender defaults
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:485`, beside
   `IPushNotificationSender` at `:486`, `ILiveChannelPublisher` at `:487`, `INativePushSender` at `:491`
   and `IPushDeviceRegistrar` at `:492`). That block is `AddServices()` (`:455`), which
   `AddInfrastructure` (`:50`) always calls (`:167`), so every host gets it. Unlike the two push
   abstractions it has no null default and no opt-in `Add*` counterpart: the real SMTP sender is always
   the registration, inert only because nothing resolves it.
2. **It sits outside the inbox / SignalR / native model.** An email creates no `PushNotification` audit
   record, writes no `UserNotification` inbox row, and is never dispatched by
   `SendPushNotificationHandler`. Callers resolve `IEmailSender` from a scope and send directly, so none
   of the guarantees this ADR makes (durable-first ordering, best-effort live layer, recorded send
   status) apply to it.
3. **Adoption is two call sites, both in Store Sales.** `OrderPaidHandler`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/DomainEventHandlers/OrderPaidHandler.cs:41`)
   and `OrderPaymentFailedSagaHandler`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Saga/OrderPaymentFailedSagaHandler.cs:31`),
   both `IDomainEventHandler<T>` implementations that open their own DI scope, build the HTML body
   inline, and swallow-and-log a send failure so the order flow is never broken
   (`OrderPaidHandler.cs:59-64`, `OrderPaymentFailedSagaHandler.cs:52-55`). No other module or repo
   consumes the abstraction today.
4. **No templating, retry, or bounce posture.** The contract is two `SendAsync` overloads over plain
   `subject` / `body` strings with an `isHtml` flag (`IEmailSender.cs:15,23`); bodies are concatenated
   at the call site. `SmtpEmailSender` constructs a fresh `SmtpClient` per call and awaits
   `SendMailAsync` once (`SmtpEmailSender.cs:30-42`): no retry, no dead-letter, no bounce or
   delivery-status handling, and no persisted send record equivalent to the `PushNotification`
   aggregate.
5. **Accepted as-is.** Email stays an app-level concern riding a framework-registered primitive.
   Pulling it under this ADR's model (durable record, null default, opt-in registration, one dispatching
   handler) is not justified by two call sites, and the point of recording it here is only that a reader
   of ADR-024 or ADR-044 should not conclude the inbox, SignalR and native legs are the only delivery
   paths in the platform. Wider adoption, or a requirement that email delivery be auditable or
   retried, is the trigger to give it its own record instead of this amendment.
