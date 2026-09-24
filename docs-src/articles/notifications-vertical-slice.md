# Notifications as a vertical slice: in-app inbox, real-time push, native push, and email

> Series: MMCA.Common · Article #21 (deep-dive) · Pillar P2 · Group G10 · Rubric §5 · ADR-024 + ADR-044 ·
> Status: grounded in `MMCA.Common/CLAUDE.md` ("Push Notifications"),
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
   key. When a key is present the handler looks the notification up first, and a hit returns the
   existing DTO without sending anything at all. No key means no lookup, which is the default path:
   every send creates a new notification.
2. **Resolve recipients.** The handler does not know who the audience is. It asks the injected
   `INotificationRecipientProvider` for the user IDs. This is the key swap point: the framework ships a no-op
   `NullNotificationRecipientProvider` that returns an empty list, and the consuming app overrides it.
   ADC registers `AttendeeNotificationRecipientProvider`, which calls the Identity module to mean "every
   attendee." An empty recipient set short-circuits to a `Validation` failure, so the framework stays
   domain-agnostic while the app decides scope.
3. **Persist the audit aggregate, in its own save.**
   `PushNotification.Create(title, body, sentByUserId, recipientCount, dedupKey, scopeKey)` validates
   title and body via `PushNotificationInvariants`, checks that the dedup key and the optional scope
   key each stay within 128 characters, and returns a `Result<PushNotification>`. It is saved with
   `Status = Pending` and a snapshot `RecipientCount`. That save stands alone precisely so a lost
   race on the dedup key can be caught and answered (next section).
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
var dedupKey = string.IsNullOrWhiteSpace(command.DedupKey) ? null : command.DedupKey;
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
try { await _unitOfWork.SaveChangesAsync(ct); }                    // save 1: the audit row alone
catch { /* CA1031: lost the filtered-unique-index race? requery by key, return the winner */ throw; }

foreach (var userId in recipients) { /* create a UserNotification inbox row */ }
await _unitOfWork.SaveChangesAsync(ct);                            // save 2: the inbox rows, still no delivery

try { await _push.SendToUsersAsync(recipients, title, body, ct); notification.MarkAsSent(); }
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
`"event:2"`), stamped by the sending application and stored on the audit aggregate. The framework
attaches no meaning to it. An app whose notifications belong to one edition of something sets it, and
every caller that omits it sends exactly as it always did. ADC resolves the current published event
and scopes to `event:{id}`, degrading to null (unscoped) if no event resolves, which is the safe
direction because scope is a view filter, not a security boundary. That is also why the column is
deliberately unindexed: the filter runs after the primary-key join from the inbox, over a table that
holds one row per send, so an index would cost writes without buying a read.

## Retry safety on two levels: the idempotency filter and the dedup key

A broadcast is exactly the operation you never want to run twice, and the two ways it gets run twice
are different problems. The client retries the HTTP call; or two retries arrive close enough together
that both pass the same check. The slice answers both, at two different levels.

At the edge, the send endpoint carries `[Idempotent]`. The framework's idempotency filter caches the
first response against the caller's `Idempotency-Key` and replays it for a repeat, which is the cheap
answer to a retried HTTP call. Then the controller reads that same `Idempotency-Key` header itself
and passes it into the command as `DedupKey` (absent or whitespace-only stays null, which leaves the
send on the default undeduplicated path). The division of labor is the point: **the filter protects
the response, the dedup key protects the delivery.** When the filter's cache is cold, evicted, or
degraded (a restarted host, an expired entry, an unreachable distributed cache) the response replay is
gone, but the domain still refuses to send a second time.

Underneath, `DedupKey` is a real column on the `PushNotification` aggregate (max 128 characters,
validated in the factory), with a filtered unique index over it. That matters because the handler's
up-front lookup is a check-then-act: two concurrent retries of the same send can both pass it, and
the loser only discovers the conflict when it tries to insert. So the audit save is its own
`SaveChangesAsync`, wrapped in a catch that requeries by key: if the row exists now, the concurrent
send is the cause and the caller gets that notification back; anything else is rethrown untouched and
reaches the exception middleware. The database, not the application, arbitrates the race.

