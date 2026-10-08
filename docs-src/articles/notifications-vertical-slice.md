# Notifications as a vertical slice: in-app inbox, real-time push, native push, and email

> Series: MMCA.Common · Article #21 (deep-dive) · Pillar P2 · Group G10 · Rubric §5 · ADR-024 + ADR-044 ·
> Status: grounded in `MMCA.Common/AGENTS.md` ("Push notifications", under Other Framework Pieces),
> `Website/docs-src/adr/024-push-notifications.md`,
> `Website/docs-src/adr/044-native-push-delivery.md`, and
> `Website/docs-src/onboarding/group-10-notifications.md`. The durable-inbox plus transient-push pattern is
> recorded in ADR-024; the OS-level native push leg that reaches backgrounded devices is added in
> ADR-044. No em dashes.

**Subtitle:** A framework is mostly horizontal layers and abstract base classes. Notifications is the
one concrete bounded context MMCA.Common ships, and it is built as a textbook vertical slice: domain,
application ports, infrastructure adapters, and API, all owned by one feature.

---

Open most "Clean Architecture" frameworks and you find a great deal of horizontal plumbing and very
little vertical feature. There is a `Domain` project, an `Application` project, an `Infrastructure`
project, and they are full of base classes and interfaces. That is fine, and it is necessary, but it
leaves a question unanswered for anyone trying to learn the framework: what does a complete feature
built on this thing actually look like, top to bottom?

MMCA.Common answers that by shipping exactly one concrete bounded context: Notifications. It is the
worked example. And the way it is organized is the point of this article, because it is built as a
vertical slice rather than smeared across the horizontal layers.

## Horizontal layer cut vs. vertical slice

The horizontal instinct is to organize by technical role. All the controllers in one folder, all the
handlers in another, all the EF configurations in a third. The cost shows up later: to change one
behavior of one feature, you touch four folders, and nothing about the folder structure tells you which
files belong together. Cohesion is low; the things that change together do not live together.

A vertical slice flips that. You organize by feature, and within the feature you keep the domain, the
use cases, the adapters, and the API surface together. Adding a capability to the feature means working
in one place. Notifications is that, and it touches every layer on purpose so it doubles as a complete
port-and-adapter reference:

- **Domain** owns two small aggregates (`PushNotification` and `UserNotification`), the
  `PushNotificationCreated` event, and the `PushNotificationStatus` enum.
- **Application** defines the ports (`IPushNotificationSender`, `INativePushSender`,
  `IPushDeviceRegistrar`, `IEmailSender`, `INotificationRecipientProvider`) and the CQRS slices that
  orchestrate them.
- **Infrastructure** supplies the adapters (`SignalRPushNotificationSender`,
  `AzureNotificationHubNativePushSender`, `AzureNotificationHubDeviceRegistrar`, `SmtpEmailSender`,
  `NotificationHub`) plus their no-op fallbacks.
- **API** exposes three REST controllers, split by who is allowed to call them.

Four loosely coupled delivery legs share one feature flag and one set of application ports: an in-app
inbox (durable per-user record), a SignalR real-time push (best-effort delivery to connected clients),
an OS-level native push (FCM and APNs to backgrounded or killed devices, added in ADR-044), and email
(system mail).

## Sending a push notification, end to end

The send flow is the most instructive because it touches distinct consistency concerns: a
deduplication check, a durable audit record, a per-user inbox, and two best-effort delivery legs
(real-time SignalR and OS-level native push). It is driven by `SendPushNotificationHandler`, reached
by POSTing to `NotificationsController`. The handler runs in a deliberate order:

1. **Deduplicate, if the caller opted in.** The command carries an optional `DedupKey`. A blank or
   whitespace-only value is normalized to null, so an empty header cannot claim the single "empty"
   key. A present key is scoped to the sender before it is used: the handler stores and looks up the
   hex SHA-256 of `{sentByUserId}:{clientKey}`, so another caller reusing the same client key can
   neither suppress this send nor be handed this sender's notification. The handler looks that scoped
   key up first, and a hit returns the existing DTO without sending anything at all. No key means no
   lookup, which is the default path: every send creates a new notification.
2. **Resolve recipients.** The handler does not know who the audience is. It asks the injected
   `INotificationRecipientProvider` for the user IDs. This is the key swap point: the framework ships a no-op
   `NullNotificationRecipientProvider` that returns an empty list, and the consuming app overrides it.
   ADC registers `AttendeeNotificationRecipientProvider`, which calls the Identity module to mean "every
   attendee." An empty recipient set short-circuits to a `Validation` failure, so the framework stays
   domain-agnostic while the app decides scope.
