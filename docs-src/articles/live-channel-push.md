# Ephemeral by design: sub-second live channels over one SignalR hub

> Series: MMCA.Common · Article #22 (deep-dive) · Pillar P2/P3 · Group G10,G23 · Rubric §5,§7 ·
> ADR-039, ADR-052, ADR-074 ·
> Status: grounded in `Website/docs-src/adr/039-live-channel-push.md`,
> `Website/docs-src/adr/074-recurring-job-scheduler.md` and the framework source
> (`ILiveChannelPublisher`, `NotificationHub`, `SignalRLiveChannelPublisher`,
> `NullLiveChannelPublisher`, `IScheduledJob`, `ScheduledJobRunner`) plus the ADC gRPC-ingress
> adoption. No em dashes.

**Subtitle:** Conference-day polls and Q&A need small events fanned out to whoever is watching the page
right now, and persisting them is wrong. Here is how MMCA.Common adds interest-group channels to its
single SignalR notification hub and splits durable from ephemeral at the publisher boundary, without a
second WebSocket.

---

You have a durable notification pipeline. It is careful and correct: it resolves recipients, writes one
inbox row per user, and fires a best-effort real-time push, with the inbox as the source of truth. It is
the pattern from Article 21 in this series, and it is the right shape when a user must be able to find
the message minutes later.

Now the conference floor opens a live poll. Two hundred phones are looking at the same question, votes
are landing several per second, and every one of them needs to light up the running tally on every other
screen in under a second. Reach for the durable pipeline here and you inherit all the wrong costs. The
outbox deliberately delays eligibility (`Outbox:ProcessingDelaySeconds`, default 5s, ADR-003) so an
in-process handler can run first, which is exactly the latency you cannot pay. You would write a per-user
inbox row for a tally that is worthless a second later and that nobody will ever open. You would persist
data whose entire value is that it is on screen right now.

The other instinct is to stand up a second SignalR hub for live traffic. That doubles the WebSocket
connection count per client and forces you to solve auth, reconnect, and the scale-out backplane twice,
then split the client-side connection management in two. You now maintain two of everything to carry one
more kind of message.

## Two message shapes, not two transports

The mistake in both approaches is treating "durable notification" and "live update" as if the difference
lives in the transport. It does not. Both are small messages pushed over a WebSocket. The difference is
the delivery contract:

- A **durable notification** is something a user must be able to find later. It is inbox-backed, it
  survives an offline user, and losing it is a bug.
- A **live channel event** is something that only matters while it is on screen. It is broadcast to an
  interest group rather than a user list, it is never persisted, and it carries no delivery guarantee.
  Losing it is fine, because the next fetch shows the truth anyway.

ADR-039 makes that the whole design: one realtime transport, and the durable-versus-ephemeral decision is
taken at the **publisher boundary**, not the transport. `IPushNotificationSender` for the first kind,
`ILiveChannelPublisher` for the second. Same hub, same connection, two contracts.

## The MMCA answer: one hub, two publisher paths

The single `NotificationHub` gains channel semantics. A channel is just a SignalR group named by a key
like `event:1` or `session:123`, and the hub gets its first client-invokable methods: `JoinChannelAsync`
and `LeaveChannelAsync` (surfaced as the `JoinChannel` and `LeaveChannel` hub-method-name constants) map
the calling connection into or out of that group. Alongside the existing `ReceiveNotification` method
name it now also declares `ReceiveChannelEvent`, the client-side method channel events arrive on. Four
method-name constants, one hub.

Publishing rides a new Application-layer port, `ILiveChannelPublisher`, that sits right beside
`IPushNotificationSender`:

```csharp
// The publisher interface. Application code depends only on the port, never on SignalR:
//   ILiveChannelPublisher.PublishAsync(channelKey, eventName, payloadJson, ct)   // ephemeral, no persistence
//   IPushNotificationSender.SendToUsersAsync(...)                                // durable, inbox-backed

// 1. The command handler commits the durable truth and returns the caller's fresh tallies.
//    It holds neither the publisher nor the queue: the aggregate raised LivePollVoteChanged,
//    and the broadcast hangs off that event instead.
await unitOfWork.SaveChangesAsync(ct);
var results = await resultsBuilder.BuildAsync(poll, command.UserId, ct);  // includes the caller's own vote
return Result.Success(results);

// 2. The domain-event handler runs after that commit, off the request path. It rebuilds the
//    tallies with no caller identity, so MyVoteOptionId stays null and no per-user field can
//    ride the broadcast.
var results = await resultsBuilder.BuildAsync(poll, userId: null, ct);
var channelKey = poll.SessionId is { } sessionId
    ? LivePollChannel.ForSession(sessionId)                               // "session:123"
    : LivePollChannel.ForEvent(poll.EventId);                             // "event:1"

// Enqueue returns void, deliberately: the channel is DropOldest, so it evicts to make room
// rather than refusing the write, and there is nothing here for a caller to branch on. Drops
// surface through the channel's itemDropped callback: DroppedCount plus a warning per drop.
liveChannelPublishQueue.Enqueue(new LiveChannelPublishWorkItem(
    channelKey,
    LivePollChannel.PollResultsChanged,
    JsonSerializer.Serialize(results, JsonSerializerOptions.Web)));
```

Three things in that block are load-bearing. First, the broadcast is enqueued **after** the commit, and
it is the placement that guarantees it. Enqueue inline in the command handler and the enqueue runs while
the transactional decorator still holds the transaction open, so a rollback can leave clients already
told about a vote that never persisted. Hanging the enqueue off a handler for the `LivePollVoteChanged`
domain event buys post-commit delivery with no sequencing code at all: in-process domain-event dispatch
inside a transactional command is deferred until after the commit succeeds and dropped on rollback, so
the guarantee follows from where the work is attached. The enqueue itself is a non-blocking write to a
bounded in-process queue, and a single-reader hosted drain worker forwards each item to the publisher
off the request path (BR-229), so a hub hiccup, a slow peer, or a down Notification service can neither
stall nor fail the command.

