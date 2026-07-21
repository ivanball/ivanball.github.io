# 20. ADC Conference - API, gRPC Contracts & Service Host

This chapter is the **edge of the Conference bounded context**, the layer that turns the rich Conference domain ([G17](group-17-conference-domain.md)) and its CQRS slices ([G18](group-18-conference-application.md)) into a running HTTP + gRPC surface, plus the small amount of glue that lets that surface be hosted **either** inside the ADC monolith **or** as its own extracted microservice (`MMCA.ADC.Conference.Service`) with no change to the application code beneath. Almost nothing here is novel: the controllers are thin shells over the generic REST machinery taught in [G12 (API Hosting, Middleware & DTO Mapping)](group-12-api-hosting-mapping.md), the gRPC pieces are concrete instances of the transport boundary taught in [G13 (gRPC & Inter-Service Contracts)](group-13-grpc-contracts.md), and the module entry point is one implementation of the [`IModule`](group-14-module-system-composition.md#imodule) contract from [G14 (Module System & Composition)](group-14-module-system-composition.md). What this chapter teaches is *how the Conference module wires those reusable pieces into a real, fifteen-controller, twice-gRPC-edged conference API*, and the handful of places where it deviates from the generic shape for a genuine business reason. The headline rubric lenses are `[Rubric §9, API & Contract Design]` (a consistent, versioned REST + gRPC contract), `[Rubric §5, Vertical Slice]` and `[Rubric §6, CQRS & Event-Driven]` (each action dispatches to a single command/query handler), and `[Rubric §7, Microservices Readiness]` (the same code runs in-process or extracted). Everything lives in three projects: `MMCA.ADC.Conference.API` (the REST controllers, the [`ConferenceModule`](#conferencemodule) entry point, the [`ConferenceModuleSeeder`](#conferencemoduleseeder)), `MMCA.ADC.Conference.Service` (the host wiring plus the gRPC servers), and `MMCA.ADC.Conference.Contracts` (the client-side gRPC adapters and the contract-package DI).

## The controller hierarchy, almost everything is inherited

The Conference API exposes **fifteen controllers**, and the striking thing about them is how little code each carries. They split into three structural families, all built on the generic controller bases from [G12](group-12-api-hosting-mapping.md). **Aggregate-root controllers** (five: [`SessionsController`](#sessionscontroller), [`SpeakersController`](#speakerscontroller), [`EventsController`](#eventscontroller), [`QuestionsController`](#questionscontroller), [`ConferenceCategoriesController`](#conferencecategoriescontroller)) derive from [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest) and inherit the full read + create + delete surface, often only `override`-ing actions to add `[AllowAnonymous]`, an `[OutputCache]` policy, or a business rule ([`SessionsController`](#sessionscontroller) derives from that base at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionsController.cs:52`, [`EventsController`](#eventscontroller) at `EventsController.cs:56`, [`QuestionsController`](#questionscontroller) at `QuestionsController.cs:38`, [`ConferenceCategoriesController`](#conferencecategoriescontroller) at `ConferenceCategoriesController.cs:39`, [`SpeakersController`](#speakerscontroller) at `SpeakersController.cs:56`). **Child-and-join controllers** (eight: [`RoomsController`](#roomscontroller), [`CategoryItemsController`](#categoryitemscontroller), [`EventSpeakersController`](#eventspeakerscontroller), [`SessionSpeakersController`](#sessionspeakerscontroller), [`SessionCategoryItemsController`](#sessioncategoryitemscontroller), [`SpeakerCategoryItemsController`](#speakercategoryitemscontroller), [`EventQuestionAnswersController`](#eventquestionanswerscontroller), [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller)) derive from the read-oriented [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype) (for example `RoomsController.cs:92`, `SessionSpeakersController.cs:46`, `EventQuestionAnswersController.cs:63`) and add their own `POST`/`PUT`/`DELETE` actions by hand, because they manipulate a *child* of an aggregate (a room belongs to an event, a category item to a category) and so their write commands carry a parent identifier the generic create/delete cannot supply. And **bespoke controllers** (two: [`ServiceInfoController`](#serviceinfocontroller) and [`SessionSelectionController`](#sessionselectioncontroller)) sit apart: `SessionSelectionController` derives from Common's [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSelectionController.cs:37`) and `ServiceInfoController` from the shared [`ServiceInfoControllerBase`](group-12-api-hosting-mapping.md#serviceinfocontrollerbase) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:20`), because neither exposes a CRUD entity at all.

The reason a concrete controller can be short is that the generic bases already supply `GET` (capped, returning [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt)), `GET /paged` (filtered/sorted/paged with an `X-Pagination` header, returning [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt)), `GET /lookup` (id+name pairs as [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) for dropdowns), `GET /{id}`, and, on the aggregate base, `POST` (to `201 Created`) and `DELETE` (to `204`). Each Conference controller's constructor simply injects the [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype) for reads and the specific [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) / [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) instances for its writes and bespoke reads (`SessionsController.cs:41-51`), then folds any `Result.Failure` back through the inherited `HandleFailure` (`SessionsController.cs:102`). That is the `[Rubric §1, SOLID]` / `[Rubric §16, Maintainability & Evolvability]` payoff the generic base exists for (the generic-controller + dynamic-query contract of ADR-034): the CRUD logic is written once in Common, and a per-entity controller has almost no reason to change.

## Authorization at the edge, three shapes not one

Authorization is **capability-based by default but not uniform**, and the differences are the interesting part. Most write-bearing controllers carry a class-level [`HasPermission`](group-08-auth.md#haspermissionattribute) gate naming one [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) capability rather than a role policy: `SessionsManage` on [`SessionsController`](#sessionscontroller) (`SessionsController.cs:40`) and on the two session-join controllers (`SessionSpeakersController.cs:39`, `SessionCategoryItemsController.cs:38`), `EventsManage` (`EventsController.cs:42`, `EventSpeakersController.cs:38`), `RoomsManage` (`RoomsController.cs:84`), `CategoriesManage` (`ConferenceCategoriesController.cs:31`, `CategoryItemsController.cs:59`), `QuestionsManage` (`QuestionsController.cs:30`), `SpeakersManage` (`SpeakerCategoryItemsController.cs:38`), and `SessionSelectionManage` (`SessionSelectionController.cs:28`). Reads are then re-opened action by action with `[AllowAnonymous]` (BR-43 public browse, for example `SessionsController.cs:80`, `RoomsController.cs:95`).

Two controllers deliberately break that pattern, and knowing why saves you from "fixing" them. [`SpeakersController`](#speakerscontroller) carries only a plain `[Authorize]` at class level (`SpeakersController.cs:41`) and pushes `[HasPermission(ConferencePermissions.SpeakersManage)]` down onto the individual organizer write actions (`SpeakersController.cs:151,194,206,225`), because one of its writes is an authenticated self-service surface rather than an organizer surface and re-declares plain `[Authorize]` (`SpeakersController.cs:169`). And [`EventQuestionAnswersController`](#eventquestionanswerscontroller) / [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller) gate on `[Authorize(Policy = AuthorizationPolicies.RequireAuthenticated)]` instead (`EventQuestionAnswersController.cs:55`, `SessionQuestionAnswersController.cs:55`), because *any* signed-in attendee may submit feedback answers, so no organizer capability applies. Which roles hold which capability is declared once in `AddModuleConferenceAPI` (see below), the permission-over-RBAC model of ADR-020; `[Rubric §11, Security]` is the lens, and these two exceptions are the evidence that the model is applied per endpoint rather than pasted.

## The request records, the inbound write shapes

Several controllers declare small `record class` request types alongside themselves, co-located in the same file: [`AddRoomRequest`](#addroomrequest)/[`UpdateRoomRequest`](#updateroomrequest) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:24,52`), [`AddCategoryItemRequest`](#addcategoryitemrequest)/[`UpdateCategoryItemRequest`](#updatecategoryitemrequest) (`CategoryItemsController.cs:23,39`), [`AddEventSpeakerRequest`](#addeventspeakerrequest) (`EventSpeakersController.cs:22`), [`AddSessionSpeakerRequest`](#addsessionspeakerrequest) (`SessionSpeakersController.cs:23`), [`AddSpeakerCategoryItemRequest`](#addspeakercategoryitemrequest) (`SpeakerCategoryItemsController.cs:22`), [`AddSessionCategoryItemRequest`](#addsessioncategoryitemrequest) (`SessionCategoryItemsController.cs:22`), [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest)/[`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest) (`EventQuestionAnswersController.cs:26,39`), and [`AddSessionQuestionAnswerRequest`](#addsessionquestionanswerrequest)/[`UpdateSessionQuestionAnswerRequest`](#updatesessionquestionanswerrequest) (`SessionQuestionAnswersController.cs:26,39`). These are the **wire shapes** for the child-entity writes the generic base cannot model: each carries the parent identifier (`EventId` at `RoomsController.cs:27`) plus the child's own fields, all `required`/`init` for immutability (`RoomsController.cs:26-48`), and the controller action translates the record into the matching `Add*Command`/`Update*Command` from [G18](group-18-conference-application.md). They are deliberately separate from the inbound *application* command types (and from the outbound DTOs), the §9 "DTOs decoupled from entities" discipline, so the HTTP contract can evolve independently of the command's parameter list. The aggregate-root controllers, by contrast, reuse the application layer's create-request command directly (for example [`SessionsController`](#sessionscontroller) binds `SessionCreateRequest` as its `TCreateRequest`, `SessionsController.cs:52`), so they need no per-controller record.

## Where the generic shape gives way: filtering, caching, and calendars

[`SessionsController`](#sessionscontroller) is the best illustration of *how* a controller earns its overrides. Every read action is `[AllowAnonymous]` and `[OutputCache(PolicyName = "SessionsCache")]` (`SessionsController.cs:79-81,105-107,148-150,156-158`), and every one of them threads a specification built by `BuildPublicSessionSpecificationAsync` (`SessionsController.cs:64-73`), which returns `null` for organizers and otherwise dispatches the [`GetPublicSessionFilterQuery`](group-18-conference-application.md#getpublicsessionfilterquery) handler so non-organizers never see declined sessions (BR-132/BR-49). The cross-source part matters: `Session` and `Event` can live in different data sources, so the published-event check is resolved by that handler through the framework's cross-source specification helper rather than by a join (`SessionsController.cs:58-63`; ADR-018). The same controller adds two things the base has no notion of: a `PUT /{id}` update that surfaces a BR-86 `X-Warning` header when a session's times fall outside its event's date range (`SessionsController.cs:234-255`), and a `GET /{id}/ics` action that streams one public session as an iCalendar document for the add-to-calendar affordance (`SessionsController.cs:183-194`) via [`ExportSessionCalendarQuery`](group-18-conference-application.md#exportsessioncalendarquery). Every mutating action finishes by calling `EvictSessionsCacheAsync`, which evicts both the `conference:sessions` and `conference` output-cache tags (`SessionsController.cs:229,253,264,268-272`), the write-side half of the caching contract. [`EventsController`](#eventscontroller) follows the same recipe and adds its own `GET /{id}/ics` plus per-event and global `now-next` snapshot actions under the short-lived `NowNextCache` policy (`EventsController.cs:158-193`), alongside publish, unpublish, and Sessionize-refresh commands (`EventsController.cs:243,260,278`). `[Rubric §12, Performance & Scalability]` is the lens for the whole caching story here.

## Two more deviations, versioning and decision support

[`ServiceInfoController`](#serviceinfocontroller) exists to **prove the API-versioning machinery works beyond a single version** (`[Rubric §9, API & Contract Design]`). It is a four-line shell over Common's [`ServiceInfoControllerBase`](group-12-api-hosting-mapping.md#serviceinfocontrollerbase): it overrides only `ServiceName => "Conference"` (`ServiceInfoController.cs:23`) and carries the class-level `[AllowAnonymous]`, `[ApiVersion("1.0", Deprecated = true)]`, and `[ApiVersion("2.0")]` attributes (`ServiceInfoController.cs:17-19`), which are placed here because they are not reliably inherited from the base (`ServiceInfoController.cs:12-13`). The shared base serves the same `/ServiceInfo` route at two API versions selected by the `api-version` header: `1.0` (deprecated) returns the minimal [`ServiceInfoResponse`](group-12-api-hosting-mapping.md#serviceinforesponse); `2.0` returns the evolved [`ServiceInfoV2Response`](group-12-api-hosting-mapping.md#serviceinfov2response) that also advertises the supported/deprecated version lists. Every other Conference controller declares a single `[ApiVersion("1.0")]`; this one demonstrates the deprecation story end to end.

[`SessionSelectionController`](#sessionselectioncontroller) is the most behaviour-rich controller in the group and the one furthest from the generic shape. It is **organizer-only** (`[HasPermission(ConferencePermissions.SessionSelectionManage)]`, `SessionSelectionController.cs:28`) decision support over an event's session pool: a composite dashboard, category distribution, speaker overlap, and content similarity, each `GET` delegating to a dedicated [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) and output-cached under the `ConferenceCache` policy (`SessionSelectionController.cs:40-41,54-55,68-69,82-83`). Its `POST score/{eventId}` action is the notable one: AI scoring of every eligible session can take minutes, so the action **returns `202 Accepted` immediately** (`SessionSelectionController.cs:101-108`) and runs the [`ScoreEventSessionsCommand`](group-18-conference-application.md#scoreeventsessionscommand) in a background `IServiceScopeFactory` scope (`SessionSelectionController.cs:118-122`), because the request scope would be disposed before the work finished, evicting the `conference` output-cache tag both before and after so the dashboard reflects fresh scores (`SessionSelectionController.cs:115,127`). This is a fire-and-forget pattern the generic bases deliberately do not provide; the controller owns it explicitly, with `[LoggerMessage]`-sourced structured logs for completion and failure (`SessionSelectionController.cs:140-144`, `[Rubric §13, Observability & Operability]`).

## The module entry point and seeder, how Conference plugs in

[`ConferenceModule`](#conferencemodule) is the Conference implementation of [`IModule`](group-14-module-system-composition.md#imodule). It is tiny by design: `Register(...)` calls the [`DependencyInjection`](#dependencyinjection) extension's `AddConferenceModule(...)` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModule.cs:28-29`), which chains the Application, Infrastructure, and API-layer registrations in dependency order into one call (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:25-27`). The API layer's `AddModuleConferenceAPI` is not a no-op: it calls `AddPermissions` to grant [`RoleNames`](group-08-auth.md#rolenames)`.Organizer` and `.Admin` every [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) capability, and `ContentEditor` only the `ContentManagement` curation subset with no event structure, rooms, questions, or session selection (`DependencyInjection.cs:41-51`). Attendees are granted nothing here, so attendee-facing endpoints stay on the plain [`AuthorizationPolicies`](group-08-auth.md#authorizationpolicies)`.RequireAuthenticated` policy (`DependencyInjection.cs:34-36`). And `RegisterDisabledStubs(...)` registers **both** a [`DisabledSessionBookmarkValidationService`](group-17-conference-domain.md#disabledsessionbookmarkvalidationservice) and a [`DisabledEventLiveValidationService`](group-17-conference-domain.md#disabledeventlivevalidationservice) as singletons (`ConferenceModule.cs:23-24`) so that *other* hosts which depend on Conference's [`ISessionBookmarkValidationService`](group-17-conference-domain.md#isessionbookmarkvalidationservice) or [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice) but do **not** host Conference still resolve those interfaces (they no-op, or are later `Replace`d by the gRPC adapters). The [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) ([G14](group-14-module-system-composition.md)) discovers `ConferenceModule` by reflection and registers it in topological order, the same mechanism whether Conference runs in the monolith or alone in its service.

[`ConferenceModuleSeeder`](#conferencemoduleseeder) implements [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:13`) and is the API layer's thin bridge to the real seeding logic: it resolves `IUnitOfWork` and `IConfiguration` from the passed service provider, reads `Seeding:IncludeSampleConferenceData` (defaulting to false when the key is absent, and set only on the local AppHost and in E2E CI), then constructs and runs `ConferenceModuleDbSeeder` from [G19](group-19-conference-infrastructure.md) with that flag (`ConferenceModuleSeeder.cs:19-30`). The two markers [`AssemblyReference`](#assemblyreference) / [`ClassReference`](#classreference) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/AssemblyReference.cs:5,11`) are the per-package anchors the Scrutor module scan and the architecture fitness tests pin against, and [`ConferenceErrorResources`](#conferenceerrorresources) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Resources/ConferenceErrorResources.cs:11`) is a similarly empty sealed class acting as the `.resx` anchor for the module's error-code translations.

## The gRPC edge, Conference as both server and client

When Conference is extracted into its own process, two of its in-process collaborations must cross a network boundary, and both are handled by the [G13](group-13-grpc-contracts.md) transport boundary (`Result` over the wire, transport at the edge, ADR-007). Conference is the **server** for two contracts. [`SessionBookmarksGrpcService`](#sessionbookmarksgrpcservice) (in `MMCA.ADC.Conference.Service`) exposes Conference's `ISessionBookmarkValidationService` to Engagement, answering "is this session valid to bookmark?" (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/SessionBookmarksGrpcService.cs:27`) and "give me the session ids for this event" (`SessionBookmarksGrpcService.cs:45`). [`EventLiveValidationGrpcService`](#eventlivevalidationgrpcservice) exposes `IEventLiveValidationService` to Engagement's conference-day live layer, projecting an [`EventLiveInfo`](group-17-conference-domain.md#eventliveinfo) / [`SessionLiveInfo`](group-17-conference-domain.md#sessionliveinfo) onto the wire shape: publish state, live-window bounds converted to Unix seconds, speaker ids stringified, plenum flag, and the moderation default cast to an int (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/EventLiveValidationGrpcService.cs:41-46,65-75`). Each server method is a constructor-injected wrapper over the inner C# service: it null-guards request and context, awaits the inner call, and on a failed `Result` calls `result.ThrowIfFailure()` (`SessionBookmarksGrpcService.cs:39,57`, `EventLiveValidationGrpcService.cs:38,62`) so the [`GrpcResultExceptionInterceptor`](group-13-grpc-contracts.md#grpcresultexceptioninterceptor) (wired by `AddGrpcServiceDefaults()`) can translate the failure into an `RpcException` with structured `error-{i}-*` trailers.

On the **client** side, each contract has a hand-written adapter in `MMCA.ADC.Conference.Contracts` that Engagement uses. [`SessionBookmarkValidationServiceGrpcAdapter`](#sessionbookmarkvalidationservicegrpcadapter) implements the *identical* `ISessionBookmarkValidationService` interface on top of the generated gRPC client (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:24-26`), and [`EventLiveValidationServiceGrpcAdapter`](#eventlivevalidationservicegrpcadapter) does the same for `IEventLiveValidationService` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/EventLiveValidationServiceGrpcAdapter.cs:23-25`), converting the Unix-second live-window fields back into UTC `DateTime`s and the speaker-id strings back into `Guid`s (`EventLiveValidationServiceGrpcAdapter.cs:84-91`). Both pin a **5-second per-call deadline** on every RPC (`SessionBookmarkValidationServiceGrpcAdapter.cs:32,46,79`, `EventLiveValidationServiceGrpcAdapter.cs:30,44,81`), much tighter than the shared resilience pipeline's 30s attempt / 90s total budget, precisely because these calls sit inline in user request paths (bookmark create and list, live-layer poll and question commands) and a *hung* (as opposed to refused) Conference peer must fail fast rather than hold the caller hostage. Both catch `RpcException` and reconstruct `Result.Failure(errors)` from the trailers, falling back to a generic `Error.Failure` coded `Grpc.{StatusCode}` for pure transport faults such as connection reset or deadline exceeded (`SessionBookmarkValidationServiceGrpcAdapter.cs:50-64`, `EventLiveValidationServiceGrpcAdapter.cs:52-66`). The trailer parsing lives once in [`GrpcErrorTrailerParser`](#grpcerrortrailerparser) (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/GrpcErrorTrailerParser.cs:14`), whose `Parse` walks `error-{i}-*` trailers by index until the first missing code and rebuilds each [`Error`](group-01-result-error-handling.md#error) with the correct factory per `ErrorType` (`GrpcErrorTrailerParser.cs:17,25-44,56-68`), so the round-trip logic is shared by both adapters. Because both the in-process implementation and each adapter satisfy the same interface, swapping monolith for microservice is a registration change, not a rewrite (ADR-007; `[Rubric §7, Microservices Readiness]`).

Those registration swaps are performed by the contract package's [`DependencyInjection`](#dependencyinjection) extension, one method per contract: `AddConferenceSessionValidationClient(serviceName = "conference")` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/DependencyInjection.cs:43`) and `AddConferenceEventLiveValidationClient(...)` (`DependencyInjection.cs:73`). Each does exactly two things: registers a typed gRPC client via Common's `AddTypedGrpcClient<TClient>(serviceName)` (`DependencyInjection.cs:45,75`, which resolves `http://conference` through Aspire service discovery and attaches the JWT-forwarding interceptor plus Polly resilience handler), then calls `services.Replace(...)` with a *scoped* descriptor rather than `TryAdd` (`DependencyInjection.cs:49,79`), to overwrite whatever implementation is already in the container (the real in-process service if Conference is co-hosted, or the `Disabled...` stub if not) with the gRPC adapter. The `Replace` is deliberate so the adapter wins in either case; it must be called from the consumer's `Program.cs` *after* `ModuleLoader.DiscoverAndRegister(...)` so the in-process or stub registration is already present for `Replace` to find (`DependencyInjection.cs:36-39`). Note the **bidirectional** Conference-to-Engagement gRPC relationship: Conference *serves* these two contracts and also *consumes* Engagement's [`IBookmarkCountService`](group-22-engagement-module.md#ibookmarkcountservice), so the Conference service host registers `AddEngagementBookmarkCountClient()` and the AppHost deliberately omits a reciprocal startup `WaitFor` to avoid a deadlock; transient "peer not ready" errors self-heal through the resilience pipeline (ADR-007/008; `[Rubric §29, Resilience]`).

## The service host: Kestrel first, and why

The `MMCA.ADC.Conference.Service` `Program.cs` boots only the Conference module (`Modules:Conference:Enabled=true`). Kestrel is configured before anything else, by [`KestrelConfiguration`](#kestrelconfiguration), which was lifted out of `Program.cs` so the top-level file stays inside the S1541 complexity budget (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/KestrelConfiguration.cs:9,27`; called at `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:83`). Its `ConfigureHttp2WithHealthProbe` sets every endpoint default to `HttpProtocols.Http2` (`KestrelConfiguration.cs:33`), that is HTTP/2-only on cleartext (h2c prior knowledge), so cross-service gRPC clients can negotiate HTTP/2 without TLS or ALPN; on a cleartext endpoint `Http1AndHttp2` would effectively disable HTTP/2 and Kestrel would reject gRPC frames with `GOAWAY HTTP_1_1_REQUIRED`. That host-transport choice is ADR-012. The second half of the method is the operational consequence: **only when `HealthProbe:Port` is configured** (injected by `infra/main.bicep`, deliberately absent locally so Aspire's dynamic ports keep working and co-hosted services cannot collide), it re-declares the main h2c listener on 8080 and adds a dedicated **HTTP/1.1-only** listener for the ACA `httpGet` probes (`KestrelConfiguration.cs:35-39`), because the h2c-only endpoint rejects the platform's HTTP/1.1 probe requests. `MapDefaultEndpoints` maps `/health`, `/alive`, and `/health/ready` on every listener, so the probe port serves the real DB-aware health pipeline while staying off the ACA ingress (`KestrelConfiguration.cs:20-24`). The rest of the host is the standard ADC REST composition: CORS, API versioning, rate limiting, response compression, OpenAPI outside Production, exception handlers, RS256 JWT validation via JWKS discovery forwarded through the Gateway, and the shared middleware pipeline (`Program.cs:133-135,198,203,212-214,217,298,305-308`; ADR-004/ADR-019).

## Output caching and warm-up, the two performance extension points

Output caching is where this host carries the most bespoke configuration (`Program.cs:142-188`). The base policy is deny-by-default `NoCache` (`Program.cs:144`), so only explicitly decorated endpoints cache at all. `ConferenceCache` stays on the built-in default semantics because the permission-gated [`SessionSelectionController`](#sessionselectioncontroller) references it, and ADR-040's public policy must never back a permission-gated endpoint since a cached hit is served before MVC's filters run (`Program.cs:146-152`). The seven remaining named policies (`ConferencePublicCache`, `EventsCache`, `SessionsCache`, `SpeakersCache`, `RoomsCache`, `CategoriesCache`, `QuestionsCache`) are registered through `AddPublicEndpointPolicy` at a 5-minute TTL with hierarchical tags (`Program.cs:173-184`), and each one **bypasses the cache entirely for `Organizer` and `ContentEditor` callers** (`Program.cs:172`), for two reasons spelled out in the source (`Program.cs:160-171`): organizer responses include unpublished rows that must never land in a shared public entry, and admin surfaces read back immediately after writing, where a stale cached row version would make the next save throw `DbUpdateConcurrencyException`. `NowNextCache` is the outlier at a 60-second TTL with no bypass, since its payload changes with the clock and is identical for every role (`Program.cs:185-187`). All of this is ADR-040: [`PublicEndpointOutputCachePolicy`](group-12-api-hosting-mapping.md#publicendpointoutputcachepolicy) exists because the UI attaches a Bearer token to every request and the built-in default policy refuses to cache anything carrying `Authorization`, which on conference day meant the cache served none of the real traffic.

The host also contributes the module's error-code translations to the edge localizer by calling `AddErrorResources<ConferenceErrorResources>()` (`Program.cs:236`), so a Conference domain error like `Event.Name.Empty` is rendered in the caller's culture by the shared [`ErrorLocalizer`](group-12-api-hosting-mapping.md#errorlocalizer) (ADR-027). And one more startup extension point matters: [`SelfHttpOutputCacheWarmupTask`](#selfhttpoutputcachewarmuptask), registered via `AddWarmupTask<T>()` (`Program.cs:195`) as an ADR-025 [`IWarmupTask`](group-16-aspire-orchestration.md#iwarmuptask). It waits for `ApplicationStarted` (the warm-up runner starts before Kestrel is listening), resolves the actually-bound cleartext port from `IServerAddressesFeature` with an `ASPNETCORE_URLS` fallback, and replays five hot anonymous reads (paged Events, all Events, paged Sessions, paged Speakers, all Speakers) against the host's own Kestrel endpoint (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/SelfHttpOutputCacheWarmupTask.cs:27-34,84-102`), priming the whole path from envoy through Kestrel, OutputCache, controller, EF Core, and SQL while `/health/ready` stays not-ready. Two details are load-bearing: it short-circuits in the `Testing` environment because `WebApplicationFactory`'s in-memory `TestServer` never opens a real port (`SelfHttpOutputCacheWarmupTask.cs:42-45`), and its `HttpClient` pins `HttpVersion.Version20` with `RequestVersionExact` (`SelfHttpOutputCacheWarmupTask.cs:61-62`) because anything else silently downgrades to HTTP/1.1 and is rejected by the h2c-only endpoint, leaving the cache cold. Failures are logged as a warning and fall back to lazy warm-up on the first real request (`SelfHttpOutputCacheWarmupTask.cs:76-79,104-110`).

## The runtime picture, one host, two transports

After module discovery (`Program.cs:239-244`) the host wires the Engagement gRPC client (`AddEngagementBookmarkCountClient()`, `Program.cs:254`), the broker (`AddBrokerMessaging` registering the `UserRegistered` integration-event consumer that drives the BR-207 email-match speaker auto-link through [`UserRegisteredHandler`](group-18-conference-application.md#userregisteredhandler), `Program.cs:271-272`, falling back to in-process mode when `MessageBus:Provider` is unset so integration tests are unaffected), and `AddGrpcServiceDefaults()` (`Program.cs:283`). It initializes the database before serving traffic (`Program.cs:295`), then publishes **both** gRPC endpoints over the same Kestrel HTTP/2 channel the REST controllers serve: `MapGrpcService<SessionBookmarksGrpcService>()` (`Program.cs:313`) and `MapGrpcService<EventLiveValidationGrpcService>()` (`Program.cs:314`), adding gRPC reflection in Development only (`Program.cs:316-319`).

A browser request to `GET /Sessions` enters the Gateway, is forwarded as HTTP/2 to this host, flows through the shared middleware pipeline, hits an output-cached [`SessionsController`](#sessionscontroller) action that excludes declined sessions for non-organizers, runs the query handler's CQRS pipeline, and returns a `CollectionResult<`[`SessionDTO`](group-17-conference-domain.md#sessiondto)`>`. Meanwhile an Engagement service can simultaneously call `ValidateSessionForBookmark` or `GetSessionLiveInfo` over gRPC against the very same process, and a `UserRegistered` message from Identity can arrive over the broker and auto-link a speaker, all without any of the three paths knowing about the others. That *one module, three ingress paths, identical whether monolith or extracted* property is the whole point of this chapter, and the reason the Conference edge is mostly thin glue over reusable Common machinery: the version-header contract and the two-version `ServiceInfo` surface are the `[Rubric §9, API & Contract Design]` evidence, and the `Replace`-driven client swaps are the `[Rubric §7, Microservices Readiness]` extension point that keeps extraction reversible.

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
  [primer §4](../00-primer.md#4-c-14-preview-features-in-play)); the methods read as instance calls
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
  expression of the service-extraction topology in ADR-007 (gRPC extraction) and ADR-008 (service
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
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:23` · Level 0 · record class

- **What it is**: the JSON body POSTed to `/CategoryItems` to add an item to a category. It carries the
  owning `CategoryId`, an *optional* client-supplied `CategoryItemId`, a display `Name`, and a `Sort`
  order (`CategoryItemsController.cs:23-36`). A [`CategoryItem`](group-17-conference-domain.md#categoryitem)
  is a child of a [`Category`](group-17-conference-domain.md#category), so every write carries the parent
  id alongside the item's own fields.
- **Depends on**: nothing first-party at the type level; its property types are the
  `ConferenceCategoryIdentifierType` and `CategoryItemIdentifierType` global aliases (see
  [identifier aliases](00-primer.md#2-architectural-styles-this-codebase-commits-to)) plus BCL `string`/`int`.
  Consumed by [`CategoryItemsController`](#categoryitemscontroller), which forwards it to
  [`AddCategoryItemCommand`](group-18-conference-application.md#addcategoryitemcommand).
- **Concept introduced, the API request record vs. the application command.** `[Rubric §9, API &
  Contract Design]` assesses DTOs decoupled from domain entities and stable, intentional wire contracts.
  The codebase keeps **three** distinct shapes in every write path: the *request record* (what the HTTP
  client sends), the *command* (the application-layer message), and the *entity* (the domain object). The
  controller's `CreateAsync` does the manual hop (`CategoryItemsController.cs:119-125`): it reads request
  fields and constructs the command positionally. That is the manual-mapping policy of ADR-001 applied at
  the *inbound* edge, no reflective mapper between the wire and the application. `[Rubric §1, SOLID]`
  (interface-segregation): each record exposes exactly the fields its one endpoint needs, so add and
  update never share an over-broad type. The `required` modifier on every non-optional property pushes
  "you must supply this" into model binding, a missing field is a 400 before any handler runs.
- **Walkthrough**: a `record class` (not `sealed`) whose members are all `required … { get; init; }`,
  settable only at construction and immutable after (a recurring choice across these contracts).
  `CategoryItemId` is the single *nullable* member (`CategoryItemsController.cs:29`), letting an
  importer/seed flow pin an explicit id while a normal create leaves it null and lets the domain mint one.
- **Why it's built this way**: a dedicated record per endpoint keeps the OpenAPI schema and binding
  errors named after real domain terms; separating add from update (rather than one
  nullable-everything record) keeps each contract honest about what is mutable.
- **Where it's used**: bound by [`CategoryItemsController`](#categoryitemscontroller)'s `[FromBody]`
  create parameter only.

---

### AddEventQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:26` · Level 0 · record class

- **What it is**: the POST body for answering a feedback question against an event. It names the
  `EventId`, the `QuestionId` being answered, and the `AnswerValue` text
  (`EventQuestionAnswersController.cs:26-36`).
- **Depends on**: id-alias property types (`EventIdentifierType`, `QuestionIdentifierType`) + BCL
  `string`. Consumed by [`EventQuestionAnswersController`](#eventquestionanswerscontroller) →
  [`AddEventQuestionAnswerCommand`](group-18-conference-application.md#addeventquestionanswercommand).
- **Concept, user-owned write data behind authorization.** See the request-vs-command shape under
  [`AddCategoryItemRequest`](#addcategoryitemrequest). What distinguishes the answer records from the
  public-catalog records is the surrounding `[Rubric §11, Security]` story (authorization enforced
  server-side, results scoped per user): the controller sits behind
  [`AuthorizationPolicies`](group-08-auth.md#authorizationpolicies)`.RequireAuthenticated`, and the
  record itself carries **no** `UserId`. The controller never trusts the client for identity, `CreatedBy`
  is stamped from the authenticated principal by the audit pipeline (see
  [soft-delete + audit](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Walkthrough**: three `required { get; init; }` properties, no methods. On add the controller passes
  `null` for the answer's own id: `new AddEventQuestionAnswerCommand(request.EventId, null,
  request.QuestionId, request.AnswerValue)` (`EventQuestionAnswersController.cs:159`), so the domain mints
  the answer id.
- **Why it's built this way**: naming the `QuestionId` on *add* (but not update) encodes that you pick
  which question an answer belongs to once, at creation.
- **Where it's used**: `[FromBody]` on [`EventQuestionAnswersController`](#eventquestionanswerscontroller)'s
  `CreateAsync`.

---

### AddEventSpeakerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventSpeakersController.cs:22` · Level 0 · record class

- **What it is**: the POST body that links a speaker to an event. It carries exactly two ids, `EventId`
  and `SpeakerId` (`EventSpeakersController.cs:22-29`).
- **Depends on**: `EventIdentifierType` / `SpeakerIdentifierType` aliases only. Consumed by
  [`EventSpeakersController`](#eventspeakerscontroller) →
  [`AddEventSpeakerCommand`](group-18-conference-application.md#addeventspeakercommand).
- **Concept introduced, the join-entity write contract.** `[Rubric §4, Domain-Driven Design]` assesses
  whether references *between* aggregates are by id, not object graph. This record is the on-the-wire
  embodiment of that rule: an event-to-speaker association is two ids, never an embedded
  [`Speaker`](group-17-conference-domain.md#speaker). There is no `Update*` sibling, a link either exists
  or does not, so the resource surface is add + delete only. The controller passes a `null` for the join
  entity's own id (`new AddEventSpeakerCommand(request.EventId, null, request.SpeakerId)`,
  `EventSpeakersController.cs:98`) so the domain mints the link id. `[Rubric §9, API & Contract Design]`:
  every property is `required`, so an incomplete association is rejected at binding.
- **Walkthrough**: two `required {Alias} { get; init; }` members and nothing else; the doc comments name
  each role ("the event to add the speaker to", `EventSpeakersController.cs:24`).
- **Why it's built this way**: a dedicated two-field record per relationship (rather than a generic
  `AddAssociationRequest<TParent, TChild>`) keeps the schema and binding errors named after the real
  domain terms, the §9 readability win the codebase prefers over deduplication.
- **Where it's used**: `[FromBody]` on [`EventSpeakersController`](#eventspeakerscontroller)'s
  `CreateAsync`; it is the template the other join records ([`AddSessionSpeakerRequest`](#addsessionspeakerrequest),
  [`AddSessionCategoryItemRequest`](#addsessioncategoryitemrequest),
  [`AddSpeakerCategoryItemRequest`](#addspeakercategoryitemrequest)) repeat.

---

### AddRoomRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:24` · Level 0 · record class

- **What it is**: the richest write record in the group. A [`Room`](group-17-conference-domain.md#room)
  is a child of an [`Event`](group-17-conference-domain.md#event), so the body carries the owning
  `EventId`, an optional explicit `RoomId`, the required `Name`/`Sort`, and four optional physical
  attributes, `Capacity`, `Floor`, `Location`, `AccessibilityInfo` (`RoomsController.cs:24-49`).
- **Depends on**: `EventIdentifierType` / `RoomIdentifierType` aliases + BCL `string?`/`int`/`int?`.
  Consumed by [`RoomsController`](#roomscontroller) →
  [`AddRoomCommand`](group-18-conference-application.md#addroomcommand).
- **Concept**: see the request-vs-command shape under [`AddCategoryItemRequest`](#addcategoryitemrequest);
  this adds nothing structurally, only more optional fields. Worth calling out for `[Rubric §21,
  Accessibility]` (assesses whether accessibility is a first-class concern): `AccessibilityInfo`
  (`RoomsController.cs:48`) is a modeled, persisted room attribute, accessibility data is captured in the
  domain, not bolted on later in the UI.
- **Walkthrough**: three `required` members (`EventId`, `Name`, `Sort`) plus the optional explicit
  `RoomId` (`RoomsController.cs:30`) and four nullable physical fields. `CreateAsync` spreads all eight
  fields positionally into the command (`RoomsController.cs:150-158`).
- **Why it's built this way**: modeling capacity/floor/location/accessibility as discrete optional
  columns (rather than a free-text blob) keeps room metadata queryable and the contract self-documenting.
- **Where it's used**: `[FromBody]` on [`RoomsController`](#roomscontroller)'s `CreateAsync`.

---

### AddSessionCategoryItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionCategoryItemsController.cs:22` · Level 0 · record class

- **What it is**: the POST body that tags a session with a category item, two ids, `SessionId` and
  `CategoryItemId` (`SessionCategoryItemsController.cs:22-29`).
- **Depends on**: `SessionIdentifierType` / `CategoryItemIdentifierType` aliases. Consumed by
  [`SessionCategoryItemsController`](#sessioncategoryitemscontroller) →
  [`AddSessionCategoryItemCommand`](group-18-conference-application.md#addsessioncategoryitemcommand).
- **Concept**: a join-entity write contract, identical in shape to
  [`AddEventSpeakerRequest`](#addeventspeakerrequest) (`[Rubric §4, DDD]`, cross-aggregate references by
  id); add + delete only. The controller passes `null` for the join id
  (`new AddSessionCategoryItemCommand(request.SessionId, null, request.CategoryItemId)`,
  `SessionCategoryItemsController.cs:98`).
- **Walkthrough**: two `required { get; init; }` id properties, no methods.
- **Where it's used**: `[FromBody]` on [`SessionCategoryItemsController`](#sessioncategoryitemscontroller)'s
  `CreateAsync`.

---

### AddSessionQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:26` · Level 0 · record class

- **What it is**: the session-scoped twin of [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest):
  the POST body for answering a feedback question against a session, `SessionId`, `QuestionId`,
  `AnswerValue` (`SessionQuestionAnswersController.cs:26-36`).
- **Depends on**: `SessionIdentifierType` / `QuestionIdentifierType` aliases + BCL `string`. Consumed by
  [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller) →
  [`AddSessionQuestionAnswerCommand`](group-18-conference-application.md#addsessionquestionanswercommand).
- **Concept**: user-owned write data behind authorization, exactly as in
  [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest) (`[Rubric §11, Security]`); the record
  carries no `UserId`, and reads are per-user scoped by BR-9. On add the controller passes `null` for the
  answer id (`SessionQuestionAnswersController.cs:159`).
- **Walkthrough**: three `required { get; init; }` properties, no methods.
- **Where it's used**: `[FromBody]` on [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller)'s
  `CreateAsync`.

---

### AddSessionSpeakerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSpeakersController.cs:23` · Level 0 · record class

- **What it is**: the POST body that links a speaker to a session, `SessionId` + `SpeakerId`
  (`SessionSpeakersController.cs:23-30`).
- **Depends on**: `SessionIdentifierType` / `SpeakerIdentifierType` aliases. Consumed by
  [`SessionSpeakersController`](#sessionspeakerscontroller) →
  [`AddSessionSpeakerCommand`](group-18-conference-application.md#addsessionspeakercommand).
- **Concept**: a join-entity write contract like [`AddEventSpeakerRequest`](#addeventspeakerrequest)
  (`[Rubric §4, DDD]`); add + delete only. The controller passes `null` for the join id
  (`new AddSessionSpeakerCommand(request.SessionId, null, request.SpeakerId)`,
  `SessionSpeakersController.cs:100`). `[Rubric §12, Performance & Scalability]`: unlike the other join
  records, a successful session-speaker add evicts the `conference:sessions` and `conference`
  output-cache tags (`SessionSpeakersController.cs:110,137-141`), because speaker assignment changes the
  cached session reads the speaker dashboard depends on.
- **Walkthrough**: two `required { get; init; }` id properties, no methods.
- **Where it's used**: `[FromBody]` on [`SessionSpeakersController`](#sessionspeakerscontroller)'s
  `CreateAsync`.

---

### AddSpeakerCategoryItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakerCategoryItemsController.cs:22` · Level 0 · record class

- **What it is**: the POST body that tags a speaker with a category item, `SpeakerId` +
  `CategoryItemId` (`SpeakerCategoryItemsController.cs:22-29`).
- **Depends on**: `SpeakerIdentifierType` / `CategoryItemIdentifierType` aliases. Consumed by
  [`SpeakerCategoryItemsController`](#speakercategoryitemscontroller) →
  [`AddSpeakerCategoryItemCommand`](group-18-conference-application.md#addspeakercategoryitemcommand).
- **Concept**: a join-entity write contract like [`AddEventSpeakerRequest`](#addeventspeakerrequest)
  (`[Rubric §4, DDD]`); add + delete only. Notable domain modeling: ADC represents *speaker locality*
  (and similar traits) as a category-item tag rather than a field on
  [`Speaker`](group-17-conference-domain.md#speaker), so a request like this is how that attribute is
  attached. The controller passes `null` for the join id
  (`SpeakerCategoryItemsController.cs:98`).
- **Walkthrough**: two `required { get; init; }` id properties, no methods.
- **Where it's used**: `[FromBody]` on [`SpeakerCategoryItemsController`](#speakercategoryitemscontroller)'s
  `CreateAsync`.

---

### UpdateCategoryItemRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:39` · Level 0 · record class

- **What it is**: the PUT body for editing an existing category item. It is
  [`AddCategoryItemRequest`](#addcategoryitemrequest) minus `CategoryItemId`: the owning `CategoryId`,
  the new `Name`, and the new `Sort` (`CategoryItemsController.cs:39-49`).
- **Depends on**: the same id-aliases + BCL `string`/`int`. Consumed by
  [`CategoryItemsController`](#categoryitemscontroller) →
  [`UpdateCategoryItemCommand`](group-18-conference-application.md#updatecategoryitemcommand).
- **Concept**: the update half of the request-vs-command shape (see
  [`AddCategoryItemRequest`](#addcategoryitemrequest)). The item id to update is not in the body, it is the
  route's `{id}`; `UpdateAsync` threads the route id into the command
  (`new UpdateCategoryItemCommand(request.CategoryId, id, request.Name, request.Sort)`,
  `CategoryItemsController.cs:143-147`).
- **Walkthrough**: three `required { get; init; }` properties. `CategoryId` is carried on update so the
  handler can re-check ownership of the parent before mutating.
- **Where it's used**: `[FromBody]` on [`CategoryItemsController`](#categoryitemscontroller)'s
  `UpdateAsync`.

---

### UpdateEventQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:39` · Level 0 · record class

- **What it is**: the PUT body for editing an event answer. It carries the owning `EventId` and the new
  `AnswerValue`, and deliberately drops `QuestionId` (`EventQuestionAnswersController.cs:39-46`).
- **Depends on**: `EventIdentifierType` alias + BCL `string`. Consumed by
  [`EventQuestionAnswersController`](#eventquestionanswerscontroller) →
  [`UpdateEventQuestionAnswerCommand`](group-18-conference-application.md#updateeventquestionanswercommand).
- **Concept**: the update half of the answer contract (see
  [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest)). Omitting `QuestionId` encodes an
  invariant: you can re-word an answer but not re-point it at a different question (that would be a
  delete-and-re-add). `UpdateAsync` uses the route `{id}` as the answer id
  (`new UpdateEventQuestionAnswerCommand(request.EventId, id, request.AnswerValue)`,
  `EventQuestionAnswersController.cs:178`).
- **Walkthrough**: two `required { get; init; }` properties, no methods.
- **Where it's used**: `[FromBody]` on [`EventQuestionAnswersController`](#eventquestionanswerscontroller)'s
  `UpdateAsync`.

---

### UpdateRoomRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:52` · Level 0 · record class

- **What it is**: the PUT body for editing a room. It is [`AddRoomRequest`](#addroomrequest) minus the
  explicit `RoomId`: the owning `EventId`, required `Name`/`Sort`, and the four optional physical
  attributes (`RoomsController.cs:52-74`).
- **Depends on**: `EventIdentifierType` alias + BCL `string?`/`int`/`int?`. Consumed by
  [`RoomsController`](#roomscontroller) →
  [`UpdateRoomCommand`](group-18-conference-application.md#updateroomcommand).
- **Concept**: the update half of the room contract (see [`AddRoomRequest`](#addroomrequest)); the room
  id comes from the route `{id}`. `UpdateAsync` spreads the fields plus the route id into the command
  (`RoomsController.cs:179-187`).
- **Walkthrough**: three `required` members plus four nullable optionals, no methods.
- **Where it's used**: `[FromBody]` on [`RoomsController`](#roomscontroller)'s `UpdateAsync`.

---

### UpdateSessionQuestionAnswerRequest
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:39` · Level 0 · record class

- **What it is**: the session-scoped twin of
  [`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest): the PUT body carrying the
  owning `SessionId` and the new `AnswerValue`, dropping `QuestionId`
  (`SessionQuestionAnswersController.cs:39-46`).
- **Depends on**: `SessionIdentifierType` alias + BCL `string`. Consumed by
  [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller) →
  [`UpdateSessionQuestionAnswerCommand`](group-18-conference-application.md#updatesessionquestionanswercommand).
- **Concept**: identical to [`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest); the
  answer id is the route `{id}` (`SessionQuestionAnswersController.cs:178`).
- **Walkthrough**: two `required { get; init; }` properties, no methods.
- **Where it's used**: `[FromBody]` on [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller)'s
  `UpdateAsync`.

---

### ServiceInfoController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:20` · Level 2 · class (sealed)

- **What it is**: an anonymous, read-only service/version-discovery controller whose single
  `/ServiceInfo` route is served by **two** API versions, selected via the `api-version` header. The ADC
  file is now almost empty: it is a thin sealed subclass of the shared
  [`ServiceInfoControllerBase`](group-12-api-hosting-mapping.md#serviceinfocontrollerbase) that overrides
  one member, `ServiceName => "Conference"` (`ServiceInfoController.cs:23`). All of the version-discovery
  behavior lives in the base.
- **Depends on**: [`ServiceInfoControllerBase`](group-12-api-hosting-mapping.md#serviceinfocontrollerbase)
  (MMCA.Common.API, Level 1); `Asp.Versioning` (`[ApiVersion]`); `Microsoft.AspNetCore.Authorization`
  (`[AllowAnonymous]`). It does **not** declare the two discovery actions (`GetV1`/`GetV2`) or the two
  response payloads ([`ServiceInfoResponse`](group-12-api-hosting-mapping.md#serviceinforesponse) /
  [`ServiceInfoV2Response`](group-12-api-hosting-mapping.md#serviceinfov2response)), those are inherited
  from the base and taught in [G12](group-12-api-hosting-mapping.md).
- **Concept, multi-version routing declared on the leaf subclass.** `[Rubric §9, API & Contract Design]`
  assesses a real versioning strategy rather than a single frozen version. Two `[ApiVersion]` attributes
  on this class declare the route's versions, `1.0` with `Deprecated = true` and `2.0`
  (`ServiceInfoController.cs:18-19`); the base's `[MapToApiVersion]`-tagged `GetV1()`/`GetV2()` actions
  then serve the minimal vs. evolved shape for each. Because `AddCommonApiVersioning` (MMCA.Common.API)
  sets `ReportApiVersions = true`, responses also carry `api-supported-versions` /
  `api-deprecated-versions` headers, so clients discover the lifecycle without reading docs. This is the
  only Conference controller that serves more than one version, the rest are all `[ApiVersion("1.0")]`.
  `[Rubric §1, SOLID]` / `[Rubric §16, Maintainability]`: the discovery *behavior* is written once in the
  Common base and every service's subclass supplies only its name plus the class-level attributes, which
  the base's own remarks note are not reliably inherited and so must be repeated on the leaf
  (`ServiceInfoControllerBase.cs:15-29`).
- **Walkthrough**
  - The four class-level attributes at `ServiceInfoController.cs:15-19` (`[ApiController]`,
    `[Route("[controller]")]`, `[AllowAnonymous]`, `[ApiVersion("1.0", Deprecated = true)]`,
    `[ApiVersion("2.0")]`) supply routing and versioning to the leaf because attribute inheritance is not
    reliable here.
  - The entire body is one expression-bodied override: `protected override string ServiceName =>
    "Conference"` (`ServiceInfoController.cs:23`). The advertised supported/deprecated version lists
    (`["1.0", "2.0"]` and `["1.0"]`) live on the base (`ServiceInfoControllerBase.cs:32-33`), so this
    class never restates them.
- **Why it's built this way**: hoisting the discovery actions and payloads into a shared base and giving
  each service a one-line subclass keeps every service's `/ServiceInfo` identical and the versioning
  feature exercised and testable, a contract-snapshot test against `/openapi/v1.json` can confirm both
  versions are present, so the capability cannot silently rot. It stays anonymous and side-effect-free.
- **Where it's used**: mounted by the Conference service's controller registration; reached directly on
  the service host, not via the Gateway (which does not route `/ServiceInfo`). Primarily a target for the
  integration-tier versioning/contract tests rather than the UI.
- **Caveats / not-in-source**: the `ReportApiVersions = true` / header behavior is configured in
  `AddCommonApiVersioning` (MMCA.Common.API, a different group); this controller only declares the two
  versions and its service name.

---

### SessionSelectionController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSelectionController.cs:30` · Level 4 · class (sealed partial)

- **What it is**: a **decision-support** controller for choosing which submitted sessions to accept,
  gated class-level by
  [`[HasPermission(ConferencePermissions.SessionSelectionManage)]`](group-08-auth.md#haspermissionattribute)
  (`SessionSelectionController.cs:29`), a capability the content-curation subset deliberately excludes
  (verified: `SessionSelectionManage` is in
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions)`.All` but absent from its
  `ContentManagement` subset, so a content-editor role granted `ContentManagement` cannot reach it,
  `ConferencePermissions.cs:30,41,49-54`; the concrete role-to-permission grants live in the module's
  registration, not in this file). It exposes four read endpoints
  (composite dashboard, category distribution, speaker overlap, content similarity) plus one
  fire-and-forget endpoint that triggers AI scoring of an event's sessions in the background.
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (Level 3, for
  the `HandleFailure` Result-to-Problem-Details mapping); the
  [`HasPermission`](group-08-auth.md#haspermissionattribute) attribute +
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) catalog; four
  [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  injections plus a scoped
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  resolved at runtime; [`Result`](group-01-result-error-handling.md#result); the decision-support DTOs
  ([`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto),
  [`CategoryDistributionDTO`](group-17-conference-domain.md#categorydistributiondto),
  [`SpeakerSessionOverlapDTO`](group-17-conference-domain.md#speakersessionoverlapdto),
  [`ContentSimilarityDTO`](group-17-conference-domain.md#contentsimilaritydto)); BCL
  `IServiceScopeFactory`, `IOutputCacheStore`, `ILogger`.
- **Concept, background work from a controller + scope management.** `[Rubric §9, API & Contract Design]`
  (a focused, capability-scoped surface). The `ScoreSessionsAsync` endpoint
  (`SessionSelectionController.cs:103`) is fire-and-forget: `_ = RunScoringInBackgroundAsync(eventId)`
  then `return Accepted()` (202) immediately, because scoring can take minutes.
  `RunScoringInBackgroundAsync` (`SessionSelectionController.cs:111`) creates a **new DI scope** via
  `IServiceScopeFactory.CreateAsyncScope()` (`:119`), essential, because the request scope (and its
  scoped `ICommandHandler`/`DbContext`) is disposed the moment the HTTP response returns, so the
  background task must own its own scope. It then resolves
  [`ICommandHandler<ScoreEventSessionsCommand, …>`](group-18-conference-application.md#scoreeventsessionscommand)
  from that scope and runs it. `[Rubric §13, Observability & Operability]` (structured,
  source-generated logging): the class is `partial` and declares two `[LoggerMessage]` methods
  (`SessionSelectionController.cs:141-145`) for the background completion/failure paths, compile-time
  generated, allocation-light log calls. `[Rubric §12, Performance & Scalability]`: the four read
  endpoints use `[OutputCache(PolicyName = "ConferenceCache")]`, and the scoring path evicts the
  `conference` cache tag both *before* scoring (so polls see cleared scores) and *after* success
  (`SessionSelectionController.cs:116,128`).
- **Walkthrough**
  - Primary-constructor injection of the four query handlers + scope factory + cache store + logger
    (`SessionSelectionController.cs:30-37`); base is
    [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (`:38`).
  - Each read action follows the same shape, dispatch the query, then
    `result.IsFailure ? HandleFailure(result.Errors) : Ok(result.Value)`, `GetDashboardAsync` (`:43`),
    `GetCategoryDistributionAsync` (`:57`), `GetSpeakerOverlapAsync` (`:71`), `GetContentSimilarityAsync`
    (`:85`, which takes a `minimumSimilarity = 0.3` threshold query parameter, `:87`).
  - `ScoreSessionsAsync` (`:103`) returns `Accepted()` synchronously; the real work is the private
    `RunScoringInBackgroundAsync` (`:111`), wrapped in a try/catch that logs failure via the generated
    `LogScoringBackgroundFailed` (`:132,137`).
- **Why it's built this way**: long-running AI scoring must not block an HTTP request, so the 202 +
  background-scope pattern is the standard ASP.NET Core approach; the explicit cache-eviction bracketing
  keeps the cached dashboard consistent with scoring state. The `partial` + `[LoggerMessage]` choice is
  the codebase's house style for hot/structured logging.
- **Where it's used**: mounted by the Conference service's controller registration; consumed by the
  organizer session-selection UI page. The AI scoring itself is performed by the
  [`ScoreEventSessionsCommand`](group-18-conference-application.md#scoreeventsessionscommand) handler
  (Conference Application group).
- **Caveats / not-in-source**: the fire-and-forget `_ = RunScoringInBackgroundAsync(...)` is detached
  from the request lifetime; it intentionally uses `CancellationToken.None` for its cache evictions
  (`SessionSelectionController.cs:116,128`) so a returned request cannot cancel an in-flight scoring run.
  Durability of the scoring job across a host restart is not guaranteed by this controller (it is
  in-process background work, not a queued/outbox job), so its resilience is not determinable from this
  source alone.

---

### CategoryItemsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:60` · Level 7 · class (sealed)

- **What it is**: the REST controller for conference category items. Reads are public (anonymous per
  BR-43); writes (add, update, remove) require organizer authorization
  (`[HasPermission(ConferencePermissions.CategoriesManage)]`, `CategoryItemsController.cs:59`). A
  [`CategoryItem`](group-17-conference-domain.md#categoryitem) is a child of a
  [`Category`](group-17-conference-domain.md#category), exposed at a top-level route for convenient
  querying.
- **Depends on**:
  [`EntityControllerBase<CategoryItem, CategoryItemDTO, CategoryItemIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (the read-only Common base it extends); the
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  for reads; three
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  injections (add/update/remove); the [`HasPermission`](group-08-auth.md#haspermissionattribute) attribute
  + [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions); its two request
  records [`AddCategoryItemRequest`](#addcategoryitemrequest) /
  [`UpdateCategoryItemRequest`](#updatecategoryitemrequest); the read result types
  [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
  [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype); the
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder); BCL `ILogger`.
- **Concept introduced, the child-entity controller over the read-only base.** `[Rubric §9, API &
  Contract Design]`, `[Rubric §5, Vertical Slice]`, `[Rubric §6, CQRS & Event-Driven]`. A *child* of an
  aggregate cannot use the generic aggregate-root create/delete (those cannot supply the child's parent
  id), so this class derives from the **read-only**
  [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype),
  which already supplies `GET`, `GET /paged`, `GET /lookup`, and `GET /{id}`, then hand-writes its own
  `POST`/`PUT`/`DELETE` whose commands carry the owning `CategoryId`. Each read is `override`n only to add
  `[AllowAnonymous]` and delegate straight to the base (`=> base.GetAllAsync(...)`); each write action
  maps its request record onto exactly one command and folds any `Result.Failure` through the inherited
  `HandleFailure`, the one-handler-per-action shape of CQRS at the edge. `[Rubric §1, SOLID]` /
  `[Rubric §16, Maintainability]`: because the read machinery is written once in Common, the concrete
  controller is small and has almost no reason to change.
- **Walkthrough**
  - Primary-constructor injection (`CategoryItemsController.cs:60-65`): the query service, the three
    command handlers (`AddCategoryItemCommand → Result<CategoryItemDTO>`, `UpdateCategoryItemCommand →
    Result`, `RemoveCategoryItemCommand → Result`), and the logger; the base call passes the query
    service + logger to `EntityControllerBase` (`:66`).
  - The four read overrides (`:68-111`) each add `[AllowAnonymous]` (opening the class-level permission
    gate for reads) and forward to the base: `GetAllAsync` (`:70`), the paged `GetAllAsync` with the
    `[ModelBinder(typeof(QueryFilterModelBinder))]` filter dictionary (`:79-89`), `GetAllForLookupAsync`
    (`:93`), and `GetByIdAsync` under the named route `"GetCategoryItemById"` (`:98`).
  - `CreateAsync` (`:115`): `[HttpPost]`, binds `[FromBody] AddCategoryItemRequest`, dispatches
    `new AddCategoryItemCommand(request.CategoryId, request.CategoryItemId, request.Name, request.Sort)`
    (`:119-125`); on success returns `CreatedAtRoute("GetCategoryItemById", new { id = result.Value!.Id },
    result.Value)` (`:129-132`), otherwise `HandleFailure`.
  - `UpdateAsync` (`:137`): `[HttpPut("{id}")]`, binds the route `id` and `[FromBody]
    UpdateCategoryItemRequest`, dispatches `new UpdateCategoryItemCommand(request.CategoryId, id,
    request.Name, request.Sort)` (`:143-147`); `NoContent()` on success.
  - `DeleteAsync` (`:157`): `[HttpDelete("{id}")]`, binds the route `id` and `[FromQuery]
    ConferenceCategoryIdentifierType categoryId`, dispatches
    `new RemoveCategoryItemCommand(categoryId, id)` (`:163`); `NoContent()` on success. The parent
    `categoryId` is taken from the query string because a child delete needs its parent for
    ownership re-validation in the handler.
- **Why it's built this way**: the split between an aggregate-root base (create/delete built in) and this
  read-only base (writes hand-written) is exactly the "child commands carry a `parentId` the generic base
  cannot model" distinction the group overview draws. Reads are anonymous because the catalog is public
  (BR-43); writes are capability-gated (BR-41) at the class level.
- **Where it's used**: mounted by the Conference service's controller registration and consumed by the
  organizer category-management UI. It is the archetype for the group's other child/join controllers
  ([`RoomsController`](#roomscontroller), [`EventSpeakersController`](#eventspeakerscontroller),
  [`SessionSpeakersController`](#sessionspeakerscontroller),
  [`SessionCategoryItemsController`](#sessioncategoryitemscontroller),
  [`SpeakerCategoryItemsController`](#speakercategoryitemscontroller)), which repeat this shape with
  different entities and permissions.

---

### EventQuestionAnswersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:56` · Level 7 · class (sealed)

- **What it is**: the REST controller for event feedback answers. Unlike the public-catalog controllers,
  **both** reads and writes require authentication
  (`[Authorize(Policy = AuthorizationPolicies.RequireAuthenticated)]`,
  `EventQuestionAnswersController.cs:55`), and the reads are **user-scoped** by BR-8: organizers see all
  answers, attendees see only their own.
- **Depends on**:
  [`EntityControllerBase<EventQuestionAnswer, EventQuestionAnswerDTO, EventQuestionAnswerIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype);
  the [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype);
  three [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  injections; [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) and
  [`RoleNames`](group-08-auth.md#rolenames) for the scoping decision;
  [`OwnEventQuestionAnswerSpecification`](group-18-conference-application.md#owneventquestionanswerspecification)
  (the filter it builds); [`AuthorizationPolicies`](group-08-auth.md#authorizationpolicies); its request
  records [`AddEventQuestionAnswerRequest`](#addeventquestionanswerrequest) /
  [`UpdateEventQuestionAnswerRequest`](#updateeventquestionanswerrequest); BCL `ILogger`.
- **Concept introduced, per-user read scoping via a specification.** `[Rubric §11, Security]` assesses
  authorization enforced server-side with per-user result scoping. The private
  `GetUserScopingSpecification()` (`EventQuestionAnswersController.cs:66-67`) returns `null` when
  `currentUserService.IsInRole(RoleNames.Organizer)` (no filter, sees all), otherwise a
  `new OwnEventQuestionAnswerSpecification(currentUserService.UserId!.Value)`. That specification is
  passed into `QueryService.GetAllAsync`/`GetByIdAsync`, so the *database query itself* excludes other
  users' rows, the scoping happens in SQL and paging stays correct, rather than filtering a fetched page
  in memory. This is why the reads here fully `override` the base method (threading the specification,
  `asTracking: false`, and a `MaxPageSize` cap) instead of delegating with `=> base.…` the way the public
  controllers do. The write records carry no `UserId`; identity comes from the authenticated principal and
  `CreatedBy` is stamped by the audit pipeline, never trusted from the client.
- **Walkthrough**
  - Primary-constructor injection (`EventQuestionAnswersController.cs:56-62`): the query service, three
    command handlers, `ICurrentUserService`, and the logger.
  - `GetUserScopingSpecification()` (`:66-67`): the organizer-or-own branch described above.
  - `GetAllAsync` (`:70`): fully overridden, calls `QueryService.GetAllAsync(specification:
    GetUserScopingSpecification(), pageSize: MaxPageSize, asTracking: false, …)` (`:77-85`) and returns
    `Ok(result.Value)` or `HandleFailure`.
  - The paged `GetAllAsync` (`:91`): caps `pageSize = Math.Min(pageSize, MaxPageSize)` (`:102`), threads
    the same specification, and appends the `X-Pagination` header from the result's pagination metadata
    (`:121`).
  - `GetAllForLookupAsync` (`:126`) delegates straight to the base; `GetByIdAsync` (`:132`) threads the
    specification (`:140-147`) so an attendee cannot fetch another user's answer by id.
  - `CreateAsync` (`:154`): dispatches `new AddEventQuestionAnswerCommand(request.EventId, null,
    request.QuestionId, request.AnswerValue)` (`:159`); `CreatedAtRoute("GetEventQuestionAnswerById", …)`.
  - `UpdateAsync` (`:172`): dispatches `new UpdateEventQuestionAnswerCommand(request.EventId, id,
    request.AnswerValue)` (`:178`); `NoContent()`.
  - `DeleteAsync` (`:188`): dispatches `new RemoveEventQuestionAnswerCommand(eventId, id)` with `eventId`
    taken `[FromQuery]` (`:193`); `NoContent()`.
- **Why it's built this way**: BR-8 mandates that attendees see only their own answers, so the controller
  injects an ownership specification into the query pipeline rather than filtering after the fact, keeping
  the predicate in SQL and paging honest. Organizers bypass the filter through the null-spec branch. The
  parent `EventId` is carried on write and delete so the handler can re-check parent ownership before
  mutating.
- **Where it's used**: mounted by the Conference service's controller registration; consumed by the
  attendee feedback UI. [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller) is its
  exact session-scoped sibling (BR-9), built the same way over
  [`OwnSessionQuestionAnswerSpecification`](group-18-conference-application.md#ownsessionquestionanswerspecification).

### EventSpeakersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventSpeakersController.cs:39` · Level 7 · class (sealed)

- **What it is**: the REST controller for the many-to-many link between an event and a speaker
  (`/EventSpeakers`). It exposes anonymous read endpoints and organizer-only add/remove endpoints. Because
  an [`EventSpeaker`](group-17-conference-domain.md#eventspeaker) is a *child* of the
  [`Event`](group-17-conference-domain.md#event) aggregate, this controller reads the child directly but
  mutates it only through the parent aggregate's commands.
- **Depends on**: [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (the read-only base, `EventSpeakersController.cs:44`), [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  for reads, two [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s
  (`AddEventSpeakerCommand` / `RemoveEventSpeakerCommand`, `EventSpeakersController.cs:41-42`), the
  [`EventSpeakerDTO`](group-17-conference-domain.md#eventspeakerdto), the
  [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) + the
  [`ConferencePermissions`](group-17-conference-domain.md#conferencepermissions) catalog. Externals: ASP.NET
  Core MVC (`[ApiController]`, `[HttpGet]`, `[AllowAnonymous]`), `Asp.Versioning`, and the local
  `AddEventSpeakerRequest` record declared just above the class (`EventSpeakersController.cs:22-29`).
- **Concept introduced, the child-collection controller.** `[Rubric §4, Domain-Driven Design]` assesses
  whether aggregate boundaries are respected: you never POST straight at a child row. This is the first of
  several controllers in this group built on that rule, so the shape is worth learning here. The controller
  derives from [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (which supplies only `GetAll`/`GetById`/`GetAllForLookup`, no create or delete), and hand-rolls its
  mutations: `CreateAsync` (`EventSpeakersController.cs:92-107`) accepts an `AddEventSpeakerRequest` and
  dispatches `AddEventSpeakerCommand(request.EventId, null, request.SpeakerId)`, whose handler loads the
  `Event` aggregate and adds the child through a domain method. The `null` middle argument is the child id,
  left for the domain to mint. `[Rubric §11, Security]` (authN/authZ correctness): the class carries
  `[HasPermission(ConferencePermissions.EventsManage)]` (`EventSpeakersController.cs:38`) so writes require
  the organizer permission (BR-41), while every read overrides that with `[AllowAnonymous]` (BR-43).
  `[Rubric §9, API & Contract Design]`: the contract surface is declarative, `[ApiController]`,
  `[ApiVersion("1.0")]`, `[Route("[controller]")]`, and per-action `[Http*]` attributes name the whole REST
  shape without imperative wiring.
- **Walkthrough**: the four read actions (`EventSpeakersController.cs:46-89`) are pure `override`s that
  re-decorate the base action with `[HttpGet]` + `[AllowAnonymous]` and forward to `base.GetAllAsync(...)` /
  `base.GetByIdAsync(...)`; they return [`CollectionResult<EventSpeakerDTO>`](group-01-result-error-handling.md#collectionresultt),
  [`PagedCollectionResult<EventSpeakerDTO>`](group-01-result-error-handling.md#pagedcollectionresultt), a
  [`BaseLookup`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) list, and a single DTO. The
  paged overload binds its `filters` through the
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder). `CreateAsync` returns
  `HandleFailure(result.Errors)` on failure or `CreatedAtRoute("GetEventSpeakerById", ...)` on success;
  `DeleteAsync` (`EventSpeakersController.cs:110-123`) reads the parent `eventId` from the query string
  (the route only carries the child id), dispatches `RemoveEventSpeakerCommand(eventId, id)`, and returns
  `NoContent()`. Error-to-HTTP translation is inherited from
  [`ApiControllerBase.HandleFailure`](group-12-api-hosting-mapping.md#apicontrollerbase).
- **Why it's built this way**: a child has no independent lifecycle, so it earns free read endpoints but
  explicit, aggregate-routed mutations. Keeping the wire contract (`AddEventSpeakerRequest`) co-located
  with the action keeps the endpoint honest about exactly the two ids it needs.
- **Where it's used**: hosted by `MMCA.ADC.Conference.Service` and reached through the YARP Gateway
  (ADR-008); the Blazor speaker-assignment screens are the primary client.

---

### RoomsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:85` · Level 7 · class (sealed)

- **What it is**: the REST controller for conference [`Room`](group-17-conference-domain.md#room)s
  (`/Rooms`). Rooms are child entities of an [`Event`](group-17-conference-domain.md#event) but are exposed
  at a top-level route for convenient querying (`RoomsController.cs:76-80`). It is a child-collection
  controller like [`EventSpeakersController`](#eventspeakerscontroller), but with a fuller add / update /
  remove surface and output caching.
- **Depends on**: [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  three [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s (`AddRoomCommand`
  / `UpdateRoomCommand` / `RemoveRoomCommand`, `RoomsController.cs:87-89`), the
  [`RoomDTO`](group-17-conference-domain.md#roomdto), and ASP.NET Core's `IOutputCacheStore`. Two local
  request records, `AddRoomRequest` and `UpdateRoomRequest` (`RoomsController.cs:24-74`), carry the room's
  name, sort, and optional capacity/floor/location/accessibility fields.
- **Concept introduced, output-cache eviction on mutation.** `[Rubric §12, Performance & Scalability]`
  assesses caching strategy: every read here is decorated `[OutputCache(PolicyName = "RoomsCache")]`
  (`RoomsController.cs:96, 106, 121, 129`), so anonymous room reads are served from the cache with the
  Conference 5-minute TTL. The correctness half is eviction: each mutation ends by calling
  `EvictRoomsCacheAsync` (`RoomsController.cs:215-216`), which does
  `outputCacheStore.EvictByTagAsync("conference:rooms", ...)`, invalidating exactly the room reads and
  nothing else. `[Rubric §3, Clean Architecture]`: this eviction lives in the controller, not the command
  handler, because `IOutputCacheStore` is an ASP.NET concern the Application layer must not reference.
- **Walkthrough**: the four reads mirror the child-collection shape (see
  [`EventSpeakersController`](#eventspeakerscontroller)) plus the cache decoration. `CreateAsync`
  (`RoomsController.cs:145-169`) maps `AddRoomRequest` to `AddRoomCommand` positionally, evicts on success,
  and returns `CreatedAtRoute("GetRoomById", ...)`. `UpdateAsync` (`RoomsController.cs:173-195`) dispatches
  `UpdateRoomCommand`, evicts, and returns `NoContent()`; `DeleteAsync` (`RoomsController.cs:199-213`)
  reads the parent `eventId` from the query string, dispatches `RemoveRoomCommand(eventId, id)`, evicts,
  and returns `NoContent()`. Note the ordering guard: each mutation returns `HandleFailure` *before* it
  evicts, so a failed command never disturbs the cache.
- **Why it's built this way**: rooms are read far more than they are edited (venue maps, schedule grids),
  so caching the public reads is worth the eviction bookkeeping on the rare write. The add / update /
  remove trio (richer than the two-verb link controllers) reflects that a room has real editable content,
  not just an association.
- **Where it's used**: the Conference service host; consumed by the room-management UI and by any schedule
  view that resolves a session's room.

---

### SpeakerCategoryItemsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakerCategoryItemsController.cs:39` · Level 7 · class (sealed)

- **What it is**: the REST controller for the link between a [`Speaker`](group-17-conference-domain.md#speaker)
  and a category item (`/SpeakerCategoryItems`), the association that tags a speaker with, for example, a
  locality or a track. Structurally it is a twin of
  [`EventSpeakersController`](#eventspeakerscontroller): anonymous reads, organizer add/remove, no update,
  no caching.
- **Depends on**: [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  the `AddSpeakerCategoryItemCommand` / `RemoveSpeakerCategoryItemCommand`
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s
  (`SpeakerCategoryItemsController.cs:41-42`), the
  [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto), and the local
  `AddSpeakerCategoryItemRequest` record (`SpeakerCategoryItemsController.cs:22-29`).
- **Concept introduced**: none new; this is the child-collection controller pattern taught at
  [`EventSpeakersController`](#eventspeakerscontroller). The one difference worth noting is the permission
  gate: because the association hangs off a speaker, the class is guarded by
  `[HasPermission(ConferencePermissions.SpeakersManage)]` (`SpeakerCategoryItemsController.cs:38`) rather
  than the `EventsManage` permission its event-side twin uses. `[Rubric §11, Security]`: the permission
  vocabulary tracks the *owning* aggregate, so managing a speaker's tags requires speaker-management rights.
- **Walkthrough**: identical to [`EventSpeakersController`](#eventspeakerscontroller): four `[AllowAnonymous]`
  read overrides forwarding to the base (`SpeakerCategoryItemsController.cs:46-89`); `CreateAsync`
  (`:92-107`) dispatches `AddSpeakerCategoryItemCommand(request.SpeakerId, null, request.CategoryItemId)`
  and returns `CreatedAtRoute("GetSpeakerCategoryItemById", ...)`; `DeleteAsync` (`:110-123`) reads the
  parent `speakerId` from the query string, dispatches `RemoveSpeakerCategoryItemCommand(speakerId, id)`,
  and returns `NoContent()`.
- **Why it's built this way**: it shares the exact shape of the other link controllers because the
  underlying rule (mutate the child only through its parent aggregate) is identical; only the aggregate,
  DTO, and permission change.
- **Where it's used**: the Conference service host; consumed by the speaker-profile editing UI.

---

### ConferenceCategoriesController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ConferenceCategoriesController.cs:32` · Level 8 · class (sealed)

- **What it is**: the REST controller for the [`Category`](group-17-conference-domain.md#category)
  aggregate root, served at the custom route `conferencecategories` (`ConferenceCategoriesController.cs:29`)
  to avoid colliding with another module's `categories` route. Anonymous reads, organizer create / update /
  delete. This is the first *aggregate-root* controller in the group, so it establishes the shape the other
  four full-CRUD controllers reuse.
- **Depends on**: [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  (the CRUD base, `ConferenceCategoriesController.cs:39-40`),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  a create handler keyed on `ConferenceCategoryCreateRequest`, an update handler
  (`UpdateConferenceCategoryCommand`), a delete handler keyed on
  [`DeleteEntityCommand<Category, ...>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype),
  ASP.NET Core's `IOutputCacheStore`, and the
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto).
- **Concept introduced, the aggregate-root controller.** `[Rubric §9, API & Contract Design]` assesses
  consistent resource CRUD: an aggregate root gets a full, uniform REST surface, and
  [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
  supplies `GetAll`/`GetById`/`GetAllForLookup`/`Create`/`Delete` from its constructor slots (query
  service, create handler, delete handler). The subclass then only writes policy, cache eviction, and any
  extra actions. Here the create request type *is* the command: `ConferenceCategoryCreateRequest` is passed
  straight into the create handler's [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  slot (`ConferenceCategoriesController.cs:34`), the create-from-request shape used across the Conference
  aggregate roots. `[Rubric §12, Performance & Scalability]`: reads carry
  `[OutputCache(PolicyName = "CategoriesCache")]` and every mutation calls `EvictCategoriesCacheAsync`
  (`ConferenceCategoriesController.cs:131-132`), evicting the `conference:categories` tag.
- **Walkthrough**: the reads (`ConferenceCategoriesController.cs:42-89`) forward to the base with the cache
  policy attached. `CreateAsync` (`:92-100`) and `DeleteAsync` (`:120-129`) are thin `override`s that call
  `base.CreateAsync` / `base.DeleteAsync` and then evict, so the base does the CQRS dispatch and the
  override adds only the cache concern. `UpdateAsync` (`:103-118`) is the one hand-rolled action (the base
  has no update): it wraps the body in `UpdateConferenceCategoryCommand(id, request)`, dispatches, evicts,
  and returns `Ok(result.Value)`.
- **Why it's built this way**: the base carries the boilerplate CRUD so a controller author writes only
  what is specific, the route override, the update action, and cache eviction. The custom route string is
  the deliberate escape hatch from ASP.NET's `[controller]` convention where two modules would otherwise
  claim the same path.
- **Where it's used**: the Conference service host; consumed by the category-management UI and by every
  screen that offers a category picker.

---

### EventsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventsController.cs:42` · Level 8 · class (sealed)

- **What it is**: the REST controller for the [`Event`](group-17-conference-domain.md#event) aggregate
  root (`/Events`), and the richest controller in the group. On top of the standard aggregate-root CRUD it
  adds visibility scoping, publish / unpublish, a Sessionize refresh with bespoke error mapping, iCalendar
  export, and the "happening now / up next" snapshot.
- **Depends on**: [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  a stack of [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s
  (`EventCreateRequest`, `UpdateEventCommand`, `PublishEventCommand`, `UnpublishEventCommand`,
  `DeleteEntityCommand`, `RefreshFromSessionizeCommand`) and
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)s (`ExportEventCalendarQuery`,
  `GetNowNextQuery`), all in the primary constructor (`EventsController.cs:43-54`),
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) for role checks, `IOutputCacheStore`, the
  [`EventDTO`](group-17-conference-domain.md#eventdto), and the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute).
- **Concept introduced, business-rule visibility scoping via a specification.** `[Rubric §11, Security]`
  and `[Rubric §3, Clean Architecture]`: BR-108 says non-organizers see only published events. Rather than
  branch inside the query, the controller builds a
  [`Specification`](group-03-querying-specifications.md#specificationtentity-tidentifiertype) at the edge:
  `GetPublishedEventSpecification()` (`EventsController.cs:59-60`) returns `null` for organizers (no filter,
  keyed on [`RoleNames.Organizer`](group-08-auth.md#rolenames)) and a `PublishedEventSpecification` for
  everyone else, and each read passes that into `QueryService.GetAllAsync(..., specification: ...)`
  (`EventsController.cs:72-82, 102-120, 141-150`). The authorization predicate is thus a data specification
  the query service composes, not imperative post-filtering. `[Rubric §29, Resilience & Business
  Continuity]`: `RefreshAsync` (`EventsController.cs:277-308`) maps upstream trouble to retryable HTTP, an
  `Event.Sessionize.Throttled` error becomes `429` with a `Retry-After: 300` header (`:289-293`) and
  `Event.Sessionize.Unavailable` becomes `502` (`:296-297`), so an upstream throttle reaches the client as
  a signal, not a 500.
- **Walkthrough**: the standard reads (`EventsController.cs:62-151`) attach `[OutputCache("EventsCache")]`
  and the published-event specification, and the paged overload serializes `PaginationMetadata` into an
  `X-Pagination` header (`:118`). Beyond CRUD: `ExportCalendarAsync` (`:157-168`) streams an `.ics`
  document via `File(...)`; `GetNowNextAsync` / `GetCurrentNowNextAsync` (`:174-197`) serve the short-TTL
  `NowNextCache` "now / next" snapshot for a given or the current event. `CreateAsync` (`:204-213`) is an
  `override` marked `[Idempotent]` (`:205`), so a retried POST carrying the same `Idempotency-Key` is
  deduplicated; it calls `base.CreateAsync` then evicts. `UpdateAsync` (`:217-239`) appends a non-fatal
  `X-Warning` header when a timezone change leaves existing sessions semantically stale (BR-131,
  `:230-235`). `PublishAsync` / `UnpublishAsync` (`:242-273`) dispatch their commands and evict.
  `RefreshAsync` triggers a Sessionize import and, because that import touches events, sessions, speakers,
  and categories, evicts all four cache tags (`:303-306`). `DeleteAsync` (`:314-323`) additionally evicts
  `conference:sessions` and `conference:rooms` because soft-deleting an event cascades to its children.
- **Why it's built this way**: the base still owns the plain CRUD, so all the event-specific behavior
  (scoping, publish lifecycle, external refresh, calendar/now-next projections) reads as a flat list of
  extra actions. Mapping Sessionize failures to distinct status codes here keeps that operational nuance at
  the boundary while the handler stays a pure `Result` producer.
- **Where it's used**: the Conference service host; the home-screen widget calls `now-next`, the schedule
  UI calls the reads and `.ics` export, and organizer tooling drives publish/refresh.

---

### QuestionsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/QuestionsController.cs:31` · Level 8 · class (sealed)

- **What it is**: the REST controller for the [`Question`](group-17-conference-domain.md#question)
  aggregate root (`/Questions`), the feedback-question definitions attendees answer. It is the plainest
  aggregate-root controller: standard CRUD plus an update action and cache eviction, with no visibility
  scoping.
- **Depends on**: [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  the `QuestionCreateRequest` create handler, `UpdateQuestionCommand` update handler, and
  [`DeleteEntityCommand<Question, ...>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
  delete handler (`QuestionsController.cs:32-35`), `IOutputCacheStore`, and the
  [`QuestionDTO`](group-17-conference-domain.md#questiondto).
- **Concept introduced**: none new; this is the aggregate-root controller shape from
  [`ConferenceCategoriesController`](#conferencecategoriescontroller). `[Rubric §9, API & Contract Design]`:
  it demonstrates the pattern at its most minimal, four reads decorated with
  `[OutputCache("QuestionsCache")]` (`QuestionsController.cs:43-88`), a `CreateAsync`/`DeleteAsync` that
  simply call the base and evict (`:90-99, 119-128`), and one hand-rolled `UpdateAsync`.
- **Walkthrough**: `UpdateAsync` (`QuestionsController.cs:102-117`) wraps the body in
  `UpdateQuestionCommand(id, request)`, dispatches, evicts `conference:questions` via
  `EvictQuestionsCacheAsync` (`:130-131`), and returns `Ok(result.Value)`. Everything else is the base
  behavior with the cache policy attached.
- **Why it's built this way**: questions have no per-role visibility rule, so the controller carries none;
  it is the reference case for how little an aggregate-root controller must write when the base does the
  work.
- **Where it's used**: the Conference service host; the feedback-form builder UI is the main client, and
  answers flow through [`SessionQuestionAnswersController`](#sessionquestionanswerscontroller).

---

### SessionCategoryItemsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionCategoryItemsController.cs:39` · Level 8 · class (sealed)

- **What it is**: the REST controller for the link between a [`Session`](group-17-conference-domain.md#session)
  and a category item (`/SessionCategoryItems`), the association that tags a session with a track or topic.
  A child-collection controller identical in shape to
  [`EventSpeakersController`](#eventspeakerscontroller): anonymous reads, organizer add/remove.
- **Depends on**: [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  the `AddSessionCategoryItemCommand` / `RemoveSessionCategoryItemCommand`
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s
  (`SessionCategoryItemsController.cs:41-42`), the
  [`SessionCategoryItemDTO`](group-17-conference-domain.md#sessioncategoryitemdto), and the local
  `AddSessionCategoryItemRequest` record (`SessionCategoryItemsController.cs:22-29`).
- **Concept introduced**: none new; see the child-collection pattern at
  [`EventSpeakersController`](#eventspeakerscontroller). It is guarded by
  `[HasPermission(ConferencePermissions.SessionsManage)]` (`SessionCategoryItemsController.cs:38`) because
  the association belongs to the session aggregate. `[Rubric §11, Security]`: as with the other link
  controllers, the write permission follows the owning aggregate.
- **Walkthrough**: four `[AllowAnonymous]` read overrides forwarding to the base
  (`SessionCategoryItemsController.cs:46-89`); `CreateAsync` (`:92-107`) dispatches
  `AddSessionCategoryItemCommand(request.SessionId, null, request.CategoryItemId)` and returns
  `CreatedAtRoute("GetSessionCategoryItemById", ...)`; `DeleteAsync` (`:110-123`) reads the parent
  `sessionId` from the query string, dispatches `RemoveSessionCategoryItemCommand(sessionId, id)`, and
  returns `NoContent()`. Note this controller does *not* evict the sessions cache, unlike its speaker-link
  sibling below.
- **Why it's built this way**: same rationale as the other link controllers, the child mutates only
  through its parent aggregate, so it gets free reads and explicit, command-routed writes.
- **Where it's used**: the Conference service host; consumed by the session-editing UI's tag picker.

---

### SessionQuestionAnswersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:56` · Level 8 · class (sealed)

- **What it is**: the REST controller for a session's answered feedback questions
  (`/SessionQuestionAnswers`). It is a child-collection controller, but the only one in this unit whose
  *reads require authentication* and are scoped per user: an attendee sees only their own answers, an
  organizer sees all (BR-9).
- **Depends on**: [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  the add / update / remove [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s
  (`SessionQuestionAnswersController.cs:58-60`),
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) for the scoping decision, the
  [`SessionQuestionAnswerDTO`](group-17-conference-domain.md#sessionquestionanswerdto), and the two local
  request records `AddSessionQuestionAnswerRequest` / `UpdateSessionQuestionAnswerRequest`
  (`SessionQuestionAnswersController.cs:26-46`).
- **Concept introduced, owner-scoped reads at the controller edge.** `[Rubric §11, Security]` assesses
  row-level access control: the class is gated with
  `[Authorize(Policy = AuthorizationPolicies.RequireAuthenticated)]` (`SessionQuestionAnswersController.cs:55`,
  see [`AuthorizationPolicies`](group-08-auth.md#authorizationpolicies)) so no endpoint is anonymous, and
  `GetUserScopingSpecification()` (`:66-67`) returns `null` for organizers (using
  [`RoleNames.Organizer`](group-08-auth.md#rolenames)) and an `OwnSessionQuestionAnswerSpecification(userId)`
  otherwise. Every read passes that specification into the query service (`:77-85, 105-116, 140-147`), so
  the "only your own rows" rule is enforced as a data filter, the identical organizer-or-owner shape the
  aggregate-root controllers use for visibility. This is a distinct posture from the other child
  controllers, whose reads are fully anonymous.
- **Walkthrough**: the reads (`SessionQuestionAnswersController.cs:69-150`) forward to
  `QueryService.GetAllAsync`/`GetByIdAsync` with the scoping specification, and the paged overload writes
  the `X-Pagination` header (`:121`). `CreateAsync` (`:153-168`) dispatches
  `AddSessionQuestionAnswerCommand(request.SessionId, null, request.QuestionId, request.AnswerValue)` and
  returns `CreatedAtRoute`. `UpdateAsync` (`:171-184`) dispatches
  `UpdateSessionQuestionAnswerCommand(request.SessionId, id, request.AnswerValue)` and returns
  `NoContent()`, this is the only child-link controller in the unit with an update action.
  `DeleteAsync` (`:187-200`) reads the parent `sessionId` from the query string and dispatches the remove
  command.
- **Why it's built this way**: answers are personal feedback, so the read surface cannot be public; scoping
  by specification keeps the authorization rule in one place and lets the query service compose it into the
  database query rather than filtering in memory.
- **Where it's used**: the Conference service host; consumed by the attendee feedback UI and by organizer
  reporting screens.

---

### SessionsController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionsController.cs:40` · Level 8 · class (sealed)

- **What it is**: the REST controller for the [`Session`](group-17-conference-domain.md#session) aggregate
  root (`/Sessions`). Standard aggregate-root CRUD plus a cross-source visibility filter (BR-132/BR-49),
  an out-of-range warning header (BR-86), idempotent create, and an iCalendar export.
- **Depends on**: [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest),
  two [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)s
  (one for `Session`, one for `Event` so create can re-read the parent, `SessionsController.cs:41, 45`),
  the `SessionCreateRequest` create handler, `UpdateSessionCommand` update handler, and
  `DeleteEntityCommand` delete handler, plus
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)s for
  `GetPublicSessionFilterQuery` and `ExportSessionCalendarQuery`,
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), `IOutputCacheStore`, the
  [`SessionDTO`](group-17-conference-domain.md#sessiondto), and the
  [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute).
- **Concept introduced, a cross-source visibility specification.** `[Rubric §8, Data Architecture]` and
  `[Rubric §7, Microservices Readiness]`: BR-132/BR-49 hides declined sessions and sessions of unpublished
  events from non-organizers, but a `Session` lives in one data source while its parent `Event`'s published
  flag lives in another (the comment at `SessionsController.cs:57-62` notes Session in Cosmos, Event in SQL
  Server). Rather than a cross-database join, `BuildPublicSessionSpecificationAsync` (`:63-72`) delegates to
  the `GetPublicSessionFilterQuery` handler, which uses the framework's cross-source specification helper to
  produce a [`Specification<Session, ...>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype)
  the query service can apply; organizers get `null` (no filter). `[Rubric §12, Performance & Scalability]`:
  reads are `[OutputCache("SessionsCache")]` and the default sort is a `StartsAt,RoomId` string
  (`:76`, `:93-94`), sorting the schedule chronologically then by room.
- **Walkthrough**: the reads (`SessionsController.cs:78-176`) attach the cache policy and the public-session
  specification; the paged overload defaults the sort and writes `X-Pagination` (`:143`).
  `ExportCalendarAsync` (`:182-193`) streams a session `.ics` via `File(...)`. `CreateAsync` (`:200-230`)
  is an `override` marked `[Idempotent]`, it dispatches the create, then, if the request set start/end
  times, re-reads the parent event and appends a non-fatal `X-Warning` header when the session falls
  outside the event's date range (BR-86). Note the parent re-read pattern-matches the widened query result
  with `eventResult.Value is EventDTO evt` (`:220`) rather than a dynamic member access: the query service
  widens its return to `object` for field projection, so the controller narrows it back with a type
  pattern. `UpdateAsync` (`:234-254`) surfaces the same BR-86 warning from
  `result.Value.HasDateRangeWarning`. Every mutation evicts through `EvictSessionsCacheAsync`
  (`:267-271`), which clears both the `conference:sessions` and the broad `conference` tags.
- **Why it's built this way**: pushing the cross-source published-event check into a query handler keeps
  the controller free of persistence knowledge (`[Rubric §3, Clean Architecture]`), and the warning headers
  let the API accept a slightly-off schedule while telling the client, rather than rejecting the write.
- **Where it's used**: the Conference service host; the schedule UI, the "add to calendar" affordance, and
  the load test's read endpoints (`/Sessions/paged`) all hit it.

---

### SessionSpeakersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSpeakersController.cs:40` · Level 8 · class (sealed)

- **What it is**: the REST controller for the link between a [`Session`](group-17-conference-domain.md#session)
  and its [`Speaker`](group-17-conference-domain.md#speaker)s (`/SessionSpeakers`). A child-collection
  controller like [`EventSpeakersController`](#eventspeakerscontroller), with one addition: because a
  speaker assignment changes the cached session reads, it evicts the sessions output cache on every write.
- **Depends on**: [`EntityControllerBase`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  the `AddSessionSpeakerCommand` / `RemoveSessionSpeakerCommand`
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s
  (`SessionSpeakersController.cs:42-43`), `IOutputCacheStore`, the
  [`SessionSpeakerDTO`](group-17-conference-domain.md#sessionspeakerdto), and the local
  `AddSessionSpeakerRequest` record (`SessionSpeakersController.cs:23-30`).
- **Concept introduced**: none new; the child-collection pattern is taught at
  [`EventSpeakersController`](#eventspeakerscontroller). The distinguishing detail is *cross-entity cache
  eviction*: `[Rubric §12, Performance & Scalability]`, a link controller normally has no cache to touch,
  but assigning or removing a speaker changes the session detail and list reads (which the speaker
  dashboard relies on), so `EvictSessionsCacheAsync` (`SessionSpeakersController.cs:137-141`) clears the
  `conference:sessions` and `conference` tags after each successful write, even though the reads *here* are
  uncached.
- **Walkthrough**: four `[AllowAnonymous]` read overrides forward to the base
  (`SessionSpeakersController.cs:48-91`); `CreateAsync` (`:94-115`) dispatches
  `AddSessionSpeakerCommand(request.SessionId, null, request.SpeakerId)`, evicts the sessions cache on
  success, and returns `CreatedAtRoute("GetSessionSpeakerById", ...)`; `DeleteAsync` (`:118-135`) reads the
  parent `sessionId` from the query string, dispatches `RemoveSessionSpeakerCommand(sessionId, id)`, evicts,
  and returns `NoContent()`. As elsewhere, eviction runs only after a non-failing result.
- **Why it's built this way**: the eviction crosses aggregates deliberately, the session's cached
  representation includes its speakers, so mutating the link must invalidate the session cache to keep
  reads correct.
- **Where it's used**: the Conference service host; consumed by the session-editing UI and the speaker
  dashboard.

---

### SpeakersController
> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Controllers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:41` · Level 8 · class (sealed)

- **What it is**: the REST controller for the [`Speaker`](group-17-conference-domain.md#speaker) aggregate
  root (`/Speakers`). Full aggregate-root CRUD plus a virtual `EventId` filter, resource-level self-edit
  authorization (BR-214), user linking / unlinking (BR-209), and two cross-entity read projections
  (feedback and bookmark count, BR-210).
- **Depends on**: [`AggregateRootEntityControllerBase`](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest),
  [`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
  the `SpeakerCreateRequest` create handler, `UpdateSpeakerCommand`, `LinkUserToSpeakerCommand`,
  `UnlinkUserFromSpeakerCommand`, and `DeleteEntityCommand`
  [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)s, plus
  [`IQueryHandler`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)s for
  `GetSessionFeedbackQuery`, `GetSessionBookmarkCountQuery`, and `GetSpeakersByEventFilterQuery` (primary
  constructor, `SpeakersController.cs:42-53`), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice),
  `IOutputCacheStore`, the [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), and the
  [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute).
- **Concept introduced, per-action authorization and resource-ownership checks.** `[Rubric §11, Security]`:
  unlike the other aggregate-root controllers (which gate the whole class with one `[HasPermission(...)]`),
  `SpeakersController` carries a bare class-level `[Authorize]` (`SpeakersController.cs:40`) and then
  varies authorization per action, reads are `[AllowAnonymous]`, create / delete / link / unlink each
  re-assert `[HasPermission(ConferencePermissions.SpeakersManage)]` (`:149, 189, 201, 220`), and
  `UpdateAsync` performs a *resource-ownership* check in code: a speaker may self-edit only when their
  `speaker_id` JWT claim equals the route id, otherwise `Forbid()` (`SpeakersController.cs:170-174`, BR-214),
  while organizers may edit anyone. This is authorization that policy attributes cannot express, it depends
  on the specific row being edited. `[Rubric §9, API & Contract Design]`: the paged read also demonstrates
  a *virtual filter key*, `EventId` is not a Speaker column, so the paged action intercepts and removes it
  from the generic filter dictionary (`:92-101`) and translates it into a
  [`Specification`](group-03-querying-specifications.md#specificationtentity-tidentifiertype) via
  `GetSpeakersByEventFilterQuery` (selecting speakers linked to the event directly or through its sessions);
  an unparseable value silently ignores the key rather than failing the request.
- **Walkthrough**: the reads (`SpeakersController.cs:57-145`) attach `[OutputCache("SpeakersCache")]`; the
  paged overload does the `EventId` interception above before delegating to `QueryService.GetAllAsync` and
  writing `X-Pagination` (`:119`). `CreateAsync` / `DeleteAsync` (`:150-157, 190-197`) call the base and
  evict. `UpdateAsync` (`:165-185`) runs the self-or-organizer check, dispatches `UpdateSpeakerCommand`,
  and evicts. `LinkUserAsync` / `UnlinkUserAsync` (`:202-234`) dispatch the link/unlink commands (which
  drive the cross-module User to Speaker association over integration events) and evict. The two
  cross-entity reads, `GetSessionFeedbackAsync` (`:241-253`) and `GetSessionBookmarkCountAsync`
  (`:260-272`), are `[AllowAnonymous]`, use the broad `ConferencePublicCache` policy (because they span
  speakers and sessions), and return the query handler's result. Every mutation evicts through
  `EvictSpeakersCacheAsync` (`:274-278`), clearing the `conference:speakers` and `conference` tags.
- **Why it's built this way**: speaker profiles are edited both by organizers and by the speakers
  themselves, so the controller needs row-aware authorization that a static policy cannot provide; keeping
  that check inline (rather than in a filter) mirrors the per-mutation ownership pattern used across the
  codebase for "404-not-403" style checks. The virtual `EventId` filter gives clients an event-scoped
  speaker list without adding a denormalized column to the aggregate.
- **Where it's used**: the Conference service host; consumed by the speaker directory, the speaker
  self-service profile page, organizer linking tools, and the speaker dashboard's feedback/bookmark tiles.

### ConferenceErrorResources

> MMCA.ADC.Conference.API · `MMCA.ADC.Conference.API.Resources` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Resources/ConferenceErrorResources.cs:11` · Level 0 · class

- **What it is**: an empty marker class that exists only to be the compile-time anchor for the Conference module's localized error-message resources. It ships no members (`ConferenceErrorResources.cs:11-13`); its `.resx` siblings carry the actual translations.
- **Depends on**: nothing in code (it is a bare `sealed class`). At runtime it is paired with two resource sets, `ConferenceErrorResources.resx` (English) and `ConferenceErrorResources.es.resx` (Spanish), keyed by domain error `Code` such as `"Event.Name.Empty"`, and resolved by the shared `IErrorLocalizer` ([group-12-api-hosting-mapping.md#ierrorlocalizer](group-12-api-hosting-mapping.md#ierrorlocalizer)).
- **Concept introduced: resource-anchor localization of error codes (ADR-027).** This is the first Conference-side appearance of the framework's error-localization convention. A [Result](group-01-result-error-handling.md#result) failure carries a stable machine `Code` (see [Error](group-01-result-error-handling.md#error) / [ErrorType](group-01-result-error-handling.md#errortype)); at the API boundary the shared `IErrorLocalizer` looks that `Code` up in a `ResourceManager` built from a marker type. Using a strongly-typed anchor class (rather than a magic string base name) lets the host register the set generically via `AddErrorResources<ConferenceErrorResources>()`, which the XML doc-comment on the class calls out (`ConferenceErrorResources.cs:7`). `[Rubric §9, API & Contract Design]` (assesses whether the API returns stable, well-shaped errors): the client sees a translated message while the `Code` stays invariant. `[Rubric §27, i18n]` (assesses first-class localization plumbing): translations live in `.resx` culture files, not in domain code.
- **Walkthrough**: there is nothing to trace: the type is `public sealed class ConferenceErrorResources { }` with an empty body (`ConferenceErrorResources.cs:11-13`). All behavior is in the ADR-027 machinery around it. The class doc-comment (`ConferenceErrorResources.cs:3-10`) is the design record: runtime-variable messages (ones that interpolate a user-supplied value) are deliberately left out of the `.resx` so they degrade gracefully to their English message with the interpolated value intact.
- **Why it's built this way**: a marker type gives the C# generic registration API something to bind to and gives the `ResourceManager` a namespace-qualified base name, keeping resource lookup type-safe and refactor-safe. See ADR-027 (multi-locale i18n) for the error-localization design.
- **Where it's used**: registered by the Conference service host at `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:236` through `services.AddErrorResources<ConferenceErrorResources>()`; consumed indirectly whenever `IErrorLocalizer` maps a Conference domain failure to a Problem Details response. Its key coverage is asserted by `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Localization/ConferenceErrorResourcesTests.cs`.
- **Caveats / not-in-source**: the exact `.resx` key set is not in this file; it lives in the two `.resx` assets beside it.

### KestrelConfiguration

> MMCA.ADC.Conference.Service · `MMCA.ADC.Conference.Service` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/KestrelConfiguration.cs:11` · Level 0 · class (static, internal)

- **What it is**: the one-method helper that configures this service host's Kestrel endpoints: HTTP/2-only (h2c) by default, plus an optional dedicated HTTP/1.1 listener that exists solely so the Azure Container Apps `httpGet` health probes can reach the health pipeline (`KestrelConfiguration.cs:5-10`).
- **Depends on**: `Microsoft.AspNetCore.Server.Kestrel.Core` (`HttpProtocols`, `KestrelConfiguration.cs:1`), `WebApplicationBuilder` and `IConfiguration.GetValue<T>` (ASP.NET Core). No first-party types.
- **Concept introduced: the h2c prior-knowledge transport profile and its probe workaround (ADR-012).** Cross-service gRPC in this codebase runs over cleartext HTTP/2 without TLS or ALPN, which means the client must assume HTTP/2 up front ("prior knowledge") and the server endpoint must speak only HTTP/2. `HttpProtocols.Http1AndHttp2` would make Kestrel fall back to HTTP/1.1 on a cleartext connection, so the default here is hard `Http2` (`KestrelConfiguration.cs:33`). The cost is that anything genuinely HTTP/1.1, including the platform's health probes, gets rejected with `GOAWAY HTTP_1_1_REQUIRED`, which the doc-comment records as the reason the ACA probes used to be TCP-only and never consulted the database-aware health checks (`KestrelConfiguration.cs:17-19`). The fix is a second listener on its own port speaking `Http1` only. `[Rubric §7, Microservices Readiness]` (assesses whether service-to-service transport is deliberately designed): the transport profile is a documented, per-service decision rather than a default. `[Rubric §13, Observability & Operability]` (assesses health and readiness signaling): real HTTP probes now hit `/health`, `/alive` and `/health/ready` instead of a bare TCP connect. `[Rubric §16, Maintainability]`: the doc-comment states the extraction from `Program.cs` was done to keep that top-level file inside the S1541 complexity budget (`KestrelConfiguration.cs:8-9`).
- **Walkthrough**: a single static method, `ConfigureHttp2WithHealthProbe(WebApplicationBuilder builder)` (`KestrelConfiguration.cs:27`).
  - Fail-fast null guard on the builder (`:29`), then `builder.WebHost.ConfigureKestrel(...)` (`:31`).
  - `k.ConfigureEndpointDefaults(o => o.Protocols = HttpProtocols.Http2)` (`:33`) makes every endpoint, including the container's implicit `ASPNETCORE_HTTP_PORTS` binding, HTTP/2-only.
  - The probe listener is conditional on `HealthProbe:Port` parsing as an `int` (`:35`). When present, the method explicitly re-declares the main h2c endpoint on port `8080` (`:37`) and adds the `Http1`-only probe listener on the configured port (`:38`). The re-declaration is required because an explicit `Listen` call overrides the container's default binding (`:21-23`), so omitting 8080 would silently drop the real traffic endpoint.
  - The key is deliberately absent locally (`:15-17`): Aspire assigns dynamic ports, and a fixed probe port would collide when several services run on one machine. In Azure it is injected as `HealthProbe__Port` (value `8081` for this service, `MMCA.ADC/infra/main.bicep:1103`), and that port stays off the ACA ingress because the platform probes address it directly (`:23-24`).
- **Why it's built this way**: ADR-012 (gRPC host transport) defines the per-service endpoint profiles; Conference runs the h2c-only profile while Notification runs the mixed profile so its SignalR WebSocket upgrade works. `MapDefaultEndpoints` maps the health endpoints on every listener (`:20-21`), so the extra probe listener costs nothing beyond a port.
- **Where it's used**: called near the top of the Conference host, `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:83`. Same-named siblings exist per service (Engagement, Identity, Notification), each with its own profile.
- **Caveats / not-in-source**: whether the ACA ingress in front of this container is configured with `transport=http2` is not visible here; the `Program.cs` comment (`Program.cs:79-80`) states it must be.

### SelfHttpOutputCacheWarmupTask

> MMCA.ADC.Conference.Service · `MMCA.ADC.Conference.Service` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/SelfHttpOutputCacheWarmupTask.cs:18` · Level 1 · class (sealed, internal, partial)

- **What it is**: a startup warm-up task that, once this Conference host has begun listening, replays a fixed set of hot anonymous read requests against the host's own Kestrel endpoint so the OutputCache (and the envoy connection in front of it) is populated before real traffic arrives (`SelfHttpOutputCacheWarmupTask.cs:8-17`).
- **Depends on**: `IWarmupTask` ([group-16-aspire-orchestration.md#iwarmuptask](group-16-aspire-orchestration.md#iwarmuptask)) which it implements; injected `IServer`, `IConfiguration`, `IHostEnvironment`, `IHostApplicationLifetime`, `ILogger<>` (ASP.NET Core, primary-constructor parameters at `SelfHttpOutputCacheWarmupTask.cs:18-23`); `IServerAddressesFeature` (`Microsoft.AspNetCore.Hosting.Server.Features`); `SocketsHttpHandler` / `HttpClient` (BCL); `[LoggerMessage]` source-generated logging (`:104-110`).
- **Concept introduced: warm-up-gated readiness (ADR-025).** The class doc-comment (`:8-17`) is the design record: the task is registered via `AddWarmupTask<T>()` and driven by the `AddWarmupReadiness()` runner that `AddServiceDefaults()` wires, so `/health/ready` stays not-ready until the warm-up has had its chance. That is the point of implementing `IWarmupTask` rather than a bare `IHostedService`: the readiness gate holds the container out of rotation until the full request path (envoy, Kestrel, OutputCache, controller, entity query service, EF Core, SQL) has been exercised once. `[Rubric §12, Performance & Scalability]` (assesses cold-start and cache behavior): the first real user never pays the cold-cache plus cold-EF penalty. `[Rubric §13, Observability & Operability]` (assesses readiness signaling): the task ties cache readiness to the health endpoint instead of hoping the cache warms lazily.
- **Walkthrough**: members in execution order.
  - `DefaultPort = 8080` (`:25`) and the `WarmupPaths` array (`:27-34`): the five hot Conference reads to prime (`Events/paged`, `Events`, `Sessions/paged`, `Speakers/paged`, and the full `Speakers` list with `pageSize=10000`). `Name => "SelfHttpOutputCache"` (`:36`) identifies the task to the runner.
  - `ExecuteAsync` (`:38`): first short-circuits under the `Testing` environment (`:42-45`) because the `WebApplicationFactory` `TestServer` never opens a real Kestrel port, so a self-HTTP call cannot work. Otherwise it awaits `WaitForServerStartedAsync` (`:49`), builds a `localhost` base URL on the resolved port (`:51`), and issues each warm-up GET (`:65-68`). Success logs via `LogWarmupCompleted` (`:70`); a genuine cancellation is re-thrown (`:72-75`) while any other exception is swallowed and logged as a warning (`:76-79`) so a warm-up failure never crashes the host.
  - The `HttpClient` is deliberately pinned to HTTP/2 exact (`DefaultRequestVersion = Version20`, `DefaultVersionPolicy = RequestVersionExact`, `:61-62`). The inline comment (`:56-60`) explains why: the endpoint is HTTP/2-only on cleartext (h2c prior knowledge, ADR-012 Profile A, configured by [KestrelConfiguration](#kestrelconfiguration)), so `RequestVersionOrLower` would silently downgrade to HTTP/1.1, be rejected with a 400, and leave the cache cold.
  - `WaitForServerStartedAsync` (`:84`): the warm-up runner starts before Kestrel begins listening (the web host is the last hosted service), so the task blocks on `lifetime.ApplicationStarted` through a `TaskCompletionSource` registration (`:86-88`) before self-requesting.
  - `ResolveWarmupPort` (`:93`): prefers the server's actual bound cleartext address from `IServerAddressesFeature` (correct under dynamic ports), falling back to parsing `ASPNETCORE_URLS`, then to `DefaultPort` (`:95-101`).
- **Why it's built this way**: ADR-025 (startup warm-up and readiness) replaces the former hand-rolled post-`StartAsync` self-HTTP loop in `Program.cs` (called out at `:14-16`) with a first-class `IWarmupTask` so warm-up is uniform across services and its outcome feeds readiness. Swallowing non-cancellation exceptions keeps warm-up best-effort: a transient failure falls back to lazy warm-up on the first real request rather than blocking the host.
- **Where it's used**: registered at `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:195` via `services.AddWarmupTask<SelfHttpOutputCacheWarmupTask>()`; run by the `AddWarmupReadiness()` runner from the shared service defaults.
- **Caveats / not-in-source**: the class is `partial` only to host the source-generated `[LoggerMessage]` methods; the generated half is not in this file.

### GrpcErrorTrailerParser

> MMCA.ADC.Conference.Contracts · `MMCA.ADC.Conference.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/GrpcErrorTrailerParser.cs:14` · Level 2 · class (static, internal)

- **What it is**: a static helper that reconstructs a `List<Error>` from the `error-{i}-*` gRPC trailers the server side emits when a [Result](group-01-result-error-handling.md#result) failure crosses the wire (`GrpcErrorTrailerParser.cs:7-14`). It is the single shared home for the client-side half of the Result round-trip, used by every client adapter in this project.
- **Depends on**: [Error](group-01-result-error-handling.md#error) and [ErrorType](group-01-result-error-handling.md#errortype) (`MMCA.Common.Shared.Abstractions`); `Grpc.Core.Metadata` (the trailer collection); `System.Globalization` for invariant index formatting.
- **Concept introduced: parsing the Result trailer protocol.** The server side of this protocol is `GrpcResultExceptionInterceptor` plus `ResultGrpcExtensions` ([group-13-grpc-contracts.md#resultgrpcextensions](group-13-grpc-contracts.md#resultgrpcextensions) / [group-13-grpc-contracts.md#grpcresultexceptioninterceptor](group-13-grpc-contracts.md#grpcresultexceptioninterceptor)), which serializes each `Error` into indexed trailers (`error-0-code`, `error-0-message`, `error-0-type`, and so on). This parser is the inverse. Factoring it out of the individual adapters is the current shape: both Conference client adapters call `GrpcErrorTrailerParser.Parse(...)` instead of each carrying a private copy of the loop. `[Rubric §9, API & Contract Design]` (assesses error-shape fidelity across a boundary): a remote failure deserializes back into the same `Error` list a caller would see in-process. `[Rubric §15, Best Practices & Code Quality]` (assesses DRY and single-responsibility helpers): one parser, one place to change the wire format.
- **Walkthrough**: three methods, top down.
  - `Parse(Metadata trailers)` (`:17`): guards null or empty trailers to an empty list (`:20-23`), then runs a sequential index loop from `i = 0` (`:25-44`). Each iteration reads `error-{i}-code`; a missing code breaks the loop (`:29-33`), matching the sequential layout the server writes, so iteration stops at the first gap. It then reads the sibling `message` / `type` / `source` / `target` trailers (`:35-38`), builds the `Error` (`:40-41`), and increments.
  - `ParseErrorType(string?)` (`:50`): `Enum.TryParse<ErrorType>` with `ignoreCase: false`, defaulting to `ErrorType.Failure` when the wire value does not match (`:50-53`).
  - `BuildError(...)` (`:56`): a `switch` over `ErrorType` that dispatches to the matching `Error` factory (`Error.Validation`, `Error.Invariant`, `Error.NotFoundError`, `Error.Conflict`, `Error.Unauthorized`, `Error.Forbidden`, `Error.UnprocessableEntity`, `Error.Failure`), with `Failure` as both an explicit arm and the default (`:57-68`). Using the typed factories preserves the original `ErrorType`, so downstream HTTP mapping (validation to 400, not-found to 404, and so on) still works after the round-trip.
- **Why it's built this way**: `Result` is an in-process type; gRPC carries only proto messages plus an `RpcException` status. Trailers are the framework's chosen carrier for structured error data, and centralizing the parse keeps ADR-007's promise that extraction is transparent to callers. See ADR-007 (gRPC extraction).
- **Where it's used**: [EventLiveValidationServiceGrpcAdapter](#eventlivevalidationservicegrpcadapter) and [SessionBookmarkValidationServiceGrpcAdapter](#sessionbookmarkvalidationservicegrpcadapter), both in this group, inside their `catch (RpcException)` blocks.

### EventLiveValidationGrpcService

> MMCA.ADC.Conference.Service · `MMCA.ADC.Conference.Service.Grpc` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/EventLiveValidationGrpcService.cs:22` · Level 9 · class (sealed)

- **What it is**: the gRPC server that exposes Conference's in-process [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) over the wire to consumer services (Engagement's live layer), bridging the C# interface to the `event_live_validation.proto` contract (`EventLiveValidationGrpcService.cs:8-21`).
- **Depends on**: [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) (the inner service it delegates to, injected at `:22`); the Protobuf-generated `EventLiveValidationService.EventLiveValidationServiceBase` it inherits (`:23`); `GrpcResultExceptionInterceptor` ([group-13-grpc-contracts.md#grpcresultexceptioninterceptor](group-13-grpc-contracts.md#grpcresultexceptioninterceptor)) via `ThrowIfFailure`; the [EventLiveInfo](group-17-conference-domain.md#eventliveinfo) / [SessionLiveInfo](group-17-conference-domain.md#sessionliveinfo) value shapes and [QuestionModerationDefault](group-17-conference-domain.md#questionmoderationdefault); `Grpc.Core`.
- **Concept introduced: Result-to-RpcException on the server side.** This is the mirror of [GrpcErrorTrailerParser](#grpcerrortrailerparser). The class doc-comment (`:13-20`) spells out the protocol: the inner service returns `Result<EventLiveInfo>`; the server calls `result.ThrowIfFailure()`, which raises a `ResultFailureException` that the `GrpcResultExceptionInterceptor` catches and serializes into the `error-{i}-*` trailers the client adapter later parses. `[Rubric §7, Microservices Readiness]` (assesses whether a module can be extracted behind a wire contract without changing its logic): the inner `IEventLiveValidationService` is unchanged and this class is the only added surface. `[Rubric §9, API & Contract Design]` (assesses contract-first typed boundaries): the request and response messages are generated from `.proto`, and Unix-seconds encoding makes the time fields wire-portable.
- **Walkthrough**: two overrides of the generated base.
  - `GetEventLiveInfo` (`:26`): null-checks `request` and `context` (`:30-31`, the fail-fast pattern applied to every gRPC method parameter), awaits `inner.GetEventLiveInfoAsync(request.EventId, context.CancellationToken)` (`:33-35`), then `result.ThrowIfFailure()` (`:38`) so a failure becomes an `RpcException` through the interceptor. On success it maps `EventLiveInfo` into the response, encoding `LiveWindowStartUtc` and `LiveWindowEndUtc` as Unix seconds via `new DateTimeOffset(..., TimeSpan.Zero).ToUnixTimeSeconds()` (`:41-46`).
  - `GetSessionLiveInfo` (`:50`): the same null-check and `ThrowIfFailure` shape (`:54-62`), then maps `SessionLiveInfo` including `EventId`, the two Unix-seconds live-window bounds, `IsPlenumSession`, and `QuestionModerationDefault` cast to `int` (`:65-73`). The repeated `SpeakerIds` field is filled by projecting each speaker id to its string form through `AddRange` (`:74`), because the proto carries speaker ids as strings.
- **Why it's built this way**: ADR-007 (gRPC extraction) keeps consumer modules bound to the C# interface; the server bridge and the client adapter are the whole extraction cost. Encoding times as Unix seconds avoids proto timestamp and `DateTime` kind ambiguity across the boundary.
- **Where it's used**: mapped at `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:314` via `app.MapGrpcService<EventLiveValidationGrpcService>()`; its remote counterpart is [EventLiveValidationServiceGrpcAdapter](#eventlivevalidationservicegrpcadapter).

### EventLiveValidationServiceGrpcAdapter

> MMCA.ADC.Conference.Contracts · `MMCA.ADC.Conference.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/EventLiveValidationServiceGrpcAdapter.cs:23` · Level 9 · class (sealed)

- **What it is**: the client-side adapter that implements [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) on top of the generated `EventLiveValidationService.EventLiveValidationServiceClient`, so Engagement's live layer keeps calling the same C# interface while the call actually travels to the extracted Conference service over gRPC (`EventLiveValidationServiceGrpcAdapter.cs:8-22`).
- **Depends on**: [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice) (implemented); the generated `EventLiveValidationServiceClient` (injected at `:24`); [GrpcErrorTrailerParser](#grpcerrortrailerparser) for the failure round-trip; [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error); the [EventLiveInfo](group-17-conference-domain.md#eventliveinfo) / [SessionLiveInfo](group-17-conference-domain.md#sessionliveinfo) value shapes and [QuestionModerationDefault](group-17-conference-domain.md#questionmoderationdefault); `Grpc.Core`.
- **Concept: the client half of Result round-tripping over gRPC** (introduced by [GrpcErrorTrailerParser](#grpcerrortrailerparser) and mirrored by [EventLiveValidationGrpcService](#eventlivevalidationgrpcservice)). Second concept, a **per-call deadline tighter than the resilience pipeline**: `CallDeadline = TimeSpan.FromSeconds(5)` (`:30`) with the reasoning in the comment above it (`:27-29`), namely that these lookups gate live-layer commands (poll open and close, question submit), so a hung (as opposed to refused) Conference peer must fail fast rather than stall the request behind the shared pipeline's 30-second attempt and 90-second total budget. `[Rubric §7, Microservices Readiness]` (assesses transparent extraction), `[Rubric §9, API & Contract Design]` (assesses error-shape preservation): callers see the same `Result<T>` they would from an in-process call. `[Rubric §29, Resilience & Business Continuity]` (assesses failure containment): the deadline bounds the blast radius of a slow peer.
- **Walkthrough**: one constant and two structurally identical methods.
  - `CallDeadline` (`:30`): the 5-second per-call budget, passed as `deadline: DateTime.UtcNow.Add(CallDeadline)` on both calls (`:44`, `:81`).
  - `GetEventLiveInfoAsync` (`:33`): calls `client.GetEventLiveInfoAsync` inside a `try` (`:37-45`), then on success rebuilds `Result.Success(new EventLiveInfo(...))`, decoding the Unix-seconds bounds back to UTC with `DateTimeOffset.FromUnixTimeSeconds(...).UtcDateTime` (`:47-50`). The `catch (RpcException ex)` (`:52`) delegates to `GrpcErrorTrailerParser.Parse(ex.Trailers)` (`:54`); if structured errors are present it returns `Result.Failure<EventLiveInfo>(errors)` (`:55-58`), otherwise it maps a transport-level fault (connection reset, deadline exceeded) to a generic `Error.Failure` carrying `$"Grpc.{ex.StatusCode}"` and the RPC detail (`:62-65`).
  - `GetSessionLiveInfoAsync` (`:70`): the same shape (`:74-107`), reconstructing `SessionLiveInfo` with `EventId`, `IsPublished`, the two decoded UTC bounds, the speaker ids parsed back from strings with `Guid.Parse` in a collection expression (`:89`), `IsPlenumSession`, and `QuestionModerationDefault` cast from the wire int (`:91`).
- **Why it's built this way**: ADR-007: consumers depend on the interface and the composition root swaps the implementation. The transport-fault fallback keeps the caller in `Result` space even when there are no structured trailers to parse, so a Conference outage degrades to a handled failure instead of an unhandled exception.
- **Where it's used**: registered by [DependencyInjection](#dependencyinjection)'s `AddConferenceEventLiveValidationClient` in this group, called from Engagement's host at `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:181`.

### SessionBookmarksGrpcService

> MMCA.ADC.Conference.Service · `MMCA.ADC.Conference.Service.Grpc` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/SessionBookmarksGrpcService.cs:23` · Level 9 · class (sealed)

- **What it is**: the gRPC server that exposes Conference's in-process [ISessionBookmarkValidationService](group-17-conference-domain.md#isessionbookmarkvalidationservice) over the wire to Engagement, bridging the C# interface to the `session_bookmark_validation.proto` contract (`SessionBookmarksGrpcService.cs:9-22`).
- **Depends on**: [ISessionBookmarkValidationService](group-17-conference-domain.md#isessionbookmarkvalidationservice) (injected at `:23`); the generated `SessionBookmarkValidationService.SessionBookmarkValidationServiceBase` it inherits (`:24`); `GrpcResultExceptionInterceptor` ([group-13-grpc-contracts.md#grpcresultexceptioninterceptor](group-13-grpc-contracts.md#grpcresultexceptioninterceptor)) via `ThrowIfFailure`; [Result](group-01-result-error-handling.md#result); `Grpc.Core`.
- **Concept: Result-to-RpcException on the server side** (the same protocol as [EventLiveValidationGrpcService](#eventlivevalidationgrpcservice); the doc-comment restates it at `:14-21`). The shape difference: this service's validate method returns a non-generic [Result](group-01-result-error-handling.md#result), so success carries no payload at all. `[Rubric §7, Microservices Readiness]` and `[Rubric §9, API & Contract Design]` apply exactly as for the event-live pair.
- **Walkthrough**: two overrides.
  - `ValidateSessionForBookmark` (`:27`): null-checks request and context (`:31-32`), awaits `inner.ValidateSessionForBookmarkAsync(request.SessionId, context.CancellationToken)` (`:34-36`), calls `result.ThrowIfFailure()` (`:39`), and returns an empty `ValidateSessionForBookmarkResponse` on success (`:41`), because the check has no return value beyond pass or fail.
  - `GetSessionIdsByEvent` (`:45`): the same null-checks (`:49-50`), awaits `inner.GetSessionIdsByEventAsync(request.EventId, context.CancellationToken)` (`:52-54`), calls `result.ThrowIfFailure()` (`:57`), then constructs the response and copies `result.Value` into the proto repeated `SessionIds` field with `AddRange` (`:59-61`). Both methods therefore go through the same failure protocol; only the success payload differs.
- **Why it's built this way**: ADR-007: the extraction adds only the server bridge and the client adapter, and the inner service is untouched. `[Rubric §16, Maintainability]` (assesses low-friction evolution): adding a cross-service method means one proto rpc, one override here, and one method on the adapter, following the established pattern.
- **Where it's used**: mapped at `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:313` via `app.MapGrpcService<SessionBookmarksGrpcService>()`; its remote counterpart is [SessionBookmarkValidationServiceGrpcAdapter](#sessionbookmarkvalidationservicegrpcadapter).

### SessionBookmarkValidationServiceGrpcAdapter

> MMCA.ADC.Conference.Contracts · `MMCA.ADC.Conference.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:24` · Level 9 · class (sealed)

- **What it is**: the client-side adapter that implements [ISessionBookmarkValidationService](group-17-conference-domain.md#isessionbookmarkvalidationservice) on top of the generated `SessionBookmarkValidationService.SessionBookmarkValidationServiceClient`, so Engagement keeps depending on the C# interface while the real Conference module runs as its own service (`SessionBookmarkValidationServiceGrpcAdapter.cs:8-23`).
- **Depends on**: [ISessionBookmarkValidationService](group-17-conference-domain.md#isessionbookmarkvalidationservice) (implemented); the generated `SessionBookmarkValidationServiceClient` (injected at `:25`); [GrpcErrorTrailerParser](#grpcerrortrailerparser); [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error); `Grpc.Core`.
- **Concept: the client half of Result round-tripping** (introduced by [GrpcErrorTrailerParser](#grpcerrortrailerparser)). This adapter is the near-identical sibling of [EventLiveValidationServiceGrpcAdapter](#eventlivevalidationservicegrpcadapter), including its own 5-second `CallDeadline` (`:32`) with the same rationale recorded in the comment above it (`:28-31`): these calls sit inline in user request paths (bookmark create, bookmark list), so a hung peer must fail fast rather than hold the caller's request hostage. The only shape difference is that the validate method returns a non-generic `Result` while the query returns `Result<IReadOnlyCollection<SessionIdentifierType>>`.
- **Walkthrough**: two methods.
  - `ValidateSessionForBookmarkAsync` (`:35`): calls the client inside a `try` with the deadline applied and returns `Result.Success()` (`:39-48`); the `catch (RpcException)` (`:50`) runs `GrpcErrorTrailerParser.Parse(ex.Trailers)` (`:52`) and returns `Result.Failure(errors)` when trailers are present (`:53-56`), else a generic `Error.Failure` with `$"Grpc.{ex.StatusCode}"` and the RPC detail for a transport fault (`:60-63`).
  - `GetSessionIdsByEventAsync` (`:68`): the same protocol. On success it spreads the proto repeated field into a collection expression and returns `Result.Success<IReadOnlyCollection<SessionIdentifierType>>([.. response.SessionIds])` (`:74-82`); on `RpcException` it parses trailers first (`:86-90`) and otherwise returns a generic failure. The comment at `:92-95` records why the catch parity matters: without it a Conference outage would surface on GET bookmarks-by-event as a raw 500 instead of a `Result` failure the caller can handle.
- **Why it's built this way**: ADR-007: consumers stay bound to the interface and the composition root swaps in this adapter. Both methods map failures into `Result` so a peer outage never escapes as an unhandled exception from a user-facing request path.
- **Where it's used**: registered by [DependencyInjection](#dependencyinjection)'s `AddConferenceSessionValidationClient` in this group, called from Engagement's host at `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:176`.

### DependencyInjection

> MMCA.ADC.Conference.Contracts · `MMCA.ADC.Conference.Contracts` · `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/DependencyInjection.cs:15` · Level 10 · class (static, `extension(IServiceCollection)`)

- **What it is**: the composition-root helper a consuming host (Engagement) calls to swap Conference's in-process service registrations for gRPC-backed adapters pointing at the extracted Conference service (`DependencyInjection.cs:10-15`). It exposes two extension methods, one per Conference contract.
- **Depends on**: `AddTypedGrpcClient<T>` from `MMCA.Common.Grpc`; `ServiceCollectionDescriptorExtensions.Replace` and `ServiceDescriptor.Scoped` (Microsoft DI); the two interfaces it rebinds ([ISessionBookmarkValidationService](group-17-conference-domain.md#isessionbookmarkvalidationservice), [IEventLiveValidationService](group-17-conference-domain.md#ieventlivevalidationservice)); the two adapters it binds them to ([SessionBookmarkValidationServiceGrpcAdapter](#sessionbookmarkvalidationservicegrpcadapter), [EventLiveValidationServiceGrpcAdapter](#eventlivevalidationservicegrpcadapter)); the generated client types.
- **Concept introduced: the gRPC adapter-swap pattern via `Replace`.** `[Rubric §7, Microservices Readiness]` (assesses explicit, extractable service contracts, the core of ADR-007 and ADR-008): in the modular monolith the Conference module registers a concrete in-process implementation of each service interface; when Conference runs as its own service the consuming host no longer has that implementation, so instead of rewriting call sites it calls one method here to rebind the interface to a gRPC adapter. `[Rubric §17, DevOps & Deployment]` (assesses how topology changes show up in code): this DI swap is the entire deployment-topology change. `[Rubric §33, Developer Experience]` (assesses convention over configuration): each method defaults `serviceName` to `"conference"` to match the AppHost resource name, so the common call takes no argument.
- **Walkthrough**: the class wraps both methods in one `extension(IServiceCollection services)` block (`:17`). Each method does exactly two things.
  - `AddConferenceSessionValidationClient(string serviceName = "conference")` (`:43`): registers the typed gRPC client with `services.AddTypedGrpcClient<SessionBookmarkValidationService.SessionBookmarkValidationServiceClient>(serviceName)` (`:45`), which wires Aspire service discovery (`http://{serviceName}`), the JWT-forwarding interceptor, and the Polly retry plus circuit-breaker resilience pipeline. Then `services.Replace(ServiceDescriptor.Scoped<ISessionBookmarkValidationService, SessionBookmarkValidationServiceGrpcAdapter>())` (`:49`), and returns `services` for chaining (`:51`).
  - `AddConferenceEventLiveValidationClient(string serviceName = "conference")` (`:73`): the identical shape for the event-live pair (`:75-81`).
  - The critical choice is `Replace` rather than `TryAdd`, documented at length in the doc-comments and inline notes (`:24-34`, `:47-48`, `:60-69`, `:77-78`): by the time the host calls this, the container already holds either the real in-process implementation (when the Conference module is enabled) or the `DisabledSessionBookmarkValidationService` / `DisabledEventLiveValidationService` stub ([group-17-conference-domain.md#disabledsessionbookmarkvalidationservice](group-17-conference-domain.md#disabledsessionbookmarkvalidationservice) / [group-17-conference-domain.md#disabledeventlivevalidationservice](group-17-conference-domain.md#disabledeventlivevalidationservice)) that [ConferenceModule](#conferencemodule)'s `RegisterDisabledStubs` added. `Replace` wins over both; `TryAdd` would silently lose to whichever binding is already present. The doc-comment (`:36-39`) also fixes the ordering constraint: call these AFTER `ModuleLoader.DiscoverAndRegister(...)` ([ModuleLoader](group-14-module-system-composition.md#moduleloader)) so the in-process or stub registration exists for `Replace` to overwrite.
- **Why it's built this way**: ADR-007 (gRPC extraction): consumer modules keep their interface dependency and the composition root does the swap, so extraction is a DI concern rather than an application-code change. Registering the adapter as `Scoped` matches the lifetime of the in-process implementation it replaces, so consumer call sites need no lifetime rethink.
- **Where it's used**: Engagement's service host calls both methods after module registration (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:176,181`), since Engagement's live layer consumes both Conference contracts across the boundary.


---
[⬅ ADC Conference - Infrastructure & Persistence](group-19-conference-infrastructure.md)  •  [Index](00-index.md)  •  [ADC Conference - UI ➡](group-21-conference-ui.md)