3. **Persist the audit aggregate, in its own save.**
   `PushNotification.Create(title, body, sentByUserId, recipientCount, dedupKey, scopeKey)` validates
   title and body via `PushNotificationInvariants`, checks that the dedup key and the optional scope
   key each stay within 128 characters (the 64-character hash the handler passes always fits, so in
   practice only the scope key can trip it), and returns a `Result<PushNotification>`. It is saved with
   `Status = Pending` and a snapshot `RecipientCount`. That save stands alone, so a lost race on the
   dedup key fails right there, before any inbox row exists, and propagates (next section).
4. **Fan out the inbox rows, in a second save.** For every recipient the handler creates a
   `UserNotification` row, the durable per-user inbox entry that survives a missed real-time delivery.
   Both writes are issued before any transport is touched. Storage first, delivery second.
5. **Deliver in real time, best-effort.** The handler calls `IPushNotificationSender.SendToUsersAsync`.
   That call is wrapped in a try/catch that swallows any exception by design: a SignalR or broker hiccup
   must not lose the already-persisted inbox rows. On success it calls `notification.MarkAsSent()`, on
   failure `notification.MarkAsFailed()`. This SignalR leg alone owns the audit status.
6. **Deliver OS-level native push, best-effort (ADR-044).** The handler then calls
   `INativePushSender.SendToUsersAsync` inside its own non-fatal try/catch, reaching devices the hub
   cannot (app backgrounded or killed). This leg is fire-and-forget: a failure is logged via
   `LogNativePushFailed` and does not touch the audit status the SignalR leg already decided. The
   default `NullNativePushSender` keeps it a no-op until a notification hub is configured.
7. **Save and return the DTO.** The handler saves the observed status a third time, then maps the
   saved aggregate and returns `201 Created`.

Those three saves are one unit of work, not three. `SendPushNotificationCommand` declares
`ITransactional`, and `TransactionalCommandDecorator` wraps any command carrying that marker in a
single database transaction that commits when the handler returns and rolls back on a thrown
exception. The dedup key is the reason. A fault between the audit save and the inbox fan-out would
otherwise leave a committed notification row carrying a key that nothing ever delivered, and every
later retry of that key would short-circuit on the dedup lookup and report success forever. Rolling
the attempt back whole is what lets the retry re-run the send. A failed delivery does not trigger that
rollback: both delivery legs swallow their exceptions and `MarkAsFailed` ends in a success result, so
a send nobody received is still recorded.

```csharp
// SendPushNotificationHandler, in order: dedup first, then audit + inbox are written
// BEFORE any delivery is attempted. The whole method runs in one transaction (ITransactional).
var dedupKey = string.IsNullOrWhiteSpace(command.DedupKey)
    ? null
    : SenderScopedDedupKey(sentByUserId, command.DedupKey);         // hex SHA-256 of "{sender}:{key}"
if (dedupKey is not null)
{
    var alreadySent = await FindByDedupKeyAsync(dedupKey, ct);
    if (alreadySent is not null) { return Result.Success(_mapper.MapToDTO(alreadySent)); } // no second send
}

var recipients = await _recipients.GetRecipientUserIdsAsync(ct);   // app decides "who"
if (recipients.Count == 0) { return Result.Failure(...Validation...); }

var notification = PushNotification.Create(
    title, body, sentByUserId, recipients.Count, dedupKey, scopeKey);  // scopeKey: optional view filter
await _repository.AddAsync(notification, ct);
await _unitOfWork.SaveChangesAsync(ct);                            // save 1: the audit row alone;
                                                                   // a lost dedup race throws here
foreach (var userId in recipients) { /* create a UserNotification inbox row */ }
await _unitOfWork.SaveChangesAsync(ct);                            // save 2: the inbox rows, still no delivery

// LiveMetadata: { "scopeKey": scopeKey } for a scoped send, null for an unscoped one
try { await _push.SendToUsersAsync(recipients, title, body, LiveMetadata(scopeKey), ct); notification.MarkAsSent(); }
catch { notification.MarkAsFailed(); }                            // CA1031: SignalR leg owns the status

try { await _nativePush.SendToUsersAsync(recipients, title, body, ct); } // ADR-044: OS-level leg
catch { /* LogNativePushFailed; native delivery is best-effort, audit status untouched */ } // CA1031

await _unitOfWork.SaveChangesAsync(ct);                           // record observed status; commit on return
```

Notice what this ordering buys you. `PushNotificationStatus` is an observed-delivery audit field, not a
gate, and it is decided by the SignalR leg alone. The answer to "what if the user is offline?" is built
in: they read it later from the inbox, the native leg tries their pocket, and the organizer sees a Sent
or Failed history. Durability lives in the database, not in any transport: the inbox row is what a
missed delivery falls back to, and it commits with the send rather than on a transport acknowledging
anything. This shape, a durable per-user
inbox plus two transient best-effort delivery legs (the SignalR real-time push recorded in ADR-024 and
the OS-level native push added in ADR-044) written in that order, keeps the inbox as the single source
of truth.