Second, the payload is a **pre-serialized JSON string**. There is exactly one serialization point,
at the enqueue edge, and the same opaque string rides every hop unchanged. The port's contract is
`PublishAsync(channelKey, eventName, payloadJson, ct)`, and no serializer type crosses it.

Third, a queue that evicts cannot report a drop through its return value. The channel is configured
`DropOldest`, so the underlying `TryWrite` always succeeds: it makes room rather than refusing the write.
A bool return would therefore be a promise the queue cannot break, and an "if the enqueue failed, log
it" branch written against it is dead code that makes every drop under backpressure look impossible. So
the port method is `void Enqueue(LiveChannelPublishWorkItem workItem)`, and its own contract says the
queue never rejects an item, leaving nothing for a caller to branch on. Drops go through the channel's
`itemDropped` callback instead: each one increments a `DroppedCount` and logs a warning with the running
total, so a drain falling behind is visible rather than inferred from missing client updates.

The implementation is chosen at the composition root, the same null-object discipline the durable sender
uses. Infrastructure registers a no-op `NullLiveChannelPublisher` as the default, so the port resolves in
every host whether or not real-time transport is configured. `AddPushNotifications(configuration)` then
replaces it with `SignalRLiveChannelPublisher`, which is a nine-line class: it group-sends
`ReceiveChannelEvent` through `IHubContext<NotificationHub>`. It never holds a hub connection itself, so a
host that never calls `AddPushNotifications` keeps the no-op and the publishing code still resolves and
runs with nothing on the wire.

## Joining a channel, and why the key is validated

Channel membership is a property of the one existing connection, which is the point of not adding a second
hub. On the browser side, `NotificationHubService` carries both traffic kinds on that connection.
`JoinChannelAsync` and `LeaveChannelAsync` track membership, and `OnChannelEvent` registers **multicast**
subscriptions, so an invisible layout listener and the page in front of you can observe the same channel
concurrently without fighting over one callback. Every tracked channel is re-joined automatically on
`Reconnected`, because SignalR group membership does not survive an automatic reconnect: the server starts
the new connection with no groups, so the client has to rejoin or it goes silent after the first blip.

The join is not a free-for-all. `JoinChannelAsync` on the hub validates the requested key against
`PushNotificationSettings.ChannelKeyPattern` (default `NotificationScopeKey.Pattern`, which is
`^(event|session):[0-9]+$`) and throws a `HubException` on a miss, so a client cannot subscribe itself to
`admin:secrets` by inventing a group name. The pattern is a configurable regex (compiled once and cached,
with a one-second match timeout), so the framework closes the obvious abuse vector without hardcoding any
app's channel vocabulary.

Shape is not entitlement, though, and the hub says so in its own comment: a well-formed key is any
authenticated caller's for the asking unless the host supplies one more thing. That thing is
`IChannelJoinAuthorizer`, an optional, defaulted constructor dependency the hub consults after the
pattern check and before the group membership exists, so a caller who is not entitled to a channel never
receives a single payload published to it. The default of "no authorizer" keeps an existing host working
unchanged, and a host that publishes anything to a channel that is not public to every signed-in user is
expected to register one. The connection itself is bounded on the same hub:
`PushNotificationSettings.MaxConnectionsPerUser` (default 20) caps live connections per user identifier
per replica, and a refused connection hands its slot straight back, so aborted connections draining out
cannot lock an account out of its own tab.

## Crossing a service boundary: the gRPC ingress

Here is where the publisher abstraction earns its keep. In ADC the module that raises live events (Engagement, running the
poll and Q&A handlers) is **not** the host that maps the hub. The Notification service maps it, because it
is the only process whose `IHubContext` can reach the connected clients. So Engagement cannot call
`SignalRLiveChannelPublisher` directly, there is no hub in its process.

ADR-039 anticipated exactly this: "a host that does not map the hub can replace the registration with its
own transport." ADC does that with a gRPC adapter. Engagement calls `AddNotificationLiveChannelClient()`,
which registers a typed gRPC client and `Replace`s (not `TryAdd`s) the `ILiveChannelPublisher`
registration with `LiveChannelPublisherGrpcAdapter`. The publishing handlers do not resolve that port at
all: the vote and upvote domain-event handlers enqueue the pre-serialized payload onto the in-process
publish queue and return. The single-reader drain worker resolves `ILiveChannelPublisher` per item, which in this process
is the gRPC adapter, and it forwards the payload over `PushToChannel` under a tight two-second deadline,
swallowing every failure (transport, resolution, broken circuit). Best-effort all the way down, and because
the forwarding runs off the request path, neither a slow nor a down Notification service can add a
millisecond to an Engagement vote.

The queue is applied everywhere, not just on the two hot paths. The four lower-frequency command handlers
(closing a poll, opening one, submitting a question, moderating one) publish one broadcast per operator
action, which is little enough to argue for awaiting `PublishAsync` inline. They enqueue anyway, and the
argument for that is not latency: an inline await also makes every one of those commands hostage to a
peer it has no reason to depend on. All four inject the queue and enqueue after the save, so not one
command handler in the module awaits a gRPC publish, and none of them wraps a publish in a hand-rolled
`try`/`catch`. The two question handlers do carry a guard, because their pending branch reads a fresh
count from the database before it enqueues and that read must never fail a question that has already
committed, but the guard is the framework's `BestEffort.ExecuteAsync` helper rather than a local catch:
one Warning plus one increment of a `besteffort.dispatch.failed` meter tagged by operation name. What is
guarded is a database read rather than a publish, which is a much smaller thing to have to swallow, and a
broadcast path that has quietly stopped working is a number an operator can alert on instead of a log
line nobody reads.

On the Notification side, `LiveChannelGrpcService` receives the RPC and simply delegates to its own
`ILiveChannelPublisher`, which in that host is the real `SignalRLiveChannelPublisher`. The payload's
opacity is what makes this trivial: no service on the path deserializes it, so no shared payload type has
to cross the wire.

