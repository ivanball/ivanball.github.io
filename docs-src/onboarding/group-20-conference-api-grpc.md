# 20. ADC Conference - API, gRPC Contracts & Service Host

**What this chapter covers.** This is the **edge of the Conference bounded context**: the layer that
turns the Conference domain ([G17](group-17-conference-domain.md)) and its CQRS slices
([G18](group-18-conference-application.md)) into a running HTTP + gRPC surface, plus the glue that
lets that surface be hosted **either** inside a co-located host **or** as its own extracted service
(`MMCA.ADC.Conference.Service`) with no change to the application code beneath. Almost nothing here
is novel machinery: the controllers are thin shells over the generic REST bases taught in
[G12 (API Hosting, Middleware & DTO Mapping)](group-12-api-hosting-mapping.md), the gRPC pieces are
concrete instances of the transport boundary taught in
[G13 (gRPC & Inter-Service Contracts)](group-13-grpc-contracts.md), and the module entry point is one
implementation of the [`IModule`](group-14-module-system-composition.md#imodule) contract from
[G14 (Module System & Composition)](group-14-module-system-composition.md). What this chapter teaches
is *how the Conference module wires those reusable pieces into a real, seventeen-controller,
twice-gRPC-edged conference API*, and the handful of places where it deviates from the generic shape
for a business reason. The headline rubric lenses are `[Rubric §9, API & Contract Design]` (a
consistent, versioned REST + gRPC contract), `[Rubric §5, Vertical Slice]` and `[Rubric §6, CQRS &
Event-Driven]` (each action dispatches to a single command or query handler), and `[Rubric §7,
Microservices Readiness]` (the same code runs in-process or extracted). Everything lives in three
projects: `MMCA.ADC.Conference.API` (the controllers, the [`ConferenceModule`](#conferencemodule)
entry point, the [`ConferenceModuleSeeder`](#conferencemoduleseeder)), `MMCA.ADC.Conference.Service`
(the host wiring plus the gRPC servers), and `MMCA.ADC.Conference.Contracts` (the client-side gRPC
adapters and the contract-package DI).

## The controller hierarchy, almost everything is inherited

The Conference API exposes **seventeen controllers**, and the striking thing about them is how little
code each carries. They split into three structural families, all built on the generic bases from
[G12](group-12-api-hosting-mapping.md). **Aggregate-root controllers** (seven:
[`SessionsController`](#sessionscontroller), [`SpeakersController`](#speakerscontroller),
[`EventsController`](#eventscontroller), [`QuestionsController`](#questionscontroller),
[`ConferenceCategoriesController`](#conferencecategoriescontroller),
[`SponsorsController`](#sponsorscontroller), [`ActivitiesController`](#activitiescontroller)) derive
from
[`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
and inherit the full read + create + delete surface, overriding actions only to add
`[AllowAnonymous]`, an `[OutputCache]` policy, or a business rule
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionsController.cs:56`,
`SpeakersController.cs:61`, `EventsController.cs:59`, `QuestionsController.cs:41`,
`ConferenceCategoriesController.cs:42`, `SponsorsController.cs:48`, `ActivitiesController.cs:48`).
**Child-and-join controllers** (eight: [`RoomsController`](#roomscontroller),
[`CategoryItemsController`](#categoryitemscontroller),
[`EventSpeakersController`](#eventspeakerscontroller),
[`SessionSpeakersController`](#sessionspeakerscontroller),
[`SessionCategoryItemsController`](#sessioncategoryitemscontroller),
[`SpeakerCategoryItemsController`](#speakercategoryitemscontroller),
[`EventQuestionAnswersController`](#eventquestionanswerscontroller),
[`SessionQuestionAnswersController`](#sessionquestionanswerscontroller)) derive from the read-oriented
[`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
(`RoomsController.cs:101`, `CategoryItemsController.cs:70`, `EventSpeakersController.cs:55`,
`SessionSpeakersController.cs:56`, `SessionCategoryItemsController.cs:56`,
`SpeakerCategoryItemsController.cs:56`, `EventQuestionAnswersController.cs:62`,
`SessionQuestionAnswersController.cs:84`) and add their own `POST`/`PUT`/`DELETE` actions by hand,
because they manipulate a *child* of an aggregate (a room belongs to an event, a category item to a
category) and so their write commands carry a parent identifier the generic create and delete cannot
supply. And **bespoke controllers** (two) sit apart:
[`SessionSelectionController`](#sessionselectioncontroller) derives from Common's
[`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase)
(`SessionSelectionController.cs:37`) and [`ServiceInfoController`](#serviceinfocontroller) from the
shared
[`ServiceInfoControllerBase`](group-12-api-hosting-mapping.md#serviceinfocontrollerbase)
(`ServiceInfoController.cs:20`), because neither exposes a CRUD entity at all.

A concrete controller can be short because the generic bases already supply `GET` (capped, returning
[`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt)), `GET /paged`
(filtered, sorted and paged, returning
[`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt)),
`GET /lookup` (id plus label pairs as
[`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) for
dropdowns), `GET /{id}`, `GET /export` (a streamed CSV, [ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html))
and, on the aggregate base, `POST` (to `201 Created`) and `DELETE` (to `204`). Each Conference
controller's constructor injects the
[`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
for reads plus the specific
[`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
instances for its writes and bespoke reads (`SessionsController.cs:44-57`), then folds any
`Result.Failure` back through the inherited `HandleFailure`. That is the `[Rubric §1, SOLID]` and
`[Rubric §16, Maintainability]` payoff the generic base exists for (the generic-controller and
dynamic-query contract of
[ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html)): the CRUD logic
is written once in Common, and a per-entity controller has almost no reason to change.

## One read hook per controller, not one filter per action

The single most important thing to learn before editing any file here is **where row scoping lives**.
It is not threaded through each action: the framework base declares one hook,
`GetReadSpecificationAsync`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:597`), and
every read action (both list overloads, the lookup, the by-id read and the CSV export) calls it
(`EntityControllerBase.cs:115,170,264,378,422`). Its default answer is the synchronous half,
`GetExportSpecification` (`EntityControllerBase.cs:626`), itself `null`, so a controller that
overrides neither reads unscoped. Twelve of the seventeen Conference controllers override one of the
two. Nine override the asynchronous hook because their rule is resolved through a query handler:
[`SessionsController`](#sessionscontroller) (`SessionsController.cs:76`),
[`SpeakersController`](#speakerscontroller) (`SpeakersController.cs:104`),
[`RoomsController`](#roomscontroller) (`RoomsController.cs:120`),
[`SponsorsController`](#sponsorscontroller) (`SponsorsController.cs:68`),
[`ActivitiesController`](#activitiescontroller) (`ActivitiesController.cs:68`) and the four join
controllers ([`EventSpeakersController`](#eventspeakerscontroller) `:72`,
[`SessionSpeakersController`](#sessionspeakerscontroller) `:73`,
[`SessionCategoryItemsController`](#sessioncategoryitemscontroller) `:73`,
[`SpeakerCategoryItemsController`](#speakercategoryitemscontroller) `:73`). Three override the
synchronous one because their rule needs nothing awaited: [`EventsController`](#eventscontroller)
returns a plain [`PublishedEventSpecification`](group-18-conference-application.md#publishedeventspecification)
or `null` (`EventsController.cs:74-75`), and the two feedback-answer controllers return an
[`OwnedByUserSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ownedbyuserspecificationtentity-tidentifiertype)
built from the caller's user id, or `null` for an Organizer (`EventQuestionAnswersController.cs:74-75`,
`SessionQuestionAnswersController.cs:96-97`). Consequences worth memorizing: a row the specification
excludes is a **404, not a 403** (a "forbidden" answer would confirm the id exists), the lookup
endpoint receives the same scope as the specification's `Criteria` predicate, and most of the read
actions in these files are now attribute-only passthroughs whose bodies just call `base` (for example
`EventQuestionAnswersController.cs:77-110`, `SessionsController.cs:212-229`), kept only because the
route attributes must sit on the derived action. `[Rubric §11, Security]` is the lens, and
[ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html) is the record: the hook
exists so an export can no longer drift wider than the list it mirrors.

The CSV export keeps a second, blunter guard on top of the hook. Eleven controllers override
`ExportAsync` and return `Forbid()` outright for a caller who is not a privileged reader, rather than
serving a scoped file: `SessionsController.cs:240-250`, `SpeakersController.cs:290-300`,
`EventsController.cs:133-143`, `SponsorsController.cs:144-154`, `ActivitiesController.cs:144-154`,
the four join controllers (`EventSpeakersController.cs:139-149`,
`SessionSpeakersController.cs:140-150`, `SessionCategoryItemsController.cs:140-150`,
`SpeakerCategoryItemsController.cs:140-150`) and the two answer controllers against the Organizer role
(`EventQuestionAnswersController.cs:120-130`, `SessionQuestionAnswersController.cs:142-152`).
Controllers whose whole class sits behind a capability gate and expose no anonymous export
([`RoomsController`](#roomscontroller), [`CategoryItemsController`](#categoryitemscontroller),
[`QuestionsController`](#questionscontroller),
[`ConferenceCategoriesController`](#conferencecategoriescontroller)) need no such override.

## Authorization at the edge, three shapes not one

Authorization is **capability-based by default but not uniform**, and the differences are the
interesting part. Most write-bearing controllers carry a class-level
[`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) gate naming one
[`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) capability rather than
a role policy: `SessionsManage` on [`SessionsController`](#sessionscontroller)
(`SessionsController.cs:43`) and on the two session-join controllers
(`SessionSpeakersController.cs:47`, `SessionCategoryItemsController.cs:47`), `EventsManage`
(`EventsController.cs:45`, `EventSpeakersController.cs:46`), `RoomsManage` (`RoomsController.cs:91`),
`CategoriesManage` (`ConferenceCategoriesController.cs:34`, `CategoryItemsController.cs:62`),
`QuestionsManage` (`QuestionsController.cs:33`), `SpeakersManage`
(`SpeakerCategoryItemsController.cs:47`) and `SessionSelectionManage`
(`SessionSelectionController.cs:29`). Reads are then re-opened action by action with
`[AllowAnonymous]` (BR-43 public browse, for example `SessionsController.cs:136`,
`RoomsController.cs:137`). Nine capability constants exist in total, declared once in
`ConferencePermissions.All`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:39-50`).

Three shapes break that pattern, and knowing why saves you from "fixing" them.
[`SpeakersController`](#speakerscontroller) carries only a plain `[Authorize]` at class level
(`SpeakersController.cs:45`) and pushes `[HasPermission(ConferencePermissions.SpeakersManage)]` down
onto the individual organizer write actions (`SpeakersController.cs:289,308,363,375,394`), because one
of its writes is an authenticated self-service surface: the BR-214 profile update re-declares plain
`[Authorize]` (`SpeakersController.cs:332`) and decides inside the action whether the caller is an
organizer or the speaker themselves, comparing the `speaker_id` JWT claim to the route id
(`SpeakersController.cs:343-346`) and passing the answer down as `CallerIsOrganizer` so the handler
can refuse a self-edit of the organizer-only `IsTopSpeaker` field (`SpeakersController.cs:351`).
[`SponsorsController`](#sponsorscontroller) and [`ActivitiesController`](#activitiescontroller) copy
the class-level-`[Authorize]`-plus-per-action-capability shape (`SponsorsController.cs:38` with
`SponsorsManage` at `:143,162,181,206`; `ActivitiesController.cs:38` with `ActivitiesManage` at
`:143,162,181,206`). And [`EventQuestionAnswersController`](#eventquestionanswerscontroller) and
[`SessionQuestionAnswersController`](#sessionquestionanswerscontroller) carry a bare `[Authorize]`
(`EventQuestionAnswersController.cs:54`, `SessionQuestionAnswersController.cs:75`), because *any*
signed-in attendee may submit feedback answers, so no organizer capability applies. Which roles hold
which capability is declared once in `AddModuleConferenceAPI` (below), the permission-over-RBAC model
of [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html);
`[Rubric §11, Security]` is the lens, and these exceptions are evidence that the model is applied per
endpoint rather than pasted.

Orthogonal to all three shapes is the **read audience**, which no attribute can express because it
changes the *rows* rather than the verdict. Ten controllers ask
[`CurrentUserServiceExtensions`](#currentuserserviceextensions)`.IsPrivilegedConferenceReader()`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Authorization/CurrentUserServiceExtensions.cs:24-25`)
and turn the answer into a specification or `null`: `SessionsController.cs:60`,
`SpeakersController.cs:65`, `EventsController.cs:75`, `SponsorsController.cs:52`,
`ActivitiesController.cs:52`, `RoomsController.cs:104`, `EventSpeakersController.cs:58`,
`SessionSpeakersController.cs:59`, `SessionCategoryItemsController.cs:59` and
`SpeakerCategoryItemsController.cs:59`. The helper is one line over `ICurrentUserService` answering
against the [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience)`.PrivilegedRoles`
list declared once in G17 (Organizer and ContentEditor,
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferenceReadAudience.cs:26-30`),
and it carries an explicit remark on itself that this is a read-visibility check and never a
substitute for a `[HasPermission(...)]` gate (`CurrentUserServiceExtensions.cs:20-23`).

## The request records, the inbound write shapes

Several controllers declare small `record class` request types alongside themselves, co-located in the
same file: [`AddRoomRequest`](#addroomrequest) and [`UpdateRoomRequest`](#updateroomrequest)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:30,58`),
[`AddCategoryItemRequest`](#addcategoryitemrequest) and
[`UpdateCategoryItemRequest`](#updatecategoryitemrequest) (`CategoryItemsController.cs:26,42`),
[`AddEventSpeakerRequest`](#addeventspeakerrequest) (`EventSpeakersController.cs:29`),
[`AddSessionSpeakerRequest`](#addsessionspeakerrequest) (`SessionSpeakersController.cs:29`),
[`AddSpeakerCategoryItemRequest`](#addspeakercategoryitemrequest)
(`SpeakerCategoryItemsController.cs:29`), [`AddSessionCategoryItemRequest`](#addsessioncategoryitemrequest)
(`SessionCategoryItemsController.cs:29`), and
[`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest) with
[`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest)
(`EventQuestionAnswersController.cs:25,38`). These are the **wire shapes** for the child-entity writes
the generic base cannot model: each carries the parent identifier (`EventId` at
`RoomsController.cs:33`) plus the child's own fields, all `required`/`init` for immutability
(`RoomsController.cs:30-55`), and the action unpacks the record into the matching `Add*Command` or
`Update*Command` from [G18](group-18-conference-application.md)
([`AddRoomCommand`](group-18-conference-application.md#addroomcommand) at `RoomsController.cs:211`,
[`UpdateRoomCommand`](group-18-conference-application.md#updateroomcommand) at `:240`,
[`RemoveRoomCommand`](group-18-conference-application.md#removeroomcommand) at `:266`). They are
deliberately separate from the application-layer command types and from the outbound DTOs (the §9
"DTOs decoupled from entities" discipline), so the HTTP contract can evolve independently of the
command's parameter list. The aggregate-root controllers, by contrast, bind the application layer's
create request directly as their `TCreateRequest` (for example
[`SessionCreateRequest`](group-18-conference-application.md#sessioncreaterequest) at
`SessionsController.cs:56`), so they need no per-controller record.

The session-feedback family has four records instead of two, and the extra pair is the interesting
one. Alongside [`AddSessionQuestionAnswerRequest`](#addsessionquestionanswerrequest) and
[`UpdateSessionQuestionAnswerRequest`](#updatesessionquestionanswerrequest)
(`SessionQuestionAnswersController.cs:26,59`), the controller declares
[`BatchAddSessionQuestionAnswersRequest`](#batchaddsessionquestionanswersrequest) carrying a session id
plus a list of [`BatchSessionQuestionAnswerItemRequest`](#batchsessionquestionansweritemrequest)
question-and-answer pairs (`SessionQuestionAnswersController.cs:39,49`). Its `POST /batch` action maps
them onto
[`BatchAddSessionQuestionAnswersCommand`](group-18-conference-application.md#batchaddsessionquestionanswerscommand)
so a whole feedback form is applied atomically in one transaction (`:192-211`), and both creates
declare [`Idempotent`](group-12-api-hosting-mapping.md#idempotentattribute)
(`SessionQuestionAnswersController.cs:166,193`) so a retried `Idempotency-Key` replays the first
response rather than re-applying the form
([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)).

## Where the generic shape gives way: filters, warnings, calendars and conditional writes

[`SessionsController`](#sessionscontroller) shows best *how* a controller earns its overrides. Every
read action is `[AllowAnonymous]` and `[OutputCache(PolicyName = "SessionsCache")]`
(`SessionsController.cs:136-137,162-163,211-212,223-224,261-262`). Its read hook dispatches
[`GetPublicSessionFilterQuery`](group-18-conference-application.md#getpublicsessionfilterquery) so a
non-organizer never sees declined sessions (BR-132/BR-49), and because `Session` and `Event` can live
in different data sources the published-event check is resolved by that handler through the
framework's cross-source specification helper rather than by a join (`SessionsController.cs:63-83`;
[ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). The paged read adds a
second layer in `BuildPagedSessionSpecificationAsync` (`SessionsController.cs:106`): `Session` has no
`SpeakerId` column, so that filter key is intercepted and `Remove`d before the generic filter pipeline
can reject it, resolved to an id list through
[`GetSessionsBySpeakerFilterQuery`](group-18-conference-application.md#getsessionsbyspeakerfilterquery),
and **ANDed** with the public filter rather than substituted for it (`SessionsController.cs:110-131`),
because substituting would leak non-accepted sessions to anonymous callers; an unparseable value
simply ignores the key (`:115-119`). The same controller adds three things the base has no notion of:
a `GET /{id}/ics` action that streams one public session as `text/calendar` for the add-to-calendar
affordance via
[`ExportSessionCalendarQuery`](group-18-conference-application.md#exportsessioncalendarquery)
(`SessionsController.cs:261-271`), a BR-86 `X-Warning` header raised on create by comparing the
request times against the event's `StartDate`/`EndDate` and on update from the handler's
`HasDateRangeWarning` flag (`:296-303`, `:338-341`), and an explicit
[`Idempotent`](group-12-api-hosting-mapping.md#idempotentattribute) declaration on the create override
so the contract is visible at the ADC endpoint rather than only inherited (`:279`). Every mutating
action ends by evicting the `conference:sessions` and `conference` output-cache tags
(`SessionsController.cs:306,343,354`), the write-side half of the caching contract.

Conditional writes are now uniform: an update states its precondition in the HTTP `If-Match` header
and nowhere else. [`SupportsIfMatch`](group-12-api-hosting-mapping.md#supportsifmatchattribute) sits
on the session update (`SessionsController.cs:319`), the event update, publish and unpublish
(`EventsController.cs:220,264,297`), the speaker update (`SpeakersController.cs:333`), the category
update (`ConferenceCategoriesController.cs:114`), the question update (`QuestionsController.cs:113`)
and the sponsor and activity updates (`SponsorsController.cs:182`, `ActivitiesController.cs:182`), and
each action pulls the token with `SupportsIfMatchAttribute.RequiredToken(HttpContext)`
(`SessionsController.cs:328`, `EventsController.cs:229,272,305`, `SpeakersController.cs:348`,
`SponsorsController.cs:191`): a request with no header answers **428 Precondition Required** and a
stale token answers **412 Precondition Failed**
([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). Sponsors and
activities take that one step further and dispatch the framework's generic
[`UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>`](group-05-cqrs-pipeline.md#updateentitycommandtentity-tupdaterequest-tidentifiertype)
rather than a bespoke command (`SponsorsController.cs:194`, `ActivitiesController.cs:194`), so their
update path is generic end to end.

Three more read-path carve-outs are worth internalizing before you touch these files. First,
[`SpeakersController`](#speakerscontroller)`.GetAllForLookupAsync` constrains the *label* as well as
the rows: only `FirstName` and `LastName` may be requested by a non-privileged caller
(`SpeakersController.cs:68,218-228`), because `nameProperty=Email` would project the speaker email
straight into the lookup label and go around the DTO mapper that redacts it (BR-66). Second, that
controller's `GetByIdAsync` drops the public specification when the caller's `speaker_id` claim equals
the route id (the self-edit form cannot load without reading the profile it edits), and because the
output-cache key does not vary by caller it turns storage off for that response through
`IOutputCacheFeature` so a private profile can never land in the shared entry
(`SpeakersController.cs:256-266`). Its per-session feedback read is gated self-or-organizer in code and
deliberately left uncached, since every response is authorization-dependent
(`SpeakersController.cs:416-427`), while the two bookmark-count reads are anonymous under the
short-TTL `BookmarkCountsCache` policy (`:439-441`, `:459-461`). Third,
[`EventsController`](#eventscontroller) carries the transitions that have no generic equivalent:
publish, unpublish and a Sessionize refresh (`EventsController.cs:262,295,326`), the last mapping two
domain error codes onto HTTP `429` with a `Retry-After: 300` and onto `502`
(`EventsController.cs:341-347`). It also adds its own `GET /{id}/ics` (`:153-163`) and per-event and
global `now-next` snapshot actions under the short-lived `NowNextCache` policy (`:170-192`), both
dispatching [`GetNowNextQuery`](group-18-conference-application.md#getnownextquery) and returning a
[`NowNextDTO`](group-17-conference-domain.md#nownextdto); the id-less form exists because the
home-screen widget has no event id to pass. Cache eviction there is proportional to blast radius: an
ordinary event write evicts only `conference:events` (`:207,246,281,314`), a delete also evicts
sessions and rooms (`:373-374`), and a Sessionize refresh evicts all six tags it can touch
(`:353-360`). `[Rubric §12, Performance & Scalability]` is the lens for the whole caching story.

## Two more deviations, versioning and decision support

[`ServiceInfoController`](#serviceinfocontroller) exists to **prove the API-versioning machinery works
beyond a single version** (`[Rubric §9, API & Contract Design]`). It is a one-member shell over
Common's [`ServiceInfoControllerBase`](group-12-api-hosting-mapping.md#serviceinfocontrollerbase): it
overrides only `ServiceName => "Conference"`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:23`)
and carries the class-level `[AllowAnonymous]`, `[ApiVersion("1.0", Deprecated = true)]` and
`[ApiVersion("2.0")]` attributes (`ServiceInfoController.cs:17-19`), placed here because they are not
reliably inherited from the base (`ServiceInfoController.cs:12-13`). The shared base serves the same
`/ServiceInfo` route at two API versions selected by the `api-version` header: `1.0` (deprecated)
returns the minimal shape, `2.0` the evolved shape that also advertises the supported and deprecated
version lists. Every other Conference controller declares a single `[ApiVersion("1.0")]`; this one
demonstrates the deprecation story end to end.

[`SessionSelectionController`](#sessionselectioncontroller) is the most behavior-rich controller in the
group and the furthest from the generic shape. It is organizer-only
(`[HasPermission(ConferencePermissions.SessionSelectionManage)]`, `SessionSelectionController.cs:29`)
decision support over an event's session pool: a composite dashboard, category distribution, speaker
overlap and content similarity, each `GET` delegating to a dedicated
[`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (for
example [`GetSessionSelectionDashboardQuery`](group-18-conference-application.md#getsessionselectiondashboardquery))
and output-cached under the `ConferenceCache` policy (`:40-41,54-55,68-69,82-83`; content similarity
also takes a `minimumSimilarity` threshold defaulting to `0.3`, `:86`). Its `POST score/{eventId}` is
the notable one: AI scoring of every eligible session can take minutes, so the action does not run the
work at all. It calls
[`ISessionScoringQueue`](group-18-conference-application.md#isessionscoringqueue)`.TryEnqueue(eventId)`
and switches on the returned
[`SessionScoringEnqueueResult`](group-18-conference-application.md#sessionscoringenqueueresult)
(`:112-130`): `Queued` writes a `[LoggerMessage]`-sourced structured log and returns `202 Accepted`
(`:114-116,134`, `[Rubric §13, Observability & Operability]`), while `AlreadyPending` and `QueueFull`
fold into a `409 Conflict` through `HandleFailure` with distinct error codes (`:118-129`). Refusing a
second concurrent run is a cost decision stated in the source: each pass issues one paid Anthropic
call per session, so two passes would double the spend while racing each other's writes
(`:100-104`, `[Rubric §31, Cost/FinOps]`). The same reasoning drives an explicit
[`NonIdempotent`](group-12-api-hosting-mapping.md#nonidempotentattribute) declaration with a written
justification (`:107`): the queue already deduplicates, so replaying a cached `202` would report
acceptance for a request the queue never saw. The actual work runs on the background
[`SessionScoringProcessor`](group-19-conference-infrastructure.md#sessionscoringprocessor) in
[G19](group-19-conference-infrastructure.md), which keeps the controller free of any scope-lifetime
handling.

## The module entry point and seeder, how Conference plugs in

[`ConferenceModule`](#conferencemodule) is the Conference implementation of
[`IModule`](group-14-module-system-composition.md#imodule). It is tiny by design: `Register(...)`
calls the [`DependencyInjection`](#dependencyinjection) extension's `AddConferenceModule(...)`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:28-29`), which chains
the Application, Infrastructure and API registrations in dependency order into one call
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:25-27`). The API
layer's `AddModuleConferenceAPI` is not a no-op: it calls `AddPermissions` to grant
[`RoleNames`](group-08-auth.md#rolenames)`.Organizer` and `.Admin` every
[`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) capability, and
`ContentEditor` only the five-capability `ContentManagement` curation subset with no event structure,
rooms, questions or session selection (`DependencyInjection.cs:41-51`; the subset itself is
`ConferencePermissions.cs:57-64`). Attendees are granted nothing here, so attendee-facing endpoints
stay on a plain `[Authorize]` that carries no capability (`DependencyInjection.cs:34-36`). And
`RegisterDisabledStubs(...)` registers **both** a
[`DisabledSessionBookmarkValidationService`](group-17-conference-domain.md#disabledsessionbookmarkvalidationservice)
and a [`DisabledEventLiveValidationService`](group-17-conference-domain.md#disabledeventlivevalidationservice)
as singletons (`ConferenceModule.cs:21-25`) so that *other* hosts which depend on Conference's
[`ISessionBookmarkValidationService`](group-17-conference-domain.md#isessionbookmarkvalidationservice)
or [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice) but do
**not** host Conference still resolve those interfaces (they no-op, or are later `Replace`d by the
gRPC adapters). The [`ModuleLoader`](group-14-module-system-composition.md#moduleloader)
([G14](group-14-module-system-composition.md)) discovers `ConferenceModule` by reflection and registers
it in topological order, the same mechanism whether Conference is co-hosted or runs alone.

[`ConferenceModuleSeeder`](#conferencemoduleseeder) implements
[`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:13`) and is the
API layer's thin bridge to the real seeding logic: it resolves `IUnitOfWork` and `IConfiguration` from
the passed service provider, reads `Seeding:IncludeSampleConferenceData` (false when the key is
absent, and set to `true` only by the local AppHost at
`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:210`), then constructs and runs
[`ConferenceModuleDbSeeder`](group-19-conference-infrastructure.md#conferencemoduledbseeder) from
[G19](group-19-conference-infrastructure.md) with that flag (`ConferenceModuleSeeder.cs:21-29`). Three
anchor types round out the project: `AssemblyReference` and `ClassReference`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/AssemblyReference.cs:5,11`) are the
per-package anchors the module scan and the architecture fitness tests pin against, and
[`ConferenceErrorResources`](#conferenceerrorresources)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Resources/ConferenceErrorResources.cs:11`)
is an empty sealed class acting as the anchor for the module's `.resx` error-code translations, keyed
by domain error `Code` and deliberately omitting runtime-variable messages so they degrade to English
with the interpolated value intact (`ConferenceErrorResources.cs:3-10`).

## The gRPC edge, Conference as both server and client

When Conference runs in its own process, two of its in-process collaborations must cross a network
boundary, and both are handled by the [G13](group-13-grpc-contracts.md) transport boundary (`Result`
over the wire, transport at the edge,
[ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)). Conference is the **server**
for two contracts. [`SessionBookmarksGrpcService`](#sessionbookmarksgrpcservice) exposes Conference's
`ISessionBookmarkValidationService` to Engagement, answering "is this session valid to bookmark?"
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/SessionBookmarksGrpcService.cs:27`) and
"give me the session ids for this event" (`SessionBookmarksGrpcService.cs:45`).
[`EventLiveValidationGrpcService`](#eventlivevalidationgrpcservice) exposes
`IEventLiveValidationService` to Engagement's conference-day live layer across **four** methods, each
projecting a domain record onto the wire shape: `GetEventLiveInfo` returns an
[`EventLiveInfo`](group-17-conference-domain.md#eventliveinfo) as publish state plus live-window
bounds in Unix seconds
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/EventLiveValidationGrpcService.cs:26`),
`GetSessionLiveInfo` adds a [`SessionLiveInfo`](group-17-conference-domain.md#sessionliveinfo)'s
stringified speaker ids, plenum flag and moderation default (`:50`), `GetSponsorLiveInfo` returns a
[`SponsorLiveInfo`](group-17-conference-domain.md#sponsorliveinfo) (`:79`), and
`GetCurrentRoomSessionInfo` resolves the room's currently-running session within a caller-supplied
grace window as a [`RoomSessionInfo`](group-17-conference-domain.md#roomsessioninfo) (`:103`). Each
server method is a constructor-injected wrapper over the inner C# service: it null-guards request and
context, awaits the inner call, and on a failed `Result` calls `result.ThrowIfFailure()`
(`SessionBookmarksGrpcService.cs:39,57`, `EventLiveValidationGrpcService.cs:38,62,91,115`) so the
[`GrpcResultExceptionInterceptor`](group-13-grpc-contracts.md#grpcresultexceptioninterceptor) can
translate the failure into an `RpcException` carrying structured `error-{i}-*` trailers.

On the **client** side, each contract has a hand-written adapter in `MMCA.ADC.Conference.Contracts`
that Engagement uses. [`SessionBookmarkValidationServiceGrpcAdapter`](#sessionbookmarkvalidationservicegrpcadapter)
implements the *identical* `ISessionBookmarkValidationService` interface on top of the generated gRPC
client
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:27-29`),
and [`EventLiveValidationServiceGrpcAdapter`](#eventlivevalidationservicegrpcadapter) does the same
for all four `IEventLiveValidationService` methods
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/EventLiveValidationServiceGrpcAdapter.cs:26-28,36,65,98,127`),
converting the Unix-second live-window fields back into UTC `DateTime`s. Both pin a **5-second
per-call deadline** on every RPC (`SessionBookmarkValidationServiceGrpcAdapter.cs:35`,
`EventLiveValidationServiceGrpcAdapter.cs:33`), much tighter than the shared resilience pipeline's 30s
attempt and 90s total budget, precisely because these calls sit inline in user request paths (bookmark
create and list, live-layer poll and question commands) and a *hung* (as opposed to refused)
Conference peer must fail fast rather than hold the caller hostage
(`EventLiveValidationServiceGrpcAdapter.cs:30-32`). Both catch `RpcException` and reverse the mapping
with the framework's own `RpcException.ToResult` decoder
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:210,234`), which reads the
trailers back into [`Error`](group-01-result-error-handling.md#error) instances and degrades a pure
transport fault (connection reset, deadline exceeded) to a single `Grpc.{StatusCode}` failure sourced
with the calling method's name (`SessionBookmarkValidationServiceGrpcAdapter.cs:58,85`,
`EventLiveValidationServiceGrpcAdapter.cs:59`). Because both the in-process implementation and each
adapter satisfy the same interface, swapping a co-located module for a remote service is a
registration change, not a rewrite
([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html); `[Rubric §7, Microservices
Readiness]`).

Those registration swaps are performed by the contract package's `DependencyInjection` extension, one
method per contract: `AddConferenceSessionValidationClient(serviceName = "conference")`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/DependencyInjection.cs:43`) and
`AddConferenceEventLiveValidationClient(...)` (`DependencyInjection.cs:73`). Each does exactly two
things: registers a typed gRPC client through Common's `AddTypedGrpcClient<TClient>(serviceName)`
(`:45,75`, which resolves `http://conference` through Aspire service discovery and attaches the
JWT-forwarding interceptor plus the Polly resilience handler), then calls `services.Replace(...)` with
a *scoped* descriptor rather than `TryAdd` (`:49,79`) to overwrite whatever implementation is already
in the container (the real in-process service if Conference is co-hosted, or the `Disabled...` stub if
not) with the gRPC adapter. The `Replace` is deliberate so the adapter wins in either case, and it
must be called from the consumer's `Program.cs` *after* `ModuleLoader.DiscoverAndRegister(...)` so the
in-process or stub registration is already present for `Replace` to find (`:36-39`). Note the
**bidirectional** Conference-to-Engagement relationship: Conference serves these two contracts and
also consumes Engagement's
[`IBookmarkCountService`](group-22-engagement-module.md#ibookmarkcountservice), so the Conference host
registers `AddEngagementBookmarkCountClient()`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:349`) and the AppHost deliberately
gives only the Engagement-to-Conference edge a startup `WaitFor`, leaving the reverse edge a plain
`WithReference` so the pair cannot deadlock; transient "peer not ready" errors self-heal through the
resilience pipeline (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:270,273`;
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html), `[Rubric §29,
Resilience]`).

## The service host: Kestrel first, then caching and warm-up

The `MMCA.ADC.Conference.Service` `Program.cs` boots only the Conference module. Kestrel is configured
before anything else, and the whole of it is one line:
`builder.ConfigureEndpointsWithHealthProbe(HttpProtocols.Http2)`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:84`), the shared extension from
Common's [`KestrelEndpointExtensions`](group-16-aspire-orchestration.md#kestrelendpointextensions)
([G16](group-16-aspire-orchestration.md)). Passing `HttpProtocols.Http2` sets every endpoint default to
HTTP/2-only on cleartext (h2c prior knowledge), so cross-service gRPC clients negotiate HTTP/2 without
TLS or ALPN; on a cleartext endpoint `Http1AndHttp2` would effectively disable HTTP/2 and Kestrel would
reject gRPC frames with `GOAWAY HTTP_1_1_REQUIRED` (`Program.cs:74-82`). That transport choice is
[ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html). The same helper adds a
dedicated HTTP/1.1-only listener for the ACA `httpGet` probes when `HealthProbe:Port` is configured,
because the h2c-only endpoint rejects the platform's HTTP/1.1 probe requests. The rest of the host is
the standard ADC REST composition: Serilog registered as one provider rather than through
`UseSerilog()` so the OpenTelemetry-to-Azure-Monitor provider survives (`Program.cs:99-100`), an
optional Key Vault configuration source layered in before anything binds settings (`:109`), the
Conference-owned `MMCA.ADC.Conference.Scoring` meter (`:119`), health checks with a relational database
required (`:163`), CORS, API versioning and rate limiting (`:166-168`), response compression (`:259`),
OpenAPI (`:264`), RS256 JWT validation via JWKS discovery forwarded through the Gateway (`:273-277`),
exception handlers (`:280`), the scheduler and audit-trail extension points (`:292,296`), and the
shared middleware pipeline (`:376`;
[ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html),
[ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html),
[ADR-079](https://ivanball.github.io/docs/adr/079-shared-http-middleware-pipeline.html)).

Output caching is where this host carries the most bespoke configuration (`Program.cs:175-245`). The
base policy is deny-by-default `NoCache` (`:177`), so only explicitly decorated endpoints cache at all.
`ConferenceCache` stays on the built-in default semantics because the permission-gated
[`SessionSelectionController`](#sessionselectioncontroller) references it, and
[ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)'s
public policy must never back a permission-gated endpoint since a cached hit is served before MVC's
filters run (`:179-185`). Nine further policies (`ConferencePublicCache`, `EventsCache`,
`SessionsCache`, `SpeakersCache`, `RoomsCache`, `CategoriesCache`, `QuestionsCache`, `SponsorsCache`,
`ActivitiesCache`) are registered through `AddPublicEndpointPolicy` at a 5-minute TTL with hierarchical
tags (`:215-228`), and each **bypasses the cache entirely for the privileged read audience** (`:214`,
the bypass list built from `ConferenceReadAudience.PrivilegedRoles` so it can never diverge from the
API-layer visibility checks), for two reasons spelled out in the source (`:187-213`): privileged
responses include unpublished rows that must never land in a shared public entry, and admin surfaces
read back immediately after writing, where a stale cached row version would make the next save throw
`DbUpdateConcurrencyException`. Two policies then sit at a 60-second TTL for different reasons:
`NowNextCache` because its payload changes with the clock and is identical for every role, so it takes
no bypass at all (`:231`), and `BookmarkCountsCache` because bookmark counts are owned by Engagement in
another process (`:233-243`). All of this is
[ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html):
[`PublicEndpointOutputCachePolicy`](group-12-api-hosting-mapping.md#publicendpointoutputcachepolicy)
exists because the UI attaches a Bearer token to every request and the built-in default policy refuses
to cache anything carrying `Authorization`, which on conference day meant the cache served none of the
real traffic.

Two mechanisms close the distance that TTLs alone cannot. First, at two replicas the store itself must
be shared: when a Redis connection string is present the host backs the **output** cache with Redis as
well as the distributed cache (`Program.cs:130,140`), because the default per-replica memory store
meant an eviction reached only the replica that served the mutation while the other kept serving the
pre-edit payload for the full TTL; the same branch adds a two-level cache, an in-process L1 over the
Redis L2 under a disjoint keyspace, so a repeat read inside one replica never leaves the process while
invalidation still crosses replicas (`:148-151`). Second, a write that never touches a Conference
controller still has to reach this cache: an Engagement bookmark or an application-layer speaker
auto-link has no handle on `IOutputCacheStore`, so the writer publishes an
[`OutputCacheEvictionRequested`](group-04-events-outbox.md#outputcacheevictionrequested) integration
event, this host registers the consumer half with `AddOutputCacheEvictionHandler()` (`:249`) and the
broker half with `RegisterOutputCacheEvictionConsumer()` (`:352`), and the tag is dropped on arrival.
Registering only one of the two halves is a silent no-op (`:246-248`). The host also contributes the
module's error-code translations to the edge localizer with
`AddErrorResources<ConferenceErrorResources>()` (`:315`), so a Conference domain error like
`Event.Name.Empty` is rendered in the caller's culture by the shared
[`ErrorLocalizer`](group-12-api-hosting-mapping.md#errorlocalizer)
([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).

One more startup extension point matters: [`SelfHttpOutputCacheWarmupTask`](#selfhttpoutputcachewarmuptask),
registered via `AddWarmupTask<T>()` (`Program.cs:256`) as an
[ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html)
[`IWarmupTask`](group-16-aspire-orchestration.md#iwarmuptask). The task itself is almost empty: it
derives from [`SelfHttpWarmupTaskBase`](group-16-aspire-orchestration.md#selfhttpwarmuptaskbase)
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/SelfHttpOutputCacheWarmupTask.cs:22-28`) and
contributes only a name (`:59`) and a list of paths (`:62`), while the base owns the request machinery
(waiting for the server to start, resolving the actually-bound cleartext port, pinning HTTP/2 prior
knowledge, and treating a failure as non-fatal). The paths are the interesting part, and there are
**eight** of them in two families (`SelfHttpOutputCacheWarmupTask.cs:42-56`), because OutputCache keys
on the full URL and a warmed entry is only ever hit by a byte-identical query string: family one
mirrors the Blazor list pages, whose service base interpolates C# bools and so writes capital
`False`/`True`; family two mirrors the hand-written lookup services, which write lowercase literals and
`pageSize=10000` (`:30-41`). Warming one family left the other paying a cold read on its first real
caller. Every path is `[AllowAnonymous]`, so the base's require-success loop sees `200` and skips
nothing.

## The runtime picture, one host, two transports

After module discovery (`Program.cs:308-312`) the host wires the Engagement gRPC client (`:349`), the
broker (`AddBrokerMessaging` registering the `UserRegistered` integration-event consumer that drives
the BR-207 email-match speaker auto-link through
[`UserRegisteredHandler`](group-18-conference-application.md#userregisteredhandler), `:350-352`), the
decorator pipeline, `AddGrpcServiceDefaults()` (`:361`) and the per-module health checks (`:364`). It
initializes the database before serving traffic (`:373`), maps the shared health endpoints on every
listener (`:375`), and then publishes **both** gRPC endpoints over the same Kestrel HTTP/2 channel the
REST controllers serve: `MapGrpcService<SessionBookmarksGrpcService>().RequireAuthorization()` (`:396`)
and `MapGrpcService<EventLiveValidationGrpcService>().RequireAuthorization()` (`:397`), adding gRPC
reflection in Development only (`:401`). The `RequireAuthorization()` is not decoration: both contracts
answer conference-state questions raised on behalf of a specific end user, so internal-only ingress is
not considered sufficient, and every caller is an Engagement handler sitting behind an authenticated
controller whose bearer token the JWT-forwarding interceptor carries across (`:389-395`,
`[Rubric §11, Security]`).

A browser request to `GET /Sessions` enters the Gateway, is forwarded as HTTP/2 to this host, flows
through the shared middleware pipeline, hits an output-cached
[`SessionsController`](#sessionscontroller) action whose read hook excludes declined sessions for
non-privileged readers, runs the query handler's CQRS pipeline, and returns a `CollectionResult<`[`SessionDTO`](group-17-conference-domain.md#sessiondto)`>`.
Meanwhile an Engagement service can simultaneously call `ValidateSessionForBookmark` or
`GetSessionLiveInfo` over gRPC against the very same process, and a `UserRegistered` message from
Identity can arrive over the broker and auto-link a speaker, without any of the three paths knowing
about the others. That *one module, three ingress paths, identical whether co-hosted or standalone*
property is the whole point of this chapter, and the reason the Conference edge is mostly thin glue
over reusable Common machinery: the version-header contract and the two-version `ServiceInfo` surface
are the `[Rubric §9, API & Contract Design]` evidence, and the `Replace`-driven client swaps are the
`[Rubric §7, Microservices Readiness]` extension point that keeps the topology reversible.

### AssemblyReference
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: the assembly marker for the Conference API layer. A static holder exposing the
  running `Assembly` and its short `AssemblyName`, used as a stable `typeof(...)` anchor when other
  code needs to point Scrutor assembly scanning or reflection at this project without hard-coding a
  string name.
- **Depends on**: `System.Reflection.Assembly` (BCL) only. No first-party dependencies.
- **Concept introduced, the assembly-reference marker.** This is the first place the pattern appears
  in this group, but it is the same convention every layer in the codebase uses (each `*.Domain`,
  `*.Application`, `*.Infrastructure`, `*.API` assembly ships one). `[Rubric §15, Best Practices &
  Code Quality]` (assesses idiomatic, low-friction conventions): rather than scattering
  `typeof(SomeRandomType).Assembly` literals through registration code, one canonical marker per
  assembly gives scanning a single, rename-safe entry point.
- **Walkthrough**: two `public static readonly` fields (`AssemblyReference.cs:7-8`).
  `Assembly` is `typeof(AssemblyReference).Assembly` (the compiled Conference.API assembly), and
  `AssemblyName` is `Assembly.GetName().Name ?? string.Empty` (the null-coalesce guards the
  theoretical case where the runtime returns no simple name). No methods, no state beyond these two
  read-only handles.
- **Why it's built this way**: reflection-based registration (Scrutor, module discovery) needs a
  concrete type living inside the target assembly to resolve `.Assembly`. A dedicated marker keeps
  that reference explicit and survives type renames elsewhere in the project.
- **Where it's used**: as the assembly handle for layer registration in
  [`DependencyInjection`](#dependencyinjection) and for reflective discovery driven by
  [`ModuleLoader`](group-14-module-system-composition.md#moduleloader).

### ClassReference
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: an empty, non-static companion marker (`public class ClassReference { }`) paired
  with [`AssemblyReference`](#assemblyreference). It exists purely as a generic type argument for
  APIs that want `typeof(ClassReference)` or a `<T>`-shaped assembly anchor rather than the static
  field.
- **Depends on**: nothing.
- **Concept introduced**: the instantiable variant of the assembly-marker pattern introduced in
  [`AssemblyReference`](#assemblyreference); some registration helpers key off a *type* generic
  parameter (`AddSomething<ClassReference>()`) instead of an `Assembly` value, and a static class
  cannot be used as a type argument, hence this plain class.
- **Walkthrough**: no members. The declaration is the whole type (`AssemblyReference.cs:11`).
- **Where it's used**: same reflective/scan entry-point role as its static sibling; consumed
  wherever a generic-argument assembly anchor is required in the Conference service composition.

### DependencyInjection
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:14` · Level 2 · class (static)

- **What it is**: the Conference module's DI composition facade. It stitches the module's three
  registerable layers (Application, Infrastructure, API) into one call and declares the Conference
  role-to-permission grants that back the module's `[HasPermission(...)]`-gated endpoints.
- **Depends on**: [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings)
  (the shared cross-module settings passed through to the Application layer),
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) (the capability
  catalog whose `All` and `ContentManagement` subsets are granted),
  [`RoleNames`](group-08-auth.md#rolenames) (`Organizer`, `Admin`, `ContentEditor` constants), and
  [`AuthorizationPolicies`](group-08-auth.md#authorizationpolicies) (its `RequireAuthenticated`
  policy is referenced in the doc comment as the fallback for attendee-facing endpoints).
  Externally it relies on `IServiceCollection` (Microsoft DI) and the sibling layer registration
  extensions (`AddModuleConferenceApplication`, `AddModuleConferenceInfrastructure`).
- **Concept introduced, the `extension(IServiceCollection)` registration facade and permission
  grants.** The class body is a C# preview `extension(IServiceCollection services)` block
  (`DependencyInjection.cs:16`), the codebase-wide idiom for DI registration (see
  [primer §4](00-primer.md#4-c-14-preview-features-in-play)); the methods read as instance calls
  on `services` without a formal `this` parameter. `[Rubric §7, Microservices Readiness]` (assesses
  whether a module registers itself with one self-contained call so it can boot in its own service
  host): `AddConferenceModule` is exactly that single entry point.
  `[Rubric §11, Security]` (assesses how authorization is modeled): the permission grants centralize
  the role-to-capability map in one place instead of scattering `[Authorize(Roles = ...)]` lists
  across endpoints.
- **Walkthrough**: two extension methods.
  - `AddConferenceModule(ApplicationSettings applicationSettings)` (`DependencyInjection.cs:23`)
    chains the three layers in dependency order: `AddModuleConferenceApplication(applicationSettings)`,
    `AddModuleConferenceInfrastructure()`, then `AddModuleConferenceAPI()`, returning `services` for
    fluent chaining (`DependencyInjection.cs:25-29`).
  - `AddModuleConferenceAPI()` (`DependencyInjection.cs:39`) calls `services.AddPermissions(...)`
    and, inside the callback, declares three grants (`DependencyInjection.cs:41-51`):
    `Organizer` and `Admin` each receive `[.. ConferencePermissions.All]` (every Conference
    capability), while `ContentEditor` receives only `[.. ConferencePermissions.ContentManagement]`
    (the catalog-curation subset, no event structure, rooms, questions, or session selection).
    Attendees are granted nothing here, so attendee-facing endpoints stay on the plain
    `RequireAuthenticated` policy rather than a permission gate.
- **Why it's built this way**: the layered chain keeps the service host's `Program.cs`
  context-unaware: it registers a module with one call and never names Conference's internal layers.
  The narrow `ContentEditor` subset is what makes the permission model earn its keep over role
  checks: the organizer/editor distinction lives in a single grant declaration, not duplicated across
  every controller action. This is the module-registration convention described in
  `MMCA.Common/CLAUDE.md`.
- **Where it's used**: `AddConferenceModule` is invoked from
  [`ConferenceModule`](#conferencemodule)`.Register`, which
  [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) drives at startup in the
  Conference service host (and in integration-test hosts).

### ConferenceModule
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:15` · Level 5 · class (sealed)

- **What it is**: the [`IModule`](group-14-module-system-composition.md#imodule) entry point for the
  Conference bounded context. `ModuleLoader` discovers it reflectively at startup and registers it in
  topological dependency order.
- **Depends on**: [`IModule`](group-14-module-system-composition.md#imodule) (the contract it
  implements), [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings)
  (passed to `Register`), and the two cross-module contracts it stubs:
  [`ISessionBookmarkValidationService`](group-17-conference-domain.md#isessionbookmarkvalidationservice)
  with [`DisabledSessionBookmarkValidationService`](group-17-conference-domain.md#disabledsessionbookmarkvalidationservice),
  and [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice)
  with [`DisabledEventLiveValidationService`](group-17-conference-domain.md#disabledeventlivevalidationservice).
  It delegates the real registration to [`DependencyInjection`](#dependencyinjection)`.AddConferenceModule`.
- **Concept introduced, the module entry-point pattern and disabled-module stubs.** Every bounded
  context ships one `IModule` so the host `Program.cs` stays context-unaware and lets
  [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) handle discovery and Kahn
  topological ordering (the pattern is taught with `IModule` itself in group 14, so this is a
  concrete instance, not a new concept).
  `[Rubric §7, Microservices Readiness]` (assesses whether modules are isolated enough to extract
  into their own process): `RegisterDisabledStubs` is the mechanism that lets Conference run in one
  service while its contracts stay resolvable in another. `[Rubric §3, Clean Architecture]`
  (assesses dependency inversion): the API layer never references Infrastructure or Domain types
  directly; registration indirects entirely through the module interface and the DI facade.
- **Walkthrough**: one property and two methods.
  - `Name => "Conference"` (`ConferenceModule.cs:18`) is the module's identity used by the loader and
    by config keys such as `Modules:Conference:Enabled`.
  - `RegisterDisabledStubs(IServiceCollection services)` (`ConferenceModule.cs:21`) registers
    **two** no-op singletons so that when Conference is *disabled* in some other service host (for
    example the Engagement service), the cross-module contracts still resolve:
    `DisabledSessionBookmarkValidationService` for
    [`ISessionBookmarkValidationService`](group-17-conference-domain.md#isessionbookmarkvalidationservice)
    (`ConferenceModule.cs:23`) and `DisabledEventLiveValidationService` for
    [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice)
    (`ConferenceModule.cs:24`). Callers never hit an unresolved-service failure.
  - `Register(IServiceCollection services, IConfigurationBuilder configuration, ApplicationSettings applicationSettings)`
    (`ConferenceModule.cs:28`), when Conference is enabled, is expression-bodied delegation straight to
    `services.AddConferenceModule(applicationSettings)` (`ConferenceModule.cs:29`).
- **Why it's built this way**: centralizing per-context DI behind `IModule` keeps the host generic
  (it only calls the loader), and `RegisterDisabledStubs` keeps cross-module contracts resolvable
  even when Conference is offline in a given service. That disabled-stub arrangement is the concrete
  expression of the service-extraction topology in [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) (gRPC extraction) and [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) (service
  topology + YARP): across a process boundary the same interface is satisfied by a gRPC client on one
  side and a disabled stub where the module is off.
- **Where it's used**: discovered reflectively by
  [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) in the Conference service's
  `Program.cs` and in integration-test hosts.

### ConferenceModuleSeeder
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:13` · Level 9 · class (sealed)

- **What it is**: the module-level seeding entry point for Conference. It implements
  [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) and, at application startup,
  seeds the real event plus feedback questions, and optionally the sample browse data (rooms,
  speakers, sessions) when configuration enables it. It is the API-layer adapter that resolves
  dependencies from DI and hands them to the Infrastructure-layer
  [`ConferenceModuleDbSeeder`](group-19-conference-infrastructure.md#conferencemoduledbseeder) that
  does the actual inserts.
- **Depends on**: [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) (the
  contract), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and `IConfiguration`
  (resolved from the `IServiceProvider`), and
  [`ConferenceModuleDbSeeder`](group-19-conference-infrastructure.md#conferencemoduledbseeder) (the
  concrete seeder it constructs).
- **Concept introduced, the two-part seeder (module adapter over DB seeder) and environment-gated
  seed data.** The module keeps a thin `IModuleSeeder` at the API layer that only *resolves* services
  and *reads config*, delegating the entity work to an Infrastructure seeder that knows the domain
  factories. `[Rubric §17, DevOps]` (assesses repeatable, environment-aware provisioning): the
  sample-data gate keeps test fixtures out of production databases. `[Rubric §11, Security]`
  (assesses that non-production seed content never leaks to prod): sample browse data is opt-in and
  absent by default.
- **Walkthrough**: one property and one method.
  - `ModuleName => "Conference"` (`ConferenceModuleSeeder.cs:16`) matches
    [`ConferenceModule`](#conferencemodule)`.Name` so the loader pairs the seeder with its module.
  - `SeedAsync(IServiceProvider serviceProvider, CancellationToken cancellationToken)`
    (`ConferenceModuleSeeder.cs:19`) resolves
    [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and `IConfiguration` from the
    provider (`ConferenceModuleSeeder.cs:21-22`), reads the `bool`
    `Seeding:IncludeSampleConferenceData` flag (defaulting to `false` when the key is absent,
    `ConferenceModuleSeeder.cs:26`), constructs a
    [`ConferenceModuleDbSeeder`](group-19-conference-infrastructure.md#conferencemoduledbseeder) with
    that flag, and awaits its `SeedAsync` with `ConfigureAwait(false)`
    (`ConferenceModuleSeeder.cs:28-29`). The comment (`ConferenceModuleSeeder.cs:24-25`) records the
    intent: sample data is gated to non-production hosts (the local AppHost and E2E CI) so prod
    databases receive only the real event and questions.
- **Why it's built this way**: splitting the module adapter from the DB seeder keeps the API layer
  free of persistence detail (it never touches EF types), while the sample-data flag makes the
  behavior deterministic across environments: production stays lean and CI/local get browsable
  fixtures. Seeding runs through the same [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork)
  and domain factories as the handlers, so seeded rows satisfy the same invariants.
- **Where it's used**: invoked during the module-seeding pass driven by
  [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) after schema initialization in
  the Conference service host.
- **Caveats / not-in-source**: the exact hosts that set `Seeding:IncludeSampleConferenceData=true`
  (local AppHost, E2E CI) are asserted in the source comment, not verifiable from this file itself.

### AddCategoryItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:26` · Level 0 · record class

- **What it is**: the JSON body POSTed to `/CategoryItems` to add an item to a category. It carries the
  owning `CategoryId`, an *optional* client-supplied `CategoryItemId`, a display `Name`, and a `Sort`
  order (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:26-39`).
  A [`CategoryItem`](group-17-conference-domain.md#categoryitem) is a child of a
  [`Category`](group-17-conference-domain.md#category), so every write carries the parent id alongside
  the item's own fields.
- **Depends on**: nothing first-party at the type level; its property types are the
  `ConferenceCategoryIdentifierType` and `CategoryItemIdentifierType` global aliases (see
  [identifier aliases](00-primer.md#2-architectural-styles-this-codebase-commits-to)) plus BCL `string`/`int`.
  Consumed by [`CategoryItemsController`](#categoryitemscontroller), which forwards it to
  [`AddCategoryItemCommand`](group-18-conference-application.md#addcategoryitemcommand).
- **Concept introduced, the API request record vs. the application command.** `[Rubric §9, API &
  Contract Design]` assesses DTOs decoupled from domain entities and stable, intentional wire contracts.
  The codebase keeps **three** distinct shapes in every write path: the *request record* (what the HTTP
  client sends), the *command* (the application-layer message), and the *entity* (the domain object). The
  controller's `CreateAsync` does the manual hop
  (`CategoryItemsController.cs:134-139`): it reads request fields and constructs the command positionally.
  That is the manual-mapping policy of
  [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) applied at the *inbound* edge,
  no reflective mapper between the wire and the application. `[Rubric §1, SOLID]` (interface segregation):
  each record exposes exactly the fields its one endpoint needs, so add and update never share an
  over-broad type. The `required` modifier on every non-optional property pushes "you must supply this"
  into model binding, so a missing field is a 400 before any handler runs.
- **Walkthrough**: a `record class` (not `sealed`) whose members are all `required … { get; init; }`,
  settable only at construction and immutable after (a recurring choice across these contracts).
  `CategoryItemId` is the single *nullable* member (`CategoryItemsController.cs:32`), letting an
  importer or seed flow pin an explicit id while a normal create leaves it null and lets the domain mint
  one.
- **Why it's built this way**: a dedicated record per endpoint keeps the OpenAPI schema and binding
  errors named after real domain terms; separating add from update (rather than one
  nullable-everything record) keeps each contract honest about what is mutable.
- **Where it's used**: bound by [`CategoryItemsController`](#categoryitemscontroller)'s `[FromBody]`
  create parameter only (`CategoryItemsController.cs:130-131`). That action is marked
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute)
  (`CategoryItemsController.cs:129`), so a retried POST carrying the same `Idempotency-Key` replays the
  first response instead of adding a second row: `[Rubric §10, Cross-Cutting]`, the replay contract is
  declared on the action because this create is hand-written rather than inherited from the CRUD base
  (`CategoryItemsController.cs:121-127`).

---

### AddEventQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:25` · Level 0 · record class

- **What it is**: the POST body for answering a feedback question against an event. It names the
  `EventId`, the `QuestionId` being answered, and the `AnswerValue` text
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:25-35`).
- **Depends on**: id-alias property types (`EventIdentifierType`, `QuestionIdentifierType`) plus BCL
  `string`. Consumed by [`EventQuestionAnswersController`](#eventquestionanswerscontroller), which
  forwards it to
  [`AddEventQuestionAnswerCommand`](group-18-conference-application.md#addeventquestionanswercommand).
- **Concept, user-owned write data behind authorization.** See the request-vs-command shape under
  [`AddCategoryItemRequest`](#addcategoryitemrequest). What distinguishes the answer records from the
  public-catalog records is the surrounding `[Rubric §11, Security]` story (authorization enforced
  server-side, results scoped per user): the controller is gated class-level by a plain `[Authorize]`
  (`EventQuestionAnswersController.cs:54`) rather than by a Conference permission, because answering is an
  attendee capability rather than an organizer one, and the record itself carries **no** `UserId`. The
  controller never trusts the client for identity: `CreatedBy` is stamped from the authenticated principal
  by the audit pipeline (see
  [soft-delete and audit](00-primer.md#2-architectural-styles-this-codebase-commits-to)), and reads are
  narrowed to the caller's own rows by the `GetExportSpecification` override, which returns an
  [`OwnedByUserSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ownedbyuserspecificationtentity-tidentifiertype)
  for anyone who is not an Organizer (BR-8, `EventQuestionAnswersController.cs:74-75`).
- **Walkthrough**: three `required { get; init; }` properties, no methods. On add the controller passes
  `null` for the answer's own id: `new AddEventQuestionAnswerCommand(request.EventId, null,
  request.QuestionId, request.AnswerValue)` (`EventQuestionAnswersController.cs:150`), so the domain mints
  the answer id.
- **Why it's built this way**: naming the `QuestionId` on *add* (but not on update) encodes that you pick
  which question an answer belongs to once, at creation.
- **Where it's used**: `[FromBody]` on [`EventQuestionAnswersController`](#eventquestionanswerscontroller)'s
  `CreateAsync` (`EventQuestionAnswersController.cs:145-146`), which is
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute)
  (`EventQuestionAnswersController.cs:144`) so a retried submit cannot double-post an answer.

---

### AddEventSpeakerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventSpeakersController.cs:29` · Level 0 · record class

- **What it is**: the POST body that links a speaker to an event. It carries exactly two ids, `EventId`
  and `SpeakerId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventSpeakersController.cs:29-36`).
- **Depends on**: the `EventIdentifierType` / `SpeakerIdentifierType` aliases only. Consumed by
  [`EventSpeakersController`](#eventspeakerscontroller), which forwards it to
  [`AddEventSpeakerCommand`](group-18-conference-application.md#addeventspeakercommand).
- **Concept introduced, the join-entity write contract.** `[Rubric §4, Domain-Driven Design]` assesses
  whether references *between* aggregates are by id, not by object graph. This record is the on-the-wire
  embodiment of that rule: an event-to-speaker association
  ([`EventSpeaker`](group-17-conference-domain.md#eventspeaker)) is two ids, never an embedded
  [`Speaker`](group-17-conference-domain.md#speaker). There is no `Update*` sibling: a link either exists
  or does not, so the resource surface is add plus delete only. The controller passes `null` for the join
  entity's own id (`new AddEventSpeakerCommand(request.EventId, null, request.SpeakerId)`,
  `EventSpeakersController.cs:169`) so the domain mints the link id. `[Rubric §9, API & Contract Design]`:
  every property is `required`, so an incomplete association is rejected at binding.
- **Walkthrough**: two `required {Alias} { get; init; }` members and nothing else; the doc comments name
  each role ("the event to add the speaker to", `EventSpeakersController.cs:31`).
- **Why it's built this way**: a dedicated two-field record per relationship (rather than a generic
  `AddAssociationRequest<TParent, TChild>`) keeps the schema and binding errors named after the real
  domain terms, the §9 readability win the codebase prefers over deduplication.
- **Where it's used**: `[FromBody]` on [`EventSpeakersController`](#eventspeakerscontroller)'s
  `CreateAsync` (`EventSpeakersController.cs:164-165`), gated class-level by
  `[HasPermission(ConferencePermissions.EventsManage)]` (`EventSpeakersController.cs:46`) and marked
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) (`:163`). A successful add evicts
  three output-cache tags, `conference:events`, `conference:speakers`, and `conference` (`:177`). It is
  the template the other join records ([`AddSessionSpeakerRequest`](#addsessionspeakerrequest),
  [`AddSessionCategoryItemRequest`](#addsessioncategoryitemrequest),
  [`AddSpeakerCategoryItemRequest`](#addspeakercategoryitemrequest)) repeat.

---

### AddRoomRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:30` · Level 0 · record class

- **What it is**: the richest write record in the group. A [`Room`](group-17-conference-domain.md#room)
  is a child of an [`Event`](group-17-conference-domain.md#event), so the body carries the owning
  `EventId`, an optional explicit `RoomId`, the required `Name` and `Sort`, and four optional physical
  attributes: `Capacity`, `Floor`, `Location`, `AccessibilityInfo`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:30-55`).
- **Depends on**: the `EventIdentifierType` / `RoomIdentifierType` aliases plus BCL `string?`, `int`,
  `int?`. Consumed by [`RoomsController`](#roomscontroller), which forwards it to
  [`AddRoomCommand`](group-18-conference-application.md#addroomcommand).
- **Concept**: see the request-vs-command shape under [`AddCategoryItemRequest`](#addcategoryitemrequest);
  this adds nothing structurally, only more optional fields. Worth calling out for `[Rubric §21,
  Accessibility]` (assesses whether accessibility is a first-class concern rather than a late retrofit):
  `AccessibilityInfo` (`RoomsController.cs:54`) is a modeled, persisted room attribute, so accessibility
  data is captured in the domain, not bolted on later in the UI.
- **Walkthrough**: three `required` members (`EventId`, `Name`, `Sort`) plus the optional explicit
  `RoomId` (`RoomsController.cs:36`) and four nullable physical fields (`RoomsController.cs:44-54`).
  `CreateAsync` spreads all eight fields positionally into the command
  (`RoomsController.cs:211-218`) and, on success, evicts the `conference:rooms` output-cache tag before
  returning `CreatedAtRoute` (`RoomsController.cs:225-229`).
- **Why it's built this way**: modeling capacity, floor, location, and accessibility as discrete optional
  columns (rather than a free-text blob) keeps room metadata queryable and the contract self-documenting.
- **Where it's used**: `[FromBody]` on [`RoomsController`](#roomscontroller)'s `CreateAsync`
  (`RoomsController.cs:206-207`), behind
  `[HasPermission(ConferencePermissions.RoomsManage)]` (`RoomsController.cs:91`) and marked
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) (`RoomsController.cs:205`).

---

### AddSessionCategoryItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionCategoryItemsController.cs:29` · Level 0 · record class

- **What it is**: the POST body that tags a session with a category item: two ids, `SessionId` and
  `CategoryItemId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionCategoryItemsController.cs:29-36`).
- **Depends on**: the `SessionIdentifierType` / `CategoryItemIdentifierType` aliases. Consumed by
  [`SessionCategoryItemsController`](#sessioncategoryitemscontroller), which forwards it to
  [`AddSessionCategoryItemCommand`](group-18-conference-application.md#addsessioncategoryitemcommand).
- **Concept**: a join-entity write contract, identical in shape to
  [`AddEventSpeakerRequest`](#addeventspeakerrequest) (`[Rubric §4, DDD]`, cross-aggregate references by
  id); add plus delete only, no update. The controller passes `null` for the
  [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem) id
  (`new AddSessionCategoryItemCommand(request.SessionId, null, request.CategoryItemId)`,
  `SessionCategoryItemsController.cs:170`). `[Rubric §12, Performance & Scalability]`: because a tag change
  moves both the session and the category read models, a successful write evicts three output-cache tags,
  `conference:sessions`, `conference:categories`, and `conference`
  (`SessionCategoryItemsController.cs:178`).
- **Walkthrough**: two `required { get; init; }` id properties, no methods.
- **Where it's used**: `[FromBody]` on [`SessionCategoryItemsController`](#sessioncategoryitemscontroller)'s
  `CreateAsync` (`SessionCategoryItemsController.cs:165-166`), behind
  `[HasPermission(ConferencePermissions.SessionsManage)]` (`SessionCategoryItemsController.cs:47`) and
  marked [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) (`:164`).

---

### AddSessionQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:26` · Level 0 · record class

- **What it is**: the session-scoped twin of [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest),
  the POST body for answering a feedback question against a session: `SessionId`, `QuestionId`,
  `AnswerValue`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:26-36`).
- **Depends on**: the `SessionIdentifierType` / `QuestionIdentifierType` aliases plus BCL `string`.
  Consumed by [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller), which forwards it to
  [`AddSessionQuestionAnswerCommand`](group-18-conference-application.md#addsessionquestionanswercommand).
- **Concept**: user-owned write data behind authorization, exactly as in
  [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest) (`[Rubric §11, Security]`); the record
  carries no `UserId`, the controller is gated by a plain `[Authorize]`
  (`SessionQuestionAnswersController.cs:75`), and reads are scoped per user by BR-9 through the
  `GetExportSpecification` override (`SessionQuestionAnswersController.cs:96-97`). On add the controller
  passes `null` for the
  [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer) id
  (`SessionQuestionAnswersController.cs:172`).
- **Walkthrough**: three `required { get; init; }` properties, no methods. This is the *single-answer*
  path; the whole-form path uses
  [`BatchAddSessionQuestionAnswersRequest`](#batchaddsessionquestionanswersrequest) instead.
- **Where it's used**: `[FromBody]` on [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller)'s
  `CreateAsync` (`SessionQuestionAnswersController.cs:167-168`), marked
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) (`:166`).

---

### AddSessionSpeakerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSpeakersController.cs:29` · Level 0 · record class

- **What it is**: the POST body that links a speaker to a session: `SessionId` plus `SpeakerId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSpeakersController.cs:29-36`).
- **Depends on**: the `SessionIdentifierType` / `SpeakerIdentifierType` aliases. Consumed by
  [`SessionSpeakersController`](#sessionspeakerscontroller), which forwards it to
  [`AddSessionSpeakerCommand`](group-18-conference-application.md#addsessionspeakercommand).
- **Concept**: a join-entity write contract like [`AddEventSpeakerRequest`](#addeventspeakerrequest)
  (`[Rubric §4, DDD]`); add plus delete only. The controller passes `null` for the
  [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) id
  (`new AddSessionSpeakerCommand(request.SessionId, null, request.SpeakerId)`,
  `SessionSpeakersController.cs:170`). `[Rubric §12, Performance & Scalability]`: a successful add evicts
  the `conference:sessions` and `conference` output-cache tags
  (`SessionSpeakersController.cs:180`), and the code comment above that call states why: speaker
  assignment changes the cached session detail and list reads the speaker dashboard relies on
  (`SessionSpeakersController.cs:178-179`).
- **Walkthrough**: two `required { get; init; }` id properties, no methods.
- **Where it's used**: `[FromBody]` on [`SessionSpeakersController`](#sessionspeakerscontroller)'s
  `CreateAsync` (`SessionSpeakersController.cs:165-166`), behind
  `[HasPermission(ConferencePermissions.SessionsManage)]` (`SessionSpeakersController.cs:47`) and marked
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) (`:164`).

---

### AddSpeakerCategoryItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakerCategoryItemsController.cs:29` · Level 0 · record class

- **What it is**: the POST body that tags a speaker with a category item: `SpeakerId` plus
  `CategoryItemId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakerCategoryItemsController.cs:29-36`).
- **Depends on**: the `SpeakerIdentifierType` / `CategoryItemIdentifierType` aliases. Consumed by
  [`SpeakerCategoryItemsController`](#speakercategoryitemscontroller), which forwards it to
  [`AddSpeakerCategoryItemCommand`](group-18-conference-application.md#addspeakercategoryitemcommand).
- **Concept**: a join-entity write contract like [`AddEventSpeakerRequest`](#addeventspeakerrequest)
  (`[Rubric §4, DDD]`); add plus delete only. Notable domain modeling: ADC represents speaker traits such
  as locality as a [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem) tag rather
  than as a field on [`Speaker`](group-17-conference-domain.md#speaker), so a request like this is how
  that attribute is attached. The controller passes `null` for the join id
  (`new AddSpeakerCategoryItemCommand(request.SpeakerId, null, request.CategoryItemId)`,
  `SpeakerCategoryItemsController.cs:170`) and then evicts `conference:speakers`,
  `conference:categories`, and `conference` (`SpeakerCategoryItemsController.cs:178`).
- **Walkthrough**: two `required { get; init; }` id properties, no methods.
- **Where it's used**: `[FromBody]` on [`SpeakerCategoryItemsController`](#speakercategoryitemscontroller)'s
  `CreateAsync` (`SpeakerCategoryItemsController.cs:165-166`), behind
  `[HasPermission(ConferencePermissions.SpeakersManage)]` (`SpeakerCategoryItemsController.cs:47`) and
  marked [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) (`:164`).

---

### BatchSessionQuestionAnswerItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:39` · Level 0 · record class

- **What it is**: one line item inside a batch feedback submit: the `QuestionId` being answered and the
  `AnswerValue` text
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:39-46`).
  It is [`AddSessionQuestionAnswerRequest`](#addsessionquestionanswerrequest) minus `SessionId`, because
  the session is named once on the envelope rather than repeated on every answer.
- **Depends on**: the `QuestionIdentifierType` alias plus BCL `string`. It is nested inside
  [`BatchAddSessionQuestionAnswersRequest`](#batchaddsessionquestionanswersrequest)`.Answers` and is
  projected onto its application-layer counterpart
  [`BatchSessionQuestionAnswerItem`](group-18-conference-application.md#batchsessionquestionansweritem).
- **Concept**: the *element* half of an envelope-plus-items contract. `[Rubric §9, API & Contract
  Design]` assesses whether a bulk operation is modeled as one intentional resource action rather than as
  a client-side loop. Hoisting `SessionId` out of the element and onto the envelope is what makes the
  batch a single-session operation by construction: the wire shape cannot express a form that spans two
  sessions, so the handler never has to reject one.
- **Walkthrough**: two `required { get; init; }` properties, no methods. The controller flattens the list
  with a collection expression and a `Select`,
  `[.. request.Answers.Select(a => new BatchSessionQuestionAnswerItem(a.QuestionId, a.AnswerValue))]`
  (`SessionQuestionAnswersController.cs:202`), the same one-line manual hop from wire type to application
  type that the single-answer path performs field by field.
- **Why it's built this way**: the API keeps its own element record rather than binding directly to the
  application-layer `BatchSessionQuestionAnswerItem`, so the HTTP contract and the command stay
  independently versionable, the ADR-001 manual-mapping stance applied to a nested type.
- **Where it's used**: only as the element type of
  [`BatchAddSessionQuestionAnswersRequest`](#batchaddsessionquestionanswersrequest)`.Answers`
  (`SessionQuestionAnswersController.cs:55`).

---

### UpdateCategoryItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:42` · Level 0 · record class

- **What it is**: the PUT body for editing an existing category item. It is
  [`AddCategoryItemRequest`](#addcategoryitemrequest) minus `CategoryItemId`: the owning `CategoryId`,
  the new `Name`, and the new `Sort`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:42-52`).
- **Depends on**: the same id aliases plus BCL `string`/`int`. Consumed by
  [`CategoryItemsController`](#categoryitemscontroller), which forwards it to
  [`UpdateCategoryItemCommand`](group-18-conference-application.md#updatecategoryitemcommand).
- **Concept**: the update half of the request-vs-command shape (see
  [`AddCategoryItemRequest`](#addcategoryitemrequest)). The item id to update is not in the body, it is the
  route's `{id}`; `UpdateAsync` threads the route id into the command
  (`new UpdateCategoryItemCommand(request.CategoryId, id, request.Name, request.Sort)`,
  `CategoryItemsController.cs:161-166`). Unlike the create, this action carries **no**
  `[Idempotent]` attribute (`CategoryItemsController.cs:154-156`): a PUT that sets an item to a stated
  name and sort is naturally repeatable, so there is nothing to replay-protect.
- **Walkthrough**: three `required { get; init; }` properties. `CategoryId` is carried on update so the
  handler can re-check ownership of the parent before mutating.
- **Where it's used**: `[FromBody]` on [`CategoryItemsController`](#categoryitemscontroller)'s
  `UpdateAsync` (`CategoryItemsController.cs:156-158`); on success the action evicts
  `conference:categories` and `conference` and returns `NoContent()`
  (`CategoryItemsController.cs:174-175`).

---

### UpdateEventQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:38` · Level 0 · record class

- **What it is**: the PUT body for editing an event answer. It carries the owning `EventId` and the new
  `AnswerValue`, and deliberately drops `QuestionId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:38-45`).
- **Depends on**: the `EventIdentifierType` alias plus BCL `string`. Consumed by
  [`EventQuestionAnswersController`](#eventquestionanswerscontroller), which forwards it to
  [`UpdateEventQuestionAnswerCommand`](group-18-conference-application.md#updateeventquestionanswercommand).
- **Concept**: the update half of the answer contract (see
  [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest)). Omitting `QuestionId` encodes an
  invariant: you can re-word an answer but not re-point it at a different question (that would be a delete
  and re-add). `UpdateAsync` uses the route `{id}` as the answer id
  (`new UpdateEventQuestionAnswerCommand(request.EventId, id, request.AnswerValue)`,
  `EventQuestionAnswersController.cs:169`) and returns `NoContent()` on success
  (`EventQuestionAnswersController.cs:172-174`).
- **Walkthrough**: two `required { get; init; }` properties, no methods.
- **Where it's used**: `[FromBody]` on [`EventQuestionAnswersController`](#eventquestionanswerscontroller)'s
  `UpdateAsync` (`EventQuestionAnswersController.cs:163-165`).

---

### UpdateRoomRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:58` · Level 0 · record class

- **What it is**: the PUT body for editing a room. It is [`AddRoomRequest`](#addroomrequest) minus the
  explicit `RoomId`: the owning `EventId`, required `Name` and `Sort`, and the four optional physical
  attributes
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:58-80`).
- **Depends on**: the `EventIdentifierType` alias plus BCL `string?`, `int`, `int?`. Consumed by
  [`RoomsController`](#roomscontroller), which forwards it to
  [`UpdateRoomCommand`](group-18-conference-application.md#updateroomcommand).
- **Concept**: the update half of the room contract (see [`AddRoomRequest`](#addroomrequest)); the room
  id comes from the route `{id}`. `UpdateAsync` spreads the seven body fields plus the route id into the
  command (`RoomsController.cs:239-248`), then evicts the `conference:rooms` tag before returning
  `NoContent()` (`RoomsController.cs:254-255`).
- **Walkthrough**: three `required` members plus four nullable optionals, no methods. Because every
  optional field is sent on every PUT, an omitted `Capacity` or `Floor` clears the stored value rather
  than leaving it untouched: this is a full replacement contract, not a patch.
- **Where it's used**: `[FromBody]` on [`RoomsController`](#roomscontroller)'s `UpdateAsync`
  (`RoomsController.cs:234-236`).

---

### UpdateSessionQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:59` · Level 0 · record class

- **What it is**: the session-scoped twin of
  [`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest): the PUT body carrying the
  owning `SessionId` and the new `AnswerValue`, dropping `QuestionId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:59-66`).
- **Depends on**: the `SessionIdentifierType` alias plus BCL `string`. Consumed by
  [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller), which forwards it to
  [`UpdateSessionQuestionAnswerCommand`](group-18-conference-application.md#updatesessionquestionanswercommand).
- **Concept**: identical to [`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest); the
  answer id is the route `{id}`
  (`new UpdateSessionQuestionAnswerCommand(request.SessionId, id, request.AnswerValue)`,
  `SessionQuestionAnswersController.cs:219`).
- **Walkthrough**: two `required { get; init; }` properties, no methods.
- **Where it's used**: `[FromBody]` on [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller)'s
  `UpdateAsync` (`SessionQuestionAnswersController.cs:213-215`).

---

### BatchAddSessionQuestionAnswersRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:49` · Level 1 · record class

- **What it is**: the POST body for `/SessionQuestionAnswers/batch`, the endpoint that submits a whole
  session feedback form in one call. It is an envelope: the `SessionId` being answered plus an
  `IReadOnlyList<BatchSessionQuestionAnswerItemRequest> Answers`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:49-56`).
- **Depends on**: [`BatchSessionQuestionAnswerItemRequest`](#batchsessionquestionansweritemrequest) as its
  element type (`:55`), the `SessionIdentifierType` alias, and BCL `IReadOnlyList<T>`. Consumed by
  [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller), which projects it onto
  [`BatchAddSessionQuestionAnswersCommand`](group-18-conference-application.md#batchaddsessionquestionanswerscommand).
  This is the one Level 1 record in the group: it is the only request type here that composes another
  first-party request type.
- **Concept introduced, the atomic bulk write at the HTTP edge.** `[Rubric §9, API & Contract Design]`
  and `[Rubric §8, Data Architecture]` (transactional boundaries that match what the client is allowed to
  observe). A feedback form is many answers that the user perceives as one submit, so the API models it as
  one request rather than N. The atomicity is not enforced in the controller: the command it maps to is
  marked `ITransactional`, so the CQRS pipeline's transactional decorator wraps the whole handler and a
  refusal leaves nothing written
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/BatchAddSessionQuestionAnswers/BatchAddSessionQuestionAnswersCommand.cs:22-24`).
  The same command is `ICacheInvalidating` with a `Session`-scoped `CachePrefix` (`:27`), so cache
  invalidation is declarative here rather than a hand-written `EvictTagsAsync` call as in the room and
  join controllers. `[Rubric §6, CQRS & Event-Driven]`: the controller does no looping and no
  orchestration, it constructs one command and dispatches it once
  (`SessionQuestionAnswersController.cs:200-204`).
- **Walkthrough**
  - Two `required { get; init; }` members: `SessionId` (`:52`) and `Answers` (`:55`), whose doc comment
    states the shape rule directly, "at most one per question".
  - `CreateBatchAsync` (`SessionQuestionAnswersController.cs:194`) is `[HttpPost("batch")]` (`:192`) and
    [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) (`:193`), so a retried form
    submit replays the first response rather than re-applying the form. It guards with
    `ArgumentNullException.ThrowIfNull(request)` (`:198`), flattens the items (`:200-202`), dispatches
    (`:204`), and returns `Ok(result.Value)` with the list of created DTOs, or `HandleFailure`
    (`:206-208`). Note the create returns `200 Ok` with the collection rather than a `201 CreatedAtRoute`:
    a batch has no single resource URI to point at.
  - The shape rules the doc comment promises are enforced one layer down by
    `BatchAddSessionQuestionAnswersCommandValidator`: at least one answer, one answer per question so the
    upsert "cannot fight itself", and a non-empty `AnswerValue` for each item
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/BatchAddSessionQuestionAnswers/BatchAddSessionQuestionAnswersCommandValidator.cs:14-26`).
    `[Rubric §24, Forms/Validation/UX Safety]`: the duplicate-question rule is a *request-level* rule that
    no per-item validator could express, which is why it lives on the collection property.
- **Why it's built this way**: the controller's own doc comment is the design record: the form is applied
  atomically under one transaction "so a refusal leaves nothing written and the client has no partially
  saved state to reconcile" (`SessionQuestionAnswersController.cs:183-186`). The alternative, letting the
  UI POST each answer separately, would leave a half-saved form behind on any mid-flight failure and would
  cost one round trip per question.
- **Where it's used**: `[FromBody]` on `CreateBatchAsync` only
  (`SessionQuestionAnswersController.cs:195`); consumed by the attendee session-feedback form.
- **Caveats / not-in-source**: this controller has no `IOutputCacheStore` injection and no
  `EvictTagsAsync` call anywhere, so whether the batch invalidates the ASP.NET Core *output* cache (as
  opposed to the application cache reached through `ICacheInvalidating`) is not determinable from this
  file.

---

### ServiceInfoController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:20` · Level 2 · class (sealed)

- **What it is**: an anonymous, read-only service and version discovery controller whose single
  `/ServiceInfo` route is served by **two** API versions, selected via the `api-version` header. The ADC
  file is almost empty: it is a thin sealed subclass of the shared
  [`ServiceInfoControllerBase`](group-12-api-hosting-mapping.md#serviceinfocontrollerbase) that overrides
  exactly one member, `ServiceName => "Conference"`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:23`).
  All of the version-discovery behavior lives in the base. The whole file is 24 lines.
- **Depends on**: [`ServiceInfoControllerBase`](group-12-api-hosting-mapping.md#serviceinfocontrollerbase)
  (MMCA.Common.API); `Asp.Versioning` (`[ApiVersion]`); `Microsoft.AspNetCore.Authorization`
  (`[AllowAnonymous]`). It does **not** declare the two discovery actions (`GetV1`/`GetV2`) or the two
  response payloads (`ServiceInfoResponse` / `ServiceInfoV2Response`): those are inherited from the base
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:39-58`) and
  taught in [G12](group-12-api-hosting-mapping.md).
- **Concept introduced, multi-version routing declared on the leaf subclass.** `[Rubric §9, API &
  Contract Design]` assesses a real versioning strategy rather than a single frozen version. Two
  `[ApiVersion]` attributes on this class declare the route's versions, `1.0` with `Deprecated = true`
  and `2.0` (`ServiceInfoController.cs:18-19`); the base's `[MapToApiVersion]`-tagged `GetV1()`/`GetV2()`
  actions then serve the minimal versus evolved shape for each
  (`ServiceInfoControllerBase.cs:39-48`). This is the only Conference controller that serves more than one
  version: every other one carries a single `[ApiVersion("1.0")]`. `[Rubric §1, SOLID]` and
  `[Rubric §16, Maintainability]`: the discovery *behavior* is written once in the Common base, and each
  service's subclass supplies only its name plus the class-level attributes, which the base's own remarks
  note are not reliably inherited and so must be repeated on the leaf
  (`ServiceInfoControllerBase.cs:15-29`, whose `<code>` block quotes this exact Conference subclass as the
  worked example).
- **Walkthrough**
  - The five class-level attributes at `ServiceInfoController.cs:15-19` (`[ApiController]`,
    `[Route("[controller]")]`, `[AllowAnonymous]`, `[ApiVersion("1.0", Deprecated = true)]`,
    `[ApiVersion("2.0")]`) supply routing, anonymity, and versioning to the leaf, because attribute
    inheritance is not reliable here.
  - The entire body is one expression-bodied override: `protected override string ServiceName =>
    "Conference"` (`ServiceInfoController.cs:23`). The advertised supported and deprecated version lists
    (`["1.0", "2.0"]` and `["1.0"]`) live on the base as `private static readonly string[]` fields
    (`ServiceInfoControllerBase.cs:32-33`), so this class never restates them.
- **Why it's built this way**: hoisting the discovery actions and payloads into a shared base and giving
  each service a one-line subclass keeps every service's `/ServiceInfo` identical and keeps the versioning
  feature exercised and testable: a contract-snapshot test against `/openapi/v1.json` can confirm both
  versions are present, so the capability cannot silently rot. It stays anonymous and side-effect free.
- **Where it's used**: mounted by the Conference service's controller registration; reached directly on
  the service host, not through the YARP Gateway (the base's own summary records that gateways do not
  route this path, `ServiceInfoControllerBase.cs:13`). Primarily a target for the integration-tier
  versioning and contract tests rather than for the UI.
- **Caveats / not-in-source**: the `ReportApiVersions = true` behavior that adds the
  `api-supported-versions` / `api-deprecated-versions` response headers is configured in
  `AddCommonApiVersioning` (MMCA.Common.API, a different group), not here
  (`ServiceInfoControllerBase.cs:10-12` documents the dependency); this controller only declares the two
  versions and its service name.

---

### SessionSelectionController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSelectionController.cs:30` · Level 5 · class (sealed partial)

- **What it is**: a **decision-support** controller for choosing which submitted sessions to accept,
  gated class-level by
  [`[HasPermission(ConferencePermissions.SessionSelectionManage)]`](group-08-auth.md#haspermissionattribute)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSelectionController.cs:29`),
  a capability the content-curation subset deliberately excludes (`SessionSelectionManage` is in
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions)`.All` but absent from its
  `ContentManagement` subset, so a content-editor role granted `ContentManagement` cannot reach it:
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:30, 39-50, 57-64`;
  the concrete role-to-permission grants live in the module's registration, not in this file). It exposes
  four read endpoints (composite dashboard, category distribution, speaker overlap, content similarity)
  plus one endpoint that **queues** AI scoring of an event's sessions for a hosted background worker.
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (for the
  `HandleFailure` Result-to-Problem-Details mapping, `SessionSelectionController.cs:37`); the
  [`HasPermission`](group-08-auth.md#haspermissionattribute) attribute plus the
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) catalog; four
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  injections (`SessionSelectionController.cs:31-34`);
  [`ISessionScoringQueue`](group-18-conference-application.md#isessionscoringqueue) (`:35`);
  [`Result`](group-01-result-error-handling.md#result) and
  [`Error`](group-01-result-error-handling.md#error); the decision-support DTOs
  ([`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto),
  [`CategoryDistributionDTO`](group-17-conference-domain.md#categorydistributiondto),
  [`SpeakerSessionOverlapDTO`](group-17-conference-domain.md#speakersessionoverlapdto),
  [`ContentSimilarityDTO`](group-17-conference-domain.md#contentsimilaritydto)); the
  [`NonIdempotentAttribute`](group-12-api-hosting-mapping.md#nonidempotentattribute); BCL `ILogger` and
  ASP.NET Core `[OutputCache]`.
- **Concept introduced, handing long work to a queue instead of the request thread.** `[Rubric §9, API &
  Contract Design]` (a focused, capability-scoped surface that answers with honest status codes) and
  `[Rubric §29, Resilience & Business Continuity]`. `ScoreSessions`
  (`SessionSelectionController.cs:110`) is **synchronous and non-async**: it calls
  `sessionScoringQueue.TryEnqueue(eventId)` and switches on the returned
  [`SessionScoringEnqueueResult`](group-18-conference-application.md#sessionscoringenqueueresult)
  (`:112-130`). `Queued` logs and returns `Accepted()` (202); `AlreadyPending` and `QueueFull` each build
  an `Error.Conflict(...)` and hand it to `HandleFailure`, which maps `ErrorType.Conflict` to **409**
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:25`) inside an RFC 9457
  Problem Details body
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:35-55`). Both outcomes
  are declared to OpenAPI with `[ProducesResponseType]` (`:108-109`).
  `[Rubric §31, Cost/FinOps]` assesses whether spend is bounded by design rather than by hope: the
  controller's own remarks record that each pass issues one paid Anthropic call per session, so a second
  concurrent pass would double the spend while racing the first one's writes (`:101-105`). The queue
  enforces that: it deduplicates by event and keeps the entry until the run *finishes*, so the dedup window
  covers execution, not just the wait
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/SessionScoringQueue.cs:51-55, 66-69`),
  and it is a bounded channel of capacity 16 with `SingleReader` so runs execute one at a time
  (`SessionScoringQueue.cs:38, 43-49`). `[Rubric §13, Observability & Operability]` (structured,
  source-generated logging): the class is `partial` and declares one `[LoggerMessage]` method,
  `LogScoringQueued` (`SessionSelectionController.cs:133-134`), a compile-time generated,
  allocation-light log call. `[Rubric §12, Performance & Scalability]`: all four read endpoints carry
  `[OutputCache(PolicyName = "ConferenceCache")]` (`:41, 55, 69, 83`).
- **Concept, opting *out* of idempotency with a written reason.** `[Rubric §10, Cross-Cutting]`. Every
  other hand-written POST in this group is marked `[Idempotent]`; `ScoreSessions` is marked
  [`[NonIdempotent]`](group-12-api-hosting-mapping.md#nonidempotentattribute) instead, and the attribute
  takes a mandatory justification string that is spelled out inline
  (`SessionSelectionController.cs:107`): the enqueue is already deduplicated by the queue's own pending
  set, so replaying a cached 202 would report acceptance for a request the queue never saw, hiding both
  the already-running refusal and a queue-full rejection the caller has to act on. The opt-out is a
  declared, reviewable decision in the source rather than a silently missing attribute.
- **Walkthrough**
  - Primary-constructor injection of the four query handlers, the scoring queue, and the logger
    (`SessionSelectionController.cs:30-36`); the base is
    [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (`:37`).
  - Each read action follows the same shape: dispatch the query, then
    `result.IsFailure ? HandleFailure(result.Errors) : Ok(result.Value)`. `GetDashboardAsync` (`:42`),
    `GetCategoryDistributionAsync` (`:56`), `GetSpeakerOverlapAsync` (`:70`), and
    `GetContentSimilarityAsync` (`:84`, which takes a `minimumSimilarity = 0.3` threshold query
    parameter, `:86`).
  - `ScoreSessions` (`:110`) is the only write. It returns `ActionResult`, not `Task<ActionResult>`:
    enqueueing is a synchronous in-memory operation, so there is nothing to await at the edge.
- **Why it's built this way**: an earlier revision started the scoring run as a fire-and-forget task from
  the controller. The queue interface's own doc comments are the design record for why that was replaced
  (`ISessionScoringQueue.cs:19-24`): nothing tracked the task, so a deploy or scale-in killed it mid-run
  with no record; nothing deduplicated it, so two clicks meant two concurrent passes; and it ignored the
  host lifetime, so shutdown could neither wait for it nor cancel it. Refusing a duplicate with 409 rather
  than silently coalescing it means the caller learns the run is already in flight
  (`ISessionScoringQueue.cs:26-29`).
- **Where it's used**: mounted by the Conference service's controller registration and consumed by the
  organizer session-selection UI page. The queued work is drained by the hosted worker that reads
  `SessionScoringQueue.Reader` (`SessionScoringQueue.cs:57-58`) and executes
  [`ScoreEventSessionsCommand`](group-18-conference-application.md#scoreeventsessionscommand)
  (Conference Application group).
- **Caveats / not-in-source**: the queue is explicitly in-process and best-effort. Its own remarks state
  that a crash between a failure and the requeue loses the retry, and that this is the intended floor
  because an organizer can trigger the run again
  (`SessionScoringQueue.cs:9-14`). Durability of a queued run across a host restart is therefore not
  provided (it is not an outbox-backed job). This controller does no output-cache eviction of its own, so
  when a scoring pass finishes, whether the `ConferenceCache` entries above are refreshed is not
  determinable from this file.

### CategoryItemsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:63` · Level 8 · class (sealed)

- **What it is**: the REST controller for conference category items. Reads are public (anonymous per
  BR-43); writes (add, update, remove) require the categories capability, gated class-level by
  `[HasPermission(ConferencePermissions.CategoriesManage)]`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:62`).
  A [`CategoryItem`](group-17-conference-domain.md#categoryitem) is a child of a
  [`Category`](group-17-conference-domain.md#category), exposed at a top-level route for convenient
  querying (`CategoryItemsController.cs:54-58`).
- **Depends on**:
  [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  closed over `CategoryItem`, [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto) and
  `CategoryItemIdentifierType` (the read-only Common base it extends, `CategoryItemsController.cs:70`); the
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  for reads (`:64`); three
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  injections for [`AddCategoryItemCommand`](group-18-conference-application.md#addcategoryitemcommand),
  [`UpdateCategoryItemCommand`](group-18-conference-application.md#updatecategoryitemcommand) and
  [`RemoveCategoryItemCommand`](group-18-conference-application.md#removecategoryitemcommand) (`:65-67`);
  ASP.NET Core's `IOutputCacheStore` (`:68`); the
  [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) plus
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions); the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute) on its create; its two
  request records [`AddCategoryItemRequest`](#addcategoryitemrequest) and
  [`UpdateCategoryItemRequest`](#updatecategoryitemrequest); the read result types
  [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) and
  [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype); the
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder); BCL `ILogger`.
- **Concept introduced, the child-entity controller over the read-only base.** `[Rubric §9, API &
  Contract Design]` assesses whether a resource surface is uniform and honest about what it owns;
  `[Rubric §5, Vertical Slice]` and `[Rubric §6, CQRS & Event-Driven]` assess whether one HTTP action maps
  to one use case. A *child* of an aggregate cannot use the generic aggregate-root create and delete
  (neither can supply the child's parent id), so this class derives from the **read-only**
  [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype),
  which already supplies `GET`, `GET /paged`, `GET /lookup`, `GET /{id}` and `GET /export`, then
  hand-writes its own `POST`, `PUT` and `DELETE` whose commands carry the owning `CategoryId`. Each read is
  `override`n only to re-decorate the action with `[AllowAnonymous]` and a cache policy before delegating
  straight back (`=> base.GetAllAsync(...)`, `:80`): the attributes have to sit on the derived method for
  MVC to see them, which is the whole reason these bodies exist. Each write maps its request record onto
  exactly one command and folds any failure through the inherited `HandleFailure`, the one-handler-per-action
  shape of CQRS at the edge. `[Rubric §1, SOLID]` and `[Rubric §16, Maintainability]`: because the read
  machinery is written once in Common, the concrete controller is small and has almost no reason to change.
- **Walkthrough**
  - Primary-constructor injection (`CategoryItemsController.cs:63-69`): the query service, the three
    command handlers (`AddCategoryItemCommand -> Result<CategoryItemDTO>`, `UpdateCategoryItemCommand ->
    Result`, `RemoveCategoryItemCommand -> Result`), the output-cache store and the logger; the base call
    passes the query service and logger to `EntityControllerBase` (`:70`).
  - The four read overrides (`:72-119`) each add `[AllowAnonymous]` (re-opening the class-level capability
    gate for reads) and `[OutputCache(PolicyName = "CategoriesCache")]`, then forward to the base:
    `GetAllAsync` (`:75-80`), the paged `GetAllAsync` with the
    `[ModelBinder(typeof(QueryFilterModelBinder))]` filter dictionary (`:85-95`), `GetAllForLookupAsync`
    (`:100-103`) and `GetByIdAsync` under the named route `"GetCategoryItemById"` (`:105-119`).
  - `CreateAsync` (`:130`): `[HttpPost]` (`:128`) and `[Idempotent]` (`:129`), binds
    `[FromBody] AddCategoryItemRequest`, dispatches
    `new AddCategoryItemCommand(request.CategoryId, request.CategoryItemId, request.Name, request.Sort)`
    (`:135-139`); on failure `HandleFailure` (`:142-145`), otherwise it evicts and returns
    `CreatedAtRoute("GetCategoryItemById", new { id = result.Value!.Id }, result.Value)` (`:148-151`). The
    doc comment records why the replay contract is declared here rather than inherited: this create is
    hand-written, not the base action (`:121-127`).
  - `UpdateAsync` (`:156`): `[HttpPut("{id}")]` (`:155`), binds the route `id` and
    `[FromBody] UpdateCategoryItemRequest`, dispatches
    `new UpdateCategoryItemCommand(request.CategoryId, id, request.Name, request.Sort)` (`:162-166`),
    evicts (`:174`), then `NoContent()` (`:175`).
  - `DeleteAsync` (`:180`): `[HttpDelete("{id}")]` (`:179`), binds the route `id` and
    `[FromQuery] ConferenceCategoryIdentifierType categoryId` (`:182`), dispatches
    `new RemoveCategoryItemCommand(categoryId, id)` (`:186`), evicts (`:194`), then `NoContent()`. The
    parent id travels on the query string because a child delete needs its parent for ownership
    re-validation in the handler.
  - All three mutations end with `outputCacheStore.EvictTagsAsync(cancellationToken,
    "conference:categories", "conference")` (`:147, 174, 194`), and all three return `HandleFailure`
    *before* the eviction, so a rejected command never disturbs the cache. `[Rubric §12, Performance &
    Scalability]`: without that call the cached reads would serve the pre-edit item list for the full
    5-minute policy TTL (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:225`), so an
    organizer renaming a track would not see it on the public session pages until the entry expired.
- **Why it's built this way**: the split between an aggregate-root base (create and delete built in) and
  this read-only base (writes hand-written) is exactly the "child commands carry a parent id the generic
  base cannot model" distinction the group overview draws. Reads are anonymous because the taxonomy is
  public (BR-43); writes are capability-gated (BR-41) at the class level, and `CategoriesManage` is one of
  the five permissions in the `ContentManagement` curation subset
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:57-64`),
  so a content editor can edit the taxonomy without holding event, room or question rights.
- **Where it's used**: mounted by the Conference service host and reached through the YARP Gateway route
  `/CategoryItems/{**catch-all}` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:98`); the
  organizer category-management UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/ConferenceCategory/` is the client. It
  is the archetype for the group's other child and junction controllers
  ([`RoomsController`](#roomscontroller), [`EventSpeakersController`](#eventspeakerscontroller),
  [`SessionSpeakersController`](#sessionspeakerscontroller),
  [`SessionCategoryItemsController`](#sessioncategoryitemscontroller),
  [`SpeakerCategoryItemsController`](#speakercategoryitemscontroller)), which repeat this shape with
  different entities, cache tags and permissions.
- **Caveats / not-in-source**: this controller applies no row scoping, so it overrides neither of the
  framework read hooks and does not override the inherited `/export`. That export therefore streams the
  whole item table, protected only by the class-level `CategoriesManage` capability, since the inherited
  action carries no `[AllowAnonymous]` of its own
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:206-211`).

---

### ConferenceCategoriesController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ConferenceCategoriesController.cs:35` · Level 8 · class (sealed)

- **What it is**: the REST controller for the [`Category`](group-17-conference-domain.md#category)
  aggregate root, served at the custom route `conferencecategories`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ConferenceCategoriesController.cs:32`)
  so it cannot collide with another module's `categories` route. Anonymous reads, capability-gated create,
  update and delete (`[HasPermission(ConferencePermissions.CategoriesManage)]`, `:34`). This is the first
  *aggregate-root* controller in the group, so it establishes the shape the other full-CRUD controllers
  reuse.
- **Depends on**:
  [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (the CRUD base, `ConferenceCategoriesController.cs:42-43`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:36`); a create handler keyed on
  [`ConferenceCategoryCreateRequest`](group-18-conference-application.md#conferencecategorycreaterequest)
  (`:37`); an update handler keyed on the framework's
  [`UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>`](group-05-cqrs-pipeline.md#updateentitycommandtentity-tupdaterequest-tidentifiertype)
  (`:38`); a delete handler keyed on
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  (`:39`); `IOutputCacheStore` (`:40`); the
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto); the PUT body
  [`ConferenceCategoryUpdateRequest`](group-18-conference-application.md#conferencecategoryupdaterequest)
  (`:120`); and the [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute).
- **Concept introduced, the aggregate-root controller.** `[Rubric §9, API & Contract Design]` assesses
  consistent resource CRUD: an aggregate root gets a full, uniform REST surface, and
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  supplies `GetAll`, `GetById`, `GetAllForLookup`, `Export`, `Create` and `Delete` from its constructor
  slots (query service, create handler, delete handler, logger, `:42-43`). The subclass then writes only
  policy, cache eviction, and the one action the base does not supply. Note that the create request type
  *is* the handler's command: `ConferenceCategoryCreateRequest` is passed straight into the create
  handler's [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) slot (`:37`),
  the create-from-request shape used across every Conference aggregate root.
- **Concept introduced, the required conditional write.** `[Rubric §9, API & Contract Design]` also
  assesses whether a contract expresses concurrency honestly. The base has no update action, so
  `UpdateAsync` is hand-rolled, and it carries [`SupportsIfMatch`](group-12-api-hosting-mapping.md#supportsifmatchattribute)
  (`:114`) with `[ProducesResponseType]` for 409, 412 and 428 (`:115-117`). The token is read with
  `SupportsIfMatchAttribute.RequiredToken(HttpContext)` (`:123`, declared at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Concurrency/SupportsIfMatchAttribute.cs:68`), and the
  attribute's own doc comment states the contract: a request with no `If-Match` header answers **428
  Precondition Required** and a stale token answers **412 Precondition Failed**
  ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html), doc at `:105-112`). The
  update itself is the framework's generic
  [`UpdateEntityCommand`](group-05-cqrs-pipeline.md#updateentitycommandtentity-tupdaterequest-tidentifiertype)
  closed over `Category`, the update request and the identifier type (`:126`), so a category edit needs no
  bespoke command type at all.
- **Walkthrough**
  - The four reads (`:45-92`) are `override`s that attach `[AllowAnonymous]` plus
    `[OutputCache(PolicyName = "CategoriesCache")]` and forward to the base, including the paged overload
    with the [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder) filter
    dictionary (`:66`) and `GetByIdAsync` under the named route `"GetCategoryById"` (`:78`).
  - `CreateAsync` (`:96-103`) and `DeleteAsync` (`:138-145`) are thin `override`s that call
    `base.CreateAsync` / `base.DeleteAsync` and then evict, so the base does the CQRS dispatch and the
    override adds only the cache concern. Because the base returns an `ActionResult` rather than a
    [`Result`](group-01-result-error-handling.md#result), these two evict unconditionally, including after
    a rejected command: a cheap over-eviction, and the one place the failure-before-evict ordering used
    elsewhere in this unit cannot be applied.
  - `UpdateAsync` (`:118-134`) reads the required row version (`:123`), dispatches the generic update
    command (`:125-127`), folds a failure through `HandleFailure` (`:129-130`), evicts (`:132`) and returns
    `Ok(result.Value)` (`:133`).
  - All three mutations evict only the `conference:categories` tag (`:101, 132, 143`), unlike the child
    [`CategoryItemsController`](#categoryitemscontroller), which also drops the broad `conference` tag.
- **Why it's built this way**: the base carries the boilerplate CRUD so a controller author writes only
  what is specific: the route override, the update action and cache eviction. The custom route string is
  the deliberate escape hatch from ASP.NET Core's `[controller]` convention, for the case where two modules
  would otherwise claim the same path.
- **Where it's used**: mounted by the Conference service host behind the Gateway route
  `/ConferenceCategories/{**catch-all}` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:94`);
  consumed by the category-management UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/ConferenceCategory/` and by every screen
  that offers a category picker. Its child items are managed through the sibling
  [`CategoryItemsController`](#categoryitemscontroller), which shares the same `CategoriesManage`
  permission and the same `conference:categories` cache tag.

---

### EventQuestionAnswersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:55` · Level 9 · class (sealed)

- **What it is**: the REST controller for event feedback answers (`/EventQuestionAnswers`). Unlike the
  public-catalog controllers in this group, **every** endpoint requires authentication (`[Authorize]`,
  `EventQuestionAnswersController.cs:54`), and the reads are **owner-scoped** by BR-8: organizers see every
  answer, everyone else sees only their own.
- **Depends on**:
  [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (the read-only base, `EventQuestionAnswersController.cs:62`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:56`); three
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) injections for
  [`AddEventQuestionAnswerCommand`](group-18-conference-application.md#addeventquestionanswercommand),
  [`UpdateEventQuestionAnswerCommand`](group-18-conference-application.md#updateeventquestionanswercommand)
  and [`RemoveEventQuestionAnswerCommand`](group-18-conference-application.md#removeeventquestionanswercommand)
  (`:57-59`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) and
  [`RoleNames`](group-08-auth.md#rolenames) for the scoping decision (`:60`);
  [`OwnedByUserSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ownedbyuserspecificationtentity-tidentifiertype)
  as the filter it builds; the [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute)
  on its create; the [`EventQuestionAnswerDTO`](group-17-conference-domain.md#eventquestionanswerdto); and
  its two request records [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest) and
  [`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest) (`:25-45`). Externals: ASP.NET
  Core MVC (`[ApiController]`, `[HttpGet]`, `[FromQuery]`), `Asp.Versioning`, `ILogger`.
- **Concept introduced, the framework read hook.** `[Rubric §11, Security]` assesses whether
  authorization is enforced server-side and whether results are scoped per caller rather than merely hidden
  in the UI; `[Rubric §1, SOLID]` and `[Rubric §16, Maintainability]` assess whether a rule has one home.
  The Common base exposes two hooks:
  `GetReadSpecificationAsync` (asynchronous, `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:597-599`)
  and its synchronous half `GetExportSpecification`
  (`EntityControllerBase.cs:626`), which the asynchronous one returns by default. **Every** read action
  calls the asynchronous hook once per request, before the first query: `GetAllAsync`
  (`EntityControllerBase.cs:115`), the paged overload (`:170`), `GetAllForLookupAsync` (`:378`),
  `GetByIdAsync` (`:422`) and `ExportAsync` (`:264`). This controller overrides the synchronous half,
  because the rule needs nothing awaited: `GetExportSpecification()` returns `null` when
  `currentUserService.IsInRole(RoleNames.Organizer)` and otherwise a
  `new OwnedByUserSpecification<EventQuestionAnswer, EventQuestionAnswerIdentifierType>(currentUserService.UserId!.Value)`
  (`EventQuestionAnswersController.cs:74-75`). The specification is composed into the *database query*, so
  the scoping happens in SQL, paging counts stay honest, and nothing is filtered out of an already-fetched
  page. Two consequences the base states explicitly: the specification never replaces the caller's own
  `filters` (the query service ANDs the two, so a caller can only narrow what the rule already allows,
  `EntityControllerBase.cs:580-586`), and a `GetById` the specification rejects answers **404, not 403**,
  because a "forbidden" would confirm the id exists (`EntityControllerBase.cs:587-591`). Because one
  override scopes all five actions, the read actions in this file are attribute-only passthroughs: their
  route attributes must sit on the derived method, but their bodies have nothing left to add, which is what
  the hook's own doc comment says it exists to remove (`EntityControllerBase.cs:571-579`, and the
  controller's own note at `:64-73`).
- **Concept introduced, closing the CSV export as a row-scoping bypass.** The base ships a streaming CSV
  endpoint, `ExportAsync` (`EntityControllerBase.cs:251`), whose remarks state the hazard plainly: it
  carries no authorization attributes of its own and inherits whatever the concrete controller declares
  (`:205-211`), and its rows are whatever the read hook allows, which is `null` by default (`:229-235`).
  A controller that row-scopes its lists but leaves both hooks at the default therefore hands every caller
  the whole table in one request (`:614-619`). This controller closes that twice over: the hook override
  above now scopes the export exactly like the list, and `ExportAsync` is additionally overridden to
  `Forbid()` unless the caller is an organizer, then delegate to the base
  (`EventQuestionAnswersController.cs:120-134`, gate at `:128-131`). `[Rubric §30,
  Compliance/Privacy/Data Governance]` assesses whether personal data has a single governed exit path:
  feedback answers are attributable personal content, so bulk download stays with the role that already
  reads every row.
- **Walkthrough**
  - Primary-constructor injection (`EventQuestionAnswersController.cs:55-61`): query service, three
    command handlers, `ICurrentUserService`, logger. The base is constructed with `(queryService, logger)`
    (`:62`).
  - `GetExportSpecification()` (`:74-75`): the organizer-or-own branch described above, with the doc
    comment at `:64-73`.
  - The four reads (`:77-111`) are pure passthroughs: `GetAllAsync` (`:78-83`), the paged overload with the
    [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder) filter dictionary
    (`:86-96`), `GetAllForLookupAsync` (`:99-102`) and `GetByIdAsync` under the named route
    `"GetEventQuestionAnswerById"` (`:104-111`). Note the absence of any `[OutputCache]` attribute anywhere
    in the file: a per-caller response must never land in a shared cache entry, and the controller simply
    never opts in.
  - `ExportAsync` (`:120-134`): the organizer gate, `Forbid()` at `:130`, otherwise `base.ExportAsync(...)`
    at `:133`. Its doc comment carries the reasoning (`:113-118`).
  - `CreateAsync` (`:145`) carries `[HttpPost]` (`:143`) and `[Idempotent]` (`:144`), so a retried POST with
    the same `Idempotency-Key` replays the stored response instead of writing a second answer row; the doc
    comment records that the attribute is declared here because this create is hand-written rather than the
    base action (`:136-142`). It dispatches
    `new AddEventQuestionAnswerCommand(request.EventId, null, request.QuestionId, request.AnswerValue)`
    (`:150`), the `null` being the child id the domain mints, then `CreatedAtRoute` (`:155-158`).
  - `UpdateAsync` (`:163`) dispatches
    `new UpdateEventQuestionAnswerCommand(request.EventId, id, request.AnswerValue)` (`:169`) and returns
    `NoContent()` (`:174`).
  - `DeleteAsync` (`:179`) takes the parent `eventId` `[FromQuery]` (`:181`) because the route only carries
    the child id, dispatches `RemoveEventQuestionAnswerCommand(eventId, id)` (`:185`) and returns
    `NoContent()`. `[Rubric §9, API & Contract Design]`: none of the three write records carries a
    `UserId` (`:25-45`); identity comes from the authenticated principal and `CreatedBy` is stamped by the
    audit pipeline, never trusted from the client.
- **Why it's built this way**: BR-8 mandates that non-organizers see only their own answers, so the rule
  is expressed once as a specification injected into the query pipeline rather than as a filter applied
  after the fact. Organizers bypass it through the null branch, which is the shape every visibility rule in
  this group uses. The parent `EventId` travels on every write so the handler can load the
  [`Event`](group-17-conference-domain.md#event) aggregate and mutate the child through it.
- **Where it's used**: hosted by the Conference service and reached through the YARP Gateway route
  `/EventQuestionAnswers/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:118`,
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)); the attendee
  feedback UI under `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/` is the
  client. [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller) is its exact
  session-scoped sibling (BR-9), built the same way.
- **Caveats / not-in-source**: the role gate on the export is now belt-and-braces rather than the only
  scoping, since the hook filters the export too. The base's remarks state that a controller which
  overrides the hook may relax such an interim role gate so an owner can export their own rows again
  (`EntityControllerBase.cs:620-624`); this controller keeps the gate, so an attendee cannot export their
  own answers at all. Whether that is deliberate is not determinable from source.

---

### EventSpeakersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventSpeakersController.cs:47` · Level 9 · class (sealed)

- **What it is**: the REST controller for the many-to-many link between an event and a speaker
  (`/EventSpeakers`). It exposes anonymous read endpoints and capability-gated add/remove endpoints.
  Because an [`EventSpeaker`](group-17-conference-domain.md#eventspeaker) is a *child* of the
  [`Event`](group-17-conference-domain.md#event) aggregate, this controller reads the child directly but
  mutates it only through the parent aggregate's commands. It is the reference implementation of the
  junction controller shape that three more controllers in this unit share.
- **Depends on**:
  [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (the read-only base, `EventSpeakersController.cs:55`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:48`); two [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`AddEventSpeakerCommand`](group-18-conference-application.md#addeventspeakercommand) and
  [`RemoveEventSpeakerCommand`](group-18-conference-application.md#removeeventspeakercommand) (`:49-50`);
  an [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicEventSpeakerFilterQuery`](group-18-conference-application.md#getpubliceventspeakerfilterquery)
  returning a [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype)
  (`:51`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) plus the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) read-audience helper (`:52, 58`);
  `IOutputCacheStore` (`:53`); the [`EventSpeakerDTO`](group-17-conference-domain.md#eventspeakerdto); the
  [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) with the
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) catalog; the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute); and its request record
  [`AddEventSpeakerRequest`](#addeventspeakerrequest) (`:29-36`).
- **Concept introduced, the junction controller and its inherited visibility.** `[Rubric §4,
  Domain-Driven Design]` assesses whether aggregate boundaries are respected: you never POST straight at a
  child row. The controller derives from the read-only
  [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  and hand-rolls its two mutations, each dispatching a command that loads the parent aggregate.
  `[Rubric §11, Security]`: the class carries `[HasPermission(ConferencePermissions.EventsManage)]`
  (`EventSpeakersController.cs:46`) so writes require the organizer capability (BR-41), while every read
  re-opens with `[AllowAnonymous]` (BR-43). The subtle half is BR-108: a junction row must not leak the
  existence of an unpublished event. This is the **asynchronous** form of the read hook taught at
  [`EventQuestionAnswersController`](#eventquestionanswerscontroller): `GetReadSpecificationAsync`
  (`:72-82`) returns `null` for a privileged reader (`IsPrivileged`, `:58`, which asks
  `currentUserService.IsPrivilegedConferenceReader()`) and otherwise awaits the
  `GetPublicEventSpeakerFilterQuery` handler, which resolves the published-event id list in the Application
  layer (`:78-81`); a failed handler result degrades to `null` rather than failing the read (`:81`). The
  hook has to be asynchronous here precisely because the rule is resolved through a query handler, which is
  the case the base's remarks describe (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:571-579`).
  `[Rubric §12, Performance & Scalability]`: the reads are cached under the `EventsCache` policy (5-minute
  TTL, tags `conference` and `conference:events`,
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:216`), which is exactly why the writes
  must evict. That policy is a
  [`PublicEndpointOutputCachePolicy`](group-12-api-hosting-mapping.md#publicendpointoutputcachepolicy)
  registration and it bypasses the cache entirely for the privileged read audience
  ([ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html),
  `Program.cs:187-214`), which is what keeps an organizer's everything-inclusive payload out of the shared
  public entry.
- **Walkthrough**
  - `GetReadSpecificationAsync` (`EventSpeakersController.cs:72-82`) is the one place the rule lives; the
    doc comment above it says so, and says the read actions below are attribute-only passthroughs (`:60-71`).
  - `GetAllAsync` (`:87-92`), the paged overload (`:97-107`), `GetAllForLookupAsync` (`:116-119`) and
    `GetByIdAsync` under the named route `"GetEventSpeakerById"` (`:121-130`) each carry
    `[AllowAnonymous]` + `[OutputCache(PolicyName = "EventsCache")]` and delegate to the base. The lookup's
    doc comment (`:109-112`) names the side channel the hook closes: without the shared scope, a dropdown
    would enumerate the names the list endpoint hides. The base forwards the specification's `Criteria`
    predicate as the lookup filter, because the lookup query has no specification parameter
    (`EntityControllerBase.cs:580-586`).
  - `ExportAsync` (`:139-153`) repeats the privileged-reader gate: `if (!IsPrivileged) return Forbid();`
    (`:147-150`), then `base.ExportAsync(...)` (`:152`). The doc comment states the leak an unscoped CSV
    would be: the junction rows of unpublished events, leaking exactly the existence the reads hide
    (`:132-137`).
  - `CreateAsync` (`:164`) is `[HttpPost]` (`:162`) and `[Idempotent]` (`:163`), dispatches
    `AddEventSpeakerCommand(request.EventId, null, request.SpeakerId)` (`:169`), returns `HandleFailure`
    on failure (`:172-175`), then evicts and returns `CreatedAtRoute("GetEventSpeakerById", ...)`
    (`:177-181`).
  - `DeleteAsync` (`:186`) reads the parent `eventId` `[FromQuery]` (`:188`), dispatches
    `RemoveEventSpeakerCommand(eventId, id)` (`:192`), evicts (`:200`) and returns `NoContent()`.
  - Both mutations evict **both** parents' tags plus the broad one:
    `EvictTagsAsync(cancellationToken, "conference:events", "conference:speakers", "conference")`
    (`:177, 200`). Note the ordering guard: the failure return happens before the eviction, so a rejected
    command never disturbs the cache.
  - Error-to-HTTP translation is inherited from
    [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase)`.HandleFailure`.
- **Why it's built this way**: a child has no independent lifecycle, so it earns free read endpoints but
  explicit, aggregate-routed mutations. The visibility filter is resolved at the controller boundary
  because that is the one place that knows the caller's audience, while the *rule* (which parents are
  public) stays in an Application-layer query handler (`[Rubric §3, Clean Architecture]`). Evicting both
  parents' tags is deliberate: the association shows up on event pages and speaker pages alike, so a
  one-tag eviction would leave one of them stale for the full TTL.
- **Where it's used**: hosted by `MMCA.ADC.Conference.Service` and reached through the Gateway route
  `/EventSpeakers/{**catch-all}` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:106`); the
  Blazor speaker-assignment screens under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Event/` are the primary client.

---

### QuestionsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/QuestionsController.cs:34` · Level 9 · class (sealed)

- **What it is**: the REST controller for the [`Question`](group-17-conference-domain.md#question)
  aggregate root (`/Questions`), the feedback-question definitions attendees answer. It is the plainest
  aggregate-root controller in the group: inherited CRUD, one hand-rolled conditional update, and cache
  eviction, with no visibility scoping at all.
- **Depends on**:
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`QuestionsController.cs:41-42`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:35`); a create handler keyed on
  [`QuestionCreateRequest`](group-18-conference-application.md#questioncreaterequest) (`:36`); an update
  handler for [`UpdateQuestionCommand`](group-18-conference-application.md#updatequestioncommand) (`:37`);
  a delete handler keyed on
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  (`:38`); `IOutputCacheStore` (`:39`); the [`QuestionDTO`](group-17-conference-domain.md#questiondto);
  [`QuestionUpdateRequest`](group-18-conference-application.md#questionupdaterequest) as the PUT body
  (`:119`); and the [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute).
- **Concept introduced**: none new. This is the aggregate-root shape taught at
  [`ConferenceCategoriesController`](#conferencecategoriescontroller), minus even the route override.
  `[Rubric §9, API & Contract Design]`: every read is a pure `override` that re-decorates the base action
  and delegates (`QuestionsController.cs:44-91`), which is what a controller looks like when it has no
  per-caller rule to apply; contrast [`EventSpeakersController`](#eventspeakerscontroller), which overrides
  the read hook so the base can scope those same actions. It is also why this class does **not** override
  `ExportAsync`: with no row scoping on the reads there is no scoping for an export to bypass, and because
  the inherited `/export` action carries no `[AllowAnonymous]` of its own it stays behind the class-level
  capability gate (the symmetry the base documents at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:205-211`).
  The one bespoke command here, `UpdateQuestionCommand`, exists because a question update is not a plain
  property patch; the conditional-write contract is the same one taught at
  [`ConferenceCategoriesController`](#conferencecategoriescontroller).
- **Walkthrough**
  - The class is gated by `[HasPermission(ConferencePermissions.QuestionsManage)]`
    (`QuestionsController.cs:33`), a capability granted to Organizer and Admin only
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:43-44`); it is
    absent from the ContentEditor subset
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:57-64`),
    so a content editor curates sessions and speakers but cannot rewrite the feedback form.
  - All four reads (`:44-91`) re-open with `[AllowAnonymous]` and attach
    `[OutputCache(PolicyName = "QuestionsCache")]` (5-minute TTL, tags `conference` and
    `conference:questions`, `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:226`), then
    delegate; `GetByIdAsync` carries the named route `"GetQuestionById"` (`:77`).
  - `CreateAsync` (`:95-102`) and `DeleteAsync` (`:137-144`) are thin overrides: call the base, then
    `EvictTagsAsync(cancellationToken, "conference:questions")` (`:100, 142`), then return the base's
    result.
  - `UpdateAsync` (`:117-133`) is the hand-rolled action: `[SupportsIfMatch]` (`:113`) with the 409/412/428
    `[ProducesResponseType]` triple (`:114-116`), `SupportsIfMatchAttribute.RequiredToken(HttpContext)`
    (`:122`), `new UpdateQuestionCommand(id, request, rowVersion)` (`:125`), `HandleFailure` on failure
    (`:128-129`), evict (`:131`), `Ok(result.Value)` (`:132`).
  - Every eviction here clears the single `conference:questions` tag; unlike the sessions and speakers
    controllers it does not also clear the broad `conference` tag, because no cross-entity read projects a
    question.
- **Why it's built this way**: questions carry no per-role visibility rule, so the controller carries
  none. It is the reference case for how little an aggregate-root controller must write when the base does
  the work: policy, one update action, and eviction.
- **Where it's used**: the Conference service host behind the Gateway route `/Questions/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:130`); the feedback-form builder UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Question/` is the main client, and the
  answers flow through [`EventQuestionAnswersController`](#eventquestionanswerscontroller) and
  [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller).

---

### RoomsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:92` · Level 9 · class (sealed)

- **What it is**: the REST controller for conference [`Room`](group-17-conference-domain.md#room)s
  (`/Rooms`). Rooms are child entities of an [`Event`](group-17-conference-domain.md#event) but are exposed
  at a top-level route for convenient querying (`RoomsController.cs:82-87`). It is a child-collection
  controller like [`EventSpeakersController`](#eventspeakerscontroller), with the same BR-108 parent
  visibility rule on its reads, but a fuller add / update / remove surface because a room has real editable
  content rather than just an association.
- **Depends on**:
  [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (`RoomsController.cs:101`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:93`); three [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`AddRoomCommand`](group-18-conference-application.md#addroomcommand),
  [`UpdateRoomCommand`](group-18-conference-application.md#updateroomcommand) and
  [`RemoveRoomCommand`](group-18-conference-application.md#removeroomcommand) (`:94-96`); an
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicRoomFilterQuery`](group-18-conference-application.md#getpublicroomfilterquery) (`:97`);
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) with the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) read-audience helper (`:98, 104`);
  `IOutputCacheStore` (`:99`); the [`RoomDTO`](group-17-conference-domain.md#roomdto); the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute); and its two request records
  [`AddRoomRequest`](#addroomrequest) and [`UpdateRoomRequest`](#updateroomrequest) (`:30-80`), which carry
  the room's name, sort order and optional capacity / floor / location / accessibility fields.
- **Concept introduced, scoping by a parent's real foreign key.** `[Rubric §11, Security]` and `[Rubric
  §9, API & Contract Design]`: BR-108 hides an unpublished event's venue layout, and `Room` carries a real
  `EventId` column, so the controller does not have to intercept anything from the filter dictionary.
  `GetReadSpecificationAsync` (`RoomsController.cs:120-130`) returns `null` for a privileged reader
  (`IsPrivileged`, `:104`) and otherwise the specification resolved by the `GetPublicRoomFilterQuery`
  handler; a failed handler result degrades to `null` rather than failing the read (`:129`). Because the
  caller's own `EventId` filter goes through the generic filter pipeline unchanged, the two predicates are
  **composed** by the query service rather than substituted, so scoping to an unpublished event returns an
  empty page instead of that event's rooms. The doc comments at `:106-118` and `:146-151` state exactly
  that contract. Compare [`SpeakersController`](#speakerscontroller), where `EventId` is *not* a column and
  the paged action must intercept the key by hand.
- **Concept introduced, output-cache eviction on mutation.** `[Rubric §12, Performance & Scalability]`
  assesses caching strategy: every read here is decorated `[OutputCache(PolicyName = "RoomsCache")]`
  (`RoomsController.cs:138, 154, 175, 188`), so anonymous room reads are served from a 5-minute entry
  tagged `conference` and `conference:rooms`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:224`). The correctness half is
  eviction: each mutation ends by calling
  `outputCacheStore.EvictTagsAsync(cancellationToken, "conference:rooms")` (`:225, 254, 272`),
  invalidating exactly the room reads and nothing else. `[Rubric §3, Clean Architecture]`: the eviction
  lives in the controller, not the command handler, because `IOutputCacheStore` is an ASP.NET concern the
  Application layer must not reference.
- **Walkthrough**
  - The class gate is `[HasPermission(ConferencePermissions.RoomsManage)]` (`RoomsController.cs:91`), a
    room-specific capability rather than the event one even though rooms hang off the event aggregate;
    each read re-opens with `[AllowAnonymous]`.
  - `GetAllAsync` (`:139-144`), the paged overload (`:155-165`), `GetAllForLookupAsync` (`:176-179`) and
    `GetByIdAsync` under the named route `"GetRoomById"` (`:189-195`) are attribute-only passthroughs; the
    hook scopes all four. The doc comments carry the rules the code no longer restates per action: the
    paged one on AND composition (`:146-151`), the lookup on the closed side channel (`:167-172`), and
    `GetById` on the 404 answer, "not a redacted record, so a guessed id cannot confirm that an unannounced
    event exists or that a venue has been booked for it" (`:181-185`).
  - `CreateAsync` (`:206`) is `[HttpPost]` (`:204`) and `[Idempotent]` (`:205`), maps `AddRoomRequest` onto
    `AddRoomCommand` positionally (`:211-219`, note the optional client-supplied `RoomId` in slot two),
    returns `HandleFailure` on failure (`:222-223`), evicts (`:225`) and returns
    `CreatedAtRoute("GetRoomById", ...)` (`:226-229`).
  - `UpdateAsync` (`:234`) dispatches `UpdateRoomCommand` with the parent `EventId` from the body and the
    child id from the route (`:240-248`), evicts (`:254`) and returns `NoContent()` (`:255`).
  - `DeleteAsync` (`:260`) reads the parent `eventId` `[FromQuery]` (`:262`), dispatches
    `RemoveRoomCommand(eventId, id)` (`:266`), evicts (`:272`) and returns `NoContent()`.
  - All three mutations return `HandleFailure` *before* they evict (`:222, 251, 269`), so a failed command
    never disturbs the cache.
  - There is no `ExportAsync` override, and none is needed: the inherited action reads the same hook as the
    lists (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:264`), so
    the CSV shows exactly what the list shows, and it stays behind the class-level `RoomsManage`
    capability because it carries no `[AllowAnonymous]` of its own.
- **Why it's built this way**: rooms are read far more than they are edited (venue maps, schedule grids),
  so caching the public reads is worth the eviction bookkeeping on the rare write. Scoping the reads
  through the Application-layer filter query rather than a controller-side join keeps persistence knowledge
  out of the boundary, the same division [`EventSpeakersController`](#eventspeakerscontroller) uses.
- **Where it's used**: the Conference service host behind the Gateway route `/Rooms/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:90`); consumed by the room-management UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Room/` and by any schedule view that
  resolves a session's room.

---

### SpeakerCategoryItemsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakerCategoryItemsController.cs:48` · Level 9 · class (sealed)

- **What it is**: the REST controller for the link between a
  [`Speaker`](group-17-conference-domain.md#speaker) and a
  [`CategoryItem`](group-17-conference-domain.md#categoryitem) (`/SpeakerCategoryItems`), the association
  that tags a speaker with, for example, a locality or a track. Structurally it is a twin of
  [`EventSpeakersController`](#eventspeakerscontroller): anonymous reads that inherit the parent's
  visibility, capability-gated add and remove, no update.
- **Depends on**:
  [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (`SpeakerCategoryItemsController.cs:56`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:49`); the
  [`AddSpeakerCategoryItemCommand`](group-18-conference-application.md#addspeakercategoryitemcommand) and
  [`RemoveSpeakerCategoryItemCommand`](group-18-conference-application.md#removespeakercategoryitemcommand)
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s (`:50-51`); an
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicSpeakerCategoryItemFilterQuery`](group-18-conference-application.md#getpublicspeakercategoryitemfilterquery)
  (`:52`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) with the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) helper (`:59`); `IOutputCacheStore`
  (`:54`); the [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto); the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute); and the
  [`AddSpeakerCategoryItemRequest`](#addspeakercategoryitemrequest) record (`:29-36`).
- **Concept introduced**: none new; this is the junction controller pattern taught at
  [`EventSpeakersController`](#eventspeakerscontroller). Two differences are worth noting.
  `[Rubric §11, Security]`, first: the write permission tracks the *owning* aggregate, so the class is
  guarded by `[HasPermission(ConferencePermissions.SpeakersManage)]`
  (`SpeakerCategoryItemsController.cs:47`) rather than the `EventsManage` its event-side twin uses, and
  managing a speaker's tags requires speaker-management rights. Second, the inherited visibility rule is
  BR-239 (a junction row must not reveal a speaker the caller cannot read) rather than BR-108, resolved by
  the `GetPublicSpeakerCategoryItemFilterQuery` handler inside `GetReadSpecificationAsync` (`:73-83`), with
  `IsPrivileged` (`:59`) short-circuiting for Organizer and ContentEditor.
- **Walkthrough**: shape-for-shape the same as [`EventSpeakersController`](#eventspeakerscontroller), with
  the `SpeakersCache` policy instead of `EventsCache`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:223`). The four reads are
  `[AllowAnonymous]` + `[OutputCache(PolicyName = "SpeakersCache")]` passthroughs
  (`SpeakerCategoryItemsController.cs:85, 95, 114, 122`, the last carrying the named route
  `"GetSpeakerCategoryItemById"`), all scoped by the hook. `ExportAsync` (`[HttpGet("export")]` at `:139`)
  repeats the privileged-reader gate with `Forbid()` at `:150`. `CreateAsync` (`[HttpPost]` at `:163`,
  `[Idempotent]` at `:164`) dispatches
  `AddSpeakerCategoryItemCommand(request.SpeakerId, null, request.CategoryItemId)` (`:170`), evicts
  (`:178`) and returns `CreatedAtRoute("GetSpeakerCategoryItemById", ...)` (`:179-180`); `DeleteAsync`
  (`[HttpDelete("{id}")]` at `:186`) reads the parent `speakerId` `[FromQuery]` (`:189`), dispatches
  `RemoveSpeakerCategoryItemCommand(speakerId, id)` (`:193`), evicts (`:201`) and returns `NoContent()`
  (`:202`). Both evictions clear `conference:speakers`, `conference:categories` and `conference`
  (`:178, 201`).
- **Why it's built this way**: it shares the exact shape of the other junction controllers because the
  underlying rules (mutate the child only through its parent aggregate; never let a junction row outlive
  its parent's visibility) are identical. Only the aggregate, the DTO, the permission and the pair of cache
  tags change, which is `[Rubric §16, Maintainability]` in practice: one shape learned once, repeated
  without variation.
- **Where it's used**: the Conference service host behind the Gateway route
  `/SpeakerCategoryItems/{**catch-all}` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:122`);
  consumed by the speaker-profile editing UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/`.

---

### SpeakersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:46` · Level 9 · class (sealed)

- **What it is**: the REST controller for the [`Speaker`](group-17-conference-domain.md#speaker) aggregate
  root (`/Speakers`), and the most authorization-dense controller in the group. On top of aggregate-root
  CRUD it carries the BR-239 public-speaker projection, a virtual `EventId` filter, a self-read carve-out
  with a cache opt-out, resource-level self-edit authorization (BR-214), a capability-gated CSV export,
  user linking and unlinking (BR-209), and three cross-entity read projections (BR-210).
- **Depends on**:
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`SpeakersController.cs:61-62`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:47`); five [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`SpeakerCreateRequest`](group-18-conference-application.md#speakercreaterequest),
  [`UpdateSpeakerCommand`](group-18-conference-application.md#updatespeakercommand),
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype),
  [`LinkUserToSpeakerCommand`](group-18-conference-application.md#linkusertospeakercommand) and
  [`UnlinkUserFromSpeakerCommand`](group-18-conference-application.md#unlinkuserfromspeakercommand)
  (`:48-52`); five [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)s for
  [`GetSessionFeedbackQuery`](group-18-conference-application.md#getsessionfeedbackquery),
  [`GetSessionBookmarkCountQuery`](group-18-conference-application.md#getsessionbookmarkcountquery),
  [`GetSessionBookmarkCountsQuery`](group-18-conference-application.md#getsessionbookmarkcountsquery),
  [`GetSpeakersByEventFilterQuery`](group-18-conference-application.md#getspeakersbyeventfilterquery) and
  [`GetPublicSpeakerFilterQuery`](group-18-conference-application.md#getpublicspeakerfilterquery)
  (`:53-57`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) with
  [`RoleNames`](group-08-auth.md#rolenames) and the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) helper (`:58, 65`); `IOutputCacheStore`
  (`:59`); the [`SpeakerDTO`](group-17-conference-domain.md#speakerdto),
  [`SpeakerUpdateRequest`](group-18-conference-application.md#speakerupdaterequest),
  [`LinkUserRequest`](group-17-conference-domain.md#linkuserrequest) and
  [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto); the
  [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) and
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute); the
  [`SpecificationExtensions`](group-03-querying-specifications.md#specificationextensions) `And` composer
  that yields an
  [`AndSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#andspecificationtentity-tidentifiertype);
  and [`Error`](group-01-result-error-handling.md#error).
- **Concept introduced, per-action authorization plus row-level ownership checks.** `[Rubric §11,
  Security]`: unlike the other aggregate-root controllers (which gate the whole class with one
  `[HasPermission(...)]`), `SpeakersController` carries a bare class-level `[Authorize]`
  (`SpeakersController.cs:45`) and then varies authorization per action. The catalog reads are
  `[AllowAnonymous]`; export, create, delete, link and unlink each re-assert
  `[HasPermission(ConferencePermissions.SpeakersManage)]` (`:289, 308, 363, 375, 394`); and `UpdateAsync`
  performs a *resource-ownership* check in code, comparing the caller's `speaker_id` JWT claim with the
  route id and returning `Forbid()` when the caller is neither the speaker nor an organizer (`:343-346`,
  BR-214). That is authorization a policy attribute cannot express, because it depends on the specific row
  being edited; the organizer flag is then passed on to the handler as
  `new UpdateSpeakerCommand(id, request, CallerIsOrganizer: isOrganizer, RowVersion: rowVersion)` (`:351`)
  so the handler keeps organizer-only fields unchanged on a self-edit (the rule is written out at
  `:318-324`).
- **Concept introduced, the virtual filter key.** `[Rubric §9, API & Contract Design]`: `EventId` is not a
  `Speaker` column, so the paged action removes it from the generic filter dictionary before the pipeline
  can reject it (`:149-159`), translates it into a specification via `GetSpeakersByEventFilterQuery`
  (`:166-167`), and **ANDs** it with the public-speaker specification rather than substituting
  (`:171-174`, `publicSpecification.And(...)` at `:173`, the extension member declared at
  `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/SpecificationExtensions.cs:48`). Substituting
  would leak hidden speakers to a non-privileged caller; an unparseable value simply drops the scope
  instead of failing the request. The remarks at `:126-132` add the reason the two are not redundant: the
  event filter answers "linked to this event", the public filter answers "accepted for this event".
- **Walkthrough**
  - `IsPrivileged` (`SpeakersController.cs:65`) is the shared read-audience check;
    `BuildPublicSpeakerSpecificationAsync` (`:84-95`, doc `:70-83`) is the BR-239 projection, parameterized
    by an optional `eventId` because a speaker accepted for one event is not thereby public on another.
    Privileged readers get `null`.
  - `GetReadSpecificationAsync` (`:104-106`) is the framework hook, and it delegates to that builder with
    no event context: the list, lookup and by-id actions read their scope from here, while the paged action
    resolves its own because it carries an event id (doc `:97-103`).
  - `GetAllAsync` (`:111-116`) is a plain passthrough. The paged overload (`:136-195`) clamps `pageSize` to
    `MaxPageSize` (`:147`), performs the `EventId` interception described above, then queries with the
    composed specification (`:177-188`) and appends the `X-Pagination` header carrying the result's
    [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata) (`:193`).
  - `GetAllForLookupAsync` (`:210-240`) has two guards. Privileged readers (a `null` specification) fall
    through to the base action (`:214-216`); everyone else must name the label column from the allow-list
    `PublicLookupNameProperties` (`:68`, first or last name only) or receive an
    [`Error`](group-01-result-error-handling.md#error)`.InvalidEntityField` failure (`:218-229`). This
    closes a BR-66 side channel: `nameProperty=Email` would otherwise project the speaker email into the
    lookup label, bypassing the DTO mapper that redacts it. The check runs before the query service, so a
    rejected label is never queried; the scoped path then forwards `specification.Criteria` as the lookup
    `where` (`:231-235`) and rewraps the rows into a
    [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt) of
    [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) (`:239`).
  - `GetByIdAsync` (`:245-278`) carries the self-read carve-out: when the caller's `speaker_id` claim
    matches the route id the specification is dropped so a speaker can always load their own profile
    (`:256-266`), and because that response can contain data the public cannot see while the output-cache
    key does not vary by caller, the action turns storage off for this response via
    `HttpContext.Features.Get<IOutputCacheFeature>()?.Context.AllowCacheStorage = false` (`:265`). The
    policy only ever turns storage off, never back on, so the opt-out sticks (comment `:262-264`).
  - `ExportAsync` (`:290-304`) is the strongest form of the export gate taught at
    [`EventQuestionAnswersController`](#eventquestionanswerscontroller): a declarative
    `[HasPermission(ConferencePermissions.SpeakersManage)]` (`:289`) **plus** the imperative
    `if (!IsPrivileged) return Forbid();` (`:298-301`). The doc comment names the double bypass an unscoped
    CSV would be here, going around both the public projection and the redacting DTO mapper, emails
    included, and records that the attribute is stated explicitly because the class carries only a bare
    `[Authorize]` for the inherited action to pick up (`:280-287`). `[Rubric §30, Compliance/Privacy/Data
    Governance]`: a speaker roster is personal data, so bulk egress is a named capability rather than a
    side effect of reading the list.
  - `CreateAsync` (`:309-316`) and `DeleteAsync` (`:364-371`) call the base and evict. `UpdateAsync`
    (`:337-359`) runs the BR-214 check (`:343-346`), reads the required `If-Match` token (`:348`),
    dispatches (`:350-352`) and evicts (`:357`). `LinkUserAsync` (`:376-390`) and `UnlinkUserAsync`
    (`:395-408`) dispatch the link and unlink commands, which drive the cross-module User-to-Speaker
    association, and evict.
  - The three BR-210 projections split by sensitivity. `GetSessionFeedbackAsync` (`:418-435`) is
    `[Authorize]` (`:417`) and repeats the self-or-organizer gate of the update path (`:423-426`); it
    carries **no** `[OutputCache]` at all, because every response is authorization-dependent and a shared
    public entry could serve one speaker's free-text feedback to another caller (doc `:410-415`). The two
    count endpoints stay `[AllowAnonymous]`: `GetSessionBookmarkCountAsync` (`:442-454`) and the batched
    `GetSessionBookmarkCountsAsync` (`:462-474`) run under `BookmarkCountsCache`, a 60-second policy tagged
    `conference` and `conference:sessions`
    (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:243`). `[Rubric §7, Microservices
    Readiness]`: bookmark counts are owned by the Engagement service, in another process, whose writes have
    no handle on this host's cache store, so Engagement's bookmark handler publishes an eviction request
    over the broker that this host turns into a tag drop, and the short TTL stays as the backstop for a
    message that never lands (`Program.cs:233-243`).
  - Every mutation ends at
    `EvictTagsAsync(cancellationToken, "conference:speakers", "conference")` (`:314, 357, 369, 388, 406`).
- **Why it's built this way**: speaker profiles are edited both by organizers and by the speakers
  themselves, so the controller needs row-aware authorization that a static policy cannot provide; keeping
  that check inline mirrors the per-mutation ownership pattern used across the codebase. The virtual
  `EventId` filter gives clients an event-scoped speaker list without adding a denormalized column to the
  aggregate, and the batched counts endpoint exists to replace the speaker dashboard's per-session fan-out
  (doc `:456-458`), which is `[Rubric §12, Performance & Scalability]` applied at the contract level.
- **Where it's used**: the Conference service host behind the Gateway route `/Speakers/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:86`); consumed by the public speaker directory
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSpeakerList.razor`), the
  speaker self-service profile page, organizer linking tools, and the speaker dashboard's feedback and
  bookmark tiles.

---

### ActivitiesController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ActivitiesController.cs:39` · Level 10 · class (sealed)

- **What it is**: the REST controller for the [`Activity`](group-17-conference-domain.md#activity)
  aggregate root (`/Activities`), the conference's social and networking programme (parties, meetups,
  sponsor receptions). Anonymous reads scoped to published events, and create / update / delete / export
  behind the activities-manage capability (`ActivitiesController.cs:29-33`).
- **Depends on**:
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`ActivitiesController.cs:48-49`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:40`); three [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`ActivityCreateRequest`](group-18-conference-application.md#activitycreaterequest), the framework's
  [`UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>`](group-05-cqrs-pipeline.md#updateentitycommandtentity-tupdaterequest-tidentifiertype)
  and
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  (`:41-43`); an [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicActivityFilterQuery`](group-18-conference-application.md#getpublicactivityfilterquery)
  (`:44`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) plus the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) read-audience helper (`:45, 52`);
  `IOutputCacheStore` (`:46`); the [`ActivityDTO`](group-17-conference-domain.md#activitydto);
  [`ActivityUpdateRequest`](group-18-conference-application.md#activityupdaterequest) as the PUT body
  (`:188`); the [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) with the
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) catalog; the
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute); and the
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder).
- **Concept introduced**: none new. This controller is the exact structural twin of
  [`SponsorsController`](#sponsorscontroller): the same bare `[Authorize]` class gate with a per-mutation
  capability, the same real-`EventId`-column scoping (no filter interception), the same
  attribute-plus-imperative export gate, at the same line numbers in both files. What differs is the
  vocabulary. `[Rubric §11, Security]`: the class carries `[Authorize]` (`ActivitiesController.cs:38`) and
  each mutation re-asserts `[HasPermission(ConferencePermissions.ActivitiesManage)]` (`:143, 162, 181,
  206`), the capability declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:36`
  and included in the `ContentManagement` curation subset (`ConferencePermissions.cs:57-64`), so a content
  editor can run the social programme without holding event, room or question rights.
  `[Rubric §12, Performance & Scalability]`: reads run under the `ActivitiesCache` policy (5-minute TTL,
  tags `conference` and `conference:activities`,
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:228`) and every mutation evicts both
  tags.
- **Walkthrough**
  - `IsPrivileged` (`ActivitiesController.cs:52`) is the shared
    `currentUserService.IsPrivilegedConferenceReader()` read-audience check;
    `GetReadSpecificationAsync` (`:68-78`) returns `null` for a privileged reader and otherwise the
    [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype)
    the `GetPublicActivityFilterQuery` handler resolves (`:74-77`); a failed handler result degrades to
    `null` rather than failing the read.
  - `GetAllAsync` (`:83-88`), the paged overload (`:99-109`), `GetAllForLookupAsync` (`:114-117`) and
    `GetByIdAsync` under the named route `"GetActivityById"` (`:123-132`) are `[AllowAnonymous]` +
    `[OutputCache(PolicyName = "ActivitiesCache")]` passthroughs, all scoped from the one hook. The paged
    action's doc comment states the composition contract explicitly: `EventId` is a real column, so the
    caller's event filter travels through the generic pipeline and the published-event rule is ANDed on top
    of it rather than substituted (`:90-95`). The by-id doc comment states that an activity of an
    unpublished event is a 404, "not a redacted record, so a guessed id cannot confirm that a party has
    been scheduled" (`:119-122`).
  - `ExportAsync` (`:144-158`) pairs the declarative
    `[HasPermission(ConferencePermissions.ActivitiesManage)]` (`:143`) with the imperative
    `if (!IsPrivileged) return Forbid();` (`:152-155`), then delegates to the base (`:157`). The doc
    comment names the leak an unscoped CSV would be, a social programme that has not been announced, and
    notes that the attribute is needed because the class carries only a bare `[Authorize]` (`:134-141`).
  - `CreateAsync` (`:163-170`) and `DeleteAsync` (`:207-214`) are thin overrides that call the base and
    then evict; `UpdateAsync` (`:186-202`) is the hand-rolled action the base does not supply, reading the
    required `If-Match` token (`:191`), dispatching
    `new UpdateEntityCommand<Activity, ActivityUpdateRequest, ActivityIdentifierType>(id, request,
    rowVersion)` (`:194`), folding a failure through `HandleFailure` (`:197-198`), evicting (`:200`) and
    returning `Ok(result.Value)` (`:201`).
  - Every eviction clears `conference:activities` and the broad `conference` tag (`:168, 200, 212`), the
    latter because the activity strip renders alongside other conference reads.
- **Why it's built this way**: the social programme has the same publish-gated lifecycle as the rest of
  the catalog, so it reuses the specification hook rather than inventing an activity-specific visibility
  flag, and because `Activity` owns a real `EventId` none of that scoping needs a virtual key. Repeating
  the sponsor controller's shape verbatim is `[Rubric §16, Maintainability]` in practice: two aggregates
  with identical rules get identical code, so the reader who has learned one has learned both.
- **Where it's used**: the Conference service host behind the Gateway route `/Activities/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:138`). Clients are the public activity page
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicActivityList.razor`) and
  the organizer list, create and detail pages under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activity/`.

---

### EventsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventsController.cs:46` · Level 10 · class (sealed)

- **What it is**: the REST controller for the [`Event`](group-17-conference-domain.md#event) aggregate
  root (`/Events`), and the richest controller in the group. On top of the standard aggregate-root CRUD it
  adds visibility scoping, a gated CSV export, publish and unpublish with conditional writes, a Sessionize
  refresh with bespoke error mapping, iCalendar export, and the "happening now / up next" snapshot.
- **Depends on**:
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`EventsController.cs:59-60`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:47`); six [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`EventCreateRequest`](group-18-conference-application.md#eventcreaterequest),
  [`UpdateEventCommand`](group-18-conference-application.md#updateeventcommand),
  [`PublishEventCommand`](group-18-conference-application.md#publisheventcommand),
  [`UnpublishEventCommand`](group-18-conference-application.md#unpublisheventcommand),
  [`DeleteEntityCommand`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype) and
  [`RefreshFromSessionizeCommand`](group-18-conference-application.md#refreshfromsessionizecommand)
  (`:48-53`); two [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)s for
  [`ExportEventCalendarQuery`](group-18-conference-application.md#exporteventcalendarquery) and
  [`GetNowNextQuery`](group-18-conference-application.md#getnownextquery) (`:54-55`);
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) with the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) helper (`:56`); `IOutputCacheStore`
  (`:57`); the [`PublishedEventSpecification`](group-18-conference-application.md#publishedeventspecification);
  the [`EventDTO`](group-17-conference-domain.md#eventdto),
  [`UpdateEventResult`](group-18-conference-application.md#updateeventresult),
  [`EventUpdateRequest`](group-18-conference-application.md#eventupdaterequest),
  [`NowNextDTO`](group-17-conference-domain.md#nownextdto) and
  [`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto); the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute); and the
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute).
- **Concept introduced, business-rule visibility as a plain specification.** `[Rubric §11, Security]` and
  `[Rubric §3, Clean Architecture]`: BR-108 says non-privileged readers see only published events. The rule
  needs nothing awaited, so this controller overrides the *synchronous* hook:
  `GetExportSpecification()` returns `null` for a privileged reader
  (`currentUserService.IsPrivilegedConferenceReader()`, so a ContentEditor who reads every session can also
  read the events those sessions belong to) and a `new PublishedEventSpecification()` for everyone else
  (`EventsController.cs:74-75`, doc `:62-73`). The base then applies it to all five read actions, so the
  authorization predicate is a data specification the query service composes into SQL, not imperative
  post-filtering. The lookup doc comment (`:102-106`) names the side channel that closes: a draft event
  listed by name. `ExportAsync` (`:133-147`) adds the imperative privileged-reader `Forbid()` on top
  (`:141-144`).
- **Concept introduced, conditional writes on a state transition.** `[Rubric §9, API & Contract Design]`
  assesses whether a contract expresses concurrency honestly. `PublishAsync` and `UnpublishAsync` take no
  body at all: they read the client's last-seen row version from the `If-Match` header through
  `SupportsIfMatchAttribute.RequiredToken(HttpContext)` (`:272, 305`), so a request with no header answers
  **428 Precondition Required** and never runs, and a stale token answers **412 Precondition Failed**
  ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html); both carry
  `[SupportsIfMatch]` at `:264, 297` and declare 409/412/428 as `[ProducesResponseType]` at `:265-267,
  298-300`). Both are also `[Idempotent]` (`:263, 296`), because publishing is a state assertion and
  replaying the stored response for a retried key is exactly what the caller meant (doc `:257-260`).
  `[Rubric §29, Resilience & Business Continuity]`: `RefreshAsync` (`:328-362`) maps upstream trouble to
  retryable HTTP, an `Event.Sessionize.Throttled` error becoming `429` with a `Retry-After: 300` header
  (`:339-343`, BR-63) and `Event.Sessionize.Unavailable` becoming `502` (`:346-347`), so an upstream
  throttle reaches the client as a signal rather than a 500.
- **Walkthrough**
  - The reads (`:77-124`) attach `[AllowAnonymous]` + `[OutputCache(PolicyName = "EventsCache")]` and
    delegate to the base, which threads the published-event specification; `GetByIdAsync` carries the named
    route `"GetEventById"` (`:115`).
  - `ExportCalendarAsync` (`:156-164`) streams an `.ics` document via `File(...)` with the `text/calendar`
    content type and an `event-{id}.ics` file name (`:163`).
  - `GetNowNextAsync` (`:173-179`) and `GetCurrentNowNextAsync` (`:188-193`) serve the now/next snapshot for
    a given event or, with `new GetNowNextQuery(EventId: null)` (`:191`), for the current one; both use the
    short-TTL `NowNextCache` policy (60 seconds,
    `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:231`) because the payload changes with
    the clock. That policy is registered without the privileged-reader bypass, because the snapshot is
    identical for every role (`Program.cs:229-231`).
  - `CreateAsync` (`:202-209`) is an override marked `[Idempotent]` (`:201`), so a retried POST carrying
    the same `Idempotency-Key` is deduplicated; it calls `base.CreateAsync` then evicts. The attribute is
    single-use, so declaring it here coincides with the inherited one instead of duplicating it (doc
    `:195-199`).
  - `UpdateAsync` (`:224-248`) reads the required token (`:229`), dispatches
    `new UpdateEventCommand(id, request, rowVersion)` (`:232`), appends a non-fatal `X-Warning` header when
    a timezone change leaves existing sessions semantically stale (BR-131, `:238-244`), evicts (`:246`) and
    returns `Ok(result.Value.Event)` (`:247`).
  - `PublishAsync` (`:268-283`) and `UnpublishAsync` (`:301-316`) dispatch their transition commands with
    the row version (`:275, 308`), evict (`:281, 314`) and return `NoContent()`.
  - `RefreshAsync` triggers a Sessionize import and, because that import touches six entity types, evicts
    six tags: events, sessions, speakers, categories, rooms and questions (`:353-360`).
  - `DeleteAsync` (`:368-376`) additionally evicts `conference:sessions` and `conference:rooms` because
    soft-deleting an event cascades to its children (`:373-374`). Every other mutation evicts the single
    `conference:events` tag (`:207, 246, 281, 314`).
- **Why it's built this way**: the base still owns the plain CRUD, so all the event-specific behavior
  (scoping, export gating, publish lifecycle, external refresh, calendar and now-next projections) reads as
  a flat list of extra actions. Mapping Sessionize failures to distinct status codes here keeps that
  operational nuance at the boundary while the handler stays a pure
  [`Result`](group-01-result-error-handling.md#result) producer, and the fan-out of eviction tags is
  written where the knowledge of "what this operation touched" actually lives.
- **Where it's used**: the Conference service host behind the Gateway route `/Events/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:78`); the home-screen widget calls
  `now-next`, the public schedule UI
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicEventList.razor`) calls the
  reads and the `.ics` export, and organizer tooling under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Event/` drives publish, unpublish and
  refresh.

---

### SessionCategoryItemsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionCategoryItemsController.cs:48` · Level 10 · class (sealed)

- **What it is**: the REST controller for the link between a
  [`Session`](group-17-conference-domain.md#session) and a
  [`CategoryItem`](group-17-conference-domain.md#categoryitem) (`/SessionCategoryItems`), the association
  that tags a session with a track or topic. A junction controller identical in shape to
  [`EventSpeakersController`](#eventspeakerscontroller): anonymous reads that inherit the parent's
  visibility, capability-gated add and remove, no update.
- **Depends on**:
  [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (`SessionCategoryItemsController.cs:56`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:49`); the
  [`AddSessionCategoryItemCommand`](group-18-conference-application.md#addsessioncategoryitemcommand) and
  [`RemoveSessionCategoryItemCommand`](group-18-conference-application.md#removesessioncategoryitemcommand)
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s (`:50-51`); an
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicSessionCategoryItemFilterQuery`](group-18-conference-application.md#getpublicsessioncategoryitemfilterquery)
  (`:52`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) with the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) helper (`:59`); `IOutputCacheStore`
  (`:54`); the [`SessionCategoryItemDTO`](group-17-conference-domain.md#sessioncategoryitemdto); the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute); and the
  [`AddSessionCategoryItemRequest`](#addsessioncategoryitemrequest) record (`:29-36`).
- **Concept introduced**: none new; see the junction controller pattern at
  [`EventSpeakersController`](#eventspeakerscontroller). The class is guarded by
  `[HasPermission(ConferencePermissions.SessionsManage)]` (`SessionCategoryItemsController.cs:47`) because
  the association belongs to the session aggregate, and its inherited visibility rule is BR-49 (a junction
  row must not reveal a session the caller cannot read), resolved by `GetReadSpecificationAsync` (`:73-83`)
  with `IsPrivileged` (`:59`) short-circuiting for Organizer and ContentEditor. `[Rubric §11, Security]`:
  as with every junction controller here, the write permission follows the owning aggregate while the read
  filter follows the parent's visibility, and the CSV export repeats the privileged-reader gate so the
  scoping cannot be bypassed by asking for the file instead of the page.
- **Walkthrough**: four `[AllowAnonymous]` + `[OutputCache(PolicyName = "SessionsCache")]` read
  passthroughs (`SessionCategoryItemsController.cs:85, 95, 114, 122`, the last carrying the named route
  `"GetSessionCategoryItemById"`), all scoped by the hook. `ExportAsync` (`[HttpGet("export")]` at `:139`)
  returns `Forbid()` for a non-privileged caller (`:150`) and otherwise delegates to the base.
  `CreateAsync` (`[HttpPost]` at `:163`, `[Idempotent]` at `:164`) dispatches
  `AddSessionCategoryItemCommand(request.SessionId, null, request.CategoryItemId)` (`:170`), evicts
  (`:178`) and returns `CreatedAtRoute("GetSessionCategoryItemById", ...)` (`:179-180`); `DeleteAsync`
  (`[HttpDelete("{id}")]` at `:186`) reads the parent `sessionId` `[FromQuery]` (`:189`), dispatches
  `RemoveSessionCategoryItemCommand(sessionId, id)` (`:193`), evicts (`:201`) and returns `NoContent()`
  (`:202`). Both evictions clear `conference:sessions`, `conference:categories` and `conference`
  (`:178, 201`).
- **Why it's built this way**: same rationale as the other junction controllers: the child mutates only
  through its parent aggregate, so it gets free reads and explicit, command-routed writes; and because a
  tag on a session is visible from both the session page and the category page, both parents' cache tags
  are evicted.
- **Where it's used**: the Conference service host behind the Gateway route
  `/SessionCategoryItems/{**catch-all}` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:110`);
  consumed by the session-editing UI's tag picker and by the public schedule filters
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionListFilterBar.razor`).

---

### SessionQuestionAnswersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:76` · Level 10 · class (sealed)

- **What it is**: the REST controller for a session's answered feedback questions
  (`/SessionQuestionAnswers`). It is the session-scoped sibling of
  [`EventQuestionAnswersController`](#eventquestionanswerscontroller): every endpoint requires
  authentication and the reads are owner-scoped, so an attendee sees only their own answers and an
  organizer sees all (BR-9). It adds one endpoint its event-side twin does not have: a batch submit for a
  whole feedback form.
- **Depends on**:
  [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (`SessionQuestionAnswersController.cs:84`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:77`); four [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`AddSessionQuestionAnswerCommand`](group-18-conference-application.md#addsessionquestionanswercommand),
  [`BatchAddSessionQuestionAnswersCommand`](group-18-conference-application.md#batchaddsessionquestionanswerscommand),
  [`UpdateSessionQuestionAnswerCommand`](group-18-conference-application.md#updatesessionquestionanswercommand)
  and
  [`RemoveSessionQuestionAnswerCommand`](group-18-conference-application.md#removesessionquestionanswercommand)
  (`:78-81`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) with
  [`RoleNames`](group-08-auth.md#rolenames) for the scoping decision (`:82`);
  [`OwnedByUserSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ownedbyuserspecificationtentity-tidentifiertype);
  the [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute); the
  [`SessionQuestionAnswerDTO`](group-17-conference-domain.md#sessionquestionanswerdto); and its four
  request records [`AddSessionQuestionAnswerRequest`](#addsessionquestionanswerrequest),
  [`BatchSessionQuestionAnswerItemRequest`](#batchsessionquestionansweritemrequest),
  [`BatchAddSessionQuestionAnswersRequest`](#batchaddsessionquestionanswersrequest) and
  [`UpdateSessionQuestionAnswerRequest`](#updatesessionquestionanswerrequest) (`:26-66`).
- **Concept introduced, the atomic batch write.** Owner-scoped reads and the organizer-only export gate
  are taught at [`EventQuestionAnswersController`](#eventquestionanswerscontroller); what is new here is
  `CreateBatchAsync` (`:194-209`), a `POST /batch` that applies a whole feedback form in one call.
  `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §9, API & Contract Design]`: the action maps the request
  items onto [`BatchSessionQuestionAnswerItem`](group-18-conference-application.md#batchsessionquestionansweritem)
  values with a collection expression (`:200-202`) and dispatches a single command, so the transaction
  boundary is the whole form. Its doc comment states the contract the client can rely on: every answer is
  upserted (BR-107) under one transaction, so a refusal leaves nothing written and the client has no
  partially saved state to reconcile (`:183-191`). It carries `[Idempotent]` (`:193`) for the same reason
  the single-answer create does. `[Rubric §12, Performance & Scalability]`: one round trip and one
  transaction replace one per question.
- **Walkthrough**
  - The class is gated with a bare `[Authorize]` (`:75`), so no endpoint here is anonymous, and
    `GetExportSpecification()` (`:96-97`, doc `:86-95`) returns `null` for
    `currentUserService.IsInRole(RoleNames.Organizer)` and an
    `OwnedByUserSpecification<SessionQuestionAnswer, SessionQuestionAnswerIdentifierType>(currentUserService.UserId!.Value)`
    otherwise. This is a distinct posture from the other session-scoped child controllers, whose reads are
    anonymous and filtered by the *parent's* visibility rather than by ownership.
  - The four reads (`:99-133`) are attribute-only passthroughs scoped by that hook, `GetByIdAsync` under
    the named route `"GetSessionQuestionAnswerById"` (`:126`). As with its event-side twin, no read carries
    an `[OutputCache]` attribute, because a per-caller payload must never enter a shared cache entry.
  - `ExportAsync` (`:142-156`) returns `Forbid()` unless the caller is an organizer (`:150-153`), the BR-9
    form of the row-scoping bypass gate, with the reasoning in its doc comment (`:135-140`).
  - `CreateAsync` (`:167-181`) is `[Idempotent]` (`:166`) and dispatches
    `AddSessionQuestionAnswerCommand(request.SessionId, null, request.QuestionId, request.AnswerValue)`
    (`:172`), then `CreatedAtRoute` (`:177-180`).
  - `UpdateAsync` (`:213-225`) dispatches
    `UpdateSessionQuestionAnswerCommand(request.SessionId, id, request.AnswerValue)` (`:219`) and returns
    `NoContent()`. `DeleteAsync` (`:229-241`) reads the parent `sessionId` `[FromQuery]` (`:231`) and
    dispatches `RemoveSessionQuestionAnswerCommand(sessionId, id)` (`:235`).
- **Why it's built this way**: answers are personal feedback, so the read surface cannot be public;
  scoping by specification keeps the authorization rule in one place and lets the query service compose it
  into the database query rather than filtering in memory. Mirroring the event-side controller line for
  line is deliberate: two rules (BR-8 and BR-9) with the same shape get the same implementation, export
  gate and replay contract included. The batch endpoint exists because a feedback form is answered as a
  unit, not one question at a time.
- **Where it's used**: the Conference service host behind the Gateway route
  `/SessionQuestionAnswers/{**catch-all}` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:114`);
  consumed by the attendee feedback UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/` and by organizer reporting
  screens.

---

### SessionsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionsController.cs:44` · Level 10 · class (sealed)

- **What it is**: the REST controller for the [`Session`](group-17-conference-domain.md#session) aggregate
  root (`/Sessions`). Aggregate-root CRUD plus a cross-source visibility filter (BR-132 / BR-49), a virtual
  `SpeakerId` filter, a gated CSV export, an out-of-range warning header (BR-86), idempotent create, a
  conditional update and an iCalendar export.
- **Depends on**:
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`SessionsController.cs:56-57`); **two**
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)s
  (one for `Session`, one for `Event` so create can re-read the parent, `:45, 49`); the
  [`SessionCreateRequest`](group-18-conference-application.md#sessioncreaterequest) create handler, the
  [`UpdateSessionCommand`](group-18-conference-application.md#updatesessioncommand) update handler and a
  [`DeleteEntityCommand`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype) delete
  handler (`:46-48`); three
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)s for
  [`GetPublicSessionFilterQuery`](group-18-conference-application.md#getpublicsessionfilterquery),
  [`GetSessionsBySpeakerFilterQuery`](group-18-conference-application.md#getsessionsbyspeakerfilterquery)
  and [`ExportSessionCalendarQuery`](group-18-conference-application.md#exportsessioncalendarquery)
  (`:50-52`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) with the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) helper (`:53, 60`); `IOutputCacheStore`
  (`:54`); the [`SessionDTO`](group-17-conference-domain.md#sessiondto),
  [`UpdateSessionResult`](group-18-conference-application.md#updatesessionresult),
  [`SessionUpdateRequest`](group-18-conference-application.md#sessionupdaterequest) and
  [`EventDTO`](group-17-conference-domain.md#eventdto); the
  [`SpecificationExtensions`](group-03-querying-specifications.md#specificationextensions) `And` composer
  yielding an
  [`AndSpecification`](group-03-querying-specifications.md#andspecificationtentity-tidentifiertype); the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute); and the
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute).
- **Concept introduced, a cross-source visibility specification.** `[Rubric §8, Data Architecture]` and
  `[Rubric §7, Microservices Readiness]`: BR-132 / BR-49 hides non-accepted sessions and the sessions of
  unpublished events from non-privileged readers, but a `Session` can live in one data source while its
  parent `Event`'s published flag lives in another (the doc comment at `SessionsController.cs:62-67` names
  Session in Cosmos and Event in SQL Server, the polyglot option of
  [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). Rather than a
  cross-database join, `GetReadSpecificationAsync` (`:76-86`) delegates to the `GetPublicSessionFilterQuery`
  handler, which uses the framework's cross-source specification helper to produce a
  [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype)
  the query service can apply; privileged readers get `null`.
  `[Rubric §12, Performance & Scalability]`: reads are `[OutputCache(PolicyName = "SessionsCache")]`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:222`) and the default sort is the
  `"StartsAt,RoomId"` constant (`:133`), which sorts the schedule chronologically then by room. The comment
  above it (`:131-132`) records the mechanism: the "ascending" suffix `QueryFieldService.ApplySorting`
  appends binds only to the last column in Dynamic LINQ, and the leading column defaults to ascending, so
  one string sorts both columns ascending.
- **Walkthrough**
  - `BuildPagedSessionSpecificationAsync` (`SessionsController.cs:106-129`, doc and remarks `:88-105`) is
    the paged read's specification builder: it starts from the hook (`:110`), then intercepts and removes
    the virtual `SpeakerId` filter key (`Session` has no such column, `:112-117`), resolves it through
    `GetSessionsBySpeakerFilterQuery` (`:119-121`) and **ANDs** the two with
    `publicSpecification.And(...)` (`:126-128`). As in [`SpeakersController`](#speakerscontroller),
    substitution would leak non-accepted sessions, and an unparseable value or a failed handler result
    simply drops the scope (`:112-117, 123-124`).
  - `GetAllAsync` (`:138-159`) keeps a body only to apply the default sort: it queries with the hook's
    specification (`:148`), `DefaultSortColumn` (`:150`) and `pageSize: MaxPageSize` (`:154`). The paged
    overload (`:164-202`) clamps the page size (`:175`), defaults the sort when none was supplied
    (`:177-181`), calls the builder above (`:187`) and writes the `X-Pagination` header (`:200`).
  - `GetAllForLookupAsync` (`:213-216`) and `GetByIdAsync` (`:225-231`) are attribute-only passthroughs;
    the base applies the same hook, so a hidden session is a 404 there (doc `:204-209` and `:218-221`).
  - `ExportAsync` (`:240-254`) is the same bypass gate the other row-scoped controllers use: `Forbid()` for
    a non-privileged caller (`:248-251`), otherwise the base (`:253`). Its doc comment spells out what an
    unscoped CSV would hand over: the whole catalog, "declined and draft-event sessions included"
    (`:233-238`).
  - `ExportCalendarAsync` (`:263-271`) streams a single session `.ics` via `File(...)` (`:270`) under the
    same anonymous cache policy as the other reads.
  - `CreateAsync` (`:280-308`) is an override marked `[Idempotent]` (`:279`) that calls
    `CreateHandler.HandleAsync` directly (`:284`) rather than `base.CreateAsync`, because it needs the
    typed [`Result`](group-01-result-error-handling.md#result) in order to run the BR-86 check: when the
    request set start or end times, it re-reads the parent event and appends a non-fatal `X-Warning` header
    if the session falls outside the event's date range (`:291-304`). Note that the parent re-read
    pattern-matches the widened query result with `eventResult.Value is EventDTO evt` (`:298`) rather than
    a dynamic member access, because `IEntityQueryService` widens its return to `object` for field
    projection, so the controller narrows it back with a type pattern (the reason is written into the
    comment at `:293-294`).
  - `UpdateAsync` (`:323-345`) carries `[SupportsIfMatch]` (`:319`) with the 409/412/428
    `[ProducesResponseType]` triple (`:320-322`), reads the required token (`:328`), dispatches
    `new UpdateSessionCommand(id, request, rowVersion)` (`:331`), surfaces the same BR-86 warning from
    `result.Value!.HasDateRangeWarning` (`:338`) and returns `Ok(result.Value.Session)` (`:344`).
    `DeleteAsync` (`:349-356`) calls the base and evicts.
  - Every mutation ends at
    `EvictTagsAsync(cancellationToken, "conference:sessions", "conference")` (`:306, 343, 354`), the broad
    tag included because cross-entity projections (the speaker bookmark-count endpoints) are cached under
    `conference:sessions` and `conference` rather than under a speakers tag.
- **Why it's built this way**: pushing the cross-source published-event check into a query handler keeps
  the controller free of persistence knowledge (`[Rubric §3, Clean Architecture]`), and the warning headers
  let the API accept a slightly-off schedule while telling the client, rather than rejecting the write
  outright. Calling the create handler directly instead of the base is the deliberate cost of needing the
  typed result at the boundary.
- **Where it's used**: the Conference service host behind the Gateway route `/Sessions/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:82`); the public schedule UI
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionList.razor`), the
  add-to-calendar affordance, the speaker dashboard's `SpeakerId`-filtered list, and the k6 load test's
  read endpoints (`/Sessions/paged`) all hit it.

---

### SessionSpeakersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSpeakersController.cs:48` · Level 10 · class (sealed)

- **What it is**: the REST controller for the link between a
  [`Session`](group-17-conference-domain.md#session) and its
  [`Speaker`](group-17-conference-domain.md#speaker)s (`/SessionSpeakers`). A junction controller like
  [`EventSpeakersController`](#eventspeakerscontroller), with one distinguishing detail in its eviction
  set.
- **Depends on**:
  [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (`SessionSpeakersController.cs:56`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:49`); the [`AddSessionSpeakerCommand`](group-18-conference-application.md#addsessionspeakercommand)
  and [`RemoveSessionSpeakerCommand`](group-18-conference-application.md#removesessionspeakercommand)
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s (`:50-51`); an
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicSessionSpeakerFilterQuery`](group-18-conference-application.md#getpublicsessionspeakerfilterquery)
  (`:52`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) with the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) helper (`:59`); `IOutputCacheStore`
  (`:54`); the [`SessionSpeakerDTO`](group-17-conference-domain.md#sessionspeakerdto); the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute); and the
  [`AddSessionSpeakerRequest`](#addsessionspeakerrequest) record (`:29-36`).
- **Concept introduced**: none new; the junction controller pattern is taught at
  [`EventSpeakersController`](#eventspeakerscontroller), and the BR-49 parent-visibility filter
  (`GetReadSpecificationAsync`, `SessionSpeakersController.cs:73-83`) is the same one
  [`SessionCategoryItemsController`](#sessioncategoryitemscontroller) uses, export gate included
  (`[HttpGet("export")]` at `:139`, `Forbid()` at `:150`). The difference is the eviction set:
  `[Rubric §12, Performance & Scalability]`, both mutations clear `conference:sessions` and the broad
  `conference` tag (`:180, 203`) and deliberately do **not** clear `conference:speakers` the way the other
  two-parent junction controllers do. The comment at `:178-179` gives the reason: what a speaker
  assignment changes is the cached session reads (detail and list, which the speaker dashboard relies on),
  so the sessions tag is the one that must go.
- **Walkthrough**: four `[AllowAnonymous]` + `[OutputCache(PolicyName = "SessionsCache")]` read
  passthroughs (`SessionSpeakersController.cs:85, 95, 114, 122`, the last carrying the named route
  `"GetSessionSpeakerById"`), all scoped by the hook. `CreateAsync` (`[HttpPost]` at `:163`,
  `[Idempotent]` at `:164`) dispatches
  `AddSessionSpeakerCommand(request.SessionId, null, request.SpeakerId)` (`:170`), returns `HandleFailure`
  first on failure (`:173-176`), evicts (`:180`) and returns `CreatedAtRoute("GetSessionSpeakerById", ...)`
  (`:181-184`); `DeleteAsync` (`:189`) reads the parent `sessionId` `[FromQuery]` (`:191`), dispatches
  `RemoveSessionSpeakerCommand(sessionId, id)` (`:195`), evicts (`:203`) and returns `NoContent()`
  (`:204`). The class gate is `[HasPermission(ConferencePermissions.SessionsManage)]` (`:47`).
- **Why it's built this way**: the eviction crosses aggregates deliberately, because the session's cached
  representation includes its speakers, so mutating the link must invalidate the session cache to keep
  reads correct. Everything else is the shared junction shape, which is the point: an engineer who has read
  [`EventSpeakersController`](#eventspeakerscontroller) can read this one in under a minute.
- **Where it's used**: the Conference service host behind the Gateway route
  `/SessionSpeakers/{**catch-all}` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:102`);
  consumed by the session-editing UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Session/` and the speaker dashboard.

---

### SponsorsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SponsorsController.cs:39` · Level 10 · class (sealed)

- **What it is**: the REST controller for the [`Sponsor`](group-17-conference-domain.md#sponsor) aggregate
  root (`/Sponsors`), the conference's sponsors and exhibitors. Anonymous reads scoped to published events,
  and create / update / delete / export behind the sponsors-manage capability
  (`SponsorsController.cs:29-33`).
- **Depends on**:
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`SponsorsController.cs:48-49`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:40`); three [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`SponsorCreateRequest`](group-18-conference-application.md#sponsorcreaterequest), the framework's
  [`UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>`](group-05-cqrs-pipeline.md#updateentitycommandtentity-tupdaterequest-tidentifiertype)
  and
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  (`:41-43`); an [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicSponsorFilterQuery`](group-18-conference-application.md#getpublicsponsorfilterquery) (`:44`);
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) plus the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) read-audience helper (`:45, 52`);
  `IOutputCacheStore` (`:46`); the [`SponsorDTO`](group-17-conference-domain.md#sponsordto);
  [`SponsorUpdateRequest`](group-18-conference-application.md#sponsorupdaterequest) as the PUT body
  (`:188`); the [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) with the
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) catalog; the
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute); and the
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder).
- **Concept introduced, a real parent column instead of a virtual filter key.** `[Rubric §9, API &
  Contract Design]` assesses whether a contract expresses scoping honestly rather than through special
  cases. Compare this controller with [`SpeakersController`](#speakerscontroller): there, `EventId` is
  *not* a column on the aggregate, so the paged action must intercept the key, remove it from the filter
  dictionary and translate it into a specification. Here the doc comments record the opposite situation,
  that `Sponsor` carries a real `EventId` column, so an event-scoped request travels through the generic
  filter pipeline unchanged and the hook only adds the published-event rule on top of it (`:54-67, 90-95`).
  The published rule and the caller's filter are composed by the query service rather than substituted, so
  scoping to an unpublished event returns an empty page to a non-privileged caller instead of leaking the
  roster. That is why this controller, like its [`ActivitiesController`](#activitiescontroller) twin and
  unlike the speaker and session roots, has no filter-interception block at all.
  `[Rubric §11, Security]`: the class carries a bare `[Authorize]` (`:38`) and each mutation re-asserts
  `[HasPermission(ConferencePermissions.SponsorsManage)]` (`:143, 162, 181, 206`), the capability declared
  at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:33`
  and included in the `ContentManagement` curation subset (`ConferencePermissions.cs:57-64`), so a content
  editor can manage the sponsor roster without holding event, room or question rights. `[Rubric §12,
  Performance & Scalability]`: reads run under the `SponsorsCache` policy (5-minute TTL, tags `conference`
  and `conference:sponsors`, `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:227`) and
  every mutation evicts both tags (`:168, 200, 212`).
- **Walkthrough**: the file is line-for-line the structural twin of
  [`ActivitiesController`](#activitiescontroller), so every member sits at the same line number in both.
  `IsPrivileged` (`SponsorsController.cs:52`) is the shared read-audience check; `GetReadSpecificationAsync`
  (`:68-78`) returns `null` for a privileged reader and otherwise the specification the
  `GetPublicSponsorFilterQuery` handler resolves (`:74-77`), degrading to `null` on a failed result. The
  four reads (`:83, 99, 114, 126`, the last under the named route `"GetSponsorById"` at `:123`) are
  `[AllowAnonymous]` + `[OutputCache(PolicyName = "SponsorsCache")]` passthroughs; the by-id doc comment
  states that a sponsor of an unpublished event is a 404, "not a redacted record, so a guessed id cannot
  confirm that a sponsorship was sold" (`:119-122`). `ExportAsync` (`:144-158`) is the strongest export
  gate in this unit alongside [`SpeakersController`](#speakerscontroller)'s: the declarative
  `[HasPermission(ConferencePermissions.SponsorsManage)]` (`:143`) plus the imperative
  `if (!IsPrivileged) return Forbid();` (`:152-155`), with the doc comment naming the commercial hazard an
  unscoped CSV would create, confirming sponsorships that have not been announced (`:134-141`).
  `CreateAsync` (`:163-170`) and `DeleteAsync` (`:207-214`) call the base and evict; `UpdateAsync`
  (`:186-202`) reads the required `If-Match` token (`:191`), dispatches the generic
  `UpdateEntityCommand<Sponsor, SponsorUpdateRequest, SponsorIdentifierType>` (`:194`), folds a failure
  through `HandleFailure` (`:197-198`), evicts (`:200`) and returns `Ok(result.Value)` (`:201`).
- **Why it's built this way**: sponsors are commercially sensitive before an event is announced but fully
  public afterwards, which is the same published-event rule the rest of the catalog follows, so the
  controller reuses the specification hook rather than inventing a sponsor-specific visibility flag.
  Because the aggregate owns a real `EventId`, none of that scoping needs a virtual key, which keeps this
  the simplest of the scope-carrying aggregate-root controllers.
- **Where it's used**: hosted by `MMCA.ADC.Conference.Service` and reached through the YARP Gateway, which
  forwards `/Sponsors/{**catch-all}` to the Conference service
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:134`). Clients are the public sponsor page
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSponsorList.razor`) and
  the organizer sponsor list, create and detail pages under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsor/`.

### ConferenceErrorResources
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Resources` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Resources/ConferenceErrorResources.cs:11` · Level 0 · class (sealed)

- **What it is**: an empty class that exists purely to be a *type handle* for a pair of `.resx` files. The
  whole declaration is three lines with no members at all
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Resources/ConferenceErrorResources.cs:11-13`).
  Its two siblings in the same folder, `ConferenceErrorResources.resx` and
  `ConferenceErrorResources.es.resx`, each carry 63 `<data name="...">` entries keyed by domain error
  `Code` (`Answer.Rating.Invalid`, `Category.Title.Empty`, `CategoryItem.Name.TooLong`,
  `Event.AlreadyPublished`, `Event.Name.Empty`, and so on).
- **Depends on**: nothing at compile time (no base type, no fields, no methods). At runtime it is consumed
  by the shared edge localizer, [IErrorLocalizer](group-12-api-hosting-mapping.md#ierrorlocalizer) and its
  [ErrorLocalizer](group-12-api-hosting-mapping.md#errorlocalizer) implementation, and the codes it
  translates are the `Code` values on [Error](group-01-result-error-handling.md#error) instances produced by
  the Conference domain. Externals: the .NET resource pipeline (`.resx` compiled into satellite assemblies)
  and `Microsoft.Extensions.Localization` underneath the localizer.
- **Concept introduced, the resource-anchor type.** .NET resource lookup is keyed by a **CLR type**, not by
  a file path: a `.resx` compiled next to `Foo.cs` becomes the resource set for `Foo`, and the satellite
  assembly for culture `es` becomes the `es` overlay for that same type. A module that wants to contribute
  translations therefore needs some type to name, and that type needs no behavior whatsoever. This class is
  exactly that anchor. The host registers it once
  (`services.AddErrorResources<ConferenceErrorResources>()`,
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:315`) and every Conference error code
  becomes translatable from then on, with no per-error registration and no `switch` anywhere.
  `[Rubric §27, i18n]` assesses whether localization is a structural property of the system rather than a
  per-screen retrofit: because errors travel as stable machine-readable **codes** through
  [Result](group-01-result-error-handling.md#result) and are turned into human text only at the edge, the
  whole Conference module is localizable without a single domain-layer change.
  `[Rubric §9, API & Contract Design]` assesses whether error payloads are contractual: the code is the
  contract, the message is presentation, and this file is where that split pays off.
- **Walkthrough**: there is no member walkthrough to do. The teaching content is the shape of the contract
  around the empty class.
  - The class is `sealed` and public (`ConferenceErrorResources.cs:11`). Public because the composition root
    in another assembly (`MMCA.ADC.Conference.Service`) must name it as a generic argument; sealed because
    nothing should ever derive from an anchor.
  - Resolution is by code with an English fallback. The module's own test drives the localizer directly:
    under the `es` UI culture, `localizer.Localize("Event.Name.Empty", "Event name cannot be empty.")`
    returns the Spanish string
    (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Localization/ConferenceErrorResourcesTests.cs:40-47`),
    while an unknown code returns the caller-supplied English message unchanged (`:50-57`). That fallback is
    what makes contributing a partial resource set safe.
  - **Deliberately incomplete by design.** The class doc records that runtime-variable messages (those
    interpolating a user-supplied value) are omitted on purpose, so they degrade to their English message
    with the value intact rather than to a mangled translation (`ConferenceErrorResources.cs:8-9`). A
    missing key is a supported state here, not a gap.
- **Why it's built this way**: ADR-027 (`Website/docs-src/adr/027-multi-locale-i18n.md`) puts translation at
  the edge and keys it by error code. Anchoring per module (rather than one application-wide resx) keeps a
  module's translations inside the module's own assembly, which is what lets the Conference module boot in
  its own service host and still carry its language support with it.
- **Where it's used**: registered in the extracted Conference host
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:315`) and in the localization test's
  service collection (`ConferenceErrorResourcesTests.cs:22`). No other code names it.

### SelfHttpOutputCacheWarmupTask
> MMCA.ADC.Conference.Service · `MMCA.ADC.Conference.Service` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/SelfHttpOutputCacheWarmupTask.cs:22` · Level 2 · class (internal, sealed)

- **What it is**: the Conference host's startup warm-up task. Once Kestrel is listening it issues eight GET
  requests against the host's *own* endpoint, so the hot anonymous conference reads are already sitting in
  the OutputCache (and the envoy connection in front of it is already established) before the first real
  attendee arrives.
- **Depends on**: [SelfHttpWarmupTaskBase](group-16-aspire-orchestration.md#selfhttpwarmuptaskbase), which
  it derives from and hands its five constructor dependencies to
  (`SelfHttpOutputCacheWarmupTask.cs:22-28`), and through it the
  [IWarmupTask](group-16-aspire-orchestration.md#iwarmuptask) contract. Externals: ASP.NET Core's `IServer`
  (to discover the actually bound port), `IConfiguration`, `IHostEnvironment`, `IHostApplicationLifetime`,
  and `ILogger<T>`.
- **Concept introduced, warming a cache that keys on the exact URL string.** OutputCache entries are keyed
  by the full request URL, so a warmed entry is only ever *hit* if a real caller issues the byte-identical
  query string. That turns warm-up into a surprisingly exacting exercise, and the class comment spells out
  why the list has the shape it does (`SelfHttpOutputCacheWarmupTask.cs:30-41`): two families of caller
  build their URLs differently.
  - Family 1 is
    [EntityServiceBase<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype),
    which interpolates C# `bool` values and therefore emits capitalized `False`/`True`. The public list
    pages go through it, so the `/paged` entries mirror exactly what
    [PublicEventList](group-21-conference-ui.md#publiceventlist) sends
    (`SelfHttpOutputCacheWarmupTask.cs:44-48`).
  - Family 2 is the hand-written lookup services,
    [EventLookupService](group-21-conference-ui.md#eventlookupservice),
    [SpeakerLookupService](group-21-conference-ui.md#speakerlookupservice) and
    [CategoryItemLookupService](group-21-conference-ui.md#categoryitemlookupservice), which write lowercase
    literals and pass `pageSize=10000` (`SelfHttpOutputCacheWarmupTask.cs:50-55`).

  Those URLs do not collide, so both families have to be warmed independently. The lesson generalizes: a
  warm-up list is a copy of a caller's serialization behavior, and it silently stops working when a caller
  changes how it renders a query string.
  `[Rubric §12, Performance & Scalability]` assesses whether hot paths avoid cold-start cost: warming the
  full path (envoy, Kestrel, OutputCache, controller, EF Core, SQL) means the first conference-day request
  does not pay for JIT, EF model warm-up and a cold SQL plan all at once.
  `[Rubric §13, Observability & Operability]` assesses whether a replica advertises readiness honestly: the
  runner holds `/health/ready` not-ready until the warm-up has had its chance, so a rolling deployment does
  not shift traffic onto a replica that would serve its first requests slowly
  (`SelfHttpOutputCacheWarmupTask.cs:6-16`).
- **Walkthrough**: the type is deliberately tiny; almost all mechanism lives in the base.
  - Primary constructor (`SelfHttpOutputCacheWarmupTask.cs:22-28`): takes `IServer`, `IConfiguration`,
    `IHostEnvironment`, `IHostApplicationLifetime` and `ILogger<SelfHttpOutputCacheWarmupTask>`, and
    forwards all five straight to `SelfHttpWarmupTaskBase` (`:28`). It adds no state of its own.
  - `Paths` (`:42-56`): a `private static readonly string[]` of eight relative paths, the two families
    described above. Four `/paged` and collection reads for the public list pages, four lookup reads
    (`speakers`, `events`, `categoryitems`, `conferencecategories`).
  - `Name => "SelfHttpOutputCache"` (`:59`): the identifier that appears in the warm-up completion and
    failure log lines.
  - `WarmupPaths => Paths` (`:62`): the single abstract member the base needs. That is the entire
    contribution of this class.
  - What the base then does with it
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Warmup/SelfHttpWarmupTaskBase.cs:93`): return
    immediately under the `Testing` environment (`:95-98`), await server start, resolve the bound cleartext
    port, build an `HttpClient` pinned to `HttpVersion.Version20` with
    `HttpVersionPolicy.RequestVersionExact` (`:70`, `:77`, `:116`) so the h2c prior-knowledge request cannot
    silently downgrade to HTTP/1.1, then loop the paths. With `RequireSuccessStatusCode` left at its default
    `true` (`:90`), each response is `EnsureSuccessStatusCode()`d and its body fully drained (`:125-132`),
    because a cache entry is only worth priming if the whole response was actually produced. The default
    stands here because every warmed path is anonymous. Failures are non-fatal: everything but a genuine
    cancellation is caught and logged (`:141-147`), and the host falls back to lazy warm-up on the first
    real request.
- **Why it's built this way**: ADR-025 (`Website/docs-src/adr/025-startup-warmup-readiness.md`) defines the
  `IWarmupTask` extension point and the readiness gate. Putting the request machinery in a shared base and
  leaving only the path list to the app means each service's warm-up file is a list of URLs a reviewer can
  actually check against the callers, while HTTP/2 pinning, port resolution and non-fatal semantics are
  fixed once for every host. `[Rubric §29, Resilience & Business Continuity]`: a warm-up that could fail
  startup would turn a transient dependency blip into a failed deployment, so it is explicitly allowed to
  fail.
- **Where it's used**: registered as `services.AddWarmupTask<SelfHttpOutputCacheWarmupTask>()` in the
  Conference host (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:256`) and executed by
  the warm-up runner that `AddServiceDefaults()` installs. Three sibling copies of the same pattern live in
  the Store services; each differs only in its `Paths` list.
- **Caveats / not-in-source**: whether a given warmed URL still matches its caller byte for byte is not
  checkable from this file alone; it is an invariant maintained by reading the caller. The comment at
  `:50-51` notes that three of the four lookup paths were previously uncovered, so the list has drifted
  before.

### CurrentUserServiceExtensions
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Authorization` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Authorization/CurrentUserServiceExtensions.cs:10` · Level 9 · class (static)

- **What it is**: a one-method helper that answers a single question for the whole Conference API layer: may
  this caller read the unfiltered catalog, or do they get the public projection? Every controller asks it
  the same way instead of hand-rolling a role check per endpoint.
- **Depends on**: [ICurrentUserService](group-08-auth.md#icurrentuserservice) (the type it extends, and the
  source of `IsInRole`) and [ConferenceReadAudience](group-17-conference-domain.md#conferencereadaudience),
  whose `PrivilegedRoles` list it evaluates (`CurrentUserServiceExtensions.cs:25`). Transitively that list
  is [RoleNames](group-08-auth.md#rolenames)`.Organizer` and `RoleNames.ContentEditor`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferenceReadAudience.cs:26-30`).
  Externals: LINQ's `Any`.
- **Concept introduced, read visibility is not authorization.** The remarks on the method are unusually
  emphatic and worth internalizing (`CurrentUserServiceExtensions.cs:20-23`): this is a *read-visibility*
  check, and it must never stand in for an authorization gate. Mutations stay gated by
  `[HasPermission(...)]` capabilities, checked against the permission grants declared in the module's own
  [DependencyInjection](#dependencyinjection) facade. The distinction matters because the two models answer
  different questions: "which rows does this caller see" is a query-shaping concern that ends up in a
  specification, while "may this caller change anything" is a capability concern that ends up in an
  attribute. Conflating them is how systems end up granting write access as a side effect of a role rename.
  `[Rubric §11, Security]` assesses whether authorization is centralized and enforced server-side: the
  audience test lives in exactly one method over exactly one list, so there is no per-controller role
  literal to drift.
  `[Rubric §1, SOLID]` (single responsibility): the helper decides audience membership and nothing else; it
  does not decide what a non-privileged reader sees, which stays each controller's own specification choice.
- **Concept introduced, the shared-list invariant between visibility and cache keys.** The same
  `ConferenceReadAudience.PrivilegedRoles` list is spread into the output-cache bypass roles in the host
  (`string[] adminBypassRoles = [.. ConferenceReadAudience.PrivilegedRoles];`,
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:214`), and the comment right above it
  names this helper as the other half of the pair (`Program.cs:212-214`). The reason is a real correctness
  hazard, not tidiness: if the visibility check and the cache-bypass list ever named different roles, a
  privileged reader's unfiltered payload would be written into a shared cache entry and then served to the
  public. Declaring the roles once makes that class of bug impossible rather than merely unlikely
  (`ConferenceReadAudience.cs:12-15`). `[Rubric §11, Security]` again, and `[Rubric §16, Maintainability]`:
  a future third, partially-privileged audience would need its own cache key, which is why the audience list
  is documented as deliberately two-valued (`ConferenceReadAudience.cs:17-21`).
- **Walkthrough**
  - The class is a plain `public static class` (`CurrentUserServiceExtensions.cs:10`) whose body is a C# 14
    `extension(ICurrentUserService currentUserService)` block (`:12`), the codebase-wide idiom (see
    [primer §4](00-primer.md#4-c-14-preview-features-in-play)). Callers write
    `currentUserService.IsPrivilegedConferenceReader()` as though it were an instance method.
  - `IsPrivilegedConferenceReader()` (`:24-25`) is a single expression:
    `ConferenceReadAudience.PrivilegedRoles.Any(currentUserService.IsInRole)`. The method group is passed
    directly as the predicate, so the check reads as "is the caller in any privileged role". An anonymous
    caller fails every `IsInRole`, so it returns `false` with no null handling needed.
- **Why it's built this way**: the business rules it serves (BR-49 accepted-or-unset sessions, BR-108
  published events, BR-239 a speaker's own sessions) are cited on the method
  (`CurrentUserServiceExtensions.cs:17`), and the audience list lives in `Conference.Shared` rather than in
  the API assembly precisely so the service host's cache configuration can reach it without depending on
  controllers. Putting the *helper* in the API layer and the *data* in Shared is what makes both consumers
  possible.
- **Where it's used**: nine Conference controllers expose it as a private `IsPrivileged` property, including
  [ActivitiesController](#activitiescontroller) (`ActivitiesController.cs:52`),
  [RoomsController](#roomscontroller) (`RoomsController.cs:104`),
  [SessionsController](#sessionscontroller) (`SessionsController.cs:60`),
  [SessionCategoryItemsController](#sessioncategoryitemscontroller) (`SessionCategoryItemsController.cs:59`),
  [SessionSpeakersController](#sessionspeakerscontroller) (`SessionSpeakersController.cs:59`),
  [SpeakerCategoryItemsController](#speakercategoryitemscontroller) (`SpeakerCategoryItemsController.cs:59`),
  [SpeakersController](#speakerscontroller) (`SpeakersController.cs:65`),
  [SponsorsController](#sponsorscontroller) (`SponsorsController.cs:52`) and
  [EventSpeakersController](#eventspeakerscontroller) (`EventSpeakersController.cs:58`), all under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/`.
  [EventsController](#eventscontroller) calls it inline in two places: to choose whether to apply
  [PublishedEventSpecification](group-18-conference-application.md#publishedeventspecification)
  (`EventsController.cs:75`) and to gate a second code path (`EventsController.cs:141`). The host reads the
  underlying list for its cache policies (`Conference.Service/Program.cs:214`).

### SessionBookmarksGrpcService
> MMCA.ADC.Conference.Service · `MMCA.ADC.Conference.Service.Grpc` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/SessionBookmarksGrpcService.cs:23` · Level 10 · class (sealed)

- **What it is**: the **server** half of Conference's session-bookmark validation boundary. It implements
  the generated gRPC service base from `session_bookmark_validation.proto` and forwards each call to the
  in-process
  [ISessionBookmarkValidationService](group-17-conference-domain.md#isessionbookmarkvalidationservice), so a
  consumer in another process (Engagement) can ask exactly the questions an in-process caller asks.
- **Depends on**:
  [ISessionBookmarkValidationService](group-17-conference-domain.md#isessionbookmarkvalidationservice)
  (constructor-injected as `inner`, `SessionBookmarksGrpcService.cs:23`); the generated
  `SessionBookmarkValidationService.SessionBookmarkValidationServiceBase` it derives from (`:24`);
  [Result](group-01-result-error-handling.md#result) and its `ThrowIfFailure()` extension from
  [ResultGrpcExtensions](group-13-grpc-contracts.md#resultgrpcextensions); and, at runtime, the
  [GrpcResultExceptionInterceptor](group-13-grpc-contracts.md#grpcresultexceptioninterceptor) server
  interceptor. Externals: `Grpc.Core` (`ServerCallContext`, `RpcException`) and the Google.Protobuf
  generated message types.
- **Concept introduced, round-tripping a Result across a gRPC boundary.** `Result` is an in-process C# type;
  gRPC carries only proto messages plus a status code. The framework bridges that with a two-step protocol,
  and this class is the first step.
  - On the server, the handler calls `result.ThrowIfFailure()` after the inner service returns
    (`SessionBookmarksGrpcService.cs:39`, `:57`). On a failure that throws a
    [ResultFailureException](group-13-grpc-contracts.md#resultfailureexception), which the
    `GrpcResultExceptionInterceptor` catches and turns into an `RpcException` whose trailers carry every
    error as `error-{i}-code`, `error-{i}-message`, `error-{i}-type`, plus optional `error-{i}-source` and
    `error-{i}-target`
    (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:128-138`).
  - On the client,
    [SessionBookmarkValidationServiceGrpcAdapter](#sessionbookmarkvalidationservicegrpcadapter) decodes
    those trailers back into `Error` instances.
  - The net effect is that the consumer sees the same `Result` shape whether the call was in-process or over
    the wire, which is what makes the extraction invisible to application code.

  `[Rubric §7, Microservices Readiness]` assesses whether a module can be extracted without rewriting its
  consumers: this pair is the mechanism.
  `[Rubric §9, API & Contract Design]` assesses whether error semantics survive the boundary: they do,
  structurally, rather than collapsing into a status code plus free text.
- **Walkthrough**: two overrides, structurally identical apart from the response shape.
  - `ValidateSessionForBookmark(request, context)` (`SessionBookmarksGrpcService.cs:27-42`):
    `ArgumentNullException.ThrowIfNull` on both parameters (`:31-32`, a fail-fast convention applied to
    every gRPC method here that also satisfies nullable analysis), then
    `inner.ValidateSessionForBookmarkAsync(request.SessionId, context.CancellationToken)` with
    `.ConfigureAwait(false)` (`:34-36`). Note that the client's cancellation token arrives through
    `ServerCallContext` and is threaded straight in, so a client deadline actually cancels the server-side
    work. Then `result.ThrowIfFailure()` (`:39`), and on success an **empty**
    `ValidateSessionForBookmarkResponse` (`:41`): validation carries no payload, only success or a
    structured failure.
  - `GetSessionIdsByEvent(request, context)` (`:45-62`): same shape, then it copies the returned identifiers
    into the proto repeated field with `response.SessionIds.AddRange(result.Value)` (`:59-60`). Reading
    `result.Value` after `ThrowIfFailure()` is safe by construction, since a failure has already thrown.
  - Both RPCs are declared in the contract at
    `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/Protos/session_bookmark_validation.proto:25`
    and `:28`.
- **Why it's built this way**: ADR-007 (`Website/docs-src/adr/007-grpc-extraction.md`) requires that
  consumer modules keep depending on a plain C# interface and that extraction stay a composition-root
  concern. That is only possible if the transport class is a thin translation with no logic of its own,
  which is why this one holds no branching, no mapping rules and no error handling beyond
  `ThrowIfFailure()`. `[Rubric §16, Maintainability]`: adding a cross-service method means adding an RPC to
  the proto and one near-identical override here and on the adapter, a pattern a reviewer can verify at a
  glance.
- **Where it's used**: mapped in the Conference host as
  `app.MapGrpcService<SessionBookmarksGrpcService>().RequireAuthorization()`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:396`). The `RequireAuthorization()` is
  deliberate and explained inline (`Program.cs:389-395`): these RPCs answer conference-state questions
  raised on behalf of a specific end user, so internal-only ingress is not considered sufficient. Every
  caller is an Engagement handler sitting behind an authenticated controller, so an inbound bearer token is
  always present for
  [JwtForwardingClientInterceptor](group-13-grpc-contracts.md#jwtforwardingclientinterceptor) to forward.

### SessionBookmarkValidationServiceGrpcAdapter
> MMCA.ADC.Conference.Contracts · `MMCA.ADC.Conference.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:27` · Level 10 · class (internal, sealed)

- **What it is**: the **client** half of the same boundary. It implements
  [ISessionBookmarkValidationService](group-17-conference-domain.md#isessionbookmarkvalidationservice) on
  top of the generated gRPC client, so Engagement's handlers keep calling a plain C# interface while the
  call actually crosses a process boundary.
- **Depends on**: the generated
  `SessionBookmarkValidationService.SessionBookmarkValidationServiceClient` (constructor-injected,
  `SessionBookmarkValidationServiceGrpcAdapter.cs:27-28`); the interface it implements (`:29`);
  [Result](group-01-result-error-handling.md#result) and
  [Error](group-01-result-error-handling.md#error); and `RpcException.ToResult` / `RpcException.ToResult<T>`
  from [ResultGrpcExtensions](group-13-grpc-contracts.md#resultgrpcextensions). It also uses the module's
  identifier aliases `SessionIdentifierType` and `EventIdentifierType`. Externals: `Grpc.Core`.
- **Concept introduced, the per-call deadline as a budget distinct from the resilience pipeline.** The
  adapter pins a 5 second deadline on every call
  (`private static readonly TimeSpan CallDeadline = TimeSpan.FromSeconds(5)`,
  `SessionBookmarkValidationServiceGrpcAdapter.cs:35`) and applies it as
  `deadline: DateTime.UtcNow.Add(CallDeadline)` on each RPC (`:49`, `:74`). The comment above it gives the
  reasoning (`:31-34`): the shared resilience pipeline's 30 second attempt / 90 second total budget is right
  for retryable background work, but these calls sit **inline in user request paths** (creating a bookmark,
  listing bookmarks). A *refused* connection fails instantly, so it is not the problem; a **hung** peer is,
  and without a deadline it would hold the caller's request open for the full pipeline budget. The narrow,
  explicit deadline is the difference between one slow dependency and a saturated thread pool on the
  consumer.
  `[Rubric §29, Resilience & Business Continuity]` assesses whether failure is bounded in time: it is, per
  call, and independently of the retry policy.
  `[Rubric §12, Performance & Scalability]`: bounding an inline dependency is what keeps a Conference
  slowdown from becoming an Engagement outage.
- **Concept introduced, decoding structured failure back into a Result.** Every method wraps its RPC in
  `try` / `catch (RpcException ex)` and returns `ex.ToResult()` or `ex.ToResult<T>()` (`:53-59`, `:79-86`).
  That decoder walks the `error-{i}-*` trailers starting at index zero and stopping at the first missing
  `error-{i}-code`, mirroring the writer's loop
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:149-157`, `:177-186`), and a
  missing `error-{i}-type` falls back to `ErrorType.Failure` rather than throwing. Structured trailers win
  when present; a transport-level fault carrying none (connection reset, deadline exceeded) degrades to a
  single `Grpc.{StatusCode}` failure sourced with the calling method's name, which the decoder captures via
  `[CallerMemberName]` (`ResultGrpcExtensions.cs:210`, `:234`). The practical consequence is stated in the
  second catch's comment (`SessionBookmarkValidationServiceGrpcAdapter.cs:81-84`): a Conference outage turns
  a bookmarks-by-event read into a `Result` failure the caller can handle, not a raw 500.
- **Walkthrough**
  - `ValidateSessionForBookmarkAsync(sessionId, cancellationToken)` (`:38-60`): builds a
    `ValidateSessionForBookmarkRequest { SessionId = sessionId }` (`:45-48`), calls the client with the
    deadline and the caller's token (`:49-50`), and returns `Result.Success()` (`:51`) because the response
    message is empty by contract. Failure path as above.
  - `GetSessionIdsByEventAsync(eventId, cancellationToken)` (`:63-87`): builds
    `GetSessionIdsByEventRequest { EventId = eventId }` (`:70-73`), then materializes the repeated field
    with a collection spread:
    `Result.Success<IReadOnlyCollection<SessionIdentifierType>>([.. response.SessionIds])` (`:77`). The
    spread converts the Protobuf `RepeatedField` into the plain collection the interface contract promises,
    so no Protobuf type escapes the adapter.
  - The class is `internal` (`:27`): nothing outside this assembly should name it. It reaches the container
    only through the public [DependencyInjection](#dependencyinjection) helper in the same assembly, which
    is the intended (and only) way to install it.
- **Why it's built this way**: ADR-007 again. The consumer's application code is written against the C#
  interface and never learns which implementation it got, so extraction is a DI edit rather than a code
  change. Keeping the adapter next to the `.proto` files in the `.Contracts` project
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/MMCA.ADC.Conference.Contracts.csproj`) means a
  consumer takes exactly one reference to get the contract, the generated stubs and the adapter together.
  `[Rubric §3, Clean Architecture]`: the dependency still points inward, since the adapter depends on
  `Conference.Shared`'s interface and not the other way round.
- **Where it's used**: registered by `AddConferenceSessionValidationClient()` (see
  [DependencyInjection](#dependencyinjection)), which the Engagement host calls
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:280`). Its eventual consumers are
  [CreateBookmarkHandler](group-22-engagement-module.md#createbookmarkhandler) and
  [GetUserBookmarksHandler](group-22-engagement-module.md#getuserbookmarkshandler) behind
  [BookmarksController](group-22-engagement-module.md#bookmarkscontroller)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:229-235`).

### EventLiveValidationGrpcService
> MMCA.ADC.Conference.Service · `MMCA.ADC.Conference.Service.Grpc` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/EventLiveValidationGrpcService.cs:22` · Level 11 · class (sealed)

- **What it is**: the server half of Conference's **live-layer** boundary. It exposes the in-process
  [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) over gRPC so
  Engagement's live features (polls, questions, room "now playing") can ask Conference whether an event,
  session, sponsor or room is published and inside its live window.
- **Depends on**:
  [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) as `inner`
  (`EventLiveValidationGrpcService.cs:22`); the generated
  `EventLiveValidationService.EventLiveValidationServiceBase` (`:23`); the read models
  [EventLiveInfo](group-17-conference-domain.md#eventliveinfo),
  [SessionLiveInfo](group-17-conference-domain.md#sessionliveinfo),
  [SponsorLiveInfo](group-17-conference-domain.md#sponsorliveinfo) and
  [RoomSessionInfo](group-17-conference-domain.md#roomsessioninfo) that it projects into proto messages; and
  the same `ThrowIfFailure()` plus interceptor path as
  [SessionBookmarksGrpcService](#sessionbookmarksgrpcservice). Externals: `Grpc.Core`, Google.Protobuf.
- **Concept introduced, choosing wire representations for time and enums.** Unlike the bookmark service this
  one carries a real payload, so it has to decide how domain values cross the boundary, and the choices are
  worth studying because they are the ones that survive contact with other languages and runtimes.
  - `DateTime` becomes **Unix seconds**. Each window boundary is converted with
    `new DateTimeOffset(info.LiveWindowStartUtc, TimeSpan.Zero).ToUnixTimeSeconds()`
    (`EventLiveValidationGrpcService.cs:44-45`, `:69-70`). The explicit `TimeSpan.Zero` offset asserts that
    the domain value is already UTC; an `int64` of seconds has no ambiguity about kind, offset or format,
    which a serialized `DateTime` string would.
  - Identifiers cross as strings:
    `response.SpeakerIds.AddRange(info.SpeakerIds.Select(id => id.ToString()))` (`:74`) turns the
    GUID-backed alias into text for the repeated field.
  - An enum crosses as its numeric value: `QuestionModerationDefault = (int)info.QuestionModerationDefault`
    (`:72`), decoded by the client with the reverse cast. That keeps the proto free of a duplicated enum
    definition, at the cost of an ordering contract between the two sides.

  `[Rubric §9, API & Contract Design]` assesses whether the wire contract is explicit and stable: primitive,
  self-describing encodings are the reason a schema change here is a reviewable diff.
  `[Rubric §8, Data Architecture]`: the boundary carries a purpose-built read model, never an entity, so
  Conference's storage shape stays private to Conference.
- **Walkthrough**: four overrides, all with the identical prologue (null-check both parameters, await
  `inner`, `ThrowIfFailure()`, then project).
  - `GetEventLiveInfo` (`:26-47`): returns `IsPublished` plus the two window boundaries as Unix seconds.
  - `GetSessionLiveInfo` (`:50-76`): the richest response. Carries `EventId`, `IsPublished`, both window
    boundaries, `IsPlenumSession` and the moderation default as `int` (`:65-73`), then appends the speaker
    ids (`:74`). Everything Engagement needs to decide whether a question or poll is allowed right now, in
    one round trip.
  - `GetSponsorLiveInfo` (`:79-100`): `EventId`, `IsPublished`, `SponsorName`.
  - `GetCurrentRoomSessionInfo` (`:103-125`): the only RPC with a second input, `request.GraceMinutes`,
    passed straight through to
    `inner.GetCurrentRoomSessionInfoAsync(request.RoomId, request.GraceMinutes, ...)` (`:111`). The grace
    window is therefore a **caller** decision, not a Conference policy: the transport forwards it rather
    than defaulting it, which keeps the knob where the feature that needs it lives.
  - After `ThrowIfFailure()` each method reads `result.Value!` (`:40`, `:64`, `:93`, `:117`); the
    null-forgiving operator is the acknowledgement that a failure has already thrown.
  - The four RPCs are declared at
    `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/Protos/event_live_validation.proto:26`, `:34`,
    `:40` and `:47`.
- **Why it's built this way**: ADR-007 for the extraction pattern, ADR-008
  (`Website/docs-src/adr/008-service-extraction-topology.md`) for why an east-west call between two ADC
  services goes over gRPC rather than through the YARP Gateway. Projecting into flat proto messages inside
  the transport class keeps the domain read models free of any serialization concern.
- **Where it's used**: mapped as `app.MapGrpcService<EventLiveValidationGrpcService>().RequireAuthorization()`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:397`). The named callers are
  Engagement's [LivePollsController](group-23-engagement-live-layer.md#livepollscontroller) and
  [SessionQuestionsController](group-23-engagement-live-layer.md#sessionquestionscontroller) handlers
  (`Program.cs:392-394`).

### EventLiveValidationServiceGrpcAdapter
> MMCA.ADC.Conference.Contracts · `MMCA.ADC.Conference.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/EventLiveValidationServiceGrpcAdapter.cs:26` · Level 11 · class (internal, sealed)

- **What it is**: the client half of the live-layer boundary. It implements
  [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) over the
  generated gRPC client and reconstructs the domain read models from the proto responses.
- **Depends on**: the generated `EventLiveValidationService.EventLiveValidationServiceClient`
  (`EventLiveValidationServiceGrpcAdapter.cs:26-27`); the interface it implements (`:28`); the read models
  [EventLiveInfo](group-17-conference-domain.md#eventliveinfo),
  [SessionLiveInfo](group-17-conference-domain.md#sessionliveinfo),
  [SponsorLiveInfo](group-17-conference-domain.md#sponsorliveinfo),
  [RoomSessionInfo](group-17-conference-domain.md#roomsessioninfo) and the
  [QuestionModerationDefault](group-17-conference-domain.md#questionmoderationdefault) enum;
  [Result](group-01-result-error-handling.md#result) in its generic form; and the same
  `RpcException.ToResult<T>` decoder from
  [ResultGrpcExtensions](group-13-grpc-contracts.md#resultgrpcextensions). Externals: `Grpc.Core`,
  `System.Guid`.
- **Concept introduced**: none new. This is the mirror image of
  [SessionBookmarkValidationServiceGrpcAdapter](#sessionbookmarkvalidationservicegrpcadapter): the same
  5 second `CallDeadline` (`EventLiveValidationServiceGrpcAdapter.cs:33`, justified at `:30-32` because
  these lookups gate live-layer commands such as opening a poll or submitting a question), the same
  `try` / `catch (RpcException ex)` around every call, and the same `ex.ToResult<T>()` decode of the
  `error-{i}-*` trailers. What repays close reading here is the **decoding** side of the wire
  representations the server chose.
  - `DateTimeOffset.FromUnixTimeSeconds(response.LiveWindowStartUnixSeconds).UtcDateTime` (`:52-53`,
    `:82-83`) is the exact inverse of the server's encoding, and `.UtcDateTime` is what restores a UTC
    `DateTime` rather than a local one. Getting that property wrong is the classic way a live window
    silently shifts by the host's offset.
  - `[.. response.SpeakerIds.Select(Guid.Parse)]` (`:84`) parses the string identifiers back. `Guid.Parse`
    (not `TryParse`) is a deliberate assertion that the peer is a matching server version: a malformed id is
    a contract violation, not a user error.
  - `(QuestionModerationDefault)response.QuestionModerationDefault` (`:86`) casts the `int` back to the
    enum, the half of the enum contract that depends on the two assemblies agreeing on ordering.

  `[Rubric §9, API & Contract Design]` and `[Rubric §29, Resilience & Business Continuity]` apply as in the
  sibling adapter.
- **Walkthrough**: four methods, one per RPC, each identical in shape (build request, call with deadline and
  token, project the response into the read model, catch `RpcException` and decode).
  - `GetEventLiveInfoAsync(eventId, ct)` (`:36-62`): returns
    `Result.Success(new EventLiveInfo(response.IsPublished, start, end))` (`:50-53`).
  - `GetSessionLiveInfoAsync(sessionId, ct)` (`:65-95`): the seven-argument `SessionLiveInfo`
    reconstruction described above (`:79-86`).
  - `GetSponsorLiveInfoAsync(sponsorId, ct)` (`:98-124`):
    `new SponsorLiveInfo(response.EventId, response.IsPublished, response.SponsorName)` (`:112-115`).
  - `GetCurrentRoomSessionInfoAsync(roomId, graceMinutes, ct)` (`:127-156`): puts `GraceMinutes` on the
    request (`:137-138`) and rebuilds
    `new RoomSessionInfo(response.SessionId, response.SessionTitle, response.EventId, response.IsPublished)`
    (`:143-147`).
  - Every catch block returns `ex.ToResult<T>()` for the matching `T` (`:60`, `:93`, `:122`, `:154`), so a
    Conference outage is uniformly a `Result` failure across all four lookups rather than an exception on
    some paths and a failure on others.
- **Why it's built this way**: ADR-007. The class doc notes the specific consequence for this pair
  (`EventLiveValidationServiceGrpcAdapter.cs:12-15`): the in-process implementation **or** the disabled stub
  is replaced with this adapter at the composition root, since Conference runs as its own microservice, and
  Engagement's live handlers never learn which one they got. `[Rubric §14, Testability]`: because the
  interface is the only thing consumers see, an Engagement test substitutes a fake with no gRPC server in
  sight.
- **Where it's used**: registered by `AddConferenceEventLiveValidationClient()` (see
  [DependencyInjection](#dependencyinjection)), called from the Engagement host
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:281`). Consumers are Engagement's
  live-poll and session-question handlers (`Program.cs:236-237`).

### DependencyInjection
> MMCA.ADC.Conference.Contracts · `MMCA.ADC.Conference.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/DependencyInjection.cs:15` · Level 12 · class (static)

- **What it is**: the two-method registration surface of the Contracts assembly. A consumer service calls
  these to swap Conference's in-process service registrations for the gRPC-backed adapters pointing at the
  extracted Conference service. This is the composition-root edit that ADR-007 promises is the *only* thing
  extraction costs. (Note that this group also documents a different `DependencyInjection`, the Conference
  module's own API-layer facade; this one belongs to the Contracts assembly.)
- **Depends on**:
  [SessionBookmarkValidationServiceGrpcAdapter](#sessionbookmarkvalidationservicegrpcadapter) and
  [EventLiveValidationServiceGrpcAdapter](#eventlivevalidationservicegrpcadapter) (the implementations it
  installs); the interfaces
  [ISessionBookmarkValidationService](group-17-conference-domain.md#isessionbookmarkvalidationservice) and
  [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) (the service keys
  it replaces); the generated client types; and `AddTypedGrpcClient<TClient>` from MMCA.Common.Grpc's own
  [DependencyInjection](group-13-grpc-contracts.md#dependencyinjection)
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:66`). Externals:
  `Microsoft.Extensions.DependencyInjection` and its `ServiceCollectionDescriptorExtensions.Replace`.
- **Concept introduced, `Replace` rather than `TryAdd`, and why the call order is load-bearing.** Most
  registration helpers in this codebase use `TryAdd` so a host can pre-empt a default. These two do the
  opposite: they call `services.Replace(ServiceDescriptor.Scoped<TInterface, TAdapter>())`
  (`DependencyInjection.cs:49`, `:79`). The reason is that by the time these run something is already
  registered for the interface, and it could be either of two things (`DependencyInjection.cs:26-34`,
  `:60-67`): the real in-process implementation
  ([SessionBookmarkValidationService](group-18-conference-application.md#sessionbookmarkvalidationservice) /
  [EventLiveValidationService](group-18-conference-application.md#eventlivevalidationservice)) when the
  Conference module is enabled in this host, or the fallback stubs
  ([DisabledSessionBookmarkValidationService](group-17-conference-domain.md#disabledsessionbookmarkvalidationservice) /
  [DisabledEventLiveValidationService](group-17-conference-domain.md#disabledeventlivevalidationservice))
  that `ConferenceModule.RegisterDisabledStubs` installs when it is not. `TryAdd` would silently lose to
  both. `Replace` wins over both, so the resolved service is the gRPC adapter regardless of how the host was
  composed.
  That in turn makes **ordering** part of the contract, which both doc comments state explicitly
  (`DependencyInjection.cs:35-39`, `:66-68`): call these *after*
  [ModuleLoader](group-14-module-system-composition.md#moduleloader)`.DiscoverAndRegister(...)`, because
  `Replace` needs the descriptor it is replacing to already be in the collection. Register too early and the
  call is a no-op that the module registration then overwrites, with no error at build or startup.
  `[Rubric §7, Microservices Readiness]` assesses whether topology is a configuration decision: here it is
  literally two lines in one file.
  `[Rubric §2, Design Patterns]`: this is the Adapter pattern completed at the composition root, where the
  choice of adapter versus direct implementation is made once and nowhere else.
- **Walkthrough**: a `public static class` (`DependencyInjection.cs:15`) whose body is an
  `extension(IServiceCollection services)` block (`:17`), the workspace DI idiom (see
  [primer §4](00-primer.md#4-c-14-preview-features-in-play)). Both methods are the same three steps.
  - `AddConferenceSessionValidationClient(string serviceName = "conference")` (`:43-52`):
    `services.AddTypedGrpcClient<SessionBookmarkValidationService.SessionBookmarkValidationServiceClient>(serviceName)`
    (`:45`), then
    `services.Replace(ServiceDescriptor.Scoped<ISessionBookmarkValidationService, SessionBookmarkValidationServiceGrpcAdapter>())`
    (`:49`), then `return services` for chaining (`:51`).
  - `AddConferenceEventLiveValidationClient(string serviceName = "conference")` (`:73-82`): identical, for
    the live-validation client and adapter (`:75`, `:79`).
  - The `serviceName` default is `"conference"`, chosen to match the AppHost resource name (`:41-42`,
    `:71-72`). `AddTypedGrpcClient` turns that name into the address `http://{serviceName}`
    (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:75-76`), which Aspire service
    discovery resolves. A typo in the name is a runtime resolution failure, not a compile error, which is
    why the default exists at all.
  - Everything else the client needs comes from `AddTypedGrpcClient`, not from here: the
    [JwtForwardingClientInterceptor](group-13-grpc-contracts.md#jwtforwardingclientinterceptor) that
    forwards the caller's bearer token
    (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:72`, `:77`), an explicit
    `SocketsHttpHandler` that opts into HTTP/2 with the connection-hygiene values from
    [HttpResilienceDefaults](group-16-aspire-orchestration.md#httpresiliencedefaults) (`:89-98`), and a
    standard resilience handler configured from
    [GrpcResilienceDefaults](group-16-aspire-orchestration.md#grpcresiliencedefaults) (`:100-108`). This is
    why the per-call deadlines in the two adapters are a *separate* budget: the pipeline owns retries and
    the circuit breaker, the deadline owns a hung peer.
  - Both adapters register as `Scoped` (`:49`, `:79`), matching the lifetime the in-process implementations
    use, so consumers see no behavioral difference in lifetime either.
- **Why it's built this way**: ADR-007 (`Website/docs-src/adr/007-grpc-extraction.md`) and ADR-008
  (`Website/docs-src/adr/008-service-extraction-topology.md`). Shipping the registration helpers in the same
  assembly as the `.proto` files and the adapters means a consumer takes one reference and gets the whole
  client story; the adapters can stay `internal` because this class is the sanctioned entry point.
  `[Rubric §16, Maintainability]`: a reader who wants to know how Engagement reaches Conference finds the
  whole answer in one 84-line file.
- **Where it's used**: the Engagement service host calls both inside its application-pipeline registration,
  in the documented order after `moduleHost.RegisterModules`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:279-281`), with the rationale for each
  written out immediately above (`Program.cs:229-237`). The AppHost declares the matching Engagement to
  Conference reference (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:269`).
- **Caveats / not-in-source**: the "call this after `DiscoverAndRegister`" requirement is carried by
  convention and by the doc comments only. Nothing in this file detects a too-early call.


---
[⬅ ADC Conference - Infrastructure & Persistence](group-19-conference-infrastructure.md)  •  [Index](00-index.md)  •  [ADC Conference - UI ➡](group-21-conference-ui.md)
