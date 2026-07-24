# 18. ADC Conference - Application & Use Cases

**What this chapter covers.** This is the *application layer* of the Conference module, the largest
single application assembly in the codebase (this group holds 211 types). It sits between the
REST/gRPC edge ([G20, Conference API & gRPC](group-20-conference-api-grpc.md)) and the domain
aggregates ([G17, Conference Domain](group-17-conference-domain.md)), and it is where the conference's
*use cases* actually live: create an event, publish it, add a room or a speaker, import the whole
agenda from Sessionize.com, export the schedule as an `.ics` calendar, answer "what is happening right
now", and run the AI-assisted analytics that help organizers decide which session proposals to accept.
Everything here is **engine-agnostic and framework-light**: it depends on the abstractions introduced
by `MMCA.Common.Application` (handlers, mappers, validators, query services, navigation populators)
and on the Conference domain, but never on EF Core, ASP.NET, or a broker SDK directly. Read the
primer's tour of [CQRS and Vertical Slice](00-primer.md#2-architectural-styles-this-codebase-commits-to)
first; this chapter shows those styles at full scale in one module.

## The vertical-slice anatomy of a use case

Open any feature folder under `Sessions/UseCases/`, `Events/UseCases/`, `Speakers/UseCases/`,
`Categories/UseCases/`, or `Questions/UseCases/` and you will find the same **cohesive slice**: a
command or query record, its handler, its FluentValidation validator, and (for creates) a request
record plus a request mapper, all co-located. Adding a feature means adding a folder, not threading an
edit through horizontal `Services/`, `Validators/`, and `Repositories/` directories. This is the
[Vertical Slice](00-primer.md#2-architectural-styles-this-codebase-commits-to) discipline made
physical. `[Rubric §5, Vertical Slice]` (assesses whether a feature is one navigable unit rather than
scattered horizontally), and the folder layout is the evidence.

A **command** mutates and returns a [`Result`](group-01-result-error-handling.md#result); a **query**
is side-effect-free and returns a `Result<TDTO>`. Both implement the Common contracts
[`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult),
so every handler in this assembly flows through the same **decorator pipeline** (Logging, Caching,
Transactional, then the handler) without knowing it exists. Commands that change cached read data
implement [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); commands that must be
atomic implement [`ITransactional`](group-05-cqrs-pipeline.md#itransactional). The controller injects
the handler interface and calls `HandleAsync`; the concrete type is invisible to it. `[Rubric §6,
CQRS & Event-Driven]` (assesses a clean command/query split through well-defined handler boundaries):
this module is the canonical demonstration, dozens of single-responsibility handlers, each one slice
wide, all dispatched uniformly.

The CRUD-shaped handlers ([`CreateEventHandler`](#createeventhandler),
[`CreateSessionHandler`](#createsessionhandler), [`CreateSpeakerHandler`](#createspeakerhandler),
[`CreateQuestionHandler`](#createquestionhandler),
[`CreateConferenceCategoryHandler`](#createconferencecategoryhandler), and the matching
`Update*`/`Delete*`/`Add*`/`Remove*` families) share one shape: they delegate object construction to an
[`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype)
(which runs the validator and the domain `Create(...)` factory, returning `Result<TEntity>`), then
persist through [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and map the saved entity
back to a DTO with an
[`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype).
The handler owns *orchestration only* (load, validate, persist, map, log) while the business rule
("an event's end date cannot precede its start date") lives in the domain factory and the invariant
classes. The richer handlers add what genuinely needs orchestration context:
[`UpdateSessionHandler`](#updatesessionhandler) and [`UpdateEventHandler`](#updateeventhandler) stamp
the client's concurrency token before mutating
(`MMCA.ADC.Conference.Application/Sessions/UseCases/Update/UpdateSessionHandler.cs:34`,
`MMCA.ADC.Conference.Application/Events/UseCases/Update/UpdateEventHandler.cs:33`) and reject
immutable-field edits with [`Error`](group-01-result-error-handling.md#error)`.UnprocessableEntity`
(`UpdateSessionHandler.cs:39`), and both the create and update session paths run a server-side
double-booking check through [`SessionRoomScheduling`](#sessionroomscheduling)`.BuildOverlapPredicate`
(`MMCA.ADC.Conference.Application/Sessions/Validation/SessionRoomScheduling.cs:26`,
called at `CreateSessionHandler.cs:99` and `UpdateSessionHandler.cs:120`), which builds a
SQL-translatable half-open interval overlap predicate so back-to-back sessions in one room do not
collide (`SessionRoomScheduling.cs:36-39`).

## Manual mapping, validation rule fragments, and authorization specifications

Three sibling families recur across every aggregate. **DTO mappers**
([`SessionDTOMapper`](#sessiondtomapper), [`EventDTOMapper`](#eventdtomapper),
[`SpeakerDTOMapper`](#speakerdtomapper), [`RoomDTOMapper`](#roomdtomapper),
[`CategoryItemDTOMapper`](#categoryitemdtomapper), and the question-answer / category-item link
mappers) implement the Common mapper contract and assign each field *by hand*, the deliberate choice
of [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) (manual/Mapperly mapping over reflection-based AutoMapper) so a renamed property is a
compile error, not a silent null. `[Rubric §9, API & Contract Design]` (assesses explicit, traceable
contracts): the mapping is code you can read and test, not convention magic.

**Validation** is composed, not inherited. Small generic rule fragments
([`EventDateRangeRules<T>`](#eventdaterangerulest), [`EventNameRules<T>`](#eventnamerulest),
[`RoomCapacityRules<T>`](#roomcapacityrulest), [`SessionTitleRules<T>`](#sessiontitlerulest),
[`SpeakerFirstNameRules<T>`](#speakerfirstnamerulest),
[`CategoryItemNameRules<T>`](#categoryitemnamerulest), and a dozen siblings) each encapsulate one
validated concern behind a property selector: the plain string ones subclass the framework's
[`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest) and pass the domain's
max-length invariant through (`MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:13-17`),
while the ones with real logic derive from `AbstractValidator<T>` directly, such as
[`EventTimeZoneRules<T>`](#eventtimezonerulest), which additionally proves the value is a resolvable
IANA identifier (`EventValidationRules.cs:34-48`, BR-87). The per-use-case validators
([`EventUpdateRequestValidator`](#eventupdaterequestvalidator),
[`SessionCreateRequestValidator`](#sessioncreaterequestvalidator), and the rest) pull the fragments
together with FluentValidation's `Include(...)` and add only what is local to the request
(`MMCA.ADC.Conference.Application/Events/UseCases/Update/EventUpdateRequestValidator.cs:11-18`).
[`EventDateRangeRules<T>`](#eventdaterangerulest) is the richest, compiling the `StartDate` selector
into a delegate (`EventValidationRules.cs:68`) and reading it inside a cross-property `Must` on
`EndDate` (`EventValidationRules.cs:69-71`). The pattern mirrors the framework's rule-fragment
families in [G06, Validation](group-06-validation.md#addressline1rulest). `[Rubric §24, Forms,
Validation & UX Safety]` and `[Rubric §1, SOLID]` (fragments compose without an inheritance chain; a
new constraint is a new fragment, touching no existing validator).

**Authorization specifications** ([`PublishedEventSpecification`](#publishedeventspecification),
[`OwnEventQuestionAnswerSpecification`](#owneventquestionanswerspecification),
[`OwnSessionQuestionAnswerSpecification`](#ownsessionquestionanswerspecification)) are
[`ISpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ispecificationtentity-tidentifiertype)
implementations passed into the query services to *scope* what a caller may read (an anonymous visitor
sees only published events; a speaker sees only their own answers). This keeps the authorization
predicate a reusable, testable expression rather than an `if` buried in a controller. `[Rubric §11,
Security]` (assesses authorization that is data-scoped, not just endpoint-gated). The public-session
visibility rule is produced by the [`GetPublicSessionFilterHandler`](#getpublicsessionfilterhandler)
use case via the framework's
[`CrossSourceSpecification`](group-03-querying-specifications.md#crosssourcespecification) helper
(`MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandler.cs:26-33`),
because `Session` may live in a different data source from `Event` ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)): the helper resolves the
published `Event` ids and returns a translatable `Session.EventId IN (...)` filter, ANDed with the
local status check that excludes declined and cancelled sessions
(`GetPublicSessionFilterHandler.cs:31`), so the published-event check is no longer a navigation join.

## Query services, navigation populators, and the composition root

Read paths do not get bespoke handlers for the common cases; they go through the framework's generic
[`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
which supplies filtering, sorting, paging, and field projection. The one local specialization is
[`SpeakerEntityQueryService`](#speakerentityqueryservice), a thin subclass that overrides only the
DTO-to-entity property map so API consumers can sort and filter on the computed `FullName` while the
pipeline translates it to `(FirstName + " " + LastName)`
(`MMCA.ADC.Conference.Application/Speakers/SpeakerEntityQueryService.cs:28-34`). Eager-loading of
child graphs is delegated to per-aggregate
[`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity)
implementations ([`EventNavigationPopulator`](#eventnavigationpopulator),
[`SessionNavigationPopulator`](#sessionnavigationpopulator),
[`SpeakerNavigationPopulator`](#speakernavigationpopulator),
[`ConferenceCategoryNavigationPopulator`](#conferencecategorynavigationpopulator)), which encapsulate
which navigations to include and how to batch-load cross-source relationships ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)); child
entities and the childless `Question` aggregate use the framework's
[`NullNavigationPopulator<TEntity>`](group-11-navigation-populators.md#nullnavigationpopulatortentity)
because they are never the root of a full graph load
(`MMCA.ADC.Conference.Application/DependencyInjection.cs:61-88`).

All of this is wired by [`DependencyInjection`](#dependencyinjection), the module's **composition
root** (`MMCA.ADC.Conference.Application/DependencyInjection.cs:32`, with the registration surface
exposed as a C# `extension(IServiceCollection)` member at `DependencyInjection.cs:34-36`). It
explicitly binds the closed generics Scrutor cannot infer (the cascade-deletion domain service, then
each aggregate's navigation populator, query service, and delete handler, plus the two cross-module
validation services, `DependencyInjection.cs:41-94`) and then calls
`ScanModuleApplicationServices<ClassReference>()` (`DependencyInjection.cs:98`) to discover the "many
small things" (every handler, mapper, validator, and event handler) by convention.
[`AssemblyReference`](#assemblyreference) and [`ClassReference`](#classreference) are the marker types
that anchor that scan. `[Rubric §7, Microservices Readiness]` (assesses clean, explicit module
boundaries): every internal concrete type is reachable only through an interface registered here,
which is exactly what lets the Conference module boot as its own service host. `[Rubric §33, Developer
Experience]`: one file is the single place a new aggregate gets registered.

## Event-driven reactions: domain and integration handlers

The application layer is also where the module *reacts* to events. **Domain event handlers** implement
[`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent)
and run in-process after the aggregate's `SaveChangesAsync`. Two of the three are deliberately
observability-only: [`SessionCreatedHandler`](#sessioncreatedhandler) filters `SessionChanged` down to
the `Added` state and writes one structured log line
(`MMCA.ADC.Conference.Application/Sessions/DomainEventHandlers/SessionCreatedHandler.cs:17-21`), and
[`RoomChangedHandler`](#roomchangedhandler) logs every room add/update/delete
(`MMCA.ADC.Conference.Application/Events/DomainEventHandlers/RoomChangedHandler.cs:17`), which is the
`[Rubric §13, Observability & Operability]` story: the event stream is where lifecycle telemetry is
emitted, not the entity. [`SpeakerDeletedHandler`](#speakerdeletedhandler) is the one with a real side
effect: on a `Deleted` state with a previously linked user it opens its own DI scope (the handler is a
singleton) and publishes `SpeakerUnlinkedFromUser` so Identity can clear `User.LinkedSpeakerId`
(BR-70, `MMCA.ADC.Conference.Application/Speakers/DomainEventHandlers/SpeakerDeletedHandler.cs:38-45`).

The integration event handler [`UserRegisteredHandler`](#userregisteredhandler) implements
[`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent)
and is the cross-module boundary in the other direction: when Identity publishes `UserRegistered` over
the broker, Conference auto-links a speaker to that user (BR-207). It tries an email match first and
falls back to a unique-name match for Sessionize-imported speakers whose `Email` is `null` (the public
Sessionize feed omits PII), linking only when exactly one unlinked candidate matches
(`MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserRegisteredHandler.cs:58-64`,
with the ambiguity guard at `:169-173`), and publishes `SpeakerLinkedToUser` back to Identity on a hit
(`UserRegisteredHandler.cs:102-104`). The handler is deliberately best-effort: it runs in its own DI
scope because the handler is a singleton (`UserRegisteredHandler.cs:52`), and any non-cancellation
failure is swallowed so the already-committed registration never rolls back
(`UserRegisteredHandler.cs:108-113`). Publishing flows through the
[`IIntegrationEventPublisher`](group-04-events-outbox.md#iintegrationeventpublisher) abstraction and
the outbox ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)), so the application code never references MassTransit. `[Rubric §6, CQRS &
Event-Driven]` and `[Rubric §7, Microservices Readiness]`: the module collaborates through events and
interfaces, never direct cross-module type references.

Two in-process services close the loop with the Engagement module.
[`SessionBookmarkValidationService`](#sessionbookmarkvalidationservice)
(`MMCA.ADC.Conference.Application/Sessions/SessionBookmarkValidationService.cs:12`) and
[`EventLiveValidationService`](#eventlivevalidationservice)
(`MMCA.ADC.Conference.Application/Events/EventLiveValidationService.cs:18`) implement the
Engagement-facing contracts
[`ISessionBookmarkValidationService`](group-17-conference-domain.md#isessionbookmarkvalidationservice)
and [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice), which
Engagement calls via gRPC when the modules run as separate services ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)): the former gates
session bookmarking (BR-49/BR-91), the latter computes an event or session live window in UTC from the
event's dates and IANA time zone, and the session variant adds the assigned speakers (BR-236), the
plenum flag, and the event's question-moderation default (BR-233)
(`EventLiveValidationService.cs:21-59`). The traffic also runs the other way:
[`GetSessionBookmarkCountsHandler`](#getsessionbookmarkcountshandler) re-verifies server-side that
every requested session really belongs to the speaker before delegating the counting to Engagement's
batched [`IBookmarkCountService`](group-22-engagement-module.md#ibookmarkcountservice), silently
dropping ids that are not the speaker's rather than failing the whole batch
(`MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionBookmarkCounts/GetSessionBookmarkCountsHandler.cs:33-45`),
which is `[Rubric §11, Security]` (never trust the client's id list) and `[Rubric §12, Performance &
Scalability]` (one cross-service round-trip instead of one per session) in a single handler.

## Attendee-facing read models: calendar export and Now/Next

A small cluster of queries serves the public schedule surfaces without going through the generic query
service, because their output is not a DTO list.
[`ExportEventCalendarHandler`](#exporteventcalendarhandler) and
[`ExportSessionCalendarHandler`](#exportsessioncalendarhandler) return a `Result<string>` holding an
`.ics` document: the event variant loads the event with its rooms, refuses unpublished or unknown
events with `Error.NotFound`, and turns every exportable session (scheduled, non-service, not
declined/cancelled) into one VEVENT with the room as its location
(`MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportEventCalendarHandler.cs:25-40`),
with [`CalendarExportMapper`](#calendarexportmapper) doing the entity-to-entry shaping.
[`GetNowNextHandler`](#getnownexthandler) builds the conference-day "happening now plus next up"
snapshot for one published event or, when no id is given, the auto-selected current-or-next published
event using the domain's [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector)
rule, reusing the same eligibility rules and DST-aware wall-clock conversion as the calendar export
(`MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextHandler.cs:20-41`).
`GetNowNextHandler` injects `TimeProvider` rather than reading the clock directly
(`GetNowNextHandler.cs:20-22`), which is what makes its "now" unit-testable at a fixed instant; the two
export handlers instead stamp the `.ics` `DTSTAMP` from `DateTimeOffset.UtcNow` directly
(`ExportEventCalendarHandler.cs:50`, `ExportSessionCalendarHandler.cs:51`), so their timestamp is not
injectable. `[Rubric §14, Testability]`.

## The Sessionize import: Strategy-pattern orchestration

The single most involved use case is **importing a conference agenda from Sessionize.com**. Sessionize
returns one JSON payload covering five interdependent entity families (categories, rooms, questions,
speakers, and sessions, where sessions reference rooms and speakers and speakers reference categories).
The HTTP shape is captured by a set of deserialization records
([`SessionizeResponse`](#sessionizeresponse), [`SessionizeSession`](#sessionizesession),
[`SessionizeSpeaker`](#sessionizespeaker), [`SessionizeRoom`](#sessionizeroom),
[`SessionizeCategory`](#sessionizecategory), [`SessionizeCategoryItem`](#sessionizecategoryitem),
[`SessionizeQuestion`](#sessionizequestion),
[`SessionizeQuestionAnswer`](#sessionizequestionanswer), [`SessionizeLink`](#sessionizelink))
confined entirely to this layer, an **anti-corruption boundary** so a Sessionize API change never
touches a domain entity.

The import is fetched through the [`ISessionizeService`](#isessionizeservice) port (implemented by the
HTTP client in [G19, Conference Infrastructure](group-19-conference-infrastructure.md#sessionizeservice))
and orchestrated by [`RefreshFromSessionizeHandler`](#refreshfromsessionizehandler)
(`MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeHandler.cs:16`).
That handler does *orchestration only*: load the `Event` with its rooms and speakers eagerly
(`:41-45`), enforce BR-6 (a Sessionize code must be configured, `:54`) and the BR-63 five-minute
throttle (`:64-65`), call the external API inside a `try`/`catch (HttpRequestException)` that converts
a network failure into an [`Error`](group-01-result-error-handling.md#error) (`:80-87`), then run five
[`ISessionizeSyncStrategy`](#isessionizesyncstrategy) implementations in dependency order
([`CategorySyncStrategy`](#categorysyncstrategy), [`RoomSyncStrategy`](#roomsyncstrategy),
[`QuestionSyncStrategy`](#questionsyncstrategy), [`SpeakerSyncStrategy`](#speakersyncstrategy),
[`SessionSyncStrategy`](#sessionsyncstrategy), `:25-32`), each carrying its work via a shared
[`SessionizeSyncContext`](#sessionizesynccontext) and returning a
[`SessionizeSyncResult`](#sessionizesyncresult) count. An empty response is treated as success rather
than an error (`:90-105`). Each strategy bulk-loads its entity family in one call (no N+1), upserts via
the domain's `Create`/`Update` methods, skips soft-deleted rows (BR-136, warned once at `:122-125`),
and accumulates warnings instead of aborting on one bad record. A final `RequestIdentityInsert()`
(`:132`) lets SQL Server accept Sessionize's own integer IDs before one batched `SaveChangesAsync`
(`:133`). `[Rubric §2, Design Patterns]` (Strategy solving a real Open/Closed problem: a new entity
family is a new strategy, not an edit to the orchestrator), `[Rubric §12, Performance & Scalability]`
(bulk loads plus a single save round-trip), and `[Rubric §17, DevOps & Deployment]` (the throttle and
graceful per-entity degradation make a re-import safe to run repeatedly).

## Decision support: AI scoring and content analytics

The last cluster is **session-selection decision support**, analytics that help organizers triage
proposals. [`GetSessionSelectionDashboardHandler`](#getsessionselectiondashboardhandler) is a
*composite* query: it validates the event, loads the event's non-service sessions with their speakers
and category items, the categories, and the referenced speakers once
(`MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardHandler.cs:29-57`),
then computes summary counts, category distribution, speaker-session overlap, content similarity, and
speaker locality into one dashboard DTO. The narrower queries
([`GetCategoryDistributionQuery`](#getcategorydistributionquery),
[`GetContentSimilarityQuery`](#getcontentsimilarityquery),
[`GetSpeakerSessionOverlapQuery`](#getspeakersessionoverlapquery)) remain dispatchable individually.
Content similarity is computed by the pure-static
[`SessionSimilarityCalculator`](#sessionsimilaritycalculator), a weighted sum of two Jaccard indices,
category-item overlap at 60%
(`MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/SessionSimilarityCalculator.cs:11`)
and span-tokenized keyword overlap at 40% (`:12`, with a `FrozenSet` stop-word filter at `:14-34` and a
three-character minimum token length at `:62`), combined at `:97-105`, above a tunable threshold whose
default is 0.3
(`MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/GetContentSimilarityQuery.cs:6`),
flagging proposals that would compete for the same audience.
[`SpeakerLocalityHelper`](#speakerlocalityhelper) resolves a speaker's locality tier through the
"where are you traveling from" category assignment rather than a `Speaker` field
(`MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/SpeakerLocalityHelper.cs:19-33`),
and the two private per-handler [`StatusBucket`](#statusbucket) enums map
[`SessionStatuses`](group-17-conference-domain.md#sessionstatuses) values into display groupings.

The flagship is **AI scoring**. [`ScoreEventSessionsCommand`](#scoreeventsessionscommand) (handled by
[`ScoreEventSessionsHandler`](#scoreeventsessionshandler)) is a full re-score: it loads every
non-service session for the event, deletes the existing scores in one set-based `ExecuteDeleteAsync`
so the dashboard visibly resets
(`MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsHandler.cs:39-41`),
batch-loads the speakers (`:56-60`), then scores session by session through
[`IAiScoringService`](#iaiscoringservice), a port implemented in infrastructure by
[`AnthropicScoringService`](group-19-conference-infrastructure.md#anthropicscoringservice), which calls
the Anthropic Messages API. Each successful score is saved immediately (`:102-103`) so the UI can show
real-time progress, a per-session save failure only increments a counter (`:108-112`), and the command
fails as a whole only when every session failed (`:117-123`). The contract is deliberately
**never-throw**: `ScoreSessionAsync` returns a [`SessionScoringResult`](#sessionscoringresult) with a
`Success` flag and seven `1.0`-`10.0` sub-scores (overall, topic relevance, description quality,
novelty, actionable takeaways, depth/insight quality, credibility/experience) in *all* cases
(`MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:9,40-71`),
so one bad session never aborts the scoring loop. The input shapes are
[`SessionScoringInput`](#sessionscoringinput) and [`SpeakerInfo`](#speakerinfo)
(`IAiScoringService.cs:23-37`); the result is mapped onto the `SessionAiScore` aggregate for
persistence (`ScoreEventSessionsHandler.cs:87-91`). Keeping the *port* here and the HTTP/LLM *adapter*
in infrastructure is textbook `[Rubric §3, Clean Architecture]` (the application layer depends on an
interface, never the SDK) and `[Rubric §7, Microservices Readiness]` (the AI provider is swappable
behind one interface).

Taken together, this assembly is the codebase's most complete picture of how a use case is built here:
a slice per feature, generic framework machinery for the repetitive 80% (query, validate, map, persist,
populate), and bespoke handlers reserved for the genuinely complex 20% (the Sessionize import, the
attendee-facing read models, and the decision-support analytics), each isolated behind a port or a
strategy so it can evolve, be tested, and ultimately be extracted without disturbing the rest.

### AssemblyReference
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: a tiny static class exposing the Conference Application assembly and its short name as two `static readonly` fields, so scanners and registrars have a strongly-typed handle on this assembly.
- **Depends on**: `System.Reflection` (BCL) only.
- **Concept, the assembly-anchor type.** `[Rubric §5, Vertical Slice]` assesses whether a module is a self-contained, discoverable unit; a per-assembly anchor type is how the framework's reflection-based wiring finds "everything in the Conference Application layer" without hard-coding a namespace string. The two fields (`AssemblyReference.cs:7-8`) are `Assembly = typeof(AssemblyReference).Assembly` and `AssemblyName = Assembly.GetName().Name ?? string.Empty`, both computed once at type-load. There is a sibling anchor in every layer (see the identically-named types in the Conference API and Domain groups), so a caller can name the exact assembly it means.
- **Walkthrough**: two fields only, no methods. `Assembly` resolves the containing assembly via `typeof(this).Assembly`; `AssemblyName` reads `Assembly.GetName().Name`, defaulting to `string.Empty` when the runtime reports a null simple name.
- **Why it's built this way**: taking `typeof(AssemblyReference).Assembly` is refactor-safe (renaming the assembly or moving the file changes nothing), which is why the framework prefers an anchor type over a hard-coded `Assembly.Load("...")`.
- **Where it's used**: assembly-scoped tooling and OpenAPI/validator discovery that needs the Conference Application assembly by reference. The scan performed inside [`DependencyInjection`](#dependencyinjection) instead anchors on [`ClassReference`](#classreference) (a `typeof`-friendly type argument).

### CategoryItemSortRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/Validation/ConferenceCategoryValidationRules.cs:39` · Level 0 · class (sealed)

- **What it is**: a reusable FluentValidation rule fragment that enforces a non-negative sort order (`>= 0`) on any request field selected as an `int`.
- **Depends on**: `FluentValidation` (`AbstractValidator<T>`, NuGet), `System.Linq.Expressions` (BCL).
- **Concept introduced, the generic reusable validator rule.** `[Rubric §1, SOLID]` (single-responsibility, do-not-repeat) and `[Rubric §16, Maintainability & Evolvability]` (one place to change a constraint) both apply. Rather than re-declare the same "sort must be non-negative" check inside every create/update validator, the rule is written once as a generic `AbstractValidator<T>` that takes an `Expression<Func<T, int>>` selector (`ConferenceCategoryValidationRules.cs:42`) pointing at whichever property carries the sort value. A concrete command validator then composes this fragment against its own request shape. This is the FluentValidation "child rules / include" composition idiom applied generically.
- **Walkthrough**: a constructor `CategoryItemSortRules(Expression<Func<T, int>> selector)` (`ConferenceCategoryValidationRules.cs:42`) whose body is a single `RuleFor(selector).GreaterThanOrEqualTo(0)` with message "Sort order must be greater than or equal to 0" and error code `CategoryItem.Sort.Negative` (`ConferenceCategoryValidationRules.cs:43-44`). Stable error codes (not just messages) let clients and tests key off the failure without string-matching prose.
- **Why it's built this way**: generic over `T` so the same fragment serves the add-item and update-item request types; `sealed` because it is a leaf composition unit with no intended subclassing.
- **Where it's used**: composed by the Category use-case validators (add/update category-item commands) in this module. Sibling fragments in the same file are [`CategoryItemNameRules<T>`](#categoryitemnamerulest) and [`ConferenceCategoryTitleRules<T>`](#conferencecategorytitlerulest).

### ClassReference
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: an empty marker class used purely as a `typeof` anchor for assembly scanning; it declares no members.
- **Depends on**: nothing first-party.
- **Concept, the scan-anchor marker.** `[Rubric §2, Design Patterns]` (assesses idiomatic registration wiring). Scrutor-style scanning APIs are commonly generic over an anchor type: `ScanModuleApplicationServices<ClassReference>()` tells the scanner "start from the assembly that contains `ClassReference`", i.e. this Application layer. The class body is empty (`AssemblyReference.cs:11`); its only job is to be a compile-time-checked stand-in for the assembly.
- **Walkthrough**: `public class ClassReference { }`, no fields, no methods.
- **Why it's built this way**: a dedicated marker keeps the scan call site refactor-safe and avoids anchoring the scan on a real domain type that might later move to another assembly.
- **Where it's used**: passed as the type argument to `ScanModuleApplicationServices<ClassReference>()` in [`DependencyInjection`](#dependencyinjection) (`DependencyInjection.cs:100`).

### SessionizeCategoryItem
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:60` · Level 0 · record (sealed)

- **What it is**: the leaf DTO for one category value from the Sessionize "View All" API (for example "Beginner" under the "Level" category, or ".NET" under "Track"): an `Id`, a `Name`, and a `Sort` order.
- **Depends on**: `System.Text.Json.Serialization` (`[JsonPropertyName]`, BCL) only.
- **Concept introduced, the external-API contract DTO.** `[Rubric §9, API & Contract Design]` (assesses explicit boundary contracts) and `[Rubric §32, Dependency & Supply-Chain]` (assesses controlling the shape of data crossing a third-party boundary). The whole `Sessionize*` family models the JSON wire format of an external system the conference is imported from. Each type is a `sealed record` with `init`-only properties defaulted to a non-null empty value (`Name { get; init; } = string.Empty`, `SessionizeModels.cs:66`), and every property carries a `[JsonPropertyName("...")]` mapping the C# name to the exact Sessionize field (`SessionizeModels.cs:62-69`). Modeling the external contract as its own dedicated, immutable type (rather than binding straight onto domain entities) is the anti-corruption discipline: the messy outside shape is captured here, then translated into the domain by the sync strategies. The rest of the `Sessionize*` records in this file share this exact shape; their sections cross-reference back here.
- **Walkthrough**: three `init` properties, `Id` (`int`, line 63), `Name` (`string`, empty default, line 66), `Sort` (`int`, line 69), each JSON-mapped. No behavior; it is a pure data-transfer record.
- **Why it's built this way**: `record` gives structural equality and immutability for free (see the [`ValueObject`](group-02-domain-building-blocks.md#valueobject) discussion of records); `init` plus non-null defaults means System.Text.Json can populate it while callers cannot mutate it afterward and never see a null string.
- **Where it's used**: nested inside [`SessionizeCategory`](#sessionizecategory)'s `Items`; consumed by the category sync path of the Sessionize import ([`CategorySyncStrategy`](#categorysyncstrategy)).

### SessionizeLink
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:126` · Level 0 · record (sealed)

- **What it is**: the DTO for one speaker social link from Sessionize: a `Title`, a `Url`, and a `LinkType` (for example "Twitter", "LinkedIn").
- **Depends on**: `System.Text.Json.Serialization` (BCL); `System.Diagnostics.CodeAnalysis` (a scoped analyzer suppression).
- **Concept**: an external-API contract DTO, the pattern taught on [`SessionizeCategoryItem`](#sessionizecategoryitem). `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: three `init` string properties, all empty-defaulted and JSON-mapped (`SessionizeModels.cs:128-136`). `Url` carries `[SuppressMessage("Design", "CA1056:URI-like properties should not be strings", ...)]` (`SessionizeModels.cs:131`) with the justification "Deserialized from Sessionize JSON": the analyzer wants a `Uri`, but the field must round-trip whatever string Sessionize sends, so the suppression is scoped and justified inline.
- **Why it's built this way**: keeping `Url` a `string` avoids `Uri` parsing failing the deserialization when Sessionize sends a non-canonical value; validation/parsing, if needed, happens after import, not at the wire boundary.
- **Where it's used**: nested inside [`SessionizeSpeaker`](#sessionizespeaker)'s `Links`.

### SessionizeQuestion
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:25` · Level 0 · record (sealed)

- **What it is**: the DTO for one custom-question definition from Sessionize: `Id`, `Question` text, `QuestionType`, and a `Sort` order.
- **Depends on**: `System.Text.Json.Serialization` (BCL) only.
- **Concept**: an external-API contract DTO ([`SessionizeCategoryItem`](#sessionizecategoryitem)). `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: four `init` properties, `Id` (`int`, line 28), `Question` (`string`, empty default, line 31), `QuestionType` (`string`, empty default, line 34), `Sort` (`int`, line 37), each JSON-mapped.
- **Where it's used**: nested inside [`SessionizeResponse`](#sessionizeresponse)'s `Questions`; imported by the question sync path of the Sessionize refresh ([`RefreshFromSessionizeCommand`](#refreshfromsessionizecommand)).

### SessionizeQuestionAnswer
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:195` · Level 0 · record (sealed)

- **What it is**: the DTO for one answer to a Sessionize custom question: a `QuestionId` and its `AnswerValue`.
- **Depends on**: `System.Text.Json.Serialization` (BCL) only.
- **Concept**: an external-API contract DTO ([`SessionizeCategoryItem`](#sessionizecategoryitem)). `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: two `init` properties, `QuestionId` (`int`, line 198) and `AnswerValue` (`string`, empty default, line 201), each JSON-mapped.
- **Where it's used**: nested inside both [`SessionizeSpeaker`](#sessionizespeaker)'s and [`SessionizeSession`](#sessionizesession)'s `QuestionAnswers` collections.

### SessionizeRoom
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:73` · Level 0 · record (sealed)

- **What it is**: the DTO for one room from Sessionize: `Id`, `Name`, `Sort`.
- **Depends on**: `System.Text.Json.Serialization` (BCL) only.
- **Concept**: an external-API contract DTO ([`SessionizeCategoryItem`](#sessionizecategoryitem)). `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: three `init` properties, `Id` (`int`, line 75), `Name` (`string`, empty default, line 78), `Sort` (`int`, line 81), each JSON-mapped; structurally identical to [`SessionizeCategoryItem`](#sessionizecategoryitem).
- **Where it's used**: nested inside [`SessionizeResponse`](#sessionizeresponse)'s `Rooms`; imported by the room sync path of the Sessionize refresh.

### SessionizeCategory
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:41` · Level 1 · record (sealed)

- **What it is**: the DTO for one Sessionize category (for example "Level" or "Track"), owning a nested list of its [`SessionizeCategoryItem`](#sessionizecategoryitem) values.
- **Depends on**: [`SessionizeCategoryItem`](#sessionizecategoryitem) (its `Items` collection); `System.Text.Json.Serialization` (BCL).
- **Concept**: an external-API contract DTO ([`SessionizeCategoryItem`](#sessionizecategoryitem)); this is the first `Sessionize*` type that nests another, which is why it sits one level up. `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: five `init` properties (`SessionizeModels.cs:43-56`), `Id` (`int`), `Title` (`string`, empty default), `Sort` (`int`), a nullable `Type` (`string?`, line 53, so an absent JSON field stays null), and `Items` (`IReadOnlyList<SessionizeCategoryItem>` defaulted to `[]`, line 56). Defaulting the list to an empty collection literal means a category with no items deserializes to an empty list rather than null.
- **Where it's used**: nested inside [`SessionizeResponse`](#sessionizeresponse)'s `Categories`; its items drive category-item import.

### SessionizeSession
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:140` · Level 1 · record (sealed)

- **What it is**: the richest Sessionize DTO, one conference session with its schedule, room, speakers, category assignments, question answers, and live/recording metadata.
- **Depends on**: [`SessionizeQuestionAnswer`](#sessionizequestionanswer) (its `QuestionAnswers` list); `System.Text.Json.Serialization` (BCL); `System.Diagnostics.CodeAnalysis` (scoped suppressions).
- **Concept**: an external-API contract DTO ([`SessionizeCategoryItem`](#sessionizecategoryitem)), here at full width. `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: many `init` properties (`SessionizeModels.cs:142-191`). Three carry extra handling worth knowing:
  - `Id` (`int`) is annotated `[JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]` (`SessionizeModels.cs:143`): Sessionize sometimes serializes the session id as a JSON string rather than a number, and this permits reading it either way.
  - `StartsAt`/`EndsAt` are `DateTime?` (lines 152-156), so an unscheduled session round-trips with nulls instead of failing.
  - `Speakers` is `IReadOnlyList<Guid>` and `CategoryItems` is `IReadOnlyList<int>` (lines 164-168): the session references speakers and category items by their Sessionize ids, not by nesting the full objects, so cross-references are resolved during import.
  - `LiveUrl` and `RecordingUrl` are nullable strings with the same `CA1056` URI-suppression as [`SessionizeLink`](#sessionizelink)'s `Url` (lines 176-182).
- **Why it's built this way**: the id-reference lists (rather than nested objects) mirror how Sessionize normalizes its own payload; the import strategies join `Speakers`/`CategoryItems` ids back to the already-imported entities.
- **Where it's used**: nested inside [`SessionizeResponse`](#sessionizeresponse)'s `Sessions`; imported by the session sync path of [`RefreshFromSessionizeCommand`](#refreshfromsessionizecommand).

### SessionizeSpeaker
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:86` · Level 1 · record (sealed)

- **What it is**: the DTO for one speaker from Sessionize, with profile fields, social [`SessionizeLink`](#sessionizelink)s, question answers, and id references to the speaker's sessions and category items.
- **Depends on**: [`SessionizeLink`](#sessionizelink) (`Links`), [`SessionizeQuestionAnswer`](#sessionizequestionanswer) (`QuestionAnswers`); `System.Text.Json.Serialization` (BCL).
- **Concept**: an external-API contract DTO ([`SessionizeCategoryItem`](#sessionizecategoryitem)). `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: many `init` properties (`SessionizeModels.cs:88-122`). `Id` is a `Guid` (line 89) (unlike the `int` ids of most other Sessionize entities, matching the Conference domain's `SpeakerIdentifierType = Guid`). Optional profile fields (`Bio`, `TagLine`, `ProfilePicture`, `FullName`) are nullable strings; `IsTopSpeaker` is a `bool`; `Links` (line 110), `Sessions` (`IReadOnlyList<int>`, line 113), `CategoryItems` (`IReadOnlyList<int>`, line 119), and `QuestionAnswers` (line 122) are all empty-defaulted collections.
- **Why it's built this way**: the `Guid` speaker id lines up with the Conference domain's speaker identifier alias, so the import can map a Sessionize speaker to a domain [`Speaker`](group-17-conference-domain.md#speaker) without a type conversion.
- **Where it's used**: nested inside [`SessionizeResponse`](#sessionizeresponse)'s `Speakers`; imported by the speaker sync path of the Sessionize refresh.

### SessionizeResponse
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:6` · Level 2 · record (sealed)

- **What it is**: the top-level envelope for the Sessionize "View All" API response, holding the five parallel collections (`Categories`, `Rooms`, `Speakers`, `Sessions`, `Questions`) that make up an entire conference import payload.
- **Depends on**: [`SessionizeCategory`](#sessionizecategory), [`SessionizeRoom`](#sessionizeroom), [`SessionizeSpeaker`](#sessionizespeaker), [`SessionizeSession`](#sessionizesession), [`SessionizeQuestion`](#sessionizequestion); `System.Text.Json.Serialization` (BCL).
- **Concept**: the root of the external-API contract DTO tree ([`SessionizeCategoryItem`](#sessionizecategoryitem) taught the shape). `[Rubric §9, API & Contract Design]`. This is the object [`ISessionizeService`](#isessionizeservice)'s `GetAllAsync` returns and the single input every Sessionize sync strategy reads from.
- **Walkthrough**: five `init` `IReadOnlyList<...>` properties, each empty-defaulted and JSON-mapped to the lowercased Sessionize field (`SessionizeModels.cs:8-21`). "View All" is Sessionize's denormalized endpoint: it returns every entity type in one document, which is why this envelope has one collection per entity kind rather than a paged, per-type shape.
- **Why it's built this way**: one immutable envelope makes the import atomic to reason about, the strategies receive the whole snapshot and reconcile the domain against it, and empty-list defaults mean a payload missing a section is still a valid, non-null response.
- **Where it's used**: returned (nullable) by [`ISessionizeService`](#isessionizeservice); consumed by the refresh command and its sync strategies ([`RefreshFromSessionizeCommand`](#refreshfromsessionizecommand), [`SessionizeSyncContext`](#sessionizesynccontext)).

### ISessionizeService
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/ISessionizeService.cs:6` · Level 3 · interface

- **What it is**: the one-method contract for fetching a whole conference from the Sessionize "View All" API, returning a [`SessionizeResponse`](#sessionizeresponse) (or `null` when the response is empty).
- **Depends on**: [`SessionizeResponse`](#sessionizeresponse) (its return type).
- **Concept introduced, the outbound-port interface (dependency inversion at the external boundary).** `[Rubric §3, Clean Architecture]` (assesses whether the Application layer depends on abstractions it owns, with concrete adapters living outward) and `[Rubric §7, Microservices Readiness]` (assesses isolating third-party calls behind a swappable boundary). The Application layer declares *what* it needs from Sessionize (this interface) while the HTTP client that actually calls the API lives in the Infrastructure layer and implements it. That inversion keeps the import use cases testable (a fake `ISessionizeService` feeds a canned response) and keeps the `HttpClient`/retry concerns out of the Application layer.
- **Walkthrough**: a single method `Task<SessionizeResponse?> GetAllAsync(string sessionizeCode, CancellationToken cancellationToken = default)` (`ISessionizeService.cs:12`). The `sessionizeCode` is the per-event Sessionize code (the doc comment gives the example `"kqf8l42a"`, `ISessionizeService.cs:9`); the nullable return signals an empty/absent response rather than throwing; and the trailing `CancellationToken` follows the codebase convention that every async boundary is cancelable.
- **Why it's built this way**: a narrow, single-purpose port is the smallest surface the import needs, which makes both the real HTTP adapter and its test double trivial to write.
- **Where it's used**: injected by the Sessionize refresh use case and its strategies; the concrete HTTP implementation is registered from the Conference Infrastructure layer (Group 19).

### CategoryItemNameRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/Validation/ConferenceCategoryValidationRules.cs:26` · Level 6 · class (sealed)

- **What it is**: a reusable FluentValidation rule fragment enforcing that a category-item name is non-empty and within the max length defined by the domain.
- **Depends on**: `FluentValidation` (`AbstractValidator<T>`), [`CategoryInvariants`](group-17-conference-domain.md#categoryinvariants) (the shared `CategoryItemNameMaxLength` constant), `System.Linq.Expressions` (BCL).
- **Concept**: the generic reusable validator rule, taught on [`CategoryItemSortRules<T>`](#categoryitemsortrulest). `[Rubric §1, SOLID]` and `[Rubric §16, Maintainability & Evolvability]`.
- **Walkthrough**: constructor `CategoryItemNameRules(Expression<Func<T, string>> selector)` (`ConferenceCategoryValidationRules.cs:29`) whose body is one chained `RuleFor(selector)`: `.NotEmpty()` with error code `CategoryItem.Name.Required`, then `.MaximumLength(CategoryInvariants.CategoryItemNameMaxLength)` with error code `CategoryItem.Name.MaxLength` (`ConferenceCategoryValidationRules.cs:30-32`). The max-length bound is read from [`CategoryInvariants`](group-17-conference-domain.md#categoryinvariants), the single source of truth that the domain, the EF configuration, and this validator all share, so the length rule cannot drift between layers.
- **Why it's built this way**: pulling the constant from the domain invariants (rather than a literal here) is exactly the "one place to change a constraint" discipline; generic over `T` so it composes into whichever request carries the name.
- **Where it's used**: composed by the add/update category-item command validators. Siblings: [`CategoryItemSortRules<T>`](#categoryitemsortrulest), [`ConferenceCategoryTitleRules<T>`](#conferencecategorytitlerulest).

### ConferenceCategoryTitleRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/Validation/ConferenceCategoryValidationRules.cs:12` · Level 6 · class (sealed)

- **What it is**: a reusable FluentValidation rule fragment enforcing that a conference-category title is non-empty and within the domain-defined max length.
- **Depends on**: `FluentValidation` (`AbstractValidator<T>`), [`CategoryInvariants`](group-17-conference-domain.md#categoryinvariants) (the `TitleMaxLength` constant), `System.Linq.Expressions` (BCL).
- **Concept**: the generic reusable validator rule, taught on [`CategoryItemSortRules<T>`](#categoryitemsortrulest). `[Rubric §1, SOLID]` and `[Rubric §16, Maintainability & Evolvability]`.
- **Walkthrough**: constructor `ConferenceCategoryTitleRules(Expression<Func<T, string>> selector)` (`ConferenceCategoryValidationRules.cs:15`) with one chained `RuleFor(selector)`: `.NotEmpty()` (error code `Category.Title.Required`) then `.MaximumLength(CategoryInvariants.TitleMaxLength)` (error code `Category.Title.MaxLength`) (`ConferenceCategoryValidationRules.cs:16-18`). Structurally identical to [`CategoryItemNameRules<T>`](#categoryitemnamerulest), differing only in the target property and its constant/error codes.
- **Where it's used**: composed by the create/update conference-category command validators.

### DependencyInjection
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/DependencyInjection.cs:34` · Level 11 · class (static, extension block)

- **What it is**: the Conference module's application-layer composition root: a static class exposing the `AddModuleConferenceApplication(ApplicationSettings)` extension method that registers every application service for the module into the DI container.
- **Depends on**: [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings), the Conference domain aggregates ([`Event`](group-17-conference-domain.md#event), [`Session`](group-17-conference-domain.md#session), [`Speaker`](group-17-conference-domain.md#speaker), [`Category`/`CategoryItem`](group-17-conference-domain.md#categoryitem) and their children), the framework generics [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype) and [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity), the cross-module ports [`ISessionBookmarkValidationService`](group-17-conference-domain.md#isessionbookmarkvalidationservice) and [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice), and [`ClassReference`](#classreference); `Microsoft.Extensions.DependencyInjection` (NuGet), Scrutor (assembly scanning).
- **Concept introduced, the module composition root via `extension(IServiceCollection)`.** `[Rubric §5, Vertical Slice]` (assesses whether each module wires its own slice) and `[Rubric §2, Design Patterns]` (assesses idiomatic registration). The registration method is written as a C# `extension(IServiceCollection services)` block (`DependencyInjection.cs:36`) so callers invoke `services.AddModuleConferenceApplication(...)` (the same `extension(T)` member pattern taught in [primer](../00-primer.md#c-extensiont-types--read-this-once) and used across the codebase for DI). It mixes two registration styles the class comment (`DependencyInjection.cs:29-33`) names: explicit `TryAdd*` registrations for the generic per-entity services, and convention-based Scrutor scanning for the many hand-written handlers, mappers, and validators.
- **Walkthrough** (registration order in the method body):
  - `applicationSettings` is accepted but currently only stored via `_ = applicationSettings` with a "reserved for future use" note (`DependencyInjection.cs:40`), so the parameter is part of the module contract even though this module does not yet branch on it.
  - Domain service: `IEventCascadeDeletionDomainService` is registered as a singleton (`DependencyInjection.cs:43`).
  - Aggregate roots with custom navigation populators (`Event`, `Session`, `Speaker`, `Category`) each get three registrations, `INavigationPopulator<T>`, `IEntityQueryService<T, TDTO, TId>`, and a `DeleteEntityCommand` handler (`DependencyInjection.cs:46-60`). `Event` uses a bespoke `DeleteEventHandler` while `Session`/`Speaker`/`Category` use the generic `DeleteEntityHandler<,>`; the cascade-delete rule for events is why `Event` is special-cased.
  - Aggregate roots with no child navigations (`Question`) get the same trio but with a `NullNavigationPopulator<Question>` (`DependencyInjection.cs:63-65`).
  - Child entities (`Room`, `CategoryItem`, `EventSpeaker`, `EventQuestionAnswer`, `SessionSpeaker`, `SessionCategoryItem`, `SessionQuestionAnswer`, `SpeakerCategoryItem`) each get a `NullNavigationPopulator` plus the base `EntityQueryService` (`DependencyInjection.cs:68-90`), no delete handler, because children are removed through their aggregate root.
  - Cross-module ports: [`ISessionBookmarkValidationService`](group-17-conference-domain.md#isessionbookmarkvalidationservice) → `SessionBookmarkValidationService` and [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice) → `EventLiveValidationService` (`DependencyInjection.cs:93-96`), the in-process interfaces the Engagement service later reaches over gRPC.
  - Finally `services.ScanModuleApplicationServices<ClassReference>()` (`DependencyInjection.cs:100`) sweeps this assembly for domain-event handlers, DTO/request mappers, command/query handlers, and validators, then the method returns `services` for fluent chaining.
- **Why it's built this way**: `TryAdd*` (rather than `Add`) lets a host override any single registration without a duplicate-registration conflict; splitting explicit generics from convention scanning keeps the file short while still registering dozens of hand-written handlers. Registering the cross-module validation services here (in-process) is what lets the same code run either co-located or split behind gRPC without change ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)/008).
- **Where it's used**: called by the Conference module registration (`IModule.Register`) during host startup; the module is discovered and ordered by the `ModuleLoader` (Group 14).
- **Caveats / not-in-source**: the `applicationSettings` parameter is currently unused beyond the discard; the comment flags it as reserved for profiler decorators, which are not wired here today.

### SessionizeSyncResult

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/ISessionizeSyncStrategy.cs:21` · Level 0 · record

- **What it is**: the small immutable value returned by every Sessionize sync strategy: a pair of counters reporting how many entities that strategy touched. It is co-located in the same file as [`ISessionizeSyncStrategy`](#isessionizesyncstrategy) because it is that interface's return type.
- **Depends on**: nothing first-party; it is a plain `sealed record` with two `int` `init` properties.
- **Walkthrough**: two members: `PrimarySynced` (`ISessionizeSyncStrategy.cs:24`), the count of the strategy's main entity (categories, rooms, questions, speakers, or sessions), and `SecondarySynced` (`ISessionizeSyncStrategy.cs:27`), an optional count of a nested child entity synced in the same pass (today only [`CategorySyncStrategy`](#categorysyncstrategy) uses it, to report category items synced alongside categories). Both default to `0`, so a strategy that has no secondary entity simply leaves it unset.
- **Why it's built this way**: returning a record rather than a bare `int` leaves room to grow the result (more counters, per-entity warnings) without breaking the five implementors. The two-field shape is deliberately generic so one type serves all five strategies.
- **Where it's used**: produced by each `SyncAsync` implementation and accumulated into a `List<SessionizeSyncResult>` by [`RefreshFromSessionizeHandler`](#refreshfromsessionizehandler), which reads the counters positionally to build its result DTO.

---

### RefreshFromSessionizeCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeCommand.cs:18` · Level 6 · record

- **What it is**: the CQRS command that requests a full refresh of one event's data (categories, rooms, questions, speakers, sessions) from the external Sessionize API. It carries a single field: the `EventId` to refresh (`RefreshFromSessionizeCommand.cs:18`).
- **Depends on**: [`Event`](group-17-conference-domain.md#event) (only for the `typeof(Event).FullName` cache-prefix expression), [`ConferenceFeatures`](group-17-conference-domain.md#conferencefeatures) (the feature-flag constant), and three marker interfaces from `MMCA.Common.Application`: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), [`ITransactional`](group-05-cqrs-pipeline.md#itransactional), and [`IFeatureGated`](group-05-cqrs-pipeline.md#ifeaturegated).
- **Concept introduced: marker interfaces that opt a command into pipeline behavior.** The command itself has no logic; it is a request record whose *interfaces* tell the decorator pipeline how to treat it (the pipeline is taught in [Group 05](group-05-cqrs-pipeline.md)). Implementing three markers stacks three cross-cutting behaviors declaratively:
  - [`IFeatureGated`](group-05-cqrs-pipeline.md#ifeaturegated) exposes `FeatureName => ConferenceFeatures.SessionizeIntegration` (`RefreshFromSessionizeCommand.cs:24`); the FeatureGate decorator short-circuits the command to a no-op when that flag is off, a runtime circuit breaker for the whole Sessionize integration. [Rubric §10, Cross-Cutting Concerns] assesses whether concerns like feature flags are handled centrally rather than scattered; here the flag check is inherited from the pipeline, not coded in the handler.
  - [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) exposes `CachePrefix => $"{typeof(Event).FullName}:"` (`RefreshFromSessionizeCommand.cs:21`); on success the Caching decorator evicts every cache entry under the `Event` prefix, so freshly imported data is not masked by a stale read cache.
  - [`ITransactional`](group-05-cqrs-pipeline.md#itransactional) makes the Transactional decorator wrap the handler in one database transaction, so the five per-entity syncs commit atomically or roll back together. [Rubric §6, CQRS & Event-Driven] assesses whether mutations flow through well-defined command boundaries; this command is the boundary and its markers are how it configures the pipeline around itself.
- **Walkthrough**: a one-parameter positional record (`RefreshFromSessionizeCommand.cs:18`) plus two expression-bodied `get` properties satisfying the marker contracts (`CachePrefix` at line 21, `FeatureName` at line 24). No constructor body, no validation: an event id is the only input the use case needs.
- **Why it's built this way**: keeping the behavior in interfaces, not in the command body, is what lets one small record participate in feature-gating, cache invalidation, and transactions without repeating that plumbing per use case ([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) for the decorator ordering).
- **Where it's used**: handled by [`RefreshFromSessionizeHandler`](#refreshfromsessionizehandler); dispatched by the Conference REST controller that exposes the refresh endpoint.

---

### SessionizeSyncContext

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/SessionizeSyncContext.cs:11` · Level 8 · record

- **What it is**: the mutable "parameter object" passed to every sync strategy for one import run. It bundles the four things a strategy needs (the parsed API payload, the target event, the unit of work, and a shared warnings list) plus one running counter the strategies write back into.
- **Depends on**: [`SessionizeResponse`](#sessionizeresponse) (the parsed API payload, same group), [`Event`](group-17-conference-domain.md#event) (the aggregate being refreshed), and [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (repository access for strategies that load their own entities).
- **Concept introduced: a shared context object for a multi-step pipeline.** Rather than pass four or five arguments into every strategy method, the orchestrator builds one context and threads it through. Two of its members are deliberately *mutable* so the strategies can report side information back to the orchestrator without changing the `SyncAsync` return contract:
  - `Warnings` (`SessionizeSyncContext.cs:16`) is a `required List<string>` any strategy can append non-fatal problems to (a session outside the event date range, a question in the reserved id range); the handler folds these into the result DTO.
  - `SkippedSoftDeleted` (`SessionizeSyncContext.cs:19`) is a plain `int { get; set; }` that every strategy increments when it encounters a soft-deleted local row matching an incoming Sessionize id, implementing BR-136 (soft-deleted entities are never resurrected by an import).
- **Walkthrough**: four `required init` members set once at construction: `Response` (`:13`), `Event` (`:14`), `UnitOfWork` (`:15`), `Warnings` (`:16`); then the single mutable counter `SkippedSoftDeleted` (`:19`). The `required` keyword forces the handler to supply all four when it news up the context, so a strategy can never see a half-built context.
- **Why it's built this way**: a single context keeps the strategy signature stable ([`ISessionizeSyncStrategy.SyncAsync`](#isessionizesyncstrategy) takes exactly `(context, cancellationToken)`), and the two mutable fields give strategies a back-channel for warnings and skip counts without a more complex return type.
- **Where it's used**: created once per command in [`RefreshFromSessionizeHandler`](#refreshfromsessionizehandler) and passed to each of the five strategies in turn.

---

### ISessionizeSyncStrategy

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/ISessionizeSyncStrategy.cs:7` · Level 9 · interface

- **What it is**: the Strategy interface for synchronizing one entity family from a parsed Sessionize response into the domain. Each implementation owns exactly one entity type (categories, rooms, questions, speakers, or sessions).
- **Depends on**: [`SessionizeSyncContext`](#sessionizesynccontext) (the input for one run) and [`SessionizeSyncResult`](#sessionizesyncresult) (the return, co-located in the same file at line 21).
- **Concept introduced: the Strategy pattern for pluggable, ordered sync steps.** [Rubric §2, Design Patterns] assesses whether a pattern solves a real structural problem. Sessionize returns one payload covering five interdependent entity types; splitting the sync into one strategy per type keeps each `SyncAsync` small and single-purpose, and lets a new entity type be added as a new strategy without touching the ones that exist ([Rubric §1, SOLID], open for extension). [Rubric §16, Maintainability] applies too: a change to how rooms sync cannot break speaker sync because the code paths are physically separate.
- **Walkthrough**: one method: `Task<SessionizeSyncResult> SyncAsync(SessionizeSyncContext context, CancellationToken cancellationToken)` (`ISessionizeSyncStrategy.cs:15`). The strategy reads what it needs from the context, upserts its entity family, and returns a [`SessionizeSyncResult`](#sessionizesyncresult) with the counts it produced.
- **Why it's built this way**: a record result (not a bare `int`) leaves room to add metadata without breaking implementors, and a single context parameter keeps every strategy's signature identical so the orchestrator can loop over them uniformly.
- **Where it's used**: implemented by the five Level-10 strategy classes below; the implementations are held in a static array inside [`RefreshFromSessionizeHandler`](#refreshfromsessionizehandler) and executed in dependency order.
- **Caveats / not-in-source**: the strategies are **not** injected via DI. The handler instantiates them directly in a `static readonly ISessionizeSyncStrategy[]` field (`RefreshFromSessionizeHandler.cs:25`), which is possible because they are stateless (all per-run state lives in [`SessionizeSyncContext`](#sessionizesynccontext)).

---

### CategorySyncStrategy

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/CategorySyncStrategy.cs:11` · Level 10 · class (internal sealed)

- **What it is**: the sync strategy for categories and their nested category items. This is the fullest of the five strategies, so it also serves as the reference for the shared four-phase shape the others reuse.
- **Depends on**: [`ISessionizeSyncStrategy`](#isessionizesyncstrategy) (the interface it implements), [`SessionizeSyncContext`](#sessionizesynccontext), [`SessionizeSyncResult`](#sessionizesyncresult), [`Category`](group-17-conference-domain.md#category) (the aggregate it upserts through), and [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (reached via the context).
- **Concept introduced: the shared four-phase upsert every strategy follows:**
  1. **Bulk pre-load.** Rather than N `GetByIdAsync` calls, the strategy opens its repository via `context.UnitOfWork.GetRepository<Category, ...>()` (`CategorySyncStrategy.cs:15`) and calls `GetByIdsAsync` once with the full set of Sessionize ids (`:21`). It passes `includes: [nameof(Category.CategoryItems)]` to eager-load children, `asTracking: true` so updates are tracked, and `ignoreQueryFilters: true` so soft-deleted rows are visible for the BR-136 skip check. Results become a dictionary keyed by id (`:27`). This is a deliberate [Rubric §12, Performance & Scalability] choice: a full re-import of hundreds of entities would suffer badly from N+1 queries.
  2. **Iterate and discriminate.** For each incoming entity (`:31`): if it matches a local row that `IsDeleted`, increment `context.SkippedSoftDeleted` and `continue` (`:35`, BR-136); if it matches an active row, call the aggregate's `Update(...)` (`:41`); if there is no match, call the aggregate's `Create(...)` factory (`:97`), which returns [`Result<T>`](group-01-result-error-handling.md#result), and skip on failure.
  3. **Sync children.** `SyncCategoryItems` (`:61`) walks each incoming category's items, applying the same match/skip/update/add logic via `existing.UpdateCategoryItem` / `existing.AddCategoryItem` (`:78`, `:82`), and returns the count.
  4. **Batch-add new entities.** New aggregates are collected in a local `List<Category>` and flushed with `categoryRepo.AddRangeAsync(newCategories, ...)` in one call (`:55`), then a [`SessionizeSyncResult`](#sessionizesyncresult) carrying both counters is returned (`:58`).

  [Rubric §4, Domain-Driven Design] applies throughout: every mutation goes through a `Category` factory or aggregate method, so the domain enforces its own invariants and the strategy never sets fields directly.
- **Walkthrough**: `SyncAsync` (`:13`) runs the four phases above; the private helpers `SyncCategoryItems` (`:61`) and `CreateNewCategory` (`:91`) keep each phase small. `CategorySyncStrategy` is the only strategy that reports a secondary count: `SecondarySynced` carries the category-items total (`:58`).
- **Where it's used**: first entry in the handler's `SyncStrategies` array (`RefreshFromSessionizeHandler.cs:27`); it runs first because speakers and sessions reference category items.

---

### QuestionSyncStrategy

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/QuestionSyncStrategy.cs:11` · Level 10 · class (internal sealed)

- **What it is**: the sync strategy for questions. It follows the same four-phase shape as [`CategorySyncStrategy`](#categorysyncstrategy) (bulk pre-load at `QuestionSyncStrategy.cs:44`, discriminate at `:53`, batch-add at `:100`) but adds three question-specific concerns.
- **Depends on**: [`ISessionizeSyncStrategy`](#isessionizesyncstrategy), [`SessionizeSyncContext`](#sessionizesynccontext), [`SessionizeSyncResult`](#sessionizesyncresult), [`Question`](group-17-conference-domain.md#question) (upserted via `Create`/`Update`), and [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants) (the reserved-id constants).
- **Concept introduced: cross-source invariants enforced at the application layer.** Two of this strategy's rules cannot live inside the `Question` entity because they compare *external* Sessionize data against *internal* rules:
  - **Reserved-id guard** (`:29`): incoming ids inside `[QuestionInvariants.ManualIdRangeStart, QuestionInvariants.ManualIdRangeEnd]` are reserved for manually created questions; a Sessionize question landing there would shadow a user-created one, so it is dropped with a warning (`:34`) rather than a hard error, and the import continues. [Rubric §11, Security] and [Rubric §16, Maintainability] both touch this: a bad external row cannot corrupt user-owned data, and the rule lives in one place.
  - **Entity-type detection** (`:19`): the strategy pre-computes which question ids are answered by speakers versus sessions, then tags each question `"Session"` or `"Speaker"` (defaulting to `"Session"` when a question has no answers yet, `:66`).
  - **Type mapping** (`MapSessionizeQuestionType`, `:109`): Sessionize's open type strings (`Short_Text`, `Long_Text`, `Url`, `YesNo`, and so on) collapse to the three domain-valid values `"Rating"`, `"Email"`, and a catch-all `"Text"`. This helper is `internal static` so it is unit-testable without constructing the strategy.
- **Walkthrough**: `SyncAsync` (`:13`) filters the reserved range first (`:29`), then bulk-loads the surviving ids (`:44`) and upserts through `Question.Update` (`:79`) or `Question.Create` (`:83`, tagged `questionSource: "Sessionize"`). A create failure adds a warning and skips (`:90`) rather than aborting.
- **Where it's used**: third entry in the handler's `SyncStrategies` array (`RefreshFromSessionizeHandler.cs:29`).

---

### RoomSyncStrategy

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RoomSyncStrategy.cs:8` · Level 10 · class (internal sealed)

- **What it is**: the simplest strategy: it syncs rooms, which are children of the [`Event`](group-17-conference-domain.md#event) aggregate rather than a top-level entity.
- **Depends on**: [`ISessionizeSyncStrategy`](#isessionizesyncstrategy), [`SessionizeSyncContext`](#sessionizesynccontext), [`SessionizeSyncResult`](#sessionizesyncresult); it reaches rooms only through `context.Event`.
- **Walkthrough**: because rooms are already loaded on `context.Event.Rooms` (the handler pre-fetched the event with its `Rooms` navigation), this strategy skips the bulk-load phase entirely and has no async I/O: it returns `Task.FromResult(...)` (`RoomSyncStrategy.cs:35`). It iterates `context.Event.Rooms` (`:16`), applying the same match/skip/update/add logic through the `Event` aggregate methods `context.Event.UpdateRoom` (`:25`) and `context.Event.AddRoom` (`:29`), with the BR-136 soft-delete skip at `:19`.
- **Why it's built this way**: delegating to `Event.UpdateRoom` / `Event.AddRoom` keeps room invariants inside the aggregate ([Rubric §4, Domain-Driven Design]); the synchronous `Task.FromResult` avoids an unnecessary state machine for a method with no awaits.
- **Where it's used**: second entry in the handler's `SyncStrategies` array (`RefreshFromSessionizeHandler.cs:28`); runs after categories and before sessions, which reference rooms.

---

### SessionSyncStrategy

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/SessionSyncStrategy.cs:12` · Level 10 · class (internal sealed)

- **What it is**: the richest child-syncing strategy: it upserts sessions and, for each, reconciles three child collections (session speakers, session category items, session question answers).
- **Depends on**: [`ISessionizeSyncStrategy`](#isessionizesyncstrategy), [`SessionizeSyncContext`](#sessionizesynccontext), [`SessionizeSyncResult`](#sessionizesyncresult), and [`Session`](group-17-conference-domain.md#session) (upserted via `Create`/`Update` and its `Add*` child methods).
- **Concept introduced: validate-then-upsert with non-fatal warnings.** Before touching a session, `ValidateSessionTimes` (`SessionSyncStrategy.cs:51`) records warnings (never errors) for times outside the event date range (BR-86, `:54` and `:59`) and for zero or negative duration (BR-122, `:65`); the data is still stored as-is. The strategy bulk-loads existing sessions with all three child navigations included (`:21`), then `ResolveOrCreateSession` (`:71`) applies the standard match/skip (BR-136 at `:79`) / `Update` (`:85`) / `Create` (`:95`) logic.
- **Walkthrough**: after resolving each session, `SyncSessionChildren` (`:111`) reconciles the three child sets in one pass: it adds any speaker not already linked (`AddSessionSpeaker`, `:117`), any category item not already present (`AddSessionCategoryItem`, `:124`), and delegates answers to `SyncSessionQuestionAnswers` (`:131`), which updates an existing non-deleted answer or adds a new one. Every child comparison uses an identity match plus an `!IsDeleted` guard so soft-deleted children are not re-added. New sessions are batch-added via `AddRangeAsync` (`:45`).
- **Why it's built this way**: treating out-of-range times as warnings rather than rejections keeps the import resilient to imperfect Sessionize data ([Rubric §17, DevOps & Deployment], graceful degradation), while all mutation still flows through `Session` aggregate methods.
- **Where it's used**: final entry in the handler's `SyncStrategies` array (`RefreshFromSessionizeHandler.cs:31`); it runs last because sessions reference rooms, speakers, categories, and questions synced by the earlier strategies.

---

### SpeakerSyncStrategy

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/SpeakerSyncStrategy.cs:12` · Level 10 · class (internal sealed)

- **What it is**: the sync strategy for speakers. It follows the standard four-phase shape ([`CategorySyncStrategy`](#categorysyncstrategy)) and adds social-link extraction plus event-to-speaker linking.
- **Depends on**: [`ISessionizeSyncStrategy`](#isessionizesyncstrategy), [`SessionizeSyncContext`](#sessionizesynccontext), [`SessionizeSyncResult`](#sessionizesyncresult), [`Speaker`](group-17-conference-domain.md#speaker) (upserted via `Create`/`Update` and its `Add*` child methods), and [`Event`](group-17-conference-domain.md#event) (for the `EventSpeaker` link).
- **Concept introduced: parsing untyped external links into typed fields.** `ExtractSocialLinks` (`SpeakerSyncStrategy.cs:124`) iterates the speaker's Sessionize `Links` and maps each by `LinkType`: `"Twitter"` routes through `ExtractTwitterHandle`, `"LinkedIn"` and `"Blog"`/`"Company_Website"` fill their url fields, and a url containing `"github"` is treated as the GitHub link (`:151`). `ExtractTwitterHandle` (`:158`) strips the common `twitter.com` / `x.com` url prefixes to yield a bare handle and is `internal static` so it is directly unit-testable.
- **Walkthrough**: for each speaker, `CreateOrUpdateSpeaker` (`:59`) applies match/skip (BR-136 at `:71`) / `Update` (`:77`) / `Create` (`:84`) logic; because `Speaker.Create` does not accept social links, a freshly created speaker is immediately re-`Update`d to set them (`:90`). After upsert, the strategy creates an `EventSpeaker` link if one does not already exist (`context.Event.AddEventSpeaker`, `:44`), then syncs the speaker's category items (`:98`) and question answers (`:107`) with the usual identity-plus-`!IsDeleted` guards. New speakers are batch-added via `AddRangeAsync` (`:53`).
- **Where it's used**: fourth entry in the handler's `SyncStrategies` array (`RefreshFromSessionizeHandler.cs:30`); runs after categories and questions (which speakers reference) and before sessions (which reference speakers).

---

### RefreshFromSessionizeHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeHandler.cs:16` · Level 11 · class (sealed partial, command handler)

- **What it is**: the command handler for [`RefreshFromSessionizeCommand`](#refreshfromsessionizecommand): it loads the event, validates preconditions, calls the Sessionize API, runs the five per-entity strategies in dependency order, and returns a result DTO of per-entity sync counts. It is the orchestration seat of the whole import.
- **Depends on**: first-party: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), [`ISessionizeService`](#isessionizeservice) (the HTTP client abstraction), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error), [`SessionizeResponse`](#sessionizeresponse), [`SessionizeSyncContext`](#sessionizesynccontext), [`SessionizeSyncResult`](#sessionizesyncresult), [`ISessionizeSyncStrategy`](#isessionizesyncstrategy) and its five implementations ([`CategorySyncStrategy`](#categorysyncstrategy), [`RoomSyncStrategy`](#roomsyncstrategy), [`QuestionSyncStrategy`](#questionsyncstrategy), [`SpeakerSyncStrategy`](#speakersyncstrategy), [`SessionSyncStrategy`](#sessionsyncstrategy)), [`Event`](group-17-conference-domain.md#event), [`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto), and the [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) contract it satisfies. Notable externals: `TimeProvider` (BCL, injected for testable clock reads) and `Microsoft.Extensions.Logging` (`ILogger<T>` plus the `[LoggerMessage]` source generator).
- **Concept introduced: the orchestrator that owns sequencing but not sync logic.** [Rubric §2, Design Patterns] and [Rubric §6, CQRS & Event-Driven] both apply. The handler holds a `static readonly ISessionizeSyncStrategy[] SyncStrategies` (`RefreshFromSessionizeHandler.cs:25`) with the five strategies in explicit dependency order (categories, rooms, questions, speakers, sessions). Making the array `static` avoids re-allocating it per request; the strategies are safe to share because they are stateless. The handler knows *the order* entities must be synced but nothing about *how* any entity is synced, the clean expression of the Strategy pattern.
- **Walkthrough**: the primary constructor (`:16`) takes five dependencies: `IUnitOfWork`, `ISessionizeService`, `ICurrentUserService`, `TimeProvider`, and `ILogger<RefreshFromSessionizeHandler>`; the `sealed partial` modifier pairs with the `[LoggerMessage]` generator at `:150`. `HandleAsync` (`:35`) runs six phases:
  1. **Event load** (`:40`): fetches the [`Event`](group-17-conference-domain.md#event) with `Rooms` and `EventSpeakers` navigations, `asTracking: true`; returns `Error.NotFound` when absent (`:49`).
  2. **BR-6 precondition** (`:54`): a missing `SessionizeCode` returns `Error.Invariant` with code `"Event.Sessionize.NoCode"`.
  3. **BR-63 throttle** (`:64`): if `LastSessionizeRefreshOn` is within five minutes of `timeProvider.GetUtcNow().UtcDateTime` (`:65`), returns `Error.Invariant` code `"Event.Sessionize.Throttled"` without calling the API. [Rubric §17, DevOps & Deployment] assesses runtime protections; this throttle keeps the handler within Sessionize's rate limits.
  4. **External API call** (`:75`): `sessionizeService.GetAllAsync` runs inside a `try/catch (HttpRequestException)` (`:80`); a network failure becomes `Error.Failure` code `"Event.Sessionize.Unavailable"`, so the Result pattern absorbs the exception into a structured error.
  5. **Empty-response short-circuit** (`:90`): a `null` response is valid (no data yet); the refresh timestamp is stamped, changes saved, and a zero-count DTO returned without running any strategy.
  6. **Strategy execution** (`:108`): a fresh [`SessionizeSyncContext`](#sessionizesynccontext) is built, then each strategy is `await`ed in sequence (`:117`, not in parallel, because later entities reference earlier ones) with results accumulated in a `List<SessionizeSyncResult>`. A non-zero `SkippedSoftDeleted` is folded into `Warnings` (`:122`), the refresh timestamp is stamped (`:128`), `unitOfWork.RequestIdentityInsert()` is called (`:132`), and `SaveChangesAsync` commits the whole batch (`:133`). The DTO is assembled by reading each result's counters positionally (`:139`).
- **Why it's built this way**: keeping only load/check/call/fan-out/commit here (no per-entity merge logic) keeps the method readable despite spanning five entity types, and returning [`Result`](group-01-result-error-handling.md#result) on every failure path lets the decorator pipeline and controller handle errors uniformly via `Match` rather than exceptions. `RequestIdentityInsert()` (`:132`) is a deliberate infrastructure signal: Sessionize preserves its own integer ids, but SQL Server `IDENTITY` columns reject explicit values, so the unit of work must wrap the save in `SET IDENTITY_INSERT ON/OFF` per table. The `[LoggerMessage]` source generator (`:150`) emits an allocation-free structured log for the success path.
- **Where it's used**: discovered by Scrutor and wrapped by the decorator pipeline (FeatureGate, Logging, Caching, Transactional given the command's markers, see [Group 05](group-05-cqrs-pipeline.md)); invoked by the Conference REST controller's refresh-from-Sessionize endpoint.
- **Caveats / not-in-source**: the result-DTO assembly reads `results[0]` through `results[4]` positionally (`:139`), so it silently depends on `SyncStrategies` staying in the declared order; reordering the array without updating the indices would swap the reported counts. An enum-keyed result map would be safer but adds complexity the current five-strategy size does not justify.

### EventDateRangeRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:55` · Level 0 · class (sealed, generic)

- **What it is** - a reusable FluentValidation rule fragment that enforces event date-range integrity: a start date is required, an end date is required, and the end date must fall on or after the start date.
- **Depends on** - `FluentValidation.AbstractValidator<T>` (NuGet); `System.Linq.Expressions.Expression<>` (BCL). No first-party dependencies.
- **Concept introduced - the reusable field-rule fragment.** This is the first place in this chapter's per-type sections where the Conference module's validation-composition pattern appears, so it is worth teaching from first principles. Each `*Rules<T>` class is a tiny `AbstractValidator<T>` (or a `RequiredStringRules<T>` subclass) that validates exactly one concern (one field, or one cross-field relationship). The generic parameter `T` is the owning command or request type, and the constructor takes a property-selector `Expression<Func<T, TProp>>`. Because the rule is parameterized on `T` and the selector, the same fragment can be composed into a create-command validator *and* an update-command validator via FluentValidation's `Include(...)`, with zero copy-paste. `[Rubric §1 - SOLID]` assesses single-responsibility and open/closed adherence: each fragment owns one rule and new constraints are added by composing another fragment, never by editing an existing one. `[Rubric §24 - Forms/Validation/UX Safety]` assesses whether validation is centralized and message-consistent: the fragment carries the user-facing message and a stable `WithErrorCode` string that the client can key off.
- **Walkthrough** - the constructor (`EventValidationRules.cs:58`) takes two selectors, `startDateSelector` and `endDateSelector`. It registers a `NotEmpty` rule on each (`:62`, `:65`) with distinct error codes (`Event.StartDate.Required`, `Event.EndDate.Required`). The cross-field check is the notable mechanism: it compiles the start-date selector into a delegate once (`var startDateFunc = startDateSelector.Compile();`, `:68`), then adds a `Must((instance, endDate) => endDate >= startDateFunc(instance))` rule on the end date (`:69-71`). The two-argument `Must` overload hands the validator both the whole instance and the end-date value, so the compiled start getter reads the sibling property off the *same* object under validation.
- **Why it's built this way** - compiling the selector once at construction (rather than invoking the expression tree per validation) keeps the cross-property comparison allocation-light on the hot validation path. Splitting each concern into its own fragment means an `UpdateEventCommand` validator can pull in exactly the rules it needs without inheriting a monolithic validator.
- **Where it's used** - composed via `Include(...)` into the event create and update command validators in the Conference Application layer.

### GetCategoryDistributionQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetCategoryDistribution/GetCategoryDistributionQuery.cs:5` · Level 0 · record (sealed)

- **What it is** - the CQRS query contract that asks for the distribution of an event's sessions across its category items. A single-line record carrying just the event to analyze.
- **Depends on** - `EventIdentifierType` (the Conference module identifier alias). No other first-party types.
- **Concept introduced** - this is a plain read-side CQRS request; the query/handler split is taught by [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult), so it is cross-referenced rather than re-taught here. `[Rubric §6 - CQRS & Event-Driven]` assesses whether reads and writes travel separate paths with explicit contracts: this record is a read intent with no side effects, handled by [GetCategoryDistributionHandler](#getcategorydistributionhandler).
- **Walkthrough** - one positional parameter, `EventId` of type `EventIdentifierType` (`:5`). No body.
- **Why it's built this way** - keeping the query as a standalone record means it can be dispatched on its own (an organizer opening the category-distribution view) or composed into the larger session-selection dashboard without over-fetching the other analytics dimensions.
- **Where it's used** - dispatched by the Conference decision-support REST endpoints and resolved by [GetCategoryDistributionHandler](#getcategorydistributionhandler).

### GetContentSimilarityQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/GetContentSimilarityQuery.cs:6` · Level 0 · record (sealed)

- **What it is** - the query contract that asks for pairs of similar-content sessions within an event, so organizers can spot proposals that overlap and might compete for the same audience.
- **Depends on** - `EventIdentifierType` (module identifier alias). No other first-party types.
- **Concept introduced** - same read-side CQRS shape as [GetCategoryDistributionQuery](#getcategorydistributionquery); cross-reference [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for the pattern. `[Rubric §6 - CQRS & Event-Driven]` - a read intent with a tunable parameter, handled by [GetContentSimilarityHandler](#getcontentsimilarityhandler).
- **Walkthrough** - two positional parameters (`:6`): `EventId` (`EventIdentifierType`) and `MinimumSimilarity` (`double`) which defaults to `0.3`. The default is the only parameter default in the group; it is the floor score a session pair must clear to appear in the result.
- **Why it's built this way** - exposing the threshold as a defaulted parameter lets callers loosen or tighten the similarity floor per request while the common case (organizer opens the view) works with no argument. Caveat: the `0.3` default lives in this contract, while the scoring weights that produce the score live in [SessionSimilarityCalculator](#sessionsimilaritycalculator); the two must be read together to reason about what actually surfaces.
- **Where it's used** - dispatched by the Conference decision-support endpoints and resolved by [GetContentSimilarityHandler](#getcontentsimilarityhandler).

### RoomCapacityRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:37` · Level 0 · class (sealed, generic)

- **What it is** - a reusable rule fragment enforcing that a room's capacity, when supplied, is strictly positive. Capacity is optional (`int?`), so the rule only fires when a value is present.
- **Depends on** - `FluentValidation.AbstractValidator<T>`; `System.Linq.Expressions.Expression<>`. No first-party types.
- **Concept introduced** - same reusable field-rule pattern taught in [EventDateRangeRules<T>](#eventdaterangerulest). The notable wrinkle is the conditional: `.When(x => selector.Compile()(x) is not null)` (`:43`) guards the `GreaterThan(0)` rule (`:42`) so a null capacity is silently accepted rather than reported as invalid. `[Rubric §24 - Forms/Validation/UX Safety]` - an optional numeric field should not raise a validation error simply for being absent.
- **Walkthrough** - the constructor takes an `Expression<Func<T, int?>>` selector (`:40`), chains `GreaterThan(0)` with error code `Room.Capacity.NotPositive`, and applies the null-guard `When` clause.
- **Why it's built this way** - separating the presence check (`When`) from the value check keeps the "optional but bounded" semantics in one place; a room without a known capacity is valid, a room claiming a non-positive capacity is not.
- **Where it's used** - composed into the room create and update command validators.

### RoomSortRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:25` · Level 0 · class (sealed, generic)

- **What it is** - a reusable rule fragment enforcing that a room's sort-order value is non-negative.
- **Depends on** - `FluentValidation.AbstractValidator<T>`; `System.Linq.Expressions.Expression<>`. No first-party types.
- **Concept introduced** - same pattern as [EventDateRangeRules<T>](#eventdaterangerulest). The simplest variant in the family: one `GreaterThanOrEqualTo(0)` rule.
- **Walkthrough** - the constructor takes an `Expression<Func<T, int>>` selector (`:28`) and registers `GreaterThanOrEqualTo(0)` with error code `Room.Sort.Negative` (`:29-30`). No conditionals, no cross-field logic.
- **Why it's built this way** - sort order drives deterministic UI ordering of rooms; a negative value has no meaning, so the fragment rejects it at the boundary before it reaches the domain.
- **Where it's used** - composed into the room create and update command validators alongside [RoomCapacityRules<T>](#roomcapacityrulest).

### SessionSimilarityCalculator
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/SessionSimilarityCalculator.cs:9` · Level 0 · class (static, internal)

- **What it is** - a pure static calculator that scores how similar two sessions are, combining category-item overlap (weighted 0.6) with keyword overlap drawn from titles and descriptions (weighted 0.4). It is the engine behind the content-similarity analysis.
- **Depends on** - `System.Collections.Frozen.FrozenSet<string>` (BCL); `CategoryItemIdentifierType` (module identifier alias) as a set element type. No other first-party types.
- **Concept introduced - weighted Jaccard similarity with span-based tokenization.** The Jaccard index is the size of a set intersection over the size of its union, a value in `[0.0, 1.0]`. Here two independent Jaccard scores are blended: category-item overlap and keyword overlap. Two sessions with identical category tags but no shared keywords score `0.6`; identical keywords but no shared tags score `0.4`. `[Rubric §12 - Performance & Scalability]` assesses allocation and lookup discipline on compute paths: the stop-word set is a `FrozenSet<string>` for O(1) membership after a one-time build (`:14-34`), and `TokenizeText` scans a `ReadOnlySpan<char>` without allocating a string per character (`:41-71`).
- **Walkthrough** - members in teaching order:
  - Weight constants `CategoryWeight = 0.6` and `KeywordWeight = 0.4` (`:11-12`).
  - `StopWords` (`:14-34`), a `FrozenSet<string>` of English function words plus conference-generic terms (`"SESSION"`, `"TALK"`, `"WORKSHOP"`, `"DEEP"`, `"DIVE"`) that would otherwise inflate false matches; built with `StringComparer.Ordinal`.
  - `TokenizeText(string? text)` (`:41`), returns an empty set for null/whitespace, then walks the span tracking word-start indices, and via `AddTokenIfNotStopWord` (`:123`) uppercases each run of length `>= 3` (the `>= 3` filter is at `:62`) and drops stop words. Uppercasing uses `ToUpperInvariant` (the CA1308 note in the doc comment at `:37`).
  - `CalculateJaccardIndex<T>(HashSet<T>, HashSet<T>)` (`:80`), returns `0.0` when both sets are empty (`:82-83`), otherwise iterates the smaller set against the larger for the intersection count (`:85-88`) and divides by `setA.Count + setB.Count - intersectionCount`.
  - `CalculateSimilarity(...)` (`:97`), the public composite: `CategoryWeight * Jaccard(categoryItems) + KeywordWeight * Jaccard(keywords)` (`:103-105`).
  - `GetIntersection<T>(...)` (`:115`), returns the shared elements as a `List<T>`, used to populate the shared-tags and shared-keywords fields of each result pair.
- **Why it's built this way** - a single Jaccard on category items alone would flag unrelated sessions that happen to share a broad track; adding the keyword signal raises the bar, and weighting categories higher reflects that curated tags are a stronger signal than free-text overlap. The static, side-effect-free shape makes it trivially unit-testable in isolation.
- **Where it's used** - [GetContentSimilarityHandler](#getcontentsimilarityhandler) calls `TokenizeText`, `CalculateSimilarity`, and `GetIntersection` across every session pair.

### StatusBucket
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetCategoryDistribution/GetCategoryDistributionHandler.cs:94` · Level 0 · enum (private)

- **What it is** - a private enum, nested inside [GetCategoryDistributionHandler](#getcategorydistributionhandler), that maps a session's raw status string onto one of three counting buckets used to tally the category distribution.
- **Depends on** - used together with `SessionStatuses` string constants ([SessionStatuses](group-17-conference-domain.md#sessionstatuses)) via the handler's `ClassifyStatus` switch.
- **Concept introduced** - an internal aggregation vocabulary. The enum is an implementation detail of one handler and is never exposed to callers, who receive DTO counts. `[Rubric §16 - Maintainability]` assesses local reasoning: keeping the bucket type private to its handler means the bucketing can evolve without coupling other decision-support handlers.
- **Walkthrough** - three members: `Accepted`, `AcceptQueue`, `Pending` (`:94-99`). Note there is no `Declined` member: declined sessions are excluded upstream by `IsDeclined` (`:114`) before bucketing, so the enum only spans the statuses that count toward a category's totals.
- **Why it's built this way** - declined proposals do not contribute to the distribution an organizer is weighing, so filtering them out before the enum stage keeps the three live buckets clean. Keeping the enum private to the handler avoids a false shared dependency with the sibling dashboard handler that keeps its own copy.
- **Where it's used** - inside [GetCategoryDistributionHandler](#getcategorydistributionhandler) only (`CountSessionsPerCategoryItem` and `ClassifyStatus`).

### EventNameRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:13` · Level 5 · class (sealed, generic)

- **What it is** - a reusable rule fragment for the event name: non-empty and bounded by `EventInvariants.NameMaxLength` (500 characters).
- **Depends on** - [RequiredStringRules<T>](group-06-validation.md#requiredstringrulest) (its base class), [EventInvariants](group-17-conference-domain.md#eventinvariants).
- **Concept introduced** - same reusable field-rule pattern as [EventDateRangeRules<T>](#eventdaterangerulest), but this fragment inherits `RequiredStringRules<T>` rather than `AbstractValidator<T>` directly, delegating the `NotEmpty` + `MaximumLength` wiring to the shared base. `[Rubric §4 - DDD]` assesses ubiquitous language in code: the class is named `EventNameRules`, naming the domain field rather than a generic "NameValidator".
- **Walkthrough** - one constructor, one base call: `base(selector, "Event Name", EventInvariants.NameMaxLength)` (`:16-17`). No body logic; all behavior lives in the parent.
- **Why it's built this way** - the length constant `EventInvariants.NameMaxLength` (`EventInvariants.cs:13`) is the same value the EF configuration uses for the column's `HasMaxLength`, so the database constraint and the validation message share one source of truth and cannot drift.
- **Where it's used** - composed into the event create and update command validators.

### EventTimeZoneRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:25` · Level 5 · class (sealed, generic)

- **What it is** - a rule fragment for an event's time zone: non-empty, bounded by `EventInvariants.TimeZoneMaxLength` (100 characters), and a semantic check that the value is a recognizable IANA time-zone identifier (BR-87).
- **Depends on** - [EventInvariants](group-17-conference-domain.md#eventinvariants); `System.TimeZoneInfo` (BCL). Inherits `AbstractValidator<T>` directly.
- **Concept introduced** - same fragment shape as [EventNameRules<T>](#eventnamerulest), but it needs a custom predicate beyond string length, so it extends `AbstractValidator<T>` and adds a `Must(BeAValidIanaTimeZone)` rule (`:32`). `[Rubric §24 - Forms/Validation/UX Safety]` - validating that the string actually resolves to a runtime time zone stops an invalid identifier from reaching scheduling logic.
- **Walkthrough** - the constructor chains `NotEmpty` (`:30`), `MaximumLength` (`:31`), and `Must(BeAValidIanaTimeZone)` (`:32`), each with its own error code. `BeAValidIanaTimeZone` (`:34-48`) returns `true` for whitespace (`:37`) because `NotEmpty` already covers that branch, then calls `TimeZoneInfo.FindSystemTimeZoneById` inside a `try` and returns `false` only on `TimeZoneNotFoundException`.
- **Why it's built this way** - returning `true` for the empty case avoids emitting two error messages for the same missing field. Delegating the identifier check to `TimeZoneInfo` reuses the platform's canonical time-zone database instead of hand-maintaining a list.
- **Caveats / not-in-source** - `FindSystemTimeZoneById` resolves against the host OS time-zone database; whether a given identifier is recognized can differ across operating systems. That runtime dependency is not something the rule itself can guarantee.
- **Where it's used** - composed into the event create and update command validators.

### RoomAccessibilityInfoRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:77` · Level 5 · class (sealed, generic)

- **What it is** - a rule fragment bounding a room's optional accessibility-info text to `EventInvariants.RoomAccessibilityInfoMaxLength` (500 characters).
- **Depends on** - [EventInvariants](group-17-conference-domain.md#eventinvariants). Inherits `AbstractValidator<T>`.
- **Concept introduced** - same fragment pattern as [EventNameRules<T>](#eventnamerulest). The field is nullable (`string?`), so the fragment applies `MaximumLength` only (`:82`), with no `NotEmpty`; a null value is silently accepted.
- **Walkthrough** - one constructor, one `MaximumLength(EventInvariants.RoomAccessibilityInfoMaxLength)` rule with error code `Room.AccessibilityInfo.MaxLength` (`:80-82`).
- **Why it's built this way** - the length constant is shared with the EF column configuration, keeping the DB constraint and the UI message aligned.
- **Where it's used** - composed into the room create and update command validators.

### RoomFloorRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:51` · Level 5 · class (sealed, generic)

- **What it is** - a rule fragment bounding a room's optional floor label to `EventInvariants.RoomFloorMaxLength` (100 characters).
- **Depends on** - [EventInvariants](group-17-conference-domain.md#eventinvariants). Inherits `AbstractValidator<T>`.
- **Concept introduced** - identical shape to [RoomAccessibilityInfoRules<T>](#roomaccessibilityinforulest): nullable `string?` field, `MaximumLength` only, no `NotEmpty`.
- **Walkthrough** - one `MaximumLength(EventInvariants.RoomFloorMaxLength)` rule with error code `Room.Floor.MaxLength` (`:55-56`).
- **Where it's used** - composed into the room create and update command validators.

### RoomLocationRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:64` · Level 5 · class (sealed, generic)

- **What it is** - a rule fragment bounding a room's optional location text to `EventInvariants.RoomLocationMaxLength` (255 characters).
- **Depends on** - [EventInvariants](group-17-conference-domain.md#eventinvariants). Inherits `AbstractValidator<T>`.
- **Concept introduced** - identical shape to [RoomFloorRules<T>](#roomfloorrulest): nullable field, `MaximumLength` only.
- **Walkthrough** - one `MaximumLength(EventInvariants.RoomLocationMaxLength)` rule with error code `Room.Location.MaxLength` (`:67-69`).
- **Where it's used** - composed into the room create and update command validators.

### RoomNameRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:12` · Level 5 · class (sealed, generic)

- **What it is** - a rule fragment for a room's name: non-empty and bounded by `EventInvariants.RoomNameMaxLength` (255 characters). Unlike the other room fragments, the name is required.
- **Depends on** - [EventInvariants](group-17-conference-domain.md#eventinvariants). Inherits `AbstractValidator<T>`.
- **Concept introduced** - same fragment pattern as [EventNameRules<T>](#eventnamerulest), but implemented directly on `AbstractValidator<T>` (not `RequiredStringRules<T>`), chaining `NotEmpty` then `MaximumLength`.
- **Walkthrough** - the constructor chains `NotEmpty` (error code `Room.Name.Required`) and `MaximumLength(EventInvariants.RoomNameMaxLength)` (error code `Room.Name.MaxLength`) on the selector (`:16-18`).
- **Why it's built this way** - the required name distinguishes this fragment from the nullable room fields; keeping it a separate fragment lets a validator compose exactly the required-vs-optional mix each command needs.
- **Where it's used** - composed into the room create and update command validators.

### GetCategoryDistributionHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetCategoryDistribution/GetCategoryDistributionHandler.cs:14` · Level 8 · class (sealed)

- **What it is** - the query handler that computes, per category item, how many of an event's sessions were submitted, accepted, in the accept-queue, and pending. It powers the organizer's category-distribution view.
- **Depends on** - [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (implemented), [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (injected), [Session](group-17-conference-domain.md#session) and [Category](group-17-conference-domain.md#category) (repository entities), [SessionStatuses](group-17-conference-domain.md#sessionstatuses), and the output DTOs [CategoryDistributionDTO](group-17-conference-domain.md#categorydistributiondto), [CategoryGroupDistribution](group-17-conference-domain.md#categorygroupdistribution), and [CategoryItemDistribution](group-17-conference-domain.md#categoryitemdistribution). Uses the nested [StatusBucket](#statusbucket) enum.
- **Concept introduced** - an in-memory analytics read handler. It loads two aggregates untracked, then does all bucketing and grouping in memory rather than pushing aggregation into SQL. `[Rubric §6 - CQRS & Event-Driven]` assesses the read path: this is a pure query, returning a `Result<CategoryDistributionDTO>` and mutating nothing. `[Rubric §12 - Performance & Scalability]` assesses read efficiency: both repository loads pass `asTracking: false` (`:27`, `:32`) so EF skips change-tracking overhead for a read-only projection.
- **Walkthrough** - `HandleAsync` (`:17`) resolves a `Session` repository and a `Category` repository from the unit of work (`:21-22`). It loads sessions for the event, including `SessionCategoryItems`, filtered to `EventId == query.EventId && !s.IsServiceSession` (`:24-28`), and loads all categories with their `CategoryItems` (`:30-33`). `CountSessionsPerCategoryItem` (`:41`) flattens each non-declined session into `(CategoryItemId, StatusBucket)` pairs (excluding soft-deleted category-item links via `!sci.IsDeleted`, `:47`), then tallies a running `(Total, Accepted, AcceptQueue, Pending)` tuple per category item (`:50-61`). `ClassifyStatus` (`:101`) treats a null status or `SessionStatuses.Accepted` as `Accepted`, `SessionStatuses.AcceptQueue` as `AcceptQueue`, and everything else as `Pending`, all via `OrdinalIgnoreCase` comparison; `IsDeclined` (`:114`) removes declined sessions up front. `BuildCategoryGroups` (`:66`) keeps only non-deleted categories that have at least one counted item, orders categories and items by their `Sort`, and projects each into `CategoryItemDistribution` rows (`:82-90`). The handler wraps the assembled list in `Result.Success(new CategoryDistributionDTO { ... })` (`:38`).
- **Why it's built this way** - aggregating in memory keeps the logic engine-agnostic (the same handler runs against any `IUnitOfWork`-backed store) and expresses the domain rules (service sessions excluded, declined excluded, soft-deletes excluded) in one readable pass rather than in a SQL statement. The trade-off is that it materializes the event's sessions and categories in full; that is acceptable for a single event's proposal set.
- **Where it's used** - dispatched via [GetCategoryDistributionQuery](#getcategorydistributionquery) from the Conference decision-support endpoints, and composed into the session-selection dashboard.

### GetContentSimilarityHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/GetContentSimilarityHandler.cs:14` · Level 8 · class (sealed)

- **What it is** - the query handler that finds pairs of similar-content sessions in an event, scoring every candidate pair and returning the strongest matches above a threshold.
- **Depends on** - [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult), [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork), [Session](group-17-conference-domain.md#session) and [Category](group-17-conference-domain.md#category), [SessionStatuses](group-17-conference-domain.md#sessionstatuses), [SessionSimilarityCalculator](#sessionsimilaritycalculator), and the DTOs [ContentSimilarityDTO](group-17-conference-domain.md#contentsimilaritydto) and [SimilarSessionPair](group-17-conference-domain.md#similarsessionpair).
- **Concept introduced** - a pairwise (O(n^2)) analytics handler with a hard result cap. `[Rubric §12 - Performance & Scalability]` assesses cost control on a quadratic path: the private `const int MaxPairs = 50` (`:17`) caps the returned list, and both repository loads use `asTracking: false` (`:32`, `:38`). The scoring math itself is delegated to the pure [SessionSimilarityCalculator](#sessionsimilaritycalculator), keeping the handler focused on orchestration.
- **Walkthrough** - `HandleAsync` (`:19`) loads all non-service, non-declined sessions with their category items (`:27-33`) and all categories with items (`:36-39`), then builds a `CategoryItemIdentifierType -> name` lookup (`:41-48`). For each session it pre-computes a `HashSet` of non-deleted category-item ids and a keyword set via `SessionSimilarityCalculator.TokenizeText(s.Title + " " + s.Description)` (`:51-59`). It then double-loops over the session list (`:64-79`), calling `SessionSimilarityCalculator.CalculateSimilarity` per pair and keeping only pairs scoring at or above `query.MinimumSimilarity` (`:74`). Pairs are sorted by score descending (`:82`) and truncated to `MaxPairs` (`:83-86`). Finally each kept pair is projected into a `SimilarSessionPair` (`:89-111`): the score is rounded to three digits with `MidpointRounding.ToEven` (`:105`), shared category items are resolved to names via `GetIntersection` (`:94`, `:106-108`), and shared keywords are taken (up to 10) from the keyword intersection (`:95`, `:109`). The result is wrapped in `Result.Success(new ContentSimilarityDTO { Pairs = result })` (`:113`).
- **Why it's built this way** - pre-computing each session's keyword and category sets once, before the pairwise loop, avoids re-tokenizing inside the O(n^2) comparison. The `MaxPairs` cap and the score threshold together bound both compute and payload size, so a large proposal set cannot produce an unbounded response.
- **Where it's used** - dispatched via [GetContentSimilarityQuery](#getcontentsimilarityquery) from the Conference decision-support endpoints, and composed into the session-selection dashboard.

### ExportEventCalendarQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` · `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportEventCalendarQuery.cs:5` · Level 0 · record

- **What it is**: the read request that asks for a published event's whole schedule rendered as an RFC 5545 (`.ics`) calendar document. A one-field `sealed record` carrying the `EventId` to export (`ExportEventCalendarQuery.cs:5`).
- **Depends on**: the `EventIdentifierType` alias (see [identifier aliases](../00-primer.md#2-architectural-styles-this-codebase-commits-to)). No externals beyond the BCL.
- **Concept introduced: the request record as a CQRS message.** This is the first type in this unit, so the shape is worth stating once: every decision-support and calendar use case in this unit is a positional `sealed record` that names exactly the inputs its handler needs and nothing else. It is dispatched through the [CQRS decorator pipeline](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (Logging then Caching then handler for queries) and matched to its handler by the generic argument. [Rubric §6, CQRS and Event-Driven] assesses whether reads and writes are modeled as explicit messages: here the intent (export one event's calendar) is a named type, not a method-parameter bag.
- **Walkthrough**: a single `EventId` positional parameter (`:5`); the compiler-generated equality and `init` immutability come for free from `record`.
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 5 (cited in the doc comment, `:3`) adds calendar export as a public-read affordance; keeping the query minimal lets the handler own all the publish/exportability rules.
- **Where it's used**: handled by [ExportEventCalendarHandler](#exporteventcalendarhandler); reached from the Conference REST calendar endpoint (Group 19).

### ExportSessionCalendarQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` · `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportSessionCalendarQuery.cs:5` · Level 0 · record

- **What it is**: the single-session variant of the calendar export: it asks for one public session rendered as an `.ics` document, for the "add to calendar" affordance. A one-field `sealed record` carrying the `SessionId` (`ExportSessionCalendarQuery.cs:5`).
- **Depends on**: the `SessionIdentifierType` alias. No externals beyond the BCL.
- **Concept introduced**: none new; this is the sibling of [ExportEventCalendarQuery](#exporteventcalendarquery), differing only in that it identifies a single session rather than a whole event. [Rubric §6, CQRS and Event-Driven].
- **Walkthrough**: a single `SessionId` positional parameter (`:5`).
- **Why it's built this way**: same [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 5 lineage (`:3`); a separate query keeps the one-session public rules distinct from the whole-event export.
- **Where it's used**: handled by [ExportSessionCalendarHandler](#exportsessioncalendarhandler).

### GetSessionSelectionDashboardQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardQuery.cs:5` · Level 0 · record

- **What it is**: the read request for the composite session-selection dashboard: given one `EventId`, produce category distribution, speaker overlap, speaker locality, and AI scores in a single result. A one-field `sealed record` (`GetSessionSelectionDashboardQuery.cs:5`).
- **Depends on**: the `EventIdentifierType` alias. No externals.
- **Concept introduced**: none new; same request-record shape as [ExportEventCalendarQuery](#exporteventcalendarquery). What makes it interesting is the handler, which fans one query out into four analytics computed off a single data load. [Rubric §6, CQRS and Event-Driven].
- **Walkthrough**: a single `EventId` positional parameter (`:5`).
- **Why it's built this way**: a composite query (one round trip, one message) is the decision-support answer to running four separate analytics queries: see [GetSessionSelectionDashboardHandler](#getsessionselectiondashboardhandler).
- **Where it's used**: handled by [GetSessionSelectionDashboardHandler](#getsessionselectiondashboardhandler); returns a [SessionSelectionDashboardDTO](group-17-conference-domain.md#sessionselectiondashboarddto).

### GetSpeakerSessionOverlapQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSpeakerSessionOverlap` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSpeakerSessionOverlap/GetSpeakerSessionOverlapQuery.cs:5` · Level 0 · record

- **What it is**: the read request that asks, for one event, which speakers submitted more than one session (and, in practice, every speaker with their submitted sessions so the UI can surface multi-session speakers first). A one-field `sealed record` carrying the `EventId` (`GetSpeakerSessionOverlapQuery.cs:5`).
- **Depends on**: the `EventIdentifierType` alias. No externals.
- **Concept introduced**: none new; same request-record shape as [ExportEventCalendarQuery](#exporteventcalendarquery). [Rubric §6, CQRS and Event-Driven].
- **Walkthrough**: a single `EventId` positional parameter (`:5`).
- **Why it's built this way**: the speaker-overlap analysis is one focused slice of the dashboard, exposed on its own query so the UI can request just that view.
- **Where it's used**: handled by [GetSpeakerSessionOverlapHandler](#getspeakersessionoverlaphandler); returns a [SpeakerSessionOverlapDTO](group-17-conference-domain.md#speakersessionoverlapdto).

### ScoreEventSessionsCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsCommand.cs:5` · Level 0 · record

- **What it is**: the write request that triggers AI scoring for every session in an event. A one-field `sealed record` carrying the `EventId` whose sessions to score (`ScoreEventSessionsCommand.cs:5`).
- **Depends on**: the `EventIdentifierType` alias. No externals.
- **Concept introduced**: this is the one **command** among the sibling request records in this unit. It is structurally identical to the query records (a single-field `sealed record`), but it dispatches through the command side of the pipeline ([ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)), which adds the Validating and Transactional decorators the query side does not carry. [Rubric §6, CQRS and Event-Driven] is precisely the split modeled here: a read (dashboard/overlap) and a write (score) that happen to share a shape are still separate message types on separate pipelines.
- **Walkthrough**: a single `EventId` positional parameter (`:5`).
- **Why it's built this way**: scoring mutates persistence (it deletes and rewrites [SessionAiScore](group-17-conference-domain.md#sessionaiscore) rows), so it is a command, not a query; keeping it a distinct message makes that read/write asymmetry explicit.
- **Where it's used**: handled by [ScoreEventSessionsHandler](#scoreeventsessionshandler); returns a [ScoreEventSessionsResultDTO](group-17-conference-domain.md#scoreeventsessionsresultdto).

### SessionScoringResult
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:40` · Level 0 · record

- **What it is**: the internal result of scoring one session via [IAiScoringService](#iaiscoringservice). It carries seven numeric sub-scores (each documented `1.0-10.0` decimal), a free-text `Reasoning`, the `SessionId`, and a `Success` flag. It never throws: a failed AI call returns this record with `Success = false` (`IAiScoringService.cs:40-71`).
- **Depends on**: the `SessionIdentifierType` alias (on `SessionId`, `:43`). No first-party types; every property is `required init`.
- **Concept introduced: never-throw service results.** Rather than propagate exceptions from the AI call, `ScoreSessionAsync` returns this record in every case and the handler branches on `Success`. This is the Result philosophy (see [Result](group-01-result-error-handling.md#result)) applied to an unreliable network dependency: the scoring loop cannot be aborted by one bad session. [Rubric §29, Resilience and Business Continuity] assesses how failure of a dependency is contained; here it is demoted to a per-item flag rather than an exception that unwinds the whole batch.
- **Walkthrough**: `required init` members (`:43-70`): `SessionId`, `OverallScore`, `TopicRelevanceScore`, `DescriptionQualityScore`, `NoveltyScore`, `ActionableTakeawaysScore`, `DepthOrInsightQualityScore`, `CredibilityExperienceScore`, `Reasoning`, `Success`. `required` on all of them means a scorer implementation cannot forget to populate one.
- **Why it's built this way**: separating this Application-layer result from the external [SessionAiScoreDTO](group-17-conference-domain.md#sessionaiscoredto) lets the scoring contract evolve (add or drop a sub-score) without immediately breaking the API surface.
- **Where it's used**: returned by `IAiScoringService.ScoreSessionAsync` and consumed by [ScoreEventSessionsHandler](#scoreeventsessionshandler), which maps a successful one into a [SessionAiScore](group-17-conference-domain.md#sessionaiscore) domain row.

### SpeakerInfo
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:23` · Level 0 · record

- **What it is**: the minimal speaker payload the AI scorer needs: `FullName`, optional `TagLine`, optional `Bio`. A positional `sealed record` (`IAiScoringService.cs:23-26`).
- **Depends on**: nothing first-party; three `string`/`string?` fields.
- **Concept introduced: least-privilege data passing.** The record deliberately carries only what the model reads (name, tagline, bio) and no ids, contact fields, or other PII. [Rubric §11, Security] and [Rubric §30, Compliance/Privacy] both assess how much data crosses a boundary to a third party: shipping a purpose-built projection to the AI vendor rather than a whole [Speaker](group-17-conference-domain.md#speaker) limits what leaves the trust boundary.
- **Walkthrough**: three positional parameters (`:23-26`); the doc comments note the source-side max lengths (`TagLine` 500, `Bio` 4000) that the domain enforces upstream.
- **Why it's built this way**: a narrow record keeps the scoring prompt small and avoids leaking speaker identity to the external model.
- **Where it's used**: nested inside [SessionScoringInput](#sessionscoringinput); populated by [ScoreEventSessionsHandler](#scoreeventsessionshandler) from each [Speaker](group-17-conference-domain.md#speaker)'s `FullName`/`TagLine`/`Bio`.

### StatusBucket
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardHandler.cs:308` · Level 0 · enum

- **What it is**: a private three-member enum (`Accepted`, `AcceptQueue`, `Pending`) that classifies a session's status string into the buckets the category-distribution aggregation counts (`GetSessionSelectionDashboardHandler.cs:308-313`).
- **Depends on**: conceptually on [SessionStatuses](group-17-conference-domain.md#sessionstatuses), the string constants the classifier compares against.
- **Concept introduced: a handler-private classification vocabulary.** The enum is declared `private` inside the handler and never leaves it; callers receive aggregated counts on the DTO, never bucket values. Modeling the three-way status collapse as a named enum keeps the counting code readable versus repeating `string.Equals(..., Accepted)` comparisons inline. [Rubric §16, Maintainability].
- **Walkthrough**: `ClassifyStatus(Session)` (`:315-326`) maps a null-or-`Accepted` status to `StatusBucket.Accepted`, `AcceptQueue` to `StatusBucket.AcceptQueue`, and everything else to `StatusBucket.Pending`; the enum is then consumed by `CountCategoryItems` (`:127-150`) to tally each category item.
- **Why it's built this way**: keeping the bucket private to this handler means its bucketing can diverge from any other dashboard's without coupling the two use cases (a sibling copy historically lived in the retired `GetCategoryDistribution` handler).
- **Where it's used**: inside [GetSessionSelectionDashboardHandler](#getsessionselectiondashboardhandler) only.

### SessionScoringInput
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:33` · Level 1 · record

- **What it is**: the full input for scoring one session: `SessionId`, `Title`, optional `Description`, and the list of [SpeakerInfo](#speakerinfo) records for the session's speakers. A positional `sealed record` (`IAiScoringService.cs:33-37`).
- **Depends on**: [SpeakerInfo](#speakerinfo) (Level 0, same file `:23`), via `IReadOnlyList<SpeakerInfo>`; the `SessionIdentifierType` alias. Referencing a Level-0 first-party type is what puts this record at Level 1.
- **Concept introduced**: none new; it is the request DTO for [IAiScoringService](#iaiscoringservice), assembling exactly what the model prompt needs (title, description, speaker bios) and nothing more, extending the least-privilege discipline [SpeakerInfo](#speakerinfo) sets. [Rubric §6, CQRS and Event-Driven].
- **Walkthrough**: four positional parameters (`:33-37`); `Speakers` may be empty (documented at `:32`), so a speaker-less session still scores.
- **Why it's built this way**: a purpose-built input record keeps the port contract stable and testable with a fake scorer.
- **Where it's used**: constructed by [ScoreEventSessionsHandler](#scoreeventsessionshandler) per session and passed to `IAiScoringService.ScoreSessionAsync`.

### IAiScoringService
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:6` · Level 2 · interface

- **What it is**: the application-layer **port** for scoring a single conference session with an AI model. Its contract guarantees it never throws: failure is reported through the returned [SessionScoringResult](#sessionscoringresult)'s `Success` flag (`IAiScoringService.cs:6-17`).
- **Depends on**: [SessionScoringInput](#sessionscoringinput) (Level 1, `:33`) as the argument and [SessionScoringResult](#sessionscoringresult) (Level 0, `:40`) as the return; BCL `Task`/`CancellationToken` otherwise.
- **Concept introduced: a port/adapter boundary for an external AI capability.** The Application layer declares the interface; the Anthropic HTTP and JSON details live in an Infrastructure adapter (`AnthropicScoringService`), so the vendor SDK never reaches Application. [Rubric §3, Clean Architecture] assesses whether outward dependencies are inverted behind an abstraction, which this does exactly, and [Rubric §1, SOLID] (the Dependency Inversion Principle) is the same story: the handler depends on this port, not a concrete API client. The "never throws" clause (documented at `:9`) also ties to [Rubric §29, Resilience and Business Continuity].
- **Walkthrough**: `ScoreSessionAsync(SessionScoringInput, CancellationToken)` (`:11-13`) returns the per-session result; `ModelId` (`:16`) exposes which model produced the score, so persisted rows can record the model used for auditability.
- **Why it's built this way**: defining the port in Application lets the scoring use case be unit-tested with a fake scorer and lets the AI vendor be swapped without touching [ScoreEventSessionsHandler](#scoreeventsessionshandler).
- **Where it's used**: injected into [ScoreEventSessionsHandler](#scoreeventsessionshandler); implemented by the Infrastructure `AnthropicScoringService` adapter (Group 20).

### CalendarExportMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` · `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/CalendarExportMapper.cs:13` · Level 7 · class

- **What it is**: an `internal static` helper that decides whether a session can appear in a public calendar and maps an exportable one to an [IcsEvent](group-08-auth.md#icsevent), converting the event-zone wall-clock times to UTC with explicit DST discipline (`CalendarExportMapper.cs:13`).
- **Depends on**: [Session](group-17-conference-domain.md#session) and [Event](group-17-conference-domain.md#event) (Conference domain), [IcsEvent](group-08-auth.md#icsevent) (the calendar builder's entry type in `MMCA.Common.Shared.Calendars`), and BCL `TimeZoneInfo`/`DateTimeOffset`.
- **Concept introduced: wall-clock to UTC conversion at the layer boundary.** The calendar builder is UTC-only by contract, but sessions store times as wall-clock local to the event's IANA time zone. `ToUtc` (`:41-50`) resolves that gap the same way the reminder planner does: it specifies the kind as `Unspecified`, and if `TimeZoneInfo.IsInvalidTime` reports the instant falls in a spring-forward gap (`:44`), it shifts ahead one hour before computing the offset. The deterministic DST handling is a correctness safeguard [Rubric §16, Maintainability].
- **Walkthrough**:
  - `ProductId` (`:16`): the RFC 5545 `PRODID` constant `-//MMCA//AtlDevCon//EN` stamped on every ADC calendar.
  - `IsExportable(Session)` (`:19-22`): true only when the session has both `StartsAt` and `EndsAt`, is not a service session, and is not `Declined`/`Cancelled` (case-insensitive): the single source of truth for public exportability, reused by both handlers.
  - `ToIcsEvent(Session, Event, TimeZoneInfo, string?)` (`:25-38`): builds a stable UID (`session-{Id}@atldevcon`), joins the room name and venue address into a location string, and converts start/end via `ToUtc`.
  - `ToUtc(DateTime, TimeZoneInfo)` (`:41-50`): the DST-aware conversion described above.
- **Why it's built this way**: centralizing the exportability rule and the time conversion in one internal helper keeps the two calendar handlers thin and guarantees they agree on what "public" and "UTC" mean ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 5).
- **Where it's used**: by [ExportEventCalendarHandler](#exporteventcalendarhandler) and [ExportSessionCalendarHandler](#exportsessioncalendarhandler); the resulting `IcsEvent` list is handed to [IcsCalendarBuilder](group-08-auth.md#icscalendarbuilder).

### ExportEventCalendarHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` · `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportEventCalendarHandler.cs:15` · Level 8 · class

- **What it is**: the query handler that produces a whole-schedule `.ics` string for a published event: every exportable session becomes one VEVENT with its room in the location. Unpublished or unknown events return NotFound (`ExportEventCalendarHandler.cs:15`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (for the [Event](group-17-conference-domain.md#event) and [Session](group-17-conference-domain.md#session) repositories), [CalendarExportMapper](#calendarexportmapper), [IcsCalendarBuilder](group-08-auth.md#icscalendarbuilder), and the [Result](group-01-result-error-handling.md#result)/[Error](group-01-result-error-handling.md#error) types. Implements [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) of [ExportEventCalendarQuery](#exporteventcalendarquery) to `Result<string>`.
- **Concept introduced: public-read handlers leak nothing.** The handler treats "unpublished" and "not found" identically: if the event is missing or `!IsPublished` it returns `Error.NotFound` (`:28-32`), so a caller cannot distinguish an unpublished event from a nonexistent one. [Rubric §11, Security] assesses exactly this kind of existence-hiding on public endpoints.
- **Walkthrough**:
  1. Load the event with its `Rooms` child collection eagerly included (`:25-27`); rooms are children of the Event aggregate and have no repository of their own (note at `:24`).
  2. Guard: null or unpublished then NotFound (`:28-32`).
  3. Load all non-deleted sessions for the event via a filtered `GetAllAsync` (`:34-36`) and build a room-id to name dictionary (`:37`).
  4. Resolve the event's IANA zone via `TimeZoneInfo.FindSystemTimeZoneById(@event.TimeZone)` (`:39`).
  5. Filter to `CalendarExportMapper.IsExportable`, order by `StartsAt`, and map each to an `IcsEvent`, resolving each session's room name from the dictionary (`:40-48`).
  6. Hand the entries to `IcsCalendarBuilder.Build` with the `ProductId` and current UTC timestamp, and return the string as `Result.Success` (`:50-51`).
- **Why it's built this way**: [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 5: rendering the schedule server-side keeps the RFC 5545 formatting in one shared builder and lets the read endpoint be output-cached like the other Conference public reads.
- **Where it's used**: invoked from the Conference calendar REST endpoint (Group 19); the `string` payload is served as an `.ics` download.

### ExportSessionCalendarHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` · `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportSessionCalendarHandler.cs:16` · Level 8 · class

- **What it is**: the single-session sibling of [ExportEventCalendarHandler](#exporteventcalendarhandler): it produces a one-VEVENT `.ics` document for the public add-to-calendar affordance, enforcing the same public-read rules (`ExportSessionCalendarHandler.cs:16`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork), [CalendarExportMapper](#calendarexportmapper), [IcsCalendarBuilder](group-08-auth.md#icscalendarbuilder), [Result](group-01-result-error-handling.md#result)/[Error](group-01-result-error-handling.md#error). Implements [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) of [ExportSessionCalendarQuery](#exportsessioncalendarquery) to `Result<string>`.
- **Concept introduced**: none new; it applies the same existence-hiding discipline [ExportEventCalendarHandler](#exporteventcalendarhandler) introduces, just with two guards instead of one. [Rubric §11, Security].
- **Walkthrough**:
  1. Load the session by id; if null or not `CalendarExportMapper.IsExportable`, return NotFound targeting `Session` (`:25-31`).
  2. Load the owning event with `Rooms` included; if null or unpublished, return NotFound targeting `Event` (`:34-41`): a session on an unpublished event stays hidden.
  3. Resolve the session's room name from the event's rooms (`:43-45`) and the IANA time zone (`:47`).
  4. Build a one-entry calendar via `IcsCalendarBuilder.Build` and return `Result.Success` (`:48-53`).
- **Why it's built this way**: a dedicated one-session path (rather than filtering the whole-event export) keeps the add-to-calendar button cheap and the leak-prevention guards explicit ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 5).
- **Where it's used**: the Conference session detail page's add-to-calendar affordance (Group 19/21).

### GetSessionSelectionDashboardHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardHandler.cs:16` · Level 8 · class

- **What it is**: the composite decision-support handler: it loads an event's sessions, categories, speakers, and AI scores once, then computes summary counts, category distribution, speaker overlap, speaker locality, and the AI-score table into a single [SessionSelectionDashboardDTO](group-17-conference-domain.md#sessionselectiondashboarddto) (`GetSessionSelectionDashboardHandler.cs:16`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) and the [Event](group-17-conference-domain.md#event)/[Session](group-17-conference-domain.md#session)/[Speaker](group-17-conference-domain.md#speaker)/[Category](group-17-conference-domain.md#category)/[SessionAiScore](group-17-conference-domain.md#sessionaiscore) repositories; `SpeakerLocalityHelper` and [SessionStatuses](group-17-conference-domain.md#sessionstatuses); the dashboard DTO family ([CategoryDistributionDTO](group-17-conference-domain.md#categorydistributiondto), [CategoryGroupDistribution](group-17-conference-domain.md#categorygroupdistribution), [CategoryItemDistribution](group-17-conference-domain.md#categoryitemdistribution), [SpeakerSessionOverlapDTO](group-17-conference-domain.md#speakersessionoverlapdto), [MultiSessionSpeaker](group-17-conference-domain.md#multisessionspeaker), [SpeakerSessionSummary](group-17-conference-domain.md#speakersessionsummary), [SpeakerLocalitySummary](group-17-conference-domain.md#speakerlocalitysummary), [SessionAiScoreDTO](group-17-conference-domain.md#sessionaiscoredto)). Implements [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) of [GetSessionSelectionDashboardQuery](#getsessionselectiondashboardquery) to `Result<SessionSelectionDashboardDTO>`.
- **Concept introduced: load-once, compute-many for read performance.** The handler deliberately issues a small fixed set of reads (event validation, then sessions, categories, speakers by id, AI scores) and derives all four analytics in memory from those materialized collections, rather than running a separate query per panel. The comment at `:33` calls out that the loads are sequential for EF single-context safety (a `DbContext` is not concurrency-safe). [Rubric §12, Performance and Scalability] assesses read-path efficiency: one bounded batch of no-tracking reads (`asTracking: false`, e.g. `:37`, `:42`, `:55`) beats N per-panel round trips.
- **Walkthrough**:
  1. Resolve the four repositories, then validate the event exists, else NotFound (`:23-31`).
  2. Load non-service sessions with `SessionSpeakers`/`SessionCategoryItems` included, all categories with `CategoryItems`, and the distinct speakers via `GetByIdsAsync` with `SpeakerCategoryItems` (`:34-57`).
  3. Build category-item name and locality lookups (`SpeakerLocalityHelper.FindLocalityCategory`/`BuildLocalityLookup`, `:60-70`).
  4. Compute summary counts (total, accepted, accept-queue, declined, and pending as the remainder) using [SessionStatuses](group-17-conference-domain.md#sessionstatuses) comparisons (`:73-80`).
  5. Compute `categoryDistribution` (`ComputeCategoryDistribution`, `:118-178`, which classifies each session via the private [StatusBucket](#statusbucket) enum), `speakerOverlap` (`ComputeSpeakerOverlap`, `:180-247`), and `speakerLocality` (`ComputeSpeakerLocality`, `:249-306`).
  6. Load the `SessionAiScore` rows for these sessions and map them to `SessionAiScoreDTO`s, splitting out the "Level" category and each session's speaker localities (`BuildAiScoreDtos`, `:331-354`).
  7. Assemble and return the composite DTO (`:102-115`).
- **Why it's built this way**: a single composite endpoint backs an organizer dashboard that shows all four analytics at once; computing them from one shared load avoids re-reading the same sessions four times.
- **Where it's used**: the Conference session-selection dashboard page (Group 21); the same overlap computation is also exposed standalone by [GetSpeakerSessionOverlapHandler](#getspeakersessionoverlaphandler).
- **Caveats / not-in-source**: the private [StatusBucket](#statusbucket) enum and the private compute methods are implementation details of this handler and are not exposed to callers.

### GetSpeakerSessionOverlapHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSpeakerSessionOverlap` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSpeakerSessionOverlap/GetSpeakerSessionOverlapHandler.cs:18` · Level 8 · class

- **What it is**: the standalone speaker-overlap handler: it returns every speaker who submitted at least one session for an event, with their sessions, sorted so multi-session speakers surface first (session count descending, then accepted-session presence, then name) (`GetSpeakerSessionOverlapHandler.cs:18`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) and the [Session](group-17-conference-domain.md#session)/[Speaker](group-17-conference-domain.md#speaker)/[Category](group-17-conference-domain.md#category) repositories; `SpeakerLocalityHelper`, [SessionStatuses](group-17-conference-domain.md#sessionstatuses), [SpeakerSessionOverlapDTO](group-17-conference-domain.md#speakersessionoverlapdto)/[MultiSessionSpeaker](group-17-conference-domain.md#multisessionspeaker)/[SpeakerSessionSummary](group-17-conference-domain.md#speakersessionsummary). Implements [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) of [GetSpeakerSessionOverlapQuery](#getspeakersessionoverlapquery) to `Result<SpeakerSessionOverlapDTO>`.
- **Concept introduced**: none new; it reuses the same load-once-compute pattern and the same [MultiSessionSpeaker](group-17-conference-domain.md#multisessionspeaker) projection that the dashboard's `ComputeSpeakerOverlap` builds, exposed as its own focused query. [Rubric §6, CQRS and Event-Driven] and [Rubric §12, Performance and Scalability].
- **Walkthrough**:
  1. Load non-service sessions with `SessionSpeakers`/`SessionCategoryItems` included (`:29-33`).
  2. Group sessions by speaker id (`GroupSessionsBySpeaker`, `:61-82`), skipping soft-deleted join rows; short-circuit to an empty result when no speakers (`:38-39`).
  3. Load those speakers by id (with `SpeakerCategoryItems`) and all categories, then build the locality lookup and category-item name lookup (`:41-54`).
  4. Build the [MultiSessionSpeaker](group-17-conference-domain.md#multisessionspeaker) list (`BuildMultiSessionSpeakers`, `:99-140`), stamping each speaker's locality tier via `SpeakerLocalityHelper.GetLocalityTier` and whether any session is accepted, then sort by session count, accepted presence, and name (`:127-137`).
- **Why it's built this way**: organizers sometimes want just the overlap view without paying for the whole composite dashboard, so it is its own use case reusing the shared helper and DTOs.
- **Where it's used**: the Conference speaker-overlap page (Group 21); returns the same DTO shape the dashboard embeds.

### ScoreEventSessionsHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsHandler.cs:15` · Level 8 · class

- **What it is**: the command handler that scores every session in an event via [IAiScoringService](#iaiscoringservice), persisting each score immediately so the UI can show real-time progress (`ScoreEventSessionsHandler.cs:15`). A `sealed partial class` (partial for the source-generated log methods).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) and the [Session](group-17-conference-domain.md#session)/[SessionAiScore](group-17-conference-domain.md#sessionaiscore)/[Speaker](group-17-conference-domain.md#speaker) repositories; [IAiScoringService](#iaiscoringservice); `ILogger<ScoreEventSessionsHandler>`; [SpeakerInfo](#speakerinfo)/[SessionScoringInput](#sessionscoringinput)/[SessionScoringResult](#sessionscoringresult); [ScoreEventSessionsResultDTO](group-17-conference-domain.md#scoreeventsessionsresultdto). Implements [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) of [ScoreEventSessionsCommand](#scoreeventsessionscommand) to `Result<ScoreEventSessionsResultDTO>`.
- **Concept introduced: per-item save with contained failure, plus source-generated logging.** Two patterns meet here. First, resilience: the loop scores one session at a time and saves it individually (`:99-111`); a scorer failure, a domain-factory failure, or a save exception increments `failed` and `continue`s rather than aborting the batch (`:79-97`), and only an all-failed run returns `Error.Failure` (`:116-122`). This is the never-throw contract of [SessionScoringResult](#sessionscoringresult) carried up into batch orchestration. [Rubric §29, Resilience and Business Continuity]. Second, observability: every log call is a `[LoggerMessage]` `static partial` method (`:127-143`), the compiler-generated high-performance logging pattern that avoids boxing and template re-parsing. [Rubric §13, Observability and Operability].
- **Walkthrough**:
  1. Load non-service sessions (with `SessionSpeakers`) for the event; short-circuit to a zero-count success when none (`:27-34`).
  2. `ExecuteDeleteAsync` all existing scores for these sessions so the dashboard resets to zero and progress is visible from scratch (`:37-45`).
  3. Batch-load the distinct speakers and build a lookup (`:48-59`).
  4. For each session: project its non-deleted speakers into [SpeakerInfo](#speakerinfo), build a [SessionScoringInput](#sessionscoringinput), call `aiScoringService.ScoreSessionAsync` (`:66-77`); on a failed result or a failed `SessionAiScore.Create`, count it as failed and continue (`:79-97`); otherwise `AddAsync` and `SaveChangesAsync` per session, catching non-cancellation exceptions as a per-session failure (`:99-111`).
  5. Log completion and return the count DTO, or `Error.Failure` (`AiScoring.AllFailed`) when nothing scored and something failed (`:114-124`).
- **Why it's built this way**: saving per session gives the organizer live progress and means a mid-run failure keeps the scores already computed; the all-failed guard surfaces a misconfiguration (a missing Anthropic API key) as a single actionable error rather than a silent empty result.
- **Where it's used**: invoked from the Conference AI-scoring endpoint (Group 19); the resulting scores feed [GetSessionSelectionDashboardHandler](#getsessionselectiondashboardhandler)'s AI-score panel.
- **Caveats / not-in-source**: the actual AI call and model are supplied by the Infrastructure `AnthropicScoringService` adapter (Group 20); this handler only orchestrates the port.

### GetNowNextQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextQuery.cs:11` · Level 0 · record

- **What it is**: the read request for the conference "happening now / up next" snapshot. Its single optional field, `EventId`, names the target event; passing `null` tells the handler to auto-select the current-or-next published event (`GetNowNextQuery.cs:11`).
- **Depends on**: the `EventIdentifierType` alias (Conference's event id type, declared in the module's Shared project). No other first-party types.
- **Concept introduced, the CQRS query record.** `[Rubric §6, CQRS & Event-Driven]` assesses whether reads and writes are genuinely separated, with each read expressed as its own request object routed to its own handler. A **query** here is an immutable request-for-data with no behavior: it names the read and carries its parameters, nothing more. The whole type is one line, `public sealed record GetNowNextQuery(EventIdentifierType? EventId);`. It is dispatched through the shared decorator pipeline to its [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) implementation, [`GetNowNextHandler`](#getnownexthandler), which answers with a [`Result`](group-01-result-error-handling.md#result). `[Rubric §5, Vertical Slice]` assesses whether a feature's pieces live together: query, handler, and result shape for this feature all sit under one `UseCases/NowNext` folder instead of layer-wide "Queries" and "Handlers" buckets.
- **Walkthrough**: a positional `record` with one nullable member, `EventId` (`GetNowNextQuery.cs:11`). The `null` sentinel is load-bearing: the doc comment (`GetNowNextQuery.cs:3-10`) records that the home-screen widget has no event id of its own, so it passes `null` and the handler features the live-or-next published event, the same rule the other home surfaces use.
- **Why it's built this way**: a `record` gives value equality and immutability for free, so the query is safe to use as a cache or log key in the pipeline; making the event id optional lets one query serve both the event-scoped page and the global home widget without a second type.
- **Where it's used**: handled by [`GetNowNextHandler`](#getnownexthandler); constructed in two places by [`EventsController`](group-20-conference-api-grpc.md#eventscontroller), once with the route id (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventsController.cs:182`) and once with `EventId: null` for the id-less home form (`EventsController.cs:196`). Both actions are `[AllowAnonymous]` and short-TTL output-cached under the `NowNextCache` policy (`EventsController.cs:175-177, 190-192`).

### GetPublicSessionFilterQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionFilter` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterQuery.cs:9` · Level 0 · record

- **What it is**: a parameterless **marker query** that asks for the specification describing "publicly visible sessions": non-declined, non-cancelled sessions whose parent event is published (BR-132 / BR-49).
- **Depends on**: nothing first-party. It is an empty record with no positional parameters.
- **Concept, the marker query.** `[Rubric §6, CQRS & Event-Driven]`. Not every query carries parameters. This one is literally `public sealed record GetPublicSessionFilterQuery;` (`GetPublicSessionFilterQuery.cs:9`): it exists to select a handler through the pipeline. What comes back is not rows but a reusable [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype) that other read paths compose into their own queries, so "what counts as a public session" is defined in exactly one place.
- **Concept, cross-store filtering.** `[Rubric §8, Data Architecture]` assesses how a rule spanning two physical stores is expressed without an illegal cross-database join. The doc comment (`GetPublicSessionFilterQuery.cs:3-8`) states the constraint plainly: [`Session`](group-17-conference-domain.md#session) lives in Cosmos DB while [`Event`](group-17-conference-domain.md#event) lives in SQL Server, so the "parent event is published" check cannot be a navigation join. [`GetPublicSessionFilterHandler`](#getpublicsessionfilterhandler) resolves it through the framework's cross-source helper instead.
- **Walkthrough**: no members. The type is the request; every line of behavior is in [`GetPublicSessionFilterHandler`](#getpublicsessionfilterhandler).
- **Why it's built this way**: a marker record keeps the read strongly named and pipeline-routable even with no arguments, and returning a specification rather than materialized rows lets the paged public list and any other public-facing read share one definition of visibility.
- **Where it's used**: handled by [`GetPublicSessionFilterHandler`](#getpublicsessionfilterhandler); constructed by [`SessionsController`](group-20-conference-api-grpc.md#sessionscontroller) in its private `BuildPublicSessionSpecificationAsync` helper (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionsController.cs:69`), which returns `null` for organizers (they see everything) and the specification for everyone else (`SessionsController.cs:64-73`).

### GetSessionBookmarkCountQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCount` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionBookmarkCount/GetSessionBookmarkCountQuery.cs:6` · Level 0 · record

- **What it is**: a speaker-facing query asking "how many attendees bookmarked my session" (BR-210). It carries the requesting `SpeakerId` and the target `SessionId` (`GetSessionBookmarkCountQuery.cs:6`).
- **Depends on**: the `SpeakerIdentifierType` and `SessionIdentifierType` aliases. No other first-party types (it is a request record in the same mould as [`GetNowNextQuery`](#getnownextquery)).
- **Concept, ownership carried on the query.** `[Rubric §11, Security]` assesses whether authorization data travels with the request instead of being assumed by the code that serves it. The query deliberately carries `SpeakerId` so the handler can verify the caller actually presents the session before revealing a count; that check lives in [`GetSessionBookmarkCountHandler`](#getsessionbookmarkcounthandler), not in the query.
- **Walkthrough**: a positional `record` with two members in order, `SpeakerId` then `SessionId` (`GetSessionBookmarkCountQuery.cs:6`). The doc comment documents each parameter and cites BR-210 (`GetSessionBookmarkCountQuery.cs:3-5`).
- **Why it's built this way**: passing the speaker identity as part of the read, rather than reaching into ambient user context inside the handler, keeps the handler pure and unit-testable and makes the authorization dependency explicit in the contract.
- **Where it's used**: handled by [`GetSessionBookmarkCountHandler`](#getsessionbookmarkcounthandler); constructed by [`SpeakersController`](group-20-conference-api-grpc.md#speakerscontroller) on `GET {speakerId}/sessions/{sessionId}/bookmarks/count` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:271`), an `[AllowAnonymous]` action output-cached under `ConferencePublicCache` (`SpeakersController.cs:262-264`).

### SessionEventIdRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:24` · Level 0 · class (sealed, generic)

- **What it is**: a reusable FluentValidation rule asserting that a session request carries a non-empty event id (`SessionValidationRules.cs:24-30`).
- **Depends on**: `FluentValidation.AbstractValidator<T>` (NuGet); the `EventIdentifierType` alias.
- **Concept introduced, the composable rule fragment.** `[Rubric §24, Forms/Validation/UX Safety]` assesses whether validation is factored into reusable single-purpose units rather than restated per request. Unlike its file-mates, which inherit the shared string rules, this one derives straight from `AbstractValidator<T>` (`SessionValidationRules.cs:24-25`) because it validates an identifier, not a length-bounded string. It is generic over `T`, the request type carrying the property, and takes an `Expression<Func<T, EventIdentifierType>>` selector (`SessionValidationRules.cs:27`) so any session request can `Include` it against whichever property holds the event id.
- **Walkthrough**: an expression-bodied constructor: `RuleFor(selector).NotEmpty()` with the message "You must specify an Event for the Session" and the explicit error code `"Session.EventId.Required"` (`SessionValidationRules.cs:27-29`). The `WithErrorCode` call is what keeps the failure machine-classifiable once it flows back as an [`Error`](group-01-result-error-handling.md#error) through the [`Result`](group-01-result-error-handling.md#result) pipeline.
- **Why it's built this way**: a single-rule generic validator can be shared by every session request through FluentValidation's `Include`, so "an event is mandatory" is authored once instead of copy-pasted.
- **Where it's used**: `Include`d by [`SessionCreateRequestValidator`](#sessioncreaterequestvalidator) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Create/SessionCreateRequestValidator.cs:12`). Note it is deliberately absent from [`SessionUpdateRequestValidator`](#sessionupdaterequestvalidator) (`.../Sessions/UseCases/Update/SessionUpdateRequestValidator.cs:11-17`): a session's owning event is set at creation and is not part of the update payload.

### SessionAccessibilityInfoRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:87` · Level 5 · class (sealed, generic)

- **What it is**: the reusable rule for the optional accessibility-info text on a session, enforcing only the max length defined on the domain invariants (`SessionValidationRules.cs:87-92`).
- **Depends on**: [`OptionalStringRules<T>`](group-06-validation.md#optionalstringrulest) (its base), [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) (for `AccessibilityInfoMaxLength`, which is 500 at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionInvariants.cs:22`).
- **Concept introduced, the optional-string rule family.** `[Rubric §24, Forms/Validation/UX Safety]` and `[Rubric §16, Maintainability]` (which assesses whether a constant governing a field lives in one place). Six of the session field rules share one shape: a one-line sealed generic class whose constructor forwards `(selector, label, SessionInvariants.<Field>MaxLength)` to [`OptionalStringRules<T>`](group-06-validation.md#optionalstringrulest). The base does all the work, a single `RuleFor(selector).MaximumLength(maxLength)` with an invariant-culture message (`MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommonValidationRules.cs:25-29`); it deliberately has no `NotEmpty`, which is what makes the field optional. Because the length comes from the domain [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) rather than a literal, the same constant governs the EF column, the domain guard, and this request-level check. The five siblings below repeat this shape with a different label and constant; only their arguments differ.
- **Walkthrough**: constructor forwards `(selector, "Accessibility Info", SessionInvariants.AccessibilityInfoMaxLength)` to the base (`SessionValidationRules.cs:90-91`).
- **Why it's built this way**: subclassing the shared optional-string rule means every optional text field in the codebase fails the same way with the same message shape, and pulling the bound from invariants stops the validator and the persistence layer from drifting apart.
- **Where it's used**: `Include`d by both [`SessionCreateRequestValidator`](#sessioncreaterequestvalidator) (`SessionCreateRequestValidator.cs:17`) and [`SessionUpdateRequestValidator`](#sessionupdaterequestvalidator) (`SessionUpdateRequestValidator.cs:16`).

### SessionDescriptionRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:37` · Level 5 · class (sealed, generic)

- **What it is**: the reusable rule for a session's optional description, enforcing the domain max length (`SessionValidationRules.cs:37-42`).
- **Depends on**: [`OptionalStringRules<T>`](group-06-validation.md#optionalstringrulest), [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) (`DescriptionMaxLength` is 4000, `SessionInvariants.cs:16`).
- **Concept**: identical shape to [`SessionAccessibilityInfoRules<T>`](#sessionaccessibilityinforulest); see that section for the family rationale and the `[Rubric §24]` / `[Rubric §16]` explanation.
- **Walkthrough**: forwards `(selector, "Session Description", SessionInvariants.DescriptionMaxLength)` to the base (`SessionValidationRules.cs:40-41`).
- **Why it's built this way**: the description is the largest free-text field on a session (4000 characters), so a bound is enforced at the edge as well as in the domain, and it comes from the same constant in both places.
- **Where it's used**: `Include`d by [`SessionCreateRequestValidator`](#sessioncreaterequestvalidator) (`SessionCreateRequestValidator.cs:13`) and [`SessionUpdateRequestValidator`](#sessionupdaterequestvalidator) (`SessionUpdateRequestValidator.cs:12`).

### SessionLiveUrlRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:62` · Level 5 · class (sealed, generic)

- **What it is**: the reusable rule for a session's optional live-stream URL. It is length-only: the value is never parsed or format-checked (`SessionValidationRules.cs:62-67`).
- **Depends on**: [`OptionalStringRules<T>`](group-06-validation.md#optionalstringrulest), [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) (`LiveUrlMaxLength` is 2000, `SessionInvariants.cs:28`).
- **Concept, the deliberate non-validation.** `[Rubric §9, API & Contract Design]` assesses whether a contract's tolerance is a decision rather than an oversight. The doc comment (`SessionValidationRules.cs:56-61`) says explicitly that the check is length-only because the value is stored as an opaque string for Sessionize compatibility: the upstream import is the authority on the URL's shape, so a stricter format rule here would reject data the conference actually publishes. Shape otherwise identical to [`SessionAccessibilityInfoRules<T>`](#sessionaccessibilityinforulest).
- **Walkthrough**: forwards `(selector, "Live URL", SessionInvariants.LiveUrlMaxLength)` to the base (`SessionValidationRules.cs:65-66`).
- **Why it's built this way**: accepting whatever Sessionize supplies keeps the import path lossless; the length cap still protects the column and the payload size.
- **Where it's used**: `Include`d by [`SessionCreateRequestValidator`](#sessioncreaterequestvalidator) (`SessionCreateRequestValidator.cs:15`) and [`SessionUpdateRequestValidator`](#sessionupdaterequestvalidator) (`SessionUpdateRequestValidator.cs:14`).
- **Caveats / not-in-source**: because no format rule runs here, a malformed live URL is only detectable downstream (in the UI or by the viewer). Nothing in this file validates the scheme or host.

### SessionRecordingUrlRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:75` · Level 5 · class (sealed, generic)

- **What it is**: the reusable rule for a session's optional post-event recording URL, again length-only (`SessionValidationRules.cs:75-80`).
- **Depends on**: [`OptionalStringRules<T>`](group-06-validation.md#optionalstringrulest), [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) (`RecordingUrlMaxLength` is 2000, `SessionInvariants.cs:31`).
- **Concept**: the same opaque-string decision as [`SessionLiveUrlRules<T>`](#sessionliveurlrulest), stated in its own doc comment at `SessionValidationRules.cs:69-74`.
- **Walkthrough**: forwards `(selector, "Recording URL", SessionInvariants.RecordingUrlMaxLength)` to the base (`SessionValidationRules.cs:78-79`).
- **Why it's built this way**: recording links arrive from the same external pipeline as live links, so both are treated identically.
- **Where it's used**: `Include`d by [`SessionCreateRequestValidator`](#sessioncreaterequestvalidator) (`SessionCreateRequestValidator.cs:16`) and [`SessionUpdateRequestValidator`](#sessionupdaterequestvalidator) (`SessionUpdateRequestValidator.cs:15`).

### SessionResourceLinksRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:99` · Level 5 · class (sealed, generic)

- **What it is**: the reusable rule for a session's optional resource-links blob (slides, repos, handouts), enforcing the domain max length (`SessionValidationRules.cs:99-104`).
- **Depends on**: [`OptionalStringRules<T>`](group-06-validation.md#optionalstringrulest), [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) (`ResourceLinksMaxLength` is 2000, `SessionInvariants.cs:25`).
- **Concept**: family member of [`SessionAccessibilityInfoRules<T>`](#sessionaccessibilityinforulest); nothing structurally new.
- **Walkthrough**: forwards `(selector, "Resource Links", SessionInvariants.ResourceLinksMaxLength)` to the base (`SessionValidationRules.cs:102-103`).
- **Why it's built this way**: consistency with the other optional text fields; the single length constant is the only thing that varies.
- **Where it's used**: `Include`d by [`SessionCreateRequestValidator`](#sessioncreaterequestvalidator) (`SessionCreateRequestValidator.cs:18`) and [`SessionUpdateRequestValidator`](#sessionupdaterequestvalidator) (`SessionUpdateRequestValidator.cs:17`).

### SessionStatusRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:49` · Level 5 · class (sealed, generic)

- **What it is**: the reusable rule for a session's optional status string ("Accepted", "Declined", and so on), enforcing the domain max length (`SessionValidationRules.cs:49-54`).
- **Depends on**: [`OptionalStringRules<T>`](group-06-validation.md#optionalstringrulest), [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) (`StatusMaxLength` is 100, `SessionInvariants.cs:19`).
- **Concept**: same family as [`SessionAccessibilityInfoRules<T>`](#sessionaccessibilityinforulest). Worth noting what this rule does **not** do: it validates length only, never membership in [`SessionStatuses`](group-17-conference-domain.md#sessionstatuses). Status values originate in Sessionize, so the field stays an open string here and the meaningful statuses are compared by constant downstream (see [`GetPublicSessionFilterHandler`](#getpublicsessionfilterhandler)).
- **Walkthrough**: forwards `(selector, "Session Status", SessionInvariants.StatusMaxLength)` to the base (`SessionValidationRules.cs:52-53`).
- **Why it's built this way**: keeping status open-ended lets the import accept new upstream vocabulary without a code change; the read paths that care about a specific status compare it explicitly.
- **Where it's used**: `Include`d by [`SessionCreateRequestValidator`](#sessioncreaterequestvalidator) (`SessionCreateRequestValidator.cs:14`) and [`SessionUpdateRequestValidator`](#sessionupdaterequestvalidator) (`SessionUpdateRequestValidator.cs:13`).

### SessionTitleRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:13` · Level 5 · class (sealed, generic)

- **What it is**: the reusable rule for a session title, enforcing both non-empty and the domain max length (`SessionValidationRules.cs:13-18`).
- **Depends on**: [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest) (its base), [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) (`TitleMaxLength` is 500, `SessionInvariants.cs:13`).
- **Concept, required versus optional string rules.** `[Rubric §24, Forms/Validation/UX Safety]`. This is the one mandatory text field among the session rules, so it inherits [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest) rather than [`OptionalStringRules<T>`](group-06-validation.md#optionalstringrulest). The base pairs `NotEmpty()` with `MaximumLength(maxLength)` and formats both messages with `CultureInfo.InvariantCulture` (`MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommonValidationRules.cs:13-18`); the optional base drops the `NotEmpty` and keeps the rest. Choosing a base is therefore the entire "is this field required" decision, expressed once per field.
- **Walkthrough**: a one-line class whose constructor forwards `(selector, "Session Title", SessionInvariants.TitleMaxLength)` to the base (`SessionValidationRules.cs:16-17`). All `NotEmpty` / `MaximumLength` mechanics live upstream in Common.
- **Why it's built this way**: subclassing the shared required-string rule keeps every "required, length-bounded text field" in the workspace validated identically, and reading the length from invariants prevents the validator and the EF column from diverging.
- **Where it's used**: `Include`d by [`SessionCreateRequestValidator`](#sessioncreaterequestvalidator) (`SessionCreateRequestValidator.cs:11`) and [`SessionUpdateRequestValidator`](#sessionupdaterequestvalidator) (`SessionUpdateRequestValidator.cs:11`), the only rule in the file included by both under the same field name.

### SessionRoomScheduling
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Validation/SessionRoomScheduling.cs:14` · Level 7 · class (static)

- **What it is**: the shared room double-booking guard for the session create and update paths. It supplies the overlap predicate used for a server-side existence check and the conflict [`Error`](group-01-result-error-handling.md#error) returned when the check trips (`SessionRoomScheduling.cs:14`).
- **Depends on**: [`Session`](group-17-conference-domain.md#session), the `RoomIdentifierType` / `SessionIdentifierType` aliases, [`Error`](group-01-result-error-handling.md#error) from `MMCA.Common.Shared.Abstractions`, and `System.Linq.Expressions.Expression<T>` (BCL).
- **Concept introduced, validation that needs the database.** `[Rubric §24, Forms/Validation/UX Safety]` and `[Rubric §8, Data Architecture]`. FluentValidation rules like the ones above are pure functions over the request; a double-booking rule is not, because it depends on other rows. Rather than dragging a repository into a validator, the rule is expressed as a **SQL-translatable predicate factory** that a handler passes to `repository.ExistsAsync(...)`, so the check runs as one server-side existence query instead of loading sessions into memory. `[Rubric §1, SOLID]`: the predicate and the error message are the only two things the two call sites need to share, so those two things (and nothing else) are what the static class exposes.
- **Concept, half-open intervals.** The overlap test uses `[StartsAt, EndsAt)` semantics: two sessions conflict only when `s.StartsAt < endsAt && s.EndsAt > startsAt` (`SessionRoomScheduling.cs:39`). Back-to-back sessions, where one ends exactly when the next begins, do not conflict. That is the standard way to avoid a spurious conflict on every adjacent slot.
- **Walkthrough**
  - `BuildOverlapPredicate` (`SessionRoomScheduling.cs:26-40`): takes the room, the requested `[startsAt, endsAt)` window, and an optional `excludeSessionId` used by the update path so a session does not conflict with itself.
  - The exclusion sentinel (`SessionRoomScheduling.cs:32-34`): instead of branching into two predicate shapes, a `null` exclusion collapses to `int.MinValue`. The inline comment explains why that is safe: session ids are always positive (Sessionize-assigned or the reserved manual range), so the sentinel excludes nothing. One predicate shape also means one query plan.
  - The predicate body (`SessionRoomScheduling.cs:36-39`): same room, not the excluded id, both endpoints non-null, and the half-open overlap test.
  - `DoubleBookedError` (`SessionRoomScheduling.cs:49-54`): builds `Error.Conflict` with code `"Session.Room.DoubleBooked"` and a human message, parameterized by `source` (the calling handler name) and `target` (the property name), so the same error surfaces with correct tracing from either call site.
- **Why it's built this way**: the doc comment (`SessionRoomScheduling.cs:7-13`) is candid that rejecting the overlap is a policy choice, it guards against accidental double-booking, and deliberate co-location such as lightning talks sharing a slot would need this relaxed to a warning. Keeping the policy in one static class means that change would be made in exactly one place rather than in two handlers.
- **Where it's used**: [`CreateSessionHandler`](#createsessionhandler) calls it only when room and both times are supplied, passing no exclusion (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Create/CreateSessionHandler.cs:95-103`); [`UpdateSessionHandler`](#updatesessionhandler) calls it with `excludeSessionId: command.Id` so a session may keep or shrink its own slot (`.../Sessions/UseCases/Update/UpdateSessionHandler.cs:120-128`).

### GetNowNextHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextHandler.cs:20` · Level 8 · class (sealed)

- **What it is**: the query handler that builds the now-next snapshot: sessions running at the query instant plus the next starting batch, for one published [`Event`](group-17-conference-domain.md#event) (`GetNowNextHandler.cs:20`).
- **Depends on**: [`GetNowNextQuery`](#getnownextquery), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), `TimeProvider` (BCL), [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector), [`CalendarExportMapper`](#calendarexportmapper), [`Event`](group-17-conference-domain.md#event) and [`Session`](group-17-conference-domain.md#session), and the [`NowNextDTO`](group-17-conference-domain.md#nownextdto) / [`NowNextSessionDTO`](group-17-conference-domain.md#nownextsessiondto) result shapes.
- **Concept introduced, the injectable clock.** `[Rubric §14, Testability]` assesses whether time-dependent logic is driven by an abstraction instead of `DateTime.UtcNow`. The handler takes `TimeProvider` through its primary constructor (`GetNowNextHandler.cs:21`) and reads `timeProvider.GetUtcNow()` once at the top (`GetNowNextHandler.cs:29`), so "now" is a single deterministic value for the whole computation and can be pinned in a test. `[Rubric §12, Performance & Scalability]`: the now and next partitions are computed in memory over one session load rather than issuing several round-trips.
- **Concept, read-side projection.** `[Rubric §6, CQRS & Event-Driven]`. This is decision-support output the domain never stores: it reshapes aggregate state into a live-schedule view that only exists on the read side.
- **Walkthrough**
  - Event selection (`GetNowNextHandler.cs:31`, `90-113`): `SelectEventAsync` either loads the explicit `EventId` with its `Rooms` (`GetNowNextHandler.cs:97-101`) or, when the id is `null`, loads all published events and delegates to [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector)`.SelectCurrentOrNext` (`GetNowNextHandler.cs:103-112`). A missing or unpublished event returns `Error.NotFound` tagged with the handler and `Event` (`GetNowNextHandler.cs:32-36`).
  - Session load plus eligibility (`GetNowNextHandler.cs:38-56`): loads the event's sessions and its room-name lookup, then filters with [`CalendarExportMapper`](#calendarexportmapper)`.IsExportable`, which requires both timestamps present, a non-service session, and a status that is neither "Declined" nor "Cancelled" (`.../Sessions/UseCases/ExportCalendar/CalendarExportMapper.cs:20-23`). The now-next surface therefore cannot show a session the calendar export would hide.
  - Time-zone conversion (`GetNowNextHandler.cs:43-51`, `80-88`): resolves the event's zone with a `try/catch` on `TimeZoneNotFoundException` falling back to `TimeZoneInfo.Utc`, so an unknown zone id degrades instead of throwing; each row carries both the stored wall-clock times and their UTC conversions via `CalendarExportMapper.ToUtc`.
  - Now and next partitioning (`GetNowNextHandler.cs:58-72`): "now" is every row whose interval straddles `utcNow`, ordered by start then room name with `StringComparer.OrdinalIgnoreCase`; "next" is the batch sharing the earliest **future** start, so parallel tracks appear together rather than one arbitrary session (the intent is stated in the inline comment at `GetNowNextHandler.cs:64`).
  - Live flag and result (`GetNowNextHandler.cs:74-77`): asks [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector)`.GetLiveWindowUtc` for the event's window and sets `isLive` by containment, then returns `Result.Success(new NowNextDTO(...))`.
- **Why it's built this way**: delegating event selection and the live window to [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector), and eligibility plus UTC conversion to [`CalendarExportMapper`](#calendarexportmapper), keeps the now-next widget, the home surfaces, and the calendar export consistent by construction rather than by three copies of the same rules. The doc comment attributes the feature to [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 8 (`GetNowNextHandler.cs:12-19`).
- **Where it's used**: invoked by both now-next actions on [`EventsController`](group-20-conference-api-grpc.md#eventscontroller) (`EventsController.cs:182, 196`).
- **Caveats / not-in-source**: the "[ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 8" attribution comes from the source doc comment; this walkthrough describes only what the method bodies do.

### GetSessionBookmarkCountHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCount` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionBookmarkCount/GetSessionBookmarkCountHandler.cs:14` · Level 8 · class (sealed)

- **What it is**: the handler for [`GetSessionBookmarkCountQuery`](#getsessionbookmarkcountquery). It verifies the calling speaker is assigned to the session, then reads the bookmark count from the Engagement bounded context (`GetSessionBookmarkCountHandler.cs:14`).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IBookmarkCountService`](group-22-engagement-module.md#ibookmarkcountservice) (the cross-module port), [`Session`](group-17-conference-domain.md#session), [`Error`](group-01-result-error-handling.md#error) / [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced, the cross-module read over a port.** `[Rubric §7, Microservices Readiness]` assesses whether a module reaches another bounded context through an interface rather than a direct type or table reference. Bookmarks belong to Engagement, so this Conference handler depends on the [`IBookmarkCountService`](group-22-engagement-module.md#ibookmarkcountservice) abstraction injected through its primary constructor (`GetSessionBookmarkCountHandler.cs:14-16`) and calls `GetBookmarkCountForSessionAsync` (`GetSessionBookmarkCountHandler.cs:43`). In the extracted topology that port is satisfied by a gRPC client (or a disabled-module stub); the handler cannot tell which, and does not change either way.
- **Concept, authorize before you answer.** `[Rubric §11, Security]`. The ownership gate runs before the cross-module call, so an unauthorized caller never causes a downstream read and never learns a number.
- **Walkthrough**
  - Load with membership (`GetSessionBookmarkCountHandler.cs:23-30`): resolves the [`Session`](group-17-conference-domain.md#session) repository and loads the session including `SessionSpeakers` with `asTracking: false` (this is a read, so no change tracking). A missing session returns `Error.NotFound` tagged with the handler and `Session`.
  - Ownership check (`GetSessionBookmarkCountHandler.cs:32-40`): if no non-deleted `SessionSpeaker` matches the query's `SpeakerId`, it returns `Error.Forbidden` with code `"Speaker.NotAssigned"`, targeted at `SpeakerId`. The explicit `!ss.IsDeleted` term matters: a speaker removed from a session is soft-deleted, and a removed speaker must not keep reading the session's numbers.
  - Cross-module read (`GetSessionBookmarkCountHandler.cs:42-45`): calls the port and wraps the `int` in `Result.Success`.
- **Why it's built this way**: keeping bookmark counting behind an interface preserves the Engagement / Conference boundary ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)'s extraction path), so the same handler runs in-process in a monolith or over gRPC in the extracted topology with no code change; doing the ownership check locally, on data Conference already owns, means the authorization decision needs no remote call.
- **Where it's used**: invoked by [`SpeakersController`](group-20-conference-api-grpc.md#speakerscontroller) on the per-session bookmark-count endpoint (`SpeakersController.cs:270-272`).

### GetPublicSessionFilterHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionFilter` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandler.cs:17` · Level 9 · class (sealed)

- **What it is**: the handler for [`GetPublicSessionFilterQuery`](#getpublicsessionfilterquery). It returns a [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype) selecting public sessions: non-declined, non-cancelled sessions whose parent event is published (BR-132 / BR-49) (`GetPublicSessionFilterHandler.cs:17-19`).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`CrossSourceSpecification`](group-03-querying-specifications.md#crosssourcespecification), [`Event`](group-17-conference-domain.md#event), [`Session`](group-17-conference-domain.md#session), [`SessionStatuses`](group-17-conference-domain.md#sessionstatuses).
- **Concept, the cross-source specification helper.** `[Rubric §8, Data Architecture]` and `[Rubric §7, Microservices Readiness]`. When the principal entity and the dependent entity live in different stores, the "belongs to a published event" filter cannot be a join. The handler hands that problem to the framework's [`CrossSourceSpecification`](group-03-querying-specifications.md#crosssourcespecification)`.BuildAsync` (`GetPublicSessionFilterHandler.cs:26-33`), which resolves the published [`Event`](group-17-conference-domain.md#event) ids from their own source and returns a `Session.EventId IN (...)` criteria ANDed with a local predicate, translatable wherever [`Session`](group-17-conference-domain.md#session) is stored. `[Rubric §12, Performance & Scalability]`: the id set is resolved once per request and embedded in the filter, so the session read stays a single query.
- **Walkthrough**
  - The `BuildAsync` call (`GetPublicSessionFilterHandler.cs:26-33`): generic over `<Session, SessionIdentifierType, Event, EventIdentifierType>`, with `principalPredicate: e => e.IsPublished`, `dependentForeignKey: s => s.EventId`, and `localPredicate: s => s.Status != SessionStatuses.Declined && s.Status != "Cancelled"`.
  - Return (`GetPublicSessionFilterHandler.cs:35`): wraps the built specification in `Result.Success`. The handler has no failure path of its own; anything it cannot do surfaces from the helper.
- **Why it's built this way**: routing the two-store filter through one reusable helper solves the "no cross-database join" rule in the framework once, and keeping the status test as a local predicate leaves the visibility rule readable at the call site. The doc comments on both the query and the handler (`GetPublicSessionFilterQuery.cs:3-8`, `GetPublicSessionFilterHandler.cs:11-16`) record that [`Session`](group-17-conference-domain.md#session) is Cosmos-stored and [`Event`](group-17-conference-domain.md#event) SQL-stored, which is the reason the helper exists.
- **Where it's used**: [`SessionsController`](group-20-conference-api-grpc.md#sessionscontroller) calls it for every non-organizer session read and applies the returned specification to the listing query (`SessionsController.cs:64-73`); organizers skip it entirely and see declined sessions.
- **Caveats / not-in-source**: `"Cancelled"` is a bare string literal at `GetPublicSessionFilterHandler.cs:31` while `Declined` uses the [`SessionStatuses`](group-17-conference-domain.md#sessionstatuses) constant. Both are checked, but only one is symbolic.

### GetSessionBookmarkCountsQuery

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCounts` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionBookmarkCounts/GetSessionBookmarkCountsQuery.cs:6` · Level 0 · record

- **What it is**: the query message a speaker sends to learn how many attendees have bookmarked each of their sessions, asked for a whole set of sessions in one call (BR-210). It is a two-member positional `sealed record` and nothing more.
- **Depends on**: the `SpeakerIdentifierType` and `SessionIdentifierType` aliases (module-wide `global using` declarations, see the primer's identifier-alias section in `00-primer.md`); `IReadOnlyCollection<T>` (BCL).
- **Concept introduced: the batched query message.** Most read slices in this chapter carry a single id. This one carries a collection (`SessionIds`, line 8) so the handler can answer for N sessions with a bounded number of round trips instead of one call per session. The shape of the message is what makes the batching possible: an API that only accepted a single id would force the caller into an N+1 loop no matter how efficient the handler was. `[Rubric §12, Performance & Scalability]` (assesses whether the design avoids avoidable round trips under realistic load): the contract itself is the optimization, and the downstream [IBookmarkCountService](group-22-engagement-module.md#ibookmarkcountservice) has a matching batch method so the saving survives the cross-module hop.
- **Walkthrough**: `SpeakerId` (line 7) identifies the caller and exists purely so the handler can re-verify ownership server side; `SessionIds` (line 8) is the requested set. There are no methods, no validation, and no defaults: the record is an immutable request envelope.
- **Why it's built this way**: CQRS query messages in this codebase are plain records dispatched to an [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult); keeping them behavior-free means the decorator pipeline (logging, caching) can wrap any of them uniformly.
- **Where it's used**: constructed by `SpeakersController` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:291`, which passes `sessionIds ?? []`) and handled by [GetSessionBookmarkCountsHandler](#getsessionbookmarkcountshandler).

---

### GetSessionFeedbackQuery

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionFeedback` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionFeedback/GetSessionFeedbackQuery.cs:6` · Level 0 · record

- **What it is**: the query asking for the aggregated attendee feedback (ratings plus free-text answers) on one session, on behalf of one speaker (BR-210).
- **Depends on**: the `SpeakerIdentifierType` and `SessionIdentifierType` aliases.
- **Concept introduced**: none new. Like [GetSessionBookmarkCountsQuery](#getsessionbookmarkcountsquery) it is a behavior-free record; the difference is scope (one session, line 6). `[Rubric §11, Security]` (assesses whether authorization data travels with the request and is checked server side): carrying `SpeakerId` in the message, rather than trusting a client assertion that "these are my sessions", is what lets [GetSessionFeedbackHandler](#getsessionfeedbackhandler) reject a speaker asking about someone else's session.
- **Walkthrough**: two positional members on a single line: `SpeakerId` (the caller) and `SessionId` (the target). No members beyond those.
- **Why it's built this way**: the vertical-slice convention pairs one folder with one query record, one handler, and one result DTO, so the whole read use case is legible in one directory. `[Rubric §5, Vertical Slice]`.
- **Where it's used**: created by `SpeakersController` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:252`) and answered with a [SessionFeedbackDTO](group-17-conference-domain.md#sessionfeedbackdto).

---

### GetSpeakersByEventFilterQuery

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSpeakersByEventFilter` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSpeakersByEventFilter/GetSpeakersByEventFilterQuery.cs:12` · Level 0 · record

- **What it is**: a one-member query (`EventId`, line 12) whose answer is not data but a *filter*: the handler returns a [Specification<TEntity, TIdentifierType>](group-03-querying-specifications.md#specificationtentity-tidentifiertype) that selects the speakers belonging to an event.
- **Depends on**: the `EventIdentifierType` alias.
- **Concept introduced: a query that returns a specification instead of rows.** Normally a query handler returns DTOs. Here the handler returns a reusable predicate object, so the caller can compose it with paging, sorting, and its own criteria before a single row is fetched. The XML comment on the record (lines 3-10) states the domain reason this indirection exists: a `Speaker` belongs to an event either directly, through the `EventSpeaker` join written by the Sessionize sync, or transitively through any session of that event, through the `SessionSpeaker` join written by organizer session management. The two link paths are populated by different flows, so "speakers of this event" is a union, not a column. `[Rubric §2, Design Patterns]`: this is the Specification pattern used as the return type of a use case, which keeps the union rule in one place instead of duplicating it into every controller that lists speakers. `[Rubric §8, Data Architecture]`: the comment notes the criteria stays engine-portable because the joins are resolved as ID-list projections rather than navigation joins.
- **Walkthrough**: a single positional member, `EventId`. All of the interesting work lives in [GetSpeakersByEventFilterHandler](#getspeakersbyeventfilterhandler); the record only names the input.
- **Why it's built this way**: `Speaker` has no `EventId` column, so the relationship cannot be expressed as a simple property filter. Modeling the answer as a specification lets the read endpoint keep its generic list-and-page machinery and just plug in an extra criterion.
- **Where it's used**: `SpeakersController` injects the handler as `IQueryHandler<GetSpeakersByEventFilterQuery, Result<Specification<Speaker, SpeakerIdentifierType>>>` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:52`) and dispatches the query at line 99 of that file.

---

### ConferenceCategoryUpdateRequest

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/Update/ConferenceCategoryUpdateRequest.cs:6` · Level 1 · record

- **What it is**: the inbound payload the API binds when a client edits an existing conference category: a `record class` of `init`-only properties describing the new field values.
- **Depends on**: [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware) (Level 0, implemented at line 6).
- **Concept introduced: the update request that carries an EF rowversion token.** The record implements [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware) with a nullable `byte[]? RowVersion { get; init; }` (line 9). The client echoes back the rowversion it last read; [UpdateConferenceCategoryHandler](#updateconferencecategoryhandler) stamps it as the entity's original token, so a concurrent edit fails loudly rather than silently overwriting. `[Rubric §9, API & Contract Design]` (assesses whether request contracts are explicit and version-safe): `required string Title` (line 12) forces the caller to supply the one field the aggregate cannot default, so a malformed request is rejected at model binding rather than deep inside the handler.
- **Walkthrough**: `RowVersion` (line 9, nullable, a first-time create or a client that opts out passes null); `Title` (line 12, `required`); `Sort` (line 15, an `int` display order that defaults to 0); `Type` (line 18, an optional discriminator whose doc comment gives "session" and "speaker" as examples). Every property is `get; init;`, so the request is immutable once bound.
- **Why it's built this way**: keeping the update payload separate from the create payload lets the two evolve independently: an update can demand a concurrency token, a create has nothing to concur with.
- **Where it's used**: bound by `ConferenceCategoriesController`, wrapped into [UpdateConferenceCategoryCommand](#updateconferencecategorycommand) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ConferenceCategoriesController.cs:110`), validated by [ConferenceCategoryUpdateRequestValidator](#conferencecategoryupdaterequestvalidator), and unpacked field by field into the domain `Update(...)` call.

---

### EventUpdateRequest

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Update/EventUpdateRequest.cs:7` · Level 1 · record

- **What it is**: the inbound payload for editing an existing conference event: the widest of the Conference update requests, covering identity, dates, venue, and the live-layer moderation default.
- **Depends on**: [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware) (line 7); the [QuestionModerationDefault](group-17-conference-domain.md#questionmoderationdefault) enum (line 40); `DateOnly` (BCL).
- **Concept introduced**: none new: the rowversion round trip is described under [ConferenceCategoryUpdateRequest](#conferencecategoryupdaterequest) and applies verbatim here (`RowVersion`, line 10). What this record adds is the split between `required` and optional fields. `[Rubric §9, API & Contract Design]`: `Name` (line 13), `StartDate` (line 19), `EndDate` (line 22), and `TimeZone` (line 25) are `required`, so the compiler and the model binder together guarantee an event can never be updated into a state with no name or no schedule; everything else is genuinely nullable.
- **Walkthrough**
  - Concurrency: `RowVersion` (line 10).
  - Identity: `Name` (line 13, required), `Description` (line 16, optional).
  - Schedule: `StartDate` / `EndDate` as `DateOnly` (lines 19, 22) and `TimeZone` (line 25), documented as an IANA time zone identifier. Storing the zone as a string next to date-only values is what lets the handler detect a zone change without reinterpreting stored times.
  - Integration and venue: `SessionizeCode` (line 28, the code the Sessionize import uses), `VenueAddress` (line 31), `VenueMapUrl` (line 34), `WiFiInfo` (line 37), all optional strings.
  - Live layer: `QuestionModerationDefault` (line 40), the BR-233 default applied to session questions.
- **Why it's built this way**: a record gives value equality and a compact immutable contract at no cost, and the flat property list maps one-to-one onto the ten arguments the `Event.Update(...)` domain method takes, so the handler stays a straight-line translation with nothing to interpret.
- **Where it's used**: bound by the Events controller, carried by [UpdateEventCommand](#updateeventcommand), checked by [EventUpdateRequestValidator](#eventupdaterequestvalidator), and applied by [UpdateEventHandler](#updateeventhandler).

---

### UpdateEventResult

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Update/UpdateEventCommand.cs:19` · Level 3 · record

- **What it is**: a two-member `sealed record` declared alongside its command in the same file, pairing the updated [EventDTO](group-17-conference-domain.md#eventdto) with a single advisory flag, `HasTimeZoneWarning`.
- **Depends on**: [EventDTO](group-17-conference-domain.md#eventdto).
- **Concept introduced: the warning-carrying result versus a hard failure.** Most Conference commands return `Result<TDTO>` directly (see [UpdateConferenceCategoryHandler](#updateconferencecategoryhandler)). The event update returns `Result<UpdateEventResult>` instead, so the [Result](group-01-result-error-handling.md#result) still models success versus failure while the wrapped record adds a non-fatal signal: the event's timezone was changed while sessions already exist (BR-131, documented at line 18). `[Rubric §9, API & Contract Design]`: separating a hard error (a failed `Result`) from a soft advisory (a `bool` on a successful payload) lets the UI warn ("this event has sessions; changing the timezone may misplace them") without blocking the save. `[Rubric §16, Maintainability]`: a dedicated result type leaves room for a second advisory flag later without changing the handler signature.
- **Walkthrough**: positional members `Event` and `HasTimeZoneWarning` (line 19). No behavior; it is a pure carrier, which is why it lives in the command file rather than earning its own.
- **Why it's built this way**: overloading the DTO with a transient UI concern would leak a request-scoped fact into a persisted shape, and an out parameter does not survive an async `Result` pipeline.
- **Where it's used**: constructed by [UpdateEventHandler](#updateeventhandler) at `.../Events/UseCases/Update/UpdateEventHandler.cs:67` and unwrapped by the Events controller.

---

### EventUpdateRequestValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Update/EventUpdateRequestValidator.cs:7` · Level 6 · class

- **What it is**: the FluentValidation validator for [EventUpdateRequest](#eventupdaterequest). It composes three reusable field-rule sets and adds one bespoke rule, so the create and update paths share a single definition of "a valid name / timezone / date range".
- **Depends on**: `AbstractValidator<T>` (FluentValidation, NuGet); the shared rule sets [EventNameRules<T>](#eventnamerulest), [EventTimeZoneRules<T>](#eventtimezonerulest), and [EventDateRangeRules<T>](#eventdaterangerulest); the [QuestionModerationDefault](group-17-conference-domain.md#questionmoderationdefault) enum.
- **Concept introduced: rule composition via FluentValidation `Include`.** `Include(ruleSet)` folds an entire rule set into this validator. Each set is generic over the request type and is constructed with property selectors, so the same rules bind to whichever record is being validated: `new EventNameRules<EventUpdateRequest>(p => p.Name)` (line 11), `new EventTimeZoneRules<EventUpdateRequest>(p => p.TimeZone)` (line 12), and `new EventDateRangeRules<EventUpdateRequest>(p => p.StartDate, p => p.EndDate)` (line 13, taking two selectors because the rule spans two properties). `[Rubric §1, SOLID]`: a name-length or timezone rule changes in exactly one place and both the create and update slices follow. `[Rubric §15, Best Practices & Code Quality]`: the one inline rule, `RuleFor(x => x.QuestionModerationDefault).IsInEnum()` (lines 15-18), attaches both a human message and a stable machine-readable `WithErrorCode("Event.QuestionModerationDefault.Invalid")`, so clients can branch on the code rather than on prose.
- **Walkthrough**: a `sealed class : AbstractValidator<EventUpdateRequest>` (line 7) whose parameterless constructor (line 9) does all the wiring: three `Include` calls, then the enum guard. Nothing else is declared.
- **Why it's built this way**: validators are discovered by assembly scanning and executed by the validating decorator in the CQRS pipeline before the transaction opens (see [group-05](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)), so no handler carries validation boilerplate and no command can skip the gate.
- **Where it's used**: resolved and run by the validating decorator ahead of [UpdateEventHandler](#updateeventhandler).

---

### UpdateConferenceCategoryCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/Update/UpdateConferenceCategoryCommand.cs:9` · Level 6 · record

- **What it is**: the CQRS command message for the category update slice: a positional `sealed record` pairing the target `Id` with the update `Request`, which also declares what cache it invalidates.
- **Depends on**: [ICommandWithRequest<out TRequest>](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest) and [ICacheInvalidating](group-05-cqrs-pipeline.md#icacheinvalidating) (both Level 0, both implemented at line 9); [ConferenceCategoryUpdateRequest](#conferencecategoryupdaterequest); the `ConferenceCategoryIdentifierType` alias; the [Category](group-17-conference-domain.md#category) domain entity, referenced only inside `CachePrefix`.
- **Concept introduced: `ICacheInvalidating` on a write command.** Implementing [ICacheInvalidating](group-05-cqrs-pipeline.md#icacheinvalidating) tells the caching decorator to evict every cached read whose key starts with the returned prefix once the command succeeds, so a stale category is not served after an edit. The prefix is derived from the type itself, `$"{typeof(Category).FullName}:"` (line 12), rather than hand-typed, so a namespace rename cannot silently break invalidation. Note the deliberate naming split: the command and request are named `ConferenceCategory...` (the module-level vocabulary, disambiguating from other modules' categories) while the domain entity is plain `Category`. `[Rubric §6, CQRS & Event-Driven]`: the command is a thin intent message with no logic, keeping the write side declarative. `[Rubric §12, Performance & Scalability]`: read caching stays correct because every mutation self-declares what it invalidates instead of relying on a TTL to expire.
- **Walkthrough**: the record header carries the two positional members and the two interfaces; the body is a single expression-bodied `CachePrefix` property (lines 11-12). No other members.
- **Why it's built this way**: pairing an id with a request DTO is the standard `ICommandWithRequest<TRequest>` shape used across every module, so the command plugs into the shared handler pipeline with zero special casing.
- **Where it's used**: constructed by `ConferenceCategoriesController` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ConferenceCategoriesController.cs:110`) and dispatched to [UpdateConferenceCategoryHandler](#updateconferencecategoryhandler) through the decorator pipeline.

---

### UpdateEventCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Update/UpdateEventCommand.cs:10` · Level 6 · record

- **What it is**: the CQRS command for the event update slice, structurally identical to [UpdateConferenceCategoryCommand](#updateconferencecategorycommand): `sealed record UpdateEventCommand(EventIdentifierType Id, EventUpdateRequest Request)` implementing [ICommandWithRequest<out TRequest>](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest) and [ICacheInvalidating](group-05-cqrs-pipeline.md#icacheinvalidating) (line 10).
- **Depends on**: [EventUpdateRequest](#eventupdaterequest); the `EventIdentifierType` alias; the [Event](group-17-conference-domain.md#event) domain entity (only for the cache prefix).
- **Concept introduced**: none new: see the `ICacheInvalidating` discussion under [UpdateConferenceCategoryCommand](#updateconferencecategorycommand). `CachePrefix` returns `$"{typeof(Event).FullName}:"` (line 13).
- **Walkthrough**: two positional members plus the expression-bodied `CachePrefix` (lines 12-13). Note that [UpdateEventResult](#updateeventresult) is declared in the same file at line 19; the two live together because the result exists only to serve this command.
- **Why it's built this way**: the command carries no logic so that the pipeline (logging, caching, validating, transactional decorators) is the only thing between the controller and the handler, and every write slice behaves the same way.
- **Where it's used**: created by the Events controller and dispatched to [UpdateEventHandler](#updateeventhandler).

---

### ConferenceCategoryUpdateRequestValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/Update/ConferenceCategoryUpdateRequestValidator.cs:7` · Level 7 · class

- **What it is**: the smallest validator in this unit: it validates [ConferenceCategoryUpdateRequest](#conferencecategoryupdaterequest) by including one shared rule set and nothing else.
- **Depends on**: `AbstractValidator<T>` (FluentValidation); [ConferenceCategoryTitleRules<T>](#conferencecategorytitlerulest).
- **Concept introduced**: none new: rule composition via `Include` is taught under [EventUpdateRequestValidator](#eventupdaterequestvalidator). This class is the minimal expression of it, and it shows why the pattern pays off: the entire body is `=> Include(new ConferenceCategoryTitleRules<ConferenceCategoryUpdateRequest>(p => p.Title));` (lines 9-10), an expression-bodied constructor. The title rules themselves live once and are shared with the create request.
- **Walkthrough**: `sealed class : AbstractValidator<ConferenceCategoryUpdateRequest>` (line 7) with a single expression-bodied constructor (line 9). `Sort` and `Type` carry no validation rules here: `Sort` is an `int` with no constrained range, and `Type` is a free-form optional string.
- **Why it's built this way**: even a one-rule validator is worth its own class, because the pipeline discovers validators by type and a slice with no validator would silently skip the gate. Making the file trivial is the point: nothing here can drift from the create path.
- **Where it's used**: run by the validating decorator ahead of [UpdateConferenceCategoryHandler](#updateconferencecategoryhandler).
- **Caveats / not-in-source**: whether `Sort` or `Type` are constrained further downstream is not visible from this file; the domain `Category.Update` only re-checks the title (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/Category.cs:86-87`).

---

### GetSessionBookmarkCountsHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCounts` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionBookmarkCounts/GetSessionBookmarkCountsHandler.cs:17` · Level 8 · class

- **What it is**: the read handler for [GetSessionBookmarkCountsQuery](#getsessionbookmarkcountsquery). It re-verifies server side that each requested session really belongs to the calling speaker, then delegates the actual counting to the Engagement module in one batched call, returning a map of session id to count.
- **Depends on**: [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (line 20); [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (line 18); [IBookmarkCountService](group-22-engagement-module.md#ibookmarkcountservice) (line 19); the [Session](group-17-conference-domain.md#session) and [SessionSpeaker](group-17-conference-domain.md#sessionspeaker) domain entities; [Result](group-01-result-error-handling.md#result).
- **Concept introduced: never trust the client's id list, and cross-module reads through an interface.** Two ideas meet in this handler.
  - *Server-side re-authorization.* The query arrives with a list of session ids the client claims are the speaker's. The handler loads those sessions with their `SessionSpeakers` navigation included (lines 34-38) and keeps only the ones where `s.SessionSpeakers.Any(ss => ss.SpeakerId == query.SpeakerId && !ss.IsDeleted)` (lines 43-46). A foreign or stale id is silently dropped rather than failing the batch (comment at lines 40-42), so one bad id never denies a speaker the counts for their legitimate sessions. `[Rubric §11, Security]` (assesses whether authorization is enforced at the server on data the client cannot forge): the ownership check reads the join table, and the `!ss.IsDeleted` clause means a soft-deleted assignment no longer confers access.
  - *Cross-module call through a `Shared` interface.* Bookmarks are owned by the Engagement module, so Conference never touches Engagement entities. It depends on [IBookmarkCountService](group-22-engagement-module.md#ibookmarkcountservice), declared in `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/UserSessionBookmarks/IBookmarkCountService.cs:8`, and calls `GetBookmarkCountsForSessionsAsync` (lines 54-56), the batch method whose contract promises every requested id is present in the result with 0 for sessions that have none (`IBookmarkCountService.cs:19-27`). In the deployed topology that interface is satisfied by a gRPC client, so the batching directly reduces network hops. `[Rubric §7, Microservices Readiness]`: the module boundary is an interface in a `Shared` project, which is exactly what makes the in-process and the gRPC implementations interchangeable.
- **Walkthrough**
  - **Empty-input short circuit** (lines 27-31): an empty `SessionIds` returns an empty dictionary without touching the database.
  - **Load with the join** (lines 33-38): `unitOfWork.GetReadRepository<Session, SessionIdentifierType>()` then `GetAllAsync` with `includes: [nameof(Session.SessionSpeakers)]`, a `where` of `query.SessionIds.Contains(s.Id)` (one `IN` query, not N lookups) and `asTracking: false`. The read repository expresses query-only intent and keeps the change tracker clean.
  - **Filter to owned sessions** (lines 43-46), then a second short circuit if nothing survived (lines 48-52), which avoids a pointless cross-module round trip.
  - **Delegate and return** (lines 54-58): the batched count call, wrapped in `Result.Success(counts)`.
- **Why it's built this way**: counting bookmarks inside Conference would require Conference to read Engagement's tables, breaking database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). Routing through the interface keeps each module the sole owner of its data while still letting a speaker see one merged view.
- **Where it's used**: injected into `SpeakersController` as `IQueryHandler<GetSessionBookmarkCountsQuery, Result<IReadOnlyDictionary<SessionIdentifierType, int>>>` (`.../MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:51`) and invoked at line 291 of that file.

---

### GetSessionFeedbackHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionFeedback` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionFeedback/GetSessionFeedbackHandler.cs:15` · Level 8 · class

- **What it is**: the read handler that turns raw session question answers into a speaker-facing feedback summary: numeric questions become an average plus a response count, everything else becomes a list of text responses. It refuses the request outright if the caller is not assigned to the session.
- **Depends on**: [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (line 16); [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (line 16); the [Session](group-17-conference-domain.md#session), [SessionQuestionAnswer](group-17-conference-domain.md#sessionquestionanswer), and [Question](group-17-conference-domain.md#question) domain entities; [SessionFeedbackDTO](group-17-conference-domain.md#sessionfeedbackdto) with [RatingQuestionSummary](group-17-conference-domain.md#ratingquestionsummary) and [TextQuestionResponses](group-17-conference-domain.md#textquestionresponses); [Error](group-01-result-error-handling.md#error) and [Result](group-01-result-error-handling.md#result); `CultureInfo` / `NumberStyles` (BCL).
- **Concept introduced: in-memory aggregation over an eagerly loaded aggregate, and `Error.Forbidden` as a first-class outcome.**
  - *Authorization as a typed error.* If the session exists but the caller is not among its non-deleted speakers (line 33), the handler returns `Error.Forbidden(code: "Speaker.NotAssigned", ...)` (lines 35-40) rather than throwing or returning an empty payload. A missing session returns `Error.NotFound` instead (lines 29-30). `[Rubric §11, Security]`: the two distinct outcomes let the API answer 403 versus 404 precisely; `[Rubric §9, API & Contract Design]`: the stable `code` string is what a client branches on.
  - *Aggregation in the application layer.* The answers are already attached to the loaded session (`includes` at line 26) and, as the comment at line 42 notes, EF's global query filters have already excluded soft-deleted rows, so the grouping runs in memory over a bounded set rather than as extra SQL. `[Rubric §12, Performance & Scalability]`: the second query is deliberately narrowed to just the questions that actually have answers (lines 56-62), so an event with hundreds of questions does not drag them all into memory to summarize one session.
- **Walkthrough**
  - **Load the session with what it needs** (lines 23-28): `GetRepository<Session, SessionIdentifierType>()` then `GetByIdAsync` with `includes: [nameof(Session.SessionSpeakers), nameof(Session.SessionQuestionAnswers)]` and `asTracking: false`. Null gives `Error.NotFound` (lines 29-30).
  - **Ownership check** (lines 33-40), described above.
  - **Empty-answer fast path** (lines 44-53): with no answers it returns a well-formed `SessionFeedbackDTO` carrying the session id and title and two empty collections, so the caller never has to special-case null.
  - **Question lookup** (lines 56-63): the distinct `QuestionId` values become a `HashSet`, one `GetAllAsync` fetches exactly those questions, and `ToDictionary` builds the lookup.
  - **Group and summarize** (lines 68-101): answers are grouped by `QuestionId`; a group whose question is missing from the lookup is skipped (lines 70-71). When `question.QuestionType == "Rating"` (line 73) the answer values are parsed with `int.TryParse(..., NumberStyles.Integer, CultureInfo.InvariantCulture, ...)` (line 76), unparseable values are dropped, and a [RatingQuestionSummary](group-17-conference-domain.md#ratingquestionsummary) with `AverageRating` and `ResponseCount` is emitted only if at least one value parsed (lines 81-90). Every other question type becomes a [TextQuestionResponses](group-17-conference-domain.md#textquestionresponses) carrying the raw strings (lines 94-99).
  - **Return** (lines 103-109): a `SessionFeedbackDTO` with the two lists.
- **Why it's built this way**: parsing with `CultureInfo.InvariantCulture` matters because the answer value is stored as a free-form string; a culture-sensitive parse would behave differently per server locale. Tolerating unparseable ratings instead of failing keeps one malformed historical answer from blanking a speaker's whole feedback page.
- **Where it's used**: injected into `SpeakersController` (`.../MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:49`) and invoked at line 252 of that file.
- **Caveats / not-in-source**: the rating question type is matched against the literal string `"Rating"` (line 73). `Question.QuestionType` is a `string`, so the set of valid type values is not enforced by this file; a typo in stored data would be summarized as a text question instead.

---

### GetSpeakersByEventFilterHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSpeakersByEventFilter` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSpeakersByEventFilter/GetSpeakersByEventFilterHandler.cs:19` · Level 8 · class

- **What it is**: the handler that resolves "which speakers belong to this event" into a reusable filter. It collects the speaker ids linked directly to the event and those reachable through the event's sessions, unions them, and returns a `Speaker.Id IN (...)` specification.
- **Depends on**: [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (line 21); [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (line 20); the [EventSpeaker](group-17-conference-domain.md#eventspeaker), [Session](group-17-conference-domain.md#session), [SessionSpeaker](group-17-conference-domain.md#sessionspeaker), and [Speaker](group-17-conference-domain.md#speaker) domain entities; [Specification<TEntity, TIdentifierType>](group-03-querying-specifications.md#specificationtentity-tidentifiertype) and [InlineSpecification<TEntity, TIdentifierType>](group-03-querying-specifications.md#inlinespecificationtentity-tidentifiertype); [Result](group-01-result-error-handling.md#result).
- **Concept introduced: ID-list projection instead of a navigation join.** Rather than writing one LINQ expression that walks `Speaker -> SessionSpeaker -> Session -> Event`, the handler issues separate projection queries and combines their results in memory. Each uses `GetProjectedAsync(selector, predicate, asTracking: false, cancellationToken)` on a read repository, which returns just the selected column instead of whole entities. The class comment (lines 11-18) gives the rationale: the ID-list shape mirrors the framework's cross-source specification helper (BR-132 precedent), no navigation join is required, so the criteria stays translatable on any engine, and the [Speaker](group-17-conference-domain.md#speaker) aggregate keeps a by-ID boundary to the Event and Session aggregates. `[Rubric §4, DDD]`: aggregates reference each other by identifier, never by object graph, and this handler honors that even while answering a cross-aggregate question. `[Rubric §8, Data Architecture]`: engine-portable criteria matter because the framework supports more than one provider ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)), and a provider-specific join expression would not survive the move.
- **Walkthrough**
  - **Direct links** (lines 28-31): project `SpeakerId` from `EventSpeaker` where `EventId` matches. These rows are written by the Sessionize sync.
  - **The event's sessions** (lines 33-36): project `Id` from `Session` where `EventId` matches.
  - **Transitive links** (lines 38-48): only if there are sessions. The session id collection is materialized once into a list (line 42) with the explicit comment that this embeds a stable collection EF can translate into an `IN` clause; then `SessionSpeaker.SpeakerId` is projected where `sessionIdList.Contains(ss.SessionId)`. These rows come from organizer session management, a different flow from the Sessionize sync, which is exactly why both paths must be checked.
  - **Union** (line 50): `eventSpeakerIds.Concat(sessionSpeakerIds).Distinct()` collected into an `IReadOnlyList<SpeakerIdentifierType>`.
  - **Build the filter** (lines 52-53): `Result.Success<Specification<Speaker, SpeakerIdentifierType>>(new InlineSpecification<Speaker, SpeakerIdentifierType>(s => speakerIds.Contains(s.Id)))`. The captured local list becomes the `IN` list when the caller composes and executes the specification.
- **Why it's built this way**: `Speaker` has no `EventId` column, so membership is a union of two join tables. Returning a specification instead of a page of speakers lets the calling endpoint keep its generic paging, sorting, and projection machinery and simply add this criterion. The cost is three small projection queries up front, paid once per request.
- **Where it's used**: injected into `SpeakersController` (`.../MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:52`) and invoked at line 99, where the returned specification is composed into the speaker list query.
- **Caveats / not-in-source**: the handler does not verify that the event exists; a nonexistent `EventId` simply yields an empty id list and therefore a specification that matches no speakers.

---

### UpdateConferenceCategoryHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/Update/UpdateConferenceCategoryHandler.cs:15` · Level 8 · class (sealed partial)

- **What it is**: the command handler for [UpdateConferenceCategoryCommand](#updateconferencecategorycommand). It is the clearest example of the canonical update shape in this module: load, stamp the concurrency token, delegate to the domain, save, log, map.
- **Depends on**: [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) (line 18); [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (line 16); [ConferenceCategoryDTOMapper](#conferencecategorydtomapper) (line 17); `ILogger<T>` (Microsoft.Extensions.Logging); the [Category](group-17-conference-domain.md#category) domain entity; [Error](group-01-result-error-handling.md#error) / [Result](group-01-result-error-handling.md#result); [ConferenceCategoryDTO](group-17-conference-domain.md#conferencecategorydto).
- **Concept introduced: optimistic concurrency stamping, and delegation to the domain.**
  - *Concurrency stamp.* After loading, the handler calls `repository.SetOriginalRowVersion(entity, command.Request.RowVersion)` (line 32). The comment (lines 30-31) states the intent exactly: this stamps the client's last-seen token so a concurrent edit surfaces as a `DbUpdateConcurrencyException` mapped to HTTP 409, instead of silent last-write-wins. `[Rubric §8, Data Architecture]`: correctness under concurrent edits is enforced at the persistence boundary rather than by hopeful convention.
  - *Domain delegation.* The handler does not assign properties. It calls `entity.Update(Title, Sort, Type)` (lines 34-37), which returns a [Result](group-01-result-error-handling.md#result); on failure the errors are propagated unchanged (lines 39-40). The entity, not the handler, owns its invariants: `Category.Update` re-checks the title through `CategoryInvariants.EnsureTitleIsValid` and raises a `CategoryChanged` domain event (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/Category.cs:84-95`). `[Rubric §3, Clean Architecture]`: the application layer orchestrates persistence while the domain layer decides what a valid category is.
  - *Structured logging without allocation.* The class is `partial` so the source generator can emit `LogConferenceCategoryUpdated` from the `[LoggerMessage]` declaration (lines 49-50), invoked at line 44. `[Rubric §13, Observability & Operability]`: every successful update is recorded with a strongly typed `CategoryId` property that a log query can filter on, with no interpolated-string cost when the level is disabled.
- **Walkthrough**: primary-constructor dependencies (lines 15-18); `GetRepository<Category, ConferenceCategoryIdentifierType>()` and `GetByIdAsync` (lines 25-26); null gives `Error.NotFound.WithSource(nameof(UpdateConferenceCategoryHandler)).WithTarget(nameof(Category))` (lines 27-28); concurrency stamp (line 32); domain `Update` plus failure propagation (lines 34-40); `await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false)` (line 42); log (line 44); `Result.Success(dtoMapper.MapToDTO(entity))` (line 46). Note that validation is absent from this method by design: it already ran in the pipeline decorator.
- **Why it's built this way**: the handler is deliberately thin. Everything that is not orchestration (validation, caching, transactions, logging of the request) is a decorator concern, and everything that is a business rule belongs to the entity. What remains is the six-step skeleton every update handler in the module shares.
- **Where it's used**: registered by assembly scanning and resolved by `ConferenceCategoriesController` through the command decorator pipeline.

---

### UpdateEventHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Update/UpdateEventHandler.cs:16` · Level 8 · class (sealed partial)

- **What it is**: the handler for [UpdateEventCommand](#updateeventcommand). It follows the same skeleton as [UpdateConferenceCategoryHandler](#updateconferencecategoryhandler) and adds one thing: a cross-aggregate probe that detects a timezone change on an event that already has sessions (BR-131), reported as an advisory flag on [UpdateEventResult](#updateeventresult) rather than as a failure.
- **Depends on**: [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) (line 19); [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (line 17); [EventDTOMapper](#eventdtomapper) (line 18); `ILogger<T>`; the [Event](group-17-conference-domain.md#event) and [Session](group-17-conference-domain.md#session) domain entities; [Error](group-01-result-error-handling.md#error) / [Result](group-01-result-error-handling.md#result).
- **Concept introduced: the soft business rule computed across aggregates.** BR-131 is not an invariant; changing an event's timezone is legal. But if sessions already exist, their displayed times shift, and the organizer deserves a warning. The `Event` aggregate cannot see its sessions, so the check lives here: the handler first compares the stored zone to the requested one with `!string.Equals(entity.TimeZone, command.Request.TimeZone, StringComparison.Ordinal)` (line 36) and only if it actually changed does it ask a `Session` repository `ExistsAsync(s => s.EventId == command.Id, ...)` (lines 41-44). The guard order matters: the common case (no zone change) costs zero extra queries, and `ExistsAsync` compiles to an existence check rather than materializing sessions. `[Rubric §4, DDD]`: a rule that spans two aggregates is enforced in the application layer, which is the only place both are visible. `[Rubric §12, Performance & Scalability]`: the conditional existence probe keeps the added cost off the normal path.
- **Walkthrough**
  - **Load and guard** (lines 26-29): `GetRepository<Event, EventIdentifierType>()`, `GetByIdAsync`, then `Error.NotFound.WithSource(nameof(UpdateEventHandler)).WithTarget(nameof(Event))` when the event is missing.
  - **Concurrency stamp** (line 33), identical in intent to the category handler.
  - **BR-131 detection** (lines 35-46): the ordinal comparison, the conditional existence query, and the resulting `hasTimeZoneWarning` bool, which is advisory and never turns into a failure.
  - **Domain delegation** (lines 48-58): `entity.Update(Name, Description, StartDate, EndDate, TimeZone, SessionizeCode, VenueAddress, VenueMapUrl, WiFiInfo, QuestionModerationDefault)`, ten arguments mapping one-to-one onto [EventUpdateRequest](#eventupdaterequest). A failed `Result` is propagated with `Result.Failure<UpdateEventResult>(result.Errors)` (lines 60-61).
  - **Persist, log, wrap** (lines 63-67): `SaveChangesAsync`, the generated `LogEventUpdated` (declared at lines 70-71), then `Result.Success(new UpdateEventResult(dtoMapper.MapToDTO(entity), hasTimeZoneWarning))`.
- **Why it's built this way**: the handler orchestrates the lookups the entity cannot perform (does this event have sessions?) while the entity keeps sole responsibility for validating and mutating its own state. Returning the warning inside a successful `Result` rather than as an error keeps the decision with the organizer: the API can prompt for confirmation without the save having been rejected. Ordinal string comparison is used because a timezone identifier is an opaque key, not human text to be compared culturally.
- **Where it's used**: registered by assembly scanning and resolved by the Events controller through the command decorator pipeline; its result is unwrapped into the HTTP response along with the timezone warning.

### QuestionUpdateRequest

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Update/QuestionUpdateRequest.cs:6` · Level 1 · record

- **What it is** - the request DTO the API binds a question-edit form into before it becomes an [`UpdateQuestionCommand`](#updatequestioncommand). A plain `record class` of immutable `init` properties describing every editable question field plus the optimistic-concurrency token.
- **Depends on** - [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) (the one-property contract that surfaces the `RowVersion` token). No first-party field types beyond BCL primitives.
- **Concept introduced - the request/command split.** A *request* is the wire-shaped payload a controller model-binds and a validator checks; a *command* is the internal CQRS message a handler runs. Keeping them separate means the transport contract (`QuestionUpdateRequest`) can carry presentation concerns like `RowVersion` and nullable optionals, while [`UpdateQuestionCommand`](#updatequestioncommand) stays a thin envelope pairing the target `Id` with this request. `[Rubric §9 - API & Contract Design]` (§9 assesses whether public contracts are explicit and versioned; this DTO *is* the public edit contract, immutable and documented per-field). `[Rubric §8 - Data Architecture]` (§8 assesses persistence and concurrency strategy; the `RowVersion` byte array round-trips the EF rowversion token so a stale edit is caught rather than silently overwriting).
- **Walkthrough** - `RowVersion` (`QuestionUpdateRequest.cs:9`) is the nullable `byte[]?` optimistic-concurrency token the client echoes back from its last read, satisfying `IConcurrencyAware`. `QuestionText`, `QuestionEntity`, and `QuestionType` (`:12`, `:15`, `:18`) are `required string`, so the model binder cannot construct the request without them, which is why [`QuestionUpdateRequestValidator`](#questionupdaterequestvalidator) only needs to police length, not presence. `QuestionEntity` names the target aggregate ("Session" or "Event") and `QuestionType` the input kind ("Rating", "Text", "Email"); both are immutable once answers exist (BR-137), a rule the handler enforces rather than the request. `Sort` (`:21`) is the display order `int` and `IsRequired` (`:24`) the answer-required flag.
- **Why it's built this way** - `required init` gives an immutable, fully-constructed payload with no partially-populated intermediate state; the per-field XML docs double as OpenAPI descriptions. Manual DTO shaping over reflection-magic mapping follows [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html).
- **Where it's used** - validated by [`QuestionUpdateRequestValidator`](#questionupdaterequestvalidator), wrapped by [`UpdateQuestionCommand`](#updatequestioncommand), and unpacked field-by-field by [`UpdateQuestionHandler`](#updatequestionhandler).

### SessionUpdateRequest

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Update/SessionUpdateRequest.cs:6` · Level 1 · record

- **What it is** - the request DTO for editing a conference session: the widest of the three update requests in this unit, carrying scheduling, status, streaming, and room-assignment fields plus the concurrency token.
- **Depends on** - [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware), and the module aliases `EventIdentifierType` (the required parent-event id) and `RoomIdentifierType?` (the optional assigned room).
- **Concept reinforced - the request/command split.** Same shape introduced by [`QuestionUpdateRequest`](#questionupdaterequest): an immutable `record class : IConcurrencyAware` that a controller binds and a validator checks before it is wrapped in [`UpdateSessionCommand`](#updatesessioncommand). `[Rubric §9 - API & Contract Design]` and `[Rubric §8 - Data Architecture]` as with the question request.
- **Walkthrough** - `RowVersion` (`SessionUpdateRequest.cs:9`) is the concurrency token. `EventId` (`:12`) is `required` and its doc records BR-140: it must equal the session's current `EventId` because a session cannot move between events (the handler rejects a mismatch). `Title` (`:15`) is the only `required string`; the rest are optionals. `Description` (`:18`), `StartsAt` / `EndsAt` (`:21`, `:24`, nullable `DateTime`), `Status` (`:27`), `LiveUrl` / `RecordingUrl` (`:42`, `:45`), `AccessibilityInfo` (`:48`), and `ResourceLinks` (`:51`) are nullable strings and times. Four booleans (`:30`-`:39`) capture the session lifecycle and kind: `IsInformed`, `IsConfirmed`, `IsServiceSession`, `IsPlenumSession`. `RoomId` (`:54`) is the nullable room assignment the handler cross-checks against the parent event (BR-130).
- **Why it's built this way** - the wide optional surface lets one request serve every partial edit an organizer makes; keeping `EventId` `required` but immutable means the request still round-trips the value for the handler's guard without inviting a re-parent.
- **Where it's used** - validated by [`SessionUpdateRequestValidator`](#sessionupdaterequestvalidator), wrapped by [`UpdateSessionCommand`](#updatesessioncommand), and consumed field-by-field by [`UpdateSessionHandler`](#updatesessionhandler).

### SpeakerUpdateRequest

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Update/SpeakerUpdateRequest.cs:6` · Level 1 · record

- **What it is** - the request DTO the API binds a speaker-edit form into before it becomes an [`UpdateSpeakerCommand`](#updatespeakercommand): the editable speaker fields (name, bio, social links) plus the concurrency token and an optional linked-user id.
- **Depends on** - [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware), and the module alias `UserIdentifierType?` (the optional linked-user id).
- **Concept reinforced - the request/command split.** Same immutable `record class : IConcurrencyAware` shape as [`QuestionUpdateRequest`](#questionupdaterequest); the transport DTO carries `RowVersion` and nullable optionals while [`UpdateSpeakerCommand`](#updatespeakercommand) stays a thin envelope. `[Rubric §9 - API & Contract Design]` and `[Rubric §8 - Data Architecture]`.
- **Walkthrough** - `RowVersion` (`SpeakerUpdateRequest.cs:9`) is the concurrency token. `FirstName` / `LastName` (`:12`, `:15`) are `required string`, so [`SpeakerUpdateRequestValidator`](#speakerupdaterequestvalidator) only checks length. `Email`, `Bio`, `TagLine`, `ProfilePicture`, `TwitterHandle` (`:18`, `:21`, `:24`, `:27`, `:33`) are nullable optionals, as are the three social URLs `LinkedInUrl` / `GitHubUrl` / `WebsiteUrl` (`:36`, `:39`, `:42`) kept as plain `string?` because the Sessionize import stores them as raw strings. `IsTopSpeaker` (`:30`) is the featured-speaker curation flag and `LinkedUserId` (`:45`) optionally ties the speaker to an Identity `User`; both are organizer-only fields that [`UpdateSpeakerHandler`](#updatespeakerhandler) ignores on a self-edit.
- **Why it's built this way** - `required init` gives an immutable, fully-constructed payload; the per-field XML docs double as OpenAPI descriptions. The URLs stay `string` deliberately so the import's raw values round-trip without a `Uri` parse. Manual DTO shaping follows [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html).
- **Caveats / not-in-source** - the current file carries no `[SuppressMessage]` analyzer attributes on the `byte[]` or URL properties; an earlier edition of this section described such suppressions, which no longer exist in source.
- **Where it's used** - validated by [`SpeakerUpdateRequestValidator`](#speakerupdaterequestvalidator), wrapped by [`UpdateSpeakerCommand`](#updatespeakercommand), and unpacked field-by-field by [`UpdateSpeakerHandler`](#updatespeakerhandler).

### RoomChangedHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.DomainEventHandlers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/DomainEventHandlers/RoomChangedHandler.cs:11` · Level 3 · class

- **What it is** - an `IDomainEventHandler<RoomChanged>` that reacts to a room being added, updated, or deleted by writing a single structured log line. The lightest possible domain-event handler: no state check, no side effect beyond observability.
- **Depends on** - [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent), [`RoomChanged`](group-17-conference-domain.md#roomchanged), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), and `ILogger<T>` (BCL).
- **Concept introduced - the in-process domain-event handler.** When an aggregate calls `AddDomainEvent(...)`, the event sits in the aggregate's list until `SaveChangesAsync` commits, then the `DomainEventDispatcher` (see [Group 04](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent)) fans it out to every registered `IDomainEventHandler<T>`. The aggregate never knows who listens; Scrutor discovers handlers by scanning the Application assembly. `[Rubric §6 - CQRS & Event-Driven]` (§6 assesses whether state changes are announced as events and consumed by decoupled handlers rather than leaked as inline side effects, which is exactly this shape). `[Rubric §13 - Observability]` (§13 assesses operability signals; the handler exists purely to emit a compile-time-generated, allocation-light log record).
- **Walkthrough** - the primary constructor (`RoomChangedHandler.cs:11`) injects only `ILogger<RoomChangedHandler>`. `HandleAsync` (`:15`) forwards the event's `State`, `EventId`, `RoomId`, and `RoomName` to the source-generated `LogRoomChanged` (`:17`) and returns `Task.CompletedTask` (`:18`) since there is no async work. `LogRoomChanged` (`:21`-`:22`) is a `[LoggerMessage]` `static partial void` whose template embeds `{State}` so one log line covers add/update/delete.
- **Why it's built this way** - a `sealed partial class` plus `[LoggerMessage]` gives a strongly-typed, zero-boxing log path; keeping the handler side-effect-free means it can never fail the surrounding transaction.
- **Where it's used** - auto-registered by Scrutor's Application-assembly scan; fired by the `DomainEventDispatcher` whenever an `Event` aggregate raises [`RoomChanged`](group-17-conference-domain.md#roomchanged).

### UpdateSessionResult

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Update/UpdateSessionCommand.cs:19` · Level 3 · record

- **What it is** - a small result wrapper that pairs the updated [`SessionDTO`](group-17-conference-domain.md#sessiondto) with a `bool HasDateRangeWarning` flag, so the session update can succeed while still telling the caller the new times fall outside the event's dates (BR-86).
- **Depends on** - [`SessionDTO`](group-17-conference-domain.md#sessiondto).
- **Concept introduced - the soft-warning result.** A command normally returns just the mapped DTO, but some business rules are advisory rather than blocking: BR-86 says a session scheduled outside its event's date range is *allowed* but flagged. Rather than fail the command or invent an out-of-band channel, [`UpdateSessionHandler`](#updatesessionhandler) returns this two-field record so the API can surface the warning in the response body without a non-2xx status. `[Rubric §9 - API & Contract Design]` (§9 assesses contract expressiveness; a typed result carries the advisory signal instead of overloading the status code). `[Rubric §24 - Forms/Validation/UX Safety]` (§24 assesses validation UX; a non-blocking warning lets the organizer confirm an intentional out-of-range time).
- **Walkthrough** - the positional record (`UpdateSessionCommand.cs:19`) declares `SessionDTO Session` and `bool HasDateRangeWarning`. It lives in the same file as [`UpdateSessionCommand`](#updatesessioncommand) because the two are the input/output pair of one use case.
- **Where it's used** - constructed only by [`UpdateSessionHandler`](#updatesessionhandler) at the end of a successful update and returned inside a [`Result`](group-01-result-error-handling.md#result)`<UpdateSessionResult>`.

### SessionCreatedHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.DomainEventHandlers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/DomainEventHandlers/SessionCreatedHandler.cs:11` · Level 4 · class

- **What it is** - an `IDomainEventHandler<SessionChanged>` that logs session *creation* only. It shows the common pattern where one event type carries a `State` and a handler routes on it.
- **Depends on** - [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent), [`SessionChanged`](group-17-conference-domain.md#sessionchanged), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), and `ILogger<T>` (BCL).
- **Concept reinforced - state-routed event handling.** [`SessionChanged`](group-17-conference-domain.md#sessionchanged) is a single event raised for adds, updates, and deletes; a handler that only cares about one transition guards on `State` and returns early otherwise. This keeps the event vocabulary small (one event per aggregate) while still letting handlers specialize. `[Rubric §6 - CQRS & Event-Driven]` and `[Rubric §13 - Observability]` as with [`RoomChangedHandler`](#roomchangedhandler).
- **Walkthrough** - `HandleAsync` (`SessionCreatedHandler.cs:15`) first checks `domainEvent.State != DomainEntityState.Added` and bails with `Task.CompletedTask` (`:17`-`:18`) for updates and deletes. Only for an `Added` transition does it call `LogSessionCreated` with `SessionId`, `Title`, `EventId` (`:20`). `LogSessionCreated` (`:24`-`:25`) is the `[LoggerMessage]` generated method.
- **Why it's built this way** - routing on `State` inside one handler avoids proliferating near-identical handler types while keeping each concern's logic isolated to its branch.
- **Where it's used** - discovered by the Scrutor scan; invoked by the `DomainEventDispatcher` on every [`SessionChanged`](group-17-conference-domain.md#sessionchanged), acting only when the session was just created.

### SpeakerDeletedHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.DomainEventHandlers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DomainEventHandlers/SpeakerDeletedHandler.cs:20` · Level 4 · class

- **What it is** - the one handler in this unit that does real work: on a speaker soft-delete it logs the deletion **and** publishes a [`SpeakerUnlinkedFromUser`](group-17-conference-domain.md#speakerunlinkedfromuser) integration event so the Identity module can clear the previously linked user's `LinkedSpeakerId` (BR-70). This is a domain event translating into a cross-service integration event.
- **Depends on** - [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent), [`SpeakerChanged`](group-17-conference-domain.md#speakerchanged), [`SpeakerUnlinkedFromUser`](group-17-conference-domain.md#speakerunlinkedfromuser), [`IIntegrationEventPublisher`](group-04-events-outbox.md#iintegrationeventpublisher), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), plus `IServiceScopeFactory` and `ILogger<T>` (BCL).
- **Concept introduced - bridging a domain event to an integration event across a service boundary.** A domain event is in-process and lives inside one aggregate's transaction; an integration event is the durable, broker-carried message other services consume. This handler is the bridge: the Conference-side `Speaker.Delete()` already cleared its own `LinkedUserId`, and the handler tells Identity to do the symmetric cleanup asynchronously. `[Rubric §7 - Microservices Readiness]` (§7 assesses whether cross-module coupling is broker-mediated rather than a direct call; the class doc, `SpeakerDeletedHandler.cs:14`-`:18`, records replacing a former in-process `IUserSpeakerLinkService.ClearLinkedSpeakerAsync` call with an eventually-consistent message). `[Rubric §6 - CQRS & Event-Driven]` and `[Rubric §29 - Resilience]` (§29 assesses continuity; the publication rides the outbox, so a broker hiccup does not lose the unlink; [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).
- **Walkthrough** - the primary constructor (`:20`-`:22`) injects `IServiceScopeFactory` and `ILogger`. `HandleAsync` (`:25`) null-guards the event (`:27`), then returns early unless `State == DomainEntityState.Deleted` (`:29`-`:30`). It logs via `LogSpeakerDeleted` (`:32`, generated at `:48`-`:49`). The load-bearing detail is the scope handling: domain-event handlers are registered as singletons, but [`IIntegrationEventPublisher`](group-04-events-outbox.md#iintegrationeventpublisher) is scoped, so the handler opens `scopeFactory.CreateAsyncScope()` (`:40`) and resolves the publisher from that scope (`:41`) before calling `PublishAsync` with a new `SpeakerUnlinkedFromUser(PreviousLinkedUserId, SpeakerId)` (`:42`-`:44`). The whole publish path is guarded by `if (domainEvent.PreviousLinkedUserId.HasValue)` (`:38`), so a speaker who was never linked raises nothing.
- **Why it's built this way** - the singleton-handler / scoped-dependency mismatch is a standard DI hazard; `CreateAsyncScope` is the correct fix rather than capturing a scoped service in a singleton. Routing the cleanup through the broker keeps Conference from taking a hard dependency on Identity's write path.
- **Where it's used** - Scrutor registers it; the `DomainEventDispatcher` fires it whenever a `Speaker` is soft-deleted.

### QuestionUpdateRequestValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Update/QuestionUpdateRequestValidator.cs:7` · Level 6 · class

- **What it is** - the FluentValidation validator for [`QuestionUpdateRequest`](#questionupdaterequest), assembled by composing the reusable question field rules.
- **Depends on** - [`QuestionTextRules<T>`](#questiontextrulest), [`QuestionUpdateRequest`](#questionupdaterequest), and FluentValidation's `AbstractValidator<T>`.
- **Concept introduced - validators as rule compositions.** A concrete validator's job is to say *which* fields it has and to pull in the shared rule for each via `Include(...)`, so the actual constraints live once in the field rules. The `ValidatingCommandDecorator` runs this validator before the transaction opens (see the CQRS pipeline in [Group 05](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)). `[Rubric §24 - Forms/Validation/UX Safety]` (§24 assesses that request validation happens before any state change, which this composition guarantees).
- **Walkthrough** - the sealed validator (`QuestionUpdateRequestValidator.cs:7`) has a constructor (`:9`) whose single statement `Include(new QuestionTextRules<QuestionUpdateRequest>(p => p.QuestionText))` (`:10`) pulls the shared text rule in against the request's `QuestionText`. No inline rules; every constraint lives in [`QuestionTextRules<T>`](#questiontextrulest).
- **Where it's used** - resolved by the validating decorator when an [`UpdateQuestionCommand`](#updatequestioncommand) carries this request.

### SessionUpdateRequestValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Update/SessionUpdateRequestValidator.cs:7` · Level 6 · class

- **What it is** - the FluentValidation validator for [`SessionUpdateRequest`](#sessionupdaterequest), the widest composition in this unit: one `Include` per validated session field.
- **Depends on** - [`SessionTitleRules<T>`](#sessiontitlerulest), [`SessionDescriptionRules<T>`](#sessiondescriptionrulest), [`SessionStatusRules<T>`](#sessionstatusrulest), [`SessionLiveUrlRules<T>`](#sessionliveurlrulest), [`SessionRecordingUrlRules<T>`](#sessionrecordingurlrulest), [`SessionAccessibilityInfoRules<T>`](#sessionaccessibilityinforulest), [`SessionResourceLinksRules<T>`](#sessionresourcelinksrulest), [`SessionUpdateRequest`](#sessionupdaterequest), and `AbstractValidator<T>`.
- **Concept reinforced - validator by composition.** Same shape as [`QuestionUpdateRequestValidator`](#questionupdaterequestvalidator), just with seven field rules; the count of `Include` calls tracks the number of length/format-constrained fields. Scheduling and cross-entity rules (BR-86 date range, BR-130 room, BR-140 immutable event) are *not* here: they are handler-side because they need loaded aggregate state, which a stateless request validator cannot see. `[Rubric §24 - Forms/Validation/UX Safety]`.
- **Walkthrough** - the constructor (`SessionUpdateRequestValidator.cs:9`) issues seven `Include(...)` calls (`:11`-`:17`), each binding a reusable rule to its property: `Title`, `Description`, `Status`, `LiveUrl`, `RecordingUrl`, `AccessibilityInfo`, `ResourceLinks`.
- **Where it's used** - run by the validating decorator ahead of [`UpdateSessionHandler`](#updatesessionhandler).

### SpeakerUpdateRequestValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Update/SpeakerUpdateRequestValidator.cs:7` · Level 6 · class

- **What it is** - the FluentValidation validator for [`SpeakerUpdateRequest`](#speakerupdaterequest), composed from the reusable speaker name rules.
- **Depends on** - [`SpeakerFirstNameRules<T>`](#speakerfirstnamerulest), [`SpeakerLastNameRules<T>`](#speakerlastnamerulest), [`SpeakerUpdateRequest`](#speakerupdaterequest), and `AbstractValidator<T>`.
- **Concept reinforced - validator by composition.** Same shape as [`QuestionUpdateRequestValidator`](#questionupdaterequestvalidator); only the two `required` name fields carry constraints, so the many optional social/bio fields need no rule. `[Rubric §24 - Forms/Validation/UX Safety]`.
- **Walkthrough** - the constructor (`SpeakerUpdateRequestValidator.cs:9`) calls `Include(new SpeakerFirstNameRules<SpeakerUpdateRequest>(p => p.FirstName))` (`:11`) and the matching last-name include (`:12`). No inline rules; every constraint is inherited from the composed field rules.
- **Where it's used** - resolved by the validating decorator when an [`UpdateSpeakerCommand`](#updatespeakercommand) carries this request.

### UpdateQuestionCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Update/UpdateQuestionCommand.cs:9` · Level 6 · record

- **What it is** - the CQRS command that pairs a target question `Id` with its [`QuestionUpdateRequest`](#questionupdaterequest) payload, invalidating the question cache on success.
- **Depends on** - [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), [`QuestionUpdateRequest`](#questionupdaterequest), [`Question`](group-17-conference-domain.md#question) (for the cache prefix), and the module alias `QuestionIdentifierType`.
- **Concept introduced - the request-carrying, cache-invalidating command.** Implementing [`ICommandWithRequest<TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest) advertises that this command wraps a validated request DTO, which is how the validating decorator knows to run [`QuestionUpdateRequestValidator`](#questionupdaterequestvalidator) against `Request` rather than the command itself. Implementing [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) declares a `CachePrefix` that the caching decorator reads after the handler succeeds to evict stale reads. `[Rubric §6 - CQRS & Event-Driven]` (§6 assesses that the write side declares its read-side invalidation contract). `[Rubric §12 - Performance & Scalability]` (§12 assesses caching strategy; output-cached question reads stay fresh without a blanket flush).
- **Walkthrough** - the positional record (`UpdateQuestionCommand.cs:9`) carries `QuestionIdentifierType Id` and `QuestionUpdateRequest Request`; `CachePrefix` (`:12`) is `$"{typeof(Question).FullName}:"`, so a successful update evicts cached question reads.
- **Where it's used** - dispatched by the question update controller endpoint and executed by [`UpdateQuestionHandler`](#updatequestionhandler).

### UpdateSpeakerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Update/UpdateSpeakerCommand.cs:13` · Level 6 · record

- **What it is** - the CQRS command that pairs a target speaker `Id` with its [`SpeakerUpdateRequest`](#speakerupdaterequest) payload **and** a `CallerIsOrganizer` authorization flag, invalidating the speaker cache on success.
- **Depends on** - [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), [`SpeakerUpdateRequest`](#speakerupdaterequest), [`Speaker`](group-17-conference-domain.md#speaker) (for the cache prefix), and the module alias `SpeakerIdentifierType`.
- **Concept introduced - carrying the caller's authority in the command, not the request body.** Same request-carrying / cache-invalidating shape as [`UpdateQuestionCommand`](#updatequestioncommand), with one extra field worth studying: `CallerIsOrganizer` is bound at the API edge from the caller's role claim, never from the request body. This lets one command serve both an organizer edit and a BR-214 speaker self-edit while keeping the authority decision on the trusted side of the boundary. `[Rubric §11 - Security]` (§11 assesses authorization placement; the privilege flag is derived server-side so a crafted body cannot elevate). `[Rubric §6 - CQRS & Event-Driven]`.
- **Walkthrough** - the positional record (`UpdateSpeakerCommand.cs:13`-`:16`) carries `SpeakerIdentifierType Id`, `SpeakerUpdateRequest Request`, and `bool CallerIsOrganizer`; the XML doc (`:9`-`:12`) records that when the flag is `false` the handler ignores the organizer-only request fields (`IsTopSpeaker`, `LinkedUserId`). `CachePrefix` (`:19`) is `$"{typeof(Speaker).FullName}:"`, so a successful update evicts cached speaker reads.
- **Where it's used** - dispatched by the speaker update controller endpoint (which binds `CallerIsOrganizer` from the role claim) and executed by [`UpdateSpeakerHandler`](#updatespeakerhandler).

### UpdateSessionCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Update/UpdateSessionCommand.cs:10` · Level 7 · record

- **What it is** - the CQRS command that pairs a target session `Id` with its [`SessionUpdateRequest`](#sessionupdaterequest) payload, invalidating the session cache on success. Unlike its siblings it produces an [`UpdateSessionResult`](#updatesessionresult) rather than a bare DTO.
- **Depends on** - [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), [`SessionUpdateRequest`](#sessionupdaterequest), [`Session`](group-17-conference-domain.md#session) (for the cache prefix), and the module alias `SessionIdentifierType`.
- **Concept reinforced - request-carrying, cache-invalidating command.** Same two-interface shape as [`UpdateQuestionCommand`](#updatequestioncommand). It sits one Level higher than the question/speaker commands because its handler returns the richer [`UpdateSessionResult`](#updatesessionresult), which itself depends on [`SessionDTO`](group-17-conference-domain.md#sessiondto). `[Rubric §6 - CQRS & Event-Driven]`.
- **Walkthrough** - the positional record (`UpdateSessionCommand.cs:10`) carries `SessionIdentifierType Id` and `SessionUpdateRequest Request`; `CachePrefix` (`:13`) is `$"{typeof(Session).FullName}:"`. Its input/output twin [`UpdateSessionResult`](#updatesessionresult) is declared in the same file (`:19`).
- **Where it's used** - dispatched by the session update controller endpoint and executed by [`UpdateSessionHandler`](#updatesessionhandler).

### UpdateQuestionHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Update/UpdateQuestionHandler.cs:18` · Level 8 · class

- **What it is** - the command handler for [`UpdateQuestionCommand`](#updatequestioncommand): it loads the question, stamps the client's concurrency token, enforces BR-137 (type/entity immutable once answers exist), delegates the field changes to the domain `Update`, persists, and returns the updated DTO.
- **Depends on** - [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`QuestionDTOMapper`](#questiondtomapper), [`Question`](group-17-conference-domain.md#question), [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer), [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer), [`Result`](group-01-result-error-handling.md#result), [`Error`](group-01-result-error-handling.md#error), and `ILogger<T>`.
- **Concept introduced - the load / guard / delegate / save / map handler shape.** The canonical write handler fetches the aggregate through the [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) repository, applies cross-cutting checks (concurrency, cross-aggregate invariants), calls a *domain method* that enforces its own invariants and raises events, `SaveChangesAsync` (which commits, stamps audit, and dispatches domain events through the outbox), and maps the result to a DTO. Business rules live in the aggregate; only rules needing *other* aggregates' state (here, whether answers exist) sit in the handler. `[Rubric §4 - DDD]` (§4 assesses that the aggregate owns its invariants; `Question.Update` does, the handler only orchestrates plus the cross-aggregate check). `[Rubric §8 - Data Architecture]` (optimistic concurrency via the rowversion token). `[Rubric §3 - Clean Architecture]` (the handler depends only on abstractions).
- **Walkthrough** - `HandleAsync` (`UpdateQuestionHandler.cs:24`) gets the `Question` repository (`:28`) and loads by `command.Id` (`:29`); a null entity returns `Error.NotFound` (`:30`-`:31`). It then calls `repository.SetOriginalRowVersion(entity, command.Request.RowVersion)` (`:35`) so a stale edit throws `DbUpdateConcurrencyException`, which the pipeline maps to 409. BR-137 (`:37`-`:62`) fires only if `QuestionType` or `QuestionEntity` changed: it probes two read repositories via `ExistsAsync` for any [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer) (`:41`-`:44`) or [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer) (`:48`-`:51`) tied to the question, and if answers exist returns an `Error.Validation` coded `Question.ImmutableAfterAnswers` (`:56`-`:60`). Otherwise it delegates to `entity.Update(...)` (`:64`-`:69`), propagates failures (`:71`-`:72`), awaits `SaveChangesAsync` (`:74`), logs via `LogQuestionUpdated` (`:76`, defined `:81`-`:82`), and returns `Result.Success(dtoMapper.MapToDTO(entity))` (`:78`).
- **Why it's built this way** - the two `GetReadRepository` probes are short-circuited (`:46`) so the second query runs only when the first finds nothing; routing the text/sort changes through `Question.Update` keeps validation and event-raising inside the aggregate while the answer-existence guard, which no single aggregate can answer, stays in the handler.
- **Where it's used** - invoked by the question update controller endpoint through the CQRS decorator pipeline (feature-gate, logging, caching, validating, transactional wrappers).

### UpdateSpeakerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Update/UpdateSpeakerHandler.cs:15` · Level 8 · class

- **What it is** - the command handler for [`UpdateSpeakerCommand`](#updatespeakercommand): it loads the speaker, applies the client's optimistic-concurrency token, masks organizer-only fields on a self-edit (BR-214), delegates the field changes to the domain `Update`, persists, and returns the updated DTO.
- **Depends on** - [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`SpeakerDTOMapper`](#speakerdtomapper), [`Speaker`](group-17-conference-domain.md#speaker), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), [`Result`](group-01-result-error-handling.md#result), [`Error`](group-01-result-error-handling.md#error), and `ILogger<T>`.
- **Concept reinforced - the load/guard/delegate/save/map handler with an authorization mask.** Same four-step shape as [`UpdateQuestionHandler`](#updatequestionhandler), with the concurrency stamp plus one field-level authorization step worth studying: before applying changes it chooses whether to honor the request's organizer-only fields or keep the entity's current values, based on the command's `CallerIsOrganizer` flag. `[Rubric §11 - Security]` (§11 assesses privilege enforcement; a self-service caller cannot re-link or feature a speaker even by crafting the body). `[Rubric §8 - Data Architecture]` (optimistic concurrency) and `[Rubric §4 - DDD]` (the entity's own `Update` enforces the invariants).
- **Walkthrough** - `HandleAsync` (`UpdateSpeakerHandler.cs:21`) gets the `Speaker` repository (`:25`) and loads by `command.Id` (`:26`); a null entity returns `Error.NotFound` (`:27`-`:28`). It calls `repository.SetOriginalRowVersion(entity, command.Request.RowVersion)` (`:32`) to arm the 409-on-stale check. The BR-214 mask (`:34`-`:39`) computes `isTopSpeaker` and `linkedUserId` as `command.CallerIsOrganizer ? command.Request.<field> : entity.<field>`, so a non-organizer keeps the stored values for `IsTopSpeaker` (curation flag) and `LinkedUserId` (changed only via the governed `/link` endpoint with its BR-208 uniqueness check). It delegates every editable field, passing the masked values, to `entity.Update(...)` (`:41`-`:53`), propagates failures (`:55`-`:56`), awaits `SaveChangesAsync` (`:58`), logs via `LogSpeakerUpdated` (`:60`, defined `:65`-`:66`), and returns `Result.Success(dtoMapper.MapToDTO(entity))` (`:62`).
- **Why it's built this way** - routing all mutation through `Speaker.Update` keeps validation and event-raising inside the aggregate; deriving the privilege from `CallerIsOrganizer` (bound server-side, per [`UpdateSpeakerCommand`](#updatespeakercommand)) rather than trusting the request body is what stops a self-edit from silently re-linking or featuring a speaker.
- **Where it's used** - invoked by the speaker update controller endpoint through the CQRS decorator pipeline (its request is validated by [`SpeakerUpdateRequestValidator`](#speakerupdaterequestvalidator) before the transaction opens).

### UpdateSessionHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Update/UpdateSessionHandler.cs:17` · Level 9 · class

- **What it is** - the richest handler in this unit and the command handler for [`UpdateSessionCommand`](#updatesessioncommand): it loads the session, stamps concurrency, enforces the immutable event (BR-140), validates the room against the parent event and its schedule (BR-130 + double-booking), delegates to the domain `Update`, computes the BR-86 date-range warning, persists, and returns an [`UpdateSessionResult`](#updatesessionresult).
- **Depends on** - [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype), [`SessionDTOMapper`](#sessiondtomapper), [`Session`](group-17-conference-domain.md#session), [`Event`](group-17-conference-domain.md#event), [`SessionRoomScheduling`](#sessionroomscheduling), [`UpdateSessionResult`](#updatesessionresult), [`Result`](group-01-result-error-handling.md#result), [`Error`](group-01-result-error-handling.md#error), and `ILogger<T>`.
- **Concept reinforced - the load/guard/delegate/save/map handler with cross-aggregate validation.** Same shape as [`UpdateQuestionHandler`](#updatequestionhandler), taken to its fullest: this handler loads a *second* aggregate (the parent [`Event`](group-17-conference-domain.md#event) with its rooms) because two of its rules span aggregates (a room must belong to the event, and a time slot must not double-book a room). `[Rubric §4 - DDD]` (single-aggregate invariants stay in `Session.Update`; genuinely cross-aggregate rules sit in the handler with the loaded `Event`). `[Rubric §8 - Data Architecture]` (concurrency plus a schedule-overlap `ExistsAsync` guard). `[Rubric §24 - Forms/Validation/UX Safety]` (BR-86 returns a non-blocking warning rather than a failure).
- **Walkthrough** - `HandleAsync` (`UpdateSessionHandler.cs:23`) loads the `Session` (`:27`-`:28`), returns `Error.NotFound` on null (`:29`-`:30`), and stamps the concurrency token (`:34`). BR-140 (`:37`-`:44`) rejects any change to `EventId` with an `Error.UnprocessableEntity` coded `Session.EventId.Immutable`. It then loads the parent [`Event`](group-17-conference-domain.md#event) with its `Rooms` untracked (`:47`-`:52`), returning `NotFound` if the parent is gone (`:53`-`:54`). Room validation is factored into the private `ValidateRoomAssignmentAsync` (`:57`, defined `:97`-`:130`): when a `RoomId` is supplied it checks the room belongs to the event and is not soft-deleted (BR-130, else `Session.RoomId.CrossEvent`), and when both times are set it calls `repository.ExistsAsync(SessionRoomScheduling.BuildOverlapPredicate(...), excludeSessionId: command.Id)` (`:119`-`:125`) so an overlap with another session in the same room returns `SessionRoomScheduling.DoubleBookedError` (`:128`). On success it delegates all editable fields to `entity.Update(...)` (`:61`-`:75`), propagates failures (`:77`-`:78`), computes `hasDateRangeWarning` via the private `IsOutsideEventDateRange` against the event's `StartDate`/`EndDate` (`:81`-`:83`, defined `:136`-`:145`), awaits `SaveChangesAsync` (`:85`), logs (`:87`), and returns `Result.Success(new UpdateSessionResult(dtoMapper.MapToDTO(entity), hasDateRangeWarning))` (`:89`).
- **Why it's built this way** - loading the `Event` untracked (`asTracking: false`) is correct because the handler only reads its rooms and dates, never mutates it; the overlap query lives in [`SessionRoomScheduling`](#sessionroomscheduling) so the same predicate is shared with the create path; BR-86 is advisory, so it rides out on [`UpdateSessionResult`](#updatesessionresult) instead of failing an otherwise valid edit.
- **Where it's used** - invoked by the session update controller endpoint through the CQRS decorator pipeline; the endpoint reads `HasDateRangeWarning` off the [`UpdateSessionResult`](#updatesessionresult) to surface the advisory.

### QuestionTextRules<T>

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.Validation` · `MMCA.ADC.Conference.Application/Questions/Validation/QuestionValidationRules.cs:12` · Level 5 · class

- **What it is**: a reusable FluentValidation rule set for the text of a conference question. It packages the two constraints that any question-text field must satisfy (non-empty, bounded length) so several validators can share one definition.
- **Depends on**: `AbstractValidator<T>` (FluentValidation, `QuestionValidationRules.cs:13`), `System.Linq.Expressions.Expression<Func<T, string>>` for the property selector (`:1,15`), and [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants) for the max-length constant (`:3,18`).
- **Concept introduced**: **the parameterized rule set.** Instead of writing the same `RuleFor(x => x.Text).NotEmpty().MaximumLength(...)` chain inside every command validator that carries question text, the constraints live once in a small `AbstractValidator<T>` subclass whose constructor takes a property `selector`. A concrete validator then folds it in with FluentValidation's `Include(...)`. Because the rule set is generic in `T` and receives the selector, the exact same object validates a create command, an update command, or an import request, each pointing the selector at its own text property. This is the same reuse device the framework's [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest) provides generically; `QuestionTextRules<T>` is a domain-specific hand-rolled variant that also pins the error codes. `[Rubric §24, Forms/Validation/UX Safety]` assesses whether input constraints are declared once and consistently applied: centralizing the question-text contract here keeps every entry path in agreement. `[Rubric §1, SOLID]`: one rule set, one responsibility, reused rather than copied.
- **Walkthrough**: the class is `sealed` and generic in `T` (`:12`). The expression-bodied constructor (`:15`) binds `RuleFor(selector)` and chains two clauses: `NotEmpty()` with the message "You must enter a Question Text" and error code `Question.QuestionText.Required` (`:17`), then `MaximumLength(QuestionInvariants.QuestionTextMaxLength)` with a length message and error code `Question.QuestionText.MaxLength` (`:18`). The stable `WithErrorCode(...)` strings are what the API error-mapping layer keys on, so they are part of the contract, not just prose.
- **Why it's built this way**: sourcing the bound from [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants) (rather than a literal here) keeps the application-layer validator and the domain aggregate's own guard citing one constant, so a limit change never drifts between layers.
- **Where it's used**: `Include`d by the question command validators in this module (create/update question, and the answer-text validators that follow the same shape).

### SpeakerFirstNameRules<T>

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.Validation` · `MMCA.ADC.Conference.Application/Speakers/Validation/SpeakerValidationRules.cs:11` · Level 5 · class

- **What it is**: the reusable rule set for a speaker's first name, wrapping the "required, bounded length" contract so speaker command validators can share one definition.
- **Depends on**: [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest) (the framework base it extends, `SpeakerValidationRules.cs:3,12`), `System.Linq.Expressions.Expression<Func<T, string>>` for the selector (`:1,14`), and [`SpeakerInvariants`](group-17-conference-domain.md#speakerinvariants) for the max-length constant (`:2,15`).
- **Concept introduced**: **reusing the framework rule base instead of re-declaring clauses.** Where [`QuestionTextRules<T>`](#questiontextrulest) hand-writes the `NotEmpty().MaximumLength(...)` chain, `SpeakerFirstNameRules<T>` derives from the shared [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest) and simply passes the selector, a human label, and the length bound to its base constructor. The generic base already encodes the non-empty-plus-max-length pattern, so the subclass is three lines. `[Rubric §1, SOLID]` and `[Rubric §24, Forms/Validation/UX Safety]`: the field contract is defined once in Common and specialized per field with a single `base(...)` call, the strongest form of the DRY validation approach in this codebase.
- **Walkthrough**: `sealed class SpeakerFirstNameRules<T> : RequiredStringRules<T>` (`:11-12`); the constructor (`:14`) forwards to `base(selector, "First Name", SpeakerInvariants.FirstNameMaxLength)` (`:15`). The label "First Name" is what surfaces in the generated required/length messages; the bound comes from the domain invariants type.
- **Where it's used**: `Include`d by the speaker create/update command validators (and the Sessionize import mapping validators) so a speaker's first name is checked identically everywhere.

### SpeakerLastNameRules<T>

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.Validation` · `MMCA.ADC.Conference.Application/Speakers/Validation/SpeakerValidationRules.cs:22` · Level 5 · class

- **What it is**: the last-name counterpart to [`SpeakerFirstNameRules<T>`](#speakerfirstnamerulest), the reusable "required, bounded length" rule set for a speaker's last name.
- **Depends on**: [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest) (`SpeakerValidationRules.cs:23`), the selector expression (`:25`), and [`SpeakerInvariants`](group-17-conference-domain.md#speakerinvariants) for the length bound (`:26`).
- **Concept introduced**: none new; structurally identical to [`SpeakerFirstNameRules<T>`](#speakerfirstnamerulest). The only differences are the label and the constant: the constructor (`:25`) calls `base(selector, "Last Name", SpeakerInvariants.LastNameMaxLength)` (`:26`). It lives in the same file so the two speaker-name rule sets are read and changed together.
- **Where it's used**: paired with [`SpeakerFirstNameRules<T>`](#speakerfirstnamerulest) in the speaker command validators.

### AddCategoryItemCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem` · `MMCA.ADC.Conference.Application/Categories/UseCases/AddCategoryItem/AddCategoryItemCommand.cs:14` · Level 6 · record

- **What it is**: the command to add one child item to an existing conference [`Category`](group-17-conference-domain.md#category) aggregate, carrying the owning category id plus the new item's optional id, name, and sort order.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) (the marker that opts the command into cache eviction, `AddCategoryItemCommand.cs:2,18`) and the [`Category`](group-17-conference-domain.md#category) type for the cache prefix (`:1,21`). `ConferenceCategoryIdentifierType` and `CategoryItemIdentifierType` are the module identifier aliases (see [primer](../00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Concept introduced**: **the child-add command shape.** A positional `record` is the write intent; its behavior lives entirely in the handler. Two details are worth calling out. First, `CategoryItemId` is nullable (`CategoryItemIdentifierType?`, `:16`): the Sessionize import supplies the source-assigned id, while a manual add leaves it `null` for database-generated identity. Second, implementing [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) hooks the command into the [`CachingCommandDecorator`](group-05-cqrs-pipeline.md#icacheinvalidating) so a successful add evicts the category read cache. `[Rubric §6, CQRS & Event-Driven]` assesses whether writes are explicit intents flowing through a uniform pipeline: this record is the intent, and the marker interface is how the cross-cutting cache concern attaches declaratively.
- **Walkthrough**: the positional parameters are `CategoryId` (`:15`), the nullable `CategoryItemId` (`:16`), `Name` (`:17`), and `Sort` (`:18`); the record implements [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) (`:18`). `CachePrefix` (`:21`) returns `"{typeof(Category).FullName}:"`, the key namespace the caching decorator wipes on success.
- **Where it's used**: validated by [`AddCategoryItemCommandValidator`](#addcategoryitemcommandvalidator) and handled by [`AddCategoryItemHandler`](#addcategoryitemhandler).

### CategoryItemDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.DTOs` · `MMCA.ADC.Conference.Application/Categories/DTOs/CategoryItemDTOMapper.cs:12` · Level 6 · class

- **What it is**: the Mapperly-generated mapper that turns a [`CategoryItem`](group-17-conference-domain.md#categoryitem) domain entity into its wire-facing [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto).
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) (the mapper contract, `CategoryItemDTOMapper.cs:3,13`), [`CategoryItem`](group-17-conference-domain.md#categoryitem), [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto), and the Mapperly source generator (`Riok.Mapperly.Abstractions`, `:4`).
- **Concept introduced**: **source-generated DTO mapping ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)).** The class is `sealed partial` and carries `[Mapper]` (`:11-12`); Mapperly generates the body of the `partial CategoryItemDTO MapToDTO(...)` (`:16`) at compile time by name-matching properties, so there is no runtime reflection and no hand-written field copy. This is the manual-mapping-versus-Mapperly split described in [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html): property-name-parallel entity/DTO pairs get generated mappers; only mismatches need hand-written code. `[Rubric §9, API & Contract Design]` assesses whether the domain model is shielded from the wire contract: this mapper keeps the entity and DTO as two separate shapes rather than serializing entities directly.
- **Walkthrough**: the generated `MapToDTO` (`:16`) does the single-entity conversion. `MapToDTOs` (`:19`) is hand-written: it null-guards the collection with `ArgumentNullException.ThrowIfNull` (`:21`) then projects each element through `MapToDTO` into a materialized array via the collection expression `[.. entityCollection.Select(MapToDTO)]` (`:22`). The mapper is registered by assembly scanning (Scrutor), so it is resolved by DI, not `new`-ed.
- **Where it's used**: composed as a child mapper by [`ConferenceCategoryDTOMapper`](#conferencecategorydtomapper) and injected into [`AddCategoryItemHandler`](#addcategoryitemhandler) to return the newly added item.

### ConferenceCategoryCreateRequest

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Create` · `MMCA.ADC.Conference.Application/Categories/UseCases/Create/ConferenceCategoryCreateRequest.cs:10` · Level 6 · record

- **What it is**: the request DTO a client posts to create a conference [`Category`](group-17-conference-domain.md#category). It carries the four inbound fields (`Id`, `Title`, `Sort`, `Type`) and doubles as the command that flows through the CQRS pipeline; there is no separate command wrapper for create in this module.
- **Depends on**: [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) and [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) (both `MMCA.Common.Application`, `ConferenceCategoryCreateRequest.cs:2,10`), and the [`Category`](group-17-conference-domain.md#category) entity only for its `FullName` in the cache prefix (`:1,13`). `ConferenceCategoryIdentifierType` is the module identifier alias (see [primer](../00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Concept introduced**: **the request-is-the-command idiom.** Rather than a `CreateXCommand` record wrapping a `CreateXRequest`, the create path lets one `record class` be both the wire contract and the handler input. Implementing [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) (a marker) lets the generic entity request-mapper pipeline recognize it, and [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) opts it into the [`CachingCommandDecorator`](group-05-cqrs-pipeline.md#icacheinvalidating) so a successful create evicts the read cache. `[Rubric §6, CQRS & Event-Driven]`: writes are modeled as explicit intents flowing through a uniform pipeline, and the marker interfaces are how cross-cutting behavior attaches to them declaratively.
- **Walkthrough**: `CachePrefix` (`:13`) returns `"{typeof(Category).FullName}:"`, the key namespace the caching decorator wipes on success. `Id` (`:16`) is `init`-only and optional (auto-generated when unset). `Title` (`:19`) is `required string`, the one field the create validator guards. `Sort` (`:22`) is an `int` display order defaulting to zero. `Type` (`:25`) is an optional discriminator string ("session", "speaker").
- **Why it's built this way**: `required`/`init` gives an immutable request whose one mandatory field cannot be omitted at the compiler level, matching the codebase-wide immutability convention. Cache invalidation keyed off the entity's `FullName` keeps producer (this request) and consumer (the query cache) agreed on one prefix string.
- **Where it's used**: validated by [`ConferenceCategoryCreateRequestValidator`](#conferencecategorycreaterequestvalidator), translated by [`ConferenceCategoryCreateRequestMapper`](#conferencecategorycreaterequestmapper), and handled by [`CreateConferenceCategoryHandler`](#createconferencecategoryhandler).

### RemoveCategoryItemCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.RemoveCategoryItem` · `MMCA.ADC.Conference.Application/Categories/UseCases/RemoveCategoryItem/RemoveCategoryItemCommand.cs:12` · Level 6 · record

- **What it is**: the command to remove one item from a conference [`Category`](group-17-conference-domain.md#category) aggregate, identified by the owning `CategoryId` and the target `CategoryItemId`.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) and the [`Category`](group-17-conference-domain.md#category) type for the cache prefix (`RemoveCategoryItemCommand.cs:1-2,17`). `ConferenceCategoryIdentifierType` / `CategoryItemIdentifierType` are the module aliases.
- **Concept introduced**: none new; this is the child-removal shape of the CQRS command pattern (parent id + child id + cache invalidation). The positional `record` (`:12-14`) carries the two ids, and `CachePrefix` (`:17`) evicts the category read cache on success, exactly as [`AddCategoryItemCommand`](#addcategoryitemcommand) does. `[Rubric §6, CQRS & Event-Driven]`: the mutation is an explicit intent, and child mutations route through the aggregate root rather than deleting a child row directly.
- **Walkthrough**: `CategoryId` and `CategoryItemId` (`:13-14`) are the two positional parameters; the record implements [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) (`:14`) and `CachePrefix` (`:17`) returns the `Category` full-name prefix. There is nothing else: the record is pure intent, the behavior lives in its handler.
- **Where it's used**: handled by [`RemoveCategoryItemHandler`](#removecategoryitemhandler), which tolerates a default (unset) `CategoryId`.

### AddCategoryItemCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem` · `MMCA.ADC.Conference.Application/Categories/UseCases/AddCategoryItem/AddCategoryItemCommandValidator.cs:7` · Level 7 · class

- **What it is**: the FluentValidation validator for [`AddCategoryItemCommand`](#addcategoryitemcommand), enforced by the pipeline before the add handler runs. It checks the new item's `Name` and `Sort`.
- **Depends on**: `AbstractValidator<T>` (FluentValidation, `AddCategoryItemCommandValidator.cs:1,7`), [`AddCategoryItemCommand`](#addcategoryitemcommand), and two shared rule sets, `CategoryItemNameRules<T>` and `CategoryItemSortRules<T>` (from the module's `Categories.Validation` namespace, `:2`).
- **Concept introduced**: **rule-set composition via `Include`.** Rather than re-declaring the item-field rules inline, the constructor (`:9-13`) folds two reusable rule objects into the validator: `Include(new CategoryItemNameRules<AddCategoryItemCommand>(p => p.Name))` (`:11`) and `Include(new CategoryItemSortRules<AddCategoryItemCommand>(p => p.Sort))` (`:12`). Each rule set is parameterized by a property selector, so the same name/sort constraints are reused by any other command that edits the same fields (the update-category-item validator uses the identical pair). `[Rubric §24, Forms/Validation/UX Safety]` and `[Rubric §1, SOLID]`: the item's field rules live in exactly one place, so a length or range change updates every path at once. The [`ValidatingCommandDecorator`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) runs this before the transaction opens.
- **Walkthrough**: the constructor body (`:9-13`) is two `Include` calls, one per validated field. Nothing validates the two id fields (`CategoryId`, `CategoryItemId`): the owning category's existence is checked by the handler, which returns `NotFound` when it is absent.
- **Where it's used**: discovered by Scrutor and invoked by the validating decorator ahead of [`AddCategoryItemHandler`](#addcategoryitemhandler).

### ConferenceCategoryCreateRequestMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Create` · `MMCA.ADC.Conference.Application/Categories/UseCases/Create/ConferenceCategoryCreateRequestMapper.cs:11` · Level 7 · class

- **What it is**: the request-to-entity mapper that turns a validated [`ConferenceCategoryCreateRequest`](#conferencecategorycreaterequest) into a [`Category`](group-17-conference-domain.md#category) by calling the domain factory.
- **Depends on**: [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) (the contract, `ConferenceCategoryCreateRequestMapper.cs:2,12`), [`ConferenceCategoryCreateRequest`](#conferencecategorycreaterequest), [`Category`](group-17-conference-domain.md#category), and [`Result<T>`](group-01-result-error-handling.md#result) (`MMCA.Common.Shared.Abstractions`, `:3,15`).
- **Concept introduced**: **the request mapper as the factory gateway.** Unlike a DTO mapper (pure property copy), a request mapper is allowed to fail: `CreateEntityAsync` (`:15`) returns `Task<Result<Category>>` because it delegates to `Category.Create(...)` (`:19-23`), the domain factory that enforces invariants and returns a failure [`Result`](group-01-result-error-handling.md#result) on invalid input. This keeps entity construction (and its invariants) inside the domain while the application layer only wires the fields across. `[Rubric §4, Domain-Driven Design]`: invalid entities cannot be constructed because the only path in is the `Result`-returning factory; the mapper never `new`s a `Category`.
- **Walkthrough**: `CreateEntityAsync` (`:15`) null-guards the request (`:17`) then returns `Task.FromResult(Category.Create(request.Id, request.Title, request.Sort, request.Type))` (`:19-23`), passing the four request fields positionally to the factory. It is synchronous work wrapped in `Task.FromResult` because no I/O is involved.
- **Why it's built this way**: the generic create pipeline ([`CreateConferenceCategoryHandler`](#createconferencecategoryhandler)) is entity-agnostic; per-entity construction lives behind this small mapper so the handler can stay reusable across aggregates.
- **Where it's used**: injected into [`CreateConferenceCategoryHandler`](#createconferencecategoryhandler) as the [`IEntityRequestMapper`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) for `Category`.

### ConferenceCategoryCreateRequestValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Create` · `MMCA.ADC.Conference.Application/Categories/UseCases/Create/ConferenceCategoryCreateRequestValidator.cs:7` · Level 7 · class

- **What it is**: the FluentValidation validator for [`ConferenceCategoryCreateRequest`](#conferencecategorycreaterequest), enforced by the pipeline before the create handler runs.
- **Depends on**: `AbstractValidator<T>` (FluentValidation, `ConferenceCategoryCreateRequestValidator.cs:1,7`), [`ConferenceCategoryCreateRequest`](#conferencecategorycreaterequest), and the shared `ConferenceCategoryTitleRules<T>` rule set (from `Categories.Validation`, `:2`).
- **Concept introduced**: none new; the same `Include`-composition idiom taught for [`AddCategoryItemCommandValidator`](#addcategoryitemcommandvalidator), folding a single rule set. The expression-bodied constructor (`:9-10`) calls `Include(new ConferenceCategoryTitleRules<ConferenceCategoryCreateRequest>(p => p.Title))`, reusing the title constraints (length, non-empty) that the update-category validator also includes, so they live in exactly one place. `[Rubric §24, Forms/Validation/UX Safety]`: validation is single-sourced across every command that edits a category title.
- **Walkthrough**: the whole body is the expression-bodied constructor (`:9-10`): a single `Include` of the title rule set bound to `p => p.Title`. Nothing else is validated at the request level (the `Id`/`Sort`/`Type` fields carry no create-time constraints).
- **Where it's used**: discovered by Scrutor and invoked by the validating decorator ahead of [`CreateConferenceCategoryHandler`](#createconferencecategoryhandler).

### ConferenceCategoryDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.DTOs` · `MMCA.ADC.Conference.Application/Categories/DTOs/ConferenceCategoryDTOMapper.cs:13` · Level 7 · class

- **What it is**: the Mapperly mapper from the [`Category`](group-17-conference-domain.md#category) aggregate to its [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto), including its child `CategoryItems` collection.
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) (`ConferenceCategoryDTOMapper.cs:3,15`), the Mapperly generator (`:4`), and one injected child mapper, [`CategoryItemDTOMapper`](#categoryitemdtomapper) (`:13-14`).
- **Concept introduced**: **mapper composition with `[UseMapper]`.** This is the parent side of the two-mapper pair. The class is `sealed partial` with a primary constructor that takes the [`CategoryItemDTOMapper`](#categoryitemdtomapper) and stores it in a `[UseMapper]`-tagged field (`:17-18`); that attribute tells Mapperly to reuse the child mapper for the nested `CategoryItems` collection instead of regenerating that logic. Everything else is name-matched, so there is no hand-written junction here (unlike the more complex event mapper elsewhere in this group that must patch an un-generatable field). `[Rubric §9, API & Contract Design]`: the aggregate's wire shape is assembled from composable per-child mappers, keeping each entity/DTO pair mapped in one place.
- **Walkthrough**: the primary constructor (`:13-14`) receives `categoryItemDTOMapper`; the `[UseMapper] private readonly` field (`:17-18`) exposes it to the generator. `MapToDTO` (`:21`) is the generated single-entity conversion (which routes child items through the reused mapper). `MapToDTOs` (`:24`) is the standard hand-written projection: null-guard (`:26`) then `[.. entityCollection.Select(MapToDTO)]` (`:27`).
- **Where it's used**: the primary DTO mapper for Conference `Category` reads, resolved (with its child auto-injected) by Scrutor/DI, and consumed by [`CreateConferenceCategoryHandler`](#createconferencecategoryhandler) to shape its response.

### AddCategoryItemHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem` · `MMCA.ADC.Conference.Application/Categories/UseCases/AddCategoryItem/AddCategoryItemHandler.cs:15` · Level 8 · class

- **What it is**: the handler for [`AddCategoryItemCommand`](#addcategoryitemcommand): load the owning [`Category`](group-17-conference-domain.md#category) aggregate, delegate the add to the root, persist, log, and return the new item's DTO.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) (`AddCategoryItemHandler.cs:6,18`), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (`:5,16`), [`CategoryItemDTOMapper`](#categoryitemdtomapper) (`:2,17`), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error) (`:7`), and `ILogger<T>` (`:1,18`).
- **Concept introduced**: **routing child mutation through the aggregate root.** The handler never inserts a `CategoryItem` row directly; it loads the `Category` and calls `category.AddCategoryItem(...)` (`:30`) so the aggregate enforces its own consistency (the DDD boundary rule from [Group 02](group-02-domain-building-blocks.md)). It is deliberately thin because the cross-cutting concerns (validation, caching, transaction) are applied by the decorator pipeline around it via the command's marker interfaces (see [primer](../00-primer.md#2-architectural-styles-this-codebase-commits-to) and [Group 05](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)). `[Rubric §4, Domain-Driven Design]` (mutations go through the root) and `[Rubric §13, Observability & Operability]`: the `[LoggerMessage]` source-generated log (`:41-42`) is the compile-time, allocation-free logging pattern.
- **Walkthrough**: `HandleAsync` (`:21`) gets the typed repository from the unit of work (`:25`) and loads the category by id with the simple `GetByIdAsync` (`:26`), no eager include, because an add does not need existing items materialized. A `null` category returns `Error.NotFound` tagged with source and target for diagnostics (`:27-28`). It then calls `category.AddCategoryItem(command.CategoryItemId, command.Name, command.Sort)` (`:30`) and short-circuits with the aggregate's errors on failure (`:31-32`). On success it `SaveChangesAsync`es (`:34`), emits the source-generated `LogCategoryItemAdded` (`:36`), and returns `Result.Success` wrapping the DTO from `dtoMapper.MapToDTO(result.Value!)` (`:38`), mapping the item the aggregate just created. The `[LoggerMessage]` partial declares the template (`:41-42`).
- **Why it's built this way**: the handler opens no transaction and invalidates no cache itself; the transactional and caching decorators do that, driven by [`AddCategoryItemCommand`](#addcategoryitemcommand)'s [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) marker. This keeps the handler focused and the cross-cutting behavior uniform across every command.
- **Where it's used**: invoked by the Categories REST controller (via the decorated command dispatch) when a new item is added to a category.

### CreateConferenceCategoryHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Create` · `MMCA.ADC.Conference.Application/Categories/UseCases/Create/CreateConferenceCategoryHandler.cs:16` · Level 8 · class

- **What it is**: the command handler that creates a conference [`Category`](group-17-conference-domain.md#category): map the request to an entity via the domain factory, persist it, log, and return the mapped DTO.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) (`CreateConferenceCategoryHandler.cs:7,20`), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (`:6,17`), the [`IEntityRequestMapper`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) for `Category` (satisfied by [`ConferenceCategoryCreateRequestMapper`](#conferencecategorycreaterequestmapper), `:5,18`), [`ConferenceCategoryDTOMapper`](#conferencecategorydtomapper) (`:2,19`), and `ILogger<T>` (`:1,20`).
- **Concept introduced**: **the write-handler shape and high-performance logging.** The handler is a `sealed partial` class using a primary constructor for DI (`:16-20`) and implements `ICommandHandler<ConferenceCategoryCreateRequest, Result<ConferenceCategoryDTO>>` (`:20`), one of the create paths where the request is also the command. It is deliberately thin because the cross-cutting concerns (validation, caching, transaction, logging) are added by the decorator pipeline around it (see [primer](../00-primer.md#2-architectural-styles-this-codebase-commits-to) and [Group 05](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)); the handler only orchestrates the happy path. `[Rubric §6, CQRS & Event-Driven]` (one intent, one handler) and `[Rubric §13, Observability & Operability]`: the `[LoggerMessage]` source-generated log (`:42-43`) is compile-time and allocation-free, no boxing, no runtime format parsing.
- **Walkthrough**: `HandleAsync` (`:23`) first calls the request mapper (`:27`) and short-circuits with `Result.Failure` if the domain factory rejected the input (`:28-29`), propagating the errors. On success it takes the entity (`:31`), gets the typed repository from the unit of work (`:32`), `AddAsync`es it (`:34`), and `SaveChangesAsync`es (`:35`), the single save that persists the row (and would flush any domain events through the outbox). It then emits the source-generated `LogConferenceCategoryCreated` (`:37`) and returns `Result.Success` wrapping the DTO from `dtoMapper.MapToDTO(entity)` (`:39`). The `[LoggerMessage]` partial declares the structured template (`:42-43`).
- **Why it's built this way**: the handler never opens a transaction or invalidates cache itself; those are the transactional and caching decorators' jobs, driven by the marker interfaces the request implements. This keeps the handler focused and the cross-cutting behavior uniform across every command.
- **Where it's used**: invoked by the Categories REST controller (via the decorated command dispatch) on `POST` of a new category.

### RemoveCategoryItemHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.RemoveCategoryItem` · `MMCA.ADC.Conference.Application/Categories/UseCases/RemoveCategoryItem/RemoveCategoryItemHandler.cs:13` · Level 8 · class

- **What it is**: the handler for [`RemoveCategoryItemCommand`](#removecategoryitemcommand): load the owning [`Category`](group-17-conference-domain.md#category) aggregate with its items and delegate the removal to the aggregate root.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) (`RemoveCategoryItemHandler.cs:4,15`), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (`:3,14`), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error) (`:5`), and `ILogger<T>` (`:1,15`).
- **Concept introduced**: **routing child mutation through the aggregate root, plus a defensive id resolution.** The handler never deletes a child row directly; it loads the `Category` (eager-including `CategoryItems`, tracked) and calls `entity.RemoveCategoryItem(...)` (`:49`) so the aggregate enforces its own consistency (the DDD boundary rule from [Group 02](group-02-domain-building-blocks.md)). The load path is dual: because the DELETE endpoint takes the category id as an *optional* query parameter and the UI's generic delete sends only the item id (arriving as the default `0`), a `CategoryId == default` (`:28`) triggers a reverse lookup that finds the owning category by `CategoryItems.Any(ci => ci.Id == command.CategoryItemId)` (`:30-34`); otherwise it loads by id directly (`:39-43`). `[Rubric §4, Domain-Driven Design]` (mutations go through the root) and `[Rubric §9, API & Contract Design]` (a contract quirk handled explicitly, not silently mis-deleting).
- **Walkthrough**: `HandleAsync` (`:18`) gets the repository (`:22`), then branches on the unset-`CategoryId` case (`:28`): either the reverse `GetAllAsync` (`:30-34`) taking the first match (`:35`), or the direct `GetByIdAsync` (`:39-43`), both eager-loading `CategoryItems` and tracking. A `null` entity returns `Error.NotFound` sourced/targeted for diagnostics (`:46-47`). On a successful `RemoveCategoryItem` (`:49-50`) it `SaveChangesAsync`es (`:52`) and logs (`:54`); the domain `Result` is returned as-is (`:57`) so an invariant failure from the aggregate surfaces unchanged.
- **Why it's built this way**: the reverse lookup exists because of a real client contract gap (the category-item DELETE case where an unbound query id defaulted to `0`); resolving the parent from the child keeps the generic UI delete working without leaking existence. Loading with tracking is required so EF sees the child removal.
- **Where it's used**: invoked by the Categories controller on item-delete; returns 404 when neither branch finds an owner.

### AddEventQuestionAnswerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddEventQuestionAnswer/AddEventQuestionAnswerCommand.cs:11` · Level 6 · record

- **What it is** the write-side message that asks the system to record an answer to a conference `Event` question (for example a per-attendee dietary or accessibility answer). It is a `sealed record` with four positional fields: the target `EventId`, an optional explicit `EventQuestionAnswerId`, the `QuestionId` being answered, and the raw `AnswerValue` string (`AddEventQuestionAnswerCommand.cs:11-15`).
- **Depends on** the identifier aliases `EventIdentifierType`, `EventQuestionAnswerIdentifierType`, and `QuestionIdentifierType` (see [primer section 2](../00-primer.md#2-architectural-styles-this-codebase-commits-to)); the framework marker [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); and the domain [`Event`](group-17-conference-domain.md#event) aggregate, referenced only to compute a cache prefix.
- **Concept introduced** the cache-invalidating command idiom, taught once here for the whole unit. A command is an immutable request record: it carries data, never behavior. By implementing [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) and exposing `CachePrefix => $"{typeof(Event).FullName}:"` (`AddEventQuestionAnswerCommand.cs:18`), the record tells the caching decorator in the [CQRS pipeline](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) to evict every cached read whose key starts with the `Event` type name after the handler succeeds. The command never touches the cache itself; the cross-cutting decorator reads this property and does the eviction, so the write and the cache concern stay separate. [Rubric section 6, CQRS and Event-Driven] assesses whether writes and reads are modeled as distinct, explicit messages: the mutation is a named record routed to a single handler. [Rubric section 10, Cross-Cutting] assesses whether concerns like caching are centralized rather than sprinkled into business code: `CachePrefix` is a one-line declaration that hands the whole eviction concern to the pipeline.
- **Walkthrough** the four constructor parameters (`AddEventQuestionAnswerCommand.cs:12-15`) are the entire payload. `EventQuestionAnswerId` is nullable because the caller usually lets the aggregate assign it during the upsert handled downstream. `CachePrefix` (`:18`) is the only member with logic, and it is a pure expression.
- **Why it's built this way** modeling each mutation as its own record keeps the vertical slice self-describing; records give value equality and `with`-based copies for free, which matters for test assertions.
- **Where it's used** validated first by [`AddEventQuestionAnswerCommandValidator`](#addeventquestionanswercommandvalidator), then dispatched into [`AddEventQuestionAnswerHandler`](#addeventquestionanswerhandler).

### AddEventSpeakerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddEventSpeaker/AddEventSpeakerCommand.cs:10` · Level 6 · record

- **What it is** the request to associate an existing `Speaker` with an existing `Event`. A `sealed record` with three fields: `EventId`, an optional `EventSpeakerId`, and the `SpeakerId` to attach (`AddEventSpeakerCommand.cs:10-13`).
- **Depends on** the aliases `EventIdentifierType`, `EventSpeakerIdentifierType`, `SpeakerIdentifierType`; [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); and [`Event`](group-17-conference-domain.md#event) for the cache prefix.
- **Concept introduced** none new. It is the same cache-invalidating command shape introduced by [`AddEventQuestionAnswerCommand`](#addeventquestionanswercommand): `CachePrefix => $"{typeof(Event).FullName}:"` (`AddEventSpeakerCommand.cs:16`) so a successful add evicts the event read cache. [Rubric section 6, CQRS and Event-Driven] applies for the same reason.
- **Walkthrough** three positional parameters (`:11-13`); `EventSpeakerId` is nullable so the caller can omit it and let the aggregate assign the association id.
- **Where it's used** validated by [`AddEventSpeakerCommandValidator`](#addeventspeakercommandvalidator), then handled by [`AddEventSpeakerHandler`](#addeventspeakerhandler).

### EventQuestionAnswerDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/DTOs/EventQuestionAnswerDTOMapper.cs:12` · Level 6 · class

- **What it is** the mapper that projects an [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer) domain entity into its read-side [`EventQuestionAnswerDTO`](group-17-conference-domain.md#eventquestionanswerdto). It implements [`IEntityDTOMapper<EventQuestionAnswer, EventQuestionAnswerDTO, EventQuestionAnswerIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) (`EventQuestionAnswerDTOMapper.cs:12-13`).
- **Depends on** the [`IEntityDTOMapper`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) contract; the domain [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer) and its DTO; and Mapperly's `[Mapper]` attribute (Riok.Mapperly, NuGet).
- **Concept introduced** source-generated DTO mapping. The class is `partial` and carries `[Mapper]` (`:11-12`), so at compile time Mapperly writes the body of the `partial EventQuestionAnswerDTO MapToDTO(EventQuestionAnswer entity)` declaration (`:16`) by matching property names between entity and DTO. No reflection runs at runtime, which is the difference from a general-purpose object mapper. The hand-written `MapToDTOs` (`:19-23`) guards against a null collection (`:21`) and projects each element with a collection expression. [Rubric section 3, Clean Architecture] assesses whether the application layer, not the domain, owns the DTO translation: the mapper sits in the Application project and depends inward on the domain type. [Rubric section 9, API and Contract Design] assesses whether the wire shape is distinct from the aggregate: this mapper is the single translation point that keeps `EventQuestionAnswer` free of serialization concerns ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) chooses compile-time mapping over runtime reflection).
- **Walkthrough** two members: the Mapperly-generated `MapToDTO` single-entity projection (`:16`) and the manual collection overload (`:19-23`). Both come from the [`IEntityDTOMapper`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) contract.
- **Where it's used** injected into [`AddEventQuestionAnswerHandler`](#addeventquestionanswerhandler) and, as a child mapper, into [`EventDTOMapper`](#eventdtomapper).

### EventSpeakerDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/DTOs/EventSpeakerDTOMapper.cs:12` · Level 6 · class

- **What it is** the Mapperly mapper from an [`EventSpeaker`](group-17-conference-domain.md#eventspeaker) domain entity to an [`EventSpeakerDTO`](group-17-conference-domain.md#eventspeakerdto), implementing [`IEntityDTOMapper<EventSpeaker, EventSpeakerDTO, EventSpeakerIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) (`EventSpeakerDTOMapper.cs:12-13`).
- **Depends on** the [`IEntityDTOMapper`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) contract, the domain [`EventSpeaker`](group-17-conference-domain.md#eventspeaker) and its DTO, and Mapperly's `[Mapper]`.
- **Concept introduced** none new; it is structurally identical to [`EventQuestionAnswerDTOMapper`](#eventquestionanswerdtomapper): a `[Mapper]`-attributed `partial` class with a generated `MapToDTO` (`:16`) and a null-guarded collection overload (`:19-23`). [Rubric section 3, Clean Architecture] and [Rubric section 9, API and Contract Design] apply for the same reasons.
- **Where it's used** injected into [`AddEventSpeakerHandler`](#addeventspeakerhandler) and, as a child mapper, into [`EventDTOMapper`](#eventdtomapper).

### OwnEventQuestionAnswerSpecification

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Specifications` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Specifications/OwnEventQuestionAnswerSpecification.cs:11` · Level 6 · class

- **What it is** a query specification (BR-8) that filters event question answers down to those created by a given user, so an attendee sees only their own answers while an organizer bypasses it by passing no specification (`OwnEventQuestionAnswerSpecification.cs:7-16`).
- **Depends on** the framework base [`Specification<EventQuestionAnswer, EventQuestionAnswerIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype); the domain [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer); the `UserIdentifierType` alias; and `System.Linq.Expressions.Expression<T>` (BCL).
- **Concept introduced** the specification as a reusable, testable query predicate (the pattern is taught in [group 3](group-03-querying-specifications.md#specificationtentity-tidentifiertype)). The user id arrives through the primary constructor `(UserIdentifierType userId)` (`:11`), and the only override is the `Criteria` expression `a => a.CreatedBy == userId` (`:15-16`). Because `Criteria` is an `Expression`, not a compiled delegate, EF Core translates it into a SQL `WHERE` clause rather than filtering in memory. [Rubric section 11, Security] assesses whether row-level access is enforced authoritatively: the filter keys off the entity's audit `CreatedBy` field, so ownership is decided by stamped data, not by a client-supplied argument. [Rubric section 4, Domain-Driven Design] assesses whether a business rule (BR-8, own-answer visibility) is captured as a first-class, named artifact rather than an ad hoc `Where` sprinkled in a controller.
- **Walkthrough** one expression-bodied member: the `Criteria` override (`:15-16`). Everything else (paging, includes, ordering) is inherited from the base specification.
- **Where it's used** applied by the Conference read side for question-answer list endpoints when the caller is a non-organizer; organizers pass `null` to see all answers.

### PublishedEventSpecification

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Specifications` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Specifications/PublishedEventSpecification.cs:11` · Level 6 · class

- **What it is** a specification (BR-108) that restricts an event query to published events only, applied for non-organizer users on public read endpoints (`PublishedEventSpecification.cs:7-15`).
- **Depends on** the base [`Specification<Event, EventIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype); the domain [`Event`](group-17-conference-domain.md#event); and `Expression<T>` (BCL).
- **Concept introduced** none new; it is the simplest form of the specification introduced by [`OwnEventQuestionAnswerSpecification`](#owneventquestionanswerspecification). It takes no constructor arguments and its `Criteria` is the constant predicate `e => e.IsPublished` (`:14`), which EF Core folds into the SQL query. [Rubric section 8, Data Architecture] assesses whether visibility rules are pushed to the database instead of over-fetching then filtering: unpublished events never leave SQL Server for anonymous readers.
- **Where it's used** applied to public event browse and detail reads for non-organizer callers.

### RoomDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/DTOs/RoomDTOMapper.cs:12` · Level 6 · class

- **What it is** the Mapperly mapper from a [`Room`](group-17-conference-domain.md#room) domain entity to a [`RoomDTO`](group-17-conference-domain.md#roomdto), implementing [`IEntityDTOMapper<Room, RoomDTO, RoomIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) (`RoomDTOMapper.cs:12-13`).
- **Depends on** the [`IEntityDTOMapper`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) contract, the domain [`Room`](group-17-conference-domain.md#room) and its DTO, and Mapperly's `[Mapper]`.
- **Concept introduced** none new; identical shape to [`EventQuestionAnswerDTOMapper`](#eventquestionanswerdtomapper): a generated `MapToDTO` (`:16`) plus the null-guarded collection overload (`:19-23`). [Rubric section 3, Clean Architecture] and [Rubric section 9, API and Contract Design] apply.
- **Where it's used** injected into the room command handlers and, as a child mapper, into [`EventDTOMapper`](#eventdtomapper).

### UpdateCategoryItemCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/UpdateCategoryItem/UpdateCategoryItemCommand.cs:14` · Level 6 · record

- **What it is** the request to rename or reorder an existing item inside a conference [`Category`](group-17-conference-domain.md#category). A `sealed record` with four positional fields: the owning `CategoryId`, the target `CategoryItemId`, the new `Name`, and the new `Sort` order (`UpdateCategoryItemCommand.cs:14-18`).
- **Depends on** the aliases `ConferenceCategoryIdentifierType` and `CategoryItemIdentifierType`; [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); and the domain [`Category`](group-17-conference-domain.md#category) for the cache prefix.
- **Concept introduced** none new; it is the cache-invalidating command shape from [`AddEventQuestionAnswerCommand`](#addeventquestionanswercommand), but keyed to the category read cache: `CachePrefix => $"{typeof(Category).FullName}:"` (`UpdateCategoryItemCommand.cs:21`) so a successful update evicts cached category reads. [Rubric section 6, CQRS and Event-Driven] and [Rubric section 10, Cross-Cutting] apply for the same reasons as the event commands.
- **Walkthrough** four positional parameters (`:15-18`); unlike the `Add*` commands, `CategoryItemId` is required (non-nullable), because an update always targets a known item. `CachePrefix` (`:21`) is the only computed member.
- **Where it's used** validated by [`UpdateCategoryItemCommandValidator`](#updatecategoryitemcommandvalidator), then handled by [`UpdateCategoryItemHandler`](#updatecategoryitemhandler).

### AddEventQuestionAnswerCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddEventQuestionAnswer/AddEventQuestionAnswerCommandValidator.cs:8` · Level 7 · class

- **What it is** the FluentValidation validator that screens an [`AddEventQuestionAnswerCommand`](#addeventquestionanswercommand) before it reaches the handler. It enforces one rule: `AnswerValue` must not be empty (`AddEventQuestionAnswerCommandValidator.cs:10-14`).
- **Depends on** FluentValidation's `AbstractValidator<T>` (NuGet) and the command it validates.
- **Concept introduced** input validation as a pipeline stage. Validators are auto-registered by assembly scanning and invoked by the validating decorator before the transaction opens (see the [CQRS pipeline](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)), so a malformed command is rejected without ever loading an aggregate. The rule attaches both a human message and a stable `WithErrorCode("EventQuestionAnswer.AnswerValue.Required")` (`:14`), so clients can branch on a code rather than parse prose. [Rubric section 24, Forms/Validation/UX Safety] assesses whether inputs are validated with actionable, stable errors at the boundary: the error code is the machine-readable contract that lets the UI show the right field message.
- **Walkthrough** a single expression-bodied constructor (`:10-14`) registers the `AnswerValue` rule. Deeper business rules (question must target `Event`, answer must match the question type) are enforced later in the handler, not here, because they need database lookups.
- **Where it's used** consumed by the validating decorator ahead of [`AddEventQuestionAnswerHandler`](#addeventquestionanswerhandler).

### AddEventSpeakerCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddEventSpeaker/AddEventSpeakerCommandValidator.cs:8` · Level 7 · class

- **What it is** the validator for [`AddEventSpeakerCommand`](#addeventspeakercommand). It enforces that `SpeakerId` is not the default value (`AddEventSpeakerCommandValidator.cs:10-13`).
- **Depends on** `AbstractValidator<T>` (FluentValidation); the command; the `SpeakerIdentifierType` alias.
- **Concept introduced** none new; the same boundary-validation role as [`AddEventQuestionAnswerCommandValidator`](#addeventquestionanswercommandvalidator). The one rule uses `NotEqual(default(SpeakerIdentifierType))` (`:12`) rather than `NotEmpty`, the correct guard for a value-type id whose zero or empty value is meaningless. [Rubric section 24, Forms/Validation/UX Safety] applies.
- **Where it's used** ahead of [`AddEventSpeakerHandler`](#addeventspeakerhandler).

### EventDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/DTOs/EventDTOMapper.cs:14` · Level 7 · class

- **What it is** the composite mapper from an [`Event`](group-17-conference-domain.md#event) aggregate to its full [`EventDTO`](group-17-conference-domain.md#eventdto), including its child collections. It implements [`IEntityDTOMapper<Event, EventDTO, EventIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) and delegates child mapping to the three leaf mappers (`EventDTOMapper.cs:14-18`).
- **Depends on** the [`IEntityDTOMapper`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) contract; the child mappers [`RoomDTOMapper`](#roomdtomapper), [`EventSpeakerDTOMapper`](#eventspeakerdtomapper), and [`EventQuestionAnswerDTOMapper`](#eventquestionanswerdtomapper); the domain [`Event`](group-17-conference-domain.md#event) and [`EventDTO`](group-17-conference-domain.md#eventdto); Mapperly's `[Mapper]`, `[UseMapper]`, and `[MapperIgnoreTarget]`; and `System.Globalization.CultureInfo` (BCL).
- **Concept introduced** mapper composition, and the escape hatch for a projection Mapperly cannot express. The three child mappers arrive through the primary constructor (`:14-17`) and are exposed as `[UseMapper]` private fields (`:20-27`), which tells Mapperly to call them when it maps the matching child collections on `Event`. `MapToDTO` (`:30-41`) calls the generated `MapToDTOGenerated` (`:51`), then applies a manual `with` post-step (`:36-40`): the audit field `LastSessionizeRefreshBy` is a `UserIdentifierType?` on the entity but a `string?` on the DTO, and that nullable-value-to-string conversion is not expressible in Mapperly, so it runs by hand after the generated pass. The generated method carries `[MapperIgnoreTarget(nameof(EventDTO.LastSessionizeRefreshBy))]` (`:50`) so Mapperly does not try (and fail) to map that member itself. [Rubric section 3, Clean Architecture] assesses whether translation stays in the application layer: the aggregate and its children never learn about their DTOs. [Rubric section 9, API and Contract Design] assesses whether a rich aggregate projects to one coherent contract: this mapper assembles the full event tree in a single call.
- **Walkthrough** `MapToDTO` (`:30`) null-guards the entity (`:32`), runs the generated map (`:33`), then patches the one non-mappable field (`:36-40`). `MapToDTOs` (`:44-48`) is the null-guarded collection overload. `MapToDTOGenerated` (`:51`) is the Mapperly-written private core.
- **Why it's built this way** delegating to child mappers keeps each leaf projection defined once and reused, so a change to `RoomDTO` mapping propagates through every parent that includes rooms ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) for the manual-mapping stance).
- **Where it's used** injected into the Conference event create and read handlers to project the full event tree.

### UpdateCategoryItemCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/UpdateCategoryItem/UpdateCategoryItemCommandValidator.cs:7` · Level 7 · class

- **What it is** the validator for [`UpdateCategoryItemCommand`](#updatecategoryitemcommand). Rather than inlining rules, it composes two reusable category-item field rule sets (`UpdateCategoryItemCommandValidator.cs:11-12`).
- **Depends on** `AbstractValidator<T>` (FluentValidation) and the shared rule types [`CategoryItemNameRules<T>`](#categoryitemnamerulest) and [`CategoryItemSortRules<T>`](#categoryitemsortrulest).
- **Concept introduced** rule composition via `Include`. Each `Include(new CategoryItemNameRules<UpdateCategoryItemCommand>(p => p.Name))` (`:11`) folds a generic, property-selector-parameterized rule set into this validator. The same `CategoryItemNameRules<T>` is reused by the add-category-item validator, so the field constraints have one source of truth and cannot drift between add and update. [Rubric section 1, SOLID] assesses single-responsibility and reuse: each rule set is one small, testable unit; the validator only wires them to properties. [Rubric section 16, Maintainability] assesses whether shared logic is factored rather than duplicated: a length change in `CategoryItemNameRules` propagates everywhere at once.
- **Walkthrough** the constructor (`:9-13`) is two `Include` calls, each passing a lambda that points the generic rule at the matching command property (`Name`, `Sort`).
- **Where it's used** ahead of [`UpdateCategoryItemHandler`](#updatecategoryitemhandler).

### AddEventQuestionAnswerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddEventQuestionAnswer/AddEventQuestionAnswerHandler.cs:17` · Level 8 · class

- **What it is** the command handler that records a question answer against an event. It is the most business-rule-dense handler in the unit, enforcing several conference rules (BR-108, BR-128, BR-124, BR-107) around a load-validate-mutate-save flow (`AddEventQuestionAnswerHandler.cs:17-113`).
- **Depends on** [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (repositories plus save), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (the acting user), the [`EventQuestionAnswerDTOMapper`](#eventquestionanswerdtomapper), an `ILogger`, and the [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) contract; the domain [`Event`](group-17-conference-domain.md#event), [`Question`](group-17-conference-domain.md#question), [`EventInvariants`](group-17-conference-domain.md#eventinvariants), and [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants); and [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced** the full anatomy of a command handler, and the point where business rules that need I/O live. `HandleAsync` (`:24`) loads the [`Event`](group-17-conference-domain.md#event) aggregate through [`IUnitOfWork.GetRepository`](group-07-persistence-ef-core.md#iunitofwork), eagerly including `EventQuestionAnswers` and requesting change tracking (`:28-33`) because it intends to mutate. A missing event short-circuits to an [`Error.NotFound`](group-01-result-error-handling.md#error) (`:34-35`). It then layers checks that a boundary validator could not do because they require data: BR-108 asserts the event is published via [`EventInvariants.EnsureEventIsPublished`](group-17-conference-domain.md#eventinvariants) (`:38`); BR-128 and BR-124 run in `ValidateQuestionAsync` (`:58`), which loads the [`Question`](group-17-conference-domain.md#question), rejects it if `QuestionEntity` is not `"Event"` (`:65`), and delegates the answer-shape check to [`QuestionInvariants.EnsureAnswerValueMatchesQuestionType`](group-17-conference-domain.md#questioninvariants) (`:75-76`). BR-107 is an upsert: it looks for an existing non-deleted answer keyed by `(QuestionId, CreatedBy)` for the current user (`:48-50`) and routes to update or create accordingly. [Rubric section 6, CQRS and Event-Driven] assesses the single-handler-per-command shape. [Rubric section 4, Domain-Driven Design] assesses whether invariants live in the domain: the handler orchestrates but delegates each rule to an invariants helper or an aggregate method. [Rubric section 11, Security] assesses whether the acting identity is authoritative: the upsert key uses `currentUserService.UserId` (`:48`), not a client-supplied owner, so a user can only overwrite their own answer.
- **Walkthrough** after the guards, `UpdateExistingAnswerAsync` (`:79`) calls `entity.UpdateEventQuestionAnswer` and saves; `CreateNewAnswerAsync` (`:94`) calls `entity.AddEventQuestionAnswer` and saves. Both persist through [`unitOfWork.SaveChangesAsync`](group-07-persistence-ef-core.md#iunitofwork) (`:89`, `:106`), where audit stamping, domain-event dispatch, and the outbox fire, then map the child to a DTO. Logging uses a source-generated `LoggerMessage` partial (`:111-112`), which is allocation-free and the reason the class is `partial`.
- **Why it's built this way** rules that need the database (published state, question targeting, answer typing, ownership) cannot run in the stateless [validator](#addeventquestionanswercommandvalidator), so they sit in the handler as explicit [`Result`](group-01-result-error-handling.md#result) checks that fail fast before any mutation. [Rubric section 13, Observability and Operability] is served by the structured `LoggerMessage`.
- **Where it's used** dispatched from the Conference questions/answers REST controller through the decorator pipeline.

### AddEventSpeakerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddEventSpeaker/AddEventSpeakerHandler.cs:15` · Level 8 · class

- **What it is** the handler that attaches a speaker to an event. It is the canonical thin load-delegate-save handler (`AddEventSpeakerHandler.cs:15-45`).
- **Depends on** [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), the [`EventSpeakerDTOMapper`](#eventspeakerdtomapper), an `ILogger`, [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); the [`Event`](group-17-conference-domain.md#event) aggregate and its `AddEventSpeaker` method; [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced** none new; this is the minimal form of the pattern [`AddEventQuestionAnswerHandler`](#addeventquestionanswerhandler) shows in full. `HandleAsync` (`:21`) loads the [`Event`](group-17-conference-domain.md#event) by id (`:26`), returns [`Error.NotFound`](group-01-result-error-handling.md#error) if absent (`:27-28`), delegates to `entity.AddEventSpeaker` (`:30-32`), and only saves and maps on success (`:33-40`). All the association invariants live inside the aggregate method, so the handler stays a thin orchestrator. [Rubric section 5, Vertical Slice] assesses whether a feature is a self-contained slice: command, validator, and handler sit in one folder and read top to bottom.
- **Walkthrough** the aggregate method returns a [`Result`](group-01-result-error-handling.md#result); the handler checks `IsFailure` (`:33`) before persisting, so a rejected association never reaches the database. `SaveChangesAsync` (`:36`) triggers the shared persistence machinery; a `LoggerMessage` partial records the add (`:43-44`).
- **Where it's used** dispatched from the Conference event-speakers REST controller.

### UpdateCategoryItemHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/UpdateCategoryItem/UpdateCategoryItemHandler.cs:13` · Level 8 · class

- **What it is** the handler for [`UpdateCategoryItemCommand`](#updatecategoryitemcommand): load the owning [`Category`](group-17-conference-domain.md#category) aggregate with its items, ask it to update the named item, save if it agreed. Its return type is a bare [`Result`](group-01-result-error-handling.md#result) (no DTO), because the update returns no payload (`UpdateCategoryItemHandler.cs:13-44`).
- **Depends on** [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), an `ILogger`, [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); the [`Category`](group-17-conference-domain.md#category) aggregate and its `UpdateCategoryItem` method; [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced** none new; it is the child-mutation variant of the load-delegate-save shape. `HandleAsync` (`:18`) loads the [`Category`](group-17-conference-domain.md#category) with its `CategoryItems` eagerly included and change tracking on (`:22-27`), because it mutates a child of the aggregate. A missing category returns [`Error.NotFound`](group-01-result-error-handling.md#error) (`:28-29`). It delegates to `entity.UpdateCategoryItem` (`:31`) so the item-level invariants live inside the aggregate, and only when that result `IsSuccess` does it save and log (`:32-37`). It returns the domain method's [`Result`](group-01-result-error-handling.md#result) directly (`:39`), so a rejected update flows straight back to the caller and nothing persists. [Rubric section 4, Domain-Driven Design] assesses whether the aggregate owns its children: the item update runs through `Category`, never as a direct write to a `CategoryItem` row. [Rubric section 6, CQRS and Event-Driven] assesses the single-handler-per-command shape.
- **Walkthrough** the save is inside the `IsSuccess` branch (`:32-37`), not unconditional, the same discipline the state-transition handlers use: a rejected update must not open a transaction. The `LoggerMessage` partial (`:42-43`) records the updated item and category ids.
- **Where it's used** dispatched from the Conference categories REST controller update-item endpoint.

### AddRoomCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddRoom` · `MMCA.ADC.Conference.Application/Events/UseCases/AddRoom/AddRoomCommand.cs:15` · Level 6 · record

- **What it is** - the write-side request to add a room to an existing conference event. It is the input contract for [AddRoomHandler](#addroomhandler): eight positional parameters carrying the target event, an optional explicit room id, and the room's descriptive fields.
- **Depends on** - the module identifier aliases `EventIdentifierType` and `RoomIdentifierType` (from Conference `Shared`, resolved through `MMCA.ADC.Conference.Domain.Events`, `AddRoomCommand.cs:1`), the domain [Event](group-17-conference-domain.md#event) type (used only to build the cache prefix, `AddRoomCommand.cs:26`), and the cross-cutting marker [ICacheInvalidating](group-05-cqrs-pipeline.md#icacheinvalidating) from `MMCA.Common.Application.UseCases` (`AddRoomCommand.cs:2,23`).
- **Concept introduced** - *cache-invalidating command*. Where a query request opts into caching, a mutation opts into cache eviction by implementing [ICacheInvalidating](group-05-cqrs-pipeline.md#icacheinvalidating). The record supplies `CachePrefix => $"{typeof(Event).FullName}:"` (`AddRoomCommand.cs:26`), and the caching decorator in the CQRS pipeline (introduced in [Group 05](group-05-cqrs-pipeline.md)) purges every cached read under that key prefix after the command succeeds. Because a room is a child of an event, adding one must evict the event read cache, hence the `Event`-typed prefix rather than a room-typed one. `[Rubric §10 - Cross-Cutting]` assesses whether caching is handled uniformly instead of hand-rolled per handler: here the command declares intent and the pipeline enforces it, so no handler touches the cache directly.
- **Walkthrough** - the `sealed record` declares `EventId`, then a nullable `RoomId` (`AddRoomCommand.cs:16-17`), then the room fields `Name` and `Sort` (required by position) plus the four optional fields `Capacity`, `Floor`, `Location`, `AccessibilityInfo` (`AddRoomCommand.cs:18-22`). The nullable `RoomId` is the load-bearing detail: a null id tells the handler to auto-assign one in the reserved manual range, a non-null id is respected as an explicit Sessionize id.
- **Why it's built this way** - a positional record gives value equality and immutability for free, and keeping the room id optional lets one command serve both organizer-created rooms (no id) and Sessionize-imported rooms (explicit id). Cache invalidation as a marker interface follows the decorator-pipeline pattern ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) family / CQRS pipeline).
- **Where it's used** - dispatched by the Conference REST API layer (rooms controller) and handled by [AddRoomHandler](#addroomhandler).

### EventCreateRequest
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Create` · `MMCA.ADC.Conference.Application/Events/UseCases/Create/EventCreateRequest.cs:10` · Level 6 · record

- **What it is** - the request DTO for creating a new conference event. Unlike the positional command records in this group, it is an init-only property bag that carries every field the [Event.Create](group-17-conference-domain.md#event) factory needs.
- **Depends on** - [ICreateRequest](group-05-cqrs-pipeline.md#icreaterequest) from `MMCA.Common.Application.Interfaces` (`EventCreateRequest.cs:2,10`), [ICacheInvalidating](group-05-cqrs-pipeline.md#icacheinvalidating) (`EventCreateRequest.cs:10`), the [Event](group-17-conference-domain.md#event) domain type for the cache prefix, and the `EventIdentifierType` alias for `Id` (`EventCreateRequest.cs:16`).
- **Concept introduced** - *the generic create-request pipeline*. Implementing [ICreateRequest](group-05-cqrs-pipeline.md#icreaterequest) is what lets this DTO flow through the shared entity-request-mapper machinery ([IEntityRequestMapper](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype)) rather than each create handler hand-mapping fields. `[Rubric §9 - API & Contract Design]` assesses whether inbound contracts are explicit and validated: this record makes the create shape a first-class type with `required` markers on `Name`, `StartDate`, `EndDate`, and `TimeZone`.
- **Walkthrough** - `CachePrefix` is the same `Event.FullName`-based key as the other event mutations (`EventCreateRequest.cs:13`). `Id` is `init` and auto-generated when omitted (`EventCreateRequest.cs:16`). Four fields are `required`: `Name` (`:19`), `StartDate`/`EndDate` as `DateOnly` (`:25,28`), and the IANA `TimeZone` string (`:31`). The remaining fields (`Description`, `SessionizeCode`, `VenueAddress`, `VenueMapUrl`, `WiFiInfo`) are optional nullable strings (`EventCreateRequest.cs:22,34-43`).
- **Why it's built this way** - using `required`/`init` properties instead of a constructor lets the DTO be deserialized directly from JSON while still failing fast at construction if a mandatory field is missing. `DateOnly` (not `DateTime`) models a calendar event window with no spurious time-of-day component.
- **Where it's used** - validated by [EventCreateRequestValidator](#eventcreaterequestvalidator), translated to a domain entity by [EventCreateRequestMapper](#eventcreaterequestmapper), and handled by [CreateEventHandler](#createeventhandler).

### PublishEventCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Publish` · `MMCA.ADC.Conference.Application/Events/UseCases/Publish/PublishEventCommand.cs:8` · Level 6 · record

- **What it is** - a one-field command that publishes an event, making it visible to attendees.
- **Depends on** - the `EventIdentifierType` alias for `Id`, [Event](group-17-conference-domain.md#event) for the cache prefix, and [ICacheInvalidating](group-05-cqrs-pipeline.md#icacheinvalidating) (`PublishEventCommand.cs:1-2,8`).
- **Concept introduced** - none new; this is the minimal shape of a state-transition command. It carries only the aggregate id (`PublishEventCommand.cs:8`) because the state change itself lives in the domain method [Event.Publish](group-17-conference-domain.md#event), not in the command.
- **Walkthrough** - the `sealed record PublishEventCommand(EventIdentifierType Id)` declares the id positionally and supplies the same event-scoped `CachePrefix` (`PublishEventCommand.cs:11`) so publishing evicts the cached event reads.
- **Why it's built this way** - a publish is a verb with no payload beyond the target, so the command stays a single-parameter record; all invariants (for example, refusing to publish an already-published event) belong to the aggregate.
- **Where it's used** - handled by [PublishEventHandler](#publisheventhandler); an `Unpublish` sibling (not in this unit) mirrors it.

### RemoveEventQuestionAnswerCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventQuestionAnswer` · `MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventQuestionAnswer/RemoveEventQuestionAnswerCommand.cs:9` · Level 6 · record

- **What it is** - the request to remove a single question answer from an event. It carries the owning `EventId` and the `EventQuestionAnswerId` to delete.
- **Depends on** - the `EventIdentifierType` and `EventQuestionAnswerIdentifierType` aliases, [Event](group-17-conference-domain.md#event) for the cache prefix, and [ICacheInvalidating](group-05-cqrs-pipeline.md#icacheinvalidating) (`RemoveEventQuestionAnswerCommand.cs:1-2,11`).
- **Concept introduced** - none new; this is the standard *remove-child* command shape shared with [RemoveEventSpeakerCommand](#removeeventspeakercommand) and [RemoveRoomCommand](#removeroomcommand): the aggregate id plus the child id, and the event-scoped `CachePrefix` (`RemoveEventQuestionAnswerCommand.cs:14`).
- **Walkthrough** - two positional parameters, `EventId` then `EventQuestionAnswerId` (`RemoveEventQuestionAnswerCommand.cs:10-11`); no other payload, because the ownership rule that governs deletion is enforced in the handler, not the command.
- **Why it's built this way** - keeping the command a pure identifier pair keeps the authorization decision (BR-52/BR-53) in one place, [RemoveEventQuestionAnswerHandler](#removeeventquestionanswerhandler), rather than trusting a caller-supplied owner field.
- **Where it's used** - handled by [RemoveEventQuestionAnswerHandler](#removeeventquestionanswerhandler).

### RemoveEventSpeakerCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventSpeaker` · `MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventSpeaker/RemoveEventSpeakerCommand.cs:9` · Level 6 · record

- **What it is** - the request to remove a speaker association from an event, carrying `EventId` and the `EventSpeakerId` (the association row, not the speaker itself).
- **Depends on** - the `EventIdentifierType` and `EventSpeakerIdentifierType` aliases, [Event](group-17-conference-domain.md#event) for the cache prefix, and [ICacheInvalidating](group-05-cqrs-pipeline.md#icacheinvalidating) (`RemoveEventSpeakerCommand.cs:1-2,11`).
- **Concept introduced** - none new; identical remove-child shape to [RemoveEventQuestionAnswerCommand](#removeeventquestionanswercommand) and [RemoveRoomCommand](#removeroomcommand). It targets an [EventSpeaker](group-17-conference-domain.md#eventspeaker) association and evicts the event cache via `CachePrefix` (`RemoveEventSpeakerCommand.cs:14`).
- **Walkthrough** - the two positional parameters `EventId` and `EventSpeakerId` (`RemoveEventSpeakerCommand.cs:10-11`).
- **Why it's built this way** - removing the association (not the speaker aggregate) keeps the operation inside the event boundary; the speaker continues to exist independently.
- **Where it's used** - handled by [RemoveEventSpeakerHandler](#removeeventspeakerhandler).

### RemoveRoomCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RemoveRoom` · `MMCA.ADC.Conference.Application/Events/UseCases/RemoveRoom/RemoveRoomCommand.cs:9` · Level 6 · record

- **What it is** - the request to remove a room from an event, carrying `EventId` and `RoomId`.
- **Depends on** - the `EventIdentifierType` and `RoomIdentifierType` aliases, [Event](group-17-conference-domain.md#event) for the cache prefix, and [ICacheInvalidating](group-05-cqrs-pipeline.md#icacheinvalidating) (`RemoveRoomCommand.cs:1-2,11`).
- **Concept introduced** - none new; the same remove-child shape as [RemoveEventQuestionAnswerCommand](#removeeventquestionanswercommand) and [RemoveEventSpeakerCommand](#removeeventspeakercommand), with the event-scoped `CachePrefix` (`RemoveRoomCommand.cs:14`).
- **Walkthrough** - two positional parameters, `EventId` then `RoomId` (`RemoveRoomCommand.cs:10-11`).
- **Why it's built this way** - the room is a child of the event aggregate, so the command names both the aggregate and the child, and the aggregate method [Event.RemoveRoom](group-17-conference-domain.md#room) owns the removal invariants.
- **Where it's used** - handled by [RemoveRoomHandler](#removeroomhandler).

### AddRoomCommandValidator
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddRoom` · `MMCA.ADC.Conference.Application/Events/UseCases/AddRoom/AddRoomCommandValidator.cs:7` · Level 7 · class

- **What it is** - the FluentValidation validator for [AddRoomCommand](#addroomcommand). It runs in the validation decorator of the CQRS pipeline before the handler executes.
- **Depends on** - `AbstractValidator<AddRoomCommand>` from FluentValidation (`AddRoomCommandValidator.cs:1,7`) and the reusable room rule sets [RoomNameRules<T>](#roomnamerulest), [RoomSortRules<T>](#roomsortrulest), `RoomCapacityRules<T>`, `RoomFloorRules<T>`, `RoomLocationRules<T>`, and `RoomAccessibilityInfoRules<T>` from the `Events.Validation` namespace (`AddRoomCommandValidator.cs:2,11-16`).
- **Concept introduced** - *rule composition via `Include`*. Rather than restating each room-field rule inline, the validator composes generic, property-selector-parameterized rule objects with FluentValidation's `Include(...)` (`AddRoomCommandValidator.cs:11-16`). Each rule set is constructed with a lambda selecting the property on `AddRoomCommand` (for example `p => p.Name`), so one rule definition serves every command that has a room name. `[Rubric §15 - Best Practices & Code Quality]` assesses duplication: composed rule sets keep validation DRY across the Add and (Sessionize import) room-writing paths.
- **Walkthrough** - the constructor includes six rule sets, one per validated room field, in field order (`AddRoomCommandValidator.cs:9-17`). There is no bespoke rule here; all logic lives in the included rule types.
- **Why it's built this way** - centralizing per-field rules in shared generic rule classes means a room-name constraint change is made once and applies to every command that reuses `RoomNameRules<T>`.
- **Where it's used** - resolved and invoked by the pipeline's validation decorator (Group 05) for [AddRoomCommand](#addroomcommand).

### EventCreateRequestMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Create` · `MMCA.ADC.Conference.Application/Events/UseCases/Create/EventCreateRequestMapper.cs:11` · Level 7 · class

- **What it is** - the adapter that turns an [EventCreateRequest](#eventcreaterequest) DTO into an [Event](group-17-conference-domain.md#event) domain entity by calling the domain factory. It is the request-side complement to the DTO mappers.
- **Depends on** - [IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) from `MMCA.Common.Application.Interfaces` (`EventCreateRequestMapper.cs:2,11-13`), [Event](group-17-conference-domain.md#event) and its `Create` factory (`EventCreateRequestMapper.cs:1,19`), and [Result<T>](group-01-result-error-handling.md#result) from `MMCA.Common.Shared.Abstractions` (`EventCreateRequestMapper.cs:3,15`).
- **Concept introduced** - *request-to-entity mapping as a first-class port*. Implementing the generic [IEntityRequestMapper](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) lets a generic create handler stay entity-agnostic: the handler asks the mapper for the entity and never references the concrete constructor. Because the factory returns [Result<T>](group-01-result-error-handling.md#result), any domain-invariant failure (for example an invalid date range) surfaces as a failed result, not an exception. `[Rubric §4 - Domain-Driven Design]` assesses whether entity construction is guarded: here the mapper never news up an `Event`, it delegates to `Event.Create`.
- **Walkthrough** - `CreateEntityAsync` guards the argument with `ArgumentNullException.ThrowIfNull(request)` (`EventCreateRequestMapper.cs:17`), then wraps the synchronous `Event.Create(...)` call in `Task.FromResult`, forwarding all ten request fields in factory order (`EventCreateRequestMapper.cs:19-29`). No persistence happens here; it returns only the validated (or failed) entity.
- **Why it's built this way** - keeping mapping in a dedicated class satisfies the manual-mapping convention ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html), no reflection-based mapper for entity construction) and isolates the one place that knows the `Event.Create` parameter order.
- **Where it's used** - injected into [CreateEventHandler](#createeventhandler) as `IEntityRequestMapper<Event, EventCreateRequest, EventIdentifierType>`.

### EventCreateRequestValidator
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Create` · `MMCA.ADC.Conference.Application/Events/UseCases/Create/EventCreateRequestValidator.cs:7` · Level 7 · class

- **What it is** - the FluentValidation validator for [EventCreateRequest](#eventcreaterequest), enforcing the create-time field rules before the handler runs.
- **Depends on** - `AbstractValidator<EventCreateRequest>` (`EventCreateRequestValidator.cs:1,7`) and the reusable event rule sets [EventNameRules<T>](#eventnamerulest), [EventTimeZoneRules<T>](#eventtimezonerulest), and [EventDateRangeRules<T>](#eventdaterangerulest) from `Events.Validation` (`EventCreateRequestValidator.cs:2,11-13`).
- **Concept introduced** - none new; it uses the same `Include`-based rule composition as [AddRoomCommandValidator](#addroomcommandvalidator). Notably [EventDateRangeRules<T>](#eventdaterangerulest) takes two selectors (`p => p.StartDate, p => p.EndDate`, `EventCreateRequestValidator.cs:13`) so it can validate the pair relationally (start before end), a check no single-field rule could express.
- **Walkthrough** - three `Include` calls in the constructor: name, time zone, then the two-selector date-range rule (`EventCreateRequestValidator.cs:9-14`).
- **Why it's built this way** - composing rules keeps event validation consistent across create and update paths and keeps the relational date rule in one reusable place.
- **Where it's used** - invoked by the pipeline validation decorator (Group 05) ahead of [CreateEventHandler](#createeventhandler).

### AddRoomHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddRoom` · `MMCA.ADC.Conference.Application/Events/UseCases/AddRoom/AddRoomHandler.cs:15` · Level 8 · class

- **What it is** - the command handler that adds a room to an existing event, including the app-side room-id auto-assignment logic that keeps organizer-created rooms from colliding with Sessionize-assigned ids.
- **Depends on** - [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (`AddRoomHandler.cs:16`), [RoomDTOMapper](#roomdtomapper) (`:17`), `ILogger<AddRoomHandler>` (`:18`), the [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) contract (`:18`), the [Event](group-17-conference-domain.md#event) and [Room](group-17-conference-domain.md#room) aggregates, [EventInvariants](group-17-conference-domain.md#eventinvariants) for the manual-id range constants (`AddRoomHandler.cs:39,45,47`), and [Result](group-01-result-error-handling.md#result)/[Error](group-01-result-error-handling.md#error) (`:28,48`).
- **Concept introduced** - *reserved-range id allocation in the handler*. Room ids are application-assigned (the int PK is the Sessionize id). When the caller supplies no `RoomId`, the handler queries a read repository for existing rooms whose id falls in the reserved manual range (`EventInvariants.RoomManualIdRangeStart..RoomManualIdRangeEnd`, `AddRoomHandler.cs:39`) with `ignoreQueryFilters: true` so soft-deleted rows still count, then takes `Max(id) + 1` or the range start (`AddRoomHandler.cs:43-45`), returning a failure if the range is exhausted (`:47-48`). This is the one handler in the group that assigns a primary key itself rather than delegating to the database. `[Rubric §8 - Data Architecture]` assesses id strategy: a reserved manual range guarantees organizer-created rooms never overwrite an id the Sessionize import will later claim.
- **Walkthrough** - resolve the event repository and load the event, failing with `Error.NotFound` if absent (`AddRoomHandler.cs:25-28`). Compute `roomId`: honor an explicit `command.RoomId`, otherwise auto-assign from the reserved range via the read repository (`AddRoomHandler.cs:33-51`). Delegate creation to the aggregate method `entity.AddRoom(...)` (`:53-60`), propagating any domain failure (`:61-62`). Persist with `SaveChangesAsync` (`:64`), log via the source-generated `LogRoomAdded` (`:66,71-72`), and return the mapped [RoomDTO](group-17-conference-domain.md#roomdto) (`:68`).
- **Why it's built this way** - the aggregate owns room creation invariants while the handler owns only the cross-aggregate id-allocation concern that no single event can decide alone (the range is global across events, `AddRoomHandler.cs:38-39`). The `[LoggerMessage]` source generator (`AddRoomHandler.cs:71`) gives allocation-free structured logging (`[Rubric §13 - Observability & Operability]`).
- **Where it's used** - dispatched from the Conference rooms REST controller through the CQRS pipeline for [AddRoomCommand](#addroomcommand).

### CreateEventHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Create` · `MMCA.ADC.Conference.Application/Events/UseCases/Create/CreateEventHandler.cs:16` · Level 8 · class

- **What it is** - the handler that creates a new event: it maps the request to an entity, persists it, and returns the event DTO.
- **Depends on** - [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (`CreateEventHandler.cs:17`), [IEntityRequestMapper<Event, EventCreateRequest, EventIdentifierType>](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) (`:18`), `EventDTOMapper` (`:19`, see [EventDTOMapper](#eventdtomapper)), `ILogger<CreateEventHandler>` (`:20`), the [ICommandHandler](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) contract handling [EventCreateRequest](#eventcreaterequest) (`:20`), and [Result](group-01-result-error-handling.md#result)/[EventDTO](group-17-conference-domain.md#eventdto).
- **Concept introduced** - *the create flow via a request mapper*. Unlike the other handlers here that load an existing aggregate, this one builds a new one indirectly: it calls `requestMapper.CreateEntityAsync(command, ...)` (`CreateEventHandler.cs:27`) and short-circuits on failure (`:28-29`) so a domain-invariant violation from `Event.Create` returns a failed [Result](group-01-result-error-handling.md#result) rather than throwing. This keeps the handler decoupled from the concrete `Event` constructor. `[Rubric §5 - Vertical Slice]` assesses whether a use case is self-contained: the create slice pairs its own request, validator, mapper, and handler in one folder.
- **Walkthrough** - map request to entity and bail on failure (`CreateEventHandler.cs:27-29`); unwrap the entity (`:31`); get the write repository and `AddAsync` the entity (`:32-34`); `SaveChangesAsync` (`:35`); log with the source-generated `LogEventCreated` (`:37,42-43`); return the mapped [EventDTO](group-17-conference-domain.md#eventdto) (`:39`).
- **Why it's built this way** - delegating construction to the mapper/factory keeps the create handler generic in spirit and consistent with the other create handlers in the module; `ConfigureAwait(false)` on the awaited infrastructure calls (`CreateEventHandler.cs:34-35`) follows the library-code convention ([ADR-049](https://ivanball.github.io/docs/adr/049-library-configureawait-policy.html)).
- **Where it's used** - dispatched by the Conference events REST controller for [EventCreateRequest](#eventcreaterequest).

### PublishEventHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Publish` · `MMCA.ADC.Conference.Application/Events/UseCases/Publish/PublishEventHandler.cs:13` · Level 8 · class

- **What it is** - the handler that transitions an event to the published state by loading the aggregate and calling its `Publish` method.
- **Depends on** - [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (`PublishEventHandler.cs:14`), `ILogger<PublishEventHandler>` (`:15`), the [ICommandHandler](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) contract returning a non-generic [Result](group-01-result-error-handling.md#result) (`:15`), the [Event](group-17-conference-domain.md#event) aggregate, and [Error](group-01-result-error-handling.md#error) (`:25`).
- **Concept introduced** - *state-transition handler returning bare `Result`*. This handler produces no DTO; it returns [Result](group-01-result-error-handling.md#result) (success or failure only) because publishing is a status change, not a data read. The decision to allow or reject the transition lives entirely in `entity.Publish()` (`PublishEventHandler.cs:27`).
- **Walkthrough** - load the event, failing with `Error.NotFound` if missing (`PublishEventHandler.cs:22-25`); call `entity.Publish()` (`:27`); only on success persist and log via `LogEventPublished` (`:28-32`); return the domain result unchanged (`:34`), so a failed transition propagates the aggregate's own error.
- **Why it's built this way** - persisting only when the transition succeeds (`PublishEventHandler.cs:28`) avoids an empty `SaveChangesAsync` and keeps the aggregate the single source of publish invariants. Returning the domain `result` verbatim preserves its error detail.
- **Where it's used** - dispatched for [PublishEventCommand](#publisheventcommand) from the Conference events REST controller; the `Unpublish` handler (not in this unit) mirrors it.

### RemoveEventQuestionAnswerHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventQuestionAnswer` · `MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventQuestionAnswer/RemoveEventQuestionAnswerHandler.cs:14` · Level 8 · class

- **What it is** - the handler that removes a question answer from an event, and the only remove handler in this unit that enforces per-record ownership authorization (BR-52/BR-53).
- **Depends on** - [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (`RemoveEventQuestionAnswerHandler.cs:15`), [ICurrentUserService](group-08-auth.md#icurrentuserservice) (`:16`), `ILogger<...>` (`:17`), the [ICommandHandler](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) contract (`:17`), the [Event](group-17-conference-domain.md#event) aggregate and its [EventQuestionAnswer](group-17-conference-domain.md#eventquestionanswer) children, [RoleNames](group-08-auth.md#rolenames) (`:6,35`), and [Result](group-01-result-error-handling.md#result)/[Error](group-01-result-error-handling.md#error).
- **Concept introduced** - *owner-or-admin authorization inside a command handler*. After loading the event with its answers included (`RemoveEventQuestionAnswerHandler.cs:25-29`), the handler finds the target answer among non-deleted children (`:34`) and rejects the delete with `Error.Forbidden` when the caller is neither in the `Organizer` role nor the answer's creator: `!currentUserService.IsInRole(RoleNames.Organizer) && answer.CreatedBy != currentUserService.UserId!.Value` (`RemoveEventQuestionAnswerHandler.cs:35-42`). This implements BR-52/BR-53 (attendees delete only their own answers, organizers delete any). `[Rubric §11 - Security]` assesses authorization placement: putting the ownership check in the handler keeps it enforced regardless of which controller or client invokes the command.
- **Walkthrough** - resolve repository and load the event with `includes: [nameof(Event.EventQuestionAnswers)]` and `asTracking: true` (`RemoveEventQuestionAnswerHandler.cs:24-29`), failing `NotFound` if absent (`:30-31`). Locate the active answer (`:34`); if found and the caller is not an organizer and not the owner, return `Error.Forbidden` with code `EventQuestionAnswer.NotOwner` (`:35-42`). Otherwise delegate to `entity.RemoveEventQuestionAnswer(...)` (`:44`); on success persist and log (`:45-49`); return the domain result (`:51`).
- **Why it's built this way** - loading `asTracking: true` is required because the removal mutates the aggregate's child collection; the ownership check runs before the domain call so an unauthorized delete never reaches the aggregate. Returning `Forbidden` (403 semantics) rather than `NotFound` is deliberate here because the caller already proved the answer exists by targeting a loaded event.
- **Where it's used** - dispatched for [RemoveEventQuestionAnswerCommand](#removeeventquestionanswercommand) from the Conference REST layer.
- **Caveats / not-in-source** - the check at `RemoveEventQuestionAnswerHandler.cs:34-35` only forbids when a matching active `answer` is found; if the answer id does not match a loaded child, the guard is skipped and the domain method decides the outcome.

### RemoveEventSpeakerHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventSpeaker` · `MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventSpeaker/RemoveEventSpeakerHandler.cs:13` · Level 8 · class

- **What it is** - the handler that removes a speaker association from an event by loading the aggregate with its speakers and delegating to the domain method.
- **Depends on** - [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (`RemoveEventSpeakerHandler.cs:14`), `ILogger<...>` (`:15`), the [ICommandHandler](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) contract returning [Result](group-01-result-error-handling.md#result) (`:15`), the [Event](group-17-conference-domain.md#event) aggregate and its [EventSpeaker](group-17-conference-domain.md#eventspeaker) children, and [Error](group-01-result-error-handling.md#error) (`:29`).
- **Concept introduced** - none new; this is the plain remove-child handler shape (no ownership check), shared with [RemoveRoomHandler](#removeroomhandler).
- **Walkthrough** - load the event with `includes: [nameof(Event.EventSpeakers)]` and `asTracking: true` (`RemoveEventSpeakerHandler.cs:23-27`), failing `NotFound` if missing (`:28-29`); call `entity.RemoveEventSpeaker(command.EventSpeakerId)` (`:31`); on success persist and log via `LogSpeakerRemovedFromEvent` (`:32-36`); return the domain result (`:38`).
- **Why it's built this way** - tracking is enabled because the child collection is mutated; the aggregate method owns the removal invariants, so the handler is a thin load-delegate-save shell.
- **Where it's used** - dispatched for [RemoveEventSpeakerCommand](#removeeventspeakercommand) from the Conference REST layer.

### RemoveRoomHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RemoveRoom` · `MMCA.ADC.Conference.Application/Events/UseCases/RemoveRoom/RemoveRoomHandler.cs:13` · Level 8 · class

- **What it is** - the handler that removes a room from an event, structurally identical to [RemoveEventSpeakerHandler](#removeeventspeakerhandler) but targeting the [Room](group-17-conference-domain.md#room) child collection.
- **Depends on** - [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (`RemoveRoomHandler.cs:14`), `ILogger<...>` (`:15`), the [ICommandHandler](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) contract returning [Result](group-01-result-error-handling.md#result) (`:15`), the [Event](group-17-conference-domain.md#event) aggregate and its [Room](group-17-conference-domain.md#room) children, and [Error](group-01-result-error-handling.md#error) (`:29`).
- **Concept introduced** - none new; identical remove-child flow to [RemoveEventSpeakerHandler](#removeeventspeakerhandler).
- **Walkthrough** - load the event with `includes: [nameof(Event.Rooms)]` and `asTracking: true` (`RemoveRoomHandler.cs:23-27`), failing `NotFound` if missing (`:28-29`); call `entity.RemoveRoom(command.RoomId)` (`:31`); on success persist and log via `LogRoomRemoved` (`:32-36`); return the domain result (`:38`).
- **Why it's built this way** - same rationale as the speaker remover: aggregate-owned invariants, thin handler, tracking on because the collection mutates.
- **Where it's used** - dispatched for [RemoveRoomCommand](#removeroomcommand) from the Conference rooms REST controller.

### QuestionCreateRequest
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Create/QuestionCreateRequest.cs:10` · Level 6 · record

- **What it is**: the input contract for creating a conference `Question` (the survey/registration questions attendees answer against events and sessions). It carries the question text, an optional target entity and input type, a sort order, and an "is required" flag.
- **Depends on**: [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) and [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) (both marker interfaces from the CQRS layer), and the `QuestionIdentifierType` alias plus [`Question`](group-17-conference-domain.md#question) for the cache-prefix type name.
- **Concept**: the request record is *both* the transport DTO and the CQRS command in this slice. A `QuestionCreateRequest` is dispatched directly to [`CreateQuestionHandler`](#createquestionhandler) (its handler is `ICommandHandler<QuestionCreateRequest, Result<QuestionDTO>>`), so there is no separate `CreateQuestionCommand` type. Implementing [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) lets the generic request-mapper pipeline recognize it, and [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) makes the caching decorator evict on success. `[Rubric §6, CQRS & Event-Driven]` assesses whether writes are modeled as explicit intents: here the intent, its validation, and its cache side effect are all declared on one immutable record.
- **Walkthrough**: `CachePrefix => $"{typeof(Question).FullName}:"` (`QuestionCreateRequest.cs:13`) names the cache region to purge. `Id` is an `init` property whose XML doc states it is auto-generated by the handler and caller-provided values are ignored (`QuestionCreateRequest.cs:16`); the server actually overwrites it (see [`CreateQuestionHandler`](#createquestionhandler)). `QuestionText` is `required` (`QuestionCreateRequest.cs:19`); `QuestionEntity` and `QuestionType` are nullable strings (`QuestionCreateRequest.cs:22-25`); `Sort` and `IsRequired` default to `0`/`false` (`QuestionCreateRequest.cs:28-31`).
- **Why it's built this way**: `required`/`init` gives immutability with compile-time enforcement of the mandatory field, and folding the command into the request keeps the create slice to one type. The cache prefix keyed on `typeof(Question).FullName` couples eviction to the entity, not to a hand-written string.
- **Where it's used**: constructed by the Questions controller and handed to [`CreateQuestionHandler`](#createquestionhandler), which routes it through [`QuestionCreateRequestMapper`](#questioncreaterequestmapper) to the `Question.Create` factory. Validated by [`QuestionCreateRequestValidator`](#questioncreaterequestvalidator).

### QuestionDTOMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/DTOs/QuestionDTOMapper.cs:12` · Level 6 · class (sealed partial)

- **What it is**: the read-side mapper that turns a [`Question`](group-17-conference-domain.md#question) domain entity into a [`QuestionDTO`](group-17-conference-domain.md#questiondto) for API responses.
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) (the mapper contract), [`Question`](group-17-conference-domain.md#question), [`QuestionDTO`](group-17-conference-domain.md#questiondto), and the Mapperly source generator (`Riok.Mapperly.Abstractions`, NuGet).
- **Concept introduced, compile-time DTO mapping with Mapperly.** `[Rubric §1, SOLID]` and `[Rubric §15, Best Practices & Code Quality]`. The class is `sealed partial` and carries the `[Mapper]` attribute (`QuestionDTOMapper.cs:11-12`); the `partial QuestionDTO MapToDTO(Question entity)` declaration (`QuestionDTOMapper.cs:16`) has no body, and the Mapperly generator emits the property-by-property copy at build time. There is no reflection and no runtime mapping engine: the generated method is ordinary code the analyzers can see, so a shape mismatch fails the build rather than a request ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html), manual/Mapperly DTO mapping). This is the shared shape for the family of `XDTOMapper` types in the Conference module; see [`CategoryItemDTOMapper`](#categoryitemdtomapper) for the sibling that also carries this pattern.
- **Walkthrough**: `MapToDTO` is the generated single-entity map (`QuestionDTOMapper.cs:16`). `MapToDTOs` (`QuestionDTOMapper.cs:19-23`) is hand-written: it null-guards the collection with `ArgumentNullException.ThrowIfNull` and returns a collection expression `[.. entityCollection.Select(MapToDTO)]`.
- **Why it's built this way**: generating the map keeps it fast and verifiable; the tiny hand-written collection wrapper exists because Mapperly generates the element map and the batch loop is trivial and null-guarded once.
- **Where it's used**: injected into the Questions read/query handlers and into [`CreateQuestionHandler`](#createquestionhandler), which calls `dtoMapper.MapToDTO(entity)` to shape its success payload.

### SpeakerCategoryItemDTOMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerCategoryItemDTOMapper.cs:12` · Level 6 · class (sealed partial)

- **What it is**: the Mapperly mapper from a [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem) join entity (a speaker's assignment to a category item, for example a locality tag) to its [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto).
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem), [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto), Mapperly (NuGet).
- **Concept**: identical in shape to [`QuestionDTOMapper`](#questiondtomapper): a `[Mapper]` `sealed partial` class with a generated `partial MapToDTO` (`SpeakerCategoryItemDTOMapper.cs:16`) and a hand-written null-guarded `MapToDTOs` (`SpeakerCategoryItemDTOMapper.cs:19-23`). See [`QuestionDTOMapper`](#questiondtomapper) for the Mapperly explanation; only the entity/DTO pair differs.
- **Where it's used**: registered as a `[UseMapper]` child of [`SpeakerDTOMapper`](#speakerdtomapper), so a speaker's category-item collection is mapped without the parent mapper duplicating the per-item logic.

### SpeakerLocalityHelper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/SpeakerLocalityHelper.cs:10` · Level 6 · class (internal static)

- **What it is**: a stateless helper for the session-selection decision-support analytics that answers "where is this speaker traveling from" and "does that make them a local speaker", reading the answer out of the category system rather than a dedicated field on `Speaker`.
- **Depends on**: [`Category`](group-17-conference-domain.md#category) and [`Speaker`](group-17-conference-domain.md#speaker) (Conference domain), plus the `CategoryItemIdentifierType` alias and BCL collections.
- **Concept introduced, locality-as-category (no dedicated speaker field).** `[Rubric §4, Domain-Driven Design]` and `[Rubric §8, Data Architecture]`. A speaker's origin is not a scalar column; it is a `SpeakerCategoryItem` assignment inside a "Where are you traveling from" category (Sessionize category id `121854`). This helper is the single place that lookup is encoded, so the rest of the analytics code deals in plain tier names ("Atlanta and Suburbs", "Georgia", "Surrounding State", "North America", "Not North America") rather than category ids.
- **Walkthrough**: four static methods form a small pipeline. `FindLocalityCategory` (`SpeakerLocalityHelper.cs:57-74`) scans the loaded [`Category`](group-17-conference-domain.md#category) list, skips soft-deleted rows, returns the first whose `Title` contains "traveling" (case-insensitive), and otherwise falls back to the category whose `Id == 121854` (`SpeakerLocalityHelper.cs:66-70`). `BuildLocalityLookup` (`SpeakerLocalityHelper.cs:81-89`) projects that category's non-deleted items into an `id → name` dictionary (empty dictionary when the category is null). `GetLocalityTier` (`SpeakerLocalityHelper.cs:19-33`) walks a speaker's `SpeakerCategoryItems`, skips deleted assignments, and returns the tier name for the first assignment found in that lookup, else `null`. `IsLocalSpeaker` (`SpeakerLocalityHelper.cs:41-49`) treats a tier as local when its name contains "Atlanta", "Georgia", or "Surrounding" (case-insensitive), and returns `false` for a null tier.
- **Why it's built this way**: modeling locality through the existing category machinery avoids a schema change and keeps the Sessionize import as the single source of that data (speaker location lives on `CategoryItem` category `121854`, not on `Speaker`). The title-match-with-id-fallback makes the lookup resilient to a renamed category while still working against the raw imported id. The string-contains local test is deliberately loose so tier labels can be reworded without touching this code.
- **Where it's used**: the session decision-support handlers that rank or annotate sessions by speaker locality (the `DecisionSupport` use-case folder it lives in).
- **Caveats / not-in-source**: `IsLocalSpeaker` matches by substring, so a future tier name that coincidentally contains one of those words would be classified local; that risk is not guarded in source.

### SpeakerQuestionAnswerDTOMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerQuestionAnswerDTOMapper.cs:12` · Level 6 · class (sealed partial)

- **What it is**: the Mapperly mapper from a [`SpeakerQuestionAnswer`](group-17-conference-domain.md#speakerquestionanswer) entity (a speaker's answer to a conference question) to its [`SpeakerQuestionAnswerDTO`](group-17-conference-domain.md#speakerquestionanswerdto).
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), [`SpeakerQuestionAnswer`](group-17-conference-domain.md#speakerquestionanswer), [`SpeakerQuestionAnswerDTO`](group-17-conference-domain.md#speakerquestionanswerdto), Mapperly (NuGet).
- **Concept**: structurally identical to [`QuestionDTOMapper`](#questiondtomapper): `[Mapper]` `sealed partial`, generated `partial MapToDTO` (`SpeakerQuestionAnswerDTOMapper.cs:16`), hand-written null-guarded `MapToDTOs` (`SpeakerQuestionAnswerDTOMapper.cs:19-23`). See [`QuestionDTOMapper`](#questiondtomapper) for the shared explanation.
- **Where it's used**: registered as a `[UseMapper]` child of [`SpeakerDTOMapper`](#speakerdtomapper) so speaker responses map alongside the parent.

### UnpublishEventCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Unpublish` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Unpublish/UnpublishEventCommand.cs:8` · Level 6 · record

- **What it is**: the command to unpublish an [`Event`](group-17-conference-domain.md#event), hiding it from attendees by transitioning it back to draft.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) and [`Event`](group-17-conference-domain.md#event) (for the cache-prefix type name), with `EventIdentifierType`.
- **Concept**: a minimal state-transition command carrying only the target id. `CachePrefix => $"{typeof(Event).FullName}:"` (`UnpublishEventCommand.cs:11`) evicts the event cache region on success. It is the mirror of the `PublishEventCommand` in this module; the actual state rule lives on the aggregate, not here. `[Rubric §6, CQRS & Event-Driven]`: a lifecycle change is a first-class command rather than a flag set on an update DTO.
- **Walkthrough**: a `sealed record UnpublishEventCommand(EventIdentifierType Id)` (`UnpublishEventCommand.cs:8`) with the single computed `CachePrefix` member (`UnpublishEventCommand.cs:11`).
- **Where it's used**: dispatched to [`UnpublishEventHandler`](#unpublisheventhandler), which loads the event and calls `Event.Unpublish()`.

### UpdateEventQuestionAnswerCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.UpdateEventQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/UpdateEventQuestionAnswer/UpdateEventQuestionAnswerCommand.cs:10` · Level 6 · record

- **What it is**: the command to change the value of an existing answer to a question inside an event.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), [`Event`](group-17-conference-domain.md#event) (cache prefix), with the `EventIdentifierType` and `EventQuestionAnswerIdentifierType` aliases.
- **Concept**: a child-mutation command that names both the owning aggregate and the child. `[Rubric §4, DDD]`: the child answer is mutated *through* its `Event` aggregate root, so the command carries `EventId` (the aggregate) and `EventQuestionAnswerId` (the child), not a free-floating answer id.
- **Walkthrough**: `sealed record UpdateEventQuestionAnswerCommand(EventIdentifierType EventId, EventQuestionAnswerIdentifierType EventQuestionAnswerId, string AnswerValue)` (`UpdateEventQuestionAnswerCommand.cs:10-13`), implementing `ICacheInvalidating` with `CachePrefix => $"{typeof(Event).FullName}:"` (`UpdateEventQuestionAnswerCommand.cs:16`).
- **Where it's used**: dispatched to [`UpdateEventQuestionAnswerHandler`](#updateeventquestionanswerhandler), which additionally enforces the answer-ownership rule.

### UpdateRoomCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/UpdateRoom/UpdateRoomCommand.cs:15` · Level 6 · record

- **What it is**: the command to update a [`Room`](group-17-conference-domain.md#room) that belongs to an event: its name, sort order, and optional capacity, floor, location, and accessibility info.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), [`Event`](group-17-conference-domain.md#event) (cache prefix), with the `EventIdentifierType` and `RoomIdentifierType` aliases.
- **Concept**: the richest child-update command in this unit, but the same shape as [`UpdateEventQuestionAnswerCommand`](#updateeventquestionanswercommand): identify the aggregate (`EventId`) and child (`RoomId`), then carry the new field values. Nullable parameters (`Capacity`, `Floor`, `Location`, `AccessibilityInfo`) model genuinely optional room metadata.
- **Walkthrough**: `sealed record UpdateRoomCommand(EventIdentifierType EventId, RoomIdentifierType RoomId, string Name, int Sort, int? Capacity, string? Floor, string? Location, string? AccessibilityInfo)` (`UpdateRoomCommand.cs:15-23`), with `CachePrefix => $"{typeof(Event).FullName}:"` (`UpdateRoomCommand.cs:26`).
- **Where it's used**: validated by [`UpdateRoomCommandValidator`](#updateroomcommandvalidator) and handled by [`UpdateRoomHandler`](#updateroomhandler), which delegates to `Event.UpdateRoom(...)`.

### QuestionCreateRequestMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Create/QuestionCreateRequestMapper.cs:11` · Level 7 · class (sealed)

- **What it is**: the write-side translator that turns a validated [`QuestionCreateRequest`](#questioncreaterequest) into a [`Question`](group-17-conference-domain.md#question) domain entity by calling the aggregate's `Create` factory.
- **Depends on**: [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype), [`Question`](group-17-conference-domain.md#question), [`QuestionCreateRequest`](#questioncreaterequest), and [`Result<T>`](group-01-result-error-handling.md#result).
- **Concept introduced, request-to-entity mapping through a factory returning [`Result<T>`](group-01-result-error-handling.md#result).** `[Rubric §4, DDD]`: unlike the read-side Mapperly mappers, an entity cannot be blindly copied from a DTO, because construction must pass the aggregate's invariants. So this mapper does not property-copy; it calls `Question.Create(...)`, which returns a [`Result<Question>`](group-01-result-error-handling.md#result) that is a failure if any invariant is violated. It is the counterpart to the DTO mappers: DTO mappers leave the domain, request mappers enter it.
- **Walkthrough**: `CreateEntityAsync` (`QuestionCreateRequestMapper.cs:15-27`) null-guards the request, then returns `Task.FromResult(Question.Create(...))`, forwarding `Id`, `QuestionText`, the null-forgiven `QuestionEntity!` and `QuestionType!`, `Sort`, `IsRequired`, and a fixed `questionSource: "User"` (`QuestionCreateRequestMapper.cs:19-26`). The literal `"User"` marks these as manually authored questions, distinct from Sessionize-imported ones. The `!` forgiveness relies on the validator having already enforced those fields.
- **Why it's built this way**: keeping construction inside the domain factory means the Application layer never builds a half-valid entity; the mapper is a thin adapter from transport shape to factory call. It is synchronous work wrapped in `Task.FromResult` to satisfy the async contract without a needless state machine.
- **Where it's used**: injected into [`CreateQuestionHandler`](#createquestionhandler) as `IEntityRequestMapper<Question, QuestionCreateRequest, QuestionIdentifierType>` and invoked after the handler has reserved an id.

### QuestionCreateRequestValidator
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Create/QuestionCreateRequestValidator.cs:7` · Level 7 · class (sealed)

- **What it is**: the FluentValidation validator for [`QuestionCreateRequest`](#questioncreaterequest).
- **Depends on**: `AbstractValidator<T>` (FluentValidation, NuGet) and the reusable `QuestionTextRules<T>` rule set from this module.
- **Concept**: rule composition via `Include`. `[Rubric §24, Forms/Validation/UX Safety]` and `[Rubric §16, Maintainability]`: rather than restating field rules, the validator pulls in a shared, per-field rule set so the create and update paths validate `QuestionText` identically. The same `Include(...)` idiom appears in [`UpdateRoomCommandValidator`](#updateroomcommandvalidator).
- **Walkthrough**: the constructor is a single expression-bodied `Include(new QuestionTextRules<QuestionCreateRequest>(p => p.QuestionText))` (`QuestionCreateRequestValidator.cs:9-10`); the property selector binds the shared rule set to this request's `QuestionText`.
- **Where it's used**: resolved by the validation decorator in the CQRS pipeline before [`QuestionCreateRequest`](#questioncreaterequest) reaches [`CreateQuestionHandler`](#createquestionhandler).

### SpeakerDTOMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerDTOMapper.cs:17` · Level 7 · class (sealed partial)

- **What it is**: the Mapperly mapper from a [`Speaker`](group-17-conference-domain.md#speaker) aggregate to a [`SpeakerDTO`](group-17-conference-domain.md#speakerdto). Unlike the plain mappers in this unit, it composes child mappers and redacts PII based on the caller's role.
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), the child mappers [`SpeakerCategoryItemDTOMapper`](#speakercategoryitemdtomapper) and [`SpeakerQuestionAnswerDTOMapper`](#speakerquestionanswerdtomapper), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), [`RoleNames`](group-08-auth.md#rolenames), the `Email` value object, and Mapperly (NuGet).
- **Concept introduced, PII redaction inside the mapper.** `[Rubric §11, Security]` and `[Rubric §5, Vertical Slice]`. BR-66 states that a speaker's email is PII and must not appear in public API responses. The mapper enforces this at the mapping boundary: it runs the generated map, then returns the DTO unchanged only when the current user is an `Organizer`, otherwise it strips the email. It also demonstrates Mapperly's `[UseMapper]` composition, where a parent mapper delegates child-collection mapping to injected sibling mappers instead of re-declaring those maps.
- **Walkthrough**: the primary constructor injects the two child mappers and [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (`SpeakerDTOMapper.cs:17-21`); the child mappers are stored in `[UseMapper]` fields so Mapperly wires them into the generated map (`SpeakerDTOMapper.cs:23-27`). The generated map itself is the private `MapToDTOGenerated` (`SpeakerDTOMapper.cs:46`). The public `MapToDTO` (`SpeakerDTOMapper.cs:30-37`) null-guards, calls the generated map, then applies BR-66: `currentUserService.IsInRole(RoleNames.Organizer) ? dto : dto with { Email = null }` (`SpeakerDTOMapper.cs:36`). `MapToDTOs` (`SpeakerDTOMapper.cs:40-44`) is the standard null-guarded batch. A private `NullableEmailToString(Email? email)` helper (`SpeakerDTOMapper.cs:49`) tells Mapperly how to flatten the `Email` value object to a string on the wire.
- **Why it's built this way**: putting the redaction in the mapper means every read path that returns a speaker gets BR-66 for free, rather than each controller remembering to strip email. Delegating to child mappers via `[UseMapper]` keeps the per-entity map defined once (in [`SpeakerCategoryItemDTOMapper`](#speakercategoryitemdtomapper) and [`SpeakerQuestionAnswerDTOMapper`](#speakerquestionanswerdtomapper)) and reused here.
- **Where it's used**: the Speaker query/read handlers and any handler returning a `SpeakerDTO`.
- **Caveats / not-in-source**: redaction keys off `RoleNames.Organizer` only; whether other roles should ever see the email is a policy question not expressed here.

### UpdateRoomCommandValidator
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/UpdateRoom/UpdateRoomCommandValidator.cs:7` · Level 7 · class (sealed)

- **What it is**: the FluentValidation validator for [`UpdateRoomCommand`](#updateroomcommand), composed from six reusable room field rule sets.
- **Depends on**: `AbstractValidator<T>` (FluentValidation, NuGet) and the module's `RoomNameRules<T>`, `RoomSortRules<T>`, `RoomCapacityRules<T>`, `RoomFloorRules<T>`, `RoomLocationRules<T>`, and `RoomAccessibilityInfoRules<T>` rule sets.
- **Concept**: the same `Include`-composition idiom as [`QuestionCreateRequestValidator`](#questioncreaterequestvalidator), scaled to six fields. Each field's rules live in one rule-set class shared between the add-room and update-room commands, so validation stays consistent across the two paths. `[Rubric §16, Maintainability]`.
- **Walkthrough**: the constructor `Include`s one rule set per field, each bound with a property selector: `RoomNameRules` on `Name`, `RoomSortRules` on `Sort`, `RoomCapacityRules` on `Capacity`, `RoomFloorRules` on `Floor`, `RoomLocationRules` on `Location`, and `RoomAccessibilityInfoRules` on `AccessibilityInfo` (`UpdateRoomCommandValidator.cs:11-16`).
- **Where it's used**: run by the validation decorator before [`UpdateRoomCommand`](#updateroomcommand) reaches [`UpdateRoomHandler`](#updateroomhandler).

### CreateQuestionHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Create/CreateQuestionHandler.cs:16` · Level 8 · class (sealed partial)

- **What it is**: the create handler for conference questions. It differs from a generic create in one way: it allocates the new id itself, from a reserved range, so it will not collide with ids that the Sessionize import assigns.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) (satisfied by [`QuestionCreateRequestMapper`](#questioncreaterequestmapper)), [`QuestionDTOMapper`](#questiondtomapper), `ILogger`, [`Question`](group-17-conference-domain.md#question), `QuestionInvariants`, and [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced, application-enforced key allocation.** `[Rubric §8, Data Architecture]`. The question id space is shared with an external system (Sessionize), so the database identity column cannot own it. Instead, the handler reserves a "manual" range (`QuestionInvariants.ManualIdRangeStart..ManualIdRangeEnd`) and picks the next free id inside it. This is the one create path in the unit that overrides the caller-supplied id rather than trusting or generating it downstream. The handler's command type *is* the request: it implements `ICommandHandler<QuestionCreateRequest, Result<QuestionDTO>>` (`CreateQuestionHandler.cs:20`).
- **Walkthrough**: `HandleAsync` (`CreateQuestionHandler.cs:23-59`) gets the `Question` repository (`CreateQuestionHandler.cs:27`), then loads all existing questions in the manual range with `ignoreQueryFilters: true` so soft-deleted rows still reserve their ids (`CreateQuestionHandler.cs:31-35`). `nextId` is `max + 1` or the range start when empty (`CreateQuestionHandler.cs:37-39`); exceeding `ManualIdRangeEnd` returns an [`Error.Failure`](group-01-result-error-handling.md#error) "Manual question ID range exhausted." (`CreateQuestionHandler.cs:41-42`). It then rewrites the command via `command = command with { Id = nextId }` (`CreateQuestionHandler.cs:45`), maps it to an entity through the request mapper (bailing on failure, `CreateQuestionHandler.cs:47-49`), adds and saves through the [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (`CreateQuestionHandler.cs:53-54`), logs via a source-generated `LogQuestionCreated` (`CreateQuestionHandler.cs:56,61-62`), and returns `Result.Success(dtoMapper.MapToDTO(entity))` (`CreateQuestionHandler.cs:58`).
- **Why it's built this way**: caller-provided ids are ignored so the manual and imported id ranges stay disjoint; counting soft-deleted rows into the reservation prevents an id being handed out twice after a delete. Everything else (audit stamping, domain-event capture, outbox writes) is the single `SaveChangesAsync` call the handler stays thin over.
- **Where it's used**: dispatched from the Questions controller via the CQRS pipeline (logging, caching, then this handler).

### UnpublishEventHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Unpublish` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Unpublish/UnpublishEventHandler.cs:13` · Level 8 · class (sealed partial)

- **What it is**: the handler for [`UnpublishEventCommand`](#unpublisheventcommand). It is the canonical "load aggregate, call a domain state-transition method, save on success" shape.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), `ILogger`, [`Event`](group-17-conference-domain.md#event), and [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept**: the thinnest handler in the unit. `[Rubric §4, DDD]` and `[Rubric §6, CQRS]`: the *decision* to unpublish (its invariants, its domain event) lives on the `Event` aggregate; the handler only orchestrates load, call, save.
- **Walkthrough**: `HandleAsync` (`UnpublishEventHandler.cs:18-35`) gets the `Event` repository, loads by id, and returns `Error.NotFound` (sourced/targeted to the handler and `Event`) when the row is missing (`UnpublishEventHandler.cs:22-25`). It calls `entity.Unpublish()` (`UnpublishEventHandler.cs:27`); only on `IsSuccess` does it `SaveChangesAsync` and log via `LogEventUnpublished` (`UnpublishEventHandler.cs:28-32`). It returns the domain [`Result`](group-01-result-error-handling.md#result) unchanged (`UnpublishEventHandler.cs:34`).
- **Why it's built this way**: guarding the save on `result.IsSuccess` means a domain-rule rejection never persists a partial change; returning the domain result verbatim preserves the aggregate's error to the caller.
- **Where it's used**: dispatched from the Events controller's unpublish endpoint.

### UpdateEventQuestionAnswerHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.UpdateEventQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/UpdateEventQuestionAnswer/UpdateEventQuestionAnswerHandler.cs:14` · Level 8 · class (sealed partial)

- **What it is**: the handler for [`UpdateEventQuestionAnswerCommand`](#updateeventquestionanswercommand). It is the "load aggregate, mutate child, save" shape plus an ownership check (BR-52/BR-53): attendees may edit only their own answers, organizers any.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), `ILogger`, [`Event`](group-17-conference-domain.md#event) (and its `EventQuestionAnswer` child), [`RoleNames`](group-08-auth.md#rolenames), and [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced, ownership authorization in the handler.** `[Rubric §11, Security]`. Whether a user may mutate a given answer depends on "who is the current user", which is an application concern, not a domain invariant, so the check lives here rather than on the aggregate. This is the discriminator that separates a plain child-update handler (like [`UpdateRoomHandler`](#updateroomhandler)) from an owned-child handler.
- **Walkthrough**: `HandleAsync` (`UpdateEventQuestionAnswerHandler.cs:20-54`) loads the `Event` with `includes: [nameof(Event.EventQuestionAnswers)]` and `asTracking: true` (`UpdateEventQuestionAnswerHandler.cs:24-29`) so EF has the child collection loaded and tracked for the domain mutation; a missing event returns `Error.NotFound` (`UpdateEventQuestionAnswerHandler.cs:30-31`). It finds the non-deleted answer by id (`UpdateEventQuestionAnswerHandler.cs:34`), and if the caller is not an `Organizer` and `answer.CreatedBy != currentUserService.UserId!.Value`, returns an `Error.Forbidden` coded `EventQuestionAnswer.NotOwner` (`UpdateEventQuestionAnswerHandler.cs:35-42`). Otherwise it delegates to `entity.UpdateEventQuestionAnswer(id, value)` (`UpdateEventQuestionAnswerHandler.cs:44-46`), and on success saves and logs (`UpdateEventQuestionAnswerHandler.cs:47-51`).
- **Why it's built this way**: the include-and-track pair is required because the domain method walks the answer collection and EF must be tracking it to persist the change. Returning `Forbidden` before touching the domain keeps authorization and business rules cleanly separated.
- **Where it's used**: dispatched from the event question-answer controller endpoint.

### UpdateRoomHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/UpdateRoom/UpdateRoomHandler.cs:13` · Level 8 · class (sealed partial)

- **What it is**: the handler for [`UpdateRoomCommand`](#updateroomcommand). It loads the owning [`Event`](group-17-conference-domain.md#event) with its rooms and delegates the mutation to `Event.UpdateRoom(...)`.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), `ILogger`, [`Event`](group-17-conference-domain.md#event) (and its `Room` child), and [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept**: the plain child-update sibling of [`UpdateEventQuestionAnswerHandler`](#updateeventquestionanswerhandler), without the ownership check (a room is organizer-managed metadata, not user-owned content). Same include-and-track requirement, since the domain method walks the `Rooms` collection.
- **Walkthrough**: `HandleAsync` (`UpdateRoomHandler.cs:18-46`) loads the `Event` with `includes: [nameof(Event.Rooms)]` and `asTracking: true` (`UpdateRoomHandler.cs:23-27`), returns `Error.NotFound` when missing (`UpdateRoomHandler.cs:28-29`), then calls `entity.UpdateRoom(command.RoomId, command.Name, command.Sort, command.Capacity, command.Floor, command.Location, command.AccessibilityInfo)` (`UpdateRoomHandler.cs:31-38`). On success it saves and logs via `LogRoomUpdated` (`UpdateRoomHandler.cs:39-43`), returning the domain [`Result`](group-01-result-error-handling.md#result) (`UpdateRoomHandler.cs:45`).
- **Why it's built this way**: uniform load-mutate-save keeps the handler a five-line orchestration over the aggregate; the validity of each field was already enforced by [`UpdateRoomCommandValidator`](#updateroomcommandvalidator), so the handler trusts the command shape and defers business rules to `Event.UpdateRoom`.
- **Where it's used**: dispatched from the event rooms controller endpoint.

### AddSpeakerCategoryItemCommand, RemoveSpeakerCategoryItemCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem` / `.RemoveSpeakerCategoryItem` · Level 6 · record (sealed)

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `AddSpeakerCategoryItemCommand` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/AddSpeakerCategoryItem/AddSpeakerCategoryItemCommand.cs:13` | Carries an optional `SpeakerCategoryItemId` (explicit join-entity id or `null` for a database-generated identity) plus the `CategoryItemId` to associate. |
| `RemoveSpeakerCategoryItemCommand` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/RemoveSpeakerCategoryItem/RemoveSpeakerCategoryItemCommand.cs:12` | Carries only the `SpeakerCategoryItemId` of the join entity to remove (no `CategoryItemId`). |

- **What they are**: the two child-collection commands that add or remove a category-item association on an existing [`Speaker`](group-17-conference-domain.md#speaker) aggregate. They are plain immutable message records; all behavior lives in the handlers below.
- **Depends on**: the `SpeakerIdentifierType` / `SpeakerCategoryItemIdentifierType` / `CategoryItemIdentifierType` module aliases (see the primer on identifier-type aliases), [`Speaker`](group-17-conference-domain.md#speaker) (only to compute the cache prefix), and [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating).
- **Concept introduced: cache invalidation carried by the command.** Both records implement [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) and expose `CachePrefix => $"{typeof(Speaker).FullName}:"` (`AddSpeakerCategoryItemCommand.cs:19`, `RemoveSpeakerCategoryItemCommand.cs:17`). That property is what the caching decorator in the CQRS pipeline reads to evict every speaker-scoped cache entry when the command succeeds. The prefix is computed at the type level, not per instance, so mutating any speaker (or its child associations) evicts the whole speaker cache uniformly rather than one key. `[Rubric §6: CQRS & Event-Driven]` (a distinct command type per operation, each carrying its own cross-cutting contract). `[Rubric §12: Performance & Scalability]` (cache eviction is co-located with the command, not scattered into handler code).
- **Walkthrough**: `AddSpeakerCategoryItemCommand` (`:13-16`) takes `SpeakerId`, a nullable `SpeakerCategoryItemId`, and `CategoryItemId`; the nullable id lets a caller supply an explicit join key (used by the Sessionize import for idempotent upserts) or leave it `null` for database identity. `RemoveSpeakerCategoryItemCommand` (`:12-14`) takes only `SpeakerId` and the `SpeakerCategoryItemId` to drop.
- **Why it's built this way**: the command is the smallest possible contract: it names the aggregate and the child, and declares its cache-eviction intent. Everything else (loading, invariant checks, saving) is the handler's job.
- **Where they're used**: dispatched from `SpeakerCategoryItemsController` through the CQRS pipeline to [`AddSpeakerCategoryItemHandler`](#addspeakercategoryitemhandler-removespeakercategoryitemhandler) / [`RemoveSpeakerCategoryItemHandler`](#addspeakercategoryitemhandler-removespeakercategoryitemhandler).

### LinkUserToSpeakerCommand, UnlinkUserFromSpeakerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.LinkUser` / `.UnlinkUser` · Level 6 · record (sealed)

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `LinkUserToSpeakerCommand` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/LinkUser/LinkUserToSpeakerCommand.cs:13` | Carries both `SpeakerId` and the `UserId` to link (BR-209). |
| `UnlinkUserFromSpeakerCommand` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/UnlinkUser/UnlinkUserFromSpeakerCommand.cs:12` | Carries only `SpeakerId`; the previously linked user is recovered from the aggregate. |

- **What they are**: the commands that establish or tear down the bidirectional User to Speaker association (BR-209). When a conference speaker also holds an application account, linking connects the Conference-side `Speaker.LinkedUserId` to the Identity-side `User.LinkedSpeakerId`.
- **Depends on**: the `SpeakerIdentifierType` / `UserIdentifierType` module aliases, [`Speaker`](group-17-conference-domain.md#speaker) (for the cache prefix), [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), and [`ITransactional`](group-05-cqrs-pipeline.md#itransactional).
- **Concept reinforced: the transactional command marker.** Beyond the cache prefix (`LinkUserToSpeakerCommand.cs:16`, `UnlinkUserFromSpeakerCommand.cs:15`), both records also implement [`ITransactional`](group-05-cqrs-pipeline.md#itransactional) (`:13` / `:12`). That marker tells the transactional decorator in the CQRS pipeline to wrap the handler in a database transaction, which matters here because the handler mutates the Speaker aggregate and, in the same `SaveChangesAsync`, writes an outbox row carrying the cross-context event. The transaction guarantees the local link change and the outbox capture commit or roll back together. `[Rubric §6: CQRS & Event-Driven]`. `[Rubric §7: Microservices Readiness]` (the transaction boundary is what keeps the eventual cross-service update from being lost on a crash).
- **Walkthrough**: `LinkUserToSpeakerCommand` (`:13`) is a two-field record (`SpeakerId`, `UserId`). `UnlinkUserFromSpeakerCommand` (`:12`) is a one-field record (`SpeakerId`); it deliberately does not name a user, because the handler reads the currently linked user off the aggregate before clearing it so the emitted event can name whom it unlinked.
- **Why it's built this way**: the two modules own separate databases ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), so there is no foreign key between `Speaker` and `User`. The link is kept consistent through an integration event, and the `ITransactional` marker is what makes that event durable (see the handlers below).
- **Where they're used**: dispatched from `SpeakersController`'s link/unlink actions to [`LinkUserToSpeakerHandler`](#linkusertospeakerhandler-unlinkuserfromspeakerhandler) / [`UnlinkUserFromSpeakerHandler`](#linkusertospeakerhandler-unlinkuserfromspeakerhandler).

### SpeakerCreateRequest

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Create/SpeakerCreateRequest.cs:10` · Level 6 · record

- **What it is**: the request DTO for creating a new conference speaker. Unlike the terse child-collection commands above, this is a wide record carrying every writable speaker field.
- **Depends on**: the `SpeakerIdentifierType` / `UserIdentifierType` module aliases, [`Speaker`](group-17-conference-domain.md#speaker) (for the cache prefix), [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest), and [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating).
- **Concept introduced: the create-request DTO as a pipeline hook.** By implementing [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) (`:10`), the record opts into the generic create pipeline: the request itself is dispatched as the command (there is no separate `CreateSpeakerCommand`), and a request mapper turns it into a domain entity. `required`/`init` members (`FirstName`, `LastName`, `FullName` at `:19-25`) enforce that the mandatory fields are present at construction, while the remaining nullable `init` fields (`Email`, `Bio`, `TagLine`, `ProfilePicture`, `TwitterHandle`, `LinkedInUrl`, `GitHubUrl`, `WebsiteUrl`, `LinkedUserId` at `:28-55`) are optional. `[Rubric §9: API & Contract Design]` (an explicit, immutable request contract with `required` guarantees). `[Rubric §5: Vertical Slice]` (the request, mapper, validator, and handler for Create sit in one folder).
- **Walkthrough**: `CachePrefix` (`:13`) evicts the speaker cache on success like the commands above. `Id` (`:16`) is a `SpeakerIdentifierType` (a Sessionize-assigned GUID), so the caller supplies the key rather than the database generating it. `IsTopSpeaker` (`:40`) is a plain `bool` flag; `LinkedUserId` (`:55`) is a nullable `UserIdentifierType` allowing a speaker to be created already linked to an account.
- **Why it's built this way**: a client-supplied `Id` plus `required` string fields lets the Sessionize import upsert speakers idempotently while the analyzers guarantee no mandatory field is silently defaulted.
- **Where it's used**: validated by [`SpeakerCreateRequestValidator`](#speakercreaterequestvalidator), mapped by [`SpeakerCreateRequestMapper`](#speakercreaterequestmapper), and handled by [`CreateSpeakerHandler`](#createspeakerhandler).

### AddSpeakerCategoryItemCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/AddSpeakerCategoryItem/AddSpeakerCategoryItemCommandValidator.cs:8` · Level 7 · class (sealed)

- **What it is**: the FluentValidation validator for [`AddSpeakerCategoryItemCommand`](#addspeakercategoryitemcommand-removespeakercategoryitemcommand), run by the validation decorator before the handler.
- **Depends on**: `FluentValidation.AbstractValidator<T>` (NuGet) and the `CategoryItemIdentifierType` module alias.
- **Concept reinforced: validation as a pipeline stage.** The validator subclasses `AbstractValidator<AddSpeakerCategoryItemCommand>` (`:8`); the CQRS pipeline resolves it and rejects the command with a validation error before the handler ever loads the aggregate. This one carries a single inline rule rather than composed rule objects (contrast [`SpeakerCreateRequestValidator`](#speakercreaterequestvalidator) below). `[Rubric §24: Forms, Validation & UX Safety]` (input is rejected at the boundary with a clear message). `[Rubric §15: Best Practices & Code Quality]`.
- **Walkthrough**: the constructor (`:10-13`) is an expression body: `RuleFor(x => x.CategoryItemId).NotEqual(default(CategoryItemIdentifierType)).WithMessage("Category item ID is required.")`. It guards against a caller passing the zero/empty identifier, which would otherwise fall through to a not-found at the handler.
- **Why it's built this way**: the only field worth validating on this command is the required `CategoryItemId`; a full rule-composition class would be overkill for one constraint.
- **Where it's used**: resolved automatically by the validation decorator wrapping [`AddSpeakerCategoryItemHandler`](#addspeakercategoryitemhandler-removespeakercategoryitemhandler).

### SpeakerCreateRequestMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Create/SpeakerCreateRequestMapper.cs:11` · Level 7 · class (sealed)

- **What it is**: the mapper that turns a [`SpeakerCreateRequest`](#speakercreaterequest) into a [`Speaker`](group-17-conference-domain.md#speaker) domain entity by delegating to the entity's `Create(...)` factory.
- **Depends on**: [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype), [`Speaker`](group-17-conference-domain.md#speaker), and [`Result`](group-01-result-error-handling.md#result).
- **Concept reinforced: the Application layer bridges the HTTP request to the domain factory.** The mapper implements `IEntityRequestMapper<Speaker, SpeakerCreateRequest, SpeakerIdentifierType>` (`:11-13`). Neither the controller nor the domain factory knows about the other: the handler calls the mapper, the mapper calls the one canonical construction path. It is a plain `sealed class` with no `[Mapper]` attribute, so this is hand-written mapping, not Mapperly source generation (contrast the DTO mappers). `[Rubric §3: Clean Architecture]`. `[Rubric §4: DDD]` (factory methods are the sole entity construction path).
- **Walkthrough**: `CreateEntityAsync` (`:15-28`) first guards `ArgumentNullException.ThrowIfNull(request)` (`:17`), then calls `Speaker.Create(request.Id, request.FirstName, request.LastName, request.Email, request.Bio, request.TagLine, request.ProfilePicture, request.IsTopSpeaker)` (`:19-27`) and wraps the returned `Result<Speaker>` in `Task.FromResult(...)`. Note that not every request field flows to the factory: the social/URL fields (`TwitterHandle`, `LinkedInUrl`, and so on) and `LinkedUserId` are not passed to `Speaker.Create` here. If the factory returns a failure (invalid data), that failure propagates up as a `Result` error rather than an exception.
- **Why it's built this way**: keeping construction in the domain factory and out of the controller/handler means invariant enforcement lives in one place, and the generic create pipeline can drive any aggregate through the same `IEntityRequestMapper` contract.
- **Where it's used**: injected into [`CreateSpeakerHandler`](#createspeakerhandler) as `IEntityRequestMapper<Speaker, SpeakerCreateRequest, SpeakerIdentifierType>`.
- **Caveats / not-in-source**: whether the URL/social fields are meant to be persisted at create time is Not determinable from source: the mapper simply does not forward them to the factory, and no later assignment is visible in this file.

### SpeakerCreateRequestValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Create/SpeakerCreateRequestValidator.cs:7` · Level 7 · class (sealed)

- **What it is**: the FluentValidation validator for [`SpeakerCreateRequest`](#speakercreaterequest), composed from reusable field-rule objects rather than inline rules.
- **Depends on**: `FluentValidation.AbstractValidator<T>` (NuGet), [`SpeakerFirstNameRules<T>`](#speakerfirstnamerulest), and [`SpeakerLastNameRules<T>`](#speakerlastnamerulest).
- **Concept reinforced: rule composition via `Include`.** The constructor (`:9-13`) calls `Include(new SpeakerFirstNameRules<SpeakerCreateRequest>(p => p.FirstName))` and `Include(new SpeakerLastNameRules<SpeakerCreateRequest>(p => p.LastName))`. FluentValidation's `Include(...)` copies every rule from the included validator into this one. Because the field rules are generic classes parameterized on the containing type and given a property selector, the same first-name and last-name constraints are shared between the speaker create and update validators without duplication: add a constraint once and both validators pick it up. `[Rubric §15: Best Practices & Code Quality]`. `[Rubric §24: Forms, Validation & UX Safety]` (consistent validation feedback across create and update).
- **Why it's built this way**: extracting field rules into shared classes is the module-wide convention for validators; it keeps field-level logic in one place across the create/update slices.
- **Where it's used**: resolved by the validation decorator in front of [`CreateSpeakerHandler`](#createspeakerhandler).

### AddSpeakerCategoryItemHandler, RemoveSpeakerCategoryItemHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem` / `.RemoveSpeakerCategoryItem` · Level 8 · class (sealed partial)

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `AddSpeakerCategoryItemHandler` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/AddSpeakerCategoryItem/AddSpeakerCategoryItemHandler.cs:15` | Returns `Result<SpeakerCategoryItemDTO>`; injects a DTO mapper; loads the speaker without an explicit include. |
| `RemoveSpeakerCategoryItemHandler` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/RemoveSpeakerCategoryItem/RemoveSpeakerCategoryItemHandler.cs:13` | Returns a bare `Result`; loads the speaker with an explicit `includes` array and `asTracking: true`. |

- **What they are**: the two CQRS command handlers that mutate a [`Speaker`](group-17-conference-domain.md#speaker) aggregate's category-item collection through its own domain methods.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`Speaker`](group-17-conference-domain.md#speaker), `ILogger` (BCL, source-generated `[LoggerMessage]`), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error); the Add handler also injects [`SpeakerCategoryItemDTOMapper`](#speakercategoryitemdtomapper) and returns [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto).
- **Concept reinforced: the aggregate as the unit of consistency, and `SaveChangesAsync` as the boundary to the framework.** Both handlers follow the canonical body: get a repository via `unitOfWork.GetRepository<Speaker, SpeakerIdentifierType>()`, load by id, fail with `Error.NotFound` if missing, call a domain method, and save only on success. `[Rubric §4: DDD]`. `[Rubric §6: CQRS & Event-Driven]`.
- **Walkthrough**: `AddSpeakerCategoryItemHandler.HandleAsync` (`:21-39`) loads the speaker (`:26`), returns `Result.Failure<SpeakerCategoryItemDTO>(Error.NotFound.WithSource(...).WithTarget(nameof(Speaker)))` when null (`:28`), then calls `speaker.AddSpeakerCategoryItem(command.SpeakerCategoryItemId, command.CategoryItemId)` (`:30`). On failure it returns the domain errors; on success it awaits `unitOfWork.SaveChangesAsync(...)` (`:34`), logs via the generated `LogCategoryItemAdded` (`:36`, `:41-42`), and returns `dtoMapper.MapToDTO(result.Value!)` (`:38`). `RemoveSpeakerCategoryItemHandler.HandleAsync` (`:18-40`) differs in loading: it passes `includes: [nameof(Speaker.SpeakerCategoryItems)]` and `asTracking: true` (`:23-27`) because the domain method `RemoveSpeakerCategoryItem` (`:31`) walks the child collection, so EF must have materialized it and be tracking changes. It returns a bare `Result` and saves only when the removal succeeds (`:32-34`).
- **Why it's built this way**: the include/tracking difference is the load-bearing distinction between add and remove handlers across the module: an add appends and needs no child collection loaded, whereas a remove/update must have the collection tracked. The single `SaveChangesAsync` call is the one boundary that triggers audit stamping, domain-event capture, and outbox writes; the handler never touches the database directly.
- **Where they're used**: dispatched from `SpeakerCategoryItemsController` for the speaker's category-item add/remove endpoints.

### CreateSpeakerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Create/CreateSpeakerHandler.cs:16` · Level 8 · class (sealed partial)

- **What it is**: the handler that creates a [`Speaker`](group-17-conference-domain.md#speaker): it maps the validated request to a domain entity, adds it to the repository, saves, and returns the mapped DTO.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) (satisfied by [`SpeakerCreateRequestMapper`](#speakercreaterequestmapper)), [`SpeakerDTOMapper`](#speakerdtomapper), `ILogger`, and [`Result`](group-01-result-error-handling.md#result).
- **Concept reinforced: the generic create slice, end to end.** The request itself is the command: the class implements `ICommandHandler<SpeakerCreateRequest, Result<SpeakerDTO>>` (`:20`). `[Rubric §5: Vertical Slice]`. `[Rubric §3: Clean Architecture]` (the handler orchestrates mapper, repository, and DTO mapper without embedding domain construction).
- **Walkthrough**: `HandleAsync` (`:23-40`) calls `requestMapper.CreateEntityAsync(command, ...)` (`:27`), returning the mapper's errors on failure (`:28-29`). On success it takes `result.Value!` (`:31`), gets the speaker repository (`:32`), awaits `repository.AddAsync(entity, ...)` then `unitOfWork.SaveChangesAsync(...)` (`:34-35`), logs via the generated `LogSpeakerCreated` (`:37`, `:42-43`), and returns `Result.Success(dtoMapper.MapToDTO(entity))` (`:39`).
- **Why it's built this way**: validation, cache invalidation, and transaction concerns are handled by the pipeline decorators around this handler, so the create logic reduces to map, add, save, and return a DTO. The `SpeakerDTOMapper` keeps the domain entity from leaking across the API boundary.
- **Where it's used**: dispatched from `SpeakersController`'s create endpoint via the CQRS pipeline.

### LinkUserToSpeakerHandler, UnlinkUserFromSpeakerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.LinkUser` / `.UnlinkUser` · Level 8 · class (sealed partial)

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `LinkUserToSpeakerHandler` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/LinkUser/LinkUserToSpeakerHandler.cs:20` | Enforces BR-208 (no other speaker already linked to the user) and raises [`SpeakerLinkedToUser`](group-17-conference-domain.md#speakerlinkedtouser). |
| `UnlinkUserFromSpeakerHandler` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/UnlinkUser/UnlinkUserFromSpeakerHandler.cs:19` | Captures the previously linked user before clearing it and raises [`SpeakerUnlinkedFromUser`](group-17-conference-domain.md#speakerunlinkedfromuser). |

- **What they are**: the handlers that mutate the Conference side of the bidirectional User to Speaker link (`Speaker.LinkedUserId`) and emit an integration event so the Identity side (`User.LinkedSpeakerId`) updates independently.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`Speaker`](group-17-conference-domain.md#speaker), `ILogger`, [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error), and the [`SpeakerLinkedToUser`](group-17-conference-domain.md#speakerlinkedtouser) / [`SpeakerUnlinkedFromUser`](group-17-conference-domain.md#speakerunlinkedfromuser) integration-event records. Note there is no injected event-publisher service: the event is raised on the aggregate.
- **Concept introduced: cross-context coordination through the outbox, captured in the same transaction.** The two modules own separate databases ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), so there is no foreign key between `Speaker` and `User`; consistency flows through events. Rather than publish after saving, each handler calls `speaker.AddDomainEvent(new SpeakerLinkedToUser(...))` (`LinkUserToSpeakerHandler.cs:54`) or `SpeakerUnlinkedFromUser` (`UnlinkUserFromSpeakerHandler.cs:42`) on the aggregate BEFORE the single `SaveChangesAsync`, so the outbox row is written in the same transaction as the link change ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)). The in-source comment (`LinkUserToSpeakerHandler.cs:51-53`) spells out why: a crash can no longer commit the Conference-side link while losing the event that updates the Identity side. The [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) later routes the event to the registered [`IMessageBus`](group-04-events-outbox.md#imessagebus) transport. This is why the commands carry [`ITransactional`](group-05-cqrs-pipeline.md#itransactional). `[Rubric §6: CQRS & Event-Driven]`. `[Rubric §7: Microservices Readiness]` (the update crosses a service boundary with no shared reference, making Conference and Identity independently extractable).
- **Walkthrough**: `LinkUserToSpeakerHandler.HandleAsync` (`:25-62`) loads the speaker (`:30`), returns `Error.NotFound` if missing (`:32`), then enforces BR-208 by querying all speakers whose `LinkedUserId` equals the target user and failing with `Error.Invariant(code: "Speaker.UserAlreadyLinked", ...)` if any other speaker already holds that link (`:35-46`). It calls `speaker.LinkUser(command.UserId)` (`:48`); on success it raises the event (`:54`), saves (`:56`), and logs (`:58`). `UnlinkUserFromSpeakerHandler.HandleAsync` (`:24-51`) loads the speaker, captures `speaker.LinkedUserId` into `previousUserId` (`:33`) before calling `speaker.UnlinkUser()` (`:34`), then, only when a previous user existed (`:40`), raises `SpeakerUnlinkedFromUser(previousUserId.Value, command.SpeakerId)` (`:42`) so the event can name the user that was unlinked, saves (`:45`), and logs (`:47`).
- **Why it's built this way**: raising the event on the aggregate pre-save (instead of a post-save publisher call) is a deliberate durability fix: it removes the second commit that could drop the cross-context event. It is also what keeps the two modules decoupled, since neither references the other's Application or Domain.
- **Where they're used**: `SpeakersController`'s link/unlink actions; the emitted events are consumed on the Identity side to set or clear `User.LinkedSpeakerId`.

### AddSessionCategoryItemCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionCategoryItem/AddSessionCategoryItemCommand.cs:10` · Level 7 · record

- **What it is**: the command that associates a category item (a `SessionCategoryItem` join row) with an existing session. It carries the target session, an optional explicit id for the new join entity, and the category item to attach.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) (marker); [`Session`](group-17-conference-domain.md#session) (used only to build the cache prefix); the module identifier aliases `SessionIdentifierType`, `SessionCategoryItemIdentifierType`, and `CategoryItemIdentifierType` (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Concept introduced, the cache-invalidating child-add command shape.** `[Rubric §6, CQRS & Event-Driven]` assesses whether writes are modeled as distinct, single-purpose messages; this record is a pure write intent with no behavior beyond declaring which cached reads it should evict. `[Rubric §12, Performance & Scalability]` assesses caching discipline: implementing [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) with `CachePrefix => $"{typeof(Session).FullName}:"` (`AddSessionCategoryItemCommand.cs:16`) is what lets the caching decorator in the CQRS pipeline drop every cached read keyed under the `Session` type once the write commits. Every session child-add command in this unit shares that identical one-line prefix.
- **Walkthrough**: a `sealed record` with a three-parameter positional constructor (`AddSessionCategoryItemCommand.cs:10-13`): `SessionId`, a nullable `SessionCategoryItemId` (`:12`, where `null` means the database generates the join-row identity), and `CategoryItemId`. Its single read-only member is `CachePrefix` (`:16`).
- **Why it's built this way**: records give value equality and immutability for free, and keeping the cache tag on the message rather than in the handler means the pipeline decorator, not the handler, owns eviction (see the decorator pipeline in [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)). The nullable identity parameter lets a Sessionize import supply the source system's id while an interactive create lets the database assign one.
- **Where it's used**: dispatched by `SessionCategoryItemsController` ([Group 20](group-20-conference-api-grpc.md#sessioncategoryitemscontroller)); validated by [`AddSessionCategoryItemCommandValidator`](#addsessioncategoryitemcommandvalidator); handled by [`AddSessionCategoryItemHandler`](#addsessioncategoryitemhandler).

### AddSessionQuestionAnswerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionQuestionAnswer/AddSessionQuestionAnswerCommand.cs:11` · Level 7 · record

- **What it is**: the command that adds (or upserts) a question answer on an existing session. It carries the target session, an optional explicit answer id, the question being answered, and the answer text.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); [`Session`](group-17-conference-domain.md#session) (cache prefix); the aliases `SessionIdentifierType`, `SessionQuestionAnswerIdentifierType`, `QuestionIdentifierType`; BCL `string`.
- **Concept reinforced, cache-invalidating command.** Same shape as [`AddSessionCategoryItemCommand`](#addsessioncategoryitemcommand): a write message tagged with the shared `Session` cache prefix (`AddSessionQuestionAnswerCommand.cs:18`). The one structural difference is a fourth parameter, the free-text `AnswerValue`. `[Rubric §6, CQRS & Event-Driven]`.
- **Walkthrough**: a `sealed record` with a four-parameter positional constructor (`AddSessionQuestionAnswerCommand.cs:11-15`): `SessionId`, a nullable `SessionQuestionAnswerId` (`:13`, `null` for database-generated identity), `QuestionId`, and the `string AnswerValue`. `CachePrefix` at `:18`.
- **Where it's used**: dispatched by `SessionQuestionAnswersController` ([Group 20](group-20-conference-api-grpc.md#sessionquestionanswerscontroller)); validated by [`AddSessionQuestionAnswerCommandValidator`](#addsessionquestionanswercommandvalidator); handled by [`AddSessionQuestionAnswerHandler`](#addsessionquestionanswerhandler).

### AddSessionSpeakerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionSpeaker/AddSessionSpeakerCommand.cs:10` · Level 7 · record

- **What it is**: the command that associates a speaker with an existing session by creating a `SessionSpeaker` join row.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); [`Session`](group-17-conference-domain.md#session) (cache prefix); the aliases `SessionIdentifierType`, `SessionSpeakerIdentifierType`, `SpeakerIdentifierType`.
- **Concept reinforced, cache-invalidating command.** Structurally identical to [`AddSessionCategoryItemCommand`](#addsessioncategoryitemcommand): a three-parameter write message carrying the owning session, a nullable join-row id, and the related entity id, tagged with the shared `Session` cache prefix. `[Rubric §6, CQRS & Event-Driven]`.
- **Walkthrough**: a `sealed record` with three parameters (`AddSessionSpeakerCommand.cs:10-13`): `SessionId`, a nullable `SessionSpeakerId` (`:12`, `null` for database-generated identity), and `SpeakerId`. `CachePrefix` at `:16`.
- **Where it's used**: dispatched by `SessionSpeakersController` ([Group 20](group-20-conference-api-grpc.md#sessionspeakerscontroller)); validated by [`AddSessionSpeakerCommandValidator`](#addsessionspeakercommandvalidator); handled by [`AddSessionSpeakerHandler`](#addsessionspeakerhandler).

### OwnSessionQuestionAnswerSpecification

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.Specifications` · `MMCA.ADC.Conference.Application/Sessions/Specifications/OwnSessionQuestionAnswerSpecification.cs:11` · Level 7 · class

- **What it is**: a query specification that filters session question answers down to those created by one specific user (BR-9). Attendees see only their own answers; organizers bypass the filter (the callers pass `null` rather than this specification).
- **Depends on**: [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype) (the reusable base); [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer) and its `SessionQuestionAnswerIdentifierType` alias; the `UserIdentifierType` alias; BCL `System.Linq.Expressions`.
- **Concept reinforced, the specification pattern for row-level read filtering.** The specification pattern itself is introduced in [Group 3](group-03-querying-specifications.md#specificationtentity-tidentifiertype); this is a concrete instance of it in the Conference module. `[Rubric §11, Security]` assesses whether access is scoped per record and not just per route: the specification encodes ownership as data (`CreatedBy == userId`) so the repository translates it into a `WHERE` clause, keeping other attendees' answers out of the result set at the database rather than filtering in memory. `[Rubric §3, Clean Architecture]` assesses whether query intent lives in a first-class, testable object instead of an inline LINQ predicate scattered across handlers.
- **Walkthrough**: a `sealed class` with a primary constructor taking a `UserIdentifierType userId` (`OwnSessionQuestionAnswerSpecification.cs:11`), deriving from `Specification<SessionQuestionAnswer, SessionQuestionAnswerIdentifierType>` (`:12`). It overrides the single abstract member `Criteria` (`:15-16`) to return the expression `a => a.CreatedBy == userId`.
- **Why it's built this way**: expressing the ownership filter as a reusable specification means the "attendees see only their own" rule is one object that both the read query and its tests can compose, and the organizer bypass stays an explicit caller decision (pass the specification or pass `null`) rather than a branch buried inside a handler.
- **Where it's used**: consumed by the session-question-answer read/list query handlers (outside this unit) when the current user is a non-organizer.
- **Caveats / not-in-source**: the organizer-bypass convention ("pass `null`") is documented in this file's XML summary (`OwnSessionQuestionAnswerSpecification.cs:9`) but is enforced by the query handlers that call it, which are not in this unit.

### SessionCategoryItemDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.DTOs` · `MMCA.ADC.Conference.Application/Sessions/DTOs/SessionCategoryItemDTOMapper.cs:12` · Level 7 · class

- **What it is**: a Mapperly source-generated mapper that turns a [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem) domain entity into a [`SessionCategoryItemDTO`](group-17-conference-domain.md#sessioncategoryitemdto) for the API boundary.
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) (the framework contract); [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem) and [`SessionCategoryItemDTO`](group-17-conference-domain.md#sessioncategoryitemdto); the `SessionCategoryItemIdentifierType` alias; Riok.Mapperly's `[Mapper]` attribute (NuGet, source generator).
- **Concept introduced, compile-time DTO mapping via Mapperly.** `[Rubric §9, API & Contract Design]` assesses whether the domain-to-contract translation is explicit and stable. `[Rubric §12, Performance & Scalability]` and `[Rubric §15, Best Practices & Code Quality]` also apply: Mapperly emits the field-copy code at compile time, so there is no runtime reflection and the mapping is analyzer-visible. The class is a `sealed partial class` decorated with `[Mapper]` (`SessionCategoryItemDTOMapper.cs:11-13`); the generator fills in the body of the single-entity `partial SessionCategoryItemDTO MapToDTO(SessionCategoryItem entity)` (`:16`). The collection overload `MapToDTOs` (`:19-23`) is hand-written: it null-guards with `ArgumentNullException.ThrowIfNull` and projects with a collection expression (`[.. entityCollection.Select(MapToDTO)]`). Manual DTO mapping (here via a generator) is the framework norm per [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html).
- **Why it's built this way**: a dedicated generated mapper per entity keeps the projection close to the type it maps, stays free of reflection cost, and lets the analyzer flag any unmapped member at build time rather than silently dropping fields.
- **Where it's used**: injected into [`AddSessionCategoryItemHandler`](#addsessioncategoryitemhandler) to project the result, and composed into [`SessionDTOMapper`](#sessiondtomapper) (via `[UseMapper]`) so the parent session mapping reuses it for the nested collection.

### SessionQuestionAnswerDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.DTOs` · `MMCA.ADC.Conference.Application/Sessions/DTOs/SessionQuestionAnswerDTOMapper.cs:12` · Level 7 · class

- **What it is**: the Mapperly mapper for [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer) entities to [`SessionQuestionAnswerDTO`](group-17-conference-domain.md#sessionquestionanswerdto).
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype); [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer) and [`SessionQuestionAnswerDTO`](group-17-conference-domain.md#sessionquestionanswerdto); the `SessionQuestionAnswerIdentifierType` alias; Riok.Mapperly.
- **Concept reinforced, generated DTO mapping.** Byte-for-byte the same shape as [`SessionCategoryItemDTOMapper`](#sessioncategoryitemdtomapper): `[Mapper] sealed partial class` (`SessionQuestionAnswerDTOMapper.cs:11-13`), generated `partial MapToDTO` (`:16`), and the hand-written null-guarded `MapToDTOs` projection (`:19-23`). `[Rubric §9, API & Contract Design]`.
- **Where it's used**: injected into [`AddSessionQuestionAnswerHandler`](#addsessionquestionanswerhandler) and composed into [`SessionDTOMapper`](#sessiondtomapper) via `[UseMapper]`.

### SessionSpeakerDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.DTOs` · `MMCA.ADC.Conference.Application/Sessions/DTOs/SessionSpeakerDTOMapper.cs:12` · Level 7 · class

- **What it is**: the Mapperly mapper for [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) entities to [`SessionSpeakerDTO`](group-17-conference-domain.md#sessionspeakerdto).
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype); [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) and [`SessionSpeakerDTO`](group-17-conference-domain.md#sessionspeakerdto); the `SessionSpeakerIdentifierType` alias; Riok.Mapperly.
- **Concept reinforced, generated DTO mapping.** Identical structure to [`SessionCategoryItemDTOMapper`](#sessioncategoryitemdtomapper): `[Mapper] sealed partial class` (`SessionSpeakerDTOMapper.cs:11-13`), generated `partial MapToDTO` (`:16`), and the hand-written `MapToDTOs` (`:19-23`). `[Rubric §9, API & Contract Design]`.
- **Where it's used**: injected into [`AddSessionSpeakerHandler`](#addsessionspeakerhandler) and composed into [`SessionDTOMapper`](#sessiondtomapper) via `[UseMapper]`.

### AddSessionCategoryItemCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionCategoryItem/AddSessionCategoryItemCommandValidator.cs:8` · Level 8 · class

- **What it is**: a single-rule FluentValidation validator that guards [`AddSessionCategoryItemCommand`](#addsessioncategoryitemcommand) before its handler runs.
- **Depends on**: FluentValidation's `AbstractValidator<TCommand>` (NuGet); the `CategoryItemIdentifierType` alias.
- **Concept introduced, input validation at the command boundary (the pipeline's first business stage).** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether input is checked before business logic executes. This `sealed class` has one `RuleFor` (`AddSessionCategoryItemCommandValidator.cs:10-13`): `RuleFor(x => x.CategoryItemId).NotEqual(default(CategoryItemIdentifierType)).WithMessage("Category item ID is required.")`. It is auto-discovered by the framework's assembly scan and invoked by the validating decorator in the CQRS pipeline ahead of the matching handler, so the handler can assume the id is present. Only the cheap shape check lives here; the deeper rule (does that category item actually exist and apply) is enforced later in the domain aggregate.
- **Why it's built this way**: separating "is the request well-formed?" (declarative validator) from "is the operation allowed?" (handler and domain invariants) keeps each concern in one place, and the convention scan wires in a new command simply by the presence of a validator class.
- **Where it's used**: run by the validating command decorator ahead of [`AddSessionCategoryItemHandler`](#addsessioncategoryitemhandler).

### AddSessionCategoryItemHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionCategoryItem/AddSessionCategoryItemHandler.cs:16` · Level 8 · class

- **What it is**: the handler that adds a category-item association to a session. It is the canonical "load aggregate, call domain method, save, map" template with no extra guards.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error); [`Session`](group-17-conference-domain.md#session) and [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem); [`SessionCategoryItemDTOMapper`](#sessioncategoryitemdtomapper); `Microsoft.Extensions.Logging`.
- **Concept introduced, the load-aggregate then delegate-mutation template plus source-generated logging.** `[Rubric §5, Vertical Slice]` assesses whether each write is a thin, self-contained slice; this file is that slice end to end. `[Rubric §6, CQRS & Event-Driven]` assesses the command handler contract: it implements `ICommandHandler<AddSessionCategoryItemCommand, Result<SessionCategoryItemDTO>>` (`AddSessionCategoryItemHandler.cs:19`). `[Rubric §13, Observability & Operability]` assesses structured logging: the `sealed partial class` plus `[LoggerMessage]` (`:42-43`) emit a zero-allocation, compile-checked log helper, the pattern every handler in this unit uses.
- **Walkthrough**
  - Primary constructor (`:16-19`): [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), a [`SessionCategoryItemDTOMapper`](#sessioncategoryitemdtomapper), and `ILogger<AddSessionCategoryItemHandler>`.
  - `HandleAsync` (`:22`) resolves the repository (`:26`) and loads the session by id (`:27`). Note this handler calls the plain `GetByIdAsync(command.SessionId, cancellationToken)` with no include list and no tracking flag, unlike [`AddSessionSpeakerHandler`](#addsessionspeakerhandler) and [`AddSessionQuestionAnswerHandler`](#addsessionquestionanswerhandler), which load the child navigation with `asTracking: true`.
  - A missing session returns `Error.NotFound` with source and target set (`:28-29`).
  - It delegates to `session.AddSessionCategoryItem(command.SessionCategoryItemId, command.CategoryItemId)` (`:31`); a failed [`Result`](group-01-result-error-handling.md#result) is passed straight through (`:32-33`).
  - On success it saves through the unit of work with `ConfigureAwait(false)` (`:35`), logs via the generated helper (`:37`), and returns `Result.Success(dtoMapper.MapToDTO(result.Value!))` (`:39`).
- **Why it's built this way**: pushing the "may this category item be added?" decision into `Session.AddSessionCategoryItem` keeps the handler as pure orchestration, so the interesting invariant stays unit-testable on the aggregate and this same shape recurs across the module.
- **Where it's used**: registered by the Conference application DI scan; invoked by the CQRS pipeline for `SessionCategoryItemsController` posts ([Group 20](group-20-conference-api-grpc.md#sessioncategoryitemscontroller)).

### AddSessionQuestionAnswerCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionQuestionAnswer/AddSessionQuestionAnswerCommandValidator.cs:8` · Level 8 · class

- **What it is**: a single-rule FluentValidation validator for [`AddSessionQuestionAnswerCommand`](#addsessionquestionanswercommand).
- **Depends on**: FluentValidation's `AbstractValidator<TCommand>`.
- **Concept reinforced, command-boundary validation.** Same shape as [`AddSessionCategoryItemCommandValidator`](#addsessioncategoryitemcommandvalidator). Its one rule (`AddSessionQuestionAnswerCommandValidator.cs:10-13`) is `RuleFor(x => x.AnswerValue).NotEmpty().WithMessage("Answer value is required.")`, a check that the answer text is non-blank. The deeper rules (the question exists, targets sessions, and the value matches the question type) need the loaded aggregate and therefore live in [`AddSessionQuestionAnswerHandler`](#addsessionquestionanswerhandler) instead. `[Rubric §24, Forms, Validation & UX Safety]`.
- **Where it's used**: run by the validating decorator ahead of [`AddSessionQuestionAnswerHandler`](#addsessionquestionanswerhandler).

### AddSessionQuestionAnswerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionQuestionAnswer/AddSessionQuestionAnswerHandler.cs:19` · Level 8 · class

- **What it is**: the richest handler in this unit. It adds a question answer to a session, but first enforces a chain of business rules across three aggregates and then performs an upsert (update the caller's existing answer, or create a new one).
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice); [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error); the domain types [`Session`](group-17-conference-domain.md#session), [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer), [`Question`](group-17-conference-domain.md#question), [`Event`](group-17-conference-domain.md#event) and the invariant helpers [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants), [`EventInvariants`](group-17-conference-domain.md#eventinvariants), [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants); the [`SessionQuestionAnswerDTOMapper`](#sessionquestionanswerdtomapper); `Microsoft.Extensions.Logging`.
- **Concept introduced, the guarded multi-aggregate handler.** `[Rubric §4, DDD]` assesses whether business rules run through named domain invariants rather than being scattered ad hoc; this handler routes every check into an invariant helper or an aggregate method and re-implements none of them. `[Rubric §13, Observability & Operability]` applies through the `sealed partial class` (`AddSessionQuestionAnswerHandler.cs:19`) plus `[LoggerMessage]` (`:133-134`).
- **Walkthrough**
  - Primary constructor (`:19-23`): [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), a [`SessionQuestionAnswerDTOMapper`](#sessionquestionanswerdtomapper), and the logger.
  - `HandleAsync` (`:26`) loads the session with its `SessionQuestionAnswers` navigation included and `asTracking: true` (`:30-35`); a missing session returns `Error.NotFound` (`:36-37`).
  - `ValidateSessionEligibilityAsync` (`:60`) enforces three rules in order: BR-91 (service sessions cannot receive feedback, via `SessionInvariants.EnsureNotServiceSession`, `:65`), BR-49 (only accepted/null-status sessions are eligible, via `SessionInvariants.EnsureStatusIsEligible`, `:70`), and BR-108 (the parent event must be published: it loads the [`Event`](group-17-conference-domain.md#event) through a second repository and calls `EventInvariants.EnsureEventIsPublished`, `:75-80`).
  - `ValidateQuestionAsync` (`:83`) enforces BR-128 (the question must exist and its `QuestionEntity` must equal `"Session"`, else `Error.Validation` with code `"Question.NotFoundOrWrongEntity"`, `:88-97`) and BR-124 (the answer value must match the question type, via `QuestionInvariants.EnsureAnswerValueMatchesQuestionType`, `:100-101`).
  - The upsert (BR-107, `:49-57`): it looks for an existing non-deleted answer with the same `QuestionId` created by the current user (`a => !a.IsDeleted && a.QuestionId == command.QuestionId && a.CreatedBy == userId`, `:51-52`). If found, `UpdateExistingAnswerAsync` (`:104`) delegates to `session.UpdateSessionQuestionAnswer(...)` (`:110`); otherwise `CreateNewAnswerAsync` (`:119`) delegates to `session.AddSessionQuestionAnswer(...)` (`:124`). Either branch saves through the unit of work, logs, and returns the mapped [`SessionQuestionAnswerDTO`](group-17-conference-domain.md#sessionquestionanswerdto).
- **Why it's built this way**: the handler orchestrates but never re-implements a rule, so each check stays testable in isolation and reusable across handlers. Loading the parent [`Event`](group-17-conference-domain.md#event) inside the handler (rather than reaching across an aggregate boundary in the domain) keeps `Session` and `Event` as separate aggregates.
- **Where it's used**: registered by the Conference application DI scan; invoked by the CQRS pipeline for `SessionQuestionAnswersController` posts ([Group 20](group-20-conference-api-grpc.md#sessionquestionanswerscontroller)).

### AddSessionSpeakerCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionSpeaker/AddSessionSpeakerCommandValidator.cs:8` · Level 8 · class

- **What it is**: a single-rule FluentValidation validator for [`AddSessionSpeakerCommand`](#addsessionspeakercommand).
- **Depends on**: FluentValidation's `AbstractValidator<TCommand>`; the `SpeakerIdentifierType` alias.
- **Concept reinforced, command-boundary validation.** Same shape as [`AddSessionCategoryItemCommandValidator`](#addsessioncategoryitemcommandvalidator). Its one rule (`AddSessionSpeakerCommandValidator.cs:10-13`) is `RuleFor(x => x.SpeakerId).NotEqual(default(SpeakerIdentifierType)).WithMessage("Speaker ID is required.")`, guarding that a speaker id was supplied. `[Rubric §24, Forms, Validation & UX Safety]`.
- **Where it's used**: run by the validating decorator ahead of [`AddSessionSpeakerHandler`](#addsessionspeakerhandler).

### AddSessionSpeakerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionSpeaker/AddSessionSpeakerHandler.cs:16` · Level 8 · class

- **What it is**: the handler that adds a speaker association to a session. Like [`AddSessionCategoryItemHandler`](#addsessioncategoryitemhandler), it is the clean "load aggregate, call domain method, save, map" template without the extra business guards that [`AddSessionQuestionAnswerHandler`](#addsessionquestionanswerhandler) carries.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error); [`Session`](group-17-conference-domain.md#session) and [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker); [`SessionSpeakerDTOMapper`](#sessionspeakerdtomapper); `Microsoft.Extensions.Logging`.
- **Concept reinforced, the load-aggregate then delegate-mutation template.** `[Rubric §5, Vertical Slice]`. The primary constructor (`AddSessionSpeakerHandler.cs:16-19`) takes the unit of work, the [`SessionSpeakerDTOMapper`](#sessionspeakerdtomapper), and the logger, implementing `ICommandHandler<AddSessionSpeakerCommand, Result<SessionSpeakerDTO>>`. `HandleAsync` (`:22`) loads the session with its `SessionSpeakers` navigation included and `asTracking: true` (`:27`), returns `Error.NotFound` when absent (`:28-29`), delegates to `session.AddSessionSpeaker(command.SessionSpeakerId, command.SpeakerId)` (`:31`), passes any failure straight through (`:32-33`), then saves with `ConfigureAwait(false)` (`:35`), logs via the generated `[LoggerMessage]` helper (`:42-43`), and returns the mapped [`SessionSpeakerDTO`](group-17-conference-domain.md#sessionspeakerdto) (`:39`). The aggregate, not the handler, owns whether the speaker may be added.
- **Why it's built this way**: keeping the domain decision inside `Session.AddSessionSpeaker` keeps the handler as pure orchestration, so the same shape recurs across the module and the interesting rules stay unit-testable on the aggregate.
- **Where it's used**: invoked by the CQRS pipeline for `SessionSpeakersController` posts ([Group 20](group-20-conference-api-grpc.md#sessionspeakerscontroller)).

### SessionDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.DTOs` · `MMCA.ADC.Conference.Application/Sessions/DTOs/SessionDTOMapper.cs:14` · Level 8 · class

- **What it is**: the aggregate-root mapper that projects a [`Session`](group-17-conference-domain.md#session) domain entity to a [`SessionDTO`](group-17-conference-domain.md#sessiondto), composing the three child mappers for the session's nested collections.
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype); [`Session`](group-17-conference-domain.md#session) and [`SessionDTO`](group-17-conference-domain.md#sessiondto); the three child mappers [`SessionSpeakerDTOMapper`](#sessionspeakerdtomapper), [`SessionQuestionAnswerDTOMapper`](#sessionquestionanswerdtomapper), and [`SessionCategoryItemDTOMapper`](#sessioncategoryitemdtomapper); Riok.Mapperly's `[Mapper]` and `[UseMapper]`.
- **Concept introduced, composing Mapperly mappers with `[UseMapper]`.** `[Rubric §9, API & Contract Design]` assesses whether nested contracts map through their own dedicated, testable mappers rather than duplicated inline projections. This `sealed partial class` (`SessionDTOMapper.cs:14`) takes the three child mappers through its primary constructor (`:14-17`) and stores each as a `[UseMapper]`-annotated private field (`:20-27`). When the generator fills in `partial SessionDTO MapToDTO(Session entity)` (`:30`), Mapperly routes each nested collection (speakers, question answers, category items) through the matching child mapper it found via `[UseMapper]`, so the session projection reuses the exact same per-child mapping the child endpoints use. The collection overload `MapToDTOs` (`:33-37`) is again hand-written with a null guard and a collection-expression projection. This manual/generated mapping approach is the [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) convention.
- **Why it's built this way**: delegating child mapping keeps one source of truth per entity type: a change to how a `SessionSpeaker` becomes a DTO lands in [`SessionSpeakerDTOMapper`](#sessionspeakerdtomapper) alone and the session mapping inherits it, with no reflection and full compile-time checking.
- **Where it's used**: the primary `Session` projection, injected into the session create and query handlers (the create handler is in a sibling unit of this group; query handlers elsewhere in the module) and returned from `SessionsController` reads ([Group 20](group-20-conference-api-grpc.md#sessionscontroller)).

### GetNowNextQuery

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextQuery.cs:23` · Level 7 · record

- **What it is**: the query object for the "happening now / up next" snapshot behind the home-screen widget ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 8). It carries one nullable parameter, `EventId` (`GetNowNextQuery.cs:23`); a value targets a specific published event, and `null` tells the handler to auto-select the current-or-next published event, which is what the home widget passes because it has no event id of its own.
- **Depends on**: [`IQueryCacheable`](group-05-cqrs-pipeline.md#iquerycacheable) (the marker it implements), the [`Session`](group-17-conference-domain.md#session) domain type (used only for its `FullName` when building the cache key), `EventIdentifierType` (the module identifier alias), and the BCL `CultureInfo`/`TimeSpan`.
- **Concept introduced, query-level read caching**: this is the first type in this unit to implement [`IQueryCacheable`](group-05-cqrs-pipeline.md#iquerycacheable), the read side of the caching decorator taught in the [CQRS pipeline](group-05-cqrs-pipeline.md). A query that implements it is intercepted by the caching decorator, which reads or writes a cache entry keyed on `CacheKey` for `CacheDuration` before the handler runs. `[Rubric §12, Performance and Scalability]` assesses whether hot reads avoid recomputation and database round-trips: here a public, non-user-specific read that the home surface hits on every load is memoized instead of recomputed. `[Rubric §10, Cross-Cutting]`: caching is a pipeline concern the query only declares, never implements.
- **Walkthrough**: `CacheKey` (`GetNowNextQuery.cs:26-35`) composes `"{Session.FullName}:NowNext:{scope}"`, where `scope` is the invariant-culture event id or the literal `"current"` when `EventId` is null. Placing the key under the `Session` full-name prefix is deliberate: the session write commands in this unit invalidate on that same prefix (see [`RemoveSessionCategoryItemCommand`](#removesessioncategoryitemcommand)), so any session mutation evicts this snapshot once an `IConnectionMultiplexer` is registered. `CacheDuration` (`GetNowNextQuery.cs:38`) is a deliberately short 30 seconds; it bounds staleness both from event-level edits and from the continuous now/next time-bucket transitions, and it is the sole backstop when Redis prefix eviction is unavailable.
- **Why it's built this way**: keying under the aggregate prefix lets one prefix eviction cover every derived read of that aggregate, and the short TTL keeps a time-sensitive widget honest even without a cache server. See the caching-decorator rationale in the [CQRS pipeline](group-05-cqrs-pipeline.md).
- **Where it's used**: handled by [`GetNowNextHandler`](#getnownexthandler); dispatched from the Conference now-next read endpoint and the home-screen widget.

### RemoveSessionCategoryItemCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionCategoryItem/RemoveSessionCategoryItemCommand.cs:9` · Level 7 · record

- **What it is**: the command to detach a category-item association from a session. It is a two-field record, `SessionId` plus the join-entity id `SessionCategoryItemId` (`RemoveSessionCategoryItemCommand.cs:9-11`).
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), the [`Session`](group-17-conference-domain.md#session) type (for the prefix), and the `SessionIdentifierType`/`SessionCategoryItemIdentifierType` aliases.
- **Concept introduced, write-side cache invalidation**: this is the first type here to implement [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), the counterpart to `IQueryCacheable`. A command that implements it declares a `CachePrefix`; after the command succeeds, the invalidation decorator evicts every cache entry whose key starts with that prefix. `CachePrefix => "{Session.FullName}:"` (`RemoveSessionCategoryItemCommand.cs:14`) is the same prefix the session reads (including [`GetNowNextQuery`](#getnownextquery)) key under, so removing a category item flushes all cached session projections in one stroke. `[Rubric §12, Performance and Scalability]` and `[Rubric §10, Cross-Cutting]`: read caching and its invalidation are declared by the messages and applied uniformly by the pipeline, never hand-wired per handler.
- **Walkthrough**: the record body is only the `CachePrefix` expression-bodied property (`RemoveSessionCategoryItemCommand.cs:13-14`); the ids are positional parameters.
- **Where it's used**: handled by [`RemoveSessionCategoryItemHandler`](#removesessioncategoryitemhandler); posted from the session-category management endpoint.

### RemoveSessionQuestionAnswerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionQuestionAnswer/RemoveSessionQuestionAnswerCommand.cs:9` · Level 7 · record

- **What it is**: the command to remove a question answer from a session. Structurally identical to [`RemoveSessionCategoryItemCommand`](#removesessioncategoryitemcommand): `SessionId` plus `SessionQuestionAnswerId` (`RemoveSessionQuestionAnswerCommand.cs:9-11`), with the same `CachePrefix => "{Session.FullName}:"` (`RemoveSessionQuestionAnswerCommand.cs:14`).
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), [`Session`](group-17-conference-domain.md#session), and the `SessionIdentifierType`/`SessionQuestionAnswerIdentifierType` aliases.
- **Concept introduced**: none new; see the cache-invalidation walkthrough on [`RemoveSessionCategoryItemCommand`](#removesessioncategoryitemcommand). The behavioral difference is entirely in its handler, which adds an ownership check.
- **Where it's used**: handled by [`RemoveSessionQuestionAnswerHandler`](#removesessionquestionanswerhandler).

### RemoveSessionSpeakerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionSpeaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionSpeaker/RemoveSessionSpeakerCommand.cs:9` · Level 7 · record

- **What it is**: the command to remove a speaker association from a session. Same shape again: `SessionId` plus the join-entity id `SessionSpeakerId` (`RemoveSessionSpeakerCommand.cs:9-11`) and `CachePrefix => "{Session.FullName}:"` (`RemoveSessionSpeakerCommand.cs:14`).
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), [`Session`](group-17-conference-domain.md#session), and the `SessionIdentifierType`/`SessionSpeakerIdentifierType` aliases.
- **Concept introduced**: none new; see [`RemoveSessionCategoryItemCommand`](#removesessioncategoryitemcommand). Note that its handler tolerates a defaulted `SessionId` and resolves the owning session from the join id.
- **Where it's used**: handled by [`RemoveSessionSpeakerHandler`](#removesessionspeakerhandler).

### SessionCreateRequest

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Create/SessionCreateRequest.cs:10` · Level 7 · record

- **What it is**: the create request DTO for a conference session. It doubles as the create command itself: [`CreateSessionHandler`](#createsessionhandler) is registered as the handler for `SessionCreateRequest`, so the request travels the CQRS pipeline unchanged.
- **Depends on**: [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) (so the generic create-entity mapper pipeline can process it) and [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) (so a successful create evicts the session cache, `SessionCreateRequest.cs:13`); the [`Session`](group-17-conference-domain.md#session) type for the prefix; and the `SessionIdentifierType`/`EventIdentifierType`/`RoomIdentifierType` aliases.
- **Walkthrough**: a `record class` (`SessionCreateRequest.cs:10`) carrying the session's writable fields as `init`-only properties. `Title` (`SessionCreateRequest.cs:19`) and `EventId` (`SessionCreateRequest.cs:61`) are `required`; everything else is optional, including the schedule (`StartsAt`/`EndsAt`, `SessionCreateRequest.cs:25-28`), status and lifecycle flags (`Status`, `IsInformed`, `IsConfirmed`, `IsServiceSession`, `IsPlenumSession`, `SessionCreateRequest.cs:31-43`), the URL and info fields (`LiveUrl`, `RecordingUrl`, `AccessibilityInfo`, `ResourceLinks`, `SessionCreateRequest.cs:46-55`), `Duration` (`SessionCreateRequest.cs:58`), and the assigned `RoomId` (`SessionCreateRequest.cs:64`). `Id` (`SessionCreateRequest.cs:16`) is caller-supplied but auto-generated when left at its default (see [`CreateSessionHandler`](#createsessionhandler) for the manual-id logic). `CachePrefix` returns the `Session` full-name prefix (`SessionCreateRequest.cs:13`), matching the read caches and the other session write commands.
- **Why it's built this way**: sharing one immutable request type for both the API contract and the internal command keeps the create slice thin. `required` marks the genuinely mandatory inputs at the type level so a malformed request cannot even be constructed. `[Rubric §9, API and Contract Design]`: the contract is a small, explicit, immutable shape.
- **Where it's used**: validated by [`SessionCreateRequestValidator`](#sessioncreaterequestvalidator), mapped to a domain entity by [`SessionCreateRequestMapper`](#sessioncreaterequestmapper), and handled by [`CreateSessionHandler`](#createsessionhandler).
- **Caveats / not-in-source**: the current source carries no per-property `SuppressMessage` attributes on `LiveUrl`/`RecordingUrl` (a prior edition described CA1056 suppressions there; they are not present at `SessionCreateRequest.cs:46-51`).

### UpdateSessionQuestionAnswerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/UpdateSessionQuestionAnswer/UpdateSessionQuestionAnswerCommand.cs:10` · Level 7 · record

- **What it is**: the command to edit an existing question answer on a session. It follows the same cache-invalidating command shape as the Remove commands above, adding one payload field: `SessionId`, `SessionQuestionAnswerId`, and the new `AnswerValue` text (`UpdateSessionQuestionAnswerCommand.cs:10-13`).
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), [`Session`](group-17-conference-domain.md#session), and the `SessionIdentifierType`/`SessionQuestionAnswerIdentifierType` aliases.
- **Concept introduced**: none new; `CachePrefix => "{Session.FullName}:"` (`UpdateSessionQuestionAnswerCommand.cs:16`) works exactly as described on [`RemoveSessionCategoryItemCommand`](#removesessioncategoryitemcommand). The only structural difference from the Remove commands is the extra `AnswerValue` string carried to the handler.
- **Where it's used**: handled by [`UpdateSessionQuestionAnswerHandler`](#updatesessionquestionanswerhandler).

### EventLiveValidationService

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/EventLiveValidationService.cs:18` · Level 8 · class

- **What it is**: the Conference-side implementation of [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice), the contract the Engagement module's live layer calls (in-process during tests, over gRPC in production) to learn whether an event or session is live and who may act on it.
- **Depends on**: [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice) (the interface), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (repository access), the [`Event`](group-17-conference-domain.md#event) and [`Session`](group-17-conference-domain.md#session) aggregates, [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) (eligibility rules), the [`EventLiveInfo`](group-17-conference-domain.md#eventliveinfo) and [`SessionLiveInfo`](group-17-conference-domain.md#sessionliveinfo) DTOs, `Result`, and the BCL `TimeZoneInfo`/`DateTime`/`TimeOnly`.
- **Concept introduced, a cross-service read contract satisfied in the owning module**: Engagement owns the live experience but not the source of truth for events and sessions, so it asks Conference through this narrow interface. `[Rubric §7, Microservices Readiness]` assesses whether cross-module dependencies flow through interfaces a process boundary can later intercept: this service is the in-process implementation behind a gRPC adapter ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)), so Engagement's code does not change when the two modules split into separate hosts. `[Rubric §3, Clean Architecture]`: the live-window math lives in the Application layer over repository abstractions, with no EF or transport types leaking in.
- **Walkthrough**:
  - `GetEventLiveInfoAsync` (`EventLiveValidationService.cs:21-41`) loads the event untracked, returns `Error.NotFound` when absent (`EventLiveValidationService.cs:32-36`), computes the UTC live window, and returns an `EventLiveInfo` carrying the published flag plus the window (`EventLiveValidationService.cs:38-40`).
  - `GetSessionLiveInfoAsync` (`EventLiveValidationService.cs:44-97`) loads the session with its `SessionSpeakers`, then enforces the bookmark eligibility rules by reusing [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants): `EnsureNotServiceSession` (BR-91, `EventLiveValidationService.cs:63`) and `EnsureStatusIsEligible` (BR-49, no declined or cancelled sessions, `EventLiveValidationService.cs:67`). It then loads the parent event, computes the window, and projects the active (non-soft-deleted) speaker ids (BR-236, `EventLiveValidationService.cs:86-87`), returning a `SessionLiveInfo` that also carries the plenum flag and the event's `QuestionModerationDefault` (BR-233, `EventLiveValidationService.cs:89-96`).
  - `ComputeLiveWindowUtc` (`EventLiveValidationService.cs:99-115`) is the shared time math: the window opens at `StartDate` 00:00 local and closes (exclusive) at `EndDate + 1 day` 00:00 local, converted to UTC through the event's IANA `TimeZone` (`EventLiveValidationService.cs:101-107`). This mirrors the home-page countdown's Live-phase rule. A `TimeZoneNotFoundException` is caught and the stored local times are treated as UTC rather than failing the call (`EventLiveValidationService.cs:109-114`), a defensive path for legacy rows even though writes are guarded by `EventInvariants.EnsureTimeZoneIsValid`.
- **Why it's built this way**: centralizing the live-window definition here (and reusing the same eligibility invariants the bookmark rules use) keeps one authoritative answer to "is this live and eligible" that both modules trust. See [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) for the gRPC extraction rationale.
- **Where it's used**: consumed by the Engagement live layer (LivePolls and SessionQuestions), reached through the Conference `.Contracts` gRPC adapter in production.

### GetNowNextHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextHandler.cs:20` · Level 8 · class

- **What it is**: the handler that builds the now-next snapshot: the sessions running at the query instant plus the next starting batch, for one published event or the auto-selected current-or-next event.
- **Depends on**: [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult), [`GetNowNextQuery`](#getnownextquery), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), the [`Event`](group-17-conference-domain.md#event) and [`Session`](group-17-conference-domain.md#session) aggregates, [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (event auto-selection and live-window math), [`CalendarExportMapper`](#calendarexportmapper) (eligibility plus wall-clock-to-UTC conversion), the [`NowNextDTO`](group-17-conference-domain.md#nownextdto) and [`NowNextSessionDTO`](group-17-conference-domain.md#nownextsessiondto) shapes, `Result`, and the BCL `TimeProvider`.
- **Concept introduced, `TimeProvider`-injected clock for a time-bucketed read**: the handler takes `TimeProvider timeProvider` in its primary constructor (`GetNowNextHandler.cs:20-22`) and reads `GetUtcNow()` once (`GetNowNextHandler.cs:29`) so "now" is a single injected, testable instant rather than an ambient `DateTime.UtcNow`. `[Rubric §14, Testability]`: a fake `TimeProvider` lets a test place the wall clock precisely inside or across a session boundary. `[Rubric §12, Performance and Scalability]`: pairing this handler with the 30-second cache on its query keeps a per-load widget cheap.
- **Walkthrough**:
  - Selects the event via `SelectEventAsync` (`GetNowNextHandler.cs:90-113`): an explicit id loads that event with its `Rooms`; a null id loads all published events and defers to [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector)`.SelectCurrentOrNext` (`GetNowNextHandler.cs:107-112`). A missing or unpublished event returns `Error.NotFound` (`GetNowNextHandler.cs:32-36`).
  - Loads the event's sessions, builds a room-id to name map, and resolves the IANA time zone, falling back to `TimeZoneInfo.Utc` on `TimeZoneNotFoundException` (`GetNowNextHandler.cs:38-51`).
  - Filters sessions through `CalendarExportMapper.IsExportable` (scheduled, non-service, not declined or cancelled) and projects each to a row with both local and UTC start/end via `CalendarExportMapper.ToUtc` (`GetNowNextHandler.cs:53-56`, `GetNowNextHandler.cs:80-88`).
  - "Now" is rows whose `[StartsAtUtc, EndsAtUtc)` contains the instant, ordered by start then room name (`GetNowNextHandler.cs:58-62`). "Next" is the batch sharing the earliest future start, so parallel tracks surface together (`GetNowNextHandler.cs:64-72`).
  - Computes the event's live flag from `CurrentEventSelector.GetLiveWindowUtc` and returns a `NowNextDTO` (`GetNowNextHandler.cs:74-77`).
- **Why it's built this way**: reusing the calendar-export eligibility and DST conversion keeps the now-next view consistent with the exported schedule (one rule, two readers), and the earliest-future-start batching matches how attendees think about "up next" across concurrent tracks ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 8).
- **Where it's used**: dispatched behind the Conference now-next endpoint and the home-screen widget.

### RemoveSessionCategoryItemHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionCategoryItem/RemoveSessionCategoryItemHandler.cs:13` · Level 8 · class

- **What it is**: the handler for [`RemoveSessionCategoryItemCommand`](#removesessioncategoryitemcommand). It is the canonical "remove a child from the session aggregate" shape that the sibling handlers below vary from.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), the [`Session`](group-17-conference-domain.md#session) aggregate (and its [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem) child), `Result`, and `Microsoft.Extensions.Logging`.
- **Concept introduced, load-tracked-then-mutate-through-the-aggregate**: the recurring pattern for child removal. `HandleAsync` (`RemoveSessionCategoryItemHandler.cs:18-39`) loads the session with its `SessionCategoryItems` and `asTracking: true` (`RemoveSessionCategoryItemHandler.cs:22-27`), returns `Error.NotFound` when absent (`RemoveSessionCategoryItemHandler.cs:28-29`), then delegates the actual removal to the domain method `entity.RemoveSessionCategoryItem(...)` (`RemoveSessionCategoryItemHandler.cs:31`) so the aggregate enforces its own invariants. Only on success does it `SaveChangesAsync` and log (`RemoveSessionCategoryItemHandler.cs:32-36`). `[Rubric §4, Domain-Driven Design]`: the handler never mutates child state directly; it asks the aggregate root. `[Rubric §13, Observability and Operability]`: logging uses the source-generated `[LoggerMessage]` partial (`RemoveSessionCategoryItemHandler.cs:41-42`), the zero-allocation, compile-checked logging pattern used on every handler in this codebase.
- **Walkthrough**: the `sealed partial class` primary constructor takes `IUnitOfWork` and a typed `ILogger` (`RemoveSessionCategoryItemHandler.cs:13-15`); the generated `LogCategoryItemRemovedFromSession` method is declared at `RemoveSessionCategoryItemHandler.cs:41-42`.
- **Why it's built this way**: keeping removal logic in the aggregate and cache eviction on the command (via [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating)) leaves the handler as pure orchestration: load, delegate, save, log.
- **Where it's used**: registered by the Conference Application module scan; invoked from the session-category management endpoint.

### RemoveSessionQuestionAnswerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionQuestionAnswer/RemoveSessionQuestionAnswerHandler.cs:14` · Level 8 · class

- **What it is**: the handler for [`RemoveSessionQuestionAnswerCommand`](#removesessionquestionanswercommand). Same load-delegate-save shape as [`RemoveSessionCategoryItemHandler`](#removesessioncategoryitemhandler), with an ownership guard added before the removal.
- **Depends on**: everything the sibling handler depends on, plus [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) and [`RoleNames`](group-08-auth.md#rolenames).
- **Concept introduced, per-record ownership authorization in the handler (BR-52 / BR-53)**: after loading the session with its `SessionQuestionAnswers` (`RemoveSessionQuestionAnswerHandler.cs:24-31`), it finds the target answer and, if the caller is not an `Organizer` and did not create it, returns `Error.Forbidden` with code `SessionQuestionAnswer.NotOwner` (`RemoveSessionQuestionAnswerHandler.cs:33-42`). Only then does it delegate to `entity.RemoveSessionQuestionAnswer(...)` (`RemoveSessionQuestionAnswerHandler.cs:44`). `[Rubric §11, Security]`: attendees may delete only their own answers, checked against the record's `CreatedBy` and the current user id, with organizers exempt. `[Rubric §6, CQRS and Event-Driven]`: the authorization decision lives inside the command slice, not scattered in the controller.
- **Walkthrough**: primary constructor adds `ICurrentUserService` (`RemoveSessionQuestionAnswerHandler.cs:14-17`); the success path saves and logs via the generated `LogQuestionAnswerRemovedFromSession` (`RemoveSessionQuestionAnswerHandler.cs:45-49`, `RemoveSessionQuestionAnswerHandler.cs:54-55`).
- **Where it's used**: invoked from the session question-answer endpoint.

### RemoveSessionSpeakerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionSpeaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionSpeaker/RemoveSessionSpeakerHandler.cs:13` · Level 8 · class

- **What it is**: the handler for [`RemoveSessionSpeakerCommand`](#removesessionspeakercommand). The same load-delegate-save shape as [`RemoveSessionCategoryItemHandler`](#removesessioncategoryitemhandler), plus a fallback for resolving the owning session when the command omits `SessionId`.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), the [`Session`](group-17-conference-domain.md#session) aggregate (and its [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) child), `Result`, and logging.
- **Concept introduced, resolving the parent aggregate from a join id**: the DELETE endpoint takes the session id as an optional query parameter, but the UI's generic delete sends only the join-entity id, so `SessionId` arrives as the default `0` (`RemoveSessionSpeakerHandler.cs:24-26`). When `SessionId == default` the handler queries for the session whose `SessionSpeakers` contains the join id (`RemoveSessionSpeakerHandler.cs:28-36`); otherwise it loads by id directly (`RemoveSessionSpeakerHandler.cs:37-44`). Both branches load `asTracking: true`. `[Rubric §9, API and Contract Design]`: the handler adapts to a real client quirk without weakening the domain call, which still targets one aggregate. `[Rubric §12, Performance and Scalability]`: the fallback is an `Any(...)`-predicate scan used only when the id is missing.
- **Walkthrough**: after resolving the session (or `Error.NotFound`, `RemoveSessionSpeakerHandler.cs:46-47`), it delegates to `entity.RemoveSessionSpeaker(...)` (`RemoveSessionSpeakerHandler.cs:49`), then saves and logs on success via the generated `LogSpeakerRemovedFromSession` (`RemoveSessionSpeakerHandler.cs:50-54`, `RemoveSessionSpeakerHandler.cs:59-60`).
- **Where it's used**: invoked from the session-speaker management endpoint.

### SessionCreateRequestMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Create/SessionCreateRequestMapper.cs:11` · Level 8 · class

- **What it is**: the adapter that turns a validated [`SessionCreateRequest`](#sessioncreaterequest) into a [`Session`](group-17-conference-domain.md#session) domain entity by calling the aggregate's `Create` factory.
- **Depends on**: [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) (the framework contract it implements, closed over `Session`/`SessionCreateRequest`/`SessionIdentifierType`), the [`Session`](group-17-conference-domain.md#session) factory, and `Result`.
- **Concept introduced, request-to-entity mapping as its own step**: the create pipeline separates "shape the input" (this mapper) from "orchestrate the use case" (the handler). `CreateEntityAsync` (`SessionCreateRequestMapper.cs:15-34`) guards the null request (`SessionCreateRequestMapper.cs:17`) then forwards each request field positionally into `Session.Create(...)` (`SessionCreateRequestMapper.cs:19-33`), returning its `Result<Session>` wrapped in a completed `Task`. `[Rubric §1, SOLID]`: single responsibility, the mapper knows the factory's argument order and nothing else. `[Rubric §2, Design Patterns]`: the mapper decouples the request DTO from the domain constructor so the handler depends only on the interface. Manual mapping over reflection follows [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html).
- **Walkthrough**: a `sealed class` with the one interface method; note that `IsInformed`, `IsConfirmed`, and `Duration` from the request are not passed to `Session.Create` here, so the factory sets its own defaults for those (`SessionCreateRequestMapper.cs:19-33`).
- **Where it's used**: injected into [`CreateSessionHandler`](#createsessionhandler) as `IEntityRequestMapper<Session, SessionCreateRequest, SessionIdentifierType>`.

### SessionCreateRequestValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Create/SessionCreateRequestValidator.cs:7` · Level 8 · class

- **What it is**: the FluentValidation validator for [`SessionCreateRequest`](#sessioncreaterequest). It composes reusable per-field rule sets rather than restating each rule inline.
- **Depends on**: `FluentValidation` (`AbstractValidator<T>`, `Include`) and the shared `Session*Rules<T>` rule classes from `MMCA.ADC.Conference.Application.Sessions.Validation`.
- **Concept introduced, composed validation via reusable rule includes**: the constructor (`SessionCreateRequestValidator.cs:9-19`) calls `Include(...)` for each field rule set (`SessionTitleRules`, `SessionEventIdRules`, `SessionDescriptionRules`, `SessionStatusRules`, `SessionLiveUrlRules`, `SessionRecordingUrlRules`, `SessionAccessibilityInfoRules`, `SessionResourceLinksRules`), each generic over the request type and given a property selector. `[Rubric §24, Forms/Validation/UX Safety]` and `[Rubric §15, Best Practices]`: field rules are defined once and shared across create and update validators, so a rule like title length or URL format cannot drift between the two request paths. The validator runs in the CQRS pipeline before the handler executes.
- **Walkthrough**: `sealed class SessionCreateRequestValidator : AbstractValidator<SessionCreateRequest>` (`SessionCreateRequestValidator.cs:7`); eight `Include` calls, each wiring a `Session<Field>Rules<SessionCreateRequest>` to the matching property lambda (`SessionCreateRequestValidator.cs:11-18`).
- **Where it's used**: resolved by the validation stage of the create pipeline for `SessionCreateRequest`.
- **Caveats / not-in-source**: the composed `Session*Rules` rule classes live in the `Sessions.Validation` namespace and are documented in their own unit; this section only covers how the create validator assembles them.

### UpdateSessionQuestionAnswerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/UpdateSessionQuestionAnswer/UpdateSessionQuestionAnswerHandler.cs:14` · Level 8 · class

- **What it is**: the handler for [`UpdateSessionQuestionAnswerCommand`](#updatesessionquestionanswercommand). It mirrors [`RemoveSessionQuestionAnswerHandler`](#removesessionquestionanswerhandler) exactly, enforcing the same BR-52 / BR-53 ownership rule before applying an edit instead of a removal.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), [`RoleNames`](group-08-auth.md#rolenames), the [`Session`](group-17-conference-domain.md#session) aggregate, `Result`, and logging.
- **Concept introduced**: none new; the ownership guard is identical to [`RemoveSessionQuestionAnswerHandler`](#removesessionquestionanswerhandler): load the session with its answers (`UpdateSessionQuestionAnswerHandler.cs:24-31`), block a non-organizer editing another user's answer with `Error.Forbidden` code `SessionQuestionAnswer.NotOwner` (`UpdateSessionQuestionAnswerHandler.cs:33-42`), then delegate to `entity.UpdateSessionQuestionAnswer(command.SessionQuestionAnswerId, command.AnswerValue)` (`UpdateSessionQuestionAnswerHandler.cs:44`).
- **Walkthrough**: the success path saves and logs via the generated `LogSessionQuestionAnswerUpdated` (`UpdateSessionQuestionAnswerHandler.cs:45-49`, `UpdateSessionQuestionAnswerHandler.cs:54-55`).
- **Where it's used**: invoked from the session question-answer edit endpoint.

### CreateSessionHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Create/CreateSessionHandler.cs:20` · Level 9 · class

- **What it is**: the command handler for creating a session. It is the richest write path in this unit: it assigns manual ids in a reserved range, guards against room double-booking, delegates entity construction to the mapper, persists, and retries on a concurrent id collision.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) (via [`SessionCreateRequestMapper`](#sessioncreaterequestmapper)), [`SessionDTOMapper`](#sessiondtomapper), the [`Session`](group-17-conference-domain.md#session) aggregate, [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) (the manual-id range), [`SessionRoomScheduling`](#sessionroomscheduling) (the overlap predicate), the [`SessionDTO`](group-17-conference-domain.md#sessiondto) result shape, `Result`, plus `IServiceScopeFactory` and logging.
- **Concept introduced, app-assigned ids with a bounded retry on collision**: session ids are application-assigned because the int primary key IS the Sessionize id. When the caller supplies no id (organizer create, request `Id` defaults to `0`), `CreateCoreAsync` reads the current maximum in the reserved manual range and takes the next one, ignoring query filters so soft-deleted rows still reserve their id (`CreateSessionHandler.cs:77-92`); an exhausted range returns a failure (`CreateSessionHandler.cs:89-90`). Because two concurrent creates can compute the same next id, `HandleAsync` wraps the attempt in a bounded loop of `MaxManualIdAttempts` = 3 (`CreateSessionHandler.cs:28`, `CreateSessionHandler.cs:40-60`); a duplicate-key failure recomputes the id in a fresh DI scope (`scopeFactory.CreateAsyncScope()`) so a clean `DbContext` is used, since the ambient one still tracks the failed insert (`CreateSessionHandler.cs:49-53`). `[Rubric §8, Data Architecture]`: id allocation is an explicit, range-partitioned concern rather than a database identity column. `[Rubric §12, Performance and Scalability]`: the collision path is exceptional and capped, not a lock on the hot path.
- **Walkthrough**:
  - An explicit caller id (for example a Sessionize import) is respected as-is and gets a single attempt with no id recomputation, because a collision there is a genuine caller error (`CreateSessionHandler.cs:35-38`).
  - `CreateCoreAsync` (`CreateSessionHandler.cs:67-117`) resolves the manual id when unset, then applies the room double-booking guard when a room and both times are present, rejecting an overlapping `[StartsAt, EndsAt)` in the same room via `SessionRoomScheduling.BuildOverlapPredicate` and `DoubleBookedError` (`CreateSessionHandler.cs:95-103`).
  - It maps via `requestMapper.CreateEntityAsync` (early-return on failure), adds, saves, logs, and returns `Result.Success(dtoMapper.MapToDTO(entity))` (`CreateSessionHandler.cs:105-116`).
  - `IsUniqueKeyViolation` (`CreateSessionHandler.cs:124-133`) walks the exception chain looking for the message "duplicate key"; detection is message-based because the Application layer cannot reference EF Core types (both SQL errors 2601 and 2627 report it).
- **Why it's built this way**: keeping the id in a reserved manual range prevents organizer-created sessions from colliding with future Sessionize-assigned ids, and the fresh-scope retry is the only reliable way to recover from a duplicate-key race without leaking EF types into the Application layer. Structured logging uses the source-generated `[LoggerMessage]` partials `LogSessionCreated` and `LogManualIdCollision` (`CreateSessionHandler.cs:135-139`).
- **Where it's used**: registered as the handler for [`SessionCreateRequest`](#sessioncreaterequest); invoked from the session create endpoint and from the Sessionize import path.

### EventNavigationPopulator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/EventNavigationPopulator.cs:11` · Level 10 · class

- **What it is**: the declarative navigation populator for the [`Event`](group-17-conference-domain.md#event) aggregate. It loads the child collections EF Core cannot materialize through `.Include()` on this model.
- **Depends on**: [`DeclarativeNavigationPopulator<TEntity>`](group-11-navigation-populators.md#declarativenavigationpopulatortentity) (the base it extends), [`ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>`](group-11-navigation-populators.md#childnavigationdescriptortentity-tparentid-tchild-tchildid) (the per-collection descriptors), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), and the [`Event`](group-17-conference-domain.md#event), [`Room`](group-17-conference-domain.md#room), [`EventSpeaker`](group-17-conference-domain.md#eventspeaker), and [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer) entities.
- **Concept introduced, declarative child loading over manual joins**: rather than writing imperative load-and-assign code, this populator declares a list of `ChildNavigationDescriptor`s to its base constructor (`EventNavigationPopulator.cs:11-36`), each naming the property, the parent-key selector, the child foreign-key selector, and an assign action. The base then loads and assigns each collection uniformly (the mechanism is taught in [Group 11](group-11-navigation-populators.md#declarativenavigationpopulatortentity), [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)). `[Rubric §8, Data Architecture]`: aggregate hydration is described declaratively, so adding a child collection is one descriptor, not a new query method. `[Rubric §2, Design Patterns]`: the descriptor list is a small internal DSL over the shared populator.
- **Walkthrough**: three descriptors, one per collection, each keyed on `Event.Id` versus the child's `EventId`: `Rooms` assigned via `SetRooms` (`EventNavigationPopulator.cs:15-21`), `EventSpeakers` via `SetEventSpeakers` (`EventNavigationPopulator.cs:22-28`), and `EventQuestionAnswers` via `SetEventQuestionAnswers` (`EventNavigationPopulator.cs:29-35`). The class body is empty; all behavior comes from the base and the descriptor list.
- **Why it's built this way**: the aggregate exposes `Set*` methods so the populator assigns child collections through the domain's own guarded mutators rather than back-door setters, keeping hydration consistent with the aggregate's rules ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).
- **Where it's used**: resolved by the navigation-population pipeline whenever an `Event` is read with these navigations requested.

### SessionBookmarkValidationService

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions` · `MMCA.ADC.Conference.Application/Sessions/SessionBookmarkValidationService.cs:12` · Level 8 · class (sealed)

- **What it is** : the Conference-side implementation of [`ISessionBookmarkValidationService`](group-17-conference-domain.md#isessionbookmarkvalidationservice), the contract Engagement calls before it lets an attendee bookmark a session. It answers two questions: "is this session eligible to be bookmarked?" (BR-49 and BR-91) and "what session ids belong to this event?" (used by the event-scoped bookmark filter).
- **Depends on** : [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (repository access), the [`Session`](group-17-conference-domain.md#session) aggregate, its domain-side `SessionInvariants` helper, and the [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error) pair for the outcome. `SessionIdentifierType` and `EventIdentifierType` are the module identifier aliases (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Concept introduced : the cross-module *validation service* that keeps a business rule on the owning side of a boundary.** `[Rubric §7 : Microservices Readiness]` (assesses whether a module can be extracted without dragging another module's rules along): the "can this session be bookmarked" rule is Conference's knowledge (session status and the service-session flag live on the [`Session`](group-17-conference-domain.md#session) aggregate), so Engagement does not read Conference tables directly, it calls this contract. `[Rubric §6 : CQRS & Event-Driven]`: this is a read-side collaborator, not a command handler, so it returns a bare [`Result`](group-01-result-error-handling.md#result) verdict rather than mutating anything. When both modules run in-process the call is a direct method invocation; when Conference is extracted it is satisfied by a gRPC adapter, so the interface is the extraction boundary ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)).
- **Walkthrough** : the primary-constructor parameter `unitOfWork` is the only dependency (`SessionBookmarkValidationService.cs:12`).
  - `ValidateSessionForBookmarkAsync` (`SessionBookmarkValidationService.cs:15-39`) resolves the [`Session`](group-17-conference-domain.md#session) repository, loads the session **untracked** with no includes (`asTracking: false`, `SessionBookmarkValidationService.cs:19-24`, a read-only lookup), and returns `Error.NotFound` stamped with source and target when the id does not resolve (`SessionBookmarkValidationService.cs:28-29`). It then delegates both rules to the domain: `SessionInvariants.EnsureNotServiceSession` (BR-91, service sessions like breaks and lunch cannot be bookmarked, `SessionBookmarkValidationService.cs:33`) and, if that passes, `SessionInvariants.EnsureStatusIsEligible` (BR-49, only Accepted or status-null sessions qualify, `SessionBookmarkValidationService.cs:38`). Keeping the rule text in `SessionInvariants` means the same invariant is reused wherever a session is validated, not re-implemented here.
  - `GetSessionIdsByEventAsync` (`SessionBookmarkValidationService.cs:42-54`) fetches every session for an event untracked, filtered by `s.EventId == eventId` (`SessionBookmarkValidationService.cs:47-51`), and projects to a `SessionIdentifierType` collection with a collection-expression spread (`SessionBookmarkValidationService.cs:53`). The global soft-delete query filter excludes deleted sessions automatically (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Why it's built this way** : the rule belongs to the aggregate that owns the data, so the check lives with Conference and Engagement depends on the interface, not the schema ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) database-per-service, [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) gRPC extraction). Returning [`Result`](group-01-result-error-handling.md#result) rather than throwing lets the calling command fold the verdict into its own pipeline.
- **Where it's used** : Engagement's `CreateBookmarkHandler` calls `ValidateSessionForBookmarkAsync` before creating or reactivating a bookmark, and the event-filtered bookmark query calls `GetSessionIdsByEventAsync`. This is the reciprocal of Conference calling Engagement's `IBookmarkCountService`, the bidirectional gRPC pair the AppHost deliberately wires without a reciprocal `WaitFor`.

### UserRegisteredHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Users.IntegrationEventHandlers` · `MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserRegisteredHandler.cs:38` · Level 8 · class (sealed partial)

- **What it is** : the Conference-side subscriber to Identity's [`UserRegistered`](group-24-identity-module.md#userregistered) integration event. When a new user registers, it tries to auto-link them to an existing speaker record so that person's talks show up as theirs (BR-207).
- **Depends on** : `IServiceScopeFactory` (per-event DI scope), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IIntegrationEventPublisher`](group-04-events-outbox.md#iintegrationeventpublisher), the [`Speaker`](group-17-conference-domain.md#speaker) aggregate, the [`Email`](group-02-domain-building-blocks.md#email) value object, and `ILogger`. It implements [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent) closed over [`UserRegistered`](group-24-identity-module.md#userregistered), and publishes `SpeakerLinkedToUser` back to Identity.
- **Concept introduced : the integration-event *consumer*: scoped DI inside a singleton handler, and idempotent eventual consistency.** `[Rubric §6 : CQRS & Event-Driven]` (assesses reliable, idempotent consumers that carry enough context to act): the handler runs as a singleton per framework convention, so it cannot hold a scoped [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) as a field, it opens `scopeFactory.CreateAsyncScope()` per event and resolves the scoped services inside (`UserRegisteredHandler.cs:52-54`). `[Rubric §29 : Resilience]` (assesses graceful handling of partial failure): the whole body is wrapped in a best-effort `try/catch` that swallows everything except `OperationCanceledException` (`UserRegisteredHandler.cs:108-113`), because the user-registration transaction has already committed and a throw here would push a poison message back through the broker. At-least-once delivery ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) means the handler may re-run, and the "already linked to this user" early return (`UserRegisteredHandler.cs:81-87`) plus the unique index on `Speaker.LinkedUserId` make re-delivery idempotent.
- **Walkthrough** : the constructor takes `scopeFactory` and `logger` (`UserRegisteredHandler.cs:38-40`); two match-mode constants label the outcome for logging (`UserRegisteredHandler.cs:42-43`).
  - `HandleAsync` (`UserRegisteredHandler.cs:46-114`) null-checks the event, opens the scope, and resolves a [`Speaker`](group-17-conference-domain.md#speaker) repository plus the [`IIntegrationEventPublisher`](group-04-events-outbox.md#iintegrationeventpublisher) (`UserRegisteredHandler.cs:52-56`). It attempts an email match first, then falls back to a name match, tracking which strategy won (`UserRegisteredHandler.cs:58-64`). No match logs and returns (`UserRegisteredHandler.cs:66-70`). A speaker already linked to a *different* user is left alone (`UserRegisteredHandler.cs:73-77`); a speaker already linked to *this* user re-publishes `SpeakerLinkedToUser` for Identity to re-sync and returns without re-linking (`UserRegisteredHandler.cs:81-87`). Otherwise it calls `speaker.LinkUser(...)` (a domain method returning [`Result`](group-01-result-error-handling.md#result), `UserRegisteredHandler.cs:89-94`), saves, publishes the back-link event so Identity can set `User.LinkedSpeakerId` (`UserRegisteredHandler.cs:99-104`), and logs the auto-link.
  - `TryMatchByEmailAsync` (`UserRegisteredHandler.cs:116-138`) is the original BR-207 path: it builds an [`Email`](group-02-domain-building-blocks.md#email) value object (which normalizes to lowercase, so the `HasConversion`-stored value compares case-insensitively) and returns the first speaker whose non-null email matches (`UserRegisteredHandler.cs:131-137`).
  - `TryMatchByNameAsync` (`UserRegisteredHandler.cs:140-176`) is the **Sessionize fallback**: Sessionize-imported speakers have a null `Email` because the public `view/All` endpoint omits PII, so the handler matches on exact `FirstName + LastName` among *unlinked* candidates (`UserRegisteredHandler.cs:156-162`). It links only when exactly one candidate matches, logging and skipping an ambiguous name collision of two or more (`UserRegisteredHandler.cs:164-175`), so it never guesses.
  - The six `[LoggerMessage]` source-generated log methods (`UserRegisteredHandler.cs:178-197`) are why the class is `partial`.
- **Why it's built this way** : [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) (outbox + at-least-once) requires idempotent, crash-tolerant consumers; the scope-per-event pattern is the standard way a singleton event handler borrows scoped EF state. The name fallback exists specifically because the Sessionize public feed omits PII, so there is no email to match on. This is a deliberate divergence from Store, which handles the same "link on registration" concept with an in-process domain event: do not "align" them.
- **Where it's used** : registered as a broker consumer in the Conference service host; the producer is Identity's registration path (its `UserRegistered` outbox message over the MassTransit broker). The link is eventually consistent: the new user's first token does not yet carry the `speaker_id` claim, it appears on the next token refresh after this handler completes.

### SpeakerEntityQueryService

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers` · `MMCA.ADC.Conference.Application/Speakers/SpeakerEntityQueryService.cs:15` · Level 9 · class (sealed)

- **What it is** : a thin concrete subclass of [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype) closed over [`Speaker`](group-17-conference-domain.md#speaker) / [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) / `SpeakerIdentifierType`. It adds exactly one thing: a property map that lets API consumers sort and filter on the computed `FullName` field even though no such column exists on the entity.
- **Depends on** : the base [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype) and the five services it forwards to the base constructor: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`INavigationMetadataProvider`](group-03-querying-specifications.md#inavigationmetadataprovider), [`IEntityQueryPipeline`](group-03-querying-specifications.md#ientityquerypipeline), [`SpeakerDTOMapper`](#speakerdtomapper), and [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) over [`Speaker`](group-17-conference-domain.md#speaker) (its concrete populator is [`SpeakerNavigationPopulator`](#speakernavigationpopulator)).
- **Concept introduced : the `DTOToEntityPropertyMap` override for a computed sort/filter key.** `[Rubric §12 : Performance & Scalability]` (assesses server-side sort/filter that translates to SQL rather than materializing and sorting in memory): the base exposes a `protected virtual IReadOnlyDictionary<string, string> DTOToEntityPropertyMap`, and this subclass overrides it (`SpeakerEntityQueryService.cs:34`) to map `FullName` to the EF-translatable expression `(FirstName + " " + LastName)` (`SpeakerEntityQueryService.cs:28-31`). The query pipeline renders that into the correct `ORDER BY` / `WHERE` fragment; without the map, sorting by `FullName` would fail because the entity has no `FullName` property. `[Rubric §9 : API & Contract Design]`: the DTO field name is the stable public sort key, decoupled from the internal entity shape.
- **Walkthrough** : the primary constructor takes all five services and forwards them to the base (`SpeakerEntityQueryService.cs:15-22`). `PropertyMap` is a `static readonly` dictionary evaluated once at class load, holding the single `FullName` -> compound-expression entry (`SpeakerEntityQueryService.cs:28-31`). The override `DTOToEntityPropertyMap => PropertyMap` (`SpeakerEntityQueryService.cs:34`) hands it to the base. There are no other members: all query, page, and project logic lives in [`EntityQueryService`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype).
- **Why it's built this way** : a `static readonly` map is computed once per appdomain, not per request. Making this a thin concrete subclass rather than registering the base directly is the DI hook: the container binds [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype) for speakers to this type, so the non-default map is picked up automatically.
- **Where it's used** : registered in the Conference Application DI as the speaker query service and injected into the `SpeakersController`, which serves the read endpoints behind the `SpeakersCache` output-cache policy.

### ConferenceCategoryNavigationPopulator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories` · `MMCA.ADC.Conference.Application/Categories/ConferenceCategoryNavigationPopulator.cs:11` · Level 10 · class (sealed)

- **What it is** : the entity-specific navigation populator for the [`Category`](group-17-conference-domain.md#category) aggregate. It declares which child collections EF Core cannot eager-load via `.Include()` and how to fetch and assign them, then lets the base class do the work.
- **Depends on** : [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (repository access), the base [`DeclarativeNavigationPopulator<TEntity>`](group-11-navigation-populators.md#declarativenavigationpopulatortentity) over [`Category`](group-17-conference-domain.md#category), and one [`ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>`](group-11-navigation-populators.md#childnavigationdescriptortentity-tparentid-tchild-tchildid) for the `CategoryItems` collection.
- **Concept reinforced : declarative child-navigation loading ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).** The mechanism itself (bulk-fetch children with an [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) repository, group them by parent key, assign through a domain setter) is taught on [`DeclarativeNavigationPopulator<TEntity>`](group-11-navigation-populators.md#declarativenavigationpopulatortentity). `[Rubric §2 : Design Patterns]`: this is the Template Method pattern with the twist that the "subclass" only supplies data through a descriptor array, it overrides no methods. `[Rubric §3 : Clean Architecture]`: the application layer stays free of any EF `Include`, all loading goes through repository queries.
- **Walkthrough** : the primary constructor passes `unitOfWork` and a single-element descriptor array to the base (`ConferenceCategoryNavigationPopulator.cs:11-22`). The lone [`ChildNavigationDescriptor`](group-11-navigation-populators.md#childnavigationdescriptortentity-tparentid-tchild-tchildid) supplies four members (`ConferenceCategoryNavigationPopulator.cs:15-20`): `PropertyName = nameof(Category.CategoryItems)` (which property the base marks populated), `ParentKeySelector = e => e.Id` (group children by parent), `ChildForeignKeySelector = child => child.CategoryId` (match child rows to parent), and `AssignAction = (e, categoryItems) => e.SetCategoryItems(categoryItems)` (hand the loaded children back through the aggregate's own setter, so the domain, not infrastructure, owns the assignment). The class body is empty.
- **Why it's built this way** : [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html) requires the application layer to control eager loading without an EF dependency; the generic machinery lives in the base and each aggregate gets a small, locatable configuration file in its own feature folder.
- **Where it's used** : registered by convention via [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) scanning in the Conference module DI, and resolved by the category query service when loading categories that need their items.
- **Caveats / not-in-source** : `SetCategoryItems` is the aggregate's own child-assignment method; if the child collection is renamed or added to on [`Category`](group-17-conference-domain.md#category), this descriptor must be updated to match.

### SessionNavigationPopulator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions` · `MMCA.ADC.Conference.Application/Sessions/SessionNavigationPopulator.cs:12` · Level 10 · class (sealed)

- **What it is** : the same declarative navigation populator pattern as [`ConferenceCategoryNavigationPopulator`](#conferencecategorynavigationpopulator), but for the [`Session`](group-17-conference-domain.md#session) aggregate, which has three child collections rather than one.
- **Depends on** : [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), the base [`DeclarativeNavigationPopulator<TEntity>`](group-11-navigation-populators.md#declarativenavigationpopulatortentity) over [`Session`](group-17-conference-domain.md#session), and three [`ChildNavigationDescriptor`](group-11-navigation-populators.md#childnavigationdescriptortentity-tparentid-tchild-tchildid) entries.
- **Concept reinforced** : declarative child loading ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)), taught on [`DeclarativeNavigationPopulator<TEntity>`](group-11-navigation-populators.md#declarativenavigationpopulatortentity). See [`ConferenceCategoryNavigationPopulator`](#conferencecategorynavigationpopulator) for the per-member breakdown; this class only differs in the number and identity of its children.
- **Walkthrough** : the constructor passes `unitOfWork` and a three-element descriptor array to the base (`SessionNavigationPopulator.cs:12-37`), one descriptor each for `SessionSpeakers` (child FK `SessionId`, setter `SetSessionSpeakers`, `SessionNavigationPopulator.cs:16-22`), `SessionQuestionAnswers` (`SetSessionQuestionAnswers`, `SessionNavigationPopulator.cs:23-29`), and `SessionCategoryItems` (`SetSessionCategoryItems`, `SessionNavigationPopulator.cs:30-36`). Each descriptor shares the `ParentKeySelector = e => e.Id` shape; only the child type, foreign-key selector, and assign action change.
- **Why it's built this way** : one populator file per aggregate keeps the configuration small and co-located with the session use cases ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).
- **Where it's used** : registered via [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) scanning and resolved by the session query path when loading sessions with their speakers, Q&A, and category items.

### SpeakerNavigationPopulator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers` · `MMCA.ADC.Conference.Application/Speakers/SpeakerNavigationPopulator.cs:11` · Level 10 · class (sealed)

- **What it is** : the declarative navigation populator for the [`Speaker`](group-17-conference-domain.md#speaker) aggregate, loading its two child collections. Same shape as [`ConferenceCategoryNavigationPopulator`](#conferencecategorynavigationpopulator).
- **Depends on** : [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), the base [`DeclarativeNavigationPopulator<TEntity>`](group-11-navigation-populators.md#declarativenavigationpopulatortentity) over [`Speaker`](group-17-conference-domain.md#speaker), and two [`ChildNavigationDescriptor`](group-11-navigation-populators.md#childnavigationdescriptortentity-tparentid-tchild-tchildid) entries.
- **Concept reinforced** : declarative child loading ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)); see [`ConferenceCategoryNavigationPopulator`](#conferencecategorynavigationpopulator) for the mechanism.
- **Walkthrough** : the constructor passes `unitOfWork` and a two-element descriptor array to the base (`SpeakerNavigationPopulator.cs:11-30`): `SpeakerCategoryItems` (child FK `SpeakerId`, setter `SetSpeakerCategoryItems`, `SpeakerNavigationPopulator.cs:15-21`) and `SpeakerQuestionAnswers` (`SetSpeakerQuestionAnswers`, `SpeakerNavigationPopulator.cs:22-28`). This is the populator [`SpeakerEntityQueryService`](#speakerentityqueryservice) receives as its [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) dependency.
- **Why it's built this way** : one small populator per aggregate, co-located with the speaker feature ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).
- **Where it's used** : registered via [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) scanning and resolved by [`SpeakerEntityQueryService`](#speakerentityqueryservice) when a speaker read needs its category items and Q&A.


---
[⬅ ADC Conference - Domain Model & Module Contracts](group-17-conference-domain.md)  •  [Index](00-index.md)  •  [ADC Conference - Infrastructure & Persistence ➡](group-19-conference-infrastructure.md)