The one piece of real infrastructure this needs is the transport profile from ADR-012. Notification's
default Kestrel endpoint stays `Http1AndHttp2` so the SignalR WebSocket upgrade handshake still works,
and its cleartext gRPC ingress lives on a **dedicated `Http2`-only endpoint** named `grpc` alongside it.
That mixed-endpoint profile is what lets one service serve both a WebSocket to browsers and an h2c gRPC
ingress to peers.

## The queue is where you say what the work is worth

The publish queue in this article is one instance of a general contract (ADR-052): work that outlives
a request goes on a bounded `Channel<T>` singleton, drained by a `SingleReader` hosted worker. What
makes the contract interesting is that the *same* shape encodes two opposite correctness decisions,
and the field that carries the decision is `FullMode`.

The live-channel queue is the permissive end:

```csharp
private const int Capacity = 1024;

_channel = Channel.CreateBounded<LiveChannelPublishWorkItem>(
    new BoundedChannelOptions(Capacity)
    {
        FullMode = BoundedChannelFullMode.DropOldest,
        SingleReader = true,
        SingleWriter = false,
    },
    itemDropped: OnItemDropped);
```

`DropOldest` is the right answer here precisely because the payload is ephemeral. If the drain falls
behind, the oldest pending broadcast is the *least* valuable thing in the queue, since a newer poll
tally supersedes it anyway. A consequence worth knowing: under `DropOldest`, `TryWrite` always
succeeds, because the channel evicts to make room rather than refusing. A caller checking the return
value learns nothing, so a drop is observable only through the `itemDropped` callback and the
discarded-broadcast counter it feeds.

The other end of the same field is `FullMode = BoundedChannelFullMode.Wait`, paired with the
**non-blocking** `TryWrite` rather than an awaited `WriteAsync`. That combination makes a full queue
*refuse* the request outright instead of either discarding it or blocking the request thread, which is
the right answer when silently dropping work someone asked for is a bug rather than backpressure. A
small capacity goes with it, because the bound then exists to refuse a runaway caller rather than to
absorb a burst.

There is a prior question, though, and it decides whether a channel is the right home at all. An
in-process queue is exactly as durable as the replica holding it: a deploy or a crash between the
enqueue and the drain takes the pending items with it. That is the correct trade for a poll tally,
whose value expires in a second anyway, and it is why the live-publish queue is the only bounded
`Channel<T>` in MMCA.Common, MMCA.Store and MMCA.ADC. Work that a restart must not lose goes
in a row instead. ADC's AI scoring pass over an event's sessions is that kind of work, so the
organizer's request writes one durable internal command row and returns, and the framework's processor
claims it, restores the requesting organizer's principal and runs the pass through the ordinary CQRS
pipeline under a per-event distributed-lock claim taken with a zero wait, so a duplicate trigger skips
rather than queues behind the run in flight. That mechanism, and how it sits beside channels and cron,
is Article 51 in this series, "Four ways to do work later: channels, cron and durable internal
commands".

The reusable idea is that "put it on a queue" is not a design decision, it is the start of one. The
decisions are what happens when the queue is full, and whether losing the item on restart is
acceptable at all, and the honest answers differ for a presence ping and for a job someone is waiting
on.

## The sibling contract: work a clock owns

The queue above and the durable row beside it answer the same question: a request started work and must
not wait for it. Neither can answer the other one. Nothing starts a nightly retention purge except the calendar, and an
in-process bounded queue is exactly the wrong home for it. It is empty at boot, it belongs to one
replica, and it is gone on restart.

The first instinct is a periodic hosted service with a 24-hour interval, and it fails twice. An
interval is not a time of day, so "every 24 hours" lands at whatever hour the last deploy happened to
be and drifts with every restart after. And an interval-driven hosted service runs on **every**
replica, so scaling a service to three instances silently triples the purge. The second instinct is
Hangfire or Quartz.NET: a schema, a storage abstraction, a dashboard to authorize and host, and an
upgrade obligation that every extracted service host inherits. ADR-074 declines both, on the grounds
that the framework already ran a durable, multi-replica-safe polling loop in production. The outbox
claims a batch of rows with one `ExecuteUpdateAsync` that stamps a lease and a token, and only one
racing replica matches the predicate. The missing piece was a cron expression, not a product.

So the scheduler is that same claim-lease idiom pointed at a calendar:

```csharp
// A job is a name, a schedule and a body. Nothing else.
public interface IScheduledJob
{
    string Name { get; }              // primary key of the persisted row: renaming it strands the old schedule
    string CronExpression { get; }    // five-field, UTC, parsed by Cronos; Scheduler:Jobs:{Name}:Cron overrides it
    Task ExecuteAsync(CancellationToken cancellationToken);
}

// The claim is what makes scale-out safe: two replicas racing on the same row both issue this
// update, and exactly one of them matches the still-unleased predicate.
var claimed = await context.Set<ScheduledJobEntry>()
    .Where(e => e.JobName == jobName
        && e.NextRunOn <= now
        && (e.LockedUntil == null || e.LockedUntil < now))
    .ExecuteUpdateAsync(
        s => s.SetProperty(e => e.LockedUntil, leaseUntil)
              .SetProperty(e => e.LockToken, lockToken),
        cancellationToken);
```

Three members, and the third one is ordinary application code. Jobs are resolved **scoped, in a fresh
DI scope per execution**, the same way a request handler is, so a job body can take a unit of work, a
repository or a command handler and nothing about it knows it is on a schedule. It also means the
long-lived runner never captures a scoped dependency, which is the failure mode a hand-rolled timer
usually ships with.

