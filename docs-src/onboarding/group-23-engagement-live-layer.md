# 23. ADC Engagement Live Layer (Real-Time Polls & Session Q&A)

**What this chapter covers.** This is the conference-day layer of the Engagement bounded context:
the features that only matter while an event is actually happening in the room. There are two of
them, and they share one shape. **Live polls**, [`LivePoll`](#livepoll)
(`MMCA.ADC.Engagement.Domain/LivePolls/LivePoll.cs:18`), let an organizer or a session's speaker
open a multiple-choice question for the audience, collect votes in real time, and project a running
tally. **Session Q&A**, [`SessionQuestion`](#sessionquestion)
(`MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestion.cs:19`), lets attendees submit
questions to a live session, upvote each other's, and lets a moderator approve, dismiss, or
mark-answered from a queue. Three Blazor surfaces read them: the event-wide
[`HappeningNow`](#happeningnow) board
(`MMCA.ADC.Engagement.UI/Pages/HappeningNow/HappeningNow.razor.cs:23`), the routed per-session
[`SessionLive`](#sessionlive) page (`.../Pages/SessionLive/SessionLive.razor.cs:26`), and the
speaker-facing [`PresenterView`](#presenterview) (`.../Pages/SessionLive/PresenterView.razor.cs:19`).
What makes the layer distinct from the rest of Engagement (the bookmarks and points of
[Group 22](group-22-engagement-module.md)) is that state changes must fan out to every open page
while the room is still looking at the screen, so the whole chapter is really about one transport
decision: how a vote cast on one phone lights up the tally on two hundred others.

That transport is the SignalR **hub-channel** push introduced by
**[ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)**, and it is
deliberately the *opposite* of the durable notification pipeline
([ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html)) that the same hub also
carries. A durable notification writes a per-user inbox row and is worth finding minutes later; a
live tally is broadcast to whoever is looking right now and is worthless a second later, so it is
never persisted and carries no delivery guarantee. Everything in this chapter treats a channel event
as a **cache-invalidation hint over fetchable state**, not as the state itself: if a client connects
late and misses an event, its next fetch still shows the truth. That single design rule explains
most of the code you will read here.

## The two aggregates and their invariants

Both aggregates are sealed
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
subclasses that follow the framework's factory-plus-[`Result`](group-01-result-error-handling.md#result)
discipline (primer §2). `LivePoll` holds an `EventId`, an optional `SessionId` (null for an
event-wide poll, BR-230, `LivePoll.cs:24`), a question, its authored
[`LivePollOption`](#livepolloption) children, and a strict lifecycle `Status`
([`LivePollStatus`](#livepollstatus)): Draft to Open to Closed, no reopen (BR-221, guarded at
`LivePoll.cs:110-117` and `:143-150`). Its `Create` factory (`LivePoll.cs:64`) combines four checks
from [`LivePollInvariants`](#livepollinvariants) (`.../LivePolls/LivePollInvariants.cs:10`), and
`Open` / `Close` / `Delete` each guard their transition: an open poll cannot be deleted (BR-228,
`LivePoll.cs:210-219`), and a successful delete cascades a soft-delete over the options before
raising the event (`LivePoll.cs:223-228`). `SessionQuestion` holds a `SessionId`, a denormalized
`EventId` (deliberately *not* validated, since the disabled-stub extension point can report a
default, `SessionQuestion.cs:24`, `:64-67`), the submitter's `UserId` (never exposed on a DTO,
BR-238, `:27-28`), the text, a [`QuestionStatus`](#questionstatus)
(`Pending`/`Approved`/`Dismissed`), and an `IsAnswered` flag; `Approve` (`SessionQuestion.cs:121`),
`Dismiss` (`:145`), and `MarkAnswered` (`:168`) are the moderation transitions (BR-234), each
rejecting the no-op repeat, and `Create` refuses any initial status other than Pending or Approved
(`SessionQuestion.cs:92-99`).

The size limits themselves are worth a look, because they are declared **once, in the lowest layer
every consumer can reach**. `LivePollInvariants.QuestionMaxLength` is an alias for
[`LivePollDTO`](#livepolldto)`.QuestionMaxLength` (`LivePollInvariants.cs:13`), and the number, 200,
lives on the Shared DTO (`MMCA.ADC.Engagement.Shared/LivePolls/LivePollDTO.cs:16`) alongside
`MinOptions` = 2 (`:22`) and `MaxOptions` = 10 (`:28`); option text caps at 100 on
[`LivePollOptionDTO`](#livepolloptiondto) (`.../LivePolls/LivePollOptionDTO.cs:14`), and question
text at 500 on [`SessionQuestionDTO`](#sessionquestiondto)
(`.../SessionQuestions/SessionQuestionDTO.cs:18`, aliased by
[`SessionQuestionInvariants`](#sessionquestioninvariants) at
`.../SessionQuestions/SessionQuestionInvariants.cs:13`). The domain enforces the rule, the UI caps
its input, and EF sizes the column
(`MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePollConfiguration.cs:29`)
from the same constant, so the three can never drift apart. Option-text uniqueness is compared
case-insensitively (`LivePollInvariants.cs:57-64`).

The one design idea worth internalizing early is the **live-window snapshot**. When a poll is opened
(`LivePoll.Open`, `LivePoll.cs:108`, stamping `LiveWindowEndUtc` at `:129`) or a question is
submitted (`SessionQuestion.Create`, `:77`, taking the window end as a parameter at `:83`), the
event's live-window end is copied *onto* the aggregate. From then on the aggregate answers "is this
vote still allowed?" (`CanAcceptVote`, `LivePoll.cs:167`) or "is this upvote still allowed?"
(`CanAcceptUpvote`, `SessionQuestion.cs:201`) against its own snapshotted field, with **no
cross-service call per vote** (BR-224/BR-237). That matters because votes and upvotes are the
high-frequency operations; paying a gRPC hop on each one would not scale. And like the bookmark
aggregate, both use a **single** domain event carrying a
[`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) discriminator,
[`LivePollChanged`](#livepollchanged) and [`SessionQuestionChanged`](#sessionquestionchanged) (BR-60,
raised at `LivePoll.cs:94`, `:131`, `:154`, `:228`), rather than separate per-transition events.
Those domain events are durable [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent)s
captured by the outbox
([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).

A vote and an upvote are themselves small aggregates, [`LivePollVote`](#livepollvote) and
[`SessionQuestionUpvote`](#sessionquestionupvote), each with a "one active row per (poll/question,
user)" rule enforced by a filtered unique index
(`.../EntityConfiguration/LivePollVoteConfiguration.cs:34-37`) and the same
reactivate-instead-of-reinsert dance (BR-225/BR-135) the bookmark module uses:
[`CastVoteHandler`](#castvotehandler) reads active and soft-deleted rows in one call, then updates a
live vote, revives a deleted one, or inserts a new one
(`MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteHandler.cs:52-78`), so a user
who changes their mind never piles up tombstones. [`ToggleUpvoteHandler`](#toggleupvotehandler) does
the mirror image and additionally refuses to let an author upvote their own question (BR-235,
`.../SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteHandler.cs:40-48`). Both tables are indexed
for the way they are actually read: the vote table carries a second `(LivePollId, OptionId)` index
for the grouped tally (`LivePollVoteConfiguration.cs:40`).

## The write path, and where the realtime broadcast actually happens

Each operation is a vertical slice under `Application/{LivePolls|SessionQuestions}/UseCases/{Op}/`.
The three lifecycle commands do not hand-roll their load-mutate-save sequence at all: they derive
from the framework's
[`MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#mutateentityhandlerbasetcommand-tentity-tidentifiertype)
and fill in four template hooks, `EntityId`, `RowVersion`, `MutateAsync`, and the post-save
`OnMutatedAsync` ([`OpenLivePollHandler`](#openlivepollhandler)
(`.../UseCases/Open/OpenLivePollHandler.cs:26-35`, `:38-76`, `:83-91`),
[`CloseLivePollHandler`](#closelivepollhandler) (`.../UseCases/Close/CloseLivePollHandler.cs:24-33`,
`:36-61`, `:68-76`), and [`ModerateQuestionHandler`](#moderatequestionhandler)
(`.../UseCases/Moderate/ModerateQuestionHandler.cs:28`, `:41-48`, `:51-78`, `:85-89`)). That base is
also where the ADR-035 concurrency token is applied: each handler's `RowVersion` override hands back
the token the caller stated, so a transition decided against a stale view fails the save
(`OpenLivePollHandler.cs:35`, `CloseLivePollHandler.cs:33`, `ModerateQuestionHandler.cs:48`). What
differs between slices, and what is worth studying, is how the **ephemeral broadcast** leaves the
process. There are three shapes in the code today, and the differences are deliberate.

The **hot paths raise a domain event and broadcast from the handler for it.** Casting a vote
(`CastVoteHandler.cs:19`) and toggling an upvote (`ToggleUpvoteHandler.cs:17`) publish nothing
themselves. The vote and upvote aggregates raise [`LivePollVoteChanged`](#livepollvotechanged) and
[`SessionQuestionUpvoteChanged`](#sessionquestionupvotechanged), and the matching domain-event
handlers, [`LivePollVoteChangedHandler`](#livepollvotechangedhandler)
(`.../LivePolls/DomainEventHandlers/LivePollVoteChangedHandler.cs:38`) and
[`SessionQuestionUpvoteChangedHandler`](#sessionquestionupvotechangedhandler)
(`.../SessionQuestions/DomainEventHandlers/SessionQuestionUpvoteChangedHandler.cs:39`), rebuild the
fresh tally and hand a
[`LiveChannelPublishWorkItem`](group-22-engagement-module.md#livechannelpublishworkitem) to
[`ILiveChannelPublishQueue`](group-22-engagement-module.md#ilivechannelpublishqueue)
(`LivePollVoteChangedHandler.cs:79-82`, `SessionQuestionUpvoteChangedHandler.cs:80-83`). Both
in-code rationales are worth reading (`LivePollVoteChangedHandler.cs:18-24`,
`SessionQuestionUpvoteChangedHandler.cs:18-25`): domain-event dispatch inside a transactional
command is deferred until after the commit and dropped on rollback, so clients are never told about
a vote that never persisted, and the request never awaits a gRPC publish, so a hung Notification
peer cannot add its latency to every upvote. Both handlers are singletons that open their own DI
scope (`LivePollVoteChangedHandler.cs:53`, `SessionQuestionUpvoteChangedHandler.cs:54`), and neither
hand-rolls a catch: the whole body runs inside
[`BestEffort`](group-03-querying-specifications.md#besteffort)`.ExecuteAsync`
(`LivePollVoteChangedHandler.cs:51`, `SessionQuestionUpvoteChangedHandler.cs:52`), the framework
helper that turns a failed side effect into exactly one Warning plus one increment of
`besteffort.dispatch.failed` while still rethrowing the caller's own cancellation. A broadcast path
that has quietly stopped working is therefore countable, not just loggable.

The two poll-lifecycle handlers show the same queue used **directly** from `OnMutatedAsync`:
`CloseLivePollHandler.EnqueueClosed` picks the session or event channel key, serializes a
[`LivePollClosedPayload`](#livepollclosedpayload), and calls `Enqueue`
(`CloseLivePollHandler.cs:84-96`) with no guard at all, because `Enqueue` cannot fail and the queue
never refuses an item (`.../Live/ILiveChannelPublishQueue.cs:23-30`); the only log left on that path
is the Information "live poll closed" line the base emits through `LogMutated`
(`CloseLivePollHandler.cs:64-65`, `:98-99`). `OpenLivePollHandler` is identical in shape
(`OpenLivePollHandler.cs:99-111`). The two question command handlers add the best-effort wrapper
back, because their enqueue block also *reads the database*:
[`SubmitQuestionHandler`](#submitquestionhandler)
(`.../UseCases/Submit/SubmitQuestionHandler.cs:130-160`) and `ModerateQuestionHandler`
(`ModerateQuestionHandler.cs:106-158`) resolve the session channel key, serialize a small payload
record to JSON, and enqueue, but their Pending branch first counts the session's pending questions
(`SubmitQuestionHandler.cs:148-151`, `ModerateQuestionHandler.cs:145-148`) and that read **must never
fail a command that has already committed**. Both route through `BestEffort.ExecuteAsync`
(`SubmitQuestionHandler.cs:131`, `ModerateQuestionHandler.cs:138`) and both deliberately withhold the
caller's cancellation token, so an abandoned request cannot turn a saved question into a cancelled
broadcast (`SubmitQuestionHandler.cs:119-128`, `ModerateQuestionHandler.cs:97-104`). One detail in
`ModerateQuestionHandler` is worth copying: the action-to-payload switch is built *outside* the guard
(`:118-136`) so an unknown moderation action faults loudly as an `ArgumentOutOfRangeException`
(`:135`) instead of being swallowed as a missed broadcast.
[`CreateLivePollHandler`](#createlivepollhandler) broadcasts nothing at all and takes no queue in its
constructor (`.../UseCases/Create/CreateLivePollHandler.cs:20-24`): a poll is created as Draft and
there is nothing for an audience to see yet. Channel keys come from the two contract classes shared
by publisher and subscriber, [`LivePollChannel`](#livepollchannel) (`ForEvent` gives `event:1`,
`ForSession` gives `session:123`, both delegating to Common's
[`NotificationScopeKey`](group-10-notifications.md#notificationscopekey),
`MMCA.ADC.Engagement.Shared/LivePolls/LivePollChannel.cs:24-30`) and
[`SessionQuestionChannel`](#sessionquestionchannel); questions reuse the session key, so a session's
polls and questions ride one channel
(`MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionChannel.cs:6-10`).

Two rules govern what is allowed on the channel. First, **broadcasts never carry per-user data**
(BR-229): the results broadcast is built with `userId: null` so `MyVoteOptionId` stays null
(`LivePollVoteChangedHandler.cs:71-73`), and the upvote broadcast carries only the fresh count
(`SessionQuestionUpvoteChangedHandler.cs:75-83`). Second, **pending question content is never
broadcast** (BR-238): full text rides the channel only on the approved payload
([`SessionQuestionApprovedPayload`](#sessionquestionapprovedpayload)), so when a pending question is
submitted or leaves the queue the channel carries a `question.pending-count-changed` count instead
and moderators see the badge move without unmoderated text leaking
(`SubmitQuestionHandler.cs:145-159`, `ModerateQuestionHandler.cs:142-156`).

Server-side guards round out the write path. The two hot paths cannot rely on a rowversion conflict,
because a vote only touches the `LivePollVote` row and never the poll row, so they add an explicit
TOCTOU re-check instead: the handler re-reads the aggregate immediately before saving and documents
the accepted millisecond residue (`CastVoteHandler.cs:80-82`, `:96-120`;
`ToggleUpvoteHandler.cs:75-77`, `:96-120`). Only the upvote-*on* path re-checks; clearing an upvote is
deliberately still allowed after a dismissal or after the window closes
(`ToggleUpvoteHandler.cs:71-78`). And question submission carries a spam cap: a user may hold at most
ten open (non-dismissed) questions per session (`SessionQuestionInvariants.cs:15-22`, enforced at
`SubmitQuestionHandler.cs:72-83`), so an auto-approving event default cannot be used to flood the
channel. Both the constant and its enforcement document themselves as a **soft** cap: the count and
the insert are not one atomic step, so concurrent submits from the same user can briefly exceed it
and moderation drains the overflow (`SessionQuestionInvariants.cs:15-21`,
`SubmitQuestionHandler.cs:66-71`).

## One WebSocket, one publisher port, and a cross-service ingress

The transport itself is framework-owned (ADR-039, [Group 10](group-10-notifications.md)). The single
[`NotificationHub`](group-10-notifications.md#notificationhub) carries both durable notifications and
channel events on one connection, and the application-layer port
[`ILiveChannelPublisher`](group-10-notifications.md#ilivechannelpublisher) keeps the handlers
transport-free. Which implementation resolves tells you the deployment topology, the same
"resolvable everywhere, active only where configured" convention as the rest of the framework:
[`SignalRLiveChannelPublisher`](group-10-notifications.md#signalrlivechannelpublisher) group-sends
over the hub in a host that maps it, and
[`NullLiveChannelPublisher`](group-10-notifications.md#nulllivechannelpublisher) is the no-op default.
In ADC the twist is that the Engagement service does **not** map the hub (the Notification service
does), so Engagement's composition root replaces the registration with a **gRPC adapter**,
[`LiveChannelPublisherGrpcAdapter`](group-10-notifications.md#livechannelpublishergrpcadapter), that
forwards the pre-serialized JSON payload to the Notification service's
[`LiveChannelGrpcService`](group-10-notifications.md#livechannelgrpcservice) ingress, which then does
the real group send. The host states that as one `.Register(...)` step in its application-pipeline
builder (`MMCA.ADC.Engagement.Service/Program.cs:282`, rationale at `:238-245`), and the extension
behind that line does a `Replace`, not a `TryAdd`, so the adapter beats the framework's Null default
(`MMCA.ADC.Notification.Contracts/DependencyInjection.cs:42-51`, the `Replace` itself at `:48`). This
is exactly the "a host that does not map the hub can replace the registration with its own
transport" extension point ADR-039 anticipates, and it rides the
[ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html) mixed-endpoint gRPC
profile (Notification serves a dedicated `Http2`-only endpoint for this ingress alongside its
WebSocket endpoint). Because the payload is an opaque string at every hop, no serializer dependency
crosses the wire.

The queue between the handlers and that adapter is the part to understand before you trust the
latency story. `LiveChannelPublishQueue` is a bounded `System.Threading.Channels` channel of capacity
1024 with `FullMode = DropOldest` and `SingleReader = true`
(`MMCA.ADC.Engagement.Application/Live/LiveChannelPublishQueue.cs:18`, `:33-40`): under sustained
backpressure the *freshest* broadcast wins, which is the right trade for ephemeral data, and every
discard is counted and logged as a Warning through the channel's `itemDropped` callback (`:40`,
`:61-70`), because `TryWrite` under `DropOldest` can never report the drop itself (`:30-32`). The
single reader is
[`LiveChannelPublishProcessor`](group-22-engagement-module.md#livechannelpublishprocessor)
(`MMCA.ADC.Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:30`), a `BackgroundService`
that resolves the scoped publisher per item (`:50-51`) and wraps each publish in `BestEffort` keyed
by the event name (`:45-46`), so a peer that stops accepting broadcasts is visible on the same meter;
a shutdown mid-publish stops the drain quietly (`:60-65`). FIFO through one reader is what preserves
per-session event ordering (`:13-14`).

On the browser side, [`NotificationHubService`](group-15-common-ui-framework.md#notificationhubservice)
(Common, [Group 15](group-15-common-ui-framework.md)) owns the one connection and exposes
`JoinChannelAsync` / `LeaveChannelAsync` / a **multicast** `OnChannelEvent` subscription, and it
re-joins every tracked channel on reconnect (SignalR group membership does not survive an automatic
reconnect). `SessionLive` and `HappeningNow` no longer talk to it directly: they hold a
[`LiveChannelSubscription`](group-22-engagement-module.md#livechannelsubscription) helper that owns
the join, the multicast handle, the already-joined flag, and the teardown as one disposable unit
(`SessionLive.razor.cs:56`, `:143`, `:329`; `HappeningNow.razor.cs:51`, `:124-127`, `:276`).
`PresenterView` still wires the three calls by hand, which is the shape the other two grew out of
(`PresenterView.razor.cs:100-110`, teardown at `:181-185`). The join is deliberately **not**
`firstRender`-gated: the first render fires at the first `await` in `OnInitializedAsync` while the
session is still null, so a `firstRender`-only join never attached; the subscription's `IsJoined`
doubles as the already-joined guard, and the `RendererInfo.IsInteractive` check keeps the prerender
pass and the bUnit suite from dialing the hub (`SessionLive.razor.cs:132-137`, and the same reasoning
at `HappeningNow.razor.cs:109-113` and `PresenterView.razor.cs:100-102`). `SessionLive` and
`PresenterView` also skip their data loads entirely on the prerender pass, since the interactive
instance re-runs `OnInitializedAsync` and nothing here is cache-served for a logged-in user
(`SessionLive.razor.cs:67-73`, `PresenterView.razor.cs:55-57`); `HappeningNow` knowingly does not,
and says why in a NOTE at `HappeningNow.razor.cs:65-66`.

## The read path and how the UI reacts

Reads do not go through the generic entity-query machinery; the live views need shaped projections.
[`LivePollResultsBuilder`](#livepollresultsbuilder)
(`MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollResultsBuilder.cs:12`) computes tallies
for a *whole set* of polls in a fixed number of round trips: one grouped `COUNT` pushed into SQL over
every poll in the set (`:59-66`) plus, only when a caller is present, one set-wide read of that
caller's own votes (`:70-85`), which broadcast payloads skip entirely by passing `userId: null`. The
per-poll loop that shape replaced issued two queries per poll, so a session with a dozen open polls
cost two dozen round trips (`:33-38`). Votes cast on an option later removed are excluded so the
per-option numbers still add up to the total (`:95-107`, `:114-116`), and the poll's concurrency
token travels back on the results DTO so a surface fed only by tallies can still issue an open or
close (`:119-121`). [`SessionQuestionViewBuilder`](#sessionquestionviewbuilder)
(`.../SessionQuestions/Services/SessionQuestionViewBuilder.cs:12`) is its mirror for questions
(`:36-44`), adding per-caller `MyUpvote`/`IsMine` flags (`:48-58`). Those two feed the query handlers
behind `GET /livepolls/open`, `/livepolls/{id}/results`, `/sessionquestions`, and
`/sessionquestions/moderation`. [`GetOpenPollsHandler`](#getopenpollshandler) requires an explicit
event or session scope (`.../GetOpenPolls/GetOpenPollsHandler.cs:24-30`), excludes session-scoped
polls from the event-wide list (BR-230, `:41`), and then makes one batched build call for the whole
listing (`:45-50`). Both question reads are bounded server-side so a flooded session cannot produce
an unbounded payload, and the attendee read is the more interesting of the two:
[`GetSessionQuestionsHandler`](#getsessionquestionshandler) spends **two separate budgets**, 200
approved questions ranked by upvote count *in the database* before the cap applies (a correlated
`COUNT` subquery over the upvote table, since question and upvote are separate aggregates with no
navigation between them, `.../GetSessionQuestions/GetSessionQuestionsHandler.cs:32`, `:45-58`) plus
25 of the caller's own non-approved questions taken newest first (`:35`, `:60-69`), because one
shared budget filled by oldest id let a flood of low-value questions push both the most upvoted
question and the caller's own newest submission out of the payload (`:17-24`). The moderation read
caps at 200 and orders Pending first
(`.../GetModerationQueue/GetModerationQueueHandler.cs:26`, `:46-47`, `:53-54`).
[`LivePollNavigationPopulator`](#livepollnavigationpopulator) declares the poll's `Options` child
load for query-service paths EF cannot `.Include()`
([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html),
`.../LivePolls/Services/LivePollNavigationPopulator.cs:11-22`), the EF configurations
([`LivePollConfiguration`](#livepollconfiguration) and siblings) keep the Conference references as
scalar FK columns under database-per-service
([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html),
`.../EntityConfiguration/LivePollConfiguration.cs:11-15`) and index the conference-day hot filter
`(SessionId, Status)` (`:37-41`), and entity-to-DTO mapping is a compile-time Mapperly mapper,
[`LivePollDTOMapper`](#livepolldtomapper)
([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html),
`.../LivePolls/DTOs/LivePollDTOMapper.cs:12-14`).

When a channel event arrives, the page decides between **patch-in-place** and **reload**, and this is
the chapter's key performance lesson. The two high-frequency tally events (`poll.results-changed`,
`question.upvote-changed`) already carry the fresh counts in their payload, so the page patches its
in-memory model through the shared
[`LiveBroadcastPatch`](group-22-engagement-module.md#livebroadcastpatch) helper and calls
`StateHasChanged` with **no HTTP refetch** (`SessionLive.razor.cs:185-209`), preserving this
circuit's own vote marker across the patch because the broadcast strips per-user data
(`preserveMyVote: true`, `:190`), and falling back to a targeted reload when the payload cannot be
applied (`:203-206`). The comment there records why: reloading on every broadcast turned V voters
times C viewers into V times C authenticated refetches per hot poll, which collided with the per-user
rate limiter under burst voting (`SessionLive.razor.cs:148-152`). `PresenterView` calls the same
helper with `preserveMyVote: false`, because the projector surface has no vote of its own to keep
(`PresenterView.razor.cs:120`). Structural events (opened, closed, approved, answered, dismissed,
pending-count-changed) are rarer and *do* trigger a targeted reload of the affected list
(`SessionLive.razor.cs:158-177`), and every reload path funnels through one `RefreshAsync` that names
the lists it wants, stops at the first failure, and degrades a failed background refresh to a snackbar
rather than crashing the page (`:211-239`). `SessionLive` itself is the container that owns the
lists, the channel subscription, and the shared saving flag, while the three sections render through
the presentational [`SessionLivePollPanel`](#sessionlivepollpanel),
[`SessionLiveQuestionPanel`](#sessionlivequestionpanel), and
[`SessionLiveModerationPanel`](#sessionlivemoderationpanel) children (`SessionLive.razor.cs:20-24`).
The single session it renders is a point read through
[`ISessionLookupService`](#isessionlookupservice) rather than a full catalog fetch
(`SessionLive.razor.cs:86-88`, `PresenterView.razor.cs:66`, contract at
`MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:19`, `:30-35`). Whether the layer is even
active is decided by [`LiveEventService`](#liveeventservice)
(`MMCA.ADC.Engagement.UI/Services/LiveEventService.cs:14`): it fetches the current-or-next published
event through [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) and
computes its live window with the same math the backend enforces (`:27-46`), degrading to `null` on
an API failure (`:48-52`) so the live surfaces simply stay dormant rather than error; `HappeningNow`
joins the event channel only while `IsLiveAt` is true
(`MMCA.ADC.Engagement.UI/Services/LiveEventContext.cs:22-23`, `HappeningNow.razor.cs:118-121`). The
cross-module [`ISessionLiveUIService`](#isessionliveuiservice) /
[`SessionLiveUIService`](#sessionliveuiservice) contract is what lets a Conference session page light
up its "Live" button when Engagement is deployed
(`MMCA.ADC.Engagement.UI/Services/SessionLiveUIService.cs:10-14`).

## Authorization, feature gating, and the cross-service dependency on Conference

Both controllers, [`LivePollsController`](#livepollscontroller)
(`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:44`) and
[`SessionQuestionsController`](#sessionquestionscontroller)
(`.../Controllers/SessionQuestionsController.cs:37`), sit behind
[`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) and are gated two ways: a
plain `[Authorize]` (no anonymous participation, `LivePollsController.cs:43`,
`SessionQuestionsController.cs:36`) and a `[FeatureGate]` per feature
([`EngagementFeatures`](group-22-engagement-module.md#engagementfeatures) `LivePolls` / `SessionQA`)
that makes the whole surface vanish when toggled off (`LivePollsController.cs:42`,
`SessionQuestionsController.cs:35`). The finer authoring/moderation rights (BR-236) are enforced **in
the handlers**, not by an attribute, through the shared
[`LivePollAuthorization`](#livepollauthorization) check
(`.../LivePolls/Services/LivePollAuthorization.cs:22-44`): organizers and admins manage everything
(`:28-31`), and a speaker manages only content scoped to a session they are assigned to (matched
against the [`SessionLiveInfo`](group-17-conference-domain.md#sessionliveinfo)`.SpeakerIds` list from
Conference, `:33-38`). The organizer-only manage list and the delete endpoint additionally carry
`[HasPermission(EngagementPermissions.LiveManage)]`
([`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute),
[ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html),
`LivePollsController.cs:149`, `:168`). Crucially, the caller's identity (user id, `speaker_id` claim,
roles) is always bound from the token via
[`ICurrentUserService`](group-08-auth.md#icurrentuserservice), never from the request body
(`LivePollsController.cs:284-293`). Two Common API behaviors show up on these routes as well: every
mutating endpoint is marked [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute)
([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)) so a conference-day
retry over flaky wifi replays the first response instead of creating a second poll, question, or vote
(`LivePollsController.cs:63`, `:91`, `:125`, `:260`, `SessionQuestionsController.cs:52`, `:133`,
`:159`, `:185`, `:205`), and the five lifecycle POSTs add
[`[SupportsIfMatch]`](group-12-api-hosting-mapping.md#supportsifmatchattribute), which makes the
conditional write **mandatory**: the action reads the token with
`SupportsIfMatchAttribute.RequiredToken(HttpContext)`, a request with no `If-Match` header answers
428 Precondition Required and never reaches the handler, and a stale token answers 412 Precondition
Failed (`LivePollsController.cs:92`, `:104`, `:126`, `SessionQuestionsController.cs:134`, `:160`,
`:186`, rationale at `LivePollsController.cs:82-88`). Casting a vote and submitting a question carry
no such token, because neither touches the aggregate row it read.

This makes the live layer **dependent on Conference**, the same modular-monolith boundary Group 22
demonstrated ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) /
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). Engagement
calls Conference's
[`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice) to fetch
the live window, the session's assigned speakers, the published flag, and the event's moderation
default ([`QuestionModerationDefault`](group-17-conference-domain.md#questionmoderationdefault),
consumed at `SubmitQuestionHandler.cs:41-64`, `:86-88`); it resolves in-process when co-hosted and
over gRPC when extracted (`MMCA.ADC.Engagement.Service/Program.cs:281`, rationale at `:236-237`). On
the client side the Conference session page reaches back through the Engagement UI's
`ISessionLiveUIService` implementation for the Live route. The
[`EngagementModule`](group-22-engagement-module.md#engagementmodule) declares the dependency, and the
same disabled-stub registrations keep every interface resolvable in a single-module service host,
which is why `SessionQuestion.Create` tolerates a default `EventId` (`SessionQuestion.cs:24`,
`:64-67`). The UI clients ([`LivePollUIService`](#livepolluiservice),
[`SessionQuestionUIService`](#sessionquestionuiservice)) extend Common's
[`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) and go back
through the Gateway's public REST routes, not a back channel
(`MMCA.ADC.Engagement.UI/Services/LivePollUIService.cs:15-19`).

**Rubric lenses this chapter exercises.** `[Rubric §4, DDD]` (two aggregates with lifecycle state
machines, invariant guards, the live-window snapshot, and the single-event-with-state design);
`[Rubric §6, CQRS & Event-Driven]` (command/query slices over a shared mutate-entity base, durable
domain events through the outbox, and the *separate* ephemeral channel broadcast that two of those
domain events trigger); `[Rubric §7, Microservices Readiness]` (the `ILiveChannelPublisher` port with
a SignalR implementation, a Null default, and a gRPC forwarding adapter swapped in by `Replace`, plus
the Conference validation boundary); `[Rubric §8, Data Architecture]` (filtered unique indexes behind
the create-or-reactivate rule, the `(SessionId, Status)` conference-day index, and cross-context
references kept as scalar FK columns); `[Rubric §12, Performance & Scalability]` (per-vote checks
against a snapshotted window with no cross-service hop, set-wide grouped-`COUNT` tallies instead of
two queries per poll, database-side ranking before a cap, a bounded drop-oldest publish queue off the
request path, and patch-in-place tally updates that avoid the V-times-C refetch storm against the
rate limiter); `[Rubric §11, Security]` (authentication plus feature gates plus handler-enforced
speaker-scoped rights plus `HasPermission`, identity from token, anonymous question display, the
open-question spam cap, and pending text kept off the channel, BR-238); `[Rubric §9, API & Contract
Design]` (feature-gated, versioned REST endpoints returning Problem Details, idempotent mutations,
and a mandatory `If-Match` on every lifecycle transition); `[Rubric §18/§19, UI Architecture / State
Management]` (three live surfaces over one multicast hub subscription, a reusable subscription
helper, a container page with presentational panels, patch-vs-reload event handling, re-join on
reconnect, prerender-skipped loads); `[Rubric §29, Resilience]` (post-commit best-effort broadcasts
that never fail the command, a drain that swallows every publish failure, and a UI that treats
channel events as hints over fetchable state, degrading to dormant on failure); and `[Rubric §13,
Observability]` (every failed broadcast counted on `besteffort.dispatch.failed` and every broadcast
discarded under backpressure logged with a running total). Each is taught in full at the relevant
per-type section below.

### CastVoteCommand

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteCommand.cs:11` · Level 0 · record

- **What it is**: the CQRS command an attendee sends to cast (or change) a vote on an open poll. A
  `sealed record` carrying three values: `PollId`, `OptionId`, and the voting `UserId`
  (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteCommand.cs:11-14`).
- **Depends on**: nothing first-party (three identifier-type aliases, `LivePollIdentifierType`,
  `LivePollOptionIdentifierType`, `UserIdentifierType`, plus the BCL `record`). It is dispatched to
  [CastVoteHandler](#castvotehandler) through the CQRS pipeline.
- **Concept introduced, the token-bound caller identity.** `[Rubric §11, Security]` (assesses whether
  identity and authorization derive from a trusted source rather than from client-supplied data). The
  doc comment is emphatic (`CastVoteCommand.cs:3-7`): `UserId` is bound from the caller's token at the
  API edge, never from the request body. That is literally what the controller does: the vote action
  reads the authenticated subject and passes it positionally, while the request body contributes only
  the chosen option
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:276`). The same shape recurs across
  every live-layer message in this group, so a client cannot vote as (or moderate on behalf of)
  someone else by forging a field. `[Rubric §6, CQRS & Event-Driven]`: this is a command (it mutates
  state and answers with a [Result](group-01-result-error-handling.md#result)); the read-side
  counterparts in this group are the `...Query` records.
- **Walkthrough**: three positional members. `PollId` (`CastVoteCommand.cs:12`) and `OptionId` (`:13`)
  name the vote target; `UserId` (`:14`) is the token-bound voter. There is no method here, a command
  is a pure data message; the behavior lives in its handler and its validator. Note what the record
  does *not* carry: no `RowVersion`, because a vote writes a `LivePollVote` row and never touches the
  poll row, so there is no poll-level precondition to state (see
  [CastVoteHandler](#castvotehandler)).
- **Why it's built this way**: a `record` gives value equality and immutability for free, and keeping
  the message a flat DTO is the vertical-slice convention (command, validator, and handler co-located
  under one `UseCases/CastVote/` folder, `[Rubric §5, Vertical Slice]`).
- **Where it's used**: constructed at the Engagement REST edge
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:276`, on the `POST
  /api/livepolls/{id}/votes` action at `:259`, which is `[Idempotent]` at `:260` so a retried vote
  replays rather than re-runs) and handled by [CastVoteHandler](#castvotehandler); shape-validated
  first by [CastVoteCommandValidator](#castvotecommandvalidator).

### CloseLivePollCommand

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Close` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Close/CloseLivePollCommand.cs:12` · Level 0 · record

- **What it is**: the command that closes an open poll (BR-221, no reopen). A `sealed record` carrying
  the target `PollId`, the two caller-rights fields, and the caller's concurrency token
  (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/Close/CloseLivePollCommand.cs:12-16`).
- **Depends on**: nothing first-party; handled by [CloseLivePollHandler](#closelivepollhandler).
- **Concept introduced, the caller-rights pair plus a stated precondition.** This record and its
  sibling [OpenLivePollCommand](#openlivepollcommand) share a byte-identical shape:
  `(LivePollIdentifierType PollId, SpeakerIdentifierType? CallerSpeakerId, bool CallerIsOrganizer,
  byte[] RowVersion)`. `CallerIsOrganizer` (`CloseLivePollCommand.cs:15`) says whether the caller holds
  the Organizer or Admin role, and `CallerSpeakerId?` (`:14`) is the caller's `speaker_id` claim when
  present; both are token-bound exactly like [CastVoteCommand](#castvotecommand)'s `UserId`. The doc
  comment states the BR-236 rule they feed (`CloseLivePollCommand.cs:3-7`): event-wide polls require an
  organizer or admin, session polls also allow the session's assigned speakers.
  `[Rubric §11, Security]`: the authorization *inputs* are declared on the command and the *decision*
  is made centrally by [LivePollAuthorization](#livepollauthorization) inside the handler, not
  scattered per controller. The fourth member, `RowVersion` (`:16`), is the caller's last-observed
  optimistic-concurrency token, documented at `:11` as read from the request's `If-Match` header
  ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)).
  `[Rubric §9, API & Contract Design]`: making the precondition an explicit field of the message means
  the handler never has to reach into HTTP to learn it.
- **Walkthrough**: four positional members (`:13-16`); no methods.
- **Why it's built this way**: passing the caller's *facts* (role flag, speaker id) rather than the
  caller's *decision* keeps the authorization rule in one testable place, so open and close cannot
  drift apart. Carrying `RowVersion` on the command is what lets the shared write workflow stamp it
  without any handler-specific plumbing (see
  [MutateEntityHandlerCore<TCommand, TEntity, TIdentifierType>](group-05-cqrs-pipeline.md#mutateentityhandlercoretcommand-tentity-tidentifiertype)).
- **Where it's used**: built by the close action at
  `MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:139` from
  `SupportsIfMatchAttribute.RequiredToken(HttpContext)` (`:138`), on an endpoint marked `[Idempotent]`
  and `[SupportsIfMatch]` (`:124-126`) so a missing header answers 428 and a stale token answers 412;
  handled by [CloseLivePollHandler](#closelivepollhandler).

### GetEventPollsQuery

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetEventPolls` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetEventPolls/GetEventPollsQuery.cs:7` · Level 0 · record

- **What it is**: the read-side query for the organizer manage view: all of an event's polls regardless
  of status. A one-field `sealed record` over `EventId`
  (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetEventPolls/GetEventPollsQuery.cs:7`).
- **Depends on**: nothing first-party; handled by [GetEventPollsHandler](#geteventpollshandler).
- **Concept**: `[Rubric §6, CQRS & Event-Driven]`: a query is side-effect-free and returns data. Unlike
  the attendee-facing read queries in this group it carries no `UserId`, because the manage view
  surfaces no per-user state (no "my vote"), and unlike
  [GetSessionManagePollsQuery](#getsessionmanagepollsquery) it carries no caller-rights fields either,
  because its endpoint is gated by a permission attribute instead.
- **Walkthrough**: a single positional `EventId` member (`GetEventPollsQuery.cs:7`).
- **Why it's built this way**: the manage tab wants every poll (Draft, Open, Closed), so the query is
  deliberately unfiltered by status (doc comment, `:3-5`), and its authorization is applied at the
  controller edge with `[HasPermission(EngagementPermissions.LiveManage)]`
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:168`) rather than inside the handler.
- **Where it's used**: constructed on the `GET /api/livepolls?eventId=` action
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:167,174`) and handled by
  [GetEventPollsHandler](#geteventpollshandler), which maps to [LivePollDTO](#livepolldto).

### GetOpenPollsQuery

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetOpenPolls` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetOpenPolls/GetOpenPollsQuery.cs:11` · Level 0 · record

- **What it is**: the attendee-facing query for open polls with tallies and the caller's own vote. A
  `sealed record` carrying two nullable scopes and a `UserId`
  (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetOpenPolls/GetOpenPollsQuery.cs:11-14`).
- **Depends on**: nothing first-party; handled by [GetOpenPollsHandler](#getopenpollshandler).
- **Concept introduced, the exactly-one-scope query.** The doc comment (`GetOpenPollsQuery.cs:3-7`)
  states the contract: exactly one scope applies. With `SessionId` set it returns that session's open
  polls, otherwise the event-wide open polls of `EventId`, with session-scoped polls excluded. Both are
  nullable (`EventId?` at `:12`, `SessionId?` at `:13`) so one message type serves both the event-wide
  board and the per-session live page. `UserId` (`:14`) is the token-bound caller, so each returned
  poll can surface that user's own vote. `[Rubric §9, API & Contract Design]`: one flexible read
  contract rather than two near-duplicate endpoints.
- **Walkthrough**: three positional members (`:12-14`); the "which scope wins" decision is enforced by
  [GetOpenPollsHandler](#getopenpollshandler), not by the type.
- **Why it's built this way**: collapsing the two scopes into one nullable pair keeps every live
  surface calling a single handler; the handler, not the record, rejects the "neither scope" case, so
  the message stays a plain data carrier.
- **Where it's used**: constructed on the `GET /api/livepolls/open` action
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:208,223`) and handled by
  [GetOpenPollsHandler](#getopenpollshandler), which returns
  [LivePollResultsDTO](#livepollresultsdto) tallies.

### GetPollResultsQuery

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetPollResults` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetPollResults/GetPollResultsQuery.cs:9` · Level 0 · record

- **What it is**: the query for one poll's tallies (any status), with the caller's own vote. A
  two-field `sealed record` over `PollId` and `UserId`
  (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetPollResults/GetPollResultsQuery.cs:9`).
- **Depends on**: nothing first-party; handled by [GetPollResultsHandler](#getpollresultshandler).
- **Concept**: this is the single-poll refresh read, and it is the client half of the ADR-039
  push-then-pull rule. The doc comment names its trigger (`GetPollResultsQuery.cs:3-6`): the UI calls
  it to refresh one card when a `poll.results-changed` channel event arrives (the event name is the
  constant at `MMCA.ADC.Engagement.Shared/LivePolls/LivePollChannel.cs:20`).
  `[Rubric §12, Performance & Scalability]`: the live push carries a signal that something changed and
  the client pulls the authoritative tally for just the affected poll, so a broadcast never has to fan
  out per-user vote state.
- **Walkthrough**: two positional members, `PollId` and the token-bound `UserId`, on one line (`:9`).
- **Why it's built this way**: refreshing one card by id (rather than re-listing every open poll) is
  the cheap reaction to a push signal, and it re-reads *this* caller's vote, which the shared broadcast
  deliberately omits.
- **Where it's used**: constructed on the `GET /api/livepolls/{id}/results` action
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:232,246`) and handled by
  [GetPollResultsHandler](#getpollresultshandler).

### GetSessionManagePollsQuery

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetSessionManagePolls` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetSessionManagePolls/GetSessionManagePollsQuery.cs:12` · Level 0 · record

- **What it is**: the query behind the per-session moderation panel: all of one session's polls
  regardless of status. A `sealed record` over `SessionId` plus the caller-rights pair
  (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetSessionManagePolls/GetSessionManagePollsQuery.cs:12-15`).
- **Depends on**: nothing first-party; handled by
  [GetSessionManagePollsHandler](#getsessionmanagepollshandler).
- **Concept introduced, the authorization-gated read.** This is the read-side twin of the caller-rights
  shape [CloseLivePollCommand](#closelivepollcommand) introduces: it carries `CallerSpeakerId?` (`:14`)
  and `CallerIsOrganizer` (`:15`) so the *handler* can apply BR-236 to a query. The doc comment spells
  out why (`GetSessionManagePollsQuery.cs:3-8`): organizers and admins see everything, and a speaker
  sees the polls of a session they are assigned to. `[Rubric §11, Security]`. The reason a query needs
  its own caller facts at all is the pipeline: the CQRS decorator chain
  ([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)) wraps commands with
  a validating decorator, but a read that must be gated has to check its own rights inside the handler.
  Contrast [GetEventPollsQuery](#geteventpollsquery), whose endpoint is gated by
  `[HasPermission(EngagementPermissions.LiveManage)]` and therefore needs no caller fields.
- **Walkthrough**: three positional members, `SessionId` first (`:13`), then the caller-rights pair
  (`:14-15`). No methods.
- **Why it's built this way**: the controller's own doc comment is the rationale
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:181-187`): the `manage` endpoint is
  deliberately *not* behind the organizer-only `LiveManage` permission, because a role-based gate would
  answer a session's assigned speaker with a 403 they then have to work around. Moving the decision
  into the handler (where the Conference module's assigned-speaker list is reachable) makes the rule
  expressible.
- **Where it's used**: constructed on the `GET /api/livepolls/manage?sessionId=` action
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:188,196`) and handled by
  [GetSessionManagePollsHandler](#getsessionmanagepollshandler).

### OpenLivePollCommand

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Open` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Open/OpenLivePollCommand.cs:12` · Level 0 · record

- **What it is**: the command that opens a Draft poll for voting (BR-221/BR-223). A `sealed record`
  structurally identical to [CloseLivePollCommand](#closelivepollcommand): `PollId`, the caller-rights
  pair, and `RowVersion`
  (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/Open/OpenLivePollCommand.cs:12-16`).
- **Depends on**: nothing first-party; handled by [OpenLivePollHandler](#openlivepollhandler).
- **Concept**: same caller-rights pair and same `If-Match` precondition as
  [CloseLivePollCommand](#closelivepollcommand) (see there for the BR-236 rule and ADR-035; the
  identical doc comments sit at `OpenLivePollCommand.cs:3-11`). What differs between open and close is
  the *handler's* behavior, not the message shape: open must additionally fetch and snapshot the live
  window.
- **Walkthrough**: four positional members, `PollId` (`:13`), `CallerSpeakerId?` (`:14`),
  `CallerIsOrganizer` (`:15`), `RowVersion` (`:16`); no methods.
- **Why it's built this way**: keeping open and close as separate one-purpose commands (rather than a
  single "SetStatus" command) makes each transition's rights and side effects explicit and
  independently testable, which is the vertical-slice convention (`[Rubric §5, Vertical Slice]`).
- **Where it's used**: built by the open action at
  `MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:105` from the required `If-Match` token
  (`:104`), on an endpoint marked `[Idempotent]` and `[SupportsIfMatch]` (`:90-92`); handled by
  [OpenLivePollHandler](#openlivepollhandler).

### CastVoteCommandValidator

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteCommandValidator.cs:8` · Level 1 · class

- **What it is**: the FluentValidation validator that shape-checks a
  [CastVoteCommand](#castvotecommand) before the handler runs. A `sealed class :
  AbstractValidator<CastVoteCommand>`
  (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteCommandValidator.cs:8`).
- **Depends on**: `FluentValidation.AbstractValidator<T>` (NuGet, imported at `:1`, see
  [primer §3](00-primer.md#3-the-external-stack-bcl--nuget--external-level-0)) and the command it
  validates.
- **Concept introduced, structural validation in the pipeline.** `[Rubric §24, Forms, Validation & UX
  Safety]` (assesses whether input is validated before mutation, with actionable, coded errors). Per
  [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) the CQRS chain wraps
  a command handler with
  [ValidatingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult),
  which runs the registered validator before the handler and its transaction, so a malformed command
  never reaches the domain. Each rule pairs a human message with a stable error code
  (`WithErrorCode`), which the localization edge keys on. This is *shape* validation only: the business
  rules (poll open, inside the live window, option belongs to the poll) live in the domain, on
  `LivePoll.CanAcceptVote` (`MMCA.ADC.Engagement.Domain/LivePolls/LivePoll.cs:167-197`), not here.
  `[Rubric §16, Maintainability]`: that split is what keeps a validator from slowly becoming a second,
  divergent copy of the invariants.
- **Walkthrough**: the parameterless constructor (`:10`) declares three
  `RuleFor(...).NotEqual(default(...))` chains, one per command field, each with a message and a code:
  `PollId` (`:12-15`, code `LivePollVote.PollId.Required`), `OptionId` (`:17-20`, code
  `LivePollVote.OptionId.Required`), and `UserId` (`:22-25`, code `LivePollVote.UserId.Required`).
  `NotEqual(default(...))` is the idiomatic check for the identifier-type aliases, which are value
  types, so "missing" means "zero" rather than "null".
- **Why it's built this way**: FluentValidation validators are discovered by assembly scanning and run
  by the pipeline decorator, so "is the input well-formed" stays out of the handler (`[Rubric §5,
  Vertical Slice]` and `[Rubric §10, Cross-Cutting]`). Note that the lifecycle commands in this unit
  ship *no* validator: [OpenLivePollCommand](#openlivepollcommand) and
  [CloseLivePollCommand](#closelivepollcommand) have nothing to shape-check beyond an id the route
  already bound, and their real guards are the domain transition plus the BR-236 rights check.
- **Where it's used**: resolved and run by the CQRS validating decorator ahead of
  [CastVoteHandler](#castvotehandler).

### CastVoteHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteHandler.cs:19` · Level 10 · class

- **What it is**: the command handler that records (or changes) a vote on an open poll and answers with
  the fresh tallies. It broadcasts nothing itself: the `poll.results-changed` push is raised as a
  domain event and enqueued post-commit by
  [LivePollVoteChangedHandler](#livepollvotechangedhandler) (stated in the doc comment,
  `MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteHandler.cs:11-18`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork),
  [LivePollResultsBuilder](#livepollresultsbuilder), the BCL `TimeProvider`, and `ILogger<T>` (primary
  constructor, `:20-23`); it implements
  [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  as `ICommandHandler<CastVoteCommand, Result<LivePollResultsDTO>>` (`:23`), and it works over
  [LivePoll](#livepoll), [LivePollVote](#livepollvote), and
  [LivePollResultsDTO](#livepollresultsdto). Note two things that are *absent*: there is no live-channel
  dependency at all (neither publisher port nor
  [ILiveChannelPublishQueue](group-22-engagement-module.md#ilivechannelpublishqueue)), and unlike its
  lifecycle siblings this handler does **not** derive from
  [MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>](group-05-cqrs-pipeline.md#mutateentityhandlerbasetcommand-tentity-tidentifiertype),
  because the aggregate it writes (the vote) is not the aggregate the command names (the poll).
- **Concept introduced, the one-active-vote soft-delete dance (BR-225/BR-135).** `[Rubric §8, Data
  Architecture]` (assesses how soft-delete coexists with uniqueness without duplicate rows). A user may
  vote, change their vote, retract it, then vote again; the invariant is exactly one active vote per
  (poll, user), backed by a filtered unique index. The handler realizes that with a three-way branch
  (`:52-78`):
  - Load *all* rows for (poll, user) through the repository's
    `FindIncludingDeletedAsync` (`:52-55`), whose contract returns a named tuple of `(Active,
    SoftDeleted)` collections
    (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:215`), so
    the soft-deleted row is visible without a caller having to remember an `ignoreQueryFilters` flag.
    The two heads are taken at `:56-57`, and the load is tracked (`asTracking: true`, `:54`) because
    the branch below mutates them.
  - If an active vote exists, `activeVote.ChangeOption(command.OptionId)` (`:61`) updates the row in
    place.
  - Else if a soft-deleted vote exists, `deletedVote.Reactivate(command.OptionId)` (`:67`) un-deletes
    and re-points it, rather than inserting a duplicate that would collide with the index.
  - Else `LivePollVote.Create(...)` builds a fresh vote and `AddAsync` stages it (`:73-77`).

  Every branch propagates its [Result](group-01-result-error-handling.md#result) failure rather than
  throwing (`:62-63`, `:68-69`, `:74-75`). This is the exact pattern the bookmark feature (BR-135)
  established, reused so a hot, re-votable poll never accumulates dead rows.
- **Concept introduced, the TOCTOU re-check.** `[Rubric §29, Resilience & Business Continuity]`. Between
  the eligibility check and the save, a concurrent close can commit. A rowversion conflict cannot catch
  that race, and the handler's own doc comment explains exactly why (`:96-105`): casting a vote only
  inserts or updates a `LivePollVote` row and never touches the poll row, so the poll's concurrency
  token is never part of this unit of work. Instead `RecheckPollAcceptsVoteAsync` (`:106-120`) re-reads
  the poll fresh immediately before saving (`:111-115`) and re-runs `CanAcceptVote` (`:119`). The
  comment is honest that a millisecond window remains and is accepted, since such a vote is
  indistinguishable from one cast just before the close.
- **Concept reinforced, broadcast privacy (BR-229), enforced one layer out.** `[Rubric §11, Security]`
  and `[Rubric §12, Performance]`. The command returns the caller's full tally *including* their own
  vote (`:91`), while the fan-out payload must not leak one user's choice to every subscriber. Neither
  concern is settled here: the vote aggregate raises
  [LivePollVoteChanged](#livepollvotechanged), and
  [LivePollVoteChangedHandler](#livepollvotechangedhandler) rebuilds the tally with `userId: null` so
  `MyVoteOptionId` stays null before enqueueing
  (`MMCA.ADC.Engagement.Application/LivePolls/DomainEventHandlers/LivePollVoteChangedHandler.cs:71-82`).
  The comment left behind here (`CastVoteHandler.cs:88-90`) names the reason for the move: enqueuing
  inside the command would publish tallies for a vote that a later rollback discards. Each client then
  refreshes its own card via [GetPollResultsQuery](#getpollresultsquery), which re-reads *its* vote.
- **Walkthrough**: resolve the poll repository and load the poll with its `Options`, no-tracking
  (`:30-35`); NotFound guard (`:37-41`); the domain gate
  `poll.CanAcceptVote(timeProvider.GetUtcNow().UtcDateTime, command.OptionId)` (`:43`), which enforces
  open plus inside the snapshotted window plus option-belongs-to-poll
  (`MMCA.ADC.Engagement.Domain/LivePolls/LivePoll.cs:169-194`), with a short-circuit on failure
  (`:44-45`); resolve the vote repository (`:47`); the three-way vote branch (`:52-78`); the TOCTOU
  re-check (`:80-82`); `SaveChangesAsync` (`:84`); a source-generated `LoggerMessage` at Information
  level (`:86`, declared `:122-123`), `[Rubric §13, Observability]`; then rebuild the caller's tallies
  through [LivePollResultsBuilder.BuildAsync](#livepollresultsbuilder) (`:91`) and return them (`:93`).
- **Why it's built this way**: including soft-deleted rows in the lookup is load-bearing, because
  without it a re-vote would try to insert a second row and hit the unique index. Moving the broadcast
  to the domain-event handler keeps a shared push from carrying anyone's individual vote *and* keeps it
  from ever describing a vote that never committed
  ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)).
- **Where it's used**: dispatched by the attendee vote endpoint
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:259,276`); shape-checked first by
  [CastVoteCommandValidator](#castvotecommandvalidator).

### CloseLivePollHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Close` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Close/CloseLivePollHandler.cs:19` · Level 10 · class

- **What it is**: the command handler for the Open to Closed transition (BR-221). It authorizes the
  caller, drives the domain transition, and after the commit enqueues a `poll.closed` channel event
  best-effort for the off-request-path drain worker (doc comment,
  `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Close/CloseLivePollHandler.cs:14-18`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork),
  [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) (the
  Conference gRPC boundary),
  [ILiveChannelPublishQueue](group-22-engagement-module.md#ilivechannelpublishqueue) (`:22`), and
  `ILogger<T>` (`:20-23`); it derives from
  [MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>](group-05-cqrs-pipeline.md#mutateentityhandlerbasetcommand-tentity-tidentifiertype)
  closed over `(CloseLivePollCommand, LivePoll, LivePollIdentifierType)` (`:24`). It also uses
  [LivePollAuthorization](#livepollauthorization), [LivePoll](#livepoll),
  [LivePollChannel](#livepollchannel),
  [LiveChannelPublishWorkItem](group-22-engagement-module.md#livechannelpublishworkitem), and the BCL
  `System.Text.Json`.
- **Concept introduced, the write handler as a set of template-method hooks.** `[Rubric §2, Design
  Patterns]` and `[Rubric §16, Maintainability]`. This handler writes no `HandleAsync` at all. The base
  class owns the whole load-mutate-save workflow
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/MutateEntityHandlerBase.cs:270-308`) and
  the subclass fills in only what is specific to closing a poll:
  1. **`EntityId`** (`CloseLivePollHandler.cs:27`) tells the base which key to load. The base resolves
     the repository and issues a by-id load using its `Includes` and `AsTracking` defaults (empty and
     `true` respectively, `MutateEntityHandlerBase.cs:69,75,279-280`); a missing aggregate becomes
     `Error.NotFound` without a line of handler code (`:281-282`).
  2. **`RowVersion`** (`CloseLivePollHandler.cs:33`) hands the base `command.RowVersion`, and the base
     stamps it as the entity's original token (`MutateEntityHandlerBase.cs:290-291`) so a close decided
     against a stale view fails the save. The intent is spelled out both in the base
     (`:284-289`) and in the handler's own comment (`CloseLivePollHandler.cs:29-30`): 412 Precondition
     Failed instead of silent last-write-wins
     ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)).
  3. **`MutateAsync`** (`CloseLivePollHandler.cs:36-61`) is the only place the domain rule lives, and it
     is async precisely so a cross-service rights lookup fits inside it
     (`MutateEntityHandlerBase.cs:100-104`).
  4. **`LogMutated`** (`CloseLivePollHandler.cs:64-65`) fires the module's own
     `[LoggerMessage]` partial (`:98-99`) after a successful save, `[Rubric §13, Observability]`.
  5. **`OnMutatedAsync`** (`:68-76`) is the post-commit hook the base documents for best-effort work
     that must never fail the command (`MutateEntityHandlerBase.cs:202-213`); here it calls
     `EnqueueClosed`.

  The base runs them in exactly that order and skips both post-save hooks when the mutation
  short-circuited (`MutateEntityHandlerBase.cs:293-307`), and its `HandleAsync` flattens the workflow's
  `Result<LivePoll>` down to the bare `Result` this verb-style command answers with (`:326-331`).
- **Concept, the cross-module rights lookup.** `[Rubric §7, Microservices Readiness]`. Inside
  `MutateAsync` the handler branches on scope. A session-scoped poll first fetches the session's live
  info from Conference over the typed gRPC client `GetSessionLiveInfoAsync` (`:43`), propagating that
  call's failure verbatim (`:44-45`), then calls
  [LivePollAuthorization.EnsureCanManage](#livepollauthorization) with that session's assigned-speaker
  list (`:47-48`). An event-wide poll passes `sessionInfo: null` (`:54-55`) so only organizers and
  admins pass. Engagement never reaches into Conference's tables, it asks across the boundary
  ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)). Only after rights are
  settled does it return `poll.Close()` (`:60`), which enforces "only an Open poll can close" and
  raises the aggregate's domain event.
- **The best-effort guarantee (BR-229).** `[Rubric §29, Resilience & Business Continuity]`. There is no
  `try`/`catch` around the enqueue, and that is a property of the port rather than an oversight:
  `Enqueue` returns `void` and never rejects, so there is no failure for the handler to branch on. The
  method's doc comment states the contract (`:78-83`): the request never awaits the gRPC publish, so a
  hung Notification peer cannot stall the close, and under backpressure the queue discards the oldest
  pending broadcast and logs that. The live push is a transient convenience (SignalR fan-out,
  [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)), not the source of truth:
  if Notification is momentarily unreachable, the close already committed and clients recover on their
  next fetch.
- **Walkthrough of `EnqueueClosed`** (`:84-96`): build the channel key,
  `LivePollChannel.ForSession(sessionId)` for a session poll or `.ForEvent(poll.EventId)` for an
  event-wide one (`:86-88`, the helpers at
  `MMCA.ADC.Engagement.Shared/LivePolls/LivePollChannel.cs:24-30`); serialize a
  `LivePollClosedPayload(poll.Id, poll.EventId)` with `JsonSerializerOptions.Web` (`:90-92`); hand a
  `LiveChannelPublishWorkItem` carrying that key, the `LivePollChannel.PollClosed` event name
  (`"poll.closed"`, `LivePollChannel.cs:17`), and the payload to
  [ILiveChannelPublishQueue](group-22-engagement-module.md#ilivechannelpublishqueue) (`:94-95`).
- **Why it's built this way**: separating the durable state change (committed transactionally, with a
  domain event on the outbox) from the transient UI push (queued in process, forwarded to the hub by
  the [LiveChannelPublishProcessor](group-22-engagement-module.md#livechannelpublishprocessor) drain)
  keeps correctness *and* request latency independent of the real-time layer's availability
  ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html),
  [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html)). Deriving from the shared
  base means the ADR-035 stamping, the NotFound mapping, and the "log and post-process only after a
  real save" ordering are decided once for the whole codebase, not re-typed per handler.
- **Where it's used**: dispatched by the `POST /api/livepolls/{id}/close` action
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:124,139`); a member of the
  poll-lifecycle family with [OpenLivePollHandler](#openlivepollhandler).

### GetEventPollsHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetEventPolls` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetEventPolls/GetEventPollsHandler.cs:14` · Level 10 · class

- **What it is**: the read handler backing the organizer Manage tab. It returns every poll of an event
  (Draft, Open, and Closed) with its options, newest first
  (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetEventPolls/GetEventPollsHandler.cs:14`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) and
  [LivePollDTOMapper](#livepolldtomapper) (`:14-16`); it implements
  [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  as `IQueryHandler<GetEventPollsQuery, Result<IReadOnlyList<LivePollDTO>>>` (`:16`) over
  [LivePoll](#livepoll) and [LivePollDTO](#livepolldto).
- **Concept**: `[Rubric §6, CQRS & Event-Driven]`: a query handler returns data and never mutates.
  `[Rubric §1, SOLID]`: the DTO projection is delegated to the injected Mapperly mapper rather than
  hand-written inline, so the handler is only about fetching
  ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)).
- **Walkthrough**: `HandleAsync` (`:19-21`) resolves the poll repository (`:23`) and calls
  `GetAllAsync([nameof(LivePoll.Options)], where: p => p.EventId == query.EventId, asTracking: false,
  ...)` (`:24-28`), eager-loading the options and reading no-tracking because this is a read path
  (`[Rubric §12, Performance]`). It then orders newest-first and maps in one collection expression:
  `[.. polls.OrderByDescending(p => p.Id).Select(dtoMapper.MapToDTO)]` (`:30`), and wraps the list in
  `Result.Success` (`:32`).
- **Why it's built this way**: `OrderByDescending(p => p.Id)` gives newest-first cheaply on the identity
  key without an extra timestamp column. The doc comment is honest about scale (`:10-13`): there is no
  paging, because the observed conference volume does not need it, a deliberate simplification rather
  than an oversight.
- **Where it's used**: dispatched by the `GET /api/livepolls?eventId=` action, which is gated by
  `[HasPermission(EngagementPermissions.LiveManage)]`
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:167-168,174`). Its per-session
  counterpart is [GetSessionManagePollsHandler](#getsessionmanagepollshandler).

### GetOpenPollsHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetOpenPolls` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetOpenPolls/GetOpenPollsHandler.cs:15` · Level 10 · class

- **What it is**: the read handler returning the open polls for a scope, with live tallies and the
  caller's own vote
  (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetOpenPolls/GetOpenPollsHandler.cs:15`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) and
  [LivePollResultsBuilder](#livepollresultsbuilder) (`:15-17`); it implements
  [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  as `IQueryHandler<GetOpenPollsQuery, Result<IReadOnlyList<LivePollResultsDTO>>>` (`:17`) over
  [LivePoll](#livepoll), [LivePollStatus](#livepollstatus), and
  [LivePollResultsDTO](#livepollresultsdto).
- **Concept, in-handler scope validation.** `[Rubric §24, Forms, Validation & UX Safety]`. Because a
  query has no validating decorator, this handler opens by rejecting the "neither scope" case itself:
  if both `SessionId` and `EventId` are null it returns
  `Error.Validation(code: "LivePoll.Scope.Required", ...)` (`:24-30`), a coded failure the API edge can
  map and localize like any other. It then picks the query shape by scope: session scope filters
  `p.SessionId == sessionId && p.Status == LivePollStatus.Open` (`:34-38`), event scope filters
  `p.EventId == query.EventId && p.SessionId == null && p.Status == LivePollStatus.Open` (`:39-43`).
  That `p.SessionId == null` clause is what BR-230's "session-scoped polls are excluded from the
  event-wide feed" means in code (doc comment, `:10-14`).
- **Concept, the batched tally.** `[Rubric §12, Performance & Scalability]`. The whole listing's tallies
  are computed in a single call to
  [LivePollResultsBuilder.BuildManyAsync](#livepollresultsbuilder) (`:47-50`), not in a per-poll loop.
  The comment states the budget (`:45-46`): three queries total for the listing, the poll read plus the
  builder's two set-wide reads, never two per poll. Inside the builder those two reads are one grouped
  `COUNT` over every poll in the set
  (`MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollResultsBuilder.cs:61-66`) and, only when
  a caller is present, one read of that caller's votes across the same set (`:75-79`). This is the
  handler where an N+1 would hurt most (it backs the page the whole room refreshes), and it is the one
  place the code spends effort to avoid it.
- **Walkthrough**: scope guard (`:24-30`); resolve the repository (`:32`); scope-selected `GetAllAsync`
  eager-loading `Options` no-tracking (`:33-43`); order by id and hand the whole set to
  `BuildManyAsync` with the caller's `UserId` (`:47-50`); return the results (`:52`).
- **Why it's built this way**: reusing [LivePollResultsBuilder](#livepollresultsbuilder) means the
  event-wide board, the session live page, and the post-vote response all compute tallies identically,
  so a pushed change and a pulled refresh can never disagree (`[Rubric §1, SOLID]`).
- **Where it's used**: dispatched by the `GET /api/livepolls/open` action
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:208,223`), which is the attendee-facing
  poll list on both live surfaces.

### GetPollResultsHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetPollResults` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetPollResults/GetPollResultsHandler.cs:13` · Level 10 · class

- **What it is**: the read handler returning one poll's live tallies (any status) with the caller's own
  vote
  (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetPollResults/GetPollResultsHandler.cs:13`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) and
  [LivePollResultsBuilder](#livepollresultsbuilder) (`:13-15`); it implements
  [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  as `IQueryHandler<GetPollResultsQuery, Result<LivePollResultsDTO>>` (`:15`) over
  [LivePoll](#livepoll) and [LivePollResultsDTO](#livepollresultsdto).
- **Concept**: this is the single-poll refresh a client runs when a `poll.results-changed` push arrives
  (see [GetPollResultsQuery](#getpollresultsquery)). `[Rubric §12, Performance]`: it re-reads exactly
  one card rather than the whole open-poll list, which is the pull half of ADR-039's
  push-a-signal-then-fetch model.
- **Walkthrough**: resolve the repository (`:22`); load the poll with `Options`, no-tracking (`:23-27`);
  NotFound guard carrying source and target on the error (`:29-33`); delegate the tally to
  [LivePollResultsBuilder.BuildAsync(poll, query.UserId, ...)](#livepollresultsbuilder) (`:35`) and
  return it (`:37`). It applies no status filter, so results stay readable for a Closed poll, which is
  why the UI can still show a final tally after a poll closes.
- **Why it's built this way**: the compact "load one, build the tally, return" shape is the read half of
  the same [LivePollResultsBuilder](#livepollresultsbuilder) that
  [CastVoteHandler](#castvotehandler) writes through, and passing `query.UserId` (rather than `null`,
  as the broadcast path does) is exactly what makes this the *personalized* view of numbers the shared
  push deliberately depersonalizes.
- **Where it's used**: dispatched by the `GET /api/livepolls/{id}/results` action
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:232,246`).

### GetSessionManagePollsHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetSessionManagePolls` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetSessionManagePolls/GetSessionManagePollsHandler.cs:20` · Level 10 · class

- **What it is**: the read handler for the per-session moderation panel. It returns all of one session's
  polls (Draft, Open, and Closed) with their options, newest first, after enforcing the BR-236 rights
  rule itself
  (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetSessionManagePolls/GetSessionManagePollsHandler.cs:20`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork),
  [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice), and
  [LivePollDTOMapper](#livepolldtomapper) (`:20-23`); it implements
  [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  as `IQueryHandler<GetSessionManagePollsQuery, Result<IReadOnlyList<LivePollDTO>>>` (`:23`) and uses
  [LivePollAuthorization](#livepollauthorization), [LivePoll](#livepoll), and
  [LivePollDTO](#livepolldto).
- **Concept introduced, authorization on the read path.** `[Rubric §11, Security]` and `[Rubric §7,
  Microservices Readiness]`. This is the one query in the poll family that gates itself, and its own
  comment says why it has to reach across a module boundary to do it (`:32-33`): the assigned-speaker
  list is the Conference module's fact, so the rights check reads it exactly as the create, open, and
  close paths do. The sequence is: `GetSessionLiveInfoAsync(query.SessionId, ...)` (`:34-36`) with a
  verbatim propagation of that call's failure (`:37-40`), then
  [LivePollAuthorization.EnsureCanManage](#livepollauthorization) with the caller's role flag, speaker
  claim, and the fetched session info (`:42-46`), short-circuiting on refusal (`:47-50`). The rule
  itself is small and shared: an organizer or admin passes unconditionally, a speaker passes when the
  session's `SpeakerIds` contains their claim, everyone else gets `Error.Forbidden` with the code
  `LivePoll.NotAuthorized`
  (`MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollAuthorization.cs:28-43`).
- **Concept, the read repository.** Once past the gate the handler asks for
  `GetReadRepository<LivePoll, LivePollIdentifierType>()` (`:52`) rather than the read-write
  `GetRepository` its sibling [GetEventPollsHandler](#geteventpollshandler) uses. `[Rubric §8, Data
  Architecture]`: a query that cannot write is easier to reason about than one that merely chooses not
  to.
- **Walkthrough**: `ArgumentNullException.ThrowIfNull(query)` (`:30`); the two-step authorization
  (`:34-50`); `GetAllAsync([nameof(LivePoll.Options)], where: p => p.SessionId == query.SessionId,
  asTracking: false, ...)` (`:53-57`); then the same ordering and projection as the event-wide list,
  `[.. polls.OrderByDescending(p => p.Id).Select(dtoMapper.MapToDTO)]` (`:60`), with the comment
  spelling out that the match is intentional so both moderation surfaces agree (`:59`).
- **Why it's built this way**: the class doc comment states the design decision plainly (`:12-19`).
  Rights here follow BR-236 rather than the organizer-only `LiveManage` capability the event-wide manage
  list carries, so a speaker moderating their own session gets the real list instead of a 403 they have
  to work around. That is a case where a coarse role-based gate at the controller edge could not express
  the rule, and the handler is the only layer that can reach both the caller's claims (on the query)
  and the Conference-owned speaker assignment.
- **Where it's used**: dispatched by the `GET /api/livepolls/manage?sessionId=` action
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:188,196`), which deliberately carries no
  `[HasPermission]` attribute (`:181-190`).

### OpenLivePollHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Open` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Open/OpenLivePollHandler.cs:20` · Level 10 · class

- **What it is**: the command handler for the Draft to Open transition. It authorizes the caller,
  fetches the live window from Conference and snapshots it onto the poll, and after the commit enqueues
  `poll.opened` best-effort (doc comment,
  `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Open/OpenLivePollHandler.cs:14-19`).
- **Depends on**: the same set as [CloseLivePollHandler](#closelivepollhandler), including
  [ILiveChannelPublishQueue](group-22-engagement-module.md#ilivechannelpublishqueue) (`:23`), plus a BCL
  `TimeProvider` for the current instant (`:24`); it derives from the same
  [MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>](group-05-cqrs-pipeline.md#mutateentityhandlerbasetcommand-tentity-tidentifiertype)
  closed over `(OpenLivePollCommand, LivePoll, LivePollIdentifierType)` (`:26`).
- **Concept introduced, snapshotting a cross-service window to avoid per-vote chatter.** `[Rubric §12,
  Performance & Scalability]` and `[Rubric §7, Microservices Readiness]`. This handler overrides the
  same four hooks as [CloseLivePollHandler](#closelivepollhandler) (`EntityId` at `:29`, `RowVersion` at
  `:35`, `LogMutated` at `:79-80`, `OnMutatedAsync` at `:83-91`), with one added responsibility inside
  `MutateAsync`: before opening, it resolves the live window. For a session poll it reuses the
  `SessionLiveInfo` it already fetched for authorization, reading `LiveWindowStartUtc` and
  `LiveWindowEndUtc` off it (`:47,51-58`); for an event-wide poll it authorizes first and then makes a
  second gRPC call, `GetEventLiveInfoAsync(poll.EventId, ...)` (`:67`), reading the window off that
  (`:71-72`). It then returns `poll.Open(timeProvider.GetUtcNow().UtcDateTime, windowStartUtc,
  windowEndUtc)` (`:75`). Inside the domain, `Open` stores the live-window end on the poll, so that
  afterwards every vote can be window-checked locally by `CanAcceptVote`
  (`MMCA.ADC.Engagement.Domain/LivePolls/LivePoll.cs:178-185`) with no further cross-service call. That
  is the performance point: one lookup at open time replaces one lookup per vote, on the highest
  frequency operation in the whole layer.
- **Walkthrough**: the base runs load, NotFound guard, and ADR-035 rowversion stamping before this class
  sees anything (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/MutateEntityHandlerBase.cs:279-291`,
  fed by `EntityId` at `:29` and `RowVersion` at `:35`). `MutateAsync` (`:38-76`) declares the two window
  locals (`:43-44`), branches on `poll.SessionId` (`:45`), and in each arm authorizes through
  [LivePollAuthorization.EnsureCanManage](#livepollauthorization) (`:52-55` for a session,
  `:62-65` for an event) before resolving the window; it ends with the domain call at `:75`, whose
  failure the base turns into the handler's failure without saving
  (`MutateEntityHandlerBase.cs:293-295`). After the commit the base calls `LogMutated` (`:79-80`, the
  `[LoggerMessage]` partial at `:113-114`) and then `OnMutatedAsync` (`:83-91`), which calls
  `EnqueueOpened` (`:99-111`): same channel-key choice as the close path (`:101-103`), but the payload
  is a `LivePollOpenedPayload(poll.Id, poll.EventId, poll.Question)` (`:106`), carrying the question so
  a subscriber can render the new card without a fetch, published under the
  `LivePollChannel.PollOpened` event name (`"poll.opened"`,
  `MMCA.ADC.Engagement.Shared/LivePolls/LivePollChannel.cs:14`). As with the close path there is no
  swallow-and-log guard, because the enqueue never rejects (doc comment, `:93-98`).
- **Why it's built this way**: snapshotting the window end at Open is the
  [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) live-layer design. It keeps
  the hot vote path free of Conference round-trips and makes vote acceptance deterministic even if
  Conference is briefly unreachable, at the accepted cost that a window changed after the open is not
  reflected on an already-open poll.
- **Caveats / not-in-source**: the session arm reuses the `SessionLiveInfo` fetched for the rights check
  and the event arm issues a separate `GetEventLiveInfoAsync`, so an event-wide open costs one gRPC call
  and a session open also costs one; whether those two live-window sources can ever disagree for the
  same session is a Conference-side question and is not determinable from this file.
- **Where it's used**: dispatched by the `POST /api/livepolls/{id}/open` action
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:90,105`); paired with
  [CloseLivePollHandler](#closelivepollhandler).

### GetModerationQueueQuery

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetModerationQueue` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetModerationQueue/GetModerationQueueQuery.cs:11` · Level 0 · record

- **What it is**: the read message behind the moderator's Q&A queue for one session. It asks for a session's questions in **every** status (BR-236) and carries the caller's rights alongside the target, as a `sealed record` with three positional members (`GetModerationQueueQuery.cs:11-14`).
- **Depends on**: the identifier aliases `SessionIdentifierType` and `SpeakerIdentifierType?` (`GetModerationQueueQuery.cs:12-13`), the per-module `global using` aliases introduced in the [primer](00-primer.md#2-architectural-styles-this-codebase-commits-to). No first-party class dependencies: a query record is data only. It is answered by [GetModerationQueueHandler](#getmoderationqueuehandler) through the read side of the CQRS pipeline ([IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)).
- **Concept introduced**: **carrying the caller's authorization facts on the message instead of resolving them in the handler.** The two extra members are not filters, they are the inputs to a rights check: `CallerSpeakerId` is the caller's `speaker_id` claim when present, and `CallerIsOrganizer` says whether the caller holds the Organizer or Admin role (`GetModerationQueueQuery.cs:9-10`). Both are bound from the token at the API edge (`:5-6`), so the handler never reaches for ambient `HttpContext` state and stays a pure function of its message. `[Rubric §11, Security]` assesses whether identity is derived from a trustworthy source; the claims come from the validated token in [SessionQuestionsController](#sessionquestionscontroller) rather than from the request body, so a client cannot self-declare itself an organizer. `[Rubric §14, Testability]` assesses how easily a unit can be exercised; because the rights inputs are message fields, every BR-236 branch is a plain constructor argument in a unit test with no auth stack to stand up.
- **Walkthrough**: `SessionId` (`GetModerationQueueQuery.cs:12`) selects the session; `CallerSpeakerId` (`:13`) is the nullable speaker claim; `CallerIsOrganizer` (`:14`) is the role flag. Positional record members are `init`-only, so the query is immutable once built.
- **Why it's built this way**: the moderation view is a different projection of the same table than the attendee view, with a different audience, so it gets its own message rather than a `bool includeAll` flag on [GetSessionQuestionsQuery](#getsessionquestionsquery). Two messages keep each read's authorization contract explicit.
- **Where it's used**: constructed in [SessionQuestionsController](#sessionquestionscontroller) on the `GET /SessionQuestions/moderation` route (`MMCA.ADC.Engagement.API/Controllers/SessionQuestionsController.cs:104-113`) and dispatched to [GetModerationQueueHandler](#getmoderationqueuehandler).

### GetSessionQuestionsQuery

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetSessionQuestions` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetSessionQuestions/GetSessionQuestionsQuery.cs:11` · Level 0 · record

- **What it is**: the read message for the attendee view of a session's Q&A. It asks for one session's questions from the calling user's perspective, as a `sealed record` with two positional members (`GetSessionQuestionsQuery.cs:11-13`).
- **Depends on**: the aliases `SessionIdentifierType` and `UserIdentifierType` (`GetSessionQuestionsQuery.cs:12-13`). No first-party class dependencies; it is answered by [GetSessionQuestionsHandler](#getsessionquestionshandler).
- **Concept introduced**: the **caller-scoped read**. The same session yields a different result set per caller: the handler returns every Approved question plus only *the caller's own* Pending and Dismissed ones, so authors can track their submissions (`GetSessionQuestionsQuery.cs:4-6`). The XML summary is careful about provenance: that visibility split is a contract of this read rather than a numbered business rule, because BR-238 covers anonymity only (`:6-8`). Carrying `UserId` in the message rather than reading ambient context inside the handler keeps the read pure and testable. `[Rubric §6, CQRS and Event-Driven]` assesses whether reads and writes are cleanly separated; this record is a read message with no mutation surface and no handler-side state. `[Rubric §11, Security]` assesses data scoping; `UserId` is not a client-supplied field: the controller takes it from `currentUserService.UserId` and rejects an unauthenticated caller before building the query (`MMCA.ADC.Engagement.API/Controllers/SessionQuestionsController.cs:85-92`), so a user cannot request another user's private submissions.
- **Walkthrough**: `SessionId` (`GetSessionQuestionsQuery.cs:12`) selects the session; `UserId` (`:13`) scopes both the personal non-approved rows and the caller's own-upvote flags. Both members are `init`-only.
- **Why it's built this way**: a per-caller read cannot be output-cached the way the anonymous Conference reads are, so it is modeled as a plain live query; two fields are the minimum needed to express "this session, as seen by this user."
- **Where it's used**: constructed in [SessionQuestionsController](#sessionquestionscontroller) on the `GET /SessionQuestions` route (`MMCA.ADC.Engagement.API/Controllers/SessionQuestionsController.cs:78-92`) and dispatched to [GetSessionQuestionsHandler](#getsessionquestionshandler) behind the session live Q&A panel.

### SubmitQuestionCommand

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionCommand.cs:11` · Level 0 · record

- **What it is**: the write message for asking a question in a live session (BR-231/BR-233). A `sealed record` with three positional members (`SubmitQuestionCommand.cs:11-14`).
- **Depends on**: the aliases `SessionIdentifierType` and `UserIdentifierType` plus a `string Text` payload (`SubmitQuestionCommand.cs:12-14`). Consumed by [SubmitQuestionCommandValidator](#submitquestioncommandvalidator) and [SubmitQuestionHandler](#submitquestionhandler).
- **Concept introduced**: the first Q&A **command message**, and with it the trust boundary the XML summary states outright (`SubmitQuestionCommand.cs:4-6`): `UserId` is bound from the caller's token at the API edge, **never** from the request body. The controller builds the command from the authenticated principal (`MMCA.ADC.Engagement.API/Controllers/SessionQuestionsController.cs:66`), so a client cannot post as another author. `[Rubric §11, Security]` assesses trust boundaries around identity; the author id is deliberately kept off the client-controlled surface. `[Rubric §6, CQRS and Event-Driven]` assesses read/write separation; this is a mutation message that flows through the validating and transactional decorators (see [group-05](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)) that queries skip.
- **Walkthrough**: `SessionId` (`SubmitQuestionCommand.cs:12`) is the target session; `Text` (`:13`) is the question body, documented as 1 to 500 characters per BR-231 (`:9`) but enforced by the validator and the domain, not by the record; `UserId` (`:14`) is the token-bound author.
- **Why it's built this way**: length and presence rules live in a FluentValidation validator so the message stays a plain data carrier and the rules run in the pipeline's validating stage before a transaction opens or a cross-service lookup is made.
- **Where it's used**: validated by [SubmitQuestionCommandValidator](#submitquestioncommandvalidator), handled by [SubmitQuestionHandler](#submitquestionhandler), dispatched from the `POST /SessionQuestions` route of [SessionQuestionsController](#sessionquestionscontroller).

### ToggleUpvoteCommand

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteCommand.cs:11` · Level 0 · record

- **What it is**: the write message that sets or clears the caller's upvote on a session question (BR-235/BR-237). A `sealed record` with three positional members (`ToggleUpvoteCommand.cs:11-14`).
- **Depends on**: `SessionQuestionIdentifierType` (the question being voted on), `UserIdentifierType`, and a `bool Upvote` intent flag (`ToggleUpvoteCommand.cs:12-14`). Consumed by [ToggleUpvoteCommandValidator](#toggleupvotecommandvalidator) and [ToggleUpvoteHandler](#toggleupvotehandler).
- **Concept introduced**: the **explicit desired-state toggle**. Instead of separate "add upvote" and "remove upvote" commands, one command carries a `bool` naming the state the caller wants to end up in, and the summary makes the idempotency contract explicit: "Toggling to a state the caller is already in is a no-op success" (`ToggleUpvoteCommand.cs:6`). That shape lets a flaky mobile client retry safely, since the second identical tap changes nothing and still returns success (the handler's no-op branches at `ToggleUpvoteHandler.cs:135-138` and `:167-170` are where the contract is honored). As with the other write messages, `UserId` is token-bound, never from the body (`ToggleUpvoteCommand.cs:4-6`). `[Rubric §9, API and Contract Design]` assesses whether a contract is safe to call twice; the desired-state design makes the operation naturally idempotent without a request id. `[Rubric §11, Security]` again: the voter identity is not client-supplied.
- **Walkthrough**: `QuestionId` (`ToggleUpvoteCommand.cs:12`) targets the question; `UserId` (`:13`) is the token-bound voter; `Upvote` (`:14`) is `true` to upvote and `false` to remove.
- **Why it's built this way**: a single toggle keeps both the HTTP surface and the client state machine small, and pushes the "already in that state" branch into the handler where the [SessionQuestionUpvote](#sessionquestionupvote) soft-delete and reactivate dance already lives.
- **Where it's used**: validated by [ToggleUpvoteCommandValidator](#toggleupvotecommandvalidator), handled by [ToggleUpvoteHandler](#toggleupvotehandler), dispatched from the `POST /SessionQuestions/{id}/upvotes` route of [SessionQuestionsController](#sessionquestionscontroller) (`MMCA.ADC.Engagement.API/Controllers/SessionQuestionsController.cs:204-250`).

### ToggleUpvoteCommandValidator

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteCommandValidator.cs:8` · Level 1 · class

- **What it is**: the FluentValidation rule set for [ToggleUpvoteCommand](#toggleupvotecommand), run before the handler by the validating decorator. A `sealed class` extending `AbstractValidator<ToggleUpvoteCommand>` (`ToggleUpvoteCommandValidator.cs:8`).
- **Depends on**: FluentValidation's `AbstractValidator<T>` (NuGet, `ToggleUpvoteCommandValidator.cs:1`) and the identifier aliases the rules compare against. It is discovered by assembly scanning and invoked by the validating stage of the command pipeline (see [group-06](group-06-validation.md) and [group-05](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)).
- **Concept introduced**: the two-part message convention every validator in this codebase follows. Each rule attaches both a human `WithMessage` and a machine `WithErrorCode`, and the codes are namespaced by feature: `SessionQuestionUpvote.QuestionId.Required` (`ToggleUpvoteCommandValidator.cs:15`) and `SessionQuestionUpvote.UserId.Required` (`:20`). A client or a test asserts on the stable code, never on the prose. `[Rubric §24, Forms/Validation/UX Safety]` assesses whether input is rejected structurally and legibly; the paired message and code do both. `[Rubric §6, CQRS and Event-Driven]` assesses pipeline discipline; validation is a decorator concern here, not hand-rolled inside the handler.
- **Walkthrough**: the constructor declares exactly two rules (`ToggleUpvoteCommandValidator.cs:10-21`). `QuestionId` must not equal `default(SessionQuestionIdentifierType)` (`:12-15`) and `UserId` must not equal `default(UserIdentifierType)` (`:17-20`). Both are structural presence guards. The behavioral rules (an author cannot upvote their own question, the question must be Approved, the live window must still be open) deliberately live in [ToggleUpvoteHandler](#toggleupvotehandler) and on the [SessionQuestion](#sessionquestion) aggregate, because they need loaded state a validator does not have.
- **Why it's built this way**: cheap stateless guards run first so a malformed command never reaches a repository or opens a transaction; anything that needs the persisted question is left to the handler.
- **Where it's used**: resolved and executed by the validating command decorator for [ToggleUpvoteCommand](#toggleupvotecommand).

### SubmitQuestionCommandValidator

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionCommandValidator.cs:9` · Level 7 · class

- **What it is**: the FluentValidation rule set for [SubmitQuestionCommand](#submitquestioncommand) (BR-231). A `sealed class` extending `AbstractValidator<SubmitQuestionCommand>` (`SubmitQuestionCommandValidator.cs:9`).
- **Depends on**: FluentValidation's `AbstractValidator<T>` (NuGet, `SubmitQuestionCommandValidator.cs:1`) and, notably, the domain type [SessionQuestionInvariants](#sessionquestioninvariants) from `MMCA.ADC.Engagement.Domain.SessionQuestions` (`:2`).
- **Concept introduced**: **one number, one home.** The text-length rule does not hardcode 500. It reads `SessionQuestionInvariants.TextMaxLength` both for the `MaximumLength(...)` call and for the interpolated message (`SubmitQuestionCommandValidator.cs:22-23`), and that constant is itself an alias of `SessionQuestionDTO.TextMaxLength` (`MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionInvariants.cs:13`), where the literal `500` is declared once in the Shared layer that the UI, the application validator, and the domain factory can all reach (`MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionDTO.cs:18`). Application-layer validation and the domain's `EnsureTextIsValid` (`SessionQuestionInvariants.cs:30-38`) therefore enforce the same bound and cannot drift. `[Rubric §4, DDD]` assesses whether rules belong to the domain; the limit is owned there and merely referenced here. `[Rubric §16, Maintainability]` assesses duplication of business constants; the chain from DTO to invariant to validator means changing the cap is a one-line edit.
- **Walkthrough**: three rules in the constructor (`SubmitQuestionCommandValidator.cs:11-30`). `SessionId` must not be `default`, code `SessionQuestion.SessionId.Required` (`:13-16`). `Text` must be `NotEmpty` (code `SessionQuestion.Text.Required`) and within `SessionQuestionInvariants.TextMaxLength` (code `SessionQuestion.Text.Invalid`), with the "1-N characters" message built from the same constant (`:18-24`). `UserId` must not be `default`, code `SessionQuestion.UserId.Required` (`:26-29`).
- **Why it's built this way**: the presence checks fail fast, before [SubmitQuestionHandler](#submitquestionhandler) spends a cross-service gRPC call resolving the session; reading the max length from the domain keeps the validator honest if the business limit moves.
- **Where it's used**: executed by the validating command decorator ahead of [SubmitQuestionHandler](#submitquestionhandler).

### ToggleUpvoteHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteHandler.cs:17` · Level 8 · class

- **What it is**: the command handler that applies an upvote toggle, enforces the Q&A upvote rules, and returns the fresh active-upvote count. It broadcasts nothing itself: the `question.upvote-changed` push is raised as a domain event by the aggregate and enqueued post-commit by [SessionQuestionUpvoteChangedHandler](#sessionquestionupvotechangedhandler) (`ToggleUpvoteHandler.cs:13-15`). A `sealed partial class` implementing [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) as `ICommandHandler<ToggleUpvoteCommand, Result<int>>` (`ToggleUpvoteHandler.cs:17-20`).
- **Depends on**: three primary-constructor parameters (`ToggleUpvoteHandler.cs:17-20`): [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) for repositories, `TimeProvider` (BCL) for a testable clock, and `ILogger<ToggleUpvoteHandler>`. Note what is absent: no live-channel dependency at all, neither [ILiveChannelPublisher](group-10-notifications.md#ilivechannelpublisher) nor the [ILiveChannelPublishQueue](group-22-engagement-module.md#ilivechannelpublishqueue) that its sibling [SubmitQuestionHandler](#submitquestionhandler) takes. It works with the [SessionQuestion](#sessionquestion) and [SessionQuestionUpvote](#sessionquestionupvote) aggregates and returns [Error](group-01-result-error-handling.md#error) failures through [Result](group-01-result-error-handling.md#result).
- **Concept introduced**: the **soft-delete and reactivate toggle behind a filtered unique index**, called the BR-135 dance in the summary (`ToggleUpvoteHandler.cs:10-12`). A user may hold at most one *active* upvote per question. Un-upvoting soft-deletes the row instead of hard-deleting it, and a later re-upvote reactivates that same row rather than inserting a duplicate the unique index would reject. That is why the load uses the repository's resurrection read, `FindIncludingDeletedAsync`, which returns the matching rows already partitioned into active and soft-deleted in one round trip (`:55-58`, contract at `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:215-219`). `[Rubric §8, Data Architecture]` assesses soft-delete discipline and uniqueness; reactivation plus the filtered index keep at most one live vote without churning keys (see [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)). `[Rubric §12, Performance and Scalability]` assesses hot-path write cost; upvotes never touch the question row, so a popular question does not serialize its voters behind one rowversion.
- **Walkthrough**: load the question untracked by id (`ToggleUpvoteHandler.cs:27-32`) and fail with `Error.NotFound` when missing (`:34-38`). Enforce BR-235's self-upvote ban by comparing `question.UserId` with the caller, returning `Error.Invariant` code `SessionQuestionUpvote.OwnQuestion` (`:40-48`). Take the upvote repository (`:50`) and run the resurrection read for `(question, user)` **with tracking** so a reactivation actually saves (`:55-58`), then pick the first of each partition (`:59-60`). Branch on intent (`:62-64`): `ApplyUpvoteAsync` for `Upvote == true`, `RemoveUpvote` otherwise, propagating any failure (`:65-66`). `ApplyUpvoteAsync` (`:127-159`) returns a no-op success when an active row already exists (`:135-138`), otherwise checks BR-237 through the aggregate's `question.CanAcceptUpvote(nowUtc)` (`:140-142`, which rejects a non-Approved question or one past its snapshotted `LiveWindowEndUtc`, `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestion.cs:201-222`), then either `Reactivate()`s the soft-deleted row (`:144-150`) or creates and adds a new one (`:152-156`). `RemoveUpvote` (`:165-176`) soft-deletes the active row via `Delete()` or no-ops (`:167-170`). Only when something actually changed (`:68-69`) does the upvote-on path re-check eligibility (`:73-78`) and then `SaveChangesAsync` and log (`:80-82`); removing an upvote deliberately skips the re-check so a voter can still withdraw after a dismissal or after the window closes (`:71-72`). Finally the handler recomputes the count with `CountAsync` filtered on `SessionQuestionId` alone (`:85-87`), relying on the global soft-delete query filter to exclude withdrawn votes, and returns `Result.Success(upvoteCount)` (`:93`).
- **Why it's built this way**: `RecheckQuestionAcceptsUpvoteAsync` (`:106-120`) exists because of a race a rowversion cannot catch, and the doc comment says so precisely (`:96-105`): the upvote only inserts or updates a `SessionQuestionUpvote` row and never touches the question row, so the question's concurrency token is never part of this unit of work. A moderator's dismissal committing between the first eligibility check and the save would otherwise slip through, so the handler re-reads the question fresh immediately before saving. A millisecond residue remains and is explicitly accepted (`:101-104`): such an upvote is indistinguishable from one cast just before the dismissal. Publishing was moved out of this handler for two reasons recorded at `:89-92`: it awaited a gRPC call on the request path, and it could announce an upvote that a later rollback discards. `TimeProvider` injection makes the live-window check deterministic under test. See [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) for the live-channel transport the downstream event uses.
- **Where it's used**: dispatched by [SessionQuestionsController](#sessionquestionscontroller) when an attendee taps upvote; the returned `int` updates the caller's own UI immediately, while the post-commit [SessionQuestionUpvoteChanged](#sessionquestionupvotechanged) domain event carries the count-only broadcast to everyone else.
- **Caveats / not-in-source**: the filtered unique index that makes the reactivate path necessary is declared in the EF configuration, not in this handler.

### GetModerationQueueHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetModerationQueue` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetModerationQueue/GetModerationQueueHandler.cs:19` · Level 9 · class

- **What it is**: the query handler behind the moderation queue. It returns a session's questions in every status, Pending first, to organizers, admins, and the session's assigned speakers (BR-236). A `sealed class` implementing [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) as `IQueryHandler<GetModerationQueueQuery, Result<IReadOnlyList<SessionQuestionDTO>>>` (`GetModerationQueueHandler.cs:19-23`).
- **Depends on**: four primary-constructor parameters (`GetModerationQueueHandler.cs:19-23`): [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork), [IQueryableExecutor](group-07-persistence-ef-core.md#iqueryableexecutor) (the abstraction that keeps the EF Core `ToListAsync` extension out of the Application layer), [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) (the Conference cross-module contract), and [SessionQuestionViewBuilder](#sessionquestionviewbuilder). It also uses the module-internal [LivePollAuthorization](#livepollauthorization) helper and projects to [SessionQuestionDTO](#sessionquestiondto).
- **Concept introduced**: **authorization that depends on data another service owns.** Engagement cannot answer "is this caller a speaker on this session" by itself: the speaker assignment lives in Conference. So the handler first fetches [SessionLiveInfo](group-17-conference-domain.md#sessionliveinfo) over the cross-module contract (`GetModerationQueueHandler.cs:33`) and then hands the caller's claims plus that remote fact to `LivePollAuthorization.EnsureCanManage` (`:37-38`), which passes organizers and admins outright and otherwise requires the caller's speaker id to appear in `sessionInfo.SpeakerIds` (`MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollAuthorization.cs:28-38`), failing with `Error.Forbidden` code `LivePoll.NotAuthorized` (`:40-43`). Sharing that helper with the live-poll use cases means one BR-236 rule, one implementation. `[Rubric §7, Microservices Readiness]` assesses whether modules respect ownership across a process boundary; the speaker list is fetched, never joined (see [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)). `[Rubric §11, Security]` assesses authorization placement; the check runs in the application layer before any data is read, so a forbidden caller never sees a row.
- **Walkthrough**: fetch the session's live facts and short-circuit on failure (`GetModerationQueueHandler.cs:33-35`), which also enforces the Conference-owned session eligibility rules. Run the rights check and short-circuit on failure (`:37-40`). Take the question repository (`:42`) and compose an untracked query filtered to the session, ordered by `Status` then `Id`, capped at `MaxReturnedQuestions` (`:43-49`); the cap is a public `const int` of 200 (`:26`), a server-side bound so a flooded session cannot return an unbounded payload. Build DTOs through the shared view builder with `callerUserId: null` (`:51`), because `MyUpvote` and `IsMine` are not meaningful in a moderation view (`:16-17`), and the builder skips the caller-scoped upvote query entirely when the caller is null (`MMCA.ADC.Engagement.Application/SessionQuestions/Services/SessionQuestionViewBuilder.cs:51-58`). Re-sort the DTOs by `Status` then `Id` (`:53-54`) so the queue reads Pending, Approved, Dismissed in [QuestionStatus](#questionstatus) declaration order, and return them (`:56`).
- **Why it's built this way**: the ordering rides the enum's numeric values rather than a hand-written comparator, which is why the enum's member order is load-bearing and documented as such (`MMCA.ADC.Engagement.Shared/SessionQuestions/QuestionStatus.cs:8-18`). The re-sort after building is what makes the final order stable against the order the builder returns, since the builder preserves input order rather than imposing one.
- **Where it's used**: dispatched from `GET /SessionQuestions/moderation` in [SessionQuestionsController](#sessionquestionscontroller) for [GetModerationQueueQuery](#getmoderationqueuequery); the moderator UI turns the result into the approve, dismiss, and answered actions handled by [ModerateQuestionHandler](#moderatequestionhandler).
- **Caveats / not-in-source**: the query orders and caps in the database but does not paginate; a session with more than 200 questions silently returns the first 200 by status and id.

### GetSessionQuestionsHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetSessionQuestions` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetSessionQuestions/GetSessionQuestionsHandler.cs:26` · Level 9 · class

- **What it is**: the query handler for the attendee view of a session's questions: every Approved question, most upvoted first, followed by the caller's own non-approved ones. A `sealed class` implementing [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) as `IQueryHandler<GetSessionQuestionsQuery, Result<IReadOnlyList<SessionQuestionDTO>>>` (`GetSessionQuestionsHandler.cs:26-29`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork), [IQueryableExecutor](group-07-persistence-ef-core.md#iqueryableexecutor), and [SessionQuestionViewBuilder](#sessionquestionviewbuilder) (`GetSessionQuestionsHandler.cs:26-29`). It reads the [SessionQuestion](#sessionquestion) and [SessionQuestionUpvote](#sessionquestionupvote) tables and returns [SessionQuestionDTO](#sessionquestiondto) rows, filtering on [QuestionStatus](#questionstatus).
- **Concept introduced**: **two separate server-side budgets instead of one shared cap**, and **ranking in the database before the cap applies**. Both are defended in the class summary (`GetSessionQuestionsHandler.cs:17-24`). The read returns at most `MaxReturnedQuestions` Approved questions (a `const int` of 200, `:32`) plus at most `MaxReturnedOwnQuestions` of the caller's own non-approved ones (a `const int` of 25, `:35`). A single shared budget filled by oldest id would let a flood of low-value questions push both the most upvoted question and the caller's own newest submission out of the payload. The ranking is a correlated `COUNT` subquery over the upvote table (`:55`) rather than a navigation, because [SessionQuestion](#sessionquestion) and [SessionQuestionUpvote](#sessionquestionupvote) are deliberately separate aggregates with no navigation between them; the comment notes the subquery seeks the `SessionQuestionId` index and that the global soft-delete filter keeps withdrawn upvotes out of the count without an explicit predicate (`:45-50`). `[Rubric §12, Performance and Scalability]` assesses whether a hot read stays bounded and pushes work to the database; ordering and capping both happen in SQL, so a plenum session cannot materialize an unbounded set. `[Rubric §11, Security]` assesses data scoping; other users' Pending and Dismissed rows are excluded by the predicate itself.
- **Walkthrough**: take a tracked-capable repository for questions and a read repository for upvotes (`GetSessionQuestionsHandler.cs:42-43`). Capture `upvotes = upvoteRepo.TableNoTracking` (`:51`) and compose the Approved read: filter by session and `QuestionStatus.Approved`, order by the correlated upvote count descending with `Id` as the tiebreak, take 200 (`:52-58`). Compose the caller's own read separately: same session, `UserId == query.UserId`, `Status != QuestionStatus.Approved`, newest first by descending `Id`, take 25 (`:64-69`). Excluding Approved there is load-bearing and the comment says why (`:60-63`): the first read already returned the caller's approved questions, so without the filter they would come back twice. Flip the caller's slice back to ascending id (`:73`) because the panel renders a user's own submissions oldest first. Build the DTOs for both slices in one call, passing the caller id so `MyUpvote` and `IsMine` resolve (`:75`). Compose the final list with a collection expression (`:80-84`): the leading `approved.Count` DTOs re-sorted by `UpvoteCount` then `Id`, then the caller's own slice unchanged. Return `Result.Success(ordered)` (`:86`).
- **Why it's built this way**: the re-sort at `:82` is not redundant with the database order. The view builder computes the counts it returns, and re-sorting on those computed values keeps the presented order tie-stable against the numbers the user actually sees (`:77-79`). Splitting the two reads is also what lets each carry its own `ORDER BY`: one by popularity, one by recency, which no single query could do.
- **Where it's used**: dispatched from `GET /SessionQuestions` in [SessionQuestionsController](#sessionquestionscontroller) for [GetSessionQuestionsQuery](#getsessionquestionsquery), behind the session live Q&A panel; the same DTO shape is refreshed live by the [SessionQuestionChannel](#sessionquestionchannel) events.

### SubmitQuestionHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:25` · Level 9 · class

- **What it is**: the command handler that creates a question against a live session, honoring the event's moderation default, then enqueues the live broadcast best-effort. A `sealed partial class` implementing [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) as `ICommandHandler<SubmitQuestionCommand, Result<SessionQuestionDTO>>` (`SubmitQuestionHandler.cs:25-31`).
- **Depends on**: six primary-constructor parameters (`SubmitQuestionHandler.cs:25-31`): [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork); [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice), the Conference cross-module lookup; [SessionQuestionViewBuilder](#sessionquestionviewbuilder); [ILiveChannelPublishQueue](group-22-engagement-module.md#ilivechannelpublishqueue) (`:29`), the in-process queue a hosted drain later forwards to the publisher, deliberately not the publisher itself; `TimeProvider` (BCL); and `ILogger<SubmitQuestionHandler>`. It creates [SessionQuestion](#sessionquestion) aggregates, reads [QuestionModerationDefault](group-17-conference-domain.md#questionmoderationdefault) and [QuestionStatus](#questionstatus), routes through [BestEffort](group-03-querying-specifications.md#besteffort), and serializes either a [SessionQuestionApprovedPayload](#sessionquestionapprovedpayload) or a [SessionQuestionPendingCountChangedPayload](#sessionquestionpendingcountchangedpayload) into a [LiveChannelPublishWorkItem](group-22-engagement-module.md#livechannelpublishworkitem).
- **Concept introduced**: the **cross-service validation boundary in front of a write**, plus the **content versus count privacy split** on the live channel. Engagement owns neither sessions nor events, so it calls `IEventLiveValidationService.GetSessionLiveInfoAsync(...)` (`SubmitQuestionHandler.cs:41`) to learn the published flag, the live window, and the event's `QuestionModerationDefault`; that one call also enforces the Conference-owned eligibility rules BR-49 and BR-91 (`:17-18`). On the broadcast side, an auto-approved question puts its **text** on the channel while a pending one puts only a **count**, because unmoderated content must never be fanned out (BR-238, `:22-23` and `:147`). `[Rubric §7, Microservices Readiness]` assesses ownership across a boundary; Conference facts arrive as a remote query rather than a join (see [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)). `[Rubric §13, Observability and Operability]` assesses whether silent failures are visible; the broadcast runs through the shared [BestEffort](group-03-querying-specifications.md#besteffort) helper, so a failure becomes one Warning plus a `besteffort.dispatch.failed` counter increment tagged with the operation name (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/BestEffort.cs:65-71`) instead of only a log line.
- **Walkthrough**: fetch the session's live facts and short-circuit on failure (`SubmitQuestionHandler.cs:41-43`), then unwrap it (`:45`). Reject an unpublished event with `Error.Invariant` code `SessionQuestion.EventNotPublished` (`:47-54`). Snapshot `nowUtc` from `timeProvider` (`:56`) and reject a submission outside the half-open window `[LiveWindowStartUtc, LiveWindowEndUtc)` with code `SessionQuestion.OutsideLiveWindow` (`:57-64`). Enforce the anti-spam cap: count the caller's non-Dismissed questions for this session (`:73-75`) and reject at `SessionQuestionInvariants.MaxOpenQuestionsPerUserPerSession`, which is 10 (`:76-83`, constant at `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionInvariants.cs:22`), with code `SessionQuestion.OpenQuestionLimitReached`. The comment above it is candid that this is a **soft** cap (`:66-71`): the count and the insert are not one atomic step, so parallel submits from the same user can each read a count under the cap and briefly exceed it; that is accepted over holding a transaction across the cross-service live-window lookup, and moderation drains the overflow. Derive the initial status from the event's moderation default, `Approved` when `QuestionModerationDefault.Approved` and `Pending` otherwise (BR-233, `:86-88`). Create the aggregate through `SessionQuestion.Create(...)`, passing the session, `sessionInfo.EventId`, the author, the text, the initial status, and the snapshotted `LiveWindowEndUtc` (`:90-96`); snapshotting the window end onto the row is BR-237 and is what later lets [ToggleUpvoteHandler](#toggleupvotehandler) check the window without another remote call. Add and save (`:101-103`), log through the source-generated message (`:105`), enqueue the broadcast (`:107`), then build and return the DTO for the author's own view (`:109-111`). `EnqueueSubmittedAsync` (`:130-160`) wraps everything in `BestEffort.ExecuteAsync` with the low-cardinality operation name `session-question-submit-broadcast` (`:34`, `:131`), derives the channel key from `LivePollChannel.ForSession(...)` so questions and polls share one session channel (`:133`), and branches: Approved serializes a [SessionQuestionApprovedPayload](#sessionquestionapprovedpayload) with the question text onto `SessionQuestionChannel.QuestionApproved` (`:135-144`), Pending re-reads the fresh Pending count and serializes a count-only [SessionQuestionPendingCountChangedPayload](#sessionquestionpendingcountchangedpayload) onto `SessionQuestionChannel.QuestionPendingCountChanged` (`:146-159`). Both call `liveChannelPublishQueue.Enqueue(...)` with a [LiveChannelPublishWorkItem](group-22-engagement-module.md#livechannelpublishworkitem) rather than awaiting a publish.
- **Why it's built this way**: reading the moderation default from Conference at submit time keeps the auto-approve policy owned by the event instead of duplicated in Engagement. Enqueueing rather than awaiting the gRPC publish keeps a hung Notification peer off the submit's latency path (`:115-116`), which is the queueing model [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) describes. Two details in the `BestEffort` call are deliberate and documented (`:119-128`): the caller's cancellation token is **not** passed, because the question is already committed and the broadcast must outlive an abandoned request rather than turn a saved question into a cancelled one; and the cost of using the generic helper is that the warning does not carry the question id, which sits one line above in `LogQuestionSubmitted`. Inside the guarded block, `Enqueue` is a synchronous call, so the only thing that can realistically fail is the Pending branch's fresh-count read, and that read must never fail a question that has already committed (`:117-118`).
- **Where it's used**: dispatched from `POST /SessionQuestions` in [SessionQuestionsController](#sessionquestionscontroller) for [SubmitQuestionCommand](#submitquestioncommand); the returned [SessionQuestionDTO](#sessionquestiondto) renders the author's own row immediately, while the queued channel event updates every other connected attendee or moderator.
- **Caveats / not-in-source**: the eligibility rules behind `GetSessionLiveInfoAsync` (BR-49 and BR-91) are implemented in the Conference service and its gRPC adapter, not here; and the drain that turns a queued work item into an actual channel push lives in the Engagement module composition, not in this handler.

### CastVoteRequest
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LivePolls/CastVoteRequest.cs:8` · Level 0 · record

- **What it is**: the request body for casting (or changing) a vote on an open live poll. It carries exactly one field, the chosen option.
- **Depends on**: the `LivePollOptionIdentifierType` alias (`= int`, `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/MMCA.ADC.Engagement.GlobalUsings.IdentifierType.cs:5`); no first-party types.
- **Concept, identity-from-token, not from body.** `[Rubric §11, Security]` (assesses that a caller cannot act as another principal). The most important thing about this DTO is what it deliberately *omits*: there is no `UserId`. The doc comment (`CastVoteRequest.cs:3-6`) states the rule the [`CastVoteHandler`](#castvotehandler) enforces, the voting user is taken from the caller's token server-side, so a request can never cast a vote on behalf of another user. This is the same "bind identity from [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), never from the request" convention the whole live layer follows (see the overview). `[Rubric §9, API & Contract Design]` (small, intention-revealing contracts): the request models only the one decision the client actually owns.
- **Walkthrough**: a single member, `required LivePollOptionIdentifierType OptionId { get; init; }` (`CastVoteRequest.cs:11`). `required` forces the client to supply it; `init` makes it immutable once bound. The doc note (`CastVoteRequest.cs:10`) records the server-side invariant that `OptionId` must belong to the poll (BR-226), checked in the handler, not here.
- **Why it's built this way**: keeping the request to one field means the vote endpoint cannot be spoofed with a foreign user id and cannot smuggle option text; the option is referenced by id so the poll's authored options are the only valid targets.
- **Where it's used**: the body of the cast-vote endpoint on [`LivePollsController`](#livepollscontroller), mapped into the command handled by [`CastVoteHandler`](#castvotehandler).

### CreateLivePollRequest
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LivePolls/CreateLivePollRequest.cs:6` · Level 0 · record

- **What it is**: the request body for authoring a new live poll, which is always created in the `Draft` state (BR-221/BR-222).
- **Depends on**: the `EventIdentifierType` and `SessionIdentifierType` aliases (both `= int`, defined in the Conference module and linked solution-wide, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:7,14`); BCL `IReadOnlyList<string>`.
- **Concept, request DTO carrying only client-owned authoring data.** `[Rubric §9, API & Contract Design]` (assesses request contracts that mirror the business operation and defer validation). Every field maps to a decision the poll author actually makes: which event, an optional session scope, the question, and the answer option texts. The field-level constraints are documented as business rules but are *not* enforced by the record itself, they are checked downstream by the FluentValidation validator and by [`LivePollInvariants`](#livepollinvariants) inside `LivePoll.Create`, so an invalid request fails with Problem Details rather than being unconstructable at the DTO level.
- **Walkthrough**: four members.
  - `required EventIdentifierType EventId` (`CreateLivePollRequest.cs:9`): the owning event, which must be published (BR-222).
  - `SessionIdentifierType? SessionId` (`CreateLivePollRequest.cs:12`): optional session scope; `null` means an event-wide poll, and the doc note records that Wave 1 is always `null` (BR-230).
  - `required string Question` (`CreateLivePollRequest.cs:15`): the poll question (1 to 200 characters, BR-220).
  - `required IReadOnlyList<string> Options` (`CreateLivePollRequest.cs:18`): the answer texts in display order (2 to 10 options, each 1 to 100 characters, unique, BR-220).
- **Why it's built this way**: options arrive as a plain string list (not pre-built option DTOs) because the poll owns option identity, the aggregate assigns ids and sort order when [`LivePoll`](#livepoll) materializes its [`LivePollOption`](#livepolloption) children. Modelling the request as raw texts keeps the client from inventing ids.
- **Where it's used**: the body of the create endpoint on [`LivePollsController`](#livepollscontroller), mapped into the command handled by [`CreateLivePollHandler`](#createlivepollhandler).

### LivePollChannel
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LivePolls/LivePollChannel.cs:11` · Level 0 · class (static)

- **What it is**: the shared contract for the live-poll push channel, the event-name string constants that ride the SignalR channel plus the helpers that build a channel key from an event or session id. It is the one vocabulary both the publisher (Engagement handlers) and the subscriber (the Blazor UI) agree on.
- **Depends on**: BCL only (`System.Globalization`); it references the payload records [`LivePollOpenedPayload`](#livepollopenedpayload), [`LivePollClosedPayload`](#livepollclosedpayload), and [`LivePollResultsDTO`](#livepollresultsdto) in its doc comments as the shapes each event carries.
- **Concept introduced, the channel-key + event-name contract.** `[Rubric §7, Microservices Readiness]` (assesses shared contracts that let independently deployed parts agree without shared code paths) and `[Rubric §6, CQRS & Event-Driven]` (assesses a well-named event vocabulary). The ephemeral push mechanism itself is taught in this chapter's overview and framed by [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html); this class is where the *names* live. A publisher calls `ILiveChannelPublisher.PublishAsync(channelKey, eventName, payloadJson)` and a subscriber matches on the same `eventName`, so if the two ends disagree on a string the broadcast silently no-ops. Putting the strings in one shared type is the single source of truth that prevents that drift. `[Rubric §16, Maintainability]`: rename an event once, here, and both ends move together. `[Rubric §27, i18n]`: the key builders format with `CultureInfo.InvariantCulture` so a channel key is byte-identical regardless of the server's locale (a locale-formatted integer would break the key match).
- **Walkthrough**
  - Three event-name constants, all `public const string`: `PollOpened = "poll.opened"` (`LivePollChannel.cs:14`), `PollClosed = "poll.closed"` (`LivePollChannel.cs:17`), and `PollResultsChanged = "poll.results-changed"` (`LivePollChannel.cs:20`). Each doc comment names the payload record it carries and, for `PollResultsChanged`, records the rule that its [`LivePollResultsDTO`](#livepollresultsdto) payload has `MyVoteOptionId` null (no per-user data on a broadcast).
  - `ForEvent(EventIdentifierType eventId)` (`LivePollChannel.cs:24`): builds the event-wide key `event:{id}` via `string.Create(CultureInfo.InvariantCulture, ...)`.
  - `ForSession(SessionIdentifierType sessionId)` (`LivePollChannel.cs:29`): builds the session-scoped key `session:{id}` the same way (Wave 2 scope).
- **Why it's built this way**: the keys deliberately match MMCA.Common's default `PushNotificationSettings.ChannelKeyPattern` (`^(event|session):[0-9]+$`, quoted in the class doc comment, `LivePollChannel.cs:9`), so the framework hub accepts these joins without ADC-specific configuration (see [`PushNotificationSettings`](group-14-module-system-composition.md#pushnotificationsettings)). A `static` class of `const` strings has no state and no DI cost, so any layer, transport edge, or the browser client can reference it freely.
- **Where it's used**: the poll command handlers resolve a key with `ForEvent`/`ForSession` and enqueue a work item carrying it under these event names; the hosted drain (`LiveChannelPublishProcessor`) is what calls `ILiveChannelPublisher`, off the request path. The Blazor live surfaces join the same key and switch on the same names to decide patch-in-place versus reload.

### LivePollClosedPayload
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LivePolls/LivePollClosedPayload.cs:8` · Level 0 · record

- **What it is**: the broadcast payload for the [`LivePollChannel.PollClosed`](#livepollchannel) channel event, a minimal record naming the poll that closed and the event it belongs to.
- **Depends on**: the `LivePollIdentifierType` and `EventIdentifierType` aliases; no first-party types.
- **Concept, ephemeral broadcast payload carrying only a hint.** `[Rubric §6, CQRS & Event-Driven]` (assesses events that carry just enough context to act on). A close is a structural event, so the payload holds no tally, just the two ids a subscriber needs to reload the affected poll. This is the "channel event as a cache-invalidation hint over fetchable state" rule ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)): the payload is a nudge, and the fresh closed state comes from the next fetch.
- **Walkthrough**: a positional `sealed record` with two members, `LivePollIdentifierType PollId` and `EventIdentifierType EventId` (`LivePollClosedPayload.cs:8-10`). Positional records give compiler-generated construction, equality, and JSON round-trip for free.
- **Why it's built this way**: a close needs no per-user framing and no counts, so the payload is the smallest thing that identifies which card to reload. `sealed` keeps the wire shape closed to subclassing.
- **Where it's used**: serialized to JSON and published by the close-poll handler ([`CloseLivePollHandler`](#closelivepollhandler)); consumed by the live surfaces to trigger a targeted reload of the poll.

### LivePollOpenedPayload
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LivePolls/LivePollOpenedPayload.cs:10` · Level 0 · record

- **What it is**: the broadcast payload for the [`LivePollChannel.PollOpened`](#livepollchannel) channel event. Like its closed sibling it is a small positional record, but it additionally carries the question text for an immediate preview.
- **Depends on**: the `LivePollIdentifierType` and `EventIdentifierType` aliases; no first-party types.
- **Concept, universally-visible-only broadcast data.** `[Rubric §11, Security]` (assesses that broadcasts leak no privileged or per-user data). The doc comment (`LivePollOpenedPayload.cs:5`) states the constraint directly: the payload carries only universally visible data (BR-229/[ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)). The question is safe to broadcast because an open poll is public to everyone in the room; there is nothing per-user here to strip.
- **Walkthrough**: a positional `sealed record` with three members (`LivePollOpenedPayload.cs:10-13`), `LivePollIdentifierType PollId`, `EventIdentifierType EventId`, and `string Question`. The question rides along (unlike the close payload) so a client can render a snackbar or preview card without a follow-up fetch, per the member doc (`LivePollOpenedPayload.cs:9`).
- **Why it's built this way**: an open is worth surfacing instantly ("a new poll just went live"), so the one universally visible field that makes the notification useful, the question, travels with the event, while everything per-user (the caller's own vote) is deliberately absent.
- **Where it's used**: serialized and published by the open-poll handler ([`OpenLivePollHandler`](#openlivepollhandler)); consumed by the live surfaces to announce and reload the newly opened poll.

### LivePollOptionDTO
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LivePolls/LivePollOptionDTO.cs:6` · Level 0 · record

- **What it is**: the read-side representation of a single answer option of a live poll: its id, display text, and sort order.
- **Depends on**: the `LivePollOptionIdentifierType` alias; no first-party types.
- **Concept, the read DTO (the query-side counterpart of the domain entity).** `[Rubric §9, API & Contract Design]` (assesses stable read contracts distinct from the domain model). This is the wire shape of a [`LivePollOption`](#livepolloption), it exposes only what a client renders and hides domain internals like the poll back-reference or audit fields. `required`/`init` give it immutability once mapped.
- **Walkthrough**: three members, `required LivePollOptionIdentifierType Id` (`LivePollOptionDTO.cs:9`), `required string Text` (`LivePollOptionDTO.cs:12`), and `int Sort` (`LivePollOptionDTO.cs:15`) for display order. `Sort` is a plain (non-`required`) value, defaulting to 0.
- **Why it's built this way**: options are authored data (they carry no live tally), so this DTO stays purely descriptive; the running counts live in the separate [`LivePollOptionResultDTO`](#livepolloptionresultdto). Splitting "what the option is" from "how many votes it has" keeps the authoring view and the results view independent.
- **Where it's used**: nested in [`LivePollDTO.Options`](#livepolldto); produced by the [`LivePollDTOMapper`](#livepolldtomapper) and hydrated by the [`LivePollNavigationPopulator`](#livepollnavigationpopulator).

### LivePollOptionResultDTO
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LivePolls/LivePollOptionResultDTO.cs:6` · Level 0 · record

- **What it is**: the per-option vote tally that sits inside a [`LivePollResultsDTO`](#livepollresultsdto): the option, its text, and its active vote count.
- **Depends on**: the `LivePollOptionIdentifierType` alias; no first-party types.
- **Concept, the results projection.** `[Rubric §6, CQRS & Event-Driven]` (assesses shaped read models for a specific view). Where [`LivePollOptionDTO`](#livepolloptiondto) describes the option, this record describes the *outcome*: it repeats the id and text (so a results card can render standalone) and adds `VoteCount`. It is a computed projection, not a stored row.
- **Walkthrough**: three members, `required LivePollOptionIdentifierType OptionId` (`LivePollOptionResultDTO.cs:9`), `required string Text` (`LivePollOptionResultDTO.cs:12`), and `int VoteCount` (`LivePollOptionResultDTO.cs:15`), the number of *active* votes (soft-deleted votes are excluded).
- **Why it's built this way**: carrying the text inline means the `poll.results-changed` broadcast payload is self-contained, a late-joining client can draw the whole bar chart from the results payload alone without first fetching the option list.
- **Where it's used**: the `Options` collection of [`LivePollResultsDTO`](#livepollresultsdto); computed by the [`LivePollResultsBuilder`](#livepollresultsbuilder).

### LivePollStatus
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LivePolls/LivePollStatus.cs:7` · Level 0 · enum

- **What it is**: the lifecycle status of a [`LivePoll`](#livepoll): `Draft`, `Open`, or `Closed`.
- **Depends on**: nothing first-party.
- **Concept, the lifecycle enum as ubiquitous language.** `[Rubric §4, DDD]` (assesses a model that mirrors the business, including named state). The doc comment (`LivePollStatus.cs:4-5`) pins the state machine: transitions are strictly `Draft` to `Open` to `Closed`, with **no reopen** (BR-221). The enum is only the vocabulary; the transition guards live on the [`LivePoll`](#livepoll) aggregate's `Open`/`Close` methods, which is where an illegal move is actually rejected. Because this enum crosses the wire on [`LivePollDTO`](#livepolldto) and [`LivePollResultsDTO`](#livepollresultsdto), it is also a small `[Rubric §9, API & Contract Design]` contract.
- **Walkthrough**: three explicitly numbered members, `Draft = 0` (`LivePollStatus.cs:10`), `Open = 1` (`LivePollStatus.cs:13`), `Closed = 2` (`LivePollStatus.cs:16`). The member docs record the behavior tied to each: `Draft` and `Closed` reject votes, `Open` accepts them only while inside the event's live window (BR-224).
- **Why it's built this way**: explicit numeric values make the enum stable across JSON serialization (reordering the members will not silently change the wire meaning), and `Draft = 0` makes the default value the safe, non-visible state.
- **Where it's used**: the `Status` field of [`LivePollDTO`](#livepolldto) and [`LivePollResultsDTO`](#livepollresultsdto); set and guarded by the [`LivePoll`](#livepoll) aggregate.

### LivePollDTO
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LivePolls/LivePollDTO.cs:8` · Level 1 · record

- **What it is**: the read-side representation of a whole live poll, including its answer options. It is what the authoring and management views render.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (implemented, `LivePollDTO.cs:8`, via `MMCA.Common.Shared.DTOs`), [`LivePollStatus`](#livepollstatus), [`LivePollOptionDTO`](#livepolloptiondto), and the `LivePollIdentifierType`/`EventIdentifierType`/`SessionIdentifierType` aliases.
- **Concept, the identified DTO.** `[Rubric §9, API & Contract Design]` (assesses read contracts with a stable identity). By implementing [`IBaseDTO<LivePollIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (the DTO counterpart of the entity's identity contract) the record slots into the generic entity-query and mapping machinery that keys results by `Id`. Unlike the results DTO, this shape is descriptive (the authored poll) rather than computed (the tally).
- **Walkthrough**: seven members. `required LivePollIdentifierType Id` (`LivePollDTO.cs:11`, the `IBaseDTO` key); `required EventIdentifierType EventId` (`LivePollDTO.cs:14`); `SessionIdentifierType? SessionId` (`LivePollDTO.cs:17`, null for an event-wide poll); `required string Question` (`LivePollDTO.cs:20`); `LivePollStatus Status` (`LivePollDTO.cs:23`); `DateTime CreatedOn` (`LivePollDTO.cs:26`); and `IReadOnlyCollection<LivePollOptionDTO> Options` (`LivePollDTO.cs:29`), defaulted to an empty collection `[]` so the property is never null before the populator fills it.
- **Why it's built this way**: `Options` defaults to `[]` because the generic query-service path materializes the poll without EF `.Include()`, and the [`LivePollNavigationPopulator`](#livepollnavigationpopulator) loads the children afterward ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)); an empty-collection default keeps a not-yet-populated poll safe to render. Mapping from the [`LivePoll`](#livepoll) entity is a compile-time Mapperly mapper ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)).
- **Where it's used**: returned by the poll read endpoints on [`LivePollsController`](#livepollscontroller); produced by [`LivePollDTOMapper`](#livepolldtomapper) and hydrated by [`LivePollNavigationPopulator`](#livepollnavigationpopulator).

### LivePollResultsDTO
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LivePolls/LivePollResultsDTO.cs:8` · Level 1 · record

- **What it is**: the live tally for a poll, the question, status, total and per-option vote counts, and (for the requesting user only) which option they voted for. It does double duty as both a query response and the `poll.results-changed` broadcast payload.
- **Depends on**: [`LivePollStatus`](#livepollstatus), [`LivePollOptionResultDTO`](#livepolloptionresultdto), and the `LivePollIdentifierType`/`LivePollOptionIdentifierType` aliases; no external NuGet types.
- **Concept, one shape, two audiences, one security rule.** `[Rubric §11, Security]` (assesses that per-user data never leaks to a broadcast) and `[Rubric §12, Performance & Scalability]` (assesses reusing a self-contained payload to avoid refetches). The doc comment (`LivePollResultsDTO.cs:3-7`) records the dual role: when this DTO is returned to one caller it includes their `MyVoteOptionId`; when it is broadcast on the channel that field is forced to `null`, because broadcast payloads must never contain per-user data (BR-229/[ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)). The nulling is done by the handler ([`CastVoteHandler`](#castvotehandler) publishes `results with { MyVoteOptionId = null }`), not by this record, but the contract is documented here so both ends honor it. Because the payload is self-contained (question, status, all counts), a client can patch its tally in place from the broadcast alone, no follow-up fetch, which is the overview's patch-in-place performance win.
- **Walkthrough**: six members. `required LivePollIdentifierType PollId` (`LivePollResultsDTO.cs:11`); `required string Question` (`LivePollResultsDTO.cs:14`, repeated so a card can render from results alone); `LivePollStatus Status` (`LivePollResultsDTO.cs:17`); `int TotalVotes` (`LivePollResultsDTO.cs:20`, the sum of active votes); `IReadOnlyCollection<LivePollOptionResultDTO> Options` (`LivePollResultsDTO.cs:23`, defaulted to `[]`); and the nullable `LivePollOptionIdentifierType? MyVoteOptionId` (`LivePollResultsDTO.cs:29`), which is null when the caller has not voted or when the DTO is a broadcast payload.
- **Why it's built this way**: making `MyVoteOptionId` nullable lets the exact same type serve both the personalized query response and the anonymized broadcast, so there is only one results shape to build and one to consume; the difference is a single nulled field rather than a second DTO. Repeating `Question` and each option's `Text` inline is what makes the broadcast self-sufficient for a late joiner.
- **Where it's used**: returned by the results query endpoint on [`LivePollsController`](#livepollscontroller) and published (with `MyVoteOptionId` nulled) as the [`LivePollChannel.PollResultsChanged`](#livepollchannel) payload; computed by [`LivePollResultsBuilder`](#livepollresultsbuilder).

### ISessionLiveUIService
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/ISessionLiveUIService.cs:10` · Level 0 · interface

- **What it is**: the cross-module UI extension point the Conference session-detail page uses to link to a session's Live page (session polls plus Q&A) without depending on the Engagement module at all.
- **Depends on**: the `SessionIdentifierType` alias (`= int`, defined in the Conference module and linked solution-wide); no first-party types in its own surface.
- **Concept introduced, the optional cross-module UI service.** `[Rubric §7, Microservices Readiness]` (assesses whether one module can render a link into another without a hard reference) and `[Rubric §18, UI Architecture]` (assesses feature-flagged composition of module UIs). The rule is stated in the doc comment (`ISessionLiveUIService.cs:3-9`): when the Engagement module is enabled its UI registers an implementation and the Conference session-detail page's Live button lights up; when Engagement is disabled the service is absent and the button simply does not render. Neither module references the other's UI project, the contract lives here in `Shared`, so the two can be deployed together or apart. The doc comment names the [`ISessionBookmarkUIService`](group-22-engagement-module.md#isessionbookmarkuiservice) precedent, the same optional-service idiom Engagement already uses for the bookmark button. `[Rubric §1, SOLID]`: a single-method boundary means a consumer depends only on "give me the Live path", not on how Engagement routes.
- **Walkthrough**: one method, `string GetSessionLivePath(SessionIdentifierType sessionId)` (`ISessionLiveUIService.cs:14`), which builds the route path of the session's Live page from a session id. It returns a plain route string, so the Conference page can render an anchor without knowing Engagement's route table.
- **Why it's built this way**: routing a link into another module's page through an optional service (rather than a shared route constant) keeps the modular monolith honest. The button and its target live entirely inside Engagement, and Conference stays ignorant of whether the live layer is present.
- **Where it's used**: resolved by the Conference public session-detail page, which holds it as a nullable property and fills it in `OnInitialized` with `ServiceProvider.GetService<ISessionLiveUIService>()` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionDetail.razor.cs:39,55`). The implementation is [`SessionLiveUIService`](#sessionliveuiservice), registered by the Engagement UI's DI module (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/DependencyInjection.cs:58`), and it just delegates to `EngagementRoutePaths.SessionLive` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/SessionLiveUIService.cs:13-14`).
- **Caveats / not-in-source**: the interface doc comment says the Conference UI "injects this interface as NULLABLE" (`ISessionLiveUIService.cs:5`), but the consumer does not use `[Inject]`. The comment at `PublicSessionDetail.razor.cs:34-35` records why: Blazor's `[Inject]` has no optional mode (an unregistered service throws at render), so the page resolves it through `IServiceProvider.GetService` instead. The effect is what the doc describes; the mechanism is `GetService`, not a nullable inject.

### ModerationAction
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/ModerationAction.cs:7` · Level 0 · enum

- **What it is**: the moderation action a moderator applies to a session question (BR-234): approve, dismiss, or mark answered. Each value maps to exactly one domain transition on [`SessionQuestion`](#sessionquestion).
- **Depends on**: nothing first-party.
- **Concept, the action enum as an intent contract.** `[Rubric §9, API & Contract Design]` (assesses a small, closed vocabulary crossing the wire) and `[Rubric §4, DDD]` (assesses naming that mirrors the business). This enum is the request-side counterpart to [`QuestionStatus`](#questionstatus): where `QuestionStatus` names *where the question is*, `ModerationAction` names *what the moderator asks for*. The mapping from action to transition is enforced on the [`SessionQuestion`](#sessionquestion) aggregate, not here; the enum only carries the intent.
- **Walkthrough**: three explicitly numbered members. `Approve = 0` (`ModerationAction.cs:10`), valid from Pending or Dismissed; `Dismiss = 1` (`ModerationAction.cs:13`), valid from Pending or Approved; `MarkAnswered = 2` (`ModerationAction.cs:16`), which marks an approved question answered once. The member docs pin the allowed source states for each.
- **Why it's built this way**: explicit numeric values keep the enum stable across JSON serialization (reordering members will not silently change wire meaning), and a single action enum lets one moderation endpoint accept every moderator move rather than one endpoint per transition.
- **Where it's used**: bound on the moderation request accepted by [`SessionQuestionsController`](#sessionquestionscontroller) and dispatched into the moderation command handler, which calls the matching transition method on [`SessionQuestion`](#sessionquestion).

### OptionState
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.HappeningNow` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/HappeningNow/PollManagementPanel.razor.cs:193` · Level 0 · class

- **What it is**: a tiny private, mutable holder for one poll option's text, used purely as a two-way binding target while an organizer types the options of a new poll on the Manage tab.
- **Depends on**: BCL only (a nullable `string`); no first-party types.
- **Concept, the mutable view-model row for two-way binding.** `[Rubric §19, State Management]` (assesses how transient form state is held in a component) and `[Rubric §24, Forms/Validation/UX Safety]` (assesses editable-collection form modelling). Blazor's `@bind` needs a stable reference-typed target it can write back into. A `List<string>` cannot be bound element-by-element the same way, because a list slot is not an object the binder can hold onto across re-renders. `OptionState` gives each option row its own object, so growing, shrinking, and editing `_newOptions` (`PollManagementPanel.razor.cs:54`) stays stable: the markup binds `@bind-Value="_newOptions[index].Text"` (`PollManagementPanel.razor:14`) to that per-row object. It is deliberately `private sealed` and nested inside the panel, it is not a domain concept, only a UI scratch buffer.
- **Walkthrough**: a single member, `public string? Text { get; set; }` (`PollManagementPanel.razor.cs:195`), a mutable auto-property. The class is `private sealed` (`PollManagementPanel.razor.cs:193`), so nothing outside the panel can see or reuse it.
- **Why it's built this way**: modelling the option rows as objects (not raw strings) is what lets `AddOption`/`RemoveOption` (`PollManagementPanel.razor.cs:58,66`) add and remove rows between `LivePollDTO.MinOptions` and `LivePollDTO.MaxOptions` while each `MudTextField` keeps binding to its own row. On submit the panel projects `_newOptions` back to a trimmed, non-empty `List<string>` (`PollManagementPanel.razor.cs:82-86`) for the [`CreateLivePollRequest`](#createlivepollrequest).
- **Where it's used**: only inside [`PollManagementPanel`](#pollmanagementpanel), as the element type of the `_newOptions` list backing the create-poll form.

### QuestionStatus
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/QuestionStatus.cs:8` · Level 0 · enum

- **What it is**: the moderation status of a [`SessionQuestion`](#sessionquestion): `Pending`, `Approved`, or `Dismissed`. It is the small state vocabulary the whole Q&A feature is built around.
- **Depends on**: nothing first-party.
- **Concept, the moderation state machine as ubiquitous language.** `[Rubric §4, DDD]` (assesses a model that names its states) and `[Rubric §11, Security]` (assesses visibility rules encoded in the model). The doc comments pin both the starting state and the visibility rule per state: a new question starts at the event's moderation default, Pending or Approved (BR-233, `QuestionStatus.cs:4-6`); a Pending question is visible only to its author and moderators (`QuestionStatus.cs:10`); an Approved one is visible to all attendees and open to upvotes (`QuestionStatus.cs:13`); a Dismissed one is hidden from attendees, and a re-approve brings it back (`QuestionStatus.cs:16`, BR-234). The enum is only the vocabulary; the legal transitions are guarded on the [`SessionQuestion`](#sessionquestion) aggregate and requested via [`ModerationAction`](#moderationaction).
- **Walkthrough**: three explicitly numbered members, `Pending = 0` (`QuestionStatus.cs:11`), `Approved = 1` (`QuestionStatus.cs:14`), `Dismissed = 2` (`QuestionStatus.cs:17`). `Pending = 0` makes the default value the safe, non-public state.
- **Why it's built this way**: explicit values keep the enum stable across the wire (it rides on [`SessionQuestionDTO`](#sessionquestiondto)), and pinning visibility to the status in one place means every reader (query filter, DTO, UI) agrees on who may see a question.
- **Where it's used**: the `Status` field of [`SessionQuestionDTO`](#sessionquestiondto); set and guarded by the [`SessionQuestion`](#sessionquestion) aggregate and [`SessionQuestionInvariants`](#sessionquestioninvariants); read by the moderation and read paths and by the live Q&A surfaces.

### SessionQuestionAnsweredPayload
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionAnsweredPayload.cs:8` · Level 0 · record

- **What it is**: the broadcast payload for the [`SessionQuestionChannel`](#sessionquestionchannel) `QuestionAnswered` channel event, a minimal record naming the question that was marked answered and the session it belongs to.
- **Depends on**: the `SessionQuestionIdentifierType` alias (`= int`, `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/MMCA.ADC.Engagement.GlobalUsings.IdentifierType.cs:11`) and the Conference-owned `SessionIdentifierType` alias; no first-party types.
- **Concept, the ephemeral broadcast payload as a reload hint.** `[Rubric §6, CQRS & Event-Driven]` (assesses events that carry just enough to act on). Marking-answered is a structural change, so the payload holds no question body, only the two ids a subscriber needs to locate and refresh the affected question card. This is the same "channel event as a cache-invalidation hint over fetchable state" rule the poll payloads follow (see [`LivePollClosedPayload`](#livepollclosedpayload) and [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)): the push is a nudge, the fresh state comes from the next fetch.
- **Walkthrough**: a positional `sealed record` with two members, `SessionQuestionIdentifierType QuestionId` and `SessionIdentifierType SessionId` (`SessionQuestionAnsweredPayload.cs:8-10`). The positional form gives compiler-generated construction, equality, and JSON round-trip for free.
- **Why it's built this way**: an answered mark needs no per-user framing and no content, so the payload is the smallest thing that identifies which card to update; `sealed` closes the wire shape to subclassing.
- **Where it's used**: serialized to JSON and published under [`SessionQuestionChannel.QuestionAnswered`](#sessionquestionchannel) by the mark-answered moderation path; consumed by the session Live and presenter surfaces to refresh the question.

### SessionQuestionApprovedPayload
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionApprovedPayload.cs:10` · Level 0 · record

- **What it is**: the broadcast payload for the [`SessionQuestionChannel`](#sessionquestionchannel) `QuestionApproved` channel event. Unlike its answered and dismissed siblings it additionally carries the question text, so a client can render the newly visible question immediately.
- **Depends on**: the `SessionQuestionIdentifierType` and `SessionIdentifierType` aliases; BCL `string`.
- **Concept, universally-visible-only broadcast data.** `[Rubric §11, Security]` (assesses that broadcasts leak no privileged or per-user data). The doc comment (`SessionQuestionApprovedPayload.cs:4-5`) states the constraint directly: the payload carries only universally visible data (BR-238), the approved question's content and no author identity. Approval is exactly the moment a question becomes public to the room, so its text is safe to broadcast; the author is deliberately absent because questions display anonymously (the same rule enforced on [`SessionQuestionDTO`](#sessionquestiondto)).
- **Walkthrough**: a positional `sealed record` with three members (`SessionQuestionApprovedPayload.cs:10-13`), `SessionQuestionIdentifierType QuestionId`, `SessionIdentifierType SessionId`, and `string Text`. The text rides along (unlike the answered and dismissed payloads) so an attendee's list can insert the question without a follow-up fetch (`SessionQuestionApprovedPayload.cs:9`).
- **Why it's built this way**: an approve is worth surfacing instantly, so the one universally visible field that makes the update useful, the text, travels with the event, while everything author-scoped stays off the wire.
- **Where it's used**: serialized and published under [`SessionQuestionChannel.QuestionApproved`](#sessionquestionchannel) on submit under an Approved default or on moderation; consumed by the live Q&A surfaces to add the approved question.

### SessionQuestionChannel
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionChannel.cs:12` · Level 0 · class (static)

- **What it is**: the shared contract for the session Q&A push channel, the event-name string constants that ride the SignalR channel. It is the one vocabulary both the publisher (Engagement handlers) and the subscriber (the Blazor UI) agree on for questions, and it shares the session channel key with polls.
- **Depends on**: BCL only; it references the payload records [`SessionQuestionApprovedPayload`](#sessionquestionapprovedpayload), [`SessionQuestionAnsweredPayload`](#sessionquestionansweredpayload), [`SessionQuestionDismissedPayload`](#sessionquestiondismissedpayload), [`SessionQuestionUpvoteChangedPayload`](#sessionquestionupvotechangedpayload), and [`SessionQuestionPendingCountChangedPayload`](#sessionquestionpendingcountchangedpayload) in its doc comments as the shape each event carries. The class doc points at [`LivePollChannel.ForSession`](#livepollchannel) as the source of the channel key.
- **Concept, the event-name contract that mirrors the poll channel.** `[Rubric §7, Microservices Readiness]` (assesses shared contracts that let independently deployed parts agree without shared code paths) and `[Rubric §6, CQRS & Event-Driven]` (assesses a well-named event vocabulary). The ephemeral push mechanism itself is taught in this chapter's overview and framed by [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html); this class is where the *names* live. A publisher pushes a `(channelKey, eventName, payloadJson)` triple and a subscriber matches on the same `eventName`, so if the two ends disagree on a string the broadcast silently no-ops. The doc comment (`SessionQuestionChannel.cs:6-8`) records that channel keys come from the existing [`LivePollChannel.ForSession`](#livepollchannel) helper, so questions and polls ride **one** session channel rather than two, and pins the security rule: broadcast payloads carry only universally visible data (BR-238), approved question content and counts, while pending question content never rides the channel because moderators get a count-only event instead (`SessionQuestionChannel.cs:8-10`). `[Rubric §11, Security]`: encoding "counts, not content" into the channel's contract is what keeps unmoderated text off the wire.
- **Walkthrough**: five `public const string` event names. `QuestionApproved = "question.approved"` (`SessionQuestionChannel.cs:15`), raised when a question becomes Approved on submit under an Approved default or on moderation; `QuestionAnswered = "question.answered"` (`SessionQuestionChannel.cs:18`); `QuestionDismissed = "question.dismissed"` (`SessionQuestionChannel.cs:21`); `QuestionUpvoteChanged = "question.upvote-changed"` (`SessionQuestionChannel.cs:24`), raised after an upvote toggle commits; and `QuestionPendingCountChanged = "question.pending-count-changed"` (`SessionQuestionChannel.cs:27`), a count-only moderator signal (BR-238). Each doc comment names the payload record it carries.
- **Why it's built this way**: reusing the poll channel key (rather than minting a second session channel) means an attendee on a session's Live page receives both poll and question events from one join, halving the SignalR group membership. A `static` class of `const` strings has no state and no DI cost, so any layer, transport edge, or the browser client can reference it freely; renaming an event once here moves both ends together (`[Rubric §16, Maintainability]`).
- **Where it's used**: the session-question command and domain-event handlers *enqueue* under these names onto [`ILiveChannelPublishQueue`](group-22-engagement-module.md#ilivechannelpublishqueue), and the hosted drain [`LiveChannelPublishProcessor`](group-22-engagement-module.md#livechannelpublishprocessor) is what calls [`ILiveChannelPublisher`](group-10-notifications.md#ilivechannelpublisher) off the request path; the live Q&A surfaces join the shared session key and switch on these names to decide add versus reload versus count-only refresh.

### SessionQuestionDismissedPayload
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionDismissedPayload.cs:8` · Level 0 · record

- **What it is**: the broadcast payload for the [`SessionQuestionChannel`](#sessionquestionchannel) `QuestionDismissed` channel event, structurally identical to [`SessionQuestionAnsweredPayload`](#sessionquestionansweredpayload), naming the dismissed question and its session.
- **Depends on**: the `SessionQuestionIdentifierType` and `SessionIdentifierType` aliases; no first-party types.
- **Concept**: the ephemeral reload-hint payload introduced by [`SessionQuestionAnsweredPayload`](#sessionquestionansweredpayload). A dismiss removes a question from attendees' view, so the payload carries no content, only the two ids a subscriber uses to drop the card. `[Rubric §11, Security]`: pushing no text on a dismiss means a moderator's removal never re-broadcasts the (now hidden) question body.
- **Walkthrough**: a positional `sealed record` with two members, `SessionQuestionIdentifierType QuestionId` and `SessionIdentifierType SessionId` (`SessionQuestionDismissedPayload.cs:8-10`).
- **Why it's built this way**: a dismiss is a structural event, so the smallest id-only payload is enough to tell a client which card to hide; an identical shape to the answered payload keeps the channel's payload family uniform.
- **Where it's used**: published under [`SessionQuestionChannel.QuestionDismissed`](#sessionquestionchannel) by the moderation path; consumed by the live Q&A surfaces to remove the question.

### SessionQuestionPendingCountChangedPayload
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionPendingCountChangedPayload.cs:10` · Level 0 · record

- **What it is**: the broadcast payload for the [`SessionQuestionChannel`](#sessionquestionchannel) `QuestionPendingCountChanged` channel event, a count-only signal telling moderators how many Pending questions a session now has.
- **Depends on**: the `SessionIdentifierType` alias; BCL `int`.
- **Concept, the count-only moderator broadcast.** `[Rubric §11, Security]` (assesses that unmoderated content never leaves the server). The doc comment (`SessionQuestionPendingCountChangedPayload.cs:3-6`) states the rule that shapes this record: pending question content never rides the channel (BR-238), so instead of broadcasting a new pending question's text, the server broadcasts only the fresh count. A moderator's badge updates while the actual text stays gated behind an authenticated moderator fetch. This is the deliberate asymmetry that separates it from [`SessionQuestionApprovedPayload`](#sessionquestionapprovedpayload), which does carry text because approval makes the content public.
- **Walkthrough**: a positional `sealed record` with two members (`SessionQuestionPendingCountChangedPayload.cs:10-12`), `SessionIdentifierType SessionId` and `int PendingCount`, the fresh number of Pending questions for the session. Note there is no `QuestionId`: the signal is about the queue, not a single question.
- **Why it's built this way**: broadcasting a count rather than a question keeps unmoderated (possibly abusive) text off the wire while still giving moderators a live queue badge, so the moderation UI needs no polling to know work has arrived.
- **Where it's used**: published under [`SessionQuestionChannel.QuestionPendingCountChanged`](#sessionquestionchannel) whenever the Pending set changes (a new submission under a Pending default, or a moderation move); consumed by [`SessionLiveModerationPanel`](#sessionlivemoderationpanel) and the presenter surface to update the pending badge.

### SessionQuestionUpvoteChangedPayload
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionUpvoteChangedPayload.cs:10` · Level 0 · record

- **What it is**: the broadcast payload for the [`SessionQuestionChannel`](#sessionquestionchannel) `QuestionUpvoteChanged` channel event, carrying the question, its session, and the fresh active-upvote count.
- **Depends on**: the `SessionQuestionIdentifierType` and `SessionIdentifierType` aliases; BCL `int`.
- **Concept, the counter broadcast that strips voter identity.** `[Rubric §11, Security]` (assesses that broadcasts never reveal who acted) and `[Rubric §12, Performance & Scalability]` (assesses patch-in-place over refetch). The doc comment (`SessionQuestionUpvoteChangedPayload.cs:4-5`) records the rule: the payload carries only the fresh count, never who voted (BR-238). Sending the new `UpvoteCount` inline lets each subscribed circuit patch the vote number in place without a refetch, the same burst-safe patch-in-place win the poll tallies use (see the overview and [`LivePollResultsDTO`](#livepollresultsdto)); each circuit keeps its own "did *I* upvote" marker locally because that per-user bit never rides the broadcast.
- **Walkthrough**: a positional `sealed record` with three members (`SessionQuestionUpvoteChangedPayload.cs:10-13`), `SessionQuestionIdentifierType QuestionId`, `SessionIdentifierType SessionId`, and `int UpvoteCount`, the fresh active-upvote count.
- **Why it's built this way**: broadcasting the count rather than the delta means a late joiner and an existing viewer converge on the same number without ordering assumptions, and omitting the voter id both protects privacy and keeps the payload tiny under burst voting.
- **Where it's used**: published under [`SessionQuestionChannel.QuestionUpvoteChanged`](#sessionquestionchannel) by [`SessionQuestionUpvoteChangedHandler`](#sessionquestionupvotechangedhandler) after an upvote toggle commits; consumed by the live Q&A surfaces through [`LiveBroadcastPatch`](group-22-engagement-module.md#livebroadcastpatch) to patch the upvote count in place.

### SubmitQuestionRequest
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SubmitQuestionRequest.cs:8` · Level 0 · record

- **What it is**: the request body for submitting a question to a live session (BR-231/BR-233), carrying the target session and the question text.
- **Depends on**: the `SessionIdentifierType` alias; BCL `string`.
- **Concept, identity-from-token, not from body.** `[Rubric §11, Security]` (assesses that a caller cannot act as another principal) and `[Rubric §9, API & Contract Design]` (assesses request contracts that model only client-owned data). Like [`CreateLivePollRequest`](#createlivepollrequest) and the poll `CastVoteRequest`, the most important thing about this DTO is what it deliberately omits: there is no `UserId`. The doc comment (`SubmitQuestionRequest.cs:3-6`) states the rule the handler enforces, the submitting user is taken from the caller's token server-side via [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), never from the request body, so a question cannot be submitted on behalf of another user. The field-length limit (1 to 500 characters, BR-231) is documented here but validated downstream, so an invalid request fails with Problem Details rather than being unconstructable at the DTO level.
- **Walkthrough**: two members, `required SessionIdentifierType SessionId { get; init; }` (`SubmitQuestionRequest.cs:11`), the target session, which must be live-eligible (BR-49/BR-91); and `required string Text { get; init; }` (`SubmitQuestionRequest.cs:14`), the question text. `required` forces the client to supply both; `init` makes them immutable once bound.
- **Why it's built this way**: keeping the request to the session id plus the text means the submit endpoint cannot be spoofed with a foreign user id and cannot smuggle a status: the moderation default is decided server-side from the event (BR-233), not by the client.
- **Where it's used**: the body of the submit endpoint on [`SessionQuestionsController`](#sessionquestionscontroller); mapped into the submit command handled in the Application layer, which stamps the caller as author and creates a [`SessionQuestion`](#sessionquestion).

### SessionQuestionDTO
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionDTO.cs:10` · Level 1 · record

- **What it is**: the read-side representation of a session question: its text, moderation status, answered flag, upvote count, two per-caller flags (did I upvote, is this mine), and a concurrency token. It is what every Q&A list renders.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) and [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) (both implemented, `SessionQuestionDTO.cs:10`, from `MMCA.Common.Shared.DTOs`), [`QuestionStatus`](#questionstatus), and the `SessionQuestionIdentifierType`/`SessionIdentifierType`/`EventIdentifierType` aliases.
- **Concept, the anonymized identified read DTO.** `[Rubric §9, API & Contract Design]` (assesses stable read contracts distinct from the domain model) and `[Rubric §11, Security]` (assesses deliberate omission of identity). By implementing [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (the DTO counterpart of the entity identity contract) the record slots into the generic mapping and list machinery that keys results by `Id`. The doc comment (`SessionQuestionDTO.cs:5-9`) records the deliberate design: the DTO carries **no** user-identity fields at all, because questions display anonymously; the caller is related to the question only through the two per-caller flags `MyUpvote` and `IsMine` (BR-238). Those flags are computed per request against the calling user, they are not stored on the entity.
- **Concept, the shared-layer constant as the single source of a number.** `[Rubric §16, Maintainability]`. `TextMaxLength = 500` (`SessionQuestionDTO.cs:18`) lives on the DTO, and the doc comment explains why (`SessionQuestionDTO.cs:12-17`): `Shared` is the lowest layer every consumer can reach, so the UI caps its input from here and `SessionQuestionInvariants.TextMaxLength` reads the same constant. The 500 is written once, and the client-side cap and the server-side invariant cannot drift apart.
- **Walkthrough**: one constant plus ten members.
  - `public const int TextMaxLength = 500` (`SessionQuestionDTO.cs:18`), the BR-231 text cap shared with [`SessionQuestionInvariants`](#sessionquestioninvariants).
  - `required SessionQuestionIdentifierType Id` (`SessionQuestionDTO.cs:21`), the `IBaseDTO` key.
  - `required SessionIdentifierType SessionId` (`SessionQuestionDTO.cs:24`) and `required EventIdentifierType EventId` (`SessionQuestionDTO.cs:27`), the event id denormalized at submission so the read model needs no join back to Conference.
  - `required string Text` (`SessionQuestionDTO.cs:30`), the question body.
  - `QuestionStatus Status` (`SessionQuestionDTO.cs:33`) and `bool IsAnswered` (`SessionQuestionDTO.cs:36`), the moderation state and the answered mark.
  - `int UpvoteCount` (`SessionQuestionDTO.cs:39`), the number of active upvotes.
  - `bool MyUpvote` (`SessionQuestionDTO.cs:42`) and `bool IsMine` (`SessionQuestionDTO.cs:45`), the per-caller flags: whether the calling user has an active upvote, and whether the calling user authored the question.
  - `DateTime CreatedOn` (`SessionQuestionDTO.cs:48`), when the question was submitted.
  - `byte[] RowVersion { get; init; } = []` (`SessionQuestionDTO.cs:56`), the optimistic-concurrency token that satisfies [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware). The doc comment (`SessionQuestionDTO.cs:50-55`) pins the contract: it is always present, and the client echoes it in the `If-Match` header of a moderation transition, so two moderators racing approve-versus-dismiss surface as a 412 Precondition Failed instead of the second decision silently applying ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). `[Rubric §8, Data Architecture]`: the lost-update guard is carried by the read contract, not bolted on at the controller.
- **Why it's built this way**: keeping author identity off the DTO entirely (rather than sending it and hoping the UI hides it) means an anonymous-by-design feature cannot leak an author through the wire; the only caller-relative facts, `MyUpvote`/`IsMine`, are booleans computed for the one requester, so no other attendee's relationship to the question is ever exposed. Denormalizing `EventId` keeps the read model self-contained for filtering.
- **Where it's used**: returned by the Q&A endpoints on [`SessionQuestionsController`](#sessionquestionscontroller). It is built by [`SessionQuestionViewBuilder`](#sessionquestionviewbuilder) (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/SessionQuestions/Services/SessionQuestionViewBuilder.cs:12`), which is shared by the submit, list, and moderation use cases so every surface computes the counts and per-caller flags the same way; the moderation view passes a `null` caller id, where `MyUpvote`/`IsMine` are not meaningful (`SessionQuestionViewBuilder.cs:18`). It is rendered by [`SessionLive`](#sessionlive), [`PresenterView`](#presenterview), and [`SessionLiveModerationPanel`](#sessionlivemoderationpanel), and patched in place by [`LiveBroadcastPatch`](group-22-engagement-module.md#livebroadcastpatch).

### PollManagementPanel
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.HappeningNow` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/HappeningNow/PollManagementPanel.razor.cs:20` · Level 8 · class (Blazor component)

- **What it is**: the presentational panel behind the [`HappeningNow`](#happeningnow) page's organizer-only Manage tab: the create-poll form plus the event's poll lifecycle rows (open, close, delete). It performs the poll calls itself and tells the page when to reload.
- **Depends on**: injected [`ILivePollUIService`](#ilivepolluiservice) and [`IToastService`](group-15-common-ui-framework.md#itoastservice) (`PollManagementPanel.razor.cs:22-23`); the DTOs [`LivePollDTO`](#livepolldto), [`LivePollStatus`](#livepollstatus), [`LivePollOptionDTO`](#livepolloptiondto), and [`CreateLivePollRequest`](#createlivepollrequest); `Result` and `ErrorType` from `MMCA.Common.Shared.Abstractions`; the shared `DeleteConfirmation` component from `MMCA.Common.UI.Components`; and its own nested [`OptionState`](#optionstate). It implements `IAsyncDisposable`.
- **Concept introduced, the container/presentational split in Blazor.** `[Rubric §18, UI Architecture]` (assesses component decomposition and responsibility boundaries) and `[Rubric §19, State Management]` (assesses who owns which piece of state). The class doc (`PollManagementPanel.razor.cs:11-18`) states the division precisely: the panel owns the *form* state (the typed question and option rows) and performs the poll calls, while the page owns the *lists* and reloads them through the change callbacks, and the page keeps handling the live channel events. That is the container/presentational pattern: the panel is a leaf that renders and acts, the page is the container that holds the data and decides when to refetch. Parent-owned data arrives as `[Parameter]`s and the panel never mutates them, it raises `EventCallback`s instead. `[Rubric §16, Maintainability]`: pulling the authoring UI out of the page leaves the page focused on load, channel, and voting.
- **Concept, two-way parameter binding for a shared busy flag.** The `IsSaving` / `IsSavingChanged` pair (`PollManagementPanel.razor.cs:37,41`) is Blazor's `@bind-IsSaving` convention: the page binds its own `IsSaving` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/HappeningNow/HappeningNow.razor:145`), so when the panel raises `IsSavingChanged` the *page* re-renders and every section (not just this panel) disables its actions while an action runs.
- **Walkthrough**, in teaching order:
  - **Injected services and parameters** (`PollManagementPanel.razor.cs:22-49`): `PollService` and `Toast`; then `EventId` (`:28`, `[EditorRequired]`, the event new polls are created against), `ManagePolls` (`:33`, the event's manage list in every status, owned and refreshed by the page), the `IsSaving`/`IsSavingChanged` pair (`:37,41`), and the two post-action callbacks `OnPollCreated` (`:45`) and `OnPollLifecycleChanged` (`:49`).
  - **Local state** (`PollManagementPanel.razor.cs:51-56`): a `CancellationTokenSource _cts` for disposal-safe async, the `_newQuestion` buffer, `_newOptions` seeded with two empty [`OptionState`](#optionstate) rows (`:54`, matching `LivePollDTO.MinOptions`), and a `_deleteConfirm` reference to the shared confirmation dialog wired at `PollManagementPanel.razor:85`.
  - **Option row editing** (`PollManagementPanel.razor.cs:58-72`): `AddOption` appends a row only while the count is below `LivePollDTO.MaxOptions` (`:60`); `RemoveOption` removes one only while the count is above `LivePollDTO.MinOptions` and the index is in range (`:68`). The markup mirrors the same two constants to disable the add and remove controls (`PollManagementPanel.razor:19,25`), so the client cannot even attempt a shape the server would reject (BR-220). `[Rubric §24, Forms/Validation/UX Safety]`.
  - **Create** (`PollManagementPanel.razor.cs:74-126`): guards a non-blank question and at least two non-empty options with a warning toast (`:76-91`), raises the shared saving flag, trims the option texts into a `List<string>`, builds a [`CreateLivePollRequest`](#createlivepollrequest) (`:96-101`), and on success clears the form back to two empty rows, toasts, and raises `OnPollCreated` so the page reloads the manage rows. `OperationCanceledException` is swallowed as expected-during-disposal (`:118-121`) and the saving flag is always lowered in `finally` (`:124`).
  - **Lifecycle actions** (`PollManagementPanel.razor.cs:128-144`): `OpenPollAsync` and `ClosePollAsync` are one-liners passing the poll's `RowVersion` through to the service (the `If-Match` token, [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)); `DeletePollAsync` first awaits the shared `DeleteConfirmation` dialog and returns unless the answer is `true` (`:137-141`), the same confirm-first pattern the list pages use.
  - **The shared action runner** (`PollManagementPanel.razor.cs:146-170`): `RunManageActionAsync` is one place for the raise-saving, call, report-or-toast, raise-`OnPollLifecycleChanged`, lower-saving sequence, so the three lifecycle actions cannot drift in their error and busy handling. `[Rubric §1, SOLID]`.
  - **Error surfacing** (`PollManagementPanel.razor.cs:172-181`): `ShowActionError` distinguishes a stated refusal from an unexpected fault. `result.HasErrorType(ErrorType.Unexpected)` shows the generic localized fallback, anything else shows the server's own localized Problem Details message via `result.LocalizedErrorMessage(L)` ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) Decision 9). `[Rubric §11, Security]`: a 500, a transport failure, or a timeout never leaks raw diagnostic text into the UI.
  - **Disposal** (`PollManagementPanel.razor.cs:183-190`): cancels and disposes the `_cts`, then suppresses finalization.
- **Why it's built this way**: the panel does the calls but not the reloads because the page is the one holding both poll lists; routing the refresh back through `OnPollCreated`/`OnPollLifecycleChanged` (`HappeningNow.razor:146-147`) keeps one owner per piece of state and avoids two components fetching the same list. Localization is deliberately *not* given its own resource file: the markup injects `IStringLocalizer<HappeningNow>` (`PollManagementPanel.razor:2`), following the [`SessionLiveModerationPanel`](#sessionlivemoderationpanel) precedent, so the Manage tab keeps one resource set (`PollManagementPanel.razor.cs:16-18`). `[Rubric §27, i18n]`.
- **Where it's used**: rendered inside the organizer-only Manage tab of [`HappeningNow`](#happeningnow) (`HappeningNow.razor:143-148`), which is itself gated on the page's `_isOrganizer` flag.
- **Caveats / not-in-source**: the panel has no `@page` directive and no route, it is a child component only. Its rendered layout, the MudBlazor controls, and the localization keys live in the paired `PollManagementPanel.razor` markup file, not in the code-behind.

### HappeningNow
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.HappeningNow` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/HappeningNow/HappeningNow.razor.cs:23` · Level 10 · class (Blazor page)

- **What it is**: the conference-day home page at `/happening-now`. It shows now-and-next sessions, the event's open live polls with live tallies, and (for organizers only) a poll-manage tab, and it joins the event's live channel while the event is live so poll events refresh the tallies without polling.
- **Depends on**: injected [`ILiveEventUIService`](#iliveeventuiservice), [`ILivePollUIService`](#ilivepolluiservice), [`INowNextService`](group-22-engagement-module.md#inownextservice), [`NotificationState`](group-15-common-ui-framework.md#notificationstate), [`NotificationHubService`](group-15-common-ui-framework.md#notificationhubservice), [`IToastService`](group-15-common-ui-framework.md#itoastservice), and [`IHapticFeedbackService`](group-26-device-capability-layer.md#ihapticfeedbackservice) (`HappeningNow.razor.cs:25-31`); the DTOs [`LiveEventContext`](#liveeventcontext), [`LivePollResultsDTO`](#livepollresultsdto), [`LivePollDTO`](#livepolldto), and [`NowNextSessionInfo`](group-22-engagement-module.md#nownextsessioninfo); the [`LivePollChannel`](#livepollchannel) key and event vocabulary; the UI helpers [`LiveChannelSubscription`](group-22-engagement-module.md#livechannelsubscription) and [`LiveBroadcastPatch`](group-22-engagement-module.md#livebroadcastpatch); [`RoleNames`](group-08-auth.md#rolenames) from the Common auth contracts; and the child component [`PollManagementPanel`](#pollmanagementpanel). It implements `IAsyncDisposable`.
- **Concept introduced, the live Blazor surface: prerender-safe load, then interactive channel join.** `[Rubric §18, UI Architecture]` (assesses component lifecycle and separation of load from live wiring), `[Rubric §19, State Management]`, and `[Rubric §23, Front-End Performance]`. The page splits its lifecycle in two. `OnInitializedAsync` (`HappeningNow.razor.cs:53`) does the data load: it reads the organizer flag from the cascading `AuthenticationState` via `IsInRole(RoleNames.Organizer)` (`:72`), fetches the current [`LiveEventContext`](#liveeventcontext) and returns early if there is none, then loads sessions, open polls, and (only for organizers) the manage list. The live wiring waits for `OnAfterRenderAsync` (`:107-128`). Note what that method is **not**: it is not `firstRender`-gated, and the comment at `:109-112` explains why. First render fires at the first `await` inside `OnInitializedAsync`, while `_liveEvent` is still null, so a `firstRender`-only join would never attach (BR-229). Instead the join happens on the first render *after* the load, using the subscription's own `IsJoined` as the already-joined guard and `RendererInfo.IsInteractive` to keep the prerender pass and the bUnit suite from dialling the hub. It also refuses to join unless the event is live right now (`_liveEvent.IsLiveAt(DateTime.UtcNow)`, `:118`). `[Rubric §28, Front-End Testing]`: the shape of this method is driven by what the component test can exercise, and the comment at `:65-66` records the related trade-off, unlike the sibling Live and Presenter pages this page keeps its loads on the prerender pass and accepts the double fetch, because adding the guard needs a hub-service test extension point (deferred).
- **Walkthrough**, in teaching order:
  - **Injected state and fields** (`HappeningNow.razor.cs:25-51`): the seven injected services, the cascading `AuthState`, a `CancellationTokenSource _cts` for disposal-safe async, the breadcrumb list, the `IsLoading`/`IsSaving` flags, `_loadError`, `_isOrganizer`, the loaded `_liveEvent`, the two poll lists (`_polls` for open polls with tallies, `_managePolls` for every status), the now and next session lists, and a [`LiveChannelSubscription`](group-22-engagement-module.md#livechannelsubscription) `_channel` (`:51`) that encapsulates join and leave.
  - **Load** (`HappeningNow.razor.cs:53-105`): sets breadcrumbs, subscribes to [`NotificationState`](group-15-common-ui-framework.md#notificationstate)`.OnChange` (`:63`) so the header announcements badge stays in sync with the shared unread count, reads the organizer role, fetches the current event, then chains the loads so a failure short-circuits the rest. Every failure funnels into a single localized `_loadError` (`:94`), `OperationCanceledException` is swallowed as expected-during-disposal, and `IsLoading` is always cleared in `finally`.
  - **Channel join** (`HappeningNow.razor.cs:107-128`): joins [`LivePollChannel.ForEvent`](#livepollchannel) for the loaded event id and registers `HandleChannelEventAsync` as the handler.
  - **Channel handling** (`HappeningNow.razor.cs:133-146`): this is the performance heart. For a `LivePollChannel.PollResultsChanged` event it calls [`LiveBroadcastPatch`](group-22-engagement-module.md#livebroadcastpatch)`.TryApplyPollResults(_polls, payloadJson, preserveMyVote: true)` (`:139`) to patch the matching poll's tallies **in place** from the broadcast payload, keeping this circuit's own vote marker; only then does it re-render. Everything else (structural events such as opened and closed) falls through to `ReloadPollsAsync`. The comment at `:135-137` records why reload-on-broadcast was abandoned: one hot poll turned V votes times C viewers into V*C authenticated refetches under burst voting. `[Rubric §12, Performance & Scalability]`.
  - **Loads and refresh** (`HappeningNow.razor.cs:148-194`): `LoadSessionsAsync` calls the public now-next endpoint through [`INowNextService`](group-22-engagement-module.md#inownextservice), and the doc comment (`:148-153`) pins the division of labour, the server owns the eligibility filter, the event-local wall clock, and the "next = the batch sharing the earliest future start" rule, so the page only renders what comes back; a not-found answer (an unpublished or deleted event) is normalized to success so the page shows an empty state rather than a load failure (`:162`). `LoadPollsAsync` and `LoadManagePollsAsync` (`:165-169`) each `Tap` their result into a list. `ReloadPollsAsync` (`:171-194`) is the background-refresh path: a failure toasts and returns rather than crashing the page, because the manual refresh button and the next channel event are the retry paths (`:182-183`). `[Rubric §29, Resilience]`.
  - **Voting** (`HappeningNow.razor.cs:196-225`): `VoteAsync` fires a haptic click, a no-op off native heads ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html), `:198-199`), casts the vote through [`ILivePollUIService`](#ilivepolluiservice), and on success replaces the matching entry in `_polls` with the returned [`LivePollResultsDTO`](#livepollresultsdto) (`:211-215`), so the voter sees their own result immediately without waiting for the broadcast.
  - **Post-action reload callbacks** (`HappeningNow.razor.cs:227-252`): `ReloadManagePollsAsync` and `ReloadPollListsAsync` are the two handlers bound to [`PollManagementPanel`](#pollmanagementpanel)'s change callbacks. The comment at `:227-230` states the contract: the panel performs its own poll call, then the page (which owns the lists) reloads what the action affected, and reports a failed reload here while still inside the panel's `try` block, so a cancellation during disposal stays expected.
  - **Error surfacing and formatting** (`HappeningNow.razor.cs:254-266`): the same `ShowActionError` split as the panel (a stated refusal shows the server's localized Problem Details, an unexpected fault shows the generic fallback, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) Decision 9), plus `FormatSessionTime`, which formats the event-local start and end with `CultureInfo.CurrentCulture` (`:265-266`). `[Rubric §27, i18n]`: a displayed time formats with the *current* culture, unlike a channel key, which formats invariant.
  - **Disposal** (`HappeningNow.razor.cs:268-279`): unsubscribes from `NotificationState.OnChange`, cancels and disposes the `_cts`, and disposes the channel subscription (which leaves the SignalR group).
- **Why it's built this way**: patch-in-place from the self-contained [`LivePollResultsDTO`](#livepollresultsdto) broadcast (rather than a refetch on every event) is what keeps a hot poll from stampeding the API under burst voting, and gating the channel join on `RendererInfo.IsInteractive` plus a live-window check means a prerender pass or an already-ended event never opens a SignalR connection ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)). Announcements are deliberately not duplicated on this page: they live in the shared notification inbox and are reached from the header link with a live unread badge (`HappeningNow.razor.cs:16-21`), so there is one inbox, not two.
- **Where it's used**: routed as the conference-day landing page, `@page "/happening-now"` with `[Authorize]` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/HappeningNow/HappeningNow.razor:1-2`). It renders [`PollManagementPanel`](#pollmanagementpanel) in its organizer-only Manage tab and links out to the per-session live surface [`SessionLive`](#sessionlive) from every now-and-next row; [`PresenterView`](#presenterview) is the speaker-facing sibling.
- **Caveats / not-in-source**: the `.razor` markup owns the tab layout, the poll cards, the empty and error states, and the localization keys, so the rendered structure is not determinable from `HappeningNow.razor.cs` alone.

### OptionState
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.SessionLive` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLiveModerationPanel.razor.cs:312` · Level 0 · class

- **What it is**: a one-field mutable holder for a single poll option's text, `private sealed` and nested inside [SessionLiveModerationPanel](#sessionlivemoderationpanel). It exists only to give the create-poll form's dynamic option rows a stable reference-type target for two-way Blazor binding.
- **Depends on**: nothing first-party. One nullable `string` auto-property, `Text` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLiveModerationPanel.razor.cs:314`).
- **Concept introduced**: **reference-type binding cells for a growable form list.** Blazor's `@bind` needs a settable member on an object whose identity survives a re-render. Binding straight to the elements of a `List<string>` does not give each text field its own writable backing store, because a `string` element has no addressable setter and the slot is replaced on every keystroke. Wrapping each option in a small mutable class gives the `MudTextField` a fixed object to write `Text` into (`SessionLiveModerationPanel.razor:67`), and lets `AddOption`/`RemoveOption` grow and shrink the list without disturbing the other rows' bindings. `[Rubric §24, Forms/Validation/UX Safety]` assesses how the UI models editable form state safely: this wrapper is the minimal mechanism that keeps a variable-length option list editable without index churn. The sibling [OptionState](#optionstate) nested in [HappeningNow](#happeningnow) is the same idiom applied to the event-wide poll builder.
- **Walkthrough**: declared at `SessionLiveModerationPanel.razor.cs:312` with a single auto-property `public string? Text { get; set; }` (`:314`). The panel seeds two cells at construction (`_newPollOptions = [new(), new()]`, `:69`), enforces the DTO's option range through `AddOption` (`:161`, capped at `LivePollDTO.MaxOptions`, `:163`) and `RemoveOption` (`:169`, floored at `LivePollDTO.MinOptions`, `:171`), and on submit projects the trimmed, non-empty texts into the request's `Options` list (`:185-189`). After a successful create the panel clears the list and re-seeds exactly two blank cells (`:214-216`).
- **Why it's built this way**: a `private sealed` nested type keeps this a pure implementation detail of the moderation panel. It never crosses a boundary (the wire shape is the plain `List<string>` on [CreateLivePollRequest](#createlivepollrequest)), so it does not belong in the Shared project.
- **Where it's used**: only within [SessionLiveModerationPanel](#sessionlivemoderationpanel), as the element type of `_newPollOptions` backing the create-poll option rows.

### SessionLivePollPanel
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.SessionLive` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLivePollPanel.razor.cs:18` · Level 4 · class

- **What it is**: the presentational child component that renders a session's open polls with their live tallies and casts the attendee's vote. It is the "polls" third of the container/presentational split of the [SessionLive](#sessionlive) page.
- **Depends on**: [ILivePollUIService](#ilivepolluiservice) (the vote call), [LivePollResultsDTO](#livepollresultsdto) (the per-poll tally model), [LivePollStatus](#livepollstatus) (the can-vote test in the markup), [IToastService](group-15-common-ui-framework.md#itoastservice) (error toasts), [IHapticFeedbackService](group-26-device-capability-layer.md#ihapticfeedbackservice) (native tactile confirmation), the [ResultUiExtensions](group-15-common-ui-framework.md#resultuiextensions) helpers `HasErrorType`/`LocalizedErrorMessage`, and [ErrorType](group-01-result-error-handling.md#errortype). The markup renders the shared `LivePollCard` component from the HappeningNow page folder.
- **Concept introduced**: **container/presentational split with parent-owned state.** The page ([SessionLive](#sessionlive)) is the container: it owns the poll list, the channel subscription, and the shared saving flag. This panel is presentational: it receives `Polls` as an `[EditorRequired]` `[Parameter]` (`SessionLivePollPanel.razor.cs:27`) and never loads them itself. The only state it mutates is an in-place patch of the passed-in list after a vote, so the container sees the fresh tally without a reload. `[Rubric §19, State Management]` assesses where state lives and who owns it: ownership stays with the page, the panel only renders and emits. `[Rubric §18, UI Architecture]` (component decomposition) is embodied by splitting one large live page into three focused panels that each own their own actions.
- **Walkthrough**: three injected services, `PollService`, `Toast`, `Haptics` (`SessionLivePollPanel.razor.cs:20-22`). `Polls` is the `[EditorRequired]` `List<LivePollResultsDTO>` parameter (`:27`); `IsSaving`/`IsSavingChanged` (`:31`, `:35`) are the page-wide saving flag flowing in and back out so every section disables together. `VoteAsync(pollId, optionId)` (`:39`) fires `Haptics.Click()` first (a no-op off native heads, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html), `:42`), raises the saving flag through the callback (`:44`), calls `PollService.CastVoteAsync` (`:47`), and on success finds the poll by `PollId` and replaces it in the container-owned list in place (`:54-58`). `OperationCanceledException` from disposal is swallowed (`:60`), and the flag is always lowered in the `finally` (`:66`). `ShowActionError` (`:76`) is the shared failure surface: an [ErrorType](group-01-result-error-handling.md#errortype)`.Unexpected` result (a 500, a transport failure, a timeout) shows the generic localized fallback, while a refusal the API stated shows the server's own localized Problem Details message ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) Decision 9 carve-out). `DisposeAsync` (`:83`) cancels and disposes the component's `CancellationTokenSource`. The markup loops the polls into `LivePollCard`, enabling the vote only while `poll.Status == LivePollStatus.Open` (`SessionLivePollPanel.razor:12-17`) and rendering an info alert when the list is empty (`:8`).
- **Why it's built this way**: patching the returned tally into the shared list (rather than reloading) keeps the panel cheap and avoids a redundant round-trip, since the cast already returned the new counts. The saving flag is lifted to the page so a vote here also disables the Q&A submit and the moderation buttons, preventing overlapping mutations. `[Rubric §27, i18n]`: every user-visible string is a resource key resolved through the `IStringLocalizer<SessionLive>` the markup injects, so all three panels share one resource file.
- **Where it's used**: instantiated by [SessionLive](#sessionlive)'s markup as the open-polls section (`SessionLive.razor:41`), which passes `_polls` and two-way-binds the shared saving flag.
- **Caveats / not-in-source**: the tally bars and vote buttons are rendered by `LivePollCard`, invoked from the sibling `SessionLivePollPanel.razor` file, not from this code-behind.

### PresenterView
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.SessionLive` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/PresenterView.razor.cs:19` · Level 6 · class

- **What it is**: the chrome-less, large-type projector page for a session's live layer: the session title, the open polls as big result bars, and the top approved questions by upvotes. It takes no input; it is meant to be thrown on the room screen and left to refresh itself from the live channel.
- **Depends on**: [ILivePollUIService](#ilivepolluiservice) and [ISessionQuestionUIService](#isessionquestionuiservice) (the data loads), [ISessionLookupService](#isessionlookupservice) plus [SessionInfo](#sessioninfo) (the single-session label), [NotificationHubService](group-15-common-ui-framework.md#notificationhubservice) (the SignalR channel subscription), the channel key and event constants [LivePollChannel](#livepollchannel) and [SessionQuestionChannel](#sessionquestionchannel), the patch helper [LiveBroadcastPatch](group-22-engagement-module.md#livebroadcastpatch), the models [LivePollResultsDTO](#livepollresultsdto) and [SessionQuestionDTO](#sessionquestiondto), [QuestionStatus](#questionstatus), [IToastService](group-15-common-ui-framework.md#itoastservice), and the [ResultUiExtensions](group-15-common-ui-framework.md#resultuiextensions) helper `IsNotFound`.
- **Concept introduced**: **patch-on-broadcast versus reload-on-broadcast for a hot channel.** The projector is typically the most-connected client during a live poll, so reloading on every broadcast multiplies backend reads at exactly the wrong moment. `HandleChannelEventAsync` (`PresenterView.razor.cs:113`) therefore patches the two high-frequency tally events in place from the broadcast payload, which already carries the fresh counts (BR-229/BR-238), and only falls back to a full reload for structural events. `[Rubric §12, Performance & Scalability]` assesses how a design behaves under load: the patch path is a deliberate fan-out mitigation. `[Rubric §23, Front-End Performance]` covers client render and network cost: replacing one list element and calling `StateHasChanged` is far cheaper than a full refetch and rebind. `[Rubric §13, Observability & Operability]` is under-used here: a patch that cannot be applied degrades silently into a reload with no counter or log.
- **Walkthrough**: `TopQuestionCount = 5` (`PresenterView.razor.cs:21`); five injected services (`:23-27`); the `Id` route parameter (`:31`). State is the page `CancellationTokenSource` (`:33`), `IsLoading` (`:35`), `_loadError`, `_session`, `_polls`, `_questions` (`:37-40`), and the channel subscription plus its key (`:42-43`). `TopQuestions` (`:46`) projects the approved questions ordered by `UpvoteCount` descending then `CreatedOn`, taking the top five. `OnInitializedAsync` (`:53`) short-circuits during the SSR prerender pass via `RendererInfo.IsInteractive` (`:57`), so the loads do not run twice per visit and the prerender renders the loading skeleton; it then point-reads the session with `SessionLookup.GetByIdAsync` (`:66`), treating a not-found result as the view's own "not found" alert and anything else as a load failure (`:71-74`), and finally calls `LoadAsync` (`:81`). `OnAfterRenderAsync` (`:96`) is deliberately not `firstRender`-gated: the first render fires at the first `await` in `OnInitializedAsync` while `_session` is still null, so a `firstRender`-only join never attached (BR-229/BR-238). Instead `_channelKey` doubles as the already-joined guard (`:102`), and the join runs on the first render after the session load completes: subscribe with `HubService.OnChannelEvent`, then `JoinChannelAsync` on `LivePollChannel.ForSession(Id)` (`:108-110`). `HandleChannelEventAsync` (`:113`) matches `LivePollChannel.PollResultsChanged` to `LiveBroadcastPatch.TryApplyPollResults(..., preserveMyVote: false)` (`:119-120`) and `SessionQuestionChannel.QuestionUpvoteChanged` to `TryApplyUpvoteCount` (`:126-127`), re-rendering on a successful patch; every other event, and any payload that could not be applied, falls through to a full `LoadAsync` whose transient failure is toasted rather than crashing the projector (`:135-141`). `LoadAsync` (`:151`) refetches the open session polls and the questions, returning a failed [Result](group-01-result-error-handling.md#result) on either refusal. `FormatSessionTime` (`:170`) renders the start-end range under the current culture. `DisposeAsync` (`:176`) cancels the token source, disposes the subscription, and leaves the channel (`:184`).
- **Why it's built this way**: the projector shows no per-user data, so it passes `preserveMyVote: false` and takes the broadcast tally wholesale, unlike the attendee page, which must carry its own vote marker across the patch ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) is the transport this rests on). The SSR-prerender skip and the point read (rather than fetching the whole session catalog to label one row) are the same load-shedding instincts applied to first paint.
- **Where it's used**: a routed page at `/conference/sessions/{Id:int}/present` under `PresenterLayout` and `[Authorize]` (`PresenterView.razor:1-3`), reached from the Present button that [SessionLive](#sessionlive) renders for moderators.
- **Caveats / not-in-source**: the route template, the layout choice, and the big result bars (percentage widths computed inline at `PresenterView.razor:38-44`) live in `PresenterView.razor`, not in this code-behind.

### SessionLive
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.SessionLive` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLive.razor.cs:26` · Level 6 · class

- **What it is**: the routed session Live page and the container for the whole per-session live experience: the session's open polls with live tallies, the attendee Q&A surface, and a moderation panel rendered for organizers, admins, and speaker-claim holders. It owns the lists, the channel subscription, and the shared saving flag, and renders the three sections through presentational child panels.
- **Depends on**: [ILivePollUIService](#ilivepolluiservice), [ISessionQuestionUIService](#isessionquestionuiservice), [ISessionLookupService](#isessionlookupservice) plus [SessionInfo](#sessioninfo), [NotificationHubService](group-15-common-ui-framework.md#notificationhubservice), [IToastService](group-15-common-ui-framework.md#itoastservice); the join-once handle [LiveChannelSubscription](group-22-engagement-module.md#livechannelsubscription) and the patch helper [LiveBroadcastPatch](group-22-engagement-module.md#livebroadcastpatch); the child panels [SessionLivePollPanel](#sessionlivepollpanel), [SessionLiveQuestionPanel](#sessionlivequestionpanel), [SessionLiveModerationPanel](#sessionlivemoderationpanel); the channel constants [LivePollChannel](#livepollchannel) and [SessionQuestionChannel](#sessionquestionchannel); the models [LivePollResultsDTO](#livepollresultsdto), [SessionQuestionDTO](#sessionquestiondto), [LivePollDTO](#livepolldto); [RoleNames](group-08-auth.md#rolenames) and [EngagementRoutePaths](group-22-engagement-module.md#engagementroutepaths); plus `AuthenticationState` and MudBlazor's `BreadcrumbItem`.
- **Concept introduced**: **container-owns-state, panels-own-actions, with post-action reload callbacks.** Each presentational panel performs its own service call and then invokes an `EventCallback`, so the page (the single owner of every list) reloads exactly what the action affected: `ReloadManagePollsAsync` (`SessionLive.razor.cs:303`), `ReloadQuestionListsAsync` (`:305`), `ReloadModerationListsAsync` (`:310`), `ReloadPollListsAsync` (`:313`). All four are one-liners over the same `RefreshAsync` body, and two of them widen the reload when `_canModerate` is set. `[Rubric §19, State Management]` is embodied cleanly: one source of truth per list, and a narrow patch-or-reload contract between page and panels. `[Rubric §11, Security]`: the page computes `_canModerate` from the Organizer or Admin role plus the presence of a `speaker_id` claim (`:80-83`), but the code is explicit that this is a UI affordance only. The server is the authority on per-session rights (BR-236), and a speaker whose claim does not match this session gets a refusal on the moderation-queue read, at which point the page sets `_canModerate = false` and degrades to the attendee view (`:274-279`).
- **Walkthrough**: five injected services (`SessionLive.razor.cs:28-32`), the cascading `AuthState` (`:34-35`), and the `Id` route parameter (`:39`). State: the page `CancellationTokenSource` (`:41`), breadcrumbs (`:43`), `IsLoading`/`IsSaving` (`:45-46`), `_loadError`, `_canModerate`, `_session`, `_polls`, `_questions`, `_moderationQueue`, `_managePolls` (`:48-54`), and the [LiveChannelSubscription](group-22-engagement-module.md#livechannelsubscription) field (`:56`). `OnInitializedAsync` (`:58`) builds the breadcrumb trail, returns early during the SSR prerender pass (`:70`), computes `_canModerate` (`:80`), point-reads the session (`:88`, with a not-found result rendering the page's own info alert rather than an error, `:93`), then loads polls and questions in order (`:103-107`) and, when allowed, the moderation data (`:115-117`); `IsLoading` is cleared in the `finally` (`:126`). `OnAfterRenderAsync` (`:130`) uses the same not-`firstRender`-gated join as the projector view, with `_channel.IsJoined` as the already-joined guard (`:137`), and joins `LivePollChannel.ForSession(Id)` (`:143`). `HandleChannelEventAsync` (`:146`) tries the tally fast path first (`:153`), then routes structural events: any `poll.` prefix reloads the poll lists (`:158`), `SessionQuestionChannel.QuestionPendingCountChanged` reloads only the moderation queue and only for moderators (`:164-171`), and any `question.` prefix reloads the question lists (`:174`). `TryHandleTallyEventAsync` (`:185`) is a three-state switch: `null` for a non-tally event so the caller reloads (`:199`), `true` for an applied patch that only needs a re-render (`:201`), and `false` for an unapplicable payload, which falls back to the targeted reload of just that list (`:204-206`). The comment at `:148-152` records the concrete reason for the patch path: reload-on-broadcast turned V voters times C viewers into V*C authenticated refetches per hot poll, colliding with the per-user rate limiter under burst voting. `RefreshAsync(params Func<Task<Result>>[])` (`:220`) is the page's one reload: it runs the named loads in order, stops at the first failure with a generic toast (`:228`), re-renders on success, and swallows the disposal cancellation. `LoadListAsync<T>` (`:249`) is the page's one list load, parameterized by the fetch and the field assignment, which is what makes `LoadPollsAsync`, `LoadQuestionsAsync`, and `LoadModerationQueueAsync` one-liners (`:263`, `:266`, `:269`). `LoadManagePollsAsync` (`:292`) calls the session-scoped `GetSessionManagePollsAsync` (`:294`), which carries the BR-236 rights rather than the organizer-only LiveManage capability, so a speaker moderating their own session gets the real list (every status, each row carrying its concurrency token) with the server doing the filtering; it is best-effort, so a refusal simply yields no rows and never fails a reload chain (`:296-297`). `DisposeAsync` (`:324`) cancels the token source and disposes the channel handle, which leaves the channel.
- **Why it's built this way**: the container/presentational split keeps one page from ballooning while preserving a single owner for each list and for the saving flag. The tally patch path is a measured response to a real rate-limit collision, not a premature optimization: the code comments name the failure mode. Pushing the manage-poll read to a session-scoped endpoint removes a client-side session filter and an organizer-only refusal that a speaker moderator would otherwise have had to work around. `[Rubric §18, UI Architecture]`: three panels plus one container is the decomposition; `[Rubric §9, API & Contract Design]` shows up in the read shapes, where each list has its own endpoint scoped to what the caller is allowed to see rather than one over-broad read filtered on the client.
- **Where it's used**: a routed `[Authorize]` page at `/conference/sessions/{Id:int}/live` (`SessionLive.razor:1-2`), reached from the Happening Now surface via [EngagementRoutePaths](group-22-engagement-module.md#engagementroutepaths); it renders the Present button to [PresenterView](#presenterview) for moderators (`SessionLive.razor:32-36`) and instantiates the three panels at `:41`, `:44`, and `:52`.
- **Caveats / not-in-source**: the route template, breadcrumbs, loading and error states, and the three panel instantiations with their parameter wiring live in `SessionLive.razor`.

### SessionLiveQuestionPanel
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.SessionLive` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLiveQuestionPanel.razor.cs:19` · Level 6 · class

- **What it is**: the presentational child component for the attendee Q&A surface: the submit box with dictation, the approved questions sorted by upvotes, the caller's own not-yet-approved questions, and the upvote toggle. It is the "questions" third of the [SessionLive](#sessionlive) split.
- **Depends on**: [ISessionQuestionUIService](#isessionquestionuiservice) (submit and upvote calls), [SessionQuestionDTO](#sessionquestiondto) and [QuestionStatus](#questionstatus) (the question model and its states), [SubmitQuestionRequest](#submitquestionrequest) (the submit payload), [ISpeechToTextService](group-26-device-capability-layer.md#ispeechtotextservice) (dictation), [IToastService](group-15-common-ui-framework.md#itoastservice), and the [ResultUiExtensions](group-15-common-ui-framework.md#resultuiextensions) helpers with [ErrorType](group-01-result-error-handling.md#errortype).
- **Concept introduced**: **linked-token dictation as a toggle.** Voice input ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 4) uses a second `CancellationTokenSource` linked to the component's own `_cts` (`SessionLiveQuestionPanel.razor.cs:82`), so the same button both starts a dictation and cancels one already in flight (`:69-79`), and component disposal tears down the in-flight listen along with everything else (`:187`). This is the first place in the live layer where a device-capability service is toggled inline in a form. `[Rubric §24, Forms/Validation/UX Safety]` assesses input UX and guard rails: the submit path warns on empty text before making any call (`:106-110`) and trims on send (`:115`), and the markup caps the box at `SessionQuestionDTO.TextMaxLength`, 500 characters (`SessionLiveQuestionPanel.razor:9`). `[Rubric §21, Accessibility]`: the dictation button carries both an `aria-label` and a `title` that flip with the dictation state (`SessionLiveQuestionPanel.razor:21-22`), and the upvote button is labelled the same way (`:50`). `[Rubric §19, State Management]` applies again: the panel patches the container-owned `Questions` list in place after an upvote, so the page stays the single owner.
- **Walkthrough**: injected `QuestionService`, `Toast`, `SpeechToText` (`SessionLiveQuestionPanel.razor.cs:21-23`). Parameters: `SessionId` and the `[EditorRequired]` `Questions` list (`:28`, `:33`), the shared `IsSaving`/`IsSavingChanged` (`:37`, `:41`), and the `OnQuestionSubmitted` reload callback (`:45`). Two computed projections drive the markup: `ApprovedQuestions` (`:52`) filters to `QuestionStatus.Approved` ordered by `UpvoteCount` descending then `CreatedOn`, and `MyModeratedQuestions` (`:59`) surfaces the caller's own not-yet-approved questions via `IsMine`, rendered with a status chip. `ToggleDictationAsync` (`:69`) cancels an in-flight dictation when one is running, otherwise creates the linked source, awaits `SpeechToText.ListenAsync` under the current UI culture (`:85-88`), and appends the recognized text to whatever is already in the box (`:91-93`), always clearing the dictation state in the `finally` (`:96-101`). `SubmitQuestionAsync` (`:104`) validates, raises the saving flag, builds a [SubmitQuestionRequest](#submitquestionrequest) with the trimmed text (`:115`), submits (`:116`), clears the box, toasts success (`:123-124`), and invokes `OnQuestionSubmitted` so the page reloads its lists (`:126`). `ToggleUpvoteAsync` (`:138`) calls remove-or-add based on `MyUpvote` (`:143-145`), then patches the returned count and the flipped marker into the list in place with a `with` expression (`:154-158`), which re-sorts `ApprovedQuestions` on the next render. `ShowActionError` (`:176`) is the same refusal-versus-fault split the sibling panels use. `DisposeAsync` (`:183`) cancels and disposes the page token source and disposes any dictation source.
- **Why it's built this way**: patching the upvote count locally rather than reloading keeps the sort responsive under rapid toggling, and the channel's `question.upvote-changed` broadcast reconciles every other client. Lifting the saving flag to the page disables the poll and moderation sections during a submit, so a moderator cannot act on a half-submitted question.
- **Where it's used**: instantiated by [SessionLive](#sessionlive) as the Q&A section (`SessionLive.razor:44-47`), which passes `_questions`, the session id, and the reload callback.
- **Caveats / not-in-source**: the submit box, the dictation button (rendered only when `SpeechToText.IsSupported`, `SessionLiveQuestionPanel.razor:17`), and the question cards live in `SessionLiveQuestionPanel.razor`.

### SessionLiveModerationPanel
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.SessionLive` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLiveModerationPanel.razor.cs:20` · Level 8 · class

- **What it is**: the presentational child component for the moderation section, rendered for organizers, admins, and speaker-claim holders: the question moderation queue (approve, dismiss, mark answered), the create-poll form, and the poll lifecycle rows (open, close). It owns the create-poll form state and performs the moderation and poll calls; the page reloads the affected lists through three separate change callbacks.
- **Depends on**: [ILivePollUIService](#ilivepolluiservice) and [ISessionQuestionUIService](#isessionquestionuiservice) (the moderation and poll calls), the models [SessionQuestionDTO](#sessionquestiondto) and [LivePollDTO](#livepolldto), the enums [LivePollStatus](#livepollstatus) and [QuestionStatus](#questionstatus), [CreateLivePollRequest](#createlivepollrequest) (the new-poll payload), the nested [OptionState](#optionstate) binding cell, [IToastService](group-15-common-ui-framework.md#itoastservice), and the [ResultUiExtensions](group-15-common-ui-framework.md#resultuiextensions) helpers with [ErrorType](group-01-result-error-handling.md#errortype).
- **Concept introduced**: **conditional writes from a moderation UI.** Every state transition this panel issues carries the `RowVersion` of the row the moderator was actually looking at, which travels as the request's `If-Match` header ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)), so two moderators racing approve against dismiss surface as a conflict instead of one silently overwriting the other. `QuestionRowVersion` (`SessionLiveModerationPanel.razor.cs:82`) and `PollRowVersion` (`:87`) look the token up from the list the row came from, and `RunConditionalModerationActionAsync` (`:122`) refuses outright when no token is held, toasting the generic failure rather than sending an unconditional write (`:128-131`). The remark at `:117-121` names the case: an item that arrived through a SignalR payload carries no token, and reloading the queue is what supplies one. `[Rubric §9, API & Contract Design]` assesses precondition semantics on the wire: the client states the version it read, and the server decides. `[Rubric §11, Security]` assesses defense in depth: the panel renders actions, but the server enforces the real per-session rights (BR-236, stated in the class doc at `:11-19`); the page-side `_canModerate` gate is an affordance, not the trust boundary. `[Rubric §24, Forms/Validation/UX Safety]` covers the create-poll form, which holds the option count between `LivePollDTO.MinOptions` (2) and `LivePollDTO.MaxOptions` (10) (`:163`, `:171`) and requires a question plus at least two non-empty options before calling the service (`:179`, `:190`).
- **Walkthrough**: injected `PollService`, `QuestionService`, `Toast` (`SessionLiveModerationPanel.razor.cs:22-24`). Parameters: `SessionId` (`:29`), `EventId` (`:34`, the event new polls are created against), the `[EditorRequired]` `ModerationQueue` and `ManagePolls` lists (`:39`, `:44`), the shared `IsSaving`/`IsSavingChanged` (`:48`, `:52`), and the three reload callbacks `OnModerationChanged`, `OnPollCreated`, `OnPollLifecycleChanged` (`:56`, `:60`, `:64`). Form state is `_newPollQuestion` (`:68`) and `_newPollOptions`, seeded with two [OptionState](#optionstate) cells (`:69`). `ManagePollRows` (`:76-77`) projects the manage list into id, question, and status tuples for the lifecycle rows; because the session-scoped manage endpoint serves every moderator this panel renders for, there is no client-side fallback list. The three question transitions, `ApproveQuestionAsync` (`:90`), `DismissQuestionAsync` (`:96`), and `MarkQuestionAnsweredAsync` (`:102`), all pass their looked-up token into `RunConditionalModerationActionAsync` (`:122`), which delegates to `RunModerationActionAsync` (`:136`): raise the saving flag, call, toast the success key, invoke `OnModerationChanged`, swallow the disposal cancellation, always lower the flag. `AddOption` (`:161`) and `RemoveOption` (`:169`) grow and shrink the option list within the DTO's bounds. `CreateSessionPollAsync` (`:177`) warns on a missing question (`:179-183`), projects the trimmed non-empty option texts and warns again if fewer than two survive (`:185-194`), builds the [CreateLivePollRequest](#createlivepollrequest) against `EventId` and `SessionId` (`:199-205`), creates, resets the form to two blank cells, toasts, and invokes `OnPollCreated` (`:213-219`). `OpenPollAsync` (`:231`) and `ClosePollAsync` (`:237`) mirror the question path through `RunConditionalPollActionAsync` (`:250`) and `RunPollActionAsync` (`:265`), which invokes `OnPollLifecycleChanged` so the page reloads both poll lists. `ShowActionError` (`:296`) applies the same refusal-versus-fault split as the sibling panels. `DisposeAsync` (`:303`) cancels and disposes the token source, and the nested [OptionState](#optionstate) type closes the file (`:312`).
- **Why it's built this way**: routing every transition through a conditional-write wrapper means the concurrency contract cannot be forgotten on a new action: the only way to call a transition is to hand it a token. Splitting the change notification into three callbacks lets the container reload only the lists an action touched, which is why an approve does not refetch the poll tallies. The moderation queue and the manage rows are parameters rather than panel-owned state, so the page remains the single owner and the SignalR handler and the panel actions converge on the same reload paths.
- **Where it's used**: instantiated by [SessionLive](#sessionlive) as the moderation section, guarded by the page's `_canModerate` flag (`SessionLive.razor:50-59`).
- **Caveats / not-in-source**: the moderation-queue cards, the create-poll form (whose field lengths bind to `LivePollDTO.QuestionMaxLength`, 200, and `LivePollOptionDTO.TextMaxLength`, 100, at `SessionLiveModerationPanel.razor:62` and `:69`), and the lifecycle rows are laid out in `SessionLiveModerationPanel.razor`.

### LiveEventContext

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/LiveEventContext.cs:13` · Level 0 · record

- **What it is**: the UI's read-only view of the currently published event's live window: the event id and name, its IANA time zone, and the UTC start/end of the window during which the live layer (polls and session Q&A) is active. It is a `sealed record` with two small behaviors attached, not a bare DTO.
- **Depends on**: `EventIdentifierType` (the Conference module's identifier alias), BCL `DateTime` and `TimeZoneInfo`. No NuGet or first-party service dependencies; this is a pure value.
- **Concept introduced**: **client-side re-derivation of a server-enforced window.** The doc comment (`MMCA.ADC.Engagement.UI/Services/LiveEventContext.cs:4`) is explicit that the window uses "the same math the backend enforces": StartDate 00:00 local through EndDate + 1 day 00:00 local, converted to UTC via the event's zone. The UI does not invent its own liveness rule, it mirrors the authoritative one so the ambient [LiveEventListener](group-22-engagement-module.md#liveeventlistener) and the [HappeningNow](#happeningnow) page light up at exactly the moment the API would accept a vote. `[Rubric §19, State Management]` assesses how derived UI state is kept consistent with its source of truth; the record centralizes the "am I live" decision in one value both surfaces call, rather than scattering time-zone arithmetic across components. `[Rubric §12, Performance & Scalability]` applies mildly: `IsLiveAt` is a pure comparison, so an ambient listener can re-evaluate it without a round trip.
- **Walkthrough**: the primary constructor (`MMCA.ADC.Engagement.UI/Services/LiveEventContext.cs:13`) captures `EventId`, `Name`, `TimeZoneId`, `LiveWindowStartUtc`, and `LiveWindowEndUtc`. `IsLiveAt(DateTime utcNow)` (`MMCA.ADC.Engagement.UI/Services/LiveEventContext.cs:22`) returns true when `utcNow` is inside the half-open window: note the inclusive lower bound and the exclusive `< LiveWindowEndUtc` upper bound matching the parameter doc that calls the end "exclusive" (`MMCA.ADC.Engagement.UI/Services/LiveEventContext.cs:12`). `ToEventLocal(DateTime utcNow)` (`MMCA.ADC.Engagement.UI/Services/LiveEventContext.cs:30`) converts a UTC instant into the event's local time via `TimeZoneInfo.ConvertTimeFromUtc` over `TimeZoneInfo.FindSystemTimeZoneById(TimeZoneId)`, with no fallback: the doc comment states the id always resolves because [EventInvariants](group-17-conference-domain.md#eventinvariants)`.EnsureTimeZoneIsValid` guards every write path (`MMCA.ADC.Engagement.UI/Services/LiveEventContext.cs:26`).
- **Why it's built this way**: making the record own both the window and the "is it live / what is local time" helpers keeps the liveness contract in a single testable value. The conversion trusts the domain invariant instead of defensively catching `TimeZoneNotFoundException`, so an invalid zone is prevented where it is written rather than papered over where it is read.
- **Where it's used**: produced by [LiveEventService](#liveeventservice) from Conference event data; consumed by the [HappeningNow](#happeningnow) page and the ambient [LiveEventListener](group-22-engagement-module.md#liveeventlistener) to decide whether to show live surfaces.

### SessionInfo

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:9` · Level 0 · record

- **What it is**: a lightweight projection record carrying just the session fields Engagement pages need to label a bookmark or a live row: id, title, optional start/end times, and the owning event id. It sits at the top of `ISessionLookupService.cs` because it is the shape that lookup service returns.
- **Depends on**: `SessionIdentifierType` and `EventIdentifierType` (Conference identifier aliases). No first-party service dependencies.
- **Concept introduced**: **cross-module display projection.** Engagement has no session table of its own (database-per-service, [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), so it cannot join to a session title. Instead it fetches the fields it needs from the Conference API and holds them in this small record, a deliberately thinner shape than Conference's own [SessionDTO](group-17-conference-domain.md#sessiondto). `[Rubric §9, API & Contract Design]` assesses how a consumer models another service's data at its boundary: `SessionInfo` takes only the five fields it renders, so a change to unrelated `SessionDTO` fields never ripples into Engagement.
- **Walkthrough**: positional members `(SessionIdentifierType Id, string Title, DateTime? StartsAt, DateTime? EndsAt, EventIdentifierType EventId)` (`MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:9`). `StartsAt`/`EndsAt` are nullable because a session imported from the schedule source may not yet have times assigned, so pages must tolerate an unscheduled session. It is a plain `record` (not `sealed`), unlike most of the live layer's value types.
- **Why it's built this way**: a compact record lets the lookup service build a whole-catalog dictionary cheaply and lets pages sort by `StartsAt` client-side without a second fetch per row.
- **Where it's used**: returned by [ISessionLookupService](#isessionlookupservice) (`GetAllAsync` keyed by id, `GetByIdAsync` for one), built by [SessionLookupService](#sessionlookupservice) from Conference [SessionDTO](group-17-conference-domain.md#sessiondto) payloads.

### CreateLivePollCommand

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollCommand.cs:14` · Level 1 · record

- **What it is**: the CQRS command that requests creation of a live poll (as Draft). It wraps the transport [CreateLivePollRequest](#createlivepollrequest) together with two facts about the caller: their `speaker_id` claim (if any) and whether they hold an organizer/admin role.
- **Depends on**: [CreateLivePollRequest](#createlivepollrequest) (the request body shape, `MMCA.ADC.Engagement.Shared.LivePolls`) and `SpeakerIdentifierType?` (Conference alias). It is dispatched to [CreateLivePollHandler](#createlivepollhandler).
- **Concept introduced**: **identity travels beside the request, never inside it.** The doc comment (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollCommand.cs:7`) states the two caller fields are "bound from the token at the API edge (never from the request)". This is the standard guard against a client claiming to be a speaker or organizer by putting it in the JSON body: the controller reads `CallerSpeakerId` and `CallerIsOrganizer` from the validated JWT and stamps them onto the command. `[Rubric §11, Security]` assesses exactly this boundary between attacker-controlled input and trusted claims; splitting `Request` from the caller fields makes the trust boundary a compile-time shape. `[Rubric §6, CQRS & Event-Driven]` applies because this is the command half of the pattern taught in [Group 05](group-05-cqrs-pipeline.md).
- **Walkthrough**: positional `sealed record (CreateLivePollRequest Request, SpeakerIdentifierType? CallerSpeakerId, bool CallerIsOrganizer)` (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollCommand.cs:14`). The nullable `CallerSpeakerId` encodes "the caller is not a speaker"; `CallerIsOrganizer` is the role bypass. The doc comment records the split rule the handler enforces: event-wide polls require an organizer/admin, session polls also allow the session's assigned speakers (BR-236 shape, `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollCommand.cs:8-9`).
- **Why it's built this way**: keeping authorization inputs on the command (rather than re-reading the HTTP context deep in the handler) keeps the Application layer host-agnostic and unit-testable: a test constructs the command with arbitrary claims and asserts the rights outcome.
- **Where it's used**: validated by [CreateLivePollCommandValidator](#createlivepollcommandvalidator), handled by [CreateLivePollHandler](#createlivepollhandler), constructed by [LivePollsController](#livepollscontroller).

### ILiveEventUIService

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/ILiveEventUIService.cs:7` · Level 1 · interface

- **What it is**: the UI-facing contract for resolving the current published event and its live window. One method, `GetCurrentEventAsync`, returning a nullable [LiveEventContext](#liveeventcontext).
- **Depends on**: [LiveEventContext](#liveeventcontext) and BCL `Task`/`CancellationToken`.
- **Concept introduced**: **nullable-as-absence at a UI boundary.** The doc comment (`MMCA.ADC.Engagement.UI/Services/ILiveEventUIService.cs:10-11`) says the method returns `null` "when no published event exists (or the API is unavailable)". Rather than throwing when there is nothing live, the contract makes "no live event" a first-class, expected return that the ambient listener handles by staying dormant. Note the contrast with its sibling contracts in this group: [ILivePollUIService](#ilivepolluiservice) and [ISessionQuestionUIService](#isessionquestionuiservice) answer with [Result](group-01-result-error-handling.md#result), which distinguishes "nothing there" from "the call failed"; this interface deliberately collapses both into `null` because the caller's behavior is identical either way. `[Rubric §1, SOLID]` applies through Dependency Inversion: components depend on this abstraction, not on the HTTP-bound implementation, so tests can substitute a fake. `[Rubric §18, UI Architecture]` assesses how the UI layer separates data-resolution contracts from rendering; this interface is that boundary for the live layer.
- **Walkthrough**: `Task<LiveEventContext?> GetCurrentEventAsync(CancellationToken cancellationToken = default)` (`MMCA.ADC.Engagement.UI/Services/ILiveEventUIService.cs:14`). The type-level doc names both consumers explicitly, the Happening Now page and the ambient `LiveEventListener` (`MMCA.ADC.Engagement.UI/Services/ILiveEventUIService.cs:4-5`).
- **Why it's built this way**: a one-method interface is the minimum surface the [HappeningNow](#happeningnow) page and the ambient listener need, keeping the contract easy to fake and hard to misuse.
- **Where it's used**: implemented by [LiveEventService](#liveeventservice); consumed by [HappeningNow](#happeningnow) and [LiveEventListener](group-22-engagement-module.md#liveeventlistener).

### SessionLiveUIService

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/SessionLiveUIService.cs:10` · Level 1 · class

- **What it is**: the Engagement-side implementation of the [ISessionLiveUIService](#isessionliveuiservice) extension point: it maps a session id to the route of that session's Live page, so the Conference session-detail page can light up a Live button only when the Engagement module is enabled.
- **Depends on**: [ISessionLiveUIService](#isessionliveuiservice) (the contract, declared in `MMCA.ADC.Engagement.Shared.SessionQuestions`, imported at `MMCA.ADC.Engagement.UI/Services/SessionLiveUIService.cs:1`), [EngagementRoutePaths](group-22-engagement-module.md#engagementroutepaths) (the route builder), and the `SessionIdentifierType` alias.
- **Concept introduced**: **cross-module UI extension point, resolved by module presence.** Conference must not hard-reference an Engagement route, that would couple the two modules. Instead Conference depends on the abstract `ISessionLiveUIService`, and Engagement registers this implementation when its module loads. When Engagement is absent, no implementation is registered and the Live button stays off. `[Rubric §7, Microservices Readiness]` assesses whether modules collaborate through boundaries that survive extraction into separate services; this is the UI-layer version of that discipline, a capability advertised only when its owner is running. `[Rubric §1, SOLID]` applies through Dependency Inversion: Conference depends on the interface, not on the concrete route builder.
- **Walkthrough**: `GetSessionLivePath(SessionIdentifierType sessionId)` (`MMCA.ADC.Engagement.UI/Services/SessionLiveUIService.cs:13`) delegates straight to `EngagementRoutePaths.SessionLive(sessionId)` (`MMCA.ADC.Engagement.UI/Services/SessionLiveUIService.cs:14`). The class is a `sealed` expression-bodied one-liner carrying `/// <inheritdoc />`; all it does is put an Engagement route behind a Conference-visible contract.
- **Why it's built this way**: routing knowledge for the Live page belongs to Engagement, so Engagement owns the string; Conference only needs the abstraction to conditionally render a link.
- **Where it's used**: registered in the Engagement UI module's DI; consumed by the Conference session-detail page to render its Live button, which lands on [SessionLive](#sessionlive).

### ILivePollUIService

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/ILivePollUIService.cs:15` · Level 3 · interface

- **What it is**: the full UI contract for the live-poll layer: read open polls (event-wide or per session) with tallies and the caller's own vote, cast or change a vote, and drive the organizer lifecycle (create, open, close, delete), plus a session-scoped manage list.
- **Depends on**: [LivePollResultsDTO](#livepollresultsdto), [LivePollDTO](#livepolldto), [CreateLivePollRequest](#createlivepollrequest) (all `MMCA.ADC.Engagement.Shared.LivePolls`, imported at `MMCA.ADC.Engagement.UI/Services/ILivePollUIService.cs:1`), [Result](group-01-result-error-handling.md#result) (`MMCA.Common.Shared.Abstractions`, `MMCA.ADC.Engagement.UI/Services/ILivePollUIService.cs:2`), and the `LivePollIdentifierType`/`LivePollOptionIdentifierType`/`EventIdentifierType`/`SessionIdentifierType` aliases.
- **Concept introduced**: **a Result-typed UI contract: a server refusal is data, not an exception.** The type doc states it outright (`MMCA.ADC.Engagement.UI/Services/ILivePollUIService.cs:11-12`): "Every member answers with a `Result`: a server refusal is data the page renders, never an exception. Only the caller's own cancellation still propagates." Every one of the nine members returns `Task<Result>` or `Task<Result<T>>`, so a 403 from a poll the caller may not manage, or a 412 from a stale open, arrives as a value a Blazor page can bind to an alert. `[Rubric §24, Forms/Validation/UX Safety]` assesses whether failure states are renderable rather than fatal; typing the contract on `Result` removes the try/catch from every consuming page. A second idea also appears here, **two result shapes for two audiences**: read-and-vote methods return [LivePollResultsDTO](#livepollresultsdto) (tallies plus the caller's own vote) while the manage views return the richer [LivePollDTO](#livepolldto). `[Rubric §9, API & Contract Design]` covers that fit-the-shape-to-the-consumer split. `[Rubric §11, Security]` applies through the explicit note that manage operations require `engagement:live:manage` and that "the API enforces this regardless of what the UI renders" (`MMCA.ADC.Engagement.UI/Services/ILivePollUIService.cs:8-9`): the UI contract never pretends to be the security boundary.
- **Walkthrough**: attendee and reader path: `GetOpenPollsAsync` (`MMCA.ADC.Engagement.UI/Services/ILivePollUIService.cs:18`), `GetOpenSessionPollsAsync` (`:21`), `GetResultsAsync` (`:24`), `CastVoteAsync` (`:27`, which returns the fresh tallies so a vote needs no follow-up read). Manage path: `GetEventPollsAsync` (`:30`, ALL polls of an event) and `GetSessionManagePollsAsync` (`:36`), whose doc records that the session list is "open to the session's assigned speakers as well as organizers (BR-236), unlike the event-wide manage list" (`:33-34`). Lifecycle: `CreateAsync` (`:39`, creates as Draft), `OpenAsync` (`:42`) and `CloseAsync` (`:45`), each taking a `byte[] rowVersion` alongside the id, and `DeleteAsync` (`:48`, "must not be Open"). The `rowVersion` parameter on the two transitions is the optimistic-concurrency token of [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html): the caller must state which version of the poll it saw. Every method takes a trailing `CancellationToken`.
- **Why it's built this way**: grouping the whole poll lifecycle behind one interface lets the various poll surfaces ([HappeningNow](#happeningnow), [SessionLive](#sessionlive), [SessionLiveModerationPanel](#sessionlivemoderationpanel), [PresenterView](#presenterview)) inject a single dependency and lets tests fake it wholesale, while the `Result` return type keeps every one of those pages free of HTTP error handling.
- **Where it's used**: implemented by [LivePollUIService](#livepolluiservice); consumed by the live-poll Blazor pages and panels.

### ISessionLookupService

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:19` · Level 3 · interface

- **What it is**: the contract for fetching Conference session data for display enrichment inside Engagement pages, returning [SessionInfo](#sessioninfo) projections. It offers a whole-catalog read and a single-session read, both `Result`-typed.
- **Depends on**: [SessionInfo](#sessioninfo), [Result](group-01-result-error-handling.md#result) (`MMCA.Common.Shared.Abstractions`, imported at `MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:1`), the `SessionIdentifierType` alias, and BCL `IReadOnlyDictionary`/`Task`.
- **Concept introduced**: **two reads with an explicit efficiency contract, and absence expressed as a typed failure.** The doc on `GetAllAsync` (`MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:21-26`) is unusually prescriptive: use it "only when a page genuinely needs the whole set (e.g. the bookmark reminder planner, which schedules against every bookmarked session)", and single-session pages "must use `GetByIdAsync` instead of transferring the catalog to label one row". That guidance is the interface teaching its own performance discipline. `[Rubric §12, Performance & Scalability]` assesses avoiding whole-collection transfers to render one item; the split-method contract encodes the fast path directly in the type. The second idea is the `Result` migration: `GetByIdAsync`'s doc states that "a missing session answers an `ErrorType.NotFound` failure rather than the old `null`" (`MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:31-32`), so callers branch on an [ErrorType](group-01-result-error-handling.md#errortype) instead of on a null check that could not distinguish "no such session" from "the fetch broke".
- **Walkthrough**: `GetAllAsync(CancellationToken)` (`MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:27`) returns `Result<IReadOnlyDictionary<SessionIdentifierType, SessionInfo>>`, the full catalog keyed by id. `GetByIdAsync(SessionIdentifierType, CancellationToken)` (`MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:34`) returns `Result<SessionInfo>`, failing with `NotFound` rather than returning an empty value.
- **Why it's built this way**: keeping both shapes on one interface lets pages pick the right cost for their need while the implementation shares one `APIClient` and one mapping; typing both on `Result` means a Conference outage is a renderable state, not an unhandled exception on a bookmark list.
- **Where it's used**: implemented by [SessionLookupService](#sessionlookupservice); consumed by bookmark pages and by [SessionReminderPlanner](group-22-engagement-module.md#sessionreminderplanner)'s scheduling path (the whole-catalog case its own doc names).

### ISessionQuestionUIService

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/ISessionQuestionUIService.cs:15` · Level 3 · interface

- **What it is**: the UI contract for the session Q&A layer: attendees read approved questions and submit their own, moderators work a queue (approve / dismiss / mark-answered), and anyone can upvote or remove an upvote.
- **Depends on**: [SessionQuestionDTO](#sessionquestiondto) and [SubmitQuestionRequest](#submitquestionrequest) (`MMCA.ADC.Engagement.Shared.SessionQuestions`, imported at `MMCA.ADC.Engagement.UI/Services/ISessionQuestionUIService.cs:1`), [Result](group-01-result-error-handling.md#result), and the `SessionIdentifierType`/`SessionQuestionIdentifierType` aliases.
- **Concept introduced**: **two views of the same queue.** `GetQuestionsAsync` (`MMCA.ADC.Engagement.UI/Services/ISessionQuestionUIService.cs:18`) returns the attendee view (every approved question plus the caller's own pending/dismissed ones), while `GetModerationQueueAsync` (`:21`) returns all statuses with Pending first. The same two disciplines as its poll sibling appear verbatim: every member answers with a [Result](group-01-result-error-handling.md#result) and only caller cancellation propagates (`MMCA.ADC.Engagement.UI/Services/ISessionQuestionUIService.cs:11-12`), and moderation needs organizer/admin or an assigned-speaker claim with "the API enforces this regardless of what the UI renders (BR-236)" (`:8-9`). `[Rubric §24, Forms/Validation/UX Safety]` assesses how submission and moderation flows are shaped; the split read methods keep an attendee from seeing another attendee's un-approved question while giving moderators the full picture. `[Rubric §11, Security]` applies through the server-authoritative moderation note.
- **Walkthrough**: reads: `GetQuestionsAsync` (`:18`), `GetModerationQueueAsync` (`:21`). Submit: `SubmitAsync` (`:24`), whose doc notes the question "starts at the event's moderation default (BR-233)". Moderation: `ApproveAsync` (`:27`), `DismissAsync` (`:30`), `MarkAnsweredAsync` (`:33`), each taking `(SessionQuestionIdentifierType id, byte[] rowVersion, CancellationToken)` so the write is conditional on the version the moderator saw ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)) and two moderators racing cannot silently overwrite each other. Upvoting: `UpvoteAsync` (`:36`) and `RemoveUpvoteAsync` (`:39`), each returning `Result<int>`, the fresh upvote count, so the button can re-render from the response.
- **Why it's built this way**: one interface spans attendee, moderator, and voter roles so a session Live page injects a single service; the API remains the enforcer, so the contract can expose the moderation methods without granting rights. Returning the count from the upvote verbs saves a follow-up read on the hottest interaction in the room.
- **Where it's used**: implemented by [SessionQuestionUIService](#sessionquestionuiservice); consumed by [SessionLive](#sessionlive), [SessionLiveModerationPanel](#sessionlivemoderationpanel), and [PresenterView](#presenterview).

### LivePollUIService

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/LivePollUIService.cs:15` · Level 4 · class

- **What it is**: the HTTP implementation of [ILivePollUIService](#ilivepolluiservice), calling the Gateway's `/LivePolls` routes with an authenticated client, a retry pipeline, and Problem-Details-to-`Result` translation.
- **Depends on**: [AuthenticatedServiceBase](group-15-common-ui-framework.md#authenticatedservicebase) (base class supplying `CreateAuthenticatedClientAsync`, `RetryPolicy`, and `NewIdempotencyKey`), [HttpResultExecutor](group-15-common-ui-framework.md#httpresultexecutor) and [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader), [ConcurrencyETag](group-08-auth.md#concurrencyetag) and [IdempotencyHeaders](group-08-auth.md#idempotencyheaders) (`MMCA.Common.Shared.Http`), [ILivePollUIService](#ilivepolluiservice) and the poll DTO/request records, plus `IHttpClientFactory` and [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) (`MMCA.ADC.Engagement.UI/Services/LivePollUIService.cs:15-17`).
- **Concept introduced**: **the two-halves translation of an HTTP call into a `Result`.** Every method here has the same skeleton: the body is wrapped in `HttpResultExecutor.ExecuteAsync(..., cancellationToken)` and ends in a `ProblemDetailsResultReader.ReadAsync` call. Those two do complementary jobs: the reader converts a *response* (an RFC 9457 Problem Details body from the API back into the original [Error](group-01-result-error-handling.md#error) list, preserving [ErrorType](group-01-result-error-handling.md#errortype)), and the executor converts the *absence* of a response (a refused connection, DNS failure, dropped socket, or `HttpClient` timeout) into a transport failure, while rethrowing an `OperationCanceledException` that the caller's own token caused. Together they are what makes the `Result`-typed contract in [ILivePollUIService](#ilivepolluiservice) honest. Between them sits `RetryPolicy.ExecuteAsync` from the base. `[Rubric §10, Cross-Cutting]` assesses whether resilience and error translation are applied uniformly; every method here gets all three for free by construction. `[Rubric §26, Front-End Security]` applies because each call acquires a bearer-token-bearing client via `CreateAuthenticatedClientAsync`.
- **Walkthrough**: `Endpoint = "livepolls"` (`MMCA.ADC.Engagement.UI/Services/LivePollUIService.cs:19`). Reads: `GetOpenPollsAsync` (`:22`) GETs `livepolls/open?eventId=` built with `string.Create(CultureInfo.InvariantCulture, ...)` (`:30`), and `read.Map(...)` widens `List<LivePollResultsDTO>` to `IReadOnlyList<...>` (`:36`); `GetOpenSessionPollsAsync` (`:41`) is the same call keyed by `sessionId` (`:49`); `GetResultsAsync` (`:60`) GETs `livepolls/{pollId}/results` (`:68`); `GetEventPollsAsync` (`:106`) GETs `livepolls?eventId=` (`:114`) and `GetSessionManagePollsAsync` (`:125`) GETs `livepolls/manage?sessionId=` (`:133`), both returning [LivePollDTO](#livepolldto) lists. Non-idempotent writes carry an idempotency key: `CastVoteAsync` (`:78`) adds `IdempotencyHeaders.IdempotencyKey` with `NewIdempotencyKey()` (`:93`) then POSTs a [CastVoteRequest](#castvoterequest) (`:95`) to `livepolls/{pollId}/votes` (`:98`), and `CreateAsync` (`:144`) does the same before POSTing the [CreateLivePollRequest](#createlivepollrequest) (`:156`, `:159-160`). The long comments at `:87-92` and `:152-155` explain the placement precisely: the key is minted ONCE outside the retry pipeline, because generating it inside the retried delegate would give every attempt a fresh key and leave the server nothing to deduplicate on, turning a retried vote into a second write. Lifecycle: `OpenAsync` (`:168`) and `CloseAsync` (`:172`) both delegate to `PostLifecycleAsync(pollId, action, rowVersion, ...)` (`:190`), which formats the row version with `ConcurrencyETag.Format` (`:197`) and, per attempt, builds a fresh `HttpRequestMessage` carrying `ConcurrencyETag.IfMatchHeaderName` (`:205-206`) because a sent request message cannot be re-sent by the retry pipeline (`:199-201`); a stale-view open or close answers 412 Precondition Failed. `DeleteAsync` (`:176`) DELETEs `livepolls/{pollId}` (`:183`) with no precondition.
- **Why it's built this way**: folding the repeated client / retry / read ceremony into shared helpers keeps each method down to its URL and payload, so the class reads as a faithful map of the interface onto REST routes. The idempotency-key and If-Match placements are the two spots where that ceremony genuinely matters, and both carry an in-code explanation so a later edit does not quietly move them inside the retry delegate ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html), [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)).
- **Where it's used**: registered as the `ILivePollUIService` in the Engagement UI module; injected into [HappeningNow](#happeningnow), [SessionLivePollPanel](#sessionlivepollpanel), [SessionLiveModerationPanel](#sessionlivemoderationpanel), and [PresenterView](#presenterview).

### SessionLookupService

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/SessionLookupService.cs:13` · Level 4 · class

- **What it is**: the implementation of [ISessionLookupService](#isessionlookupservice): it fetches sessions from the Conference API and builds a session-keyed lookup of [SessionInfo](#sessioninfo) projections for display enrichment.
- **Depends on**: [ISessionLookupService](#isessionlookupservice), [SessionDTO](group-17-conference-domain.md#sessiondto) (Conference shared), [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt), [HttpResultExecutor](group-15-common-ui-framework.md#httpresultexecutor) and [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader), and `IHttpClientFactory` (`MMCA.ADC.Engagement.UI/Services/SessionLookupService.cs:13`). Note it uses the plain `"APIClient"` (`:22`, `:54`) rather than [AuthenticatedServiceBase](group-15-common-ui-framework.md#authenticatedservicebase), because session listing is public and output-cached.
- **Concept introduced**: **single-page catalog transfer with a documented cap.** `GetAllAsync` fetches `sessions?includeFKs=false&includeChildren=false` (`:27`) and the inline comment (`:24-25`) explains that the base `/sessions` endpoint "has no pageSize parameter: it always serves a single page capped at MaxPageSize (500), which comfortably covers a conference's session catalog", so no pagination loop is needed. That comment documents why a whole-catalog fetch is safe here, complementing the efficiency contract [ISessionLookupService](#isessionlookupservice) declares. `[Rubric §12, Performance & Scalability]` assesses transfer sizing; the `includeFKs=false&includeChildren=false` query and the five-field [SessionInfo](#sessioninfo) projection trim the payload on both the wire and the heap.
- **Walkthrough**: `GetAllAsync` (`:17`) reads a `PagedCollectionResult<SessionDTO>` through `ProblemDetailsResultReader.ReadAsync` (`:30`), then `read.Map(...)` (`:33`) builds a `Dictionary<SessionIdentifierType, SessionInfo>` by looping `page.Items` (`:36-40`) and widens it to `IReadOnlyDictionary` (`:42`). Because `Map` runs only on success, no null-coalescing of the page is needed: a failed read short-circuits with the API's own errors. `GetByIdAsync` (`:48`) GETs `sessions/{sessionId}` with an invariant-culture interpolated URI (`:57`) and maps the single [SessionDTO](group-17-conference-domain.md#sessiondto) into a [SessionInfo](#sessioninfo) (`:64-65`); a missing session answers 404, which the reader turns into a `NotFound` failure, and the comment records that pages "render exactly the same 'session unavailable' state for it" (`:60-61`). Both methods run inside `HttpResultExecutor.ExecuteAsync` (`:19`, `:51`).
- **Why it's built this way**: building the dictionary once lets a page label many bookmark rows with O(1) lookups, while the per-id method serves single-session pages without paying the catalog transfer: exactly the fast/slow split the interface prescribes. Neither read passes through `RetryPolicy`, unlike the token-bearing services, because both are cheap idempotent GETs against a cached public endpoint.
- **Where it's used**: registered as `ISessionLookupService`; consumed by bookmark ("My Schedule") pages and the reminder planning path.

### SessionQuestionUIService

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/SessionQuestionUIService.cs:15` · Level 4 · class

- **What it is**: the HTTP implementation of [ISessionQuestionUIService](#isessionquestionuiservice), calling the Gateway's `/SessionQuestions` routes with the same executor + retry + reader shape as [LivePollUIService](#livepolluiservice).
- **Depends on**: [AuthenticatedServiceBase](group-15-common-ui-framework.md#authenticatedservicebase), [HttpResultExecutor](group-15-common-ui-framework.md#httpresultexecutor), [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader), [ConcurrencyETag](group-08-auth.md#concurrencyetag), [IdempotencyHeaders](group-08-auth.md#idempotencyheaders), [ISessionQuestionUIService](#isessionquestionuiservice), [SessionQuestionDTO](#sessionquestiondto)/[SubmitQuestionRequest](#submitquestionrequest), `IHttpClientFactory`, and [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) (`MMCA.ADC.Engagement.UI/Services/SessionQuestionUIService.cs:15-17`).
- **Concept introduced**: this is the structural sibling of [LivePollUIService](#livepolluiservice) and reuses the same triad (executor wrapper, `RetryPolicy.ExecuteAsync`, `ProblemDetailsResultReader.ReadAsync`) introduced there, so the concept is not re-taught. What differs is the count-returning upvote pair and the moderation helper. `[Rubric §10, Cross-Cutting]` and `[Rubric §26, Front-End Security]` apply for the same inherited-resilience and token-flow reasons as its poll sibling.
- **Walkthrough**: `Endpoint = "sessionquestions"` (`MMCA.ADC.Engagement.UI/Services/SessionQuestionUIService.cs:19`). Reads: `GetQuestionsAsync` (`:22`) GETs `sessionquestions?sessionId=` (`:30`) and `GetModerationQueueAsync` (`:41`) GETs `sessionquestions/moderation?sessionId=` (`:49`), each widening the deserialized `List<SessionQuestionDTO>` via `read.Map` (`:36`, `:55`). `SubmitAsync` (`:60`) mints an idempotency key outside the retry pipeline (`:73`) before POSTing the [SubmitQuestionRequest](#submitquestionrequest) (`:76-77`); the comment (`:68-72`) names the concrete failure it prevents, an attendee whose submit times out over conference wifi posting the same question twice. Moderation: `ApproveAsync` (`:85`), `DismissAsync` (`:89`), and `MarkAnsweredAsync` (`:93`) each delegate to `PostModerationAsync(id, action, rowVersion, ...)` (`:126`) with the action strings `"approve"`, `"dismiss"`, and `"answered"`; that helper formats `ConcurrencyETag.Format(rowVersion)` (`:133`) and builds a fresh `HttpRequestMessage` per attempt carrying `If-Match` (`:141-142`), so "two moderators racing surface as 412 Precondition Failed" (`:136`). Upvotes: `UpvoteAsync` (`:97`) POSTs `sessionquestions/{id}/upvotes` with a null body (`:104`) and `RemoveUpvoteAsync` (`:112`) DELETEs the same route (`:119`); both deserialize the fresh count with `ProblemDetailsResultReader.ReadAsync<int>` (`:107`, `:122`) and neither carries a key or a precondition, because setting or clearing one caller's upvote is naturally idempotent.
- **Why it's built this way**: one private helper (`PostModerationAsync`) collapses the repeated conditional-POST ceremony for the three moderation verbs, leaving each public method to state only its action string. The deliberate asymmetry (keys on submit, If-Match on moderation, neither on upvote) matches each operation's actual retry hazard rather than applying one blanket policy.
- **Where it's used**: registered as `ISessionQuestionUIService`; consumed by [SessionLive](#sessionlive), [SessionLiveModerationPanel](#sessionlivemoderationpanel), and [PresenterView](#presenterview).

### CreateLivePollRequestValidator

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollRequestValidator.cs:10` · Level 7 · class

- **What it is**: the FluentValidation validator for the [CreateLivePollRequest](#createlivepollrequest) body: it checks the event id, question text, and the option list before the handler runs (BR-220).
- **Depends on**: `AbstractValidator<CreateLivePollRequest>` (FluentValidation), [LivePollInvariants](#livepollinvariants) (the domain's shared limits, imported at `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollRequestValidator.cs:2`), and the `EventIdentifierType` alias.
- **Concept introduced**: **input validation reusing domain constants, not magic numbers.** Every length and count bound comes from `LivePollInvariants` (`QuestionMaxLength`, `MinOptions`, `MaxOptions`, `OptionTextMaxLength`), so the edge validator and the aggregate's own `Create` guard agree by construction rather than by two copies of the same number. `[Rubric §24, Forms/Validation/UX Safety]` assesses layered validation with actionable messages; each rule carries both a human `WithMessage` and a machine `WithErrorCode` (for example `"LivePoll.Question.Required"`, `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollRequestValidator.cs:22`) so a client can branch or localize on the code. `[Rubric §14, Testability]` applies because a pure validator with no dependencies is trivially unit-tested.
- **Walkthrough**: `EventId` must not equal `default(EventIdentifierType)` (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollRequestValidator.cs:14-17`). `Question` is `NotEmpty` then `MaximumLength(LivePollInvariants.QuestionMaxLength)` (`:19-25`). `Options` is `NotNull` then constrained by a `Must` list-pattern predicate `options is { Count: >= LivePollInvariants.MinOptions and <= LivePollInvariants.MaxOptions }` (`:31`), which also handles the null case in the same expression. `RuleForEach(x => x.Options)` (`:35`) then applies `NotEmpty` plus `MaximumLength(LivePollInvariants.OptionTextMaxLength)` to each option string (`:36-41`). Every rule pairs a message with an error code.
- **Why it's built this way**: validating shape at the edge lets the handler assume a well-formed request and spend its logic on authorization and cross-service checks; sourcing bounds from [LivePollInvariants](#livepollinvariants) keeps edge and domain in lockstep even when a limit changes.
- **Where it's used**: invoked by [CreateLivePollCommandValidator](#createlivepollcommandvalidator) via `SetValidator`, which is how it reaches the Validating decorator of the CQRS pipeline (see [Group 05](group-05-cqrs-pipeline.md)).

### CreateLivePollCommandValidator

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollCommandValidator.cs:9` · Level 8 · class

- **What it is**: the validator the pipeline actually resolves for [CreateLivePollCommand](#createlivepollcommand): it asserts the command carries a non-null `Request` and delegates the request's field rules to [CreateLivePollRequestValidator](#createlivepollrequestvalidator) (BR-220).
- **Depends on**: `AbstractValidator<CreateLivePollCommand>` (FluentValidation) and [CreateLivePollRequestValidator](#createlivepollrequestvalidator).
- **Concept introduced**: **composed validators via `SetValidator`.** The command validator does not restate the body rules; it validates the wrapper concern (a `Request` must be present) and then `SetValidator(new CreateLivePollRequestValidator())` (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollCommandValidator.cs:16`) reuses the request validator for the nested shape. This is the FluentValidation composition idiom, and it is why the pipeline (which resolves a validator for the *command* type) still enforces the body rules. `[Rubric §24, Forms/Validation/UX Safety]` and `[Rubric §15, Best Practices & Code Quality]` apply: one source of truth for body rules, composed rather than duplicated.
- **Walkthrough**: the constructor is a single expression-bodied `RuleFor(x => x.Request)` chain (`MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollCommandValidator.cs:11-16`): `NotNull` with message "Request body is required." and code `"LivePoll.Request.Required"` (`:13-15`), then `SetValidator` delegating to the request validator (`:16`). The caller-identity members of the command (`CallerSpeakerId`, `CallerIsOrganizer`) carry no rules here, deliberately: they are token-derived, so there is nothing a client could get wrong, and the authorization decision belongs to [CreateLivePollHandler](#createlivepollhandler).
- **Why it's built this way**: the Validating decorator resolves a validator for the command type, so a thin command validator is needed to bridge to the reusable request validator without copying its rules.
- **Where it's used**: auto-discovered by assembly scanning and applied by the Validating decorator before [CreateLivePollHandler](#createlivepollhandler) runs.

### LiveEventService

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/LiveEventService.cs:14` · Level 9 · class

- **What it is**: the implementation of [ILiveEventUIService](#iliveeventuiservice): it fetches the currently-live-or-next published event from the Conference API and computes its live window into a [LiveEventContext](#liveeventcontext), degrading to `null` when nothing is live or the API is down.
- **Depends on**: [ILiveEventUIService](#iliveeventuiservice), [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) (the shared selection plus window math), [EventDTO](group-17-conference-domain.md#eventdto) and [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt), [LiveEventContext](#liveeventcontext), and `IHttpClientFactory` (`MMCA.ADC.Engagement.UI/Services/LiveEventService.cs:14`). It uses the plain `"APIClient"` (`:21`), not the authenticated base: the published-events read is public.
- **Concept introduced**: **fail-soft resolution: absence and failure both become `null`.** This is the one service in this unit that has not moved to the `Result` shape, and the choice is deliberate rather than an omission: the type doc states that "API failures degrade to `null` so the live layer simply stays dormant" (`MMCA.ADC.Engagement.UI/Services/LiveEventService.cs:11-12`), and the only consumer behavior for both cases is "render nothing". `[Rubric §29, Resilience & Business Continuity]` assesses graceful degradation under a dependency outage; here an unavailable Conference API turns the live layer off instead of erroring a page. `[Rubric §12, Performance & Scalability]` applies because the same public, output-cached events read backs this call. The trade-off worth naming: a page cannot tell an outage from "the conference has not started", so no diagnostic message is possible at this boundary.
- **Walkthrough**: `GetCurrentEventAsync` (`:17`) opens a `try` (`:19`), creates the `"APIClient"` (`:21`), and fetches `events?includeFKs=false&includeChildren=false` as `PagedCollectionResult<EventDTO>` via `GetFromJsonAsync` (`:23-25`). It hands `CurrentEventSelector.SelectCurrentOrNext` the published subset with a null-safe `wrapper?.Items?.Where(e => e.IsPublished) ?? []` (`:28`), accessor lambdas for start date, end date, and time zone (`:29-31`), and `DateTime.UtcNow` (`:32`); a null selection returns `null` (`:33-36`). On a hit it computes `(startUtc, endUtc)` from `CurrentEventSelector.GetLiveWindowUtc(StartDate, EndDate, TimeZone)` (`:38-39`) and constructs the [LiveEventContext](#liveeventcontext) from the event id, name, time zone, and window (`:41-46`). A thrown `HttpRequestException` is caught (`:48`) and also returns `null`, with the comment "API unavailable, the live layer stays dormant" (`:50-51`).
- **Why it's built this way**: delegating both "which event" and "what window" to [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) means the UI and the API share one implementation of the conference-day math, which is what lets [LiveEventContext](#liveeventcontext) claim to mirror the backend window exactly. The two `null` paths keep the ambient listener silent whenever there is nothing to show.
- **Caveats / not-in-source**: the `catch` covers `HttpRequestException` only (`:48`). A malformed JSON body would surface a `JsonException` instead, and how that propagates is not handled here; nothing in this file states the intended behavior for it.
- **Where it's used**: registered as `ILiveEventUIService`; consumed by [HappeningNow](#happeningnow) and the ambient [LiveEventListener](group-22-engagement-module.md#liveeventlistener).

### CreateLivePollHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollHandler.cs:20` · Level 10 · class

- **What it is**: the command handler that creates a live poll as Draft, enforcing the poll business rules (BR-220 shape, BR-221 created as Draft, BR-222 published event, BR-236 authoring rights) before persisting a [LivePoll](#livepoll) aggregate and returning its [LivePollDTO](#livepolldto).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (repository plus save), [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) (the Conference cross-module lookup returning [SessionLiveInfo](group-17-conference-domain.md#sessionliveinfo)/[EventLiveInfo](group-17-conference-domain.md#eventliveinfo)), [LivePoll](#livepoll) and its [LivePollAuthorization](#livepollauthorization) helper, [LivePollDTOMapper](#livepolldtomapper), [Result](group-01-result-error-handling.md#result)/[Error](group-01-result-error-handling.md#error), `ILogger<CreateLivePollHandler>`, and [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult). It is a `sealed partial class` so the source generator can emit its logger method.
- **Concept introduced**: **branching authorization across a service boundary before touching the aggregate.** The handler splits on whether the request is session-scoped (`request.SessionId is { } sessionId`, `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollHandler.cs:34`). A session poll fetches `GetSessionLiveInfoAsync` across the Conference boundary (`:38`), guards that the session belongs to the given event (`:45`), then calls `LivePollAuthorization.EnsureCanManage` *with* the session info so assigned speakers are allowed (`:54-55`). An event-wide poll instead requires organizer/admin by passing `sessionInfo: null` to the same helper (`:64-65`) and only then checks publication via `GetEventLiveInfoAsync` (`:70`). Only after rights and publish state pass does it call `LivePoll.Create` (`:86`). `[Rubric §6, CQRS & Event-Driven]` assesses the command-handler shape; `[Rubric §7, Microservices Readiness]` applies because authorization facts are pulled from Conference through a service interface rather than a database join, with an explicit disabled-stub fallback; `[Rubric §11, Security]` applies because rights are enforced server-side from the token-derived claims carried on [CreateLivePollCommand](#createlivepollcommand).
- **Walkthrough**: the primary constructor injects the four collaborators (`:20-24`). `HandleAsync` (`:27`) resolves a local `isPublished` down either branch. In the session branch, a failed lookup short-circuits with the upstream errors (`:39-40`), and the event-match check is skipped when the info carries a default event id, because "the disabled-stub fallback reports a default event id" (`:44-45`): a mismatch otherwise fails with `Error.Invariant("LivePoll.SessionNotInEvent", ...)` targeting `SessionId` (`:47-52`). `isPublished` then comes from `sessionInfo.IsPublished` (`:59`) or from `infoResult.Value!.IsPublished` (`:74`). An unpublished target is rejected with `Error.Invariant("LivePoll.EventNotPublished", "Polls can only be created for a published event.", ...)` (`:79-84`). The aggregate is built with `LivePoll.Create(request.EventId, request.SessionId, request.Question, request.Options)` (`:86`), whose failure is propagated as-is (`:87-88`). On success the handler takes the typed repository `unitOfWork.GetRepository<LivePoll, LivePollIdentifierType>()` (`:91`), `AddAsync`es the poll (`:92`), commits with `SaveChangesAsync(cancellationToken).ConfigureAwait(false)` (`:94`), emits the source-generated `LogLivePollCreated(logger, poll.Id, request.EventId)` (`:96`, declared `[LoggerMessage(Level = LogLevel.Information, ...)]` at `:101-102`), and returns `Result.Success(dtoMapper.MapToDTO(poll))` (`:98`). Every early guard returns `Result.Failure<LivePollDTO>` carrying the upstream errors, so no exception is used for control flow.
- **Why it's built this way**: keeping authorization and publish-state checks in the handler (not the aggregate) lets [LivePoll](#livepoll)`.Create` stay purely about poll shape, while cross-service facts come from the Conference boundary. The class doc records that the same boundary "also enforces the session eligibility rules BR-49/BR-91" (`:17-18`), so Engagement does not re-implement Conference's rules. The source-generated `[LoggerMessage]` gives allocation-free structured logging (`[Rubric §13, Observability & Operability]`).
- **Where it's used**: dispatched for [CreateLivePollCommand](#createlivepollcommand) through the CQRS decorator pipeline; reached from the `/livepolls` POST on [LivePollsController](#livepollscontroller) that [LivePollUIService](#livepolluiservice)'s `CreateAsync` calls.

### ModerateQuestionCommand
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Moderate` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Moderate/ModerateQuestionCommand.cs:15` · Level 1 · record

- **What it is**: the CQRS command that carries one moderation action (approve, dismiss, mark-answered) against a single session question, together with the caller's identity as resolved at the API edge and the concurrency token the caller stated in `If-Match`.
- **Depends on**: [`ModerationAction`](#moderationaction) (the action enum, same group) and the module identifier aliases `SessionQuestionIdentifierType` (Engagement `Shared`) / `SpeakerIdentifierType` (Conference `Shared`); handled through the [`MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#mutateentityhandlerbasetcommand-tentity-tidentifiertype) workflow, which is itself an [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult).
- **Concept introduced, identity-from-token commands.** `[Rubric §11, Security]` assesses whether authorization inputs come from a trusted source rather than the request body. Here the command records `CallerSpeakerId` and `CallerIsOrganizer` (`ModerateQuestionCommand.cs:18-19`), which the controller binds from JWT claims, never from client-supplied JSON, so an attacker cannot claim organizer rights by editing the payload. The doc comment states the rule the pair encodes (BR-236: organizers and admins moderate everything, a session's assigned speakers moderate their own session's questions, `ModerateQuestionCommand.cs:6-8`). `[Rubric §6, CQRS & Event-Driven]` is the plain command-as-record shape.
- **Walkthrough**: a `sealed record` with five positional members (`ModerateQuestionCommand.cs:15-20`): `QuestionId` (which question), `Action` (the [`ModerationAction`](#moderationaction) to apply), `CallerSpeakerId` (nullable `SpeakerIdentifierType?`, present only for speakers), `CallerIsOrganizer` (a `bool` set when the caller holds the Organizer or Admin role), and `RowVersion`. That last member is a **non-nullable** `byte[]` (`:20`): the doc comment says it is read from the request's `If-Match` header (`:14`), so the optimistic-concurrency check of [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html) is not opt-in on this command. There is no unconditional call path that constructs it without a token.
- **Why it's built this way**: keeping caller identity *in the command* (rather than reaching into `HttpContext` from the handler) keeps the Application layer host-agnostic and unit-testable, and makes the trust boundary explicit, since the API edge is the only place that reads claims. Making the token a required member rather than an optional trailing parameter means the endpoint contract (conditional-only) and the command shape cannot drift apart.
- **Where it's used**: constructed by [`SessionQuestionsController`](#sessionquestionscontroller)'s private `ModerateAsync` (`SessionQuestionsController.cs:224-230`), which the three moderation verbs delegate to with a fixed [`ModerationAction`](#moderationaction) and the token that [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute)`.RequiredToken` pulled off the header (`SessionQuestionsController.cs:145,171,197`); handled by [`ModerateQuestionHandler`](#moderatequestionhandler).

### LivePollChanged
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.LivePolls.DomainEvents` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/DomainEvents/LivePollChanged.cs:17` · Level 2 · record

- **What it is**: the single domain event a [`LivePoll`](#livepoll) raises for its whole lifecycle: created, opened, closed, or soft-deleted.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) (base), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) (the change classifier), [`LivePollStatus`](#livepollstatus) (the lifecycle status), and the `LivePollIdentifierType` / `EventIdentifierType` aliases.
- **Concept introduced, one event carrying a state discriminator (BR-60).** `[Rubric §6, CQRS & Event-Driven]` assesses whether events carry enough context to be acted on without a re-read. Rather than four separate `Created` / `Opened` / `Closed` / `Deleted` events, this codebase raises **one** event whose [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) says *what kind* of change happened and whose [`LivePollStatus`](#livepollstatus) says the *resulting* lifecycle state (doc comment, `LivePollChanged.cs:7-11`). A consumer switches on those two fields. This BR-60 convention is shared by all four live-layer events below, so learn it once here.
- **Walkthrough**: a `sealed record class` deriving from [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) with four positional members (`LivePollChanged.cs:17-22`): `State` (`:18`), `PollId` (`:19`), `EventId` (`:20`), `Status` (`:21`). There is no behavior; an event is an immutable fact.
- **Why it's built this way**: the base carries the event identity and timestamp, and collapsing the transition matrix into one typed record keeps the outbox schema and the handler set small while still letting a handler distinguish an open from a close ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) for the outbox that drains domain events; [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) for the live-channel transport).
- **Where it's used**: raised inside [`LivePoll`](#livepoll)'s `Create` / `Open` / `Close` / `Delete` (`LivePoll.cs:94,131,154,228`).
- **Caveats / not-in-source**: unlike its three siblings, `LivePollChanged` has **no** `IDomainEventHandler<LivePollChanged>` implementation anywhere in the ADC source today. Poll lifecycle broadcasts are enqueued directly by the poll command handlers; the event is raised and dispatched, but nothing in-repo subscribes to it.

### LivePollVoteChanged
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.LivePolls.DomainEvents` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/DomainEvents/LivePollVoteChanged.cs:21` · Level 2 · record

- **What it is**: the single domain event a [`LivePollVote`](#livepollvote) raises when a vote is cast, changed to another option, or soft-deleted.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), and the `LivePollVoteIdentifierType` / `LivePollIdentifierType` / `LivePollOptionIdentifierType` / `UserIdentifierType` aliases.
- **Concept introduced, the zero-id trap on `Added` events.** `[Rubric §6, CQRS & Event-Driven]` also covers whether a consumer can actually correlate an event back to its row. This entity's identity is database-generated (`[IdValueGenerated]`, see [`LivePollVote`](#livepollvote)), and the event is constructed **before** the INSERT runs and captured by value, so `VoteId` is **zero** for a brand-new vote and is never re-stamped afterwards (`LivePollVoteChanged.cs:11-17`). A reactivated vote does carry a real id, because that row already exists. The documented contract is therefore: correlate on `PollId` and `UserId`, which are both set before the event is raised, and never on `VoteId`. The same trap and the same workaround appear on [`SessionQuestionChanged`](#sessionquestionchanged) and [`SessionQuestionUpvoteChanged`](#sessionquestionupvotechanged).
- **Concept reinforced, BR-60 single-event pattern** (introduced at [`LivePollChanged`](#livepollchanged); restated at `LivePollVoteChanged.cs:8`). Here the payload additionally carries the `OptionId` chosen *after* the change, so a downstream tally recomputation knows which option moved.
- **Walkthrough**: a `sealed record class : BaseDomainEvent` with five positional members (`LivePollVoteChanged.cs:21-27`): `State` (`:22`), `VoteId` (`:23`), `PollId` (`:24`), `OptionId` (`:25`), `UserId` (`:26`).
- **Why it's built this way**: votes are high-frequency, so the event stays a thin id-only fact with no denormalized counts; consumers that need tallies recompute them through [`LivePollResultsBuilder`](#livepollresultsbuilder).
- **Where it's used**: raised inside [`LivePollVote`](#livepollvote)'s `Create` / `ChangeOption` / `Reactivate` / `Delete` (`LivePollVote.cs:67,86,109,125`); consumed by [`LivePollVoteChangedHandler`](#livepollvotechangedhandler), which re-reads the poll with its options, rebuilds the tallies, and enqueues a `poll.results-changed` broadcast (`LivePollVoteChangedHandler.cs:41,57-62,73,79-82`).

### SessionQuestionChanged
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.SessionQuestions.DomainEvents` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/SessionQuestions/DomainEvents/SessionQuestionChanged.cs:30` · Level 2 · record

- **What it is**: the single domain event a [`SessionQuestion`](#sessionquestion) raises when it is submitted, moderated, or soft-deleted.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), [`QuestionStatus`](#questionstatus), and the `SessionQuestionIdentifierType` / `SessionIdentifierType` / `UserIdentifierType` aliases.
- **Concept reinforced, BR-60 single-event pattern** (see [`LivePollChanged`](#livepollchanged)). `[Rubric §6, CQRS & Event-Driven]`. The Q&A analogue of [`LivePollChanged`](#livepollchanged): [`QuestionStatus`](#questionstatus) rides along so a handler can tell a Pending question from an Approved, Dismissed, or Answered one (doc comment, `SessionQuestionChanged.cs:8-11`).
- **Concept reinforced, the zero-id trap** (see [`LivePollVoteChanged`](#livepollvotechanged)). `QuestionId` is **zero** on the `Added` path because the identity is generated by the INSERT and the event is captured while the aggregate is still new (`SessionQuestionChanged.cs:16-22`). This is exactly why `UserId` is on the event at all: it is carried rather than read back from the row precisely because `QuestionId` is unusable on that path (`:24-28`). `[Rubric §30, Compliance/Privacy/Data Governance]` is worth noting here: the same doc comment states `UserId` is **never surfaced on a DTO**, because questions display anonymously (BR-238). The event is an internal correlation channel, not a projection source.
- **Walkthrough**: a `sealed record class : BaseDomainEvent` with five positional members (`SessionQuestionChanged.cs:30-36`): `State` (`:31`), `QuestionId` (`:32`), `SessionId` (`:33`), `UserId` (`:34`), `Status` (`:35`).
- **Why it's built this way**: identical rationale to [`LivePollChanged`](#livepollchanged), a compact lifecycle fact instead of five per-transition event types, with the submitter id added as the only reliable correlation key on the create path.
- **Where it's used**: raised inside [`SessionQuestion`](#sessionquestion) on create, on each of the three moderation transitions, and on delete (`SessionQuestion.cs:109,134,158,190,234`); consumed by [`SessionQuestionSubmittedPointsHandler`](group-22-engagement-module.md#sessionquestionsubmittedpointshandler), which must filter to the submission case because the same event also fires for moderation and deletion (`SessionQuestionSubmittedPointsHandler.cs:53,60-63`).

### SessionQuestionUpvoteChanged
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.SessionQuestions.DomainEvents` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/SessionQuestions/DomainEvents/SessionQuestionUpvoteChanged.cs:20` · Level 2 · record

- **What it is**: the single domain event a [`SessionQuestionUpvote`](#sessionquestionupvote) raises when an upvote is cast, reactivated, or removed (soft-deleted).
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), and the `SessionQuestionUpvoteIdentifierType` / `SessionQuestionIdentifierType` / `UserIdentifierType` aliases.
- **Concept reinforced, BR-60 single-event pattern** (see [`LivePollChanged`](#livepollchanged)) plus the zero-id trap (see [`LivePollVoteChanged`](#livepollvotechanged)). `[Rubric §6, CQRS & Event-Driven]`. This is the thinnest of the four: an upvote has only two meaningful states, so the doc comment notes `Added` covers both cast and reactivated while `Deleted` covers un-upvoted (`SessionQuestionUpvoteChanged.cs:10`), and `UpvoteId` carries the same "zero on a brand-new row, real on a reactivation" caveat with `QuestionId` and `UserId` as the correlation keys (`:11-17`).
- **Walkthrough**: a `sealed record class : BaseDomainEvent` with four positional members (`SessionQuestionUpvoteChanged.cs:20-25`): `State` (`:21`), `UpvoteId` (`:22`), `QuestionId` (`:23`), `UserId` (`:24`). No status field: upvotes have no lifecycle beyond active and removed.
- **Why it's built this way**: same BR-60 economy as its siblings, and because there is no status enum the [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) alone fully describes the change.
- **Where it's used**: raised inside [`SessionQuestionUpvote`](#sessionquestionupvote) on create, reactivate, and delete (`SessionQuestionUpvote.cs:60,76,91`); consumed by [`SessionQuestionUpvoteChangedHandler`](#sessionquestionupvotechangedhandler) (`SessionQuestionUpvoteChangedHandler.cs:42`).

### LivePollAuthorization
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.Services` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollAuthorization.cs:12` · Level 3 · class (static, internal)

- **What it is**: the one shared rights check for the whole live layer. It decides whether a caller may manage (author, open, close, moderate) content in a given scope.
- **Depends on**: [`SessionLiveInfo`](group-17-conference-domain.md#sessionliveinfo) (the Conference-owned session snapshot it inspects), [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error).
- **Concept introduced, the BR-236 rights shape as one authorization gate.** `[Rubric §11, Security]` assesses whether authorization is centralized and consistent rather than re-implemented per endpoint. Every live-layer mutation and every moderator-only read routes its rights decision through this single method, so the rule "organizers and admins manage everything; a speaker manages only content scoped to a session they are assigned to" lives in exactly one place (doc comment, `LivePollAuthorization.cs:7-10`). `[Rubric §1, SOLID]`: authorization is one responsibility, not smeared across six handlers. `[Rubric §7, Microservices Readiness]`: the speaker-assignment fact arrives as [`SessionLiveInfo`](group-17-conference-domain.md#sessionliveinfo)`.SpeakerIds` from the Conference service, so this check consumes a cross-service snapshot rather than reaching into another module's tables.
- **Walkthrough**: one static method, `EnsureCanManage(bool callerIsOrganizer, SpeakerIdentifierType? callerSpeakerId, SessionLiveInfo? sessionInfo, string source)` (`LivePollAuthorization.cs:22-44`). Order matters. An organizer or admin short-circuits to `Result.Success()` (`:28-31`). Otherwise, if a session scope is supplied **and** the caller has a speaker id **and** that id is in `sessionInfo.SpeakerIds` (`:33-35`), success. Anything else returns `Error.Forbidden("LivePoll.NotAuthorized", ...)` carrying the caller-supplied `source` (`:40-43`). Passing `sessionInfo` as `null` (event-wide scope) means only organizers and admins pass, which is exactly the intent for event-wide polls (`:15-16`).
- **Why it's built this way**: a pure static helper keeps the rule dependency-free and trivially unit-testable, and the explicit `source` parameter threads the calling handler name into the error, which is this codebase's convention for stack-free tracing.
- **Where it's used**: eight call sites across six handlers in both live-layer verticals: [`CreateLivePollHandler`](#createlivepollhandler) (`CreateLivePollHandler.cs:54,64`), [`OpenLivePollHandler`](#openlivepollhandler) (`OpenLivePollHandler.cs:52,62`), [`CloseLivePollHandler`](#closelivepollhandler) (`CloseLivePollHandler.cs:47,54`), [`GetSessionManagePollsHandler`](#getsessionmanagepollshandler) (`GetSessionManagePollsHandler.cs:42`), [`GetModerationQueueHandler`](#getmoderationqueuehandler) (`GetModerationQueueHandler.cs:37`), and [`ModerateQuestionHandler`](#moderatequestionhandler) (`ModerateQuestionHandler.cs:60`). Two of those, the moderation queue and the organizer poll list, are **reads** that still run the check, which is the point of centralizing it: moderator-only reads and writes cannot drift apart.

### LivePollInvariants
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/LivePollInvariants.cs:10` · Level 6 · class (static)

- **What it is**: the invariant helper for [`LivePoll`](#livepoll) and [`LivePollOption`](#livepolloption). It re-exports the poll's field-length and option-count constants into the domain and owns the `Result`-returning checks that guard them (BR-220).
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (every check delegates to it), [`LivePollDTO`](#livepolldto) / [`LivePollOptionDTO`](#livepolloptiondto) (where the numbers actually live), [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced, the constant declared once on the contract and re-exported into the domain.** `[Rubric §9, API & Contract Design]` and `[Rubric §16, Maintainability & Evolvability]`. The four `public const int` members here are not literals: each is defined as the matching constant on the shared DTO, `QuestionMaxLength = LivePollDTO.QuestionMaxLength` (`LivePollInvariants.cs:13`), `OptionTextMaxLength = LivePollOptionDTO.TextMaxLength` (`:16`), `MinOptions = LivePollDTO.MinOptions` (`:19`), and `MaxOptions = LivePollDTO.MaxOptions` (`:22`). The numbers themselves are 200, 100, 2, and 10, declared on the `Shared` DTOs (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LivePolls/LivePollDTO.cs:16,22,28` and `.../LivePollOptionDTO.cs:14`). That direction matters: `Shared` is the assembly the UI and the API contract both reference, so the organizer's poll-builder form, the validator, and the domain guard cannot disagree about the limit. Because they are `const`, the re-export costs nothing at runtime.
- **Concept reinforced, the shared invariant class** (introduced in [Group 02](group-02-domain-building-blocks.md#commoninvariants)). `[Rubric §4, DDD]`: the guards are owned by the domain, not by a controller filter.
- **Walkthrough**: five static check methods, each a one-expression delegation to [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) with a stable error code, a message, a `source`, and a `target` for tracing.
  - `EnsureEventIdIsValid` (`:24-25`) calls `CommonInvariants.EnsureIdIsNotDefault` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Invariants/CommonInvariants.cs:63`) with the code `"LivePoll.EventId.Invalid"`.
  - `EnsureQuestionIsValid` (`:27-35`) calls `CommonInvariants.EnsureStringLengthIsWithin` (`CommonInvariants.cs:219`) with the range `1` to `QuestionMaxLength` and the code `"LivePoll.Question.Invalid"`. The message interpolates the constant (`:33`), so it can never disagree with the number it enforces.
  - `EnsureOptionTextIsValid` (`:37-45`) does the same per option against `OptionTextMaxLength`, code `"LivePoll.Option.Invalid"`.
  - `EnsureOptionCountIsValid` (`:47-55`) calls `CommonInvariants.EnsureCountIsWithin` (`CommonInvariants.cs:310`) with `MinOptions` to `MaxOptions`, code `"LivePoll.Options.CountInvalid"`.
  - `EnsureOptionTextsAreUnique` (`:57-64`) calls `CommonInvariants.EnsureValuesAreUnique` (`CommonInvariants.cs:348`) passing `StringComparer.OrdinalIgnoreCase` (`:60`), code `"LivePoll.Options.Duplicate"`, so "Yes" and "yes" cannot both be options on the same poll.
- **Why it's built this way**: pushing the comparison logic down into [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) means this file contains only *policy* (which rule, which limit, which code) and no *mechanism*, which is why every method fits on one expression. Keeping the class separate from the entity also lets EF configuration and validators reference `LivePollInvariants.QuestionMaxLength` without depending on the [`LivePoll`](#livepoll) type itself.
- **Where it's used**: combined through `Result.Combine` inside [`LivePoll.Create`](#livepoll) (`LivePoll.cs:72-76`) and singly inside [`LivePollOption.Create`](#livepolloption) (`LivePollOption.cs:45`).

### LivePollVoteInvariants
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/LivePollVoteInvariants.cs:9` · Level 6 · class (static)

- **What it is**: the invariant helper for [`LivePollVote`](#livepollvote): three id-presence checks.
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants), [`Result`](group-01-result-error-handling.md#result).
- **Concept reinforced, the shared invariant class** (see [`LivePollInvariants`](#livepollinvariants)). `[Rubric §4, DDD]`. This is the compact sibling: a vote has no free-text fields and no counts, so it declares no constants and all three methods just delegate to `CommonInvariants.EnsureIdIsNotDefault` with a vote-specific error code.
- **Walkthrough**: three one-expression static methods returning [`Result`](group-01-result-error-handling.md#result): `EnsurePollIdIsValid` (`LivePollVoteInvariants.cs:11-12`, code `"LivePollVote.PollId.Invalid"`), `EnsureOptionIdIsValid` (`:14-15`, code `"LivePollVote.OptionId.Invalid"`), and `EnsureUserIdIsValid` (`:17-18`, code `"LivePollVote.UserId.Invalid"`). Each rejects a default (zero or empty) identifier and passes `nameof(...)` as the error target.
- **Why it's built this way**: even a trivial guard is expressed as a named invariant so the factory reads as a `Result.Combine` of intent rather than a stack of `if`s, and every id-presence failure produces a consistent, traceable error code.
- **Where it's used**: combined inside [`LivePollVote.Create`](#livepollvote) (`LivePollVote.cs:53-56`); `EnsureOptionIdIsValid` is also called on its own by `ChangeOption` and `Reactivate` (`LivePollVote.cs:80,100`).

### LivePollVote
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/LivePollVote.cs:19` · Level 7 · class (sealed aggregate root)

- **What it is**: the aggregate root for one user's vote on a live poll. Deliberately a **separate** aggregate from [`LivePoll`](#livepoll), not a child of it.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (base), [`LivePollVoteChanged`](#livepollvotechanged), [`LivePollVoteInvariants`](#livepollvoteinvariants), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced, splitting a high-frequency child into its own aggregate for write scalability.** `[Rubric §12, Performance & Scalability]` (which assesses contention and change-tracker load) and `[Rubric §4, DDD]` (aggregate boundaries chosen for consistency, not convenience). The doc comment states the reasoning explicitly (`LivePollVote.cs:9-17`): votes are high-frequency attendee writes, so folding them into the [`LivePoll`](#livepoll) aggregate would bloat the change tracker and make every vote contend on the poll row. Instead each vote is its own root, and "one active vote per (poll, user)" is enforced by a **filtered unique index** at the database (BR-225), not by loading sibling votes into memory. `[Rubric §8, Data Architecture]`: the reactivation-over-reinsert pattern below is what keeps that filtered index from tripping over soft-deleted duplicates ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) for the soft-delete model).
- **Walkthrough**
  - Marked `[IdValueGenerated]` (`:18`), so the database assigns the identity; the factory sets `Id = default` and lets SQL Server fill it in.
  - Three FK properties with private setters: `LivePollId` (`:22`), `OptionId` (`:25`), `UserId` (`:28`), plus the EF parameterless constructor (`:31`) and a private field constructor (`:33-38`).
  - `Create(livePollId, optionId, userId)` (`:48`): combines the three [`LivePollVoteInvariants`](#livepollvoteinvariants) id checks (`:53-56`), constructs the vote with `Id = default` (`:60-63`), and raises [`LivePollVoteChanged`](#livepollvotechanged) with `DomainEntityState.Added` (`:67`). The comment immediately above that line (`:65-66`) is the source of the zero-id contract described at [`LivePollVoteChanged`](#livepollvotechanged).
  - `ChangeOption(optionId)` (`:78`): the re-vote path while a poll is open (BR-225). It validates the new option (`:80`), reassigns `OptionId` (`:84`), and raises the event with `DomainEntityState.Updated` (`:86`). Note there is no lifecycle guard here: whether the poll is still open is checked by [`LivePoll.CanAcceptVote`](#livepoll) before this is called.
  - `Reactivate(optionId)` (`:98`): the BR-135 pattern. It validates the option (`:100`), calls the base `Undelete()` (`:104`), and only on success reassigns the option and raises `Added` (`:106-110`), so a user who un-votes and then re-votes reuses the same soft-deleted row instead of inserting a new one that would collide with the filtered unique index.
  - `Delete()` (`:120`): overrides the base soft-delete, calls `base.Delete()` first (`:122`), and raises [`LivePollVoteChanged`](#livepollvotechanged) with `DomainEntityState.Deleted` only when that succeeded (`:124-125`). The row stays; `IsDeleted` flips.
- **Why it's built this way**: separating the write-hot vote from the read-hot poll is the central scalability decision of the poll subsystem. Combined with the filtered unique index and reactivation, a poll can absorb a burst of conference-day votes without serializing them on one row.
- **Where it's used**: created, re-pointed, and reactivated by [`CastVoteHandler`](#castvotehandler) (`CastVoteHandler.cs:61,67,73`); tallied on the read side by [`LivePollResultsBuilder`](#livepollresultsbuilder) through a grouped `COUNT`.

### LivePoll
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/LivePoll.cs:18` · Level 8 · class (sealed aggregate root)

- **What it is**: the aggregate root for a live poll: a question with 2 to 10 authored options and a strict `Draft -> Open -> Closed` lifecycle, scoped either to a whole event or to a single session.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype), [`LivePollOption`](#livepolloption) (its child), [`LivePollChanged`](#livepollchanged), [`LivePollInvariants`](#livepollinvariants), [`LivePollStatus`](#livepollstatus), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), the `[Navigation]` marker ([`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute)), [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error).
- **Concept introduced, a lifecycle state machine with a snapshotted cross-service fact.** `[Rubric §4, DDD]` (a root that guards its own transitions) and `[Rubric §7, Microservices Readiness]` (avoiding a synchronous cross-service call on the hot vote path). The lifecycle is enforced as explicit guarded transitions, and `Open` snapshots the event's live-window end onto the poll (`LiveWindowEndUtc`, `LivePoll.cs:32-36`) so later vote checks never call the Conference service again (BR-223/BR-224, doc comment `:10-15`). `[Rubric §8, Data Architecture]`: the child options are held in an encapsulated `List<T>` exposed only as a read-only view.
- **Walkthrough**
  - `[IdValueGenerated]` (`:17`); the properties `EventId` (`:21`), `SessionId?` (`:24`, null means event-wide, BR-230), `Question` (`:27`), `Status` (`:30`), and `LiveWindowEndUtc?` (`:36`) all have private setters. Options live in a private `List<LivePollOption> _options` (`:38`) exposed as `[Navigation(IsCollection = true)] IReadOnlyCollection<LivePollOption> Options => _options.AsReadOnly()` (`:41-42`).
  - `Create(eventId, sessionId, question, optionTexts)` (`:64`): null-checks the texts (`:70`), combines four [`LivePollInvariants`](#livepollinvariants) checks, event id, question, option count, and option uniqueness (`:72-76`), constructs the poll with `Id = default` and `Status = Draft` (private constructor at `:47-53`, object initializer at `:80-83`), then builds each [`LivePollOption`](#livepolloption) in display order using the loop index as `Sort` and short-circuiting on the first option failure (`:85-92`), and raises [`LivePollChanged`](#livepollchanged) `Added` (`:94`). Per-option **text** validation is not in the combined list: it happens inside [`LivePollOption.Create`](#livepolloption).
  - `Open(nowUtc, liveWindowStartUtc, liveWindowEndUtc)` (`:108`): rejects any non-`Draft` poll with `"LivePoll.InvalidTransition"` (`:110-117`) and any attempt outside the live window with `"LivePoll.OutsideLiveWindow"` (`:119-126`; note the end bound is exclusive, `nowUtc >= liveWindowEndUtc` fails), then flips `Status` to `Open` and snapshots `LiveWindowEndUtc` (`:128-129`) before raising `Updated` (`:131`).
  - `Close()` (`:141`): `Open` only, and no reopen path exists (`:143-150`); flips to `Closed` (`:152`) and raises `Updated` (`:154`).
  - `CanAcceptVote(nowUtc, optionId)` (`:167`): the guard the vote handler calls. It requires `Open` status (`:169-176`), requires `nowUtc` to be strictly before a snapshotted window end that is actually set (`:178-185`), and requires the option to exist, be non-deleted, and belong to this poll (`_options.Exists(...)`, `:187-194`). Each failure returns its own [`Error`](group-01-result-error-handling.md#error) code. This runs entirely against in-memory state, with no cross-service call.
  - `SetOptions(options)` (`:201-202`): an `internal` hook that routes through the base `SetItems`, used only by [`LivePollNavigationPopulator`](#livepollnavigationpopulator) to rehydrate the collection.
  - `Delete()` (`:210`): refuses to delete an `Open` poll (BR-228, `"LivePoll.DeleteWhileOpen"`, `:212-219`), then cascade soft-deletes through the base helper, `Result.Combine(DeleteChildren<LivePollOption, LivePollOptionIdentifierType>(_options), base.Delete())` (`:223-225`), and raises [`LivePollChanged`](#livepollchanged) `Deleted` only when the combined result succeeded (`:227-228`). The comment above it explains the ordering: children first, root last, so `Result.Combine` aggregates every child failure with the root's own and a failing option cannot leave a half-applied delete behind (`:221-222`). `DeleteChildren` is the shared base method at `MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:273`.
- **Why it's built this way**: snapshotting the live-window end at `Open` trades a small amount of staleness for removing a synchronous Conference call from every single vote ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) describes the gRPC boundary this sidesteps), and the explicit transition guards make an invalid lifecycle move impossible regardless of which handler calls in. Refusing to delete an open poll rather than silently closing it means a delete can never end a running vote behind the audience's back.
- **Where it's used**: created, opened, closed, and deleted by [`CreateLivePollHandler`](#createlivepollhandler), [`OpenLivePollHandler`](#openlivepollhandler), and [`CloseLivePollHandler`](#closelivepollhandler) behind [`LivePollsController`](#livepollscontroller); its options rehydrated by [`LivePollNavigationPopulator`](#livepollnavigationpopulator); tallied by [`LivePollResultsBuilder`](#livepollresultsbuilder).

### LivePollOption
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/LivePollOption.cs:13` · Level 8 · class (sealed child entity)

- **What it is**: a single answer option belonging to a [`LivePoll`](#livepoll): display text plus a sort order, authored with the poll and immutable afterwards.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (note: a plain auditable **child**, not an aggregate root), [`LivePollInvariants`](#livepollinvariants), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), the `[Navigation]` marker ([`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute)), [`Result`](group-01-result-error-handling.md#result).
- **Concept reinforced, the child entity inside an aggregate boundary.** `[Rubric §4, DDD]`. Unlike [`LivePollVote`](#livepollvote), an option is a genuine child of the poll: it derives from [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), so it has **no** domain-event list of its own, and it is only ever created and soft-deleted through its parent [`LivePoll`](#livepoll). Its changes are announced by the parent's [`LivePollChanged`](#livepollchanged), which is the practical meaning of "inside the boundary".
- **Walkthrough**: `[IdValueGenerated]` (`:12`); `Text` (`:16`) and `Sort` (`:19`) have private setters. The back-reference `[Navigation] public LivePoll? LivePoll { get; private set; }` (`:22-23`) is **not** publicly settable: the writer is the explicit `SetLivePoll(LivePoll?)` method at `:59`, which the populator calls. The FK `LivePollId` (`:26`) is get-only and is written by EF Core. The EF parameterless constructor seeds `Text` to `string.Empty` to satisfy nullability (`:29`), and a private field constructor takes the two real values (`:31-35`). The only factory, `Create(text, sort)` (`:43`), validates through [`LivePollInvariants.EnsureOptionTextIsValid`](#livepollinvariants) (`:45`) and constructs the option with `Id = default` (`:49-52`). There is no mutation method for `Text` or `Sort`: immutability is enforced by omission, and the doc comment says to re-author the Draft poll instead (`:8-10`).
- **Why it's built this way**: modeling the option as an immutable child keeps the poll's consistency boundary simple. Tally math only ever gains new options through re-authoring, so an existing option's meaning can never change under a live vote count. Exposing the back-reference through a named `SetLivePoll` rather than a public setter keeps the one legitimate writer (the populator) explicit at the call site.
- **Where it's used**: built inside [`LivePoll.Create`](#livepoll) (`LivePoll.cs:87`) and cascade-deleted by [`LivePoll.Delete`](#livepoll) (`LivePoll.cs:224`); rehydrated as a collection by [`LivePollNavigationPopulator`](#livepollnavigationpopulator); its own back-reference filled by [`LivePollOptionNavigationPopulator`](#livepolloptionnavigationpopulator); read by [`LivePollResultsBuilder`](#livepollresultsbuilder) to label and order each tally.

### LivePollResultsBuilder
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.Services` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollResultsBuilder.cs:12` · Level 9 · class (sealed)

- **What it is**: the shared read-side service that computes poll result tallies: per-option active-vote counts, the total, the caller's own vote when there is a caller, and the poll's concurrency token. It computes one poll or a whole set with the same code path.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (for the read repository), [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) (async materialization without an EF dependency in the Application layer), [`LivePoll`](#livepoll) / [`LivePollVote`](#livepollvote), and the result DTOs [`LivePollResultsDTO`](#livepollresultsdto) / [`LivePollOptionResultDTO`](#livepolloptionresultdto).
- **Concept introduced, computing tallies with a grouped SQL COUNT instead of materializing votes.** `[Rubric §12, Performance & Scalability]` assesses whether hot read paths avoid loading whole tables. The comment at `LivePollResultsBuilder.cs:59-60` states the intent: tallies come from a `GroupBy(new { LivePollId, OptionId }).Select(Count())` that returns one row per (poll, option) rather than one row per vote, on a path that runs on every vote, every results read, and every open-polls listing. Centralizing this in one builder means all three surfaces compute results identically (`:8-10`).
- **Concept introduced, batching a per-item query into a set-wide one.** `[Rubric §12, Performance & Scalability]` again, on round trips rather than row counts. `BuildManyAsync` takes the whole poll set and issues a **fixed** number of queries: one grouped `COUNT` over every poll (`:61-66`) and, only when a caller is present, one read of that caller's votes across the same set (`:75-79`). The doc comment names the cost this replaced: a per-poll loop issued two queries per poll, so a session with a dozen open polls cost two dozen round trips (`:33-38`). Single-poll callers are not a separate code path; `BuildAsync` simply wraps its argument in a one-element list and takes `results[0]` (`:29-30`), so there is only one implementation to keep correct.
- **Concept introduced, making the parts add up to the whole.** `[Rubric §9, API & Contract Design]` covers whether a payload is internally consistent. The projection keeps only the options a poll still presents (`.Where(o => !o.IsDeleted)`, `:99`), so votes cast on an option that was later removed are excluded from the breakdown, and `TotalVotes` is summed from that same projected list rather than counted independently (`:116`). A client computing percentages from the parts therefore always reconciles with the total. Both comments say so in place (`:95-97`, `:114-115`).
- **Walkthrough**: a primary constructor takes [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) (`:12`); the class has three members.
  - `BuildAsync(poll, userId?, cancellationToken)` (`:22-31`): null-checks the poll (`:27`), delegates to `BuildManyAsync([poll], ...)` (`:29`), and returns the single element (`:30`).
  - `BuildManyAsync(polls, userId?, cancellationToken)` (`:44-88`): null-checks (`:49`), returns an empty list for an empty input before touching the database (`:51-54`), takes a no-tracking read repository for [`LivePollVote`](#livepollvote) (`:56`) and the distinct poll ids (`:57`). It runs the grouped count over `voteRepo.TableNoTracking` filtered by `pollIds.Contains(v.LivePollId)` (`:61-66`) and folds the rows into a dictionary keyed by the `(LivePollId, OptionId)` tuple (`:68`). The caller's own votes are a **separate** set-wide read issued only when `userId` is non-null: broadcast payloads pass `null` and skip it entirely (BR-229, `:70-85`). Finally it maps every poll through `Assemble` in the order supplied (`:87`).
  - `Assemble(poll, countsByPollOption, myVoteByPoll)` (`:90-123`), a private static: filters to non-deleted options, orders by `Sort`, and projects each into a [`LivePollOptionResultDTO`](#livepolloptionresultdto) whose `VoteCount` comes from the dictionary via `GetValueOrDefault`, so an option with zero votes still appears (`:98-107`). It then assembles the [`LivePollResultsDTO`](#livepollresultsdto) (`:109-122`) with poll id, question, status, the summed `TotalVotes` (`:116`), the options, `MyVoteOptionId` (`:118`, null when no caller or no vote), and `RowVersion` (`:121`). That last line is deliberate: the concurrency token travels with the results so a surface fed only by results holds the token it puts in the `If-Match` header of an open or close (`:119-120`).
- **Why it's built this way**: the grouped count keeps the tally cost proportional to option count rather than vote count, and the set-wide shape keeps the round-trip count constant rather than proportional to the number of polls on screen. Skipping the "my vote" read for broadcast payloads (which have no single caller) avoids a pointless query on the fan-out path.
- **Where it's used**: registered as scoped in the module's DI (`DependencyInjection.cs:68`) and injected into [`CastVoteHandler`](#castvotehandler) (`CastVoteHandler.cs:21`, called at `:91`), [`GetPollResultsHandler`](#getpollresultshandler) (`GetPollResultsHandler.cs:15`), and [`GetOpenPollsHandler`](#getopenpollshandler) (`GetOpenPollsHandler.cs:17`, the one caller of `BuildManyAsync` at `:47`), and resolved out of a fresh scope by [`LivePollVoteChangedHandler`](#livepollvotechangedhandler) for the results broadcast (`LivePollVoteChangedHandler.cs:55,73`).
- **Caveats / not-in-source**: `Options` must already be loaded on every passed [`LivePoll`](#livepoll) (via [`LivePollNavigationPopulator`](#livepollnavigationpopulator) or an explicit include, as [`LivePollVoteChangedHandler`](#livepollvotechangedhandler) does at `LivePollVoteChangedHandler.cs:60`). `Assemble` reads `poll.Options` directly and does not load it; the XML docs say so at `:15-16` and `:38`.

### LivePollNavigationPopulator
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.Services` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollNavigationPopulator.cs:11` · Level 10 · class (sealed)

- **What it is**: the declarative navigation populator that loads a [`LivePoll`](#livepoll)'s `Options` collection on query-service paths where EF Core `.Include()` is not applied.
- **Depends on**: [`DeclarativeNavigationPopulator<TEntity>`](group-11-navigation-populators.md#declarativenavigationpopulatortentity) (base), [`ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>`](group-11-navigation-populators.md#childnavigationdescriptortentity-tparentid-tchild-tchildid) (the descriptor), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`LivePoll`](#livepoll) / [`LivePollOption`](#livepolloption).
- **Concept reinforced, declarative navigation population ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).** `[Rubric §2, Design Patterns]`. The framework's entity-query path returns entities without EF includes; a populator declares, in data, which child collections to rehydrate and how. That is the whole class: it subclasses [`DeclarativeNavigationPopulator<TEntity>`](group-11-navigation-populators.md#declarativenavigationpopulatortentity) closed over `LivePoll` and passes exactly one [`ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>`](group-11-navigation-populators.md#childnavigationdescriptortentity-tparentid-tchild-tchildid) (`LivePollNavigationPopulator.cs:11-22`).
- **Walkthrough**: a primary constructor takes [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and forwards a single-element descriptor array to the base (`:11-22`). The descriptor (`:15`) wires `PropertyName = nameof(LivePoll.Options)` (`:17`), `ParentKeySelector = p => p.Id` (`:18`), `ChildForeignKeySelector = child => child.LivePollId` (`:19`), and `AssignAction = (p, options) => p.SetOptions(options)` (`:20`). That last line calls the aggregate's `internal` [`SetOptions`](#livepoll), so the collection is rehydrated through the root's own `SetItems` path rather than by writing the backing field directly. The class body is empty (`:23-24`); all behavior lives in the base.
- **Why it's built this way**: expressing the load as a descriptor rather than hand-written query code keeps every populator uniform and lets the base own batching and assignment. Routing the assignment through `SetOptions` preserves the aggregate boundary even during rehydration.
- **Where it's used**: registered as `INavigationPopulator<LivePoll>` in the module's DI (`DependencyInjection.cs:59`), so the query pipeline runs it before [`LivePollResultsBuilder`](#livepollresultsbuilder) reads `poll.Options`. Note the sibling registration one line on: [`LivePollVote`](#livepollvote) gets a [`NullNavigationPopulator<TEntity>`](group-11-navigation-populators.md#nullnavigationpopulatortentity) (`DependencyInjection.cs:60`), because a vote has nothing to rehydrate.

### LivePollOptionNavigationPopulator
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.Services` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollOptionNavigationPopulator.cs:11` · Level 10 · class (sealed)

- **What it is**: the mirror-image populator for [`LivePollOption`](#livepolloption): it fills the option's back-reference to its parent [`LivePoll`](#livepoll) when an option is queried on its own.
- **Depends on**: [`DeclarativeNavigationPopulator<TEntity>`](group-11-navigation-populators.md#declarativenavigationpopulatortentity) (base), [`FKNavigationDescriptor<TEntity, TChild, TChildId>`](group-11-navigation-populators.md#fknavigationdescriptortentity-tchild-tchildid) (the descriptor), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`LivePoll`](#livepoll) / [`LivePollOption`](#livepolloption).
- **Concept reinforced, the two descriptor flavors** (see [`LivePollNavigationPopulator`](#livepollnavigationpopulator) and [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)). `[Rubric §2, Design Patterns]`. This pair is the clearest illustration of the difference anywhere in the module. A [`ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>`](group-11-navigation-populators.md#childnavigationdescriptortentity-tparentid-tchild-tchildid) walks **down** from a parent key to many children, while an [`FKNavigationDescriptor<TEntity, TChild, TChildId>`](group-11-navigation-populators.md#fknavigationdescriptortentity-tchild-tchildid) walks **up** an FK to a single parent, which is why its `AssignAction` ends in `FirstOrDefault()`.
- **Walkthrough**: a primary constructor takes [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and forwards one `FKNavigationDescriptor<LivePollOption, LivePoll, LivePollIdentifierType>` to the base (`LivePollOptionNavigationPopulator.cs:11-22`). The descriptor (`:15`) sets `PropertyName = nameof(LivePollOption.LivePoll)` (`:17`), `ParentKeySelector = e => e.LivePollId` (`:18`, the FK **on the option**, which is the inversion relative to the child descriptor), `ChildForeignKeySelector = child => child.Id` (`:19`, the poll's own primary key), and `AssignAction = (e, livePolls) => e.SetLivePoll(livePolls.FirstOrDefault())` (`:20`), calling the option's explicit setter method rather than assigning a public property. The class body is empty (`:23-24`).
- **Why it's built this way**: the base loads parents in one batched query for a whole page of options rather than one query per option, so declaring the relationship in data is what removes the N+1 a naive lazy-loaded back-reference would create. Going through `SetLivePoll` is why [`LivePollOption.LivePoll`](#livepolloption) can keep a `private set` and still be assignable here: the writer is named, not open to anyone.
- **Where it's used**: registered as `INavigationPopulator<LivePollOption>` in the module's DI (`DependencyInjection.cs:64`).

### ModerateQuestionHandler
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Moderate` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Moderate/ModerateQuestionHandler.cs:23` · Level 14 · class (sealed partial)

- **What it is**: the command handler that applies a moderation transition to a [`SessionQuestion`](#sessionquestion) (BR-234), enforcing the BR-236 rights, then best-effort enqueues the matching live-channel event (BR-238) for the off-request-path drain worker.
- **Depends on**: [`MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#mutateentityhandlerbasetcommand-tentity-tidentifiertype) (base), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice) (the Conference gRPC boundary for session info), [`ILiveChannelPublishQueue`](group-22-engagement-module.md#ilivechannelpublishqueue) (`ModerateQuestionHandler.cs:26`), [`LiveChannelPublishWorkItem`](group-22-engagement-module.md#livechannelpublishworkitem), [`BestEffort`](group-03-querying-specifications.md#besteffort), [`LivePollAuthorization`](#livepollauthorization), the [`SessionQuestionChannel`](#sessionquestionchannel) event names, [`LivePollChannel`](#livepollchannel) for the channel key, the channel payload records ([`SessionQuestionApprovedPayload`](#sessionquestionapprovedpayload), [`SessionQuestionDismissedPayload`](#sessionquestiondismissedpayload), [`SessionQuestionAnsweredPayload`](#sessionquestionansweredpayload), [`SessionQuestionPendingCountChangedPayload`](#sessionquestionpendingcountchangedpayload)), plus `System.Text.Json` and `ILogger`.
- **Concept reinforced, the load-mutate-save template method** (introduced with [`MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#mutateentityhandlerbasetcommand-tentity-tidentifiertype) in Group 05). `[Rubric §1, SOLID]` and `[Rubric §16, Maintainability & Evolvability]`. This handler writes **no** `HandleAsync` of its own. It declares `: MutateEntityHandlerBase<ModerateQuestionCommand, SessionQuestion, SessionQuestionIdentifierType>(unitOfWork)` (`:28`) and fills in four hooks. The base owns the shared sequence in `MutateCoreAsync` (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/MutateEntityHandlerBase.cs:270`): resolve the repository and load the tracked aggregate, fail `NotFound` when it is gone (`:282`), stamp the caller's token (`:290-291`), run the mutation, `SaveChangesAsync` (`:302`), then `LogMutated` (`:304`) and `OnMutatedAsync` (`:305`). Reading this handler means reading only what is *different* about moderating a question.
- **Concept introduced, the best-effort side channel that can never fail the command (BR-238).** `[Rubric §29, Resilience & Business Continuity]` and `[Rubric §7, Microservices Readiness]`: a downstream service being unreachable must not fail the local write. The broadcast runs from the post-commit `OnMutatedAsync` hook, so the mutation is already durably saved, and the work runs inside [`BestEffort`](group-03-querying-specifications.md#besteffort)`.ExecuteAsync` (`:138`) rather than a hand-rolled `try/catch`. Read the guard precisely: `Enqueue` is a `void` call that never rejects, so what the guard actually covers is the Pending-count follow-up's database read (`:145-148`, rationale at `:91-104`). `[Rubric §13, Observability & Operability]`: using the shared helper means a broadcast that has quietly stopped working increments `besteffort.dispatch.failed` on a meter, tagged with the low-cardinality operation constant `"session-question-moderation-broadcast"` (`:31`), instead of only producing a log line (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/BestEffort.cs:18-23`). The caller's `CancellationToken` is deliberately **not** passed (`:89`, rationale `:100-103`), so the helper's token parameter falls back to its default (`BestEffort.cs:45-49`) and the broadcast outlives an abandoned request instead of turning a saved moderation into a cancelled one.
- **Walkthrough**
  - The primary constructor injects the unit of work, the Conference validation service, the publish queue, and a logger (`:23-27`); `BroadcastOperation` is the metric-tag constant (`:31`).
  - `_wasPending` (`:38`) is the one piece of instance state: a value captured during the mutation and read back in the post-commit hook. The doc comment justifies it (`:33-37`): a command handler is resolved per DI scope and handles exactly one command, so instance state cannot leak between requests.
  - `EntityId` (`:41`) tells the base which aggregate to load: `command.QuestionId`.
  - `RowVersion` (`:48`) returns `command.RowVersion`, which is what turns on the base's concurrency stamping. The comment above it (`:43-45`) states the effect: two moderators racing approve against dismiss surface as **412 Precondition Failed** rather than the second decision silently applying ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)).
  - `MutateAsync` (`:51-78`) is the interesting override, and it is `async` for a reason: it fetches the session's live info across the Conference boundary through [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice) (`:56-58`) and runs [`LivePollAuthorization.EnsureCanManage`](#livepollauthorization) (`:60-63`) with the aggregate already loaded and its token already stamped. A rights failure short-circuits before any state change. It then captures `_wasPending` **before** the transition (`:65`) and dispatches the action through a `switch` expression to the domain methods `Approve()` / `Dismiss()` / `MarkAnswered()` (`:67-77`); an unknown action becomes an `Error.Invariant` failure rather than a silent no-op (`:72-76`).
  - `LogMutated` (`:81-82`) emits the source-generated moderation log (declared at `:160-161`), and `OnMutatedAsync` (`:85-89`) forwards the question, the action, and the captured `_wasPending` to the private `EnqueueModeratedAsync`.
  - `EnqueueModeratedAsync` (`:106-158`): resolves the session channel key with `LivePollChannel.ForSession` (`:111`), then builds the `(eventName, payload)` pair per action (`:118-136`). Only universally visible data rides the channel, and the Approve arm is the single place question **content** is broadcast (`:120-124`). This `switch` is built **outside** the best-effort guard on purpose (`:113-117`): its discard arm throws `ArgumentOutOfRangeException` (`:135`) because an unknown action is a programming error that must fault loudly, not a transient publish failure to be swallowed.
  - Inside the guard (`:138-157`) it enqueues the work item (`:140`), and when a *Pending* question left the queue on Approve or Dismiss it issues a fresh Pending-count read off `UnitOfWork` (`:145-148`) and enqueues a [`SessionQuestionPendingCountChangedPayload`](#sessionquestionpendingcountchangedpayload) so moderators' badges update (`:150-155`).
- **Why it's built this way**: the base commits before the hook runs, and the swallow-and-count guard covers the follow-up read, giving the live layer at-most-once broadcast semantics layered over a durably committed write, which is the correct trade for ephemeral UI signals that must never block a moderation. Queueing rather than awaiting the publish also keeps a hung Notification peer off the moderator's request path ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) for the channel transport).
- **Where it's used**: registered for [`ModerateQuestionCommand`](#moderatequestioncommand) and invoked by [`SessionQuestionsController`](#sessionquestionscontroller)'s approve, dismiss, and mark-answered verbs, all three routed through one private `ModerateAsync` (`SessionQuestionsController.cs:145,171,197,224-230`).
- **Caveats / not-in-source**: the `switch` discard arm at `:135` is unreachable in practice, since `MutateAsync` already applied a known action before the post-commit hook runs (the comment at `:116-117` says as much).

### SessionQuestionInvariants
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.SessionQuestions` · `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionInvariants.cs:10` · Level 6 · class (static)

- **What it is**: the static rule holder for the [`SessionQuestion`](#sessionquestion) aggregate: three
  validation checks its factory runs, plus the two numeric limits the Q&A layer treats as single sources
  of truth (BR-231).
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (the reusable
  lower-layer guard toolbox), [`Result`](group-01-result-error-handling.md#result) /
  [`Error`](group-01-result-error-handling.md#error) from `MMCA.Common.Shared.Abstractions`,
  [`SessionQuestionDTO`](#sessionquestiondto) (for the length constant), and the module identifier
  aliases `SessionIdentifierType` / `UserIdentifierType`.
- **Concept reinforced, the invariants class as the aggregate's rule sheet.** The idiom is taught in
  [Group 02](group-02-domain-building-blocks.md#commoninvariants): domain rules live in a dedicated
  static class returning [`Result`](group-01-result-error-handling.md#result), never as ad-hoc `if`
  blocks inside the entity, so the factory reads as a checklist and each rule is independently testable.
  What this class adds is two `public const` limits, and the first of them shows a deliberate
  layering choice. `TextMaxLength` (`SessionQuestionInvariants.cs:13`) does **not** declare the number:
  it reads [`SessionQuestionDTO.TextMaxLength`](#sessionquestiondto)
  (`MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionDTO.cs:18`, the literal `500`), because
  Shared is the lowest layer every consumer can reach and the Blazor input caps itself from there
  (`MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLiveQuestionPanel.razor:9`) without taking a
  reference on Domain. The doc comment at `:12` and the DTO's own comment
  (`SessionQuestionDTO.cs:12-17`) state that contract in both directions.
  `MaxOpenQuestionsPerUserPerSession = 10` (`:22`) is an anti-spam cap on how many Pending-or-Approved
  questions one user may hold per session; its comment (`:15-21`) explains both the motive (an event
  whose moderation default auto-approves would otherwise let one attendee flood the session, and
  dismissed questions deliberately do not count) and its limit: it is an explicitly **soft** cap,
  because the submit handler counts and then inserts without holding a lock, so concurrent submits from
  the same user can briefly push the total past it and moderation drains the overflow. `[Rubric §4,
  DDD]` assesses whether business rules are expressed in the domain's own vocabulary rather than
  scattered at the edges; both constants and all three checks live beside the aggregate they guard.
  `[Rubric §16, Maintainability]` assesses single-source-of-truth for repeated values: the literal `500`
  exists in exactly one file, and the cap is a named constant rather than a magic number in a handler.
- **Walkthrough**
  - `TextMaxLength` (`:13`) and `MaxOpenQuestionsPerUserPerSession` (`:22`): the two shared constants,
    consumed by domain, persistence, validation, the submit use case, and the UI alike (see *Where it's
    used*).
  - `EnsureSessionIdIsValid` (`:24`) and `EnsureUserIdIsValid` (`:27`): both delegate to
    [`CommonInvariants.EnsureIdIsNotDefault`](group-02-domain-building-blocks.md#commoninvariants),
    failing with a stable code (`SessionQuestion.SessionId.Invalid` /
    `SessionQuestion.UserId.Invalid`) when the identifier is still its type default.
  - `EnsureTextIsValid` (`:30-38`): also a delegation, to
    [`CommonInvariants.EnsureStringLengthIsWithin`](group-02-domain-building-blocks.md#commoninvariants)
    (`MMCA.Common/Source/Core/MMCA.Common.Domain/Invariants/CommonInvariants.cs:219`), passing a minimum
    of `1` and `TextMaxLength` as the maximum (`:33-34`) under the code `SessionQuestion.Text.Invalid`.
    The message is templated from the same constant (`:36`), so tightening the number rewords the error
    automatically. Null and whitespace fail through the shared guard rather than through a local check.
- **Why it's built this way**: stable machine-readable `code`s plus one shared constant mean the API
  layer, the FluentValidation validator, the EF configuration, and the Blazor input all agree on one
  rule without duplicating a literal. Every method takes a `source` argument (callers pass
  `nameof(Create)`), which threads the origin of the failure into the
  [`Error`](group-01-result-error-handling.md#error) for diagnostics.
- **Where it's used**: the three checks are combined inside [`SessionQuestion.Create`](#sessionquestion)
  (`MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestion.cs:85-88`). `TextMaxLength` is reused by
  `SessionQuestionConfiguration` for the column length
  ([group 22](group-22-engagement-module.md#sessionquestionconfiguration),
  `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/SessionQuestionConfiguration.cs:32`)
  and by [`SubmitQuestionCommandValidator`](#submitquestioncommandvalidator)'s `MaximumLength` rule and
  message
  (`MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionCommandValidator.cs:22-23`).
  `MaxOpenQuestionsPerUserPerSession` is enforced by [`SubmitQuestionHandler`](#submitquestionhandler)
  (`MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:76,80`),
  not by the entity: the cap is a cross-row rule that needs a query, so it cannot live in a factory that
  only sees one instance.

### SessionQuestionUpvoteInvariants
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.SessionQuestions` · `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionUpvoteInvariants.cs:9` · Level 6 · class (static)

- **What it is**: the sibling invariants class for [`SessionQuestionUpvote`](#sessionquestionupvote):
  the two identifier checks its factory needs.
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants),
  [`Result`](group-01-result-error-handling.md#result), and the `SessionQuestionIdentifierType` /
  `UserIdentifierType` aliases.
- **Concept reinforced**: nothing new. This is the compact twin of
  [`SessionQuestionInvariants`](#sessionquestioninvariants), with no length constant because an upvote
  has no free-text field, only two foreign keys. `[Rubric §1, SOLID]` assesses whether a unit has one
  reason to change: even a two-line rule set gets its own type, so the aggregate factory stays a flat
  `Result.Combine` of named intents.
- **Walkthrough**
  - `EnsureQuestionIdIsValid` (`:11-12`): `EnsureIdIsNotDefault` on the upvoted question, code
    `SessionQuestionUpvote.QuestionId.Invalid`.
  - `EnsureUserIdIsValid` (`:14-15`): the same guard on the upvoting user, code
    `SessionQuestionUpvote.UserId.Invalid`.
- **Why it's built this way**: see [`SessionQuestionInvariants`](#sessionquestioninvariants); one guard
  unit per aggregate keeps each factory readable and each rule unit-testable in isolation.
- **Where it's used**: combined by [`SessionQuestionUpvote.Create`](#sessionquestionupvote)
  (`MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionUpvote.cs:47-49`).

### SessionQuestion
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.SessionQuestions` · `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestion.cs:19` · Level 7 · class (sealed aggregate root)

- **What it is**: the aggregate root for an attendee-submitted, moderated session question in the
  conference-day live layer. It carries the text, a moderation status, an answered flag, and a snapshot
  of the event's live-window end so upvote timing can be checked without a cross-service call.
- **Depends on**:
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (identity, soft-delete, audit fields, `RowVersion`, the domain-event list),
  [`SessionQuestionInvariants`](#sessionquestioninvariants), [`QuestionStatus`](#questionstatus),
  [`SessionQuestionChanged`](#sessionquestionchanged),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), and
  [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error).
  Externals: the BCL `DateTime` only (the caller supplies `nowUtc` from an injected `TimeProvider`).
- **Concept introduced, the snapshotted cross-service fact.** `[Rubric §7, Microservices Readiness]`
  assesses whether a boundary avoids chatty synchronous dependence on a peer. Engagement and Conference
  are separate services with separate databases
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), so the event's
  live-window end is fetched once from Conference at submission time and stored on the row as
  `LiveWindowEndUtc` (`:39-43`); every later upvote-timing decision is then a local field read instead of
  a gRPC round trip (BR-237, the same trick [`LivePoll`](#livepoll) plays at `Open`). The class also
  shows the **single-event-plus-state** convention (BR-60): instead of `QuestionApproved` /
  `QuestionDismissed` / `QuestionDeleted` event types, one
  [`SessionQuestionChanged`](#sessionquestionchanged) carries a
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) discriminator (`:15-16`).
  `[Rubric §4, DDD]` assesses invariant enforcement and explicit transitions inside the model: every
  mutator here is a guarded method returning [`Result`](group-01-result-error-handling.md#result), and
  an illegal transition fails rather than throws. `[Rubric §6, CQRS and Event-Driven]` applies because
  each state change announces itself as a domain event for downstream handlers.
- **Walkthrough**
  - Properties (`:22-43`), all with `private set` so state changes only through the methods below:
    `SessionId` (`:22`), `EventId` (`:25`, denormalized from the session and deliberately not validated
    because the disabled-stub extension point can report a default, per the remark at `:24`), `UserId`
    (`:28`, never copied onto a DTO because questions display anonymously, BR-238), `Text` (`:31`),
    `Status` (`:34`), `IsAnswered` (`:37`), and `LiveWindowEndUtc` (`:43`).
  - Constructors (`:46-62`): a private parameterless one for EF materialization that initializes `Text`
    to empty (`:46`), and a private all-args one the factory uses (`:48-62`).
  - `Create` (`:77-83`): combines the three [`SessionQuestionInvariants`](#sessionquestioninvariants)
    checks (`:85-88`), then separately rejects any `initialStatus` other than `Pending` or `Approved`
    with code `SessionQuestion.InvalidInitialStatus` (`:92-99`), because a question must start at the
    event's moderation default (BR-233). It constructs with `Id = default` (`:101-104`; the
    [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) at `:18`
    marks the key database-generated) and raises
    [`SessionQuestionChanged`](#sessionquestionchanged) with `Added` (`:109-110`). The comment at
    `:106-108` is the load-bearing detail: the id is still `0` at this point, so the event carries the
    session and the asker **by value** and consumers correlate on those rather than reading a row back
    by an id that does not exist yet. Every raise in this class passes the same five values
    (state, `Id`, `SessionId`, `UserId`, `Status`).
  - `Approve` (`:121`) and `Dismiss` (`:145`): the moderation transitions (BR-234). Each rejects the
    no-op case (approving an already-approved question at `:123-130`, dismissing an already-dismissed one
    at `:147-154`) with an `Error.Invariant` coded `SessionQuestion.InvalidTransition`, sets `Status`,
    and raises `Updated`. Note there is no one-way door: a dismissed question can be approved again.
  - `MarkAnswered` (`:168`): valid only while `Approved` (code `SessionQuestion.NotApproved`, `:170-177`)
    and only once (code `SessionQuestion.AlreadyAnswered`, `:179-186`); sets `IsAnswered` (`:188`) and
    raises `Updated` (`:190`).
  - `CanAcceptUpvote` (`:201`): the guard the upvote use case calls before writing. It fails when the
    question is not `Approved` (`:203-210`) or when `nowUtc >= LiveWindowEndUtc`
    (`SessionQuestion.OutsideLiveWindow`, `:212-219`), enforcing the live window purely from the
    snapshot, with no call into Conference.
  - `Delete` (`:229`): overrides the base soft-delete and, on success, raises
    [`SessionQuestionChanged`](#sessionquestionchanged) with `Deleted` (`:233-234`).
- **Why it's built this way**: snapshotting the window end rather than calling Conference per upvote
  trades a small staleness window for removing a synchronous peer dependency from the conference-day hot
  path ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) for the
  database-per-service split,
  [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) for the gRPC boundary this
  avoids). The single-event-plus-state shape (BR-60) keeps the event catalog small and lets one handler
  branch on [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate).
- **Where it's used**: created by [`SubmitQuestionHandler`](#submitquestionhandler), transitioned by
  [`ModerateQuestionHandler`](#moderatequestionhandler), read by
  [`GetSessionQuestionsHandler`](#getsessionquestionshandler) /
  [`GetModerationQueueHandler`](#getmoderationqueuehandler) and projected by
  [`SessionQuestionViewBuilder`](#sessionquestionviewbuilder); re-read for the fresh count by
  [`SessionQuestionUpvoteChangedHandler`](#sessionquestionupvotechangedhandler); mapped to SQL Server by
  `SessionQuestionConfiguration`
  ([group 22](group-22-engagement-module.md#sessionquestionconfiguration)).

### SessionQuestionUpvote
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.SessionQuestions` · `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionUpvote.cs:19` · Level 7 · class (sealed aggregate root)

- **What it is**: a standalone aggregate root recording one user's upvote on one
  [`SessionQuestion`](#sessionquestion). Deliberately not modeled as a child of the question.
- **Depends on**:
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype),
  [`SessionQuestionUpvoteInvariants`](#sessionquestionupvoteinvariants),
  [`SessionQuestionUpvoteChanged`](#sessionquestionupvotechanged),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), and
  [`Result`](group-01-result-error-handling.md#result).
- **Concept reinforced, splitting a high-frequency satellite into its own aggregate.** The same decision
  [`LivePollVote`](#livepollvote) makes, stated again in the class comment (`:9-17`): upvotes are
  frequent attendee writes, and pulling every upvote into the question aggregate would bloat the change
  tracker and make each upvote contend on the question row, so an upvote is its own root with no
  navigation back. `[Rubric §4, DDD]` assesses aggregate boundaries chosen for consistency needs rather
  than convenience. `[Rubric §8, Data Architecture]` assesses where uniqueness and concurrency are
  enforced: "one active upvote per (question, user)" (BR-235) is a **filtered unique index** over
  non-deleted rows in `SessionQuestionUpvoteConfiguration`
  ([group 22](group-22-engagement-module.md#sessionquestionupvoteconfiguration)), not an in-memory
  sibling scan, and toggling an upvote off then on is soft-delete followed by `Reactivate` so those rows
  never accumulate duplicates (the BR-135 reactivation pattern).
- **Walkthrough**
  - Properties (`:22`, `:25`): `SessionQuestionId` and `UserId`, both `private set` scalar foreign keys,
    with no navigation to the question, which is what keeps the two aggregates independent.
  - Constructors (`:28`, `:30-34`): private parameterless for EF, private two-arg for the factory.
  - `Create` (`:43-45`): combines the two
    [`SessionQuestionUpvoteInvariants`](#sessionquestionupvoteinvariants) checks (`:47-49`), constructs
    with `Id = default` (`:53-56`), and raises
    [`SessionQuestionUpvoteChanged`](#sessionquestionupvotechanged) with `Added` (`:60`). As on the
    question, the comment at `:58-59` records that the id is still `0`, so consumers correlate on the
    question and the voter, never on the upvote's own id.
  - `Reactivate` (`:71`): calls the inherited `Undelete()` (`:73`) and, on success, raises `Added` again
    (`:75-76`), so a re-upvote looks exactly like a fresh upvote to every downstream consumer, including
    the broadcast handler.
  - `Delete` (`:86`): overrides the base soft-delete (an un-upvote) and raises `Deleted` (`:90-91`).
- **Why it's built this way**: separating the upvote root and driving on/off through soft-delete plus
  reactivation is what lets the filtered unique index be a durable one-active-per-user guarantee while
  keeping the write traffic off the question row.
- **Where it's used**: written by [`ToggleUpvoteHandler`](#toggleupvotehandler); counted with a grouped
  SQL `COUNT` by [`SessionQuestionViewBuilder`](#sessionquestionviewbuilder) and with a plain `COUNT` by
  [`SessionQuestionUpvoteChangedHandler`](#sessionquestionupvotechangedhandler).

### LivePollVoteConfiguration
> MMCA.ADC.Engagement.Infrastructure · `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePollVoteConfiguration.cs:17` · Level 8 · class (internal sealed)

- **What it is**: the EF Core mapping for the [`LivePollVote`](#livepollvote) aggregate root, whose
  centerpiece is the filtered unique index guaranteeing one active vote per user per poll (BR-225).
- **Depends on**:
  [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype)
  (the shared base that maps audit fields, soft-delete, and `RowVersion`), EF Core's
  `EntityTypeBuilder<T>`, and the framework's
  [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions) for
  `HasSoftDeleteFilter()`.
- **Concept introduced, the filtered unique index as the backstop for a soft-delete aggregate.**
  `[Rubric §8, Data Architecture]` assesses whether uniqueness and concurrency are enforced at the
  storage layer rather than hoped for in application code. Because a vote toggles via soft-delete rather
  than hard-delete, a naive unique index would permanently block a user from re-voting: the deleted row
  keeps occupying its unique slot. Scoping the index to *active* rows is what makes the handler's
  create-or-reactivate dance race-safe (the remark at `:12-16`). Note **how** the scoping is expressed
  here: `.HasSoftDeleteFilter()` (`:37`), the framework extension member at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/IndexBuilderExtensions.cs:50`,
  rather than a hand-typed `HasFilter("[IsDeleted] = 0")`. The extension reads the soft-delete column
  name from the model and takes its identifier quoting from the engine
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SoftDeleteFilterSql.cs:27-36`), so a
  renamed column or a SQLite model follows automatically and a Cosmos model is a no-op. On a *unique*
  index the call is belt and braces:
  [`SoftDeleteUniqueIndexConvention`](group-07-persistence-ef-core.md#softdeleteuniqueindexconvention)
  already adds the same predicate to every unique index on a soft-deletable entity at model finalizing,
  and it recognizes the predicate it finds and leaves it alone rather than doubling it
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:71-73`).
  Writing it explicitly keeps BR-225 legible in the file that owns it. `[Rubric §2, Design Patterns]`
  applies in that the database constraint and the domain `Reactivate` method are two halves of one
  idempotent-write pattern; the identical shape guards
  [`SessionQuestionUpvote`](#sessionquestionupvote).
- **Walkthrough**
  - `Configure` (`:21`) calls `base.Configure` (`:23`), then requires `LivePollId` (`:25-26`),
    `OptionId` (`:28-29`), and `UserId` (`:31-32`). Note there are no navigations: a vote is a separate
    aggregate by design, so it carries scalar FKs only.
  - Filtered unique index on `{ LivePollId, UserId }` (`:35-37`): BR-225, one active vote per poll and
    user, with the soft-delete predicate applied through `HasSoftDeleteFilter()`.
  - Non-unique index on `{ LivePollId, OptionId }` (`:40`): supports the grouped `COUNT` per option that
    [`LivePollResultsBuilder`](#livepollresultsbuilder) issues when tallying (`:39`).
- **Why it's built this way**: the filter is what lets soft-delete and uniqueness coexist, routing it
  through the shared extension keeps every filtered index in the codebase producing byte-identical SQL,
  and the second index matches the tally query shape exactly, so results are computed from an index
  rather than by scanning the vote table.
- **Where it's used**: applied by the Engagement `SQLServerDbContext` at model build;
  [`CastVoteHandler`](#castvotehandler) relies on the unique index as the final arbiter when two
  concurrent votes race.

### SessionQuestionUpvoteChangedHandler
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.DomainEventHandlers` · `MMCA.ADC.Engagement.Application/SessionQuestions/DomainEventHandlers/SessionQuestionUpvoteChangedHandler.cs:39` · Level 8 · class (sealed)

- **What it is**: the domain-event handler that broadcasts a question's fresh upvote count whenever an
  upvote is cast or withdrawn (the `question.upvote-changed` channel event, BR-238).
- **Depends on**:
  [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent)
  (implemented for [`SessionQuestionUpvoteChanged`](#sessionquestionupvotechanged)),
  [`BestEffort`](group-03-querying-specifications.md#besteffort) (the framework's swallow-and-count
  helper), [`ILiveChannelPublishQueue`](group-22-engagement-module.md#ilivechannelpublishqueue) and
  [`LiveChannelPublishWorkItem`](group-22-engagement-module.md#livechannelpublishworkitem),
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (resolved per event from a fresh scope),
  [`SessionQuestion`](#sessionquestion) / [`SessionQuestionUpvote`](#sessionquestionupvote),
  [`LivePollChannel`](#livepollchannel) and [`SessionQuestionChannel`](#sessionquestionchannel) for the
  channel key and event name, and
  [`SessionQuestionUpvoteChangedPayload`](#sessionquestionupvotechangedpayload). Externals:
  `IServiceScopeFactory`, `ILogger`, `System.Text.Json`.
- **Concept introduced, moving a broadcast from the command handler onto the domain event.** The class
  comment (`:18-25`) states both defects this fixed, and they are worth internalizing because they
  generalize to any side effect attached to a write. First, the publish used to be awaited inline on the
  request path, so a slow or hung Notification peer added its latency to every single upvote. Second,
  and worse, it ran *before* the command's transaction committed, so a later rollback left clients told
  about an upvote that never persisted. Domain-event dispatch inside a transactional command is deferred
  until after the commit succeeds and dropped on rollback, so relocating the publish here makes it
  post-commit by construction. `[Rubric §29, Resilience and Business Continuity]` assesses whether a
  dependency outage can corrupt or block the primary write; here it can do neither, since the enqueue is
  off the request path and the whole body runs inside
  [`BestEffort.ExecuteAsync`](group-03-querying-specifications.md#besteffort). `[Rubric §6, CQRS and
  Event-Driven]` assesses using domain events as the extension point for downstream reactions.
- **Concept introduced, a swallowed failure that is still *counted*.** `[Rubric §13, Observability and
  Operability]` assesses whether an operator can tell that something stopped working. A hand-rolled
  `catch { log; }` produces a Warning line in a log nobody reads; this handler instead hands its whole
  body to [`BestEffort.ExecuteAsync`](group-03-querying-specifications.md#besteffort)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/BestEffort.cs:45`), which does three things
  a local catch does not. It emits exactly one Warning naming the operation
  (`BestEffort.cs:81-84`), it increments the `besteffort.dispatch.failed` counter on the
  `MMCA.Common.BestEffort` meter tagged by `operation` (`BestEffort.cs:107-115`), so a broadcast path
  that has quietly died shows up on a dashboard, and it rethrows an `OperationCanceledException` caused
  by the caller's own token instead of recording it as a failure (`BestEffort.cs:59-64`), so a host
  shutdown still unwinds promptly. The operation name is a `private const`
  (`SessionQuestionUpvoteChangedHandler.cs:45`, `"session-question-upvote-broadcast"`) precisely because
  it becomes a low-cardinality metric tag. The class comment records the change at `:26-31`.
- **Walkthrough**
  - The primary constructor (`:39-42`) takes `IServiceScopeFactory`,
    [`ILiveChannelPublishQueue`](group-22-engagement-module.md#ilivechannelpublishqueue), and an
    `ILogger`. The handler is a singleton per the framework convention (`:32-34`), which is exactly why
    it must open its own scope to reach scoped services.
  - `HandleAsync` (`:48`): null-guards the event (`:50`), then **returns** the task produced by
    `BestEffort.ExecuteAsync(BroadcastOperation, logger, …, cancellationToken)` (`:52`, closing at
    `:84`). Everything below runs inside that lambda, under the `broadcastToken` the helper hands it.
  - Scope (`:54-55`): `scopeFactory.CreateAsyncScope()` and
    [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) resolved from it.
  - Question re-read (`:57-62`): a no-tracking `GetByIdAsync` with `includes: []`. A `null` result means
    the question was removed between the upvote committing and this dispatch, and the handler simply
    returns (`:64-68`): nothing meaningful is left to broadcast.
  - Count (`:70-73`): `CountAsync` over [`SessionQuestionUpvote`](#sessionquestionupvote) filtered to
    this question. The count is computed in SQL, and the global soft-delete query filter means withdrawn
    upvotes are excluded automatically rather than by an explicit `IsDeleted` predicate.
  - Payload and enqueue (`:76-83`): serializes a
    [`SessionQuestionUpvoteChangedPayload`](#sessionquestionupvotechangedpayload) of
    `(questionId, sessionId, upvoteCount)` with `JsonSerializerOptions.Web`, then `Enqueue`s a
    [`LiveChannelPublishWorkItem`](group-22-engagement-module.md#livechannelpublishworkitem) addressed
    to `LivePollChannel.ForSession(question.SessionId)` with the event name
    `SessionQuestionChannel.QuestionUpvoteChanged`. The comment at `:75` is the privacy rule: the
    payload carries the count only, never who voted (BR-238).
- **Why it's built this way**: this is the at-most-once ephemeral broadcast layered over a durably
  committed write that
  [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) prescribes. The queue keeps
  the gRPC publish off the request path, the domain-event timing keeps it post-commit, and
  [`BestEffort`](group-03-querying-specifications.md#besteffort) keeps it best-effort *and* measurable;
  the authoritative upvote count is always re-readable from the API, so a dropped broadcast degrades
  freshness, never correctness.
- **Where it's used**: not called directly. It is discovered by convention-based scanning
  (`ScanModuleApplicationServices<ClassReference>()`,
  `MMCA.ADC.Engagement.Application/DependencyInjection.cs:87`) and invoked by the framework's
  domain-event dispatcher whenever [`ToggleUpvoteHandler`](#toggleupvotehandler) commits a
  [`SessionQuestionUpvote`](#sessionquestionupvote) change, which that handler's comment points at
  (`MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteHandler.cs:89-90`).
  The work item it enqueues is drained by the hosted processor behind
  [`ILiveChannelPublishQueue`](group-22-engagement-module.md#ilivechannelpublishqueue)
  (`MMCA.ADC.Engagement.Application/DependencyInjection.cs:55-56`).

### SessionQuestionViewBuilder
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.Services` · `MMCA.ADC.Engagement.Application/SessionQuestions/Services/SessionQuestionViewBuilder.cs:12` · Level 8 · class (sealed)

- **What it is**: the shared read-side service that projects a set of
  [`SessionQuestion`](#sessionquestion) entities into [`SessionQuestionDTO`](#sessionquestiondto) views,
  computing each question's active upvote count and the calling user's own upvote and authorship flags.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (for the read
  repository), [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) (async
  materialization of a raw `IQueryable` without an EF dependency in the Application layer),
  [`SessionQuestionUpvote`](#sessionquestionupvote), and
  [`SessionQuestionDTO`](#sessionquestiondto). Externals: LINQ and BCL collections.
- **Concept introduced, computing tallies with a grouped SQL COUNT in a shared builder.**
  `[Rubric §12, Performance and Scalability]` assesses whether hot read paths avoid materializing whole
  tables. The comment at `:36-38` is the record of why this shape exists: counts come from a
  `GroupBy(SessionQuestionId).Select(Count())` that returns **one row per question instead of one row
  per upvote**, so a hot plenum session no longer re-materializes its entire upvote set on every read,
  and the change mirrors [`LivePollResultsBuilder`](#livepollresultsbuilder) on the poll side.
  `[Rubric §1, SOLID]` applies to the sharing: submit, list, and moderation all need the same
  per-question counts and per-caller flags, so the projection lives in one reusable unit rather than
  being re-derived (and re-optimized) in three handlers.
- **Walkthrough**
  - The primary constructor (`:12`) takes [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork)
    and [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor).
  - `BuildAsync(questions, callerUserId, cancellationToken)` (`:21-24`): null-guards the input (`:26`)
    and short-circuits to an empty list when there is nothing to project (`:28-31`), which keeps the
    empty-session case free of any query.
  - Grouped count (`:33-46`): collects the question ids (`:33`), takes a read repository for
    [`SessionQuestionUpvote`](#sessionquestionupvote) (`:34`), and runs the grouped projection over
    `TableNoTracking` through `queryableExecutor.ToListAsync` (`:39-44`). Soft-deleted (withdrawn)
    upvotes are excluded by the global query filter, so "active" needs no explicit predicate. The result
    folds into a `countsByQuestion` dictionary (`:46`).
  - The caller's own upvotes (`:50-58`): a **separate, narrower** query issued only when `callerUserId`
    is non-null, using `GetProjectedAsync` to fetch just `SessionQuestionId` for rows owned by that user
    (`:53-56`) into a `HashSet` (`:57`). The moderation view passes `null` and skips the query entirely
    (comment at `:48-49`), because `MyUpvote` and `IsMine` are not meaningful there.
  - Projection (`:60-73`): maps each question in its original order to a
    [`SessionQuestionDTO`](#sessionquestiondto), taking `UpvoteCount` from the dictionary via
    `GetValueOrDefault` (`:68`), `MyUpvote` from the set (`:69`), `IsMine` from the caller comparison
    (`:70`), and carrying `RowVersion` through for the
    [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html) round trip (`:72`).
    `UserId` is never copied onto the DTO: questions display anonymously (BR-238), and this single
    projection is the one place that rule has to hold.
- **Why it's built this way**: centralizing the projection guarantees every surface computes views
  identically, with the same number of queries, and honors the anonymity rule in exactly one place;
  splitting the "my upvotes" read out of the grouped count keeps the fan-out and moderation paths from
  paying for data they will not use.
- **Where it's used**: registered scoped at
  `MMCA.ADC.Engagement.Application/DependencyInjection.cs:73` and injected into
  [`SubmitQuestionHandler`](#submitquestionhandler)
  (`MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:28`),
  [`GetSessionQuestionsHandler`](#getsessionquestionshandler)
  (`MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetSessionQuestions/GetSessionQuestionsHandler.cs:29`),
  and [`GetModerationQueueHandler`](#getmoderationqueuehandler)
  (`MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetModerationQueue/GetModerationQueueHandler.cs:23`),
  the last being the `callerUserId is null` path.

### DeleteLivePollHandler
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Delete` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Delete/DeleteLivePollHandler.cs:14` · Level 9 · class (sealed)

- **What it is**: the poll delete use case: an eight-line subclass of the framework's generic
  [`DeleteEntityHandler<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentityhandlertentity-tidentifiertype)
  that adds nothing but the child collection the aggregate's own delete cascade has to see.
- **Depends on**:
  [`DeleteEntityHandler<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentityhandlertentity-tidentifiertype)
  (base, closed over [`LivePoll`](#livepoll) and `LivePollIdentifierType`),
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (forwarded to the base), and
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  as the message it handles.
- **Concept introduced, extending a generic handler by overriding a *structural* hook, not behavior.**
  `[Rubric §2, Design Patterns]` assesses the template-method shape: the base owns the workflow (load by
  id, refuse or proceed, call the aggregate's `Delete()`, save) and exposes exactly the two things a real
  delete outgrows, both structural. The framework spells this out at
  `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/DeleteEntityHandler.cs:12-21`: the child
  collections the cascade must see (`Includes`, `:57`) and a cross-aggregate refusal
  (`OnDeletingAsync`). A subclass overriding neither behaves identically to the base, down to the query
  it issues. This handler overrides only `Includes`. `[Rubric §8, Data Architecture]` assesses whether a
  soft-delete leaves the store consistent, and the class comment (`:7-13`) names the exact failure mode
  avoided: [`LivePoll.Delete`](#livepoll) cascades soft-delete to its owned options
  (`MMCA.ADC.Engagement.Domain/LivePolls/LivePoll.cs:223-225`, `DeleteChildren` over the `_options`
  backing field), but only over the children **actually loaded**, so an unloaded collection would leave
  the option rows active under a soft-deleted poll, still reachable by the results builder and by
  exports. Declaring the include is what closes that gap. `[Rubric §15, Best Practices]` applies to the
  size of the result: the whole use case is two property overrides, because everything else is already
  correct in the framework.
- **Walkthrough**
  - The class (`:14-15`): a sealed primary-constructor type taking
    [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and forwarding it to
    `DeleteEntityHandler<LivePoll, LivePollIdentifierType>(unitOfWork)`. No `HandleAsync` override
    exists; the inherited one at `DeleteEntityHandler.cs:66-88` runs.
  - `HandlerName` (`:18`): overrides the base default so a `NotFound` failure reports
    `DeleteLivePollHandler` as its `Source` rather than the open generic name
    (base default at `DeleteEntityHandler.cs:49`, used at `:73`).
  - `Includes` (`:21`): `[nameof(LivePoll.Options)]`, the one substantive line. The base feeds this into
    its by-id load, so the aggregate arrives with its options materialized and tracked (the base loads
    with tracking by default, `DeleteEntityHandler.cs:63`, because a no-tracking load would make the
    delete a silent no-op).
  - What the base then does (`DeleteEntityHandler.cs:70-87`): resolve the write repository, load, return
    `Error.NotFound` when missing (`:73`), run `OnDeletingAsync` (`:75`, not overridden here), call
    `entity.Delete()` (`:79`), and `SaveChangesAsync` only on success (`:82`). No domain event is raised
    by the handler: that belongs to [`LivePoll.Delete`](#livepoll), which is also where the BR-228
    "close an open poll before deleting it" refusal lives
    (`MMCA.ADC.Engagement.Domain/LivePolls/LivePoll.cs:212-219`).
- **Why it's built this way**: the delete rules that matter for a poll are all *domain* rules and
  already live on the aggregate, so re-implementing a handler would only duplicate the load-refuse-save
  workflow and risk drifting from it. Subclassing keeps the module's delete path indistinguishable from
  every other module's while still loading what this particular cascade needs.
- **Where it's used**: registered as the
  `ICommandHandler<DeleteEntityCommand<LivePoll, LivePollIdentifierType>, Result>` implementation at
  `MMCA.ADC.Engagement.Application/DependencyInjection.cs:67`, and dispatched by
  [`LivePollsController.DeleteAsync`](#livepollscontroller)
  (`MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:157-159`), which is the one endpoint
  behind `[HasPermission(EngagementPermissions.LiveManage)]`.

### LivePollConfiguration
> MMCA.ADC.Engagement.Infrastructure · `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePollConfiguration.cs:16` · Level 9 · class (internal sealed)

- **What it is**: the EF Core mapping for the [`LivePoll`](#livepoll) aggregate root: column
  requirements, the question length limit, the two query indexes, and the access mode EF uses to
  materialize the encapsulated options collection.
- **Depends on**:
  [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype)
  (the shared base that maps audit fields, soft-delete, and `RowVersion`), EF Core's
  `EntityTypeBuilder<T>` and `PropertyAccessMode`, and [`LivePollInvariants`](#livepollinvariants) for
  `QuestionMaxLength`.
- **Concept introduced, the no-cross-database foreign key rule.** The base class itself is taught in
  [Group 07](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype);
  what this file makes concrete is the remark at `:11-15`: `EventId` and `SessionId` point at
  Conference-owned rows in a *different* database, so they stay plain indexed scalar columns and
  consistency flows through the Conference gRPC validation boundary, never through an FK constraint.
  `[Rubric §7, Microservices Readiness]` assesses schema independence between services, which is exactly
  what the scalar-reference choice buys. `[Rubric §8, Data Architecture]` assesses the persistence
  contract (nullability, lengths, indexes) and the database-per-service discipline
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)); all of it is visible in
  a dozen lines here.
- **Concept introduced, pinning EF's access mode for an encapsulated collection.** `[Rubric §4, DDD]`
  assesses whether the aggregate keeps its collections closed to outside mutation. [`LivePoll`](#livepoll)
  exposes `Options` as a getter over a private `List` returned through `AsReadOnly()`, which means EF
  must read and write the **backing field**, never the property, or materialization silently produces
  nothing. EF's convention already infers field access for this shape; `:49-50` states it anyway with
  `builder.Navigation(p => p.Options).UsePropertyAccessMode(PropertyAccessMode.Field)`. The comment at
  `:43-48` gives the reason: stating it makes the mapping independent of that inference, so a later
  change to the property (a different projection, a computed wrapper) cannot silently turn
  materialization into a no-op. `[Rubric §16, Maintainability]` assesses exactly this kind of
  fail-loudly-later choice. It is an access mode only, no schema change: the relationship itself stays
  configured from the child side in
  [`LivePollOptionConfiguration`](#livepolloptionconfiguration).
- **Walkthrough**
  - `Configure` (`:20`) calls `base.Configure(builder)` first (`:22`) so the common conventions land
    before any override.
  - `EventId` required (`:24-25`); `Question` required with
    `HasMaxLength(LivePollInvariants.QuestionMaxLength)` (`:27-29`), sourcing the length from the domain
    constant so schema and invariant can never disagree; `Status` required (`:31-32`).
  - `HasIndex(p => p.EventId)` (`:35`): non-unique, because the Happening Now page and the organizer
    manage view both query polls by event (`:34`).
  - `HasIndex(p => new { p.SessionId, p.Status })` (`:41`): the composite added for
    [`GetOpenPollsHandler`](#getopenpollshandler). Its comment (`:37-40`) is the performance record:
    that query filters on `(SessionId, Status)`, runs once per attendee per session and again on every
    structural poll event, and only `EventId` was indexed, so it scanned. It deliberately mirrors
    `SessionQuestionConfiguration`
    ([group 22](group-22-engagement-module.md#sessionquestionconfiguration)), which already indexes the
    same pair. `[Rubric §12, Performance and Scalability]` assesses whether indexes match the real query
    shapes of the hot path.
  - `Navigation(p => p.Options).UsePropertyAccessMode(PropertyAccessMode.Field)` (`:49-50`): the access
    mode described above.
- **Why it's built this way**: one length constant sourced from the domain, scalar cross-service
  references per [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), indexes
  derived from the two live-layer read shapes rather than guessed, and an explicitly stated access mode
  so the aggregate's encapsulation and EF's materialization cannot drift apart.
- **Where it's used**: discovered and applied at model-build time by the Engagement `SQLServerDbContext`
  through EF Core's configuration scanning; it is `internal`, so nothing else can reach it.

### LivePollDTOMapper
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.DTOs` · `MMCA.ADC.Engagement.Application/LivePolls/DTOs/LivePollDTOMapper.cs:13` · Level 9 · class (sealed partial)

- **What it is**: the Mapperly-generated mapper that turns a [`LivePoll`](#livepoll) entity, including
  its options, into a [`LivePollDTO`](#livepolldto) for read responses.
- **Depends on**:
  [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype)
  (the framework mapper contract it satisfies, `:14`), [`LivePoll`](#livepoll),
  [`LivePollDTO`](#livepolldto), and the `Riok.Mapperly.Abstractions` source generator (`[Mapper]`,
  `:12`).
- **Concept reinforced, compile-time DTO mapping
  ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)).** Taught with the other
  `…DTOMapper` types: the `[Mapper]` attribute on a `partial` class makes Mapperly emit the
  property-copy code at build time, so there is no runtime reflection, no hand-written assignments to
  drift, and a missing member is a build error rather than a silently null field. `[Rubric §9, API and
  Contract Design]` assesses whether the wire contract is decoupled from the domain model; mapping the
  aggregate to a dedicated record ([`LivePollDTO`](#livepolldto), which also carries the
  [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html) `RowVersion` token) is
  that decoupling. `[Rubric §15, Best Practices]` applies because generated mapping is allocation-light
  and analyzer-clean under this repo's warnings-as-errors setting.
- **Walkthrough**
  - `MapToDTO(LivePoll entity)` (`:17`): declared `partial` with no body; Mapperly generates the
    entity-to-DTO copy, including the nested [`LivePollOption`](#livepolloption) collection, from the
    two shapes.
  - `MapToDTOs(IReadOnlyCollection<LivePoll>)` (`:20-24`): the hand-written collection overload,
    null-guarded with `ArgumentNullException.ThrowIfNull` (`:22`) and projecting each entity through
    `MapToDTO` into a collection-expression result (`:23`).
- **Why it's built this way**: implementing the framework's mapper interface with generated code keeps
  the poll read path fast and drift-free, which is exactly the trade
  [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) records against
  reflection-based mapping.
- **Where it's used**: resolved by the generic entity-query-service wiring and by the poll read handlers
  such as [`GetEventPollsHandler`](#geteventpollshandler) and
  [`GetSessionManagePollsHandler`](#getsessionmanagepollshandler). Registration is convention-based:
  `ScanModuleApplicationServices<ClassReference>()` picks up every mapper in the assembly
  (`MMCA.ADC.Engagement.Application/DependencyInjection.cs:87`).

### LivePollOptionConfiguration
> MMCA.ADC.Engagement.Infrastructure · `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePollOptionConfiguration.cs:10` · Level 9 · class (internal sealed)

- **What it is**: the EF mapping for the [`LivePollOption`](#livepolloption) child entity: its text
  limit and its real relationship back to [`LivePoll`](#livepoll).
- **Depends on**:
  [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype),
  EF Core `EntityTypeBuilder<T>`, and [`LivePollInvariants`](#livepollinvariants) for
  `OptionTextMaxLength`.
- **Concept reinforced, the in-aggregate child.** Read this directly against
  [`LivePollConfiguration`](#livepollconfiguration): there, a cross-service reference stays a bare
  scalar; here, both ends are Engagement-owned and in the same database, so the option gets a genuine
  navigation and a genuine foreign key (`:22-25`). `[Rubric §8, Data Architecture]`: the contrast is the
  lesson, an FK is correct precisely when the constraint can be enforced by one database.
- **Walkthrough**
  - `Configure` (`:14`) calls `base.Configure` (`:16`), then makes `Text` required with
    `HasMaxLength(LivePollInvariants.OptionTextMaxLength)` (`:18-20`).
  - `HasOne(o => o.LivePoll).WithMany(p => p.Options).HasForeignKey(o => o.LivePollId).IsRequired()`
    (`:22-25`): the required one-poll-to-many-options relationship inside the aggregate boundary,
    configured from the child side, which is why
    [`LivePollConfiguration`](#livepollconfiguration) only has to state the collection's access mode.
- **Why it's built this way**: an option has no meaning without its poll, so the database is allowed to
  say so; the length again comes from the domain constant rather than a repeated literal.
- **Where it's used**: applied by the Engagement `SQLServerDbContext` at model build; the collection it
  maps is rehydrated on query paths by
  [`LivePollNavigationPopulator`](#livepollnavigationpopulator) and eager-loaded on the delete path by
  [`DeleteLivePollHandler`](#deletelivepollhandler).

### LivePollsController
> MMCA.ADC.Engagement.API · `MMCA.ADC.Engagement.API.Controllers` · `MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:44` · Level 9 · class (sealed)

- **What it is**: the REST controller for the live poll layer: create, open, close, and delete a poll,
  list polls for the organizer and for the session moderation panel, read tallies, and cast a vote.
- **Depends on**: nine handlers injected through
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  (including the generic
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  for delete, served by [`DeleteLivePollHandler`](#deletelivepollhandler)),
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) for claims,
  [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) for the `HandleFailure`
  Result-to-HTTP bridge, [`RoleNames`](group-08-auth.md#rolenames),
  [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute),
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute),
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute),
  [`EngagementPermissions`](group-22-engagement-module.md#engagementpermissions), and
  [`EngagementFeatures`](group-22-engagement-module.md#engagementfeatures). Externals: ASP.NET Core MVC,
  `Asp.Versioning`, and `Microsoft.FeatureManagement.Mvc` (`[FeatureGate]`).
- **Concept introduced, three stacked authorization tiers on one controller.** `[Rubric §11, Security]`
  assesses where the trust boundary sits and whether identity is derived from a trusted source.
  `[Rubric §9, API and Contract Design]` assesses whether controllers stay thin transport adapters over
  the handler pipeline. The class attributes (`:39-43`) set two of the tiers:
  `[FeatureGate(EngagementFeatures.LivePolls)]` makes the entire surface dark when the flag is off, and
  a bare `[Authorize]` requires a token at all. The third tier is per-endpoint: only the organizer-facing
  delete (`:149`) and the event-wide manage list (`:168`) carry
  `[HasPermission(EngagementPermissions.LiveManage)]`, while the finer "this speaker owns this session"
  rule (BR-236) is evaluated *inside* the handlers via
  [`LivePollAuthorization`](#livepollauthorization), because it needs data the transport layer does not
  have. The session moderation list at `:192` is the instructive case: its doc comment (`:181-187`)
  states that it is **deliberately not** behind `LiveManage`, so a session's assigned speakers get the
  real list from the handler's BR-236 check instead of an organizer-only 403 they would have to work
  around. Complementing all three, caller identity is bound from the token and never from the request
  (`:284-293`).
- **Concept introduced, conditional writes over the `If-Match` header
  ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)).** The lifecycle verbs
  carry no body at all. `[SupportsIfMatch]` (`:92`, `:126`) makes the precondition **mandatory**: the
  action filter reads the caller's entity tag from `If-Match`, answers a request that states none with
  `428 Precondition Required` before the action ever runs, answers an undecodable tag with `400`, and
  rewrites a concurrency conflict from the handler into `412 Precondition Failed`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Concurrency/SupportsIfMatchAttribute.cs:49`,
  `:126-153`, `:161-190`). The action itself just calls
  `SupportsIfMatchAttribute.RequiredToken(HttpContext)` (`:104`, `:138`) to pull the already-validated
  token out and pass it into the command. Alongside it, `[Idempotent]`
  ([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)) marks the four writes
  where replaying a retried request is what the caller meant (`:63`, `:91`, `:125`, `:260`), which on a
  conference-day mobile network is not a theoretical concern. The `ProducesResponseType` lists on those
  actions (`:93-99`, `:127-133`) are the documented contract for all of it.
- **Walkthrough**
  - The primary constructor (`:44-54`) injects five command handlers, four query handlers, and
    [`ICurrentUserService`](group-08-auth.md#icurrentuserservice). Every action follows the same three
    steps: build a message, await the handler, map the
    [`Result`](group-01-result-error-handling.md#result) to HTTP.
  - `CreateAsync` (`:67`): builds [`CreateLivePollCommand`](#createlivepollcommand) from the body plus
    `GetCallerSpeakerId()` / `IsCallerOrganizer()` (`:71`) and returns `201 Created` with a relative
    location built under `CultureInfo.InvariantCulture` (`:76`).
  - `OpenAsync` (`:100`) and `CloseAsync` (`:134`): the lifecycle verbs, returning `204 No Content`.
    Both take the row version from `RequiredToken` (`:104`, `:138`) and forward it into
    `OpenLivePollCommand` / `CloseLivePollCommand` (`:105`, `:139`).
  - `DeleteAsync` (`:153`): `[HasPermission(LiveManage)]`-gated (`:149`), dispatching the generic
    [`DeleteEntityCommand<LivePoll, LivePollIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
    (`:157-159`); the BR-228 "close an open poll before deleting it" rule lives deeper, in
    [`LivePoll.Delete`](#livepoll).
  - `GetEventPollsAsync` (`:170`): the organizer manage list, also `[HasPermission(LiveManage)]`, with
    `[FromQuery, Required] EventIdentifierType eventId` (`:171`).
  - `GetSessionManagePollsAsync` (`:192`): the session moderation panel, ungated at the transport layer,
    passing `sessionId` plus the two claim-derived flags into
    [`GetSessionManagePollsQuery`](#getsessionmanagepollsquery) (`:196`).
  - `GetOpenPollsAsync` (`:211`): the attendee and presenter view, taking optional `eventId` **or**
    `sessionId` (`:212-213`). Like `GetResultsAsync` (`:235`) and `CastVoteAsync` (`:264`), it first
    reads `currentUserService.UserId` and returns an `Error.Forbidden` when the token carries no
    subject (`:216-220`), then stamps the id onto the query or command.
  - `CastVoteAsync` (`:264`): builds [`CastVoteCommand`](#castvotecommand) from the route id, the body's
    `OptionId`, and the token subject (`:276`), and returns the fresh
    [`LivePollResultsDTO`](#livepollresultsdto) as `200 OK` (`:281`).
  - The two claim helpers are the load-bearing security detail: `GetCallerSpeakerId()` (`:285`) reads
    the `speaker_id` claim and maps a default value to `null` (`:287-288`), and `IsCallerOrganizer()`
    (`:292`) is `IsInRole(Organizer) || IsInRole(Admin)` (`:293`).
- **Why it's built this way**: a declarative capability gate keeps the two organizer-only endpoints
  locked without any code, while delegating the data-scoped speaker decision to a shared handler check
  avoids duplicating BR-236 at the transport layer and keeps the same rule in force for any future
  transport. Pushing the concurrency token into a header rather than a request body means the lifecycle
  verbs need no body type at all and the missing-precondition case is answered by the filter instead of
  by every handler. The `[FeatureGate]` lets the whole live-poll surface ship dark and be enabled per
  environment.
- **Where it's used**: mounted by the Engagement service host and reached by the Blazor and MAUI clients
  through the YARP Gateway
  ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).

### SessionQuestionsController
> MMCA.ADC.Engagement.API · `MMCA.ADC.Engagement.API.Controllers` · `MMCA.ADC.Engagement.API/Controllers/SessionQuestionsController.cs:37` · Level 9 · class (sealed)

- **What it is**: the REST controller for the conference-day session Q&A layer: submit a question, read
  the attendee and moderation views, run the three moderation transitions, and set or withdraw an
  upvote.
- **Depends on**: five handlers via
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  / [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult),
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice),
  [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase),
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute),
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute),
  [`ModerationAction`](#moderationaction),
  [`SubmitQuestionRequest`](#submitquestionrequest),
  [`EngagementFeatures`](group-22-engagement-module.md#engagementfeatures), and
  [`RoleNames`](group-08-auth.md#rolenames).
- **Concept reinforced, identity bound at the edge, rights enforced in the handler.** The same shape as
  [`LivePollsController`](#livepollscontroller), with one instructive difference: this controller has
  **no** `[HasPermission]` endpoint at all. Its class attributes (`:32-36`) apply
  `[FeatureGate(EngagementFeatures.SessionQA)]` and a bare `[Authorize]`, and every moderation decision
  (BR-236) is made inside the handler from the `speaker_id` claim and the organizer role, because "may
  this speaker moderate this session" is a data question. That is why the moderation-queue action
  documents both `403` and `404` (`:106-107`): the handler, not the pipeline, decides which one applies.
  `[Rubric §11, Security]` and `[Rubric §9, API and Contract Design]` both apply for the reasons given
  under [`LivePollsController`](#livepollscontroller).
- **Walkthrough**
  - The primary constructor (`:37-43`) injects three command handlers, two query handlers, and
    [`ICurrentUserService`](group-08-auth.md#icurrentuserservice).
  - `SubmitAsync` (`:56`): `[Idempotent]` (`:52`) so a timed-out submit replayed with the same
    `Idempotency-Key` does not post the question twice. It reads the token subject, refuses with
    `Error.Forbidden` when absent (`:60-64`), builds
    [`SubmitQuestionCommand`](#submitquestioncommand) (`:66`), and returns `201 Created` at
    `/sessionquestions/{id}` (`:71`).
  - `GetSessionQuestionsAsync` (`:81`): the attendee view (approved questions plus the caller's own
    pending or dismissed ones), keyed on `[FromQuery, Required] sessionId` (`:82`) and the caller id
    (`:92`).
  - `GetModerationQueueAsync` (`:108`): the all-statuses moderator view; it passes
    `GetCallerSpeakerId()` and `IsCallerOrganizer()` into
    [`GetModerationQueueQuery`](#getmoderationqueuequery) (`:113`) so the rights check happens in the
    handler.
  - `ApproveAsync` (`:142`), `DismissAsync` (`:168`), `MarkAnsweredAsync` (`:194`): three
    expression-bodied verbs that differ only by their [`ModerationAction`](#moderationaction) and all
    funnel into the private `ModerateAsync` (`:224`), which builds
    [`ModerateQuestionCommand`](#moderatequestioncommand) (`:230`) and returns `204 No Content` (`:235`).
    Each carries no body and the same `[Idempotent]` + `[SupportsIfMatch]` pair as the poll lifecycle
    verbs (`:133-134`, `:159-160`, `:185-186`), reading its row version from
    `SupportsIfMatchAttribute.RequiredToken(HttpContext)` at the call site (`:145`, `:171`, `:197`).
  - `UpvoteAsync` (`:209`) and `RemoveUpvoteAsync` (`:219`): the POST/DELETE pair on `{id}/upvotes`,
    both delegating to the private `ToggleUpvoteAsync` (`:238`) with `upvote: true|false`. Only the POST
    is marked `[Idempotent]` (`:205`), and its comment (`:200-203`) explains why that is safe: the route
    **sets** the upvote rather than toggling it, so a replay is the same assertion, while the DELETE is
    the separate withdraw path. The helper binds the caller id from the token (`:243-247`), dispatches
    [`ToggleUpvoteCommand`](#toggleupvotecommand) (`:250`), and returns the fresh count as `200 OK`
    (`:255`), so the clicking client updates immediately without waiting for the broadcast.
  - `GetCallerSpeakerId()` (`:259`) and `IsCallerOrganizer()` (`:266`): identical in shape to the poll
    controller's helpers, reading the token only.
- **Why it's built this way**: keeping the controller a pure transport adapter means the moderation rule
  is written once, in the handler, and cannot be bypassed by a second caller path; returning the fresh
  upvote count synchronously gives the acting user immediate feedback while the
  [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) broadcast fans the same
  number out to everyone else.
- **Where it's used**: mounted by the Engagement service host; reached through the Gateway
  ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).

### LivePollVoteChangedHandler
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.DomainEventHandlers` · `MMCA.ADC.Engagement.Application/LivePolls/DomainEventHandlers/LivePollVoteChangedHandler.cs:38` · Level 10 · class (sealed)

- **What it is**: the poll-side twin of
  [`SessionQuestionUpvoteChangedHandler`](#sessionquestionupvotechangedhandler): it broadcasts fresh
  poll tallies whenever a vote is cast, changed, or withdrawn (the `poll.results-changed` channel event,
  BR-229 / [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)).
- **Depends on**:
  [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent)
  (implemented for [`LivePollVoteChanged`](#livepollvotechanged)),
  [`BestEffort`](group-03-querying-specifications.md#besteffort),
  [`ILiveChannelPublishQueue`](group-22-engagement-module.md#ilivechannelpublishqueue) /
  [`LiveChannelPublishWorkItem`](group-22-engagement-module.md#livechannelpublishworkitem),
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`LivePollResultsBuilder`](#livepollresultsbuilder), [`LivePoll`](#livepoll), and
  [`LivePollChannel`](#livepollchannel). Externals: `IServiceScopeFactory`, `ILogger`,
  `System.Text.Json`.
- **Concept reinforced**: the post-commit, off-request-path, best-effort broadcast is taught under
  [`SessionQuestionUpvoteChangedHandler`](#sessionquestionupvotechangedhandler); the comment here
  (`:18-24`) records the same rollback defect on the vote path, where the command handler enqueued while
  its transaction was still open, and `:25-30` records the same move to
  [`BestEffort`](group-03-querying-specifications.md#besteffort) with its own operation name
  (`:44`, `"livepoll-results-broadcast"`). Two details are specific to polls. The tally is not a single
  `COUNT` but a full [`LivePollResultsDTO`](#livepollresultsdto) built by
  [`LivePollResultsBuilder`](#livepollresultsbuilder), and the channel key is *conditional*, because a
  poll may be session-scoped or event-wide. `[Rubric §29, Resilience and Business Continuity]` and
  `[Rubric §13, Observability and Operability]` apply for the same reasons as the sibling handler.
- **Walkthrough**
  - The primary constructor (`:38-41`) mirrors the sibling's, and the class is likewise a singleton that
    opens its own scope (`:31-33`).
  - `HandleAsync` (`:47`): null-guards the event (`:49`), then returns
    `BestEffort.ExecuteAsync(BroadcastOperation, logger, …, cancellationToken)` (`:51`, closing at
    `:83`); the lambda opens an async scope and resolves both
    [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and
    [`LivePollResultsBuilder`](#livepollresultsbuilder) from it (`:53-55`).
  - Poll re-read (`:57-62`): a no-tracking `GetByIdAsync` that explicitly passes
    `includes: [nameof(LivePoll.Options)]` (`:60`), because the results builder reads `poll.Options` and
    does not load them itself. A `null` poll means it was removed between the vote committing and this
    dispatch, and the handler returns (`:64-69`).
  - Tally (`:73`): `resultsBuilder.BuildAsync(poll, userId: null, broadcastToken)`. Passing `null` is
    deliberate and documented at `:71-72`: a broadcast has no single caller, so `MyVoteOptionId` stays
    null and the builder skips its per-user point read entirely. No per-user data ever rides the channel
    (BR-229 / [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)).
  - Channel key (`:75-77`): `poll.SessionId is { } sessionId ? LivePollChannel.ForSession(sessionId) :
    LivePollChannel.ForEvent(poll.EventId)`, the one place the event-wide versus session-scoped
    distinction (BR-230) turns into a transport address.
  - Enqueue (`:79-82`): a
    [`LiveChannelPublishWorkItem`](group-22-engagement-module.md#livechannelpublishworkitem) with that
    key, the `LivePollChannel.PollResultsChanged` event name
    (`MMCA.ADC.Engagement.Shared/LivePolls/LivePollChannel.cs:20`), and the serialized results.
- **Why it's built this way**: recomputing the tally here rather than shipping a delta means every
  subscriber receives the same authoritative snapshot regardless of how many votes raced, and enqueuing
  after commit means no client ever sees a tally that a rollback erased
  ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)).
- **Where it's used**: discovered by convention-based scanning
  (`MMCA.ADC.Engagement.Application/DependencyInjection.cs:87`) and invoked by the domain-event
  dispatcher after [`CastVoteHandler`](#castvotehandler) commits; its comment at
  `MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteHandler.cs:88-89` points back
  here to explain why the handler itself no longer publishes.


---
[⬅ ADC Engagement Module (Session Bookmarks)](group-22-engagement-module.md)  •  [Index](00-index.md)  •  [ADC Identity Module (Users, Profiles, GDPR Export/Erasure) ➡](group-24-identity-module.md)