The send carries a second optional key alongside `DedupKey`: an opaque `ScopeKey` (for example
`"event:2"`), stamped by the sending application and stored on the audit aggregate. The live SignalR
leg forwards it as metadata under `NotificationScopeKey.MetadataKey` (`"scopeKey"`), so a connected
client viewing another scope can leave the notification out of its toast and badge; an unscoped send
carries no metadata at all. Common ships a canonical format for it (`NotificationScopeKey.ForEvent`
and `ForSession`, matching `^(event|session):[0-9]+$`), but the send path checks only its length, and
reads compare it as an opaque string. An app whose notifications belong to one edition of something sets it, and
every caller that omits it sends an unscoped notification. ADC resolves the current published event
and scopes to `event:{id}`. When no event resolves it fails narrow rather than wide: it answers with
the last key it resolved or, on an instance that has never resolved one, with `event:0`, a
well-formed key no row carries, so the reader sees an empty inbox instead of every event's
notifications. Scope is a view filter, not a security boundary, and the column is deliberately
unindexed: the filter runs after the primary-key join from the inbox, over a table that holds one row
per send, so an index would cost writes without buying a read.

## Retry safety on two levels: the idempotency filter and the dedup key

A broadcast is exactly the operation you never want to run twice, and the two ways it gets run twice
are different problems. The client retries the HTTP call; or two retries arrive close enough together
that both pass the same check. The slice answers both, at two different levels.

At the edge, the send endpoint carries `[Idempotent]`. The framework's idempotency filter caches the
first response against the caller's `Idempotency-Key` and replays it for a repeat, which is the cheap
answer to a retried HTTP call. Then the controller reads that same `Idempotency-Key` header itself
and passes it into the command as `DedupKey` (absent or whitespace-only stays null, which leaves the
send on the default undeduplicated path), and the handler scopes that key to the sender as described
above. The division of labor is the point: **the filter protects
the response, the dedup key protects the delivery.** When the filter's cache is cold, evicted, or
degraded (a restarted host, an expired entry, an unreachable distributed cache) the response replay is
gone, but the domain still refuses to send a second time.

Underneath, `DedupKey` is a real column on the `PushNotification` aggregate holding the
sender-scoped hash (the column allows 128 characters, validated in the factory, and the hash is
always 64), with a filtered unique index over it. That matters because the handler's
up-front lookup is a check-then-act: two concurrent retries of the same send can both pass it, and
the loser only discovers the conflict when it tries to insert. That insert is the audit save, its
own `SaveChangesAsync` with nothing wrapped around it, so the loser fails there on the unique index
and the persistence exception propagates. `DbUpdateExceptionHandler` answers it with a 409 Conflict,
and `TransactionalCommandDecorator` rolls the attempt back whole. The client's retry then reaches the
dedup lookup, which finds the winner's row and returns that notification without sending anything.
The database, not the application, arbitrates the race.

The handler does not try to recover in place, and the reason is a layer rule plus an engine quirk
rather than laziness. Application has no EF Core dependency, so nothing in its contract can detach
the failed insert: it stays tracked, and the commit would throw on it anyway. And on PostgreSQL the
unique violation has already aborted the transaction a requery would have to run in. Rolling back
and letting the retry find the winner is the shape that holds on every engine.

## The push channel: an adapter chosen at composition, not branched at runtime

The real-time channel is two cooperating types. `NotificationHub` is an `[Authorize]`d SignalR `Hub`.
For this durable-push slice it contributes a `ReceiveNotification` method-name constant, the client-side
listener that `SignalRPushNotificationSender` targets. Connection-to-user mapping is handled by SignalR's
`IUserIdProvider` (a `ClaimBasedUserIdProvider`). `SignalRPushNotificationSender` then pushes out of band
through `IHubContext<NotificationHub>`. It never holds a hub connection itself; it addresses
`Clients.User(id)`, `Clients.Users(batch)`, or `Clients.All`. Large audiences are chunked into batches of
100 user IDs so a single send does not overwhelm the connection manager.

The hub is not method-less, though. Per ADR-039 the same hub also hosts a live-channel layer on the one
connection: `JoinChannel` and `LeaveChannel` methods that map a connection into SignalR groups for
ephemeral broadcasts (live polls, session Q&A, live counters) that are deliberately never persisted. That
layer is out of scope for this durable-notification slice; the next article in the series is the
deep-dive on it.

The important design decision is that **which sender is live is a registration decision, not a runtime
branch.** Infrastructure registers the safe default: `AddInfrastructure` calls `AddServices`, which
does `TryAddTransient<IPushNotificationSender, NullPushNotificationSender>()` (the no-op lives in
`MMCA.Common.Infrastructure.Services`, so it is an Infrastructure registration, not an Application one).
Infrastructure's `AddPushNotifications(configuration)` then replaces `IPushNotificationSender` with the
SignalR implementation, wires `AddSignalR()`, and, if a `redis` connection string is present, adds a
Redis backplane for SignalR scale-out across replicas, with a per-application channel prefix so two
applications sharing one Redis never receive each other's pushes. A host that never calls
`AddPushNotifications`
keeps that no-op `NullPushNotificationSender`, so the send pipeline still resolves and runs (audit and
inbox rows are written) with no real-time transport at all.