The state is one row per job (`JobName` as the primary key, plus the cron expression, `NextRunOn`,
`LastRunOn`, the last outcome and duration, and the lease pair), and it lives in the **Default** data
source only. That is a deliberate split from the outbox, which exists once per physical database
because an outbox row has to be written in the same transaction as the aggregate that produced it. A
schedule has no such tie: a job belongs to the host that registered it, so a four-database host gets
one schedule rather than four copies of it contending for one occurrence. The token that won the
claim also guards the outcome stamp, so a replica whose lease expired mid-run writes nothing and
drops its stale result instead of overwriting the current holder's.

The runner is a plain `BackgroundService` rather than a fixed-period one, for the same reason the
outbox is: after each cycle it sleeps until the **earliest** `NextRunOn` across the store, read
through `TimeProvider`, capped at the polling interval (30 seconds by default) and floored at one
second so an overdue row another replica already holds cannot spin the loop. A host with one nightly
job is not waking 2,880 times a day to find nothing due, and because every timestamp comes from
`TimeProvider`, a test can drive months of schedule in microseconds. Cronos (MIT, zero dependencies)
is the one piece bought rather than built: it turns a string into the next occurrence and has no
opinion about storage or hosting.

Two consequences worth stating plainly. A missed schedule runs **once** and then advances: the next
occurrence is computed from the instant the run finished, not from the occurrence that was missed, so
a host that was down for six hours fires one purge instead of six. That is right for a purge and
wrong for a job that must produce an artifact per window, which has to make the window explicit in
its own state rather than infer it from the schedule. And the lease is a time lease, not a fence: a
run that overstays it can be claimed by another replica, so job bodies carry the same idempotency
obligation the outbox already puts on event handlers.

The capability is opt-in, and the proof is a test rather than a promise: build the real model for a
host that never called `AddScheduledJobs` and the job entity is simply absent, so a consumer that
wants none of this gains no table in its next migration. In the adoption sweep all three Store
services, three ADC services and the Helpdesk web host turned it on, each running its own runner
against its own database. Engagement is the neat one for this article: the same composition root that
swaps in the gRPC live-channel adapter registers the cron runner earlier in the same file. One host,
three kinds of background work, and the thing that tells them apart is not the mechanism but who owns
the work: a request, a clock, or a committed transaction.

## Trade-offs, honestly

The ADR names the sharp edges, and they are all consequences of the ephemeral contract, not accidents:

- **Ephemeral means lossy.** A client that connects after an event was published never sees it. This is
  the defining constraint, and it shapes every consumer: features must treat a channel event as a
  cache-invalidation hint over fetchable state, not as the state itself. The high-frequency tally events
  carry the fresh counts in their payload so a page can patch in place, but the safety net is always that
  the next fetch shows the truth.
- **Type safety is by convention.** Handlers receive raw JSON and deserialize themselves. There is no
  compile-time contract on the payload; the discipline is a shared payload record in the consuming app's
  Shared project, referenced by both the publisher and the subscriber.
- **Durable notifications are still single-subscriber.** Only channel events are multicast. The single
  settable `NotificationCallback` for durable notifications remains one subscriber. Unifying the two is
  deliberate future work, not something this decision blocks.
- **Multi-replica needs the backplane.** If a hub-hosting service runs more than one replica, group sends
  only reach connections on other replicas through the Redis backplane that `AddPushNotifications` wires
  when a `redis` connection string is present. Single-replica deployments need nothing extra.
