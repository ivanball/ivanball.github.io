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
is *how the Conference module wires those reusable pieces into a real, twenty-three-controller,
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

The Conference API exposes **twenty-three controllers**, and the striking thing about them is how little
code each carries. They split into three structural families, all built on the generic bases from
[G12](group-12-api-hosting-mapping.md). **Aggregate-root controllers** (eight:
[`SessionsController`](#sessionscontroller), [`SpeakersController`](#speakerscontroller),
[`EventsController`](#eventscontroller), [`QuestionsController`](#questionscontroller),
[`ConferenceCategoriesController`](#conferencecategoriescontroller),
[`SponsorsController`](#sponsorscontroller), [`PartnersController`](#partnerscontroller),
[`ActivitiesController`](#activitiescontroller)) derive
from
[`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
and inherit the full read + create + delete surface, overriding actions only to add
`[AllowAnonymous]`, an `[OutputCache]` policy, or a business rule
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionsController.cs:55`,
`SpeakersController.cs:53`, `EventsController.cs:54`, `QuestionsController.cs:42`,
`ConferenceCategoriesController.cs:43`, `SponsorsController.cs:49`, `PartnersController.cs:50`,
`ActivitiesController.cs:49`).
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
`SpeakerCategoryItemsController.cs:56`, `EventQuestionAnswersController.cs:86`,
`SessionQuestionAnswersController.cs:86`) and add their own `POST`/`PUT`/`DELETE` actions by hand,
because they manipulate a *child* of an aggregate (a room belongs to an event, a category item to a
category) and so their write commands carry a parent identifier the generic create and delete cannot
supply. And **bespoke controllers** (seven) sit apart:
[`SessionSelectionController`](#sessionselectioncontroller) derives from Common's
[`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase)
(`SessionSelectionController.cs:41`), [`SessionAssetsController`](#sessionassetscontroller) from the
same base
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionAssets/SessionAssetsController.cs:51,59`),
and [`ServiceInfoController`](#serviceinfocontroller) from the
shared
[`ServiceInfoControllerBase`](group-12-api-hosting-mapping.md#serviceinfocontrollerbase)
(`ServiceInfoController.cs:20`), because none of the three exposes a CRUD entity the generic bases
can model. The other four are **split-outs**, also on `ApiControllerBase`, that exist for a
structural reason rather than a business one: ADC's architecture tests cap a controller's
constructor at ten dependencies
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Cqrs/ConstructorDependencyCountTests.cs:56`),
and [`SessionsController`](#sessionscontroller) already sits exactly at that ceiling
(`SessionsController.cs:44-54`), so the non-CRUD sub-resources of the three busiest aggregates moved
into siblings. [`EventLifecycleController`](#eventlifecyclecontroller) holds the event publication
transitions and the Sessionize refresh
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventLifecycleController.cs:32-37`),
[`SessionCalendarController`](#sessioncalendarcontroller) the single-session iCalendar export
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionCalendarController.cs:26-28`),
[`SpeakerLinksController`](#speakerlinkscontroller) the speaker-to-user link and unlink
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Speakers/SpeakerLinksController.cs:33-37`),
and [`SpeakerSessionsController`](#speakersessionscontroller) the per-speaker session feedback and
bookmark-count reads
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Speakers/SpeakerSessionsController.cs:29-34`).
Each re-declares the parent's `[Route]` prefix (for example `[Route("Events")]` at
`EventLifecycleController.cs:29`) and the same action templates, so a client sees one `/Events`,
`/Sessions` or `/Speakers` surface regardless of which class serves the action.

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
instances for its writes and bespoke reads (`SessionsController.cs:44-56`), then folds any
`Result.Failure` back through the inherited `HandleFailure`. That is the `[Rubric §1, SOLID]` and
`[Rubric §15, Best Practices & Code Quality]` payoff the generic base exists for (the generic-controller and
dynamic-query contract of
[ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html)): the CRUD logic
is written once in Common, and a per-entity controller has almost no reason to change.

## One read hook per controller, not one filter per action

The single most important thing to learn before editing any file here is **where row scoping lives**.
It is not threaded through each action: the framework base declares one hook,
`GetReadSpecificationAsync`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:571`), and
every read action (both list overloads, the lookup, the by-id read and the CSV export) calls it
(`EntityControllerBase.cs:116,171,270,324,368`). Its default answer is the synchronous half,
`GetExportSpecification` (`EntityControllerBase.cs:601`), itself `null`, so a controller that
overrides neither reads unscoped. Thirteen of the twenty-three Conference controllers override one of the
two. Ten override the asynchronous hook because their rule is resolved through a query handler:
[`SessionsController`](#sessionscontroller) (`SessionsController.cs:75`),
[`SpeakersController`](#speakerscontroller) (`SpeakersController.cs:96`),
[`RoomsController`](#roomscontroller) (`RoomsController.cs:120`),
[`SponsorsController`](#sponsorscontroller) (`SponsorsController.cs:69`),
[`PartnersController`](#partnerscontroller) (`PartnersController.cs:66`),
[`ActivitiesController`](#activitiescontroller) (`ActivitiesController.cs:69`) and the four join
controllers ([`EventSpeakersController`](#eventspeakerscontroller) `:72`,
[`SessionSpeakersController`](#sessionspeakerscontroller) `:73`,
[`SessionCategoryItemsController`](#sessioncategoryitemscontroller) `:73`,
[`SpeakerCategoryItemsController`](#speakercategoryitemscontroller) `:73`). Three override the
synchronous one because their rule needs nothing awaited: [`EventsController`](#eventscontroller)
returns a plain [`PublishedEventSpecification`](group-18-conference-application.md#publishedeventspecification)
or `null` (`EventsController.cs:69-70`), and the two feedback-answer controllers delegate to Common's
[`OwnershipHelper`](group-08-auth.md#ownershiphelper)`.GetOwnershipSpecification`, which resolves the
owner claim (`ClaimTypes.NameIdentifier`, where the JWT bearer handler maps `sub`) into an
[`OwnedByUserSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ownedbyuserspecificationtentity-tidentifiertype)
and returns `null` for the `Organizer` bypass role (`EventQuestionAnswersController.cs:107-112`,
`SessionQuestionAnswersController.cs:107-112`), which is the shared shape ADR-033 prescribes rather
than a hand-rolled bypass ternary. Consequences worth memorizing: a row the specification
excludes is a **404, not a 403** (a "forbidden" answer would confirm the id exists), the lookup
endpoint receives the same scope as the specification's `Criteria` predicate, and the read actions in
these files are attribute-plus-guard passthroughs whose bodies call `base` behind one fail-closed
check (for example `EventQuestionAnswersController.cs:145-155`, `SessionsController.cs:218-245`),
kept only because the route attributes must sit on the derived action. That guard is worth reading
once: because the hook answers `null` for two different reasons (an Organizer whose scoping is
deliberately skipped, and a non-Organizer whose owner claim cannot be resolved), each answer-controller
read first calls `RequireResolvableOwner()`, which admits the first case and returns a 403 for the
second (`EventQuestionAnswersController.cs:135-143`, `SessionQuestionAnswersController.cs:135-143`),
so a missing claim is an authorization answer instead of a dereference. The private method is now a
one-expression delegation to Common's `OwnershipHelper.RequireResolvableOwner<TId>`, which reads the
bypass role the same way `GetOwnershipSpecification` does, so the gate and the scope cannot disagree
about who is privileged (`EventQuestionAnswersController.cs:129-131`). `[Rubric §11, Security]` is the lens, and
[ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html) is the record: the hook
exists so an export can no longer drift wider than the list it mirrors.

The export path differs from the reads in one way that matters. A `null` from the hook means
"unscoped" to a list action, but to `ExportAsync` it means **refuse**: the base answers a `Forbidden`
error rather than streaming the whole table unless the controller opts in through the virtual
`AllowUnscopedExport`, which defaults to `false`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:272-274,508,608-613`).
Sixteen Conference controllers opt in, each naming exactly the audience whose `null` is deliberate.
The ten async-hook controllers answer with their own `IsPrivileged` read-audience check (for example
`SessionsController.cs:93`, `RoomsController.cs:138`, `SpeakerCategoryItemsController.cs:91`), and
[`EventsController`](#eventscontroller) with the same check inline (`EventsController.cs:77`), because
the hook returns `null` precisely for a privileged reader who already lists every row. The two answer
controllers opt in through `OwnershipHelper.IsAdmin(currentUserService, RoleNames.Organizer)`, the
check the ownership hook itself uses, so only the Organizer bypass exports the whole table and a
non-Organizer with an unresolvable owner claim keeps the framework's 403
(`EventQuestionAnswersController.cs:114-119`, `SessionQuestionAnswersController.cs:119`). And the three
reference-data controllers that every reader lists in full return a flat `true`
(`CategoryItemsController.cs:73`, `ConferenceCategoriesController.cs:47`, `QuestionsController.cs:46`).

The CSV export keeps a second, blunter guard on top of the hook. Twelve controllers override
`ExportAsync` and return `Forbid()` outright for a caller who is not a privileged reader, rather than
serving a scoped file: `SessionsController.cs:248-258`, `SpeakersController.cs:290-300`,
`EventsController.cs:135-145`, `SponsorsController.cs:153-163`, `ActivitiesController.cs:153-163`,
`PartnersController.cs:144-158` (which belts the guard with a capability attribute on the export
action itself, `[HasPermission(ConferencePermissions.PartnersManage)]` at `PartnersController.cs:143`),
the four join controllers (`EventSpeakersController.cs:147-157`,
`SessionSpeakersController.cs:148-158`, `SessionCategoryItemsController.cs:148-158`,
`SpeakerCategoryItemsController.cs:148-158`) and the two answer controllers against the Organizer role
(`EventQuestionAnswersController.cs:208-218`, `SessionQuestionAnswersController.cs:208-218`).
Controllers whose whole class sits behind a capability gate and expose no anonymous export
([`RoomsController`](#roomscontroller), [`CategoryItemsController`](#categoryitemscontroller),
[`QuestionsController`](#questionscontroller),
[`ConferenceCategoriesController`](#conferencecategoriescontroller)) need no such override: the class
gate already restricts the export to a capability holder, and the opt-in above only decides whether
that holder's `null` scope is honored.

## Authorization at the edge, three shapes not one

Authorization is **capability-based by default but not uniform**, and the differences are the
interesting part. Most write-bearing controllers carry a class-level
[`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) gate naming one
[`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) capability rather than
a role policy: `SessionsManage` on [`SessionsController`](#sessionscontroller)
(`SessionsController.cs:43`), on the two session-join controllers
(`SessionSpeakersController.cs:47`, `SessionCategoryItemsController.cs:47`) and on
[`SessionCalendarController`](#sessioncalendarcontroller) (`SessionCalendarController.cs:25`, whose one
`GET /{id}/ics` action is re-opened with `[AllowAnonymous]` under `SessionsCache` at `:35-36`),
`EventsManage` (`EventsController.cs:43`, `EventSpeakersController.cs:46`,
`EventLifecycleController.cs:31`), `RoomsManage` (`RoomsController.cs:91`),
`CategoriesManage` (`ConferenceCategoriesController.cs:35`, `CategoryItemsController.cs:62`),
`QuestionsManage` (`QuestionsController.cs:34`), `SpeakersManage`
(`SpeakerCategoryItemsController.cs:47`) and `SessionSelectionManage`
(`SessionSelectionController.cs:32`). Reads are then re-opened action by action with
`[AllowAnonymous]` (BR-43 public browse, for example `SessionsController.cs:144`,
`RoomsController.cs:145`). Eleven capability constants exist in total, declared once in
`ConferencePermissions.All`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:51-61`).

Four shapes break that pattern, and knowing why saves you from "fixing" them.
[`SpeakersController`](#speakerscontroller) carries only a plain `[Authorize]` at class level
(`SpeakersController.cs:41`) and pushes `[HasPermission(ConferencePermissions.SpeakersManage)]` down
onto the individual organizer actions (export, create and delete at `SpeakersController.cs:289,308,365`;
[`SpeakerLinksController`](#speakerlinkscontroller) repeats the shape for the BR-209 link and unlink,
class-level `[Authorize]` at `SpeakerLinksController.cs:32` with `SpeakersManage` at `:41,60`), because one
of its writes is an authenticated self-service surface: the BR-214 profile update re-declares plain
`[Authorize]` (`SpeakersController.cs:333`) and decides inside the action whether the caller is an
organizer or the speaker themselves, comparing the `speaker_id` JWT claim to the route id
(`SpeakersController.cs:346`) and passing the answer down as `CallerIsOrganizer` so the handler
can refuse a self-edit of the organizer-only `IsTopSpeaker` field (`SpeakersController.cs:353`).
[`SponsorsController`](#sponsorscontroller), [`PartnersController`](#partnerscontroller) and
[`ActivitiesController`](#activitiescontroller) copy
the class-level-`[Authorize]`-plus-per-action-capability shape (`SponsorsController.cs:39` with
`SponsorsManage` at `:152,171,190,215`; `PartnersController.cs:40` with `PartnersManage` at
`:143,162,180,205`; `ActivitiesController.cs:39` with `ActivitiesManage` at
`:152,171,190,215`). And [`EventQuestionAnswersController`](#eventquestionanswerscontroller) and
[`SessionQuestionAnswersController`](#sessionquestionanswerscontroller) carry a bare `[Authorize]`
(`EventQuestionAnswersController.cs:77`, `SessionQuestionAnswersController.cs:77`), because *any*
signed-in attendee may submit feedback answers, so no organizer capability applies. The fourth shape
is the furthest from an attribute altogether: [`SessionAssetsController`](#sessionassetscontroller),
which manages the decks, handouts and links published against a session, carries only a class-level
`[Authorize]` and puts no capability on any write
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionAssets/SessionAssetsController.cs:50`),
because the right to publish material against a session comes from that session's own speaker list,
which is *data* no role-to-permission table can express. The controller computes two values instead:
`ActingSpeakerId`, the caller's `speaker_id` claim (`SessionAssetsController.cs:62-63`), and
`IsPrivileged`, an `IPermissionRegistry.HasPermission(..., ConferencePermissions.SessionAssetsManage)`
answer (`:66-67`); it stamps them onto every command (`:123,187-193,232,256`) and the handlers in
[G18](group-18-conference-application.md) make the decision against the session's speakers. The
`SessionAssetsManage` capability (`ConferencePermissions.cs:47`) therefore means "may manage the
materials of a session you do **not** present", which is why it sits inside the ContentEditor subset.
Which roles hold which capability is declared once in
[`ConferencePermissionGrants`](group-17-conference-domain.md#conferencepermissiongrants) (below), the
permission-over-RBAC model
of [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html);
`[Rubric §11, Security]` is the lens, and these exceptions are evidence that the model is applied per
endpoint rather than pasted.

The same controller is also the group's clearest example of the non-CRUD write surface, and three of
its choices are worth carrying into any similar controller. Its `GET` is `[AllowAnonymous]` and
output-cached under `SessionsCache` because it backs the public session page, but a request from a
speaker or a privileged reader can legitimately include material from a session the public cannot
see, so the action turns cache **storage** off for exactly those callers before handling the query
(`SessionAssetsController.cs:76-95`): the cache key does not vary by caller, so the privileged answer
must never land in the shared entry. Both creates are [`Idempotent`](group-12-api-hosting-mapping.md#idempotentattribute)
(`:114,152`), and the file upload additionally carries `[RequestSizeLimit(SessionAssetLimits.MaxRequestBytes)]`
with a hand-checked per-file bound that fails as a validation error rather than a truncated stream
(`:153,167-173`), a 50 MB cap chosen for conference-venue wifi and justified in source against the
analyzer rule it trips (`:154-157`). The update is conditional, declaring
[`SupportsIfMatch`](group-12-api-hosting-mapping.md#supportsifmatchattribute) so a caller without an
`If-Match` header gets `428` and a stale token `412` (`:217-218,229`;
[ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency-etag.html)). And every write
ends by evicting the `conference:sessions` and `conference` cache tags (`:280-281`), because the
public list it just invalidated is cached under the sessions policy that a session edit also clears.

Orthogonal to all three shapes is the **read audience**, which no attribute can express because it
changes the *rows* rather than the verdict. Eleven controllers ask
[`CurrentUserServiceExtensions`](#currentuserserviceextensions)`.IsPrivilegedConferenceReader()`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Authorization/CurrentUserServiceExtensions.cs:24-25`)
and turn the answer into a specification or `null`: `SessionsController.cs:59`,
`SpeakersController.cs:57`, `EventsController.cs:70`, `SponsorsController.cs:53`,
`PartnersController.cs:57`,
`ActivitiesController.cs:53`, `RoomsController.cs:104`, `EventSpeakersController.cs:58`,
`SessionSpeakersController.cs:59`, `SessionCategoryItemsController.cs:59` and
`SpeakerCategoryItemsController.cs:59`. The helper is one line over `ICurrentUserService` answering
against the [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience)`.PrivilegedRoles`
list declared once in G17 (Organizer and ContentEditor,
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferenceReadAudience.cs:34-38`),
and it carries an explicit remark on itself that this is a read-visibility check and never a
substitute for a `[HasPermission(...)]` gate (`CurrentUserServiceExtensions.cs:20-23`).

## The request records, the inbound write shapes

Several controllers declare small `record class` request types alongside themselves, co-located in the
same file: [`AddRoomRequest`](#addroomrequest) and [`UpdateRoomRequest`](#updateroomrequest)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/RoomsController.cs:30,58`),
[`AddCategoryItemRequest`](#addcategoryitemrequest) and
[`UpdateCategoryItemRequest`](#updatecategoryitemrequest) (`CategoryItemsController.cs:26,42`),
[`AddEventSpeakerRequest`](#addeventspeakerrequest) (`EventSpeakersController.cs:29`),
[`AddSessionSpeakerRequest`](#addsessionspeakerrequest) (`SessionSpeakersController.cs:29`),
[`AddSpeakerCategoryItemRequest`](#addspeakercategoryitemrequest)
(`SpeakerCategoryItemsController.cs:29`), [`AddSessionCategoryItemRequest`](#addsessioncategoryitemrequest)
(`SessionCategoryItemsController.cs:29`), and
[`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest) with
[`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest)
(`EventQuestionAnswersController.cs:28,61`). These are the **wire shapes** for the child-entity writes
the generic base cannot model: each carries the parent identifier (`EventId` at
`RoomsController.cs:33`) plus the child's own fields, all `required`/`init` for immutability
(`RoomsController.cs:30-55`), and the action unpacks the record into the matching `Add*Command` or
`Update*Command` from [G18](group-18-conference-application.md)
([`AddRoomCommand`](group-18-conference-application.md#addroomcommand) at `RoomsController.cs:219`,
[`UpdateRoomCommand`](group-18-conference-application.md#updateroomcommand) at `:248`,
[`RemoveRoomCommand`](group-18-conference-application.md#removeroomcommand) at `:274`). They are
deliberately separate from the application-layer command types and from the outbound DTOs (the §9
"DTOs decoupled from entities" discipline), so the HTTP contract can evolve independently of the
command's parameter list. The aggregate-root controllers, by contrast, bind the application layer's
create request directly as their `TCreateRequest` (for example
[`SessionCreateRequest`](group-18-conference-application.md#sessioncreaterequest) at
`SessionsController.cs:55`), so they need no per-controller record.

Both feedback families have four records instead of two, and the extra pair is the interesting
one. On the event side, alongside the single-answer pair, the controller declares
[`BatchAddEventQuestionAnswersRequest`](#batchaddeventquestionanswersrequest) carrying an event id
plus a list of [`BatchEventQuestionAnswerItemRequest`](#batcheventquestionansweritemrequest)
question-and-answer pairs (`EventQuestionAnswersController.cs:41,51`); its `POST /batch` action maps
them onto
[`BatchAddEventQuestionAnswersCommand`](group-18-conference-application.md#batchaddeventquestionanswerscommand)
so the whole event feedback form is upserted under one transaction and a refusal leaves nothing
written (`EventQuestionAnswersController.cs:258,266`), and both creates declare
[`Idempotent`](group-12-api-hosting-mapping.md#idempotentattribute) (`:232,259`). The session side
mirrors it exactly. Alongside [`AddSessionQuestionAnswerRequest`](#addsessionquestionanswerrequest) and
[`UpdateSessionQuestionAnswerRequest`](#updatesessionquestionanswerrequest)
(`SessionQuestionAnswersController.cs:28,61`), the controller declares
[`BatchAddSessionQuestionAnswersRequest`](#batchaddsessionquestionanswersrequest) carrying a session id
plus a list of [`BatchSessionQuestionAnswerItemRequest`](#batchsessionquestionansweritemrequest)
question-and-answer pairs (`SessionQuestionAnswersController.cs:41,51`). Its `POST /batch` action maps
them onto
[`BatchAddSessionQuestionAnswersCommand`](group-18-conference-application.md#batchaddsessionquestionanswerscommand)
so a whole feedback form is applied atomically in one transaction (`:258,266`), and both creates
declare [`Idempotent`](group-12-api-hosting-mapping.md#idempotentattribute)
(`SessionQuestionAnswersController.cs:232,259`) so a retried `Idempotency-Key` replays the first
response rather than re-applying the form
([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)).

## Where the generic shape gives way: filters, warnings, calendars and conditional writes

[`SessionsController`](#sessionscontroller) shows best *how* a controller earns its overrides. Every
read action is `[AllowAnonymous]` and `[OutputCache(PolicyName = "SessionsCache")]`
(`SessionsController.cs:144-145,170-171,219-220,231-232`, plus the split-out calendar read at
`SessionCalendarController.cs:35-36`). Its read hook dispatches
[`GetPublicSessionFilterQuery`](group-18-conference-application.md#getpublicsessionfilterquery) so a
non-organizer never sees declined sessions (BR-132/BR-49), and because `Session` and `Event` can live
in different data sources the published-event check is resolved by that handler through the
framework's cross-source specification helper rather than by a join (`SessionsController.cs:61-85`;
[ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). The paged read adds a
second layer in `BuildPagedSessionSpecificationAsync` (`SessionsController.cs:113`): `Session` has no
`SpeakerId` column, so that filter key is intercepted and `Remove`d before the generic filter pipeline
can reject it, resolved to an id list through
[`GetSessionsBySpeakerFilterQuery`](group-18-conference-application.md#getsessionsbyspeakerfilterquery),
and **ANDed** with the public filter rather than substituted for it (`SessionsController.cs:113-136`),
because substituting would leak non-accepted sessions to anonymous callers; an unparseable value
simply ignores the key (`:119-124`). The Sessions surface adds three things the base has no notion of:
a `GET /{id}/ics` action that streams one public session as `text/calendar` for the add-to-calendar
affordance via
[`ExportSessionCalendarQuery`](group-18-conference-application.md#exportsessioncalendarquery), which
lives on the split-out [`SessionCalendarController`](#sessioncalendarcontroller)
(`SessionCalendarController.cs:34-45`), a BR-86 `X-Warning` header raised on create by comparing the
request times against the event's `StartDate`/`EndDate` and on update from the handler's
`HasDateRangeWarning` flag (`SessionsController.cs:281-295`, `:328-332`), and an explicit
[`Idempotent`](group-12-api-hosting-mapping.md#idempotentattribute) declaration on the create override
so the contract is visible at the ADC endpoint rather than only inherited (`:270`). Every mutating
action ends by evicting the `conference:sessions` and `conference` output-cache tags
(`SessionsController.cs:297,334,345`), the write-side half of the caching contract.

Conditional writes are now uniform: an update states its precondition in the HTTP `If-Match` header
and nowhere else. [`SupportsIfMatch`](group-12-api-hosting-mapping.md#supportsifmatchattribute) sits
on the session update (`SessionsController.cs:310`), the event update (`EventsController.cs:222`),
the event publish and unpublish (`EventLifecycleController.cs:53,86`), the speaker update (`SpeakersController.cs:334`), the category
update (`ConferenceCategoriesController.cs:118`), the question update (`QuestionsController.cs:117`)
and the sponsor, partner and activity updates (`SponsorsController.cs:191`,
`PartnersController.cs:181`, `ActivitiesController.cs:191`), and
each action pulls the token with `SupportsIfMatchAttribute.RequiredToken(HttpContext)`
(`SessionsController.cs:319`, `EventsController.cs:231`, `EventLifecycleController.cs:61,94`,
`SpeakersController.cs:350`,
`SponsorsController.cs:200`, `PartnersController.cs:190`): a request with no header answers
**428 Precondition Required** and a
stale token answers **412 Precondition Failed**
([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). Sponsors, partners
and activities take that one step further and dispatch the framework's generic
[`UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>`](group-05-cqrs-pipeline.md#updateentitycommandtentity-tupdaterequest-tidentifiertype)
rather than a bespoke command (`SponsorsController.cs:203`, `PartnersController.cs:193`,
`ActivitiesController.cs:203`), so their
update path is generic end to end.

Three more read-path carve-outs are worth internalizing before you touch these files. First,
[`SpeakersController`](#speakerscontroller)`.GetAllForLookupAsync` constrains the *label* as well as
the rows: only `FirstName` and `LastName` may be requested by a non-privileged caller
(`SpeakersController.cs:60,218-228`), because `nameProperty=Email` would project the speaker email
straight into the lookup label and go around the DTO mapper that redacts it (BR-66). Second, that
controller's `GetByIdAsync` drops the public specification when the caller's `speaker_id` claim equals
the route id (the self-edit form cannot load without reading the profile it edits), and because the
output-cache key does not vary by caller it turns storage off for that response through
`IOutputCacheFeature` so a private profile can never land in the shared entry
(`SpeakersController.cs:256-266`). The per-session reads live on
[`SpeakerSessionsController`](#speakersessionscontroller), which pairs a class-level `[Authorize]`
(`SpeakerSessionsController.cs:28`) with per-action choices: the feedback read is gated
self-or-organizer in code and deliberately left uncached, since every response is
authorization-dependent (`SpeakerSessionsController.cs:43-53`), while the two bookmark-count reads are
anonymous under the short-TTL `BookmarkCountsCache` policy (`:66-68`, `:86-88`). Third, the event
transitions that have no generic equivalent live on
[`EventLifecycleController`](#eventlifecyclecontroller): publish, unpublish and a Sessionize refresh
(`EventLifecycleController.cs:51,84,115`), each [`Idempotent`](group-12-api-hosting-mapping.md#idempotentattribute)
(`:52,85,116`), the last mapping two domain error codes onto HTTP `429` with a `Retry-After: 300` and
onto `502` (`EventLifecycleController.cs:128-136`). [`EventsController`](#eventscontroller) itself adds
its own `GET /{id}/ics` (`EventsController.cs:155-156`) and per-event and global `now-next` snapshot
actions under the short-lived `NowNextCache` policy (`:172-173,187-188`), both dispatching
[`GetNowNextQuery`](group-18-conference-application.md#getnownextquery) and returning a
[`NowNextDTO`](group-17-conference-domain.md#nownextdto); the id-less form exists because the
home-screen widget has no event id to pass. Cache eviction across the two event controllers is
proportional to blast radius: a create evicts only `conference:events` (`EventsController.cs:209`),
an update, publish or unpublish adds the `conference` umbrella tag (`EventsController.cs:248`,
`EventLifecycleController.cs:70,103`), a delete also evicts sessions and rooms
(`EventsController.cs:261-262`), and a Sessionize refresh evicts all six tags it can touch
(`EventLifecycleController.cs:142-149`). `[Rubric §12, Performance & Scalability]` is the lens for the whole caching story.

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
(`[HasPermission(ConferencePermissions.SessionSelectionManage)]`, `SessionSelectionController.cs:32`)
decision support over an event's session pool: a composite dashboard, category distribution, speaker
overlap and content similarity, each `GET` delegating to a dedicated
[`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (for
example [`GetSessionSelectionDashboardQuery`](group-18-conference-application.md#getsessionselectiondashboardquery))
and output-cached under the `ConferenceCache` policy (`:41-42,55-56,69-70,83-84`; content similarity
also takes a `minimumSimilarity` threshold defaulting to `0.3`, `:87`). Its `POST score/{eventId}` is
the notable one: AI scoring of every eligible session can take minutes, so the action does not run the
work at all. It schedules it, calling
[`IInternalCommandScheduler`](group-14-module-system-composition.md#iinternalcommandscheduler)`.ScheduleAsync`
with a
[`ScoreEventSessionsInternalCommand(eventId)`](group-18-conference-application.md#scoreeventsessionsinternalcommand)
(`:115-117`), folding a failed schedule back through `HandleFailure` (`:119-122`) and otherwise
writing a `[LoggerMessage]`-sourced structured log and returning `202 Accepted` (`:125-126,128-129`,
`[Rubric §13, Observability & Operability]`). The row is picked up off the request path by the
framework's internal-command processor from [G14](group-14-module-system-composition.md)
([ADR-114](https://ivanball.github.io/docs/adr/114-internal-commands-durable-job-queue.html)), which keeps the
controller free of any scope-lifetime handling and makes the pass survive a replica restart. A
duplicate trigger is cheap rather than forbidden: the durable handler takes a per-event claim before
it starts, so a second pass for an event already being scored logs and completes instead of paying
for the same Anthropic calls twice (`:104-106`, `[Rubric §31, Cost/FinOps]`). That is also why the
action carries an explicit
[`NonIdempotent`](group-12-api-hosting-mapping.md#nonidempotentattribute) declaration with a written
justification (`:109`): the handler already deduplicates, so replaying a cached `202` would report
acceptance for a request that never reached the queue and hide a schedule failure the caller has to
act on.

## The module entry point and seeder, how Conference plugs in

[`ConferenceModule`](#conferencemodule) is the Conference implementation of
[`IModule`](group-14-module-system-composition.md#imodule). It is tiny by design: `Register(...)`
calls the [`DependencyInjection`](#dependencyinjection) extension's `AddConferenceModule(...)`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:28-29`), which chains
the Application, Infrastructure and API registrations in dependency order into one call
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:24-26`). The API
layer's `AddModuleConferenceAPI` is not a no-op: it calls
`services.AddPermissions(ConferencePermissionGrants.Apply)` (`DependencyInjection.cs:41-45`). The map
itself is deliberately *not* inline here. It lives in
[`ConferencePermissionGrants`](group-17-conference-domain.md#conferencepermissiongrants) in the
module's Shared project, because the token-minting Identity host has to apply the same binding: a
token must carry the permission claims of every module, not only of the module the minting host boots
(`DependencyInjection.cs:35-39`). `Apply` grants
[`RoleNames`](group-24-identity-module.md#rolenames)`.Organizer` all ten
[`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) capabilities and
`ContentEditor` only the six-capability `ContentManagement` curation subset with no event structure,
rooms, questions or session selection
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissionGrants.cs:47-48`;
the subset itself is `ConferencePermissions.cs:72-78`). Attendees are granted nothing, so
attendee-facing endpoints stay on a plain `[Authorize]` that carries no capability
(`ConferencePermissionGrants.cs:30-32`), and a speaker needs no grant at all to manage their own
session's materials (`ConferencePermissionGrants.cs:38-40`). And
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
`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:211`), then constructs and runs
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
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/EventLiveValidationServiceGrpcAdapter.cs:27-29,37,66,122,151`),
converting the Unix-second live-window fields back into UTC `DateTime`s. Both pin a **5-second
per-call deadline** on every RPC (`SessionBookmarkValidationServiceGrpcAdapter.cs:35`,
`EventLiveValidationServiceGrpcAdapter.cs:34`), much tighter than the shared resilience pipeline's 30s
attempt and 90s total budget, precisely because these calls sit inline in user request paths (bookmark
create and list, live-layer poll and question commands) and a *hung* (as opposed to refused)
Conference peer must fail fast rather than hold the caller hostage
(`EventLiveValidationServiceGrpcAdapter.cs:31-33`). Both catch `RpcException` and reverse the mapping
with the framework's own `RpcException.ToResult` decoder
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:216,240`), which reads the
trailers back into [`Error`](group-01-result-error-handling.md#error) instances and degrades a pure
transport fault (connection reset, deadline exceeded) to a single `Grpc.{StatusCode}` failure sourced
with the calling method's name (`SessionBookmarkValidationServiceGrpcAdapter.cs:58,85`,
`EventLiveValidationServiceGrpcAdapter.cs:61`). The live-validation adapter applies the same rule to
wire data it cannot map: a speaker id that is not a GUID or an undefined moderation-default value
returns a `Grpc.MalformedResponse` failure built the way the decoder builds a transport fault, never an
exception that would escape the `RpcException` catch
(`EventLiveValidationServiceGrpcAdapter.cs:80-101,187-188`). Because both the in-process implementation and each
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
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:411`) and the AppHost deliberately
gives only the Engagement-to-Conference edge a startup `WaitFor`, leaving the reverse edge a plain
`WithReference` so the pair cannot deadlock; transient "peer not ready" errors self-heal through the
resilience pipeline (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:271,274`;
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html), `[Rubric §29,
Resilience]`).

## The service host: Kestrel first, then caching and warm-up

The `MMCA.ADC.Conference.Service` `Program.cs` boots only the Conference module. Kestrel is configured
before anything else, and the whole of it is one line:
`builder.ConfigureEndpointsWithHealthProbe(HttpProtocols.Http2)`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:91`), the shared extension from
Common's [`KestrelEndpointExtensions`](group-16-aspire-orchestration.md#kestrelendpointextensions)
([G16](group-16-aspire-orchestration.md)). Passing `HttpProtocols.Http2` sets every endpoint default to
HTTP/2-only on cleartext (h2c prior knowledge), so cross-service gRPC clients negotiate HTTP/2 without
TLS or ALPN; on a cleartext endpoint `Http1AndHttp2` would effectively disable HTTP/2 and Kestrel would
reject gRPC frames with `GOAWAY HTTP_1_1_REQUIRED` (`Program.cs:81-89`). That transport choice is
[ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html). The same helper adds a
dedicated HTTP/1.1-only listener for the ACA `httpGet` probes when `HealthProbe:Port` is configured,
because the h2c-only endpoint rejects the platform's HTTP/1.1 probe requests. The rest of the host is
the standard ADC REST composition: Serilog registered as one provider rather than through
`UseSerilog()` so the OpenTelemetry-to-Azure-Monitor provider survives (`Program.cs:106-107`), an
optional Key Vault configuration source layered in before anything binds settings (`:109`), the
Conference-owned `MMCA.ADC.Conference.Scoring` meter (`:119`), health checks with a relational database
required (`:163`), CORS, API versioning and rate limiting (`:166-168`), response compression (`:259`),
OpenAPI (`:264`), RS256 JWT validation via JWKS discovery forwarded through the Gateway (`:273-277`),
exception handlers (`:280`), the scheduler and audit-trail extension points (`:292,296`), and the
shared middleware pipeline (`:376`;
[ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html),
[ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html),
[ADR-079](https://ivanball.github.io/docs/adr/079-shared-http-middleware-pipeline.html)).

Output caching is where this host carries the most bespoke configuration (`Program.cs:227-296`). The
base policy is deny-by-default `NoCache` (`:213`), so only explicitly decorated endpoints cache at all.
`ConferenceCache` stays on the built-in default semantics because the permission-gated
[`SessionSelectionController`](#sessionselectioncontroller) references it, and
[ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)'s
public policy must never back a permission-gated endpoint since a cached hit is served before MVC's
filters run (`:215-221`). Ten further policies (`ConferencePublicCache`, `EventsCache`,
`SessionsCache`, `SpeakersCache`, `RoomsCache`, `CategoriesCache`, `QuestionsCache`, `SponsorsCache`,
`PartnersCache`, `ActivitiesCache`) are registered through `AddPublicEndpointPolicy` at a 5-minute TTL
with hierarchical
tags (`:251-265`), and each **bypasses the cache entirely for the privileged read audience** (`:250`,
the bypass list built from `ConferenceReadAudience.PrivilegedRoles` so it can never diverge from the
API-layer visibility checks), for two reasons spelled out in the source (`:229-246`): privileged
responses include unpublished rows that must never land in a shared public entry, and admin surfaces
read back immediately after writing, where a stale cached row version would make the next save throw
`DbUpdateConcurrencyException`. Two policies then sit at a 60-second TTL for different reasons:
`NowNextCache` because its payload changes with the clock and is identical for every role, so it takes
no bypass at all (`:268`), and `BookmarkCountsCache` because bookmark counts are owned by Engagement in
another process (`:271-280`). All of this is
[ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html):
[`PublicEndpointOutputCachePolicy`](group-12-api-hosting-mapping.md#publicendpointoutputcachepolicy)
exists because the UI attaches a Bearer token to every request and the built-in default policy refuses
to cache anything carrying `Authorization`, which on conference day meant the cache served none of the
real traffic.

Two mechanisms close the distance that TTLs alone cannot. First, at two replicas the store itself must
be shared: when a Redis connection string is present the host backs the **output** cache with Redis as
well as the distributed cache (`Program.cs:185,195`), because the default per-replica memory store
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
registered via `AddWarmupTask<T>()` (`Program.cs:309`) as an
[ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html)
[`IWarmupTask`](group-16-aspire-orchestration.md#iwarmuptask). The task itself is almost empty: it
derives from [`SelfHttpWarmupTaskBase`](group-16-aspire-orchestration.md#selfhttpwarmuptaskbase)
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/SelfHttpOutputCacheWarmupTask.cs:22-28`) and
contributes only a name (`:65`) and a list of paths (`:68`), while the base owns the request machinery
(waiting for the server to start, resolving the actually-bound cleartext port, pinning HTTP/2 prior
knowledge, and treating a failure as non-fatal). The paths are the interesting part, and there are
**eight** of them in two families (`SelfHttpOutputCacheWarmupTask.cs:45-59`), because OutputCache keys
on the full URL and a warmed entry is only ever hit by a byte-identical query string: family one
mirrors the Blazor list pages, whose service base interpolates C# bools and so writes capital
`False`/`True`; family two mirrors the hand-written lookup services, which page through `/paged` in id
order with lowercase literals and `pageSize=500` (`:30-44,55-58`). Those lookup URLs are built by
Common's `PagedReadAll.LookupPageUrl`, and the task exposes its list as `RequestedPaths` (`:62`) so
`SelfHttpOutputCacheWarmupTaskTests` can pin every lookup path to that builder's output
(`:38-39`). Warming one family left the other paying a cold read on its first real
caller. Every path is `[AllowAnonymous]`, so the base's require-success loop sees `200` and skips
nothing.

## The runtime picture, one host, two transports

After module discovery (`Program.cs:367-371`) the host wires the Engagement gRPC client (`:349`), the
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

### AddCategoryItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Categories/CategoryItemsController.cs:26` · Level 0 · record class

- **What it is**: the JSON body POSTed to `/CategoryItems` to add an item to a category. It carries the
  owning `CategoryId`, an *optional* client-supplied `CategoryItemId`, a display `Name`, and a `Sort`
  order (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Categories/CategoryItemsController.cs:26-39`).
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
  (`CategoryItemsController.cs:137-142`): it reads request fields and constructs the command positionally.
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
  create parameter only (`CategoryItemsController.cs:133-134`). That action is marked
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute)
  (`CategoryItemsController.cs:132`), so a retried POST carrying the same `Idempotency-Key` replays the
  first response instead of adding a second row: `[Rubric §9, API & Contract Design]`, the replay contract is
  declared on the action because this create is hand-written rather than inherited from the CRUD base
  (`CategoryItemsController.cs:124-130`).

---

### UpdateCategoryItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Categories/CategoryItemsController.cs:42` · Level 0 · record class

- **What it is**: the PUT body for editing an existing category item. It is
  [`AddCategoryItemRequest`](#addcategoryitemrequest) minus `CategoryItemId`: the owning `CategoryId`,
  the new `Name`, and the new `Sort`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Categories/CategoryItemsController.cs:42-52`).
- **Depends on**: the same id aliases plus BCL `string`/`int`. Consumed by
  [`CategoryItemsController`](#categoryitemscontroller), which forwards it to
  [`UpdateCategoryItemCommand`](group-18-conference-application.md#updatecategoryitemcommand).
- **Concept**: the update half of the request-vs-command shape (see
  [`AddCategoryItemRequest`](#addcategoryitemrequest)). The item id to update is not in the body, it is the
  route's `{id}`; `UpdateAsync` threads the route id into the command
  (`new UpdateCategoryItemCommand(request.CategoryId, id, request.Name, request.Sort)`,
  `CategoryItemsController.cs:164-169`). Unlike the create, this action carries **no**
  `[Idempotent]` attribute (`CategoryItemsController.cs:157-159`): a PUT that sets an item to a stated
  name and sort is naturally repeatable, so there is nothing to replay-protect.
- **Walkthrough**: three `required { get; init; }` properties. `CategoryId` is carried on update so the
  handler can re-check ownership of the parent before mutating.
- **Where it's used**: `[FromBody]` on [`CategoryItemsController`](#categoryitemscontroller)'s
  `UpdateAsync` (`CategoryItemsController.cs:159-161`); on success the action evicts
  `conference:categories` and `conference` and returns `NoContent()`
  (`CategoryItemsController.cs:177-178`).

---

### CategoryItemsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Categories/CategoryItemsController.cs:63` · Level 8 · class (sealed)

- **What it is**: the REST controller for conference category items. Reads are public (anonymous per
  BR-43); writes (add, update, remove) require the categories capability, gated class-level by
  `[HasPermission(ConferencePermissions.CategoriesManage)]`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Categories/CategoryItemsController.cs:62`).
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
  straight back (`=> base.GetAllAsync(...)`, `:83`): the attributes have to sit on the derived method for
  MVC to see them, which is the whole reason these bodies exist. Each write maps its request record onto
  exactly one command and folds any failure through the inherited `HandleFailure`, the one-handler-per-action
  shape of CQRS at the edge. `[Rubric §1, SOLID]` and `[Rubric §15, Best Practices & Code Quality]`: because the read
  machinery is written once in Common, the concrete controller is small and has almost no reason to change.
- **Walkthrough**
  - Primary-constructor injection (`CategoryItemsController.cs:63-69`): the query service, the three
    command handlers (`AddCategoryItemCommand -> Result<CategoryItemDTO>`, `UpdateCategoryItemCommand ->
    Result`, `RemoveCategoryItemCommand -> Result`), the output-cache store and the logger; the base call
    passes the query service and logger to `EntityControllerBase` (`:70`).
  - `protected override bool AllowUnscopedExport => true` (`:73`): the deliberate opt-in to a whole-table
    export, documented as reference data every reader lists in full, with the export gated by
    `CategoriesManage` (`:72`). The base default is `false`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:508`).
  - The four read overrides (`:75-122`) each add `[AllowAnonymous]` (re-opening the class-level capability
    gate for reads) and `[OutputCache(PolicyName = "CategoriesCache")]`, then forward to the base:
    `GetAllAsync` (`:78-83`), the paged `GetAllAsync` with the
    `[ModelBinder(typeof(QueryFilterModelBinder))]` filter dictionary (`:88-98`), `GetAllForLookupAsync`
    (`:103-106`) and `GetByIdAsync` under the named route `"GetCategoryItemById"` (`:108-122`).
  - `CreateAsync` (`:133`): `[HttpPost]` (`:131`) and `[Idempotent]` (`:132`), binds
    `[FromBody] AddCategoryItemRequest`, dispatches
    `new AddCategoryItemCommand(request.CategoryId, request.CategoryItemId, request.Name, request.Sort)`
    (`:138-142`); on failure `HandleFailure` (`:145-148`), otherwise it evicts and returns
    `CreatedAtRoute("GetCategoryItemById", new { id = result.Value!.Id }, result.Value)` (`:151-154`). The
    doc comment records why the replay contract is declared here rather than inherited: this create is
    hand-written, not the base action (`:124-130`).
  - `UpdateAsync` (`:159`): `[HttpPut("{id}")]` (`:158`), binds the route `id` and
    `[FromBody] UpdateCategoryItemRequest`, dispatches
    `new UpdateCategoryItemCommand(request.CategoryId, id, request.Name, request.Sort)` (`:165-169`),
    evicts (`:177`), then `NoContent()` (`:178`).
  - `DeleteAsync` (`:183`): `[HttpDelete("{id}")]` (`:182`), binds the route `id` and
    `[FromQuery] ConferenceCategoryIdentifierType categoryId` (`:185`), dispatches
    `new RemoveCategoryItemCommand(categoryId, id)` (`:189`), evicts (`:197`), then `NoContent()`. The
    parent id travels on the query string because a child delete needs its parent for ownership
    re-validation in the handler.
  - All three mutations end with `outputCacheStore.EvictTagsAsync(cancellationToken,
    "conference:categories", "conference")` (`:150, 177, 197`), and all three return `HandleFailure`
    *before* the eviction, so a rejected command never disturbs the cache. `[Rubric §12, Performance &
    Scalability]`: without that call the cached reads would serve the pre-edit item list for the full
    5-minute policy TTL (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:277`), so an
    organizer renaming a track would not see it on the public session pages until the entry expired.
- **Why it's built this way**: the split between an aggregate-root base (create and delete built in) and
  this read-only base (writes hand-written) is exactly the "child commands carry a parent id the generic
  base cannot model" distinction the group overview draws. Reads are anonymous because the taxonomy is
  public (BR-43); writes are capability-gated (BR-41) at the class level, and `CategoriesManage` is one of
  the five permissions in the `ContentManagement` curation subset
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:70-79`),
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
  framework read hooks and does not override the inherited `/export`. The base export is fail-closed: with
  no read specification and no opt-in it answers a 403 and queries nothing
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:273-274`). The
  `AllowUnscopedExport` override (`CategoryItemsController.cs:73`) is what lets the export stream the whole
  item table, protected only by the class-level `CategoriesManage` capability, since the inherited action
  carries no `[AllowAnonymous]` of its own (`EntityControllerBase.cs:252-257`).

---

### ConferenceCategoriesController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Categories/ConferenceCategoriesController.cs:36` · Level 8 · class (sealed)

- **What it is**: the REST controller for the [`Category`](group-17-conference-domain.md#category)
  aggregate root, served at the custom route `conferencecategories`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Categories/ConferenceCategoriesController.cs:33`)
  so it cannot collide with another module's `categories` route. Anonymous reads, capability-gated create,
  update and delete (`[HasPermission(ConferencePermissions.CategoriesManage)]`, `:35`). This is the first
  *aggregate-root* controller in the group, so it establishes the shape the other full-CRUD controllers
  reuse.
- **Depends on**:
  [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (the CRUD base, `ConferenceCategoriesController.cs:43-44`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:37`); a create handler keyed on
  [`ConferenceCategoryCreateRequest`](group-18-conference-application.md#conferencecategorycreaterequest)
  (`:38`); an update handler keyed on the framework's
  [`UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>`](group-05-cqrs-pipeline.md#updateentitycommandtentity-tupdaterequest-tidentifiertype)
  (`:39`); a delete handler keyed on
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  (`:40`); `IOutputCacheStore` (`:41`); the
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto); the PUT body
  [`ConferenceCategoryUpdateRequest`](group-18-conference-application.md#conferencecategoryupdaterequest)
  (`:124`); and the [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute).
- **Concept introduced, the aggregate-root controller.** `[Rubric §9, API & Contract Design]` assesses
  consistent resource CRUD: an aggregate root gets a full, uniform REST surface, and
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  supplies `GetAll`, `GetById`, `GetAllForLookup`, `Export`, `Create` and `Delete` from its constructor
  slots (query service, create handler, delete handler, logger, `:43-44`). The subclass then writes only
  policy, cache eviction, and the one action the base does not supply. Note that the create request type
  *is* the handler's command: `ConferenceCategoryCreateRequest` is passed straight into the create
  handler's [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) slot (`:38`),
  the create-from-request shape used across every Conference aggregate root.
- **Concept introduced, the required conditional write.** `[Rubric §9, API & Contract Design]` also
  assesses whether a contract expresses concurrency honestly. The base has no update action, so
  `UpdateAsync` is hand-rolled, and it carries [`SupportsIfMatch`](group-12-api-hosting-mapping.md#supportsifmatchattribute)
  (`:118`) with `[ProducesResponseType]` for 409, 412 and 428 (`:119-121`). The token is read with
  `SupportsIfMatchAttribute.RequiredToken(HttpContext)` (`:127`, declared at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Concurrency/SupportsIfMatchAttribute.cs:68`), and the
  attribute's own doc comment states the contract: a request with no `If-Match` header answers **428
  Precondition Required** and a stale token answers **412 Precondition Failed**
  ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html), doc at `:109-116`). The
  update itself is the framework's generic
  [`UpdateEntityCommand`](group-05-cqrs-pipeline.md#updateentitycommandtentity-tupdaterequest-tidentifiertype)
  closed over `Category`, the update request and the identifier type (`:130`), so a category edit needs no
  bespoke command type at all.
- **Walkthrough**
  - `protected override bool AllowUnscopedExport => true` (`:47`) opts the inherited `/export` in to a
    whole-table export: categories are reference data every reader lists in full, and the export stays
    gated by the class-level `CategoriesManage` capability (doc comment `:46`). Without it the base export
    refuses with a 403 when no row scope resolves
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:273-274`; default
    `false` at `:508`).
  - The four reads (`:49-96`) are `override`s that attach `[AllowAnonymous]` plus
    `[OutputCache(PolicyName = "CategoriesCache")]` and forward to the base, including the paged overload
    with the [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder) filter
    dictionary (`:70`) and `GetByIdAsync` under the named route `"GetCategoryById"` (`:82`).
  - `CreateAsync` (`:99-107`) and `DeleteAsync` (`:141-149`) are thin `override`s that call
    `base.CreateAsync` / `base.DeleteAsync` and then evict, so the base does the CQRS dispatch and the
    override adds only the cache concern. Because the base returns an `ActionResult` rather than a
    [`Result`](group-01-result-error-handling.md#result), these two evict unconditionally, including after
    a rejected command: a cheap over-eviction, and the one place the failure-before-evict ordering used
    elsewhere in this unit cannot be applied.
  - `UpdateAsync` (`:122-138`) reads the required row version (`:127`), dispatches the generic update
    command (`:129-131`), folds a failure through `HandleFailure` (`:133-134`), evicts (`:136`) and returns
    `Ok(result.Value)` (`:137`).
  - All three mutations evict only the `conference:categories` tag (`:105, 136, 147`), unlike the child
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

### DependencyInjection
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:13` · Level 2 · class (static)

- **What it is**: the Conference module's DI composition facade. It stitches the module's three
  registerable layers (Application, Infrastructure, API) into one call and applies the Conference
  role-to-permission grants that back the module's `[HasPermission(...)]`-gated endpoints.
- **Depends on**: [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings)
  (the shared cross-module settings passed through to the Application layer) and
  [`ConferencePermissionGrants`](group-17-conference-domain.md#conferencepermissiongrants) (the
  named grant map `AddModuleConferenceAPI` now applies, rather than declaring the grants inline).
  Externally it relies on `IServiceCollection` (Microsoft DI), `AddPermissions` (`MMCA.Common`), and
  the sibling layer registration extensions (`AddModuleConferenceApplication`,
  `AddModuleConferenceInfrastructure`).
- **Concept introduced, the `extension(IServiceCollection)` registration facade.** The class body is
  a C# preview `extension(IServiceCollection services)` block (`DependencyInjection.cs:15`), the
  codebase-wide idiom for DI registration (see
  [primer §4](00-primer.md#4-c-build-and-code-style-conventions)); the methods read as instance calls
  on `services` without a formal `this` parameter. `[Rubric §7, Microservices Readiness]` (assesses
  whether a module registers itself with one self-contained call so it can boot in its own service
  host): `AddConferenceModule` is exactly that single entry point.
  `[Rubric §11, Security]` (assesses how authorization is modeled): applying a named grant map
  instead of an inline lambda lets the same map back two independent hosts.
- **Walkthrough**: two extension methods.
  - `AddConferenceModule(ApplicationSettings applicationSettings)` (`DependencyInjection.cs:22`)
    chains the three layers in dependency order: `AddModuleConferenceApplication(applicationSettings)`,
    `AddModuleConferenceInfrastructure()`, then `AddModuleConferenceAPI()`, returning `services` for
    fluent chaining (`DependencyInjection.cs:24-28`).
  - `AddModuleConferenceAPI()` (`DependencyInjection.cs:35`) calls
    `services.AddPermissions(ConferencePermissionGrants.Apply)` (`DependencyInjection.cs:37`),
    passing the grant map's `Apply` method group directly rather than an inline callback. The map
    itself (`ConferencePermissionGrants.cs:43-49`) grants `Organizer` every Conference capability
    (`[.. ConferencePermissions.All]`) and `ContentEditor` only the catalog-curation subset
    (`[.. ConferencePermissions.ContentManagement]`, no event structure, rooms, questions, or session
    selection); it grants `Admin` nothing directly. Attendees are granted nothing either, so
    attendee-facing endpoints stay on the plain `RequireAuthenticated` policy rather than a
    permission gate.
- **Why it's built this way**: the layered chain keeps the service host's `Program.cs`
  context-unaware: it registers a module with one call and never names Conference's internal layers.
  The grant map moved out of this file and into `ConferencePermissionGrants`
  (`ConferencePermissionGrants.cs:6-26`) because the token-minting Identity host applies the same
  map when it signs an access token's `permission` claims: a token minted without these grants would
  deny in one process what the other allows, so the two hosts share one source instead of two lambdas
  drifting apart. This is the module-registration convention described in `MMCA.Common/CLAUDE.md`.
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

### AddEventQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventQuestionAnswersController.cs:28` · Level 0 · record class

- **What it is**: the POST body for answering a feedback question against an event. It names the
  `EventId`, the `QuestionId` being answered, and the `AnswerValue` text
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventQuestionAnswersController.cs:28-38`).
- **Depends on**: id-alias property types (`EventIdentifierType`, `QuestionIdentifierType`) plus BCL
  `string`. Consumed by [`EventQuestionAnswersController`](#eventquestionanswerscontroller), which
  forwards it to
  [`AddEventQuestionAnswerCommand`](group-18-conference-application.md#addeventquestionanswercommand).
- **Concept, user-owned write data behind authorization.** See the request-vs-command shape under
  [`AddCategoryItemRequest`](#addcategoryitemrequest). What distinguishes the answer records from the
  public-catalog records is the surrounding `[Rubric §11, Security]` story (authorization enforced
  server-side, results scoped per user): the controller is gated class-level by a plain `[Authorize]`
  (`EventQuestionAnswersController.cs:77`) rather than by a Conference permission, because answering is an
  attendee capability rather than an organizer one, and the record itself carries **no** `UserId`. The
  controller never trusts the client for identity: `CreatedBy` is stamped from the authenticated principal
  by the audit pipeline (see
  [soft-delete and audit](00-primer.md#2-architectural-styles-this-codebase-commits-to)), and reads are
  narrowed to the caller's own rows by the `GetExportSpecification` override, which returns an
  [`OwnedByUserSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ownedbyuserspecificationtentity-tidentifiertype)
  for anyone who is not an Organizer (BR-8, `EventQuestionAnswersController.cs:96-97`).
- **Walkthrough**: three `required { get; init; }` properties, no methods. On add the controller passes
  `null` for the answer's own id: `new AddEventQuestionAnswerCommand(request.EventId, null,
  request.QuestionId, request.AnswerValue)` (`EventQuestionAnswersController.cs:238`), so the domain mints
  the answer id.
- **Why it's built this way**: naming the `QuestionId` on *add* (but not on update) encodes that you pick
  which question an answer belongs to once, at creation.
- **Where it's used**: `[FromBody]` on [`EventQuestionAnswersController`](#eventquestionanswerscontroller)'s
  `CreateAsync` (`EventQuestionAnswersController.cs:233-234`), which is
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute)
  (`EventQuestionAnswersController.cs:232`) so a retried submit cannot double-post an answer.

---

### AddEventSpeakerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventSpeakersController.cs:29` · Level 0 · record class

- **What it is**: the POST body that links a speaker to an event. It carries exactly two ids, `EventId`
  and `SpeakerId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventSpeakersController.cs:29-36`).
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
  `EventSpeakersController.cs:177`) so the domain mints the link id. `[Rubric §9, API & Contract Design]`:
  every property is `required`, so an incomplete association is rejected at binding.
- **Walkthrough**: two `required {Alias} { get; init; }` members and nothing else; the doc comments name
  each role ("the event to add the speaker to", `EventSpeakersController.cs:31`).
- **Why it's built this way**: a dedicated two-field record per relationship (rather than a generic
  `AddAssociationRequest<TParent, TChild>`) keeps the schema and binding errors named after the real
  domain terms, the §9 readability win the codebase prefers over deduplication.
- **Where it's used**: `[FromBody]` on [`EventSpeakersController`](#eventspeakerscontroller)'s
  `CreateAsync` (`EventSpeakersController.cs:172-173`), gated class-level by
  `[HasPermission(ConferencePermissions.EventsManage)]` (`EventSpeakersController.cs:46`) and marked
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) (`:163`). A successful add evicts
  three output-cache tags, `conference:events`, `conference:speakers`, and `conference` (`:177`). It is
  the template the other join records ([`AddSessionSpeakerRequest`](#addsessionspeakerrequest),
  [`AddSessionCategoryItemRequest`](#addsessioncategoryitemrequest),
  [`AddSpeakerCategoryItemRequest`](#addspeakercategoryitemrequest)) repeat.

---

### AddRoomRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/RoomsController.cs:30` · Level 0 · record class

- **What it is**: the richest write record in the group. A [`Room`](group-17-conference-domain.md#room)
  is a child of an [`Event`](group-17-conference-domain.md#event), so the body carries the owning
  `EventId`, an optional explicit `RoomId`, the required `Name` and `Sort`, and four optional physical
  attributes: `Capacity`, `Floor`, `Location`, `AccessibilityInfo`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/RoomsController.cs:30-55`).
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
  (`RoomsController.cs:219-226`) and, on success, evicts the `conference:rooms` output-cache tag before
  returning `CreatedAtRoute` (`RoomsController.cs:233-237`).
- **Why it's built this way**: modeling capacity, floor, location, and accessibility as discrete optional
  columns (rather than a free-text blob) keeps room metadata queryable and the contract self-documenting.
- **Where it's used**: `[FromBody]` on [`RoomsController`](#roomscontroller)'s `CreateAsync`
  (`RoomsController.cs:214-215`), behind
  `[HasPermission(ConferencePermissions.RoomsManage)]` (`RoomsController.cs:91`) and marked
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) (`RoomsController.cs:213`).

---

### BatchEventQuestionAnswerItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventQuestionAnswersController.cs:41` · Level 0 · record class

- **What it is**: one answer line inside a batch feedback-form submission. It names the `QuestionId`
  being answered and the `AnswerValue` text
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventQuestionAnswersController.cs:41-48`).
  Unlike [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest) it carries no `EventId`: the
  parent event is named once, on the batch envelope, not repeated per line.
- **Depends on**: the `QuestionIdentifierType` alias plus BCL `string`. Consumed only by
  [`BatchAddEventQuestionAnswersRequest`](#batchaddeventquestionanswersrequest), whose `Answers` list is
  built from these.
- **Concept**: the per-item half of the batch write contract; see
  [`BatchAddEventQuestionAnswersRequest`](#batchaddeventquestionanswersrequest) for the envelope and the
  atomicity rule (BR-107).
- **Walkthrough**: two `required { get; init; }` properties, no methods.
  [`EventQuestionAnswersController.CreateBatchAsync`](#eventquestionanswerscontroller) projects each item
  into a `BatchEventQuestionAnswerItem` domain record
  (`request.Answers.Select(a => new BatchEventQuestionAnswerItem(a.QuestionId, a.AnswerValue))`,
  `EventQuestionAnswersController.cs:268`).
- **Why it's built this way**: keeping the item shape minimal (question plus answer, no event, no per-item
  id) mirrors that a batch submission is one form for one event, so the event id belongs on the envelope
  and the answer's own id is always minted by the domain, never supplied by the client.
- **Where it's used**: only inside `BatchAddEventQuestionAnswersRequest.Answers`
  (`EventQuestionAnswersController.cs:57`), see
  [`BatchAddEventQuestionAnswersRequest`](#batchaddeventquestionanswersrequest).

---

### BatchAddEventQuestionAnswersRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventQuestionAnswersController.cs:51` · Level 1 · record class

- **What it is**: the POST body for `CreateBatchAsync`, a whole event feedback form submitted in one
  call. It names the owning `EventId` and the list of
  [`BatchEventQuestionAnswerItemRequest`](#batcheventquestionansweritemrequest) answers, at most one per
  question
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventQuestionAnswersController.cs:51-58`).
- **Depends on**: the `EventIdentifierType` alias, `IReadOnlyList<T>` and
  [`BatchEventQuestionAnswerItemRequest`](#batcheventquestionansweritemrequest). Consumed by
  [`EventQuestionAnswersController`](#eventquestionanswerscontroller), which forwards it to
  `BatchAddEventQuestionAnswersCommand`.
- **Concept introduced, atomic multi-row upsert as one request.** `[Rubric §9, API & Contract Design]`:
  a feedback form has several questions, and the naive shape is one `POST` per answer, which leaves a
  half-submitted form on any single failure. BR-107 states the batch is applied atomically, every answer
  upserted under one transaction, so a refusal leaves nothing written and the client has no partial state
  to reconcile (doc comment at `EventQuestionAnswersController.cs:249-257`). `[Rubric
  §15, Best Practices & Code Quality]`: this is the same `[Idempotent]` replay contract as the single-answer
  create (`EventQuestionAnswersController.cs:259`), so a retried request with the same `Idempotency-Key`
  replays the stored response rather than re-applying the form.
- **Walkthrough**: two `required { get; init; }` properties, no methods. The controller maps `Answers` into
  domain items before dispatch (`EventQuestionAnswersController.cs:266-268`); see
  [`EventQuestionAnswersController`](#eventquestionanswerscontroller)'s walkthrough for the full call.
- **Why it's built this way**: naming the event once on the envelope, rather than on every line, keeps a
  multi-question form's request body from repeating the same id per line; the transactional-upsert
  semantics make retry-after-partial-failure a non-issue for the caller.
- **Where it's used**: `[FromBody]` on [`EventQuestionAnswersController`](#eventquestionanswerscontroller)'s
  `CreateBatchAsync` (`EventQuestionAnswersController.cs:260-261`), which is
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) (`:255`).
  [`BatchAddSessionQuestionAnswersRequest`](#batchaddsessionquestionanswersrequest) is its session-scoped
  sibling.

---

### UpdateEventQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventQuestionAnswersController.cs:61` · Level 0 · record class

- **What it is**: the PUT body for editing an event answer. It carries the owning `EventId` and the new
  `AnswerValue`, and deliberately drops `QuestionId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventQuestionAnswersController.cs:61-68`).
- **Depends on**: the `EventIdentifierType` alias plus BCL `string`. Consumed by
  [`EventQuestionAnswersController`](#eventquestionanswerscontroller), which forwards it to
  [`UpdateEventQuestionAnswerCommand`](group-18-conference-application.md#updateeventquestionanswercommand).
- **Concept**: the update half of the answer contract (see
  [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest)). Omitting `QuestionId` encodes an
  invariant: you can re-word an answer but not re-point it at a different question (that would be a delete
  and re-add). `UpdateAsync` uses the route `{id}` as the answer id
  (`new UpdateEventQuestionAnswerCommand(request.EventId, id, request.AnswerValue)`,
  `EventQuestionAnswersController.cs:285`) and returns `NoContent()` on success
  (`EventQuestionAnswersController.cs:288-290`).
- **Walkthrough**: two `required { get; init; }` properties, no methods.
- **Where it's used**: `[FromBody]` on [`EventQuestionAnswersController`](#eventquestionanswerscontroller)'s
  `UpdateAsync` (`EventQuestionAnswersController.cs:279-281`).

---

### UpdateRoomRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/RoomsController.cs:58` · Level 0 · record class

- **What it is**: the PUT body for editing a room. It is [`AddRoomRequest`](#addroomrequest) minus the
  explicit `RoomId`: the owning `EventId`, required `Name` and `Sort`, and the four optional physical
  attributes
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/RoomsController.cs:58-80`).
- **Depends on**: the `EventIdentifierType` alias plus BCL `string?`, `int`, `int?`. Consumed by
  [`RoomsController`](#roomscontroller), which forwards it to
  [`UpdateRoomCommand`](group-18-conference-application.md#updateroomcommand).
- **Concept**: the update half of the room contract (see [`AddRoomRequest`](#addroomrequest)); the room
  id comes from the route `{id}`. `UpdateAsync` spreads the seven body fields plus the route id into the
  command (`RoomsController.cs:247-256`), then evicts the `conference:rooms` tag before returning
  `NoContent()` (`RoomsController.cs:262-263`).
- **Walkthrough**: three `required` members plus four nullable optionals, no methods. Because every
  optional field is sent on every PUT, an omitted `Capacity` or `Floor` clears the stored value rather
  than leaving it untouched: this is a full replacement contract, not a patch.
- **Where it's used**: `[FromBody]` on [`RoomsController`](#roomscontroller)'s `UpdateAsync`
  (`RoomsController.cs:242-244`).

---

### EventQuestionAnswersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventQuestionAnswersController.cs:78` · Level 10 · class (sealed)

- **What it is**: the REST controller for event feedback answers (`/EventQuestionAnswers`). Unlike the
  public-catalog controllers in this group, **every** endpoint requires authentication (`[Authorize]`,
  `EventQuestionAnswersController.cs:77`), and the reads are **owner-scoped** by BR-8: organizers see every
  answer, everyone else sees only their own. The four read actions additionally fail closed
  (ADR-033) when a non-organizer caller carries no resolvable owner claim, answering 403 rather than an
  unscoped read or a 500.
- **Depends on**:
  [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (the read-only base, `EventQuestionAnswersController.cs:86`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:79`); four
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) injections for
  [`AddEventQuestionAnswerCommand`](group-18-conference-application.md#addeventquestionanswercommand),
  `BatchAddEventQuestionAnswersCommand`,
  [`UpdateEventQuestionAnswerCommand`](group-18-conference-application.md#updateeventquestionanswercommand)
  and [`RemoveEventQuestionAnswerCommand`](group-18-conference-application.md#removeeventquestionanswercommand)
  (`:80-83`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) and
  [`RoleNames`](group-24-identity-module.md#rolenames) for the scoping decision (`:84`);
  [`OwnershipHelper`](group-08-auth.md#ownershiphelper), which supplies all three ownership decisions:
  `GetOwnershipSpecification<TSpec, TId>` for the read scope (`:107-112`), `IsAdmin` for the export
  opt-in (`:119`) and `RequireResolvableOwner<TId>` for the fail-closed gate (`:135-143`);
  [`OwnedByUserSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ownedbyuserspecificationtentity-tidentifiertype)
  as the filter it builds; the [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute)
  on its create and its batch create; the
  [`EventQuestionAnswerDTO`](group-17-conference-domain.md#eventquestionanswerdto); its two single-answer
  request records [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest) and
  [`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest); and its batch request
  [`BatchAddEventQuestionAnswersRequest`](#batchaddeventquestionanswersrequest), which carries a list of
  [`BatchEventQuestionAnswerItemRequest`](#batcheventquestionansweritemrequest). Externals: ASP.NET
  Core MVC (`[ApiController]`, `[HttpGet]`, `[FromQuery]`), `Asp.Versioning`, `ILogger`, `ClaimTypes`.
- **Concept introduced, the framework read hook.** `[Rubric §11, Security]` assesses whether
  authorization is enforced server-side and whether results are scoped per caller rather than merely hidden
  in the UI; `[Rubric §1, SOLID]` and `[Rubric §15, Best Practices & Code Quality]` assess whether a rule has one home.
  The Common base exposes two hooks:
  `GetReadSpecificationAsync` (asynchronous, `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:571-573`)
  and its synchronous half `GetExportSpecification`
  (`EntityControllerBase.cs:601`), which the asynchronous one returns by default. **Every** read action
  calls the asynchronous hook once per request, before the first query: `GetAllAsync`
  (`EntityControllerBase.cs:116`), the paged overload (`:171`), `GetAllForLookupAsync` (`:324`),
  `GetByIdAsync` (`:368`) and `ExportAsync` (`:270`). This controller overrides the synchronous half,
  because the rule needs nothing awaited: `GetExportSpecification()` delegates to
  `OwnershipHelper.GetOwnershipSpecification<OwnedByUserSpecification<EventQuestionAnswer,
  EventQuestionAnswerIdentifierType>, UserIdentifierType>`, passing `ClaimTypes.NameIdentifier` as the
  owner claim, a factory that builds `new OwnedByUserSpecification<EventQuestionAnswer,
  EventQuestionAnswerIdentifierType>(userId)`, and `RoleNames.Organizer` as the bypass role
  (`EventQuestionAnswersController.cs:107-112`), which is the same helper shape Store's `OrdersController`
  and `ReviewsController` use and ADC's Engagement `AddModuleEngagementAPI` passes to
  `OwnerOrAdminFilter` (doc `:97-105`). The specification is composed into the *database query*, so
  the scoping happens in SQL, paging counts stay honest, and nothing is filtered out of an already-fetched
  page. Two consequences the base states explicitly: the specification never replaces the caller's own
  `filters` (the query service ANDs the two, so a caller can only narrow what the rule already allows,
  `EntityControllerBase.cs:554-560`), and a `GetById` the specification rejects answers **404, not 403**,
  because a "forbidden" would confirm the id exists (`EntityControllerBase.cs:561-565`). Because one
  hook override cannot itself prevent a missing owner claim from reaching the query as `null`, the four
  read actions carry a guard-plus-passthrough body rather than the pure passthrough an unguarded override
  would allow (`EventQuestionAnswersController.cs:107-112`, action bodies at `:145-199`).
- **Concept introduced, the fail-closed resolvable-owner gate.** `[Rubric §11, Security]` and
  `[Rubric §15, Best Practices & Code Quality]`: `GetExportSpecification()` returns `null` for two
  different reasons, an Organizer caller (scoping deliberately skipped) or a non-Organizer caller whose
  owner claim cannot be resolved, and only the first may read unscoped. A missing claim is an
  authorization answer, so `RequireResolvableOwner()` (`:135-143`) delegates to the framework's
  `OwnershipHelper.RequireResolvableOwner<UserIdentifierType>`, passing `ClaimTypes.NameIdentifier`,
  `RoleNames.Organizer` and the controller and entity names as the error source and target
  (`:136-141`). The helper succeeds when `IsAdmin(currentUserService, bypassRole)` holds or the claim
  parses, and otherwise fails with `Error.Forbidden` ("Access denied.")
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnershipHelper.cs:91-104`); the
  controller turns a failed result into `HandleFailure(gate.Errors)`, a 403, and a success into `null`
  so the read proceeds (`EventQuestionAnswersController.cs:141-143`). Because the helper checks the
  bypass role with the same `IsAdmin` that `GetOwnershipSpecification` uses (`OwnershipHelper.cs:46,
  101`), the gate and the scope agree on who is privileged (doc `:129-131`). This is the same 2026-08-31
  resolvable-owner rule ADR-033 states as Store's `OrdersController.RequireResolvableOwner`.
- **Concept introduced, closing the CSV export as a row-scoping bypass.** The base ships a streaming CSV
  endpoint, `ExportAsync` (`EntityControllerBase.cs:257`), whose remarks state that it carries no
  authorization attributes of its own and inherits whatever the concrete controller declares
  (`:207-211`). Its row scoping is **fail-closed** (`:231-238`): the rows are whatever the read hook
  allows, and when that hook resolves to `null` the export is refused with a 403 carrying
  `Export.RowScopeRequired` (`:487`, `:273-274`, `:608-612`) unless the controller opts in to whole-table
  exports through `AllowUnscopedExport`, which is `false` by default (`:508`). That null is ambiguous
  here for the same two reasons as the read gate, so this controller opts in only for the Organizer
  bypass: `AllowUnscopedExport => OwnershipHelper.IsAdmin(currentUserService, RoleNames.Organizer)`
  (`EventQuestionAnswersController.cs:119`, doc `:114-118`), and a non-Organizer with an unresolvable
  owner claim keeps the framework's 403. On top of that, `ExportAsync` is overridden to `Forbid()` unless
  `currentUserService.IsInRole(RoleNames.Organizer)`, then delegate to the base (`:207-222`, gate at
  `:216-219`). `[Rubric §30, Compliance/Privacy/Data Governance]` assesses whether personal data has a
  single governed exit path: feedback answers are attributable personal content, so bulk download stays
  with the role that already reads every row.
- **Concept introduced, atomic multi-row upsert as a batch endpoint.** `[Rubric §9, API & Contract
  Design]` and `[Rubric §29, Resilience & Business Continuity]`: a feedback form has several questions;
  `CreateBatchAsync` (`:260`) lets the client submit the whole form as one `[HttpPost("batch")]` call
  (`:258`) instead of one request per answer, so a mid-form failure never leaves a half-saved response for
  the client to reconcile (BR-107, doc `:249-257`). It is `[Idempotent]` (`:259`) with the same replay
  contract as the single-answer create: a retry carrying the same `Idempotency-Key` replays the stored
  response rather than re-applying the form. The action maps each
  [`BatchEventQuestionAnswerItemRequest`](#batcheventquestionansweritemrequest) into a domain
  `BatchEventQuestionAnswerItem` (`:266-268`) and dispatches one `BatchAddEventQuestionAnswersCommand`,
  so the atomicity guarantee lives in the handler's single transaction, not in the controller.
- **Walkthrough**
  - Primary-constructor injection (`EventQuestionAnswersController.cs:78-85`): query service, four
    command handlers (add, batch-add, update, remove), `ICurrentUserService`, logger. The base is
    constructed with `(queryService, logger)` (`:86`).
  - `GetExportSpecification()` (`:107-112`): the `OwnershipHelper` delegation described above, with the doc
    comment at `:88-106`.
  - `AllowUnscopedExport` (`:119`): the Organizer-only export opt-in, with the doc comment at `:114-118`.
  - `RequireResolvableOwner()` (`:135-143`): the fail-closed gate, with the doc comment at `:121-134`.
  - The four reads (`:145-199`) are guard-plus-passthrough: each calls `RequireResolvableOwner()` first and,
    if it returns non-null, returns that result instead of calling the base action. `GetAllAsync`
    (`:145-156`), the paged overload with the
    [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder) filter dictionary
    (`:158-174`), `GetAllForLookupAsync` (`:176-185`) and `GetByIdAsync` under the named route
    `"GetEventQuestionAnswerById"` (`:187-199`). Note the absence of any `[OutputCache]` attribute anywhere
    in the file: a per-caller response must never land in a shared cache entry, and the controller simply
    never opts in.
  - `ExportAsync` (`:207-222`): the organizer gate, `Forbid()` at `:218`, otherwise `base.ExportAsync(...)`
    at `:221`. Its doc comment carries the reasoning (`:201-206`).
  - `CreateAsync` (`:233`) carries `[HttpPost]` (`:231`) and `[Idempotent]` (`:232`), so a retried POST with
    the same `Idempotency-Key` replays the stored response instead of writing a second answer row; the doc
    comment records that the attribute is declared here because this create is hand-written rather than the
    base action (`:224-230`). It dispatches
    `new AddEventQuestionAnswerCommand(request.EventId, null, request.QuestionId, request.AnswerValue)`
    (`:238`), the `null` being the child id the domain mints, then `CreatedAtRoute` (`:243-246`).
  - `CreateBatchAsync` (`:260`) is the batch sibling of `CreateAsync`, described above; see
    [`BatchAddEventQuestionAnswersRequest`](#batchaddeventquestionanswersrequest).
  - `UpdateAsync` (`:279`) dispatches
    `new UpdateEventQuestionAnswerCommand(request.EventId, id, request.AnswerValue)` (`:285`) and returns
    `NoContent()` (`:290`).
  - `DeleteAsync` (`:295`) takes the parent `eventId` `[FromQuery]` (`:297`) because the route only carries
    the child id, dispatches `RemoveEventQuestionAnswerCommand(eventId, id)` (`:301`) and returns
    `NoContent()`. `[Rubric §9, API & Contract Design]`: none of the write records carries a
    `UserId`; identity comes from the authenticated principal and `CreatedBy` is stamped by the
    audit pipeline, never trusted from the client.
- **Why it's built this way**: BR-8 mandates that non-organizers see only their own answers, so the rule
  is expressed once as a specification injected into the query pipeline rather than as a filter applied
  after the fact, and ADR-033 mandates that the resolution of who "own" means fails closed (403) rather
  than crashing when the caller has no owner claim to resolve. Organizers bypass the scoping
  specification, the gate and the export refusal through the same `OwnershipHelper.IsAdmin` check, which
  is the shape every visibility rule in this group uses. The parent `EventId` travels on every write so
  the handler can load the [`Event`](group-17-conference-domain.md#event) aggregate and mutate the child
  through it; the batch endpoint exists because a feedback form is naturally one submission, not one
  request per question.
- **Where it's used**: hosted by the Conference service and reached through the YARP Gateway route
  `/EventQuestionAnswers/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:118`,
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)); the attendee
  feedback UI under `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/` is the
  client. [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller) is its exact
  session-scoped sibling (BR-9), built the same way. See
  [ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html) for the
  ownership-authorization rule and the resolvable-owner fail-closed addition.
- **Caveats / not-in-source**: the role gate on the export is belt-and-braces rather than the only
  scoping, since the hook filters the export too and the base refuses an unscoped export the controller
  has not opted in to. The base's remarks state that a controller which overrides the hook may relax
  such an interim role gate so an owner can export their own rows again
  (`EntityControllerBase.cs:595-599`); this controller keeps the gate, so an attendee cannot export their
  own answers at all. The override's gate reads `currentUserService.IsInRole(RoleNames.Organizer)`
  (`:216`) while the opt-in reads `OwnershipHelper.IsAdmin`, which compares `currentUserService.Role`
  (`OwnershipHelper.cs:21`). Whether keeping the gate is deliberate is not determinable from source.

---

### EventLifecycleController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventLifecycleController.cs:32` · Level 9 · class (sealed)

- **What it is**: the REST controller for an event's publication lifecycle: publish, unpublish, and the
  Sessionize refresh import. These three actions live here rather than on
  [`EventsController`](#eventscontroller), so the aggregate-root CRUD controller does not also own
  state-transition and external-import concerns.
- **Depends on**: `ApiControllerBase` (the bare API base, not the entity-aware `EntityControllerBase` the
  CRUD controllers derive from, because this controller has no query service and no DTO list to serve,
  `EventLifecycleController.cs:32,37`); three
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`PublishEventCommand`](group-18-conference-application.md#publisheventcommand),
  [`UnpublishEventCommand`](group-18-conference-application.md#unpublisheventcommand) and
  [`RefreshFromSessionizeCommand`](group-18-conference-application.md#refreshfromsessionizecommand)
  (`:33-35`); `IOutputCacheStore` (`:36`); the
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute) and
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute); and
  [`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto).
- **Concept introduced, conditional writes on a state transition.** `[Rubric §9, API & Contract Design]`
  assesses whether a contract expresses concurrency honestly. `PublishAsync` and `UnpublishAsync` take no
  body at all: they read the client's last-seen row version from the `If-Match` header through
  `SupportsIfMatchAttribute.RequiredToken(HttpContext)` (`:61, 94`), so a request with no header answers
  **428 Precondition Required** and never runs, and a stale token answers **412 Precondition Failed**
  ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html); both carry
  `[SupportsIfMatch]` at `:53, 86` and declare 409/412/428 as `[ProducesResponseType]` at `:54-56,
  87-89`). Both are also `[Idempotent]` (`:52, 85`), because publishing is a state assertion and
  replaying the stored response for a retried key is exactly what the caller meant (doc `:39-50, 74-83`).
  `[Rubric §29, Resilience & Business Continuity]`: `RefreshAsync` (`:107-152`) maps upstream trouble to
  retryable HTTP, an `Event.Sessionize.Throttled` error becoming `429` with a `Retry-After: 300` header
  (`:128-132`, BR-63) and `Event.Sessionize.Unavailable` becoming `502` (`:135-136`), so an upstream
  throttle reaches the client as a signal rather than a 500.
- **Walkthrough**
  - `PublishAsync` (`:51-72`) reads the required token (`:61`), dispatches
    `new PublishEventCommand(id, rowVersion)` (`:63-65`), evicts `conference:events` and the broad
    `conference` tag (`:70`) and returns `NoContent()`.
  - `UnpublishAsync` (`:84-105`) is the same shape: token (`:94`), `new UnpublishEventCommand(id,
    rowVersion)` (`:96-98`), evict the same two tags (`:103`), `NoContent()`.
  - `RefreshAsync` (`:107-152`) dispatches `new RefreshFromSessionizeCommand(id)` (`:121-123`); on failure
    it maps the two named Sessionize error codes to `429` (with `Retry-After: 300`, `:128-132`) and `502`
    (`:135-136`) before falling back to `HandleFailure` (`:125-139`); on success it evicts the six
    entity tags the import touches (events, sessions, speakers, categories, rooms, questions) plus the
    broad `conference` tag (`:141-150`) and returns `Ok(result.Value)` (`:151`).
  - The broad `conference` tag is the one every Conference output-cache policy carries
    (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:236-237, 267-284`), so evicting it
    also drops the entries of `ConferenceCache` and `ConferencePublicCache`, which carry no
    entity-specific tag (`Program.cs:237, 267`) and would otherwise serve the pre-transition event
    until their 5-minute TTL ran out.
- **Why it's built this way**: publish, unpublish and the Sessionize refresh are lifecycle operations on
  an already-created event, not CRUD, and none of them return an `EventDTO`; keeping them off
  [`EventsController`](#eventscontroller) keeps that controller to create/read/update/delete/export and
  keeps this one focused on state transitions and external synchronization, each with its own concurrency
  and error-mapping story.
- **Where it's used**: hosted by the Conference service behind the Gateway; reached from organizer tooling
  under `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Event/` that drives publish,
  unpublish and refresh. See
  [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html) for the conditional-write
  rule these two transitions share with [`EventsController.UpdateAsync`](#eventscontroller).

---

### EventSpeakersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventSpeakersController.cs:47` · Level 9 · class (sealed)

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
  the case the base's remarks describe (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:545-553`).
  Because that `null` is the base's signal for "no row scope", the controller also declares
  `AllowUnscopedExport => IsPrivileged` (`:90`, doc `:84-89`): the base's fail-closed CSV export refuses
  a null scope with 403 unless this opt-in holds
  (`EntityControllerBase.cs:273-274, 508`), so only the privileged audience may export the whole table.
  `[Rubric §12, Performance & Scalability]`: the reads are cached under the `EventsCache` policy (5-minute
  TTL, tags `conference` and `conference:events`,
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:268`), which is exactly why the writes
  must evict. That policy is a
  [`PublicEndpointOutputCachePolicy`](group-12-api-hosting-mapping.md#publicendpointoutputcachepolicy)
  registration and it bypasses the cache entirely for the privileged read audience
  ([ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html),
  `Program.cs:239-266`), which is what keeps an organizer's everything-inclusive payload out of the shared
  public entry.
- **Walkthrough**
  - `GetReadSpecificationAsync` (`EventSpeakersController.cs:72-82`) is the one place the rule lives; the
    doc comment above it says so, and says the read actions below are attribute-only passthroughs (`:60-71`).
  - `AllowUnscopedExport` (`:90`) is the export opt-in for the same privileged audience the hook exempts.
  - `GetAllAsync` (`:92-100`), the paged overload (`:102-115`), `GetAllForLookupAsync` (`:121-127`) and
    `GetByIdAsync` under the named route `"GetEventSpeakerById"` (`:129-138`) each carry
    `[AllowAnonymous]` + `[OutputCache(PolicyName = "EventsCache")]` and delegate to the base. The lookup's
    doc comment (`:117-120`) names the side channel the hook closes: without the shared scope, a dropdown
    would enumerate the names the list endpoint hides. The base forwards the specification's `Criteria`
    predicate as the lookup filter, because the lookup query has no specification parameter
    (`EntityControllerBase.cs:554-560`).
  - `ExportAsync` (`:146-161`) repeats the privileged-reader gate: `if (!IsPrivileged) return Forbid();`
    (`:155-158`), then `base.ExportAsync(...)` (`:160`). The doc comment states the leak an unscoped CSV
    would be: the junction rows of unpublished events, leaking exactly the existence the reads hide
    (`:140-145`).
  - `CreateAsync` (`:172`) is `[HttpPost]` (`:170`) and `[Idempotent]` (`:171`), dispatches
    `AddEventSpeakerCommand(request.EventId, null, request.SpeakerId)` (`:177`), returns `HandleFailure`
    on failure (`:180-183`), then evicts and returns `CreatedAtRoute("GetEventSpeakerById", ...)`
    (`:185-189`).
  - `DeleteAsync` (`:194`) reads the parent `eventId` `[FromQuery]` (`:196`), dispatches
    `RemoveEventSpeakerCommand(eventId, id)` (`:200`), evicts (`:208`) and returns `NoContent()`.
  - Both mutations evict **both** parents' tags plus the broad one:
    `EvictTagsAsync(cancellationToken, "conference:events", "conference:speakers", "conference")`
    (`:185, 208`). Note the ordering guard: the failure return happens before the eviction, so a rejected
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

### RoomsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/RoomsController.cs:92` · Level 9 · class (sealed)

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
  empty page instead of that event's rooms. The doc comments at `:106-118` and `:154-159` state exactly
  that contract. Compare [`SpeakersController`](#speakerscontroller), where `EventId` is *not* a column and
  the paged action must intercept the key by hand.
- **Concept introduced, output-cache eviction on mutation.** `[Rubric §12, Performance & Scalability]`
  assesses caching strategy: every read here is decorated `[OutputCache(PolicyName = "RoomsCache")]`
  (`RoomsController.cs:146,162,183,196`), so anonymous room reads are served from a 5-minute entry
  tagged `conference` and `conference:rooms`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:276`). The correctness half is
  eviction: each mutation ends by calling
  `outputCacheStore.EvictTagsAsync(cancellationToken, "conference:rooms")` (`:233, 262, 280`),
  invalidating exactly the room reads and nothing else; unlike the event controllers in this unit, the
  room writes do not evict the broad `conference` tag. `[Rubric §3, Clean Architecture]`: the eviction
  lives in the controller, not the command handler, because `IOutputCacheStore` is an ASP.NET concern the
  Application layer must not reference.
- **Walkthrough**
  - The class gate is `[HasPermission(ConferencePermissions.RoomsManage)]` (`RoomsController.cs:91`), a
    room-specific capability rather than the event one even though rooms hang off the event aggregate;
    each read re-opens with `[AllowAnonymous]`.
  - `AllowUnscopedExport => IsPrivileged` (`:138`, doc `:132-137`) opts the privileged audience in to a
    whole-table export, mirroring the hook's `null` for that audience.
  - `GetAllAsync` (`:144-152`), the paged overload (`:160-173`), `GetAllForLookupAsync` (`:181-187`) and
    `GetByIdAsync` under the named route `"GetRoomById"` (`:194-203`) are attribute-only passthroughs; the
    hook scopes all four. The doc comments carry the rules the code no longer restates per action: the
    paged one on AND composition (`:154-159`), the lookup on the closed side channel (`:175-180`), and
    `GetById` on the 404 answer, "not a redacted record, so a guessed id cannot confirm that an unannounced
    event exists or that a venue has been booked for it" (`:189-193`).
  - `CreateAsync` (`:214`) is `[HttpPost]` (`:212`) and `[Idempotent]` (`:213`), maps `AddRoomRequest` onto
    `AddRoomCommand` positionally (`:218-228`, note the optional client-supplied `RoomId` in slot two),
    returns `HandleFailure` on failure (`:230-231`), evicts (`:233`) and returns
    `CreatedAtRoute("GetRoomById", ...)` (`:234-237`).
  - `UpdateAsync` (`:242`) dispatches `UpdateRoomCommand` with the parent `EventId` from the body and the
    child id from the route (`:247-257`), evicts (`:262`) and returns `NoContent()` (`:263`).
  - `DeleteAsync` (`:268`) reads the parent `eventId` `[FromQuery]` (`:270`), dispatches
    `RemoveRoomCommand(eventId, id)` (`:274`), evicts (`:280`) and returns `NoContent()`.
  - All three mutations return `HandleFailure` *before* they evict (`:230, 259, 277`), so a failed command
    never disturbs the cache.
  - There is no `ExportAsync` override, and none is needed: the inherited action reads the same hook as the
    lists (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:270`), so
    the CSV shows exactly what the list shows. A privileged caller's `null` scope passes because of the
    opt-in above, while a non-privileged caller whose filter handler failed (also `null`) is refused with
    403 rather than served every room (`EntityControllerBase.cs:273-274`). The export stays behind the
    class-level `RoomsManage` capability because it carries no `[AllowAnonymous]` of its own.
- **Why it's built this way**: rooms are read far more than they are edited (venue maps, schedule grids),
  so caching the public reads is worth the eviction bookkeeping on the rare write. Scoping the reads
  through the Application-layer filter query rather than a controller-side join keeps persistence knowledge
  out of the boundary, the same division [`EventSpeakersController`](#eventspeakerscontroller) uses.
- **Where it's used**: the Conference service host behind the Gateway route `/Rooms/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:90`); consumed by the room-management UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Room/` and by any schedule view that
  resolves a session's room.

---

### EventsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/EventsController.cs:44` · Level 10 · class (sealed)

- **What it is**: the REST controller for the [`Event`](group-17-conference-domain.md#event) aggregate
  root (`/Events`). On top of the standard aggregate-root CRUD it adds visibility scoping, a gated CSV
  export, iCalendar export, and the "happening now / up next" snapshot. Publish, unpublish and the
  Sessionize refresh are a sibling controller's concern; see
  [`EventLifecycleController`](#eventlifecyclecontroller).
- **Depends on**:
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`EventsController.cs:54-55`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:45`); three [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`EventCreateRequest`](group-18-conference-application.md#eventcreaterequest),
  [`UpdateEventCommand`](group-18-conference-application.md#updateeventcommand) and
  [`DeleteEntityCommand`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  (`:46-48`); two [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)s for
  [`ExportEventCalendarQuery`](group-18-conference-application.md#exporteventcalendarquery) and
  [`GetNowNextQuery`](group-18-conference-application.md#getnownextquery) (`:49-50`);
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) with the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) helper (`:51`); `IOutputCacheStore`
  (`:52`); the [`PublishedEventSpecification`](group-18-conference-application.md#publishedeventspecification);
  the [`EventDTO`](group-17-conference-domain.md#eventdto),
  [`UpdateEventResult`](group-18-conference-application.md#updateeventresult),
  [`EventUpdateRequest`](group-18-conference-application.md#eventupdaterequest) and
  [`NowNextDTO`](group-17-conference-domain.md#nownextdto); the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute); and the
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute).
- **Concept introduced, business-rule visibility as a plain specification.** `[Rubric §11, Security]` and
  `[Rubric §3, Clean Architecture]`: BR-108 says non-privileged readers see only published events. The rule
  needs nothing awaited, so this controller overrides the *synchronous* hook:
  `GetExportSpecification()` returns `null` for a privileged reader
  (`currentUserService.IsPrivilegedConferenceReader()`, so a ContentEditor who reads every session can also
  read the events those sessions belong to) and a `new PublishedEventSpecification()` for everyone else
  (`EventsController.cs:69-70`, doc `:57-68`). The base then applies it to all five read actions, so the
  authorization predicate is a data specification the query service composes into SQL, not imperative
  post-filtering. The lookup doc comment (`:104-108`) names the side channel that closes: a draft event
  listed by name. Because the base's CSV export refuses a `null` scope unless the controller opts in
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:273-274, 508`),
  the controller declares `AllowUnscopedExport => currentUserService.IsPrivilegedConferenceReader()`
  (`EventsController.cs:77`, doc `:72-76`), the same audience the hook exempts. `ExportAsync`
  (`:134-149`) adds the imperative privileged-reader `Forbid()` on top (`:143-146`).
- **Concept introduced, lifecycle transitions live on a sibling controller.** `[Rubric §1, SOLID]` and
  `[Rubric §15, Best Practices & Code Quality]`: publish, unpublish and the Sessionize refresh are
  [`EventLifecycleController`](#eventlifecyclecontroller)'s actions, so this controller's surface is exactly
  create/read/update/delete/export plus the two read-only projections (`.ics` export, now-next), and the
  conditional-write (ADR-035) and Sessionize error-mapping (BR-63) concerns live with the actions that
  actually need them.
- **Walkthrough**
  - The reads (`:79-126`) attach `[AllowAnonymous]` + `[OutputCache(PolicyName = "EventsCache")]` and
    delegate to the base, which threads the published-event specification; `GetByIdAsync` carries the named
    route `"GetEventById"` (`:117`).
  - `ExportCalendarAsync` (`:151-166`) streams an `.ics` document via `File(...)` with the `text/calendar`
    content type and an `event-{id}.ics` file name (`:165`).
  - `GetNowNextAsync` (`:168-181`) and `GetCurrentNowNextAsync` (`:183-195`) serve the now/next snapshot for
    a given event or, with `new GetNowNextQuery(EventId: null)` (`:193`), for the current one; both use the
    short-TTL `NowNextCache` policy (60 seconds,
    `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:284`) because the payload changes with
    the clock. That policy is registered without the privileged-reader bypass, because the snapshot is
    identical for every role (`Program.cs:282-284`).
  - `CreateAsync` (`:197-211`) is an override marked `[Idempotent]` (`:203`), so a retried POST carrying
    the same `Idempotency-Key` is deduplicated; it calls `base.CreateAsync` then evicts
    `conference:events` alone (`:209`). The attribute is single-use, so declaring it here coincides with
    the inherited one instead of duplicating it (doc `:197-201`).
  - `UpdateAsync` (`:213-250`) reads the required token (`:231`), dispatches
    `new UpdateEventCommand(id, request, rowVersion)` (`:233-235`), appends a non-fatal `X-Warning` header
    when a timezone change leaves existing sessions semantically stale (BR-131, `:241-246`), evicts
    `conference:events` and the broad `conference` tag (`:248`) and returns `Ok(result.Value.Event)`
    (`:249`).
  - `DeleteAsync` (`:252-264`) additionally evicts `conference:sessions` and `conference:rooms`, plus the
    broad `conference` tag, because soft-deleting an event cascades to its children (`:261-262`). The
    broad tag is carried by every Conference cache policy (`Program.cs:236-237, 267-284`), so update and
    delete also drop the entries of the policies that carry no entity-specific tag; create does not.
- **Why it's built this way**: the base still owns the plain CRUD, so the event-specific behavior
  (scoping, export gating, calendar and now-next projections) reads as a flat list of extra actions.
  Keeping publish, unpublish and the Sessionize refresh on
  [`EventLifecycleController`](#eventlifecyclecontroller) keeps that operational nuance (conditional
  writes, upstream error mapping) at a boundary dedicated to it, while this controller's actions all
  return an `EventDTO` or a projection of one.
- **Where it's used**: the Conference service host behind the Gateway route `/Events/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:78`); the home-screen widget calls
  `now-next`, the public schedule UI
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicEventList.razor`) calls the
  reads and the `.ics` export, and organizer tooling under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Event/` reads and updates events and
  drives [`EventLifecycleController`](#eventlifecyclecontroller)'s publish, unpublish and refresh.

---

### AddSessionCategoryItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionCategoryItemsController.cs:29` · Level 0 · record class

- **What it is**: the POST body that tags a session with a category item: two ids, `SessionId` and
  `CategoryItemId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionCategoryItemsController.cs:29-36`).
- **Depends on**: the `SessionIdentifierType` / `CategoryItemIdentifierType` aliases. Consumed by
  [`SessionCategoryItemsController`](#sessioncategoryitemscontroller), which forwards it to
  [`AddSessionCategoryItemCommand`](group-18-conference-application.md#addsessioncategoryitemcommand).
- **Concept**: a join-entity write contract, identical in shape to
  [`AddEventSpeakerRequest`](#addeventspeakerrequest) (`[Rubric §4, DDD]`, cross-aggregate references by
  id); add plus delete only, no update. The controller passes `null` for the
  [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem) id
  (`new AddSessionCategoryItemCommand(request.SessionId, null, request.CategoryItemId)`,
  `SessionCategoryItemsController.cs:178`). `[Rubric §12, Performance & Scalability]`: because a tag change
  moves both the session and the category read models, a successful write evicts three output-cache tags,
  `conference:sessions`, `conference:categories`, and `conference`
  (`SessionCategoryItemsController.cs:186`).
- **Walkthrough**: two `required { get; init; }` id properties, no methods.
- **Where it's used**: `[FromBody]` on [`SessionCategoryItemsController`](#sessioncategoryitemscontroller)'s
  `CreateAsync` (`SessionCategoryItemsController.cs:173-174`), behind
  `[HasPermission(ConferencePermissions.SessionsManage)]` (`SessionCategoryItemsController.cs:47`) and
  marked [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) (`:164`).

---

### AddSessionQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionQuestionAnswersController.cs:28` · Level 0 · record class

- **What it is**: the session-scoped twin of [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest),
  the POST body for answering a feedback question against a session: `SessionId`, `QuestionId`,
  `AnswerValue`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionQuestionAnswersController.cs:28-38`).
- **Depends on**: the `SessionIdentifierType` / `QuestionIdentifierType` aliases plus BCL `string`.
  Consumed by [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller), which forwards it to
  [`AddSessionQuestionAnswerCommand`](group-18-conference-application.md#addsessionquestionanswercommand).
- **Concept**: user-owned write data behind authorization, exactly as in
  [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest) (`[Rubric §11, Security]`); the record
  carries no `UserId`, the controller is gated by a plain `[Authorize]`
  (`SessionQuestionAnswersController.cs:77`), and reads are scoped per user by BR-9 through the
  `GetExportSpecification` override (`SessionQuestionAnswersController.cs:96-97`). On add the controller
  passes `null` for the
  [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer) id
  (`SessionQuestionAnswersController.cs:238`).
- **Walkthrough**: three `required { get; init; }` properties, no methods. This is the *single-answer*
  path; the whole-form path uses
  [`BatchAddSessionQuestionAnswersRequest`](#batchaddsessionquestionanswersrequest) instead.
- **Where it's used**: `[FromBody]` on [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller)'s
  `CreateAsync` (`SessionQuestionAnswersController.cs:233-234`), marked
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) (`:166`).

---

### AddSessionSpeakerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionSpeakersController.cs:29` · Level 0 · record class

- **What it is**: the POST body that links a speaker to a session: `SessionId` plus `SpeakerId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionSpeakersController.cs:29-36`).
- **Depends on**: the `SessionIdentifierType` / `SpeakerIdentifierType` aliases. Consumed by
  [`SessionSpeakersController`](#sessionspeakerscontroller), which forwards it to
  [`AddSessionSpeakerCommand`](group-18-conference-application.md#addsessionspeakercommand).
- **Concept**: a join-entity write contract like [`AddEventSpeakerRequest`](#addeventspeakerrequest)
  (`[Rubric §4, DDD]`); add plus delete only. The controller passes `null` for the
  [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) id
  (`new AddSessionSpeakerCommand(request.SessionId, null, request.SpeakerId)`,
  `SessionSpeakersController.cs:178`). `[Rubric §12, Performance & Scalability]`: a successful add evicts
  the `conference:sessions` and `conference` output-cache tags
  (`SessionSpeakersController.cs:188`), and the code comment above that call states why: speaker
  assignment changes the cached session detail and list reads the speaker dashboard relies on
  (`SessionSpeakersController.cs:186-187`).
- **Walkthrough**: two `required { get; init; }` id properties, no methods.
- **Where it's used**: `[FromBody]` on [`SessionSpeakersController`](#sessionspeakerscontroller)'s
  `CreateAsync` (`SessionSpeakersController.cs:173-174`), behind
  `[HasPermission(ConferencePermissions.SessionsManage)]` (`SessionSpeakersController.cs:47`) and marked
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) (`:164`).

---

### BatchSessionQuestionAnswerItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionQuestionAnswersController.cs:41` · Level 0 · record class

- **What it is**: one line item inside a batch feedback submit: the `QuestionId` being answered and the
  `AnswerValue` text
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionQuestionAnswersController.cs:41-48`).
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
  (`SessionQuestionAnswersController.cs:268`), the same one-line manual hop from wire type to application
  type that the single-answer path performs field by field.
- **Why it's built this way**: the API keeps its own element record rather than binding directly to the
  application-layer `BatchSessionQuestionAnswerItem`, so the HTTP contract and the command stay
  independently versionable, the ADR-001 manual-mapping stance applied to a nested type.
- **Where it's used**: only as the element type of
  [`BatchAddSessionQuestionAnswersRequest`](#batchaddsessionquestionanswersrequest)`.Answers`
  (`SessionQuestionAnswersController.cs:57`).

---

### UpdateSessionQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionQuestionAnswersController.cs:61` · Level 0 · record class

- **What it is**: the session-scoped twin of
  [`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest): the PUT body carrying the
  owning `SessionId` and the new `AnswerValue`, dropping `QuestionId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionQuestionAnswersController.cs:61-68`).
- **Depends on**: the `SessionIdentifierType` alias plus BCL `string`. Consumed by
  [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller), which forwards it to
  [`UpdateSessionQuestionAnswerCommand`](group-18-conference-application.md#updatesessionquestionanswercommand).
- **Concept**: identical to [`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest); the
  answer id is the route `{id}`
  (`new UpdateSessionQuestionAnswerCommand(request.SessionId, id, request.AnswerValue)`,
  `SessionQuestionAnswersController.cs:285`).
- **Walkthrough**: two `required { get; init; }` properties, no methods.
- **Where it's used**: `[FromBody]` on [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller)'s
  `UpdateAsync` (`SessionQuestionAnswersController.cs:279-281`).

---

### BatchAddSessionQuestionAnswersRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionQuestionAnswersController.cs:51` · Level 1 · record class

- **What it is**: the POST body for `/SessionQuestionAnswers/batch`, the endpoint that submits a whole
  session feedback form in one call. It is an envelope: the `SessionId` being answered plus an
  `IReadOnlyList<BatchSessionQuestionAnswerItemRequest> Answers`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionQuestionAnswersController.cs:51-58`).
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
  (`SessionQuestionAnswersController.cs:266-270`).
- **Walkthrough**
  - Two `required { get; init; }` members: `SessionId` (`:52`) and `Answers` (`:55`), whose doc comment
    states the shape rule directly, "at most one per question".
  - `CreateBatchAsync` (`SessionQuestionAnswersController.cs:260`) is `[HttpPost("batch")]` (`:192`) and
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
  saved state to reconcile" (`SessionQuestionAnswersController.cs:249-252`). The alternative, letting the
  UI POST each answer separately, would leave a half-saved form behind on any mid-flight failure and would
  cost one round trip per question.
- **Where it's used**: `[FromBody]` on `CreateBatchAsync` only
  (`SessionQuestionAnswersController.cs:261`); consumed by the attendee session-feedback form.
- **Caveats / not-in-source**: this controller has no `IOutputCacheStore` injection and no
  `EvictTagsAsync` call anywhere, so whether the batch invalidates the ASP.NET Core *output* cache (as
  opposed to the application cache reached through `ICacheInvalidating`) is not determinable from this
  file.

---

### SessionCalendarController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionCalendarController.cs:26` · Level 5 · class (sealed)

- **What it is**: a single-endpoint controller that exports one public session as an iCalendar (`.ics`)
  document for the add-to-calendar affordance (ADR-042 Wave 5). It is anonymous and output-cached like the
  other public Sessions reads.
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (for the
  `HandleFailure` Result-to-Problem-Details mapping); one
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`ExportSessionCalendarQuery`](group-18-conference-application.md#exportsessioncalendarquery)
  (`SessionCalendarController.cs:26`); [`Result`](group-01-result-error-handling.md#result); ASP.NET Core
  `[AllowAnonymous]` and `[OutputCache]`; BCL `System.Text.Encoding` and `System.Globalization.CultureInfo`.
- **Walkthrough**: `ExportCalendarAsync` (`:36-44`) dispatches `ExportSessionCalendarQuery(id)` to the
  handler (`:40`) and, on success, returns a `File(...)` result carrying the UTF-8 bytes of the generated
  `.ics` text under content type `"text/calendar"`, with a `session-{id}.ics` filename built with
  `CultureInfo.InvariantCulture` (`:43`); a failed result maps through `HandleFailure` (`:41-42`). The
  action is `[HttpGet("{id}/ics")]`, `[AllowAnonymous]`, and `[OutputCache(PolicyName = "SessionsCache")]`
  (`:33-35`).
- **Why it's built this way**: this endpoint used to be a method on
  [`SessionsController`](#sessionscontroller); it was split out into its own single-purpose controller so
  the calendar export has its own route and dependency surface rather than adding one more handler to an
  already large aggregate-root controller.
- **Where it's used**: the add-to-calendar affordance on the public schedule UI.
- **Caveats / not-in-source**: whether the split from `SessionsController` changed the public route path is
  not determinable from this file alone; both controllers apply the same `SessionsCache` output-cache
  policy.

### SessionSelectionController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionSelectionController.cs:33` · Level 5 · class (sealed partial)

- **What it is**: a **decision-support** controller for choosing which submitted sessions to accept,
  gated class-level by
  [`[HasPermission(ConferencePermissions.SessionSelectionManage)]`](group-08-auth.md#haspermissionattribute)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionSelectionController.cs:32`),
  a capability the content-curation subset deliberately excludes (`SessionSelectionManage` is in
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions)`.All` but absent from its
  `ContentManagement` subset, so a content-editor role granted `ContentManagement` cannot reach it:
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:30,50-63,70-79`;
  the concrete role-to-permission grants live in the module's registration, not in this file). It exposes
  four read endpoints (composite dashboard, category distribution, speaker overlap, content similarity)
  plus one endpoint that **schedules** AI scoring of an event's sessions on the framework's durable
  internal-command processor.
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (for the
  `HandleFailure` Result-to-Problem-Details mapping, `SessionSelectionController.cs:41`); the
  [`HasPermission`](group-08-auth.md#haspermissionattribute) attribute plus the
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) catalog; four
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  injections (`SessionSelectionController.cs:34-37`);
  [`IInternalCommandScheduler`](group-14-module-system-composition.md#iinternalcommandscheduler) (`:38`); a
  BCL `TimeProvider` (`:39`), used to stamp the scheduled command with the request instant;
  [`Result`](group-01-result-error-handling.md#result) and
  [`Error`](group-01-result-error-handling.md#error); the decision-support DTOs
  ([`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto),
  [`CategoryDistributionDTO`](group-17-conference-domain.md#categorydistributiondto),
  [`SpeakerSessionOverlapDTO`](group-17-conference-domain.md#speakersessionoverlapdto),
  [`ContentSimilarityDTO`](group-17-conference-domain.md#contentsimilaritydto)); the
  [`NonIdempotentAttribute`](group-12-api-hosting-mapping.md#nonidempotentattribute); a `FeatureGate`
  attribute gating on
  [`ConferenceFeatures`](group-17-conference-domain.md#conferencefeatures)`.SessionScoring`
  (`SessionSelectionController.cs:126`); BCL `ILogger` (`:40`) and ASP.NET Core `[OutputCache]`.
- **Concept introduced, moving long work off the request path onto a durable command processor (ADR-114).**
  `[Rubric §9, API & Contract Design]` (a focused, capability-scoped surface that answers with honest
  status codes) and `[Rubric §29, Resilience & Business Continuity]`. `ScoreSessionsAsync`
  (`SessionSelectionController.cs:129`) is **async**: it awaits
  `internalCommandScheduler.ScheduleAsync(new ScoreEventSessionsInternalCommand(eventId, timeProvider.GetUtcNow().UtcDateTime), ...)`
  (`:133-137`), a durable
  [`ScoreEventSessionsInternalCommand`](group-18-conference-application.md#scoreeventsessionsinternalcommand)
  scheduled through the framework's internal-command processor rather than the earlier in-process channel.
  The injected `TimeProvider` stamps the command with the request instant, so a trigger queued behind an
  already-running pass is claimed once that pass ends, and the pass that claims it skips every session
  already scored since the request rather than since the claim (`:112-113`). A schedule failure returns
  `HandleFailure(scheduled.Errors)` (`:139-142`); otherwise the action logs and returns `Accepted()` (202)
  (`:144-145`). Unlike the earlier design there is no 409 conflict path at the API edge: duplicate
  scheduling is absorbed by the durable handler's own per-event claim rather than refused here, so only
  `[ProducesResponseType(StatusCodes.Status202Accepted)]` is declared (`:128`).
  `[Rubric §31, Cost/FinOps]` assesses whether spend is bounded by design rather than by hope: the action's
  own doc comment records that a duplicate trigger costs nothing but a row, because the handler takes a
  per-event claim before it starts, so a second pass for an event already being scored logs and completes
  instead of paying for the same Anthropic calls twice (`:109-111`). `[Rubric §13, Observability &
  Operability]` (structured, source-generated logging): the class is `partial` and declares one
  `[LoggerMessage]` method, `LogScoringQueued` (`:148-149`), a compile-time generated, allocation-light log
  call. `[Rubric §12, Performance & Scalability]`: all four read endpoints carry
  `[OutputCache(PolicyName = "ConferenceCache")]` (`:46, 60, 74, 88`).
- **Concept, opting *out* of idempotency with a written reason.** `[Rubric §9, API & Contract Design]`. Every
  other hand-written POST in this group is marked `[Idempotent]`; `ScoreSessionsAsync` is marked
  [`[NonIdempotent]`](group-12-api-hosting-mapping.md#nonidempotentattribute) instead, and the attribute
  takes a mandatory justification string that is spelled out inline (`SessionSelectionController.cs:127`):
  scheduling is cheap and self-deduplicating, because the durable handler takes a per-event claim and skips
  a pass another replica is already running, so replaying the trigger costs one row rather than a second
  paid scoring run; caching the 202 instead would report acceptance for a request that never reached the
  queue, hiding a schedule failure the caller has to act on. The opt-out is a declared, reviewable decision
  in the source rather than a silently missing attribute.
- **Concept, a feature gate on a scheduled (not inline) command.** `[Rubric §9, API & Contract Design]`.
  `ScoreSessionsAsync` also carries `[FeatureGate(ConferenceFeatures.SessionScoring)]`
  (`SessionSelectionController.cs:126`), which mirrors the Sessionize refresh trigger's use of the same
  attribute, but for a different reason: because this action only *schedules* the command, the
  framework's `FeatureGateCommandDecorator` (which would otherwise short-circuit the command inline with a
  `NotFound` failure) does not run until the durable processor picks the job up minutes later. Without the
  action-level gate an organizer who had switched the pass off would still be told `202 Accepted` for work
  that is about to be refused. The gate covers only the scoring pass itself; the dashboard and any scores
  already stored stay readable with the flag off (doc comment at `:115-123`).
- **Walkthrough**
  - Primary-constructor injection of the four query handlers, the internal-command scheduler, the time
    provider, and the logger (`SessionSelectionController.cs:33-40`); the base is
    [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (`:41`).
  - Each read action follows the same shape: dispatch the query, then
    `result.IsFailure ? HandleFailure(result.Errors) : Ok(result.Value)`. `GetDashboardAsync` (`:47`),
    `GetCategoryDistributionAsync` (`:61`), `GetSpeakerOverlapAsync` (`:75`), and
    `GetContentSimilarityAsync` (`:89`, which takes a `minimumSimilarity = 0.3` threshold query
    parameter, `:91`).
  - `ScoreSessionsAsync` (`:129`) is the only write, and the only `async` action on the controller: it
    builds the command with `timeProvider.GetUtcNow().UtcDateTime` (`:135`), awaits the schedule call and
    `.ConfigureAwait(false)`s it (`:133-137`) before checking `scheduled.IsFailure` (`:139`).
- **Why it's built this way**: an earlier revision ran the scoring pass through an in-process, channel-based
  queue owned by this module; ADR-114 replaces that in-process design with the framework's internal-command
  processor, a durable job queue that survives a deploy or scale-in instead of losing an in-flight run. The
  dedup mechanics moved with it: instead of the API layer refusing a second request with 409 while a run is
  pending, the durable handler itself takes a per-event claim, so a second trigger for an event already
  being scored is a cheap no-op rather than a rejected request.
- **Where it's used**: mounted by the Conference service's controller registration and consumed by the
  organizer session-selection UI page. The scheduled work is executed by the
  [`ScoreEventSessionsInternalCommand`](group-18-conference-application.md#scoreeventsessionsinternalcommand)
  handler (Conference Application group), driven by the framework's internal-command processing pipeline
  rather than a module-owned hosted worker.
- **Caveats / not-in-source**: the durability and delivery guarantees of
  [`IInternalCommandScheduler`](group-14-module-system-composition.md#iinternalcommandscheduler) are the
  Module System & Composition group's concern, not this controller's; this file only schedules the command
  and reports whether scheduling itself succeeded. This controller does no output-cache eviction of its
  own, so when a scoring pass finishes, whether the `ConferenceCache` entries above are refreshed is not
  determinable from this file.

### SessionCategoryItemsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionCategoryItemsController.cs:48` · Level 10 · class (sealed)

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
  scoping cannot be bypassed by asking for the file instead of the page. Because the hook returns `null`
  for exactly the privileged audience, the controller overrides `AllowUnscopedExport => IsPrivileged`
  (`:91`): the framework's export is fail-closed (the base property defaults to `false` at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:508`, and a `null`
  scope without that opt-in is refused with a 403 at `:273-274`), so only a privileged reader may take the
  unscoped table.
- **Walkthrough**: four `[AllowAnonymous]` + `[OutputCache(PolicyName = "SessionsCache")]` read
  passthroughs (`SessionCategoryItemsController.cs:93,103,122,130`, the last carrying the named route
  `"GetSessionCategoryItemById"`), all scoped by the hook. `ExportAsync` (`[HttpGet("export")]` at `:147`)
  returns `Forbid()` for a non-privileged caller (`:158`) and otherwise delegates to the base.
  `CreateAsync` (`[HttpPost]` at `:171`, `[Idempotent]` at `:172`) dispatches
  `AddSessionCategoryItemCommand(request.SessionId, null, request.CategoryItemId)` (`:178`), evicts
  (`:186`) and returns `CreatedAtRoute("GetSessionCategoryItemById", ...)` (`:187-190`); `DeleteAsync`
  (`[HttpDelete("{id}")]` at `:194`) reads the parent `sessionId` `[FromQuery]` (`:197`), dispatches
  `RemoveSessionCategoryItemCommand(sessionId, id)` (`:201`), evicts (`:209`) and returns `NoContent()`
  (`:210`). Both evictions clear `conference:sessions`, `conference:categories` and `conference`
  (`:186, 209`).
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
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionQuestionAnswersController.cs:78` · Level 10 · class (sealed)

- **What it is**: the REST controller for a session's answered feedback questions
  (`/SessionQuestionAnswers`). It is the session-scoped sibling of
  [`EventQuestionAnswersController`](#eventquestionanswerscontroller): every endpoint requires
  authentication and the reads are owner-scoped, so an attendee sees only their own answers and an
  organizer sees all (BR-9). It adds one endpoint its event-side twin does not have: a batch submit for a
  whole feedback form.
- **Depends on**:
  [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (`SessionQuestionAnswersController.cs:86`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:79`); four [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`AddSessionQuestionAnswerCommand`](group-18-conference-application.md#addsessionquestionanswercommand),
  [`BatchAddSessionQuestionAnswersCommand`](group-18-conference-application.md#batchaddsessionquestionanswerscommand),
  [`UpdateSessionQuestionAnswerCommand`](group-18-conference-application.md#updatesessionquestionanswercommand)
  and
  [`RemoveSessionQuestionAnswerCommand`](group-18-conference-application.md#removesessionquestionanswercommand)
  (`:80-83`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) with
  [`RoleNames`](group-24-identity-module.md#rolenames) for the scoping decision (`:84`);
  [`OwnershipHelper`](group-08-auth.md#ownershiphelper) (`:108, 119, 136`) and
  [`OwnedByUserSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ownedbyuserspecificationtentity-tidentifiertype);
  the [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute); the
  [`SessionQuestionAnswerDTO`](group-17-conference-domain.md#sessionquestionanswerdto); and its four
  request records [`AddSessionQuestionAnswerRequest`](#addsessionquestionanswerrequest),
  [`BatchSessionQuestionAnswerItemRequest`](#batchsessionquestionansweritemrequest),
  [`BatchAddSessionQuestionAnswersRequest`](#batchaddsessionquestionanswersrequest) and
  [`UpdateSessionQuestionAnswerRequest`](#updatesessionquestionanswerrequest) (`:26-66`).
- **Concept introduced, the atomic batch write.** Owner-scoped reads and the organizer-only export gate
  are taught at [`EventQuestionAnswersController`](#eventquestionanswerscontroller); what is new here is
  `CreateBatchAsync` (`:258-275`), a `POST /batch` that applies a whole feedback form in one call.
  `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §9, API & Contract Design]`: the action maps the request
  items onto [`BatchSessionQuestionAnswerItem`](group-18-conference-application.md#batchsessionquestionansweritem)
  values with a collection expression (`:266-268`) and dispatches a single command, so the transaction
  boundary is the whole form. Its doc comment states the contract the client can rely on: every answer is
  upserted (BR-107) under one transaction, so a refusal leaves nothing written and the client has no
  partially saved state to reconcile (`:249-257`). It carries `[Idempotent]` (`:259`) for the same reason
  the single-answer create does. `[Rubric §12, Performance & Scalability]`: one round trip and one
  transaction replace one per question.
- **Concept introduced, the fail-closed owner gate (ADR-033, the 2026-08-31 resolvable-owner rule).**
  `[Rubric §11, Security]`. `GetExportSpecification()` (`:107-112`) is resolved through
  [`OwnershipHelper.GetOwnershipSpecification<TSpec, TId>`](group-08-auth.md#ownershiphelper) rather than a
  hand-rolled bypass ternary, the same shape ADR-033 prescribes and the one Store's `OrdersController` and
  `ReviewsController` use; ADC's vocabulary (the owner claim and the `Organizer` bypass role) is passed in.
  The owner claim is `ClaimTypes.NameIdentifier`, where the JWT bearer handler maps the token's `sub`.
  `GetExportSpecification()` returns `null` for two different reasons: the caller is an Organizer (scoping
  deliberately skipped) or the caller is a non-Organizer whose owner claim cannot be resolved, and only the
  first may read unscoped. A missing claim is an authorization answer, so the private
  `RequireResolvableOwner()` (`:135-143`) delegates to the framework's
  `OwnershipHelper.RequireResolvableOwner<UserIdentifierType>`, passing the same
  `ClaimTypes.NameIdentifier` claim and `Organizer` bypass role (`:136-141`), and turns a failed gate into
  a 403 through `HandleFailure(gate.Errors)` (`:142`); it returns `null` otherwise, letting the read
  proceed. Because the gate and the scope read the bypass role the same way, they agree on who is
  privileged. The export side follows the same split: `AllowUnscopedExport` (`:119`) is
  `OwnershipHelper.IsAdmin(currentUserService, RoleNames.Organizer)`, the check the hook itself uses, so
  only the Organizer bypass may take the unscoped table while a non-Organizer with an unresolvable claim
  keeps the framework's fail-closed 403
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:273-274`).
- **Walkthrough**
  - The class is gated with a bare `[Authorize]` (`:75`), so no endpoint here is anonymous.
    `GetExportSpecification()` (`:107-112`) is the framework's synchronous read hook (the rule needs
    nothing awaited), so every read action (list, paged, lookup, by-id) is scoped from this one place and
    another attendee's answer is a 404 rather than a redacted record. This is a distinct posture from the
    other session-scoped child controllers, whose reads are anonymous and filtered by the *parent's*
    visibility rather than by ownership.
  - The four reads (`:145-199`) are guard-plus-passthrough: each first calls `RequireResolvableOwner()`
    (for example `:152`), returns that 403 `ObjectResult` if it is non-null, and otherwise falls through to
    the inherited base action. `GetByIdAsync` runs under the named route `"GetSessionQuestionAnswerById"`
    (`:187`). As with its event-side twin, no read carries an `[OutputCache]` attribute, because a
    per-caller payload must never enter a shared cache entry.
  - `ExportAsync` (`:207-222`) returns `Forbid()` unless the caller is an organizer (`:216-219`), the BR-9
    form of the row-scoping bypass gate, with the reasoning in its doc comment (`:201-206`).
  - `CreateAsync` (`:231-247`) is `[Idempotent]` (`:232`) and dispatches
    `AddSessionQuestionAnswerCommand(request.SessionId, null, request.QuestionId, request.AnswerValue)`
    (`:238`), then `CreatedAtRoute` (`:243-246`).
  - `UpdateAsync` (`:278-291`) dispatches
    `UpdateSessionQuestionAnswerCommand(request.SessionId, id, request.AnswerValue)` (`:285`) and returns
    `NoContent()`. `DeleteAsync` (`:294-307`) reads the parent `sessionId` `[FromQuery]` (`:297`) and
    dispatches `RemoveSessionQuestionAnswerCommand(sessionId, id)` (`:301`).
- **Why it's built this way**: answers are personal feedback, so the read surface cannot be public;
  scoping by specification keeps the authorization rule in one place and lets the query service compose it
  into the database query rather than filtering in memory. Mirroring the event-side controller line for
  line is deliberate: two rules (BR-8 and BR-9) with the same shape get the same implementation, export
  gate and replay contract included. Routing the fail-closed check through the shared
  [`OwnershipHelper`](group-08-auth.md#ownershiphelper) rather than a local ternary keeps ADC's controllers
  on the same resolvable-owner rule as Store's, so a missing claim answers 403 everywhere it is checked,
  not just here. The batch endpoint exists because a feedback form is answered as a unit, not one question
  at a time.
- **Where it's used**: the Conference service host behind the Gateway route
  `/SessionQuestionAnswers/{**catch-all}` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:114`);
  consumed by the attendee feedback UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/` and by organizer reporting
  screens.

---

### SessionsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionsController.cs:44` · Level 10 · class (sealed)

- **What it is**: the REST controller for the [`Session`](group-17-conference-domain.md#session) aggregate
  root (`/Sessions`). Aggregate-root CRUD plus a cross-source visibility filter (BR-132 / BR-49), a virtual
  `SpeakerId` filter, a gated CSV export, an out-of-range warning header (BR-86), idempotent create and a
  conditional update.
- **Depends on**:
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`SessionsController.cs:55-56`); **two**
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)s
  (one for `Session`, one for `Event` so create can re-read the parent, `:45, 49`); the
  [`SessionCreateRequest`](group-18-conference-application.md#sessioncreaterequest) create handler, the
  [`UpdateSessionCommand`](group-18-conference-application.md#updatesessioncommand) update handler and a
  [`DeleteEntityCommand`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype) delete
  handler (`:46-48`); two
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)s for
  [`GetPublicSessionFilterQuery`](group-18-conference-application.md#getpublicsessionfilterquery) and
  [`GetSessionsBySpeakerFilterQuery`](group-18-conference-application.md#getsessionsbyspeakerfilterquery)
  (`:50-51`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) with the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) helper (`:52, 59`); `IOutputCacheStore`
  (`:53`); the [`SessionDTO`](group-17-conference-domain.md#sessiondto),
  [`UpdateSessionResult`](group-18-conference-application.md#updatesessionresult),
  [`SessionUpdateRequest`](group-18-conference-application.md#sessionupdaterequest) and
  [`EventDTO`](group-17-conference-domain.md#eventdto) (the
  [`ExportSessionCalendarQuery`](group-18-conference-application.md#exportsessioncalendarquery) handler
  lives on [`SessionCalendarController`](#sessioncalendarcontroller), not here); the
  [`SpecificationExtensions`](group-03-querying-specifications.md#specificationextensions) `And` composer
  yielding an
  [`AndSpecification`](group-03-querying-specifications.md#andspecificationtentity-tidentifiertype); the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute); and the
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute).
- **Concept introduced, a cross-source visibility specification.** `[Rubric §8, Data Architecture]` and
  `[Rubric §7, Microservices Readiness]`: BR-132 / BR-49 hides non-accepted sessions and the sessions of
  unpublished events from non-privileged readers, but a `Session` can live in one data source while its
  parent `Event`'s published flag lives in another (the doc comment at `SessionsController.cs:61-66` names
  Session in Cosmos and Event in SQL Server at `:64`, the polyglot option of
  [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). Rather than a
  cross-database join, `GetReadSpecificationAsync` (`:75-85`) delegates to the `GetPublicSessionFilterQuery`
  handler, which uses the framework's cross-source specification helper to produce a
  [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype)
  the query service can apply; privileged readers get `null`. Because that `null` means "privileged", the
  controller overrides `AllowUnscopedExport => IsPrivileged` (`:93`), opting exactly that audience in to
  the unscoped table under the framework's fail-closed export (default `false` at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:508`, refusal at
  `:273-274`).
  `[Rubric §12, Performance & Scalability]`: reads are `[OutputCache(PolicyName = "SessionsCache")]`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:274`) and the default sort is the
  single-column `nameof(SessionDTO.StartsAt)` constant (`:141`), sorting the schedule chronologically. The
  comment above it (`:138-140`) records why it is one column rather than the earlier comma-joined string:
  `QueryFieldService` resolves a sort column against the entity's own properties, so a comma-joined
  `"StartsAt,RoomId"` value matches none of them and silently falls back to the framework's `Id` tie-break
  instead of sorting by room; sessions that share a start time now fall through to that same `Id` tie-break
  rather than to a secondary room sort.
- **Walkthrough**
  - `BuildPagedSessionSpecificationAsync` (`SessionsController.cs:113-136`, doc and remarks `:95-112`) is
    the paged read's specification builder: it starts from the hook (`:117`), then intercepts and removes
    the virtual `SpeakerId` filter key (`Session` has no such column, `:119-124`), resolves it through
    `GetSessionsBySpeakerFilterQuery` (`:126-128`) and **ANDs** the two with
    `publicSpecification.And(...)` (`:133-135`). As in [`SpeakersController`](#speakerscontroller),
    substitution would leak non-accepted sessions, and an unparseable value or a failed handler result
    simply drops the scope (`:119-124, 130-131`).
  - `GetAllAsync` (`:146-167`) keeps a body only to apply the default sort: it queries with the hook's
    specification (`:156`), `DefaultSortColumn` (`:158`) and `pageSize: MaxPageSize` (`:162`). The paged
    overload (`:172-210`) clamps the page size (`:183`), defaults the sort when none was supplied
    (`:185-189`), calls the builder above (`:195`) and writes the `X-Pagination` header (`:208`).
  - `GetAllForLookupAsync` (`:221-224`) and `GetByIdAsync` (`:233-239`) are attribute-only passthroughs;
    the base applies the same hook, so a hidden session is a 404 there (doc `:212-217` and `:226-229`).
  - `ExportAsync` (`:248-262`) is the same bypass gate the other row-scoped controllers use: `Forbid()` for
    a non-privileged caller (`:256-259`), otherwise the base (`:261`). Its doc comment spells out what an
    unscoped CSV would hand over: the whole catalog, "declined and draft-event sessions included"
    (`:241-246`). The single-session iCalendar export lives on its own controller,
    [`SessionCalendarController`](#sessioncalendarcontroller).
  - `CreateAsync` (`:271-299`) is an override marked `[Idempotent]` (`:270`) that calls
    `CreateHandler.HandleAsync` directly (`:275`) rather than `base.CreateAsync`, because it needs the
    typed [`Result`](group-01-result-error-handling.md#result) in order to run the BR-86 check: when the
    request set start or end times, it re-reads the parent event and appends a non-fatal `X-Warning` header
    if the session falls outside the event's date range (`:282-295`). Note that the parent re-read
    pattern-matches the widened query result with `eventResult.Value is EventDTO evt` (`:289`) rather than
    a dynamic member access, because `IEntityQueryService` widens its return to `object` for field
    projection, so the controller narrows it back with a type pattern (the reason is written into the
    comment at `:284-285`).
  - `UpdateAsync` (`:314-336`) carries `[SupportsIfMatch]` (`:310`) with the 409/412/428
    `[ProducesResponseType]` triple (`:311-313`), reads the required token (`:319`), dispatches
    `new UpdateSessionCommand(id, request, rowVersion)` (`:322`), surfaces the same BR-86 warning from
    `result.Value!.HasDateRangeWarning` (`:329`) and returns `Ok(result.Value.Session)` (`:335`).
    `DeleteAsync` (`:340-347`) calls the base and evicts.
  - Every mutation ends at
    `EvictTagsAsync(cancellationToken, "conference:sessions", "conference")` (`:297, 334, 345`), the broad
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
  speaker dashboard's `SpeakerId`-filtered list, and the k6 load test's read endpoints (`/Sessions/paged`)
  all hit it. The add-to-calendar affordance hits
  [`SessionCalendarController`](#sessioncalendarcontroller), which mounts under this same
  route prefix.

---

### SessionSpeakersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionSpeakersController.cs:48` · Level 10 · class (sealed)

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
  (`[HttpGet("export")]` at `:147`, `Forbid()` at `:158`) and the `AllowUnscopedExport => IsPrivileged`
  opt-in (`:91`) that lets only a privileged reader take the unscoped table under the framework's
  fail-closed export. The difference is the eviction set:
  `[Rubric §12, Performance & Scalability]`, both mutations clear `conference:sessions` and the broad
  `conference` tag (`:188, 211`) and deliberately do **not** clear `conference:speakers` the way the other
  two-parent junction controllers do. The comment at `:186-187` gives the reason: what a speaker
  assignment changes is the cached session reads (detail and list, which the speaker dashboard relies on),
  so the sessions tag is the one that must go.
- **Walkthrough**: four `[AllowAnonymous]` + `[OutputCache(PolicyName = "SessionsCache")]` read
  passthroughs (`SessionSpeakersController.cs:93,103,122,130`, the last carrying the named route
  `"GetSessionSpeakerById"`), all scoped by the hook. `CreateAsync` (`[HttpPost]` at `:171`,
  `[Idempotent]` at `:172`) dispatches
  `AddSessionSpeakerCommand(request.SessionId, null, request.SpeakerId)` (`:178`), returns `HandleFailure`
  first on failure (`:181-184`), evicts (`:188`) and returns `CreatedAtRoute("GetSessionSpeakerById", ...)`
  (`:189-192`); `DeleteAsync` (`:197`) reads the parent `sessionId` `[FromQuery]` (`:199`), dispatches
  `RemoveSessionSpeakerCommand(sessionId, id)` (`:203`), evicts (`:211`) and returns `NoContent()`
  (`:212`). The class gate is `[HasPermission(ConferencePermissions.SessionsManage)]` (`:47`).
- **Why it's built this way**: the eviction crosses aggregates deliberately, because the session's cached
  representation includes its speakers, so mutating the link must invalidate the session cache to keep
  reads correct. Everything else is the shared junction shape, which is the point: an engineer who has read
  [`EventSpeakersController`](#eventspeakerscontroller) can read this one in under a minute.
- **Where it's used**: the Conference service host behind the Gateway route
  `/SessionSpeakers/{**catch-all}` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:102`);
  consumed by the session-editing UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Session/` and the speaker dashboard.

---

### AddSpeakerCategoryItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Speakers/SpeakerCategoryItemsController.cs:29` · Level 0 · record class

- **What it is**: the POST body that tags a speaker with a category item: `SpeakerId` plus
  `CategoryItemId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Speakers/SpeakerCategoryItemsController.cs:29-36`).
- **Depends on**: the `SpeakerIdentifierType` / `CategoryItemIdentifierType` aliases. Consumed by
  [`SpeakerCategoryItemsController`](#speakercategoryitemscontroller), which forwards it to
  [`AddSpeakerCategoryItemCommand`](group-18-conference-application.md#addspeakercategoryitemcommand).
- **Concept**: a join-entity write contract like [`AddEventSpeakerRequest`](#addeventspeakerrequest)
  (`[Rubric §4, DDD]`); add plus delete only. Notable domain modeling: ADC represents speaker traits such
  as locality as a [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem) tag rather
  than as a field on [`Speaker`](group-17-conference-domain.md#speaker), so a request like this is how
  that attribute is attached. The controller passes `null` for the join id
  (`new AddSpeakerCategoryItemCommand(request.SpeakerId, null, request.CategoryItemId)`,
  `SpeakerCategoryItemsController.cs:178`) and then evicts `conference:speakers`,
  `conference:categories`, and `conference` (`SpeakerCategoryItemsController.cs:186`).
- **Walkthrough**: two `required { get; init; }` id properties, no methods.
- **Where it's used**: `[FromBody]` on [`SpeakerCategoryItemsController`](#speakercategoryitemscontroller)'s
  `CreateAsync` (`SpeakerCategoryItemsController.cs:173-174`), behind
  `[HasPermission(ConferencePermissions.SpeakersManage)]` (`SpeakerCategoryItemsController.cs:47`) and
  marked [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) (`:164`).

---

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
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:374`) and every Conference error code
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
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:374`) and in the localization test's
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
  why the list has the shape it does (`SelfHttpOutputCacheWarmupTask.cs:30-44`): two families of caller
  build their URLs differently.
  - Family 1 is
    [EntityServiceBase<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype),
    which interpolates C# `bool` values and therefore emits capitalized `False`/`True`. The public list
    pages go through it, so the `/paged` entries mirror exactly what
    [PublicEventList](group-21-conference-ui.md#publiceventlist) sends
    (`SelfHttpOutputCacheWarmupTask.cs:47-51`).
  - Family 2 is the hand-written lookup services,
    [EventLookupService](group-21-conference-ui.md#eventlookupservice),
    [SpeakerLookupService](group-21-conference-ui.md#speakerlookupservice) and
    [CategoryItemLookupService](group-21-conference-ui.md#categoryitemlookupservice), which page through
    the `/paged` endpoint in id order with lowercase literals. Their URLs are built by
    [PagedReadAll](group-15-common-ui-framework.md#pagedreadall)`.LookupPageUrl` (the call site in
    `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Events/EventLookupService.cs:85`),
    so the warmed entries are page 1 at `pageSize=500`, `sortColumn=Id`, `sortDirection=asc`
    (`SelfHttpOutputCacheWarmupTask.cs:53-58`). Page 1 is the one every caller issues; later pages of a
    large lookup still start cold.

  Those URLs do not collide, so both families have to be warmed independently. The lesson generalizes: a
  warm-up list is a copy of a caller's serialization behavior, and it silently stops working when a caller
  changes how it renders a query string. For the lookup family that drift is now caught by a test rather
  than by reading: `RequestedPaths` (`:62`) exposes the list so
  `MMCA.ADC/Tests/Services/MMCA.ADC.Services.Tests/Warmup/SelfHttpOutputCacheWarmupTaskTests.cs` can pin
  every lookup path to the output of `PagedReadAll.LookupPageUrl` (the class comment says so at `:37-39`).
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
  - `Paths` (`:45-59`): a `private static readonly string[]` of eight relative paths, the two families
    described above. Four `/paged` and collection reads for the public list pages (`:48-51`), then three
    `/paged` lookup reads (`speakers`, `events`, `categoryitems`, `:55-57`) and the unpaged
    `conferencecategories` lookup (`:58`).
  - `RequestedPaths` (`:62`): an `internal static IReadOnlyList<string>` over the same array, present only
    so the test above can read the list; the runtime path never uses it.
  - `Name => "SelfHttpOutputCache"` (`:65`): the identifier that appears in the warm-up completion and
    failure log lines.
  - `WarmupPaths => Paths` (`:68`): the single abstract member the base needs. That is the entire
    runtime contribution of this class.
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
  Conference host (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:309`) and executed by
  the warm-up runner that `AddServiceDefaults()` installs. `SelfHttpOutputCacheWarmupTaskTests` reads
  `RequestedPaths` to pin the lookup family. Three sibling copies of the same pattern live in the Store
  services; each differs only in its `Paths` list.
- **Caveats / not-in-source**: the family-1 entries are still an invariant maintained by reading the
  caller ([PublicEventList](group-21-conference-ui.md#publiceventlist) and its siblings); only the lookup
  family is pinned by a test. The comment at `:53-54` notes that three of the four lookup paths were
  previously uncovered, so the list has drifted before.

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
  `[Rubric §15, Best Practices & Code Quality]`: the discovery *behavior* is written once in the Common base, and each
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

### CurrentUserServiceExtensions
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Authorization` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Authorization/CurrentUserServiceExtensions.cs:10` · Level 9 · class (static)

- **What it is**: a one-method helper that answers a single question for the whole Conference API layer: may
  this caller read the unfiltered catalog, or do they get the public projection? Every controller asks it
  the same way instead of hand-rolling a role check per endpoint.
- **Depends on**: [ICurrentUserService](group-08-auth.md#icurrentuserservice) (the type it extends, and the
  source of `IsInRole`) and [ConferenceReadAudience](group-17-conference-domain.md#conferencereadaudience),
  whose `PrivilegedRoles` list it evaluates (`CurrentUserServiceExtensions.cs:25`). Transitively that list
  is [RoleNames](group-24-identity-module.md#rolenames)`.Organizer` and `RoleNames.ContentEditor`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferenceReadAudience.cs:34-38`).
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
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:266`), and the comment right above it
  names this helper as the other half of the pair (`Program.cs:264-266`). The reason is a real correctness
  hazard, not tidiness: if the visibility check and the cache-bypass list ever named different roles, a
  privileged reader's unfiltered payload would be written into a shared cache entry and then served to the
  public. Declaring the roles once makes that class of bug impossible rather than merely unlikely
  (`ConferenceReadAudience.cs:12-15`). `[Rubric §11, Security]` again, and `[Rubric §15, Best Practices & Code Quality]`:
  a future third, partially-privileged audience would need its own cache key, which is why the audience list
  is documented as deliberately two-valued (`ConferenceReadAudience.cs:17-21`).
- **Walkthrough**
  - The class is a plain `public static class` (`CurrentUserServiceExtensions.cs:10`) whose body is a C# 14
    `extension(ICurrentUserService currentUserService)` block (`:12`), the codebase-wide idiom (see
    [primer §4](00-primer.md#4-c-build-and-code-style-conventions)). Callers write
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
  [ActivitiesController](#activitiescontroller) (`ActivitiesController.cs:53`),
  [RoomsController](#roomscontroller) (`RoomsController.cs:104`),
  [SessionsController](#sessionscontroller) (`SessionsController.cs:59`),
  [SessionCategoryItemsController](#sessioncategoryitemscontroller) (`SessionCategoryItemsController.cs:59`),
  [SessionSpeakersController](#sessionspeakerscontroller) (`SessionSpeakersController.cs:59`),
  [SpeakerCategoryItemsController](#speakercategoryitemscontroller) (`SpeakerCategoryItemsController.cs:59`),
  [SpeakersController](#speakerscontroller) (`SpeakersController.cs:57`),
  [SponsorsController](#sponsorscontroller) (`SponsorsController.cs:53`) and
  [EventSpeakersController](#eventspeakerscontroller) (`EventSpeakersController.cs:58`), all under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/`.
  [EventsController](#eventscontroller) calls it inline in two places: to choose whether to apply
  [PublishedEventSpecification](group-18-conference-application.md#publishedeventspecification)
  (`EventsController.cs:70`) and to gate a second code path (`EventsController.cs:143`). The host reads the
  underlying list for its cache policies (`Conference.Service/Program.cs:214`).

### QuestionsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Questions/QuestionsController.cs:35` · Level 9 · class (sealed)

- **What it is**: the REST controller for the [`Question`](group-17-conference-domain.md#question)
  aggregate root (`/Questions`), the feedback-question definitions attendees answer. It is the plainest
  aggregate-root controller in the group: inherited CRUD, one hand-rolled conditional update, an explicit
  opt-in to whole-table export, and cache eviction, with no visibility scoping at all.
- **Depends on**:
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`QuestionsController.cs:42-43`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:36`); a create handler keyed on
  [`QuestionCreateRequest`](group-18-conference-application.md#questioncreaterequest) (`:37`); an update
  handler for [`UpdateQuestionCommand`](group-18-conference-application.md#updatequestioncommand) (`:38`);
  a delete handler keyed on
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  (`:39`); `IOutputCacheStore` (`:40`); the [`QuestionDTO`](group-17-conference-domain.md#questiondto);
  [`QuestionUpdateRequest`](group-18-conference-application.md#questionupdaterequest) as the PUT body
  (`:123`); and the [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute).
- **Concept introduced**: none new. This is the aggregate-root shape taught at
  [`ConferenceCategoriesController`](#conferencecategoriescontroller), minus even the route override.
  `[Rubric §9, API & Contract Design]`: every read is a pure `override` that re-decorates the base action
  and delegates (`QuestionsController.cs:48-95`), which is what a controller looks like when it has no
  per-caller rule to apply; contrast [`EventSpeakersController`](#eventspeakerscontroller), which overrides
  the read hook so the base can scope those same actions. The one consequence of having no read hook is
  the export. The inherited `/export` action in
  [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  is fail-closed: when `GetReadSpecificationAsync` resolves to `null` it answers 403 unless the controller
  opts in through `AllowUnscopedExport`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:272-274`, default
  `false` at `:508`). Questions are reference data every reader lists in full, so this class sets
  `AllowUnscopedExport => true` unconditionally (`QuestionsController.cs:45-46`); the action carries no
  `[AllowAnonymous]` of its own, so it stays behind the class-level capability gate.
  The one bespoke command here, `UpdateQuestionCommand`, exists because a question update is not a plain
  property patch; the conditional-write contract is the same one taught at
  [`ConferenceCategoriesController`](#conferencecategoriescontroller).
- **Walkthrough**
  - The class is gated by `[HasPermission(ConferencePermissions.QuestionsManage)]`
    (`QuestionsController.cs:34`), a capability granted to Organizer and Admin only
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:43-44`); it is
    absent from the ContentEditor subset
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:70-79`),
    so a content editor curates sessions and speakers but cannot rewrite the feedback form.
  - `AllowUnscopedExport => true` (`:46`) is the export opt-in described above.
  - All four reads (`:48-95`) re-open with `[AllowAnonymous]` and attach
    `[OutputCache(PolicyName = "QuestionsCache")]` (5-minute TTL, tags `conference` and
    `conference:questions`, `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:278`), then
    delegate; `GetByIdAsync` carries the named route `"GetQuestionById"` (`:81`).
  - `CreateAsync` (`:98-106`) and `DeleteAsync` (`:140-148`) are thin overrides: call the base, then
    `EvictTagsAsync(cancellationToken, "conference:questions")` (`:104, 146`), then return the base's
    result.
  - `UpdateAsync` (`:121-137`) is the hand-rolled action: `[SupportsIfMatch]` (`:117`) with the 409/412/428
    `[ProducesResponseType]` triple (`:118-120`), `SupportsIfMatchAttribute.RequiredToken(HttpContext)`
    (`:126`), `new UpdateQuestionCommand(id, request, rowVersion)` (`:129`), `HandleFailure` on failure
    (`:132-133`), evict (`:135`), `Ok(result.Value)` (`:136`).
  - Every eviction here clears the single `conference:questions` tag; unlike the sessions and speakers
    controllers it does not also clear the broad `conference` tag, because no cross-entity read projects a
    question.
- **Why it's built this way**: questions carry no per-role visibility rule, so the controller carries
  none. It is the reference case for how little an aggregate-root controller must write when the base does
  the work: policy, one update action, the export opt-in, and eviction.
- **Where it's used**: the Conference service host behind the Gateway route `/Questions/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:130`); the feedback-form builder UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Question/` is the main client, and the
  answers flow through [`EventQuestionAnswersController`](#eventquestionanswerscontroller) and
  [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller).

### SessionAssetsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.SessionAssets` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionAssets/SessionAssetsController.cs:51` · Level 9 · class (sealed)

- **What it is**: the REST controller for a session's materials (`/SessionAssets`): links to material hosted
  elsewhere and uploaded files (slide decks, handouts), listed, added, updated and deleted per session. It is
  not an `AggregateRootEntityControllerBase` descendant like the other controllers in this group; every
  action is hand-written because the write side branches on caller identity (a session's own speaker versus
  an organizer) rather than following the generic CRUD shape.
- **Depends on**: an [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetSessionAssetsQuery`](group-18-conference-application.md#getsessionassetsquery) (`:52`); four
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`AddSessionAssetLinkCommand`](group-18-conference-application.md#addsessionassetlinkcommand) (`:53`),
  [`UploadSessionAssetCommand`](group-18-conference-application.md#uploadsessionassetcommand) (`:54`),
  [`UpdateSessionAssetCommand`](group-18-conference-application.md#updatesessionassetcommand) (`:55`) and
  [`DeleteSessionAssetCommand`](group-18-conference-application.md#deletesessionassetcommand) (`:56`);
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (`:57`), read through its `speaker_id` claim
  rather than through [`CurrentUserServiceExtensions`](#currentuserserviceextensions), because visibility
  here turns on "is this caller the session's speaker", not on the shared privileged-role audience;
  [`IPermissionRegistry`](group-08-auth.md#ipermissionregistry) (`:58`), checked directly against
  `ConferencePermissions.SessionAssetsManage` rather than through a `[HasPermission]` attribute, since the
  privileged check has to be available as a plain `bool` inside every action body, not just as a class or
  method gate; ASP.NET Core's `IOutputCacheStore` (`:59`); the
  [`SessionAssetDTO`](group-17-conference-domain.md#sessionassetdto) and
  [`SessionAssetLimits`](group-17-conference-domain.md#sessionassetlimits) constants; the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute) and
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute); and
  [`SessionAssetLinkRequest`](group-18-conference-application.md#sessionassetlinkrequest) /
  [`SessionAssetUpdateRequest`](group-18-conference-application.md#sessionassetupdaterequest) as the POST and
  PUT bodies. It derives from
  [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (`:59`), not the aggregate-root
  base, since there is no by-id read action to inherit.
- **Concept introduced, two idempotency keys covering two different duplicate-write hazards.** Both mutating
  POST actions carry `[Idempotent]`, and the remarks on each explain a *different* reason
  (`SessionAssetsController.cs:108-112`, `:145-150`). `AddLinkAsync` appends a row, so a retry would publish
  the same link twice on the public page; a retried `UploadFileAsync` would additionally leave a duplicate
  blob, and on conference-venue wifi replaying the stored response also spares a second 50 MB transfer,
  turning a timeout-prone retry into a cheap one. Both stand on the same
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute) mechanism taught at
  [`ConferenceCategoriesController`](#conferencecategoriescontroller)'s group; what differs is the specific
  duplicate each guards against.
  `[Rubric §29, Resilience & Business Continuity]`: a mobile submit that times out and retries is expected
  conference-day behavior, not an edge case, so both writes are safe to replay.
- **Concept introduced, an anonymous read that must never cache a privileged answer.** `GetBySessionAsync` is
  `[AllowAnonymous]` and carries `[OutputCache(PolicyName = "SessionsCache")]` (`:76-78`) because it backs the
  public session page, but the same action also serves a session's own speaker or an organizer, whose answer
  can include materials the public cannot see. The output-cache key does not vary by caller, so the action
  checks `actingSpeakerId is not null || isPrivileged` and, when true, sets
  `HttpContext.Features.Get<IOutputCacheFeature>()?.Context.AllowCacheStorage = false` (`:90-93`) before
  calling the handler. The comment is explicit that the policy only ever turns storage off, never back on
  (`:87-89`): there is no path where a privileged response is accidentally cached, only a path where it opts
  out of a cache write that would otherwise happen by default.
  `[Rubric §11, Security]`: a privileged reader's fuller answer never lands in the entry the public shares,
  the same class of hazard [`CurrentUserServiceExtensions`](#currentuserserviceextensions) names for the
  audience/cache-bypass pair, solved here per-request instead of per-role list because the audience is
  per-session, not a fixed role set.
  `[Rubric §12, Performance & Scalability]`: the public path, the overwhelming majority of calls, still gets
  the shared cache entry; only the caller-specific minority pays for a live read.
- **Walkthrough**
  - `ActingSpeakerId` (`:62-63`) reads the caller's `speaker_id` claim as a nullable
    `SpeakerIdentifierType`; `IsPrivileged` (`:66-67`) checks
    `permissionRegistry.HasPermission(currentUserService.Roles, ConferencePermissions.SessionAssetsManage)`.
    Every action re-reads both rather than caching them, since each is a cheap claim/permission lookup.
  - `GetBySessionAsync` (`:80-100`): the anonymous, output-cached list read described above; delegates to
    `getBySessionHandler` with `(sessionId, actingSpeakerId, isPrivileged)` (`:95-97`) so the query itself
    decides which rows a non-owning, non-privileged caller sees.
  - `AddLinkAsync` (`:118-132`) and `UploadFileAsync` (`:161-203`) both dispatch with `(request,
    ActingSpeakerId, IsPrivileged)` and, on success, call `EvictSessionCachesAsync` then return
    `Created(SessionListUri(result.Value!.SessionId), result.Value)` (`:129-131`, `:200-202`). Because there
    is no by-id GET, the `Created` location points at the session's asset list rather than at a single
    resource, and the doc comment on `SessionListUri` (`:267-273`) states that choice explicitly: the
    filtered list IS the canonical location of the new resource. `UploadFileAsync` additionally validates the
    file up front (`file is null || file.Length == 0 || file.Length > SessionAssetLimits.MaxFileBytes`,
    `:168-174`), then allocates one `byte[]` of exactly the declared length and fills it in place with
    `ReadExactlyAsync` (`:176-184`). The comment at `:176-178` names why: that array is the only full copy
    of the upload the request holds, shared by the validator, the format sniffer and the storage upload,
    with no intermediate `MemoryStream` copy. The bytes then go to the handler (`:186-195`). The
    `[RequestSizeLimit(SessionAssetLimits.MaxRequestBytes)]` attribute (`:153`) bounds the request itself,
    with an inline `SuppressMessage` justifying the 50 MB cap against Sonar's S5693 default (`:154-157`),
    reviewed and reinforced again by the command validator and by
    `SessionAssetLimits.MaxAssetsPerSession`.
  - `UpdateAsync` (`:224-241`) is `[SupportsIfMatch]` (`:218`), reading the required token via
    `SupportsIfMatchAttribute.RequiredToken(HttpContext)` (`:229`) before dispatching
    `UpdateSessionAssetCommand(id, request, ActingSpeakerId, IsPrivileged, rowVersion)` (`:232`), the same
    conditional-write contract taught at
    [`ConferenceCategoriesController`](#conferencecategoriescontroller). `DeleteAsync` (`:251-265`)
    soft-deletes and, for a file asset, schedules its blob for removal, then returns `NoContent()`.
  - `EvictSessionCachesAsync` (`:280-281`) is called after every mutation and evicts the `conference:sessions`
    and `conference` tags, the same tags a session edit evicts, so a new or removed asset never outlives the
    sessions cache policy's TTL on the public page.
- **Why it's built this way**: ADR-123 (`Website/docs-src/adr/123-speaker-session-assets.md`) is the source
  for the feature. Checking permission as a plain `bool` inside each action, instead of gating the whole
  class the way the aggregate-root controllers do, is what lets the same action serve three different
  audiences (public, owning speaker, organizer) with one code path instead of three near-duplicate
  controllers.
- **Where it's used**: the Conference service host behind the Gateway's `/SessionAssets` route. Tests cover
  every action
  (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Controllers/SessionAssets/SessionAssetsControllerTests.cs`,
  7 tests), the anonymous `GetBySessionAsync` endpoint is asserted by
  `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Api/AnonymousEndpointTests.cs` (2 tests), and
  `UpdateAsync`'s conditional-write contract is covered by
  `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Conventions/ConditionalWriteConventionTests.cs`
  (1 test).

---

### SpeakerCategoryItemsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Speakers/SpeakerCategoryItemsController.cs:48` · Level 9 · class (sealed)

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
  (`:52`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (`:53`) with the
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
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:275`). The four reads are
  `[AllowAnonymous]` + `[OutputCache(PolicyName = "SpeakersCache")]` passthroughs
  (`SpeakerCategoryItemsController.cs:93,103,122,130`, the last carrying the named route
  `"GetSpeakerCategoryItemById"`), all scoped by the hook. The export is guarded twice. The inherited
  `/export` in
  [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  is fail-closed when the read hook returns `null`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:272-274`), and
  `AllowUnscopedExport => IsPrivileged` (`SpeakerCategoryItemsController.cs:91`, doc `:85-90`) opts in to
  the unscoped table only for the privileged readers whose hook result is `null` by design. The
  `ExportAsync` override (`[HttpGet("export")]` at `:147`) still repeats the privileged-reader gate with
  `Forbid()` at `:158` before delegating (`:161`). `CreateAsync` (`[HttpPost]` at `:171`, `[Idempotent]`
  at `:172`) dispatches `AddSpeakerCategoryItemCommand(request.SpeakerId, null, request.CategoryItemId)`
  (`:178`), evicts (`:186`) and returns `CreatedAtRoute("GetSpeakerCategoryItemById", ...)` (`:187-190`);
  `DeleteAsync` (`[HttpDelete("{id}")]` at `:194`) reads the parent `speakerId` `[FromQuery]` (`:197`),
  dispatches `RemoveSpeakerCategoryItemCommand(speakerId, id)` (`:201`), evicts (`:209`) and returns
  `NoContent()` (`:210`). Both evictions clear `conference:speakers`, `conference:categories` and
  `conference` (`:186, 209`).
- **Why it's built this way**: it shares the exact shape of the other junction controllers because the
  underlying rules (mutate the child only through its parent aggregate; never let a junction row outlive
  its parent's visibility) are identical. Only the aggregate, the DTO, the permission and the pair of cache
  tags change, which is `[Rubric §15, Best Practices & Code Quality]` in practice: one shape learned once, repeated
  without variation.
- **Where it's used**: the Conference service host behind the Gateway route
  `/SpeakerCategoryItems/{**catch-all}` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:122`);
  consumed by the speaker-profile editing UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/`. The export authorization is
  covered by
  `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Conventions/EntityExportAuthorizationTests.cs`.

---

### SpeakerLinksController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Speakers/SpeakerLinksController.cs:33` · Level 9 · class (sealed)

- **What it is**: the speaker-to-user link sub-resource (`/Speakers/{id}/link`), split out of
  [`SpeakersController`](#speakerscontroller) so that controller stays within the repo's constructor-
  dependency ceiling (`SpeakerLinksController.cs:18-22`). It carries the same `[Route("Speakers")]`
  prefix, the same action templates and the same `SpeakersManage` gate the link actions had before the
  split, so no URL, verb or authorization posture changed. BR-209 governs the link itself; BR-208
  uniqueness is enforced in the handlers, and this is the only path that writes `Speaker.LinkedUserId`,
  deliberately absent from the speaker update request (`:24-26`).
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (`:37`); two
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`LinkUserToSpeakerCommand`](group-18-conference-application.md#linkusertospeakercommand) and
  [`UnlinkUserFromSpeakerCommand`](group-18-conference-application.md#unlinkuserfromspeakercommand)
  (`:34-35`); `IOutputCacheStore` (`:36`); the
  [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute); and the
  [`LinkUserRequest`](group-17-conference-domain.md#linkuserrequest) record.
- **Concept introduced, the constructor-dependency-ceiling split.** `[Rubric §15, Best Practices & Code
  Quality]`: rather than trimming dependencies off an already dense aggregate-root controller, the two
  link actions and their two command handlers move to a sibling controller that shares
  `SpeakersController`'s route prefix, action templates and permission, checked by
  `ConstructorDependencyCountTests`
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Cqrs/ConstructorDependencyCountTests.cs`). The
  API contract (every URL, verb, and authorization posture) is unaffected by the split; only the internal
  wiring changed. [`SpeakerSessionsController`](#speakersessionscontroller) uses the identical pattern for
  the BR-210 projections.
- **Walkthrough**: `LinkUserAsync` (`[HttpPut("{id}/link")]`
  `[HasPermission(ConferencePermissions.SpeakersManage)]`, `:40-56`) dispatches
  `LinkUserToSpeakerCommand(id, request.UserId)` (`:47-48`) and, on success, evicts `conference:speakers`
  and `conference` (`:54`) before returning `NoContent()`. `UnlinkUserAsync`
  (`[HttpDelete("{id}/link")]`, `:58-74`) is the mirror: dispatches `UnlinkUserFromSpeakerCommand(id)`
  (`:65-66`), evicts the same tags (`:72`) and returns `NoContent()`. Both re-assert
  `[HasPermission(ConferencePermissions.SpeakersManage)]` (`:41, 60`) even though the class already
  carries a bare `[Authorize]` (`:32`).
- **Why it's built this way**: the split exists purely to satisfy the constructor-dependency ceiling, not
  a difference in the resource's shape or authorization; every route, verb and gate is identical to what
  `SpeakersController` carried before the split.
- **Where it's used**: the Conference service host behind the same Gateway route as `SpeakersController`,
  `/Speakers/{**catch-all}` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:86`); exercised by
  the organizer speaker-linking tool.

---

### SpeakersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Speakers/SpeakersController.cs:42` · Level 9 · class (sealed)

- **What it is**: the REST controller for the [`Speaker`](group-17-conference-domain.md#speaker) aggregate
  root (`/Speakers`), and the most authorization-dense controller in the group. On top of aggregate-root
  CRUD it carries the BR-239 public-speaker projection, a virtual `EventId` filter, a self-read carve-out
  with a cache opt-out, resource-level self-edit authorization (BR-214), and a capability-gated CSV
  export. Speaker linking/unlinking (BR-209) and the three cross-entity session projections (BR-210) were
  split into [`SpeakerLinksController`](#speakerlinkscontroller) and
  [`SpeakerSessionsController`](#speakersessionscontroller) to keep this constructor under the repo's
  dependency ceiling.
- **Depends on**:
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`SpeakersController.cs:53-54`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:43`); three [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`SpeakerCreateRequest`](group-18-conference-application.md#speakercreaterequest),
  [`UpdateSpeakerCommand`](group-18-conference-application.md#updatespeakercommand) and
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  (`:44-46`); two [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)s for
  [`GetSpeakersByEventFilterQuery`](group-18-conference-application.md#getspeakersbyeventfilterquery) and
  [`GetPublicSpeakerFilterQuery`](group-18-conference-application.md#getpublicspeakerfilterquery)
  (`:47-48`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) with the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) helper (`:49, 57`);
  [`IPermissionRegistry`](group-08-auth.md#ipermissionregistry) (`:50`), checked against
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions)`.SpeakersManage` on the
  update path; `IOutputCacheStore` (`:51`); the [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) and
  [`SpeakerUpdateRequest`](group-18-conference-application.md#speakerupdaterequest); the
  [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) and
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute); the
  [`SpecificationExtensions`](group-03-querying-specifications.md#specificationextensions) `And` composer
  that yields an
  [`AndSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#andspecificationtentity-tidentifiertype);
  and [`Error`](group-01-result-error-handling.md#error).
- **Concept introduced, per-action authorization plus row-level ownership checks.** `[Rubric §11,
  Security]`: unlike the other aggregate-root controllers (which gate the whole class with one
  `[HasPermission(...)]`), `SpeakersController` carries a bare class-level `[Authorize]`
  (`SpeakersController.cs:41`) and then varies authorization per action. The catalog reads are
  `[AllowAnonymous]`; export, create and delete each re-assert
  `[HasPermission(ConferencePermissions.SpeakersManage)]` (`:289, 308, 365`); and `UpdateAsync`
  performs a *resource-ownership* check in code (`:343-348`, BR-214). It computes `canManage` as
  `permissionRegistry.HasPermission(currentUserService.Roles, ConferencePermissions.SpeakersManage)`
  (`:345`), the same capability the sibling create and delete actions require, so ContentEditor qualifies
  alongside Organizer (comment `:343-344`); it compares the caller's `speaker_id` JWT claim with the route
  id (`:346`); and it returns `Forbid()` when the caller is neither (`:347-348`). That is authorization a
  policy attribute cannot express, because it depends on the specific row being edited; the management
  flag is then passed on to the handler as
  `new UpdateSpeakerCommand(id, request, CallerIsOrganizer: canManage, RowVersion: rowVersion)` (`:353`)
  so the handler keeps organizer-only fields unchanged on a self-edit (the rule is written out at
  `:318-325`).
- **Concept introduced, the virtual filter key.** `[Rubric §9, API & Contract Design]`: `EventId` is not a
  `Speaker` column, so the paged action removes it from the generic filter dictionary before the pipeline
  can reject it (`:149-159`), translates it into a specification via `GetSpeakersByEventFilterQuery`
  (`:166-167`), and **ANDs** it with the public-speaker specification rather than substituting
  (`:171-173`, `publicSpecification.And(...)` at `:173`, the extension member declared at
  `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/SpecificationExtensions.cs:48`). Substituting
  would leak hidden speakers to a non-privileged caller; an unparseable value simply drops the scope
  instead of failing the request. The remarks at `:126-132` add the reason the two are not redundant: the
  event filter answers "linked to this event", the public filter answers "accepted for this event".
- **Walkthrough**
  - `IsPrivileged` (`SpeakersController.cs:57`) is the shared read-audience check;
    `BuildPublicSpeakerSpecificationAsync` (`:76-87`, doc `:62-75`) is the BR-239 projection, parameterized
    by an optional `eventId` because a speaker accepted for one event is not thereby public on another.
    Privileged readers get `null`.
  - `GetReadSpecificationAsync` (`:96-98`) is the framework hook, and it delegates to that builder with
    no event context: the list, lookup and by-id actions read their scope from here, while the paged action
    resolves its own because it carries an event id (doc `:89-95`).
  - `AllowUnscopedExport => IsPrivileged` (`:106`, doc `:100-105`) is the opt-in the fail-closed inherited
    export needs
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:272-274`): the hook
    returns `null` for a privileged reader, so without it even an organizer's export would be refused, and
    for everyone else the opt-in is `false`.
  - `GetAllAsync` (`:108-116`) is a plain passthrough. The paged overload (`:136-195`) clamps `pageSize` to
    `MaxPageSize` (`:147`), performs the `EventId` interception described above, then queries with the
    composed specification (`:177-188`) and appends the `X-Pagination` header carrying the result's
    [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata) (`:193`).
  - `GetAllForLookupAsync` (`:210-240`) has two guards. Privileged readers (a `null` specification) fall
    through to the base action (`:214-216`); everyone else must name the label column from the allow-list
    `PublicLookupNameProperties` (`:60`, first or last name only) or receive an
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
  - `ExportAsync` (`:288-304`) is the strongest form of the export gate taught at
    [`EventQuestionAnswersController`](#eventquestionanswerscontroller): a declarative
    `[HasPermission(ConferencePermissions.SpeakersManage)]` (`:289`) **plus** the imperative
    `if (!IsPrivileged) return Forbid();` (`:298-301`), on top of the base's fail-closed refusal. The doc
    comment names the double bypass an unscoped CSV would be here, going around both the public projection
    and the redacting DTO mapper, emails included, and records that the attribute is stated explicitly
    because the class carries only a bare `[Authorize]` for the inherited action to pick up (`:280-287`).
    `[Rubric §30, Compliance/Privacy/Data Governance]`: a speaker roster is personal data, so bulk egress
    is a named capability rather than a side effect of reading the list.
  - `CreateAsync` (`:307-316`) and `DeleteAsync` (`:364-373`) call the base and evict. `UpdateAsync`
    (`:332-361`) runs the BR-214 check (`:343-348`), reads the required `If-Match` token (`:350`),
    dispatches (`:352-354`) and evicts (`:359`). Every mutation ends at
    `EvictTagsAsync(cancellationToken, "conference:speakers", "conference")` (`:314, 359, 371`).
  - The link/unlink actions (BR-209) and the three BR-210 session read projections (aggregated feedback,
    single and batched bookmark counts) are not on this class: they live on
    [`SpeakerLinksController`](#speakerlinkscontroller) and
    [`SpeakerSessionsController`](#speakersessionscontroller) respectively, both sharing this controller's
    `/Speakers` route prefix.
- **Why it's built this way**: speaker profiles are edited both by speaker managers and by the speakers
  themselves, so the controller needs row-aware authorization that a static policy cannot provide; keeping
  that check inline mirrors the per-mutation ownership pattern used across the codebase. Deriving the
  update's management flag from the same `SpeakersManage` capability the create and delete attributes use
  keeps the three mutations agreeing on who counts as a manager. The virtual `EventId` filter gives clients
  an event-scoped speaker list without adding a denormalized column to the aggregate. The link/session
  split keeps the constructor's dependency count under `ConstructorDependencyCountTests`' ceiling without
  shrinking the resource's surface.
- **Where it's used**: the Conference service host behind the Gateway route `/Speakers/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:86`); consumed by the public speaker directory
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Speakers/PublicSpeakerList.razor`), the
  speaker self-service profile page, and organizer linking tools.

---

### SpeakerSessionsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Speakers/SpeakerSessionsController.cs:29` · Level 9 · class (sealed)

- **What it is**: the per-speaker session sub-resource (`/Speakers/{speakerId}/sessions/...`), carrying
  the BR-210 aggregated session feedback and bookmark-count reads behind the speaker dashboard and the
  public popularity badge. Like [`SpeakerLinksController`](#speakerlinkscontroller), it is split out of
  [`SpeakersController`](#speakerscontroller) to keep that controller's constructor under the repo's
  dependency ceiling (`SpeakerSessionsController.cs:20-23`); the route prefix, action templates,
  authorization attributes and output-cache policies are unchanged by the split.
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (`:34`); three
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)s for
  [`GetSessionFeedbackQuery`](group-18-conference-application.md#getsessionfeedbackquery),
  [`GetSessionBookmarkCountQuery`](group-18-conference-application.md#getsessionbookmarkcountquery) and
  [`GetSessionBookmarkCountsQuery`](group-18-conference-application.md#getsessionbookmarkcountsquery)
  (`:30-32`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) with
  [`RoleNames`](group-24-identity-module.md#rolenames) (`:33`); and the
  [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto).
- **Concept introduced**: none new; see the constructor-dependency-ceiling split note at
  [`SpeakerLinksController`](#speakerlinkscontroller).
- **Walkthrough**: `GetSessionFeedbackAsync` (`[HttpGet("{speakerId}/sessions/{sessionId}/feedback")]`
  `[Authorize]`, `:43-62`) repeats the self-or-organizer gate the BR-214 update path uses on
  `SpeakersController`: the caller must be an Organizer or carry the route speaker's `speaker_id` claim
  (`:50-53`), and the action carries **no** `[OutputCache]` at all because every response is
  authorization-dependent; the doc comment records that the endpoint was briefly anonymous with a public
  output cache, which let any caller read (and publicly cache) any speaker's feedback by URL, before it
  was made unconditionally uncached (`:36-42`). The two count endpoints stay `[AllowAnonymous]` under
  `BookmarkCountsCache`: `GetSessionBookmarkCountAsync` (`:66-81`, doc `:64-65`) and the batched
  `GetSessionBookmarkCountsAsync` (`:86-101`, doc `:83-85`), both a 60-second policy tagged `conference`
  and `conference:sessions`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:296`). `[Rubric §7, Microservices
  Readiness]`: bookmark counts are owned by the Engagement service, in another process, whose writes have
  no handle on this host's cache store, so Engagement's bookmark handler publishes an eviction request
  over the broker that this host turns into a tag drop, and the short TTL stays as the backstop for a
  message that never lands (`Program.cs:286-296`). The batched form (`:94-96`) replaces the speaker
  dashboard's per-session fan-out and only ever counts sessions actually assigned to the speaker.
- **Why it's built this way**: same rationale as [`SpeakerLinksController`](#speakerlinkscontroller): the
  split is a constructor-dependency fix, not a design change. Feedback stays uncached because every
  response is caller-scoped, and the batched bookmark-counts endpoint gives clients one round trip instead
  of one per session, which is `[Rubric §12, Performance & Scalability]` applied at the contract level.
- **Where it's used**: the Conference service host behind the same Gateway route as `SpeakersController`,
  `/Speakers/{**catch-all}` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:86`); consumed by
  the speaker dashboard's feedback and bookmark tiles.

---

### ActivitiesController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Activities` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Activities/ActivitiesController.cs:40` · Level 10 · class (sealed)

- **What it is**: the REST controller for the [`Activity`](group-17-conference-domain.md#activity)
  aggregate root (`/Activities`), the conference's social and networking programme (parties, meetups,
  sponsor receptions). Anonymous reads scoped to published events, and create / update / delete / export
  behind the activities-manage capability (`ActivitiesController.cs:30-34`).
- **Depends on**:
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`ActivitiesController.cs:49-50`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:41`); three [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`ActivityCreateRequest`](group-18-conference-application.md#activitycreaterequest), the framework's
  [`UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>`](group-05-cqrs-pipeline.md#updateentitycommandtentity-tupdaterequest-tidentifiertype)
  and
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  (`:42-44`); an [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicActivityFilterQuery`](group-18-conference-application.md#getpublicactivityfilterquery)
  (`:45`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) plus the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) read-audience helper (`:46, 53`);
  `IOutputCacheStore` (`:47`); the [`ActivityDTO`](group-17-conference-domain.md#activitydto);
  [`ActivityUpdateRequest`](group-18-conference-application.md#activityupdaterequest) as the PUT body; the
  [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) with the
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) catalog; the
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute); and the
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder).
- **Concept introduced**: none new. This controller is the exact structural twin of
  [`SponsorsController`](#sponsorscontroller): the same bare `[Authorize]` class gate with a per-mutation
  capability, the same real-`EventId`-column scoping (no filter interception), the same
  `AllowUnscopedExport` opt-in plus attribute-plus-imperative export gate, at the same line numbers in both
  files. What differs is the vocabulary. `[Rubric §11, Security]`: the class carries `[Authorize]`
  (`ActivitiesController.cs:39`) and each mutation re-asserts
  `[HasPermission(ConferencePermissions.ActivitiesManage)]` (`:152, 171, 190, 215`), the capability
  declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:39`
  and included in the `ContentManagement` curation subset (`ConferencePermissions.cs:70-79`), so a content
  editor can run the social programme without holding event, room or question rights.
  `[Rubric §12, Performance & Scalability]`: reads run under the `ActivitiesCache` policy (5-minute TTL,
  tags `conference` and `conference:activities`,
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:281`) and every mutation evicts both
  tags.
- **Walkthrough**
  - `IsPrivileged` (`ActivitiesController.cs:53`) is the shared
    `currentUserService.IsPrivilegedConferenceReader()` read-audience check;
    `GetReadSpecificationAsync` (`:69-79`) returns `null` for a privileged reader and otherwise the
    [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype)
    the `GetPublicActivityFilterQuery` handler resolves; a failed handler result degrades to `null` rather
    than failing the read.
  - `AllowUnscopedExport => IsPrivileged` (`:87`, doc `:81-86`) opts the fail-closed inherited export
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:272-274`) in to
    the unscoped table for exactly the audience whose hook result is `null`; everyone else gets the
    published-scope specification or, if it cannot be built, the framework's 403.
  - `GetAllAsync` (`:89`), the paged overload (`:105`), `GetAllForLookupAsync` (`:120`) and
    `GetByIdAsync` under the named route `"GetActivityById"` (`:132`) are `[AllowAnonymous]` +
    `[OutputCache(PolicyName = "ActivitiesCache")]` passthroughs, all scoped from the one hook. The paged
    action's doc comment states the composition contract explicitly: `EventId` is a real column, so the
    caller's event filter travels through the generic pipeline and the published-event rule is ANDed on top
    of it rather than substituted (`:99-104`). The by-id doc comment states that an activity of an
    unpublished event is a 404, "not a redacted record, so a guessed id cannot confirm that a party has
    been scheduled" (`:128-131`).
  - `ExportAsync` (`[HttpGet("export")]` at `:151`) pairs the declarative
    `[HasPermission(ConferencePermissions.ActivitiesManage)]` (`:152`) with the imperative
    `if (!IsPrivileged) return Forbid();` (`:163`), then delegates to the base (`:166`). The doc
    comment names the leak an unscoped CSV would be, a social programme that has not been announced, and
    notes that the attribute is needed because the class carries only a bare `[Authorize]` (`:143-150`).
  - `CreateAsync` (`[HttpPost]` at `:170`) and `DeleteAsync` (`[HttpDelete("{id}")]` at `:214`) are thin
    overrides that call the base and then evict; `UpdateAsync` (`[HttpPut("{id}")]` at `:189`) is the
    hand-rolled action the base does not supply, reading the required `If-Match` token (`:200`),
    dispatching `new UpdateEntityCommand<Activity, ActivityUpdateRequest, ActivityIdentifierType>(id,
    request, rowVersion)` (`:203`), folding a failure through `HandleFailure` (`:207`), evicting (`:209`)
    and returning `Ok(result.Value)` (`:210`).
  - Every eviction clears `conference:activities` and the broad `conference` tag (`:177, 209, 221`), the
    latter because the activity strip renders alongside other conference reads.
- **Why it's built this way**: the social programme has the same publish-gated lifecycle as the rest of
  the catalog, so it reuses the specification hook rather than inventing an activity-specific visibility
  flag, and because `Activity` owns a real `EventId` none of that scoping needs a virtual key. Repeating
  the sponsor controller's shape verbatim is `[Rubric §15, Best Practices & Code Quality]` in practice: two aggregates
  with identical rules get identical code, so the reader who has learned one has learned both.
- **Where it's used**: the Conference service host behind the Gateway route `/Activities/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:138`). Clients are the public activity page
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Activities/PublicActivityList.razor`) and
  the organizer list, create and detail pages under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activity/`.

### PartnersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Partners` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Partners/PartnersController.cs:41` · Level 10 · class (sealed)

- **What it is**: the REST controller for the `Partner` aggregate root (`/Partners`), the conference's
  partner organizations. Anonymous reads scoped to published events, and create / update / delete / export
  behind the partners-manage capability (`PartnersController.cs:37-38`).
- **Depends on**:
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`PartnersController.cs:50-51`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:42`); three [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`PartnerCreateRequest`](group-18-conference-application.md#partnercreaterequest), the framework's
  [`UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>`](group-05-cqrs-pipeline.md#updateentitycommandtentity-tupdaterequest-tidentifiertype)
  and
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  (`:43-45`); an [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  `GetPublicPartnerFilterQuery` (`:46`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) plus
  the [`CurrentUserServiceExtensions`](#currentuserserviceextensions) read-audience helper (`:47, 57`);
  `IOutputCacheStore` (`:48`); the `PartnerDTO`; `PartnerUpdateRequest` as the PUT body; the
  [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) with the
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) catalog; the
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute); and the
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder).
- **Concept introduced**: none new. This is the third structural twin in the group, alongside
  [`ActivitiesController`](#activitiescontroller) and [`SponsorsController`](#sponsorscontroller): the same
  bare `[Authorize]` class gate with a per-mutation capability, the same real-`EventId`-column scoping, the
  same `AllowUnscopedExport` opt-in, and the same attribute-plus-imperative export gate.
  `[Rubric #11, Security]`: the class carries `[Authorize]` (`PartnersController.cs:40`) and each mutation
  re-asserts `[HasPermission(ConferencePermissions.PartnersManage)]` (`:143, 162, 180, 205`), the
  capability declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:36`
  and included in the `ContentManagement` curation subset (`ConferencePermissions.cs:76`), so a content
  editor can manage the partner roster without holding event, room or question rights.
  `[Rubric #12, Performance & Scalability]`: reads run under the `PartnersCache` policy (5-minute TTL, tags
  `conference` and `conference:partners`,
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:280`) and every mutation evicts both tags.
- **Walkthrough**
  - `IsPrivileged` (`PartnersController.cs:57`) is the shared `currentUserService.IsPrivilegedConferenceReader()`
    read-audience check; `GetReadSpecificationAsync` (`:66-76`) returns `null` for a privileged reader and
    otherwise the specification the `GetPublicPartnerFilterQuery` handler resolves, degrading to `null` on
    a failed result.
  - `AllowUnscopedExport => IsPrivileged` (`:84`, doc `:78-83`) opts the fail-closed inherited export
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:272-274`) in to
    the unscoped table only for the privileged readers whose hook result is `null`.
  - The four reads (`[HttpGet]` at `:86`, `"paged"` at `:100`, `"lookup"` at `:115`, and by-id under the
    named route `"GetPartnerById"` at `:126`) are `[AllowAnonymous]` +
    `[OutputCache(PolicyName = "PartnersCache")]` passthroughs; the paged doc comment (`:96-99`) and the
    by-id doc comment (`:123-125`) state the published-event scoping and that a partner of an unpublished
    event is a 404 for a non-privileged caller.
  - `ExportAsync` (`[HttpGet("export")]` at `:142`) pairs the declarative
    `[HasPermission(ConferencePermissions.PartnersManage)]` (`:143`) with the imperative
    `if (!IsPrivileged) return Forbid();` (`:154`), then delegates to the base (`:157`). The doc comment
    names the leak an unscoped CSV would be, a non-privileged caller receiving partners of unpublished
    events (`:137-141`).
  - `CreateAsync` (`[HttpPost]` at `:161`) and `DeleteAsync` (`[HttpDelete("{id}")]` at `:204`) are thin
    overrides that call the base and then evict; `UpdateAsync` (`[HttpPut("{id}")]` at `:179`) is the
    hand-rolled action the base does not supply, reading the required `If-Match` token via
    `SupportsIfMatchAttribute.RequiredToken(HttpContext)` (`:190`), dispatching
    `new UpdateEntityCommand<Partner, PartnerUpdateRequest, PartnerIdentifierType>(id, request, rowVersion)`
    (`:193`), folding a failure through `HandleFailure` (`:197`), evicting (`:199`) and returning
    `Ok(result.Value)` (`:200`).
  - Every eviction clears `conference:partners` and the broad `conference` tag through the
    `PartnersCacheTag` / `ConferenceCacheTag` constants (`:53-54`; evictions at `:168, 199, 211`).
- **Why it's built this way**: partners share the same publish-gated visibility as the rest of the catalog,
  so the controller reuses the specification hook rather than inventing a partner-specific visibility flag,
  and because `Partner` owns a real `EventId` column none of that scoping needs a virtual key, the same
  reasoning [`SponsorsController`](#sponsorscontroller) is built on.
- **Where it's used**: the Conference service host behind the Gateway route `/Partners/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:214`). The organizer list, create, detail and
  form-fields pages live under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Partners/`. Tests cover the controller
  (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Controllers/Partners/PartnersControllerTests.cs`,
  10 tests), its anonymous endpoints
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Api/AnonymousEndpointTests.cs`, 3 tests), its
  export authorization
  (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Conventions/EntityExportAuthorizationTests.cs`,
  2 tests) and `UpdateAsync`'s conditional-write contract
  (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Conventions/ConditionalWriteConventionTests.cs`,
  1 test).

---

### SponsorsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sponsors/SponsorsController.cs:40` · Level 10 · class (sealed)

- **What it is**: the REST controller for the [`Sponsor`](group-17-conference-domain.md#sponsor) aggregate
  root (`/Sponsors`), the conference's sponsors and exhibitors. Anonymous reads scoped to published events,
  and create / update / delete / export behind the sponsors-manage capability
  (`SponsorsController.cs:30-34`).
- **Depends on**:
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`SponsorsController.cs:49-50`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:41`); three [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`SponsorCreateRequest`](group-18-conference-application.md#sponsorcreaterequest), the framework's
  [`UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>`](group-05-cqrs-pipeline.md#updateentitycommandtentity-tupdaterequest-tidentifiertype)
  and
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  (`:42-44`); an [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicSponsorFilterQuery`](group-18-conference-application.md#getpublicsponsorfilterquery) (`:45`);
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) plus the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) read-audience helper (`:46, 53`);
  `IOutputCacheStore` (`:47`); the [`SponsorDTO`](group-17-conference-domain.md#sponsordto);
  [`SponsorUpdateRequest`](group-18-conference-application.md#sponsorupdaterequest) as the PUT body; the
  [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) with the
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) catalog; the
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute); and the
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder).
- **Concept introduced, a real parent column instead of a virtual filter key.** `[Rubric §9, API &
  Contract Design]` assesses whether a contract expresses scoping honestly rather than through special
  cases. Compare this controller with [`SpeakersController`](#speakerscontroller): there, `EventId` is
  *not* a column on the aggregate, so the paged action must intercept the key, remove it from the filter
  dictionary and translate it into a specification. Here the doc comments record the opposite situation,
  that `Sponsor` carries a real `EventId` column, so an event-scoped request travels through the generic
  filter pipeline unchanged and the hook only adds the published-event rule on top of it (`:55-68, 99-104`).
  The published rule and the caller's filter are composed by the query service rather than substituted, so
  scoping to an unpublished event returns an empty page to a non-privileged caller instead of leaking the
  roster. That is why this controller, like its [`ActivitiesController`](#activitiescontroller) twin and
  unlike the speaker and session roots, has no filter-interception block at all.
  `[Rubric §11, Security]`: the class carries a bare `[Authorize]` (`:39`) and each mutation re-asserts
  `[HasPermission(ConferencePermissions.SponsorsManage)]` (`:152, 171, 190, 215`), the capability declared
  at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:33`
  and included in the `ContentManagement` curation subset (`ConferencePermissions.cs:70-79`), so a content
  editor can manage the sponsor roster without holding event, room or question rights. `[Rubric §12,
  Performance & Scalability]`: reads run under the `SponsorsCache` policy (5-minute TTL, tags `conference`
  and `conference:sponsors`, `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:279`) and
  every mutation evicts both tags (`:177, 209, 221`).
- **Walkthrough**: the file is line-for-line the structural twin of
  [`ActivitiesController`](#activitiescontroller), so every member sits at the same line number in both.
  `IsPrivileged` (`SponsorsController.cs:53`) is the shared read-audience check; `GetReadSpecificationAsync`
  (`:69-79`) returns `null` for a privileged reader and otherwise the specification the
  `GetPublicSponsorFilterQuery` handler resolves, degrading to `null` on a failed result.
  `AllowUnscopedExport => IsPrivileged` (`:87`, doc `:81-86`) opts the fail-closed inherited export
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:272-274`) in to the
  unscoped table only for that privileged audience. The four reads (`:89, 105, 120, 132`, the last under
  the named route `"GetSponsorById"`) are `[AllowAnonymous]` +
  `[OutputCache(PolicyName = "SponsorsCache")]` passthroughs; the by-id doc comment states that a sponsor
  of an unpublished event is a 404, "not a redacted record, so a guessed id cannot confirm that a
  sponsorship was sold" (`:128-131`). `ExportAsync` (`[HttpGet("export")]` at `:151`) is the strongest
  export gate in this unit alongside [`SpeakersController`](#speakerscontroller)'s: the declarative
  `[HasPermission(ConferencePermissions.SponsorsManage)]` (`:152`) plus the imperative
  `if (!IsPrivileged) return Forbid();` (`:163`), with the doc comment naming the commercial hazard an
  unscoped CSV would create, confirming sponsorships that have not been announced (`:143-150`).
  `CreateAsync` (`[HttpPost]` at `:170`) and `DeleteAsync` (`[HttpDelete("{id}")]` at `:214`) call the
  base and evict; `UpdateAsync` (`[HttpPut("{id}")]` at `:189`) reads the required `If-Match` token
  (`:200`), dispatches the generic
  `UpdateEntityCommand<Sponsor, SponsorUpdateRequest, SponsorIdentifierType>` (`:203`), folds a failure
  through `HandleFailure` (`:207`), evicts (`:209`) and returns `Ok(result.Value)` (`:210`).
- **Why it's built this way**: sponsors are commercially sensitive before an event is announced but fully
  public afterwards, which is the same published-event rule the rest of the catalog follows, so the
  controller reuses the specification hook rather than inventing a sponsor-specific visibility flag.
  Because the aggregate owns a real `EventId`, none of that scoping needs a virtual key, which keeps this
  the simplest of the scope-carrying aggregate-root controllers.
- **Where it's used**: hosted by `MMCA.ADC.Conference.Service` and reached through the YARP Gateway, which
  forwards `/Sponsors/{**catch-all}` to the Conference service
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:134`). Clients are the public sponsor page
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Sponsors/PublicSponsorList.razor`) and
  the organizer sponsor list, create and detail pages under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsor/`. Export authorization is
  covered by
  `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Conventions/EntityExportAuthorizationTests.cs`
  and `UpdateAsync`'s conditional-write contract by
  `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Conventions/ConditionalWriteConventionTests.cs`.

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
  `ThrowIfFailure()`. `[Rubric §15, Best Practices & Code Quality]`: adding a cross-service method means adding an RPC to
  the proto and one near-identical override here and on the adapter, a pattern a reviewer can verify at a
  glance.
- **Where it's used**: mapped in the Conference host as
  `app.MapGrpcService<SessionBookmarksGrpcService>().RequireAuthorization()`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:461`). The `RequireAuthorization()` is
  deliberate and explained inline (`Program.cs:454-460`): these RPCs answer conference-state questions
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:154-163`, `:177-186`), and a
  missing `error-{i}-type` falls back to `ErrorType.Failure` rather than throwing. Structured trailers win
  when present; a transport-level fault carrying none (connection reset, deadline exceeded) degrades to a
  single `Grpc.{StatusCode}` failure sourced with the calling method's name, which the decoder captures via
  `[CallerMemberName]` (`ResultGrpcExtensions.cs:216`, `:234`). The practical consequence is stated in the
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
    only through the public [DependencyInjection](#dependencyinjection-1) helper in the same assembly, which
    is the intended (and only) way to install it.
- **Why it's built this way**: ADR-007 again. The consumer's application code is written against the C#
  interface and never learns which implementation it got, so extraction is a DI edit rather than a code
  change. Keeping the adapter next to the `.proto` files in the `.Contracts` project
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/MMCA.ADC.Conference.Contracts.csproj`) means a
  consumer takes exactly one reference to get the contract, the generated stubs and the adapter together.
  `[Rubric §3, Clean Architecture]`: the dependency still points inward, since the adapter depends on
  `Conference.Shared`'s interface and not the other way round.
- **Where it's used**: registered by `AddConferenceSessionValidationClient()` (see
  [DependencyInjection](#dependencyinjection-1)), which the Engagement host calls
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:283`). Its eventual consumers are
  [CreateBookmarkHandler](group-22-engagement-module.md#createbookmarkhandler) and
  [GetUserBookmarksHandler](group-22-engagement-module.md#getuserbookmarkshandler) behind
  [BookmarksController](group-22-engagement-module.md#bookmarkscontroller)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:230-236`).

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
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:462`). The named callers are
  Engagement's [LivePollsController](group-23-engagement-live-layer.md#livepollscontroller) and
  [SessionQuestionsController](group-23-engagement-live-layer.md#sessionquestionscontroller) handlers
  (`Program.cs:457-459`).

### EventLiveValidationServiceGrpcAdapter
> MMCA.ADC.Conference.Contracts · `MMCA.ADC.Conference.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/EventLiveValidationServiceGrpcAdapter.cs:27` · Level 11 · class (internal, sealed)

- **What it is**: the client half of the live-layer boundary. It implements
  [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) over the
  generated gRPC client and reconstructs the domain read models from the proto responses.
- **Depends on**: the generated `EventLiveValidationService.EventLiveValidationServiceClient`
  (`EventLiveValidationServiceGrpcAdapter.cs:27-28`); the interface it implements (`:28`); the read models
  [EventLiveInfo](group-17-conference-domain.md#eventliveinfo),
  [SessionLiveInfo](group-17-conference-domain.md#sessionliveinfo),
  [SponsorLiveInfo](group-17-conference-domain.md#sponsorliveinfo),
  [RoomSessionInfo](group-17-conference-domain.md#roomsessioninfo) and the
  [QuestionModerationDefault](group-17-conference-domain.md#questionmoderationdefault) enum;
  [Result](group-01-result-error-handling.md#result) in its generic form, with
  [Error](group-01-result-error-handling.md#error) and
  [ErrorType](group-01-result-error-handling.md#errortype) for the malformed-response failure; and the
  same `RpcException.ToResult<T>` decoder from
  [ResultGrpcExtensions](group-13-grpc-contracts.md#resultgrpcextensions). Externals: `Grpc.Core`,
  `System.Guid`, `System.Enum`.
- **Concept introduced**: none new. This is the mirror image of
  [SessionBookmarkValidationServiceGrpcAdapter](#sessionbookmarkvalidationservicegrpcadapter): the same
  5 second `CallDeadline` (`EventLiveValidationServiceGrpcAdapter.cs:34`, justified at `:31-33` because
  these lookups gate live-layer commands such as opening a poll or submitting a question), the same
  `try` / `catch (RpcException ex)` around every call, and the same `ex.ToResult<T>()` decode of the
  `error-{i}-*` trailers. What repays close reading here is the **decoding** side of the wire
  representations the server chose, and the rule that wire data the adapter cannot map is a failure
  `Result`, the same shape a transport fault takes, never an exception that escapes the `RpcException`
  catch (`:80-81`).
  - `DateTimeOffset.FromUnixTimeSeconds(response.LiveWindowStartUnixSeconds).UtcDateTime` (`:53-54`,
    `:106-107`) is the exact inverse of the server's encoding, and `.UtcDateTime` is what restores a UTC
    `DateTime` rather than a local one. Getting that property wrong is the classic way a live window
    silently shifts by the host's offset.
  - The string speaker identifiers are parsed back one at a time with `Guid.TryParse` into a pre-sized
    `List<SpeakerIdentifierType>` (`:82-93`). A value that is not a GUID short-circuits the call with
    `MalformedResponse<SessionLiveInfo>("speaker_ids contains a value that is not a GUID.", ...)`
    (`:85-90`) instead of throwing a `FormatException` past the catch.
  - `(QuestionModerationDefault)response.QuestionModerationDefault` (`:95`) casts the `int` back to the
    enum, the half of the enum contract that depends on the two assemblies agreeing on ordering, and
    `Enum.IsDefined` (`:96-101`) turns an out-of-range value into the same malformed-response failure
    rather than letting an undefined enum value reach Engagement.
  - `MalformedResponse<T>(message, source)` (`:182-188`) builds that failure the way the framework's
    `RpcException.ToResult` builds a transport fault: one `ErrorType.Failure` error with code
    `Grpc.MalformedResponse`, sourced with the calling method's name (`:188`). A caller cannot tell a
    garbled reply from a refused one by shape, only by code.

  `[Rubric §9, API & Contract Design]` and `[Rubric §29, Resilience & Business Continuity]` apply as in the
  sibling adapter.
- **Walkthrough**: four methods, one per RPC, each identical in shape (build request, call with deadline and
  token, project the response into the read model, catch `RpcException` and decode).
  - `GetEventLiveInfoAsync(eventId, ct)` (`:36-63`): returns
    `Result.Success(new EventLiveInfo(response.IsPublished, start, end))` (`:51-54`).
  - `GetSessionLiveInfoAsync(sessionId, ct)` (`:65-119`): validates the speaker ids (`:82-93`) and the
    moderation default (`:95-101`) as described above, then the seven-argument `SessionLiveInfo`
    reconstruction (`:103-110`).
  - `GetSponsorLiveInfoAsync(sponsorId, ct)` (`:121-148`):
    `new SponsorLiveInfo(response.EventId, response.IsPublished, response.SponsorName)` (`:136-139`).
  - `GetCurrentRoomSessionInfoAsync(roomId, graceMinutes, ct)` (`:150-180`): puts `GraceMinutes` on the
    request (`:159-163`) and rebuilds
    `new RoomSessionInfo(response.SessionId, response.SessionTitle, response.EventId, response.IsPublished)`
    (`:167-171`).
  - Every catch block returns `ex.ToResult<T>()` for the matching `T` (`:61`, `:117`, `:146`, `:178`), so a
    Conference outage is uniformly a `Result` failure across all four lookups rather than an exception on
    some paths and a failure on others; with `MalformedResponse` the same holds for a reply that arrives
    but cannot be mapped.
- **Why it's built this way**: ADR-007. The class doc notes the specific consequence for this pair
  (`EventLiveValidationServiceGrpcAdapter.cs:13-16`): the in-process implementation **or** the disabled stub
  is replaced with this adapter at the composition root, since Conference runs as its own microservice, and
  Engagement's live handlers never learn which one they got. `[Rubric §14, Testability]`: because the
  interface is the only thing consumers see, an Engagement test substitutes a fake with no gRPC server in
  sight.
- **Where it's used**: registered by `AddConferenceEventLiveValidationClient()` (see
  [DependencyInjection](#dependencyinjection-1)), called from the Engagement host
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:284`). Consumers are Engagement's
  live-poll and session-question handlers (`Program.cs:237-238`).

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:87`). Externals:
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
  [primer §4](00-primer.md#4-c-build-and-code-style-conventions)). Both methods are the same three steps.
  - `AddConferenceSessionValidationClient(string serviceName = "conference")` (`:43-52`):
    `services.AddTypedGrpcClient<SessionBookmarkValidationService.SessionBookmarkValidationServiceClient>(serviceName)`
    (`:45`), then
    `services.Replace(ServiceDescriptor.Scoped<ISessionBookmarkValidationService, SessionBookmarkValidationServiceGrpcAdapter>())`
    (`:49`), then `return services` for chaining (`:51`).
  - `AddConferenceEventLiveValidationClient(string serviceName = "conference")` (`:73-82`): identical, for
    the live-validation client and adapter (`:75`, `:79`).
  - The `serviceName` default is `"conference"`, chosen to match the AppHost resource name (`:41-42`,
    `:71-72`). `AddTypedGrpcClient` turns that name into the address `http://{serviceName}`
    (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:96-97`), which Aspire service
    discovery resolves. A typo in the name is a runtime resolution failure, not a compile error, which is
    why the default exists at all.
  - Everything else the client needs comes from `AddTypedGrpcClient`, not from here: the
    [JwtForwardingClientInterceptor](group-13-grpc-contracts.md#jwtforwardingclientinterceptor) that
    forwards the caller's bearer token
    (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:93`, `:77`), an explicit
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
  `[Rubric §15, Best Practices & Code Quality]`: a reader who wants to know how Engagement reaches Conference finds the
  whole answer in one 84-line file.
- **Where it's used**: the Engagement service host calls both inside its application-pipeline registration,
  in the documented order after `moduleHost.RegisterModules`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:282-284`), with the rationale for each
  written out immediately above (`Program.cs:230-238`). The AppHost declares the matching Engagement to
  Conference reference (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:270`).
- **Caveats / not-in-source**: the "call this after `DiscoverAndRegister`" requirement is carried by
  convention and by the doc comments only. Nothing in this file detects a too-early call.


---
[⬅ ADC Conference - Infrastructure & Persistence](group-19-conference-infrastructure.md)  •  [Index](00-index.md)  •  [ADC Conference - UI ➡](group-21-conference-ui.md)
