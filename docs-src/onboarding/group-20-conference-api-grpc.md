# 20. ADC Conference - API, gRPC Contracts & Service Host

**What this chapter covers.** This is the **edge of the Conference bounded context**, the layer that turns the rich Conference domain ([G17](group-17-conference-domain.md)) and its CQRS slices ([G18](group-18-conference-application.md)) into a running HTTP + gRPC surface, plus the small amount of glue that lets that surface be hosted **either** inside a co-located host **or** as its own extracted microservice (`MMCA.ADC.Conference.Service`) with no change to the application code beneath. Almost nothing here is novel: the controllers are thin shells over the generic REST machinery taught in [G12 (API Hosting, Middleware & DTO Mapping)](group-12-api-hosting-mapping.md), the gRPC pieces are concrete instances of the transport boundary taught in [G13 (gRPC & Inter-Service Contracts)](group-13-grpc-contracts.md), and the module entry point is one implementation of the [`IModule`](group-14-module-system-composition.md#imodule) contract from [G14 (Module System & Composition)](group-14-module-system-composition.md). What this chapter teaches is *how the Conference module wires those reusable pieces into a real, seventeen-controller, twice-gRPC-edged conference API*, and the handful of places where it deviates from the generic shape for a genuine business reason. The headline rubric lenses are `[Rubric §9, API & Contract Design]` (a consistent, versioned REST + gRPC contract), `[Rubric §5, Vertical Slice]` and `[Rubric §6, CQRS & Event-Driven]` (each action dispatches to a single command/query handler), and `[Rubric §7, Microservices Readiness]` (the same code runs in-process or extracted). Everything lives in three projects: `MMCA.ADC.Conference.API` (the REST controllers, the [`ConferenceModule`](#conferencemodule) entry point, the [`ConferenceModuleSeeder`](#conferencemoduleseeder)), `MMCA.ADC.Conference.Service` (the host wiring plus the gRPC servers), and `MMCA.ADC.Conference.Contracts` (the client-side gRPC adapters and the contract-package DI).

## The controller hierarchy, almost everything is inherited

The Conference API exposes **seventeen controllers**, and the striking thing about them is how little code each carries. They split into three structural families, all built on the generic controller bases from [G12](group-12-api-hosting-mapping.md). **Aggregate-root controllers** (seven: [`SessionsController`](#sessionscontroller), [`SpeakersController`](#speakerscontroller), [`EventsController`](#eventscontroller), [`QuestionsController`](#questionscontroller), [`ConferenceCategoriesController`](#conferencecategoriescontroller), [`SponsorsController`](#sponsorscontroller), [`ActivitiesController`](#activitiescontroller)) derive from [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest) and inherit the full read + create + delete surface, often only `override`-ing actions to add `[AllowAnonymous]`, an `[OutputCache]` policy, or a business rule ([`SessionsController`](#sessionscontroller) derives from that base at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionsController.cs:54`, [`EventsController`](#eventscontroller) at `EventsController.cs:58`, [`QuestionsController`](#questionscontroller) at `QuestionsController.cs:38`, [`ConferenceCategoriesController`](#conferencecategoriescontroller) at `ConferenceCategoriesController.cs:39`, [`SpeakersController`](#speakerscontroller) at `SpeakersController.cs:59`, [`SponsorsController`](#sponsorscontroller) at `SponsorsController.cs:46`, [`ActivitiesController`](#activitiescontroller) at `ActivitiesController.cs:46`). **Child-and-join controllers** (eight: [`RoomsController`](#roomscontroller), [`CategoryItemsController`](#categoryitemscontroller), [`EventSpeakersController`](#eventspeakerscontroller), [`SessionSpeakersController`](#sessionspeakerscontroller), [`SessionCategoryItemsController`](#sessioncategoryitemscontroller), [`SpeakerCategoryItemsController`](#speakercategoryitemscontroller), [`EventQuestionAnswersController`](#eventquestionanswerscontroller), [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller)) derive from the read-oriented [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype) (`RoomsController.cs:101`, `CategoryItemsController.cs:69`, `EventSpeakersController.cs:55`, `SessionSpeakersController.cs:56`, `SessionCategoryItemsController.cs:56`, `SpeakerCategoryItemsController.cs:56`, `EventQuestionAnswersController.cs:64`, `SessionQuestionAnswersController.cs:64`) and add their own `POST`/`PUT`/`DELETE` actions by hand, because they manipulate a *child* of an aggregate (a room belongs to an event, a category item to a category) and so their write commands carry a parent identifier the generic create/delete cannot supply. And **bespoke controllers** (two: [`ServiceInfoController`](#serviceinfocontroller) and [`SessionSelectionController`](#sessionselectioncontroller)) sit apart: `SessionSelectionController` derives from Common's [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSelectionController.cs:37`) and `ServiceInfoController` from the shared [`ServiceInfoControllerBase`](group-12-api-hosting-mapping.md#serviceinfocontrollerbase) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:20`), because neither exposes a CRUD entity at all.

The reason a concrete controller can be short is that the generic bases already supply `GET` (capped, returning [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt)), `GET /paged` (filtered/sorted/paged, returning [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt)), `GET /lookup` (id+name pairs as [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) for dropdowns), `GET /{id}`, `GET /export` (a streamed CSV), and, on the aggregate base, `POST` (to `201 Created`) and `DELETE` (to `204`). Each Conference controller's constructor simply injects the [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype) for reads and the specific [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) / [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) instances for its writes and bespoke reads (`SessionsController.cs:42-53`), then folds any `Result.Failure` back through the inherited `HandleFailure` (`SessionsController.cs:242`, `SessionSelectionController.cs:50`). That is the `[Rubric §1, SOLID]` / `[Rubric §16, Maintainability & Evolvability]` payoff the generic base exists for (the generic-controller + dynamic-query contract of [ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html)): the CRUD logic is written once in Common, and a per-entity controller has almost no reason to change.

## Authorization at the edge, three shapes not one

Authorization is **capability-based by default but not uniform**, and the differences are the interesting part. Most write-bearing controllers carry a class-level [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) gate naming one [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) capability rather than a role policy: `SessionsManage` on [`SessionsController`](#sessionscontroller) (`SessionsController.cs:41`) and on the two session-join controllers (`SessionSpeakersController.cs:47`, `SessionCategoryItemsController.cs:47`), `EventsManage` (`EventsController.cs:44`, `EventSpeakersController.cs:46`), `RoomsManage` (`RoomsController.cs:91`), `CategoriesManage` (`ConferenceCategoriesController.cs:31`, `CategoryItemsController.cs:61`), `QuestionsManage` (`QuestionsController.cs:30`), `SpeakersManage` (`SpeakerCategoryItemsController.cs:47`), and `SessionSelectionManage` (`SessionSelectionController.cs:29`). Reads are then re-opened action by action with `[AllowAnonymous]` (BR-43 public browse, for example `SessionsController.cs:126`, `RoomsController.cs:131`). Nine capability constants exist in total, declared once in `ConferencePermissions.All` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:39-50`).

Three shapes break that pattern, and knowing why saves you from "fixing" them. [`SpeakersController`](#speakerscontroller) carries only a plain `[Authorize]` at class level (`SpeakersController.cs:43`) and pushes `[HasPermission(ConferencePermissions.SpeakersManage)]` down onto the individual organizer write actions (`SpeakersController.cs:290,309,353,365,384`), because one of its writes is an authenticated self-service surface: the BR-214 profile update re-declares plain `[Authorize]` (`SpeakersController.cs:327-328`) and then decides inside the action whether the caller is an organizer or the speaker themselves, by comparing the `speaker_id` JWT claim to the route id and passing the answer down as `CallerIsOrganizer` so the handler can refuse a self-edit of the organizer-only `IsTopSpeaker` field (`SpeakersController.cs:334-341`). [`SponsorsController`](#sponsorscontroller) and [`ActivitiesController`](#activitiescontroller) copy that shape for the same mechanical reason (`SponsorsController.cs:36`, `ActivitiesController.cs:36`, with per-action `SponsorsManage` at `SponsorsController.cs:193,212,224,243` and `ActivitiesManage` at `ActivitiesController.cs:193,212,224,243`): a bare `[Authorize]` is what the *inherited* export action needs to pick up, so the capability is declared per action instead. And [`EventQuestionAnswersController`](#eventquestionanswerscontroller) / [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller) gate on `[Authorize(Policy = AuthorizationPolicies.RequireAuthenticated)]` instead (`EventQuestionAnswersController.cs:56`, `SessionQuestionAnswersController.cs:56`), because *any* signed-in attendee may submit feedback answers, so no organizer capability applies. Which roles hold which capability is declared once in `AddModuleConferenceAPI` (see below), the permission-over-RBAC model of [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html); `[Rubric §11, Security]` is the lens, and these exceptions are the evidence that the model is applied per endpoint rather than pasted.

Orthogonal to all three shapes is the **read audience**, which no attribute can express because it changes the *rows* rather than the verdict. Ten controllers ask [`CurrentUserServiceExtensions`](#currentuserserviceextensions)`.IsPrivilegedConferenceReader()` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Authorization/CurrentUserServiceExtensions.cs:24`) and turn the answer into a specification or `null`: `SessionsController.cs:58`, `SpeakersController.cs:63`, `EventsController.cs:68`, `SponsorsController.cs:50`, `ActivitiesController.cs:50`, `RoomsController.cs:104`, `EventSpeakersController.cs:58`, `SessionSpeakersController.cs:59`, `SessionCategoryItemsController.cs:59`, and `SpeakerCategoryItemsController.cs:59`. The helper is one line over `ICurrentUserService` (`CurrentUserServiceExtensions.cs:25`) and answers against the [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience)`.PrivilegedRoles` list declared once in G17 (Organizer and ContentEditor, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferenceReadAudience.cs:91-95`), with an explicit remark in its own doc comment that this is a read-visibility check and never a substitute for a `[HasPermission(...)]` gate (`CurrentUserServiceExtensions.cs:20-23`). The two feedback-answer controllers use a different scoping axis for the same purpose: BR-8 narrows an attendee to their own answers through an [`OwnedByUserSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ownedbyuserspecificationtentity-tidentifiertype) built from the caller's user id, or `null` for an Organizer (`EventQuestionAnswersController.cs:67-68`, applied at `:81,109,145`).

The read audience closes a specific hole worth naming, because it recurs in eleven files and is easy to reintroduce. The framework's inherited CSV export streams with **no** specification, so a non-privileged caller would receive the unfiltered catalog in one file: declined sessions, draft events, hidden speakers, unannounced sponsorships and activities. Every controller whose reads are row-filtered therefore overrides `ExportAsync` and returns `Forbid()` for a non-privileged caller rather than serving a scoped file (`SessionsController.cs:251-266` BR-49/BR-132, `SpeakersController.cs:289-305` BR-239, `EventsController.cs:186-201` BR-108, `SponsorsController.cs:192-208` BR-108, `ActivitiesController.cs:192-208` BR-108, and the four join controllers at `EventSpeakersController.cs:193,203`, `SessionSpeakersController.cs:194,204`, `SessionCategoryItemsController.cs:194,204`, `SpeakerCategoryItemsController.cs:194,204`); the two answer controllers do the same against the Organizer role, matching their BR-8 row scope (`EventQuestionAnswersController.cs:159-174`, `SessionQuestionAnswersController.cs:159-174`). Privileged readers already read everything and may export it. The controllers with a class-level capability gate and no anonymous export ([`RoomsController`](#roomscontroller), [`CategoryItemsController`](#categoryitemscontroller), [`QuestionsController`](#questionscontroller), [`ConferenceCategoriesController`](#conferencecategoriescontroller)) need no such override, because their inherited export is still behind the class attribute. That is `[Rubric §11, Security]` again, applied to the one action a generic base cannot make safe on its own.

## The request records, the inbound write shapes

Several controllers declare small `record class` request types alongside themselves, co-located in the same file: [`AddRoomRequest`](#addroomrequest)/[`UpdateRoomRequest`](#updateroomrequest) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:30,58`), [`AddCategoryItemRequest`](#addcategoryitemrequest)/[`UpdateCategoryItemRequest`](#updatecategoryitemrequest) (`CategoryItemsController.cs:25,41`), [`AddEventSpeakerRequest`](#addeventspeakerrequest) (`EventSpeakersController.cs:29`), [`AddSessionSpeakerRequest`](#addsessionspeakerrequest) (`SessionSpeakersController.cs:29`), [`AddSpeakerCategoryItemRequest`](#addspeakercategoryitemrequest) (`SpeakerCategoryItemsController.cs:29`), [`AddSessionCategoryItemRequest`](#addsessioncategoryitemrequest) (`SessionCategoryItemsController.cs:29`), [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest)/[`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest) (`EventQuestionAnswersController.cs:27,40`), and [`AddSessionQuestionAnswerRequest`](#addsessionquestionanswerrequest)/[`UpdateSessionQuestionAnswerRequest`](#updatesessionquestionanswerrequest) (`SessionQuestionAnswersController.cs:27,40`). These are the **wire shapes** for the child-entity writes the generic base cannot model: each carries the parent identifier (`EventId` at `RoomsController.cs:33`) plus the child's own fields, all `required`/`init` for immutability (`RoomsController.cs:30-55`), and the controller action unpacks the record positionally into the matching `Add*Command`/`Update*Command` from [G18](group-18-conference-application.md) (`RoomsController.cs:262-272` on create, `:291-301` on update, `:317-319` on delete). They are deliberately separate from the inbound *application* command types (and from the outbound DTOs), the §9 "DTOs decoupled from entities" discipline, so the HTTP contract can evolve independently of the command's parameter list. The aggregate-root controllers, by contrast, reuse the application layer's create-request command directly (for example [`SessionsController`](#sessionscontroller) binds `SessionCreateRequest` as its `TCreateRequest`, `SessionsController.cs:54`), so they need no per-controller record.

## Where the generic shape gives way: filtering, warnings, and calendars

[`SessionsController`](#sessionscontroller) is the best illustration of *how* a controller earns its overrides. Every read action is `[AllowAnonymous]` and `[OutputCache(PolicyName = "SessionsCache")]` (`SessionsController.cs:125-127,151-153,200-202,222-224,272-274`), and the reads thread a specification built by `BuildPublicSessionSpecificationAsync` (`SessionsController.cs:67`), which returns `null` for privileged readers and otherwise dispatches the [`GetPublicSessionFilterQuery`](group-18-conference-application.md#getpublicsessionfilterquery) handler so non-organizers never see declined sessions (BR-132/BR-49). The cross-source part matters: `Session` and `Event` can live in different data sources, so the published-event check is resolved by that handler through the framework's cross-source specification helper rather than by a join (`SessionsController.cs:60-66`; [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). The paged read adds a second layer, `BuildPagedSessionSpecificationAsync` (`SessionsController.cs:96`): `Session` has no `SpeakerId` column, so that filter key is intercepted and `Remove`d before the generic filter pipeline can reject it, resolved to an id list through [`GetSessionsBySpeakerFilterQuery`](group-18-conference-application.md#getsessionsbyspeakerfilterquery), and **ANDed** with the public filter via [`AndSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#andspecificationtentity-tidentifiertype) rather than substituted for it (`SessionsController.cs:102-118`), because substituting would leak non-accepted sessions to anonymous callers; an unparseable value simply ignores the key (`SessionsController.cs:104`).

The `GET /lookup` action is worth internalizing as a family, because five controllers override it for the same reason. A lookup returns id plus label pairs and is anonymous, so left inherited it becomes a side channel that names exactly the rows the list and detail endpoints hide. Each of [`SessionsController`](#sessionscontroller) (`SessionsController.cs:200-220`), [`EventsController`](#eventscontroller) (`EventsController.cs:135-155`), [`RoomsController`](#roomscontroller) (`RoomsController.cs:200-220`), [`SponsorsController`](#sponsorscontroller) (`SponsorsController.cs:136-156`) and [`ActivitiesController`](#activitiescontroller) (`ActivitiesController.cs:136-156`) therefore short-circuits to the base action when the specification is `null` (a privileged reader) and otherwise forwards `specification.Criteria` to the query service as the lookup filter. [`SpeakersController`](#speakerscontroller) goes one step further and also constrains the *label*: only `FirstName` and `LastName` may be requested by a non-privileged caller (`SpeakersController.cs:66,219-230`), because `nameProperty=Email` would project the speaker email straight into the label and go around the DTO mapper that redacts it (BR-66).

The same controller adds three things the base has no notion of. A `PUT /{id}` update that surfaces a BR-86 `X-Warning` header when the update handler reports `HasDateRangeWarning` (`SessionsController.cs:323-344`), with the matching check done inline on create by comparing the request times against the event's `StartDate`/`EndDate` (`SessionsController.cs:302-316`). A `GET /{id}/ics` action that streams one public session as a `text/calendar` document for the add-to-calendar affordance (`SessionsController.cs:272-283`) via [`ExportSessionCalendarQuery`](group-18-conference-application.md#exportsessioncalendarquery). And an explicit [`Idempotent`](group-12-api-hosting-mapping.md#idempotentattribute) declaration on the create override (`SessionsController.cs:291`) so the `Idempotency-Key` contract is visible at the ADC endpoint rather than only inherited (the attribute is single-use, so the declaration coincides with the inherited one instead of duplicating it, `SessionsController.cs:285-289`). Every mutating action finishes by calling `EvictSessionsCacheAsync`, which evicts both the `conference:sessions` and `conference` output-cache tags (`SessionsController.cs:318,342,353,357-361`), the write-side half of the caching contract.

[`EventsController`](#eventscontroller) follows the same recipe and adds its own `GET /{id}/ics` (`EventsController.cs:207-218`) plus per-event and global `now-next` snapshot actions under the short-lived `NowNextCache` policy (`EventsController.cs:224-247`), both dispatching [`GetNowNextQuery`](group-18-conference-application.md#getnownextquery) and returning a [`NowNextDTO`](group-17-conference-domain.md#nownextdto); the id-less form exists because the home-screen widget has no event id to pass (`EventsController.cs:239-247`). Its read filter is the simplest of the group, a plain [`PublishedEventSpecification`](group-18-conference-application.md#publishedeventspecification) or `null` (`EventsController.cs:67-68`), because `Event` owns its own publish flag. It also carries the publish, unpublish, and Sessionize-refresh commands that have no generic equivalent (`EventsController.cs:310,341,367`). Publish and unpublish state their precondition two ways: an optional body carrying the client's last-seen rowversion for the [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html) stale-view check, and a [`SupportsIfMatch`](group-12-api-hosting-mapping.md#supportsifmatchattribute) declaration (`EventsController.cs:307,338`) that lets the same token arrive as an HTTP `If-Match` header, in which case a stale token answers `412` instead of `409` (`EventsController.cs:291-309`). The refresh maps two domain error codes onto HTTP `429` (with a `Retry-After: 300`) and `502` (`EventsController.cs:377-386`). Cache eviction is proportional to blast radius: an ordinary event write evicts only `conference:events` (`EventsController.cs:416-417`), a delete also evicts sessions and rooms (`EventsController.cs:410-412`), and a Sessionize refresh evicts all six tags it can touch (`EventsController.cs:392-397`). `[Rubric §12, Performance & Scalability]` is the lens for the whole caching story here.

Three read-path carve-outs are worth internalizing before you touch these files. [`SpeakersController`](#speakerscontroller)`.GetByIdAsync` normally applies the BR-239 public-speaker specification, but drops it when the caller's `speaker_id` claim equals the route id, because the self-edit form cannot load without reading the profile it edits; and because the output-cache key does not vary by caller, that same branch turns storage off for the response through `IOutputCacheFeature` so a private profile can never land in the shared entry (`SpeakersController.cs:253-267`). The same controller's per-session feedback read is gated self-or-organizer in code and deliberately left uncached, since every response is authorization-dependent (`SpeakersController.cs:406-425`), while its two bookmark-count reads are anonymous under the short-TTL `BookmarkCountsCache` policy (`SpeakersController.cs:429-431,449-451`). And [`SponsorsController`](#sponsorscontroller), with [`ActivitiesController`](#activitiescontroller) as its twin, is the mirror image of the Sessions filter problem: `Sponsor` and `Activity` each carry a real `EventId` column, so an event-scoped request goes through the generic filter pipeline unchanged and the published-event specification from [`GetPublicSponsorFilterQuery`](group-18-conference-application.md#getpublicsponsorfilterquery) / [`GetPublicActivityFilterQuery`](group-18-conference-application.md#getpublicactivityfilterquery) is ANDed on top of it rather than intercepted, which means scoping to an unpublished event yields an empty page instead of leaking the roster (`SponsorsController.cs:60-70,94-99`, `ActivitiesController.cs:60-70,94-99`). Their `PUT /{id}` dispatches [`UpdateSponsorCommand`](group-18-conference-application.md#updatesponsorcommand) / [`UpdateActivityCommand`](group-18-conference-application.md#updateactivitycommand) and, like every other mutation on those two, evicts the entity tag plus `conference` (`SponsorsController.cs:225-239,253-257`, `ActivitiesController.cs:225-239,253-257`).

## Two more deviations, versioning and decision support

[`ServiceInfoController`](#serviceinfocontroller) exists to **prove the API-versioning machinery works beyond a single version** (`[Rubric §9, API & Contract Design]`). It is a one-member shell over Common's [`ServiceInfoControllerBase`](group-12-api-hosting-mapping.md#serviceinfocontrollerbase): it overrides only `ServiceName => "Conference"` (`ServiceInfoController.cs:23`) and carries the class-level `[AllowAnonymous]`, `[ApiVersion("1.0", Deprecated = true)]`, and `[ApiVersion("2.0")]` attributes (`ServiceInfoController.cs:17-19`), which are placed here because they are not reliably inherited from the base (`ServiceInfoController.cs:11-13`). The shared base serves the same `/ServiceInfo` route at two API versions selected by the `api-version` header: `1.0` (deprecated) returns the minimal shape, `2.0` the evolved shape that also advertises the supported and deprecated version lists. Every other Conference controller declares a single `[ApiVersion("1.0")]`; this one demonstrates the deprecation story end to end.

[`SessionSelectionController`](#sessionselectioncontroller) is the most behaviour-rich controller in the group and the one furthest from the generic shape. It is **organizer-only** (`[HasPermission(ConferencePermissions.SessionSelectionManage)]`, `SessionSelectionController.cs:29`) decision support over an event's session pool: a composite dashboard, category distribution, speaker overlap, and content similarity, each `GET` delegating to a dedicated [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) and output-cached under the `ConferenceCache` policy (`SessionSelectionController.cs:40-41,54-55,68-69,82-83`; content similarity also takes a `minimumSimilarity` threshold defaulting to `0.3`, `SessionSelectionController.cs:86`). Its `POST score/{eventId}` action is the notable one: AI scoring of every eligible session can take minutes, so the action does not run the work at all. It calls [`ISessionScoringQueue`](group-18-conference-application.md#isessionscoringqueue)`.TryEnqueue(eventId)` and switches on the returned [`SessionScoringEnqueueResult`](group-18-conference-application.md#sessionscoringenqueueresult) (`SessionSelectionController.cs:110-131`): `Queued` logs through a `[LoggerMessage]`-sourced structured log and returns `202 Accepted` (`SessionSelectionController.cs:114-116,133-134`, `[Rubric §13, Observability & Operability]`), while `AlreadyPending` and `QueueFull` both fold into a `409 Conflict` through `HandleFailure` with distinct error codes (`SessionSelectionController.cs:118-129`). Refusing a second concurrent run is a cost decision stated in the source: each pass issues one paid Anthropic call per session, so two passes would double the spend while racing each other's writes (`SessionSelectionController.cs:101-105`, `[Rubric §31, Cost/FinOps]`). The same reasoning drives an explicit [`NonIdempotent`](group-12-api-hosting-mapping.md#nonidempotentattribute) declaration with a written justification (`SessionSelectionController.cs:107`): the queue already deduplicates, so replaying a cached `202` would report acceptance for a request the queue never saw and hide both the already-running refusal and a queue-full rejection the caller has to act on. The actual work runs on the background [`SessionScoringProcessor`](group-19-conference-infrastructure.md#sessionscoringprocessor) in [G19](group-19-conference-infrastructure.md), which keeps the controller free of any scope-lifetime handling.

## The module entry point and seeder, how Conference plugs in

[`ConferenceModule`](#conferencemodule) is the Conference implementation of [`IModule`](group-14-module-system-composition.md#imodule). It is tiny by design: `Register(...)` calls the [`DependencyInjection`](#dependencyinjection) extension's `AddConferenceModule(...)` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:28-29`), which chains the Application, Infrastructure, and API-layer registrations in dependency order into one call (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:25-27`). The API layer's `AddModuleConferenceAPI` is not a no-op: it calls `AddPermissions` to grant [`RoleNames`](group-08-auth.md#rolenames)`.Organizer` and `.Admin` every [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) capability, and `ContentEditor` only the five-capability `ContentManagement` curation subset with no event structure, rooms, questions, or session selection (`DependencyInjection.cs:41-51`; the subset itself is `ConferencePermissions.cs:57-64`). Attendees are granted nothing here, so attendee-facing endpoints stay on the plain [`AuthorizationPolicies`](group-08-auth.md#authorizationpolicies)`.RequireAuthenticated` policy (`DependencyInjection.cs:35-36`). And `RegisterDisabledStubs(...)` registers **both** a [`DisabledSessionBookmarkValidationService`](group-17-conference-domain.md#disabledsessionbookmarkvalidationservice) and a [`DisabledEventLiveValidationService`](group-17-conference-domain.md#disabledeventlivevalidationservice) as singletons (`ConferenceModule.cs:23-24`) so that *other* hosts which depend on Conference's [`ISessionBookmarkValidationService`](group-17-conference-domain.md#isessionbookmarkvalidationservice) or [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice) but do **not** host Conference still resolve those interfaces (they no-op, or are later `Replace`d by the gRPC adapters). The [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) ([G14](group-14-module-system-composition.md)) discovers `ConferenceModule` by reflection and registers it in topological order, the same mechanism whether Conference is co-hosted or runs alone in its service.

[`ConferenceModuleSeeder`](#conferencemoduleseeder) implements [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:13`) and is the API layer's thin bridge to the real seeding logic: it resolves `IUnitOfWork` and `IConfiguration` from the passed service provider, reads `Seeding:IncludeSampleConferenceData` (defaulting to false when the key is absent, and set to `true` only by the local AppHost at `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:162`), then constructs and runs [`ConferenceModuleDbSeeder`](group-19-conference-infrastructure.md#conferencemoduledbseeder) from [G19](group-19-conference-infrastructure.md) with that flag (`ConferenceModuleSeeder.cs:21-29`). The two markers [`AssemblyReference`](#assemblyreference) / [`ClassReference`](#classreference) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/AssemblyReference.cs:5,11`) are the per-package anchors the module scan and the architecture fitness tests pin against, and [`ConferenceErrorResources`](#conferenceerrorresources) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Resources/ConferenceErrorResources.cs:11`) is a similarly empty sealed class acting as the anchor for the module's `.resx` error-code translations, keyed by domain error `Code` and deliberately omitting runtime-variable messages so they degrade to English with the interpolated value intact (`ConferenceErrorResources.cs:3-10`).

## The gRPC edge, Conference as both server and client

When Conference runs in its own process, two of its in-process collaborations must cross a network boundary, and both are handled by the [G13](group-13-grpc-contracts.md) transport boundary (`Result` over the wire, transport at the edge, [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)). Conference is the **server** for two contracts. [`SessionBookmarksGrpcService`](#sessionbookmarksgrpcservice) (in `MMCA.ADC.Conference.Service`) exposes Conference's `ISessionBookmarkValidationService` to Engagement, answering "is this session valid to bookmark?" (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/SessionBookmarksGrpcService.cs:27`) and "give me the session ids for this event" (`SessionBookmarksGrpcService.cs:45`). [`EventLiveValidationGrpcService`](#eventlivevalidationgrpcservice) exposes `IEventLiveValidationService` to Engagement's conference-day live layer across **four** methods, each projecting a domain record onto the wire shape: `GetEventLiveInfo` returns an [`EventLiveInfo`](group-17-conference-domain.md#eventliveinfo) as publish state plus live-window bounds converted to Unix seconds (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/EventLiveValidationGrpcService.cs:41-46`), `GetSessionLiveInfo` adds a [`SessionLiveInfo`](group-17-conference-domain.md#sessionliveinfo)'s stringified speaker ids, plenum flag, and moderation default cast to an int (`EventLiveValidationGrpcService.cs:65-75`), `GetSponsorLiveInfo` returns a [`SponsorLiveInfo`](group-17-conference-domain.md#sponsorliveinfo) (`EventLiveValidationGrpcService.cs:94-99`), and `GetCurrentRoomSessionInfo` resolves the room's currently-running session within a caller-supplied grace window as a [`RoomSessionInfo`](group-17-conference-domain.md#roomsessioninfo) (`EventLiveValidationGrpcService.cs:103,118-124`). Each server method is a constructor-injected wrapper over the inner C# service: it null-guards request and context, awaits the inner call, and on a failed `Result` calls `result.ThrowIfFailure()` (`SessionBookmarksGrpcService.cs:39,57`, `EventLiveValidationGrpcService.cs:38,62,91,115`) so the [`GrpcResultExceptionInterceptor`](group-13-grpc-contracts.md#grpcresultexceptioninterceptor) (wired by `AddGrpcServiceDefaults()`) can translate the failure into an `RpcException` with structured `error-{i}-*` trailers.

On the **client** side, each contract has a hand-written adapter in `MMCA.ADC.Conference.Contracts` that Engagement uses. [`SessionBookmarkValidationServiceGrpcAdapter`](#sessionbookmarkvalidationservicegrpcadapter) implements the *identical* `ISessionBookmarkValidationService` interface on top of the generated gRPC client (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:24-26`), and [`EventLiveValidationServiceGrpcAdapter`](#eventlivevalidationservicegrpcadapter) does the same for all four `IEventLiveValidationService` methods (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/EventLiveValidationServiceGrpcAdapter.cs:23-25`), converting the Unix-second live-window fields back into UTC `DateTime`s and the speaker-id strings back into `Guid`s (`EventLiveValidationServiceGrpcAdapter.cs:47-50,84-91`). Both pin a **5-second per-call deadline** on every RPC (`SessionBookmarkValidationServiceGrpcAdapter.cs:32,46,79`, `EventLiveValidationServiceGrpcAdapter.cs:30,44,81,122,161`), much tighter than the shared resilience pipeline's 30s attempt / 90s total budget, precisely because these calls sit inline in user request paths (bookmark create and list, live-layer poll and question commands) and a *hung* (as opposed to refused) Conference peer must fail fast rather than hold the caller hostage (`EventLiveValidationServiceGrpcAdapter.cs:27-29`). Both catch `RpcException` and reconstruct `Result.Failure(errors)` from the trailers, falling back to a generic `Error.Failure` coded `Grpc.{StatusCode}` for pure transport faults such as connection reset or deadline exceeded (`SessionBookmarkValidationServiceGrpcAdapter.cs:50-64,84-100`, `EventLiveValidationServiceGrpcAdapter.cs:52-66,93-107,130-144,170-184`). The trailer parsing lives once in [`GrpcErrorTrailerParser`](#grpcerrortrailerparser) (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/GrpcErrorTrailerParser.cs:14`), whose `Parse` walks `error-{i}-*` trailers by index until the first missing code and rebuilds each [`Error`](group-01-result-error-handling.md#error) with the correct factory per `ErrorType` (`GrpcErrorTrailerParser.cs:17,25-44,56-68`), so the round-trip logic is shared by both adapters. Because both the in-process implementation and each adapter satisfy the same interface, swapping a co-located module for a remote service is a registration change, not a rewrite ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html); `[Rubric §7, Microservices Readiness]`).

Those registration swaps are performed by the contract package's `DependencyInjection` extension, one method per contract: `AddConferenceSessionValidationClient(serviceName = "conference")` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/DependencyInjection.cs:43`) and `AddConferenceEventLiveValidationClient(...)` (`DependencyInjection.cs:73`). Each does exactly two things: registers a typed gRPC client via Common's `AddTypedGrpcClient<TClient>(serviceName)` (`DependencyInjection.cs:45,75`, which resolves `http://conference` through Aspire service discovery and attaches the JWT-forwarding interceptor plus Polly resilience handler), then calls `services.Replace(...)` with a *scoped* descriptor rather than `TryAdd` (`DependencyInjection.cs:49,79`), to overwrite whatever implementation is already in the container (the real in-process service if Conference is co-hosted, or the `Disabled...` stub if not) with the gRPC adapter. The `Replace` is deliberate so the adapter wins in either case; it must be called from the consumer's `Program.cs` *after* `ModuleLoader.DiscoverAndRegister(...)` so the in-process or stub registration is already present for `Replace` to find (`DependencyInjection.cs:36-39`). Note the **bidirectional** Conference-to-Engagement gRPC relationship: Conference *serves* these two contracts and also *consumes* Engagement's [`IBookmarkCountService`](group-22-engagement-module.md#ibookmarkcountservice), so the Conference service host registers `AddEngagementBookmarkCountClient()` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:350`) and the AppHost deliberately gives only the Engagement-to-Conference edge a startup `WaitFor`, leaving the reverse edge a plain `WithReference` so the pair cannot deadlock; transient "peer not ready" errors self-heal through the resilience pipeline (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:203-218`; [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) / [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html); `[Rubric §29, Resilience]`).

## The service host: Kestrel first, and why

The `MMCA.ADC.Conference.Service` `Program.cs` boots only the Conference module (`Modules:Conference:Enabled=true`). Kestrel is configured before anything else, and the whole of it is one line: `builder.ConfigureEndpointsWithHealthProbe(HttpProtocols.Http2)` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:85`), the shared extension from Common's [`KestrelEndpointExtensions`](group-16-aspire-orchestration.md#kestrelendpointextensions) ([G16](group-16-aspire-orchestration.md)). Passing `HttpProtocols.Http2` sets every endpoint default to HTTP/2-only on cleartext (h2c prior knowledge), so cross-service gRPC clients can negotiate HTTP/2 without TLS or ALPN; on a cleartext endpoint `Http1AndHttp2` would effectively disable HTTP/2 and Kestrel would reject gRPC frames with `GOAWAY HTTP_1_1_REQUIRED` (`Program.cs:75-81`). That host-transport choice is [ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html). The operational half lives in the shared helper: only when `HealthProbe:Port` is configured (injected by `infra/main.bicep`, deliberately absent locally so Aspire's dynamic ports keep working) does it add a dedicated **HTTP/1.1-only** listener for the ACA `httpGet` probes (`Program.cs:82-84`), because the h2c-only endpoint rejects the platform's HTTP/1.1 probe requests. `MapDefaultEndpoints` (`Program.cs:398`) maps the health endpoints on every listener, so the probe port serves the real health pipeline while staying off the ACA ingress. The rest of the host is the standard ADC REST composition: Serilog registered as one provider rather than through `UseSerilog()` so the OpenTelemetry-to-Azure-Monitor provider survives (`Program.cs:108-115`), an optional Key Vault configuration source layered in before anything binds settings (`Program.cs:124`), the Conference-owned `MMCA.ADC.Conference.Scoring` meter (`Program.cs:133-134`), health checks with SQL required (`Program.cs:184`), CORS, API versioning and rate limiting (`Program.cs:187-189`), response compression (`Program.cs:280`), OpenAPI outside Production (`Program.cs:285,406-409`), RS256 JWT validation via JWKS discovery forwarded through the Gateway (`Program.cs:294-302`), exception handlers (`Program.cs:305`), the scheduler and audit-trail extension points (`Program.cs:313,317`), and the shared middleware pipeline (`Program.cs:399`; [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html) / [ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html) / [ADR-079](https://ivanball.github.io/docs/adr/079-shared-http-middleware-pipeline.html)).

## Output caching and warm-up, the two performance extension points

Output caching is where this host carries the most bespoke configuration (`Program.cs:196-265`). The base policy is deny-by-default `NoCache` (`Program.cs:198`), so only explicitly decorated endpoints cache at all. `ConferenceCache` stays on the built-in default semantics because the permission-gated [`SessionSelectionController`](#sessionselectioncontroller) references it, and [ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)'s public policy must never back a permission-gated endpoint since a cached hit is served before MVC's filters run (`Program.cs:200-206`). Nine further policies (`ConferencePublicCache`, `EventsCache`, `SessionsCache`, `SpeakersCache`, `RoomsCache`, `CategoriesCache`, `QuestionsCache`, `SponsorsCache`, `ActivitiesCache`) are registered through `AddPublicEndpointPolicy` at a 5-minute TTL with hierarchical tags (`Program.cs:236-249`), and each one **bypasses the cache entirely for the privileged read audience** (`Program.cs:235`, the bypass list built from `ConferenceReadAudience.PrivilegedRoles` so it can never diverge from the API-layer visibility checks), for two reasons spelled out in the source (`Program.cs:214-234`): privileged responses include unpublished rows that must never land in a shared public entry, and admin surfaces read back immediately after writing, where a stale cached row version would make the next save throw `DbUpdateConcurrencyException`. Two policies then sit at a 60-second TTL for different reasons: `NowNextCache` because its payload changes with the clock and is identical for every role, so it takes no bypass at all (`Program.cs:252`), and `BookmarkCountsCache` because bookmark counts are owned by Engagement in another process (`Program.cs:255-264`). All of this is [ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html): [`PublicEndpointOutputCachePolicy`](group-12-api-hosting-mapping.md#publicendpointoutputcachepolicy) exists because the UI attaches a Bearer token to every request and the built-in default policy refuses to cache anything carrying `Authorization`, which on conference day meant the cache served none of the real traffic.

Two mechanisms close the distance that TTLs alone cannot. First, at two replicas the store itself must be shared: when a Redis connection string is present the host backs the **output** cache with Redis as well as the distributed cache (`Program.cs:156`), because the default per-replica memory store meant an `EvictByTagAsync` reached only the replica that served the mutation while the other kept serving the pre-edit payload for the full TTL; the same branch adds a two-level cache, an in-process L1 over the Redis L2 under a disjoint keyspace, so a repeat read inside one replica never leaves the process while invalidation still crosses replicas (`Program.cs:164`). Second, a write that never touches a Conference controller still has to reach this cache: an Engagement bookmark or an application-layer speaker auto-link has no handle on `IOutputCacheStore`, so the writer publishes an [`OutputCacheEvictionRequested`](group-04-events-outbox.md#outputcacheevictionrequested) integration event, this host registers the consumer half with `AddOutputCacheEvictionHandler()` (`Program.cs:270`) and the broker half with `RegisterOutputCacheEvictionConsumer()` (`Program.cs:373`), and the tag is dropped on arrival. Registering only one of the two halves is a silent no-op (`Program.cs:267-269`); the 60-second `BookmarkCountsCache` TTL stays deliberately as the backstop for a message that never lands.

The host also contributes the module's error-code translations to the edge localizer by calling `AddErrorResources<ConferenceErrorResources>()` (`Program.cs:332`), so a Conference domain error like `Event.Name.Empty` is rendered in the caller's culture by the shared [`ErrorLocalizer`](group-12-api-hosting-mapping.md#errorlocalizer) ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). And one more startup extension point matters: [`SelfHttpOutputCacheWarmupTask`](#selfhttpoutputcachewarmuptask), registered via `AddWarmupTask<T>()` (`Program.cs:277`) as an [ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html) [`IWarmupTask`](group-16-aspire-orchestration.md#iwarmuptask). The task itself is almost empty: it derives from [`SelfHttpWarmupTaskBase`](group-16-aspire-orchestration.md#selfhttpwarmuptaskbase) (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/SelfHttpOutputCacheWarmupTask.cs:22-28`) and contributes only a name (`SelfHttpOutputCacheWarmupTask.cs:59`) and a list of paths (`SelfHttpOutputCacheWarmupTask.cs:62`), while the base owns the request machinery (waiting for the server to start, resolving the actually-bound cleartext port, pinning HTTP/2 prior knowledge, and treating a failure as non-fatal). The paths are the interesting part, and there are **eight** of them in two families (`SelfHttpOutputCacheWarmupTask.cs:42-56`), because OutputCache keys on the full URL and a warmed entry is only ever hit by a byte-identical query string: family one mirrors the Blazor list pages, whose service base interpolates C# bools and so writes capital `False`/`True`; family two mirrors the hand-written lookup services, which write lowercase literals and `pageSize=10000` (`SelfHttpOutputCacheWarmupTask.cs:30-41`). Warming one family left the other paying a cold read on its first real caller. Every path is `[AllowAnonymous]`, so the base's require-success loop sees `200` and skips nothing.

## The runtime picture, one host, two transports

After module discovery (`Program.cs:335-339`) the host wires the Engagement gRPC client (`Program.cs:350`), the broker (`AddBrokerMessaging` registering the `UserRegistered` integration-event consumer that drives the BR-207 email-match speaker auto-link through [`UserRegisteredHandler`](group-18-conference-application.md#userregisteredhandler), `Program.cs:371-373`, falling back to in-process mode when `MessageBus:Provider` is unset so integration tests are unaffected), the decorator pipeline (`Program.cs:375`), `AddGrpcServiceDefaults()` (`Program.cs:384`), and the per-module health checks (`Program.cs:387`). It initializes the database before serving traffic (`Program.cs:396`), then publishes **both** gRPC endpoints over the same Kestrel HTTP/2 channel the REST controllers serve: `MapGrpcService<SessionBookmarksGrpcService>().RequireAuthorization()` (`Program.cs:419`) and `MapGrpcService<EventLiveValidationGrpcService>().RequireAuthorization()` (`Program.cs:420`), adding gRPC reflection in Development only (`Program.cs:422-425`). The `RequireAuthorization()` is not decoration: both contracts answer conference-state questions raised on behalf of a specific end user, so internal-only ingress is not considered sufficient, and every caller is an Engagement handler sitting behind an authenticated controller whose bearer token the JWT-forwarding interceptor carries across (`Program.cs:414-418`, `[Rubric §11, Security]`).

A browser request to `GET /Sessions` enters the Gateway, is forwarded as HTTP/2 to this host, flows through the shared middleware pipeline, hits an output-cached [`SessionsController`](#sessionscontroller) action that excludes declined sessions for non-privileged readers, runs the query handler's CQRS pipeline, and returns a `CollectionResult<`[`SessionDTO`](group-17-conference-domain.md#sessiondto)`>`. Meanwhile an Engagement service can simultaneously call `ValidateSessionForBookmark` or `GetSessionLiveInfo` over gRPC against the very same process, and a `UserRegistered` message from Identity can arrive over the broker and auto-link a speaker, all without any of the three paths knowing about the others. That *one module, three ingress paths, identical whether co-hosted or standalone* property is the whole point of this chapter, and the reason the Conference edge is mostly thin glue over reusable Common machinery: the version-header contract and the two-version `ServiceInfo` surface are the `[Rubric §9, API & Contract Design]` evidence, and the `Replace`-driven client swaps are the `[Rubric §7, Microservices Readiness]` extension point that keeps the topology reversible.

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
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:24` · Level 0 · record class

- **What it is**: the JSON body POSTed to `/CategoryItems` to add an item to a category. It carries the
  owning `CategoryId`, an *optional* client-supplied `CategoryItemId`, a display `Name`, and a `Sort`
  order (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:24-37`).
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
  (`CategoryItemsController.cs:125-131`): it reads request fields and constructs the command positionally.
  That is the manual-mapping policy of
  [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) applied at the *inbound* edge,
  no reflective mapper between the wire and the application. `[Rubric §1, SOLID]` (interface segregation):
  each record exposes exactly the fields its one endpoint needs, so add and update never share an
  over-broad type. The `required` modifier on every non-optional property pushes "you must supply this"
  into model binding, so a missing field is a 400 before any handler runs.
- **Walkthrough**: a `record class` (not `sealed`) whose members are all `required … { get; init; }`,
  settable only at construction and immutable after (a recurring choice across these contracts).
  `CategoryItemId` is the single *nullable* member (`CategoryItemsController.cs:30`), letting an
  importer or seed flow pin an explicit id while a normal create leaves it null and lets the domain mint
  one.
- **Why it's built this way**: a dedicated record per endpoint keeps the OpenAPI schema and binding
  errors named after real domain terms; separating add from update (rather than one
  nullable-everything record) keeps each contract honest about what is mutable.
- **Where it's used**: bound by [`CategoryItemsController`](#categoryitemscontroller)'s `[FromBody]`
  create parameter only (`CategoryItemsController.cs:121-122`).

---

### AddEventQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:26` · Level 0 · record class

- **What it is**: the POST body for answering a feedback question against an event. It names the
  `EventId`, the `QuestionId` being answered, and the `AnswerValue` text
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:26-36`).
- **Depends on**: id-alias property types (`EventIdentifierType`, `QuestionIdentifierType`) plus BCL
  `string`. Consumed by [`EventQuestionAnswersController`](#eventquestionanswerscontroller), which
  forwards it to
  [`AddEventQuestionAnswerCommand`](group-18-conference-application.md#addeventquestionanswercommand).
- **Concept, user-owned write data behind authorization.** See the request-vs-command shape under
  [`AddCategoryItemRequest`](#addcategoryitemrequest). What distinguishes the answer records from the
  public-catalog records is the surrounding `[Rubric §11, Security]` story (authorization enforced
  server-side, results scoped per user): the controller sits behind
  [`AuthorizationPolicies`](group-08-auth.md#authorizationpolicies)`.RequireAuthenticated`
  (`EventQuestionAnswersController.cs:55`), and the record itself carries **no** `UserId`. The controller
  never trusts the client for identity: `CreatedBy` is stamped from the authenticated principal by the
  audit pipeline (see [soft-delete and audit](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Walkthrough**: three `required { get; init; }` properties, no methods. On add the controller passes
  `null` for the answer's own id: `new AddEventQuestionAnswerCommand(request.EventId, null,
  request.QuestionId, request.AnswerValue)` (`EventQuestionAnswersController.cs:159`), so the domain mints
  the answer id.
- **Why it's built this way**: naming the `QuestionId` on *add* (but not on update) encodes that you pick
  which question an answer belongs to once, at creation.
- **Where it's used**: `[FromBody]` on [`EventQuestionAnswersController`](#eventquestionanswerscontroller)'s
  `CreateAsync` (`EventQuestionAnswersController.cs:154-155`).

---

### AddEventSpeakerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventSpeakersController.cs:28` · Level 0 · record class

- **What it is**: the POST body that links a speaker to an event. It carries exactly two ids, `EventId`
  and `SpeakerId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventSpeakersController.cs:28-35`).
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
  `EventSpeakersController.cs:192`) so the domain mints the link id. `[Rubric §9, API & Contract Design]`:
  every property is `required`, so an incomplete association is rejected at binding.
- **Walkthrough**: two `required {Alias} { get; init; }` members and nothing else; the doc comments name
  each role ("the event to add the speaker to", `EventSpeakersController.cs:30`).
- **Why it's built this way**: a dedicated two-field record per relationship (rather than a generic
  `AddAssociationRequest<TParent, TChild>`) keeps the schema and binding errors named after the real
  domain terms, the §9 readability win the codebase prefers over deduplication.
- **Where it's used**: `[FromBody]` on [`EventSpeakersController`](#eventspeakerscontroller)'s
  `CreateAsync` (`EventSpeakersController.cs:187-188`), which is gated class-level by
  `[HasPermission(ConferencePermissions.EventsManage)]` (`EventSpeakersController.cs:45`). It is the
  template the other join records ([`AddSessionSpeakerRequest`](#addsessionspeakerrequest),
  [`AddSessionCategoryItemRequest`](#addsessioncategoryitemrequest),
  [`AddSpeakerCategoryItemRequest`](#addspeakercategoryitemrequest)) repeat.

---

### AddRoomRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:24` · Level 0 · record class

- **What it is**: the richest write record in the group. A [`Room`](group-17-conference-domain.md#room)
  is a child of an [`Event`](group-17-conference-domain.md#event), so the body carries the owning
  `EventId`, an optional explicit `RoomId`, the required `Name` and `Sort`, and four optional physical
  attributes: `Capacity`, `Floor`, `Location`, `AccessibilityInfo`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:24-49`).
- **Depends on**: the `EventIdentifierType` / `RoomIdentifierType` aliases plus BCL `string?`, `int`,
  `int?`. Consumed by [`RoomsController`](#roomscontroller), which forwards it to
  [`AddRoomCommand`](group-18-conference-application.md#addroomcommand).
- **Concept**: see the request-vs-command shape under [`AddCategoryItemRequest`](#addcategoryitemrequest);
  this adds nothing structurally, only more optional fields. Worth calling out for `[Rubric §21,
  Accessibility]` (assesses whether accessibility is a first-class concern rather than a late retrofit):
  `AccessibilityInfo` (`RoomsController.cs:48`) is a modeled, persisted room attribute, so accessibility
  data is captured in the domain, not bolted on later in the UI.
- **Walkthrough**: three `required` members (`EventId`, `Name`, `Sort`) plus the optional explicit
  `RoomId` (`RoomsController.cs:30`) and four nullable physical fields (`RoomsController.cs:38-48`).
  `CreateAsync` spreads all eight fields positionally into the command
  (`RoomsController.cs:150-158`) and, on success, evicts the `conference:rooms` output-cache tag before
  returning `CreatedAtRoute` (`RoomsController.cs:164-168, 215-216`).
- **Why it's built this way**: modeling capacity, floor, location, and accessibility as discrete optional
  columns (rather than a free-text blob) keeps room metadata queryable and the contract self-documenting.
- **Where it's used**: `[FromBody]` on [`RoomsController`](#roomscontroller)'s `CreateAsync`
  (`RoomsController.cs:145-146`), behind
  `[HasPermission(ConferencePermissions.RoomsManage)]` (`RoomsController.cs:84`).

---

### AddSessionCategoryItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionCategoryItemsController.cs:28` · Level 0 · record class

- **What it is**: the POST body that tags a session with a category item: two ids, `SessionId` and
  `CategoryItemId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionCategoryItemsController.cs:28-35`).
- **Depends on**: the `SessionIdentifierType` / `CategoryItemIdentifierType` aliases. Consumed by
  [`SessionCategoryItemsController`](#sessioncategoryitemscontroller), which forwards it to
  [`AddSessionCategoryItemCommand`](group-18-conference-application.md#addsessioncategoryitemcommand).
- **Concept**: a join-entity write contract, identical in shape to
  [`AddEventSpeakerRequest`](#addeventspeakerrequest) (`[Rubric §4, DDD]`, cross-aggregate references by
  id); add plus delete only, no update. The controller passes `null` for the
  [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem) id
  (`new AddSessionCategoryItemCommand(request.SessionId, null, request.CategoryItemId)`,
  `SessionCategoryItemsController.cs:193`). `[Rubric §12, Performance & Scalability]`: because a tag change
  moves both the session and the category read models, a successful write evicts three output-cache tags,
  `conference:sessions`, `conference:categories`, and `conference`
  (`SessionCategoryItemsController.cs:233-237`).
- **Walkthrough**: two `required { get; init; }` id properties, no methods.
- **Where it's used**: `[FromBody]` on [`SessionCategoryItemsController`](#sessioncategoryitemscontroller)'s
  `CreateAsync` (`SessionCategoryItemsController.cs:188-189`), behind
  `[HasPermission(ConferencePermissions.SessionsManage)]` (`SessionCategoryItemsController.cs:46`).

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
  carries no `UserId`, and reads are scoped per user by BR-9. On add the controller passes `null` for the
  [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer) id
  (`SessionQuestionAnswersController.cs:159`).
- **Walkthrough**: three `required { get; init; }` properties, no methods.
- **Where it's used**: `[FromBody]` on [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller)'s
  `CreateAsync` (`SessionQuestionAnswersController.cs:154-155`).

---

### AddSessionSpeakerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSpeakersController.cs:28` · Level 0 · record class

- **What it is**: the POST body that links a speaker to a session: `SessionId` plus `SpeakerId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSpeakersController.cs:28-35`).
- **Depends on**: the `SessionIdentifierType` / `SpeakerIdentifierType` aliases. Consumed by
  [`SessionSpeakersController`](#sessionspeakerscontroller), which forwards it to
  [`AddSessionSpeakerCommand`](group-18-conference-application.md#addsessionspeakercommand).
- **Concept**: a join-entity write contract like [`AddEventSpeakerRequest`](#addeventspeakerrequest)
  (`[Rubric §4, DDD]`); add plus delete only. The controller passes `null` for the
  [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) id
  (`new AddSessionSpeakerCommand(request.SessionId, null, request.SpeakerId)`,
  `SessionSpeakersController.cs:193`). `[Rubric §12, Performance & Scalability]`: a successful add evicts
  the `conference:sessions` and `conference` output-cache tags
  (`SessionSpeakersController.cs:230-233`), because speaker assignment changes the cached session reads the
  public agenda and speaker pages depend on.
- **Walkthrough**: two `required { get; init; }` id properties, no methods.
- **Where it's used**: `[FromBody]` on [`SessionSpeakersController`](#sessionspeakerscontroller)'s
  `CreateAsync` (`SessionSpeakersController.cs:188-189`), behind
  `[HasPermission(ConferencePermissions.SessionsManage)]` (`SessionSpeakersController.cs:46`).

---

### AddSpeakerCategoryItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakerCategoryItemsController.cs:28` · Level 0 · record class

- **What it is**: the POST body that tags a speaker with a category item: `SpeakerId` plus
  `CategoryItemId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakerCategoryItemsController.cs:28-35`).
- **Depends on**: the `SpeakerIdentifierType` / `CategoryItemIdentifierType` aliases. Consumed by
  [`SpeakerCategoryItemsController`](#speakercategoryitemscontroller), which forwards it to
  [`AddSpeakerCategoryItemCommand`](group-18-conference-application.md#addspeakercategoryitemcommand).
- **Concept**: a join-entity write contract like [`AddEventSpeakerRequest`](#addeventspeakerrequest)
  (`[Rubric §4, DDD]`); add plus delete only. Notable domain modeling: ADC represents speaker traits such
  as locality as a [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem) tag rather
  than as a field on [`Speaker`](group-17-conference-domain.md#speaker), so a request like this is how
  that attribute is attached. The controller passes `null` for the join id
  (`new AddSpeakerCategoryItemCommand(request.SpeakerId, null, request.CategoryItemId)`,
  `SpeakerCategoryItemsController.cs:193`) and then evicts `conference:speakers`,
  `conference:categories`, and `conference` (`SpeakerCategoryItemsController.cs:233-237`).
- **Walkthrough**: two `required { get; init; }` id properties, no methods.
- **Where it's used**: `[FromBody]` on [`SpeakerCategoryItemsController`](#speakercategoryitemscontroller)'s
  `CreateAsync` (`SpeakerCategoryItemsController.cs:188-189`), behind
  `[HasPermission(ConferencePermissions.SpeakersManage)]` (`SpeakerCategoryItemsController.cs:46`).

---

### UpdateCategoryItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:40` · Level 0 · record class

- **What it is**: the PUT body for editing an existing category item. It is
  [`AddCategoryItemRequest`](#addcategoryitemrequest) minus `CategoryItemId`: the owning `CategoryId`,
  the new `Name`, and the new `Sort`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:40-50`).
- **Depends on**: the same id aliases plus BCL `string`/`int`. Consumed by
  [`CategoryItemsController`](#categoryitemscontroller), which forwards it to
  [`UpdateCategoryItemCommand`](group-18-conference-application.md#updatecategoryitemcommand).
- **Concept**: the update half of the request-vs-command shape (see
  [`AddCategoryItemRequest`](#addcategoryitemrequest)). The item id to update is not in the body, it is the
  route's `{id}`; `UpdateAsync` threads the route id into the command
  (`new UpdateCategoryItemCommand(request.CategoryId, id, request.Name, request.Sort)`,
  `CategoryItemsController.cs:152-158`).
- **Walkthrough**: three `required { get; init; }` properties. `CategoryId` is carried on update so the
  handler can re-check ownership of the parent before mutating.
- **Where it's used**: `[FromBody]` on [`CategoryItemsController`](#categoryitemscontroller)'s
  `UpdateAsync` (`CategoryItemsController.cs:147-149`).

---

### UpdateEventQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:39` · Level 0 · record class

- **What it is**: the PUT body for editing an event answer. It carries the owning `EventId` and the new
  `AnswerValue`, and deliberately drops `QuestionId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:39-46`).
- **Depends on**: the `EventIdentifierType` alias plus BCL `string`. Consumed by
  [`EventQuestionAnswersController`](#eventquestionanswerscontroller), which forwards it to
  [`UpdateEventQuestionAnswerCommand`](group-18-conference-application.md#updateeventquestionanswercommand).
- **Concept**: the update half of the answer contract (see
  [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest)). Omitting `QuestionId` encodes an
  invariant: you can re-word an answer but not re-point it at a different question (that would be a delete
  and re-add). `UpdateAsync` uses the route `{id}` as the answer id
  (`new UpdateEventQuestionAnswerCommand(request.EventId, id, request.AnswerValue)`,
  `EventQuestionAnswersController.cs:178`) and returns `NoContent()` on success
  (`EventQuestionAnswersController.cs:181-183`).
- **Walkthrough**: two `required { get; init; }` properties, no methods.
- **Where it's used**: `[FromBody]` on [`EventQuestionAnswersController`](#eventquestionanswerscontroller)'s
  `UpdateAsync` (`EventQuestionAnswersController.cs:172-174`).

---

### UpdateRoomRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:52` · Level 0 · record class

- **What it is**: the PUT body for editing a room. It is [`AddRoomRequest`](#addroomrequest) minus the
  explicit `RoomId`: the owning `EventId`, required `Name` and `Sort`, and the four optional physical
  attributes
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:52-74`).
- **Depends on**: the `EventIdentifierType` alias plus BCL `string?`, `int`, `int?`. Consumed by
  [`RoomsController`](#roomscontroller), which forwards it to
  [`UpdateRoomCommand`](group-18-conference-application.md#updateroomcommand).
- **Concept**: the update half of the room contract (see [`AddRoomRequest`](#addroomrequest)); the room
  id comes from the route `{id}`. `UpdateAsync` spreads the seven body fields plus the route id into the
  command (`RoomsController.cs:178-188`), then evicts the `conference:rooms` tag before returning
  `NoContent()` (`RoomsController.cs:193-194`).
- **Walkthrough**: three `required` members plus four nullable optionals, no methods.
- **Where it's used**: `[FromBody]` on [`RoomsController`](#roomscontroller)'s `UpdateAsync`
  (`RoomsController.cs:173-175`).

---

### UpdateSessionQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:39` · Level 0 · record class

- **What it is**: the session-scoped twin of
  [`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest): the PUT body carrying the
  owning `SessionId` and the new `AnswerValue`, dropping `QuestionId`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:39-46`).
- **Depends on**: the `SessionIdentifierType` alias plus BCL `string`. Consumed by
  [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller), which forwards it to
  [`UpdateSessionQuestionAnswerCommand`](group-18-conference-application.md#updatesessionquestionanswercommand).
- **Concept**: identical to [`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest); the
  answer id is the route `{id}` (`SessionQuestionAnswersController.cs:178`).
- **Walkthrough**: two `required { get; init; }` properties, no methods.
- **Where it's used**: `[FromBody]` on [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller)'s
  `UpdateAsync` (`SessionQuestionAnswersController.cs:172-174`).

---

### ServiceInfoController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:20` · Level 2 · class (sealed)

- **What it is**: an anonymous, read-only service and version discovery controller whose single
  `/ServiceInfo` route is served by **two** API versions, selected via the `api-version` header. The ADC
  file is almost empty: it is a thin sealed subclass of the shared
  [`ServiceInfoControllerBase`](group-12-api-hosting-mapping.md#serviceinfocontrollerbase) that overrides
  exactly one member, `ServiceName => "Conference"`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:23`).
  All of the version-discovery behavior lives in the base.
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
  (`ServiceInfoControllerBase.cs:15-29`).
- **Walkthrough**
  - The five class-level attributes at `ServiceInfoController.cs:15-19` (`[ApiController]`,
    `[Route("[controller]")]`, `[AllowAnonymous]`, `[ApiVersion("1.0", Deprecated = true)]`,
    `[ApiVersion("2.0")]`) supply routing, anonymity, and versioning to the leaf, because attribute
    inheritance is not reliable here.
  - The entire body is one expression-bodied override: `protected override string ServiceName =>
    "Conference"` (`ServiceInfoController.cs:23`). The advertised supported and deprecated version lists
    (`["1.0", "2.0"]` and `["1.0"]`) live on the base
    (`ServiceInfoControllerBase.cs:32-33`), so this class never restates them.
- **Why it's built this way**: hoisting the discovery actions and payloads into a shared base and giving
  each service a one-line subclass keeps every service's `/ServiceInfo` identical and keeps the versioning
  feature exercised and testable: a contract-snapshot test against `/openapi/v1.json` can confirm both
  versions are present, so the capability cannot silently rot. It stays anonymous and side-effect free.
- **Where it's used**: mounted by the Conference service's controller registration; reached directly on
  the service host, not through the YARP Gateway (which does not route `/ServiceInfo`). Primarily a target
  for the integration-tier versioning and contract tests rather than for the UI.
- **Caveats / not-in-source**: the `ReportApiVersions = true` behavior that adds the
  `api-supported-versions` / `api-deprecated-versions` response headers is configured in
  `AddCommonApiVersioning` (MMCA.Common.API, a different group), not here
  (`ServiceInfoControllerBase.cs:11-12` documents the dependency); this controller only declares the two
  versions and its service name.

---

### SessionSelectionController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSelectionController.cs:29` · Level 4 · class (sealed partial)

- **What it is**: a **decision-support** controller for choosing which submitted sessions to accept,
  gated class-level by
  [`[HasPermission(ConferencePermissions.SessionSelectionManage)]`](group-08-auth.md#haspermissionattribute)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSelectionController.cs:28`),
  a capability the content-curation subset deliberately excludes (`SessionSelectionManage` is in
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions)`.All` but absent from its
  `ContentManagement` subset, so a content-editor role granted `ContentManagement` cannot reach it:
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:30, 33-42, 49-54`;
  the concrete role-to-permission grants live in the module's registration, not in this file). It exposes
  four read endpoints (composite dashboard, category distribution, speaker overlap, content similarity)
  plus one endpoint that **queues** AI scoring of an event's sessions for a hosted background worker.
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (for the
  `HandleFailure` Result-to-Problem-Details mapping, `SessionSelectionController.cs:36`); the
  [`HasPermission`](group-08-auth.md#haspermissionattribute) attribute plus the
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) catalog; four
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  injections (`SessionSelectionController.cs:30-33`);
  [`ISessionScoringQueue`](group-18-conference-application.md#isessionscoringqueue) (`:34`);
  [`Result`](group-01-result-error-handling.md#result) and
  [`Error`](group-01-result-error-handling.md#error); the decision-support DTOs
  ([`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto),
  [`CategoryDistributionDTO`](group-17-conference-domain.md#categorydistributiondto),
  [`SpeakerSessionOverlapDTO`](group-17-conference-domain.md#speakersessionoverlapdto),
  [`ContentSimilarityDTO`](group-17-conference-domain.md#contentsimilaritydto)); BCL `ILogger` and
  ASP.NET Core `[OutputCache]`.
- **Concept introduced, handing long work to a queue instead of the request thread.** `[Rubric §9, API &
  Contract Design]` (a focused, capability-scoped surface that answers with honest status codes) and
  `[Rubric §29, Resilience & Business Continuity]`. `ScoreSessions`
  (`SessionSelectionController.cs:108`) is **synchronous and non-async**: it calls
  `sessionScoringQueue.TryEnqueue(eventId)` and switches on the returned
  [`SessionScoringEnqueueResult`](group-18-conference-application.md#sessionscoringenqueueresult)
  (`:110-128`). `Queued` logs and returns `Accepted()` (202); `AlreadyPending` and `QueueFull` each build
  an `Error.Conflict(...)` and hand it to `HandleFailure`, which maps `ErrorType.Conflict` to **409**
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:25`) inside an RFC 9457
  Problem Details body
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:25-51`). Both outcomes
  are declared to OpenAPI with `[ProducesResponseType]` (`:106-107`).
  `[Rubric §31, Cost/FinOps]` assesses whether spend is bounded by design rather than by hope: the
  controller's own remarks record that each pass issues one paid Anthropic call per session, so a second
  concurrent pass would double the spend while racing the first one's writes (`:100-104`). The queue
  enforces that: it deduplicates by event and keeps the entry until the run *finishes*, so the dedup window
  covers execution, not just the wait
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/SessionScoringQueue.cs:51-55`),
  and it is a bounded channel of capacity 16 with `SingleReader` so runs execute one at a time
  (`SessionScoringQueue.cs:38, 43-49`). `[Rubric §13, Observability & Operability]` (structured,
  source-generated logging): the class is `partial` and declares one `[LoggerMessage]` method,
  `LogScoringQueued` (`SessionSelectionController.cs:131-132`), a compile-time generated,
  allocation-light log call. `[Rubric §12, Performance & Scalability]`: all four read endpoints carry
  `[OutputCache(PolicyName = "ConferenceCache")]` (`:40, 54, 68, 82`).
- **Walkthrough**
  - Primary-constructor injection of the four query handlers, the scoring queue, and the logger
    (`SessionSelectionController.cs:29-35`); the base is
    [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (`:36`).
  - Each read action follows the same shape: dispatch the query, then
    `result.IsFailure ? HandleFailure(result.Errors) : Ok(result.Value)`. `GetDashboardAsync` (`:41`),
    `GetCategoryDistributionAsync` (`:55`), `GetSpeakerOverlapAsync` (`:69`), and
    `GetContentSimilarityAsync` (`:83`, which takes a `minimumSimilarity = 0.3` threshold query
    parameter, `:85`).
  - `ScoreSessions` (`:108`) is the only write. It returns `ActionResult`, not `Task<ActionResult>`:
    enqueueing is a synchronous in-memory operation, so there is nothing to await at the edge.
- **Why it's built this way**: an earlier revision started the scoring run as a fire-and-forget task from
  the controller. The queue interface's own doc comments are the design record for why that was replaced
  (`ISessionScoringQueue.cs:16-30`): nothing tracked the task, so a deploy or scale-in killed it mid-run
  with no record; nothing deduplicated it, so two clicks meant two concurrent passes; and it ignored the
  host lifetime, so shutdown could neither wait for it nor cancel it. Refusing a duplicate with 409 rather
  than silently coalescing it means the caller learns the run is already in flight.
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

---

### CategoryItemsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:61` · Level 8 · class (sealed)

- **What it is**: the REST controller for conference category items. Reads are public (anonymous per
  BR-43); writes (add, update, remove) require organizer authorization, gated class-level by
  `[HasPermission(ConferencePermissions.CategoriesManage)]`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:60`).
  A [`CategoryItem`](group-17-conference-domain.md#categoryitem) is a child of a
  [`Category`](group-17-conference-domain.md#category), exposed at a top-level route for convenient
  querying (`CategoryItemsController.cs:52-58`).
- **Depends on**:
  [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  closed over `CategoryItem`, [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto), and
  `CategoryItemIdentifierType` (the read-only Common base it extends, `CategoryItemsController.cs:68`); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  for reads; three
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  injections for add, update, and remove (`:63-65`); ASP.NET Core's `IOutputCacheStore` (`:66`); the
  [`HasPermission`](group-08-auth.md#haspermissionattribute) attribute plus
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions); its two request records
  [`AddCategoryItemRequest`](#addcategoryitemrequest) and
  [`UpdateCategoryItemRequest`](#updatecategoryitemrequest); the read result types
  [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), and
  [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype); the
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder); BCL `ILogger`.
- **Concept introduced, the child-entity controller over the read-only base.** `[Rubric §9, API &
  Contract Design]`, `[Rubric §5, Vertical Slice]`, `[Rubric §6, CQRS & Event-Driven]`. A *child* of an
  aggregate cannot use the generic aggregate-root create and delete (those cannot supply the child's
  parent id), so this class derives from the **read-only**
  [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype),
  which already supplies `GET`, `GET /paged`, `GET /lookup`, and `GET /{id}`, then hand-writes its own
  `POST`, `PUT`, and `DELETE` whose commands carry the owning `CategoryId`. Each read is `override`n only
  to add `[AllowAnonymous]` plus the cache policy and to delegate straight to the base
  (`=> base.GetAllAsync(...)`); each write action maps its request record onto exactly one command and
  folds any `Result.Failure` through the inherited `HandleFailure`, the one-handler-per-action shape of
  CQRS at the edge. `[Rubric §1, SOLID]` and `[Rubric §16, Maintainability]`: because the read machinery is
  written once in Common, the concrete controller is small and has almost no reason to change.
- **Walkthrough**
  - Primary-constructor injection (`CategoryItemsController.cs:61-67`): the query service, the three
    command handlers (`AddCategoryItemCommand -> Result<CategoryItemDTO>`, `UpdateCategoryItemCommand ->
    Result`, `RemoveCategoryItemCommand -> Result`), the output-cache store, and the logger; the base call
    passes the query service and logger to `EntityControllerBase` (`:68`).
  - The four read overrides (`:70-117`) each add `[AllowAnonymous]` (opening the class-level permission
    gate for reads) and `[OutputCache(PolicyName = "CategoriesCache")]`, then forward to the base:
    `GetAllAsync` (`:73`), the paged `GetAllAsync` with the
    `[ModelBinder(typeof(QueryFilterModelBinder))]` filter dictionary (`:83-93`), `GetAllForLookupAsync`
    (`:98`), and `GetByIdAsync` under the named route `"GetCategoryItemById"` (`:103-106`).
  - `CreateAsync` (`:121`): `[HttpPost]`, binds `[FromBody] AddCategoryItemRequest`, dispatches
    `new AddCategoryItemCommand(request.CategoryId, request.CategoryItemId, request.Name, request.Sort)`
    (`:125-131`); on success evicts the cache and returns
    `CreatedAtRoute("GetCategoryItemById", new { id = result.Value!.Id }, result.Value)` (`:138-142`),
    otherwise `HandleFailure` (`:133-136`).
  - `UpdateAsync` (`:147`): `[HttpPut("{id}")]`, binds the route `id` and
    `[FromBody] UpdateCategoryItemRequest`, dispatches
    `new UpdateCategoryItemCommand(request.CategoryId, id, request.Name, request.Sort)` (`:152-158`),
    evicts, then `NoContent()` (`:165-166`).
  - `DeleteAsync` (`:171`): `[HttpDelete("{id}")]`, binds the route `id` and
    `[FromQuery] ConferenceCategoryIdentifierType categoryId`, dispatches
    `new RemoveCategoryItemCommand(categoryId, id)` (`:176-178`), evicts, then `NoContent()`. The parent
    `categoryId` is taken from the query string because a child delete needs its parent for ownership
    re-validation in the handler.
  - `EvictCategoriesCacheAsync` (`:195`) is the private tail every mutation calls: it evicts the
    `conference:categories` and `conference` tags (`:197-198`). `[Rubric §12, Performance &
    Scalability]`, and the method's own doc comment states the failure mode it prevents: without it the
    now-cached reads would serve the pre-edit item list for the full policy TTL, so an organizer renaming a
    track would not see it on the public session pages until the entry expired (`:189-194`).
- **Why it's built this way**: the split between an aggregate-root base (create and delete built in) and
  this read-only base (writes hand-written) is exactly the "child commands carry a `parentId` the generic
  base cannot model" distinction the group overview draws. Reads are anonymous because the catalog is
  public (BR-43); writes are capability-gated (BR-41) at the class level, and `CategoriesManage` is one of
  the three permissions in the `ContentManagement` curation subset
  (`ConferencePermissions.cs:49-54`), so a content editor can edit the taxonomy without holding event or
  room rights.
- **Where it's used**: mounted by the Conference service's controller registration and consumed by the
  organizer category-management UI. It is the archetype for the group's other child and join controllers
  ([`RoomsController`](#roomscontroller), [`EventSpeakersController`](#eventspeakerscontroller),
  [`SessionSpeakersController`](#sessionspeakerscontroller),
  [`SessionCategoryItemsController`](#sessioncategoryitemscontroller),
  [`SpeakerCategoryItemsController`](#speakercategoryitemscontroller)), which repeat this shape with
  different entities, cache tags, and permissions.

---

### ConferenceCategoriesController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ConferenceCategoriesController.cs:32` · Level 8 · class (sealed)

- **What it is**: the REST controller for the [`Category`](group-17-conference-domain.md#category)
  aggregate root, served at the custom route `conferencecategories`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ConferenceCategoriesController.cs:29`)
  to avoid colliding with another module's `categories` route. Anonymous reads, organizer create, update,
  and delete (`[HasPermission(ConferencePermissions.CategoriesManage)]`, `:31`). This is the first
  *aggregate-root* controller in the group, so it establishes the shape the other full-CRUD controllers
  reuse.
- **Depends on**:
  [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (the CRUD base, `ConferenceCategoriesController.cs:39-40`), the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:33`), a create handler keyed on
  [`ConferenceCategoryCreateRequest`](group-18-conference-application.md#conferencecategorycreaterequest)
  (`:34`), an update handler keyed on
  [`UpdateConferenceCategoryCommand`](group-18-conference-application.md#updateconferencecategorycommand)
  (`:35`), a delete handler keyed on
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  (`:36`), ASP.NET Core's `IOutputCacheStore` (`:37`), the
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto), and the PUT body
  [`ConferenceCategoryUpdateRequest`](group-18-conference-application.md#conferencecategoryupdaterequest)
  (`:106`).
- **Concept introduced, the aggregate-root controller.** `[Rubric §9, API & Contract Design]` assesses
  consistent resource CRUD: an aggregate root gets a full, uniform REST surface, and
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  supplies `GetAll`, `GetById`, `GetAllForLookup`, `Create`, and `Delete` from its constructor slots (query
  service, create handler, delete handler, logger, `:39-40`). The subclass then writes only policy, cache
  eviction, and any extra actions. Here the create request type *is* the command:
  `ConferenceCategoryCreateRequest` is passed straight into the create handler's
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) slot (`:34`), the
  create-from-request shape used across the Conference aggregate roots. `[Rubric §12, Performance &
  Scalability]`: reads carry `[OutputCache(PolicyName = "CategoriesCache")]` and every mutation calls
  `EvictCategoriesCacheAsync`, which evicts the `conference:categories` tag (`:131-132`).
- **Walkthrough**
  - The four reads (`:42-89`) are `override`s that attach `[AllowAnonymous]` plus the cache policy and
    forward to the base, including the paged overload with the
    [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder) filter dictionary
    (`:63`) and `GetByIdAsync` under the named route `"GetCategoryById"` (`:75`).
  - `CreateAsync` (`:93-100`) and `DeleteAsync` (`:122-129`) are thin `override`s that call
    `base.CreateAsync` / `base.DeleteAsync` and then evict, so the base does the CQRS dispatch and the
    override adds only the cache concern.
  - `UpdateAsync` (`:104-118`) is the one hand-rolled action, because the base has no update: it wraps the
    route id and body in `new UpdateConferenceCategoryCommand(id, request)` (`:110`), dispatches, folds a
    failure through `HandleFailure` (`:113-114`), evicts, and returns `Ok(result.Value)` (`:117`).
- **Why it's built this way**: the base carries the boilerplate CRUD so a controller author writes only
  what is specific: the route override, the update action, and cache eviction. The custom route string is
  the deliberate escape hatch from ASP.NET Core's `[controller]` convention, for the case where two modules
  would otherwise claim the same path.
- **Where it's used**: mounted by the Conference service host; consumed by the category-management UI and
  by every screen that offers a category picker. Its child items are managed through the sibling
  [`CategoryItemsController`](#categoryitemscontroller), which shares the same
  `CategoriesManage` permission and the same `conference:categories` cache tag.

### EventQuestionAnswersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:57` · Level 9 · class (sealed)

- **What it is**: the REST controller for event feedback answers (`/EventQuestionAnswers`). Unlike the
  public-catalog controllers in this group, **both** reads and writes require authentication
  (`[Authorize(Policy = AuthorizationPolicies.RequireAuthenticated)]`,
  `EventQuestionAnswersController.cs:56`), and the reads are **owner-scoped** by BR-8: organizers see every
  answer, everyone else sees only their own.
- **Depends on**:
  [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (the read-only base, `EventQuestionAnswersController.cs:64`);
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  for reads; three
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  injections for [`AddEventQuestionAnswerCommand`](group-18-conference-application.md#addeventquestionanswercommand),
  [`UpdateEventQuestionAnswerCommand`](group-18-conference-application.md#updateeventquestionanswercommand)
  and [`RemoveEventQuestionAnswerCommand`](group-18-conference-application.md#removeeventquestionanswercommand)
  (`:59-61`); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) and
  [`RoleNames`](group-08-auth.md#rolenames) for the scoping decision;
  [`OwnedByUserSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ownedbyuserspecificationtentity-tidentifiertype)
  as the filter it builds; [`AuthorizationPolicies`](group-08-auth.md#authorizationpolicies); the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute) on its create; the
  [`EventQuestionAnswerDTO`](group-17-conference-domain.md#eventquestionanswerdto); and its two request
  records [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest) /
  [`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest) (`:26-47`). Externals: ASP.NET Core
  MVC (`[ApiController]`, `[HttpGet]`, `[FromQuery]`), `Asp.Versioning`, `ILogger`.
- **Concept introduced, per-user read scoping via a specification.** `[Rubric §11, Security]` assesses
  whether authorization is enforced server-side and whether results are scoped per user rather than merely
  hidden in the UI. The private `GetUserScopingSpecification()` (`EventQuestionAnswersController.cs:67-68`)
  returns `null` when `currentUserService.IsInRole(RoleNames.Organizer)` (no filter, sees all), otherwise a
  `new OwnedByUserSpecification<EventQuestionAnswer, EventQuestionAnswerIdentifierType>(currentUserService.UserId!.Value)`.
  That specification is threaded into `QueryService.GetAllAsync` / `GetByIdAsync`, so the *database query
  itself* excludes other users' rows: the scoping happens in SQL, paging counts stay honest, and nothing is
  filtered out of an already-fetched page. This is why the reads here fully `override` the base actions
  (threading the specification, `asTracking: false`, and a `MaxPageSize` cap) instead of delegating with
  `=> base....` the way the public controllers do. `[Rubric §9, API & Contract Design]`: the write records
  carry no `UserId` at all (`:26-47`); identity comes from the authenticated principal and `CreatedBy` is
  stamped by the audit pipeline, never trusted from the client. Note the absence of any `[OutputCache]`
  attribute on any action in this file: a per-caller response must not land in a shared cache entry, and the
  controller simply never opts in.
- **Concept introduced, closing the CSV export as a row-scoping bypass.** The framework base ships a
  streaming CSV endpoint, `ExportAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:235`), and its own
  remarks state the hazard plainly: the rows it streams are whatever `GetExportSpecification()` allows, and
  that hook returns `null` by default, so an export is unscoped unless the concrete controller says
  otherwise (`EntityControllerBase.cs:214-219, 520-542`). A controller that row-scopes its list endpoints
  but inherits the default export therefore hands every caller the whole table in one request. This
  controller closes that with the **role gate** the base describes as the interim form of the mitigation
  (`EntityControllerBase.cs:533-537`): `ExportAsync` is overridden to `Forbid()` unless the caller is an
  organizer, then delegate to the base (`EventQuestionAnswersController.cs:159-174`). Every row-scoped
  controller in this unit repeats one of the two variants of this gate, and the rationale is written into
  each override's doc comment (`:153-158` here). `[Rubric §11, Security]` again, and `[Rubric §30,
  Compliance/Privacy/Data Governance]`, which assesses whether personal data has a single governed exit
  path: feedback answers are attributable personal content, so a bulk download stays with the role that
  already reads every row.
- **Walkthrough**
  - Primary-constructor injection (`EventQuestionAnswersController.cs:57-63`): query service, three command
    handlers, `ICurrentUserService`, logger. The base is constructed with `(queryService, logger)` (`:64`).
  - `GetUserScopingSpecification()` (`:67-68`): the organizer-or-own branch described above.
  - `GetAllAsync` (`:70-89`): fully overridden, calls `QueryService.GetAllAsync(specification:
    GetUserScopingSpecification(), pageSize: MaxPageSize, asTracking: false, ...)` (`:78-86`) and returns
    `Ok(result.Value)` or `HandleFailure(result.Errors)`.
  - The paged `GetAllAsync` (`:91-124`): clamps `pageSize = Math.Min(pageSize, MaxPageSize)` (`:103`),
    threads the same specification (`:109`), binds `filters` through the
    [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder) (`:100`), and appends
    the `X-Pagination` header carrying the result's
    [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata) (`:122`).
  - `GetAllForLookupAsync` (`:126-130`) delegates straight to the base; `GetByIdAsync` (`:132-151`) threads
    the specification (`:145`) so an attendee cannot fetch another user's answer by id.
  - `ExportAsync` (`:159-174`): the organizer gate above, `Forbid()` at `:170`, otherwise
    `base.ExportAsync(...)` at `:173`.
  - `CreateAsync` (`:185-199`) carries `[Idempotent]` (`:184`), so a retried POST with the same
    `Idempotency-Key` replays the stored response instead of writing a second answer row. The doc comment
    records why the attribute is declared here rather than inherited: this create is hand-written, not the
    base action (`:176-182`). It dispatches `new AddEventQuestionAnswerCommand(request.EventId, null,
    request.QuestionId, request.AnswerValue)` (`:190`), the `null` being the child id the domain mints, then
    `CreatedAtRoute("GetEventQuestionAnswerById", ...)`.
  - `UpdateAsync` (`:203-215`): dispatches `new UpdateEventQuestionAnswerCommand(request.EventId, id,
    request.AnswerValue)` (`:209`) and returns `NoContent()`.
  - `DeleteAsync` (`:219-231`): takes the parent `eventId` `[FromQuery]` (`:221`) because the route only
    carries the child id, dispatches `RemoveEventQuestionAnswerCommand(eventId, id)` (`:225`), and returns
    `NoContent()`.
- **Why it's built this way**: BR-8 mandates that non-organizers see only their own answers, so the
  controller injects an ownership specification into the query pipeline rather than filtering after the
  fact. Organizers bypass the filter through the null-specification branch, which is the same shape every
  visibility rule in this group uses. The parent `EventId` travels on every write so the handler can load
  the [`Event`](group-17-conference-domain.md#event) aggregate and mutate the child through it.
- **Where it's used**: hosted by the Conference service and reached through the YARP Gateway
  ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)); the attendee
  feedback UI is the client. [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller) is its
  exact session-scoped sibling (BR-9), built the same way.
- **Caveats / not-in-source**: the controller gates the export by role instead of overriding
  `GetExportSpecification()`, so an attendee cannot export their *own* answers at all. The base's remarks
  describe the specification override as the form that would restore that (`EntityControllerBase.cs:533-537`);
  whether that change is planned is not determinable from source.

---

### EventSpeakersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventSpeakersController.cs:47` · Level 9 · class (sealed)

- **What it is**: the REST controller for the many-to-many link between an event and a speaker
  (`/EventSpeakers`). It exposes anonymous read endpoints and organizer-only add/remove endpoints. Because
  an [`EventSpeaker`](group-17-conference-domain.md#eventspeaker) is a *child* of the
  [`Event`](group-17-conference-domain.md#event) aggregate, this controller reads the child directly but
  mutates it only through the parent aggregate's commands. It is the reference implementation of the
  junction controller shape that three more controllers in this unit share.
- **Depends on**: [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (the read-only base, `EventSpeakersController.cs:55`),
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  for reads, two [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s
  ([`AddEventSpeakerCommand`](group-18-conference-application.md#addeventspeakercommand) /
  [`RemoveEventSpeakerCommand`](group-18-conference-application.md#removeeventspeakercommand),
  `EventSpeakersController.cs:49-50`), an
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicEventSpeakerFilterQuery`](group-18-conference-application.md#getpubliceventspeakerfilterquery)
  (`:51`), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) plus the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) read-audience helper, ASP.NET Core's
  `IOutputCacheStore` (`:53`), the [`EventSpeakerDTO`](group-17-conference-domain.md#eventspeakerdto), the
  [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) and the
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) catalog, the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute), and its request record
  [`AddEventSpeakerRequest`](#addeventspeakerrequest) (`:28-36`).
- **Concept introduced, the junction controller and its inherited visibility.** `[Rubric §4, Domain-Driven
  Design]` assesses whether aggregate boundaries are respected: you never POST straight at a child row. The
  controller derives from the read-only
  [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (which supplies only `GetAll` / `GetById` / `GetAllForLookup` / `Export`, no create or delete) and
  hand-rolls its two mutations, each dispatching a command that loads the parent aggregate.
  `[Rubric §11, Security]`: the class carries `[HasPermission(ConferencePermissions.EventsManage)]`
  (`EventSpeakersController.cs:46`) so writes require the organizer capability (BR-41), while every read
  overrides that with `[AllowAnonymous]` (BR-43). The subtle half is BR-108: a junction row must not leak
  the existence of an unpublished event, so the reads do **not** simply forward to the base. `IsPrivileged`
  (`:58`) asks `currentUserService.IsPrivilegedConferenceReader()`, and `BuildPublicSpecificationAsync`
  (`:66-75`) returns `null` for a privileged reader or, for everyone else, the
  [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype)
  produced by the `GetPublicEventSpeakerFilterQuery` handler, which resolves the published-event id list in
  the Application layer. Every read threads that specification into the query service, so a hidden parent
  yields a 404 rather than a redacted row. `[Rubric §12, Performance & Scalability]`: the reads are cached
  under the `EventsCache` policy (5-minute TTL, tags `conference` and `conference:events`, registered at
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:237`), which is exactly why the writes
  must evict. That policy is a
  [`PublicEndpointOutputCachePolicy`](group-12-api-hosting-mapping.md#publicendpointoutputcachepolicy)
  registration and it bypasses the cache entirely for the privileged read audience
  ([ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)),
  which is what keeps an organizer's everything-inclusive payload out of the shared public entry.
- **Walkthrough**
  - `GetAllAsync` (`EventSpeakersController.cs:80-98`) and the paged overload (`:103-135`) are full
    overrides: `[AllowAnonymous]` + `[OutputCache(PolicyName = "EventsCache")]` (`:78-79, 101-102`), the
    public specification threaded in (`:90, 120`), the page size clamped to `MaxPageSize` (`:114`), and the
    `X-Pagination` header appended (`:133`).
  - `GetAllForLookupAsync` (`:144-161`) is the anti-side-channel path: a privileged reader (null
    specification) falls through to the framework base action (`:149-150`); everyone else gets
    `QueryService.GetAllForLookupAsync(nameProperty, where: specification.Criteria, ...)` (`:152-156`), the
    `where` overload declared at
    `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:87`, and the rows
    are wrapped back into a
    [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt) of
    [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) (`:160`).
    Without this, a dropdown would enumerate the names the list endpoint hides.
  - `GetByIdAsync` (`:166-184`) threads the same specification (`:178`).
  - `ExportAsync` (`:193-207`) is the export gate taught at
    [`EventQuestionAnswersController`](#eventquestionanswerscontroller), in its privileged-reader form:
    `if (!IsPrivileged) return Forbid();` (`:201-204`), then `base.ExportAsync(...)` (`:206`). The doc
    comment states the leak it prevents: an unscoped CSV would carry the junction rows of unpublished
    events, "leaking exactly the existence the reads above hide" (`:186-191`).
  - `CreateAsync` (`:218-236`) is `[Idempotent]` (`:217`) and dispatches
    `AddEventSpeakerCommand(request.EventId, null, request.SpeakerId)` (`:223`), returns
    `HandleFailure(result.Errors)` on failure (`:226-229`), then evicts and returns
    `CreatedAtRoute("GetEventSpeakerById", ...)` (`:231-235`).
  - `DeleteAsync` (`:240-256`) reads the parent `eventId` `[FromQuery]` (`:242`), dispatches
    `RemoveEventSpeakerCommand(eventId, id)` (`:246`), evicts (`:254`), and returns `NoContent()`.
  - `EvictJunctionCacheAsync` (`:263-268`) clears **both** parents' tags plus the broad one:
    `conference:events`, `conference:speakers`, `conference`. Note the ordering guard in both mutations: the
    failure return happens before the eviction, so a rejected command never disturbs the cache.
  - Error-to-HTTP translation is inherited from
    [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase)`.HandleFailure`.
- **Why it's built this way**: a child has no independent lifecycle, so it earns free read endpoints but
  explicit, aggregate-routed mutations. The visibility filter lives at the controller boundary as a
  specification because that is the one place that knows the caller's role, while the *rule* (which parents
  are public) stays in an Application-layer query handler
  (`[Rubric §3, Clean Architecture]`). Evicting both parents' tags is deliberate: the association shows up
  on event pages and speaker pages alike, so a one-tag eviction would leave one of them stale for the full
  TTL.
- **Where it's used**: hosted by `MMCA.ADC.Conference.Service` and reached through the YARP Gateway
  ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)); the Blazor
  speaker-assignment screens are the primary client.

---

### QuestionsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/QuestionsController.cs:31` · Level 9 · class (sealed)

- **What it is**: the REST controller for the [`Question`](group-17-conference-domain.md#question) aggregate
  root (`/Questions`), the feedback-question definitions attendees answer. It is the plainest aggregate-root
  controller in the group: inherited CRUD, one hand-rolled update, and cache eviction, with no visibility
  scoping at all.
- **Depends on**: [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`QuestionsController.cs:38-39`),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  a create handler keyed on [`QuestionCreateRequest`](group-18-conference-application.md#questioncreaterequest),
  an update handler for [`UpdateQuestionCommand`](group-18-conference-application.md#updatequestioncommand),
  a delete handler keyed on
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  (`:32-35`), `IOutputCacheStore` (`:36`), the
  [`QuestionDTO`](group-17-conference-domain.md#questiondto), and
  [`QuestionUpdateRequest`](group-18-conference-application.md#questionupdaterequest) as the update body.
- **Concept introduced, the aggregate-root controller at its most minimal.** `[Rubric §9, API & Contract
  Design]` assesses consistent resource CRUD: an aggregate root gets a full, uniform REST surface, and
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  supplies `GetAll` / `GetById` / `GetAllForLookup` / `Export` / `Create` / `Delete` from its constructor
  slots (query service, create handler, delete handler). Note that the create request type *is* the
  handler's command shape: `QuestionCreateRequest` is passed straight into the
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) slot (`:33`), the
  create-from-request shape used across the Conference aggregate roots. Every read here is a pure
  `override` that re-decorates the base action and delegates (`QuestionsController.cs:41-88`), which is what
  a controller looks like when it has no per-caller rule to apply: contrast
  [`EventSpeakersController`](#eventspeakerscontroller), whose reads must be full overrides to thread a
  specification. It is also the reason this class does **not** override `ExportAsync`: with no row scoping
  on the reads there is no scoping for an export to bypass, and because the inherited `/export` action
  carries no `[AllowAnonymous]` of its own it stays behind the class-level capability gate (the mechanism
  the sibling controllers' doc comments describe, for example
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:286-287`).
- **Walkthrough**
  - The class is gated by `[HasPermission(ConferencePermissions.QuestionsManage)]` (`QuestionsController.cs:30`),
    a capability granted to Organizer and Admin only
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:43-44`; it is absent
    from the ContentEditor subset,
    `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:57-64`).
    All four reads override that with `[AllowAnonymous]` and attach
    `[OutputCache(PolicyName = "QuestionsCache")]` (5-minute TTL, tags `conference` and
    `conference:questions`, `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:247`).
  - `CreateAsync` (`:92-99`) and `DeleteAsync` (`:121-128`) are thin overrides: call `base.CreateAsync` /
    `base.DeleteAsync`, then `await EvictQuestionsCacheAsync(...)`, then return the base's result. Because
    the base hands back an `ActionResult` rather than a
    [`Result`](group-01-result-error-handling.md#result), these two evict unconditionally, including after a
    rejected command. That is a cheap over-eviction, not a correctness bug, but it is the one place the
    failure-before-evict ordering used elsewhere in this unit cannot be applied.
  - `UpdateAsync` (`:103-117`) is the hand-rolled action (the base has no update): it wraps the body in
    `new UpdateQuestionCommand(id, request)` (`:109`), returns `HandleFailure` on failure (`:112-113`),
    evicts (`:115`), and returns `Ok(result.Value)`.
  - `EvictQuestionsCacheAsync` (`:130-131`) clears the single `conference:questions` tag; unlike the
    sessions and speakers controllers it does not also clear the broad `conference` tag, because no
    cross-entity read projects a question.
- **Why it's built this way**: questions carry no per-role visibility rule, so the controller carries none.
  It is the reference case for how little an aggregate-root controller must write when the base does the
  work: policy, one update action, and eviction.
- **Where it's used**: the Conference service host, reached through the Gateway route
  `/Questions/{**catch-all}` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:92`); the
  feedback-form builder UI is the main client, and the answers flow through
  [`EventQuestionAnswersController`](#eventquestionanswerscontroller) and
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
- **Depends on**: [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (`RoomsController.cs:101`),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  three [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`AddRoomCommand`](group-18-conference-application.md#addroomcommand) /
  [`UpdateRoomCommand`](group-18-conference-application.md#updateroomcommand) /
  [`RemoveRoomCommand`](group-18-conference-application.md#removeroomcommand) (`:94-96`), an
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicRoomFilterQuery`](group-18-conference-application.md#getpublicroomfilterquery) (`:97`),
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) with the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) read-audience helper (`:98, 104`),
  `IOutputCacheStore` (`:99`), the [`RoomDTO`](group-17-conference-domain.md#roomdto), the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute), and its two request
  records [`AddRoomRequest`](#addroomrequest) / [`UpdateRoomRequest`](#updateroomrequest) (`:30-80`), which
  carry the room's name, sort order, and optional capacity / floor / location / accessibility fields.
- **Concept introduced, scoping by a parent's real foreign key.** `[Rubric §11, Security]` and `[Rubric §9,
  API & Contract Design]`: BR-108 hides an unpublished event's venue layout, and `Room` carries a real
  `EventId` column, so the controller does not have to intercept anything. `BuildPublicRoomSpecificationAsync`
  (`RoomsController.cs:114-124`) returns `null` for a privileged reader (`IsPrivileged`, `:104`) and
  otherwise the specification resolved by the `GetPublicRoomFilterQuery` handler; a failed handler result
  degrades to `null` rather than failing the read (`:123`). Because the caller's own `EventId` filter goes
  through the generic filter pipeline unchanged, the two predicates are **composed** by the query service
  rather than substituted, so scoping to an unpublished event returns an empty page instead of that event's
  rooms. The doc comment at `:152-157` states exactly that contract. Compare
  [`SpeakersController`](#speakerscontroller), where `EventId` is *not* a column and the paged action must
  intercept the key by hand.
- **Concept introduced, output-cache eviction on mutation.** `[Rubric §12, Performance & Scalability]`
  assesses caching strategy: every read here is decorated `[OutputCache(PolicyName = "RoomsCache")]`
  (`RoomsController.cs:132, 160, 202, 229`), so anonymous room reads are served from a 5-minute entry tagged
  `conference` and `conference:rooms`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:245`). The correctness half is
  eviction: each mutation ends by calling `EvictRoomsCacheAsync` (`RoomsController.cs:328-329`), which does
  `outputCacheStore.EvictByTagAsync("conference:rooms", ...)`, invalidating exactly the room reads and
  nothing else. `[Rubric §3, Clean Architecture]`: the eviction lives in the controller, not the command
  handler, because `IOutputCacheStore` is an ASP.NET concern the Application layer must not reference.
- **Walkthrough**
  - The class gate is `[HasPermission(ConferencePermissions.RoomsManage)]` (`RoomsController.cs:91`), a
    room-specific capability rather than the event one, even though rooms hang off the event aggregate;
    each read re-opens with `[AllowAnonymous]`.
  - `GetAllAsync` (`:133-150`) and the paged overload (`:161-192`) thread the public specification
    (`:142, 177`), clamp `pageSize` to `MaxPageSize` (`:172`), and append the `X-Pagination` header
    (`:190`).
  - `GetAllForLookupAsync` (`:203-220`) is the anti-side-channel path: privileged readers fall through to
    the base (`:208-209`), everyone else forwards `specification.Criteria` as the lookup `where`
    (`:211-215`) and the rows are rewrapped into a
    [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt) of
    [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) (`:219`).
  - `GetByIdAsync` (`:230-247`) threads the same specification (`:241`). Its doc comment states the rule
    precisely: a room of an unpublished event is a 404, "not a redacted record, so a guessed id cannot
    confirm that an unannounced event exists or that a venue has been booked for it" (`:222-226`).
  - `CreateAsync` (`:258-282`) is `[Idempotent]` (`:257`), maps `AddRoomRequest` to `AddRoomCommand`
    positionally (`:263-271`, note the optional client-supplied `RoomId` in slot two), returns
    `HandleFailure` on failure (`:274-275`), evicts (`:277`), and returns `CreatedAtRoute("GetRoomById", ...)`.
  - `UpdateAsync` (`:286-308`) dispatches `UpdateRoomCommand` with the parent `EventId` from the body and
    the child id from the route (`:292-300`), evicts (`:306`), and returns `NoContent()`.
  - `DeleteAsync` (`:312-326`) reads the parent `eventId` `[FromQuery]` (`:314`), dispatches
    `RemoveRoomCommand(eventId, id)` (`:318`), evicts (`:324`), and returns `NoContent()`.
  - All three mutations return `HandleFailure` *before* they evict, so a failed command never disturbs the
    cache.
- **Why it's built this way**: rooms are read far more than they are edited (venue maps, schedule grids), so
  caching the public reads is worth the eviction bookkeeping on the rare write. Scoping the reads through
  the Application-layer filter query rather than a controller-side join keeps the persistence knowledge out
  of the boundary, the same division [`EventSpeakersController`](#eventspeakerscontroller) uses.
- **Where it's used**: the Conference service host, behind the Gateway route `/Rooms/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:52`); consumed by the room-management UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Room/` and by any schedule view that
  resolves a session's room.
- **Caveats / not-in-source**: this is the one row-scoped controller in the unit that does **not** override
  `ExportAsync`, so `/Rooms/export` streams unscoped, protected only by the class-level `RoomsManage`
  capability. That capability is granted to Organizer and Admin (`DependencyInjection.cs:43-44`) while the
  privileged read audience is Organizer and ContentEditor
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferenceReadAudience.cs:26-30`),
  so the two sets are not identical. Whether the missing override is deliberate is not determinable from
  source: unlike its siblings, the file carries no doc comment on the subject.

---

### SpeakerCategoryItemsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakerCategoryItemsController.cs:48` · Level 9 · class (sealed)

- **What it is**: the REST controller for the link between a
  [`Speaker`](group-17-conference-domain.md#speaker) and a
  [`CategoryItem`](group-17-conference-domain.md#categoryitem) (`/SpeakerCategoryItems`), the association
  that tags a speaker with, for example, a locality or a track. Structurally it is a twin of
  [`EventSpeakersController`](#eventspeakerscontroller): anonymous reads that inherit the parent's
  visibility, organizer add/remove, no update.
- **Depends on**: [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (`SpeakerCategoryItemsController.cs:56`),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  the [`AddSpeakerCategoryItemCommand`](group-18-conference-application.md#addspeakercategoryitemcommand) /
  [`RemoveSpeakerCategoryItemCommand`](group-18-conference-application.md#removespeakercategoryitemcommand)
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s (`:50-51`), an
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicSpeakerCategoryItemFilterQuery`](group-18-conference-application.md#getpublicspeakercategoryitemfilterquery)
  (`:52`), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), `IOutputCacheStore` (`:54`), the
  [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto), the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute), and the
  [`AddSpeakerCategoryItemRequest`](#addspeakercategoryitemrequest) record (`:29-36`).
- **Concept introduced**: none new; this is the junction controller pattern taught at
  [`EventSpeakersController`](#eventspeakerscontroller). Two differences are worth noting.
  `[Rubric §11, Security]`, first, the permission vocabulary tracks the *owning* aggregate: the class is
  guarded by `[HasPermission(ConferencePermissions.SpeakersManage)]`
  (`SpeakerCategoryItemsController.cs:47`) rather than the `EventsManage` its event-side twin uses, so
  managing a speaker's tags requires speaker-management rights. Second, the inherited visibility rule is
  BR-239 (a junction row must not reveal a speaker the caller cannot read) rather than BR-108, resolved by
  the `GetPublicSpeakerCategoryItemFilterQuery` handler through `BuildPublicSpecificationAsync` (`:67-76`),
  with `IsPrivileged` (`:59`) short-circuiting for Organizer / ContentEditor.
- **Walkthrough**: shape-for-shape the same as
  [`EventSpeakersController`](#eventspeakerscontroller), with the `SpeakersCache` policy instead of
  `EventsCache` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:244`). `GetAllAsync`
  (`SpeakerCategoryItemsController.cs:81-99`) and the paged overload (`:104-136`) thread the public
  specification (`:91, 121`) and append `X-Pagination` (`:134`);
  `GetAllForLookupAsync` (`:145-162`) delegates to the base for privileged readers (`:150-151`) and
  otherwise forwards `specification.Criteria` as the lookup `where` (`:153-157`); `GetByIdAsync`
  (`:167-185`) threads the same specification (`:179`). `ExportAsync` (`:194-208`) repeats the
  privileged-reader export gate (`Forbid()` at `:204`, doc comment at `:187-192`). `CreateAsync`
  (`:219-237`) is `[Idempotent]` (`:218`), dispatches
  `AddSpeakerCategoryItemCommand(request.SpeakerId, null, request.CategoryItemId)` (`:224`), evicts, and
  returns `CreatedAtRoute("GetSpeakerCategoryItemById", ...)`; `DeleteAsync` (`:241-257`) reads the parent
  `speakerId` `[FromQuery]` (`:243`), dispatches `RemoveSpeakerCategoryItemCommand(speakerId, id)` (`:247`),
  evicts, and returns `NoContent()`. `EvictJunctionCacheAsync` (`:264-269`) clears `conference:speakers`,
  `conference:categories`, and `conference`.
- **Why it's built this way**: it shares the exact shape of the other junction controllers because the
  underlying rules (mutate the child only through its parent aggregate; never let a junction row out-live
  its parent's visibility) are identical. Only the aggregate, the DTO, the permission, and the pair of cache
  tags change, which is `[Rubric §16, Maintainability]` in practice: one shape learned once, repeated
  without variation.
- **Where it's used**: the Conference service host; consumed by the speaker-profile editing UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/`.

---

### SpeakersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:44` · Level 9 · class (sealed)

- **What it is**: the REST controller for the [`Speaker`](group-17-conference-domain.md#speaker) aggregate
  root (`/Speakers`), and the most authorization-dense controller in the group. On top of aggregate-root
  CRUD it carries the BR-239 public-speaker projection, a virtual `EventId` filter, a self-read carve-out
  with a cache opt-out, resource-level self-edit authorization (BR-214), a capability-gated CSV export, user
  linking / unlinking (BR-209), and three cross-entity read projections (BR-210).
- **Depends on**: [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`SpeakersController.cs:59-60`),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  five [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s
  ([`SpeakerCreateRequest`](group-18-conference-application.md#speakercreaterequest),
  [`UpdateSpeakerCommand`](group-18-conference-application.md#updatespeakercommand),
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype),
  [`LinkUserToSpeakerCommand`](group-18-conference-application.md#linkusertospeakercommand),
  [`UnlinkUserFromSpeakerCommand`](group-18-conference-application.md#unlinkuserfromspeakercommand),
  `:46-50`), five [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)s
  ([`GetSessionFeedbackQuery`](group-18-conference-application.md#getsessionfeedbackquery),
  [`GetSessionBookmarkCountQuery`](group-18-conference-application.md#getsessionbookmarkcountquery),
  [`GetSessionBookmarkCountsQuery`](group-18-conference-application.md#getsessionbookmarkcountsquery),
  [`GetSpeakersByEventFilterQuery`](group-18-conference-application.md#getspeakersbyeventfilterquery),
  [`GetPublicSpeakerFilterQuery`](group-18-conference-application.md#getpublicspeakerfilterquery), `:51-55`),
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) +
  [`RoleNames`](group-08-auth.md#rolenames), `IOutputCacheStore`, the
  [`SpeakerDTO`](group-17-conference-domain.md#speakerdto),
  [`SpeakerUpdateRequest`](group-18-conference-application.md#speakerupdaterequest),
  [`LinkUserRequest`](group-17-conference-domain.md#linkuserrequest),
  [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto), the
  [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute), the
  [`SpecificationExtensions`](group-03-querying-specifications.md#specificationextensions) `And` composer
  that yields an
  [`AndSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#andspecificationtentity-tidentifiertype),
  and [`Error`](group-01-result-error-handling.md#error).
- **Concept introduced, per-action authorization plus row-level ownership checks.**
  `[Rubric §11, Security]`: unlike the other aggregate-root controllers (which gate the whole class with one
  `[HasPermission(...)]`), `SpeakersController` carries a bare class-level `[Authorize]`
  (`SpeakersController.cs:43`) and then varies authorization per action. The catalog reads are
  `[AllowAnonymous]`; export / create / delete / link / unlink each re-assert
  `[HasPermission(ConferencePermissions.SpeakersManage)]` (`:290, 309, 353, 365, 384`); and `UpdateAsync`
  performs a *resource-ownership* check in code, comparing the caller's `speaker_id` JWT claim with the
  route id and returning `Forbid()` when the caller is neither the speaker nor an organizer (`:335-338`,
  BR-214). That is authorization a policy attribute cannot express, because it depends on the specific row
  being edited; the organizer flag is then passed on to the handler as
  `UpdateSpeakerCommand(id, request, CallerIsOrganizer: isOrganizer)` (`:341`) so the handler can keep
  organizer-only fields unchanged on a self-edit. `[Rubric §9, API & Contract Design]`: the paged read
  demonstrates a *virtual filter key*. `EventId` is not a `Speaker` column, so the action removes it from
  the generic filter dictionary before the generic pipeline can reject it (`:154-160`), translates it into a
  specification via `GetSpeakersByEventFilterQuery`, and **ANDs** it with the public-speaker specification
  rather than substituting it (`:162-176`, `publicSpecification.And(...)` at `:174`, the extension member
  declared at
  `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/SpecificationExtensions.cs:48`). Substituting
  would leak hidden speakers to a non-privileged caller; an unparseable value simply drops the scope instead
  of failing the request.
- **Walkthrough**
  - `IsPrivileged` (`SpeakersController.cs:63`) and `BuildPublicSpeakerSpecificationAsync` (`:82-93`): the
    BR-239 projection, parameterized by an optional `eventId` because a speaker accepted for one event is
    not thereby public on another. Privileged readers get `null`.
  - `GetAllAsync` (`:98-117`) applies the unscoped public specification (`:109`); the paged overload
    (`:137-196`) does the `EventId` interception described above and appends `X-Pagination` (`:194`).
  - `GetAllForLookupAsync` (`:211-241`) has two guards. Privileged readers fall through to the base
    (`:215-217`); everyone else must name the label column from the allow-list
    `PublicLookupNameProperties` (`:66`, first or last name only) or receive an
    `Error.InvalidEntityField` failure (`:219-230`). This closes a BR-66 side channel:
    `nameProperty=Email` would otherwise project the speaker email into the lookup label, bypassing the DTO
    mapper that redacts it. The check runs before the query service, so a rejected label is never queried.
  - `GetByIdAsync` (`:246-279`) carries the self-read carve-out: when the caller's `speaker_id` claim
    matches the route id, the specification is dropped so the speaker can always load their own profile
    (`:257-267`), and because that response can contain data the public cannot see while the output-cache
    key does not vary by caller, the action turns storage off for this response via
    `HttpContext.Features.Get<IOutputCacheFeature>()?.Context.AllowCacheStorage = false` (`:266`). The
    policy only ever turns storage off, never back on, so the opt-out sticks.
  - `ExportAsync` (`:291-305`) is the strongest form of the export gate taught at
    [`EventQuestionAnswersController`](#eventquestionanswerscontroller): a declarative
    `[HasPermission(ConferencePermissions.SpeakersManage)]` (`:290`) **plus** the imperative
    `if (!IsPrivileged) return Forbid();` (`:299-302`). The doc comment names the double bypass an unscoped
    CSV would be here: it would go around both the public projection and the redacting DTO mapper, emails
    included, and the attribute is stated explicitly because the class carries only a bare `[Authorize]` for
    the inherited action to pick up (`:281-288`). `[Rubric §30, Compliance/Privacy/Data Governance]`: a
    speaker roster is personal data, so bulk egress is a named capability rather than a side effect of
    reading the list.
  - `CreateAsync` (`:310-317`) and `DeleteAsync` (`:354-361`) call the base and evict.
    `UpdateAsync` (`:329-349`) runs the BR-214 check, dispatches, and evicts.
    `LinkUserAsync` / `UnlinkUserAsync` (`:366-398`) dispatch the link/unlink commands, which drive the
    cross-module User-to-Speaker association over integration events, and evict.
  - The three BR-210 projections split by sensitivity. `GetSessionFeedbackAsync` (`:408-425`) is
    `[Authorize]` (`:407`) and repeats the self-or-organizer gate of the update path (`:413-416`), and it
    carries **no** `[OutputCache]` at all: its doc comment records that every response is
    authorization-dependent, so a shared public entry could serve one speaker's free-text feedback to
    another caller (`:400-405`). The two count endpoints stay `[AllowAnonymous]`:
    `GetSessionBookmarkCountAsync` (`:432-444`) and the batched `GetSessionBookmarkCountsAsync`
    (`:452-464`) run under `BookmarkCountsCache`, a 60-second policy tagged `conference` and
    `conference:sessions` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:264`).
    `[Rubric §7, Microservices Readiness]`: bookmark counts are owned by the Engagement service, in another
    process, whose writes have no handle on this host's cache store, so Engagement's bookmark handler
    publishes an eviction request over the broker that this host turns into a tag drop, and the short TTL
    stays as the backstop for a message that never lands (`Program.cs:253-264`).
  - `EvictSpeakersCacheAsync` (`:466-470`) clears `conference:speakers` and the broad `conference` tag.
- **Why it's built this way**: speaker profiles are edited both by organizers and by the speakers
  themselves, so the controller needs row-aware authorization that a static policy cannot provide; keeping
  that check inline mirrors the per-mutation ownership pattern used across the codebase. The virtual
  `EventId` filter gives clients an event-scoped speaker list without adding a denormalized column to the
  aggregate, and the batched counts endpoint exists to replace the Speaker Dashboard's per-session fan-out
  (`:446-448`), which is `[Rubric §12, Performance & Scalability]` applied at the contract level.
- **Where it's used**: the Conference service host behind the Gateway route `/Speakers/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:48`); consumed by the public speaker directory
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSpeakerList.razor`), the
  speaker self-service profile page, organizer linking tools, and the speaker dashboard's feedback and
  bookmark tiles.

---

### ActivitiesController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ActivitiesController.cs:37` · Level 10 · class (sealed)

- **What it is**: the REST controller for the [`Activity`](group-17-conference-domain.md#activity) aggregate
  root (`/Activities`), the conference's social and networking programme (parties, meetups, sponsor
  receptions). Anonymous reads scoped to published events, and create / update / delete / export behind the
  activities-manage capability (`ActivitiesController.cs:27-31`).
- **Depends on**: [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`ActivitiesController.cs:46-47`),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:38`), three [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s
  ([`ActivityCreateRequest`](group-18-conference-application.md#activitycreaterequest),
  [`UpdateActivityCommand`](group-18-conference-application.md#updateactivitycommand), and a
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  delete handler, `:39-41`), an
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicActivityFilterQuery`](group-18-conference-application.md#getpublicactivityfilterquery) (`:42`),
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) plus the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) read-audience helper (`:43, 50`),
  `IOutputCacheStore` (`:44`), the [`ActivityDTO`](group-17-conference-domain.md#activitydto),
  [`ActivityUpdateRequest`](group-18-conference-application.md#activityupdaterequest) as the PUT body
  (`:227`), the [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) and the
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) catalog, and the
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder).
- **Concept introduced**: none new. This controller is the exact structural twin of
  [`SponsorsController`](#sponsorscontroller): the same bare `[Authorize]` class gate with a per-mutation
  capability, the same real-`EventId`-column scoping (no filter interception), the same
  attribute-plus-imperative export gate. What differs is the vocabulary. `[Rubric §11, Security]`: the class
  carries `[Authorize]` (`ActivitiesController.cs:36`) and each mutation re-asserts
  `[HasPermission(ConferencePermissions.ActivitiesManage)]` (`:193, 212, 224, 243`), the capability declared
  at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:36`
  and included in the `ContentManagement` curation subset (`ConferencePermissions.cs:57-64`), so a content
  editor can run the social programme without holding event, room, or question rights.
  `[Rubric §12, Performance & Scalability]`: reads run under the `ActivitiesCache` policy (5-minute TTL,
  tags `conference` and `conference:activities`,
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:249`) and every mutation evicts both
  tags.
- **Walkthrough**
  - `IsPrivileged` (`ActivitiesController.cs:50`) is the shared
    `currentUserService.IsPrivilegedConferenceReader()` read-audience check;
    `BuildPublicActivitySpecificationAsync` (`:60-70`) returns `null` for a privileged reader and otherwise
    the [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype)
    the `GetPublicActivityFilterQuery` handler resolves (`:66-69`); a failed handler result degrades to
    `null` rather than failing the read.
  - `GetAllAsync` (`:75-92`) and the paged overload (`:103-134`) are `[AllowAnonymous]` +
    `[OutputCache(PolicyName = "ActivitiesCache")]` full overrides that thread the specification
    (`:84, 119`), clamp `pageSize` to `MaxPageSize` (`:114`), and append the `X-Pagination` header (`:132`).
    The paged action's doc comment states the composition contract explicitly: `EventId` is a real column,
    so the caller's event filter travels through the generic pipeline and the published-event rule is ANDed
    on top of it rather than substituted (`:94-99`).
  - `GetAllForLookupAsync` (`:139-156`) is the anti-side-channel path: base action for a privileged reader
    (`:144-145`), otherwise `specification.Criteria` forwarded as the lookup `where` (`:147-151`) and the
    rows rewrapped into a [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt) of
    [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) (`:155`).
  - `GetByIdAsync` (`:165-182`) threads the same specification (`:176`); its doc comment states that an
    activity of an unpublished event is a 404, "not a redacted record, so a guessed id cannot confirm that a
    party has been scheduled" (`:158-161`).
  - `ExportAsync` (`:194-208`) pairs the declarative
    `[HasPermission(ConferencePermissions.ActivitiesManage)]` (`:193`) with the imperative
    `if (!IsPrivileged) return Forbid();` (`:202-205`), then delegates to the base (`:207`). The doc comment
    names the leak an unscoped CSV would be: a social programme that has not been announced (`:184-191`).
  - `CreateAsync` (`:213-220`) and `DeleteAsync` (`:244-251`) are thin overrides that call the base and then
    evict; `UpdateAsync` (`:225-239`) is the hand-rolled action the base does not supply, wrapping the route
    id and body in `new UpdateActivityCommand(id, request)` (`:231`), folding a failure through
    `HandleFailure` (`:234-235`), evicting (`:237`), and returning `Ok(result.Value)`.
  - `EvictActivitiesCacheAsync` (`:253-257`) clears `conference:activities` and the broad `conference` tag,
    the latter because the activity strip renders alongside other conference reads.
- **Why it's built this way**: the social programme has the same publish-gated lifecycle as the rest of the
  catalog, so it reuses the specification pattern rather than inventing an activity-specific visibility
  flag, and because `Activity` owns a real `EventId` none of that scoping needs a virtual key. Repeating the
  sponsor controller's shape verbatim is `[Rubric §16, Maintainability]` in practice: two aggregates with
  identical rules get identical code, so the reader who has learned one has learned both.
- **Where it's used**: the Conference service host behind the Gateway route `/Activities/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:100`). Clients are the public activity page
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicActivityList.razor`) and
  the organizer list, create, and detail pages under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activity/`.

---

### EventsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventsController.cs:45` · Level 10 · class (sealed)

- **What it is**: the REST controller for the [`Event`](group-17-conference-domain.md#event) aggregate root
  (`/Events`), and the richest controller in the group. On top of the standard aggregate-root CRUD it adds
  visibility scoping, a scoped CSV export, publish / unpublish with conditional-write support, a Sessionize
  refresh with bespoke error mapping, iCalendar export, and the "happening now / up next" snapshot.
- **Depends on**: [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`EventsController.cs:58-59`),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  six [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s
  ([`EventCreateRequest`](group-18-conference-application.md#eventcreaterequest),
  [`UpdateEventCommand`](group-18-conference-application.md#updateeventcommand),
  [`PublishEventCommand`](group-18-conference-application.md#publisheventcommand),
  [`UnpublishEventCommand`](group-18-conference-application.md#unpublisheventcommand),
  [`DeleteEntityCommand`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype),
  [`RefreshFromSessionizeCommand`](group-18-conference-application.md#refreshfromsessionizecommand), `:47-52`),
  two [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)s
  ([`ExportEventCalendarQuery`](group-18-conference-application.md#exporteventcalendarquery),
  [`GetNowNextQuery`](group-18-conference-application.md#getnownextquery), `:53-54`),
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), `IOutputCacheStore`, the
  [`PublishedEventSpecification`](group-18-conference-application.md#publishedeventspecification), the
  [`EventDTO`](group-17-conference-domain.md#eventdto),
  [`UpdateEventResult`](group-18-conference-application.md#updateeventresult),
  [`EventUpdateRequest`](group-18-conference-application.md#eventupdaterequest),
  [`EventTransitionRequest`](group-17-conference-domain.md#eventtransitionrequest),
  [`NowNextDTO`](group-17-conference-domain.md#nownextdto),
  [`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto), the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute), and the
  [`SupportsIfMatchAttribute`](group-12-api-hosting-mapping.md#supportsifmatchattribute).
- **Concept introduced, business-rule visibility scoping via a specification.** `[Rubric §11, Security]` and
  `[Rubric §3, Clean Architecture]`: BR-108 says non-privileged readers see only published events. Rather
  than branch inside each query, the controller builds a specification at the boundary:
  `GetPublishedEventSpecification()` (`EventsController.cs:67-68`) returns `null` for a privileged reader
  (`currentUserService.IsPrivilegedConferenceReader()`, so a ContentEditor who reads every session can also
  read the events those sessions belong to) and a `PublishedEventSpecification` for everyone else. Each read
  passes it into `QueryService.GetAllAsync` / `GetByIdAsync` (`:83, 113, 172`), so the authorization
  predicate is a data specification the query service composes into SQL, not imperative post-filtering. The
  lookup endpoint (`:138-155`) applies the same predicate as the `where` argument, closing the side channel
  that would otherwise list draft events by name, and `ExportAsync` (`:187-201`) closes the same channel on
  the CSV path with the privileged-reader `Forbid()` gate (`:195-198`).
- **Concept introduced, conditional writes on a state transition.** `[Rubric §9, API & Contract Design]`
  assesses whether a contract expresses concurrency honestly. `PublishAsync` and `UnpublishAsync` take an
  **optional** body (`[FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] EventTransitionRequest?`,
  `:312, 343`) carrying the client's last-seen row version, so omitting it skips the stale-view check
  ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). Both also carry
  `[SupportsIfMatch]` (`:307, 338`), which lets a caller state the same precondition as an HTTP `If-Match`
  header; the difference is the failure code, 412 rather than 409, and both are declared as
  `[ProducesResponseType]` on each action (`:308-309, 339-340`). The doc comment records the one constraint
  that is easy to trip over: the header populates the bound body, so a caller using `If-Match` must still
  send a body, and `{}` is enough (`:291-304`). Both transitions are also `[Idempotent]` (`:306, 337`),
  because publishing is a state assertion and replaying the stored response for a retried key is exactly
  what the caller meant. `[Rubric §29, Resilience & Business Continuity]`: `RefreshAsync` (`:367-399`) maps
  upstream trouble to retryable HTTP, an `Event.Sessionize.Throttled` error becoming `429` with a
  `Retry-After: 300` header (`:378-382`, BR-63) and `Event.Sessionize.Unavailable` becoming `502`
  (`:385-386`), so an upstream throttle reaches the client as a signal rather than a 500.
- **Walkthrough**
  - The reads (`EventsController.cs:70-178`) attach `[AllowAnonymous]` +
    `[OutputCache(PolicyName = "EventsCache")]` and the published-event specification; the paged overload
    serializes [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata) into the
    `X-Pagination` header (`:126`).
  - `ExportCalendarAsync` (`:210-218`) streams an `.ics` document via `File(...)` with the
    `text/calendar` content type and an `event-{id}.ics` file name (`:217`).
  - `GetNowNextAsync` (`:227-233`) and `GetCurrentNowNextAsync` (`:242-247`) serve the now / next snapshot
    for a given event or, with `GetNowNextQuery(EventId: null)` (`:245`), for the current one; both use the
    short-TTL `NowNextCache` policy (60 seconds,
    `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:252`) because the payload changes with
    the clock. That policy is registered without the privileged-reader bypass, because the snapshot is
    identical for every role (`Program.cs:250-252`).
  - `CreateAsync` (`:256-263`) is an override marked `[Idempotent]` (`:255`), so a retried POST carrying the
    same `Idempotency-Key` is deduplicated; it calls `base.CreateAsync` then evicts. The attribute is
    single-use, so declaring it here coincides with the inherited one instead of duplicating it (`:249-253`).
  - `UpdateAsync` (`:267-289`) appends a non-fatal `X-Warning` header when a timezone change leaves existing
    sessions semantically stale (BR-131, `:280-285`) and returns `Ok(result.Value.Event)`.
  - `RefreshAsync` triggers a Sessionize import and, because that import touches six entity types, evicts
    six tags: events, sessions, speakers, categories, rooms, and questions (`:392-397`).
  - `DeleteAsync` (`:405-414`) additionally evicts `conference:sessions` and `conference:rooms` because
    soft-deleting an event cascades to its children. `EvictEventsCacheAsync` (`:416-417`) is the single-tag
    helper the other mutations share.
- **Why it's built this way**: the base still owns the plain CRUD, so all the event-specific behavior
  (scoping, export gating, publish lifecycle, external refresh, calendar and now-next projections) reads as
  a flat list of extra actions. Mapping Sessionize failures to distinct status codes here keeps that
  operational nuance at the boundary while the handler stays a pure `Result` producer, and the fan-out of
  eviction tags is written where the knowledge of "what this operation touched" actually lives.
- **Where it's used**: the Conference service host behind the Gateway route `/Events/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:40`); the home-screen widget calls `now-next`,
  the public schedule UI
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicEventList.razor`) calls the
  reads and the `.ics` export, and organizer tooling drives publish, unpublish, and refresh.

---

### SessionCategoryItemsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionCategoryItemsController.cs:48` · Level 10 · class (sealed)

- **What it is**: the REST controller for the link between a
  [`Session`](group-17-conference-domain.md#session) and a
  [`CategoryItem`](group-17-conference-domain.md#categoryitem) (`/SessionCategoryItems`), the association
  that tags a session with a track or topic. A junction controller identical in shape to
  [`EventSpeakersController`](#eventspeakerscontroller): anonymous reads that inherit the parent's
  visibility, organizer add/remove, no update.
- **Depends on**: [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (`SessionCategoryItemsController.cs:56`),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  the [`AddSessionCategoryItemCommand`](group-18-conference-application.md#addsessioncategoryitemcommand) /
  [`RemoveSessionCategoryItemCommand`](group-18-conference-application.md#removesessioncategoryitemcommand)
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s (`:50-51`), an
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicSessionCategoryItemFilterQuery`](group-18-conference-application.md#getpublicsessioncategoryitemfilterquery)
  (`:52`), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), `IOutputCacheStore` (`:54`), the
  [`SessionCategoryItemDTO`](group-17-conference-domain.md#sessioncategoryitemdto), the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute), and the
  [`AddSessionCategoryItemRequest`](#addsessioncategoryitemrequest) record (`:29-36`).
- **Concept introduced**: none new; see the junction controller pattern at
  [`EventSpeakersController`](#eventspeakerscontroller). The class is guarded by
  `[HasPermission(ConferencePermissions.SessionsManage)]` (`SessionCategoryItemsController.cs:47`) because
  the association belongs to the session aggregate, and its inherited visibility rule is BR-49 (a junction
  row must not reveal a session the caller cannot read), resolved by `BuildPublicSpecificationAsync`
  (`:67-76`) with `IsPrivileged` (`:59`) short-circuiting for Organizer / ContentEditor.
  `[Rubric §11, Security]`: as with every junction controller here, the write permission follows the owning
  aggregate while the read filter follows the parent's visibility, and the CSV export repeats the
  privileged-reader gate so the scoping cannot be bypassed by asking for the file instead of the page.
- **Walkthrough**: four `[AllowAnonymous]` + `[OutputCache(PolicyName = "SessionsCache")]` reads
  (`SessionCategoryItemsController.cs:78-185`) thread the public specification (`:91, 121, 179`), append
  `X-Pagination` (`:134`), and forward `specification.Criteria` as the lookup `where` for non-privileged
  callers (`:149-157`). `ExportAsync` (`:194-208`) returns `Forbid()` for a non-privileged caller (`:204`)
  and otherwise delegates to the base (`:207`). `CreateAsync` (`:219-237`) is `[Idempotent]` (`:218`),
  dispatches `AddSessionCategoryItemCommand(request.SessionId, null, request.CategoryItemId)` (`:224`),
  evicts, and returns `CreatedAtRoute("GetSessionCategoryItemById", ...)`; `DeleteAsync` (`:241-257`) reads
  the parent `sessionId` `[FromQuery]` (`:243`), dispatches
  `RemoveSessionCategoryItemCommand(sessionId, id)` (`:247`), evicts, and returns `NoContent()`.
  `EvictJunctionCacheAsync` (`:264-269`) clears `conference:sessions`, `conference:categories`, and
  `conference`.
- **Why it's built this way**: same rationale as the other junction controllers, the child mutates only
  through its parent aggregate, so it gets free reads and explicit, command-routed writes; and because a
  tag on a session is visible from both the session page and the category page, both parents' cache tags are
  evicted.
- **Where it's used**: the Conference service host; consumed by the session-editing UI's tag picker and by
  the public schedule filters
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionListFilterBar.razor`).

---

### SessionQuestionAnswersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:57` · Level 10 · class (sealed)

- **What it is**: the REST controller for a session's answered feedback questions
  (`/SessionQuestionAnswers`). It is the exact session-scoped sibling of
  [`EventQuestionAnswersController`](#eventquestionanswerscontroller): reads require authentication and are
  owner-scoped, so an attendee sees only their own answers and an organizer sees all (BR-9).
- **Depends on**: [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (`SessionQuestionAnswersController.cs:64`),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  the add / update / remove
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s for
  [`AddSessionQuestionAnswerCommand`](group-18-conference-application.md#addsessionquestionanswercommand),
  [`UpdateSessionQuestionAnswerCommand`](group-18-conference-application.md#updatesessionquestionanswercommand)
  and [`RemoveSessionQuestionAnswerCommand`](group-18-conference-application.md#removesessionquestionanswercommand)
  (`:59-61`), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) +
  [`RoleNames`](group-08-auth.md#rolenames) for the scoping decision,
  [`OwnedByUserSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ownedbyuserspecificationtentity-tidentifiertype),
  [`AuthorizationPolicies`](group-08-auth.md#authorizationpolicies), the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute), the
  [`SessionQuestionAnswerDTO`](group-17-conference-domain.md#sessionquestionanswerdto), and its two request
  records [`AddSessionQuestionAnswerRequest`](#addsessionquestionanswerrequest) /
  [`UpdateSessionQuestionAnswerRequest`](#updatesessionquestionanswerrequest) (`:26-47`).
- **Concept introduced**: none new; owner-scoped reads and the organizer-only export gate are taught at
  [`EventQuestionAnswersController`](#eventquestionanswerscontroller). `[Rubric §11, Security]`: the class is
  gated with `[Authorize(Policy = AuthorizationPolicies.RequireAuthenticated)]`
  (`SessionQuestionAnswersController.cs:56`) so no endpoint here is anonymous, and
  `GetUserScopingSpecification()` (`:67-68`) returns `null` for
  `currentUserService.IsInRole(RoleNames.Organizer)` and an
  `OwnedByUserSpecification<SessionQuestionAnswer, SessionQuestionAnswerIdentifierType>(currentUserService.UserId!.Value)`
  otherwise. This is a distinct posture from the other session-scoped child controllers, whose reads are
  fully anonymous and filtered by the *parent's* visibility rather than by ownership. As with its event-side
  twin, no read carries an `[OutputCache]` attribute, because a per-caller payload must never enter a shared
  cache entry.
- **Walkthrough**: the reads (`SessionQuestionAnswersController.cs:70-151`) forward to
  `QueryService.GetAllAsync` / `GetByIdAsync` with the scoping specification (`:81, 109, 145`), clamp the
  page size (`:103`), and append the `X-Pagination` header (`:122`); `GetAllForLookupAsync` (`:126-130`)
  delegates straight to the base. `ExportAsync` (`:159-174`) returns `Forbid()` unless the caller is an
  organizer (`:168-171`), the BR-9 form of the row-scoping bypass gate, with the reasoning in its doc
  comment (`:153-158`). `CreateAsync` (`:185-199`) is `[Idempotent]` (`:184`), dispatches
  `AddSessionQuestionAnswerCommand(request.SessionId, null, request.QuestionId, request.AnswerValue)`
  (`:190`) and returns `CreatedAtRoute`. `UpdateAsync` (`:203-215`) dispatches
  `UpdateSessionQuestionAnswerCommand(request.SessionId, id, request.AnswerValue)` (`:209`) and returns
  `NoContent()`. `DeleteAsync` (`:219-231`) reads the parent `sessionId` `[FromQuery]` (`:221`) and
  dispatches `RemoveSessionQuestionAnswerCommand(sessionId, id)` (`:225`).
- **Why it's built this way**: answers are personal feedback, so the read surface cannot be public; scoping
  by specification keeps the authorization rule in one place and lets the query service compose it into the
  database query rather than filtering in memory. Mirroring the event-side controller line for line is
  deliberate: two rules (BR-8 and BR-9) with the same shape get the same implementation, export gate and
  replay contract included.
- **Where it's used**: the Conference service host; consumed by the attendee feedback UI under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/` and by organizer reporting
  screens.

---

### SessionsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionsController.cs:42` · Level 10 · class (sealed)

- **What it is**: the REST controller for the [`Session`](group-17-conference-domain.md#session) aggregate
  root (`/Sessions`). Aggregate-root CRUD plus a cross-source visibility filter (BR-132 / BR-49), a virtual
  `SpeakerId` filter, a gated CSV export, an out-of-range warning header (BR-86), idempotent create, and an
  iCalendar export.
- **Depends on**: [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`SessionsController.cs:54-55`), **two**
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)s
  (one for `Session`, one for `Event` so create can re-read the parent, `:43, 47`), the
  [`SessionCreateRequest`](group-18-conference-application.md#sessioncreaterequest) create handler, the
  [`UpdateSessionCommand`](group-18-conference-application.md#updatesessioncommand) update handler and a
  [`DeleteEntityCommand`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype) delete
  handler (`:44-46`), three
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)s
  ([`GetPublicSessionFilterQuery`](group-18-conference-application.md#getpublicsessionfilterquery),
  [`GetSessionsBySpeakerFilterQuery`](group-18-conference-application.md#getsessionsbyspeakerfilterquery),
  [`ExportSessionCalendarQuery`](group-18-conference-application.md#exportsessioncalendarquery), `:48-50`),
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), `IOutputCacheStore`, the
  [`SessionDTO`](group-17-conference-domain.md#sessiondto),
  [`UpdateSessionResult`](group-18-conference-application.md#updatesessionresult),
  [`SessionUpdateRequest`](group-18-conference-application.md#sessionupdaterequest), the
  [`SpecificationExtensions`](group-03-querying-specifications.md#specificationextensions) `And` composer
  yielding an
  [`AndSpecification`](group-03-querying-specifications.md#andspecificationtentity-tidentifiertype), the
  [`EventDTO`](group-17-conference-domain.md#eventdto), and the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute).
- **Concept introduced, a cross-source visibility specification.** `[Rubric §8, Data Architecture]` and
  `[Rubric §7, Microservices Readiness]`: BR-132 / BR-49 hides non-accepted sessions and the sessions of
  unpublished events from non-privileged readers, but a `Session` can live in one data source while its
  parent `Event`'s published flag lives in another (the doc comment at `SessionsController.cs:60-66` names
  Session in Cosmos and Event in SQL Server, the polyglot option of
  [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). Rather than a
  cross-database join, `BuildPublicSessionSpecificationAsync` (`:67-76`) delegates to the
  `GetPublicSessionFilterQuery` handler, which uses the framework's cross-source specification helper to
  produce a
  [`Specification<Session, SessionIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype)
  the query service can apply; privileged readers get `null`.
  `[Rubric §12, Performance & Scalability]`: reads are `[OutputCache(PolicyName = "SessionsCache")]`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:243`) and the default sort is the
  `"StartsAt,RoomId"` string (`:123`), which sorts the schedule chronologically then by room. The comment
  above it (`:121-122`) records the mechanism: the "ascending" suffix `QueryFieldService.ApplySorting`
  appends binds only to the last column in Dynamic LINQ, and the leading column defaults to ascending, so
  one string sorts both columns ascending.
- **Walkthrough**
  - `BuildPagedSessionSpecificationAsync` (`SessionsController.cs:96-119`) is the paged read's specification
    builder: it takes the public filter (`:100`), then intercepts and removes the virtual `SpeakerId` filter
    key (`Session` has no such column, `:102-107`), resolves it through `GetSessionsBySpeakerFilterQuery`
    (`:109-111`), and **ANDs** the two with `publicSpecification.And(...)` (`:116-118`). As in
    [`SpeakersController`](#speakerscontroller), substitution would leak non-accepted sessions, and an
    unparseable value or a failed handler result simply drops the scope (`:102-107, 113-114`).
  - `GetAllAsync` (`:128-149`) applies the public specification (`:138`) and the default sort (`:140-141`);
    the paged overload (`:154-192`) defaults the sort when none was supplied (`:167-171`), calls the builder
    above (`:177`), and writes `X-Pagination` (`:190`). `GetAllForLookupAsync` (`:203-220`) delegates to the
    base for privileged readers (`:208-209`) and otherwise forwards `specification.Criteria` as the lookup
    `where` (`:211-215`). `GetByIdAsync` (`:225-243`) threads the same specification (`:237`), so a hidden
    session is a 404.
  - `ExportAsync` (`:252-266`) is the same bypass gate the other row-scoped controllers use: `Forbid()` for
    a non-privileged caller (`:260-263`), otherwise the base (`:265`). Its doc comment spells out what an
    unscoped CSV would hand over: the whole catalog, "declined and draft-event sessions included"
    (`:245-250`).
  - `ExportCalendarAsync` (`:275-283`) streams a single session `.ics` via `File(...)` (`:282`).
  - `CreateAsync` (`:292-320`) is an override marked `[Idempotent]` (`:291`) that calls
    `CreateHandler.HandleAsync` directly (`:296`) rather than `base.CreateAsync`, because it needs the
    `Result` in order to run the BR-86 check: when the request set start or end times, it re-reads the
    parent event and appends a non-fatal `X-Warning` header if the session falls outside the event's date
    range (`:303-316`). Note the parent re-read pattern-matches the widened query result with
    `eventResult.Value is EventDTO evt` (`:310`) rather than a dynamic member access, because
    `IEntityQueryService` widens its return to `object` for field projection, so the controller narrows it
    back with a type pattern (the reason is written into the comment at `:305-306`).
  - `UpdateAsync` (`:324-344`) surfaces the same BR-86 warning from `result.Value!.HasDateRangeWarning`
    (`:337`) and returns `Ok(result.Value.Session)`. `DeleteAsync` (`:348-355`) calls the base and evicts.
  - Every mutation ends at `EvictSessionsCacheAsync` (`:357-361`), which clears both the
    `conference:sessions` tag and the broad `conference` tag, the latter because cross-entity projections
    (the speaker bookmark-count endpoints) are cached under `conference:sessions` and `conference` rather
    than under a speakers tag.
- **Why it's built this way**: pushing the cross-source published-event check into a query handler keeps the
  controller free of persistence knowledge (`[Rubric §3, Clean Architecture]`), and the warning headers let
  the API accept a slightly-off schedule while telling the client, rather than rejecting the write outright.
  Calling the create handler directly instead of the base is the deliberate cost of needing the typed
  result at the boundary.
- **Where it's used**: the Conference service host behind the Gateway route `/Sessions/{**catch-all}`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:44`); the public schedule UI
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionList.razor`), the
  "add to calendar" affordance, the speaker dashboard's `SpeakerId`-filtered list, and the k6 load test's
  read endpoints (`/Sessions/paged`) all hit it.

---

### SessionSpeakersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSpeakersController.cs:48` · Level 10 · class (sealed)

- **What it is**: the REST controller for the link between a
  [`Session`](group-17-conference-domain.md#session) and its
  [`Speaker`](group-17-conference-domain.md#speaker)s (`/SessionSpeakers`). A junction controller like
  [`EventSpeakersController`](#eventspeakerscontroller), with one distinguishing detail in its eviction set.
- **Depends on**: [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (`SessionSpeakersController.cs:56`),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  the [`AddSessionSpeakerCommand`](group-18-conference-application.md#addsessionspeakercommand) /
  [`RemoveSessionSpeakerCommand`](group-18-conference-application.md#removesessionspeakercommand)
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s (`:50-51`), an
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicSessionSpeakerFilterQuery`](group-18-conference-application.md#getpublicsessionspeakerfilterquery)
  (`:52`), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), `IOutputCacheStore` (`:54`), the
  [`SessionSpeakerDTO`](group-17-conference-domain.md#sessionspeakerdto), the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute), and the
  [`AddSessionSpeakerRequest`](#addsessionspeakerrequest) record (`:29-36`).
- **Concept introduced**: none new; the junction controller pattern is taught at
  [`EventSpeakersController`](#eventspeakerscontroller), and the BR-49 parent-visibility filter
  (`BuildPublicSpecificationAsync`, `SessionSpeakersController.cs:67-76`) is the same one
  [`SessionCategoryItemsController`](#sessioncategoryitemscontroller) uses, export gate included
  (`:194-208`). The difference is the eviction set: `[Rubric §12, Performance & Scalability]`,
  `EvictSessionsCacheAsync` (`:261-265`) clears `conference:sessions` and the broad `conference` tag, and
  deliberately does **not** clear `conference:speakers` the way the other two-parent junction controllers
  do. The comment at `:232-233` gives the reason: what a speaker assignment changes is the cached session
  detail and list reads (which the speaker dashboard relies on), so the sessions tag is the one that must
  go.
- **Walkthrough**: four `[AllowAnonymous]` + `[OutputCache(PolicyName = "SessionsCache")]` reads
  (`SessionSpeakersController.cs:78-185`) thread the public specification (`:91, 121, 179`), append
  `X-Pagination` (`:134`), and forward `specification.Criteria` as the lookup `where` for non-privileged
  callers (`:149-157`). `ExportAsync` (`:194-208`) returns `Forbid()` for a non-privileged caller (`:204`).
  `CreateAsync` (`:219-239`) is `[Idempotent]` (`:218`), dispatches
  `AddSessionSpeakerCommand(request.SessionId, null, request.SpeakerId)` (`:224`), evicts on success only
  (`:227-234`), and returns `CreatedAtRoute("GetSessionSpeakerById", ...)`; `DeleteAsync` (`:243-259`) reads
  the parent `sessionId` `[FromQuery]` (`:245`), dispatches `RemoveSessionSpeakerCommand(sessionId, id)`
  (`:249`), evicts (`:257`), and returns `NoContent()`. The class gate is
  `[HasPermission(ConferencePermissions.SessionsManage)]` (`:47`).
- **Why it's built this way**: the eviction crosses aggregates deliberately, because the session's cached
  representation includes its speakers, so mutating the link must invalidate the session cache to keep reads
  correct. Everything else is the shared junction shape, which is the point: an engineer who has read
  [`EventSpeakersController`](#eventspeakerscontroller) can read this one in under a minute.
- **Where it's used**: the Conference service host; consumed by the session-editing UI and the speaker
  dashboard.

---

### SponsorsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SponsorsController.cs:37` · Level 10 · class (sealed)

- **What it is**: the REST controller for the [`Sponsor`](group-17-conference-domain.md#sponsor) aggregate
  root (`/Sponsors`), the conference's sponsors and exhibitors. Anonymous reads scoped to published events,
  and create / update / delete / export behind the sponsors-manage capability
  (`SponsorsController.cs:27-31`).
- **Depends on**: [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (`SponsorsController.cs:46-47`),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (`:38`), three [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s
  ([`SponsorCreateRequest`](group-18-conference-application.md#sponsorcreaterequest),
  [`UpdateSponsorCommand`](group-18-conference-application.md#updatesponsorcommand), and a
  [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  delete handler, `:39-41`), an
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for
  [`GetPublicSponsorFilterQuery`](group-18-conference-application.md#getpublicsponsorfilterquery) (`:42`),
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) plus the
  [`CurrentUserServiceExtensions`](#currentuserserviceextensions) read-audience helper (`:43, 50`),
  `IOutputCacheStore` (`:44`), the [`SponsorDTO`](group-17-conference-domain.md#sponsordto),
  [`SponsorUpdateRequest`](group-18-conference-application.md#sponsorupdaterequest) as the PUT body (`:227`),
  the [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) and the
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) catalog, and the
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder).
- **Concept introduced, a real parent column instead of a virtual filter key.** `[Rubric §9, API & Contract
  Design]` assesses whether a contract expresses scoping honestly rather than through special cases.
  Compare this controller with [`SpeakersController`](#speakerscontroller): there, `EventId` is *not* a
  column on the aggregate, so the paged action must intercept the key, remove it from the filter dictionary,
  and translate it into a specification. Here the doc comments record the opposite situation, that
  `Sponsor` carries a real `EventId` column, so an event-scoped request travels through the generic filter
  pipeline unchanged and `BuildPublicSponsorSpecificationAsync` (`:60-70`) only adds the published-event
  rule on top of it (`:52-58, 94-99`). The published rule and the caller's filter are composed by the query
  service rather than substituted, so scoping to an unpublished event returns an empty page to a
  non-privileged caller instead of leaking the roster. That is why this controller, like its
  [`ActivitiesController`](#activitiescontroller) twin and unlike the speaker and session roots, has no
  filter-interception block at all.
  `[Rubric §11, Security]`: the class carries a bare `[Authorize]` (`:36`) and each mutation re-asserts
  `[HasPermission(ConferencePermissions.SponsorsManage)]` (`:193, 212, 224, 243`), the capability declared
  at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:33`
  and included in the `ContentManagement` curation subset (`ConferencePermissions.cs:57-64`), so a content
  editor can manage the sponsor roster without holding event, room, or question rights. `[Rubric §12,
  Performance & Scalability]`: reads run under the `SponsorsCache` policy (5-minute TTL, tags `conference`
  and `conference:sponsors`, `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:248`) and
  every mutation evicts both tags.
- **Walkthrough**
  - `IsPrivileged` (`SponsorsController.cs:50`) is the shared
    `currentUserService.IsPrivilegedConferenceReader()` read-audience check;
    `BuildPublicSponsorSpecificationAsync` (`:60-70`) returns `null` for a privileged reader and otherwise
    the [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype)
    the `GetPublicSponsorFilterQuery` handler resolves (`:66-69`); a failed handler result degrades to
    `null` rather than failing the read.
  - `GetAllAsync` (`:75-92`) and the paged overload (`:103-134`) are `[AllowAnonymous]` +
    `[OutputCache(PolicyName = "SponsorsCache")]` full overrides that thread the specification (`:84, 119`),
    clamp `pageSize` to `MaxPageSize` (`:114`), and append the `X-Pagination` header (`:132`).
  - `GetAllForLookupAsync` (`:139-156`) is the anti-side-channel path taught at
    [`EventSpeakersController`](#eventspeakerscontroller): base action for a privileged reader (`:144-145`),
    otherwise `specification.Criteria` forwarded as the lookup `where` (`:147-151`) and the rows rewrapped
    into a [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt) of
    [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) (`:155`).
  - `GetByIdAsync` (`:165-182`) threads the same specification (`:176`). Its doc comment states the rule
    precisely: a sponsor of an unpublished event is a 404, "not a redacted record, so a guessed id cannot
    confirm that a sponsorship was sold" (`:158-161`).
  - `ExportAsync` (`:194-208`) is the strongest export gate in this unit alongside
    [`SpeakersController`](#speakerscontroller)'s: the declarative
    `[HasPermission(ConferencePermissions.SponsorsManage)]` (`:193`) plus the imperative
    `if (!IsPrivileged) return Forbid();` (`:202-205`). The doc comment names the commercial hazard an
    unscoped CSV would create, confirming sponsorships that have not been announced (`:184-191`).
  - `CreateAsync` (`:213-220`) and `DeleteAsync` (`:244-251`) are thin overrides that call the base and then
    evict; `UpdateAsync` (`:225-239`) is the hand-rolled action the base does not supply, wrapping the route
    id and body in `new UpdateSponsorCommand(id, request)` (`:231`), folding a failure through
    `HandleFailure` (`:234-235`), evicting (`:237`), and returning `Ok(result.Value)`.
  - `EvictSponsorsCacheAsync` (`:253-257`) clears `conference:sponsors` and the broad `conference` tag, the
    latter because the public sponsor strip is rendered alongside other conference reads.
- **Why it's built this way**: sponsors are commercially sensitive before an event is announced but fully
  public afterwards, which is the same published-event rule the rest of the catalog follows, so the
  controller reuses the specification pattern rather than inventing a sponsor-specific visibility flag.
  Because the aggregate owns a real `EventId`, none of that scoping needs a virtual key, which keeps this
  the simplest of the scope-carrying aggregate-root controllers.
- **Where it's used**: hosted by `MMCA.ADC.Conference.Service` and reached through the YARP Gateway, which
  forwards `/Sponsors/{**catch-all}` to the Conference service
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:96`). Clients are the public sponsor page
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSponsorList.razor`) and the
  organizer sponsor list, create, and detail pages under
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsor/`.

### ConferenceErrorResources

> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Resources` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Resources/ConferenceErrorResources.cs:11` · Level 0 · class

- **What it is**: an empty marker class that exists only to be the compile-time anchor for the Conference module's localized error-message resources. It ships no members (`ConferenceErrorResources.cs:11-13`); its `.resx` siblings carry the actual translations.
- **Depends on**: nothing in code (it is a bare `public sealed class` with an empty body). At runtime it is paired with two resource sets, `ConferenceErrorResources.resx` (English) and `ConferenceErrorResources.es.resx` (Spanish), both sitting beside it in `Resources/`, keyed by domain error `Code` such as `"Event.Name.Empty"`, and resolved by the shared `IErrorLocalizer` ([group-12-api-hosting-mapping.md#ierrorlocalizer](group-12-api-hosting-mapping.md#ierrorlocalizer)).
- **Concept introduced: resource-anchor localization of error codes ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).** This is the first Conference-side appearance of the framework's error-localization convention. A [Result](group-01-result-error-handling.md#result) failure carries a stable machine `Code` (see [Error](group-01-result-error-handling.md#error) / [ErrorType](group-01-result-error-handling.md#errortype)); at the API boundary the shared `IErrorLocalizer` looks that `Code` up in a `ResourceManager` built from a marker type. Using a strongly-typed anchor class (rather than a magic-string base name) lets the host register the set generically via `AddErrorResources<ConferenceErrorResources>()`, which the XML doc-comment on the class calls out (`ConferenceErrorResources.cs:7`). `[Rubric §9, API & Contract Design]` (assesses whether the API returns stable, well-shaped errors): the client sees a translated message while the `Code` stays invariant. `[Rubric §27, i18n]` (assesses first-class localization plumbing): translations live in `.resx` culture files, not in domain code.
- **Walkthrough**: there is nothing to trace: the type is `public sealed class ConferenceErrorResources { }` with an empty body (`ConferenceErrorResources.cs:11-13`). All behavior is in the [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) machinery around it. The class doc-comment (`ConferenceErrorResources.cs:3-10`) is the design record, and it names one deliberate omission: runtime-variable messages (ones that interpolate a user-supplied value) are left out of the `.resx` so they degrade gracefully to their English message with the interpolated value intact (`:8-9`).
- **Why it's built this way**: a marker type gives the C# generic registration API something to bind to and gives the `ResourceManager` a namespace-qualified base name, keeping resource lookup type-safe and refactor-safe. See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) (multi-locale i18n) for the error-localization design.
- **Where it's used**: registered by the Conference service host at `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:285` through `services.AddErrorResources<ConferenceErrorResources>()`, under the comment "Contribute the Conference module's error-code translations to the edge localizer (ADR-027)" (`Program.cs:284`); consumed indirectly whenever `IErrorLocalizer` maps a Conference domain failure to a Problem Details response. Its key coverage is asserted by `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Localization/ConferenceErrorResourcesTests.cs`.
- **Caveats / not-in-source**: the exact `.resx` key set is not in this file; it lives in the two `.resx` assets beside it.

### GrpcErrorTrailerParser

> MMCA.ADC.Conference.Contracts · `MMCA.ADC.Conference.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/GrpcErrorTrailerParser.cs:14` · Level 2 · class (static, internal)

- **What it is**: a static helper that reconstructs a `List<Error>` from the `error-{i}-*` gRPC trailers the server side emits when a [Result](group-01-result-error-handling.md#result) failure crosses the wire (`GrpcErrorTrailerParser.cs:7-14`). It is the single shared home for the client-side half of the Result round-trip, used by every client adapter in this project.
- **Depends on**: [Error](group-01-result-error-handling.md#error) and [ErrorType](group-01-result-error-handling.md#errortype) (`MMCA.Common.Shared.Abstractions`, `:3`); `Grpc.Core.Metadata` (the trailer collection, `:2`); `System.Globalization` for invariant index formatting (`:1`).
- **Concept introduced: parsing the Result trailer protocol.** The server side of this protocol is `GrpcResultExceptionInterceptor` plus `ResultGrpcExtensions` ([group-13-grpc-contracts.md#resultgrpcextensions](group-13-grpc-contracts.md#resultgrpcextensions) / [group-13-grpc-contracts.md#grpcresultexceptioninterceptor](group-13-grpc-contracts.md#grpcresultexceptioninterceptor)), which serializes each `Error` into indexed trailers (`error-0-code`, `error-0-message`, `error-0-type`, and so on). This parser is the inverse, and the doc-comment states the design rule it depends on: index-based iteration stops at the first missing code, matching the sequential layout the server writes (`:10-12`). Factoring it out of the individual adapters is the current shape: both Conference client adapters call `GrpcErrorTrailerParser.Parse(...)` instead of each carrying a private copy of the loop. `[Rubric §9, API & Contract Design]` (assesses error-shape fidelity across a boundary): a remote failure deserializes back into the same `Error` list a caller would see in-process. `[Rubric §15, Best Practices & Code Quality]` (assesses DRY and single-responsibility helpers): one parser, one place to change the wire format.
- **Walkthrough**: three methods, top down.
  - `Parse(Metadata trailers)` (`:17`): guards null or empty trailers to an empty list (`:19-23`), then runs a sequential index loop from `i = 0` (`:25-44`). Each iteration formats the index with `CultureInfo.InvariantCulture` (`:28`, so a non-English thread culture cannot produce a different key) and reads `error-{i}-code`; a missing code breaks the loop (`:29-33`). It then reads the sibling `message` (defaulted to `string.Empty`), `type`, `source` and `target` trailers (`:35-38`), resolves the type (`:40`), appends the built `Error` (`:41`), and increments (`:43`).
  - `ParseErrorType(string?)` (`:50-53`): `Enum.TryParse<ErrorType>` with `ignoreCase: false`, defaulting to `ErrorType.Failure` when the wire value does not match a known name.
  - `BuildError(...)` (`:56-68`): a `switch` expression over `ErrorType` that dispatches to the matching `Error` factory (`Error.Validation`, `Error.Invariant`, `Error.NotFoundError`, `Error.Conflict`, `Error.Unauthorized`, `Error.Forbidden`, `Error.UnprocessableEntity`, `Error.Failure`), with `Failure` as both an explicit arm (`:66`) and the discard default (`:67`). Using the typed factories preserves the original `ErrorType`, so downstream HTTP mapping (validation to 400, not-found to 404, and so on) still works after the round-trip.
- **Why it's built this way**: `Result` is an in-process type; gRPC carries only proto messages plus an `RpcException` status. Trailers are the framework's chosen carrier for structured error data, and centralizing the parse keeps [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)'s promise that extraction is transparent to callers. See [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) (gRPC extraction).
- **Where it's used**: exactly two call sites, both in this project and both in this group: [EventLiveValidationServiceGrpcAdapter](#eventlivevalidationservicegrpcadapter) (`EventLiveValidationServiceGrpcAdapter.cs:54,95`) and [SessionBookmarkValidationServiceGrpcAdapter](#sessionbookmarkvalidationservicegrpcadapter) (`SessionBookmarkValidationServiceGrpcAdapter.cs:52,86`), each inside a `catch (RpcException)` block. The `internal` accessibility is what keeps that boundary: nothing outside `MMCA.ADC.Conference.Contracts` can take a dependency on the trailer layout.

### SelfHttpOutputCacheWarmupTask

> MMCA.ADC.Conference.Service · `MMCA.ADC.Conference.Service` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/SelfHttpOutputCacheWarmupTask.cs:22` · Level 2 · class (sealed, internal)

- **What it is**: the Conference host's warm-up task. Once this service has begun listening it replays a fixed set of hot anonymous read requests against the host's own Kestrel endpoint, so the OutputCache (and the connection in front of it) is populated before real traffic arrives (`SelfHttpOutputCacheWarmupTask.cs:6-16`). The interesting detail is how little of it is code: the class contributes a list of URLs and a name, and inherits everything else.
- **Depends on**: `SelfHttpWarmupTaskBase` ([group-16-aspire-orchestration.md#selfhttpwarmuptaskbase](group-16-aspire-orchestration.md#selfhttpwarmuptaskbase)) from `MMCA.Common.Aspire.Warmup`, which it extends (`:28`) and which in turn implements [IWarmupTask](group-16-aspire-orchestration.md#iwarmuptask); the five primary-constructor parameters it forwards straight to that base, `IServer`, `IConfiguration`, `IHostEnvironment`, `IHostApplicationLifetime` and `ILogger<SelfHttpOutputCacheWarmupTask>` (`:22-28`). It declares no other dependency, no field beyond the path array, and no method body.
- **Concept introduced: warm-up-gated readiness, applied ([ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html)).** The mechanism itself is taught with the base class in G16; what this type teaches is the shape of a concrete warm-up. The task is registered via `AddWarmupTask<T>()` and driven by the `AddWarmupReadiness()` runner that `AddServiceDefaults()` wires, so `/health/ready` stays not-ready until the warm-up has had its chance (`:10-13`). The base does the rest: it skips the whole run under the `Testing` environment because a `WebApplicationFactory` `TestServer` never opens a socket (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Warmup/SelfHttpWarmupTaskBase.cs:95-98`), waits on `IHostApplicationLifetime.ApplicationStarted` before self-requesting (`SelfHttpWarmupTaskBase.cs:191-199`), resolves the port from the server's actually-bound cleartext address with `ASPNETCORE_URLS` and port 8080 as fallbacks (`:157-166`), issues each path in order and drains the body (`:119-133`), and swallows every non-cancellation exception as a logged warning (`:137-146`). `[Rubric §12, Performance & Scalability]` (assesses cold-start and cache behavior): the first real user never pays the cold-cache plus cold-EF penalty. `[Rubric §13, Observability & Operability]` (assesses readiness signaling): cache readiness is tied to the health endpoint instead of hoping the cache warms lazily. `[Rubric §16, Maintainability]`: the per-service delta is a string array, so a new hot endpoint is a one-line change with no request machinery to re-derive.
- **Walkthrough**: three members, and the comment above them is the most load-bearing part of the file.
  - The `Paths` array (`:42-56`) with its explanatory comment (`:30-41`). OutputCache keys on the full URL, so a warmed entry is only ever hit when a real caller issues the byte-identical query string. Two families of caller build those URLs differently and both must be warmed. Family 1 is `EntityServiceBase` in `MMCA.Common.UI`, which interpolates C# bools and therefore emits capital `False`/`True`; the four `/paged` and list entries mirror it (`:45-48`). Family 2 is the hand-written lookup services (`EventLookupService`, `SpeakerLookupService`, `CategoryItemLookupService`), which write lowercase literals and pass `pageSize=10000`; those four entries (`:52-55`) do not collide with family 1's URLs, which is exactly why they need their own warm-up: before they were added, the first real caller of three of the four lookups always paid a cold read (`:50-51`).
  - `Name => "SelfHttpOutputCache"` (`:59`): the identity the runner logs the task under.
  - `WarmupPaths => Paths` (`:62`): the single abstract member the base requires.
  - What is *not* overridden matters too. The base defaults `RequestVersion` to HTTP/2 with `RequestVersionExact` (`SelfHttpWarmupTaskBase.cs:70,77`), and this host needs exactly that: its cleartext endpoints are HTTP/2-only (h2c prior knowledge, configured by `builder.ConfigureEndpointsWithHealthProbe(HttpProtocols.Http2)` at `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:85`, see [KestrelEndpointExtensions](group-16-aspire-orchestration.md#kestrelendpointextensions)), so a version-or-lower policy would silently downgrade to HTTP/1.1, be rejected with a 400, and leave the cache cold. `RequireSuccessStatusCode` also stays at its `true` default, which the comment justifies: every path here is `[AllowAnonymous]`, so the require-success loop sees 200 and no path is skipped (`:40-41`).
- **Why it's built this way**: [ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html) (startup warm-up and readiness) replaced the former hand-rolled post-`StartAsync` self-HTTP loop in `Program.cs` with a first-class `IWarmupTask`, so warm-up is uniform across services and its outcome feeds readiness. Pushing the request machinery into `SelfHttpWarmupTaskBase` and leaving only the paths here is the second step of the same idea: four services warm up identically and differ only in what they consider hot.
- **Where it's used**: registered at `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:244` via `services.AddWarmupTask<SelfHttpOutputCacheWarmupTask>()`; executed by the `AddWarmupReadiness()` runner from the shared service defaults. The endpoints it primes are governed by the output-cache policies registered just above it (`Program.cs:214-236`).
- **Caveats / not-in-source**: whether a given warmed URL is the byte-identical URL a real caller issues cannot be proven from this file; the comment (`:30-41`) records the reasoning, and drift in a caller's query string would silently produce a warmed entry nothing reads.

### CurrentUserServiceExtensions

> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Authorization` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Authorization/CurrentUserServiceExtensions.cs:10` · Level 9 · class (static, `extension(ICurrentUserService)`)

- **What it is**: a one-member static class that hangs a single predicate, `IsPrivilegedConferenceReader()`, off any [ICurrentUserService](group-08-auth.md#icurrentuserservice). It is the API layer's wrapper over the module's read-audience catalog, so every Conference controller asks "does this caller read the unfiltered catalog, or the public projection?" the same way instead of hand-rolling a role check per endpoint (`CurrentUserServiceExtensions.cs:6-9`).
- **Depends on**: [ICurrentUserService](group-08-auth.md#icurrentuserservice) from `MMCA.Common.Application.Interfaces.Infrastructure`, the extended type (`CurrentUserServiceExtensions.cs:2,12`), and in particular its `IsInRole` default interface member; [ConferenceReadAudience](group-17-conference-domain.md#conferencereadaudience) from `MMCA.ADC.Conference.Shared.Authorization` (`:1,25`); BCL `Enumerable.Any`. Nothing else: no state, no DI registration, no lifetime.
- **Concept: how the read-audience decision reaches the HTTP boundary.** The rule itself is declared once in [ConferenceReadAudience](group-17-conference-domain.md#conferencereadaudience) (G17), which names the two privileged roles (`RoleNames.Organizer` and `RoleNames.ContentEditor`, `ConferenceReadAudience.cs:26-30`) and nothing more. This class is the middle hop of a three-hop path, and the only hop that touches the current request.
  1. **Shared declares the audience.** `ConferenceReadAudience.PrivilegedRoles` is a bare `IReadOnlyList<string>` with no request or HTTP dependency, which is why the Blazor UI can read the same list.
  2. **The API layer turns the audience into a boolean.** `IsPrivilegedConferenceReader()` matches that list against the current principal's role claims (`:24-25`).
  3. **The controller turns the boolean into rows.** Six of the seven callers cache it as a `private bool IsPrivileged` (for example `SessionsController.cs:58`) and use it to build either a specification or `null`, where `null` means "no filter, show everything" (`SessionsController.cs:69-70`). The specification itself is otherwise resolved by the module's public-filter query handler and handed to `QueryService` (`SessionsController.cs:72-75`), so the audience decision lands in the WHERE clause rather than in a 403.

  That third hop is why this cannot be an attribute. `[Rubric §11, Security]` (assesses whether authorization is applied consistently and at the right granularity): a capability gate such as [HasPermission](group-08-auth.md#haspermissionattribute) answers *may this caller act*, a yes/no verdict an attribute can enforce before the action runs, while the read audience answers *how many rows may this caller see* on an endpoint that stays `[AllowAnonymous]` either way. The method's own remarks fix that boundary so the two are never confused: it "is a read-visibility check, not an authorization gate: mutations stay gated by `[HasPermission(...)]` capabilities, which a role check must never stand in for" (`:20-23`). `[Rubric §1, SOLID]` (open/closed): the check extends `ICurrentUserService` without modifying it or subclassing anything. `[Rubric §16, Maintainability]`: seven call sites, one definition, and widening the audience is an edit to the G17 list rather than a sweep across the API project.
- **Walkthrough**: three nested declarations, one of which is real code.
  - `public static class CurrentUserServiceExtensions` (`:10`): the container the language requires for extension members. It declares nothing of its own.
  - `extension(ICurrentUserService currentUserService)` (`:12`): the C# extension block. Everything inside gains `currentUserService` as its receiver, so the method is called as though it were declared on the interface. The same language feature appears later in this group for composition-root wiring ([DependencyInjection](#dependencyinjection) wraps its two methods in `extension(IServiceCollection services)`); here it carries a predicate rather than a registration.
  - `IsPrivilegedConferenceReader()` (`:24-25`): an expression body, `ConferenceReadAudience.PrivilegedRoles.Any(currentUserService.IsInRole)`. `IsInRole` is passed as a method group, so `Any` short-circuits on the first privileged role the principal holds. Note the two things that are deliberately absent: no null guard and no anonymous branch. `IsInRole` is a default interface member that reduces to `Roles.Any(role => string.Equals(role, roleName, StringComparison.OrdinalIgnoreCase))` (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ICurrentUserService.cs:88-89`), and `Roles` (`ICurrentUserService.cs:45`) yields an empty sequence when the principal carries no role claims, so an anonymous caller falls into the public audience by construction. Case-insensitive comparison and reading *every* role claim rather than only the first (`ICurrentUserService.cs:19`) are likewise inherited from that default member, so a future multi-role token needs no change here.
- **Why it's built this way, and why it lives in the module**: two choices worth naming.
  - *An extension over the interface, not a helper on a controller base.* The seven callers straddle both generic bases from Common: some derive from [AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest) (for example `SessionsController.cs:54-55`) and the rest from [EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype). A protected helper on either base would reach only part of them, and putting it on both would push Conference vocabulary into MMCA.Common. Every caller already injects `ICurrentUserService` for its own reasons (`SessionsController.cs:51`), so extending that interface reaches all seven with no constructor change and no new registration.
  - *Module, not Common.* The method's entire meaning is `ConferenceReadAudience`, which is Conference vocabulary: "privileged reader" has no definition in the framework. Common's `ICurrentUserService` is deliberately module-agnostic and offers `GetClaimValue<T>` (`ICurrentUserService.cs:73`) as the way to read module-specific claims without coupling Common to specific modules. Declaring the extension in `MMCA.ADC.Conference.API.Authorization` keeps the dependency pointing one way: Conference references Common, Common never learns the word "Conference". `[Rubric §3, Clean Architecture]` (assesses dependency direction across layer and package boundaries).
- **Where it's used**: seven Conference REST controllers, all on read paths. Six expose it as `private bool IsPrivileged`: [SessionsController](#sessionscontroller) (`SessionsController.cs:58`, consumed at `:69`), [SpeakersController](#speakerscontroller) (`SpeakersController.cs:63`, consumed at `:86`), [SessionSpeakersController](#sessionspeakerscontroller) (`SessionSpeakersController.cs:58`), [EventSpeakersController](#eventspeakerscontroller) (`EventSpeakersController.cs:57`), [SessionCategoryItemsController](#sessioncategoryitemscontroller) (`SessionCategoryItemsController.cs:58`), and [SpeakerCategoryItemsController](#speakercategoryitemscontroller) (`SpeakerCategoryItemsController.cs:58`). [EventsController](#eventscontroller) calls it inline inside `GetPublishedEventSpecification()` (`EventsController.cs:66-67`), whose result then flows into four read actions (`EventsController.cs:82,112,141,171`). Two downstream shapes follow from the boolean: the list, paged and by-id actions pass the specification (or `null`) to the query service, and the `GET /lookup` actions branch on it, delegating to the framework base action for a privileged reader and otherwise forwarding the specification's `Criteria` to `QueryService.GetAllForLookupAsync` (`EventsController.cs:141-153`, `SpeakersController.cs:216-240`, where the speaker lookup additionally restricts a public caller to the `FirstName` / `LastName` labels, BR-66, `SpeakersController.cs:65-66,219-226`). The Conference service host is the other half of the single-source-of-truth pair: it spreads the same `ConferenceReadAudience.PrivilegedRoles` into the output-cache `adminBypassRoles` array and names this method in the comment explaining why the two lists must agree, since divergence would cache a privileged payload and serve it to the public (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:210-213`).
- **Caveats / not-in-source**: there is no unit-test file for this type. Its behavior is pinned indirectly through the controller tests, which mock `ICurrentUserService` with `CallBase = true` and stub only `Role`, so the real default-interface `Roles` and `IsInRole` implementations execute (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Controllers/SpeakersControllerTests.cs:43,46,48`). The class is `public` rather than `internal`, so nothing prevents a caller outside `MMCA.ADC.Conference.API` from using it, and whether a given JWT actually carries `Organizer` or `ContentEditor` is decided by the Identity module and is not visible from this file.

### EventLiveValidationGrpcService

> MMCA.ADC.Conference.Service · `MMCA.ADC.Conference.Service.Grpc` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/EventLiveValidationGrpcService.cs:22` · Level 10 · class (sealed)

- **What it is**: the gRPC server that exposes Conference's in-process [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) over the wire to consumer services (Engagement's live layer), bridging the C# interface to the `event_live_validation.proto` contract (`EventLiveValidationGrpcService.cs:8-21`).
- **Depends on**: [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) (the inner service it delegates to, injected as a primary-constructor parameter at `:22`); the Protobuf-generated `EventLiveValidationService.EventLiveValidationServiceBase` it inherits (`:23`); `GrpcResultExceptionInterceptor` ([group-13-grpc-contracts.md#grpcresultexceptioninterceptor](group-13-grpc-contracts.md#grpcresultexceptioninterceptor)) reached through the `ThrowIfFailure` extension in `MMCA.Common.Grpc` (`:4`); the [EventLiveInfo](group-17-conference-domain.md#eventliveinfo) / [SessionLiveInfo](group-17-conference-domain.md#sessionliveinfo) value shapes and [QuestionModerationDefault](group-17-conference-domain.md#questionmoderationdefault) from `MMCA.ADC.Conference.Shared.Events` (`:3`); `Grpc.Core`.
- **Concept introduced: Result-to-RpcException on the server side.** This is the mirror of [GrpcErrorTrailerParser](#grpcerrortrailerparser). The class doc-comment (`:13-20`) spells out the protocol: the inner service returns `Result<EventLiveInfo>`; the server calls `result.ThrowIfFailure()`, which raises a `ResultFailureException` that the `GrpcResultExceptionInterceptor` catches and serializes into the `error-{i}-*` trailers the client adapter later parses. `[Rubric §7, Microservices Readiness]` (assesses whether a module can be extracted behind a wire contract without changing its logic): the inner `IEventLiveValidationService` is unchanged and this class is the only added surface. `[Rubric §9, API & Contract Design]` (assesses contract-first typed boundaries): the request and response messages are generated from `.proto`, and Unix-seconds encoding makes the time fields wire-portable.
- **Walkthrough**: two overrides of the generated base, structurally identical.
  - `GetEventLiveInfo` (`:26-47`): null-checks `request` and `context` (`:30-31`, the fail-fast pattern applied to every gRPC method parameter), awaits `inner.GetEventLiveInfoAsync(request.EventId, context.CancellationToken)` with `ConfigureAwait(false)` (`:33-35`), then `result.ThrowIfFailure()` (`:38`) so a failure becomes an `RpcException` through the interceptor. Only past that line does it dereference `result.Value!` (`:40`) and map `EventLiveInfo` into the response, encoding `LiveWindowStartUtc` and `LiveWindowEndUtc` as Unix seconds via `new DateTimeOffset(..., TimeSpan.Zero).ToUnixTimeSeconds()` (`:44-45`).
  - `GetSessionLiveInfo` (`:50-76`): the same null-check and `ThrowIfFailure` shape (`:54-62`), then maps `SessionLiveInfo` including `EventId`, `IsPublished`, the two Unix-seconds live-window bounds, `IsPlenumSession`, and `QuestionModerationDefault` cast to `int` (`:65-73`). The repeated `SpeakerIds` field is filled by projecting each speaker id to its string form through `AddRange` (`:74`), because the proto carries speaker ids as strings rather than as the module's GUID alias.
- **Why it's built this way**: [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) (gRPC extraction) keeps consumer modules bound to the C# interface; the server bridge and the client adapter are the whole extraction cost. Encoding times as Unix seconds avoids proto timestamp and `DateTime` kind ambiguity across the boundary, and casting the enum to `int` keeps the proto free of a duplicated enum definition that could drift.
- **Where it's used**: mapped at `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:368` via `app.MapGrpcService<EventLiveValidationGrpcService>().RequireAuthorization()`, so the endpoint requires the forwarded bearer token like every other cross-service call; its remote counterpart is [EventLiveValidationServiceGrpcAdapter](#eventlivevalidationservicegrpcadapter).

### EventLiveValidationServiceGrpcAdapter

> MMCA.ADC.Conference.Contracts · `MMCA.ADC.Conference.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/EventLiveValidationServiceGrpcAdapter.cs:23` · Level 10 · class (sealed)

- **What it is**: the client-side adapter that implements [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) on top of the generated `EventLiveValidationService.EventLiveValidationServiceClient`, so Engagement's live layer keeps calling the same C# interface while the call actually travels to the extracted Conference service over gRPC (`EventLiveValidationServiceGrpcAdapter.cs:8-22`).
- **Depends on**: [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) (implemented, `:25`); the generated `EventLiveValidationServiceClient` (injected at `:23-24`); [GrpcErrorTrailerParser](#grpcerrortrailerparser) for the failure round-trip; [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error); the [EventLiveInfo](group-17-conference-domain.md#eventliveinfo) / [SessionLiveInfo](group-17-conference-domain.md#sessionliveinfo) value shapes and [QuestionModerationDefault](group-17-conference-domain.md#questionmoderationdefault); `Grpc.Core`.
- **Concept: the client half of Result round-tripping over gRPC** (introduced by [GrpcErrorTrailerParser](#grpcerrortrailerparser) and mirrored by [EventLiveValidationGrpcService](#eventlivevalidationgrpcservice)). Second concept, a **per-call deadline tighter than the resilience pipeline**: `CallDeadline = TimeSpan.FromSeconds(5)` (`:30`) with the reasoning in the comment above it (`:27-29`), namely that these lookups gate live-layer commands (poll open and close, question submit), so a hung (as opposed to refused) Conference peer must fail fast rather than stall the request behind the shared pipeline's 30-second attempt and 90-second total budget. `[Rubric §7, Microservices Readiness]` (assesses transparent extraction), `[Rubric §9, API & Contract Design]` (assesses error-shape preservation): callers see the same `Result<T>` they would from an in-process call. `[Rubric §29, Resilience & Business Continuity]` (assesses failure containment): the deadline bounds the blast radius of a slow peer.
- **Walkthrough**: one constant and two structurally identical methods.
  - `CallDeadline` (`:30`): the 5-second per-call budget, applied as `deadline: DateTime.UtcNow.Add(CallDeadline)` on both calls (`:44`, `:81`). Note it is a deadline, not a timeout: gRPC sends it on the wire so the server can abandon work the client will no longer wait for.
  - `GetEventLiveInfoAsync` (`:33-67`): calls `client.GetEventLiveInfoAsync` inside a `try` (`:39-45`), then on success rebuilds `Result.Success(new EventLiveInfo(...))`, decoding the Unix-seconds bounds back to UTC with `DateTimeOffset.FromUnixTimeSeconds(...).UtcDateTime` (`:47-50`). The `catch (RpcException ex)` (`:52`) delegates to `GrpcErrorTrailerParser.Parse(ex.Trailers)` (`:54`); if structured errors are present it returns `Result.Failure<EventLiveInfo>(errors)` (`:55-58`), otherwise it maps a transport-level fault (connection reset, deadline exceeded) to a generic `Error.Failure` carrying `$"Grpc.{ex.StatusCode}"` as the code, the RPC detail as the message, and the method name as the source (`:60-65`).
  - `GetSessionLiveInfoAsync` (`:70-108`): the same shape, reconstructing `SessionLiveInfo` with `EventId`, `IsPublished`, the two decoded UTC bounds, the speaker ids parsed back from strings with `Guid.Parse` in a collection expression (`:89`), `IsPlenumSession`, and `QuestionModerationDefault` cast from the wire int (`:91`); its catch block repeats the parse-then-fall-back protocol (`:93-107`).
- **Why it's built this way**: [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html): consumers depend on the interface and the composition root swaps the implementation. The transport-fault fallback keeps the caller in `Result` space even when there are no structured trailers to parse, so a Conference outage degrades to a handled failure instead of an unhandled exception.
- **Where it's used**: registered by [DependencyInjection](#dependencyinjection)'s `AddConferenceEventLiveValidationClient` in this group, called from Engagement's host at `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:202`.

### SessionBookmarksGrpcService

> MMCA.ADC.Conference.Service · `MMCA.ADC.Conference.Service.Grpc` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/SessionBookmarksGrpcService.cs:23` · Level 10 · class (sealed)

- **What it is**: the gRPC server that exposes Conference's in-process [ISessionBookmarkValidationService](group-17-conference-domain.md#isessionbookmarkvalidationservice) over the wire to Engagement, bridging the C# interface to the `session_bookmark_validation.proto` contract (`SessionBookmarksGrpcService.cs:9-22`).
- **Depends on**: [ISessionBookmarkValidationService](group-17-conference-domain.md#isessionbookmarkvalidationservice) (injected at `:23`); the generated `SessionBookmarkValidationService.SessionBookmarkValidationServiceBase` it inherits (`:24`); `GrpcResultExceptionInterceptor` ([group-13-grpc-contracts.md#grpcresultexceptioninterceptor](group-13-grpc-contracts.md#grpcresultexceptioninterceptor)) via the `ThrowIfFailure` extension from `MMCA.Common.Grpc` (`:4`); [Result](group-01-result-error-handling.md#result) (`:5`); `Grpc.Core`.
- **Concept: Result-to-RpcException on the server side** (the same protocol as [EventLiveValidationGrpcService](#eventlivevalidationgrpcservice); the doc-comment restates it at `:14-21`). The shape difference: this service's validate method returns a non-generic [Result](group-01-result-error-handling.md#result), so success carries no payload at all. `[Rubric §7, Microservices Readiness]` and `[Rubric §9, API & Contract Design]` apply exactly as for the event-live pair.
- **Walkthrough**: two overrides.
  - `ValidateSessionForBookmark` (`:27-42`): null-checks request and context (`:31-32`), awaits `inner.ValidateSessionForBookmarkAsync(request.SessionId, context.CancellationToken)` (`:34-36`), calls `result.ThrowIfFailure()` (`:39`), and returns an empty `ValidateSessionForBookmarkResponse` on success (`:41`), because the check has no return value beyond pass or fail. An empty message rather than a bool is deliberate: failure travels as trailers, so a `false` field would be a second, redundant failure channel.
  - `GetSessionIdsByEvent` (`:45-62`): the same null-checks (`:49-50`), awaits `inner.GetSessionIdsByEventAsync(request.EventId, context.CancellationToken)` (`:52-54`), calls `result.ThrowIfFailure()` (`:57`), then constructs the response and copies `result.Value` into the proto repeated `SessionIds` field with `AddRange` (`:59-61`). Both methods therefore go through the same failure protocol; only the success payload differs.
- **Why it's built this way**: [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html): the extraction adds only the server bridge and the client adapter, and the inner service is untouched. `[Rubric §16, Maintainability]` (assesses low-friction evolution): adding a cross-service method means one proto rpc, one override here, and one method on the adapter, following the established pattern.
- **Where it's used**: mapped at `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:367` via `app.MapGrpcService<SessionBookmarksGrpcService>().RequireAuthorization()`; its remote counterpart is [SessionBookmarkValidationServiceGrpcAdapter](#sessionbookmarkvalidationservicegrpcadapter).

### SessionBookmarkValidationServiceGrpcAdapter

> MMCA.ADC.Conference.Contracts · `MMCA.ADC.Conference.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:24` · Level 10 · class (sealed)

- **What it is**: the client-side adapter that implements [ISessionBookmarkValidationService](group-17-conference-domain.md#isessionbookmarkvalidationservice) on top of the generated `SessionBookmarkValidationService.SessionBookmarkValidationServiceClient`, so Engagement keeps depending on the C# interface while the real Conference module runs as its own service (`SessionBookmarkValidationServiceGrpcAdapter.cs:8-23`).
- **Depends on**: [ISessionBookmarkValidationService](group-17-conference-domain.md#isessionbookmarkvalidationservice) (implemented, `:26`); the generated `SessionBookmarkValidationServiceClient` (injected at `:24-25`); [GrpcErrorTrailerParser](#grpcerrortrailerparser); [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error); `Grpc.Core`.
- **Concept: the client half of Result round-tripping** (introduced by [GrpcErrorTrailerParser](#grpcerrortrailerparser)). This adapter is the near-identical sibling of [EventLiveValidationServiceGrpcAdapter](#eventlivevalidationservicegrpcadapter), including its own 5-second `CallDeadline` (`:32`) with the same rationale recorded in the comment above it (`:28-31`): these calls sit inline in user request paths (bookmark create, bookmark list), so a hung peer must fail fast rather than hold the caller's request hostage. The only shape difference is that the validate method returns a non-generic `Result` while the query returns `Result<IReadOnlyCollection<SessionIdentifierType>>`.
- **Walkthrough**: two methods.
  - `ValidateSessionForBookmarkAsync` (`:35-65`): calls the client inside a `try` with the deadline applied and returns `Result.Success()` (`:41-48`); the `catch (RpcException)` (`:50`) runs `GrpcErrorTrailerParser.Parse(ex.Trailers)` (`:52`) and returns `Result.Failure(errors)` when trailers are present (`:53-56`), else a generic `Error.Failure` with `$"Grpc.{ex.StatusCode}"` and the RPC detail for a transport fault (`:58-63`).
  - `GetSessionIdsByEventAsync` (`:68-101`): the same protocol. On success it spreads the proto repeated field into a collection expression and returns `Result.Success<IReadOnlyCollection<SessionIdentifierType>>([.. response.SessionIds])` (`:74-82`); on `RpcException` it parses trailers first (`:86-90`) and otherwise returns a generic failure (`:96-99`). The comment at `:92-95` records why the catch parity matters: without it a Conference outage would surface on GET bookmarks-by-event as a raw 500 instead of a `Result` failure the caller can handle.
- **Why it's built this way**: [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html): consumers stay bound to the interface and the composition root swaps in this adapter. Both methods map failures into `Result` so a peer outage never escapes as an unhandled exception from a user-facing request path.
- **Where it's used**: registered by [DependencyInjection](#dependencyinjection)'s `AddConferenceSessionValidationClient` in this group, called from Engagement's host at `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:197`.

### DependencyInjection

> MMCA.ADC.Conference.Contracts · `MMCA.ADC.Conference.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/DependencyInjection.cs:15` · Level 11 · class (static, `extension(IServiceCollection)`)

- **What it is**: the composition-root helper a consuming host (Engagement) calls to swap Conference's in-process service registrations for gRPC-backed adapters pointing at the extracted Conference service (`DependencyInjection.cs:10-14`). It exposes two extension methods, one per Conference contract.
- **Depends on**: `AddTypedGrpcClient<T>` from `MMCA.Common.Grpc` (`:6`); `ServiceCollectionDescriptorExtensions.Replace` and `ServiceDescriptor.Scoped` (Microsoft DI, `:1-2`); the two interfaces it rebinds ([ISessionBookmarkValidationService](group-17-conference-domain.md#isessionbookmarkvalidationservice), [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice), `:4-5`); the two adapters it binds them to ([SessionBookmarkValidationServiceGrpcAdapter](#sessionbookmarkvalidationservicegrpcadapter), [EventLiveValidationServiceGrpcAdapter](#eventlivevalidationservicegrpcadapter)); the generated client types from `MMCA.ADC.Conference.Contracts.V1` (`:3`).
- **Concept introduced: the gRPC adapter-swap pattern via `Replace`.** `[Rubric §7, Microservices Readiness]` (assesses explicit, extractable service contracts, the core of [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)): in the modular monolith the Conference module registers a concrete in-process implementation of each service interface; when Conference runs as its own service the consuming host no longer has that implementation, so instead of rewriting call sites it calls one method here to rebind the interface to a gRPC adapter. `[Rubric §17, DevOps & Deployment]` (assesses how topology changes show up in code): this DI swap is the entire deployment-topology change. `[Rubric §33, Developer Experience]` (assesses convention over configuration): each method defaults `serviceName` to `"conference"` to match the AppHost resource name (`:41-42`, `:71-72`), so the common call takes no argument.
- **Walkthrough**: the class wraps both methods in one `extension(IServiceCollection services)` block (`:17`). Each method does exactly two things.
  - `AddConferenceSessionValidationClient(string serviceName = "conference")` (`:43-52`): registers the typed gRPC client with `services.AddTypedGrpcClient<SessionBookmarkValidationService.SessionBookmarkValidationServiceClient>(serviceName)` (`:45`), which per the doc-comment wires Aspire service discovery (`http://{serviceName}`), the JWT-forwarding interceptor and the Polly resilience handler from `MMCA.Common.Grpc` (`:22-24`). Then `services.Replace(ServiceDescriptor.Scoped<ISessionBookmarkValidationService, SessionBookmarkValidationServiceGrpcAdapter>())` (`:49`), and it returns `services` for chaining (`:51`).
  - `AddConferenceEventLiveValidationClient(string serviceName = "conference")` (`:73-82`): the identical shape for the event-live pair (`:75-81`).
  - The critical choice is `Replace` rather than `TryAdd`, documented at length in the doc-comments and inline notes (`:25-34`, `:47-48`, `:60-69`, `:77-78`): by the time the host calls this, the container already holds either the real in-process implementation (registered by Conference.Application when the Conference module is enabled) or the `DisabledSessionBookmarkValidationService` / `DisabledEventLiveValidationService` stub ([group-17-conference-domain.md#disabledsessionbookmarkvalidationservice](group-17-conference-domain.md#disabledsessionbookmarkvalidationservice) / [group-17-conference-domain.md#disabledeventlivevalidationservice](group-17-conference-domain.md#disabledeventlivevalidationservice)) that [ConferenceModule](#conferencemodule)'s `RegisterDisabledStubs` added. `Replace` wins over both; `TryAdd` would silently lose to whichever binding is already present. The doc-comment (`:35-39`) also fixes the ordering constraint: call these AFTER `ModuleLoader.DiscoverAndRegister(...)` ([ModuleLoader](group-14-module-system-composition.md#moduleloader)) so the in-process or stub registration exists for `Replace` to overwrite.
- **Why it's built this way**: [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) (gRPC extraction): consumer modules keep their interface dependency and the composition root does the swap, so extraction is a DI concern rather than an application-code change. Registering the adapter as `Scoped` matches the lifetime of the in-process implementation it replaces, so consumer call sites need no lifetime rethink.
- **Where it's used**: Engagement's service host calls both methods after module registration (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:197,202`), since Engagement's live layer consumes both Conference contracts across the boundary; the host comment there (`Program.cs:186-196`) is the narrative version of the `Replace` rationale above.
- **Caveats / not-in-source**: nothing in this file enforces the "call after `ModuleLoader`" ordering; it is a doc-comment contract, and a host that called these first would have its adapter overwritten by the module registration without any compile-time or startup signal.


---
[⬅ ADC Conference - Infrastructure & Persistence](group-19-conference-infrastructure.md)  •  [Index](00-index.md)  •  [ADC Conference - UI ➡](group-21-conference-ui.md)
