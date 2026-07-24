# 23. ADC Engagement Live Layer (Real-Time Polls & Session Q&A)

**What this chapter covers.** This is the conference-day layer of the Engagement bounded context:
the features that only matter while an event is actually happening in the room. There are two of
them, and they share one shape. **Live polls**, [`LivePoll`](#livepoll), let an organizer or a
session's speaker open a multiple-choice question for the audience, collect votes in real time, and
project a running tally. **Session Q&A**, [`SessionQuestion`](#sessionquestion), lets attendees
submit questions to a live session, upvote each other's, and lets a moderator approve, dismiss, or
mark-answered from a queue. Both are read by three Blazor surfaces: the event-wide
[`HappeningNow`](#happeningnow) board, the routed per-session [`SessionLive`](#sessionlive) page, and
the speaker-facing [`PresenterView`](#presenterview). What makes the layer distinct from the rest of
Engagement (the bookmarks of [Group 22](group-22-engagement-module.md)) is that state changes must
fan out to every open page in **under a second**, so the whole chapter is really about one
transport decision: how a vote cast on one phone lights up the tally on two hundred others.

That transport is the SignalR **hub-channel** push introduced by **[ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)**, and it is deliberately
the *opposite* of the durable notification pipeline ([ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html)) that the same hub also carries. A
durable notification writes a per-user inbox row and is worth finding minutes later; a live tally is
broadcast to whoever is looking *right now* and is worthless a second later, so it is never
persisted and carries no delivery guarantee. Everything in this chapter treats a channel event as a
**cache-invalidation hint over fetchable state**, not as the state itself: if a client connects late
and misses an event, its next fetch still shows the truth. That single design rule ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)'s
"ephemeral means lossy") explains most of the code you will read here.

## The two aggregates and their invariants

Both aggregates are sealed [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
subclasses that follow the framework's factory-plus-`Result` discipline (primer §2). [`LivePoll`](#livepoll)
(`MMCA.ADC.Engagement.Domain/LivePolls/LivePoll.cs:18`) holds an
`EventId`, an optional `SessionId` (null for an event-wide poll, BR-230), a question, its authored
[`LivePollOption`](#livepolloption) children, and a strict lifecycle `Status`
([`LivePollStatus`](#livepollstatus)): `Draft` to `Open` to `Closed`, no reopen (BR-221). Its
`Create` factory validates through [`LivePollInvariants`](#livepollinvariants) (2 to 10 unique
options), and `Open`/`Close`/`Delete` each guard the transition (an open poll cannot be deleted,
BR-228). [`SessionQuestion`](#sessionquestion)
(`MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestion.cs:19`) holds a `SessionId`, a
denormalized `EventId`, the submitter's `UserId` (never exposed on a DTO, BR-238), the text, a
[`QuestionStatus`](#questionstatus) (`Pending`/`Approved`/`Dismissed`), and an `IsAnswered` flag;
`Approve`/`Dismiss`/`MarkAnswered` are the moderation transitions (BR-234).

The one design idea worth internalizing early is the **live-window snapshot**. When a poll is opened
(`LivePoll.Open`, `LivePoll.cs:108`) or a question is submitted (`SessionQuestion.Create`,
`SessionQuestion.cs:77`), the event's live-window end (`LiveWindowEndUtc`) is copied *onto* the
aggregate. From then on the aggregate can answer "is this vote still allowed?"
(`CanAcceptVote`, `LivePoll.cs:167`) or "is this upvote still allowed?" (`CanAcceptUpvote`,
`SessionQuestion.cs:197`) against its own snapshotted field, with **no cross-service call per vote**
(BR-224/BR-237). That matters because votes and upvotes are the high-frequency operations; paying a
gRPC hop on each one would not scale. And like the bookmark aggregate, both use a **single**
domain event carrying a [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate)
discriminator, [`LivePollChanged`](#livepollchanged) and [`SessionQuestionChanged`](#sessionquestionchanged)
(BR-60), rather than separate per-transition events. Those domain events are the durable
[`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent)s captured by the outbox ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) for
future integration; they are **not** the realtime push, which is a separate best-effort call
described below.

A vote and an upvote are themselves small aggregates, [`LivePollVote`](#livepollvote) and
[`SessionQuestionUpvote`](#sessionquestionupvote), each with a "one active row per (poll/question,
user)" rule enforced by a filtered unique index and the same reactivate-instead-of-reinsert dance
(BR-225/BR-135) the bookmark module uses: [`CastVoteHandler`](#castvotehandler) updates a live vote,
revives a soft-deleted one, or inserts a new one (`CastVoteHandler.cs:62-81`), so a user who changes
their mind never piles up tombstones.

## The write path, and where the realtime push actually happens

Each operation is a vertical slice under `Application/{LivePolls|SessionQuestions}/UseCases/{Op}/`.
The command handlers ([`CreateLivePollHandler`](#createlivepollhandler),
[`OpenLivePollHandler`](#openlivepollhandler), [`CloseLivePollHandler`](#closelivepollhandler),
[`CastVoteHandler`](#castvotehandler), [`SubmitQuestionHandler`](#submitquestionhandler),
[`ModerateQuestionHandler`](#moderatequestionhandler), [`ToggleUpvoteHandler`](#toggleupvotehandler))
all follow the same three beats: mutate the aggregate through its business method, `SaveChangesAsync`
(which commits the data and the domain event to the outbox in one transaction), then **publish the
ephemeral channel event best-effort**. That last step is the heart of the chapter. Each handler
resolves a channel key from the aggregate's scope ([`LivePollChannel.ForEvent`](#livepollchannel) =
`event:1`, or `ForSession` = `session:123`; questions reuse the session key so a session's polls and
questions share one channel), serializes a small payload record to JSON, and calls
`ILiveChannelPublisher.PublishAsync(channelKey, eventName, payloadJson)`. The publish is wrapped in a
`try`/`catch` with a justified `CA1031` suppression and a warning log (for example
`CastVoteHandler.cs:94-119`): a failed push **must never fail the command**, because the vote is
already committed and the broadcast is only a hint.

Two rules govern what rides the channel. First, **broadcasts never carry per-user data** (BR-229):
[`CastVoteHandler`](#castvotehandler) strips the caller's own vote marker before publishing
(`results with { MyVoteOptionId = null }`, `CastVoteHandler.cs:103-105`). Second, **pending question
content is never broadcast** (BR-238): [`SubmitQuestionHandler`](#submitquestionhandler) and
[`ModerateQuestionHandler`](#moderatequestionhandler) publish the full text only for an *approved*
question, and when a pending question is submitted or leaves the queue the channel carries only a
`question.pending-count-changed` count so moderators see the badge move without leaking unmoderated
text (`SubmitQuestionHandler.cs:110-127`, `ModerateQuestionHandler.cs:118-135`). The event-name and
payload-shape vocabulary for both features lives in the two channel-contract classes shared by
publisher and subscriber, [`LivePollChannel`](#livepollchannel) and
[`SessionQuestionChannel`](#sessionquestionchannel).

## One WebSocket, two publisher extension points, and a cross-service ingress

The transport itself is framework-owned ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html), [Group 10](group-10-notifications.md)). The single
[`NotificationHub`](group-10-notifications.md#notificationhub) carries both durable notifications and
channel events on one connection, and the application-layer port
[`ILiveChannelPublisher`](group-10-notifications.md#ilivechannelpublisher) keeps the handlers
transport-free, exactly the way [`IPushNotificationSender`](group-10-notifications.md#ipushnotificationsender)
does for the durable path. Which implementation resolves tells you the deployment topology, the same
"resolvable everywhere, active only where configured" convention as the rest of the framework:
[`SignalRLiveChannelPublisher`](group-10-notifications.md#signalrlivechannelpublisher) group-sends
over the hub in a host that maps it; [`NullLiveChannelPublisher`](group-10-notifications.md#nulllivechannelpublisher)
is the no-op default. In ADC the twist is that the Engagement service does **not** map the hub (the
Notification service does), so Engagement registers a **gRPC adapter** for `ILiveChannelPublisher`
that forwards the pre-serialized JSON payload to the Notification service's live-channel ingress,
which then does the real group send. This is exactly the "a host that does not map the hub can
replace the registration with its own transport" boundary [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) anticipates, and it rides the [ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html)
mixed-endpoint gRPC profile (the Notification service serves a dedicated `Http2`-only endpoint for
this ingress alongside its WebSocket endpoint). Because the payload is an opaque string at every hop,
no serializer dependency crosses the wire.

On the browser side, [`NotificationHubService`](group-15-common-ui-framework.md#notificationhubservice)
(Common, [Group 15](group-15-common-ui-framework.md)) owns the one connection and exposes
`JoinChannelAsync` / `LeaveChannelAsync` / a **multicast** `OnChannelEvent` subscription, and it
re-joins every tracked channel on reconnect (SignalR group membership does not survive an automatic
reconnect). A page subscribes with `OnChannelEvent` and joins its channel in `OnAfterRenderAsync`, and leaves
the channel on teardown; [`SessionLive`](#sessionlive) does exactly this
(`SessionLive.razor.cs:116-126`, teardown at `SessionLive.razor.cs:352`).

## The read path and how the UI reacts

Reads do not go through the generic entity-query machinery; the live views need shaped projections.
[`LivePollResultsBuilder`](#livepollresultsbuilder) computes each option's tally and the caller's own
`MyVoteOptionId`, and [`SessionQuestionViewBuilder`](#sessionquestionviewbuilder) builds the
attendee/moderator question views with per-caller `IsMine`/`HasUpvoted` flags, feeding the query
handlers behind `GET /livepolls/open`, `/livepolls/{id}/results`, `/sessionquestions`, and
`/sessionquestions/moderation`. [`LivePollNavigationPopulator`](#livepollnavigationpopulator) loads a
poll's `Options` on query-service paths EF cannot `.Include()` ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)), and the EF configurations
([`LivePollConfiguration`](#livepollconfiguration) and siblings) pin the entities to SQL Server in
the `ADC_Engagement` database under database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). Entity-to-DTO mapping is a
compile-time Mapperly mapper, [`LivePollDTOMapper`](#livepolldtomapper) ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)).

When a channel event arrives, the page decides between **patch-in-place** and **reload**, and this is
the chapter's key performance lesson. High-frequency tally events (`poll.results-changed`,
`question.upvote-changed`) already carry the fresh counts in their payload, so the page patches its
in-memory model and calls `StateHasChanged` with **no HTTP refetch** (`SessionLive.razor.cs:182-231`).
The comment there records why: reloading on every broadcast turned *V* voters times *C* viewers into
*V*C* authenticated refetches per hot poll, which collided with the per-user rate limiter under burst
voting. Structural events (opened, closed, approved, answered, dismissed, pending-count-changed) are
rarer and *do* trigger a targeted reload of the affected list. Whether the layer is even active is
decided by [`LiveEventService`](#liveeventservice): it fetches the current-or-next published event and
computes its live window into a [`LiveEventContext`](#liveeventcontext) (mirroring the backend math),
and degrades to `null` on any API failure so the live surfaces simply stay dormant rather than error.
The cross-module [`ISessionLiveUIService`](#isessionliveuiservice) / [`SessionLiveUIService`](#sessionliveuiservice)
boundary is what lets a Conference session page light up its "Live" button when Engagement is deployed.

## Authorization, feature gating, and the cross-service dependency on Conference

Both controllers, [`LivePollsController`](#livepollscontroller) and
[`SessionQuestionsController`](#sessionquestionscontroller), sit behind
[`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) and are gated two ways:
`[Authorize(Policy = AuthorizationPolicies.RequireAuthenticated)]`
([`AuthorizationPolicies`](group-08-auth.md#authorizationpolicies), no anonymous participation) and a
`[FeatureGate]` per feature ([`EngagementFeatures`](group-22-engagement-module.md#engagementfeatures)
`LivePolls` / `SessionQA`) that makes the whole surface vanish (404) when toggled off. The finer
authoring/moderation rights (BR-236) are enforced **in the handlers**, not by an attribute, through
the shared [`LivePollAuthorization`](#livepollauthorization) check: organizers and admins manage
everything, and a speaker manages only content scoped to a session they are assigned to (matched
against the [`SessionLiveInfo.SpeakerIds`](group-17-conference-domain.md#sessionliveinfo) list from
Conference). The organizer-only manage list and the delete endpoint additionally carry
`[HasPermission(EngagementPermissions.LiveManage)]` ([ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)). Crucially, the caller's identity (user
id, `speaker_id` claim, roles) is always bound from the token via
[`ICurrentUserService`](group-08-auth.md#icurrentuserservice), never from the request body
(`LivePollsController.cs:213-222`).

This makes the live layer **bidirectionally coupled to Conference**, the same modular-monolith boundary
Group 22 demonstrated ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)/[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). Engagement calls Conference's
[`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice) to fetch
the live window, the session's assigned speakers, and the event's moderation default (in-process when
co-hosted, over gRPC when extracted), and Conference calls Engagement to light up its Live button. The
[`EngagementModule`](group-22-engagement-module.md#engagementmodule) declares the dependency, and the
same disabled-stub registrations keep every interface resolvable in a single-module service host. The
UI clients ([`LivePollUIService`](#livepolluiservice), [`SessionQuestionUIService`](#sessionquestionuiservice))
extend Common's [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase)
and go back through the Gateway's public REST routes, not a back channel.

**Rubric lenses this chapter exercises.** `[Rubric §4, DDD]` (two aggregates with lifecycle state
machines, invariant guards, the live-window snapshot, and the single-event-with-state design);
`[Rubric §6, CQRS & Event-Driven]` (command/query slices, durable domain events over the outbox
*versus* the separate ephemeral channel push); `[Rubric §7, Microservices Readiness]` (the
`ILiveChannelPublisher` port with a SignalR impl, a Null default, and a gRPC forwarding adapter, plus
the Conference validation boundary); `[Rubric §12, Performance & Scalability]` (per-vote checks against a
snapshotted window with no cross-service hop, and patch-in-place tally updates that avoid the *V*C*
refetch storm against the rate limiter); `[Rubric §11, Security]` (RequireAuthenticated + feature
gates + handler-enforced speaker-scoped rights + `HasPermission`, identity from token, anonymous
question display, and pending text kept off the channel, BR-238); `[Rubric §9, API & Contract Design]`
(feature-gated, versioned REST endpoints returning Problem Details); `[Rubric §18/§19, UI Architecture
/ State Management]` (three live surfaces over one multicast hub subscription, patch-vs-reload event
handling, re-join on reconnect); `[Rubric §29, Resilience]` (best-effort publish that never fails the
command and a UI that treats channel events as hints over fetchable state, degrading to dormant on
failure); and `[Rubric §13, Observability]` (every dropped publish is logged as a warning). Each is
taught in full at the relevant per-type section below.

### CastVoteCommand
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteCommand.cs:11` · Level 0 · record

- **What it is**: the CQRS command an attendee sends to cast (or change) a vote on an open poll. A
  `sealed record` carrying three values: `PollId`, `OptionId`, and the voting `UserId`
  (`CastVoteCommand.cs:11-14`).
- **Depends on**: nothing first-party (three identifier-type aliases, `LivePollIdentifierType`,
  `LivePollOptionIdentifierType`, `UserIdentifierType`, plus the BCL `record`). It is dispatched to
  [`CastVoteHandler`](#castvotehandler) through the CQRS pipeline.
- **Concept introduced, the token-bound caller identity.** `[Rubric §11, Security]` (assesses whether
  identity/authorization is derived from a trusted source, not from client-supplied data). The doc
  comment is emphatic (`CastVoteCommand.cs:4-6`): `UserId` is **bound from the caller's token at the
  API edge, never from the request body**. This is the recurring shape across every live-layer message,
  the controller reads the authenticated subject (and, for the manage commands, the role and
  `speaker_id` claim) and stamps it onto the command, so a client cannot vote as (or moderate on behalf
  of) someone else by forging a field. `[Rubric §6, CQRS & Event-Driven]`: this is a command (it
  mutates state and returns a [`Result`](group-01-result-error-handling.md#result)), the read-side
  counterparts in this group are the `…Query` records.
- **Walkthrough**: three positional members. `PollId` (`:12`) and `OptionId` (`:13`) name the vote
  target; `UserId` (`:14`) is the token-bound voter. There is no method here, a command is a pure data
  message; the behavior lives in its handler and validator.
- **Why it's built this way**: a `record` gives value equality and immutability for free, and keeping
  the message a flat DTO is the vertical-slice convention (command, validator, handler co-located under
  one `UseCases/CastVote/` folder, `[Rubric §5, Vertical Slice]`).
- **Where it's used**: constructed at the Engagement REST edge and handled by
  [`CastVoteHandler`](#castvotehandler); shape-validated first by
  [`CastVoteCommandValidator`](#castvotecommandvalidator).

### CloseLivePollCommand
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Close` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Close/CloseLivePollCommand.cs:11` · Level 0 · record

- **What it is**: the command that closes an open poll (BR-221, no reopen). A `sealed record` carrying
  the target `PollId` plus the two caller-rights fields (`CloseLivePollCommand.cs:11-14`).
- **Depends on**: nothing first-party; handled by [`CloseLivePollHandler`](#closelivepollhandler).
- **Concept introduced, the caller-rights triple.** This record and its sibling
  [`OpenLivePollCommand`](#openlivepollcommand) share a byte-identical shape:
  `(LivePollIdentifierType PollId, SpeakerIdentifierType? CallerSpeakerId, bool CallerIsOrganizer)`.
  The last two fields are the token-bound authoring inputs (the pattern
  [`CastVoteCommand`](#castvotecommand) introduces): `CallerIsOrganizer` (`:14`) says whether the caller
  holds Organizer/Admin, and `CallerSpeakerId?` (`:13`) is the caller's `speaker_id` claim when present.
  The doc comment states the BR-236 rule those two feed (`CloseLivePollCommand.cs:4-6`): event-wide
  polls require an organizer/admin, session polls also allow the session's assigned speakers.
  `[Rubric §11, Security]`: authorization inputs are declared on the command and enforced centrally by
  [`LivePollAuthorization`](#livepollauthorization) inside the handler, not scattered per controller.
- **Walkthrough**: three positional members (`:12-14`); no methods.
- **Why it's built this way**: passing the caller's *facts* (role flag, speaker id) rather than the
  caller's *decision* keeps the authorization rule in one testable place (the handler), so open and
  close cannot drift apart.
- **Where it's used**: handled by [`CloseLivePollHandler`](#closelivepollhandler).

### GetEventPollsQuery
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetEventPolls` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetEventPolls/GetEventPollsQuery.cs:7` · Level 0 · record

- **What it is**: the read-side query for the organizer manage view: all of an event's polls regardless
  of status. A one-field `sealed record` over `EventId` (`GetEventPollsQuery.cs:7`).
- **Depends on**: nothing first-party; handled by [`GetEventPollsHandler`](#geteventpollshandler).
- **Concept**: `[Rubric §6, CQRS & Event-Driven]`: a query is side-effect-free and returns data, never
  a [`Result`](group-01-result-error-handling.md#result) of a mutation. Unlike the attendee-facing
  read queries in this group, this one carries no `UserId` because the manage view surfaces no per-user
  state (no "my vote").
- **Walkthrough**: a single positional `EventId` member (`:7`).
- **Why it's built this way**: the manage tab is organizer-only and wants every poll (Draft, Open,
  Closed), so the query is deliberately unfiltered by status; the authorization for it is applied at the
  controller edge rather than in the handler.
- **Where it's used**: handled by [`GetEventPollsHandler`](#geteventpollshandler), which maps to
  [`LivePollDTO`](#livepolldto).

### GetModerationQueueQuery
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetModerationQueue` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetModerationQueue/GetModerationQueueQuery.cs:11` · Level 0 · record

- **What it is**: the query for the moderation view of a session's Q&A, all statuses (BR-236). A
  `sealed record` over `SessionId` plus the caller-rights triple (`GetModerationQueueQuery.cs:11-14`).
- **Depends on**: nothing first-party; handled by
  [`GetModerationQueueHandler`](#getmoderationqueuehandler).
- **Concept**: this is the read-side twin of the caller-rights shape introduced by
  [`CloseLivePollCommand`](#closelivepollcommand): it carries `CallerSpeakerId?` (`:13`) and
  `CallerIsOrganizer` (`:14`) so the handler can enforce the same BR-236 rights on a **query**. That is
  the notable point, per [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) the CQRS pipeline runs no validating/authorization decorator on
  queries, so a read that needs authorization (the moderation queue exposes not-yet-approved questions)
  must carry its caller facts and check them inside the handler.
  `[Rubric §11, Security]` (an authorization-gated read).
- **Walkthrough**: three positional members (`:12-14`), `SessionId` first, then the caller-rights pair
  (`CallerSpeakerId?`, `CallerIsOrganizer`).
- **Why it's built this way**: moderation shows Pending questions that attendees must not see, so the
  read is gated exactly like the write commands, reusing [`LivePollAuthorization`](#livepollauthorization)
  against the Conference boundary rather than inventing a query-only rule.
- **Where it's used**: handled by [`GetModerationQueueHandler`](#getmoderationqueuehandler).

### GetOpenPollsQuery
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetOpenPolls` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetOpenPolls/GetOpenPollsQuery.cs:11` · Level 0 · record

- **What it is**: the attendee-facing query for open polls with tallies and the caller's own vote. A
  `sealed record` carrying two nullable scopes and a `UserId` (`GetOpenPollsQuery.cs:11-14`).
- **Depends on**: nothing first-party; handled by [`GetOpenPollsHandler`](#getopenpollshandler).
- **Concept introduced, the exactly-one-scope query.** The doc comment (`GetOpenPollsQuery.cs:4-6`)
  states the contract: **exactly one scope applies**, with `SessionId` set the session's open polls;
  otherwise the event-wide open polls of `EventId` (session-scoped polls excluded). Both are nullable
  (`EventId?` `:12`, `SessionId?` `:13`) so one message type serves the `Happening Now` (event) and
  session `Live` (session) surfaces. `UserId` (`:14`) is the token-bound caller, so each returned poll
  can surface that user's own vote. `[Rubric §9, API & Contract Design]`: one flexible read contract
  rather than two near-duplicate endpoints.
- **Walkthrough**: three positional members (`:12-14`); the "which scope wins" decision is enforced by
  [`GetOpenPollsHandler`](#getopenpollshandler), not the type.
- **Why it's built this way**: collapsing the two scopes into one nullable pair keeps the UI's polling
  loop calling a single handler; the handler rejects the "neither scope" case rather than the record.
- **Where it's used**: handled by [`GetOpenPollsHandler`](#getopenpollshandler), which returns
  [`LivePollResultsDTO`](#livepollresultsdto) tallies.

### GetPollResultsQuery
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetPollResults` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetPollResults/GetPollResultsQuery.cs:9` · Level 0 · record

- **What it is**: the query for one poll's tallies (any status), with the caller's own vote. A
  two-field `sealed record` over `PollId` and `UserId` (`GetPollResultsQuery.cs:9`).
- **Depends on**: nothing first-party; handled by [`GetPollResultsHandler`](#getpollresultshandler).
- **Concept**: this is the single-poll refresh read. The doc comment names its trigger
  (`GetPollResultsQuery.cs:4-5`): the UI calls it to re-fetch one card when a
  `poll.results-changed` channel event arrives. `[Rubric §12, Performance & Scalability]`: the live
  push carries a *signal* (something changed) and the client pulls the authoritative tally for just the
  affected poll, so a broadcast never has to fan out per-user vote state (see
  [`CastVoteHandler`](#castvotehandler)).
- **Walkthrough**: two positional members, `PollId` and the token-bound `UserId` (`:9`).
- **Why it's built this way**: refreshing one card by id (rather than re-listing every open poll) is
  the cheap reaction to a push signal.
- **Where it's used**: handled by [`GetPollResultsHandler`](#getpollresultshandler).

### OpenLivePollCommand
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Open` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Open/OpenLivePollCommand.cs:11` · Level 0 · record

- **What it is**: the command that opens a Draft poll for voting (BR-221/BR-223). A `sealed record`
  structurally identical to [`CloseLivePollCommand`](#closelivepollcommand): `PollId` plus the
  caller-rights triple (`OpenLivePollCommand.cs:11-14`).
- **Depends on**: nothing first-party; handled by [`OpenLivePollHandler`](#openlivepollhandler).
- **Concept**: same caller-rights triple as [`CloseLivePollCommand`](#closelivepollcommand) (see there
  for the BR-236 rule). The only thing that differs between open and close is the *handler's* behavior
  (open must additionally fetch and snapshot the event's live window), not the message shape.
- **Walkthrough**: three positional members (`:12-14`); no methods.
- **Why it's built this way**: keeping open and close as separate one-purpose commands (rather than a
  single "SetStatus" command) makes each transition's rights and side effects explicit and
  independently testable, the vertical-slice convention.
- **Where it's used**: handled by [`OpenLivePollHandler`](#openlivepollhandler).

### CastVoteCommandValidator
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteCommandValidator.cs:8` · Level 1 · class

- **What it is**: the FluentValidation validator that shape-checks a [`CastVoteCommand`](#castvotecommand)
  before the handler runs, a `sealed class : AbstractValidator<CastVoteCommand>`
  (`CastVoteCommandValidator.cs:8`).
- **Depends on**: `FluentValidation.AbstractValidator<T>` (NuGet, see
  [primer §3](../00-primer.md#3-the-external-stack-bcl--nuget--external-level-0)); the command it
  validates.
- **Concept introduced, structural validation in the pipeline.** `[Rubric §24, Forms, Validation & UX
  Safety]` (assesses validation before mutation, with actionable, coded errors). Per [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) the CQRS
  chain wraps a command handler with a `ValidatingCommandDecorator` that runs the registered validator
  **before the transaction opens**, so a malformed command never reaches the domain. Each rule pairs a
  human message with a stable **error code** (`WithErrorCode`), which the localization edge keys on:
  `PollId` (`:12-15`), `OptionId` (`:17-20`), and `UserId` (`:22-25`) must each be non-default, with
  codes `LivePollVote.PollId.Required`, `LivePollVote.OptionId.Required`, and
  `LivePollVote.UserId.Required`. This is *shape* validation only; the *business* rules (poll open,
  inside the live window, option belongs to the poll) live in the domain
  ([`LivePoll.CanAcceptVote`](#castvotehandler)), not here.
- **Walkthrough**: the constructor (`:10`) declares three `RuleFor(...).NotEqual(default(...))` chains,
  one per command field, each `.WithMessage(...).WithErrorCode(...)`.
- **Why it's built this way**: FluentValidation validators are auto-discovered by assembly scanning and
  run by the pipeline decorator, so cross-cutting "is the input well-formed" logic stays out of the
  handler (`[Rubric §5, Vertical Slice]` and `[Rubric §10, Cross-Cutting]`). Note the manage
  commands/queries in this group ship *no* validator: their guards are domain transitions and
  authorization, checked in the handler.
- **Where it's used**: resolved and run by the CQRS `ValidatingCommandDecorator` (G05) ahead of
  [`CastVoteHandler`](#castvotehandler).

### CloseLivePollHandler
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Close` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Close/CloseLivePollHandler.cs:17` · Level 8 · class

- **What it is**: the command handler for the Open -> Closed transition (BR-221). It authorizes the
  caller, drives the domain transition, saves, then broadcasts a `poll.closed` channel event
  best-effort (`CloseLivePollHandler.cs:17`).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (repository + save),
  [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice) (the
  Conference gRPC boundary), [`ILiveChannelPublisher`](group-10-notifications.md#ilivechannelpublisher)
  (the transient live-push extension point), [`LivePollAuthorization`](#livepollauthorization),
  [`LivePoll`](#livepoll), [`LivePollChannel`](#livepollchannel),
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult),
  and BCL `System.Text.Json` + `ILogger`.
- **Concept introduced, the live-layer handler shape (mutate-then-push).** `[Rubric §6, CQRS &
  Event-Driven]`, `[Rubric §7, Microservices Readiness]`, `[Rubric §13, Observability]`, and
  `[Rubric §29, Resilience & Business Continuity]`. Every write in this group follows the same
  five-step spine, and this is the smallest example of it:
  1. **Load** the aggregate tracked: `GetByIdAsync(command.PollId, includes: [], asTracking: true, …)`
     (`:29-33`); a missing poll returns `Error.NotFound` (`:35-39`).
  2. **Authorize**. A session-scoped poll first fetches the session's live info from Conference over
     gRPC (`GetSessionLiveInfoAsync`, `:43`), then calls
     [`LivePollAuthorization.EnsureCanManage`](#livepollauthorization) (`:47-48`) with that
     session's assigned-speaker list; an event-wide poll passes `sessionInfo: null` so only
     organizers/admins pass (`:54-55`). The cross-service call is the `[Rubric §7]` boundary: Engagement
     never reaches into Conference's tables, it asks a typed gRPC client ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)).
  3. **Transition** in the domain: `poll.Close()` (`:60`) enforces "only an Open poll can close" and
     raises the `LivePollChanged` domain event; a bad transition returns its
     [`Result`](group-01-result-error-handling.md#result) unchanged (`:61-62`).
  4. **Save**: `unitOfWork.SaveChangesAsync(...)` (`:64`) commits the state change and (via the outbox)
     the domain event, then the handler logs with a source-generated `LoggerMessage` (`:66,99-100`).
  5. **Push** best-effort: `PublishClosedAsync` (`:68,73`) builds the channel key
     (`LivePollChannel.ForSession(sessionId)` or `.ForEvent(poll.EventId)`, `:77-79`), serializes a
     `LivePollClosedPayload`, and calls
     [`ILiveChannelPublisher.PublishAsync`](group-10-notifications.md#ilivechannelpublisher) (`:85-89`).
- **The best-effort guarantee (BR-229).** The publish is wrapped in a `try`/`catch (Exception)` that
  logs and swallows (`:91-96`), with a scoped `#pragma warning disable CA1031` justifying the general
  catch inline. This is deliberate: the live push is a **transient convenience** (SignalR fan-out via
  the Notification hub, [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)), *not* the source of truth. If Notification is momentarily
  unreachable, the vote/close already committed and clients recover on their next poll; failing the
  command because a broadcast failed would be the wrong trade. That post-commit, never-failing push is
  the `[Rubric §29]` resilience choice.
- **Why it's built this way**: separating the durable state change (committed transactionally, with a
  domain event on the outbox) from the transient UI push (fire-and-forget over gRPC to the hub) keeps
  correctness independent of the real-time layer's availability ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html), [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html)'s two-channel model).
- **Where it's used**: dispatched by the Engagement REST controller for the presenter/organizer "close
  poll" action; a member of the poll-lifecycle family with [`OpenLivePollHandler`](#openlivepollhandler).

### GetEventPollsHandler
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetEventPolls` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetEventPolls/GetEventPollsHandler.cs:14` · Level 8 · class

- **What it is**: the read handler backing the organizer Manage tab: it returns every poll of an event
  (Draft, Open, Closed) with options, newest first (`GetEventPollsHandler.cs:14`).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`LivePollDTOMapper`](#livepolldtomapper),
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult),
  [`LivePoll`](#livepoll), [`LivePollDTO`](#livepolldto).
- **Concept**: `[Rubric §6, CQRS & Event-Driven]`, a query handler that returns a
  `Result<IReadOnlyList<LivePollDTO>>` and never mutates. `[Rubric §1, SOLID]`: the DTO projection is
  delegated to the injected Mapperly [`LivePollDTOMapper`](#livepolldtomapper) rather than hand-mapped
  inline, keeping the handler about *fetching*.
- **Walkthrough**: `HandleAsync` (`:19`) reads with `GetAllAsync([nameof(LivePoll.Options)], where:
  p => p.EventId == query.EventId, asTracking: false, …)` (`:24-28`), eager-loading the options and
  reading no-tracking (this is a read path). It then orders newest-first and maps:
  `[.. polls.OrderByDescending(p => p.Id).Select(dtoMapper.MapToDTO)]` (`:30`).
- **Why it's built this way**: `OrderByDescending(p => p.Id)` gives newest-first cheaply on the
  identity key. The doc comment is honest about scale (`:11-12`): there is **no paging** because the
  observed conference volume does not need it, a deliberate simplification, not an oversight.
- **Where it's used**: dispatched by the organizer-only Manage endpoint.

### OpenLivePollHandler
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Open` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Open/OpenLivePollHandler.cs:19` · Level 8 · class

- **What it is**: the command handler for the Draft -> Open transition. It authorizes the caller,
  fetches the event's live window from Conference and **snapshots it onto the poll**, saves, then
  broadcasts `poll.opened` best-effort (`OpenLivePollHandler.cs:19`).
- **Depends on**: the same set as [`CloseLivePollHandler`](#closelivepollhandler), plus a BCL
  `TimeProvider` for the current instant (`:23`).
- **Concept introduced, snapshotting a cross-service window to avoid per-vote chatter.**
  `[Rubric §12, Performance & Scalability]` and `[Rubric §7, Microservices Readiness]`. This handler
  follows the same five-step spine as [`CloseLivePollHandler`](#closelivepollhandler), with one added
  responsibility: before opening it resolves the live window. For a session poll it reuses the
  `SessionLiveInfo` it already fetched for authorization (`:52,58-59`); for an event-wide poll it makes
  a second gRPC call, `GetEventLiveInfoAsync(poll.EventId, …)` (`:68`), and reads the window off that
  (`:72-73`). It then calls `poll.Open(timeProvider.GetUtcNow().UtcDateTime, windowStartUtc,
  windowEndUtc)` (`:76`). Inside the domain, `LivePoll.Open` rejects a now-outside-window open and
  **stores the live-window end on the poll**, so that later every vote can be window-checked locally by
  [`CanAcceptVote`](#castvotehandler) with *no* further cross-service call. That is the performance
  point: one lookup at open time replaces one lookup per vote.
- **Walkthrough**: load tracked and NotFound-guard (`:32-42`); authorize via
  [`EnsureCanManage`](#livepollauthorization) on the session or event scope (`:53,63`); resolve the
  window (`:48-73`); `poll.Open(...)` (`:76`) with failure short-circuit (`:77-78`);
  `SaveChangesAsync` (`:80`); `LogLivePollOpened` (`:82`); `PublishOpenedAsync` (`:84,89-113`) which
  serializes a `LivePollOpenedPayload` (carrying the question so subscribers can render the new card)
  and publishes on the session-or-event channel, wrapped in the same swallow-and-log best-effort guard
  (`:107-112`).
- **Why it's built this way**: snapshotting the window end at Open is the [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) live-layer design, it
  keeps the hot vote path free of Conference round-trips and makes vote acceptance deterministic even if
  Conference is briefly unreachable.
- **Where it's used**: dispatched by the presenter/organizer "open poll" action; paired with
  [`CloseLivePollHandler`](#closelivepollhandler).

### CastVoteHandler
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteHandler.cs:19` · Level 9 · class

- **What it is**: the command handler that records (or changes) a vote on an open poll, returns the
  fresh tallies, and broadcasts `poll.results-changed` best-effort with per-user data stripped
  (`CastVoteHandler.cs:19`).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`LivePollResultsBuilder`](#livepollresultsbuilder),
  [`ILiveChannelPublisher`](group-10-notifications.md#ilivechannelpublisher), BCL `TimeProvider` +
  `ILogger` + `System.Text.Json`, [`LivePoll`](#livepoll), [`LivePollVote`](#livepollvote),
  [`LivePollChannel`](#livepollchannel), [`LivePollResultsDTO`](#livepollresultsdto).
- **Concept introduced, the one-active-vote soft-delete dance (BR-225/BR-135).** `[Rubric §8, Data
  Architecture]` (soft-delete + a filtered unique index, reconciled without duplicate rows). A user may
  vote, change their vote, retract it, then vote again; the invariant is **exactly one active vote per
  (poll, user)**, backed by a filtered unique index. The handler realizes that with a three-way branch
  (`:53-81`):
  - Load *all* rows for `(poll, user)` with `ignoreQueryFilters: true` (`:53-58`), so soft-deleted
    votes are visible, then split into `activeVote` and `deletedVote` (`:59-60`).
  - If an **active** vote exists, `activeVote.ChangeOption(command.OptionId)` (`:64`) updates the row
    in place.
  - Else if a **soft-deleted** vote exists, `deletedVote.Reactivate(command.OptionId)` (`:70`)
    un-deletes and re-points it (rather than inserting a duplicate that would collide with the index).
  - Else `LivePollVote.Create(...)` a fresh vote and `AddAsync` it (`:76-80`).
  This is the exact pattern the bookmark feature (BR-135) established, reused so a hot, re-votable poll
  never accumulates dead rows.
- **Concept reinforced, broadcast privacy (BR-229).** `[Rubric §11, Security]` and `[Rubric §12,
  Performance]`. The command returns the caller's full tally *including their own vote*; but the
  fan-out payload must not leak one user's choice to every subscriber. The handler serializes
  `results with { MyVoteOptionId = null }` (`:103-105`), a `record` `with`-expression that clones the
  DTO with the per-user field cleared, before publishing `poll.results-changed` (`:107-111`). Each
  client then refreshes its own card via [`GetPollResultsQuery`](#getpollresultsquery), which re-reads
  *its* vote.
- **Walkthrough**: load the poll with options no-tracking (`:32-36`); domain gate
  `poll.CanAcceptVote(now, command.OptionId)` (`:44`) enforcing open + inside the snapshotted window +
  option-belongs-to-poll; a failure short-circuits (`:45-46`); the three-way vote branch (`:53-81`);
  `SaveChangesAsync` (`:83`); `LogVoteCast` (`:85`); rebuild tallies via
  [`LivePollResultsBuilder.BuildAsync`](#livepollresultsbuilder) (`:87`); best-effort
  `PublishResultsChangedAsync` (`:89,94-119`) with the stripped payload.
- **Why it's built this way**: `ignoreQueryFilters` is load-bearing, without it the soft-deleted row is
  invisible and a re-vote would try to insert a second row and hit the unique index. Stripping
  `MyVoteOptionId` on broadcast keeps a shared push from carrying anyone's individual vote ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)).
- **Where it's used**: dispatched by the attendee "vote" endpoint; shape-checked first by
  [`CastVoteCommandValidator`](#castvotecommandvalidator).

### GetModerationQueueHandler
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetModerationQueue` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetModerationQueue/GetModerationQueueHandler.cs:19` · Level 9 · class

- **What it is**: the read handler for a session's Q&A moderation view, all statuses (Pending first),
  gated to organizers/admins and the session's assigned speakers (`GetModerationQueueHandler.cs:19`).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice),
  [`SessionQuestionViewBuilder`](#sessionquestionviewbuilder),
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult),
  [`SessionQuestion`](#sessionquestion), [`SessionQuestionDTO`](#sessionquestiondto),
  [`LivePollAuthorization`](#livepollauthorization).
- **Concept, an authorization-gated query.** `[Rubric §11, Security]`. Because [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) wraps queries
  with no validating/authorization decorator, this handler enforces BR-236 itself: it fetches the
  session's live info from Conference (`GetSessionLiveInfoAsync`, `:29`), runs
  [`LivePollAuthorization.EnsureCanManage`](#livepollauthorization) with the query's caller facts
  (`:33-34`), and short-circuits to a `Result.Failure` on either the boundary failure or a rights failure
  (`:30-36`). The moderation queue deliberately exposes not-yet-approved questions, which is exactly why
  it is gated.
- **Walkthrough**: authorize (`:29-36`); load the session's questions no-tracking (`:39-43`); project
  via [`SessionQuestionViewBuilder.BuildAsync(questions, callerUserId: null, …)`](#sessionquestionviewbuilder)
  (`:45`), passing `null` for the caller because the per-user `MyUpvote`/`IsMine` flags are not
  meaningful in a moderation view (stated `:15-17`); finally order Pending -> Approved -> Dismissed by
  the [`QuestionStatus`](#questionstatus) enum value, then by id: `[.. dtos.OrderBy(d => d.Status)
  .ThenBy(d => d.Id)]` (`:47-48`).
- **Why it's built this way**: reusing the same [`LivePollAuthorization`](#livepollauthorization) rule
  and the same [`SessionQuestionViewBuilder`](#sessionquestionviewbuilder) as the attendee list keeps
  moderation from drifting from the public read; passing a null caller is how one builder serves both
  the personalized and the impersonal view (`[Rubric §1, SOLID]`).
- **Where it's used**: dispatched by the presenter/organizer moderation endpoint.

### GetOpenPollsHandler
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetOpenPolls` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetOpenPolls/GetOpenPollsHandler.cs:15` · Level 9 · class

- **What it is**: the read handler returning the open polls for a scope with live tallies and the
  caller's own vote (`GetOpenPollsHandler.cs:15`).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`LivePollResultsBuilder`](#livepollresultsbuilder),
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult),
  [`LivePoll`](#livepoll), [`LivePollStatus`](#livepollstatus),
  [`LivePollResultsDTO`](#livepollresultsdto).
- **Concept, in-handler scope validation.** `[Rubric §24, Forms, Validation & UX Safety]`. Since a
  query has no validating decorator, this handler opens by rejecting the "neither scope" case itself:
  if both `SessionId` and `EventId` are null it returns
  `Error.Validation("LivePoll.Scope.Required", …)` (`:24-30`). It then picks the query shape by scope:
  session scope filters `p.SessionId == sessionId && p.Status == Open` (`:34-38`); event scope filters
  `p.EventId == query.EventId && p.SessionId == null && p.Status == Open` (`:39-43`), the
  `SessionId == null` clause is what BR-230's "session-scoped polls excluded from the event feed"
  means in code.
- **Walkthrough**: scope guard (`:24-30`); scope-selected `GetAllAsync` eager-loading `Options`
  no-tracking (`:33-43`); then, ordered by id, build each poll's tally with the caller's vote via
  [`LivePollResultsBuilder.BuildAsync(poll, query.UserId, …)`](#livepollresultsbuilder) in a loop
  (`:45-49`).
- **Why it's built this way**: reusing [`LivePollResultsBuilder`](#livepollresultsbuilder) means the
  `Happening Now`, session `Live`, and post-vote surfaces all compute tallies identically.
- **Caveats / not-in-source**: the per-poll build runs sequentially in a `foreach`, so each poll issues
  its own tally query; at the observed conference scale that is acceptable, but it is an N+1 the code
  accepts rather than a batched read.
- **Where it's used**: dispatched by the attendee `Happening Now` / session `Live` poll list.

### GetPollResultsHandler
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetPollResults` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetPollResults/GetPollResultsHandler.cs:13` · Level 9 · class

- **What it is**: the read handler returning one poll's live tallies (any status) with the caller's own
  vote (`GetPollResultsHandler.cs:13`).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`LivePollResultsBuilder`](#livepollresultsbuilder),
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult),
  [`LivePoll`](#livepoll), [`LivePollResultsDTO`](#livepollresultsdto).
- **Concept**: this is the single-poll refresh that a client runs when a `poll.results-changed` push
  arrives (see [`GetPollResultsQuery`](#getpollresultsquery)). `[Rubric §12, Performance]`: it re-reads
  exactly one card rather than the whole open-poll list.
- **Walkthrough**: load the poll with `Options` no-tracking (`:23-27`); NotFound-guard (`:29-33`); then
  delegate the tally to
  [`LivePollResultsBuilder.BuildAsync(poll, query.UserId, …)`](#livepollresultsbuilder) (`:35`) and
  return it. It applies no status filter, results stay readable for a Closed poll, which is why the UI
  can still show the final tally after a poll closes.
- **Why it's built this way**: the compact "load one, build tally, return" shape is the read half of
  the same [`LivePollResultsBuilder`](#livepollresultsbuilder) that [`CastVoteHandler`](#castvotehandler)
  writes through, so a pushed change and a pulled refresh always agree.
- **Where it's used**: dispatched by the attendee poll card on receiving a `poll.results-changed`
  channel event.

### GetSessionQuestionsQuery

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetSessionQuestions` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetSessionQuestions/GetSessionQuestionsQuery.cs:9` · Level 0 · record

- **What it is**: the read message for the attendee view of a session's Q&A: it asks for one session's questions from the calling user's perspective. It is a `sealed record` with two positional members (`GetSessionQuestionsQuery.cs:9`).
- **Depends on**: the identifier aliases `SessionIdentifierType` and `UserIdentifierType` (`GetSessionQuestionsQuery.cs:10-11`), the per-module `global using` aliases described in the [primer](../00-primer.md#2-architectural-styles-this-codebase-commits-to). No first-party class dependencies: a query record carries data only. It is consumed through the CQRS read side ([IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)) by [GetSessionQuestionsHandler](#getsessionquestionshandler).
- **Concept introduced**: this is the first Q&A **query message** in the chapter, so it is worth naming the split. In this codebase a read is expressed as an immutable message record implementing nothing itself; the read logic lives in a matching `IQueryHandler` (see [group-05](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)). The interesting design fact is the second member, `UserId`: the same session yields a different result set per caller, because the handler returns every Approved question plus only *the caller's own* Pending/Dismissed ones (BR-238, documented in the summary at `GetSessionQuestionsQuery.cs:4-5`). Carrying the caller identity in the query itself, rather than reaching for ambient context inside the handler, keeps the read pure and testable. `[Rubric §6, CQRS & Event-Driven]` assesses whether reads and writes are cleanly separated; this record is a read message with no mutation surface. `[Rubric §11, Security]` assesses whether identity is handled trustworthily; `UserId` is bound from the caller's token at the API edge, so a user cannot request another user's private submissions by changing a body field.
- **Walkthrough**: `SessionId` (`GetSessionQuestionsQuery.cs:10`) selects the session; `UserId` (`GetSessionQuestionsQuery.cs:11`) scopes the personal, non-approved rows. Positional record members are `init`-only, so the query is immutable once constructed.
- **Why it's built this way**: a per-caller read cannot be output-cached like the public Conference reads, so it is modeled as a plain query the handler answers live; the two-field shape is the minimum needed to express "this session, as seen by this user."
- **Where it's used**: dispatched through the query side of the CQRS pipeline to [GetSessionQuestionsHandler](#getsessionquestionshandler); ultimately behind the session `Live` Q&A UI of the Engagement live layer.

### SubmitQuestionCommand

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionCommand.cs:11` · Level 0 · record

- **What it is**: the write message for asking a question in a live session (BR-231/BR-233). A `sealed record` with three positional members (`SubmitQuestionCommand.cs:11`).
- **Depends on**: the aliases `SessionIdentifierType` and `UserIdentifierType`, plus a `string Text` payload (`SubmitQuestionCommand.cs:12-14`). Consumed by [SubmitQuestionCommandValidator](#submitquestioncommandvalidator) and [SubmitQuestionHandler](#submitquestionhandler).
- **Concept introduced**: the first Q&A **command message**. The teaching point is the trust boundary called out in the XML summary (`SubmitQuestionCommand.cs:4-6`): `UserId` is bound from the caller's token at the API edge, **never** from the request body. The API controller builds the command with the authenticated principal's id, so the client cannot impersonate another author. `[Rubric §11, Security]` assesses trust boundaries around identity; the command deliberately keeps the author id out of the client-controlled surface. `[Rubric §6, CQRS & Event-Driven]` assesses read/write separation; this is a mutation message that flows through the validating and transactional decorators (see [group-05](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)) that queries skip.
- **Walkthrough**: `SessionId` (`SubmitQuestionCommand.cs:12`) is the target session; `Text` (`SubmitQuestionCommand.cs:13`) is the 1-500-character question body (BR-231, enforced by the validator, not the record); `UserId` (`SubmitQuestionCommand.cs:14`) is the token-bound author.
- **Why it's built this way**: length and presence rules live in a FluentValidation validator rather than in the record so that the message stays a plain data carrier and the rules run in the pipeline's validating stage before a transaction opens.
- **Where it's used**: validated by [SubmitQuestionCommandValidator](#submitquestioncommandvalidator), handled by [SubmitQuestionHandler](#submitquestionhandler).

### ToggleUpvoteCommand

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteCommand.cs:11` · Level 0 · record

- **What it is**: the write message that sets or clears the caller's upvote on a session question (BR-235/BR-237). A `sealed record` with three positional members (`ToggleUpvoteCommand.cs:11`).
- **Depends on**: `SessionQuestionIdentifierType` (the question being voted on) and `UserIdentifierType`, plus a `bool Upvote` intent flag (`ToggleUpvoteCommand.cs:12-14`). Consumed by [ToggleUpvoteCommandValidator](#toggleupvotecommandvalidator) and [ToggleUpvoteHandler](#toggleupvotehandler).
- **Concept introduced**: the **explicit-desired-state toggle**. Rather than two separate "add upvote" / "remove upvote" commands, one command carries a `bool Upvote` that names the state the caller wants to be in. The XML summary makes the idempotency contract explicit (`ToggleUpvoteCommand.cs:6`): "Toggling to a state the caller is already in is a no-op success." That shape lets a flaky mobile client retry safely, the second identical tap changes nothing and still returns success. As with the other messages, `UserId` is token-bound, never from the body (`ToggleUpvoteCommand.cs:4-6`). `[Rubric §9, API & Contract Design]` assesses whether contracts are safe to call twice; the desired-state design makes the operation naturally idempotent. `[Rubric §11, Security]` again: the voter identity is not client-supplied.
- **Walkthrough**: `QuestionId` (`ToggleUpvoteCommand.cs:12`) targets the question; `UserId` (`ToggleUpvoteCommand.cs:13`) is the token-bound voter; `Upvote` (`ToggleUpvoteCommand.cs:14`) is `true` to upvote, `false` to remove.
- **Why it's built this way**: a single toggle command keeps the API surface and the client state machine small, and moves the "already in that state" branch into the handler where the [SessionQuestionUpvote](#sessionquestionupvote) soft-delete/reactivate dance lives.
- **Where it's used**: validated by [ToggleUpvoteCommandValidator](#toggleupvotecommandvalidator), handled by [ToggleUpvoteHandler](#toggleupvotehandler).

### ToggleUpvoteCommandValidator

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteCommandValidator.cs:8` · Level 1 · class

- **What it is**: the FluentValidation rule set for [ToggleUpvoteCommand](#toggleupvotecommand), run before the handler by the validating decorator. A `sealed class` extending `AbstractValidator<ToggleUpvoteCommand>` (`ToggleUpvoteCommandValidator.cs:8`).
- **Depends on**: FluentValidation's `AbstractValidator<T>` (NuGet, `ToggleUpvoteCommandValidator.cs:1`) and the identifier aliases used in the rules. It is auto-registered by Scrutor assembly scanning and invoked by the `Validating` stage of the command pipeline (see [group-05](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)).
- **Concept introduced**: this is the first validator in the chapter, so note the two-part convention: every rule attaches both a human `WithMessage` and a machine `WithErrorCode`. The codes here are namespaced (`SessionQuestionUpvote.QuestionId.Required`, `SessionQuestionUpvote.UserId.Required`, `ToggleUpvoteCommandValidator.cs:15,20`) so a client or test can assert on a stable string rather than on prose. `[Rubric §24, Forms/Validation/UX Safety]` assesses whether input is rejected structurally and legibly; the paired message/code does both. `[Rubric §6, CQRS & Event-Driven]` assesses pipeline discipline; validation is a decorator concern here, not hand-rolled inside the handler.
- **Walkthrough**: the constructor declares two rules (`ToggleUpvoteCommandValidator.cs:10-21`): `QuestionId` must not equal `default(SessionQuestionIdentifierType)` (`:12-15`) and `UserId` must not equal `default(UserIdentifierType)` (`:17-20`). Both are structural "is it present" guards; the *behavioral* rules (author cannot upvote their own question, window must be open) deliberately live in the handler and the aggregate, not here, because they need loaded state.
- **Why it's built this way**: cheap, stateless guards run first so a malformed command is rejected before a transaction or any repository work; anything requiring the persisted question is left to [ToggleUpvoteHandler](#toggleupvotehandler).
- **Where it's used**: resolved and executed by the validating command decorator for [ToggleUpvoteCommand](#toggleupvotecommand).

### SubmitQuestionCommandValidator

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionCommandValidator.cs:9` · Level 5 · class

- **What it is**: the FluentValidation rule set for [SubmitQuestionCommand](#submitquestioncommand) (BR-231). A `sealed class` extending `AbstractValidator<SubmitQuestionCommand>` (`SubmitQuestionCommandValidator.cs:9`).
- **Depends on**: FluentValidation's `AbstractValidator<T>` (NuGet, `SubmitQuestionCommandValidator.cs:1`) and, notably, the domain invariants helper [SessionQuestionInvariants](#sessionquestioninvariants) from `MMCA.ADC.Engagement.Domain.SessionQuestions` (`SubmitQuestionCommandValidator.cs:2`).
- **Concept introduced**: this validator shows the **single-source-of-truth for a limit**. The text length rule does not hardcode 500; it reads `SessionQuestionInvariants.TextMaxLength` for both the `MaximumLength(...)` call and the interpolated error message (`SubmitQuestionCommandValidator.cs:22-23`). The application-layer validator and the domain-layer factory therefore enforce the *same* bound from one constant, so they cannot drift. `[Rubric §4, DDD]` assesses whether business rules live in the domain; the length constant is owned by the domain and merely referenced here. `[Rubric §24, Forms/Validation/UX Safety]` assesses input rejection; presence and length are caught before the handler runs.
- **Walkthrough**: three rules (`SubmitQuestionCommandValidator.cs:13-29`): `SessionId` not `default` (`:13-16`); `Text` `NotEmpty` then `MaximumLength(SessionQuestionInvariants.TextMaxLength)` with the two codes `SessionQuestion.Text.Required` / `SessionQuestion.Text.Invalid` (`:18-24`); `UserId` not `default` (`:26-29`). The "1-N characters" message is built from the same constant (`:23`).
- **Why it's built this way**: pulling the max length from the domain invariant keeps the validator honest even if the business limit changes; the presence checks fail fast before the cross-service session lookup in the handler.
- **Where it's used**: executed by the validating command decorator ahead of [SubmitQuestionHandler](#submitquestionhandler).

### ToggleUpvoteHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteHandler.cs:19` · Level 8 · class

- **What it is**: the command handler that applies an upvote toggle, enforces the Q&A upvote rules, and broadcasts the fresh count. A `sealed partial class` implementing [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) as `ICommandHandler<ToggleUpvoteCommand, Result<int>>` (`ToggleUpvoteHandler.cs:19-23`); it returns the new active-upvote count.
- **Depends on**: injected via primary constructor (`ToggleUpvoteHandler.cs:19-23`): [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) for repositories, [ILiveChannelPublisher](group-10-notifications.md#ilivechannelpublisher) for the live broadcast, `TimeProvider` (BCL) for a testable clock, and `ILogger<ToggleUpvoteHandler>`. It loads [SessionQuestion](#sessionquestion) and [SessionQuestionUpvote](#sessionquestionupvote) aggregates and serializes a [SessionQuestionUpvoteChangedPayload](#sessionquestionupvotechangedpayload) onto the channel keyed by [LivePollChannel](#livepollchannel) under the [SessionQuestionChannel](#sessionquestionchannel) `QuestionUpvoteChanged` event name.
- **Concept introduced**: the **soft-delete/reactivate toggle backed by a filtered unique index** (the "BR-135 dance," documented at `ToggleUpvoteHandler.cs:13-17`). One user may hold at most one *active* upvote per question. Un-upvoting soft-deletes the row rather than hard-deleting it; a later re-upvote **reactivates** the same soft-deleted row instead of inserting a duplicate. That is why the handler queries with `ignoreQueryFilters: true` (`:62`) to see soft-deleted rows the global filter would normally hide, then separates the active from the deleted candidate (`:64-65`). `[Rubric §8, Data Architecture]` assesses soft-delete discipline and uniqueness; the reactivate path plus the filtered unique index keep at most one live vote without churning primary keys. `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §7, Microservices Readiness]`: the state change is a command, and the notification to other attendees rides a cross-service channel, not an in-process call.
- **Walkthrough**: load the question untracked by id (`:30-35`); `Error.NotFound` if missing (`:37-41`). Enforce BR-235 "authors cannot upvote their own question" by comparing `question.UserId` to the caller (`:44-51`). Load all upvote rows for `(question, user)` with tracking and filters ignored (`:58-63`), split into `activeUpvote` / `deletedUpvote` (`:64-65`). Branch on intent (`:67-69`): `ApplyUpvoteAsync` for `Upvote == true`, `RemoveUpvote` for `false`. `ApplyUpvoteAsync` (`:95-127`) is a no-op-success when already active (`:103-106`), else calls the aggregate's `question.CanAcceptUpvote(...)` with the current UTC time to enforce BR-237's snapshotted live window (`:108-110`), then either `Reactivate()`s the soft-deleted row (`:112-118`) or `SessionQuestionUpvote.Create(...)`s a new one (`:120-124`). `RemoveUpvote` (`:133-144`) soft-deletes the active row or no-ops. Only when something changed does it `SaveChangesAsync` and log (`:74-79`). It then recomputes the count with `CountAsync` (`:81-83`), publishes (`:85`), and returns `Result.Success(upvoteCount)` (`:87`). `PublishUpvoteChangedAsync` (`:146-167`) serializes the count-only payload with `JsonSerializerOptions.Web` (`:151-153`) and wraps the publish in a `try/catch (Exception)` that only logs (`:161-166`), the broadcast is best-effort and must never fail the command (BR-238). The two `[LoggerMessage]` source-generated methods (`:169-173`) are why the class is `partial`.
- **Why it's built this way**: the count-only payload (`:150-153`) intentionally never carries who voted, matching BR-238's privacy stance. Best-effort publish (the `#pragma warning disable CA1031` suppression at `:161`) decouples the durable state change from the ephemeral live fan-out, so a Notification hiccup cannot roll back a legitimate vote. `TimeProvider` injection makes the live-window check deterministic under test.
- **Where it's used**: dispatched by the Engagement REST API when an attendee taps upvote; the returned `int` count updates the caller's UI immediately while the channel event updates everyone else's.
- **Caveats / not-in-source**: the filtered unique index and the exact BR-135 semantics of `Reactivate()` live in [SessionQuestionUpvote](#sessionquestionupvote) and the EF configuration, not in this handler.

### GetSessionQuestionsHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetSessionQuestions` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetSessionQuestions/GetSessionQuestionsHandler.cs:15` · Level 9 · class

- **What it is**: the query handler that returns the attendee view of a session's questions, ordered and scoped per caller. A `sealed class` implementing [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) as `IQueryHandler<GetSessionQuestionsQuery, Result<IReadOnlyList<SessionQuestionDTO>>>` (`GetSessionQuestionsHandler.cs:15-17`).
- **Depends on**: injected (`GetSessionQuestionsHandler.cs:15-17`): [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) and [SessionQuestionViewBuilder](#sessionquestionviewbuilder), the helper that turns raw [SessionQuestion](#sessionquestion) entities into [SessionQuestionDTO](#sessionquestiondto) rows with upvote counts and the caller's flags. Reads use [QuestionStatus](#questionstatus).
- **Concept introduced**: **caller-scoped read filtering at the database, ordering in memory.** The `where` predicate (`GetSessionQuestionsHandler.cs:27`) returns rows where `Status == QuestionStatus.Approved` OR `UserId == query.UserId`, so a user sees all approved questions plus their own of any status, and never other users' pending/dismissed ones (BR-238). The projection to DTOs is delegated to the view builder (`:31`), then the final list is composed with a collection expression (`:34-43`): approved questions first, most upvoted on top, ties broken by id, followed by the caller's own non-approved submissions ordered by id. `[Rubric §6, CQRS]` assesses read-side design; this is a pure query composing a filter, a builder, and a sort with no mutation. `[Rubric §11, Security]` assesses data-scoping; private submissions are filtered by the token-derived `UserId`, not by trust in the client.
- **Walkthrough**: grab the repository (`:24`), fetch untracked with the caller-scoped predicate (`:25-29`), build DTOs via `viewBuilder.BuildAsync(...)` passing the caller id so per-caller flags resolve (`:31`), then produce `IReadOnlyList<SessionQuestionDTO> ordered` via two spreads: approved by `OrderByDescending(UpvoteCount).ThenBy(Id)` (`:36-39`) and non-approved by `OrderBy(Id)` (`:40-42`). Returns `Result.Success(ordered)` (`:45`).
- **Why it's built this way**: the two-segment ordering matches the UI: the moderated, ranked public list on top and the author's own in-flight questions underneath, so authors can track submissions (BR-238) without leaking them to others. Untracked reads (`asTracking: false`, `:28`) keep the query cheap.
- **Where it's used**: behind the session `Live` Q&A panel; dispatched through the query side of the CQRS pipeline for [GetSessionQuestionsQuery](#getsessionquestionsquery).

### SubmitQuestionHandler

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit` · `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:23` · Level 9 · class

- **What it is**: the command handler that creates a question against a live session, honoring the event's moderation default, then broadcasts best-effort. A `sealed partial class` implementing [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) as `ICommandHandler<SubmitQuestionCommand, Result<SessionQuestionDTO>>` (`SubmitQuestionHandler.cs:23-29`).
- **Depends on**: injected (`SubmitQuestionHandler.cs:23-29`): [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork); [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice), the Conference cross-service gRPC lookup that returns the session's live-window and moderation metadata; [SessionQuestionViewBuilder](#sessionquestionviewbuilder); [ILiveChannelPublisher](group-10-notifications.md#ilivechannelpublisher); `TimeProvider` (BCL); and `ILogger<SubmitQuestionHandler>`. It creates [SessionQuestion](#sessionquestion) aggregates, reads [QuestionModerationDefault](group-17-conference-domain.md#questionmoderationdefault) and [QuestionStatus](#questionstatus), and serializes either a [SessionQuestionApprovedPayload](#sessionquestionapprovedpayload) or a [SessionQuestionPendingCountChangedPayload](#sessionquestionpendingcountchangedpayload).
- **Concept introduced**: the **cross-service validation boundary in front of a write.** Engagement does not own session or event data; it calls Conference's `IEventLiveValidationService.GetSessionLiveInfoAsync(...)` over gRPC (`SubmitQuestionHandler.cs:36`) to learn whether the event is published, its live window, and its `QuestionModerationDefault`. That single call also enforces the Conference-owned session eligibility rules (BR-49/BR-91, noted at `:15-16`). `[Rubric §7, Microservices Readiness]` assesses whether modules honor ownership across process boundaries; the handler treats Conference facts as a remote query rather than reaching into another module's tables (see [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) gRPC extraction). `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §13, Observability]`: a mutation plus source-generated logging and a decoupled live broadcast.
- **Walkthrough**: call the validation service and short-circuit on failure (`:36-38`), unwrap `sessionInfo` (`:40`). Reject when the event is not published (`Error.Invariant "SessionQuestion.EventNotPublished"`, `:42-49`). Snapshot `nowUtc` from `timeProvider` (`:51`) and reject when outside `[LiveWindowStartUtc, LiveWindowEndUtc)` (`Error.Invariant "SessionQuestion.OutsideLiveWindow"`, `:52-59`). Compute the initial status from the event's moderation default (`:62-64`): `Approved` when `QuestionModerationDefault.Approved`, else `Pending` (BR-233). Create the aggregate via `SessionQuestion.Create(...)` passing the session, `sessionInfo.EventId`, author, text, initial status, and the snapshotted `LiveWindowEndUtc` (`:66-72`), snapshotting the window end is BR-237. Persist through the repository and `SaveChangesAsync` (`:77-80`), log (`:82`), publish (`:84`), then build and return the DTO (`:86-88`). `PublishSubmittedAsync` (`:91-135`) branches on status: an auto-approved question broadcasts its **content** via [SessionQuestionApprovedPayload](#sessionquestionapprovedpayload) on the `QuestionApproved` event (`:97-109`); a pending question broadcasts a **count-only** [SessionQuestionPendingCountChangedPayload](#sessionquestionpendingcountchangedpayload) on `QuestionPendingCountChanged` (`:110-127`), pending content never rides the channel (BR-238). The whole publish is wrapped in the same best-effort `try/catch (Exception)` with `CA1031` suppressed (`:129-133`). Two `[LoggerMessage]` methods (`:137-141`) make the class `partial`.
- **Why it's built this way**: reading the moderation default from Conference at submit time means the "auto-approve vs moderate" policy is owned by the event, not duplicated in Engagement. Snapshotting the live-window end onto the question (`:72`) lets later upvote checks (see [ToggleUpvoteHandler](#toggleupvotehandler)) enforce BR-237 without another cross-service round trip. The content-vs-count publish split enforces the privacy rule that unmoderated text is never fanned out.
- **Where it's used**: dispatched by the Engagement REST API when an attendee submits a question; the returned [SessionQuestionDTO](#sessionquestiondto) renders the author's optimistic row.
- **Caveats / not-in-source**: the exact eligibility rules behind `GetSessionLiveInfoAsync` (BR-49/BR-91) live in the Conference service and its gRPC adapter, not in this handler.

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
- **Where it's used**: the poll command handlers resolve a key with `ForEvent`/`ForSession` and publish under these event names; the Blazor live surfaces join the same key and switch on the same names to decide patch-in-place versus reload.

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
- **Concept introduced, the nullable cross-module UI service.** `[Rubric §7, Microservices Readiness]` (assesses whether one module can render a link into another without a hard reference) and `[Rubric §18, UI Architecture]` (assesses feature-flagged composition of module UIs). The pattern is stated in the doc comment (`ISessionLiveUIService.cs:3-9`): the Conference UI injects this interface as **nullable**. When the Engagement module is enabled its UI registers an implementation and the session-detail page's Live button lights up; when Engagement is disabled the inject resolves to `null` and the button simply does not render. Neither module references the other's UI project, the contract lives here in `Shared`, so the two can be deployed together or apart. The doc comment names the [`ISessionBookmarkUIService`](group-22-engagement-module.md#isessionbookmarkuiservice) precedent, the same nullable-inject idiom Engagement already uses for the bookmark button. `[Rubric §1, SOLID]`: the interface is a single-method boundary, so a consumer depends only on "give me the Live path," not on how routing works.
- **Walkthrough**: one method, `string GetSessionLivePath(SessionIdentifierType sessionId)` (`ISessionLiveUIService.cs:14`), which builds the route path of the session's Live page from a session id. It returns a plain route string, so the Conference page can render an anchor without knowing Engagement's route table.
- **Why it's built this way**: routing a link into another module's page through a nullable service (rather than a shared route constant) keeps the modular monolith honest, the button and its target live entirely inside Engagement, and Conference stays ignorant of whether the live layer is present.
- **Where it's used**: injected (nullable) by the Conference session-detail page; the implementation lives in the Engagement UI project.

### ModerationAction
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/ModerationAction.cs:7` · Level 0 · enum

- **What it is**: the moderation action a moderator applies to a session question (BR-234): approve, dismiss, or mark answered. Each value maps to exactly one domain transition on [`SessionQuestion`](#sessionquestion).
- **Depends on**: nothing first-party.
- **Concept, the action enum as an intent contract.** `[Rubric §9, API & Contract Design]` (assesses a small, closed vocabulary crossing the wire) and `[Rubric §4, DDD]` (assesses naming that mirrors the business). This enum is the request-side counterpart to [`QuestionStatus`](#questionstatus): where `QuestionStatus` names *where the question is*, `ModerationAction` names *what the moderator asks for*. The mapping from action to transition is enforced on the [`SessionQuestion`](#sessionquestion) aggregate, not here; the enum only carries the intent.
- **Walkthrough**: three explicitly numbered members. `Approve = 0` (`ModerationAction.cs:10`), valid from Pending or Dismissed; `Dismiss = 1` (`ModerationAction.cs:13`), valid from Pending or Approved; `MarkAnswered = 2` (`ModerationAction.cs:16`), which marks an approved question answered once. The member docs pin the allowed source states for each.
- **Why it's built this way**: explicit numeric values keep the enum stable across JSON serialization (reordering members will not silently change wire meaning), and a single action enum lets one moderation endpoint accept every moderator move rather than one endpoint per transition.
- **Where it's used**: bound on the moderation request and dispatched into the moderation command handler, which calls the matching transition method on [`SessionQuestion`](#sessionquestion).

### OptionState
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.HappeningNow` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/HappeningNow/HappeningNow.razor.cs:383` · Level 0 · class

- **What it is**: a tiny private, mutable holder for one poll-option's text, used purely as a two-way binding target while an organizer types the options of a new poll on the [`HappeningNow`](#happeningnow) page.
- **Depends on**: BCL only (a nullable `string`); no first-party types.
- **Concept, the mutable view-model row for two-way binding.** `[Rubric §19, State Management]` (assesses how transient form state is held in a component) and `[Rubric §24, Forms/Validation/UX Safety]` (assesses editable-collection form modeling). Blazor's `@bind` needs a stable reference-typed target it can write back into; a `List<string>` cannot be bound element-by-element the same way, because reassigning a list slot does not give each text field its own backing object. `OptionState` gives each option row its own object, so adding, removing, and editing rows in `_newOptions` (`HappeningNow.razor.cs:50`) is stable across re-renders. It is deliberately `private sealed` and nested inside the page, it is not a domain concept, only a UI scratch buffer.
- **Walkthrough**: a single member, `public string? Text { get; set; }` (`HappeningNow.razor.cs:385`), a mutable auto-property. The class is `private sealed` (`HappeningNow.razor.cs:383`), so nothing outside the page can see or reuse it.
- **Why it's built this way**: modeling the option rows as objects (not raw strings) is what lets `AddOption`/`RemoveOption` (`HappeningNow.razor.cs:251,259`) grow and shrink the editable list while each `MudTextField` keeps binding to its own row; on submit the page projects `_newOptions` back to a trimmed, non-empty `List<string>` (`HappeningNow.razor.cs:275-279`) for the [`CreateLivePollRequest`](#createlivepollrequest).
- **Where it's used**: only inside [`HappeningNow`](#happeningnow), as the element type of the `_newOptions` list backing the create-poll form.

### QuestionStatus
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/QuestionStatus.cs:8` · Level 0 · enum

- **What it is**: the moderation status of a [`SessionQuestion`](#sessionquestion): `Pending`, `Approved`, or `Dismissed`. It is the small state vocabulary the whole Q&A feature is built around.
- **Depends on**: nothing first-party.
- **Concept, the moderation state machine as ubiquitous language.** `[Rubric §4, DDD]` (assesses a model that names its states) and `[Rubric §11, Security]` (assesses visibility rules encoded in the model). The doc comments pin both the starting state and the visibility rule per state: a new question starts at the event's moderation default, Pending or Approved (BR-233); a Pending question is visible only to its author and moderators (`QuestionStatus.cs:10`); an Approved one is visible to all attendees and open to upvotes (`QuestionStatus.cs:13`); a Dismissed one is hidden from attendees, and a re-approve brings it back (`QuestionStatus.cs:16`, BR-234). The enum is only the vocabulary, the legal transitions are guarded on the [`SessionQuestion`](#sessionquestion) aggregate and requested via [`ModerationAction`](#moderationaction).
- **Walkthrough**: three explicitly numbered members, `Pending = 0` (`QuestionStatus.cs:11`), `Approved = 1` (`QuestionStatus.cs:14`), `Dismissed = 2` (`QuestionStatus.cs:17`). `Pending = 0` makes the default value the safe, non-public state.
- **Why it's built this way**: explicit values keep the enum stable across the wire (it rides on [`SessionQuestionDTO`](#sessionquestiondto)), and pinning visibility to the status in one place means every reader (query filter, DTO, UI) agrees on who may see a question.
- **Where it's used**: the `Status` field of [`SessionQuestionDTO`](#sessionquestiondto); set and guarded by the [`SessionQuestion`](#sessionquestion) aggregate; read by the moderation and read paths.

### SessionQuestionAnsweredPayload
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionAnsweredPayload.cs:8` · Level 0 · record

- **What it is**: the broadcast payload for the [`SessionQuestionChannel`](#sessionquestionchannel) `QuestionAnswered` channel event, a minimal record naming the question that was marked answered and the session it belongs to.
- **Depends on**: the `SessionQuestionIdentifierType` and `SessionIdentifierType` aliases (both `= int`, `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/MMCA.ADC.Engagement.GlobalUsings.IdentifierType.cs:7`); no first-party types.
- **Concept, the ephemeral broadcast payload as a reload hint.** `[Rubric §6, CQRS & Event-Driven]` (assesses events that carry just enough to act on). Marking-answered is a structural change, so the payload holds no question body, only the two ids a subscriber needs to locate and refresh the affected question card. This is the same "channel event as a cache-invalidation hint over fetchable state" rule the poll payloads follow (see [`LivePollClosedPayload`](#livepollclosedpayload) and [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)): the push is a nudge, the fresh state comes from the next fetch.
- **Walkthrough**: a positional `sealed record` with two members, `SessionQuestionIdentifierType QuestionId` and `SessionIdentifierType SessionId` (`SessionQuestionAnsweredPayload.cs:8-10`). The positional form gives compiler-generated construction, equality, and JSON round-trip for free.
- **Why it's built this way**: an answered mark needs no per-user framing and no content, so the payload is the smallest thing that identifies which card to update; `sealed` closes the wire shape to subclassing.
- **Where it's used**: serialized to JSON and published under [`SessionQuestionChannel.QuestionAnswered`](#sessionquestionchannel) by the mark-answered handler; consumed by the session Live and presenter surfaces to refresh the question.

### SessionQuestionApprovedPayload
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionApprovedPayload.cs:10` · Level 0 · record

- **What it is**: the broadcast payload for the [`SessionQuestionChannel`](#sessionquestionchannel) `QuestionApproved` channel event. Unlike its answered and dismissed siblings it additionally carries the question text, so a client can render the newly visible question immediately.
- **Depends on**: the `SessionQuestionIdentifierType` and `SessionIdentifierType` aliases; BCL `string`.
- **Concept, universally-visible-only broadcast data.** `[Rubric §11, Security]` (assesses that broadcasts leak no privileged or per-user data). The doc comment (`SessionQuestionApprovedPayload.cs:4-5`) states the constraint directly: the payload carries only universally visible data (BR-238), the approved question's content and no author identity. Approval is exactly the moment a question becomes public to the room, so its text is safe to broadcast; the author is deliberately absent because questions display anonymously (the same rule enforced on [`SessionQuestionDTO`](#sessionquestiondto)).
- **Walkthrough**: a positional `sealed record` with three members (`SessionQuestionApprovedPayload.cs:10-13`), `SessionQuestionIdentifierType QuestionId`, `SessionIdentifierType SessionId`, and `string Text`. The text rides along (unlike the answered/dismissed payloads) so an attendee's list can insert the question without a follow-up fetch.
- **Why it's built this way**: an approve is worth surfacing instantly, so the one universally visible field that makes the update useful, the text, travels with the event, while everything author-scoped stays off the wire.
- **Where it's used**: serialized and published under [`SessionQuestionChannel.QuestionApproved`](#sessionquestionchannel) on submit under an Approved default or on moderation; consumed by the live Q&A surfaces to add the approved question.

### SessionQuestionChannel
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionChannel.cs:12` · Level 0 · class (static)

- **What it is**: the shared contract for the session Q&A push channel, the event-name string constants that ride the SignalR channel. It is the one vocabulary both the publisher (Engagement handlers) and the subscriber (the Blazor UI) agree on for questions, and it shares the session channel key with polls.
- **Depends on**: BCL only; it references the payload records [`SessionQuestionApprovedPayload`](#sessionquestionapprovedpayload), [`SessionQuestionAnsweredPayload`](#sessionquestionansweredpayload), [`SessionQuestionDismissedPayload`](#sessionquestiondismissedpayload), [`SessionQuestionUpvoteChangedPayload`](#sessionquestionupvotechangedpayload), and [`SessionQuestionPendingCountChangedPayload`](#sessionquestionpendingcountchangedpayload) in its doc comments as the shape each event carries. The class doc points at [`LivePollChannel.ForSession`](#livepollchannel) as the source of the channel key.
- **Concept, the event-name contract that mirrors the poll channel.** `[Rubric §7, Microservices Readiness]` (assesses shared contracts that let independently deployed parts agree without shared code paths) and `[Rubric §6, CQRS & Event-Driven]` (assesses a well-named event vocabulary). The ephemeral push mechanism itself is taught in this chapter's overview and framed by [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html); this class is where the *names* live. A publisher pushes `ILiveChannelPublisher.PublishAsync(channelKey, eventName, payloadJson)` and a subscriber matches on the same `eventName`, so if the two ends disagree on a string the broadcast silently no-ops. The doc comment (`SessionQuestionChannel.cs:6-8`) records that channel keys come from the existing [`LivePollChannel.ForSession`](#livepollchannel) helper, so questions and polls ride **one** session channel rather than two, and pins the security rule: broadcast payloads carry only universally visible data (BR-238), pending question content never rides the channel, and moderators instead get a count-only event. `[Rubric §11, Security]`: encoding "counts, not content" as the channel's contract is what keeps unmoderated text off the wire.
- **Walkthrough**: five `public const string` event names. `QuestionApproved = "question.approved"` (`SessionQuestionChannel.cs:15`), raised when a question becomes Approved on submit under an Approved default or on moderation; `QuestionAnswered = "question.answered"` (`SessionQuestionChannel.cs:18`); `QuestionDismissed = "question.dismissed"` (`SessionQuestionChannel.cs:21`); `QuestionUpvoteChanged = "question.upvote-changed"` (`SessionQuestionChannel.cs:24`), raised after an upvote toggle commits; and `QuestionPendingCountChanged = "question.pending-count-changed"` (`SessionQuestionChannel.cs:27`), a count-only moderator signal (BR-238). Each doc comment names the payload record it carries.
- **Why it's built this way**: reusing the poll channel key (rather than minting a second session channel) means an attendee on a session's Live page receives both poll and question events from one join, halving the SignalR group membership. A `static` class of `const` strings has no state and no DI cost, so any layer, transport edge, or the browser client can reference it freely; renaming an event once here moves both ends together (`[Rubric §16, Maintainability]`).
- **Where it's used**: the session-question command handlers publish under these names via [`ILiveChannelPublisher`](group-10-notifications.md#ilivechannelpublisher); the live Q&A surfaces join the shared session key and switch on these names to decide add versus reload versus count-only refresh.

### SessionQuestionDismissedPayload
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionDismissedPayload.cs:8` · Level 0 · record

- **What it is**: the broadcast payload for the [`SessionQuestionChannel`](#sessionquestionchannel) `QuestionDismissed` channel event, structurally identical to [`SessionQuestionAnsweredPayload`](#sessionquestionansweredpayload), naming the dismissed question and its session.
- **Depends on**: the `SessionQuestionIdentifierType` and `SessionIdentifierType` aliases; no first-party types.
- **Concept**: the ephemeral reload-hint payload introduced by [`SessionQuestionAnsweredPayload`](#sessionquestionansweredpayload). A dismiss removes a question from attendees' view, so the payload carries no content, only the two ids a subscriber uses to drop the card. `[Rubric §11, Security]`: pushing no text on a dismiss means a moderator's removal never re-broadcasts the (now hidden) question body.
- **Walkthrough**: a positional `sealed record` with two members, `SessionQuestionIdentifierType QuestionId` and `SessionIdentifierType SessionId` (`SessionQuestionDismissedPayload.cs:8-10`).
- **Why it's built this way**: a dismiss is a structural event, so the smallest id-only payload is enough to tell a client which card to hide; identical shape to the answered payload keeps the channel's payload family uniform.
- **Where it's used**: published under [`SessionQuestionChannel.QuestionDismissed`](#sessionquestionchannel) by the moderation handler; consumed by the live Q&A surfaces to remove the question.

### SessionQuestionPendingCountChangedPayload
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionPendingCountChangedPayload.cs:10` · Level 0 · record

- **What it is**: the broadcast payload for the [`SessionQuestionChannel`](#sessionquestionchannel) `QuestionPendingCountChanged` channel event, a count-only signal telling moderators how many Pending questions a session now has.
- **Depends on**: the `SessionIdentifierType` alias; BCL `int`.
- **Concept, the count-only moderator broadcast.** `[Rubric §11, Security]` (assesses that unmoderated content never leaves the server). The doc comment (`SessionQuestionPendingCountChangedPayload.cs:3-6`) states the rule that shapes this record: pending question content never rides the channel (BR-238), so instead of broadcasting a new pending question's text, the server broadcasts only the fresh count. A moderator's badge updates ("3 waiting") while the actual text stays gated behind an authenticated moderator fetch. This is the deliberate asymmetry that separates it from [`SessionQuestionApprovedPayload`](#sessionquestionapprovedpayload), which does carry text because approval makes the content public.
- **Walkthrough**: a positional `sealed record` with two members (`SessionQuestionPendingCountChangedPayload.cs:10-12`), `SessionIdentifierType SessionId` and `int PendingCount`, the fresh number of Pending questions for the session. Note there is no `QuestionId`, the signal is about the queue, not a single question.
- **Why it's built this way**: broadcasting a count rather than a question keeps unmoderated (possibly abusive) text off the wire while still giving moderators a live queue badge, so the moderation UI needs no polling to know work has arrived.
- **Where it's used**: published under [`SessionQuestionChannel.QuestionPendingCountChanged`](#sessionquestionchannel) whenever the Pending set changes (a new submission under a Pending default, or a moderation move); consumed by the moderator surfaces to update the pending badge.

### SessionQuestionUpvoteChangedPayload
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionUpvoteChangedPayload.cs:10` · Level 0 · record

- **What it is**: the broadcast payload for the [`SessionQuestionChannel`](#sessionquestionchannel) `QuestionUpvoteChanged` channel event, carrying the question, its session, and the fresh active-upvote count.
- **Depends on**: the `SessionQuestionIdentifierType` and `SessionIdentifierType` aliases; BCL `int`.
- **Concept, the counter broadcast that strips voter identity.** `[Rubric §11, Security]` (assesses that broadcasts never reveal who acted) and `[Rubric §12, Performance & Scalability]` (assesses patch-in-place over refetch). The doc comment (`SessionQuestionUpvoteChangedPayload.cs:4-5`) records the rule: the payload carries only the fresh count, never who voted (BR-238). Sending the new `UpvoteCount` inline lets each subscribed circuit patch the vote number in place without a refetch, the same burst-safe patch-in-place win the poll tallies use (see the overview and [`LivePollResultsDTO`](#livepollresultsdto)); each circuit keeps its own "did *I* upvote" marker locally because that per-user bit never rides the broadcast.
- **Walkthrough**: a positional `sealed record` with three members (`SessionQuestionUpvoteChangedPayload.cs:10-13`), `SessionQuestionIdentifierType QuestionId`, `SessionIdentifierType SessionId`, and `int UpvoteCount`, the fresh active-upvote count (soft-deleted upvotes excluded).
- **Why it's built this way**: broadcasting the count rather than the delta means a late joiner and an existing viewer converge on the same number without ordering assumptions, and omitting the voter id both protects privacy and keeps the payload tiny under burst voting.
- **Where it's used**: published under [`SessionQuestionChannel.QuestionUpvoteChanged`](#sessionquestionchannel) after an upvote toggle commits; consumed by the live Q&A surfaces to patch the upvote count in place.

### SubmitQuestionRequest
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SubmitQuestionRequest.cs:8` · Level 0 · record

- **What it is**: the request body for submitting a question to a live session (BR-231/BR-233), carrying the target session and the question text.
- **Depends on**: the `SessionIdentifierType` alias; BCL `string`.
- **Concept, identity-from-token, not from body.** `[Rubric §11, Security]` (assesses that a caller cannot act as another principal) and `[Rubric §9, API & Contract Design]` (assesses request contracts that model only client-owned data). Like [`CreateLivePollRequest`](#createlivepollrequest) and the poll `CastVoteRequest`, the most important thing about this DTO is what it deliberately omits: there is no `UserId`. The doc comment (`SubmitQuestionRequest.cs:4-6`) states the rule the handler enforces, the submitting user is taken from the caller's token server-side via [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), never from the request body, so a question cannot be submitted on behalf of another user. Field-length limits (1 to 500 characters, BR-231) are documented here but validated downstream by the FluentValidation validator and the aggregate's factory, so an invalid request fails with Problem Details rather than being unconstructable.
- **Walkthrough**: two members, `required SessionIdentifierType SessionId { get; init; }` (`SubmitQuestionRequest.cs:11`), the target session, which must be live-eligible (BR-49/BR-91); and `required string Text { get; init; }` (`SubmitQuestionRequest.cs:14`), the question text. `required` forces the client to supply both; `init` makes them immutable once bound.
- **Why it's built this way**: keeping the request to the session id plus the text means the submit endpoint cannot be spoofed with a foreign user id and cannot smuggle a status, the moderation default is decided server-side from the event (BR-233), not by the client.
- **Where it's used**: the body of the submit-question endpoint; mapped into the submit command handled in the Application layer, which stamps the caller as author and creates a [`SessionQuestion`](#sessionquestion).

### SessionQuestionDTO
> MMCA.ADC.Engagement.Shared · `MMCA.ADC.Engagement.Shared.SessionQuestions` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionDTO.cs:10` · Level 1 · record

- **What it is**: the read-side representation of a session question: its text, moderation status, answered flag, upvote count, plus two per-caller flags (did I upvote, is this mine). It is what every Q&A list renders.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (implemented, `SessionQuestionDTO.cs:10`, via `MMCA.Common.Shared.DTOs`), [`QuestionStatus`](#questionstatus), and the `SessionQuestionIdentifierType`/`SessionIdentifierType`/`EventIdentifierType` aliases.
- **Concept, the anonymized identified read DTO.** `[Rubric §9, API & Contract Design]` (assesses stable read contracts distinct from the domain model) and `[Rubric §11, Security]` (assesses deliberate omission of identity). By implementing [`IBaseDTO<SessionQuestionIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (the DTO counterpart of the entity identity contract) the record slots into the generic entity-query and mapping machinery that keys results by `Id`. The doc comment (`SessionQuestionDTO.cs:5-8`) records the deliberate design: the DTO carries **no** user-identity fields at all, because questions display anonymously; the caller is related to the question only through the two per-caller flags `MyUpvote` and `IsMine` (BR-238). Those flags are computed per request against the calling user, they are not stored on the entity.
- **Walkthrough**: ten members.
  - `required SessionQuestionIdentifierType Id` (`SessionQuestionDTO.cs:13`), the `IBaseDTO` key.
  - `required SessionIdentifierType SessionId` (`SessionQuestionDTO.cs:16`) and `required EventIdentifierType EventId` (`SessionQuestionDTO.cs:19`), the event id denormalized at submission so the read model needs no join back to Conference.
  - `required string Text` (`SessionQuestionDTO.cs:22`), the question body.
  - `QuestionStatus Status` (`SessionQuestionDTO.cs:25`) and `bool IsAnswered` (`SessionQuestionDTO.cs:28`), the moderation state and the answered mark.
  - `int UpvoteCount` (`SessionQuestionDTO.cs:31`), the number of active upvotes.
  - `bool MyUpvote` (`SessionQuestionDTO.cs:34`) and `bool IsMine` (`SessionQuestionDTO.cs:37`), the per-caller flags: whether the calling user has an active upvote, and whether the calling user authored the question.
  - `DateTime CreatedOn` (`SessionQuestionDTO.cs:40`), when the question was submitted.
- **Why it's built this way**: keeping author identity off the DTO entirely (rather than sending it and hoping the UI hides it) means an anonymous-by-design feature cannot leak an author through the wire; the only caller-relative facts, `MyUpvote`/`IsMine`, are booleans computed for the one requester, so no other attendee's relationship to the question is ever exposed. Denormalizing `EventId` keeps the read model self-contained for filtering.
- **Where it's used**: returned by the Q&A read endpoints; produced by the session-question DTO mapper (a compile-time Mapperly mapper, [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)) with the per-caller flags projected in against [`ICurrentUserService`](group-08-auth.md#icurrentuserservice); rendered by the session Live and presenter Q&A surfaces.

### HappeningNow
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.HappeningNow` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/HappeningNow/HappeningNow.razor.cs:21` · Level 8 · class (Blazor page)

- **What it is**: the conference-day home page. It shows now-and-next sessions, the event's open live polls with live tallies, and (for organizers only) a poll-manage tab, and it joins the event's live channel so poll events refresh the tallies without polling.
- **Depends on**: injected UI services [`ILiveEventUIService`](#iliveeventuiservice), [`ILivePollUIService`](#ilivepolluiservice), [`ISessionLookupService`](#isessionlookupservice), [`NotificationState`](group-15-common-ui-framework.md#notificationstate), [`NotificationHubService`](group-15-common-ui-framework.md#notificationhubservice), MudBlazor's `ISnackbar`, and [`IHapticFeedbackService`](group-26-device-capability-layer.md#ihapticfeedbackservice); DTOs [`LiveEventContext`](#liveeventcontext), [`LivePollResultsDTO`](#livepollresultsdto), [`LivePollDTO`](#livepolldto), [`SessionInfo`](#sessioninfo), and [`CreateLivePollRequest`](#createlivepollrequest); the [`LivePollChannel`](#livepollchannel) key/event vocabulary; [`RoleNames`](group-08-auth.md#rolenames) and [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) from the Common UI; plus the nested [`OptionState`](#optionstate). It implements `IAsyncDisposable`.
- **Concept introduced, the live Blazor surface: prerender-safe load then interactive channel join.** `[Rubric §18, UI Architecture]` (assesses component lifecycle and separation of load from live wiring), `[Rubric §19, State Management]`, and `[Rubric §23, Front-End Performance]`. The page splits its lifecycle in two. `OnInitializedAsync` (`HappeningNow.razor.cs:55`) does the data load, reading the organizer flag from the cascading `AuthenticationState` via `IsInRole(RoleNames.Organizer)` (`HappeningNow.razor.cs:76`), fetching the current [`LiveEventContext`](#liveeventcontext), and loading sessions and polls (and manage-polls only for organizers). The live wiring waits for `OnAfterRenderAsync` with `firstRender && RendererInfo.IsInteractive` (`HappeningNow.razor.cs:107-123`): only an interactive render, and only when the event is currently live (`_liveEvent.IsLiveAt(DateTime.UtcNow)`), joins the [`LivePollChannel.ForEvent`](#livepollchannel) key and subscribes to channel events. The comment at `HappeningNow.razor.cs:67-70` documents a deliberate exception: unlike the sibling Live/Presenter pages this page keeps its loads on the prerender pass (accepting a double fetch) because its bUnit suite renders the non-interactive path so the sealed [`NotificationHubService`](group-15-common-ui-framework.md#notificationhubservice) never dials out, adding a prerender guard needs a hub-service test extension point first (deferred). `[Rubric §28, Front-End Testing]`: the code shape here is driven by what the component test can exercise.
- **Walkthrough**, in teaching order:
  - **Injected state and fields** (`HappeningNow.razor.cs:23-52`): the seven injected services, the cascading `AuthState`, a `CancellationTokenSource _cts` for disposal-safe async, the loaded `_liveEvent`, poll/manage/session lists, and the create-poll form buffers `_newQuestion` and `_newOptions` (seeded with two empty [`OptionState`](#optionstate) rows, `HappeningNow.razor.cs:50`).
  - **Load** (`HappeningNow.razor.cs:55-105`): sets breadcrumbs, subscribes to [`NotificationState`](group-15-common-ui-framework.md#notificationstate)`.OnChange` to keep the header unread badge live, fetches the current event and returns early if none, then loads sessions and polls; every failure funnels into a single localized `_loadError`, and `OperationCanceledException` is swallowed as expected-during-disposal.
  - **Channel handling** (`HappeningNow.razor.cs:128-168`): `HandleChannelEventAsync` is the performance heart. For a `LivePollChannel.PollResultsChanged` event it calls `TryPatchPollResults` to patch the matching poll's tallies **in place** from the broadcast payload, preserving this circuit's own `MyVoteOptionId` (`HappeningNow.razor.cs:161`); the comment at `HappeningNow.razor.cs:130-133` explains why reload-on-broadcast was abandoned (one hot poll turned V votes x C viewers into V*C authenticated refetches, colliding with the per-user rate limiter). Structural events (opened/closed) fall through to `ReloadPollsAsync`.
  - **Session bucketing** (`HappeningNow.razor.cs:170-187`): `LoadSessionsAsync` converts now to event-local time via `_liveEvent.ToEventLocal` and splits the event's timed sessions into `_sessionsNow` (currently running) and the next six upcoming.
  - **Voting** (`HappeningNow.razor.cs:219-249`): `VoteAsync` fires a haptic click (a no-op off native, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)), casts the vote through [`ILivePollUIService`](#ilivepolluiservice), and patches the returned results into `_polls`.
  - **Organizer poll authoring** (`HappeningNow.razor.cs:251-317`): `AddOption`/`RemoveOption` grow the option list between 2 and 10 rows; `CreatePollAsync` trims and filters the [`OptionState`](#optionstate) rows to a `List<string>`, guards a minimum of two non-empty options, builds a [`CreateLivePollRequest`](#createlivepollrequest), and resets the form.
  - **Manage actions** (`HappeningNow.razor.cs:319-350`): `Open`/`Close`/`Delete` route through one `RunManageActionAsync` helper that toasts success and reloads, with `ShowActionError` (`HappeningNow.razor.cs:357`) surfacing a domain rejection's own localized Problem Details message via [`ErrorMessages.ActionError`](group-15-common-ui-framework.md#errormessages) ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
  - **Disposal** (`HappeningNow.razor.cs:366-380`): unsubscribes `NotificationState`, cancels and disposes the `_cts`, disposes the channel subscription, and leaves the channel group.
- **Why it's built this way**: patch-in-place from the self-contained [`LivePollResultsDTO`](#livepollresultsdto) broadcast (rather than a refetch on every event) is what keeps a hot poll from stampeding the API under burst voting, and gating the channel join on `RendererInfo.IsInteractive` plus a live-window check means a prerender or an already-ended event never opens a SignalR connection. `[Rubric §29, Resilience]`: a background refresh that throws never crashes the page, it toasts and lets the next channel event or the manual refresh retry (`HappeningNow.razor.cs:211-216`).
- **Where it's used**: routed as the conference-day landing page; it is the event-wide sibling of the per-session live surfaces [`SessionLive`](#sessionlive) and [`PresenterView`](#presenterview).
- **Caveats / not-in-source**: the `.razor` markup and the `@page` route/localization keys live in the paired `HappeningNow.razor` markup file, not in this code-behind, so the exact route string and rendered layout are not determinable from `HappeningNow.razor.cs` alone.

### OptionState

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.SessionLive` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLiveModerationPanel.razor.cs:233` · Level 0 · class

- **What it is**: a one-field mutable holder for a single poll-option's text, private and nested inside [SessionLiveModerationPanel](#sessionlivemoderationpanel). It exists only to give the create-poll form's dynamic option rows a stable reference-type target for two-way Blazor binding.
- **Depends on**: nothing first-party. Just a nullable `string` (`Text`, `SessionLiveModerationPanel.razor.cs:235`).
- **Concept introduced**: **reference-type binding cells for a growable form list.** Blazor's `@bind` needs a settable member on a stable object identity; binding directly to entries of a `List<string>` does not work because a `string` element has no addressable setter and the box would be replaced on every keystroke. Wrapping each option in a small mutable class gives the `MudTextField` a fixed object to write `Text` into, and lets `AddOption`/`RemoveOption` grow and shrink the list (`SessionLiveModerationPanel.razor.cs:117`, `:125`) without disturbing the other rows' bindings. `[Rubric §24, Forms/Validation/UX Safety]` assesses how the UI models editable form state safely: here the wrapper is the minimal mechanism that keeps a variable-length option list editable without index churn.
- **Walkthrough**: declared `private sealed class OptionState` at `SessionLiveModerationPanel.razor.cs:233` with a single auto-property `public string? Text { get; set; }` (`:235`). The panel seeds two of them (`_newPollOptions = [new(), new()]`, `:73`), enforces a 2-to-10 range via `AddOption`/`RemoveOption` (`:119`, `:127`), and on submit projects the trimmed non-empty texts into the request's `Options` list (`:141`).
- **Why it's built this way**: a `sealed` private nested type keeps this a pure implementation detail of the moderation panel: it never crosses a boundary (the wire type is the plain `List<string>` on [CreateLivePollRequest](#createlivepollrequest)), so it does not belong in the Shared project.
- **Where it's used**: only within [SessionLiveModerationPanel](#sessionlivemoderationpanel), backing the `_newPollOptions` field and the create-poll option rows.

### SessionLivePollPanel

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.SessionLive` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLivePollPanel.razor.cs:17` · Level 3 · class

- **What it is**: the presentational child component that renders a session's open polls with their live tallies and casts the attendee's vote. It is the "poll" third of the container/presentational split of the [SessionLive](#sessionlive) page.
- **Depends on**: [ILivePollUIService](#ilivepolluiservice) (the vote call), [LivePollResultsDTO](#livepollresultsdto) (the per-poll tally model), `MudBlazor.ISnackbar` (error toasts), [IHapticFeedbackService](group-26-device-capability-layer.md#ihapticfeedbackservice) (native tactile confirmation), and [ErrorMessages](group-15-common-ui-framework.md#errormessages) for the domain-aware failure text.
- **Concept introduced**: **container/presentational split with parent-owned state.** The page ([SessionLive](#sessionlive)) is the container: it owns the poll list, the channel subscription, and the shared saving flag. This panel is presentational: it receives `Polls` as a `[Parameter]` (`SessionLivePollPanel.razor.cs:26`) and never loads them itself. The one piece of state it mutates is a *patch in place* of the passed-in list after a vote, so the container sees the fresh tally without a reload. `[Rubric §19, State Management]` assesses where state lives and who owns it: state ownership stays with the page, the panel only renders and emits, which is the clean version of the split. `[Rubric §18, UI Architecture]` (component decomposition) is embodied by splitting one large live page into three focused panels.
- **Walkthrough**: three injected services (`PollService`, `Snackbar`, `Haptics`, `SessionLivePollPanel.razor.cs:19-21`). `Polls` is an `[EditorRequired]` `List<LivePollResultsDTO>` parameter (`:26`); `IsSaving`/`IsSavingChanged` (`:30`, `:34`) are the shared page-wide saving flag flowing in and back out so every section disables together. `VoteAsync(pollId, optionId)` (`:38`) fires `Haptics.Click()` first (a no-op off native, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)), raises the saving flag, calls `PollService.CastVoteAsync` (`:46`), and if a tally comes back finds the poll by `PollId` and replaces it in the container-owned list in place (`:49-53`). `OperationCanceledException` from disposal is swallowed (`:56`); any other failure routes through `ShowActionError` (`:62`). Disposal cancels and disposes the `CancellationTokenSource` (`:79`).
- **Why it's built this way**: patching the returned tally into the shared list (rather than reloading) keeps the panel cheap and avoids a redundant round-trip: the cast already returned the new counts. The saving flag is lifted to the page so a vote here disables the Q&A submit and moderation buttons too, preventing overlapping mutations.
- **Where it's used**: instantiated by [SessionLive](#sessionlive)'s markup as the open-polls section; the container passes `_polls` and the shared saving flag.
- **Caveats / not-in-source**: the `.razor` markup (tally bars, vote buttons) lives in the sibling `SessionLivePollPanel.razor` file, not in this code-behind.

### PresenterView

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.SessionLive` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/PresenterView.razor.cs:17` · Level 5 · class

- **What it is**: the chrome-less, large-type projector page for a session's live layer: the session title, the open polls as big result bars, and the top approved questions by upvotes. It has no inputs; it is meant to be thrown on the room screen and left to refresh itself from the live channel.
- **Depends on**: [ILivePollUIService](#ilivepolluiservice) and [ISessionQuestionUIService](#isessionquestionuiservice) (data loads), [ISessionLookupService](#isessionlookupservice) (the single-session label), [NotificationHubService](group-15-common-ui-framework.md#notificationhubservice) (the SignalR channel subscription), the channel key/event constants [LivePollChannel](#livepollchannel) and [SessionQuestionChannel](#sessionquestionchannel), the models [LivePollResultsDTO](#livepollresultsdto), [SessionQuestionDTO](#sessionquestiondto), [SessionInfo](#sessioninfo), and [SessionQuestionUpvoteChangedPayload](#sessionquestionupvotechangedpayload), plus `System.Text.Json` and `MudBlazor.ISnackbar`.
- **Concept introduced**: **patch-on-broadcast vs reload-on-broadcast for a hot channel.** The projector is typically the most-connected client during a live poll, so blindly reloading on every broadcast would multiply backend reads at exactly the wrong moment. `HandleChannelEventAsync` (`PresenterView.razor.cs:100`) therefore patches the two high-frequency tally events in place from the broadcast payload (which already carries the fresh counts, BR-229/BR-238) and only reloads for structural events. `[Rubric §12, Performance & Scalability]` assesses how the design behaves under load: the patch path is a deliberate fan-out mitigation. `[Rubric §23, Front-End Performance]` covers client render/network cost: patching one list element and calling `StateHasChanged` is far cheaper than a full refetch-and-rebind.
- **Walkthrough**: `TopQuestionCount = 5` (`PresenterView.razor.cs:19`); the injected services (`:21-25`); the `Id` route parameter (`:29`). State: `IsLoading`, `_loadError`, `_session`, `_polls`, `_questions`, and the channel subscription/key (`:33-41`). `TopQuestions` (`:44`) projects the approved questions ordered by `UpvoteCount` desc then `CreatedOn`, taking the top 5. `OnInitializedAsync` (`:51`) short-circuits during SSR prerender via `RendererInfo.IsInteractive` (so the loads do not run twice per visit), point-reads the session (`:64`), then `LoadAsync`. `OnAfterRenderAsync` (`:87`) joins the session channel via `LivePollChannel.ForSession(Id)` on first interactive render. `HandleChannelEventAsync` (`:100`) matches `LivePollChannel.PollResultsChanged` → `TryPatchPollResults` (`:142`) and `SessionQuestionChannel.QuestionUpvoteChanged` → `TryPatchUpvoteCount` (`:164`), both deserializing with `JsonSerializerOptions.Web` and finding the row by id; anything else falls through to a full `LoadAsync` reload, whose transient failures are toasted, never crashed (`:129-134`). `LoadAsync` (`:185`) refetches open polls and questions. Disposal cancels the token, disposes the subscription, and leaves the channel (`:197`).
- **Why it's built this way**: the projector shows no per-user data, so `TryPatchPollResults` here drops the broadcast tally straight in with no vote-marker preservation (unlike the attendee page). The SSR-prerender skip and the point-read (rather than fetching the whole session catalog) are the same load-shedding instincts applied to first paint.
- **Where it's used**: a routed page (the `@page` directive is in `PresenterView.razor`); reached from the live-layer navigation for a session.
- **Caveats / not-in-source**: the route template and the visual layout live in `PresenterView.razor`.

### SessionLive

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.SessionLive` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLive.razor.cs:23` · Level 5 · class

- **What it is**: the routed session Live page and the *container* for the whole per-session live experience: open polls with live tallies, the attendee Q&A surface, and a moderation panel for organizers/admins and speaker-claim holders. It owns the lists, the channel subscription, and the shared saving flag, and renders the three sections through the presentational child panels.
- **Depends on**: [ILivePollUIService](#ilivepolluiservice), [ISessionQuestionUIService](#isessionquestionuiservice), [ISessionLookupService](#isessionlookupservice), [NotificationHubService](group-15-common-ui-framework.md#notificationhubservice); the child panels [SessionLivePollPanel](#sessionlivepollpanel), [SessionLiveQuestionPanel](#sessionlivequestionpanel), [SessionLiveModerationPanel](#sessionlivemoderationpanel); the channel constants [LivePollChannel](#livepollchannel)/[SessionQuestionChannel](#sessionquestionchannel); the models [LivePollResultsDTO](#livepollresultsdto), [SessionQuestionDTO](#sessionquestiondto), [LivePollDTO](#livepolldto), [SessionInfo](#sessioninfo), [SessionQuestionUpvoteChangedPayload](#sessionquestionupvotechangedpayload); [RoleNames](group-08-auth.md#rolenames) and [EngagementRoutePaths](group-22-engagement-module.md#engagementroutepaths); plus `AuthenticationState`, `System.Text.Json`, and `MudBlazor`.
- **Concept introduced**: **container-owns-state, panels-own-actions with post-action reload callbacks.** Each presentational panel performs its own service call, then invokes an `EventCallback` so the page (which owns the lists) reloads exactly what the action affected: `ReloadQuestionListsAsync`, `ReloadModerationListsAsync`, `ReloadPollListsAsync` (`SessionLive.razor.cs:317`, `:326`, `:332`). `[Rubric §19, State Management]` is embodied cleanly: a single source of truth for each list, and a narrow contract (patch-or-reload callbacks) between page and panels. `[Rubric §11, Security]` note: the page computes `_canModerate` from roles plus a `speaker_id` claim (`:78-81`), but the comments are explicit that this is a UI-affordance gate only, the server is the authority on per-session rights (BR-236), and the client degrades to attendee view on a 403.
- **Walkthrough**: injected services (`SessionLive.razor.cs:25-29`), the cascading `AuthState` (`:31`), the `Id` route parameter (`:36`). State fields include `_polls`, `_questions`, `_moderationQueue`, `_managePolls`, `_canModerate`, and the shared `IsSaving` (`:42-54`). `OnInitializedAsync` (`:56`) builds breadcrumbs, skips loads during SSR prerender, computes `_canModerate` (`:78`), point-reads the session, then loads polls, questions, and (if allowed) the moderation data. `OnAfterRenderAsync` (`:116`) joins the session channel. `HandleChannelEventAsync` (`:129`) first tries the tally fast-path via `TryHandleTallyEventAsync` (`:182`), then routes structural `poll.*` and `question.*` prefixes and `SessionQuestionChannel.QuestionPendingCountChanged` to targeted reloads. The comment at `:131-135` records the concrete reason for the patch path: reload-on-broadcast turned V voters x C viewers into V*C authenticated refetches per hot poll, colliding with the per-user rate limiter. `TryPatchPollResults` (`:212`) is the attendee-specific variant: it preserves this circuit's own `MyVoteOptionId` when applying the broadcast tally (`:224`), because broadcasts strip per-user data. `LoadManagePollsAsync` (`:300`) fetches the LiveManage-gated event poll list and filters to this session, degrading to an empty list on a 403 so speaker moderators still get lifecycle actions. Disposal cancels, disposes the subscription, and leaves the channel (`:344`).
- **Why it's built this way**: the container/presentational split keeps one page from ballooning while preserving a single owner for each list and the saving flag. The tally patch path is a measured response to a real rate-limit collision, not a premature optimization: the code comments name the failure mode.
- **Where it's used**: a routed page (`@page` in `SessionLive.razor`), reached from the Happening-Now surface via [EngagementRoutePaths](group-22-engagement-module.md#engagementroutepaths).
- **Caveats / not-in-source**: the route template, breadcrumb rendering, and the three panel instantiations live in `SessionLive.razor`.

### SessionLiveQuestionPanel

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.SessionLive` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLiveQuestionPanel.razor.cs:18` · Level 5 · class

- **What it is**: the presentational child component for the attendee Q&A surface: a submit box (with speech dictation), the approved questions sorted by upvotes, the caller's own not-yet-approved questions, and the upvote toggle. It is the "question" third of the [SessionLive](#sessionlive) split.
- **Depends on**: [ISessionQuestionUIService](#isessionquestionuiservice) (submit/upvote calls), [SessionQuestionDTO](#sessionquestiondto) (the question model), [SubmitQuestionRequest](#submitquestionrequest) (the submit payload), [ISpeechToTextService](group-26-device-capability-layer.md#ispeechtotextservice) (dictation), [ErrorMessages](group-15-common-ui-framework.md#errormessages), and `MudBlazor.ISnackbar`.
- **Concept introduced**: **linked-token dictation as a toggle.** Voice input ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 4) uses a second `CancellationTokenSource` linked to the component's own `_cts` (`SessionLiveQuestionPanel.razor.cs:81`) so the same button both starts a dictation and cancels one already in flight (`:68-78`); disposal disposes that linked source too (`:179`). This is the first place in the live layer where a device-capability service is toggled inline in a form. `[Rubric §24, Forms/Validation/UX Safety]` assesses input UX and guard rails: the submit path validates non-empty text before the call and trims on send (`:105`, `:114`). `[Rubric §19, State Management]` again applies: the panel patches the container-owned `Questions` list in place after an upvote, keeping the page as the single owner.
- **Walkthrough**: injected `QuestionService`, `Snackbar`, `SpeechToText` (`SessionLiveQuestionPanel.razor.cs:20-22`). Parameters: `SessionId` and the `[EditorRequired]` `Questions` list (`:27`, `:32`), plus the shared `IsSaving`/`IsSavingChanged` and the `OnQuestionSubmitted` reload callback (`:36-44`). `ApprovedQuestions` (`:51`) filters to `QuestionStatus.Approved` ordered by `UpvoteCount` desc then `CreatedOn`; `MyModeratedQuestions` (`:58`) surfaces the caller's own pending questions via `IsMine`. `ToggleDictationAsync` (`:68`) starts/stops speech capture and appends recognized text to the box. `SubmitQuestionAsync` (`:103`) validates, builds a [SubmitQuestionRequest](#submitquestionrequest), submits, clears the box, and invokes `OnQuestionSubmitted` so the page reloads its lists. `ToggleUpvoteAsync` (`:136`) calls remove-or-add upvote based on `MyUpvote`, then patches the returned count and flipped marker into the list in place (`:149`), which re-sorts `ApprovedQuestions`. Disposal cancels/disposes both token sources (`:175`).
- **Why it's built this way**: patching the upvote count locally (rather than reloading) keeps the sort responsive under rapid toggling; the channel's broadcast reconciles other clients. Lifting the saving flag to the page disables the poll and moderation sections during a submit.
- **Where it's used**: instantiated by [SessionLive](#sessionlive) as the Q&A section.
- **Caveats / not-in-source**: the submit box, dictation button, and question list markup live in `SessionLiveQuestionPanel.razor`.

### SessionLiveModerationPanel

> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Pages.SessionLive` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLiveModerationPanel.razor.cs:19` · Level 6 · class

- **What it is**: the presentational child component for the moderation section, rendered for organizers/admins and speaker-claim holders: the question moderation queue (approve / dismiss / mark answered), the create-poll form, and the poll lifecycle rows (open / close). It owns the create-poll form state and performs the moderation and poll calls; the page reloads the affected lists via change callbacks.
- **Depends on**: [ILivePollUIService](#ilivepolluiservice) and [ISessionQuestionUIService](#isessionquestionuiservice) (moderation/poll calls), the models [SessionQuestionDTO](#sessionquestiondto), [LivePollDTO](#livepolldto), [LivePollResultsDTO](#livepollresultsdto), the enum [LivePollStatus](#livepollstatus), [CreateLivePollRequest](#createlivepollrequest) (the new-poll payload), the nested [OptionState](#optionstate) binding cell, [ErrorMessages](group-15-common-ui-framework.md#errormessages), and `MudBlazor.ISnackbar`.
- **Concept introduced**: **capability fallback under partial authorization.** `ManagePollRows` (`SessionLiveModerationPanel.razor.cs:80`) uses the organizer event poll list (`ManagePolls`) when it is available, else falls back to the open session polls (`Polls`), because a speaker moderator cannot call the LiveManage-gated event list but can still close what is open and create new polls. `[Rubric §11, Security]` assesses defense in depth: the panel renders actions but the server enforces the real per-session rights (BR-236, cited in the class doc at `:12-18`); the client fallback is a UX affordance, not the trust boundary. `[Rubric §24, Forms/Validation/UX Safety]` covers the create-poll form, which enforces a 2-to-10 option range (`AddOption`/`RemoveOption`, `:117`, `:125`) and requires a question plus at least two non-empty options before calling the service (`:135`, `:146`).
- **Walkthrough**: injected `PollService`, `QuestionService`, `Snackbar` (`SessionLiveModerationPanel.razor.cs:21-23`). Parameters: `SessionId`, `EventId`, and three `[EditorRequired]` lists (`ModerationQueue`, `ManagePolls`, `Polls`, `:38-48`), the shared `IsSaving`/`IsSavingChanged`, plus `OnModerationChanged`, `OnPollCreated`, `OnPollLifecycleChanged` reload callbacks (`:52-68`). Form state is `_newPollQuestion` and `_newPollOptions` (two seeded [OptionState](#optionstate) cells, `:72-73`). The three moderation actions (`ApproveQuestionAsync`, `DismissQuestionAsync`, `MarkQuestionAnsweredAsync`, `:85-92`) all route through `RunModerationActionAsync` (`:94`), which raises the saving flag, calls the service, toasts success, and invokes `OnModerationChanged`. `CreateSessionPollAsync` (`:133`) validates, projects the trimmed option texts, builds a [CreateLivePollRequest](#createlivepollrequest), calls create, resets the form to two blank options, and invokes `OnPollCreated`. `OpenPollAsync`/`ClosePollAsync` (`:186`, `:189`) route through `RunPollActionAsync` (`:192`) and invoke `OnPollLifecycleChanged`. Every action swallows `OperationCanceledException` and routes other failures through `ShowActionError`, which uses [ErrorMessages](group-15-common-ui-framework.md#errormessages)`.ActionError` to show the server's own localized Problem Details message or a generic fallback ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) Decision 9 carve-out, `:220`). Disposal cancels/disposes `_cts` (`:224`). The nested [OptionState](#optionstate) type is declared at `:233`.
- **Why it's built this way**: the `ManagePollRows` fallback lets a speaker moderator operate the panel without the organizer-only event list, matching the server's tiered rights instead of hiding controls the speaker legitimately has. The three separate reload callbacks let the container reload only the lists an action touched.
- **Where it's used**: instantiated by [SessionLive](#sessionlive) as the moderation section, guarded by the page's `_canModerate` flag.
- **Caveats / not-in-source**: the moderation-queue table, create-poll form, and lifecycle rows are laid out in `SessionLiveModerationPanel.razor`.

### LiveEventContext
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/LiveEventContext.cs:13` · Level 0 · record

- **What it is**: The UI's read-only view of the currently published event's live window: the event id and name, its IANA time zone, and the UTC start/end of the window during which the live layer (polls and session Q&A) is active. It is a `sealed record` with two small behaviors attached, not a bare DTO.
- **Depends on**: `EventIdentifierType` (the Conference module's identifier alias), BCL `DateTime` and `TimeZoneInfo`. No NuGet or first-party service dependencies; this is a pure value.
- **Concept introduced**: **Client-side re-derivation of a server-enforced window.** The doc comment (`LiveEventContext.cs:4`) is explicit that the window uses "the same math the backend enforces": StartDate 00:00 local through EndDate + 1 day 00:00 local, converted to UTC via the event's zone. The UI does not invent its own liveness rule, it mirrors the authoritative one so the ambient live listener and the Happening Now page light up at exactly the moment the API would accept a vote. [Rubric §19, State Management] assesses how derived UI state is kept consistent with the source of truth; here the record centralizes the "am I live" decision in one place both UI surfaces call, rather than scattering time-zone arithmetic across components. [Rubric §12, Performance & Scalability] applies mildly: `IsLiveAt` is a pure comparison, so the ambient listener can poll it cheaply without a round trip.
- **Walkthrough**: The primary constructor (`LiveEventContext.cs:13`) captures `EventId`, `Name`, `TimeZoneId`, `LiveWindowStartUtc`, and `LiveWindowEndUtc`. `IsLiveAt(DateTime utcNow)` (`LiveEventContext.cs:22`) returns true when `utcNow` is within the half-open window `[start, end)`, note the exclusive upper bound (`< LiveWindowEndUtc`) matching an exclusive end. `ToEventLocal(DateTime utcNow)` (`LiveEventContext.cs:27`) converts a UTC instant into the event's local time via `TimeZoneInfo.FindSystemTimeZoneById`, and on an unrecognized zone catches `TimeZoneNotFoundException` and falls back to returning the UTC value unchanged (`LiveEventContext.cs:33`) rather than throwing into a render.
- **Why it's built this way**: Making the record own both the window and the "is it live / what is local time" helpers keeps the liveness contract in a single testable value, and the fail-soft time-zone fallback means a bad or unknown IANA id degrades to a display quirk, never a crashed page.
- **Where it's used**: Produced by [LiveEventService](#liveeventservice) from Conference event data; consumed by the Happening Now page and the ambient `LiveEventListener` (named in [ILiveEventUIService](#iliveeventuiservice)'s doc comment) to decide whether to show live surfaces.

### SessionInfo
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:7` · Level 0 · record

- **What it is**: A lightweight projection record carrying just the session fields the Engagement pages need to label a bookmark or a live row: id, title, optional start/end times, and the owning event id. It sits at the top of `ISessionLookupService.cs` because it is the shape that lookup service returns.
- **Depends on**: `SessionIdentifierType`, `EventIdentifierType` (Conference identifier aliases). No first-party service dependencies.
- **Concept introduced**: **Cross-module display projection.** Engagement has no session table of its own (database-per-service, [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), so it cannot join to a session title. Instead it fetches the fields it needs from the Conference API and holds them in this small record, a deliberately thinner shape than Conference's own [SessionDTO](group-17-conference-domain.md#sessiondto). [Rubric §9, API & Contract Design] assesses how a consumer models another service's data at its boundary: `SessionInfo` takes only the five fields it renders, so a change to unrelated `SessionDTO` fields never ripples into Engagement.
- **Walkthrough**: Positional members `(SessionIdentifierType Id, string Title, DateTime? StartsAt, DateTime? EndsAt, EventIdentifierType EventId)` (`ISessionLookupService.cs:7`). `StartsAt`/`EndsAt` are nullable because a session imported from the schedule source may not yet have times assigned, so pages must tolerate an unscheduled session.
- **Why it's built this way**: A compact record lets the lookup service cache many sessions cheaply and lets pages sort by `StartsAt` client-side without a second fetch per row.
- **Where it's used**: Returned by [ISessionLookupService](#isessionlookupservice) (`GetAllAsync` keyed by id, `GetByIdAsync` for one), built by [SessionLookupService](#sessionlookupservice) from Conference `SessionDTO`s.

### CreateLivePollCommand
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollCommand.cs:14` · Level 1 · record

- **What it is**: The CQRS command that requests creation of a live poll (as Draft). It wraps the transport [CreateLivePollRequest](#createlivepollrequest) together with two facts about the caller: their `speaker_id` claim (if any) and whether they hold an organizer/admin role.
- **Depends on**: [CreateLivePollRequest](#createlivepollrequest) (the request body shape, `MMCA.ADC.Engagement.Shared.LivePolls`), `SpeakerIdentifierType?` (Conference alias). It is dispatched to [CreateLivePollHandler](#createlivepollhandler).
- **Concept introduced**: **Identity travels beside the request, never inside it.** The doc comment (`CreateLivePollCommand.cs:8`) states the two caller fields are "bound from the token at the API edge (never from the request)." This is the standard guard against a client claiming to be a speaker or organizer by putting it in the JSON body: the controller reads `CallerSpeakerId` and `CallerIsOrganizer` from the validated JWT and stamps them onto the command. [Rubric §11, Security] assesses exactly this boundary between attacker-controlled input and trusted claims; splitting `Request` from the caller fields makes the trust boundary a compile-time shape. [Rubric §6, CQRS & Event-Driven] applies because this is the command half of the pattern taught in [Group 05](group-05-cqrs-pipeline.md).
- **Walkthrough**: Positional record `(CreateLivePollRequest Request, SpeakerIdentifierType? CallerSpeakerId, bool CallerIsOrganizer)` (`CreateLivePollCommand.cs:14`). The nullable `CallerSpeakerId` encodes "the caller is not a speaker"; `CallerIsOrganizer` is the role bypass. The handler combines them to authorize event-wide vs session-scoped polls (BR-236 shape, cited at `CreateLivePollCommand.cs:9`).
- **Why it's built this way**: Keeping authorization inputs on the command (not re-reading the HTTP context deep in the handler) keeps the Application layer host-agnostic and unit-testable: a test constructs the command with arbitrary claims and asserts the rights outcome.
- **Where it's used**: Validated by [CreateLivePollCommandValidator](#createlivepollcommandvalidator), handled by [CreateLivePollHandler](#createlivepollhandler).

### ILiveEventUIService
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/ILiveEventUIService.cs:7` · Level 1 · interface

- **What it is**: The UI-facing contract for resolving the current published event and its live window. One method, `GetCurrentEventAsync`, returning a nullable [LiveEventContext](#liveeventcontext).
- **Depends on**: [LiveEventContext](#liveeventcontext), BCL `CancellationToken`/`Task`.
- **Concept introduced**: **Nullable-as-absence at a UI boundary.** The doc comment (`ILiveEventUIService.cs:9`) says the method returns `null` "when no published event exists (or the API is unavailable)." Rather than throwing when there is nothing live, the contract makes "no live event" a first-class, expected return that the ambient listener handles by staying dormant. [Rubric §1, SOLID] applies through the Dependency Inversion Principle: components depend on this abstraction, not on the HTTP-bound implementation, so tests can substitute a fake. [Rubric §18, UI Architecture] assesses how the UI layer separates data-resolution contracts from rendering; this interface is that boundary for the live layer.
- **Walkthrough**: `Task<LiveEventContext?> GetCurrentEventAsync(CancellationToken cancellationToken = default)` (`ILiveEventUIService.cs:14`). Single responsibility: hand back the live context or nothing.
- **Why it's built this way**: A one-method interface is the minimum surface the Happening Now page and the ambient `LiveEventListener` need, keeping the contract easy to fake and impossible to misuse.
- **Where it's used**: Implemented by [LiveEventService](#liveeventservice); consumed by the Happening Now page and the ambient live listener.

### ISessionLookupService
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:17` · Level 1 · interface

- **What it is**: The contract for fetching Conference session data for display enrichment inside Engagement pages, returning [SessionInfo](#sessioninfo) projections. It offers a whole-catalog read and a single-session read.
- **Depends on**: [SessionInfo](#sessioninfo), `SessionIdentifierType`, BCL `IReadOnlyDictionary`/`Task`.
- **Concept introduced**: **Two reads with an explicit efficiency contract.** The doc comment on `GetAllAsync` (`ISessionLookupService.cs:19`) is unusually prescriptive: it tells callers to use it "only when a page genuinely needs the whole set (e.g. the HappeningNow now-and-next computation)" and to prefer `GetByIdAsync` for single-session pages "instead of transferring the catalog to label one row." That guidance is the interface teaching its own performance discipline. [Rubric §12, Performance & Scalability] assesses avoiding whole-collection transfers to render one item; the split-method contract encodes the fast path directly in the type.
- **Walkthrough**: `GetAllAsync(CancellationToken)` (`ISessionLookupService.cs:24`) returns `IReadOnlyDictionary<SessionIdentifierType, SessionInfo>`, the full catalog keyed by id. `GetByIdAsync(SessionIdentifierType, CancellationToken)` (`ISessionLookupService.cs:28`) returns a single `SessionInfo?`, null when not found.
- **Why it's built this way**: Keeping both shapes on one interface lets pages pick the right cost for their need while the implementation shares the same `APIClient` and mapping.
- **Where it's used**: Implemented by [SessionLookupService](#sessionlookupservice); consumed by bookmark and Happening Now pages.

### SessionLiveUIService
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/SessionLiveUIService.cs:10` · Level 1 · class

- **What it is**: The Engagement-side implementation of the [ISessionLiveUIService](#isessionliveuiservice) extension point: it maps a session id to the route of that session's Live page, so the Conference session-detail page can light up a Live button only when the Engagement module is enabled.
- **Depends on**: [ISessionLiveUIService](#isessionliveuiservice) (the contract), [EngagementRoutePaths](group-22-engagement-module.md#engagementroutepaths) (the route builder), `SessionIdentifierType`.
- **Concept introduced**: **Cross-module UI extension point, resolved by module presence.** Conference must not hard-reference an Engagement route, that would couple the two modules. Instead Conference depends on the abstract `ISessionLiveUIService`, and Engagement registers this implementation when its module loads. When Engagement is disabled, no implementation is present and the Live button stays off. [Rubric §7, Microservices Readiness] assesses whether modules collaborate through boundaries that survive extraction into separate services; this is a UI-layer version of that discipline, a capability advertised only when its owner is running. [Rubric §1, SOLID] applies through Dependency Inversion: Conference depends on the interface, not the concrete route builder.
- **Walkthrough**: `GetSessionLivePath(SessionIdentifierType sessionId)` (`SessionLiveUIService.cs:13`) delegates straight to `EngagementRoutePaths.SessionLive(sessionId)`. The class is a `sealed` one-liner; all it does is put an Engagement route behind a Conference-visible contract.
- **Why it's built this way**: Routing knowledge for the Live page belongs to Engagement, so Engagement owns the string; Conference only needs the abstraction to conditionally render a link.
- **Where it's used**: Registered by the Engagement UI module; consumed by the Conference session-detail page to render its Live button.

### ILivePollUIService
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/ILivePollUIService.cs:10` · Level 2 · interface

- **What it is**: The full UI contract for the live-poll layer: read open polls (event-wide or per session) with tallies and the caller's own vote, cast/change a vote, and drive the organizer lifecycle (create, open, close, delete).
- **Depends on**: [LivePollResultsDTO](#livepollresultsdto), [LivePollDTO](#livepolldto), [CreateLivePollRequest](#createlivepollrequest) (all `MMCA.ADC.Engagement.Shared.LivePolls`), plus the `LivePollIdentifierType`/`LivePollOptionIdentifierType`/`EventIdentifierType`/`SessionIdentifierType` aliases.
- **Concept introduced**: **Two result shapes for two audiences.** Read-and-vote methods return [LivePollResultsDTO](#livepollresultsdto) (tallies + the caller's own vote), while the organizer manage view returns the richer [LivePollDTO](#livepolldto) via `GetEventPollsAsync` (`ILivePollUIService.cs:25`). The doc comment (`ILivePollUIService.cs:6`) warns that manage operations require the `engagement:live:manage` permission and that "the API enforces this regardless of what the UI renders", the UI contract does not pretend to be the security boundary. [Rubric §9, API & Contract Design] assesses fitting the returned shape to the consumer; two DTOs keep the attendee vote path lean and the organizer path complete. [Rubric §11, Security] applies through the explicit server-authoritative note.
- **Walkthrough**: Attendee/reader: `GetOpenPollsAsync` (`ILivePollUIService.cs:13`), `GetOpenSessionPollsAsync` (`:16`), `GetResultsAsync` (`:19`), `CastVoteAsync` (`:22`). Organizer lifecycle: `GetEventPollsAsync` (`:25`), `CreateAsync` (`:28`), `OpenAsync` (`:31`), `CloseAsync` (`:34`), `DeleteAsync` (`:37`, "must not be Open"). Every method takes a trailing `CancellationToken`.
- **Why it's built this way**: Grouping the whole poll lifecycle behind one interface lets the various poll pages (Happening Now, session Live, organizer manage) inject a single dependency and lets tests fake it wholesale.
- **Where it's used**: Implemented by [LivePollUIService](#livepolluiservice); consumed by the live-poll Blazor pages.

### ISessionQuestionUIService
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/ISessionQuestionUIService.cs:10` · Level 2 · interface

- **What it is**: The UI contract for the session Q&A layer: attendees read approved questions and submit their own, moderators work a queue (approve/dismiss/mark-answered), and anyone can upvote or remove an upvote.
- **Depends on**: [SessionQuestionDTO](#sessionquestiondto), [SubmitQuestionRequest](#submitquestionrequest) (`MMCA.ADC.Engagement.Shared.SessionQuestions`), the `SessionIdentifierType`/`SessionQuestionIdentifierType` aliases.
- **Concept introduced**: **Two views of the same queue.** `GetQuestionsAsync` (`ISessionQuestionUIService.cs:13`) returns the attendee view (every approved question plus the caller's own pending/dismissed ones), while `GetModerationQueueAsync` (`:16`) returns all statuses with Pending first. The same doc-comment discipline appears (`ISessionQuestionUIService.cs:6`): moderation needs organizer/admin or an assigned-speaker claim, and "the API enforces this regardless of what the UI renders (BR-236)." [Rubric §24, Forms/Validation/UX Safety] assesses how submission and moderation flows are shaped; the split read methods keep an attendee from seeing another attendee's un-approved question while giving moderators the full picture. [Rubric §11, Security] applies through the server-authoritative moderation note.
- **Walkthrough**: Reads: `GetQuestionsAsync` (`:13`), `GetModerationQueueAsync` (`:16`). Write/submit: `SubmitAsync` (`:19`, starts at the event's moderation default per BR-233). Moderation: `ApproveAsync` (`:22`), `DismissAsync` (`:25`), `MarkAnsweredAsync` (`:28`). Upvoting: `UpvoteAsync` (`:31`) and `RemoveUpvoteAsync` (`:34`), each returning the fresh upvote count as an `int`.
- **Why it's built this way**: One interface spans attendee, moderator, and voter roles so a session Live page injects a single service; the API remains the enforcer, so the contract can expose the moderation methods without granting rights.
- **Where it's used**: Implemented by [SessionQuestionUIService](#sessionquestionuiservice); consumed by the session Live page and the presenter/moderation view.

### LivePollUIService
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/LivePollUIService.cs:12` · Level 3 · class

- **What it is**: The HTTP implementation of [ILivePollUIService](#ilivepolluiservice), calling the Gateway's `/livepolls` routes with an authenticated client and a retry pipeline.
- **Depends on**: [AuthenticatedServiceBase](group-15-common-ui-framework.md#authenticatedservicebase) (base class providing `CreateAuthenticatedClientAsync`, `RetryPolicy`, and `ServiceExceptionHelper`), [ILivePollUIService](#ilivepolluiservice), the poll DTOs/request records, `IHttpClientFactory`, and `ITokenStorageService` (both `MMCA.Common.UI.Services`).
- **Concept introduced**: **The authenticated-client + retry + domain-exception-rethrow triad.** This is the standard MMCA UI HTTP shape, taught once in [Group 15](group-15-common-ui-framework.md#authenticatedservicebase); each call acquires a bearer-token-bearing client via `CreateAuthenticatedClientAsync` (`LivePollUIService.cs:23`), wraps the send in `RetryPolicy.ExecuteAsync` (`:26`), and on a non-success status calls `ServiceExceptionHelper.ThrowIfDomainExceptionAsync` (`:30`) so an RFC 9457 Problem Details body from the API surfaces as a typed domain exception the UI can show, before falling through to `EnsureSuccessStatusCode`. [Rubric §10, Cross-Cutting] assesses whether resilience and error translation are applied uniformly; inheriting the base means every method here gets the same behavior for free. [Rubric §26, Front-End Security] applies because every call flows through the token-bearing client.
- **Walkthrough**: `Endpoint = "livepolls"` (`:16`). GET-and-deserialize methods (`GetOpenPollsAsync` `:19` with `?eventId=`, `GetOpenSessionPollsAsync` `:39` with `?sessionId=`, `GetResultsAsync` `:59`, `GetEventPollsAsync` `:97`) each null-coalesce a collection to `[]` (`:35`, `:55`, `:113`) so callers never see null lists. `CastVoteAsync` (`:77`) POSTs a `CastVoteRequest { OptionId = optionId }` (`:84`) to `/{pollId}/votes`. `CreateAsync` (`:117`) POSTs the [CreateLivePollRequest](#createlivepollrequest). The lifecycle verbs `OpenAsync`/`CloseAsync` (`:135`, `:139`) both delegate to the private `PostLifecycleAsync(pollId, action, …)` helper (`:156`) which POSTs to `/{pollId}/{action}` with no body; `DeleteAsync` (`:143`) DELETEs `/{pollId}`.
- **Why it's built this way**: Folding the repeated GET/POST/error-check ceremony into the shared base (and a private lifecycle helper for the two identical verb calls) keeps each method to its URL and payload, so the class reads as a thin, faithful map of the interface onto REST routes.
- **Where it's used**: Registered as the `ILivePollUIService` in the Engagement UI module; injected into the live-poll pages.

### SessionLookupService
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/SessionLookupService.cs:11` · Level 3 · class

- **What it is**: The implementation of [ISessionLookupService](#isessionlookupservice): it fetches sessions from the Conference API and builds a session-keyed lookup of [SessionInfo](#sessioninfo) projections for display enrichment.
- **Depends on**: [ISessionLookupService](#isessionlookupservice), [SessionDTO](group-17-conference-domain.md#sessiondto) (Conference shared), [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) (the paged wrapper), `IHttpClientFactory`. Note it uses the plain `"APIClient"` client (`SessionLookupService.cs:17`), not the authenticated base, because session listing is public/output-cached.
- **Concept introduced**: **Single-page catalog transfer with a documented cap.** `GetAllAsync` fetches `sessions?includeFKs=false&includeChildren=false` and the inline comment (`SessionLookupService.cs:19`) explains the base `/sessions` endpoint "always serves a single page capped at MaxPageSize (500), which comfortably covers a conference's session catalog", so no pagination loop is needed. This documents why a whole-catalog fetch is safe here, complementing the efficiency contract that [ISessionLookupService](#isessionlookupservice) declares. [Rubric §12, Performance & Scalability] assesses transfer sizing; the projection to five-field [SessionInfo](#sessioninfo) and the `includeFKs=false&includeChildren=false` query trim the payload.
- **Walkthrough**: `GetAllAsync` (`:14`) deserializes `PagedCollectionResult<SessionDTO>`, defaults `wrapper?.Items` to `[]` (`:25`), then loops building `SessionInfo` entries keyed by `session.Id` (`:30`). `GetByIdAsync` (`:38`) issues `sessions/{sessionId}` with an invariant-culture interpolated URI (`:45`), returns null on a `NotFound` status (`:48`), otherwise maps the single `SessionDTO` into a `SessionInfo` (`:56`).
- **Why it's built this way**: Building a dictionary once lets a page label many bookmark rows with O(1) lookups, while the per-id method serves single-session pages without paying the catalog transfer, exactly the fast/slow split the interface prescribes.
- **Where it's used**: Registered as `ISessionLookupService`; consumed by bookmark ("My Schedule") and Happening Now pages.

### SessionQuestionUIService
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/SessionQuestionUIService.cs:12` · Level 3 · class

- **What it is**: The HTTP implementation of [ISessionQuestionUIService](#isessionquestionuiservice), calling the Gateway's `/sessionquestions` routes with the same authenticated-client + retry pattern as [LivePollUIService](#livepolluiservice).
- **Depends on**: [AuthenticatedServiceBase](group-15-common-ui-framework.md#authenticatedservicebase), [ISessionQuestionUIService](#isessionquestionuiservice), [SessionQuestionDTO](#sessionquestiondto)/[SubmitQuestionRequest](#submitquestionrequest), `IHttpClientFactory`, `ITokenStorageService`.
- **Concept introduced**: This is a sibling of [LivePollUIService](#livepolluiservice); it reuses the same triad (authenticated client → `RetryPolicy.ExecuteAsync` → `ServiceExceptionHelper.ThrowIfDomainExceptionAsync` → `EnsureSuccessStatusCode`) introduced there, so the concept is not re-taught. What differs is the count-returning upvote endpoints and a shared moderation helper. [Rubric §10, Cross-Cutting] and [Rubric §26, Front-End Security] apply for the same inherited-resilience and token-flow reasons as its poll sibling.
- **Walkthrough**: `Endpoint = "sessionquestions"` (`:16`). Reads: `GetQuestionsAsync` (`:19`, `?sessionId=`) and `GetModerationQueueAsync` (`:39`, `/moderation?sessionId=`), each defaulting to `[]`. `SubmitAsync` (`:59`) POSTs the [SubmitQuestionRequest](#submitquestionrequest). The three moderation verbs `ApproveAsync`/`DismissAsync`/`MarkAnsweredAsync` (`:77`, `:81`, `:85`) all delegate to the private `PostModerationAsync(id, action, …)` helper (`:110`) that POSTs `/{id}/{action}` with no body. `UpvoteAsync` (`:89`) POSTs `/{id}/upvotes` and `RemoveUpvoteAsync` (`:100`) DELETEs it; both route through the private `ReadCountAsync` helper (`:123`) which, after the same domain-exception check, deserializes the fresh count as an `int`.
- **Why it's built this way**: Two private helpers (`PostModerationAsync`, `ReadCountAsync`) collapse the repeated verb-call and count-read ceremony, leaving each public method to state only its route and payload.
- **Where it's used**: Registered as `ISessionQuestionUIService`; consumed by the session Live page and the presenter/moderation view.

### CreateLivePollRequestValidator
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollRequestValidator.cs:10` · Level 5 · class

- **What it is**: The FluentValidation validator for the [CreateLivePollRequest](#createlivepollrequest) body: it checks the event id, question text, and the option list before the handler runs (BR-220).
- **Depends on**: `AbstractValidator<CreateLivePollRequest>` (FluentValidation), [LivePollInvariants](#livepollinvariants) (the domain's shared limits), the `EventIdentifierType` alias.
- **Concept introduced**: **Input validation reusing domain constants, not magic numbers.** Every length/count bound comes from `LivePollInvariants` (`QuestionMaxLength`, `MinOptions`, `MaxOptions`, `OptionTextMaxLength`), so the edge validator and the aggregate's own `Create` guard agree by construction rather than by two copies of the same number. [Rubric §24, Forms/Validation/UX Safety] assesses layered validation with actionable messages; each rule carries both a human `WithMessage` and a machine `WithErrorCode` (e.g. `"LivePoll.Question.Required"`) so the UI can localize or branch on the code. [Rubric §14, Testability] applies because a pure validator is trivially unit-tested.
- **Walkthrough**: `EventId` must not equal `default(EventIdentifierType)` (`CreateLivePollRequestValidator.cs:14`). `Question` is `NotEmpty` and `MaximumLength(LivePollInvariants.QuestionMaxLength)` (`:19`). `Options` is `NotNull` and must have a count between `LivePollInvariants.MinOptions` and `MaxOptions` via a `Must` predicate (`:27`). `RuleForEach(x => x.Options)` (`:35`) then applies `NotEmpty` + `MaximumLength(LivePollInvariants.OptionTextMaxLength)` to each option string. Every rule pairs a message with an error code.
- **Why it's built this way**: Validating shape at the edge lets the handler assume a well-formed request and reserve its logic for authorization and cross-service checks; sourcing bounds from `LivePollInvariants` keeps edge and domain in lockstep.
- **Where it's used**: Runs in the Validating decorator (see [Group 05](group-05-cqrs-pipeline.md)); also invoked directly by [CreateLivePollCommandValidator](#createlivepollcommandvalidator) via `SetValidator`.

### CreateLivePollCommandValidator
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollCommandValidator.cs:9` · Level 6 · class

- **What it is**: The validator that the pipeline actually resolves for [CreateLivePollCommand](#createlivepollcommand): it asserts the command carries a non-null `Request` and delegates the request's field rules to [CreateLivePollRequestValidator](#createlivepollrequestvalidator) (BR-220).
- **Depends on**: `AbstractValidator<CreateLivePollCommand>` (FluentValidation), [CreateLivePollRequestValidator](#createlivepollrequestvalidator).
- **Concept introduced**: **Composed validators via `SetValidator`.** The command validator does not restate the body rules; it validates the wrapper concern (a `Request` must be present) and then `SetValidator(new CreateLivePollRequestValidator())` (`CreateLivePollCommandValidator.cs:16`) reuses the request validator for the nested shape. This is the FluentValidation composition idiom, and it is why the pipeline (which validates the command type) still enforces the body rules. [Rubric §24, Forms/Validation/UX Safety] and [Rubric §15, Best Practices & Code Quality] apply: one source of truth for body rules, composed rather than duplicated.
- **Walkthrough**: The constructor is a single expression-bodied `RuleFor(x => x.Request)` chain: `NotNull` with message and code `"LivePoll.Request.Required"` (`CreateLivePollCommandValidator.cs:12`), then `SetValidator` delegating to the request validator (`:16`).
- **Why it's built this way**: The Validating decorator resolves a validator for the command, so a thin command validator is needed to bridge to the reusable request validator without copying its rules.
- **Where it's used**: Auto-discovered by Scrutor and applied by the Validating decorator before [CreateLivePollHandler](#createlivepollhandler) runs.

### LiveEventService
> MMCA.ADC.Engagement.UI · `MMCA.ADC.Engagement.UI.Services` · `MMCA.ADC.Engagement.UI/Services/LiveEventService.cs:14` · Level 7 · class

- **What it is**: The implementation of [ILiveEventUIService](#iliveeventuiservice): it fetches the currently-live-or-next published event from the Conference API and computes its live window into a [LiveEventContext](#liveeventcontext), degrading to `null` when nothing is live or the API is down.
- **Depends on**: [ILiveEventUIService](#iliveeventuiservice), [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) (the shared selection + window math), [EventDTO](group-17-conference-domain.md#eventdto) and [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt), [LiveEventContext](#liveeventcontext), `IHttpClientFactory`.
- **Concept introduced**: **Fail-soft resolution: absence and failure both become `null`.** The method fetches published events, delegates selection to `CurrentEventSelector.SelectCurrentOrNext` (`LiveEventService.cs:27`) over only the published ones (`e => e.IsPublished`, `:29`), and returns `null` (`:34`) when there is no current-or-next event; a thrown `HttpRequestException` is caught (`:48`) and also returns `null` so "the live layer stays dormant" (`:50`). Reusing `CurrentEventSelector` for both the selection and the window (`GetLiveWindowUtc`, `:38`) is what lets the UI's [LiveEventContext](#liveeventcontext) mirror the backend window exactly. [Rubric §29, Resilience & Business Continuity] assesses graceful degradation under a dependency outage; here an unavailable Conference API turns off the live layer instead of erroring a page. [Rubric §12, Performance & Scalability] applies because the same public, output-cached events read backs this call.
- **Walkthrough**: `GetCurrentEventAsync` (`:17`) uses the plain `"APIClient"` (`:21`), fetches `events?includeFKs=false&includeChildren=false` as `PagedCollectionResult<EventDTO>` (`:23`), filters to published, and calls `CurrentEventSelector.SelectCurrentOrNext` passing accessors for start/end/time-zone plus `DateTime.UtcNow` (`:27`). On a hit it computes `(startUtc, endUtc)` via `GetLiveWindowUtc` (`:38`) and constructs the `LiveEventContext` (`:41`) from the event id, name, time zone, and window.
- **Why it's built this way**: Delegating both "which event" and "what window" to `CurrentEventSelector` means the UI and the API share one implementation of the conference-day math, and the double `null` path keeps the ambient live listener silent whenever there is nothing to show.
- **Where it's used**: Registered as `ILiveEventUIService`; consumed by the Happening Now page and the ambient live listener.

### CreateLivePollHandler
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create` · `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollHandler.cs:20` · Level 8 · class

- **What it is**: The command handler that creates a live poll as Draft, enforcing the poll business rules (BR-220 shape, BR-221 draft state, BR-222 published-event, BR-236 authoring rights) before persisting a [LivePoll](#livepoll) aggregate and returning its [LivePollDTO](#livepolldto).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (repository + save), [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) (the Conference cross-module gRPC lookup for session/event live info), [LivePoll](#livepoll) (the aggregate) and its [LivePollAuthorization](#livepollauthorization) helper, [LivePollDTOMapper](#livepolldtomapper), [Result](group-01-result-error-handling.md#result)/[Error](group-01-result-error-handling.md#error), and [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult). It is a `sealed partial class` for the source-generated logger.
- **Concept introduced**: **Branching authorization across a service boundary before touching the aggregate.** The handler splits on whether the request is session-scoped (`request.SessionId is { } sessionId`, `CreateLivePollHandler.cs:34`): a session poll fetches `GetSessionLiveInfoAsync` over gRPC (`:38`), guards that the session belongs to the given event (`:45`, skipping the check when a disabled-stub returns a default event id, `:44`), then calls `LivePollAuthorization.EnsureCanManage` with the session info so assigned speakers are allowed (`:54`); an event-wide poll instead requires organizer/admin via the same helper with `sessionInfo: null` (`:64`) and then checks the event is published via `GetEventLiveInfoAsync` (`:70`). Only after rights and publish-state pass does it call `LivePoll.Create` (`:86`). [Rubric §6, CQRS & Event-Driven] assesses the command-handler shape; [Rubric §7, Microservices Readiness] applies because authorization data is pulled from Conference through a resilient gRPC service interface (with an explicit disabled-stub fallback); [Rubric §11, Security] applies because rights are enforced server-side using the token-derived claims carried on the command.
- **Walkthrough**: The constructor injects the four collaborators (`:20`). `HandleAsync` (`:27`) resolves `isPublished` down either branch, then rejects an unpublished target with `Error.Invariant("LivePoll.EventNotPublished", …)` (`:79`). It builds the aggregate via `LivePoll.Create(EventId, SessionId, Question, Options)` (`:86`), returning any factory failure. On success it gets the typed repository `unitOfWork.GetRepository<LivePoll, LivePollIdentifierType>()` (`:91`), `AddAsync`es the poll (`:92`), and `SaveChangesAsync(…).ConfigureAwait(false)` (`:94`). It then emits the structured log via the generated `LogLivePollCreated` (`:96`, declared `[LoggerMessage]` at `:101`) and returns `Result.Success(dtoMapper.MapToDTO(poll))` (`:98`). Each early guard returns `Result.Failure<LivePollDTO>` carrying the upstream errors.
- **Why it's built this way**: Keeping authorization and publish-state checks in the handler (not the aggregate) lets the domain `LivePoll.Create` stay purely about poll shape, while cross-service facts come from the Conference boundary; the source-generated `[LoggerMessage]` gives allocation-free structured logging (Rubric §13, Observability).
- **Where it's used**: Dispatched for `CreateLivePollCommand` through the CQRS decorator pipeline; reached from the `/livepolls` POST that [LivePollUIService](#livepolluiservice)'s `CreateAsync` calls.

### ModerateQuestionCommand
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Moderate` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Moderate/ModerateQuestionCommand.cs:14` · Level 1 · record

- **What it is**: the CQRS command that carries one moderation action (approve / dismiss / mark-answered) against a single session question, together with the caller's identity as resolved at the API edge.
- **Depends on**: [`ModerationAction`](#moderationaction) (the action enum, same group) and the module identifier aliases `SessionQuestionIdentifierType` / `SpeakerIdentifierType` (Engagement/Conference `Shared`); dispatched to [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult).
- **Concept introduced, identity-from-token commands.** `[Rubric §11, Security]` assesses whether authorization inputs come from a trusted source rather than the request body; here the command records `CallerSpeakerId` and `CallerIsOrganizer` (`ModerateQuestionCommand.cs:17-18`) which the controller binds from JWT claims, never from client-supplied JSON, so an attacker cannot claim organizer rights by editing the payload. `[Rubric §6, CQRS & Event-Driven]` is the plain command-as-record shape.
- **Walkthrough**: a `sealed record` with four positional members (`ModerateQuestionCommand.cs:14-18`): `QuestionId` (which question), `Action` (the [`ModerationAction`](#moderationaction) to apply), `CallerSpeakerId` (nullable `SpeakerIdentifierType?`, present only for speakers), and `CallerIsOrganizer` (a `bool` set when the caller holds the Organizer or Admin role). The last two are the BR-236 rights inputs the handler checks.
- **Why it's built this way**: keeping caller identity *in the command* (rather than reaching into `HttpContext` from the handler) keeps the Application layer host-agnostic and unit-testable, and makes the trust boundary explicit: the API edge is the only place that reads claims.
- **Where it's used**: constructed by [`SessionQuestionsController`](#sessionquestionscontroller)'s private `ModerateAsync` (`SessionQuestionsController.cs:171`) and handled by [`ModerateQuestionHandler`](#moderatequestionhandler).

### LivePollChanged
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.LivePolls.DomainEvents` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/DomainEvents/LivePollChanged.cs:17` · Level 2 · record

- **What it is**: the single domain event a [`LivePoll`](#livepoll) raises for its whole lifecycle: created, opened, closed, or soft-deleted.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) (base), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) (the change classifier), [`LivePollStatus`](#livepollstatus) (the lifecycle status), and the `LivePollIdentifierType` / `EventIdentifierType` aliases.
- **Concept introduced, one event carrying a state discriminator (BR-60).** `[Rubric §6, CQRS & Event-Driven]` assesses whether events carry enough context to be acted on without a re-read. Rather than four separate `Created` / `Opened` / `Closed` / `Deleted` events, this codebase uses **one** event whose [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) says *what kind* of change happened and whose [`LivePollStatus`](#livepollstatus) says the *resulting* lifecycle state (doc comment, `LivePollChanged.cs:7-11`). A consumer switches on those two fields. This BR-60 convention is shared by all four live-layer events below, so learn it once here.
- **Walkthrough**: a `sealed record class` with four positional members deriving from [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) (`LivePollChanged.cs:17-22`): `State`, `PollId`, `EventId`, `Status`. There is no behavior, an event is an immutable fact.
- **Why it's built this way**: the base carries the event id and timestamp; collapsing the transition matrix into one typed record keeps the outbox schema and the handler set small while still letting handlers distinguish an open from a close ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) for the outbox that drains these; [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) for the live-channel transport that rebroadcasts them).
- **Where it's used**: raised inside [`LivePoll`](#livepoll)'s `Create` / `Open` / `Close` / `Delete` (`LivePoll.cs:94,131,154,232`); drained by the outbox and rebroadcast onto the SignalR live channel.

### LivePollVoteChanged
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.LivePolls.DomainEvents` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/DomainEvents/LivePollVoteChanged.cs:15` · Level 2 · record

- **What it is**: the single domain event a [`LivePollVote`](#livepollvote) raises when a vote is cast, changed to another option, or soft-deleted.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), and the `LivePollVoteIdentifierType` / `LivePollIdentifierType` / `LivePollOptionIdentifierType` / `UserIdentifierType` aliases.
- **Concept reinforced, BR-60 single-event pattern** (introduced at [`LivePollChanged`](#livepollchanged)). `[Rubric §6, CQRS & Event-Driven]`. Here the payload additionally carries the `OptionId` chosen after the change, so a downstream tally re-computation knows which option moved.
- **Walkthrough**: a `sealed record class : BaseDomainEvent` with five positional members (`LivePollVoteChanged.cs:15-21`): `State`, `VoteId`, `PollId`, `OptionId`, `UserId`.
- **Why it's built this way**: votes are high-frequency, so the event stays a thin id-only fact (no denormalized counts); consumers that need tallies recompute them via [`LivePollResultsBuilder`](#livepollresultsbuilder).
- **Where it's used**: raised inside [`LivePollVote`](#livepollvote)'s `Create` / `ChangeOption` / `Reactivate` / `Delete` (`LivePollVote.cs:66,85,108,124`).

### SessionQuestionChanged
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.SessionQuestions.DomainEvents` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/SessionQuestions/DomainEvents/SessionQuestionChanged.cs:17` · Level 2 · record

- **What it is**: the single domain event a [`SessionQuestion`](#sessionquestion) raises when it is submitted, moderated, or soft-deleted.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), [`QuestionStatus`](#questionstatus), and the `SessionQuestionIdentifierType` / `SessionIdentifierType` aliases.
- **Concept reinforced, BR-60 single-event pattern** (see [`LivePollChanged`](#livepollchanged)). `[Rubric §6, CQRS & Event-Driven]`. The Q&A analogue of [`LivePollChanged`](#livepollchanged): [`QuestionStatus`](#questionstatus) rides along so a handler can tell a Submitted question from an Approved / Dismissed / Answered one (doc comment, `SessionQuestionChanged.cs:7-11`).
- **Walkthrough**: a `sealed record class : BaseDomainEvent` with four positional members (`SessionQuestionChanged.cs:17-22`): `State`, `QuestionId`, `SessionId`, `Status`.
- **Why it's built this way**: identical rationale to [`LivePollChanged`](#livepollchanged), a compact lifecycle fact instead of five per-transition event types.
- **Where it's used**: raised inside the [`SessionQuestion`](#sessionquestion) aggregate on submit and each moderation transition.

### SessionQuestionUpvoteChanged
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.SessionQuestions.DomainEvents` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/SessionQuestions/DomainEvents/SessionQuestionUpvoteChanged.cs:14` · Level 2 · record

- **What it is**: the single domain event a [`SessionQuestionUpvote`](#sessionquestionupvote) raises when an upvote is cast, reactivated, or removed (soft-deleted).
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), and the `SessionQuestionUpvoteIdentifierType` / `SessionQuestionIdentifierType` / `UserIdentifierType` aliases.
- **Concept reinforced, BR-60 single-event pattern** (see [`LivePollChanged`](#livepollchanged)). `[Rubric §6, CQRS & Event-Driven]`. The thinnest of the four: an upvote has only two meaningful states, so the doc comment notes `Added` covers cast/reactivated and `Deleted` covers un-upvoted (`SessionQuestionUpvoteChanged.cs:10`).
- **Walkthrough**: a `sealed record class : BaseDomainEvent` with four positional members (`SessionQuestionUpvoteChanged.cs:14-19`): `State`, `UpvoteId`, `QuestionId`, `UserId`. No status field, upvotes have no lifecycle beyond active/removed.
- **Why it's built this way**: same BR-60 economy as its siblings; because there is no status enum, the `DomainEntityState` alone fully describes the change.
- **Where it's used**: raised inside the [`SessionQuestionUpvote`](#sessionquestionupvote) aggregate on cast / reactivate / remove.

### LivePollAuthorization
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.Services` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollAuthorization.cs:12` · Level 3 · class (static, internal)

- **What it is**: the one shared rights check for the whole live layer: decides whether a caller may manage (author, open, close, moderate) content in a given scope.
- **Depends on**: [`SessionLiveInfo`](group-17-conference-domain.md#sessionliveinfo) (the Conference-owned session snapshot it inspects), [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error).
- **Concept introduced, the BR-236 rights shape as one authorization gate.** `[Rubric §11, Security]` assesses whether authorization is centralized and consistent rather than re-implemented per endpoint. Every live-layer mutation (poll create/open/close and question moderate) routes its rights decision through this single method, so the rule "organizers/admins do everything; a speaker manages only content scoped to a session they are assigned to" lives in exactly one place. `[Rubric §1, SOLID]` (single responsibility: authorization is not smeared across handlers). `[Rubric §7, Microservices Readiness]`: the speaker-assignment fact comes from the Conference service via [`SessionLiveInfo.SpeakerIds`](group-17-conference-domain.md#sessionliveinfo), so this check consumes a cross-service snapshot rather than reaching into another module's tables.
- **Walkthrough**: one static method `EnsureCanManage(bool callerIsOrganizer, SpeakerIdentifierType? callerSpeakerId, SessionLiveInfo? sessionInfo, string source)` (`LivePollAuthorization.cs:22-44`). Order matters: an organizer/admin short-circuits to `Result.Success()` (`:28-31`); otherwise, if a session scope is supplied *and* the caller has a speaker id *and* that id is in `sessionInfo.SpeakerIds` (`:33-35`), success; anything else returns `Error.Forbidden("LivePoll.NotAuthorized", …)` (`:40-43`). Passing `sessionInfo` as `null` (event-wide scope) means only organizers/admins pass, exactly the intent for event-wide polls.
- **Why it's built this way**: a pure static helper keeps the rule dependency-free and trivially unit-testable, and the explicit `source` parameter threads the calling handler name into the error for stack-free tracing (the codebase's invariant-error convention).
- **Where it's used**: called by [`ModerateQuestionHandler`](#moderatequestionhandler) (`ModerateQuestionHandler.cs:49`) and, per its doc comment, by the poll create/open/close handlers (the BR-236 shape referenced from [`LivePollsController`](#livepollscontroller)).

### LivePollInvariants
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/LivePollInvariants.cs:9` · Level 4 · class (static)

- **What it is**: the invariant helper for [`LivePoll`](#livepoll) and [`LivePollOption`](#livepolloption): it owns the poll's field-length and option-count constants and the `Result`-returning checks that guard them (BR-220).
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (for the shared `EnsureIdIsNotDefault`), [`Result`](group-01-result-error-handling.md#result), [`Error`](group-01-result-error-handling.md#error).
- **Concept reinforced, the shared-constants invariant class** (introduced by `AddressInvariants` in [Group 02](group-02-domain-building-blocks.md#addressinvariants)). `[Rubric §16, Maintainability & Evolvability]` (one place to change a constraint) and `[Rubric §4, DDD]` (invariants owned by the domain). The four public constants, `QuestionMaxLength = 200`, `OptionTextMaxLength = 100`, `MinOptions = 2`, `MaxOptions = 10` (`LivePollInvariants.cs:12-21`), are the single source of truth reused by the factory checks here and by the EF configuration and any validator.
- **Walkthrough**: five static check methods, each returning [`Result`](group-01-result-error-handling.md#result). `EnsureEventIdIsValid` (`:23`) delegates to [`CommonInvariants.EnsureIdIsNotDefault`](group-02-domain-building-blocks.md#commoninvariants); `EnsureQuestionIsValid` (`:26`) rejects empty or over-length questions; `EnsureOptionTextIsValid` (`:35`) does the same per option; `EnsureOptionCountIsValid` (`:44`) enforces the 2-10 range with a C# range pattern (`count is < MinOptions or > MaxOptions`); `EnsureOptionTextsAreUnique` (`:53`) groups the texts case-insensitively (`StringComparer.OrdinalIgnoreCase`) and fails if any group has a duplicate. Each failure carries a stable `code` (e.g. `"LivePoll.Options.Duplicate"`) and the `source` for tracing.
- **Why it's built this way**: separating the constants and checks from the entity lets EF configuration and validators reference `LivePollInvariants.QuestionMaxLength` without depending on the [`LivePoll`](#livepoll) type itself, keeping the constraint values in lockstep across layers.
- **Where it's used**: combined via `Result.Combine` inside [`LivePoll.Create`](#livepoll) (`LivePoll.cs:72-76`) and [`LivePollOption.Create`](#livepolloption) (`LivePollOption.cs:45`).

### LivePollVoteInvariants
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/LivePollVoteInvariants.cs:9` · Level 4 · class (static)

- **What it is**: the invariant helper for [`LivePollVote`](#livepollvote): three id-presence checks.
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants), [`Result`](group-01-result-error-handling.md#result).
- **Concept reinforced, the shared-constants invariant class** (see [`LivePollInvariants`](#livepollinvariants)). `[Rubric §4, DDD]`. This is the compact sibling: a vote has no free-text fields, so all three methods, `EnsurePollIdIsValid` (`:11`), `EnsureOptionIdIsValid` (`:14`), `EnsureUserIdIsValid` (`:17`), just delegate to [`CommonInvariants.EnsureIdIsNotDefault`](group-02-domain-building-blocks.md#commoninvariants) with a vote-specific error code.
- **Walkthrough**: three one-line static methods returning [`Result`](group-01-result-error-handling.md#result); each rejects a default (zero/empty) identifier with a code like `"LivePollVote.OptionId.Invalid"`.
- **Why it's built this way**: even a trivial guard is expressed as a named invariant so the factory reads as a `Result.Combine` of intent, and every id-presence failure produces a consistent, traceable error.
- **Where it's used**: combined inside [`LivePollVote.Create`](#livepollvote) (`LivePollVote.cs:54-57`); `EnsureOptionIdIsValid` is also called on its own by `ChangeOption` and `Reactivate` (`LivePollVote.cs:79,99`).

### SessionQuestionsController
> MMCA.ADC.Engagement.API · `MMCA.ADC.Engagement.API.Controllers` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/Controllers/SessionQuestionsController.cs:35` · Level 4 · class

- **What it is**: the REST controller for the conference-day session Q&A layer: submit a question, read the attendee/moderation views, run the moderation transitions, and toggle upvotes.
- **Depends on**: the five Q&A handlers via [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) / [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (claims), [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (the `HandleFailure` Result-to-HTTP bridge), and [`ModerateQuestionCommand`](#moderatequestioncommand).
- **Concept introduced, identity bound at the edge and rights enforced in the handler.** `[Rubric §9, API & Contract Design]` (thin controllers over the handler pipeline) and `[Rubric §11, Security]` (trust boundary at the transport edge). The class-level attributes set the contract: `[ApiController]`, `[Route("[controller]")]`, `[ApiVersion("1.0")]`, `[FeatureGate(EngagementFeatures.SessionQA)]` (the whole controller is dark when the flag is off), and `[Authorize(Policy = AuthorizationPolicies.RequireAuthenticated)]` (`SessionQuestionsController.cs:30-34`). Every action is thin: bind identity from claims, build a command/query, call the handler, and map the [`Result`](group-01-result-error-handling.md#result) to HTTP via `HandleFailure` or a success status.
- **Walkthrough**
  - Constructor injects five handlers plus [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (`:35-41`).
  - `SubmitAsync` (`:48`): reads `currentUserService.UserId`, refuses with `Error.Forbidden` if absent, else builds `SubmitQuestionCommand` and returns `201 Created` at `/sessionquestions/{id}`.
  - `GetSessionQuestionsAsync` (`:73`): the attendee view (approved questions plus the caller's own pending/dismissed), keyed on `sessionId` and the caller's user id.
  - `GetModerationQueueAsync` (`:100`): the all-statuses moderator view; passes `GetCallerSpeakerId()` and `IsCallerOrganizer()` so rights are checked in the handler.
  - `ApproveAsync` / `DismissAsync` / `MarkAnsweredAsync` (`:119,130,141`): three thin verbs that all funnel into the private `ModerateAsync(id, action, ct)` (`:166`), which builds a [`ModerateQuestionCommand`](#moderatequestioncommand) and returns `204 No Content`.
  - `UpvoteAsync` / `RemoveUpvoteAsync` (`:151,161`): the POST/DELETE pair on `{id}/upvotes`, both funnel into private `ToggleUpvoteAsync(id, upvote, ct)` (`:179`) and return the fresh count as `200 OK`.
  - The two claim helpers are the load-bearing security detail: `GetCallerSpeakerId()` (`:200`) reads the `speaker_id` claim (mapping `default` to `null`), and `IsCallerOrganizer()` (`:207`) is `currentUserService.IsInRole(Organizer) || IsInRole(Admin)`. Both read the token, never the request body.
- **Why it's built this way**: pushing rights into the handler (via [`LivePollAuthorization`](#livepollauthorization)) keeps the controller a pure transport adapter and means the same rule protects the REST path and any future transport; `[FeatureGate]` lets the entire live Q&A surface ship dark and be enabled per environment.
- **Where it's used**: mounted by the Engagement service host; reached by clients through the YARP Gateway ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).

### LivePollVote
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/LivePollVote.cs:20` · Level 5 · class (sealed aggregate root)

- **What it is**: the aggregate root for one user's vote on a live poll. Deliberately a **separate** aggregate from [`LivePoll`](#livepoll), not a child of it.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (base), [`LivePollVoteChanged`](#livepollvotechanged), [`LivePollVoteInvariants`](#livepollvoteinvariants), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced, splitting a high-frequency child into its own aggregate for write scalability.** `[Rubric §12, Performance & Scalability]` (assesses contention and change-tracker load) and `[Rubric §4, DDD]` (aggregate boundaries chosen for consistency, not convenience). The doc comment (`LivePollVote.cs:10-18`) states the reasoning explicitly: votes are high-frequency attendee writes, so folding them into the [`LivePoll`](#livepoll) aggregate would bloat the change tracker and make every vote contend on the poll row. Instead each vote is its own root, and "one active vote per (poll, user)" is enforced by a **filtered unique index** at the database (BR-225), not by loading sibling votes into memory. `[Rubric §8, Data Architecture]`: the reactivation-over-reinsert pattern (below) keeps that filtered index from accumulating soft-deleted duplicates.
- **Walkthrough**
  - Marked `[IdValueGenerated]` (`:19`), so the database assigns the identity; the factory sets `Id = default` and lets SQL Server fill it.
  - Three private-set FK properties: `LivePollId`, `OptionId`, `UserId` (`:23-29`), plus the EF parameterless ctor (`:32`) and a private field ctor (`:34`).
  - `Create(livePollId, optionId, userId)` (`:49`): combines the three [`LivePollVoteInvariants`](#livepollvoteinvariants) id checks, constructs the vote with `Id = default`, and raises [`LivePollVoteChanged`](#livepollvotechanged) with `DomainEntityState.Added` (`:66`).
  - `ChangeOption(optionId)` (`:77`): the re-vote path while a poll is open (BR-225), validates the new option, reassigns `OptionId`, and raises the event with `DomainEntityState.Updated`.
  - `Reactivate(optionId)` (`:97`): the BR-135 pattern, validates the option, calls the base `Undelete()`, and on success reassigns the option and raises `Added`, so a user who un-votes then re-votes reuses the same soft-deleted row instead of inserting a new one.
  - `Delete()` (`:119`): overrides the base soft-delete and raises [`LivePollVoteChanged`](#livepollvotechanged) with `DomainEntityState.Deleted`; the row stays, `IsDeleted` flips.
- **Why it's built this way**: separating the write-hot vote from the read-hot poll is the central scalability decision of the poll subsystem; combined with the filtered unique index and reactivation, a poll can absorb a burst of conference-day votes without serializing them on one row.
- **Where it's used**: written by the cast-vote handler; tallied (read-side) by [`LivePollResultsBuilder`](#livepollresultsbuilder) via a grouped `COUNT`.

### LivePoll
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/LivePoll.cs:18` · Level 6 · class (sealed aggregate root)

- **What it is**: the aggregate root for a live poll: a question with 2-10 authored options and a strict `Draft -> Open -> Closed` lifecycle, scoped either to a whole event or to a single session.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype), [`LivePollOption`](#livepolloption) (its child), [`LivePollChanged`](#livepollchanged), [`LivePollInvariants`](#livepollinvariants), [`LivePollStatus`](#livepollstatus), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), the `[Navigation]` marker ([`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute)), [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced, a lifecycle state machine with a snapshotted cross-service fact.** `[Rubric §4, DDD]` (a root that guards its own transitions) and `[Rubric §7, Microservices Readiness]` (avoiding a synchronous cross-service call on the hot vote path). The lifecycle is enforced as explicit guarded transitions, and `Open` snapshots the event's live-window end onto the poll (`LiveWindowEndUtc`, `LivePoll.cs:32-36`) so later vote checks never need to call the Conference service again (BR-223/BR-224). `[Rubric §8, Data Architecture]`: the child options are held in an encapsulated list behind a read-only view.
- **Walkthrough**
  - `[IdValueGenerated]` (`:17`); properties `EventId`, `SessionId?` (null = event-wide, BR-230), `Question`, `Status`, and `LiveWindowEndUtc?` all have private setters (`:20-36`). Options live in a private `List<LivePollOption> _options` exposed as a read-only `[Navigation(IsCollection = true)] Options` (`:38-42`).
  - `Create(eventId, sessionId, question, optionTexts)` (`:64`): null-checks the texts, combines four [`LivePollInvariants`](#livepollinvariants) checks (event id, question, option count, option uniqueness), constructs the poll as `Draft`, then builds each [`LivePollOption`](#livepolloption) in display order (`:85-92`), and raises [`LivePollChanged`](#livepollchanged) `Added`.
  - `Open(nowUtc, liveWindowStartUtc, liveWindowEndUtc)` (`:108`): rejects any non-`Draft` poll (`LivePoll.InvalidTransition`) and any attempt outside the live window (`LivePoll.OutsideLiveWindow`), then flips to `Open` and snapshots `LiveWindowEndUtc` (`:128-129`).
  - `Close()` (`:141`): `Open`-only, no reopen, flips to `Closed`.
  - `CanAcceptVote(nowUtc, optionId)` (`:167`): the guard the vote handler calls, requires `Open` status, `nowUtc` before the snapshotted window end, and the option to exist and be non-deleted on this poll (`:187`); returns a specific [`Error`](group-01-result-error-handling.md#error) for each failure. This runs entirely against in-memory state, no cross-service call.
  - `SetOptions(options)` (`:201`): an `internal` hook that routes through the base `SetItems`, used only by the navigation populator to rehydrate the collection.
  - `Delete()` (`:210`): refuses to delete an `Open` poll (BR-228, `LivePoll.DeleteWhileOpen`), then soft-deletes the poll and cascade soft-deletes each non-deleted option before raising [`LivePollChanged`](#livepollchanged) `Deleted`.
- **Why it's built this way**: snapshotting the live-window end at `Open` trades a tiny bit of staleness for removing a synchronous Conference call from every vote, and the explicit transition guards mean an invalid lifecycle move is impossible regardless of which handler calls in ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) for the gRPC boundary this snapshot sidesteps).
- **Where it's used**: created/opened/closed/deleted by the poll handlers behind [`LivePollsController`](#livepollscontroller); its options rehydrated by [`LivePollNavigationPopulator`](#livepollnavigationpopulator); tallied by [`LivePollResultsBuilder`](#livepollresultsbuilder).

### LivePollOption
> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.LivePolls` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/LivePollOption.cs:13` · Level 6 · class (sealed child entity)

- **What it is**: a single answer option belonging to a [`LivePoll`](#livepoll): display text plus a sort order, authored with the poll and immutable afterward.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (note: a plain auditable **child**, not an aggregate root), [`LivePollInvariants`](#livepollinvariants), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), the `[Navigation]` marker ([`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute)), [`Result`](group-01-result-error-handling.md#result).
- **Concept reinforced, the child entity inside an aggregate boundary.** `[Rubric §4, DDD]`. Unlike [`LivePollVote`](#livepollvote), an option is a genuine child of the poll: it derives from [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (no domain-event list of its own) and is only ever created and soft-deleted through its parent [`LivePoll`](#livepoll). It carries a back-reference `[Navigation] LivePoll?` and an FK `LivePollId` (`LivePollOption.cs:22-26`).
- **Walkthrough**: `[IdValueGenerated]` (`:12`); `Text` and `Sort` with private setters (`:16-19`); EF ctor and private field ctor (`:29-35`). The only factory, `Create(text, sort)` (`:43`), validates the text via [`LivePollInvariants.EnsureOptionTextIsValid`](#livepollinvariants) and constructs the option with `Id = default`. There is no mutation method, immutability is enforced by omission (the doc comment, `:9-10`, says re-author the Draft poll instead).
- **Why it's built this way**: modeling the option as an immutable child keeps the poll's consistency boundary simple, tally math only ever adds new options via re-authoring, never mutates an existing option's meaning under a live vote count.
- **Where it's used**: built inside [`LivePoll.Create`](#livepoll) and rehydrated by [`LivePollNavigationPopulator`](#livepollnavigationpopulator); read by [`LivePollResultsBuilder`](#livepollresultsbuilder) to label each tally.

### LivePollsController
> MMCA.ADC.Engagement.API · `MMCA.ADC.Engagement.API.Controllers` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:40` · Level 7 · class

- **What it is**: the REST controller for the live poll layer: create/open/close/delete a poll and list/read tallies/cast votes.
- **Depends on**: eight poll handlers via [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) / [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (including the generic [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase), and [`LivePoll`](#livepoll).
- **Concept reinforced, two-tier authorization (feature gate + policy + capability).** `[Rubric §9, API & Contract Design]` and `[Rubric §11, Security]`. Like [`SessionQuestionsController`](#sessionquestionscontroller), the class carries `[FeatureGate(EngagementFeatures.LivePolls)]` and `[Authorize(RequireAuthenticated)]` (`LivePollsController.cs:35-39`). The difference is that the *organizer-only* surfaces, the delete and the event-wide manage list, additionally carry `[HasPermission(EngagementPermissions.LiveManage)]` (`:106,125`), a coarse capability gate, while the create/open/close verbs enforce the finer BR-236 speaker rights *inside the handler* via [`LivePollAuthorization`](#livepollauthorization). So there are two authorization tiers: a declarative capability on the manage endpoints and a data-scoped speaker check in the handlers.
- **Walkthrough**
  - Constructor injects eight handlers plus [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (`:40-49`).
  - `CreateAsync` (`:56`): builds `CreateLivePollCommand(request, GetCallerSpeakerId(), IsCallerOrganizer())` and returns `201 Created`.
  - `OpenAsync` / `CloseAsync` (`:74,92`): pass the same caller-rights inputs; return `204`.
  - `DeleteAsync` (`:110`): gated by `[HasPermission(LiveManage)]`, dispatches the generic [`DeleteEntityCommand<LivePoll, LivePollIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype); the BR-228 "close before delete" rule is enforced deeper, in [`LivePoll.Delete`](#livepoll).
  - `GetEventPollsAsync` (`:127`): the organizer manage list, also `[HasPermission(LiveManage)]`.
  - `GetOpenPollsAsync` (`:145`): the attendee/presenter view of open polls with tallies and the caller's own vote, keyed on optional `eventId` or `sessionId` plus the caller's user id.
  - `GetResultsAsync` (`:169`): one poll's tallies with the caller's vote.
  - `CastVoteAsync` (`:193`): builds `CastVoteCommand(id, request.OptionId, userId)` and returns the fresh [`LivePollResultsDTO`](#livepollresultsdto).
  - The two claim helpers (`GetCallerSpeakerId` `:214`, `IsCallerOrganizer` `:221`) are identical in shape to the Q&A controller's, identity from the token only.
- **Why it's built this way**: the coarse `[HasPermission]` gate keeps organizer-only management endpoints declaratively locked, while delegating the nuanced "this speaker owns this session" decision to the shared handler check avoids duplicating the rule at the transport layer.
- **Where it's used**: mounted by the Engagement service host; reached through the Gateway ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).

### LivePollResultsBuilder
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.Services` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollResultsBuilder.cs:12` · Level 8 · class (sealed)

- **What it is**: the shared read-side service that computes a poll's result tallies: per-option active-vote counts, the total, and optionally the caller's own vote.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (for the read repository), [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) (async materialization), [`LivePoll`](#livepoll) / [`LivePollVote`](#livepollvote), and the result DTOs [`LivePollResultsDTO`](#livepollresultsdto) / [`LivePollOptionResultDTO`](#livepolloptionresultdto).
- **Concept introduced, computing tallies with a grouped SQL COUNT instead of materializing votes.** `[Rubric §12, Performance & Scalability]` (assesses whether hot read paths avoid loading whole tables). The comment at `LivePollResultsBuilder.cs:31-33` states the intent: tallies come from a `GroupBy(OptionId).Select(Count())` that returns one row per option, so a hot poll no longer re-materializes its entire vote table on every vote, results read, and open-polls listing. Centralizing this in one builder means every surface (`CastVote`, `GetPollResults`, `GetOpenPolls`) computes results identically.
- **Walkthrough**: one method `BuildAsync(poll, userId?, ct)` (`:22`). It null-checks the poll, takes a no-tracking read repository for [`LivePollVote`](#livepollvote) (`:29`), runs the grouped count over `TableNoTracking` filtered to this poll (`:34-39`) and folds it into a `countsByOption` dictionary (`:41`). The caller's own vote is a **separate point read** issued only when `userId` is non-null (broadcast payloads pass `null` and skip it, BR-229, `:44-53`). It then projects the poll's non-deleted options ordered by `Sort` into [`LivePollOptionResultDTO`](#livepolloptionresultdto)s, filling each `VoteCount` from the dictionary (`:55-64`), and returns a [`LivePollResultsDTO`](#livepollresultsdto) with poll id/question/status, `TotalVotes` (sum of the counts), the options, and `MyVoteOptionId` (`:66-74`).
- **Why it's built this way**: the grouped count keeps the tally cost proportional to option count, not vote count; skipping the "my vote" read for broadcast payloads (which have no single caller) avoids a pointless query on the fan-out path.
- **Where it's used**: injected into the cast-vote, poll-results, and open-polls handlers so all three return the same [`LivePollResultsDTO`](#livepollresultsdto) shape.
- **Caveats / not-in-source**: `Options` must already be loaded on the passed [`LivePoll`](#livepoll) (via [`LivePollNavigationPopulator`](#livepollnavigationpopulator)); the builder reads `poll.Options` directly and does not itself load them.

### ModerateQuestionHandler
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Moderate` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Moderate/ModerateQuestionHandler.cs:21` · Level 8 · class (sealed partial)

- **What it is**: the command handler that applies a moderation transition to a [`SessionQuestion`](#sessionquestion) (BR-234), enforcing the BR-236 rights, then best-effort publishes the matching live-channel event (BR-238).
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice) (the Conference gRPC boundary for session info), [`ILiveChannelPublisher`](group-10-notifications.md#ilivechannelpublisher) (the Notification gRPC ingress), [`LivePollAuthorization`](#livepollauthorization), the [`SessionQuestionChannel`](#sessionquestionchannel) event names, the channel payload DTOs ([`SessionQuestionApprovedPayload`](#sessionquestionapprovedpayload) and siblings), and `ILogger`.
- **Concept introduced, best-effort side-channel publish that never fails the command (BR-238).** `[Rubric §29, Resilience & Business Continuity]` and `[Rubric §7, Microservices Readiness]` (a downstream service being unreachable must not fail the local write). The mutation is committed first via `SaveChangesAsync`; only *then* does the handler attempt the live-channel publish, wrapped in a `try/catch (Exception)` that logs and swallows so a Notification outage cannot roll back a moderation (`ModerateQuestionHandler.cs:85-142`, with a justified `#pragma warning disable CA1031` at `:137`). `[Rubric §13, Observability & Operability]`: both the success and the swallowed-failure paths emit source-generated `[LoggerMessage]` logs (`:145-149`).
- **Walkthrough**
  - `HandleAsync` (`:28`): loads the tracked [`SessionQuestion`](#sessionquestion) by id (`:33`), returns `Error.NotFound` if missing (`:39-43`).
  - Fetches the session's live info via [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice) (`:45`) and runs the [`LivePollAuthorization.EnsureCanManage`](#livepollauthorization) rights check (`:49-52`); a rights failure short-circuits.
  - Captures `wasPending` before the transition (`:54`), then dispatches the action through a `switch` to the domain method `Approve()` / `Dismiss()` / `MarkAnswered()` (`:56-66`); an unknown action is an invariant failure.
  - Persists via `SaveChangesAsync` (`:70`), logs the moderation (`:72`), then calls the private `PublishModeratedAsync` (`:74`).
  - `PublishModeratedAsync` (`:79`): resolves the session channel key via `LivePollChannel.ForSession` (`:87`), then builds `(eventName, payload)` per action, only universally-visible data rides the channel, and the Approve arm is the single place question **content** is broadcast (`:92-110`). It publishes via [`ILiveChannelPublisher`](group-10-notifications.md#ilivechannelpublisher) (`:112`), and when a *Pending* question left the queue on Approve/Dismiss it issues a fresh Pending-count read and publishes a [`SessionQuestionPendingCountChangedPayload`](#sessionquestionpendingcountchangedpayload) so moderators' badges update (`:118-135`).
- **Why it's built this way**: committing before publishing, plus the swallow-and-log catch, gives the live layer at-most-once broadcast semantics layered over a durably-committed write, the correct trade for ephemeral UI signals that must never block a moderation ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) for the channel transport).
- **Where it's used**: registered for [`ModerateQuestionCommand`](#moderatequestioncommand) and invoked by [`SessionQuestionsController`](#sessionquestionscontroller)'s approve/dismiss/answered verbs.
- **Caveats / not-in-source**: the `switch` discard arm in `PublishModeratedAsync` throws `ArgumentOutOfRangeException` (`:109`) but is unreachable, the handler already applied a known action before publishing (noted in the comment, `:92-93`).

### LivePollNavigationPopulator
> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.Services` · `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollNavigationPopulator.cs:11` · Level 10 · class (sealed)

- **What it is**: the declarative navigation populator that manually loads a [`LivePoll`](#livepoll)'s `Options` collection on query-service paths where EF Core `.Include()` is not applied.
- **Depends on**: [`DeclarativeNavigationPopulator<TEntity>`](group-11-navigation-populators.md#declarativenavigationpopulatortentity) (base), [`ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>`](group-11-navigation-populators.md#childnavigationdescriptortentity-tparentid-tchild-tchildid) (the descriptor), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`LivePoll`](#livepoll) / [`LivePollOption`](#livepolloption).
- **Concept reinforced, declarative navigation population ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).** `[Rubric §2, Design Patterns]`. The framework's entity-query path returns entities without EF `Include`s; a populator declares, in data, which child collections to rehydrate and how. This is the whole class: it subclasses [`DeclarativeNavigationPopulator<LivePoll>`](group-11-navigation-populators.md#declarativenavigationpopulatortentity) and passes exactly one [`ChildNavigationDescriptor`](group-11-navigation-populators.md#childnavigationdescriptortentity-tparentid-tchild-tchildid) for `Options` (`LivePollNavigationPopulator.cs:11-23`).
- **Walkthrough**: a primary constructor takes [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and forwards a single-element descriptor array to the base (`:13-22`). The descriptor wires `PropertyName = nameof(LivePoll.Options)`, `ParentKeySelector = p => p.Id`, `ChildForeignKeySelector = child => child.LivePollId`, and `AssignAction = (p, options) => p.SetOptions(options)`, the last calling the aggregate's `internal` [`SetOptions`](#livepoll) so the collection is rehydrated through the root's own `SetItems` guard rather than by writing the backing field directly. The class body is empty; all behavior lives in the base.
- **Why it's built this way**: expressing the load as a descriptor (not hand-written query code) keeps every populator uniform and lets the base handle batching and assignment; routing the assignment through `SetOptions` preserves the aggregate boundary even during rehydration.
- **Where it's used**: resolved and run by the query-service pipeline before [`LivePollResultsBuilder`](#livepollresultsbuilder) reads `poll.Options`, and behind the poll read endpoints on [`LivePollsController`](#livepollscontroller).

### SessionQuestionInvariants

> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.SessionQuestions` · `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionInvariants.cs:9` · Level 4 · class

- **What it is** - a static rule holder for the [SessionQuestion](#sessionquestion) aggregate: the three validation checks its factory runs, plus the single source of truth for the question-text length limit (BR-231).
- **Depends on** - [CommonInvariants](group-02-domain-building-blocks.md#commoninvariants) (the reusable lower-layer guard toolbox), [Result](group-01-result-error-handling.md#result) / [Error](group-01-result-error-handling.md#error) from `MMCA.Common.Shared.Abstractions`, and the module identifier aliases `SessionIdentifierType` / `UserIdentifierType`.
- **Concept introduced** - the *invariants class* idiom is taught in [Group 02](group-02-domain-building-blocks.md#the-entity-chain-one-capability-per-rung): domain rules live in a dedicated static class returning [Result](group-01-result-error-handling.md#result), never as ad-hoc `if` blocks inside the entity, so the entity factory reads as a checklist and each rule is independently testable. What this class adds specifically is `TextMaxLength = 500` (`SessionQuestionInvariants.cs:12`) as a `public const`, the one place the 1-to-500 character limit is declared. [Rubric §4 - Domain-Driven Design] assesses whether invariants are enforced inside the model rather than at the edges: here the rule set is the model's own guard, called only through the aggregate's `Create`. [Rubric §1 - SOLID] assesses single-responsibility: validation is factored out of the entity into a unit that does nothing else.
- **Walkthrough**
  - `TextMaxLength` (`SessionQuestionInvariants.cs:12`): the shared max-length constant, reused by [SessionQuestion.Create](#sessionquestion) and by any FluentValidation validator or EF configuration that needs the same number.
  - `EnsureSessionIdIsValid` (`SessionQuestionInvariants.cs:14`) and `EnsureUserIdIsValid` (`SessionQuestionInvariants.cs:17`): both delegate to `CommonInvariants.EnsureIdIsNotDefault`, failing with a stable error code (`SessionQuestion.SessionId.Invalid` / `SessionQuestion.UserId.Invalid`) when the id is the type default.
  - `EnsureTextIsValid` (`SessionQuestionInvariants.cs:20`): inline check that rejects null/whitespace or over-length text with an `Error.Invariant` carrying the code `SessionQuestion.Text.Invalid` and a message templated from `TextMaxLength` (`SessionQuestionInvariants.cs:22-26`). Success returns `Result.Success()`.
- **Why it's built this way** - stable machine-readable error `code`s and a shared length constant mean the API layer, validators, and persistence all agree on one rule without duplicating the literal `500`. The `source` parameter (the caller passes `nameof(Create)`) threads the origin into every error for diagnostics.
- **Where it's used** - exclusively by [SessionQuestion.Create](#sessionquestion) (`SessionQuestion.cs:85-88`), combined via `Result.Combine`.

### SessionQuestionUpvoteInvariants

> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.SessionQuestions` · `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionUpvoteInvariants.cs:9` · Level 4 · class

- **What it is** - the sibling invariants class for [SessionQuestionUpvote](#sessionquestionupvote): the two id checks its factory needs.
- **Depends on** - [CommonInvariants](group-02-domain-building-blocks.md#commoninvariants), [Result](group-01-result-error-handling.md#result), and the `SessionQuestionIdentifierType` / `UserIdentifierType` aliases.
- **Concept introduced** - none new; it is the compact twin of [SessionQuestionInvariants](#sessionquestioninvariants) with no length constant because an upvote has no free-text field, only two foreign keys.
- **Walkthrough**
  - `EnsureQuestionIdIsValid` (`SessionQuestionUpvoteInvariants.cs:11`): `CommonInvariants.EnsureIdIsNotDefault` on the upvoted question id, code `SessionQuestionUpvote.QuestionId.Invalid`.
  - `EnsureUserIdIsValid` (`SessionQuestionUpvoteInvariants.cs:14`): the same guard on the upvoting user, code `SessionQuestionUpvote.UserId.Invalid`.
- **Why it's built this way** - see [SessionQuestionInvariants](#sessionquestioninvariants); one guard unit per aggregate keeps each aggregate's factory a flat checklist.
- **Where it's used** - by [SessionQuestionUpvote.Create](#sessionquestionupvote) (`SessionQuestionUpvote.cs:48-50`).

### SessionQuestion

> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.SessionQuestions` · `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestion.cs:19` · Level 5 · class

- **What it is** - the aggregate root for an attendee-submitted, moderated session question in the conference-day live layer. It carries the question text, a moderation status, an answered flag, and a snapshot of the event's live-window end so upvote timing can be checked without a cross-service call.
- **Depends on** - base [AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (identity, soft-delete, audit fields, domain-event collection), [SessionQuestionInvariants](#sessionquestioninvariants), the [QuestionStatus](#questionstatus) enum, the [SessionQuestionChanged](#sessionquestionchanged) domain event, [DomainEntityState](group-02-domain-building-blocks.md#domainentitystate), [IdValueGeneratedAttribute](group-02-domain-building-blocks.md#idvaluegeneratedattribute), and [Result](group-01-result-error-handling.md#result) / [Error](group-01-result-error-handling.md#error). Externals: BCL `DateTime` / `TimeProvider` (the caller supplies `nowUtc`).
- **Concept introduced** - the **snapshotted cross-service value** pattern. Because Engagement and Conference are separate services with separate databases ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), the event's live-window end is fetched once from Conference at submission and stored on the row as `LiveWindowEndUtc` (`SessionQuestion.cs:43`), so every later upvote-timing decision is a local field read rather than a gRPC round trip (BR-237). This class also shows the **single-event-plus-state** convention (BR-60): instead of `QuestionApproved` / `QuestionDismissed` / `QuestionDeleted` event types, one [SessionQuestionChanged](#sessionquestionchanged) carries a [DomainEntityState](group-02-domain-building-blocks.md#domainentitystate) discriminator. [Rubric §4 - Domain-Driven Design] assesses invariant enforcement inside the boundary and explicit state transitions: every mutator here is a guarded method returning [Result](group-01-result-error-handling.md#result), and illegal transitions fail rather than throw. [Rubric §7 - Microservices Readiness] assesses whether a boundary avoids chatty cross-service dependence: the live-window snapshot is exactly that, denormalized-at-write so reads stay in-process. [Rubric §6 - CQRS & Event-Driven] applies because every state change is announced as a domain event that the outbox later publishes.
- **Walkthrough**
  - Fields (`SessionQuestion.cs:22-43`): `SessionId` (the session asked in), `EventId` (denormalized from the session, metadata only and deliberately not validated because the disabled-stub gRPC boundary can report a default, per the remark at `SessionQuestion.cs:24`), `UserId` (never exposed on DTOs: questions display anonymously, BR-238), `Text`, `Status`, `IsAnswered`, and `LiveWindowEndUtc`. All have private setters, so state changes only through the methods below.
  - Constructors (`SessionQuestion.cs:46-62`): a private parameterless ctor for EF materialization (initializing `Text` to empty), and a private all-args ctor the factory uses.
  - `Create` (`SessionQuestion.cs:77-109`): combines the three [SessionQuestionInvariants](#sessionquestioninvariants) checks, then separately rejects any `initialStatus` that is not `Pending` or `Approved` (`SessionQuestion.cs:92-99`) since a question starts at the event's moderation default (BR-233). It constructs with `Id = default` (the [IdValueGeneratedAttribute](group-02-domain-building-blocks.md#idvaluegeneratedattribute) marks the key as database-generated) and raises [SessionQuestionChanged](#sessionquestionchanged) with `DomainEntityState.Added` (`SessionQuestion.cs:106`).
  - `Approve` (`SessionQuestion.cs:117`), `Dismiss` (`SessionQuestion.cs:141`): moderation transitions (BR-234). Each rejects a no-op transition (approving an already-approved question, dismissing an already-dismissed one) with an `Error.Invariant` coded `SessionQuestion.InvalidTransition`, sets `Status`, and raises `Updated`.
  - `MarkAnswered` (`SessionQuestion.cs:164`): only valid while `Approved` (code `SessionQuestion.NotApproved`) and only once (code `SessionQuestion.AlreadyAnswered`); sets `IsAnswered` and raises `Updated`.
  - `CanAcceptUpvote` (`SessionQuestion.cs:197`): the guard the upvote use case calls. It fails if the question is not `Approved` (`SessionQuestion.NotApproved`) or if `nowUtc >= LiveWindowEndUtc` (`SessionQuestion.OutsideLiveWindow`, `SessionQuestion.cs:208`), enforcing the live-window snapshot without touching Conference.
  - `Delete` (`SessionQuestion.cs:225`): overrides the base soft-delete, and on success raises [SessionQuestionChanged](#sessionquestionchanged) with `Deleted`.
- **Why it's built this way** - snapshotting the live-window end (rather than calling Conference per upvote) trades a small staleness window for avoiding chatty synchronous coupling on the hot path, the microservice-readiness rationale in [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) / [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html). The single-event-plus-state shape (BR-60) keeps the event catalog small and lets one handler branch on `DomainEntityState`.
- **Where it's used** - by the Engagement Application submit/moderate/upvote use cases and projected to DTOs by [SessionQuestionViewBuilder](#sessionquestionviewbuilder); persisted by its EF configuration; its events flow through the outbox to the live-channel publisher.

### SessionQuestionUpvote

> MMCA.ADC.Engagement.Domain · `MMCA.ADC.Engagement.Domain.SessionQuestions` · `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionUpvote.cs:20` · Level 5 · class

- **What it is** - a standalone aggregate root recording one user's upvote on one [SessionQuestion](#sessionquestion). Deliberately not modeled as a child of the question.
- **Depends on** - [AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype), [SessionQuestionUpvoteInvariants](#sessionquestionupvoteinvariants), the [SessionQuestionUpvoteChanged](#sessionquestionupvotechanged) event, [DomainEntityState](group-02-domain-building-blocks.md#domainentitystate), [IdValueGeneratedAttribute](group-02-domain-building-blocks.md#idvaluegeneratedattribute), and `MMCA.Common.Domain.Extensions` (for the base `Undelete`).
- **Concept introduced** - the **separate-aggregate-for-high-frequency-writes** decision. The class comment (`SessionQuestionUpvote.cs:10-18`) spells out the rationale: upvotes are frequent attendee writes, and loading every upvote into the question aggregate would bloat the change tracker and contend on the question row, so an upvote is its own root. Uniqueness (one active upvote per question+user, BR-235) is enforced at the database by a filtered unique index (see [LivePollVoteConfiguration](#livepollvoteconfiguration) for the identical pattern on votes), and toggling an upvote off/on is soft-delete-then-`Reactivate` rather than insert-churn (the BR-135 reactivation pattern). [Rubric §4 - Domain-Driven Design] assesses correct aggregate boundaries: splitting a high-write satellite from its parent root is a textbook boundary choice. [Rubric §8 - Data Architecture] assesses concurrency and uniqueness strategy: the filtered unique index plus soft-delete reactivation avoids row contention and orphan accumulation.
- **Walkthrough**
  - Fields (`SessionQuestionUpvote.cs:23-26`): `SessionQuestionId` and `UserId`, both private-set scalar foreign keys (no navigation to the question, keeping the aggregates independent).
  - Constructors (`SessionQuestionUpvote.cs:29-35`): private parameterless for EF, private two-arg for the factory.
  - `Create` (`SessionQuestionUpvote.cs:44`): combines the two [SessionQuestionUpvoteInvariants](#sessionquestionupvoteinvariants) checks, constructs with `Id = default`, and raises [SessionQuestionUpvoteChanged](#sessionquestionupvotechanged) with `Added`.
  - `Reactivate` (`SessionQuestionUpvote.cs:70`): calls the base `Undelete()` and, on success, raises `Added` again so a re-upvote looks like a fresh upvote to downstream consumers (BR-235 / BR-135).
  - `Delete` (`SessionQuestionUpvote.cs:85`): overrides soft-delete (an un-upvote) and raises `Deleted`.
- **Why it's built this way** - see the concept note: separating the upvote aggregate and driving on/off through soft-delete + reactivation is what makes the filtered unique index a durable one-active-per-user guarantee while keeping high-frequency writes off the question row.
- **Where it's used** - written by the upvote/un-upvote use cases; counted and projected by [SessionQuestionViewBuilder](#sessionquestionviewbuilder) (`SessionQuestionViewBuilder.cs:34-46`).

### LivePollDTOMapper

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.LivePolls.DTOs` · `MMCA.ADC.Engagement.Application/LivePolls/DTOs/LivePollDTOMapper.cs:13` · Level 7 · class

- **What it is** - the Mapperly-generated mapper that turns a [LivePoll](group-23-engagement-live-layer.md#livepoll) entity (with its options) into a [LivePollDTO](group-23-engagement-live-layer.md#livepolldto) for read responses.
- **Depends on** - [IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) (the common mapper contract), and the `Riok.Mapperly.Abstractions` source generator (`[Mapper]`).
- **Concept introduced** - the compile-time DTO mapping approach ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)) is taught with the other mappers; the [Mapper] attribute on a `partial` class (`LivePollDTOMapper.cs:12-14`) makes Mapperly generate the field-copy code at build time, so there is no reflection and no hand-written property assignments to drift. [Rubric §9 - API and Contract Design] assesses whether the wire contract is decoupled from the domain model: mapping the entity to a dedicated DTO is that decoupling. [Rubric §15 - Best Practices] applies because source-generated mapping is allocation-light and analyzer-clean.
- **Walkthrough**
  - `MapToDTO` (`LivePollDTOMapper.cs:17`): a `partial` method whose body Mapperly generates from the [LivePoll](group-23-engagement-live-layer.md#livepoll) to [LivePollDTO](group-23-engagement-live-layer.md#livepolldto) shape, including nested options.
  - `MapToDTOs` (`LivePollDTOMapper.cs:20-24`): hand-written collection overload, null-guarded with `ArgumentNullException.ThrowIfNull`, projecting each entity via `MapToDTO` into a collection-expression result.
- **Why it's built this way** - Mapperly satisfies the [IEntityDTOMapper](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) contract with generated code, keeping the poll read path fast and drift-free ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)).
- **Where it's used** - by the LivePolls read/query handlers when returning poll views. It is auto-registered by Scrutor assembly scanning.

### LivePollConfiguration

> MMCA.ADC.Engagement.Infrastructure · `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePollConfiguration.cs:16` · Level 8 · class

- **What it is** - the EF Core mapping for the [LivePoll](group-23-engagement-live-layer.md#livepoll) aggregate root: column requirements, the question length limit, and the query index.
- **Depends on** - [EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype) (the common base that applies audit/soft-delete/RowVersion mapping), EF Core's `EntityTypeBuilder<T>`, and [LivePollInvariants](group-23-engagement-live-layer.md#livepollinvariants) for the shared `QuestionMaxLength`.
- **Concept introduced** - the EF configuration base class and the boundary-crossing-FK-as-scalar rule are taught in [Group 07](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype). What this file demonstrates is the **no cross-database FK** rule made concrete (`LivePollConfiguration.cs:11-15`): `EventId` (and any session reference) points at Conference-owned rows in a different database, so it stays a plain indexed scalar column, and consistency is carried by the Conference gRPC validation boundary, never by a foreign-key constraint. [Rubric §8 - Data Architecture] assesses the persistence contract (nullability, lengths, indexes) and the database-per-service discipline: both are visible here. [Rubric §7 - Microservices Readiness] applies because the scalar-FK choice is what keeps the two services' schemas independent.
- **Walkthrough**
  - `base.Configure` (`LivePollConfiguration.cs:22`): applies the common conventions first.
  - `EventId` required (`LivePollConfiguration.cs:24-25`); `Question` required with `HasMaxLength(LivePollInvariants.QuestionMaxLength)` (`LivePollConfiguration.cs:27-29`), reusing the domain constant so DB and domain agree; `Status` required (`LivePollConfiguration.cs:31-32`).
  - `HasIndex(p => p.EventId)` (`LivePollConfiguration.cs:35`): a non-unique index because the Happening Now page and the organizer manage view both query polls by event.
- **Why it's built this way** - one length constant sourced from the domain ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)-adjacent single-source-of-truth), scalar cross-service references ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), and an index matching the real query shape.
- **Where it's used** - discovered and applied at model-build time by the Engagement `SQLServerDbContext`; auto-registered via Scrutor.

### LivePollOptionConfiguration

> MMCA.ADC.Engagement.Infrastructure · `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePollOptionConfiguration.cs:11` · Level 8 · class

- **What it is** - the EF mapping for the `LivePollOption` child entity: its text limit and its owning relationship back to [LivePoll](group-23-engagement-live-layer.md#livepoll).
- **Depends on** - [EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), EF Core `EntityTypeBuilder<T>`, and [LivePollInvariants](group-23-engagement-live-layer.md#livepollinvariants) for `OptionTextMaxLength`.
- **Concept introduced** - none new; this is the **in-aggregate child** counterpart to [LivePollConfiguration](#livepollconfiguration). Unlike the cross-service scalar FK there, the option lives in the same aggregate and same database as its poll, so it gets a real navigation and a real foreign key (`LivePollOptionConfiguration.cs:23-26`). [Rubric §8 - Data Architecture] applies: a genuine `HasForeignKey` is correct here precisely because both ends are Engagement-owned.
- **Walkthrough**
  - `Text` required with `HasMaxLength(LivePollInvariants.OptionTextMaxLength)` (`LivePollOptionConfiguration.cs:19-21`).
  - `HasOne(o => o.LivePoll).WithMany(p => p.Options).HasForeignKey(o => o.LivePollId).IsRequired()` (`LivePollOptionConfiguration.cs:23-26`): the required one-poll-to-many-options relationship inside the aggregate.
- **Where it's used** - applied by the Engagement `SQLServerDbContext` at model build; auto-registered via Scrutor.

### LivePollVoteConfiguration

> MMCA.ADC.Engagement.Infrastructure · `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePollVoteConfiguration.cs:17` · Level 8 · class

- **What it is** - the EF mapping for the [LivePollVote](group-23-engagement-live-layer.md#livepollvote) aggregate root, whose centerpiece is the filtered unique index that guarantees one active vote per user per poll (BR-225).
- **Depends on** - [EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype) and EF Core `EntityTypeBuilder<T>`.
- **Concept introduced** - the **filtered unique index as the database-level backstop** for a soft-delete-reactivation aggregate. Because a vote (like [SessionQuestionUpvote](#sessionquestionupvote)) toggles via soft-delete rather than hard-delete, a naive unique index would block a user from ever re-voting; the filter `[IsDeleted] = 0` (`LivePollVoteConfiguration.cs:35-37`) scopes uniqueness to active rows only, so the index is the durable guarantee behind the handler's create-or-reactivate dance (the remark at `LivePollVoteConfiguration.cs:12-16`). [Rubric §8 - Data Architecture] assesses uniqueness/concurrency enforcement at the storage layer: this is the canonical example. [Rubric §2 - Design Patterns] applies in that the DB constraint and the domain reactivation method are two halves of one idempotent-write pattern.
- **Walkthrough**
  - `LivePollId`, `OptionId`, `UserId` all required (`LivePollVoteConfiguration.cs:25-32`): votes carry scalar FKs with no navigations, because a vote is a separate aggregate by design.
  - Filtered unique index on `{ LivePollId, UserId }` with `HasFilter("[IsDeleted] = 0")` (`LivePollVoteConfiguration.cs:35-37`): BR-225, one active vote per poll+user.
  - Non-unique index on `{ LivePollId, OptionId }` (`LivePollVoteConfiguration.cs:40`): supports grouping votes by option when tallying results.
- **Why it's built this way** - the filtered index lets soft-delete and uniqueness coexist, and the tally index matches the result-aggregation query. See [SessionQuestionUpvote](#sessionquestionupvote) for the identical pattern on question upvotes.
- **Where it's used** - applied by the Engagement `SQLServerDbContext`; the vote command handler relies on the index to make its reactivation race-safe.

### SessionQuestionViewBuilder

> MMCA.ADC.Engagement.Application · `MMCA.ADC.Engagement.Application.SessionQuestions.Services` · `MMCA.ADC.Engagement.Application/SessionQuestions/Services/SessionQuestionViewBuilder.cs:12` · Level 8 · class

- **What it is** - a shared application service that projects a set of [SessionQuestion](#sessionquestion) entities into [SessionQuestionDTO](group-23-engagement-live-layer.md#sessionquestiondto) views, computing each question's active upvote count and the calling user's own upvote/authorship flags in a single batched read.
- **Depends on** - [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (for the read repository), [SessionQuestionUpvote](#sessionquestionupvote), [SessionQuestion](#sessionquestion), and [SessionQuestionDTO](group-23-engagement-live-layer.md#sessionquestiondto). Externals: LINQ and BCL collections.
- **Concept introduced** - the **shared view-builder to defeat N+1** across use cases. The submit, list, and moderation use cases all need the same per-question counts and per-caller flags, so rather than each handler re-deriving them (and risking a per-question query), one builder fetches every relevant upvote in a single projected read and computes the aggregates in memory. It takes `IUnitOfWork` via a primary constructor (`SessionQuestionViewBuilder.cs:12`). [Rubric §12 - Performance and Scalability] assesses query efficiency: the one batched `GetProjectedAsync` over all question ids (`SessionQuestionViewBuilder.cs:35-38`) replaces a potential per-question round trip. [Rubric §1 - SOLID] applies: the projection logic lives in one reusable unit instead of being duplicated across three handlers.
- **Walkthrough**
  - `BuildAsync` (`SessionQuestionViewBuilder.cs:21`): null-guards the input and short-circuits to an empty list when there are no questions (`SessionQuestionViewBuilder.cs:26-31`).
  - Batched upvote read (`SessionQuestionViewBuilder.cs:33-38`): collects the question ids, takes a read repository for [SessionQuestionUpvote](#sessionquestionupvote), and calls `GetProjectedAsync` selecting only `{ SessionQuestionId, UserId }` for all those questions in one query (active rows only, since soft-deleted upvotes are filtered globally).
  - Aggregation (`SessionQuestionViewBuilder.cs:40-46`): groups into a per-question count dictionary, and builds a `HashSet` of the caller's own upvoted question ids (empty when `callerUserId` is null, the moderation view where `MyUpvote`/`IsMine` are not meaningful).
  - Projection (`SessionQuestionViewBuilder.cs:48-60`): maps each question to a [SessionQuestionDTO](group-23-engagement-live-layer.md#sessionquestiondto), setting `UpvoteCount` from the dictionary (`GetValueOrDefault`), `MyUpvote` from the set, and `IsMine` from the caller comparison. Note `UserId` is never copied onto the DTO (questions display anonymously, BR-238), and question order is preserved.
- **Why it's built this way** - centralizing the projection guarantees every surface computes views identically and with one query, honoring the anonymity rule in one place.
- **Where it's used** - by the Engagement SessionQuestions submit, list, and moderation use cases (the `callerUserId is null` branch is the moderation path).
- **Caveats / not-in-source** - the exact set of calling handlers is asserted by the class summary comment; the individual use-case call sites are outside this unit's file list, so their precise wiring is Not determinable from source here.


---
[⬅ ADC Engagement Module (Session Bookmarks)](group-22-engagement-module.md)  •  [Index](00-index.md)  •  [ADC Identity Module (Users, Profiles, GDPR Export/Erasure) ➡](group-24-identity-module.md)