```csharp
// The null-object discipline: the handler depends on the port; the adapter is chosen at the root.
// Infrastructure default (AddServices): IPushNotificationSender -> NullPushNotificationSender  (no-op)
// AddPushNotifications(configuration):  IPushNotificationSender -> SignalRPushNotificationSender
//                                       (+ AddSignalR, + Redis backplane if "redis" is configured)
```

This is dependency inversion done properly. The handler depends on `IPushNotificationSender`. There is
no `if (signalRConfigured)` anywhere in the handler. The choice between real and no-op lives at the
composition root, and the same null-object discipline applies to recipients via
`NullNotificationRecipientProvider`. The handler is genuinely transport-agnostic.

## The native push channel: reaching devices the hub cannot

The SignalR leg stops at the edge of a connected client. A phone with the app backgrounded, killed, or
offline hears nothing until the next launch, and conference announcements ("lunch is served", "room
change") are exactly the messages that must reach pockets, not open tabs. ADR-044 adds a fourth delivery
leg for that: OS-level native push through Firebase Cloud Messaging (Android) and APNs (iOS), fanned out
by Azure Notification Hubs.

It follows the same abstraction discipline as the SignalR channel, with two new Application ports.
`INativePushSender` does the user-targeted send, and `IPushDeviceRegistrar` upserts and deletes the
per-device installations that sends target. Infrastructure `TryAdd`s inert defaults
(`NullNativePushSender` and `NullPushDeviceRegistrar`), and `AddNativePushNotifications(configuration)`
swaps in the Azure Notification Hubs implementations (`AzureNotificationHubNativePushSender` and
`AzureNotificationHubDeviceRegistrar`) only when the `NativePush` configuration section is enabled and
complete. Hosts call it unconditionally, so a deployment flips the channel on by configuration alone, and
a build without push credentials is wired but inert end to end. Installations are tagged `user:{id}`, so
a send targets a user (never a raw token) and reaches every device that user registered.

The registration surface is `DevicesController`, the third REST controller. Any authenticated user
manages their own device installations: `PUT /Notifications/Devices` upserts (called after sign-in and
on token rotation), `DELETE /Notifications/Devices/{installationId}` removes one (called before
sign-out) and is idempotent. Ownership is stamped server-side from the current user, and installation
ids are client-generated GUIDs, so they are not enumerable.

## The in-app inbox: pure CQRS read/write, scoped to the caller

The inbox is the durable channel, exposed by `InboxController` to any authenticated user (unlike the
send and history endpoints, which need the notification-management capability). Four slices back it:

- `GetMyNotificationsHandler` joins `UserNotification` to `PushNotification` (title and body live on the
  push aggregate, read state lives on the per-user row) and projects a `UserNotificationDTO`, newest
  first, paginated and capped at 500 rows per page. This cross-aggregate read is done in the query, not
  via a navigation populator, because the two aggregates reference each other by ID only. The single
  query works because both aggregates map to the same `Notification` logical data source, so the join
  never spans two databases.
- `GetUnreadNotificationCountHandler` counts unread rows for the bell badge.
- `MarkNotificationReadHandler` verifies the row belongs to the requesting user before flipping it. The
  domain method `UserNotification.MarkAsRead(DateTime readOnUtc)` takes the read instant as a parameter
  (the handler supplies it from an injected `TimeProvider`, keeping the domain clock-agnostic) and is
  itself idempotent: a second call preserves the original read timestamp.
- `MarkAllNotificationsReadHandler` bulk-marks the caller's unread rows.

Three of those four slices accept the optional scope key, read from a `scope` query-string parameter
on the controller: the list, the unread count (so the badge and the list agree), and the bulk
mark-read (so a scoped client never marks rows it cannot see). A supplied scope narrows the read to
the notifications carrying that scope plus every unscoped one; omitting it returns everything,
which keeps callers that never pass a scope working.

Both the per-row read and the mark-read scope by the caller's `UserId` from `ICurrentUserService`, so
one user cannot read or mutate another's inbox. Security is part of the slice, not a cross-cutting
afterthought.

## The email channel, and the feature gate over all of it

Email is the smallest channel: one port `IEmailSender` and one SMTP adapter `SmtpEmailSender`, which
constructs and disposes a fresh `SmtpClient` per send. It is independent of the push and inbox flow;
nothing in the send handler calls it, and it is wired separately. Locally it points at an Aspire MailDev
container for visual inspection. Unlike push, email has no null-object default and is not opt-in:
Infrastructure's `AddServices` does `TryAddTransient<IEmailSender, SmtpEmailSender>()` unconditionally,
and `AddInfrastructure` always calls it, so every host that registers infrastructure gets the SMTP
sender. There is no `NullEmailSender` analogue.

The entire push, inbox, and device surface sits behind one feature flag,
`NotificationFeatures.PushNotifications`. All three controllers carry
`[FeatureGate(NotificationFeatures.PushNotifications)]`, so the whole channel can be switched off
per-environment with no code change. Authorization splits along the three controllers:
`NotificationsController` (send plus history) requires a capability, not a role:
`[HasPermission(NotificationPermissions.Manage)]`, the `notifications:manage` permission, which the
host grants to whichever roles it chooses (ADC grants it to the Organizer role alone). `InboxController`
and `DevicesController` require only an authenticated caller. That asymmetry encodes the rule "anyone
reads their own inbox and registers their own devices, only holders of the send capability
broadcast."

## Identifier aliases keep the IDs honest

A small but consistent detail: the notification entities do not type their keys as bare `int`. The slice
uses solution-wide identifier aliases declared once in
`MMCA.Common.Shared/GlobalUsings.NotificationIdentifierType.cs` and linked into every project. A
`UserNotification` has an `Id` of `UserNotificationIdentifierType` and a foreign key
`PushNotificationId` of `PushNotificationIdentifierType`; a `MarkNotificationReadCommand` carries a
`UserNotificationIdentifierType NotificationId` and a `UserIdentifierType UserId`. They are `global using
... = int;` aliases today, but typing the keys distinctly makes a "passed the wrong id" mistake visible
at the call site and gives you a single place to change the underlying type later.

## Trade-offs, honestly

- **Best-effort real-time, durable record.** The deliberate swallow of delivery exceptions means a push
  can fail silently as far as the WebSocket is concerned. That is the right call (the inbox row commits
  with the send either way), but it means real-time delivery is not a guarantee, it is an optimization.
  The status field is your audit trail, not a delivery receipt.
- **The send is one transaction, so the sender calls run inside it.** `ITransactional` is what keeps the
  dedup key honest: a fault between the audit row and the inbox rows would otherwise leave a committed
  key that nothing delivered, and every retry of that key would answer success forever. The price is
  that the SignalR and native calls happen with the transaction still open. Both are bounded by their
  own timeouts and hold locks only on rows this request just inserted, but it is still a transaction
  held across an out-of-process call. And because those calls run inside the unit, a transient fault
  on the final status save re-runs them under the execution strategy: real-time and native delivery
  are at-least-once, while the inbox rows are written exactly once.
- **Inbox fan-out cost.** Step 4 writes one `UserNotification` row per recipient. For a broadcast to a
  large audience that is a lot of rows in one save. It is the price of a durable per-user inbox with
  per-user read state, and it is bounded by the recipient count, but it is real write amplification.
- **Deduplication is opt-in, and it is check-then-act plus a database index.** A send that carries no
  key gets no protection at all. When a key is present, the up-front
  lookup is a race the handler cannot win on its own, so correctness rests on the filtered unique
  index plus the rollback. The losing concurrent caller gets a 409 rather than the winner's
  notification and has to retry; only that retry, answered by the dedup lookup, returns the result.
  That is a real cost pushed onto the client, paid to keep Application free of an EF Core dependency
  and the behavior identical on every engine.
- **The scope key is a view filter, not a security boundary.** It narrows what a scoped read returns,
  but a read that supplies no scope still sees every notification, scoped ones included. It organizes
  an inbox by edition; it does not isolate anything. Authorization remains the caller-scoped `UserId`
  check, and a real isolation requirement needs a real boundary, not this column.
- **Scale-out needs the backplane.** SignalR across multiple replicas only works correctly with the
  Redis backplane wired. Forget the `redis` connection string in a multi-replica deployment and pushes
  reach only the users connected to the replica that handled the send.
- **Native push is inert until provisioned, and fire-and-forget once live.** The native leg stays a
  no-op until a notification hub with platform credentials (a Firebase service account, an APNs key) is
  provisioned and the `NativePush` section is enabled. Once live it does no per-device delivery
  tracking: the hub's telemetry is the observability surface, and the inbox remains the recovery path.
- **It is one example, not a notification platform.** This is a reference vertical slice, not a
  full-featured notification product. There is no retry queue for failed real-time delivery, no template
  engine, no per-channel user preferences. The slice is shaped to teach the pattern and to be extended,
  not to be a drop-in SaaS.

## Apply this even without MMCA

The vertical-slice discipline ports to any stack:

1. **Organize by feature, not by technical role.** Keep a feature's domain, use cases, adapters, and
   endpoints together so the things that change together live together.
2. **Write the durable record before attempting best-effort delivery,** make delivery failure update a
   status rather than abort the operation, and commit the writes as one unit so a fault partway through
   cannot leave a record nothing delivered. Offline users are a normal case, not an error.
3. **Choose adapters at the composition root, never branch on configuration in the handler.** Ship a
   null-object default so the pipeline resolves and runs even when the real transport is absent.
4. **Scope every read and mutation to the caller** inside the slice, rather than relying on a
   cross-cutting filter to remember.
5. **Let the database arbitrate a deduplication race.** An application-level "does it already exist?"
   check is check-then-act and two retries will both pass it. Back it with a unique index, let the
   losing insert fail and roll its whole attempt back, and let the retry get its answer from the
   lookup, which then finds the winner.

The takeaway: a framework earns trust by showing one complete feature built on its own rules. Build that
feature as a cohesive vertical slice, and it teaches the patterns better than any amount of base-class
documentation.

---

**What we covered:** why MMCA.Common ships notifications as the one concrete bounded context, how a
vertical slice beats a horizontal layer cut for cohesion, the end-to-end send flow (deduplicate,
resolve recipients, persist audit, fan out inbox, then best-effort deliver over SignalR and OS-level
native push, the whole sequence one `ITransactional` transaction), the two levels of retry safety (the `[Idempotent]` filter replaying the response, the
sender-scoped `DedupKey` plus its filtered unique index protecting the delivery), the optional `ScopeKey` that
narrows a read without isolating anything, why each
sender is a composition-root choice with a null-object fallback, the ADR-044 native push channel and its
`DevicesController` registration surface, the CQRS inbox scoped to the caller, the email channel and the
single feature gate over all three controllers, and the notification identifier aliases.

**Next in the series:** live channel push, the other half of this hub. Ephemeral events (live polls,
session Q&A, live counters) fan out through the same `NotificationHub` via channel groups without ever
being persisted, and the durable-vs-ephemeral decision is made at the publisher boundary
(`IPushNotificationSender` versus `ILiveChannelPublisher`).

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the notifications slice as a worked
example, or `dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: https://github.com/ivanball/MMCA.Common
- 📚 Full series index: https://ivanball.github.io/writing.html

*Tags: .NET, C Sharp, Software Architecture, SignalR, Vertical Slice*

*Notes: refreshed 2026-10-08 against MMCA.Common v1.233.0 (paths below are under `MMCA.Common/` unless
stated). Changes this run: the handler was rewritten in Common #498 (2026-10-04) and #516
(2026-10-06), so the audit-save catch and requery are gone; step 3, the code block, the retry-safety
section (both paragraphs), the dedup trade-off and Apply #5 are re-grounded on propagate-and-roll-back
(the lost race fails the bare audit save, surfaces as a 409 through
`Source/Presentation/MMCA.Common.API/Middleware/DbUpdateExceptionHandler.cs` (class `:17`, 409
`:33`), the `ITransactional` decorator rolls back, and the retry hits the dedup lookup; class doc
"Deduplication race" `SendPushNotificationHandler.cs:33`-`:41`, recover-in-place rationale
`:37`-`:40`); the send gate is restated as a capability, not an organizer role
(`NotificationsController.cs:29`; `Source/Core/MMCA.Common.Shared/Notifications/NotificationPermissions.cs`
`Manage = "notifications:manage"` `:10`, host-grants doc `:4`-`:5`; ADC grant
`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/Authorization/NotificationPermissionGrants.cs:38`),
in the inbox section and the feature-gate section; the scope key is restated as forwarded on the live
leg (`LiveMetadata(notification.ScopeKey)` `SendPushNotificationHandler.cs:123`, `LiveMetadata`
`:178`-`:181`; `Source/Core/MMCA.Common.Shared/Notifications/NotificationScopeKey.cs` class `:20`,
`Pattern` `:32`, `MetadataKey = "scopeKey"` `:39`, `ForEvent` `:44`, `ForSession` `:50`; send
validator length-only `SendPushNotificationRequestValidator.cs:27`-`:29`) and the code block's
SignalR call carries that metadata; the inbox "own database" sentence is corrected (both
configurations carry `[UseDatabase("Notification")]`,
`.../EntityTypeConfiguration/Notifications/UserNotificationConfiguration.cs:14` and
`PushNotificationConfiguration.cs:15`; join `GetMyNotificationsHandler.cs:48`-`:51`); the header
cites `MMCA.Common/AGENTS.md` (Other Framework Pieces), since `MMCA.Common/CLAUDE.md` is only an
`@AGENTS.md` import; every handler, DI and hub anchor below is re-pointed.
Previous refresh 2026-10-02 (v1.221.0): the opt-in dedup key is sender-scoped and hashed (step 1, step 3, the code
block and the retry-safety section restated); the at-least-once consequence of running the live legs
inside the transaction is added to the transaction trade-off; ADC's scope fallback is restated (it
fails narrow to the last resolved key or an `event:0` sentinel, never to null); the Redis backplane's
per-application channel prefix is added; three "as it always did / as before" phrasings are removed;
every DI anchor is re-pointed (the push registrations live in `DependencyInjection.Notifications.cs`).
Handler, re-read in full this run:
`Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs`.
"Atomicity" XML doc `:21`-`:31` (live legs re-run under the execution strategy on a transient fault of
the final save, at-least-once for SignalR and native, exactly-once for inbox rows, `:28`-`:30`);
"Deduplication race" XML doc `:33`-`:41`; `INativePushSender nativePushSender` injected `:47`. Dedup:
whitespace to null, otherwise `SenderScopedDedupKey(command.SentByUserId, command.DedupKey)`
(`:60`-`:62`), which is `Convert.ToHexString(SHA256.HashData(...$"{sentByUserId}:{clientKey}"))`
(`:168`-`:170`; its XML doc `:161`-`:164` states the result is always 64 characters); lookup and hit
`:63`-`:71` (`LogDedupHit` `:68`); `FindByDedupKeyAsync` `:188`-`:197` via
`unitOfWork.GetReadRepository<...>` `:190`. Recipients `:74`-`:75`, empty-set `Validation` failure
`:77`-`:83`. `PushNotification.Create(...)` called `:86`-`:92` with the hashed `dedupKey` and
`command.Request.ScopeKey`. Repositories via `unitOfWork.GetRepository<...>` `:99` and `:106`. Audit
save alone, bare and uncaught, `:103` (propagate comment `:102`). Inbox rows `:107`-`:111`, second
save `:113`. SignalR leg `:117`-`:135` (metadata `:123`, `MarkAsSent` `:126`, CA1031 pragma `:129`,
`MarkAsFailed` `:133`); native leg `:141`-`:154` (call `:143`-`:147`, CA1031 pragma `:149`,
`LogNativePushFailed` call `:153`, `[LoggerMessage]` `:205`, declaration `:206`); final save `:156`;
DTO returned `:158`. The only CA1031 suppressions left are the two delivery legs.
Command and decorator: `SendPushNotificationCommand.cs:21`-`:23` (`ITransactional` `:23`,
"Transactional on purpose" doc `:11`-`:19`, sender-scoped `DedupKey` doc `:25`-`:35`);
`Source/Core/MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs` passes a
command without the marker straight through (`:30`-`:31`) and otherwise calls
`unitOfWork.ExecuteInTransactionAsync` (`:33`).
Aggregate: `Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs`,
`DedupKeyMaxLength = 128` `:19`, `ScopeKeyMaxLength = 128` `:22`, `DedupKey` `:45`, `ScopeKey` `:53`
(view-filter XML doc `:47`-`:52`), whitespace normalization in the private constructor `:75`-`:76`,
`Create(string title, string body, UserIdentifierType sentByUserId, int recipientCount, string? dedupKey = null, string? scopeKey = null)`
`:96`-`:102` (doc from `:79`), both length checks `:107`-`:120`. EF:
`Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs`,
`DedupKey` max length `:46`-`:47`, `ScopeKey` `:52`-`:53` deliberately unindexed (comment `:49`-`:51`),
filtered unique index `:69`-`:73` (`IsUnique()` + `HasSoftDeleteFilter`, `[DedupKey] IS NOT NULL`,
engine-aware quoting; rationale `:55`-`:68`). Request: `ScopeKey` init-only at
`Source/Core/MMCA.Common.Shared/Notifications/PushNotifications/SendPushNotificationRequest.cs:28`,
bounded by `SendPushNotificationRequestValidator.cs:27`-`:29`.
Controllers (`Source/Presentation/MMCA.Common.API/Controllers/Notifications/`):
`NotificationsController.cs` `[FeatureGate]` `:28`, `[HasPermission(NotificationPermissions.Manage)]`
`:29`, class `:30`, `[HttpPost]` `:43`, `[Idempotent]` `:44`, `Idempotency-Key` read after the S6932
pragma `:61`, command with `DedupKey = dedupKey` `:69` (the raw header; hashing happens in the
handler); `NotificationInboxController.cs` `[FeatureGate]` `:27`, `[Authorize]` `:28`,
`InboxController` `:29`, `[FromQuery, StringLength(PushNotification.ScopeKeyMaxLength)] string? scope`
`:46`, `:70`, `:113` (mark-one `[HttpPut("{id:int}/read")]` `:86` takes no scope, read-all `:110`);
`DevicesController.cs` `[FeatureGate]` `:24`, `[Authorize]` `:25`, class `:26`,
`IPushDeviceRegistrar` `:27`, `[HttpPut]` `:31`, `[HttpDelete("{installationId}")]` `:55`.
Inbox slices (`Source/Core/MMCA.Common.Application/Notifications/UserNotifications/UseCases/`):
`GetInbox/GetMyNotificationsHandler.cs` `MaxPageSize = 500` `:21`, scope filter `:40`-`:43`, caller
filter `:50`; `GetUnreadCount/GetUnreadNotificationCountHandler.cs` caller `:25`, scope `:31`-`:38`;
`MarkAllRead/MarkAllNotificationsReadHandler.cs` caller `:30`, scope `:37`-`:45`;
`MarkRead/MarkNotificationReadHandler.cs` id plus caller `:26`, `TimeProvider` injected `:15` and used
`:38`.
DI: `Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs` `AddInfrastructure` `:57` calls
`AddServices()` `:235` (declared `:295`), which does `TryAddTransient` for `IEmailSender` ->
`SmtpEmailSender` `:325`, `IPushNotificationSender` -> `NullPushNotificationSender` `:326`,
`ILiveChannelPublisher` -> `NullLiveChannelPublisher` `:327`, `INativePushSender` ->
`NullNativePushSender` `:331`, `IPushDeviceRegistrar` -> `NullPushDeviceRegistrar` `:332`.
`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Notifications.cs`: `AddPushNotifications`
`:41`, `AddSignalR()` `:48`, `redis` connection string `:50`, per-application `ChannelPrefix` with
`AddStackExchangeRedis` `:53`-`:61`, `SignalRPushNotificationSender` `:65`,
`SignalRLiveChannelPublisher` `:66`, `ClaimBasedUserIdProvider` `:67`; `AddNativePushNotifications`
`:82`, enabled-and-complete guard `:88`-`:93`, `AzureNotificationHubNativePushSender` `:98`,
`AzureNotificationHubDeviceRegistrar` `:99`. Application registers only
`NullNotificationRecipientProvider` at `Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:75`.
Hub and sender: `Source/Core/MMCA.Common.Infrastructure/Notifications/NotificationHub.cs`
`[Authorize]` `:24`, class `:25`, `ReceiveNotificationMethod` `:30` (plus `ReceiveChannelEventMethod`
`:33`, `JoinChannelMethod` `:36`, `LeaveChannelMethod` `:39`, `JoinChannelAsync` `:128`
(`[HubMethodName]` `:127`), `LeaveChannelAsync` `:145` (`[HubMethodName]` `:144`), per ADR-039);
`Source/Core/MMCA.Common.Infrastructure/Notifications/Push/SignalRPushNotificationSender.cs`
`BatchSize = 100` `:14`, `SendToUsersAsync(userIds, title, body, metadata = null, cancellationToken)`
`:24`, sends on `NotificationHub.ReceiveNotificationMethod` `:20`, `:30`, `:38`;
`ClaimBasedUserIdProvider` at `Source/Core/MMCA.Common.Infrastructure/Context/ClaimBasedUserIdProvider.cs`.
ADC scope: `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/Notifications/CurrentEventNotificationScopeProvider.cs`
resolves `NotificationScopeKey.ForEvent(currentEvent.EventId)` `:67`, caches a resolved key five
minutes `:41`, and on no event or a failure (`catch` `:74`) answers from `LastResolvedOrSentinel`
(`:79`-`:83`, `:124`-`:128`): the last resolved key or `UnresolvedScopeKey` = `event:0` `:39`, a key
no row carries; the "never answers unscoped" reasoning is its own remarks `:20`-`:24`.
ADR mapping: `Website/docs-src/adr/024-push-notifications.md` records the scope key (status `:5`-`:6`),
the per-application backplane channel (`:9`-`:10`), the sender-scoped dedup key (`:13`), the
propagate-and-roll-back dedup race (`:14`, decision `:43`-`:57`) and the WebSockets-only hub client
(`:15`); the ADR-024 + ADR-044 mapping holds.
Carried forward from the 2026-10-02 read, not re-read this run: the command and decorator, aggregate,
EF configuration (bar the `[UseDatabase]` lines), inbox controller and slices (bar the join and the
validator), `DependencyInjection.Notifications.cs`, `SignalRPushNotificationSender` and ADC scope
provider anchors above (ADR-024 `:39`-`:51` independently cites `SendPushNotificationCommand.cs:23`
and `PushNotificationConfiguration.cs:69`-`:73` at v1.233.0), plus `AttendeeNotificationRecipientProvider` (ADC),
`PushNotificationInvariants`, `SmtpEmailSender` building a fresh `SmtpClient` per send, the idempotent
`UserNotification.MarkAsRead`, `GlobalUsings.NotificationIdentifierType.cs`, the `DevicesController`
delete documentation, and the content of `Website/docs-src/adr/044-native-push-delivery.md`.
The `SendPushNotificationHandler` code block is an illustrative reconstruction of the step order, not
a verbatim copy: it simplifies variable names, inlines the `LiveMetadata` dictionary as a comment and
drops the `Result<PushNotification>` unwrap. Next article: Article 22, live channel push.*