That catch is deliberately broad (a suppressed CA1031), and the reason is a layer rule rather than
laziness: Application has no EF Core dependency, so `DbUpdateException` is not a type this file is
allowed to name. The requery is what narrows it. It is the same swallow-and-requery shape the
framework's inbox store uses on its own unique index; only the nameable exception differs.

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
Redis backplane for SignalR scale-out across replicas. A host that never calls `AddPushNotifications`
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
organizer-only send and history endpoints). Four slices back it:

- `GetMyNotificationsHandler` joins `UserNotification` to `PushNotification` (title and body live on the
  push aggregate, read state lives on the per-user row) and projects a `UserNotificationDTO`, newest
  first, paginated and capped at 500 rows per page. This cross-aggregate read is done in the query, not
  via a navigation populator, because the two aggregates reference each other by ID only. That matters:
  in ADC `UserNotification` lives in its own database.
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
exactly as before, which is what keeps the pre-scope callers working.

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
`NotificationsController` (send plus history) requires the organizer policy, while `InboxController`
and `DevicesController` require only an authenticated caller. That asymmetry encodes the rule "anyone
reads their own inbox and registers their own devices, only organizers broadcast."

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
  held across an out-of-process call.
- **Inbox fan-out cost.** Step 4 writes one `UserNotification` row per recipient. For a broadcast to a
  large audience that is a lot of rows in one save. It is the price of a durable per-user inbox with
  per-user read state, and it is bounded by the recipient count, but it is real write amplification.
- **Deduplication is opt-in, and it is check-then-act plus a database index.** A send that carries no
  key behaves exactly as it always did: no protection at all. When a key is present, the up-front
  lookup is a race the handler cannot win on its own, so correctness rests on the filtered unique
  index and on a broad catch that has to requery to classify what it caught. That is a real cost in
  handler complexity, paid to keep Application free of an EF Core dependency.
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
   check is check-then-act and two retries will both pass it. Back it with a unique index and treat
   the insert failure as an answer, not just an error.

The takeaway: a framework earns trust by showing one complete feature built on its own rules. Build that
feature as a cohesive vertical slice, and it teaches the patterns better than any amount of base-class
documentation.

---

**What we covered:** why MMCA.Common ships notifications as the one concrete bounded context, how a
vertical slice beats a horizontal layer cut for cohesion, the end-to-end send flow (deduplicate,
resolve recipients, persist audit, fan out inbox, then best-effort deliver over SignalR and OS-level
native push, the whole sequence one `ITransactional` transaction), the two levels of retry safety (the `[Idempotent]` filter replaying the response, the
`DedupKey` plus its filtered unique index protecting the delivery), the optional `ScopeKey` that
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

