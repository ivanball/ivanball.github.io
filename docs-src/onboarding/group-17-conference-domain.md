# 17. ADC Conference - Domain Model & Module Contracts

**What this chapter covers.** This is the heart of the Atlanta Developers Conference application, the
**Conference bounded context**, the largest and richest domain in MMCA.ADC. It models everything an
organizer curates and an attendee browses: the **Event** (the conference itself, with its rooms,
speaker roster, and venue details), the **Session** (a talk on the schedule), the **Speaker**, the
**Sponsor** (the sold sponsorship and expo-booth record), the **Activity** (the party, coffee connect,
or closing ceremony that is deliberately not a session), the **Category**/**CategoryItem** taxonomy
(tracks, levels, session formats), and the **Question**/answer machinery that captures structured
metadata about events, sessions, and speakers. Eight aggregate roots (one of them an AI scorecard),
nine child entities, the static **invariant** classes that guard their business rules, the sixteen
**domain events** every mutation raises, a pure **domain service** that coordinates the
cross-aggregate cascade delete, and, in the module's `MMCA.ADC.Conference.Shared` project, the **DTO
contracts**, the cross-module **service interfaces** the Engagement module calls, the **integration
events** that keep the User-to-Speaker link and the engagement points ledger consistent across
services, and the **decision-support** read models that power the organizer's session-selection
dashboard. The detailed per-type sections follow; this overview shows how the pieces fit and how a
single change flows through them.

This chapter is almost entirely an *instantiation* of the framework taught in groups 1 through 14,
applied to a real, non-trivial domain. If a pattern here looks unfamiliar, it was introduced upstream
and is only cross-referenced now: the [`Result`](group-01-result-error-handling.md#result) pattern
(G01), the
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
entity hierarchy, the [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute)
marker, the [`IAuditedEntity`](group-02-domain-building-blocks.md#iauditedentity) change-history opt-in,
the [`IReactivatable`](group-02-domain-building-blocks.md#ireactivatable) restore marker, and
[`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) (G02), the
[`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) /
[`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype)
event bases and the outbox spine (G04), the
[`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity)
cross-container eager-loading extension point (G11), and the
[`IModule`](group-14-module-system-composition.md#imodule) composition system (G14). The lens this
chapter most strongly embodies is `[Rubric §4, Domain-Driven Design]` (does the model mirror the
business: aggregates, value objects, invariants, ubiquitous language?): this is the codebase's most
complete DDD specimen, and it is worth reading slowly, because the same shapes repeat across every
aggregate.

## Two packages, one bounded context

The Conference context spans two of the module's projects, and the split is deliberate Clean
Architecture (`[Rubric §3, Clean Architecture]`). **`MMCA.ADC.Conference.Domain`** holds the
behavior-rich aggregates, their invariants, their domain events, and the domain service: the ring
that knows nothing about EF Core, ASP.NET, or serialization.
**`MMCA.ADC.Conference.Shared`** holds the *contracts* that cross boundaries: the DTOs returned by
the API, the cross-module validation interfaces the Engagement module consumes
([`ISessionBookmarkValidationService`](#isessionbookmarkvalidationservice) and
[`IEventLiveValidationService`](#ieventlivevalidationservice)), the
[`SpeakerLinkedToUser`](#speakerlinkedtouser)/[`SpeakerUnlinkedFromUser`](#speakerunlinkedfromuser)
and [`SessionFeedbackSubmitted`](#sessionfeedbacksubmitted)/[`EventFeedbackSubmitted`](#eventfeedbacksubmitted)
integration events other modules subscribe to, and the feature-flag, permission, and status constants.

Read the reference direction carefully, because it is the opposite of what the names suggest: **Shared
is the module's bottom layer and Domain references it**, not the other way round
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/MMCA.ADC.Conference.Domain.csproj:8-12`).
The project file records why: the [`Event`](#event) aggregate exposes the
[`QuestionModerationDefault`](#questionmoderationdefault) enum, and that enum lives in `Shared` so the
DTOs, the Blazor UI, and the Engagement module can use it without referencing `Domain` at all. It is
the same direction `MMCA.Common.Domain` takes toward `MMCA.Common.Shared` (see
[primer §1](00-primer.md#1-the-big-picture)). `Shared` itself depends only on the two innermost
framework packages, `MMCA.Common.Shared` and `MMCA.Common.Domain`
(`.../MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.Shared.csproj:7-10`), which is what lets four
other projects reference it: the module's own UI
(`.../MMCA.ADC.Conference.UI/MMCA.ADC.Conference.UI.csproj:15`), Engagement's application and UI
layers, Identity's application layer, and even the standalone Engagement service host, which pulls it
in purely to register the disabled Conference stubs
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/MMCA.ADC.Engagement.Service.csproj:26-30`). A
handful of `Shared` types are `internal` (the two disabled stubs), so the project grants
`InternalsVisibleTo` to `Conference.API`, which registers them, and to its own test assembly
(`MMCA.ADC.Conference.Shared.csproj:2-6`).

The [`AssemblyReference`](#assemblyreference)/[`ClassReference`](#classreference) pair in `Domain`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/AssemblyReference.cs:5,11`) is the
conventional per-project anchor every layer in this repo ships: a static holder for the compiled
`Assembly` and its simple name (`AssemblyReference.cs:7-8`) that reflection-based registration can
name without hard-coding a string. Note for accuracy that the architecture-fitness map does not use
it: it pins the Conference domain assembly through a real type instead,
`typeof(Conference.Domain.Events.Event).Assembly`
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:36`).

## Eight aggregates and their ownership boundaries

An **aggregate** is a root entity plus the children it exclusively owns; invariants are enforced
*inside* the boundary, and references *across* aggregates are by ID, never by object graph. Every root
here derives from
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype),
so it inherits soft-delete, audit stamping, and the buffered `DomainEvents` collection:

- [`Event`](#event)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:23`) owns
  [`Room`](#room) (the physical rooms), [`EventSpeaker`](#eventspeaker) (the speaker roster, a join to
  `Speaker` *by ID*), and [`EventQuestionAnswer`](#eventquestionanswer) (event-level structured
  answers). Its `Id` is database-generated (marked `[IdValueGenerated]`, `Event.cs:22`), and it also
  carries the per-event live-layer moderation default (`Event.cs:77`), the published flag
  (`Event.cs:71`), the organizer contact email, sponsorship packet URL, and ticketing URL that drive
  the public pages (`Event.cs:56,62,68`, each of which the pages hide entirely when absent), and the
  Sessionize refresh stamp written by `RecordSessionizeRefresh` (`Event.cs:80,83,316`).
- [`Session`](#session)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/Session.cs:22`) owns
  [`SessionSpeaker`](#sessionspeaker), [`SessionCategoryItem`](#sessioncategoryitem), and
  [`SessionQuestionAnswer`](#sessionquestionanswer). Critically, a Session references its `Event` and
  `Room` by scalar FK (`EventId` at `Session.cs:64`, `RoomId` at `Session.cs:67`): they are *separate*
  aggregates, even though the model exposes `Event`/`Room` navigations (`Session.cs:69-75`, both
  `[Navigation]`-decorated and both private-setter, so the populator and query filtering can hydrate
  them) used only for read-side filtering, never to reach across the boundary and mutate. Session
  `Id`s are Sessionize-assigned, not database-generated (`Session.cs:15`), and `Duration` is a
  computed property over `StartsAt`/`EndsAt` rather than a stored column (`Session.cs:80-82`).
- [`Speaker`](#speaker)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:22`) owns
  [`SpeakerCategoryItem`](#speakercategoryitem) and [`SpeakerQuestionAnswer`](#speakerquestionanswer),
  holds an optional `Email` [value object](group-02-domain-building-blocks.md#email) (`Speaker.cs:31`),
  and carries the cross-module `LinkedUserId` FK to an Identity `User` (`Speaker.cs:58`). Speaker `Id`s
  are Sessionize-assigned GUIDs, with a fallback to `Guid.NewGuid()` for organizer-created and seeded
  speakers (see the in-code note at `Speaker.cs:155-161`).
- [`Sponsor`](#sponsor)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sponsors/Sponsor.cs:18`) is a flat
  root belonging to exactly one event by scalar `EventId` (`Sponsor.cs:45`, with a private-setter
  `[Navigation]` `Event` for public visibility filtering at `Sponsor.cs:48-49`). It carries a
  [`SponsorTier`](#sponsortier) that drives public placement, branding links, and the optional expo
  booth (`IsExhibitor`/`BoothNumber`, `Sponsor.cs:52,58`); its `Id` is database-generated
  (`Sponsor.cs:17`) because sponsors are sold, not imported from Sessionize. Moving a sponsor between
  events is deliberately not an update: `Update` omits the event entirely (`Sponsor.cs:153-163`).
- [`Activity`](#activity)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Activities/Activity.cs:20`) is the
  social and networking programme: the pre-conference party, the morning coffee connect, the
  after-party, the closing ceremony. It is deliberately *not* a session, and the type's own doc comment
  says why (`Activity.cs:11-17`): an activity has no room and no speakers, and it frequently happens at
  an external venue, so the venue travels on the activity itself (`VenueName`, `VenueAddress`,
  `VenueUrl` at `Activity.cs:42,45,48`) instead of being inherited from the event. Its `Id` is
  database-generated (`Activity.cs:19`) because activities are planned, not imported; it belongs to one
  event by scalar `EventId` with a private-setter `[Navigation]` for visibility filtering
  (`Activity.cs:54,57-58`); `StartTime`/`EndTime` are plain wall-clock `DateTime`s in the owning event's
  IANA zone, exactly like `Session.StartsAt`, with the zone kept on the event and never repeated per row
  (`Activity.cs:28-36`); and `SortOrder` breaks ties between activities starting at the same minute
  (`Activity.cs:51`). Like `Sponsor`, moving it between events is a create plus a delete rather than an
  update (`Activity.cs:99,145`).
- [`Category`](#category)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/Category.cs:16`) owns
  [`CategoryItem`](#categoryitem): the taxonomy roots ("Level", "Track", "Session format") and their
  selectable options. Its `Id` is database-generated too (`Category.cs:15`); Sessionize imports supply
  explicit IDs via `IDENTITY_INSERT`.
- [`Question`](#question)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/Question.cs:14`) is a flat
  aggregate (no children); its answers live on the *other* aggregates as `*QuestionAnswer` join
  entities, keyed by `QuestionId`. Its three free-text enum-like fields (`QuestionEntity`,
  `QuestionType`, `QuestionSource`, `Question.cs:20,23,32`) are validated against allow-lists rather
  than modeled as C# enums, so an unfamiliar Sessionize value fails validation instead of breaking
  deserialization.
- [`SessionAiScore`](#sessionaiscore)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionAiScore.cs:13`) is an
  AI-generated scorecard for a session: an overall score plus six per-criteria scores, all `decimal`
  (`SessionAiScore.cs:19-37`), together with the model's reasoning and model identifier
  (`SessionAiScore.cs:40-43`), each score range-guarded to 1.0 through 10.0 by a private helper
  (`SessionAiScore.cs:134-141`) that the factory and `Update` run through `Result.Combine`
  (`SessionAiScore.cs:68-74`). It is stored one per session and replaced on re-scoring through
  `Update` (`SessionAiScore.cs:98`), and it is the persistence side of the decision-support feature
  described below. That a *scorecard* is modeled as its own aggregate, referencing the Session by scalar
  `SessionId` (`SessionAiScore.cs:16`) rather than nesting under it, is a clean aggregate-boundary call:
  scores have an independent lifecycle (computed asynchronously, re-run on demand) and should not be
  loaded every time a Session is read. It is also the one root here that raises no domain events: no
  other part of the system reacts to a score being written.

The nine child entities all derive from `AuditableBaseEntity<TIdentifierType>` rather than from the
aggregate-root rung, because they have identity and audit but no independent lifecycle: they are
reached, created, and deleted only through their root (`Room.cs:13`, `EventSpeaker.cs:14`,
`EventQuestionAnswer.cs:13`, `SessionSpeaker.cs:14`, `SessionCategoryItem.cs:14`,
`SessionQuestionAnswer.cs:13`, `SpeakerCategoryItem.cs:14`, `SpeakerQuestionAnswer.cs:13`,
`CategoryItem.cs:14`). Five of them also implement
[`IReactivatable`](group-02-domain-building-blocks.md#ireactivatable): `Room`, `EventSpeaker`,
`SessionSpeaker`, `SessionCategoryItem`, and `SpeakerCategoryItem`, exactly the five a Sessionize
re-import can bring back from a soft delete, which is what the `Restore*` methods below act on.

Three of the roots opt into the framework's change-history trail by also implementing
[`IAuditedEntity`](group-02-domain-building-blocks.md#iauditedentity): `Event` (`Event.cs:23`),
`Session` (`Session.cs:22`), and `Speaker` (`Speaker.cs:22`). The in-code rationale is worth reading
(`Event.cs:16-20`, `Session.cs:16-20`, `Speaker.cs:15-20`): these three are written by organizers *and*
overwritten by the Sessionize sync, and "which edit moved this, and was it a person or the importer" is
a question that only a history answers. Sponsors, activities, categories, and questions do not carry
that cost.

## The aggregate shape, taught once

Open any of the roots and you will see the *same* skeleton; this repetition is the point, and it is
what makes the per-type sections that follow read quickly. The shape, using [`Event`](#event) as the
exemplar:

1. **Private-setter properties** (`Name { get; private set; }`, `Event.cs:26`): state can only change
   through the aggregate's own methods, never by an outside caller assigning a property. This is
   encapsulation as a compile-time guarantee (`[Rubric §4, Domain-Driven Design]`, `[Rubric §1,
   SOLID]`).
2. **Backing-field collections exposed as `IReadOnlyCollection<T>`** (`_rooms` at `Event.cs:85` becomes
   `Rooms => _rooms.AsReadOnly()` at `Event.cs:89`). Children can only be added, updated, or removed
   through `AddRoom`/`UpdateRoom`/`RemoveRoom`-style methods that enforce invariants (for example the
   duplicate-name rejection at `Event.cs:668-685`). Most collections are decorated
   `[Navigation(IsCollection = true)]` so the navigation-populator machinery (G11) eager-loads them,
   but two deliberately are **not**: `Event.EventQuestionAnswers` (`Event.cs:97-109`) and
   `Session.SessionQuestionAnswers` (`Session.cs:90-104`) opt out because those collections grow with
   attendance rather than with the schedule and were riding along on hot anonymous public reads that
   never render them; the session answers are also the one child collection here that is not public
   data (`Session.cs:99-102`). Handlers that genuinely need them pass an explicit `includes:` list.
   That is a `[Rubric §12, Performance & Scalability]` decision expressed as a deliberately absent
   attribute.
3. **A private EF Core constructor** (`Event.cs:112`, for materialization) plus a **private state
   constructor** (`Event.cs:118`) used only by the factory.
4. **A static `Create(...)` factory returning [`Result<T>`](group-01-result-error-handling.md#result)**
   (`Event.cs:164`): it validates invariants via `Result.Combine(...)` *before* constructing anything
   (`Event.cs:180-183`), so an invalid aggregate is unrepresentable, then raises an `Added` domain
   event (`Event.cs:207`). The `isIdValueGenerated ? default : id!.Value` dance (`Event.cs:187,203`)
   reconciles database-generated IDs with explicitly supplied ones. Each root spells that
   reconciliation slightly differently: [`Speaker`](#speaker) generates a GUID when no id is supplied
   (`Speaker.cs:161`), [`Category`](#category) throws for a missing id when identity is not
   database-generated (`Category.cs:69`), and [`Activity`](#activity) uses the plain `Event` form
   (`Activity.cs:99`).
5. **Mutator methods** (`Update` at `Event.cs:229`, `Publish`/`Unpublish` at `Event.cs:272,292`,
   `LinkUser`/`UnlinkUser` on Speaker at `Speaker.cs:272,290`) that re-validate, mutate, and raise an
   `Updated` event. Lifecycle guards return failures rather than throwing: publishing an already
   published event yields the `"Event.AlreadyPublished"` invariant error (`Event.cs:274-281`).
6. **An overridden `Delete()`** (`Event.cs:328`) that soft-deletes **children first and the root last**,
   combining all four results in one `Result.Combine(...)`: `DeleteChildren<T, TId>(...)` for rooms,
   event speakers, and event answers, then `base.Delete()` (the soft-delete from G02) at
   `Event.cs:334-337`, with the `Deleted` event raised only when the whole combination succeeded
   (`Event.cs:340`). The in-code comment states the reason for that ordering (`Event.cs:330-332`): a
   failing child leaves the cascade reported as a failure instead of a half-applied delete whose
   earlier children and root were already flagged. [`Session`](#session) does the same for its three
   child collections (`Session.cs:288-291,294`), [`Category`](#category) for its items
   (`Category.cs:107-108,111`), [`Sponsor`](#sponsor) and [`Activity`](#activity) have nothing to
   cascade to and simply raise their `Deleted` events (`Sponsor.cs:190-197`, `Activity.cs:180-188`),
   and [`Speaker`](#speaker) uses its override for a different job: clearing the cross-context link
   while deliberately leaving its junction children alive so the Sessionize import can reactivate them
   in place (`Speaker.cs:241-267`). Soft-delete is the default everywhere (`[Rubric §8, Data
   Architecture]`: the `IsDeleted` flag plus EF Core global query filters, never a hard `DELETE`;
   [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)).
7. **Restore methods for the Sessionize round-trip** (`RestoreRoom` at `Event.cs:438`,
   `RestoreEventSpeaker` at `Event.cs:546`, `RestoreSessionSpeaker` and `RestoreSessionCategoryItem` at
   `Session.cs:352,435`, and `RestoreSpeakerCategoryItem` at `Speaker.cs:352`): a re-imported child that
   was previously soft-deleted is reactivated in place rather than re-inserted. A restore has to clear
   the same uniqueness bar as an add, which is why `RestoreRoom` re-runs the duplicate-name check before
   reactivating (`Event.cs:459`), and it first refuses any room owned by a different event
   (`Event.cs:447`): room ids come from a global Sessionize sequence, `Room.EventId` has no setter
   (`Room.cs:38`), and adding a foreign room to this collection would let EF relationship fixup silently
   move the row (the comment spelling that out sits at `Event.cs:442-446`).
8. **`internal SetX(...)` methods** (`Event.cs:498,580,654`) delegating to the framework's `SetItems`
   helper: the hooks the navigation populators call to hydrate the read-only collections after a batch
   load.

Because the shape is identical, the child entities ([`Room`](#room), the `*Speaker`/`*CategoryItem`
joins, the three `*QuestionAnswer` types) and their `*Changed` domain events are documented as
**sibling families** in the sections that follow: taught once, then tabulated.

## Invariants, business rules as testable units

Each aggregate has a co-located static **invariant class**, [`EventInvariants`](#eventinvariants)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/EventInvariants.cs:13`),
[`SessionInvariants`](#sessioninvariants), [`SpeakerInvariants`](#speakerinvariants),
[`SponsorInvariants`](#sponsorinvariants), [`ActivityInvariants`](#activityinvariants),
[`CategoryInvariants`](#categoryinvariants), and [`QuestionInvariants`](#questioninvariants), whose
methods each return a [`Result`](group-01-result-error-handling.md#result) and are combined with
`Result.Combine(...)` in the factory and mutators. They build on
[`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (G02) for the generic
string-not-empty and max-length checks (`EventInvariants.cs:70-73`) and add domain-specific rules.

They also carry the **length constants**, but note where those numbers actually originate: each
invariant constant is an alias of a constant declared on the matching DTO in `Conference.Shared`
(`public const int NameMaxLength = EventDTO.NameMaxLength;`, `EventInvariants.cs:16-57`, and the same
pattern at `SessionInvariants.cs:16-34`, `SpeakerInvariants.cs:16-40`, `SponsorInvariants.cs:16-34`,
`ActivityInvariants.cs:16-28`, `CategoryInvariants.cs:18-24`, `QuestionInvariants.cs:16-25`). The DTO
is the lowest layer the domain, the EF configuration, and the Blazor pages can all reach, so a field
cap is declared once on [`EventDTO`](#eventdto) and consumed by the domain rule, the column
constraint, and the input's character counter alike (`EventInvariants.cs:8-11` records the reasoning).
The only length constants declared in `Domain` itself are the ones no DTO owns, the 4000-character
answer-value caps (`EventInvariants.cs:58`, `SessionInvariants.cs:37`, `SpeakerInvariants.cs:43`).

The domain-specific rules are where the ubiquitous language shows up. `SessionInvariants` holds the
BR-91 service-session guard (`SessionInvariants.cs:94`), the BR-49 status-eligibility check whose
failure code is `"Session.StatusIneligible"` (`SessionInvariants.cs:109,112`), the BR-122
zero-duration guard whose failure code is `"Session.Duration.Invalid"`
(`SessionInvariants.cs:126-134`), and the reserved manual id range `999_999_000` through `999_999_999`
for sessions that did not come from Sessionize (`SessionInvariants.cs:44,47`, mirrored for rooms at
`EventInvariants.cs:65,68` and for questions at
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/QuestionInvariants.cs:40,43`).
`QuestionInvariants` validates the free-text enum-like fields against allow-lists
(`QuestionInvariants.cs:31,34,37`, checked at `:71,86,101`) and, for answers, dispatches on the
question type (`QuestionInvariants.cs:118`): Rating must parse as an invariant-culture integer 1
through 5 (`QuestionInvariants.cs:133`), Text is capped at 2000 characters
(`QuestionInvariants.cs:28,147`), and Email must parse as a `System.Net.Mail.MailAddress`
(`QuestionInvariants.cs:163`). `ActivityInvariants` is the compact newcomer: name, venue name, venue
address, and venue URL length checks plus a start-before-end time-range rule
(`ActivityInvariants.cs:36,48,58,68,79`). `CategoryInvariants` enforces case-insensitive uniqueness of
an item name within its category (BR-138,
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/CategoryInvariants.cs:44`),
and its in-code note explains why the exclusion parameter is nullable rather than defaulted: a
database-generated `CategoryItem` id is 0 until the save, so a `default` exclusion would silently
exempt every unsaved sibling (`CategoryInvariants.cs:49-51`). Centralizing each rule as a named,
side-effect-free method is what makes the domain exhaustively unit-testable (`[Rubric §14,
Testability]`), and the error codes (`"Event.AlreadyPublished"` at `Event.cs:277`,
`"Session.StatusIneligible"` at `SessionInvariants.cs:112`) *are* the business vocabulary. The
recurring `// BR-NN` comments are traceability links back to the business-requirements catalogue.

A nuance worth flagging: the `Status` field on Session is free text, imported verbatim from Sessionize
(`Session.cs:37`), and [`SessionStatuses`](#sessionstatuses)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionStatuses.cs:14`) is the
constant catalogue of the recognized values (`Accepted`, `Waitlisted`, `Accept_Queue`, `Nominated`,
`Decline_Queue`, `Declined`, at `SessionStatuses.cs:17-32`, enumerated for organizer filter dropdowns
at `SessionStatuses.cs:37`) plus the `IsEligible(...)` rule. Read that rule carefully, because it is an
**allow-list, not a deny-list**: only `Accepted`, or an unset status (organizer-created sessions never
carry one), is eligible for public display, bookmarking, and feedback; every other value, known or
unknown, is ineligible (BR-49, `SessionStatuses.cs:53-55`, with the reasoning at
`SessionStatuses.cs:8-13`). Adding a constant to this class therefore does not make that status
publicly visible, which is the safe default for a free-text field fed by an external system. Using
`const string` values instead of a C# `enum` means an unrecognized Sessionize status does not break
deserialization; the type lives in `Domain` because eligibility is a domain rule, and it is referenced
from the cross-module bookmark validation too. `[Rubric §8, Data Architecture]` (deliberate handling of
externally sourced data).

## Domain events and the outbox spine

Every state-changing method raises a domain event through the inherited `AddDomainEvent(...)`, and the
sixteen events come in two shapes with two different base types. The seven **aggregate-level** ones,
[`EventChanged`](#eventchanged), [`SessionChanged`](#sessionchanged), [`SpeakerChanged`](#speakerchanged),
[`CategoryChanged`](#categorychanged), [`QuestionChanged`](#questionchanged),
[`SponsorChanged`](#sponsorchanged), and [`ActivityChanged`](#activitychanged), derive from
[`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype)
and carry the [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate)
(Added/Updated/Deleted) plus a friendly label, and sometimes one extra correlating field:
`SessionChanged` also carries the parent `EventId`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionChanged.cs:13-18`).
The nine **child-level** ones, [`RoomChanged`](#roomchanged), [`EventSpeakerChanged`](#eventspeakerchanged),
[`EventQuestionAnswerChanged`](#eventquestionanswerchanged),
[`SessionSpeakerChanged`](#sessionspeakerchanged),
[`SessionCategoryItemChanged`](#sessioncategoryitemchanged),
[`SessionQuestionAnswerChanged`](#sessionquestionanswerchanged),
[`SpeakerCategoryItemChanged`](#speakercategoryitemchanged),
[`SpeakerQuestionAnswerChanged`](#speakerquestionanswerchanged), and
[`CategoryItemChanged`](#categoryitemchanged), derive from
[`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) instead, because a child change is not a
change of *that root's* identity: they carry both the parent and child IDs (for example
`RoomChanged(state, Id, room.Id, room.Name)` raised at `Event.cs:417`, declared at
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/DomainEvents/RoomChanged.cs:13-18`)
so a consumer can target the precise change. These are **intra-module domain events**: they ride the
outbox ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) but are consumed
inside Conference. They do not cross the wire to other services; that is the job of integration events,
and only those carry an explicit
[`EventNameAttribute`](group-02-domain-building-blocks.md#eventnameattribute) wire name.

The flow is exactly the outbox spine from [G04](group-04-events-outbox.md): a mutator buffers the event
on the aggregate; on `SaveChangesAsync` the domain-event save-changes interceptor serializes it into an
[`OutboxMessage`](group-04-events-outbox.md#outboxmessage) row in the *same* transaction; dual dispatch
then delivers it at least once. Nothing in this chapter's code does any dispatching; the aggregates
only *declare* what happened, which is the Clean Architecture division of labor (`[Rubric §6, CQRS &
Event-Driven]`). One domain detail matters for the cross-context link: `Speaker.Delete()` captures the
previous `LinkedUserId` *before* clearing it and passes it into the `Deleted`
[`SpeakerChanged`](#speakerchanged) event (`Speaker.cs:254,261,263`), whose optional
`PreviousLinkedUserId` payload field
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/DomainEvents/SpeakerChanged.cs:20`)
exists precisely so the cross-context cleanup handler has what it needs even though the field is
already nulled within Conference (BR-70).

## The cross-aggregate cascade: a pure domain service

One business rule cannot live inside a single aggregate: deleting an `Event` must also delete every
`Session` belonging to it (BR-127), every `Sponsor` sold against it, and every `Activity` planned for
it, but sessions, sponsors, and activities are *separate* aggregates (referenced by `EventId`, not
owned). Putting a `List<Session>` inside `Event` would violate the aggregate boundary. The answer is a
**domain service**, [`IEventCascadeDeletionDomainService`](#ieventcascadedeletiondomainservice)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Services/IEventCascadeDeletionDomainService.cs:15`)
and its implementation [`EventCascadeDeletionDomainService`](#eventcascadedeletiondomainservice)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Services/EventCascadeDeletionDomainService.cs:16`),
a pure, infrastructure-free coordinator that takes the pre-fetched `Event` plus its already-loaded
`Session`, `Sponsor`, and `Activity` collections (`IEventCascadeDeletionDomainService.cs:28-32`) and
orchestrates the deletes: soft-delete each session first (BR-55 cascades to *its* children), then each
sponsor, then each activity, then the event itself (BR-72 cascades to rooms, event speakers, and event
answers) (`EventCascadeDeletionDomainService.cs:28-55`). The ordering is what makes the failure path
safe: the first child that refuses to delete short-circuits the cascade and returns its own failure
unchanged, so the event is never deleted and the caller (which saves only on success) discards the
aborted in-memory mutations rather than persisting a half-deleted graph
(`EventCascadeDeletionDomainService.cs:25-52`). Activities were folded into the same cascade for the
reason recorded beside the loop: leaving them behind would orphan rows the public activities page still
reads (`EventCascadeDeletionDomainService.cs:44-46`). This is `[Rubric §4, Domain-Driven Design]`'s
textbook "domain service for behavior that spans aggregates and belongs to no single one," and `[Rubric
§3, Clean Architecture]`'s purity discipline: the service does no I/O; the *application* layer fetches
the aggregates and saves them. It is the highest-level type in the chapter precisely because it depends
on four aggregates at once.

## Read models and the AI decision-support feature

The largest cluster in `Conference.Shared` is the **DTO** layer, the wire contracts that decouple the
API from the domain entities (`[Rubric §9, API & Contract Design]`;
[ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) chose manual/Mapperly
mapping over reflection-based AutoMapper). Most are straightforward projections:
[`EventDTO`](#eventdto), [`SessionDTO`](#sessiondto), [`SpeakerDTO`](#speakerdto),
[`SponsorDTO`](#sponsordto), [`ActivityDTO`](#activitydto),
[`ConferenceCategoryDTO`](#conferencecategorydto), [`CategoryItemDTO`](#categoryitemdto),
[`QuestionDTO`](#questiondto), [`RoomDTO`](#roomdto), and the per-child join DTOs
([`EventSpeakerDTO`](#eventspeakerdto), [`SessionSpeakerDTO`](#sessionspeakerdto),
[`SessionCategoryItemDTO`](#sessioncategoryitemdto),
[`SpeakerCategoryItemDTO`](#speakercategoryitemdto), and the three `*QuestionAnswerDTO` records:
[`EventQuestionAnswerDTO`](#eventquestionanswerdto),
[`SessionQuestionAnswerDTO`](#sessionquestionanswerdto),
[`SpeakerQuestionAnswerDTO`](#speakerquestionanswerdto)), plus the speaker-facing feedback shapes
[`SessionFeedbackDTO`](#sessionfeedbackdto) with its [`RatingQuestionSummary`](#ratingquestionsummary)
and [`TextQuestionResponses`](#textquestionresponses) members (BR-210,
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SessionFeedbackDTO.cs:6,22,38`).
They carry the entity's `Id` via the framework's
[`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) contract and
`required init`-only properties: read contracts, immutable after construction. Five of them also
implement [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) and round-trip the
`RowVersion` token
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/EventDTO.cs:14,50`, and the same
pair on `Sessions/SessionDTO.cs:15,42`, `Speakers/SpeakerDTO.cs:18,58`, `Sponsors/SponsorDTO.cs:15,42`,
and `Activities/ActivityDTO.cs:15,36`). The client sends that token straight back in the `If-Match`
header rather than in a body field: the publish and unpublish endpoints are marked
[`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute) and read the
required token from the header before building their command
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventsController.cs:264,272,297,305`),
so a transition decided against a stale view surfaces as a conflict instead of applying silently, and a
request with no `If-Match` at all is refused outright
([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). Alongside those sit
the small task-shaped contracts: [`LinkUserRequest`](#linkuserrequest) (the manual speaker-to-user link
body, BR-209,
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/LinkUserRequest.cs:6`),
[`RefreshFromSessionizeResultDTO`](#refreshfromsessionizeresultdto) (per-entity synced counts, the
BR-136 skipped-soft-deleted count, and non-fatal warnings,
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/RefreshFromSessionizeResultDTO.cs:7,28,31`),
and the glanceable [`NowNextDTO`](#nownextdto)/[`NowNextSessionDTO`](#nownextsessiondto) snapshot behind
the public now-next endpoint (the Android home-screen widget payload, carrying both event-local wall
clock and UTC instants,
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/NowNextDTO.cs:14,29`).

A distinct and more interesting subgroup is the **`DecisionSupport`** namespace: read models built
purely to help an organizer *curate* a conference.
[`SessionSelectionDashboardDTO`](#sessionselectiondashboarddto)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SessionSelectionDashboardDTO.cs:8`)
is the composite; for one event it carries the total, accepted, accept-queue, pending, and declined
counts (`SessionSelectionDashboardDTO.cs:17-29`), a
[`CategoryDistributionDTO`](#categorydistributiondto) (how sessions spread across tracks and levels,
itself built from [`CategoryGroupDistribution`](#categorygroupdistribution) and
[`CategoryItemDistribution`](#categoryitemdistribution)), a
[`SpeakerSessionOverlapDTO`](#speakersessionoverlapdto) (speakers with multiple submissions, via
[`MultiSessionSpeaker`](#multisessionspeaker) and [`SpeakerSessionSummary`](#speakersessionsummary)),
per-tier [`SpeakerLocalitySummary`](#speakerlocalitysummary) counts
(`SessionSelectionDashboardDTO.cs:38,45`), and a list of [`SessionAiScoreDTO`](#sessionaiscoredto)
(`SessionSelectionDashboardDTO.cs:41`). The locality breakdown is the Atlanta-versus-elsewhere signal
behind the local-speaker preference, and it is derived from a **locality category** in the taxonomy
rather than from a field on `Speaker`: the dashboard handler resolves each speaker's tier through the
[`SpeakerLocalityHelper`](group-18-conference-application.md#speakerlocalityhelper) lookup
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardHandler.cs:75-76,286`).
[`ContentSimilarityDTO`](#contentsimilaritydto) and its [`SimilarSessionPair`](#similarsessionpair)
rows (near-duplicate talks, scored 0.0 to 1.0 with the shared category items and keywords that drove the
score, `ContentSimilarityDTO.cs:34-41`) are *not* members of the composite record: they are served by
their own endpoint on the same controller
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSelectionController.cs:82`).
The AI scores are produced by an Anthropic-backed scoring service in `Conference.Infrastructure`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:16`,
outside this chapter) and persisted as the [`SessionAiScore`](#sessionaiscore) aggregate;
[`ScoreEventSessionsResultDTO`](#scoreeventsessionsresultdto) reports a batch run's scored and failed
counts
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SessionAiScoreDTO.cs:60-67`).

The whole organizer workflow is guarded by the `conference:session-selection:manage` capability
permission catalogued in [`ConferencePermissions`](#conferencepermissions)
(`ConferencePermissions.cs:30`), applied once at the controller level
(`SessionSelectionController.cs:29`), not by a feature flag. The one flag the module does carry,
[`ConferenceFeatures`](#conferencefeatures)`.SessionizeIntegration`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/ConferenceFeatures.cs:15`), gates only
the Sessionize external sync that seeds the raw session data this dashboard then analyzes: the
`RefreshFromSessionizeCommand` implements [`IFeatureGated`](group-05-cqrs-pipeline.md#ifeaturegated)
and returns the flag name from its `FeatureName` property
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeCommand.cs:13,19`),
so the decorator pipeline short-circuits it when the flag is off (`[Rubric §10, Cross-Cutting
Concerns]`, [ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html)). The
scoring and dashboard handlers are not flag-gated.

## Authorization vocabulary and current-event selection

Two more `Shared` helpers deserve a mention because they encode policy the whole module relies on.
[`ConferencePermissions`](#conferencepermissions)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:9`)
is the catalogue of the module's nine **capability permissions** (`conference:events:manage`,
`conference:sessions:manage`, `conference:sponsors:manage`, `conference:activities:manage`, and so on,
`ConferencePermissions.cs:12-36`), the stable string identifiers endpoints require via
[`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) rather than by role name. The `All`
and `ContentManagement` subsets (`ConferencePermissions.cs:39,57`) let a role grant an entire
capability set or the narrower catalog-curation slice (sessions, speakers, sponsors, activities, and
the category taxonomy) at once, a distinction capability checks express centrally and role checks
cannot. This is the permission-based authorization story (`[Rubric §11, Security]`,
[ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)), decided by the
role-to-permission grants declared in the module's registration rather than scattered across
controllers. Beside it sits [`ConferenceReadAudience`](#conferencereadaudience)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferenceReadAudience.cs:23`),
the answer to the *other* question a caller raises, not "may I change this" but "how much of the catalog
may I see": exactly two audiences exist, the privileged readers
([`RoleNames`](group-08-auth.md#rolenames)`.Organizer` and `.ContentEditor`,
`ConferenceReadAudience.cs:26-30`) and everyone else, and naming them once is what keeps the
output-cache bypass list and the API-layer visibility checks from ever disagreeing. A third,
partially-privileged audience would need its own cache key, which is why the type's own remarks tell you
to check the cache policies before extending the list (`ConferenceReadAudience.cs:17-21`).

[`CurrentEventSelector`](#currenteventselector)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/CurrentEventSelector.cs:10`) is
the pure, generic helper every landing surface uses to pick *which* published event to feature: the
event live now (soonest to end), else the next upcoming (soonest to start), else the most recently
ended (`CurrentEventSelector.cs:38-52`). It shares the exact live-window math the backend enforces:
`StartDate` at 00:00 local through `EndDate + 1 day` at 00:00 local (exclusive), converted from the
event's IANA time zone to UTC (`CurrentEventSelector.cs:64-74`). There is no unknown-zone fallback and
the code says why: `EventInvariants.EnsureTimeZoneIsValid` guards every write path, so the id always
resolves (`CurrentEventSelector.cs:55-58`). One subtlety earns its own method: both window boundaries
land on local midnight, which does not exist in zones that spring forward at 00:00, so `ToUtc` shifts an
invalid wall-clock time forward by an hour rather than letting `TimeZoneInfo.ConvertTimeToUtc` throw
(`CurrentEventSelector.cs:87-98`, the shift itself at `:92-95`). Because the selector is generic over
the event model, each consumer passes its own DTO plus accessor delegates, so the selection rule lives
in one tested place rather than being re-derived per surface;
[`CurrentEventDefaults`](#currenteventdefaults)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/CurrentEventDefaults.cs:8,17-23`)
is the thin wrapper that binds those delegates for the common [`EventDTO`](#eventdto) shape.

## Crossing the module boundary: contracts, stubs, and integration events

Conference does not live alone. Three kinds of connection point join it to other modules, and all live
in `Conference.Shared` so neither side reaches into the other's domain (`[Rubric §7, Microservices
Readiness]`, `[Rubric §3, Clean Architecture]`):

- **Synchronous bookmark validation (inbound).** The Engagement module needs to validate that a
  session is bookmarkable (exists, not a service session per BR-91, eligible status per BR-49) and to
  enumerate a session's IDs by event (BR-58). It depends on the
  [`ISessionBookmarkValidationService`](#isessionbookmarkvalidationservice) *interface*
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/ISessionBookmarkValidationService.cs:11,20,31`),
  which is marked
  [`ServiceContractAttribute`](group-13-grpc-contracts.md#servicecontractattribute)
  (`ISessionBookmarkValidationService.cs:10`) so the contract-purity fitness tests hold it to
  entity-free, extraction-safe signatures. It is implemented in `Conference.Application` in process, or
  by a gRPC adapter when the modules run as separate services
  ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)). When Conference is
  *disabled* in a host, [`DisabledSessionBookmarkValidationService`](#disabledsessionbookmarkvalidationservice)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DisabledSessionBookmarkValidationService.cs:30`)
  is registered as a null-object stub that approves every validation and returns an empty ID set
  (`DisabledSessionBookmarkValidationService.cs:33-38`): graceful degradation rather than a
  missing-dependency crash. The registration point is the module itself,
  `ConferenceModule.RegisterDisabledStubs`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:21-25`), an
  [`IModule`](group-14-module-system-composition.md#imodule) hook the host calls when it composes
  without Conference.

- **Synchronous live-layer validation (inbound).** The Engagement conference-day live layer asks
  Conference four questions, and the four members of
  [`IEventLiveValidationService`](#ieventlivevalidationservice)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/IEventLiveValidationService.cs:12`,
  also a `[ServiceContract]` at `:11`) are exactly those questions: is this event published and inside
  its live window ([`EventLiveInfo`](#eventliveinfo), `IEventLiveValidationService.cs:22`); for a
  session, who are the assigned speakers (BR-236), is it a plenum session, and what is the event's
  question moderation default ([`SessionLiveInfo`](#sessionliveinfo),
  `IEventLiveValidationService.cs:33`); for a sponsor scanned from a printed booth QR code, does it
  exist and belong to a published event ([`SponsorLiveInfo`](#sponsorliveinfo),
  `IEventLiveValidationService.cs:44`); and which session is a given room hosting right now
  ([`RoomSessionInfo`](#roomsessioninfo), `IEventLiveValidationService.cs:60-63`), so a check-in never
  has to trust a client-supplied session id. Each returns a snapshot record, never a Conference domain
  entity. Note where the policy line falls on that last one: the grace window travels *in the request*
  as a parameter rather than living in Conference config, because how early a session counts as current
  is check-in policy and Conference only answers the schedule question
  (`IEventLiveValidationService.cs:51-54`,
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/RoomSessionInfo.cs:8-12`). The
  moderation default is the [`QuestionModerationDefault`](#questionmoderationdefault) enum
  (`Pending = 0`/`Approved = 1`, BR-233,
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/QuestionModerationDefault.cs:7-13`)
  carried on the `Event` (`Event.cs:77`, defaulted to `Pending` in both `Create` and `Update`,
  `Event.cs:175,239`). The disabled stub,
  [`DisabledEventLiveValidationService`](#disabledeventlivevalidationservice)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/DisabledEventLiveValidationService.cs:22`),
  deliberately **fails open** on all four: an always-open window and a published flag for events and
  sponsors, a default event id with no assigned speakers for sessions, and the room's own id echoed
  back as the session id (`DisabledEventLiveValidationService.cs:25-62`), so the live-layer handlers can
  run without an in-process Conference module, at the cost of skipping those checks until the host is
  wired to the Conference gRPC adapter.

- **Asynchronous notifications (outbound).** Two families of integration event leave the module. When
  Conference links or unlinks a Speaker to or from an Identity `User` (the manual link command, or the
  automatic email-match triggered by Identity's `UserRegistered` event), it publishes
  [`SpeakerLinkedToUser`](#speakerlinkedtouser) / [`SpeakerUnlinkedFromUser`](#speakerunlinkedfromuser)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/IntegrationEvents/SpeakerLinkedToUser.cs:22`
  and `.../IntegrationEvents/SpeakerUnlinkedFromUser.cs:19`), records extending
  [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent) and carrying just the two
  identifiers. Identity subscribes and sets or clears `User.LinkedSpeakerId`, so the next JWT refresh
  carries the `speaker_id` claim (BR-209). When an attendee submits feedback, the answer handlers raise
  [`SessionFeedbackSubmitted`](#sessionfeedbacksubmitted) /
  [`EventFeedbackSubmitted`](#eventfeedbacksubmitted)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/IntegrationEvents/SessionFeedbackSubmitted.cs:21`,
  `.../Events/IntegrationEvents/EventFeedbackSubmitted.cs:20`), which Engagement consumes to award
  points. All four declare their wire name explicitly with
  [`EventNameAttribute`](group-02-domain-building-blocks.md#eventnameattribute), versioned
  (`"Conference.SpeakerLinkedToUser.v1"` at `SpeakerLinkedToUser.cs:21`,
  `"Conference.SessionFeedbackSubmitted.v1"` at `SessionFeedbackSubmitted.cs:20`), so a rename of the
  C# type cannot silently break a subscriber. Two details in the two feedback records are load-bearing:
  they are raised on the **create path only**, never on the BR-107 update path of the feedback upsert,
  and the consumer is independently idempotent because one submitted form writes one row per question
  and therefore raises the event once per new answer (`SessionFeedbackSubmitted.cs:9-14`). They are also
  added to the aggregate pre-save with `AddDomainEvent`, so the outbox captures them atomically with the
  answer in the same `SaveChangesAsync`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionQuestionAnswer/AddSessionQuestionAnswerHandler.cs:112`).
  All four are the eventually consistent replacement for what would otherwise be direct cross-module
  service calls: the links and the points ledger survive the service split because they travel as events
  over the broker ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)/[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).

## End-to-end: one organizer action

To see the chapter cooperate, follow an organizer renaming a room on an event. The application handler
loads the [`Event`](#event) aggregate (with its `Rooms` hydrated by the navigation populator), calls
`event.UpdateRoom(...)` (`Event.cs:395`), which routes through the private `GetRoomOrNotFound` helper
(`Event.cs:404`, implemented at `Event.cs:687-690` and delegating to the framework's
`GetChildOrNotFound`, so a missing or soft-deleted room comes back as a `NotFound`
[`Result`](group-01-result-error-handling.md#result) rather than an exception), re-checks the
case-insensitive room-name uniqueness rule that mirrors the database index (`Event.cs:409`, implemented
at `Event.cs:668-685`), delegates to the child's own `Room.Update(...)` (which validates *its*
invariants, `Event.cs:413`), and on success raises a [`RoomChanged`](#roomchanged) `Updated` event
(`Event.cs:417`). The handler calls `SaveChangesAsync`; the interceptor writes the `RoomChanged` to the
outbox in the same transaction; and because the command itself declares
[`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) with the `Event` type's full name
as its prefix
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/UpdateRoom/UpdateRoomCommand.cs:23,26`),
the decorator pipeline evicts the event's cached reads so the next query is fresh. No exception was
thrown on the expected not-found path, no child was mutated from outside its aggregate, no event was
hand-dispatched, and the same code path would behave identically whether Conference runs in the monolith
or as its own service, which is exactly the property the framework groups (G01 through G14) exist to
provide, here made concrete in a domain you can reason about. For the *why* behind each design choice,
[ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) (manual mapping),
[ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html) (navigation populators),
[ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) (outbox),
[ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) (soft-delete versus
erasure),
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)/[ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)/[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)
(database-per-service, gRPC extraction, service topology),
[ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)
(permission-based authorization),
[ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html) (feature flags), and
[ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html) (optimistic concurrency)
are the primary references; the business rules themselves are catalogued in ADC's specifications guide.

### AssemblyReference, ClassReference
<a id="assemblyreference"></a><a id="classreference"></a>
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/AssemblyReference.cs:5` · Level 0 · class (static) + class

- **What it is**: the two assembly-marker types that give `typeof()`-based assembly scanning a stable handle on the `MMCA.ADC.Conference.Domain` assembly. No behavior, no state beyond the reflection handle.

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `AssemblyReference` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/AssemblyReference.cs:5` | `static class` exposing `Assembly` (`typeof(AssemblyReference).Assembly`, line 7) and `AssemblyName` (line 8, `Assembly.GetName().Name ?? string.Empty`) |
| `ClassReference` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/AssemblyReference.cs:11` | a one-line empty `public class ClassReference { }`, a handle for APIs that want a *type* rather than an `Assembly` |

- **Depends on**: nothing first-party; only `System.Reflection` (`AssemblyReference.cs:1`).
- **Concept introduced, the assembly-marker pattern.** `[Rubric §2, Design Patterns]` (assesses whether the patterns in use are idiomatic and solve a real problem): instead of hard-coding an assembly-name string, a scanner takes a `typeof(...)` from a type it knows lives in the target assembly, so renaming the assembly cannot silently break discovery. Every layer of every ADC module ships this same pair (see the sibling pairs in [group-18 Conference.Application](group-18-conference-application.md#assemblyreference), [group-19 Conference.Infrastructure](group-19-conference-infrastructure.md#assemblyreference), and [group-20 Conference.API](group-20-conference-api-grpc.md#assemblyreference)), so registration and discovery code reads the same way in every project. MMCA.Common ships the same pair in its own layers (for example `MMCA.Common/Source/Core/MMCA.Common.Domain/AssemblyReference.cs:8,18`), and its doc comment there records the split explicitly: `ClassReference` is the anchor for the case where a *static* type cannot be used.
- **Walkthrough**: `AssemblyReference.Assembly` (`AssemblyReference.cs:7`) is a `public static readonly Assembly`; `AssemblyName` (`AssemblyReference.cs:8`) is its short name, falling back to `string.Empty` when reflection returns null. `ClassReference` (`AssemblyReference.cs:11`) has no members at all.
- **Why it's built this way**: a `typeof()` handle is refactor-safe where a magic string is not, and a non-static `ClassReference` can be passed where a static class cannot. A C# static type is not a legal generic type argument, so a generic scanning API such as `services.ScanModuleApplicationServices<ClassReference>()` (used by the Application-layer sibling at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/DependencyInjection.cs:130`) needs the non-static form.
- **Where it's used**: the *Domain* pair has no call site in `MMCA.ADC/Source` today. The layer pairs that are actually consumed are the Application one (`Conference.Application/DependencyInjection.cs:130`) and the framework's own (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:112`, `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:49`). The Domain pair exists so the layer-parallel convention holds across all five layers of the module.
- **Caveats / not-in-source**: whether the convention is *enforced* (an architecture fitness rule requiring one pair per project) is not visible from these files; no test in `MMCA.ADC/Tests` references either type.

---

### ConferenceFeatures
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/ConferenceFeatures.cs:8` · Level 0 · class (static)

- **What it is**: the feature-flag name catalog for the Conference module. It holds exactly one constant today: `SessionizeIntegration = "Conference.SessionizeIntegration"` (`ConferenceFeatures.cs:15`), which gates the Sessionize external-data sync capability.
- **Depends on**: nothing first-party.
- **Concept introduced, feature flags as named constants.** `[Rubric §10, Cross-Cutting Concerns]` (assesses whether cross-cutting behavior such as flags and configuration is centralized rather than scattered). The constant's value matches a key under the `"FeatureManagement"` configuration section, and per the class doc comment (`ConferenceFeatures.cs:3-7`) it is consumed with `[FeatureGate]` attributes and the [`IFeatureGated`](group-05-cqrs-pipeline.md#ifeaturegated) marker interface. Centralizing the *string* here means the flag name is written once: a typo cannot silently split one flag into two, one of which is never configured and therefore always off. The `"{Module}.{Feature}"` naming convention keeps flags from different modules unambiguous inside one configuration file. The mechanism itself is [ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html).
- **Walkthrough**: a single `public const string` (`ConferenceFeatures.cs:15`). The member doc comment (`ConferenceFeatures.cs:10-14`) records the runtime contract: when the flag is disabled, `RefreshFromSessionizeCommand` short-circuits with a failure result and organizers manage event data manually instead of syncing.
- **Why it's built this way**: putting the Sessionize sync behind a flag lets organizers turn the integration off (for example during a Sessionize API maintenance window) through configuration, with no redeploy.
- **Where it's used**: [`RefreshFromSessionizeCommand`](group-18-conference-application.md#refreshfromsessionizecommand) implements `IFeatureGated` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeCommand.cs:13`) and returns this constant from its `FeatureName` property (`RefreshFromSessionizeCommand.cs:19`), so the pipeline decorator (G05), not the handler body, does the gating.

---

### ConferencePermissions
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Authorization` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:9` · Level 0 · class (static)

- **What it is**: the Conference module's **capability permission catalog**: the stable string identifiers its endpoints require through [`[HasPermission(...)]`](group-08-auth.md#haspermissionattribute) instead of role names. Nine `manage` capabilities plus two curated groupings of them.
- **Depends on**: nothing first-party.
- **Concept reinforced, capability permissions over role names (the consumer side).** `[Rubric §11, Security]` (assesses whether authorization is expressed as fine-grained capabilities rather than coarse role checks scattered through controllers). This is ADC's use of the framework mechanism taught in [G08](group-08-auth.md) ([`IPermissionRegistry`](group-08-auth.md#ipermissionregistry), [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute)) and decided in [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html). The class doc comment (`ConferencePermissions.cs:3-8`) states the two properties that make the catalog work: who-can-do-what is decided by the role-to-permission grants declared in the module's registration rather than by controller attributes, and the values are deliberately stable strings because they may end up inside tokens or logs.
- **Walkthrough**
  - Nine `public const string` capabilities: `EventsManage` = `conference:events:manage` (`ConferencePermissions.cs:12`), `SessionsManage` (`:15`), `SpeakersManage` (`:18`), `RoomsManage` (`:21`), `CategoriesManage` (`:24`), `QuestionsManage` (`:27`), `SessionSelectionManage` = `conference:session-selection:manage` (`:30`), `SponsorsManage` = `conference:sponsors:manage` (`:33`), and `ActivitiesManage` = `conference:activities:manage` (`:36`). The `{module}:{resource}:{verb}` shape keeps the namespace collision-free across modules.
  - `All` (`ConferencePermissions.cs:39-50`): an `IReadOnlyList<string>` collection expression naming every one of the nine, for granting an entire capability set to a role in one line.
  - `ContentManagement` (`ConferencePermissions.cs:57-64`): the catalog-curation subset, `SessionsManage` + `SpeakersManage` + `CategoriesManage` + `SponsorsManage` + `ActivitiesManage`. Its doc comment (`ConferencePermissions.cs:52-56`) is the load-bearing part: a content-editor role holds these but *not* event structure, rooms, questions, or session selection, a distinction that capability checks express centrally and role checks cannot.
- **Why it's built this way**: a per-module catalog keeps each module's capability vocabulary self-contained (the Conference module can add a capability without touching Identity), and pairing the constants with named subsets makes the grants read declaratively at the registration site instead of as a hand-maintained string list. Adding a capability is then a two-line change: the constant, and its entry in whichever subsets should carry it.
- **Where it's used**: every Conference controller's `[HasPermission(...)]` attributes, and the role-to-permission grants in the module's API registration: `Organizer` and `Admin` each receive `[.. ConferencePermissions.All]` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:43-44`) and `ContentEditor` receives `[.. ConferencePermissions.ContentManagement]` (`DependencyInjection.cs:50`), all through [`RoleNames`](group-08-auth.md#rolenames).

---

### SessionStatuses
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionStatuses.cs:14` · Level 0 · class (static)

- **What it is**: the catalog of the six recognized Sessionize session-status strings, plus the predicate `IsEligible()` that decides public display, attendee bookmarking, and post-session feedback (BR-49). [`Session.Status`](#session) is a free-text field imported from Sessionize; this class is the one place in the domain that gives those strings behavioral meaning.
- **Depends on**: nothing first-party (only `StringComparison` from the BCL).
- **Concept introduced, the allow-list over external free text.** `[Rubric §4, Domain-Driven Design]` (assesses whether the model mirrors the business and speaks its language) and `[Rubric §8, Data Architecture]` (assesses deliberate handling of externally-sourced data). Two design choices are worth reading carefully:
  - **`const string`, not a C# `enum`.** Sessionize can return a status this list has never seen. String constants mean an unknown value simply fails to match; a deserialization-bound enum would have to decide what to do with it.
  - **Visibility is an allow-list decided centrally, not a per-constant flag.** The remarks (`SessionStatuses.cs:8-13`) say so outright: a status is publicly visible only if it is `Accepted` or unset, so *adding a constant here does not make it publicly visible*. That is the safe default for a field fed by an external system: the failure mode of a new Sessionize status is "not shown yet", not "leaked".
- **Walkthrough**
  - Six `const string` values: `Accepted` (`SessionStatuses.cs:17`), `Waitlisted` (`:20`), `AcceptQueue` = `"Accept_Queue"` (`:23`), `Nominated` (`:26`), `DeclineQueue` = `"Decline_Queue"` (`:29`), `Declined` (`:32`). Note that two of the literal values carry an underscore the C# identifier does not.
  - `AllKnownStatuses` (`SessionStatuses.cs:37-45`): a `static readonly IReadOnlyList<string>` collection expression of all six, so organizer filter dropdowns do not re-list the constants by hand.
  - `IsEligible(string? status)` (`SessionStatuses.cs:54-56`): returns true when `status is null` **or** equals `Accepted` case-insensitively (`StringComparison.OrdinalIgnoreCase`). Everything else is ineligible, known and unknown alike. The null branch is not an oversight: organizer-created sessions never carry a status, and the doc comment (`SessionStatuses.cs:47-53`) names them.
- **Why it's built this way**: keeping the eligibility predicate in the domain (not in a handler, a query, or the UI) means every consumer applies the identical definition, and tightening the rule is a one-line edit here rather than a search across layers.
- **Where it's used**: [`SessionInvariants.EnsureStatusIsEligible`](#sessioninvariants) (`SessionInvariants.cs:110`); the calendar-export filter, whose doc comment names this the single source of truth ([`CalendarExportMapper`](group-18-conference-application.md#calendarexportmapper), `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/CalendarExportMapper.cs:21,28`); the organizer session-selection dashboard's status bucketing ([`GetSessionSelectionDashboardHandler`](group-18-conference-application.md#getsessionselectiondashboardhandler), `.../DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardHandler.cs:81-85,218,294-297,324-335`); and the other decision-support handlers, which reuse the same constants for their own bucketing (`.../DecisionSupport/GetCategoryDistribution/GetCategoryDistributionHandler.cs:104-115`, `.../GetSpeakerSessionOverlap/GetSpeakerSessionOverlapHandler.cs:113`, `.../GetContentSimilarity/GetContentSimilarityHandler.cs:31`), all G18.
- **Caveats / not-in-source**: some consumers deliberately do *not* call `IsEligible`. [`PublicSessionStatusSpecification`](group-18-conference-application.md#publicsessionstatusspecification) restates the same rule as an expression tree, `s => s.Status == null || s.Status == SessionStatuses.Accepted` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Specifications/PublicSessionStatusSpecification.cs:24`), because a method call cannot be translated to SQL; its own doc comment (`:16`) records the reason. Two UI files carry a comment pointing at `IsEligible` as the source of truth while restating the rule locally, because the UI layer depends on `Shared` only and cannot reference `Domain` (`.../MMCA.ADC.Conference.UI/Pages/Public/PublicSessionDetail.razor.cs:89`, `.../PublicSessionListView.razor.cs:100`). Those definitions are kept in sync by hand.

---

### ConferenceReadAudience
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Authorization` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferenceReadAudience.cs:23` · Level 1 · class (static)

- **What it is**: the Conference module's **read-audience catalog**. One member, `PrivilegedRoles`, names the two roles that read the whole catalog: [`RoleNames`](group-08-auth.md#rolenames)`.Organizer` and `RoleNames.ContentEditor` (`ConferenceReadAudience.cs:26-30`). Everyone else (attendees, speakers, anonymous visitors) sees the public projection: accepted-or-unset sessions (BR-49), published events (BR-108), and their speakers (BR-239), exactly as the class doc comment states (`ConferenceReadAudience.cs:5-9`).
- **Depends on**: [`RoleNames`](group-08-auth.md#rolenames) from `MMCA.Common.Shared.Auth` (`ConferenceReadAudience.cs:1`), and nothing else. That is why it can live in `Shared` and be referenced from the Blazor UI as easily as from the service host.
- **Concept introduced, the read audience as a thing distinct from the capability permission.** `[Rubric §11, Security]` (assesses fine-grained, data-scoped authorization rather than scattered coarse role checks). Two different questions get asked in this module, and this type answers only the second:
  - *"May this caller change X?"* is a **capability** question, answered by [`ConferencePermissions`](#conferencepermissions) and enforced per endpoint with [`[HasPermission(...)]`](group-08-auth.md#haspermissionattribute).
  - *"How much of the catalog may this caller see?"* is a **read-audience** question. It cannot be a per-endpoint attribute, because the answer changes the *rows* rather than the verdict: the same anonymous-allowed GET must return a narrower list. So the audience is declared once, here, and every read path compares against it.

  The API-layer helper that wraps it spells the boundary out in its doc comment: the check is about read visibility, not authorization, and mutations stay gated by capability permissions that a role check must never stand in for (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Authorization/CurrentUserServiceExtensions.cs:16-25`). `[Rubric §12, Performance & Scalability]` applies for a less obvious reason: the same list drives the output-cache bypass introduced by [ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html), so this audience definition doubles as a cache-correctness invariant (see **Where it's used**).
- **Walkthrough**: one member. `PrivilegedRoles` (`ConferenceReadAudience.cs:26-30`) is a `static IReadOnlyList<string>` initialized with a collection expression of the two role-name constants. There are no methods and no state; callers do the matching themselves with `Any(...IsInRole)`.
- **Why it's built this way**: the remarks (`ConferenceReadAudience.cs:10-21`) name the exact failure a single declaration prevents. The output-cache bypass list and the API-layer visibility checks must name the *same* roles; if the two lists drifted apart, a privileged caller's everything-inclusive response would land in a shared public cache entry and then be served to anonymous visitors. Declaring the audience once makes that drift impossible instead of merely unlikely. The second paragraph records what keeps the list at exactly two entries: a third, partially privileged audience would need its own cache key, so extending this list means revisiting the cache policies in the Conference service first.
- **Where it's used**: three layers, one definition.
  - The Conference service host spreads it into `adminBypassRoles` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:214`) and hands that array to ten named output-cache policies (`Program.cs:215-243`: `ConferencePublicCache`, `EventsCache`, `SessionsCache`, `SpeakersCache`, `RoomsCache`, `CategoriesCache`, `QuestionsCache`, `SponsorsCache`, `ActivitiesCache`, `BookmarkCountsCache`). The comment directly above states the single-source-of-truth rule and its consequence: if the two lists ever named different roles, a privileged payload would be cached and served to the public (`Program.cs:211-213`). One policy deliberately takes no bypass list, `NowNextCache` (`Program.cs:231`), because its payload is identical for every role.
  - The API layer wraps it as the [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) extension `IsPrivilegedConferenceReader()` (`CurrentUserServiceExtensions.cs:24-25`), which the controllers use to decide whether to apply a public filter specification at all: `EventsController` picks `null` or a [`PublishedEventSpecification`](group-18-conference-application.md#publishedeventspecification) from it (`.../Controllers/EventsController.cs:75`, with a second guard at `:141`), and `SessionsController` (`:60`), `SpeakersController` (`:65`), `SponsorsController` (`:52`), `ActivitiesController` (`:52`), `RoomsController` (`:104`), `SessionSpeakersController` (`:59`), `SessionCategoryItemsController` (`:59`), `SpeakerCategoryItemsController` (`:59`), and `EventSpeakersController` (`:58`) each expose it as a private `IsPrivileged` property.
  - The Blazor UI reads it directly when sizing its filters and detail views: `.../MMCA.ADC.Conference.UI/Pages/Public/PublicSessionList.razor.cs:121`, `.../PublicSpeakerList.razor.cs:101`, `.../PublicEventList.razor.cs:77`, `.../PublicEventDetail.razor.cs:64`, and `.../PublicSpeakerDetail.razor.cs:205`.

  The rows themselves are narrowed one layer up by [`PublicConferenceVisibility`](group-18-conference-application.md#publicconferencevisibility) and the public filter specifications built on it (G18).
- **Caveats / not-in-source**: case-insensitive role comparison is a property of `ICurrentUserService.IsInRole`, not of this type. Whether a given JWT actually carries one of these roles is decided by the Identity module and is not visible from this file.

---

### SessionAiScore
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionAiScore.cs:13` · Level 5 · class (sealed)

- **What it is**: an aggregate root holding the AI-generated score for one session across seven criteria (overall, topic relevance, description quality, novelty, actionable takeaways, depth or insight quality, credibility and experience), plus the model's free-text `Reasoning` and the `ModelUsed` identifier. One live score per session.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) bound to `SessionAiScoreIdentifierType`, [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), and [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error) (G01). The alias resolves to `int` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:13`), per [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html).
- **Concept**: the private-constructor plus `static Result<T> Create` factory pattern was introduced in [G02](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype). What this type adds to the discussion is *where you validate machine output*. `[Rubric §4, DDD]` and `[Rubric §11, Security]` overlap here: the 1.0 to 10.0 range check runs inside the domain, so a hallucinated or out-of-range model response is rejected before it can reach the database, even though nothing about the data's origin is visible to the entity. The `[IdValueGenerated]` attribute (`SessionAiScore.cs:12`) marks the identity as database-generated.
- **Walkthrough**
  - Ten `private set` properties (`SessionAiScore.cs:16-43`): the FK `SessionId`, seven `decimal` scores, and the `Reasoning` / `ModelUsed` text. `decimal` rather than `double` keeps the stored values exactly as the model reported them.
  - The EF parameterless constructor (`SessionAiScore.cs:46-50`) seeds `Reasoning` and `ModelUsed` to `string.Empty`, satisfying non-nullable reference types without an `= null!` escape hatch.
  - `Create` (`SessionAiScore.cs:55-93`): combines seven `EnsureScoreInRange` checks through `Result.Combine` (`:67-74`) so a caller sees *every* out-of-range field at once rather than the first; on failure it returns `Result.Failure<SessionAiScore>(result.Errors)` (`:77`), otherwise it constructs with `Id = default` (`:81`) and leaves identity to the database.
  - `Update` (`SessionAiScore.cs:98-132`): re-runs the identical seven checks (`:109-116`), then replaces every score plus reasoning and model (`:121-129`).
  - `EnsureScoreInRange` (`SessionAiScore.cs:134-141`): a private helper using the C# relational pattern `score is >= 1.0m and <= 10.0m` (`:135`), shared by both `Create` and `Update`, so the range exists once. The failure carries the stable code `SessionAiScore.OutOfRange` (`:138`) and a message built with `string.Create(CultureInfo.InvariantCulture, ...)` (`:139`) so a machine-readable diagnostic does not change shape with the request culture.
  - No domain events are raised anywhere in this file: there is no `AddDomainEvent` call, because no other module reacts to a score change.
- **Why it's built this way**: range validation belongs to the domain because it is a statement about what a score *is*, not about who asked for one. Keeping the check in a private helper shared by the two public entry points means a future range change cannot be applied to one path and forgotten on the other.
- **Where it's used**: created by the scoring handler ([`ScoreEventSessionsHandler`](group-18-conference-application.md#scoreeventsessionshandler), `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsHandler.cs:79`, over the repository resolved at `:28`), read back by the organizer dashboard ([`GetSessionSelectionDashboardHandler`](group-18-conference-application.md#getsessionselectiondashboardhandler), `.../GetSessionSelectionDashboard/GetSessionSelectionDashboardHandler.cs:98,338,363`), configured by [`SessionAiScoreConfiguration`](group-19-conference-infrastructure.md#sessionaiscoreconfiguration) in Infrastructure, projected as [`SessionAiScoreDTO`](#sessionaiscoredto), and rendered by the organizer page [`SessionSelectionAiScores`](group-21-conference-ui.md#sessionselectionaiscores).
- **Caveats / not-in-source**: `Update` is not on the re-scoring path today. The handler replaces a session's score with a delete-then-add pair inside the same step that writes the new one (`ScoreEventSessionsHandler.cs:105-107`), a choice its comment justifies by partial-failure behavior: N sequential paid model calls follow, so a run that dies partway through has replaced only what it actually re-scored, and the unique filtered index on `SessionId` keeps at most one live row either way (`ScoreEventSessionsHandler.cs:94-103`). `Update` therefore remains a valid domain operation with no current caller in `Source`.

---

### SessionInvariants
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionInvariants.cs:13` · Level 6 · class (static)

- **What it is**: the invariant-rule library for the [`Session`](#session) aggregate and its children: title validity, optional-text max lengths, answer-value validity, a not-a-service-session guard (BR-91), status eligibility for engagement actions (BR-49), and an end-after-start check (BR-122). It also owns the reserved manual id range for sessions that never came from Sessionize.
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (`SessionInvariants.cs:2`), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error) (`:3`), [`SessionStatuses`](#sessionstatuses) (same namespace), and [`SessionDTO`](#sessiondto) from `MMCA.ADC.Conference.Shared.Sessions` (`:1`).
- **Concept**: the static-invariant-class pattern (methods returning [`Result`](group-01-result-error-handling.md#result), composed with `Result.Combine`) was introduced for the framework in [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants). `[Rubric §4, Domain-Driven Design]`: the rules live in the domain, not in handlers, validators, or the database.

  **The interesting detail here is which direction the constants flow.** `[Rubric §16, Maintainability]` (assesses whether a single change stays a single edit). Every length constant on this class is an alias for the matching constant on [`SessionDTO`](#sessiondto): `public const int TitleMaxLength = SessionDTO.TitleMaxLength;` (`SessionInvariants.cs:16`). The class doc comment (`:7-12`) explains the direction: the numbers live on the DTO, "the lowest layer the UI can also reach, so markup and domain validation cannot drift apart". A Blazor `MaxLength` attribute, an EF `HasMaxLength(...)` call, and a domain length check therefore all resolve to one literal. Domain does not depend on Application here; `Conference.Shared` sits beneath both, so `[Rubric §3, Clean Architecture]` is preserved rather than bent.
- **Walkthrough**
  - **Length constants** (`SessionInvariants.cs:16-37`): `TitleMaxLength` (`:16`), `DescriptionMaxLength` (`:19`), `StatusMaxLength` (`:22`), `AccessibilityInfoMaxLength` (`:25`), `ResourceLinksMaxLength` (`:28`), `LiveUrlMaxLength` (`:31`), and `RecordingUrlMaxLength` (`:34`) all forward to their `SessionDTO` counterparts, whose literals are 500, 4000, 100, 500, 2000, 2000, and 2000 respectively (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/SessionDTO.cs:18-36`). `AnswerValueMaxLength` is the one literal declared here, 4000 (`SessionInvariants.cs:37`), because the answer value is a child-entity field with no DTO-level counterpart on `SessionDTO`.
  - **Reserved id range** (`SessionInvariants.cs:44,47`): `ManualIdRangeStart` = `999_999_000` and `ManualIdRangeEnd` = `999_999_999`, both `static readonly SessionIdentifierType`. The doc comment (`:39-43`) encodes the design decision behind them: session ids are app-assigned because the int PK *is* the Sessionize id, so ids for sessions never imported from Sessionize (organizer-created and seeded samples) sit above any real Sessionize id and never collide. It mirrors [`QuestionInvariants`](#questioninvariants).
  - `EnsureTitleIsValid` (`SessionInvariants.cs:49-52`): combines a not-empty and a max-length check from `CommonInvariants`, each tagged with a stable error code (`Session.Title.Empty`, `Session.Title.TooLong`) and the caller's `source` string for tracing.
  - `EnsureOptionalTextLengthsAreValid` (`SessionInvariants.cs:67-81`): one call validating description, status, live URL, recording URL, accessibility info, and resource links against their constants. Its doc comment (`:54-58`) gives both reasons it exists: oversize input should fail as a domain validation error rather than as a database constraint violation, and the URL fields are length-checked only because the values are stored as opaque strings for Sessionize compatibility.
  - `EnsureAnswerValueIsValid` (`SessionInvariants.cs:83-86`): the not-empty plus max-length pair for [`SessionQuestionAnswer.AnswerValue`](#sessionquestionanswer), coded `SessionQuestionAnswer.AnswerValue.Empty` / `.TooLong`.
  - `EnsureNotServiceSession` (`SessionInvariants.cs:94-100`): delegates to `CommonInvariants.EnsureFlagIsFalse` and fails with `Session.IsServiceSession` when the session is a service slot such as lunch or a break (BR-91), which is how bookmarking and feedback are kept off non-content sessions.
  - `EnsureStatusIsEligible` (`SessionInvariants.cs:109-116`): delegates to [`SessionStatuses.IsEligible`](#sessionstatuses) (`:110`) and turns a false into a `Session.StatusIneligible` error carrying the offending status in its message. The eligibility allow-list stays in the Level 0 catalog: there is exactly one definition of "eligible".
  - `EnsureEndsAtIsAfterStartsAt` (`SessionInvariants.cs:126-138`): the only method with a statement body. Both values must be non-null for the check to run (null means not yet scheduled), and `endsAt <= startsAt` fails with `Session.Duration.Invalid`, so a zero-duration session is rejected as firmly as an inverted one (BR-122).
- **Why it's built this way**: sharing the length constants between the DTO, the EF configuration, and the domain check keeps markup, schema, and rule in lockstep, and expressing each rule as a `Result`-returning function makes them composable: [`Session.Create`](#session) combines three of them in one `Result.Combine` and reports all failures together.
- **Where it's used**: [`Session.Create` and `Session.Update`](#session) (`Session.cs:183-186` and `:251-254`), [`SessionQuestionAnswer.Create` / `UpdateAnswer`](#sessionquestionanswer) (`SessionQuestionAnswer.cs:52` and `:73`), the application-layer session validators (G18), and the EF entity configurations for column lengths (G19, [`SessionConfiguration`](group-19-conference-infrastructure.md#sessionconfiguration)).
- **Caveats / not-in-source**: `EnsureNotServiceSession` and the two `ManualIdRange*` values have no caller inside this file; their consumers are in the Application layer and the seeders, so their call sites are covered in G18 and G19.

---

### Session
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/Session.cs:22` · Level 8 · class (sealed)

- **What it is**: the richest aggregate root in the Conference module. `Session` owns three child collections ([`SessionSpeaker`](#sessionspeaker), [`SessionCategoryItem`](#sessioncategoryitem), [`SessionQuestionAnswer`](#sessionquestionanswer)) and coordinates their whole lifecycle: creation, update, restore, cascade soft-delete, and a domain event for every structural change. Session ids are Sessionize-assigned, not database-generated.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) bound to `SessionIdentifierType`, [`IAuditedEntity`](group-02-domain-building-blocks.md#iauditedentity), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute), [`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions) (the `IsIdValueGenerated` extension), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error); the sibling entities [`Event`](#event) and [`Room`](#room) as reference navigations; [`SessionInvariants`](#sessioninvariants); its three children and their domain events [`SessionChanged`](#sessionchanged), [`SessionSpeakerChanged`](#sessionspeakerchanged), [`SessionCategoryItemChanged`](#sessioncategoryitemchanged), [`SessionQuestionAnswerChanged`](#sessionquestionanswerchanged).
- **Concept introduced, the aggregate root as consistency boundary.** `[Rubric §4, Domain-Driven Design]` (assesses aggregates with a single transactional boundary and correct child lifecycle management). An **aggregate root** is the only entry point for mutations inside its boundary: nothing outside `Session` constructs or removes a `SessionSpeaker`, every such operation goes through `Session.AddSessionSpeaker` / `RemoveSessionSpeaker`. Three guarantees follow at once:
  - **Cross-child invariants have a home.** `AddSessionSpeaker` rejects a duplicate live speaker (`Session.cs:319-326`) and `AddSessionCategoryItem` rejects a duplicate live category item (`Session.cs:401-408`). Neither check could live on the child, which cannot see its siblings.
  - **Event emission is not optional.** Every structural change raises a domain event, making the change observable to other modules through the outbox ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) without the aggregate knowing who listens. `[Rubric §6, CQRS & Event-Driven]`.
  - **Cascade soft-delete is domain behavior.** `Delete()` (`Session.cs:283`) soft-deletes every active child before raising `SessionChanged(Deleted)`, implementing BR-55 in the model rather than through a database cascade or handler glue.

  The private constructors (`Session.cs:113` and `:115`) plus the `static Result<Session> Create` factory (`Session.cs:165`) are what make that boundary real: there is no way to obtain a `Session` that skipped validation or the creation event.

  **A second concept lands here too: the change trail.** The class is marked [`IAuditedEntity`](group-02-domain-building-blocks.md#iauditedentity) (`Session.cs:22`), and the class doc comment (`Session.cs:16-20`) gives the reason in business terms: sessions are written by organizers *and* overwritten by the Sessionize sync, so "what changed this title, room, or time slot, and was it a person or the importer" is a question that actually gets asked, and only a change history answers it. `[Rubric §13, Observability & Operability]`: audit stamps say who touched the row last, the trail says what the sequence was.

  **A third: the framework owns the child-collection mechanics.** `[Rubric §1, SOLID]` and `[Rubric §16, Maintainability]`. Delete, restore, and remove-by-id are not hand-rolled loops here; they call four `protected static` helpers on the base class, `DeleteChildren`, `RestoreChild`, `RemoveChildOrNotFound`, and `GetChildOrNotFound` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:273`, `:212`, `:156`, `:103`). The split is deliberate and documented at the helper: the helper owns the mechanics, and the aggregate method owns the meaning, so the caller still decides which domain event to raise and what it carries (`AuditableAggregateRootEntity.cs:129-145`).
- **Walkthrough**
  - **Scalar properties** (`Session.cs:25-67`): fifteen `private set` fields. `Title` is the only non-nullable text (`:25`); `Status` is free text imported from Sessionize (`:37`); the booleans `IsInformed` / `IsConfirmed` (`:40,43`) track the speaker-communication workflow, and `IsServiceSession` / `IsPlenumSession` (`:46,49`) classify the slot. `LiveUrl` and `RecordingUrl` (`:52,55`) are `string?`, not `Uri`, for Sessionize compatibility. `EventId` (`:64`) and `RoomId` (`:67`) are scalar FKs, the latter nullable because a session may not have a room yet.
  - **Reference navigations** (`Session.cs:70-75`): `Event?` and `Room?` are `[Navigation]`-tagged with a `private set`, mutated only through the public `SetEvent` (`:301`) and `SetRoom` (`:305`) methods the navigation populator calls (G11). The `Event` doc comment notes it exists for query filtering (BR-132). Keeping the setter private and exposing a named method means an accidental assignment from a handler cannot happen by property syntax alone.
  - **`Duration`** (`Session.cs:80-82`): a computed `int?` in minutes derived from `StartsAt` / `EndsAt`, with no backing column.
  - **Child collections** (`Session.cs:84-110`): three `private readonly List<T>` fields exposed as `IReadOnlyCollection<T>` through `.AsReadOnly()`. `SessionSpeakers` (`:88`) and `SessionCategoryItems` (`:110`) carry `[Navigation(IsCollection = true)]`. `SessionQuestionAnswers` (`:104`) deliberately does **not**, and its remarks (`:95-103`) are worth reading in full: the collection grows with attendance rather than with the schedule, it was riding along on the hottest public reads (the session grid, session detail, the speaker dashboard) which never render it, and it is the one child collection here that is not public data, since its dedicated controller is authenticated and scopes rows per caller while `GET /sessions?includeChildren=true` is anonymous. Handlers that genuinely need the answers pass an explicit `includes:` list. `[Rubric §12, Performance & Scalability]` and `[Rubric §11, Security]` in one attribute that is absent.
  - **`Create`** (`Session.cs:165-215`): combines `EnsureTitleIsValid`, `EnsureEndsAtIsAfterStartsAt`, and `EnsureOptionalTextLengthsAreValid` (`:183-186`) so all validation failures surface together, then reads `typeof(Session).IsIdValueGenerated` (`:190`). `Session` carries no `[IdValueGenerated]` attribute, so that is false and the factory assigns `id!.Value` (`:207`); the identical line in a database-generated entity leaves `default`. It ends by raising `SessionChanged(Added)` (`:212`).
  - **`Update`** (`Session.cs:235-276`): the same three-invariant combine (`:251-254`), then assigns every mutable field including the two workflow booleans and `RoomId` (`:258-271`), and raises `SessionChanged(Updated)` (`:273`).
  - **`Delete`** (`Session.cs:283-297`): one `Result.Combine` over three `DeleteChildren<TChild, TChildId>` calls and `base.Delete()` (`:287-291`), then `SessionChanged(Deleted)` only when the whole combine succeeded (`:293-294`). The comment above it (`:285-286`) records why combine rather than short-circuit: aggregating every child failure with the root's own means a failing child cannot leave earlier children and the root already flagged. The helper itself skips children that are already deleted (`AuditableAggregateRootEntity.cs:283-286`), which makes re-deleting a parent idempotent with respect to its children.
  - **Child mutation methods**: speakers at `Session.cs:315` (`AddSessionSpeaker`), `:352` (`RestoreSessionSpeaker`), `:371` (`RemoveSessionSpeaker`); category items at `:397`, `:435`, `:457`; question answers at `:484` (`AddSessionQuestionAnswer`), `:508` (`UpdateSessionQuestionAnswer`), `:531` (`RemoveSessionQuestionAnswer`). Each delegates to the child's own `Create` / `UpdateAnswer` or to a base helper, mutates the private list, and raises the child-specific `*Changed` event.
  - **The restore path** (`Session.cs:352-364` and `:435-450`) is the interesting one. It takes the join *instance* rather than an id, because a soft-deleted row is excluded by the global query filter and so must be resolved by the caller (remarks at `:345-349`). It hands the instance to `RestoreChild<...>` along with the aggregate's own error code, `"Session.Speaker.NotDeleted"` (`:356-357`) or `"Session.CategoryItem.NotDeleted"` (`:439-443`); the helper refuses a not-deleted candidate (`AuditableAggregateRootEntity.cs:223-231`), calls the child's `Reactivate()`, and re-adds it to the list only if absent (`:243-246`). The aggregate then raises `SessionSpeakerChanged(Added)` because the association re-enters the visible set (`Session.cs:361`). BR-135: an association that reappears in the Sessionize feed is reactivated rather than duplicated by a second row.
  - **Removal** (`Session.cs:371-382`, `:457-468`, `:531-542`): each calls `RemoveChildOrNotFound<TChild, TChildId>` and, on success, raises the matching `*Changed(Deleted)` event with the removed child's id. A missing or already-deleted id yields a `NotFound` failure from the helper rather than a null reference.
  - **Lookup helper** (`Session.cs:550-553`): a single private `GetSessionQuestionAnswerOrNotFound` routing through the base `GetChildOrNotFound<TChild, TChildId>`, used only by `UpdateSessionQuestionAnswer` (`:512`). The other two children have no update path, so they need no lookup wrapper.
  - **`SetSession*` methods** (`Session.cs:386`, `:472`, `:546`): `internal`, used only by the navigation populator. They call the base `SetItems` helper (`AuditableAggregateRootEntity.cs:60`) to replace in-memory collections during query-side population, bypassing domain logic. They are never on the command path.
- **Why it's built this way**: the aggregate boundary makes atomicity natural, one `SaveChangesAsync` commits the session and all of its children together, and domain events raised inside the same transaction reach other modules through the outbox without the aggregate knowing they exist. `[Rubric §29, Resilience & Business Continuity]`: cascade soft-delete keeps children from surviving in a live-but-unreachable state after their parent is gone, the policy recorded in [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html).
- **Where it's used**: the central Conference entity. Persisted through [`SessionConfiguration`](group-19-conference-infrastructure.md#sessionconfiguration) and the repositories (G19), read as [`SessionDTO`](#sessiondto) through the query services, and mutated by the Session command handlers (G18); its ids and eligibility rules are consumed cross-service by Engagement through the bookmark and live-validation contracts.

---

### SessionCategoryItem
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionCategoryItem.cs:14` · Level 8 · class (sealed)

- **What it is**: the join entity linking a [`Session`](#session) to a [`CategoryItem`](#categoryitem), with database-generated identity (`[IdValueGenerated]`, `SessionCategoryItem.cs:13`). A child of the `Session` aggregate.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) bound to `SessionCategoryItemIdentifierType`, [`IReactivatable`](group-02-domain-building-blocks.md#ireactivatable), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), [`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions), [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute), [`Result`](group-01-result-error-handling.md#result), and [`Session`](#session) as the back-reference.
- **Concept introduced, the join entity.** `[Rubric §4, DDD]`: rather than letting EF create a raw join *table*, a many-to-many association is modeled as a domain entity, so it carries its own identity, audit fields, and soft-delete state, and participates in domain events through the owning aggregate. All three `Session` children share this shape and differ only in the FK they carry, whether they hold a payload, and whether they can be reactivated.
- **Walkthrough**: `CategoryItemId` (`SessionCategoryItem.cs:17`, `private set`); the `Session?` back-navigation (`:20-21`, `[Navigation]` with a `private set`, assigned through the public `SetSession` at `:61`); `SessionId` (`:24`), get-only because EF sets it as the shadow-side FK when the child is added to the parent's list. Two constructors: the EF parameterless one (`:27`) and a private assigning one (`:29`). `Create(id?, categoryItemId)` (`:37-49`) reads `typeof(SessionCategoryItem).IsIdValueGenerated` (`:41`), which is true here, so `Id` stays `default` for the database to fill (`:45`); it performs no validation, because the association is structurally always valid, and therefore always returns `Result.Success` (`:48`). `Reactivate()` (`:57`) is the `IReactivatable` implementation and simply exposes the protected base `Undelete()` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:89`) to the framework's `RestoreChild` helper; its doc comment (`:51-56`) explains why the join is reactivated rather than re-created when an association reappears in the Sessionize feed (BR-135).
- **Where it's used**: managed exclusively through [`Session.AddSessionCategoryItem` / `RestoreSessionCategoryItem` / `RemoveSessionCategoryItem`](#session), and projected as [`SessionCategoryItemDTO`](#sessioncategoryitemdto).

---

### SessionQuestionAnswer
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionQuestionAnswer.cs:13` · Level 8 · class (sealed)

- **What it is**: a child entity of [`Session`](#session) storing the answer to a [`Question`](#question) for that session. Database-generated identity (`[IdValueGenerated]`, `SessionQuestionAnswer.cs:12`).
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) bound to `SessionQuestionAnswerIdentifierType`, [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), [`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions), [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute), [`Result`](group-01-result-error-handling.md#result), [`Session`](#session), and [`SessionInvariants`](#sessioninvariants).
- **Concept**: the same join-entity shape as [`SessionCategoryItem`](#sessioncategoryitem), with two differences that matter. It carries a validated payload, so unlike its two siblings its `Create` can fail; and it does **not** implement [`IReactivatable`](group-02-domain-building-blocks.md#ireactivatable) (contrast `SessionQuestionAnswer.cs:13` with `SessionCategoryItem.cs:14`), so it can never be passed to the framework's `RestoreChild` helper. That absence is the design statement: an answer is content a person wrote, not a Sessionize-fed association that may reappear, so a deleted answer is re-created rather than resurrected. `[Rubric §4, DDD]`.
- **Walkthrough**: `QuestionId` (`SessionQuestionAnswer.cs:16`) and `AnswerValue` (`:19`), the `Session?` navigation (`:22-23`, set through the public `SetSession` at `:84`), and the get-only `SessionId` (`:26`). The EF constructor seeds `AnswerValue` to `string.Empty` (`:29`); the private assigning constructor is at `:31-37`. `Create(id?, questionId, answerValue)` (`:46-64`) validates through `SessionInvariants.EnsureAnswerValueIsValid` (`:52`) before touching identity, then applies the same `IsIdValueGenerated` branch as its siblings (`:56,60`). `UpdateAnswer(answerValue)` (`:71-80`) re-runs the identical invariant (`:73`) and mutates the field (`:77`), so an update cannot bypass a rule that creation enforced.
- **Where it's used**: managed through [`Session.AddSessionQuestionAnswer` / `UpdateSessionQuestionAnswer` / `RemoveSessionQuestionAnswer`](#session), and exposed as [`SessionQuestionAnswerDTO`](#sessionquestionanswerdto) through a dedicated authenticated controller (G20).

---

### SessionSpeaker
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionSpeaker.cs:14` · Level 8 · class (sealed)

- **What it is**: the join entity linking a [`Session`](#session) to a [`Speaker`](#speaker), with database-generated identity (`[IdValueGenerated]`, `SessionSpeaker.cs:13`).
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) bound to `SessionSpeakerIdentifierType`, [`IReactivatable`](group-02-domain-building-blocks.md#ireactivatable), [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), [`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions), [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute), [`Result`](group-01-result-error-handling.md#result), and [`Session`](#session).
- **Concept**: the same join-entity pattern as [`SessionCategoryItem`](#sessioncategoryitem), and the thinnest of the three (a single `SpeakerId` payload). Its value as a teaching example is where the *uniqueness* rule is not: the duplicate-speaker invariant lives in [`Session.AddSessionSpeaker`](#session) (`Session.cs:319-326`), not here. A rule that spans a collection belongs to the aggregate root that owns the collection, because the child can only see itself. `[Rubric §4, DDD]`.
- **Walkthrough**: `SpeakerId` (`SessionSpeaker.cs:17`), the `Session?` navigation (`:20-21`, assigned through the public `SetSession` at `:61`), the get-only `SessionId` (`:24`), the EF and assigning constructors (`:27,29`). `Create(id?, speakerId)` (`:37-49`) only resolves identity through `IsIdValueGenerated` (`:41,45`) and always succeeds. `Reactivate()` (`:57`) forwards to the protected base `Undelete()` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:89`); its doc comment (`:51-56`) records the BR-135 rationale, that the row carries the Sessionize-assigned speaker id, so a returning association is reactivated rather than duplicated.
- **Where it's used**: managed through [`Session.AddSessionSpeaker` / `RestoreSessionSpeaker` / `RemoveSessionSpeaker`](#session); its projection [`SessionSpeakerDTO`](#sessionspeakerdto) is what the public session grid renders for speaker names.

### EventLiveInfo
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/EventLiveInfo.cs:13` · Level 0 · record (sealed)

- **What it is**: an immutable three-field snapshot of one event's live-window facts: whether the event is published, and the UTC start and (exclusive) end of its live window. It is what the Engagement live layer reads to decide "is this conference happening right now" without ever touching Conference's [`Event`](#event) aggregate.
- **Depends on**: nothing first-party (BCL `bool`/`DateTime` only).
- **Concept introduced, the cross-module live-window snapshot.** `[Rubric §7, Microservices Readiness]` (assesses whether a module exposes a small, stable contract instead of leaking its internal entities across a boundary): rather than shipping the whole `Event` entity to another module (or, after extraction, another process), Conference does the time-zone arithmetic once, server-side, and hands back three plain values. The consumer then compares them against `DateTime.UtcNow` with **no** time-zone logic of its own (doc comment, `EventLiveInfo.cs:3-9`). The window is derived from the event's `StartDate`/`EndDate` and its IANA time zone: start is `StartDate` at 00:00 local, end (exclusive) is `EndDate + 1 day` at 00:00 local, both converted to UTC. `[Rubric §9, API & Contract Design]` (a narrow, purpose-built contract) also applies: this record carries exactly what a consumer needs to gate a live feature, nothing more.
- **Walkthrough**: a positional `sealed record` (`EventLiveInfo.cs:13`) with three parameters, `IsPublished` (`bool`), `LiveWindowStartUtc` and `LiveWindowEndUtc` (both `DateTime`, the end being exclusive per the param docs on `EventLiveInfo.cs:10-12`). There is no behavior: the type is a pure value carrier, and being a `record` it gets structural equality for free.
- **Why it's built this way**: keeping the "when is an event live" definition in the owning module and putting only UTC instants on the wire means the rule lives in exactly one place, and the contract itself is time-zone-free. Consumers cannot drift from the canonical window because they never recompute it.
- **Where it's used**: produced by the real [`EventLiveValidationService`](group-18-conference-application.md#eventlivevalidationservice) (Conference.Application) behind [`IEventLiveValidationService.GetEventLiveInfoAsync`](#ieventlivevalidationservice) (`EventLiveValidationService.cs:25`, built at `:44`), and across the process boundary by the [`EventLiveValidationServiceGrpcAdapter`](group-20-conference-api-grpc.md#eventlivevalidationservicegrpcadapter) (`EventLiveValidationServiceGrpcAdapter.cs:36-62`). The fail-open stub [`DisabledEventLiveValidationService`](#disabledeventlivevalidationservice) returns `new EventLiveInfo(true, DateTime.MinValue, DateTime.MaxValue)` (`DisabledEventLiveValidationService.cs:26`). It is consumed by the Engagement event-wide [`LivePoll`](group-23-engagement-live-layer.md#livepoll) paths: [`CreateLivePollHandler`](group-23-engagement-live-layer.md#createlivepollhandler) reads `IsPublished` to enforce BR-222 (`CreateLivePollHandler.cs:69-84`), and [`OpenLivePollHandler`](group-23-engagement-live-layer.md#openlivepollhandler) reads the two window bounds for an event-wide poll (`OpenLivePollHandler.cs:67-72`). The Engagement check-in path uses it too: [`CheckInProcessor`](group-22-engagement-module.md#checkinprocessor) fetches it for an event-scope check-in and rejects an unpublished event (`CheckInProcessor.cs:180-184`).

---

### QuestionModerationDefault
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/QuestionModerationDefault.cs:7` · Level 0 · enum

- **What it is**: a two-value enum naming the initial status a newly submitted attendee question receives for an event's live Q&A (BR-233): `Pending` (queued for a moderator) or `Approved` (visible immediately, moderated after the fact).
- **Depends on**: nothing first-party.
- **Concept introduced, the per-event moderation policy knob.** `[Rubric §6, CQRS & Event-Driven]` (assesses whether the data crossing a boundary carries enough context to be acted on without extra lookups): this small enum is the vocabulary the Engagement live layer reads to decide whether a freshly submitted [`SessionQuestion`](group-23-engagement-live-layer.md#sessionquestion) starts hidden or visible. Making it a two-value enum rather than a bare `bool` leaves room for future moderation modes and reads self-documentingly at the call site.
- **Walkthrough**: two explicitly numbered members, `Pending = 0` (`QuestionModerationDefault.cs:10`, the safe default: an unset or zero value means "hold for review") and `Approved = 1` (`QuestionModerationDefault.cs:13`). Explicit numbering keeps the wire meaning stable if the members are ever reordered.
- **Why it's built this way**: `Pending = 0` makes the conservative choice the default value. An event that never set a moderation preference holds new questions for review rather than publishing them unmoderated.
- **Where it's used**: carried on [`EventDTO.QuestionModerationDefault`](#eventdto) (`EventDTO.cs:92`) and inside [`SessionLiveInfo`](#sessionliveinfo) (`SessionLiveInfo.cs:24`), so the live layer learns the owning event's policy in the same call that fetches session facts. The stub [`DisabledEventLiveValidationService`](#disabledeventlivevalidationservice) reports `Pending` (`DisabledEventLiveValidationService.cs:42`). Consumed by the Engagement [`SubmitQuestionHandler`](group-23-engagement-live-layer.md#submitquestionhandler), which maps `Approved` to `QuestionStatus.Approved` and everything else to `QuestionStatus.Pending` when creating the question (`SubmitQuestionHandler.cs:86-88`).

---

### RefreshFromSessionizeResultDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/RefreshFromSessionizeResultDTO.cs:7` · Level 0 · record (sealed)

- **What it is**: the response DTO for the Sessionize refresh endpoint (`POST /Events/{id}/refresh`, UC-6). It reports per-entity sync counts plus a list of non-fatal warnings, so an organizer can confirm what was actually imported.
- **Depends on**: nothing first-party (BCL only).
- **Concept introduced, the informative mutation response.** `[Rubric §9, API & Contract Design]` (assesses stable, useful response contracts): rather than returning `204 No Content` for a bulk sync, the endpoint returns counts so the caller can verify that the expected number of sessions, speakers, and categories landed. This is the read-back shape of a bulk write. `[Rubric §13, Observability & Operability]` also applies in the small: the `Warnings` list turns silent partial-import oddities into something an operator can read off the response.
- **Walkthrough**: eight `required init` properties (`RefreshFromSessionizeResultDTO.cs:10-31`). Six are `int` counts, `CategoriesSynced` (line 10), `CategoryItemsSynced` (line 13), `RoomsSynced` (line 16), `QuestionsSynced` (line 19), `SpeakersSynced` (line 22), and `SessionsSynced` (line 25). `SkippedSoftDeleted` (line 28) counts entities that a sync re-encountered but did not restore because the app had soft-deleted them (BR-136). `Warnings` (line 31) is an `IReadOnlyList<string>` of non-fatal issues such as a duration violation or a date-range mismatch. Every property is `required`, so a partial or forgotten field cannot be constructed.
- **Why it's built this way**: `SkippedSoftDeleted` is surfaced explicitly because an organizer who soft-deleted a session and then re-ran a sync would otherwise be puzzled why the count does not match Sessionize. The handler even folds that count into the warning list when it is non-zero (`RefreshFromSessionizeHandler.cs:128-131`).
- **Where it's used**: built by the [`RefreshFromSessionizeCommand`](group-18-conference-application.md#refreshfromsessionizecommand) handler, which reads the per-strategy [`SessionizeSyncResult`](group-18-conference-application.md#sessionizesyncresult) values and the shared sync context into it (`RefreshFromSessionizeHandler.cs:143-153`), with an all-zero instance returned when Sessionize sends an empty response (`RefreshFromSessionizeHandler.cs:100-110`). Returned by [`EventsController.RefreshAsync`](group-20-conference-api-grpc.md#eventscontroller) (`EventsController.cs:328`, whose `[Idempotent]` attribute replays the first response for a retried `Idempotency-Key` rather than starting a second import, `EventsController.cs:327`) and surfaced to the organizer UI through [`EventService.RefreshFromSessionizeAsync`](group-21-conference-ui.md#eventservice) (`EventService.cs:43-51`), which the [`EventDetail`](group-21-conference-ui.md#eventdetail) page holds as `_refreshResult` (`EventDetail.razor.cs:63`, assigned at `:254`).

---

### RoomSessionInfo
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/RoomSessionInfo.cs:18` · Level 0 · record (sealed)

- **What it is**: the answer to "which session is this room hosting right now": the resolved session id and title, the owning event, and that event's published flag. It is what the Engagement room check-in flow gets back when an attendee scans a printed room QR.
- **Depends on**: the `SessionIdentifierType` and `EventIdentifierType` aliases; BCL otherwise. No first-party types.
- **Concept introduced, the server-resolved target (never trust a client-supplied id).** `[Rubric §11, Security]` (assesses whether authorization-relevant inputs are decided server-side): the attendee's device sends a **room** id, not a session id, and Conference resolves which session that room is hosting at the call instant. A tampered QR therefore cannot record a check-in against an arbitrary session. `[Rubric §9, API & Contract Design]` also applies in a subtle way: `SessionTitle` rides along so the caller can render a confirmation without a second cross-module call, and the **grace window travels in the request** rather than living on this record, because "how early does a scan count" is check-in policy owned by Engagement, not schedule data owned by Conference (doc comment, `RoomSessionInfo.cs:8-12`, and the same split restated on the interface, `IEventLiveValidationService.cs:51-54`).
- **Walkthrough**: a positional `sealed record` with four parameters (`RoomSessionInfo.cs:18-22`), `SessionId` (the session the room is hosting at the query instant, line 19), `SessionTitle` (line 20), `EventId` (the owning event, line 21), and `IsPublished` (line 22). No behavior.
- **Why it's built this way**: bundling the title and the published flag with the id keeps the door-scan path to a single cross-module round-trip, and keeping the grace window out of the record preserves the boundary: Conference answers the schedule question, Engagement decides the policy.
- **Where it's used**: produced by [`EventLiveValidationService.GetCurrentRoomSessionInfoAsync`](group-18-conference-application.md#eventlivevalidationservice) (`EventLiveValidationService.cs:143`), which excludes unscheduled sessions (`EventLiveValidationService.cs:155-165`), resolves the event's zone without a fallback (`EventLiveValidationService.cs:180-184`), converts session wall-clock times through [`CalendarExportMapper.ToUtc`](group-18-conference-application.md#calendarexportmapper) (`EventLiveValidationService.cs:189-197`), and prefers an in-progress session over an upcoming one inside the grace window (`EventLiveValidationService.cs:201-208`) before building the record (`EventLiveValidationService.cs:216-220`). Carried over the wire by [`EventLiveValidationServiceGrpcAdapter`](group-20-conference-api-grpc.md#eventlivevalidationservicegrpcadapter) (`EventLiveValidationServiceGrpcAdapter.cs:127`) against the `GetCurrentRoomSessionInfo` rpc (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/Protos/event_live_validation.proto:47`). Consumed by the Engagement [`RecordRoomCheckInHandler`](group-22-engagement-module.md#recordroomcheckinhandler), which passes the configured grace window (`RecordRoomCheckInHandler.cs:50-52`, from `CheckInSettings.RoomCheckInGraceMinutes`, default 15, `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/CheckIns/CheckInSettings.cs:21`), collapses a `NotFound` into a generic "no session is starting here" message so room ids do not leak while still propagating transport failures unchanged (`RecordRoomCheckInHandler.cs:53-63`, `:98-102`), rejects an unpublished event (`RecordRoomCheckInHandler.cs:66-67`), and uses the resolved `SessionId`/`SessionTitle` for the check-in row and its response (`RecordRoomCheckInHandler.cs:71`, `:91-92`).

---

### SponsorLiveInfo
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/SponsorLiveInfo.cs:12` · Level 0 · record (sealed)

- **What it is**: a sponsor's live-layer facts for the booth-visit flow: the owning event's id and published flag, plus the sponsor's display name.
- **Depends on**: the `EventIdentifierType` alias; BCL otherwise. No first-party types.
- **Concept**: the same server-resolved cross-module snapshot [`RoomSessionInfo`](#roomsessioninfo) introduces, applied to a [`Sponsor`](#sponsor). `[Rubric §7, Microservices Readiness]`: Engagement never references the `Sponsor` entity; it asks Conference three questions and gets three values. `[Rubric §11, Security]`: because the QR is **printed**, the server must confirm the sponsor still exists and its event is published before recording anything, and the soft-delete query filter means a pulled sponsor answers exactly like one that never existed, so an old printed QR simply stops working (`EventLiveValidationService.cs:108-121`).
- **Walkthrough**: a positional `sealed record` with three parameters (`SponsorLiveInfo.cs:12-15`), `EventId` (line 13), `IsPublished` (line 14), and `SponsorName` (line 15, carried so a consumer can render a confirmation without a second cross-module call, per the doc comment `SponsorLiveInfo.cs:3-8`).
- **Why it's built this way**: the booth-visit write needs the owning event for scoping, the published flag for the gate, and the name for the confirmation screen. Returning all three in one record keeps the scan path to a single round-trip.
- **Where it's used**: produced by [`EventLiveValidationService.GetSponsorLiveInfoAsync`](group-18-conference-application.md#eventlivevalidationservice) (`EventLiveValidationService.cs:104-139`, which looks the sponsor up, then its owning event, and returns `NotFound` for either miss), served over gRPC via the `GetSponsorLiveInfo` rpc (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/Protos/event_live_validation.proto:40`) and its adapter (`EventLiveValidationServiceGrpcAdapter.cs:98`). Consumed by the Engagement [`RecordSponsorVisitHandler`](group-22-engagement-module.md#recordsponsorvisithandler), which propagates a lookup failure unchanged (`RecordSponsorVisitHandler.cs:59-60`), rejects an unpublished event (`RecordSponsorVisitHandler.cs:63-64`), scopes the check-in row to the returned `EventId` (`RecordSponsorVisitHandler.cs:75`), and echoes `SponsorName` on the response whether the visit is new or a replay (`RecordSponsorVisitHandler.cs:90`). The fail-open stub returns `new SponsorLiveInfo(default, true, string.Empty)` (`DisabledEventLiveValidationService.cs:50`).

---

### EventQuestionAnswerDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/EventQuestionAnswerDTO.cs:9` · Level 1 · record (class)

- **What it is**: the read/write DTO for one event-level question answer, linking an event to a metadata question with the answer text a speaker or organizer supplied. It is one of the three child-collection DTOs that [`EventDTO`](#eventdto) composes.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (`EventQuestionAnswerDTO.cs:1,9`), closed over `EventQuestionAnswerIdentifierType`; the foreign-key fields use the `EventIdentifierType` and `QuestionIdentifierType` aliases.
- **Concept introduced, the child-collection DTO.** The DTO shape and the [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) contract were taught in group-12; this is the family of child DTOs that an aggregate DTO composes. `[Rubric §9, API & Contract Design]` (DTOs decoupled from domain entities, stable contracts): this record is the wire shape clients see, and the [`EventQuestionAnswer`](#eventquestionanswer) join entity never crosses the boundary. Cross-aggregate references appear as **scalar foreign keys** (`QuestionId`), never nested objects, consistent with database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), where the related aggregate may live in a different database.
- **Walkthrough**: four `required init` properties (`EventQuestionAnswerDTO.cs:12-21`), `Id` (the strong id alias, line 12), `EventId` (foreign key to the parent event, line 15), `QuestionId` (foreign key to the question, line 18), and `AnswerValue` (the answer text, line 21). Being a `record class` with all-`required` members, it cannot be partially constructed and is immutable after creation.
- **Why it's built this way**: modelling the join as a flat DTO with scalar foreign keys keeps the contract stable and portable across a process boundary, and it is the same shape the sibling child DTOs use.
- **Where it's used**: nested in [`EventDTO.EventQuestionAnswers`](#eventdto) (`EventDTO.cs:107`); mapped from the [`EventQuestionAnswer`](#eventquestionanswer) entity by [`EventQuestionAnswerDTOMapper`](group-18-conference-application.md#eventquestionanswerdtomapper) (group-18).

---

### EventSpeakerDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/EventSpeakerDTO.cs:8` · Level 1 · record (class)

- **What it is**: the thinnest of the event child DTOs, the many-to-many join row between an event and a speaker.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (`EventSpeakerDTO.cs:1,8`) closed over `EventSpeakerIdentifierType`; the foreign keys use `EventIdentifierType` and `SpeakerIdentifierType`.
- **Concept**: the same child-collection DTO shape introduced on [`EventQuestionAnswerDTO`](#eventquestionanswerdto), a flat `record class` with `required init` members and scalar foreign keys. `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: three `required init` properties (`EventSpeakerDTO.cs:11-17`), `Id` (line 11), `EventId` (foreign key to the parent event, line 14), and `SpeakerId` (foreign key to the speaker, line 17). Nothing else: this row exists only to associate an [`Event`](#event) with a [`Speaker`](#speaker).
- **Where it's used**: nested in [`EventDTO.EventSpeakers`](#eventdto) (`EventDTO.cs:104`); mapped from the [`EventSpeaker`](#eventspeaker) entity by [`EventSpeakerDTOMapper`](group-18-conference-application.md#eventspeakerdtomapper) (group-18).

---

### RoomDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/RoomDTO.cs:13` · Level 1 · record (class)

- **What it is**: the richest of the event child DTOs, a conference room within an event's venue, with display and accessibility metadata. It also declares the four room field-length caps that the rest of the stack reads.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (`RoomDTO.cs:1,13`) closed over `RoomIdentifierType`; the foreign key uses `EventIdentifierType`.
- **Concept introduced, the DTO as the lowest common home for a shared constant.** The child-DTO shape itself is the one [`EventQuestionAnswerDTO`](#eventquestionanswerdto) introduces; what is new here is that the DTO owns the length constants. `[Rubric §16, Maintainability]` (assesses whether a fact is written once): the domain invariants sit in Conference.Domain, the EF configuration in Conference.Infrastructure, and the form model in Conference.UI, and none of those three can reference the other two. The `*.Shared` project is the only assembly all of them already depend on, so the caps live on the DTO and everyone re-exports rather than re-types them (doc comment, `RoomDTO.cs:6-11`). `[Rubric §21, Accessibility]` is worth naming too, because accessibility data is modelled as first-class room data (`AccessibilityInfo`, `RoomDTO.cs:46`) rather than being buried in a free-text description.
- **Walkthrough**
  - Length constants (`RoomDTO.cs:16-25`): `NameMaxLength = 255` (line 16), `FloorMaxLength = 100` (line 19), `LocationMaxLength = 255` (line 22), `AccessibilityInfoMaxLength = 500` (line 25).
  - Three `required` members, `Id` (`RoomDTO.cs:28`), `Name` (`RoomDTO.cs:31`), and `EventId` (`RoomDTO.cs:49`, the parent foreign key, declared last in the file).
  - `Sort` (`RoomDTO.cs:34`) is a plain `int` display order that defaults to zero. Four optional members follow, `Capacity` (`int?`, line 37), `Floor` (`string?`, line 40), `Location` (`string?`, line 43), and `AccessibilityInfo` (`string?`, line 46), each null when absent.
- **Why it's built this way**: a room imported from Sessionize often has nothing beyond a name and a sort order, so everything past those is nullable. Making `EventId` required keeps a room from existing on the wire without an owning event. The constants live here so the same number reaches the database column, the domain guard, and the input counter from one declaration.
- **Where it's used**: nested in [`EventDTO.Rooms`](#eventdto) (`EventDTO.cs:101`); mapped from the [`Room`](#room) entity by [`RoomDTOMapper`](group-18-conference-application.md#roomdtomapper) (group-18). The constants are re-exported by [`EventInvariants`](#eventinvariants) as `RoomNameMaxLength`, `RoomFloorMaxLength`, `RoomLocationMaxLength`, and `RoomAccessibilityInfoMaxLength` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/EventInvariants.cs:45-55`), which the guard itself uses (`EventInvariants.cs:137`) and which `RoomConfiguration` turns into EF `HasMaxLength` calls (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/RoomConfiguration.cs:20`, `:30`); the UI reads them straight off the DTO in `RoomFormModel` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Room/RoomFormModel.cs:35`, `:45`, `:49`, `:53`).

---

### SessionLiveInfo
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/SessionLiveInfo.cs:17` · Level 1 · record (sealed)

- **What it is**: the session-level counterpart to [`EventLiveInfo`](#eventliveinfo), a snapshot of everything the live layer needs to gate a single session's polls and Q&A: the owning event's id, published flag and live window, the session's assigned speaker ids, whether the session is a plenum (whole-conference) session, and the event's question-moderation default.
- **Depends on**: [`QuestionModerationDefault`](#questionmoderationdefault) (a parameter, `SessionLiveInfo.cs:24`); the `EventIdentifierType` and `SpeakerIdentifierType` aliases. BCL otherwise.
- **Concept introduced, the enriched cross-module session snapshot.** `[Rubric §7, Microservices Readiness]` (a single, sufficient contract crossing the boundary): the Engagement live layer must answer several questions before it lets someone open a poll or moderate a question. Is the event published and live? Who are the session's speakers, so it can grant them moderation rights (BR-236)? Is it a plenum session? What is the default status for new questions (BR-233)? Rather than force several separate cross-service calls, Conference bundles all of it into one record returned by [`GetSessionLiveInfoAsync`](#ieventlivevalidationservice). `[Rubric §12, Performance & Scalability]` (one round-trip instead of many) is the payoff of that bundling.
- **Walkthrough**: a positional `sealed record` with seven parameters (`SessionLiveInfo.cs:17-24`), `EventId` (the owning event, line 18), `IsPublished` (line 19), `LiveWindowStartUtc` and `LiveWindowEndUtc` (lines 20-21, same live-window semantics as [`EventLiveInfo`](#eventliveinfo)), `SpeakerIds` (`IReadOnlyCollection<SpeakerIdentifierType>`, the session's non-deleted assigned speakers, line 22), `IsPlenumSession` (line 23), and `QuestionModerationDefault` (line 24). No behavior: a pure value carrier.
- **Why it's built this way**: the producer already loads the session and its owning event to compute the window, so it enriches the same result with the speaker set, plenum flag, and moderation default instead of making the consumer chase those separately. That keeps the speaker-rights and moderation decisions on data the owning module vouches for.
- **Where it's used**: produced by [`EventLiveValidationService.GetSessionLiveInfoAsync`](group-18-conference-application.md#eventlivevalidationservice) (`EventLiveValidationService.cs:48`, built at `:93`, and it also enforces the eligibility rules BR-49/BR-91) and by its gRPC adapter (`EventLiveValidationServiceGrpcAdapter.cs:65`). Consumed by every Engagement live-layer entry point: [`CreateLivePollHandler`](group-23-engagement-live-layer.md#createlivepollhandler) (`CreateLivePollHandler.cs:38-59`, including the "session belongs to this event" check that is deliberately skipped when `EventId` is `default`, `CreateLivePollHandler.cs:44-45`), [`OpenLivePollHandler`](group-23-engagement-live-layer.md#openlivepollhandler) (`OpenLivePollHandler.cs:47-58`), [`CloseLivePollHandler`](group-23-engagement-live-layer.md#closelivepollhandler) (`CloseLivePollHandler.cs:43`), [`SubmitQuestionHandler`](group-23-engagement-live-layer.md#submitquestionhandler) (`SubmitQuestionHandler.cs:41`, the live-window gate at `:57`, the moderation default at `:86-88`), [`ModerateQuestionHandler`](group-23-engagement-live-layer.md#moderatequestionhandler) (`ModerateQuestionHandler.cs:56`), and [`GetModerationQueueHandler`](group-23-engagement-live-layer.md#getmoderationqueuehandler) (`GetModerationQueueHandler.cs:33`). The speaker set is what [`LivePollAuthorization`](group-23-engagement-live-layer.md#livepollauthorization) checks the caller against (`CreateLivePollHandler.cs:54-55`). The Engagement check-in path uses it too, for a session-scope check-in (`CheckInProcessor.cs:170-174`).

---

### EventDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/EventDTO.cs:14` · Level 2 · record (class)

- **What it is**: the aggregate DTO for a conference event, the full wire shape a client reads or writes for the [`Event`](#event) aggregate. It composes the three child collections (rooms, speaker associations, question answers) alongside the event's own scalar fields, its concurrency token, and the ten field-length constants the rest of the stack reads.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) and [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) (both implemented, `EventDTO.cs:1,14`); composes [`RoomDTO`](#roomdto), [`EventSpeakerDTO`](#eventspeakerdto), and [`EventQuestionAnswerDTO`](#eventquestionanswerdto); carries [`QuestionModerationDefault`](#questionmoderationdefault).
- **Concept introduced, the aggregate DTO and the optimistic-concurrency round-trip on the wire.** `[Rubric §9, API & Contract Design]` (aggregate DTOs compose child DTOs so a UI gets everything it needs in one call; mapping is manual or Mapperly-generated per [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)): `EventDTO` is the Level-2 composite that bundles the Level-1 children. `[Rubric §8, Data Architecture]` (optimistic concurrency): implementing [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) means the DTO round-trips the EF `RowVersion` token (`EventDTO.cs:50`), so an update form can detect a concurrent edit instead of silently overwriting one. The body-less publish and unpublish transitions carry the same token in an `If-Match` header rather than a body, which is why there is no transition request record here: [`EventsController.PublishAsync`](group-20-conference-api-grpc.md#eventscontroller) reads it via `SupportsIfMatchAttribute.RequiredToken` and answers a missing header with `428` and a stale token with `412` (`EventsController.cs:264-276`, `:295-309`).
- **Walkthrough**
  - Length constants (`EventDTO.cs:17-44`): `NameMaxLength = 500` (line 17), `DescriptionMaxLength = 4000` (line 20), `TimeZoneMaxLength = 100` (line 23), `SessionizeCodeMaxLength = 100` (line 26), `VenueAddressMaxLength = 500` (line 29), `VenueMapUrlMaxLength = 2000` (line 32), `WiFiInfoMaxLength = 500` (line 35), `OrganizerContactEmailMaxLength = 255` (line 38), `SponsorshipPacketUrlMaxLength = 2000` (line 41), and `TicketingUrlMaxLength = 2000` (line 44).
  - Identity and concurrency: `Id` (`required`, `EventDTO.cs:47`) and `RowVersion`, a non-nullable `byte[]` defaulting to `[]` (`EventDTO.cs:50`), so a freshly constructed DTO carries an empty token rather than a null one.
  - Required core: `Name` (line 53), `StartDate` and `EndDate` (both `DateOnly`, lines 59 and 62), and `TimeZone` (line 65, the IANA id used to compute the live window).
  - Optional scalars: `Description` (line 56), `SessionizeCode` (line 68), `VenueAddress` (line 71), `VenueMapUrl` (line 74), `WiFiInfo` (line 77), `OrganizerContactEmail` (line 80, the contact published to attendees), `SponsorshipPacketUrl` (line 83, the published sponsorship packet for this edition), and `TicketingUrl` (line 86, where attendees buy tickets), all `string?`; plus `IsPublished` (line 89) and `QuestionModerationDefault` (line 92, BR-233).
  - Sessionize refresh audit: `LastSessionizeRefreshOn` (`DateTime?`, line 95) and `LastSessionizeRefreshBy` (`string?`, line 98), so the UI can show when the last import ran and who ran it.
  - Child collections (`EventDTO.cs:101-107`): `Rooms`, `EventSpeakers`, and `EventQuestionAnswers`, each an `IReadOnlyCollection<>` of the matching child DTO, each defaulting to an empty collection (`= []`) so an event with no children is safe to render.
- **Why it's built this way**: composing the children inline lets a single `GET /Events/{id}` return the whole event graph without follow-up calls, and defaulting the collections to `[]` avoids null checks in the UI. The `IConcurrencyAware` token is the write-path guard that turns a lost update into a conflict instead of a silent overwrite. The constants live on the DTO for the reason its doc comment gives (`EventDTO.cs:8-12`): it is the lowest layer the domain, EF configuration, and Blazor pages can all reach.
- **Where it's used**: produced by [`EventDTOMapper`](group-18-conference-application.md#eventdtomapper) (group-18); it is the DTO type parameter of [`EventsController`](group-20-conference-api-grpc.md#eventscontroller) itself (`EventsController.cs:47-59`), so every inherited GetAll/GetById/Create action speaks it, and the same type parameter drives the UI's `EntityServiceBase` in [`EventService`](group-21-conference-ui.md#eventservice) (`EventService.cs:15-17`). It is the concrete event model that [`CurrentEventDefaults`](#currenteventdefaults) binds [`CurrentEventSelector`](#currenteventselector) to. Its constants are re-exported by [`EventInvariants`](#eventinvariants) (`EventInvariants.cs:16-43`) and bound by the UI's `EventFormModel` `[MaxLength]` attributes (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Event/EventFormModel.cs:44-84`) and the `EventFormFields` input counters (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Event/EventFormFields.razor:21`, `:28`).

---

### IEventLiveValidationService
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/IEventLiveValidationService.cs:12` · Level 3 · interface

- **What it is**: the cross-module service contract the Engagement live and check-in layers call to validate an event's, a session's, a sponsor's, or a room's live-layer facts, returning small snapshot records without the caller ever referencing a Conference domain entity.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and [`ServiceContractAttribute`](group-13-grpc-contracts.md#servicecontractattribute) (both via `MMCA.Common.Shared.Abstractions`, `IEventLiveValidationService.cs:1`); [`EventLiveInfo`](#eventliveinfo), [`SessionLiveInfo`](#sessionliveinfo), [`SponsorLiveInfo`](#sponsorliveinfo), and [`RoomSessionInfo`](#roomsessioninfo); the `EventIdentifierType`, `SessionIdentifierType`, `SponsorIdentifierType`, and `RoomIdentifierType` aliases.
- **Concept introduced, the owned-interface cross-module boundary.** `[Rubric §7, Microservices Readiness]` (assesses boundaries that survive extraction into separate processes) and `[Rubric §3, Clean Architecture]` (a module depends on an interface it can consume, not on another module's internals): the interface lives in Conference's `*.Shared` project, so the module that **owns** the data publishes the contract, and it is defined in terms of ids and small DTOs only. When both modules run in one host, the real Conference.Application implementation is injected directly; after extraction, the same interface is satisfied by a gRPC adapter. Engagement's code does not change either way. This is the same pattern the module uses for [`ISessionBookmarkValidationService`](#isessionbookmarkvalidationservice). The `[ServiceContract]` marker on `IEventLiveValidationService.cs:11` opts the type into the architecture-fitness rules that guard the contract surface (ADR-015).
- **Walkthrough**: four methods, all returning `Task<Result<...>>` with a trailing `CancellationToken`.
  - `GetEventLiveInfoAsync` (`IEventLiveValidationService.cs:22`): returns the event's published flag and live window, or a `NotFound` failure when the event does not exist. Consumers layer their own rules on top (draft creation requires published; opening a poll requires now to be inside the window), as stated in the doc comment (`IEventLiveValidationService.cs:14-18`).
  - `GetSessionLiveInfoAsync` (`IEventLiveValidationService.cs:33`): returns a session's live facts (the owning event's window plus speakers, plenum flag, and moderation default), or a failure when the session does not exist, is a service session (BR-91), or has an ineligible status (BR-49), per the doc comment (`IEventLiveValidationService.cs:24-28`).
  - `GetSponsorLiveInfoAsync` (`IEventLiveValidationService.cs:44`): returns the sponsor's owning event id, that event's published flag, and the sponsor name, or a `NotFound` failure. The doc comment names the caller: the booth-visit flow where an attendee scans a printed deep-link QR and the server must confirm the sponsor exists and belongs to a published event before recording anything (`IEventLiveValidationService.cs:35-39`).
  - `GetCurrentRoomSessionInfoAsync` (`IEventLiveValidationService.cs:60-63`): resolves which session a room is hosting at the call instant "so a consumer never has to trust a client-supplied session id". A session qualifies when the instant falls inside `[StartsAt - graceMinutes, EndsAt)`; an in-progress session wins over an upcoming one, and the earliest upcoming one wins among several (`IEventLiveValidationService.cs:47-50`). `graceMinutes` is a **parameter, not a Conference setting**, because it is check-in policy: Conference only answers the schedule question (`IEventLiveValidationService.cs:51-54`).
- **Why it's built this way**: returning [`Result`](group-01-result-error-handling.md#result) rather than throwing lets the consumer branch on `NotFound` and eligibility failures as ordinary control flow. Keeping the contract in `*.Shared`, expressed in ids and DTOs only, is what makes Conference extractable without breaking Engagement. Passing the grace window in rather than reading it from Conference config keeps policy on the consuming side of the boundary.
- **Where it's used**: implemented in-process by [`EventLiveValidationService`](group-18-conference-application.md#eventlivevalidationservice) (Conference.Application, group-18), served over gRPC by [`EventLiveValidationGrpcService`](group-20-conference-api-grpc.md#eventlivevalidationgrpcservice) and consumed across the boundary via [`EventLiveValidationServiceGrpcAdapter`](group-20-conference-api-grpc.md#eventlivevalidationservicegrpcadapter). A host wires the remote path with `AddConferenceEventLiveValidationClient()`, which `Replace`s whatever registration is already in the container rather than `TryAdd`ing behind it (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/DependencyInjection.cs:73-80`). Injected into the Engagement live-layer handlers (group-23) and into the check-in handlers [`RecordRoomCheckInHandler`](group-22-engagement-module.md#recordroomcheckinhandler) (`RecordRoomCheckInHandler.cs:28`), [`RecordSponsorVisitHandler`](group-22-engagement-module.md#recordsponsorvisithandler) (`RecordSponsorVisitHandler.cs:36`), [`ManualCheckInHandler`](group-22-engagement-module.md#manualcheckinhandler) (`ManualCheckInHandler.cs:19`), [`CheckInAttendeeHandler`](group-22-engagement-module.md#checkinattendeehandler) (`CheckInAttendeeHandler.cs:21`), and [`CheckInProcessor`](group-22-engagement-module.md#checkinprocessor) (`CheckInProcessor.cs:111`, `:162`). When Conference is not loaded in a host, [`DisabledEventLiveValidationService`](#disabledeventlivevalidationservice) stands in.

---

### DisabledEventLiveValidationService
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/DisabledEventLiveValidationService.cs:22` · Level 4 · class (internal sealed)

- **What it is**: the fail-open stub implementation of [`IEventLiveValidationService`](#ieventlivevalidationservice), registered when the Conference module is not loaded in a host (for example when Engagement runs as its own service without Conference in-process).
- **Depends on**: [`IEventLiveValidationService`](#ieventlivevalidationservice), [`Result`](group-01-result-error-handling.md#result) (via `MMCA.Common.Shared.Abstractions`, `DisabledEventLiveValidationService.cs:1`), [`EventLiveInfo`](#eventliveinfo), [`SessionLiveInfo`](#sessionliveinfo), [`SponsorLiveInfo`](#sponsorliveinfo), [`RoomSessionInfo`](#roomsessioninfo), [`QuestionModerationDefault`](#questionmoderationdefault).
- **Concept introduced, the fail-open disabled-module stub (a Null Object variant).** `[Rubric §2, Design Patterns]` (a Null-Object-style stub keeps consumers running when a dependency is absent) and `[Rubric §29, Resilience & Business Continuity]` (assesses graceful degradation): this stub deliberately **fails open**. It reports the event as published with an always-open window, so the Engagement live-layer handlers can complete without an in-process Conference module, at the cost of skipping the published and live-window checks (doc comment, `DisabledEventLiveValidationService.cs:9-16`). Real validation is restored when the host is wired to the Conference gRPC adapter, which `Replace`s this stub. It mirrors the convention where each owning module's `*.Shared` project ships a `Disabled*Service` stub for the cross-module interfaces it exposes, naming [`DisabledSessionBookmarkValidationService`](#disabledsessionbookmarkvalidationservice) as the precedent (`DisabledEventLiveValidationService.cs:17-20`).
- **Walkthrough**: four expression-bodied methods, each returning a completed `Task` wrapping a success `Result`.
  - `GetEventLiveInfoAsync` (`DisabledEventLiveValidationService.cs:25-26`): `Result.Success(new EventLiveInfo(true, DateTime.MinValue, DateTime.MaxValue))`, published, with a window spanning all of time.
  - `GetSessionLiveInfoAsync` (`DisabledEventLiveValidationService.cs:34-42`): a success [`SessionLiveInfo`](#sessionliveinfo) with a `default` (unknown) event id, the always-open window, no speakers (`[]`), `IsPlenumSession = false`, and `QuestionModerationDefault.Pending`. The remarks (`DisabledEventLiveValidationService.cs:29-33`) record the downstream effect: consumers skip the event-match check when the event id is `default` (see `CreateLivePollHandler.cs:44-45`), and speaker-based rights resolve to organizers only.
  - `GetSponsorLiveInfoAsync` (`DisabledEventLiveValidationService.cs:49-50`): reports every sponsor as belonging to a published event, with a `default` event id and an empty name, so a consumer that renders the name simply shows nothing (remarks, `DisabledEventLiveValidationService.cs:45-48`).
  - `GetCurrentRoomSessionInfoAsync` (`DisabledEventLiveValidationService.cs:58-62`): echoes the room's own id as the session id, with an empty title and a published flag of `true`. The remarks (`DisabledEventLiveValidationService.cs:53-57`) explain the choice: without a Conference module there is no schedule to consult, and returning a `NotFound` instead would turn the disabled-module stub into a hard rejection rather than a skipped check.
- **Why it's built this way**: failing open rather than closed is the right default here because the stub is only reached in a host that is **not** the authority on live windows. Blocking every poll, question, and scan in that configuration would be worse than skipping a check that a properly wired gRPC client will perform. The choice is explicit and documented per method, not accidental. The class is `internal`, so nothing outside the `*.Shared` assembly can take a direct dependency on the fail-open behavior: it is only ever reached through the interface.
- **Where it's used**: registered by `ConferenceModule.RegisterDisabledStubs` as a singleton `IEventLiveValidationService` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:24`, the hook the module system calls when Conference is disabled in a host, declared at `ConferenceModule.cs:21` next to the sibling bookmark stub at `:23`); then `Replace`d by the gRPC adapter when a host calls `AddConferenceEventLiveValidationClient` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/DependencyInjection.cs:73-80`).
- **Caveats / not-in-source**: the stub's fail-open posture is safe only because every host that actually serves live traffic wires the gRPC client. Whether that holds for a given deployment is host configuration, not something this file can guarantee.

---

### CurrentEventSelector
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/CurrentEventSelector.cs:10` · Level 8 · class (static)

- **What it is**: a static, generic helper that picks which event a landing surface should feature (live now, else the next upcoming, else the most recently ended) using the same live-window math the backend enforces. It also exposes the window computation and the DST-safe local-to-UTC conversion as public methods.
- **Depends on**: nothing first-party (BCL `TimeZoneInfo`, `DateOnly`/`DateTime`, LINQ). It is generic over the caller's event model via accessor delegates.
- **Concept introduced, the shared selection algorithm parameterized by accessors.** `[Rubric §16, Maintainability]` and `[Rubric §1, SOLID]` (one algorithm serving many callers without a shared base type): several surfaces need "which event is current", the ADC home page, the Engagement live-event service, the Conference list pages, and two server-side handlers, and they do not all hold the same event model (the home page deserializes its own anonymous-endpoint shape). Rather than duplicate the classify-and-rank logic, `SelectCurrentOrNext<TEvent>` takes `Func<TEvent, ...>` accessors for start date, end date, and time-zone id, so it works over any shape without coupling to a concrete type. `[Rubric §27, Internationalization]` also applies: the window math is computed per the event's IANA time zone, never per server local time.
- **Walkthrough**
  - `SelectCurrentOrNext<TEvent>(events, startDate, endDate, timeZoneId, utcNow)` (`CurrentEventSelector.cs:22-53`, constrained `where TEvent : class`): projects each event to its `(StartUtc, EndUtc)` window via `GetLiveWindowUtc` (`CurrentEventSelector.cs:30-36`), then applies the preference order. **Live** events (`StartUtc <= utcNow && utcNow < EndUtc`) ordered by soonest to end (`CurrentEventSelector.cs:38-42`), else **upcoming** events (`StartUtc > utcNow`) ordered by soonest to start (`CurrentEventSelector.cs:44-48`), else the most recently ended event (`OrderByDescending(EndUtc)`, `CurrentEventSelector.cs:52`). Returns `null` when `events` is empty. Ties resolve by input order because LINQ's `OrderBy` is a stable sort (doc comment, `CurrentEventSelector.cs:8`).
  - `GetLiveWindowUtc(startDate, endDate, timeZoneId)` (`CurrentEventSelector.cs:64-74`): computes `startLocal` as `StartDate` at 00:00 (`CurrentEventSelector.cs:69`) and `endLocal` as `EndDate + 1 day` at 00:00 (`CurrentEventSelector.cs:70`), resolves the zone with `TimeZoneInfo.FindSystemTimeZoneById` (`CurrentEventSelector.cs:72`) and converts both through `ToUtc` (`CurrentEventSelector.cs:73`). There is **no** catch around the zone lookup: the doc comment states the id always resolves because [`EventInvariants`](#eventinvariants)`.EnsureTimeZoneIsValid` guards every write path (`CurrentEventSelector.cs:57-58`, and the guard itself at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/EventInvariants.cs:81-97`), so an unresolvable id is a data defect that must surface rather than be silently absorbed. The returned tuple names its second element `EndExclusiveUtc` (`CurrentEventSelector.cs:64`), a reminder that the end bound is exclusive.
  - `ToUtc(localWallClock, timeZone)` (`CurrentEventSelector.cs:87-98`): the DST guard. Both window boundaries land on **local midnight**, which is inside the spring-forward gap in zones that transition at 00:00 (the doc comment names America/Santiago and Asia/Beirut, `CurrentEventSelector.cs:77-82`); that wall time never existed, so a raw `TimeZoneInfo.ConvertTimeToUtc` would throw. The method null-guards the zone (`CurrentEventSelector.cs:89`), re-kinds the input as `Unspecified` (`CurrentEventSelector.cs:91`), and shifts an invalid time forward by one hour into the hour that did exist (`CurrentEventSelector.cs:92-95`) before converting (`CurrentEventSelector.cs:97`). Ambiguous (fall-back) times resolve to the zone's standard offset, which is `ConvertTimeToUtc`'s own behavior.
- **Why it's built this way**: the accessor-delegate design lets one vetted implementation of the "current event" rule serve every surface, so the home page, the live layer, and the list-page default filter can never disagree about which event is featured. Colocating `GetLiveWindowUtc` here keeps the window definition identical to the one [`EventLiveInfo`](#eventliveinfo) advertises (its doc comment points at that record, `CurrentEventSelector.cs:5`), and making `ToUtc` public means the same spring-forward-gap fix is reused rather than re-derived: the home page's countdown calls it directly for that reason (`ADCHome.razor.cs:253-259`).
- **Where it's used**: the Conference [`ADCHome`](group-21-conference-ui.md#adchome) page (`ADCHome.razor.cs:179` for the selection, `ADCHome.razor.cs:258-259` for `ToUtc`); the shared `EventFilteredListPageBase`, which resolves the default event filter once for every list page that derives from it (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Common/EventFilteredListPageBase.cs:180-188`); the pages that call it directly, [`ActivityCreate`](group-21-conference-ui.md#activitycreate) (`ActivityCreate.razor.cs:61`), [`PublicActivityList`](group-21-conference-ui.md#publicactivitylist) (`PublicActivityList.razor.cs:54`), [`PublicEventList`](group-21-conference-ui.md#publiceventlist) (`PublicEventList.razor.cs:102`), [`PublicSponsorList`](group-21-conference-ui.md#publicsponsorlist) (`PublicSponsorList.razor.cs:53`), [`SponsorCreate`](group-21-conference-ui.md#sponsorcreate) (`SponsorCreate.razor.cs:60`), [`SpeakerDashboard`](group-21-conference-ui.md#speakerdashboard) (`SpeakerDashboard.razor.cs:169`), and [`SessionSelectionDashboard`](group-21-conference-ui.md#sessionselectiondashboard) (`SessionSelectionDashboard.razor.cs:67`); the Engagement [`LiveEventService`](group-23-engagement-live-layer.md#liveeventservice), which uses both `SelectCurrentOrNext` and `GetLiveWindowUtc` (`LiveEventService.cs:27`, `LiveEventService.cs:38`); and server-side by [`GetNowNextHandler`](group-18-conference-application.md#getnownexthandler), which resolves the current event and its window for the Now/Next query (`GetNowNextHandler.cs:101`, `GetNowNextHandler.cs:68`) and by [`EventLiveValidationService`](group-18-conference-application.md#eventlivevalidationservice) itself, which delegates rather than repeating the math (`EventLiveValidationService.cs:227`). Callers holding an [`EventDTO`](#eventdto) usually go through the [`CurrentEventDefaults`](#currenteventdefaults) wrapper instead.

---

### CurrentEventDefaults
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/CurrentEventDefaults.cs:8` · Level 9 · class (static)

- **What it is**: a thin convenience wrapper over [`CurrentEventSelector`](#currenteventselector) specialized to the [`EventDTO`](#eventdto) shape, so the pages and services that already work with `EventDTO` do not repeat the same accessor lambdas.
- **Depends on**: [`CurrentEventSelector`](#currenteventselector), [`EventDTO`](#eventdto).
- **Concept, the type-specialized wrapper (DRY over the generic helper).** `[Rubric §16, Maintainability]`: the generic [`CurrentEventSelector.SelectCurrentOrNext<TEvent>`](#currenteventselector) needs three accessor delegates on every call. Since many callers pass `EventDTO`, this wrapper binds those lambdas once, so a call site shrinks to `SelectCurrentOrNext(events, utcNow)`.
- **Walkthrough**: one method, `SelectCurrentOrNext(IEnumerable<EventDTO> events, DateTime utcNow)` (`CurrentEventDefaults.cs:17`), which forwards to [`CurrentEventSelector.SelectCurrentOrNext`](#currenteventselector) with the three `EventDTO` accessors `e => e.StartDate`, `e => e.EndDate`, `e => e.TimeZone` (`CurrentEventDefaults.cs:18-23`) and returns the selected `EventDTO?` (null when the input is empty). No other logic: all the ranking lives in the generic helper. The doc comment notes that callers pass the role-appropriate candidate set (`CurrentEventDefaults.cs:14`), so filtering to published events stays the caller's job.
- **Why it's built this way**: keeping the `EventDTO` accessors in one place means renaming an `EventDTO` date or time-zone property is a single edit here, not a change scattered across every page that defaults an event filter.
- **Where it's used**: the Conference [`SessionList`](group-21-conference-ui.md#sessionlist) page (`SessionList.razor.cs:116`), the [`PublicSessionList`](group-21-conference-ui.md#publicsessionlist) page (`PublicSessionList.razor.cs:167`), each setting its default selected event id, and [`PublicSpeakerDetail`](group-21-conference-ui.md#publicspeakerdetail) (`PublicSpeakerDetail.razor.cs:212`). Callers passing a non-`EventDTO` model call the generic [`CurrentEventSelector`](#currenteventselector) directly.

### NowNextSessionDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/NowNextDTO.cs:29` · Level 0 · record

- **What it is**: one session row inside the "happening now / up next" snapshot. It carries just enough
  to render and deep-link a glanceable session tile: identity, title, room, and the start/end pair in
  both event-local wall clock and UTC.
- **Depends on**: nothing first-party (the `SessionIdentifierType` alias resolves through the
  solution-wide `global using` set up in `Directory.Build.props`); BCL only (`DateTime`,
  `DateTimeOffset`). This is an identity-less read projection, not a persisted-entity DTO, so unlike its
  neighbours in this folder it does not implement
  [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype).
- **Concept introduced, the dual-clock read model.** `[Rubric §9, API & Contract Design]` (assesses
  whether a contract hands each consumer the shape it needs without post-processing). This DTO ships
  each boundary time **twice**: `StartsAtLocal`/`EndsAtLocal` as `DateTime` wall clock in the event's
  time zone (`NowNextDTO.cs:33-34`) for a badge or widget that just prints the string, and
  `StartsAtUtc`/`EndsAtUtc` as `DateTimeOffset` (`NowNextDTO.cs:35-36`) for a caller doing its own time
  math. The doc comment on the parent states the split rationale (`NowNextDTO.cs:6-7`). `[Rubric §12,
  Performance & Scalability]`: precomputing both forms server-side keeps a mobile or widget client free
  of time-zone conversion, and the producing handler resolves the zone exactly once per request
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextHandler.cs:46`).
- **Walkthrough**: a positional `sealed record` with seven parameters (`NowNextDTO.cs:29-36`):
  `SessionId` (the deep-link target), `Title`, a nullable `RoomName` that is `null` when the session has
  no room assigned (`NowNextDTO.cs:32`), then the two local `DateTime`s and the two UTC
  `DateTimeOffset`s. There is no `Create` factory: this is a read-side projection assembled from an
  already-valid aggregate by [GetNowNextHandler](group-18-conference-application.md#getnownexthandler),
  not a domain value object that must guard its own invariants.
- **Why it's built this way**: a positional record gives structural equality and immutability with no
  boilerplate, which is all a read model needs. It is the row element of [NowNextDTO](#nownextdto)
  rather than a standalone contract, so it lives in that same file ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)
  Wave 8, cited in the doc comment at `NowNextDTO.cs:4`).
- **Where it's used**: nested as the `Now` and `Next` lists on [NowNextDTO](#nownextdto); each row is
  built by the handler's private `ToRow` projection over a `Session` aggregate
  (`GetNowNextHandler.cs:73`), then served on the anonymous now-next endpoints of
  [EventsController](group-20-conference-api-grpc.md#eventscontroller) (`EventsController.cs:170-179,186-193`).

### NowNextDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/NowNextDTO.cs:14` · Level 1 · record

- **What it is**: the "happening now / up next" snapshot for a single event: which sessions are running
  at the query instant and which start next, plus whether the event is currently live.
- **Depends on**: [NowNextSessionDTO](#nownextsessiondto) (Level 0, the row type); the
  `EventIdentifierType` alias; BCL (`IReadOnlyList<T>`).
- **Concept introduced, the composed glanceable read model.** `[Rubric §9, API & Contract Design]`
  (assesses purpose-built read contracts over exposing raw entities). Rather than make a widget page the
  full session list and filter client-side, this DTO is the entire payload of the now-next endpoint: one
  event's identity plus two pre-filtered session batches. `[Rubric §5, Vertical Slice]`: the snapshot is
  shaped by exactly one query's needs and is not reused across unrelated screens, which is why it lives
  beside the slice that produces it rather than in a shared "models" bucket.
- **Walkthrough**: a positional `sealed record` with five parameters (`NowNextDTO.cs:14-19`).
  - `EventId` and `EventName` name the featured event (`NowNextDTO.cs:15-16`); the handler fills them
    from the selected [Event](#event) aggregate (`GetNowNextHandler.cs:71`).
  - `IsLive` (`NowNextDTO.cs:17`) is `true` when the event's live window contains the query instant. The
    window itself is computed by [CurrentEventSelector](#currenteventselector) and compared against
    `TimeProvider`'s UTC now (`GetNowNextHandler.cs:68-69`), so the flag is deterministic under test.
  - `Now` (`NowNextDTO.cs:18`) holds the sessions whose UTC window brackets the query instant, ordered
    by start then room name (`GetNowNextHandler.cs:52-56`); it is empty outside session hours.
  - `Next` (`NowNextDTO.cs:19`) holds the **batch** sharing the earliest future start, so parallel
    tracks surface together instead of one arbitrary winner (`GetNowNextHandler.cs:59-66`, and the doc
    comment at `NowNextDTO.cs:13`).
  Both batches are `IReadOnlyList<NowNextSessionDTO>`, so the shape is a fixed, ordered projection the
  caller cannot mutate.
- **Why it's built this way**: batching `Next` as a list rather than a single session is the modelling
  decision that makes the widget correct on a multi-track schedule. Local-plus-UTC times live on the row
  type, keeping this envelope thin. The endpoint is `[AllowAnonymous]` and output-cached under the
  `NowNextCache` policy (`EventsController.cs:170-172`) because the payload is public and changes with
  the clock, which is the `[Rubric §12, Performance & Scalability]` lever for a widget that polls.
- **Where it's used**: returned as `Result<NowNextDTO>` by
  [GetNowNextHandler](group-18-conference-application.md#getnownexthandler) (`GetNowNextHandler.cs:25`)
  for [GetNowNextQuery](group-18-conference-application.md#getnownextquery); exposed by
  [EventsController](group-20-conference-api-grpc.md#eventscontroller) both per event
  (`GET {id}/now-next`, `EventsController.cs:173`) and in the id-less "current event" form the
  home-screen widget calls (`GET now-next`, `EventsController.cs:188`). Both
  [NowNextWidgetProvider](group-25-adc-host-composition.md#nownextwidgetprovider) and Engagement's
  [INowNextService](group-22-engagement-module.md#inownextservice) deliberately mirror this wire shape
  locally instead of referencing the type, so neither takes a project reference on Conference.

### SessionCategoryItemDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/SessionCategoryItemDTO.cs:8` · Level 1 · record

- **What it is**: the DTO for one row of the many-to-many join between a session and a category item
  (the topic, format, level and similar tag taxonomies).
- **Depends on**: [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)
  (`SessionCategoryItemDTO.cs:1,8`); the `SessionCategoryItemIdentifierType`, `SessionIdentifierType`
  and `CategoryItemIdentifierType` aliases.
- **Concept introduced, the join-row DTO.** `[Rubric §9, API & Contract Design]` (assesses contracts
  that mirror the relational model without leaking EF entities). This is the read-side twin of the
  [SessionCategoryItem](#sessioncategoryitem) link entity: it carries its own surface `Id` plus the two
  foreign keys that define the association, and nothing else. `[Rubric §8, Data Architecture]`: a join
  with its own identity, rather than a bare composite key, is what lets the association be addressed,
  created and deleted as a resource in its own right.
- **Walkthrough**: a `record class` implementing
  [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) with three
  `required init` members (`SessionCategoryItemDTO.cs:11-17`): `Id` (the join row's own key),
  `SessionId` (FK to the parent session) and `CategoryItemId` (FK to the category item). `required`
  forces every member to be set at construction, `init` freezes them afterwards. It shares its exact
  shape with [SessionSpeakerDTO](#sessionspeakerdto), where the family walkthrough lives.
- **Why it's built this way**: a hand-declared record keeps the wire contract explicit and decoupled
  from the EF link entity ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)
  manual DTO mapping).
- **Where it's used**: nested as `SessionCategoryItems` on [SessionDTO](#sessiondto)
  (`SessionDTO.cs:99`); produced by
  [SessionDTOMapper](group-18-conference-application.md#sessiondtomapper) and filled on demand by
  navigation populators ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html));
  it is also the request and response shape of
  [AddSessionCategoryItemHandler](group-18-conference-application.md#addsessioncategoryitemhandler) and
  [SessionCategoryItemsController](group-20-conference-api-grpc.md#sessioncategoryitemscontroller).

### SessionQuestionAnswerDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/SessionQuestionAnswerDTO.cs:9` · Level 1 · record

- **What it is**: the DTO linking a session to a question together with the speaker's answer value: the
  read-side row for one per-session questionnaire response.
- **Depends on**: [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)
  (`SessionQuestionAnswerDTO.cs:1,9`); the `SessionQuestionAnswerIdentifierType`,
  `SessionIdentifierType` and `QuestionIdentifierType` aliases.
- **Concept**: the join-row DTO with a payload column, a variant of the shape introduced by
  [SessionCategoryItemDTO](#sessioncategoryitemdto). Unlike the two pure two-FK joins, this one also
  carries an attribute *of the relationship*. `[Rubric §9, API & Contract Design]`: the answer belongs
  to the pairing of session and question, not to either side alone, so the join row is the only honest
  place to put it.
- **Walkthrough**: a `record class` implementing
  [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) with four
  `required init` members (`SessionQuestionAnswerDTO.cs:12-21`): `Id`, `SessionId` (FK to the parent
  session), `QuestionId` (FK to the [Question](#question)) and the distinguishing `AnswerValue` string
  (`SessionQuestionAnswerDTO.cs:21`). That extra column is the only structural difference from the two
  pure join DTOs, and note it is `required`: an answer row with no answer cannot be constructed.
- **Why it's built this way**: modelling the answer as a first-class join row (identity plus the answer
  value) lets the session own a replaceable collection of answers, and lets the wire contract stay
  independent of the EF link entity ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)).
- **Where it's used**: nested as `SessionQuestionAnswers` on [SessionDTO](#sessiondto)
  (`SessionDTO.cs:96`); produced by
  [SessionDTOMapper](group-18-conference-application.md#sessiondtomapper) and navigation populators
  ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)); carried by
  [AddSessionQuestionAnswerHandler](group-18-conference-application.md#addsessionquestionanswerhandler),
  its batch sibling
  [BatchAddSessionQuestionAnswersHandler](group-18-conference-application.md#batchaddsessionquestionanswershandler)
  (the import path, which writes many answers per session in one command) and
  [SessionQuestionAnswersController](group-20-conference-api-grpc.md#sessionquestionanswerscontroller).

### SessionSpeakerDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/SessionSpeakerDTO.cs:8` · Level 1 · record

- **What it is**: the DTO for one row of the many-to-many join between a session and a speaker.
- **Depends on**: [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)
  (`SessionSpeakerDTO.cs:1,8`); the `SessionSpeakerIdentifierType`, `SessionIdentifierType` and
  `SpeakerIdentifierType` aliases.
- **Concept**: identical in shape to [SessionCategoryItemDTO](#sessioncategoryitemdto), the canonical
  two-FK join-row DTO. Both carry their own `Id` plus the two association foreign keys and nothing
  else.
- **Walkthrough**: a `record class` implementing
  [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) with three
  `required init` members (`SessionSpeakerDTO.cs:11-17`): `Id` (join row key), `SessionId` (FK to the
  parent session) and `SpeakerId` (FK to the [Speaker](#speaker)). The three join DTOs in this Sessions
  folder form a near-identical family, an `{Id, parent FK, target FK}` triple per join table, with one
  of them adding a payload field:

  | Type | File:Line | Notes (what differs) |
  |------|-----------|----------------------|
  | `SessionSpeakerDTO` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/SessionSpeakerDTO.cs:8` | Target FK is `SpeakerId` (`:17`). |
  | `SessionCategoryItemDTO` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/SessionCategoryItemDTO.cs:8` | Target FK is `CategoryItemId` (`:17`). |
  | `SessionQuestionAnswerDTO` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/SessionQuestionAnswerDTO.cs:9` | Target FK is `QuestionId` (`:18`), plus a required `AnswerValue` string (`:21`). |

- **Why it's built this way**: giving each join its own surface DTO, rather than exposing a raw
  composite key, keeps the child collections on [SessionDTO](#sessiondto) addressable row by row and
  lets the contract stay independent of the EF link entities
  ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)).
- **Where it's used**: nested as `SessionSpeakers` on [SessionDTO](#sessiondto) (`SessionDTO.cs:93`);
  produced by [SessionDTOMapper](group-18-conference-application.md#sessiondtomapper) and navigation
  populators ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)); written by
  [AddSessionSpeakerHandler](group-18-conference-application.md#addsessionspeakerhandler) and exposed by
  [SessionSpeakersController](group-20-conference-api-grpc.md#sessionspeakerscontroller). Because the
  collection defaults to empty (see [SessionDTO](#sessiondto)), a list query whose populator does not
  include this navigation returns sessions with no speakers rather than an error, so this is the
  collection to check first when a session list renders without speaker names.

### SessionDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/SessionDTO.cs:15` · Level 2 · record

- **What it is**: the full read-side contract for a conference session: the field-length constants, the
  scalar fields (title, schedule, status flags, media URLs), the foreign keys to event and room, and
  the three child collections (speakers, question answers, category items).
- **Depends on**: [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)
  and [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware), the two contracts it
  implements (`SessionDTO.cs:1,15`); its three child DTOs [SessionSpeakerDTO](#sessionspeakerdto),
  [SessionQuestionAnswerDTO](#sessionquestionanswerdto) and
  [SessionCategoryItemDTO](#sessioncategoryitemdto); the `SessionIdentifierType`,
  `EventIdentifierType` and `RoomIdentifierType` aliases.
- **Concept introduced, the DTO as the single source of the field caps.** `[Rubric §16,
  Maintainability]` (assesses whether one fact lives in one place). The seven `const int` caps at the
  top of this type (`SessionDTO.cs:18-36`) are the only declaration of the session field lengths in the
  system: `TitleMaxLength` 500, `DescriptionMaxLength` 4000, `StatusMaxLength` 100,
  `AccessibilityInfoMaxLength` 500, `ResourceLinksMaxLength` 2000, `LiveUrlMaxLength` 2000,
  `RecordingUrlMaxLength` 2000. The doc comment explains the placement (`SessionDTO.cs:8-13`): `Shared`
  is the lowest layer that Domain, Infrastructure and UI can all reach, so the caps sit here and every
  other layer consumes them. [SessionInvariants](#sessioninvariants) re-exports them as its own
  constants (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionInvariants.cs:16,19,22,31`),
  which is what the domain guards, the EF configuration and the validators then read, while the UI form
  binds them straight off this type
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Session/SessionFormModel.cs:38,42,46`).
  One edit here moves the database column, the domain guard and the client-side `MaxLength` together.
- **Concept, the concurrency-aware read contract.** `[Rubric §9, API & Contract Design]` and `[Rubric
  §8, Data Architecture]`. Beyond `IBaseDTO`'s `Id`, this DTO implements
  [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware), so it round-trips the EF
  `RowVersion` token (`SessionDTO.cs:42`). The API renders that token as the response `ETag`, and a
  client echoes it in `If-Match` on its next write; a write that states no precondition is refused with
  `428 Precondition Required` rather than falling back to last-write-wins (the contract's own remarks,
  `MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IConcurrencyAware.cs:9-14`). The `CA1819`
  ("properties should not return arrays") waiver lives once on the interface member in MMCA.Common
  (`IConcurrencyAware.cs:18`), not on each implementing DTO.
- **Walkthrough**
  - Field caps (`SessionDTO.cs:18-36`): the seven `const int` values described above.
  - Identity and concurrency: `Id` (`SessionDTO.cs:39`) and `RowVersion`, a non-nullable `byte[]`
    defaulting to the empty collection literal `[]` (`SessionDTO.cs:42`), satisfy the two implemented
    contracts.
  - Scalars (`SessionDTO.cs:45-84`): a `required Title`, an optional `Description`, an optional
    `StartsAt`/`EndsAt` pair, a free-text `Status` (Accepted, Declined, Waitlisted, Nominated), four
    `bool` flags (`IsInformed`, `IsConfirmed`, `IsServiceSession`, `IsPlenumSession`, `SessionDTO.cs:60-69`),
    two URL strings kept as `string` (`LiveUrl`, `RecordingUrl`, `SessionDTO.cs:72,75`), plus
    `AccessibilityInfo`, `ResourceLinks` and a nullable `Duration` in minutes.
  - Foreign keys: a `required EventId` (`SessionDTO.cs:87`, every session belongs to an event) and an
    optional `RoomId` (`SessionDTO.cs:90`, a session may not yet be placed in a room).
  - Child collections (`SessionDTO.cs:93-99`): `SessionSpeakers`, `SessionQuestionAnswers` and
    `SessionCategoryItems`, each an `IReadOnlyCollection<...>` defaulted to `[]`.
- **Why it's built this way**: defaulting each child collection to `[]` means a query that does not run
  the matching populator returns an empty collection instead of a null reference, so callers never
  null-check a navigation. The trade-off is that "not populated" and "genuinely empty" are
  indistinguishable on the wire, which is why a missing populator shows up as absent data rather than as
  an error. Manual DTO shaping ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html))
  keeps the contract explicit; navigation populators ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html))
  fill the child collections per query.
- **Where it's used**: mapped from the [Session](#session) aggregate by
  [SessionDTOMapper](group-18-conference-application.md#sessiondtomapper), returned by the session read
  endpoints on [SessionsController](group-20-conference-api-grpc.md#sessionscontroller), and consumed by
  the Conference UI session pages through
  [SessionFormModel](group-21-conference-ui.md#sessionformmodel).
- **Caveats / not-in-source**: `Status` is a free-text `string`, not a closed enum, and this DTO does
  not itself constrain the allowed values; the eligibility rule lives in
  [SessionInvariants](#sessioninvariants) (`SessionInvariants.EnsureStatusIsEligible`).

### ISessionBookmarkValidationService
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/ISessionBookmarkValidationService.cs:11` · Level 3 · interface

- **What it is**: the cross-module service contract the Engagement module calls to check whether a
  session may be bookmarked, and to list a given event's session ids, without referencing Conference
  domain entities directly.
- **Depends on**: [Result](group-01-result-error-handling.md#result) and
  [ServiceContractAttribute](group-13-grpc-contracts.md#servicecontractattribute), both from
  `MMCA.Common.Shared.Abstractions` (`ISessionBookmarkValidationService.cs:1,10`); the
  `SessionIdentifierType` and `EventIdentifierType` aliases.
- **Concept introduced, the cross-module boundary interface.** `[Rubric §7, Microservices Readiness]`
  (assesses whether module coupling flows through an abstraction that can be re-satisfied over a wire
  once the modules split into separate services). The doc comment states the arrangement
  (`ISessionBookmarkValidationService.cs:5-9`): the interface is **declared in the owning module's
  `Shared` project** and **implemented in Conference.Application**, so Engagement depends only on the
  abstraction. When both modules run in one process, DI binds the real implementation; when Engagement
  runs as its own service, the same interface is satisfied by a gRPC adapter or by
  [DisabledSessionBookmarkValidationService](#disabledsessionbookmarkvalidationservice).
- **Concept, the `[ServiceContract]` marker.** `[Rubric §34, Architecture Governance & Documentation]`.
  The attribute on line 10 is not runtime behavior: it marks this interface as part of a published wire
  surface, and the `ServiceContractPurityTestsBase` fitness rule scans every mapped assembly for types
  carrying it and fails the build if a contract type reaches back into the producing service's Domain,
  Application or Infrastructure layer
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ServiceContractAttribute.cs:3-12`). The
  marker is what turns "please keep this interface pure" into an enforced rule
  ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)).
- **Walkthrough**: two async members, both taking `CancellationToken` as the final parameter per the
  codebase convention.
  - `ValidateSessionForBookmarkAsync(SessionIdentifierType, CancellationToken)`
    (`ISessionBookmarkValidationService.cs:20`) returns `Task<Result>` and, per its doc comment
    (`ISessionBookmarkValidationService.cs:13-16`), checks that the session exists, is not a service
    session (BR-91) and has an eligible status (BR-49). The in-process implementation delegates both
    checks to [SessionInvariants](#sessioninvariants)
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/SessionBookmarkValidationService.cs:33,38`),
    so the module boundary and the aggregate enforce the same rule text.
  - `GetSessionIdsByEventAsync(EventIdentifierType, CancellationToken)`
    (`ISessionBookmarkValidationService.cs:31`) returns
    `Task<Result<IReadOnlyCollection<SessionIdentifierType>>>`: the ids of every session in an event,
    used by Engagement for event-scoped bookmark filtering (BR-58). Note that the collection is wrapped
    in a `Result`, which the doc comment justifies (`ISessionBookmarkValidationService.cs:28-30`): once
    this call can cross a gRPC boundary, "Conference is unreachable" is a distinct outcome from "this
    event has no sessions", and an empty list must not silently stand in for an outage.
- **Why it's built this way**: returning [Result](group-01-result-error-handling.md#result) instead of
  throwing lets Engagement fold a validation failure into its own command result; keeping the interface
  in `Shared` (not `Application`) is what allows a gRPC adapter or the disabled stub to be substituted
  without Engagement ever seeing Conference internals
  ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) gRPC extraction,
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) service
  topology).
- **Where it's used**: injected into Engagement's
  [CreateBookmarkHandler](group-22-engagement-module.md#createbookmarkhandler) and
  [GetUserBookmarksHandler](group-22-engagement-module.md#getuserbookmarkshandler). Three
  implementations satisfy it depending on topology: the in-process
  [SessionBookmarkValidationService](group-18-conference-application.md#sessionbookmarkvalidationservice),
  the wire-crossing
  [SessionBookmarkValidationServiceGrpcAdapter](group-20-conference-api-grpc.md#sessionbookmarkvalidationservicegrpcadapter),
  and [DisabledSessionBookmarkValidationService](#disabledsessionbookmarkvalidationservice). The
  Conference service exposes the server side of it over gRPC in `SessionBookmarksGrpcService`.

### DisabledSessionBookmarkValidationService
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/DisabledSessionBookmarkValidationService.cs:30` · Level 4 · class (internal sealed)

- **What it is**: the no-op stub of
  [ISessionBookmarkValidationService](#isessionbookmarkvalidationservice), registered when the
  Conference module is present in a host but disabled. It approves every validation and reports no
  sessions per event.
- **Depends on**: [ISessionBookmarkValidationService](#isessionbookmarkvalidationservice) (the
  interface it implements) and [Result](group-01-result-error-handling.md#result) from
  `MMCA.Common.Shared.Abstractions` (`DisabledSessionBookmarkValidationService.cs:1`).
- **Concept introduced, the disabled-module stub.** `[Rubric §7, Microservices Readiness]` (assesses
  graceful degradation when an owning module is out of process) and `[Rubric §34, Architecture
  Governance & Documentation]` (degradation is a named, greppable type rather than a missing DI
  binding). The doc comment spells out the trade-off
  (`DisabledSessionBookmarkValidationService.cs:5-28`): `ValidateSessionForBookmarkAsync` returns
  success so Engagement's bookmark handlers still complete, **at the cost of skipping the BR-49/BR-91
  eligibility checks**, with the real validation happening at the Conference service when bookmark
  events flow through the broker. It also records the codebase-wide convention that each owning
  module's `*.Shared` project ships a `Disabled*Service` stub for the cross-module interfaces it
  exposes: its own file-neighbour
  [DisabledEventLiveValidationService](#disabledeventlivevalidationservice), plus
  `DisabledBookmarkCountService` in Engagement and `DisabledAttendeeQueryService` in Identity.
- **Concept, `internal` plus `InternalsVisibleTo` as the registration boundary.** The class is
  `internal sealed` (`DisabledSessionBookmarkValidationService.cs:30`), and the only non-test assembly
  allowed to see it is the module's own API project
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.Shared.csproj:4`).
  No host can new it up or register it by hand: the stub reaches the container exactly one way, through
  [ConferenceModule](group-20-conference-api-grpc.md#conferencemodule)`.RegisterDisabledStubs`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:21-25`), which
  [IModule](group-14-module-system-composition.md#imodule) declares as an opt-in default no-op
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModule.cs:34`) and `ModuleLoader` invokes
  for a disabled module (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:108`).
- **Walkthrough**: two one-line members, both returning already-completed tasks.
  - `ValidateSessionForBookmarkAsync(...)` (`DisabledSessionBookmarkValidationService.cs:33-34`) returns
    `Task.FromResult(Result.Success())`, approving unconditionally.
  - `GetSessionIdsByEventAsync(...)` (`DisabledSessionBookmarkValidationService.cs:37-38`) returns
    `Task.FromResult(Result.Success<IReadOnlyCollection<SessionIdentifierType>>([]))`, a **successful**
    empty collection, so an event-filtered bookmark query degrades to "no bookmarks for this event"
    rather than throwing or reporting an outage.
- **Why it's built this way**: `Task.FromResult` avoids allocating an async state machine on a path that
  can run per request, and the collection literal `[]` gives a benign empty answer. Making degradation
  explicit and named, rather than leaving the interface unbound and letting DI throw at resolution
  time, is the governance point
  ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) service
  topology).
- **Where it's used**: registered as a singleton by `ConferenceModule.RegisterDisabledStubs`
  (`ConferenceModule.cs:23`) alongside the `IEventLiveValidationService` stub. In the deployed
  split-service topology it is a fallback that gets overwritten: the extracted Engagement service calls
  `AddConferenceSessionValidationClient`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:280`), and that registration uses
  `ServiceCollectionDescriptorExtensions.Replace` so the resolved
  [ISessionBookmarkValidationService](#isessionbookmarkvalidationservice) is the gRPC adapter, whether
  the prior binding was the real in-process service or this stub
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/DependencyInjection.cs:26-33`). The stub is
  therefore the safety net for a host that loads Conference-disabled and wires no gRPC client, not the
  path the ADC deployment takes.
- **Caveats / not-in-source**: the class doc comment describes the gRPC route as "a future
  `MMCA.ADC.Conference.Contracts` package" (`DisabledSessionBookmarkValidationService.cs:14-15`), and
  the Engagement service's header comment says this host registers the stub manually
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:14-18`). Both comments trail the
  code: the `MMCA.ADC.Conference.Contracts` project and its adapter exist, and the Engagement service
  registers the gRPC client. Trust the registrations cited above over those two comments.

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

- **What it is**: the request body a client sends to manually bind an Identity user to a
  [`Speaker`](#speaker) (BR-209, `LinkUserRequest.cs:4`). It carries exactly one field, the `UserId` to
  link.
- **Depends on**: nothing first-party. Its one member is typed over the `UserIdentifierType` alias,
  which is `int` and is authored in the *Identity* module
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/MMCA.ADC.Identity.GlobalUsings.IdentifierType.cs:2`)
  yet compiled into every other project by a linked `<Compile Include>` in
  `MMCA.ADC/Directory.Build.props:94-95`. That is how a Conference contract can name an Identity id
  without referencing the Identity assembly (see the [primer](00-primer.md) on identifier-type aliases).
- **Concept introduced, the request record (API input contract).** `[Rubric §9, API & Contract Design]`
  (assesses whether inbound payloads are declared as explicit, typed contracts rather than loose
  parameters) and `[Rubric §7, Microservices Readiness]` (the contract lives in `Shared`, the project a
  caller can reference without pulling in Conference's Domain). Where the DTOs below are *outbound* read
  shapes, this is an *inbound* write shape: a `sealed record` with a single `required init` `UserId`
  (`LinkUserRequest.cs:9`). `required` means the model binder cannot leave it unset, and `init` makes it
  immutable once bound, so a controller receives a read-only value rather than a mutable bag. The type is
  deliberately tiny: it exists so the link endpoint has a named, versionable body instead of a bare
  route or query scalar.
- **Walkthrough**: one member, `UserId` (`LinkUserRequest.cs:9`), the Identity-side id to attach to the
  speaker. There is no `SpeakerId` on the body: that comes from the route (the speaker being edited).
- **Why it's built this way**: strongly typing the body over the `UserIdentifierType` alias keeps "who"
  named end to end, and placing it in `Shared` lets the UI and any future extracted client bind the same
  contract without a Domain reference.
- **Where it's used**: bound by `SpeakersController.LinkUserAsync`, a `PUT /Speakers/{id}/link` gated by
  `[HasPermission(ConferencePermissions.SpeakersManage)]`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:373-390`),
  which forwards `request.UserId` into the
  [`LinkUserToSpeakerCommand`](group-18-conference-application.md#linkusertospeakercommand)
  (`SpeakersController.cs:382`), then evicts the `conference:speakers` output-cache tags and answers
  `204 No Content` (`SpeakersController.cs:388-389`). The command's handler enforces BR-208 first (no
  other speaker may already hold that `LinkedUserId`, otherwise a `Speaker.UserAlreadyLinked` invariant
  failure comes back) and only then links and raises
  [`SpeakerLinkedToUser`](#speakerlinkedtouser) on the aggregate *before* the save
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/LinkUser/LinkUserToSpeakerHandler.cs:42-55,57-64`),
  so the outbox row lands in the same transaction as the link itself, which is exactly what the
  handler's own comment records (ADR-003, `LinkUserToSpeakerHandler.cs:60-62`).

---

### RatingQuestionSummary
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SessionFeedbackDTO.cs:22` · Level 0 · record (sealed)

- **What it is**: one row of a session's aggregated *rating* feedback, the per-question roll-up of a
  numeric rating: the question, its average score, and how many responses fed that average. It is a
  child component of [`SessionFeedbackDTO`](#sessionfeedbackdto).
- **Depends on**: nothing first-party (uses the `QuestionIdentifierType` alias, `int`); BCL only.
- **Concept introduced, the hand-built query-projection record.** `[Rubric §6, CQRS & Event-Driven]`
  (assesses read models shaped for the query, not the table) and `[Rubric §9, API & Contract Design]`.
  Unlike the entity DTOs later in this part, this record does **not** implement
  [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) and is **not**
  produced by a Mapperly mapper: it is a bespoke aggregation shape assembled by a query handler from a
  group-by over answers. It exists purely as the wire shape of a computed report.
- **Walkthrough**: four `required init` members (`SessionFeedbackDTO.cs:25-34`), `QuestionId`,
  `QuestionText` (so the client renders a label without a second lookup), `AverageRating` (a `double`,
  the computed mean), and `ResponseCount` (the sample size behind that mean). The mean is computed in
  memory over the answers that parse as integers under `CultureInfo.InvariantCulture`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionFeedback/GetSessionFeedbackHandler.cs:75-88`),
  so `ResponseCount` counts *parseable* ratings, not raw answer rows.
- **Why it's built this way**: carrying `QuestionText` and `ResponseCount` alongside the average makes
  the record self-describing, so a UI can show "4.6 (from 32 responses)" straight from the payload.
- **Where it's used**: nested in [`SessionFeedbackDTO.Ratings`](#sessionfeedbackdto); built by
  [`GetSessionFeedbackHandler`](group-18-conference-application.md#getsessionfeedbackhandler).
- **Caveats / not-in-source**: a rating question whose answers are all unparseable produces **no**
  summary row at all rather than a zero-count one, because the handler only adds the record when at
  least one value parsed (`GetSessionFeedbackHandler.cs:81-90`). A consumer therefore cannot tell
  "nobody rated it" from "the question was never asked" out of this payload alone.

---

### SponsorTier
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sponsors/SponsorTier.cs:12` · Level 0 · enum

- **What it is**: the sponsorship package a conference sponsor bought, from `Platinum` down to
  `Community`. It is the one enum in the Sponsors contract and it drives where a sponsor appears in the
  public sponsor strip.
- **Depends on**: nothing. Four named `int` members, no attributes, no BCL types beyond the enum itself.
- **Concept introduced, the ordinal-as-ordering enum.** `[Rubric §9, API & Contract Design]` (assesses
  whether a contract's vocabulary is closed and explicit rather than a loose string) and `[Rubric §16,
  Maintainability]`. Two conventions are visible in the declaration and both are load-bearing:
  1. **The numeric values are the display order**, stated in the type's own doc comment
     (`SponsorTier.cs:4-6`): `Platinum = 0`, `Gold = 1`, `Silver = 2`, `Community = 3`
     (`SponsorTier.cs:15-24`). A plain ascending sort therefore renders the largest package first with no
     lookup table, and [`PublicSponsorList`](group-21-conference-ui.md#publicsponsorlist) relies on
     exactly that: it groups by `Tier` and calls `.OrderBy(g => g.Key)`
     (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSponsorList.razor.cs:87-91`),
     breaking ties inside a tier by `Sort` then `Name`. Renumbering a member would silently reorder the
     public page.
  2. **It is zero-based** because CA1008 requires a zero member (`SponsorTier.cs:9-11`), which has the
     side effect that an omitted tier defaults to the *top* package rather than to an "unknown" bucket.
     The type's remarks call this out rather than leaving it as an accident.

  Contrast this with the loose status strings elsewhere in the Conference contract (for example
  [`SessionDTO`](#sessiondto)`.Status`, a nullable `string` carrying Sessionize's vocabulary as free
  text and bounded only by a length cap,
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/SessionDTO.cs:24,57`): tiers
  are sold by ADC itself, so the set is closed and can be an enum.
- **Walkthrough**: four members with explicit values (`SponsorTier.cs:15-24`). There is no `None`,
  `Unknown`, or `[Flags]` member: a sponsor always has exactly one package.
- **Why it's built this way**: encoding package rank in the ordinal keeps ordering logic out of the UI
  and out of SQL; the explicit values (rather than implicit ones) make the ordering contract visible in
  the source so a future insertion has to be a deliberate decision.
- **Where it's used**: the [`Sponsor`](#sponsor) aggregate stores it
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sponsors/Sponsor.cs:24`) and takes it
  on create and update (`Sponsor.cs:65,108,155`); it crosses the API boundary on
  [`SponsorDTO.Tier`](#sponsordto) and on
  [`SponsorCreateRequest`](group-18-conference-application.md#sponsorcreaterequest) /
  [`SponsorUpdateRequest`](group-18-conference-application.md#sponsorupdaterequest); the UI keys its
  grouped view model on it (`PublicSponsorList.razor.cs:40`) and renders the label through a localized
  resource key, `L[$"Tier.{tier}"]` (`PublicSponsorList.razor.cs:43`), which is `[Rubric §27, i18n]` in
  miniature: the enum member name is the resource key, so the label translates without a switch
  statement.

---

### TextQuestionResponses
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SessionFeedbackDTO.cs:38` · Level 0 · record (sealed)

- **What it is**: the free-text counterpart to [`RatingQuestionSummary`](#ratingquestionsummary): all the
  individual text answers given to one non-rating feedback question, grouped under that question. Also a
  child component of [`SessionFeedbackDTO`](#sessionfeedbackdto).
- **Depends on**: nothing first-party (uses the `QuestionIdentifierType` alias); BCL only.
- **Concept**: the hand-built query-projection record (see
  [`RatingQuestionSummary`](#ratingquestionsummary)). Where a rating collapses to a mean, text answers
  cannot be averaged, so they are grouped verbatim.
- **Walkthrough**: three `required init` members (`SessionFeedbackDTO.cs:41-47`), `QuestionId`,
  `QuestionText`, and `Responses` (an `IReadOnlyList<string>`, the raw text answers). Exposing the list
  as `IReadOnlyList<string>` signals the payload is a read-only snapshot. Which questions land here is
  decided by elimination: the handler routes a question to `Ratings` only when its `QuestionType` is the
  literal `"Rating"`, and everything else falls into this record
  (`GetSessionFeedbackHandler.cs:73,92-100`).
- **Why it's built this way**: grouping by question (rather than returning a flat answer list) lets the
  speaker dashboard render one comment block per prompt without regrouping client-side.
- **Where it's used**: nested in [`SessionFeedbackDTO.TextResponses`](#sessionfeedbackdto); built by
  [`GetSessionFeedbackHandler`](group-18-conference-application.md#getsessionfeedbackhandler).

---

### ActivityDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Activities` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Activities/ActivityDTO.cs:15` · Level 1 · record (class)

- **What it is**: the read-model shape of an [`Activity`](#activity), a conference social or networking
  slot (a party, a coffee connect, an after-party, the closing ceremony). It carries the name and blurb,
  the event-local start and end times, an optional off-site venue, a display tie-breaker, and the FK to
  its owning event, plus the field-length constants every other layer reads.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype),
  [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) (both from
  `MMCA.Common.Shared.DTOs`, `ActivityDTO.cs:1,15`); the aliases `ActivityIdentifierType` and
  `EventIdentifierType` (both `int`,
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:5,8`).
- **Concept introduced, the DTO as the single source of field lengths.** `[Rubric §16, Maintainability]`
  (assesses whether a rule is declared once and consumed everywhere, or copied) and `[Rubric §24,
  Forms/Validation/UX Safety]`. Five `const int` caps sit at the top of this record
  (`ActivityDTO.cs:17-30`), and the type's own doc comment states why they live *here* rather than in the
  domain (`ActivityDTO.cs:9-13`): `Shared` is the lowest project every other layer can reference, so one
  declaration reaches all of them. Follow the chain:
  `ActivityInvariants.NameMaxLength = ActivityDTO.NameMaxLength`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Activities/ActivityInvariants.cs:15-22`)
  gives the domain check and, through it, the EF `HasMaxLength` configuration; the Blazor form binds the
  same constant to both the input cap and the character counter
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activity/ActivityFormFields.razor:21`)
  and to its `[MaxLength]` data annotation
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activity/ActivityFormModel.cs:36`).
  A cap can therefore never disagree between the counter a user sees, the invariant that rejects, and the
  column that truncates.
- **Concept, the event-local wall-clock DTO.** `[Rubric §8, Data Architecture]` (assesses how time and
  ownership are modelled at the storage boundary). `StartTime` and `EndTime` are plain `DateTime`, not
  `DateTimeOffset`, because the entity stores them as wall-clock values in the owning event's IANA time
  zone and the zone lives once on the event rather than repeated per row
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Activities/Activity.cs:28-36`). The DTO
  faithfully carries that decision instead of quietly converting: a consumer that needs an absolute
  instant has to combine the value with the event's zone, and the public page simply formats it as-is
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicActivityList.razor.cs:43`).
- **Walkthrough**: five constants (`ActivityDTO.cs:17-30`) then eleven properties
  (`ActivityDTO.cs:33-63`). `Id` and `RowVersion` are the two framework contracts (lines 33 and 36; the
  token defaults to an empty array rather than being nullable, see [`QuestionDTO`](#questiondto)). `Name`
  is the only `required` content field (line 39); `Description` (line 42) is optional. `StartTime` and
  `EndTime` (lines 45-48) are the event-local programme window. The three venue fields `VenueName`,
  `VenueAddress`, and `VenueUrl` (lines 51-57) are all optional and model the *off-site* case only: an
  empty `VenueName` means the activity happens at the main conference venue, so the public page renders
  a localized "main venue" label instead of a gap
  (`Activity.cs:38-42`,
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicActivityList.razor:47`),
  and `VenueAddress` is what the "directions" affordance hands to a maps URL, labelled with the venue
  name or the activity name when there is none (`PublicActivityList.razor.cs:105-113`). `SortOrder`
  (line 60) breaks
  ties between activities that start at the same minute. `EventId` (line 63) scopes the activity to
  exactly one event. Note what is absent: the entity's `[Navigation] Event?` reference
  (`Activity.cs:56-58`) is *not* projected, so an activity response never drags an event graph along with
  it; and there is no room and no speaker collection, because an activity is deliberately neither a
  session nor a talk.
- **Why it's built this way**: activities are ADC's own content rather than a Sessionize import, so the
  contract is small and mostly optional: an organizer can publish "After party" the moment it is
  scheduled and fill in the venue later. Naming the tie-breaker `SortOrder` (where
  [`SponsorDTO`](#sponsordto) uses `Sort`) mirrors the underlying entity property in each case rather
  than imposing a synthetic house name on the wire.
- **Where it's used**: produced by
  [`ActivityDTOMapper`](group-18-conference-application.md#activitydtomapper), a `[Mapper] partial class`
  whose doc comment records that nothing is redacted because activity data is published to attendees by
  design
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Activities/DTOs/ActivityDTOMapper.cs:9-17`);
  projected by the
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  injected into [`ActivitiesController`](group-20-conference-api-grpc.md#activitiescontroller)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ActivitiesController.cs:40`),
  whose anonymous reads are narrowed for non-privileged callers by one overridden read hook,
  `GetReadSpecificationAsync`, so an excluded activity is a 404 rather than a redacted record
  (`ActivitiesController.cs:60-78,80-81`); rendered by
  [`PublicActivityList`](group-21-conference-ui.md#publicactivitylist), which orders by `StartTime` then
  `SortOrder` (`PublicActivityList.razor.cs:87-88`), and by the organizer-facing
  [`ActivityList`](group-21-conference-ui.md#activitylist); written through
  [`ActivityCreateRequest`](group-18-conference-application.md#activitycreaterequest) and
  [`ActivityUpdateRequest`](group-18-conference-application.md#activityupdaterequest).

---

### CategoryItemDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Categories/CategoryItemDTO.cs:13` · Level 1 · record (class)

- **What it is**: the read-model shape of a [`CategoryItem`](#categoryitem), one selectable option (for
  example "Beginner" or "Advanced" inside a "Level" category). Carries the item id, display name, sort
  order, and the FK to its parent [`ConferenceCategoryDTO`](#conferencecategorydto).
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)
  (from `MMCA.Common.Shared.DTOs`, `CategoryItemDTO.cs:1,13`); the aliases `CategoryItemIdentifierType`
  and `ConferenceCategoryIdentifierType` (both `int`).
- **Concept introduced, the entity read DTO (mapped by Mapperly).** `[Rubric §4, DDD]` and `[Rubric §3,
  Clean Architecture]` (the read model is separate from the domain entity, so the API surface never leaks
  the aggregate), `[Rubric §9, API & Contract Design]` (a typed, versionable response shape), and
  `[Rubric §7, Microservices Readiness]` (it lives in `Shared`, referenceable without Domain). Every
  Conference entity has a companion DTO built to the same two rules:
  1. **It implements [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype)**,
     the framework's minimal read-model contract: a single `required init Id` of the entity's id alias
     (`CategoryItemDTO.cs:19`, contract at
     `MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IBaseDTO.cs:9-13`). That is the hook the generic
     query services and controller base classes key on.
  2. **It is populated by a Mapperly-generated mapper, not by hand.** The companion
     [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype)
     implementation
     (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/DTOs/CategoryItemDTOMapper.cs:11-13`)
     is a `[Mapper] partial class` declaring `public partial CategoryItemDTO MapToDTO(CategoryItem entity);`
     with no body (`CategoryItemDTOMapper.cs:16`), so the source generator writes the field-by-field copy
     at compile time ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)): no
     reflection cost, and a shape mismatch is a build error rather than a runtime surprise. The
     collection overload is the one hand-written member, a null-guarded `Select` over the single map
     (`CategoryItemDTOMapper.cs:19-23`).
- **Walkthrough**: one constant and four properties (`CategoryItemDTO.cs:16-28`). `NameMaxLength = 500`
  (line 16) is the shared cap [`CategoryInvariants`](#categoryinvariants) reads back as
  `CategoryItemNameMaxLength`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/CategoryInvariants.cs:23-24`),
  the same single-declaration chain [`ActivityDTO`](#activitydto) introduces. Then `Id` (the `IBaseDTO`
  contract, line 19), the `required` `Name` (line 22), a plain `Sort` (`int`, display order, line 25),
  and the `required` `CategoryId` FK back to the parent category (line 28). `Sort` is not `required`, so
  it defaults to 0 and an item without an explicit order sorts first. Note what is absent: no
  `RowVersion`, because a category item is a child entity
  ([`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype),
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/CategoryItem.cs:14`) edited
  through its parent [`Category`](#category) aggregate root, which is where the concurrency token lives.
- **Why it's built this way**: keeping the DTO a flat record with `init`-only members makes it an
  immutable snapshot the query pipeline can project, serialize, and cache without defensive copying;
  Mapperly keeps the entity to DTO copy allocation-light and drift-proof.
- **Where it's used**: nested inside [`ConferenceCategoryDTO.CategoryItems`](#conferencecategorydto), and
  referenced by id from [`SpeakerCategoryItemDTO`](#speakercategoryitemdto) and the session tagging
  DTOs; projected by an
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  and returned by [`ConferenceCategoriesController`](group-20-conference-api-grpc.md#conferencecategoriescontroller).

---

### QuestionDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Questions/QuestionDTO.cs:14` · Level 1 · record (class)

- **What it is**: the read-model shape of a [`Question`](#question), a configurable prompt (for example
  "Dietary requirements" or "T-shirt size") that events, sessions, or speakers can be asked to answer.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype),
  [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) (both from
  `MMCA.Common.Shared.DTOs`, `QuestionDTO.cs:1,14`); the alias `QuestionIdentifierType`.
- **Concept introduced, the concurrency-aware DTO (the ETag carrier).** `[Rubric §8, Data Architecture]`
  (assesses whether optimistic concurrency is carried end to end rather than resolved last-write-wins)
  and `[Rubric §9, API & Contract Design]`. On top of the entity-DTO pattern from
  [`CategoryItemDTO`](#categoryitemdto), this DTO implements
  [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware), contributing one member:
  `byte[] RowVersion` (`QuestionDTO.cs:32`), the SQL Server `rowversion` token of the version the client
  just read. Three details are worth reading straight off the interface
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IConcurrencyAware.cs:15-19`):
  1. **The token travels as an HTTP entity tag, not as a body field on the way back.** The API renders it
     as the response `ETag`, and the client echoes it in `If-Match` on its next write, where
     [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute) turns it into
     the original `RowVersion` the persistence layer compares against (`IConcurrencyAware.cs:3-8`;
     ADR-035). [`ConcurrencyETag`](group-08-auth.md#concurrencyetag) is the translator both ends share,
     and it always emits a *weak* tag, `W/"<base64>"`, because the same row version renders differently
     under a `fields=` projection
     (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ConcurrencyETag.cs:13-21,27-30,40-45`).
  2. **It is not optional.** `RowVersion` is a non-nullable `byte[]` defaulted to `[]`, and the
     interface's remarks state the rule: a DTO read from a persisted aggregate always has a token, and a
     write that states no precondition is refused with `428 Precondition Required` rather than falling
     back to last-write-wins (`IConcurrencyAware.cs:9-13`). Update *requests* carry no token at all: the
     precondition travels in the header alone.
  3. **The CA1819 suppression** that lets a property return `byte[]` is declared once on the interface
     member (`IConcurrencyAware.cs:18`), not repeated on each DTO, so implementing types stay clean.
- **Walkthrough**: four constants then eight properties (`QuestionDTO.cs:17-50`). The constants
  (`QuestionTextMaxLength = 1000` and three 20-character descriptors, lines 17-26) are the caps
  [`QuestionInvariants`](#questioninvariants) reads back
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/QuestionInvariants.cs:15-22`).
  Then `Id` + `RowVersion` (the two contracts, lines 29 and 32), the `required` `QuestionText` (line 35),
  and the optional descriptors `QuestionEntity` ("session" or "speaker"), `QuestionType` ("text" or
  "select"), `Sort`, `IsRequired`, and `QuestionSource` ("Sessionize" or "User", recording whether the
  question was imported or added in-app) at lines 38-50. The descriptors are plain nullable strings, not
  enums: they arrive from Sessionize and the vocabulary is not ADC's to close.
- **Why it's built this way**: carrying `RowVersion` on the DTO lets the API stamp an `ETag` on the read
  and the edit form send back the exact version it saw, so the concurrency check happens at the
  persistence boundary without the client tracking version state itself; the optional descriptors keep
  one DTO usable for every question flavor.
- **Where it's used**: mapped by
  [`QuestionDTOMapper`](group-18-conference-application.md#questiondtomapper)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/DTOs/QuestionDTOMapper.cs:11-16`);
  returned by [`QuestionsController`](group-20-conference-api-grpc.md#questionscontroller)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/QuestionsController.cs:35`)
  and consumed by the answer-collection UI. `QuestionType` is also the switch
  [`GetSessionFeedbackHandler`](group-18-conference-application.md#getsessionfeedbackhandler) reads when
  it splits feedback into ratings and text (`GetSessionFeedbackHandler.cs:73`).

---

### SessionFeedbackDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SessionFeedbackDTO.cs:6` · Level 1 · record (sealed)

- **What it is**: the aggregated feedback report for a single session (BR-210, `SessionFeedbackDTO.cs:4`):
  the session identity plus two grouped result sets, numeric ratings and free-text responses.
- **Depends on**: [`RatingQuestionSummary`](#ratingquestionsummary),
  [`TextQuestionResponses`](#textquestionresponses); the aliases `SessionIdentifierType` and
  `QuestionIdentifierType` (both `int`).
- **Concept, the composed query-projection report.** `[Rubric §6, CQRS & Event-Driven]` (a read model
  purpose-built for one query rather than a mapped entity) and `[Rubric §12, Performance & Scalability]`.
  This is the parent that composes the two Level-0 records above. It does **not** implement
  [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype): it is not a
  CRUD read model but a computed report, so it is assembled by a handler rather than a Mapperly mapper.
- **Walkthrough**: four `required init` members (`SessionFeedbackDTO.cs:9-18`), `SessionId` and
  `SessionTitle` (the report header), `Ratings` (an `IReadOnlyList<RatingQuestionSummary>`, one entry per
  rating question) and `TextResponses` (an `IReadOnlyList<TextQuestionResponses>`, one entry per
  non-rating question). Splitting ratings from text mirrors the two answer kinds a session collects. The
  producing handler shows how the shape is filled and where it refuses: it loads the session with its
  `SessionSpeakers` and `SessionQuestionAnswers` untracked, returns `NotFound` when the session is gone,
  returns a `Forbidden` error coded `Speaker.NotAssigned` if the requested speaker is not assigned to
  that session, returns an empty-but-valid report when there are no answers, then loads only the
  questions that actually have answers and routes each answer group to `Ratings` or `TextResponses`
  (`GetSessionFeedbackHandler.cs:23-53,56-101`).
- **Why it's built this way**: pre-aggregating on the server (averages and groupings) keeps the speaker
  UI a thin renderer and avoids shipping every raw answer row to the client; returning an empty report
  rather than a 404 when nobody answered keeps the dashboard's happy path free of special cases; and
  loading only the questions referenced by an answer (`GetSessionFeedbackHandler.cs:56-63`) keeps the
  second query proportional to the feedback actually received.
- **Where it's used**: returned by `GET /Speakers/{speakerId}/sessions/{sessionId}/feedback`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:410-435`)
  via [`GetSessionFeedbackHandler`](group-18-conference-application.md#getsessionfeedbackhandler); fetched
  by [`SpeakerDashboardService`](group-21-conference-ui.md#speakerdashboardservice)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/SpeakerDashboardService.cs:73-79`)
  and rendered on the speaker dashboard. `[Rubric §11, Security]` is worth reading off that endpoint
  directly: it is `[Authorize]` and applies a self-or-organizer gate in the action body, requiring either
  the `Organizer` role or a `speaker_id` claim matching the route speaker before it calls the handler
  (`SpeakersController.cs:417,423-426`). Its own doc comment records why it carries no output cache: free
  text comments are the speaker's own read, and every response is authorization-dependent, so a shared
  public cache entry would be a leak (`SpeakersController.cs:410-415`).
- **Caveats / not-in-source**: the answers this report aggregates are the Conference module's
  `SessionQuestionAnswers`, not the Engagement module's
  [`SessionFeedback`](group-22-engagement-module.md#sessionfeedback) aggregate; nothing in this DTO or its
  handler reads across that module boundary.

---

### SpeakerCategoryItemDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SpeakerCategoryItemDTO.cs:8` · Level 1 · record (class)

- **What it is**: the read-model shape of the [`SpeakerCategoryItem`](#speakercategoryitem) join row, the
  many-to-many link that attaches a [`CategoryItem`](#categoryitem) (a topic or a locality tier) to a
  [`Speaker`](#speaker).
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype);
  the aliases `SpeakerCategoryItemIdentifierType` (`int`), `SpeakerIdentifierType` (`System.Guid`), and
  `CategoryItemIdentifierType` (`int`).
- **Concept**: the entity read DTO (see [`CategoryItemDTO`](#categoryitemdto)), here for a *join* entity:
  a flat record of foreign keys with no editable content of its own, hence no length constants.
- **Walkthrough**: three `required init` members (`SpeakerCategoryItemDTO.cs:11-17`), `Id` (the
  `IBaseDTO` contract), `SpeakerId` (parent FK), and `CategoryItemId` (the linked item). No concurrency
  token: a bare join row is add or remove only, so there is nothing to update optimistically.
- **Why it's built this way**: modeling the speaker-to-category-item relationship as an explicit join DTO
  (rather than an inline id list) keeps the child collection uniform with every other Conference join and
  lets the mapper project it like any other entity.
- **Where it's used**: nested in [`SpeakerDTO.SpeakerCategoryItems`](#speakerdto); mapped by
  [`SpeakerCategoryItemDTOMapper`](group-18-conference-application.md#speakercategoryitemdtomapper)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerCategoryItemDTOMapper.cs:11-16`),
  which [`SpeakerDTOMapper`](group-18-conference-application.md#speakerdtomapper) takes as a constructor
  dependency and marks `[UseMapper]` so the generator uses it for the children
  (`SpeakerDTOMapper.cs:18,23-24`).

---

### SpeakerQuestionAnswerDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SpeakerQuestionAnswerDTO.cs:9` · Level 1 · record (class)

- **What it is**: the read-model shape of a speaker-level question answer, binding a [`Speaker`](#speaker)
  to a [`Question`](#question) together with the speaker's answer value.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype);
  the aliases `SpeakerQuestionAnswerIdentifierType`, `SpeakerIdentifierType`, `QuestionIdentifierType`.
- **Concept**: the entity read DTO (see [`CategoryItemDTO`](#categoryitemdto)). Unlike the bare
  [`SpeakerCategoryItemDTO`](#speakercategoryitemdto) join, this one carries a payload, the answer text,
  so it is a link *plus* a value.
- **Walkthrough**: four `required init` members (`SpeakerQuestionAnswerDTO.cs:12-21`), `Id`, `SpeakerId`
  (parent FK), `QuestionId` (the answered question), and `AnswerValue` (the response, stored as a string
  regardless of the question's declared [`QuestionDTO.QuestionType`](#questiondto)).
- **Why it's built this way**: keeping the answer as a flat `string AnswerValue` lets one DTO carry any
  question type's answer (free text, a selected option, a numeric rating) without a type-specific shape;
  the cost is that consumers parse, which is exactly what the feedback handler does when it averages
  ratings (`GetSessionFeedbackHandler.cs:75-79`).
- **Where it's used**: nested in [`SpeakerDTO.SpeakerQuestionAnswers`](#speakerdto); mapped by
  [`SpeakerQuestionAnswerDTOMapper`](group-18-conference-application.md#speakerquestionanswerdtomapper)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerQuestionAnswerDTOMapper.cs:11-16`),
  itself a `[UseMapper]` dependency of
  [`SpeakerDTOMapper`](group-18-conference-application.md#speakerdtomapper) (`SpeakerDTOMapper.cs:19,26-27`).

---

### SponsorDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sponsors/SponsorDTO.cs:15` · Level 1 · record (class)

- **What it is**: the read-model shape of the [`Sponsor`](#sponsor) aggregate root: display name,
  [`SponsorTier`](#sponsortier), branding links, the owning event's id, and the optional expo-floor booth
  details.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype),
  [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) (`SponsorDTO.cs:1,15`),
  [`SponsorTier`](#sponsortier); the aliases `SponsorIdentifierType` (`int`) and `EventIdentifierType`.
- **Concept, the DTO that drops the navigation.** `[Rubric §9, API & Contract Design]` and `[Rubric §3,
  Clean Architecture]`. Structurally this is the concurrency-aware entity DTO already introduced by
  [`QuestionDTO`](#questiondto), but it is the cleanest illustration of what a DTO deliberately leaves
  behind. The [`Sponsor`](#sponsor) entity carries both an `EventId` scalar and a `[Navigation] Event?`
  reference used for public-visibility filtering
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sponsors/Sponsor.cs:44-49`); the DTO
  keeps only the scalar `EventId` (`SponsorDTO.cs:69`). The parent event never rides along, so a sponsor
  response cannot accidentally serialize an entire event graph. `[Rubric §11, Security]` shows up by
  contrast with [`SpeakerDTO`](#speakerdto): the sponsor mapper redacts nothing, and says why in its own
  doc comment, sponsor data is bought placement and therefore public
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sponsors/DTOs/SponsorDTOMapper.cs:9-11`).
  It is also the fullest example of the shared-constant chain from [`ActivityDTO`](#activitydto): seven
  caps declared here (`SponsorDTO.cs:17-36`) are consumed by
  [`SponsorInvariants`](#sponsorinvariants)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sponsors/SponsorInvariants.cs:15-31`),
  by EF through those invariants
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SponsorConfiguration.cs:20-46`),
  and by the sponsor form for both its input cap and its `[MaxLength]` annotation
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsor/SponsorFormFields.razor:20`,
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsor/SponsorFormModel.cs:36`).
- **Walkthrough**: seven constants then thirteen properties (`SponsorDTO.cs:17-75`). `Id` + `RowVersion`
  are the two contracts (lines 39 and 42). The `required` `Name` (line 45) is the only mandatory content
  field. `Tier` (line 48) is the enum that drives public ordering. `LogoUrl`, `Description`,
  `WebsiteUrl`, `LinkedInUrl`, and `TwitterHandle` (lines 51-63) are all optional branding, typed as
  plain nullable strings rather than `Uri` because they are operator-entered. `Sort` (line 66) is the
  tie-breaker *within* a tier. `EventId` (line 69) scopes the sponsor to exactly one event.
  `IsExhibitor` + `BoothNumber` (lines 72-75) model the expo floor; the domain keeps a stored booth
  number even when the flag is false, because the flag drives display and does not reject stored data
  (`Sponsor.cs:54-58`).
- **Why it's built this way**: sponsors are sold rather than imported, so unlike the Sessionize-sourced
  entities this contract is fully ADC's own: a closed enum for tier, a required name, everything else
  optional so an organizer can create a sponsor the moment a deal closes and fill in the logo later.
- **Where it's used**: mapped by
  [`SponsorDTOMapper`](group-18-conference-application.md#sponsordtomapper) (`SponsorDTOMapper.cs:12-17`);
  projected by the
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  injected into [`SponsorsController`](group-20-conference-api-grpc.md#sponsorscontroller)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SponsorsController.cs:40`),
  where the one overridden `GetReadSpecificationAsync` hook narrows every anonymous read to sponsors of
  published events (`SponsorsController.cs:60-78`); rendered by
  [`PublicSponsorList`](group-21-conference-ui.md#publicsponsorlist) and the organizer-facing
  [`SponsorList`](group-21-conference-ui.md#sponsorlist).

---

### CategoryItemChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Categories.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/DomainEvents/CategoryItemChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the domain event a [`Category`](#category) aggregate raises when one of its
  [`CategoryItem`](#categoryitem) children is added, updated, or removed. It carries the parent category
  id, the child item id, and the item's display name.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) (Level 1),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) (Level 0), both from
  `MMCA.Common.Domain` (`CategoryItemChanged.cs:1-2`); the aliases `ConferenceCategoryIdentifierType` and
  `CategoryItemIdentifierType`.
- **Concept introduced, the child-change domain event.** `[Rubric §6, CQRS & Event-Driven]` (assesses
  whether state changes are expressed as typed, first-class events that typed handlers can subscribe to)
  and `[Rubric §4, DDD]` (domain events are part of the ubiquitous language: an aggregate announces what
  happened inside its boundary). Every Conference child or join entity has a companion `Changed` record,
  and two design choices visible here are reused across that whole family:
  1. **It derives from [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) directly, not from
     [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype).**
     `EntityChangedEvent<T>` models a single entity id
     (`MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/EntityChangedEvent.cs:24-27`); a child
     change needs *two* identifiers (the parent aggregate and the child) plus a descriptor, so it does
     not fit that one-id shape. The aggregate-root lifecycle events, [`CategoryChanged`](#categorychanged)
     and its siblings, do use `EntityChangedEvent<T>`.
  2. **It is a `sealed record class` with no behavior.** The inherited `DateOccurred` and `MessageId`
     come from `BaseDomainEvent`, each defaulted at construction
     (`MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs:26-35`); the type
     exists purely so `IDomainEventHandler<CategoryItemChanged>` can be registered and dispatched
     independently of every other event type. Being a `record` gives it structural equality, but the
     base's own remarks warn that this is *not* a deduplication mechanism: two logically identical
     events raised separately are never equal because both defaults are fresh per instance, and
     consumer-side dedup is the inbox's job keyed on `MessageId` (`BaseDomainEvent.cs:9-17`, ADR-021).
- **Walkthrough**: four positional members (`CategoryItemChanged.cs:13-17`), `State` (the
  `Added`/`Updated`/`Deleted` transition), `CategoryId` (the parent), `CategoryItemId` (the child), and
  `Name` (the item's display name, so a handler or log line has a human-readable label without
  re-loading the entity).
- **Why it's built this way**: keeping the payload flat and self-describing (ids plus a name) means a
  downstream handler never has to re-query the aggregate to act, and the event survives serialization
  through the dispatch pipeline unchanged.
- **Where it's used**: raised by [`Category`](#category) at all three child mutation points,
  `AddCategoryItem`, `UpdateCategoryItem`, and `RemoveCategoryItem`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/Category.cs:144,176,194`);
  collected on the aggregate and dispatched in-process by
  [`DomainEventDispatcher`](group-04-events-outbox.md#domaineventdispatcher) after `SaveChangesAsync`.
- **Caveats / not-in-source**: no handler subscribes to it in the ADC source today; it is available for
  future observers and audit. Note also the one asymmetry: deleting the parent category cascade
  soft-deletes its items (BR-71) through a single `DeleteChildren` call but raises one
  [`CategoryChanged`](#categorychanged)`(Deleted)` rather than one `CategoryItemChanged` per item
  (`Category.cs:102-114`), so a subscriber must treat parent deletion as implying its children.

---

### ConferenceCategoryDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Categories/ConferenceCategoryDTO.cs:14` · Level 2 · record (class)

- **What it is**: the read-model shape of a [`Category`](#category) aggregate root (for example "Level",
  "Track", or "Session format"), including its child [`CategoryItemDTO`](#categoryitemdto) options.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype),
  [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware),
  [`CategoryItemDTO`](#categoryitemdto) (Level 1); the alias `ConferenceCategoryIdentifierType`.
- **Concept, the aggregate-root read DTO with a child collection.** `[Rubric §9, API & Contract Design]`
  and `[Rubric §8, Data Architecture]`. This combines both patterns seen above: it is a concurrency-aware
  DTO (`RowVersion`, as in [`QuestionDTO`](#questiondto)) *and* it nests a child collection of
  [`CategoryItemDTO`](#categoryitemdto), so the whole aggregate (category plus its options) serializes in
  one response. The concurrency token sits here and not on the child, which is the aggregate boundary
  showing through the read model: you version the root, not each option. The entity declarations line up
  with that split, `Category` is an
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/Category.cs:16`) while
  `CategoryItem` is a plain
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (`CategoryItem.cs:14`).
- **Walkthrough**: two constants then six properties (`ConferenceCategoryDTO.cs:17-38`).
  `TitleMaxLength = 255` and `TypeMaxLength = 100` (lines 17-20) are the caps
  [`CategoryInvariants`](#categoryinvariants) reads back (`CategoryInvariants.cs:17-21`) and that EF then
  applies as `HasMaxLength`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/ConferenceCategoryConfiguration.cs:27,34`).
  Then `Id` + `RowVersion` (the contracts, lines 23 and 26), the `required` `Title` (line 29), a plain
  `Sort` (line 32) and an optional `Type` ("session" or "speaker", line 35), and the `CategoryItems`
  collection, an `IReadOnlyCollection<CategoryItemDTO>` initialized to `[]`
  (`ConferenceCategoryDTO.cs:38`) so it is never null even when the category has no items yet.
- **Why it's built this way**: defaulting the child collection to an empty collection literal removes
  null checks downstream; nesting the items lets the categories UI render an editable
  category-with-options block from a single fetch.
- **Where it's used**: mapped by
  [`ConferenceCategoryDTOMapper`](group-18-conference-application.md#conferencecategorydtomapper), which
  takes [`CategoryItemDTOMapper`](group-18-conference-application.md#categoryitemdtomapper) as a
  constructor dependency and marks it `[UseMapper]` so the generator uses it for the children
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/DTOs/ConferenceCategoryDTOMapper.cs:12-21`);
  returned by [`ConferenceCategoriesController`](group-20-conference-api-grpc.md#conferencecategoriescontroller)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ConferenceCategoriesController.cs:36`)
  and consumed by the category-management UI.

---

### SpeakerDTO
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SpeakerDTO.cs:18` · Level 2 · record (class)

- **What it is**: the read-model shape of the [`Speaker`](#speaker) aggregate root: profile fields, social
  links, an optional link to an Identity user, and two child collections (category items and question
  answers). It is the richest DTO in this unit.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype),
  [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware),
  [`SpeakerCategoryItemDTO`](#speakercategoryitemdto),
  [`SpeakerQuestionAnswerDTO`](#speakerquestionanswerdto); the aliases `SpeakerIdentifierType` (a
  `System.Guid`, because speakers are imported with Sessionize-assigned identity per BR-61,
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:3,19`)
  and `UserIdentifierType` (an `int`, owned by Identity).
- **Concept, the cross-context read DTO and the redacting mapper.** `[Rubric §7, Microservices
  Readiness]`, `[Rubric §8, Data Architecture]`, `[Rubric §11, Security]`. Three things make this DTO
  worth studying beyond its size:
  1. **`LinkedUserId` is a bare nullable scalar** (`SpeakerDTO.cs:97`), not a nested user object and not
     an EF navigation, because the user and the speaker live in separate databases
     ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The link is
     reconciled by events ([`SpeakerLinkedToUser`](#speakerlinkedtouser) and
     [`SpeakerUnlinkedFromUser`](#speakerunlinkedfromuser)), never by a cross-database join.
  2. **`Email` is nullable on the DTO although the entity holds an `Email` value object**, because
     [`SpeakerDTOMapper`](group-18-conference-application.md#speakerdtomapper) redacts it: the public
     `MapToDTO` calls the generated `MapToDTOGenerated` and then returns `dto with { Email = null }`
     unless the caller is in the `Organizer` role (BR-66,
     `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerDTOMapper.cs:13,30-37,46`).
     A small private converter, `NullableEmailToString` (`SpeakerDTOMapper.cs:49`), is what lets the
     generator flatten the [`Email`](group-02-domain-building-blocks.md#email) value object to a string in
     the first place. The redaction is in the mapper rather than the controller, so every read path
     inherits it. This is the DTO layer doing real work, not just shape translation.
  3. **One of its ten length constants is deliberately UI-only.** `BioMaxLength = 4000`
     (`SpeakerDTO.cs:32-37`) is documented as an input cap and character counter and nothing else:
     `Bio` carries no EF length and no domain invariant, so a Sessionize-imported bio longer than the
     counter still persists intact. The nine other caps do flow into
     [`SpeakerInvariants`](#speakerinvariants)
     (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/SpeakerInvariants.cs:15-31`),
     the same chain [`ActivityDTO`](#activitydto) introduces. Reading the exception in the source is the
     point: the pattern is a convention, not a law, and the deviation is written down where it happens.
- **Walkthrough**: ten constants (`SpeakerDTO.cs:21-52`) then seventeen properties
  (`SpeakerDTO.cs:55-103`). `Id` + `RowVersion` are the contracts (lines 55 and 58). The `required` name
  fields are `FirstName`, `LastName`, and `FullName` (lines 61-67); `FullName` is a computed expression
  on the entity (`Speaker.cs:61`) flattened into a stored string here, so a client renders a display name
  without concatenating. Then the optional profile fields, `Email` (line 70, the redacted one), `Bio`,
  `TagLine`, `ProfilePicture`, the `IsTopSpeaker` flag, and the social handles `TwitterHandle`,
  `LinkedInUrl`, `GitHubUrl`, `WebsiteUrl` (lines 73-94, plain nullable strings because they come through
  the Sessionize import). `LinkedUserId` (line 97) is the cross-context link. The two child collections
  `SpeakerCategoryItems` and `SpeakerQuestionAnswers` (lines 100-103) are both `IReadOnlyCollection<...>`
  defaulted to `[]`, and both are filled by `[UseMapper]` child mappers rather than by hand
  (`SpeakerDTOMapper.cs:23-27`).
- **Why it's built this way**: denormalizing `FullName` and defaulting both collections keeps the speaker
  UI a thin renderer; exposing `LinkedUserId` as a bare nullable id is exactly the database-per-service
  posture, since the Conference read model knows the *id* of the linked user but never reaches across the
  boundary to fetch it; and redacting `Email` in the mapper means the PII rule cannot be forgotten by a
  new endpoint.
- **Where it's used**: projected by the
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  injected into [`SpeakersController`](group-20-conference-api-grpc.md#speakerscontroller)
  (`SpeakersController.cs:47`), and returned by its create and update commands; the update path is the
  concurrency story end to end, an `[Authorize]` self-or-organizer action marked `[SupportsIfMatch]` that
  pulls the required token out of the request header and hands it to the command
  (`SpeakersController.cs:326-351`, ADR-035). Rendered by the public speaker pages and by
  [`SpeakerDashboardService`](group-21-conference-ui.md#speakerdashboardservice).

---

### CategoryChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Categories.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/DomainEvents/CategoryChanged.cs:12` · Level 3 · record (sealed)

- **What it is**: the aggregate-lifecycle event a [`Category`](#category) raises when it is created,
  updated, or deleted. Carries the category id and its title.
- **Depends on**:
  [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype)
  (Level 2), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) (Level 0); the
  alias `ConferenceCategoryIdentifierType`.
- **Concept introduced, the aggregate-root lifecycle event.** `[Rubric §6, CQRS & Event-Driven]` and
  `[Rubric §16, Maintainability]` (one event type per aggregate instead of a separate
  `Created`/`Updated`/`Deleted` trio). Where the Level-2 events above derive from
  [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) directly, the root-level events derive
  from `EntityChangedEvent<TIdentifierType>`, which consolidates the CRUD-lifecycle pattern: it holds
  `State` plus a single generic `EntityId` (constrained `notnull`,
  `MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/EntityChangedEvent.cs:24-27`), and each
  concrete record passes its own id up to that base
  (`CategoryChanged.cs:16`: `: EntityChangedEvent<ConferenceCategoryIdentifierType>(State, CategoryId)`).
  A subtle but real consequence: the derived record re-exposes the id under a domain-meaningful name
  (`CategoryId`) while the same value is also reachable as the inherited generic `EntityId`, one identity
  under two property names, so handlers written against `EntityChangedEvent<T>` and handlers written
  against the concrete type both work. The base's own doc comment draws the dividing line, generic CRUD
  lifecycle belongs here while a business transition such as `OrderPaid` keeps inheriting
  `BaseDomainEvent` directly (`EntityChangedEvent.cs:15-19`), and it also fixes the raise convention:
  `Added` from factory methods, `Updated` from mutators, `Deleted` from `Delete()`
  (`EntityChangedEvent.cs:9-14`).
- **Walkthrough**: three positional members (`CategoryChanged.cs:13-15`), `State`, `CategoryId`, and
  `Title`; `State` and `CategoryId` are forwarded to the base constructor (line 16), and `Title` is the
  record's own added property, the human-readable descriptor a handler or log line can use without
  re-loading the aggregate.
- **Why it's built this way**: one lifecycle event per aggregate keeps the event surface small, and
  `State` lets a handler branch on the transition rather than subscribing to three separate types.
- **Where it's used**: raised from [`Category`](#category)'s `Create` (`Added`), `Update` (`Updated`),
  and `Delete` (`Deleted`) at `Category.cs:72,95,111`, where the delete only raises once the combined
  cascade result succeeds (`Category.cs:106-111`); dispatched in-process by
  [`DomainEventDispatcher`](group-04-events-outbox.md#domaineventdispatcher) after `SaveChangesAsync`.
- **Caveats / not-in-source**: like [`CategoryItemChanged`](#categoryitemchanged), no handler subscribes
  to it in the ADC source today. It is an in-process domain event, not an integration event, so it never
  reaches the outbox or the broker on its own.

### EventQuestionAnswerChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/DomainEvents/EventQuestionAnswerChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the domain event an [`Event`](#event) aggregate raises when one of its
  [`EventQuestionAnswer`](#eventquestionanswer) children is added, updated, or removed. It announces a
  change *inside* the aggregate boundary, not a change of the aggregate root itself.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) (the base record) and the
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) enum, both from
  `MMCA.Common.Domain` (`EventQuestionAnswerChanged.cs:1-2`); the module identifier aliases
  `EventIdentifierType`, `EventQuestionAnswerIdentifierType`, and `QuestionIdentifierType`, all `int`
  behind a `global using`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:8`,
  `:9`, `:11`, see the [primer](00-primer.md)). No NuGet dependency.
- **Concept introduced, the child-change domain event.** `[Rubric §6, CQRS & Event-Driven]` (assesses
  whether state transitions are published as typed, first-class events that typed handlers can subscribe
  to, instead of leaking out as ad-hoc side effects) and `[Rubric §4, DDD]` (assesses whether the
  aggregate root is the sole author of change inside its consistency boundary and names that change in
  the ubiquitous language). Every child and join entity in the Conference model has a companion
  `...Changed` record, and this family shares three design choices worth learning once:
  1. **It derives from [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) directly, not from
     [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype).**
     That base models exactly one identifier (`State` plus a generic `EntityId`,
     `MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/EntityChangedEvent.cs:24-27`), which a child
     change cannot fit: it needs the parent id *and* the child id, plus a descriptor. The aggregate-root
     lifecycle events later in this part ([`EventChanged`](#eventchanged) and siblings) do use it.
  2. **It is a `sealed record class` with no behavior.** Structural equality is free, and the inherited
     `MessageId` / `DateOccurred` come from the base
     (`MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs:28-35`). The type exists
     so an [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent)
     closed over `EventQuestionAnswerChanged` can be registered and dispatched independently of every
     other event type.
  3. **The payload is flat ids plus a descriptor.** The event must survive being serialized into an
     [`OutboxMessage`](group-04-events-outbox.md#outboxmessage) row in the same transaction as the data
     ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)), so it carries no entity
     references. How a raised event reaches the outbox and the in-process handlers is taught once in
     [Group 04](group-04-events-outbox.md); this part only produces them.
- **Walkthrough**: four positional members
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/DomainEvents/EventQuestionAnswerChanged.cs:13-17`):
  `State` (the `Added` / `Updated` / `Deleted` transition), `EventId` (the parent aggregate),
  `EventQuestionAnswerId` (the child row), and `QuestionId` (line 17), the FK to the
  [`Question`](#question) that was answered, so a handler knows which question the answer belongs to
  without re-loading the aggregate.
- **Why it's built this way**: publishing ids rather than the entity keeps the event a self-describing,
  serializable fact and keeps a subscriber out of the aggregate's internals. Raising one event per child
  type (rather than a single generic "event updated") lets cache invalidation and projections target
  exactly what moved.
- **Where it's used**: raised by [`Event`](#event)'s `AddEventQuestionAnswer` (declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:592`, raises at `:605`),
  `UpdateEventQuestionAnswer` (`:616`, raises at `:629`), and `RemoveEventQuestionAnswer` (`:639`, raises
  at `:647`). Every raised event is written to an outbox row by the save-changes interceptor, which adds
  a row for *every* domain event and routes only the non-integration ones to in-process dispatch
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:241-259`),
  where [`DomainEventDispatcher`](group-04-events-outbox.md#domaineventdispatcher) delivers them.
- **Caveats / not-in-source**: no `IDomainEventHandler` subscribes to it today. In fact the Conference
  Application layer contains exactly one domain event handler,
  [`SpeakerDeletedHandler`](group-18-conference-application.md#speakerdeletedhandler) for
  [`SpeakerChanged`](#speakerchanged); every other event in this part is raised, persisted, and dispatched
  with no subscriber. That is a deliberate cost: the contract exists so a consumer can be added without
  touching the aggregate.

---

### EventSpeakerChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/DomainEvents/EventSpeakerChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the change event an [`Event`](#event) raises when an [`EventSpeaker`](#eventspeaker) join
  entity is added or removed, that is, when a [`Speaker`](#speaker) is attached to or detached from the event.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `EventIdentifierType`,
  `EventSpeakerIdentifierType`, `SpeakerIdentifierType` (the last is `System.Guid`, not `int`, because
  speakers carry Sessionize-assigned GUIDs per BR-61,
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:19`).
- **Concept**: the child-change domain event introduced by
  [`EventQuestionAnswerChanged`](#eventquestionanswerchanged), here for a *join* entity.
  `[Rubric §6, CQRS & Event-Driven]`. The XML doc says "added or removed" with no update case
  (`EventSpeakerChanged.cs:7`): a pure FK-pair join carries no editable content, so only two transitions are
  meaningful. The parameter type stays `DomainEntityState` (nothing narrows it structurally), and the raise
  sites use only `Added` and `Deleted`.
- **Walkthrough**: `State`, `EventId` (parent), `EventSpeakerId` (the join row), `SpeakerId` (the linked
  speaker), lines 14-17.
- **Where it's used**: raised by [`Event`](#event)'s `AddEventSpeaker` (declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:509`, raises at `:530`),
  `RestoreEventSpeaker` (`:546`, raises at `:555`), and `RemoveEventSpeaker` (`:565`, raises at `:573`).
  Note the restore path: un-deleting a soft-deleted join row raises `Added` again (`:555`), so a subscriber
  sees the same transition it saw the first time and needs no separate "restored" case.
- **Caveats / not-in-source**: no handler subscribes today (see
  [`EventQuestionAnswerChanged`](#eventquestionanswerchanged)).

---

### RoomChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/DomainEvents/RoomChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the child-change event an [`Event`](#event) raises when one of its [`Room`](#room) children
  is added, updated, or removed. Carries the parent event id, the room id, and the room name.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `EventIdentifierType`,
  `RoomIdentifierType`.
- **Concept**: the child-change domain event (see [`EventQuestionAnswerChanged`](#eventquestionanswerchanged)).
  `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §13, Observability & Operability]` (assesses whether the
  system emits structured, correlatable signal about what it did). The instructive detail here is the
  *descriptor* choice: the fourth member is `RoomName`, a display label, not another foreign key
  (`RoomChanged.cs:17`). Every other child event in this family carries an FK as its fourth member. A label
  makes the event readable on its own, so a log line or a projection can render the room by name with no
  reload; an FK would force the subscriber back into the database. Which of the two a `...Changed` record
  carries is therefore a real contract decision, not boilerplate.
- **Walkthrough**: `State`, `EventId` (parent), `RoomId` (child), `RoomName` (display label), lines 14-17.
- **Where it's used**: raised by [`Event`](#event)'s `AddRoom` (declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:358`, raises at `:379`),
  `UpdateRoom` (`:395`, raises at `:417`), `RestoreRoom` (`:438`, raises `Added` at `:474`), and `RemoveRoom`
  (`:484`, raises at `:491`).
- **Caveats / not-in-source**: no handler subscribes today. The self-describing payload is there for a
  subscriber that does not yet exist.

---

### SessionCategoryItemChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionCategoryItemChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the domain event a [`Session`](#session) raises when one of its
  [`SessionCategoryItem`](#sessioncategoryitem) join rows is added or removed (the tags, track, and level
  assignments on a session).
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `SessionIdentifierType`,
  `SessionCategoryItemIdentifierType`, `CategoryItemIdentifierType`.
- **Concept**: the child-change domain event ([`EventQuestionAnswerChanged`](#eventquestionanswerchanged)),
  applied to the [`Session`](#session) aggregate. `[Rubric §6, CQRS & Event-Driven]` and
  `[Rubric §4, DDD]`. It carries three ids so a handler can react without reloading: the parent session, the
  join row, and the [`CategoryItem`](#categoryitem) that was linked.
- **Walkthrough**: `sealed record class` with `State`, `SessionId`, `SessionCategoryItemId`, `CategoryItemId`
  (`SessionCategoryItemChanged.cs:13-17`). Being a record, immutability and structural equality come for free;
  the primary-constructor parameters are the only state.
- **Where it's used**: raised by [`Session`](#session)'s `AddSessionCategoryItem` (declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/Session.cs:397`, raises at `:418`),
  `RestoreSessionCategoryItem` (`:435`, raises `Added` at `:447`), and `RemoveSessionCategoryItem` (`:457`,
  raises at `:465`); captured by the outbox in `SaveChangesAsync` and dispatched in-process.
- **Caveats / not-in-source**: no handler subscribes today.

---

### SessionQuestionAnswerChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionQuestionAnswerChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the domain event a [`Session`](#session) raises when a
  [`SessionQuestionAnswer`](#sessionquestionanswer) child row is added, updated, or removed. Same shape as
  [`SessionCategoryItemChanged`](#sessioncategoryitemchanged), for the answer child rather than the category join.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `SessionIdentifierType`,
  `SessionQuestionAnswerIdentifierType`, `QuestionIdentifierType`.
- **Concept**: the child-change domain event ([`EventQuestionAnswerChanged`](#eventquestionanswerchanged)).
  `[Rubric §6, CQRS & Event-Driven]`. The behavioral difference against a join event is the `Updated` state:
  an answer's value can change in place (a join row cannot), so `UpdateSessionQuestionAnswer` exists
  (`Session.cs:508`) and the raise sites use all three transitions.
- **Walkthrough**: `sealed record class` with `State`, `SessionId`, `SessionQuestionAnswerId`, `QuestionId`
  (`SessionQuestionAnswerChanged.cs:13-17`).
- **Where it's used**: raised by [`Session`](#session)'s `AddSessionQuestionAnswer` (declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/Session.cs:484`, raises at `:497`),
  `UpdateSessionQuestionAnswer` (`:508`, raises at `:521`), and `RemoveSessionQuestionAnswer` (`:531`, raises
  at `:539`); captured by the outbox. Do not confuse it with
  [`SessionFeedbackSubmitted`](#sessionfeedbacksubmitted), the cross-module event the *application* layer
  raises alongside the same create path: the domain event says "a row changed", the integration event says
  "an attendee gave feedback".
- **Caveats / not-in-source**: no handler subscribes today.

---

### SessionSpeakerChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionSpeakerChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the domain event a [`Session`](#session) raises when a [`SessionSpeaker`](#sessionspeaker)
  join row (the session-to-speaker association) is added or removed.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `SessionIdentifierType`,
  `SessionSpeakerIdentifierType`, `SpeakerIdentifierType`.
- **Concept**: the child-change domain event ([`EventQuestionAnswerChanged`](#eventquestionanswerchanged)),
  join-entity flavor as in [`EventSpeakerChanged`](#eventspeakerchanged). `[Rubric §6, CQRS & Event-Driven]`.
  The XML doc records "added or removed" (`SessionSpeakerChanged.cs:7`), and the raise sites use only `Added`
  and `Deleted`.
- **Walkthrough**: `sealed record class` with `State`, `SessionId`, `SessionSpeakerId`, `SpeakerId`
  (`SessionSpeakerChanged.cs:13-17`).
- **Where it's used**: raised by [`Session`](#session)'s `AddSessionSpeaker` (declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/Session.cs:315`, raises at `:336`),
  `RestoreSessionSpeaker` (`:352`, raises `Added` at `:361`), and `RemoveSessionSpeaker` (`:371`, raises at
  `:379`); captured by the outbox.
- **Caveats / not-in-source**: no handler subscribes today.

---

### SpeakerCategoryItemChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Speakers.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/DomainEvents/SpeakerCategoryItemChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the [`Speaker`](#speaker)-side twin of
  [`SessionCategoryItemChanged`](#sessioncategoryitemchanged): raised when a
  [`SpeakerCategoryItem`](#speakercategoryitem) join row is added or removed from a speaker (for example the
  speaker's topic or locality tags).
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `SpeakerIdentifierType`,
  `SpeakerCategoryItemIdentifierType`, `CategoryItemIdentifierType`.
- **Concept**: the child-change domain event ([`EventQuestionAnswerChanged`](#eventquestionanswerchanged)).
  `[Rubric §6, CQRS & Event-Driven]`. Structurally identical to the session variant with the parent id swapped
  from session to speaker, which is exactly the point of the family: one shape, one id triple, one type per
  relationship so handlers stay narrow.
- **Walkthrough**: `sealed record class` with `State`, `SpeakerId`, `SpeakerCategoryItemId`, `CategoryItemId`
  (`SpeakerCategoryItemChanged.cs:13-17`).
- **Where it's used**: raised by [`Speaker`](#speaker)'s `AddSpeakerCategoryItem` (declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:314`, raises at `:335`),
  `RestoreSpeakerCategoryItem` (`:352`, raises `Added` at `:364`), and `RemoveSpeakerCategoryItem` (`:374`,
  raises at `:382`); captured by the outbox.
- **Caveats / not-in-source**: no handler subscribes today.

---

### SpeakerQuestionAnswerChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Speakers.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/DomainEvents/SpeakerQuestionAnswerChanged.cs:13` · Level 2 · record (sealed)

- **What it is**: the [`Speaker`](#speaker)-side twin of
  [`SessionQuestionAnswerChanged`](#sessionquestionanswerchanged): raised when a
  [`SpeakerQuestionAnswer`](#speakerquestionanswer) child row is added, updated, or removed.
- **Depends on**: [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `SpeakerIdentifierType`,
  `SpeakerQuestionAnswerIdentifierType`, `QuestionIdentifierType`.
- **Concept**: the child-change domain event ([`EventQuestionAnswerChanged`](#eventquestionanswerchanged)).
  `[Rubric §6, CQRS & Event-Driven]`. As with the session answer, the answer value is mutable, so the raise
  sites span `Added`, `Updated`, and `Deleted`.
- **Walkthrough**: `sealed record class` with `State`, `SpeakerId`, `SpeakerQuestionAnswerId`, `QuestionId`
  (`SpeakerQuestionAnswerChanged.cs:13-17`).
- **Where it's used**: raised by [`Speaker`](#speaker)'s `AddSpeakerQuestionAnswer` (declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:401`, raises at `:414`),
  `UpdateSpeakerQuestionAnswer` (`:425`, raises at `:438`), and `RemoveSpeakerQuestionAnswer` (`:448`, raises
  at `:456`); captured by the outbox.
- **Caveats / not-in-source**: no handler subscribes today.

---

### ActivityChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Activities.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Activities/DomainEvents/ActivityChanged.cs:12` · Level 3 · record (sealed)

- **What it is**: the aggregate-root lifecycle event for an [`Activity`](#activity), the non-session agenda item
  (a keynote reception, a lunch break, a hallway track slot): raised when one is created, updated, or
  soft-deleted. It carries the activity id and its display name.
- **Depends on**:
  [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype) (the
  base record), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); alias
  `ActivityIdentifierType`.
- **Concept**: the aggregate-root lifecycle event, taught in detail under [`EventChanged`](#eventchanged)
  below. `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §16, Maintainability]` (assesses whether a recurring
  shape is factored once instead of copied). The instructive detail is a *contrast*: [`Activity`](#activity)
  owns an `EventId` property
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Activities/Activity.cs:54`), yet
  `ActivityChanged` does not carry it, where the structurally similar [`SessionChanged`](#sessionchanged)
  does. A subscriber that needs the parent event for an activity therefore has to reload it, which is a real
  (if small) asymmetry in the event contracts of this bounded context rather than a rule you can infer.
- **Walkthrough**: three positional members (`ActivityChanged.cs:12-16`): `State`, `ActivityId`, and `Name`,
  with `(State, ActivityId)` forwarded to `EntityChangedEvent<ActivityIdentifierType>` on line 16.
- **Where it's used**: raised from [`Activity`](#activity)'s `Create` factory (declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Activities/Activity.cs:99`, raises at
  `:127`), its `Update` method (`:145`, raises at `:173`), and its `Delete` override, which calls the base
  soft-delete first and raises the event only when that base call returned success (`:180-188`, raise at
  `:185`); dispatched in-process.
- **Caveats / not-in-source**: no `IDomainEventHandler<ActivityChanged>` is implemented today; the event is
  raised and persisted to the outbox regardless.

---

### EventChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/DomainEvents/EventChanged.cs:12` · Level 3 · record (sealed)

- **What it is**: the aggregate-root lifecycle event an [`Event`](#event) raises when it is created, updated,
  or deleted. Publish and unpublish also flip state and emit it with `Updated`. It carries the event id and name.
- **Depends on**:
  [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype) (the
  base record), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); alias
  `EventIdentifierType`.
- **Concept introduced, the aggregate-root lifecycle event.** `[Rubric §6, CQRS & Event-Driven]` (assesses
  whether the write model announces its transitions as consumable events) and `[Rubric §16, Maintainability]`
  (assesses whether a recurring shape is factored once instead of copied: one event type per aggregate rather
  than a separate `Created` / `Updated` / `Deleted` trio). Where the Level-2 events above derive from
  [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent) directly, the root-level events derive from
  `EntityChangedEvent<TIdentifierType>`, which consolidates the CRUD lifecycle into `State` plus a single
  generic `EntityId`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/EntityChangedEvent.cs:24-27`), and each concrete
  record forwards its own id to that base (line 16:
  `: EntityChangedEvent<EventIdentifierType>(State, EventId)`). A subtle but real consequence: the derived
  record re-exposes the identity under a domain-meaningful name (`EventId`) while the same value is also
  reachable as the inherited `EntityId`, so a handler written against `EntityChangedEvent<T>` and one written
  against the concrete type both work. The base's own doc is explicit that this shape is for *generic CRUD
  lifecycle only*: a business transition with a unique payload should derive straight from `BaseDomainEvent`
  (`EntityChangedEvent.cs:15-19`).
- **Walkthrough**: three positional members
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/DomainEvents/EventChanged.cs:12-16`):
  `State`, `EventId`, and `Name`; the first two are forwarded to the base constructor on line 16, `Name` is
  the record's own added property and exists so a log line or cache-invalidation handler has a human-readable
  label without a reload.
- **Why it's built this way**: one lifecycle event per aggregate keeps the event surface small and lets a
  subscriber branch on `State` rather than subscribing to three separate types. Because these records are
  serialized through the outbox, keeping the base shared also keeps their contract shape stable
  ([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html) governs the
  versioning rules for anything that crosses a boundary).
- **Where it's used**: raised from [`Event`](#event)'s `Create` (declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:164`, raises at `:207`),
  `Update` (`:229`, raises at `:265`), `Publish` (`:272`, raises at `:285`), `Unpublish` (`:292`, raises at
  `:305`), and `Delete` (`:328`, raises at `:340`); dispatched in-process by
  [`DomainEventDispatcher`](group-04-events-outbox.md#domaineventdispatcher) after `SaveChangesAsync`. Note
  that publish and unpublish reuse the `Updated` transition rather than introducing dedicated event types,
  which is the CRUD-lifecycle base doing its job: a subscriber that cares specifically about publication has
  to compare the [`Event`](#event)'s own state, not the event type.
- **Caveats / not-in-source**: no handler subscribes today.

---

### EventFeedbackSubmitted
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Events.IntegrationEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/IntegrationEvents/EventFeedbackSubmitted.cs:20` · Level 3 · record (sealed)

- **What it is**: the cross-module **integration event** Conference raises when an attendee submits feedback on
  an event. The Engagement module subscribes and awards the attendee points for the feedback.
- **Depends on**: [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent) (the base record)
  and [`EventNameAttribute`](group-02-domain-building-blocks.md#eventnameattribute) (applied on line 19);
  aliases `UserIdentifierType`, `EventIdentifierType`; BCL `DateTime`.
- **Concept introduced, the integration event (as distinct from the domain event).**
  `[Rubric §7, Microservices Readiness]` (assesses whether cross-module coupling runs through a published
  contract a peer can consume without a code reference back into the producer's domain) and
  `[Rubric §9, API & Contract Design]` (the async message *is* a public contract, versioned like one). Three
  things separate it from every event above.
  1. **It derives from [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent)**, which adds
     a virtual `SchemaVersion` defaulting to `1`
     (`MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/BaseIntegrationEvent.cs:32`) and implements
     `IIntegrationEvent`, the marker the save-changes interceptor branches on: an integration event still gets
     an outbox row, but it is deliberately *not* dispatched in process, so its row stays unprocessed
     (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:243-256`)
     and the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) publishes it through
     [`IMessageBus`](group-04-events-outbox.md#imessagebus) instead, wrapped in a broker-publish resilience
     pipeline
     (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:587-600`).
     The registered transport then decides delivery: in-process for the monolith, MassTransit broker for the
     extracted services.
  2. **It carries an explicit wire name.** `[EventName("Conference.EventFeedbackSubmitted.v1")]`
     (`EventFeedbackSubmitted.cs:19`) pins the serialized message-type name, so renaming the C# record does
     not silently break an already-deployed consumer.
  3. **It lives in the `.Shared` project, not `.Domain`**, precisely so a subscribing module can reference the
     contract without pulling in Conference's domain model.

  [ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html) is the rule for
  evolving it: additive changes keep the version, a breaking change means a new type plus a consumer-side
  upcaster registered per [ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html).
- **Walkthrough**: three positional members
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/IntegrationEvents/EventFeedbackSubmitted.cs:20-24`):
  `UserId` (the attendee, line 21), `EventId` (the subject, line 22), and `SubmittedOnUtc` (when the answer was
  recorded, in UTC, line 23). The producer supplies that instant from an injected `TimeProvider`, never an
  ambient clock
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddEventQuestionAnswer/AddEventQuestionAnswerHandler.cs:112`).
- **Why it's built this way**: the delivery semantics are the interesting part, and the XML doc states them
  (`EventFeedbackSubmitted.cs:9-14`). Event feedback is an upsert writing one row per form question (BR-107),
  so one submitted form raises this event once per *newly created* answer, and only on the create path: the
  update branch of the same handler raises nothing (`AddEventQuestionAnswerHandler.cs:81-94` for the update
  path versus `:96-117` for the create path). Because at-least-once outbox delivery and a multi-question form
  both mean the consumer can see the message more than once, the consumer is idempotent on its own side: it
  collapses everything onto one subject key and lets the awarder's uniqueness rule reject the duplicates
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Points/IntegrationEventHandlers/EventFeedbackSubmittedPointsHandler.cs:40-47`).
  That is the standard posture for [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)
  and [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html): the producer
  guarantees the fact was recorded atomically with the data, the consumer guarantees the effect happens once.
- **Where it's used**: raised on the aggregate pre-save by
  [`AddEventQuestionAnswerHandler`](group-18-conference-application.md#addeventquestionanswerhandler)
  (`:112`), so the outbox captures it in the same `SaveChangesAsync`; consumed by
  [`EventFeedbackSubmittedPointsHandler`](group-22-engagement-module.md#eventfeedbacksubmittedpointshandler),
  which maps it onto an event subject key via
  [`PointsSubjectKeys`](group-22-engagement-module.md#pointssubjectkeys) and calls
  [`IPointsAwarder`](group-22-engagement-module.md#ipointsawarder)
  (`EventFeedbackSubmittedPointsHandler.cs:40-47`); registered as a broker consumer in the Engagement service
  host (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:287`).

---

### QuestionChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Questions.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/DomainEvents/QuestionChanged.cs:12` · Level 3 · record (sealed)

- **What it is**: the aggregate-root lifecycle event for a [`Question`](#question), the reusable custom-form
  question definition: raised when one is created, updated, or deleted.
- **Depends on**:
  [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); alias `QuestionIdentifierType`.
- **Concept**: the aggregate-root lifecycle event introduced by [`EventChanged`](#eventchanged).
  `[Rubric §6, CQRS & Event-Driven]`. Structurally identical, with `QuestionText` as its descriptor.
- **Walkthrough**: `sealed record class QuestionChanged(DomainEntityState State, QuestionIdentifierType QuestionId, string QuestionText)`
  forwarding `(State, QuestionId)` to `EntityChangedEvent<QuestionIdentifierType>`
  (`QuestionChanged.cs:12-16`).
- **Where it's used**: raised from [`Question`](#question)'s `Create` (declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/Question.cs:70`, raises at `:94`),
  `Update` (`:108`, raises at `:128`), and `Delete` (`:135`, raises at `:140`); dispatched in-process.
- **Caveats / not-in-source**: no handler subscribes today.

---

### SessionChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionChanged.cs:13` · Level 3 · record (sealed)

- **What it is**: the aggregate-root lifecycle event for a [`Session`](#session): raised on create, update, or
  delete.
- **Depends on**:
  [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `SessionIdentifierType`,
  `EventIdentifierType`.
- **Concept**: the aggregate-root lifecycle event ([`EventChanged`](#eventchanged)).
  `[Rubric §6, CQRS & Event-Driven]`. It is the one root event in this bounded context that carries a
  *second* identifier, the parent `EventId` (line 17), in addition to `Title`, so a subscriber knows which
  event's schedule moved (useful for invalidating that event's session list rather than the whole cache).
  Compare [`ActivityChanged`](#activitychanged), whose entity also has an `EventId` but whose event does not
  publish it: the two are inconsistent, and `SessionChanged` is the shape worth copying.
- **Walkthrough**: `sealed record class SessionChanged(DomainEntityState State, SessionIdentifierType SessionId, string Title, EventIdentifierType EventId)`
  chaining `(State, SessionId)` to the base (`SessionChanged.cs:13-18`).
- **Where it's used**: raised by [`Session`](#session)'s `Create` (declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/Session.cs:165`, raises at `:212`),
  `Update` (`:235`, raises at `:273`), and `Delete` (`:283`, raises at `:294`); captured by the outbox and
  dispatched in-process.
- **Caveats / not-in-source**: no handler subscribes today.

---

### SessionFeedbackSubmitted
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Sessions.IntegrationEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/IntegrationEvents/SessionFeedbackSubmitted.cs:21` · Level 3 · record (sealed)

- **What it is**: the session-level counterpart of [`EventFeedbackSubmitted`](#eventfeedbacksubmitted): the
  integration event Conference raises when an attendee submits feedback on a session, which Engagement turns
  into a points award.
- **Depends on**: [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent) and
  [`EventNameAttribute`](group-02-domain-building-blocks.md#eventnameattribute)
  (`[EventName("Conference.SessionFeedbackSubmitted.v1")]`, line 20); aliases `UserIdentifierType`,
  `SessionIdentifierType`, `EventIdentifierType`; BCL `DateTime`.
- **Concept**: the integration event introduced by [`EventFeedbackSubmitted`](#eventfeedbacksubmitted).
  `[Rubric §7, Microservices Readiness]` and `[Rubric §9, API & Contract Design]`. Same delivery contract
  (BR-107 upsert, create path only, idempotent consumer, `SessionFeedbackSubmitted.cs:9-14`); the only payload
  difference is that it carries **both** the `SessionId` and the owning `EventId` (lines 23-24), so the
  consumer can scope the award without a call back into Conference to resolve the session's parent. That extra
  id is the whole point of a self-contained contract: a cross-service consumer must not need a synchronous
  lookup to interpret the message.
- **Walkthrough**: four positional members
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/IntegrationEvents/SessionFeedbackSubmitted.cs:21-26`):
  `UserId`, `SessionId`, `EventId`, and `SubmittedOnUtc`.
- **Where it's used**: raised on the aggregate pre-save from two producers, both taking the timestamp from an
  injected `TimeProvider`.
  [`AddSessionQuestionAnswerHandler`](group-18-conference-application.md#addsessionquestionanswerhandler)
  raises it on its create path
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionQuestionAnswer/AddSessionQuestionAnswerHandler.cs:112`,
  inside `CreateNewAnswerAsync` at `:99-117`), and
  [`BatchAddSessionQuestionAnswersHandler`](group-18-conference-application.md#batchaddsessionquestionanswershandler)
  raises one per newly created answer inside its per-answer loop
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/BatchAddSessionQuestionAnswers/BatchAddSessionQuestionAnswersHandler.cs:155-156`).
  The batch path is the clearest illustration of why the consumer must be idempotent: one submitted form can
  emit the event many times inside a single transaction. It is consumed by
  [`SessionFeedbackSubmittedPointsHandler`](group-22-engagement-module.md#sessionfeedbacksubmittedpointshandler),
  which resolves it onto a session subject key and awards through
  [`IPointsAwarder`](group-22-engagement-module.md#ipointsawarder)
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Points/IntegrationEventHandlers/SessionFeedbackSubmittedPointsHandler.cs:42-49`),
  and is registered as a broker consumer in the Engagement service host
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:286`).

---

### SpeakerChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Speakers.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/DomainEvents/SpeakerChanged.cs:16` · Level 3 · record (sealed)

- **What it is**: the aggregate-root lifecycle event for a [`Speaker`](#speaker): raised on create, update, or
  delete. Its distinctive feature is a nullable `PreviousLinkedUserId` that snapshots the speaker-to-user link
  as it stood *before* the operation.
- **Depends on**:
  [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); aliases `SpeakerIdentifierType`,
  `UserIdentifierType`.
- **Concept**: the aggregate-root lifecycle event ([`EventChanged`](#eventchanged)), plus **carrying
  pre-mutation state on the event**. `[Rubric §6, CQRS & Event-Driven]` and
  `[Rubric §7, Microservices Readiness]` (a delete in Conference must trigger unlink cleanup on the Identity
  side, and that cleanup must not depend on reading a field the delete has already cleared). Per the XML doc
  (`SpeakerChanged.cs:12-15`), `PreviousLinkedUserId` is populated on the `Deleted` transition so the handler
  can perform the BR-70 cross-context cleanup after the entity's own link field has been nulled. This is also
  the one event in this part with a live subscriber, so it is the concrete sighting of the
  [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent)
  extension point.
- **Walkthrough**: `sealed record class SpeakerChanged(DomainEntityState State, SpeakerIdentifierType SpeakerId, string FullName, UserIdentifierType? PreviousLinkedUserId = null)`
  chaining `(State, SpeakerId)` to the base (`SpeakerChanged.cs:16-21`). The default `null` on the fourth
  parameter is what keeps the non-delete raise sites a three-argument call: `Create` (raises at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:168`), `Update` (`:235`),
  `LinkUser` (`:284`), and `UnlinkUser` (`:302`), while the `Delete` override (declared at `:251`) is the only
  four-argument call: it captures `LinkedUserId` into a local *before* calling `base.Delete()`, nulls the
  field, and passes the captured value (`Speaker.cs:253-265`). Note that `LinkUser` and `UnlinkUser` both emit
  `Updated`, not a bespoke link event, so a subscriber cannot tell a link change from a name edit by event
  type alone.
- **Why it's built this way**: an event is an immutable record of what already happened, so snapshotting the
  prior link onto the event avoids a lost-update race in which the cleanup handler would read an
  already-cleared field. It also decouples the delete transaction from the downstream unlink, which crosses a
  module and (in the deployed topology) a process boundary.
- **Where it's used**: consumed by
  [`SpeakerDeletedHandler`](group-18-conference-application.md#speakerdeletedhandler), the only
  `IDomainEventHandler` implementation in the Conference Application layer
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DomainEventHandlers/SpeakerDeletedHandler.cs:22`).
  It ignores every transition except `Deleted` (`:29-30`), then publishes
  [`SpeakerUnlinkedFromUser`](#speakerunlinkedfromuser) through
  [`IEventBus`](group-04-events-outbox.md#ieventbus) when `PreviousLinkedUserId` has a value, from a fresh DI
  scope because the handler is a singleton (`:38-45`). Identity then clears `User.LinkedSpeakerId`.

---

### SponsorChanged
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sponsors.DomainEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sponsors/DomainEvents/SponsorChanged.cs:12` · Level 3 · record (sealed)

- **What it is**: the aggregate-root lifecycle event for a [`Sponsor`](#sponsor): raised when a sponsor is
  created, updated, or soft-deleted. Carries the sponsor id and display name.
- **Depends on**:
  [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate); alias `SponsorIdentifierType`.
- **Concept**: the aggregate-root lifecycle event ([`EventChanged`](#eventchanged)).
  `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §16, Maintainability]`. Sponsors are among the newest
  aggregates in this bounded context, and the fact that its event is a five-line record derived from the same
  base is the payoff of the shared shape: a new aggregate gets the full lifecycle-event story without
  inventing anything.
- **Walkthrough**: three positional members (`SponsorChanged.cs:12-16`): `State`, `SponsorId`, and `Name`,
  with `(State, SponsorId)` forwarded to `EntityChangedEvent<SponsorIdentifierType>` on line 16.
- **Where it's used**: raised from [`Sponsor`](#sponsor)'s `Create` factory (declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sponsors/Sponsor.cs:105`, raises at `:133`),
  its `Update` path (`:153`, raises at `:183`), and its `Delete` override, which calls the base soft-delete
  first and raises the event only when that base call returned success (`:190-198`, raise at `:195`);
  dispatched in-process.
- **Caveats / not-in-source**: no handler subscribes today.

### SpeakerLinkedToUser
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers.IntegrationEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/IntegrationEvents/SpeakerLinkedToUser.cs:22` · Level 3 · record (sealed)

- **What it is**: the cross-module **integration event** Conference raises when it binds a
  [`Speaker`](#speaker) to an Identity `User`, either through the manual `LinkUserToSpeaker` command or
  through automatic email-match linking triggered by `UserRegistered`. Identity subscribes and sets
  `User.LinkedSpeakerId`, so the next token refresh carries the `speaker_id` claim (BR-209, per the XML
  doc at `SpeakerLinkedToUser.cs:6-18`).
- **Depends on**: [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent) (the base it
  derives from, `SpeakerLinkedToUser.cs:25`); the `EventName` attribute from
  `MMCA.Common.Domain.Attributes` (`SpeakerLinkedToUser.cs:1`, `:21`); the identifier aliases
  `UserIdentifierType` and `SpeakerIdentifierType`.
- **Concept introduced, the integration event (as distinct from the domain event).** `[Rubric §7,
  Microservices Readiness]` assesses whether cross-module coupling runs through a published contract a
  peer can consume without a code reference back into the producer, and `[Rubric §9, API & Contract
  Design]` treats the asynchronous message as a public contract in its own right. Three things separate
  this record from the domain events in this chapter. First, it derives from
  [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent) rather than
  [`BaseDomainEvent`](group-04-events-outbox.md#basedomainevent): a domain event stays inside the
  producing module, an integration event is meant to cross a module (and eventually a service) boundary
  over the broker via the outbox. Second, it lives in the `.Shared` project, not `.Domain`, precisely so
  the subscribing Identity module can reference the contract without pulling in Conference's domain
  model. Third, it carries `[EventName("Conference.SpeakerLinkedToUser.v1")]`
  (`SpeakerLinkedToUser.cs:21`): the wire name is pinned as data, so the CLR type can be renamed or
  moved without changing what a subscriber matches on, and the `.v1` suffix leaves room for a second
  shape alongside the first.
- **Walkthrough**: the whole type is a positional record, `sealed record class SpeakerLinkedToUser(
  UserIdentifierType UserId, SpeakerIdentifierType SpeakerId) : BaseIntegrationEvent`
  (`SpeakerLinkedToUser.cs:22-25`), preceded by the `EventName` attribute (`:21`). Two ids and nothing
  else: the receiver needs no more than that to set `LinkedSpeakerId`. The XML doc records that it
  replaced a former direct in-process call, `IUserSpeakerLinkService.LinkSpeakerAsync`
  (`SpeakerLinkedToUser.cs:12-17`).
- **Why it's built this way**: modeling the link as a published fact rather than a synchronous call is the
  outbox and eventual-consistency story of
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html); it lets Identity and
  Conference run as separate services with no shared database and no cross-database FK
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: raised on two different paths, and the difference is worth reading. The manual path
  in [`LinkUserToSpeakerHandler`](group-18-conference-application.md#linkusertospeakerhandler) calls
  `entity.AddDomainEvent(new SpeakerLinkedToUser(...))` (`LinkUserToSpeakerHandler.cs:63`), so the message
  is serialized into the outbox inside the same save as the aggregate change. The auto-link path in
  [`UserRegisteredHandler`](group-18-conference-application.md#userregisteredhandler) instead publishes
  through `IEventBus` (`UserRegisteredHandler.cs:81` on the already-linked branch, `:101` after the link
  is saved). It is consumed on the Identity side by
  [`SpeakerLinkedToUserHandler`](group-24-identity-module.md#speakerlinkedtouserhandler).

### SpeakerUnlinkedFromUser
> MMCA.ADC.Conference.Shared · `MMCA.ADC.Conference.Shared.Speakers.IntegrationEvents` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/IntegrationEvents/SpeakerUnlinkedFromUser.cs:19` · Level 3 · record (sealed)

- **What it is**: the inverse of [`SpeakerLinkedToUser`](#speakerlinkedtouser). Conference raises it
  when a speaker is unlinked from a user, either via the `UnlinkUserFromSpeaker` command or as cascade
  cleanup when a speaker is soft-deleted; Identity subscribes and clears `User.LinkedSpeakerId`
  (`SpeakerUnlinkedFromUser.cs:6-15`).
- **Depends on**: [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent)
  (`SpeakerUnlinkedFromUser.cs:22`); the `EventName` attribute (`:1`, `:18`); the aliases
  `UserIdentifierType`, `SpeakerIdentifierType`.
- **Concept**: the integration event taught at [`SpeakerLinkedToUser`](#speakerlinkedtouser). `[Rubric §7,
  Microservices Readiness]`. Same contract shape, same `.Shared` placement, same pinned wire name
  (`[EventName("Conference.SpeakerUnlinkedFromUser.v1")]`, `SpeakerUnlinkedFromUser.cs:18`). The one
  nuance worth reading off the parameter docs: the id actually being cleared is `UserId`, and `SpeakerId`
  rides along for audit and log correlation (`SpeakerUnlinkedFromUser.cs:16-17`).
- **Walkthrough**: `sealed record class SpeakerUnlinkedFromUser(UserIdentifierType UserId,
  SpeakerIdentifierType SpeakerId) : BaseIntegrationEvent` (`SpeakerUnlinkedFromUser.cs:19-22`). Like its
  sibling it replaced a direct call, here `IUserSpeakerLinkService.ClearLinkedSpeakerAsync`
  (`SpeakerUnlinkedFromUser.cs:10-14`).
- **Why it's built this way**: it closes the loop on the eventually-consistent link, and it is the
  downstream half of a [`SpeakerChanged`](#speakerchanged) delete. That is exactly why
  [`Speaker.Delete`](#speaker) snapshots the previous link id into a local **before** the soft-delete runs
  (`Speaker.cs:251-254`) and carries it on the domain event (`Speaker.cs:263`): the handler that publishes
  this integration event would otherwise have nothing left to read.
- **Where it's used**: added to the aggregate by
  [`UnlinkUserFromSpeakerHandler`](group-18-conference-application.md#unlinkuserfromspeakerhandler)
  (`UnlinkUserFromSpeakerHandler.cs:49`, before the save, so the outbox row is written in the same
  transaction) and published by the speaker-delete cleanup path in
  [`SpeakerDeletedHandler`](group-18-conference-application.md#speakerdeletedhandler)
  (`SpeakerDeletedHandler.cs:43`, BR-70). Consumed on the Identity side by
  [`SpeakerUnlinkedFromUserHandler`](group-24-identity-module.md#speakerunlinkedfromuserhandler).

### ActivityInvariants
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Activities` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Activities/ActivityInvariants.cs:13` · Level 6 · class (static)

- **What it is**: the domain rules for the [`Activity`](#activity) aggregate: a required name, three
  optional venue fields that are length-checked only, and a start-before-end time range check. The
  length constants declared here are read by domain validation, by the EF configuration, and by the
  application-layer rule types, so a column width and a domain rule cannot silently diverge
  (`ActivityInvariants.cs:7-12`).
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants)
  (`ActivityInvariants.cs:2`), [`Result`](group-01-result-error-handling.md#result)
  (`:3`), and [`ActivityDTO`](#activitydto) (`:1`), which is where the numbers actually live; BCL
  `DateTime`.
- **Concept**: the static-invariants-class pattern introduced for the framework at
  [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) and shown for a Conference
  aggregate at [`SessionInvariants`](#sessioninvariants). `[Rubric §4, Domain-Driven Design]`: the rules
  live in the domain rather than in a handler or a validator. Two things this class teaches that its
  siblings do not.
  1. **The length constant is a forwarder, not a literal.** Every `MaxLength` here is
     `public const int X = ActivityDTO.X` (`ActivityInvariants.cs:16-28`). The number is declared once on
     the Shared DTO, which the Blazor pages bind their input caps to, so the same cap is enforced at the
     input, at the domain rule, and at the column. `[Rubric §8, Data Architecture]` and `[Rubric §24,
     Forms/Validation/UX Safety]`: the UI stops the user before the domain has to, and neither can drift
     from the schema, because there is only one number.
  2. **The optional field is a first-class domain concept.** Three of the five rule methods take a
     `string?` and delegate to `CommonInvariants.EnsureOptionalStringMaxLength`, which passes a null or
     empty value. The doc on `EnsureVenueNameIsValid` states the reason plainly (`:41-44`): an empty venue
     name means the activity happens at the main conference venue, so absence is a meaningful value, not
     missing data.
- **Walkthrough**
  - **Length constants** (`ActivityInvariants.cs:16-28`), all `public const int` forwarding to
    [`ActivityDTO`](#activitydto): `NameMaxLength` (200), `DescriptionMaxLength` (2000),
    `VenueNameMaxLength` (200), `VenueAddressMaxLength` (500, chosen to match the event venue address per
    the doc at `:24`), and `VenueUrlMaxLength` (2000). The values themselves are declared at
    `ActivityDTO.cs:18`, `:21`, `:24`, `:27`, and `:30`.
  - **`EnsureNameIsValid`** (`:36-39`): the standard `Result.Combine` of
    `CommonInvariants.EnsureStringIsNotEmpty` plus `CommonInvariants.EnsureStringMaxLength`, tagged with
    the stable codes `Activity.Name.Empty` and `Activity.Name.TooLong`.
  - **`EnsureVenueNameIsValid`** (`:48-49`), **`EnsureVenueAddressIsValid`** (`:58-59`), and
    **`EnsureVenueUrlIsValid`** (`:68-69`): each is a single expression delegating to
    `CommonInvariants.EnsureOptionalStringMaxLength` with its own error code
    (`Activity.VenueName.TooLong`, `Activity.VenueAddress.TooLong`, `Activity.VenueUrl.TooLong`). Note
    what is deliberately absent for the URL: no scheme parse, no reachability check. The doc (`:61-64`)
    records that the value is stored as an opaque string with no fetch or upload pipeline behind it,
    matching the sponsor website-URL precedent, so only the storage constraint is enforced here.
  - **`EnsureTimeRangeIsValid`** (`:79-86`): delegates to the generic
    `CommonInvariants.EnsureEndIsNotBeforeStart`, failing with `Activity.TimeRange.Invalid`. The doc
    (`:71-74`) explains why the comparison is a plain one: both values are event-local wall times, and the
    IANA zone lives on the owning [`Event`](#event), never repeated per row. A zero-length activity is
    allowed; only an inverted range is rejected.
- **Why it's built this way**: pushing the "absent is legal" decision into the invariant, rather than
  into every caller, means a handler cannot accidentally require a venue name and the EF column cannot
  accidentally be narrower than the rule. Delegating the mechanics (optional max length, end-not-before-
  start) to [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) leaves this class
  holding only what is genuinely Conference vocabulary: which field, which error code, which message.
  Comparing naive wall times instead of instants keeps the domain free of time-zone conversion, which
  belongs where the zone is known.
- **Where it's used**: [`Activity.Create`](#activity) and [`Activity.Update`](#activity)
  (`Activity.cs:111-116` and `:155-160`); the length constants feed
  [`ActivityConfiguration`](group-19-conference-infrastructure.md#activityconfiguration)
  (`ActivityConfiguration.cs:20`, `:24`, `:36`, `:40`, `:44`) and the application-layer rule types
  [`ActivityNameRules<T>`](group-18-conference-application.md#activitynamerulest) and its siblings
  (`ActivityValidationRules.cs:17`, `:29`, `:41`, `:53`, `:71`).

### Category
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/Category.cs:16` · Level 6 · class (sealed, aggregate root)

- **What it is**: the aggregate root for a conference category, for example "Level", "Track", or "Session
  format" (`Category.cs:10-14`). Each category owns a collection of [`CategoryItem`](#categoryitem)
  children representing the selectable options inside it.
- **Depends on**:
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (the base, `Category.cs:16`), [`CategoryInvariants`](#categoryinvariants),
  [`CategoryItem`](#categoryitem), [`Result`](group-01-result-error-handling.md#result),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute), and the domain events
  [`CategoryChanged`](#categorychanged) and [`CategoryItemChanged`](#categoryitemchanged). Identifier
  aliases `ConferenceCategoryIdentifierType` and `CategoryItemIdentifierType`.
- **Concept introduced, the aggregate root as the consistency boundary.** `[Rubric §4, Domain-Driven
  Design]` assesses whether invariants are enforced inside a boundary and whether children are mutated
  only through their root. An **aggregate root** is the only member of its cluster a repository hands out;
  callers never hold a bare `CategoryItem`. Two consequences are visible directly in this file:
  1. **All child mutation routes through the parent.** `AddCategoryItem`, `UpdateCategoryItem`, and
     `RemoveCategoryItem` (`Category.cs:125`, `:156`, `:186`) live on `Category`, never on
     [`CategoryItem`](#categoryitem), and each raises a [`CategoryItemChanged`](#categoryitemchanged) from
     the root (for example `Category.cs:144`) so observers learn the aggregate changed.
  2. **The private list enforces encapsulation.** `_categoryItems` is a `private readonly
     List<CategoryItem>` (`Category.cs:27`); the public surface is the read-only projection
     `CategoryItems => _categoryItems.AsReadOnly()` (`Category.cs:31`). EF still materializes the backing
     field, which is why the private parameterless constructor exists (`Category.cs:34`).

  `[Rubric §8, Data Architecture]` also applies: cascade soft-delete is orchestrated by the aggregate, not
  by a handler. `Delete()` (`Category.cs:102-114`) cascade-soft-deletes every still-active child per BR-71
  before raising `CategoryChanged(Deleted)`.
- **Walkthrough**
  - **Marker** `[IdValueGenerated]` (`Category.cs:15`): category PKs are database-generated, and Sessionize
    imports still supply explicit ids via `IDENTITY_INSERT` (`Category.cs:13`).
  - **Fields** (`Category.cs:19-31`): `Title`, `Sort`, the optional `Type` (for example "session" or
    "speaker"), the private list, and the `CategoryItems` projection tagged `[Navigation(IsCollection =
    true)]` so the populator knows this is a child collection
    ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).
  - **Constructors** (`Category.cs:34-44`): the private EF constructor sets `Title = string.Empty` to
    satisfy the non-nullable field before EF assigns columns; the private field constructor is what the
    factory calls.
  - **`Create`** (`Category.cs:54-75`): validate through `CategoryInvariants.EnsureTitleIsValid`, then
    resolve whether the id is database-generated via `typeof(Category).IsIdValueGenerated`
    (`Category.cs:65`), then construct. The id expression is worth reading closely:
    `Id = id ?? (isIdValueGenerated ? default : throw new ArgumentNullException(nameof(id)))`
    (`Category.cs:69`), so a supplied id always wins, an omitted id is legal only because this type is
    id-value-generated, and any other combination fails loudly rather than silently writing a zero.
    Finally `AddDomainEvent(new CategoryChanged(DomainEntityState.Added, ...))` (`Category.cs:72`). This is
    the canonical validate, then construct, then emit shape used by every aggregate in this chapter.
  - **`Update`** (`Category.cs:84-98`): re-validates the title, writes the three scalars, raises
    `CategoryChanged(Updated)`.
  - **`Delete`** (`Category.cs:102-114`): one `Result.Combine` of
    `DeleteChildren<CategoryItem, CategoryItemIdentifierType>(_categoryItems)` and `base.Delete()`
    (`:106-108`). `DeleteChildren` is the framework helper on
    [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
    that replaced the loop each aggregate used to hand-roll; it skips already-deleted children so
    re-deleting a parent is idempotent. The comment at `:104-105` records the ordering rationale: children
    first, root last, so a failing child aggregates into the combined result instead of leaving a
    half-applied delete.
  - **`AddCategoryItem`** (`Category.cs:125-147`): uniqueness check first (BR-138) via
    `CategoryInvariants.EnsureCategoryItemNameIsUnique`, then delegate construction to
    `CategoryItem.Create`, then add to the private list, then emit. Callers never `new CategoryItem(...)`.
  - **`UpdateCategoryItem`** (`Category.cs:156-179`): resolves the child through the private
    `GetCategoryItemOrNotFound` helper (`Category.cs:205`, which wraps the base
    `GetChildOrNotFound<T, TId>` so a missing child becomes an
    [`Error`](group-01-result-error-handling.md#error) rather than a null), re-checks uniqueness while
    excluding the item being renamed (`:167-168`), then delegates to the child's own `Update`.
  - **`RemoveCategoryItem`** (`Category.cs:186-197`): a single call to the base
    `RemoveChildOrNotFound<CategoryItem, CategoryItemIdentifierType>` (`:188`), which resolves and
    soft-deletes in one step, then emits `CategoryItemChanged(Deleted)`.
  - **`SetCategoryItems`** (`Category.cs:201`): an `internal` hook used only by the navigation populator
    after a cross-source load. It calls the base `SetItems(_categoryItems, ...)` and raises **no** domain
    events, because it is hydration, not a domain mutation.
- **Why it's built this way**: a single class owning uniqueness, cascade delete, and event emission keeps
  the consistency rules in one place instead of scattered across handlers, and pushing the mechanical
  parts (`DeleteChildren`, `RemoveChildOrNotFound`, `GetChildOrNotFound`) down into the framework base
  leaves the aggregate holding only its own vocabulary.
  [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html) explains why
  `SetCategoryItems` exists at all: when category and items share a database EF `Include()` loads them
  together, but when they could be split the populator queries separately and calls the hook, so the
  aggregate stays agnostic to the load path.
- **Where it's used**: loaded through
  [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype),
  mutated by the Conference category command handlers such as
  [`AddCategoryItemHandler`](group-18-conference-application.md#addcategoryitemhandler), persisted through
  [`ConferenceCategoryConfiguration`](group-19-conference-infrastructure.md#conferencecategoryconfiguration),
  and projected to [`ConferenceCategoryDTO`](#conferencecategorydto) for the category UI.

### CategoryInvariants
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/CategoryInvariants.cs:15` · Level 6 · class (static)

- **What it is**: the invariant rules for [`Category`](#category) and its
  [`CategoryItem`](#categoryitem) children: title validation, item-name validation, and case-insensitive
  uniqueness checking (BR-138).
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (the reusable
  lower layer it delegates to, `CategoryInvariants.cs:3`),
  [`Result`](group-01-result-error-handling.md#result) and
  [`Error`](group-01-result-error-handling.md#error) (`:4`), [`CategoryItem`](#categoryitem) (it takes the
  child collection as a parameter), and [`ConferenceCategoryDTO`](#conferencecategorydto) plus
  [`CategoryItemDTO`](#categoryitemdto) (`:2`), where the numbers live; BCL `CultureInfo` (`:1`).
- **Concept**: the module invariants class (see [`SessionInvariants`](#sessioninvariants) and
  [`EventInvariants`](#eventinvariants)). The distinctive method here, which the simpler invariant classes
  lack, is the **collection-aware uniqueness guard**. `[Rubric §4, Domain-Driven Design]`: the
  ubiquitous-language rule "an item name is unique within its category" is expressed directly in the
  domain rather than deferred to a database index or a UI check.
- **Walkthrough**
  - **Length constants** (`CategoryInvariants.cs:18`, `:21`, `:24`): `TitleMaxLength` (255),
    `TypeMaxLength` (100), and `CategoryItemNameMaxLength` (500), all forwarding to the Shared DTO
    constants at `ConferenceCategoryDTO.cs:17`, `:20`, and `CategoryItemDTO.cs:16`. Note these are
    `public static readonly int` here rather than the `public const int` used by the other invariant
    classes in this chapter.
  - `EnsureTitleIsValid` (`:26-29`) and `EnsureCategoryItemNameIsValid` (`:31-34`): each a `Result.Combine`
    of `CommonInvariants.EnsureStringIsNotEmpty` plus `CommonInvariants.EnsureStringMaxLength`, with the
    message built through `string.Create(CultureInfo.InvariantCulture, ...)` so the text does not vary by
    ambient culture. That call is needed here and not in the sibling classes precisely because the length
    is a `static readonly int` rather than a compile-time constant, so the interpolation is evaluated at
    run time.
  - `EnsureCategoryItemNameIsUnique` (`:44-65`): takes the existing item collection plus an optional
    `excludeItemId` (so renaming an item to its own name during an update does not self-conflict). It
    skips `IsDeleted` items and compares with `StringComparison.OrdinalIgnoreCase` (`:53-56`), returning
    `Error.Conflict("CategoryItem.Name.Duplicate")` on a duplicate (`:58-64`). The inline comment at
    `:50-52` records why the exclusion is modeled as a nullable rather than defaulted: defaulting to
    `default(id)` would silently exclude every unsaved sibling, since a database-generated `CategoryItem`
    id is 0 until the save.
- **Why it's built this way**: co-locating the rules per aggregate keeps the entity itself readable, and
  the `Result`-returning style composes with `Result.Combine`. The uniqueness method takes the collection
  as a parameter so it stays a **pure** function with no repository and no EF dependency, which is what
  lets the aggregate call it in memory.
- **Where it's used**: called from [`Category`](#category)'s `Create`, `Update`, `AddCategoryItem`, and
  `UpdateCategoryItem`, and from [`CategoryItem`](#categoryitem)'s `Create` and `Update`; the length
  constants are read by the Categories EF configurations
  ([`ConferenceCategoryConfiguration`](group-19-conference-infrastructure.md#conferencecategoryconfiguration)
  at `:27` and `:34`,
  [`CategoryItemConfiguration`](group-19-conference-infrastructure.md#categoryitemconfiguration) at `:19`).
- **Caveats / not-in-source**: `TypeMaxLength` has **no** rule method. Nothing in this class validates
  `Category.Type`, and neither `Category.Create` nor `Category.Update` checks it (`Category.cs:60-61`,
  `:86-87`); the constant's only consumer is the EF column at `ConferenceCategoryConfiguration.cs:34`, so
  an over-long `Type` is caught at the database, not by the domain.

### CategoryItem
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/CategoryItem.cs:14` · Level 6 · class (sealed, child entity)

- **What it is**: the child entity of [`Category`](#category): one selectable option inside a category,
  for example "Beginner" within "Level" or "C#" within "Language" (`CategoryItem.cs:8-12`). It carries
  `Name`, `Sort`, the back-navigation `Category?`, and the FK `CategoryId`.
- **Depends on**:
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (`CategoryItem.cs:14`), [`Category`](#category), [`CategoryInvariants`](#categoryinvariants),
  [`Result`](group-01-result-error-handling.md#result),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute).
- **Concept introduced, the child entity as distinct from the aggregate root.** `[Rubric §4,
  Domain-Driven Design]` covers the entity hierarchy *within* an aggregate. A **child entity** has its own
  identity (it extends
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype),
  so it gets soft-delete and audit fields) but it is owned by a root, is never fetched directly from a
  repository, and, decisively, **raises no domain events**: its `Create` (`CategoryItem.cs:47-65`) mirrors
  the root's validate-then-construct shape but ends without an `AddDomainEvent` call, because event
  emission is the root's job.
- **Walkthrough**
  - `[IdValueGenerated]` (`CategoryItem.cs:13`): item PKs are database-generated, with the same Sessionize
    `IDENTITY_INSERT` exception as the parent.
  - `[Navigation] public Category? Category { get; private set; }` (`CategoryItem.cs:23-24`): the
    back-navigation. The setter is private, and the one legitimate writer goes through the explicit
    `SetCategory(Category?)` method at `CategoryItem.cs:89`, which the navigation populator calls after a
    cross-source load. `[Rubric §1, SOLID]`: a named method is a narrower and more searchable extension
    point than a public setter.
  - `CategoryId` (`CategoryItem.cs:27`): the FK, get-only, never externally assigned; EF populates it by
    relationship fixup off the parent's `CategoryItems` navigation.
  - `Create` (`CategoryItem.cs:47-65`): validates the name through
    [`CategoryInvariants`](#categoryinvariants), resolves `typeof(CategoryItem).IsIdValueGenerated`
    (`:57`), and constructs with the same `id ?? (isIdValueGenerated ? default : throw ...)` expression as
    the root (`:61`).
  - `Update` (`CategoryItem.cs:73-85`): re-validates the name, then writes `Name` and `Sort`. Again no
    event; the root's `UpdateCategoryItem` raises [`CategoryItemChanged`](#categoryitemchanged) around it.
- **Why it's built this way**: keeping the child lean, holding only its own field constraints, means a
  caller cannot bypass the parent's uniqueness and cascade rules by reaching in and calling
  `categoryItem.Update(...)` directly. The parent method is the only path that also runs BR-138.
- **Where it's used**: loaded through [`Category`](#category) (EF `Include` or the navigation populator);
  referenced by [`SpeakerCategoryItem`](#speakercategoryitem) and
  [`SessionCategoryItem`](#sessioncategoryitem) as the target of those many-to-many bridges; projected to
  [`CategoryItemDTO`](#categoryitemdto).

### EventInvariants
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/EventInvariants.cs:13` · Level 6 · class (static)

- **What it is**: the static invariants toolbox for the [`Event`](#event) aggregate and its children
  ([`Room`](#room), [`EventQuestionAnswer`](#eventquestionanswer)). It holds the field-length constants
  and the `Ensure...` rule methods that the domain factories, the EF configuration, and the
  application-layer rules all reuse, so a business rule is stated once (`EventInvariants.cs:7-12`).
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (`:2`),
  [`Result`](group-01-result-error-handling.md#result) and
  [`Error`](group-01-result-error-handling.md#error) (`:3`), and [`EventDTO`](#eventdto) plus
  [`RoomDTO`](#roomdto) (`:1`), which declare the numbers; BCL `DateOnly`. Alias `RoomIdentifierType`.
- **Concept**: the module invariants class, the same idiom taught for the framework at
  [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) and for a Conference aggregate
  at [`SessionInvariants`](#sessioninvariants), here in its widest form: fifteen length constants, a
  reserved id range, and six rule methods covering a root plus two children. `[Rubric §4, Domain-Driven
  Design]` (invariants live in the domain, expressed as reusable named rules rather than inline `if`
  blocks) and `[Rubric §8, Data Architecture]` (the `MaxLength` constants are the single source of truth
  shared by the EF column configuration and by validation, keeping schema and rule in sync). Each
  `Ensure...` returns a [`Result`](group-01-result-error-handling.md#result) rather than throwing, and
  callers combine several through `Result.Combine`. Read this class next to
  [`ActivityInvariants`](#activityinvariants) to see the same forwarding discipline: fourteen of the
  fifteen constants are `= EventDTO.X` or `= RoomDTO.X`, so the number is declared once on the Shared DTO
  the Blazor input caps also bind to.
- **Walkthrough**, in teaching order:
  - **Length constants** (`EventInvariants.cs:16-58`), all `public const int`: `NameMaxLength` (500),
    `DescriptionMaxLength` (4000), `TimeZoneMaxLength` (100), `SessionizeCodeMaxLength` (100),
    `VenueAddressMaxLength` (500), `VenueMapUrlMaxLength` (2000), `WiFiInfoMaxLength` (500),
    `OrganizerContactEmailMaxLength` (255, `:37`), `SponsorshipPacketUrlMaxLength` (2000, `:40`),
    `TicketingUrlMaxLength` (2000, `:43`), and the four room limits (`RoomNameMaxLength` 255,
    `RoomFloorMaxLength` 100, `RoomLocationMaxLength` 255, `RoomAccessibilityInfoMaxLength` 500). The
    values are declared at `EventDTO.cs:17-44` and `RoomDTO.cs:16-25`. The lone exception is
    `AnswerValueMaxLength` (4000, `:58`), a literal here because no DTO owns it: the answer value has no
    organizer-facing input cap to bind to.
  - **Reserved id range** (`EventInvariants.cs:60-68`): `RoomManualIdRangeStart` (999_999_000) and
    `RoomManualIdRangeEnd` (999_999_999), both `static readonly RoomIdentifierType`. Room ids are
    app-assigned, the int PK **is** the Sessionize id, so organizer-created rooms draw from this reserved
    high range and never collide with a real Sessionize id. The comment (`:61-63`) notes it mirrors
    [`SessionInvariants`](#sessioninvariants)`.ManualIdRangeStart`.
  - **`EnsureNameIsValid`** (`:70-73`): a `Result.Combine` of a not-empty and a max-length check delegated
    to [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants).
  - **`EnsureTimeZoneIsValid`** (`:81-102`): an explicit `IsNullOrWhiteSpace` guard first
    (`Event.TimeZone.Empty`, `:83-90`), then max length (`:92-94`), then a delegation to
    `CommonInvariants.EnsureTimeZoneIsValid` (`:96-101`) that maps an unrecognized identifier to
    `Event.TimeZone.Invalid` (BR-87). The framework helper owns the actual BCL lookup; the domain carries
    no zone table of its own and names only the error code and message.
  - **`EnsureDateRangeIsValid`** (`:111-118`): delegates to `CommonInvariants.EnsureEndIsNotBeforeStart`
    with the code `Event.DateRange.Invalid`, so a single-day event (equal dates) is legal.
  - **`EnsureRoomCapacityIsValid`** (`:126-132`): delegates to
    `CommonInvariants.EnsureNullableIntIsPositive` with `Room.Capacity.Invalid`, so a `null` capacity
    passes and a supplied non-positive one fails (BR-93).
  - **`EnsureRoomNameIsValid`** (`:134-137`) and **`EnsureAnswerValueIsValid`** (`:139-142`): not-empty
    plus max-length pairs for the two children.
  - **`EnsureEventIsPublished`** (`:150-156`): guards actions that require a published event (BR-108),
    delegating to `CommonInvariants.EnsureFlagIsTrue` and failing with `Event.NotPublished`.
- **Why it's built this way**: keeping the length limits as constants read by the EF configuration and by
  the domain prevents the classic drift where a validator accepts a value the column then truncates.
  Returning [`Result`](group-01-result-error-handling.md#result) instead of throwing keeps validation
  composable at the factory, where several checks are combined into one error list. Every rule that has a
  reusable mechanism behind it (time-zone lookup, range comparison, nullable positive, flag) is a thin
  delegation, so the Conference-specific part of each rule is exactly the error code, the message, and the
  target field name, which is the vocabulary the framework must not invent.
- **Where it's used**: the [`Event`](#event), [`Room`](#room), and
  [`EventQuestionAnswer`](#eventquestionanswer) factories and updaters call these; the length constants are
  read by [`EventConfiguration`](group-19-conference-infrastructure.md#eventconfiguration) and
  [`RoomConfiguration`](group-19-conference-infrastructure.md#roomconfiguration) and by the
  application-layer event and room validation rules. `EnsureEventIsPublished` is called from
  [`AddEventQuestionAnswerHandler`](group-18-conference-application.md#addeventquestionanswerhandler)
  (`AddEventQuestionAnswerHandler.cs:40`) and
  [`SessionQuestionAnswerRules`](group-18-conference-application.md#sessionquestionanswerrules)
  (`SessionQuestionAnswerRules.cs:46`). The reserved room-id range is consumed in two places:
  [`AddRoomHandler`](group-18-conference-application.md#addroomhandler) allocates the next free id from it
  and refuses once it is exhausted (`AddRoomHandler.cs:132-140`), and
  [`RoomSyncStrategy`](group-18-conference-application.md#roomsyncstrategy) skips any Sessionize room whose
  id falls inside it, recording a warning rather than importing a colliding row
  (`RoomSyncStrategy.cs:95-97`).

### QuestionInvariants
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/QuestionInvariants.cs:13` · Level 6 · class (static)

- **What it is**: the domain rules for the [`Question`](#question) aggregate: text length, target entity
  ("Session", "Event", "Speaker"), input type ("Rating", "Text", "Email"), source ("Sessionize", "User"),
  and, the richest part, type-specific answer validation (BR-124).
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (`:2`),
  [`Result`](group-01-result-error-handling.md#result) and
  [`Error`](group-01-result-error-handling.md#error) (`:3`), [`QuestionDTO`](#questiondto) (`:1`); BCL
  `int.TryParse`, `NumberStyles`, `CultureInfo`, and `System.Net.Mail.MailAddress`.
- **Concept**: the same invariants-class pattern as [`EventInvariants`](#eventinvariants), but notably
  richer. `[Rubric §4, Domain-Driven Design]`: the closed value sets and the answer rules are expressed as
  domain logic, not as API or UI validation. The permitted values are held as **data** rather than as long
  `switch` statements: `ValidQuestionEntities`, `ValidQuestionTypes`, and `ValidQuestionSources` are
  `private static readonly string[]` (`QuestionInvariants.cs:31`, `:34`, `:37`) checked with
  `StringComparer.OrdinalIgnoreCase`.
- **Walkthrough**
  - Length constants (`QuestionInvariants.cs:16-28`): `QuestionTextMaxLength` (1000) and the three 20-char
    discriminator limits (`QuestionEntityMaxLength`, `QuestionTypeMaxLength`, `QuestionSourceMaxLength`),
    all forwarding to [`QuestionDTO`](#questiondto) (`QuestionDTO.cs:17-26`), plus `TextAnswerMaxLength`
    (2000, `:28`), the one literal, because the answer cap is a BR-124 rule rather than a bound input
    field.
  - The user-created id range `ManualIdRangeStart` / `ManualIdRangeEnd` (`:40`, `:43`, 999_999_000 to
    999_999_999), distinguishing Sessionize ids from user-created ones, the same device
    [`SessionInvariants`](#sessioninvariants) and [`EventInvariants`](#eventinvariants) use.
  - `EnsureQuestionTextIsValid` (`:51-63`): an explicit `IsNullOrWhiteSpace` guard first, then max length
    via `CommonInvariants.EnsureStringMaxLength`.
  - `EnsureQuestionEntityIsValid` (`:71-78`), `EnsureQuestionTypeIsValid` (`:86-93`), and
    `EnsureQuestionSourceIsValid` (`:101-108`): membership tests against the closed arrays, each returning
    a specific `Error.Invariant` code.
  - `EnsureAnswerValueMatchesQuestionType` (`:118-129`): a `switch` expression on `questionType`
    dispatching to three private validators, because what counts as a valid answer depends on the
    question's type:
    - `ValidateRatingAnswer` (`:131-143`): `int.TryParse` with `NumberStyles.Integer` and
      `CultureInfo.InvariantCulture`, requiring 1 to 5, otherwise `Error.Validation`. The invariant culture
      is deliberate: a rating must parse identically wherever the request originates.
    - `ValidateTextAnswer` (`:145-157`): length must not exceed `TextAnswerMaxLength` (2000).
    - `ValidateEmailAnswer` (`:159-174`): constructs a `System.Net.Mail.MailAddress` and treats a
      `FormatException` as invalid, letting the BCL be the format authority.
    - An unrecognized type falls through to `Error.Invariant("Question.QuestionType.Unknown")`
      (`:124-128`). Note the dispatch is an ordinal `switch` on the literal strings, so it is
      case-sensitive here even though `EnsureQuestionTypeIsValid` accepts any casing.
- **Why it's built this way**: encoding answer-shape rules in the domain means the model rejects a
  malformed rating or email before it can reach a handler or the database, and expressing the allowed sets
  as arrays keeps adding a new question type a one-line data change rather than a code restructure.
- **Where it's used**: called from [`Question`](#question)'s `Create` and `Update`;
  `EnsureAnswerValueMatchesQuestionType` is applied by the answer-recording paths in the Application tier,
  [`AddEventQuestionAnswerHandler`](group-18-conference-application.md#addeventquestionanswerhandler)
  (`AddEventQuestionAnswerHandler.cs:77`) and
  [`SessionQuestionAnswerRules`](group-18-conference-application.md#sessionquestionanswerrules)
  (`SessionQuestionAnswerRules.cs:69`); the length constants feed
  [`QuestionConfiguration`](group-19-conference-infrastructure.md#questionconfiguration)
  (`QuestionConfiguration.cs:19`, `:23`, `:27`, `:37`).
- **Caveats / not-in-source**: the XML doc on `EnsureQuestionEntityIsValid` (`:66`) still says the valid
  values are "Session" or "Event", while the array (`:31`) and the failure message (`:75`) both include
  "Speaker". The array is the operative rule; that one doc line is stale.

### Event
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:23` · Level 7 · class (sealed, aggregate root)

- **What it is**: the aggregate root for a conference event. It owns three child collections
  ([`Room`](#room)s, [`EventSpeaker`](#eventspeaker) associations, and
  [`EventQuestionAnswer`](#eventquestionanswer)s) and enforces every rule about them through its own
  methods. Event ids are database-generated, not sourced from Sessionize (`Event.cs:12-15`).
- **Depends on**:
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  and [`IAuditedEntity`](group-02-domain-building-blocks.md#iauditedentity) (both on `Event.cs:23`),
  [`EventInvariants`](#eventinvariants), [`Result`](group-01-result-error-handling.md#result) and
  [`Error`](group-01-result-error-handling.md#error),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute),
  [`QuestionModerationDefault`](#questionmoderationdefault) (from
  `MMCA.ADC.Conference.Shared.Events`, `Event.cs:2`), and the
  [`EventChanged`](#eventchanged) / [`RoomChanged`](#roomchanged) /
  [`EventSpeakerChanged`](#eventspeakerchanged) /
  [`EventQuestionAnswerChanged`](#eventquestionanswerchanged) domain events. Aliases
  `EventIdentifierType`, `RoomIdentifierType`, `EventSpeakerIdentifierType`,
  `EventQuestionAnswerIdentifierType`, `SpeakerIdentifierType`, `QuestionIdentifierType`,
  `UserIdentifierType`.
- **Concept**: the aggregate root taught at [`Category`](#category), here in its fullest expression in
  this chapter, plus two things `Category` does not show. `[Rubric §4, Domain-Driven Design]` and
  `[Rubric §1, SOLID]`: child collections are exposed only as read-only views over private backing lists,
  all mutation flows through root methods, each mutation validates and then raises a domain event, and the
  root owns cascade delete. `[Rubric §6, CQRS & Event-Driven]`: every state change announces itself, which
  is what gives the outbox a single ordered stream. Two additions worth naming:
  1. **Selective auditing.** `Event` implements
     [`IAuditedEntity`](group-02-domain-building-blocks.md#iauditedentity) (`Event.cs:23`). The class doc
     (`Event.cs:16-20`) states the reason as a cost-benefit judgment rather than a blanket policy: the
     event record is the schedule everything else hangs off, several organizers edit it, and a wrong date,
     venue or live window is felt by every attendee, so one trail row per change is worth it.
  2. **Selective navigation.** `Rooms` and `EventSpeakers` are marked `[Navigation(IsCollection = true)]`
     (`Event.cs:88`, `:94`) but `EventQuestionAnswers` deliberately is **not** (`Event.cs:99-109`).
     `[Rubric §12, Performance & Scalability]`: the remarks record that the collection grows with
     attendance rather than with the schedule, that it rode along on public reads that never render it
     ([`PublicSessionList`](group-21-conference-ui.md#publicsessionlist) pulls events-with-children only to
     build a room-name dictionary), and that it is per-attendee feedback behind an anonymous endpoint.
     Handlers that genuinely need it pass an explicit `includes:` list instead.
- **Walkthrough**, in teaching order:
  - **`[IdValueGenerated]`** on the class (`Event.cs:22`): the factory reads this at run time through
    `typeof(Event).IsIdValueGenerated` (`Event.cs:187`).
  - **Scalar state** (`Event.cs:25-83`): `Name`, `Description?`, `StartDate`/`EndDate` (`DateOnly`),
    `TimeZone`, `SessionizeCode?`, `VenueAddress?`, `VenueMapUrl?`, `WiFiInfo?`,
    `OrganizerContactEmail?` (`:56`, falling back to the host-configured support address when absent),
    `SponsorshipPacketUrl?` (`:62`, whose absence hides the sponsorship call to action entirely),
    `TicketingUrl?` (`:68`, whose absence likewise hides the ticketing call to action on the landing and
    public event pages), `IsPublished`, `QuestionModerationDefault` (`:77`, the BR-233 initial status a
    newly submitted live-layer question receives), and the nullable
    `LastSessionizeRefreshOn`/`LastSessionizeRefreshBy` refresh-audit pair. All have private setters.
  - **Child collections** (`Event.cs:85-109`): three private `List<T>` backing fields exposed as
    `IReadOnlyCollection<T>` projections.
  - **Constructors** (`Event.cs:112-144`): a private parameterless EF constructor that seeds the
    non-nullable strings, plus a private twelve-parameter field constructor used by the factory.
  - **`Create`** (`Event.cs:164-210`): combines `EnsureNameIsValid`, `EnsureTimeZoneIsValid`, and
    `EnsureDateRangeIsValid` (`:180-183`); on success builds the instance with
    `Id = isIdValueGenerated ? default : id!.Value` (`:203`) and sets `QuestionModerationDefault` (`:204`,
    defaulted to `QuestionModerationDefault.Pending` at the parameter, `:175`), then raises
    `EventChanged(Added)` (`:207`).
  - **`Update`** (`Event.cs:229-268`): re-validates the same three invariants (`:244-247`), writes the
    scalars including the moderation default and the optional email and two URLs, raises
    `EventChanged(Updated)` (`:265`).
  - **`Publish`** and **`Unpublish`** (`Event.cs:272`, `:292`): flip `IsPublished`, refusing a no-op
    transition with `Event.AlreadyPublished` / `Event.AlreadyUnpublished`, and raise
    `EventChanged(Updated)`.
  - **`RecordSessionizeRefresh`** (`Event.cs:316-320`): stamps `LastSessionizeRefreshOn`/`By` from a
    caller-supplied UTC instant. The parameter doc (`:312-315`) is explicit that the value comes from an
    injected `TimeProvider` so the domain never reads an ambient clock. `[Rubric §14, Testability]`. Note
    this method returns `void` and raises no event.
  - **`Delete`** (`Event.cs:328-343`): overrides the base soft-delete as one `Result.Combine` of three
    `DeleteChildren<T, TId>` calls (rooms, event-speakers, answers) plus `base.Delete()` (`:333-337`,
    BR-72), then raises `EventChanged(Deleted)` only when the whole cascade succeeded. The comment at
    `:330-332` records why children come first: `Result.Combine` aggregates every child failure with the
    root's own, so a failing child leaves the cascade reported as a failure instead of a half-applied
    delete. Session cascade is deliberately **not** here: it is handled a layer up (BR-127) because
    sessions are separate aggregates, which is what
    [`IEventCascadeDeletionDomainService`](#ieventcascadedeletiondomainservice) exists for.
  - **Room management** (`Event.cs:358-499`): `AddRoom` (`:358`) checks name uniqueness first, delegates to
    `Room.Create`, adds, and raises `RoomChanged(Added)`; `UpdateRoom` (`:395`) resolves the child,
    re-checks uniqueness excluding itself, and delegates. `RestoreRoom` (`:438`) is the BR-135
    reactivation path and the most defensive method on the type. It takes the room **instance** rather
    than an id because a soft-deleted row is excluded by the global query filter and so is not reachable
    through the loaded collection (`:428-433`), and it then runs its guards in order: the room must belong
    to **this** event (`:447`, `Event.Room.WrongEvent`), whose comment at `:442-446` explains the stakes
    precisely (`Room.EventId` has no setter and is populated purely by EF relationship fixup off this
    `Rooms` navigation, so adding a foreign room here would silently rewrite its `EventId` on save and
    move the row out of its real event); the incoming name must clear the same uniqueness bar as an add
    (`:459`, with the comment at `:456-458` noting that otherwise a Sessionize refresh restoring a room
    whose name an organizer has since reused would fail on the database index and abort the whole
    refresh); and only then `room.Update` runs (`:465`) **before** the base
    `RestoreChild<Room, RoomIdentifierType>` helper (`:469-470`), so a rejected name leaves the room
    untouched and still deleted rather than half-restored. `RestoreChild` is where the "must actually be
    soft-deleted" guard lives, which is why the aggregate hands it the error code
    `"Event.Room.NotDeleted"` as a parameter (`:470`): the framework enforces the rule, the module owns
    the vocabulary. It raises `RoomChanged(Added)` (`:474`) because the room re-enters the visible set.
    `RemoveRoom` (`:484`) delegates to `RemoveChildOrNotFound` and raises `RoomChanged(Deleted)`.
  - **Event-speaker management** (`Event.cs:509-581`): `AddEventSpeaker` (`:509`) guards duplicates in
    memory (`:513`) with `Event.Speaker.Duplicate`; `RestoreEventSpeaker` (`:546`) is the join-entity
    counterpart to `RestoreRoom` and is far shorter, a single `RestoreChild` call with
    `"Event.Speaker.NotDeleted"` (`:550-551`), because the join carries no organizer-entered data, so
    there is nothing to re-apply and no uniqueness to re-check (`:539-543`); `RemoveEventSpeaker` (`:565`)
    soft-deletes through `RemoveChildOrNotFound`.
  - **Answer management** (`Event.cs:592-650`): `AddEventQuestionAnswer` (`:592`),
    `UpdateEventQuestionAnswer` (`:616`), `RemoveEventQuestionAnswer` (`:639`). Unlike the two collections
    above, the add has **no** duplicate guard: an event answering the same question twice is not blocked
    in the domain.
  - **Populator hooks** (`Event.cs:498`, `:580`, `:654`): `SetRooms`, `SetEventSpeakers`, and
    `SetEventQuestionAnswers` are `internal` and call the base `SetItems`, raising no events
    ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).
  - **Private helpers** (`Event.cs:668-695`): `EnsureRoomNameIsUnique` (`:668`), whose doc comment notes
    the ordinal-ignore-case comparison is chosen to match the database uniqueness index under the server's
    default case-insensitive collation, and which uses the same nullable-exclusion shape as
    [`CategoryInvariants`](#categoryinvariants) (`:676`); plus two `Get...OrNotFound` wrappers over the
    base `GetChildOrNotFound` so a missing child returns an
    [`Error`](group-01-result-error-handling.md#error) rather than a null, `GetRoomOrNotFound` (`:687`)
    and `GetEventQuestionAnswerOrNotFound` (`:692`). There is no event-speaker equivalent, because no
    method on this type needs to resolve a join by id and then act on it: add guards in memory, restore
    takes the instance, and remove goes straight through `RemoveChildOrNotFound`.
- **Why it's built this way**: routing every child change through the root is what makes the invariants
  (no duplicate room name, cascade on delete) enforceable at all, and what gives the outbox an ordered
  change stream. Passing the clock in rather than reading `DateTime.UtcNow` keeps the domain
  deterministic. The restore methods exist because Sessionize is an upstream feed that can withdraw and
  reinstate a room or a speaker, and reactivating a soft-deleted row preserves its id and history where
  re-creating it would not (BR-135). The mechanical halves of all of that (cascade, remove, restore,
  resolve) live on the framework base, so this file reads as a list of Conference rules rather than a list
  of collection manipulations.
- **Where it's used**: loaded and mutated by the Conference application-layer command handlers (Group 18);
  persisted through [`EventConfiguration`](group-19-conference-infrastructure.md#eventconfiguration);
  hydrated by [`EventNavigationPopulator`](group-18-conference-application.md#eventnavigationpopulator);
  projected to [`EventDTO`](#eventdto) for the read endpoints; and referenced by FK from
  [`Activity`](#activity), [`Room`](#room), [`EventSpeaker`](#eventspeaker), and
  [`EventQuestionAnswer`](#eventquestionanswer).

### EventQuestionAnswer
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/EventQuestionAnswer.cs:13` · Level 7 · class (sealed, child entity)

- **What it is**: a child entity of [`Event`](#event) storing the event's answer to one custom-form
  [`Question`](#question) (`EventQuestionAnswer.cs:8-11`). Database-generated id.
- **Depends on**:
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (`EventQuestionAnswer.cs:13`), [`EventInvariants`](#eventinvariants),
  [`Result`](group-01-result-error-handling.md#result),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute). Aliases
  `EventQuestionAnswerIdentifierType`, `QuestionIdentifierType`, `EventIdentifierType`.
- **Concept**: the child entity taught at [`CategoryItem`](#categoryitem), here under a different root.
  `[Rubric §4, Domain-Driven Design]`. It has identity, soft-delete, and audit fields but no domain-event
  list of its own: neither `Create` nor `UpdateAnswer` calls `AddDomainEvent`, because [`Event`](#event)
  wraps both and raises [`EventQuestionAnswerChanged`](#eventquestionanswerchanged) itself. Unlike
  [`Room`](#room) and [`EventSpeaker`](#eventspeaker) it does **not** implement
  [`IReactivatable`](group-02-domain-building-blocks.md#ireactivatable), which is the decisive difference:
  a withdrawn answer is not something an upstream feed reinstates, so the type never publishes a
  reactivation capability and the base `RestoreChild` helper cannot be pointed at it.
- **Walkthrough**: `[IdValueGenerated]` (`:12`); `QuestionId` (the FK to the answered question) and
  `AnswerValue`, both with private setters (`:15-19`); the `[Navigation] Event?` back-navigation with a
  private setter and the get-only `EventId` FK (`:21-26`); a private EF constructor that seeds
  `AnswerValue = string.Empty` and a private field constructor (`:28-37`); `Create` (`:46-64`), which
  validates through `EventInvariants.EnsureAnswerValueIsValid` and assigns
  `Id = isIdValueGenerated ? default : id!.Value` (`:60`); `UpdateAnswer` (`:71-80`), which re-validates
  and then writes `AnswerValue`; and `SetEvent(Event?)` (`:84`), the explicit populator hook that replaces
  a public navigation setter.
- **Why it's built this way**: keeping the answer a child of the event rather than a standalone aggregate
  means it shares the event's transaction and cascade delete, and its lifecycle notifications flow through
  the root's ordered event stream.
- **Where it's used**: created and mutated only through [`Event`](#event)'s `AddEventQuestionAnswer`,
  `UpdateEventQuestionAnswer`, and `RemoveEventQuestionAnswer`; mapped by
  [`EventQuestionAnswerConfiguration`](group-19-conference-infrastructure.md#eventquestionanswerconfiguration).
  Because the collection is not marked `[Navigation]`, handlers that need it request it explicitly rather
  than getting it from the populator.
- **Caveats / not-in-source**: nothing in this file checks that `AnswerValue` matches the referenced
  question's type. `EventInvariants.EnsureAnswerValueIsValid` (`EventInvariants.cs:139`) only enforces
  not-empty plus 4000 characters. The BR-124 shape rule
  (`QuestionInvariants.EnsureAnswerValueMatchesQuestionType`, `QuestionInvariants.cs:118`) is applied one
  layer up by
  [`AddEventQuestionAnswerHandler`](group-18-conference-application.md#addeventquestionanswerhandler)
  (`AddEventQuestionAnswerHandler.cs:77`), where the handler has the question in hand; the reason the
  check cannot live in a validator is recorded at
  `UpdateEventQuestionAnswerCommandValidator.cs:14`.

### EventSpeaker
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/EventSpeaker.cs:14` · Level 7 · class (sealed, join entity)

- **What it is**: the join entity linking an [`Event`](#event) to a [`Speaker`](#speaker), that is, which
  speakers appear at which event (`EventSpeaker.cs:9-12`). Database-generated id.
- **Depends on**:
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  and [`IReactivatable`](group-02-domain-building-blocks.md#ireactivatable) (both on `EventSpeaker.cs:14`),
  [`Result`](group-01-result-error-handling.md#result),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute). Aliases
  `EventSpeakerIdentifierType`, `SpeakerIdentifierType`, `EventIdentifierType`.
- **Concept introduced, the explicit join entity.** `[Rubric §4, Domain-Driven Design]` and `[Rubric §8,
  Data Architecture]`. Rather than let EF create an implicit link table, the many-to-many is modeled as a
  real entity, which is what gives the association its own id, its own soft-delete flag, and its own audit
  trail. This is the thinnest child in the chapter: it holds only the `SpeakerId` FK plus the standard
  back-navigation and `EventId`, so `Create` (`:37-49`) does no validation at all beyond assigning the id.
  There is no `Update`, because a join either exists or it does not.
- **Walkthrough**: `[IdValueGenerated]` (`:13`); `SpeakerId` (`:17`); the `[Navigation] Event?` with a
  private setter and the get-only `EventId` (`:19-24`); an empty private EF constructor and a one-line
  private field constructor (`:27`, `:29`); `Create` (`:37-49`); `Reactivate()` (`:57`), a one-line
  delegation to the base `Undelete()`; and `SetEvent(Event?)` (`:61`) for the populator. The `Reactivate`
  doc (`:51-56`) explains its reason for existing: the join row carries the Sessionize-assigned speaker
  id, so an association that reappears in the feed is reactivated rather than duplicated by a second row
  (BR-135). Implementing [`IReactivatable`](group-02-domain-building-blocks.md#ireactivatable) is what
  makes the type eligible for the aggregate's `RestoreChild` helper at all: the base `Undelete()` is
  non-public on purpose, so reversing a soft delete is a decision each entity publishes for itself.
- **Why it's built this way**: an explicit join entity is what lets [`Event`](#event) raise
  [`EventSpeakerChanged`](#eventspeakerchanged) when the association is added, restored, or removed, and
  it is what makes the soft-delete-then-reactivate cycle possible under a repeatedly re-run import.
- **Where it's used**: created, restored, and removed only through [`Event`](#event)'s `AddEventSpeaker`,
  `RestoreEventSpeaker`, and `RemoveEventSpeaker`; the duplicate-speaker guard lives in the root
  (`Event.cs:513`), not here. Mapped by
  [`EventSpeakerConfiguration`](group-19-conference-infrastructure.md#eventspeakerconfiguration).

### Question
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/Question.cs:14` · Level 7 · class (sealed, aggregate root)

- **What it is**: a standalone aggregate root for a survey or custom-form question, for example "Dietary
  requirements" or "T-shirt size" (`Question.cs:9-13`). A question targets an entity type
  (`QuestionEntity`), has an input type (`QuestionType`), a sort order, an `IsRequired` flag, and a
  `QuestionSource`. Unlike the other roots in this part it owns **no** children: answers live on the
  answering entity ([`EventQuestionAnswer`](#eventquestionanswer),
  [`SpeakerQuestionAnswer`](#speakerquestionanswer),
  [`SessionQuestionAnswer`](#sessionquestionanswer)).
- **Depends on**:
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (`Question.cs:14`), [`QuestionInvariants`](#questioninvariants),
  [`Result`](group-01-result-error-handling.md#result),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), and the
  [`QuestionChanged`](#questionchanged) domain event. Alias `QuestionIdentifierType`.
- **Concept**: a "thin" aggregate root, where the consistency boundary is just the record itself. The
  detail worth noticing is the **absent** attribute: the class header carries no `[IdValueGenerated]`
  (`Question.cs:14`), so question ids are explicitly assigned, typically by Sessionize. `Create` still
  runs the same `typeof(Question).IsIdValueGenerated` check (`:87`), which here evaluates to `false`, so
  the `id!.Value` branch is always taken (`:91`). `[Rubric §8, Data Architecture]`: the id-origin decision
  is expressed once, as an attribute on the type (or its absence), and every factory reads it uniformly.
- **Walkthrough**
  - **Scalars** (`Question.cs:16-32`): `QuestionText`, `QuestionEntity`, `QuestionType`, `Sort`,
    `IsRequired`, `QuestionSource`, all with private setters. The three discriminators are plain strings
    validated against the closed sets in [`QuestionInvariants`](#questioninvariants) rather than enums.
  - **Constructors** (`Question.cs:35-57`): the EF constructor seeds all four non-nullable strings.
  - **`Create`** (`Question.cs:70-97`): four invariant checks (text, entity, type, source) combined through
    `Result.Combine` (`:79-83`) so the caller gets every problem at once, then construct, then emit
    `QuestionChanged(Added)` (`:94`).
  - **`Update`** (`Question.cs:108-131`): re-validates text, entity, and type, but **drops the
    `questionSource` parameter entirely**. Source is immutable after creation, a business rule encoded by
    absence rather than by a guard clause.
  - **`Delete`** (`Question.cs:135-143`): calls the base soft-delete and, on success, emits
    `QuestionChanged(Deleted)`. No cascade loop and no `DeleteChildren` call, because it owns nothing.
- **Why it's built this way**: validating against closed value lists rather than accepting free-form
  strings means the domain rejects an invalid type, entity, or source before persistence. Making
  `QuestionSource` non-updatable preserves the provenance distinction between an imported question and a
  user-created one, which is what the reserved manual id range in
  [`QuestionInvariants`](#questioninvariants) also protects.
- **Where it's used**: referenced by scalar FK (`QuestionId`) from
  [`EventQuestionAnswer`](#eventquestionanswer), [`SpeakerQuestionAnswer`](#speakerquestionanswer), and
  [`SessionQuestionAnswer`](#sessionquestionanswer); mapped by
  [`QuestionConfiguration`](group-19-conference-infrastructure.md#questionconfiguration); projected to
  [`QuestionDTO`](#questiondto) and fed into the feedback and custom-form features in the Application and
  UI tiers.
- **Caveats / not-in-source**: `QuestionEntity` accepts "Speaker" (`QuestionInvariants.cs:31`) while the
  property's own XML doc still says "Session" or "Event" (`Question.cs:19`), as do the `Create` parameter
  docs (`:64`). The array is the operative rule; those doc comments are stale.

### Room
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Room.cs:13` · Level 7 · class (sealed, child entity)

- **What it is**: a child entity of [`Event`](#event) representing a physical or virtual room where
  sessions take place. Unlike its siblings, a room's id is **Sessionize-assigned**, not database-generated
  (`Room.cs:9-12`, and note the absence of `[IdValueGenerated]` on `Room.cs:13`).
- **Depends on**:
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  and [`IReactivatable`](group-02-domain-building-blocks.md#ireactivatable) (both on `Room.cs:13`),
  [`EventInvariants`](#eventinvariants), [`Result`](group-01-result-error-handling.md#result),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute). Aliases
  `RoomIdentifierType`, `EventIdentifierType`.
- **Concept**: the child entity ([`CategoryItem`](#categoryitem), [`EventQuestionAnswer`](#eventquestionanswer))
  with an **externally assigned id**. `[Rubric §8, Data Architecture]`. Because `Room` is not marked
  `[IdValueGenerated]`, `typeof(Room).IsIdValueGenerated` (`Room.cs:85`) is false and `Create` always
  assigns the supplied id (`:95`), which is how a Sessionize room id becomes the PK directly.
  Organizer-created rooms therefore draw from the reserved high range
  ([`EventInvariants`](#eventinvariants)`.RoomManualIdRangeStart`) so app-assigned ids never collide with
  imported ones.
- **Walkthrough**: scalars `Name`, `Sort`, `Capacity?`, `Floor?`, `Location?`, `AccessibilityInfo?`
  (`Room.cs:15-31`); the `[Navigation] Event?` with a private setter and the get-only `EventId`
  (`:33-38`); the EF constructor and the private field constructor (`:41-57`); `Create` (`:70-99`)
  validating `EnsureRoomNameIsValid` plus `EnsureRoomCapacityIsValid` (`:79-81`); `Update` (`:111-133`)
  re-validating the same pair and writing all six scalars; `Reactivate()` (`:141`), the
  [`IReactivatable`](group-02-domain-building-blocks.md#ireactivatable) implementation delegating to the
  base `Undelete()`, whose doc (`:135-140`) explains that a room reappearing in the Sessionize feed has to
  be reactivated rather than re-created precisely because its id is externally owned (BR-135); and
  `SetEvent(Event?)` (`:145`) for the populator. As a child it raises no events itself.
- **Why it's built this way**: preserving the Sessionize id as the PK keeps imported rooms stable across
  refreshes, so a re-import updates in place instead of creating duplicates, and the reserved manual range
  lets organizers add rooms without an id clash. Note the room-name uniqueness rule is **not** here: it
  lives in [`Event`](#event) (`Event.cs:668`), because uniqueness is a statement about the collection,
  which only the root can see. The same reasoning puts the "does this room belong to this event" check in
  the root as well (`Event.cs:447`): `EventId` is get-only here (`Room.cs:38`), so only EF relationship
  fixup ever sets it.
- **Where it's used**: created, updated, restored, and removed through [`Event`](#event)'s `AddRoom`,
  `UpdateRoom`, `RestoreRoom`, and `RemoveRoom`, each of which raises [`RoomChanged`](#roomchanged);
  mapped by [`RoomConfiguration`](group-19-conference-infrastructure.md#roomconfiguration); projected to
  [`RoomDTO`](#roomdto); referenced by [`Session`](#session) scheduling.

### Activity
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Activities` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Activities/Activity.cs:20` · Level 8 · class (sealed, aggregate root)

- **What it is**: the aggregate root for a social or networking activity attached to a conference event: a
  pre-conference party, a morning coffee connect, an after-party, a closing ceremony (`Activity.cs:11-18`).
  It carries a name, an optional description, a start and end time, three optional venue fields, a sort
  order, and the FK to its owning [`Event`](#event). Activity ids are database-generated.
- **Depends on**:
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (the base, `Activity.cs:20`), [`ActivityInvariants`](#activityinvariants), [`Event`](#event) (the
  navigation target, `:58`), [`Result`](group-01-result-error-handling.md#result),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute), and the
  [`ActivityChanged`](#activitychanged) domain event. Aliases `ActivityIdentifierType`,
  `EventIdentifierType`.
- **Concept**: the aggregate root taught at [`Category`](#category) and [`Event`](#event), in its
  **childless** form (compare [`Question`](#question)). What Activity teaches that the others do not is a
  modeling decision stated outright in the class doc (`Activity.cs:11-18`): an activity is deliberately
  **not** a [`Session`](#session). It has no room and no speakers, and it frequently happens at an
  external venue, so the venue is carried on the activity itself instead of being inherited from the
  event. `[Rubric §4, Domain-Driven Design]`: rather than overload `Session` with nullable
  room/speaker/venue fields and a "kind" discriminator, the ubiquitous language gets a second, smaller
  aggregate whose invariants are genuinely different. `[Rubric §16, Maintainability]`: the cost of that
  choice is a parallel command, query, and UI slice, and the benefit is that neither type carries the
  other's optionality.
- **Walkthrough**
  - **`[IdValueGenerated]`** on the class (`Activity.cs:19`): activities are planned, not imported from
    Sessionize, so the database owns the id. `Create` reads it through
    `typeof(Activity).IsIdValueGenerated` (`:120`).
  - **Scalars** (`Activity.cs:22-54`): `Name`, `Description?`, `StartTime`/`EndTime`, `VenueName?`,
    `VenueAddress?`, `VenueUrl?`, `SortOrder`, and `EventId`, all with private setters. Read the two time
    docs carefully (`:28-32`, `:35`): both are plain wall-clock `DateTime` values in the owning event's
    IANA time zone, exactly as `Session.StartsAt` does, and the zone lives on the event, never repeated
    per row. `SortOrder` (`:50`) exists only to break ties between activities starting at the same time.
  - **`[Navigation] public Event? Event`** (`Activity.cs:56-58`): a single-reference navigation (not a
    collection) with a private setter, described in its doc as read-only and used for public visibility
    filtering, so a public read can honor the parent event's published state
    ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)). The populator writes
    it through `SetEvent(Event?)` (`:192`).
  - **Constructors** (`Activity.cs:61-83`): the private parameterless EF constructor seeds
    `Name = string.Empty`; the private nine-parameter field constructor is what the factory calls.
  - **`Create`** (`Activity.cs:99-130`): a five-way `Result.Combine` over
    [`ActivityInvariants`](#activityinvariants) (`:111-116`) so a caller sees every problem at once, then
    `Id = isIdValueGenerated ? default : id!.Value` (`:124`), then
    `AddDomainEvent(new ActivityChanged(DomainEntityState.Added, activity.Id, activity.Name))` (`:127`).
  - **`Update`** (`Activity.cs:145-176`): the same five checks (`:155-160`), then eight scalar writes, then
    `ActivityChanged(Updated)` (`:173`). Note the parameter list has no `eventId`: the doc (`:132-135`)
    records that the owning event is not updatable, and that moving an activity between events is a create
    plus a delete.
  - **`Delete`** (`Activity.cs:180-188`): overrides the base soft-delete and, on success, raises
    `ActivityChanged(Deleted)`. There is no cascade, because the aggregate owns no children.
- **Why it's built this way**: storing event-local wall times rather than instants means an organizer
  edits the time they see printed on the schedule, and the single authoritative zone on [`Event`](#event)
  is applied once at render. Keeping venue on the activity is what lets an off-site after-party carry its
  own address and map link while an on-site coffee connect simply leaves the fields null and the reader
  falls back to the event venue.
- **Where it's used**: mutated by the Conference activity command handlers and mapped to
  [`ActivityDTO`](#activitydto) by
  [`ActivityDTOMapper`](group-18-conference-application.md#activitydtomapper); hydrated by
  [`ActivityNavigationPopulator`](group-18-conference-application.md#activitynavigationpopulator);
  persisted through
  [`ActivityConfiguration`](group-19-conference-infrastructure.md#activityconfiguration); rendered by the
  [`ActivityList`](group-21-conference-ui.md#activitylist),
  [`ActivityDetail`](group-21-conference-ui.md#activitydetail), and
  [`ActivityCreate`](group-21-conference-ui.md#activitycreate) pages.

### SpeakerInvariants
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/SpeakerInvariants.cs:13` · Level 6 · class (static)

- **What it is**: the domain rule set for the [`Speaker`](#speaker) aggregate and its
  [`SpeakerQuestionAnswer`](#speakerquestionanswer) child. Ten field-length constants plus three
  `EnsureXxx` guards that the two entities call before they mutate anything.
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (Level 5),
  [`Result`](group-01-result-error-handling.md#result) (Level 2), and
  [`SpeakerDTO`](#speakerdto) (Level 2) for the numbers themselves. No BCL or NuGet dependency beyond
  string interpolation.
- **Concept**: the invariant-class pattern itself is taught on
  [`CategoryInvariants`](#categoryinvariants). What this sibling shows is the **three-layer constant
  chain**, and it runs one hop further than most. The class doc (`SpeakerInvariants.cs:7-12`) states
  the rule: "The numbers themselves live on `SpeakerDTO`, the lowest layer the UI can also reach, so
  markup and domain validation cannot drift apart." So nine of the ten constants here are aliases,
  not literals: `FirstNameMaxLength = SpeakerDTO.FirstNameMaxLength` (`:16`) forwards to
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SpeakerDTO.cs:21`, which is
  where `200` is actually written. `[Rubric §8, Data Architecture]` assesses whether the storage
  schema and the domain rules can drift apart: every `HasMaxLength` in
  [`SpeakerConfiguration`](group-19-conference-infrastructure.md#speakerconfiguration) reads a constant
  from this class rather than a literal
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerConfiguration.cs:21`,
  `:25`, `:32`, `:36`, `:44`, `:48`, `:52`, `:56`, `:60`), and so does every FluentValidation rule in
  `SpeakerValidationRules`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/Validation/SpeakerValidationRules.cs:16`,
  `:27`, `:46`, `:65`). `[Rubric §16, Maintainability]`: one edit in the Shared DTO moves the Razor
  `maxlength`, the validator message, the domain guard, and the column width together, because there is
  exactly one definition point.
- **Walkthrough**
  - **Constants** (`SpeakerInvariants.cs:16-43`): `FirstNameMaxLength` 200 (`:16`), `LastNameMaxLength`
    200 (`:19`), `EmailMaxLength` 255 (`:22`), `TagLineMaxLength` 500 (`:25`),
    `ProfilePictureMaxLength` 2000 (`:28`), `TwitterHandleMaxLength` 100 (`:31`),
    `LinkedInUrlMaxLength` 2000 (`:34`), `GitHubUrlMaxLength` 2000 (`:37`), `WebsiteUrlMaxLength` 2000
    (`:40`). The values are read from
    [`SpeakerDTO`](#speakerdto) (`SpeakerDTO.cs:21,24,27,30,40,43,46,49,52`). The tenth,
    `AnswerValueMaxLength = 4000` (`:43`), is the one written as a literal here, because it belongs to
    the child entity rather than to the speaker profile the DTO describes.
  - `EnsureFirstNameIsValid(string firstName, string source)` (`:45-48`): a `Result.Combine` of
    `CommonInvariants.EnsureStringIsNotEmpty` (error code `Speaker.FirstName.Empty`) and
    `CommonInvariants.EnsureStringMaxLength` (`Speaker.FirstName.TooLong`). Combining rather than
    short-circuiting means a caller that submits an over-long empty-ish value gets both errors in one
    round trip. The `source` parameter is the caller's method name (`nameof(Create)`), threaded into
    the error for tracing, and `nameof(firstName)` becomes the error target so a UI can bind the
    message to a field.
  - `EnsureLastNameIsValid` (`:50-53`): identical shape against `LastNameMaxLength`, error codes
    `Speaker.LastName.Empty` and `Speaker.LastName.TooLong`.
  - `EnsureAnswerValueIsValid(string answerValue, string source)` (`:55-58`): the same shape against
    `AnswerValueMaxLength`, but the error codes are namespaced to the child entity,
    `SpeakerQuestionAnswer.AnswerValue.Empty` and `SpeakerQuestionAnswer.AnswerValue.TooLong`, because
    that is the type a consumer sees the failure from.
- **Why it's built this way**: keeping lengths as `const int` reachable from the Domain layer lets the
  outer layers depend inward on them
  ([Clean Architecture](00-primer.md#the-layered-dependency-flow-clean-architecture)) instead of each
  layer re-typing a number, and routing them through the Shared DTO lets the Blazor client, which
  cannot reference Domain, use the identical figure. Static methods returning
  [`Result`](group-01-result-error-handling.md#result) keep the aggregate free of exceptions on the
  validation path.
- **Where it's used**: [`Speaker.Create`](#speaker) (`Speaker.cs:140-141`) and `Speaker.Update`
  (`Speaker.cs:218-219`); [`SpeakerQuestionAnswer.Create`](#speakerquestionanswer)
  (`SpeakerQuestionAnswer.cs:52`) and `UpdateAnswer` (`SpeakerQuestionAnswer.cs:73`). The constants
  additionally feed [`SpeakerConfiguration`](group-19-conference-infrastructure.md#speakerconfiguration),
  [`SpeakerQuestionAnswerConfiguration`](group-19-conference-infrastructure.md#speakerquestionanswerconfiguration)
  (`SpeakerQuestionAnswerConfiguration.cs:25`), and `SpeakerValidationRules`. Covered directly by
  [`SpeakerInvariantsTests`](group-27-testing-infrastructure.md#speakerinvariantstests).
- **Caveats / not-in-source**: only three of the ten constants have a matching `EnsureXxx` method.
  Email, tag line, profile picture, the three URL fields and the Twitter handle are enforced by the
  application validator and the EF column width, not by a domain guard, so a caller that constructs a
  `Speaker` through the domain factory alone (a test, or the Sessionize importer) can exceed those
  lengths and only fail at `SaveChangesAsync`. `Bio` is a further step out: it has no constant here at
  all (the `SpeakerDTO.BioMaxLength` of 4000 at `SpeakerDTO.cs:37` is not mirrored), and
  `SpeakerConfiguration.cs:28-29` maps it with no `HasMaxLength`, so the column is unbounded.

### SponsorInvariants
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sponsors/SponsorInvariants.cs:13` · Level 6 · class (static)

- **What it is**: the domain rule set for the [`Sponsor`](#sponsor) aggregate. Seven field-length
  constants for a sponsor record and three `EnsureXxx` guards the aggregate calls before it mutates
  anything.
- **Depends on**: [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants) (Level 5),
  [`Result`](group-01-result-error-handling.md#result) (Level 2), and [`SponsorDTO`](#sponsordto)
  (Level 1) for the numbers.
- **Concept**: the same three-layer constant chain [`SpeakerInvariants`](#speakerinvariants)
  introduces, with the same doc comment stating it (`SponsorInvariants.cs:7-12`). All seven constants
  forward to [`SponsorDTO`](#sponsordto) rather than holding a literal. `[Rubric §8, Data
  Architecture]`: the `HasMaxLength` calls in
  [`SponsorConfiguration`](group-19-conference-infrastructure.md#sponsorconfiguration) read them
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SponsorConfiguration.cs:20`,
  `:30`, `:34`, `:38`, `:42`, `:46`, `:56`), as do the rule classes in
  `SponsorValidationRules`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sponsors/Validation/SponsorValidationRules.cs:17`,
  `:34`, `:47`, `:64`, `:82`, `:95`, `:107`). What is different from the speaker side is that two of
  the three guards here are **optional-field** guards, which the speaker set has none of.
- **Walkthrough**
  - **Constants** (`SponsorInvariants.cs:16-34`): `NameMaxLength` 200 (`:16`), `LogoUrlMaxLength` 2000
    (`:19`), `DescriptionMaxLength` 2000 (`:22`), `WebsiteUrlMaxLength` 2000 (`:25`),
    `LinkedInUrlMaxLength` 2000 (`:28`), `TwitterHandleMaxLength` 100 (`:31`), `BoothNumberMaxLength`
    50 (`:34`). The literals live on
    [`SponsorDTO`](#sponsordto)
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sponsors/SponsorDTO.cs:18,21,24,27,30,33,36`).
    The 2000-char URL fields match the URL columns used elsewhere in the module; the 100-char handle
    and the 50-char booth number are the two deliberately tight ones.
  - `EnsureNameIsValid(string name, string source)` (`:42-45`): the only *required* field check. A
    `Result.Combine` of `CommonInvariants.EnsureStringIsNotEmpty` (`Sponsor.Name.Empty`) and
    `CommonInvariants.EnsureStringMaxLength` (`Sponsor.Name.TooLong`).
  - `EnsureLogoUrlIsValid(string? logoUrl, string source)` (`:54-55`): the **optional-field shape**. It
    is a single call to `CommonInvariants.EnsureOptionalStringMaxLength`, so absence is legal by
    construction and only a supplied value is length-checked (`Sponsor.LogoUrl.TooLong`). No
    `Result.Combine` wrapper, because there is exactly one rule. The doc comment (`:47-50`) records why
    nothing else is checked: the value is a plain URL string with no upload pipeline behind it, so only
    the storage constraint applies.
  - `EnsureBoothNumberIsValid(string? boothNumber, string source)` (`:64-65`): the same optional-field
    shape (`Sponsor.BoothNumber.TooLong`). The comment (`:57-60`) states the rule explicitly: a booth
    number is accepted even when the sponsor is not flagged `IsExhibitor`, because the flag drives
    display and does not reject stored data. There is deliberately **no cross-field invariant** between
    the two.
- **Why it's built this way**: same rationale as [`SpeakerInvariants`](#speakerinvariants). The
  optional-field helper is worth noting on its own: hand-writing `if (value is null) return
  Result.Success()` in each guard is the kind of repetition that eventually gets one branch wrong, so
  the framework ships `EnsureOptionalStringMaxLength` and the module rule reduces to one expression.
  `[Rubric §15, Best Practices & Code Quality]`.
- **Where it's used**: [`Sponsor.Create`](#sponsor) (`Sponsor.cs:120-122`) and `Sponsor.Update`
  (`Sponsor.cs:166-168`); the constants additionally feed
  [`SponsorConfiguration`](group-19-conference-infrastructure.md#sponsorconfiguration) and
  `SponsorValidationRules`. Covered directly by
  [`SponsorInvariantsTests`](group-27-testing-infrastructure.md#sponsorinvariantstests).
- **Caveats / not-in-source**: only three of the seven constants have a matching `EnsureXxx` method.
  `Description`, `WebsiteUrl`, `LinkedInUrl` and `TwitterHandle` lengths are enforced by the
  application validator and the EF column width, not by a domain guard, so a caller that constructs a
  `Sponsor` through the domain factory alone (a test, or the sample-data seeder) can exceed those four
  lengths and only fail at `SaveChangesAsync`.

### Speaker
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:22` · Level 7 · class (sealed)

- **What it is**: the aggregate root for a conference speaker. It carries the profile (names, optional
  [`Email`](group-02-domain-building-blocks.md#email) value object, bio, tag line, picture, four social
  links), owns two child collections, and holds the nullable link to an Identity user that grants a
  person speaker rights over their own sessions.
- **Depends on**:
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (Level 4), [`IAuditedEntity`](group-02-domain-building-blocks.md#iauditedentity) (Level 0),
  [`SpeakerInvariants`](#speakerinvariants) (Level 6),
  [`Email`](group-02-domain-building-blocks.md#email) (Level 4),
  [`SpeakerCategoryItem`](#speakercategoryitem) and [`SpeakerQuestionAnswer`](#speakerquestionanswer)
  (both Level 7, a mutual cycle: each child holds a back-navigation to `Speaker`),
  [`SpeakerChanged`](#speakerchanged), [`SpeakerCategoryItemChanged`](#speakercategoryitemchanged),
  [`SpeakerQuestionAnswerChanged`](#speakerquestionanswerchanged) (Level 2-3),
  [`Result`](group-01-result-error-handling.md#result) and
  [`Error`](group-01-result-error-handling.md#error),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) and
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute) (Level 0). The
  identifier alias is `SpeakerIdentifierType = System.Guid`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:19`),
  the only Guid identity in the Conference module.
- **Concept introduced, the cross-context link maintained by events rather than a foreign key.**
  `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out without a
  relational tether to a peer, and `[Rubric §8, Data Architecture]` assesses how a relationship is
  physically expressed. `LinkedUserId` (`Speaker.cs:58`) is a **nullable scalar**, not an EF navigation
  property, because `User` lives in the Identity database and
  [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) forbids a foreign key
  across that boundary. The two-way link (`Speaker.LinkedUserId` on one side, `User.LinkedSpeakerId` on
  the other) is kept consistent by publishing facts, not by a constraint: the uniqueness half is a
  filtered unique index in SQL
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerConfiguration.cs:63-65`,
  `HasFilter("[LinkedUserId] IS NOT NULL")`, so many speakers may have no user but no user may have
  two speakers), and the propagation half is
  [`SpeakerLinkedToUser`](#speakerlinkedtouser) / [`SpeakerUnlinkedFromUser`](#speakerunlinkedfromuser)
  over the outbox ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).

  `[Rubric §11, Security]` and `[Rubric §30, Compliance, Privacy and Data Governance]`: the class is
  tagged [`IAuditedEntity`](group-02-domain-building-blocks.md#iauditedentity) (`Speaker.cs:22`), and
  the doc comment (`:15-20`) gives the reason rather than leaving it to convention. This row holds
  personal data and the link that grants a person authority over sessions, and it is written by three
  different actors (organizers, the speaker themselves, and the Sessionize sync), so a change history
  is what lets "who linked this account to this speaker" or a data-subject question be answered.
- **Walkthrough**
  - **Scalar state** (`Speaker.cs:25-58`), every setter `private set`: `FirstName` (`:25`), `LastName`
    (`:28`), `Email` as an `Email?` value object (`:31`), `Bio` (`:34`), `TagLine` (`:37`),
    `ProfilePicture` (`:40`), `TwitterHandle` (`:43`), `LinkedInUrl` (`:46`), `GitHubUrl` (`:49`),
    `WebsiteUrl` (`:52`), `IsTopSpeaker` (`:55`), `LinkedUserId` (`:58`). `FullName` (`:61`) is a
    computed `$"{FirstName} {LastName}"` with no backing column; EF is told to skip it with
    `builder.Ignore(p => p.FullName)` (`SpeakerConfiguration.cs:68`).
  - **Owned collections** (`:63-73`): two private `List<T>` backing fields exposed as
    `IReadOnlyCollection<T>` through `.AsReadOnly()`, each tagged `[Navigation(IsCollection = true)]`
    for the populator ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).
    A caller cannot `Add` to `SpeakerCategoryItems` or `SpeakerQuestionAnswers`; the aggregate methods
    below are the only doors.
  - **Constructors**: the EF parameterless one (`:76-80`) assigns the two non-nullable names to
    `string.Empty` so they are definitely assigned before EF writes the columns; the private
    seven-parameter one (`:82-98`) can only be reached through the factory, which guarantees validation
    ran first.
  - `Create(...)` (`:116-171`): note the ordering. The optional email is parsed into a value object
    **first** (`:130-137`), returning `Result.Failure<Speaker>(emailResult.Errors)` immediately if it
    is malformed, and only then are the name guards combined (`:139-141`). Identity resolution is the
    interesting part (`:145`, `:161`): `SpeakerIdentifierType` is a client-assigned `Guid`, so a
    Sessionize-imported speaker carries the id the feed gave it, while `Id = id ?? (isIdValueGenerated
    ? default : Guid.NewGuid())` generates one when the caller passes null. The comment above that line
    (`:156-160`) records why the null-coalescing exists at all: the earlier `id!.Value` threw "Nullable
    object must have a value" for organizer-created speakers and for the seeder, which both pass null.
    The four social links are set through an object initializer (`:162-165`) rather than the
    constructor. Finally `AddDomainEvent(new SpeakerChanged(DomainEntityState.Added, speaker.Id,
    speaker.FullName))` (`:168`).
  - `Update(...)` (`:195-238`): the same email-then-names validation order (`:208-219`), then eleven
    scalar writes (`:223-233`), then `SpeakerChanged(Updated, ...)` (`:235`). **`LinkedUserId` is
    deliberately absent** from the parameter list, and the remarks (`:176-182`) explain the risk that
    drove that: `LinkUser` and `UnlinkUser` carry the uniqueness check and raise the events that keep
    Identity's `User.LinkedSpeakerId` in sync, whereas a generic update raises only `SpeakerChanged`,
    so writing the link here would silently desynchronize the two sides.
  - `Delete()` (`:251-267`): captures `LinkedUserId` into a local **before** anything else (`:254`),
    calls `base.Delete()` (`:256`), and on success clears the link inside the Conference context
    (`:261`) and raises `SpeakerChanged(Deleted, Id, FullName, previousLinkedUserId)` (`:263`). The
    captured value is the whole point: by the time the handler runs, the field on the entity is null,
    so the event has to carry it. The doc comment (`:240-249`) also records a deliberate **non**
    cascade: the child associations survive the soft-delete, because the Sessionize import reactivates
    them in place when the speaker returns and no cascade-restore counterpart exists, and junction
    reads follow the parent's visibility so the surviving children are not observable meanwhile.
  - `LinkUser(UserIdentifierType userId)` (`:272-286`) and `UnlinkUser()` (`:290-304`): mirror guards.
    Linking an already-linked speaker fails with `Speaker.AlreadyLinked` (`:276-281`), unlinking an
    unlinked one fails with `Speaker.NotLinked` (`:294-299`). Both raise `SpeakerChanged(Updated, ...)`
    on success.
  - **Category-item children** (`:314-390`): `AddSpeakerCategoryItem` (`:314`) guards against a
    duplicate *live* association with `_speakerCategoryItems.Exists(sci => !sci.IsDeleted &&
    sci.CategoryItemId == categoryItemId)` (`:318`), failing with `Speaker.CategoryItem.Duplicate`; the
    `!sci.IsDeleted` half is what leaves room for the reactivation path. `RestoreSpeakerCategoryItem`
    (`:352`) takes the join **instance** rather than an id, because a soft-deleted row is excluded by
    the global query filter and so must be resolved by the caller (remarks, `:345-349`); it delegates
    to the framework's `RestoreChild<TChild, TChildId>`
    (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:212`) and
    then raises `SpeakerCategoryItemChanged(Added, ...)` (`:364`), because the association re-enters the
    visible set. `RemoveSpeakerCategoryItem` (`:374`) goes through `RemoveChildOrNotFound`
    (`AuditableAggregateRootEntity.cs:156`) and raises the `Deleted` variant (`:382`).
  - **Question-answer children** (`:401-464`): `AddSpeakerQuestionAnswer` (`:401`) has **no** duplicate
    guard, unlike the category-item side; validation lives in the child factory.
    `UpdateSpeakerQuestionAnswer` (`:425`) resolves through the private
    `GetSpeakerQuestionAnswerOrNotFound` helper (`:467`, over `GetChildOrNotFound` at
    `AuditableAggregateRootEntity.cs:103`), calls `answer.UpdateAnswer` and re-raises
    `SpeakerQuestionAnswerChanged(Updated, ...)` (`:438`). `RemoveSpeakerQuestionAnswer` (`:448`)
    mirrors the category-item remove.
  - **Populator hooks** (`:389`, `:463`): `SetSpeakerCategoryItems` and `SetSpeakerQuestionAnswers` are
    `internal`, not public, and delegate to the framework's `SetItems`
    (`AuditableAggregateRootEntity.cs:60`). Internal visibility is the compromise that lets the
    same-assembly populator rehydrate a cross-source load without opening bulk replacement to the
    application layer.
- **Why it's built this way**: `[Rubric §4, Domain-Driven Design]` (assesses whether an aggregate owns
  a consistency boundary sized to a real transaction). Category items and question answers are edited
  as part of "editing a speaker", so they are children inside this root; sessions and events are not,
  so they are separate roots referenced by FK. `[Rubric §6, CQRS and Event-Driven]`: every mutation
  path ends in an `AddDomainEvent` call, which is what lets the delete cascade its cross-context
  consequence to Identity without Conference ever calling Identity synchronously.
- **Where it's used**: linked and unlinked by
  [`LinkUserToSpeakerHandler`](group-18-conference-application.md#linkusertospeakerhandler)
  (`.../Speakers/UseCases/LinkUser/LinkUserToSpeakerHandler.cs:57`) and
  [`UnlinkUserFromSpeakerHandler`](group-18-conference-application.md#unlinkuserfromspeakerhandler)
  (`.../UnlinkUser/UnlinkUserFromSpeakerHandler.cs:43`), and automatically by
  [`UserRegisteredHandler`](group-18-conference-application.md#userregisteredhandler) on an email match
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserRegisteredHandler.cs:86`);
  imported and reconciled by
  [`SpeakerSyncStrategy`](group-18-conference-application.md#speakersyncstrategy)
  (`.../Events/UseCases/RefreshFromSessionize/SpeakerSyncStrategy.cs:157,161,174,178`); hydrated by
  [`SpeakerNavigationPopulator`](group-18-conference-application.md#speakernavigationpopulator)
  (`.../Speakers/SpeakerNavigationPopulator.cs:20,27`); its delete observed by
  [`SpeakerDeletedHandler`](group-18-conference-application.md#speakerdeletedhandler), which publishes
  `SpeakerUnlinkedFromUser` only when `PreviousLinkedUserId` has a value
  (`.../Speakers/DomainEventHandlers/SpeakerDeletedHandler.cs:38-45`); projected by
  [`SpeakerDTOMapper`](group-18-conference-application.md#speakerdtomapper); persisted by
  [`SpeakerConfiguration`](group-19-conference-infrastructure.md#speakerconfiguration); exposed by
  [`SpeakersController`](group-20-conference-api-grpc.md#speakerscontroller); rendered by
  [`SpeakerList`](group-21-conference-ui.md#speakerlist),
  [`SpeakerDetail`](group-21-conference-ui.md#speakerdetail),
  [`SpeakerDashboard`](group-21-conference-ui.md#speakerdashboard),
  [`PublicSpeakerList`](group-21-conference-ui.md#publicspeakerlist) and
  [`PublicSpeakerDetail`](group-21-conference-ui.md#publicspeakerdetail). Referenced by FK from
  [`EventSpeaker`](#eventspeaker), [`SessionSpeaker`](#sessionspeaker), and Identity's `User`.
  Unit-tested by [`SpeakerTests`](group-27-testing-infrastructure.md#speakertests).

### SpeakerCategoryItem
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/SpeakerCategoryItem.cs:14` · Level 7 · class (sealed)

- **What it is**: the join entity binding a [`Speaker`](#speaker) to a [`CategoryItem`](#categoryitem).
  It carries no data of its own beyond the two foreign keys, and it is how a speaker's tags (topic
  areas, and the locality classification the conference uses) are modeled: there is no
  `Speaker.Location` field, the value is a category item joined through this row.
- **Depends on**:
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (Level 3), [`IReactivatable`](group-02-domain-building-blocks.md#ireactivatable) (Level 3),
  [`Speaker`](#speaker) (Level 7, back-navigation),
  [`Result`](group-01-result-error-handling.md#result) (Level 2),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) and
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute) (Level 0). Alias
  `SpeakerCategoryItemIdentifierType = int`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:18`).
- **Concept introduced, reactivation as an explicit contract.** `[Rubric §8, Data Architecture]`
  assesses the interplay of soft delete with re-entry of the same logical row. The join implements
  [`IReactivatable`](group-02-domain-building-blocks.md#ireactivatable) (`:14`), and `Reactivate()`
  (`:57`) is a one-liner over the framework's protected `Undelete()`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:89`). The reason is in
  the doc comment (`:51-55`): the row carries the Sessionize-assigned category item id, so an
  association that disappears from the feed and later returns must be **reactivated rather than
  duplicated by a second row** (BR-135). Implementing the interface is what makes that intent
  discoverable and testable, instead of leaving the reactivation as an ad-hoc flag flip somewhere in
  the sync code.
- **Walkthrough**
  - `CategoryItemId` (`:17`), private set: the FK to the tag. `Speaker?` (`:21`) is the back-navigation
    tagged `[Navigation]`. `SpeakerId` (`:24`) is getter-only, written by EF from the shadow FK rather
    than by the domain.
  - `Create(SpeakerCategoryItemIdentifierType? id, CategoryItemIdentifierType categoryItemId)`
    (`:37-49`): no validation at all, because a pure FK pair has nothing to validate. It reads the
    `[IdValueGenerated]` marker (`:13`, `:41`) through
    `MMCA.Common/Source/Core/MMCA.Common.Domain/Extensions/EntityTypeExtensions.cs:19` and sets
    `Id = isIdValueGenerated ? default : id!.Value` (`:45`), so the database assigns the key. No domain
    event is raised here: the parent aggregate emits
    [`SpeakerCategoryItemChanged`](#speakercategoryitemchanged), which keeps event ownership with the
    root.
  - `Reactivate()` (`:57`) and `SetSpeaker(Speaker? speaker)` (`:61`): the two capability hooks. Note
    the asymmetry with the parent, `SetSpeaker` is `public` (the populator lives in another assembly),
    whereas the collection setters on [`Speaker`](#speaker) are `internal`.
- **Why it's built this way**: modeling a speaker's locality and topics as join rows to shared
  [`CategoryItem`](#categoryitem) values rather than as string columns means the same vocabulary
  serves sessions and speakers, and a rename happens in one place. `[Rubric §4, Domain-Driven Design]`:
  the join is a child of the speaker root, not a root of its own, because it has no lifecycle
  independent of the speaker.
- **Where it's used**: created, restored and removed only through [`Speaker`](#speaker)
  (`Speaker.cs:314,352,374`); reconciled against the feed by
  [`SpeakerSyncStrategy.SyncCategoryItems`](group-18-conference-application.md#speakersyncstrategy)
  (`.../RefreshFromSessionize/SpeakerSyncStrategy.cs:145-164`), which is the only caller of
  `RestoreSpeakerCategoryItem`; projected by
  [`SpeakerCategoryItemDTOMapper`](group-18-conference-application.md#speakercategoryitemdtomapper) to
  [`SpeakerCategoryItemDTO`](#speakercategoryitemdto); persisted by
  [`SpeakerCategoryItemConfiguration`](group-19-conference-infrastructure.md#speakercategoryitemconfiguration);
  read by [`SpeakerLocalityHelper`](group-18-conference-application.md#speakerlocalityhelper).
  Unit-tested by
  [`SpeakerCategoryItemTests`](group-27-testing-infrastructure.md#speakercategoryitemtests).

### SpeakerQuestionAnswer
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/SpeakerQuestionAnswer.cs:13` · Level 7 · class (sealed)

- **What it is**: the child entity holding one speaker's answer to one [`Question`](#question), for
  example a dietary preference or a shirt size collected in the call-for-papers form.
- **Depends on**:
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (Level 3), [`SpeakerInvariants`](#speakerinvariants) (Level 6), [`Speaker`](#speaker) (Level 7,
  back-navigation), [`Result`](group-01-result-error-handling.md#result) (Level 2),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) and
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute) (Level 0). Alias
  `SpeakerQuestionAnswerIdentifierType = int`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:20`).
- **Concept**: the same child-entity shape as [`SpeakerCategoryItem`](#speakercategoryitem), with one
  difference that is worth naming. This child **does** carry a mutable payload (`AnswerValue`), so it
  owns a validating `UpdateAnswer` method and re-runs the guard on every write. It does **not**
  implement [`IReactivatable`](group-02-domain-building-blocks.md#ireactivatable), because the sync
  path updates an existing live answer in place rather than resurrecting a deleted one.
- **Walkthrough**
  - `QuestionId` (`:16`) and `AnswerValue` (`:19`), both private set; `Speaker?` (`:23`) tagged
    `[Navigation]`; `SpeakerId` (`:26`) getter-only. The EF constructor (`:29`) assigns
    `AnswerValue = string.Empty` for definite assignment; the private two-parameter constructor
    (`:31-37`) is reachable only from the factory.
  - `Create(id, questionId, answerValue)` (`:46-64`): validates through
    `SpeakerInvariants.EnsureAnswerValueIsValid` inside a `Result.Combine` (`:51-52`), which is a
    single-argument combine, a shape that reads oddly but leaves room for a second rule without
    restructuring. Then the `[IdValueGenerated]` lookup (`:12`, `:56`) and
    `Id = isIdValueGenerated ? default : id!.Value` (`:60`). No domain event: the parent emits
    [`SpeakerQuestionAnswerChanged`](#speakerquestionanswerchanged).
  - `UpdateAnswer(string answerValue)` (`:71-80`): re-validates with the identical guard (`:73`) before
    assigning (`:77`). Validating on update as well as on create is the point of routing both through
    the invariants class: an entity that can only be constructed valid but then freely mutated is not
    actually protected.
  - `SetSpeaker(Speaker? speaker)` (`:84`): the populator hook, public for the same reason as on the
    sibling join.
- **Why it's built this way**: `[Rubric §4, Domain-Driven Design]`: keeping the answer text guarded
  inside the entity (rather than validating it once in a request validator) means every write path,
  including the Sessionize import, which never touches a FluentValidation validator, is held to the
  same 4000-character rule.
- **Where it's used**: added, updated and removed only through [`Speaker`](#speaker)
  (`Speaker.cs:401,425,448`); populated from the feed by
  [`SpeakerSyncStrategy.SyncQuestionAnswers`](group-18-conference-application.md#speakersyncstrategy)
  (`.../RefreshFromSessionize/SpeakerSyncStrategy.cs:166-181`), which updates a live answer in place
  when one exists for the question and adds otherwise; projected by
  [`SpeakerQuestionAnswerDTOMapper`](group-18-conference-application.md#speakerquestionanswerdtomapper)
  to [`SpeakerQuestionAnswerDTO`](#speakerquestionanswerdto); persisted by
  [`SpeakerQuestionAnswerConfiguration`](group-19-conference-infrastructure.md#speakerquestionanswerconfiguration).
  Unit-tested by
  [`SpeakerQuestionAnswerTests`](group-27-testing-infrastructure.md#speakerquestionanswertests).

### Sponsor
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sponsors/Sponsor.cs:18` · Level 8 · class (sealed)

- **What it is**: the aggregate root for a conference sponsor or exhibitor. A sponsor belongs to
  exactly one [`Event`](#event), carries a [`SponsorTier`](#sponsortier) that drives its public
  placement, and optionally staffs an expo booth (class doc, `Sponsor.cs:12-16`).
- **Depends on**:
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (Level 4), [`SponsorInvariants`](#sponsorinvariants) (Level 6), [`SponsorTier`](#sponsortier)
  (Level 0), [`Event`](#event) (Level 7, navigation only), [`SponsorChanged`](#sponsorchanged)
  (Level 3), [`Result`](group-01-result-error-handling.md#result) (Level 2),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) (Level 0),
  [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) (Level 0),
  [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute) (Level 0). The
  identifier alias is `SponsorIdentifierType = int`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:21`).
- **Concept**: the aggregate-root mechanics are taught on [`Category`](#category); this section covers
  what is different here. `[Rubric §4, Domain-Driven Design]` (assesses whether each aggregate owns a
  consistency boundary sized to a real transaction): `Sponsor` is a **flat, childless aggregate**. It
  has no owned collection, so `Delete()` has nothing internal to cascade to, and its whole invariant
  surface is field validation. That flatness is exactly why it is a separate root instead of a child
  of [`Event`](#event): sponsors are sold and edited on their own cadence, and loading an event to add
  one would widen the event's transaction for no benefit.

  `[Rubric §8, Data Architecture]` (assesses identity generation and relational shape): the class
  carries `[IdValueGenerated]` (`:17`), so sponsor IDs come from the database. The doc comment (`:15`)
  gives the reason in one clause: "sponsors are sold, not imported from Sessionize". Where
  [`Speaker`](#speaker) has to accept an externally supplied Guid because the Sessionize import
  supplies one, `Sponsor` never does. Relationally it is the many side of a plain FK to `Event`
  (`SponsorConfiguration.cs:62-65`) with a soft-delete-filtered index on `EventId`
  (`SponsorConfiguration.cs:67-68`), and `Tier` is persisted through `HasConversion<int>()`
  (`SponsorConfiguration.cs:25-27`) so the tier ordering is a plain column sort.
- **Walkthrough**
  - **Scalar state** (`:21-58`), every setter `private set` so mutation can only happen through
    `Update`: `Name` (`:21`), `Tier` (`:24`), `LogoUrl` (`:27`), `Description` (`:30`), `WebsiteUrl`
    (`:33`), `LinkedInUrl` (`:36`), `TwitterHandle` (`:39`), `Sort` (`:42`, the display order **within**
    the tier), `EventId` (`:45`), `IsExhibitor` (`:52`), `BoothNumber` (`:58`, kept even when
    `IsExhibitor` is false, per the comment at `:54-57`).
  - **Navigation** (`:48-49`): `[Navigation] public Event? Event { get; private set; }`, assigned after
    a cross-source load by the populator through the public `SetEvent(Event? @event)` method (`:202`)
    rather than by a public setter
    ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)). It is not part of
    the aggregate's own invariants.
  - **EF constructor** (`:61`): private, parameterless, assigning `Name = string.Empty` so the
    non-nullable field is definitely assigned before EF writes the columns.
  - **Private constructor** (`:63-87`): takes all eleven values and assigns them. Being private, it can
    only be reached through the factory, which guarantees validation ran first.
  - `Create(...)` (`:105-136`): the canonical *validate, then resolve identity, then construct, then
    emit* shape.
    1. `Result.Combine` of the three guards (`:119-122`), returning
       `Result.Failure<Sponsor>(result.Errors)` on any failure (`:123-124`) so **all** validation errors
       surface at once rather than the first one.
    2. `typeof(Sponsor).IsIdValueGenerated` (`:126`) reads the `[IdValueGenerated]` marker by
       reflection (`MMCA.Common/Source/Core/MMCA.Common.Domain/Extensions/EntityTypeExtensions.cs:19`).
    3. Construction with `Id = isIdValueGenerated ? default : id!.Value` (`:130`): the caller may pass
       an explicit ID, but with the marker present it is ignored and the database assigns one.
    4. `AddDomainEvent(new SponsorChanged(DomainEntityState.Added, sponsor.Id, sponsor.Name))`
       (`:133`). The ID captured here is `default` under DB-generated identity, since the row does not
       exist yet.
  - `Update(...)` (`:153-186`): re-runs the same three guards (`:165-168`), returns the combined failure
    unchanged (`:169-170`), then assigns the ten mutable fields (`:172-181`) and emits
    `SponsorChanged(Updated, ...)` (`:183`). **`EventId` is absent from the parameter list on purpose**:
    the doc comment (`:140`) states that moving a sponsor between events is a create plus a delete, not
    an update, so the owning-event relationship is immutable for the lifetime of the row.
  - `Delete()` (`:190-198`): overrides the base soft-delete, calls `base.Delete()` first (`:192`), and
    only raises `SponsorChanged(Deleted, ...)` when that succeeded (`:194-195`). No child cascade,
    because there are no children.
- **Why it's built this way**: `[Rubric §6, CQRS and Event-Driven]` (assesses whether state changes
  announce themselves): all three lifecycle transitions raise the same
  [`SponsorChanged`](#sponsorchanged) record differing only by
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), so a single handler can
  invalidate the sponsor output cache for any change. Soft delete rather than row removal follows
  [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html); the aggregate never
  hard-deletes itself.
- **Where it's used**: created by
  [`CreateSponsorHandler`](group-18-conference-application.md#createsponsorhandler) and edited through
  [`SponsorUpdateApplier`](group-18-conference-application.md#sponsorupdateapplier); cascade-deleted by
  [`EventCascadeDeletionDomainService`](#eventcascadedeletiondomainservice); projected to
  [`SponsorDTO`](#sponsordto) by
  [`SponsorDTOMapper`](group-18-conference-application.md#sponsordtomapper); hydrated by
  [`SponsorNavigationPopulator`](group-18-conference-application.md#sponsornavigationpopulator);
  exposed over REST by [`SponsorsController`](group-20-conference-api-grpc.md#sponsorscontroller);
  mapped by [`SponsorConfiguration`](group-19-conference-infrastructure.md#sponsorconfiguration);
  seeded by [`ConferenceModuleDbSeeder`](group-19-conference-infrastructure.md#conferencemoduledbseeder)
  (`.../Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:381`); rendered by
  [`SponsorList`](group-21-conference-ui.md#sponsorlist),
  [`SponsorDetail`](group-21-conference-ui.md#sponsordetail) and
  [`SponsorCreate`](group-21-conference-ui.md#sponsorcreate). Unit-tested by
  [`SponsorTests`](group-27-testing-infrastructure.md#sponsortests).
- **Caveats / not-in-source**: the `Event` navigation's doc comment (`:47`) describes it as being there
  "for public visibility filtering", but the public sponsor filter does **not** join through it:
  [`GetPublicSponsorFilterHandler`](group-18-conference-application.md#getpublicsponsorfilterhandler)
  resolves published event ids first and returns a `publishedEventIds.Contains(s.EventId)` criteria
  instead
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sponsors/UseCases/GetPublicSponsorFilter/GetPublicSponsorFilterHandler.cs:29-30`),
  which its own doc comment (`:13-14`) justifies as keeping the criteria translatable on any engine.
  Treat the navigation as available for populators and detail screens, not as the visibility path.

### IEventCascadeDeletionDomainService
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Services/IEventCascadeDeletionDomainService.cs:15` · Level 9 · interface

- **What it is**: a pure domain-service abstraction that coordinates the cascade soft-delete of an
  [`Event`](#event) together with its [`Session`](#session)s (BR-127), its [`Sponsor`](#sponsor)s, and
  its [`Activity`](#activity)s. All three are *separate* aggregates from `Event`, so `Event.Delete()`
  alone cannot reach them.
- **Depends on**: [`Event`](#event) (Level 7), [`Session`](#session) (Level 8),
  [`Sponsor`](#sponsor) (Level 8), [`Activity`](#activity) (Level 8),
  [`Result`](group-01-result-error-handling.md#result) (Level 2). Nothing else: no repository, no
  `DbContext`, no logger, and the five `using` directives (`:1-5`) confirm it.
- **Concept introduced, domain services for cross-aggregate coordination.** `[Rubric §4,
  Domain-Driven Design]` (assesses whether logic belonging to no single aggregate gets a named home
  instead of leaking into a handler) and `[Rubric §3, Clean Architecture]` (assesses whether the Domain
  layer stays free of outward dependencies). When a business operation spans two or more aggregate
  boundaries it belongs in a **domain service**. Deleting an event must also soft-delete its sessions
  (BR-127, BR-55), its sponsors, and its activities, but all four have separate identity and lifecycle,
  so no one of them can own the rule. The interface takes **pre-fetched aggregates**, and the doc
  comment (`:12-13`) says so: "Operates on pre-fetched aggregates with no infrastructure
  dependencies." That is what keeps the abstraction in the Domain layer: loading is the caller's job,
  orchestration is this type's job. Both the interface and its implementation live in
  `MMCA.ADC.Conference.Domain.Services`, not in Infrastructure, because neither needs anything the
  Domain layer cannot reference.
- **Walkthrough**: one member, `Result CascadeDelete(Event @event, IReadOnlyCollection<Session>
  sessions, IReadOnlyCollection<Sponsor> sponsors, IReadOnlyCollection<Activity> activities)`
  (`:28-32`). The three child parameters are read-only collections, which states that the service will
  mutate the *entities* but never the collections. The contract documented at `:17-27` is the important
  part: the first session, sponsor, or activity that fails to delete aborts the cascade, so the event
  is not deleted when any child aggregate delete fails, and the returned `Result` is either that
  failing child result or the result of the event deletion.
- **Why it's built this way**: an interface here buys two things. `[Rubric §14, Testability]`: the
  concrete service can be unit-tested with plain domain objects, and
  [`DeleteEventHandler`](group-18-conference-application.md#deleteeventhandler) can be tested against a
  stub without constructing a real cascade. `[Rubric §1, SOLID]`: the handler depends on the
  abstraction and stays a thin fetch, coordinate, persist slice. The signature is also the honest
  record of a design cost: each new event-rooted aggregate (sponsors and activities were both added
  after sessions) widens this contract, which is a visible, compile-checked change rather than a silent
  gap in the cascade.
- **Where it's used**: injected into
  [`DeleteEventHandler`](group-18-conference-application.md#deleteeventhandler)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Delete/DeleteEventHandler.cs:20`)
  and invoked at `:64` of that file. Registered as a singleton in the Conference Application DI,
  `services.TryAddSingleton<IEventCascadeDeletionDomainService, EventCascadeDeletionDomainService>()`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/DependencyInjection.cs:55`,
  under the "Domain services" banner comment at `:54`).

### EventCascadeDeletionDomainService
> MMCA.ADC.Conference.Domain · `MMCA.ADC.Conference.Domain.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Services/EventCascadeDeletionDomainService.cs:16` · Level 10 · class (sealed)

- **What it is**: the one implementation of
  [`IEventCascadeDeletionDomainService`](#ieventcascadedeletiondomainservice). A stateless class that
  soft-deletes an event's [`Session`](#session)s, then its [`Sponsor`](#sponsor)s, then its
  [`Activity`](#activity)s, then the [`Event`](#event) itself.
- **Depends on**: [`IEventCascadeDeletionDomainService`](#ieventcascadedeletiondomainservice)
  (Level 9), [`Event`](#event), [`Session`](#session), [`Sponsor`](#sponsor), [`Activity`](#activity),
  [`Result`](group-01-result-error-handling.md#result). Its five `using` directives (`:1-5`) are the
  whole dependency list, and none of them is an infrastructure namespace.
- **Concept**: see [`IEventCascadeDeletionDomainService`](#ieventcascadedeletiondomainservice) for the
  domain-service rationale. This class is the smallest possible realization of it: no fields, no
  constructor, one method. The class doc states the property that makes it safe to register as a
  singleton, "Pure domain service -- no infrastructure dependencies" (`:11`), and being stateless it is
  thread-safe by construction.
- **Walkthrough**: `CascadeDelete(Event @event, IReadOnlyCollection<Session> sessions,
  IReadOnlyCollection<Sponsor> sponsors, IReadOnlyCollection<Activity> activities)` (`:19-23`) runs
  four phases in a fixed order:
  1. **Sessions first** (`:28-33`): `foreach` session, call `session.Delete()` (BR-127; each session in
     turn cascades to its own children per BR-55, per the inline comment at `:30`). The per-session
     `Result` **is** inspected: `if (sessionResult.IsFailure) return sessionResult;` (`:31-32`) exits
     immediately with that child's error.
  2. **Then sponsors** (`:37-42`): the identical shape over `sponsor.Delete()`, with the same
     short-circuit (`:40-41`). The comment at `:35-36` records the intent: a sponsor that refuses to
     delete leaves the event untouched.
  3. **Then activities** (`:47-52`): the same shape again over `activity.Delete()` (`:50-51`); the
     comment at `:44-46` notes that leaving them behind would orphan rows the public activities page
     still reads.
  4. **Then the event** (`:55`): `return @event.Delete()`, which itself cascades to the event's owned
     children (rooms, event speakers, event question answers) per BR-72, and that `Result` becomes the
     method's return value.

  Each `Delete()` also queues its aggregate's domain event
  ([`SponsorChanged(Deleted)`](#sponsorchanged) for a sponsor, and the equivalent for sessions,
  activities and the event), which the unit of work dispatches after `SaveChangesAsync`.
- **Why it's built this way**: `[Rubric §8, Data Architecture]` (assesses whether a multi-entity write
  can leave the store half-changed): the short-circuit plus the caller's save discipline is the whole
  consistency story. The service aborts in memory, and
  [`DeleteEventHandler`](group-18-conference-application.md#deleteeventhandler) calls
  `SaveChangesAsync` **only** when the returned `Result` is a success
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Delete/DeleteEventHandler.cs:65-67`),
  so the already-applied `IsDeleted` flags on the earlier aggregates are discarded with the scoped
  `DbContext` instead of being persisted. The inline comment at `:25-27` spells that contract out,
  which matters: the safety depends on the *caller*, so a future consumer that saves unconditionally
  would persist a half-deleted graph. `[Rubric §14, Testability]`: with no infrastructure to stub, the
  whole behavior is exercised by passing domain objects and asserting `IsDeleted` and the queued domain
  events.
- **Where it's used**: resolved through the interface by
  [`DeleteEventHandler`](group-18-conference-application.md#deleteeventhandler), which loads the event
  with its owned children (`DeleteEventHandler.cs:29-33`), its active sessions with their children
  (`:38-43`), its active sponsors (`:47-52`) and its active activities (`:56-61`), all
  `asTracking: true`, before calling `CascadeDelete` (`:64`). Unit-tested by
  [`EventCascadeDeletionDomainServiceTests`](group-27-testing-infrastructure.md#eventcascadedeletiondomainservicetests).
- **Caveats / not-in-source**: the ordering (sessions, then sponsors, then activities, then event) is
  fixed by the method body and is not configurable; nothing in the source explains why sessions precede
  sponsors and activities, and since all three are short-circuiting the choice only affects which error
  a caller sees when more than one would fail.


---
[⬅ Aspire Orchestration & Service Defaults](group-16-aspire-orchestration.md)  •  [Index](00-index.md)  •  [ADC Conference - Application & Use Cases ➡](group-18-conference-application.md)