- **Best-effort is not delivery.** A publish can still be discarded at three points: the queue evicts its
  oldest item under sustained backpressure, the drain worker swallows a publish failure, and the gRPC
  adapter swallows a transport failure. None of them are silent now (the eviction is counted on
  `DroppedCount` and logged with a running total, the drain's swallow is the shared `BestEffort` helper
  so it is both logged and counted on a meter, and the adapter's is logged per occurrence), but that is
  observability, not delivery. It is the correct posture for a hint over durable state, and it still means
  "the event fired" is never a guarantee. If you ever need one, you are describing a durable notification,
  which is the other publisher path.

## Apply this even without MMCA

The idea ports to any real-time stack:

1. **Split on the delivery contract, not the transport.** "Must survive an offline user" and "only matters
   on screen" are different guarantees. Give each its own publisher abstraction and let one connection
   carry both, rather than standing up a second hub.
2. **Attach the broadcast where post-commit is structural, not where it reads well.** The durable write is
   the truth; the broadcast is an optimization over it. If your framework already defers domain-event
   dispatch until after the transaction commits, hang the broadcast off the event rather than writing it
   inline in the command handler, where a later rollback can leave clients told about state that never
   landed. Then hand it to a background drain (or at least wrap and swallow), log the failure, move on.
3. **Serialize once, at the edge, and keep the payload opaque across hops.** A pre-serialized string makes
   a cross-service relay trivial: no hop in the middle needs the payload type.
4. **Validate client-supplied group names against a pattern.** The moment a client can name the group it
   joins, an unconstrained join is a subscription to anyone's data. A configurable regex closes it without
   hardcoding your channel vocabulary.
5. **If a queue cannot meaningfully reject, do not give it a return value to ignore.** An evict-on-full
   queue accepts every write by design, so a caller's "if the enqueue failed, log it" branch is dead code
   and every drop is invisible. Deleting the branch is the small fix. The honest one is to take the return
   value off the method, so the next caller cannot write the branch again. Then count and log the drop
   where the eviction actually happens, and carry a running total so a drain falling behind shows up in
   logs rather than in confused users.
6. **Ask who owns the work before you pick the mechanism.** Work a request started and can afford to
   lose belongs on an in-process queue. Work a request started and cannot afford to lose belongs in a
   row, because an in-memory queue is only as durable as the replica holding it. Work a clock owns and
   a restart must not skip belongs in a row too, with a claim lease so three replicas do not run it
   three times. If you already have a durable polling loop (an outbox, usually), the gap between it and
   a scheduler is a cron parser, not a scheduling product.

The takeaway: real-time features do not need a second WebSocket, they need a second contract. Decide
durable-versus-ephemeral at the publisher boundary and one hub carries both.

---

**What we covered:** why the durable notification pipeline is the wrong shape for high-frequency live
updates, how ADR-039 keeps one SignalR hub and splits durable from ephemeral at the `ILiveChannelPublisher`
boundary (with a no-op default, a SignalR group-send implementation, and channel join/leave with validated
keys), why the hot-path enqueue belongs on a post-commit domain-event handler rather than inline in the
command, how an evict-on-full queue has to report its own drops, how a remote module enqueues into the
hub's channels through a best-effort, off-request-path gRPC ingress on the ADR-012 mixed-endpoint profile,
why an ephemeral event must be treated as a hint over fetchable state, and how the sibling contract for
clock-owned work (ADR-074) gets durable, multi-replica-safe cron out of the outbox's claim lease plus a
cron parser, with no scheduling product.

**Next in the series:** explicit, compile-time DTO mapping that retires reflection-based AutoMapper and
keeps a bad request a 400, not a 500.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-039 behind this
pattern, or `dotnet add package MMCA.Common.Infrastructure` and try it.*
- ⭐ Repo: https://github.com/ivanball/MMCA.Common
- 📚 Full series index: https://ivanball.github.io/writing.html
- 📄 ADR-039 (live channel push): `Website/docs-src/adr/039-live-channel-push.md` in the docs site.

*Tags: .NET, C Sharp, SignalR, Real Time, Software Architecture*

*Notes: 2026-09-19 audit pass (MMCA.Common v1.205.0). Three substantive changes this pass. (1) The
"expensive work" worked example was re-based: `SessionScoringQueue.cs` and `SessionScoringWorkItem` no
longer exist anywhere in `MMCA.ADC/Source` (Grep for both, zero matches), because that case is a durable
internal command, `ScoreEventSessionsInternalCommand` (ADR-114), whose own remarks state it "replaces an
in-process channel plus a five-minute recovery sweep ... A row in the database survives all three, and
the framework owns the claim lease, the retry backoff and the dead-letter"
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsInternalCommand.cs:14-18`,
record `:26`, name attribute `:25`); its handler takes the per-event claim with a zero wait and skips
rather than waits on the loser (`ScoreEventSessionsInternalCommandHandler.cs:60` `ClaimWait =
TimeSpan.Zero` with the "waiting for it would only mean paying for the same pass twice" rationale
`:56-59`, `TryAcquireAsync` `:75-77`, skip branch `:79-83`, `ClaimTimeToLive` 15 minutes `:53`). The body
now states that mechanism in two sentences and cross-references Article 51 for it; ADR-052's own text
still names the deleted `SessionScoringQueue`/`SessionScoringProcessor` as its example
(`Website/docs-src/adr/052-background-job-execution.md:83`), which is a repo-side follow-up for
`/update-adrs`, not article drift. The live-publish queue is the only `Channel.CreateBounded` call in
MMCA.Common and both consumer applications (Grep for `CreateBounded`/`BoundedChannelOptions`:
`MMCA.Common/Source` zero, `MMCA.Store/Source` zero, `MMCA.ADC/Source` one file), which is what the body
claims. (2) MMCA.Common's notification files moved into `Notifications/`, `Notifications/Live/`,
`Notifications/Push/` and `Interfaces/Infrastructure/Notifications/` in a folder-width reorganization;
every framework anchor below is re-pinned to those paths. (3) `NotificationHub` carries an
`IChannelJoinAuthorizer` entitlement hook and a per-user connection cap that the article did not
describe, both now in the body. Carried forward from the 2026-08-20 pass and unchanged on the merits:
every best-effort swallow on the Engagement live path runs through MMCA.Common's shared
`BestEffort.ExecuteAsync` helper instead of a hand-rolled `catch` with a justified `CA1031` suppression.
`LivePollVoteChangedHandler`, `SessionQuestionUpvoteChangedHandler`, `SubmitQuestionHandler`,
`ModerateQuestionHandler` and the drain worker `LiveChannelPublishProcessor` carry no `CA1031`
suppression and no per-file failure `LoggerMessage` any more; the helper emits one Warning
("Best-effort operation '{Operation}' failed and was swallowed; the caller's outcome is unaffected")
and increments `besteffort.dispatch.failed`, tagged by a low-cardinality `operation` name, on the
`MMCA.Common.BestEffort` meter, and rethrows the caller's own cancellation rather than recording it as a
failure (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/BestEffort.cs:45-72`, meter/tag
contract `:18-23`, Warning `:81-84`). The body paragraph that used to say "the two that still keep a
`try`/`catch`" was rewritten for that, and every affected anchor below is re-pinned. The section
"The sibling contract: work a clock owns" is unchanged on the merits; the previous note's withdrawal of
the onboarding-chapter drift finding is now only half right and is restated below.
The section "The queue is where you say what the work is worth" carries ADR-052's
background-job execution contract, which has no other home article. Its one code block is line-for-line
from source with the declarations pulled adjacent: the file does not have them contiguous, and the doc
comments are dropped. The `FullMode = BoundedChannelFullMode.Wait` plus non-blocking `TryWrite` pairing
described in prose beside it is the documented behaviour of `BoundedChannelFullMode` rather than a
quotation: no `Wait`-mode channel exists in MMCA.Common or either consumer application this pass, which
is why it is prose and not a second block.
The permissive end is `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Live/LiveChannelPublishQueue.cs`:
`Capacity = 1024` (`:18`), the `CreateBounded` call carrying `FullMode = BoundedChannelFullMode.DropOldest`,
`SingleReader = true`, `SingleWriter = false` and `itemDropped: OnItemDropped` (`:33-40`), the
always-true `TryWrite` documented at `:49-59`, and the `itemDropped` callback as the
only observable drop signal (`:30-32`) feeding the discarded-broadcast counter (`:47`) and the
running-total warning (`:61-70`), plus the class's own "the request path must never block" and
`SingleReader`-gives-FIFO rationale (`:6-13`) and the capacity comment sizing 1024 against the observed
conference-day load (`:16-17`). Framework (MMCA.Common):
`ILiveChannelPublisher.PublishAsync(channelKey, eventName, payloadJson, ct)`
(`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/ILiveChannelPublisher.cs:17`,
with the "not persisted, clients not connected at publish time never see them" contract stated `:3-8`);
`NullLiveChannelPublisher` no-op default (`Source/Core/MMCA.Common.Infrastructure/Notifications/Live/NullLiveChannelPublisher.cs:11-16`);
`SignalRLiveChannelPublisher` group-sends `ReceiveChannelEvent` via `IHubContext<NotificationHub>`
(`Source/Core/MMCA.Common.Infrastructure/Notifications/Live/SignalRLiveChannelPublisher.cs:11-19`, nine lines).
`NotificationHub`
declares the four method-name constants `ReceiveNotificationMethod`/`ReceiveChannelEventMethod`/`JoinChannelMethod`/`LeaveChannelMethod`
(`Source/Core/MMCA.Common.Infrastructure/Notifications/NotificationHub.cs:30,33,36,39`), `JoinChannelAsync`/`LeaveChannelAsync`
(`:119,:136`), which both call the private `EnsureValidChannelKey` (`:166`), validating the key against
`ChannelKeyPattern` and throwing `HubException` on a miss (`:174`), with the regex cached and a 1s match
timeout (`:41-44`). The entitlement hook is the optional, defaulted `IChannelJoinAuthorizer` constructor
parameter (`:27`, whose doc states the shape pattern alone lets any authenticated caller subscribe to any
well-formed key, `:18-23`), consulted by `EnsureAuthorizedForChannelAsync` (`:149-164`, refusal
`HubException` `:162`, the "shape is not entitlement" comment `:145-148`) after the pattern check and
before `Groups.AddToGroupAsync` (`:126-127`). The per-user connection cap is `ConnectionsPerUser`
(`:46-51`, "per replica, like the in-memory rate limiters") enforced in `OnConnectedAsync` (`:54-72`, cap
read `:56`, over-cap `HubException` `:67`, the give-the-slot-straight-back comment `:64-66`).
`PushNotificationSettings.ChannelKeyPattern` defaults to `NotificationScopeKey.Pattern`
(`Source/Core/MMCA.Common.Infrastructure/Notifications/Push/PushNotificationSettings.cs:29`), which is
`^(event|session):[0-9]+$` (`Source/Core/MMCA.Common.Shared/Notifications/NotificationScopeKey.cs:32`);
`MaxConnectionsPerUser` defaults to 20 (`PushNotificationSettings.cs:42`).
DI: `NullLiveChannelPublisher` is the `TryAddTransient` default (`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:736`);
`AddPushNotifications` (declared `:820`) swaps in `SignalRLiveChannelPublisher` (`:845`) and wires the Redis
backplane when a `redis` connection string is present (`:829-841`, with the SEC-Common-53 per-application
channel prefix `:832-841`). UI `NotificationHubService`: `JoinChannelAsync`/`LeaveChannelAsync`
track membership (`Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:192,225`),
`OnChannelEvent` is multicast (`:255-273`, the per-channel subscription list `:260-269`), re-join on
`Reconnected` (`:143`, `RejoinChannelsAsync` at `:348`), single-subscriber
`NotificationCallback` (`:51`). ADR: one hub + two publisher paths, durable-vs-ephemeral at the publisher boundary, string-JSON
payload, ephemeral-is-lossy, single-subscriber callback, backplane-for-multi-replica trade-offs all in
`Website/docs-src/adr/039-live-channel-push.md:22-73`. `Outbox:ProcessingDelaySeconds` is named (with ADR-003)
at ADR-039 `:14-15`, which states no value; the 5s default is `Source/Core/MMCA.Common.Infrastructure/Settings/OutboxSettings.cs:40`
(also in `MMCA.Common/CLAUDE.md` "Outbox Pattern"). ADR-039 carries a **Revision (2026-07-24)** (`:75-96`):
(1) the `CastVoteHandler`/`ToggleUpvoteHandler` broadcasts moved to domain-event handlers because the
in-handler enqueue ran with the ADR-014 transaction still open (`:78-89`), and (2) `DropOldest` makes
`TryWrite` always return true, so the caller's "if the enqueue failed, log it" branch was unreachable and
drops now surface via `itemDropped`/`DroppedCount` plus a running-total warning (`:91-96`).
ADC adoption (Engagement live path, anchors from the 2026-08-20 pass, not re-read this pass and not
flagged by this pass's audit): the queue port returns nothing, no command handler publishes inline, and
the failure posture is the shared `BestEffort` helper described at the top of these notes. The port is
`void Enqueue(LiveChannelPublishWorkItem workItem)`
(`.../Engagement.Application/Live/ILiveChannelPublishQueue.cs:30`; interface `:21`, work-item record `:10`),
whose doc states the queue never rejects an item and "there is nothing for a caller to
branch on" (`:24-26`). Only the private `_channel.Writer.TryWrite` is always-true
(`.../Live/LiveChannelPublishQueue.cs:55-59`, remarks `:49-54`; class `:14`). No `TryEnqueue` remains on
this port.
`CastVoteHandler`'s primary constructor
is `(IUnitOfWork, LivePollResultsBuilder, TimeProvider, ILogger)` with **no queue and no publisher**
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteHandler.cs:19-23`);
it saves at `:86` and its comment at `:90-92` states the `poll.results-changed` broadcast is raised as a
domain event and enqueued post-commit by `LivePollVoteChangedHandler`; the file is 126 lines and enqueues
nothing. `LivePollVoteChangedHandler` (`.../LivePolls/DomainEventHandlers/LivePollVoteChangedHandler.cs:38`)
is a singleton whose whole body is one `BestEffort.ExecuteAsync(BroadcastOperation, logger, ...)` call
(`:51`, operation constant `"livepoll-results-broadcast"` `:44`, the "rather than a hand-rolled catch"
rationale `:26-29`); inside it, it opens its own scope (`:53-55`), rebuilds results with `userId: null` so
`MyVoteOptionId` stays null (`:73`), resolves the channel key (`:75-77`), and calls
`Enqueue(new LiveChannelPublishWorkItem(...))` with `JsonSerializer.Serialize(results, JsonSerializerOptions.Web)`
(`:79-82`). The upvote path mirrors it in `SessionQuestionUpvoteChangedHandler` (`.../SessionQuestions/DomainEventHandlers/SessionQuestionUpvoteChangedHandler.cs:39`,
`BestEffort.ExecuteAsync` `:52` with operation constant `"session-question-upvote-broadcast"` `:45` and the
same rationale `:27-30`, enqueue `:80-83`). Neither file contains a `CA1031` suppression or a failure
`LoggerMessage` any more. All four lower-frequency command handlers enqueue as well, which is
what closes the gap this article previously recorded as deliberate. `CloseLivePollHandler` injects
`ILiveChannelPublishQueue` (`.../UseCases/Close/CloseLivePollHandler.cs:22`) and its `EnqueueClosed`
(`:85-97`) ends in a plain `Enqueue` (`:95-96`) with no reject branch: the file is 101 lines and its only
`LoggerMessage` is the Information "Live poll {PollId} closed for Event {EventId}" (`:99-100`).
`OpenLivePollHandler` injects the queue (`.../UseCases/Open/OpenLivePollHandler.cs:23`) and `EnqueueOpened`
(`:100-112`) enqueues at `:110-111`, with no `PublishAsync` and no CA1031 suppression anywhere in its 116
lines. `SubmitQuestionHandler` injects the queue (`.../SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:29`)
and enqueues on both branches (`:142-143` approved, `:157-158` pending-count); its guard is
`BestEffort.ExecuteAsync` (`:131`, rationale `:120-127`, which also records why the caller's token is
deliberately not passed: the question is already committed, so the broadcast must outlive an abandoned
request), and what it covers is the fresh Pending-count read (`:148-151`), not a publish.
`ModerateQuestionHandler` injects the queue (`.../SessionQuestions/UseCases/Moderate/ModerateQuestionHandler.cs:26`)
and enqueues at `:138` and `:152-153`, with `BestEffort.ExecuteAsync` at `:136` (rationale `:96-101`)
around the same shape (count read `:143-146`); the payload switch is built deliberately OUTSIDE the guard
so an unknown `ModerationAction` faults loudly instead of being swallowed as a missed broadcast
(`:111-134`). Neither file carries a CA1031 suppression.
Engagement's own composition root states the rule in a comment: no command handler awaits that publish,
each enqueues onto the module's `ILiveChannelPublishQueue` instead
(`.../Engagement.Service/Program.cs:239-241`).
Single-reader hosted drain
`LiveChannelPublishProcessor` (`.../Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:30-33`)
resolves the publisher per item and forwards in FIFO order, swallowing every failure through
`BestEffort.ExecuteAsync` (`ExecuteAsync` `:39-67`, the helper call `:45-58` with the per-item scope
resolving `ILiveChannelPublisher` at `:50-51`, operation-name prefix `"live-channel-publish:"` completed
by the work item's event name `:36`, the "rather than a hand-rolled catch, so a peer that has quietly
stopped accepting broadcasts is countable" rationale `:21-28`, and a shutdown-only
`catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)` at `:60-65`); there is
no CA1031 suppression and no `LoggerMessage` in the file. Registered
`AddHostedService` (`.../Engagement.Infrastructure/DependencyInjection.cs:21`), queue registered as one
concrete singleton exposed via the interface (`.../Engagement.Application/DependencyInjection.cs:55-56`,
rationale comment `:51-54`);
`LivePollChannel` keys/event-names (`.../Engagement.Shared/LivePolls/LivePollChannel.cs:14,17,20,24,29`).
gRPC ingress: `LiveChannelPublisherGrpcAdapter` implements `ILiveChannelPublisher` over gRPC, 2s deadline,
swallows failures (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/LiveChannelPublisherGrpcAdapter.cs:20-53`,
`:26` deadline, `:43-48` CA1031), invoked by Engagement's drain worker off the request path;
`AddNotificationLiveChannelClient` `Replace`s the port with the adapter,
default service name `_grpc.notification` (`.../Notification.Contracts/DependencyInjection.cs:42-51`),
registered by Engagement at `.../Engagement.Service/Program.cs:283`;
`LiveChannelGrpcService` delegates to the host's `ILiveChannelPublisher` (SignalR here)
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/LiveChannelGrpcService.cs:22`, delegation
`:33-35`); mixed-endpoint
profile (default `Http1AndHttp2` for WebSockets + dedicated `Http2`-only `grpc` endpoint) at
`.../Notification.Service/Program.cs:56-70` (SignalR hub mapped `:275`).
Standing of the onboarding chapter
`Website/docs-src/onboarding/group-23-engagement-live-layer.md`, as recorded in the 2026-08-20 pass and
carried forward unchanged. Half of that withdrawal holds: the chapter does NOT teach the retired
`TryEnqueue` shape (Grep for `TryEnqueue` in that file, zero matches) and it correctly describes all four
lower-frequency command handlers enqueueing through `ILiveChannelPublishQueue.Enqueue` with no rejection
branch (`:102-114`). The other half no longer holds. The chapter still tells the pre-`BestEffort` story:
it says both domain-event handlers "swallow-and-log any failure behind a justified `CA1031` suppression"
(`:98-100`) and that the two question handlers "still wrap that block in a `CA1031`-suppressed
swallow-and-log catch (`SubmitQuestionHandler.cs:149-154`, `ModerateQuestionHandler.cs:143-148`)"
(`:115-118`). All four route through `BestEffort.ExecuteAsync` today and none carries a CA1031
suppression, and the chapter's line anchors for those handlers are stale in exactly the same way this
article's were before this pass. That is a repo-side follow-up for `/update-onboarding` in the Website
repo, not article drift: the article's own text is re-pinned above.
Recurring job scheduler (the section "The sibling contract: work a clock owns"), grounded in
`Website/docs-src/adr/074-recurring-job-scheduler.md` (status line "Accepted (2026-08-13; revised
2026-08-14, 2026-08-18)", `:4-6`;
opt-in, no table and no runner until a host calls `AddScheduledJobs` and sets `Scheduler:Enabled`) plus
MMCA.Common source. The two rejected instincts are the ADR's own Context and Decision: an interval is not
a time of day and an interval-driven hosted service runs on every replica (`:17-20`), and Hangfire /
Quartz.NET are declined for the schema, storage abstraction, dashboard and per-host upgrade obligation
they bring (`:37-42`), the conclusion being that "the missing piece was a cron expression, not a
product" (`:42`). The contract is
`IScheduledJob` with exactly `Name`, `CronExpression` and `ExecuteAsync(CancellationToken)`
(`Source/Core/MMCA.Common.Application/Interfaces/IScheduledJob.cs:36`, members `:44`, `:68`, `:78`), whose
own doc states jobs are resolved **scoped, in a fresh DI scope created for each execution, exactly like a
request** (`:9-14`), that the cron is five-field and UTC-only (`:47-49`, `:57-62`), and that
`Scheduler:Jobs:{Name}:Cron` overrides the code default (`:63-66`). The scope is real:
`InvokeJobAsync` opens `scopeFactory.CreateScope()` per run and resolves the job out of it
(`Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:523-525`); the runner itself is
a `BackgroundService` (`:39-44`) taking `TimeProvider` (`:47`). The claim quoted in the code block is
verbatim from `:427-437` (`ExecuteUpdateAsync` setting `LockedUntil` + `LockToken` over a `Where` that
admits only rows whose `NextRunOn` has passed and whose lease is null or expired), the same idiom the
outbox uses (ADR-074 `:30-35`); the due-row read is `:409-416`, and the outcome stamp is guarded by the
same token so a replica whose lease expired mid-run matches nothing and drops its stale result
(`:489-503`). Smart wait: `RunCycleAsync` returns the earliest `NextRunOn` across the store (`:222-227`)
and `ComputeWaitTime` sleeps until it, capped at the polling interval and floored at one second
(`:138-152`, `MinimumWait` `:72`); `SchedulerSettings.PollingIntervalSeconds` defaults to 30 and
`LeaseSeconds` to 300 (`Source/Core/MMCA.Common.Infrastructure/Settings/SchedulerSettings.cs:34`, `:43`).
Missed schedules: the next occurrence is computed from the instant the run finished, not from the missed
occurrence, "so a schedule that elapsed many times while the host was down advances past the present in
one step instead of replaying the backlog" (`ScheduledJobRunner.cs:476-480`); the artifact-per-window and
time-lease-not-a-fence costs are the ADR's own Trade-offs ("Run-once-then-advance silently drops
occurrences ... wrong for a job that must produce an artifact per window",
`074-recurring-job-scheduler.md:177-180`; "The lease is a time lease, not a fence", `:164-167`). Cronos is the bought piece: pinned in `MMCA.Common/Directory.Packages.props:71` (0.13.0) and
called through `CronSchedule.Parse(...).GetNextOccurrence(afterUtc, inclusive: false)`
(`ScheduledJobRunner.cs:187`, alias `:12`). The store is `ScheduledJobEntry` with `JobName` as the primary
key (`Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobEntry.cs:20`, `:26`) plus
`CronExpression` (`:34`), `NextRunOn` (`:40`), `LastRunOn` (`:43`), `LastOutcome` (`:50`),
`LastDurationMs` (`:60`), `LockedUntil` (`:67`) and `LockToken` (`:74`), host-scoped to the **Default**
source only, unlike the per-source outbox (`:16-17`, and ADR-074 `:67-71`). The opt-in claim is a test,
not a promise: `Model_SchedulerDisabled_DoesNotContainTheJobTable` asserts the real
`ApplicationDbContext` model has no `ScheduledJobEntry` entity type for a host that never opted in
(`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerModelGateTests.cs:29-35`;
siblings cover no-settings-at-all `:38-45`, enabled-on-Default `:48-56`, and enabled-on-a-non-Default
source `:59-65`). Adoption verified this pass by grep for `AddScheduledJobs`: all three Store services
(`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:229`,
`.../MMCA.Store.Sales.Service/Program.cs:209`, `.../MMCA.Store.Identity.Service/Program.cs:196`), three
ADC services (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:235`,
`.../MMCA.ADC.Engagement.Service/Program.cs:194`, `.../MMCA.ADC.Conference.Service/Program.cs:329`) and
the Helpdesk web host (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:91`). The Engagement
observation in the article is that same file: `AddScheduledJobs` at `:194`, earlier than
`AddNotificationLiveChannelClient()` at `:283`.
Illustrative-of-documented-shape: the scheduler code block pairs the three `IScheduledJob` member
signatures (verbatim from `IScheduledJob.cs:44`, `:68`, `:78`, with the surrounding XML docs replaced by
short inline comments) with the verbatim claim statement from `ScheduledJobRunner.cs:427-437`; the two are
adjacent in neither file. The live-channel code block is a condensed reconstruction of two real files,
`CastVoteHandler.cs:86-95` (commit, build results for the caller, return) and
`LivePollVoteChangedHandler.cs:73-82` (post-commit rebuild with `userId: null`, channel key, `Enqueue`);
it mirrors the real `SaveChangesAsync`, `resultsBuilder.BuildAsync`, `LivePollChannel.ForSession/ForEvent`
and `Enqueue(new LiveChannelPublishWorkItem(...))` shapes but simplifies names, elides the scope creation
and the enclosing `BestEffort.ExecuteAsync` call, and drops the surrounding vote-resolution branches for
readability.*