*Notes: verified type/behavior names: `PushNotification`, `UserNotification`, `PushNotificationCreated`,
`PushNotificationStatus`, `SendPushNotificationHandler`, `NotificationsController`, `InboxController`,
`DevicesController`, `IPushNotificationSender`, `SignalRPushNotificationSender`, `NullPushNotificationSender`,
`INativePushSender`, `IPushDeviceRegistrar`, `NullNativePushSender`, `NullPushDeviceRegistrar`,
`AzureNotificationHubNativePushSender`, `AzureNotificationHubDeviceRegistrar`, `AddNativePushNotifications`,
`SendPushNotificationCommand`, `ITransactional`, `TransactionalCommandDecorator`,
`NotificationHub` (`[Authorize]`d, `ReceiveNotification` constant, `ClaimBasedUserIdProvider`; it also
hosts live-channel methods, see hub evidence below),
`INotificationRecipientProvider`, `NullNotificationRecipientProvider`,
`AttendeeNotificationRecipientProvider`, `IEmailSender`, `SmtpEmailSender`, `AddPushNotifications`,
batch size 100, 500-row inbox page cap, `DedupKey` and `ScopeKey` (128 characters each),
`NotificationFeatures.PushNotifications` feature gate,
`UserNotificationIdentifierType`/`PushNotificationIdentifierType` aliases in
`GlobalUsings.NotificationIdentifierType.cs`.
Transaction evidence (NEW this run, 2026-09-19; the send became `ITransactional` after the prior pass,
so step 7, the code block, the "durability lives in the database" paragraph, the first trade-off bullet
and the portable-lesson list are restated and a trade-off bullet is added): the command declares the
marker in its own declaration,
`Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationCommand.cs:21`-`:23`
(`: ICommandWithRequest<SendPushNotificationRequest>, ITransactional` at `:23`), with the dedup-key
rationale in its XML doc (`:11`-`:19`, "Transactional on purpose", including the stated cost that the
sender calls run inside the transaction and hold locks only on the rows just inserted, `:17`-`:18`).
`Source/Core/MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs` passes any
command without the marker straight through (`:28`-`:29`) and otherwise runs the inner handler inside
`unitOfWork.ExecuteInTransactionAsync` (`:31`-`:33`). The handler's own XML doc states the same
atomicity guarantee, including that a failed delivery is still recorded because `MarkAsFailed` ends in a
success result (`SendPushNotificationHandler.cs:13`-`:26`, "Atomicity" paragraph `:17`-`:25`).
Deduplication evidence (re-read 2026-09-19 this run; the dedup behavior is unchanged, but the new
"Atomicity" XML doc block pushed every line in the file down by ten): in
`Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs`
the handler opens by normalizing whitespace to null (`:42`) and, when a key is present, returns the
already-persisted notification without sending (`:43`-`:50`, `FindByDedupKeyAsync` hit logged by
`LogDedupHit` `:48`); the private `FindByDedupKeyAsync` helper (`:174`-`:183`) uses
`unitOfWork.GetReadRepository<...>` (`:176`). Recipient resolution follows at `:54`-`:55`, the
empty-recipient `Validation` failure at `:57`-`:63`. The audit aggregate is saved BY ITSELF at `:84`
inside a `#pragma warning disable CA1031` try/catch (`:82`-`:113`, pragma `:86`) that requeries by key
and returns the winner on the filtered-unique-index race (`:104`-`:109`, `LogDedupRaceRequery` `:107`)
and otherwise rethrows (`:112`); the inbox fan-out is a SECOND `SaveChangesAsync` at `:123` (rows
created `:116`-`:121`).
Two writes before any delivery, both inside the one transaction above. The aggregate carries `DedupKey` at
`Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:45` with
`DedupKeyMaxLength = 128` (`:19`), normalized in the private constructor (`:75`) and length-validated in
the factory (`:107`-`:113`). The filtered unique index is configured at
`Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:67`-`:69`
(`IsUnique()` + `HasSoftDeleteFilter(additionalFilter: "[DedupKey] IS NOT NULL")`, SQL Server engine
base class only), with the max length at `:46`-`:47`. The two-level retry story starts at the
controller: `[HttpPost]` `:43` carries `[Idempotent]` `:44` in
`Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs`, which reads
the `Idempotency-Key` header (`:62`-`:66`, whitespace to null `:65`) and passes it as
`new SendPushNotificationCommand(request, userId.Value) { DedupKey = dedupKey }` (`:69`); the
"filter replays the response, DedupKey protects delivery" division of labor is stated in the method's
own XML doc (`:37`-`:41`).
Scope-key evidence (carried forward from the 2026-08-14 pass, confirmed unchanged this run apart from
the handler line noted below, which moved with the rest of that file): the aggregate carries `ScopeKey` at
`Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:53` with
`ScopeKeyMaxLength = 128` (`:22`), normalized in the private constructor (`:76`) and length-validated
in the factory (`:114`-`:120`); the "opaque view filter, not a security boundary" wording is the
property's own XML doc (`:47`-`:52`). The caller supplies it as an init-only property on
`Source/Core/MMCA.Common.Shared/Notifications/PushNotifications/SendPushNotificationRequest.cs:13`
(positional parameters left untouched so every existing caller compiles), bounded again at the
edge by `SendPushNotificationRequestValidator.cs:27`-`:29`, and
`SendPushNotificationHandler.cs:72` passes it into `Create`. The EF configuration maps it at
`PushNotificationConfiguration.cs:52`-`:53` and is deliberately unindexed, with the reason in the
comment above it (`:49`-`:51`). Three read/write slices take the optional scope, each filtering
`pn.ScopeKey == null || pn.ScopeKey == scopeKey`:
`Notifications/UserNotifications/UseCases/GetInbox/GetMyNotificationsHandler.cs:40`-`:43` (the
500-row page cap is `MaxPageSize` `:21`), `GetUnreadCount/GetUnreadNotificationCountHandler.cs:31`-`:38`,
and `MarkAllRead/MarkAllNotificationsReadHandler.cs:30`-`:43`; the single-row
`MarkNotificationReadCommand` takes no scope. `InboxController` exposes each as an optional
`[FromQuery, StringLength(PushNotification.ScopeKeyMaxLength)] string? scope` (`:47`, `:71`, `:114`).
ADC's `Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/CurrentEventNotificationScopeProvider.cs`
resolves the current published event into `event:{id}` (`:54`) and degrades to null (unscoped) on any
failure (`:57`-`:61`). `Website/docs-src/adr/024-push-notifications.md` records the scope key in its
2026-08-14 revision (`:5`-`:6`, send-side detail at `:26`-`:27`), so the article's ADR-024 + ADR-044
mapping still holds.
Native push evidence (ADR-044, re-read 2026-09-19 this run; behavior unchanged, every line number moved
down by ten with the new "Atomicity" XML doc block):
`SendPushNotificationHandler` injects
`INativePushSender nativePushSender` in its primary constructor at
`Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:31`,
and calls `nativePushSender.SendToUsersAsync(recipientIds, title, body, ct)` at `:151`-`:155` inside its own
non-fatal try/catch (`:149`-`:162`, `#pragma warning disable CA1031` `:157`) placed BETWEEN the SignalR leg
(`:126`-`:143`, which alone calls `MarkAsSent` `:134` / `MarkAsFailed` `:141`) and the final
`unitOfWork.SaveChangesAsync` at `:164`; the native-leg failure is logged via `LogNativePushFailed`
(call site `:161`; the `[LoggerMessage]` attribute is `:191`, declaration `:192`) and does not touch the audit status. `Website/docs-src/adr/044-native-push-delivery.md` records the
decision (amends ADR-024): Azure Notification Hubs fan-out, `user:{id}` installation tags, Null-by-default
Application ports.
Three-controller evidence (all `[FeatureGate(NotificationFeatures.PushNotifications)]`, re-read
2026-09-19 this run; `DevicesController` shifted +1, `InboxController` shifted -1,
`NotificationsController` holds):
`DevicesController` at `Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs`
(`[FeatureGate]` `:24`, `[Authorize]` any signed-in user `:25`, `public sealed class DevicesController`
`:26`, injects `IPushDeviceRegistrar` `:27`, `PUT` upsert `:31`, idempotent `DELETE {installationId}`
`:55`, whose caller-scoped, non-probeable 204 is documented at `:48`-`:54` and returned at `:69`);
`NotificationsController` `[FeatureGate]` at
`Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:28`
(organizer policy `[HasPermission(NotificationPermissions.Manage)]` `:29`, class declaration `:30`);
`InboxController` `[FeatureGate]` at
`Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationInboxController.cs:27`
(authenticated-only `:28`, class declaration `:29`).
DI-layer evidence (re-read 2026-09-19 this run; the behavior is unchanged, but this file grew by roughly
260 lines since the prior pass, so every citation below was re-read rather than shifted): the push,
native-push, and email null/default registrations all
live in the INFRASTRUCTURE layer, not Application. `Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:734`
registers `IEmailSender` -> `SmtpEmailSender` (`TryAddTransient`, unconditional default, no Null analogue),
`:735` registers `IPushNotificationSender` -> `NullPushNotificationSender`, `:740` registers
`INativePushSender` -> `NullNativePushSender` and `:741` registers `IPushDeviceRegistrar` ->
`NullPushDeviceRegistrar` (both ADR-044 no-op defaults); all sit inside `AddServices()` (declared `:704`),
which `AddInfrastructure` (declared `:72`) always calls (`:240`). `AddNativePushNotifications(configuration)`
(declared `:861`) binds and reads the `NativePush` section (`:863`-`:866`) and returns untouched unless
`Enabled` + `ConnectionString` + `HubName` are all present (guard `:867`-`:872`); when enabled and complete
it swaps in
`AzureNotificationHubNativePushSender` (`:877`) and `AzureNotificationHubDeviceRegistrar` (`:878`);
`AddPushNotifications` (declared `:820`) calls `AddSignalR()` (`:827`), adds the Redis backplane only when a
`redis` connection string is present (`:829`-`:841`, `AddStackExchangeRedis` `:839`), and swaps in
`SignalRPushNotificationSender` (`:844`) and, per
ADR-039, `SignalRLiveChannelPublisher` (`:845`) over the default `NullLiveChannelPublisher` (`:736`), plus
`ClaimBasedUserIdProvider` (`:846`). The
Application layer's `AddNotificationApplicationServices()` registers only the recipient null-default
`NullNotificationRecipientProvider` at
`Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:74`.
The `SendPushNotificationHandler` code block is an illustrative reconstruction of the documented step
order, not a verbatim copy. Its call shapes mirror the real signatures:
`PushNotification.Create(string title, string body, UserIdentifierType sentByUserId, int recipientCount, string? dedupKey = null, string? scopeKey = null)`
declared at `Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:96`-`:102`
(its XML doc, including both optional-key parameters, at `:79`-`:95`)
and called at
`Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:66`-`:72`
(the handler passes `command.SentByUserId`, `recipientIds.Count`, the normalized `dedupKey`, and
`command.Request.ScopeKey`; the real handler resolves its repositories through
`unitOfWork.GetRepository<...>` at `:79` and `:116` rather than an injected field), and
`IPushNotificationSender.SendToUsersAsync(userIds, title, body, metadata = null, ct)` at
`Source/Core/MMCA.Common.Infrastructure/Services/SignalRPushNotificationSender.cs:25`
(both the SignalR and native calls pass title/body and omit the optional metadata). The block simplifies
variable names, collapses the requery branch of the CA1031 catch to a comment, and drops the
`Result<PushNotification>` unwrap for readability.
Hub evidence (re-verified 2026-08-14 this run, unchanged, still correcting the earlier "empty hub" claim):
`Source/Core/MMCA.Common.Infrastructure/Hubs/NotificationHub.cs` is `[Authorize]`d (`:16`),
`public sealed class NotificationHub` (`:17`), and now carries four method-name constants
(`ReceiveNotificationMethod = "ReceiveNotification"` `:20`, `ReceiveChannelEventMethod` `:23`,
`JoinChannelMethod` `:26`, `LeaveChannelMethod` `:29`) plus two client-invokable live-channel hub methods
`JoinChannelAsync` (`:44`) and `LeaveChannelAsync` (`:60`), added per
`Website/docs-src/adr/039-live-channel-push.md`. This article scopes to the durable-push path, which uses only
`ReceiveNotificationMethod`: `SignalRPushNotificationSender` sends on `NotificationHub.ReceiveNotificationMethod`
at `Source/Core/MMCA.Common.Infrastructure/Services/SignalRPushNotificationSender.cs:21,31,39`.
Connection-to-user mapping remains `ClaimBasedUserIdProvider`
(`Source/Core/MMCA.Common.Infrastructure/Services/ClaimBasedUserIdProvider.cs`). The live-channel layer
(`JoinChannel`/`LeaveChannel`, `ILiveChannelPublisher`) is the subject of the next article (Article 22,
live channel push).*
