# 17. ADC Conference - Domain Model & Module Contracts

**What this chapter covers.** This is the heart of the Atlanta Developers Conference application, the
**Conference bounded context**, the largest and richest domain in MMCA.ADC. It models everything an
organizer curates and an attendee browses: the **Event** (the conference itself, with its rooms,
speaker roster, and venue details), the **Session** (a talk on the schedule), the **Speaker**, the
**Category**/`CategoryItem` taxonomy (tracks, levels, formats), and the **Question**/answer machinery
that captures structured metadata about events, sessions, and speakers. Five aggregate roots, a
sixth AI-scoring aggregate, a dozen child entities, the static **invariant** classes that guard their
business rules, the **domain events** every mutation raises, a pure **domain service** that
coordinates cross-aggregate cascade deletes, and, across the package boundary in
`MMCA.ADC.Conference.Shared`, the **DTO contracts**, the cross-module **service interfaces** the
Engagement module calls, the **integration events** that keep the User-to-Speaker link consistent
across services, and the **decision-support** read models that power the organizer's session-selection
dashboard. The detailed per-type sections follow; this overview shows how the pieces fit and how a
single change flows through them.

This chapter is almost entirely an *instantiation* of the framework taught in groups 1 through 14,
applied to a real, non-trivial domain. If a pattern here looks unfamiliar, it was introduced upstream
and is only cross-referenced now: the [`Result`](group-01-result-error-handling.md#result) pattern
(G01), the
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
entity hierarchy and [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) (G02),
the [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype)
event base and the outbox spine (G04), the
[`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity)
cross-container eager-loading extension point (G11), and the [`IModule`](group-14-module-system-composition.md#imodule)
composition system (G14). The lens this chapter most strongly embodies is `[Rubric §4, Domain-Driven
Design]` (does the model mirror the business, aggregates, value objects, invariants, ubiquitous
language?): this is the codebase's most complete DDD specimen, and it is worth reading slowly, because
the same shapes repeat across all five aggregates.

## Two packages, one bounded context

The Conference context spans two of the module's projects, and the split is deliberate Clean
Architecture (`[Rubric §3, Clean Architecture]`). **`MMCA.ADC.Conference.Domain`** holds the
behavior-rich aggregates, their invariants, their domain events, and the domain service, the inner
ring that depends only on `MMCA.Common.Domain`/`.Shared` and knows nothing about EF, ASP.NET, or
serialization. **`MMCA.ADC.Conference.Shared`** holds the *contracts* that cross boundaries: the DTOs
returned by the API, the cross-module validation interfaces the Engagement module consumes
([`ISessionBookmarkValidationService`](#isessionbookmarkvalidationservice) and
[`IEventLiveValidationService`](#ieventlivevalidationservice)), the
[`SpeakerLinkedToUser`](#speakerlinkedtouser)/[`SpeakerUnlinkedFromUser`](#speakerunlinkedfromuser)
integration events Identity subscribes to, and the feature-flag, permission, and status constants.
`Shared` is the package every other layer, including the Blazor WebAssembly UI, can reference without
dragging in the domain. The [`AssemblyReference`](#assemblyreference)/[`ClassReference`](#classreference)
anchor pair in `Domain`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/AssemblyReference.cs:5,11`) is the
trivial type Scrutor and the architecture-fitness tests pin to when they need to *name* the Conference
domain assembly.

## The five aggregates and their ownership boundaries

An **aggregate** is a root entity plus the children it exclusively owns; invariants are enforced
*inside* the boundary, and references *across* aggregates are by ID, never by object graph. The
Conference context has five roots, all deriving from
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
so they inherit soft-delete, audit stamping, and the buffered `DomainEvents` collection:

- [`Event`](#event)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:17`) owns
  [`Room`](#room) (the physical rooms), [`EventSpeaker`](#eventspeaker) (the speaker roster, a join
  to `Speaker` *by ID*), and [`EventQuestionAnswer`](#eventquestionanswer) (event-level structured
  answers). Its `Id` is database-generated (marked `[IdValueGenerated]`, `Event.cs:16`).
- [`Session`](#session)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/Session.cs:16`) owns
  [`SessionSpeaker`](#sessionspeaker), [`SessionCategoryItem`](#sessioncategoryitem), and
  [`SessionQuestionAnswer`](#sessionquestionanswer). Critically, a Session references its `Event` and
  `Room` by scalar FK (`EventId` at `Session.cs:60`, `RoomId` at `Session.cs:63`): they are *separate*
  aggregates, even though the model exposes `Event`/`Room` navigations (`Session.cs:67,71`, both
  `[Navigation]`-decorated with public setters so the populator and query filtering can hydrate them)
  used only for read-side filtering, never to reach across the boundary and mutate. Session `Id`s are
  **Sessionize-assigned**, not database-generated.
- [`Speaker`](#speaker)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:15`) owns
  [`SpeakerCategoryItem`](#speakercategoryitem) and [`SpeakerQuestionAnswer`](#speakerquestionanswer),
  holds an optional `Email` [value object](group-02-domain-building-blocks.md#email) (`Speaker.cs:24`),
  and carries the cross-module `LinkedUserId` FK to an Identity `User` (`Speaker.cs:55`). Speaker `Id`s
  are Sessionize-assigned GUIDs, with a fallback to `Guid.NewGuid()` for organizer-created speakers
  (see the in-code BR note at `Speaker.cs:146-151`).
- [`Category`](#category)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/Category.cs:16`) owns
  [`CategoryItem`](#categoryitem): the taxonomy roots ("Level", "Track", "Session format") and their
  selectable options.
- [`Question`](#question)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/Question.cs:15`) is a flat
  aggregate (no children); its answers live on the *other* aggregates as `*QuestionAnswer` join
  entities, keyed by `QuestionId`.

A sixth root, [`SessionAiScore`](#sessionaiscore)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionAiScore.cs:12`), is an
AI-generated scorecard for a session (seven 1.0-to-10.0 scores: an overall plus six per-criteria, at
`SessionAiScore.cs:17-36`, together with the model's reasoning and identifier, each score
range-guarded at `SessionAiScore.cs:133-140`), stored one-per-session and replaced on re-scoring. It
is the persistence side of the decision-support feature described below. That a *scorecard* is modeled
as its own aggregate, referencing the Session by scalar `SessionId` (`SessionAiScore.cs:15`) rather
than nesting under it, is a clean aggregate-boundary call: scores have an independent lifecycle
(computed asynchronously, re-run on demand) and should not be loaded every time a Session is read.

## The aggregate shape, taught once

Open any of the five roots and you will see the *same* skeleton; this repetition is the point, and it
is what makes the per-type sections that follow read quickly. The shape, using [`Event`](#event) as the
exemplar:

1. **Private-setter properties** (`Name { get; private set; }`, `Event.cs:20`): state can only change
   through the aggregate's own methods, never by an outside caller assigning a property. This is
   encapsulation as a compile-time guarantee (`[Rubric §4, Domain-Driven Design]`, `[Rubric §1,
   SOLID]`).
2. **Backing-field collections exposed as `IReadOnlyCollection<T>`** (`_rooms` at `Event.cs:62` becomes
   `Rooms => _rooms.AsReadOnly()` at `Event.cs:66`), each decorated `[Navigation(IsCollection = true)]`
   so the navigation-populator machinery (G11) knows how to eager-load it. Children can only be
   added or removed through `AddRoom`/`RemoveRoom`-style methods that enforce invariants (for example
   duplicate-name rejection at `Event.cs:330-337`).
3. **A private EF constructor** (`Event.cs:81`, for materialization) plus a **private state
   constructor** (`Event.cs:87`) used only by the factory.
4. **A static `Create(...)` factory returning [`Result<T>`](group-01-result-error-handling.md#result)**
   (`Event.cs:125`): it validates invariants via `Result.Combine(...)` *before* constructing anything
   (`Event.cs:138-143`), so an invalid aggregate is unrepresentable, then raises an `Added` domain
   event (`Event.cs:162`). The `isIdValueGenerated ? default : id!.Value` dance (`Event.cs:145,158`)
   reconciles database-generated IDs with explicitly supplied ones.
5. **Mutator methods** (`Update` at `Event.cs:182`, `Publish`/`Unpublish` at `Event.cs:219,239`,
   `LinkUser`/`UnlinkUser` on Speaker at `Speaker.cs:250,268`) that re-validate, mutate, and raise an
   `Updated` event.
6. **An overridden `Delete()`** (`Event.cs:275`) that calls `base.Delete()` (the soft-delete from
   G02), then **cascade-soft-deletes each owned child** (`Event.cs:281-300`) and raises a `Deleted`
   event (`Event.cs:302`). Soft-delete is the default everywhere (`[Rubric §8, Data Architecture]`:
   the `IsDeleted` flag plus EF global query filters, never a hard `DELETE`).
7. **`internal SetX(...)` methods** (`Event.cs:409`, `469`, `546`) delegating to the framework's
   `SetItems` helper, the hooks the navigation populators call to hydrate the read-only collections
   after a batch load.

Because the shape is identical, the child entities ([`Room`](#room), the four `*Speaker`/`*CategoryItem`
joins, the three `*QuestionAnswer` types) and their `*Changed` domain events are documented as
**sibling families** in the sections that follow: taught once, then tabulated.

## Invariants, business rules as testable units

Each aggregate has a co-located static **invariant class**, [`EventInvariants`](#eventinvariants),
[`SessionInvariants`](#sessioninvariants), [`SpeakerInvariants`](#speakerinvariants),
[`CategoryInvariants`](#categoryinvariants), [`QuestionInvariants`](#questioninvariants), whose methods
each return a [`Result`](group-01-result-error-handling.md#result) and are combined with
`Result.Combine(...)` in the factory and mutators. They build on
[`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (G02) for the generic
string-not-empty and max-length checks and add domain-specific rules: `SessionInvariants` carries the
length constants *shared with the EF configuration* so the domain rule and the column constraint can
never drift
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionInvariants.cs:12-34`),
plus the BR-49 status-eligibility check (`SessionInvariants.cs:78`) and the BR-122 zero-duration guard
(`SessionInvariants.cs:95`); `QuestionInvariants` validates the free-text enum-like fields against
allow-lists (`QuestionInvariants.cs:28-34,68`) and, for answers, checks each answer value against its
question type (Rating 1-5, Text max 2000, Email format, `QuestionInvariants.cs:115`); `CategoryInvariants`
enforces case-insensitive uniqueness of an item name within its category (BR-138, invoked from
`Category.cs:137`). Centralizing each rule as a named, side-effect-free method is what makes the domain
exhaustively unit-testable (`[Rubric §14, Testability]`) and keeps the ubiquitous language explicit:
the error codes (`"Event.AlreadyPublished"` at `Event.cs:224`, `"Session.Duration.Invalid"` at
`SessionInvariants.cs:100`) *are* the business vocabulary. The recurring `// BR-NN` comments are
traceability links back to `specifications.md`.

A nuance worth flagging: the `Status` field on Session is free-text, imported verbatim from Sessionize
(`Session.cs:31`), and [`SessionStatuses`](#sessionstatuses)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionStatuses.cs:8`) is the
constant catalogue of the recognized values plus the `IsEligible(...)` rule (everything except
`Declined`/`Cancelled` is eligible for public display, bookmarking, and feedback, BR-49,
`SessionStatuses.cs:45-47`). Using `const string` values instead of a C# `enum` means an unrecognized
Sessionize status does not break deserialization; it lives in `Domain` because eligibility is a domain
rule, and it is referenced from the cross-module bookmark validation too. `[Rubric §8, Data
Architecture]` (deliberate handling of externally-sourced data).

## Domain events and the outbox spine

Every state-changing method raises a domain event through the inherited `AddDomainEvent(...)`. The
events come in two shapes. The **aggregate-level** ones, [`EventChanged`](#eventchanged),
[`SessionChanged`](#sessionchanged), [`SpeakerChanged`](#speakerchanged),
[`CategoryChanged`](#categorychanged), [`QuestionChanged`](#questionchanged), derive from
[`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype)
and carry the [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate)
(Added/Updated/Deleted) plus a friendly label. The **child-level** ones, [`RoomChanged`](#roomchanged),
[`EventSpeakerChanged`](#eventspeakerchanged), [`SessionSpeakerChanged`](#sessionspeakerchanged),
[`SessionCategoryItemChanged`](#sessioncategoryitemchanged), the `*QuestionAnswerChanged` set, and the
rest, carry both the parent and child IDs (for example `RoomChanged(state, Id, room.Id, room.Name)` at
`Event.cs:347`) so a consumer can target the precise change and the module can invalidate the right
output-cache tag. These are **intra-module domain events**: they ride the outbox ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) but are
consumed inside Conference. They do not cross the wire to other services; that is the job of
integration events.

The flow is exactly the outbox spine from [G04](group-04-events-outbox.md): a mutator buffers the event
on the aggregate; on `SaveChangesAsync` the domain-event save-changes interceptor serializes it into an
[`OutboxMessage`](group-04-events-outbox.md#outboxmessage) row in the *same* transaction; dual dispatch
then delivers it at-least-once. Nothing in this chapter's code does any dispatching; the aggregates
only *declare* what happened, which is the Clean-Architecture division of labor (`[Rubric §6, CQRS &
Event-Driven]`). One domain detail is worth noting for the cross-context link: `Speaker.Delete()`
captures the previous `LinkedUserId` *before* clearing it and stuffs it into the `Deleted`
[`SpeakerChanged`](#speakerchanged) event (`Speaker.cs:232,241`), whose `PreviousLinkedUserId` payload
field exists precisely so the cross-context cleanup handler has what it needs even though the field is
already nulled within Conference (BR-70).

## The cross-aggregate cascade: a pure domain service

One business rule cannot live inside a single aggregate: deleting an `Event` must also delete every
`Session` belonging to it (BR-127), but Sessions are a *separate* aggregate (referenced by `EventId`,
not owned). Putting a `List<Session>` inside `Event` would violate the aggregate boundary. The answer
is a **domain service**, [`IEventCascadeDeletionDomainService`](#ieventcascadedeletiondomainservice)
and its implementation [`EventCascadeDeletionDomainService`](#eventcascadedeletiondomainservice)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Services/EventCascadeDeletionDomainService.cs:11`),
a pure, infrastructure-free coordinator that takes the pre-fetched `Event` plus its already-loaded
`Session` collection and orchestrates the deletes: soft-delete each session first (BR-55 cascades to
*its* children), then soft-delete the event (BR-72 cascades to rooms, speakers, and answers)
(`EventCascadeDeletionDomainService.cs:14-24`). This is `[Rubric §4, Domain-Driven Design]`'s textbook
"domain service for behavior that spans aggregates and belongs to no single one," and `[Rubric §3,
Clean Architecture]`'s purity discipline: the service does no I/O; the *application* layer fetches the
aggregates and saves them. It is the only Level-7/8 type in the chapter precisely because it depends on
two aggregates.

## Read models and the AI decision-support feature

The largest cluster in `Conference.Shared` is the **DTO** layer, the wire contracts that decouple the
API from the domain entities (`[Rubric §9, API & Contract Design]`; [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) chose manual/Mapperly
mapping over reflection-based AutoMapper). Most are straightforward projections:
[`EventDTO`](#eventdto), [`SessionDTO`](#sessiondto), [`SpeakerDTO`](#speakerdto),
[`ConferenceCategoryDTO`](#conferencecategorydto), [`QuestionDTO`](#questiondto), [`RoomDTO`](#roomdto),
and the per-child join DTOs, plus the speaker-facing feedback shapes
([`SessionFeedbackDTO`](#sessionfeedbackdto) and its [`RatingQuestionSummary`](#ratingquestionsummary)/[`TextQuestionResponses`](#textquestionresponses)
members). They carry the entity's `Id` (via the framework's `IBaseDTO` contract) and `init`-only
properties: read contracts, immutable after construction.

A distinct and more interesting subgroup is the **`DecisionSupport`** namespace: read models built
purely to help an organizer *curate* a conference. [`SessionSelectionDashboardDTO`](#sessionselectiondashboarddto)
is the composite; for one event it aggregates a [`CategoryDistributionDTO`](#categorydistributiondto)
(how sessions spread across tracks and levels), a [`SpeakerSessionOverlapDTO`](#speakersessionoverlapdto)
(speakers with multiple submissions), a [`ContentSimilarityDTO`](#contentsimilaritydto) (near-duplicate
talks), per-tier [`SpeakerLocalitySummary`](#speakerlocalitysummary) counts (the Atlanta-versus-elsewhere
breakdown that drives the local-speaker preference, tracked as a `CategoryItem` rather than a `Speaker`
field), and a list of [`SessionAiScoreDTO`](#sessionaiscoredto). The AI scores are produced by an
Anthropic-backed scoring service (in `Conference.Infrastructure`, outside this chapter) and persisted
as the [`SessionAiScore`](#sessionaiscore) aggregate;
[`ScoreEventSessionsResultDTO`](#scoreeventsessionsresultdto) reports a batch run's success and failure
counts. This organizer workflow is guarded by the `conference:session-selection:manage` capability
permission catalogued in [`ConferencePermissions`](#conferencepermissions) (`ConferencePermissions.cs:30`),
not by a feature flag. The one flag the module does carry,
[`ConferenceFeatures`](#conferencefeatures).`SessionizeIntegration`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/ConferenceFeatures.cs:15`), gates only
the Sessionize external sync that seeds the raw session data this dashboard then analyzes, wired
through the `[FeatureGate]`/`IFeatureGated` mechanism from
[G05](group-05-cqrs-pipeline.md#ifeaturegated) (`[Rubric §10, Cross-Cutting Concerns]`, [ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html)) on the
`RefreshFromSessionizeCommand`, not on the scoring or dashboard handlers.

## Authorization vocabulary and current-event selection

Two more `Shared` helpers deserve a mention because they encode policy the whole module relies on.
[`ConferencePermissions`](#conferencepermissions)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:9`)
is the catalogue of the module's **capability permissions** (`conference:events:manage`,
`conference:sessions:manage`, and so on, `ConferencePermissions.cs:12-30`), the stable string
identifiers endpoints require via `[HasPermission(...)]` rather than by role name. The `All` and
`ContentManagement` subsets (`ConferencePermissions.cs:33,49`) let a role grant an entire capability
set or the narrower session-catalog-curation slice (sessions, speakers, and the category taxonomy) at
once, a distinction capability checks express centrally and role checks cannot. This is the
permission-based authorization story (`[Rubric §11, Security]`, [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)), decided by the
role-to-permission grants declared in the module's registration, not scattered across controllers.

[`CurrentEventSelector`](#currenteventselector)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/CurrentEventSelector.cs:10`) is
the pure, generic helper every landing surface uses to pick *which* published event to feature: the
event live now (soonest to end), else the next upcoming (soonest to start), else the most recently
ended (`CurrentEventSelector.cs:38-52`). It shares the exact live-window math the backend enforces:
`StartDate` at 00:00 local through `EndDate + 1 day` at 00:00 local, converted from the event's IANA
time zone to UTC, with an unknown time-zone id degrading to treating the local dates as UTC
(`CurrentEventSelector.cs:64-85`). Because it is generic over the event model, each consumer passes its
own DTO plus accessor delegates, so the selection rule lives in one tested place rather than being
re-derived per surface.

## Crossing the module boundary: contracts, stubs, and integration events

Conference does not live alone. Three connection points join it to other modules, and all live in
`Conference.Shared` so neither side reaches into the other's domain (`[Rubric §7, Microservices
Readiness]`, `[Rubric §3, Clean Architecture]`):

- **Synchronous bookmark validation (inbound).** The Engagement module needs to validate that a
  session is bookmarkable (exists, not a service session, eligible status) and to enumerate a session's
  IDs by event. It depends on the
  [`ISessionBookmarkValidationService`](#isessionbookmarkvalidationservice) *interface*
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/ISessionBookmarkValidationService.cs:10`),
  implemented in `Conference.Application` in-process, or by a gRPC adapter when the modules run as
  separate services ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)). When Conference is *disabled* in a host,
  [`DisabledSessionBookmarkValidationService`](#disabledsessionbookmarkvalidationservice) is registered
  as a null-object stub that approves every validation and returns an empty ID set: graceful
  degradation rather than a missing-dependency crash.

- **Synchronous live-layer validation (inbound).** The Engagement conference-day live layer (polls and
  session Q&A) asks Conference whether a target event is published and inside its live window, and, for
  a session, who the assigned speakers are, whether it is a plenum, and the event's question moderation
  default. That contract is [`IEventLiveValidationService`](#ieventlivevalidationservice)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/IEventLiveValidationService.cs:11`),
  returning [`EventLiveInfo`](#eventliveinfo) and [`SessionLiveInfo`](#sessionliveinfo) snapshots so the
  caller never references a Conference domain entity. The moderation default is the
  [`QuestionModerationDefault`](#questionmoderationdefault) enum (`Pending`/`Approved`, BR-233,
  `QuestionModerationDefault.cs:7`) carried on the `Event` (`Event.cs:54`). Its disabled stub,
  [`DisabledEventLiveValidationService`](#disabledeventlivevalidationservice), deliberately **fails
  open**: it reports the event as published with an always-open window
  (`DisabledEventLiveValidationService.cs:25-42`) so the live-layer handlers can run without an
  in-process Conference module, at the cost of skipping the published and live-window checks until the
  host is wired to the Conference gRPC adapter.

- **Asynchronous speaker linking (outbound).** When Conference links or unlinks a Speaker to or from an
  Identity `User` (the manual link command, or the automatic email-match triggered by Identity's
  `UserRegistered` event), it publishes [`SpeakerLinkedToUser`](#speakerlinkedtouser) /
  [`SpeakerUnlinkedFromUser`](#speakerunlinkedfromuser)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/IntegrationEvents/SpeakerLinkedToUser.cs:20`),
  integration events extending
  [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent). Identity subscribes and
  sets or clears `User.LinkedSpeakerId`, so the next JWT refresh carries the `speaker_id` claim
  (BR-209). This is the eventually-consistent replacement for what used to be a direct cross-module
  service call: the User-to-Speaker bidirectional link now survives the service split because it
  travels as an event over the broker ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)/[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).

## End-to-end: one organizer action

To see the chapter cooperate, follow an organizer changing a room on a session's parent event. The
application handler loads the [`Event`](#event) aggregate (with its `Rooms` hydrated by the navigation
populator), calls `event.UpdateRoom(...)` (`Event.cs:363`), which routes through `GetRoomOrNotFound`
(returning a `NotFound` [`Result`](group-01-result-error-handling.md#result) if the room is gone,
`Event.cs:372-375`), delegates to the child's own `Room.Update(...)` (which validates *its*
invariants), and on success raises a [`RoomChanged`](#roomchanged) `Updated` event (`Event.cs:381`).
The handler calls `SaveChangesAsync`; the interceptor writes the `RoomChanged` to the outbox in the
same transaction; in-process dispatch busts the relevant output-cache tags so the next read is fresh.
No exception was thrown on the expected not-found path, no child was mutated from outside its
aggregate, no event was hand-dispatched, and the same code path would behave identically whether
Conference runs in the monolith or as its own service, which is exactly the property the framework
groups (G01 through G14) exist to provide, here made concrete in a domain you can reason about. For the
*why* behind each design choice, [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) (manual mapping), [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html) (navigation populators), [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)
(outbox), [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)/007/008 (database-per-service, gRPC, service topology), [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html) (permission-based
authorization), and [ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html) (feature flags) are the primary references; the business rules themselves
are catalogued in `MMCA.ADC/specifications.md`.

### AssemblyReference, ClassReference
<a id="assemblyreference"></a><a id="classreference"></a>
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/AssemblyReference.cs:5` · Level 0 · class (static) + class

- **What it is**: the two assembly-marker types that give `typeof()`-based assembly scanning a stable handle to the `MMCA.ADC.Conference.Domain` assembly. No behavior.

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `AssemblyReference` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/AssemblyReference.cs:5` | `static class` exposing `Assembly` (the `typeof(AssemblyReference).Assembly`, line 7) and `AssemblyName` (line 8) |
| `ClassReference` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/AssemblyReference.cs:11` | one-line empty `public class ClassReference { }`, a generic-argument handle for scanners that want a *type*, not an `Assembly` |

- **Depends on**: nothing first-party (`System.Reflection` only, `AssemblyReference.cs:1`).
- **Concept introduced, the assembly-marker pattern.** `[Rubric §2, Design Patterns]` (assesses whether patterns are idiomatic and solve a real problem): instead of hard-coding an assembly name string, scanners take a `typeof(...)` from a type they know lives in the target assembly. `AssemblyReference.Assembly` (`AssemblyReference.cs:7`) caches `typeof(AssemblyReference).Assembly`; `ClassReference` (`AssemblyReference.cs:11`) exists so a generic API like `AddSomething(typeof(ClassReference))` has a non-static type to point at. Every layer of every ADC module ships this same pair (see the same pair in [group-18 Conference.Application](group-18-conference-application.md#assemblyreference), [group-19 Conference.Infrastructure](group-19-conference-infrastructure.md#assemblyreference), and [group-20 Conference.API](group-20-conference-api-grpc.md#assemblyreference)), so the module loader and EF/handler discovery code is uniform across the codebase.
- **Walkthrough**: `AssemblyReference.Assembly` (`AssemblyReference.cs:7`) is a `static readonly Assembly`; `AssemblyName` (`AssemblyReference.cs:8`) is its `GetName().Name ?? string.Empty`. `ClassReference` (`AssemblyReference.cs:11`) has no members.
- **Why it's built this way**: a `typeof()` handle is refactor-safe (rename the assembly and the reference still compiles) where a magic string is not.
- **Where it's used**: Scrutor assembly scanning that registers domain-event handlers, EF entity configurations, and the like; the `ModuleLoader` reflection pass.

---

### ConferenceFeatures
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/ConferenceFeatures.cs:8` · Level 0 · class (static)

- **What it is**: the feature-flag name catalog for the Conference module. Currently one constant: `SessionizeIntegration = "Conference.SessionizeIntegration"` (`ConferenceFeatures.cs:15`), which gates the Sessionize external-data sync capability.
- **Depends on**: nothing first-party.
- **Concept introduced, feature flags as named constants.** `[Rubric §10, Cross-Cutting Concerns]` (assesses how cross-cutting behavior like flags/config is centralized rather than scattered). The constant value matches a key under the `"FeatureManagement"` configuration section (doc comment `ConferenceFeatures.cs:3-7`) and is consumed with `Microsoft.FeatureManagement` via `[FeatureGate]` attributes and the [`IFeatureGated`](group-05-cqrs-pipeline.md#ifeaturegated) marker. Centralizing the *string* here means the flag name appears once; a typo cannot silently split a flag into two. The `"{Module}.{Feature}"` naming convention keeps flags from different modules unambiguous in one config file.
- **Walkthrough**: a single `public const string` (`ConferenceFeatures.cs:15`). The doc comment (`ConferenceFeatures.cs:10-14`) records the runtime contract: when the flag is disabled, `RefreshFromSessionizeCommand` short-circuits with a failure result and organizers must manage event data manually.
- **Why it's built this way**: isolating Sessionize sync behind a flag lets organizers turn the integration off during a Sessionize API maintenance window without redeploying.
- **Where it's used**: checked via `IFeatureManager` at the top of the [`RefreshFromSessionizeCommand`](group-18-conference-application.md#refreshfromsessionizecommand) handler (group-18).

---

### ConferencePermissions
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Authorization` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:9` · Level 0 · class (static)

- **What it is**: the Conference module's **capability permission catalog**, the stable string identifiers its endpoints require via [`[HasPermission(...)]`](group-08-auth.md#haspermissionattribute) instead of role names. Seven `manage` capabilities (`conference:events:manage`, `:sessions:manage`, `:speakers:manage`, `:rooms:manage`, `:categories:manage`, `:questions:manage`, `:session-selection:manage`) plus two curated sets.
- **Depends on**: nothing first-party.
- **Concept reinforced, capability permissions over role names (the consumer side).** `[Rubric §11, Security]` (assesses whether authorization is expressed as fine-grained capabilities rather than coarse role checks scattered across controllers). This is ADC's use of the framework's permission mechanism (see [`IPermissionRegistry`](group-08-auth.md#ipermissionregistry) and [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) in [G08](group-08-auth.md)). The values are deliberately stable strings (the doc comment, `ConferencePermissions.cs:3-8`, notes they may appear in tokens or logs). The class also exposes two `IReadOnlyList<string>` groupings: `All` (every Conference permission, for granting an entire capability set to a role at once) and `ContentManagement` (the curation subset, `SessionsManage` + `SpeakersManage` + `CategoriesManage`). `ContentManagement` is the load-bearing one: per its doc comment (`ConferencePermissions.cs:44-48`), a content-editor role (see [`RoleNames`](group-08-auth.md#rolenames)) holds exactly the catalog-curation capabilities *without* event structure, rooms, questions, or session selection, a distinction the registry expresses centrally that scattered `[Authorize(Roles = ...)]` lists could not.
- **Walkthrough**: seven `public const string` capability fields (`ConferencePermissions.cs:12-30`), then `All` (`ConferencePermissions.cs:33-42`) and `ContentManagement` (`ConferencePermissions.cs:49-54`) as collection-expression `IReadOnlyList<string>` properties.
- **Why it's built this way**: a per-module catalog keeps each module's capabilities self-contained; pairing the constants with named subsets means the role-to-permission grants in the module's registration read declaratively (`[.. All]` for the organizer, `[.. ContentManagement]` for the content editor).
- **Where it's used**: referenced by every Conference controller's `[HasPermission(...)]` attributes and by the role-to-permission grants in [`AddModuleConferenceAPI`](group-20-conference-api-grpc.md#dependencyinjection) (which calls [`AddPermissions`](group-08-auth.md#authorizationextensions)).

---

### SessionStatuses
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionStatuses.cs:8` · Level 0 · class (static)

- **What it is**: the catalog of the six recognized Sessionize session-status strings, plus a behavioral predicate `IsEligible()` that gates public display, attendee bookmarking, and post-session feedback (BR-49). `Session.Status` is a free-text field imported from Sessionize; this class is the single place in the domain that gives those strings behavioral significance.
- **Depends on**: nothing first-party (`System.StringComparison` only).
- **Concept introduced, avoiding premature enumeration for external data.** `[Rubric §4, Domain-Driven Design]` (assesses a model that mirrors the business and uses ubiquitous language) and `[Rubric §8, Data Architecture]` (assesses deliberate handling of externally-sourced data). Sessionize can return a status string not yet in this list; using `const string` values instead of a C# `enum` means an unknown status does not break deserialization, the domain simply treats it as unrecognized rather than eligible. `AllKnownStatuses` lets callers populate filter dropdowns without re-listing the constants by hand.
- **Walkthrough**
  - Six `const string` values (`SessionStatuses.cs:11-26`): `Accepted`, `Waitlisted`, `AcceptQueue` (`"Accept_Queue"`), `Nominated`, `DeclineQueue` (`"Decline_Queue"`), `Declined`. Note two of the literal values carry an underscore the C# identifier does not.
  - `AllKnownStatuses` (`SessionStatuses.cs:31-39`): a `static readonly IReadOnlyList<string>` collection-expression of all six, for organizer filter UIs.
  - `IsEligible(string? status)` (`SessionStatuses.cs:45-47`): returns `true` unless `status` equals `"Declined"` or the literal `"Cancelled"` (case-insensitive, `StringComparison.OrdinalIgnoreCase`). `"Cancelled"` is deliberately *not* in `AllKnownStatuses`, it is a defensive guard for a Sessionize value seen in the wild but not part of the formal six.
- **Why it's built this way**: keeping the eligibility predicate in the domain (not the application or API layer) ensures every consumer, command handler, query filter, and UI visibility check applies the identical definition. Adding a new ineligible status is a one-line edit here, not a grep across handlers.
- **Where it's used**: [`SessionInvariants.EnsureStatusIsEligible`](#sessioninvariants) (same group), the Sessionize sync strategy's pre-import eligibility check, the session-selection dashboard's status bucketing, the public session-list query filter, and the bookmark/feedback guards (groups 18-22).

---

### SessionInvariants
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionInvariants.cs:10` · Level 4 · class (static)

- **What it is**: the domain invariant-rule library for the [`Session`](#session) aggregate and its children: title non-empty/max-length, answer-value non-empty/max-length, a not-a-service-session guard (BR-91), status eligibility for engagement actions (BR-49), and an end-after-start time check (BR-122). The length **constants** declared here are referenced by *both* domain validation and EF configuration so a column constraint and a domain rule can never silently diverge (doc comment, `SessionInvariants.cs:6-9`).
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (Level 3), [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error) (group-01), and [`SessionStatuses`](#sessionstatuses) (same group, Level 0).
- **Concept**: the static-invariant-class pattern (methods returning [`Result`](group-01-result-error-handling.md#result), combined with `Result.Combine`) was introduced for the framework in [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants). `[Rubric §4, Domain-Driven Design]` (invariants live in the domain, not in handlers or the database). Two members are worth calling out:
  - `EnsureStatusIsEligible` (`SessionInvariants.cs:78-85`) delegates to `SessionStatuses.IsEligible(status)`, so the eligibility whitelist lives in the Level-0 catalog and is reused here: there is one definition of "eligible".
  - `EnsureEndsAtIsAfterStartsAt` (`SessionInvariants.cs:95-107`) guards zero-duration sessions: `endsAt <= startsAt` fails with an invariant error, and both nullable parameters must be non-null for the check to run (null means "not yet scheduled").
- **Walkthrough**: eight `const int` length constants (`SessionInvariants.cs:13-34`) plus two `static readonly` range constants (`SessionInvariants.cs:41-44`), the latter the `ManualIdRangeStart` (`999_999_000`) / `ManualIdRangeEnd` (`999_999_999`) reserved id window for sessions *not* imported from Sessionize (organizer-created and seeded samples sit above any real Sessionize id so they never collide, the int PK *is* the Sessionize id). Then five `Ensure*` methods returning `Result`: `EnsureTitleIsValid` (line 46), `EnsureAnswerValueIsValid` (line 51), `EnsureNotServiceSession` (line 62), `EnsureStatusIsEligible` (line 78), and `EnsureEndsAtIsAfterStartsAt` (line 95), each tagging errors with a `source` string for tracing.
- **Why it's built this way**: sharing `TitleMaxLength` etc. between `HasMaxLength(SessionInvariants.TitleMaxLength)` in EF config and the domain check keeps schema and rule in lockstep; the reserved id range encodes the Sessionize-id-is-the-PK design decision in one documented place.
- **Where it's used**: [`Session.Create`/`Update`](#session) and [`SessionQuestionAnswer.Create`/`UpdateAnswer`](#sessionquestionanswer); the application-layer Session validators; and EF configurations for column lengths (groups 18-19).

---

### SessionAiScore
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionAiScore.cs:12` · Level 5 · class (sealed)

- **What it is**: an aggregate root storing the AI-generated score for one session across seven criteria (topic relevance, description quality, novelty, actionable takeaways, depth/insight, credibility/experience, and an overall score), plus the model's free-text `Reasoning` and the `ModelUsed` identifier. One score per session; re-scoring replaces the existing record via `Update`.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (bound to `SessionAiScoreIdentifierType`), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error) (group-01).
- **Concept**: the factory-method-returns-`Result<T>` aggregate pattern (private ctor + `static Result<T> Create`) was introduced in [group-02](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype). `[Rubric §4, DDD]` and `[Rubric §11, Security]` overlap interestingly here: validating AI output *inside* the domain (range 1.0-10.0) means a model response is checked before it can reach the database, so an out-of-range or hallucinated value cannot enter storage even though the data originates from an external model. The `[IdValueGenerated]` attribute (`SessionAiScore.cs:11`) marks the id as database-generated.
- **Walkthrough**
  - Ten `private set` properties (`SessionAiScore.cs:15-42`): the FK `SessionId`, seven `decimal` scores (`OverallScore`, `TopicRelevanceScore`, `DescriptionQualityScore`, `NoveltyScore`, `ActionableTakeawaysScore`, `DepthOrInsightQualityScore`, `CredibilityExperienceScore`), and the `Reasoning`/`ModelUsed` text. The EF parameterless ctor (`SessionAiScore.cs:45-49`) seeds `Reasoning`/`ModelUsed` to `string.Empty` to satisfy non-nullable init.
  - `Create` (`SessionAiScore.cs:54-92`): combines seven `EnsureScoreInRange` checks via `Result.Combine`; on failure returns `Result.Failure<SessionAiScore>(result.Errors)`, otherwise constructs with `Id = default` (`SessionAiScore.cs:80`, the DB fills it).
  - `Update` (`SessionAiScore.cs:97-131`): re-runs the same seven range checks, then replaces every score field and the reasoning/model, used when re-scoring.
  - `EnsureScoreInRange` (`SessionAiScore.cs:133-140`): a private helper using the C# pattern `score is >= 1.0m and <= 10.0m`, shared by both `Create` and `Update` (no duplication).
  - Note: no domain events are emitted on scoring (there is no `AddDomainEvent` call in the file), because there are no domain-event consumers for score changes, so persistence alone suffices.
- **Why it's built this way**: self-contained range validation in the domain is the last line of defense against bad AI data; replacing (not appending) on re-score keeps exactly one current score per session.
- **Where it's used**: created/updated by the `ScoreEventSessions` handler (group-18), which calls the Anthropic scoring service (group-19); read by the organizer session-selection dashboard (group-21).
- **Caveats / not-in-source**: the `SessionAiScoreIdentifierType` alias is defined in `Conference.Shared`; its underlying type (int vs Guid) is not visible in this file.

---

### Session
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/Session.cs:16` · Level 6 · class (sealed)

- **What it is**: the richest aggregate root in the Conference module. `Session` owns three child collections ([`SessionSpeaker`](#sessionspeaker), [`SessionCategoryItem`](#sessioncategoryitem), [`SessionQuestionAnswer`](#sessionquestionanswer)) and coordinates their full lifecycle: creation, update, cascade soft-deletion, and a domain event for every structural change. Session IDs are Sessionize-assigned, not database-generated.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (bound to `SessionIdentifierType`), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute), [`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions) (the `IsIdValueGenerated` extension), [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error) (group-01); the domain entities [`Event`](#event) and [`Room`](#room) (reference navigations); [`SessionInvariants`](#sessioninvariants); the child entities and their domain events [`SessionChanged`](#sessionchanged), [`SessionSpeakerChanged`](#sessionspeakerchanged), [`SessionCategoryItemChanged`](#sessioncategoryitemchanged), [`SessionQuestionAnswerChanged`](#sessionquestionanswerchanged).
- **Concept introduced, the aggregate root as consistency boundary.** `[Rubric §4, Domain-Driven Design]` (assesses aggregates with a single transactional boundary and correct child-entity lifecycle management). An **aggregate root** is the only entry point for mutations inside its boundary: nothing outside `Session` can add or remove a `SessionSpeaker` directly, all such operations go through `Session.AddSessionSpeaker` / `RemoveSessionSpeaker`, etc. This guarantees three things at once:
  - **Invariant checking**: `AddSessionSpeaker` rejects a duplicate speaker (`Session.cs:308-315`).
  - **Event emission**: every structural change raises a domain event, making the change observable to other modules through the outbox ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) without the aggregate knowing who listens. `[Rubric §6, CQRS & Event-Driven]`.
  - **Cascade soft-delete**: `Delete()` (`Session.cs:263`) soft-deletes each non-deleted child before emitting `SessionChanged(Deleted)`, implementing BR-55 at the domain level rather than via a DB cascade or handler glue.

  The `private` constructors (`Session.cs:99` and `:101`) plus `static Result<Session> Create` (`Session.cs:150`) enforce that a `Session` is only ever built through a validated, event-emitting path.
- **Walkthrough**
  - **Properties** (`Session.cs:19-63`): fifteen `private set` domain fields, callers must use the mutation methods, not direct assignment. `Title` is non-nullable; `LiveUrl`/`RecordingUrl` (`Session.cs:47,51`) each carry a justified `[SuppressMessage(..."CA1056"...)]` (they hold a `string` from Sessionize rather than a `Uri`); `EventId`/`RoomId` (`Session.cs:60,63`) are scalar FKs.
  - **Reference navigations** (`Session.cs:66-71`): `Event?` and `Room?` are `[Navigation]`-tagged `get; set;` properties (not read-only) that EF and the navigation populator (group-11) hydrate; the doc comment notes `Event` exists for query filtering (BR-132).
  - **`Duration`** (`Session.cs:76-78`): a computed `int?` property (no column), derived from `StartsAt`/`EndsAt`.
  - **Child collections** (`Session.cs:80-96`): three `private readonly List<T>` fields exposed as `IReadOnlyCollection<T>` via `.AsReadOnly()`, each tagged `[Navigation(IsCollection = true)]`. The backing lists are mutable only through aggregate methods, the consistency boundary in code.
  - **`Create`** (`Session.cs:150`): validates `EnsureTitleIsValid` + `EnsureEndsAtIsAfterStartsAt` (`Session.cs:166-168`), then constructs and emits `SessionChanged(Added)` (`Session.cs:192`). Line 172 reads `typeof(Session).IsIdValueGenerated`; `Session` has no `[IdValueGenerated]` (IDs are Sessionize-assigned), so the factory assigns `id!.Value` directly rather than leaving `default` (`Session.cs:189`).
  - **`Update`** (`Session.cs:216`): same two-invariant check (`Session.cs:232-234`), mutates every field, emits `SessionChanged(Updated)` (`Session.cs:253`).
  - **`Delete`** (`Session.cs:263`): calls `base.Delete()` (sets `IsDeleted`), then iterates the three child lists soft-deleting each non-deleted child (`Session.cs:269-288`), then emits `SessionChanged(Deleted)` (`Session.cs:290`). Bails on the first child failure.
  - **Child mutation methods** (`AddSessionSpeaker`/`RemoveSessionSpeaker` at `Session.cs:304,335`; `AddSessionCategoryItem`/`RemoveSessionCategoryItem` at `:364,395`; `AddSessionQuestionAnswer`/`UpdateSessionQuestionAnswer`/`RemoveSessionQuestionAnswer` at `:425,449,472`): each delegates to the child's `Create`/`Delete`/`UpdateAnswer`, mutates the private list, and emits the child-specific `*Changed` event. The `Remove*`/`Update*` helpers route through `GetChildOrNotFound<...>` (the private wrappers at `Session.cs:494-507`) so a missing child id yields a `NotFound` result, not a null-ref.
  - **`SetSession*` methods** (`Session.cs:353,413,490`): `internal` setters used **only** by the navigation populator, they call `SetItems(_list, items)` (the base helper from `AuditableAggregateRootEntity`) to replace in-memory collections during query-side population, bypassing domain logic; never used on the command side.
- **Why it's built this way**: the aggregate boundary makes atomicity natural: one `SaveChangesAsync` commits the session and all its children together, and domain events on every method surface state changes to other modules via the outbox without tight coupling. `[Rubric §29, Resilience]`: cascade soft-delete prevents children being orphaned in a live-but-unreachable state.
- **Where it's used**: the central Conference entity: persisted by `EntityTypeConfigurationSQLServer<Session, SessionIdentifierType>` (group-19), read through `IEntityQueryService<Session, SessionDTO, SessionIdentifierType>`, and mutated by the Session command handlers (group-18).

---

### SessionCategoryItem
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionCategoryItem.cs:13` · Level 6 · class (sealed)

- **What it is**: a join entity linking a [`Session`](#session) to a [`CategoryItem`](#categoryitem), with database-generated identity (`[IdValueGenerated]`, `SessionCategoryItem.cs:12`). It is a child of the `Session` aggregate.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (bound to `SessionCategoryItemIdentifierType`), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), [`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions), [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute), [`Result`](group-01-result-error-handling.md#result), [`Session`](#session) (back-reference).
- **Concept introduced, the join entity.** `[Rubric §4, DDD]`: rather than a raw EF join *table*, a many-to-many association is modeled as a domain entity, so it can carry its own identity, audit fields, and participate in domain events through the owning aggregate. The three Session children ([`SessionSpeaker`](#sessionspeaker), this, and [`SessionQuestionAnswer`](#sessionquestionanswer)) all share this shape, they differ only in the FK(s) and any payload they carry.
- **Walkthrough**: `CategoryItemId` (`SessionCategoryItem.cs:16`, `private set`); `Session?` back-navigation (`SessionCategoryItem.cs:20`, `[Navigation]`); `SessionId` (`SessionCategoryItem.cs:23`, get-only, set by EF when the child is added to `Session._sessionCategoryItems`). `Create(id?, categoryItemId)` (`SessionCategoryItem.cs:36-48`): reads `typeof(SessionCategoryItem).IsIdValueGenerated` (`true` here), so `Id` stays `default` for the database to fill (`SessionCategoryItem.cs:44`). No domain validation (the association is structurally always valid).
- **Where it's used**: managed exclusively through [`Session.AddSessionCategoryItem`/`RemoveSessionCategoryItem`](#session).

---

### SessionQuestionAnswer
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionQuestionAnswer.cs:13` · Level 6 · class (sealed)

- **What it is**: a child entity of [`Session`](#session) storing an answer to a [`Question`](#question) for that session. Database-generated identity (`[IdValueGenerated]`, `SessionQuestionAnswer.cs:12`).
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (bound to `SessionQuestionAnswerIdentifierType`), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), [`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions), [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute), [`Result`](group-01-result-error-handling.md#result), [`Session`](#session), [`SessionInvariants`](#sessioninvariants).
- **Concept**: same join-entity pattern as [`SessionCategoryItem`](#sessioncategoryitem); the difference is a validated `AnswerValue` payload. `[Rubric §4, DDD]`.
- **Walkthrough**: `QuestionId` (`SessionQuestionAnswer.cs:16`) and `AnswerValue` (`SessionQuestionAnswer.cs:19`, seeded to `string.Empty` by the EF ctor on `SessionQuestionAnswer.cs:29`); `Session?` navigation (`SessionQuestionAnswer.cs:23`); get-only `SessionId` (`SessionQuestionAnswer.cs:26`). `Create(id?, questionId, answerValue)` (`SessionQuestionAnswer.cs:46-64`) validates non-empty/max-length via `SessionInvariants.EnsureAnswerValueIsValid` before constructing. `UpdateAnswer(answerValue)` (`SessionQuestionAnswer.cs:71-80`) re-validates and mutates the field.
- **Where it's used**: managed through [`Session.AddSessionQuestionAnswer`/`UpdateSessionQuestionAnswer`/`RemoveSessionQuestionAnswer`](#session).

---

### SessionSpeaker
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionSpeaker.cs:13` · Level 6 · class (sealed)

- **What it is**: a join entity linking a [`Session`](#session) to a [`Speaker`](#speaker), with database-generated identity (`[IdValueGenerated]`, `SessionSpeaker.cs:12`).
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (bound to `SessionSpeakerIdentifierType`), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), [`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions), [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute), [`Result`](group-01-result-error-handling.md#result), [`Session`](#session).
- **Concept**: the same join-entity pattern as [`SessionCategoryItem`](#sessioncategoryitem); the thinnest of the three (only a `SpeakerId` payload).
- **Walkthrough**: `SpeakerId` (`SessionSpeaker.cs:16`), `Session?` navigation (`SessionSpeaker.cs:20`), get-only `SessionId` (`SessionSpeaker.cs:23`). `Create(id?, speakerId)` (`SessionSpeaker.cs:36-48`) just assigns identity, no domain validation here. Crucially, the **duplicate-speaker** invariant lives in [`Session.AddSessionSpeaker`](#session) (`Session.cs:308-315`), not in this child: the aggregate root, not the child, owns cross-child uniqueness, the textbook placement of an invariant that spans the collection.
- **Where it's used**: managed through [`Session.AddSessionSpeaker`/`RemoveSessionSpeaker`](#session).

### EventLiveInfo
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/EventLiveInfo.cs:13` · Level 0 · record (sealed)

- **What it is**: an immutable three-field snapshot of one event's live-window facts, whether the event is published, and the UTC start and (exclusive) end of its live window. It is what the Engagement live layer reads to decide "is this conference happening right now" without ever touching Conference's `Event` aggregate.
- **Depends on**: nothing first-party (BCL `bool`/`DateTime` only).
- **Concept introduced, the cross-module "live window" snapshot.** `[Rubric §7, Microservices Readiness]` (assesses whether a module exposes a small, stable contract instead of leaking its internal entities across a boundary): rather than shipping the whole `Event` entity to another module (or, after extraction, another process), Conference does the time-zone arithmetic once, server-side, and hands back three plain values. The consumer then compares them against `DateTime.UtcNow` with **no** time-zone logic of its own (doc comment, `EventLiveInfo.cs:4-8`). The window is derived from the event's `StartDate`/`EndDate` and its IANA time zone: start is `StartDate` at 00:00 local, end (exclusive) is `EndDate + 1 day` at 00:00 local, both converted to UTC. `[Rubric §9, API & Contract Design]` (a narrow, purpose-built contract) also applies: this record carries exactly what a consumer needs to gate a live feature, nothing more.
- **Walkthrough**: a positional `sealed record` (line 13) with three parameters, `IsPublished` (bool), `LiveWindowStartUtc`, and `LiveWindowEndUtc` (both `DateTime`, the end being exclusive per the XML docs on lines 10-12). There is no behavior: the type is a pure value carrier, and being a `record` it gets structural equality for free.
- **Why it's built this way**: keeping the "when is an event live" definition in the owning module and putting only UTC instants on the wire means the rule lives in exactly one place, and the contract itself is time-zone-free. Consumers cannot drift from the canonical window because they never recompute it.
- **Where it's used**: produced by the real [`EventLiveValidationService`](group-18-conference-application.md#eventlivevalidationservice) (Conference.Application) behind [`IEventLiveValidationService.GetEventLiveInfoAsync`](#ieventlivevalidationservice), and across the process boundary by the [`EventLiveValidationServiceGrpcAdapter`](group-20-conference-api-grpc.md#eventlivevalidationservicegrpcadapter) (group-20). The fail-open stub [`DisabledEventLiveValidationService`](#disabledeventlivevalidationservice) returns `new EventLiveInfo(true, DateTime.MinValue, DateTime.MaxValue)`. It is consumed by the Engagement [`LivePoll`](group-23-engagement-live-layer.md#livepoll) create/open handlers, which enforce "draft requires a published event" and "opening a poll requires now to be inside the window".

---

### QuestionModerationDefault
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/QuestionModerationDefault.cs:7` · Level 0 · enum

- **What it is**: a two-value enum naming the initial status a newly submitted attendee question receives for an event's live Q&A (BR-233): `Pending` (queued for a moderator) or `Approved` (visible immediately, moderated after the fact).
- **Depends on**: nothing first-party.
- **Concept introduced, the per-event moderation policy knob.** `[Rubric §6, CQRS & Event-Driven]` (assesses whether events/commands carry enough context to be acted on without extra lookups): this small enum is the vocabulary the Engagement live layer reads to decide whether a freshly submitted [`SessionQuestion`](group-23-engagement-live-layer.md#sessionquestion) starts hidden or visible. Making it a two-value enum (rather than a bare `bool`) leaves room for future moderation modes and reads self-documentingly at the call site.
- **Walkthrough**: two explicitly-numbered members (lines 10, 13), `Pending = 0` (the safe default: unset/zero means "hold for review") and `Approved = 1`. Explicit numbering keeps the wire meaning stable if members are ever reordered.
- **Why it's built this way**: `Pending = 0` makes the conservative choice the default value, an event that never set a moderation preference holds new questions for review rather than publishing them unmoderated.
- **Where it's used**: carried on [`EventDTO.QuestionModerationDefault`](#eventdto) and inside [`SessionLiveInfo`](#sessionliveinfo) (so the live layer learns the owning event's policy in the same call that fetches session facts). The stub [`DisabledEventLiveValidationService`](#disabledeventlivevalidationservice) reports `Pending`. Consumed by the Engagement `SubmitQuestion` handler (group-23) when setting a new question's initial status.

---

### RefreshFromSessionizeResultDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/RefreshFromSessionizeResultDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: the response DTO for the Sessionize refresh endpoint (`POST /events/{id}/sessionize/refresh`, UC-6). It reports per-entity sync counts plus a list of non-fatal warnings so an organizer can confirm what was actually imported.
- **Depends on**: nothing first-party (BCL only).
- **Concept introduced, the informative mutation response.** `[Rubric §9, API & Contract Design]` (assesses stable, useful response contracts): rather than returning `204 No Content` for a bulk sync, the endpoint returns counts so the caller can verify the expected number of sessions, speakers, and categories landed. This is the read-back shape of a bulk write.
- **Walkthrough**: eight `required` properties (lines 10-31), six `int` counts (`CategoriesSynced`, `CategoryItemsSynced`, `RoomsSynced`, `QuestionsSynced`, `SpeakersSynced`, `SessionsSynced`); `SkippedSoftDeleted` (line 28, BR-136: entities soft-deleted in the app are *not* restored when a sync re-encounters them); and `Warnings` (line 31, `IReadOnlyList<string>`, non-fatal issues such as a duration violation or a date-range mismatch). Every property is `required`, so a partial or forgotten field cannot be constructed.
- **Why it's built this way**: `SkippedSoftDeleted` is surfaced explicitly because an organizer who soft-deleted a session and then re-ran a sync would otherwise be puzzled why their count doesn't match Sessionize; the count explains the gap.
- **Where it's used**: the [`RefreshFromSessionizeCommand`](group-18-conference-application.md#refreshfromsessionizecommand) handler aggregates its per-strategy [`SessionizeSyncResult`](group-18-conference-application.md#sessionizesyncresult) values into this DTO (group-18); the Conference Events controller returns it as `200 OK` (group-20).

---

### EventQuestionAnswerDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/EventQuestionAnswerDTO.cs:9` · Level 1 · record (class)

- **What it is**: the read/write DTO for one event-level question answer, linking an event to a metadata question with the answer text an organizer supplied. It is one of the three child-collection DTOs that [`EventDTO`](#eventdto) composes.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (over `EventQuestionAnswerIdentifierType`); the FK fields use the `EventIdentifierType` and `QuestionIdentifierType` aliases.
- **Concept introduced, the child-collection DTO and `required`/`init` immutability.** The DTO shape and the [`IBaseDTO`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) marker were taught in group-12; here is the family of child DTOs an aggregate DTO composes. `[Rubric §9, API & Contract Design]` (DTOs decoupled from domain entities, stable contracts): this record is the wire shape clients see, the [`EventQuestionAnswer`](#eventquestionanswer) join entity never crosses the boundary. Cross-aggregate references appear as **scalar FKs** (`QuestionId`), never nested objects, consistent with database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) where the related aggregate may live in a different source.
- **Walkthrough**: four `required init` properties (lines 12-21), `Id` (the strong id alias), `EventId` (FK to the parent event), `QuestionId` (FK to the question), and `AnswerValue` (the answer text). Being a `record class` with all-`required` members, it cannot be partially constructed and is immutable after creation.
- **Why it's built this way**: modelling the join as a flat DTO with scalar FKs keeps the contract stable and portable across the service boundary, the same shape the sibling child DTOs use.
- **Where it's used**: nested in [`EventDTO.EventQuestionAnswers`](#eventdto); mapped from the [`EventQuestionAnswer`](#eventquestionanswer) entity by its Mapperly mapper (group-18).

---

### EventSpeakerDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/EventSpeakerDTO.cs:8` · Level 1 · record (class)

- **What it is**: the thinnest of the event child DTOs, the many-to-many join row between an event and a speaker.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (over `EventSpeakerIdentifierType`); FK fields use `EventIdentifierType` and `SpeakerIdentifierType`.
- **Concept**: same child-collection DTO shape introduced on [`EventQuestionAnswerDTO`](#eventquestionanswerdto), a flat `record class` with `required init` members and scalar FKs. `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: three `required init` properties (lines 11-17), `Id`, `EventId` (FK to the parent event), and `SpeakerId` (FK to the speaker). Nothing else: this row exists only to associate an [`Event`](#event) with a [`Speaker`](#speaker).
- **Where it's used**: nested in [`EventDTO.EventSpeakers`](#eventdto); mapped from the [`EventSpeaker`](#eventspeaker) entity by [`EventSpeakerDTOMapper`](group-18-conference-application.md#eventspeakerdtomapper) (group-18).

---

### RoomDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/RoomDTO.cs:8` · Level 1 · record (class)

- **What it is**: the richest of the event child DTOs, a conference room within an event's venue, with display and accessibility metadata.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (over `RoomIdentifierType`); the FK uses `EventIdentifierType`.
- **Concept**: the same child-DTO shape as [`EventQuestionAnswerDTO`](#eventquestionanswerdto), extended with optional presentation fields. `[Rubric §9, API & Contract Design]` (nullable optional fields let a room carry only the metadata that exists without forcing empty strings).
- **Walkthrough**: `Id`, `Name`, and `EventId` are `required` (lines 11, 14, 32); `Sort` (line 17, display order) is a plain `int`; and four optional members, `Capacity` (`int?`), `Floor`, `Location`, and `AccessibilityInfo` (all `string?`, lines 20-29), default to null when absent. Note `AccessibilityInfo` carries the room's accessibility notes, part of the app's WCAG-aware venue data.
- **Where it's used**: nested in [`EventDTO.Rooms`](#eventdto); mapped from the [`Room`](#room) entity by its Mapperly mapper (group-18); rendered by the Conference Room list/detail pages (group-21).

---

### SessionLiveInfo
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/SessionLiveInfo.cs:17` · Level 1 · record (sealed)

- **What it is**: the session-level counterpart to [`EventLiveInfo`](#eventliveinfo), a snapshot of everything the live layer needs to gate a single session's polls and Q&A: the owning event's published flag and live window, the session's assigned speaker ids, whether the session is a plenum (whole-conference) session, and the event's question-moderation default.
- **Depends on**: [`QuestionModerationDefault`](#questionmoderationdefault) (a field); uses the `EventIdentifierType` and `SpeakerIdentifierType` aliases. BCL otherwise.
- **Concept introduced, the enriched cross-module session snapshot.** `[Rubric §7, Microservices Readiness]` (a single, sufficient contract crossing the boundary): the Engagement live layer must answer several questions before it lets someone open a poll or moderate a question, is the event published and live, who are the session's speakers (so it can grant them moderation rights, BR-236), is it a plenum session, and what is the default status for new questions (BR-233). Rather than force N separate cross-service calls, Conference bundles all of it into one record returned by [`GetSessionLiveInfoAsync`](#ieventlivevalidationservice). `[Rubric §12, Performance & Scalability]` (one round-trip, not many) is the payoff of the bundling.
- **Walkthrough**: a positional `sealed record` with seven parameters (lines 17-24), `EventId` (the owning event), `IsPublished`, `LiveWindowStartUtc`, `LiveWindowEndUtc` (same live-window semantics as [`EventLiveInfo`](#eventliveinfo)), `SpeakerIds` (`IReadOnlyCollection<SpeakerIdentifierType>`, the session's non-deleted assigned speakers), `IsPlenumSession` (bool), and `QuestionModerationDefault`. No behavior: a pure value carrier.
- **Why it's built this way**: the producer already loads the session and its owning event to compute the window, so it enriches the same result with the speaker set, plenum flag, and moderation default instead of making the consumer chase those separately. That keeps the speaker-rights and moderation decisions on data the owning module vouches for.
- **Where it's used**: produced by [`EventLiveValidationService.GetSessionLiveInfoAsync`](group-18-conference-application.md#eventlivevalidationservice) (which also enforces the eligibility rules BR-49/BR-91) and its gRPC adapter (group-20); the stub [`DisabledEventLiveValidationService`](#disabledeventlivevalidationservice) fails open with a default event id, an always-open window, no speakers, and `Pending`. Consumed by the Engagement `LivePoll` and `SessionQuestion` handlers (group-23) for the speaker-moderation and question-visibility checks.

---

### EventDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/EventDTO.cs:9` · Level 2 · record (class)

- **What it is**: the aggregate DTO for a conference event, the full wire shape a client reads or writes for the [`Event`](#event) aggregate, composing its three child collections (rooms, speaker associations, question answers) plus the event's own scalar fields and concurrency token.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) and [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) (both implemented, line 9); composes [`RoomDTO`](#roomdto), [`EventSpeakerDTO`](#eventspeakerdto), [`EventQuestionAnswerDTO`](#eventquestionanswerdto); carries [`QuestionModerationDefault`](#questionmoderationdefault).
- **Concept introduced, the aggregate DTO and optimistic-concurrency round-trip on the wire.** `[Rubric §9, API & Contract Design]` (aggregate DTOs compose child DTOs so a UI gets everything it needs in one call, [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) manual/Mapperly mapping): `EventDTO` is the Level-2 "composite" that bundles the Level-1 children. `[Rubric §8, Data Architecture]` (optimistic concurrency): implementing [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) means the DTO round-trips the EF `RowVersion` token (line 16) so an update form can detect a concurrent edit. The inline `SuppressMessage` on `RowVersion` (line 15) documents that returning a `byte[]` is intentional, it is the raw rowversion token, and a second suppression on `VenueMapUrl` (line 40) records that a URL is stored as a plain string because it comes from external Sessionize input.
- **Walkthrough**
  - Identity and concurrency: `Id` (`required`, line 12) and the nullable `RowVersion` (line 16).
  - Required core: `Name`, `StartDate`, `EndDate` (`DateOnly`), and `TimeZone` (the IANA id used to compute the live window) are `required` (lines 19-31).
  - Optional scalars: `Description`, `SessionizeCode`, `VenueAddress`, `VenueMapUrl`, `WiFiInfo` (all `string?`), plus `IsPublished` (bool), `QuestionModerationDefault` (BR-233, line 50), and the two Sessionize-refresh audit fields `LastSessionizeRefreshOn` (`DateTime?`) / `LastSessionizeRefreshBy` (`string?`, lines 53-56).
  - Child collections (lines 59-65): `Rooms`, `EventSpeakers`, and `EventQuestionAnswers`, each an `IReadOnlyCollection<>` of the matching child DTO, each defaulting to an empty collection (`= []`) so an event with no children is safe to render.
- **Why it's built this way**: composing the children inline lets a single `GET /Events/{id}` return the whole event graph without follow-up calls, and defaulting the collections to `[]` avoids null checks in the UI. The `IConcurrencyAware` token is the write-path guard that turns a lost-update into a 409 instead of a silent overwrite.
- **Where it's used**: produced by [`EventDTOMapper`](group-18-conference-application.md#eventdtomapper) (group-18), returned by the Conference Events controller (group-20), and consumed throughout the Events UI (group-21). It is also the concrete event model that [`CurrentEventDefaults`](#currenteventdefaults) binds [`CurrentEventSelector`](#currenteventselector) to.

---

### IEventLiveValidationService
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/IEventLiveValidationService.cs:11` · Level 3 · interface

- **What it is**: the cross-module service contract the Engagement live layer calls to validate an event's or session's live-layer eligibility, returning [`EventLiveInfo`](#eventliveinfo) / [`SessionLiveInfo`](#sessionliveinfo) without the caller ever referencing a Conference domain entity.
- **Depends on**: [`Result<T>`](group-01-result-error-handling.md#result) (via `MMCA.Common.Shared.Abstractions`, line 1); [`EventLiveInfo`](#eventliveinfo), [`SessionLiveInfo`](#sessionliveinfo); the `EventIdentifierType`/`SessionIdentifierType` aliases.
- **Concept introduced, the owned-interface cross-module boundary.** `[Rubric §7, Microservices Readiness]` (assesses boundaries that survive extraction into separate processes) and `[Rubric §3, Clean Architecture]` (a module depends on an interface it can consume, not on another module's internals): the interface lives in Conference's `*.Shared` project, the module that *owns* the data publishes the contract, and the interface is defined in terms of ids and small DTOs only. When both modules run in one host, the real Conference.Application implementation is injected directly; after extraction, the same interface is satisfied by a gRPC adapter. Engagement's code does not change either way. This is the same boundary pattern the module uses for [`ISessionBookmarkValidationService`](#isessionbookmarkvalidationservice).
- **Walkthrough**: two methods, both returning `Task<Result<...>>` with a trailing `CancellationToken`.
  - `GetEventLiveInfoAsync` (line 21): returns the event's published flag and live window, or a `NotFound` failure when the event does not exist. Consumers layer their own rules on top (draft creation requires published; opening a poll requires now to be inside the window), stated in the XML docs (lines 13-20).
  - `GetSessionLiveInfoAsync` (line 32): returns a session's live facts (the owning event's window plus speakers, plenum flag, and moderation default), or a failure when the session does not exist, is a service session (BR-91), or has an ineligible status (BR-49), per the docs (lines 23-31).
- **Why it's built this way**: returning [`Result<T>`](group-01-result-error-handling.md#result) rather than throwing lets the consumer branch on `NotFound`/eligibility failures as ordinary control flow; keeping the contract in `*.Shared` (id-and-DTO only) is what makes Conference extractable without breaking Engagement.
- **Where it's used**: implemented in-process by [`EventLiveValidationService`](group-18-conference-application.md#eventlivevalidationservice) (Conference.Application, group-18), served over gRPC by [`EventLiveValidationGrpcService`](group-20-conference-api-grpc.md#eventlivevalidationgrpcservice) and consumed across the boundary via [`EventLiveValidationServiceGrpcAdapter`](group-20-conference-api-grpc.md#eventlivevalidationservicegrpcadapter) (registered by `AddConferenceEventLiveValidationClient`, which `Replace`s whatever was in the container). Injected into the Engagement [`LivePoll`](group-23-engagement-live-layer.md#livepoll) and [`SessionQuestion`](group-23-engagement-live-layer.md#sessionquestion) handlers (group-23). When Conference is not loaded in a host, the [`DisabledEventLiveValidationService`](#disabledeventlivevalidationservice) stub stands in.

---

### DisabledEventLiveValidationService
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/DisabledEventLiveValidationService.cs:22` · Level 4 · class (sealed)

- **What it is**: the fail-open stub implementation of [`IEventLiveValidationService`](#ieventlivevalidationservice), registered when the Conference module is not loaded in a host (for example when Engagement runs as its own service without Conference in-process).
- **Depends on**: [`IEventLiveValidationService`](#ieventlivevalidationservice), [`Result`](group-01-result-error-handling.md#result), [`EventLiveInfo`](#eventliveinfo), [`SessionLiveInfo`](#sessionliveinfo), [`QuestionModerationDefault`](#questionmoderationdefault).
- **Concept introduced, the fail-open disabled-module stub (Null Object variant).** `[Rubric §2, Design Patterns]` (a Null-Object-style stub keeps consumers running when a dependency is absent) and `[Rubric §29, Resilience & Business Continuity]` (assesses graceful degradation): this stub deliberately **fails open**, it reports the event as published with an always-open window, so the Engagement live-layer handlers can complete without an in-process Conference module, at the cost of skipping the published/live-window checks (doc comment, lines 9-15). The real validation is restored when the host is wired to the Conference gRPC adapter, which `Replace`s this stub. It mirrors the convention where each owning module's `*.Shared` project ships a `Disabled*Service` stub for the interfaces it exposes (e.g. [`DisabledSessionBookmarkValidationService`](#disabledsessionbookmarkvalidationservice), named in the doc, line 19).
- **Walkthrough**: two one-line methods, each returning a completed `Task` wrapping a success `Result`.
  - `GetEventLiveInfoAsync` (line 25): `Result.Success(new EventLiveInfo(true, DateTime.MinValue, DateTime.MaxValue))`, published, with a window spanning all of time.
  - `GetSessionLiveInfoAsync` (line 34): a success [`SessionLiveInfo`](#sessionliveinfo) with a `default` (unknown) event id, always-open window, no speakers (`[]`), `IsPlenumSession = false`, and `QuestionModerationDefault.Pending`. The remarks (lines 29-33) note the downstream effect: consumers skip the event-match check when the event id is default, and speaker-based rights resolve to organizers only.
- **Why it's built this way**: fail-open (rather than fail-closed) is the right default here because the stub is only reached in a host that is *not* the authority on live windows; blocking every poll/question in that configuration would be worse than skipping a check that a properly-wired gRPC client will perform. The choice is explicit and documented, not accidental.
- **Where it's used**: registered as the default `IEventLiveValidationService` in hosts where Conference is disabled (see the service `Program.cs` files, group-16/group-20), then `Replace`d by the gRPC client in production wiring.

---

### CurrentEventSelector
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/CurrentEventSelector.cs:10` · Level 6 · class (static)

- **What it is**: a static, generic helper that picks which published event a landing surface should feature, live now, else the next upcoming, else the most recently ended, using the same live-window math the backend enforces. It also exposes the window computation itself.
- **Depends on**: nothing first-party (BCL `TimeZoneInfo`, `DateOnly`/`DateTime`, LINQ). It is generic over the caller's event model via accessor delegates.
- **Concept introduced, the shared-selection algorithm parameterized by accessors.** `[Rubric §16, Maintainability]` and `[Rubric §1, SOLID]` (one algorithm, many callers, without a shared base type): several surfaces need "which event is current" (the two ADC home hosts, the Engagement `LiveEventService`, the role-scoped Conference list pages), and each has its own event DTO. Rather than duplicate the classify-and-rank logic, `SelectCurrentOrNext<TEvent>` takes `Func<TEvent, ...>` accessors for start date, end date, and time-zone id, so it works over any shape without coupling to a concrete type. `[Rubric §27, Internationalization]` also applies: the window math is computed per the event's IANA time zone, and an unknown zone id degrades to treating the local dates as UTC (a defensive, resilience-minded fallback) rather than throwing.
- **Walkthrough**
  - `SelectCurrentOrNext<TEvent>(events, startDate, endDate, timeZoneId, utcNow)` (line 22): projects each event to its `(StartUtc, EndUtc)` window via `GetLiveWindowUtc` (lines 30-36), then applies the preference order, **live** events (`StartUtc <= utcNow < EndUtc`) ordered by soonest to end (lines 38-42), else **upcoming** events (`StartUtc > utcNow`) ordered by soonest to start (lines 44-48), else the most recently ended event (`OrderByDescending(EndUtc)`, line 52). Returns `null` when `events` is empty. Ties resolve by input order (stable ordering).
  - `GetLiveWindowUtc(startDate, endDate, timeZoneId)` (line 64): computes `startLocal = StartDate` at 00:00 and `endLocal = EndDate + 1 day` at 00:00, then converts both from the event's zone to UTC via `TimeZoneInfo.FindSystemTimeZoneById` / `ConvertTimeToUtc` (lines 69-77). On `TimeZoneNotFoundException` it falls back to `DateTime.SpecifyKind(..., Utc)` (lines 79-84), treating the local dates as UTC to match existing consumers.
- **Why it's built this way**: the accessor-delegate design lets one vetted implementation of the "current event" rule serve every surface, so the home-page countdown, the live layer, and the list-page default filter can never disagree about which event is featured. Colocating `GetLiveWindowUtc` here keeps the window definition identical to the one [`EventLiveInfo`](#eventliveinfo) advertises.
- **Where it's used**: called by both ADCHome hosts (`MMCA.ADC.UI` and `MMCA.ADC.UI.Web.Client`), the Engagement `LiveEventService`, and the Conference public/organizer list pages (session/speaker/room lists) to compute their default event filter; the [`EventDTO`](#eventdto)-shaped callers go through the [`CurrentEventDefaults`](#currenteventdefaults) convenience wrapper.

---

### CurrentEventDefaults
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/CurrentEventDefaults.cs:8` · Level 7 · class (static)

- **What it is**: a thin convenience wrapper over [`CurrentEventSelector`](#currenteventselector) specialized to the [`EventDTO`](#eventdto) shape, so the many list pages and services that work with `EventDTO` do not repeat the same accessor lambdas.
- **Depends on**: [`CurrentEventSelector`](#currenteventselector), [`EventDTO`](#eventdto).
- **Concept, the type-specialized wrapper (DRY over the generic helper).** `[Rubric §16, Maintainability]`: the generic [`CurrentEventSelector.SelectCurrentOrNext<TEvent>`](#currenteventselector) needs four accessor delegates on every call; since most callers pass `EventDTO`, this wrapper binds those lambdas once (`e => e.StartDate`, `e => e.EndDate`, `e => e.TimeZone`) so call sites shrink to `SelectCurrentOrNext(events, utcNow)`.
- **Walkthrough**: one method, `SelectCurrentOrNext(IEnumerable<EventDTO> events, DateTime utcNow)` (line 17), which forwards to [`CurrentEventSelector.SelectCurrentOrNext`](#currenteventselector) with the three `EventDTO` accessors and returns the selected `EventDTO?` (null when the input is empty). No other logic: all the ranking lives in the generic helper.
- **Why it's built this way**: keeping the `EventDTO` accessors in one place means a rename of an `EventDTO` date/time-zone property is a single edit here, not a change scattered across every list page.
- **Where it's used**: the Conference list pages and any `EventDTO`-based service computing a default event filter (group-21); callers passing a non-`EventDTO` model call the generic [`CurrentEventSelector`](#currenteventselector) directly.

### NowNextSessionDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/NowNextDTO.cs:29` · Level 0 · record

- **What it is**: one session row inside the "happening now / up next" snapshot. It carries just enough
  to render and deep-link a glanceable session tile: identity, title, room, and the start/end pair in
  both event-local wall-clock and UTC.
- **Depends on**: nothing first-party (the `SessionIdentifierType` alias resolves to `System.Guid`, a
  solution-wide `global using`); BCL only (`DateTime`, `DateTimeOffset`). This is an identity-less read
  projection, not a persisted-entity DTO, so it does not implement
  [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype).
- **Concept introduced, the dual-clock read model.** `[Rubric §9, API & Contract Design]` (assesses
  whether a contract gives each consumer the shape it needs without post-processing). This DTO ships
  each boundary time **twice**: `StartsAtLocal`/`EndsAtLocal` as `DateTime` wall-clock in the event's
  time zone (`NowNextDTO.cs:33-34`) for a badge or widget that just prints the string, and
  `StartsAtUtc`/`EndsAtUtc` as `DateTimeOffset` (`NowNextDTO.cs:35-36`) for a caller doing its own time
  math. The doc comment on the parent (`NowNextDTO.cs:6-7`) states the split rationale. `[Rubric §12,
  Performance & Scalability]`: precomputing both forms server-side keeps the mobile/widget client free
  of time-zone conversion.
- **Walkthrough**: a positional `sealed record` with seven parameters (`NowNextDTO.cs:29-36`):
  `SessionId` (the deep-link target), `Title`, a nullable `RoomName` (`null` when the session has no
  room assigned, `NowNextDTO.cs:32`), then the two local `DateTime`s and the two UTC `DateTimeOffset`s.
  There is no `Create` factory: this is a read-side projection, assembled by a query handler from an
  already-valid aggregate, not a domain value object that must guard its own invariants.
- **Why it's built this way**: a positional record gives free structural equality and immutability with
  no boilerplate, which is all a read model needs. It is the row element of
  [`NowNextDTO`](#nownextdto) rather than a standalone contract, so it lives in the same file ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)
  Wave 8, cited in the doc comment `NowNextDTO.cs:4`).
- **Where it's used**: nested as the `Now` and `Next` lists on [`NowNextDTO`](#nownextdto); populated by
  the Conference now-next query handler and served on the public now-next endpoint behind the Android
  home-screen widget.

### NowNextDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/NowNextDTO.cs:14` · Level 1 · record

- **What it is**: the "happening now / up next" snapshot for a single event: which sessions are running
  at the query instant and which start next, plus whether the event is currently live.
- **Depends on**: [`NowNextSessionDTO`](#nownextsessiondto) (Level 0, the row type); the
  `EventIdentifierType` alias (`System.Guid`); BCL (`IReadOnlyList<T>`).
- **Concept introduced, the composed glanceable read model.** `[Rubric §9, API & Contract Design]`
  (assesses purpose-built read contracts over exposing raw entities). Rather than make a widget page the
  full session list and filter client-side, this DTO is the entire payload of the now-next endpoint: one
  event's identity plus two pre-filtered session batches. `[Rubric §5, Vertical Slice]`: the snapshot is
  shaped by exactly one query's needs, not reused across unrelated screens.
- **Walkthrough**: a positional `sealed record` with five parameters (`NowNextDTO.cs:14-19`): `EventId`
  and `EventName` name the featured event; `IsLive` (`NowNextDTO.cs:17`) is `true` when the event's live
  window contains the query instant; `Now` is the sessions running right now (empty outside session
  hours) and `Next` is the next starting batch, all sharing the earliest future start
  (`NowNextDTO.cs:12-13,18-19`). Both batches are `IReadOnlyList<NowNextSessionDTO>`, so the shape is a
  fixed, ordered projection.
- **Why it's built this way**: batching `Next` as a list (not a single session) lets several sessions
  that share the same next start time all surface together, which the doc comment calls out explicitly
  (`NowNextDTO.cs:13`). Local-plus-UTC times live on the row type, keeping this envelope thin.
- **Where it's used**: returned by the Conference now-next query handler and its controller endpoint;
  consumed by the Android widget and other glanceable surfaces described in the doc comment
  (`NowNextDTO.cs:4-7`).

### SessionCategoryItemDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/SessionCategoryItemDTO.cs:8` · Level 1 · record

- **What it is**: the DTO for one row of the many-to-many join between a session and a category item
  (topic, format, level, and similar tag taxonomies).
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)
  (the identified-DTO contract); the `SessionCategoryItemIdentifierType`, `SessionIdentifierType`, and
  `CategoryItemIdentifierType` aliases.
- **Concept introduced, the join-row DTO.** `[Rubric §9, API & Contract Design]` (assesses contracts
  that mirror the relational model without leaking EF entities). This is the read-side twin of a link
  entity: it carries its own surface `Id` plus the two foreign keys that define the association, and
  nothing else. `[Rubric §8, Data Architecture]`: a join with its own identity (rather than a bare
  composite key) is what lets the parent's child collection be replaced and diffed row by row.
- **Walkthrough**: a `record class` implementing
  [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) with three
  `required init` members (`SessionCategoryItemDTO.cs:11-17`): `Id` (the join row's own key), `SessionId`
  (FK to the parent session), and `CategoryItemId` (FK to the category item). `required` forces every
  member to be set at construction; `init` freezes them after. It shares its exact shape with
  [`SessionSpeakerDTO`](#sessionspeakerdto) (see there for the family walkthrough).
- **Why it's built this way**: a manually-declared record (mapped by hand or by a Mapperly mapper, [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html))
  keeps the wire contract explicit and decoupled from the EF entity.
- **Where it's used**: nested as `SessionCategoryItems` on [`SessionDTO`](#sessiondto)
  (`SessionDTO.cs:75`); produced by the Conference session DTO mapper and navigation populators ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).

### SessionQuestionAnswerDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/SessionQuestionAnswerDTO.cs:9` · Level 1 · record

- **What it is**: the DTO linking a session to a question along with the speaker's answer value: the
  read-side row for a per-session questionnaire response (imported from Sessionize).
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype);
  the `SessionQuestionAnswerIdentifierType`, `SessionIdentifierType`, and `QuestionIdentifierType`
  aliases.
- **Concept**: the join-row DTO with a payload column, a variant of the shape introduced by
  [`SessionCategoryItemDTO`](#sessioncategoryitemdto). Unlike the pure two-FK joins, this one adds a
  data field. `[Rubric §9, API & Contract Design]` (a join that also carries an attribute of the
  relationship).
- **Walkthrough**: a `record class` implementing
  [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) with four
  `required init` members (`SessionQuestionAnswerDTO.cs:12-21`): `Id`, `SessionId` (FK to the parent
  session), `QuestionId` (FK to the question), and the distinguishing `AnswerValue` string
  (`SessionQuestionAnswerDTO.cs:21`) holding the answer text. This extra column is the only structural
  difference from the two pure join DTOs.
- **Why it's built this way**: modeling the answer as a first-class join row (with identity plus the
  answer value) lets the session own a replaceable collection of answers and lets the wire contract stay
  independent of the EF link entity.
- **Where it's used**: nested as `SessionQuestionAnswers` on [`SessionDTO`](#sessiondto)
  (`SessionDTO.cs:72`); produced by the session DTO mapper and navigation populators ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).

### SessionSpeakerDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/SessionSpeakerDTO.cs:8` · Level 1 · record

- **What it is**: the DTO for one row of the many-to-many join between a session and a speaker.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype);
  the `SessionSpeakerIdentifierType`, `SessionIdentifierType`, and `SpeakerIdentifierType` aliases.
- **Concept**: identical in shape to [`SessionCategoryItemDTO`](#sessioncategoryitemdto), the canonical
  two-FK join-row DTO. Both carry their own `Id` plus the two association foreign keys and nothing else.
- **Walkthrough**: a `record class` implementing
  [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) with three
  `required init` members (`SessionSpeakerDTO.cs:11-17`): `Id` (join row key), `SessionId` (FK to the
  parent session), and `SpeakerId` (FK to the speaker). The three pure join DTOs in this Sessions folder
  form a near-identical family, an `{Id, parent FK, target FK}` triple per join table:
  [`SessionSpeakerDTO`](#sessionspeakerdto) and [`SessionCategoryItemDTO`](#sessioncategoryitemdto) match
  member-for-member, while [`SessionQuestionAnswerDTO`](#sessionquestionanswerdto) adds one payload field.
- **Why it's built this way**: giving each join its own surface DTO (rather than exposing a raw
  composite key) keeps the child collections on [`SessionDTO`](#sessiondto) diffable and lets the
  contract stay independent of the EF link entities ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)).
- **Where it's used**: nested as `SessionSpeakers` on [`SessionDTO`](#sessiondto) (`SessionDTO.cs:69`);
  produced by the session DTO mapper and navigation populators ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)). This is the collection whose
  populator gap once dropped speakers from the list (vs. get-by-id) query, so it is the one to check when
  a session list shows no speakers.

### SessionDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/SessionDTO.cs:9` · Level 2 · record

- **What it is**: the full read-side contract for a conference session: its scalar fields (title,
  schedule, status flags, media URLs), its foreign keys to event and room, and its three child
  collections (speakers, question answers, category items).
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)
  and [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) (the two DTO contracts it
  implements); its three child DTOs [`SessionSpeakerDTO`](#sessionspeakerdto),
  [`SessionQuestionAnswerDTO`](#sessionquestionanswerdto), and
  [`SessionCategoryItemDTO`](#sessioncategoryitemdto); the `SessionIdentifierType`, `EventIdentifierType`,
  and `RoomIdentifierType` aliases.
- **Concept introduced, the concurrency-aware aggregate DTO.** `[Rubric §9, API & Contract Design]`
  (assesses a read contract that mirrors an aggregate faithfully) and `[Rubric §8, Data Architecture]`
  (optimistic concurrency carried to the client). Beyond
  [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)'s `Id`, this DTO
  also implements [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware), so it round-trips
  the EF `RowVersion` token (`SessionDTO.cs:16`): a client reads it, echoes it back on update, and the
  update fails cleanly if the row changed underneath. The `[SuppressMessage(... CA1819 ...)]` on the
  `byte[]?` (`SessionDTO.cs:15`) is a scoped, justified analyzer waiver, an array property is the shape
  EF's rowversion needs.
- **Walkthrough**
  - Identity and concurrency: `Id` (`SessionDTO.cs:12`) and the nullable `RowVersion` byte array
    (`SessionDTO.cs:16`) satisfy the two implemented DTO contracts.
  - Scalars (`SessionDTO.cs:19-60`): a `required Title`, an optional `Description`, an optional
    `StartsAt`/`EndsAt` pair, a free-text `Status` (Accepted/Declined/Waitlisted/Nominated), four
    `bool` flags (`IsInformed`, `IsConfirmed`, `IsServiceSession`, `IsPlenumSession`), two URL strings
    (`LiveUrl`, `RecordingUrl`) kept as `string` for Sessionize compatibility (each with its own scoped
    `CA1056` waiver, `SessionDTO.cs:46,50`), plus `AccessibilityInfo`, `ResourceLinks`, and a nullable
    `Duration` in minutes.
  - Foreign keys: a `required EventId` (`SessionDTO.cs:63`, every session belongs to an event) and an
    optional `RoomId` (`SessionDTO.cs:66`, a session may be unscheduled to a room).
  - Child collections (`SessionDTO.cs:69-75`): `SessionSpeakers`, `SessionQuestionAnswers`, and
    `SessionCategoryItems`, each an `IReadOnlyCollection<...>` defaulted to an empty collection literal
    `[]` so an unpopulated projection is never `null`.
- **Why it's built this way**: defaulting each child collection to `[]` means a list query that skips a
  populator returns an empty collection rather than a null reference; the trade-off is that a genuinely
  unpopulated collection is indistinguishable from an empty one, which is why the speakers-in-list
  populator gap was a silent bug and not a crash. Manual DTO shaping ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)) keeps the contract
  explicit; navigation populators ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)) fill the child collections on demand.
- **Where it's used**: returned by the Conference session read endpoints (get-by-id and paged list) and
  mapped from the `Session` aggregate by the session DTO mapper; consumed by the Conference UI session
  pages and the session-detail views.
- **Caveats / not-in-source**: `Status` is a free-text `string`, not a closed enum, matching the
  imported Sessionize vocabulary; the DTO does not itself constrain the allowed values.

### ISessionBookmarkValidationService
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/ISessionBookmarkValidationService.cs:10` · Level 3 · interface

- **What it is**: the cross-module service contract the Engagement module calls to check whether a
  session may be bookmarked, and to list a given event's session ids, without referencing Conference
  domain entities directly.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) (via
  `MMCA.Common.Shared.Abstractions`, `ISessionBookmarkValidationService.cs:1`); the
  `SessionIdentifierType` and `EventIdentifierType` aliases.
- **Concept introduced, the cross-module boundary interface.** `[Rubric §7, Microservices Readiness]`
  (assesses whether module coupling flows through an interface that can be re-satisfied over a wire when
  the modules split into separate services). The doc comment (`ISessionBookmarkValidationService.cs:5-9`)
  states the arrangement: the interface is **declared in the owning module's `Shared` project** and
  **implemented in Conference.Application**, so Engagement depends only on this abstraction. When the two
  modules run in one process, DI binds the real implementation; when Engagement runs as its own service,
  the same interface is satisfied by a gRPC adapter or by the disabled stub (see
  [`DisabledSessionBookmarkValidationService`](#disabledsessionbookmarkvalidationservice)). `[Rubric §6,
  CQRS & Event-Driven]`: the two methods are query-shaped (they read and validate, they do not mutate).
- **Walkthrough**: two async members.
  - `ValidateSessionForBookmarkAsync(SessionIdentifierType, CancellationToken)`
    (`ISessionBookmarkValidationService.cs:19`) returns `Task<Result>` and, per its doc comment
    (`ISessionBookmarkValidationService.cs:13-15`), checks that the session exists, is not a service
    session (BR-91), and has an eligible status (BR-49).
  - `GetSessionIdsByEventAsync(EventIdentifierType, CancellationToken)`
    (`ISessionBookmarkValidationService.cs:28`) returns the ids of all sessions in an event, used by
    Engagement for event-scoped bookmark filtering (BR-58). Both take `CancellationToken` as the final
    parameter, per the codebase convention.
- **Why it's built this way**: returning [`Result`](group-01-result-error-handling.md#result) rather than
  throwing lets Engagement fold a validation failure into its own command result; keeping the interface
  in `Shared` (not `Application`) is what lets a disabled-stub or gRPC implementation be swapped in
  without Engagement seeing Conference's internals ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) gRPC extraction, [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) service topology).
- **Where it's used**: injected into Engagement's bookmark command handlers; implemented by
  Conference.Application in-process, by a Conference gRPC adapter across services, and by
  [`DisabledSessionBookmarkValidationService`](#disabledsessionbookmarkvalidationservice) when Conference
  is not loaded in the host.

### DisabledSessionBookmarkValidationService
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DisabledSessionBookmarkValidationService.cs:30` · Level 4 · class (sealed)

- **What it is**: the no-op stub of
  [`ISessionBookmarkValidationService`](#isessionbookmarkvalidationservice), registered when the
  Conference module is not loaded in a host (for example the extracted Engagement service). It approves
  every validation and reports no sessions per event.
- **Depends on**: [`ISessionBookmarkValidationService`](#isessionbookmarkvalidationservice) (the
  interface it implements); [`Result`](group-01-result-error-handling.md#result) (via
  `MMCA.Common.Shared.Abstractions`, `DisabledSessionBookmarkValidationService.cs:1`).
- **Concept introduced, the disabled-module stub.** `[Rubric §7, Microservices Readiness]` (assesses
  graceful degradation when an owning module is out of process) and `[Rubric §34, Architecture Governance
  & Documentation]` (the stub is the explicit, named "module disabled" contract rather than a silent
  null binding). The doc comment (`DisabledSessionBookmarkValidationService.cs:5-28`) spells out the
  trade-off: `ValidateSessionForBookmarkAsync` returns success so Engagement's bookmark handlers still
  complete, **at the cost of skipping the BR-49/BR-91 eligibility checks**; the real validation then
  happens at the Conference service when bookmark events flow through the broker, or later via a
  Conference gRPC adapter. It notes this mirrors the codebase-wide convention where each owning module's
  `*.Shared` project ships a `Disabled*Service` stub (`DisabledBookmarkCountService` in Engagement,
  `DisabledAttendeeQueryService` in Identity).
- **Walkthrough**: a `sealed class` with two one-line members.
  - `ValidateSessionForBookmarkAsync(...)` (`DisabledSessionBookmarkValidationService.cs:33-34`) returns
    `Task.FromResult(Result.Success())`, unconditionally approving.
  - `GetSessionIdsByEventAsync(...)` (`DisabledSessionBookmarkValidationService.cs:37-38`) returns
    `Task.FromResult<IReadOnlyCollection<SessionIdentifierType>>([])`, an empty collection, so an
    event-filtered bookmark query degrades to "no bookmarks for this event" instead of throwing.
- **Why it's built this way**: returning cached completed tasks (no allocation of async state machines)
  keeps the stub cheap on a path that runs per request; the collection literal `[]` gives a benign empty
  answer. Making degradation explicit and named (not a null service) is the governance point ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)
  service topology).
- **Where it's used**: registered in the Engagement service's `Program.cs` (via the module's
  `RegisterDisabledStubs()`) to satisfy
  [`ISessionBookmarkValidationService`](#isessionbookmarkvalidationservice) when Conference is not
  in-process; never used when both modules run in one host.

### CategoryItemDistribution
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/CategoryDistributionDTO.cs:27` · Level 0 · record (sealed)

- **What it is**: the submission breakdown for a single category *item* (for example "Cloud", or "300 - Intermediate"): how many sessions tagged with that item were submitted, and how many landed in each status bucket. It is the innermost leaf of the category-balance analysis an organizer reads while selecting sessions.
- **Depends on**: `CategoryItemIdentifierType` (the module id alias, a solution-wide `global using`, so no first-party link, see the primer on [strongly-typed identifier aliases](00-primer.md)). No first-party type references beyond the alias.
- **Concept introduced, the decision-support read model.** `[Rubric §6, CQRS & Event-Driven]` (assesses read models shaped for the query rather than the write schema) and `[Rubric §12, Performance & Scalability]` (assesses computing aggregates server-side instead of shipping raw rows). This unit is a family of pure *analytics* DTOs that back the organizer's session-selection dashboard. Unlike the entity-mirroring DTOs elsewhere in this chapter (for example [`SessionDTO`](#sessiondto)), none of them implement [`IBaseDTO`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype): they carry no `Id`, are never persisted, and are not addressable resources. They are the *output* of read-side query handlers that fold hundreds of session rows into counts and scores the UI can render directly. `CategoryItemDistribution` is the leaf of that fold: one row per category item, pre-counted.
- **Walkthrough**: six `required init` members (`CategoryDistributionDTO.cs:30-45`). `CategoryItemId` and `CategoryItemName` identify the item; then four counts, `TotalSubmitted` (excludes declined, line 36), `AcceptedCount` (status "Accepted" or null, line 39), `AcceptQueueCount` (status "Accept_Queue", line 42), and `PendingCount` (Nominated or Waitlisted, line 45). Every field is `required`, so a distribution row is never half-populated. The status vocabulary is the same loose Sessionize-sourced set that [`SessionDTO.Status`](#sessiondto) carries; the counts are bucketed by the query handler, not by the record.
- **Why it's built this way**: pushing the count-by-status math into the handler and shipping just the totals keeps the dashboard client dumb and cheap, an organizer viewing category balance across a whole event never fetches individual sessions.
- **Where it's used**: nested as the `Items` collection on [`CategoryGroupDistribution`](#categorygroupdistribution); produced by `GetCategoryDistributionHandler` in [Conference.Application](group-18-conference-application.md), ultimately surfaced through [`SessionSelectionController`](group-20-conference-api-grpc.md#sessionselectioncontroller).

### ScoreEventSessionsResultDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SessionAiScoreDTO.cs:60` · Level 0 · record (sealed)

- **What it is**: the tiny outcome payload of a *batch AI scoring* operation: how many of an event's sessions were scored and how many failed. It is the response body a caller gets back after asking the system to score an event's sessions.
- **Depends on**: nothing first-party. Two `int` counts only.
- **Concept reinforced, the command result DTO.** `[Rubric §9, API & Contract Design]` (a write operation returns a small, honest summary of what it did). Unlike the query read models around it, this is the *result of an action* (scoring), not a projection of data. It reports partial success explicitly: scoring hundreds of sessions against an external AI model is expected to have some failures, so the contract carries both a success count and a failure count rather than an all-or-nothing boolean.
- **Walkthrough**: two `required init` members (`SessionAiScoreDTO.cs:63-66`), `SessionsScored` and `SessionsFailed`. That is the whole record; there is no aggregate id because a batch score spans an entire event.
- **Why it's built this way**: separating scored from failed lets the organizer UI show "48 scored, 2 failed" and offer a retry, rather than hiding partial progress behind a single flag.
- **Where it's used**: returned by `ScoreEventSessionsHandler` in [Conference.Application](group-18-conference-application.md); the individual scores it writes are read back as [`SessionAiScoreDTO`](#sessionaiscoredto) rows.

### SessionAiScoreDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SessionAiScoreDTO.cs:6` · Level 0 · record (sealed)

- **What it is**: the richest leaf in this family: the AI-generated score for one session, bundled with enough display context (title, status, speaker localities, categories, level) that a dashboard row is self-contained. It is what the organizer sees when the AI has ranked an event's submissions.
- **Depends on**: `SessionIdentifierType` alias (no first-party link). All other members are primitives, `string`, `DateTime`, or `IReadOnlyList<string>`.
- **Concept introduced, the self-contained scored row.** `[Rubric §12, Performance & Scalability]` (assesses shaping the payload so the client does no secondary lookups) and `[Rubric §9, API & Contract Design]`. The interesting move is that the score does not travel alone: alongside the numbers it carries `SpeakerLocalities`, `SessionCategories`, and `SessionLevel` (lines 48-54), so the organizer dashboard can print a complete, sortable row for each session without an N+1 fetch back to the [`Session`](#session), [`Speaker`](#speaker), or [`Category`](#category) aggregates. `[Rubric §13, Observability & Operability]`: the record also records *how* the number was produced, `ModelUsed` (line 39) and `ScoredOn` (line 42), so a score is auditable and its staleness visible.
- **Walkthrough**: `SessionId` + `SessionTitle` (lines 9-12, required) identify the row. Then the scores, all `required decimal` on a 1.0 to 10.0 scale: an `OverallScore` (line 15) plus six dimension sub-scores, `TopicRelevanceScore`, `DescriptionQualityScore`, `NoveltyScore`, `ActionableTakeawaysScore`, `DepthOrInsightQualityScore`, `CredibilityExperienceScore` (lines 18-33). `Reasoning` (line 36, required) holds the model's free-text justification. `ModelUsed` and `ScoredOn` (lines 39-42) capture provenance. The tail members are optional display context: `Status` (line 45, nullable), `SpeakerLocalities` and `SessionCategories` (lines 48-51, defaulted to `[]` so never null), and `SessionLevel` (line 54, nullable). `SpeakerLocalities` is the speaker-locality convention surfacing here: those tier names come from a [`CategoryItem`](#categoryitem) under the "Where are you traveling from" category (Sessionize id 121854), not from any geographic field on [`Speaker`](#speaker) (resolved by `SpeakerLocalityHelper` in Conference.Application, `SpeakerLocalityHelper.cs:19-33`).
- **Why it's built this way**: embedding display context in the score DTO avoids per-row lookups on a dashboard that shows every session in an event at once, and recording the model id and timestamp keeps an AI-produced number honest and re-scorable.
- **Where it's used**: nested as the `AiScores` collection on [`SessionSelectionDashboardDTO`](#sessionselectiondashboarddto); written by `ScoreEventSessionsHandler` (which returns a [`ScoreEventSessionsResultDTO`](#scoreeventsessionsresultdto) summary) and read back through [`SessionSelectionController`](group-20-conference-api-grpc.md#sessionselectioncontroller).
- **Caveats / not-in-source**: the 1.0 to 10.0 range and the status vocabulary are documented in the property comments and enforced by the scoring handler and the external model prompt, not by this record.

### SimilarSessionPair
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/ContentSimilarityDTO.cs:14` · Level 0 · record (sealed)

- **What it is**: two sessions judged to have overlapping content, with a computed similarity score and the specifics they share. It is one row of the "these look redundant" list organizers use to avoid accepting duplicate talks.
- **Depends on**: `SessionIdentifierType` alias (no first-party link). Otherwise `string`, `double`, and `IReadOnlyList<string>`.
- **Concept reinforced, the analysis-result row.** `[Rubric §12, Performance & Scalability]` (the similarity math runs server-side, the wire carries only the verdict) and `[Rubric §9, API & Contract Design]`. Like [`SessionAiScoreDTO`](#sessionaiscoredto), it is self-contained: each end carries id, title, and status so the UI can render and deep-link both sessions without a follow-up fetch, and it names *why* they matched (`SharedCategoryItems`, `SharedKeywords`) so the verdict is explainable rather than an opaque number.
- **Walkthrough**: the "A" end, `SessionAId`/`SessionATitle`/`SessionAStatus` (lines 17-23), and the "B" end, `SessionBId`/`SessionBTitle`/`SessionBStatus` (lines 26-32); the two ids and titles are `required`, the two statuses nullable. `SimilarityScore` (line 35) is a `required double` between 0.0 and 1.0. `SharedCategoryItems` and `SharedKeywords` (lines 38-41, both `required IReadOnlyList<string>`) explain the overlap.
- **Why it's built this way**: shipping the shared categories and keywords alongside the score turns "0.83 similar" into an actionable, auditable finding an organizer can trust when declining a redundant submission.
- **Where it's used**: nested as the `Pairs` collection on [`ContentSimilarityDTO`](#contentsimilaritydto); produced by `GetContentSimilarityHandler` in [Conference.Application](group-18-conference-application.md).

### SpeakerLocalitySummary
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SessionSelectionDashboardDTO.cs:45` · Level 0 · record (sealed)

- **What it is**: the roll-up for one locality tier (for example "Atlanta and Suburbs", "Georgia"): how many speakers fall in that tier and how their sessions break down by status. It backs the "are we programming enough local speakers?" view.
- **Depends on**: nothing first-party. A `string` tier name and four `int` counts.
- **Concept reinforced, locality as a category, not a field.** `[Rubric §4, DDD]` (assesses modeling a real domain concept faithfully rather than bolting on an ad-hoc attribute). The `LocalityTier` string is not read from any geographic property on [`Speaker`](#speaker): ADC tracks where a speaker travels from through a [`CategoryItem`](#categoryitem) under the "Where are you traveling from" category (Sessionize id 121854). `SpeakerLocalityHelper` (Conference.Application) resolves a speaker's tier from their category-item assignments (`SpeakerLocalityHelper.cs:19-33`) and even flags Atlanta/Georgia/Surrounding as "local" (`SpeakerLocalityHelper.cs:41-49`). This DTO is the pre-tallied output of that resolution.
- **Walkthrough**: five `required init` members (`SessionSelectionDashboardDTO.cs:48-60`). `LocalityTier` names the tier; `SpeakerCount` counts speakers in it; `SessionCount` totals their sessions; `AcceptedSessionCount` and `AcceptQueueSessionCount` (status "Accept_Queue") break those down. The status buckets mirror the ones on [`CategoryItemDistribution`](#categoryitemdistribution), keeping the vocabulary consistent across the dashboard.
- **Why it's built this way**: pre-counting by tier lets the organizer see local-versus-remote balance at a glance; deriving locality from the category system (rather than a speaker field) keeps the model aligned with how the data actually arrives from Sessionize.
- **Where it's used**: nested as the `SpeakerLocality` collection on [`SessionSelectionDashboardDTO`](#sessionselectiondashboarddto); assembled by `GetSessionSelectionDashboardHandler` in [Conference.Application](group-18-conference-application.md).

### SpeakerSessionSummary
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SpeakerSessionOverlapDTO.cs:37` · Level 0 · record (sealed)

- **What it is**: a compact summary of one submitted session as it appears inside a speaker's overlap entry: id, title, status, and the category tags on it. It is a leaf of the speaker-overlap view, not a general session projection.
- **Depends on**: `SessionIdentifierType` alias (no first-party link). Otherwise `string`, nullable `string`, and `IReadOnlyList<string>`.
- **Concept reinforced, the purpose-shaped leaf.** `[Rubric §6, CQRS & Event-Driven]`. This carries far less than the full [`SessionDTO`](#sessiondto): it exists only to list, under a speaker, the sessions that speaker submitted, so it drops everything the overlap review does not need (schedule, media links, concurrency token). `CategoryItemNames` is a flat list of names rather than join rows because the review just needs to read the tags, not edit them.
- **Walkthrough**: four `required init` members (`SpeakerSessionOverlapDTO.cs:39-49`). `SessionId` and `Title` identify the session; `Status` (nullable) is the loose Sessionize status; `CategoryItemNames` lists its category tags by name.
- **Why it's built this way**: shaping a minimal per-session leaf keeps the speaker-overlap payload small even when a speaker has several submissions, and pre-resolving category *names* (rather than ids) means the UI needs no [`CategoryItem`](#categoryitem) lookup.
- **Where it's used**: nested as the `Sessions` collection on [`MultiSessionSpeaker`](#multisessionspeaker); assembled by `GetSpeakerSessionOverlapHandler` in [Conference.Application](group-18-conference-application.md).

### CategoryGroupDistribution
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/CategoryDistributionDTO.cs:14` · Level 1 · record (sealed)

- **What it is**: the distribution for a single *category* (for example "Track" or "Level") together with the per-item breakdown inside it. It is the middle tier of the category-balance analysis, one level up from [`CategoryItemDistribution`](#categoryitemdistribution).
- **Depends on**: [`CategoryItemDistribution`](#categoryitemdistribution) (its `Items` collection); `ConferenceCategoryIdentifierType` alias (no first-party link).
- **Concept reinforced, the composition tier.** `[Rubric §6, CQRS & Event-Driven]`. The read model mirrors the category, category-item hierarchy of the [`Category`](#category) aggregate as a nested DTO graph shaped for display: a category names itself, then owns the list of its items' distributions.
- **Walkthrough**: three `required init` members (`CategoryDistributionDTO.cs:17-23`). `CategoryId` and `CategoryTitle` identify the category; `Items` is a `required IReadOnlyList<CategoryItemDistribution>`, one leaf per item.
- **Why it's built this way**: grouping item distributions under their parent category lets the dashboard render one balance table per category (a Track table, a Level table) without the client having to regroup a flat list.
- **Where it's used**: nested as the `Categories` collection on [`CategoryDistributionDTO`](#categorydistributiondto); produced by `GetCategoryDistributionHandler` in [Conference.Application](group-18-conference-application.md).

### ContentSimilarityDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/ContentSimilarityDTO.cs:7` · Level 1 · record (sealed)

- **What it is**: the top of the content-similarity analysis: a single wrapper around the list of similar-session pairs, sorted most-similar first. It is the payload behind the "possible duplicate talks" panel.
- **Depends on**: [`SimilarSessionPair`](#similarsessionpair) (its `Pairs` collection). No other first-party types.
- **Concept reinforced, the analysis envelope.** `[Rubric §9, API & Contract Design]`. Wrapping the pair list in a named record (rather than returning a bare array) gives the endpoint a stable, extensible shape: future summary fields (a threshold, a count) can be added without breaking the contract.
- **Walkthrough**: one `required init` member (`ContentSimilarityDTO.cs:10`), `Pairs`, an `IReadOnlyList<SimilarSessionPair>` documented as sorted by similarity score descending. The sort is the handler's responsibility, not the record's.
- **Why it's built this way**: a single-field envelope keeps the read contract symmetric with the other decision-support DTOs (each analysis has its own top-level type) and leaves room to grow.
- **Where it's used**: produced by `GetContentSimilarityHandler` in [Conference.Application](group-18-conference-application.md); the pairs it wraps drive the redundancy panel of the selection dashboard.

### MultiSessionSpeaker
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SpeakerSessionOverlapDTO.cs:18` · Level 1 · record (sealed)

- **What it is**: a speaker together with the sessions they submitted (one or more), plus a flag for whether they already have an accepted talk. Despite the name it includes single-session speakers too; it is named for the review scenario it powers (organizers should accept at most one session per speaker).
- **Depends on**: [`SpeakerSessionSummary`](#speakersessionsummary) (its `Sessions` collection); `SpeakerIdentifierType` alias (no first-party link).
- **Concept reinforced, the review-shaped grouping.** `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §12, Performance & Scalability]`. The read model is grouped by speaker (not by session) precisely because the decision it supports is per-speaker, and it precomputes `HasAcceptedSession` so the UI can immediately flag a speaker who already has a talk in, without scanning their session list client-side.
- **Walkthrough**: five members (`SpeakerSessionOverlapDTO.cs:21-33`). `SpeakerId` and `SpeakerName` (required) identify the speaker; `LocalityCategory` (line 27, nullable) is their locality tier from the "Where are you traveling from" category (id 121854), the same category-driven locality convention [`SpeakerLocalitySummary`](#speakerlocalitysummary) rolls up; `HasAcceptedSession` (required bool) is the precomputed accept flag; `Sessions` (required) is the `IReadOnlyList<SpeakerSessionSummary>` of their submissions.
- **Why it's built this way**: grouping submissions under the speaker and precomputing the accept flag makes the "one talk per speaker" rule enforceable at a glance, which is the entire purpose of the overlap view.
- **Where it's used**: nested as the `Speakers` collection on [`SpeakerSessionOverlapDTO`](#speakersessionoverlapdto); assembled by `GetSpeakerSessionOverlapHandler` in [Conference.Application](group-18-conference-application.md).

### CategoryDistributionDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/CategoryDistributionDTO.cs:7` · Level 2 · record (sealed)

- **What it is**: the top of the category-balance analysis: the full distribution of an event's sessions across every category, grouped by category then by item. Organizers use it to judge whether the accepted program is balanced across tracks and levels.
- **Depends on**: [`CategoryGroupDistribution`](#categorygroupdistribution) (its `Categories` collection), which in turn owns [`CategoryItemDistribution`](#categoryitemdistribution) leaves.
- **Concept reinforced, the three-tier read model.** `[Rubric §6, CQRS & Event-Driven]`. This completes the category, category-group, category-item nesting: `CategoryDistributionDTO` → many [`CategoryGroupDistribution`](#categorygroupdistribution) → many [`CategoryItemDistribution`](#categoryitemdistribution). The whole tree is computed once, server-side, from the event's sessions and their [`CategoryItem`](#categoryitem) assignments.
- **Walkthrough**: one `required init` member (`CategoryDistributionDTO.cs:10`), `Categories`, an `IReadOnlyList<CategoryGroupDistribution>`. The record is a pure envelope; all the counts live in the leaves.
- **Why it's built this way**: a single composite tree means the dashboard's category-balance view is one fetch, and each level maps cleanly onto a UI grouping (category heading, item rows, status columns).
- **Where it's used**: produced by `GetCategoryDistributionHandler`; also nested as the `CategoryDistribution` member of [`SessionSelectionDashboardDTO`](#sessionselectiondashboarddto), and surfaced through [`SessionSelectionController`](group-20-conference-api-grpc.md#sessionselectioncontroller).

### SpeakerSessionOverlapDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SpeakerSessionOverlapDTO.cs:8` · Level 2 · record (sealed)

- **What it is**: the top of the speaker-overlap analysis: every speaker who submitted at least one session for an event, ordered so multi-session speakers surface first. It backs the "watch for speakers with multiple submissions" review.
- **Depends on**: [`MultiSessionSpeaker`](#multisessionspeaker) (its `Speakers` collection), which in turn owns [`SpeakerSessionSummary`](#speakersessionsummary) leaves.
- **Concept reinforced, the ordered analysis envelope.** `[Rubric §9, API & Contract Design]`. Like [`ContentSimilarityDTO`](#contentsimilaritydto), it is a single-field wrapper around a list, and the ordering (multi-session speakers first) is a documented contract the handler upholds so the UI can show the speakers who need attention at the top.
- **Walkthrough**: one `required init` member (`SpeakerSessionOverlapDTO.cs:11`), `Speakers`, an `IReadOnlyList<MultiSessionSpeaker>` sorted multi-session-first.
- **Why it's built this way**: a named envelope keeps the contract consistent with the sibling analyses and leaves room to add summary fields, while the sort order encodes the review priority directly into the payload.
- **Where it's used**: produced by `GetSpeakerSessionOverlapHandler`; also nested as the `SpeakerOverlap` member of [`SessionSelectionDashboardDTO`](#sessionselectiondashboarddto).

### SessionSelectionDashboardDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SessionSelectionDashboardDTO.cs:8` · Level 3 · record (sealed)

- **What it is**: the composite that ties the whole family together: one event's session-selection dashboard, aggregating the headline counts, the category distribution, the speaker overlap, the locality breakdown, and the AI scores into a single payload.
- **Depends on**: [`CategoryDistributionDTO`](#categorydistributiondto), [`SpeakerSessionOverlapDTO`](#speakersessionoverlapdto), [`SpeakerLocalitySummary`](#speakerlocalitysummary), and [`SessionAiScoreDTO`](#sessionaiscoredto) (its members and collections); `EventIdentifierType` alias (no first-party link).
- **Concept reinforced, the composite dashboard read model.** `[Rubric §6, CQRS & Event-Driven]` (a query-shaped DTO assembled from several independent analyses) and `[Rubric §12, Performance & Scalability]` (one round trip instead of four). This is the root of the decision-support graph: rather than make the organizer UI call one endpoint per analysis, a single query composes all of them, plus the top-line event counts, into one immutable snapshot.
- **Walkthrough**: `EventId` + `EventName` (lines 11-14, required) identify the event. Five `required int` headline counts follow, `TotalSessions` (non-service sessions), `AcceptedSessions`, `AcceptQueueSessions`, `PendingSessions`, `DeclinedSessions` (lines 17-29), the same status buckets the leaf DTOs use, tallied at event scope. Then the four analysis members, all `required`: `CategoryDistribution` (line 32), `SpeakerOverlap` (line 35), `SpeakerLocality` (line 38, an `IReadOnlyList<SpeakerLocalitySummary>`), and `AiScores` (line 41, an `IReadOnlyList<SessionAiScoreDTO>`, documented as empty until an AI scoring run has happened).
- **Why it's built this way**: bundling the counts and all four analyses into one composite lets the organizer dashboard render its entire face from a single fetch, and lets the read side cache one blob per event. The `AiScores` list being allowed to arrive empty keeps the dashboard usable before any [`ScoreEventSessionsResultDTO`](#scoreeventsessionsresultdto) run has produced scores.
- **Where it's used**: returned by [`GetSessionSelectionDashboardQuery`](group-18-conference-application.md#getsessionselectiondashboardquery) (assembled by `GetSessionSelectionDashboardHandler` in [Conference.Application](group-18-conference-application.md)); served by [`SessionSelectionController`](group-20-conference-api-grpc.md#sessionselectioncontroller) and consumed by the organizer session-selection dashboard page in the Conference UI.

### LinkUserRequest
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/LinkUserRequest.cs:6` · Level 0 · record (sealed)

- **What it is**: the request body a client sends to manually bind an Identity `User` to a
  [`Speaker`](#speaker) (BR-209). It carries exactly one field, the `UserId` to link.
- **Depends on**: nothing first-party (uses the `UserIdentifierType` module alias → `int`); BCL only.
- **Concept introduced, the request record (API input contract).** `[Rubric §9, API & Contract Design]`
  (assesses whether inbound payloads are declared as explicit, typed contracts rather than loose
  parameters) and `[Rubric §7, Microservices Readiness]` (the contract lives in `Shared`, the project a
  caller can reference without pulling in Conference's Domain). Where the DTOs below are *outbound* read
  shapes, this is an *inbound* write shape: a `sealed record` with a single `required init`
  `UserId` (`LinkUserRequest.cs:9`). `required` means the model binder cannot leave it unset, and `init`
  makes it immutable once bound, so a controller receives a validated, read-only value rather than a
  mutable bag. The type is deliberately tiny: it exists so the link endpoint has a named, versionable
  body instead of a bare route/query scalar.
- **Walkthrough**: one member, `UserId` (`LinkUserRequest.cs:9`), the Identity-side id to attach to the
  speaker. There is no `SpeakerId` on the body, that comes from the route (the speaker being edited).
- **Why it's built this way**: strongly typing the body over the `UserIdentifierType` alias keeps "who"
  named end to end, and placing it in `Shared` lets the UI and any future extracted client bind the same
  contract without a Domain reference.
- **Where it's used**: the `SpeakersController` link action
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:46`)
  binds it and maps it to the [`LinkUserToSpeakerCommand`](group-18-conference-application.md#linkusertospeakercommand),
  whose handler publishes the [`SpeakerLinkedToUser`](#speakerlinkedtouser) integration event.

---

### RatingQuestionSummary
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SessionFeedbackDTO.cs:22` · Level 0 · record (sealed)

- **What it is**: one row of a session's aggregated *rating* feedback, the per-question roll-up of a
  numeric rating: the question, its average score, and how many responses fed that average. It is a
  child component of [`SessionFeedbackDTO`](#sessionfeedbackdto).
- **Depends on**: nothing first-party (uses the `QuestionIdentifierType` alias); BCL only.
- **Concept introduced, the hand-built query-projection record.** `[Rubric §6, CQRS & Event-Driven]`
  (assesses read models shaped for the query, not the table) and `[Rubric §9, API & Contract Design]`.
  Unlike the entity DTOs later in this part, this record does **not** implement
  [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) and is **not**
  produced by a Mapperly mapper: it is a bespoke aggregation shape assembled by a query handler from a
  GROUP-BY over answers. It exists purely as the wire shape of a computed report.
- **Walkthrough**: four `required init` members (`SessionFeedbackDTO.cs:25-34`), `QuestionId`,
  `QuestionText` (so the client renders a label without a second lookup), `AverageRating` (a `double`,
  the computed mean), and `ResponseCount` (the sample size behind that mean).
- **Why it's built this way**: carrying `QuestionText` and `ResponseCount` alongside the average makes
  the record self-describing, a UI can show "4.6 (from 32 responses)" straight from the payload.
- **Where it's used**: nested in [`SessionFeedbackDTO.Ratings`](#sessionfeedbackdto); built by
  [`GetSessionFeedbackHandler`](group-18-conference-application.md#getsessionfeedbackhandler).

---

### TextQuestionResponses
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SessionFeedbackDTO.cs:38` · Level 0 · record (sealed)

- **What it is**: the free-text counterpart to [`RatingQuestionSummary`](#ratingquestionsummary): all the
  individual text answers given to one free-text feedback question, grouped under that question. Also a
  child component of [`SessionFeedbackDTO`](#sessionfeedbackdto).
- **Depends on**: nothing first-party (uses the `QuestionIdentifierType` alias); BCL only.
- **Concept**: the hand-built query-projection record (see [`RatingQuestionSummary`](#ratingquestionsummary)).
  Where a rating collapses to a mean, text answers cannot be averaged, so they are grouped verbatim.
- **Walkthrough**: three `required init` members (`SessionFeedbackDTO.cs:41-47`), `QuestionId`,
  `QuestionText`, and `Responses` (an `IReadOnlyList<string>`, the raw text answers). Exposing the list
  as `IReadOnlyList<string>` signals the payload is a read-only snapshot.
- **Where it's used**: nested in [`SessionFeedbackDTO.TextResponses`](#sessionfeedbackdto); built by
  [`GetSessionFeedbackHandler`](group-18-conference-application.md#getsessionfeedbackhandler).

---

### CategoryItemDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Categories/CategoryItemDTO.cs:8` · Level 1 · record (class)

- **What it is**: the read-model shape of a [`CategoryItem`](#categoryitem), one selectable option (for
  example "Beginner" or "Advanced" inside a "Level" category). Carries the item id, display name, sort
  order, and the FK to its parent [`ConferenceCategoryDTO`](#conferencecategorydto).
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)
  (from `MMCA.Common.Shared.DTOs`); the aliases `CategoryItemIdentifierType` and
  `ConferenceCategoryIdentifierType`.
- **Concept introduced, the entity read DTO (mapped by Mapperly).** `[Rubric §4, DDD]` and `[Rubric §3,
  Clean Architecture]` (the read model is separate from the domain entity, so the API surface never
  leaks the aggregate), `[Rubric §9, API & Contract Design]` (a typed, versionable response shape), and
  `[Rubric §7, Microservices Readiness]` (it lives in `Shared`, referenceable without Domain). Every
  Conference entity has a companion DTO with the same shape rule:
  1. **It implements [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)**,
     the framework's minimal read-model contract, a single `required init Id` of the entity's id alias
     (`CategoryItemDTO.cs:11`). That is the hook the generic query/serialization plumbing keys on.
  2. **It is populated by a Mapperly-generated mapper, not by hand.** The companion
     [`IEntityDTOMapper<CategoryItem, CategoryItemDTO, CategoryItemIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype)
     (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/DTOs/CategoryItemDTOMapper.cs:12`)
     is a `[Mapper] partial class`, the source generator writes the field-by-field copy at compile time
     ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)), so there is no reflection cost and a shape mismatch is a build error.
- **Walkthrough**: four members (`CategoryItemDTO.cs:11-20`), `Id` (the `IBaseDTO` contract), the
  `required` `Name`, an optional `Sort` (`int`, display order), and the `required` `CategoryId` FK back to
  the parent category. `Sort` is a plain `int` (defaults to 0) rather than `required`, so an item without
  an explicit order sorts first.
- **Why it's built this way**: keeping the DTO a flat record with `init`-only members makes it an
  immutable snapshot the query pipeline can project, serialize, and cache without defensive copying;
  Mapperly keeps the entity→DTO copy allocation-light and drift-proof.
- **Where it's used**: nested inside [`ConferenceCategoryDTO.CategoryItems`](#conferencecategorydto) and
  [`SpeakerCategoryItemDTO`](#speakercategoryitemdto)/session tagging; projected by an
  [`IEntityQueryService<CategoryItem, CategoryItemDTO, ...>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  and returned by the Categories controllers.

---

### QuestionDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Questions/QuestionDTO.cs:9` · Level 1 · record (class)

- **What it is**: the read-model shape of a [`Question`](#question), a configurable prompt (for example
  "Dietary requirements" or "T-shirt size") that events, sessions, or speakers can be asked to answer.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype),
  [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) (both from
  `MMCA.Common.Shared.DTOs`); the alias `QuestionIdentifierType`.
- **Concept introduced, the concurrency-aware DTO.** `[Rubric §8, Data Architecture]` (assesses optimistic
  concurrency carried end to end). In addition to the entity-DTO pattern from
  [`CategoryItemDTO`](#categoryitemdto), this DTO implements
  [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware), which adds a nullable
  `byte[]? RowVersion` (`QuestionDTO.cs:16`), the EF SQL Server `rowversion` token round-tripped to the
  client so a later update can be rejected if the row changed underneath it. The `[SuppressMessage(...
  CA1819 ...)]` on the property (`QuestionDTO.cs:15`) is a scoped, justified suppression: exposing a
  `byte[]` from a property normally trips CA1819, but the token must round-trip as raw bytes.
- **Walkthrough**: eight members (`QuestionDTO.cs:12-34`), `Id` + `RowVersion` (the two contracts), the
  `required` `QuestionText`, then the optional descriptors `QuestionEntity` ("session"/"speaker"),
  `QuestionType` ("text"/"select"), `Sort`, `IsRequired`, and `QuestionSource` ("Sessionize" or "User",
  recording whether the question was imported or added in-app).
- **Why it's built this way**: carrying `RowVersion` on the DTO lets an edit form send back the exact
  token it read, so the concurrency check happens at the persistence boundary without the client tracking
  version state itself; the optional descriptors keep one DTO usable for every question flavor.
- **Where it's used**: mapped by
  `QuestionDTOMapper` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/DTOs/QuestionDTOMapper.cs`);
  returned by the Questions controller and consumed by the answer-collection UI.

---

### SessionFeedbackDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SessionFeedbackDTO.cs:6` · Level 1 · record (sealed)

- **What it is**: the aggregated feedback report for a single session, shown to the session's speaker
  (BR-210): the session identity plus two grouped result sets, numeric ratings and free-text responses.
- **Depends on**: [`RatingQuestionSummary`](#ratingquestionsummary),
  [`TextQuestionResponses`](#textquestionresponses); the aliases `SessionIdentifierType`,
  `QuestionIdentifierType`.
- **Concept, the composed query-projection report.** `[Rubric §6, CQRS & Event-Driven]` (a read model
  purpose-built for one query rather than a mapped entity). This is the parent that composes the two
  Level-0 records above. It does **not** implement
  [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype), it is not a
  CRUD read model but a computed report, so it is assembled by a handler, not a Mapperly mapper.
- **Walkthrough**: four `required init` members (`SessionFeedbackDTO.cs:9-18`), `SessionId` and
  `SessionTitle` (the report header), `Ratings` (an `IReadOnlyList<RatingQuestionSummary>`, one entry per
  rating question) and `TextResponses` (an `IReadOnlyList<TextQuestionResponses>`, one entry per free-text
  question). Splitting ratings from text mirrors the two answer kinds a session can collect.
- **Why it's built this way**: pre-aggregating on the server (averages and groupings) keeps the speaker
  UI a thin renderer and avoids shipping every raw answer row to the client.
- **Where it's used**: returned by the `SpeakersController` feedback action
  (`SpeakersController.cs:48`) via
  [`GetSessionFeedbackHandler`](group-18-conference-application.md#getsessionfeedbackhandler); rendered by
  the Speaker dashboard UI.

---

### SpeakerCategoryItemDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SpeakerCategoryItemDTO.cs:8` · Level 1 · record (class)

- **What it is**: the read-model shape of the [`SpeakerCategoryItem`](#speakercategoryitem) join row, the
  many-to-many link that attaches a [`CategoryItem`](#categoryitem) (a topic or locality) to a
  [`Speaker`](#speaker).
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype);
  the aliases `SpeakerCategoryItemIdentifierType`, `SpeakerIdentifierType`, `CategoryItemIdentifierType`.
- **Concept**: the entity read DTO (see [`CategoryItemDTO`](#categoryitemdto)), here for a *join* entity:
  a flat record of foreign keys, no editable content of its own.
- **Walkthrough**: three `required init` members (`SpeakerCategoryItemDTO.cs:11-17`), `Id` (the `IBaseDTO`
  contract), `SpeakerId` (parent FK), and `CategoryItemId` (the linked item). No concurrency token, a bare
  join row is add/remove only, so there is nothing to update optimistically.
- **Why it's built this way**: modeling the speaker→category-item relationship as an explicit join DTO
  (rather than an inline id list) keeps the child collection uniform with every other Conference join and
  lets the mapper project it like any other entity.
- **Where it's used**: nested in [`SpeakerDTO.SpeakerCategoryItems`](#speakerdto); mapped by
  `SpeakerCategoryItemDTOMapper`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerCategoryItemDTOMapper.cs`).

---

### SpeakerQuestionAnswerDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SpeakerQuestionAnswerDTO.cs:9` · Level 1 · record (class)

- **What it is**: the read-model shape of a speaker-level question answer, binding a [`Speaker`](#speaker)
  to a [`Question`](#question) together with the speaker's answer value.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype);
  the aliases `SpeakerQuestionAnswerIdentifierType`, `SpeakerIdentifierType`, `QuestionIdentifierType`.
- **Concept**: the entity read DTO (see [`CategoryItemDTO`](#categoryitemdto)). Unlike the bare
  [`SpeakerCategoryItemDTO`](#speakercategoryitemdto) join, this one carries a payload, the answer text, so
  it is a link *plus* a value.
- **Walkthrough**: four `required init` members (`SpeakerQuestionAnswerDTO.cs:12-21`), `Id`, `SpeakerId`
  (parent FK), `QuestionId` (the answered question), and `AnswerValue` (the response, stored as a string
  regardless of the question's declared type).
- **Why it's built this way**: keeping the answer as a flat `string AnswerValue` lets one DTO carry any
  question type's answer (text, a selected option) without a type-specific shape.
- **Where it's used**: nested in [`SpeakerDTO.SpeakerQuestionAnswers`](#speakerdto); mapped by the
  speaker DTO mappers in the Conference Application layer.

---

### CategoryItemChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Categories.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/DomainEvents/CategoryItemChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the domain event a [`Category`](#category) aggregate raises when one of its
  [`CategoryItem`](#categoryitem) children is added, updated, or removed. It carries the parent
  category id, the child item id, and the item's display name.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) (Level 1),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) (Level 0); the
  identifier-type aliases `ConferenceCategoryIdentifierType` and `CategoryItemIdentifierType` (module
  `global using` aliases, see the [primer](00-primer.md)).
- **Concept introduced, the child-change domain event.** `[Rubric §6, CQRS & Event-Driven]` (assesses
  whether state changes are expressed as typed, first-class events that typed handlers can subscribe to)
  and `[Rubric §4, DDD]` (domain events are part of the ubiquitous language, an aggregate announces what
  happened inside its boundary). Every Conference child or join entity has a companion `Changed` record.
  Two design choices are visible here and reused across this whole family:
  1. **It derives from [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) directly, not from
     [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype).**
     `EntityChangedEvent<T>` models a single aggregate-root id; a child change needs *two* identifiers
     (the parent aggregate and the child) plus a descriptor, so it cannot fit that one-id shape. The
     aggregate-root lifecycle events later in this part ([`CategoryChanged`](#categorychanged) and its
     siblings) do use `EntityChangedEvent<T>`.
  2. **It is a `sealed record class` with no behavior.** Structural equality and the inherited
     `MessageId` / `DateOccurred` come from `BaseDomainEvent`; the type exists purely so
     `IDomainEventHandler<CategoryItemChanged>` can be registered and dispatched independently of every
     other event type.
- **Walkthrough**: four positional members (`CategoryItemChanged.cs:13-17`), `State` (the
  `Added`/`Updated`/`Deleted` transition), `CategoryId` (the parent), `CategoryItemId` (the child), and
  `Name` (the item's display name, so a handler or log line has a human-readable label without re-loading
  the entity).
- **Why it's built this way**: keeping the payload flat and self-describing (ids plus a name) means a
  downstream handler never has to re-query the aggregate to act, and the event survives serialization
  through the dispatch pipeline unchanged.
- **Where it's used**: raised by [`Category`](#category)'s `AddCategoryItem`/`UpdateCategoryItem`/
  `RemoveCategoryItem`; collected on the aggregate and dispatched in-process by
  [`DomainEventDispatcher`](group-04-events-outbox.md#domaineventdispatcher) after `SaveChangesAsync`.
  No dedicated handler subscribes to it today; it is available for future observers and audit.

---

### ConferenceCategoryDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Categories/ConferenceCategoryDTO.cs:9` · Level 2 · record (class)

- **What it is**: the read-model shape of a [`Category`](#category) aggregate root (for example "Level",
  "Track", or "Session format"), including its child [`CategoryItemDTO`](#categoryitemdto) options.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype),
  [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware),
  [`CategoryItemDTO`](#categoryitemdto) (Level 1); the alias `ConferenceCategoryIdentifierType`.
- **Concept, the aggregate-root read DTO with a child collection.** `[Rubric §9, API & Contract Design]`
  and `[Rubric §8, Data Architecture]`. This combines both patterns seen above: it is a concurrency-aware
  DTO (`RowVersion`, as in [`QuestionDTO`](#questiondto)) *and* it nests a child collection of
  [`CategoryItemDTO`](#categoryitemdto), so the whole aggregate (category + its options) serializes in one
  response.
- **Walkthrough**: six members (`ConferenceCategoryDTO.cs:12-28`), `Id` + `RowVersion` (the contracts),
  the `required` `Title`, an optional `Sort` and `Type` ("session"/"speaker"), and the
  `CategoryItems` collection, an `IReadOnlyCollection<CategoryItemDTO>` initialized to `[]`
  (`ConferenceCategoryDTO.cs:28`) so it is never null even when the category has no items yet.
- **Why it's built this way**: defaulting the child collection to an empty collection literal removes
  null-checks downstream; nesting the items lets the categories UI render an editable category-with-options
  block from a single fetch.
- **Where it's used**: mapped by `ConferenceCategoryDTOMapper`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/DTOs/ConferenceCategoryDTOMapper.cs`);
  returned by the Categories controller and consumed by the category-management UI.

---

### EventQuestionAnswerChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/DomainEvents/EventQuestionAnswerChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the child-change event an [`Event`](#event) aggregate raises when one of its
  [`EventQuestionAnswer`](#eventquestionanswer) children is added, updated, or removed.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `EventIdentifierType`,
  `EventQuestionAnswerIdentifierType`, `QuestionIdentifierType`.
- **Concept**: the child-change domain event introduced by [`CategoryItemChanged`](#categoryitemchanged).
  The descriptor differs: instead of a display name it carries `QuestionId` (line 16), the FK to the
  [`Question`](#question) that was answered, so a handler knows *which* question the answer belongs to.
- **Walkthrough**: `State`, `EventId` (parent), `EventQuestionAnswerId` (child), `QuestionId` (the
  answered question), lines 14-17.
- **Where it's used**: raised by [`Event`](#event)'s event-question-answer management methods; dispatched
  in-process. No dedicated handler subscribes today.

---

### EventSpeakerChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/DomainEvents/EventSpeakerChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the change event an [`Event`](#event) raises when an [`EventSpeaker`](#eventspeaker)
  join entity is added or removed (linking the event to a [`Speaker`](#speaker)).
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `EventIdentifierType`,
  `EventSpeakerIdentifierType`, `SpeakerIdentifierType`.
- **Concept**: the child-change domain event (see [`CategoryItemChanged`](#categoryitemchanged)), for a
  *join* entity. The doc comment (line 7) says "added or removed" with no `Updated` case: a pure FK-pair
  join carries no editable content, so its lifecycle has only two meaningful transitions. `State` is
  still `DomainEntityState` (it can hold `Added`/`Deleted`).
- **Walkthrough**: `State`, `EventId` (parent), `EventSpeakerId` (the join row), `SpeakerId` (the linked
  speaker), lines 14-17.
- **Where it's used**: raised by [`Event`](#event)'s `AddEventSpeaker`/`RemoveEventSpeaker`; dispatched
  in-process. No dedicated handler subscribes today.

---

### RoomChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/DomainEvents/RoomChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the child-change event an [`Event`](#event) raises when one of its [`Room`](#room)
  children is added, updated, or removed. Carries the parent event id, the room id, and the room name.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `EventIdentifierType`,
  `RoomIdentifierType`.
- **Concept**: the child-change domain event (see [`CategoryItemChanged`](#categoryitemchanged)). This is
  the one member of the Level-2 family with a *dedicated* handler, so it is a concrete sighting of the
  `IDomainEventHandler<T>` boundary: [`RoomChangedHandler`](group-18-conference-application.md#roomchangedhandler)
  in the Conference Application layer subscribes to it and reacts on the `State` transition.
  `[Rubric §6, CQRS & Event-Driven]` (typed event to typed handler, dispatched by Scrutor-discovered
  registration).
- **Walkthrough**: `State`, `EventId` (parent), `RoomId` (child), `RoomName` (display label), lines 14-17.
- **Where it's used**: raised by [`Event`](#event)'s `AddRoom`/`UpdateRoom`/`RemoveRoom`; dispatched
  in-process and consumed by [`RoomChangedHandler`](group-18-conference-application.md#roomchangedhandler).

---

### SpeakerDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SpeakerDTO.cs:9` · Level 2 · record (class)

- **What it is**: the read-model shape of the [`Speaker`](#speaker) aggregate root: profile fields, social
  links, an optional link to an Identity user, and two child collections (category items and question
  answers). It is the richest DTO in this unit.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype),
  [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware),
  [`SpeakerCategoryItemDTO`](#speakercategoryitemdto), [`SpeakerQuestionAnswerDTO`](#speakerquestionanswerdto);
  the aliases `SpeakerIdentifierType`, `UserIdentifierType`.
- **Concept, the cross-context read DTO.** `[Rubric §7, Microservices Readiness]` and `[Rubric §8, Data
  Architecture]`. Like [`ConferenceCategoryDTO`](#conferencecategorydto) it is a concurrency-aware
  aggregate DTO with nested child collections, but it also surfaces `LinkedUserId`
  (`SpeakerDTO.cs:58`), a *nullable, cross-database* FK to an Identity `User`. That id is a scalar, not an
  EF navigation, because the User and Speaker live in separate databases ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)); the link is reconciled
  by events (see [`SpeakerChanged`](#speakerchanged) and [`SpeakerLinkedToUser`](#speakerlinkedtouser)),
  never a cross-database join. Three URL-ish fields (`LinkedInUrl`/`GitHubUrl`/`WebsiteUrl`) carry a
  scoped `[SuppressMessage(... CA1056 ...)]` (`SpeakerDTO.cs:46,50,54`) because they are stored as strings
  from the Sessionize import.
- **Walkthrough**: seventeen members (`SpeakerDTO.cs:12-64`), `Id` + `RowVersion` (contracts); the
  `required` name fields `FirstName`/`LastName`/`FullName` (`FullName` is denormalized so the client shows
  a display name without concatenating); optional profile fields (`Email`, `Bio`, `TagLine`,
  `ProfilePicture`, the `IsTopSpeaker` flag, the three social URLs); the nullable `LinkedUserId`; and the
  two child collections `SpeakerCategoryItems` and `SpeakerQuestionAnswers`, both
  `IReadOnlyCollection<...>` defaulted to `[]` (`SpeakerDTO.cs:61,64`).
- **Why it's built this way**: denormalizing `FullName` and defaulting both collections keeps the speaker
  UI a thin renderer; exposing `LinkedUserId` as a bare nullable id (not a nested user object) is exactly
  the database-per-service posture, the Conference read model knows the *id* of the linked user but never
  reaches across the boundary to fetch it.
- **Where it's used**: projected by an
  [`IEntityQueryService<Speaker, SpeakerDTO, SpeakerIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  injected into the `SpeakersController` (`SpeakersController.cs:42`); mapped by `SpeakerDTOMapper`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerDTOMapper.cs`);
  rendered by the Speaker dashboard UI.

---

### CategoryChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Categories.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/DomainEvents/CategoryChanged.cs:12` · Level 3 · record (sealed)

- **What it is**: the aggregate-lifecycle event a [`Category`](#category) raises when it is created,
  updated, or deleted. Carries the category id and its title.
- **Depends on**:
  [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype)
  (Level 2), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) (Level 0); alias
  `ConferenceCategoryIdentifierType`.
- **Concept introduced, the aggregate-root lifecycle event.** `[Rubric §6, CQRS & Event-Driven]` and
  `[Rubric §16, Maintainability]` (a single event type per aggregate instead of a separate
  `Created`/`Updated`/`Deleted` trio). Where the Level-2 events above derive from
  [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) directly, the root-level events derive
  from `EntityChangedEvent<TIdentifierType>`, which consolidates the CRUD-lifecycle pattern: it holds
  `State` plus a single generic `EntityId`, and each concrete record passes its own id up to that base
  (line 16: `: EntityChangedEvent<ConferenceCategoryIdentifierType>(State, CategoryId)`). A subtle but
  real consequence: the derived record re-exposes the id under a domain-meaningful name (`CategoryId`)
  while the same value is also reachable as the inherited generic `EntityId`, one identity, two property
  names, so handlers written against `EntityChangedEvent<T>` and handlers written against the concrete
  type both work.
- **Walkthrough**: three positional members (lines 13-15), `State`, `CategoryId`, and `Title`; `State`
  and `CategoryId` are forwarded to the base constructor (line 16), `Title` is the record's own added
  property.
- **Why it's built this way**: one lifecycle event per aggregate keeps the event surface small ([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html)
  contract-versioning applies to the shared base), and `State` lets a handler branch on the transition
  rather than subscribing to three separate types.
- **Where it's used**: raised from [`Category`](#category)'s `Create`/`Update`/`Delete`; dispatched
  in-process by [`DomainEventDispatcher`](group-04-events-outbox.md#domaineventdispatcher).

---

### EventChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/DomainEvents/EventChanged.cs:12` · Level 3 · record (sealed)

- **What it is**: the aggregate-lifecycle event an [`Event`](#event) raises when it is created, updated,
  or deleted (including on publish/unpublish, which flip state and emit `EventChanged(Updated)`). Carries
  the event id and name.
- **Depends on**:
  [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); alias `EventIdentifierType`.
- **Concept**: the aggregate-root lifecycle event introduced by [`CategoryChanged`](#categorychanged);
  structurally identical, carrying `Name` (line 14) as its descriptor.
- **Walkthrough**: `State`, `EventId`, `Name` (lines 13-15); `State` + `EventId` forwarded to the base
  (line 16).
- **Where it's used**: raised from [`Event`](#event)'s `Create`/`Update`/`Publish`/`Unpublish`/`Delete`;
  dispatched in-process.

### SessionCategoryItemChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionCategoryItemChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the domain event a [`Session`](#session) raises when one of its [`SessionCategoryItem`](#sessioncategoryitem) join rows is added or removed. It is the narrowest kind of Conference event: a notice that a *child collection* of an aggregate changed, not that the aggregate root itself changed.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) (base record) and the [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) enum; the module id aliases `SessionIdentifierType`, `SessionCategoryItemIdentifierType`, `CategoryItemIdentifierType` (BCL scalars behind the alias). No NuGet dependency.
- **Concept introduced, the child-collection domain event.** `[Rubric §6, CQRS & Event-Driven]` (assesses whether state changes are announced as first-class events rather than leaked as side effects) and `[Rubric §4, Domain-Driven Design]` (assesses whether the aggregate root is the sole author of change inside its consistency boundary). The aggregate-root-level events later in this part ([`SessionChanged`](#sessionchanged), [`SpeakerChanged`](#speakerchanged)) derive from [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype); this event and its four siblings instead derive **directly** from [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) because a join/child row has no independent lifecycle event of its own to reuse. It carries three ids so a handler can react without reloading: the parent [`Session`](#session), the join entity, and the [`CategoryItem`](#categoryitem) that was linked. How a raised event reaches the outbox and in-process handlers is taught once in [Group 04](group-04-events-outbox.md); this part only produces them.
- **Walkthrough**: a positional `sealed record class` with four members (`SessionCategoryItemChanged.cs:13-17`): `State` (the [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), `Added` or `Deleted` for a join row), `SessionId`, `SessionCategoryItemId`, and `CategoryItemId`. Being a record, structural equality and immutability come for free; the primary-constructor parameters are the only state.
- **Why it's built this way**: publishing the ids rather than the entity keeps the event a flat, serializable fact (it must survive an outbox round-trip, [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) and keeps a handler from touching the aggregate's internals. Raising a distinct event per join type (rather than one generic "session updated") lets read-side cache invalidation and projections target exactly what moved.
- **Where it's used**: raised inside [`Session`](#session)'s category-item add/remove methods; consumed by in-process `IDomainEventHandler` implementations and captured by the outbox in `SaveChangesAsync`.

---

### SessionQuestionAnswerChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionQuestionAnswerChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the domain event a [`Session`](#session) raises when a [`SessionQuestionAnswer`](#sessionquestionanswer) child row is added, updated, or removed. Same shape as [`SessionCategoryItemChanged`](#sessioncategoryitemchanged), but for the answer child rather than the category join.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `SessionIdentifierType`, `SessionQuestionAnswerIdentifierType`, `QuestionIdentifierType`.
- **Concept**: the child-collection domain event introduced by [`SessionCategoryItemChanged`](#sessioncategoryitemchanged). `[Rubric §6, CQRS & Event-Driven]`. The one behavioral difference is the `Updated` state: an answer's text can change in place (a join row cannot), so this event's `State` spans `Added`, `Updated`, and `Deleted`.
- **Walkthrough**: `sealed record class` with `State`, `SessionId`, `SessionQuestionAnswerId`, `QuestionId` (`SessionQuestionAnswerChanged.cs:13-17`).
- **Where it's used**: raised by [`Session`](#session)'s question-answer methods; captured by the outbox.

---

### SessionSpeakerChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionSpeakerChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the domain event a [`Session`](#session) raises when a [`SessionSpeaker`](#sessionspeaker) join row (session-to-speaker association) is added or removed.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `SessionIdentifierType`, `SessionSpeakerIdentifierType`, `SpeakerIdentifierType`.
- **Concept**: the child-collection domain event ([`SessionCategoryItemChanged`](#sessioncategoryitemchanged)). `[Rubric §6, CQRS & Event-Driven]`. A join row, so `State` is `Added` or `Deleted` only.
- **Walkthrough**: `sealed record class` with `State`, `SessionId`, `SessionSpeakerId`, `SpeakerId` (`SessionSpeakerChanged.cs:13-17`).
- **Where it's used**: raised by [`Session`](#session)'s speaker-association methods; captured by the outbox.

---

### SpeakerCategoryItemChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Speakers.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/DomainEvents/SpeakerCategoryItemChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the [`Speaker`](#speaker)-side twin of [`SessionCategoryItemChanged`](#sessioncategoryitemchanged): raised when a [`SpeakerCategoryItem`](#speakercategoryitem) join row is added or removed from a speaker (for example a speaker's topic or locality tags).
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `SpeakerIdentifierType`, `SpeakerCategoryItemIdentifierType`, `CategoryItemIdentifierType`.
- **Concept**: the child-collection domain event ([`SessionCategoryItemChanged`](#sessioncategoryitemchanged)). `[Rubric §6, CQRS & Event-Driven]`. Structurally identical to the session variant with the parent id swapped from session to speaker.
- **Walkthrough**: `sealed record class` with `State`, `SpeakerId`, `SpeakerCategoryItemId`, `CategoryItemId` (`SpeakerCategoryItemChanged.cs:13-17`).
- **Where it's used**: raised by [`Speaker`](#speaker)'s category-item methods; captured by the outbox.

---

### SpeakerQuestionAnswerChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Speakers.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/DomainEvents/SpeakerQuestionAnswerChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the [`Speaker`](#speaker)-side twin of [`SessionQuestionAnswerChanged`](#sessionquestionanswerchanged): raised when a [`SpeakerQuestionAnswer`](#speakerquestionanswer) child row is added, updated, or removed from a speaker.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `SpeakerIdentifierType`, `SpeakerQuestionAnswerIdentifierType`, `QuestionIdentifierType`.
- **Concept**: the child-collection domain event ([`SessionCategoryItemChanged`](#sessioncategoryitemchanged)). `[Rubric §6, CQRS & Event-Driven]`. As with the session answer, the answer text is mutable, so `State` spans `Added`, `Updated`, and `Deleted`.
- **Walkthrough**: `sealed record class` with `State`, `SpeakerId`, `SpeakerQuestionAnswerId`, `QuestionId` (`SpeakerQuestionAnswerChanged.cs:13-17`).
- **Where it's used**: raised by [`Speaker`](#speaker)'s question-answer methods; captured by the outbox.

---

### QuestionChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Questions.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/DomainEvents/QuestionChanged.cs:12` · Level 3 · record (sealed)

- **What it is**: the aggregate-root lifecycle event for a [`Question`](#question): raised when a question (the reusable custom-form question definition) is created, updated, or deleted.
- **Depends on**: [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype) (base), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); alias `QuestionIdentifierType`.
- **Concept introduced, the aggregate-root change event via `EntityChangedEvent<T>`.** `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §4, Domain-Driven Design]`. Where the Level-2 events above derive straight from [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent), the root-level events derive from the shared [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype) base (taught in Group 04), which standardizes the `(State, Id)` pair every "an entity's lifecycle moved" event needs. The record adds only what a subscriber needs beyond that pair.
- **Walkthrough**: `sealed record class QuestionChanged(DomainEntityState State, QuestionIdentifierType QuestionId, string QuestionText)` passing `(State, QuestionId)` up to the `EntityChangedEvent<QuestionIdentifierType>` primary constructor (`QuestionChanged.cs:12-16`). The extra `QuestionText` rides along so a projection or cache-invalidation handler can act without a reload.
- **Why it's built this way**: reusing `EntityChangedEvent<T>` keeps the `State`/`Id` contract uniform across every aggregate's change event, so generic subscribers (audit, cache) can treat them polymorphically.
- **Where it's used**: raised by the [`Question`](#question) factory/update/delete methods; captured by the outbox and dispatched in-process.

---

### SessionChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionChanged.cs:13` · Level 3 · record (sealed)

- **What it is**: the aggregate-root lifecycle event for a [`Session`](#session): raised on session create, update, or delete.
- **Depends on**: [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `SessionIdentifierType`, `EventIdentifierType`.
- **Concept**: the aggregate-root change event introduced by [`QuestionChanged`](#questionchanged). `[Rubric §6, CQRS & Event-Driven]`. It carries the parent `EventId` in addition to `Title`, so a subscriber knows which event's schedule was touched (useful for scoped cache invalidation of that event's session list).
- **Walkthrough**: `sealed record class SessionChanged(DomainEntityState State, SessionIdentifierType SessionId, string Title, EventIdentifierType EventId)` chaining `(State, SessionId)` to the base (`SessionChanged.cs:13-18`).
- **Where it's used**: raised by [`Session`](#session)'s lifecycle methods; captured by the outbox.

---

### SpeakerChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Speakers.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/DomainEvents/SpeakerChanged.cs:16` · Level 3 · record (sealed)

- **What it is**: the aggregate-root lifecycle event for a [`Speaker`](#speaker): raised on speaker create, update, or delete. Its distinctive feature is a nullable `PreviousLinkedUserId` that captures the speaker-to-user link as it stood *before* a delete.
- **Depends on**: [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `SpeakerIdentifierType`, `UserIdentifierType`.
- **Concept**: the aggregate-root change event ([`QuestionChanged`](#questionchanged)), plus **carrying pre-mutation state on the event** for cross-context cleanup. `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §7, Microservices Readiness]` (a delete in Conference must trigger unlink cleanup on the Identity side, and that must not depend on reading a field the delete has already cleared). Per the XML doc (`SpeakerChanged.cs:12-15`), `PreviousLinkedUserId` is populated only on `DomainEntityState.Deleted` so the handler can perform BR-70 cross-context cleanup after the entity's own link field has been nulled.
- **Walkthrough**: `sealed record class SpeakerChanged(DomainEntityState State, SpeakerIdentifierType SpeakerId, string FullName, UserIdentifierType? PreviousLinkedUserId = null)` chaining `(State, SpeakerId)` to the base (`SpeakerChanged.cs:16-21`). The default `null` means non-delete transitions omit it.
- **Why it's built this way**: an event is an immutable record of *what already happened*; snapshotting the prior link onto the event avoids a lost-update race where the cleanup handler would otherwise read a cleared field. It also decouples the delete transaction from the downstream unlink, which crosses a module (and eventually a service) boundary.
- **Where it's used**: raised by [`Speaker`](#speaker)'s lifecycle methods; a Conference-side handler translates the delete into the [`SpeakerUnlinkedFromUser`](#speakerunlinkedfromuser) integration event.

---

### SpeakerLinkedToUser
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers.IntegrationEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/IntegrationEvents/SpeakerLinkedToUser.cs:20` · Level 3 · record (sealed)

- **What it is**: the cross-module **integration event** Conference publishes when it binds a [`Speaker`](#speaker) to an Identity `User` (either via the manual link command or via automatic email-match linking triggered by `UserRegistered`). Identity subscribes to it and sets `User.LinkedSpeakerId`, so the next JWT refresh carries the `speaker_id` claim (BR-209).
- **Depends on**: [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent) (base); aliases `UserIdentifierType`, `SpeakerIdentifierType`.
- **Concept introduced, the integration event (vs the domain event).** `[Rubric §7, Microservices Readiness]` (assesses whether cross-module coupling runs through published contracts a peer can consume without a code reference back) and `[Rubric §9, API & Contract Design]` (the async message *is* a public contract). Two things distinguish it from every event above. First, it derives from [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent), not `BaseDomainEvent`: a domain event stays inside the producing module, an integration event is meant to cross a module/service boundary over the broker (RabbitMQ locally, Azure Service Bus in production) via the outbox. Second, it lives in the `.Shared` project, not `.Domain`, precisely so the subscribing Identity module can reference the contract without pulling in Conference's domain model. Per the XML doc (`SpeakerLinkedToUser.cs:11-16`), it replaced a former direct in-process service call (`IUserSpeakerLinkService.LinkSpeakerAsync`), making the bidirectional User-Speaker link eventually consistent across boundaries.
- **Walkthrough**: `sealed record class SpeakerLinkedToUser(UserIdentifierType UserId, SpeakerIdentifierType SpeakerId) : BaseIntegrationEvent` (`SpeakerLinkedToUser.cs:20-23`). Just the two ids of the link; the receiver needs nothing more to set `LinkedSpeakerId`.
- **Why it's built this way**: modeling the link as a published fact rather than a synchronous call is the outbox/eventual-consistency story ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)); it lets Identity and Conference run as separate services with no shared database and no cross-database FK.
- **Where it's used**: published by the Conference link-command handler; consumed by Identity's `SpeakerLinkedToUserHandler`.

---

### SpeakerUnlinkedFromUser
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers.IntegrationEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/IntegrationEvents/SpeakerUnlinkedFromUser.cs:17` · Level 3 · record (sealed)

- **What it is**: the inverse of [`SpeakerLinkedToUser`](#speakerlinkedtouser): the integration event Conference publishes when a speaker is unlinked from a user (via the unlink command, or as cascade cleanup when a speaker is soft-deleted). Identity subscribes and clears `User.LinkedSpeakerId`.
- **Depends on**: [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent); aliases `UserIdentifierType`, `SpeakerIdentifierType`.
- **Concept**: the integration event introduced by [`SpeakerLinkedToUser`](#speakerlinkedtouser). `[Rubric §7, Microservices Readiness]`. Same contract shape; the `SpeakerId` here is carried mainly for audit/log correlation (the id being cleared is `UserId`), per the XML doc (`SpeakerUnlinkedFromUser.cs:15-16`).
- **Walkthrough**: `sealed record class SpeakerUnlinkedFromUser(UserIdentifierType UserId, SpeakerIdentifierType SpeakerId) : BaseIntegrationEvent` (`SpeakerUnlinkedFromUser.cs:17-20`).
- **Why it's built this way**: it closes the loop on the eventually-consistent link (replacing the former `IUserSpeakerLinkService.ClearLinkedSpeakerAsync` direct call, `SpeakerUnlinkedFromUser.cs:10-13`), and it is the downstream half of a [`SpeakerChanged`](#speakerchanged) delete (which is why that event snapshots `PreviousLinkedUserId`).
- **Where it's used**: published by the Conference unlink-command handler and by the speaker-delete cleanup path; consumed by Identity's `SpeakerUnlinkedFromUserHandler`.

---

### EventInvariants
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/EventInvariants.cs:10` · Level 4 · class (static)

- **What it is**: the static invariants toolbox for the [`Event`](#event) aggregate and its children ([`Room`](#room), [`EventQuestionAnswer`](#eventquestionanswer)). It holds the field-length constants and the `Ensure...` rule methods that both the domain factories and the EF configuration reuse, so a business rule is stated once.
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (the reusable lower layer it delegates to), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error); BCL `TimeZoneInfo` and `DateOnly`. Alias `RoomIdentifierType`.
- **Concept introduced, the module invariants class.** `[Rubric §4, Domain-Driven Design]` (invariants live in the domain, expressed as reusable rules) and `[Rubric §8, Data Architecture]` (the `MaxLength` constants are the single source of truth shared by EF column config and validation, keeping schema and rule in sync). This is the same static-invariants idiom taught for value objects in [Group 02](group-02-domain-building-blocks.md), applied to an aggregate: each `Ensure...` returns a [`Result`](group-01-result-error-handling.md#result), and callers combine several via `Result.Combine`.
- **Walkthrough**, in teaching order:
  - **Length constants** (`EventInvariants.cs:13-46`): `NameMaxLength` (500), `DescriptionMaxLength` (4000), `TimeZoneMaxLength` (100), `SessionizeCodeMaxLength` (100), `VenueAddressMaxLength` (500), `VenueMapUrlMaxLength` (2000), `WiFiInfoMaxLength` (500), the four `Room...` limits (`RoomNameMaxLength` 255, `RoomFloorMaxLength` 100, `RoomLocationMaxLength` 255, `RoomAccessibilityInfoMaxLength` 500), and `AnswerValueMaxLength` (4000). Referenced by both domain checks and EF config.
  - **Reserved id range** (`EventInvariants.cs:53-56`): `RoomManualIdRangeStart` (999_999_000) and `RoomManualIdRangeEnd` (999_999_999). Rooms carry app-assigned ids where the int PK *is* the Sessionize id; organizer-created rooms draw from this reserved high range so they never collide with a real Sessionize id (mirrors `SessionInvariants.ManualIdRangeStart`).
  - **`EnsureNameIsValid`** (`:58`): combines a not-empty and a max-length check via [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants).
  - **`EnsureTimeZoneIsValid`** (`:69`): not-empty, then max-length, then `TimeZoneInfo.FindSystemTimeZoneById` inside a try/catch that maps `TimeZoneNotFoundException` to an `Event.TimeZone.Invalid` invariant error (BR-87, IANA identifier check).
  - **`EnsureDateRangeIsValid`** (`:107`): fails with `Event.DateRange.Invalid` when `endDate < startDate`.
  - **`EnsureRoomCapacityIsValid`** (`:122`): rejects a non-positive capacity when one is supplied (`capacity is <= 0`, BR-93).
  - **`EnsureRoomNameIsValid`** (`:131`) and **`EnsureAnswerValueIsValid`** (`:136`): not-empty plus max-length pairs for the two children.
  - **`EnsureEventIsPublished`** (`:147`): guards actions that require a published event (BR-108).
- **Why it's built this way**: keeping the length limits as `const`/`static readonly` fields on the invariants class, and having EF configuration read the same constants, prevents the classic drift where a validator allows a value the column truncates. Returning [`Result`](group-01-result-error-handling.md#result) (never throwing) keeps validation composable at the factory.
- **Where it's used**: [`Event`](#event), [`Room`](#room), and [`EventQuestionAnswer`](#eventquestionanswer) factories/updaters call these; the Events EF configuration reads the length constants.

---

### Event
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:17` · Level 5 · class (sealed, aggregate root)

- **What it is**: the aggregate root for a conference event. It owns three child collections ([`Room`](#room)s, [`EventSpeaker`](#eventspeaker) associations, and [`EventQuestionAnswer`](#eventquestionanswer)s) and enforces every rule about them through its own methods. Event ids are database-generated (not sourced from Sessionize).
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (base), [`EventInvariants`](#eventinvariants), the [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error) types, [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), the [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), and the [`EventChanged`](#eventchanged)/[`RoomChanged`](#roomchanged)/[`EventSpeakerChanged`](#eventspeakerchanged)/[`EventQuestionAnswerChanged`](#eventquestionanswerchanged) domain events. Uses [`QuestionModerationDefault`](#questionmoderationdefault) and `TimeProvider` for clock-free refresh stamping. Aliases `EventIdentifierType`, `RoomIdentifierType`, `EventSpeakerIdentifierType`, `EventQuestionAnswerIdentifierType`, `SpeakerIdentifierType`, `QuestionIdentifierType`, `UserIdentifierType`.
- **Concept introduced, the aggregate root as the consistency boundary.** `[Rubric §4, Domain-Driven Design]` (assesses whether invariants are enforced inside the boundary and children are mutated only through the root) and `[Rubric §1, SOLID]`. This is the fullest expression in this part of the aggregate pattern taught in [Group 02](group-02-domain-building-blocks.md): child collections are exposed only as read-only views over private backing lists, all mutation flows through root methods, each mutation validates and then raises a domain event, and the root owns cascade delete. `[Rubric §6, CQRS & Event-Driven]`: every state change announces itself.
- **Walkthrough**, in teaching order:
  - **`[IdValueGenerated]`** on the class (`Event.cs:16`): marks the id as database-generated; the factory reads this at runtime via `typeof(Event).IsIdValueGenerated`.
  - **Scalar state** (`Event.cs:20-60`): `Name`, `Description?`, `StartDate`/`EndDate` (`DateOnly`), `TimeZone`, `SessionizeCode?`, `VenueAddress?`, `VenueMapUrl?`, `WiFiInfo?`, `IsPublished`, `QuestionModerationDefault` (the BR-233 default status a newly submitted live-layer question gets), and the nullable `LastSessionizeRefreshOn`/`LastSessionizeRefreshBy` refresh-audit pair. All have private setters.
  - **Child collections** (`Event.cs:62-78`): private `List<Room>`/`List<EventSpeaker>`/`List<EventQuestionAnswer>` exposed as `IReadOnlyCollection<...>` marked `[Navigation(IsCollection = true)]` for the populator ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).
  - **Constructors** (`Event.cs:81-107`): a parameterless EF constructor that seeds non-null strings, plus a private ctor used by the factory.
  - **`Create`** (`Event.cs:125`): combines `EnsureNameIsValid` + `EnsureTimeZoneIsValid` + `EnsureDateRangeIsValid`; on success builds the instance, assigns `Id` as `default` when id-value-generated (else the passed id), sets `QuestionModerationDefault`, and raises `EventChanged(Added)`. Returns [`Result<Event>`](group-01-result-error-handling.md#result).
  - **`Update`** (`Event.cs:182`): re-validates the same three invariants, writes the scalars, raises `EventChanged(Updated)`.
  - **`Publish`/`Unpublish`** (`Event.cs:219`, `:239`): flip `IsPublished`, refusing a no-op transition with an invariant error, and raise `EventChanged(Updated)`.
  - **`RecordSessionizeRefresh`** (`Event.cs:263`): stamps `LastSessionizeRefreshOn/By` from a caller-supplied UTC instant (drawn from an injected `TimeProvider`) so the domain never reads an ambient clock.
  - **`Delete`** (`Event.cs:275`): overrides the base soft-delete, then cascade soft-deletes every non-deleted room, event-speaker, and answer (BR-72), and raises `EventChanged(Deleted)`. Session cascade is deliberately handled at the application layer (BR-127).
  - **Child management** (`Event.cs:321-547`): `AddRoom`/`UpdateRoom`/`RemoveRoom`, `AddEventSpeaker`/`RemoveEventSpeaker`, `AddEventQuestionAnswer`/`UpdateEventQuestionAnswer`/`RemoveEventQuestionAnswer`. Each guards duplicates (for example a room name or a repeated speaker), delegates creation to the child factory, mutates the private list, and raises the matching child event. `SetRooms`/`SetEventSpeakers`/`SetEventQuestionAnswers` (internal) let the populator replace a collection via the base `SetItems` helper.
  - **Private helpers** (`Event.cs:550-563`): `GetRoomOrNotFound`/`GetEventSpeakerOrNotFound`/`GetEventQuestionAnswerOrNotFound` wrap the base `GetChildOrNotFound<T>` so a missing child returns an [`Error.NotFound`](group-01-result-error-handling.md#error) rather than a null.
- **Why it's built this way**: routing every child change through the root is what makes the invariants (no duplicate room name, cascade-on-delete) enforceable and what gives the outbox a single, ordered stream of change events. Passing the clock in rather than reading `DateTime.UtcNow` keeps the domain deterministic and testable (`[Rubric §14, Testability]`).
- **Where it's used**: loaded and mutated by the Conference application-layer command handlers (Group 18); persisted via the Events EF configuration; projected to DTOs for the read endpoints.

---

### EventQuestionAnswer
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/EventQuestionAnswer.cs:13` · Level 5 · class (sealed, child entity)

- **What it is**: a child entity of [`Event`](#event) storing the event's answer to one custom-form [`Question`](#question). Database-generated id.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (base, a child not an aggregate root), [`EventInvariants`](#eventinvariants), [`Result`](group-01-result-error-handling.md#result), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute). Aliases `EventQuestionAnswerIdentifierType`, `QuestionIdentifierType`, `EventIdentifierType`.
- **Concept introduced, the child entity (vs the aggregate root).** `[Rubric §4, Domain-Driven Design]`. A child derives from [`AuditableBaseEntity`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), so it has identity, soft-delete, and audit fields but **no** domain-event list: children never raise events themselves, the owning root ([`Event`](#event)) does. It carries the FK `EventId` and a back-navigation `Event?` for EF.
- **Walkthrough**: `[IdValueGenerated]` (`:12`); `QuestionId` (FK) and `AnswerValue` with private setters (`:16-19`); `[Navigation] Event?` and `EventId` (`:22-26`); an EF ctor and a private ctor (`:29-37`); `Create` (`:46`) which validates `EnsureAnswerValueIsValid` and assigns the id per the id-generation flag; `UpdateAnswer` (`:71`) which re-validates then sets `AnswerValue`. Neither method raises an event, the root wraps them and raises [`EventQuestionAnswerChanged`](#eventquestionanswerchanged).
- **Why it's built this way**: keeping the answer a child of the event (rather than a standalone aggregate) means it shares the event's transaction and cascade-delete, and its lifecycle events flow through the root's ordered stream.
- **Where it's used**: created and mutated only through [`Event`](#event)'s `AddEventQuestionAnswer`/`UpdateEventQuestionAnswer`/`RemoveEventQuestionAnswer`.

---

### EventSpeaker
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/EventSpeaker.cs:13` · Level 5 · class (sealed, join entity)

- **What it is**: the join entity linking an [`Event`](#event) to a [`Speaker`](#speaker) (which speakers appear at which event). Database-generated id.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), [`Result`](group-01-result-error-handling.md#result), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute). Aliases `EventSpeakerIdentifierType`, `SpeakerIdentifierType`, `EventIdentifierType`.
- **Concept**: the child/join entity introduced by [`EventQuestionAnswer`](#eventquestionanswer). `[Rubric §4, Domain-Driven Design]`. This is the thinnest child in the family: it holds only the `SpeakerId` FK plus the standard back-navigation and `EventId`, so its `Create` (`:36`) does no validation beyond assigning the id per the id-generation flag and returns [`Result<EventSpeaker>`](group-01-result-error-handling.md#result). There is no `Update`: a join either exists or it does not.
- **Walkthrough**: `[IdValueGenerated]` (`:12`); `SpeakerId` (`:16`); `[Navigation] Event?` and `EventId` (`:19-23`); EF ctor and private ctor (`:26-28`); `Create` (`:36-48`).
- **Why it's built this way**: modeling the many-to-many as an explicit join entity (rather than an EF-implicit link table) gives the association its own id, soft-delete, and audit trail, and lets [`Event`](#event) raise [`EventSpeakerChanged`](#eventspeakerchanged) when it is added or removed.
- **Where it's used**: created/removed only through [`Event`](#event)'s `AddEventSpeaker`/`RemoveEventSpeaker`; the duplicate-speaker guard lives in the root.

---

### Room
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Room.cs:12` · Level 5 · class (sealed, child entity)

- **What it is**: a child entity of [`Event`](#event) representing a physical or virtual room where sessions take place. Unlike its siblings, a room's id is **Sessionize-assigned**, not database-generated (note the absence of `[IdValueGenerated]`).
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), [`EventInvariants`](#eventinvariants), [`Result`](group-01-result-error-handling.md#result). Aliases `RoomIdentifierType`, `EventIdentifierType`.
- **Concept**: the child entity ([`EventQuestionAnswer`](#eventquestionanswer)), with an **externally-assigned id**. `[Rubric §8, Data Architecture]`. Because `Room` is not marked `[IdValueGenerated]`, `Create` (`:69`) always assigns the supplied id (its `typeof(Room).IsIdValueGenerated` is false), which is how a Sessionize room id becomes the PK directly. Organizer-created rooms draw from the reserved high range ([`EventInvariants`](#eventinvariants) `RoomManualIdRangeStart`) so app-assigned ids never collide with imported ones.
- **Walkthrough**: scalars `Name`, `Sort`, `Capacity?`, `Floor?`, `Location?`, `AccessibilityInfo?` (`:15-30`); `[Navigation] Event?` and `EventId` (`:33-37`); EF ctor and private ctor (`:40-56`); `Create` (`:69`) validating `EnsureRoomNameIsValid` + `EnsureRoomCapacityIsValid`; `Update` (`:110`) re-validating the same pair and writing the scalars. As a child, it raises no events itself.
- **Why it's built this way**: preserving the Sessionize id as the PK keeps imported rooms stable across refreshes (a re-import updates in place rather than creating duplicates), and the reserved manual range lets organizers add rooms without an id clash.
- **Where it's used**: created/updated/removed through [`Event`](#event)'s `AddRoom`/`UpdateRoom`/`RemoveRoom` (which raise [`RoomChanged`](#roomchanged)); referenced by [`Session`](#session) scheduling.

### QuestionInvariants
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/QuestionInvariants.cs:10` · Level 4 · class (static)

- **What it is**: domain rules for the [`Question`](#question) aggregate: text length, target entity
  (`Session`/`Event`/`Speaker`), input type (`Rating`/`Text`/`Email`), source (`Sessionize`/`User`),
  and, the richest part, type-specific answer validation (BR-124).
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (Level 3),
  [`Error`](group-01-result-error-handling.md#error) (Level 1),
  [`Result`](group-01-result-error-handling.md#result) (Level 2); BCL `MailAddress`, `int.TryParse`.
- **Concept**: the same Invariants-class pattern used across the Conference aggregates (see
  [`EventInvariants`](#eventinvariants)), but notably richer. `[Rubric §4, DDD]` (closed value sets and
  answer rules expressed *as domain logic*, not as API/UI validation). The permitted values are held as
  data, not as long `switch`es: `ValidQuestionEntities`, `ValidQuestionTypes`, `ValidQuestionSources`
  are `private static readonly string[]` (lines 28-34) checked with `StringComparer.OrdinalIgnoreCase`.
- **Walkthrough**
  - Length constants (lines 13-25) and the user-created id-range constants `ManualIdRangeStart/End`
    (lines 37-40, distinguishing Sessionize ids from user-created ones).
  - `EnsureQuestionTextIsValid` (line 48): explicit `IsNullOrWhiteSpace` guard then max-length via
    `CommonInvariants.EnsureStringMaxLength`.
  - `EnsureQuestionEntityIsValid` / `EnsureQuestionTypeIsValid` / `EnsureQuestionSourceIsValid`
    (lines 68, 83, 98): membership tests against the closed arrays.
  - `EnsureAnswerValueMatchesQuestionType` (line 115): a `switch` on `questionType` dispatching to three
    private validators, *what counts as a valid answer depends on the question's type*:
    - `ValidateRatingAnswer` (line 128): `int.TryParse` with `NumberStyles.Integer` +
      `CultureInfo.InvariantCulture`, must be `1..5`; otherwise `Error.Validation`. (Culture-invariant
      parsing, see the [primer §27 note](../00-primer.md#6-the-34-category-architecture-evaluation-lens).)
    - `ValidateTextAnswer` (line 142): length not exceeding `TextAnswerMaxLength` (2000).
    - `ValidateEmailAnswer` (line 156): constructs a `System.Net.Mail.MailAddress` and treats a
      `FormatException` as invalid, the BCL is the format authority.
    - An unknown type returns `Error.Invariant("Question.QuestionType.Unknown")`.
- **Why it's built this way**: encoding answer-shape rules in the domain means the model rejects a
  malformed rating or email before it can reach the database or a handler; expressing the allowed sets
  as arrays keeps adding a new question type a one-line data change.
- **Where it's used**: called from [`Question`](#question)'s `Create`/`Update`; the answer-matching
  rule is used by the answer-recording handlers (Application tier); length constants feed EF config.

### SpeakerInvariants
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/SpeakerInvariants.cs:10` · Level 4 · class (static)

- **What it is**: domain rules for the [`Speaker`](#speaker) aggregate: first-name, last-name, and
  answer-value non-empty/length constraints, plus the length constants for every profile field.
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (Level 3),
  [`Result`](group-01-result-error-handling.md#result) (Level 2).
- **Concept**: cross-reference [`EventInvariants`](#eventinvariants). This is the simplest sibling: no
  cross-field or type-dispatch checks. The bulk of the class is length constants for the rich speaker
  profile, `FirstNameMaxLength` (200), `EmailMaxLength` (255), `TagLineMaxLength` (500), and the four
  social/URL fields at 2000 (`ProfilePictureMaxLength`, `LinkedInUrlMaxLength`, `GitHubUrlMaxLength`,
  `WebsiteUrlMaxLength`), all `const int` (lines 12-40) and read by the Speaker EF configuration so
  column widths stay in sync.
- **Walkthrough**: three `EnsureXxx` methods (lines 42-55), each a `Result.Combine` of
  `CommonInvariants.EnsureStringIsNotEmpty` + `EnsureStringMaxLength`
  (`EnsureFirstNameIsValid`/`EnsureLastNameIsValid`/`EnsureAnswerValueIsValid`, the last using
  `AnswerValueMaxLength` of 4000). Note that **email is *not* validated here**, the
  [`Speaker`](#speaker) factory parses it through the
  [`Email`](group-02-domain-building-blocks.md#email) value object instead.
- **Where it's used**: [`Speaker`](#speaker)'s `Create`/`Update` and
  [`SpeakerQuestionAnswer`](#speakerquestionanswer)'s `Create`/`UpdateAnswer`; length constants feed EF
  config.

### Category
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/Category.cs:16` · Level 5 · class (sealed), SCC with `CategoryInvariants`, `CategoryItem`

- **What it is**: the aggregate root for conference categories (e.g. "Level", "Track", "Session
  Format"). Each category owns a collection of [`CategoryItem`](#categoryitem) children representing the
  selectable options within it.
- **Depends on**,
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (Level 4), [`CategoryInvariants`](#categoryinvariants) (SCC), [`CategoryItem`](#categoryitem) (SCC),
  [`Result`](group-01-result-error-handling.md#result) (Level 2),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) (Level 0),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) (Level 0),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute) (Level 0); domain events
  [`CategoryChanged`](#categorychanged), [`CategoryItemChanged`](#categoryitemchanged) (Level 2-3).
- **Concept introduced, the aggregate root.** `[Rubric §4, Domain-Driven Design]` (assesses
  aggregates as the central consistency boundary, all mutations route through the root). An **aggregate
  root** is the only member of its cluster a repository hands out; callers never hold a bare
  `CategoryItem`. Two consequences visible here:
  1. **All child mutations route through the parent.** `AddCategoryItem`, `UpdateCategoryItem`,
     `RemoveCategoryItem` (lines 131-206) live on `Category`, never on `CategoryItem`; each emits a
     [`CategoryItemChanged`](#categoryitemchanged) from the root (e.g. line 150) so observers learn the
     aggregate boundary changed.
  2. **The private list enforces encapsulation.** `_categoryItems` is `private readonly
     List<CategoryItem>` (line 27); the public surface is the read-only `CategoryItems` (line 31). EF
     still materializes the backing field via the private parameterless constructor (line 34).

  `[Rubric §8, Data Architecture]` (cascade soft-delete is orchestrated by the aggregate, not the
  handler): `Delete()` (lines 102-120) cascade-soft-deletes every active child *in domain code* (BR-71)
  before raising `CategoryChanged(Deleted)`.
- **Walkthrough**
  - **Marker** `[IdValueGenerated]` (line 15): Category PKs are DB-generated; Sessionize imports still
    supply explicit ids via `IDENTITY_INSERT`.
  - **Fields** (lines 19-31): `Title`, `Sort`, `Type?`, the private list, and `CategoryItems` tagged
    `[Navigation(IsCollection = true)]` ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html), signals the populator this is a child collection).
  - **EF ctor** (line 34): parameterless, private, sets `Title = string.Empty` to satisfy the
    non-nullable field before EF assigns columns.
  - `Create` (lines 54-75): validate via `CategoryInvariants.EnsureTitleIsValid` then resolve whether
    the id is DB-generated (`typeof(Category).IsIdValueGenerated`, line 65) then construct with the
    computed `Id` then `AddDomainEvent(new CategoryChanged(Added, …))`. The canonical *validate then
    construct then emit* shape.
  - `AddCategoryItem` (lines 131-153): uniqueness check (BR-138) via
    `CategoryInvariants.EnsureCategoryItemNameIsUnique` then delegate construction to
    `CategoryItem.Create` then add to the private list then emit the change event. Callers never `new
    CategoryItem(...)`.
  - `SetCategoryItems` (line 210): `internal` hook used only by the navigation populator after a
    cross-source load; `SetItems(_categoryItems, …)` replaces the in-memory list *without* raising
    domain events (it is hydration, not a domain mutation).
- **Why it's built this way**: a single class owning uniqueness, cascade-delete and event emission
  keeps consistency rules in one place. [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html) explains why `SetCategoryItems` exists: when category
  and items share a database EF `Include()` loads them together; when they could cross databases the
  populator queries separately and calls `SetCategoryItems`, the aggregate is agnostic to the path.
- **Where it's used**: loaded by `IReadRepository<Category, …>`, mutated by the Conference category
  command handlers (Application tier), and projected via `IEntityQueryService` for the category UI.

### CategoryInvariants
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/CategoryInvariants.cs:10` · Level 5 · class (static), SCC with `Category`, `CategoryItem`

- **What it is**: invariant rules for [`Category`](#category) and its [`CategoryItem`](#categoryitem)
  children: title validation, item-name validation, and case-insensitive uniqueness checking (BR-138).
- **Depends on**: [`CategoryItem`](#categoryitem) (SCC),
  [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (Level 3),
  [`Error`](group-01-result-error-handling.md#error) (Level 1),
  [`Result`](group-01-result-error-handling.md#result) (Level 2).
- **Concept**: the Invariants-class pattern (see [`EventInvariants`](#eventinvariants)); the
  distinctive method here is the **collection-aware uniqueness guard**, which the simpler invariant
  classes lack. `[Rubric §4, DDD]` (the ubiquitous language, "an item name is unique within its
  category", expressed directly in the domain).
- **Walkthrough**
  - `TitleMaxLength` (255) and `CategoryItemNameMaxLength` (500), note these are `static readonly int`
    here (lines 13, 16) rather than the `const int` used by the other invariant classes; both feed the EF
    column widths.
  - `EnsureTitleIsValid` (line 18) / `EnsureCategoryItemNameIsValid` (line 23): `Result.Combine` of
    non-empty + max-length.
  - `EnsureCategoryItemNameIsUnique` (lines 36-54): takes the existing item collection and an optional
    `excludeItemId` (so renaming an item to its own name during an update doesn't self-conflict). It
    skips `IsDeleted` items (line 43) and compares with `StringComparison.OrdinalIgnoreCase` (line 44),
    returning `Error.Conflict` on a duplicate.
- **Why it's built this way**: co-locating invariants per aggregate without bloating the entity; the
  `Result`-returning style composes with `Result.Combine`, and the uniqueness method takes the
  collection as a parameter so it stays a *pure* function (no repository, no EF) the aggregate can call
  in-memory.
- **Where it's used**: called from [`Category`](#category)'s `Create`/`Update`/`AddCategoryItem`/
  `UpdateCategoryItem` and [`CategoryItem`](#categoryitem)'s `Create`/`Update`; length constants read by
  the EF configurations.

### CategoryItem
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/CategoryItem.cs:14` · Level 5 · class (sealed), SCC with `Category`, `CategoryInvariants`

- **What it is**: the child entity of [`Category`](#category): a selectable option within a category
  (e.g. "Beginner" within "Level"). Carries `Name`, `Sort`, the back-navigation `Category?`, and the FK
  `CategoryId`.
- **Depends on**,
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (Level 3), [`Category`](#category) (SCC), [`CategoryInvariants`](#categoryinvariants) (SCC),
  [`Result`](group-01-result-error-handling.md#result) (Level 2),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) (Level 0),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute) (Level 0).
- **Concept introduced, child entity vs. aggregate root.** `[Rubric §4, DDD]` (the entity hierarchy
  *within* an aggregate). A **child entity** has identity (it extends `AuditableBaseEntity<T>`) but is
  owned by a root and is never fetched directly from a repository, always loaded through its parent.
  Its `Create` factory (lines 47-65) mirrors the root's *validate then construct* shape but emits **no
  domain event**, event emission is the root's responsibility.
- **Walkthrough**
  - `[Navigation] public Category? Category { get; set; }` (lines 23-24): the back-navigation; `set` is
    public so EF can wire the navigation after materialization.
  - `CategoryId` (line 27): the FK, `get`-only, never externally set.
  - `Create` (lines 47-65): validates the name, resolves `IsIdValueGenerated` (line 57), constructs. No
    `AddDomainEvent`, [`Category`](#category) raises [`CategoryItemChanged`](#categoryitemchanged).
  - `Update` (lines 73-85): re-validates and sets `Name`/`Sort`; again no event.
- **Why it's built this way**: the child stays lean (only its own field constraints) so callers cannot
  bypass the parent's uniqueness/cascade rules by calling `categoryItem.Update(...)` directly.
- **Where it's used**: loaded through [`Category`](#category) (EF `Include` or navigation populator);
  referenced by [`SpeakerCategoryItem`](#speakercategoryitem) as the many-to-many bridge target.

### Question
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/Question.cs:15` · Level 5 · class (sealed)

- **What it is**: a standalone aggregate root for a survey/feedback question. A question targets an
  entity type (`QuestionEntity`: "Session"/"Event"/"Speaker"), has an input type (`QuestionType`:
  "Rating"/"Text"/"Email"), a sort order, an `IsRequired` flag, and a source ("Sessionize"/"User").
  Unlike the other aggregates here it owns no children, answers live on the answering entity
  ([`EventQuestionAnswer`](#eventquestionanswer), [`SpeakerQuestionAnswer`](#speakerquestionanswer)).
- **Depends on**,
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (Level 4), [`QuestionInvariants`](#questioninvariants) (Level 4),
  [`Result`](group-01-result-error-handling.md#result),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); domain event
  [`QuestionChanged`](#questionchanged).
- **Concept**: a "thin" aggregate root: the consistency boundary is just the question record itself.
  Note it is **not** marked `[IdValueGenerated]` (the class header has no attribute, line 15), Question
  ids are explicitly assigned (e.g. Sessionize), and `Create` resolves this through the same
  `typeof(Question).IsIdValueGenerated` check (line 88), which here returns `false` (so the `id!.Value`
  branch is taken, line 92).
- **Walkthrough**
  - `Create` (lines 71-98): four `QuestionInvariants` checks (text, entity, type, source) combined via
    `Result.Combine` (lines 80-84); construct; emit `QuestionChanged(Added)` (line 95).
  - `Update` (lines 109-132): re-validates text/entity/type but **drops the `questionSource`
    parameter**, source is immutable after creation (a business rule encoded by absence).
  - `Delete` (lines 136-144): emits `QuestionChanged(Deleted)`.
- **Why it's built this way**: validating against `QuestionInvariants`' closed value-lists (not
  free-form strings) means the domain rejects an invalid type/entity/source before persistence; making
  `QuestionSource` non-updatable preserves the provenance distinction (user-created vs. imported).
- **Where it's used**: referenced (by scalar FK `QuestionId`) from
  [`EventQuestionAnswer`](#eventquestionanswer) and [`SpeakerQuestionAnswer`](#speakerquestionanswer);
  fed into the feedback reports (Application/UI tiers).

### Speaker
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:15` · Level 5 · class (sealed), SCC with `SpeakerCategoryItem`, `SpeakerQuestionAnswer`

- **What it is**: the aggregate root for a conference speaker. Carries rich profile data (name, email
  as an [`Email`](group-02-domain-building-blocks.md#email) value object, bio, tag line, social/URL
  links, `IsTopSpeaker`), owns [`SpeakerCategoryItem`](#speakercategoryitem) join entities (which
  category items, topics, locality, describe the speaker) and
  [`SpeakerQuestionAnswer`](#speakerquestionanswer) children, and holds the cross-module link
  `LinkedUserId`. IDs are Sessionize-assigned GUIDs.
- **Depends on**,
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (Level 4), [`SpeakerInvariants`](#speakerinvariants) (Level 4),
  [`Email`](group-02-domain-building-blocks.md#email) (Level 4),
  [`SpeakerCategoryItem`](#speakercategoryitem) (SCC), [`SpeakerQuestionAnswer`](#speakerquestionanswer)
  (SCC), [`Result`](group-01-result-error-handling.md#result), [`Error`](group-01-result-error-handling.md#error),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute); domain event
  [`SpeakerChanged`](#speakerchanged), [`SpeakerCategoryItemChanged`](#speakercategoryitemchanged),
  [`SpeakerQuestionAnswerChanged`](#speakerquestionanswerchanged).
- **Concept**: the aggregate-root pattern (see [`Category`](#category)) plus a **cross-module link
  field** and **value-object composition**. `[Rubric §7, Microservices Readiness]` and `[Rubric §8,
  Data Architecture]`: `LinkedUserId` (line 55) is a nullable *scalar* FK to `User` in the Identity
  database, it cannot be an EF navigation because the two entities live in different databases
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). `Email` is a value object, so an invalid email can never be stored.
- **Walkthrough**
  - `FullName` (line 58): a computed `=>` property (`$"{FirstName} {LastName}"`), not stored.
  - `Create` (lines 110-157): parses `email` into an [`Email`](group-02-domain-building-blocks.md#email)
    value object *first* (lines 120-127), if email is supplied but invalid the factory fails before the
    name checks, avoiding a partial error list, then `Result.Combine`s the name invariants. The id
    assignment (line 151) is **the one that differs from its siblings**:
    `id ?? (isIdValueGenerated ? default : Guid.NewGuid())`. The inline comment (lines 146-150) records
    why: `SpeakerIdentifierType` is a client-assigned `Guid`; when no id is supplied (organizer-created
    speakers and the seeder both pass `null`) it *generates* one rather than dereferencing a null
    `Nullable`, the old `id!.Value` threw "Nullable object must have a value" and crashed Conference's
    startup seeding and every organizer "create speaker" call.
  - `Delete` (lines 229-245): BR-70 cross-context cleanup. It captures `LinkedUserId` into a local
    *before* `base.Delete()` (line 232), clears `LinkedUserId` within the Conference context (line 239),
    then emits `SpeakerChanged(Deleted, …, previousLinkedUserId)` (line 241) so the cross-context
    integration-event handler can clear `User.LinkedSpeakerId` in Identity. The event carries enough
    data for the handler to act without a synchronous call back ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).
  - `LinkUser`/`UnlinkUser` (lines 250-282): guard against already-linked / not-linked (BR-209), set or
    clear `LinkedUserId`, and emit `SpeakerChanged(Updated)`.
  - `AddSpeakerCategoryItem`/`RemoveSpeakerCategoryItem` (lines 292-337) and the
    `SpeakerQuestionAnswer` management methods (lines 353-414): the same aggregate-manages-child shape.
    `AddSpeakerCategoryItem` (line 292) **does** run an in-memory duplicate guard
    (`_speakerCategoryItems.Exists(...)`, lines 296-303), returning
    `Error.Invariant("Speaker.CategoryItem.Duplicate")` before delegating to the child factory, the same
    shape as `Event.AddEventSpeaker`. `AddSpeakerQuestionAnswer` (line 353), by contrast, has **no**
    duplicate guard, a speaker answering the same question twice is not blocked in the domain.
  - `SetSpeakerCategoryItems`/`SetSpeakerQuestionAnswers` (lines 341, 418): `internal` populator hooks.
- **Why it's built this way**: `LinkedUserId` as a nullable scalar (not a navigation) is the direct
  consequence of database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)): the bidirectional User↔Speaker link is maintained
  through integration events ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) and gRPC, never a cross-database FK. (Per the project memory,
  speaker locality is modeled as a `CategoryItem`, not a `Speaker.Location` field, hence the
  `SpeakerCategoryItem` collection rather than a scalar location property.)
- **Where it's used**: read by `IEntityQueryService`, mutated by the speaker handlers, and referenced
  (by FK) from [`EventSpeaker`](#eventspeaker), the Engagement bookmark entities, and the Identity
  `User`.

### SpeakerCategoryItem
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/SpeakerCategoryItem.cs:13` · Level 5 · class (sealed), SCC with `Speaker`, `SpeakerQuestionAnswer`

- **What it is**: the join entity linking a [`Speaker`](#speaker) to a [`CategoryItem`](#categoryitem).
  Holds `CategoryItemId` (FK), back-navigation `Speaker?`, and FK `SpeakerId`. DB-generated id.
- **Depends on**,
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (Level 3), [`Speaker`](#speaker) (SCC), [`Result`](group-01-result-error-handling.md#result),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute).
- **Concept**: the same explicit-join-entity pattern as [`EventSpeaker`](#eventspeaker). This is the
  physical representation of how a speaker's topics *and locality* are tracked: rather than a
  `Speaker.Location` field, locality is a `CategoryItem` (Category 121854 in the project notes) attached
  via this join. It is `[IdValueGenerated]` (line 12). `Create` (lines 36-48) is a pure FK pair with no
  content validation and no domain events ([`Speaker`](#speaker) raises
  [`SpeakerCategoryItemChanged`](#speakercategoryitemchanged)).
- **Where it's used**: loaded via `Speaker.SpeakerCategoryItems`; consumed by speaker-detail and
  locality-report features.

### SpeakerQuestionAnswer
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/SpeakerQuestionAnswer.cs:13` · Level 5 · class (sealed), SCC with `Speaker`, `SpeakerCategoryItem`

- **What it is**: the child entity of [`Speaker`](#speaker) holding an answer to a
  [`Question`](#question) for the speaker (e.g. "T-shirt size?"). Holds `QuestionId` (FK), `AnswerValue`,
  back-navigation `Speaker?`, and FK `SpeakerId`. DB-generated id.
- **Depends on**,
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (Level 3), [`Speaker`](#speaker) (SCC), [`SpeakerInvariants`](#speakerinvariants) (Level 4),
  [`Result`](group-01-result-error-handling.md#result),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute).
- **Concept**: the child-entity discipline of [`EventQuestionAnswer`](#eventquestionanswer), differing
  only in parent and the invariant class used. `Create` (lines 46-64) and `UpdateAnswer` (lines 71-80)
  validate via `SpeakerInvariants.EnsureAnswerValueIsValid`; no domain events ([`Speaker`](#speaker)
  raises [`SpeakerQuestionAnswerChanged`](#speakerquestionanswerchanged)).
- **Where it's used**: loaded via `Speaker.SpeakerQuestionAnswers`; shown on speaker feedback UIs.

### IEventCascadeDeletionDomainService
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Services/IEventCascadeDeletionDomainService.cs:12` · Level 7 · interface

- **What it is**: a pure domain-service interface that coordinates the cascade soft-delete of an
  [`Event`](#event) together with all of its [`Session`](#session)s (BR-127). Sessions are *separate*
  aggregates from `Event`, so they cannot be reached through `Event.Delete()` alone.
- **Depends on**: [`Event`](#event), [`Session`](#session) (domain aggregates),
  [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced, domain services for cross-aggregate coordination.** `[Rubric §4, DDD]`
  (assesses domain services for logic that belongs to no single aggregate) and `[Rubric §3, Clean
  Architecture]` (domain services live in the Domain layer with no infrastructure dependency). When a
  business operation spans two or more aggregate boundaries it belongs in a **domain service**, not in
  either aggregate. Deleting an event must also soft-delete its sessions (BR-127, BR-55), but
  [`Event`](#event) and [`Session`](#session) have separate identity and lifecycle. The service receives
  *pre-fetched* aggregates (loaded by the handler from the repository) and orchestrates the deletion
  purely in memory, no DB access, no repository calls. The interface lives in the Domain layer; the
  concrete [`EventCascadeDeletionDomainService`](#eventcascadedeletiondomainservice) lives **alongside
  it in the same namespace** (Domain), not in Infrastructure.
- **Walkthrough**: one method:
  `Result CascadeDelete(Event @event, IReadOnlyCollection<Session> sessions)` (line 21). The handler
  loads the event and its active sessions (with children), then calls
  `service.CascadeDelete(event, sessions)`.
- **Why it's built this way**: putting cascade logic in a domain service keeps the handler thin (fetch
  then service then save), keeps the domain expressive (cascade deletion is a named business concept),
  and keeps the domain infrastructure-free (it receives entities, not repositories). `[Rubric §14,
  Testability]`: trivially unit-testable, pass domain objects, assert `IsDeleted` and domain events
  without touching EF.
- **Where it's used**: consumed by
  [`DeleteEventHandler`](group-18-conference-application.md#deleteeventhandler) (Application tier), which
  resolves the abstraction from DI.
- **Caveats / not-in-source**: the prior tier guide described the implementation as living in
  `MMCA.ADC.Conference.Infrastructure`; the source places both interface and implementation in
  `MMCA.ADC.Conference.Domain.Services` (the implementation is a pure domain service with no
  infrastructure dependency).

### EventCascadeDeletionDomainService
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Services/EventCascadeDeletionDomainService.cs:11` · Level 8 · class (sealed)

- **What it is**: the concrete implementation of
  [`IEventCascadeDeletionDomainService`](#ieventcascadedeletiondomainservice): a stateless, pure domain
  service that cascade-soft-deletes an event's [`Session`](#session)s and then the [`Event`](#event)
  itself.
- **Depends on**: [`IEventCascadeDeletionDomainService`](#ieventcascadedeletiondomainservice),
  [`Event`](#event), [`Session`](#session), [`Result`](group-01-result-error-handling.md#result).
- **Concept**: see [`IEventCascadeDeletionDomainService`](#ieventcascadedeletiondomainservice) for the
  domain-service rationale. This class is the smallest possible realization of it: no fields, no
  constructor, one method, no infrastructure references, the class doc comment (lines 7-10) states it
  explicitly ("Pure domain service -- no infrastructure dependencies"). Because it is stateless it is
  registered as a singleton in the Conference Application DI via
  `services.TryAddSingleton<IEventCascadeDeletionDomainService, EventCascadeDeletionDomainService>()`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/DependencyInjection.cs:43`).
- **Walkthrough**: `CascadeDelete(Event @event, IReadOnlyCollection<Session> sessions)` (line 14):
  1. **Sessions first** (lines 17-20): `foreach` session call `session.Delete()` (BR-127; each session
     in turn cascades to its own children per BR-55). Note the per-session `Result` is *not* inspected
     here, the loop fires every delete unconditionally.
  2. **Then the event** (line 23): `return @event.Delete()`, which itself cascades to the event's owned
     children (rooms, event speakers, event question answers) per BR-72, and that `Result` is returned.
  Each `Delete()` also queues the corresponding domain events on its aggregate, which the unit of work
  dispatches after `SaveChangesAsync`.
- **Why it's built this way**: keeping the orchestration in a tiny pure class makes the multi-aggregate
  delete a single named, unit-testable unit while leaving each aggregate responsible for its own
  internal cascade. The handler stays a thin fetch then coordinate then persist slice.
- **Where it's used**: resolved (via the interface) and invoked by
  [`DeleteEventHandler`](group-18-conference-application.md#deleteeventhandler) after it loads the event
  and its active sessions; the `Result` it returns becomes the handler's outcome.
- **Caveats / not-in-source**: the method returns only the event's `Delete()` result, a failure inside
  an individual `session.Delete()` is not surfaced as the method's return value (each `session.Delete()`
  is a soft-delete of an `AuditableBaseEntity`, which in the current base implementation does not fail
  under normal conditions).


---
[⬅ Aspire Orchestration & Service Defaults](group-16-aspire-orchestration.md)  •  [Index](00-index.md)  •  [ADC Conference - Application & Use Cases ➡](group-18-conference-application.md)
