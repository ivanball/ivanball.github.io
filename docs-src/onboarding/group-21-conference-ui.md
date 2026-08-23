# 21. ADC Conference - UI

**What this chapter covers.** This is the **consumer half** of the "write-once UI, render everywhere" story ([primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)): the Blazor pages and per-page HTTP services that turn the Conference REST surface ([G20](group-20-conference-api-grpc.md)) into the screens an organizer, a speaker, a sponsor, or an anonymous attendee actually touches. Everything here lives in the per-module Razor Class Library `MMCA.ADC.Conference.UI` (under `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/`, the path all `File:line` citations below are relative to), which, like every consumer UI, assembles the reusable primitives taught in [G15 (Common UI Framework)](group-15-common-ui-framework.md) into concrete pages. There is almost no new *infrastructure* here: the value is in seeing how a real, twelve-area feature surface (events, sessions, speakers, conference categories and their items, questions, rooms, sponsors, activities, feedback moderation, public browsing, session selection, and the conference landing page) is *composed* from the framework's list-page base, typed HTTP service base, device-capability abstractions, and module system. The headline lens is `[Rubric §18, UI Architecture & Component Design]`, which assesses component reuse, separation of presentation from data access, and a coherent composition model. Because the same Razor components compile into the Blazor Server, WebAssembly, and .NET MAUI hybrid heads, this one library renders the conference across web, Android, iOS, macOS, and Windows with no per-platform reimplementation. `[Rubric §22, Responsive & Cross-Browser/Device]`.

## The layering inside the UI: a page never touches HttpClient

Each page is a `.razor` + `.razor.cs` code-behind pair that depends only on a *UI service interface*, never on `HttpClient` and never on the API's internals. The nine CRUD-shaped entities (events, sessions, speakers, conference categories, category items, questions, rooms, sponsors, activities) each get a service deriving from Common's [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype) and exposing the [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype) contract: [`EventService`](#eventservice), [`SessionService`](#sessionservice), [`SpeakerService`](#speakerservice), [`ConferenceCategoryService`](#conferencecategoryservice), [`CategoryItemService`](#categoryitemservice), [`QuestionService`](#questionservice), [`RoomService`](#roomservice), [`SponsorService`](#sponsorservice), and [`ActivityService`](#activityservice) (`MMCA.ADC.Conference.UI/Services/EventService.cs:14`, `Services/SessionService.cs:11`, `Services/SpeakerService.cs:13`, `Services/ConferenceCategoryService.cs:11`, `Services/CategoryItemService.cs:11`, `Services/QuestionService.cs:11`, `Services/RoomService.cs:14`, `Services/SponsorService.cs:11`, `Services/ActivityService.cs:11`). They inherit `GetAllAsync`/`GetPagedAsync`/`GetByIdAsync`/`AddAsync`/`UpdateAsync`/`DeleteAsync` and only *add* the handful of bespoke verbs the conference needs. Most add nothing at all: `ActivityService` is a body-less class whose entire job is to bind the `activities` endpoint to `ActivityDTO` and `ActivityIdentifierType` (`MMCA.ADC.Conference.UI/Services/ActivityService.cs:10` to `:14`), and [`IActivityUIService`](#iactivityuiservice) is an equally empty extension of the generic contract (`MMCA.ADC.Conference.UI/Services/IActivityUIService.cs:9`); `SponsorService` and [`ISponsorUIService`](#isponsoruiservice) have exactly the same shape (`Services/SponsorService.cs:10`, `Services/ISponsorUIService.cs:9`).

Three services show where extension goes. `EventService` layers `PublishAsync`, `UnpublishAsync`, and `RefreshFromSessionizeAsync` onto the inherited CRUD (`MMCA.ADC.Conference.UI/Services/EventService.cs:17`, `:32`, `:47`), each routed through the inherited `SendRequestAsync` helper so a back-end `Result.Failure` is unwrapped into a typed, displayable error via [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper) before `EnsureSuccessStatusCode` can throw something contextless; [`EventDetail`](#eventdetail) is the page that calls all three (`MMCA.ADC.Conference.UI/Pages/Event/EventDetail.razor.cs:221`, `:249`, `:304`). `RoomService` *overrides* `AddAsync` to reshape the POST body, because the API's `AddRoomRequest` contract names the key `RoomId` while the DTO calls it `Id` (`MMCA.ADC.Conference.UI/Services/RoomService.cs:17` to `:33`), and adds a two-argument `DeleteAsync` that passes the owning event on the query string (`Services/RoomService.cs:35`). `SpeakerService` adds `LinkUserAsync`/`UnlinkUserAsync` for binding a speaker record to an identity account (`MMCA.ADC.Conference.UI/Services/SpeakerService.cs:16`, `:31`). `[Rubric §3, Clean Architecture]` and `[Rubric §9, API & Contract Design]`: the page binds to a DTO contract ([`EventDTO`](group-17-conference-domain.md#eventdto), [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), [`SponsorDTO`](group-17-conference-domain.md#sponsordto), [`ActivityDTO`](group-17-conference-domain.md#activitydto)) and an interface, and the wire envelope is the uniform [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) / [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt) the API returns for every entity. Each entity also gets its own per-feature interface, [`IEventUIService`](#ieventuiservice), [`ISessionUIService`](#isessionuiservice), [`ISpeakerUIService`](#ispeakeruiservice), [`IConferenceCategoryUIService`](#iconferencecategoryuiservice), [`ICategoryItemUIService`](#icategoryitemuiservice), [`IQuestionUIService`](#iquestionuiservice), [`IRoomUIService`](#iroomuiservice), `ISponsorUIService`, and `IActivityUIService`, which extends the generic contract and declares only that entity's extra verbs.

## The list pages: derive from DataGridListPageBase<TDto>, get everything for free

Eleven list screens, the organizer [`EventList`](#eventlist), [`SessionList`](#sessionlist), [`SpeakerList`](#speakerlist), [`ConferenceCategoryList`](#conferencecategorylist), [`QuestionList`](#questionlist), [`RoomList`](#roomlist), [`SponsorList`](#sponsorlist), [`ActivityList`](#activitylist), and the public [`PublicEventList`](#publiceventlist), [`PublicSessionList`](#publicsessionlist), [`PublicSpeakerList`](#publicspeakerlist), inherit [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) (`MMCA.ADC.Conference.UI/Pages/Event/EventList.razor.cs:16`, `Pages/Session/SessionList.razor.cs:18`, `Pages/Speaker/SpeakerList.razor.cs:19`, `Pages/ConferenceCategory/ConferenceCategoryList.razor.cs:11`, `Pages/Question/QuestionList.razor.cs:11`, `Pages/Room/RoomList.razor.cs:12`, `Pages/Sponsor/SponsorList.razor.cs:19`, `Pages/Activity/ActivityList.razor.cs:19`, `Pages/Public/PublicEventList.razor.cs:30`, `Pages/Public/PublicSessionList.razor.cs:25`, `Pages/Public/PublicSpeakerList.razor.cs:35`). That base supplies server-side paging against `MudDataGrid<T>`, cancellation lifecycle, loading and load-failed state, filter and sort extraction from MudBlazor's `GridState<T>`, `ISnackbar` error surfacing, saved page/rows-per-page/scroll restoration, and viewport-driven mobile rendering that swaps the grid for a [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem). A concrete page therefore reduces to overriding `Title`, `GridRef`, `SaveFilters`/`RestoreFilters`, and a `LoadServerData` delegate that calls its service's `GetPagedAsync` and folds in page-specific filters. `MMCA.ADC.Conference.UI/Pages/Event/EventList.razor.cs:48` is the roughly ten-line canonical example, with the mobile path reusing the same service call through `FetchMobilePage` (`Pages/Event/EventList.razor.cs:60`) and delete-with-confirmation delegated to the shared [`ListPageActions`](group-24-identity-module.md#listpageactions) helper (`Pages/Event/EventList.razor.cs:72`). `ActivityList` shows the next increment of the same recipe: it resolves a default event filter before the grid's first fetch by starting the lookup in `OnInitializedAsync` and awaiting that task inside `LoadServerData` (`Pages/Activity/ActivityList.razor.cs:77`, awaited at `:136`), persists the choice with an explicit `"all"` sentinel so an intentional clear is distinguishable from no saved state (`Pages/Activity/ActivityList.razor.cs:50`), and drops a restored id that no longer exists back to the computed default (`Pages/Activity/ActivityList.razor.cs:98` to `:112`). `[Rubric §23, Front-End Performance & Rendering]` (avoiding redundant fetches and round-trips) and `[Rubric §19, State Management & Data Flow]` (paging, sort, and filter state persisted across navigation). This is the "compose, do not repeat" thesis of [G15](group-15-common-ui-framework.md) made concrete eleven times over. Each organizer entity pairs its list with a create page and a detail page in the same shape, a MudBlazor form over the entity's DTO with breadcrumbs, snackbar feedback, and an owned `CancellationTokenSource` disposed with the component: [`EventCreate`](#eventcreate) / [`EventDetail`](#eventdetail) (`Pages/Event/EventCreate.razor.cs:13`, `Pages/Event/EventDetail.razor.cs:15`), [`SessionCreate`](#sessioncreate) / [`SessionDetail`](#sessiondetail) (`Pages/Session/SessionCreate.razor.cs:15`, `Pages/Session/SessionDetail.razor.cs:17`), [`SpeakerCreate`](#speakercreate) / [`SpeakerDetail`](#speakerdetail) (`Pages/Speaker/SpeakerCreate.razor.cs:13`, `Pages/Speaker/SpeakerDetail.razor.cs:19`), [`ConferenceCategoryCreate`](#conferencecategorycreate) / [`ConferenceCategoryDetail`](#conferencecategorydetail) (`Pages/ConferenceCategory/ConferenceCategoryCreate.razor.cs:9`, `Pages/ConferenceCategory/ConferenceCategoryDetail.razor.cs:11`), [`QuestionCreate`](#questioncreate) / [`QuestionDetail`](#questiondetail) (`Pages/Question/QuestionCreate.razor.cs:9`, `Pages/Question/QuestionDetail.razor.cs:11`), [`RoomCreate`](#roomcreate) / [`RoomDetail`](#roomdetail) (`Pages/Room/RoomCreate.razor.cs:9`, `Pages/Room/RoomDetail.razor.cs:12`), plus the sponsor and activity pairs covered below.

Two public lists deliberately opt out of the grid. [`PublicSponsorList`](#publicsponsorlist) and [`PublicActivityList`](#publicactivitylist) are plain `ComponentBase` pages (`MMCA.ADC.Conference.UI/Pages/Public/PublicSponsorList.razor.cs:18`, `Pages/Public/PublicActivityList.razor.cs:19`), because a sponsor roster and an activity programme are bounded (both cap the fetch at 200 rows, `Pages/Public/PublicSponsorList.razor.cs:21`, `Pages/Public/PublicActivityList.razor.cs:22`) and render as tier-grouped logo cards and a chronological programme rather than a sortable table, so each fetches one page and orders it in memory (`Pages/Public/PublicSponsorList.razor.cs:68` to `:86`, `Pages/Public/PublicActivityList.razor.cs:68` to `:85`). A third page splits the difference: [`PublicSpeakerList`](#publicspeakerlist) keeps the base class's page-based mobile fetch path but *appends* each page to an accumulating list and hangs an [`InfiniteScrollSentinel`](#infinitescrollsentinel) below its card grid, twelve cards per chunk so a full chunk fills whole rows (`Pages/Public/PublicSpeakerList.razor.cs:38`, `:40`, next page at `:213`, sentinel rendered at `Pages/Public/PublicSpeakerList.razor:144`). The sentinel itself is the module's one piece of new UI infrastructure: it drives the same shared `_content/MMCA.Common.UI/infinite-scroll.js` IntersectionObserver module `MobileInfiniteScrollList` uses, but owns only the observer, so a page keeps its own card markup, empty state, and error state (`MMCA.ADC.Conference.UI/Components/InfiniteScrollSentinel.razor.cs:21`, observer attach at `:59`, JS-invoked callback at `:46`). Owning the observer in a child component is also what makes the lifecycle correct: a page deriving from `DataGridListPageBase` cannot hook async disposal, while the renderer disposes this component the moment the host stops rendering it, which is exactly when the last page has loaded (`Components/InfiniteScrollSentinel.razor.cs:76` to `:111`).

## Container and presentational split

The behaviour-heavy screens do not keep everything in one code-behind: the page stays the *container* (data fetching, filter and paging state, service calls) and hands rendering to *presentational* children that receive parameters and raise callbacks. `PublicSessionList` is the fullest example, splitting into [`PublicSessionListFilterBar`](#publicsessionlistfilterbar) (organizer event picker or locked chip, debounced title search, room picker, All Sessions / My Schedule toggle, share action, `MMCA.ADC.Conference.UI/Pages/Public/PublicSessionListFilterBar.razor.cs:15`, parameters at `:25` to `:58`) and [`PublicSessionListView`](#publicsessionlistview) (the mobile card list and the desktop grid plus the inline bookmark stars, `Pages/Public/PublicSessionListView.razor.cs:23`). The view exposes `Grid` and `ReloadAsync` back to the page (`Pages/Public/PublicSessionListView.razor.cs:87`, `:90`) so the base class's grid plumbing keeps working unchanged, and it patches the container-owned bookmark dictionary in place when a star is toggled (`Pages/Public/PublicSessionListView.razor.cs:139`, `:154`). The same split shows up on the speaker detail page via [`SpeakerCategoryItemsPanel`](#speakercategoryitemspanel), which raises `Changed` so the page reloads the speaker (`MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerCategoryItemsPanel.razor.cs:31`, invoked at `:73` and `:87`), and on the selection dashboard via [`SessionSelectionSpeakerOverlap`](#sessionselectionspeakeroverlap) and [`SessionSelectionAiScores`](#sessionselectionaiscores), each taking the five filter values as plain parameters (`Pages/SessionSelection/SessionSelectionSpeakerOverlap.razor.cs:15` to `:19`, `Pages/SessionSelection/SessionSelectionAiScores.razor.cs:17` to `:21`). The pure display and filter-matching rules those children share (locality-tier detection, status and score chip colors, score-tier and status predicates) live in the static [`SessionSelectionDisplay`](#sessionselectiondisplay) (`MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionDisplay.cs:11`, helpers at `:13` to `:56`), testable without rendering anything. `[Rubric §18, UI Architecture]` and `[Rubric §28, Front-End Testing]`.

## Child-and-join entities: a thin POST/DELETE base

Sessions, speakers, and events own *join* relationships (a speaker added to a session, a category item to a speaker) that the generic CRUD base cannot model, because the write carries a *parent* id. These get four near-identical services ([`EventSpeakerService`](#eventspeakerservice), [`SessionSpeakerService`](#sessionspeakerservice), [`SessionCategoryItemService`](#sessioncategoryitemservice), [`SpeakerCategoryItemService`](#speakercategoryitemservice)) over the shared, purpose-built [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase), which was **hoisted out of this module into `MMCA.Common.UI`** so every consumer module can reuse it (the note is left in place at `MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:75`). Each Conference join service reduces to supplying its endpoint and adding typed `AddAsync`/`DeleteAsync` wrappers over the base's two verbs (`Services/ChildEntityServices.cs:14`, `:30`, `:46`, `:62`). Their interfaces ([`IEventSpeakerUIService`](#ieventspeakeruiservice), [`ISessionSpeakerUIService`](#isessionspeakeruiservice), [`ISessionCategoryItemUIService`](#isessioncategoryitemuiservice), [`ISpeakerCategoryItemUIService`](#ispeakercategoryitemuiservice)) live together in one file (`MMCA.ADC.Conference.UI/Services/IChildEntityUIService.cs:10`, `:19`, `:28`, `:37`). Note the hard-won detail: the add payload always names the parent explicitly (`new { EventId = eventId, SpeakerId = speakerId }`, `Services/ChildEntityServices.cs:19`), because a controller that binds a `parentId` from the query string will 404 a remove that sends only the child id. `[Rubric §24, Forms, Validation & UX Safety]`.

## Display-enrichment lookups: the GetAll-vs-GetById populator gap, worked around in the UI

Because the API's list endpoints do not always populate every cross-entity navigation, several pages need a cheap id-to-name map to render speaker names beside a session or an event name beside a room, a sponsor, or an activity. Three lookup services fill that role, [`SpeakerLookupService`](#speakerlookupservice), [`EventLookupService`](#eventlookupservice), and [`CategoryItemLookupService`](#categoryitemlookupservice) (behind [`ISpeakerLookupService`](#ispeakerlookupservice), [`IEventLookupService`](#ieventlookupservice), [`ICategoryItemLookupService`](#icategoryitemlookupservice)). Each does one `pageSize=10000` fetch with children and foreign keys suppressed, and folds the result into a `Dictionary` of lightweight projection records, [`SpeakerInfo`](#speakerinfo), [`EventInfo`](#eventinfo), [`CategoryItemInfo`](#categoryiteminfo) (`MMCA.ADC.Conference.UI/Services/SpeakerLookupService.cs:20` and `:28`, `Services/EventLookupService.cs:20` and `:28`, `Services/CategoryItemLookupService.cs:33` and `:42`); the category-item lookup makes a second, unpaged call *first* so each item can carry its owning category's title (`Services/CategoryItemLookupService.cs:19` to `:30`). `EventInfo` is the one projection that grew a feature-specific field: `SponsorshipPacketUrl` is an *optional* trailing parameter defaulting to `null` precisely so the many call sites that need only identity and dates stayed unchanged, and only the public sponsor page reads it (`MMCA.ADC.Conference.UI/Services/IEventLookupService.cs:12` to `:19`, read at `Pages/Public/PublicSponsorList.razor.cs:61`). `PublicSessionList` fetches the speaker lookup once while resolving its event filter (`MMCA.ADC.Conference.UI/Pages/Public/PublicSessionList.razor.cs:182`) and the view joins each session's `SessionSpeakers` against it to display names (`Pages/Public/PublicSessionListView.razor.cs:170` to `:172`). This is a deliberate client-side join over the [navigation-populator](group-11-navigation-populators.md) ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)) gap between the API's list and by-id read shapes.

## Three feature areas that go beyond CRUD

First, the **speaker self-service dashboard**: [`SpeakerDashboard`](#speakerdashboard) is gated on the `speaker_id` JWT claim (read from the cascaded authentication state and parsed as a `Guid`, `MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerDashboard.razor.cs:74`, `:76`) behind a plain `[Authorize]` attribute (`Pages/Speaker/SpeakerDashboard.razor:2`), and shows the linked speaker's sessions for the current or next event, per-session bookmark counts, and feedback, with inline profile editing (BR-214). It leans on [`SpeakerDashboardService`](#speakerdashboardservice) (behind [`ISpeakerDashboardUIService`](#ispeakerdashboarduiservice)), whose session read pushes the speaker filter server-side, caps the page at 100 rows, and appends a per-call cache-bust query parameter so it is a guaranteed miss against the shared sessions output cache and a just-made speaker assignment shows immediately (`MMCA.ADC.Conference.UI/Services/SpeakerDashboardService.cs:20`, `:36`, `:39`), and whose bookmark counts come back from one batched endpoint rather than one cross-service hop per session (`Services/SpeakerDashboardService.cs:55`, consumed at `Pages/Speaker/SpeakerDashboard.razor.cs:117`). It derives from Common's [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) so its calls carry the bearer token and run through the shared retry policy (`Services/SpeakerDashboardService.cs:97`), with a private dispatch helper that unwraps domain failures and treats 404 as "no feedback yet" rather than an error (`Services/SpeakerDashboardService.cs:99` to `:104`). Second, **organizer feedback moderation** (BR-53): [`OrganizerEventFeedback`](#organizereventfeedback) / [`OrganizerSessionFeedback`](#organizersessionfeedback) let organizers review and delete answers via [`OrganizerEventFeedbackService`](#organizereventfeedbackservice) / [`OrganizerSessionFeedbackService`](#organizersessionfeedbackservice) (interfaces [`IOrganizerEventFeedbackUIService`](#iorganizereventfeedbackuiservice) / [`IOrganizerSessionFeedbackUIService`](#iorganizersessionfeedbackuiservice)); organizers get the unscoped server-side view, and each delete passes the parent id explicitly on the query string to satisfy the controller's binding (`MMCA.ADC.Conference.UI/Services/OrganizerFeedbackService.cs:48`, `:95`), unwrapping domain failures through `ServiceExceptionHelper` before throwing (`Services/OrganizerFeedbackService.cs:53`, `:100`). `[Rubric §11, Security]`: the scoping is server-side and the pages carry `[Authorize(Roles = "Organizer")]` (`Pages/Feedback/OrganizerEventFeedback.razor:2`), not a client-side hide. Third, **QR self-service**: [`SpeakerQr`](#speakerqr) renders a full-screen code a speaker can hold up at the podium, with **no backend call at all**, since the speaker comes from the `speaker_id` claim and the payload is built locally, so the page renders identically on the prerender and interactive passes (`MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerQr.razor.cs:49` to `:55`). The payload is always the absolute public URL from [`IPublicLinkBuilder`](#ipubliclinkbuilder), never the WebView-internal origin, or a code scanned off the MAUI head would open for nobody else. The module's own `QrCodeButton` component (`MMCA.ADC.Conference.UI/Components/QrCodeButton.razor`) puts the same capability on five organizer and public print surfaces: sponsor detail (`Pages/Sponsor/SponsorDetail.razor:93`), room detail (`Pages/Room/RoomDetail.razor:56`), public event detail (`Pages/Public/PublicEventDetail.razor:30`), public session detail (`Pages/Public/PublicSessionDetail.razor:41`), and public speaker detail (`Pages/Public/PublicSpeakerDetail.razor:45`).

## Session-selection decision support, the asynchronous edge

The most behaviour-rich page is the organizer-only [`SessionSelectionDashboard`](#sessionselectiondashboard) (`MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionDashboard.razor:2` carries the `Organizer` role attribute), which renders category distribution, speaker overlap, locality breakdown, and AI content-similarity scoring over an event's session pool via [`SessionSelectionService`](#sessionselectionservice) (behind [`ISessionSelectionUIService`](#isessionselectionuiservice)). It defaults the event picker to the live-or-next event through the shared [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (`Pages/SessionSelection/SessionSelectionDashboard.razor.cs:80`) and derives its four filter option lists from the returned [`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto) itself, through the pure projection record [`SessionSelectionFilterOptions`](#sessionselectionfilteroptions) (`Pages/SessionSelection/SessionSelectionDashboard.razor.cs:193`, projection at `Pages/SessionSelection/SessionSelectionFilterOptions.cs:20`). Every load is stamped with a monotonic **generation** rather than an event id, so switching away from an event and back still discards the first response even though both carry the same id: the field is bumped on each selection (`Pages/SessionSelection/SessionSelectionDashboard.razor.cs:36`), snapshotted before the fetch (`:131`), and re-checked before the board is replaced (`:143`), before an error banner is painted (`:165`), and before the spinner is cleared (`:172`). `[Rubric §19, State Management & Data Flow]`.

`GetDashboardAsync` reads that DTO through the inherited retry policy (`MMCA.ADC.Conference.UI/Services/SessionSelectionService.cs:23`); `ScoreSessionsAsync` POSTs to the scoring endpoint and **handles `202 Accepted` explicitly**: because AI scoring of every eligible session can take minutes, the API runs the [`ScoreEventSessionsCommand`](group-18-conference-application.md#scoreeventsessionscommand) in a background scope and returns `202` immediately, so the UI service maps that to a sentinel [`ScoreEventSessionsResultDTO`](group-17-conference-domain.md#scoreeventsessionsresultdto) with `SessionsScored = -1` to signal "started in background" rather than a completed count (`Services/SessionSelectionService.cs:42` to `:45`). The page then starts a fire-and-forget poll loop (`Pages/SessionSelection/SessionSelectionDashboard.razor.cs:215`) on an 8-second cadence held in an `internal` property so a bUnit test can shrink it (`Pages/SessionSelection/SessionSelectionDashboard.razor.cs:246`, loop at `:262`, delay at `:276`), and the decision logic for that loop is factored out into the pure state machine [`ScorePollTracker`](#scorepolltracker), which turns each observation into a [`ScorePollSignal`](#scorepollsignal): keep polling, apply-and-continue, all sessions scored, counts stable long enough, or no scores at all within the zero-progress budget (`Pages/SessionSelection/ScorePollTracker.cs:74`, observed at `Pages/SessionSelection/SessionSelectionDashboard.razor.cs:285`, failures at `:299`, dispatched at `:319`). Its budgets are explicit constants: 225 polls, a 30-minute cap (`Pages/SessionSelection/ScorePollTracker.cs:34`), 5 consecutive fetch failures (`:41`), 10 zero-progress polls (`:48`), and 3 stable polls before completion (`:51`). `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §29, Resilience]`: the fire-and-forget contract is honoured on both sides, transient poll failures are absorbed rather than wedging the Score button, and the dashboard read goes through the retry policy so a blip self-heals.

## Public versus authenticated rendering, and the device-capability path

A recurring `[Rubric §11, Security]` pattern: the same conference entity is exposed through *two* page families. The public family ([`PublicEventList`](#publiceventlist)/[`PublicEventDetail`](#publiceventdetail), [`PublicSessionList`](#publicsessionlist)/[`PublicSessionDetail`](#publicsessiondetail), [`PublicSpeakerList`](#publicspeakerlist)/[`PublicSpeakerDetail`](#publicspeakerdetail), [`PublicSponsorList`](#publicsponsorlist), [`PublicActivityList`](#publicactivitylist)) carries no `@attribute [Authorize]` at all and is output-cached at the API; the organizer family gates on the `Organizer` role in markup (`MMCA.ADC.Conference.UI/Pages/Event/EventList.razor:2`). `PublicSessionList` shows the nuance well. It is read-only for anonymous users (BR-43), but an authenticated user gets inline bookmark stars and a My Schedule toggle wired through the *optional* [`ISessionBookmarkUIService`](group-22-engagement-module.md#isessionbookmarkuiservice); because Blazor's `[Inject]` has no optional mode (an unregistered service throws at render), the page declares that dependency as a nullable property and resolves it via `IServiceProvider.GetService` (`Pages/Public/PublicSessionList.razor.cs:38`, resolved at `:126`), so it stays null when the Engagement module is disabled. `[Rubric §7, Microservices Readiness]`. Non-organizers are always locked server-side to the computed current or next event via [`CurrentEventDefaults`](group-17-conference-domain.md#currenteventdefaults) and the privileged-reader list [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience), so a shared organizer URL cannot pin an attendee to a different or unpublished event (`Pages/Public/PublicSessionList.razor.cs:161`, `:203`, `:210`). The room picker costs no extra fetch: [`PublicScheduleRoomOptions`](#publicscheduleroomoptions) scopes the rooms the already-loaded events carry, de-duplicates and orders them, and clears a room filter the newly scoped list no longer offers rather than leaving it filtering out everything (`Pages/Public/PublicScheduleRoomOptions.cs:21` to `:41`, called at `Pages/Public/PublicSessionList.razor.cs:195`). My Schedule is a true server-side paged fetch, scoping the query with an `Id IN (...)` filter over the bookmarked ids rather than over-fetching and filtering in memory (`Pages/Public/PublicSessionList.razor.cs:317`).

The page also participates in the device-capability layer ([G26](group-26-device-capability-layer.md), [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)): the last successful first page is written to [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore) as a [`CachedSessionPage`](#cachedsessionpage) record and replayed when [`IConnectivityStatusService`](group-26-device-capability-layer.md#iconnectivitystatusservice) reports offline (`MMCA.ADC.Conference.UI/Pages/Public/PublicSessionList.razor.cs:342`, `:351`, record at `:366`), the star toggle fires [`IHapticFeedbackService`](group-26-device-capability-layer.md#ihapticfeedbackservice) (`Pages/Public/PublicSessionListView.razor.cs:113`), the filter bar shares a schedule screenshot through [`IScreenshotService`](group-26-device-capability-layer.md#iscreenshotservice) and [`IShareService`](group-26-device-capability-layer.md#ishareservice) (`Pages/Public/PublicSessionListFilterBar.razor.cs:65` to `:69`), the public activity page opens directions through [`IMapNavigationService`](group-26-device-capability-layer.md#imapnavigationservice), which launches the platform maps app on native heads and a maps site in a browser tab otherwise (`Pages/Public/PublicActivityList.razor.cs:109`), and `/conference/sessions?mine=true` is a deep link the MAUI head's home-screen quick action targets (`Pages/Public/PublicSessionList.razor.cs:67`). Each of those is a no-op on the web heads, so one page serves both worlds. `[Rubric §29, Resilience]` and `[Rubric §22, Responsive & Cross-Browser/Device]`.

## Sponsors and activities, two feature areas in miniature

The sponsor surface is worth reading as a compact tour of every pattern above. Organizers manage the roster through [`SponsorList`](#sponsorlist) / [`SponsorCreate`](#sponsorcreate) / [`SponsorDetail`](#sponsordetail): the list is a plain `DataGridListPageBase<SponsorDTO>` whose event filter defaults to the current or next event and persists across navigation (`MMCA.ADC.Conference.UI/Pages/Sponsor/SponsorList.razor.cs:19`, `:44`, `:54`, `:106`), the create page offers the [`SponsorTier`](group-17-conference-domain.md#sponsortier) values in package order straight off `Enum.GetValues` and defaults the event the same way (`Pages/Sponsor/SponsorCreate.razor.cs:18`, `:56`), and the detail page edits every field *except* the owning event, on the stated rationale that moving a sponsorship between events is a create plus a delete (`Pages/Sponsor/SponsorDetail.razor.cs:10` to `:13`), resolving the event name through the shared `EventLookupService` (`Pages/Sponsor/SponsorDetail.razor.cs:100`). Attendees see the same data twice. `PublicSponsorList` resolves the featured event, filters the roster to it, and groups by tier ascending (package order) then by `Sort` and name, so the render order is deterministic rather than insertion-dependent (`Pages/Public/PublicSponsorList.razor.cs:44` to `:86`); when the roster is empty it falls back to the sponsorship call to action, and when the event publishes no packet URL that call to action is hidden entirely rather than offering a dead link (`Pages/Public/PublicSponsorList.razor.cs:36`, `:61`). [`ADCHome`](#adchome) renders the same roster as a logo strip using the same tier-then-sort-then-name rule (`Pages/Home/ADCHome.razor.cs:225` to `:234`), filtering client-side to the featured event so a second published edition's sponsors cannot bleed onto the landing page (`Pages/Home/ADCHome.razor.cs:228`), and any failure leaves the list empty and the call to action standing (`Pages/Home/ADCHome.razor.cs:236` to `:243`). Because that page reads the anonymous endpoint directly rather than through a typed service, its wire shapes are private records on the component itself: [`ADCSponsorCollectionResult`](#adcsponsorcollectionresult) and [`ADCSponsorInfo`](#adcsponsorinfo) (`Pages/Home/ADCHome.razor.cs:311`, `:313`).

The activities area (the social programme: pre-conference party, coffee connect, after-party, closing ceremony) is the newest and repeats the shape with two twists. [`ActivityCreate`](#activitycreate), [`ActivityDetail`](#activitydetail), and `ActivityList` are the organizer trio, with the create page defaulting the owning event to the current or next one and deriving the start and end defaults from that event's dates (`MMCA.ADC.Conference.UI/Pages/Activity/ActivityCreate.razor.cs:51`, `:58`). Because `EventId` is a real Activity column, the list's event filter needs no virtual-key resolution and goes straight through the generic filter pipeline (`Pages/Activity/ActivityList.razor.cs:150`), unlike the speaker list, whose event filter travels as a virtual key resolved server-side through the join tables (`Pages/Public/PublicSpeakerList.razor.cs:21` to `:22`). `PublicActivityList` renders the same programme chronologically for attendees, ordering by start time, then display order, then name so ties are deterministic (`Pages/Public/PublicActivityList.razor.cs:79` to `:85`), and offers the directions affordance for an activity that carries its own off-site venue (`Pages/Public/PublicActivityList.razor.cs:101`).

## The landing page

`ADCHome` is the conference front door, shared by the web and MAUI heads; both serve the editorial images from their own site root today, so neither overrides the `ImageBasePath` parameter (`MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:51`). It fetches the events list through the named `"APIClient"` and features the live-or-next published event via `CurrentEventSelector` (`Pages/Home/ADCHome.razor.cs:176`, `:180`), deserializing into two more private API models, [`ADCCollectionResult`](#adccollectionresult) and [`ADCEventInfo`](#adceventinfo) (`Pages/Home/ADCHome.razor.cs:297`, `:299`). Three rendering decisions are worth internalizing. First, during SSR prerender it skips the backend fetch and the timer entirely and renders the static fallback, because an untimed server-side call to a cold backend would block the prerender and therefore the post-login navigation (`Pages/Home/ADCHome.razor.cs:116`). Second, the per-second countdown ticking lives in a child component behind a render fence, so this page arms only a single one-shot `Timer` for the Live-to-Ended flip (`Pages/Home/ADCHome.razor.cs:126`, armed at `:128`), classifying the moment into the [`EventPhase`](#eventphase) enum Upcoming/Live/Ended from the event's own time zone and going through `CurrentEventSelector.ToUtc` so the spring-forward gap at a midnight boundary cannot throw out of the render path (`Pages/Home/ADCHome.razor.cs:246` to `:275`). Third, the fallback date is a named constant with an explicit warning that it must track the published event date, since a stale value makes the hero date and the countdown visibly jump once the real event loads (`Pages/Home/ADCHome.razor.cs:40`). `[Rubric §23, Front-End Performance & Rendering]`. The editorial content it renders (the keynote, the eight-track catalog, and the two pre-conference workshops) is held as static records, [`KeynoteSpeakerInfo`](#keynotespeakerinfo), [`ConferenceTrackInfo`](#conferencetrackinfo), and [`PreConferenceWorkshopInfo`](#preconferenceworkshopinfo) (`Pages/Home/ADCHome.razor.cs:371`, `:372`, `:379`, data at `:325`, `:336`, and `:359`); the workshop record carries only proper nouns plus a resource-key stem, so its audience and description lines stay localized (`Pages/Home/ADCHome.razor.cs:356` to `:358`).

## Routes, navigation, and localized strings

All paths are centralized in [`ConferenceRoutePaths`](#conferenceroutepaths), a static catalogue of literal routes and id-parameterized builder methods (`EventDetails(id)`, `PublicSessionDetails(id)`, `SponsorDetails(id)`, `ActivityDetails(id)`, `EventFeedbackOrganizer(id)`, and so on) typed against the module's identifier aliases and formatted culture-invariantly; pages navigate with `NavigationManager.NavigateTo(ConferenceRoutePaths.EventDetails(id))` rather than hand-building URL strings, so a route change happens in one file (`MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:10` to `:68`). Two entries in that file are deliberate duplicates of routes **owned by Engagement.UI**, `SponsorVisitLink` and `RoomCheckInLink` (`ConferenceRoutePaths.cs:60`, `:61`), because Conference.UI must not reference Engagement.UI yet the organizer print surfaces need those links to encode into a QR; the reason is recorded inline at `ConferenceRoutePaths.cs:56` to `:59`. `[Rubric §25, Navigation, Routing & Information Architecture]`. Public share links are built through the injectable `IPublicLinkBuilder`, whose default [`NavigationPublicLinkBuilder`](#navigationpubliclinkbuilder) resolves against the browser origin (`MMCA.ADC.Conference.UI/Services/NavigationPublicLinkBuilder.cs:19`), with the MAUI head overriding the registration after module registration so shared links always point at the web app (`MMCA.ADC.Conference.UI/DependencyInjection.cs:46` to `:49`). User-facing strings are **not** inline English: every page injects an `IStringLocalizer<TPage>` in its markup (`Pages/Event/EventList.razor:5`) and resolves labels and snackbar messages through `L["..."]` over co-located `.resx` resources, including format patterns such as the hero date layout so month names follow the selected culture (`Pages/Home/ADCHome.razor.cs:284`). Where a string is deliberately left untranslated (the conference brand name, a postal address, a ticketing URL, the English-only editorial content) the code carries an explicit `// i18n: allow` marker with a reason (`Pages/Home/ADCHome.razor.cs:31`, `:79`, `:83`, `:323`). `[Rubric §27, Internationalization & Localization]` assesses externalized strings and culture-aware formatting; this area embodies it under [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html), which superseded the single-locale [ADR-011](https://ivanball.github.io/docs/adr/011-single-locale-i18n.html) ([primer §6](00-primer.md#6-the-34-category-architecture-evaluation-lens)).

## How it all plugs into the shell

Two registration types wire the area in. [`ConferenceUIModule`](#conferenceuimodule) implements Common's [`IUIModule`](group-15-common-ui-framework.md#iuimodule) (the front-end counterpart of the [`IModule`](group-14-module-system-composition.md#imodule) back-end contract): it declares the module's sixteen [`NavItem`](group-15-common-ui-framework.md#navitem) entries, whose labels are [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) resource *keys* (`Nav.Events`, `Nav.Dashboard`, and so on) each carrying a `TitleResource` so the shared NavMenu localizes them at render time against the co-located `ConferenceUIModule.resx` pair (`MMCA.ADC.Conference.UI/ConferenceUIModule.cs:18` to `:41`). Those sixteen split three ways: five public entries for everyone, Events, Sessions, Speakers, Sponsors, and Activities (`ConferenceUIModule.cs:21` to `:25`), two `speaker_id`-claim-gated entries in the user section, the dashboard and the speaker's own QR (`ConferenceUIModule.cs:28`, `:29`), and an `Organizer`-role-gated admin group of nine, Events, Sessions, Speakers, Categories, Questions, Rooms, Sponsors, Activities, and Session Selection (`ConferenceUIModule.cs:32` to `:40`); it then exposes its assembly so the host can discover the Razor routes (`ConferenceUIModule.cs:43`). The companion [`DependencyInjection`](#dependencyinjection) extension `AddConferenceUI()` (a C# `extension(IServiceCollection)` member, [primer §4](00-primer.md#c-extensiont-types-read-this-once)) is the one call a host makes (`MMCA.ADC.Conference.UI/DependencyInjection.cs:19`): it delegates the two-step prologue to Common's `AddUIModule<ConferenceUIModule>()`, which Scrutor-scans the module assembly for every `IEntityService<,>` implementation as scoped and registers the descriptor as a singleton `IUIModule` (`DependencyInjection.cs:23`, implementation at `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:152` to `:162`), then explicitly registers the four child-entity services (`DependencyInjection.cs:26` to `:29`), the speaker dashboard (`:32`), the two organizer feedback services (`:35`, `:36`), session selection (`:39`), the three lookup services (`:42` to `:44`), and the public-link builder (`:49`). Because the scan covers the entity services, adding a tenth CRUD entity needs no edit here at all: the Activities area added `ActivityService` with no line in this file. And because the module contributes its own nav and assembly, the shell folds it in with no edit to the shell either. `[Rubric §1, SOLID]` (Open/Closed) and `[Rubric §18, UI Architecture]`. Read the per-type sections that follow for the mechanics of each page and service; the bUnit and Playwright tests that exercise this library live in the testing chapter ([G27](group-27-testing-infrastructure.md)).

### ADCEventInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:299` · Level 0 · record (sealed, private)

- **What it is**: the deserialization-only projection of one published event as the landing page needs it. It is declared `private sealed record` inside [ADCHome](#adchome) (`:299`), so it is not a shared contract: it exists purely to give `System.Text.Json` a shape to bind the `events` response into.
- **Depends on**: no first-party types. BCL only (`DateOnly` for the two dates).
- **Concept introduced: the page-local wire model.** [Rubric §9, API and Contract Design] assesses whether consumers bind to explicit, minimal contracts rather than reaching for the server's internal types. The landing page needs ten fields (`Id`, `Name`, `Description?`, `StartDate`, `EndDate`, `TimeZone`, `VenueAddress?`, `VenueMapUrl?`, `SponsorshipPacketUrl?`, `TicketingUrl?`, `:299-309`) out of the much larger event DTO the API serves, so it declares exactly those and lets the serializer ignore the rest. Because the record is private to the component, no other page can accidentally couple to it; a second consumer declares its own projection. Every optional field is nullable, which is what lets the page fall back to hard-coded defaults without null checks scattered through the markup.
- **Walkthrough**: a positional record with no methods. `Name` feeds the `EventName` property and therefore `HeroTitleParts()` (`:79`, `:93`); `Description` feeds `EventDescription`, falling back to the localized `Fallback.EventDescription` resource (`:81`); `StartDate`/`EndDate`/`TimeZone` are the three inputs `UpdateCountdown()` converts into the UTC live window (`:248-252`); `VenueAddress` backs the venue block and the Google Maps search URL (`:83-86`); `Id` is the filter key that keeps a second published edition's sponsors off the page (`:228`); `SponsorshipPacketUrl` gates the whole sponsorship call to action block, heading and button included (`ADCHome.razor:310-329`); `TicketingUrl` gates the hero's "get tickets" button the same way (`ADCHome.razor:71-79`), so an event that has not opened sales renders no button rather than a dead link.
- **Why it's built this way**: the page must render before, during, and after the API call, so it stores a single nullable `ADCEventInfo? _event` (`:65`) and every derived property is written as `_event?.X ?? <default>`. One nullable field is the whole "loaded or not" state machine, with no extra flags. The two ticketing surfaces sit on opposite sides of that line: the conference-day button reads the event field, while the pre-conference workshop button reads the fixed `PreConferenceTicketingUrl` constant (`:30-31`), because the workshop day sells through its own TicketLeap page.
- **Where it's used**: the `Items` list of [ADCCollectionResult](#adccollectionresult) (`:297`), selected by `CurrentEventSelector.SelectCurrentOrNext` in `LoadEventAsync` (`:180-185`), used as the sponsor filter key in `LoadSponsorsAsync` (`:213`, `:228`), and read by every derived display property on [ADCHome](#adchome).
- **Caveats / not-in-source**: `VenueMapUrl` is bound from the wire (`:307`) but never read by this page: the map button builds its own Google Maps search URL from `VenueAddress` instead (`:85-86`, `ADCHome.razor:353-363`). The field is a real event column, edited and displayed on the organizer event page (`MMCA.ADC.Conference.UI/Pages/Event/EventDetail.razor:68-69`, `:131`); why the landing page projects it without using it is not determinable from source.

### ConferenceRoutePaths
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI` · `MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:8` · Level 0 · class (static)

- **What it is**: one static class holding every Conference UI route, as `public static readonly string` constants for fixed paths and small factory methods for id-bearing paths. It covers the organizer management routes, the public attendee routes, the speaker surfaces, and the two QR landing links, so no `@page` directive or `NavigateTo` call has to hard-code a URL.
- **Depends on**: no first-party types. It uses the module's identifier aliases (`EventIdentifierType`, `SessionIdentifierType`, `SpeakerIdentifierType`, `ConferenceCategoryIdentifierType`, `QuestionIdentifierType`, `RoomIdentifierType`, `SponsorIdentifierType`, `ActivityIdentifierType`) that the Conference Shared project declares as `global using` (see the primer on identifier-type aliases), plus `System.Globalization.CultureInfo` (`:1`).
- **Concept introduced: a centralized navigation vocabulary.** [Rubric §25, Navigation and Information Architecture] assesses whether routes form a coherent, role-aware information architecture instead of scattered magic strings; this class is that story in miniature. The paths split into two deliberate namespaces mirroring the module's two audiences: organizers work under bare prefixes (`/events` `:10`, `/sessions` `:14`, `/speakers` `:18`, `/conferencecategories` `:22`, `/questions` `:26`, `/rooms` `:30`, `/sponsors` `:34`, `/activities` `:38`) while attendees work under a `/conference/...` prefix (`PublicSessions` `:43`, `PublicEvents` `:44`, `PublicSpeakers` `:47`, `PublicSponsors` `:49`, `PublicActivities` `:50`). Detail routes are methods rather than constants because they interpolate a typed id: `EventDetails(EventIdentifierType id)` (`:12`) builds `/events/{id}` with `string.Create(CultureInfo.InvariantCulture, ...)` so an integer id can never be formatted with a culture-specific group separator. [Rubric §27, Internationalization] shows up here as the negative case: URLs are the one place culture-aware formatting must be suppressed.
- **Walkthrough**: the file is a flat list grouped by entity, each group contributing a list route, a create route, and a details factory: events (`:10-12`), sessions (`:14-16`), speakers (`:18-20`), conference categories (`:22-24`), questions (`:26-28`), rooms (`:30-32`), sponsors (`:34-36`), activities (`:38-40`). The public attendee block follows (`:42-50`), then the speaker surfaces `SpeakerDashboard` and `SpeakerQr` (`:52-54`), two QR self-service links, the organizer feedback factories, and the selection dashboard.
  - **The two QR links are deliberate duplicates** (`:60-61`). `SponsorVisitLink` and `RoomCheckInLink` build `/engage/sponsors/{id}` and `/engage/rooms/{id}`, but those two pages are owned by Engagement.UI. The comment (`:56-59`) records the reason: Conference.UI must not reference Engagement.UI, yet the organizer print surfaces need the URL to encode into a QR code, and [EngagementRoutePaths](group-22-engagement-module.md#engagementroutepaths) duplicates a Conference session route the same way. Both are consumed by a `QrCodeButton` on the sponsor and room detail pages (`MMCA.ADC.Conference.UI/Pages/Sponsor/SponsorDetail.razor:93`, `MMCA.ADC.Conference.UI/Pages/Room/RoomDetail.razor:56`).
  - **Feedback routes nest under their parent entity**: `EventFeedbackOrganizer` gives `/events/{id}/feedback` and `SessionFeedbackOrganizer` gives `/sessions/{id}/feedback` (`:64-65`), so the URL itself expresses the ownership hierarchy. `SessionSelectionDashboard` closes the file (`:68`).
  - Two factories differ from the rest: `SpeakerDetails` (`:20`) and `PublicSpeakerDetails` (`:48`) use plain interpolation rather than `string.Create(CultureInfo.InvariantCulture, ...)`, because `SpeakerIdentifierType` is a `Guid` whose `ToString()` is already culture-invariant.
- **Why it's built this way**: if the admin prefix ever moves (say `/events` becomes `/admin/events`), editing the one constant propagates the change to every navigation call, with no grep-and-replace and no risk of a stale link. Keeping the parameterized routes as methods typed against the identifier aliases means a wrong-entity id is a compile error, not a 404.
- **Where it's used**: every Conference UI Blazor page's `@page` directive and `NavigationManager.NavigateTo` call (for example `MMCA.ADC.Conference.UI/Pages/Sponsor/SponsorDetail.razor.cs:226`), the "see all sponsors" link on the landing page (`ADCHome.razor:303`), the `NavItems` collection in [ConferenceUIModule](#conferenceuimodule) (`ConferenceUIModule.cs:21-40`), and even one Engagement page, which links back to `PublicSponsors` (`MMCA.ADC.Engagement.UI/Pages/Sponsors/SponsorVisit.razor:42`).

### ConferenceTrackInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:372` · Level 0 · record (sealed, private)

- **What it is**: one row of the landing page's track catalogue: a track `Name`, an `Icon` (a MudBlazor icon path constant), and a `Topics` string listing the track's subject areas.
- **Depends on**: no first-party types. The `Icon` values are MudBlazor `Icons.Material.Filled.*` constants (external).
- **Concept introduced**: this is one of three static-content records on the landing page; the pattern is introduced under [KeynoteSpeakerInfo](#keynotespeakerinfo) and reused by [PreConferenceWorkshopInfo](#preconferenceworkshopinfo).
- **Walkthrough**: a three-property positional record (`:372`). The whole catalogue is a `private static readonly ConferenceTrackInfo[] Tracks` (`:336`) initialized inline as a collection expression (`:337-354`) with eight entries (`:338`, `:340`, `:342`, `:344`, `:346`, `:348`, `:350`, `:352`), each spanning two lines: the track name and its icon constant on the first, the topics blurb on the second. They run from "Foundations (Beginner & Student)" (`:338`) to "Career, Leadership & Community" (`:352`), with the two AI tracks, languages, cross-platform, security, and game/XR in between. Every `Icon` is a MudBlazor `Icons.Material.Filled.*` constant picked per track (`School`, `Psychology`, `AutoAwesome`, `Code`, `Devices`, `Security`, `SportsEsports`, `Groups`). Storing the icon as a `string` (rather than a `RenderFragment` or an enum) is what keeps the record a plain data type: the markup passes it straight to `<MudIcon Icon="@track.Icon">` (`ADCHome.razor:237`).
- **Why it's built this way**: the track list changes once per conference cycle and is editorial rather than transactional, so it lives in the assembly instead of behind an API call or a CMS; the `// i18n: allow` marker above the block names "the track catalog" alongside the keynote bio as deliberately English-only editorial content (`:323-324`). The array is `static readonly`, so it is allocated once per process, not per render.
- **Where it's used**: the `Tracks` array on [ADCHome](#adchome) (`:336`), rendered as the track grid in `ADCHome.razor` (`:229-246`): one `MudItem`/`MudCard` per entry, keyed by `track.Name` (`ADCHome.razor:232`), showing the icon (`:237`), the name (`:239`), and the topics line (`:241`).

### EventPhase
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:72` · Level 0 · enum (private)

- **What it is**: the three-state classification of the featured event relative to now: `Upcoming`, `Live`, `Ended` (`:72-77`). It is the single switch the landing page's hero renders from.
- **Depends on**: nothing.
- **Concept introduced: deriving a render state from a clock instead of storing it.** [Rubric §19, State Management and Data Flow] assesses whether UI state is derived from a single source of truth or duplicated into flags. There is no `IsLive` boolean anywhere on the page: `UpdateCountdown()` recomputes `_phase` from `DateTime.UtcNow` against the converted UTC window every time it runs (`:269-275`), and the markup branches on that one field. Recomputing rather than storing means a stale phase is impossible after a timer callback, a parameter change, or the interactive render pass that follows prerender.
- **Walkthrough**: the assignment is a switch expression over `now` (`:270-275`): `now < _startUtc` gives `Upcoming`, `now < _endUtc` gives `Live`, anything later gives `Ended`. `ArmPhaseTimerForEventEnd()` reads it as its guard, returning immediately unless the phase is `Live` (`:145-148`), which is what makes the Live-to-Ended timer a single one-shot rather than a recurring tick. In the markup, `Upcoming` renders the `HomeCountdown` child (`ADCHome.razor:36-41`), `Live` renders the "event live" chip plus a button to `/happening-now` (`ADCHome.razor:42-56`), and `Ended` renders the post-event chip (`ADCHome.razor:57-65`). The hero's ticketing button sits outside that branch (`ADCHome.razor:67-80`), so it shows in every phase the event publishes a URL.
- **Why it's built this way**: three named states read far better at the call site than nested date comparisons, and keeping the enum private to the component signals it is a view concern, not a domain concept. The domain's own notion of a live window lives server-side and in [CurrentEventSelector](group-17-conference-domain.md#currenteventselector).
- **Where it's used**: the `_phase` field on [ADCHome](#adchome) (`:64`) and its Razor markup only.

### InfiniteScrollSentinel
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Components` · `MMCA.ADC.Conference.UI/Components/InfiniteScrollSentinel.razor.cs:21` · Level 0 · class (partial component)

- **What it is**: a one-`div` child component that a list page renders below its last item. When that `div` scrolls to within 200px of the viewport, the component raises an `OnVisible` callback so the page can fetch and append its next page. It owns the browser observer and nothing else: the item markup, the fetch, and the accumulated list all stay with the host page.
- **Depends on**: `IJSRuntime` (`:23`), `ElementReference`, `EventCallback`, and `DotNetObjectReference` from Blazor, plus the shared JavaScript module `_content/MMCA.Common.UI/infinite-scroll.js` shipped by `MMCA.Common.UI` (`MMCA.Common.UI/wwwroot/infinite-scroll.js`). No first-party C# types.
- **Concept introduced: the JS-interop observer wrapped as a disposable child component.** [Rubric §23, Front-End Performance and Rendering] assesses whether a UI loads work incrementally instead of rendering everything up front; an `IntersectionObserver` is the browser-native way to do that, and it costs no scroll-event handler and no polling. The interop is two-way: C# imports the module and calls `observe` (`:63-66`), and JavaScript calls back into C# by name through `dotNetRef.invokeMethodAsync('OnSentinelVisible')` (`infinite-scroll.js:8`), which is why the `[JSInvokable]` method's name is fixed and the code comment says so (`:41-44`). Each instance mints its own `_observerId` from a `Guid` (`:34`) so the module's `observers` map can detach exactly this one on teardown (`infinite-scroll.js:1`, `:16-21`).
  The second idea is the *reason it is a separate component at all*, spelled out in the class doc (`:6-19`). The shared `MobileInfiniteScrollList` drives the same JS module (`MMCA.Common.UI/Components/MobileInfiniteScrollList.razor.cs:86`) but also owns the item markup, which a page with its own card grid cannot use. And a page deriving from [DataGridListPageBase<TDto>](group-15-common-ui-framework.md#datagridlistpagebasetdto) cannot hook async disposal to detach an observer, because that base's `DisposeAsync` is not virtual (`MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:725`). Putting the observer in a child solves both: the renderer disposes the child the moment the host stops rendering it, which is exactly when the last page has loaded. [Rubric §1, SOLID] is the underlying move, single responsibility applied to a lifecycle rather than to data.
- **Walkthrough**:
  - **Parameters** (`:26-32`): `OnVisible` is the `EventCallback` the host binds its load-more method to, `IsLoading` renders the inline progress row while that fetch is in flight, and `LoadingLabel` is the accessible name for it, localized by the host per [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html).
  - **State** (`:34-39`): the per-instance `_observerId`, the `ElementReference` bound with `@ref` in the markup (`InfiniteScrollSentinel.razor:4`), the imported `IJSObjectReference`, the `DotNetObjectReference<InfiniteScrollSentinel>`, and two flags, `_observing` and `_disposed`.
  - **`OnSentinelVisible`** (`:45-47`): the `[JSInvokable]` entry point. It short-circuits to `Task.CompletedTask` when already disposed, otherwise marshals onto the renderer's synchronization context with `InvokeAsync` before raising `OnVisible`. Both halves matter: the call arrives from a JS callback on an arbitrary context, and a disposed component must not raise into a torn-down host.
  - **`OnAfterRenderAsync`** (`:49-57`): attaches on `firstRender` only, and only when not disposed. Attaching after render is required because `_sentinelRef` is not populated until the element exists.
  - **`AttachObserverAsync`** (`:59-74`): imports the module lazily with `??=`, creates the `DotNetObjectReference` the same way, calls `observe` with the reference, the element, and the id, then sets `_observing`. It catches `JSDisconnectedException` and does nothing, with the comment recording the consequence (`:71-72`): during prerendering or circuit teardown there is no JS to talk to, so the list simply stops at the pages already loaded rather than failing the render.
  - **`DisposeAsync`** (`:76-111`): `GC.SuppressFinalize` first, then an idempotency guard on `_disposed`, then a best-effort detach: `unobserve` only if the observer was actually attached, then `DisposeAsync` on the module. Two catch arms swallow `JSDisconnectedException` (circuit already gone) and `JSException` (shutdown-time interop races), and the `finally` always disposes the `DotNetObjectReference` so the managed reference cannot leak even when interop fails.
  - **Markup** (`InfiniteScrollSentinel.razor:1-14`): the sentinel `div`, and inside it, only while `IsLoading`, a `MudProgressCircular` in a wrapper carrying `role="status"`, `aria-live="polite"`, and `aria-busy="true"` (`:9`). [Rubric §21, Accessibility]: the comment states the intent (`:7-8`), a screen reader hears that more items are loading without the announcement interrupting reading, matching `PageLoadingState`'s politeness, and the spinner carries the host's localized `aria-label` (`:11`). The class names are the shared ones from `MMCA.Common.UI`'s stylesheet, so the sentinel looks identical here and inside `MobileInfiniteScrollList` (`InfiniteScrollSentinel.razor:1-3`).
- **Why it's built this way**: the host must render the sentinel **only while more pages exist**, which the class doc states as a usage contract (`:18-19`). That is not just an optimization: absence of the sentinel is what stops the observer from firing at the end of the list, and a filter reset that refills the list gets a fresh instance and therefore a fresh observer. [Rubric §16, Maintainability]: the contract is one line of markup at the call site rather than a `Reset()` method on this component.
- **Where it's used**: the public speaker card grid, [PublicSpeakerList](#publicspeakerlist), which renders it under `@if (HasMoreSpeakers)` and binds `OnVisible` to its `LoadMoreSpeakersAsync` (`MMCA.ADC.Conference.UI/Pages/Public/PublicSpeakerList.razor:133-146`). The comment there records the same contract from the host's side (`:131-132`): the sentinel exists only while pages remain, so its absence is the "everything is loaded" signal for the reader and for the tests. When a load fails, the page swaps the sentinel for an error row with a retry button (`:135-141`), which also detaches the observer until the reader asks again.

### KeynoteSpeakerInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:371` · Level 0 · record (sealed, private)

- **What it is**: the keynote block's content: the speaker's `Name`, `Title` (their role), the `TalkTitle`, an optional `PhotoFileName`, and `BioParagraphs` as a `string[]` (`:371`).
- **Depends on**: no first-party types. BCL only.
- **Concept introduced: the two-tier content model of a landing page.** The page splits its content into *dynamic* data fetched from the API (dates, venue, name, ticketing link, sponsors, via [ADCEventInfo](#adceventinfo) and [ADCSponsorInfo](#adcsponsorinfo)) and *editorial* data compiled into the assembly (keynote, tracks, and workshops, via this record and its siblings [ConferenceTrackInfo](#conferencetrackinfo) and [PreConferenceWorkshopInfo](#preconferenceworkshopinfo)). [Rubric §23, Front-End Performance and Rendering] is the payoff: the keynote, the workshop cards, and the track grid render on the first frame with zero network dependency, so a cold or unreachable backend degrades only the countdown, the hero ticketing button, and the sponsor strip, never the page. [Rubric §27, Internationalization] is the deliberate exception: the block carries an explicit `// i18n: allow` marker with a written reason (`:323-324`) recording that this English-only editorial content is the same copy the API would serve, while the chrome around it is localized. That marker convention is how [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) distinguishes "not yet translated" from "intentionally untranslated".
- **Walkthrough**: a five-property positional record (`:371`). The single instance is a `private static readonly KeynoteSpeakerInfo Keynote` initialized inline (`:325-334`): Jared Rhodes, "Microsoft MVP and Principal Engineer", the talk "More Software, Different Work", `PhotoFileName: "jared-rhodes.jpg"` (`:329`), and a three-paragraph biography (`:331-333`). `BioParagraphs` is an array rather than one string so the template can emit each paragraph in its own element instead of relying on whitespace preservation (`ADCHome.razor:199-202`). The record carries only the portrait's *file name*, not a path: the usable `src` is composed from the head-specific `ImageBasePath` parameter through `KeynoteImageSrc`, which returns `$"{ImageBasePath}/speakers/{fileName}"` or `null` when no file name is supplied (`:57-58`). That split exists because a head could package its assets elsewhere, and the `null` case is still guarded in the markup so the card renders name and title without a portrait (`ADCHome.razor:179-192`).
- **Why it's built this way**: the keynote changes once per conference cycle, so a database round-trip and an admin screen would be pure overhead. Keeping it `static readonly` also means it is shared by every circuit on the server head rather than re-allocated per user.
- **Where it's used**: the `Keynote` field on [ADCHome](#adchome) (`:325`), read by `KeynoteImageSrc` (`:57-58`) and rendered in the keynote section of `ADCHome.razor` (`:163-207`).

### PreConferenceWorkshopInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:379` · Level 0 · record (sealed, private)

- **What it is**: one pre-conference workshop card: a resource-key stem `Key`, the workshop `Title`, the `Presenter` name, and an `Icon` (`:379`). Two instances make up the whole workshops section.
- **Depends on**: no first-party types. The `Icon` values are MudBlazor `Icons.Material.Filled.*` constants (external).
- **Concept introduced: the half-localized content record.** [Rubric §27, Internationalization] assesses whether user-facing text resolves through resources rather than sitting in code, and this record is the interesting middle case that the other two content records do not show. Instead of choosing "all in code" or "all in resources", it splits by *kind of string*: proper nouns stay in code with `// i18n: allow` markers (workshop titles `:362`, `:366`; presenter names `:363`, `:367`) because translating a talk title or a person's name would be wrong, while the prose that describes each workshop lives in the `.resx` pair. The bridge is `Key`, documented on the record itself (`:374-378`): the markup composes `Workshops.{Key}.Audience` and `Workshops.{Key}.Description` at render time (`ADCHome.razor:136`, `:139`), and those keys exist in both locales (`ADCHome.resx:26-29`). One consequence worth noticing: adding a workshop means adding four resource entries per locale, and a typo in `Key` fails at runtime as a missing resource rather than at compile time.
- **Walkthrough**: a four-property positional record (`:379`). The catalogue is a `private static readonly PreConferenceWorkshopInfo[] Workshops` (`:359`) with two entries: `"ModularMonolith"` presented by Ivan Ball-llovera with the `Hub` icon (`:361-364`), and `"SoftwareFactory"` presented by Tim Rayburn with the `PrecisionManufacturing` icon (`:365-368`). The comment above the array states the split in one sentence (`:356-358`). The markup renders the array as a two-column grid (`ADCHome.razor:120-145`), keyed by `workshop.Key` (`:123`), each card showing the icon in a circle (`:128`), the title (`:130`), the localized `Workshops.PresenterLabel` formatted with the presenter name (`:132-134`), the audience line (`:135-137`), and the description (`:138-140`).
- **Why it's built this way**: the workshop day runs before the conference day, and the section is placed between the hero and the keynote so the page reads in the same order as the event (`ADCHome.razor:86-88`). Two facts the cards would otherwise repeat, the schedule and the venue, are hoisted into one shared logistics line above the grid (`ADCHome.razor:107-118`), which is why they are resources (`Workshops.Schedule`, `Workshops.Venue`) rather than record fields. Ticketing is the other deliberate asymmetry: the workshop day sells on its own TicketLeap page, so its call to action reads the `PreConferenceTicketingUrl` constant (`:30-31`) and always renders (`ADCHome.razor:147-159`), while the hero's conference-day button reads `TicketingUrl` off the featured event and hides itself when absent. The constant carries an `S1075` suppression with the reason inline (`:27-32`): it is a published product page, not an environment-dependent path, so there is nothing to configure. [Rubric §26, Front-End Security]: the workshop ticketing button opens with `Target="_blank"` together with `rel="noopener noreferrer"` (`ADCHome.razor:155`).
- **Where it's used**: the `Workshops` array on [ADCHome](#adchome) (`:359`) and the workshops section of `ADCHome.razor` (`:85-161`) only.

### ADCCollectionResult
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:297` · Level 1 · record (sealed, private)

- **What it is**: the one-property envelope the landing page deserializes the `events` response into: `List<ADCEventInfo>? Items` (`:297`). It exists because the API returns a collection *envelope*, not a bare array.
- **Depends on**: [ADCEventInfo](#adceventinfo) (its element type), which is what puts it one level above the plain records.
- **Concept introduced: mirroring only the slice of the envelope you consume.** The API's uniform collection contract is [CollectionResult<T>](group-01-result-error-handling.md#collectionresultt), which carries more than a list. Rather than referencing that type, the page declares a minimal structural twin containing just `Items`, keeping the landing page free of any dependency on the API's shared contract assembly. [Rubric §9, API and Contract Design]: the wire format is honoured, the coupling is not.
- **Walkthrough**: consumed in exactly one place, `LoadEventAsync` (`:176`): `await client.GetFromJsonAsync<ADCCollectionResult>("events", ApiJsonOptions, _cts!.Token)`. The `ApiJsonOptions` field is a `JsonSerializerOptions(JsonSerializerDefaults.Web)` allocated once as `static readonly` (`:34`), which is what makes the camelCase wire names bind to the PascalCase record properties. `Items` is nullable and immediately coalesced to an empty collection at the call site (`result?.Items ?? []`, `:181`), so a null body, a null `Items`, and an empty list all take the same path.
- **Why it's built this way**: `GetFromJsonAsync` returns `null` for an empty response body, so the nullable property plus the coalesce covers both failure shapes without a branch.
- **Where it's used**: [ADCHome](#adchome)`.LoadEventAsync` only (`:176`).

### ADCSponsorInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:313` · Level 1 · record (sealed, private)

- **What it is**: the landing page's projection of one sponsor: `Id`, `Name`, `Tier`, `LogoUrl?`, `WebsiteUrl?`, `Sort`, and `EventId` (`:313-320`). Seven fields, exactly what the sponsor logo strip renders and sorts by.
- **Depends on**: [SponsorTier](group-17-conference-domain.md#sponsortier) from `MMCA.ADC.Conference.Shared.Sponsors` (imported at `:5`). That one shared enum is the single first-party type the landing page's wire models reference, and it is what raises this record above level 0.
- **Concept introduced: sharing the enum, not the DTO.** The page could have referenced the API's [SponsorDTO](group-17-conference-domain.md#sponsordto) and taken everything with it. Instead it declares its own seven-field record and imports only `SponsorTier`, because the tier is a *domain vocabulary* term whose numeric ordering is load-bearing here: `Platinum = 0`, `Gold = 1`, `Silver = 2` (`MMCA.ADC.Conference.Shared/Sponsors/SponsorTier.cs:15-21`), so an `OrderBy(g => g.Key)` on the enum value yields package order without a lookup table (`:230`). Re-declaring the enum locally would have duplicated that ordering contract in a place no test guards. [Rubric §9, API and Contract Design] is the balance being struck: copy the shape, share the vocabulary.
- **Walkthrough**: a positional record with no methods, used only inside `LoadSponsorsAsync` and the markup. `Tier` is the grouping key (`:229`), `Sort` then `Name` are the intra-tier tie-breakers (`:233`), `EventId` is the filter that scopes the strip to the featured event (`:228`), and `LogoUrl`/`WebsiteUrl` drive a four-way render fallback in the markup (`ADCHome.razor:274-295`): linked logo, linked name, bare logo, or bare name, depending on which of the two optional URLs are present. [Rubric §26, Front-End Security] is visible in that block: the outbound sponsor link carries `Target="_blank"` together with `rel="noopener noreferrer"` (`ADCHome.razor:276`), so a sponsor site can never reach back through `window.opener`. [Rubric §21, Accessibility]: the link also carries a localized `aria-label` built from the sponsor name (`ADCHome.razor:277`), and the logo image its `Alt` (`ADCHome.razor:280`), so a logo-only card is still announced.
- **Why it's built this way**: `Sort` exists so organizers can order sponsors inside a tier by hand, and the code comment states why the sort is explicit at all (`:223-224`): tier ascending is package order, and `Sort` then `Name` breaks ties so the strip is deterministic rather than dependent on insertion order. `StringComparer.CurrentCulture` on the name tie-break (`:233`) keeps that alphabetical fallback correct under the selected culture.
- **Where it's used**: the `Items` list of [ADCSponsorCollectionResult](#adcsponsorcollectionresult) (`:311`), the grouped `_sponsorTiers` field (`:68`), and the sponsor section of `ADCHome.razor` (`:250-331`).

### ADCSponsorCollectionResult
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:311` · Level 2 · record (sealed, private)

- **What it is**: the envelope for the `sponsors` response: `List<ADCSponsorInfo>? Items` (`:311`). It is the sponsor-side twin of [ADCCollectionResult](#adccollectionresult), declared separately because C# records are not structurally typed.
- **Depends on**: [ADCSponsorInfo](#adcsponsorinfo), and transitively [SponsorTier](group-17-conference-domain.md#sponsortier).
- **Concept introduced**: nothing new; the minimal-envelope idea is taught under [ADCCollectionResult](#adccollectionresult).
- **Walkthrough**: deserialized in `LoadSponsorsAsync` with the same shared `ApiJsonOptions` and the same cancellation token (`:221`), then reduced in one collection expression (`:225-234`): `result?.Items ?? []` for the null-safe start, `.Where(s => s.EventId == _event.Id)` to scope to the featured event (`:228`), `.GroupBy(s => s.Tier)` (`:229`), `.OrderBy(g => g.Key)` for package order (`:230`), and a `Select` that materializes each group as a `KeyValuePair<SponsorTier, IReadOnlyList<ADCSponsorInfo>>` with its members ordered by `Sort` then `Name` (`:231-233`). The result lands in `_sponsorTiers` (`:68`), whose doc comment states the intent in one line: sponsors grouped by tier in package order, each group ordered by Sort then Name (`:67`).
- **Why it's built this way**: the method-level remarks (`:205-210`) record the two safety properties. The `sponsors` endpoint is the same anonymous read path as the events call and already scopes anonymous callers to sponsors of published events (`MMCA.ADC.Conference.API/Controllers/SponsorsController.cs:72-92`, whose specification is built at `:60-70` and resolves published event ids in `MMCA.ADC.Conference.Application/Sponsors/UseCases/GetPublicSponsorFilter/GetPublicSponsorFilterHandler.cs:25-30`); the client-side `EventId` filter is the second half, so a second published edition's sponsors never bleed onto this page. And any failure leaves the list empty, which falls back to the sponsorship call to action rather than a blank strip.
- **Where it's used**: [ADCHome](#adchome)`.LoadSponsorsAsync` only (`:221`).

### ConferenceUIModule
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI` · `MMCA.ADC.Conference.UI/ConferenceUIModule.cs:14` · Level 3 · class (sealed)

- **What it is**: the Conference module's UI descriptor. It contributes the navigation items for the whole conference capability (public Events/Sessions/Speakers/Sponsors/Activities, the claim-gated speaker Dashboard and QR page, and an organizer admin group covering Events, Sessions, Speakers, Categories, Questions, Rooms, Sponsors, Activities, and Session Selection) and exposes its assembly so the host can discover the module's routable Blazor components.
- **Depends on**: [IUIModule](group-15-common-ui-framework.md#iuimodule) (the contract it implements), [NavItem](group-15-common-ui-framework.md#navitem) and [NavSection](group-15-common-ui-framework.md#navsection) (the nav vocabulary from `MMCA.Common.UI.Common`), [RoleNames](group-08-auth.md#rolenames) (the `Organizer` role string), [ConferenceRoutePaths](#conferenceroutepaths) (the URLs), plus MudBlazor `Icons` and `System.Reflection.Assembly` (externals) and the co-located `ConferenceUIModule.resx` / `ConferenceUIModule.es.resx` pair.
- **Concept introduced: the modular-UI descriptor, the front-end analogue of `IModule`.** [Rubric §18, UI Architecture and Component Design] assesses whether UI is composed from cohesive, self-describing modules rather than a hard-coded master shell; a module declaring its own menu is exactly that, and it is the Open/Closed half of [Rubric §1, SOLID]: enabling a module adds its navigation with no edit to the shell. [Rubric §25, Navigation and Information Architecture] is served because the items are role- and claim-aware and grouped into sections. [Rubric §11, Security] applies with an important caveat: hiding a nav item is UX only. The services still enforce authorization server-side, so the claim and role here are not the security boundary. Per [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) the `Title` and `Group` strings are resource *keys*, not literals: `TitleResource: typeof(ConferenceUIModule)` on every item tells the shared NavMenu to resolve them against the co-located `.resx` at render time, which the file's own comment records (`:16-17`).
- **Walkthrough**: `NavItems` (`:18-41`) is an `IReadOnlyList<NavItem>` initialized with a collection expression in three tiers, sixteen items in all.
  - **Public** (`:21-25`): five items for everyone, anonymous included, pointing at the `/conference/...` routes: Events, Sessions, Speakers, Sponsors, Activities. They carry no `RequiredRole` and no `Section`, so they default to `NavSection.General` (`MMCA.Common.UI/Common/NavItem.cs:17`).
  - **Speaker** (`:28-29`): the Dashboard and the QR page, both carrying `RequiredClaim: "speaker_id"` and `Section: NavSection.User`, so they appear only for a user whose JWT links them to a speaker record and they render in the user menu rather than the main list.
  - **Organizer** (`:32-40`): nine items, each carrying `RoleNames.Organizer`, `Section: NavSection.Admin`, and `Group: "Nav.Group.Conference"` so they fold into one labelled admin group, ending with the Session Selection entry (`:40`).
  - `Assembly` (`:43`) returns `typeof(ConferenceUIModule).Assembly` so the host's Blazor router can discover this library's routable components. Note that "Events", "Sessions", "Speakers", "Sponsors", and "Activities" each appear twice in the list, once public and once organizer, differing only in route and gating: the same label serves two audiences with two destinations.
- **Why it's built this way**: mirroring the backend [IModule](group-14-module-system-composition.md#imodule) pattern on the UI side keeps the app extensible. A host that boots without the Conference module simply has no conference nav and no conference routes, with no conditional code anywhere in the shell. The class also leaves `AppBarComponentTypes` and `LayoutComponentTypes` at their interface defaults (`MMCA.Common.UI/Common/Interfaces/IUIModule.cs:19-22`): Conference contributes no app-bar badge or root overlay.
- **Where it's used**: registered as a singleton `IUIModule` by this module's [DependencyInjection](#dependencyinjection) through `AddUIModule<ConferenceUIModule>()` (`DependencyInjection.cs:23`) and aggregated by the shared UI navigation builder in [group 15](group-15-common-ui-framework.md#iuimodule).

### DependencyInjection
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI` · `MMCA.ADC.Conference.UI/DependencyInjection.cs:11` · Level 6 · class (static)

- **What it is**: the Conference UI composition root. Its single `AddConferenceUI()` method is the one call a host makes to register every Conference UI service (the per-entity CRUD services by assembly scan, the child-entity, dashboard, feedback, selection, and lookup services explicitly) plus the module descriptor.
- **Depends on**: [ConferenceUIModule](#conferenceuimodule) and, through `AddUIModule<T>` (`MMCA.Common.UI/DependencyInjection.cs:152-162`), Scrutor's assembly-scanning API and the open generic [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype). Then this module's own service contracts: [IEventSpeakerUIService](#ieventspeakeruiservice), [ISessionSpeakerUIService](#isessionspeakeruiservice), [ISessionCategoryItemUIService](#isessioncategoryitemuiservice), [ISpeakerCategoryItemUIService](#ispeakercategoryitemuiservice), [ISpeakerDashboardUIService](#ispeakerdashboarduiservice), [IOrganizerEventFeedbackUIService](#iorganizereventfeedbackuiservice), [IOrganizerSessionFeedbackUIService](#iorganizersessionfeedbackuiservice), [ISessionSelectionUIService](#isessionselectionuiservice), [ISpeakerLookupService](#ispeakerlookupservice), [IEventLookupService](#ieventlookupservice), [ICategoryItemLookupService](#icategoryitemlookupservice), and [IPublicLinkBuilder](#ipubliclinkbuilder) with its [NavigationPublicLinkBuilder](#navigationpubliclinkbuilder) implementation.
- **Concept introduced: the `extension(IServiceCollection)` registration block, half convention and half explicit.** [Rubric §3, Clean Architecture] and [Rubric §16, Maintainability] both come down to keeping wiring at the edges; this file is the module's one wiring point. It uses the C# preview extension-type syntax `extension(IServiceCollection services)` (`:13`) to hang `AddConferenceUI` (`:19`) off `IServiceCollection`, the same idiom every module's `DependencyInjection` uses. The convention half is delegated to `AddUIModule<ConferenceUIModule>()` (`:23`), which does two things in one call (`MMCA.Common.UI/DependencyInjection.cs:155-161`): a Scrutor scan of this assembly registering every `IEntityService<,>` implementation `AsImplementedInterfaces().WithScopedLifetime()`, and the singleton registration of the descriptor itself. Registering `AsImplementedInterfaces` is what makes a page able to inject the narrow per-entity interface rather than the open generic, and it means adding a new entity service needs no edit here.
- **Walkthrough**: the scan runs first (`:23`), then the method registers by hand exactly the services the scan cannot see, because they do not implement `IEntityService<,>`: four child-entity managers for the join relationships (`:26-29`), the speaker dashboard service (`:32`), the two BR-53 organizer-feedback moderation services (`:35-36`), the session-selection decision-support service (`:39`), and three cross-module lookup services (`:42-44`). It then registers [IPublicLinkBuilder](#ipubliclinkbuilder) as [NavigationPublicLinkBuilder](#navigationpubliclinkbuilder) (`:49`) and returns `services` for chaining (`:51`). Every explicit registration is `AddScoped`; only the descriptor is a singleton, which is correct because it is immutable data.
- **Why it's built this way**: scanning the uniform bulk and spelling out the one-off collaborators keeps registration short without hiding the non-trivial wiring. One such subtlety is documented inline (`:46-48`): the public share-link builder resolves against the browser origin by default, but the MAUI head re-registers `IPublicLinkBuilder` *after* this call so last-registration-wins points shared links at the configured public web URL (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:105-107`, citing [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). That ordering dependency is exactly the kind of thing that belongs in a comment next to the registration.
- **Where it's used**: called once during startup by each of the three UI heads: the Blazor Server host (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:83`), the WebAssembly client (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:63`), and the MAUI host (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:97`), alongside the other modules' `AddXxxUI()` extensions.

### ADCHome
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:18` · Level 9 · class (sealed partial component)

- **What it is**: the conference landing page: hero with a live countdown and a ticketing button, pre-conference workshops, keynote, track catalogue, sponsor strip with a sponsorship call to action, and venue block. It fetches the published events list to find which event to feature, classifies that event as Upcoming/Live/Ended, loads that event's sponsors, and renders the rest from compiled-in editorial content. It is shared verbatim by the Web and MAUI heads, and its class doc records that both heads serve the static images from their own site root, so neither overrides `ImageBasePath` today (`:10-17`).
- **Depends on**: [ADCCollectionResult](#adccollectionresult), [ADCEventInfo](#adceventinfo), [ADCSponsorCollectionResult](#adcsponsorcollectionresult), [ADCSponsorInfo](#adcsponsorinfo) (the API models), [EventPhase](#eventphase), [KeynoteSpeakerInfo](#keynotespeakerinfo), [ConferenceTrackInfo](#conferencetrackinfo), [PreConferenceWorkshopInfo](#preconferenceworkshopinfo) (the content records, all private inner types of this class), [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) from `MMCA.ADC.Conference.Shared.Events` (`:4`), [SponsorTier](group-17-conference-domain.md#sponsortier) (`:5`), and [ConferenceRoutePaths](#conferenceroutepaths) for the "see all sponsors" link (`ADCHome.razor:303`). Externals: `IHttpClientFactory` and `GetFromJsonAsync` (`:1`, `:42-43`), `IStringLocalizer<ADCHome>` injected in the markup as `L` (`ADCHome.razor:1`), `System.Threading.Timer`, `TimeZoneInfo`, MudBlazor, and the Blazor `RendererInfo` API. It composes one first-party child component, `HomeCountdown` (`ADCHome.razor:40`), which lives in the same folder as a single `.razor` file with no code-behind.
- **Concept introduced: rendering correctly across the prerender and interactive passes.** [Rubric §23, Front-End Performance and Rendering] assesses whether a page avoids wasted renders and blocking work; this component is the chapter's clearest case study, and both of its decisions are recorded in the code comments.
  - **Skip the fetch during prerender.** `OnInitializedAsync` checks `RendererInfo.IsInteractive` and, when false, sets `_isLoading = false`, computes the countdown from defaults, and returns without touching the network (`:116-121`). The comment (`:111-115`) states why: an untimed server-side call to a cold or unreachable backend would block the prerender, and therefore the page load *and* the post-login `NavigateTo("/")`, indefinitely. The static fallback renders immediately and the interactive pass loads the real event. [Rubric §29, Resilience] is the same point from the availability angle.
  - **Fence the per-second re-render.** The ticking digits live in the `HomeCountdown` child, which owns its own timer, so this page arms only a *single one-shot* `Timer` for the Live-to-Ended flip (`:143-158`). The comment at `:126-127` records the alternative: a 1-second timer would re-render the entire landing page, the largest static page in the app, for the whole event, per circuit, just to catch one transition. The child goes further still: it ticks once a minute while more than 65 minutes remain and switches to once a second only for the final hour (`HomeCountdown.razor:32`, `:55`, `:59`, `:73`).

  Three more rubric threads run through it. [Rubric §22, Responsive and Cross-Browser/Device]: one component compiles into the Blazor Server, WebAssembly, and MAUI heads, with the per-head difference reduced to the `ImageBasePath` parameter (`:50-51`). [Rubric §27, Internationalization]: user-facing chrome resolves through `L[...]`, while four strings carry explicit `// i18n: allow` markers with reasons (the ticketing URL `:31`, the brand name `:79`, the postal address `:83`, the editorial content block `:323-324`). [Rubric §20, Design System and Theming]: the page's scoped stylesheet is a single shared copy rendered by both heads, and an architecture fitness test embeds it and fails the build if it re-hardcodes the brand hex instead of using `var(--mmca-primary)` (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/BrandColorTokenTests.cs:12-17`, `MMCA.ADC.Architecture.Tests.csproj:11-13`).
- **Walkthrough**, in lifecycle order:
  - **Constants and state** (`:20-70`): the `PreConferenceTicketingUrl` constant placed first because SA1203 requires constants before fields (`:24-25`, `:30-31`), the shared `ApiJsonOptions` and `EventStartTime` (`:34-35`), the `FallbackStartDate` (`:40`), then a `CancellationTokenSource`, the one-shot `_phaseTimer`, the computed `_startUtc`/`_endUtc`, `_phase`, the nullable `_event`, the grouped `_sponsorTiers` (`:68`), `_isLoading` (starting `true`), and a `_disposed` guard the timer callback checks.
  - **Derived display properties** (`:79-86`): `EventName`, `EventDescription`, `VenueAddress`, and `MapSearchUrl` are each `_event?.X ?? <fallback>`, so the page is fully renderable before and without a successful fetch. `MapSearchUrl` builds a Google Maps search URL with `Uri.EscapeDataString` over the address (`:85-86`).
  - **`HeroTitleParts()`** (`:93-105`): splits the event name so the hero can accent the keyword between "Atlanta " and " Conference" (in "2026 Atlanta Developers Conference" it accents "Developers"). It uses `IndexOf`/`LastIndexOf` with `StringComparison.Ordinal` and falls back to rendering the whole name plain when the name does not match the brand shape (`:102-104`), which is why an arbitrary event name never renders broken markup.
  - **`OnInitializedAsync`** (`:107-129`): creates the CTS, takes the prerender short-circuit described above, otherwise awaits `LoadEventAsync()` then `LoadSponsorsAsync()` in sequence (`:123-124`, the sponsor call needs the featured event id) and arms the phase timer (`:128`).
  - **`LoadEventAsync`** (`:171-200`): creates the named `"APIClient"` from `IHttpClientFactory` (`:175`), deserializes into [ADCCollectionResult](#adccollectionresult) under the cancellation token (`:176`), and picks the event with `CurrentEventSelector.SelectCurrentOrNext(...)` passing four accessor lambdas plus `DateTime.UtcNow` (`:180-185`). The comment at `:178-179` is the reason it is not a `FirstOrDefault`: the anonymous endpoint returns published events unordered, so a naive first-item pick would pin the oldest seeded event. Two catch arms are deliberately silent: `OperationCanceledException` means the component was disposed mid-load (`:187`), `HttpRequestException` means the API is unavailable and the fallback content stands (`:191`). The `finally` block always clears `_isLoading` and recomputes the countdown (`:195-199`), so no failure path leaves a spinner on screen.
  - **`LoadSponsorsAsync`** (`:211-244`): returns immediately when no event was featured (`:213-216`), then runs the same anonymous read path against `sponsors` and reduces the payload to the tier-grouped list described under [ADCSponsorCollectionResult](#adcsponsorcollectionresult). Its two catch arms mirror `LoadEventAsync` (`:236`, `:240`) and both leave `_sponsorTiers` empty, which is a supported render state rather than an error state.
  - **`UpdateCountdown`** (`:246-276`): converts the event's local start and end into UTC using `TimeZoneInfo.FindSystemTimeZoneById(timeZoneId)` with `"America/New_York"` as the default (`:252`, `:259`), calling `CurrentEventSelector.ToUtc` rather than `ConvertTimeToUtc` because, as the comment records (`:256-258`), the midnight end boundary does not exist in zones that transition at 00:00 and a raw conversion would throw out of the render path (`MMCA.ADC.Conference.Shared/Events/CurrentEventSelector.cs:96-106`). An unknown zone id falls back to treating the local values as UTC (`:263-267`), then `_phase` is assigned from the switch described under [EventPhase](#eventphase).
  - **Phase timing** (`:132-169`): `OnCountdownElapsedAsync` is the `EventCallback` the `HomeCountdown` child raises at zero (`HomeCountdown.razor:82`), which recomputes the phase, re-arms, and calls `InvokeAsync(StateHasChanged)` (`:132-137`). `ArmPhaseTimerForEventEnd` returns unless the phase is `Live` and the remaining time is positive, then disposes any prior timer and schedules one callback at `untilEnd` with `Timeout.InfiniteTimeSpan` as the period, meaning fire once and never repeat (`:143-158`). `OnEventEnded` checks `_disposed` before re-rendering (`:160-169`).
  - **`FormatEventDate`** (`:278-285`): formats the date with a pattern read from a *resource* (`L["Hero.DateFormat"]`) against `CultureInfo.CurrentCulture`, so both the layout and the month names follow the selected language ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
  - **`Dispose`** (`:287-294`): sets `_disposed`, cancels and disposes the CTS, and both stops (`Change(-1, -1)`) and disposes the phase timer. Stopping before disposing is what prevents a callback already in flight from touching a torn-down component.
- **Why it's built this way**: the landing page is the app's most-hit surface and the post-login destination, so its correctness budget is dominated by two failure modes that have nothing to do with its content: a slow backend blocking the prerender, and a per-second render loop multiplied by every connected circuit. Both are solved structurally (skip the fetch, fence the tick) rather than by tuning, and every dynamic block has a defined empty state, so the page is never blank. The two conditional calls to action follow the same discipline: the hero ticketing button (`ADCHome.razor:67-80`) and the sponsorship packet block (`ADCHome.razor:307-329`) each render only when the featured event publishes the corresponding URL, and hide entirely otherwise rather than offering a dead link.
- **Where it's used**: resolved as the home component by each head's `ADCHomePageContent`. The Web client points `ComponentType` straight at this shared component (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:13`, registered at `.../MMCA.ADC.UI.Web.Client/Program.cs:49` and `.../MMCA.ADC.UI.Web/Program.cs:60`); the MAUI head points at a thin local wrapper page that renders `<ADCHome />` with no parameters (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHomePageContent.cs:10`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHome.razor:6`). [Rubric §28, Front-End Testing]: the page has no bUnit test, but two suites hold it to account from outside, the brand-token fitness test above and the E2E pseudo-localization sentinel, which probes this page's `Location.OpenInMaps` resource precisely because that button is static markup rather than event-load-gated (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/PseudoLocalizationTests.cs:46-56`).
- **Caveats / not-in-source**: the page's own countdown window is not identical to the selector's. `UpdateCountdown` starts the event at `EventStartTime = 08:00` local (`:35`, `:250`), while [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) starts its live window at midnight local (`MMCA.ADC.Conference.Shared/Events/CurrentEventSelector.cs:69`). Both end at midnight after the last day. So between midnight and 08:00 on day one, the selector already treats the event as live while the hero still shows a countdown. Whether that is intended is not determinable from source. Also note the two hard-coded fallbacks used when no event loads: the date `2026-10-17`, whose comment warns it must track the published event date or the hero date and countdown visibly jump once the real event arrives (`:37-40`), and the venue address (`:83`).

### ScorePollSignal
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.SessionSelection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/SessionSelection/ScorePollTracker.cs:6` · Level 0 · enum (internal)

- **What it is**: the five-valued verdict that [ScorePollTracker](#scorepolltracker) returns for one observation of the AI-scoring poll loop. It tells the dashboard page what to do next: keep waiting, re-render with fresh data, or stop.
- **Depends on**: nothing. It is a bare `internal enum` declared alongside the tracker in the same file (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/SessionSelection/ScorePollTracker.cs:6`), visible to the bUnit test project through the project's `InternalsVisibleTo` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/MMCA.ADC.Conference.UI.csproj:9`).
- **Concept introduced: the decision/effect split.** [Rubric §18, UI Architecture] assesses whether components stay thin and free of tangled control flow; naming each outcome as an enum member is how that is achieved here. The decision (what did this poll mean?) is computed by a pure state machine, and the effects (snackbar, `StateHasChanged`, stop the loop) are applied by the component in a single `switch`, so neither half has to know the other's internals. [Rubric §14, Testability] follows for free: a test can assert the sequence of signals for a synthetic count series without rendering anything.
- **Walkthrough**: `Continue` (`:9`) means nothing changed this tick, keep polling. `Progressed` (`:12`) means new scores arrived, so apply the fresh dashboard, re-render, and keep polling. `CompletedAll` (`:15`) means every session now has a score, so apply and finish successfully. `CompletedStable` (`:19`) means the count has been unchanged long enough to call scoring done, with the success-versus-partial wording decided from coverage. `GaveUpNoScores` (`:22`) means no score was ever produced inside the zero-progress budget, so fail loudly rather than wait out the full cap.
- **Why it's built this way**: the poll loop has four terminal outcomes that each need a different user-facing message (complete, partial, timed out, never started). An enum makes the exhaustive `switch` in the page readable and keeps that failure vocabulary in one place.
- **Where it's used**: returned by `ScorePollTracker.RegisterFetch` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/SessionSelection/ScorePollTracker.cs:74`) and consumed by [SessionSelectionDashboard](#sessionselectiondashboard)`.HandlePollSignalAsync` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionDashboard.razor.cs:298`).

### SessionSelectionDisplay
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.SessionSelection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionDisplay.cs:11` · Level 0 · class (static, internal)

- **What it is**: a pure, stateless helper holding the display and filter-matching rules shared by the session-selection dashboard and its two presentational sub-components. It answers three kinds of question with no side effects: what color a status or score chip should be, whether a locality tier counts as "local", and whether a session passes the active score-tier or status filter.
- **Depends on**: the MudBlazor `Color` enum (external NuGet, imported at `:1`). No first-party types: it is deliberately dependency-light so both [SessionSelectionSpeakerOverlap](#sessionselectionspeakeroverlap) and [SessionSelectionAiScores](#sessionselectionaiscores) can call the same predicates.
- **Concept introduced: extracting view logic into testable pure functions.** [Rubric §18, UI Architecture] rewards keeping decision logic out of `.razor` markup so it can be unit-tested and reused; [Rubric §14, Testability] is the same point from the other side. Every method here is `static` and total (each `switch` has a default arm), so the same input always yields the same color or boolean regardless of component state. `IsLocalTier` (`:13-16`) folds three locality strings (`Atlanta`, `Georgia`, `Surrounding`, all matched with `StringComparison.OrdinalIgnoreCase`) into one "is this speaker local" test.
- **Walkthrough**: `GetStatusColor` (`:18-27`) maps the six selection states (`Accepted`, `Nominated`, `Accept_Queue`, `Waitlisted`, `Decline_Queue`, `Declined`) onto MudBlazor semantic colors, with `Color.Default` as the fallback. `GetScoreColor` (`:29-35`) buckets a `decimal` AI score into four bands (>= 8.0 success, >= 6.0 info, >= 4.0 warning, otherwise error). `ScoreMatchesFilter` (`:37-48`) turns a filter token (`"9.0"`, `"8.0"`, down to `"3.0"`, plus `"<3.0"`) into a threshold predicate, with an unrecognized token matching everything; `<3.0` is the only strict-less-than case. `MatchesAcceptedFilter` (`:50-51`) and `SessionMatchesStatus` (`:53-56`) encode a subtle rule: when the filter is `Accepted`, a session whose status is `null` also matches, because an unset status is treated as accepted by default; every other filter is a plain case-insensitive equality test.
- **Why it's built this way**: the two sibling sections filter over different DTO shapes but must agree on what "score tier 8.0" or "status Accepted" means; hoisting the rules here guarantees they never drift apart.
- **Where it's used**: called by [SessionSelectionSpeakerOverlap](#sessionselectionspeakeroverlap) (`SessionMatchesStatus`, `ScoreMatchesFilter`, at `.../SessionSelectionSpeakerOverlap.razor.cs:62` and `:69`) and by [SessionSelectionAiScores](#sessionselectionaiscores) (`MatchesAcceptedFilter`, `ScoreMatchesFilter`, at `.../SessionSelectionAiScores.razor.cs:48` and `:63`), plus the `.razor` markup of both for chip coloring.

### ScorePollTracker
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.SessionSelection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/SessionSelection/ScorePollTracker.cs:31` · Level 1 · class (sealed, internal)

- **What it is**: the pure state machine behind the dashboard's fire-and-forget AI-scoring poll loop. It counts progress, stability, zero-progress polls, and consecutive failures, and converts each observation into a [ScorePollSignal](#scorepollsignal). It performs no I/O and touches no UI.
- **Depends on**: nothing first-party except the co-located [ScorePollSignal](#scorepollsignal) enum it returns; its state is four `int` fields.
- **Concept introduced: taming a fire-and-forget loop with an explicit budget.** [Rubric §12, Performance and Scalability] and [Rubric §29, Resilience] both ask whether long-running work has bounded cost and a defined give-up path, and this class is where those bounds are written down as named constants instead of being scattered through a component. The class doc names the motivation directly (`:25-30`): the state machine was extracted from the page code-behind so the component keeps only the UI side effects, which is the [Rubric §18, UI Architecture] concern about component size. [Rubric §14, Testability] applies because the whole loop policy can be exercised by calling `RegisterFetch` with a synthetic count series, with no timers and no rendering.
- **Walkthrough**: two public constants set the outer limits: `MaxPolls = 225` (`:34`, documented as a 30-minute cap at 225 polls times an 8-second interval) and `MaxConsecutiveFailures = 5` (`:41`), whose doc comment explains why failures are tolerated at all: the polling task is fire-and-forget, so an escaping exception would be unobserved and would wedge the Score button until a full reload. Two private constants set the inner heuristics: `ZeroProgressLimit = 10` (`:48`, roughly 80 seconds with no scores saved at all, aimed at the silent-fail case such as a missing API key) and `StablePollsForCompletion = 3` (`:51`). Four fields carry the state (`:53-56`): `_previousCount`, `_stablePolls`, `_zeroProgressPolls`, `_consecutiveFailures`. `ResetFailures` (`:59`) zeroes the failure counter after any successful fetch; `RegisterFailure` (`:65-69`) increments it and returns `true` once the budget is exhausted. `RegisterFetch(currentCount, totalSessions)` (`:74-105`) is the core: a zero count increments `_zeroProgressPolls` and returns `GaveUpNoScores` at the limit, otherwise `Continue` (`:76-82`); any nonzero count clears the zero-progress counter (`:84`); a count greater than the previous one advances `_previousCount`, resets `_stablePolls`, and returns `CompletedAll` when the count has reached `totalSessions` (guarded by `totalSessions > 0`) or `Progressed` otherwise (`:86-93`); an unchanged count increments `_stablePolls` and returns `CompletedStable` at three (`:95-102`); anything else returns `Continue` (`:104`).
- **Why it's built this way**: server-side AI scoring is a batch whose duration depends on an external model, so the UI has no completion event to await and must infer completion from the score count. Treating "completion" as either full coverage or three unchanged polls yields an answer even when some sessions fail to score, and the separate zero-progress budget turns the common credential-failure case into a fast, loud error rather than a 30-minute silence.
- **Where it's used**: instantiated once per scoring run by [SessionSelectionDashboard](#sessionselectiondashboard)`.RunScorePollingLoopAsync` (`.../SessionSelectionDashboard.razor.cs:260`), whose `for` loop bounds itself with `ScorePollTracker.MaxPolls` (`:262`).
- **Caveats / not-in-source**: the latency claim in the `MaxPolls` comment ("enough for ~200+ sessions at typical Haiku latency", `:33`) is a code comment, not a measurement recorded in this repo.

### SessionSelectionSpeakerOverlap
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.SessionSelection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionSpeakerOverlap.razor.cs:11` · Level 2 · class (partial component)

- **What it is**: the presentational "speakers with multiple sessions" section of the selection dashboard. It lists each multi-session speaker with their locality and per-session status and score chips, narrowed to whatever filters the parent dashboard currently has active.
- **Depends on**: [MultiSessionSpeaker](group-17-conference-domain.md#multisessionspeaker) and [SpeakerSessionSummary](group-17-conference-domain.md#speakersessionsummary) (the DTOs it renders, imported at `:2`), [SessionSelectionDisplay](#sessionselectiondisplay) (the shared predicates), the `SessionIdentifierType` alias, and the Blazor `[Parameter]` infrastructure from `Microsoft.AspNetCore.Components` (external, `:1`).
- **Concept introduced: the presentational (dumb) child component.** [Rubric §19, State Management] distinguishes components that own state from components that only render state passed in; this is the second kind. It has no service injections and no mutable fields, only `[Parameter]` inputs (`:13-19`): the `Speakers` list, an `AiScoreLookup` dictionary from session id to score, and five filter strings (`FilterStatus`, `FilterLocality`, `FilterCategory`, `FilterLevel`, `FilterScoreTier`), each defaulting to empty. All state flows down from [SessionSelectionDashboard](#sessionselectiondashboard), which makes this component a pure function of its parameters. [Rubric §18, UI Architecture] is served by keeping the filtering in the code-behind and the template thin.
- **Walkthrough**: `HasActiveFilters` (`:21-24`) is a cheap short-circuit: when every filter string is empty the component returns `Speakers` unfiltered and only sorts. `FilteredSpeakerOverlap` (`:26-36`) is the computed view the markup binds to: it applies filters when any are set, then orders speakers case-insensitively by name (`:34`). `ApplySpeakerFilters` (`:38-59`) works in two passes: the locality filter drops whole speakers by comparing `LocalityCategory ?? "Unknown"` against the selection (`:42-46`); then, if any session-level filter is set, a record `with` expression rebuilds each speaker's `Sessions` collection keeping only matching sessions, and speakers left with zero sessions are dropped (`:48-56`). `SessionMatchesFilters` (`:61-65`) ands together the status test (delegated to [SessionSelectionDisplay](#sessionselectiondisplay)), a category and a level test that both search the session's `CategoryItemNames`, and the score-tier test. `SessionMatchesScoreTier` (`:67-69`) looks the session up in `AiScoreLookup` and returns false when the session has no score yet, so an active score-tier filter hides unscored sessions.
- **Why it's built this way**: rebuilding the speaker record with a filtered `Sessions` list (rather than hiding rows in markup) means the "drop empty speakers" rule and the sort both operate on already-filtered data, so the rendered list and any counts derived from it stay consistent. The `with` copy keeps the source DTOs immutable.
- **Where it's used**: rendered inside [SessionSelectionDashboard](#sessionselectiondashboard)'s markup, fed the dashboard's `_aiScoreLookup` and its five `_filter*` fields as parameters.

### SessionSelectionAiScores
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.SessionSelection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionAiScores.razor.cs:12` · Level 4 · class (partial component)

- **What it is**: the presentational "AI scores" section of the selection dashboard. It renders the "Score Sessions with AI" action with its in-progress state and the per-session AI-score table, narrowed by the parent's active filters. The scoring flow itself stays on the containing page and is triggered upward through an `EventCallback`.
- **Depends on**: [SessionSelectionDashboardDTO](group-17-conference-domain.md#sessionselectiondashboarddto) and its [SessionAiScoreDTO](group-17-conference-domain.md#sessionaiscoredto) rows (`:2`), [SessionSelectionDisplay](#sessionselectiondisplay) (shared predicates), and the Blazor `[Parameter]` and `EventCallback` infrastructure (external, `:1`).
- **Concept introduced: lifting the action up via `EventCallback`.** [Rubric §19, State Management] favors child components that raise intent rather than own the operation; here the child never calls a service. The scoring trigger is exposed as `[Parameter] public EventCallback ScoreRequested` (`:16`) alongside an `IsScoring` flag the parent flips (`:15`), so the long-running scoring loop, its cancellation, and its snackbars all live in [SessionSelectionDashboard](#sessionselectiondashboard) while this section only shows the button and the progress state. Like its sibling it is otherwise a pure function of its parameters (`:14-21`): the whole `Dashboard` DTO plus the same five filter strings.
- **Walkthrough**: `HasActiveFilters` (`:23-26`) short-circuits identically to the sibling. `FilteredAiScores` (`:28-40`) returns an empty list when the dashboard has no scores yet (`:32-33`), returns `Dashboard.AiScores` untouched when no filter is active (`:35-36`), and otherwise materializes `ApplyAiScoreFilters` into an array. `ApplyAiScoreFilters` (`:42-66`) is a straight pipeline of `Where` clauses over the flat score rows: status, applying the same null-equals-Accepted rule through [SessionSelectionDisplay](#sessionselectiondisplay)`.MatchesAcceptedFilter` (`:46-51`); locality against the row's `SpeakerLocalities` collection (`:53-54`); category against `SessionCategories` (`:56-57`); level as a case-insensitive equality on `SessionLevel` (`:59-60`); and score tier via `ScoreMatchesFilter` on `OverallScore` (`:62-63`).
- **Why it's built this way**: the score table is a flat DTO list, so its filter pipeline is simpler than the speaker section's nested rebuild; sharing [SessionSelectionDisplay](#sessionselectiondisplay) keeps the two sections' notion of "matches this filter" identical even though their data shapes differ. Keeping the pipeline lazy until one final materialization avoids an intermediate array per filter stage ([Rubric §23, Front-End Performance]).
- **Where it's used**: rendered inside [SessionSelectionDashboard](#sessionselectiondashboard); its `ScoreRequested` callback invokes the dashboard's `ScoreSessionsAsync` (`.../SessionSelectionDashboard.razor.cs:199`).

### SessionSelectionDashboard
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.SessionSelection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionDashboard.razor.cs:13` · Level 7 · class (partial component)

- **What it is**: the organizer decision-support page for choosing a conference program. It picks an event (defaulting to the current or next one), loads its decision-support DTO (category distribution, speaker overlap, content similarity, locality breakdown, AI scores), owns the filter state the two child sections read, and drives an asynchronous "score all sessions with AI" flow with polling and progress feedback.
- **Depends on**: [ISessionSelectionUIService](#isessionselectionuiservice) (loads the dashboard, kicks off scoring, injected at `:15`), [IEventLookupService](#ieventlookupservice) (the event picker source, `:16`), MudBlazor's `ISnackbar` (`:17`), [SessionSelectionDashboardDTO](group-17-conference-domain.md#sessionselectiondashboarddto) with its [SessionAiScoreDTO](group-17-conference-domain.md#sessionaiscoredto) rows, [EventInfo](#eventinfo) (`:27`), [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) (default-event logic), [ConferenceRoutePaths](#conferenceroutepaths) (breadcrumbs), and the co-located [ScorePollTracker](#scorepolltracker) / [ScorePollSignal](#scorepollsignal). It composes [SessionSelectionSpeakerOverlap](#sessionselectionspeakeroverlap) and [SessionSelectionAiScores](#sessionselectionaiscores) in its markup, and the page is routed and role-gated in the `.razor` half (`@page "/sessions/selection-dashboard"` with `[Authorize(Roles = "Organizer")]`, `.../SessionSelectionDashboard.razor:1-2`).
- **Concept introduced: the smart (container) component that owns state and lifecycle.** This is the counterpart to the two presentational sections above. [Rubric §19, State Management] is fully exercised: the component holds the loaded DTO, the selected event id, the five `_filter*` fields, the derived filter-option lists, and the `_aiScoreLookup` (`:25-41`), and passes them down as parameters. [Rubric §18, UI Architecture] is served by splitting a large page into a container, two presentational children, and an extracted state machine. [Rubric §14, Testability] shows in `internal TimeSpan PollInterval` (`:242`), documented as internal precisely so bUnit tests can shrink the cadence and exercise the loop quickly (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/Pages/SessionSelection/SessionSelectionDashboardTests.cs:296`). [Rubric §27, i18n] applies throughout: every user-visible string resolves through the injected `IStringLocalizer<SessionSelectionDashboard>` (`.../SessionSelectionDashboard.razor:5`) against the co-located `SessionSelectionDashboard.resx` and its `.es.resx` translation. [Rubric §11, Security] applies with the usual caveat that the `Organizer` role attribute is a UX gate; the services behind it enforce authorization independently.
- **Walkthrough**: the component implements `IDisposable` and owns a `CancellationTokenSource` (`:19`) that every service call threads through; `Dispose` cancels and disposes it exactly once via the guarded `_disposed` pattern (`:356-378`). `OnInitializedAsync` (`:56-95`) builds the three breadcrumbs (`:58-63`), loads the events, and defaults the picker through [CurrentEventSelector](group-17-conference-domain.md#currenteventselector)`.SelectCurrentOrNext` (`:71-76`: live now, else next upcoming, else most recently ended). `OnEventSelectedAsync` (`:97-108`) reloads or clears the dashboard. `LoadDashboardAsync` (`:110-145`) fetches the DTO, then runs `ResetFilters` (`:152-159`), `ComputeFilterOptions` (`:161-197`), and `RebuildAiScoreLookup` (`:147-150`, a `SessionId` to `OverallScore` dictionary). `ComputeFilterOptions` is the notable one: statuses come from the union of speaker-overlap sessions and AI-score rows with `null` normalized to `"Accepted"` (`:173-178`), localities from the `SpeakerLocality` tiers (`:180-182`), and the "Level" category group is split out of the general category options by a title `Contains("Level")` match (`:184-196`). `ScoreTierOptions` (`:43-54`) pairs nine localized tier labels with the tokens [SessionSelectionDisplay](#sessionselectiondisplay)`.ScoreMatchesFilter` understands. The scoring flow starts at `ScoreSessionsAsync` (`:199-239`): it sets `_isScoring`, clears the existing scores with a `with` expression, and calls the service; a `SessionsScored == -1` result means the server accepted the work asynchronously, so it snackbars "started" and launches the fire-and-forget `PollForScoresAsync` (`:211-215`), while a normal result snackbars the scored and failed counts and reloads (`:216-221`). `PollForScoresAsync` (`:244-256`) wraps the loop in a `try/finally` whose sole job is to clear `_isScoring` on every exit path so the Score button always comes back. `RunScorePollingLoopAsync` (`:258-291`) creates a [ScorePollTracker](#scorepolltracker), loops up to `ScorePollTracker.MaxPolls`, awaits `PollInterval` and a fresh fetch under the cancellation token, resets the failure counter, and hands the observation to `HandlePollSignalAsync`; `OperationCanceledException` exits quietly (disposal), while any other exception is caught (with an explicit `CA1031` suppression at `:278-280`) and counted, ending the loop only when `RegisterFailure` says the budget is spent. Falling out of the `for` loop means the cap was reached, which snackbars a timeout (`:290`). `HandlePollSignalAsync` (`:298-326`) is the effects half of the split described under [ScorePollSignal](#scorepollsignal): it applies the fresh dashboard and re-renders on `Progressed`, does the same plus a success message on `CompletedAll`, defers to `FinishScoringStable` on `CompletedStable`, errors on `GaveUpNoScores`, and does nothing on `Continue`. `ApplyFreshDashboard` (`:328-333`) swaps the DTO and recomputes filter options and the score lookup. `FinishScoringStable` (`:335-347`) chooses between a partial warning (carrying the missed count) and a success message by comparing `AiScores.Count` against `TotalSessions`. `FinishScoring` (`:349-354`) resets `_isScoring`, snackbars, and requests a re-render.
- **Why it's built this way**: AI scoring is a long, failure-prone batch that depends on an external model with variable latency, so the page cannot block on it and there is no server push channel for this surface. Polling with a hard cap, a zero-progress early-out, a consecutive-failure budget, and a stability check gives the organizer an honest outcome in every case (started, progressed, complete, partial, timed out, never started), and cancelling the token on disposal keeps the loop from outliving the page. Extracting the counting rules into [ScorePollTracker](#scorepolltracker) leaves this class holding only lifecycle and UI effects.
- **Where it's used**: the organizer route `ConferenceRoutePaths.SessionSelectionDashboard` (`/sessions/selection-dashboard`), reachable from the `Nav.SessionSelection` admin item in [ConferenceUIModule](#conferenceuimodule); covered by `SessionSelectionDashboardTests` in the Conference UI bUnit tier.
- **Caveats / not-in-source**: the `-1` sentinel on `SessionsScored` is what distinguishes a deferred scoring start from a synchronous one; its meaning is relied on at `:211` but defined by the server-side handler behind [ISessionSelectionUIService](#isessionselectionuiservice), not in this component. The actual model, per-session timeout, and failure modes of scoring are likewise not determinable from this file.

### CategoryItemInfo

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ICategoryItemLookupService.cs:7` · Level 0 · record

- **What it is**: a four-field projection record that carries everything a Conference page needs to
  render one category item: `Id`, `Name`, `CategoryId`, and the parent category's `CategoryTitle`
  (`ICategoryItemLookupService.cs:7-11`). It is the value type of the category-item lookup dictionary,
  not a wire contract and not a domain type.
- **Depends on**: no first-party types. Its two id parameters use the Conference identifier aliases
  `CategoryItemIdentifierType` and `ConferenceCategoryIdentifierType`, both `int` in this module
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:5-6`).
  BCL `string`.
- **Concept introduced, the UI lookup projection.** `[Rubric §18, UI Architecture]` (assesses whether
  the front end keeps its own display-shaped models instead of dragging server contracts through the
  render tree; this record is a UI-owned shape with three display fields and one key).
  `[Rubric §23, Front-End Performance]` (assesses avoiding per-row round-trips: a list page holds
  category item *ids* but must render category item *names*, so the page pre-loads a dictionary of
  these records once and indexes it during render instead of issuing one request per row).
  `[Rubric §19, State Management]` (the dictionary is page-local state built in `OnInitializedAsync`,
  not an ambient store). The pattern repeats for events and speakers, see [EventInfo](#eventinfo) and
  [SpeakerInfo](#speakerinfo).
- **Walkthrough**: a positional record with four members and no body.
  - `Id` (`ICategoryItemLookupService.cs:8`): the dictionary key.
  - `Name` (line 9): the item's display name, for example a track or level value.
  - `CategoryId` (line 10): the owning category, which lets a page group items by category without a
    second fetch.
  - `CategoryTitle` (line 11): the parent category's title, **denormalized** onto the item. It is
    filled in by [CategoryItemLookupService](#categoryitemlookupservice) from a separate categories
    request and falls back to `string.Empty` when the parent title is not found
    (`CategoryItemLookupService.cs:41-42`).
- **Why it's built this way**: the denormalized `CategoryTitle` exists so a page can render the
  combined label without holding a second dictionary. [SessionDetail](#sessiondetail) does exactly
  that: `string.IsNullOrEmpty(item.CategoryTitle) ? item.Name : $"{item.CategoryTitle}: {item.Name}"`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Session/SessionDetail.razor.cs:150-151`),
  and [PublicSessionDetail](#publicsessiondetail) uses the same expression
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionDetail.razor.cs:152`).
  The empty-title fallback keeps the label sensible rather than rendering a stray colon.
- **Where it's used**: produced by [CategoryItemLookupService](#categoryitemlookupservice) through
  [ICategoryItemLookupService](#icategoryitemlookupservice); consumed by
  [SessionDetail](#sessiondetail) (`SessionDetail.razor.cs:74`, `:280`),
  [SpeakerDetail](#speakerdetail) (`SpeakerDetail.razor.cs:75`),
  [SpeakerCategoryItemsPanel](#speakercategoryitemspanel)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerCategoryItemsPanel.razor.cs:25`, `:52`),
  and [PublicSessionDetail](#publicsessiondetail).

### EventInfo

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IEventLookupService.cs:12` · Level 0 · record

- **What it is**: the event-side lookup projection: identity, name, the date window, the event's time
  zone, its published flag, and an optional sponsorship packet URL
  (`IEventLookupService.cs:12-19`). Beyond name enrichment it is the input to the "which event is the
  current one" decision that several pages make on load.
- **Depends on**: no first-party types. `EventIdentifierType` is `int` in this module
  (`MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:7`); BCL `DateOnly`, `string`, `bool`.
- **Concept**: the same UI lookup projection introduced by [CategoryItemInfo](#categoryiteminfo).
  What is new here is that the projection carries *decision* fields, not only display fields.
  `[Rubric §18, UI Architecture]` and `[Rubric §19, State Management]`: pages feed `StartDate`,
  `EndDate`, and `TimeZone` into the shared
  [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) to pick the current or
  next event, so the "default event filter" rule lives in one shared selector while the record just
  supplies its inputs.
- **Walkthrough**: a positional record with seven members.
  - `Id`, `Name` (`IEventLookupService.cs:13-14`): key plus display name.
  - `StartDate`, `EndDate` (lines 15-16): `DateOnly` bounds of the event.
  - `TimeZone` (line 17): the event's time zone id, passed to the selector so "current" is evaluated
    in the event's own zone rather than the browser's.
  - `IsPublished` (line 18).
  - `SponsorshipPacketUrl` (line 19): `string?` with a **default of `null`**. The remarks block
    (`IEventLookupService.cs:7-11`) records why: the many call sites that need only identity and dates
    stay unchanged, and only the public sponsor page reads it, to decide whether the sponsorship call
    to action renders at all.
- **Why it's built this way**: adding the optional parameter last with a default kept a wide set of
  construction sites source-compatible while the sponsor feature landed.
  `[Rubric §16, Maintainability]` (assesses whether a shape can grow without a ripple edit).
  [EventLookupService](#eventlookupservice) is the single place that fills every member
  (`EventLookupService.cs:28`).
- **Where it's used**: [PublicSponsorList](#publicsponsorlist) resolves the current or next event and
  then reads `SponsorshipPacketUrl` off it (`PublicSponsorList.razor.cs:49-61`);
  [SpeakerDashboard](#speakerdashboard) does the same resolution to scope the dashboard
  (`SpeakerDashboard.razor.cs:142-152`); the dictionary form is held by
  [SessionDetail](#sessiondetail) (`SessionDetail.razor.cs:72`), [SessionCreate](#sessioncreate)
  (`SessionCreate.razor.cs:41`), [RoomList](#roomlist) (`RoomList.razor.cs:32`),
  [RoomDetail](#roomdetail) (`RoomDetail.razor.cs:54`), [RoomCreate](#roomcreate)
  (`RoomCreate.razor.cs:30`), [SpeakerList](#speakerlist) (`SpeakerList.razor.cs:39`),
  [PublicSpeakerList](#publicspeakerlist) (`PublicSpeakerList.razor.cs:48`),
  [SessionSelectionDashboard](#sessionselectiondashboard) (`SessionSelectionDashboard.razor.cs:27`),
  and the sponsor admin pages (`SponsorList.razor.cs:39`, `SponsorDetail.razor.cs:55`,
  `SponsorCreate.razor.cs:75`).
- **Caveats / not-in-source**: `IsPublished` is populated on every entry
  (`EventLookupService.cs:28`) but no reader of `EventInfo.IsPublished` appears in the Conference UI
  or Engagement UI projects; Engagement's own `LiveEventService` filters on the DTO's flag instead
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/LiveEventService.cs:28`), which
  is a different type. Treat the member as available rather than as a load-bearing filter.

### IPublicLinkBuilder

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IPublicLinkBuilder.cs:9` · Level 0 · interface

- **What it is**: a one-method abstraction that turns an app-relative path into an absolute, publicly
  shareable URL (`IPublicLinkBuilder.cs:9-13`). It exists so share sheets, copy-link buttons, and QR
  payloads produce a URL that works when it leaves the app.
- **Depends on**: nothing first-party. BCL `Uri`, `string`.
- **Concept introduced, head-agnostic absolute link building.** `[Rubric §18, UI Architecture]`
  (assesses whether shared components stay host-agnostic instead of branching on the host they run
  in) and `[Rubric §25, Navigation & IA]` (assesses whether outbound links are built from one
  authority rather than string-concatenated per call site). The doc comment
  (`IPublicLinkBuilder.cs:3-8`) states the problem exactly: web heads can derive a shareable origin
  from the browser, but the MAUI head cannot, because its internal origin is the WebView's virtual
  host. Encoding that virtual origin into a QR code or a shared link would produce a URL nobody
  outside the app can open. One interface with two implementations moves the head-specific knowledge
  to the composition root and lets the pages stay identical on every head.
- **Walkthrough**: a single member, `Uri BuildAbsolute(string relativePath)`
  (`IPublicLinkBuilder.cs:12`). It returns a `Uri` rather than a `string`, so callers that need text
  do the `ToString()` themselves, and the doc comment gives `/conference/sessions/42` as the shape of
  the argument.
- **Why it's built this way**: the two implementations are registered under the same contract and the
  head that needs different behavior overrides the registration after module registration, the same
  head-override composition convention ADR-042 establishes for the device capability layer. The
  default browser-origin binding is registered at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:49` (with an
  explicit comment at lines 46-48 that the MAUI head overrides it and last registration wins), and the
  MAUI head does so at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:107`.
- **Where it's used**: implemented by [NavigationPublicLinkBuilder](#navigationpubliclinkbuilder)
  (web heads) and by [MauiPublicLinkBuilder](group-25-adc-host-composition.md#mauipubliclinkbuilder)
  (MAUI). Injected into the `SharePageButton` component
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Components/SharePageButton.razor:5`,
  used at `:42`), the `QrCodeButton` component (`Components/QrCodeButton.razor:2`, used at `:68`),
  and [SpeakerQr](#speakerqr), which builds its payload from the public speaker route
  (`Pages/Speaker/SpeakerQr.razor.cs:21`, `:55`).

### SpeakerInfo

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ISpeakerLookupService.cs:7` · Level 0 · record

- **What it is**: the speaker-side lookup projection, three fields wide: `Id`, `FullName`, and a
  nullable `ProfilePicture` (`ISpeakerLookupService.cs:7-10`). It is what pages index when they hold
  a speaker id and must render a name or an avatar.
- **Depends on**: no first-party types. `SpeakerIdentifierType` is `System.Guid` in this module
  (`MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:18`), unlike the other Conference aliases,
  which are `int`.
- **Concept**: the UI lookup projection introduced by [CategoryItemInfo](#categoryiteminfo); see
  there for the mechanism and the reason a page pre-loads a dictionary.
  `[Rubric §18, UI Architecture]`. `ProfilePicture` is nullable because not every speaker has an
  image, so the render path must have a fallback branch.
- **Walkthrough**: a positional record with three members and no body
  (`ISpeakerLookupService.cs:7-10`); it is filled member for member from the speaker DTO in
  [SpeakerLookupService](#speakerlookupservice) (`SpeakerLookupService.cs:28-29`).
- **Where it's used**: returned as the dictionary value of
  [ISpeakerLookupService.GetAllAsync](#ispeakerlookupservice), which the session and event pages
  inject to enrich speaker ids.
- **Caveats / not-in-source**: the name is reused. A separate, unrelated `SpeakerInfo` record exists
  in the Conference application layer for AI session scoring
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:23`,
  documented as [SpeakerInfo](group-18-conference-application.md#speakerinfo)). They share only a
  name; the namespaces keep them apart.

### ICategoryItemLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ICategoryItemLookupService.cs:16` · Level 1 · interface

- **What it is**: the contract for the category-item lookup: fetch everything once, hand back a
  dictionary (`ICategoryItemLookupService.cs:16-20`).
- **Depends on**: [CategoryItemInfo](#categoryiteminfo) (the dictionary value) and the
  `CategoryItemIdentifierType` alias. BCL `Task`, `IReadOnlyDictionary`, `CancellationToken`.
- **Concept introduced, the bulk-then-index lookup contract.** `[Rubric §23, Front-End Performance]`
  (assesses how many round-trips a render costs; one call plus O(1) dictionary reads replaces one
  request per referenced id) and `[Rubric §1, SOLID]` (a single-method interface is the smallest
  dependency a page can take, and it is what the UI tests substitute). Returning
  `IReadOnlyDictionary<,>` rather than a list is the point of the contract: the caller is told, by the
  type, that this is a key-indexed cache to read from, not a collection to search.
- **Walkthrough**: one member,
  `GetAllAsync(CancellationToken cancellationToken = default)` returning
  `Task<IReadOnlyDictionary<CategoryItemIdentifierType, CategoryItemInfo>>`
  (`ICategoryItemLookupService.cs:18-19`). The cancellation token is optional and defaulted, so page
  code can pass its own component-scoped token.
- **Why it's built this way**: pages depend on this interface, never on the HTTP class, so the two
  requests the implementation actually makes (categories, then items) stay an implementation detail.
- **Where it's used**: implemented by [CategoryItemLookupService](#categoryitemlookupservice),
  registered scoped at `DependencyInjection.cs:44`, and injected into
  [SessionDetail](#sessiondetail) (`SessionDetail.razor.cs:24`), [SpeakerDetail](#speakerdetail)
  (`SpeakerDetail.razor.cs:26`), and [PublicSessionDetail](#publicsessiondetail)
  (`PublicSessionDetail.razor.cs:25`).

### IEventLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IEventLookupService.cs:24` · Level 1 · interface

- **What it is**: the event counterpart of [ICategoryItemLookupService](#icategoryitemlookupservice):
  one call returning an event-keyed dictionary of [EventInfo](#eventinfo)
  (`IEventLookupService.cs:24-28`).
- **Depends on**: [EventInfo](#eventinfo) and the `EventIdentifierType` alias.
- **Concept**: identical bulk-then-index shape, see
  [ICategoryItemLookupService](#icategoryitemlookupservice). `[Rubric §23, Front-End Performance]`.
  This is the most widely injected of the three lookups because so many Conference surfaces are
  event-scoped.
- **Walkthrough**: one member, `GetAllAsync(CancellationToken cancellationToken = default)` returning
  `Task<IReadOnlyDictionary<EventIdentifierType, EventInfo>>` (`IEventLookupService.cs:26-27`).
- **Where it's used**: implemented by [EventLookupService](#eventlookupservice), registered scoped at
  `DependencyInjection.cs:43`, and injected into at least twelve Conference pages, including
  [RoomList](#roomlist) (`RoomList.razor.cs:18`), [RoomDetail](#roomdetail)
  (`RoomDetail.razor.cs:17`), [RoomCreate](#roomcreate) (`RoomCreate.razor.cs:12`),
  [SessionCreate](#sessioncreate) (`SessionCreate.razor.cs:18`), [SessionDetail](#sessiondetail)
  (`SessionDetail.razor.cs:22`), [SpeakerList](#speakerlist) (`SpeakerList.razor.cs:25`),
  [SpeakerDashboard](#speakerdashboard) (`SpeakerDashboard.razor.cs:23`),
  [SessionSelectionDashboard](#sessionselectiondashboard) (`SessionSelectionDashboard.razor.cs:16`),
  [OrganizerEventFeedback](#organizereventfeedback) (`OrganizerEventFeedback.razor.cs:18`),
  [PublicSpeakerList](#publicspeakerlist) (`PublicSpeakerList.razor.cs:32`),
  [PublicSponsorList](#publicsponsorlist) (`PublicSponsorList.razor.cs:26`), and the sponsor admin
  pages (`SponsorList.razor.cs:25`, `SponsorDetail.razor.cs:23`, `SponsorCreate.razor.cs:21`). It is
  also consumed from the Engagement module's event feedback page
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/Feedback/EventFeedback.razor.cs`),
  which is why `DependencyInjection.cs:41` labels these "cross-module lookup services".

### ISpeakerLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ISpeakerLookupService.cs:15` · Level 1 · interface

- **What it is**: the speaker lookup contract, one call returning a speaker-keyed dictionary of
  [SpeakerInfo](#speakerinfo) (`ISpeakerLookupService.cs:15-19`).
- **Depends on**: [SpeakerInfo](#speakerinfo) and the `SpeakerIdentifierType` alias (`Guid`).
- **Concept**: same bulk-then-index shape as
  [ICategoryItemLookupService](#icategoryitemlookupservice). `[Rubric §23, Front-End Performance]`,
  `[Rubric §18, UI Architecture]`.
- **Walkthrough**: one member, `GetAllAsync(CancellationToken cancellationToken = default)` returning
  `Task<IReadOnlyDictionary<SpeakerIdentifierType, SpeakerInfo>>` (`ISpeakerLookupService.cs:17-18`).
- **Where it's used**: implemented by [SpeakerLookupService](#speakerlookupservice), registered scoped
  at `DependencyInjection.cs:42`, and injected into the session and speaker pages that render speaker
  names and avatars.

### NavigationPublicLinkBuilder

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/NavigationPublicLinkBuilder.cs:10` · Level 1 · class (sealed)

- **What it is**: the default [IPublicLinkBuilder](#ipubliclinkbuilder), which resolves relative paths
  against the browser origin (`NavigationPublicLinkBuilder.cs:10-25`). It is correct for the Blazor
  Server and WebAssembly heads, where the browser origin *is* the public origin.
- **Depends on**: [IPublicLinkBuilder](#ipubliclinkbuilder) (the contract it implements) and the
  ASP.NET Core `NavigationManager` (`Microsoft.AspNetCore.Components`), whose `BaseUri` it reads.
- **Concept**: this is the "default" half of the head-override pair introduced at
  [IPublicLinkBuilder](#ipubliclinkbuilder). `[Rubric §18, UI Architecture]`. The class is deliberately
  tiny: the only host-specific knowledge it holds is "the shareable origin equals
  `NavigationManager.BaseUri`", and the MAUI head replaces exactly that assumption rather than
  reimplementing the URL composition.
- **Walkthrough**
  - `_navigationManager` (`NavigationPublicLinkBuilder.cs:12`): the single readonly field.
  - Constructor (lines 15-16): an expression-bodied constructor assigning the injected
    `NavigationManager`.
  - `BuildAbsolute(relativePath)` (line 19): guards the argument with
    `ArgumentException.ThrowIfNullOrWhiteSpace(relativePath)` (line 21), then composes
    `new Uri(new Uri(_navigationManager.BaseUri, UriKind.Absolute), relativePath)` (line 23). Using
    the two-argument `Uri` constructor means relative-path resolution follows the BCL rules rather
    than string concatenation, so a leading slash resolves from the origin and no double slash can
    appear.
- **Why it's built this way**: registering this as the module default
  (`DependencyInjection.cs:49`) means a web head needs no configuration at all, while the MAUI head
  pays the configuration cost only where it is unavoidable: its counterpart
  [MauiPublicLinkBuilder](group-25-adc-host-composition.md#mauipubliclinkbuilder) reads a pinned
  `PublicSite:BaseUrl` and throws at construction if it is missing
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Services/MauiPublicLinkBuilder.cs:20-23`).
- **Where it's used**: bound to [IPublicLinkBuilder](#ipubliclinkbuilder) as a scoped service in
  `AddConferenceUI` (`DependencyInjection.cs:49`); resolved by the share, QR, and speaker QR
  surfaces listed under [IPublicLinkBuilder](#ipubliclinkbuilder).

### IEventSpeakerUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IChildEntityUIService.cs:10` · Level 2 · interface

- **What it is**: the UI contract for managing `EventSpeaker` join rows, that is, attaching a speaker
  to an event and detaching one (`IChildEntityUIService.cs:10-14`). It is the first of four
  structurally identical join contracts declared in this one file.
- **Depends on**: [EventSpeakerDTO](group-17-conference-domain.md#eventspeakerdto) (the created row it
  returns) and the `EventIdentifierType`, `SpeakerIdentifierType`, `EventSpeakerIdentifierType`
  aliases. BCL `Task`, `CancellationToken`.
- **Concept introduced, the add/remove-only join contract.** `[Rubric §9, API & Contract Design]`
  (assesses whether a contract exposes the operations the resource actually supports; a join row has
  no fields to edit, so there is no `Update` and no `GetById`, only `Add` and `Delete`).
  `[Rubric §18, UI Architecture]` (a page edits an association through a typed service, not by
  hand-rolling a POST). `[Rubric §1, SOLID]`: four narrow interfaces instead of one generic
  `IJoinService<,>` means each page injects exactly the association it edits, and the implementations
  can keep strongly typed parameter names (`eventId`/`speakerId`) rather than two anonymous ids.
  Note the asymmetry that makes these contracts safe: `AddAsync` takes the two *parent* ids, while
  `DeleteAsync` takes the *join row's own* id, which is what the server returned when the row was
  created.
- **Walkthrough**
  - `AddAsync(eventId, speakerId, ct)` (`IChildEntityUIService.cs:12`): returns
    `Task<EventSpeakerDTO?>`, nullable because the created row is read back from the response body.
  - `DeleteAsync(id, ct)` (line 13): takes `EventSpeakerIdentifierType` and returns `Task<bool>`.
- **The family**: all four contracts in this file share that shape and differ only in the ids and the
  DTO.

  | Type | File:Line | Add parameters | Returns / delete key |
  |------|-----------|----------------|----------------------|
  | `IEventSpeakerUIService` | `IChildEntityUIService.cs:10` | `eventId`, `speakerId` | [EventSpeakerDTO](group-17-conference-domain.md#eventspeakerdto) / `EventSpeakerIdentifierType` |
  | `ISessionSpeakerUIService` | `IChildEntityUIService.cs:19` | `sessionId`, `speakerId` | [SessionSpeakerDTO](group-17-conference-domain.md#sessionspeakerdto) / `SessionSpeakerIdentifierType` |
  | `ISessionCategoryItemUIService` | `IChildEntityUIService.cs:28` | `sessionId`, `categoryItemId` | [SessionCategoryItemDTO](group-17-conference-domain.md#sessioncategoryitemdto) / `SessionCategoryItemIdentifierType` |
  | `ISpeakerCategoryItemUIService` | `IChildEntityUIService.cs:37` | `speakerId`, `categoryItemId` | [SpeakerCategoryItemDTO](group-17-conference-domain.md#speakercategoryitemdto) / `SpeakerCategoryItemIdentifierType` |

- **Why it's built this way**: keeping the four as separate interfaces in one file makes the family
  obvious to a reader while still giving DI four distinct binding targets
  (`DependencyInjection.cs:26-29`). The implementations are equally uniform: each derives from the
  shared [ChildEntityServiceBase](group-15-common-ui-framework.md#childentityservicebase) and supplies
  only its resource root (`ChildEntityServices.cs:15,31,47,63`).
- **Where it's used**: implemented by [EventSpeakerService](#eventspeakerservice)
  (`ChildEntityServices.cs:14`), registered scoped at `DependencyInjection.cs:26`, and injected into
  the event detail surface that associates speakers with an event.

### IOrganizerEventFeedbackUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IOrganizerFeedbackUIService.cs:10` · Level 2 · interface

- **What it is**: the organizer-facing contract for **event** feedback moderation: read every
  answer for an event, and delete one (`IOrganizerFeedbackUIService.cs:10-20`). Its doc comment
  (lines 6-9) ties it to business rule BR-53 and states the distinguishing property: unlike the
  attendee-facing service, this returns answers from all users.
- **Depends on**: [EventQuestionAnswerDTO](group-17-conference-domain.md#eventquestionanswerdto) and
  the `EventIdentifierType` / `EventQuestionAnswerIdentifierType` aliases.
- **Concept introduced, the audience-scoped read contract.** `[Rubric §11, Security]` (assesses
  whether authorization decisions are made by the server rather than assumed by the client: this
  interface is *named* for the organizer audience, but it carries no role logic of its own; the
  server widens the result set for organizer users, and the client simply asks for the full list).
  `[Rubric §9, API & Contract Design]`: a separate contract for the same underlying resource, keyed
  by audience, keeps the attendee path from accidentally acquiring an "all users" read. The delete is
  a moderation action, which is why an otherwise read-only organizer surface has one write.
- **Walkthrough**: two members, both `EventIdentifierType`-scoped.
  - `GetAllAnswersAsync(eventId, ct)` (`IOrganizerFeedbackUIService.cs:12-14`): returns
    `Task<IReadOnlyList<EventQuestionAnswerDTO>>`, a list rather than a paged envelope, so paging is
    the implementation's problem.
  - `DeleteAnswerAsync(eventId, answerId, ct)` (lines 16-19): returns plain `Task`, with the event id
    carried alongside the answer id because the endpoint scopes the delete to its parent.
- **Why it's built this way**: exposing `IReadOnlyList<T>` keeps the Blazor grid simple, and the
  implementation absorbs the transport shape; see
  [OrganizerEventFeedbackService](#organizereventfeedbackservice) for the paged request it actually
  issues and the ceiling that comes with it.
- **Where it's used**: implemented by [OrganizerEventFeedbackService](#organizereventfeedbackservice),
  registered scoped at `DependencyInjection.cs:35` (whose comment names BR-53 moderation), and
  injected into [OrganizerEventFeedback](#organizereventfeedback)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerEventFeedback.razor.cs:16`).

### IOrganizerSessionFeedbackUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IOrganizerFeedbackUIService.cs:26` · Level 2 · interface

- **What it is**: the **session** twin of
  [IOrganizerEventFeedbackUIService](#iorganizereventfeedbackuiservice), same two operations keyed on
  a session instead of an event (`IOrganizerFeedbackUIService.cs:26-36`), with the same BR-53
  all-users note in its doc comment (lines 22-25).
- **Depends on**: [SessionQuestionAnswerDTO](group-17-conference-domain.md#sessionquestionanswerdto)
  and the `SessionIdentifierType` / `SessionQuestionAnswerIdentifierType` aliases.
- **Concept**: see [IOrganizerEventFeedbackUIService](#iorganizereventfeedbackuiservice) for the
  audience-scoped read contract. `[Rubric §9, API & Contract Design]`.

  | Member | File:Line | Differs from the event twin |
  |--------|-----------|-----------------------------|
  | `GetAllAnswersAsync(sessionId, ct)` | `IOrganizerFeedbackUIService.cs:28-30` | scoped by `SessionIdentifierType`; returns `SessionQuestionAnswerDTO` |
  | `DeleteAnswerAsync(sessionId, answerId, ct)` | `IOrganizerFeedbackUIService.cs:32-35` | parent id is the session |

- **Where it's used**: implemented by
  [OrganizerSessionFeedbackService](#organizersessionfeedbackservice), registered scoped at
  `DependencyInjection.cs:36`, and injected into
  [OrganizerSessionFeedback](#organizersessionfeedback)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerSessionFeedback.razor.cs:16`).

### ISessionCategoryItemUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IChildEntityUIService.cs:28` · Level 2 · interface

- **What it is**: the join contract for tagging a session with a category item and untagging it
  (`IChildEntityUIService.cs:28-32`).
- **Depends on**: [SessionCategoryItemDTO](group-17-conference-domain.md#sessioncategoryitemdto) and
  the `SessionIdentifierType`, `CategoryItemIdentifierType`, `SessionCategoryItemIdentifierType`
  aliases.
- **Concept**: the add/remove-only join contract taught at
  [IEventSpeakerUIService](#ieventspeakeruiservice), including the family table.
  `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: `AddAsync(sessionId, categoryItemId, ct)` returning
  `Task<SessionCategoryItemDTO?>` (line 30) and `DeleteAsync(id, ct)` returning `Task<bool>`
  (line 31).
- **Where it's used**: implemented by [SessionCategoryItemService](#sessioncategoryitemservice)
  (`ChildEntityServices.cs:46`), registered at `DependencyInjection.cs:28`, injected into
  [SessionDetail](#sessiondetail) (`SessionDetail.razor.cs:26`), which pairs it with
  [ICategoryItemLookupService](#icategoryitemlookupservice) to offer the untagged items as choices.

### ISessionSpeakerUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IChildEntityUIService.cs:19` · Level 2 · interface

- **What it is**: the join contract for adding a speaker to a session and removing one
  (`IChildEntityUIService.cs:19-23`).
- **Depends on**: [SessionSpeakerDTO](group-17-conference-domain.md#sessionspeakerdto) and the
  `SessionIdentifierType`, `SpeakerIdentifierType`, `SessionSpeakerIdentifierType` aliases.
- **Concept**: see [IEventSpeakerUIService](#ieventspeakeruiservice) for the shared shape and the
  family table. `[Rubric §18, UI Architecture]`.
- **Walkthrough**: `AddAsync(sessionId, speakerId, ct)` returning `Task<SessionSpeakerDTO?>`
  (line 21) and `DeleteAsync(id, ct)` returning `Task<bool>` (line 22).
- **Where it's used**: implemented by [SessionSpeakerService](#sessionspeakerservice)
  (`ChildEntityServices.cs:30`), registered at `DependencyInjection.cs:27`, injected into
  [SessionDetail](#sessiondetail) (`SessionDetail.razor.cs:25`).

### ISpeakerCategoryItemUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IChildEntityUIService.cs:37` · Level 2 · interface

- **What it is**: the join contract for tagging a speaker with a category item, which is how speaker
  attributes such as locality are modeled, and untagging one (`IChildEntityUIService.cs:37-41`).
- **Depends on**: [SpeakerCategoryItemDTO](group-17-conference-domain.md#speakercategoryitemdto) and
  the `SpeakerIdentifierType`, `CategoryItemIdentifierType`, `SpeakerCategoryItemIdentifierType`
  aliases.
- **Concept**: see [IEventSpeakerUIService](#ieventspeakeruiservice). `[Rubric §9, API & Contract
  Design]`.
- **Walkthrough**: `AddAsync(speakerId, categoryItemId, ct)` returning
  `Task<SpeakerCategoryItemDTO?>` (line 39) and `DeleteAsync(id, ct)` returning `Task<bool>`
  (line 40).
- **Where it's used**: implemented by [SpeakerCategoryItemService](#speakercategoryitemservice)
  (`ChildEntityServices.cs:62`), registered at `DependencyInjection.cs:29`, injected into
  [SpeakerCategoryItemsPanel](#speakercategoryitemspanel)
  (`Pages/Speaker/SpeakerCategoryItemsPanel.razor.cs:18`), the component
  [SpeakerDetail](#speakerdetail) hosts.

### CategoryItemLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/CategoryItemLookupService.cs:11` · Level 3 · class (sealed)

- **What it is**: the implementation behind [ICategoryItemLookupService](#icategoryitemlookupservice).
  It makes **two** API calls, one for the categories and one for the items, then joins them in memory
  into a dictionary of [CategoryItemInfo](#categoryiteminfo) (`CategoryItemLookupService.cs:11-47`).
- **Depends on**: [CategoryItemInfo](#categoryiteminfo) (what it emits),
  [CategoryItemDTO](group-17-conference-domain.md#categoryitemdto) and
  [ConferenceCategoryDTO](group-17-conference-domain.md#conferencecategorydto) (the wire shapes it
  reads), [CollectionResult<T>](group-01-result-error-handling.md#collectionresultt) and
  [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) (the two
  envelopes those endpoints return). BCL `IHttpClientFactory` and `System.Net.Http.Json`. Note what
  it does **not** take: no token storage, so this is an unauthenticated read, unlike the entity
  services that derive from
  [AuthenticatedServiceBase](group-15-common-ui-framework.md#authenticatedservicebase).
- **Concept introduced, the client-side join.** `[Rubric §23, Front-End Performance]` and
  `[Rubric §8, Data Architecture]` (assesses where denormalization happens). The category item
  endpoint returns a `CategoryId` but not the category's title, and the UI wants the pair. Rather than
  asking the server for a nested projection or fetching the parent per item, the client pulls both
  small collections once and does the join itself, producing the denormalized
  [CategoryItemInfo](#categoryiteminfo). Two round-trips total, regardless of how many items or how
  many rows the page renders.
- **Walkthrough**: one method, `GetAllAsync(ct)` (`CategoryItemLookupService.cs:14`).
  - Resolves the named `"APIClient"` `HttpClient` from the factory in a `using` (line 17), so the
    per-call handler lifetime is the factory's concern.
  - GETs `conferencecategories?includeFKs=false&includeChildren=false` into a
    [CollectionResult<ConferenceCategoryDTO>](group-01-result-error-handling.md#collectionresultt)
    (lines 19-21). This one is the non-paged envelope: the category list is small and unpaged.
  - Builds a `Dictionary<ConferenceCategoryIdentifierType, string>` of category titles, null-guarding
    the wrapper and its `Items` (lines 23-30).
  - GETs `categoryitems?includeFKs=false&includeChildren=false&pageSize=10000` into a
    [PagedCollectionResult<CategoryItemDTO>](group-01-result-error-handling.md#pagedcollectionresultt)
    (lines 32-34), defaulting to an empty array when the wrapper is null (line 36).
  - Loops the items, resolving each parent title with `TryGetValue` and falling back to
    `string.Empty` when the category is missing, and stores a
    [CategoryItemInfo](#categoryiteminfo) per id (lines 38-43). Returns the dictionary as
    `IReadOnlyDictionary` (line 45).
- **Why it's built this way**: `includeFKs=false&includeChildren=false` keeps both payloads flat and
  small, which is the whole point of a lookup fetch: no navigation graphs, only the display fields.
  The `TryGetValue` fallback means a missing or newly added category degrades to an unprefixed label
  instead of throwing mid-render.
- **Where it's used**: registered scoped in `AddConferenceUI` (`DependencyInjection.cs:44`) against
  [ICategoryItemLookupService](#icategoryitemlookupservice); consumed by
  [SessionDetail](#sessiondetail), [SpeakerDetail](#speakerdetail), and
  [PublicSessionDetail](#publicsessiondetail).
- **Caveats / not-in-source**: the `pageSize=10000` request
  (`CategoryItemLookupService.cs:33`) is a hard ceiling; beyond 10,000 category items the lookup would
  silently drop the remainder, and there is no follow-on page request. The categories call has no
  page size at all, so it depends on that endpoint returning the full set. Nothing memoizes the
  result inside this class: each `GetAllAsync` call re-issues both requests, and the scoped
  registration only means one instance per request or circuit scope, not one fetch.

### EventLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/EventLookupService.cs:11` · Level 3 · class (sealed)

- **What it is**: the implementation behind [IEventLookupService](#ieventlookupservice): one bulk GET
  of the events collection, projected into a dictionary of [EventInfo](#eventinfo)
  (`EventLookupService.cs:11-33`).
- **Depends on**: [EventInfo](#eventinfo), [EventDTO](group-17-conference-domain.md#eventdto),
  [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt); BCL
  `IHttpClientFactory` and `System.Net.Http.Json`. Like its category-item sibling it takes no token
  storage, so this is an unauthenticated read.
- **Concept**: the bulk-fetch lookup taught at
  [CategoryItemLookupService](#categoryitemlookupservice), in its simplest form (one call, no join).
  `[Rubric §23, Front-End Performance]`. It is also the source of the current-event decision: the
  pages that need a default event filter call this and then hand `Values` to
  [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) with the
  `StartDate`/`EndDate`/`TimeZone` accessors and `DateTime.UtcNow`
  (`Pages/Public/PublicSponsorList.razor.cs:49-57`, `Pages/Speaker/SpeakerDashboard.razor.cs:146-152`).
- **Walkthrough**: one method, `GetAllAsync(ct)` (`EventLookupService.cs:14`).
  - Resolves the named `"APIClient"` client in a `using` (line 17).
  - GETs `events?includeFKs=false&includeChildren=false&pageSize=10000` into a
    [PagedCollectionResult<EventDTO>](group-01-result-error-handling.md#pagedcollectionresultt)
    (lines 19-21), null-defaulting to an empty array (line 23).
  - Projects each DTO into an [EventInfo](#eventinfo) carrying all seven members including
    `SponsorshipPacketUrl` (line 28), keyed by `evt.Id`, and returns the dictionary (line 31).
- **Why it's built this way**: the projection is the boundary between the transport contract and the
  UI's own model. Pages hold [EventInfo](#eventinfo) values, so a change to
  [EventDTO](group-17-conference-domain.md#eventdto) that does not affect these seven fields never
  reaches the pages. `[Rubric §16, Maintainability]`.
- **Where it's used**: registered scoped at `DependencyInjection.cs:43` against
  [IEventLookupService](#ieventlookupservice); consumed by the dozen-plus Conference pages listed
  under that interface, plus the Engagement event feedback page.
- **Caveats / not-in-source**: the same `pageSize=10000` ceiling as the other lookups
  (`EventLookupService.cs:20`), and the same absence of memoization: every call re-fetches the full
  event collection.

### IActivityUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IActivityUIService.cs:9` · Level 3 · interface

- **What it is**: the UI-service contract for the `activities` REST resource (the conference's social
  and networking programme). It is an empty marker interface,
  `public interface IActivityUIService : IEntityService<ActivityDTO, ActivityIdentifierType>`
  (`IActivityUIService.cs:9-11`), that adds no members of its own.
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  (the shared CRUD contract, imported from `MMCA.Common.UI.Common.Interfaces` at
  `IActivityUIService.cs:2`) and [`ActivityDTO`](group-17-conference-domain.md#activitydto) (the
  transported shape, from `MMCA.ADC.Conference.Shared.Activities` at `IActivityUIService.cs:1`).
  `ActivityIdentifierType` is the module id alias, `int`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:5`).
- **Concept introduced, the per-entity marker UI-service interface.** `[Rubric §18, UI Architecture]`
  (assesses whether the front end talks to a typed service abstraction rather than a raw `HttpClient`;
  here every Blazor page injects an *interface*, never the concrete HTTP class). `[Rubric §1, SOLID]`
  (the marker gives each aggregate its own injection point, so a page depends only on the contract it
  needs even though the shape is entirely inherited). The generic CRUD surface all comes from
  [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype);
  see that type for the mechanism. There is a second, load-bearing reason for the body-less
  specialization: registration is done by a Scrutor assembly scan, not by hand.
  `AddUIModule<ConferenceUIModule>()` scans the Conference UI assembly for every `IEntityService<,>`
  implementation and registers it `AsImplementedInterfaces()` with a scoped lifetime
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:155-159`, called at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:23`), so the named
  marker is exactly what a page gets to inject. Every plain-CRUD sibling in this group repeats this
  shape.
- **Walkthrough**: no members. The whole contract is "be an `IEntityService` bound to `ActivityDTO`
  plus `ActivityIdentifierType`, under a name pages can inject". The doc comment
  (`IActivityUIService.cs:6-8`) states plainly that it "uses generic CRUD".
- **Why it's built this way**: a named per-entity interface (rather than injecting the open generic
  directly) keeps the scan's `AsImplementedInterfaces()` registration unambiguous, and it lets one
  entity later grow an extra method without disturbing the others (exactly what
  [`IEventUIService`](#ieventuiservice), [`IRoomUIService`](#iroomuiservice), and
  [`ISpeakerUIService`](#ispeakeruiservice) did).
- **Where it's used**: implemented by [`ActivityService`](#activityservice) (Level 4); injected into
  the organizer activity list, detail, and create pages
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activity/ActivityList.razor.cs:24`,
  `Pages/Activity/ActivityDetail.razor.cs:20`, `Pages/Activity/ActivityCreate.razor.cs:18`) and into
  the anonymous public activity page
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicActivityList.razor.cs:26`).
  Note that the *same* contract serves both audiences: the organizer list sits behind
  `[Authorize(Roles = "Organizer")]` (`Pages/Activity/ActivityList.razor:2`) while the public page is
  anonymous (`Pages/Public/PublicActivityList.razor:1`), and the server, not the client, is what scopes
  non-privileged callers to published events (`Pages/Public/PublicActivityList.razor.cs:11-18`).

### ICategoryItemUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ICategoryItemUIService.cs:9` · Level 3 · interface

- **What it is**: the UI-service contract for the `categoryitems` REST resource, an empty marker over
  [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto) and
  `CategoryItemIdentifierType` (`ICategoryItemUIService.cs:9-11`).
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  (imported at `ICategoryItemUIService.cs:2`) and
  [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto) (imported at
  `ICategoryItemUIService.cs:1`).
- **Concept**: identical shape to [`IActivityUIService`](#iactivityuiservice); see it for the
  marker-interface and Scrutor-scan rationale. `[Rubric §18, UI Architecture]`.
- **Walkthrough**: no members. The doc comment (`ICategoryItemUIService.cs:6-8`) repeats the "uses
  generic CRUD" formula.
- **Where it's used**: implemented by [`CategoryItemService`](#categoryitemservice) (Level 4); injected
  into the conference-category detail page, which edits the items belonging to a category
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryDetail.razor.cs:16`).
  It is the one CRUD marker in this family with a single consumer: category items are only ever managed
  from inside their parent category, never as a top-level list.

### IConferenceCategoryUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IConferenceCategoryUIService.cs:9` · Level 3 · interface

- **What it is**: the UI-service contract for the `conferencecategories` REST resource, an empty marker
  over [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) and
  `ConferenceCategoryIdentifierType` (`IConferenceCategoryUIService.cs:9-11`).
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  and [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto).
- **Concept**: identical shape to [`IActivityUIService`](#iactivityuiservice); see it for the
  marker-interface and Scrutor-scan rationale. `[Rubric §18, UI Architecture]` and
  `[Rubric §16, Maintainability]` (a new aggregate resource costs one empty interface plus one thin
  class).
- **Walkthrough**: no members (doc comment `IConferenceCategoryUIService.cs:6-8`).
- **Where it's used**: implemented by [`ConferenceCategoryService`](#conferencecategoryservice);
  injected into the conference-category list, detail, and create pages
  (`Pages/ConferenceCategory/ConferenceCategoryList.razor.cs:16`,
  `Pages/ConferenceCategory/ConferenceCategoryDetail.razor.cs:15`,
  `Pages/ConferenceCategory/ConferenceCategoryCreate.razor.cs:11`) and into the speaker detail page,
  which reads the category tree to tag a speaker
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerDetail.razor.cs:25`).

### IEventUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IEventUIService.cs:10` · Level 3 · interface

- **What it is**: the UI-service contract for the `events` resource. Unlike the plain CRUD markers, it
  *extends* the generic surface with three event-specific operations: publish, unpublish, and a
  Sessionize refresh (`IEventUIService.cs:10-17`).
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [`EventDTO`](group-17-conference-domain.md#eventdto), and
  [`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto) (the
  refresh outcome). BCL `Task`, `CancellationToken`, `byte[]`.
- **Concept introduced, extending the generic UI service with resource-specific verbs.**
  `[Rubric §9, API & Contract Design]` (assesses whether non-CRUD state transitions get first-class,
  intention-revealing operations instead of being forced through a generic update). Publish and
  unpublish are lifecycle transitions on an event, and refresh triggers an external Sessionize sync,
  none of which is a CRUD `Update`, so they earn their own methods mapped to dedicated WebAPI endpoints
  (the doc comment, `IEventUIService.cs:6-9`, says exactly this). The second concept is in the
  signatures: both transitions take an **optional `byte[]? rowVersion`** (`IEventUIService.cs:12,14`),
  the optimistic-concurrency token the client echoes back from the
  [`EventDTO`](group-17-conference-domain.md#eventdto) it acted on, so a publish decided against a stale
  view surfaces as `409 Conflict` rather than applying silently. The contract for that round-trip is
  [`EventTransitionRequest`](group-17-conference-domain.md#eventtransitionrequest)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/EventTransitionRequest.cs:5-18`,
  rationale in [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). That
  makes this contract a `[Rubric §8, Data Architecture]` touch point as well: concurrency control
  reaches all the way up into the UI service signature instead of stopping at the database.
- **Walkthrough**: three declared members.
  - `PublishAsync(EventIdentifierType id, byte[]? rowVersion = null, CancellationToken)`
    (`IEventUIService.cs:12`), returns `Task<bool>`.
  - `UnpublishAsync(EventIdentifierType id, byte[]? rowVersion = null, CancellationToken)`
    (`IEventUIService.cs:14`), the mirror transition, same shape.
  - `RefreshFromSessionizeAsync(EventIdentifierType id, CancellationToken)` (`IEventUIService.cs:16`),
    returns `Task<RefreshFromSessionizeResultDTO?>` (the sync summary, nullable when the call yields no
    body). It takes no `rowVersion`: a Sessionize pull is not a lifecycle transition on the event row.
- **Why it's built this way**: the extra verbs live on the *interface* so the concrete
  [`EventService`](#eventservice) is the only place that knows the endpoint URLs; pages stay
  transport-agnostic. The `rowVersion` parameter is optional so a caller that has no token (or does not
  care) still compiles and falls back to the server's fresh-load domain guard, which the request record
  spells out (`EventTransitionRequest.cs:10-11`).
- **Where it's used**: implemented by [`EventService`](#eventservice) (Level 4); injected into the event
  list, detail, and create pages (`Pages/Event/EventList.razor.cs:21`,
  `Pages/Event/EventDetail.razor.cs:19`, `Pages/Event/EventCreate.razor.cs:15`), the public event browse
  pages (`Pages/Public/PublicEventList.razor.cs:34`, `Pages/Public/PublicEventDetail.razor.cs:18`), and
  the session list pages that need the owning event (`Pages/Session/SessionList.razor.cs:24`,
  `Pages/Public/PublicSessionList.razor.cs:32`).

### IQuestionUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IQuestionUIService.cs:9` · Level 3 · interface

- **What it is**: the UI-service contract for the `questions` resource, an empty marker over
  [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [`QuestionDTO`](group-17-conference-domain.md#questiondto) (`IQuestionUIService.cs:9-11`).
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  and [`QuestionDTO`](group-17-conference-domain.md#questiondto).
- **Concept**: same marker shape as [`IActivityUIService`](#iactivityuiservice); see there.
  `[Rubric §18, UI Architecture]`.
- **Walkthrough**: no members (doc comment `IQuestionUIService.cs:6-8`).
- **Where it's used**: injected into the question list, detail, and create pages
  (`Pages/Question/QuestionList.razor.cs:16`, `Pages/Question/QuestionDetail.razor.cs:15`,
  `Pages/Question/QuestionCreate.razor.cs:11`), into both organizer feedback pages, which need the
  question text to label the answers (`Pages/Feedback/OrganizerEventFeedback.razor.cs:17`,
  `Pages/Feedback/OrganizerSessionFeedback.razor.cs:17`), and into the speaker detail page
  (`Pages/Speaker/SpeakerDetail.razor.cs:27`). The concrete implementation,
  [`QuestionService`](#questionservice), is a thin `EntityServiceBase` subclass picked up by the
  assembly scan.

### IRoomUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IRoomUIService.cs:9` · Level 3 · interface

- **What it is**: the UI-service contract for the `rooms` resource. It extends the generic CRUD surface
  with a single specialized delete that also carries the owning event id (`IRoomUIService.cs:9-13`).
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [`RoomDTO`](group-17-conference-domain.md#roomdto) (note that `RoomDTO` lives in the
  `MMCA.ADC.Conference.Shared.Events` namespace, `IRoomUIService.cs:1`, because a room belongs to an
  event). `RoomIdentifierType` and `EventIdentifierType` id aliases.
- **Concept**: `[Rubric §9, API & Contract Design]` (assesses contracts that carry the parameters the
  server actually requires). A room is scoped to an event, so its delete needs the
  `EventIdentifierType` the WebAPI endpoint expects; the generic `DeleteAsync(id)` would omit it. The
  doc comment (`IRoomUIService.cs:11`) states the added overload "passes the required event ID to the
  API". This is the UI-side counterpart to the child-scoped delete used by the join services and by the
  organizer-feedback services in this same part.
- **Walkthrough**: one added member,
  `DeleteAsync(RoomIdentifierType roomId, EventIdentifierType eventId, CancellationToken)`
  (`IRoomUIService.cs:12`), returning `Task<bool>`. It supplements, rather than replaces, the inherited
  single-argument delete: both overloads are visible on the interface.
- **Where it's used**: implemented by [`RoomService`](#roomservice); injected into the room list,
  detail, and create pages (`Pages/Room/RoomList.razor.cs:17`, `Pages/Room/RoomDetail.razor.cs:16`,
  `Pages/Room/RoomCreate.razor.cs:11`) and into the session create/detail and public session detail
  pages, which render the room a session is scheduled in (`Pages/Session/SessionCreate.razor.cs:19`,
  `Pages/Session/SessionDetail.razor.cs:27`, `Pages/Public/PublicSessionDetail.razor.cs:24`).

### ISessionUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ISessionUIService.cs:9` · Level 3 · interface

- **What it is**: the UI-service contract for the `sessions` resource, an empty marker over
  [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [`SessionDTO`](group-17-conference-domain.md#sessiondto) (`ISessionUIService.cs:9-11`).
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  and [`SessionDTO`](group-17-conference-domain.md#sessiondto).
- **Concept**: same marker shape as [`IActivityUIService`](#iactivityuiservice).
  `[Rubric §18, UI Architecture]`. Worth pausing on what this contract does *not* carry: the
  personalized speaker-facing session reads live on a separate contract,
  [`ISpeakerDashboardUIService`](#ispeakerdashboarduiservice), because they must bypass the shared
  output cache. Keeping them apart is what lets this contract stay cache-friendly.
- **Walkthrough**: no members (doc comment `ISessionUIService.cs:6-8`).
- **Where it's used**: implemented by [`SessionService`](#sessionservice); injected into the session
  list, detail, and create pages (`Pages/Session/SessionList.razor.cs:23`,
  `Pages/Session/SessionDetail.razor.cs:21`, `Pages/Session/SessionCreate.razor.cs:17`), the public
  session pages (`Pages/Public/PublicSessionList.razor.cs:29`,
  `Pages/Public/PublicSessionDetail.razor.cs:22`), the organizer session-feedback page
  (`Pages/Feedback/OrganizerSessionFeedback.razor.cs:18`), and the speaker detail / public speaker
  detail pages that list a speaker's sessions (`Pages/Speaker/SpeakerDetail.razor.cs:24`,
  `Pages/Public/PublicSpeakerDetail.razor.cs:17`).

### ISpeakerDashboardUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ISpeakerDashboardUIService.cs:9` · Level 3 · interface

- **What it is**: a bespoke (non-CRUD) UI-service contract for a speaker's personalized dashboard: the
  sessions the speaker presents, per-session bookmark counts (single and batched), and per-session
  feedback (`ISpeakerDashboardUIService.cs:9-40`). It does **not** extend
  [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype);
  it is its own read-only interface, and it imports no `MMCA.Common.UI` interface at all
  (`ISpeakerDashboardUIService.cs:1-2`).
- **Depends on**: [`SessionDTO`](group-17-conference-domain.md#sessiondto) and
  [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto). `SpeakerIdentifierType`
  (a `Guid` in this module,
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:19`)
  and `SessionIdentifierType` id aliases.
- **Concept introduced, a cache-bypassing personalized read.** `[Rubric §23, Front-End Performance]`
  and `[Rubric §19, State Management]` (assess how the front end balances shared caching against
  read-your-writes freshness for a personalized view). The doc comment on `GetSpeakerSessionsAsync`
  (`ISpeakerDashboardUIService.cs:11-16`) is explicit and load-bearing: this read is fetched **fresh,
  bypassing the shared sessions output cache**, so a just-made speaker assignment is reflected
  immediately. Without the bypass, a read-populate-after-evict race on the output cache could leave a
  freshly assigned speaker seeing "no sessions". The contract, not just the implementation, is where
  that decision is written down.
- **Walkthrough**: four read methods, all `SpeakerIdentifierType`-scoped.
  - `GetSpeakerSessionsAsync(speakerId, ct)` (`ISpeakerDashboardUIService.cs:17-19`): returns
    `Task<IReadOnlyList<SessionDTO>>`, the speaker's sessions, uncached.
  - `GetSessionBookmarkCountAsync(speakerId, sessionId, ct)` (`ISpeakerDashboardUIService.cs:21-24`):
    returns `Task<int>`, the bookmark count for one of the speaker's sessions.
  - `GetSessionBookmarkCountsAsync(speakerId, sessionIds, ct)`
    (`ISpeakerDashboardUIService.cs:31-34`): returns
    `Task<IReadOnlyDictionary<SessionIdentifierType, int>>`, every requested session's active bookmark
    count in a single request. The doc comment (`ISpeakerDashboardUIService.cs:26-30`) records that it
    replaces the dashboard's per-session fan-out, that only sessions assigned to the speaker come back,
    and that sessions with no bookmarks map to 0. That is the `[Rubric §12, Performance & Scalability]`
    point in one signature: an N+1 of HTTP calls collapsed into one.
  - `GetSessionFeedbackAsync(speakerId, sessionId, ct)` (`ISpeakerDashboardUIService.cs:36-39`):
    returns `Task<SessionFeedbackDTO?>`, nullable when no feedback exists.
- **Why it's built this way**: keeping these on a dedicated interface (rather than folding them into
  [`ISessionUIService`](#isessionuiservice)) isolates the cache-bypass semantics to the personalized
  surface and keeps the generic session CRUD cache-friendly. It also keeps the speaker-scoped
  authorization story simple: every method takes the speaker id explicitly, so the server has the
  subject it needs to check ownership on every call.
- **Where it's used**: implemented by [`SpeakerDashboardService`](#speakerdashboardservice) and
  registered explicitly in the Conference UI DI
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:32`, an explicit
  `AddScoped` because it is not an `IEntityService<,>` and the assembly scan would not find it);
  injected into the speaker dashboard page
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerDashboard.razor.cs:22`).

### ISpeakerUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ISpeakerUIService.cs:9` · Level 3 · interface

- **What it is**: the UI-service contract for the `speakers` resource, extending generic CRUD with two
  user-linking operations (`ISpeakerUIService.cs:9-14`).
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [`SpeakerDTO`](group-17-conference-domain.md#speakerdto). `SpeakerIdentifierType` and
  `UserIdentifierType` id aliases (the second one crosses into Identity's vocabulary as a scalar, never
  as a project reference).
- **Concept**: `[Rubric §9, API & Contract Design]` (state-transition verbs over generic update, same
  rationale as [`IEventUIService`](#ieventuiservice)). Linking a speaker to a user account is a distinct
  operation, not a field edit, so it gets `LinkUserAsync` / `UnlinkUserAsync`.
  `[Rubric §7, Microservices Readiness]`: the UI issues one call against Conference, and the Identity
  side of the association is reconciled asynchronously by the `SpeakerLinkedToUser` /
  `SpeakerUnlinkedFromUser` integration events
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/IntegrationEvents/SpeakerLinkedToUser.cs:20`
  and `.../SpeakerUnlinkedFromUser.cs:17`, handled at
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerLinkedToUserHandler.cs:20`),
  so this contract deliberately says nothing about Identity. `[Rubric §18, UI Architecture]`.
- **Walkthrough**: two added members.
  - `LinkUserAsync(SpeakerIdentifierType speakerId, UserIdentifierType userId, CancellationToken)`
    (`ISpeakerUIService.cs:11`): returns `Task<bool>`.
  - `UnlinkUserAsync(SpeakerIdentifierType speakerId, CancellationToken)` (`ISpeakerUIService.cs:13`):
    returns `Task<bool>`; unlink needs only the speaker id.
- **Where it's used**: implemented by [`SpeakerService`](#speakerservice); injected into the speaker
  list, detail, create, and dashboard pages (`Pages/Speaker/SpeakerList.razor.cs:24`,
  `Pages/Speaker/SpeakerDetail.razor.cs:23`, `Pages/Speaker/SpeakerCreate.razor.cs:15`,
  `Pages/Speaker/SpeakerDashboard.razor.cs:21`) and the public speaker pages
  (`Pages/Public/PublicSpeakerList.razor.cs:44`, `Pages/Public/PublicSpeakerDetail.razor.cs:16`).

### ISponsorUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ISponsorUIService.cs:9` · Level 3 · interface

- **What it is**: the UI-service contract for the `sponsors` REST resource, an empty marker over
  [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [`SponsorDTO`](group-17-conference-domain.md#sponsordto) and `SponsorIdentifierType`
  (`ISponsorUIService.cs:9-11`).
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  and [`SponsorDTO`](group-17-conference-domain.md#sponsordto) (from
  `MMCA.ADC.Conference.Shared.Sponsors`, `ISponsorUIService.cs:1`).
- **Concept**: the same marker shape taught under [`IActivityUIService`](#iactivityuiservice); the doc
  comment (`ISponsorUIService.cs:6-8`) repeats the "uses generic CRUD" formula verbatim.
  `[Rubric §16, Maintainability]` is the point worth pausing on: the whole sponsor admin surface plus a
  public sponsor page costs exactly one empty interface and one four-line class
  ([`SponsorService`](#sponsorservice)), because the CRUD algorithm, the auth, the retry, and the error
  translation are all inherited. `[Rubric §18, UI Architecture]`.
- **Walkthrough**: no members.
- **Why it's built this way**: sponsor management is plain CRUD from the client's point of view, so the
  contract adds nothing; the named marker exists so the Scrutor scan inside
  `AddUIModule<ConferenceUIModule>()` can bind a concrete implementation to a name the pages inject
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:23`).
- **Where it's used**: implemented by [`SponsorService`](#sponsorservice)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/SponsorService.cs:10`); injected
  into the sponsor list, detail, and create pages and the anonymous public sponsor list
  (`Pages/Sponsor/SponsorList.razor.cs:24`, `Pages/Sponsor/SponsorDetail.razor.cs:22`,
  `Pages/Sponsor/SponsorCreate.razor.cs:20`, `Pages/Public/PublicSponsorList.razor.cs:25`).

### OrganizerEventFeedbackService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/OrganizerFeedbackService.cs:15` · Level 3 · class (sealed)

- **What it is**: an authenticated HTTP service that reads and deletes **event** feedback answers on
  behalf of an organizer, who sees all answers (`OrganizerFeedbackService.cs:15-57`). It implements
  [`IOrganizerEventFeedbackUIService`](#iorganizereventfeedbackuiservice).
- **Depends on**: [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase)
  (its base, supplying `CreateAuthenticatedClientAsync` and the shared Polly `RetryPolicy`),
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) (the bearer-token
  source), [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper)
  (domain-error translation),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) (the paged
  envelope), and [`EventQuestionAnswerDTO`](group-17-conference-domain.md#eventquestionanswerdto). BCL
  `IHttpClientFactory`, `System.Net.Http.Json`, `System.Globalization`.
- **Concept introduced, the authenticated organizer read-service over a token-carrying HttpClient.**
  `[Rubric §18, UI Architecture]` and `[Rubric §11, Security]` (assess how UI calls attach auth and
  handle failures). The class derives from
  [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) through a
  primary constructor that forwards `IHttpClientFactory` and
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) to the base
  (`OrganizerFeedbackService.cs:15-17`); every request goes through `CreateAuthenticatedClientAsync()`
  so the JWT is attached centrally rather than per call. The doc comment
  (`OrganizerFeedbackService.cs:11-14`) records the authorization intent: organizers see all answers
  because the server-side specification is null for organizer users, so this client simply requests the
  full paged set and does no filtering of its own. Note the direction of trust: the client is not the
  thing granting the wide view, the server is.
- **Walkthrough**
  - `Endpoint` (`OrganizerFeedbackService.cs:19`): the `private const string "eventquestionanswers"`
    resource root.
  - `GetAllAnswersAsync(eventId, ct)` (`OrganizerFeedbackService.cs:21`): takes a client from
    `CreateAuthenticatedClientAsync()` (line 25), builds
    `{Endpoint}/paged?filters[EventId].operator=equals&filters[EventId].value={eventId}&pageSize=500&includeChildren=false`
    with `string.Create(CultureInfo.InvariantCulture, ...)` (lines 27-28, culture-invariant so the
    numeric id renders stably), runs the GET inside `RetryPolicy.ExecuteAsync` (lines 30-31), calls
    `EnsureSuccessStatusCode()` (line 33), deserializes a
    [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) of
    [`EventQuestionAnswerDTO`](group-17-conference-domain.md#eventquestionanswerdto) (lines 35-36), and
    returns its `Items`, an empty list when the body was null (line 38). The `filters[...]` query
    grammar is the same dynamic-filter contract the Conference REST controllers expose (see
    [ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html)), so the client
    needs no bespoke endpoint.
  - `DeleteAnswerAsync(eventId, answerId, ct)` (`OrganizerFeedbackService.cs:41`): builds
    `{Endpoint}/{answerId}?eventId={eventId}` (line 48, the event id is a required query argument,
    mirroring the child-scoped delete pattern), issues the DELETE through the retry policy (lines
    49-50), and on a non-success status routes the response through
    [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper)'s
    `ThrowIfDomainExceptionAsync` (lines 52-53) so a domain error surfaces as a typed exception before
    the final `EnsureSuccessStatusCode()` (line 55). It returns a bare `Task`: success is "did not
    throw".
- **Why it's built this way**: inheriting the authenticated base means token attachment and the Polly
  retry live in one shared place; the service owns only the URL shapes and the organizer-sees-all read.
  Asking for `pageSize=500` in a single call keeps the organizer feedback grid simple (no client-side
  paging) at the cost of a hard ceiling, see the caveat.
- **Where it's used**: registered explicitly as
  [`IOrganizerEventFeedbackUIService`](#iorganizereventfeedbackuiservice) in the Conference UI DI
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:35`, under the
  comment naming BR-53 moderation) and injected into the organizer event-feedback page
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerEventFeedback.razor.cs`).
- **Caveats / not-in-source**: the read is capped at `pageSize=500` (`OrganizerFeedbackService.cs:28`);
  an event with more than 500 answers would be truncated, and there is no follow-on paging in this
  method. `GetAllAnswersAsync` does not call `ThrowIfDomainExceptionAsync` (only the delete does), so a
  failed read surfaces as the raw `EnsureSuccessStatusCode()` exception.

### OrganizerSessionFeedbackService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/OrganizerFeedbackService.cs:62` · Level 3 · class (sealed)

- **What it is**: the **session** counterpart to
  [`OrganizerEventFeedbackService`](#organizereventfeedbackservice), structurally identical but keyed on
  `SessionId` and the `sessionquestionanswers` resource (`OrganizerFeedbackService.cs:62-104`). It
  implements [`IOrganizerSessionFeedbackUIService`](#iorganizersessionfeedbackuiservice).
- **Depends on**: the same set as its event sibling, with
  [`SessionQuestionAnswerDTO`](group-17-conference-domain.md#sessionquestionanswerdto) in place of the
  event answer DTO; base [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase),
  [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt).
- **Concept**: see [`OrganizerEventFeedbackService`](#organizereventfeedbackservice) for the
  authenticated-read pattern; this class differs only in the entity it keys on. The two are the same
  shape at different resource roots, which is why they share a file.

  | Type | File:Line | Notes (what differs) |
  |------|-----------|----------------------|
  | `OrganizerEventFeedbackService` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/OrganizerFeedbackService.cs:15` | `eventquestionanswers` root (line 19); filters on `EventId`; delete scoped `?eventId=` (line 48) |
  | `OrganizerSessionFeedbackService` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/OrganizerFeedbackService.cs:62` | `sessionquestionanswers` root (line 66); filters on `SessionId`; delete scoped `?sessionId=` (line 95) |

- **Walkthrough**: mechanically the same as the event service. The paged GET
  (`OrganizerFeedbackService.cs:68`) uses the same `pageSize=500&includeChildren=false` shape and
  culture-invariant URL build (lines 74-75), runs inside `RetryPolicy.ExecuteAsync` (lines 77-78), and
  returns `Items` or an empty list (line 85); the DELETE (line 88) routes non-success responses through
  [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper)'s
  `ThrowIfDomainExceptionAsync` (lines 99-100) before `EnsureSuccessStatusCode()` (line 102).
- **Why it's built this way**: two small parallel classes are cheaper to read than one generic service
  parameterized over "the parent key", and each one's URL shape stays literal and greppable.
- **Where it's used**: registered as
  [`IOrganizerSessionFeedbackUIService`](#iorganizersessionfeedbackuiservice)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:36`) and injected
  into the organizer session-feedback page
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerSessionFeedback.razor.cs`).
- **Caveats / not-in-source**: same `pageSize=500` ceiling as the event sibling
  (`OrganizerFeedbackService.cs:75`), and the same read path with no domain-error translation.

### SpeakerLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/SpeakerLookupService.cs:11` · Level 3 · class (sealed)

- **What it is**: a small read service that fetches every speaker once and builds a speaker-keyed lookup
  dictionary (`SpeakerIdentifierType` to [`SpeakerInfo`](#speakerinfo)) so pages can enrich raw speaker
  ids with display names and profile pictures (`SpeakerLookupService.cs:11-34`). It implements
  [`ISpeakerLookupService`](#ispeakerlookupservice).
- **Depends on**: [`SpeakerInfo`](#speakerinfo) (the lightweight projection it emits),
  [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) (the wire shape it reads),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt); BCL
  `IHttpClientFactory` and `System.Net.Http.Json`. Note that it takes only `IHttpClientFactory` and no
  token storage (`SpeakerLookupService.cs:11`): this is an unauthenticated public read, and it does not
  derive from [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase).
- **Concept introduced, the client-side denormalizing lookup.** `[Rubric §23, Front-End Performance]`
  (assesses avoiding N per-item round-trips). Session and event pages hold speaker *ids* but must show
  speaker *names*; rather than fetch each speaker individually, this service pulls the whole speaker set
  in one call and hands back an in-memory dictionary the page indexes locally. The doc comment
  (`SpeakerLookupService.cs:7-10`) states that use directly. `[Rubric §9, API & Contract Design]` shows
  up in the query string: `includeFKs=false&includeChildren=false` asks the server for the flat rows
  only, so the bulk read stays cheap on both ends.
- **Walkthrough**: one method, `GetAllAsync(ct)` (`SpeakerLookupService.cs:14-15`). It resolves the
  named `"APIClient"` `HttpClient` from the factory (line 17), GETs
  `speakers?includeFKs=false&includeChildren=false&pageSize=10000` (a deliberately large page to pull
  every speaker in one request, lines 19-21), takes `wrapper?.Items` or an empty list (line 23), then
  loops building a `Dictionary<SpeakerIdentifierType, SpeakerInfo>` whose entries carry `Id`,
  `FullName`, and `ProfilePicture` (lines 25-30), and returns it as an `IReadOnlyDictionary` (line 32).
- **Why it's built this way**: one bulk fetch plus a local index is far cheaper than per-id lookups when
  a page renders many speaker references; the projection to [`SpeakerInfo`](#speakerinfo) keeps only the
  three display fields the UI needs, not the full
  [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), so the dictionary a page holds in memory
  stays small.
- **Where it's used**: registered as [`ISpeakerLookupService`](#ispeakerlookupservice) among the
  "cross-module lookup services"
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:42`) and injected
  into the session list, session detail, public session list, and public session detail pages
  (`Pages/Session/SessionList.razor.cs:25`, `Pages/Session/SessionDetail.razor.cs:23`,
  `Pages/Public/PublicSessionList.razor.cs:33`, `Pages/Public/PublicSessionDetail.razor.cs:23`).
- **Caveats / not-in-source**: the `pageSize=10000` ceiling (`SpeakerLookupService.cs:20`) assumes the
  conference never exceeds 10,000 speakers; beyond that the lookup would silently miss speakers. The
  dictionary is built fresh on every call (there is no memoization in this class), so a page that needs
  it twice pays for it twice.

### ActivityService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ActivityService.cs:10` · Level 4 · class (sealed)

- **What it is**: the concrete HTTP service for the `activities` resource, a body-less class that
  inherits all CRUD from the shared base and binds the endpoint name (`ActivityService.cs:10-14`). It
  implements [`IActivityUIService`](#iactivityuiservice).
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  (its base, from `MMCA.Common.UI.Services` at `ActivityService.cs:2`),
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) (from
  `MMCA.Common.UI.Services.Auth` at `ActivityService.cs:3`), and
  [`ActivityDTO`](group-17-conference-domain.md#activitydto); BCL `IHttpClientFactory`.
- **Concept introduced, the four-line concrete UI service (Template Method with a supplied endpoint).**
  `[Rubric §2, Design Patterns]` (assesses whether a shared algorithm is factored once and specialized
  by leaves; here the base owns the CRUD algorithm and the leaf supplies only the resource name) and
  `[Rubric §16, Maintainability]` (a new plain-CRUD resource costs one tiny class). The primary
  constructor forwards `IHttpClientFactory` and
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) plus the literal
  resource name `"activities"` to
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  closed over `ActivityDTO` and `ActivityIdentifierType` (`ActivityService.cs:10-12`); the class body is
  empty (`ActivityService.cs:13-14`). Every CRUD method, along with the auth, the Polly retry, the
  serialization, and the domain-error translation, comes from the base, see
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  in Group 15. Every plain-CRUD concrete service in this group repeats this shape.
- **Walkthrough**: no members. The whole class is the base call carrying the resource root
  `"activities"` (`ActivityService.cs:12`) and the declaration that it satisfies
  [`IActivityUIService`](#iactivityuiservice) (same line). The doc comment (`ActivityService.cs:7-9`)
  says only that it "provides standard CRUD".
- **Why it's built this way**: the endpoint name is the only thing that varies for a plain CRUD
  aggregate, so the concrete class carries exactly that and nothing else. `sealed`
  (`ActivityService.cs:10`) closes the leaf: specialization belongs on the interface or in the base, not
  in a subclass of a subclass.
- **Where it's used**: never named in DI by hand. Because it is an `IEntityService<,>` implementation in
  the Conference UI assembly, the Scrutor scan inside `AddUIModule<ConferenceUIModule>()` registers it
  `AsImplementedInterfaces()` with a scoped lifetime
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:23` calling
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:155-159`), which is what makes
  [`IActivityUIService`](#iactivityuiservice) resolvable in [`ActivityList`](#activitylist),
  [`ActivityDetail`](#activitydetail), [`ActivityCreate`](#activitycreate), and
  [`PublicActivityList`](#publicactivitylist).

### CategoryItemService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/CategoryItemService.cs:10` · Level 4 · class (sealed)

- **What it is**: the concrete HTTP service for the `categoryitems` resource, structurally identical to
  [`ActivityService`](#activityservice) but bound to
  [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto) and `CategoryItemIdentifierType`
  (`CategoryItemService.cs:10-14`). It implements [`ICategoryItemUIService`](#icategoryitemuiservice).
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  (its base), [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice),
  [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto); BCL `IHttpClientFactory`.
- **Concept**: identical to [`ActivityService`](#activityservice); see it for the thin-class rationale.
  The only differences are the resource root `"categoryitems"` (`CategoryItemService.cs:12`), the DTO
  plus identifier alias, and the interface it satisfies. `[Rubric §16, Maintainability]`.
- **Walkthrough**: no members. The base call passes `"categoryitems"` alongside the factory and token
  storage (`CategoryItemService.cs:10-12`), and the same line declares
  [`ICategoryItemUIService`](#icategoryitemuiservice).
- **Where it's used**: picked up by the same assembly scan as its siblings
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:23`) and resolved
  through [`ICategoryItemUIService`](#icategoryitemuiservice) in
  [`ConferenceCategoryDetail`](#conferencecategorydetail)
  (`Pages/ConferenceCategory/ConferenceCategoryDetail.razor.cs:16`).

### ConferenceCategoryService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ConferenceCategoryService.cs:10` · Level 4 · class (sealed)

- **What it is**: the concrete HTTP service for the `conferencecategories` resource, structurally
  identical to [`CategoryItemService`](#categoryitemservice) but bound to
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) and
  `ConferenceCategoryIdentifierType` (`ConferenceCategoryService.cs:10-14`). It implements
  [`IConferenceCategoryUIService`](#iconferencecategoryuiservice).
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype),
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice),
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto).
- **Concept**: identical to [`ActivityService`](#activityservice); see it for the thin-class rationale.
  The only differences are the resource root `"conferencecategories"`
  (`ConferenceCategoryService.cs:12`), the DTO plus identifier alias, and the interface it satisfies.
  `[Rubric §16, Maintainability]`. Reading these three classes back to back is the clearest evidence of
  what the shared base buys: three resources, twelve lines of code, zero duplicated HTTP handling.
- **Walkthrough**: no members; the base call passes `"conferencecategories"` alongside the factory and
  token storage (`ConferenceCategoryService.cs:10-12`).
- **Where it's used**: picked up by the same assembly scan as its siblings and resolved through
  [`IConferenceCategoryUIService`](#iconferencecategoryuiservice) in
  [`ConferenceCategoryList`](#conferencecategorylist)
  (`Pages/ConferenceCategory/ConferenceCategoryList.razor.cs:16`),
  [`ConferenceCategoryDetail`](#conferencecategorydetail)
  (`Pages/ConferenceCategory/ConferenceCategoryDetail.razor.cs:15`),
  [`ConferenceCategoryCreate`](#conferencecategorycreate)
  (`Pages/ConferenceCategory/ConferenceCategoryCreate.razor.cs:11`), and
  [`SpeakerDetail`](#speakerdetail) (`Pages/Speaker/SpeakerDetail.razor.cs:25`).

### ISessionSelectionUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ISessionSelectionUIService.cs:8` · Level 4 · interface

- **What it is**: the UI-service contract for the organizer's session-selection decision-support
  dashboard: read the dashboard, and trigger a scoring pass over one event's sessions
  (`ISessionSelectionUIService.cs:8-17`). It is a bespoke (non-CRUD) interface: it does **not** extend
  [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype),
  because decision support is a pair of computed operations, not an entity surface.
- **Depends on**: [`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto)
  (the dashboard payload) and [`ScoreEventSessionsResultDTO`](group-17-conference-domain.md#scoreeventsessionsresultdto)
  (the scoring outcome), both from `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport`
  (`ISessionSelectionUIService.cs:1`); the `EventIdentifierType` alias.
- **Concept**: `[Rubric §18, UI Architecture]` (assesses whether pages depend on narrow, typed UI-service
  contracts instead of raw HTTP; the Blazor page sees two methods and never a URL) and
  `[Rubric §9, API & Contract Design]` (assesses interface segregation on the client side; decision
  support lives on its own contract rather than swelling
  [`ISessionUIService`](#isessionuiservice)). The two members map one to one onto two of the endpoints on
  [`SessionSelectionController`](group-20-conference-api-grpc.md#sessionselectioncontroller): the
  `GET dashboard/{eventId}` read (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSelectionController.cs:39`)
  and the `POST score/{eventId}` command (`SessionSelectionController.cs:105`). The controller exposes
  three further analytical GETs (categories, speaker-overlap, content-similarity, `:53,67,81`) that this
  UI contract deliberately does not surface.
- **Walkthrough**: two members, both scoped by `EventIdentifierType` and both nullable-returning.
  - `GetDashboardAsync(eventId, ct)` (`ISessionSelectionUIService.cs:10-12`): returns
    `Task<SessionSelectionDashboardDTO?>`; `null` when the read did not succeed.
  - `ScoreSessionsAsync(eventId, ct)` (`ISessionSelectionUIService.cs:14-16`): returns
    `Task<ScoreEventSessionsResultDTO?>`, the outcome of a scoring pass.
- **Why it's built this way**: keeping the analytical surface on its own interface matches its lifecycle,
  an organizer-only screen backed by dedicated controller endpoints, and lets the implementation extend
  [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) rather than the
  CRUD base.
- **Where it's used**: implemented by [`SessionSelectionService`](#sessionselectionservice), registered
  explicitly in the Conference UI composition root
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:39`), and injected
  into [`SessionSelectionDashboard`](#sessionselectiondashboard)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionDashboard.razor.cs:15`).

### QuestionService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/QuestionService.cs:10` · Level 4 · class (sealed)

- **What it is**: a **body-less** concrete CRUD service for the `questions` WebAPI resource. It extends
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  over [`QuestionDTO`](group-17-conference-domain.md#questiondto) / `QuestionIdentifierType`, passes the
  REST resource name to the base constructor, and implements the equally empty
  [`IQuestionUIService`](#iquestionuiservice), inheriting the *entire* CRUD implementation with no added
  code (`QuestionService.cs:10-14`).
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:25`);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) for the circuit-scoped
  JWT; [`QuestionDTO`](group-17-conference-domain.md#questiondto);
  [`IQuestionUIService`](#iquestionuiservice); BCL `IHttpClientFactory`.
- **Concept introduced, the "3-line CRUD service" (Template Method with a supplied endpoint).** Every
  behavior a page needs (`GetAllAsync`, `GetPagedAsync`, `GetByIdAsync`, `AddAsync`, `UpdateAsync`,
  `DeleteAsync`, `GetAllForLookupAsync`) lives on the base, together with the central `SendRequestAsync`
  dispatch (`EntityServiceBase.cs:183-224`) that runs the call through the Polly retry policy
  (`EntityServiceBase.cs:204`), extracts domain errors via
  [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper) before
  `EnsureSuccessStatusCode()` (`EntityServiceBase.cs:210-213`), and skips deserialization when
  `expectContent: false` (`EntityServiceBase.cs:215-216`). The subclass supplies only the endpoint string
  and ties the two generic parameters together. `[Rubric §2, Design Patterns]` (assesses whether a shared
  algorithm is factored once and specialized by leaves; here the base owns the CRUD algorithm and the leaf
  supplies the resource name, a textbook Template Method) and `[Rubric §16, Maintainability]` (assesses
  the cost of one more like-for-like feature; a new plain-CRUD resource costs one tiny class).
- **Walkthrough**: a primary-constructor class whose base call is the only content
  (`QuestionService.cs:10-12`): `EntityServiceBase<QuestionDTO, QuestionIdentifierType>("questions",
  httpClientFactory, tokenStorageService)`. The body is empty (`QuestionService.cs:13-14`).
- **Why it's built this way**: questions need nothing beyond CRUD in the UI, so an empty subclass is the
  smallest concrete type that still gives DI a binding for
  [`IQuestionUIService`](#iquestionuiservice) and keeps the resource name in exactly one place.
- **Where it's used**: picked up automatically by the Scrutor scan inside `AddUIModule<ConferenceUIModule>()`
  (`DependencyInjection.cs:23`), which registers every `IEntityService<,>` implementation in the
  [`ConferenceUIModule`](#conferenceuimodule) assembly `AsImplementedInterfaces()` with a scoped lifetime
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:155-159`), so no explicit
  `AddScoped` line exists for it. Injected as [`IQuestionUIService`](#iquestionuiservice) into
  [`QuestionList`](#questionlist) (`Pages/Question/QuestionList.razor.cs:16`),
  [`QuestionDetail`](#questiondetail) (`:15`), [`QuestionCreate`](#questioncreate) (`:11`),
  [`SpeakerDetail`](#speakerdetail) (`Pages/Speaker/SpeakerDetail.razor.cs:27`) and the organizer feedback
  pages (`Pages/Feedback/OrganizerEventFeedback.razor.cs:17`,
  `Pages/Feedback/OrganizerSessionFeedback.razor.cs:17`).

### RoomService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/RoomService.cs:13` · Level 4 · class (sealed)

- **What it is**: the concrete Room CRUD service. It extends
  [`EntityServiceBase`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype) over
  `"rooms"` but **overrides `AddAsync`** to reshape the create payload, and adds the parent-scoped
  `DeleteAsync(roomId, eventId)` declared by [`IRoomUIService`](#iroomuiservice).
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  and its `Endpoint` property (`EntityServiceBase.cs:32`) and `SendRequestAsync` dispatch
  (`EntityServiceBase.cs:183`); [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`RoomDTO`](group-17-conference-domain.md#roomdto); [`IRoomUIService`](#iroomuiservice); the
  `RoomIdentifierType` / `EventIdentifierType` aliases; BCL `System.Net.Http.Json` and
  `CultureInfo.InvariantCulture` (`RoomService.cs:1-2`).
- **Concept**: cross-reference the "3-line CRUD service" pattern under
  [`QuestionService`](#questionservice) for the inherited half. Two things make `RoomService` more than a
  3-liner. (1) It **overrides** the base's `virtual AddAsync` (`EntityServiceBase.cs:122`) because the
  create endpoint's contract record `AddRoomRequest` binds a `RoomId` property, not the DTO's `Id`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:24,30`),
  so the override posts an anonymous body that remaps `RoomId = dto.Id` alongside the remaining room
  fields (`RoomService.cs:21-31`); it still routes through the base `SendRequestAsync`, so it keeps the
  Polly retry and the domain-error extraction. `[Rubric §9, API & Contract Design]` (assesses whether the
  client honors the server's request contract rather than assuming DTO/request symmetry). (2) It
  implements the parent-scoped delete, because a room is addressed under its event.
- **Walkthrough**
  - `AddAsync(dto, ct)` override (`RoomService.cs:17-33`): `SendRequestAsync<RoomDTO>` posting the
    anonymous object `{ RoomId = dto.Id, dto.EventId, dto.Name, dto.Sort, dto.Capacity, dto.Floor,
    dto.Location, dto.AccessibilityInfo }` to `Endpoint` (`:19-32`); the trailing `!` (`:33`) asserts a
    non-null DTO came back.
  - `DeleteAsync(roomId, eventId, ct)` (`RoomService.cs:35-43`): builds
    `{Endpoint}/{roomId}?eventId={eventId}` with `string.Create(CultureInfo.InvariantCulture, ...)` so the
    ids format culture-stably (`:39`), routes it through `SendRequestAsync<object>` with
    `expectContent: false` (`:37-41`), and returns `true` (`:42`).
- **Why it's built this way**: the create-payload remap keeps the UI honest about the server's
  `AddRoomRequest` shape; the parent-scoped delete exists because rooms belong to an event and the
  endpoint binds the parent id as a query argument.
- **Where it's used**: registered by the same `AddUIModule<ConferenceUIModule>()` entity-service scan
  (`DependencyInjection.cs:23`) and injected as [`IRoomUIService`](#iroomuiservice) into
  [`RoomList`](#roomlist) (`Pages/Room/RoomList.razor.cs:17`), [`RoomDetail`](#roomdetail) (`:16`),
  [`RoomCreate`](#roomcreate) (`:11`), [`SessionCreate`](#sessioncreate)
  (`Pages/Session/SessionCreate.razor.cs:19`), [`SessionDetail`](#sessiondetail) (`:27`) and
  [`PublicSessionDetail`](#publicsessiondetail) (`Pages/Public/PublicSessionDetail.razor.cs:24`) for room
  wayfinding.
- **Caveats / not-in-source**: two consequences of the override are worth knowing. The base `AddAsync`
  attaches a fresh `Idempotency-Key` header to every create (`EntityServiceBase.cs:128-136`), and this
  override calls `SendRequestAsync` without one (`RoomService.cs:18-33`), so a retried room create is not
  deduplicated by the server-side idempotency filter the way other creates are. And `DeleteAsync` returns
  a constant `true`: the `bool` carries no failure signal, because failures (after the retries are
  exhausted) surface as thrown exceptions for the calling page to handle.

### SessionCategoryItemService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:46` · Level 4 · class (sealed)

- **What it is**: the HTTP service for the **SessionCategoryItem join entity**: add (POST) or remove
  (DELETE) a category-item tag on a session (`ChildEntityServices.cs:46-57`). It is one of four
  structurally identical join-entity services in this one file, and it implements
  [`ISessionCategoryItemUIService`](#isessioncategoryitemuiservice).
- **Depends on**: [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ChildEntityServiceBase.cs:17`, hoisted out of
  this file into the shared namespace, as the trailing comment records at `ChildEntityServices.cs:75-76`);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`SessionCategoryItemDTO`](group-17-conference-domain.md#sessioncategoryitemdto); the
  `SessionIdentifierType` / `CategoryItemIdentifierType` / `SessionCategoryItemIdentifierType` aliases;
  BCL `System.Net.Http.Json` and `CultureInfo.InvariantCulture`.
- **Concept introduced (for this unit), the join-entity UI service.** A **join (association) entity** has
  no rich lifecycle: you only create the link or remove it, there is no detail page and no update. So it
  does not use the full-CRUD
  [`EntityServiceBase`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype); it
  uses the leaner [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase),
  whose whole surface is two protected helpers: `PostAsync<TRequest>`, which posts to the endpoint and
  runs a non-success response through
  [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper) before
  `EnsureSuccessStatusCode()` (`ChildEntityServiceBase.cs:24-36`), and `DeleteByIdAsync`, which maps a
  404 to `false` so a remove is idempotent and anything else non-success throws
  (`ChildEntityServiceBase.cs:39-57`). Both create their client through
  `AuthenticatedServiceBase.CreateAuthenticatedClientAsync()` (`ChildEntityServiceBase.cs:26,41`), so the
  join endpoints carry the same bearer token as their parent CRUD endpoints.
  `[Rubric §18, UI Architecture]` (assesses whether pages depend on well-factored typed services rather
  than raw `HttpClient`; the tag editor calls one method per direction) and
  `[Rubric §2, Design Patterns]` (the same base-plus-thin-leaf factoring as the CRUD family).
- **Walkthrough** (`ChildEntityServices.cs:46`)
  - `AddAsync(sessionId, categoryItemId, ct)` (`ChildEntityServices.cs:49-53`): `PostAsync(new { SessionId,
    CategoryItemId })` against the `"sessioncategoryitems"` endpoint supplied to the base constructor
    (`:47`), then deserializes the created
    [`SessionCategoryItemDTO`](group-17-conference-domain.md#sessioncategoryitemdto) from the response body
    (nullable, `:52`).
  - `DeleteAsync(id, ct)` (`ChildEntityServices.cs:55-56`): `DeleteByIdAsync(id.ToString(InvariantCulture))`,
    which returns `false` on a 404 and `true` otherwise.
- **Why it's built this way**: modeling each many-to-many link as its own tiny service over a shared child
  base keeps the add/remove surface uniform and each payload strongly typed, without the CRUD surface a
  join row does not need.
- **Where it's used**: registered explicitly (join services are not `IEntityService<,>` implementations, so
  the assembly scan does not see them) at `DependencyInjection.cs:28`, and injected into
  [`SessionDetail`](#sessiondetail)'s "categories on this session" editor
  (`Pages/Session/SessionDetail.razor.cs:26`).
- **Caveats / not-in-source**: neither base helper runs inside the Polly `RetryPolicy` (the calls at
  `ChildEntityServiceBase.cs:27` and `:43` go straight to the `HttpClient`), so unlike the CRUD services a
  transient failure on a link edit surfaces immediately rather than being retried.

### SessionService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/SessionService.cs:10` · Level 4 · class (sealed)

- **What it is**: a **body-less** concrete CRUD service for the `sessions` WebAPI resource, extending
  [`EntityServiceBase`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype) over
  [`SessionDTO`](group-17-conference-domain.md#sessiondto) / `SessionIdentifierType` and implementing
  [`ISessionUIService`](#isessionuiservice) (`SessionService.cs:10-14`).
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`SessionDTO`](group-17-conference-domain.md#sessiondto); [`ISessionUIService`](#isessionuiservice).
- **Concept**: the "3-line CRUD service" taught at [`QuestionService`](#questionservice), over a different
  resource. It inherits the whole CRUD algorithm and supplies only the endpoint string.
  `[Rubric §2, Design Patterns]`, `[Rubric §16, Maintainability]`.
- **Walkthrough**: primary-constructor class, base call only (`SessionService.cs:10-12`):
  `EntityServiceBase<SessionDTO, SessionIdentifierType>("sessions", httpClientFactory,
  tokenStorageService)`; empty body.
- **Why it's built this way**: sessions need nothing beyond generic CRUD from the UI's point of view, so
  the empty subclass is enough to give DI a concrete type behind a named interface.
- **Where it's used**: registered by the `AddUIModule<ConferenceUIModule>()` scan
  (`DependencyInjection.cs:23`); injected as [`ISessionUIService`](#isessionuiservice) into
  [`SessionList`](#sessionlist) (`Pages/Session/SessionList.razor.cs:23`),
  [`SessionDetail`](#sessiondetail) (`:21`), [`SessionCreate`](#sessioncreate) (`:17`),
  [`PublicSessionList`](#publicsessionlist) (`Pages/Public/PublicSessionList.razor.cs:29`),
  [`PublicSessionDetail`](#publicsessiondetail) (`:22`), [`SpeakerDetail`](#speakerdetail) (`:24`),
  [`PublicSpeakerDetail`](#publicspeakerdetail) (`:17`) and
  `Pages/Feedback/OrganizerSessionFeedback.razor.cs:18`. Note the speaker's own-sessions view uses the
  separate, filter-scoped and cache-bypassing [`SpeakerDashboardService`](#speakerdashboardservice)
  instead of this generic CRUD read.

### SessionSpeakerService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:30` · Level 4 · class (sealed)

- **What it is**: the HTTP service for the **SessionSpeaker join entity**: add (POST) or remove (DELETE) a
  speaker on a session (`ChildEntityServices.cs:30-41`). It is the structural twin of
  [`SessionCategoryItemService`](#sessioncategoryitemservice),
  [`SpeakerCategoryItemService`](#speakercategoryitemservice) and
  [`EventSpeakerService`](#eventspeakerservice), differing only in endpoint, payload keys and DTO. It
  implements [`ISessionSpeakerUIService`](#isessionspeakeruiservice).
- **Depends on**: [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`SessionSpeakerDTO`](group-17-conference-domain.md#sessionspeakerdto); the `SessionIdentifierType` /
  `SpeakerIdentifierType` / `SessionSpeakerIdentifierType` aliases; BCL `System.Net.Http.Json`,
  `CultureInfo.InvariantCulture`.
- **Concept**: cross-reference the join-entity mechanics taught at
  [`SessionCategoryItemService`](#sessioncategoryitemservice) (POST plus 404-tolerant DELETE over
  [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase)).
  `[Rubric §18, UI Architecture]`.
- **Walkthrough** (`ChildEntityServices.cs:30`)
  - `AddAsync(sessionId, speakerId, ct)` (`ChildEntityServices.cs:33-37`): `PostAsync(new { SessionId,
    SpeakerId })` to the `"sessionspeakers"` endpoint (`:31`), then deserializes the created
    [`SessionSpeakerDTO`](group-17-conference-domain.md#sessionspeakerdto) (nullable, `:36`).
  - `DeleteAsync(id, ct)` (`ChildEntityServices.cs:39-40`): `DeleteByIdAsync(id.ToString(InvariantCulture))`,
    `false` on 404, `true` otherwise.
- **Why it's built this way**: same rationale as the other join services, a tiny per-link service over the
  shared child base keeps the add/remove surface uniform and strongly typed.
- **Where it's used**: registered at `DependencyInjection.cs:27`; injected into
  [`SessionDetail`](#sessiondetail)'s "speakers on this session" editor
  (`Pages/Session/SessionDetail.razor.cs:25`). The rows it creates are also what the server joins on when
  [`SpeakerDashboardService`](#speakerdashboardservice) filters sessions by speaker.

### SpeakerCategoryItemService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:62` · Level 4 · class (sealed)

- **What it is**: the HTTP service for the **SpeakerCategoryItem join entity**: add (POST) or remove
  (DELETE) a category-item tag on a speaker, the mechanism behind speaker categorization such as locality
  (`ChildEntityServices.cs:62-73`). It is the fourth structurally identical join service in the file and
  implements [`ISpeakerCategoryItemUIService`](#ispeakercategoryitemuiservice).
- **Depends on**: [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto); the
  `SpeakerIdentifierType` / `CategoryItemIdentifierType` / `SpeakerCategoryItemIdentifierType` aliases;
  BCL `System.Net.Http.Json`, `CultureInfo.InvariantCulture`.
- **Concept**: cross-reference the join-entity mechanics under
  [`SessionCategoryItemService`](#sessioncategoryitemservice). `[Rubric §18, UI Architecture]`.
- **Walkthrough** (`ChildEntityServices.cs:62`)
  - `AddAsync(speakerId, categoryItemId, ct)` (`ChildEntityServices.cs:65-69`): `PostAsync(new { SpeakerId,
    CategoryItemId })` to the `"speakercategoryitems"` endpoint (`:63`), then deserializes the created
    [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto) (nullable, `:68`).
  - `DeleteAsync(id, ct)` (`ChildEntityServices.cs:71-72`): `DeleteByIdAsync(id.ToString(InvariantCulture))`,
    `false` on 404, `true` otherwise.
- **Why it's built this way**: same shared-child-base rationale as the other three join services; the four
  differ only in the resource name and the two id fields in the payload, which is exactly the amount of
  code the base cannot supply.
- **Where it's used**: registered at `DependencyInjection.cs:29`; injected into
  [`SpeakerCategoryItemsPanel`](#speakercategoryitemspanel), the speaker detail page's category editor
  (`Pages/Speaker/SpeakerCategoryItemsPanel.razor.cs:18`).

### SpeakerDashboardService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/SpeakerDashboardService.cs:15` · Level 4 · class (sealed)

- **What it is**: a bespoke **authenticated HTTP service** backing the speaker's own dashboard: four
  speaker-scoped reads, the sessions this speaker presents, how many attendees bookmarked one of those
  sessions (single and batched variants), and the aggregated feedback for a session. It extends
  [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) directly (not the
  CRUD base) and implements [`ISpeakerDashboardUIService`](#ispeakerdashboarduiservice)
  (`SpeakerDashboardService.cs:15-17`).
- **Depends on**: [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/AuthenticatedServiceBase.cs:15`) for
  `CreateAuthenticatedClientAsync()` and the shared static Polly `RetryPolicy`;
  [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) for the paged
  envelope; [`SessionDTO`](group-17-conference-domain.md#sessiondto) and
  [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto); the `SpeakerIdentifierType` /
  `SessionIdentifierType` aliases; BCL `System.Net.Http.Json`, `CultureInfo.InvariantCulture`, `Guid`.
- **Concept introduced, the server-filtered, cache-bypassing dashboard read.** These are computed,
  actor-scoped reads, not an entity surface, so the class drops to the thinner authenticated base and
  hand-builds each request. Two mechanisms in `GetSpeakerSessionsAsync` are load-bearing and the inline
  comment block (`SpeakerDashboardService.cs:26-35`) explains both:
  - **Filter on the server, not in memory.** The URL sends `filters[SpeakerId].operator=equals` and
    `filters[SpeakerId].value={speakerId}` (`SpeakerDashboardService.cs:39`), a *virtual* filter key:
    `Session` has no `SpeakerId` column, so
    [`SessionsController`](group-20-conference-api-grpc.md#sessionscontroller) intercepts the key and
    resolves it through the SessionSpeaker join
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionsController.cs:80-104`).
    The request also asks for `includeFKs=false&includeChildren=false` and caps the page at
    `MaxSpeakerSessions = 100` (`SpeakerDashboardService.cs:20,39`). The comment records what this
    replaced: fetching the whole catalog with every child collection and filtering client-side.
    `[Rubric §12, Performance & Scalability]` and `[Rubric §23, Front-End Performance]`.
  - **A deliberate cache bust.** A unique `_={Guid:N}` query parameter (`SpeakerDashboardService.cs:36,39`)
    makes this one read a guaranteed miss against the shared output cache, because the cached public list
    can lag a just-made assignment when a read that began before the assignment populates the cache after
    the eviction fired. Public and anonymous list reads keep their caching. `[Rubric §19, State
    Management]` (assesses how the UI keeps what it shows consistent with the server).
  The bookmark counts are produced server-side from the **Engagement** service across the gRPC boundary
  ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)); the UI sees only this one
  typed contract. `[Rubric §7, Microservices Readiness]`.
- **Walkthrough** (`SpeakerDashboardService.cs:15`)
  - Every read dispatches through the private `SendGetRequestAsync<T>`
    (`SpeakerDashboardService.cs:90-109`), this service's own copy of the
    `EntityServiceBase.SendRequestAsync` semantics (which live on the CRUD base this class does not
    extend): the GET runs through the Polly `RetryPolicy` (`:97`), an optional `treatNotFoundAsDefault`
    maps 404 to `default` (`:99-100`), a non-success response goes through
    [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper) and then
    `EnsureSuccessStatusCode()` (`:103-106`), and only a success deserializes (`:108`).
  - `GetSpeakerSessionsAsync(speakerId, ct)` (`SpeakerDashboardService.cs:22-44`): builds the
    `sessions/paged?...` URL above with `string.Create(InvariantCulture, ...)` (`:37-39`), sorted
    `StartsAt asc`, deserializes a
    [`PagedCollectionResult<SessionDTO>`](group-01-result-error-handling.md#pagedcollectionresultt)
    because the paged endpoint returns an envelope rather than a bare array (`:41-42`), and returns
    `page?.Items.ToList() ?? []` (`:43`).
  - `GetSessionBookmarkCountAsync(speakerId, sessionId, ct)` (`SpeakerDashboardService.cs:46-53`): GETs
    `speakers/{speakerId}/sessions/{sessionId}/bookmarks/count` and returns the deserialized `int`.
  - `GetSessionBookmarkCountsAsync(speakerId, sessionIds, ct)` (`SpeakerDashboardService.cs:55-67`): the
    batched variant; short-circuits an empty id list with an empty dictionary (`:60-61`), joins one
    repeated `sessionIds=` query parameter per id (`:63`), and returns the per-session dictionary
    (`:65-66`). One request for a whole grid instead of one per row.
  - `GetSessionFeedbackAsync(speakerId, sessionId, ct)` (`SpeakerDashboardService.cs:69-77`): GETs
    `speakers/{speakerId}/sessions/{sessionId}/feedback` with `treatNotFoundAsDefault: true` (`:76`), so a
    404 ("no feedback captured yet", a legitimate domain state, `:74`) returns `null` while other failures
    throw.
  - Every URL is built with `string.Create(CultureInfo.InvariantCulture, ...)` so id formatting never
    follows the user's locale, and every call leads with `speakerId` so the server can scope the read to
    the calling speaker.
- **Why it's built this way**: aggregate dashboard reads fit neither the entity-CRUD nor the lookup shape,
  so they get their own narrow service; the cache bust trades one extra origin fetch for correctness (a
  speaker must see a new assignment immediately) while the anonymous public list keeps its output cache.
- **Where it's used**: registered explicitly at `DependencyInjection.cs:32` and injected into
  [`SpeakerDashboard`](#speakerdashboard), the speaker's "My Sessions" page
  (`Pages/Speaker/SpeakerDashboard.razor.cs:22`).
- **Caveats / not-in-source**: the retry and domain-error dispatch is a private copy of the
  `EntityServiceBase.SendRequestAsync` semantics rather than inherited behavior (the doc comment at
  `SpeakerDashboardService.cs:79-85` says so), so the two dispatches must be kept in step by hand. The
  100-session page cap is an upper bound on one speaker's sessions (`:19-20`), not a paging mechanism: a
  speaker with more would silently see only the first 100.

### SpeakerService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/SpeakerService.cs:12` · Level 4 · class (sealed)

- **What it is**: the concrete Speaker CRUD service. It extends
  [`EntityServiceBase`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype) over
  `"speakers"` (inheriting all CRUD) and adds the two Speaker-to-User operations declared by
  [`ISpeakerUIService`](#ispeakeruiservice): link and unlink (`SpeakerService.cs:12-43`).
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  and its `Endpoint` / `SendRequestAsync` members;
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`SpeakerDTO`](group-17-conference-domain.md#speakerdto); [`ISpeakerUIService`](#ispeakeruiservice); the
  `SpeakerIdentifierType` / `UserIdentifierType` aliases; the `LinkUserRequest` payload type; BCL
  `System.Net.Http.Json`.
- **Concept**: cross-reference the "3-line CRUD service" at [`QuestionService`](#questionservice) for the
  inherited half. The interesting half is how the two link operations reuse the base `SendRequestAsync`
  dispatch (so they inherit Polly retry and domain-error extraction) while addressing a **verb-style
  sub-resource**, `{Endpoint}/{speakerId}/link`. These are the UI entry points for the Speaker-to-User
  association, the relationship that, server-side, raises `SpeakerLinkedToUser` /
  `SpeakerUnlinkedFromUser` integration events so the Identity module can set or clear
  `User.LinkedSpeakerId`. `[Rubric §7, Microservices Readiness]` (assesses whether cross-module
  consistency travels over decoupled edges; the page calls one REST endpoint and the cross-service
  update happens asynchronously behind it via the broker) and `[Rubric §9, API & Contract Design]` (the
  association is a named `PUT {id}/link` / `DELETE {id}/link`, not a field flip on the DTO).
- **Walkthrough**
  - `LinkUserAsync(speakerId, userId, ct)` (`SpeakerService.cs:16-29`): `SendRequestAsync<object>` issuing
    `PUT {Endpoint}/{speakerId}/link` with a `LinkUserRequest { UserId = userId }` body and
    `expectContent: false` (`:21-27`), returning `true` (`:28`).
  - `UnlinkUserAsync(speakerId, ct)` (`SpeakerService.cs:31-42`): `SendRequestAsync<object>` issuing
    `DELETE {Endpoint}/{speakerId}/link` with `expectContent: false` (`:35-40`), returning `true` (`:41`).
- **Why it's built this way**: linking a speaker to a login is a deliberate admin action with its own
  endpoint, not a field edit, so it is named explicitly; routing it through the inherited dispatch keeps
  resilience and error surfacing identical to CRUD, and `expectContent: false` skips deserialization for
  these confirm-only calls.
- **Where it's used**: registered by the `AddUIModule<ConferenceUIModule>()` scan
  (`DependencyInjection.cs:23`); injected as [`ISpeakerUIService`](#ispeakeruiservice) into
  [`SpeakerDetail`](#speakerdetail)'s link-to-user control (`Pages/Speaker/SpeakerDetail.razor.cs:23`),
  [`SpeakerList`](#speakerlist) (`:24`), `Pages/Speaker/SpeakerCreate.razor.cs:15`,
  [`SpeakerDashboard`](#speakerdashboard) (`:21`), [`PublicSpeakerList`](#publicspeakerlist) (`:31`) and
  [`PublicSpeakerDetail`](#publicspeakerdetail) (`:16`).

### SponsorService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/SponsorService.cs:10` · Level 4 · class (sealed)

- **What it is**: a **body-less** concrete CRUD service for the `sponsors` WebAPI resource, extending
  [`EntityServiceBase`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype) over
  [`SponsorDTO`](group-17-conference-domain.md#sponsordto) / `SponsorIdentifierType` and implementing
  [`ISponsorUIService`](#isponsoruiservice) (`SponsorService.cs:10-14`).
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`SponsorDTO`](group-17-conference-domain.md#sponsordto) (from
  `MMCA.ADC.Conference.Shared.Sponsors`, `SponsorService.cs:1`); [`ISponsorUIService`](#isponsoruiservice),
  itself an empty interface over `IEntityService<SponsorDTO, SponsorIdentifierType>`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ISponsorUIService.cs:9-11`).
- **Concept**: the "3-line CRUD service" taught at [`QuestionService`](#questionservice), and the clearest
  demonstration of what that pattern buys: sponsors were a later addition to the Conference module, and
  the entire client side of the feature is this five-line class plus an empty interface, because the base
  already supplies paging, lookup, retry, idempotent creates and domain-error translation.
  `[Rubric §16, Maintainability]` and `[Rubric §2, Design Patterns]`.
- **Walkthrough**: primary-constructor class, base call only (`SponsorService.cs:10-12`):
  `EntityServiceBase<SponsorDTO, SponsorIdentifierType>("sponsors", httpClientFactory,
  tokenStorageService)`; empty body (`:13-14`).
- **Why it's built this way**: the sponsor surface is plain CRUD plus a public read, so no override is
  needed; the concrete type exists only to bind the endpoint name to the interface the pages inject.
- **Where it's used**: registered by the `AddUIModule<ConferenceUIModule>()` entity-service scan
  (`DependencyInjection.cs:23`); injected as [`ISponsorUIService`](#isponsoruiservice) into the organizer
  pages [`SponsorList`](#sponsorlist) (`Pages/Sponsor/SponsorList.razor.cs:24`),
  [`SponsorDetail`](#sponsordetail) (`:22`) and [`SponsorCreate`](#sponsorcreate) (`:20`), and into the
  public [`PublicSponsorList`](#publicsponsorlist) (`Pages/Public/PublicSponsorList.razor.cs:25`).

### SessionSelectionService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/SessionSelectionService.cs:12` · Level 5 · class (sealed)

- **What it is**: the bespoke **authenticated HTTP service** behind the organizer's session-selection
  decision-support dashboard: one read (fetch the dashboard) and one action (kick off a scoring pass over
  an event's sessions). It extends
  [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) directly and
  implements [`ISessionSelectionUIService`](#isessionselectionuiservice)
  (`SessionSelectionService.cs:12-14`).
- **Depends on**: [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase)
  for `CreateAuthenticatedClientAsync()` and the static `RetryPolicy`;
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto) and
  [`ScoreEventSessionsResultDTO`](group-17-conference-domain.md#scoreeventsessionsresultdto); the
  `EventIdentifierType` alias; BCL `System.Net.Http.Json`, `CultureInfo.InvariantCulture`,
  `System.Net.HttpStatusCode`.
- **Concept**: cross-reference the bespoke-authenticated-service shape taught at
  [`SpeakerDashboardService`](#speakerdashboardservice). What is distinctive here is the read/command
  split and the **202-Accepted sentinel**. `[Rubric §6, CQRS & Event-Driven]` (assesses whether reads and
  writes are cleanly separated; `GetDashboardAsync` is a pure query and `ScoreSessionsAsync` is a command,
  matching the two [`SessionSelectionController`](group-20-conference-api-grpc.md#sessionselectioncontroller)
  endpoints at `SessionSelectionController.cs:39` and `:105`). `[Rubric §29, Resilience & Business
  Continuity]` (assesses whether failure handling matches the operation's semantics): the dashboard read
  runs inside the inherited Polly `RetryPolicy` (3 retries, exponential 2s/4s/8s backoff plus up to a
  second of jitter, retrying 5xx except 501/505 plus 408 and 429,
  `AuthenticatedServiceBase.cs:26-32,89-98`), while the scoring POST is issued **outside** the policy
  (`SessionSelectionService.cs:39`), so a long-running background job is never re-triggered by a slow
  response.
- **Walkthrough** (`SessionSelectionService.cs:12`)
  - `GetDashboardAsync(eventId, ct)` (`SessionSelectionService.cs:16-30`): creates the authenticated
    client (`:20`), builds `sessionselection/dashboard/{eventId}` with
    `string.Create(InvariantCulture, ...)` (`:22`), executes the GET inside `RetryPolicy.ExecuteAsync`
    (`:23-24`), returns `null` on any non-success status (`:26-27`), else deserializes the
    [`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto) (`:29`).
  - `ScoreSessionsAsync(eventId, ct)` (`SessionSelectionService.cs:32-51`): POSTs with no body to
    `sessionselection/score/{eventId}` (`:38-39`). A **202 Accepted** (which the controller returns
    because scoring runs on a hosted background worker,
    `SessionSelectionController.cs:97,106,114`) is translated into the sentinel
    `ScoreEventSessionsResultDTO { SessionsScored = -1, SessionsFailed = 0 }` meaning "scoring started in
    background" (`:42-45`); other non-success statuses return `null` (`:47-48`); a 200 deserializes the
    real summary (`:50`).
- **Why it's built this way**: decision support is not an entity-CRUD surface, so it uses the
  authenticated base directly; the 202-versus-200 branch lets one client method model both a synchronous
  scoring result and an accepted-for-background-processing acknowledgement without a second endpoint or a
  polling contract.
- **Where it's used**: registered explicitly as
  [`ISessionSelectionUIService`](#isessionselectionuiservice) at `DependencyInjection.cs:39`; injected into
  [`SessionSelectionDashboard`](#sessionselectiondashboard)
  (`Pages/SessionSelection/SessionSelectionDashboard.razor.cs:15`).
- **Caveats / not-in-source**: `SessionsScored = -1` is an in-band sentinel, so callers must special-case
  it rather than treat it as a count. Neither method calls
  [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper), so a domain or
  validation error surfaces to the page only as a `null` return, not as a typed exception carrying the
  server's message. Whether the background scorer is currently running for that event is not observable
  through this contract.

### SpeakerQr
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerQr.razor.cs:19` · Level 1 · class (Blazor code-behind)

- **What it is**: the speaker-facing side of the speaker QR code. It renders one card-sized code that resolves to the speaker's own **public** profile page, for holding up at the podium or parking on a booth screen (`SpeakerQr.razor.cs:8-18`).
- **Depends on**: [`IPublicLinkBuilder`](#ipubliclinkbuilder) (`SpeakerQr.razor.cs:21`) and [`ConferenceRoutePaths`](#conferenceroutepaths) (`:55`); the cascading `Task<AuthenticationState>` (`:23-24`); MudBlazor's `BreadcrumbItem` and `Icons`, plus the shared `QrCodeImage` component from `MMCA.Common.UI` and its [`QrErrorCorrectionLevel`](group-15-common-ui-framework.md#qrerrorcorrectionlevel) enum (rendered at `SpeakerQr.razor:26-30`). No UI service, no HTTP client, no DTO.
- **Concept introduced, the zero-fetch page and the absolute-link rule.** This is the smallest page in the group and the clearest place to see two ideas.
  1. **Nothing is fetched.** The identity comes from the `speaker_id` JWT claim (`SpeakerQr.razor.cs:49-53`) and the payload is composed locally, so the page renders identically on the SSR prerender pass and on the interactive pass. No `CancellationTokenSource`, no loading flag, and no `IDisposable`: there is no in-flight request to cancel, which is why this class has none of the disposal plumbing every other page in this unit carries. `[Rubric §23, Front-End Performance & Rendering]` (assesses how much work a view costs to paint): this one costs a claim read and a string build.
  2. **The payload must be an absolute public URL.** `LinkBuilder.BuildAbsolute(...)` (`:55`, contract at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IPublicLinkBuilder.cs:12`) converts the relative route into a fully-qualified public URL. The interface doc records why (`IPublicLinkBuilder.cs:3-8`, echoed on the page at `SpeakerQr.razor.cs:15-16`): web heads can derive an origin from the browser, but the MAUI head serves the Blazor app from the WebView's virtual host, so a code built from the ambient base URI would scan to an address that exists for nobody but that device. `[Rubric §22, Responsive & Cross-Browser]` and `[Rubric §7, Microservices Readiness]`: the link is built against the public site, not the head the code happens to run in, so the same page is correct on every head.
  Claim-derived scoping is the same mechanism [`SpeakerDashboard`](#speakerdashboard) uses; see that section for the fuller discussion. `[Rubric §26, Front-End Security]`: the speaker can only ever render their own code, because the id is read from the validated token and never from a route parameter.
- **Walkthrough**
  - Fields (`SpeakerQr.razor.cs:26-28`): the breadcrumb list, the nullable `_payload` (null keeps the code hidden and swaps in an explanatory alert), and `_displayName`.
  - `OnInitializedAsync` (`:30-56`): builds the two-item breadcrumb trail (`:32-36`), returns early when there is no cascading auth state (`:38-41`), reads `state.User.Identity?.Name` into `_displayName` so a scanner can see whose profile the code opens before opening it (`:45-47`), then requires a parsable `speaker_id` claim (`:49-53`) before building the payload (`:55`).
  - The markup renders `QrCodeImage` with the payload, a localized `AltText`, `PixelsPerModule="14"`, and `QrErrorCorrectionLevel.Medium` (`SpeakerQr.razor:26-30`); the in-markup comment (`SpeakerQr.razor:24-25`) records the reasoning: readable from a few steps away, with enough error correction to survive screen glare. `[Rubric §21, Accessibility]`: the code carries alt text rather than being a decorative canvas.
  - The no-claim branch is not an empty card. The markup renders an informational alert (`SpeakerQr.razor:11-18`) because the nav entry is claim-gated but a bookmarked or typed URL still lands here. `[Rubric §24, Forms, Validation & UX Safety]`: the dead end is explained rather than rendered blank.
- **Why it's built this way**: a speaker holding up a phone at a podium needs the code to appear instantly and to work when scanned by a stranger's camera. Both requirements point at a locally composed absolute URL and no network dependency at all.
- **Where it's used**: the `/speaker/qr` route, `[Authorize]` with no role requirement (`SpeakerQr.razor:1-2`), the speaker-portal companion to [`SpeakerDashboard`](#speakerdashboard). The same target URL is offered from the reader's side by the `QrCodeButton` on the public profile (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSpeakerDetail.razor:45-46`).
- **Caveats / not-in-source**: the `speaker_id` claim is issued when an organizer links a User to a Speaker (see [`SpeakerDetail`](#speakerdetail)); the claim's issuance lives in the Identity service, and this page only reads it.

---

### SpeakerCreate
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerCreate.razor.cs:13` · Level 5 · class (Blazor code-behind)

- **What it is**: the organizer's speaker-creation form. It collects first and last name, bio, tagline, email, profile picture, and the four social links, packs them into a new [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), and posts it (`SpeakerCreate.razor.cs:9-12`).
- **Depends on**: [`ISpeakerUIService`](#ispeakeruiservice) (`:15`), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) (`:69`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:30,88,104`), and [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (`:62`); MudBlazor's `MudForm` and `ISnackbar` (`:17,47`), Blazor's `NavigationManager` (`:16`), and the shared `UnsavedChangesGuard` component (`SpeakerCreate.razor:8`).
- **Concept**: the create-page pattern this group teaches once (validate before mutate, dirty tracking, cancel on disposal), here in its widest-form variant. `[Rubric §24, Forms, Validation & UX Safety]` (assesses validate-before-submit and unsaved-change protection): `CreateSpeakerAsync` calls `await _form.ValidateAsync()` and bails with a warning snackbar when `!_form.IsValid` (`:59-64`) before touching the service, and `_isDirty` (set by `MarkDirty()`, `:50`) is cleared the instant the save succeeds, **before** navigating (`:86`), so the guard cannot block its own redirect. The `CancellationTokenSource` (`:19`) is passed to the service call (`:85`) and cancelled in the standard dispose pattern (`:106-128`), with `OperationCanceledException` swallowed as the expected teardown outcome (`:90-93`).
  The identifier detail is worth pausing on. `Speaker` is Guid-keyed, so this page mints a genuinely unique id client-side with `Guid.NewGuid()` (`:71`), while the int-keyed create forms in this same module send `Id = default` and let the database assign one (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Event/EventCreate.razor.cs:78`, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryCreate.razor.cs:58`). `[Rubric §8, Data Architecture]` (assesses a deliberate identity strategy): the per-entity identifier alias ([ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)) keeps the key type out of the page's own logic, and either way the page reads `created.Id` back from the response (`:88`) rather than trusting what it sent.
- **Walkthrough**: `OnInitialized` (`:24-33`) builds the Home / Speakers / Create breadcrumb trail; the private `Title` property (`:20`) pulls the page title from the localizer so `PageTitle` and the heading share one resource key (`[Rubric §27, Internationalization]`). `CreateSpeakerAsync` (`:52-102`) validates, sets `IsSaving` (`:66`, the flag the markup uses to disable the submit button), composes `FullName` from the two name fields (`:74`), builds the DTO with all optional profile and social fields (`:69-83`), calls `SpeakerService.AddAsync` (`:85`), snackbars, and navigates to `ConferenceRoutePaths.SpeakerDetails(created.Id)` (`:87-88`). A non-cancellation failure raises one error snackbar (`:94-97`) and the `finally` always clears `IsSaving` (`:98-101`), so a failed save leaves the form editable rather than stuck.
- **Why it's built this way**: one create-form shape reused per entity keeps the flow uniform (validate, post, redirect to detail) while each page varies only in the fields it collects.
- **Where it's used**: the `/speakers/create` route, restricted to the Organizer role (`SpeakerCreate.razor:1-2`), reached from [`SpeakerList`](#speakerlist)'s create button; it redirects to [`SpeakerDetail`](#speakerdetail).
- **Caveats / not-in-source**: whether the server honors or replaces the client-minted Guid is a server-side decision not visible here; the page uses the id from the response either way.

---

### SpeakerCategoryItemsPanel
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerCategoryItemsPanel.razor.cs:16` · Level 8 · class (Blazor code-behind)

- **What it is**: the "Additional Info" panel carved out of [`SpeakerDetail`](#speakerdetail). It renders a speaker's category items grouped by category and hosts the add and remove chip actions (`SpeakerCategoryItemsPanel.razor.cs:9-15`).
- **Depends on**: [`ISpeakerCategoryItemUIService`](#ispeakercategoryitemuiservice) (`:18`), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) (`:22`), [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto) (`:42`), [`CategoryItemInfo`](#categoryiteminfo) (`:25`), and the `CategoryItem` / `ConferenceCategory` / `SpeakerCategoryItem` identifier aliases (`:25,28,34,81`); MudBlazor's `ISnackbar` (`:19`).
- **Concept introduced, the container/presentational split with an `EventCallback` up-channel.** The page (the container) passes down the `Speaker` plus the two lookups it already owns (`:22-28`), and the panel signals mutations back up through the `Changed` callback (`:31`). After an add or a remove the panel calls `await Changed.InvokeAsync()` (`:73,87`), and the page responds by reloading the speaker, so behavior is identical to the pre-split page (class doc, `:12-14`). `[Rubric §18, UI Architecture & Component Design]` (assesses cohesive, single-responsibility components): the split trims an already-large parent and gives this sub-view one job. `[Rubric §19, State Management & Data Flow]` (assesses where state lives and how it flows): the panel holds no source-of-truth state, only the transient `_selectedCategoryItemId` (`:34`); data flows down as parameters and mutations flow up through the callback, the canonical unidirectional Blazor pattern.
  One localization detail follows from the split: the panel injects `IStringLocalizer<SpeakerDetail>`, not a localizer of its own (`SpeakerCategoryItemsPanel.razor:2`), so the extracted markup keeps using the parent page's resource files instead of forking a second `.resx` pair. `[Rubric §27, Internationalization]` and `[Rubric §16, Maintainability]`.
- **Walkthrough**
  - `GetCategoryTitle` (`:36-37`) and `GetCategoryItemName` (`:39-40`): resolve ids to display names, falling back to the invariant-culture id when the lookup has no entry, so a missing lookup degrades to a number rather than an exception.
  - `GetCategoryItemsGroupedByCategory` (`:42-50`): filters the speaker's assigned items to those present in the lookup and groups them by their parent category id; `GetAvailableCategoryItems` (`:52-59`) builds the add dropdown by excluding already-assigned items, so the same item cannot be added twice from the UI.
  - `AddCategoryItemAsync` (`:61-79`): no-ops without a selection (`:63-66`), posts the item against the speaker id (`:70`), clears the selection, snackbars, and invokes `Changed` (`:71-73`); `RemoveCategoryItemAsync` (`:81-93`) deletes by the **join-entity** id (the `SpeakerCategoryItem` row, not the category item) and invokes `Changed` (`:85-87`). Both catch broadly and report through a snackbar (`:75-78,89-92`) rather than surfacing an exception into the render tree. `[Rubric §29, Resilience & Business Continuity]`.
  - The panel owns its own `CancellationTokenSource` (`:33`), cancelled in the standard dispose pattern (`:95-117`), because unlike a purely presentational child it makes its own service calls.
- **Why it's built this way**: the speaker editor grew large enough that carving out a self-contained sub-view (owning its own service call, delegating state to the page) shrinks the parent and makes the panel independently testable, with no change in observable behavior.
- **Where it's used**: rendered inside [`SpeakerDetail`](#speakerdetail) (`SpeakerDetail.razor:181`), which supplies `Speaker`, `CategoryItems`, `CategoryTitles`, and a `Changed` handler that reloads the speaker.

---

### SpeakerDetail
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerDetail.razor.cs:19` · Level 8 · class (Blazor code-behind)

- **What it is**: the full speaker console. Beyond load, inline edit, and delete it composes the category-item panel, resolves question-answer text, lists the speaker's sessions, and runs the **link/unlink a User to this Speaker** flow (`SpeakerDetail.razor.cs:14-18`).
- **Depends on**: six UI clients, [`ISpeakerUIService`](#ispeakeruiservice), [`ISessionUIService`](#isessionuiservice), [`IConferenceCategoryUIService`](#iconferencecategoryuiservice), [`ICategoryItemLookupService`](#icategoryitemlookupservice), [`IQuestionUIService`](#iquestionuiservice), and [`IUserUIService`](group-24-identity-module.md#iuseruiservice) (`:23-28`); [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`UserListDTO`](group-24-identity-module.md#userlistdto), [`CategoryItemInfo`](#categoryiteminfo), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:48,359,361`), [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (`:100,115,204,241,274`), and the shared `DeleteConfirmation` component (`:71`). It hosts [`SpeakerCategoryItemsPanel`](#speakercategoryitemspanel).
- **Concept introduced, the cross-module composition page.** One page composes data from Conference **and** Identity plus three lookups resolved into display names. `[Rubric §7, Microservices Readiness]` (assesses that cross-module access goes through abstractions rather than direct references): the Identity reach is [`IUserUIService`](group-24-identity-module.md#iuseruiservice), an HTTP client behind an interface, so the page is indifferent to Identity running as its own service behind the gateway. `[Rubric §18, UI Architecture & Component Design]` (a high dependency count is a cohesion signal worth watching): the page delegates its category-item sub-view to a child component and keeps the rest, so its remaining size comes from orchestrating six clients and three lookups rather than from bespoke mechanics.
  Note the authorization shape, because it differs from its siblings: the route carries a bare `[Authorize]` (`SpeakerDetail.razor:2`), while [`SpeakerList`](#speakerlist) and [`SpeakerCreate`](#speakercreate) both require `Roles = "Organizer"`. The page is reachable by any authenticated user who has the id, and the actual read and write authorization is enforced by the Conference API behind each service call. `[Rubric §11, Security]` (assesses that the server, not the route attribute, is the authorization boundary).
- **Walkthrough**
  - Load once per id: `OnParametersSetAsync` (`:80-89`) compares the route `[Parameter] string Id` (`:32`) against `_loadedId` (`:53`) so a re-render does not refetch.
  - `LoadAsync` (`:91-121`): `GetByIdAsync(speakerId, true, ...)` with children included (`:97`), a not-found snackbar through [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (`:100`), then three lookups hydrated lazily with `??=` so a reload does not re-fetch them: category items (`:104`), category titles (`LoadCategoryTitlesAsync`, `:150-155`), and question texts (`LoadQuestionTextsAsync`, `:157-162`). `GetQuestionText` (`:164-165`) resolves an answer's question id with the same invariant-culture id fallback the panel uses.
  - `LoadSpeakerSessionsAsync` (`:131-148`): a server-side `SpeakerId equals` filter (`:133-136`), sorted by `StartsAt` ascending, `includeChildren: false`, capped at `MaxSpeakerSessions = 100` (`:34-35`). The remarks block (`:126-130`) records what this replaced: the page used to pull the entire session catalog with all child collections and filter it in memory on `SessionSpeakers`, even though it never renders those children. `[Rubric §12, Performance & Scalability]` (assesses moving work to where the data lives) and `[Rubric §8, Data Architecture]` (a bounded page size instead of an unbounded read).
  - Inline edit (`:167-247`): `StartEditing` seeds the `_edit*` **shadow fields** from the loaded record (`:167-186`) and `CancelEditing` simply discards them (`:188-192`), so the live `Speaker` object is never mutated until a validated save succeeds. `SaveChangesAsync` (`:194-247`) validates the `MudForm` first (`:201-206`), rebuilds the DTO preserving `RowVersion` (`:214`) and `LinkedUserId` (`:226`) so a profile edit cannot silently clear the organizer-managed link, updates, and re-fetches the record (`:229-230`). `[Rubric §24, Forms, Validation & UX Safety]` and `[Rubric §8, Data Architecture]`: the round-tripped `RowVersion` is the client half of optimistic concurrency.
  - Delete (`:249-276`): confirm through the shared `DeleteConfirmation` dialog with the speaker's own name in the prompt (`:256`), delete, then navigate back to the list (`:264-266`).
  - **User link and unlink** (`:279-357`): `SearchUsersAsync` is the notable one. `GetPagedAsync` ANDs its filters server-side (in-code comment, `:288-290`), so a single call with email, first name, and last name all set to the same term would return the empty intersection. The page instead fans out **three parallel calls** (`:291-295`), unions the results with `DistinctBy(u => u.UserId)` and takes 10 (`:301-305`). A cancellation returns an empty list rather than throwing into the autocomplete (`:307-310`). `OnUserPickedAsync` (`:313-334`) calls `LinkUserAsync` and reloads; `UnlinkUserAsync` (`:336-357`) clears the link. This is the flow that produces the `speaker_id` claim that [`SpeakerDashboard`](#speakerdashboard) and [`SpeakerQr`](#speakerqr) depend on.
  - Disposal (`:363-385`) is the standard cancel-on-disposal pattern over the page's `CancellationTokenSource` (`:37`); the unsaved-changes guard is wired from `_isDirty` (`:70`, `SpeakerDetail.razor:11`).
- **Why it's built this way**: an organizer needs one console to fully administer a speaker, including wiring them to a login account; composing the views here (and delegating the category panel) trades page breadth for a one-stop editor. The three-call user search is a deliberate workaround for AND-only server filtering.
- **Where it's used**: the `/speakers/{Id}` route (`SpeakerDetail.razor:1`), reached from [`SpeakerList`](#speakerlist) rows and from [`SpeakerCreate`](#speakercreate) redirects; it hosts [`SpeakerCategoryItemsPanel`](#speakercategoryitemspanel) (`SpeakerDetail.razor:181`) and routes onward to session details (`:361`).
- **Caveats / not-in-source**: the AND-only semantics of `GetPagedAsync` are asserted by the in-code comment (`:288-290`); the filter behavior itself lives in the Identity API, not this page. Likewise the effective read/write authorization for a non-Organizer who reaches this route is enforced server-side and is not visible here.

---

### SpeakerDashboard
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerDashboard.razor.cs:19` · Level 9 · class (Blazor code-behind)

- **What it is**: the **speaker's own** self-service dashboard, not an organizer page. It reads the linked speaker from the `speaker_id` JWT claim, shows that speaker's profile and their sessions narrowed to the current or next event, with per-session bookmark counts and lazily loaded per-session feedback, and lets the speaker edit their own bio and social profile, BR-214 (`SpeakerDashboard.razor.cs:11-18,44`).
- **Depends on**: [`ISpeakerUIService`](#ispeakeruiservice), [`ISpeakerDashboardUIService`](#ispeakerdashboarduiservice), [`IEventLookupService`](#ieventlookupservice), and Blazor's `AuthenticationStateProvider` (`:21-25`); [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto) (`:40`), [`EventInfo`](#eventinfo) (`:142`), and [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (`:147-152`); MudBlazor's `ISnackbar`.
- **Concept introduced, claim-driven identity scoping, plus prerender-safe loading and lazy expand.** Three ideas converge here.
  1. **Claim-driven scoping.** Instead of an id from the route, the page derives *who you are* from the token: `OnInitializedAsync` reads `speaker_id` from the auth state (`:72-80`) and falls into a "not linked" state (`_hasSpeakerId = false`, `:78`) when the claim is absent or unparsable, which the markup renders as an explanatory alert (`SpeakerDashboard.razor:17-21`). `[Rubric §11, Security]` and `[Rubric §26, Front-End Security]` (assess that scoping derives from trusted server-issued claims, not client-supplied ids): a speaker can only load their own dashboard. The class doc adds the corollary (`:15-17`): a speaker is *not* a privileged reader, so the server returns only publicly visible sessions (BR-49, accepted or unset), and a submission still under review does not appear here, which the empty-state copy names.
  2. **Prerender-safe loading.** The method returns early when `!RendererInfo.IsInteractive` (`:62-68`), so the profile, the sessions, and the bookmark counts are not fetched twice per visit; the prerender pass paints the loading skeleton instead, and the in-code comment names the ADCHome page as the precedent (`:62-64`). `[Rubric §23, Front-End Performance & Rendering]`.
  3. **Lazy expand.** `ToggleFeedbackAsync` (`:226-262`) uses the `HashSet.Add` return value as the toggle itself (`:228-232`), fetches a session's feedback only the first time its panel opens, and caches it in `_sessionFeedback` (`:234-237,244-248`), so first paint never fans out one feedback call per session. A per-session `_feedbackLoading` set (`:42,239,260`) drives the spinner for just the row being expanded. `[Rubric §19, State Management & Data Flow]`.
- **Walkthrough**
  - Load (`:54-140`): breadcrumbs (`:56-60`), prerender guard, claim read, `GetByIdAsync(_speakerId, true, ...)` (`:86`), then the speaker's sessions through `DashboardService.GetSpeakerSessionsAsync`, ordered by `StartsAt` (`:95-96`). The comment at `:92-94` records why that read goes through the dashboard service: it bypasses the shared sessions output cache ([ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)), so a just-made speaker assignment shows immediately instead of lagging behind a cached public list.
  - Narrowing (`:98-109`): `ResolveCurrentEventAsync` (`:142-159`) resolves the current or next event through [`CurrentEventSelector.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventselector), passing the start, end, and time-zone accessors plus `DateTime.UtcNow` (`:147-152`). The page keeps both lists: `_allSpeakerSessions` and the filtered `_speakerSessions` (`:36-37`), falling back to the unfiltered list when no event resolves (`:107-108`). A failed lookup is swallowed and treated as "no event" (`:154-158`).
  - Bookmark counts (`:111-126`): one **batched** call, `GetSessionBookmarkCountsAsync`, fills every count, with `GetValueOrDefault` supplying zero for a session nobody bookmarked (`:117-121`). The comment (`:111-113`) records what it replaced: each count used to be its own cross-service hop (HTTP to Conference, then gRPC to Engagement). The call sits in its own best-effort `catch` that re-raises nothing (`:123-126`), so a failed count read never breaks the render. `[Rubric §12, Performance & Scalability]` and `[Rubric §29, Resilience & Business Continuity]`.
  - Profile editing (`:161-224`): `StartEditingProfile` seeds six `_edit*` fields (`:161-175`) and `CancelEditingProfile` is a one-line discard (`:177`). `SaveProfileAsync` (`:179-224`) rebuilds a [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) that preserves `RowVersion`, first, last, and full name, `Email`, `ProfilePicture`, and `LinkedUserId` from the loaded record (`:189-205`), so a self-edit can only change the six fields the speaker owns and cannot clear the organizer-managed ones. `[Rubric §11, Security]` and `[Rubric §24, Forms, Validation & UX Safety]`.
  - Disposal (`:264-286`) is the standard cancel-on-disposal pattern over the `CancellationTokenSource` at `:27`.
- **Why it's built this way**: the speaker portal is a distinct actor view. Scoping by claim is the secure way to hand a speaker exactly their own data without an authorization argument on every call, and the batched counts plus the prerender skip keep a cross-service-heavy page responsive.
- **Where it's used**: the `/speaker/dashboard` route, `[Authorize]` with no role requirement (`SpeakerDashboard.razor:1-2`), gated in practice on the `speaker_id` claim that appears once an organizer links a User to a Speaker in [`SpeakerDetail`](#speakerdetail). [`SpeakerQr`](#speakerqr) is its companion page.
- **Caveats / not-in-source**: the output-cache bypass and the batched-endpoint rationale are documented by in-code comments (`:92-94,111-113`); the caching and batching behavior itself lives in the Conference service.

---

### SpeakerList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerList.razor.cs:19` · Level 9 · class (Blazor code-behind)

- **What it is**: the organizer's speaker browse page: server-paged search with avatars, an event filter, delete-with-confirmation, and a card layout on mobile viewports instead of the data grid (`SpeakerList.razor.cs:13-18`).
- **Depends on**: extends [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) (`:19`, `SpeakerList.razor:4`); [`ISpeakerUIService`](#ispeakeruiservice) and [`IEventLookupService`](#ieventlookupservice) (`:24-25`), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), [`EventInfo`](#eventinfo) (`:39`), [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (`:103-108`), [`ListPageActions`](group-24-identity-module.md#listpageactions) (`:113,165`), [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (`:171`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:174-175`), [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) (`:33`), and the shared `DeleteConfirmation` component (`:34`).
- **Concept**: the same event-filtered list shape as [`PublicSpeakerList`](#publicspeakerlist), with the audience logic removed. Every reader of this page is already an Organizer (`SpeakerList.razor:2`), so the filter choice is persisted unconditionally (`:41-49`) and the `"all"` sentinel is the only distinction that matters: it separates an explicit clear from *no saved state*, which is what triggers the computed default (in-code comment, `:46`). Reading the two pages side by side is the clearest way to see what the privileged/non-privileged split actually costs on the public one: a role check and a narrowed persistence rule.
  Three mechanisms are worth naming.
  1. **Restore, then reconcile.** `RestoreFilters` (`:51-68`) parses the saved search term and event id; `ResolveDefaultEventFilter` (`:92-110`) keeps a restored id **only if it still exists** in the loaded event set and otherwise falls back to [`CurrentEventSelector.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventselector) (`:101-108`), so a dangling id from a deleted event produces the current conference rather than an empty grid. `[Rubric §19, State Management & Data Flow]` and `[Rubric §25, Navigation & Information Architecture]`.
  2. **A startup race guard.** `OnInitializedAsync` assigns `_eventsLoadTask` before awaiting it (`:70-76`) and both `LoadServerData` (`:128-140`) and `FetchMobilePage` (`:151-159`) await that same task before applying filters, because the `MudDataGrid`'s first `ServerData` call can run ahead of initialization completing. The in-code comments state the invariant twice (`:72-73,130-131`): the default event filter must be resolved before the first fetch, or the grid loads an unfiltered page.
  3. **A non-fatal lookup.** `LoadEventsAndResolveDefaultAsync` (`:78-90`) swallows a failed event lookup (`:84-87`), leaving the picker hidden and the filter unset rather than failing the page. `[Rubric §29, Resilience & Business Continuity]`.
  `[Rubric §16, Maintainability]` (assesses reuse of one tested shape rather than parallel implementations): paging, rows-per-page, scroll restoration, the `IsLoading` / `LoadFailed` flags, `CancelLoading`, and the mobile/desktop switch all live in the base (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:20,40,44,722`), so this page supplies only its filters, its two fetch delegates, and its navigation.
- **Walkthrough**
  - `ApplyFilters` (`:142-148`): `FullName contains` plus the **virtual** `EventId equals` filter, which the speakers/paged endpoint intercepts and resolves through the EventSpeaker and SessionSpeaker joins, because a Speaker row has no `EventId` column (class doc, `:15-17`).
  - `LoadServerData` (`:128-140`) does **not** pass `showCancelSnackbar: false`, so the base's default of `true` applies (`DataGridListPageBase.cs:433-438`): an organizer page notifies on a cancelled fetch, where the public lists stay silent.
  - `RetryLoadAsync` (`:31-32`) re-runs the server fetch from the inline error state the base renders when `LoadFailed` is set, so a failed load offers a retry instead of a dead grid.
  - `OnSearchChanged` (`:115-119`) and `OnEventFilterChanged` (`:121-126`) both funnel through `ReloadActiveLayoutAsync` (`:112-113`), which delegates to `ListPageActions.ReloadActiveLayoutAsync` and reloads whichever of the grid or the infinite-scroll list is currently mounted. `[Rubric §22, Responsive & Cross-Browser]`: one filter change, two possible layouts, one code path.
  - `FetchMobilePage` (`:151-159`) builds the same filters and always sorts by `FullName` ascending, since the card list has no sortable headers.
  - `DeleteSpeakerAsync` (`:164-172`) delegates the whole confirm, delete, notify, reload cycle to `ListPageActions.DeleteWithConfirmationAsync`, passing the delete lambda and the localized messages; a Speaker is a top-level entity, so it deletes by a single id (contrast the child-entity list pages, which pass a parent id too).
  - `NavigateToCreate` and `NavigateToDetails` (`:174-175`) reach [`SpeakerCreate`](#speakercreate) and [`SpeakerDetail`](#speakerdetail); `OnMobileCardClick` (`:161`) reuses the same detail navigation.
- **Why it's built this way**: organizers work one conference at a time, so the list defaults to the current or next event; everything else is the shared base doing the paging, restoration, and layout switching.
- **Where it's used**: the `/speakers` route, restricted to the Organizer role (`SpeakerList.razor:1-2`), the entry point for the whole speaker admin flow.
- **Caveats / not-in-source**: the join-based resolution of the virtual `EventId` filter is asserted by the class doc comment (`:15-17`); the resolution itself lives in the Conference API.

### CachedSessionPage
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionList.razor.cs:366` · Level 3 · record (private sealed, nested)

- **What it is**: the serialization payload for the offline schedule snapshot, a `List<SessionDTO> Items` plus the `int TotalItems` count, declared as a private sealed record nested inside [`PublicSessionList`](#publicsessionlist) (`PublicSessionList.razor.cs:366`).
- **Depends on**: [`SessionDTO`](group-17-conference-domain.md#sessiondto); persisted through [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore) and gated by [`IConnectivityStatusService`](group-26-device-capability-layer.md#iconnectivitystatusservice).
- **Concept introduced, the offline read snapshot ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 3).** Conference day is exactly when the venue network is worst and the schedule matters most, so the page keeps the last good first page in device storage and replays it when a live fetch throws while offline. `[Rubric §29, Resilience & Business Continuity]` (assesses graceful degradation when a dependency is unreachable): the failure mode becomes stale-but-useful instead of an empty grid. `[Rubric §23, Front-End Performance & Rendering]` (assesses caching of read payloads): the snapshot is written on the success path and read only on the failure path, so it never adds latency to a healthy fetch.
- **Walkthrough**: a one-line positional record (`PublicSessionList.razor.cs:366`). It is written after every successful page-1 fetch when the store reports itself available (`:340-344`), keyed by the constant `ScheduleCacheKey = "conference.publicSessions.page1"` (`:42`). It is read back only inside the exception filter `when (!Connectivity.IsOnline && CacheStore.IsAvailable && page == 1)` (`:349`); if no snapshot exists the original exception is rethrown (`:352-355`), and a successful replay sets `_showingCachedData = true` (`:357`, field at `:364`) and calls `StateHasChanged()` (`:358`) so the markup can flag the view as cached. The success path clears that flag (`:346`), so a recovered network drops the banner on the next fetch. The banner itself is a warning-coloured cloud-off chip (`PublicSessionList.razor:23-29`).
- **Why it's built this way**: pairing the items with their total gives the grid's paging math a coherent shape to replay, and restricting the snapshot to page 1 keeps the stored payload bounded (page 1 is what an offline attendee lands on).
- **Where it's used**: read and written exclusively by [`PublicSessionList`](#publicsessionlist)'s `FetchSessionsAsync`.

---

### PublicScheduleRoomOptions
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicScheduleRoomOptions.cs:11` · Level 3 · class (internal static)

- **What it is**: the pure function behind the public schedule's Room picker. Given the events [`PublicSessionList`](#publicsessionlist) has already loaded, it returns the ordered room options for the active event filter plus the room filter that survives that scoping (`PublicScheduleRoomOptions.cs:21-42`).
- **Depends on**: [`RoomDTO`](group-17-conference-domain.md#roomdto) and [`EventDTO`](group-17-conference-domain.md#eventdto) from `MMCA.ADC.Conference.Shared.Events` (`:1`), plus the `RoomIdentifierType` and `EventIdentifierType` aliases; nothing else. No injected service, no fetch, no component base.
- **Concept introduced, the derived filter option set with a self-healing selection.** Two ideas are worth extracting from a 30-line file.
  1. **Derive, do not fetch.** The class doc states the rule (`:5-10`): the page already reads `/events?includeChildren=true`, so its rooms are in memory and narrowing the schedule by room costs zero extra round trips. The same doc records the security consequence that comes for free: that events read is published-only for non-privileged audiences server-side, so an unpublished event's rooms can never reach the picker. `[Rubric §23, Front-End Performance & Rendering]` (assesses avoidable network work per interaction) and `[Rubric §26, Front-End Security]` (assesses that a client-derived option set cannot widen what the server already scoped).
  2. **A selection that cannot go stale.** The last block (`:35-39`) re-validates `selectedRoomId` against the freshly scoped list and returns `null` when the room is no longer offered. The comment names both ways that happens: the reader switched events, or a stale choice was restored from saved page state. Without it, an unreachable room id would filter every session out and the reader would see an empty schedule with no visible cause. `[Rubric §19, State Management & Data Flow]` (assesses that derived state is reconciled rather than left to drift) and `[Rubric §24, Forms, Validation & UX Safety]`.
- **Walkthrough**: `Scope` (`:21-42`) is the only member.
  - Scoping (`:26-28`): a non-null `eventId` takes that event's `Rooms` (an unknown event id yields an empty list through the `?? []` fallback); a null id, which only a privileged reader viewing every event can produce, takes the union across all loaded events.
  - Shaping (`:30-33`): `DistinctBy(r => r.Id)` because the union can repeat a room, then `OrderBy(Sort).ThenBy(Name, StringComparer.OrdinalIgnoreCase)` so the picker order is the organizer's intended order with a deterministic case-insensitive tiebreak.
  - Reconciliation (`:37-39`) and the tuple return (`:41`), which the caller destructures straight into its two fields.
- **Why it's built this way**: keeping this out of the page makes it a plain static function over data, which is directly unit-testable without a renderer, and it keeps the page's own code down to one line (`PublicSessionList.razor.cs:194-195`). `[Rubric §14, Testability]` (assesses whether logic can be exercised without its host) and `[Rubric §1, SOLID]`.
- **Where it's used**: called only by [`PublicSessionList`](#publicsessionlist)'s `RefreshRoomOptions`, from the initial event load (`PublicSessionList.razor.cs:190`) and from every event-filter change (`:255`). The options it returns are passed down to [`PublicSessionListFilterBar`](#publicsessionlistfilterbar)'s `Rooms` parameter.

---

### ConferenceCategoryCreate
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.ConferenceCategory` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryCreate.razor.cs:9` · Level 5 · class (Blazor code-behind)

- **What it is**: the organizer's category-creation form. It collects three fields (title, sort order, type), posts one [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) through the UI service, and redirects to the detail page for the record it just made.
- **Depends on**: [`IConferenceCategoryUIService`](#iconferencecategoryuiservice) (`:11`), [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) (`:58`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:26,62,78`), and [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (`:51`); MudBlazor's `MudForm`, `ISnackbar` and `BreadcrumbItem`, plus `NavigationManager` and the page's `IStringLocalizer` (`ConferenceCategoryCreate.razor:4`).
- **Concept introduced, the create-page shape and its three safety rails.** This is the smallest create form in the group, which makes it the clearest place to read the shape every other one repeats.
  1. **Validate before you mutate.** `CreateCategoryAsync` calls `await _form.ValidateAsync()` and returns with a warning snackbar when `!_form.IsValid` (`:48-53`), before any service call. The server validates again; this pass exists to keep a round trip off the wire and to put the message next to the field. `[Rubric §24, Forms, Validation & UX Safety]` (assesses whether a form can submit itself into a predictable failure).
  2. **Dirty tracking that cannot block its own redirect.** Every editable control calls `MarkDirty()` (`:39`) and the markup mounts the shared guard as `<UnsavedChangesGuard IsDirty="_isDirty" IsDirtyAccessor="() => _isDirty" />` (`ConferenceCategoryCreate.razor:8`). The accessor is the load-bearing half: the guard prefers `IsDirtyAccessor?.Invoke()` over the parameter snapshot (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/UnsavedChangesGuard.razor:33,35`), because clearing the flag and calling `NavigateTo` without an intervening `StateHasChanged()` would otherwise still prompt. The page clears `_isDirty` on the success path **before** navigating, with the reason written on the line (`:60`).
  3. **Cancel on disposal.** A private `CancellationTokenSource` (`:15`) is passed into the service call (`:59`) and cancelled in a full `Dispose(bool)` pattern (`:82-102`), with `OperationCanceledException` caught and ignored as the expected teardown outcome (`:64-67`). `[Rubric §23, Front-End Performance & Rendering]`: a form abandoned mid-post does not keep a response alive for a component that no longer exists.
  Unlike the int-keyed create forms elsewhere in this module, this page sends `Id = default` (`:58`) and lets the server assign the key, then navigates on `created.Id` read back from the response (`:62`). `[Rubric §8, Data Architecture]` (assesses a deliberate identity strategy): the per-entity identifier alias ([ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)) keeps the key type out of the page's own logic.
- **Walkthrough**
  - `OnInitialized` (`:20-29`) builds the Home / Categories / Create breadcrumb trail from localized resource strings, with the middle crumb pointing at `ConferenceRoutePaths.ConferenceCategories` (`:26`).
  - The field block carries a comment worth reading (`:32-33`): the backing field is `_categoryTitle`, not `_title`, so it does not collide with the localized `Title` page property that SonarAnalyzer S4275 would flag. This is the analyzers-as-errors baseline showing up in page code.
  - `CreateCategoryAsync` (`:41-76`): null-guard the form (`:43-46`), validate, set `IsSaving` (`:55`), build the DTO (`:58`), post (`:59`), clear the dirty flag, snackbar the success (`:61`), redirect to the detail route (`:62`); the `finally` always clears `IsSaving` (`:72-75`) so a failed save leaves an enabled button rather than a stuck spinner.
  - `NavigateToList` (`:78`) is the cancel action, and it routes through [`ConferenceRoutePaths`](#conferenceroutepaths) rather than a literal. `[Rubric §25, Navigation & Information Architecture]`: every route in the module is a named constant in one file.
- **Why it's built this way**: one create shape repeated per entity keeps the organizer's mental model constant (fill, validate, save, land on the new record) while each page varies only in the fields it collects.
- **Where it's used**: the `/conferencecategories/create` route, carrying `[Authorize(Roles = "Organizer")]` on the page itself (`ConferenceCategoryCreate.razor:1-2`). It is reached from [`ConferenceCategoryList`](#conferencecategorylist)'s create button and redirects to [`ConferenceCategoryDetail`](#conferencecategorydetail).

---

### PublicSessionListFilterBar
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionListFilterBar.razor.cs:15` · Level 5 · class (Blazor code-behind)

- **What it is**: the presentational filter bar for [`PublicSessionList`](#publicsessionlist): the privileged-reader Filter-by-Event picker (or the locked "Showing" chip for everyone else), the debounced title search box, the Room picker, the All Sessions / My Schedule toggle, and the share-my-schedule action (`PublicSessionListFilterBar.razor.cs:8-14`).
- **Depends on**: [`EventDTO`](group-17-conference-domain.md#eventdto) and [`RoomDTO`](group-17-conference-domain.md#roomdto) (`:2`); [`IScreenshotService`](group-26-device-capability-layer.md#iscreenshotservice), [`IShareService`](group-26-device-capability-layer.md#ishareservice), and MudBlazor's `ISnackbar` (`:17-19`). Its `Rooms` option set is produced by [`PublicScheduleRoomOptions`](#publicscheduleroomoptions).
- **Concept introduced, the container/presentational split.** The bar owns **no** filter state. Every value arrives as a `[Parameter]` and every change leaves through a matching `EventCallback`: `IsPrivileged` (`:25`), `Events` (`:28`), `SelectedEventId` / `SelectedEventIdChanged` (`:31,34`), `SearchString` / `SearchStringChanged` (`:37,40`), `Rooms` (`:46`), `SelectedRoomId` / `SelectedRoomIdChanged` (`:49,52`), and `ShowMyScheduleOnly` / `ShowMyScheduleOnlyChanged` (`:55,58`). The page stays the single source of truth and the bar is a pure view over it, with no lifecycle method of its own. `[Rubric §18, UI Architecture & Component Design]` (assesses decomposition and separation of layout from behavior) and `[Rubric §19, State Management & Data Flow]` (assesses where mutable state lives): with nothing to initialize, the bar cannot drift from the data the grid actually fetched.
  Two naming and behavior details reward a close read. The parameter is `IsPrivileged`, not "is organizer", because the privileged read audience is a role set ([`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience)) rather than one role. And `Rooms` documents its own empty case (`:42-45`): an empty list hides the Room picker entirely, because an event with no rooms has nothing to narrow by. `[Rubric §24, Forms, Validation & UX Safety]`: a control with no meaningful options is removed rather than shown disabled.
- **Walkthrough**
  - `GetSelectedEventName()` (`:60-61`): resolves the chip label from the passed-in `Events` list, returning empty when nothing is selected.
  - `ShareScheduleAsync()` (`:63-71`): captures the current view to a file through [`IScreenshotService`](group-26-device-capability-layer.md#iscreenshotservice) and hands it to [`IShareService`](group-26-device-capability-layer.md#ishareservice) as `image/png` (`:65-67`); a null capture or a failed share collapses into one warning snackbar (`:69`). This is a native-head capability ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)) that degrades quietly on the web. `[Rubric §29, Resilience & Business Continuity]`.
- **Why it's built this way**: pushing all filter state to the page means the same chrome can sit above both the desktop grid and the mobile card list without either layout owning a second copy of the filters.
- **Where it's used**: rendered once by [`PublicSessionList`](#publicsessionlist) (`PublicSessionList.razor:11-21`); its callbacks land on that page's `OnEventFilterChanged`, `OnSearchChanged`, `OnRoomFilterChanged` and `OnMyScheduleToggled` handlers (`PublicSessionList.razor.cs:246-269`).

---

### ConferenceCategoryDetail
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.ConferenceCategory` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryDetail.razor.cs:11` · Level 7 · class (Blazor code-behind)

- **What it is**: the organizer's category console. It loads one [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) with its children, inline-edits the category itself, and runs a full add / edit / delete loop over its [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto) rows on the same page.
- **Depends on**: [`IConferenceCategoryUIService`](#iconferencecategoryuiservice) and [`ICategoryItemUIService`](#icategoryitemuiservice) (`:15-16`), [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) and [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto), the `CategoryItemIdentifierType` alias (`:60`), [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Id.Parse<T>` extension (`:76`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:33,302`), [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (`:80,89,127,147,180,205`), and the shared `DeleteConfirmation` component twice over (`:49,59`).
- **Concept introduced, the parent-with-children editor, and shadow fields as the edit buffer.** Two mechanisms carry this page.
  1. **Shadow fields.** Entering edit mode copies the live record into `_edit*` fields (`StartEditing`, `:97-109`) and cancelling simply drops them (`CancelEditing`, `:111-115`). The loaded `Category` is never mutated, so an abandoned edit leaves nothing behind and the rendered values stay exactly what the server last returned. The item editor repeats the idea with `_editingItemId` / `_editItemName` / `_editItemSort` (`:60-62`, seeded at `:232-238`). `[Rubric §19, State Management & Data Flow]` (assesses where mutable state lives and how long it lives).
  2. **Refetch, do not patch.** Every mutation is followed by `Category = await CategoryService.GetByIdAsync(Category.Id, true, _cts.Token)` (`:136`, `:214`, `:260`, `:289`). The page never edits its local child collection: the server's answer is the only rendering source. That costs one extra read per action and removes an entire class of drift between what was saved and what is shown. `[Rubric §19, State Management & Data Flow]` and `[Rubric §8, Data Architecture]`.
  The save path also round-trips the concurrency token: the updated DTO carries `RowVersion = Category.RowVersion` (`:134`), which is the client half of the optimistic-concurrency contract in [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html). `[Rubric §8, Data Architecture]` (assesses how concurrent writes are reconciled): a stale editor loses the write instead of silently overwriting a newer one. Note that the item update path (`:258`) does **not** carry a `RowVersion`, so a category item is a last-writer-wins edit while the category itself is not.
- **Walkthrough**
  - `OnInitialized` (`:27-36`) builds the Home / Categories / Details breadcrumb trail.
  - `OnParametersSetAsync` (`:64-95`): the load-once-on-parameters guard compares the route `Id` against `_loadedId` (`:66-71`) so a re-render does not refetch, parses the id to `ConferenceCategoryIdentifierType` (`:76`), fetches with children (`:77`), and reports a null result as a not-found snackbar through [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (`:80`). `OperationCanceledException` is swallowed as the expected teardown (or InteractiveAuto transition) outcome (`:83-86`) and the `finally` always clears `IsLoading`.
  - Category edit (`:97-153`): `StartEditing` / `CancelEditing` as above, then `SaveChangesAsync` (`:117-153`) validates the `MudForm` first (`:124-129`), rebuilds the DTO with the round-tripped `RowVersion` (`:134`), updates, refetches, and clears both `_isDirty` and `_isEditing` on success (`:138-139`).
  - Category delete (`:155-182`): confirm through the shared `DeleteConfirmation` dialog seeded with the category title (`:162`), delete, then navigate back to the list (`:172`).
  - Item CRUD (`:184-300`): `StartAddingItem` resets the new-item fields and closes any open row edit (`:185-191`), which is what keeps the two editors mutually exclusive; `AddItemAsync` (`:195-230`) validates its own separate `MudForm` (`:202-207`), posts a `CategoryItemDTO` stamped with the parent `CategoryId` (`:212`), and refetches. `UpdateItemAsync` (`:242-276`) is the one path that does **not** use a `MudForm`: it hand-checks `string.IsNullOrWhiteSpace(_editItemName)` and warns (`:249-253`), because the row editor is inline in the table rather than a form. `DeleteItemAsync` (`:278-300`) confirms through the second dialog instance (`:280`) and refetches.
  - Disposal (`:306-326`) is the standard cancel-on-disposal pattern over the `CancellationTokenSource` at `:22`; the markup mounts the unsaved-changes guard with the same accessor form the create page uses (`ConferenceCategoryDetail.razor:9`).
- **Why it's built this way**: a category is only meaningful together with its items (a topic list, a session-level list, a locality list), so editing them on two routes would be worse than a slightly larger page. Refetching after every mutation is the cheap way to keep a composite view coherent without a client-side store.
- **Where it's used**: the `/conferencecategories/{Id}` route with `[Authorize(Roles = "Organizer")]` (`ConferenceCategoryDetail.razor:1-2`), reached from [`ConferenceCategoryList`](#conferencecategorylist) rows and [`ConferenceCategoryCreate`](#conferencecategorycreate) redirects. The items it authors are what [`ICategoryItemLookupService`](#icategoryitemlookupservice) resolves for the session and speaker pages, including [`PublicSessionDetail`](#publicsessiondetail)'s category chips.

---

### ConferenceCategoryList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.ConferenceCategory` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryList.razor.cs:11` · Level 7 · class (Blazor code-behind)

- **What it is**: the organizer's category browse page: a server-paged grid with a single title search box, delete-with-confirmation, and a mobile card layout. It is a thin binding over the shared list-page base.
- **Depends on**: extends [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) closed over [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) (`:11`); [`IConferenceCategoryUIService`](#iconferencecategoryuiservice) (`:16`), [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) (`:24`), [`ListPageActions`](group-24-identity-module.md#listpageactions) (`:35,68`), [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (`:74`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:64,77`), and the shared `DeleteConfirmation` component (`:25`).
- **Concept introduced, the list page as a set of overrides.** The base owns the machinery: `LoadFailed`, the abstract `Title`, the `IsMobile` switch, the mobile paging fields, the filter save/restore contract, and `LoadServerDataAsync` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:40,41,44,47-50,108,111,121,434`). This page supplies five things and nothing else.
  - The captured grid reference, through the `GridRef` override (`:19-20`), which is how the base restores rows-per-page and the current page after a back-navigation.
  - `SaveFilters` / `RestoreFilters` for the one search term (`:28-32`). `[Rubric §25, Navigation & Information Architecture]`: a reader who opens a record and comes back finds the same view, not a reset grid.
  - `LoadServerData` (`:43-52`), which hands the base a fetch delegate and a filter builder that turns the search string into a server-side `Title contains` filter. `[Rubric §12, Performance & Scalability]` and `[Rubric §23, Front-End Performance & Rendering]`: search, sort and paging all execute where the data is, so the client never materializes a whole table.
  - `FetchMobilePage` (`:55-61`), the parallel path for the infinite-scroll card list, hard-sorted by `Title` ascending. `[Rubric §22, Responsive & Cross-Browser]` (assesses a genuine mobile layout rather than a shrunk grid): the same service call backs both branches, selected by the base's `IsMobile`.
  - `RetryLoadAsync` (`:23`), which re-runs the fetch from the inline error state the base renders when `LoadFailed` is set. `[Rubric §29, Resilience & Business Continuity]`: a failed load offers a retry instead of a dead grid.
  Two details separate this page from its siblings. Both fetch paths pass `includeChildren: true` (`:47,60`), because both layouts render the child item count, which is the one place a list page in this module pays for children. And deletion is not reimplemented: `ListPageActions.DeleteWithConfirmationAsync` (`:67-75`) takes the dialog, the label to show, the delete call, the snackbar, the localized success text, an error formatter, and the reload callback. `[Rubric §1, SOLID]` and `[Rubric §16, Maintainability]` (assess whether repeated behavior has one implementation): confirm, delete, toast, reload lives in one helper for every list page in the app.
- **Walkthrough**: `ReloadActiveLayoutAsync` (`:34-35`) asks [`ListPageActions`](group-24-identity-module.md#listpageactions) to reload whichever of the two layouts is live, and is the single reload entry point shared by search changes and post-delete refreshes; `OnSearchChanged` (`:37-41`) stores the term and calls it; `LoadServerData` (`:43-52`) and `FetchMobilePage` (`:55-61`) apply the same `contains` filter to the desktop and mobile paths; `OnMobileCardClick` (`:63-64`) and `NavigateToCreate` (`:77`) route through [`ConferenceRoutePaths`](#conferenceroutepaths). Note that `LoadServerData` does **not** pass `showCancelSnackbar: false`, so unlike the public lists the base's default cancel notification applies here.
- **Why it's built this way**: several near-identical organizer browse surfaces are exactly the case a base class is for. Because each page is only its overrides, a change to paging, scroll restoration or the mobile switch lands in one place and every list inherits it.
- **Where it's used**: the `/conferencecategories` route with `[Authorize(Roles = "Organizer")]` (`ConferenceCategoryList.razor:1-2`). Rows and cards navigate to [`ConferenceCategoryDetail`](#conferencecategorydetail); the create button opens [`ConferenceCategoryCreate`](#conferencecategorycreate).

---

### PublicSessionListView
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionListView.razor.cs:23` · Level 7 · class (Blazor code-behind)

- **What it is**: the presentational session-list view for [`PublicSessionList`](#publicsessionlist): the mobile infinite-scroll card list and the desktop server-paged data grid, including the inline bookmark stars and their toggle flow (`PublicSessionListView.razor.cs:12-22`).
- **Depends on**: [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`ISessionBookmarkUIService`](group-22-engagement-module.md#isessionbookmarkuiservice) (optional, `:57`), [`SpeakerInfo`](#speakerinfo) (`:66`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:176`), [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) (`:77`, rendered at `PublicSessionListView.razor:6`), [`ListPageActions`](group-24-identity-module.md#listpageactions) (`:91`), and [`IHapticFeedbackService`](group-26-device-capability-layer.md#ihapticfeedbackservice) (`:26`); MudBlazor grid types and `NavigationManager`.
- **Concept introduced, the presentational child that patches container-owned state in place.** Like [`PublicSessionListFilterBar`](#publicsessionlistfilterbar), the view owns no fetch or filter state: the page hands down its `ServerData` and `FetchPage` delegates (`:72,75`), its paging parameters (`:39-45`), the speaker and room lookups (`:66,69`), and the shared `BookmarkedSessions` dictionary (`:63`). The subtlety is that the view **mutates that dictionary in place** when a star is toggled (`AddBookmarkAsync` writes `BookmarkedSessions[sessionId] = bookmark.Id` at `:154`, `RemoveBookmarkAsync` removes at `:139`), so the page's My Schedule fetch, which reads the same dictionary to build its `Id IN (...)` filter, sees the change without a round trip. The class doc names the sibling that uses the same pattern (`:16-18`). It also exposes the captured `Grid` reference (`:87`) and `ReloadAsync()` (`:90-91`) so the page's [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) plumbing keeps restoring rows-per-page and current page unchanged. `[Rubric §18, UI Architecture & Component Design]` and `[Rubric §19, State Management & Data Flow]`: state has exactly one owner (the page) and one mutation point (this component).
  The class doc also records a deliberate omission (`:20-21`): the list shows no track or category chips, because the detail page is where a session's categories are read and the list stays scannable on time, speakers, and room. `[Rubric §25, Navigation & Information Architecture]`.
- **Walkthrough**
  - `IsBookmarked` (`:93-94`) is a dictionary lookup, so star state costs nothing per row.
  - `CanBookmark` (`:100-105`): a session is bookmarkable only when the user is authenticated, the Engagement-owned service resolved, the session is not a service session, and its status is unset or `"Accepted"`. The comment (`:96-99`) records that this literal mirrors [`SessionStatuses`](group-17-conference-domain.md#sessionstatuses) in Conference.Domain, which is the source of truth: the UI layer depends on Shared only, so the check is duplicated rather than referenced, precisely so the UI never shows a star the server would reject. `[Rubric §11, Security]` and `[Rubric §24, Forms, Validation & UX Safety]`.
  - `ToggleBookmarkAsync` (`:107-134`): guards re-entry with a **per-session** `HashSet` whose `Add` doubles as the guard test (`:109`, field at `:80`), fires `Haptics.Click()` (`:113`, a no-op off native heads), then adds or removes, with a single error snackbar around both (`:126-129`) and removal from the guard set in the `finally` (`:132`). The per-session guard is a fixed defect worth reading: the comment at `:78-79` records that a single global in-flight flag made one slow toggle swallow every other star's click.
  - `AddBookmarkAsync` (`:149-163`): a 2xx whose body deserialized to null leaves the star unset, so the page reports a warning rather than a success toast that would contradict its own UI (`:157-162`).
  - `RemoveBookmarkAsync` (`:136-147`): removes the entry and, when the My Schedule view is active, reloads so the removed row disappears (`:143-146`).
  - `GetSpeakerList` (`:165-173`) maps a session's `SessionSpeakers` to display names through the passed-in lookup, skipping ids the lookup does not know; `OnMobileCardClick` (`:175-176`) routes to [`PublicSessionDetail`](#publicsessiondetail).
- **Why it's built this way**: separating the grid and card layouts from the page's fetch-and-filter logic lets one bookmark implementation serve both, while the page remains the owner of every piece of state either layout renders.
- **Where it's used**: rendered by [`PublicSessionList`](#publicsessionlist), which holds it as `_view` (`PublicSessionList.razor.cs:44`, captured at `PublicSessionList.razor:31`) and reads `_view?.Grid` for its `GridRef` override (`:72`) and `_view?.ReloadAsync()` for every filter change (`:271`).

---

### PublicEventDetail
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicEventDetail.razor.cs:16` · Level 8 · class (Blazor code-behind)

- **What it is**: the read-only public view of one event: venue information, rooms, support contacts, and the conference-day conveniences (copy the Wi-Fi details, open directions, a distance-to-venue hint, a QR code for the page itself). For a public visitor it is also the landing page of the whole conference, because [`PublicEventList`](#publiceventlist) redirects them here.
- **Depends on**: [`IEventUIService`](#ieventuiservice) (`:18`), [`EventDTO`](group-17-conference-domain.md#eventdto), [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience) (`:62`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:78,138,140,142`), [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Id.Parse<T>` extension for the route string (`:104`), and four device-capability abstractions: [`IClipboardService`](group-26-device-capability-layer.md#iclipboardservice), [`IMapNavigationService`](group-26-device-capability-layer.md#imapnavigationservice), [`IGeolocationService`](group-26-device-capability-layer.md#igeolocationservice), [`IGeocodingService`](group-26-device-capability-layer.md#igeocodingservice) (`:21-24`). It also reads `IConfiguration` for the host-wide support contacts (`:25,54-55`).
- **Concept introduced, load-once-on-parameters, an audience-shaped breadcrumb trail, and best-effort progressive enhancement.** Three mechanisms are worth extracting.
  1. **Load once per id.** The route value arrives as `[Parameter] string Id` (`:27`), and `OnParametersSetAsync` compares it against `_loadedId` (`:88-97`) so a re-render does not refetch; the typed id is produced by `Id.Parse<EventIdentifierType>()` (`:104`).
  2. **The breadcrumb trail depends on the audience, and the audience is awaited first.** `OnInitializedAsync` resolves privileged status from role membership before building the trail (`:57-68`), then adds the "Events" crumb only for a privileged reader (`:76-79`). The doc comment states both halves of the reasoning (`:44-51`): a public visitor was redirected *to* this page by the event list, so an Events crumb would bounce them straight back here, and the access token hydrates asynchronously from the HttpOnly cookie, so reading roles synchronously would render the wrong trail and correct it on the next render. A failed auth read is treated as non-privileged (`:63-67`). `[Rubric §25, Navigation & Information Architecture]` (assesses that navigation affordances lead somewhere the reader can actually use) and `[Rubric §26, Front-End Security]` (fail closed to the narrower audience).
  3. **Every capability is optional.** `TryComputeDistanceAsync` (`:179-201`) returns early when geolocation or geocoding is unsupported or the venue address is blank (`:181-184`), and again on any null result (`:186-196`), so a denied permission or an offline geocoder simply leaves the hint off. The doc comment states the rule plainly: this must never block the page (`:174-178`). `[Rubric §29, Resilience & Business Continuity]` (assesses degradation when an optional dependency is absent) and `[Rubric §26, Front-End Security]` (a location read is soft and unblocking, never a gate on content). These come from the device-capability layer of [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html).
  A fourth detail is a small but real configuration rule: a per-event `OrganizerContactEmail` wins over the host-wide `Support:Email`, and it is re-evaluated on every load so navigating between events never leaves the previous organizer's address on screen (`:112-117`). `[Rubric §16, Maintainability]`: a conference can publish its own contact without a redeploy.
- **Walkthrough**
  - `LoadEventAsync` (`:99-134`): parse the id, fetch with children (`GetByIdAsync(eventId, true, ...)`, `:105`), snackbar a not-found (`:108`), otherwise resolve the support address and kick off the distance hint (`:115-119`); `OperationCanceledException` is swallowed as expected teardown and the `finally` always clears `IsLoading`.
  - `CopyWifiAsync` (`:146-157`): copies `Event.WiFiInfo` through the clipboard abstraction and reports success or failure with one snackbar whose severity flips on the result (`:154-156`).
  - `OpenDirectionsAsync` (`:159-172`): native heads launch the platform maps app, browsers open a maps site (`:166-167`); a false return raises a warning.
  - `TryComputeDistanceAsync` (`:179-201`): geocodes the venue, reads the current-or-last-known position, converts kilometres to miles with an explicit named constant (`:198-199`), and calls `StateHasChanged()` (`:200`) because the value arrives after the render that requested it.
  - Navigation helpers (`:136-144`) route back to the list (privileged readers only, per the comment at `:136-137`), on to the public schedule, on to the activities page, and to the event feedback form. Disposal (`:205-225`) is the standard cancel-on-disposal pattern over the `CancellationTokenSource` at `:31`.
- **Why it's built this way**: the public event page is the one an attendee opens while standing in the building, so its extras (Wi-Fi, directions, distance) are worth having and none of them is worth failing the page over.
- **Where it's used**: the `/conference/events/{Id}` route (`PublicEventDetail.razor:1`), reached from [`PublicEventList`](#publiceventlist) either as a grid row (privileged) or as a `replace: true` redirect (everyone else); its markup also renders the `QrCodeButton` for this page's own public link (`PublicEventDetail.razor:30`).

---

### PublicSpeakerDetail
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSpeakerDetail.razor.cs:14` · Level 8 · class (Blazor code-behind)

- **What it is**: the public speaker profile: photo, bio, social links, and the sessions that speaker presents. Email is deliberately **not** rendered, BR-66 (`PublicSpeakerDetail.razor.cs:10-13`).
- **Depends on**: [`ISpeakerUIService`](#ispeakeruiservice) and [`ISessionUIService`](#isessionuiservice) (`:16-17`), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) and [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:38,130,132`), and [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Id.Parse<T>` (`:78`).
- **Concept introduced, the prerender skip and the server-side filter that replaced an in-memory one.**
  1. **Prerender skip.** `OnParametersSetAsync` returns immediately when `!RendererInfo.IsInteractive` (`:59-62`): under InteractiveAuto the interactive instance re-runs the method, so without this guard every visit fetched the speaker and their sessions twice. The prerender pass renders the loading skeleton instead, and the comment names the sibling pages that use the same guard (`:56-58`). `[Rubric §23, Front-End Performance & Rendering]` (assesses avoidable duplicate work per view).
  2. **Push the filter to the server.** `LoadSpeakerSessionsAsync` (`:111-128`) sends a `SpeakerId equals` filter with `includeChildren: false`, sorted by `StartsAt` ascending, capped at `MaxSpeakerSessions = 100` (`:23-24`). The remarks block (`:105-110`) records what this replaced: the page used to pull the entire session catalog with all child collections and filter it in memory on `SessionSpeakers`, so viewing one speaker cost a full-catalog read. Since the page never renders those children, they are gone from the request too. `[Rubric §12, Performance & Scalability]` (assesses moving work to where the data lives) and `[Rubric §8, Data Architecture]` (a bounded page size instead of an unbounded read).
  `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses deliberate handling of personal data): the speaker email exists on the DTO but is never rendered on the public page, and the class doc names the rule.
- **Walkthrough**
  - `OnInitialized` (`:32-41`) builds the Home / Speakers / Profile breadcrumbs; unlike [`PublicEventDetail`](#publiceventdetail) it is synchronous, because the speaker list is reachable by every audience and the trail does not vary.
  - `HasSocialLinks` (`:48-52`) collapses the four optional link fields into a single render guard, so the social row is absent rather than empty when a speaker supplied none.
  - `LoadSpeakerAsync` (`:73-100`): parse the id, `GetByIdAsync(speakerId, true, ...)` (`:79`), snackbar and return on not-found (`:80-84`), then load the sessions (`:86`); `OperationCanceledException` is swallowed (`:88-91`) and the `finally` clears `IsLoading`.
  - Navigation (`:130-132`) routes to a session or back to the speaker list. Disposal (`:136-156`) is the standard cancel-on-disposal pattern over the page's `CancellationTokenSource` (`:26`).
- **Why it's built this way**: a public profile is a read-only, cache-friendly page; keeping its fetches narrow (one speaker, that speaker's sessions, no children) is what makes it cheap enough to serve to an anonymous crowd.
- **Where it's used**: the `/conference/speakers/{Id}` route (`PublicSpeakerDetail.razor:1`), reached from [`PublicSpeakerList`](#publicspeakerlist) cards and from session pages. Its markup renders the `QrCodeButton` for its own link (`PublicSpeakerDetail.razor:45`).

---

### PublicActivityList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicActivityList.razor.cs:19` · Level 9 · class (Blazor code-behind)

- **What it is**: the public social and networking programme. It lists the current (or next) event's activities (pre-conference party, coffee connect, after-party, closing ceremony) ordered by start time then display order, read-only and anonymous, BR-43 (`PublicActivityList.razor.cs:11-18`).
- **Depends on**: [`IActivityUIService`](#iactivityuiservice) and [`IEventLookupService`](#ieventlookupservice) (`:26-27`), [`ActivityDTO`](group-17-conference-domain.md#activitydto), [`EventInfo`](#eventinfo) (through the lookup), [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (`:53-58`), and [`IMapNavigationService`](group-26-device-capability-layer.md#imapnavigationservice) (`:28`); MudBlazor's `ISnackbar` and the page's `IStringLocalizer`.
- **Concept introduced, the bounded, deterministically ordered, single-shot read.** This page is not a data grid, and reading it next to [`ConferenceCategoryList`](#conferencecategorylist) is the clearest way to see when the base class is the wrong tool. An activity programme is a handful of items with a fixed narrative order (chronological), so there is nothing to page, sort or search.
  - **Bounded read**: `MaxActivities = 200` with the reasoning written on the constant, a conference schedules a handful, not thousands (`:21-22`). `[Rubric §12, Performance & Scalability]` (assesses that unbounded reads are avoided by design, not by luck).
  - **Deterministic order**: the server is asked for `StartTime` ascending (`:72-73`), and the result is re-ordered in memory by `StartTime`, then `SortOrder`, then `Name` (`:79-85`). The comment (`:76-78`) explains the layering: start time is the programme order, sort order breaks ties between activities that start together, and name is the final tiebreak so the list never depends on insertion order.
  - **Failure is non-fatal**: `OperationCanceledException` is separated out as expected teardown (`:87-90`) and the broad `catch` (`:91-94`) deliberately leaves the page on its empty state rather than surfacing an error; the `finally` always clears `_isLoading`. `[Rubric §29, Resilience & Business Continuity]`.
  - **Culture-aware time rendering**: `FormatTimeRange` (`:39-43`) formats start and end with `CultureInfo.CurrentCulture` and composes them through a localized `Text.TimeRange` resource, so both the times and the separator follow the viewer's culture. `[Rubric §27, Internationalization]` (assesses that formatting and phrasing are both localized, not just the strings).
  The class doc also draws the domain line that shapes the whole page (`:15-17`): activities are not sessions. They carry no room and no speakers, and an activity with its own venue gets the same directions affordance the public event page uses for the conference venue.
- **Walkthrough**
  - `OnInitializedAsync` (`:45-99`): load the event lookup (`:50`), resolve the current or next event through [`CurrentEventSelector.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventselector) with the four accessors passed explicitly because the lookup returns `EventInfo` rather than `EventDTO` (`:53-58`), remember its id and name (`:60-61`), build an `EventId equals` filter when one resolved (`:64-66`), fetch one bounded page (`:68-74`), and materialize the ordered list (`:79-85`).
  - `OpenDirectionsAsync` (`:101-118`): does nothing for an activity with no venue address (`:103-106`), otherwise launches the platform maps app on native heads or a maps site in a browser (`:109-112`), labelling the pin with the venue name and falling back to the activity name when the venue is unnamed (`:111`); a false return raises one warning snackbar (`:114-117`).
  - Disposal (`:122-142`) is the standard cancel-on-disposal pattern over the `CancellationTokenSource` at `:31`.
- **Why it's built this way**: a fixed-order programme wants a readable timeline, not sortable columns, and the read is small enough that one bounded call beats the machinery of server paging.
- **Where it's used**: the `/conference/activities` route (`PublicActivityList.razor:1`), reached from [`PublicEventDetail`](#publiceventdetail)'s `ViewActivities` action (`PublicEventDetail.razor.cs:142`).
- **Caveats / not-in-source**: the page relies on the server scoping non-privileged callers to published events (class doc, `:13-15`); that scoping is enforced in the Conference API, not here.

---

### PublicEventList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicEventList.razor.cs:30` · Level 9 · class (Blazor code-behind)

- **What it is**: the `/conference/events` route, where the audience decides whether a list is shown at all. A privileged reader (Organizer or ContentEditor) gets the full grid of published **and** unpublished events; every other visitor is redirected to the current or next event's detail page (`PublicEventList.razor.cs:13-29`).
- **Depends on**: extends [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) closed over [`EventDTO`](group-17-conference-domain.md#eventdto) (`:30`); [`IEventUIService`](#ieventuiservice) and [`IEventLookupService`](#ieventlookupservice) (`:34-35`), [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience) (`:76`), [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (`:104`), [`EventInfo`](#eventinfo) (`:90`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:116,159`), [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) (`:45`, rendered at `PublicEventList.razor:23`), and [`ListPageActions`](group-24-identity-module.md#listpageactions) (`:134`). Server-side the audience split is enforced by [`PublishedEventSpecification`](group-18-conference-application.md#publishedeventspecification).
- **Concept introduced, the audience gate as a routing decision, and the three-state render.** This page is the sharpest example in the group of a UI decision that has to wait for identity.
  1. **Resolve the audience before deciding anything.** `OnInitializedAsync` awaits the cascading `Task<AuthenticationState>` and reads role membership first (`:71-82`). The comment (`:68-70`) and the class doc (`:21-25`) both name the failure this prevents: on all three heads (Blazor Server, WebAssembly, MAUI) the access token hydrates asynchronously from the HttpOnly cookie, so a synchronous role read would see an anonymous principal and bounce an organizer off their own list. A failed read is treated as non-privileged (`:78-81`). `[Rubric §11, Security]` and `[Rubric §26, Front-End Security]` (assess that an authorization-shaped branch reads a settled principal, and fails to the narrower audience).
  2. **Three states, and one of them renders nothing.** `_showGrid` (`:52`) opens the search box and the layout switch for a privileged reader (`:84-88`); `_showEmpty` (`:60`) is set only when nothing is published anywhere, so there is no redirect target and the page has to stay and say so (`:120-122`); and the redirect path deliberately leaves **both** false (`:111-118`), so the page stays blank until the navigation takes effect instead of flashing a list on the way out. The field doc spells this out (`:54-59`). `[Rubric §18, UI Architecture & Component Design]` and `[Rubric §22, Responsive & Cross-Browser]` (assess that intermediate states are designed rather than incidental).
  3. **`replace: true` on the redirect.** The comment (`:113-115`) records the exact bug it prevents: left in the history stack, Back from the event detail would land here and redirect straight forward again, trapping the visitor on the detail page. `[Rubric §25, Navigation & Information Architecture]` (assesses that the Back button keeps working).
  The redirect target is computed with [`CurrentEventSelector.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventselector), passing the four accessors explicitly because the lookup returns `EventInfo` rather than `EventDTO`, which the comment calls out (`:100-109`). It is the same live-window math every other landing surface uses, so a visitor always lands on the conference that is actually happening.
- **Walkthrough**
  - `GridRef` (`:41`) exposes the captured grid so the base can restore rows-per-page and current page; `RetryLoadAsync` (`:43-44`) re-runs the fetch from the inline error state the base renders when `LoadFailed` is set. `[Rubric §29, Resilience & Business Continuity]`.
  - `SaveFilters` / `RestoreFilters` (`:125-129`) persist the one search term; `OnSearchChanged` (`:131-135`) stores it and reloads whichever layout is active through `ListPageActions.ReloadActiveLayoutAsync`.
  - `LoadServerData` (`:137-147`) passes `showCancelSnackbar: false`, so a superseded fetch (the reader typed another character) is silent rather than raising a toast, and turns the search string into a `Name contains` server filter.
  - `FetchMobilePage` (`:150-156`) is the parallel infinite-scroll path, hard-sorted by `Name` ascending; `OnMobileCardClick` (`:158-159`) routes to [`PublicEventDetail`](#publiceventdetail).
- **Why it's built this way**: a public visitor cares about the conference that is running or coming up, not about a roster of past editions, while an organizer curating the catalog needs every row including the unpublished ones. One route serving both is cheaper than two, provided the audience is known before the branch is taken.
- **Where it's used**: the `/conference/events` route (`PublicEventList.razor:1`). Every non-privileged arrival leaves immediately for [`PublicEventDetail`](#publiceventdetail); privileged rows and cards navigate to the same page.
- **Caveats / not-in-source**: the published-only scoping of the underlying reads for non-privileged callers (BR-108) is enforced in the Conference API through [`PublishedEventSpecification`](group-18-conference-application.md#publishedeventspecification), not on this page.

---

### PublicSessionDetail
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionDetail.razor.cs:20` · Level 9 · class (Blazor code-behind)

- **What it is**: the public read-only view of one session (speakers, categories, room and wayfinding) plus the contextual actions an authenticated attendee gets: the bookmark toggle, the feedback link, a listen-aloud button, and the Live entry point when the Engagement module is present.
- **Depends on**: [`ISessionUIService`](#isessionuiservice), [`ISpeakerLookupService`](#ispeakerlookupservice), [`IRoomUIService`](#iroomuiservice), [`ICategoryItemLookupService`](#icategoryitemlookupservice) (`:22-25`); optionally [`ISessionBookmarkUIService`](group-22-engagement-module.md#isessionbookmarkuiservice) and [`ISessionLiveUIService`](group-23-engagement-live-layer.md#isessionliveuiservice) (`:34,37`); [`IHapticFeedbackService`](group-26-device-capability-layer.md#ihapticfeedbackservice) and [`ITextToSpeechService`](group-26-device-capability-layer.md#itexttospeechservice) (`:29-30`); [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`RoomDTO`](group-17-conference-domain.md#roomdto), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:57,236`), and [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Id.Parse<T>` (`:109`).
- **Concept introduced, optional cross-module services resolved through the container.** Blazor's `[Inject]` has no optional mode (an unregistered service throws at render), so the two Engagement-owned services are resolved with `ServiceProvider.GetService<T>()` in `OnInitialized` and left null when that module is disabled (`:32-37,52-53`). Every use site then null-checks. `[Rubric §7, Microservices Readiness]` (assesses that a module can be switched off without breaking its consumers): the Conference page degrades to a plain read-only session view when Engagement is absent, rather than failing to render. `[Rubric §3, Clean Architecture]`: the dependency is on an interface owned by the other module's Shared or UI contract, never on its internals.
  The page repeats two mechanisms taught above. The **prerender skip** (`:84-93`) carries the most specific comment of the three that use it: it names the category-item read as the expensive duplicate, a full-table read per view. And **load-once-on-parameters** (`:95-101`) keeps a re-render from refetching. It also repeats the BR-49 status allow-list as `IsStatusIneligible` (`:77-82`), with the comment again pointing at [`SessionStatuses`](group-17-conference-domain.md#sessionstatuses) as the server-side source of truth and explaining that the UI layer depends on Shared only.
- **Walkthrough**
  - `LoadSessionAsync` (`:104-134`): fetch the session with children (`:110`), then resolve speaker names (`:136-142`), category names (`:144-154`, prefixing the category title when present so a chip reads "Level: Intermediate"), the room including wayfinding info (`:156-166`, BR-94, and skipped entirely for a session with no room), and the caller's bookmark state (`:168-189`, keyed off the `user_id` claim). Each resolver runs only after the session loaded, so a not-found short-circuits the whole chain (`:111-115`).
  - `ToggleBookmarkAsync` (`:191-234`): a single `_isTogglingBookmark` re-entry guard (this page shows one session, so the per-session set [`PublicSessionListView`](#publicsessionlistview) needs is unnecessary here), a haptic click (`:197`), then delete-or-create with the same null-body warning path the list view uses (`:219-223`).
  - `ToggleListenAsync` (`:243-266`): text to speech over the description, where the same button stops playback (`:250-254`); `SpeakAsync` completes when playback finishes or `StopAsync` cancels it, and the `finally` clears `_isSpeaking` either way. `[Rubric §21, Accessibility]` (assesses alternative modalities for content) and [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 3.
  - Navigation (`:236-238`) returns to the schedule or opens the session feedback form; disposal (`:270-290`) is the standard cancel-on-disposal pattern.
- **Why it's built this way**: this is the page an attendee opens in a hallway, so the expensive lookups are done once per id, the optional capabilities fail soft, and the actions (star, feedback, listen, Live) sit inline instead of on separate routes.
- **Where it's used**: the `/conference/sessions/{Id}` route (`PublicSessionDetail.razor:1`), reached from [`PublicSessionListView`](#publicsessionlistview) rows and cards and from [`PublicSpeakerDetail`](#publicspeakerdetail); its markup renders the `QrCodeButton` for its own public link (`PublicSessionDetail.razor:41`).

---

### PublicSpeakerList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSpeakerList.razor.cs:35` · Level 9 · class (Blazor code-behind)

- **What it is**: the public speaker directory, rendered as a photo-forward responsive **card grid** with infinite scroll, the same layout on desktop and mobile. Read-only for everyone (BR-43), no emails (BR-66), and the server returns only speakers with a visible session in the listed event, or in any published event when no event filter is applied, BR-239 (`PublicSpeakerList.razor.cs:12-34`).
- **Depends on**: extends [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) closed over [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) (`:35`); [`ISpeakerUIService`](#ispeakeruiservice) and [`IEventLookupService`](#ieventlookupservice) (`:44-45`), [`EventInfo`](#eventinfo) (`:54`), [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience) (`:122`), [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (`:156`), and [`InfiniteScrollSentinel`](#infinitescrollsentinel) (`PublicSpeakerList.razor:144`). Note what is **absent**: no `MudDataGrid`, no `GridRef` override, no [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem).
- **Concept introduced, borrowing a base class's plumbing for a layout it was not written for.** A speaker is a face and a tagline, not a row of columns, so this page throws away the grid and keeps everything else. The class doc explains the trade (`:23-30`): paging keeps the page-based model of the base's mobile path (`MobileItems`, `MobileCurrentPage`, `MobileTotalItems`, `MobilePageSize`, declared at `DataGridListPageBase.cs:47-50`), which already owns the cancellation token, the loading and failure flags, and the saved-state plumbing, and layers infinite scroll on top by **appending** each fetched page to `_loadedSpeakers` (`:56`) rather than replacing, which is what the base's mobile path does on its own. `[Rubric §16, Maintainability]` and `[Rubric §1, SOLID]` (assess reuse of one tested mechanism rather than a parallel implementation).
  Three correctness details make that borrowing safe, and they are the real lesson of this page.
  1. **A generation counter supersedes in-flight fetches.** `_generation` (`:66`) is bumped by every reset (search, event filter, breakpoint change, retry) inside `LoadSpeakersAsync` (`:186`), and both `LoadSpeakersAsync` (`:197-200`) and `LoadMoreSpeakersAsync` (`:229-232`) discard their rows when a newer generation has taken over. Without it a slow page-1 fetch could append to the list a later query had already cleared. `[Rubric §19, State Management & Data Flow]`.
  2. **The list is cleared before the await, not after.** The comment (`:190-191`) states why: the grid, and with it the sentinel, is gone while page 1 is in flight, so a stray intersection-observer callback cannot ask for page 2 of the query being replaced. `[Rubric §18, UI Architecture & Component Design]`.
  3. **The page number is committed only on success.** `LoadMoreSpeakersAsync` saves `previousPage`, optimistically advances, and rolls back when `LoadFailed` is set (`:221-241`), so the retry button re-requests the same page instead of silently skipping it. `[Rubric §29, Resilience & Business Continuity]`.
  Layered on top is the same **audience-aware default filter** [`PublicSessionList`](#publicsessionlist) uses: an `"all"` sentinel distinguishes an explicit "show all events" from no saved state (`:82-83`), the choice is persisted **only** for privileged readers (`:80`), and `ResolveDefaultEventFilter` (`:142-163`) keeps a restored id that still exists for a privileged reader while locking everyone else to the computed current or next event. The comment (`:144-146`) states the security consequence, and the roles come from [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience) with a failed read treated as non-privileged (`:117-128`). `[Rubric §11, Security]` and `[Rubric §26, Front-End Security]` (assess that a client-persisted preference cannot widen what a user sees).
- **Walkthrough**
  - `CardsPerPage = 12` (`:37-38`) is assigned to the base's `MobilePageSize` in the constructor (`:40`), with the reasoning on the constant: a multiple of 2, 3 and 4 so a full chunk fills whole rows at every breakpoint. `[Rubric §22, Responsive & Cross-Browser]`.
  - `HasMoreSpeakers` (`:72`) is true exactly while pages remain unfetched, and that is exactly when the sentinel renders, so the trigger and the condition cannot disagree.
  - `FetchCurrentPageAsync` (`:174-178`) delegates to the base's `LoadMobileDataAsync` with a fixed `FullName` ascending sort; `ApplyFilters` (`:272-278`) emits `FullName contains` plus the **virtual** `EventId equals` filter that the speakers endpoint resolves through the EventSpeaker and SessionSpeaker joins, since a Speaker row has no `EventId` column (class doc, `:21-22`).
  - `OnMobileDataRequestedAsync` (`:257`) is the base's breakpoint-change hook (`DataGridListPageBase.cs:720`, called at `:272`), overridden here to restart the accumulation rather than fetch one replacement page.
  - `RetryLoadAsync` (`:254`), `OnSearchChanged` (`:259-263`) and `OnEventFilterChanged` (`:265-270`) all funnel through `LoadSpeakersAsync`, which is the single reset entry point; `GetSelectedEventName` (`:165-168`) feeds the chip label.
  - `Initials` (`:281-288`) builds the no-photo avatar text with spans, tolerating a blank first or last name; `HasSocialLinks` (`:290-294`) hides the social row when a speaker supplied none.
- **Why it's built this way**: attendees browse "the speakers at this conference", not a lifetime roster, so the default filter is the primary behavior and the picker is the privileged exception; and a directory of faces reads better as an endless wall of cards than as a pager. The class doc adds one more deliberate omission (`:31-33`): category chips are absent because the paged endpoint is called with `includeChildren=false`, so asking for them would both enlarge the payload and change the URL the output-cache warmup pins ([ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).
- **Where it's used**: the `/conference/speakers` route (`PublicSpeakerList.razor:1`); cards navigate to [`PublicSpeakerDetail`](#publicspeakerdetail).
- **Caveats / not-in-source**: the join-based resolution of the virtual `EventId` filter is asserted by the class doc comment; the resolution itself lives in the Conference API. A restored mobile page number is deliberately ignored (class doc, `:29-30`), so a reader returning to this page starts at page 1 rather than at the scroll depth they left.

---

### PublicSponsorList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSponsorList.razor.cs:18` · Level 9 · class (Blazor code-behind)

- **What it is**: the public sponsor and exhibitor page. It groups the current (or next) event's sponsors by tier, orders them within each tier, and renders them as logo cards. Read-only and anonymous, BR-43 (`PublicSponsorList.razor.cs:10-17`).
- **Depends on**: [`ISponsorUIService`](#isponsoruiservice) and [`IEventLookupService`](#ieventlookupservice) (`:25-26`), [`SponsorDTO`](group-17-conference-domain.md#sponsordto) and [`SponsorTier`](group-17-conference-domain.md#sponsortier), [`EventInfo`](#eventinfo) (through the lookup), and [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (`:52-57`); MudBlazor and the page's `IStringLocalizer`.
- **Concept introduced, the deterministic grouped read and the graceful empty state.** Like [`PublicActivityList`](#publicactivitylist), this page is not a data grid: the roster is small and needs a fixed visual hierarchy, so the page fetches one bounded page and shapes it in memory.
  - **Bounded read**: `MaxSponsors = 200` with the reasoning stated on the constant, a conference sells dozens, not thousands (`:20-21`). `[Rubric §12, Performance & Scalability]` (assesses that unbounded reads are avoided by design, not by luck).
  - **Deterministic order**: sponsors are grouped by tier, tiers ordered ascending because that is package order (Platinum first), and each group ordered by `Sort` then `Name` (`:78-86`), so the strip does not depend on insertion order. The comment states the rule (`:76-77`).
  - **Empty state with no dead link**: when the event has no sponsors the page falls back to the sponsorship-packet call to action, and when the event publishes no packet URL that call to action is hidden entirely rather than offering a dead link (class doc `:14-16`, field doc `:32-36`, assigned at `:61`). `[Rubric §24, Forms, Validation & UX Safety]` and `[Rubric §25, Navigation & Information Architecture]`: a missing value removes an affordance instead of producing a broken one.
  - **Failure is non-fatal**: `OperationCanceledException` is separated out as expected teardown or an InteractiveAuto render-mode transition (`:88-91`), and the broad `catch` (`:92-95`) deliberately leaves the page on its call-to-action fallback rather than surfacing an error; the `finally` always clears `_isLoading`. `[Rubric §29, Resilience & Business Continuity]`.
- **Walkthrough**: `OnInitializedAsync` (`:44-100`) loads the event lookup (`:49`), resolves the current or next event with [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) passing the four accessors explicitly (`:52-57`), remembers its name and sponsorship packet URL (`:60-61`), builds an `EventId equals` filter when an event resolved (`:64-66`), fetches one page sorted by `Sort` ascending (`:68-74`), and materializes `_tiers` as an ordered list of tier-to-sponsors pairs (`:78-86`). `TierLabel` (`:42`) localizes each tier name through the page's `IStringLocalizer`, so the tier enum never reaches the screen untranslated (`[Rubric §27, Internationalization]`). Disposal (`:104-124`) is the standard cancel-on-disposal pattern over the `CancellationTokenSource` at `:28`.
- **Why it's built this way**: the sponsor page is a marketing surface with a fixed hierarchy, so it wants deterministic grouping rather than sortable columns, and it must look intentional on an event that has not sold a sponsorship yet.
- **Where it's used**: the `/conference/sponsors` route (`PublicSponsorList.razor:1`). The roster it renders is authored by the organizer through the sponsor admin pages in this module.
- **Caveats / not-in-source**: the page relies on the server scoping non-privileged callers to published events (class doc, `:12-14`); that scoping is enforced in the Conference API, not here.

---

### PublicSessionList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionList.razor.cs:25` · Level 10 · class (Blazor code-behind)

- **What it is**: the public conference schedule and the most heavily-wired page in this unit. It is the container half of a three-part page (this class, [`PublicSessionListFilterBar`](#publicsessionlistfilterbar), [`PublicSessionListView`](#publicsessionlistview)): it owns the events, room and speaker lookups, the event/room/search/My-Schedule filter state, the bookmark dictionary, the server-paged fetch, and the offline snapshot (`PublicSessionList.razor.cs:16-24`).
- **Depends on**: extends [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) closed over [`SessionDTO`](group-17-conference-domain.md#sessiondto) (`:25`); [`ISessionUIService`](#isessionuiservice), [`IEventUIService`](#ieventuiservice), [`ISpeakerLookupService`](#ispeakerlookupservice) (`:29,32,33`), the optional [`ISessionBookmarkUIService`](group-22-engagement-module.md#isessionbookmarkuiservice) (`:38`), [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore) and [`IConnectivityStatusService`](group-26-device-capability-layer.md#iconnectivitystatusservice) (`:30-31`); [`EventDTO`](group-17-conference-domain.md#eventdto), [`RoomDTO`](group-17-conference-domain.md#roomdto), [`SpeakerInfo`](#speakerinfo) (`:54`), [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience) (`:161`), [`CurrentEventDefaults`](group-17-conference-domain.md#currenteventdefaults) (`:210`), [`PublicScheduleRoomOptions`](#publicscheduleroomoptions) (`:195`), and the nested [`CachedSessionPage`](#cachedsessionpage) record (`:366`).
- **Concept introduced, the container page with two racing loads and a dual-branch fetch.** Everything the sibling list pages do once, this page does twice and then adds a mode switch.
  1. **Two startup tasks, both awaited by the fetch path.** `OnInitializedAsync` (`:124-152`) starts `_bookmarkLoadTask` (`:140`) and `_eventsLoadTask` (`:144`) **before** its first `await`. The comments (`:134-143`) name the exact failure each guards: the `MudDataGrid`'s first `ServerData` call can run ahead of initialization, notably on in-app back-navigation where there is no SSR prerender to supply grid data, and a half-initialized `_isAuthenticated == false` would make the My Schedule branch silently fall through to fetching all sessions. `LoadServerData` (`:273-285`) awaits the events task and `FetchSessionsAsync` (`:292-361`) awaits the bookmark task. `[Rubric §19, State Management & Data Flow]`.
  2. **Two fetch branches, both truly server-paged.** In My Schedule mode with bookmarks present, the page adds an `Id IN (...)` server filter built from the bookmark dictionary keys (`:320-328`) and lets the server page; the comment (`:317-319`) records that this replaced pulling a 500-row page and paging in memory, which also reported a wrong total past 500. An empty bookmark set short-circuits to `([], 0)` (`:312-315`) rather than issuing a query that would return the whole catalog. `[Rubric §12, Performance & Scalability]`.
  3. **Audience-scoped filter persistence, and one filter that is safe for everyone.** Only privileged readers persist an event choice (`:83-89`), and `ResolveDefaultEventFilter` (`:197-212`) locks everyone else to the computed current or next event via [`CurrentEventDefaults.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventdefaults); the comment (`:199-202`) states the security consequence, that a shared privileged URL can never pin an attendee to a different or unpublished event. The room filter, by contrast, is persisted for **every** audience, and the comment says why in one line (`:80`): a room only narrows within the reader's own event, so it cannot widen anything. `[Rubric §11, Security]` and `[Rubric §26, Front-End Security]`.
  4. **A deep link that beats saved state.** `[SupplyParameterFromQuery(Name = "mine")]` (`:67-68`) carries the MAUI head's home-screen quick action into the My Schedule view, and `OnInitializedAsync` applies it *after* the base has restored saved page state so intent wins (`:128-132`). `[Rubric §25, Navigation & Information Architecture]` and [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 2.
  5. **The offline snapshot** taught at [`CachedSessionPage`](#cachedsessionpage) (`:338-360`). `[Rubric §29, Resilience & Business Continuity]`.
- **Walkthrough**
  - `SaveFilters` / `RestoreFilters` (`:75-122`): persist search, the My Schedule toggle, the room id, and (privileged only) the event id with the `"all"` sentinel. A restored room the resolved event does not offer is dropped downstream, which the comment points at (`:111`).
  - `LoadEventsAndResolveDefaultAsync` (`:154-191`): resolve privileged status from role membership with a failed read treated as non-privileged (`:156-167`), fetch events with children and flatten their rooms into `_roomNames` (`:171-180`), load the speaker lookup (`:182`), then resolve the default event (`:189`) and scope the room options (`:190`). One children-loaded events fetch plus one speaker lookup replace per-row enrichment calls. `[Rubric §23, Front-End Performance & Rendering]`.
  - `RefreshRoomOptions` (`:194-195`) is a one-line delegation to [`PublicScheduleRoomOptions.Scope`](#publicscheduleroomoptions), destructuring straight into `_rooms` and `_selectedRoomId`; it runs after the initial load and again on every event-filter change (`:255`).
  - `LoadBookmarkStateAsync` (`:219-243`): reads the `user_id` claim and loads the bookmarked session ids into the dictionary the view patches in place; a failure is non-critical, so the stars do not appear but sessions still load (`:239-242`).
  - Filter handlers (`:246-269`) each update one field and call `ReloadViewAsync` (`:271`), which forwards to the view child's `ReloadAsync()` and no-ops when the child is not yet rendered.
  - `ApplyAdditionalFilters` (`:368-386`): `Title contains`, `EventId equals`, and `RoomId equals`. The comment on the room branch (`:380-381`) is worth reading against [`PublicSpeakerList`](#publicspeakerlist): `Session.RoomId` is a real nullable column, so it rides the generic filter pipeline with no virtual-key interception in the controller, unlike the speaker page's `EventId`.
  - `FetchMobilePage` (`:389-397`) builds the same filters for the infinite-scroll list and reuses `FetchSessionsAsync`, so both layouts share one fetch implementation including its offline path.
  - The optional Engagement service is resolved with `GetService` (`:126`) for the same reason as on [`PublicSessionDetail`](#publicsessiondetail): `[Inject]` has no optional mode.
- **Why it's built this way**: this is the highest-traffic page of the conference, viewed on bad networks by both anonymous browsers and signed-in attendees managing a personal schedule. That drives every design decision visible here: server-side everything, one enrichment fetch, ordering guarantees around the grid's eager first call, an audience-locked event filter, a room filter derived from data already in hand, and a cached last-known-good first page.
- **Where it's used**: the `/conference/sessions` route (`PublicSessionList.razor:1`), including the `?mine=true` deep link; it renders [`PublicSessionListFilterBar`](#publicsessionlistfilterbar) (`PublicSessionList.razor:11-21`) and [`PublicSessionListView`](#publicsessionlistview) (`:31`) and routes onward to [`PublicSessionDetail`](#publicsessiondetail).

### EventCreate

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Event` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Event/EventCreate.razor.cs:13` · Level 5 · class (Blazor code-behind)

- **What it is**: the organizer form that creates a conference event. It collects the name, description,
  start and end dates, IANA time zone, Sessionize code, and the optional venue fields (address, map URL,
  Wi-Fi, organizer contact, sponsorship packet, ticketing link), posts the record unpublished, and
  redirects to the new event's detail page. It is the first page in this unit and the place where the
  Conference create-form shape is taught.
- **Depends on**: [`IEventUIService`](#ieventuiservice) (injected at
  `.../Pages/Event/EventCreate.razor.cs:15`), [`EventDTO`](group-17-conference-domain.md#eventdto),
  [`ConferenceRoutePaths`](#conferenceroutepaths), and
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages). Externals: Blazor (`[Inject]`,
  `NavigationManager`, `OnInitialized`), MudBlazor (`MudForm`, `ISnackbar`, `BreadcrumbItem`,
  `Icons.Material.Filled.Home`), the shared `UnsavedChangesGuard` component from `MMCA.Common.UI`, and
  the `IStringLocalizer<EventCreate>` the template injects as `L`
  (`.../Pages/Event/EventCreate.razor:4`).
- **Concept introduced, the partial-class code-behind create form.** Every Conference page is a `.razor`
  template plus a `.razor.cs` partial holding the injected services, backing fields, and handlers. The
  create leg layers four recurring mechanisms on that split, and every other create page in this unit
  repeats them:
  1. **Cancel-on-disposal**: a `CancellationTokenSource _cts` (line 19) is passed to every service call
     and cancelled plus disposed through the standard `Dispose(bool)` pattern (lines 115-133), so an
     in-flight save cannot resolve against a torn-down component.
  2. **Validate-then-submit**: `await _form.ValidateAsync()` followed by an `IsValid` guard (lines 60-65)
     with a hand-written cross-field check for the date range (lines 67-71), while the `IsSaving` flag
     (line 36) disables the button for the round trip and is always cleared in `finally` (lines 107-110).
  3. **An unsaved-changes guard**: `_isDirty` is set by `MarkDirty()` (line 53) and consumed by the
     `UnsavedChangesGuard` component in the template (`.../Pages/Event/EventCreate.razor:8`); it is
     cleared *before* the success redirect (line 95) so the guard does not block the page's own
     navigation.
  4. **Two-tier failure handling**: `OperationCanceledException` is swallowed as expected during
     disposal or an InteractiveAuto render-mode transition (lines 99-102), everything else snackbars a
     localized error (lines 103-106). ADR-056 (`Website/docs-src/adr/056-blazor-render-mode-strategy.md`)
     is the record behind that first catch.
  `[Rubric §24, Forms, Validation & UX Safety]` (assesses client validation, unsaved-change protection,
  and safe submits): this page validates before posting, tracks dirty state, and guards navigation away.
  `[Rubric §18, UI Architecture & Component Design]` (assesses logic separated from markup): the
  code-behind keeps the template declarative. `[Rubric §11, Security]` (assesses authorization at the
  boundary the user actually reaches): the route is organizer-only via
  `@attribute [Authorize(Roles = "Organizer")]` (`.../Pages/Event/EventCreate.razor:2`).
  `[Rubric §27, Internationalization]` (assesses externalized user-facing text): every label, breadcrumb,
  and snackbar reads through `L` (for example `L["Snackbar.Created"]`, line 96), per ADR-011 and ADR-027.
- **Walkthrough**
  - `OnInitialized` (lines 25-34) builds the three-item breadcrumb trail: Home, the events list, and a
    disabled "Create" leaf (lines 28-33).
  - Backing fields (lines 38-49) hold the form values, with `_timeZone` seeded to `"America/New_York"`
    (line 42), the conference's home zone, so the common case needs no edit.
  - `CreateEventAsync` (lines 55-111) validates, converts the two `DateTime?` pickers to `DateOnly`
    (lines 81-82), builds the [`EventDTO`](group-17-conference-domain.md#eventdto) with **`Id = default`**
    (line 78) and `IsPublished = false` (line 91), posts with `AddAsync` (line 94), clears `_isDirty`,
    snackbars success, and navigates to `ConferenceRoutePaths.EventDetails(created.Id)` (line 97) using
    the id the server returned.
  - `NavigateToList` (line 113) is the cancel path back to `/events`.
- **Why it's built this way**: a new event starts unpublished so an organizer can fill in venue details
  and refresh from Sessionize before anything is publicly visible; publishing is a separate deliberate
  action on [`EventDetail`](#eventdetail). Posting `Id = default` hands identifier assignment to the
  server rather than the browser, which is the opposite choice from the sibling create pages below.
- **Where it's used**: the `/events/create` route (`.../Pages/Event/EventCreate.razor:1`), reached from
  [`EventList`](#eventlist)'s create button; on success it hands off to [`EventDetail`](#eventdetail).

### OrganizerEventFeedback

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Feedback` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerEventFeedback.razor.cs:14` · Level 5 · class (Blazor code-behind)

- **What it is**: the organizer's read-and-moderate view of event feedback. It loads every answer
  submitted for one event, groups the answers under their question, averages the rating questions, and
  lets the organizer delete an individual free-text answer.
- **Depends on**: [`IOrganizerEventFeedbackUIService`](#iorganizereventfeedbackuiservice) (line 16),
  [`IQuestionUIService`](#iquestionuiservice) (line 17), and
  [`IEventLookupService`](#ieventlookupservice) (line 18) returning [`EventInfo`](#eventinfo); the
  [`QuestionDTO`](group-17-conference-domain.md#questiondto) and
  [`EventQuestionAnswerDTO`](group-17-conference-domain.md#eventquestionanswerdto) shapes;
  [`ConferenceRoutePaths`](#conferenceroutepaths); and
  [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Parse<T>` string extension
  (`MMCA.Common.Shared.Extensions`, line 5). Externals: Blazor `[Parameter]`, MudBlazor (`ISnackbar`,
  `MudRating`, `MudCard`), and the `PageLoadingState` / `PageErrorState` components from
  `MMCA.Common.UI`.
- **Concept introduced, the inline page-level error state.** Unlike the create and detail pages, which
  snackbar their failures, this page keeps a `_loadError` string (line 29) and renders `PageErrorState`
  instead of the body when the load failed (`.../Pages/Feedback/OrganizerEventFeedback.razor:17-20`). The
  distinction is deliberate: a snackbar expires, and a feedback page that silently shows zero responses
  after a failed fetch reads as "nobody answered". A missing event sets the same field with
  `L["Error.EventNotFound"]` (line 56) rather than a generic message.
  `[Rubric §19, State Management & Data Flow]` (assesses where view state lives and how failure is
  represented): loading, error, empty, and populated are four distinct rendered states driven by
  `IsLoading` (line 27), `_loadError`, and the two collections.
  `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses control over user-submitted content):
  answer deletion is the organizer's moderation lever over free-text feedback (BR-53 in the type's own
  doc comment, lines 10-13).
  `[Rubric §23, Front-End Performance & Rendering]`: aggregation happens client-side over one bulk
  answer fetch (line 70) rather than per-question round trips.
- **Walkthrough**
  - The route id arrives as `[Parameter] public string EventId` (line 21) and is converted to the typed
    alias with `EventId.Parse<EventIdentifierType>()` (line 46), so the page compiles unchanged whichever
    primitive the alias maps to (ADR-048, revisited in ADR-085).
  - `OnInitializedAsync` (lines 35-84) builds breadcrumbs (lines 37-42), resolves the event name from the
    lookup and bails with `Error.EventNotFound` when the id is unknown (lines 49-58), fetches the
    event-scoped questions with the server filter `QuestionEntity equals "Event"` sorted by `Sort`
    (page 1, size 100, lines 61-66), then loads **all** answers for the event (line 70). The `finally`
    always clears `IsLoading` (lines 80-83).
  - Rendering (`.../Pages/Feedback/OrganizerEventFeedback.razor:37-84`) pairs each question with
    `_answers.Where(a => a.QuestionId == question.Id)` (line 37). A question whose `QuestionType` is
    `"Rating"` (case-insensitive, line 55) parses the answer values to integers, drops the unparseable
    ones, and renders a read-only `MudRating` at the rounded average plus the average to one decimal and
    the ratings count (lines 57-69). Anything else renders each answer as pre-wrapped text with a delete
    icon button carrying an `aria-label` (lines 73-83). `[Rubric §21, Accessibility]`.
  - `DeleteAnswerAsync` (lines 86-102) deletes one answer, **refetches the whole answer set** (line 91),
    and snackbars the outcome, so the page never hand-patches its local collection.
- **Why it's built this way**: the organizer needs one screen that answers "what did attendees say about
  this event", and the aggregate/free-text split follows from the question model itself: ratings are only
  meaningful in aggregate, free text is only meaningful individually (and is the only thing that can need
  moderating).
- **Where it's used**: the `/events/{EventId}/feedback` route
  (`.../Pages/Feedback/OrganizerEventFeedback.razor:1-2`, organizer-only), reached from the "view
  feedback" button on [`EventDetail`](#eventdetail) (`.../Pages/Event/EventDetail.razor:176`). The
  attendee-facing counterpart lives in the Engagement module
  ([`EventFeedback`](group-22-engagement-module.md#eventfeedback)).
- **Caveats / not-in-source**: the questions fetch takes a single 100-row page (line 66); behavior beyond
  100 event questions is not handled in this file.

### OrganizerSessionFeedback

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Feedback` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerSessionFeedback.razor.cs:14` · Level 5 · class (Blazor code-behind)

- **What it is**: the session-scoped twin of [`OrganizerEventFeedback`](#organizereventfeedback). Same
  load-group-aggregate-moderate flow, one level down the hierarchy: answers for a single session instead
  of a whole event.
- **Depends on**: [`IOrganizerSessionFeedbackUIService`](#iorganizersessionfeedbackuiservice) (line 16),
  [`IQuestionUIService`](#iquestionuiservice) (line 17), and [`ISessionUIService`](#isessionuiservice)
  (line 18) in place of the event lookup; the
  [`SessionQuestionAnswerDTO`](group-17-conference-domain.md#sessionquestionanswerdto) and
  [`QuestionDTO`](group-17-conference-domain.md#questiondto) shapes;
  [`ConferenceRoutePaths`](#conferenceroutepaths); and the same `Parse<T>` extension (line 5).
- **Concept introduced**: none new. The page-level error state, the rating-versus-text rendering split,
  and the refetch-after-delete rule are the ones taught in
  [`OrganizerEventFeedback`](#organizereventfeedback).
- **Walkthrough** (only the differences from its twin):
  - The route parameter is `[Parameter] public string SessionId` (line 21), parsed to
    `SessionIdentifierType` (line 46).
  - The title comes from the session itself rather than a lookup dictionary:
    `SessionService.GetByIdAsync(_parsedSessionId, false, ...)` with `includeChildren: false` (line 49),
    since only `session.Title` is needed (line 56); a null result sets `L["Error.SessionNotFound"]`
    (line 52).
  - The question filter is `QuestionEntity equals "Session"` (lines 59-62), the other half of the same
    question table that the event page filters on `"Event"`.
  - `DeleteAnswerAsync` (lines 84-100) takes a `SessionQuestionAnswerIdentifierType` and passes the
    parsed session id alongside it (line 88).
  - The template links the session title back to the detail page
    (`.../Pages/Feedback/OrganizerSessionFeedback.razor:23`) and ends with a back button to the same
    route (line 92), where the event page instead links back to the event detail.
- **Why it's built this way**: session and event feedback are two instances of one questionnaire model,
  so the two pages stay structurally identical rather than sharing a parameterized component; the cost is
  duplication, the benefit is that each page's queries and route contract read literally.
- **Where it's used**: the `/sessions/{SessionId}/feedback` route
  (`.../Pages/Feedback/OrganizerSessionFeedback.razor:1-2`), reached from the "view feedback" button on
  [`SessionDetail`](#sessiondetail) (`.../Pages/Session/SessionDetail.razor:190`). The attendee-facing
  counterpart is [`SessionFeedback`](group-22-engagement-module.md#sessionfeedback).

### QuestionCreate

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Question` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Question/QuestionCreate.razor.cs:9` · Level 5 · class (Blazor code-behind)

- **What it is**: the organizer form that defines a feedback question: its text, which entity it attaches
  to (`Event` or `Session`), its type (for example `Rating`), its sort order, and whether an answer is
  required.
- **Depends on**: [`IQuestionUIService`](#iquestionuiservice) (line 11),
  [`QuestionDTO`](group-17-conference-domain.md#questiondto),
  [`ConferenceRoutePaths`](#conferenceroutepaths), and
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages). Externals: MudBlazor (`MudForm`,
  `ISnackbar`), `System.Security.Cryptography.RandomNumberGenerator`, and the
  `IStringLocalizer<QuestionCreate>` injected as `L`.
- **Concept introduced, the client-minted identifier.** `QuestionDTO.Id` is a `required` non-nullable
  alias over `int`, so the form has to put *something* there. This page fabricates a value with
  `RandomNumberGenerator.GetInt32(999_999_000, 999_999_999)` (line 61), which is the reserved
  user-created question range recorded on the domain side as `QuestionInvariants.ManualIdRangeStart` and
  `ManualIdRangeEnd`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/QuestionInvariants.cs:37,40`),
  the band that sits above every Sessionize-assigned id. The server does not trust it either way:
  `CreateQuestionHandler` always allocates the next free id in that range and overwrites the request
  ("Caller-provided IDs are ignored",
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Create/CreateQuestionHandler.cs:71-87`).
  The page is written to tolerate that: it navigates using `created.Id` from the response (line 71), not
  the value it sent. Compare [`EventCreate`](#eventcreate), which posts `Id = default` instead, and
  [`RoomCreate`](#roomcreate) / [`SessionCreate`](#sessioncreate), whose minted ids the server *does*
  respect.
  `[Rubric §8, Data Architecture]` (assesses who owns identifier assignment): identity here is
  server-owned inside a reserved range, because the same table also holds rows imported from Sessionize
  under externally assigned ids.
  `[Rubric §24, Forms, Validation & UX Safety]`: the validate-then-submit, dirty-guard, and
  cancel-on-disposal mechanics are the ones [`EventCreate`](#eventcreate) introduces.
- **Walkthrough**
  - `OnInitialized` (lines 20-29) builds the Home / Questions / Create breadcrumb trail.
  - The backing fields (lines 32-36) default `_questionEntity` to `"Session"` and `_questionType` to
    `"Rating"` (lines 33-34), the most common combination.
  - `CreateQuestionAsync` (lines 42-85) validates the form, builds the DTO with the minted id (lines
    59-67), posts with `AddAsync` (line 68), clears `_isDirty` (line 69), and navigates to
    `ConferenceRoutePaths.QuestionDetails(created.Id)` (line 71).
- **Why it's built this way**: questions are the schema behind every feedback screen in both the
  Conference and Engagement modules, so they are organizer-authored data rather than configuration; the
  reserved id band keeps hand-authored questions from ever colliding with imported ones.
- **Where it's used**: the `/questions/create` route (`.../Pages/Question/QuestionCreate.razor:1`),
  reached from [`QuestionList`](#questionlist); on success it hands off to
  [`QuestionDetail`](#questiondetail). The questions it creates are what
  [`OrganizerEventFeedback`](#organizereventfeedback) and
  [`OrganizerSessionFeedback`](#organizersessionfeedback) group their answers under.

### RoomCreate

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Room` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Room/RoomCreate.razor.cs:9` · Level 5 · class (Blazor code-behind)

- **What it is**: the organizer form that adds a room to an event. It collects the owning event, name,
  sort order, capacity, floor, location, and accessibility information, then redirects to the room's
  detail page.
- **Depends on**: [`IRoomUIService`](#iroomuiservice) (line 11) and
  [`IEventLookupService`](#ieventlookupservice) (line 12) returning [`EventInfo`](#eventinfo);
  [`RoomDTO`](group-17-conference-domain.md#roomdto); [`ConferenceRoutePaths`](#conferenceroutepaths);
  and [`ErrorMessages`](group-15-common-ui-framework.md#errormessages). Uses the `Event` and `Room`
  identifier aliases.
- **Concept introduced, the single-option auto-select.** A room is meaningless without a parent event, so
  the page loads the event lookup in `OnInitializedAsync` and, **when the lookup holds exactly one
  event**, preselects it (lines 46-50). ADC normally runs one conference at a time, so this removes a
  mandatory click that has only one possible answer while still rendering a real picker when more than
  one event exists. A lookup failure is non-fatal: it snackbars `Snackbar.LoadEventsFailed` (line 58) and
  leaves the form usable.
  `[Rubric §24, Forms, Validation & UX Safety]`: fewer required inputs with no loss of correctness, since
  the field is still validated on submit.
  This page also mints a client id, `RandomNumberGenerator.GetInt32(100_000, int.MaxValue)` (line 81),
  which [`RoomService`](#roomservice) forwards as the API contract's `RoomId` field
  (`.../Services/RoomService.cs:17-33`). Unlike the question path, `AddRoomHandler` treats a supplied id
  as authoritative and only auto-allocates from the reserved range when `RoomId is null`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddRoom/AddRoomHandler.cs:37-40,87-108`),
  so a room created here keeps the value the browser generated.
- **Walkthrough**
  - `OnInitializedAsync` (lines 35-60) builds the breadcrumbs (lines 37-42), fetches the event lookup
    (line 46), applies the single-event preselect (lines 47-50), and splits cancellation from real
    failures (lines 52-59).
  - `CreateRoomAsync` (lines 62-107) runs the standard validate-then-submit, builds the
    [`RoomDTO`](group-17-conference-domain.md#roomdto) with the minted id and the chosen `EventId` (lines
    79-89), posts it (line 90), clears `_isDirty` (line 91), and navigates to
    `ConferenceRoutePaths.RoomDetails(created.Id)` (line 93).
  - `NavigateToList` (line 109) and the `Dispose(bool)` pair (lines 111-133) are identical to the other
    create pages.
- **Why it's built this way**: rooms are per-event data that the Sessionize sync also writes, so the UI
  create path has to coexist with imported rows; the event picker is mandatory because the server rejects
  a room whose event does not exist, and the reserved id band is what keeps the two sources apart.
- **Where it's used**: the `/rooms/create` route (`.../Pages/Room/RoomCreate.razor:1`), reached from
  [`RoomList`](#roomlist); on success it hands off to [`RoomDetail`](#roomdetail). Rooms created here are
  what [`SessionCreate`](#sessioncreate) and [`SessionDetail`](#sessiondetail) offer in their room
  pickers.
- **Caveats / not-in-source**: the minted range `100_000 .. int.MaxValue` sits below the reserved
  `RoomManualIdRangeStart` of `999_999_000`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/EventInvariants.cs:62,65`), and
  because the handler respects an explicit id, the value is persisted as sent. Whether a generated value
  can collide with a Sessionize-assigned room id is a data question this file cannot answer.

### SessionCreate

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Session` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Session/SessionCreate.razor.cs:15` · Level 5 · class (Blazor code-behind)

- **What it is**: the organizer form that creates a session. It collects a title, description, owning
  event, optional room, start/end date-and-time, and the "service session" flag, posts the new record,
  and redirects to that session's detail page. It is the most mechanical of the create pages and the
  clearest place to see the two things that make session editing awkward: a **dependent lookup** (rooms
  belong to the chosen event) and **split date/time pickers**.
- **Depends on**: [`ISessionUIService`](#isessionuiservice) (the create client, injected at
  `.../Pages/Session/SessionCreate.razor.cs:17`), [`IEventLookupService`](#ieventlookupservice) returning
  [`EventInfo`](#eventinfo) (line 18), [`IRoomUIService`](#iroomuiservice) for the room dropdown (line
  19), [`SessionDTO`](group-17-conference-domain.md#sessiondto),
  [`RoomDTO`](group-17-conference-domain.md#roomdto), [`ConferenceRoutePaths`](#conferenceroutepaths),
  and [`ErrorMessages`](group-15-common-ui-framework.md#errormessages). It uses the `Event`, `Room`, and
  `Session` identifier aliases. Externals: Blazor (`[Inject]`, `NavigationManager`), MudBlazor
  (`MudForm`, `ISnackbar`, `BreadcrumbItem`), `System.Security.Cryptography.RandomNumberGenerator`, and
  the `IStringLocalizer<SessionCreate>` injected by the template.
- **Concept introduced, the dependent lookup.** The create-form shape itself is
  [`EventCreate`](#eventcreate)'s; what is new here is that one field's options depend on another field's
  value. `LoadRoomsAsync` (lines 81-96) fetches rooms filtered by the selected event, and
  `OnEventChangedAsync` (lines 99-118) reloads them and clears the previous choice whenever the event
  changes. The doc comment (lines 76-80) records why this is not cosmetic: BR-130 rejects a room from
  another event server-side, so the dropdown must only ever offer rooms of the chosen event.
  `[Rubric §24, Forms, Validation & UX Safety]`: the client is shaped so it cannot compose a request the
  server will refuse. `[Rubric §19, State Management & Data Flow]`: `_rooms` is derived state, explicitly
  invalidated when its input changes rather than left to go stale.
  A second idea this page shows is the **client-minted identifier**: it fabricates
  `RandomNumberGenerator.GetInt32(100_000, int.MaxValue)` (line 144) to satisfy the required
  `SessionDTO.Id`, and because `CreateSessionHandler` only auto-allocates from the reserved range when
  `command.Id == default` and otherwise respects an explicit id
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Create/CreateSessionHandler.cs:76-95`),
  the generated value is what gets persisted. The page still reads `created.Id` back from the response
  (line 157), so it works either way. Contrast [`EventCreate`](#eventcreate), which posts `Id = default`,
  and [`QuestionCreate`](#questioncreate), whose id is always overwritten.
- **Walkthrough**
  - `OnInitializedAsync` (lines 47-74) builds the breadcrumb trail (lines 49-54), loads the event lookup
    (line 58), **auto-selects the only event** when the lookup has exactly one entry (lines 59-62, the
    same single-conference convenience as [`RoomCreate`](#roomcreate)), then calls `LoadRoomsAsync`.
  - `LoadRoomsAsync` (lines 81-96): with no event chosen it clears `_rooms` and returns (lines 83-87);
    otherwise it fetches up to 500 rooms filtered by `EventId equals <selected>` (lines 89-94).
  - `OnEventChangedAsync` (lines 99-118) marks the form dirty, **clears the previously picked room**
    (line 104, with the in-code note that keeping it would have the server reject the save), and reloads
    the room list.
  - `CreateSessionAsync` (lines 120-171) validates, then recombines the two picker pairs into
    `StartsAt`/`EndsAt` **only when both the date and the time part are set** (lines 137-140), builds the
    [`SessionDTO`](group-17-conference-domain.md#sessiondto) (lines 142-152), posts it with `AddAsync`
    (line 154), clears `_isDirty`, snackbars success, and navigates to
    `ConferenceRoutePaths.SessionDetails(created.Id)` (line 157). The `finally` always clears `IsSaving`.
- **Why it's built this way**: one create-form shape (validate, post, redirect to detail) is reused across
  the Conference entities so behavior stays uniform; the split date/time editing exists because MudBlazor
  has no single date-time picker, so the page composes two controls and recombines them defensively; the
  event-scoped room reload keeps the client from ever offering a value the server will reject.
- **Where it's used**: the `/sessions/create` route, reached from [`SessionList`](#sessionlist)'s create
  button; on success it hands off to [`SessionDetail`](#sessiondetail).

### EventList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Event` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Event/EventList.razor.cs:16` · Level 7 · class (Blazor code-behind)

- **What it is**: the organizer browse page for events: a server-paged, server-sorted grid on desktop, an
  infinite-scroll card list on mobile, with a name search, a delete-with-confirmation action, and
  navigation into create and detail. It is the simplest inheritor of the shared list base and the place
  where the Conference list-page shape is taught.
- **Depends on**: extends
  [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) over
  [`EventDTO`](group-17-conference-domain.md#eventdto) (line 16) and injects
  [`IEventUIService`](#ieventuiservice) (line 21). It uses
  [`ListPageActions`](group-24-identity-module.md#listpageactions),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages),
  [`ConferenceRoutePaths`](#conferenceroutepaths), and the
  [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem),
  `DeleteConfirmation`, and `ListNoRecordsContent` components from `MMCA.Common.UI`.
- **Concept introduced, the two-layout list page over one shared base.** A Conference list page is
  roughly forty lines because everything hard lives in
  [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto). The derived
  page supplies five things and nothing else:
  1. **A grid reference**: `_dataGrid` captured via `@ref` and surfaced through the overridden `GridRef`
     (lines 24-25), which the base needs to restore rows-per-page after first render.
  2. **Filter persistence**: `SaveFilters` / `RestoreFilters` (lines 33-37) write and read the page's own
     search string, and the base persists them to the URL query string, an in-memory service, and
     session storage, so filters survive navigation, refresh, and a shared link.
     `[Rubric §25, Navigation & Information Architecture]`.
  3. **The fetch delegates**: `LoadServerData` (lines 48-57) hands the base a lambda that calls
     `EventService.GetPagedAsync` and an `additionalFilters` callback that appends
     `Name contains <search>` (lines 53-57). `LoadServerDataAsync` in the base
     (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:434-511`)
     owns cancellation-token resetting, the SSR pre-render hand-off, page-plus-one index conversion,
     sort extraction, the `IsLoading` and `LoadFailed` flags, and uniform error snackbars.
  4. **A mobile fetch**: `FetchMobilePage` (lines 60-66) repeats the same filter build for the
     card list, which pages by "load more" instead of a pager and sorts by `Name asc`.
     `[Rubric §22, Responsive & Cross-Browser]`: the page renders two genuinely different layouts off the
     base's `IsMobile` flag rather than reflowing one grid.
  5. **Actions**: `DeleteEventAsync` (lines 71-79) delegates the confirm, delete, snackbar, and reload
     sequence to [`ListPageActions`](group-24-identity-module.md#listpageactions)`.DeleteWithConfirmationAsync`,
     and `ReloadActiveLayoutAsync` (lines 39-40) dispatches a refresh to whichever layout is live.
  The failure path is worth noting: when a fetch fails the base sets `LoadFailed`, and the template feeds
  it to `ListNoRecordsContent` with an `OnRetry` handler wired to `RetryLoadAsync` (line 28,
  `.../Pages/Event/EventList.razor:131`), so a failed load renders an inline retry instead of an empty
  list that looks like "no events". `[Rubric §19, State Management & Data Flow]`.
  Data access itself follows ADR-094 (`Website/docs-src/adr/094-client-entity-data-access.md`): the page
  never touches `HttpClient`, only the typed `I*UIService` client, and expresses filters as
  operator-plus-value pairs the server model binder understands.
- **Walkthrough**
  - `Title` and `EntityName` (lines 18-19) come from the injected localizer; `Title` is the abstract
    member the base uses in its error messages.
  - `OnSearchChanged` (lines 42-46) stores the text and reloads the active layout, so typing drives a
    server round trip rather than a client-side filter over the current page.
  - `OnMobileCardClick` (line 68) and `NavigateToDetails` (lines 84-85) both route through
    `ConferenceRoutePaths.EventDetails(id)`, and `NavigateToCreate` (lines 81-82) opens
    [`EventCreate`](#eventcreate).
- **Why it's built this way**: nineteen list pages across the workspace share this base (ADR-056 records
  the count and the render-mode strategy they run under), so browse behavior, state persistence, and
  error handling stay identical everywhere and a new list page costs a few dozen lines.
- **Where it's used**: the `/events` organizer route (`.../Pages/Event/EventList.razor:1-2`,
  `Authorize(Roles = "Organizer")`); rows open [`EventDetail`](#eventdetail) and the create button opens
  [`EventCreate`](#eventcreate).

### QuestionList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Question` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Question/QuestionList.razor.cs:11` · Level 7 · class (Blazor code-behind)

- **What it is**: the organizer browse page for feedback questions. Structurally the twin of
  [`EventList`](#eventlist): same base class, same two layouts, same delete flow, with the search bound to
  the question text instead of a name.
- **Depends on**: extends
  [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) over
  [`QuestionDTO`](group-17-conference-domain.md#questiondto) (line 11) and injects
  [`IQuestionUIService`](#iquestionuiservice) (line 16); plus
  [`ListPageActions`](group-24-identity-module.md#listpageactions),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages),
  [`ConferenceRoutePaths`](#conferenceroutepaths), and the same three shared components.
- **Concept introduced**: none new. See [`EventList`](#eventlist) for the base-class contract (grid ref,
  filter persistence, the two fetch delegates, and the shared delete action).
- **Walkthrough** (only the differences from [`EventList`](#eventlist)):
  - The search filter targets `QuestionText contains <search>` on both the desktop (lines 48-52) and
    mobile (lines 57-60) paths, and the mobile fetch sorts by `QuestionText asc` (line 60).
  - `DeleteQuestionAsync` (lines 67-75) passes `question.QuestionText` as the confirmation label, so the
    dialog names the question being removed.
  - There is no detail-navigation helper: the mobile card click navigates inline (lines 63-64) and the
    grid rows link from the template.
- **Why it's built this way**: questions are low-volume reference data, so the page needs browse, search,
  and delete but no filters or enrichment; keeping it on the same base means it inherits URL-persisted
  paging, sorting, and the inline retry state for free.
- **Where it's used**: the `/questions` organizer route (`.../Pages/Question/QuestionList.razor:1`); the
  create button opens [`QuestionCreate`](#questioncreate) (line 77) and rows open
  [`QuestionDetail`](#questiondetail).

### EventDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Event` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Event/EventDetail.razor.cs:15` · Level 8 · class (Blazor code-behind)

- **What it is**: the organizer's event console. It loads one event by route id and offers four distinct
  operations on it: inline edit, publish/unpublish, refresh from Sessionize, and delete. It is the
  richest detail page in the Conference UI in terms of *verbs*, and the place where the detail-page shape
  is taught.
- **Depends on**: [`IEventUIService`](#ieventuiservice) (line 19) for all four operations;
  [`EventDTO`](group-17-conference-domain.md#eventdto),
  [`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto), and
  [`QuestionModerationDefault`](group-17-conference-domain.md#questionmoderationdefault);
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages),
  [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Parse<T>` extension (line 4), and
  the `DeleteConfirmation` plus `UnsavedChangesGuard` components from `MMCA.Common.UI`.
- **Concept introduced, load-once-on-parameters plus shadow-field editing.** Three mechanisms combine
  here and recur in every detail page below:
  1. **Route id as a string**: the id arrives as `[Parameter] public string Id` (line 23) and is
     converted with `Id.Parse<EventIdentifierType>()` (line 92), so the page compiles unchanged whichever
     primitive the alias maps to (ADR-048, ADR-085).
  2. **Load once per id**: `OnParametersSetAsync` compares against `_loadedId` and returns early when the
     id is unchanged (lines 75-85), so a re-render does not refetch.
  3. **Shadow fields**: `StartEditing` copies the loaded record into the `_edit*` fields (lines 117-139)
     and `CancelEditing` simply drops edit mode (lines 141-145), so the live `Event` object is never
     mutated until a validated save succeeds. `[Rubric §24, Forms, Validation & UX Safety]`.
  `[Rubric §8, Data Architecture]` (assesses a deliberate concurrency strategy): every mutating call
  re-sends the loaded `RowVersion`, on save (line 173) and on publish/unpublish (lines 221, 249), which is
  the client half of the optimistic-concurrency token described in
  `Website/docs-src/adr/035-optimistic-concurrency.md`; the server rejects a stale token rather than
  silently overwriting a concurrent edit.
  `[Rubric §6, CQRS & Event-Driven]`: publish and unpublish are not `IsPublished` flag edits, they are
  their own service operations (`PublishAsync` / `UnpublishAsync`,
  `.../Services/IEventUIService.cs:12,14`), so the state transition stays a named use case; note that
  `SaveChangesAsync` deliberately re-sends the *existing* `IsPublished` value (line 186) rather than
  letting the edit form move it.
  `[Rubric §13, Observability & Operability]`: the Sessionize refresh returns a
  [`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto) held in
  `_refreshResult` (line 69) so the organizer sees what the import actually did.
- **Walkthrough**
  - `LoadEventAsync` (lines 87-115): parse the id, `GetByIdAsync(eventId, true, ...)` so children arrive
    with the record (line 93), snackbar `ErrorMessages.NotFound` when it is missing (line 96), otherwise
    seed `_sessionizeCode` from the loaded event (line 100). The `finally` always clears `IsLoading`.
  - `SaveChangesAsync` (lines 147-209): validate the form, re-check the date range (lines 161-165),
    rebuild the DTO from the shadow fields including `RowVersion` (line 173) and the edited
    `QuestionModerationDefault` (line 187), `UpdateAsync`, then **refetch** the record (lines 190-191) so
    the page shows server truth rather than the values it just sent.
  - `PublishAsync` / `UnpublishAsync` (lines 211-265) are the same shape: call the named operation with
    the current `RowVersion`, refetch, snackbar. Each has its own failure message.
  - `RefreshFromSessionizeAsync` (lines 267-321) first **persists a changed Sessionize code** before
    importing (lines 279-302), since the code the organizer just typed is what the import must use, then
    calls `RefreshFromSessionizeAsync`, refetches the event, and reports completion (lines 304-307).
  - `DeleteEventAsync` (lines 323-350): confirm through `_deleteConfirm.ShowAsync(Event.Name)`
    (line 330), delete, then navigate back to the list.
- **Why it's built this way**: an event is the root aggregate of the whole conference, so publishing,
  importing, and editing are separate operations with separate audit meaning rather than one PUT; keeping
  each as its own service call is also what lets the server enforce its own rules per transition.
- **Where it's used**: the `/events/{Id}` organizer route (`.../Pages/Event/EventDetail.razor:1-2`),
  reached from [`EventList`](#eventlist) rows and from [`EventCreate`](#eventcreate)'s success redirect.
  Its "view feedback" button opens [`OrganizerEventFeedback`](#organizereventfeedback)
  (`.../Pages/Event/EventDetail.razor:176`).
- **Caveats / not-in-source**: what the Sessionize refresh imports, and how it reconciles existing rows,
  is server-side (the sync strategies in the Application layer); this page only shows the returned
  summary.

### QuestionDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Question` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Question/QuestionDetail.razor.cs:11` · Level 8 · class (Blazor code-behind)

- **What it is**: the organizer's view-edit-delete page for a single feedback question. It is the
  smallest detail page in the group: three editable fields and no lookups.
- **Depends on**: [`IQuestionUIService`](#iquestionuiservice) (line 15),
  [`QuestionDTO`](group-17-conference-domain.md#questiondto),
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages), the `Parse<T>` extension from
  [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper) (line 4), and the
  `DeleteConfirmation` plus `UnsavedChangesGuard` components.
- **Concept introduced**: none new. Route-id parsing, load-once-on-parameters, shadow-field editing, and
  the `RowVersion` round-trip are all introduced in [`EventDetail`](#eventdetail).
- **Walkthrough**
  - `OnParametersSetAsync` (lines 52-82) does the load inline rather than in a helper: guard on
    `_loadedId`, parse to `QuestionIdentifierType` (line 63), `GetByIdAsync` (line 64), snackbar
    `NotFound` when absent (line 67).
  - `StartEditing` (lines 84-96) copies only `QuestionText`, `Sort`, and `IsRequired` into shadow fields;
    `QuestionEntity` and `QuestionType` are not editable.
  - `SaveChangesAsync` (lines 104-149) rebuilds the DTO with `RowVersion` (line 123) and re-sends the
    **unchanged** `QuestionEntity` and `QuestionType` (lines 126-127), updates, then refetches (line 132).
    `[Rubric §8, Data Architecture]`: the immutable-after-create fields are round-tripped rather than
    omitted, so the update contract stays a full replacement.
  - `DeleteQuestionAsync` (lines 151-178) confirms with the question text as the label (line 158) and
    navigates back to the list on success.
- **Why it's built this way**: a question's entity and type determine how every existing answer was
  captured, so changing them after answers exist would invalidate stored data; restricting the edit
  surface to text, order, and required-ness is the simplest way to keep answers interpretable.
- **Where it's used**: the `/questions/{Id}` organizer route
  (`.../Pages/Question/QuestionDetail.razor:1`), reached from [`QuestionList`](#questionlist) and from
  [`QuestionCreate`](#questioncreate)'s success redirect.

### RoomDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Room` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Room/RoomDetail.razor.cs:12` · Level 8 · class (Blazor code-behind)

- **What it is**: the organizer's view-edit-delete page for one room, showing its parent event by name and
  editing name, sort, capacity, floor, location, and accessibility information.
- **Depends on**: [`IRoomUIService`](#iroomuiservice) (line 16) and
  [`IEventLookupService`](#ieventlookupservice) (line 17) returning [`EventInfo`](#eventinfo);
  [`RoomDTO`](group-17-conference-domain.md#roomdto); [`ConferenceRoutePaths`](#conferenceroutepaths);
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages); the `Parse<T>` extension (line 5);
  and the `DeleteConfirmation` plus `UnsavedChangesGuard` components.
- **Concept introduced, lookup-with-id-fallback.** `GetEventName` (lines 93-94) resolves the parent event
  through the lookup dictionary and falls back to the invariant-culture id when the lookup misses, so a
  dangling or not-yet-loaded reference degrades to a visible id rather than a blank cell. Every name
  resolver in this unit follows the same rule (compare [`SessionDetail`](#sessiondetail) lines 139-154).
  The lookup itself is hydrated lazily with `??=` (line 77), so revisiting the page does not refetch it.
  `[Rubric §19, State Management & Data Flow]`.
  `[Rubric §8, Data Architecture]`: unlike the other detail pages, the update here carries no
  `RowVersion`, because [`RoomDTO`](group-17-conference-domain.md#roomdto) does not define one
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/RoomDTO.cs:8-32`); rooms are
  edited without an optimistic-concurrency token.
- **Walkthrough**
  - `OnParametersSetAsync` (lines 58-91): the `_loadedId` guard, parse to `RoomIdentifierType` (line 69),
    `GetByIdAsync` with a `NotFound` snackbar and early return (lines 70-75), then the lazy event lookup
    (line 77).
  - `StartEditing` / `CancelEditing` (lines 96-117) are the standard shadow-field pair.
  - `SaveChangesAsync` (lines 119-165) rebuilds the [`RoomDTO`](group-17-conference-domain.md#roomdto)
    with the **unchanged** `EventId` (line 140), so a room cannot be moved between events from this page,
    calls `UpdateAsync`, and refetches (lines 147-148).
  - `DeleteRoomAsync` (lines 167-194) confirms on the room name (line 174) and calls
    `RoomService.DeleteAsync(Room.Id, _cts.Token)` (line 182).
- **Why it's built this way**: rooms belong to exactly one event for their whole life (their identity is
  shared with the Sessionize import), so the detail page treats the parent as read-only and offers only
  the descriptive fields for editing.
- **Where it's used**: the `/rooms/{Id}` organizer route (`.../Pages/Room/RoomDetail.razor:1`), reached
  from [`RoomList`](#roomlist) rows and from [`RoomCreate`](#roomcreate)'s success redirect.
- **Caveats / not-in-source**: the delete call binds the **inherited single-id overload** from
  `EntityServiceBase`, which issues `DELETE rooms/{id}` with no query string
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:152-162`), whereas
  [`RoomList`](#roomlist) calls the room-specific overload that appends `?eventId={eventId}`
  (`.../Services/RoomService.cs:35-43`) for the `[FromQuery] EventIdentifierType eventId` parameter the
  controller binds
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/RoomsController.cs:311-319`).
  What the API does with the absent parameter is a server-side outcome not determinable from this file.

### RoomList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Room` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Room/RoomList.razor.cs:12` · Level 9 · class (Blazor code-behind)

- **What it is**: the organizer browse page for rooms. It adds an **event filter** to the
  [`EventList`](#eventlist) shape, defaults that filter to the current or next conference, and enriches
  each row with the event's name.
- **Depends on**: extends
  [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) over
  [`RoomDTO`](group-17-conference-domain.md#roomdto) (line 12) and injects
  [`IRoomUIService`](#iroomuiservice) and [`IEventLookupService`](#ieventlookupservice) (lines 17-18). It
  uses [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector),
  [`EventInfo`](#eventinfo), [`ListPageActions`](group-24-identity-module.md#listpageactions),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages),
  [`ConferenceRoutePaths`](#conferenceroutepaths), and the shared list components.
- **Concept introduced, the defaulted filter and its startup race.** An organizer almost always wants the
  rooms of the conference that is running or coming up next, so the page computes that default instead of
  showing every room ever created. Three parts make it work:
  1. **The default itself**: `ResolveDefaultEventFilter` (lines 85-103) calls
     `CurrentEventSelector.SelectCurrentOrNext` with accessor lambdas for start date, end date, and time
     zone (lines 96-101), the same live-window math the backend uses. [`EventList`](#eventlist)'s sibling
     [`SessionList`](#sessionlist) can use the
     [`CurrentEventDefaults`](group-17-conference-domain.md#currenteventdefaults) wrapper instead because
     it holds [`EventDTO`](group-17-conference-domain.md#eventdto)s; this page holds
     [`EventInfo`](#eventinfo) records, so it calls the generic selector directly.
  2. **A restored id wins, but only if it still exists**: the guard at lines 88-92 keeps a restored
     selection and falls back to the computed default when the saved id no longer resolves, so a stale
     bookmark does not produce a silently empty grid. The `"all"` sentinel written by `SaveFilters`
     (line 40) is what distinguishes "the user explicitly cleared the filter" from "there is no saved
     state", which would otherwise both look like `null`. `[Rubric §25, Navigation & Information
     Architecture]`.
  3. **The race guard**: `_eventsLoadTask` is started in `OnInitializedAsync` (line 67) and awaited again
     inside both `LoadServerData` (lines 128-129) and `FetchMobilePage` (lines 149-150), because the grid's
     first `ServerData` call can run before initialization finishes and `ApplyFilters` executes *inside*
     `LoadServerDataAsync`. Without the second await the first page would be fetched unfiltered.
     `[Rubric §19, State Management & Data Flow]`.
  The event lookup failure is non-fatal by design: the catch comment says name enrichment falls back to
  ID display (lines 77-80), matching `GetEventName`'s own fallback (lines 105-106).
- **Walkthrough**
  - `SaveFilters` / `RestoreFilters` (lines 34-61) persist the search string plus the event id, parsing
    the sentinel and the integer id back out (lines 48-60).
  - `ApplyFilters` (lines 138-144) is shared by both fetch paths and emits `Name contains <search>` and
    `EventId equals <selected>`.
  - `OnSearchChanged` and `OnEventFilterChanged` (lines 111-122) each update one filter, mark the filter
    resolved, and reload the active layout through
    [`ListPageActions`](group-24-identity-module.md#listpageactions)`.ReloadActiveLayoutAsync`
    (lines 108-109).
  - `DeleteRoomAsync` (lines 161-169) passes both ids to the room-specific delete overload (line 165),
    the event-scoped call the API expects.
  - `NavigateToCreate` (line 171) opens [`RoomCreate`](#roomcreate).
- **Why it's built this way**: rooms accumulate across every conference the instance has ever hosted, so
  an unfiltered list is close to useless on day one of an event; computing the default from the same
  live-window rule the backend uses keeps the UI and the server agreeing on which conference is "now".
- **Where it's used**: the `/rooms` organizer route (`.../Pages/Room/RoomList.razor:1-2`); rows open
  [`RoomDetail`](#roomdetail) and the create button opens [`RoomCreate`](#roomcreate).

### SessionDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Session` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Session/SessionDetail.razor.cs:17` · Level 9 · class (Blazor code-behind)

- **What it is**: the organizer's full **session editor**: load one session by route id, inline-edit it,
  delete it, and manage its two child collections (speakers and category items), resolving event, room,
  speaker, and category names from lookups. It is the join-heaviest detail page in the Conference UI.
- **Depends on**: seven service clients, [`ISessionUIService`](#isessionuiservice),
  [`IEventLookupService`](#ieventlookupservice), [`ISpeakerLookupService`](#ispeakerlookupservice),
  [`ICategoryItemLookupService`](#icategoryitemlookupservice),
  [`ISessionSpeakerUIService`](#isessionspeakeruiservice),
  [`ISessionCategoryItemUIService`](#isessioncategoryitemuiservice), and
  [`IRoomUIService`](#iroomuiservice) (lines 21-27); the
  [`SessionDTO`](group-17-conference-domain.md#sessiondto) and
  [`RoomDTO`](group-17-conference-domain.md#roomdto) shapes; the [`EventInfo`](#eventinfo),
  [`SpeakerInfo`](#speakerinfo), and [`CategoryItemInfo`](#categoryiteminfo) lookup records;
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages), the `DeleteConfirmation` component
  from `MMCA.Common.UI`, and [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s
  `Parse<T>` extension (`MMCA.Common.Shared.Extensions`, line 6). Uses the
  `Event`/`Room`/`Speaker`/`Session`/`SessionSpeaker`/`SessionCategoryItem`/`CategoryItem` aliases.
- **Concept introduced, the event-keyed lookup cache and the join-collection editor.** The route-id
  parsing, load-once-on-parameters, and shadow-field mechanics are [`EventDetail`](#eventdetail)'s; two
  things are new:
  1. **An event-keyed room cache**: the global lookups are hydrated once with `??=` (lines 109-111), but
     rooms are per-event, so they are cached against `_roomsForEventId` and refetched when the session's
     event differs (lines 113-123). The in-code comment (lines 77-79) records the bug this prevents:
     without the key, navigating to a session in another event renders the previous event's room names
     and offers its rooms in the edit picker. `[Rubric §19, State Management & Data Flow]` (assesses where
     view state lives and when it is invalidated).
  2. **Join management as an add/remove/available triple**: the same three-method pattern is applied
     twice, once for speakers and once for category items, and each mutation is followed by a full
     `LoadAsync` rather than a local patch.
  `[Rubric §8, Data Architecture]`: the update DTO re-sends the loaded `RowVersion` (line 209), the client
  half of the optimistic-concurrency token (ADR-035), so the server can reject a stale concurrent edit.
  `[Rubric §18, UI Architecture & Component Design]`: the page's size comes from breadth (two join
  collections plus four lookups), not from bespoke mechanics.
- **Walkthrough**
  - `LoadAsync` (lines 96-137): parse the id, `GetByIdAsync(sessionId, true, ...)` so the join collections
    arrive with the record (line 102), snackbar `NotFound` and bail when the session is missing (lines
    103-107), hydrate the event/speaker/category-item lookups lazily (lines 109-111), then load the
    event's rooms into `_roomNames` and `_editableRooms` (lines 113-123). The `finally` always clears
    `IsLoading`.
  - Name resolution (lines 139-154): `GetEventName`, `GetSpeakerName`, `GetCategoryItemDisplayName`, and
    `GetRoomName` each fall back to the id when the lookup misses, so a stale reference degrades to an id
    rather than a blank cell; category items render as `"{CategoryTitle}: {Name}"` when a title exists
    (lines 147, 150-151).
  - Edit and save (lines 156-240): `StartEditing` seeds the shadow fields including the split date/time
    pairs (lines 165-168); `SaveChangesAsync` validates, recombines date plus time only when both parts
    are set (lines 201-204), rebuilds the DTO with `RowVersion` (line 209) and the **unchanged** `EventId`
    (line 212), calls `UpdateAsync`, then re-fetches the record (lines 222-223).
  - Delete (lines 242-269): confirm through `_deleteConfirm.ShowAsync(Session.Title)` (line 249), delete
    by id, then navigate back to the list.
  - Joins: `GetAvailableSpeakers` / `GetAvailableCategoryItems` (lines 271-287) subtract the already
    assigned ids from the lookup so the picker never offers a duplicate;
    `AddSessionSpeakerAsync` / `RemoveSessionSpeakerAsync` (lines 289-321) and
    `AddSessionCategoryItemAsync` / `RemoveSessionCategoryItemAsync` (lines 323-355) call the join-entity
    services and re-run `LoadAsync` so the page reflects the new state.
- **Why it's built this way**: a session is the join-heavy center of the program (speakers, category
  items, room, event, timing), so the organizer edits all of it from one console built out of the same
  reusable detail-page scaffolding the other Conference detail pages use; reloading after each join
  mutation keeps the page a single source of truth instead of hand-patching local collections.
- **Where it's used**: the `/sessions/{Id}` organizer route, reached from [`SessionList`](#sessionlist)
  rows and from [`SessionCreate`](#sessioncreate)'s success redirect; its "view feedback" button opens
  [`OrganizerSessionFeedback`](#organizersessionfeedback) (`.../Pages/Session/SessionDetail.razor:190`).
- **Caveats / not-in-source**: reads pass `includeChildren: true` so the join collections populate; how
  the GetAll path populates children is a server-side concern this page does not exercise.

### SessionList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Session` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Session/SessionList.razor.cs:18` · Level 10 · class (Blazor code-behind)

- **What it is**: the organizer browse page for sessions and the richest list in the Conference UI. It
  carries three filters (free-text title search, session status, and event), enriches each row with room
  and speaker names, and color-codes the Sessionize status. It sits at the top of the group's dependency
  order because it transitively pulls in the most lookups and defaults.
- **Depends on**: extends
  [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) (line 18) and
  injects [`ISessionUIService`](#isessionuiservice), [`IEventUIService`](#ieventuiservice), and
  [`ISpeakerLookupService`](#ispeakerlookupservice) (lines 23-25). It uses
  [`SessionDTO`](group-17-conference-domain.md#sessiondto),
  [`EventDTO`](group-17-conference-domain.md#eventdto), [`SpeakerInfo`](#speakerinfo),
  [`CurrentEventDefaults`](group-17-conference-domain.md#currenteventdefaults) (the `EventDTO`-typed
  wrapper over [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector)),
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages),
  [`ListPageActions`](group-24-identity-module.md#listpageactions), and the
  [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) plus
  `DeleteConfirmation` components. Uses the `Event`/`Room`/`Session`/`Speaker` aliases.
- **Concept introduced, the multi-filter enriched list.** `SessionList` layers three refinements on the
  event-filtered shape [`RoomList`](#roomlist), [`SponsorList`](#sponsorlist), and
  [`SpeakerList`](#speakerlist) share:
  1. **A third filter**: `_searchString`, `_selectedStatus`, and `_selectedEventId` persist together
     (`SaveFilters` lines 44-53, `RestoreFilters` lines 55-73) and are emitted as `Title contains`,
     `Status equals`, and `EventId equals` server filters (`ApplyFilters`, lines 208-216).
  2. **Enrichment from two bulk loads instead of per-row fetches**:
     `LoadEventsAndResolveDefaultAsync` fetches events with `includeChildren: true` (line 98) and folds
     every event's rooms into one `_roomNames` dictionary (`PopulateRoomNames`, lines 124-138), while the
     speaker lookup loaded in `OnInitializedAsync` (line 84) backs `GetSpeakerList` (lines 140-148), which
     maps a row's `SessionSpeakers` to display names and skips ids the lookup does not know. Both loads
     are wrapped in best-effort catches whose comments say the fallback is dash display, not a broken
     page (lines 86-89, 102-105). The paged fetch itself also passes `includeChildren: true` (lines 193,
     205) so each row arrives with its speaker joins.
  3. **Status color coding**: `GetStatusColor` (lines 150-159) maps the Sessionize status strings
     `Accepted`, `Waitlisted`, `Accept_Queue`, `Nominated`, `Decline_Queue`, and `Declined` to MudBlazor
     colors, defaulting to `Color.Default` for anything else.
  The startup race guard is the same one [`RoomList`](#roomlist) uses, with the clearest explanation in
  this file: `_eventsLoadTask` is started before the first `await` (lines 77-80) and awaited inside both
  `LoadServerData` (lines 187-188) and `FetchMobilePage` (lines 200-201), because `ApplyFilters` runs
  inside `LoadServerDataAsync`, so the default event must be resolved before entering it, "not merely
  before the fetch delegate runs" (in-code comment, lines 185-186).
  `[Rubric §18, UI Architecture & Component Design]`: the status filter surfaces the program-committee
  workflow inline instead of hiding it behind a separate screen.
  `[Rubric §23, Front-End Performance & Rendering]`: one children-loaded events fetch plus one speaker
  lookup replace what would otherwise be per-row enrichment calls.
  `[Rubric §25, Navigation & Information Architecture]`: all three filters survive navigation through the
  base class's persistence contract, with the same `"all"` sentinel and computed default.
- **Walkthrough**
  - `OnInitializedAsync` (lines 75-92): start the events task, load the speaker lookup (tolerating
    failure), then await the events task.
  - `ResolveDefaultEventFilter` (lines 110-122): keep a restored id that still exists in `_events`,
    otherwise take `CurrentEventDefaults.SelectCurrentOrNext(_events, DateTime.UtcNow)?.Id` (line 120).
  - `OnSearchChanged`, `OnStatusChanged`, and `OnEventFilterChanged` (lines 164-181) each update one
    filter and reload whichever layout is active via
    [`ListPageActions`](group-24-identity-module.md#listpageactions)`.ReloadActiveLayoutAsync`
    (lines 161-162).
  - `LoadServerData` (lines 183-195) and `FetchMobilePage` (lines 198-206) are the desktop and mobile
    fetch paths over the same `ApplyFilters`.
  - `DeleteSessionAsync` (lines 221-229) delegates the confirm, delete, snackbar, and reload sequence to
    `ListPageActions.DeleteWithConfirmationAsync`; `NavigateToCreate` and `NavigateToDetails` (lines
    231-232) route to [`SessionCreate`](#sessioncreate) and [`SessionDetail`](#sessiondetail).
- **Why it's built this way**: sessions are the central editable entity of the program, so the list has to
  answer "what is in this conference, in what state, presented by whom" at a glance; defaulting to the
  active event and enriching from two bulk loads keeps that view both relevant and cheap.
- **Where it's used**: the `/sessions` organizer route
  (`.../Pages/Session/SessionList.razor:1-2`, `Authorize(Roles = "Organizer")`); rows open
  [`SessionDetail`](#sessiondetail) and the create button opens [`SessionCreate`](#sessioncreate).
- **Caveats / not-in-source**: the page builds speaker names from its own lookup rather than trusting the
  paged payload alone, so it degrades to a dash rather than a wrong name when a speaker id is unknown;
  how the paged endpoint populates `SessionSpeakers` is a server-side concern outside this file.

### ActivityCreate

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Activity` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activity/ActivityCreate.razor.cs:16` · Level 9 · class (Blazor code-behind)

- **What it is**: the organizer form that schedules an activity, the non-session items on a conference
  programme (registration, breaks, receptions, after-parties). It collects the name, the owning event, the
  start and end of the window as **separate date and time pickers**, the display order used to break ties,
  and an optional off-site venue. The event picker is required, because activities are scheduled per event
  and the owning event cannot be changed afterwards (class doc, lines 10-14).
- **Depends on**: [`IActivityUIService`](#iactivityuiservice) (line 18),
  [`IEventLookupService`](#ieventlookupservice) returning [`EventInfo`](#eventinfo) (line 19),
  [`ActivityDTO`](group-17-conference-domain.md#activitydto),
  [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) from
  `MMCA.ADC.Conference.Shared.Events`, [`ConferenceRoutePaths`](#conferenceroutepaths), and
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages). Externals: Blazor
  (`[Inject]`, `NavigationManager`), MudBlazor (`MudForm`, `ISnackbar`, `BreadcrumbItem`,
  `MudDatePicker` / `MudTimePicker`), and the `IStringLocalizer<ActivityCreate>` injected by the template
  (`.../Pages/Activity/ActivityCreate.razor:5`). The `UnsavedChangesGuard` component from `MMCA.Common.UI`
  is wired in the markup (`.../Pages/Activity/ActivityCreate.razor:9`).
- **Concept introduced, the split date/time picker pair and its out-of-band validation.** Every other
  create form in this group binds one control per DTO property and lets `MudForm` validate it. An activity
  carries two `DateTime` values that no single MudBlazor control captures well, so the page keeps **four**
  backing fields (`_startDate`, `_startTime`, `_endDate`, `_endTime`, lines 75-78) and recombines them in
  `TryBuildSchedule` (lines 116-144): a missing date or time yields `Error.StartRequired` or
  `Error.EndRequired`, an end before the start yields `Error.EndBeforeStart`, and the message lands in
  `_scheduleError` (lines 123, 129, 138) rather than in the form's own error list. The template renders
  that string in its own `MudAlert` directly above the form's error summary
  (`.../Pages/Activity/ActivityCreate.razor:78-81`, summary at `:83-95`), so a cross-field rule reads like
  every other validation error to the user even though `MudForm` knows nothing about it.
  `[Rubric §24, Forms, Validation & UX Safety]` assesses whether a form can express only legal input and
  explains a rejection in place: the schedule rule runs before anything is posted (line 160), a failure
  snackbars the specific message rather than a generic one (line 162), and `_isDirty` (lines 85, 88) drives
  `UnsavedChangesGuard` so navigating away mid-edit prompts.
  The page also uses the smart default the other event-scoped create forms share: rather than
  auto-selecting an event only when exactly one exists, `OnInitializedAsync` seeds the picker with
  [`CurrentEventSelector.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventselector)
  evaluated over each event's start date, end date and IANA time zone against `DateTime.UtcNow`
  (lines 49-56). The `??=` means a value the organizer already picked is never overwritten.
  One idea is genuinely new here: `ApplyEventDateDefaults` (lines 100-110) also seeds **both date pickers**
  with the selected event's first day (`info.StartDate.ToDateTime(TimeOnly.MinValue)`, line 107), so the
  organizer normally only picks the times, and it re-runs on every event change through `OnEventSelected`
  (lines 90-94). Again `??=` (lines 108-109) protects dates the organizer already chose.
- **Walkthrough**
  - `OnInitialized` (lines 28-37) builds the three breadcrumbs synchronously (Home, Activities, Create),
    the last one `disabled: true` so it renders as the current page.
  - `OnInitializedAsync` (lines 39-68) loads the event lookup through the cancellable `_cts.Token`
    (line 45), resolves the default event (lines 49-56), then calls `ApplyEventDateDefaults` (line 58).
    `OperationCanceledException` is swallowed as expected during disposal or an `InteractiveAuto` render
    mode transition (in-code comment, lines 60-63; see
    [ADR-056](https://ivanball.github.io/docs/adr/056-blazor-render-mode-strategy.html)); any other failure
    is swallowed too, because the picker then renders empty and the required-field error guides the user
    (comment, lines 65-67).
  - `CreateActivityAsync` (lines 146-200) awaits `_form.ValidateAsync()`, re-checks `_eventId is null`
    (line 154), then runs `TryBuildSchedule` (line 160). Only then does it build the
    [`ActivityDTO`](group-17-conference-domain.md#activitydto) with `Id = default` (line 171), so the
    server mints the key and the page reads it back from `created.Id`. It posts through `AddAsync`
    (line 183), clears `_isDirty` **before** navigating (line 184), snackbars success, and routes to
    `ConferenceRoutePaths.ActivityDetails(created.Id)` (line 186). `IsSaving` is cleared in the `finally`
    (line 198), which is what re-enables the submit button after a failure.
  - `NavigateToList` (line 202) and the standard `Dispose(bool)` / `Dispose` pair (lines 206-226) close the
    page out: the `_cts` is cancelled and disposed exactly once, guarded by `_disposed`.
- **Why it's built this way**: an activity belongs to exactly one event and its schedule is a window, not a
  point, so the form's job is to make the window easy to enter and impossible to invert. Defaulting the
  event and both dates from the selected conference removes the two most common clicks without hiding
  either field, and keeping the cross-field check in the code-behind lets one message name the actual
  problem (a missing part vs an inverted window) instead of a generic "invalid form".
- **Where it's used**: the `/activities/create` organizer route
  (`.../Pages/Activity/ActivityCreate.razor:1-2`, `Authorize(Roles = "Organizer")`), reached from
  [`ActivityList`](#activitylist)'s create button; on success it hands off to
  [`ActivityDetail`](#activitydetail).
- **Caveats / not-in-source**: `TryBuildSchedule` composes local `DateTime` values from the pickers and
  does no time-zone conversion of its own, even though the event's `TimeZone` is available on
  [`EventInfo`](#eventinfo). How the resulting `StartTime` and `EndTime` are interpreted downstream is
  decided by the command handler, not by this page.

### ActivityDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Activity` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activity/ActivityDetail.razor.cs:16` · Level 9 · class (Blazor code-behind)

- **What it is**: the organizer's activity record page: load one activity by route id, inline-edit every
  field **except** the owning event, and delete with confirmation. The class doc (lines 11-15) states the
  rule the page enforces: moving an activity between events is a create plus a delete, so the event is
  displayed but never edited here.
- **Depends on**: [`IActivityUIService`](#iactivityuiservice) (line 20),
  [`IEventLookupService`](#ieventlookupservice) returning [`EventInfo`](#eventinfo) (line 21),
  [`ActivityDTO`](group-17-conference-domain.md#activitydto),
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages), and the `DeleteConfirmation` component
  from `MMCA.Common.UI` (line 78). Externals: Blazor (`[Parameter]`, `NavigationManager`), MudBlazor
  (`MudForm`, `ISnackbar`), `System.Globalization`, and the `IStringLocalizer<ActivityDetail>` from the
  template (`.../Pages/Activity/ActivityDetail.razor:5`).
- **Concept introduced, culture-formatted display on a shadow-field edit form.** The page reuses the
  detail-page shape [`SessionDetail`](#sessiondetail) teaches (load-once guard on `_loadedId`
  lines 82-91, `_edit*` shadow fields lines 64-74, `RowVersion` round-trip line 210, confirm-then-delete
  lines 242-269, cancel-on-disposal `_cts` at lines 27 and 275-295) and adds two wrinkles:
  1. **Two computed display properties.** `EventName` (lines 33-36) resolves the activity's `EventId`
     against the event lookup and falls back to the invariant-culture id when the lookup is unavailable, so
     the read-only event line never renders blank. `TimeRange` (lines 39-45) formats the window as a single
     localized string by passing the start (`"f"`, full date and time) and the end (`"t"`, short time)
     rendered in `CultureInfo.CurrentCulture` into the `Text.TimeRange` resource. The joining sentence
     lives in the `.resx`, not in the code, so a locale can reorder or reword the range.
     `[Rubric §27, Internationalization]` assesses whether user-visible text and formats follow the request
     culture rather than the server's: here both the values and the sentence that joins them do (see
     [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
  2. **The immutable field on an editable record.** `StartEditing` (lines 121-141) seeds shadow fields for
     the name, sort order, the four date and time parts, the description and the three venue fields, but
     **not** the event; the update DTO re-sends `EventId = Activity.EventId` unchanged (line 219). Making
     the field un-editable in the form is what enforces the "a move is a create plus a delete" rule
     client-side. `[Rubric §24, Forms, Validation & UX Safety]`.
  The schedule rule from [`ActivityCreate`](#activitycreate) reappears here as a second `TryBuildSchedule`
  over the `_edit*` fields (lines 154-182), with the same three localized error keys, so the create and
  edit paths validate a window identically. They are two copies of the same method rather than one shared
  helper, which is the maintenance cost of keeping each page self-contained
  (`[Rubric §16, Maintainability]`).
  `[Rubric §8, Data Architecture]`: the update carries the loaded `RowVersion` (line 210), so a concurrent
  edit is detected server-side rather than silently overwritten (see
  [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)).
- **Walkthrough**
  - `OnParametersSetAsync` (lines 82-91) returns early when `Id == _loadedId`, otherwise records the id and
    calls `LoadAsync`; that guard is what stops a re-render from re-fetching.
  - `LoadAsync` (lines 93-119) fetches with `GetByIdAsync(Id, true, _cts.Token)` (line 98), snackbars
    `ErrorMessages.NotFound` and bails when the record is missing (lines 99-103), then hydrates the event
    lookup lazily with `??=` (line 105). Cancellation is swallowed; any other failure snackbars
    `ErrorMessages.LoadError`; the `finally` clears `IsLoading`, which the template uses to switch between
    `PageLoadingState`, `PageErrorState` and the record (`.../Pages/Activity/ActivityDetail.razor:14-21`).
  - `StartEditing` / `CancelEditing` (lines 121-148) enter and leave edit mode, clearing `_scheduleError`
    and `_isDirty` on both paths, so neither a stale cross-field error nor the unsaved-changes guard can
    fire after a cancel.
  - `SaveChangesAsync` (lines 184-240) validates the `MudForm`, runs `TryBuildSchedule`, rebuilds the
    [`ActivityDTO`](group-17-conference-domain.md#activitydto) from the shadow fields plus the preserved
    `Id`, `RowVersion` and `EventId` (lines 207-220), calls `UpdateAsync`, then **re-fetches** the record
    (line 223) so the page shows the server's version including the new `RowVersion`, and finally clears
    `_isDirty` and exits edit mode.
  - `DeleteActivityAsync` (lines 242-269) confirms through `_deleteConfirm.ShowAsync(Activity.Name)`
    (line 249), returns unless the answer is exactly `true` (line 250, so a dismissed dialog is not a
    delete), deletes, snackbars, and navigates back to the list.
- **Why it's built this way**: an activity is a per-event programme item, so its name, window, order and
  venue are freely editable while its owning event is not. Keeping that constraint in the form (no shadow
  field, DTO re-sends the loaded value) means the page cannot even express the illegal update, and the
  re-fetch after save keeps the concurrency token current for the next edit.
- **Where it's used**: the `/activities/{Id:int}` organizer route
  (`.../Pages/Activity/ActivityDetail.razor:1-2`), reached from [`ActivityList`](#activitylist) rows and
  from [`ActivityCreate`](#activitycreate)'s success redirect. It edits the same aggregate the
  [`Activity`](group-17-conference-domain.md#activity) entity models.

### ActivityList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Activity` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activity/ActivityList.razor.cs:19` · Level 9 · class (Blazor code-behind)

- **What it is**: the organizer browse page for activities: a server-paged `MudDataGrid` with a name search,
  start-time, venue and display-order columns, an event filter, a mobile card layout, and
  delete-with-confirmation.
- **Depends on**: extends
  [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) closed over
  [`ActivityDTO`](group-17-conference-domain.md#activitydto) (line 19), and injects
  [`IActivityUIService`](#iactivityuiservice) and [`IEventLookupService`](#ieventlookupservice)
  (lines 24-25). It uses [`EventInfo`](#eventinfo),
  [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector),
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages),
  [`ListPageActions`](group-24-identity-module.md#listpageactions) (the shared reload and
  delete-with-confirmation helpers, lines 116 and 170), and the
  [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) plus
  `DeleteConfirmation` components from `MMCA.Common.UI`.
- **Concept introduced, a chronological mobile list over the same filter set.** `ActivityList` follows the
  event-filtered list shape that [`RoomList`](#roomlist) and [`SponsorList`](#sponsorlist) establish:
  1. **Persisted filters with an `"all"` sentinel** (`SaveFilters` lines 44-52, `RestoreFilters`
     lines 54-71): the sentinel distinguishes an explicit "show every event" from *no saved state*, which
     is what lets the computed default apply on a first visit only.
  2. **A computed default**: `ResolveDefaultEventFilter` (lines 95-113) keeps a restored id that still
     exists in the lookup and otherwise falls back to
     [`CurrentEventSelector.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventselector)
     (lines 104-111), so a dangling saved id shows the current conference rather than an empty grid.
  3. **The startup race guard**: `OnInitializedAsync` assigns `_eventsLoadTask` before its first `await`
     (lines 73-79), and both `LoadServerData` (lines 135-136) and `FetchMobilePage` (lines 155-156) await
     that task before applying filters, because the grid's first `ServerData` call can race ahead of
     initialization and `ApplyFilters` runs *inside* the base class's `LoadServerDataAsync` (in-code
     comment, lines 133-134).
  What is specific to activities is the **mobile sort**: the desktop grid opens on name ascending
  (`.../Pages/Activity/ActivityList.razor:72`) and lets the user re-sort any sortable column, but
  `FetchMobilePage` pins `"StartTime", "asc"` (line 163) because, as the in-code comment says, the
  programme reads chronologically (line 162). The two layouts therefore share filters and a data contract
  but not ordering.
  `[Rubric §19, State Management & Data Flow]` (assesses where view state lives and how it is restored):
  filter state is saved, restored, defaulted and reconciled against the live event set in one method, while
  the grid's page and page size live in the base class's `CurrentPageState` and `RowsPerPageState`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:57`,
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:67`).
  `[Rubric §23, Front-End Performance & Rendering]` (assesses work pushed off the client): paging,
  searching, sorting and filtering all happen server-side, the event lookup is fetched once and reused, and
  the search box debounces at 300 ms (`.../Pages/Activity/ActivityList.razor:23`).
  `[Rubric §22, Responsive & Cross-Browser]`: one DTO feeds both the desktop grid and the mobile
  infinite-scroll list, switched on the base class's `IsMobile`
  (`.../Pages/Activity/ActivityList.razor:39-57`), and the venue and sort columns carry
  `hide-below-desktop` classes so the grid sheds columns before it scrolls
  (`.../Pages/Activity/ActivityList.razor:47-48`, `.../Pages/Activity/ActivityList.razor:60-61`).
  `[Rubric §21, Accessibility]`: the cancel-load button and both delete buttons carry localized
  `aria-label`s (`.../Pages/Activity/ActivityList.razor:13,54,104`).
- **Walkthrough**
  - `LoadEventsAndResolveDefaultAsync` (lines 81-93) loads the lookup, swallows a failure as non-critical
    (the picker stays hidden and the default filter stays unset, comment lines 88-90), then resolves the
    default. The picker itself only renders when more than one event exists
    (`.../Pages/Activity/ActivityList.razor:25`).
  - `LoadServerData` (lines 131-143) awaits the events task and delegates to the base's
    `LoadServerDataAsync`, handing it the paged fetch delegate and `ApplyFilters`.
    `ApplyFilters` (lines 145-151) emits `Name contains` and `EventId equals` server filters, adding each
    only when set; `EventId` is a real Activity column
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Activities/ActivityDTO.cs:43`), so the
    filter goes straight through the generic filter pipeline with no join-based resolution on the server
    (class doc, lines 13-18).
  - `FetchMobilePage` (lines 154-164) is the parallel mobile path: same filters, fixed `StartTime asc` sort;
    `OnMobileCardClick` (line 166) routes a card tap to the detail page.
  - `OnSearchChanged` and `OnEventFilterChanged` (lines 118-129) update state then call
    `ReloadActiveLayoutAsync`, which routes to the grid or the infinite list through
    [`ListPageActions`](group-24-identity-module.md#listpageactions) (lines 115-116).
  - `DeleteActivityAsync` (lines 169-177) is the whole delete flow expressed as one call to
    `ListPageActions.DeleteWithConfirmationAsync`, passing the dialog, the display name, the delete
    delegate, the snackbar, the success message, an error formatter and the reload callback.
  - `RetryLoadAsync` (line 32) re-runs the grid fetch from the base class's inline error state
    (`LoadFailed`, surfaced by `ListNoRecordsContent` at
    `.../Pages/Activity/ActivityList.razor:109`), so a transient failure does not require a page reload.
  - `FormatStartTime` (line 42) renders the start as short date plus short time in
    `CultureInfo.CurrentCulture`, and is shared by the grid cell and the mobile card.
- **Why it's built this way**: activities are browsed per conference, so the list defaults to the current or
  next event exactly like the room and sponsor lists. Because `EventId` is a first-class column, the page
  needs none of the virtual-filter machinery the speaker list requires, and the only real decision left is
  which order each layout opens in: alphabetical where the user can re-sort, chronological where a thumb
  scrolls a programme.
- **Where it's used**: the `/activities` organizer route
  (`.../Pages/Activity/ActivityList.razor:1-2`, `Authorize(Roles = "Organizer")`); the name cell links to
  [`ActivityDetail`](#activitydetail) and the create button to [`ActivityCreate`](#activitycreate).

### SponsorCreate

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sponsor` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsor/SponsorCreate.razor.cs:15` · Level 9 · class (Blazor code-behind)

- **What it is**: the organizer form that creates a sponsorship record: name, tier, owning event, branding
  links (logo, website, LinkedIn, X handle), sort order, and the optional expo-booth details. The event
  picker is required, because sponsorships are sold per event and the owning event cannot be changed
  afterwards (class doc, lines 10-14).
- **Depends on**: [`ISponsorUIService`](#isponsoruiservice) (line 20),
  [`IEventLookupService`](#ieventlookupservice) returning [`EventInfo`](#eventinfo) (line 21),
  [`SponsorDTO`](group-17-conference-domain.md#sponsordto),
  [`SponsorTier`](group-17-conference-domain.md#sponsortier),
  [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (from
  `MMCA.ADC.Conference.Shared.Events`), [`ConferenceRoutePaths`](#conferenceroutepaths), and
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages). Externals: Blazor
  (`NavigationManager`), MudBlazor (`MudForm`, `ISnackbar`, `BreadcrumbItem`), and the
  `IStringLocalizer<SponsorCreate>` injected by the template
  (`.../Pages/Sponsor/SponsorCreate.razor:5`).
- **Concept introduced, the smart default from the current-or-next event.** This page reuses the create
  form shape [`SessionCreate`](#sessioncreate) introduces (cancel-on-disposal `_cts` line 25,
  validate-then-submit lines 99-104, `_isDirty` guard lines 88-90 wired to `UnsavedChangesGuard` in the
  template at `.../Pages/Sponsor/SponsorCreate.razor:9`) and adds one idea: rather than auto-selecting an
  event only when exactly one exists, it seeds the picker with the event the organizer is most likely
  selling against by calling
  [`CurrentEventSelector.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventselector) with
  the event's start, end, and IANA time zone against `DateTime.UtcNow` (lines 54-61). The `??=` means a
  value the organizer already picked is never overwritten. `[Rubric §24, Forms, Validation & UX Safety]`
  (assesses defaults that make the common case one click while leaving the field editable and required):
  the picker still validates as required, so a wrong default cannot be saved silently, and the lookup
  failure path deliberately swallows the exception because "the picker renders empty and the
  required-field error guides the user" (in-code comment, lines 67-70).
  Two smaller contrasts with the session form are worth noting. The tier picker is driven by
  `Enum.GetValues<SponsorTier>()` cached in a `static readonly` array (line 18) and labeled through
  `TierLabel`, which resolves `L[$"Tier.{tier}"]` (line 31), so adding a tier to
  [`SponsorTier`](group-17-conference-domain.md#sponsortier) needs no page change beyond a resource entry
  (`[Rubric §27, Internationalization]`, `[Rubric §16, Maintainability]`). And the posted DTO sets
  `Id = default` (line 111) rather than minting a client-side temporary id, so the server assigns the key
  and the page reads it back from `created.Id` (line 128).
- **Walkthrough**
  - `OnInitialized` (lines 33-42) builds the breadcrumbs synchronously; the async
    `OnInitializedAsync` (lines 44-71) loads the event lookup (line 50) and resolves the default event
    (lines 54-61), swallowing cancellation and any lookup failure.
  - `CreateSponsorAsync` (lines 92-142) validates the form **and** re-checks `_eventId is null` (line 100)
    before building the [`SponsorDTO`](group-17-conference-domain.md#sponsordto) with every collected
    field (lines 109-123), posts it via `AddAsync` (line 125), clears `_isDirty` before navigating
    (line 126), snackbars success, and routes to
    `ConferenceRoutePaths.SponsorDetails(created.Id)` (line 128). `IsSaving` is cleared in the `finally`.
  - `NavigateToList` (line 144) and the standard `Dispose(bool)` / `Dispose` pair (lines 146-168) close
    the page out; the `_cts` is cancelled and disposed exactly once, guarded by `_disposed`.
- **Why it's built this way**: sponsorship is sold per event, so the owning event is a required, immutable
  choice; defaulting it to the current or next conference removes the most common click without hiding the
  field, and the create-then-delete story for moving a sponsor keeps the create form the only place the
  event is chosen.
- **Where it's used**: the `/sponsors/create` organizer route (`.../Pages/Sponsor/SponsorCreate.razor:1-2`),
  reached from [`SponsorList`](#sponsorlist)'s create button; on success it hands off to
  [`SponsorDetail`](#sponsordetail).

### SponsorDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sponsor` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsor/SponsorDetail.razor.cs:15` · Level 9 · class (Blazor code-behind)

- **What it is**: the organizer's sponsor record page: load one sponsor by route id, inline-edit every
  field **except** the owning event, and delete with confirmation. The class doc (lines 10-14) states the
  rule the page enforces: moving a sponsorship between events is a create plus a delete, so the event is
  displayed but never edited here.
- **Depends on**: [`ISponsorUIService`](#isponsoruiservice) (line 22),
  [`IEventLookupService`](#ieventlookupservice) returning [`EventInfo`](#eventinfo) (line 23),
  [`SponsorDTO`](group-17-conference-domain.md#sponsordto),
  [`SponsorTier`](group-17-conference-domain.md#sponsortier),
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages), and the `DeleteConfirmation`
  component from `MMCA.Common.UI` (line 73). Externals: Blazor (`[Parameter]`, `NavigationManager`),
  MudBlazor (`MudForm`, `ISnackbar`), and the `IStringLocalizer<SponsorDetail>` from the template
  (`.../Pages/Sponsor/SponsorDetail.razor:5`).
- **Concept introduced, the typed route parameter and the immutable field on an edit form.** This page
  reuses the detail-page shape [`SessionDetail`](#sessiondetail) teaches (load-once guard on `_loadedId`
  lines 77-86, `_edit*` shadow fields lines 60-72, `RowVersion` round-trip line 163,
  confirm-then-delete lines 197-224, cancel-on-disposal `_cts` lines 29 and 230-250) with two
  differences worth calling out:
  1. **The id is typed at the route**: `[Parameter] public int Id` (line 27) bound by the constrained
     route `/sponsors/{Id:int}` (`.../Pages/Sponsor/SponsorDetail.razor:1`), so there is no
     `Id.Parse<T>` step and a non-numeric URL never reaches the component.
     `[Rubric §25, Navigation & Information Architecture]` (assesses routes that carry and constrain their
     own parameters).
  2. **An immutable field on an editable record**: `StartEditing` (lines 116-135) seeds shadow fields for
     name, tier, sort, description, the four link fields, and the booth pair, but **not** the event; the
     update DTO re-sends `EventId = Sponsor.EventId` unchanged (line 172). The event is shown read-only
     through the `EventName` computed property (lines 38-41), which resolves the id against the event
     lookup and falls back to the invariant-culture id. `[Rubric §24, Forms, Validation & UX Safety]`:
     making the field un-editable in the form is what enforces the "a move is a create plus a delete"
     rule client-side. `[Rubric §8, Data Architecture]`: the update also carries the loaded `RowVersion`
     (line 163), so a concurrent edit is detectable server-side (see
     [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)).
- **Walkthrough**
  - `OnParametersSetAsync` (lines 77-86) returns early when `Id == _loadedId`, otherwise records the id
    and calls `LoadAsync`.
  - `LoadAsync` (lines 88-114) fetches the sponsor with `GetByIdAsync(Id, true, _cts.Token)` (line 93),
    snackbars `ErrorMessages.NotFound` and bails when it is missing (lines 94-98), then hydrates the
    event lookup lazily with `??=` (line 100). Cancellation is swallowed; any other failure snackbars
    `ErrorMessages.LoadError`; the `finally` clears `IsLoading`.
  - `StartEditing` / `CancelEditing` (lines 116-141) enter and leave edit mode, resetting `_isDirty` on
    both paths so the unsaved-changes guard cannot fire after a cancel.
  - `SaveChangesAsync` (lines 143-195) validates the `MudForm`, rebuilds the
    [`SponsorDTO`](group-17-conference-domain.md#sponsordto) from the shadow fields plus the preserved
    `Id`, `RowVersion`, and `EventId` (lines 160-175), calls `UpdateAsync`, re-fetches the record so the
    page shows the server's version including the new `RowVersion` (line 178), then clears `_isDirty` and
    exits edit mode.
  - `DeleteSponsorAsync` (lines 197-224) confirms through `_deleteConfirm.ShowAsync(Sponsor.Name)`
    (line 204), returns unless the answer is exactly `true`, deletes, snackbars, and navigates back to
    the list.
- **Why it's built this way**: a sponsorship is a per-event contract, so its branding and booth details
  are freely editable while its owning event is not; keeping that constraint in the form (no shadow field,
  DTO re-sends the loaded value) means the page cannot even express the illegal update.
- **Where it's used**: the `/sponsors/{Id:int}` organizer route, reached from
  [`SponsorList`](#sponsorlist) rows and from [`SponsorCreate`](#sponsorcreate)'s success redirect. The
  same sponsors are rendered to attendees by
  [`PublicSponsorList`](#publicsponsorlist) and scanned through
  [`SponsorVisit`](group-22-engagement-module.md#sponsorvisit) in the Engagement module.

### SponsorList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sponsor` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsor/SponsorList.razor.cs:19` · Level 9 · class (Blazor code-behind)

- **What it is**: the organizer browse page for sponsors: a server-paged `MudDataGrid` with a name search,
  a tier column, and an event filter, plus a mobile card layout and delete-with-confirmation.
- **Depends on**: extends
  [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) (line 19),
  and injects [`ISponsorUIService`](#isponsoruiservice) and
  [`IEventLookupService`](#ieventlookupservice) (lines 24-25). It uses
  [`SponsorDTO`](group-17-conference-domain.md#sponsordto),
  [`SponsorTier`](group-17-conference-domain.md#sponsortier), [`EventInfo`](#eventinfo),
  [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector),
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages),
  [`ListPageActions`](group-24-identity-module.md#listpageactions) (the shared reload and
  delete-with-confirmation helpers, lines 116 and 168), and the
  [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) plus
  `DeleteConfirmation` components from `MMCA.Common.UI`.
- **Concept introduced, an event filter that needs no server-side join.** `SponsorList` follows the
  event-filtered list shape that [`RoomList`](#roomlist) and [`SpeakerList`](#speakerlist) establish:
  1. **Persisted filters with an `"all"` sentinel** (`SaveFilters` lines 44-52, `RestoreFilters` lines
     54-71): the sentinel distinguishes an explicit "show every event" from *no saved state*, which is
     what triggers the computed default.
  2. **A computed default**: `ResolveDefaultEventFilter` (lines 95-113) keeps a restored id that still
     exists in the lookup and otherwise falls back to
     [`CurrentEventSelector.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventselector)
     (lines 106-111), so a dangling saved id shows the current conference rather than an empty grid.
  3. **The startup race guard**: `OnInitializedAsync` assigns `_eventsLoadTask` before its first `await`
     (lines 73-79), and both `LoadServerData` (lines 135-136) and `FetchMobilePage` (lines 156-157) await
     that task before applying filters, because the grid's first `ServerData` call can race ahead of
     initialization and `ApplyFilters` runs *inside* `LoadServerDataAsync` (in-code comment, lines
     133-134).
  The difference from the speaker list is stated in the class doc (lines 13-18): `EventId` is a **real
  Sponsor column**, so the filter goes straight through the generic filter pipeline with no join-based
  resolution on the server. `[Rubric §19, State Management & Data Flow]`: filter state is restored,
  defaulted, and reconciled against the live event set in one method.
  `[Rubric §23, Front-End Performance & Rendering]` (assesses work pushed off the client): paging,
  searching, and filtering are all server-side, and the event lookup is fetched once and reused.
  `[Rubric §22, Responsive & Cross-Browser]`: one data contract feeds both the desktop grid and the mobile
  infinite-scroll list, switched on the base class's `IsMobile`
  (`.../Pages/Sponsor/SponsorList.razor:39-57`).
  `[Rubric §21, Accessibility]`: the row and card delete buttons carry localized `aria-label`s
  (`.../Pages/Sponsor/SponsorList.razor:54,104`).
- **Walkthrough**
  - `LoadEventsAndResolveDefaultAsync` (lines 81-93) loads the lookup, swallows a failure as non-critical
    (the picker stays hidden and the default filter stays unset), then resolves the default.
  - `LoadServerData` (lines 131-143) awaits the events task and delegates to the base's
    `LoadServerDataAsync`, handing it the paged fetch delegate and `ApplyFilters`;
    `ApplyFilters` (lines 145-151) emits `Name contains` and `EventId equals` server filters, adding each
    only when set.
  - `FetchMobilePage` (lines 154-162) is the parallel mobile path: same filters, fixed `Name asc` sort.
  - `OnSearchChanged` and `OnEventFilterChanged` (lines 118-129) update state then call
    `ReloadActiveLayoutAsync`, which routes to the grid or the infinite list through
    [`ListPageActions`](group-24-identity-module.md#listpageactions) (lines 115-116).
  - `DeleteSponsorAsync` (lines 167-175) is the whole delete flow expressed as one call to
    `ListPageActions.DeleteWithConfirmationAsync`, passing the dialog, the display name, the delete
    delegate, the snackbar, the success message, an error formatter, and the reload callback.
  - `RetryLoadAsync` (line 32) re-runs the grid fetch from the base class's inline error state, so a
    transient failure does not require a page reload.
- **Why it's built this way**: sponsors are browsed per conference, so the list defaults to the current or
  next event exactly like the room and speaker lists; because `EventId` is a first-class column the page
  needs none of the virtual-filter machinery the speaker list requires, which makes it the simplest
  event-scoped list in the group.
- **Where it's used**: the `/sponsors` organizer route
  (`.../Pages/Sponsor/SponsorList.razor:1-2`, `Authorize(Roles = "Organizer")`); rows navigate to
  [`SponsorDetail`](#sponsordetail) and the create button to [`SponsorCreate`](#sponsorcreate).


---
[⬅ ADC Conference - API, gRPC Contracts & Service Host](group-20-conference-api-grpc.md)  •  [Index](00-index.md)  •  [ADC Engagement Module (Session Bookmarks) ➡](group-22-engagement-module.md)
