# 21. ADC Conference - UI

**What this chapter covers.** This is the **consumer half** of the "write-once UI, render everywhere" story ([primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)): the Blazor pages, page-local collaborators, and per-entity HTTP services that turn the Conference REST surface ([G20](group-20-conference-api-grpc.md)) into the screens an organizer, a speaker, a sponsor, or an anonymous attendee actually touches. Everything here lives in the per-module Razor Class Library `MMCA.ADC.Conference.UI` (under `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/`, the path every `File:line` citation below is relative to), which, like every consumer UI, assembles the reusable primitives taught in [G15 (Common UI Framework)](group-15-common-ui-framework.md) into concrete pages. There is very little new *infrastructure* here: the value is in seeing how a twelve-area feature surface (events, sessions, speakers, conference categories and their items, questions, rooms, sponsors, activities, feedback moderation, public browsing, session selection, and the conference landing page) is *composed* from the framework's list-page base, typed HTTP service base, validation bridge, device-capability abstractions, and module system. The headline lens is `[Rubric §18, UI Architecture & Component Design]`, which assesses component reuse, separation of presentation from data access, and a coherent composition model. Because the same Razor components compile into the Blazor Server, WebAssembly, and .NET MAUI hybrid heads, this one library renders the conference across web, Android, iOS, macOS, and Windows with no per-platform reimplementation. `[Rubric §22, Responsive & Cross-Browser/Device]`.

## The layering inside the UI: a page never touches HttpClient

Each page is a `.razor` + `.razor.cs` code-behind pair that depends on a *UI service interface*, never on `HttpClient` and never on the API's internals. The nine CRUD-shaped entities (events, sessions, speakers, conference categories, category items, questions, rooms, sponsors, activities) each get a service deriving from Common's [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype) and exposing the [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype) contract: [`EventService`](#eventservice), [`SessionService`](#sessionservice), [`SpeakerService`](#speakerservice), [`ConferenceCategoryService`](#conferencecategoryservice), [`CategoryItemService`](#categoryitemservice), [`QuestionService`](#questionservice), [`RoomService`](#roomservice), [`SponsorService`](#sponsorservice), and [`ActivityService`](#activityservice) (`MMCA.ADC.Conference.UI/Services/Events/EventService.cs:15`, `Services/SessionService.cs:10`, `Services/SpeakerService.cs:13`, `Services/ConferenceCategoryService.cs:10`, `Services/CategoryItemService.cs:10`, `Services/QuestionService.cs:10`, `Services/RoomService.cs:14`, `Services/SponsorService.cs:10`, `Services/ActivityService.cs:10`). They inherit `GetAllAsync`/`GetPagedAsync`/`GetByIdAsync`/`AddAsync`/`UpdateAsync`/`DeleteAsync` and only *add* the handful of bespoke verbs the conference needs. Six add nothing at all: `ActivityService`, `SponsorService`, `SessionService`, `QuestionService`, `CategoryItemService`, and `ConferenceCategoryService` are fourteen-line files whose entire job is to bind an endpoint name to a DTO and an identifier alias, and their interfaces ([`IActivityUIService`](#iactivityuiservice) at `Services/IActivityUIService.cs:9`, [`ISponsorUIService`](#isponsoruiservice) at `Services/ISponsorUIService.cs:9`, and siblings) are equally empty extensions of the generic contract.

Three services show where extension goes. `EventService` layers `PublishAsync`, `UnpublishAsync`, `RefreshFromSessionizeAsync`, and `RefreshFromSessionizeWithCodeAsync` onto the inherited CRUD (`Services/EventService.cs:19`, `:31`, `:43`, `:53`). The first two carry the loaded row version as an `If-Match` header built by [`ConcurrencyETag`](group-08-auth.md#concurrencyetag) (`Services/EventService.cs:29`, `:41`), so a publish races against a concurrent edit at the API rather than in the browser. The fourth is a small orchestration worth reading: an edited Sessionize code has to be persisted *before* the import runs (the import reads the code off the stored event), and the import rewrites the event's children and refresh stamp, so the method persists, imports, reloads, and hands back both halves as one [`SessionizeRefreshOutcome`](#sessionizerefreshoutcome) (`Services/EventService.cs:61` to `:82`, record at `Services/SessionizeRefreshOutcome.cs:13`). That is the recurring shape: one call, one [`Result`](group-01-result-error-handling.md#result), one failure branch for the page. `RoomService` *overrides* `AddAsync` to reshape the POST body, because the API's `AddRoomRequest` contract names the key `RoomId` while the DTO calls it `Id` (`Services/RoomService.cs:18` to `:38`), and adds a two-argument `DeleteAsync` that passes the owning event on the query string (`Services/RoomService.cs:40`). `SpeakerService` adds `LinkUserAsync`/`UnlinkUserAsync` for binding a speaker record to an identity account (`Services/SpeakerService.cs:17`, `:28`).

Nothing in this layer throws for a server answer. Every call funnels through the framework's [`HttpResultExecutor`](group-15-common-ui-framework.md#httpresultexecutor) and [`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader), so a transport fault and a `ProblemDetails` body both arrive as a failed `Result` with a typed error the page can branch on (`Services/SpeakerLookupService.cs:17` and `:25`, `Services/SessionSelectionService.cs:21` and `:31`, `Services/OrganizerFeedbackService.cs:28` and `:35`). `[Rubric §3, Clean Architecture]` and `[Rubric §9, API & Contract Design]`: the page binds to a DTO contract ([`EventDTO`](group-17-conference-domain.md#eventdto), [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), [`SponsorDTO`](group-17-conference-domain.md#sponsordto), [`ActivityDTO`](group-17-conference-domain.md#activitydto)) plus an interface, and the wire envelope is the uniform [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) / [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt) the API returns for every entity.

## The list pages: two bases, one recipe

Eleven list screens hang off [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto), which supplies server-side paging against `MudDataGrid<T>`, cancellation lifecycle, loading and load-failed state, filter and sort extraction from MudBlazor's `GridState<T>`, toast error surfacing, saved page/rows-per-page/scroll restoration, and viewport-driven mobile rendering that swaps the grid for a [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem). Six derive from it directly, because their rows are not scoped to a conference event: [`EventList`](#eventlist), [`SessionList`](#sessionlist), [`QuestionList`](#questionlist), [`ConferenceCategoryList`](#conferencecategorylist), [`PublicEventList`](#publiceventlist), and [`PublicSessionList`](#publicsessionlist) (`Pages/Event/EventList.razor.cs:16`, `Pages/Session/SessionList.razor.cs:19`, `Pages/Question/QuestionList.razor.cs:11`, `Pages/ConferenceCategory/ConferenceCategoryList.razor.cs:11`, `Pages/Public/PublicEventList.razor.cs:31`, `Pages/Public/PublicSessionList.razor.cs:27`). A concrete page reduces to overriding `Title`, `GridRef`, `SaveFilters`/`RestoreFilters`, and a `LoadServerData` delegate that calls its service's `GetPagedAsync`, with delete-and-confirm delegated to the shared [`ListPageActions`](group-15-common-ui-framework.md#listpageactions) helper.

The other five list pages scope their rows to one conference event, and *that* repetition earned its own ADC-local base: [`EventFilteredListPageBase<TDto>`](#eventfilteredlistpagebasetdto) (`Pages/Common/EventFilteredListPageBase.cs:25`), used by [`RoomList`](#roomlist), [`SpeakerList`](#speakerlist), [`SponsorList`](#sponsorlist), [`ActivityList`](#activitylist), and [`PublicSpeakerList`](#publicspeakerlist) (`Pages/Room/RoomList.razor.cs:12`, `Pages/Speaker/SpeakerList.razor.cs:18`, `Pages/Sponsor/SponsorList.razor.cs:18`, `Pages/Activity/ActivityList.razor.cs:19`, `Pages/Public/PublicSpeakerList.razor.cs:33`). It injects [`IEventLookupService`](#ieventlookupservice) (`Pages/Common/EventFilteredListPageBase.cs:27`), starts the event load before the first `await` of `OnInitializedAsync` and exposes it as `EventsLoadTask` (`:132` to `:144`) because the grid's first `ServerData` call can race ahead of initialization, and gives derived pages `WaitForEventsAsync` and `ApplyEventFilter` to close that race deterministically (`:192`, `:195`, awaited at `Pages/Activity/ActivityList.razor.cs:60` and applied at `:73`). It *seals* `SaveFilters`/`RestoreFilters` and hands pages `SavePageFilters`/`RestorePageFilters` instead (`Pages/Common/EventFilteredListPageBase.cs:86`, `:89`, `:98`, `:110`), so the `eventId` half of the saved state is written once, with the explicit `"all"` sentinel that distinguishes a deliberate clear from no saved state at all (`:105`). Default resolution is one method: a restored id that still exists wins, a dangling one falls back to the live-or-next event computed by [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector), and a page whose scope is *locked* is always pinned to that computed default (`:169` to `:189`, opt-out property at `:57`, overridden by `PublicSpeakerList` to "only privileged readers choose" at `Pages/Public/PublicSpeakerList.razor.cs:53`). Two details are worth internalizing. The event picker renders only once the component is interactive (`Pages/Common/EventFilteredListPageBase.cs:72`): an SSR prerender would paint a fully formed picker into static HTML whose clicks are silently swallowed until the interactive runtime attaches, which under InteractiveAuto's WebAssembly leg is a whole runtime boot later. And a failed lookup is remembered rather than swallowed (`:42`, `:163`), so a page that must fail closed can branch instead of falling through to an unscoped query. `[Rubric §19, State Management & Data Flow]` and `[Rubric §23, Front-End Performance & Rendering]`.

Two public lists deliberately opt out of the grid entirely. [`PublicSponsorList`](#publicsponsorlist) and [`PublicActivityList`](#publicactivitylist) are plain `ComponentBase` pages (`Pages/Public/PublicSponsorList.razor.cs:19`, `Pages/Public/PublicActivityList.razor.cs:20`), because a sponsor roster and a social programme are bounded (both cap the fetch at 200 rows, `Pages/Public/PublicSponsorList.razor.cs:22`, `Pages/Public/PublicActivityList.razor.cs:23`) and render as tier-grouped logo cards and a chronological programme rather than a sortable table, so each fetches one page and orders it in memory (`Pages/Public/PublicSponsorList.razor.cs:88` to `:91`, `Pages/Public/PublicActivityList.razor.cs:87`). `PublicSpeakerList` splits the difference: it keeps the base class's page-based mobile fetch path but *appends* each page to an accumulating list and hangs Common's `InfiniteScrollSentinel` below its card grid, twelve cards per chunk so a full chunk fills whole rows (`Pages/Public/PublicSpeakerList.razor.cs:36`, `:38`).

## Detail pages, form models, and one declaration of the rules

The organizer detail pages share their own ADC-local base, [`DetailPageBase`](#detailpagebase) (`Pages/Common/DetailPageBase.cs:19`), which owns the two things every one of them repeated verbatim: the page-scoped `CancellationTokenSource` with its dispose pattern (`:21`, `:29`, `:56`) and the inline edit-mode lifecycle, `IsEditing`/`IsDirty` plus the `BeginEdit`/`EndEdit` transitions that keep the dirty flag from being left set behind a closed editor (`:32` to `:52`). Four pages inherit it from markup: [`EventDetail`](#eventdetail), [`SessionDetail`](#sessiondetail), [`SpeakerDetail`](#speakerdetail), and [`ConferenceCategoryDetail`](#conferencecategorydetail) (`Pages/Event/EventDetail.razor:6`, code-behind at `Pages/Event/EventDetail.razor.cs:19`), and the dirty flag feeds Common's `UnsavedChangesGuard` directly (`Pages/Event/EventDetail.razor:11`). `[Rubric §24, Forms, Validation & UX Safety]`.

Editable fields are not loose page state. Each entity declares an abstract **form model** carrying its DataAnnotations, and the create page and the detail page's inline editor each bind a sealed subclass of it: [`EventFormModel`](#eventformmodel) with [`EventCreateModel`](#eventcreatemodel) and [`EventEditModel`](#eventeditmodel) (`Pages/Event/EventFormModel.cs:26`, `Pages/Event/EventCreateModel.cs:11`, `Pages/Event/EventEditModel.cs:11`), and the same triad for sessions, speakers, rooms, questions, sponsors, activities, and conference categories ([`SessionFormModel`](#sessionformmodel) `Pages/Session/SessionFormModel.cs:24`, [`SpeakerFormModel`](#speakerformmodel) `Pages/Speaker/SpeakerFormModel.cs:25`, [`RoomFormModel`](#roomformmodel) `Pages/Room/RoomFormModel.cs:24`, [`QuestionFormModel`](#questionformmodel) `Pages/Question/QuestionFormModel.cs:24`, [`SponsorFormModel`](#sponsorformmodel) `Pages/Sponsor/SponsorFormModel.cs:25`, [`ActivityFormModel`](#activityformmodel) `Pages/Activity/ActivityFormModel.cs:25`, [`ConferenceCategoryFormModel`](#conferencecategoryformmodel) `Pages/ConferenceCategory/ConferenceCategoryFormModel.cs:24`). The rules live once: the MudForm fields bridge to the annotations through Common's [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) rather than repeating `Required`/`RequiredError` per field, the length caps come from the DTO's own constants, and every `ErrorMessage` is a resource key resolved by the localizing [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator) ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)) (`Pages/Event/EventFormModel.cs:42` to `:44`). The subclasses own only the direction of travel: `EventCreateModel.ToNew()` builds the posted DTO and always as an unpublished draft, because publishing is a separate gesture on the detail page (`Pages/Event/EventCreateModel.cs:25` to `:42`), while `EventEditModel.LoadFrom(source)` copies the loaded event into the editor in one call and `ToUpdated(source)` writes the edited values over the identity, row version, and published state that were loaded (`Pages/Event/EventEditModel.cs:18`, `:48`). Because both pages bind the same `EventFormFields.razor` component to an instance of the same base, a value the create page accepts is a value the detail page accepts. `[Rubric §1, SOLID]` and `[Rubric §15, Best Practices & Code Quality]`. The one model with no create page to mirror follows the same discipline anyway: [`ConferenceCategoryItemEditModel`](#conferencecategoryitemeditmodel) declares the inline item form's rules against `CategoryItemDTO`'s own length constant (`Pages/ConferenceCategory/ConferenceCategoryItemEditModel.cs:19` to `:31`).

## Container and presentational split, and page-local collaborators

The behaviour-heavy screens do not keep everything in one code-behind: the page stays the *container* (data fetching, filter and paging state, service calls) and hands rendering to *presentational* children that receive parameters and raise callbacks. `PublicSessionList` is the fullest example, splitting into [`PublicSessionListFilterBar`](#publicsessionlistfilterbar) (privileged event picker or locked chip, debounced title search, room picker, All Sessions / My Schedule toggle, share action, `Pages/Public/PublicSessionListFilterBar.razor.cs:15`, parameters from `:25`) and [`PublicSessionListView`](#publicsessionlistview) (the mobile card list, the desktop grid, and the inline bookmark stars, `Pages/Public/PublicSessionListView.razor.cs:26`), which exposes `Grid` and `ReloadAsync` back to the page so the base class's grid plumbing keeps working unchanged. The same split shows up on the category detail page via [`ConferenceCategoryItemsPanel`](#conferencecategoryitemspanel), which owns the item table and its inline add/edit rows and hands the reloaded aggregate back through `CategoryChanged` (`Pages/ConferenceCategory/ConferenceCategoryItemsPanel.razor.cs:21`, `:31`), on the speaker detail page via [`SpeakerCategoryItemsPanel`](#speakercategoryitemspanel) (`Pages/Speaker/SpeakerCategoryItemsPanel.razor.cs:16`), and on the selection dashboard via [`SessionSelectionSpeakerOverlap`](#sessionselectionspeakeroverlap) and [`SessionSelectionAiScores`](#sessionselectionaiscores) (`Pages/SessionSelection/SessionSelectionSpeakerOverlap.razor.cs:11`, `Pages/SessionSelection/SessionSelectionAiScores.razor.cs:12`).

A second, quieter move keeps the code-behinds small: pure logic is lifted out into **page-local collaborators**, plain classes beside the page rather than registered services, each explicitly extracted to keep the component within the `[Rubric §18]` line budget. [`SessionSelectionDisplay`](#sessionselectiondisplay) holds the chip colors and filter predicates the dashboard and its two children share (`Pages/SessionSelection/SessionSelectionDisplay.cs:11`); [`SessionSelectionFilters`](#sessionselectionfilters) holds the five bound filter values and the option lists derived from the loaded board (`Pages/SessionSelection/SessionSelectionFilters.cs:13`, projection in [`SessionSelectionFilterOptions`](#sessionselectionfilteroptions) at `Pages/SessionSelection/SessionSelectionFilterOptions.cs:11`); [`PublicSessionListFilterState`](#publicsessionlistfilterstate) translates that page's filters to and from the persisted string map (`Pages/Public/PublicSessionListFilterState.cs:11`); [`PublicScheduleRoomOptions`](#publicscheduleroomoptions) builds the room picker out of events the page already loaded, so narrowing by room costs no extra fetch, and re-validates the active room against the newly scoped list rather than leaving a filter that matches nothing (`Pages/Public/PublicScheduleRoomOptions.cs:11`, `:37` to `:50`); [`SessionLookups`](#sessionlookups) caches the session detail page's four dictionaries per page instance, re-fetching rooms when the session's event changes (`Pages/Session/SessionLookups.cs:29`, `:43`); [`SpeakerUserSearch`](#speakerusersearch) fans three parallel [`IUserUIService`](group-24-identity-module.md#iuseruiservice) lookups out and unions them, because `GetPagedAsync` ANDs its filters server-side and one call with all three set would return the empty intersection (`Pages/Speaker/SpeakerUserSearch.cs:12`, `:42` to `:44`); [`FeedbackQuestionLoader`](#feedbackquestionloader) pages until `TotalItems` is reached so a feedback report cannot silently truncate, with 100 rows per request and a 20-page runaway guard (`Pages/Feedback/FeedbackQuestionLoader.cs:17`, `:20`, `:26`); and [`ADCHomeContent`](#adchomecontent) holds the landing page's editorial data (`Pages/Home/ADCHomeContent.cs:15`). All of them are testable without rendering anything. `[Rubric §28, Front-End Testing]` and `[Rubric §14, Testability]`.

## Child-and-join entities: a thin POST/DELETE base

Sessions, speakers, and events own *join* relationships (a speaker added to a session, a category item to a speaker) that the generic CRUD base cannot model, because the write carries a *parent* id. These get four near-identical services ([`EventSpeakerService`](#eventspeakerservice), [`SessionSpeakerService`](#sessionspeakerservice), [`SessionCategoryItemService`](#sessioncategoryitemservice), [`SpeakerCategoryItemService`](#speakercategoryitemservice)) over the shared [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase), which was hoisted out of this module into `MMCA.Common.UI` so every consumer module can reuse it (the note is left in place at `Services/ChildEntityServices.cs:89`). Each Conference join service reduces to supplying its endpoint and adding typed `AddAsync`/`DeleteAsync` wrappers over the base's two verbs (`Services/ChildEntityServices.cs:22`, `:35`, `:48`, `:61`), and their four interfaces live together in one file (`Services/IChildEntityUIService.cs:14`, `:26`, `:38`, `:50`). Note the hard-won detail, now enforced by a helper rather than by discipline: the add payload always names the parent explicitly (`new { EventId = eventId, SpeakerId = speakerId }`, `Services/ChildEntityServices.cs:26`), and every removal appends its owning aggregate's id through [`ChildEntityDeletePath`](#childentitydeletepath) (`Services/ChildEntityServices.cs:76`, called at `:29`, `:42`, `:55`, `:68`). The join controllers remove a row by loading the parent aggregate and asking it to drop the child, so a DELETE without the parent binds it to `default`, finds nothing, and answers 404 while the UI reports a generic failure (`Services/ChildEntityServices.cs:14` to `:21`).

## Display-enrichment lookups: the GetAll-vs-GetById populator gap, worked around in the UI

Because the API's list endpoints do not always populate every cross-entity navigation, several pages need a cheap id-to-name map to render speaker names beside a session or an event name beside a room, a sponsor, or an activity. Three lookup services fill that role, [`SpeakerLookupService`](#speakerlookupservice), [`EventLookupService`](#eventlookupservice), and [`CategoryItemLookupService`](#categoryitemlookupservice) (behind [`ISpeakerLookupService`](#ispeakerlookupservice), `IEventLookupService`, and [`ICategoryItemLookupService`](#icategoryitemlookupservice)). Each does one `pageSize=10000` fetch with children and foreign keys suppressed, and folds the result into a `Dictionary` of lightweight projection records, [`SpeakerInfo`](#speakerinfo), [`EventInfo`](#eventinfo), [`CategoryItemInfo`](#categoryiteminfo) (`Services/SpeakerLookupService.cs:12`, fetch at `:22`, fold at `:32`; `Services/EventLookupService.cs:33`; `Services/CategoryItemLookupService.cs:12`). `EventInfo` is the one projection that grew a feature-specific field: `SponsorshipPacketUrl` is an *optional* trailing parameter defaulting to `null` precisely so the many call sites that need only identity and dates stayed unchanged, and only the public sponsor page reads it (`Services/IEventLookupService.cs:14` to `:21`, read at `Pages/Public/PublicSponsorList.razor.cs:62`). This is a deliberate client-side join over the [navigation-populator](group-11-navigation-populators.md) ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)) gap between the API's list and by-id read shapes.

One page needed three of these together, and got a composite rather than three nullable caches and three failure branches: [`SpeakerDetailLookupService`](#speakerdetaillookupservice) gathers the category items, their owning category titles, and the question texts into a single [`SpeakerDetailLookups`](#speakerdetaillookups) record answered as one `Result`, short-circuiting on the first failure (`Services/SpeakerDetailLookupService.cs:11`, `:18` to `:37`, record at `Services/ISpeakerDetailLookupService.cs:13`). The same "one call, one failure branch" instinct produced `SessionizeRefreshOutcome` above and [`SessionLookups`](#sessionlookups) beside the session detail page.

## Three feature areas that go beyond CRUD

First, the **speaker self-service dashboard**. [`SpeakerDashboard`](#speakerdashboard) sits behind a plain `[Authorize]` attribute (`Pages/Speaker/SpeakerDashboard.razor:2`, code-behind at `Pages/Speaker/SpeakerDashboard.razor.cs:21`) and is gated on the `speaker_id` JWT claim, showing the linked speaker's sessions, per-session bookmark counts, and feedback. It leans on [`SpeakerDashboardService`](#speakerdashboardservice) (behind [`ISpeakerDashboardUIService`](#ispeakerdashboarduiservice)), whose session read pushes the speaker filter server-side onto the virtual `SpeakerId` key, caps the page at 100 rows, and appends a per-call cache-bust parameter so this one read is a guaranteed miss against the shared sessions output cache and a just-made assignment shows immediately, while public list reads keep their cache (`Services/SpeakerDashboardService.cs:14`, `:19`, `:35`, `:38`). Its bookmark counts come back from one batched endpoint rather than one hop per session (`Services/SpeakerDashboardService.cs:54`), and it derives from Common's [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) so its calls carry the bearer token and run through the shared retry policy. `[Rubric §12, Performance & Scalability]`.

Second, **organizer feedback moderation** (BR-53). [`OrganizerEventFeedback`](#organizereventfeedback) and [`OrganizerSessionFeedback`](#organizersessionfeedback) let organizers review and delete answers through [`OrganizerEventFeedbackService`](#organizereventfeedbackservice) and [`OrganizerSessionFeedbackService`](#organizersessionfeedbackservice) (`Services/OrganizerFeedbackService.cs:15`, `:66`, behind [`IOrganizerEventFeedbackUIService`](#iorganizereventfeedbackuiservice) and [`IOrganizerSessionFeedbackUIService`](#iorganizersessionfeedbackuiservice) at `Services/IOrganizerFeedbackUIService.cs:11`, `:27`). The read is the unscoped organizer view, capped at 500 answers (`Services/OrganizerFeedbackService.cs:26`), and each delete passes the parent id explicitly on the query string to satisfy the controller's binding (`Services/OrganizerFeedbackService.cs:48`). `[Rubric §11, Security]`: the scoping is server-side and the pages carry `[Authorize(Roles = "Organizer")]` (`Pages/Feedback/OrganizerEventFeedback.razor:2`), not a client-side hide.

Third, **QR self-service**. [`SpeakerQr`](#speakerqr) renders a full-screen code a speaker can hold up at the podium with **no backend call at all**: the speaker comes from the `speaker_id` claim and the payload is built locally, so the page renders identically on the prerender and interactive passes (`Pages/Speaker/SpeakerQr.razor.cs:19`, `:49` to `:55`). The payload is always the absolute public URL from Common's [`IPublicLinkBuilder`](group-15-common-ui-framework.md#ipubliclinkbuilder) (`Pages/Speaker/SpeakerQr.razor.cs:21`, `:55`), never the WebView-internal origin, or a code scanned off the MAUI head would open for nobody else. The framework's `QrCodeButton` puts the same capability on five organizer and public print surfaces: public event detail (`Pages/Public/PublicEventDetail.razor:30`), public session detail (`Pages/Public/PublicSessionDetail.razor:41`), public speaker detail (`Pages/Public/PublicSpeakerDetail.razor:45`), room detail (`Pages/Room/RoomDetail.razor:58`), and sponsor detail (`Pages/Sponsor/SponsorDetail.razor:70`).

## Session-selection decision support, the asynchronous edge

The most behaviour-rich page is the organizer-only [`SessionSelectionDashboard`](#sessionselectiondashboard) (`Pages/SessionSelection/SessionSelectionDashboard.razor:2` carries the `Organizer` role attribute, code-behind at `Pages/SessionSelection/SessionSelectionDashboard.razor.cs:15`), which renders category distribution, speaker overlap, locality breakdown, and AI content-similarity scoring over an event's session pool via [`SessionSelectionService`](#sessionselectionservice) (behind [`ISessionSelectionUIService`](#isessionselectionuiservice)). Every load is stamped with a monotonic **generation** rather than an event id, so switching away from an event and back still discards the first response even though both carry the same id: the generation is snapshotted before the fetch (`Pages/SessionSelection/SessionSelectionDashboard.razor.cs:114`), re-checked before the board is replaced or an error banner is painted (`:127`), and re-checked again before the spinner is cleared (`:151`). Filter options are recomputed from the returned [`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto) itself (`:133` to `:134`). `[Rubric §19, State Management & Data Flow]`.

Scoring is the asynchronous edge. `ScoreSessionsAsync` POSTs to the scoring endpoint with **no retry pipeline**, because starting a run is not idempotent and a retried POST could queue a second run behind the first (`Services/SessionSelectionService.cs:46` to `:48`). Because AI scoring of every eligible session can take minutes, the API runs the [`ScoreEventSessionsCommand`](group-18-conference-application.md#scoreeventsessionscommand) in a background scope and answers `202 Accepted` immediately with no body, so the service reads the status *before* the body reader (which treats a body-less 2xx as a failure) and maps it to a sentinel [`ScoreEventSessionsResultDTO`](group-17-conference-domain.md#scoreeventsessionsresultdto) with `SessionsScored = -1` (`Services/SessionSelectionService.cs:54` to `:57`). The page turns that sentinel, and only that sentinel, into a fire-and-forget polling session, leaving `_isScoring` set for the poll loop to clear while every other branch clears it inline (`Pages/SessionSelection/SessionSelectionDashboard.razor.cs:180` to `:199`).

The loop itself is factored into three pieces, which is the part worth studying. [`ScorePollSession`](#scorepollsession) runs the polling (`Pages/SessionSelection/ScorePollSession.cs:36`, `RunAsync` at `:50`), re-reading the cadence each tick from an `internal` property so a bUnit test can shrink it (`Pages/SessionSelection/SessionSelectionDashboard.razor.cs:203`, read at `Pages/SessionSelection/ScorePollSession.cs:61`) and abandoning the session the moment the page's generation moves (`:62`, `:68`). [`ScorePollHost`](#scorepollhost) is the record of callbacks through which that loop raises its UI side effects, so no rendering decision lives in the loop and none of the loop lives on the component (`Pages/SessionSelection/ScorePollSession.cs:19`, constructed at `Pages/SessionSelection/SessionSelectionDashboard.razor.cs:215` to `:223`). And [`ScorePollTracker`](#scorepolltracker) is the pure state machine that turns each observation into a [`ScorePollSignal`](#scorepollsignal): keep polling, apply-and-continue, all sessions scored, counts stable long enough, or no scores at all within the zero-progress budget (`Pages/SessionSelection/ScorePollTracker.cs:31`, signal enum at `:6`). Its budgets are explicit constants: 225 polls for a 30-minute cap at the 8-second cadence (`:34`), 5 consecutive fetch failures (`:41`), 10 zero-progress polls (`:48`), and 3 stable polls before completion (`:51`). Because the service answers a server error with a failed `Result` rather than an exception, the consecutive-failure budget is fed from the result branch, or a persistently failing endpoint would poll silently to the cap without ever reporting (`Pages/SessionSelection/ScorePollSession.cs:73` to `:82`). `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §29, Resilience]`.

## Public versus authenticated rendering, and the offline-first path

A recurring `[Rubric §11, Security]` pattern: the same conference entity is exposed through *two* page families. No page under `Pages/Public/` carries an `@attribute [Authorize]` at all, and those reads are output-cached at the API; the organizer family gates on the `Organizer` role in markup (`Pages/Event/EventList.razor:2`). `PublicSessionList` shows the nuance well. It is read-only for anonymous users (BR-43), but an authenticated user gets inline bookmark stars and a My Schedule toggle wired through the *optional* [`ISessionBookmarkUIService`](group-22-engagement-module.md#isessionbookmarkuiservice); because Blazor's `[Inject]` has no optional mode (an unregistered service throws at render), the page declares that dependency as a nullable property and resolves it via `IServiceProvider.GetService`, so it stays null when the Engagement module is disabled (`Pages/Public/PublicSessionList.razor.cs:38`, `:86`). `[Rubric §7, Microservices Readiness]`. Non-privileged readers are always locked server-side to the computed current or next event via [`CurrentEventDefaults`](group-17-conference-domain.md#currenteventdefaults) and the privileged-reader list [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience), so a shared organizer URL cannot pin an attendee to a different or unpublished event (`Pages/Public/PublicSessionList.razor.cs:121`, `:154` to `:169`), and the same rule decides whether the event choice is persisted at all (`Pages/Public/PublicSessionListFilterState.cs:22` to `:43`).

The offline-first behaviour that used to sit in the page now lives behind an interface. [`IPublicSessionScheduleService`](#ipublicsessionscheduleservice) / [`PublicSessionScheduleService`](#publicsessionscheduleservice) run the live paged query and compose it with the framework's [`OfflineFirstPageSnapshot<TItem>`](group-15-common-ui-framework.md#offlinefirstpagesnapshottitem), keeping the last successful *first* page in the device-local cache so a dead venue network still shows a programme ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 3, `Services/IPublicSessionScheduleService.cs:34`, `Services/PublicSessionScheduleService.cs:17`, snapshot at `:28`, cache key at `:26`). The live path is never altered: the snapshot is consulted only when a fetch fails, a failure with nothing cached travels on to the grid's own handling unchanged, and the page owns only the "showing cached data" banner it raises through a callback (`Services/PublicSessionScheduleService.cs:37` to `:62`, banner at `Pages/Public/PublicSessionList.razor.cs:296`). One page request is one [`SessionSchedulePageRequest`](#sessionschedulepagerequest) (`Services/IPublicSessionScheduleService.cs:20`), and My Schedule rides it as a set of bookmarked ids that scope the query server-side with an `Id IN (...)` filter rather than over-fetching and filtering in memory (`Services/PublicSessionScheduleService.cs:76` to `:81`); an empty schedule short-circuits before the service is reached, so it can never overwrite the cached programme with nothing (`Pages/Public/PublicSessionList.razor.cs:269` to `:272`).

The rest of the device-capability layer ([G26](group-26-device-capability-layer.md)) shows up as injected interfaces that no-op on the web heads: the star toggle fires [`IHapticFeedbackService`](group-26-device-capability-layer.md#ihapticfeedbackservice) (`Pages/Public/PublicSessionListView.razor.cs:29`), the filter bar shares a schedule screenshot through [`IScreenshotService`](group-26-device-capability-layer.md#iscreenshotservice) and [`IShareService`](group-26-device-capability-layer.md#ishareservice) (`Pages/Public/PublicSessionListFilterBar.razor.cs:17`, `:18`), the public activity page opens directions through [`IMapNavigationService`](group-26-device-capability-layer.md#imapnavigationservice) (`Pages/Public/PublicActivityList.razor.cs:29`), and `/conference/sessions?mine=true` is a deep link the MAUI head's home-screen quick action targets, which beats the saved page state when present (`Pages/Public/PublicSessionList.razor.cs:66`, `:89`). `[Rubric §29, Resilience]` and `[Rubric §22, Responsive & Cross-Browser/Device]`.

## Sponsors and activities, two feature areas in miniature

The sponsor surface is a compact tour of every pattern above. Organizers manage the roster through [`SponsorList`](#sponsorlist) / [`SponsorCreate`](#sponsorcreate) / [`SponsorDetail`](#sponsordetail): the list is an `EventFilteredListPageBase<SponsorDTO>` that inherits the default-event resolution and persistence wholesale (`Pages/Sponsor/SponsorList.razor.cs:18`, `:38` to `:47`), and the detail page edits every field *except* the owning event, on the stated rationale that moving a sponsorship between events is a create plus a delete (`Pages/Sponsor/SponsorDetail.razor.cs:13` to `:18`). Attendees see the same data twice. `PublicSponsorList` resolves the featured event, filters the roster to it, and groups by [`SponsorTier`](group-17-conference-domain.md#sponsortier) ascending (package order) then by `Sort` and name, so the render order is deterministic rather than insertion-dependent (`Pages/Public/PublicSponsorList.razor.cs:88` to `:91`); when the event publishes no packet URL the sponsorship call to action is hidden entirely rather than offering a dead link (`Pages/Public/PublicSponsorList.razor.cs:62`). [`ADCHome`](#adchome) renders the same roster as a logo strip under the same tier-then-sort-then-name rule, filtering client-side to the featured event so a second published edition's sponsors cannot bleed onto the landing page (`Pages/Home/ADCHome.razor.cs:224` to `:233`, event filter at `:227`), and any failure leaves the strip empty and the call to action standing (`Pages/Home/ADCHome.razor.cs:235` to `:242`). Because that page reads the anonymous endpoint directly rather than through a typed service, its wire shapes are private records on the component itself: [`ADCSponsorCollectionResult`](#adcsponsorcollectionresult) and [`ADCSponsorInfo`](#adcsponsorinfo) (`Pages/Home/ADCHome.razor.cs:303`, `:305`).

The activities area (the social programme: pre-conference party, coffee connect, after-party, closing ceremony) repeats the shape with two twists. [`ActivityCreate`](#activitycreate), [`ActivityDetail`](#activitydetail), and `ActivityList` are the organizer trio, with the create page defaulting the owning event to the current or next one through `CurrentEventSelector` (`Pages/Activity/ActivityCreate.razor.cs:61`). Because `EventId` is a real Activity column, the list's event filter needs no virtual-key resolution and goes straight through the base class's `ApplyEventFilter` (`Pages/Activity/ActivityList.razor.cs:73`), unlike the speaker list, whose event filter travels as a virtual key resolved server-side through the join tables (`Pages/Public/PublicSpeakerList.razor.cs:19` to `:20`). `PublicActivityList` renders the same programme chronologically for attendees, ordering by start time first so ties are deterministic (`Pages/Public/PublicActivityList.razor.cs:87`), and offers the directions affordance for an activity that carries its own off-site venue.

## The landing page

`ADCHome` is the conference front door, shared by the web and MAUI heads; both serve the editorial images from their own site root today, so neither overrides the `ImageBasePath` parameter (`Pages/Home/ADCHome.razor.cs:17`, `:50`). It fetches the events list through the named `"APIClient"` and features the live-or-next published event via `CurrentEventSelector` (`Pages/Home/ADCHome.razor.cs:175`, `:179`), deserializing into two more private API models, [`ADCCollectionResult`](#adccollectionresult) and [`ADCEventInfo`](#adceventinfo) (`Pages/Home/ADCHome.razor.cs:289`, `:291`). Three rendering decisions are worth internalizing. First, during SSR prerender it skips the backend fetch and the timer entirely and renders the static fallback, because an untimed server-side call to a cold backend would block the prerender and therefore the post-login navigation (`Pages/Home/ADCHome.razor.cs:115` to `:120`). Second, the per-second countdown ticking lives in a child component behind a render fence, so this page arms only a single one-shot timer for the Live-to-Ended flip (`Pages/Home/ADCHome.razor.cs:125` to `:127`), classifying the moment into the [`EventPhase`](#eventphase) enum Upcoming/Live/Ended from the event's own time zone and going through `CurrentEventSelector.ToUtc` so the spring-forward gap at a midnight boundary cannot throw out of the render path (`Pages/Home/ADCHome.razor.cs:245` to `:267`). Third, the fallback date is a named constant with an explicit warning that it must track the published event date, since a stale value makes the hero date and the countdown visibly jump once the real event loads (`Pages/Home/ADCHome.razor.cs:39`). `[Rubric §23, Front-End Performance & Rendering]`. The editorial content it renders (the keynote, the eight-track catalog, and the two pre-conference workshops) is held as static records in `ADCHomeContent`: [`KeynoteSpeakerInfo`](#keynotespeakerinfo), [`ConferenceTrackInfo`](#conferencetrackinfo), and [`PreConferenceWorkshopInfo`](#preconferenceworkshopinfo) (`Pages/Home/ADCHomeContent.cs:73`, `:81`, `:88`, data at `:18`, `:34`, and `:59`); the workshop record carries only proper nouns plus a resource-key stem, so its audience and description lines stay localized (`Pages/Home/ADCHomeContent.cs:83` to `:88`).

## Routes, navigation, and localized strings

All paths are centralized in [`ConferenceRoutePaths`](#conferenceroutepaths), a static catalogue of literal routes and id-parameterized builder methods (`EventDetails(id)`, `PublicSessionDetails(id)`, `SponsorDetails(id)`, `ActivityDetails(id)`, `EventFeedbackOrganizer(id)`, and so on) typed against the module's identifier aliases and formatted culture-invariantly, so a route change happens in one file (`MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:8` to `:69`). Two entries in that file are deliberate duplicates of routes **owned by Engagement.UI**, `SponsorVisitLink` and `RoomCheckInLink` (`ConferenceRoutePaths.cs:60`, `:61`), because Conference.UI must not reference Engagement.UI yet the organizer print surfaces need those links to encode into a QR; the reason is recorded inline at `ConferenceRoutePaths.cs:56` to `:59`. `[Rubric §25, Navigation, Routing & Information Architecture]`. User-facing strings are **not** inline English: every page injects an `IStringLocalizer<TPage>` in its markup (`Pages/Event/EventList.razor:5`) and resolves labels and snackbar messages through `L["..."]` over co-located `.resx` resource pairs, including format patterns such as the hero date layout so month names follow the selected culture (`Pages/Home/ADCHome.razor.cs:276`). Where a string is deliberately left untranslated (the conference brand name, a postal address, a ticketing URL, the English-only editorial content) the code carries an explicit `// i18n: allow` marker with a reason (`Pages/Home/ADCHome.razor.cs:30`, `:78`, `:82`, `Pages/Home/ADCHomeContent.cs:10` to `:13`). `[Rubric §27, Internationalization & Localization]` assesses externalized strings and culture-aware formatting; this area embodies it under [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html), which superseded the single-locale [ADR-011](https://ivanball.github.io/docs/adr/011-single-locale-i18n.html) ([primer §6](00-primer.md#6-the-34-category-architecture-evaluation-lens)).

## How it all plugs into the shell

Two registration types wire the area in. [`ConferenceUIModule`](#conferenceuimodule) implements Common's [`IUIModule`](group-15-common-ui-framework.md#iuimodule) (the front-end counterpart of the [`IModule`](group-14-module-system-composition.md#imodule) back-end contract): it declares the module's sixteen [`NavItem`](group-15-common-ui-framework.md#navitem) entries, whose labels are resource *keys* (`Nav.Events`, `Nav.Dashboard`, and so on) resolved by the shared NavMenu at render time against the co-located `ConferenceUIModule.resx` pair (`MMCA.ADC.Conference.UI/ConferenceUIModule.cs:14`, `:16` to `:18`). Those sixteen split three ways: five public entries for everyone, Events, Sessions, Speakers, Sponsors, and Activities (`ConferenceUIModule.cs:21` to `:25`), two `speaker_id`-claim-gated entries in the user section, the dashboard and the speaker's own QR (`ConferenceUIModule.cs:28`, `:29`), and an `Organizer`-role-gated admin group of nine, Events, Sessions, Speakers, Categories, Questions, Rooms, Sponsors, Activities, and Session Selection (`ConferenceUIModule.cs:32` to `:40`); it then exposes its assembly so the host can discover the Razor routes (`ConferenceUIModule.cs:43`).

The companion [`DependencyInjection`](#dependencyinjection) extension `AddConferenceUI()` (a C# `extension(IServiceCollection)` member, [primer §4](00-primer.md#c-extensiont-types-read-this-once)) is the one call a host makes (`MMCA.ADC.Conference.UI/DependencyInjection.cs:17`, `:19`). It delegates the prologue to Common's `AddUIModule<ConferenceUIModule>()`, which scans the module assembly for every `IEntityService<,>` implementation as scoped and registers the descriptor as a singleton `IUIModule` (`DependencyInjection.cs:23`), then explicitly registers what a scan cannot infer: the four child-entity services (`:26` to `:29`), the speaker dashboard (`:32`), the two organizer feedback services (`:35`, `:36`), session selection (`:39`), the offline-first schedule service (`:42`), the three lookup services (`:45` to `:47`), and the composite speaker-detail lookup (`:51`). Public share links are *not* registered here: `IPublicLinkBuilder` comes from the framework's own `AddUIShared`, and the MAUI head overrides that registration afterwards so shared links always point at the web app, a note left in place where the registration used to be (`DependencyInjection.cs:53` to `:56`). Because the scan covers the entity services, adding a tenth CRUD entity needs no edit in this file at all, and because the module contributes its own nav and assembly, the shell folds it in with no edit to the shell either. `[Rubric §1, SOLID]` (Open/Closed) and `[Rubric §18, UI Architecture]`. Read the per-type sections that follow for the mechanics of each page, model, and service; the bUnit and Playwright tests that exercise this library live in the testing chapter ([G27](group-27-testing-infrastructure.md)).

### ADCEventInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:291` · Level 0 · record (sealed, private)

- **What it is**: the deserialization-only projection of one published event as the landing page needs it. It is declared `private sealed record` inside [ADCHome](#adchome) (`:291`), so it is not a shared contract: it exists purely to give `System.Text.Json` a shape to bind the `events` response into.
- **Depends on**: no first-party types. BCL only (`DateOnly` for the two dates).
- **Concept introduced: the page-local wire model.** [Rubric §9, API and Contract Design] assesses whether consumers bind to explicit, minimal contracts rather than reaching for the server's internal types. The landing page needs ten fields (`Id`, `Name`, `Description?`, `StartDate`, `EndDate`, `TimeZone`, `VenueAddress?`, `VenueMapUrl?`, `SponsorshipPacketUrl?`, `TicketingUrl?`, `:291-301`) out of the much larger event DTO the API serves, so it declares exactly those and lets the serializer ignore the rest. Because the record is private to the component, no other page can accidentally couple to it; a second consumer declares its own projection. Every optional field is nullable, which is what lets the page fall back to hard-coded defaults without null checks scattered through the markup.
- **Walkthrough**: a positional record with no methods. `Name` feeds the `EventName` property and therefore `HeroTitleParts()` (`:78`, `:92`); `Description` feeds `EventDescription`, falling back to the localized `Fallback.EventDescription` resource (`:80`); `StartDate`/`EndDate`/`TimeZone` are the three inputs `UpdateCountdown()` converts into the UTC live window (`:247-259`); `VenueAddress` backs the venue block and the Google Maps search URL (`:82-85`); `Id` is the filter key that keeps a second published edition's sponsors off the page (`:227`); `SponsorshipPacketUrl` gates the whole sponsorship call to action block, heading and button included (`MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor:315-334`); `TicketingUrl` gates the hero's "get tickets" button the same way (`ADCHome.razor:71-79`), so an event that has not opened sales renders no button rather than a dead link.
- **Why it's built this way**: the page must render before, during, and after the API call, so it stores a single nullable `ADCEventInfo? _event` (`:64`) and every derived property is written as `_event?.X ?? <default>`. One nullable field is the whole "loaded or not" state machine, with no extra flags. The two ticketing surfaces sit on opposite sides of that line: the conference-day button reads the event field, while the pre-conference workshop button reads the fixed `PreConferenceTicketingUrl` constant (`:29-30`), because the workshop day sells through its own TicketLeap page.
- **Where it's used**: the `Items` list of [ADCCollectionResult](#adccollectionresult) (`:289`), selected by `CurrentEventSelector.SelectCurrentOrNext` in `LoadEventAsync` (`:179-184`), used as the sponsor filter key in `LoadSponsorsAsync` (`:212`, `:227`), and read by every derived display property on [ADCHome](#adchome).
- **Caveats / not-in-source**: `VenueMapUrl` is bound from the wire (`:299`) but never read by this page: the map button builds its own Google Maps search URL from `VenueAddress` instead (`:84-85`, `ADCHome.razor:358-368`). The field is a real event column, displayed on the organizer event page (`MMCA.ADC.Conference.UI/Pages/Event/EventDetail.razor:90`). Why the landing page projects it without using it is not determinable from source.

### ConferenceRoutePaths
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI` · `MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:8` · Level 0 · class (static)

- **What it is**: one static class holding every Conference UI route, as `public static readonly string` constants for fixed paths and small factory methods for id-bearing paths. It covers the organizer management routes, the public attendee routes, the speaker surfaces, and the two QR landing links, so no `@page` directive or `NavigateTo` call has to hard-code a URL.
- **Depends on**: no first-party types. It uses the module's identifier aliases (`EventIdentifierType`, `SessionIdentifierType`, `SpeakerIdentifierType`, `ConferenceCategoryIdentifierType`, `QuestionIdentifierType`, `RoomIdentifierType`, `SponsorIdentifierType`, `ActivityIdentifierType`) that the Conference Shared project declares as `global using` (see the primer on identifier-type aliases, and [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)), plus `System.Globalization.CultureInfo` (`:1`).
- **Concept introduced: a centralized navigation vocabulary.** [Rubric §25, Navigation and Information Architecture] assesses whether routes form a coherent, role-aware information architecture instead of scattered magic strings; this class is that story in miniature. The paths split into two deliberate namespaces mirroring the module's two audiences: organizers work under bare prefixes (`/events` `:10`, `/sessions` `:14`, `/speakers` `:18`, `/conferencecategories` `:22`, `/questions` `:26`, `/rooms` `:30`, `/sponsors` `:34`, `/activities` `:38`) while attendees work under a `/conference/...` prefix (`PublicSessions` `:43`, `PublicEvents` `:44`, `PublicSpeakers` `:47`, `PublicSponsors` `:49`, `PublicActivities` `:50`). Detail routes are methods rather than constants because they interpolate a typed id: `EventDetails(EventIdentifierType id)` (`:12`) builds `/events/{id}` with `string.Create(CultureInfo.InvariantCulture, ...)` so an integer id can never be formatted with a culture-specific group separator. [Rubric §27, Internationalization] shows up here as the negative case: URLs are the one place culture-aware formatting must be suppressed.
- **Walkthrough**: the file is a flat list grouped by entity, each group contributing a list route, a create route, and a details factory: events (`:10-12`), sessions (`:14-16`), speakers (`:18-20`), conference categories (`:22-24`), questions (`:26-28`), rooms (`:30-32`), sponsors (`:34-36`), activities (`:38-40`). The public attendee block follows (`:42-50`), and it carries two detail factories of its own, `PublicEventDetails` (`:45`) and `PublicSessionDetails` (`:46`), so an attendee-facing deep link never borrows an organizer route. Then the speaker surfaces `SpeakerDashboard` and `SpeakerQr` (`:53-54`), the two QR self-service links, the organizer feedback factories, and the selection dashboard.
  - **The two QR links are deliberate duplicates** (`:60-61`). `SponsorVisitLink` and `RoomCheckInLink` build `/engage/sponsors/{id}` and `/engage/rooms/{id}`, but those two pages are owned by Engagement.UI. The comment (`:56-59`) records the reason: Conference.UI must not reference Engagement.UI, yet the organizer print surfaces need the URL to encode into a QR code, and [EngagementRoutePaths](group-22-engagement-module.md#engagementroutepaths) duplicates a Conference session route the same way. Both are consumed by a `QrCodeButton` on the sponsor and room detail pages (`MMCA.ADC.Conference.UI/Pages/Sponsor/SponsorDetail.razor:70`, `MMCA.ADC.Conference.UI/Pages/Room/RoomDetail.razor:58`).
  - **Feedback routes nest under their parent entity**: `EventFeedbackOrganizer` gives `/events/{id}/feedback` and `SessionFeedbackOrganizer` gives `/sessions/{id}/feedback` (`:64-65`), so the URL itself expresses the ownership hierarchy. `SessionSelectionDashboard` closes the file (`:68`).
  - Two factories differ from the rest: `SpeakerDetails` (`:20`) and `PublicSpeakerDetails` (`:48`) use plain interpolation rather than `string.Create(CultureInfo.InvariantCulture, ...)`, because `SpeakerIdentifierType` is a `Guid` whose `ToString()` is already culture-invariant.
- **Why it's built this way**: if the admin prefix ever moves (say `/events` becomes `/admin/events`), editing the one constant propagates the change to every navigation call, with no grep-and-replace and no risk of a stale link. Keeping the parameterized routes as methods typed against the identifier aliases means a wrong-entity id is a compile error, not a 404.
- **Where it's used**: every Conference UI Blazor page's `@page` directive and `NavigationManager.NavigateTo` call, the "see all sponsors" link on the landing page (`ADCHome.razor:308`), the `NavItems` collection in [ConferenceUIModule](#conferenceuimodule) (`ConferenceUIModule.cs:21-40`), and even one Engagement page, which links back to `PublicSponsors` (`MMCA.ADC.Engagement.UI/Pages/Sponsors/SponsorVisit.razor:42`).

### ConferenceTrackInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHomeContent.cs:81` · Level 0 · record (sealed, internal)

- **What it is**: one row of the landing page's track catalogue: a track `Name`, an `Icon` (a MudBlazor icon path constant), and a `Topics` string listing the track's subject areas (`:81`).
- **Depends on**: no first-party types. The `Icon` values are MudBlazor `Icons.Material.Filled.*` constants (external, imported at `:1`).
- **Concept introduced**: this is one of three static-content records held by [ADCHomeContent](#adchomecontent); the two-tier content model is taught under [KeynoteSpeakerInfo](#keynotespeakerinfo) and reused by [PreConferenceWorkshopInfo](#preconferenceworkshopinfo).
- **Walkthrough**: a three-property positional record. The whole catalogue is the `ADCHomeContent.Tracks` property, an `IReadOnlyList<ConferenceTrackInfo>` initialized inline as a collection expression (`:34-52`) with eight entries (`:36`, `:38`, `:40`, `:42`, `:44`, `:46`, `:48`, `:50`), each spanning two lines: the track name and its icon constant on the first, the topics blurb on the second. They run from "Foundations (Beginner & Student)" (`:36-37`) to "Career, Leadership & Community" (`:50-51`), with the two AI tracks, languages, web/mobile/cross-platform, security, and game/XR in between. Every `Icon` is a MudBlazor `Icons.Material.Filled.*` constant picked per track (`School`, `Psychology`, `AutoAwesome`, `Code`, `Devices`, `Security`, `SportsEsports`, `Groups`). Storing the icon as a `string` (rather than a `RenderFragment` or an enum) is what keeps the record a plain data type: the markup passes it straight to `<MudIcon Icon="@track.Icon">` (`ADCHome.razor:241`).
- **Why it's built this way**: the track list changes once per conference cycle and is editorial rather than transactional, so it lives in the assembly instead of behind an API call or a CMS; the remark on [ADCHomeContent](#adchomecontent) names the track catalog alongside the keynote bio as deliberately English-only editorial content, with the localized chrome around it (`:10-14`). The collection is a get-only static property, so it is initialized once per process, not per render.
- **Where it's used**: `ADCHomeContent.Tracks` (`:34`), rendered as the track grid in `ADCHome.razor` (`:233-250`): one `MudItem`/`MudCard` per entry, keyed by `track.Name` (`ADCHome.razor:236`), showing the icon (`:241`), the name (`:243`), and the topics line (`:245`).

### DetailPageBase
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Common` · `MMCA.ADC.Conference.UI/Pages/Common/DetailPageBase.cs:19` · Level 0 · class (abstract)

- **What it is**: the base class every Conference detail page inherits (one aggregate, loaded by route id, edited inline). It owns exactly two things the four detail pages used to repeat verbatim: a page-scoped `CancellationTokenSource` with its dispose pattern, and the inline edit-mode lifecycle (`IsEditing` / `IsDirty` plus the enter and leave transitions the unsaved-changes guard reads).
- **Depends on**: `Microsoft.AspNetCore.Components.ComponentBase` and `IDisposable` only (`:1`, `:19`). It deliberately depends on nothing from `MMCA.Common.UI`.
- **Concept introduced: the application-local page base, and why it is not framework code.** [Rubric §3, Clean Architecture] assesses whether the direction of dependencies matches the direction of stability; the class remark makes the call explicitly (`:12-18`): the detail-page shape is an *application convention*, not framework plumbing, and it builds on nothing MMCA.Common would have to know about, so it stays in ADC rather than being pushed up into the shared UI package. That is the mirror image of the list-page decision one level down, where the grid plumbing genuinely is framework code and lives in [DataGridListPageBase<TDto>](group-15-common-ui-framework.md#datagridlistpagebasetdto). [Rubric §1, SOLID] is the other half: a derived page keeps only what differs per aggregate (which fields it copies into its edit model, and what a save posts) and inherits the parts that cannot vary.
  The second idea worth naming is the **page-scoped cancellation token**. `PageToken` (`:29`) is handed to every awaited call the page makes, so navigating away, or an `InteractiveAuto` render-mode transition swapping the component out, cancels the in-flight work instead of completing into a component that is gone. That is a correctness property, not an optimization: a completion landing on a disposed component is where "collection was modified" and lost-render bugs come from.
- **Walkthrough**:
  - **State** (`:21-22`): a `readonly CancellationTokenSource _cts` created at construction, and a `_disposed` idempotency flag.
  - **`PageToken`** (`:29`): `protected`, exposing only the token, never the source, so a derived page can pass it but cannot cancel or dispose it out from under the base.
  - **`IsEditing` / `IsDirty`** (`:32`, `:35`): both `protected` with `private set`, so only the three transition methods below can move them. A derived page reads them, and its markup binds the guard to `IsDirty`.
  - **`MarkDirty()`** (`:38`): the one-line setter bound to every editable field's `@bind-Value:after`, which is what makes "the reader typed something" a single well-defined event rather than a per-field comparison.
  - **`BeginEdit()`** (`:41-45`) and **`EndEdit()`** (`:48-52`): open the editor on a clean slate, and close it clearing the dirty flag. The class remark states the invariant these two exist to protect (`:15-17`): the dirty flag can never be left set behind a closed editor, which would otherwise strand the reader behind a navigation prompt with nothing to save.
  - **`Dispose(bool)` / `Dispose()`** (`:56-77`): the standard disposable pattern, guarded on `_disposed`, cancelling then disposing the source and calling `GC.SuppressFinalize(this)`. Cancel-before-dispose is the ordering that lets awaiting callers observe an `OperationCanceledException` rather than an `ObjectDisposedException`.
- **Why it's built this way**: [Rubric §24, Forms, Validation and UX Safety] assesses whether a user can lose work by accident. The guard component consumes the flag directly (`MMCA.ADC.Conference.UI/Pages/Event/EventDetail.razor:11` binds both `IsDirty` and an `IsDirtyAccessor` lambda), so the "are you sure" prompt is driven by one flag with exactly three writers rather than by per-page bookkeeping. [Rubric §15, Best Practices & Code Quality]: the cost of adding a fifth detail page is an `@inherits` line and two calls, not a re-implementation of the token and the flag.
- **Where it's used**: the four Conference detail pages, each through an `@inherits` directive: `MMCA.ADC.Conference.UI/Pages/Event/EventDetail.razor:6`, `MMCA.ADC.Conference.UI/Pages/Session/SessionDetail.razor:6`, `MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerDetail.razor:8`, and `MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryDetail.razor:3`. [EventDetail](#eventdetail) shows the full usage: `PageToken` on every service call (`EventDetail.razor.cs:86`, `:156`, `:163`, `:206-207`, `:214`, `:247`, `:283`), `BeginEdit()` when the editor opens (`:120`), and `EndEdit()` on both cancel (`:123`) and successful save (`:173`).

### EventPhase
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:71` · Level 0 · enum (private)

- **What it is**: the three-state classification of the featured event relative to now: `Upcoming`, `Live`, `Ended` (`:71-76`). It is the single switch the landing page's hero renders from.
- **Depends on**: nothing.
- **Concept introduced: deriving a render state from a clock instead of storing it.** [Rubric §19, State Management and Data Flow] assesses whether UI state is derived from a single source of truth or duplicated into flags. There is no `IsLive` boolean anywhere on the page: `UpdateCountdown()` recomputes `_phase` from `DateTime.UtcNow` against the converted UTC window every time it runs (`:261-267`), and the markup branches on that one field. Recomputing rather than storing means a stale phase is impossible after a timer callback, a parameter change, or the interactive render pass that follows prerender.
- **Walkthrough**: the assignment is a switch expression over `now` (`:262-267`): `now < _startUtc` gives `Upcoming`, `now < _endUtc` gives `Live`, anything later gives `Ended`. `ArmPhaseTimerForEventEnd()` reads it as its guard, returning immediately unless the phase is `Live` (`:144-147`), which is what makes the Live-to-Ended timer a single one-shot rather than a recurring tick. In the markup the loading branch comes first (`ADCHome.razor:32-35`, a `PageLoadingState` while `_isLoading`), then `Upcoming` renders the `HomeCountdown` child (`ADCHome.razor:36-41`), `Live` renders the "event live" chip plus a button to `/happening-now` (`ADCHome.razor:42-56`), and `Ended` renders the post-event chip (`ADCHome.razor:57-65`). The hero's ticketing button sits outside that branch (`ADCHome.razor:67-80`), so it shows in every phase the event publishes a URL.
- **Why it's built this way**: three named states read far better at the call site than nested date comparisons, and keeping the enum private to the component signals it is a view concern, not a domain concept. The domain's own notion of a live window lives server-side and in [CurrentEventSelector](group-17-conference-domain.md#currenteventselector).
- **Where it's used**: the `_phase` field on [ADCHome](#adchome) (`:63`) and its Razor markup only.

### KeynoteSpeakerInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHomeContent.cs:73` · Level 0 · record (sealed, internal)

- **What it is**: the keynote block's content: the speaker's `Name`, `Title` (their role), the `TalkTitle`, an optional `PhotoFileName`, and `BioParagraphs` as an `IReadOnlyList<string>` (`:73-78`).
- **Depends on**: no first-party types. BCL only.
- **Concept introduced: the two-tier content model of a landing page.** The page splits its content into *dynamic* data fetched from the API (dates, venue, name, ticketing link, sponsors, via [ADCEventInfo](#adceventinfo) and [ADCSponsorInfo](#adcsponsorinfo)) and *editorial* data compiled into the assembly (keynote, tracks, and workshops, held by [ADCHomeContent](#adchomecontent) as this record and its siblings [ConferenceTrackInfo](#conferencetrackinfo) and [PreConferenceWorkshopInfo](#preconferenceworkshopinfo)). [Rubric §23, Front-End Performance and Rendering] is the payoff: the keynote, the workshop cards, and the track grid render on the first frame with zero network dependency, so a cold or unreachable backend degrades only the countdown, the hero ticketing button, and the sponsor strip, never the page. [Rubric §27, Internationalization] is the deliberate exception: the holder class carries a written remark recording that this English-only editorial content is the same copy the API would serve, while the chrome around it is localized instead (`:10-14`). That convention is how [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) distinguishes "not yet translated" from "intentionally untranslated".
- **Walkthrough**: a five-property positional record. The single instance is the get-only `ADCHomeContent.Keynote` property, initialized inline (`:18-31`): Jared Rhodes, "Microsoft MVP and Principal Engineer", the talk "More Software, Different Work", `PhotoFileName: "jared-rhodes.webp"` (`:26`), and a three-paragraph abstract (`:28-30`). `BioParagraphs` is a list rather than one string so the template can emit each paragraph in its own element instead of relying on whitespace preservation (`ADCHome.razor:203-206`). The record carries only the portrait's *file name*, not a path: the usable `src` is composed from the head-specific `ImageBasePath` parameter through `KeynoteImageSrc`, which returns `$"{ImageBasePath}/speakers/{fileName}"` or `null` when no file name is supplied (`ADCHome.razor.cs:56-57`). That split exists because a head could package its assets elsewhere, and the `null` case is still guarded in the markup so the card renders name and title without a portrait (`ADCHome.razor:179-192`).
- **Why it's built this way**: the keynote changes once per conference cycle, so a database round-trip and an admin screen would be pure overhead. The image choice is the interesting half. The comment above the file name (`:22-25`) records that the shipped asset is a WebP derivative sized to the display resolution, 640px square against a 300px CSS frame so it still has headroom at 2x device pixel ratio, weighing 17 KB against 306 KB for the 2048px source JPEG, and that because both hosts resolve it through `ImageBasePath` the file must ship in *both* wwwroots (the Web client and the MAUI head). The original JPEG stays in the repo as the re-encode source. The markup adds `loading="lazy"` with the reason inline (`ADCHome.razor:182-184`): the keynote sits below the hero, so it is never the largest-contentful-paint element, and `MudImage` splats unmatched attributes onto the rendered `img`, so the hint actually reaches the DOM. Both are [Rubric §23, Front-End Performance and Rendering] in the small.
- **Where it's used**: `ADCHomeContent.Keynote` (`:18`), read by `ADCHome.KeynoteImageSrc` (`ADCHome.razor.cs:56-57`) and rendered in the keynote section of `ADCHome.razor` (`:163-211`): the portrait (`:185-190`), the alt text and name (`:186`, `:193`), the role (`:195`), the talk title (`:202`), and the paragraphs (`:203-206`).

### PreConferenceWorkshopInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHomeContent.cs:88` · Level 0 · record (sealed, internal)

- **What it is**: one pre-conference workshop card: a resource-key stem `Key`, the workshop `Title`, the `Presenter` name, and an `Icon` (`:88`). Two instances make up the whole workshops section.
- **Depends on**: no first-party types. The `Icon` values are MudBlazor `Icons.Material.Filled.*` constants (external).
- **Concept introduced: the half-localized content record.** [Rubric §27, Internationalization] assesses whether user-facing text resolves through resources rather than sitting in code, and this record is the interesting middle case that the other two content records do not show. Instead of choosing "all in code" or "all in resources", it splits by *kind of string*: proper nouns stay in code (workshop titles `:62`, `:66`; presenter names `:63`, `:67`) because translating a talk title or a person's name would be wrong, while the prose that describes each workshop lives in the `.resx` pair. The bridge is `Key`, documented on the record itself (`:83-87`): the markup composes `Workshops.{Key}.Audience` and `Workshops.{Key}.Description` at render time (`ADCHome.razor:136`, `:139`), and those keys exist in both locales (`MMCA.ADC.Conference.UI/Pages/Home/ADCHome.resx:26-29`, with the Spanish twins in `ADCHome.es.resx`). One consequence worth noticing: adding a workshop means adding four resource entries per locale, and a typo in `Key` fails at runtime as a missing resource rather than at compile time.
- **Walkthrough**: a four-property positional record. The catalogue is the get-only `ADCHomeContent.Workshops` property (`:59-69`) with two entries: `"ModularMonolith"`, "Build a Modular Monolith with an AI Pair", presented by Ivan Ball-llovera with the `Hub` icon (`:61-64`), and `"SoftwareFactory"`, "Beyond the Basics: Starting Your Software Factory", presented by Tim Rayburn with the `PrecisionManufacturing` icon (`:65-68`). The doc comment above the property states the split in one sentence (`:54-58`). The markup renders the list as a two-column grid (`ADCHome.razor:120-145`), keyed by `workshop.Key` (`:123`), each card showing the icon in a circle (`:128`), the title (`:130`), the localized `Workshops.PresenterLabel` formatted with the presenter name (`:132-134`), the audience line (`:135-137`), and the description (`:138-140`).
- **Why it's built this way**: the workshop day runs before the conference day, and the section is placed between the hero and the keynote so the page reads in the same order as the event, which the markup comment records (`ADCHome.razor:86-88`). Two facts the cards would otherwise repeat, the schedule and the venue, are hoisted into one shared logistics line above the grid (`ADCHome.razor:107-118`), which is why they are resources (`Workshops.Schedule`, `Workshops.Venue`, `ADCHome.resx:21-22`) rather than record fields. Ticketing is the other deliberate asymmetry: the workshop day sells on its own TicketLeap page, so its call to action reads the `PreConferenceTicketingUrl` constant (`ADCHome.razor.cs:29-30`) and always renders (`ADCHome.razor:147-159`), while the hero's conference-day button reads `TicketingUrl` off the featured event and hides itself when absent. The constant carries an `S1075` suppression with the reason inline (`ADCHome.razor.cs:26-31`): it is a published product page, not an environment-dependent path, so there is nothing to configure. [Rubric §26, Front-End Security]: the workshop ticketing button opens with `Target="_blank"` together with `rel="noopener noreferrer"` (`ADCHome.razor:155`).
- **Where it's used**: `ADCHomeContent.Workshops` (`:59`) and the workshops section of `ADCHome.razor` (`:85-161`) only.

### ADCCollectionResult
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:289` · Level 1 · record (sealed, private)

- **What it is**: the one-property envelope the landing page deserializes the `events` response into: `List<ADCEventInfo>? Items` (`:289`). It exists because the API returns a collection *envelope*, not a bare array.
- **Depends on**: [ADCEventInfo](#adceventinfo) (its element type), which is what puts it one level above the plain records.
- **Concept introduced: mirroring only the slice of the envelope you consume.** The API's uniform collection contract is [CollectionResult<T>](group-01-result-error-handling.md#collectionresultt), which carries more than a list. Rather than referencing that type, the page declares a minimal structural twin containing just `Items`, keeping the landing page free of any dependency on the API's shared contract assembly. [Rubric §9, API and Contract Design]: the wire format is honoured, the coupling is not.
- **Walkthrough**: consumed in exactly one place, `LoadEventAsync` (`:175`): `await client.GetFromJsonAsync<ADCCollectionResult>("events", ApiJsonOptions, _cts!.Token)`. The `ApiJsonOptions` field is a `JsonSerializerOptions(JsonSerializerDefaults.Web)` allocated once as `static readonly` (`:33`), which is what makes the camelCase wire names bind to the PascalCase record properties. `Items` is nullable and immediately coalesced to an empty collection at the call site (`result?.Items ?? []`, `:180`), so a null body, a null `Items`, and an empty list all take the same path.
- **Why it's built this way**: `GetFromJsonAsync` returns `null` for an empty response body, so the nullable property plus the coalesce covers both failure shapes without a branch.
- **Where it's used**: [ADCHome](#adchome)`.LoadEventAsync` only (`:175`).

### ADCHomeContent
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHomeContent.cs:15` · Level 1 · class (static, internal)

- **What it is**: the landing page's editorial content, lifted out of the code-behind into its own file: the keynote card, the conference track catalog, and the pre-conference workshop catalog, as three get-only static properties.
- **Depends on**: [KeynoteSpeakerInfo](#keynotespeakerinfo), [ConferenceTrackInfo](#conferencetrackinfo), and [PreConferenceWorkshopInfo](#preconferenceworkshopinfo) (all three declared in this same file, `:73`, `:81`, `:88`), plus MudBlazor's `Icons.Material.Filled.*` constants (`:1`).
- **Concept introduced: separating content from orchestration inside one page.** [Rubric §18, UI Architecture and Component Design] assesses whether a component has one job and whether its structure makes that job legible. The class summary states the intent verbatim (`:5-9`): the content is kept beside the page, like the other page-local data holders, so the code-behind stays orchestration only. That is the practical difference between a 313-line code-behind that reads as a lifecycle (fetch, classify, arm a timer, dispose) and one where three paragraphs of conference copy sit between `OnInitializedAsync` and `Dispose`. [Rubric §15, Best Practices & Code Quality] is the follow-on: editing the track list for next year's conference touches exactly one file that contains no logic, so the review is a content review.
  The other reason this is a distinct type rather than a region: the `internal` accessibility. The three records and the holder are all `internal sealed` / `internal static`, so they are visible to the page and to nothing outside the assembly, but unlike the private inner records of [ADCHome](#adchome) they can live in their own file. [Rubric §27, Internationalization]: the class remark (`:10-14`) is where the deliberate English-only decision for this content is recorded, per [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html).
- **Walkthrough**: three static get-only properties, each initialized once at type initialization.
  - **`Keynote`** (`:18-31`): a single [KeynoteSpeakerInfo](#keynotespeakerinfo), including the WebP-derivative comment that explains the shipped portrait (`:22-25`).
  - **`Tracks`** (`:34-52`): an `IReadOnlyList<ConferenceTrackInfo>` collection expression with the eight conference tracks.
  - **`Workshops`** (`:59-69`): an `IReadOnlyList<PreConferenceWorkshopInfo>` with the two pre-conference workshops, above the doc comment that spells out which fields are code and which resolve from resources (`:54-58`).
- **Why it's built this way**: exposing the three as `{ get; }` properties rather than public fields means the collections are initialized exactly once per process and shared by every circuit on the server head, which matters because the server head renders this page for every connected user. Returning `IReadOnlyList<T>` rather than an array keeps the markup's `@foreach` honest about the collection being read-only.
- **Where it's used**: [ADCHome](#adchome) only: `KeynoteImageSrc` reads `ADCHomeContent.Keynote.PhotoFileName` (`ADCHome.razor.cs:56-57`), and the markup reads all three (`ADCHome.razor:121` for the workshop grid, `:186`, `:193`, `:195`, `:202`, `:203` for the keynote card, `:234` for the track grid).

### ADCSponsorInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:305` · Level 1 · record (sealed, private)

- **What it is**: the landing page's projection of one sponsor: `Id`, `Name`, `Tier`, `LogoUrl?`, `WebsiteUrl?`, `Sort`, and `EventId` (`:305-312`). Seven fields, exactly what the sponsor logo strip renders and sorts by.
- **Depends on**: [SponsorTier](group-17-conference-domain.md#sponsortier) from `MMCA.ADC.Conference.Shared.Sponsors` (imported at `:5`). That one shared enum is the single first-party type the landing page's wire models reference, and it is what raises this record above level 0.
- **Concept introduced: sharing the enum, not the DTO.** The page could have referenced the API's [SponsorDTO](group-17-conference-domain.md#sponsordto) and taken everything with it. Instead it declares its own seven-field record and imports only `SponsorTier`, because the tier is a *domain vocabulary* term whose numeric ordering is load-bearing here: `Platinum = 0`, `Gold = 1`, `Silver = 2`, `Community = 3` (`MMCA.ADC.Conference.Shared/Sponsors/SponsorTier.cs:12-25`), so an `OrderBy(g => g.Key)` on the enum value yields package order without a lookup table (`:229`). Re-declaring the enum locally would have duplicated that ordering contract in a place no test guards. [Rubric §9, API and Contract Design] is the balance being struck: copy the shape, share the vocabulary.
- **Walkthrough**: a positional record with no methods, used only inside `LoadSponsorsAsync` and the markup. `Tier` is the grouping key (`:228`), `Sort` then `Name` are the intra-tier tie-breakers (`:232`), `EventId` is the filter that scopes the strip to the featured event (`:227`), and `LogoUrl`/`WebsiteUrl` drive a four-way render fallback in the markup (`ADCHome.razor:277-301`): linked logo, linked name, bare logo, or bare name, depending on which of the two optional URLs are present. [Rubric §26, Front-End Security] is visible in that block: the outbound sponsor link carries `Target="_blank"` together with `rel="noopener noreferrer"` (`ADCHome.razor:280`), so a sponsor site can never reach back through `window.opener`. [Rubric §21, Accessibility]: the link also carries a localized `aria-label` built from the sponsor name (`ADCHome.razor:281`), and each logo image its `Alt` (`ADCHome.razor:285`, `:295`), so a logo-only card is still announced. Both logo renders also carry `loading="lazy"`, with the comment recording why it is unconditionally safe here (`ADCHome.razor:284`): the sponsor strip is the last section of the page, so it is always below the fold.
- **Why it's built this way**: `Sort` exists so organizers can order sponsors inside a tier by hand, and the code comment states why the sort is explicit at all (`:222-223`): tier ascending is package order, and `Sort` then `Name` breaks ties so the strip is deterministic rather than dependent on insertion order. `StringComparer.CurrentCulture` on the name tie-break (`:232`) keeps that alphabetical fallback correct under the selected culture.
- **Where it's used**: the `Items` list of [ADCSponsorCollectionResult](#adcsponsorcollectionresult) (`:303`), the grouped `_sponsorTiers` field (`:67`), and the sponsor section of `ADCHome.razor` (`:254-336`).

### ADCSponsorCollectionResult
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:303` · Level 2 · record (sealed, private)

- **What it is**: the envelope for the `sponsors` response: `List<ADCSponsorInfo>? Items` (`:303`). It is the sponsor-side twin of [ADCCollectionResult](#adccollectionresult), declared separately because C# records are not structurally typed.
- **Depends on**: [ADCSponsorInfo](#adcsponsorinfo), and transitively [SponsorTier](group-17-conference-domain.md#sponsortier).
- **Concept introduced**: nothing new; the minimal-envelope idea is taught under [ADCCollectionResult](#adccollectionresult).
- **Walkthrough**: deserialized in `LoadSponsorsAsync` with the same shared `ApiJsonOptions` and the same cancellation token (`:220`), then reduced in one collection expression (`:224-233`): `result?.Items ?? []` for the null-safe start (`:226`), `.Where(s => s.EventId == _event.Id)` to scope to the featured event (`:227`), `.GroupBy(s => s.Tier)` (`:228`), `.OrderBy(g => g.Key)` for package order (`:229`), and a `Select` that materializes each group as a `KeyValuePair<SponsorTier, IReadOnlyList<ADCSponsorInfo>>` with its members ordered by `Sort` then `Name` (`:230-232`). The result lands in `_sponsorTiers` (`:67`), whose doc comment states the intent in one line: sponsors grouped by tier in package order, each group ordered by Sort then Name (`:66`).
- **Why it's built this way**: the method-level remarks (`:204-209`) record the two safety properties. The `sponsors` endpoint is the same anonymous read path as the events call and already scopes anonymous callers to sponsors of published events; the client-side `EventId` filter is the second half, so a second published edition's sponsors never bleed onto this page. And any failure leaves the list empty, which falls back to the sponsorship call to action rather than a blank strip. [Rubric §11, Security] is worth naming precisely here: the client-side filter is a *correctness* control, not an authorization control. The server decides what an anonymous caller may see.
- **Where it's used**: [ADCHome](#adchome)`.LoadSponsorsAsync` only (`:220`).

### ConferenceUIModule
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI` · `MMCA.ADC.Conference.UI/ConferenceUIModule.cs:14` · Level 3 · class (sealed)

- **What it is**: the Conference module's UI descriptor. It contributes the navigation items for the whole conference capability (public Events/Sessions/Speakers/Sponsors/Activities, the claim-gated speaker Dashboard and QR page, and an organizer admin group covering Events, Sessions, Speakers, Categories, Questions, Rooms, Sponsors, Activities, and Session Selection) and exposes its assembly so the host can discover the module's routable Blazor components.
- **Depends on**: [IUIModule](group-15-common-ui-framework.md#iuimodule) (the contract it implements), [NavItem](group-15-common-ui-framework.md#navitem) and [NavSection](group-15-common-ui-framework.md#navsection) (the nav vocabulary from `MMCA.Common.UI.Common`), [RoleNames](group-08-auth.md#rolenames) (the `Organizer` role string), [ConferenceRoutePaths](#conferenceroutepaths) (the URLs), plus MudBlazor `Icons` and `System.Reflection.Assembly` (externals, `:1`, `:5`) and the co-located `ConferenceUIModule.resx` / `ConferenceUIModule.es.resx` pair.
- **Concept introduced: the modular-UI descriptor, the front-end analogue of `IModule`.** [Rubric §18, UI Architecture and Component Design] assesses whether UI is composed from cohesive, self-describing modules rather than a hard-coded master shell; a module declaring its own menu is exactly that, and it is the Open/Closed half of [Rubric §1, SOLID]: enabling a module adds its navigation with no edit to the shell. [Rubric §25, Navigation and Information Architecture] is served because the items are role- and claim-aware and grouped into sections. [Rubric §11, Security] applies with an important caveat: hiding a nav item is UX only. The services still enforce authorization server-side, so the claim and role here are not the security boundary. Per [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) the `Title` and `Group` strings are resource *keys*, not literals: `typeof(ConferenceUIModule)` in the `TitleResource` position on every item tells the shared NavMenu to resolve them against the co-located `.resx` at render time, which the file's own comment records (`:16-17`). The record's own documentation adds the failure mode (`MMCA.Common.UI/Common/NavItem.cs:10-14`): a key the resource type does not declare renders as the raw string, so a not-yet-translated entry is legible rather than blank.
- **Walkthrough**: `NavItems` (`:18-41`) is an `IReadOnlyList<NavItem>` initialized with a collection expression in three tiers, sixteen items in all.
  - **Public** (`:21-25`): five items for everyone, anonymous included, pointing at the `/conference/...` routes: Events, Sessions, Speakers, Sponsors, Activities. They carry no `RequiredRole` and no `Section`, so they default to `NavSection.General` (`MMCA.Common.UI/Common/NavItem.cs:16`).
  - **Speaker** (`:28-29`): the Dashboard and the QR page, both carrying `RequiredClaim: "speaker_id"` and `Section: NavSection.User`, so they appear only for a user whose JWT links them to a speaker record and they render in the user menu rather than the main list.
  - **Organizer** (`:32-40`): nine items, each carrying `RoleNames.Organizer`, `Section: NavSection.Admin`, and `Group: "Nav.Group.Conference"` so they fold into one labelled admin group, ending with the Session Selection entry (`:40`).
  - `Assembly` (`:43`) returns `typeof(ConferenceUIModule).Assembly` so the host's Blazor router can discover this library's routable components. Note that "Events", "Sessions", "Speakers", "Sponsors", and "Activities" each appear twice in the list, once public and once organizer, differing only in route and gating: the same label serves two audiences with two destinations.
- **Why it's built this way**: mirroring the backend [IModule](group-14-module-system-composition.md#imodule) pattern on the UI side keeps the app extensible. A host that boots without the Conference module simply has no conference nav and no conference routes, with no conditional code anywhere in the shell. The class also leaves `AppBarComponentTypes` and `LayoutComponentTypes` at their interface defaults (`MMCA.Common.UI/Common/Interfaces/IUIModule.cs:19-22`): Conference contributes no app-bar badge and no root overlay.
- **Where it's used**: registered as a singleton `IUIModule` by this module's [DependencyInjection](#dependencyinjection) through `AddUIModule<ConferenceUIModule>()` (`DependencyInjection.cs:23`, implemented at `MMCA.Common.UI/DependencyInjection.cs:207-216`) and aggregated by the shared UI navigation builder in [group 15](group-15-common-ui-framework.md#iuimodule).

### DependencyInjection
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI` · `MMCA.ADC.Conference.UI/DependencyInjection.cs:17` · Level 6 · class (static)

- **What it is**: the Conference UI composition root. Its single `AddConferenceUI()` method is the one call a host makes to register every Conference UI service (the per-entity CRUD services by assembly scan, then the child-entity, dashboard, feedback, selection, offline-schedule, and lookup services explicitly) plus the module descriptor.
- **Depends on**: [ConferenceUIModule](#conferenceuimodule) and, through `AddUIModule<T>` (`MMCA.Common.UI/DependencyInjection.cs:207-216`), Scrutor's assembly-scanning API and the open generic [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype). Then this module's own service contracts: [IEventSpeakerUIService](#ieventspeakeruiservice), [ISessionSpeakerUIService](#isessionspeakeruiservice), [ISessionCategoryItemUIService](#isessioncategoryitemuiservice), [ISpeakerCategoryItemUIService](#ispeakercategoryitemuiservice), [ISpeakerDashboardUIService](#ispeakerdashboarduiservice), [IOrganizerEventFeedbackUIService](#iorganizereventfeedbackuiservice), [IOrganizerSessionFeedbackUIService](#iorganizersessionfeedbackuiservice), [ISessionSelectionUIService](#isessionselectionuiservice), [IPublicSessionScheduleService](#ipublicsessionscheduleservice), [ISpeakerLookupService](#ispeakerlookupservice), [IEventLookupService](#ieventlookupservice), [ICategoryItemLookupService](#icategoryitemlookupservice), and [ISpeakerDetailLookupService](#ispeakerdetaillookupservice).
- **Concept introduced: the `extension(IServiceCollection)` registration block, half convention and half explicit.** [Rubric §3, Clean Architecture] and [Rubric §15, Best Practices & Code Quality] both come down to keeping wiring at the edges; this file is the module's one wiring point. It uses the C# preview extension-type syntax `extension(IServiceCollection services)` (`:13`) to hang `AddConferenceUI` (`:19`) off `IServiceCollection`, the same idiom every module's `DependencyInjection` uses. The convention half is delegated to `AddUIModule<ConferenceUIModule>()` (`:23`), which does two things in one call (`MMCA.Common.UI/DependencyInjection.cs:210-216`): a Scrutor scan of this assembly registering every `IEntityService<,>` implementation `AsImplementedInterfaces().WithScopedLifetime()`, and the singleton registration of the descriptor itself. Registering `AsImplementedInterfaces` is what makes a page able to inject the narrow per-entity interface rather than the open generic, and it means adding a new entity service needs no edit here.
- **Walkthrough**: the scan runs first (`:23`), then the method registers by hand exactly the services the scan cannot see, because they do not implement `IEntityService<,>`:
  - four child-entity managers for the join relationships (`:26-29`);
  - the speaker dashboard service (`:32`);
  - the two organizer feedback moderation services, tagged BR-53 in the comment (`:34-36`);
  - the session-selection decision-support service (`:39`);
  - the offline-first page fetch for the public session schedule, tagged to [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 3 (`:41-42`);
  - three cross-module lookup services (`:44-47`);
  - and the composite lookup for the speaker detail page (`:51`), whose comment states its purpose precisely (`:49-50`): one call and one failure branch over the three lookups that page needs together.

  Every explicit registration is `AddScoped`; only the descriptor is a singleton, which is correct because it is immutable data. The method returns `services` for chaining (`:57`).
- **Why it's built this way**: scanning the uniform bulk and spelling out the one-off collaborators keeps registration short without hiding the non-trivial wiring. The closing comment (`:53-56`) documents what this file deliberately does *not* register: `IPublicLinkBuilder` comes from the framework, where `AddUIShared` `TryAdd`-registers the browser-origin builder (`MMCA.Common.UI/DependencyInjection.cs:129-131`), and the MAUI head overrides it afterwards with `AddCommonMauiPublicLinkBuilder()` (`MMCA.Common.UI.Maui/DependencyInjection.cs:134`, called at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:143`) so last-registration-wins points shared links at the configured public web URL. Recording an ordering dependency that lives in another repository, right where a reader would otherwise expect the registration, is the cheap version of [Rubric §34, Architecture Governance and Documentation].
- **Where it's used**: called once during startup by each of the three UI heads: the Blazor Server host (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:86`), the WebAssembly client (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:65`), and the MAUI host (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:131`), alongside the other modules' `AddXxxUI()` extensions.

### ADCHome
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:17` · Level 9 · class (sealed partial component)

- **What it is**: the conference landing page: hero with a live countdown and a ticketing button, pre-conference workshops, keynote, track catalogue, sponsor strip with a sponsorship call to action, and venue block. It fetches the published events list to find which event to feature, classifies that event as Upcoming/Live/Ended, loads that event's sponsors, and renders the rest from the compiled-in editorial content in [ADCHomeContent](#adchomecontent). It is shared verbatim by the Web and MAUI heads, and its class doc records that both heads serve the static images from their own site root, so neither overrides `ImageBasePath` today (`:9-16`).
- **Depends on**: [ADCCollectionResult](#adccollectionresult), [ADCEventInfo](#adceventinfo), [ADCSponsorCollectionResult](#adcsponsorcollectionresult), [ADCSponsorInfo](#adcsponsorinfo) (the API models, all private inner records of this class), [EventPhase](#eventphase) (a private inner enum), [ADCHomeContent](#adchomecontent) with its [KeynoteSpeakerInfo](#keynotespeakerinfo), [ConferenceTrackInfo](#conferencetrackinfo), and [PreConferenceWorkshopInfo](#preconferenceworkshopinfo) records, [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) from `MMCA.ADC.Conference.Shared.Events` (`:4`), [SponsorTier](group-17-conference-domain.md#sponsortier) (`:5`), and [ConferenceRoutePaths](#conferenceroutepaths) for the "see all sponsors" link (`ADCHome.razor:308`). Externals: `IHttpClientFactory` and `GetFromJsonAsync` (`:1`, `:41-42`), `IStringLocalizer<ADCHome>` injected in the markup as `L` (`ADCHome.razor:1`), `System.Threading.Timer`, `TimeZoneInfo`, MudBlazor, and the Blazor `RendererInfo` API. It composes one first-party child component, `HomeCountdown` (`ADCHome.razor:40`), which lives in the same folder as a single `.razor` file with no code-behind.
- **Concept introduced: rendering correctly across the prerender and interactive passes.** [Rubric §23, Front-End Performance and Rendering] assesses whether a page avoids wasted renders and blocking work; this component is the chapter's clearest case study, and both of its decisions are recorded in the code comments. See [ADR-056](https://ivanball.github.io/docs/adr/056-blazor-render-mode-strategy.html) for the render-mode strategy these two decisions live inside.
  - **Skip the fetch during prerender.** `OnInitializedAsync` checks `RendererInfo.IsInteractive` and, when false, sets `_isLoading = false`, computes the countdown from defaults, and returns without touching the network (`:115-120`). The comment (`:110-114`) states why: an untimed server-side call to a cold or unreachable backend would block the prerender, and therefore the page load and the post-login `NavigateTo("/")`, indefinitely. The static fallback renders immediately and the interactive pass loads the real event. Prerender is a one-shot static render, so the timer is moot there. [Rubric §29, Resilience and Business Continuity] is the same point from the availability angle.
  - **Fence the per-second re-render.** The ticking digits live in the `HomeCountdown` child, which owns its own timer, so this page arms only a *single one-shot* `Timer` for the Live-to-Ended flip (`:142-157`). The comment at `:125-126` records the alternative: a 1-second timer would re-render the entire landing page, the largest static page in the app, for the whole event, per circuit, just to catch one transition. The child goes further still: it ticks once a minute while more than 65 minutes remain and switches to once a second only for the final hour (`MMCA.ADC.Conference.UI/Pages/Home/HomeCountdown.razor:32`, `:52-56`, `:59`, `:70-74`), and it too refuses to start a timer unless `RendererInfo.IsInteractive` (`HomeCountdown.razor:51-52`).

  Three more rubric threads run through it. [Rubric §22, Responsive and Cross-Browser/Device]: one component compiles into the Blazor Server, WebAssembly, and MAUI heads, with the per-head difference reduced to the `ImageBasePath` parameter (`:49-50`). [Rubric §27, Internationalization]: user-facing chrome resolves through `L[...]`, while the strings that must not be translated carry explicit `// i18n: allow` markers with reasons (the ticketing URL `:30`, the brand name `:78`, `:94-95`, the postal address `:82`). [Rubric §20, Design System and Theming]: the page's scoped stylesheet is a single shared copy rendered by both heads, and an architecture fitness test embeds it and fails the build if it re-hardcodes the brand hex instead of using `var(--mmca-primary)` (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Ui/BrandColorTokenTests.cs:12-17`, embedded via `MMCA.ADC.Architecture.Tests.csproj:11-13`).
- **Walkthrough**, in lifecycle order:
  - **Constants and state** (`:19-69`): the `PreConferenceTicketingUrl` constant placed first because SA1203 requires constants before fields, with its doc block and `S1075` suppression (`:19-31`), the shared `ApiJsonOptions` and `EventStartTime` (`:33-34`), the `FallbackStartDate` (`:39`), then a `CancellationTokenSource`, the one-shot `_phaseTimer`, the computed `_startUtc`/`_endUtc`, `_phase`, the nullable `_event` (`:59-64`), the grouped `_sponsorTiers` (`:67`), `_isLoading` (starting `true`, `:68`), and a `_disposed` guard the timer callback checks (`:69`).
  - **Derived display properties** (`:78-85`): `EventName`, `EventDescription`, `VenueAddress`, and `MapSearchUrl` are each `_event?.X ?? <fallback>`, so the page is fully renderable before and without a successful fetch. `MapSearchUrl` builds a Google Maps search URL with `Uri.EscapeDataString` over the address (`:84-85`).
  - **`HeroTitleParts()`** (`:92-104`): splits the event name so the hero can accent the keyword between "Atlanta " and " Conference" (in "2026 Atlanta Developers Conference" it accents "Developers"). It uses `IndexOf`/`LastIndexOf` with `StringComparison.Ordinal` and falls back to rendering the whole name plain when the name does not match the brand shape (`:101-103`), which is why an arbitrary event name never renders broken markup; the markup branches on the accent being non-empty (`ADCHome.razor:19-26`).
  - **`OnInitializedAsync`** (`:106-128`): creates the CTS, takes the prerender short-circuit described above, otherwise awaits `LoadEventAsync()` then `LoadSponsorsAsync()` in sequence (`:122-123`, the sponsor call needs the featured event id) and arms the phase timer (`:127`).
  - **`LoadEventAsync`** (`:170-199`): creates the named `"APIClient"` from `IHttpClientFactory` (`:174`), deserializes into [ADCCollectionResult](#adccollectionresult) under the cancellation token (`:175`), and picks the event with `CurrentEventSelector.SelectCurrentOrNext(...)` passing three accessor lambdas plus `DateTime.UtcNow` (`:179-184`). The comment at `:177-178` is the reason it is not a `FirstOrDefault`: the anonymous endpoint returns published events unordered, so a naive first-item pick would pin the oldest seeded event. Two catch arms are deliberately silent: `OperationCanceledException` means the component was disposed mid-load (`:186-189`), `HttpRequestException` means the API is unavailable and the fallback content stands (`:190-193`). The `finally` block always clears `_isLoading` and recomputes the countdown (`:194-198`), so no failure path leaves a spinner on screen.
  - **`LoadSponsorsAsync`** (`:210-243`): returns immediately when no event was featured (`:212-215`), then runs the same anonymous read path against `sponsors` and reduces the payload to the tier-grouped list described under [ADCSponsorCollectionResult](#adcsponsorcollectionresult). Its two catch arms mirror `LoadEventAsync` (`:235`, `:239`) and both leave `_sponsorTiers` empty, which is a supported render state rather than an error state.
  - **`UpdateCountdown`** (`:245-268`): converts the event's local start and end into UTC using `TimeZoneInfo.FindSystemTimeZoneById(timeZoneId)` with `"America/New_York"` as the default (`:251`, `:257`), calling `CurrentEventSelector.ToUtc` rather than `ConvertTimeToUtc` because, as the comment records (`:253-256`), the midnight end boundary does not exist in zones that transition at 00:00 and a raw conversion would throw out of the render path (`MMCA.ADC.Conference.Shared/Events/CurrentEventSelector.cs:89-94`). The same comment notes the id itself always resolves, because `EventInvariants.EnsureTimeZoneIsValid` guards every write path. `_phase` is then assigned from the switch described under [EventPhase](#eventphase) (`:261-267`).
  - **Phase timing** (`:130-168`): `OnCountdownElapsedAsync` is the `EventCallback` the `HomeCountdown` child raises at zero (`HomeCountdown.razor:82`), which recomputes the phase, re-arms, and calls `InvokeAsync(StateHasChanged)` (`:131-136`). `ArmPhaseTimerForEventEnd` returns unless the phase is `Live` and the remaining time is positive, then disposes any prior timer and schedules one callback at `untilEnd` with `Timeout.InfiniteTimeSpan` as the period, meaning fire once and never repeat (`:142-157`). `OnEventEnded` checks `_disposed` before re-rendering (`:159-168`).
  - **`FormatEventDate`** (`:270-277`): formats the date with a pattern read from a *resource* (`L["Hero.DateFormat"]`) against `CultureInfo.CurrentCulture`, so both the layout and the month names follow the selected language ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
  - **`Dispose`** (`:279-286`): sets `_disposed`, cancels and disposes the CTS, and both stops (`Change(-1, -1)`) and disposes the phase timer. Stopping before disposing is what prevents a callback already in flight from touching a torn-down component.
- **Why it's built this way**: the landing page is the app's most-hit surface and the post-login destination, so its correctness budget is dominated by two failure modes that have nothing to do with its content: a slow backend blocking the prerender, and a per-second render loop multiplied by every connected circuit. Both are solved structurally (skip the fetch, fence the tick) rather than by tuning, and every dynamic block has a defined empty state, so the page is never blank. The two conditional calls to action follow the same discipline: the hero ticketing button (`ADCHome.razor:67-80`) and the sponsorship packet block (`ADCHome.razor:312-334`) each render only when the featured event publishes the corresponding URL, and hide entirely otherwise rather than offering a dead link, which the markup comments state at both sites (`ADCHome.razor:67-69`, `:312-314`).
- **Where it's used**: resolved as the home component by each head's `ADCHomePageContent`. The Web client points `ComponentType` straight at this shared component (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:13`); the MAUI head points at a thin local wrapper page that renders `<ADCHome />` with no parameters (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHomePageContent.cs:10`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHome.razor:6`). [Rubric §28, Front-End Testing]: the page has no bUnit test, but two suites hold it to account from outside, the brand-token fitness test above and the E2E pseudo-localization sentinel, which probes this page's `Location.OpenInMaps` resource and settles on the always-rendered `.location-section`, precisely because that button is static markup rather than event-load-gated (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/PseudoLocalizationTests.cs:31-44`).
- **Caveats / not-in-source**: the page's own countdown window is not identical to the selector's. `UpdateCountdown` starts the event at `EventStartTime = 08:00` local (`:34`, `:249`), while [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) starts its live window at midnight local (`MMCA.ADC.Conference.Shared/Events/CurrentEventSelector.cs:71`). Both end at midnight after the last day (`:250`, `CurrentEventSelector.cs:70`). So between midnight and 08:00 on day one, the selector already treats the event as live while the hero still shows a countdown. Whether that is intended is not determinable from source. Also note the two hard-coded fallbacks used when no event loads: the date `2026-10-17`, whose comment warns it must track the published event date or the hero date and countdown visibly jump once the real event arrives (`:36-39`), and the venue address (`:82`).

### EventFilteredListPageBase<TDto>
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Common` · `MMCA.ADC.Conference.UI/Pages/Common/EventFilteredListPageBase.cs:25` · Level 9 · class (abstract, generic)

- **What it is**: the base class for every Conference list page whose rows are scoped to a single conference event. It adds three things on top of the framework's grid base: the event lookup, a persisted `eventId` filter, and the default (current or next) event resolution. A derived page supplies only what differs: how it saves and restores its own filters, and what it reloads when the scope changes.
- **Depends on**: [DataGridListPageBase<TDto>](group-15-common-ui-framework.md#datagridlistpagebasetdto) (its base, `:25`), [IEventLookupService](#ieventlookupservice) and its [EventInfo](#eventinfo) record (injected at `:27`, `:30`), [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) (`:3`, `:182`), and the `EventIdentifierType` alias. Externals: `Microsoft.AspNetCore.Components` for `[Inject]` and `RendererInfo`, and `System.Globalization.CultureInfo` (`:1`).
- **Concept introduced: layering an application-vocabulary base on a framework base.** [Rubric §3, Clean Architecture] assesses whether abstractions sit at the layer that owns their vocabulary. The class remark makes the call in one sentence (`:16-18`): "conference event" is domain vocabulary, not framework vocabulary, so this does not belong in MMCA.Common alongside the grid plumbing it builds on. The result is a two-layer inheritance chain where each layer owns exactly the concepts of its own repository, which is the same reasoning that keeps [DetailPageBase](#detailpagebase) ADC-local for a different reason (nothing to share) and this one ADC-local for this reason (nothing shareable *should* be shared).
  The second idea is **prerender-truthful interactivity**, and it is worth reading in full because it is a non-obvious correctness rule rather than a preference. `CanRenderEventPicker` gates the picker on `RendererInfo.IsInteractive && Events is { Count: > 1 }` (`:72`), and the remark above it explains (`:63-71`): the SSR prerender pass resolves the events server-side and would happily paint a fully formed picker, dropdown and clear button included, into static HTML. Nothing is wired to it until the interactive runtime attaches, which under `InteractiveAuto`'s WebAssembly leg is a whole runtime boot later, and every click landing in that window is swallowed with no feedback, leaving the list silently on the default event the prerender chose. Rendering the picker only once the component is interactive turns "the picker is on screen" into a truthful signal that a choice will be honored, for a reader and for an E2E wait alike. [Rubric §22, Responsive and Cross-Browser/Device] and [Rubric §24, Forms, Validation and UX Safety] both land on that one line, and [ADR-056](https://ivanball.github.io/docs/adr/056-blazor-render-mode-strategy.html) is the render-mode policy it implements.
- **Walkthrough**:
  - **Injected state** (`:27-50`): the `IEventLookupService`, then `Events` (the id-to-`EventInfo` dictionary, `null` when the lookup failed), `SelectedEventId` (`null` meaning "all events"), `EventFilterResolved` (true once the scope is decided, restored or computed), `EventsLoadFailed` (so a page that must fail closed can branch rather than silently querying unscoped), and `EventsLoadTask`, the in-flight load. Every setter is `private`, so the base owns all transitions.
  - **`EventFilterIsUserControlled`** (`:57`): `virtual`, default `true`. It answers "does the reader pick the event themselves", which is what makes the choice worth persisting and worth restoring. [PublicSpeakerList](#publicspeakerlist) overrides it with a role check rather than a constant (`MMCA.ADC.Conference.UI/Pages/Public/Speakers/PublicSpeakerList.razor.cs:53`), so the same page is user-controlled for a privileged reader and locked to the computed event for everyone else.
  - **`CanRenderEventPicker` and `EventPickerOptions`** (`:72`, `:79-80`): the gate described above, and the ordered option list derived from it. Iterating `EventPickerOptions` instead of `Events` keeps every page's picker on one ordering (`OrderBy(e => e.StartDate)`) and keeps the markup free of the null handling the gate already did.
  - **The three extension points** (`:83-95`): `ReloadForEventFilterAsync()` is `abstract`, so a page cannot forget to reload; `SavePageFilters` / `RestorePageFilters` are `virtual` no-ops for page-specific values (search text, status dropdowns); `OnEventsLoadingAsync()` is a `virtual` hook for work that must run *before* the events are fetched, such as resolving whether the reader is privileged.
  - **`SaveFilters` / `RestoreFilters`** (`:98-129`): both are `sealed override`, which is the load-bearing detail. The base takes over the framework's two filter hooks, calls the page's hook first, then owns the `eventId` entry itself, so no derived page can accidentally drop the event scope from persisted state. The saved value is either the invariant-formatted id or the literal `"all"`, and the comment states why the literal exists (`:104`): it distinguishes an explicit clear from no saved state, which would apply the default instead. Restore handles the three cases (absent, `"all"`, parseable id) and sets `EventFilterResolved` only in the latter two.
  - **`OnInitializedAsync` and `BeginEventsLoad`** (`:132-144`): initialization starts the load *before any await* and then awaits it. `BeginEventsLoad()` is exposed separately so a derived page can start the event load, run its own non-event work concurrently, and only then await `EventsLoadTask`.
  - **`LoadEventsAndResolveDefaultAsync`** (`:150-167`): the hook, then the lookup with `Result` unwrapped by `TryGetValue` (see the primer on the Result pattern), then `ResolveDefaultEventFilter()`. A failure is non-fatal by design (`:154-155`): the picker stays hidden and the default filter stays unset, and the failure is remembered in `EventsLoadFailed`. The method is documented as callable again (`:146-149`), so a retry button heals a transient lookup failure.
  - **`ResolveDefaultEventFilter`** (`:169-189`): the precedence rule, stated in its comment (`:171-172`) and encoded in one condition. A restored id that still exists wins; a dangling one falls back to the computed default; and a page with a locked scope is *always* pinned to the computed current or next event, which is what stops a stale saved id from surviving an override of `EventFilterIsUserControlled`. The computation delegates to `CurrentEventSelector.SelectCurrentOrNext` over `Events.Values` (`:182-187`), the same selector the landing page uses, so "which event is current" has one implementation across the module.
  - **`WaitForEventsAsync`** (`:192`): returns the load task or `Task.CompletedTask`. The doc on `EventsLoadTask` (`:44-49`) says exactly when to await it: before any fetch that applies the event filter, because the grid's first `ServerData` call can race ahead of initialization completing. That race is why the task is a field rather than a local.
  - **`ApplyEventFilter`** (`:195-199`): adds `EventId` as an `("equals", value)` pair to the outgoing filter dictionary, and only when an event is selected, so "all events" is the absence of a filter rather than a sentinel.
  - **`OnEventFilterChanged`** (`:202-207`): bound to the picker's `ValueChanged`. It sets the id, marks the scope resolved, and awaits the page's `ReloadForEventFilterAsync()`. A `null` value clears the scope.
  - **`GetEventName` / `SelectedEventName`** (`:210-219`): display helpers that degrade rather than throw, falling back to the raw id and to an empty string respectively when the lookup has nothing.
- **Why it's built this way**: [Rubric §19, State Management and Data Flow] is the through-line. There is one scope variable, one place that decides its default, one place that persists it, and one place that reloads on change, and the `sealed override` on the two persistence hooks is what keeps it that way as pages are added. [Rubric §11, Security] shows up in the `EventsLoadFailed` flag: a public reader whose lookup failed must not fall through to an unscoped query, so the flag exists specifically to let such a page fail closed, which [PublicSpeakerList](#publicspeakerlist) does through its `ScopeUnresolvedForPublicReader()` check (`PublicSpeakerList.razor.cs:135`). [Rubric §15, Best Practices & Code Quality]: five list pages share this, and each one's event handling is now three overrides.
- **Where it's used**: five Conference list pages derive from it, each pairing an `@inherits` directive with a partial class: [SponsorList](#sponsorlist) (`MMCA.ADC.Conference.UI/Pages/Sponsors/SponsorList.razor.cs:19`), [SpeakerList](#speakerlist) (`Pages/Speaker/SpeakerList.razor.cs:18`), [RoomList](#roomlist) (`Pages/Room/RoomList.razor.cs:12`), [ActivityList](#activitylist) (`Pages/Activity/ActivityList.razor.cs:19`), and [PublicSpeakerList](#publicspeakerlist) (`Pages/Public/PublicSpeakerList.razor.cs:33`). The four organizer pages follow one shape verbatim (`SavePageFilters`/`RestorePageFilters`, `ReloadForEventFilterAsync => ReloadActiveLayoutAsync()`, `await WaitForEventsAsync()` before each fetch, `ApplyEventFilter(filters)` inside it); the public page is the variant that exercises every extension point, overriding `EventFilterIsUserControlled` (`:53`), `OnEventsLoadingAsync` (`:91`), and re-calling `LoadEventsAndResolveDefaultAsync()` on retry (`:123`).

### PublicSessionListFilterState
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionListFilterState.cs:12` · Level 0 · class (internal static)

- **What it is**: the translation layer between [`PublicSessionList`](#publicsessionlist)'s live filter fields and the flat `string`-to-`string` map that [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) persists per page. Two static methods, `Save` and `Restore`, and no state of its own (`PublicSessionListFilterState.cs:12`).
- **Depends on**: only `System.Globalization` (`:1`) and the `RoomIdentifierType` / `EventIdentifierType` aliases. No component base, no injected service, no fetch. The class doc records the placement rule (`:5-10`): it is kept beside the page, like [`PublicScheduleRoomOptions`](#publicscheduleroomoptions), so the code-behind holds only the live filter fields and the handlers that change them.
- **Concept introduced, persisted filter state as a pure, audience-aware codec.** The list-page base can only persist strings, so every page that saves filters needs a codec. Writing it as a static pair rather than as two page methods buys three things worth naming.
  1. **A sentinel that distinguishes "cleared" from "never set".** `Save` writes `"all"` when a privileged reader has explicitly cleared the event filter (`:42`), because an absent key means "no saved state, apply the default" while an empty string would be ambiguous. `Restore` reads that sentinel back as an explicit null plus a resolved flag (`:66-70`). `[Rubric §19, State Management & Data Flow]` (assesses that restored state is distinguishable from absent state).
  2. **Persistence itself is audience-scoped.** `persistEventId` is a caller-supplied flag (`:33`) and the parameter doc states the rule (`:22-26`): only a privileged reader persists an event choice, because everyone else is always locked to the computed current or next event, so persisting it would only leak into shared URLs. The room filter, by contrast, is persisted for every audience, and the `roomId` doc says why in one sentence (`:17-20`): a room only ever narrows within the reader's own event. `[Rubric §26, Front-End Security]` (assesses that a client-persisted preference cannot widen what a reader sees) and `[Rubric §11, Security]`.
  3. **A restore never destroys a value it cannot read.** Every branch in `Restore` is guarded by a `TryGetValue` plus a `TryParse`, and each parameter is passed *in* and returned *out* unchanged when the map has nothing usable (`:57-90`), so a corrupt or partial map degrades to "keep what the page already has" instead of resetting the view. `[Rubric §24, Forms, Validation & UX Safety]`.
- **Walkthrough**
  - `Save` (`:27-44`): writes `search` verbatim (`:35`), the My Schedule toggle as an invariant `bool` string (`:36`), the room id as an invariant number or empty (`:37`), and the event id only when `persistEventId` is true, with the `"all"` sentinel for an explicit clear (`:39-43`).
  - `Restore` (`:57-91`): parses `eventId` first, accepting `"all"` case-insensitively as an explicit clear and any invariant integer as a pick, setting `eventFilterResolved` in both cases so the page knows not to recompute the default (`:64-76`); then `roomId` (`:78-82`), then `mySchedule` compared case-insensitively against `"true"` (`:84-87`); `search` falls back to empty (`:89`). The five values leave as one named tuple (`:57`, returned at `:90`) that the caller destructures straight into its fields.
  - The method doc records the one thing `Restore` deliberately does not do (`:46-49`): a restored room that the resolved event does not offer is dropped afterwards by the page's room-options rescope, not here, because this type never sees the events.
- **Why it's built this way**: the codec is pure and total, so its rules (the sentinel, the audience gate, the keep-on-unparseable behavior) can be exercised without a renderer, and the page keeps a two-line `SaveFilters` / `RestoreFilters` pair instead of forty lines of string handling. `[Rubric §14, Testability]` and `[Rubric §1, SOLID]`.
- **Where it's used**: called only from [`PublicSessionList`](#publicsessionlist)'s sealed base overrides, `SaveFilters` (`PublicSessionList.razor.cs:76-79`, passing `persistEventId: _isPrivileged && _eventFilterResolved`) and `RestoreFilters` (`PublicSessionList.razor.cs:82-85`).

### ScorePollSignal
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions.Selection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/ScorePollTracker.cs:6` · Level 0 · enum (internal)

- **What it is**: the five-valued verdict that [ScorePollTracker](#scorepolltracker) returns for one observation of the AI-scoring poll loop. It says what should happen next: keep waiting, re-render with fresh data, or stop and report an outcome.
- **Depends on**: nothing. It is a bare `internal enum` declared above the tracker in the same file (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/ScorePollTracker.cs:6`), visible to the bUnit test project through the project's `InternalsVisibleTo` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/MMCA.ADC.Conference.UI.csproj:9`).
- **Concept introduced: the decision/effect split.** `[Rubric §18, UI Architecture]` assesses whether components stay thin and free of tangled control flow; naming each outcome as an enum member is how that is achieved here. The decision (what did this poll mean?) is computed by a pure state machine, [ScorePollTracker](#scorepolltracker), and the effects (toast, re-render, stop the loop) are applied in a single `switch` inside [ScorePollSession](#scorepollsession), so neither half has to know the other's internals. `[Rubric §14, Testability]` follows for free: the signal sequence for a synthetic count series can be asserted without rendering anything.
- **Walkthrough**: `Continue` (`ScorePollTracker.cs:9`) means nothing changed this tick, keep polling. `Progressed` (`:12`) means new scores arrived, so apply the fresh board, re-render, and keep polling. `CompletedAll` (`:15`) means every session now has a score, so apply and finish successfully. `CompletedStable` (`:19`) means the count has been unchanged long enough to call scoring done, with the success-versus-partial wording decided from coverage. `GaveUpNoScores` (`:22`) means no score was ever produced inside the zero-progress budget, so fail loudly rather than wait out the full cap.
- **Why it's built this way**: the poll loop has four terminal outcomes that each need a different user-facing message (complete, partial, timed out, never started). An enum makes the exhaustive `switch` in [ScorePollSession](#scorepollsession) readable and keeps that failure vocabulary in one place.
- **Where it's used**: returned by `ScorePollTracker.RegisterFetch` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/ScorePollTracker.cs:74`) and consumed by `ScorePollSession.HandleSignalAsync` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/ScorePollSession.cs:117-145`).

### SessionSelectionDisplay
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions.Selection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/SessionSelectionDisplay.cs:11` · Level 0 · class (static, internal)

- **What it is**: a stateless helper holding the display and filter-matching rules shared by the session-selection dashboard and its two presentational sub-components. It answers three kinds of question with no side effects: what color a status or score chip should be, whether a locality tier counts as local, and whether a session passes the active score-tier or status filter.
- **Depends on**: the MudBlazor `Color` enum (external NuGet, imported at `SessionSelectionDisplay.cs:1`). No first-party types: it is deliberately dependency-light so both [SessionSelectionSpeakerOverlap](#sessionselectionspeakeroverlap) and [SessionSelectionAiScores](#sessionselectionaiscores) can call the same predicates, and so can the page markup itself.
- **Concept introduced: extracting view logic into testable pure functions.** `[Rubric §18, UI Architecture]` rewards keeping decision logic out of `.razor` markup so it can be unit-tested and reused; `[Rubric §14, Testability]` is the same point from the other side. Every method here is `static` and total (each `switch` has a default arm), so the same input always yields the same color or boolean regardless of component state.
- **Walkthrough**: `IsLocalTier` (`SessionSelectionDisplay.cs:13-16`) folds three locality substrings (`Atlanta`, `Georgia`, `Surrounding`, all matched with `StringComparison.OrdinalIgnoreCase`) into one "is this speaker local" test. `GetStatusColor` (`:18-27`) maps six selection states (`Accepted`, `Nominated`, `Accept_Queue`, `Waitlisted`, `Decline_Queue`, `Declined`) onto MudBlazor semantic colors, with `Color.Default` as the fallback. `GetScoreColor` (`:29-35`) buckets a `decimal` score into four bands (at or above 8.0 success, 6.0 info, 4.0 warning, otherwise error). `ScoreMatchesFilter` (`:37-48`) turns a filter token (`"9.0"` down to `"3.0"`, plus `"<3.0"`) into a threshold predicate, with an unrecognized token matching everything; `<3.0` is the only strict-less-than case. `MatchesAcceptedFilter` (`:50-51`) and `SessionMatchesStatus` (`:53-56`) encode a subtle rule: when the filter is `Accepted`, a session whose status is `null` also matches, because an unset status is treated as accepted by default; every other filter is a plain case-insensitive equality test.
- **Why it's built this way**: the two sibling sections filter over different DTO shapes but must agree on what "score tier 8.0" or "status Accepted" means; hoisting the rules here guarantees they never drift apart. The tier tokens it understands are exactly the values [SessionSelectionFilters](#sessionselectionfilters)`.ScoreTierOptions` offers in the picker.
- **Where it's used**: by [SessionSelectionSpeakerOverlap](#sessionselectionspeakeroverlap) (`SessionMatchesStatus` and `ScoreMatchesFilter`, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/SessionSelectionSpeakerOverlap.razor.cs:62` and `:69`), by [SessionSelectionAiScores](#sessionselectionaiscores) (`MatchesAcceptedFilter` and `ScoreMatchesFilter`, `.../SessionSelectionAiScores.razor.cs:48` and `:63`), and directly from markup for chip coloring: `.../SessionSelectionAiScores.razor:72` and `:76`, `.../SessionSelectionSpeakerOverlap.razor:45`, `:61`, `:65`, and the locality tiles on the page itself (`.../SessionSelectionDashboard.razor:194`).

### ScorePollTracker
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions.Selection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/ScorePollTracker.cs:31` · Level 1 · class (sealed, internal)

- **What it is**: the pure state machine behind the dashboard's fire-and-forget AI-scoring poll loop. It counts progress, stability, zero-progress polls, and consecutive failures, and converts each observation into a [ScorePollSignal](#scorepollsignal). It performs no I/O and touches no UI.
- **Depends on**: nothing first-party except the co-located [ScorePollSignal](#scorepollsignal) enum it returns; its whole state is four `int` fields.
- **Concept introduced: taming a fire-and-forget loop with an explicit budget.** `[Rubric §12, Performance and Scalability]` and `[Rubric §29, Resilience and Business Continuity]` both ask whether long-running work has bounded cost and a defined give-up path, and this class is where those bounds are written down as named constants instead of being scattered through a component. The class doc names the motivation directly (`ScorePollTracker.cs:25-30`): the state machine was extracted from the page code-behind so the component keeps only the UI side effects, which is the `[Rubric §18, UI Architecture]` concern about component size. `[Rubric §14, Testability]` applies because the whole loop policy can be exercised by calling `RegisterFetch` with a synthetic count series, with no timers and no rendering.
- **Walkthrough**: two public constants set the outer limits. `MaxPolls = 225` (`ScorePollTracker.cs:34`, documented as a 30-minute cap at 225 polls times an 8-second interval) and `MaxConsecutiveFailures = 5` (`:41`), whose doc comment explains why failures are tolerated at all: the polling task is fire-and-forget, so an escaping exception would be unobserved and would wedge the Score button until a full reload. Two private constants set the inner heuristics: `ZeroProgressLimit = 10` (`:48`, roughly 80 seconds with no scores saved at all, aimed at the silent-fail case such as a missing API key) and `StablePollsForCompletion = 3` (`:51`). Four fields carry the state (`:53-56`): `_previousCount`, `_stablePolls`, `_zeroProgressPolls`, `_consecutiveFailures`. `ResetFailures` (`:59`) zeroes the failure counter after any successful fetch; `RegisterFailure` (`:65-69`) increments it and returns `true` once the budget is exhausted. `RegisterFetch(currentCount, totalSessions)` (`:74-105`) is the core: a zero count increments `_zeroProgressPolls` and returns `GaveUpNoScores` at the limit, otherwise `Continue` (`:76-82`); any nonzero count clears the zero-progress counter (`:84`); a count greater than the previous one advances `_previousCount`, resets `_stablePolls`, and returns `CompletedAll` when the count has reached `totalSessions` (guarded by `totalSessions > 0`) or `Progressed` otherwise (`:86-93`); an unchanged count increments `_stablePolls` and returns `CompletedStable` at three (`:95-102`); anything else returns `Continue` (`:104`).
- **Why it's built this way**: server-side AI scoring is a batch whose duration depends on an external model, so the UI has no completion event to await and must infer completion from the score count. Treating completion as either full coverage or three unchanged polls yields an answer even when some sessions fail to score, and the separate zero-progress budget turns the common credential-failure case into a fast, loud error rather than a 30-minute silence.
- **Where it's used**: instantiated once per scoring run by [ScorePollSession](#scorepollsession)`.RunAsync` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/ScorePollSession.cs:55`), whose `for` loop bounds itself with `ScorePollTracker.MaxPolls` (`:57`).
- **Caveats / not-in-source**: the latency claim in the `MaxPolls` comment ("enough for ~200+ sessions at typical Haiku latency", `ScorePollTracker.cs:33`) is a code comment, not a measurement recorded in this repo.

### PublicScheduleRoomOptions
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicScheduleRoomOptions.cs:13` · Level 3 · class (internal static)

- **What it is**: the pure functions behind the public schedule's Room picker and Room column. Given the events [`PublicSessionList`](#publicsessionlist) has already loaded, `IndexNames` builds the id-to-name map the list renders with, and `Scope` returns the ordered room options for the active event filter plus the room filter that survives that scoping (`PublicScheduleRoomOptions.cs:20`, `:37`).
- **Depends on**: [`RoomDTO`](group-17-conference-domain.md#roomdto) and [`EventDTO`](group-17-conference-domain.md#eventdto) from `MMCA.ADC.Conference.Shared.Events` (`:1`), plus the `RoomIdentifierType` and `EventIdentifierType` aliases. Nothing else: no injected service, no fetch, no component base.
- **Concept introduced, the derived filter option set with a self-healing selection.** Two ideas are worth extracting from a sixty-line file.
  1. **Derive, do not fetch.** The class doc states the rule (`:5-9`): the page already reads `/events?includeChildren=true`, so its rooms are in memory and narrowing the schedule by room costs zero extra round trips. The same doc records the security consequence that comes for free: that events read is published-only for non-privileged audiences server-side, so an unpublished event's rooms can never reach the picker. `[Rubric §23, Front-End Performance & Rendering]` (assesses avoidable network work per interaction) and `[Rubric §26, Front-End Security]` (assesses that a client-derived option set cannot widen what the server already scoped).
  2. **A selection that cannot go stale.** The last block of `Scope` (`:53-55`) re-validates `selectedRoomId` against the freshly scoped list and returns `null` when the room is no longer offered. The comment names both ways that happens (`:51-52`): the reader switched events, or a stale choice was restored from saved page state by [`PublicSessionListFilterState`](#publicsessionlistfilterstate). Without it, an unreachable room id would filter every session out and the reader would see an empty schedule with no visible cause. `[Rubric §19, State Management & Data Flow]` (assesses that derived state is reconciled rather than left to drift) and `[Rubric §24, Forms, Validation & UX Safety]`.
- **Walkthrough**
  - `IndexNames` (`:18-27`): a nested loop over every loaded event's `Rooms`, adding each `Id`-to-`Name` pair with `TryAdd` (`:24`) so a room that two loaded events both reference is indexed once rather than throwing. The map it fills is the page's own `_roomNames` dictionary, added to in place (`:17`), which is what the list's Room column and mobile card line read.
  - `Scope` (`:37-58`): scoping (`:42-44`), where a non-null `eventId` takes that event's `Rooms` (an unknown id yields an empty list through the `?? []` fallback) and a null id, which only a privileged reader viewing every event can produce, takes the union across all loaded events; shaping (`:46-49`), `DistinctBy(r => r.Id)` because the union can repeat a room, then `OrderBy(Sort).ThenBy(Name, StringComparer.OrdinalIgnoreCase)` so the picker order is the organizer's intended order with a deterministic case-insensitive tiebreak; reconciliation (`:53-55`) and the tuple return (`:57`), which the caller destructures straight into its two fields.
- **Why it's built this way**: keeping this out of the page makes it a plain static function over data, directly unit-testable without a renderer, and it keeps the page's own code down to one line (`PublicSessionList.razor.cs:154-155`). `[Rubric §14, Testability]` and `[Rubric §1, SOLID]`.
- **Where it's used**: `IndexNames` is called once per events load (`PublicSessionList.razor.cs:142`); `Scope` is called by that page's `RefreshRoomOptions` (`:151-152`), from the initial load (`:147`) and from every event-filter change (`:216`). The options it returns are passed down to [`PublicSessionListFilterBar`](#publicsessionlistfilterbar)'s `Rooms` parameter and the surviving id to its `SelectedRoomId`.

### ScorePollHost
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions.Selection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/ScorePollSession.cs:19` · Level 4 · record (sealed, internal)

- **What it is**: the five-callback contract a [ScorePollSession](#scorepollsession) uses to reach back into the page that started it. The polling session owns no rendering: everything it needs from the component (the current load generation, the poll cadence, applying a board, re-rendering, finishing with a message) arrives as a delegate in this record.
- **Depends on**: [SessionSelectionDashboardDTO](group-17-conference-domain.md#sessionselectiondashboarddto) (the payload of `ApplyFreshDashboard`) and [ToastSeverity](group-15-common-ui-framework.md#toastseverity) (the severity of the finish message), plus BCL `Func<>`, `Action<>`, `Task`, and `TimeSpan`. It is a positional `record` with no body.
- **Concept introduced: the callback record as an inverted UI port.** `[Rubric §1, SOLID]` assesses dependency inversion and interface segregation: rather than handing the loop a reference to the whole component (which would let it touch any field and would make it untestable outside a renderer), the component passes exactly the five capabilities the loop needs, each as its own delegate. `[Rubric §19, State Management]` is the reason this shape exists at all: two of the five members are *readers*, not values. `CurrentGeneration` and `PollInterval` are `Func<>` rather than captured snapshots so the loop re-reads the page's live state on every tick, which is what lets an event switch supersede a running session mid-flight and lets a bUnit test shrink the cadence after the loop has already started.
- **Walkthrough**: `CurrentGeneration` (`ScorePollSession.cs:20`) reads the page's `_loadGeneration` counter, the value the loop compares its own generation against to decide it has been superseded. `PollInterval` (`:21`) reads the page's cadence, re-read every tick (`:15`). `ApplyFreshDashboard` (`:22`) hands a freshly polled [SessionSelectionDashboardDTO](group-17-conference-domain.md#sessionselectiondashboarddto) to the page, which swaps it in and recomputes the derived state. `RenderAsync` (`:23`) is the component's `InvokeAsync(StateHasChanged)`, so the re-render is marshalled onto the renderer's synchronization context from whatever thread the loop resumed on. `FinishScoring` (`:24`) ends the scoring session and surfaces the outcome as a toast, taking the message and a [ToastSeverity](group-15-common-ui-framework.md#toastseverity).
- **Why it's built this way**: the doc comment states the rule (`:9-13`): the loop raises side effects, the page performs them, so `StateHasChanged`, the toasts, and the generation counter that supersedes a stale session all stay on the component. Making the port a `record` of delegates instead of an interface keeps the wiring to one expression at the call site and avoids a second implementation existing only for tests.
- **Where it's used**: constructed inline by [SessionSelectionDashboard](#sessionselectiondashboard)`.PollForScoresAsync` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/SessionSelectionDashboard.razor.cs:219-224`) and consumed throughout [ScorePollSession](#scorepollsession).

### SessionSelectionAiScores
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions.Selection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/SessionSelectionAiScores.razor.cs:12` · Level 4 · class (partial component)

- **What it is**: the presentational AI-scores section of the selection dashboard. It renders the "Score Sessions with AI" action with its in-progress state and the per-session score table, narrowed by the parent's active filters. The scoring flow itself stays on the containing page and is triggered upward through an `EventCallback`.
- **Depends on**: [SessionSelectionDashboardDTO](group-17-conference-domain.md#sessionselectiondashboarddto) and its [SessionAiScoreDTO](group-17-conference-domain.md#sessionaiscoredto) rows (imported at `SessionSelectionAiScores.razor.cs:2`), [SessionSelectionDisplay](#sessionselectiondisplay) for the shared predicates, and the Blazor `[Parameter]` and `EventCallback` infrastructure from `Microsoft.AspNetCore.Components` (external, `:1`).
- **Concept introduced: lifting the action up via `EventCallback`.** `[Rubric §19, State Management]` favors child components that raise intent rather than own the operation; here the child never calls a service. The scoring trigger is exposed as `[Parameter] public EventCallback ScoreRequested` (`:16`) alongside an `IsScoring` flag the parent flips (`:15`), so the long-running scoring loop, its cancellation, and its toasts all live in [SessionSelectionDashboard](#sessionselectiondashboard) while this section only shows the button and the progress state. Like its sibling it is otherwise a pure function of its parameters (`:14-21`): the whole `Dashboard` DTO plus the same five filter strings, each defaulting to empty.
- **Walkthrough**: `HasActiveFilters` (`:23-26`) is a cheap short-circuit over the five filter strings. `FilteredAiScores` (`:28-40`) returns an empty list when the board has no scores yet (`:32-33`), returns `Dashboard.AiScores` untouched when no filter is active (`:35-36`), and otherwise materializes `ApplyAiScoreFilters` into an array with a collection expression (`:38`). `ApplyAiScoreFilters` (`:42-66`) is a straight pipeline of `Where` clauses over the flat score rows: status, applying the same null-equals-Accepted rule through [SessionSelectionDisplay](#sessionselectiondisplay)`.MatchesAcceptedFilter` (`:46-51`); locality against the row's `SpeakerLocalities` collection (`:53-54`); category against `SessionCategories` (`:56-57`); level as a case-insensitive equality on `SessionLevel` (`:59-60`); and score tier via `ScoreMatchesFilter` on `OverallScore` (`:62-63`). The markup colors each row's status and score chip through the same helper (`.../SessionSelectionAiScores.razor:72` and `:76`).
- **Why it's built this way**: the score table is a flat DTO list, so its filter pipeline is simpler than the speaker section's nested rebuild; sharing [SessionSelectionDisplay](#sessionselectiondisplay) keeps the two sections' notion of "matches this filter" identical even though their data shapes differ. Keeping the pipeline lazy until one final materialization avoids an intermediate array per filter stage (`[Rubric §23, Front-End Performance]`).
- **Where it's used**: rendered inside [SessionSelectionDashboard](#sessionselectiondashboard)'s markup (`.../SessionSelectionDashboard.razor:228-235`), where its `ScoreRequested` callback invokes the page's `ScoreSessionsAsync` (`.../SessionSelectionDashboard.razor.cs:161`); covered by `SessionSelectionAiScoresTests` in the Conference UI bUnit tier (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/Pages/SessionSelection/SessionSelectionAiScoresTests.cs`).

`[Rubric §16, AI-Native Application Architecture]` applies: this type is part of the AI session-scoring feature (a model call behind a port, versioned prompt and model, an evaluation gate, metered spend; ADR-111).

### SessionSelectionFilterOptions
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions.Selection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/SessionSelectionFilterOptions.cs:11` · Level 4 · record (sealed, internal)

- **What it is**: the four dropdown option lists the dashboard's filters bind to (statuses, localities, categories, levels), together with the pure projection that derives them from a loaded board. It holds no page state: it is the answer to "given this dashboard, what can the organizer filter by?".
- **Depends on**: [SessionSelectionDashboardDTO](group-17-conference-domain.md#sessionselectiondashboarddto) as the projection input (imported at `SessionSelectionFilterOptions.cs:1`), reading its `SpeakerOverlap.Speakers`, `AiScores`, `SpeakerLocality`, and `CategoryDistribution.Categories` collections. Externally it is LINQ plus `StringComparer.OrdinalIgnoreCase`.
- **Concept introduced: the derived-option projection as a static factory on a record.** `[Rubric §19, State Management]` distinguishes stored state from derived state; option lists are derived, so they are computed by one `static` method from the board and never edited afterwards. `[Rubric §14, Testability]` follows: the whole "what shows up in the pickers" rule set is one pure function of a DTO. The four `IReadOnlyList<string>` members (`:12-15`) are positional record parameters, so instances are immutable by construction.
- **Walkthrough**: a private `static readonly Empty` instance (`:17`) is the null-board answer, so callers never get `null` lists and no allocation happens on the not-yet-loaded path. `From(SessionSelectionDashboardDTO?)` (`:20-54`) returns `Empty` for a null board (`:22-25`), then derives each list. Statuses (`:28-33`) come from the union of every multi-session speaker's sessions and every AI-score row, with `null` normalized to `"Accepted"` (the same default [SessionSelectionDisplay](#sessionselectiondisplay)`.SessionMatchesStatus` applies), then de-duplicated and ordered case-insensitively. Localities (`:35-37`) are the `LocalityTier` values from the board's locality breakdown, ordered the same way. The level group is picked out by a `CategoryTitle.Contains("Level")` match (`:39-40`), and its items become the level list (`:42-44`); if no such group exists the list is empty. Categories (`:46-51`) then take every *other* category group's items, so the Level values do not appear twice in two different pickers, de-duplicated and ordered. All four use collection expressions over LINQ, materializing once at the end.
- **Why it's built this way**: the option lists must reflect only what the loaded event actually contains, otherwise the organizer can select a filter that matches nothing. Deriving statuses from both the speaker-overlap sessions and the score rows covers both child sections, and splitting the Level group out of the category options mirrors the two separate pickers in the markup (`.../SessionSelectionDashboard.razor:90-107`).
- **Where it's used**: called only by [SessionSelectionFilters](#sessionselectionfilters)`.ComputeOptions` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/SessionSelectionFilters.cs:74`), which copies the four lists onto the page's filter state.
- **Caveats / not-in-source**: the level group is identified by a title substring match, so it depends on the conference's category naming ("Level"). The category titles themselves come from the Conference data, not from this file.

### ScorePollSession
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions.Selection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/ScorePollSession.cs:36` · Level 5 · class (sealed, internal)

- **What it is**: one fire-and-forget AI-score polling run for the selection dashboard. It drives [ScorePollTracker](#scorepolltracker) (the pure counters) over repeated dashboard fetches and turns each resulting [ScorePollSignal](#scorepollsignal) into the page's UI side effects through a [ScorePollHost](#scorepollhost).
- **Depends on**: [ISessionSelectionUIService](#isessionselectionuiservice) for the fetch, `IStringLocalizer` for the outcome messages, and a [ScorePollHost](#scorepollhost) for the callbacks, all primary-constructor parameters (`ScorePollSession.cs:36-39`). Internally it uses [ScorePollTracker](#scorepolltracker), [ScorePollSignal](#scorepollsignal), [SessionSelectionDashboardDTO](group-17-conference-domain.md#sessionselectiondashboarddto), and [ToastSeverity](group-15-common-ui-framework.md#toastseverity); externally `Task.Delay`, `CancellationToken`, and the Conference `EventIdentifierType` alias.
- **Concept introduced: the generation guard against a superseded async loop.** `[Rubric §19, State Management]` asks whether asynchronous work can corrupt state it no longer owns. A polling run belongs to the event that was selected when scoring started; if the organizer switches events, the page bumps a generation counter and this loop, which re-reads that counter through `host.CurrentGeneration()`, exits instead of painting the previous event's board (and its toasts) over the new selection. Note the counter is checked *twice per tick*, once after the delay and once after the fetch (`:62` and `:68`), because both are await points where the selection can move. `[Rubric §29, Resilience and Business Continuity]` covers the second concept here: because [ISessionSelectionUIService](#isessionselectionuiservice) answers every non-2xx response and transport fault with a failed `Result` rather than an exception (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Sessions/Selection/ISessionSelectionUIService.cs:11-23`), the consecutive-failure budget has to be fed from the *result* path, and the code comment says exactly why (`:73-77`): left on the exception path it would be dead code and a persistently failing endpoint would poll silently to `MaxPolls` without ever reporting.
- **Walkthrough**: `RunAsync(eventId, generation, cancellationToken)` (`:50-108`) creates a tracker (`:55`) and loops up to `ScorePollTracker.MaxPolls` times (`:57`). Each iteration awaits `host.PollInterval()` under the page's disposal token (`:61`), checks the generation (`:62-65`), fetches the board through `selectionService.GetDashboardAsync` (`:67`), and checks the generation again (`:68-71`). A failed `Result` feeds `tracker.RegisterFailure()`, and when the budget is exhausted the run reports `Snackbar.ScoringPollFailed` as an error and returns (`:78-82`); a failure inside budget falls through to `continue` because `TryGetValue` yields nothing (`:84-87`). A successful fetch resets the failure counter (`:89`) and passes `AiScores.Count` and `TotalSessions` to `tracker.RegisterFetch`, handing the resulting signal to `HandleSignalAsync`; a `true` return means the run is over and the finish callback has already fired (`:90-93`). `OperationCanceledException` exits quietly, which is component disposal (`:95-99`). Falling out of the loop means the cap was reached, so, unless the run has meanwhile been superseded (`:102-105`), it reports `Snackbar.ScoringTimedOut` as a warning (`:107`). `HandleSignalAsync` (`:117-145`) is the effects half of the split introduced under [ScorePollSignal](#scorepollsignal): `GaveUpNoScores` finishes with an error (`:121-123`), `Progressed` applies the board and re-renders but keeps going (`:125-128`), `CompletedAll` applies, re-renders, and finishes with a success message carrying the score count (`:130-134`), `CompletedStable` applies and defers to `FinishStable` (`:136-139`), and `Continue` does nothing (`:141-143`). `FinishStable` (`:149-163`) compares `AiScores.Count` against `TotalSessions` and reports either `Snackbar.ScoringPartial` with the missed count as a warning or `Snackbar.ScoringComplete` as a success.
- **Why it's built this way**: the class doc states the placement rule (`:26-32`): the session was extracted from the page code-behind under the rubric §18 line cap, and it stays *beside the page* rather than moving into [ISessionSelectionUIService](#isessionselectionuiservice) because every step it takes is a rendering decision, not a data-access one. Every user-visible string is a resource key resolved through the injected localizer, so the outcome messages follow a language switch like the rest of the page (ADR-027, `Website/docs-src/adr/027-multi-locale-i18n.md`).
- **Where it's used**: constructed and run by [SessionSelectionDashboard](#sessionselectiondashboard)`.PollForScoresAsync` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/SessionSelectionDashboard.razor.cs:216-228`). Its supersede behavior is asserted end to end by `WhenEventChangesMidScoring_ThePollingSessionStopsWithoutTouchingTheNewBoard` (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/Pages/Sessions/Selection/SessionSelectionStaleResponseTests.cs:217`).
- **Caveats / not-in-source**: the resource keys used here (`Snackbar.ScoringPollFailed`, `Snackbar.ScoringNoScores`, `Snackbar.ScoringComplete`, `Snackbar.ScoringPartial`, `Snackbar.ScoringTimedOut`) resolve against the page's localizer, which the caller supplies; their text lives in `SessionSelectionDashboard.resx` and `SessionSelectionDashboard.es.resx`, not in this file.

### SessionSelectionFilters
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions.Selection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/SessionSelectionFilters.cs:13` · Level 5 · class (sealed, internal)

- **What it is**: the dashboard's filter state object. It holds the five selected values the markup two-way binds to (an empty string means "all") plus the four option lists derived from the loaded board, and it exposes the localized score-tier choices.
- **Depends on**: [SessionSelectionFilterOptions](#sessionselectionfilteroptions) for the derivation, [SessionSelectionDashboardDTO](group-17-conference-domain.md#sessionselectiondashboarddto) as the input to `ComputeOptions`, and `IStringLocalizer` (external, `SessionSelectionFilters.cs:1`) for the tier labels.
- **Concept introduced: the bindable state object as a component field.** `[Rubric §19, State Management]` is the whole point: five separate `_filterX` fields on the page would be five things to reset, five things to pass down, and five things to keep in step with their option lists. Collapsing them into one object lets the markup bind `@bind-Value="_filters.Status"` directly (`.../SessionSelectionDashboard.razor:70`) and lets the page reset or recompute everything with one call. `[Rubric §18, UI Architecture]` is the stated motive in the class doc (`:6-12`): extracted from the code-behind under the line cap so the component keeps only its load and scoring orchestration. `[Rubric §27, i18n]` shows in `ScoreTierOptions`, which is a method taking a localizer rather than a stored list, "so the labels follow a language switch" (`:42-45`, ADR-027).
- **Walkthrough**: the five selections are plain `get; set;` string properties defaulting to empty (`:16-28`): `Status`, `Locality`, `Category`, `Level`, `ScoreTier`. The four option lists (`:31-40`) are `IReadOnlyList<string>` with `private set`, so only this class can replace them; they start empty. `ScoreTierOptions(IStringLocalizer)` (`:47-58`) is `static` and returns nine label/value tuples pairing a localized label with the token [SessionSelectionDisplay](#sessionselectiondisplay)`.ScoreMatchesFilter` understands: the empty string for "all", then `"9.0"` down to `"3.0"`, then `"<3.0"` for Poor; the markup enumerates it directly (`.../SessionSelectionDashboard.razor:112`). `Reset()` (`:61-68`) clears all five selections back to "all". `ComputeOptions(SessionSelectionDashboardDTO?)` (`:72-79`) delegates the projection to [SessionSelectionFilterOptions](#sessionselectionfilteroptions)`.From` and copies its four lists across, so a null board yields four empty lists rather than a null reference.
- **Why it's built this way**: separating *selection* (mutable, bound to the UI) from *projection* (pure, derived from data) means a reload can recompute the options without disturbing the selections, and a fresh load can reset both with two calls. The page uses exactly that asymmetry: [SessionSelectionDashboard](#sessionselectiondashboard)`.LoadDashboardAsync` calls `Reset()` then `ComputeOptions(...)` for a new board (`.../SessionSelectionDashboard.razor.cs:133-134`), while `ApplyFreshDashboard` calls only `ComputeOptions(...)` mid-poll (`:240`), so the organizer's active filters survive a polling update.
- **Where it's used**: one instance is a `readonly` field on [SessionSelectionDashboard](#sessionselectiondashboard) (`.../SessionSelectionDashboard.razor.cs:43`), bound by the five `MudSelect` pickers in the page markup (`.../SessionSelectionDashboard.razor:70-115`) and passed down as parameters to [SessionSelectionSpeakerOverlap](#sessionselectionspeakeroverlap) (`:221-225`) and [SessionSelectionAiScores](#sessionselectionaiscores) (`:231-235`).

### SessionSelectionSpeakerOverlap
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions.Selection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/SessionSelectionSpeakerOverlap.razor.cs:11` · Level 7 · class (partial component)

- **What it is**: the presentational "speakers with multiple sessions" section of the selection dashboard. It lists each multi-session speaker with their locality and per-session status and score chips, narrowed to whatever filters the parent dashboard currently has active.
- **Depends on**: [MultiSessionSpeaker](group-17-conference-domain.md#multisessionspeaker) and [SpeakerSessionSummary](group-17-conference-domain.md#speakersessionsummary) (the DTOs it renders, imported at `SessionSelectionSpeakerOverlap.razor.cs:2`), [SessionSelectionDisplay](#sessionselectiondisplay) for the shared predicates, the `SessionIdentifierType` alias, and the Blazor `[Parameter]` infrastructure (external, `:1`).
- **Concept introduced: the presentational (dumb) child component.** `[Rubric §19, State Management]` distinguishes components that own state from components that only render state passed in; this is the second kind. It has no service injections and no mutable fields, only `[Parameter]` inputs (`:13-19`): the `Speakers` list, an `AiScoreLookup` dictionary from session id to score, and the five filter strings, each defaulting to empty. All state flows down from [SessionSelectionDashboard](#sessionselectiondashboard), which makes this component a pure function of its parameters. `[Rubric §18, UI Architecture]` is served by keeping the filtering in the code-behind and the template thin.
- **Walkthrough**: `HasActiveFilters` (`:21-24`) is a cheap short-circuit: when every filter string is empty the component returns `Speakers` unfiltered and only sorts. `FilteredSpeakerOverlap` (`:26-36`) is the computed view the markup binds to; it applies filters when any are set, then orders speakers case-insensitively by name (`:34`). `ApplySpeakerFilters` (`:38-59`) works in two passes: the locality filter drops whole speakers by comparing `LocalityCategory ?? "Unknown"` against the selection (`:42-46`); then, if any session-level filter is set, a record `with` expression rebuilds each speaker's `Sessions` collection keeping only matching sessions, and speakers left with zero sessions are dropped (`:48-56`). `SessionMatchesFilters` (`:61-65`) ands together the status test (delegated to [SessionSelectionDisplay](#sessionselectiondisplay)`.SessionMatchesStatus`), a category and a level test that both search the session's `CategoryItemNames`, and the score-tier test. `SessionMatchesScoreTier` (`:67-69`) looks the session up in `AiScoreLookup` and returns false when the session has no score yet, so an active score-tier filter hides unscored sessions.
- **Why it's built this way**: rebuilding the speaker record with a filtered `Sessions` list (rather than hiding rows in markup) means the "drop empty speakers" rule and the sort both operate on already-filtered data, so the rendered list and any counts derived from it stay consistent. The `with` copy leaves the source DTOs untouched, which matters because the parent keeps rendering from the same board.
- **Where it's used**: rendered inside [SessionSelectionDashboard](#sessionselectiondashboard)'s markup (`.../SessionSelectionDashboard.razor:219-225`), fed the board's speakers, the page's `_aiScoreLookup`, and the five values off [SessionSelectionFilters](#sessionselectionfilters); covered by `SessionSelectionSpeakerOverlapTests` in the Conference UI bUnit tier.

### SessionSelectionDashboard
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions.Selection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/Selection/SessionSelectionDashboard.razor.cs:16` · Level 9 · class (partial component)

- **What it is**: the organizer decision-support page for choosing a conference program. It picks an event (defaulting to the current or next one), loads its decision-support DTO (category distribution, speaker overlap, content similarity, locality breakdown, AI scores), owns the filter state the two child sections read, and starts the asynchronous "score all sessions with AI" flow.
- **Depends on**: [ISessionSelectionUIService](#isessionselectionuiservice) (loads the board and starts scoring), [IEventLookupService](#ieventlookupservice) (the event picker source), and [IToastService](group-15-common-ui-framework.md#itoastservice), all injected as properties (`SessionSelectionDashboard.razor.cs:18-20`); [SessionSelectionDashboardDTO](group-17-conference-domain.md#sessionselectiondashboarddto), [EventInfo](#eventinfo), [CurrentEventSelector](group-17-conference-domain.md#currenteventselector), [ConferenceRoutePaths](#conferenceroutepaths), [ToastSeverity](group-15-common-ui-framework.md#toastseverity), and the co-located [SessionSelectionFilters](#sessionselectionfilters), [ScorePollSession](#scorepollsession), and [ScorePollHost](#scorepollhost). It composes [SessionSelectionSpeakerOverlap](#sessionselectionspeakeroverlap) and [SessionSelectionAiScores](#sessionselectionaiscores) in its markup, and the page is routed and role-gated in the `.razor` half (`@page "/sessions/selection-dashboard"` with `[Authorize(Roles = "Organizer")]`, `.../SessionSelectionDashboard.razor:1-2`).
- **Concept introduced: the smart (container) component that owns state and lifecycle, and the load-generation counter.** This is the counterpart to the two presentational sections above. `[Rubric §19, State Management]` is fully exercised: the component holds the loaded DTO, the selected event id, the filter object, the `_aiScoreLookup`, and the loading and error flags (`:21-45`), and passes what the children need down as parameters. The generation counter `_loadGeneration` (`:38`) is the concept worth learning here: any `await` in a Blazor page is a window in which the user can change the selection, so every asynchronous result must prove it is still wanted before it writes anything. The field's doc comment (`:32-37`) explains why the *generation* and not the event id is authoritative: switching away from an event and back must still discard the first response even though both carry the same id. `[Rubric §18, UI Architecture]` is served by splitting a large page into a container, two presentational children, an extracted filter object, and an extracted polling session. `[Rubric §14, Testability]` shows in `internal TimeSpan PollInterval` (`:203`), documented as internal precisely so bUnit tests can shrink the cadence and exercise the loop quickly (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/Pages/Sessions/Selection/SessionSelectionDashboardTests.cs:306`). `[Rubric §27, i18n]` applies throughout: every user-visible string resolves through the injected `IStringLocalizer<SessionSelectionDashboard>` (`.../SessionSelectionDashboard.razor:5`) against the co-located `SessionSelectionDashboard.resx` and its `.es.resx` translation (ADR-027). `[Rubric §11, Security]` applies with the usual caveat that the `Organizer` role attribute is a UX gate; the services behind it enforce authorization independently.
- **Walkthrough**: the component implements `IDisposable` and owns a `CancellationTokenSource` (`:21`) that every service call threads through; `Dispose` cancels and disposes it exactly once via the guarded `_disposed` pattern (`:251-273`). `OnInitializedAsync` (`:47-87`) builds the three breadcrumbs (`:49-54`), loads the events, and defaults the picker through [CurrentEventSelector](group-17-conference-domain.md#currenteventselector)`.SelectCurrentOrNext` (`:67-72`: live now, else next upcoming, else most recently ended), then loads the board; `OperationCanceledException` is swallowed as disposal and `IsLoading` is cleared in the `finally` (`:79-86`). `OnEventSelectedAsync` (`:89-105`) bumps `_loadGeneration` *before* the selection moves (`:94`), so both the load path and the clear path supersede anything in flight. `LoadDashboardAsync` (`:107-154`) is the generation pattern in full: it snapshots the generation and the requested id (`:114-115`), turns the spinner on, fetches, and then returns early if superseded (`:127-128`, with the comment noting that a superseded *failure* must not paint an error banner over a board that loaded fine); on success it stores the board, calls `_filters.Reset()` and `_filters.ComputeOptions(...)`, and rebuilds the score lookup (`:130-136`); and even the `finally` is generation-guarded so a stale response cannot switch off the spinner a newer load just turned on (`:149-152`). `RebuildAiScoreLookup` (`:156-159`) projects the score rows into a `SessionId` to `OverallScore` dictionary for the speaker section. `ScoreSessionsAsync` (`:161-200`) sets `_isScoring`, clears the visible scores with a `with` expression, and calls the service; a failed `Result` (including the 409 already-running or queue-full conflict) toasts an error and clears the flag (`:173-179`), a `SessionsScored == -1` result means the server accepted the work asynchronously so it toasts "started" and launches the fire-and-forget `PollForScoresAsync` (`:180-184`), and a synchronous result toasts the scored and failed counts and reloads (`:185-191`). The closing comment (`:197-199`) documents why there is no `finally` here: only the accepted asynchronous path leaves `_isScoring` set, handing ownership of the flag to the polling task. `PollForScoresAsync` (`:210-235`) builds a [ScorePollSession](#scorepollsession) with the service, the localizer, and a [ScorePollHost](#scorepollhost) wired to `_loadGeneration`, `PollInterval`, `ApplyFreshDashboard`, `InvokeAsync(StateHasChanged)`, and `FinishScoring` (`:215-223`), runs it, and clears `_isScoring` in a `finally` so the Score button always comes back whatever path exits the loop (`:229-234`). `ApplyFreshDashboard` (`:237-242`) swaps the board in and recomputes the options and the lookup, deliberately without resetting the filters. `FinishScoring` (`:244-249`) clears the flag, shows the toast, and requests a re-render.
- **Why it's built this way**: AI scoring is a long, failure-prone batch that depends on an external model with variable latency, so the page cannot block on it and there is no server push channel for this surface. Delegating the loop to [ScorePollSession](#scorepollsession) and the counting policy to [ScorePollTracker](#scorepolltracker) leaves this class holding only lifecycle, state, and UI effects, which is what keeps a page with this much behavior inside the rubric §18 size expectation. Cancelling the token on disposal stops the loop from outliving the page, and the generation counter stops it from outliving its *event*.
- **Where it's used**: the organizer route `/sessions/selection-dashboard`, reachable from the admin navigation registered by [ConferenceUIModule](#conferenceuimodule); covered by `SessionSelectionDashboardTests` and `SessionSelectionStaleResponseTests` in the Conference UI bUnit tier (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/Pages/SessionSelection/`).
- **Caveats / not-in-source**: the `-1` sentinel on `SessionsScored` is what distinguishes a deferred scoring start from a synchronous one; its meaning is documented on [ISessionSelectionUIService](#isessionselectionuiservice) (`.../Services/ISessionSelectionUIService.cs:15-20`) and produced by the server-side handler, not by this component. The model used for scoring, its per-session timeout, and its failure modes are not determinable from this file.

### CategoryItemInfo

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Categories/ICategoryItemLookupService.cs:9` · Level 0 · record

- **What it is**: a four-field projection record carrying everything a Conference page needs to render
  one category item: `Id`, `Name`, `CategoryId`, and the parent category's `CategoryTitle`
  (`ICategoryItemLookupService.cs:9-13`). It is the value type of the category-item lookup dictionary,
  not a wire contract and not a domain type.
- **Depends on**: no first-party types. Its two id parameters use the Conference identifier aliases
  `CategoryItemIdentifierType` and `ConferenceCategoryIdentifierType`, both `int` in this module
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:6-7`).
  BCL `string`.
- **Concept introduced, the UI lookup projection.** `[Rubric §18, UI Architecture]` (assesses whether
  the front end keeps its own display-shaped models instead of dragging server contracts through the
  render tree; this record is a UI-owned shape with three display fields and one key).
  `[Rubric §23, Front-End Performance]` (assesses avoiding per-row round-trips: a list page holds
  category item *ids* but must render category item *names*, so the page pre-loads a dictionary of
  these records once and indexes it during render instead of issuing one request per row).
  `[Rubric §19, State Management]` (the dictionary is page-local state loaded once, not an ambient
  store). The same shape repeats for events and speakers, see [EventInfo](#eventinfo) and
  [SpeakerInfo](#speakerinfo).
- **Walkthrough**: a positional record with four members and no body.
  - `Id` (`ICategoryItemLookupService.cs:10`): the dictionary key.
  - `Name` (line 11): the item's display name, for example a track or level value.
  - `CategoryId` (line 12): the owning category, which lets a page group items by category without a
    second fetch.
  - `CategoryTitle` (line 13): the parent category's title, denormalized onto the item. It is filled
    in by [CategoryItemLookupService](#categoryitemlookupservice) from a separate categories request
    and falls back to `string.Empty` when the parent title is not found
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Categories/CategoryItemLookupService.cs:78-79`).
- **Why it's built this way**: the denormalized `CategoryTitle` exists so a page can render the
  combined label without holding a second dictionary. [SessionLookups](#sessionlookups) does exactly
  that: `string.IsNullOrEmpty(item.CategoryTitle) ? item.Name : $"{item.CategoryTitle}: {item.Name}"`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/SessionLookups.cs:168`),
  and [PublicSessionDetail](#publicsessiondetail) uses the same expression
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Sessions/PublicSessionDetail.razor.cs:215`).
  The empty-title fallback keeps the label sensible rather than rendering a stray colon.
- **Where it's used**: produced by [CategoryItemLookupService](#categoryitemlookupservice) behind
  [ICategoryItemLookupService](#icategoryitemlookupservice); consumed by
  [SessionLookups](#sessionlookups) (`SessionLookups.cs:35`), which serves
  [SessionDetail](#sessiondetail), by [PublicSessionDetail](#publicsessiondetail)
  (`PublicSessionDetail.razor.cs:31`), and, gathered with two sibling dictionaries, by
  [SpeakerDetailLookups](#speakerdetaillookups).

### ChildEntityDeletePath

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Common` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Common/ChildEntityServices.cs:76` · Level 0 · class

- **What it is**: an `internal static` helper with a single generic method that builds the
  `"{childId}?{parent}={parentId}"` suffix the join endpoints' DELETE takes
  (`ChildEntityServices.cs:76-87`). It is the smallest type in this group and the one that decides
  whether a removal works at all.
- **Depends on**: no first-party types. BCL `Convert`, `CultureInfo.InvariantCulture`
  (`ChildEntityServices.cs:1`), `Uri.EscapeDataString`, `string.Concat`.
- **Concept introduced, the parent-scoped child delete.** `[Rubric §9, API & Contract Design]`
  (assesses whether the client speaks the URL shape the server actually implements). The join
  controllers remove a row by loading the OWNING aggregate and asking it to drop the child, so the
  parent id is not decoration: the class doc records that a DELETE sent without it binds the parent id
  to its `default` value, that aggregate is never found, and the API answers 404 while the UI reports a
  generic failure (`ChildEntityServices.cs:14-21`, `:71-75`). `[Rubric §15, Best Practices & Code Quality]`: the
  whole difference between a working removal and a 404 lives in this one place instead of being
  concatenated at four call sites. `[Rubric §26, Front-End Security]` in its smallest form: the parent
  id is percent-encoded before it reaches the query string.
- **Walkthrough**: one method, `For<TChildId, TParentId>(TChildId childId, string parentName, TParentId parentId)`
  (`ChildEntityServices.cs:78`), constrained `where TChildId : notnull` and `where TParentId : notnull`
  (lines 79-80). The body is a single `string.Concat` (lines 81-86) that formats the child id with
  `Convert.ToString(..., CultureInfo.InvariantCulture)` (invariant so an `int` id never picks up a
  culture-specific group separator), appends `"?"`, the caller's parameter name and `"="`, then the
  parent id through the same invariant conversion wrapped in `Uri.EscapeDataString`. Both conversions
  fall back to `string.Empty` on a null result. The generic parameters matter because Conference ids
  are not one type: `SpeakerIdentifierType` is a `System.Guid` while every other alias here is `int`
  (`MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:5-21`).
- **Why it's built this way**: the shared
  [ChildEntityServiceBase](group-15-common-ui-framework.md#childentityservicebase) appends whatever
  string it is given straight onto the endpoint, `var url = $"{endpoint}/{id}"`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/ChildEntityServiceBase.cs:75`), so the
  query has to be baked into the "id" argument. Keeping that formatting in one internal helper rather
  than in the framework base keeps the base generic while making the Conference-specific convention
  explicit.
- **Where it's used**: all four join services in the same file, each supplying its own parent
  parameter name: `EventSpeakerService` with `"eventId"` (`ChildEntityServices.cs:29`),
  `SessionSpeakerService` with `"sessionId"` (line 42), `SessionCategoryItemService` with `"sessionId"`
  (line 55), and `SpeakerCategoryItemService` with `"speakerId"` (line 68).

### ICategoryItemLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Categories/ICategoryItemLookupService.cs:18` · Level 3 · interface

- **What it is**: the contract for the category-item lookup: fetch everything once, hand back a
  dictionary wrapped in a [Result](group-01-result-error-handling.md#result)
  (`ICategoryItemLookupService.cs:18-22`).
- **Depends on**: [CategoryItemInfo](#categoryiteminfo) (the dictionary value), the
  `CategoryItemIdentifierType` alias, and `Result<T>` from `MMCA.Common.Shared.Abstractions`
  (`ICategoryItemLookupService.cs:1`). BCL `Task`, `IReadOnlyDictionary`, `CancellationToken`.
- **Concept introduced, the bulk-then-index lookup contract.** `[Rubric §23, Front-End Performance]`
  (assesses how many round-trips a render costs; one call plus O(1) dictionary reads replaces one
  request per referenced id) and `[Rubric §1, SOLID]` (a single-method interface is the smallest
  dependency a page can take, and it is what the UI tests substitute). Returning
  `IReadOnlyDictionary<,>` rather than a list is the point of the contract: the caller is told, by the
  type, that this is a key-indexed cache to read from, not a collection to search. The `Result<T>`
  envelope is the second half: a failed fetch is a value the page branches on, not an exception, which
  is the workspace-wide Result pattern taught in [00-primer.md](00-primer.md).
- **Walkthrough**: one member,
  `GetAllAsync(CancellationToken cancellationToken = default)` returning
  `Task<Result<IReadOnlyDictionary<CategoryItemIdentifierType, CategoryItemInfo>>>`
  (`ICategoryItemLookupService.cs:20-21`). The cancellation token is optional and defaulted, so page
  code can pass its own component-scoped token.
- **Why it's built this way**: pages depend on this interface, never on the HTTP class, so the two
  requests the implementation actually makes (categories, then a 10000-page-size items read) stay an
  implementation detail (`CategoryItemLookupService.cs:22-38`).
- **Where it's used**: implemented by [CategoryItemLookupService](#categoryitemlookupservice),
  registered scoped at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:53` under the
  "cross-module lookup services" comment, and injected into [SessionLookups](#sessionlookups)
  (`SessionLookups.cs:35`), [PublicSessionDetail](#publicsessiondetail)
  (`PublicSessionDetail.razor.cs:31`), and
  [SpeakerDetailLookupService](#speakerdetaillookupservice) (`SpeakerDetailLookupService.cs:14`).

### IEventSpeakerUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Common` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Common/IChildEntityUIService.cs:14` · Level 3 · interface

- **What it is**: the UI contract for managing `EventSpeaker` join rows, that is, attaching a speaker
  to an event and detaching one (`IChildEntityUIService.cs:14-18`). It is the first of four
  structurally identical join contracts declared in this one file.
- **Depends on**: [EventSpeakerDTO](group-17-conference-domain.md#eventspeakerdto) (the created row it
  returns), the `EventIdentifierType`, `SpeakerIdentifierType`, and `EventSpeakerIdentifierType`
  aliases, and `Result` / `Result<T>`. BCL `Task`, `CancellationToken`.
- **Concept introduced, the add/remove-only join contract.** `[Rubric §9, API & Contract Design]`
  (assesses whether a contract exposes the operations the resource actually supports; a join row has
  no fields to edit, so there is no `Update` and no `GetById`, only `Add` and `Delete`).
  `[Rubric §18, UI Architecture]` (a page edits an association through a typed service, not by
  hand-rolling a POST). `[Rubric §1, SOLID]`: four narrow interfaces instead of one generic
  `IJoinService<,>` means each page injects exactly the association it edits, and the implementations
  keep strongly typed parameter names (`eventId`, `speakerId`) rather than two anonymous ids. Note the
  asymmetry that makes these contracts safe. `AddAsync` takes the two *parent* ids, while `DeleteAsync`
  takes the owning aggregate's id **and** the join row's own id, because the API removes a row by
  loading that aggregate and asking it to drop the child; the doc comment states plainly that a call
  without the parent id deletes nothing and answers 404 (`IChildEntityUIService.cs:8-13`). The
  formatting of that pair is [ChildEntityDeletePath](#childentitydeletepath)'s job.
- **Walkthrough**
  - `AddAsync(eventId, speakerId, ct)` (`IChildEntityUIService.cs:16`): returns
    `Task<Result<EventSpeakerDTO>>`, the created row read back from the response body.
  - `DeleteAsync(eventId, id, ct)` (line 17): takes the event id and the `EventSpeakerIdentifierType`
    and returns `Task<Result>`, a non-generic Result, so a 404 arrives as an
    [ErrorType](group-01-result-error-handling.md#errortype)`.NotFound` failure rather than as a bare
    `false` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/ChildEntityServiceBase.cs:62-70`).
- **The family**: all four contracts in this file share that shape and differ only in the ids and the
  DTO.

  | Type | File:Line | Add parameters | Returns / delete key |
  |------|-----------|----------------|----------------------|
  | `IEventSpeakerUIService` | `IChildEntityUIService.cs:14` | `eventId`, `speakerId` | [EventSpeakerDTO](group-17-conference-domain.md#eventspeakerdto) / `eventId` + `EventSpeakerIdentifierType` |
  | `ISessionSpeakerUIService` | `IChildEntityUIService.cs:26` | `sessionId`, `speakerId` | [SessionSpeakerDTO](group-17-conference-domain.md#sessionspeakerdto) / `sessionId` + `SessionSpeakerIdentifierType` |
  | `ISessionCategoryItemUIService` | `IChildEntityUIService.cs:38` | `sessionId`, `categoryItemId` | [SessionCategoryItemDTO](group-17-conference-domain.md#sessioncategoryitemdto) / `sessionId` + `SessionCategoryItemIdentifierType` |
  | `ISpeakerCategoryItemUIService` | `IChildEntityUIService.cs:50` | `speakerId`, `categoryItemId` | [SpeakerCategoryItemDTO](group-17-conference-domain.md#speakercategoryitemdto) / `speakerId` + `SpeakerCategoryItemIdentifierType` |

- **Why it's built this way**: keeping the four as separate interfaces in one file makes the family
  obvious to a reader while still giving DI four distinct binding targets
  (`DependencyInjection.cs:32-35`). The implementations are equally uniform: each derives from the
  shared [ChildEntityServiceBase](group-15-common-ui-framework.md#childentityservicebase) and supplies
  only its resource root (`ChildEntityServices.cs:23,36,49,62`).
- **Where it's used**: implemented by [EventSpeakerService](#eventspeakerservice)
  (`ChildEntityServices.cs:22-23`) and registered scoped at `DependencyInjection.cs:32`.
- **Caveats / not-in-source**: unlike its three siblings, this contract has no page consumer in the
  current source. It is registered and implemented, but no Razor component injects
  `IEventSpeakerUIService` today, so the event-to-speaker association is reachable only through the
  API. The three session and speaker join contracts are all wired into pages.

### ISessionCategoryItemUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Common` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Common/IChildEntityUIService.cs:38` · Level 3 · interface

- **What it is**: the join contract for tagging a session with a category item and untagging it
  (`IChildEntityUIService.cs:38-42`).
- **Depends on**: [SessionCategoryItemDTO](group-17-conference-domain.md#sessioncategoryitemdto), the
  `SessionIdentifierType`, `CategoryItemIdentifierType`, and `SessionCategoryItemIdentifierType`
  aliases, and `Result` / `Result<T>`.
- **Concept**: the add/remove-only join contract taught at
  [IEventSpeakerUIService](#ieventspeakeruiservice), including the family table and the
  parent-scoped delete. `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: `AddAsync(sessionId, categoryItemId, ct)` returning
  `Task<Result<SessionCategoryItemDTO>>` (line 40) and `DeleteAsync(sessionId, id, ct)` returning
  `Task<Result>` (line 41).
- **Where it's used**: implemented by [SessionCategoryItemService](#sessioncategoryitemservice)
  (`ChildEntityServices.cs:48-49`), registered at `DependencyInjection.cs:34`, injected into
  [SessionDetail](#sessiondetail) (`SessionDetail.razor.cs:33`), which pairs it with
  [ICategoryItemLookupService](#icategoryitemlookupservice), reached through
  [SessionLookups](#sessionlookups), to offer the untagged items as choices.

### ISessionSpeakerUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Common` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Common/IChildEntityUIService.cs:26` · Level 3 · interface

- **What it is**: the join contract for adding a speaker to a session and removing one
  (`IChildEntityUIService.cs:26-30`).
- **Depends on**: [SessionSpeakerDTO](group-17-conference-domain.md#sessionspeakerdto), the
  `SessionIdentifierType`, `SpeakerIdentifierType`, and `SessionSpeakerIdentifierType` aliases, and
  `Result` / `Result<T>`.
- **Concept**: see [IEventSpeakerUIService](#ieventspeakeruiservice) for the shared shape and the
  family table. `[Rubric §18, UI Architecture]`. This is the one member of the family whose two ids in
  `AddAsync` are of different CLR types, an `int` session and a `Guid` speaker, which is why the family
  was written as four typed interfaces rather than one generic pair of ids.
- **Walkthrough**: `AddAsync(sessionId, speakerId, ct)` returning `Task<Result<SessionSpeakerDTO>>`
  (line 28) and `DeleteAsync(sessionId, id, ct)` returning `Task<Result>` (line 29).
- **Where it's used**: implemented by [SessionSpeakerService](#sessionspeakerservice)
  (`ChildEntityServices.cs:35-36`), registered at `DependencyInjection.cs:33`, injected into
  [SessionDetail](#sessiondetail) (`SessionDetail.razor.cs:32`).

### ISpeakerCategoryItemUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Common` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Common/IChildEntityUIService.cs:50` · Level 3 · interface

- **What it is**: the join contract for tagging a speaker with a category item, which is how speaker
  attributes such as locality are modeled, and untagging one (`IChildEntityUIService.cs:50-54`).
- **Depends on**: [SpeakerCategoryItemDTO](group-17-conference-domain.md#speakercategoryitemdto), the
  `SpeakerIdentifierType`, `CategoryItemIdentifierType`, and `SpeakerCategoryItemIdentifierType`
  aliases, and `Result` / `Result<T>`.
- **Concept**: see [IEventSpeakerUIService](#ieventspeakeruiservice). `[Rubric §9, API & Contract
  Design]`. Its delete is the one that carries a `Guid` parent id into the query string, which is why
  [ChildEntityDeletePath](#childentitydeletepath) is generic and escapes the parent value
  (`ChildEntityServices.cs:68`).
- **Walkthrough**: `AddAsync(speakerId, categoryItemId, ct)` returning
  `Task<Result<SpeakerCategoryItemDTO>>` (line 52) and `DeleteAsync(speakerId, id, ct)` returning
  `Task<Result>` (line 53).
- **Where it's used**: implemented by [SpeakerCategoryItemService](#speakercategoryitemservice)
  (`ChildEntityServices.cs:61-62`), registered at `DependencyInjection.cs:35`, injected into
  [SpeakerCategoryItemsPanel](#speakercategoryitemspanel)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerCategoryItemsPanel.razor.cs:19`),
  the component [SpeakerDetail](#speakerdetail) hosts.

### CategoryItemLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Categories/CategoryItemLookupService.cs:12` · Level 4 · class (sealed)

- **What it is**: the implementation behind [ICategoryItemLookupService](#icategoryitemlookupservice).
  It makes **two** API calls, one for the categories and one for the items, then joins them in memory
  into a dictionary of [CategoryItemInfo](#categoryiteminfo) (`CategoryItemLookupService.cs:12-83`).
- **Depends on**: [CategoryItemInfo](#categoryiteminfo) (what it emits),
  [CategoryItemDTO](group-17-conference-domain.md#categoryitemdto) and
  [ConferenceCategoryDTO](group-17-conference-domain.md#conferencecategorydto) (the wire shapes it
  reads), [CollectionResult<T>](group-01-result-error-handling.md#collectionresultt) and
  [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) (the two
  envelopes those endpoints return),
  [HttpResultExecutor](group-15-common-ui-framework.md#httpresultexecutor) and
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader) (the two halves of the
  railway conversion), and BCL `IHttpClientFactory`. Note what it does **not** take: no token storage
  (`CategoryItemLookupService.cs:12`), so this is an unauthenticated read, unlike the entity services
  that derive from
  [AuthenticatedServiceBase](group-15-common-ui-framework.md#authenticatedservicebase).
- **Concept introduced, the client-side join.** `[Rubric §23, Front-End Performance]` assesses whether
  the front end minimizes round trips for a render, and `[Rubric §8, Data Architecture]` assesses where
  denormalization happens. The category-item endpoint returns a `CategoryId` but not the category's
  title, and the UI wants the pair. Rather than asking the server for a nested projection or fetching
  the parent per item, the client pulls both small collections once and does the join itself, producing
  the denormalized [CategoryItemInfo](#categoryiteminfo). Two round trips total, regardless of how many
  items or how many rows the page renders. The second concept here is the **two-part railway
  conversion** that every lookup in this family uses:
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader) converts a *response* into a
  [Result](group-01-result-error-handling.md#result) with the server's original
  [ErrorType](group-01-result-error-handling.md#errortype) intact, while
  [HttpResultExecutor](group-15-common-ui-framework.md#httpresultexecutor) converts the *absence* of a
  response (refused connection, DNS failure, dropped socket, client timeout) into a failure, and
  deliberately lets caller cancellation propagate as an exception rather than reporting a disposed page
  as an error
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/HttpResultExecutor.cs:11-23`). Both halves
  are what let this method be honestly typed as returning a `Result`.
- **Walkthrough**: one public method, `GetAllAsync(ct)` (`CategoryItemLookupService.cs:15-43`), with the
  whole body wrapped in `HttpResultExecutor.ExecuteAsync` (`:17`).
  - Resolves the named `"APIClient"` `HttpClient` from the factory in a `using` (`:20`), so the per-call
    handler lifetime is the factory's concern.
  - GETs `conferencecategories?includeFKs=false&includeChildren=false` through the private
    `GetAsync<T>` helper into a
    [CollectionResult<ConferenceCategoryDTO>](group-01-result-error-handling.md#collectionresultt)
    (`:22-25`). This one is the non-paged envelope: the category list is small and unpaged.
  - Short-circuits on failure, re-wrapping the errors under the dictionary's type parameter (`:27-31`),
    so a failed first call is never silently treated as "no categories".
  - `BuildCategoryTitles` folds the categories into a `Dictionary<ConferenceCategoryIdentifierType,
    string>`, null-guarding the collection (`:54-67`).
  - GETs `categoryitems?includeFKs=false&includeChildren=false&pageSize=10000` into a
    [PagedCollectionResult<CategoryItemDTO>](group-01-result-error-handling.md#pagedcollectionresultt)
    (`:35-38`).
  - `Map` projects the successful page through `BuildLookup` (`:40-41`), which loops the items,
    resolves each parent title with `TryGetValue` falling back to `string.Empty`, and stores one
    [CategoryItemInfo](#categoryiteminfo) per id (`:69-83`).
  - The private `GetAsync<T>` (`:45-52`) is the shared read step: one `GetAsync`, one
    `ProblemDetailsResultReader.ReadAsync<T>` (`:51`).
- **Why it's built this way**: `includeFKs=false&includeChildren=false` keeps both payloads flat and
  small, which is the whole point of a lookup fetch, no navigation graphs, only the display fields. The
  `TryGetValue` fallback (`:78`) means a missing or newly added category degrades to an unprefixed label
  instead of throwing mid-render.
- **Where it's used**: registered scoped in `AddConferenceUI` against
  [ICategoryItemLookupService](#icategoryitemlookupservice) (`DependencyInjection.cs:53`); injected into
  [SessionDetail](#sessiondetail) (`Pages/Session/SessionDetail.razor.cs:26`) and
  [PublicSessionDetail](#publicsessiondetail) (`Pages/Public/PublicSessionDetail.razor.cs:27`), taken as
  a constructor argument by [SessionLookups](#sessionlookups) (`Pages/Session/SessionLookups.cs:32`),
  and composed by [SpeakerDetailLookupService](#speakerdetaillookupservice) as the first of its three
  loads (`Services/SpeakerDetailLookupService.cs:12,20`).
- **Caveats / not-in-source**: the `pageSize=10000` request (`CategoryItemLookupService.cs:37`) is a
  hard ceiling; beyond 10,000 category items the lookup would silently drop the remainder, and there is
  no follow-on page request. The categories call sends no page size at all (`:24`), so it depends on
  that endpoint returning the full set. Nothing memoizes the result inside this class: each
  `GetAllAsync` call re-issues both requests, and the scoped registration only means one instance per
  request or circuit scope, not one fetch. Its sibling
  [EventLookupService](#eventlookupservice) does memoize, so the two lookups are not interchangeable on
  that point.

### ICategoryItemUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Categories/ICategoryItemUIService.cs:9` · Level 4 · interface

- **What it is**: the UI-service contract for the `categoryitems` REST resource, an empty marker over
  [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [CategoryItemDTO](group-17-conference-domain.md#categoryitemdto) and
  `CategoryItemIdentifierType` (`ICategoryItemUIService.cs:9-11`).
- **Depends on**: [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  (imported at `ICategoryItemUIService.cs:2`) and
  [CategoryItemDTO](group-17-conference-domain.md#categoryitemdto) (imported at
  `ICategoryItemUIService.cs:1`).
- **Concept**: identical shape to [IActivityUIService](#iactivityuiservice); see it for the
  marker-interface and assembly-scan rationale. `[Rubric §18, UI Architecture]`.
- **Walkthrough**: no members. The doc comment (`ICategoryItemUIService.cs:6-8`) repeats the "uses
  generic CRUD" formula.
- **Where it's used**: implemented by [CategoryItemService](#categoryitemservice); injected into
  [ConferenceCategoryItemsPanel](#conferencecategoryitemspanel), the editor for the items belonging to a
  category (`Pages/ConferenceCategory/ConferenceCategoryItemsPanel.razor.cs:24`). It is the one CRUD
  marker in this family with a single consumer: category items are only ever managed from inside their
  parent category, never as a top-level list. Read-side enrichment of category items goes through the
  separate [ICategoryItemLookupService](#icategoryitemlookupservice) instead.

### IConferenceCategoryUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Categories/IConferenceCategoryUIService.cs:9` · Level 4 · interface

- **What it is**: the UI-service contract for the `conferencecategories` REST resource, an empty marker
  over [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [ConferenceCategoryDTO](group-17-conference-domain.md#conferencecategorydto) and
  `ConferenceCategoryIdentifierType` (`IConferenceCategoryUIService.cs:9-11`).
- **Depends on**: [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  and [ConferenceCategoryDTO](group-17-conference-domain.md#conferencecategorydto).
- **Concept**: identical shape to [IActivityUIService](#iactivityuiservice). `[Rubric §18, UI
  Architecture]` and `[Rubric §15, Best Practices & Code Quality]` (a new aggregate resource costs one empty interface
  plus one thin class).
- **Walkthrough**: no members (doc comment `IConferenceCategoryUIService.cs:6-8`).
- **Where it's used**: implemented by [ConferenceCategoryService](#conferencecategoryservice); injected
  into the conference-category list, detail and create pages
  (`Pages/ConferenceCategory/ConferenceCategoryList.razor.cs:16`,
  `Pages/ConferenceCategory/ConferenceCategoryDetail.razor.cs:23`,
  `Pages/ConferenceCategory/ConferenceCategoryCreate.razor.cs:13`) and into
  [ConferenceCategoryItemsPanel](#conferencecategoryitemspanel) (`:23`). It is also one of the three
  services [SpeakerDetailLookupService](#speakerdetaillookupservice) composes, supplying the category
  titles for [SpeakerDetailLookups](#speakerdetaillookups)
  (`Services/SpeakerDetailLookupService.cs:13,26`).

### CategoryItemService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Categories/CategoryItemService.cs:10` · Level 5 · class (sealed)

- **What it is**: the concrete HTTP service for the `categoryitems` resource, structurally identical to
  [`ActivityService`](#activityservice) but bound to
  [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto) and `CategoryItemIdentifierType`
  (`CategoryItemService.cs:10-14`). It implements [`ICategoryItemUIService`](#icategoryitemuiservice).
- **Depends on**:
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype),
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice),
  [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto); BCL `IHttpClientFactory`.
- **Concept**: identical to [`ActivityService`](#activityservice); see it for the thin-leaf rationale.
  The only differences are the resource root `"categoryitems"` (`CategoryItemService.cs:12`), the DTO
  plus identifier alias, and the interface it satisfies. `[Rubric §15, Best Practices & Code Quality]`.
- **Walkthrough**: no members. The base call passes `"categoryitems"` alongside the factory and token
  storage (`CategoryItemService.cs:10-12`), and the same line declares
  [`ICategoryItemUIService`](#icategoryitemuiservice).
- **Where it's used**: picked up by the same assembly scan as its siblings
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:29`) and resolved
  through [`ICategoryItemUIService`](#icategoryitemuiservice) in
  [`ConferenceCategoryItemsPanel`](#conferencecategoryitemspanel), the category detail page's items
  editor (`Pages/ConferenceCategory/ConferenceCategoryItemsPanel.razor.cs:24`).

### ConferenceCategoryService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Categories/ConferenceCategoryService.cs:10` · Level 5 · class (sealed)

- **What it is**: the concrete HTTP service for the `conferencecategories` resource, structurally
  identical to [`CategoryItemService`](#categoryitemservice) but bound to
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) and
  `ConferenceCategoryIdentifierType` (`ConferenceCategoryService.cs:10-14`). It implements
  [`IConferenceCategoryUIService`](#iconferencecategoryuiservice).
- **Depends on**:
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype),
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice),
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto).
- **Concept**: identical to [`ActivityService`](#activityservice); see it for the thin-leaf rationale.
  The only differences are the resource root `"conferencecategories"` (`ConferenceCategoryService.cs:12`),
  the DTO plus identifier alias, and the interface it satisfies. `[Rubric §15, Best Practices & Code Quality]`. Reading
  these three classes back to back is the clearest evidence of what the shared base buys: three
  resources, twelve lines of code, zero duplicated HTTP handling.
- **Walkthrough**: no members; the base call passes `"conferencecategories"` alongside the factory and
  token storage (`ConferenceCategoryService.cs:10-12`).
- **Where it's used**: picked up by the same assembly scan as its siblings
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:29`) and resolved
  through [`IConferenceCategoryUIService`](#iconferencecategoryuiservice) in
  [`ConferenceCategoryList`](#conferencecategorylist)
  (`Pages/ConferenceCategory/ConferenceCategoryList.razor.cs:16`),
  [`ConferenceCategoryDetail`](#conferencecategorydetail)
  (`Pages/ConferenceCategory/ConferenceCategoryDetail.razor.cs:23`),
  [`ConferenceCategoryCreate`](#conferencecategorycreate)
  (`Pages/ConferenceCategory/ConferenceCategoryCreate.razor.cs:13`) and
  [`ConferenceCategoryItemsPanel`](#conferencecategoryitemspanel)
  (`Pages/ConferenceCategory/ConferenceCategoryItemsPanel.razor.cs:23`).

### EventSpeakerService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Common` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Common/ChildEntityServices.cs:22` · Level 5 · class (sealed)

- **What it is**: the HTTP service for the **EventSpeaker join entity**: add (POST) or remove (DELETE) a
  speaker on an event (`ChildEntityServices.cs:22-30`). It is the first of four structurally identical
  join-entity services in one file and implements [`IEventSpeakerUIService`](#ieventspeakeruiservice).
- **Depends on**: [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/ChildEntityServiceBase.cs:19`, hoisted out of
  this file into the shared namespace, as the trailing comment records at `ChildEntityServices.cs:89-90`);
  [`ChildEntityDeletePath`](#childentitydeletepath) for the delete suffix;
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`EventSpeakerDTO`](group-17-conference-domain.md#eventspeakerdto);
  [`Result`](group-01-result-error-handling.md#result); the `EventIdentifierType` /
  `SpeakerIdentifierType` / `EventSpeakerIdentifierType` aliases.
- **Concept introduced, the join-entity UI service.** A **join (association) entity** has no rich
  lifecycle: you create the link or remove it, and there is no detail page and no update. So it does not
  use the full-CRUD
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype);
  it uses the leaner [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase),
  whose whole surface is three protected helpers: `PostAsync<TResponse>`, which posts and reads the
  created DTO back (`ChildEntityServiceBase.cs:36-44`), a valueless `PostAsync` for an endpoint that
  answers 204 (`:52-60`), and `DeleteByIdAsync` (`:70-79`). All three create their client through
  `AuthenticatedServiceBase.CreateAuthenticatedClientAsync()` (`:40,56,74`), so the join endpoints carry
  the same bearer token as their parent CRUD endpoints, and all three wrap the call in
  [`HttpResultExecutor`](group-15-common-ui-framework.md#httpresultexecutor) and read the response
  through [`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader), so a missing join
  row arrives as a typed `ErrorType.NotFound` failure the caller can tell apart from a genuine failure
  (`ChildEntityServiceBase.cs:62-65`). `[Rubric §18, UI Architecture]` (assesses whether pages depend on
  well-factored typed services rather than raw `HttpClient`; the tag editor calls one method per
  direction) and `[Rubric §2, Design Patterns]` (the same base-plus-thin-leaf factoring as the CRUD
  family).
- **Concept introduced, the parent id on every removal.** The file-level remarks
  (`ChildEntityServices.cs:14-21`) are worth reading in full: the join controllers remove a row by
  loading the **parent aggregate** and asking it to drop the child, so the parent id in the query string
  is not decoration. A DELETE sent without it binds the parent id to its `default` value, that aggregate
  is never found, and the API answers 404 while the UI reports a generic failure. That is why every
  `DeleteAsync` in this file takes the owning aggregate's id as well as the join row's own, and why the
  suffix is built in exactly one place, [`ChildEntityDeletePath`](#childentitydeletepath)
  (`ChildEntityServices.cs:76-87`), which concatenates the child id, the parent parameter name and the
  URL-escaped parent id, all formatted with `CultureInfo.InvariantCulture` (`:81-86`).
  `[Rubric §15, Best Practices & Code Quality]` (assesses whether an easily-wrong detail is centralized
  instead of repeated at each call site).
- **Walkthrough** (`ChildEntityServices.cs:22`)
  - The base call supplies the `"eventspeakers"` endpoint (`ChildEntityServices.cs:23`).
  - `AddAsync(eventId, speakerId, ct)` (`ChildEntityServices.cs:25-26`): `PostAsync<EventSpeakerDTO>` with
    the anonymous payload `new { EventId, SpeakerId }`, returning
    `Result<`[`EventSpeakerDTO`](group-17-conference-domain.md#eventspeakerdto)`>`.
  - `DeleteAsync(eventId, id, ct)` (`ChildEntityServices.cs:28-29`): `DeleteByIdAsync` over
    `ChildEntityDeletePath.For(id, "eventId", eventId)`, returning a valueless
    [`Result`](group-01-result-error-handling.md#result).
- **Why it's built this way**: modeling each many-to-many link as its own tiny service over a shared
  child base keeps the add/remove surface uniform and each payload strongly typed, without the CRUD
  surface a join row does not need.
- **Where it's used**: registered explicitly at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:32` (join services
  are not `IEntityService<,>` implementations, so the assembly scan does not see them).
- **Caveats / not-in-source**: unlike the CRUD services, none of the
  [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase) helpers runs inside
  the Polly `RetryPolicy` (the calls at `ChildEntityServiceBase.cs:41,57,76` go straight to the
  `HttpClient`), so a transient failure on a link edit surfaces immediately rather than being retried.
  Note also that in the current tree no Conference page injects
  [`IEventSpeakerUIService`](#ieventspeakeruiservice): the interface, this implementation and the DI line
  are its only references, so the event-speaker link is registered and callable but has no page consumer
  today.

### SessionCategoryItemService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Common` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Common/ChildEntityServices.cs:48` · Level 5 · class (sealed)

- **What it is**: the HTTP service for the **SessionCategoryItem join entity**: add (POST) or remove
  (DELETE) a category-item tag on a session (`ChildEntityServices.cs:48-56`). It implements
  [`ISessionCategoryItemUIService`](#isessioncategoryitemuiservice).
- **Depends on**: [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase);
  [`ChildEntityDeletePath`](#childentitydeletepath);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`SessionCategoryItemDTO`](group-17-conference-domain.md#sessioncategoryitemdto);
  [`Result`](group-01-result-error-handling.md#result); the `SessionIdentifierType` /
  `CategoryItemIdentifierType` / `SessionCategoryItemIdentifierType` aliases.
- **Concept**: cross-reference the join-entity mechanics and the parent-id rule taught at
  [`EventSpeakerService`](#eventspeakerservice). `[Rubric §18, UI Architecture]`.
- **Walkthrough** (`ChildEntityServices.cs:48`)
  - The base call supplies the `"sessioncategoryitems"` endpoint (`ChildEntityServices.cs:49`).
  - `AddAsync(sessionId, categoryItemId, ct)` (`ChildEntityServices.cs:51-52`):
    `PostAsync<SessionCategoryItemDTO>(new { SessionId, CategoryItemId })`, returning the created
    [`SessionCategoryItemDTO`](group-17-conference-domain.md#sessioncategoryitemdto) in a `Result<T>`.
  - `DeleteAsync(sessionId, id, ct)` (`ChildEntityServices.cs:54-55`): `DeleteByIdAsync` over
    `ChildEntityDeletePath.For(id, "sessionId", sessionId)`, so the owning session id rides along in the
    query string.
- **Why it's built this way**: modeling each many-to-many link as its own tiny service over a shared
  child base keeps the add/remove surface uniform and each payload strongly typed, without the CRUD
  surface a join row does not need.
- **Where it's used**: registered explicitly at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:34`, and injected
  into [`SessionDetail`](#sessiondetail)'s "categories on this session" editor
  (`Pages/Session/SessionDetail.razor.cs:28`).

### SessionSpeakerService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Common` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Common/ChildEntityServices.cs:35` · Level 5 · class (sealed)

- **What it is**: the HTTP service for the **SessionSpeaker join entity**: add (POST) or remove (DELETE)
  a speaker on a session (`ChildEntityServices.cs:35-43`). It is the structural twin of
  [`EventSpeakerService`](#eventspeakerservice),
  [`SessionCategoryItemService`](#sessioncategoryitemservice) and
  [`SpeakerCategoryItemService`](#speakercategoryitemservice), differing only in endpoint, payload keys,
  DTO and parent parameter name. It implements [`ISessionSpeakerUIService`](#isessionspeakeruiservice).
- **Depends on**: [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase);
  [`ChildEntityDeletePath`](#childentitydeletepath);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`SessionSpeakerDTO`](group-17-conference-domain.md#sessionspeakerdto);
  [`Result`](group-01-result-error-handling.md#result); the `SessionIdentifierType` /
  `SpeakerIdentifierType` / `SessionSpeakerIdentifierType` aliases.
- **Concept**: cross-reference the join-entity mechanics and the parent-id rule taught at
  [`EventSpeakerService`](#eventspeakerservice). `[Rubric §18, UI Architecture]`.
- **Walkthrough** (`ChildEntityServices.cs:35`)
  - The base call supplies the `"sessionspeakers"` endpoint (`ChildEntityServices.cs:36`).
  - `AddAsync(sessionId, speakerId, ct)` (`ChildEntityServices.cs:38-39`):
    `PostAsync<SessionSpeakerDTO>(new { SessionId, SpeakerId })`.
  - `DeleteAsync(sessionId, id, ct)` (`ChildEntityServices.cs:41-42`): `DeleteByIdAsync` over
    `ChildEntityDeletePath.For(id, "sessionId", sessionId)`.
- **Why it's built this way**: same rationale as the other join services, a tiny per-link service over
  the shared child base keeps the add/remove surface uniform and strongly typed.
- **Where it's used**: registered explicitly at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:33`, and injected
  into [`SessionDetail`](#sessiondetail)'s "speakers on this session" editor
  (`Pages/Session/SessionDetail.razor.cs:27`). The rows it creates are also what the server joins on when
  [`SpeakerDashboardService`](#speakerdashboardservice) filters sessions by the virtual `SpeakerId` key.

### SpeakerCategoryItemService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Common` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Common/ChildEntityServices.cs:61` · Level 5 · class (sealed)

- **What it is**: the HTTP service for the **SpeakerCategoryItem join entity**: add (POST) or remove
  (DELETE) a category-item tag on a speaker, which is the mechanism behind speaker categorization such
  as locality (`ChildEntityServices.cs:61-69`). It is the fourth structurally identical join service in
  the file and implements [`ISpeakerCategoryItemUIService`](#ispeakercategoryitemuiservice).
- **Depends on**: [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase);
  [`ChildEntityDeletePath`](#childentitydeletepath);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto);
  [`Result`](group-01-result-error-handling.md#result); the `SpeakerIdentifierType` /
  `CategoryItemIdentifierType` / `SpeakerCategoryItemIdentifierType` aliases.
- **Concept**: cross-reference the join-entity mechanics and the parent-id rule taught at
  [`EventSpeakerService`](#eventspeakerservice). `[Rubric §18, UI Architecture]`.
- **Walkthrough** (`ChildEntityServices.cs:61`)
  - The base call supplies the `"speakercategoryitems"` endpoint (`ChildEntityServices.cs:62`).
  - `AddAsync(speakerId, categoryItemId, ct)` (`ChildEntityServices.cs:64-65`):
    `PostAsync<SpeakerCategoryItemDTO>(new { SpeakerId, CategoryItemId })`.
  - `DeleteAsync(speakerId, id, ct)` (`ChildEntityServices.cs:67-68`): `DeleteByIdAsync` over
    `ChildEntityDeletePath.For(id, "speakerId", speakerId)`.
- **Why it's built this way**: same shared-child-base rationale as the other three join services. The
  four differ only in the resource name, the two id fields in the payload, and the parent parameter name
  in the delete path, which is exactly the amount of code the base cannot supply.
- **Where it's used**: registered explicitly at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:35`, and injected
  into [`SpeakerCategoryItemsPanel`](#speakercategoryitemspanel), the speaker detail page's category
  editor (`Pages/Speaker/SpeakerCategoryItemsPanel.razor.cs:18`).

### EventInfo

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Events/IEventLookupService.cs:14` · Level 0 · record

- **What it is**: the event-side lookup projection: identity, name, the date window, the event's time
  zone, its published flag, and an optional sponsorship packet URL (`IEventLookupService.cs:14-21`).
  Beyond name enrichment it is the input to the "which event is the current one" decision that several
  pages make on load.
- **Depends on**: no first-party types. `EventIdentifierType` is `int` in this module
  (`MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:8`); BCL `DateOnly`, `string`, `bool`.
- **Concept**: the same UI lookup projection introduced by [CategoryItemInfo](#categoryiteminfo). What
  is new here is that the projection carries *decision* fields, not only display fields.
  `[Rubric §18, UI Architecture]` and `[Rubric §19, State Management]`: pages feed `StartDate`,
  `EndDate`, and `TimeZone` into the shared
  [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) to pick the current or
  next event, so the "default event filter" rule lives in one shared selector while the record just
  supplies its inputs.
- **Walkthrough**: a positional record with seven members.
  - `Id`, `Name` (`IEventLookupService.cs:15-16`): key plus display name.
  - `StartDate`, `EndDate` (lines 17-18): `DateOnly` bounds of the event.
  - `TimeZone` (line 19): the event's time zone id, passed to the selector so "current" is evaluated
    in the event's own zone rather than the browser's.
  - `IsPublished` (line 20).
  - `SponsorshipPacketUrl` (line 21): `string?` with a default of `null`. The remarks block
    (`IEventLookupService.cs:9-13`) records why: the many call sites that need only identity and dates
    stay unchanged, and only the public sponsor page reads it, to decide whether the sponsorship call
    to action renders at all.
- **Why it's built this way**: adding the optional parameter last with a default kept a wide set of
  construction sites source-compatible while the sponsor feature landed.
  `[Rubric §15, Best Practices & Code Quality]` (assesses whether a shape can grow without a ripple edit).
  [EventLookupService](#eventlookupservice) is the single place that fills every member
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Events/EventLookupService.cs:109`).
- **Where it's used**: [PublicSponsorList](#publicsponsorlist) resolves the current or next event and
  then reads `SponsorshipPacketUrl` off it (`PublicSponsorList.razor.cs:63`); every page that injects
  [IEventLookupService](#ieventlookupservice) indexes the dictionary of these records to render event
  names, including [`EventFilteredListPageBase<TDto>`](#eventfilteredlistpagebasetdto)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Common/EventFilteredListPageBase.cs:27`),
  which supplies the shared event filter to its derived list pages.

### SessionSchedulePageRequest

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Public/IPublicSessionScheduleService.cs:20` · Level 0 · record

- **What it is**: a `sealed record` describing one page request from the public session list: the
  grid's filters, the 1-based page number, the page size, the optional sort column and direction, and
  the optional set of bookmarked session ids that scopes the "My Schedule" view
  (`IPublicSessionScheduleService.cs:20-26`).
- **Depends on**: no first-party types. `SessionIdentifierType` is `int`
  (`MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:15`). BCL `Dictionary<string, (string Operator, string Value)>`
  and `IReadOnlyCollection<T>`.
- **Concept introduced, the parameter object for a grid fetch.** `[Rubric §9, API & Contract Design]`
  (assesses whether a call's inputs are named and typed rather than a positional run of primitives:
  six arguments collapse into one record whose members carry the intent). `[Rubric §18, UI
  Architecture]`: the record is what lets the offline-first fetch live in a service instead of in the
  page, because a page's `ServerData` delegate can hand its whole request over in one object. The
  filter dictionary's tuple value, `(string Operator, string Value)`, is the MMCA.Common filter
  convention the paged query endpoints understand.
- **Walkthrough**: a positional record with six members and no body.
  - `Filters` (`IPublicSessionScheduleService.cs:21`): the grid filters the page already assembled.
  - `Page`, `PageSize` (lines 22-23): the 1-based page and rows per page.
  - `SortColumn`, `SortDirection` (lines 24-25): both `string?`, null when the grid is unsorted.
  - `MyScheduleSessionIds` (line 26): `IReadOnlyCollection<SessionIdentifierType>?`. The param doc
    (lines 14-19) is the load-bearing part: when the "My Schedule" view is active for an authenticated
    user this holds the bookmarked ids so the query is scoped server-side with an `Id IN (...)` filter
    and the server still pages; it is `null` for the normal browse path, and it is never empty,
    because an empty schedule has no query to run and the page answers it without reaching the
    service.
- **Why it's built this way**: [PublicSessionScheduleService](#publicsessionscheduleservice) turns
  `MyScheduleSessionIds` into an extra `"Id"` filter with the `IN` operator before delegating to the
  paged session query (`PublicSessionScheduleService.cs:78-83`), which is why the "never empty"
  invariant is documented on the record rather than defended in the service: an empty `IN` list would
  be a query that cannot match. `[Rubric §12, Performance & Scalability]`: the alternative the doc
  comment rules out, pulling a 500-row page and filtering in memory, also reported a wrong total past
  500 rows (`PublicSessionScheduleService.cs:67-70`).
- **Where it's used**: constructed by [PublicSessionList](#publicsessionlist) inside its unified fetch
  delegate (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Sessions/PublicSessionList.razor.cs:277-284`)
  and consumed by [IPublicSessionScheduleService.FetchPageAsync](#ipublicsessionscheduleservice).

### IEventLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Events/IEventLookupService.cs:26` · Level 3 · interface

- **What it is**: the event counterpart of [ICategoryItemLookupService](#icategoryitemlookupservice):
  one call returning an event-keyed dictionary of [EventInfo](#eventinfo)
  (`IEventLookupService.cs:26-30`).
- **Depends on**: [EventInfo](#eventinfo), the `EventIdentifierType` alias, and `Result<T>`.
- **Concept**: identical bulk-then-index shape, see
  [ICategoryItemLookupService](#icategoryitemlookupservice). `[Rubric §23, Front-End Performance]`.
  This is the most widely injected of the three lookups because so many Conference surfaces are
  event-scoped, and it is the only one whose implementation memoizes: the remarks on
  [EventLookupService](#eventlookupservice) explain that the cached unit is the `Task`, not the
  result, so concurrent callers in one scope share a single in-flight fetch
  (`EventLookupService.cs:12-32`), with a five-minute TTL matched to the server's "EventsCache"
  output-cache policy (`EventLookupService.cs:36-41`).
- **Walkthrough**: one member, `GetAllAsync(CancellationToken cancellationToken = default)` returning
  `Task<Result<IReadOnlyDictionary<EventIdentifierType, EventInfo>>>` (`IEventLookupService.cs:28-29`).
- **Where it's used**: implemented by [EventLookupService](#eventlookupservice), registered scoped at
  `DependencyInjection.cs:52`, and injected into a wide set of Conference pages, including
  [`EventFilteredListPageBase<TDto>`](#eventfilteredlistpagebasetdto)
  (`EventFilteredListPageBase.cs:27`), [RoomDetail](#roomdetail) (`RoomDetail.razor.cs:21`),
  [RoomCreate](#roomcreate) (`RoomCreate.razor.cs:15`), [SessionCreate](#sessioncreate)
  (`SessionCreate.razor.cs:22`), [SessionDetail](#sessiondetail) (`SessionDetail.razor.cs:29`),
  [ActivityDetail](#activitydetail) (`ActivityDetail.razor.cs:25`),
  [ActivityCreate](#activitycreate) (`ActivityCreate.razor.cs:22`),
  [SpeakerDashboard](#speakerdashboard) (`SpeakerDashboard.razor.cs:26`),
  [SessionSelectionDashboard](#sessionselectiondashboard) (`SessionSelectionDashboard.razor.cs:19`),
  [OrganizerEventFeedback](#organizereventfeedback) (`OrganizerEventFeedback.razor.cs:22`),
  [PublicActivityList](#publicactivitylist) (`PublicActivityList.razor.cs:29`),
  [PublicEventList](#publiceventlist) (`PublicEventList.razor.cs:36`),
  [PublicSponsorList](#publicsponsorlist) (`PublicSponsorList.razor.cs:28`), and the sponsor admin
  pages (`SponsorDetail.razor.cs:24`, `SponsorCreate.razor.cs:21`). It is also consumed from the
  Engagement module's event feedback page, [EventFeedback](group-22-engagement-module.md#eventfeedback)
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/Feedback/EventFeedback.razor.cs:23`),
  which is why `DependencyInjection.cs:50` labels these "cross-module lookup services".

### IPublicSessionScheduleService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Public/IPublicSessionScheduleService.cs:34` · Level 3 · interface

- **What it is**: the offline-first page fetch for the public session schedule
  (`IPublicSessionScheduleService.cs:34-53`). One method runs the live paged query and keeps the last
  successful FIRST page in the device-local cache, so a dead venue network still shows a programme
  (doc comment, lines 28-33).
- **Depends on**: [SessionSchedulePageRequest](#sessionschedulepagerequest),
  [SessionDTO](group-17-conference-domain.md#sessiondto), and `Result<T>`. BCL `Action<bool>`,
  `Task`, `CancellationToken`, and a named tuple return type
  `(IReadOnlyList<SessionDTO> Items, int TotalItems)`.
- **Concept introduced, offline-first read-through with an explicit blast radius.**
  `[Rubric §29, Resilience & Business Continuity]` (assesses whether a surface degrades usefully when
  a dependency is gone; here the conference programme survives a venue network outage).
  `[Rubric §19, State Management]` and `[Rubric §18, UI Architecture]`: the caching decision lives in
  the service while the page keeps only the banner flag, so the component stays a renderer. The doc
  comment is precise about how narrow the fallback is, and that precision is the teaching point: the
  live path is never affected, the snapshot is only consulted when a fetch fails, and only for page 1
  while the device reports itself offline (lines 30-33). This is the ADR-042 device-capability
  abstraction at work (`Website/docs-src/adr/042-device-capability-abstraction.md`): the
  implementation composes
  [`OfflineFirstPageSnapshot<TItem>`](group-15-common-ui-framework.md#offlinefirstpagesnapshottitem)
  over [ILocalCacheStore](group-26-device-capability-layer.md#ilocalcachestore) and
  [IConnectivityStatusService](group-26-device-capability-layer.md#iconnectivitystatusservice)
  (`PublicSessionScheduleService.cs:19-31`), so the same page code runs on a head that has no local
  store at all.
- **Walkthrough**: one member,
  `FetchPageAsync(SessionSchedulePageRequest request, Action<bool> onCacheStateChanged, CancellationToken cancellationToken = default)`
  returning `Task<Result<(IReadOnlyList<SessionDTO> Items, int TotalItems)>>`
  (`IPublicSessionScheduleService.cs:49-52`).
  - `request` (line 50): the page to fetch, see [SessionSchedulePageRequest](#sessionschedulepagerequest).
  - `onCacheStateChanged` (line 51): a callback, raised with `true` when the snapshot answered, so the
    page shows its "cached schedule" banner and re-renders, and with `false` when a live fetch
    succeeded (documented at lines 42-46). Passing a callback rather than exposing a property keeps the
    service free of any rendering knowledge.
  - The failure contract is spelled out in the method doc (lines 36-41): a successful first page is
    written back to the snapshot, a failed fetch falls back to it, and a failure with nothing cached
    travels on to the caller unchanged, a failed `Result` as a failed result and a throwing cache store
    as a rethrow, so the grid's own handling still applies. The implementation matches that on both
    branches (`PublicSessionScheduleService.cs:39-64`).
- **Why it's built this way**: extracting the offline behavior behind an interface is what let the page
  keep a single fetch delegate for both the browse and "My Schedule" views. The page comment says it
  directly: only the banner stays in the page, the service decides when it is warranted
  (`PublicSessionList.razor.cs:289-291`).
- **Where it's used**: implemented by [PublicSessionScheduleService](#publicsessionscheduleservice),
  registered scoped at `DependencyInjection.cs:48` under an explicit ADR-042 Wave 3 comment (line 41),
  and injected into [PublicSessionList](#publicsessionlist) (`PublicSessionList.razor.cs:34`), which
  calls it from its unified fetch delegate (`PublicSessionList.razor.cs:277-285`).

### SessionizeRefreshOutcome

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Events/SessionizeRefreshOutcome.cs:13` · Level 3 · record (sealed)

- **What it is**: the two-field payload the event detail page gets back from one Sessionize refresh
  gesture: `Summary`, the per-entity counts and warnings the import reported, and `Event`, the event
  reloaded after the import including its fresh row version
  (`SessionizeRefreshOutcome.cs:11-13`).
- **Depends on**:
  [RefreshFromSessionizeResultDTO](group-17-conference-domain.md#refreshfromsessionizeresultdto) and
  [EventDTO](group-17-conference-domain.md#eventdto), both from `MMCA.ADC.Conference.Shared.Events`
  (`SessionizeRefreshOutcome.cs:1`).
- **Concept introduced, the multi-step gesture packaged as one result.** A Sessionize refresh is three
  server calls (persist an edited code, run the import, reload the event), and the doc comment states
  why the two payloads travel together: so the page reads one
  [Result](group-01-result-error-handling.md#result) and reports one failure, instead of branching on a
  persist, an import, and a reload with the same message three times
  (`SessionizeRefreshOutcome.cs:5-9`). `[Rubric §19, State Management]` assesses whether the UI's copy
  of server state stays consistent after a write: the reloaded event is *part of the success value*, so
  a page that handles the outcome cannot forget to refresh its row version and then fail its next
  conditional update. `[Rubric §9, API & Contract Design]` assesses whether a client contract models the
  operation rather than the transport; this record exists because "refresh" is one user gesture even
  though it is three HTTP calls.
- **Walkthrough**: a positional `sealed record` with two members and no behavior
  (`SessionizeRefreshOutcome.cs:13`). Value equality and `with` come from the record declaration; there
  is no constructor body, no validation, and no mapping code. It is a transport-shaped tuple with names.
- **Why it's built this way**: the import rewrites the event's child data and its refresh stamp, so the
  caller's copy of the event is stale the moment the import succeeds. The service comment says exactly
  that and concludes "hand back the reloaded event rather than a bare summary"
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Events/EventService.cs:76-77`).
- **Where it's used**: produced by
  [IEventUIService](#ieventuiservice)`.RefreshFromSessionizeWithCodeAsync` (`IEventUIService.cs:29`),
  built by [EventService](#eventservice) (`EventService.cs:81`), and consumed by
  [EventDetail](#eventdetail), which unpacks both members in one branch: `_refreshResult =
  refreshed.Summary`, `Event = refreshed.Event`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Events/EventDetail.razor.cs:247-256`).

### EventLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Events/EventLookupService.cs:33` · Level 4 · class (sealed)

- **What it is**: the implementation behind [IEventLookupService](#ieventlookupservice): one bulk GET of
  the events collection projected into a dictionary of [EventInfo](#eventinfo), **memoized per scope**
  behind a single-flight cache (`EventLookupService.cs:33-113`). It is the most-injected service in this
  chapter, so the caching is not an optimization detail, it is the reason the pattern scales.
- **Depends on**: [EventInfo](#eventinfo), [EventDTO](group-17-conference-domain.md#eventdto),
  [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt),
  [HttpResultExecutor](group-15-common-ui-framework.md#httpresultexecutor),
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader); BCL `IHttpClientFactory`,
  `TimeSpan`, `DateTimeOffset`, `Task.WaitAsync`. Like its category-item sibling it takes no token
  storage (`EventLookupService.cs:33`), so this is an unauthenticated read.
- **Concept introduced, the scope-lifetime single-flight cache.** Three mechanisms interlock, and each
  one is documented in the class remarks (`EventLookupService.cs:12-32`).
  - **The cached unit is the `Task`, not the result** (`:44`). Two callers in the same scope that ask
    while a fetch is in flight share that one fetch instead of starting one each. The remarks explain
    why overlap is the normal case rather than the edge case:
    [EventFilteredListPageBase<TDto>](#eventfilteredlistpagebasetdto) starts the load before its first
    await via `BeginEventsLoad` (`Pages/Common/EventFilteredListPageBase.cs:144`) and a derived page
    awaits it later.
  - **A TTL stamped only on success** (`:91-96`). `_cachedUntil` starts at `DateTimeOffset.MinValue`
    (`:51`), which is what makes a faulted task, a cancelled one and a failed `Result` all expire
    immediately rather than caching a non-answer; a transient outage heals on the next page instead of
    being remembered for five minutes. `CacheTtl` is five minutes (`:41`), deliberately matched to the
    server-side `"EventsCache"` output-cache policy so the client entry can never be staler than the
    response the origin would have served anyway (`:36-40`).
  - **No lock** (`:22-25`). The service is registered scoped in both heads
    (`DependencyInjection.cs:52`), and Blazor's renderer dispatches every component callback for one
    scope on a single logical thread, so the read-modify-write at `:56-66` never interleaves with
    itself. This is a case where the *hosting model*, not a synchronization primitive, is the safety
    argument, and the code says so rather than leaving the reader to infer it.
  `[Rubric §23, Front-End Performance]` assesses redundant network work in a session: a user walking
  four grids pays one round trip for the event list instead of four. `[Rubric §19, State Management]`
  assesses freshness policy: bounding the client cache by the origin's own TTL means the two can never
  disagree in the direction that matters. `[Rubric §12, Performance & Scalability]` covers the
  single-flight collapse under concurrency.
- **Walkthrough**
  - `CacheTtl` (`:41`): `static readonly TimeSpan` of five minutes.
  - `_cached` (`:44`): the shared fetch, in flight or completed and still fresh.
  - `_cachedUntil` (`:51`): when `_cached` stops being reusable.
  - `GetAllAsync(ct)` (`:53-72`): snapshots `_cached` into a local (`:56`); starts a new `FetchAsync()`
    when the entry is null, or completed and past its TTL (`:61-66`), resetting `_cachedUntil` first;
    then returns the shared task guarded by the caller's token. The final line is the subtle one: the
    cached task is created **without** a caller token and awaited under one via
    `entry.WaitAsync(cancellationToken)` (`:71`), so a page disposing mid-load abandons only its own
    await and never cancels the fetch the other pages in the scope are sharing (`:68-70`).
  - `FetchAsync()` (`:74-99`): runs the GET
    `events?includeFKs=false&includeChildren=false&pageSize=10000` under
    `HttpResultExecutor.ExecuteAsync` with `CancellationToken.None` throughout (`:76-89`), reads the
    response through [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader) (`:84`),
    maps the page through `BuildLookup` (`:87`), and stamps the TTL only when the result is a success
    and the payload is in hand, so the TTL measures the age of the data rather than the age of the
    attempt (`:91-96`).
  - `BuildLookup(page)` (`:101-113`): projects each DTO into an [EventInfo](#eventinfo) carrying all
    seven members including `SponsorshipPacketUrl` (`:109`), keyed by `evt.Id`.
- **Why it's built this way**: the projection is the boundary between the transport contract and the
  UI's own model, so a change to [EventDTO](group-17-conference-domain.md#eventdto) that does not affect
  these seven fields never reaches the pages (`[Rubric §15, Best Practices & Code Quality]`). The remarks also record
  a deliberate *non*-consolidation: the sibling read paths
  ([LiveEventService](group-22-engagement-module.md#liveeventservice), `ADCHome`, and the Conference
  service's [SelfHttpOutputCacheWarmupTask](group-20-conference-api-grpc.md#selfhttpoutputcachewarmuptask))
  keep their own URLs and their own caching because they ask narrower questions of the same controller,
  and collapsing them onto this URL family would trade one saved round trip for a wider payload on every
  one of them (`EventLookupService.cs:26-31`).
- **Where it's used**: registered scoped against [IEventLookupService](#ieventlookupservice)
  (`DependencyInjection.cs:52`). It is injected across the Conference UI, including
  [EventFilteredListPageBase<TDto>](#eventfilteredlistpagebasetdto)
  (`Pages/Common/EventFilteredListPageBase.cs:27`, which is what puts it behind every event-filtered
  grid), [SessionDetail](#sessiondetail) (`:24`), [SessionCreate](#sessioncreate) (`:20`),
  [RoomDetail](#roomdetail) (`:20`), [RoomCreate](#roomcreate) (`:14`),
  [ActivityDetail](#activitydetail) (`:24`), [ActivityCreate](#activitycreate) (`:21`),
  [SponsorDetail](#sponsordetail) (`:23`), [SponsorCreate](#sponsorcreate) (`:20`),
  [SpeakerDashboard](#speakerdashboard) (`:25`), [SessionSelectionDashboard](#sessionselectiondashboard)
  (`:18`), [OrganizerEventFeedback](#organizereventfeedback) (`:20`),
  [PublicEventList](#publiceventlist) (`:36`), [PublicActivityList](#publicactivitylist) (`:28`),
  [PublicSponsorList](#publicsponsorlist) (`:27`), and [SessionLookups](#sessionlookups)
  (`Pages/Session/SessionLookups.cs:30`). It also crosses a module boundary into Engagement's
  [EventFeedback](group-22-engagement-module.md#eventfeedback) page
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/Feedback/EventFeedback.razor.cs:23`).
  Pages that need a default event filter feed its `Values` to
  [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) along with the
  `StartDate` / `EndDate` / `TimeZone` accessors.
- **Caveats / not-in-source**: the `pageSize=10000` ceiling (`EventLookupService.cs:81`) is the same
  hard cap as the other lookups, with no follow-on page request. The cache is per scope, so a Blazor
  Server circuit and a WebAssembly app instance each hold their own copy, and there is no invalidation
  hook: an event edited in this scope is not reflected in the lookup until the five minutes elapse.

### IEventUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Events/IEventUIService.cs:11` · Level 4 · interface

- **What it is**: the UI-service contract for the `events` resource. Unlike the plain CRUD markers, it
  *extends* the generic surface with four event-specific operations: publish, unpublish, a Sessionize
  refresh, and the composed refresh gesture (`IEventUIService.cs:11-32`).
- **Depends on**: [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [EventDTO](group-17-conference-domain.md#eventdto),
  [RefreshFromSessionizeResultDTO](group-17-conference-domain.md#refreshfromsessionizeresultdto) (the
  import summary), [SessionizeRefreshOutcome](#sessionizerefreshoutcome) (the composed payload), and
  [Result](group-01-result-error-handling.md#result) (`IEventUIService.cs:1-3`). BCL `Task`,
  `CancellationToken`, `byte[]`.
- **Concept introduced, extending the generic UI service with resource-specific verbs.**
  `[Rubric §9, API & Contract Design]` assesses whether non-CRUD state transitions get first-class,
  intention-revealing operations instead of being forced through a generic update. Publish and unpublish
  are lifecycle transitions on an event and refresh triggers an external Sessionize sync, none of which
  is a CRUD `Update`, so they earn their own methods mapped to dedicated WebAPI endpoints (the doc
  comment, `IEventUIService.cs:7-10`, says exactly this). The second concept is in the signatures: both
  transitions take a **required `byte[] rowVersion`** (`IEventUIService.cs:13,15`), the
  optimistic-concurrency token the client echoes back from the
  [EventDTO](group-17-conference-domain.md#eventdto) it acted on. The implementation turns it into an
  `If-Match` header via [ConcurrencyETag](group-08-auth.md#concurrencyetag)`.Format`
  (`Services/EventService.cs:29,41`), so a publish decided against a stale view comes back as a conflict
  rather than applying silently. That makes this contract a `[Rubric §8, Data Architecture]` touch point
  as well: concurrency control reaches all the way up into the UI service signature instead of stopping
  at the database. The rationale is
  [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html), which describes the
  `ETag` on the read and the conditional `If-Match` on the write as one exchange.
- **Walkthrough**: four declared members, all returning
  [Result](group-01-result-error-handling.md#result) values.
  - `PublishAsync(EventIdentifierType id, byte[] rowVersion, CancellationToken)`
    (`IEventUIService.cs:13`), returns `Task<Result>`: success is "the transition applied", with no
    payload.
  - `UnpublishAsync(EventIdentifierType id, byte[] rowVersion, CancellationToken)`
    (`IEventUIService.cs:15`), the mirror transition, same shape.
  - `RefreshFromSessionizeAsync(EventIdentifierType id, CancellationToken)` (`IEventUIService.cs:17`),
    returns `Task<Result<RefreshFromSessionizeResultDTO>>`. It takes no `rowVersion`: a Sessionize pull
    is not a lifecycle transition on the event row.
  - `RefreshFromSessionizeWithCodeAsync(EventDTO current, string? sessionizeCode, CancellationToken)`
    (`IEventUIService.cs:29-32`), returns `Task<Result<SessionizeRefreshOutcome>>`. The doc comment is
    the interesting part (`IEventUIService.cs:19-28`): this member runs the *whole organizer refresh
    gesture*, persisting the Sessionize code when the organizer changed it, calling
    `RefreshFromSessionizeAsync`, then reloading the event so the caller renders the server's new state.
    The three steps share one failure, so the page reports "refresh failed" once instead of repeating
    the branch per call. The `current` parameter is documented as carrying the row version the update is
    conditional on.
- **Why it's built this way**: the extra verbs live on the *interface* so the concrete
  [EventService](#eventservice) is the only place that knows the endpoint URLs, and pages stay
  transport-agnostic. Putting the three-step gesture on the contract (rather than orchestrating it in
  the page) is the same move [ISpeakerDetailLookupService](#ispeakerdetaillookupservice) makes for
  reads: one call, one failure branch, one success value.
- **Where it's used**: implemented by [EventService](#eventservice); injected into
  [EventList](#eventlist) (`Pages/Event/EventList.razor.cs:21`), [EventDetail](#eventdetail)
  (`Pages/Event/EventDetail.razor.cs:23`, which is the only caller of
  `RefreshFromSessionizeWithCodeAsync`, at `:247`), [EventCreate](#eventcreate)
  (`Pages/Event/EventCreate.razor.cs:17`), [SessionList](#sessionlist)
  (`Pages/Session/SessionList.razor.cs:25`), [PublicEventList](#publiceventlist) (`:35`),
  [PublicEventDetail](#publiceventdetail) (`:20`), [PublicSessionList](#publicsessionlist) (`:32`) and
  [PublicSpeakerDetail](#publicspeakerdetail) (`:24`).

### EventService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Events/EventService.cs:15` · Level 5 · class (sealed)

- **What it is**: the concrete HTTP service for the `events` resource. Unlike its plain-CRUD siblings it
  is **not** body-less: on top of the inherited CRUD it adds the four event-specific operations that map
  to dedicated WebAPI endpoints, publish, unpublish, Sessionize refresh, and the composed
  refresh-with-code gesture (`EventService.cs:15-84`). It implements
  [`IEventUIService`](#ieventuiservice), which itself extends the generic
  `IEntityService<EventDTO, EventIdentifierType>`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Events/IEventUIService.cs:11`).
- **Depends on**:
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  for the CRUD surface, the `Endpoint` property (`EntityServiceBase.cs:51`) and the protected
  `SendRequestAsync` dispatch (`EntityServiceBase.cs:324,354`);
  [`ConcurrencyETag`](group-08-auth.md#concurrencyetag) to render the row version as a weak entity tag
  (`EventService.cs:29,41`); [`EventDTO`](group-17-conference-domain.md#eventdto),
  [`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto) and
  [`SessionizeRefreshOutcome`](#sessionizerefreshoutcome);
  [`Result`](group-01-result-error-handling.md#result);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice); BCL
  `CultureInfo.InvariantCulture`.
- **Concept introduced, the conditional state-transition call.** Publish and unpublish are not CRUD:
  they are named transitions the server owns, so they POST to `{Endpoint}/{id}/publish` and
  `{Endpoint}/{id}/unpublish` with **no body at all** (`EventService.cs:24-27,36-39`). What they do carry
  is an `If-Match` header holding the event's current row version, rendered by
  [`ConcurrencyETag`](group-08-auth.md#concurrencyetag)`.Format` as a weak tag such as `W/"AAAAAAAAB9E="`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ConcurrencyETag.cs:41-45`). The tag is weak on
  purpose: a strong tag would promise byte-for-byte equality of the representation, while all this token
  answers is "is this still the same version of the resource", which is exactly what `If-Match` asks
  (`ConcurrencyETag.cs:11-18`). So a publish issued against a stale copy of the event is refused by the
  server rather than silently overwriting a concurrent edit
  ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)).
  `[Rubric §9, API & Contract Design]` (assesses whether state changes are modeled as intent-named
  resources rather than as generic updates) and `[Rubric §8, Data Architecture]` (assesses how
  concurrent writers are arbitrated; here by a version token on the wire, not by a last-writer-wins
  update).
- **Concept introduced, composing a multi-call gesture behind one Result.**
  `RefreshFromSessionizeWithCodeAsync` is the second idea worth teaching here. The organizer's "refresh
  from Sessionize" button is really three server calls: persist an edited Sessionize code, run the
  import, reload the event. Doing that in the page would mean three failure branches printing the same
  message. Instead the service runs the sequence and returns **one**
  [`Result`](group-01-result-error-handling.md#result) carrying a
  [`SessionizeRefreshOutcome`](#sessionizerefreshoutcome), so the page reads one value and reports one
  failure (`EventService.cs:53-83`, contract documented at `IEventUIService.cs:19-28`).
  `[Rubric §18, UI Architecture]` (assesses whether orchestration lives in a service rather than in
  component code) and `[Rubric §24, Forms/Validation/UX Safety]` (one failure branch means one message,
  and no half-reported gesture).
- **Walkthrough**
  - `PublishAsync(id, rowVersion, ct)` (`EventService.cs:19-29`): a body-less POST to
    `{Endpoint}/{id}/publish` built with `string.Create(CultureInfo.InvariantCulture, ...)` (`:24-27`),
    dispatched through the base's valueless `SendRequestAsync` with
    `ifMatch: ConcurrencyETag.Format(rowVersion)` (`:29`). The base attaches the header and turns the
    response into a [`Result`](group-01-result-error-handling.md#result).
  - `UnpublishAsync(id, rowVersion, ct)` (`EventService.cs:31-41`): the exact mirror against
    `{Endpoint}/{id}/unpublish` (`:37`), same conditional header (`:41`).
  - `RefreshFromSessionizeAsync(id, ct)` (`EventService.cs:43-51`): POSTs `{Endpoint}/{id}/refresh`
    (`:47-50`) through the value-returning `SendRequestAsync<T>` and yields the import summary as a
    `Result<`[`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto)`>`.
    No `If-Match` here: an import is not a conditional edit of the caller's copy.
  - `RefreshFromSessionizeWithCodeAsync(current, sessionizeCode, ct)` (`EventService.cs:53-83`): guards a
    null event (`:58`); compares the edited code against the stored one with `StringComparison.Ordinal`
    and, only when they differ, persists it first through the inherited `UpdateAsync` on a `with`-copy
    of the DTO, because the import reads the code off the **stored** event (`:60-68`); short-circuits on
    a failed persist (`:64-67`); runs the import and short-circuits again on failure using
    `TryGetValue` (`:70-74`); then reloads the event through the inherited `GetByIdAsync(id, true, ct)`
    (`:78`), because the import rewrites the event's child data and its refresh stamp, so the caller's
    copy is stale the moment it succeeds (`:76-77`); and finally pairs the summary with the reloaded
    event into a [`SessionizeRefreshOutcome`](#sessionizerefreshoutcome) (`:80-82`). Every branch returns
    the underlying call's own `Errors`, so nothing is re-worded on the way out.
- **Why it's built this way**: publish, unpublish and refresh are server-owned transitions with their own
  endpoints and their own authorization, so they are additive methods on the event's interface rather
  than flags smuggled through a PUT. The composed method exists because the reload after an import is not
  optional: returning a bare summary would leave the page holding an event whose row version no longer
  matches, and the next conditional write would fail.
- **Where it's used**: registered by the `AddUIModule<ConferenceUIModule>()` entity-service scan
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:29`), since
  [`IEventUIService`](#ieventuiservice) derives from `IEntityService<,>`. It is injected as
  [`IEventUIService`](#ieventuiservice) into [`EventList`](#eventlist) (`Pages/Event/EventList.razor.cs:21`),
  [`EventDetail`](#eventdetail) (`Pages/Event/EventDetail.razor.cs:23`), [`EventCreate`](#eventcreate)
  (`Pages/Event/EventCreate.razor.cs:17`), [`PublicEventList`](#publiceventlist)
  (`Pages/Public/PublicEventList.razor.cs:35`), [`PublicEventDetail`](#publiceventdetail)
  (`Pages/Public/PublicEventDetail.razor.cs:20`), [`PublicSpeakerDetail`](#publicspeakerdetail)
  (`Pages/Public/PublicSpeakerDetail.razor.cs:24`), [`SessionList`](#sessionlist)
  (`Pages/Session/SessionList.razor.cs:25`) and [`PublicSessionList`](#publicsessionlist)
  (`Pages/Public/PublicSessionList.razor.cs:32`). The transition methods are called from
  [`EventDetail`](#eventdetail): publish and unpublish at `Pages/Event/EventDetail.razor.cs:206-207`, and
  the composed refresh at `:247`.

### PublicSessionScheduleService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Public/PublicSessionScheduleService.cs:19` · Level 5 · class (sealed)

- **What it is**: the offline-first page fetch behind the public session schedule. It runs the live paged
  session query and keeps the last successful **first** page in the device-local cache, so a dead venue
  network still shows a programme (`PublicSessionScheduleService.cs:19-107`). It implements
  [`IPublicSessionScheduleService`](#ipublicsessionscheduleservice).
- **Depends on**: [`ISessionUIService`](#isessionuiservice) as the live query (constructor,
  `PublicSessionScheduleService.cs:20`), so it composes over
  [`SessionService`](#sessionservice) rather than issuing HTTP itself;
  [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore) and
  [`IConnectivityStatusService`](group-26-device-capability-layer.md#iconnectivitystatusservice)
  (`:19-20`); [`OfflineFirstPageSnapshot<TItem>`](group-15-common-ui-framework.md#offlinefirstpagesnapshottitem)
  as the snapshot mechanism (`:28-29`); [`SessionSchedulePageRequest`](#sessionschedulepagerequest) as
  its request record; [`SessionDTO`](group-17-conference-domain.md#sessiondto);
  [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced, offline-first as a composition, not a mode.** The service is a **decorator over
  a query**, not a second data path: the live call always runs first, and the snapshot is consulted only
  when that call did not produce a page. The framework piece it composes,
  [`OfflineFirstPageSnapshot<TItem>`](group-15-common-ui-framework.md#offlinefirstpagesnapshottitem),
  narrows the fallback deliberately: `CanServe` is true only when the device reports itself offline, the
  store is available, and the requested page is page 1
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/OfflineFirstPageSnapshot.cs:31`), and
  `RememberAsync` records only page 1 (`:41-45`). That is what keeps the live path unaffected: there is
  no scenario in which a stale snapshot outranks a live answer.
  [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore) persists on the MAUI and
  WebAssembly heads and reports itself unavailable on Blazor Server, where SSR always has the live API
  (`OfflineFirstPageSnapshot.cs:11-12`), so the same code is a no-op on the server head rather than a
  branch. This is the device-capability abstraction of
  [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) applied to a list
  surface. `[Rubric §29, Resilience & Business Continuity]` (assesses whether the app degrades usefully
  when a dependency is gone; a venue with no signal still renders yesterday's first page) and
  `[Rubric §19, State Management]` (the banner callback keeps the user aware of *which* data they are
  looking at).
- **Concept introduced, scoping "My Schedule" server-side.** The private `QueryAsync` shows the second
  idea. When the "My Schedule" view is active, the request carries the attendee's bookmarked session ids,
  and the service copies the grid's filter dictionary and adds an `Id IN (...)` filter built from those
  ids (`PublicSessionScheduleService.cs:78-83`), then lets the server page the result
  (`:83-86`). The doc comment records what this replaced and why it matters:
  pulling a 500-row page and filtering in memory also reported a wrong total past 500 rows
  (`:65-69`). `[Rubric §12, Performance & Scalability]`.
- **Walkthrough**
  - `ScheduleCacheKey = "conference.publicSessions.page1"` (`PublicSessionScheduleService.cs:28`): the
    device-local cache key, unique to this surface. The comment states the consequence of changing it
    (`:22-25`): every already-cached schedule is orphaned. The uniqueness requirement is the framework's,
    since a shared key would let one list serve another list's rows
    (`OfflineFirstPageSnapshot.cs:17-21`).
  - `_snapshot` (`PublicSessionScheduleService.cs:30-31`): one
    [`OfflineFirstPageSnapshot<SessionDTO>`](group-15-common-ui-framework.md#offlinefirstpagesnapshottitem)
    built from the store, the connectivity probe and that key, held for the service's scoped lifetime.
  - `FetchPageAsync(request, onCacheStateChanged, ct)` (`PublicSessionScheduleService.cs:34-65`), the
    only public method, and it has three exits.
    1. **Live success**: `QueryAsync` returns a page (`:39-40`), the snapshot records it (`:42`), the
       page's cached-data banner is switched off through the `onCacheStateChanged(false)` callback
       (`:43`), and the live result is returned (`:44`).
    2. **Live failure with a snapshot**: a transport fault arrives as a failed
       [`Result`](group-01-result-error-handling.md#result), not an exception, so the fallback is tried
       on the same terms (`:47-49`); when the snapshot answers, the banner is raised and the cached page
       is returned as a success (`:50`); with nothing cached the original failure travels on to the
       grid's own handling.
    3. **Thrown fault with a snapshot**: the `catch (Exception) when (_snapshot.CanServe(request.Page))`
       filter (`:52`) still guards the paths that can throw rather than fail, the local cache store
       itself and a cancelled fetch (`:54`). If the snapshot has nothing, the exception is rethrown
       (`:57-59`) so cancellation and genuine faults are not swallowed.
  - `QueryAsync(request, ct)` (`PublicSessionScheduleService.cs:74-89`): builds the effective filters
    described above and calls
    [`ISessionUIService`](#isessionuiservice)`.GetPagedAsync` with `includeChildren: true`, since the
    public schedule renders each session's child data (`:83-86`).
  - `ReadSnapshotAsync(page, onCacheStateChanged, ct)` (`PublicSessionScheduleService.cs:95-107`): reads
    the snapshot and raises the "showing cached data" banner only when one actually answered (`:98-102`).
- **Why it's built this way**: the offline behavior is a property of *this list surface*, so it lives in
  a service the page injects rather than in the page or in the generic session service. Both the live
  service and the snapshot stay independently testable, and no other consumer of
  [`ISessionUIService`](#isessionuiservice) inherits the caching.
- **Where it's used**: registered explicitly as
  [`IPublicSessionScheduleService`](#ipublicsessionscheduleservice) at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:48`, under the
  comment naming ADR-042 Wave 3 (`:41`), and injected into
  [`PublicSessionList`](#publicsessionlist) (`Pages/Public/PublicSessionList.razor.cs:31`), whose grid
  data delegate calls `FetchPageAsync` at `:274`.
- **Caveats / not-in-source**: the snapshot is best-effort. Nothing here expires it, so on a device that
  has been offline for a long time the cached first page can be arbitrarily old; the only signal to the
  user is the banner the `onCacheStateChanged` callback raises. What the store does on a write failure
  is the store's concern, not visible in this class.

### SpeakerInfo

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/ISpeakerLookupService.cs:9` · Level 0 · record

- **What it is**: the speaker-side lookup projection, three fields wide: `Id`, `FullName`, and a
  nullable `ProfilePicture` (`ISpeakerLookupService.cs:9-12`). It is what pages index when they hold a
  speaker id and must render a name or an avatar.
- **Depends on**: no first-party types. `SpeakerIdentifierType` is `System.Guid` in this module
  (`MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:19`), unlike the other Conference aliases,
  which are `int`, because speakers carry Sessionize-assigned GUIDs (BR-61, noted at
  `MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:3`).
- **Concept**: the UI lookup projection introduced by [CategoryItemInfo](#categoryiteminfo); see there
  for the mechanism and the reason a page pre-loads a dictionary. `[Rubric §18, UI Architecture]`.
  `ProfilePicture` is nullable because not every speaker has an image, so the render path must have a
  fallback branch.
- **Walkthrough**: a positional record with three members and no body (`ISpeakerLookupService.cs:9-12`);
  it is filled member for member from the speaker DTO in
  [SpeakerLookupService](#speakerlookupservice)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/SpeakerLookupService.cs:40-41`).
- **Where it's used**: returned as the dictionary value of
  [ISpeakerLookupService.GetAllAsync](#ispeakerlookupservice)
  (`ISpeakerLookupService.cs:19-20`), which the session and speaker surfaces inject to enrich speaker
  ids.
- **Caveats / not-in-source**: the name is reused. A separate, unrelated `SpeakerInfo` record exists in
  the Conference application layer for AI session scoring, documented as
  [SpeakerInfo](group-18-conference-application.md#speakerinfo). They share only a name; the
  namespaces keep them apart.

### SpeakerDetailLookups

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/ISpeakerDetailLookupService.cs:14` · Level 1 · record

- **What it is**: the three display lookups the speaker detail page needs before it can render a
  speaker, gathered into one record: the category items assigned to the speaker, the titles of the
  categories those items belong to, and the text of the questions the speaker answered
  (`ISpeakerDetailLookupService.cs:14-17`).
- **Depends on**: [CategoryItemInfo](#categoryiteminfo) as the value type of its first dictionary, plus
  the `CategoryItemIdentifierType`, `ConferenceCategoryIdentifierType`, and `QuestionIdentifierType`
  aliases. BCL `IReadOnlyDictionary`.
- **Concept introduced, the composite lookup bundle.** `[Rubric §19, State Management]` (assesses how
  many independent pieces of loaded state a component has to track and invalidate). The interface's
  doc comment states the problem it removes: the page used to issue the three loads itself and carry
  three nullable caches with a failure branch each, so this gathers them into one call answering with
  one `Result<T>`, leaving the page a single point of failure to report and a single cache to check
  (`ISpeakerDetailLookupService.cs:19-24`). `[Rubric §1, SOLID]`: the bundle is what makes the
  single-method composite interface possible at all, since a method can only return one value.
- **Walkthrough**: a positional record with three dictionary members and no body.
  - `CategoryItems` (`ISpeakerDetailLookupService.cs:15`):
    `IReadOnlyDictionary<CategoryItemIdentifierType, CategoryItemInfo>`, for the assigned-items panel.
  - `CategoryTitles` (line 15):
    `IReadOnlyDictionary<ConferenceCategoryIdentifierType, string>`, for grouping those items.
  - `QuestionTexts` (line 16): `IReadOnlyDictionary<QuestionIdentifierType, string>`, for the answers
    section.
- **Why it's built this way**: the three sources keep their own services because other pages share
  them; [SpeakerDetailLookupService](#speakerdetaillookupservice) only composes them, short-circuiting
  on the first failure (`SpeakerDetailLookupService.cs:22-39`) so the caller reports one error instead
  of branching three times. Note the composition is sequential, not parallel: each `await` completes
  before the next begins.
- **Where it's used**: [SpeakerDetail](#speakerdetail) holds exactly one nullable field of this type
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerDetail.razor.cs:82`),
  loads it once when it is still null (`SpeakerDetail.razor.cs:130-138`), and reads `QuestionTexts`
  when rendering an answer, falling back to the raw id when a question is missing
  (`SpeakerDetail.razor.cs:200`). `CategoryTitles` is handed down to
  [SpeakerCategoryItemsPanel](#speakercategoryitemspanel) as a parameter
  (`SpeakerCategoryItemsPanel.razor.cs:29`, read at `:36-37`).

### ISpeakerDetailLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/ISpeakerDetailLookupService.cs:25` · Level 3 · interface

- **What it is**: a one-method composite lookup contract for the speaker detail page. One call gathers
  the three display lookups that page needs before it can render a speaker: the category items assigned
  to the speaker, the titles of the categories those items belong to, and the text of the questions the
  speaker answered (`ISpeakerDetailLookupService.cs:25-30`). The file also declares the payload record
  [SpeakerDetailLookups](#speakerdetaillookups) (`ISpeakerDetailLookupService.cs:14-17`).
- **Depends on**: [SpeakerDetailLookups](#speakerdetaillookups) (the gathered shape),
  [CategoryItemInfo](#categoryiteminfo) (carried inside it), the `CategoryItemIdentifierType` /
  `ConferenceCategoryIdentifierType` / `QuestionIdentifierType` aliases, and
  [Result](group-01-result-error-handling.md#result) from `MMCA.Common.Shared.Abstractions`
  (`ISpeakerDetailLookupService.cs:2`).
- **Concept introduced, the composite lookup that collapses a page's failure branches.** The three
  underlying lookups already exist as separate services, each shared with other pages. What this
  contract adds is *aggregation of the outcome*: the doc comment records the shape it replaced, a page
  that issued the three loads itself, carried three nullable caches, and repeated a failure branch for
  each (`ISpeakerDetailLookupService.cs:19-24`). Gathering them behind one
  `Task<Result<SpeakerDetailLookups>>` gives the page a single point of failure to report and a single
  cache field to check. `[Rubric §18, UI Architecture]` assesses whether page code-behind stays a
  rendering concern rather than an orchestration one; here the orchestration moved down into a service
  and the page keeps one `if`. `[Rubric §15, Best Practices & Code Quality]` assesses the cost of adding a fourth
  lookup later: it becomes one more member on the record plus one more step in the implementation, and
  no new branch on the page. The railway convention itself is taught at
  [Result](group-01-result-error-handling.md#result), and the UI-side branching helpers live on
  [ResultUiExtensions](group-15-common-ui-framework.md#resultuiextensions).
- **Walkthrough**: one member.
  - `GetAllAsync(CancellationToken cancellationToken = default)` (`ISpeakerDetailLookupService.cs:30`):
    returns `Task<Result<SpeakerDetailLookups>>`. The contract states the failure rule explicitly, a
    failure in any one of the three loads fails the whole call (`ISpeakerDetailLookupService.cs:27`),
    and names the token's meaning, cancelled when the calling page is disposed
    (`ISpeakerDetailLookupService.cs:28`).
- **Why it's built this way**: the three sources stay independent services because other pages consume
  them individually; only the *composition* is speaker-detail-specific, so only the composition gets a
  new type. The implementation short-circuits on the first failure, which is what makes "one error to
  report" true rather than aspirational
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/SpeakerDetailLookupService.cs:22-35`).
- **Where it's used**: implemented by [SpeakerDetailLookupService](#speakerdetaillookupservice),
  registered scoped in the Conference UI composition root under a comment that repeats the rationale
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:55-57`), and
  injected into exactly one page, [SpeakerDetail](#speakerdetail)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerDetail.razor.cs:30`).

### ISpeakerLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/ISpeakerLookupService.cs:17` · Level 3 · interface

- **What it is**: the speaker display-enrichment contract. One call returns a speaker-keyed dictionary
  of [SpeakerInfo](#speakerinfo) so a grid or detail page can turn the speaker ids on a session into
  names and avatars without a request per row (`ISpeakerLookupService.cs:17-21`). The same file declares
  the [SpeakerInfo](#speakerinfo) record it emits (`ISpeakerLookupService.cs:9-12`).
- **Depends on**: [SpeakerInfo](#speakerinfo), the `SpeakerIdentifierType` alias, and
  [Result](group-01-result-error-handling.md#result) (`ISpeakerLookupService.cs:1`).
- **Concept**: the bulk-then-index lookup, the same shape as
  [ICategoryItemLookupService](#icategoryitemlookupservice) and
  [IEventLookupService](#ieventlookupservice): fetch one flat collection once, project it into a
  dictionary keyed by id, and let every consuming row do an O(1) `TryGetValue` instead of a fetch.
  `[Rubric §23, Front-End Performance]` assesses whether the front end avoids per-row network work; this
  contract is the shape that makes that possible. `[Rubric §18, UI Architecture]` assesses whether pages
  talk to typed services rather than raw HTTP; the page sees one method and no URL.
- **Walkthrough**: one member,
  `GetAllAsync(CancellationToken cancellationToken = default)` returning
  `Task<Result<IReadOnlyDictionary<SpeakerIdentifierType, SpeakerInfo>>>`
  (`ISpeakerLookupService.cs:19-20`). The `Result` wrapper is what distinguishes this from a naive
  dictionary-returning helper: a transport fault or a failed response arrives as a failure the page can
  render, never as an empty dictionary that would look like "this event has no speakers".
- **Why it's built this way**: the enrichment payload is deliberately narrower than
  [SpeakerDTO](group-17-conference-domain.md#speakerdto), just id, full name and profile picture
  (`ISpeakerLookupService.cs:9-12`), so a change to the transport DTO that does not touch those three
  fields never reaches the consuming pages.
- **Where it's used**: implemented by [SpeakerLookupService](#speakerlookupservice) and registered
  scoped (`DependencyInjection.cs:51`). Injected into [SessionDetail](#sessiondetail)
  (`Pages/Session/SessionDetail.razor.cs:25`), [SessionList](#sessionlist)
  (`Pages/Session/SessionList.razor.cs:26`), [PublicSessionList](#publicsessionlist)
  (`Pages/Public/PublicSessionList.razor.cs:33`), [PublicSessionDetail](#publicsessiondetail)
  (`Pages/Public/PublicSessionDetail.razor.cs:25`), and taken as a constructor argument by the
  [SessionLookups](#sessionlookups) helper that the session pages share
  (`Pages/Session/SessionLookups.cs:31`).

### ISpeakerDashboardUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/ISpeakerDashboardUIService.cs:10` · Level 3 · interface

- **What it is**: a bespoke, non-CRUD UI-service contract for a speaker's personalized dashboard: the
  sessions the speaker presents, per-session bookmark counts (single and batched), and per-session
  feedback (`ISpeakerDashboardUIService.cs:10-45`). It does not extend
  [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype);
  it is its own read-only interface over the Conference contracts and `Result<T>`
  (`ISpeakerDashboardUIService.cs:1-3`).
- **Depends on**: [SessionDTO](group-17-conference-domain.md#sessiondto) and
  [SessionFeedbackDTO](group-17-conference-domain.md#sessionfeedbackdto), the `SpeakerIdentifierType`
  alias (a `Guid` in this module,
  `MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:19`) and `SessionIdentifierType`.
- **Concept introduced, a cache-bypassing personalized read.** `[Rubric §23, Front-End Performance]`
  and `[Rubric §19, State Management]` (assess how the front end balances shared caching against
  read-your-writes freshness for a personalized view). The doc comment on `GetSpeakerSessionsAsync`
  (`ISpeakerDashboardUIService.cs:12-17`) is explicit and load-bearing: this read is fetched fresh,
  bypassing the shared sessions output cache, so a just-made speaker assignment is reflected
  immediately. Without the bypass, a read-populate-after-evict race on the output cache could leave a
  freshly assigned speaker seeing "no sessions". The contract, not just the implementation, is where
  that decision is written down; the implementation honors it with a unique `_=` cache-bust query
  parameter that makes this one read a guaranteed miss while public list reads keep their cache
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/SpeakerDashboardService.cs:31-38`).
- **Walkthrough**: four read methods, all `SpeakerIdentifierType`-scoped.
  - `GetSpeakerSessionsAsync(speakerId, ct)` (`ISpeakerDashboardUIService.cs:18-20`): returns
    `Task<Result<IReadOnlyList<SessionDTO>>>`, the speaker's sessions, uncached. The implementation
    filters server-side on the virtual `SpeakerId` key with a page size capped at 100 and no child
    collections (`SpeakerDashboardService.cs:18,38`).
  - `GetSessionBookmarkCountAsync(speakerId, sessionId, ct)` (`ISpeakerDashboardUIService.cs:22-25`):
    returns `Task<Result<int>>`, the bookmark count for one of the speaker's sessions.
  - `GetSessionBookmarkCountsAsync(speakerId, sessionIds, ct)` (`ISpeakerDashboardUIService.cs:32-35`):
    returns `Task<Result<IReadOnlyDictionary<SessionIdentifierType, int>>>`, every requested session's
    active bookmark count in a single request. The doc comment (lines 27-31) records that it replaces
    the dashboard's per-session fan-out, that only sessions assigned to the speaker come back, and that
    sessions with no bookmarks map to 0. That is the `[Rubric §12, Performance & Scalability]` point in
    one signature: an N+1 of HTTP calls collapsed into one.
  - `GetSessionFeedbackAsync(speakerId, sessionId, ct)` (`ISpeakerDashboardUIService.cs:41-44`):
    returns `Task<Result<SessionFeedbackDTO>>`. Its doc comment (lines 37-40) states the modelling
    decision: "no feedback captured yet" arrives as an
    [ErrorType](group-01-result-error-handling.md#errortype)`.NotFound` failure, not as a success
    carrying null, so the page tells that legitimate domain state apart from a real load failure
    (`SpeakerDashboardService.cs:68-71`).
- **Why it's built this way**: keeping these on a dedicated interface, rather than folding them into
  [ISessionUIService](#isessionuiservice), isolates the cache-bypass semantics to the personalized
  surface and keeps the generic session CRUD cache-friendly. It also keeps the speaker-scoped
  authorization story simple: every method takes the speaker id explicitly, so the server has the
  subject it needs to check ownership on every call `[Rubric §11, Security]`.
- **Where it's used**: implemented by [SpeakerDashboardService](#speakerdashboardservice)
  (`SpeakerDashboardService.cs:14-16`) and registered explicitly at `DependencyInjection.cs:38` (an
  explicit `AddScoped` because it is not an `IEntityService<,>` and the assembly scan would not find
  it); injected into [SpeakerDashboard](#speakerdashboard)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerDashboard.razor.cs:25`),
  which calls three of the four methods (`SpeakerDashboard.razor.cs:108`, `:136`, `:269`).
- **Caveats / not-in-source**: `GetSessionBookmarkCountAsync`, the single-session count, has no page
  consumer today; the dashboard uses the batched form. It remains on the contract, is implemented
  (`SpeakerDashboardService.cs:45`), and is covered by unit tests
  (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/Services/SpeakerDashboardServiceTests.cs:121,135`).

### ISpeakerUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/ISpeakerUIService.cs:10` · Level 4 · interface

- **What it is**: the UI-service contract for the `speakers` resource, extending generic CRUD with two
  user-linking operations (`ISpeakerUIService.cs:10-15`).
- **Depends on**: [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [SpeakerDTO](group-17-conference-domain.md#speakerdto),
  [Result](group-01-result-error-handling.md#result) (`ISpeakerUIService.cs:2`), and the
  `SpeakerIdentifierType` / `UserIdentifierType` aliases (the second crosses into Identity's vocabulary
  as a scalar, never as a project reference).
- **Concept**: `[Rubric §9, API & Contract Design]`, state-transition verbs over generic update, the
  same rationale as [IEventUIService](#ieventuiservice). Linking a speaker to a user account is a
  distinct operation, not a field edit, so it gets `LinkUserAsync` / `UnlinkUserAsync`.
  `[Rubric §7, Microservices Readiness]` assesses whether cross-module consistency travels over
  decoupled edges: the UI issues one call against Conference, and the Identity side of the association
  is reconciled asynchronously by the `SpeakerLinkedToUser` / `SpeakerUnlinkedFromUser` integration
  events, so this contract deliberately says nothing about Identity.
  `[Rubric §18, UI Architecture]`.
- **Walkthrough**: two added members, both returning [Result](group-01-result-error-handling.md#result).
  - `LinkUserAsync(SpeakerIdentifierType speakerId, UserIdentifierType userId, CancellationToken)`
    (`ISpeakerUIService.cs:12`).
  - `UnlinkUserAsync(SpeakerIdentifierType speakerId, CancellationToken)` (`ISpeakerUIService.cs:14`);
    unlink needs only the speaker id, because the association is single-valued from the speaker's side.
- **Why it's built this way**: a valueless `Result` is the right return shape for a confirm-only call.
  There is no payload worth deserializing, but the failure still has to carry the server's
  [ErrorType](group-01-result-error-handling.md#errortype) so the page can tell "already linked" from
  "not permitted".
- **Where it's used**: implemented by [SpeakerService](#speakerservice); injected into
  [SpeakerList](#speakerlist) (`Pages/Speaker/SpeakerList.razor.cs:23`),
  [SpeakerDetail](#speakerdetail)'s link-to-user control (`Pages/Speaker/SpeakerDetail.razor.cs:27`),
  [SpeakerCreate](#speakercreate) (`Pages/Speaker/SpeakerCreate.razor.cs:17`),
  [SpeakerDashboard](#speakerdashboard) (`Pages/Speaker/SpeakerDashboard.razor.cs:23`) and the public
  speaker pages ([PublicSpeakerList](#publicspeakerlist) `:42`,
  [PublicSpeakerDetail](#publicspeakerdetail) `:22`).

### SpeakerDashboardService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/SpeakerDashboardService.cs:14` · Level 4 · class (sealed)

- **What it is**: the bespoke authenticated HTTP service behind the speaker's own dashboard. It exposes
  four speaker-scoped reads: the sessions this speaker presents, how many attendees bookmarked one of
  those sessions (single and batched variants), and the aggregated feedback for a session. It extends
  [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) directly rather
  than the CRUD base, and implements [`ISpeakerDashboardUIService`](#ispeakerdashboarduiservice)
  (`SpeakerDashboardService.cs:14-16`).
- **Depends on**: [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase)
  for `CreateAuthenticatedClientAsync()` and the shared static Polly `RetryPolicy`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:25,51`);
  [`HttpResultExecutor`](group-15-common-ui-framework.md#httpresultexecutor) and
  [`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader);
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt);
  [`SessionDTO`](group-17-conference-domain.md#sessiondto) and
  [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice); the
  `SpeakerIdentifierType` / `SessionIdentifierType` aliases; BCL `IHttpClientFactory`,
  `CultureInfo.InvariantCulture`, `Guid`.
- **Concept introduced, the server-filtered, cache-bypassing dashboard read.** These are computed,
  actor-scoped reads, not an entity surface, so the class drops to the thinner authenticated base and
  hand-builds each request. Two mechanisms inside `GetSpeakerSessionsAsync` are load-bearing, and the
  inline comment block (`SpeakerDashboardService.cs:25-34`) explains both.
  - **Filter on the server, not in memory.** The URL sends `filters[SpeakerId].operator=equals` and
    `filters[SpeakerId].value={speakerId}` (`SpeakerDashboardService.cs:38`), a *virtual* filter key.
    `Session` has no `SpeakerId` column, so
    [`SessionsController`](group-20-conference-api-grpc.md#sessionscontroller) removes the key from the
    filter dictionary, parses it with `TryParse` under the invariant culture, and resolves it through the
    SessionSpeaker join before ANDing the result with the public-session specification
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionsController.cs:113-122`,
    documented at `:90-94`). The request also asks for `includeFKs=false&includeChildren=false` and caps
    the page at `MaxSpeakerSessions = 100` (`SpeakerDashboardService.cs:19,38`). The comment records what
    this replaced: fetching the whole catalog with every child collection and filtering client-side.
    `[Rubric §12, Performance & Scalability]` (assesses whether work happens where the data is; the
    predicate and the paging both run in the database) and `[Rubric §23, Front-End Performance]`
    (assesses payload size on the wire; the dashboard renders no child collections, so it asks for none).
  - **A deliberate cache bust.** A unique `_={Guid:N}` query parameter
    (`SpeakerDashboardService.cs:35,38`) makes this one read a guaranteed miss against the shared output
    cache. The reason is a read-populate-after-evict race: a read that began before a session assignment
    can populate the cache *after* the assignment's eviction fired, so the cached list lags a change the
    speaker just made and must see. Public and anonymous list reads keep their caching
    (`SpeakerDashboardService.cs:31-34`). `[Rubric §19, State Management]` (assesses how the UI keeps
    what it shows consistent with the server, and at what cost).
  The bookmark counts are produced server-side from the **Engagement** service across the gRPC boundary
  ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)); the UI sees only this one
  typed contract, which is what lets Engagement move without touching this file.
  `[Rubric §7, Microservices Readiness]`.
- **Walkthrough**
  - `MaxSpeakerSessions = 100` (`SpeakerDashboardService.cs:19`): an upper bound, on the stated reasoning
    that a conference speaker presents a handful of sessions (`:18`).
  - `GetSpeakerSessionsAsync(speakerId, ct)` (`SpeakerDashboardService.cs:21-43`) mints the cache bust
    (`:35`), builds the paged URL with `string.Create(CultureInfo.InvariantCulture, ...)` sorted
    `StartsAt asc` (`:36-38`), dispatches through the private `SendGetRequestAsync<T>` into a
    [`PagedCollectionResult<SessionDTO>`](group-01-result-error-handling.md#pagedcollectionresultt)
    because the paged endpoint answers with an envelope rather than a bare array (`:40-41`), then `Map`s
    the envelope to the item list, substituting an empty list for a null `Items` (`:42`). `Map` runs only
    on success and a failure passes through untouched, which is what makes the one-line projection safe.
  - `GetSessionBookmarkCountAsync(speakerId, sessionId, ct)` (`SpeakerDashboardService.cs:45-52`) GETs
    `speakers/{speakerId}/sessions/{sessionId}/bookmarks/count` (`:50`) and returns the deserialized
    count as a `Result<int>`.
  - `GetSessionBookmarkCountsAsync(speakerId, sessionIds, ct)` (`SpeakerDashboardService.cs:54-66`) is
    the batched variant. It short-circuits an empty id list into a successful empty dictionary with no
    round trip (`:59-60`), joins one repeated `sessionIds=` parameter per id (`:62-63`), and maps the
    concrete `Dictionary` up to the read-only interface the caller declares (`:64-65`). One request for a
    whole grid instead of one per row.
  - `GetSessionFeedbackAsync(speakerId, sessionId, ct)` (`SpeakerDashboardService.cs:73-80`) GETs
    `speakers/{speakerId}/sessions/{sessionId}/feedback` (`:78`). "No feedback captured yet" is a
    legitimate domain state and arrives as an `ErrorType.NotFound` **failure**, which the caller tells
    apart from a real load failure with `IsNotFound()`, as the doc comment states (`:68-72`). The typed
    error is the branch; there is no sentinel value to interpret.
  - `SendGetRequestAsync<T>(url, ct)` (`SpeakerDashboardService.cs:92-104`) is the central GET dispatch.
    [`HttpResultExecutor`](group-15-common-ui-framework.md#httpresultexecutor)`.ExecuteAsync` wraps the
    body (`:95`), the client carries the bearer token (`:98`), the GET runs through the Polly
    `RetryPolicy` (`:99-101`), and
    [`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader) turns the response into a
    `Result<T>` (`:102`).
  - Every URL is built with `string.Create(CultureInfo.InvariantCulture, ...)` and every call leads with
    `speakerId`, so the server scopes the read to the calling speaker rather than trusting a filter.
    `[Rubric §11, Security]` (assesses whether authorization scope is enforced by the resource shape
    rather than by client-side filtering).
- **Why it's built this way**: aggregate dashboard reads fit neither the entity-CRUD nor the lookup
  shape, so they get their own narrow service. The cache bust trades one extra origin fetch for
  correctness on the one surface where staleness is unacceptable, while the anonymous public list keeps
  its output cache.
- **Where it's used**: registered explicitly as [`ISpeakerDashboardUIService`](#ispeakerdashboarduiservice)
  at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:38`, and injected
  into [`SpeakerDashboard`](#speakerdashboard), the speaker's "My Sessions" page
  (`Pages/Speaker/SpeakerDashboard.razor.cs:24`).
- **Caveats / not-in-source**: the retry-plus-reader dispatch in `SendGetRequestAsync` is a deliberate
  private copy of the `EntityServiceBase.SendRequestAsync` semantics rather than inherited behavior, as
  the doc comment says (`SpeakerDashboardService.cs:82-88`), so the two must be kept in step by hand. The
  100-session page cap (`:19,38`) is an upper bound, not a paging mechanism: a speaker with more sessions
  would silently see only the first 100.

### SpeakerLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/SpeakerLookupService.cs:12` · Level 4 · class (sealed)

- **What it is**: a small read service that fetches every speaker once and builds a speaker-keyed lookup
  dictionary (`SpeakerIdentifierType` to [`SpeakerInfo`](#speakerinfo)), so pages holding raw speaker ids
  can render display names and profile pictures (`SpeakerLookupService.cs:12-45`). It implements
  [`ISpeakerLookupService`](#ispeakerlookupservice).
- **Depends on**: [`SpeakerInfo`](#speakerinfo), the three-field projection it emits
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/ISpeakerLookupService.cs:9-12`);
  [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) as the wire shape;
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt);
  [`HttpResultExecutor`](group-15-common-ui-framework.md#httpresultexecutor) and
  [`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader); BCL `IHttpClientFactory`.
  Note what is **absent**: the primary constructor takes only `IHttpClientFactory`
  (`SpeakerLookupService.cs:12`), with no
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) and no
  [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) base. This is an
  unauthenticated public read, so it also gets none of that base's Polly retry.
- **Concept introduced, the client-side denormalizing lookup.** Session and event pages hold speaker
  *ids* but must show speaker *names*. Rather than issue one fetch per referenced speaker, this service
  pulls the whole speaker set in one call and hands back an in-memory dictionary the page indexes
  locally; the doc comment states exactly that use (`SpeakerLookupService.cs:8-11`).
  `[Rubric §23, Front-End Performance]` (assesses whether a view avoids N per-item round trips; one call
  serves a whole grid). `[Rubric §9, API & Contract Design]` shows up in the query string:
  `includeFKs=false&includeChildren=false` asks the server for the flat rows only, so the bulk read stays
  cheap on both ends. The dictionary is keyed by the identifier alias rather than a bare primitive, which
  is what makes a wrong-id lookup a compile error
  ([ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)).
- **Walkthrough**
  - `GetAllAsync(ct)` (`SpeakerLookupService.cs:15-30`) is an expression-bodied method returning
    `Result<IReadOnlyDictionary<SpeakerIdentifierType, SpeakerInfo>>`. The body runs inside
    [`HttpResultExecutor`](group-15-common-ui-framework.md#httpresultexecutor)`.ExecuteAsync` (`:17`), so
    a dead network becomes a transport failure rather than a thrown exception. It resolves the named
    `"APIClient"` client from the factory (`:20`), GETs
    `speakers?includeFKs=false&includeChildren=false&pageSize=10000`, a deliberately large page meant to
    pull every speaker in one request (`:21-23`), reads the response into a
    `Result<PagedCollectionResult<SpeakerDTO>>` through
    [`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader) (`:25-26`), and then
    `Map`s that page through `BuildLookup` (`:28`). Mapping rather than unwrapping is the point: the
    projection runs only on success, and an API-described failure travels out with its
    [`ErrorType`](group-01-result-error-handling.md#errortype) intact.
  - `BuildLookup(page)` (`SpeakerLookupService.cs:32-45`) is a private static. It substitutes an empty
    list for a null `Items` (`:35`), fills a `Dictionary<SpeakerIdentifierType, SpeakerInfo>` with `Id`,
    `FullName` and `ProfilePicture` per speaker (`:37-42`), and returns it as an `IReadOnlyDictionary`
    (`:44`). Being `static` is not decoration: it proves the projection touches no instance state, so it
    reads in isolation.
- **Why it's built this way**: one bulk fetch plus a local index is far cheaper than per-id lookups when
  a page renders many speaker references, and the projection to [`SpeakerInfo`](#speakerinfo) keeps only
  the three display fields the UI needs rather than the full
  [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), so what a page holds in memory stays small.
- **Where it's used**: registered as [`ISpeakerLookupService`](#ispeakerlookupservice) among the
  "cross-module lookup services"
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:51`), and injected
  into [`SessionList`](#sessionlist) (`Pages/Session/SessionList.razor.cs:26`),
  [`SessionDetail`](#sessiondetail) (`Pages/Session/SessionDetail.razor.cs:25`),
  [`PublicSessionList`](#publicsessionlist) (`Pages/Public/PublicSessionList.razor.cs:33`) and
  [`PublicSessionDetail`](#publicsessiondetail) (`Pages/Public/PublicSessionDetail.razor.cs:25`).
- **Caveats / not-in-source**: the `pageSize=10000` ceiling (`SpeakerLookupService.cs:22`) assumes the
  conference never exceeds 10,000 speakers; past that the lookup would silently miss speakers, and
  nothing here detects the truncation. The dictionary is rebuilt on every call (there is no memoization
  in this class), so a page that needs it twice pays for it twice. Because the read is unauthenticated,
  it sees only what the public speakers endpoint exposes.

### SpeakerDetailLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/SpeakerDetailLookupService.cs:13` · Level 5 · class (sealed)

- **What it is**: a composite read service that gathers the three display lookups the speaker detail
  page needs (the category items a speaker can be tagged with, the titles of the categories those
  items belong to, and the text of the questions a speaker answered) behind one call, answering with a
  single [`Result`](group-01-result-error-handling.md#result) that carries either all three or the
  first failure (`SpeakerDetailLookupService.cs:13-40`). It implements
  [`ISpeakerDetailLookupService`](#ispeakerdetaillookupservice) and its success value is the
  [`SpeakerDetailLookups`](#speakerdetaillookups) record.
- **Depends on**: three services injected through the primary constructor
  (`SpeakerDetailLookupService.cs:13-17`):
  [`ICategoryItemLookupService`](#icategoryitemlookupservice) (implemented by
  [`CategoryItemLookupService`](#categoryitemlookupservice)),
  [`IConferenceCategoryUIService`](#iconferencecategoryuiservice) and
  [`IQuestionUIService`](#iquestionuiservice), the last two being plain
  [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  CRUD contracts (`IConferenceCategoryUIService.cs:9-11`, `IQuestionUIService.cs:9-11`). Also
  [`Result`](group-01-result-error-handling.md#result) and its `Map`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Result.cs:276-280`), the `TryGetValue`
  extension from [`ResultUiExtensions`](group-15-common-ui-framework.md#resultuiextensions)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:82`),
  [`CategoryItemInfo`](#categoryiteminfo),
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) and
  [`QuestionDTO`](group-17-conference-domain.md#questiondto).
- **Concept introduced, the composite lookup service**. Most Conference pages load their reference data
  one service at a time, and every extra load costs the page a nullable cache field, a call site and a
  failure branch. A composite lookup collapses that into one interface, one call, one value object and
  one failure branch. The load-bearing detail is that it **composes, it does not replace**: each
  underlying lookup keeps its own service because other pages use them independently, and this class
  holds no state and no cache of its own (`SpeakerDetailLookupService.cs:13-18` declares nothing but
  the three injected dependencies). `[Rubric §1, SOLID]` (assesses whether a type has one reason to
  change): the page's job is rendering, and the gathering of its reference data now lives in one
  substitutable class, so a fourth lookup is a change here rather than a fourth branch in the page.
  `[Rubric §18, UI Architecture]` (assesses how presentation is layered above data access): the page
  depends on one narrow interface instead of three. `[Rubric §2, Design Patterns]` (assesses whether a
  recognized pattern is applied where it earns its keep): this is a facade over three collaborators,
  deliberately thin enough that it adds no behavior beyond ordering and failure short-circuiting.
- **Walkthrough** (`SpeakerDetailLookupService.cs:20-40`, one method)
  - `GetAllAsync(cancellationToken)` starts with the category items:
    `categoryItemLookupService.GetAllAsync(cancellationToken)` (`:20`), then unwraps with the
    `TryGetValue` UI extension (`:21`). On failure it re-wraps the errors into a failure of the
    composite type, `Result.Failure<SpeakerDetailLookups>(itemsResult.Errors)` (`:23`), so the error
    list travels intact and nothing is invented at this layer.
  - The category load repeats the shape: `categoryService.GetAllAsync(cancellationToken:
    cancellationToken)` (`:26`), unwrap (`:27`), propagate errors (`:29`). The named argument is
    required because the contract's first two parameters are the `includeFKs` and `includeChildren`
    flags (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IEntityService.cs:25-28`),
    so this call takes both defaults and asks only for the flat rows.
  - The question load is last, so it needs no early return: `questionsResult.Map(...)` (`:32`, `:34`)
    either projects the success value or passes the errors through unchanged (`Result.cs:276-280`).
  - The projection builds the [`SpeakerDetailLookups`](#speakerdetaillookups) record (`:34-37`). The
    category-item dictionary arrives already keyed from
    [`ICategoryItemLookupService`](#icategoryitemlookupservice) (`ICategoryItemLookupService.cs:20-21`),
    while the other two are lists indexed here: `categories.ToDictionary(c => c.Id, c => c.Title)`
    (`:36`) and `questions.ToDictionary(q => q.Id, q => q.QuestionText)` (`:37`). Both projections keep
    only the single display string the page renders, so the DTOs do not travel further into the UI.
- **Why it's built this way**: the three loads are a set, not three independent concerns, because the
  page cannot render its category panel or its answers section until all three are present. Making
  them one call means one place decides the order and one place decides what a partial failure means,
  and here that decision is strict: a failure in any one of them fails the whole call
  (`ISpeakerDetailLookupService.cs:27-30`). Returning
  [`Result`](group-01-result-error-handling.md#result) rather than throwing follows the framework-wide
  error contract ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)).
- **Where it's used**: registered explicitly rather than by the entity-service scan, because it
  implements no `IEntityService<,>`:
  `services.AddScoped<ISpeakerDetailLookupService, SpeakerDetailLookupService>()`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:57`). Its one
  consumer is [`SpeakerDetail`](#speakerdetail), which injects it
  (`Pages/Speaker/SpeakerDetail.razor.cs:29`), holds the value in a single nullable field for the life
  of the page (`SpeakerDetail.razor.cs:81`), calls it once inside the guarded load
  (`SpeakerDetail.razor.cs:129-141`), renders `QuestionTexts` through `GetQuestionText`
  (`SpeakerDetail.razor.cs:198-199`) and hands `CategoryItems` plus `CategoryTitles` to
  [`SpeakerCategoryItemsPanel`](#speakercategoryitemspanel)
  (`Pages/Speaker/SpeakerDetail.razor:169-172`). The interface is also what
  [`SpeakerDetailTests`](group-27-testing-infrastructure.md#speakerdetailtests) mocks
  (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/Pages/Speakers/SpeakerDetailTests.cs:30`),
  which is the practical payoff of the facade: one `Mock<ISpeakerDetailLookupService>` stands in for
  three collaborators. `[Rubric §14, Testability]` (assesses whether collaborators can be substituted
  at a narrow boundary).
- **Caveats / not-in-source**: the three loads are **sequential** awaits (`:20`, `:26`, `:32`), not a
  `Task.WhenAll`, so the page pays the sum of the three round trips rather than the longest of them.
  `[Rubric §23, Front-End Performance]` (assesses how much latency the first render waits on). The
  short-circuit is ordered, so a category-item failure means the other two calls are never made and
  the page reports one cause even when several are broken. `ToDictionary` (`:36-37`) throws on
  duplicate keys and nothing here guards that; uniqueness comes from the server, since both keys are
  entity primary keys. Nothing in this class caches: the "cached for the life of the page" behavior is
  the page's own null check on its field (`SpeakerDetail.razor.cs:129`), not something this service
  does.

### SpeakerService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/SpeakerService.cs:13` · Level 5 · class (sealed)

- **What it is**: the concrete HTTP service for the `speakers` WebAPI resource. It inherits the whole
  CRUD surface from
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  and adds the two operations specific to speakers: linking a user account to a speaker record and
  unlinking it again (`SpeakerService.cs:13-36`). It implements
  [`ISpeakerUIService`](#ispeakeruiservice).
- **Depends on**:
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  and, through it, [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase);
  the base's `Endpoint` property
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:51`) and its valueless
  `SendRequestAsync` overload (`EntityServiceBase.cs:354-370`);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`SpeakerDTO`](group-17-conference-domain.md#speakerdto);
  [`LinkUserRequest`](group-17-conference-domain.md#linkuserrequest);
  [`ISpeakerUIService`](#ispeakeruiservice); [`Result`](group-01-result-error-handling.md#result); the
  `SpeakerIdentifierType` and `UserIdentifierType` aliases; BCL `IHttpClientFactory` and
  `System.Net.Http.Json` (`SpeakerService.cs:1-5`).
- **Concept**: the thin-leaf CRUD service is taught at [`ActivityService`](#activityservice); this is
  that shape plus a two-method extension, and the extension is the standard recipe for adding a
  non-CRUD verb to an entity service. Build the relative URI from the inherited `Endpoint` so the
  resource name still lives in exactly one place, and dispatch through the base's protected
  `SendRequestAsync` instead of an `HttpClient` of your own, which is what buys the call the
  authenticated client, the Polly retry pipeline and the
  [`Result`](group-01-result-error-handling.md#result) conversion through
  [`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader)
  (`EntityServiceBase.cs:354-370`). `[Rubric §9, API & Contract Design]` (assesses whether the client
  speaks the server's contract exactly rather than an assumed one): link is a `PUT` to `{id}/link`
  carrying a [`LinkUserRequest`](group-17-conference-domain.md#linkuserrequest) body and unlink is a
  `DELETE` to the same path, which is precisely what the controller declares
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Speakers/SpeakersController.cs:375`,
  `:393`). `[Rubric §2, Design Patterns]` (assesses use of template-method style bases): the subclass
  supplies only what varies, the resource name and the two extra verbs.
- **Walkthrough**
  - The primary constructor takes `IHttpClientFactory` and
    [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) and forwards them
    with the resource name to the base:
    `EntityServiceBase<SpeakerDTO, SpeakerIdentifierType>("speakers", httpClientFactory, tokenStorageService)`
    (`SpeakerService.cs:13-15`). The base's fourth parameter, the optional
    [`IUiReadCache`](group-15-common-ui-framework.md#iuireadcache), is left at its `null` default
    (`EntityServiceBase.cs:43-47`), so every read here goes to the API.
  - `LinkUserAsync(speakerId, userId, cancellationToken)` (`SpeakerService.cs:17-26`): calls the
    valueless `SendRequestAsync` with a lambda that `PutAsJsonAsync`es a
    `new LinkUserRequest { UserId = userId }` to
    `new Uri($"{Endpoint}/{speakerId}/link", UriKind.Relative)` (`:21-25`). The URI is relative because
    the base resolves the named API client, and its configured base address, inside
    `CreateAuthenticatedClientAsync`
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:51-53`), which
    is also where the bearer token is attached (`AuthenticatedServiceBase.cs:57-62`). The interpolated
    `speakerId` is culture-safe because `SpeakerIdentifierType` aliases `System.Guid`
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:19`,
    [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)).
  - `UnlinkUserAsync(speakerId, cancellationToken)` (`SpeakerService.cs:28-35`): the same dispatch with
    `DeleteAsync` against the identical path and no body (`:32-34`). Both methods return the
    [`Result`](group-01-result-error-handling.md#result) the base produced, success for any 2xx and
    otherwise the errors the ProblemDetails response described (`EntityServiceBase.cs:354-370`); the
    server answers `NoContent` on both success paths (`SpeakersController.cs:390`, `:407`).
  - Neither call passes an `idempotencyKey` or an `ifMatch`, both optional parameters of that overload
    (`EntityServiceBase.cs:354-358`). That matches the contract the base documents: a key is for
    non-idempotent writes (creates), and link and unlink are a `PUT` and a `DELETE` whose repetition
    lands on the same state (`EntityServiceBase.cs:310-312`,
    [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)).
- **Why it's built this way**: linking a user to a speaker is a relationship operation, not a field
  edit, so it is its own endpoint rather than a `PUT` of the whole
  [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), and the client mirrors that. Keeping the
  two methods on the subclass, and on [`ISpeakerUIService`](#ispeakeruiservice) which extends the
  generic contract (`ISpeakerUIService.cs:10-15`), means pages doing plain CRUD never see them while
  the organizer page that needs them gets them without a cast.
- **Where it's used**: registered by the Scrutor scan inside `AddUIModule<ConferenceUIModule>()`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:29`, which scans
  the module assembly for `IEntityService<,>` implementations at
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:210-214`), so no explicit
  `AddScoped` line exists for it. Injected as [`ISpeakerUIService`](#ispeakeruiservice) into
  [`SpeakerList`](#speakerlist) (`Pages/Speaker/SpeakerList.razor.cs:23`),
  [`SpeakerDetail`](#speakerdetail) (`Pages/Speaker/SpeakerDetail.razor.cs:27`),
  [`SpeakerCreate`](#speakercreate) (`Pages/Speaker/SpeakerCreate.razor.cs:17`),
  [`SpeakerDashboard`](#speakerdashboard) (`Pages/Speaker/SpeakerDashboard.razor.cs:23`),
  [`PublicSpeakerList`](#publicspeakerlist) (`Pages/Public/PublicSpeakerList.razor.cs:42`) and
  [`PublicSpeakerDetail`](#publicspeakerdetail) (`Pages/Public/PublicSpeakerDetail.razor.cs:22`). The
  two link verbs have exactly one caller each, both on [`SpeakerDetail`](#speakerdetail)
  (`SpeakerDetail.razor.cs:302` and `:327`).
- **Caveats / not-in-source**: the base invalidates its read cache only from the CRUD verbs, through a
  private `InvalidateOnSuccess` (`EntityServiceBase.cs:165`, `:187`, `:213`, `:281-288`), so the two
  link verbs here evict nothing. That is inert as written, because this service is constructed without
  an [`IUiReadCache`](group-15-common-ui-framework.md#iuireadcache); the server-side output cache is
  evicted by the controller itself on both paths (`SpeakersController.cs:389`, `:406`,
  [ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).
  Authorization for both endpoints is enforced server side with
  `[HasPermission(ConferencePermissions.SpeakersManage)]` (`SpeakersController.cs:376`, `:394`,
  [ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)): the client
  sends the bearer token and reports whatever the server decides.

### SpeakerQr

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerQr.razor.cs:19` · Level 1 · class (Blazor code-behind)

- **What it is**: the speaker-facing side of their own QR code. It renders one full-screen code that points at the speaker's PUBLIC profile page, for holding up at the podium or parking on a booth screen (class doc, `SpeakerQr.razor.cs:9-11`).
- **Depends on**: [`IPublicLinkBuilder`](group-15-common-ui-framework.md#ipubliclinkbuilder) (`:21`), [`ConferenceRoutePaths`](#conferenceroutepaths)'s `PublicSpeakerDetails(id)` route factory (`:55`, defined at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:48`). Externals: the cascading `Task<AuthenticationState>` (`:23-24`), MudBlazor's `BreadcrumbItem` and `Icons` (`:26,34`), and the `IStringLocalizer<SpeakerQr>` injected by the template (`SpeakerQr.razor:4`). The code image itself is the shared `QrCodeImage` component from `MMCA.Common.UI`, configured in markup (`SpeakerQr.razor:26-30`).
- **Concept introduced, the zero-fetch page and the absolute-URL payload rule.** Two ideas make this the smallest complete page in the group.
  1. **No backend call at all.** The speaker's identity comes from the `speaker_id` JWT claim (`:49`) and the payload string is composed locally (`:55`), so nothing is awaited except the cascading auth state. The class doc states the consequence directly (`:13-14`): the page renders on the SSR prerender pass exactly as it does on the interactive pass, which removes the whole loading-state and double-fetch problem that pages such as [`SpeakerDashboard`](#speakerdashboard) have to solve. `[Rubric §23, Front-End Performance & Rendering]` (assesses network work per view): the cheapest fetch is the one that does not exist.
  2. **The payload must be an absolute public URL.** `LinkBuilder.BuildAbsolute(...)` (`:55`) is not decoration. A relative path, or the origin the MAUI head's WebView serves from, would encode into a code that resolves for nobody outside that device (class doc, `:15-16`). Building the link through the shared builder is what keeps one page correct on the web head and on the native head at once. `[Rubric §26, Front-End Security]` (assesses that client-composed links point where they claim to) and `[Rubric §22, Responsive & Cross-Browser]` (the same component ships to two very different hosts).
  The name rendered beside the code (`:47`, markup at `SpeakerQr.razor:32`) is deliberate too: the in-code comment says a person scanning should be able to see whose profile they are about to open before they open it. `[Rubric §21, Accessibility]`: the image also carries a localized `AltText` (`SpeakerQr.razor:27`), because a QR code is opaque to a screen reader by construction.
- **Walkthrough**
  - State (`:26-28`): three fields only, the breadcrumb list, the nullable `_payload`, and `_displayName`.
  - `OnInitializedAsync` (`:30-56`): builds the two-crumb trail (`:32-36`), returns early when no auth state is cascaded (`:38-41`), reads the display name off `state.User.Identity?.Name` (`:47`), then looks for the `speaker_id` claim and returns unless it parses as a `Guid` (`:49-53`). Only on that path is `_payload` assigned (`:55`).
  - The null-payload branch is the page's entire error handling: the markup renders an informational alert instead of a card (`SpeakerQr.razor:11-18`), with an in-markup comment noting that the nav item is claim-gated but a bookmarked or typed URL still lands here without the claim. `[Rubric §24, Forms, Validation & UX Safety]`: an unreachable state gets a sentence, not an empty screen.
  - The code's own rendering parameters are argued in markup (`SpeakerQr.razor:24-25`): `PixelsPerModule="14"` so the code stays readable from a few steps away, and `ErrorCorrection="QrErrorCorrectionLevel.Medium"` so glare on a phone camera does not kill the scan.
- **Why it's built this way**: the public speaker page already carries the same code for whoever is reading it (class doc, `:10-11`); this page exists so the speaker can present that code rather than have to be found first. Deriving everything from the claim means the page cannot show one speaker's code to another.
- **Where it's used**: the `/speaker/qr` route, gated by a bare `[Authorize]` (`SpeakerQr.razor:1-2`), so any signed-in user reaches the page and only the claim decides whether a code appears. It links to the same public route [`PublicSpeakerDetail`](#publicspeakerdetail) serves.

---

### ActivityFormModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Activities` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activities/ActivityFormModel.cs:25` · Level 2 · class (abstract)

- **What it is**: the editable activity fields, declared once, for both the create page and the detail page's inline editor. It carries the DataAnnotations rules for the text fields, the four half-picked schedule values, and the computed properties that recombine them.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`:1`) and [`ActivityDTO`](group-17-conference-domain.md#activitydto) (`:2`), which owns the length constants the rules quote. Its rules are executed through [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) and [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator).
- **Concept introduced, one form model behind two forms.** This is the shape every Conference create/edit pair in this unit now uses, and it is worth reading once here.
  1. **Rules declared once, not per control.** Each property carries its own `[Required]` / `[MaxLength]` with the length taken from the DTO constant (`:35-53`), and the pages bridge MudBlazor's per-field validation to those attributes with a single delegate built by `ModelValidation.For(...)` rather than repeating `Required="true"` and `RequiredError="..."` on every `MudTextField` (class doc, `:7-13`). Because both pages bind the same `ActivityFormFields` component to an instance of this type, a name the create page accepts is a name the detail page accepts. `[Rubric §24, Forms, Validation & UX Safety]` (assesses whether validation is expressed once and consistently) and `[Rubric §15, Best Practices & Code Quality]`: adding a field is one property here plus one control in the shared field block.
  2. **Error messages are resource keys, not sentences.** `ErrorMessage = "Error.NameMaxLength"` (`:36`) is a key that the page's localizing validator resolves at render time, which is what lets DataAnnotations participate in the localization strategy of [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html). `[Rubric §27, Internationalization]`. The `NameRequiredKey` constant (`:32`) exists so the model rule and the field's own `RequiredError` affordance quote one key instead of two copies of a literal.
  3. **The rule DataAnnotations cannot express stays out.** The start/end window is four separate properties (`:56-65`) because two `DateTime` values are picked as four controls; no attribute can state "end after start", so the model exposes the raw parts plus the derived answers and leaves the check to the page, which owns the wording of the three schedule messages (class doc, `:18-23`). `[Rubric §1, SOLID]`: the model states what it can state and does not pretend to own the rest.
- **Walkthrough**
  - Text fields (`:35-53`): `Name` (required, `ActivityDTO.NameMaxLength`), `Description`, `VenueName`, `VenueAddress`, `VenueUrl`, each capped from the DTO constant.
  - Schedule parts (`:56-65`): `StartDate` / `StartTime` and `EndDate` / `EndTime`, nullable so "not picked yet" is representable.
  - `SortOrder` (`:68`): the tie-break between activities starting at the same instant.
  - Derived (`:71-86`): `HasStart` and `HasEnd` report whether both halves are present; `StartsAt` and `EndsAt` collapse a date plus a `TimeSpan` into one `DateTime` and are documented as valid only once the matching `Has*` is true (`:76-79`, `:82-85`).
- **Why it's built this way**: the create form and the edit form of the same aggregate diverging is a classic and invisible defect (a field that is required on one and optional on the other). Making the shared base the only declaration site removes the possibility rather than testing for it.
- **Where it's used**: subclassed by [`ActivityCreateModel`](#activitycreatemodel) and [`ActivityEditModel`](#activityeditmodel); bound by [`ActivityCreate`](#activitycreate) (`ActivityCreate.razor.cs:82`) and [`ActivityDetail`](#activitydetail) (`ActivityDetail.razor.cs:74`) through the shared `ActivityFormFields` component.

---

### ActivityCreateModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Activities` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activities/ActivityCreateModel.cs:11` · Level 3 · class (sealed)

- **What it is**: the create page's binding target. It adds nothing to [`ActivityFormModel`](#activityformmodel) except the mapping onto the DTO that gets posted.
- **Depends on**: [`ActivityFormModel`](#activityformmodel) (`:11`), [`ActivityDTO`](group-17-conference-domain.md#activitydto) and the `EventIdentifierType` alias (`:1,19`).
- **Concept introduced**: none new. It is the create half of the shared-form-model pattern [`ActivityFormModel`](#activityformmodel) teaches.
- **Walkthrough**: `ToNew(EventIdentifierType eventId)` (`:19-32`) is the only member. It sends `Id = default` (`:22`) and lets the server mint the key, sets `StartTime` / `EndTime` from the base's combined `StartsAt` / `EndsAt` (`:25-26`), and stamps the owning event from the argument (`:31`). `[Rubric §8, Data Architecture]` (assesses a deliberate identity strategy): compare [`SpeakerCreateModel`](#speakercreatemodel), which mints its own `Guid` client-side because a speaker's key is a GUID rather than a server-assigned int.
- **Why it's built this way**: the owning event is a create-time-only decision (the class doc says so at `:5-9`), so it is a parameter of the mapping rather than a property on the shared base that the edit form would also have to bind.
- **Where it's used**: [`ActivityCreate`](#activitycreate) holds one instance (`ActivityCreate.razor.cs:82`) and calls `ToNew` on the save path (`ActivityCreate.razor.cs:174`).

---

### ActivityEditModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Activities` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activities/ActivityEditModel.cs:12` · Level 3 · class (sealed)

- **What it is**: the detail page's inline-editor binding target: the same shared fields plus the two mappings an edit needs, load-from-record and build-the-update.
- **Depends on**: [`ActivityFormModel`](#activityformmodel) (`:12`) and [`ActivityDTO`](group-17-conference-domain.md#activitydto) (`:1`).
- **Concept introduced, the edit buffer as a typed object.** The older shape of these pages kept a row of loose `_edit*` fields on the code-behind; folding them into a model class means the buffer has a name, the copy-in and copy-out are two methods rather than twenty assignments, and the same DataAnnotations that guard the create form guard the editor. The loaded `ActivityDTO` is never mutated: cancelling an edit simply abandons this object. `[Rubric §19, State Management & Data Flow]` (assesses where mutable state lives and how long it lives).
  `ToUpdated` also carries the concurrency token forward: `RowVersion = activity.RowVersion` (`:45`) is the client half of the optimistic-concurrency contract in [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html), so a stale editor loses the write instead of silently overwriting a newer one. `[Rubric §8, Data Architecture]`.
- **Walkthrough**
  - `LoadFrom(ActivityDTO)` (`:16-34`): null-guards, then copies the ten editable values off the loaded record, splitting the two instants back into the four picker halves (`:22-25`).
  - `ToUpdated(ActivityDTO)` (`:38-56`): rebuilds the DTO from the edited values over three preserved fields, `Id` (`:44`), `RowVersion` (`:45`) and `EventId` (`:54`). Preserving the event id here, rather than binding it, is what enforces the class doc's rule (`:6-10`) that moving an activity between events is a create plus a delete.
- **Why it's built this way**: an unmapped field is the failure mode of a hand-rolled edit form; keeping copy-in and copy-out adjacent in one small file makes the two halves reviewable against each other.
- **Where it's used**: [`ActivityDetail`](#activitydetail) holds one instance (`ActivityDetail.razor.cs:74`), seeds it in `StartEditing` (`ActivityDetail.razor.cs:144`) and posts `ToUpdated` from `SaveChangesAsync` (`ActivityDetail.razor.cs:209`).

---

### SpeakerFormModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerFormModel.cs:25` · Level 3 · class (abstract)

- **What it is**: the speaker equivalent of [`ActivityFormModel`](#activityformmodel): the eleven editable speaker fields with their rules, shared by the organizer create page and the detail page's inline editor.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`:1`), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) for every length constant (`:2`), and [`AbsoluteUrlAttribute`](group-15-common-ui-framework.md#absoluteurlattribute) from `MMCA.Common.UI.Validation` (`:3,75,80,85`).
- **Concept introduced, the framework validation attribute alongside the BCL ones.** The shared-model pattern is the one [`ActivityFormModel`](#activityformmodel) already taught; what is new here is the mix of rule sources on one model. `[EmailAddress]` (`:62`) is the BCL attribute, `[MaxLength]` (`:43`, and eight more) quotes a DTO constant, and `[AbsoluteUrl]` (`:75,80,85`) is the framework's own attribute applied to the three social URLs, so "http://..." style input is rejected in the browser with the same mechanism and the same resource-key error style as everything else. `[Rubric §24, Forms, Validation & UX Safety]` and `[Rubric §26, Front-End Security]` (assesses that user-supplied URLs are constrained before they are rendered as links).
  The `Bio` property is the instructive exception (`:52-55`): it carries **no** rule at all, and the doc explains why. The biography is stored unbounded, so the character cap the markup applies is a UI affordance rather than an invariant, and inventing a rule here would make the form stricter than the aggregate. It still lives on the model because both forms bind it. `[Rubric §4, Domain-Driven Design]`: a UI rule is not promoted to an invariant just because it is convenient.
- **Walkthrough**
  - Resource-key constants (`:32,39`): `FirstNameRequiredKey` and `LastNameRequiredKey`, quoted by the model rule and by the field's `RequiredError` affordance alike.
  - Required identity fields (`:42-49`): `FirstName` and `LastName`, each required and capped.
  - Optional profile fields (`:52-72`): `Bio` (unruled), `TagLine`, `Email` (format plus cap), `ProfilePicture`, `TwitterHandle`.
  - Social URLs (`:75-87`): `LinkedInUrl`, `GitHubUrl`, `WebsiteUrl`, each `[AbsoluteUrl]` plus a cap.
- **Why it's built this way**: the same argument as the activity model, with one addition. A speaker record is edited from three different places in this application (the organizer create page, the organizer detail page, and the speaker's own dashboard), so having a single declaration of the rules is what keeps the first two identical; see the caveat on [`SpeakerDashboard`](#speakerdashboard) for the third.
- **Where it's used**: subclassed by [`SpeakerCreateModel`](#speakercreatemodel) and [`SpeakerEditModel`](#speakereditmodel); bound through the shared `SpeakerFormFields` component by [`SpeakerCreate`](#speakercreate) (`SpeakerCreate.razor:24`) and [`SpeakerDetail`](#speakerdetail) (`SpeakerDetail.razor:35`).

---

### SpeakerUserSearch

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerUserSearch.cs:12` · Level 4 · class (internal static)

- **What it is**: the candidate lookup behind the speaker-to-user link picker on [`SpeakerDetail`](#speakerdetail). Given typed text, it returns up to ten distinct users whose email, first name or last name matches.
- **Depends on**: [`IUserUIService`](group-24-identity-module.md#iuseruiservice) and [`UserListDTO`](group-24-identity-module.md#userlistdto) from the Identity module (`:1-2`), and [`Result<T>`](group-01-result-error-handling.md#result) (`:3,59`).
- **Concept introduced, fanning out because the server ANDs.** The remark on `FindAsync` (`:20-25`) states the constraint plainly: the paged users endpoint combines its filter parameters with AND, so one call carrying email, first name and last name would return the empty intersection for any real search term. The method therefore issues three independent single-filter calls, awaits them together, and unions the answers. `[Rubric §9, API & Contract Design]` (assesses whether a client can express its intent in the contract it is given): this is a client-side workaround for a server contract with no OR, and writing it down beside the code is what keeps the next reader from "simplifying" it back into one broken call.
  The failure policy is the second idea. `ItemsOf` (`:59-60`) turns a failed `Result` into an empty list, so a lookup that fails contributes nothing and the picker offers whatever the other two returned; a cancellation returns an empty list outright (`:54-57`). No snackbar is raised, because an error surfaced inside an autocomplete popover while a user is still typing is noise, not information. `[Rubric §29, Resilience & Business Continuity]` (assesses partial-failure behavior) and `[Rubric §24, Forms, Validation & UX Safety]`.
  Also worth noting is what this file's existence buys: the class doc (`:8-11`) says it is kept beside the page rather than inside the code-behind so the page holds only its own edit and link state. It has no component base, no injected service of its own, and takes its collaborator as a parameter, which makes it directly unit-testable without a renderer. `[Rubric §14, Testability]`.
- **Walkthrough**
  - `MaxSuggestions = 10` (`:15`), applied twice over: as the `pageSize` of each of the three calls and as the final `Take` (`:52`), so neither one lookup nor the union can flood the popover.
  - `FindAsync` (`:30-61`): returns empty for blank input (`:35-38`); starts the three tasks without awaiting each in turn (`:42-44`) and joins them with `Task.WhenAll` (`:46`), so the three round trips overlap; concatenates, then `DistinctBy(u => u.UserId)` (`:51`) because a person matching on two fields must appear once.
  - `ItemsOf` (`:59-60`) is a `static` local function, which is the pattern the analyzer baseline pushes toward: no closure over the enclosing method's state.
- **Why it's built this way**: linking a speaker record to a login is a rare organizer action against a large user set, so the search has to be forgiving about which field the organizer remembers while staying one interaction, not three.
- **Where it's used**: called only by [`SpeakerDetail`](#speakerdetail)'s `SearchUsersAsync` (`SpeakerDetail.razor.cs:291-292`), which is bound to the `MudAutocomplete`'s `SearchFunc` (`SpeakerDetail.razor:146-148`).

---

### SpeakerCreateModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerCreateModel.cs:10` · Level 5 · class (sealed)

- **What it is**: the organizer create page's binding target, adding only the mapping onto the [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) it posts.
- **Depends on**: [`SpeakerFormModel`](#speakerformmodel) (`:10`) and [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) (`:1`).
- **Concept introduced**: none new beyond [`SpeakerFormModel`](#speakerformmodel), but one detail is worth contrasting. `ToNew` mints the identity client-side with `Id = Guid.NewGuid()` (`:20`), where [`ActivityCreateModel`](#activitycreatemodel) sends `Id = default` and lets the server assign an int. That is the identifier-alias strategy of [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html) showing through: a GUID-keyed aggregate can be named before it is stored, an int-keyed one cannot. `[Rubric §8, Data Architecture]`.
- **Walkthrough**: `ToNew()` (`:17-32`) is the only member. It composes `FullName` from the two entered parts (`:23`), which keeps the denormalized display name in step with the fields the organizer actually typed, and copies the remaining nine optional fields straight across.
- **Why it's built this way**: the create page collects exactly the shared field set and nothing else, so the subclass is a mapping and not a second declaration of the form.
- **Where it's used**: [`SpeakerCreate`](#speakercreate) holds one instance (`SpeakerCreate.razor.cs:43`) and posts `ToNew()` (`SpeakerCreate.razor.cs:71`).

---

### SpeakerEditModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerEditModel.cs:11` · Level 5 · class (sealed)

- **What it is**: the edit buffer for the inline speaker editor on the organizer detail page: the shared fields plus load-from-record and build-the-update.
- **Depends on**: [`SpeakerFormModel`](#speakerformmodel) (`:11`) and [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) (`:1`).
- **Concept introduced**: the typed edit buffer, as [`ActivityEditModel`](#activityeditmodel) describes it. The speaker variant preserves one more field on the way out.
- **Walkthrough**
  - `LoadFrom(SpeakerDTO)` (`:18-33`): null-guards, then copies the ten editable values off the displayed speaker. The doc frames the value plainly (`:15-17`): opening the editor becomes one call rather than ten assignments on the page.
  - `ToUpdated(SpeakerDTO)` (`:40-61`): edited values over four preserved ones, `Id` (`:46`), `RowVersion` (`:47`, [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)), the recomposed `FullName` (`:50`), and `LinkedUserId` (`:59`). Preserving the linked user is the same trick [`ActivityEditModel`](#activityeditmodel) uses on the owning event: linking and unlinking is its own action on the detail page (see [`SpeakerDetail`](#speakerdetail)), so the field cannot be bound and cannot be lost. `[Rubric §24, Forms, Validation & UX Safety]`.
- **Why it's built this way**: an edit form that silently drops a field it does not display is the failure this shape removes; every field the editor does not own is re-sent from the loaded record, in one visible place.
- **Where it's used**: [`SpeakerDetail`](#speakerdetail) holds one instance (`SpeakerDetail.razor.cs:73`), seeds it in `StartEditing` (`SpeakerDetail.razor.cs:209`) and posts `ToUpdated` from `SaveChangesAsync` (`SpeakerDetail.razor.cs:232`).

---

### SpeakerCreate

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerCreate.razor.cs:15` · Level 6 · class (Blazor code-behind)

- **What it is**: the organizer's speaker-creation form. It binds one [`SpeakerCreateModel`](#speakercreatemodel), validates it, posts one [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), and redirects to the detail page for the record it just made.
- **Depends on**: [`ISpeakerUIService`](#ispeakeruiservice) (`:17`), [`IToastService`](group-15-common-ui-framework.md#itoastservice) (`:19`), [`SpeakerCreateModel`](#speakercreatemodel) (`:43`), [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) and [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator) (`:37`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:32,80,92`), and [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (`:64`). Externals: `NavigationManager` (`:18`), MudBlazor's `MudForm`, `BreadcrumbItem` and `Icons`, and the `IStringLocalizer<SpeakerCreate>` from the template (`SpeakerCreate.razor:6`). The markup mounts the shared `UnsavedChangesGuard`, `SpeakerFormFields` and `ErrorSummary` components (`SpeakerCreate.razor:10,24,35`).
- **Concept introduced, the model-validated create page.** The create shape itself (validate, post, snackbar, redirect) is taught by the smaller create pages in this group. What this page adds is the bridge between DataAnnotations and MudBlazor.
  1. **One validation delegate for the whole form.** `OnInitialized` builds `_validate = ModelValidation.For(_model, new DataAnnotationsModelValidator(L))` (`:37`, field at `:50`) and the shared field block hands that single `Func<object, string, IEnumerable<string>>` to every control (`SpeakerCreate.razor:24-25`). MudBlazor calls it with the model instance and the member path, and the model's own attributes decide the outcome, so no rule is written twice (in-code comment, `:48-49`). The localizer passed into the validator is what turns the resource keys on [`SpeakerFormModel`](#speakerformmodel) into sentences, per [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html). `[Rubric §24, Forms, Validation & UX Safety]` and `[Rubric §27, Internationalization]`.
  2. **Validate before you mutate.** `CreateSpeakerAsync` awaits `_form.ValidateAsync()` and returns with a warning toast on `!_form.IsValid` (`:61-66`) before any service call. The server validates again; this pass keeps a round trip off the wire and puts the message beside the field.
  3. **A dirty flag that cannot block its own redirect.** Every field change calls `MarkDirty()` (`:52`, wired at `SpeakerCreate.razor:25`), the guard reads it through an accessor (`SpeakerCreate.razor:10`), and the success path clears `_isDirty` **before** navigating, with the reason on the line (`:78`). `[Rubric §25, Navigation & Information Architecture]`.
  4. **Cancel on disposal.** A page-scoped `CancellationTokenSource` (`:21`) is passed to the post (`:71`) and cancelled in the full `Dispose(bool)` pattern (`:96-116`); `OperationCanceledException` is caught and ignored as the expected teardown or InteractiveAuto transition outcome (`:82-85`, see [ADR-056](https://ivanball.github.io/docs/adr/056-blazor-render-mode-strategy.html)).
- **Walkthrough**
  - `OnInitialized` (`:26-38`): the three-crumb trail (Home, Speakers, Create) with the last crumb disabled, then the validation delegate.
  - `CreateSpeakerAsync` (`:54-90`): null-guard the form (`:56`), validate, set `IsSaving` (`:68`), post `_model.ToNew()` (`:71`), report a failed create as a localized snackbar (`:74`), then clear the dirty flag, snackbar success, and route to `ConferenceRoutePaths.SpeakerDetails(created.Id)` (`:80`) using the id read back from the response. The `finally` always clears `IsSaving` (`:86-89`), so a failed save leaves an enabled button rather than a stuck spinner.
  - `NavigateToList` (`:92`) is the cancel action, and it goes through the route constants rather than a literal.
- **Why it's built this way**: pushing the rules onto the shared model leaves the page holding only the things that are genuinely page-level, the breadcrumb trail, the save orchestration, and the navigation.
- **Where it's used**: the `/speakers/create` route with `[Authorize(Roles = "Organizer")]` (`SpeakerCreate.razor:1-2`), reached from [`SpeakerList`](#speakerlist)'s create button and redirecting to [`SpeakerDetail`](#speakerdetail).

---

### SpeakerCategoryItemsPanel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerCategoryItemsPanel.razor.cs:17` · Level 8 · class (Blazor code-behind)

- **What it is**: the "Additional Info" panel of the organizer speaker detail page. It renders a speaker's category items grouped by category as removable chips, and offers the not-yet-assigned items in an add picker.
- **Depends on**: [`ISpeakerCategoryItemUIService`](#ispeakercategoryitemuiservice) (`:18`), [`IToastService`](group-15-common-ui-framework.md#itoastservice) (`:19`), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) and [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto) (`:3,22,42`), [`CategoryItemInfo`](#categoryiteminfo) (`:25,52`), and the `CategoryItemIdentifierType`, `ConferenceCategoryIdentifierType` and `SpeakerCategoryItemIdentifierType` aliases.
- **Concept introduced, the container/presentational split with a partial ownership boundary.** The panel is presentational about **data** and self-sufficient about **actions**, and the class doc names the division exactly (`:9-15`).
  - The page owns and reloads the speaker, and owns both lookups; all three arrive as `[Parameter]`s (`:22,25,28`), and the panel never fetches them.
  - The panel calls the child-entity service itself (`:70`, `:91`) and then raises the `Changed` callback (`:31,79,99`), whose handler on the page is `LoadAsync` (`SpeakerDetail.razor:172`). So the mutation is local, but the refresh is the page's, and the page stays the single source of truth for what is on screen. `[Rubric §18, UI Architecture & Component Design]` (assesses decomposition and where responsibility sits) and `[Rubric §19, State Management & Data Flow]`.
  - It owns its own `CancellationTokenSource` (`:33`) and its own `IDisposable` implementation (`:107-129`), because it makes its own calls. A child component that awaits must cancel on its own disposal; inheriting the parent's token would tie its lifetime to the wrong component.
  The lookups are passed as `IReadOnlyDictionary` (`:25,28`) rather than lists, so both label helpers are O(1) and both fall back to the raw id when a lookup is missing (`:36-40`), which is the same never-render-blank rule the other detail pages follow. `[Rubric §24, Forms, Validation & UX Safety]`.
- **Walkthrough**
  - `GetCategoryTitle` / `GetCategoryItemName` (`:36-40`): dictionary lookups with an invariant-culture id fallback.
  - `GetCategoryItemsGroupedByCategory` (`:42-50`): returns empty until the lookup arrives, then filters the speaker's items to those the lookup knows and groups them by their category id, which is what produces the per-category chip rows (`SpeakerCategoryItemsPanel.razor:8-20`).
  - `GetAvailableCategoryItems` (`:52-59`): builds a `HashSet` of the already-assigned item ids and offers the complement, so the picker cannot propose a duplicate.
  - `AddCategoryItemAsync` (`:61-85`): no-ops without a selection (`:63-66`), calls `AddAsync(Speaker.Id, id, token)` (`:70`), reports failure through a localized error toast and returns (`:71-75`), otherwise clears the selection, toasts success, and awaits `Changed` (`:77-79`).
  - `RemoveCategoryItemAsync` (`:87-105`): the same shape over `DeleteAsync`, bound to each chip's `OnClose` (`SpeakerCategoryItemsPanel.razor:15`).
  - Both handlers swallow `OperationCanceledException` as expected disposal (`:81-84`, `:101-104`).
- **Why it's built this way**: the chip panel was extracted from the detail page so that page holds only its own edit and link state. Keeping the add/remove calls inside the panel while leaving the reload to the parent preserves the pre-split behavior exactly (class doc, `:13-15`) without giving the child a second copy of the speaker.
- **Where it's used**: rendered once by [`SpeakerDetail`](#speakerdetail) (`SpeakerDetail.razor:169-172`), fed `Speaker`, `_lookups?.CategoryItems` and `_lookups?.CategoryTitles`, with `Changed` bound straight to the page's `LoadAsync`. It is not routable and carries no `@page` directive.

---

### SpeakerDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerDetail.razor.cs:24` · Level 8 · class (Blazor code-behind)

- **What it is**: the organizer's speaker console. It loads one speaker with children by route id, inline-edits the profile, shows the answered questions and the speaker's sessions, hosts the category-item panel, links or unlinks a login, and deletes with confirmation.
- **Depends on**: [`ISpeakerUIService`](#ispeakeruiservice), [`ISessionUIService`](#isessionuiservice), [`ISpeakerDetailLookupService`](#ispeakerdetaillookupservice) returning [`SpeakerDetailLookups`](#speakerdetaillookups), and [`IUserUIService`](group-24-identity-module.md#iuseruiservice) (`:27-30`); [`IToastService`](group-15-common-ui-framework.md#itoastservice) (`:32`); [`SpeakerEditModel`](#speakereditmodel) (`:72`), [`SpeakerUserSearch`](#speakerusersearch) (`:291`), [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) and [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator) (`:54`), [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (`:115,224`), and [`ConferenceRoutePaths`](#conferenceroutepaths) (`:49,343,345`). It extends [`DetailPageBase`](#detailpagebase) (`SpeakerDetail.razor:8`), which supplies `PageToken`, `IsEditing`, `IsDirty`, `MarkDirty`, `BeginEdit`, `EndEdit` and the disposal pattern. Externals: MudBlazor's `MudForm`, `MudAutocomplete` and `BreadcrumbItem`, plus the `IStringLocalizer<SpeakerDetail>` from the template.
- **Concept introduced, the load-generation guard.** Every detail page in this group guards against a re-render refetching (`OnParametersSetAsync` compares `Id` against `_loadedId`, `:84-93`). This page carries a second, stronger guard that is worth reading closely.
  `_loadGeneration` (`:65`) is incremented at the top of `LoadAsync` (`:98`) and each awaited step re-checks its captured `generation` before touching page state (`:107`, `:132`, `:184`). The doc comment states the reason precisely (`:59-64`): `_loadedId` is stamped synchronously *before* the await, so two rapid route changes would let a later-completing fetch of the older speaker paint over the newer one. The generation, not the route id, is authoritative. The `finally` applies the same rule to the spinner (`:151-156`): only the current generation may clear `IsLoading`, because an unconditional clear would switch off a spinner that a newer load just turned on. `[Rubric §19, State Management & Data Flow]` (assesses reconciliation of concurrent updates to view state) and `[Rubric §12, Performance & Scalability]` (the cheap fix is to serialize the loads, which would be slower and still wrong).
  Two further mechanisms sit alongside it.
  1. **Server-side filtering instead of client-side filtering.** `LoadSpeakerSessionsAsync` (`:168-196`) sends a `SpeakerId` equals filter (`:170-173`) with `includeChildren: false` (`:181`) and `sortColumn: "StartsAt"` (`:179`), capped at `MaxSpeakerSessions = 100` (`:37`). The remark records what it replaced (`:163-167`): the page used to pull the entire session catalog with all child collections and filter it in memory on `SessionSpeakers`, purely so it could match. `[Rubric §12, Performance & Scalability]` (assesses whether work happens where the data lives).
  2. **One composite lookup, cached for the page.** The three display lookups arrive in a single `LookupService.GetAllAsync(PageToken)` call, and only when `_lookups is null` (`:129-141`), so re-entering `LoadAsync` after a link or unlink does not refetch them. A failed lookup is reported and stops the load (`:137-140`). `[Rubric §23, Front-End Performance & Rendering]`.
  Result handling is uniform: `IsNotFound()` gets a dedicated not-found message and a null record (`:112-117`), and every other failure goes through `NotifyOnFailure(Toast, L)` (`:121,191,234,241,276`), which is the framework's one-line "report whatever went wrong, localized" path.
- **Walkthrough**
  - `OnInitialized` (`:43-55`): breadcrumbs plus the shared validation delegate over `_model` (`:54`).
  - `OnParametersSetAsync` (`:84-93`) then `LoadAsync` (`:95-158`): parse the route id defensively (`:105`; the comment at `:103-104` notes an unconstrained `string` route parameter degrades to `Guid.Empty` and resolves to not-found rather than throwing out of the render), fetch with children (`:106`), fetch the lookups once (`:129-141`), then the sessions (`:143`).
  - Edit cycle: `StartEditing` (`:201-210`) seeds [`SpeakerEditModel`](#speakereditmodel) from the loaded record and calls the base's `BeginEdit()`; `CancelEditing` (`:212`) is one call to `EndEdit()`, which clears the dirty flag the unsaved-changes guard reads (`SpeakerDetail.razor:13`). `SaveChangesAsync` (`:214-257`) validates the form, posts `_model.ToUpdated(Speaker)` (`:231`), then **re-fetches** the speaker (`:238`) so the page shows the server's version, including the new `RowVersion` for the next edit.
  - `DeleteSpeakerAsync` (`:259-287`): confirms through the shared `DeleteConfirmation` dialog seeded with the speaker's full name (`:266`), and treats anything other than exactly `true` as a cancel, so a dismissed dialog is not a delete.
  - Link and unlink (`:289-341`): `SearchUsersAsync` delegates to [`SpeakerUserSearch`](#speakerusersearch) (`:291`); `OnUserPickedAsync` (`:293-316`) posts `LinkUserAsync` and reloads; `UnlinkUserAsync` (`:318-341`) is the mirror. Both reload through `LoadAsync` rather than patching local state, which is exactly why the generation guard matters: a link followed quickly by an unlink starts two loads.
  - `GetQuestionText` (`:198-199`) resolves an answered question's text from the cached lookups with an id fallback.
- **Why it's built this way**: this page is the widest read surface in the organizer area, so it composes four services rather than growing one. Delegating the chip panel to [`SpeakerCategoryItemsPanel`](#speakercategoryitemspanel), the candidate search to [`SpeakerUserSearch`](#speakerusersearch), the field rules to [`SpeakerFormModel`](#speakerformmodel), and the edit lifecycle to [`DetailPageBase`](#detailpagebase) is what keeps the code-behind at load, save, delete and link. `[Rubric §15, Best Practices & Code Quality]`.
- **Where it's used**: the `/speakers/{Id}` route with a bare `[Authorize]` (`SpeakerDetail.razor:1-2`), reached from [`SpeakerList`](#speakerlist) rows and from [`SpeakerCreate`](#speakercreate)'s success redirect. Session rows navigate on to [`SessionDetail`](#sessiondetail) (`:345`). It edits the aggregate the [`Speaker`](group-17-conference-domain.md#speaker) entity models.

---

### ActivityCreate

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Activities` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activities/ActivityCreate.razor.cs:19` · Level 9 · class (Blazor code-behind)

- **What it is**: the organizer form that schedules an activity, meaning the non-session items on a programme (registration, breaks, receptions, after-parties). It collects the name, the owning event, the start and end of the window as separate date and time pickers, the display order, and an optional off-site venue (class doc, `:12-17`).
- **Depends on**: [`IActivityUIService`](#iactivityuiservice) (`:20`), [`IEventLookupService`](#ieventlookupservice) returning [`EventInfo`](#eventinfo) (`:21,78`), [`IToastService`](group-15-common-ui-framework.md#itoastservice) (`:23`), [`ActivityCreateModel`](#activitycreatemodel) (`:81`), [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (`:61`), [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) with [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator) (`:41`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:36,182,194`), and [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (`:160,166`). Externals: `NavigationManager`, MudBlazor's `MudForm` and `BreadcrumbItem`, and the `IStringLocalizer<ActivityCreate>` from the template (`ActivityCreate.razor:6`).
- **Concept introduced, the cross-field rule that lives outside the form.** Every other rule on this page is declared on [`ActivityFormModel`](#activityformmodel) and executed by MudBlazor through the shared `_validate` delegate. The schedule window cannot be: no DataAnnotation states "end after start" across four controls. `ValidateSchedule` (`:126-148`) therefore checks the model's own `HasStart` / `HasEnd` / `StartsAt` / `EndsAt` and puts its message in `_scheduleError` (`:130,136,142`) instead of the form's error list, and the markup renders that string in its own `MudAlert` above the shared error summary (`ActivityCreate.razor:30-33`, summary at `:41`). A cross-field failure therefore reads like every other validation error to the organizer even though `MudForm` knows nothing about it. `[Rubric §24, Forms, Validation & UX Safety]` (assesses whether a form can express only legal input and explains a rejection in place): the check runs before anything is posted (`:164`) and the snackbar quotes the specific message rather than a generic one (`:166`).
  The second idea is the **two-stage smart default**, which removes the two most common clicks without hiding either field.
  1. The event picker is seeded with [`CurrentEventSelector.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventselector) evaluated over each event's start date, end date and IANA time zone against `DateTime.UtcNow` (`:59-66`), rather than the weaker "auto-select when exactly one exists" rule.
  2. `ApplyEventDateDefaults` (`:109-119`) then seeds **both** date pickers with the selected event's first day (`:116-118`), and re-runs on every event change through `OnEventSelected` (`:99-103`). Both stages use `??=` (`:59`, `:117-118`), so a value the organizer already chose is never overwritten. `[Rubric §24, Forms, Validation & UX Safety]`.
  The event lookup is explicitly non-critical (comment, `:50-51`): a failed load leaves the picker empty and the required-event check at `:158` guides the user, rather than blocking the page. `[Rubric §29, Resilience & Business Continuity]`.
- **Walkthrough**
  - `OnInitialized` (`:30-42`): three breadcrumbs, then the validation delegate over `_model`.
  - `OnInitializedAsync` (`:44-74`): loads the events through the page `_cts.Token` (`:52`), resolves the default event, applies the date defaults (`:68`), and swallows `OperationCanceledException` as the expected disposal or InteractiveAuto transition outcome (`:70-73`, [ADR-056](https://ivanball.github.io/docs/adr/056-blazor-render-mode-strategy.html)).
  - `CreateActivityAsync` (`:150-192`): validate the form and re-check `_eventId is null` (`:157-162`), run `ValidateSchedule` (`:164`), post `_model.ToNew(_eventId.Value)` (`:173`), clear `_isDirty` before navigating (`:180`), and route to `ConferenceRoutePaths.ActivityDetails(createdActivity.Id)` (`:182`) using the key the server assigned. The `finally` always clears `IsSaving` (`:188-191`).
  - `NavigateToList` (`:194`) and the standard `Dispose(bool)` / `Dispose` pair (`:196-218`), guarded by `_disposed` so the `_cts` is cancelled and disposed exactly once.
- **Why it's built this way**: an activity belongs to exactly one event and its schedule is a window rather than a point, so the form's job is to make the window easy to enter and impossible to invert. Defaulting the event and both dates from the selected conference removes the routine clicks, and keeping the window check in the code-behind lets one message name the actual problem (a missing part versus an inverted window) instead of a generic "invalid form".
- **Where it's used**: the `/activities/create` route with `[Authorize(Roles = "Organizer")]` (`ActivityCreate.razor:1-2`), reached from [`ActivityList`](#activitylist)'s create button; on success it hands off to [`ActivityDetail`](#activitydetail).
- **Caveats / not-in-source**: `StartsAt` and `EndsAt` compose local `DateTime` values from the pickers with no time-zone conversion, even though the event's `TimeZone` is available on [`EventInfo`](#eventinfo) and is used for the default-event choice. How the posted `StartTime` and `EndTime` are interpreted downstream is decided by the command handler, not by this page.

---

### ActivityDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Activities` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activities/ActivityDetail.razor.cs:20` · Level 9 · class (Blazor code-behind)

- **What it is**: the organizer's activity record page. It loads one activity by route id, inline-edits every field except the owning event, and deletes with confirmation (class doc, `:14-18`).
- **Depends on**: [`IActivityUIService`](#iactivityuiservice) (`:23`), [`IEventLookupService`](#ieventlookupservice) returning [`EventInfo`](#eventinfo) (`:24,65`), [`IToastService`](group-15-common-ui-framework.md#itoastservice) (`:26`), [`ActivityEditModel`](#activityeditmodel) (`:73`), [`ActivityDTO`](group-17-conference-domain.md#activitydto) (`:66`), [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) with [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator) (`:61`), [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (`:106,195,201`), and [`ConferenceRoutePaths`](#conferenceroutepaths) (`:56,277`), plus the shared `DeleteConfirmation` component (`:78`). Externals: `System.Globalization`, MudBlazor's `MudForm`, and the `IStringLocalizer<ActivityDetail>` from the template.
- **Concept introduced, culture-formatted display and the field that is deliberately not editable.** The detail-page mechanics are the ones [`SpeakerDetail`](#speakerdetail) teaches (load-once guard on `_loadedId`, `:86-95`; edit buffer; confirm-then-delete; cancel-on-disposal). Note that this page manages its own `CancellationTokenSource` and `_isEditing` flag (`:30,70`) rather than extending [`DetailPageBase`](#detailpagebase), which is the shape [`SpeakerDetail`](#speakerdetail) uses. Two things are specific here.
  1. **Two computed display properties.** `EventName` (`:35-39`) resolves the activity's `EventId` against the lookup and falls back to the invariant-culture id, so the read-only event line never renders blank. `TimeRange` (`:41-48`) formats the window as one localized sentence by passing the start (`"f"`, full date and time) and the end (`"t"`, short time) rendered in `CultureInfo.CurrentCulture` into the `Text.TimeRange` resource; the joining wording lives in the `.resx`, not in the code, so a locale can reorder or reword the range. `[Rubric §27, Internationalization]` (assesses whether user-visible text and formats follow the request culture, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
  2. **The immutable field on an editable record.** [`ActivityEditModel`](#activityeditmodel) has no event property and re-sends `EventId` from the loaded record, so this form cannot even express a move between events, which is the rule the class doc states (`:15-17`). `[Rubric §24, Forms, Validation & UX Safety]`.
  The window check reappears here as `ValidateSchedule` (`:161-183`) with the same three localized keys as [`ActivityCreate`](#activitycreate), so the create and edit paths validate a window identically. They are two copies of the same small method rather than one shared helper, which is the maintenance cost of keeping each page self-contained. `[Rubric §15, Best Practices & Code Quality]`.
- **Walkthrough**
  - `OnInitialized` (`:50-62`): breadcrumbs plus the validation delegate.
  - `OnParametersSetAsync` (`:86-95`) then `LoadAsync` (`:97-134`): fetch with children (`:102`), treat `IsNotFound()` as the page's not-found state with a localized message (`:103-108`), report any other failure through `NotifyOnFailure` (`:112`), then hydrate the event lookup once (`:120-124`) with the comment noting that a failed lookup is reported and stops the load exactly as it did when the same failure arrived as an exception (`:118-119`). The `finally` clears `IsLoading` (`:132`).
  - `StartEditing` / `CancelEditing` (`:136-154`): seed the edit model from the record, clear `_scheduleError` and `_isDirty` on both paths, so neither a stale cross-field error nor the unsaved-changes guard can fire after a cancel.
  - `SaveChangesAsync` (`:185-244`): validate the form, run `ValidateSchedule`, post `_model.ToUpdated(Activity)` (`:208`), then re-fetch (`:215`). The reload has three outcomes, and all three are handled: a value refreshes the page (`:216-219`), a `IsNotFound()` drops the page into its not-found state (`:220-225`, with the comment recording that this matches the previous null answer), and anything else reports and returns (`:226-230`).
  - `DeleteActivityAsync` (`:246-275`): confirm through `_deleteConfirm.ShowAsync(Activity.Name)` (`:253`), return unless the answer is exactly `true` (`:254`), delete, toast, and navigate back to the list.
  - Disposal (`:279-301`): the standard guarded `Dispose(bool)` pair over the `_cts` at `:30`.
- **Why it's built this way**: an activity is a per-event programme item, so its name, window, order and venue are freely editable while its owning event is not. The re-fetch after save keeps the concurrency token current for the next edit, and handling the reload's not-found branch means a record deleted by someone else mid-edit resolves to the same empty state the page shows on a bad id.
- **Where it's used**: the `/activities/{Id:int}` route with `[Authorize(Roles = "Organizer")]` (`ActivityDetail.razor:1-2`), reached from [`ActivityList`](#activitylist) rows and from [`ActivityCreate`](#activitycreate)'s success redirect. It edits the aggregate the [`Activity`](group-17-conference-domain.md#activity) entity models.

---

### SpeakerDashboard

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerDashboard.razor.cs:22` · Level 9 · class (Blazor code-behind)

- **What it is**: the signed-in speaker's own console. It shows their profile with an inline editor, the sessions they present at the current or next event, the bookmark count per session, and their per-session feedback on demand (class doc, `:13-19`).
- **Depends on**: [`ISpeakerUIService`](#ispeakeruiservice) (`:23`), [`ISpeakerDashboardUIService`](#ispeakerdashboarduiservice) (`:24`), [`IEventLookupService`](#ieventlookupservice) (`:25`), `AuthenticationStateProvider` (`:26`), [`IToastService`](group-15-common-ui-framework.md#itoastservice) (`:27`), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto) (`:38-42`), [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) with [`EventInfo`](#eventinfo) (`:169`), and the `IStringLocalizer<SpeakerDashboard>` from the template.
- **Concept introduced, the claim-scoped self-service page.** Three mechanisms distinguish this from the organizer pages in this unit.
  1. **Identity comes from the token, not the route.** There is no `[Parameter]` id: the speaker is read from the `speaker_id` claim (`:76-86`), and a missing or unparseable claim sets `_hasSpeakerId = false` (`:81`) and renders one informational alert (`SpeakerDashboard.razor:19-21`). The server enforces the same scope; the claim just decides what this page asks for. `[Rubric §11, Security]` (assesses that a self-service view derives its subject from the authenticated principal, [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)) and `[Rubric §26, Front-End Security]`.
  2. **Skip the loads on the prerender pass.** `OnInitializedAsync` returns immediately when `!RendererInfo.IsInteractive` (`:68-71`), with the comment recording exactly what that saves: the profile, the sessions and the per-session bookmark counts used to run twice per visit, once for SSR prerender and once for the interactive instance (`:65-67`). The prerender pass shows the loading skeleton instead. `[Rubric §23, Front-End Performance & Rendering]` and [ADR-056](https://ivanball.github.io/docs/adr/056-blazor-render-mode-strategy.html).
  3. **One batched count call.** `GetSessionBookmarkCountsAsync(_speakerId, sessionIds, ...)` (`:136`) returns every count from one grouped query; the comment records that each count was previously its own cross-service hop, HTTP to Conference to gRPC to Engagement (`:129-131`). The result is best effort: a failure is ignored with no snackbar so the dashboard still renders (`:134-135`). `[Rubric §12, Performance & Scalability]` and `[Rubric §29, Resilience & Business Continuity]`.
  The read scope is worth stating explicitly, because the class doc does (`:16-19`): a speaker is not a privileged reader, so the server returns only publicly visible sessions (accepted-or-unset), which means a submission still under review does not appear here. The empty-state copy names that. `[Rubric §11, Security]`.
  Reads go through [`ISpeakerDashboardUIService`](#ispeakerdashboarduiservice) rather than the shared sessions service on purpose: the comment at `:104-106` records that the dashboard path bypasses the shared sessions output cache, so a just-made speaker assignment shows immediately instead of lagging behind a cached public list.
- **Walkthrough**
  - State (`:36-55`): the claim flag and id, the full session list and the event-narrowed one, the current event name, and four collections keyed by session id, `_bookmarkCounts`, `_sessionFeedback`, `_expandedSessions` and `_feedbackLoading`, plus the profile edit fields.
  - `OnInitializedAsync` (`:57-159`): breadcrumbs, the interactivity gate, the claim read, the profile load (a not-found renders the empty dashboard without a toast, `:92-99`), the session load ordered by `StartsAt` (`:114`), the current-event narrowing (`:116-127`), and the batched counts. The outer `catch (Exception)` (`:149-154`) is explained in place: the authentication state provider is the one collaborator that still reports failure by throwing, while everything else returns a [`Result`](group-01-result-error-handling.md#result).
  - `ResolveCurrentEventAsync` (`:161-175`): non-critical by design (comment, `:163`), it returns null on a failed lookup and the page then shows all of the speaker's sessions rather than none.
  - Profile edit (`:177-249`): `StartEditingProfile` copies six fields into `_edit*` shadow fields (`:184-189`); `SaveProfileAsync` rebuilds a full [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) carrying `RowVersion` (`:208`) and every field the speaker may not edit re-sent unchanged (`:209-211,214-215,220`), posts, re-fetches (`:230`) and leaves edit mode.
  - `ToggleFeedbackAsync` (`:251-289`): the `HashSet.Add` return value doubles as the toggle (`:253-257`), an already-cached session returns immediately (`:259-262`), and the fetch sets a per-session loading flag with an explicit `StateHasChanged()` (`:264-265`) because the spinner has to appear before the await. A not-found is treated as "no feedback captured yet" and left to the panel's empty state rather than reported (`:274-279`). `[Rubric §23, Front-End Performance & Rendering]`: feedback is fetched per session on first expand, never for the whole list.
- **Why it's built this way**: the dashboard is the one page a speaker sees on conference day, so it favors rendering something useful over rendering everything: a failed count load, a failed event lookup, or missing feedback each degrade to a smaller view rather than an error page.
- **Where it's used**: the `/speaker/dashboard` route with a bare `[Authorize]` (`SpeakerDashboard.razor:1-2`); the claim, not the role, decides what it can show. It reads the same aggregate [`SpeakerDetail`](#speakerdetail) edits.
- **Caveats / not-in-source**: the profile editor here does **not** use [`SpeakerFormModel`](#speakerformmodel). It binds six loose `_edit*` fields (`:49-54`) and its caps come from `SpeakerDTO` constants applied as MudBlazor `MaxLength` / `Counter` affordances in markup (`SpeakerDashboard.razor:42-55`), so it has no DataAnnotations pass and its `MudForm` (`:55`) is never validated in the code-behind. The organizer create and edit forms share their rules; this third editing surface does not.

---

### ActivityList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Activities` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Activities/ActivityList.razor.cs:20` · Level 10 · class (Blazor code-behind)

- **What it is**: the organizer browse page for activities: a server-paged `MudDataGrid` with a name search, start-time, venue and display-order columns, an event filter, a mobile card layout, and delete-with-confirmation.
- **Depends on**: extends [`EventFilteredListPageBase<TDto>`](#eventfilteredlistpagebasetdto) closed over [`ActivityDTO`](group-17-conference-domain.md#activitydto) (`:19`), which itself extends [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) and supplies `Toast`, `IsMobile`, `LoadServerDataAsync`, the event lookup and the persisted event filter. It injects [`IActivityUIService`](#iactivityuiservice) (`:24`) and uses [`ListPageActions`](group-15-common-ui-framework.md#listpageactions) (`:46,92`), [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (`:98`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:101-102`), the [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) and `DeleteConfirmation` components (`:32-33`), and [`Result<T>`](group-01-result-error-handling.md#result) as the mobile fetch's return type (`:77`).
- **Concept introduced, the event-filtered list page as a thin override set.** Once the base class owns the event lookup, the persisted `eventId` filter and the current-or-next default, a list page is reduced to five small overrides, and this page is the clearest place to read them.
  - `SavePageFilters` / `RestorePageFilters` (`:39-43`) persist only the page's **own** filter, the search string; the event choice is the base's business.
  - `ReloadForEventFilterAsync` (`:48`) tells the base how to refresh this page, which here means "reload whichever layout is on screen".
  - `ApplyFilters` (`:69-74`) adds the search term as a `contains` filter on `Name` and then calls the base's `ApplyEventFilter` (`:73`), which adds `EventId` equals when a scope is selected (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Common/EventFilteredListPageBase.cs:193-198`). For activities that key needs no special handling: `EventId` is a real Activity column, so it travels straight through the generic filter pipeline (class doc, `:14-16`). Contrast [`SpeakerList`](#speakerlist).
  - `GridRef` (`:28`) hands the base the grid instance it needs to reload.
  `[Rubric §15, Best Practices & Code Quality]` (assesses whether shared behavior is factored rather than repeated) and `[Rubric §1, SOLID]`: the base defines the algorithm, the page supplies the varying steps.
  The **startup race** the base solves is still visible in the page: both fetch paths await `WaitForEventsAsync()` first (`:60`, `:79`), because the grid's first `ServerData` call can run ahead of initialization and `ApplyFilters` executes inside the base's `LoadServerDataAsync` (in-code comment, `:58-59`). Miss that await and the first page loads unscoped.
  What is specific to activities is the **mobile sort**: `FetchMobilePage` pins `"StartTime", "asc"` (`:85`) because, as the comment says, the programme reads chronologically (`:84`), while the desktop grid lets the organizer re-sort any sortable column. The two layouts share filters and a data contract but not ordering. `[Rubric §22, Responsive & Cross-Browser]`: one DTO feeds the desktop grid and the mobile infinite-scroll list, switched on the base's `IsMobile`. `[Rubric §12, Performance & Scalability]`: paging, searching, sorting and filtering all happen server-side.
- **Walkthrough**
  - `FormatStartTime` (`:37`): the grid's start-time cell rendered in the viewer's culture (`"g"`, short date plus short time). `[Rubric §27, Internationalization]`.
  - `RetryLoadAsync` (`:31`): the inline error state's retry, a null-safe `ReloadServerData()`.
  - `OnSearchChanged` (`:50-54`): store the term, reload the active layout.
  - `LoadServerData` (`:56-67`): wait for events, then hand the base the fetch delegate and `ApplyFilters`.
  - `FetchMobilePage` (`:77-86`): the same filters against the mobile page size, with the chronological sort pinned.
  - `DeleteActivityAsync` (`:91-99`): delegates the whole confirm, delete, toast and reload sequence to [`ListPageActions`](group-15-common-ui-framework.md#listpageactions), passing the shared dialog, the activity name, the delete call, the success message and the reload.
  - `NavigateToCreate` / `NavigateToDetails` (`:101-102`): route constants, never literals. `[Rubric §25, Navigation & Information Architecture]`.
- **Why it's built this way**: an organizer works one conference at a time, so scoping to an event is the default rather than an option, and the base class makes that scoping identical on every list page in the module.
- **Where it's used**: the `/activities` route with `[Authorize(Roles = "Organizer")]` (`ActivityList.razor:1-2`), linking on to [`ActivityCreate`](#activitycreate) and [`ActivityDetail`](#activitydetail).

---

### SpeakerList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerList.razor.cs:19` · Level 10 · class (Blazor code-behind)

- **What it is**: the organizer browse page for speakers: server-side paging with a full-name search and avatars, an event filter, a mobile card layout, and delete-with-confirmation.
- **Depends on**: extends [`EventFilteredListPageBase<TDto>`](#eventfilteredlistpagebasetdto) closed over [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) (`:18`), and injects [`ISpeakerUIService`](#ispeakeruiservice) (`:23`). It uses [`ListPageActions`](group-15-common-ui-framework.md#listpageactions) (`:42,86`), [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (`:92`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:95-96`), the [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) and `DeleteConfirmation` components (`:31-32`), and [`Result<T>`](group-01-result-error-handling.md#result) (`:73`).
- **Concept introduced, the virtual filter key.** Structurally this is [`ActivityList`](#activitylist): the same five overrides over the same base, the same `WaitForEventsAsync` guard before both fetches (`:56`, `:75`), the same delegation of delete to [`ListPageActions`](group-15-common-ui-framework.md#listpageactions). One thing genuinely differs, and it is the interesting part.
  `ApplyEventFilter` (`:69`) adds `filters["EventId"]` exactly as it does for activities, but a `Speaker` has **no** `EventId` column: a speaker relates to an event through the EventSpeaker and SessionSpeaker joins. So `EventId` here is a *virtual* filter key. The paged speakers endpoint intercepts it, removes it from the filter dictionary before the generic filter pipeline ever sees it, and resolves the scope through those joins instead (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Speakers/SpeakersController.cs:120-122,152-159`). The client-side contract is therefore identical for both entities while the server-side resolution is not. `[Rubric §9, API & Contract Design]` (assesses whether a query contract can express a client's intent without leaking the storage shape) and `[Rubric §8, Data Architecture]`: the join stays server-side, where the indexes are, instead of becoming a two-step client fetch.
  The class doc records this in one sentence at the top of the page (`:13-16`), which matters: a reader who assumes `EventId` is a column would look for it on the DTO and find nothing.
- **Walkthrough**
  - `SavePageFilters` / `RestorePageFilters` (`:35-39`): persist and restore the search term only.
  - `ReloadActiveLayoutAsync` (`:41-42`) and `ReloadForEventFilterAsync` (`:44`): one reload path for both layouts, via [`ListPageActions`](group-15-common-ui-framework.md#listpageactions).
  - `LoadServerData` (`:52-63`) and `ApplyFilters` (`:65-70`): the search term as a `contains` filter on `FullName` (`:68`), the denormalized display name, then the event filter.
  - `FetchMobilePage` (`:73-80`): the same filters sorted `"FullName", "asc"` (`:79`), because a speaker roster reads alphabetically where a programme reads chronologically (compare [`ActivityList`](#activitylist)).
  - `DeleteSpeakerAsync` (`:85-93`): confirm, delete, toast, reload, all through the shared helper, seeded with the speaker's full name.
  - `RetryLoadAsync` (`:30`) backs the inline error state; `NavigateToCreate` / `NavigateToDetails` (`:95-96`) use the route constants.
- **Why it's built this way**: the organizer wants "the speakers at this conference", not "the speakers whose row carries this id". Expressing that as an ordinary filter key keeps the page identical to every other event-filtered list, and the one place that knows it is not an ordinary column is the endpoint that can resolve it cheaply.
- **Where it's used**: the `/speakers` route with `[Authorize(Roles = "Organizer")]` (`SpeakerList.razor:1-2`), linking on to [`SpeakerCreate`](#speakercreate) and [`SpeakerDetail`](#speakerdetail). Its public counterpart is `PublicSpeakerList`, which applies the same virtual key with a locked scope.

### ConferenceCategoryItemEditModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Categories/ConferenceCategoryItemEditModel.cs:19` · Level 2 · class (sealed form model)

- **What it is**: the one-field form model behind the inline "add category item" form that
  [`ConferenceCategoryItemsPanel`](#conferencecategoryitemspanel) hosts. It carries a single `Name`
  property and the rules that property must satisfy.
- **Depends on**: [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto) for the length cap
  (`.../Pages/ConferenceCategory/ConferenceCategoryItemEditModel.cs:2,30`); `System.ComponentModel.DataAnnotations`.
  It is consumed through [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) and
  [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator).
- **Concept introduced, the page form model as the single declaration of a form's rules.** Every editable
  surface in this unit follows the same three-part arrangement, and this is the smallest instance of it,
  so it is the clearest place to read the mechanism.
  1. **The rules live on a plain C# model, as DataAnnotations.** `[Required(ErrorMessage = NameRequiredKey)]`
     and `[MaxLength(CategoryItemDTO.NameMaxLength, ErrorMessage = "Validation.NameMaxLength")]` sit on the
     `Name` property (lines 29-31). The cap is not a literal: it reads `CategoryItemDTO.NameMaxLength`,
     which is `500` and is declared once on the DTO
     (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Categories/CategoryItemDTO.cs:16`),
     so the client cap and the contract cap cannot drift.
  2. **The markup bridges to those rules instead of restating them.** The panel builds one delegate with
     `ModelValidation.For(_model, new DataAnnotationsModelValidator(L))`
     (`.../Pages/ConferenceCategory/ConferenceCategoryItemsPanel.razor.cs:57`) and hands it to the field's
     `Validation` parameter (`.../Pages/ConferenceCategory/ConferenceCategoryItemsPanel.razor:30`).
     MudBlazor invokes that delegate with `(model, member path)` and the model's own annotations decide the
     outcome (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Validation/ModelValidation.cs:43-49`), so one
     delegate serves every field on the form and no rule is written twice.
  3. **Every `ErrorMessage` is a resource key, not a sentence.** `NameRequiredKey` is the constant
     `"Validation.NameRequired"` (line 26), and the localizing validator resolves the key at render time
     ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). The constant exists so the
     model's `[Required]` rule and the field's `RequiredError` affordance quote the *same* key rather than
     two copies of one string literal (lines 21-25).
  `[Rubric §24, Forms, Validation & UX Safety]` (assesses whether a form's rules are declared once and
  enforced before submit): the annotation is the only declaration, and the field renders its asterisk and
  message from it. `[Rubric §15, Best Practices & Code Quality]` (assesses whether a change has one landing site):
  raising the item-name cap is a one-line DTO edit that the model, the input's `MaxLength`, and the
  character counter all inherit. `[Rubric §27, Internationalization]`: the message is a key, so the wording
  is a resource concern rather than a code concern.
- **Walkthrough**
  - `NameRequiredKey` (line 26): the shared resource key described above.
  - `Name` (line 31): `string` initialized to `string.Empty`, so a fresh model binds cleanly to a text
    field, carrying the required and max-length rules (lines 29-30).
- **Why it's built this way**: there is no standalone item-creation page to mirror, so unlike its siblings
  this model has no abstract base and no `ToNew` (the doc comment says so explicitly, lines 6-18). The
  panel builds the [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto) itself. The sort
  order is a plain numeric field with nothing to validate, so it stays on the panel rather than joining
  the model.
- **Where it's used**: held as the private `_model` of
  [`ConferenceCategoryItemsPanel`](#conferencecategoryitemspanel)
  (`.../Pages/ConferenceCategory/ConferenceCategoryItemsPanel.razor.cs:36`), reset on every "add item"
  click (line 62) and read when the new item is posted (line 87).

### QuestionFormModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Questions/QuestionFormModel.cs:24` · Level 2 · class (abstract base form model)

- **What it is**: the editable question fields that the create page and the detail page's inline editor
  have in common: the question text with its rules, the display order, and the required flag. It is
  abstract, and the two concrete models derive from it.
- **Depends on**: [`QuestionDTO`](group-17-conference-domain.md#questiondto) for the text cap (lines 2,35);
  `System.ComponentModel.DataAnnotations`. Its subclasses are
  [`QuestionCreateModel`](#questioncreatemodel) and [`QuestionEditModel`](#questioneditmodel).
- **Concept introduced, one shared model as the anti-drift device between a create form and an edit
  form.** The form-model mechanism itself is introduced on
  [`ConferenceCategoryItemEditModel`](#conferencecategoryitemeditmodel); what this type adds is the
  abstract base. Two pages edit a question: `/questions/create` and the inline editor on
  `/questions/{Id}`. Both bind the *same* `QuestionFormFields` component
  (`.../Pages/Question/QuestionCreate.razor:23`, `.../Pages/Question/QuestionDetail.razor:31`), and that
  component's `Model` parameter is typed as `QuestionFormModel`
  (`.../Pages/Question/QuestionFormFields.razor:42`). The consequence is structural rather than
  conventional: a question text the create page accepts is a question text the detail page accepts,
  because there is exactly one `[MaxLength]` and one `[Required]` in the codebase for that field, and
  neither page can add a rule the other lacks.
  `[Rubric §24, Forms, Validation & UX Safety]`: a create form and an edit form that disagree on a rule is
  a classic source of "it saved yesterday and will not save today"; the shared base removes the
  possibility. `[Rubric §1, SOLID]` (assesses whether shared behavior is factored to one owner): the base
  holds what is common, the subclasses hold only what differs (what a post looks like).
  `[Rubric §15, Best Practices & Code Quality]`: `QuestionDTO.QuestionTextMaxLength` is `1000`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Questions/QuestionDTO.cs:17`) and is
  referenced, never copied.
- **Walkthrough**
  - `QuestionTextRequiredKey` (line 31): the resource key `"Validation.QuestionTextRequired"`, quoted both
    by the model's `[Required]` (line 34) and by the field's `RequiredError`
    (`.../Pages/Question/QuestionFormFields.razor:17`).
  - `QuestionText` (line 36): required, capped at `QuestionDTO.QuestionTextMaxLength` (line 35), rendered
    as a two-line text field whose `Counter` reads the same constant
    (`.../Pages/Question/QuestionFormFields.razor:18-19`).
  - `Sort` (line 39) and `IsRequired` (line 42): plain properties. The doc comment records why they live
    here at all (lines 18-22): DataAnnotations cannot express either rule, but keeping them on the model
    lets one object carry the whole form instead of a parallel set of loose page fields.
- **Why it's built this way**: the alternative (each page owning its own fields plus its own copy of the
  rules) is how the Conference pages were written before the shared field block existed, and it makes every
  rule change a two-file edit with no compiler help. Abstract rather than concrete because there is no
  scenario that binds "just the shared part": every use is a create or an edit.
- **Where it's used**: as the base of [`QuestionCreateModel`](#questioncreatemodel) and
  [`QuestionEditModel`](#questioneditmodel), and as the declared parameter type of the shared
  `QuestionFormFields` component (`.../Pages/Question/QuestionFormFields.razor:42`).

### ConferenceCategoryFormModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Categories/ConferenceCategoryFormModel.cs:24` · Level 3 · class (abstract base form model)

- **What it is**: the editable conference-category fields shared by the create page and the detail page's
  inline editor: the title with its rules, the display order, and the optional type discriminator.
- **Depends on**: [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) for the
  title cap (lines 2,35). Its subclasses are
  [`ConferenceCategoryCreateModel`](#conferencecategorycreatemodel) and
  [`ConferenceCategoryEditModel`](#conferencecategoryeditmodel).
- **Concept introduced**: none new. This is the category-side twin of
  [`QuestionFormModel`](#questionformmodel); read that section for the shared-base rationale, and
  [`ConferenceCategoryItemEditModel`](#conferencecategoryitemeditmodel) for the annotations-to-MudBlazor
  bridge. `[Rubric §24, Forms, Validation & UX Safety]` and `[Rubric §15, Best Practices & Code Quality]` apply for the
  same reasons.
- **Walkthrough**
  - `CategoryTitleRequiredKey` (line 31): the resource key `"Validation.TitleRequired"`, quoted by the
    model's `[Required]` (line 34) and by the field's `RequiredError`
    (`.../Pages/ConferenceCategory/ConferenceCategoryFormFields.razor:18`).
  - `CategoryTitle` (line 36): required and capped at `ConferenceCategoryDTO.TitleMaxLength`, which is
    `255` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Categories/ConferenceCategoryDTO.cs:17`).
    The name is deliberate and the doc comment says why (line 33): a property named `Title` on a page
    class would read as the page title, and the pages already expose a localized `Title`.
  - `Sort` (line 39) and `Type` (line 42): plain properties with no annotation. `Type` is nullable and
    optional (for example `"session"` or `"speaker"`); its input caps itself at
    `ConferenceCategoryDTO.TypeMaxLength` in markup
    (`.../Pages/ConferenceCategory/ConferenceCategoryFormFields.razor:23`) rather than through an
    annotation.
- **Why it's built this way**: the same anti-drift argument as [`QuestionFormModel`](#questionformmodel).
  The shared `ConferenceCategoryFormFields` component takes this type as its `Model`
  (`.../Pages/ConferenceCategory/ConferenceCategoryFormFields.razor:28`), so both consuming pages render
  the identical field block and neither can add a rule the other lacks.
- **Where it's used**: base of [`ConferenceCategoryCreateModel`](#conferencecategorycreatemodel) and
  [`ConferenceCategoryEditModel`](#conferencecategoryeditmodel); bound by
  [`ConferenceCategoryCreate`](#conferencecategorycreate)
  (`.../Pages/ConferenceCategory/ConferenceCategoryCreate.razor:23`) and
  [`ConferenceCategoryDetail`](#conferencecategorydetail)
  (`.../Pages/ConferenceCategory/ConferenceCategoryDetail.razor:34`).

### QuestionCreateModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Questions/QuestionCreateModel.cs:11` · Level 3 · class (sealed form model)

- **What it is**: the form model for the organizer question-creation page. It adds the two fields that are
  chosen once at creation and never edited afterwards (the target entity and the input type) and knows how
  to turn itself into the [`QuestionDTO`](group-17-conference-domain.md#questiondto) the create posts.
- **Depends on**: [`QuestionFormModel`](#questionformmodel) (base),
  [`QuestionDTO`](group-17-conference-domain.md#questiondto), and the `QuestionIdentifierType` alias
  ([ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)).
- **Concept introduced, the model owns the shape of the post.** The page validates and calls the service;
  it does not build the DTO field by field. `ToNew` (lines 24-33) is the one place that maps form state
  onto the wire contract, which keeps the page's save handler down to "validate, map, post, navigate".
  `[Rubric §18, UI Architecture & Component Design]` (assesses whether logic sits outside the component
  where it can be reasoned about alone): mapping is a pure function of the model, testable without a
  renderer. `[Rubric §9, API & Contract Design]` (assesses how the client fills the contract): the create
  post is a full `QuestionDTO`, not a partial patch.
- **Walkthrough**
  - `QuestionEntity` (line 14) defaults to `"Session"` and `QuestionType` (line 17) defaults to
    `"Rating"`, the common combination, so the organizer's most frequent case needs no interaction. Both
    render as `MudSelect` pickers only on the create leg, gated by the field block's `ShowTargetPickers`
    switch (`.../Pages/Question/QuestionFormFields.razor:21-35`).
  - `ToNew(QuestionIdentifierType id)` (lines 24-33) projects the model plus a caller-supplied id onto a
    `QuestionDTO`. Taking the id as a parameter rather than minting one keeps the model free of the
    identifier policy that [`QuestionCreate`](#questioncreate) applies.
- **Why it's built this way**: an entity/type pair chosen at creation determines how every answer to the
  question will be captured, so it belongs to the create form only; putting it on the create model rather
  than the shared base is what makes [`QuestionEditModel`](#questioneditmodel) structurally unable to
  change it.
- **Where it's used**: the `_model` field of [`QuestionCreate`](#questioncreate)
  (`.../Pages/Question/QuestionCreate.razor.cs:39`), read at the post
  (`.../Pages/Question/QuestionCreate.razor.cs:68`).

### QuestionEditModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Questions/QuestionEditModel.cs:12` · Level 3 · class (sealed form model)

- **What it is**: the form model for the inline editor on the question detail page. It loads itself from
  the question that was fetched and projects itself back onto an updated
  [`QuestionDTO`](group-17-conference-domain.md#questiondto).
- **Depends on**: [`QuestionFormModel`](#questionformmodel) (base) and
  [`QuestionDTO`](group-17-conference-domain.md#questiondto).
- **Concept introduced, the edit buffer plus the concurrency round trip.** Two mechanisms are worth
  reading closely.
  1. **The loaded record is never mutated.** `LoadFrom` (lines 16-23) copies the three editable values off
     the fetched DTO into the model, and the page renders from the DTO throughout. Cancelling an edit
     therefore needs no undo: the model is simply abandoned, and what is on screen is still exactly what
     the server last returned. `[Rubric §19, State Management & Data Flow]` (assesses where mutable state
     lives and how long it lives): the edit buffer is a separate object with a scope of one editing
     session.
  2. **`ToUpdated` round-trips what it must not change.** The new DTO (lines 34-44) carries the edited
     `QuestionText`, `Sort`, and `IsRequired` over the loaded record's `Id`, `RowVersion`,
     `QuestionEntity`, and `QuestionType`. `RowVersion` is the client half of the optimistic-concurrency
     contract in [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html): a stale
     editor loses the write instead of silently overwriting a newer one. `QuestionEntity` and
     `QuestionType` are re-sent unchanged because the update contract is a full replacement, not a patch.
     `[Rubric §8, Data Architecture]` (assesses how concurrent writes are reconciled and how immutable
     fields are protected).
  Both methods open with `ArgumentNullException.ThrowIfNull` (lines 18,33), so a null argument fails at
  the call rather than as a `NullReferenceException` several lines later. `[Rubric §15, Best Practices &
  Code Quality]`.
- **Walkthrough**
  - `LoadFrom(QuestionDTO question)` (lines 16-23): copies `QuestionText`, `Sort`, `IsRequired`.
  - `ToUpdated(QuestionDTO question)` (lines 31-45): builds the replacement DTO as described above.
- **Why it's built this way**: the class doc records the reasoning for the omission (lines 5-11).
  Retargeting a question or changing how it is answered would invalidate the answers already collected, so
  both fields are displayed but never edited; leaving them off the model makes that a compile-time fact
  rather than a markup discipline.
- **Where it's used**: the `_model` field of [`QuestionDetail`](#questiondetail)
  (`.../Pages/Question/QuestionDetail.razor.cs:49`), loaded at `StartEditing` (line 105) and read at the
  save (line 133).

### ConferenceCategoryCreateModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Categories/ConferenceCategoryCreateModel.cs:10` · Level 4 · class (sealed form model)

- **What it is**: the form model for the category-creation page. It adds nothing to
  [`ConferenceCategoryFormModel`](#conferencecategoryformmodel) except the shape of the post.
- **Depends on**: [`ConferenceCategoryFormModel`](#conferencecategoryformmodel) (base) and
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto).
- **Concept introduced**: none new. `ToNew` is the mapping-on-the-model idea introduced on
  [`QuestionCreateModel`](#questioncreatemodel).
- **Walkthrough**
  - `ToNew()` (lines 17-24) builds a [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto)
    with `Id = default` (line 20) plus the three entered values. Note the contrast with
    [`QuestionCreateModel.ToNew`](#questioncreatemodel), which takes an id: a category leaves identity
    assignment entirely to the server, and the page navigates on the id read back from the response.
    `[Rubric §8, Data Architecture]` (assesses a deliberate identity strategy): the two entities in this
    unit make opposite choices, and each is visible right here in the mapping method.
- **Why it's built this way**: keeping the create model empty apart from `ToNew` is the point. Every field
  a reader could look for is on the shared base, which is the same base the detail page's editor binds, so
  the two forms cannot drift apart (doc comment, lines 5-9).
- **Where it's used**: the `_model` field of [`ConferenceCategoryCreate`](#conferencecategorycreate)
  (`.../Pages/ConferenceCategory/ConferenceCategoryCreate.razor.cs:39`), read at the post (line 67).

### ConferenceCategoryEditModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Categories/ConferenceCategoryEditModel.cs:11` · Level 4 · class (sealed form model)

- **What it is**: the edit buffer for the inline category editor on the detail page: it loads from the
  fetched category and projects back onto an updated DTO.
- **Depends on**: [`ConferenceCategoryFormModel`](#conferencecategoryformmodel) (base) and
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto).
- **Concept introduced**: none new. The load-into-buffer and `RowVersion` round-trip mechanics are taught
  on [`QuestionEditModel`](#questioneditmodel). `[Rubric §8, Data Architecture]`: `ToUpdated` carries
  `RowVersion = category.RowVersion` (line 37), so the category edit participates in optimistic
  concurrency ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). Worth
  contrasting with the item edits in [`ConferenceCategoryItemsPanel`](#conferencecategoryitemspanel),
  which carry no token.
- **Walkthrough**
  - `LoadFrom(ConferenceCategoryDTO category)` (lines 15-22): null-guards, then copies `Title` into
    `CategoryTitle`, plus `Sort` and `Type`.
  - `ToUpdated(ConferenceCategoryDTO category)` (lines 30-42): null-guards, then rebuilds the DTO with the
    loaded `Id` and `RowVersion` and the edited title, sort, and type.
- **Why it's built this way**: the class doc records the deliberate omission (lines 5-10): the category
  items are absent from this model because they are edited in their own panel, not in this form. That is
  what lets the page's save path be a single `UpdateAsync` with no child reconciliation.
- **Where it's used**: the `_model` field of [`ConferenceCategoryDetail`](#conferencecategorydetail)
  (`.../Pages/ConferenceCategory/ConferenceCategoryDetail.razor.cs:53`), loaded at `StartEditing`
  (line 108) and read at the save (line 129).

### ConferenceCategoryCreate

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Categories/ConferenceCategoryCreate.razor.cs:11` · Level 5 · class (Blazor code-behind)

- **What it is**: the organizer's category-creation form. It renders the shared field block over a
  [`ConferenceCategoryCreateModel`](#conferencecategorycreatemodel), posts one
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) through the UI service,
  and redirects to the detail page for the record it just made.
- **Depends on**: [`IConferenceCategoryUIService`](#iconferencecategoryuiservice) (line 13),
  [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 15),
  [`ConferenceRoutePaths`](#conferenceroutepaths) (lines 28,76,88),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 60),
  [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) and
  [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator)
  (line 33). Externals: Blazor (`[Inject]`, `NavigationManager`, `OnInitialized`), MudBlazor (`MudForm`,
  `BreadcrumbItem`, `Icons.Material.Filled.Home`), the shared `UnsavedChangesGuard` and `ErrorSummary`
  components from `MMCA.Common.UI`, and the `IStringLocalizer<ConferenceCategoryCreate>` the template
  injects as `L` (`.../Pages/ConferenceCategory/ConferenceCategoryCreate.razor:6`).
- **Concept introduced, the create-page shape and its three safety rails.** This is the smallest create
  form in the group, which makes it the clearest place to read the shape the others repeat.
  1. **Validate before you mutate.** `CreateCategoryAsync` calls `await _form.ValidateAsync()` and returns
     with a warning toast when `!_form.IsValid` (lines 57-62), before any service call. The server
     validates again; this pass exists to keep a round trip off the wire and to put the message next to the
     field. Errors are then collapsed and localized once by the shared `ErrorSummary`
     (`.../Pages/ConferenceCategory/ConferenceCategoryCreate.razor:34`), whose comment (lines 28-33)
     records why de-duplication is needed: MudBlazor runs a field's annotations through `For` as well as
     through the shared delegate, so one empty field can report the same rule twice, once localized and
     once as the bare key. `[Rubric §24, Forms, Validation & UX Safety]`.
  2. **Dirty tracking that cannot block its own redirect.** Every field change raises `MarkDirty()`
     (line 48, wired through the field block's `OnFieldChanged`,
     `.../Pages/ConferenceCategory/ConferenceCategoryCreate.razor:23-25`) and the markup mounts
     `<UnsavedChangesGuard IsDirty="_isDirty" IsDirtyAccessor="() => _isDirty" />`
     (`.../Pages/ConferenceCategory/ConferenceCategoryCreate.razor:10`). The accessor is the load-bearing
     half: the guard prefers the live accessor over the parameter snapshot, because clearing the flag and
     calling `NavigateTo` without an intervening render would otherwise still prompt. The page clears
     `_isDirty` on the success path **before** navigating, with the reason written on the line (line 74).
  3. **Cancel on disposal.** A private `CancellationTokenSource` (line 17) is passed into the service call
     (line 67) and cancelled through a full `Dispose(bool)` pattern (lines 90-112), with
     `OperationCanceledException` caught and ignored as the expected teardown or InteractiveAuto
     render-mode transition outcome (lines 78-81,
     [ADR-056](https://ivanball.github.io/docs/adr/056-blazor-render-mode-strategy.html)).
     `[Rubric §23, Front-End Performance & Rendering]`: an abandoned form does not keep a response alive
     for a component that no longer exists.
  `[Rubric §11, Security]` (assesses authorization at the boundary the user actually reaches): the route
  carries `@attribute [Authorize(Roles = "Organizer")]`
  (`.../Pages/ConferenceCategory/ConferenceCategoryCreate.razor:2`).
  `[Rubric §27, Internationalization]`: every label, breadcrumb, and toast reads through `L`.
- **Walkthrough**
  - `OnInitialized` (lines 22-34) builds the Home / Categories / Create breadcrumb trail (lines 25-30) and
    then builds the validation delegate once (line 33), so the bridge is created per page instance rather
    than per render.
  - The form state is three fields: the `_model` (line 39), the `_validate` delegate (line 43), and the
    captured `MudForm` (line 45). Compare the pre-extraction shape, where each editable value was its own
    private field on the page.
  - `CreateCategoryAsync` (lines 50-86): null-guard the form (lines 52-55), validate, set `IsSaving`
    (line 64), post `_model.ToNew()` (line 67), fail into a toast when the result carries no value
    (lines 68-72), clear the dirty flag (line 74), toast success (line 75), and redirect to
    `ConferenceRoutePaths.ConferenceCategoryDetails(newCategory.Id)` using the id the server returned
    (line 76). The `finally` always clears `IsSaving` (lines 82-85), so a failed save leaves an enabled
    button rather than a stuck spinner.
  - `NavigateToList` (line 88) is the cancel action, routed through
    [`ConferenceRoutePaths`](#conferenceroutepaths) rather than a literal.
    `[Rubric §25, Navigation & Information Architecture]`: every route in the module is a named constant in
    one file.
- **Why it's built this way**: one create shape repeated per entity keeps the organizer's mental model
  constant (fill, validate, save, land on the new record) while each page varies only in the fields it
  collects, and since the extraction of
  [`ConferenceCategoryFormModel`](#conferencecategoryformmodel) it varies in even less than that.
- **Where it's used**: the `/conferencecategories/create` route
  (`.../Pages/ConferenceCategory/ConferenceCategoryCreate.razor:1-2`), reached from
  [`ConferenceCategoryList`](#conferencecategorylist)'s create button; on success it hands off to
  [`ConferenceCategoryDetail`](#conferencecategorydetail).

### ConferenceCategoryDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Categories/ConferenceCategoryDetail.razor.cs:19` · Level 5 · class (Blazor code-behind)

- **What it is**: the container half of the organizer's category console. It loads one
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) with its children by
  route id, runs the inline category editor and the delete flow, and hosts the item panel that owns the
  child-entity CRUD.
- **Depends on**: [`DetailPageBase`](#detailpagebase) (via `@inherits`,
  `.../Pages/ConferenceCategory/ConferenceCategoryDetail.razor:3`),
  [`IConferenceCategoryUIService`](#iconferencecategoryuiservice) (line 23),
  [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 25),
  [`ConferenceCategoryEditModel`](#conferencecategoryeditmodel) (line 53),
  [`ConferenceCategoryItemsPanel`](#conferencecategoryitemspanel)
  (`.../Pages/ConferenceCategory/ConferenceCategoryDetail.razor:73`),
  [`ResultUiExtensions`](group-15-common-ui-framework.md#resultuiextensions) for `IsNotFound()` and
  `NotifyOnFailure` (lines 80,88,132,139,175),
  [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Parse<T>` extension (line 74),
  [`ConferenceRoutePaths`](#conferenceroutepaths) (lines 39,192), and
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (lines 84,122). Externals: MudBlazor
  `MudForm`, plus the `PageLoadingState`, `PageErrorState`, `ErrorSummary`, `UnsavedChangesGuard`, and
  `DeleteConfirmation` components from `MMCA.Common.UI`
  (`.../Pages/ConferenceCategory/ConferenceCategoryDetail.razor:11,18,22,44,82`).
- **Concept introduced, the container/presentational split of a parent-with-children editor.** The class
  doc states the division (lines 14-18): this page owns the loaded aggregate, the inline category editor,
  and the delete flow; the item CRUD lives in the presentational
  [`ConferenceCategoryItemsPanel`](#conferencecategoryitemspanel), which reloads the aggregate itself and
  hands the refreshed copy back through a callback that this page adopts in one line
  (`OnCategoryReloaded`, line 190). The page therefore has exactly one mutation entry point for child data
  and no child-collection logic at all. `[Rubric §18, UI Architecture & Component Design]` (assesses
  decomposition) and `[Rubric §19, State Management & Data Flow]` (assesses single ownership of state): the
  category has one owner (this page) and one place it can be replaced.
  Three further mechanisms are worth reading.
  - **Load once on parameters.** `OnParametersSetAsync` compares the route `Id` against `_loadedId`
    (lines 64-69) so a re-render does not refetch.
  - **A 404 is a distinct outcome.** `result.IsNotFound()` (line 80) clears `Category` and reports a
    not-found message; anything else routes through `NotifyOnFailure` (line 88). The comment at line 82
    records the defect this replaced, where a 404 arrived as a null success. `[Rubric §29, Resilience &
    Business Continuity]`: not-found, failed, and empty are three different rendered states.
  - **Refetch, do not patch.** A successful update is followed by a fresh `GetByIdAsync` (line 136) and the
    page renders the server's answer. That costs one extra read and removes an entire class of drift
    between what was saved and what is shown.
  `[Rubric §8, Data Architecture]`: the save posts `_model.ToUpdated(Category)`, which round-trips the
  `RowVersion` ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)).
  `[Rubric §11, Security]`: organizer-only route
  (`.../Pages/ConferenceCategory/ConferenceCategoryDetail.razor:2`).
- **Walkthrough**
  - `OnInitialized` (lines 33-45): breadcrumbs (lines 36-41) and the validation delegate (line 44).
  - `OnParametersSetAsync` (lines 62-99): the `_loadedId` guard, `Id.Parse<ConferenceCategoryIdentifierType>()`
    (line 74), `GetByIdAsync(id, true, PageToken)` with children (line 75), the three-way result handling
    above, `OperationCanceledException` swallowed (lines 91-94), and a `finally` that always clears
    `IsLoading` (lines 95-98). `PageToken` comes from [`DetailPageBase`](#detailpagebase), so the page
    itself never declares a `CancellationTokenSource`.
  - `StartEditing` (lines 101-110): copies the loaded category into the edit model (line 108) and calls the
    base's `BeginEdit()` (line 109), which sets `IsEditing` and clears `IsDirty` in one place.
  - `SaveChangesAsync` (lines 112-155): validate the form (lines 119-124), `UpdateAsync(_model.ToUpdated(Category))`
    (line 129), report a failure through `NotifyOnFailure` (line 132), refetch (line 136), adopt the
    refreshed record (line 143), toast, and call `EndEdit()` (line 145) so the dirty flag can never be left
    set behind a closed editor.
  - `DeleteCategoryAsync` (lines 157-186): confirm through the shared `DeleteConfirmation` dialog seeded
    with the category title (line 164), delete (line 172), then navigate back to the list (line 180).
  - `OnCategoryReloaded` (line 190) and `NavigateToList` (line 192) are one-liners.
- **Why it's built this way**: a category is only meaningful together with its items (a topic list, a
  session-level list, a locality list), so editing them on two routes would be worse than one composite
  page. Splitting the panel out keeps that composite page readable: the container is now roughly the size
  of any other detail page, and the child-entity concerns are in a component that can be read on its own.
- **Where it's used**: the `/conferencecategories/{Id}` route
  (`.../Pages/ConferenceCategory/ConferenceCategoryDetail.razor:1-2`), reached from
  [`ConferenceCategoryList`](#conferencecategorylist) rows and
  [`ConferenceCategoryCreate`](#conferencecategorycreate)'s redirect. The items authored here are what
  [`ICategoryItemLookupService`](#icategoryitemlookupservice) resolves for the session and speaker pages.

### ConferenceCategoryList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Categories/ConferenceCategoryList.razor.cs:12` · Level 5 · class (Blazor code-behind)

- **What it is**: the organizer's category browse page: a server-paged grid with a single title search box,
  delete-with-confirmation, and a mobile card layout. It is a thin binding over the shared list-page base.
- **Depends on**: extends
  [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) closed over
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) (line 11, declared in
  markup at `.../Pages/ConferenceCategory/ConferenceCategoryList.razor:4`);
  [`IConferenceCategoryUIService`](#iconferencecategoryuiservice) (line 16),
  [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem)
  (line 24), [`ListPageActions`](group-15-common-ui-framework.md#listpageactions) (lines 35,68),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 74),
  [`ConferenceRoutePaths`](#conferenceroutepaths) (lines 64,77),
  [`Result`](group-01-result-error-handling.md#result) (line 55), and the shared `DeleteConfirmation`
  component (line 25, mounted at `.../Pages/ConferenceCategory/ConferenceCategoryList.razor:115`).
- **Concept introduced, the list page as a set of overrides.** The base owns the machinery: the abstract
  `Title`, the grid reference plumbing, the `IsMobile` switch, the mobile paging fields, the filter
  save/restore contract, the inline `LoadFailed` state, and `LoadServerDataAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs`). This page
  supplies five things and nothing else.
  - The captured grid reference through the `GridRef` override (lines 19-20), which is how the base
    restores rows-per-page and the current page after a back-navigation.
  - `SaveFilters` / `RestoreFilters` for the one search term (lines 28-32).
    `[Rubric §25, Navigation & Information Architecture]`: a reader who opens a record and comes back finds
    the same view, not a reset grid.
  - `LoadServerData` (lines 43-52), which hands the base a fetch delegate plus a filter builder that turns
    the search string into a server-side `Title contains` filter (line 51).
    `[Rubric §12, Performance & Scalability]` and `[Rubric §23, Front-End Performance & Rendering]`: search,
    sort, and paging all execute where the data is, so the client never materializes a whole table.
  - `FetchMobilePage` (lines 55-61), the parallel path for the infinite-scroll card list, hard-sorted by
    `Title` ascending (line 60). `[Rubric §22, Responsive & Cross-Browser]` (assesses a genuine mobile
    layout rather than a shrunk grid): the same service call backs both branches, selected by the base's
    `IsMobile`.
  - `RetryLoadAsync` (line 23), which re-runs the fetch from the inline error state.
    `[Rubric §29, Resilience & Business Continuity]`: a failed load offers a retry instead of a dead grid.
  Two details separate this page from its siblings. Both fetch paths pass `includeChildren: true`
  (lines 47,60), because both layouts render the child item count
  (`.../Pages/ConferenceCategory/ConferenceCategoryList.razor:37,92`); this is the one list page in the
  module that pays for children. And deletion is not reimplemented:
  `ListPageActions.DeleteWithConfirmationAsync` (lines 67-75) takes the dialog, the label to show, the
  delete call, the toast service, the localized success text, an error formatter, and the reload callback.
  `[Rubric §1, SOLID]` and `[Rubric §15, Best Practices & Code Quality]`: confirm, delete, toast, reload has one
  implementation for every list page in the app.
- **Walkthrough**: `ReloadActiveLayoutAsync` (lines 34-35) asks
  [`ListPageActions`](group-15-common-ui-framework.md#listpageactions) to reload whichever of the two
  layouts is live and is the single reload entry point shared by search changes and post-delete refreshes;
  `OnSearchChanged` (lines 37-41) stores the term and calls it; `OnMobileCardClick` (lines 63-64) and
  `NavigateToCreate` (line 77) route through [`ConferenceRoutePaths`](#conferenceroutepaths); the grid's
  sortable columns are `PropertyColumn`s over `Title`, `Sort`, and `Type`
  (`.../Pages/ConferenceCategory/ConferenceCategoryList.razor:59,67,77`) with the item count as a
  non-sortable `TemplateColumn` (line 86), which is the server-sortability rule the grid enforces.
- **Why it's built this way**: several near-identical organizer browse surfaces are exactly the case a base
  class is for. Because each page is only its overrides, a change to paging, scroll restoration, or the
  mobile switch lands in one place and every list inherits it.
- **Where it's used**: the `/conferencecategories` organizer route
  (`.../Pages/ConferenceCategory/ConferenceCategoryList.razor:1-2`). Rows and cards navigate to
  [`ConferenceCategoryDetail`](#conferencecategorydetail); the create button opens
  [`ConferenceCategoryCreate`](#conferencecategorycreate).

### ConferenceCategoryItemsPanel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Categories/ConferenceCategoryItemsPanel.razor.cs:21` · Level 6 · class (Blazor component code-behind)

- **What it is**: the category-item half of the category detail page: the item-count header, the inline add
  form, and the item table with its inline edit row and delete action. It performs the child-entity
  mutations itself and hands the reloaded parent category back to the page.
- **Depends on**: [`ICategoryItemUIService`](#icategoryitemuiservice) (line 24) for the mutations and
  [`IConferenceCategoryUIService`](#iconferencecategoryuiservice) (line 23) for the reload;
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) and
  [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto); the `CategoryItemIdentifierType`
  alias (line 47); [`ConferenceCategoryItemEditModel`](#conferencecategoryitemeditmodel) (line 36) with
  [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) and
  [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator)
  (line 57); [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 25); and
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 80). Externals: MudBlazor
  `MudForm`, the shared `ErrorSummary` and `DeleteConfirmation` components
  (`.../Pages/ConferenceCategory/ConferenceCategoryItemsPanel.razor:53,106`).
- **Concept introduced, the presentational child that owns its own writes.** This is a different split
  from the filter-bar style of presentational component. The panel takes the category as a `[Parameter]`
  (line 28) and never mutates it; instead, every mutation re-reads the aggregate through
  `ReloadCategoryAsync` (lines 183-193) and raises the refreshed copy on the
  `CategoryChanged` callback (line 191), which the page adopts. State therefore still has exactly one
  owner ([`ConferenceCategoryDetail`](#conferencecategorydetail)) while the write logic lives next to the
  markup that triggers it. `[Rubric §18, UI Architecture & Component Design]` and
  `[Rubric §19, State Management & Data Flow]`.
  Two details reward a close read.
  - **The panel injects the page's localizer.** Its template declares
    `@inject IStringLocalizer<ConferenceCategoryDetail> L`
    (`.../Pages/ConferenceCategory/ConferenceCategoryItemsPanel.razor:4`), so every string keeps the exact
    wording it had before the split and no second resource file appears.
    `[Rubric §27, Internationalization]`.
  - **The two editors are mutually exclusive by construction.** `StartAddingItem` closes any open row edit
    (line 65) and `StartEditingItem` closes the add form (line 113), so the panel can never show two open
    editors at once. `[Rubric §24, Forms, Validation & UX Safety]`.
  `[Rubric §21, Accessibility]`: every icon-only action carries an `aria-label` read from the localizer
  (`.../Pages/ConferenceCategory/ConferenceCategoryItemsPanel.razor:78,80,91,93`).
  `[Rubric §8, Data Architecture]`: neither the item add nor the item update carries a `RowVersion`
  (lines 87,134), so a category item is a last-writer-wins edit while the category itself is not. That is a
  real asymmetry, not an oversight in the reading: `CategoryItemDTO` declares no concurrency token.
- **Walkthrough**
  - `OnInitialized` (lines 52-58) builds the validation delegate over the panel's own
    [`ConferenceCategoryItemEditModel`](#conferencecategoryitemeditmodel) (line 57).
  - Add: `StartAddingItem` (lines 60-66) clears the model and the sort field and opens the form;
    `AddItemAsync` (lines 70-106) validates its own `MudForm` (lines 77-82), builds a
    [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto) stamped with the parent
    `CategoryId` (line 87), posts (line 88), and treats "add failed" and "reload failed" as one outcome
    (line 89) before toasting success (line 95).
  - Edit: `StartEditingItem` (lines 108-114) seeds the row-edit fields from the clicked item, and
    `UpdateItemAsync` (lines 118-153) is the one path that does **not** use a `MudForm`: it hand-checks
    `string.IsNullOrWhiteSpace(_editItemName)` and warns with the same resource key the model declares
    (lines 125-129), because the row editor is inline in the table rather than a form.
  - Delete: `DeleteItemAsync` (lines 155-178) confirms through the `DeleteConfirmation` dialog seeded with
    the item name (line 157), deletes (line 165), and reloads.
  - `ReloadCategoryAsync` (lines 183-193): re-reads the category with children (line 185) and returns
    `false` when the read comes back empty, leaving the caller to report its own failure message; the
    comment at lines 180-182 states that contract.
  - Disposal (lines 195-220): the panel owns its own `CancellationTokenSource` (line 33) and implements the
    standard `Dispose(bool)` pattern, because it is a component rather than a page and so does not inherit
    [`DetailPageBase`](#detailpagebase)'s `PageToken`.
- **Why it's built this way**: the item CRUD is the bulk of what a category console does, and keeping it in
  the page made that page the largest in the module. Extracting it as a presentational panel that reloads
  the aggregate itself preserves the previous behavior exactly (the doc comment says so, lines 13-20) while
  leaving the page with one aggregate, one editor, and one callback.
- **Where it's used**: rendered once by [`ConferenceCategoryDetail`](#conferencecategorydetail) as
  `<ConferenceCategoryItemsPanel Category="Category" CategoryChanged="OnCategoryReloaded" />`
  (`.../Pages/ConferenceCategory/ConferenceCategoryDetail.razor:73`).

### QuestionCreate

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Questions/QuestionCreate.razor.cs:11` · Level 6 · class (Blazor code-behind)

- **What it is**: the organizer form that defines a feedback question: its text, the entity it attaches to
  (`Event` or `Session`), its input type (`Rating`, `Text`, or `Email`), its sort order, and whether an
  answer is required.
- **Depends on**: [`IQuestionUIService`](#iquestionuiservice) (line 13),
  [`QuestionCreateModel`](#questioncreatemodel) (line 39),
  [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 15),
  [`ConferenceRoutePaths`](#conferenceroutepaths) (lines 28,77,89),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 60),
  [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) (line 33). Externals: MudBlazor
  (`MudForm`, `BreadcrumbItem`), `System.Security.Cryptography.RandomNumberGenerator` (line 67), the
  `UnsavedChangesGuard` and `ErrorSummary` components, and the `IStringLocalizer<QuestionCreate>` injected
  as `L` (`.../Pages/Question/QuestionCreate.razor:6`).
- **Concept introduced, the client-minted identifier in a reserved range.**
  [`QuestionDTO`](group-17-conference-domain.md#questiondto)`.Id` is a non-nullable alias over `int`, so the
  form has to put something there. This page fabricates a value with
  `RandomNumberGenerator.GetInt32(999_999_000, 999_999_999)` (line 67), which is the user-created question
  band recorded on the domain side as `QuestionInvariants.ManualIdRangeStart` and `ManualIdRangeEnd`
  ([`QuestionInvariants`](group-17-conference-domain.md#questioninvariants),
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/QuestionInvariants.cs:40,43`),
  the range that sits above every Sessionize-assigned id. The server does not trust the value either way:
  [`CreateQuestionHandler`](group-18-conference-application.md#createquestionhandler) allocates the next
  free id in that range and overwrites the request, with "Caller-provided IDs are ignored" written on the
  line (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Create/CreateQuestionHandler.cs:71-86`).
  The page is written to tolerate that: it navigates using `newQuestion.Id` read back from the response
  (line 77), not the value it sent. Compare
  [`ConferenceCategoryCreate`](#conferencecategorycreate), which posts `Id = default` instead.
  `[Rubric §8, Data Architecture]` (assesses who owns identifier assignment): identity is server-owned
  inside a reserved range, because the same table also holds rows imported from Sessionize under
  externally assigned ids.
  `[Rubric §24, Forms, Validation & UX Safety]`: the validate-then-submit, dirty-guard, and
  cancel-on-disposal mechanics are the three rails
  [`ConferenceCategoryCreate`](#conferencecategorycreate) introduces, repeated here verbatim (validate
  lines 57-62, `_isDirty` cleared before the redirect line 75, `_cts` lines 17,68,93-113).
- **Walkthrough**
  - `OnInitialized` (lines 22-34): the Home / Questions / Create breadcrumb trail, then the validation
    delegate (line 33).
  - The form state is the `_model` (line 39), the `_validate` delegate (line 43), and the captured
    `MudForm` (line 45); the defaults for target entity and type live on the model, not the page
    (see [`QuestionCreateModel`](#questioncreatemodel)).
  - `CreateQuestionAsync` (lines 50-87): validate, set `IsSaving` (line 64), mint the id (line 67), post
    `_model.ToNew(id)` (line 68), fail into a toast when the result carries no value (lines 69-73), clear
    `_isDirty` (line 75), toast success, and redirect to
    `ConferenceRoutePaths.QuestionDetails(newQuestion.Id)` (line 77).
  - `NavigateToList` (line 89) is the cancel path back to `/questions`.
- **Why it's built this way**: questions are the schema behind every feedback screen in both the Conference
  and Engagement modules, so they are organizer-authored data rather than configuration. The reserved id
  band is what lets hand-authored questions and imported ones share a table without collisions.
- **Where it's used**: the `/questions/create` organizer route
  (`.../Pages/Question/QuestionCreate.razor:1-2`), reached from [`QuestionList`](#questionlist)'s create
  button; on success it hands off to [`QuestionDetail`](#questiondetail). It is also the one page in this
  unit with a bUnit component test class,
  [`QuestionCreateTests`](group-27-testing-infrastructure.md#questioncreatetests)
  (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/Pages/Questions/QuestionCreateTests.cs:19`),
  which asserts that a blank submit shows the model's own required message without MudBlazor's duplicate,
  that the required field keeps its `aria-required` affordance, that an overlong text shows the model's
  max-length message and does not post, and that a valid submit calls `AddAsync` with the defaults and
  navigates to the detail page. `[Rubric §28, Front-End Testing]`.

### QuestionList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Questions/QuestionList.razor.cs:12` · Level 6 · class (Blazor code-behind)

- **What it is**: the organizer browse page for feedback questions. Structurally the twin of
  [`ConferenceCategoryList`](#conferencecategorylist): same base class, same two layouts, same delete flow,
  with the search bound to the question text.
- **Depends on**: extends
  [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) over
  [`QuestionDTO`](group-17-conference-domain.md#questiondto) (line 11, declared in markup at
  `.../Pages/Question/QuestionList.razor:4`); [`IQuestionUIService`](#iquestionuiservice) (line 16);
  [`ListPageActions`](group-15-common-ui-framework.md#listpageactions) (lines 35,68),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 74),
  [`ConferenceRoutePaths`](#conferenceroutepaths) (lines 64,77),
  [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem)
  (line 24), [`Result`](group-01-result-error-handling.md#result) (line 55), and the shared
  `DeleteConfirmation` component (line 25, mounted at `.../Pages/Question/QuestionList.razor:145`).
- **Concept introduced**: none new. See [`ConferenceCategoryList`](#conferencecategorylist) for the
  base-class contract (the grid reference override, filter persistence, the two fetch delegates, the
  inline retry, and the shared delete action).
- **Walkthrough** (only the differences from [`ConferenceCategoryList`](#conferencecategorylist)):
  - The search filter targets `QuestionText contains <search>` on both the desktop (lines 48-52) and mobile
    (lines 57-60) paths, and the mobile fetch sorts by `QuestionText` ascending (line 60).
  - Neither fetch path passes `includeChildren`: a question has no children to count, so the list stays a
    plain paged read (lines 47,60). `[Rubric §12, Performance & Scalability]`.
  - `DeleteQuestionAsync` (lines 67-75) passes `question.QuestionText` as the confirmation label, so the
    dialog names the question being removed rather than showing a bare id.
    `[Rubric §24, Forms, Validation & UX Safety]`.
- **Why it's built this way**: questions are low-volume reference data, so the page needs browse, search,
  and delete but no filters or enrichment; keeping it on the same base means it inherits URL-persisted
  paging, sorting, and the inline retry state for free.
- **Where it's used**: the `/questions` organizer route (`.../Pages/Question/QuestionList.razor:1-2`); the
  create button opens [`QuestionCreate`](#questioncreate) (line 77) and rows open
  [`QuestionDetail`](#questiondetail) (line 64).

### QuestionDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Questions/QuestionDetail.razor.cs:14` · Level 8 · class (Blazor code-behind)

- **What it is**: the organizer's view, edit, and delete page for a single feedback question. It is the
  smallest detail page in the group: three editable fields, no lookups, and no child entities.
- **Depends on**: [`IQuestionUIService`](#iquestionuiservice) (line 18),
  [`QuestionEditModel`](#questioneditmodel) (line 49),
  [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 20),
  [`ResultUiExtensions`](group-15-common-ui-framework.md#resultuiextensions) for `IsNotFound()` and
  `NotifyOnFailure` (lines 77,85,136,143,180),
  [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Parse<T>` extension (line 71),
  [`ConferenceRoutePaths`](#conferenceroutepaths) (lines 35,193),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (lines 81,126), and
  [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) (line 40). Externals: MudBlazor
  `MudForm`, plus the `PageLoadingState`, `PageErrorState`, `ErrorSummary`, `UnsavedChangesGuard`, and
  `DeleteConfirmation` components (`.../Pages/Question/QuestionDetail.razor:9,16,20,40,79`).
- **Concept introduced**: none new. Route-id parsing, load-once-on-parameters, the edit buffer, the
  `RowVersion` round trip, and refetch-after-save are all covered on
  [`ConferenceCategoryDetail`](#conferencecategorydetail) and
  [`QuestionEditModel`](#questioneditmodel).
  `[Rubric §8, Data Architecture]`: the immutable-after-create fields (`QuestionEntity`, `QuestionType`)
  are round-tripped by [`QuestionEditModel.ToUpdated`](#questioneditmodel) rather than omitted, so the
  update contract stays a full replacement.
  `[Rubric §11, Security]`: organizer-only route (`.../Pages/Question/QuestionDetail.razor:2`).
- **Walkthrough**
  - `OnInitialized` (lines 29-41): the Home / Questions / Details breadcrumb trail, then the validation
    delegate (line 40).
  - `OnParametersSetAsync` (lines 60-96): the `_loadedId` guard (lines 62-67),
    `Id.Parse<QuestionIdentifierType>()` (line 71), `GetByIdAsync` (line 72), the not-found branch that
    clears `Question` and reports through [`ErrorMessages`](group-15-common-ui-framework.md#errormessages)
    (lines 77-82), `NotifyOnFailure` for anything else (line 85), and a `finally` that always clears
    `IsLoading` (lines 93-95).
  - `StartEditing` (lines 98-108) loads the edit model from the fetched question (line 105) and opens the
    editor; `CancelEditing` (lines 110-114) closes it and clears the dirty flag.
  - `SaveChangesAsync` (lines 116-160): validate (lines 123-128), `UpdateAsync(_model.ToUpdated(Question))`
    (line 133), refetch (line 140), adopt the refreshed record (line 147), toast, and clear both
    `_isDirty` and `_isEditing` (lines 149-150).
  - `DeleteQuestionAsync` (lines 162-191): confirm with the question text as the label (line 169), delete
    (line 177), and navigate back to the list (line 185).
  - Disposal (lines 195-217) is the standard cancel-on-disposal pattern over the
    `CancellationTokenSource` at line 24.
- **Why it's built this way**: a question's entity and type determine how every existing answer was
  captured, so changing them after answers exist would invalidate stored data; restricting the edit surface
  to text, order, and required-ness is the simplest way to keep answers interpretable.
- **Where it's used**: the `/questions/{Id}` organizer route (`.../Pages/Question/QuestionDetail.razor:1-2`),
  reached from [`QuestionList`](#questionlist) rows and from [`QuestionCreate`](#questioncreate)'s success
  redirect.
- **Caveats / not-in-source**: this page does **not** derive from [`DetailPageBase`](#detailpagebase). Its
  template declares no `@inherits` (`.../Pages/Question/QuestionDetail.razor:1-5`) and the class implements
  `IDisposable` directly (line 14), holding its own `_cts` (line 24), `_isEditing` (line 48), `_isDirty`
  (line 51), `MarkDirty` (line 58), and `Dispose(bool)` (lines 197-211): the same five members the base
  owns for [`ConferenceCategoryDetail`](#conferencecategorydetail). Whether that is deliberate is not
  determinable from source; the duplication is visible, the reason is not recorded in either file.

### RoomFormModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Rooms` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Rooms/RoomFormModel.cs:24` · Level 2 · abstract class

- **What it is**: the editable half of a room, expressed once as a plain C# class with DataAnnotations
  on it. It is `abstract` (line 24) because nobody binds it directly: the create page binds
  [`RoomCreateModel`](#roomcreatemodel) and the detail page's inline editor binds
  [`RoomEditModel`](#roomeditmodel), and both inherit exactly these six properties. One declaration of
  the rules means a name the create form accepts is a name the edit form accepts (class doc, lines
  6-13).
- **Depends on**: [`RoomDTO`](group-17-conference-domain.md#roomdto) for the length caps (lines 35, 45,
  49, 53) and nothing else first-party. Externals: `System.ComponentModel.DataAnnotations`
  (`RequiredAttribute`, `MaxLengthAttribute`, line 1). It is consumed by
  [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) and
  [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator),
  named in the class doc at lines 9-10 and 16.
- **Concept introduced, the shared form model.** A Blazor page could hold a loose field per input and
  a `RequiredError` string per control. This codebase does the opposite: the fields live on one model,
  the rules live on that model as attributes, and the MudBlazor controls carry only `For` plus a
  single shared `Validation` delegate (see
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Room/RoomFormFields.razor:14-16`).
  The delegate is built once per page by
  [`ModelValidation.For`](group-15-common-ui-framework.md#modelvalidation) over a
  [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator)
  (`.../Pages/Room/RoomCreate.razor.cs:46`, `.../Pages/Room/RoomDetail.razor.cs:42`), so a rule is
  declared exactly once and evaluated by both forms. Even the required affordance is derived rather
  than restated: the field asks `ModelValidation.IsRequired(Model, nameof(RoomFormModel.Name))`
  (`.../Pages/Room/RoomFormFields.razor:16`) instead of hard-coding `Required="true"`.
  `[Rubric §24, Forms, Validation & UX Safety]` assesses whether a form can express only legal input
  and explains a rejection in place; here the model is the only rule declaration, so create and edit
  cannot diverge on what "legal" means.
  `[Rubric §27, Internationalization]` assesses whether user-facing text is externalized: every
  `ErrorMessage` on this model is a **resource key**, not a sentence (lines 31, 35, 45, 49, 53), and
  the page's localizing validator resolves it (class doc, lines 15-17; see
  [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
  `[Rubric §15, Best Practices & Code Quality]` assesses whether a number lives in one place: the caps are not
  literals here, they are `RoomDTO.NameMaxLength` (255), `RoomDTO.FloorMaxLength` (100),
  `RoomDTO.LocationMaxLength` (255) and `RoomDTO.AccessibilityInfoMaxLength` (500), declared at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Rooms/RoomDTO.cs:16,19,22,25`, the
  lowest layer the domain invariants, the EF configuration and this UI can all reach (`RoomDTO.cs:7-11`).
- **Walkthrough**
  - `NameRequiredKey = "Validation.NameRequired"` (line 31) is a `const` rather than a literal so that
    the model's `[Required]` rule and any field-level `RequiredError` affordance quote the same key
    instead of two copies drifting apart (doc, lines 26-30).
  - `Name` (line 36) is the only mandatory field: `[Required(ErrorMessage = NameRequiredKey)]` plus
    `[MaxLength(RoomDTO.NameMaxLength, ...)]` (lines 34-35), defaulted to `string.Empty` so an unbound
    model still validates rather than null-references.
  - `Sort` (line 39) and `Capacity` (line 42) are plain properties with no attributes. The class doc
    is explicit about why (lines 18-22): DataAnnotations cannot express what they need, but keeping
    them on the model lets one object carry the whole form instead of a parallel set of loose page
    fields. `Capacity` is `int?`, so "unknown capacity" and "zero seats" stay distinguishable.
  - `Floor` (line 46), `Location` (line 50) and `AccessibilityInfo` (line 54) are nullable strings
    carrying only a `[MaxLength]` each, each with its own resource key.
- **Why it's built this way**: a room has one hard rule (it needs a name) and five soft ones (nothing
  may exceed the column width). Encoding that as attributes on a shared base is the cheapest way to
  make the create page and the inline editor provably agree, and it keeps the caps traceable to the
  single constant the persistence layer also uses, so widening a column is one edit, not four.
- **Where it's used**: subclassed by [`RoomCreateModel`](#roomcreatemodel) and
  [`RoomEditModel`](#roomeditmodel); bound as the `Model` parameter of the shared `RoomFormFields`
  component (`.../Pages/Room/RoomFormFields.razor:50`), which both [`RoomCreate`](#roomcreate) and
  [`RoomDetail`](#roomdetail) render.
- **Caveats / not-in-source**: nothing on this model constrains `Sort` or `Capacity` to be
  non-negative. Whether the server rejects a negative capacity is decided by the domain invariants and
  the command validator, not here.

### SponsorFormModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsors/SponsorFormModel.cs:25` · Level 2 · abstract class

- **What it is**: the sponsor equivalent of [`RoomFormModel`](#roomformmodel): one abstract class
  (line 25) holding the ten editable sponsor fields and the DataAnnotations that govern them, shared
  by [`SponsorCreateModel`](#sponsorcreatemodel) and [`SponsorEditModel`](#sponsoreditmodel).
- **Depends on**: [`SponsorDTO`](group-17-conference-domain.md#sponsordto) for every length cap and
  [`SponsorTier`](group-17-conference-domain.md#sponsortier) for the package enum (line 2), plus
  [`AbsoluteUrlAttribute`](group-15-common-ui-framework.md#absoluteurlattribute) from
  `MMCA.Common.UI.Validation` (line 3). Externals: `System.ComponentModel.DataAnnotations` (line 1).
- **Concept introduced, the nullable enum as "not chosen yet".** The shared-form-model pattern itself
  was taught on [`RoomFormModel`](#roomformmodel); what is new here is `Tier`. It is declared
  `SponsorTier?` and `[Required]` (lines 74-75), and the doc comment states the reason plainly (lines
  69-73): `SponsorTier.Platinum` is the enum's zero value, so a non-nullable `SponsorTier Tier` would
  make "the organizer has not picked a package yet" indistinguishable from "the top package", and an
  unmade choice would be silently sold as Platinum. Making the property nullable moves that ambiguity
  into the type system, and `[Required]` turns it into a validation error the organizer sees.
  `[Rubric §24, Forms, Validation & UX Safety]` assesses whether a form can express only legal input:
  a default-valued enum is exactly the class of bug this rules out, and it is a **commercial** field,
  so the failure mode is a wrong invoice rather than a cosmetic one.
  The second new idea is URL validation. Three fields (`LogoUrl` line 46, `WebsiteUrl` line 51,
  `LinkedInUrl` line 56) each carry `[AbsoluteUrl(ErrorMessage = "Error.AbsoluteUrl")]` on top of
  their `[MaxLength]`, from
  [`AbsoluteUrlAttribute`](group-15-common-ui-framework.md#absoluteurlattribute)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Validation/AbsoluteUrlAttribute.cs:26`).
  `[Rubric §26, Front-End Security]` assesses whether untrusted input reaches a rendering or
  navigation surface unchecked: `LogoUrl` is rendered as an image source and `WebsiteUrl` and
  `LinkedInUrl` as outbound links on [`SponsorDetail`](#sponsordetail)
  (`.../Pages/Sponsor/SponsorDetail.razor:59`, `:119`, `:123`), so requiring an absolute URL at entry
  is the first line of defence, and the links themselves carry `rel="noopener noreferrer"`
  (`.../Pages/Sponsor/SponsorDetail.razor:119,123`).
  `[Rubric §27, Internationalization]` applies exactly as on the room model: every `ErrorMessage` is a
  resource key resolved by the page's localizer (doc, lines 16-17,
  [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). Note the key prefix
  differs from the room model's: sponsors use `Error.*` (lines 32, 36, 40) where rooms use
  `Validation.*`.
- **Walkthrough**
  - `NameRequiredKey = "Error.NameRequired"` (line 32) and `TierRequiredKey = "Error.TierRequired"`
    (line 67) are the two required-message keys, named as constants for the same reason as on the room
    model (doc, lines 27-31).
  - `Name` (line 37) is `[Required]` plus `[MaxLength(SponsorDTO.NameMaxLength)]`, 200 characters
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sponsors/SponsorDTO.cs:18`).
  - `Description` (line 41) is capped at `SponsorDTO.DescriptionMaxLength`, 2000 (`SponsorDTO.cs:24`).
  - `LogoUrl` (line 46), `WebsiteUrl` (line 51) and `LinkedInUrl` (line 56) each pair `[AbsoluteUrl]`
    with a 2000-character cap (`SponsorDTO.cs:21,27,30`).
  - `TwitterHandle` (line 60) is a handle, not a URL, so it gets a `[MaxLength]` of 100
    (`SponsorDTO.cs:33`) and deliberately no `[AbsoluteUrl]`.
  - `BoothNumber` (line 64) is capped at 50 (`SponsorDTO.cs:36`).
  - `Tier` (line 75), `Sort` (line 78) and `IsExhibitor` (line 81) close the model out. `Sort` and
    `IsExhibitor` are the attribute-free properties the class doc calls out (lines 19-23).
- **Why it's built this way**: sponsors are the one Conference entity where a wrong field costs money,
  so the model spends its complexity budget on the two fields that can be wrong silently (the tier's
  zero value and a malformed branding URL) and stays plain everywhere else.
- **Where it's used**: subclassed by [`SponsorCreateModel`](#sponsorcreatemodel) and
  [`SponsorEditModel`](#sponsoreditmodel); bound as the `Model` parameter of `SponsorFormFields`
  (`.../Pages/Sponsor/SponsorFormFields.razor:103`), rendered by [`SponsorCreate`](#sponsorcreate) and
  [`SponsorDetail`](#sponsordetail).
- **Caveats / not-in-source**: `TwitterHandle` has no format rule at all, so a full URL pasted into it
  passes validation. What the detail page does with it is render it as text through a localized
  template (`.../Pages/Sponsor/SponsorDetail.razor:127`), not as a link.

### RoomCreateModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Rooms` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Rooms/RoomCreateModel.cs:12` · Level 3 · sealed class

- **What it is**: the create-page binding target. It adds no fields to [`RoomFormModel`](#roomformmodel)
  (line 12), only the one method that turns the entered values into the
  [`RoomDTO`](group-17-conference-domain.md#roomdto) the page posts.
- **Depends on**: [`RoomFormModel`](#roomformmodel) (base),
  [`RoomDTO`](group-17-conference-domain.md#roomdto), and the `EventIdentifierType` alias from
  `MMCA.ADC.Conference.Shared.Events` (line 2). Externals:
  `System.Security.Cryptography.RandomNumberGenerator` (line 1).
- **Concept introduced, the client-minted primary key.** Almost every create page in this codebase
  posts `Id = default` and lets the server mint the key.
  [`SponsorCreateModel`](#sponsorcreatemodel) does exactly that
  (`.../Pages/Sponsor/SponsorCreateModel.cs:22`). Rooms are the exception: `ToNew` fills
  `Id = RandomNumberGenerator.GetInt32(100_000, int.MaxValue)` (line 23). The reason is upstream of
  the UI. Room identity is **app-assigned**, not database-generated, because the `int` primary key
  *is* the Sessionize room id
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Room.cs:11`), which is how an
  imported room keeps a stable identity across refreshes. That id therefore has to come from
  somewhere, and this page supplies it. The value travels intact:
  [`RoomService`](#roomservice)`.AddAsync` maps `dto.Id` onto the request's `RoomId` field
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Rooms/RoomService.cs:27`), the
  controller passes `request.RoomId` into
  [`AddRoomCommand`](group-18-conference-application.md#addroomcommand)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/RoomsController.cs:211-213`),
  and [`AddRoomHandler`](group-18-conference-application.md#addroomhandler) respects an explicit id,
  auto-allocating one only when `command.RoomId is null`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddRoom/AddRoomHandler.cs:122-145`).
  `[Rubric §8, Data Architecture]` assesses how identity is allocated and whether it stays stable:
  this is a deliberate trade of database-generated keys for import-stable ones, and the UI pays for it
  by having to mint a key itself.
- **Walkthrough**
  - `ToNew(EventIdentifierType eventId)` (lines 20-31) is an expression-bodied factory returning a
    fresh [`RoomDTO`](group-17-conference-domain.md#roomdto). Every editable property is copied
    straight off the base (lines 24, 26-30).
  - `EventId = eventId` (line 25) comes in as a parameter rather than living on the model: the owning
    event is picked on the page and never changed afterwards, so it is not a form field (class doc,
    lines 8-10).
- **Why it's built this way**: keeping the create-only concern (build the posted DTO, stamp the owning
  event) on the create model and every shared field on the base is what lets
  [`RoomEditModel`](#roomeditmodel) reuse the rules without inheriting a `ToNew` it must not call.
- **Where it's used**: instantiated once as `_model` on [`RoomCreate`](#roomcreate)
  (`.../Pages/Room/RoomCreate.razor.cs:24`) and consumed in `CreateRoomAsync`
  (`.../Pages/Room/RoomCreate.razor.cs:84`).
- **Caveats / not-in-source**: `RandomNumberGenerator.GetInt32(100_000, int.MaxValue)` draws from a
  range that does **not** overlap the reserved organizer-created range
  `EventInvariants.RoomManualIdRangeStart` to `RoomManualIdRangeEnd` (999_999_000 to 999_999_999,
  [`EventInvariants`](group-17-conference-domain.md#eventinvariants) at
  `.../MMCA.ADC.Conference.Domain/Events/EventInvariants.cs:65,68`), which is the range
  [`RoomSyncStrategy`](group-18-conference-application.md#roomsyncstrategy) skips when a Sessionize
  feed reuses an id (`.../Events/UseCases/RefreshFromSessionize/RoomSyncStrategy.cs:95-97`). A room
  created through this page therefore sits outside that protection. Whether that has ever produced a
  collision is not determinable from source.

### RoomEditModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Rooms` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Rooms/RoomEditModel.cs:11` · Level 3 · sealed class

- **What it is**: the binding target for the inline editor on [`RoomDetail`](#roomdetail). Like its
  create sibling it adds no fields to [`RoomFormModel`](#roomformmodel) (line 11), only the two methods
  that move values between the loaded room and the form.
- **Depends on**: [`RoomFormModel`](#roomformmodel) (base) and
  [`RoomDTO`](group-17-conference-domain.md#roomdto) (line 1). No externals beyond
  `ArgumentNullException`.
- **Concept introduced, load-then-project as the edit contract.** A create model needs one direction
  (form to DTO); an edit model needs both, and the pair is deliberately asymmetric about which fields
  survive. `LoadFrom` copies only editable values in; `ToUpdated` puts the edited values back over the
  identity and the owning event **taken from the originally loaded DTO**, never from the form. That is
  what makes "the event is displayed but never edited here" (class doc, lines 8-9) structurally true
  rather than a UI convention: there is no path by which a form field could change `EventId`.
  `[Rubric §24, Forms, Validation & UX Safety]` assesses whether a form can express only legal input:
  moving a room between events is defined as a create plus a delete (doc, lines 8-9), so the edit model
  simply cannot express the illegal operation.
- **Walkthrough**
  - `LoadFrom(RoomDTO room)` (lines 15-25) null-guards with `ArgumentNullException.ThrowIfNull`
    (line 17), then assigns the six editable properties (lines 19-24). It does not touch `Id` or
    `EventId`, because the model has no such properties.
  - `ToUpdated(RoomDTO room)` (lines 33-48) null-guards again (line 35) and returns a new
    [`RoomDTO`](group-17-conference-domain.md#roomdto) whose `Id` (line 39) and `EventId` (line 41)
    come from the passed-in loaded room while everything else comes from the form (lines 40, 42-46).
  - Note what is absent: no `RowVersion`. [`RoomDTO`](group-17-conference-domain.md#roomdto) does not
    implement `IConcurrencyAware` and declares no such property
    (`.../MMCA.ADC.Conference.Shared/Events/RoomDTO.cs:13-49`), unlike
    [`SponsorDTO`](group-17-conference-domain.md#sponsordto)
    (`.../MMCA.ADC.Conference.Shared/Sponsors/SponsorDTO.cs:15,42`).
    [`SponsorEditModel`](#sponsoreditmodel) carries the token; this one has nothing to carry.
- **Why it's built this way**: the DTO is a `record class` with `init`-only members
  (`RoomDTO.cs:13,28`), so "edit" cannot mean mutating the loaded object. Projecting a new DTO from the
  form over the loaded identity is the shape immutability forces, and it makes the set of fields an
  edit is allowed to change readable at a glance.
- **Where it's used**: instantiated once as `_model` on [`RoomDetail`](#roomdetail)
  (`.../Pages/Room/RoomDetail.razor.cs:51`); `LoadFrom` runs in `StartEditing`
  (`.../Pages/Room/RoomDetail.razor.cs:119`) and `ToUpdated` in `SaveChangesAsync`
  (`.../Pages/Room/RoomDetail.razor.cs:147`).

### SponsorCreateModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsors/SponsorCreateModel.cs:11` · Level 3 · sealed class

- **What it is**: the create-page binding target for sponsors. It adds one method to
  [`SponsorFormModel`](#sponsorformmodel) (line 11) and no fields.
- **Depends on**: [`SponsorFormModel`](#sponsorformmodel) (base),
  [`SponsorDTO`](group-17-conference-domain.md#sponsordto) and the `EventIdentifierType` alias (line 1).
- **Concept introduced**: none new. This is the create half of the load-then-project pair taught on
  [`RoomCreateModel`](#roomcreatemodel), with the server-minted-key variant rather than the
  client-minted one.
- **Walkthrough**
  - `ToNew(EventIdentifierType eventId)` (lines 19-36) returns a fresh
    [`SponsorDTO`](group-17-conference-domain.md#sponsordto).
  - `Id = default` (line 22): unlike rooms, sponsor ids are server-allocated, so the page posts a
    placeholder and reads the real key back off the response
    (`.../Pages/Sponsor/SponsorCreate.razor.cs:113` navigates to `created.Id`).
  - `Tier = Tier!.Value` (line 26) is the one null-forgiving operator on the model, and the in-code
    comment above it states the justification: the form's `[Required]` rule gates the submit, so a
    validated model always carries a tier (line 25, rule at `.../Pages/Sponsor/SponsorFormModel.cs:74`).
  - `EventId = eventId` (line 33) arrives as a parameter for the same reason as on rooms: the owning
    event is chosen on the page and fixed thereafter (doc, lines 14-15).
- **Why it's built this way**: the tier opens unset on purpose (class doc, lines 8-9), because it is a
  paid package and inheriting the enum's zero value would sell Platinum by accident. The nullable
  property is the mechanism; this factory is where the nullability is discharged, once, at the point
  the form has already been validated.
- **Where it's used**: instantiated as `_model` on [`SponsorCreate`](#sponsorcreate)
  (`.../Pages/Sponsor/SponsorCreate.razor.cs:76`), consumed in `CreateSponsorAsync`
  (`.../Pages/Sponsor/SponsorCreate.razor.cs:104`).
- **Caveats / not-in-source**: the `!` on line 26 is only as safe as the caller's validation.
  `CreateSponsorAsync` does check both `_form.IsValid` and `_eventId is null` before calling
  (`.../Pages/Sponsor/SponsorCreate.razor.cs:95`), but nothing on this type enforces that contract.

### SponsorEditModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsors/SponsorEditModel.cs:12` · Level 3 · sealed class

- **What it is**: the binding target for the inline editor on [`SponsorDetail`](#sponsordetail), adding
  `LoadFrom` and `ToUpdated` to [`SponsorFormModel`](#sponsorformmodel) (line 12).
- **Depends on**: [`SponsorFormModel`](#sponsorformmodel) (base) and
  [`SponsorDTO`](group-17-conference-domain.md#sponsordto) (line 1).
- **Concept introduced, carrying the concurrency token through the round trip.** The load-then-project
  shape itself was taught on [`RoomEditModel`](#roomeditmodel). The difference here is line 45:
  `RowVersion = sponsor.RowVersion`. [`SponsorDTO`](group-17-conference-domain.md#sponsordto)
  implements `IConcurrencyAware` and carries a `byte[] RowVersion`
  (`.../MMCA.ADC.Conference.Shared/Sponsors/SponsorDTO.cs:15,42`), so the token the page loaded must
  survive back to the server for optimistic-concurrency checking to mean anything. Notice that
  `RowVersion` is **not** a property on [`SponsorFormModel`](#sponsorformmodel): it is never bound to a
  control and never editable, it is simply threaded from the loaded DTO through the projection.
  `[Rubric §8, Data Architecture]` assesses concurrency control: an edit form that dropped the token
  would turn every save into a last-writer-wins overwrite, silently. Keeping the token off the form
  model and on the projection is what makes dropping it impossible by construction.
- **Walkthrough**
  - `LoadFrom(SponsorDTO sponsor)` (lines 16-30) null-guards (line 18) and copies the ten editable
    values, including `Tier = sponsor.Tier` (line 21), which widens the non-nullable DTO enum into the
    model's nullable one.
  - `ToUpdated(SponsorDTO sponsor)` (lines 38-60) null-guards (line 40) and projects a new DTO: `Id`
    (line 44), `RowVersion` (line 45) and `EventId` (line 56) from the loaded sponsor, everything else
    from the form (lines 46-55, 57-58).
  - `Tier = Tier!.Value` (line 49) discharges the nullability exactly as the create model does, with
    the same comment naming the `[Required]` rule that guarantees it (line 48).
- **Why it's built this way**: the owning event is absent from the editable set for the same reason as
  on rooms (moving a sponsorship between events is a create plus a delete, doc lines 8-10), and the
  three carried-through values (identity, token, event) are exactly the three a UI must not be able to
  change.
- **Where it's used**: instantiated as `_model` on [`SponsorDetail`](#sponsordetail)
  (`.../Pages/Sponsor/SponsorDetail.razor.cs:64`); `LoadFrom` in `StartEditing`
  (`.../Pages/Sponsor/SponsorDetail.razor.cs:132`), `ToUpdated` in `SaveChangesAsync`
  (`.../Pages/Sponsor/SponsorDetail.razor.cs:160`).

### RoomCreate

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Rooms` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Rooms/RoomCreate.razor.cs:12` · Level 6 · class (Blazor code-behind)

- **What it is**: the organizer form that adds a room to an event's venue. It collects the name, the
  owning event, the display order, an optional capacity, floor, location and accessibility note, then
  posts one [`RoomDTO`](group-17-conference-domain.md#roomdto) and routes to the new room's detail
  page. The route is `/rooms/create` and it is `Authorize(Roles = "Organizer")`
  (`.../Pages/Room/RoomCreate.razor:1-2`).
- **Depends on**: [`IRoomUIService`](#iroomuiservice) (line 13),
  [`IEventLookupService`](#ieventlookupservice) returning [`EventInfo`](#eventinfo) (lines 14, 27),
  [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 16),
  [`ConferenceRoutePaths`](#conferenceroutepaths) (lines 41, 93, 105),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 77),
  [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) and
  [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator)
  (line 46), and [`RoomCreateModel`](#roomcreatemodel) (line 24). Externals: Blazor (`[Inject]`,
  `NavigationManager`), MudBlazor (`MudForm`, `BreadcrumbItem`, `Icons`), and the
  `IStringLocalizer<RoomCreate>` injected by the template (`.../Pages/Room/RoomCreate.razor:6`).
  The markup also uses `UnsavedChangesGuard` and `ErrorSummary` from `MMCA.Common.UI.Components`
  (`.../Pages/Room/RoomCreate.razor:10`, `:33-34`) and the ADC-local `RoomFormFields`
  (`.../Pages/Room/RoomCreate.razor:22-25`).
- **Concept introduced, the shared field block plus the shared validation delegate.** The form model
  taught the "declare the rules once" half; this page shows the other half at work. The page owns no
  markup for the fields at all: it renders `RoomFormFields` inside a `MudForm`
  (`.../Pages/Room/RoomCreate.razor:21-26`), passes the model, the delegate and the localizer, and
  that same component is rendered by [`RoomDetail`](#roomdetail)'s editor
  (`.../Pages/Room/RoomDetail.razor:31-32`). The delegate itself is one field on the page,
  `Func<object, string, IEnumerable<string>> _validate` (line 32), built at line 46 from the model and
  a localizing validator. MudBlazor calls it with `(model, memberPath)` and the model's own
  DataAnnotations decide the outcome, which the in-code comment states directly (lines 30-31).
  `[Rubric §18, UI Architecture]` assesses whether presentation is decomposed so that a change lands in
  one place: the create page and the edit page share the fields, the rules and the localizer wiring,
  and differ only in whether the event picker is offered.
  `[Rubric §24, Forms, Validation & UX Safety]` also applies twice over here. The submit path validates
  before it posts (lines 74-79) and reports with a localized toast rather than a silent no-op, and
  `_isDirty` (lines 28, 34) drives `UnsavedChangesGuard` (`.../Pages/Room/RoomCreate.razor:10`) so
  navigating away mid-edit prompts. The flag is cleared **before** the navigation on success (line 91,
  with a comment saying so), which is what stops the guard from firing on the page's own redirect.
- **Walkthrough**
  - `OnInitializedAsync` (lines 36-65) builds the three breadcrumbs (Home, Rooms, Create, with the last
    `disabled: true` so it renders as the current page, lines 38-43), then builds the validation
    delegate (line 46, with the ADR-027 comment at line 45).
  - It then loads the event lookup through the cancellable `_cts.Token` (line 50). A failed lookup is
    **fatal to initialization** here: it toasts `Snackbar.LoadEventsFailed` and returns (lines 52-53).
    Contrast [`SponsorCreate`](#sponsorcreate), which treats the same failure as non-critical.
  - The default-event rule is the simple one: `if (_eventLookup.Count == 1)` pick that event
    (lines 56-59). There is no current-or-next resolution on this page, unlike
    [`SponsorCreate`](#sponsorcreate) (`.../Pages/Sponsor/SponsorCreate.razor.cs:58-65`).
  - The picker is only rendered when there is a real choice: `ShowEventPicker` is bound to
    `_eventLookup is not null && _eventLookup.Count > 1` (`.../Pages/Room/RoomCreate.razor:24`), so a
    single-event deployment never shows a one-option dropdown.
  - `CreateRoomAsync` (lines 67-103) returns early if the form reference is null (lines 69-72), awaits
    `_form.ValidateAsync()` and toasts `ErrorMessages.ValidationError` on failure (lines 74-79), then
    sets `IsSaving` (line 81) and posts `_model.ToNew(_eventId)` through
    [`IRoomUIService`](#iroomuiservice)`.AddAsync` (line 84). A failed
    [`Result`](group-01-result-error-handling.md#result) toasts `Snackbar.SaveFailed` (lines 85-89);
    success clears the dirty flag, toasts, and navigates to
    `ConferenceRoutePaths.RoomDetails(createdRoom.Id)` (lines 91-93).
  - `OperationCanceledException` is swallowed in both async methods as expected during disposal or an
    `InteractiveAuto` render-mode transition (lines 61-64, 95-98; see
    [ADR-056](https://ivanball.github.io/docs/adr/056-blazor-render-mode-strategy.html)).
    `IsSaving` is cleared in the `finally` (lines 99-102), which re-enables the submit button after a
    failure.
  - `NavigateToList` (line 105) and the `_disposed`-guarded `Dispose(bool)` / `Dispose` pair
    (lines 107-129) close the page out: the `_cts` is cancelled and disposed exactly once.
- **Why it's built this way**: a room is a small entity with one required field, so the page carries no
  cross-field rules and no staged workflow. What it does carry is the two pieces of discipline every
  create page in this group carries: a cancellation token tied to component lifetime, and a dirty flag
  that is cleared only on a successful save.
- **Where it's used**: reached from [`RoomList`](#roomlist)'s create button
  (`.../Pages/Room/RoomList.razor.cs:90`); on success it hands off to [`RoomDetail`](#roomdetail).
- **Caveats / not-in-source**: the client-minted room id discussed on
  [`RoomCreateModel`](#roomcreatemodel) is produced inside `ToNew`, so this page never sees or
  validates it.

### RoomDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Rooms` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Rooms/RoomDetail.razor.cs:16` · Level 8 · class (Blazor code-behind)

- **What it is**: the organizer's single-room page at `/rooms/{Id}`
  (`.../Pages/Room/RoomDetail.razor:1`, `Authorize(Roles = "Organizer")` at `:2`). It loads one room,
  renders it read-only, flips into an inline editor bound to [`RoomEditModel`](#roomeditmodel), deletes
  behind a confirmation dialog, and exposes the room's door check-in QR code.
- **Depends on**: [`IRoomUIService`](#iroomuiservice) (line 19),
  [`IEventLookupService`](#ieventlookupservice) (line 20),
  [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 22),
  [`RoomEditModel`](#roomeditmodel) (line 51), [`RoomDTO`](group-17-conference-domain.md#roomdto)
  (line 46), [`ConferenceRoutePaths`](#conferenceroutepaths) (lines 37, 207 and
  `.../Pages/Room/RoomDetail.razor:58`),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (lines 79, 140),
  [`ResultUiExtensions`](group-15-common-ui-framework.md#resultuiextensions) for `IsNotFound` and
  `NotifyOnFailure` (lines 76, 85, 94, 150), and
  [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) (line 42). Externals: Blazor
  (`[Parameter]`, `NavigationManager`), MudBlazor (`MudForm`, `MudSimpleTable`, `BreadcrumbItem`),
  `System.Globalization.CultureInfo` (line 110). The markup composes `PageLoadingState`,
  `PageErrorState`, `ErrorSummary`, `UnsavedChangesGuard`, `QrCodeButton` and `DeleteConfirmation` from
  `MMCA.Common.UI.Components` (`.../Pages/Room/RoomDetail.razor:9,16,20,40,58,90`).
- **Concept introduced, the three-state detail page and the string route parameter.** The template is a
  single `if / else if / else` chain over three page states: loading, not-found, and loaded, with the
  loaded state further split by `_isEditing` (`.../Pages/Room/RoomDetail.razor:14,18,22,50`). That
  chain is why the page never renders a half-populated card.
  The genuinely new mechanic on this page is how the route id is handled. `Id` is declared
  `[Parameter] public string Id` (line 24), not an `int`, and the route is the untyped `/rooms/{Id}`
  (`.../Pages/Room/RoomDetail.razor:1`). The code-behind converts it itself with
  `Id.Parse<RoomIdentifierType>()` (line 74), an extension from `MMCA.Common.Shared.Extensions`
  (line 5). [`SponsorDetail`](#sponsordetail) takes the opposite approach with a constrained
  `{Id:int}` route and an `int` parameter (`.../Pages/Sponsor/SponsorDetail.razor:1`,
  `.../Pages/Sponsor/SponsorDetail.razor.cs:27`), so both idioms are live in this group.
  The reload guard is worth internalizing: `OnParametersSetAsync` returns immediately when
  `Id == _loadedId` (lines 65-68). Blazor calls `OnParametersSetAsync` on every parameter set, not only
  on navigation, so without this guard an unrelated re-render would refetch the room.
  `[Rubric §19, State Management]` assesses whether component state is fetched once and invalidated
  deliberately: `_loadedId` is the invalidation key, and `_events` is fetched only when still null
  (line 93), so switching rooms does not refetch the event lookup.
  `[Rubric §24, Forms, Validation & UX Safety]` shows up in the edit lifecycle: `StartEditing` seeds the
  model from the loaded room and resets `_isDirty` (lines 119-121), `CancelEditing` drops the edit
  without touching `Room` (lines 124-128), and a successful save re-reads the room from the server
  before leaving edit mode (lines 154-164) rather than trusting the local projection.
- **Walkthrough**
  - `OnInitialized` (lines 31-43) builds the breadcrumbs synchronously and constructs the shared
    validation delegate (line 42), the same one-line wiring [`RoomCreate`](#roomcreate) uses.
  - `OnParametersSetAsync` (lines 63-107) sets `_loadedId`, flips `IsLoading`, parses the id (line 74)
    and fetches through [`IRoomUIService`](#iroomuiservice)`.GetByIdAsync` (line 75). A
    [`Result`](group-01-result-error-handling.md#result) carrying `NotFound` is handled distinctly from
    any other failure: it nulls `Room` and toasts `ErrorMessages.NotFound(EntityName, Id)`
    (lines 76-81), which is what makes the template's `PageErrorState` branch
    (`.../Pages/Room/RoomDetail.razor:18-21`) reachable. Every other failure goes through
    `NotifyOnFailure` (line 85).
  - The event lookup is loaded once, lazily, only after the room is in hand (lines 93-97). The in-code
    comment (lines 91-92) notes that a failed lookup is reported and stops the load, which is the same
    behavior an exception used to produce. `IsLoading` is always cleared in the `finally`
    (lines 103-106).
  - `GetEventName` (lines 109-110) resolves an event's display name from the lookup, falling back to
    the raw id under `CultureInfo.InvariantCulture`. The template only renders the event row when there
    is more than one event to distinguish (`.../Pages/Room/RoomDetail.razor:68-71`).
  - `SaveChangesAsync` (lines 130-174) validates the form (lines 137-142), posts
    `_model.ToUpdated(Room)` through `UpdateAsync` (line 147), then **re-fetches** the room (line 154)
    and swaps `Room` for the refreshed instance before toasting and leaving edit mode
    (lines 161-164). `IsSaving` is cleared in the `finally` (lines 170-173).
  - `DeleteRoomAsync` (lines 176-205) awaits `_deleteConfirm.ShowAsync(Room.Name)` and treats anything
    other than `true` as a cancel (lines 183-187), then calls
    [`IRoomUIService`](#iroomuiservice)`.DeleteAsync(Room.Id, _cts.Token)` (line 191), toasts and
    navigates back to the list.
  - The `_disposed`-guarded dispose pair (lines 209-231) cancels and disposes the `_cts` once.
- **Why it's built this way**: an inline editor on the same page as the read-only record keeps the
  organizer's context (they are looking at the room they are changing) and lets one component,
  `RoomFormFields`, serve both create and edit. Re-fetching after a successful update is the honest
  choice: the server may have normalized values, and the page then shows what was actually stored.
- **Where it's used**: it is the navigation target of [`RoomCreate`](#roomcreate) on success
  (`.../Pages/Room/RoomCreate.razor.cs:93`) and of every row link and mobile card on
  [`RoomList`](#roomlist) (`.../Pages/Room/RoomList.razor.cs:77`,
  `.../Pages/Room/RoomList.razor:85`). Its `QrCodeButton` points at
  `ConferenceRoutePaths.RoomCheckInLink(Room.Id)` (`.../Pages/Room/RoomDetail.razor:58`), which
  resolves to the Engagement-owned `/engage/rooms/{id}` landing page
  (`.../MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:61`), so the printed code takes an attendee to
  self check-in rather than to this management screen.
- **Caveats / not-in-source**: the delete call at line 191 binds the **base**
  `IEntityService.DeleteAsync(id, cancellationToken)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IEntityService.cs:66-68`), whose
  implementation issues `DELETE rooms/{id}` with no query string
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:203-215`). It does not
  bind the ADC-specific overload that appends `?eventId=` (`.../Services/IRoomUIService.cs:13`,
  `.../Services/RoomService.cs:40-44`), which is what [`RoomList`](#roomlist) calls
  (`.../Pages/Room/RoomList.razor.cs:84`). The API's delete route declares
  `[FromQuery] EventIdentifierType eventId`
  (`.../MMCA.ADC.Conference.API/Controllers/RoomsController.cs:259-262`). What the server returns for a
  delete that omits it is not determinable from this source alone.

### SponsorCreate

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsors/SponsorCreate.razor.cs:18` · Level 9 · class (Blazor code-behind)

- **What it is**: the organizer form that records a sold sponsorship at `/sponsors/create`
  (`.../Pages/Sponsor/SponsorCreate.razor:1-2`, `Authorize(Roles = "Organizer")`). It collects the
  sponsor name, tier, owning event, branding links and the optional expo booth details, and the class
  doc is explicit that the event picker is required because sponsorships are sold per event and the
  owning event cannot be changed afterwards (lines 12-16).
- **Depends on**: [`ISponsorUIService`](#isponsoruiservice) (line 19),
  [`IEventLookupService`](#ieventlookupservice) with [`EventInfo`](#eventinfo) (lines 20, 75),
  [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 22),
  [`SponsorCreateModel`](#sponsorcreatemodel) (line 76),
  [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (line 60),
  [`ConferenceRoutePaths`](#conferenceroutepaths) (lines 35, 113, 125),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 97), and
  [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) with
  [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator)
  (line 40). Externals: Blazor, MudBlazor (`MudForm`, `BreadcrumbItem`), and the
  `IStringLocalizer<SponsorCreate>` from the template (`.../Pages/Sponsor/SponsorCreate.razor:6`).
- **Concept introduced, the split initialization and the smart event default.** This page uses **both**
  lifecycle hooks deliberately. `OnInitialized` (lines 29-41) does the synchronous work (breadcrumbs,
  validation delegate) so the first render already has them, and `OnInitializedAsync` (lines 43-71)
  does the network work. The pattern matters because the async hook runs after the first render and the
  page must not be blank or unvalidatable in between.
  The default-event rule is the richer of the two idioms in this group. Rather than auto-selecting only
  when exactly one event exists (which is what [`RoomCreate`](#roomcreate) does at
  `.../Pages/Room/RoomCreate.razor.cs:56-59`), it calls
  [`CurrentEventSelector.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventselector) over
  each event's start date, end date and IANA time zone against `DateTime.UtcNow` (lines 58-65), so the
  picker opens on the conference the organizer is most likely selling against. The `??=` (line 58)
  means a value the organizer already picked is never overwritten, and the picker stays open for the
  rest (`ShowEventPicker="true"`, `.../Pages/Sponsor/SponsorCreate.razor:28`).
  The failure policy also differs from [`RoomCreate`](#roomcreate): a failed lookup here is
  **non-critical** and silently leaves the picker empty, because the required-field error then guides
  the user (in-code comment, lines 49-50). Only a genuinely unusable form is escalated to a toast.
  `[Rubric §24, Forms, Validation & UX Safety]` assesses whether a form makes the common case cheap
  without hiding a field: the default is a pre-selection, not a lock, and the submit still re-checks
  `_eventId is null` alongside `_form.IsValid` (line 95) so a cleared picker cannot post.
  `[Rubric §19, State Management]` assesses ownership of transient state: `_isDirty` (line 79) is the
  page's only cross-cutting flag, set by `MarkDirty` (line 85) which `SponsorFormFields` invokes
  through its `OnFieldChanged` callback (`.../Pages/Sponsor/SponsorCreate.razor:25`).
- **Walkthrough**
  - `OnInitialized` (lines 29-41): breadcrumbs Home, Sponsors, Create with the last `disabled: true`
    (lines 32-37), then the validation delegate (line 40, ADR-027 comment at line 39).
  - `OnInitializedAsync` (lines 43-71): awaits `base.OnInitializedAsync()` (line 45), loads the event
    lookup through `_cts.Token` (line 51), then resolves the default (lines 58-65).
    `OperationCanceledException` is swallowed (lines 67-70).
  - `CreateSponsorAsync` (lines 87-123): null-guards `_form` (lines 89-92), validates and re-checks the
    event (lines 94-99), sets `IsSaving` (line 101), posts `_model.ToNew(_eventId.Value)` through
    `AddAsync` (line 104), toasts `Snackbar.SaveFailed` on a failed
    [`Result`](group-01-result-error-handling.md#result) (lines 105-109), and on success clears
    `_isDirty` before navigating (line 111, with the comment), toasts, and routes to
    `ConferenceRoutePaths.SponsorDetails(created.Id)` (line 113). `IsSaving` is cleared in the `finally`
    (lines 119-122).
  - `NavigateToList` (line 125) and the `_disposed`-guarded dispose pair (lines 127-149) close the page
    out.
  - The template passes two extra localized strings into the shared field block, `LinksHeading` and
    `TwitterPlaceholder` (`.../Pages/Sponsor/SponsorCreate.razor:26-27`), which is how one
    `SponsorFormFields` component (`.../Pages/Sponsor/SponsorFormFields.razor:120,123`) serves both
    this page and the detail editor without either owning the copy.
- **Why it's built this way**: a sponsorship is sold against one event and the tier is a paid package,
  so the page's whole design goal is to make the event obvious and the tier explicit. Defaulting the
  event removes the most common click; leaving the tier unset (see
  [`SponsorFormModel`](#sponsorformmodel)) forces the one choice that must not be inherited.
- **Where it's used**: reached from [`SponsorList`](#sponsorlist)'s create button
  (`.../Pages/Sponsor/SponsorList.razor.cs:98`); on success it hands off to
  [`SponsorDetail`](#sponsordetail).

### SponsorDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsors/SponsorDetail.razor.cs:19` · Level 9 · class (Blazor code-behind)

- **What it is**: the organizer's sponsor record page at `/sponsors/{Id:int}`
  (`.../Pages/Sponsor/SponsorDetail.razor:1-2`, Organizer-only). It loads one sponsor, renders it as a
  branded card, inline-edits every field except the owning event, deletes behind a confirmation, and
  exposes the booth-visit QR code. The class doc states the event exclusion and its reason (lines
  13-17).
- **Depends on**: [`ISponsorUIService`](#isponsoruiservice) (line 22),
  [`IEventLookupService`](#ieventlookupservice) (line 23),
  [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 25),
  [`SponsorEditModel`](#sponsoreditmodel) (line 64),
  [`SponsorDTO`](group-17-conference-domain.md#sponsordto) (line 59),
  [`SponsorTier`](group-17-conference-domain.md#sponsortier) (line 35),
  [`ConferenceRoutePaths`](#conferenceroutepaths) (lines 49, 220 and
  `.../Pages/Sponsor/SponsorDetail.razor:70`),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (lines 95, 153),
  [`ResultUiExtensions`](group-15-common-ui-framework.md#resultuiextensions) (lines 92, 101, 110, 163),
  and [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) (line 54). Externals: Blazor,
  MudBlazor (`MudForm`, `MudAvatar`, `MudImage`, `MudSimpleTable`, `MudDivider`, `MudLink`),
  `System.Globalization.CultureInfo` (lines 41, 95).
- **Concept introduced, localized enum rendering by convention.** `TierLabel(SponsorTier tier)` (line
  35) is a one-liner: `L[$"Tier.{tier}"].Value`. The enum member's name is interpolated into a resource
  key, so adding a tier means adding a resource entry, not a `switch`. The same helper appears on
  [`SponsorList`](#sponsorlist) (`.../Pages/Sponsor/SponsorList.razor.cs:36`).
  `[Rubric §27, Internationalization]` assesses whether every user-visible string is externalized: this
  is the pattern that keeps enums from leaking English identifiers into the UI.
  The second idea, contrasted against [`RoomDetail`](#roomdetail), is the **typed route parameter**.
  `[Parameter] public int Id` (line 27) plus the `{Id:int}` route constraint
  (`.../Pages/Sponsor/SponsorDetail.razor:1`) pushes the conversion into the router, so the page has no
  parse step and a non-numeric URL never reaches this component. The same `_loadedId` reload guard
  applies (lines 57, 77-83), just typed `int?`.
  `[Rubric §26, Front-End Security]` assesses outbound-link handling: the two sponsor URLs render as
  `MudLink` with `Target="_blank"` and `rel="noopener noreferrer"`
  (`.../Pages/Sponsor/SponsorDetail.razor:119,123`), and the whole links block is only rendered when at
  least one of the three link fields has content (`:110-112`).
  `[Rubric §21, Accessibility]` assesses whether structure and labelling carry meaning to assistive
  technology: the detail table uses `<th scope="row">` for its labels rather than bold `<td>`
  (`.../Pages/Sponsor/SponsorDetail.razor:85,89,93`), the logo image gets `Alt="@Sponsor.Name"` (`:59`),
  and both header icon buttons carry `aria-label` (`:72-73`).
- **Walkthrough**
  - `EntityName` (line 20) and `Title` (line 30) are localizer lookups; `EventName` (lines 38-41)
    resolves the owning event's display name from the lookup and falls back to the invariant-formatted
    id.
  - `OnInitialized` (lines 43-55) builds the breadcrumbs and the validation delegate (line 54).
  - `OnParametersSetAsync` (lines 75-84) is a thin reload guard delegating to `LoadAsync`.
  - `LoadAsync` (lines 86-123) fetches with `GetByIdAsync(Id, true, _cts.Token)` (line 91). Note the
    second argument: `includeChildren: true`, which [`RoomDetail`](#roomdetail) does not request
    (`.../Pages/Room/RoomDetail.razor.cs:75` passes the token by name and leaves the flag defaulted).
    A `NotFound` [`Result`](group-01-result-error-handling.md#result) nulls `Sponsor` and toasts
    (lines 92-97); any other failure goes through `NotifyOnFailure` (line 101). The event lookup is
    then loaded once, lazily (lines 109-113), and `IsLoading` is cleared in the `finally`
    (lines 119-122).
  - `StartEditing` (lines 125-135) seeds [`SponsorEditModel`](#sponsoreditmodel) from the loaded
    sponsor and resets `_isDirty`; `CancelEditing` (lines 137-141) drops the edit without touching
    `Sponsor`.
  - `SaveChangesAsync` (lines 143-187) validates (lines 150-155), posts `_model.ToUpdated(Sponsor)`
    (line 160), re-fetches with `includeChildren: true` (line 167), swaps `Sponsor` for the refreshed
    instance and leaves edit mode (lines 174-177). Because
    [`SponsorEditModel`](#sponsoreditmodel) carries `RowVersion` through the projection, this is the
    round trip that keeps optimistic concurrency meaningful.
  - `DeleteSponsorAsync` (lines 189-218) confirms through `_deleteConfirm.ShowAsync(Sponsor.Name)`
    (line 196), deletes (line 204), toasts and returns to the list.
  - The read-only card renders the logo as a `MudAvatar` when present (`:57-60`), the name and localized
    tier (`:62-63`), then a compact table of event, sort and exhibitor status, where the exhibitor row
    picks between three localized strings depending on whether the sponsor exhibits and whether a booth
    number is known (`:95-99`).
- **Why it's built this way**: the sponsor record is the one Conference screen an organizer shows to a
  paying customer, so it renders branding (logo, name, tier) before administrative fields, and it hides
  empty sections entirely rather than showing blank rows.
- **Where it's used**: the navigation target of [`SponsorCreate`](#sponsorcreate)
  (`.../Pages/Sponsor/SponsorCreate.razor.cs:113`) and of [`SponsorList`](#sponsorlist)
  (`.../Pages/Sponsor/SponsorList.razor.cs:99`). Its `QrCodeButton` points at
  `ConferenceRoutePaths.SponsorVisitLink(Sponsor.Id)` (`.../Pages/Sponsor/SponsorDetail.razor:70`),
  which resolves to the Engagement-owned `/engage/sponsors/{id}` landing page
  (`.../MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:60`), so the printed booth code takes an attendee
  to the visit flow, not to this management screen.
- **Caveats / not-in-source**: what `includeChildren: true` actually pulls back for a sponsor is decided
  by the API's read model, not by this page.

### RoomList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Rooms` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Rooms/RoomList.razor.cs:13` · Level 10 · class (Blazor code-behind)

- **What it is**: the organizer's room index at `/rooms` (`.../Pages/Room/RoomList.razor:1-2`,
  Organizer-only): a server-paged, sortable, filterable grid on desktop and an infinite-scroll card
  list on mobile, with a debounced name search and an event filter.
- **Depends on**: [`EventFilteredListPageBase<TDto>`](#eventfilteredlistpagebasetdto) as its base
  (line 12), [`IRoomUIService`](#iroomuiservice) (line 17),
  [`ListPageActions`](group-15-common-ui-framework.md#listpageactions) (lines 36, 81),
  [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem)
  (line 25), [`ConferenceRoutePaths`](#conferenceroutepaths) (lines 77, 90),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 87),
  [`Result`](group-01-result-error-handling.md#result) (line 67) and
  [`RoomDTO`](group-17-conference-domain.md#roomdto). Externals: MudBlazor (`MudDataGrid`,
  `GridState`, `GridData`), Blazor `NavigationManager`.
- **Concept introduced**: none new at the page level. The event-scoped list machinery lives in
  [`EventFilteredListPageBase<TDto>`](#eventfilteredlistpagebasetdto)
  (`.../Pages/Common/EventFilteredListPageBase.cs:25`), which sits on
  [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto). This page is
  worth reading as the **minimal** derivation: it overrides only the three hooks the base declares
  abstract or virtual for page-specific state, and inherits everything else.
  `[Rubric §1, SOLID]` assesses whether a base class exposes the right extension points: the three
  overrides here (`SavePageFilters`, `RestorePageFilters`, `ReloadForEventFilterAsync`, lines 29, 32,
  38) plus `GridRef` (line 21) and `Title` (line 15) are the entire contract, and everything else the
  page needs (the event lookup, the persisted `eventId` filter, the current-or-next default) comes for
  free.
  `[Rubric §22, Responsive and Cross-Browser]` assesses whether the layout adapts rather than shrinks:
  the template branches on `IsMobile` between a card list and a grid
  (`.../Pages/Room/RoomList.razor:39,70`), and within the grid three columns carry
  `HeaderClass="hide-below-desktop" CellClass="hide-below-desktop"` (`:104,114,124`), so capacity, floor
  and location drop out on narrow viewports instead of forcing a horizontal scroll.
  `[Rubric §23, Front-End Performance]` assesses payload and round-trip discipline: paging, sorting and
  filtering are all server-side (`ServerData="LoadServerData"`, `.../Pages/Room/RoomList.razor:75`), and
  the search box debounces at 300 ms (`:23`), so typing does not issue a request per keystroke.
- **Walkthrough**
  - `SavePageFilters` / `RestorePageFilters` (lines 29-33) persist exactly one page-specific value, the
    search string, under the key `search`. The event filter is persisted by the base.
  - `ReloadActiveLayoutAsync` (lines 35-36) delegates to
    [`ListPageActions`](group-15-common-ui-framework.md#listpageactions)`.ReloadActiveLayoutAsync`
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/ListPageActions.cs:26`), which
    reloads whichever of the mobile list or the grid is actually mounted.
    `ReloadForEventFilterAsync` (line 38) is the abstract hook the base calls when the event picker
    changes (`.../Pages/Common/EventFilteredListPageBase.cs:202-206`), and it simply forwards.
  - `LoadServerData` (lines 46-57) is the grid's `ServerData` delegate. The first thing it does is
    `await WaitForEventsAsync()` (line 50); the in-code comment (lines 48-49) explains why that cannot
    be skipped: `ApplyFilters` runs **inside** `LoadServerDataAsync`, so the default event filter has
    to be resolved before entering it. `WaitForEventsAsync` awaits the load the base started before its
    first `await` (`.../Pages/Common/EventFilteredListPageBase.cs:192`).
  - `ApplyFilters` (lines 59-64) contributes the page-specific `Name` `contains` filter when a search
    string is present (lines 61-62), then calls the base's `ApplyEventFilter` (line 63), which adds
    `EventId` `equals` when an event is selected
    (`.../Pages/Common/EventFilteredListPageBase.cs:195-199`).
  - `FetchMobilePage` (lines 67-74) is the mobile equivalent: it waits for the events, builds the same
    filter dictionary through the same `ApplyFilters`, and requests a page sorted by `Name` ascending
    (line 73). Both layouts therefore query with identical semantics.
  - `DeleteRoomAsync` (lines 80-88) hands the whole confirm-delete-toast-reload sequence to
    [`ListPageActions`](group-15-common-ui-framework.md#listpageactions)`.DeleteWithConfirmationAsync`
    (`.../MMCA.Common.UI/Pages/Common/ListPageActions.cs:56`), passing the dialog, the row's name, the
    delete call, the toast service, the success message, a failure-message factory and the reload
    callback. Note the delete call here is the **ADC-specific** overload
    `RoomService.DeleteAsync(room.Id, room.EventId)` (line 84,
    `.../Services/IRoomUIService.cs:13`), which appends `?eventId=` to the request
    (`.../Services/RoomService.cs:40-44`).
  - `RetryLoadAsync` (line 24) is bound to the empty-state's retry affordance so a failed fetch is
    recoverable in place (`.../Pages/Room/RoomList.razor:142`, `LoadFailed` supplied by the base).
  - `NavigateToCreate` (line 90) and `OnMobileCardClick` (lines 76-77) are the two navigation edges.
  - The event column and the mobile card's event line are both conditional on
    `Events is not null && Events.Count > 1` (`.../Pages/Room/RoomList.razor:50,91`), so a
    single-event deployment shows no redundant column.
- **Why it's built this way**: rooms are a small, flat list that organizers scan rather than search
  deeply, so the page spends its budget on making the same data legible on a phone at the venue (the
  card layout) and on a laptop (the grid), from one set of filters.
- **Where it's used**: it is the `/rooms` route reached from the Rooms breadcrumb on both
  [`RoomCreate`](#roomcreate) and [`RoomDetail`](#roomdetail), and it navigates on to both of them.
- **Caveats / not-in-source**: the mobile card shows the capacity line only when `item.Capacity > 0`
  (`.../Pages/Room/RoomList.razor:54`), so a room recorded with a capacity of zero is displayed
  identically to one with no capacity recorded at all, even though
  [`RoomDTO`](group-17-conference-domain.md#roomdto)`.Capacity` is nullable and can distinguish them
  (`.../MMCA.ADC.Conference.Shared/Events/RoomDTO.cs:37`).

### SponsorList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsors/SponsorList.razor.cs:19` · Level 10 · class (Blazor code-behind)

- **What it is**: the organizer's sponsor index at `/sponsors`
  (`.../Pages/Sponsor/SponsorList.razor:1-2`, Organizer-only). Structurally the twin of
  [`RoomList`](#roomlist): server-side paging with search, an event filter, a mobile card layout, and a
  tier column. The class doc (lines 12-17) makes the interesting point explicitly: unlike the speaker
  list, `EventId` is a real Sponsor column, so the event filter goes straight through the generic
  filter pipeline with no special handling.
- **Depends on**: [`EventFilteredListPageBase<TDto>`](#eventfilteredlistpagebasetdto) (line 18),
  [`ISponsorUIService`](#isponsoruiservice) (line 23),
  [`ListPageActions`](group-15-common-ui-framework.md#listpageactions) (lines 45, 89),
  [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem)
  (line 31), [`SponsorTier`](group-17-conference-domain.md#sponsortier) (line 36),
  [`ConferenceRoutePaths`](#conferenceroutepaths) (lines 98-99),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 95),
  [`Result`](group-01-result-error-handling.md#result) (line 76) and
  [`SponsorDTO`](group-17-conference-domain.md#sponsordto). Externals: MudBlazor (`MudDataGrid`,
  `MudChip`, `GridState`, `GridData`).
- **Concept introduced**: none new. Read this page **against** [`RoomList`](#roomlist): the two share
  the same override set (`SavePageFilters` line 38, `RestorePageFilters` line 41,
  `ReloadForEventFilterAsync` line 47, `GridRef` line 27, `Title` line 21), the same
  `WaitForEventsAsync`-before-`ApplyFilters` ordering (lines 59, 78, comment at 57-58), the same
  `Name` `contains` search filter (line 71), and the same
  [`ListPageActions`](group-15-common-ui-framework.md#listpageactions) delegation for reload and delete
  (lines 44-45, 88-96). That repetition across a dozen list pages is precisely what
  [`EventFilteredListPageBase<TDto>`](#eventfilteredlistpagebasetdto) exists to keep down.
  `[Rubric §18, UI Architecture]` assesses whether the same capability is expressed the same way
  everywhere: an engineer who has read one of these list pages can read all of them, and the
  differences that remain (a tier column, an id-typed navigation helper) are exactly the
  entity-specific parts.
  `[Rubric §20, Design System and Theming]` assesses consistent use of the component vocabulary: the
  tier renders as a `MudChip` in the grid (`.../Pages/Sponsor/SponsorList.razor:82`) and as secondary
  body text on the mobile card (`:50`), both fed by the same `TierLabel` helper, so the same value
  reads consistently in two layouts.
- **Walkthrough**
  - `TierLabel(SponsorTier tier)` (line 36) is the same convention-keyed localizer lookup
    [`SponsorDetail`](#sponsordetail) uses (`.../Pages/Sponsor/SponsorDetail.razor.cs:35`).
  - `SavePageFilters` / `RestorePageFilters` (lines 38-42) persist the `search` key only.
  - `ReloadActiveLayoutAsync` (lines 44-45) and `ReloadForEventFilterAsync` (line 47) mirror
    [`RoomList`](#roomlist) exactly.
  - `LoadServerData` (lines 55-66) awaits `WaitForEventsAsync()` (line 59) before delegating to the
    base's `LoadServerDataAsync` with the paged fetch and `ApplyFilters`.
  - `ApplyFilters` (lines 68-73) adds the `Name` `contains` filter then the inherited
    `ApplyEventFilter` (line 72). This is where the class doc's point lands: because `EventId` is a
    real column on the sponsor read model, the base's generic `EventId` `equals` filter is sufficient
    and the page adds nothing.
  - `FetchMobilePage` (lines 76-83) builds the identical filter set and requests `Name` ascending
    (line 82).
  - `DeleteSponsorAsync` (lines 88-96) uses
    [`ListPageActions`](group-15-common-ui-framework.md#listpageactions)`.DeleteWithConfirmationAsync`
    with the **base** `DeleteAsync(sponsor.Id)` (line 92): [`ISponsorUIService`](#isponsoruiservice)
    declares no extra members (`.../Services/ISponsorUIService.cs:9-11`) and
    [`SponsorService`](#sponsorservice) is an empty subclass of
    [`EntityServiceBase`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
    (`.../Services/SponsorService.cs:10-14`), so the generic CRUD surface is the whole surface.
  - `NavigateToCreate` (line 98) and `NavigateToDetails` (line 99) are the navigation edges;
    `OnMobileCardClick` (line 85) routes through the latter rather than duplicating the URL build.
  - The grid columns are `Name` (with an initial ascending sort and a link cell), `Tier` (sortable,
    rendered as a chip), `Sort` and `BoothNumber`, plus a delete action column
    (`.../Pages/Sponsor/SponsorList.razor:72-107`). Empty and failed states share the same
    `ListNoRecordsContent` with a retry bound to `RetryLoadAsync` (line 30,
    `.../Pages/Sponsor/SponsorList.razor:109`).
- **Why it's built this way**: an organizer reading the sponsor list is checking who is confirmed and
  at what level, so tier is the one non-name column that is both sortable and visually distinct, and
  it is the only field promoted onto the mobile card alongside the name.
- **Where it's used**: the `/sponsors` route reached from the Sponsors breadcrumb on
  [`SponsorCreate`](#sponsorcreate) and [`SponsorDetail`](#sponsordetail), and it navigates on to both.
- **Caveats / not-in-source**: the tier column is `Sortable="true"`
  (`.../Pages/Sponsor/SponsorList.razor:80`), so the server sorts by the underlying enum's numeric
  value. Whether that ordering matches the commercial ranking an organizer expects depends on the
  [`SponsorTier`](group-17-conference-domain.md#sponsortier) member order, which is declared in the
  Conference Shared project, not here.

### PublicSessionListFilterBar
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Sessions/PublicSessionListFilterBar.razor.cs:16` · Level 3 · class (Blazor code-behind)

- **What it is**: the presentational filter bar for [`PublicSessionList`](#publicsessionlist): the privileged-reader Filter-by-Event picker (or the locked "Showing" chip for everyone else), the debounced title search box, the Room picker, the All Sessions / My Schedule toggle, and the share-my-schedule action (class doc, `PublicSessionListFilterBar.razor.cs:9-15`).
- **Depends on**: [`EventDTO`](group-17-conference-domain.md#eventdto) and [`RoomDTO`](group-17-conference-domain.md#roomdto) (`:2`); [`IScreenshotService`](group-26-device-capability-layer.md#iscreenshotservice), [`IShareService`](group-26-device-capability-layer.md#ishareservice), and [`IToastService`](group-15-common-ui-framework.md#itoastservice) (`:17-19`). Its `Rooms` option set is produced by [`PublicScheduleRoomOptions`](#publicscheduleroomoptions).
- **Concept introduced, the container/presentational split.** The bar owns **no** filter state. Every value arrives as a `[Parameter]` and every change leaves through a matching `EventCallback`: `IsPrivileged` (`:25`), `Events` (`:28`), `SelectedEventId` / `SelectedEventIdChanged` (`:31`, `:34`), `SearchString` / `SearchStringChanged` (`:37`, `:40`), `Rooms` (`:46`), `SelectedRoomId` / `SelectedRoomIdChanged` (`:49`, `:52`), and `ShowMyScheduleOnly` / `ShowMyScheduleOnlyChanged` (`:55`, `:58`). The page stays the single source of truth and the bar is a pure view over it, with no lifecycle method of its own. `[Rubric §18, UI Architecture & Component Design]` (assesses decomposition and separation of layout from behavior) and `[Rubric §19, State Management & Data Flow]` (assesses where mutable state lives): with nothing to initialize, the bar cannot drift from the data the grid actually fetched.
  Three details reward a close read. The parameter is `IsPrivileged`, not "is organizer", because the privileged read audience is a role set ([`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience)) rather than one role. `Rooms` documents its own empty case (`:42-45`): an empty list hides the Room picker entirely, because an event with no rooms has nothing to narrow by, so a control with no meaningful options is removed rather than shown disabled (`[Rubric §24, Forms, Validation & UX Safety]`). And the localizer injected in the markup is `IStringLocalizer<PublicSessionList>`, not one of its own (`PublicSessionListFilterBar.razor:3`), so the split into three components did not split the page's resource file into three. `[Rubric §27, Internationalization]`.
- **Walkthrough**
  - `GetSelectedEventName()` (`:60-61`): resolves the chip label from the passed-in `Events` list, returning empty when nothing is selected.
  - `ShareScheduleAsync()` (`:63-71`): captures the current view to a file through [`IScreenshotService`](group-26-device-capability-layer.md#iscreenshotservice) and hands it to [`IShareService`](group-26-device-capability-layer.md#ishareservice) as `image/png` (`:65-67`); a null capture or a failed share collapses into one warning toast (`:69`), and the `||` short-circuit means a null path never reaches the share call. This is a native-head capability ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 3) that degrades quietly on the web. `[Rubric §29, Resilience & Business Continuity]`.
- **Why it's built this way**: pushing all filter state to the page means the same chrome can sit above both the desktop grid and the mobile card list without either layout owning a second copy of the filters.
- **Where it's used**: rendered once by [`PublicSessionList`](#publicsessionlist) (`PublicSessionList.razor:11-21`); its callbacks land on that page's `OnEventFilterChanged`, `OnSearchChanged`, `OnRoomFilterChanged` and `OnMyScheduleToggled` handlers (`PublicSessionList.razor.cs:210-233`).

### EventFormModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Events/EventFormModel.cs:27` · Level 3 · abstract class (form model)

- **What it is**: the editable shape of a conference event, declared once and bound by two different
  screens: the organizer create page and the detail page's inline editor. It is a plain
  DataAnnotations-decorated class with no Blazor, no service, and no MudBlazor reference.
- **Depends on**: [`EventDTO`](group-17-conference-domain.md#eventdto) for every length cap and
  [`QuestionModerationDefault`](group-17-conference-domain.md#questionmoderationdefault) for the
  moderation field (`MMCA.ADC.Conference.Shared.Events`, line 2), plus
  [`AbsoluteUrlAttribute`](group-15-common-ui-framework.md#absoluteurlattribute) from
  `MMCA.Common.UI.Validation` (line 3). Externals:
  `System.ComponentModel.DataAnnotations` (`Required`, `MaxLength`, `EmailAddress`).
- **Concept introduced, the shared form model as the single declaration of a form's rules.** A Blazor
  form can end up declaring its rules in three places at once: on the DTO, on each `MudTextField`'s
  `Required` / `RequiredError` / `MaxLength` attributes, and again in a hand-written check inside the
  submit handler. This type collapses the first two. Each property carries its own
  `[Required]` / `[MaxLength]` / `[EmailAddress]` / `[AbsoluteUrl]` (lines 43-85), and the pages bridge
  MudBlazor to them through
  [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation)`.For` rather than repeating a rule
  per field. The two `ErrorMessage` resource keys that name a missing value are hoisted to consts,
  `NameRequiredKey` (line 33) and `TimeZoneRequiredKey` (line 40), so the model's rule and the field's
  own `RequiredError` affordance quote the same key instead of two string literals that can drift.
  Every other `ErrorMessage` is a bare resource key too, resolved at render time by the page's
  [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator)
  wrapped around that page's `IStringLocalizer` (ADR-027,
  `Website/docs-src/adr/027-multi-locale-i18n.md`).
  `[Rubric §24, Forms, Validation & UX Safety]` assesses whether a form can express only legal input and
  says why in place: the caps here are not invented, they are `EventDTO.NameMaxLength` and its siblings
  (lines 44, 48, 53, 57, 61, 65, 69, 74, 79, 84), so the client rejects exactly what the server column
  would reject.
  `[Rubric §15, Best Practices & Code Quality]` assesses whether one change lands in one place: adding a field to the
  event form means one property here plus one control in the shared `EventFormFields` component, and both
  screens get it.
  `[Rubric §27, Internationalization]`: no message is a literal, every one is a key (ADR-011,
  `Website/docs-src/adr/011-single-locale-i18n.md`, revisited by ADR-027).
- **Walkthrough**
  - Two resource-key consts (lines 33, 40) for the required-value messages.
  - Ten annotated text properties (lines 45-85): `Name` and `TimeZone` are required and non-nullable with
    `string.Empty` defaults; the eight optional ones are nullable. `OrganizerContactEmail` adds
    `[EmailAddress]` (line 73), and `SponsorshipPacketUrl` plus `TicketingUrl` add `[AbsoluteUrl]`
    (lines 78, 83), the framework attribute that rejects a relative or scheme-less URL.
  - Three unannotated properties (lines 88, 91, 94): `StartDate`, `EndDate`, and
    `QuestionModerationDefault`. The class doc (lines 19-24) is explicit that this is deliberate:
    DataAnnotations cannot express a date-range rule or a picker's required affordance, so the pickers
    keep their own required markup and the pages keep the cross-field date check, but the values still
    live on the one model rather than as loose page fields.
- **Why it's built this way**: the create page and the detail editor edit the same thing, so a value one
  accepts must be a value the other accepts. Making the model abstract and letting the two concrete
  models add only their save shape (see [`EventCreateModel`](#eventcreatemodel) and
  [`EventEditModel`](#eventeditmodel)) makes that guarantee structural instead of a convention someone
  has to remember.
- **Where it's used**: [`EventCreateModel`](#eventcreatemodel) and [`EventEditModel`](#eventeditmodel)
  derive from it; [`EventCreate`](#eventcreate) and [`EventDetail`](#eventdetail) bind an instance to the
  shared `EventFormFields` component
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Event/EventFormFields.razor`).

### EventCreateModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Events/EventCreateModel.cs:11` · Level 4 · sealed class (form model)

- **What it is**: the create-side concrete of [`EventFormModel`](#eventformmodel). It adds exactly two
  things to the shared base: the time zone a new event opens on, and the method that turns the entered
  values into the DTO the create posts.
- **Depends on**: [`EventFormModel`](#eventformmodel) and
  [`EventDTO`](group-17-conference-domain.md#eventdto) (line 1). No services, no Blazor.
- **Concept introduced, the model owns the save shape.** The recurring alternative is a page handler that
  news up a DTO inline from a dozen backing fields. Moving that into `ToNew` means the "what a create
  posts" decision is one readable object initializer instead of a paragraph inside an `async Task`, and
  it is unit-testable without a renderer. `[Rubric §14, Testability]` assesses whether behavior can be
  exercised without its host: this class has no Blazor surface at all.
  `[Rubric §18, UI Architecture & Component Design]`: the code-behind keeps orchestration (validate,
  post, navigate) and delegates shape.
- **Walkthrough**
  - The parameterless constructor (line 14) seeds `TimeZone = "America/New_York"`, the conference's home
    zone, so the common case needs no edit. That is the entire create-specific default.
  - `ToNew()` (lines 25-42) builds an [`EventDTO`](group-17-conference-domain.md#eventdto) with
    **`Id = default`** (line 28), converts the two `DateTime?` pickers with `DateOnly.FromDateTime`
    (lines 31-32), copies the ten text fields across, and hard-codes `IsPublished = false` (line 41).
    The null-forgiving `StartDate!.Value` is safe because the page runs its date guards first; the
    `<remarks>` (lines 21-24) says exactly that.
  - Note what `ToNew` does **not** carry: `QuestionModerationDefault` is on the base but is not written
    into the created DTO, so a new event takes whatever default the server applies. Only
    [`EventEditModel`](#eventeditmodel) posts it.
- **Why it's built this way**: `Id = default` hands identifier assignment to the server, and the
  unpublished default exists so an organizer can fill in venue details and refresh from Sessionize before
  anything is publicly visible. Publishing is a separate deliberate gesture on
  [`EventDetail`](#eventdetail).
- **Where it's used**: instantiated as the `_model` field of [`EventCreate`](#eventcreate)
  (`.../Pages/Event/EventCreate.razor.cs:44`) and consumed by its `CreateEventAsync`
  (`.../Pages/Event/EventCreate.razor.cs:84`).

### EventEditModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Events/EventEditModel.cs:11` · Level 4 · sealed class (form model)

- **What it is**: the edit-side concrete of [`EventFormModel`](#eventformmodel), used by
  [`EventDetail`](#eventdetail)'s inline editor. It is a round trip in two methods: `LoadFrom` fills the
  editor from the loaded event, `ToUpdated` produces the DTO the update posts.
- **Depends on**: [`EventFormModel`](#eventformmodel) and
  [`EventDTO`](group-17-conference-domain.md#eventdto) (line 1).
- **Concept introduced, shadow editing through a model instead of shadow fields.** The live loaded
  `EventDTO` is never mutated: opening the editor copies it into this model, and only a validated save
  produces a new DTO. Because both directions are one method, a newly added property cannot be carried by
  one path and dropped by the other, which is exactly the failure mode a field-by-field transcription in
  the page invites (class doc, lines 13-15).
  `[Rubric §8, Data Architecture]` assesses whether concurrency is handled deliberately: `ToUpdated`
  re-sends the loaded `RowVersion` (line 55), the client half of the optimistic-concurrency token in
  `Website/docs-src/adr/035-optimistic-concurrency.md`, so a stale edit is rejected rather than silently
  overwriting a concurrent one.
  `[Rubric §11, Security]` assesses whether a client can move state through a path it should not:
  `IsPublished` is copied straight off the source (line 68), never off the form, so the edit form
  structurally cannot publish or unpublish.
- **Walkthrough**
  - `LoadFrom(EventDTO source)` (lines 18-35): `ArgumentNullException.ThrowIfNull` (line 20), then copies
    the ten text fields, converts the two `DateOnly` values back to `DateTime` at `TimeOnly.MinValue`
    for the pickers (lines 24-25), and copies `QuestionModerationDefault` (line 34).
  - `ToUpdated(EventDTO source)` (lines 48-71): builds a new `EventDTO` carrying identity and concurrency
    from the source (`Id` line 54, `RowVersion` line 55, `IsPublished` line 68), the edited text and
    dates from the model, and the edited `QuestionModerationDefault` (line 69). Same null-forgiving date
    access, same `<remarks>` justification (lines 44-47).
  - The class doc (lines 8-9) records the deliberate omission: no published flag on the form, because
    publishing and unpublishing are their own buttons.
- **Why it's built this way**: an update endpoint reads a full DTO, so something must write every
  property; doing it in one place is the only way to keep the read path and the write path in agreement
  as fields are added.
- **Where it's used**: the `_model` field of [`EventDetail`](#eventdetail)
  (`.../Pages/Event/EventDetail.razor.cs:53`), driven by its `StartEditing`
  (`.../Pages/Event/EventDetail.razor.cs:119`) and `SaveChangesAsync`
  (`.../Pages/Event/EventDetail.razor.cs:156`).

### PublicSessionListView
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Sessions/PublicSessionListView.razor.cs:26` · Level 5 · class (Blazor code-behind)

- **What it is**: the presentational session-list view for [`PublicSessionList`](#publicsessionlist): the mobile infinite-scroll card list and the desktop server-paged data grid, including the inline bookmark stars and their toggle flow (class doc, `PublicSessionListView.razor.cs:15-25`).
- **Depends on**: [`SessionDTO`](group-17-conference-domain.md#sessiondto), the optional [`ISessionBookmarkUIService`](group-22-engagement-module.md#isessionbookmarkuiservice) (`:60`), [`SpeakerInfo`](#speakerinfo) (`:69`), [`Result`](group-01-result-error-handling.md#result) in the mobile fetch delegate's signature (`:78`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:185`), [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) (`:80`, rendered at `PublicSessionListView.razor:6`), [`ListPageActions`](group-15-common-ui-framework.md#listpageactions) (`:94`), [`IToastService`](group-15-common-ui-framework.md#itoastservice) and [`IHapticFeedbackService`](group-26-device-capability-layer.md#ihapticfeedbackservice) (`:28-29`), plus MudBlazor's `MudDataGrid<T>` / `GridState<T>` / `GridData<T>` and `NavigationManager`.
- **Concept introduced, the presentational child that patches container-owned state in place.** Like [`PublicSessionListFilterBar`](#publicsessionlistfilterbar), the view owns no fetch or filter state: the page hands down its `ServerData` and `FetchPageResult` delegates (`:75`, `:78`), its paging parameters (`:42-48`), the speaker and room lookups (`:69`, `:72`), and the shared `BookmarkedSessions` dictionary (`:66`). The subtlety is that the view **mutates that dictionary in place** when a star is toggled (`AddBookmarkAsync` writes `BookmarkedSessions[sessionId] = bookmark.Id` at `:170`, `RemoveBookmarkAsync` removes at `:150`), so the page's My Schedule fetch, which reads the same dictionary to scope the query, sees the change without a round trip. The class doc names the sibling that uses the same pattern, [`SessionLivePollPanel`](group-23-engagement-live-layer.md#sessionlivepollpanel) (`:20-21`). It also exposes the captured `Grid` reference (`:90`) and `ReloadAsync()` (`:93-94`) so the page's [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) plumbing keeps restoring rows-per-page and current page unchanged. `[Rubric §18, UI Architecture & Component Design]` and `[Rubric §19, State Management & Data Flow]`: state has exactly one owner (the page) and one mutation point (this component).
  The class doc also records a deliberate omission (`:23-24`): the list shows no track or category chips, because the detail page is where a session's categories are read and the list stays scannable on time, speakers, and room. `[Rubric §25, Navigation & Information Architecture]`.
- **Walkthrough**
  - `IsBookmarked` (`:96-97`) is a dictionary lookup, so star state costs nothing per row.
  - `CanBookmark` (`:103-108`): a session is bookmarkable only when the user is authenticated, the Engagement-owned service resolved, the session is not a service session, and its status is unset or `"Accepted"`. The comment (`:99-102`) records that this literal mirrors [`SessionStatuses`](group-17-conference-domain.md#sessionstatuses)`.IsEligible` in Conference.Domain, which is the source of truth: the UI layer depends on Shared only, so the check is duplicated rather than referenced, precisely so the UI never shows a star the server would reject (BR-49). `[Rubric §11, Security]` and `[Rubric §24, Forms, Validation & UX Safety]`.
  - `ToggleBookmarkAsync` (`:110-137`): guards re-entry with a **per-session** `HashSet` whose `Add` doubles as the guard test (`:112`, field at `:83`), fires `Haptics.Click()` (`:116`, a no-op off native heads), then removes or adds, catching `OperationCanceledException` as expected teardown or an InteractiveAuto transition (`:129-132`) and clearing the guard entry in the `finally` (`:135`). The per-session guard is a fixed defect worth reading: the comment at `:81-82` records that a single global in-flight flag made one slow toggle swallow every other star's click, so the list stopped responding until that request came back.
  - `RemoveBookmarkAsync` (`:139-158`): a delete that comes back not-found is treated as success, because a bookmark that is already gone still leaves the user where they asked to be (`:143-148`, the tolerance expressed as `removed.IsFailure && !removed.IsNotFound()` over [`ResultUiExtensions`](group-15-common-ui-framework.md#resultuiextensions)`.IsNotFound`, `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:315`); it then clears the entry, toasts, and reloads when the My Schedule view is active so the removed row disappears (`:150-157`).
  - `AddBookmarkAsync` (`:160-172`): a create that did not come back with a bookmark leaves the star unset, so the page reports a warning rather than a success toast that would contradict its own UI (`:162-168`).
  - `GetSpeakerList` (`:174-182`) maps a session's `SessionSpeakers` to display names through the passed-in lookup, skipping ids the lookup does not know; `OnMobileCardClick` (`:184-185`) routes to [`PublicSessionDetail`](#publicsessiondetail) through [`ConferenceRoutePaths`](#conferenceroutepaths).
- **Why it's built this way**: separating the grid and card layouts from the page's fetch-and-filter logic lets one bookmark implementation serve both, while the page remains the owner of every piece of state either layout renders.
- **Where it's used**: rendered by [`PublicSessionList`](#publicsessionlist), which holds it as `_view` (`PublicSessionList.razor.cs:45`, captured at `PublicSessionList.razor:31`) and reads `_view?.Grid` for its `GridRef` override (`:70`) and `_view?.ReloadAsync()` for every filter change (`:232`).

### EventCreate

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Events/EventCreate.razor.cs:15` · Level 6 · class (Blazor code-behind)

- **What it is**: the organizer form that creates a conference event. It binds an
  [`EventCreateModel`](#eventcreatemodel) to the shared `EventFormFields` block, validates, posts the
  record unpublished, and redirects to the new event's detail page. It is the place where the Conference
  create-form shape is taught.
- **Depends on**: [`IEventUIService`](#ieventuiservice) (line 17),
  [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 19),
  [`EventCreateModel`](#eventcreatemodel) (line 44),
  [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) plus
  [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator)
  (line 38), [`ConferenceRoutePaths`](#conferenceroutepaths), and
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 63). Externals: Blazor
  (`[Inject]`, `NavigationManager`, `OnInitialized`), MudBlazor (`MudForm`, `BreadcrumbItem`,
  `Icons.Material.Filled.Home`), the `UnsavedChangesGuard`, `EventFormFields`, and `ErrorSummary`
  components wired in the template (`.../Pages/Event/EventCreate.razor:10, 26, 41`), and the
  `IStringLocalizer<EventCreate>` the template injects as `L` (`.../Pages/Event/EventCreate.razor:6`).
- **Concept introduced, the partial-class code-behind create form.** Every Conference page is a `.razor`
  template plus a `.razor.cs` partial holding the injected services, backing fields, and handlers. The
  create leg layers five recurring mechanisms on that split, and every other create page in this group
  repeats them:
  1. **Cancel-on-disposal**: a `CancellationTokenSource _cts` (line 21) is passed to the service call
     (line 84) and cancelled plus disposed through the standard `Dispose(bool)` pattern (lines 109-125),
     so an in-flight save cannot resolve against a torn-down component.
  2. **Model-declared validation**: `OnInitialized` builds one delegate,
     `ModelValidation.For(_model, new DataAnnotationsModelValidator(L))` (line 38), and the template
     hands that single delegate to every field on `EventFormFields`
     (`.../Pages/Event/EventCreate.razor:26`). No `Required` or `MaxLength` is written in markup; the
     rules live on [`EventFormModel`](#eventformmodel) and the `ErrorMessage` keys are resolved through
     `L` (ADR-027).
  3. **Validate-then-submit**: `await _form.ValidateAsync()` followed by an `IsValid` guard
     (lines 60-65), then two hand-written cross-field checks DataAnnotations cannot express, both dates
     present (lines 67-71) and end not before start (lines 75-79). The second one's comment (lines 73-74)
     is explicit that it mirrors the server rule so the organizer sees it without a round trip. The
     `IsSaving` flag (line 41) disables the button for the round trip and is always cleared in `finally`
     (lines 99-102).
  4. **An unsaved-changes guard**: `_isDirty` is set by `MarkDirty()` (line 53), passed to
     `EventFormFields` as `OnFieldChanged` (`.../Pages/Event/EventCreate.razor:27`), and read by the
     `UnsavedChangesGuard` component (`.../Pages/Event/EventCreate.razor:10`). It is cleared **before**
     the success redirect (line 91) so the guard does not block the page's own navigation.
  5. **Two-tier failure handling**: a failed `Result` toasts `Snackbar.SaveFailed` and returns
     (lines 85-89), while `OperationCanceledException` is swallowed as expected during disposal or an
     InteractiveAuto render-mode transition (lines 95-98).
     `Website/docs-src/adr/056-blazor-render-mode-strategy.md` is the record behind that second catch.
  `[Rubric §24, Forms, Validation & UX Safety]` assesses client validation, unsaved-change protection,
  and safe submits: this page validates before posting, tracks dirty state, and guards navigation away.
  `[Rubric §18, UI Architecture & Component Design]`: the code-behind holds orchestration, the model holds
  rules and shape, the shared field component holds markup.
  `[Rubric §11, Security]`: the route is organizer-only via
  `@attribute [Authorize(Roles = "Organizer")]` (`.../Pages/Event/EventCreate.razor:2`).
  `[Rubric §27, Internationalization]`: every label, breadcrumb, and toast reads through `L` (for example
  `L["Snackbar.Created"]`, line 92), per ADR-011 and ADR-027.
- **Walkthrough**
  - `OnInitialized` (lines 27-39) builds the three-item breadcrumb trail (Home, the events list, a
    disabled "Create" leaf, lines 30-35) and wires the validation delegate (line 38).
  - `_model` (line 44) is a single `EventCreateModel`, whose constructor already seeded the time zone;
    the page keeps no per-field backing state of its own.
  - `CreateEventAsync` (lines 55-103) validates, runs the two date guards, sets `IsSaving`, posts
    `_model.ToNew()` with `AddAsync` (line 84), clears `_isDirty`, toasts success, and navigates to
    `ConferenceRoutePaths.EventDetails(createdEvent.Id)` (line 93) using the id the server returned.
  - `NavigateToList` (line 105) is the cancel path back to `/events`.
  - The template's `ErrorSummary` (`.../Pages/Event/EventCreate.razor:41-42`) collapses duplicates: its
    own comment (lines 36-40) notes MudBlazor validates a `For`-bound field through the model annotations
    as well as through the shared delegate, so one empty field can report the same rule twice, once
    localized and once as the bare key. Resolving every entry and de-duplicating leaves one wording per
    broken rule.
- **Why it's built this way**: a new event starts unpublished so an organizer can complete venue details
  and refresh from Sessionize before anything is publicly visible; publishing is a separate deliberate
  action on [`EventDetail`](#eventdetail). Binding the same `EventFormFields` block that the detail
  editor binds is what makes "a value the create page accepts is a value the detail page accepts" true by
  construction rather than by review.
- **Where it's used**: the `/events/create` route (`.../Pages/Event/EventCreate.razor:1`), reached from
  [`EventList`](#eventlist)'s create button; on success it hands off to [`EventDetail`](#eventdetail).

### EventList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Events/EventList.razor.cs:17` · Level 6 · class (Blazor code-behind)

- **What it is**: the organizer browse page for events: a server-paged, server-sorted grid on desktop, an
  infinite-scroll card list on mobile, with a name search, a delete-with-confirmation action, and
  navigation into create and detail. It is the simplest inheritor of the shared list base and the place
  where the Conference list-page shape is taught.
- **Depends on**: extends
  [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) over
  [`EventDTO`](group-17-conference-domain.md#eventdto) (line 16) and injects
  [`IEventUIService`](#ieventuiservice) (line 21). It uses
  [`ListPageActions`](group-15-common-ui-framework.md#listpageactions) (lines 40, 72),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 78),
  [`ConferenceRoutePaths`](#conferenceroutepaths), and the
  [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem),
  `DeleteConfirmation`, and `ListNoRecordsContent` components from `MMCA.Common.UI`. The toast service
  and the `IsMobile` flag come from the base.
- **Concept introduced, the two-layout list page over one shared base.** A Conference list page is short
  because everything hard lives in
  [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto). The derived
  page supplies five things and nothing else:
  1. **A grid reference**: `_dataGrid` captured via `@ref` and surfaced through the overridden `GridRef`
     (lines 24-25), which the base needs to restore rows-per-page after first render.
  2. **Filter persistence**: `SaveFilters` / `RestoreFilters` (lines 33-37) write and read the page's own
     search string, and the base persists them so filters survive navigation, refresh, and a shared link.
     `[Rubric §25, Navigation & Information Architecture]`.
  3. **The fetch delegates**: `LoadServerData` (lines 48-57) hands the base a lambda that calls
     `EventService.GetPagedAsync` and an additional-filters callback that appends
     `Name contains <search>` (lines 53-57). `LoadServerDataAsync` in the base owns cancellation-token
     resetting, page-index conversion, sort extraction, the `IsLoading` and `LoadFailed` flags, and
     uniform error reporting.
  4. **A mobile fetch**: `FetchMobilePage` (lines 60-66) repeats the same filter build for the card list,
     which pages by "load more" instead of a pager and sorts by `Name asc` (line 65).
     `[Rubric §22, Responsive & Cross-Browser]`: the page renders two genuinely different layouts off the
     base's `IsMobile` flag rather than reflowing one grid (`.../Pages/Event/EventList.razor:31`).
  5. **Actions**: `DeleteEventAsync` (lines 71-79) delegates the confirm, delete, toast, and reload
     sequence to
     [`ListPageActions`](group-15-common-ui-framework.md#listpageactions)`.DeleteWithConfirmationAsync`,
     and `ReloadActiveLayoutAsync` (lines 39-40) dispatches a refresh to whichever layout is live.
  The failure path is worth noting: when a fetch fails the base sets `LoadFailed`, and the template feeds
  it to `ListNoRecordsContent` with an `OnRetry` handler wired to `RetryLoadAsync` (line 28,
  `.../Pages/Event/EventList.razor:131`), so a failed load renders an inline retry instead of an empty
  list that reads as "no events". `[Rubric §19, State Management & Data Flow]`.
  Data access follows `Website/docs-src/adr/094-client-entity-data-access.md`: the page never touches
  `HttpClient`, only the typed `I*UIService` client, and expresses filters as operator-plus-value pairs
  the server model binder understands.
- **Walkthrough**
  - `Title` and `EntityName` (lines 18-19) come from the injected localizer; `Title` is the abstract
    member the base uses in its error messages.
  - `OnSearchChanged` (lines 42-46) stores the text and reloads the active layout, so typing drives a
    server round trip rather than a client-side filter over the current page.
  - `OnMobileCardClick` (line 68) and `NavigateToDetails` (lines 84-85) both route through
    `ConferenceRoutePaths.EventDetails(id)`, and `NavigateToCreate` (lines 81-82) opens
    [`EventCreate`](#eventcreate).
  - The grid declares three sortable `PropertyColumn`s over `Name`, `StartDate`, and `EndDate`
    (`.../Pages/Event/EventList.razor:79, 87, 96`), with `Name` carrying
    `InitialDirection="SortDirection.Ascending"` so the first page arrives ordered.
- **Why it's built this way**: many list pages across the workspace share this base, so browse behavior,
  state persistence, and error handling stay identical everywhere and a new list page costs a few dozen
  lines.
- **Where it's used**: the `/events` organizer route (`.../Pages/Event/EventList.razor:1-2`,
  `Authorize(Roles = "Organizer")`); rows open [`EventDetail`](#eventdetail) and the create button opens
  [`EventCreate`](#eventcreate).

### EventDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Events/EventDetail.razor.cs:19` · Level 8 · class (Blazor code-behind)

- **What it is**: the organizer's event console. It loads one event by route id and offers four distinct
  operations on it: inline edit, publish/unpublish, refresh from Sessionize, and delete. It is the
  richest detail page in the Conference UI in terms of *verbs*, and the place where the detail-page shape
  is taught.
- **Depends on**: [`DetailPageBase`](#detailpagebase) (`@inherits`,
  `.../Pages/Event/EventDetail.razor:6`), [`IEventUIService`](#ieventuiservice) (line 23) for all four
  operations, [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 25),
  [`EventEditModel`](#eventeditmodel) (line 53);
  [`EventDTO`](group-17-conference-domain.md#eventdto),
  [`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto), and
  [`QuestionModerationDefault`](group-17-conference-domain.md#questionmoderationdefault);
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 90),
  [`ResultUiExtensions`](group-15-common-ui-framework.md#resultuiextensions)`.NotifyOnFailure`
  (lines 99, 159, 166, 286),
  [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Parse<T>` extension (line 4), and
  the `DeleteConfirmation`, `UnsavedChangesGuard`, `EventFormFields`, and `ErrorSummary` components
  (`.../Pages/Event/EventDetail.razor:11, 37, 51, 197`).
- **Concept introduced, load-once-on-parameters over a shared detail base.** Four mechanisms combine here
  and recur in every detail page in this group:
  1. **A shared base owns the boring half.** [`DetailPageBase`](#detailpagebase) supplies `PageToken`
     (the page-scoped cancellation token with its dispose pattern) and the edit-mode lifecycle
     (`IsEditing`, `IsDirty`, `BeginEdit`, `EndEdit`), so this file contains no
     `CancellationTokenSource` and no `Dispose` at all.
  2. **Route id as a string**: the id arrives as `[Parameter] public string Id` (line 27) and is
     converted with `Id.Parse<EventIdentifierType>()` (line 86), so the page compiles unchanged whichever
     primitive the alias maps to (ADR-048, ADR-085).
  3. **Load once per id**: `OnParametersSetAsync` compares against `_loadedId` and returns early when the
     id is unchanged (lines 69-79), so a re-render does not refetch.
  4. **Shadow editing through a model**: `StartEditing` copies the loaded record into
     [`EventEditModel`](#eventeditmodel) and calls `BeginEdit` (lines 112-121); `CancelEditing` is just
     `EndEdit` (line 123). The live `Event` object is never mutated until a validated save succeeds.
     `[Rubric §24, Forms, Validation & UX Safety]`.
  `[Rubric §8, Data Architecture]` assesses a deliberate concurrency strategy: every mutating call
  re-sends the loaded `RowVersion`, on save through [`EventEditModel`](#eventeditmodel)`.ToUpdated` and
  on publish/unpublish explicitly (lines 206-207), which is the client half of the optimistic-concurrency
  token described in `Website/docs-src/adr/035-optimistic-concurrency.md`.
  `[Rubric §6, CQRS & Event-Driven]`: publish and unpublish are not `IsPublished` flag edits, they are
  their own named service operations (`PublishAsync` / `UnpublishAsync`,
  `.../Services/IEventUIService.cs:13, 15`), so each state transition stays a use case the server can
  guard on its own terms.
  `[Rubric §13, Observability & Operability]`: the Sessionize refresh returns a
  [`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto) held
  in `_refreshResult` (line 63) so the organizer sees what the import actually did.
- **Walkthrough**
  - `OnInitialized` (lines 33-45) builds breadcrumbs and wires the validation delegate against `_model`
    (line 44), exactly as [`EventCreate`](#eventcreate) does.
  - `LoadEventAsync` (lines 81-110): `GetByIdAsync(id, true, PageToken)` so children arrive with the
    record (line 86); a `NotFound` result clears `Event` and toasts `ErrorMessages.NotFound`
    (lines 87-91); any other failure goes through `NotifyOnFailure` (line 99) so the server's own message
    reaches the user; success seeds `_sessionizeCode` (line 95). The `finally` always clears `IsLoading`.
  - `SaveChangesAsync` (lines 125-183): validate the form, re-check both dates present and end not before
    start (lines 139-151, the same two guards [`EventCreate`](#eventcreate) runs), post
    `_model.ToUpdated(Event)` (line 156), then **refetch** the record (line 163) so the page shows server
    truth rather than the values it just sent, toast, and `EndEdit`.
  - `PublishAsync` / `UnpublishAsync` (lines 185-187) both delegate to `SetPublishedAsync(bool)`
    (lines 194-232), which picks the failure message up front (line 201), calls the chosen named
    operation with the current `RowVersion` (lines 205-207), refetches, and reports the reload miss with
    the same message as the toggle itself, since the toggle is what the user asked for (doc comment,
    lines 189-193).
  - `RefreshFromSessionizeAsync` (lines 234-267) hands the whole gesture to one service call,
    `RefreshFromSessionizeWithCodeAsync(Event, _sessionizeCode, PageToken)` (line 247). The service owns
    persist-then-import-then-reload and returns a single outcome carrying both the summary and the
    refreshed event (lines 254-256), so the page keeps one failure message for the whole gesture.
  - `DeleteEventAsync` (lines 269-297): confirm through `_deleteConfirm.ShowAsync(Event.Name)`
    (line 276), delete, then navigate back to the list.
- **Why it's built this way**: an event is the root aggregate of the whole conference, so publishing,
  importing, and editing carry separate audit meaning rather than collapsing into one PUT; keeping each
  as its own service call is what lets the server enforce its own rules per transition. Pushing the
  three-step Sessionize gesture into the service (rather than sequencing it in the page) is the same
  instinct applied one level down.
- **Where it's used**: the `/events/{Id}` organizer route (`.../Pages/Event/EventDetail.razor:1-2`),
  reached from [`EventList`](#eventlist) rows and from [`EventCreate`](#eventcreate)'s success redirect.
  Its "view feedback" button opens [`OrganizerEventFeedback`](#organizereventfeedback)
  (`.../Pages/Event/EventDetail.razor:135-136`).
- **Caveats / not-in-source**: what the Sessionize refresh imports, and how it reconciles existing rows,
  is server-side; this page only shows the returned summary.

### PublicSessionDetail
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Sessions/PublicSessionDetail.razor.cs:26` · Level 9 · class (Blazor code-behind)

- **What it is**: the public read-only view of one session (speakers, categories, room and wayfinding) plus the contextual actions an authenticated attendee gets: the bookmark toggle, the feedback link, a listen-aloud button, and the Live entry point when the Engagement module is present.
- **Depends on**: [`ISessionUIService`](#isessionuiservice), [`ISpeakerLookupService`](#ispeakerlookupservice), [`IRoomUIService`](#iroomuiservice), [`ICategoryItemLookupService`](#icategoryitemlookupservice) (`:24-27`); optionally [`ISessionBookmarkUIService`](group-22-engagement-module.md#isessionbookmarkuiservice) and [`ISessionLiveUIService`](group-23-engagement-live-layer.md#isessionliveuiservice) (`:36`, `:39`); [`IHapticFeedbackService`](group-26-device-capability-layer.md#ihapticfeedbackservice) and [`ITextToSpeechService`](group-26-device-capability-layer.md#itexttospeechservice) (`:31-32`); [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`RoomDTO`](group-17-conference-domain.md#roomdto), [`IToastService`](group-15-common-ui-framework.md#itoastservice) (`:29`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:59`, `:331`), [`ClaimsPrincipalExtensions`](group-08-auth.md#claimsprincipalextensions)'s `GetUserId` (`:262`, defined at `MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:40`), and [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Id.Parse<T>` (`:123`).
- **Concept introduced, optional cross-module services resolved through the container.** Blazor's `[Inject]` has no optional mode (an unregistered service throws at render), so the two Engagement-owned services are resolved with `ServiceProvider.GetService<T>()` in `OnInitialized` and left null when that module is disabled (`:34-39`, resolved at `:54-55`). Every use site then null-checks, and the markup only renders the Live button when `SessionLive` resolved (`PublicSessionDetail.razor:151-155`). `[Rubric §7, Microservices Readiness]` (assesses that a module can be switched off without breaking its consumers): the Conference page degrades to a plain read-only session view when Engagement is absent, rather than failing to render. `[Rubric §3, Clean Architecture]`: the dependency is on an interface owned by the other module's UI contract, never on its internals.
  The page repeats three mechanisms taught above. The **prerender skip** (`:101-104`) carries the most specific comment of the pages that use it (`:97-100`): under InteractiveAuto the interactive instance re-runs `OnParametersSetAsync`, so without the guard every visit fetched the session, all speakers, all category items, the room and the bookmark state twice, and it names the category-item read as the expensive one, a full-table read per view. `[Rubric §23, Front-End Performance & Rendering]`. **Load-once-on-parameters** (`:106-109`) keeps a re-render from refetching, and the **generation counter** (`:72`, bumped at `:118`, re-checked at `:125`, `:171`) drops a superseded fetch, with the field doc explaining why the generation rather than the route id is authoritative (`:66-71`). It also repeats the BR-49 status allow-list as `IsStatusIneligible` (`:91-93`), with the comment again pointing at [`SessionStatuses`](group-17-conference-domain.md#sessionstatuses)`.IsEligible` as the server-side source of truth and explaining that the UI layer depends on Shared only; the markup uses it both to badge the session and to hide the attendee actions (`PublicSessionDetail.razor:32`, `:135`).
- **Walkthrough**
  - `LoadSessionAsync` (`:115-177`): fetch the session with children (`:124`), clear `Session` and toast not-found-versus-load-failed on failure (`:130-140`), then run three resolvers in a single short-circuiting condition (`:144-146`) so any one failing raises one load-failure toast (`:148-153`), and finally read the caller's bookmark state (`:156`). The remaining broad `catch` is documented as kept for `AuthenticationStateProvider`, which still reports a failure by throwing (`:162-167`).
  - `ResolveSpeakerNamesAsync` (`:183-195`) and `ResolveCategoryNamesAsync` (`:198-214`) join the session's child collections against the two lookup services, skipping ids the lookup does not know; the category resolver prefixes the owning category title when present, so a chip reads "Level: Intermediate" (`:211`).
  - `ResolveRoomAsync` (`:221-245`): returns success immediately for a session with no room (`:223-225`), otherwise fetches the room including wayfinding info (BR-94, `:228-229`) and treats a not-found as a tolerable miss that leaves the wayfinding block empty (`:242-244`), which the markup renders field by field (`PublicSessionDetail.razor:81-95`).
  - `LoadBookmarkStateAsync` (`:247-277`): awaits the cascading authentication state, reads the identifier through `GetUserId` (`:262`, with the comment recording that it accepts both the `sub` claim and the `NameIdentifier` form the bearer handler maps it to, and parses invariantly), then loads the bookmarked ids; a failed read is non-critical and leaves the star unset (`:268-276`).
  - `ToggleBookmarkAsync` (`:279-329`): a single `_isTogglingBookmark` re-entry guard (this page shows one session, so the per-session set [`PublicSessionListView`](#publicsessionlistview) needs is unnecessary here), a haptic click (`:285`), then delete with the same not-found tolerance (`:294-299`) or create with the same null-body warning path the list view uses (`:309-314`).
  - `ToggleListenAsync` (`:338-361`): text to speech over the description, where the same button stops playback (`:345-349`); `SpeakAsync` completes when playback finishes or `StopAsync` cancels it (`:354-355`), and the `finally` clears `_isSpeaking` either way. `[Rubric §21, Accessibility]` (assesses alternative modalities for content) and [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 3.
  - Navigation (`:331-333`) returns to the schedule or opens the session feedback form; disposal (`:365-385`) is the standard cancel-on-disposal pattern over the `CancellationTokenSource` at `:45`.
- **Why it's built this way**: this is the page an attendee opens in a hallway, so the expensive lookups are done once per id, the optional capabilities fail soft, and the actions (star, feedback, listen, Live) sit inline instead of on separate routes.
- **Where it's used**: the `/conference/sessions/{Id}` route (`PublicSessionDetail.razor:1`), reached from [`PublicSessionListView`](#publicsessionlistview) rows and cards and from [`PublicSpeakerDetail`](#publicspeakerdetail); its markup renders the `QrCodeButton` for its own public link (`PublicSessionDetail.razor:41`).

### PublicSessionList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Sessions/PublicSessionList.razor.cs:30` · Level 10 · class (Blazor code-behind)

- **What it is**: the public conference schedule and the most heavily wired page in this unit. It is the container half of a three-part page (this class, [`PublicSessionListFilterBar`](#publicsessionlistfilterbar), [`PublicSessionListView`](#publicsessionlistview)): it owns the events, room and speaker lookups, the event/room/search/My-Schedule filter state, the bookmark dictionary, and the server-paged fetch (class doc, `PublicSessionList.razor.cs:21-29`).
- **Depends on**: extends [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) closed over [`SessionDTO`](group-17-conference-domain.md#sessiondto) (`:27`); [`IPublicSessionScheduleService`](#ipublicsessionscheduleservice) (`:31`) with its [`SessionSchedulePageRequest`](#sessionschedulepagerequest) (`:275`), [`IEventUIService`](#ieventuiservice) and [`ISpeakerLookupService`](#ispeakerlookupservice) (`:32-33`), the optional [`ISessionBookmarkUIService`](group-22-engagement-module.md#isessionbookmarkuiservice) (`:38`); [`EventDTO`](group-17-conference-domain.md#eventdto), [`RoomDTO`](group-17-conference-domain.md#roomdto), [`SpeakerInfo`](#speakerinfo) (`:52`), [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience) (`:121`), [`CurrentEventDefaults`](group-17-conference-domain.md#currenteventdefaults) (`:167`), [`PublicScheduleRoomOptions`](#publicscheduleroomoptions) (`:139`, `:152`), [`PublicSessionListFilterState`](#publicsessionlistfilterstate) (`:74`, `:81`), [`ClaimsPrincipalExtensions`](group-08-auth.md#claimsprincipalextensions)'s `GetUserId` (`:188`), and [`Result`](group-01-result-error-handling.md#result) (`:271`).
- **Concept introduced, the container page with two racing loads and a dual-branch fetch.** Everything the sibling list pages do once, this page does twice and then adds a mode switch.
  1. **Two startup tasks, both awaited by the fetch path.** `OnInitializedAsync` (`:84-112`) starts `_bookmarkLoadTask` (`:100`) and `_eventsLoadTask` (`:104`) **before** its first `await` (`:108`). The comments (`:94-103`) name the exact failure each guards: the `MudDataGrid`'s first `ServerData` call can run ahead of initialization, notably on in-app back-navigation where there is no SSR prerender to supply grid data, and a half-initialized `_isAuthenticated == false` would make the My Schedule branch silently fall through to fetching all sessions. `LoadServerData` (`:234-246`) awaits the events task before entering the base's `LoadServerDataAsync`, because `ApplyAdditionalFilters` runs inside it (`:236-239`), and `FetchSessionsAsync` (`:252-284`) awaits the bookmark task (`:262-265`). `[Rubric §19, State Management & Data Flow]`.
  2. **Two fetch branches, both truly server-paged.** In My Schedule mode with bookmarks present, the page passes the bookmarked ids as `MyScheduleSessionIds` on the [`SessionSchedulePageRequest`](#sessionschedulepagerequest) (`:281`) and the service turns them into a server-side `Id IN (...)` filter so the server still pages (`MMCA.ADC.Conference.UI/Services/Public/IPublicSessionScheduleService.cs:14-19`). An empty bookmark set short-circuits to `([], 0)` (`:269-272`) rather than issuing a query that would return the whole catalog, and the comment records the second reason for that ordering (`:267-268`): it returns *before* the offline snapshot is written, so an empty schedule never overwrites the cached programme. `[Rubric §12, Performance & Scalability]`.
  3. **Audience-scoped filter persistence.** Only privileged readers persist an event choice, expressed as the `persistEventId: _isPrivileged && _eventFilterResolved` argument to [`PublicSessionListFilterState`](#publicsessionlistfilterstate)`.Save` (`:76`), and `ResolveDefaultEventFilter` (`:154-169`) locks everyone else to the computed current or next event via [`CurrentEventDefaults`](group-17-conference-domain.md#currenteventdefaults)`.SelectCurrentOrNext` (`:167`). The comment (`:156-159`) states the security consequence: a shared privileged URL can never pin an attendee to a different or unpublished event, because the `/events` fetch is published-only for them server-side. A privileged reader's restored id survives only if it still exists in the loaded set; a dangling one falls back to the computed default (`:160-165`). `[Rubric §11, Security]` and `[Rubric §26, Front-End Security]`.
  4. **A deep link that beats saved state.** `[SupplyParameterFromQuery(Name = "mine")]` (`:65-66`) carries the MAUI head's home-screen quick action into the My Schedule view, and `OnInitializedAsync` applies it *after* the base has restored saved page state so intent wins (`:88-92`). `[Rubric §25, Navigation & Information Architecture]` and [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 2.
  5. **The offline snapshot lives in the service, not the page.** The section comment (`:286-288`) states the division: [`IPublicSessionScheduleService`](#ipublicsessionscheduleservice) keeps the last successful first page of the programme so a dead venue network still shows a schedule, and only the banner stays here. The page passes `OnCacheStateChanged` into the fetch (`:282`) and that handler flips `_showingCachedData` (`:289`), calling `StateHasChanged()` only on the raise, because the clear rides the render the grid does for the fresh rows anyway (`:296-303`). The chip itself is markup (`PublicSessionList.razor:23-29`). `[Rubric §29, Resilience & Business Continuity]` and [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 3.
- **Walkthrough**
  - `SaveFilters` / `RestoreFilters` (`:73-82`) are two-line delegations to [`PublicSessionListFilterState`](#publicsessionlistfilterstate), the restore destructuring five values straight back into the page's fields (`:80-82`).
  - `LoadEventsAndResolveDefaultAsync` (`:114-148`): resolve privileged status from role membership with a failed read treated as non-privileged (`:116-127`), fetch events with children (`:129`), index every event's rooms into `_roomNames` through [`PublicScheduleRoomOptions`](#publicscheduleroomoptions)`.IndexNames` (`:139`), load the speaker lookup (`:140-143`), then resolve the default event and scope the room options (`:146-147`). A failed events fetch toasts once and deliberately skips the speaker lookup, since it only labels sessions of the events that failed to load (`:132-135`). One children-loaded events fetch plus one speaker lookup replace per-row enrichment calls. `[Rubric §23, Front-End Performance & Rendering]`.
  - `RefreshRoomOptions` (`:151-152`) destructures [`PublicScheduleRoomOptions`](#publicscheduleroomoptions)`.Scope` straight into `_rooms` and `_selectedRoomId`; it runs after the initial load (`:147`) and again on every event-filter change (`:216`).
  - `LoadBookmarkStateAsync` (`:176-204`): reads the identifier through `GetUserId` (`:188`) and loads the bookmarked session ids into the dictionary the view patches in place; a failure is non-critical, so the stars do not appear but the sessions still load (`:193-197`).
  - Filter handlers (`:207-230`) each update one field and call `ReloadViewAsync` (`:232`), which forwards to the view child's `ReloadAsync()` and no-ops when the child is not yet rendered.
  - `ApplyAdditionalFilters` (`:305-323`): `Title contains`, `EventId equals`, and `RoomId equals`. The comment on the room branch (`:317-318`) is worth reading against [`PublicSpeakerList`](#publicspeakerlist): `Session.RoomId` is a real nullable column, so it rides the generic filter pipeline with no virtual-key interception in the controller, unlike the speaker page's `EventId`.
  - `FetchMobilePage` (`:326-335`) awaits the same events task, builds the same filters, and reuses `FetchSessionsAsync`, so both layouts share one fetch implementation including its offline path.
  - The optional Engagement service is resolved with `GetService` (`:86`) for the same reason as on [`PublicSessionDetail`](#publicsessiondetail): `[Inject]` has no optional mode (`:36-37`).
- **Why it's built this way**: this is the highest-traffic page of the conference, viewed on bad networks by both anonymous browsers and signed-in attendees managing a personal schedule. That drives every design decision visible here: server-side everything, one enrichment fetch, ordering guarantees around the grid's eager first call, an audience-locked event filter, a room filter derived from data already in hand, and a cached last-known-good first page owned by the service rather than the page.
- **Where it's used**: the `/conference/sessions` route (`PublicSessionList.razor:1`, matching `ConferenceRoutePaths.PublicSessions` at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:43`), including the `?mine=true` deep link; it renders [`PublicSessionListFilterBar`](#publicsessionlistfilterbar) (`PublicSessionList.razor:11-21`) and [`PublicSessionListView`](#publicsessionlistview) (`:31`) and routes onward to [`PublicSessionDetail`](#publicsessiondetail).

### IOrganizerEventFeedbackUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Feedback` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Feedback/IOrganizerFeedbackUIService.cs:11` · Level 3 · interface

- **What it is**: the organizer-facing contract for **event** feedback moderation: read every answer
  for an event, and delete one (`IOrganizerFeedbackUIService.cs:11-21`). Its doc comment (lines 7-10)
  ties it to business rule BR-53 and states the distinguishing property: unlike the attendee-facing
  service, this returns answers from all users.
- **Depends on**: [EventQuestionAnswerDTO](group-17-conference-domain.md#eventquestionanswerdto), the
  `EventIdentifierType` and `EventQuestionAnswerIdentifierType` aliases, and `Result` / `Result<T>`.
- **Concept introduced, the audience-scoped read contract.** `[Rubric §11, Security]` (assesses
  whether authorization decisions are made by the server rather than assumed by the client: this
  interface is *named* for the organizer audience, but it carries no role logic of its own; the server
  widens the result set for organizer users, and the client simply asks for the full list).
  `[Rubric §9, API & Contract Design]`: a separate contract for the same underlying resource, keyed by
  audience, keeps the attendee path from accidentally acquiring an "all users" read. The delete is a
  moderation action, which is why an otherwise read-only organizer surface has one write.
- **Walkthrough**: two members, both `EventIdentifierType`-scoped.
  - `GetAllAnswersAsync(eventId, ct)` (`IOrganizerFeedbackUIService.cs:13-15`): returns
    `Task<Result<IReadOnlyList<EventQuestionAnswerDTO>>>`, a flat list rather than a paged envelope, so
    paging is the implementation's problem.
  - `DeleteAnswerAsync(eventId, answerId, ct)` (lines 17-20): returns `Task<Result>`, with the event id
    carried alongside the answer id because the endpoint scopes the delete to its parent, the same
    parent-scoped rule the join services follow.
- **Why it's built this way**: exposing `IReadOnlyList<T>` keeps the Blazor grid simple, and the
  implementation absorbs the transport shape; see
  [OrganizerEventFeedbackService](#organizereventfeedbackservice)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Feedback/OrganizerFeedbackService.cs:15-64`)
  for the paged request it actually issues and the ceiling that comes with it.
- **Where it's used**: implemented by [OrganizerEventFeedbackService](#organizereventfeedbackservice),
  registered scoped at `DependencyInjection.cs:41` (whose comment names BR-53 moderation), and injected
  into [OrganizerEventFeedback](#organizereventfeedback)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerEventFeedback.razor.cs:20`).

### IOrganizerSessionFeedbackUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Feedback` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Feedback/IOrganizerFeedbackUIService.cs:27` · Level 3 · interface

- **What it is**: the **session** twin of
  [IOrganizerEventFeedbackUIService](#iorganizereventfeedbackuiservice), the same two operations keyed
  on a session instead of an event (`IOrganizerFeedbackUIService.cs:27-37`), with the same BR-53
  all-users note in its doc comment (lines 23-26).
- **Depends on**: [SessionQuestionAnswerDTO](group-17-conference-domain.md#sessionquestionanswerdto),
  the `SessionIdentifierType` and `SessionQuestionAnswerIdentifierType` aliases, and `Result` /
  `Result<T>`.
- **Concept**: see [IOrganizerEventFeedbackUIService](#iorganizereventfeedbackuiservice) for the
  audience-scoped read contract. `[Rubric §9, API & Contract Design]`.

  | Member | File:Line | Differs from the event twin |
  |--------|-----------|-----------------------------|
  | `GetAllAnswersAsync(sessionId, ct)` | `IOrganizerFeedbackUIService.cs:29-31` | scoped by `SessionIdentifierType`; returns `SessionQuestionAnswerDTO` |
  | `DeleteAnswerAsync(sessionId, answerId, ct)` | `IOrganizerFeedbackUIService.cs:33-36` | parent id is the session |

- **Where it's used**: implemented by
  [OrganizerSessionFeedbackService](#organizersessionfeedbackservice)
  (`OrganizerFeedbackService.cs:66-110`), registered scoped at `DependencyInjection.cs:42`, and
  injected into [OrganizerSessionFeedback](#organizersessionfeedback)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerSessionFeedback.razor.cs:20`).

### SessionFormModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/SessionFormModel.cs:24` · Level 3 · abstract class (form model)

- **What it is**: the session twin of [`EventFormModel`](#eventformmodel). It declares the editable
  session fields once for both the create page and the detail page's inline editor, and it owns the one
  piece of logic a session form needs that an event form does not: rejoining a date picker and a time
  picker into a single timestamp.
- **Depends on**: [`SessionDTO`](group-17-conference-domain.md#sessiondto) for every length cap
  (`MMCA.ADC.Conference.Shared.Sessions`, line 2) and the `Room` identifier alias. Externals:
  `System.ComponentModel.DataAnnotations`.
- **Concept introduced**: the shared-form-model idea is [`EventFormModel`](#eventformmodel)'s. Two
  details are specific to sessions:
  1. **The split date/time pair.** MudBlazor has no single date-and-time control, so a session's
     `StartsAt` and `EndsAt` are each bound as two properties: `StartsAtDate` / `StartsAtTime` and
     `EndsAtDate` / `EndsAtTime` (lines 58-67). `Combine` (line 79) is the `protected static` rejoin,
     and it returns `null` unless **both** halves are set, so a half-entered time leaves the schedule
     unset rather than inventing a midnight. Both derived models call it, so the create page and the
     editor split and rejoin a timestamp identically.
  2. **`SessionTitle` rather than `Title`.** The doc comment (lines 33-35) records the reason: every page
     in this group already has its own localized `Title` property, and SonarAnalyzer S4275 fires on the
     collision. The rename is an analyzer-driven naming choice, not a domain one.
  `[Rubric §24, Forms, Validation & UX Safety]`: the caps are `SessionDTO.TitleMaxLength` and its
  siblings (lines 38, 42, 46, 50, 54), so the browser rejects what the column would reject, and the
  `Combine` rule makes an incomplete timestamp impossible to post by accident.
  `[Rubric §15, Best Practices & Code Quality]` assesses whether the analyzers-as-errors baseline is
  honored rather than suppressed: this is a case where the code changed a name instead of adding a
  `#pragma`.
- **Walkthrough**
  - `SessionTitleRequiredKey` (line 31) is the hoisted resource key, the same technique
    [`EventFormModel`](#eventformmodel) uses.
  - Five annotated text properties (lines 39-55): `SessionTitle` is required, `Description`, `Status`,
    `AccessibilityInfo`, and `ResourceLinks` are optional.
  - Six unannotated properties (lines 58-73): the four date/time halves, `IsServiceSession` (the
    lunch-or-break flag), and the nullable `RoomId`.
  - `Combine(DateTime? date, TimeSpan? time)` (line 79) returns `date.Value.Date + time.Value` when both
    are present, otherwise `null`.
- **Why it's built this way**: sessions carry a schedule that no single control captures, and both edit
  surfaces must split and rejoin it the same way or a session saved from one screen and re-opened on the
  other would move. Putting `Combine` on the base makes that impossible to get wrong per page.
- **Where it's used**: [`SessionCreateModel`](#sessioncreatemodel) and
  [`SessionEditModel`](#sessioneditmodel) derive from it; [`SessionCreate`](#sessioncreate) and
  [`SessionDetail`](#sessiondetail) bind an instance to the shared `SessionFormFields` component
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Session/SessionFormFields.razor`).

### IActivityUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Activities` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Activities/IActivityUIService.cs:9` · Level 4 · interface

- **What it is**: the UI-service contract for the `activities` REST resource (the conference's social
  and networking programme). It is an empty marker interface,
  `public interface IActivityUIService : IEntityService<ActivityDTO, ActivityIdentifierType>`
  (`IActivityUIService.cs:9-11`), that adds no members of its own.
- **Depends on**: [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  (the shared CRUD contract, imported from `MMCA.Common.UI.Common.Interfaces` at
  `IActivityUIService.cs:2`) and [ActivityDTO](group-17-conference-domain.md#activitydto) (the
  transported shape, from `MMCA.ADC.Conference.Shared.Activities` at `IActivityUIService.cs:1`).
  `ActivityIdentifierType` is the module id alias.
- **Concept introduced, the per-entity marker UI-service interface.** `[Rubric §18, UI Architecture]`
  assesses whether the front end talks to a typed service abstraction rather than a raw `HttpClient`;
  here every Blazor page injects an *interface*, never the concrete HTTP class. `[Rubric §1, SOLID]`
  assesses interface segregation at the injection point: the marker gives each aggregate its own name to
  depend on even though the shape is entirely inherited. The generic CRUD surface all comes from
  [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype),
  whose seven members (`GetAllAsync`, `GetPagedAsync`, `GetAllForLookupAsync`, `GetByIdAsync`,
  `AddAsync`, `UpdateAsync`, `DeleteAsync`) every one return a
  [Result](group-01-result-error-handling.md#result): the same railway value the server produced, read
  back from its Problem Details response with the original
  [ErrorType](group-01-result-error-handling.md#errortype) intact, so a page branches on an outcome
  instead of catching an exception
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IEntityService.cs:10-16,25-68`).
  There is a second, load-bearing reason for the body-less specialization: registration is done by a
  Scrutor assembly scan, not by hand. `AddUIModule<ConferenceUIModule>()` scans the Conference UI
  assembly for every `IEntityService<,>` implementation and registers it with a scoped lifetime
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:27-29`), so the
  named marker is exactly what a page gets to inject. Every plain-CRUD sibling in this group repeats
  this shape.
- **Walkthrough**: no members. The whole contract is "be an `IEntityService` bound to `ActivityDTO` plus
  `ActivityIdentifierType`, under a name pages can inject". The doc comment
  (`IActivityUIService.cs:6-8`) states plainly that it "uses generic CRUD".
- **Why it's built this way**: a named per-entity interface (rather than injecting the open generic
  directly) keeps the scan's registration unambiguous, and it lets one entity later grow an extra method
  without disturbing the others, which is exactly what [IEventUIService](#ieventuiservice),
  [IRoomUIService](#iroomuiservice) and [ISpeakerUIService](#ispeakeruiservice) did.
- **Where it's used**: implemented by [ActivityService](#activityservice); injected into the organizer
  activity list, detail and create pages (`Pages/Activity/ActivityList.razor.cs:24`,
  `Pages/Activity/ActivityDetail.razor.cs:23`, `Pages/Activity/ActivityCreate.razor.cs:20`) and into the
  anonymous [PublicActivityList](#publicactivitylist)
  (`Pages/Public/PublicActivityList.razor.cs:27`). Note that the *same* contract serves both audiences:
  the client does not scope the data, the server does.

### IQuestionUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Questions/IQuestionUIService.cs:9` · Level 4 · interface

- **What it is**: the UI-service contract for the `questions` resource, an empty marker over
  [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [QuestionDTO](group-17-conference-domain.md#questiondto) (`IQuestionUIService.cs:9-11`).
- **Depends on**: [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  and [QuestionDTO](group-17-conference-domain.md#questiondto).
- **Concept**: the same marker shape as [IActivityUIService](#iactivityuiservice).
  `[Rubric §18, UI Architecture]`.
- **Walkthrough**: no members (doc comment `IQuestionUIService.cs:6-8`).
- **Where it's used**: implemented by [QuestionService](#questionservice); injected into the question
  list, detail and create pages (`Pages/Question/QuestionList.razor.cs:16`,
  `Pages/Question/QuestionDetail.razor.cs:18`, `Pages/Question/QuestionCreate.razor.cs:13`), into both
  organizer feedback pages, which need the question text to label the answers
  (`Pages/Feedback/OrganizerEventFeedback.razor.cs:19`,
  `Pages/Feedback/OrganizerSessionFeedback.razor.cs:19`), taken as an argument by the shared
  [FeedbackQuestionLoader](#feedbackquestionloader) (`Pages/Feedback/FeedbackQuestionLoader.cs:36`), and
  composed as the third load inside [SpeakerDetailLookupService](#speakerdetaillookupservice)
  (`Services/SpeakerDetailLookupService.cs:14,32`).

### OrganizerEventFeedbackService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Feedback` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Feedback/OrganizerFeedbackService.cs:15` · Level 4 · class (sealed)

- **What it is**: an authenticated HTTP service that reads and deletes **event** feedback answers on
  behalf of an organizer, who sees all answers (`OrganizerFeedbackService.cs:15-61`). It implements
  [IOrganizerEventFeedbackUIService](#iorganizereventfeedbackuiservice).
- **Depends on**: [AuthenticatedServiceBase](group-15-common-ui-framework.md#authenticatedservicebase)
  (its base, supplying `CreateAuthenticatedClientAsync()` at
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:51` and the
  shared static Polly `RetryPolicy` at `:25`),
  [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) (the bearer-token
  source), [HttpResultExecutor](group-15-common-ui-framework.md#httpresultexecutor) and
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader) (the railway conversion),
  [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) (the paged
  envelope) and [EventQuestionAnswerDTO](group-17-conference-domain.md#eventquestionanswerdto). BCL
  `IHttpClientFactory`, `System.Globalization` (`OrganizerFeedbackService.cs:1-7`).
- **Concept introduced, the authenticated organizer read-service over a token-carrying HttpClient.**
  `[Rubric §18, UI Architecture]` and `[Rubric §11, Security]` assess how UI calls attach auth and
  handle failures. The class derives from
  [AuthenticatedServiceBase](group-15-common-ui-framework.md#authenticatedservicebase) through a primary
  constructor that forwards `IHttpClientFactory` and
  [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) to the base
  (`OrganizerFeedbackService.cs:15-17`); every request goes through `CreateAuthenticatedClientAsync()`
  (`:31,53`), so the JWT is attached centrally rather than per call. The doc comment
  (`OrganizerFeedbackService.cs:11-14`) records the authorization intent: organizers see all answers
  because the server-side specification is null for organizer users, so this client simply requests the
  full paged set and does no filtering of its own. Note the direction of trust: the client is not the
  thing granting the wide view, the server is. The `filters[...]` query grammar it uses (`:26`) is the
  same dynamic-filter contract the Conference REST controllers expose
  ([ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html)), so the client
  needs no bespoke endpoint for a one-off filter.
- **Walkthrough**
  - `Endpoint` (`OrganizerFeedbackService.cs:19`): the `private const string "eventquestionanswers"`
    resource root.
  - `GetAllAnswersAsync(eventId, ct)` (`:21-41`): builds
    `{Endpoint}/paged?filters[EventId].operator=equals&filters[EventId].value={eventId}&pageSize=500&includeChildren=false`
    with `string.Create(CultureInfo.InvariantCulture, ...)` (`:25-26`, culture-invariant so the id
    renders stably); runs the GET inside `HttpResultExecutor.ExecuteAsync` (`:28`) with the request
    itself wrapped in `RetryPolicy.ExecuteAsync` (`:32-34`); reads the response through
    `ProblemDetailsResultReader.ReadAsync<PagedCollectionResult<EventQuestionAnswerDTO>>` (`:35-36`);
    then `Map`s the successful envelope down to its `Items`, or an empty list when the body carried none
    (`:40`). The nesting order is the point: the reader turns any *response* into a
    [Result](group-01-result-error-handling.md#result), the executor turns the *absence* of a response
    into one, and the retry policy sits inside both.
  - `DeleteAnswerAsync(eventId, answerId, ct)` (`:43-60`): builds `{Endpoint}/{answerId}?eventId={eventId}`
    (`:48`, the event id is a required query argument, mirroring the parent-scoped delete shape of
    [IRoomUIService](#iroomuiservice)), issues the DELETE through the same executor plus retry pair
    (`:50-56`), and reads the valueless response through `ProblemDetailsResultReader.ReadAsync`
    (`:57`). It returns a bare `Result`: success is "the server accepted the delete", and a domain
    refusal comes back as a typed failure, not an exception.
- **Why it's built this way**: inheriting the authenticated base means token attachment and the Polly
  retry live in one shared place, and the service owns only the URL shapes and the organizer-sees-all
  read. Asking for `pageSize=500` in a single call keeps the organizer feedback grid simple (no
  client-side paging) at the cost of a hard ceiling, see the caveat.
- **Where it's used**: registered explicitly as
  [IOrganizerEventFeedbackUIService](#iorganizereventfeedbackuiservice) under a comment naming BR-53
  moderation (`DependencyInjection.cs:40-41`) and injected into
  [OrganizerEventFeedback](#organizereventfeedback)
  (`Pages/Feedback/OrganizerEventFeedback.razor.cs:18`). Its structural twin
  [OrganizerSessionFeedbackService](#organizersessionfeedbackservice) shares the same file
  (`OrganizerFeedbackService.cs:66`) and differs only in resource root, filter key and delete scope.
  It is covered by `OrganizerEventFeedbackServiceTests` in the Conference UI test project.
- **Caveats / not-in-source**: the read is capped at `pageSize=500` (`OrganizerFeedbackService.cs:26`);
  an event with more than 500 answers would be truncated, and there is no follow-on paging in this
  method. Whether the server would actually return that many is not determinable from this file: the
  page-size ceiling on the endpoint side is enforced elsewhere.

### OrganizerSessionFeedbackService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Feedback` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Feedback/OrganizerFeedbackService.cs:66` · Level 4 · class (sealed)

- **What it is**: the organizer-side read-and-moderate service for **session** feedback. It fetches every
  answer captured against one session and deletes an individual answer. It is the structural twin of
  [`OrganizerEventFeedbackService`](#organizereventfeedbackservice) in the same file, keyed on `SessionId`
  and the `sessionquestionanswers` resource (`OrganizerFeedbackService.cs:66-112`), and it implements
  [`IOrganizerSessionFeedbackUIService`](#iorganizersessionfeedbackuiservice).
- **Depends on**: [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase)
  as its base (`OrganizerFeedbackService.cs:68`), for `CreateAuthenticatedClientAsync()` and the shared
  static Polly `RetryPolicy`; [`HttpResultExecutor`](group-15-common-ui-framework.md#httpresultexecutor)
  and [`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader) for the two halves of
  the Result conversion;
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) as the paged
  envelope; [`SessionQuestionAnswerDTO`](group-17-conference-domain.md#sessionquestionanswerdto) as the
  row shape; [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) through the
  base; the `SessionIdentifierType` / `SessionQuestionAnswerIdentifierType` aliases; BCL
  `IHttpClientFactory` and `CultureInfo.InvariantCulture`.
- **Concept introduced, the two-half Result conversion in a hand-rolled HTTP service.** This class does
  not extend the CRUD base, so it must do for itself what
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  does for its leaves: turn every possible outcome into a
  [`Result`](group-01-result-error-handling.md#result) instead of an exception. Two collaborators split
  that job, and both are required for the signature to be honest.
  [`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader) converts a **response**: it
  reads the API's ProblemDetails body and preserves the server's own
  [`ErrorType`](group-01-result-error-handling.md#errortype), so a refusal from the moderation policy
  arrives as a typed failure the page can render.
  [`HttpResultExecutor`](group-15-common-ui-framework.md#httpresultexecutor) converts the **absence** of
  one: a refused connection, a DNS failure, a dropped socket, a client-side timeout, each mapped to a
  transport or timeout failure
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/HttpResultExecutor.cs:34,37,121-130`). Caller
  cancellation is deliberately excluded and rethrows (`HttpResultExecutor.cs:65-68`), because a page owns
  its own cancellation (a disposed component, a superseded fetch) and must not have it reported back as
  an error to render. `[Rubric §29, Resilience, Reliability & Business Continuity]` (assesses whether error handling is a
  factored concern rather than per-call-site improvisation; here it is two reusable helpers wrapped
  around each call). `[Rubric §24, Forms/Validation/UX Safety]` (assesses whether the user is shown a
  meaningful, safe message; the reader's typed error is what the feedback page renders instead of a raw
  exception).
- **Sibling family**: the file holds two services with the same shape at different resource roots, which
  is why they share a file.

  | Type | File:Line | Notes (what differs) |
  |------|-----------|----------------------|
  | `OrganizerEventFeedbackService` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Feedback/OrganizerFeedbackService.cs:15` | `eventquestionanswers` root (`:19`); filters on `EventId` (`:26`); delete scoped `?eventId=` (`:48`) |
  | `OrganizerSessionFeedbackService` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Feedback/OrganizerFeedbackService.cs:66` | `sessionquestionanswers` root (`:70`); filters on `SessionId` (`:77`); delete scoped `?sessionId=` (`:99`) |

- **Walkthrough**
  - `private const string Endpoint = "sessionquestionanswers"` (`OrganizerFeedbackService.cs:70`): the
    resource root, held as a constant rather than passed to a base constructor, because there is no CRUD
    base to pass it to.
  - `GetAllAnswersAsync(sessionId, ct)` (`OrganizerFeedbackService.cs:72-92`) builds
    `{Endpoint}/paged?filters[SessionId].operator=equals&filters[SessionId].value={sessionId}&pageSize=500&includeChildren=false`
    with `string.Create(CultureInfo.InvariantCulture, ...)`, so the id never formats under the user's
    locale (`:76-77`). It runs the call inside
    [`HttpResultExecutor`](group-15-common-ui-framework.md#httpresultexecutor)`.ExecuteAsync` (`:79`),
    creates the bearer-carrying client (`:82`), issues the GET through the inherited Polly `RetryPolicy`
    (`:83-85`), reads the response into a `Result<PagedCollectionResult<SessionQuestionAnswerDTO>>`
    (`:86-87`), and maps the envelope down to the item list the page wants, substituting an empty list
    for a null `Items` (`:91`). The filter goes to the server, not to memory: the organizer's grid never
    pulls the whole answer table.
  - `DeleteAnswerAsync(sessionId, answerId, ct)` (`OrganizerFeedbackService.cs:94-111`) builds
    `{Endpoint}/{answerId}?sessionId={sessionId}` (`:99`) and DELETEs it through the same executor,
    client and retry policy (`:101-107`), returning the valueless
    [`Result`](group-01-result-error-handling.md#result) the reader produces (`:108`). The parent
    `sessionId` is not decoration: the API removes a child row by loading the owning aggregate, so a
    delete sent without it addresses nothing.
- **Why it's built this way**: two small parallel classes are cheaper to read than one generic service
  parameterized over "the parent key", and each one's URL shape stays literal and greppable. The class
  extends the authenticated base rather than the CRUD base because moderation is a two-verb surface, not
  an entity surface: there is no add, no update, and no lookup projection.
- **Where it's used**: registered explicitly (it is not an `IEntityService<,>` implementation, so the
  assembly scan does not see it) as
  [`IOrganizerSessionFeedbackUIService`](#iorganizersessionfeedbackuiservice) at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:42`, under the
  comment naming BR-53 moderation (`DependencyInjection.cs:40`), and injected into
  [`OrganizerSessionFeedback`](#organizersessionfeedback)
  (`Pages/Feedback/OrganizerSessionFeedback.razor.cs:18`).
- **Caveats / not-in-source**: the read is capped at `pageSize=500` in a single call
  (`OrganizerFeedbackService.cs:77`) with no follow-on paging, so a session with more than 500 captured
  answers would be truncated in the organizer grid, and nothing in this class detects the truncation.

### SessionCreateModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/SessionCreateModel.cs:11` · Level 4 · sealed class (form model)

- **What it is**: the create-side concrete of [`SessionFormModel`](#sessionformmodel). One method,
  `ToNew`, turns the entered fields plus the event the organizer filed the session against into the DTO
  the create posts.
- **Depends on**: [`SessionFormModel`](#sessionformmodel) and
  [`SessionDTO`](group-17-conference-domain.md#sessiondto) (line 1), plus the `Event` identifier alias.
  Externals: `System.Security.Cryptography.RandomNumberGenerator`.
- **Concept introduced, the client-minted identifier.** Unlike
  [`EventCreateModel`](#eventcreatemodel), which posts `Id = default`, this model fabricates one:
  `RandomNumberGenerator.GetInt32(100_000, int.MaxValue)` (line 23). The reason is that a session's `int`
  primary key **is** its Sessionize id, so the column is app-assigned rather than database-generated.
  [`CreateSessionHandler`](group-18-conference-application.md#createsessionhandler) only auto-allocates
  from the reserved manual range when `command.Id == default` and otherwise respects an explicit id
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Create/CreateSessionHandler.cs:79-95`),
  so the value this model generates is what gets persisted. The page still reads `created.Id` back off
  the response before navigating (`.../Pages/Session/SessionCreate.razor.cs:158`), so it behaves
  correctly either way.
  `[Rubric §8, Data Architecture]`: identifier assignment is an explicit, documented policy per aggregate
  rather than an implicit database default, which is what lets Sessionize-imported and organizer-created
  sessions share one key space.
- **Walkthrough**
  - `ToNew(EventIdentifierType eventId)` (lines 20-31): the generated `Id` (line 23), `Title` from the
    base's `SessionTitle` (line 24), the owning `EventId` from the parameter (line 26), the optional
    `RoomId` (line 27), `StartsAt` and `EndsAt` each through the base's `Combine` (lines 28-29), and
    `IsServiceSession` (line 30).
  - The `Status`, `AccessibilityInfo`, and `ResourceLinks` properties the base declares are not written
    here: they are edit-time fields, so a newly created session carries none of them.
- **Why it's built this way**: sessions live in a key space shared with Sessionize, so the client cannot
  simply post a placeholder and let the database pick; and a schedule half is only sent when it is
  complete, so an organizer who picks a date but no time gets an unscheduled session rather than one
  silently pinned to midnight.
- **Where it's used**: the `_model` field of [`SessionCreate`](#sessioncreate)
  (`.../Pages/Session/SessionCreate.razor.cs:33`), consumed by its `CreateSessionAsync`
  (`.../Pages/Session/SessionCreate.razor.cs:149`).

### SessionEditModel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/SessionEditModel.cs:16` · Level 4 · sealed class (form model)

- **What it is**: the edit-side concrete of [`SessionFormModel`](#sessionformmodel), used by
  [`SessionDetail`](#sessiondetail)'s inline editor. `LoadFrom` opens the editor and `ToUpdated` closes
  it, replacing what the class doc calls thirteen assignments in the page each way (lines 11-14).
- **Depends on**: [`SessionFormModel`](#sessionformmodel) and
  [`SessionDTO`](group-17-conference-domain.md#sessiondto) (line 1).
- **Concept introduced**: none new. The shadow-editing-through-a-model idea is
  [`EventEditModel`](#eventeditmodel)'s, and the split-timestamp handling is
  [`SessionFormModel`](#sessionformmodel)'s. What is worth naming is the symmetry: `LoadFrom` **splits**
  each timestamp with `?.Date` and `?.TimeOfDay` (lines 29-32) and `ToUpdated` **rejoins** it with
  `Combine` (lines 59-60), so an untouched session round-trips to the same value.
  `[Rubric §8, Data Architecture]`: `ToUpdated` re-sends the loaded `RowVersion` (line 54), the
  optimistic-concurrency token of ADR-035.
- **Walkthrough**
  - `LoadFrom(SessionDTO session)` (lines 23-38): null guard, then eleven copies, including the four
    schedule halves (lines 29-32) and the `RoomId` (line 37).
  - `ToUpdated(SessionDTO session)` (lines 47-65): identity and concurrency off the source (`Id` line 53,
    `RowVersion` line 54, `EventId` line 57), the edited values off the model, and the two rejoined
    timestamps (lines 59-60). A schedule half left blank sends `null`, which **clears** the stored
    timestamp rather than preserving it, and the doc comment says so (lines 42-43).
  - The class doc (lines 8-10) records the deliberate omission: the owning event is displayed but never
    edited, because moving a session between events is a create plus a delete.
- **Why it's built this way**: the session form has thirteen editable values and two of them are
  composites, so a hand-written transcription in the page is the most likely place for a dropped field.
  One method each way makes the round trip verifiable by reading two adjacent blocks.
- **Where it's used**: the `_model` field of [`SessionDetail`](#sessiondetail)
  (`.../Pages/Session/SessionDetail.razor.cs:74`), driven by its `StartEditing`
  (`.../Pages/Session/SessionDetail.razor.cs:166`) and `SaveChangesAsync`
  (`.../Pages/Session/SessionDetail.razor.cs:187`).

### ActivityService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Activities` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Activities/ActivityService.cs:10` · Level 5 · class (sealed)

- **What it is**: the concrete HTTP service for the `activities` resource, a body-less class that
  inherits every CRUD method from the shared base and supplies only the endpoint name
  (`ActivityService.cs:10-14`). It implements [`IActivityUIService`](#iactivityuiservice).
- **Depends on**:
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  as its base (from `MMCA.Common.UI.Services`, `ActivityService.cs:2`);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) (from
  `MMCA.Common.UI.Services.Auth`, `ActivityService.cs:3`);
  [`ActivityDTO`](group-17-conference-domain.md#activitydto); BCL `IHttpClientFactory`.
- **Concept introduced, the four-line concrete UI service (Template Method with a supplied endpoint).**
  The primary constructor forwards `IHttpClientFactory` and
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) plus the literal
  resource name `"activities"` to
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  closed over [`ActivityDTO`](group-17-conference-domain.md#activitydto) and `ActivityIdentifierType`
  (`ActivityService.cs:10-12`); the class body is empty (`:13-14`). Everything a page calls
  (`GetAllAsync`, `GetPagedAsync`, `GetByIdAsync`, `GetAllForLookupAsync`, `AddAsync`, `UpdateAsync`,
  `DeleteAsync`) lives on the base
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:61,79,120,131,150,176,203`),
  along with the auth, the Polly retry, the read cache, the conditional-write header and the Result
  conversion. Two base behaviors are worth knowing here, because the leaf inherits them for free: a
  create attaches a fresh `Idempotency-Key` held constant across retries
  (`EntityServiceBase.cs:159-164`), and an update sends the DTO's concurrency token as `If-Match`
  (`EntityServiceBase.cs:184`, ADR-035). `[Rubric §2, Design Patterns]` (assesses whether a shared
  algorithm is factored once and specialized by leaves; the base owns the CRUD algorithm and the leaf
  supplies the resource name, a textbook Template Method) and `[Rubric §15, Best Practices & Code Quality]` (assesses
  the cost of one more like-for-like feature; a new plain-CRUD resource costs one tiny class).
- **Walkthrough**: no members. The whole class is the base call carrying the resource root `"activities"`
  and the declaration that it satisfies [`IActivityUIService`](#iactivityuiservice)
  (`ActivityService.cs:11-12`). The doc comment (`:7-9`) says only that it provides standard CRUD.
- **Why it's built this way**: the endpoint name is the only thing that varies for a plain CRUD
  aggregate, so the concrete class carries exactly that and nothing else. `sealed`
  (`ActivityService.cs:10`) closes the leaf: specialization belongs on the interface or in the base, not
  in a subclass of a subclass.
- **Where it's used**: never named in DI by hand. Because it is an `IEntityService<,>` implementation in
  the Conference UI assembly, the Scrutor scan inside `AddUIModule<ConferenceUIModule>()` registers it
  `AsImplementedInterfaces()` with a scoped lifetime
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:29` calling
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:207-213`), which is what makes
  [`IActivityUIService`](#iactivityuiservice) resolvable in [`ActivityList`](#activitylist)
  (`Pages/Activity/ActivityList.razor.cs:24`), [`ActivityDetail`](#activitydetail)
  (`Pages/Activity/ActivityDetail.razor.cs:23`), [`ActivityCreate`](#activitycreate)
  (`Pages/Activity/ActivityCreate.razor.cs:20`) and [`PublicActivityList`](#publicactivitylist)
  (`Pages/Public/PublicActivityList.razor.cs:27`).

### QuestionService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Questions/QuestionService.cs:10` · Level 5 · class (sealed)

- **What it is**: a body-less concrete CRUD service for the `questions` WebAPI resource. It extends
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  over [`QuestionDTO`](group-17-conference-domain.md#questiondto) and `QuestionIdentifierType`, passes the
  resource name to the base constructor, and implements the equally empty
  [`IQuestionUIService`](#iquestionuiservice), inheriting the entire CRUD implementation with no added
  code (`QuestionService.cs:10-14`).
- **Depends on**:
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`QuestionDTO`](group-17-conference-domain.md#questiondto);
  [`IQuestionUIService`](#iquestionuiservice); BCL `IHttpClientFactory`.
- **Concept**: the thin-leaf CRUD service taught at [`ActivityService`](#activityservice), over a
  different resource. `[Rubric §2, Design Patterns]`, `[Rubric §15, Best Practices & Code Quality]`.
- **Walkthrough**: a primary-constructor class whose base call is the only content
  (`QuestionService.cs:10-12`): `EntityServiceBase<QuestionDTO, QuestionIdentifierType>("questions",
  httpClientFactory, tokenStorageService)`, with an empty body (`:13-14`).
- **Why it's built this way**: questions need nothing beyond CRUD in the UI, so an empty subclass is the
  smallest concrete type that still gives DI a binding for
  [`IQuestionUIService`](#iquestionuiservice) and keeps the resource name in exactly one place.
- **Where it's used**: picked up automatically by the Scrutor scan inside
  `AddUIModule<ConferenceUIModule>()`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:29`), so no explicit
  `AddScoped` line exists for it. Injected as [`IQuestionUIService`](#iquestionuiservice) into
  [`QuestionList`](#questionlist) (`Pages/Question/QuestionList.razor.cs:16`),
  [`QuestionDetail`](#questiondetail) (`Pages/Question/QuestionDetail.razor.cs:18`),
  [`QuestionCreate`](#questioncreate) (`Pages/Question/QuestionCreate.razor.cs:13`),
  [`OrganizerEventFeedback`](#organizereventfeedback)
  (`Pages/Feedback/OrganizerEventFeedback.razor.cs:19`) and
  [`OrganizerSessionFeedback`](#organizersessionfeedback)
  (`Pages/Feedback/OrganizerSessionFeedback.razor.cs:19`), where the question text labels each captured
  answer.

### SessionLookups

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/SessionLookups.cs:32` · Level 5 · sealed class (page collaborator)

- **What it is**: the display-enrichment layer behind [`SessionDetail`](#sessiondetail). It holds the
  three global lookup dictionaries (events, speakers, category items) plus the room list of the loaded
  session's event, and exposes the naming and "not yet assigned" queries the page renders from.
- **Depends on**: four service clients taken as primary-constructor parameters (lines 29-33),
  [`IEventLookupService`](#ieventlookupservice), [`ISpeakerLookupService`](#ispeakerlookupservice),
  [`ICategoryItemLookupService`](#icategoryitemlookupservice), and
  [`IRoomUIService`](#iroomuiservice); the [`EventInfo`](#eventinfo), [`SpeakerInfo`](#speakerinfo), and
  [`CategoryItemInfo`](#categoryiteminfo) lookup records;
  [`RoomDTO`](group-17-conference-domain.md#roomdto); and
  [`Result`](group-01-result-error-handling.md#result) (line 4). Externals:
  `System.Globalization.CultureInfo`.
- **Concept introduced, the page-owned collaborator with an input-keyed cache.** Two ideas make this
  class worth reading:
  1. **Not a registered service, deliberately.** The `<remarks>` (lines 15-19) says it caches per **page
     instance**, because the underlying lookup services already do their own scope-wide caching; holding
     it here keeps the page's own state down to the session being edited. So it is constructed in the
     page's `OnInitialized` (`.../Pages/Session/SessionDetail.razor.cs:52-53`) rather than injected.
     `[Rubric §19, State Management & Data Flow]` assesses where view state lives and how long it lives:
     this puts derived display state at exactly the lifetime that needs it.
  2. **The room cache is keyed by the event it was fetched for.** The three global dictionaries are
     hydrated once each with a null check (lines 64, 73, 82), but rooms are per event, so `_roomNames`
     is paired with `_roomsForEventId` (line 43) and refetched whenever the loaded session belongs to a
     different event. The in-code comment (lines 40-42) records the exact bug the key prevents:
     navigating to a session in another event would otherwise render the previous event's room names and
     offer its rooms in the edit picker.
  A third, quieter rule runs through every accessor: **every name falls back to the identifier**
  (lines 131, 137, 146, 156), so a failed lookup load degrades to raw ids instead of an empty cell
  (`<remarks>`, lines 20-23). `[Rubric §29, Resilience & Business Continuity]` assesses graceful
  degradation: a non-critical enrichment failure costs readability, not the page.
- **Walkthrough**
  - State: three nullable `IReadOnlyDictionary` fields (lines 35-37), the room-name dictionary (line 38),
    and the event key (line 43).
  - `EditableRooms` (line 49) is the room list the edit picker binds, initialized to an empty array so the
    picker renders no options rather than needing a null check per render. `HasMultipleEvents` (line 54)
    is true only when more than one event exists, which is when naming a session's event earns a row in
    the detail table (`.../Pages/Session/SessionDetail.razor:71-73`).
  - `LoadGlobalAsync(CancellationToken)` (lines 62-92) loads each of the three dictionaries at most once
    and returns the **first** failure unchanged, so the page reports the real error rather than a generic
    one.
  - `LoadRoomsAsync(EventIdentifierType, CancellationToken)` (lines 101-125) short-circuits when the
    cached list is already for that event (lines 104-107), otherwise fetches up to 500 rooms filtered by
    `EventId equals <id>` (lines 109-115) and assigns `_roomNames`, `EditableRooms`, and
    `_roomsForEventId` together (lines 121-123).
  - Naming: `EventName` (line 130), `SpeakerName` (line 136), `CategoryItemName` (line 142), and
    `RoomName` (line 155). `Describe` (line 161) is the shared qualifier that renders a category item as
    `"Category: Item"` when the category has a title and just the item name otherwise (line 165).
  - Picker sources: `SpeakersExcept` (lines 171-180) and `CategoryItemsExcept` (lines 185-194) subtract
    the already-assigned ids through a `HashSet` so the add pickers never offer a duplicate, and return
    an empty sequence while the lookup is unloaded.
- **Why it's built this way**: [`SessionDetail`](#sessiondetail) is the join-heaviest page in the module,
  and without this class its code-behind would carry four dictionaries, a cache key, six naming methods,
  and two set-difference queries on top of load, edit, save, delete, and two join editors. Extracting the
  enrichment leaves the page with orchestration only. The class stays ADC-local rather than moving to
  `MMCA.Common` because it is shaped entirely by Conference's own lookup services.
- **Where it's used**: [`SessionDetail`](#sessiondetail) only
  (`.../Pages/Session/SessionDetail.razor.cs:40`, constructed at lines 52-53), and read throughout its
  template (`.../Pages/Session/SessionDetail.razor:37, 71-75, 101-106, 136`).

### SessionCreate

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/SessionCreate.razor.cs:19` · Level 6 · class (Blazor code-behind)

- **What it is**: the organizer form that creates a session. It collects the shared
  [`SessionCreateModel`](#sessioncreatemodel) fields plus the owning event, posts the new record, and
  redirects to that session's detail page. It is the clearest place to see the one thing that makes
  session editing awkward: a **dependent lookup**, because rooms belong to the chosen event.
- **Depends on**: [`ISessionUIService`](#isessionuiservice) (line 19),
  [`IEventLookupService`](#ieventlookupservice) returning [`EventInfo`](#eventinfo) (line 20),
  [`IRoomUIService`](#iroomuiservice) for the room dropdown (line 21),
  [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 23),
  [`SessionCreateModel`](#sessioncreatemodel) (line 33),
  [`RoomDTO`](group-17-conference-domain.md#roomdto),
  [`ModelValidation`](group-15-common-ui-framework.md#modelvalidation) plus
  [`DataAnnotationsModelValidator`](group-15-common-ui-framework.md#dataannotationsmodelvalidator)
  (line 57), [`ConferenceRoutePaths`](#conferenceroutepaths), and
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 142). It uses the `Event`,
  `Room`, and `Session` identifier aliases. Externals: Blazor (`[Inject]`, `NavigationManager`),
  MudBlazor (`MudForm`, `BreadcrumbItem`), `System.Globalization.CultureInfo`, and the
  `IStringLocalizer<SessionCreate>` injected by the template
  (`.../Pages/Session/SessionCreate.razor:7`).
- **Concept introduced, the dependent lookup.** The create-form shape itself is
  [`EventCreate`](#eventcreate)'s; what is new here is that one field's options depend on another field's
  value. `LoadRoomsAsync` (lines 87-110) fetches rooms filtered by the selected event, and
  `OnEventChangedAsync` (lines 114-130) reloads them and clears the previous choice whenever the event
  changes. The doc comment (lines 82-86) records why this is not cosmetic: BR-130 rejects a room from
  another event server-side, so the dropdown must only ever offer rooms of the chosen event.
  `[Rubric §24, Forms, Validation & UX Safety]`: the client is shaped so it cannot compose a request the
  server will refuse.
  `[Rubric §19, State Management & Data Flow]`: `_rooms` is derived state, explicitly invalidated when
  its input changes rather than left to go stale, and `_model.RoomId` is nulled alongside it (line 120)
  with an in-code note that keeping it would have the server reject the save.
  A second idea belongs to the model rather than the page: [`SessionCreateModel`](#sessioncreatemodel)
  mints the identifier client-side, which is the opposite choice from
  [`EventCreate`](#eventcreate)'s `Id = default`.
- **Walkthrough**
  - `OnInitializedAsync` (lines 47-80) builds the breadcrumb trail (lines 49-54), wires the validation
    delegate (line 57), loads the event lookup and toasts `Snackbar.LoadLookupsFailed` on failure
    (lines 61-67), **auto-selects the only event** when the lookup has exactly one entry (lines 69-72,
    the same single-conference convenience as [`RoomCreate`](#roomcreate)), then calls `LoadRoomsAsync`.
  - `LoadRoomsAsync` (lines 87-110): with no event chosen it clears `_rooms` and returns (lines 89-93);
    otherwise it fetches up to 500 rooms filtered by `EventId equals <selected>` (lines 95-100). On
    failure it toasts and **leaves the previously offered rooms in place** (lines 101-107).
  - `CreateSessionAsync` (lines 132-168) validates the form, sets `IsSaving`, posts
    `_model.ToNew(_eventId)` (line 149), clears `_isDirty`, toasts success, and navigates to
    `ConferenceRoutePaths.SessionDetails(createdSession.Id)` (line 158). The `finally` always clears
    `IsSaving`.
  - The template shows the event picker only when it is worth showing,
    `ShowEventPicker="@(_eventLookup is not null && _eventLookup.Count > 1)"`
    (`.../Pages/Session/SessionCreate.razor:29`), and passes `_rooms` plus
    `RoomPickerBeforeSchedule="true"` so the dependent field is chosen before the schedule
    (`.../Pages/Session/SessionCreate.razor:31`).
- **Why it's built this way**: one create-form shape (validate, post, redirect to detail) is reused across
  the Conference entities so behavior stays uniform; the split date/time editing exists because MudBlazor
  has no single date-time picker, so [`SessionFormModel`](#sessionformmodel) composes two controls and
  recombines them defensively; and the event-scoped room reload keeps the client from ever offering a
  value the server will reject.
- **Where it's used**: the `/sessions/create` route (`.../Pages/Session/SessionCreate.razor:1`), reached
  from [`SessionList`](#sessionlist)'s create button; on success it hands off to
  [`SessionDetail`](#sessiondetail).

### SessionDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/SessionDetail.razor.cs:24` · Level 9 · class (Blazor code-behind)

- **What it is**: the organizer's full **session editor**: load one session by route id, inline-edit it,
  delete it, and manage its two child collections (speakers and category items), with event, room,
  speaker, and category names resolved through [`SessionLookups`](#sessionlookups). It is the
  join-heaviest detail page in the Conference UI.
- **Depends on**: [`DetailPageBase`](#detailpagebase) (`@inherits`,
  `.../Pages/Session/SessionDetail.razor:6`); seven service clients,
  [`ISessionUIService`](#isessionuiservice), [`IEventLookupService`](#ieventlookupservice),
  [`ISpeakerLookupService`](#ispeakerlookupservice),
  [`ICategoryItemLookupService`](#icategoryitemlookupservice),
  [`ISessionSpeakerUIService`](#isessionspeakeruiservice),
  [`ISessionCategoryItemUIService`](#isessioncategoryitemuiservice), and
  [`IRoomUIService`](#iroomuiservice) (lines 23-29), plus
  [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 31);
  [`SessionLookups`](#sessionlookups) (line 40) and [`SessionEditModel`](#sessioneditmodel) (line 74);
  the [`SessionDTO`](group-17-conference-domain.md#sessiondto) shape and the
  [`SpeakerInfo`](#speakerinfo) / [`CategoryItemInfo`](#categoryiteminfo) lookup records;
  [`Result`](group-01-result-error-handling.md#result),
  [`ResultUiExtensions`](group-15-common-ui-framework.md#resultuiextensions)`.NotifyOnFailure`,
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 113), the `DeleteConfirmation`
  component, and [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Parse<T>` extension
  (line 5). Uses the
  `Event`/`Room`/`Speaker`/`Session`/`SessionSpeaker`/`SessionCategoryItem`/`CategoryItem` aliases.
- **Concept introduced, the load generation and the join-collection editor.** The route-id parsing,
  load-once-on-parameters, and model-based shadow editing are [`EventDetail`](#eventdetail)'s. Two things
  are new:
  1. **A monotonic load generation.** `LoadAsync` increments `_loadGeneration` on entry and captures the
     value (line 99), then re-checks it after each of its three awaits (lines 105, 126, 137) and drops
     its results if a newer load has started. The field's doc comment (lines 61-66) is precise about why
     the generation, not `_loadedId`, is authoritative: `_loadedId` is stamped **synchronously before**
     the await, so two rapid route changes would otherwise let the later-completing fetch paint the wrong
     session. The `finally` is guarded the same way (lines 150-155), because an unconditional clear would
     let a superseded response switch off the spinner the newer load just turned on.
     `[Rubric §19, State Management & Data Flow]` assesses whether concurrent updates to view state are
     ordered: this is an explicit last-writer-wins protocol rather than an implicit one.
     `[Rubric §12, Performance & Scalability]`: nothing is cancelled, but nothing stale is rendered
     either.
  2. **Join management as an add/remove/available triple, factored once.** The same three-method pattern
     applies twice, to speakers and to category items, and both funnel through `MutateChildAsync`
     (lines 286-306), which takes the operation, its own failure and success resource keys, and an
     optional picker-clearing callback. Each mutation ends with a full `LoadAsync` (line 300) rather than
     a local patch.
  `[Rubric §8, Data Architecture]`: the update DTO re-sends the loaded `RowVersion` through
  [`SessionEditModel`](#sessioneditmodel)`.ToUpdated`, the client half of the optimistic-concurrency
  token (ADR-035).
  `[Rubric §18, UI Architecture & Component Design]`: the page's remaining size comes from breadth (two
  join collections, four lookups, seven clients), not from bespoke mechanics; enrichment lives in
  [`SessionLookups`](#sessionlookups) and form shape in [`SessionEditModel`](#sessioneditmodel).
- **Walkthrough**
  - `OnInitialized` (lines 42-57) builds breadcrumbs, constructs [`SessionLookups`](#sessionlookups) from
    the four injected lookup clients (lines 52-53), and wires the validation delegate (line 56).
  - `LoadAsync` (lines 96-157): bump the generation, `GetByIdAsync(id, true, PageToken)` so the join
    collections arrive with the record (line 104), toast `ErrorMessages.NotFound` and bail when the
    session is missing (lines 110-115), report any other failure through `NotifyOnFailure` (line 119),
    then hydrate the global lookups (line 125) and the event's rooms (line 136), each followed by a
    generation re-check.
  - Edit and save (lines 159-211): `StartEditing` calls `_model.LoadFrom(Session)` then `BeginEdit`;
    `SaveChangesAsync` validates the form, posts `_model.ToUpdated(Session)` and refetches, both written
    as a single expression chaining `NotifyOnFailure` into `IsFailure` / `TryGetValue` (lines 187-197),
    then toasts and `EndEdit`.
  - Delete (lines 213-239): confirm through `_deleteConfirm.ShowAsync(Session.Title)` (line 220), delete,
    navigate back to the list.
  - Joins: `GetAvailableSpeakers` / `GetAvailableCategoryItems` (lines 241-245) delegate the set
    difference to [`SessionLookups`](#sessionlookups) so a picker never offers an already-assigned entry;
    `AddSessionSpeakerAsync` (lines 247-259) and `AddSessionCategoryItemAsync` (lines 265-276) each
    capture their ids into locals **before** building the delegate, with an in-code note that nullable
    flow analysis does not reach inside a lambda (line 254); the two remove methods (lines 261-263,
    278-280) are one-liners over the same `MutateChildAsync`.
- **Why it's built this way**: a session is the join-heavy center of the program (speakers, category
  items, room, event, timing), so the organizer edits all of it from one console. Reloading after each
  join mutation keeps the page a single source of truth instead of hand-patching local collections, and
  the load generation is what makes that reload safe when the reader is navigating quickly between
  sessions.
- **Where it's used**: the `/sessions/{Id}` organizer route
  (`.../Pages/Session/SessionDetail.razor:1-2`), reached from [`SessionList`](#sessionlist) rows and from
  [`SessionCreate`](#sessioncreate)'s success redirect; its "view feedback" button opens
  [`OrganizerSessionFeedback`](#organizersessionfeedback)
  (`.../Pages/Session/SessionDetail.razor:161-162`).
- **Caveats / not-in-source**: reads pass `includeChildren: true` so the join collections populate; how
  the server populates children is outside this page.

### SessionList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sessions/SessionList.razor.cs:22` · Level 10 · class (Blazor code-behind)

- **What it is**: the organizer browse page for sessions and the richest list in the Conference UI. It
  carries three filters (free-text title search, session status, and event), enriches each row with room
  and speaker names, and color-codes the Sessionize status. It sits at the top of the group's dependency
  order because it transitively pulls in the most lookups and defaults.
- **Depends on**: extends
  [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) over
  [`SessionDTO`](group-17-conference-domain.md#sessiondto) (line 19) and injects
  [`ISessionUIService`](#isessionuiservice), [`IEventUIService`](#ieventuiservice), and
  [`ISpeakerLookupService`](#ispeakerlookupservice) (lines 24-26). It uses
  [`EventDTO`](group-17-conference-domain.md#eventdto), [`SpeakerInfo`](#speakerinfo),
  [`CurrentEventDefaults`](group-17-conference-domain.md#currenteventdefaults) (the `EventDTO`-typed
  wrapper over [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector)),
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages) (line 224),
  [`ListPageActions`](group-15-common-ui-framework.md#listpageactions) (lines 158, 218), and the
  [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem),
  `DeleteConfirmation`, and `ListNoRecordsContent` components. Uses the
  `Event`/`Room`/`Session`/`Speaker` aliases.
- **Concept introduced, the multi-filter enriched list.** `SessionList` layers three refinements on the
  event-filtered shape [`RoomList`](#roomlist), [`SponsorList`](#sponsorlist), and
  [`SpeakerList`](#speakerlist) share:
  1. **A third filter with a sentinel.** `_searchString`, `_selectedStatus`, and `_selectedEventId`
     persist together (`SaveFilters` lines 45-54, `RestoreFilters` lines 56-74) and are emitted as
     `Title contains`, `Status equals`, and `EventId equals` server filters (`ApplyFilters`,
     lines 204-212). The event filter needs three states, not two, so a saved `"all"` string
     distinguishes an explicit clear from no saved state at all, which is what lets the computed default
     apply only on a first visit (in-code comment, line 51).
  2. **Enrichment from two bulk loads instead of per-row fetches.**
     `LoadEventsAndResolveDefaultAsync` fetches events with `includeChildren: true` (line 96) and folds
     every event's rooms into one `_roomNames` dictionary (`PopulateRoomNames`, lines 120-134), while the
     speaker lookup loaded in `OnInitializedAsync` (line 84) backs `GetSpeakerList` (lines 136-144),
     which maps a row's `SessionSpeakers` to display names and skips ids the lookup does not know. Both
     loads are explicitly **non-critical**: a failed `Result` is simply not unwrapped, and the comments
     (lines 83, 94-95) say the fallback is dash display and an unset default filter, not a broken page.
     The paged fetch itself also passes `includeChildren: true` (lines 189, 201) so each row arrives with
     its speaker joins.
  3. **Status color coding.** `GetStatusColor` (lines 146-155) maps the Sessionize status strings
     `Accepted`, `Waitlisted`, `Accept_Queue`, `Nominated`, `Decline_Queue`, and `Declined` to MudBlazor
     colors, defaulting to `Color.Default` for anything else, and the grid renders it as a chip
     (`.../Pages/Session/SessionList.razor:180`).
  The startup race guard is the same one [`RoomList`](#roomlist) uses, with the clearest explanation in
  this file: `_eventsLoadTask` is started **before the first await** (lines 78-81) and awaited inside
  both `LoadServerData` (lines 183-184) and `FetchMobilePage` (lines 196-197), because `ApplyFilters`
  runs inside `LoadServerDataAsync`, so the default event must be resolved before entering it, "not
  merely before the fetch delegate runs" (in-code comment, lines 181-182).
  `[Rubric §18, UI Architecture & Component Design]`: the status filter surfaces the program-committee
  workflow inline instead of hiding it behind a separate screen.
  `[Rubric §23, Front-End Performance & Rendering]`: one children-loaded events fetch plus one speaker
  lookup replace what would otherwise be per-row enrichment calls.
  `[Rubric §25, Navigation & Information Architecture]`: all three filters survive navigation through the
  base class's persistence contract, with the `"all"` sentinel and the computed default.
  `[Rubric §29, Resilience & Business Continuity]`: both enrichment loads degrade rather than fail.
- **Walkthrough**
  - `OnInitializedAsync` (lines 76-90): start the events task, load the speaker lookup (tolerating
    failure), then await the events task.
  - `ResolveDefaultEventFilter` (lines 106-118): keep a restored id that still **exists** in `_events`,
    otherwise fall back to `CurrentEventDefaults.SelectCurrentOrNext(_events, DateTime.UtcNow)?.Id`
    (line 116). The comment (lines 108-109) records the case this covers: a dangling saved id would
    otherwise silently show an empty grid.
  - `OnSearchChanged`, `OnStatusChanged`, and `OnEventFilterChanged` (lines 160-177) each update one
    filter and reload whichever layout is active via
    [`ListPageActions`](group-15-common-ui-framework.md#listpageactions)`.ReloadActiveLayoutAsync`
    (lines 157-158).
  - `LoadServerData` (lines 179-191) and `FetchMobilePage` (lines 194-202) are the desktop and mobile
    fetch paths over the same `ApplyFilters`.
  - `DeleteSessionAsync` (lines 217-225) delegates the confirm, delete, toast, and reload sequence to
    `ListPageActions.DeleteWithConfirmationAsync`; `NavigateToCreate` and `NavigateToDetails`
    (lines 227-228) route to [`SessionCreate`](#sessioncreate) and [`SessionDetail`](#sessiondetail).
  - The grid mixes `PropertyColumn`s for the sortable fields (`Title`, `StartsAt`, `EndsAt`, `RoomId`,
    `.../Pages/Session/SessionList.razor:113, 147, 156, 165`) with `TemplateColumn`s for the derived ones
    (speakers, status, row actions, lines 120, 174, 189), which is what keeps server-side sorting working
    on the columns that have a real backing property.
- **Why it's built this way**: sessions are the central editable entity of the program, so the list has
  to answer "what is in this conference, in what state, presented by whom" at a glance; defaulting to the
  active event and enriching from two bulk loads keeps that view both relevant and cheap.
- **Where it's used**: the `/sessions` organizer route (`.../Pages/Session/SessionList.razor:1-2`,
  `Authorize(Roles = "Organizer")`); rows open [`SessionDetail`](#sessiondetail) and the create button
  opens [`SessionCreate`](#sessioncreate).
- **Caveats / not-in-source**: the page builds speaker names from its own lookup rather than trusting the
  paged payload alone, so it degrades to a dash rather than a wrong name when a speaker id is unknown;
  how the paged endpoint populates `SessionSpeakers` is a server-side concern outside this file.

### IRoomUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Rooms` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Rooms/IRoomUIService.cs:10` · Level 4 · interface

- **What it is**: the UI-service contract for the `rooms` resource. It extends the generic CRUD surface
  with a single specialized delete that also carries the owning event id (`IRoomUIService.cs:10-14`).
- **Depends on**: [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [RoomDTO](group-17-conference-domain.md#roomdto) (note that `RoomDTO` lives in the
  `MMCA.ADC.Conference.Shared.Events` namespace, `IRoomUIService.cs:1`, because a room belongs to an
  event), [Result](group-01-result-error-handling.md#result) (`IRoomUIService.cs:2`), and the
  `RoomIdentifierType` / `EventIdentifierType` aliases.
- **Concept**: `[Rubric §9, API & Contract Design]` assesses whether client contracts carry the
  parameters the server actually requires. A room is scoped to an event, so its delete needs the
  `EventIdentifierType` the WebAPI endpoint expects; the generic `DeleteAsync(id)` would omit it. The
  doc comment (`IRoomUIService.cs:12`) states the added overload "passes the required event ID to the
  API". This is the UI-side counterpart of the parent-scoped delete the join services and the organizer
  feedback services use.
- **Walkthrough**: one added member,
  `DeleteAsync(RoomIdentifierType roomId, EventIdentifierType eventId, CancellationToken)`
  (`IRoomUIService.cs:13`), returning `Task<Result>`. It supplements, rather than replaces, the
  inherited single-argument delete: both overloads are visible on the interface, so an accidental call
  to the id-only one still compiles, and the server is what rejects it.
- **Where it's used**: implemented by [RoomService](#roomservice); injected into
  [RoomList](#roomlist) (`Pages/Room/RoomList.razor.cs:17`), [RoomDetail](#roomdetail)
  (`Pages/Room/RoomDetail.razor.cs:19`), [RoomCreate](#roomcreate) (`Pages/Room/RoomCreate.razor.cs:13`)
  and into the session pages that render the room a session is scheduled in
  ([SessionCreate](#sessioncreate) `:21`, [SessionDetail](#sessiondetail) `:29`,
  [PublicSessionDetail](#publicsessiondetail) `:26`), plus the shared
  [SessionLookups](#sessionlookups) helper (`Pages/Session/SessionLookups.cs:33`).

### ISessionSelectionUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Sessions.Selection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Sessions/Selection/ISessionSelectionUIService.cs:9` · Level 4 · interface

- **What it is**: the UI-service contract for the organizer's session-selection decision-support
  dashboard: read the dashboard, and start a scoring pass over one event's sessions
  (`ISessionSelectionUIService.cs:9-24`). It is a bespoke (non-CRUD) interface: it does **not** extend
  [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype),
  because decision support is a pair of computed operations, not an entity surface.
- **Depends on**: [SessionSelectionDashboardDTO](group-17-conference-domain.md#sessionselectiondashboarddto)
  (the dashboard payload) and
  [ScoreEventSessionsResultDTO](group-17-conference-domain.md#scoreeventsessionsresultdto) (the scoring
  outcome), both from `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport`
  (`ISessionSelectionUIService.cs:1`); [Result](group-01-result-error-handling.md#result) and
  [ErrorType](group-01-result-error-handling.md#errortype) (`ISessionSelectionUIService.cs:2`); the
  `EventIdentifierType` alias.
- **Concept introduced, the accepted-for-background-processing outcome expressed in one contract.**
  `[Rubric §18, UI Architecture]` assesses whether pages depend on narrow typed contracts instead of raw
  HTTP; the page sees two methods and never a URL. `[Rubric §9, API & Contract Design]` assesses
  interface segregation on the client side; decision support lives on its own contract rather than
  swelling [ISessionUIService](#isessionuiservice). The distinctive part is the documented semantics of
  `ScoreSessionsAsync` (`ISessionSelectionUIService.cs:15-20`): a background start answers HTTP 202 and
  comes back as a **success carrying the `SessionsScored == -1` sentinel**, while a refusal to start
  (409, because a run is already going or the queue is full) arrives as an
  [ErrorType](group-01-result-error-handling.md#errortype)`.Conflict` failure. Two very different
  outcomes, one method, and the distinction is written on the contract rather than left in the
  implementation. `[Rubric §6, CQRS & Event-Driven]` assesses read/write separation: `GetDashboardAsync`
  is a pure query and `ScoreSessionsAsync` is a command with an asynchronous completion.
- **Walkthrough**: two members, both scoped by `EventIdentifierType`.
  - `GetDashboardAsync(eventId, ct)` (`ISessionSelectionUIService.cs:11-13`): returns
    `Task<Result<SessionSelectionDashboardDTO>>`.
  - `ScoreSessionsAsync(eventId, ct)` (`ISessionSelectionUIService.cs:21-23`): returns
    `Task<Result<ScoreEventSessionsResultDTO>>` with the 202/409 semantics above.
  The two map one to one onto two of the endpoints on
  [SessionSelectionController](group-20-conference-api-grpc.md#sessionselectioncontroller): the
  `GET dashboard/{eventId}` read
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionSelectionController.cs:40`)
  and the `POST score/{eventId}` command (`SessionSelectionController.cs:106`). The controller exposes
  three further analytical GETs (category distribution, speaker overlap, content similarity, `:54,68,82`)
  that this UI contract deliberately does not surface.
- **Why it's built this way**: keeping the analytical surface on its own interface matches its
  lifecycle, an organizer-only screen backed by dedicated controller endpoints, and lets the
  implementation extend
  [AuthenticatedServiceBase](group-15-common-ui-framework.md#authenticatedservicebase) rather than the
  CRUD base. Modelling the 202 as a success value rather than a separate method means the page needs no
  second endpoint and no polling contract on the service: polling is a rendering decision, and it lives
  beside the page.
- **Where it's used**: implemented by [SessionSelectionService](#sessionselectionservice), registered
  explicitly (`DependencyInjection.cs:45`, explicit because it is not an `IEntityService<,>` and the
  assembly scan would not find it), injected into
  [SessionSelectionDashboard](#sessionselectiondashboard)
  (`Pages/SessionSelection/SessionSelectionDashboard.razor.cs:17`) and taken as a constructor argument
  by [ScorePollSession](#scorepollsession) (`Pages/SessionSelection/ScorePollSession.cs:37`), the
  fire-and-forget polling session whose own doc comment explains that it stays beside the page rather
  than moving onto this contract because every step it takes is a rendering decision
  (`ScorePollSession.cs:26-31`).

### ISessionUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Sessions/ISessionUIService.cs:9` · Level 4 · interface

- **What it is**: the UI-service contract for the `sessions` resource, an empty marker over
  [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [SessionDTO](group-17-conference-domain.md#sessiondto) (`ISessionUIService.cs:9-11`).
- **Depends on**: [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  and [SessionDTO](group-17-conference-domain.md#sessiondto).
- **Concept**: the same marker shape as [IActivityUIService](#iactivityuiservice).
  `[Rubric §18, UI Architecture]`. Worth pausing on what this contract does *not* carry: the
  personalized speaker-facing session reads live on a separate contract,
  [ISpeakerDashboardUIService](#ispeakerdashboarduiservice), because they must bypass the shared output
  cache. Keeping them apart is what lets this contract stay cache-friendly.
- **Walkthrough**: no members (doc comment `ISessionUIService.cs:6-8`).
- **Where it's used**: implemented by [SessionService](#sessionservice); injected into the session list,
  detail and create pages (`Pages/Session/SessionList.razor.cs:24`,
  `Pages/Session/SessionDetail.razor.cs:23`, `Pages/Session/SessionCreate.razor.cs:19`), the public
  session and speaker pages ([PublicSessionDetail](#publicsessiondetail) `:24`,
  [PublicSpeakerDetail](#publicspeakerdetail) `:23`), the organizer session-feedback page
  (`Pages/Feedback/OrganizerSessionFeedback.razor.cs:20`) and [SpeakerDetail](#speakerdetail)
  (`Pages/Speaker/SpeakerDetail.razor.cs:28`).

### ISponsorUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Sponsors/ISponsorUIService.cs:9` · Level 4 · interface

- **What it is**: the UI-service contract for the `sponsors` REST resource, an empty marker over
  [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [SponsorDTO](group-17-conference-domain.md#sponsordto) and `SponsorIdentifierType`
  (`ISponsorUIService.cs:9-11`).
- **Depends on**: [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  and [SponsorDTO](group-17-conference-domain.md#sponsordto) (from `MMCA.ADC.Conference.Shared.Sponsors`,
  `ISponsorUIService.cs:1`).
- **Concept**: the marker shape taught under [IActivityUIService](#iactivityuiservice); the doc comment
  (`ISponsorUIService.cs:6-8`) repeats the "uses generic CRUD" formula verbatim.
  `[Rubric §15, Best Practices & Code Quality]` is the point worth pausing on: the whole sponsor admin surface plus a
  public sponsor page costs exactly one empty interface and one tiny class
  ([SponsorService](#sponsorservice)), because the CRUD algorithm, the auth, the retry and the
  result translation are all inherited. `[Rubric §18, UI Architecture]`.
- **Walkthrough**: no members.
- **Why it's built this way**: sponsor management is plain CRUD from the client's point of view, so the
  contract adds nothing; the named marker exists so the assembly scan inside
  `AddUIModule<ConferenceUIModule>()` can bind a concrete implementation to a name the pages inject
  (`DependencyInjection.cs:29`).
- **Where it's used**: implemented by [SponsorService](#sponsorservice); injected into
  [SponsorList](#sponsorlist) (`Pages/Sponsor/SponsorList.razor.cs:23`),
  [SponsorDetail](#sponsordetail) (`Pages/Sponsor/SponsorDetail.razor.cs:22`),
  [SponsorCreate](#sponsorcreate) (`Pages/Sponsor/SponsorCreate.razor.cs:19`) and the anonymous
  [PublicSponsorList](#publicsponsorlist) (`Pages/Public/PublicSponsorList.razor.cs:26`).

### FeedbackQuestionLoader

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Feedback` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/FeedbackQuestionLoader.cs:17` · Level 5 · internal static class (helper)

- **What it is**: a one-method helper that reads **every** feedback question of one entity type
  (`"Event"` or `"Session"`), paging until the server's reported total is reached, so an organizer
  feedback report cannot silently truncate.
- **Depends on**: [`IQuestionUIService`](#iquestionuiservice) (line 2),
  [`QuestionDTO`](group-17-conference-domain.md#questiondto) (line 1), and
  [`Result`](group-01-result-error-handling.md#result) (line 3). No Blazor.
- **Concept introduced, paging to exhaustion behind a bounded loop.** A single page read is the obvious
  thing to write and the wrong thing here, and the `<remarks>` (lines 11-16) explains why in operational
  terms: the razor iterates only what it was handed, so questions past the page size, **and every answer
  under them**, vanish from the report with nothing on screen to say so. Raising the requested size does
  not fix it either, because the API base clamps any requested size to its own maximum. So the loop reads
  `PageSize = 100` at a time (line 20) and stops on one of three conditions: an empty page (lines 59-62),
  the accumulated count reaching the server's `TotalItems` (lines 66-69), or the `MaxPages = 20` ceiling
  (line 49). That ceiling is a runaway guard, not a business limit: the comment (lines 22-25) notes 2000
  questions is far past any real feedback form, and its job is to stop a server that keeps reporting a
  larger total than it returns.
  `[Rubric §12, Performance & Scalability]` assesses whether an unbounded read is actually bounded: this
  one is, twice over, and the cost is capped at twenty round trips.
  `[Rubric §19, State Management & Data Flow]`: the first page failure short-circuits the whole load with
  `Result.Failure<List<QuestionDTO>>(result.Errors)` (line 56), so a partial read never reaches the page
  disguised as a complete one.
  `[Rubric §15, Best Practices & Code Quality]`: making this a shared internal static rather than a copy in each
  feedback page means the two organizer reports cannot diverge in their notion of "all questions".
- **Walkthrough**
  - `LoadAllAsync(IQuestionUIService questions, string questionEntity, CancellationToken)` (lines 35-73)
    guards the service argument (line 40), then builds the single server filter
    `QuestionEntity equals <questionEntity>` with an ordinal comparer (lines 42-45).
  - The loop (lines 49-70) calls `GetPagedAsync(filters, pageNumber, 100, "Sort", "asc", ...)` (lines
    51-52), so questions come back in their display order rather than in insertion order.
  - Accumulation is `AddRange` into a single list (line 64); the method returns
    `Result.Success(accumulated)` (line 72).
- **Why it's built this way**: a feedback report is one of the few screens where a missing row is worse
  than a slow load. The paged-to-exhaustion read trades a handful of extra requests for the guarantee
  that what an organizer sees is what attendees submitted. The filter-as-operator-plus-value shape is the
  client data-access contract of `Website/docs-src/adr/094-client-entity-data-access.md`: the caller
  never touches `HttpClient`, only the typed `I*UIService`.
- **Where it's used**: [`OrganizerEventFeedback`](#organizereventfeedback)
  (`.../Pages/Feedback/OrganizerEventFeedback.razor.cs:69-70`, with `"Event"`) and
  [`OrganizerSessionFeedback`](#organizersessionfeedback)
  (`.../Pages/Feedback/OrganizerSessionFeedback.razor.cs:66-67`, with `"Session"`).
- **Caveats / not-in-source**: the API's own maximum page size is enforced server-side and is not visible
  in this file; the 100 here is what the client asks for, not necessarily what it receives.

### RoomService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Rooms` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Rooms/RoomService.cs:14` · Level 5 · class (sealed)

- **What it is**: the concrete Room CRUD service. It extends
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  over `"rooms"` but **overrides `AddAsync`** to reshape the create payload, and adds the parent-scoped
  `DeleteAsync(roomId, eventId)` declared by [`IRoomUIService`](#iroomuiservice)
  (`RoomService.cs:14-45`).
- **Depends on**:
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype),
  its `Endpoint` property (`EntityServiceBase.cs:51`) and both `SendRequestAsync` overloads
  (`EntityServiceBase.cs:324,354`);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`RoomDTO`](group-17-conference-domain.md#roomdto); [`IRoomUIService`](#iroomuiservice);
  [`Result`](group-01-result-error-handling.md#result); the `RoomIdentifierType` /
  `EventIdentifierType` aliases; BCL `System.Net.Http.Json` and `CultureInfo.InvariantCulture`
  (`RoomService.cs:1-2`).
- **Concept**: cross-reference the thin-leaf CRUD pattern at [`ActivityService`](#activityservice) for
  the inherited half. Two things make `RoomService` more than a four-liner.
  1. It **overrides** the base's `virtual AddAsync` (`EntityServiceBase.cs:150`) because the create
     endpoint's contract record `AddRoomRequest` binds a `RoomId` property, not the DTO's `Id`
     (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Events/RoomsController.cs:36`,
     consumed at `:213`). The override therefore posts an anonymous body that remaps `RoomId = dto.Id`
     alongside the remaining room fields (`RoomService.cs:25-35`), while still routing through the base
     `SendRequestAsync` so it keeps the Polly retry and the Result conversion.
     `[Rubric §9, API & Contract Design]` (assesses whether the client honors the server's request
     contract rather than assuming DTO/request symmetry).
  2. It adds a parent-scoped delete, because a room is addressed under its event.
- **Walkthrough**
  - `AddAsync(dto, ct)` override (`RoomService.cs:18-38`): guards a null DTO (`:20`), then
    `SendRequestAsync<RoomDTO>` posting the anonymous object
    `{ RoomId = dto.Id, dto.EventId, dto.Name, dto.Sort, dto.Capacity, dto.Floor, dto.Location, dto.AccessibilityInfo }`
    to `Endpoint` (`:22-37`).
  - `DeleteAsync(roomId, eventId, ct)` (`RoomService.cs:40-44`): builds
    `{Endpoint}/{roomId}?eventId={eventId}` with `string.Create(CultureInfo.InvariantCulture, ...)` so
    the ids format culture-stably (`:43`), and dispatches it through the valueless `SendRequestAsync`
    (`:41-44`), returning the [`Result`](group-01-result-error-handling.md#result) the base produces.
- **Why it's built this way**: the create-payload remap keeps the UI honest about the server's
  `AddRoomRequest` shape, and the parent-scoped delete exists because rooms belong to an event and the
  endpoint binds the parent id as a query argument.
- **Where it's used**: registered by the `AddUIModule<ConferenceUIModule>()` entity-service scan
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:29`) and injected as
  [`IRoomUIService`](#iroomuiservice) into [`RoomList`](#roomlist) (`Pages/Room/RoomList.razor.cs:17`),
  [`RoomDetail`](#roomdetail) (`Pages/Room/RoomDetail.razor.cs:19`), [`RoomCreate`](#roomcreate)
  (`Pages/Room/RoomCreate.razor.cs:13`), [`SessionCreate`](#sessioncreate)
  (`Pages/Session/SessionCreate.razor.cs:21`), [`SessionDetail`](#sessiondetail)
  (`Pages/Session/SessionDetail.razor.cs:29`) and [`PublicSessionDetail`](#publicsessiondetail)
  (`Pages/Public/PublicSessionDetail.razor.cs:26`) for room wayfinding.
- **Caveats / not-in-source**: two consequences of the override are worth knowing, and both are visible
  by comparing it to the base. The base `AddAsync` attaches a fresh `Idempotency-Key` held constant
  across retries (`EntityServiceBase.cs:159-164`), and this override calls `SendRequestAsync` without
  one (`RoomService.cs:22-37`), so a retried room create is not deduplicated by the server-side
  idempotency filter the way other creates are. The base `AddAsync` and `DeleteAsync` also call the
  base's private `InvalidateOnSuccess` to drop stale read-cache entries
  (`EntityServiceBase.cs:165,213,281`), which neither method here does, and being private it is not
  callable from this subclass.

### SessionSelectionService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Sessions.Selection` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Sessions/Selection/SessionSelectionService.cs:14` · Level 5 · class (sealed)

- **What it is**: the HTTP service behind the organizer's session-selection decision-support dashboard.
  It reads the dashboard projection for an event and starts an AI scoring run over that event's sessions
  (`SessionSelectionService.cs:14-63`). It extends
  [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) and implements
  [`ISessionSelectionUIService`](#isessionselectionuiservice).
- **Depends on**: [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase);
  [`HttpResultExecutor`](group-15-common-ui-framework.md#httpresultexecutor) and
  [`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader);
  [`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto) and
  [`ScoreEventSessionsResultDTO`](group-17-conference-domain.md#scoreeventsessionsresultdto);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice); the
  `EventIdentifierType` alias; BCL `System.Net.HttpStatusCode`, `IHttpClientFactory` and
  `CultureInfo.InvariantCulture`.
- **Concept introduced, retry is a per-verb decision, and 202 is an answer.** This class is the clearest
  place in the group to see that the retry policy is not applied blanket-fashion.
  - `GetDashboardAsync` is a read, so it runs inside the inherited Polly `RetryPolicy`
    (`SessionSelectionService.cs:27-29`): a repeated GET costs nothing but latency.
  - `ScoreSessionsAsync` deliberately does **not**: the inline comment states why
    (`SessionSelectionService.cs:46-47`), starting a scoring run is not idempotent, so a retried POST
    could queue a second run behind the first. The call goes straight to the `HttpClient` (`:48`).
    `[Rubric §29, Resilience & Business Continuity]` (assesses whether retry is applied only where the
    operation can safely be repeated).
  The second idea is the **202 Accepted** path. Scoring runs in the background, so the endpoint can
  answer 202 with no body. A body-less 2xx would look like a failure to
  [`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader), so the status is checked
  **before** the reader is reached and answered with a sentinel
  [`ScoreEventSessionsResultDTO`](group-17-conference-domain.md#scoreeventsessionsresultdto) carrying
  `SessionsScored = -1` (`SessionSelectionService.cs:50-57`). That sentinel is not a magic number left
  for the reader to guess: the page turns it into a polling session rather than a finished-run report.
  `[Rubric §9, API & Contract Design]` (assesses whether an asynchronous operation is represented
  honestly at the boundary rather than being made to look synchronous).
- **Walkthrough**
  - `GetDashboardAsync(eventId, ct)` (`SessionSelectionService.cs:18-34`): inside
    [`HttpResultExecutor`](group-15-common-ui-framework.md#httpresultexecutor)`.ExecuteAsync` (`:21`) it
    creates the authenticated client (`:24`), builds `sessionselection/dashboard/{eventId}` with
    `string.Create(CultureInfo.InvariantCulture, ...)` (`:26`), GETs it through the retry policy
    (`:27-29`), and reads the body into a
    `Result<`[`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto)`>`
    (`:31-32`).
  - `ScoreSessionsAsync(eventId, ct)` (`SessionSelectionService.cs:36-62`): same executor and client
    (`:39,42`), URL `sessionselection/score/{eventId}` (`:44`), a bare POST with no retry (`:48`), the
    202 short-circuit described above (`:54-57`), and otherwise the normal reader path (`:59-60`).
- **Why it's built this way**: decision support is a projection plus a long-running job, neither of which
  is CRUD, so the service sits on the authenticated base and spells out both calls. Keeping the 202
  branch inside the service means the page never sees an HTTP status code, only a typed result it can
  branch on.
- **Where it's used**: registered explicitly as
  [`ISessionSelectionUIService`](#isessionselectionuiservice) at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:45`, and injected
  into [`SessionSelectionDashboard`](#sessionselectiondashboard)
  (`Pages/SessionSelection/SessionSelectionDashboard.razor.cs:17`), which loads the projection at `:123`,
  starts a run at `:172` and branches on the `SessionsScored == -1` sentinel at `:180`.
  [`ScorePollSession`](#scorepollsession) then re-reads the dashboard while the run proceeds
  (`Pages/SessionSelection/ScorePollSession.cs:67`).
- **Caveats / not-in-source**: what the server does with a second concurrent scoring request is not
  visible here; the client simply declines to create one by not retrying. The `-1` sentinel is a
  convention shared between this service and its page, not a value the DTO documents.

### SessionService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Sessions/SessionService.cs:10` · Level 5 · class (sealed)

- **What it is**: a body-less concrete CRUD service for the `sessions` WebAPI resource, extending
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  over [`SessionDTO`](group-17-conference-domain.md#sessiondto) and `SessionIdentifierType`, and
  implementing [`ISessionUIService`](#isessionuiservice) (`SessionService.cs:10-14`).
- **Depends on**:
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`SessionDTO`](group-17-conference-domain.md#sessiondto); [`ISessionUIService`](#isessionuiservice).
- **Concept**: the thin-leaf CRUD service taught at [`ActivityService`](#activityservice), over the
  busiest resource in the module. `[Rubric §2, Design Patterns]`, `[Rubric §15, Best Practices & Code Quality]`. It is
  worth noticing what this one class carries without knowing it: the base's `GetPagedAsync` builds the
  filter, sort and paging query string (`EntityServiceBase.cs:79-100`), which is exactly the surface
  [`PublicSessionScheduleService`](#publicsessionscheduleservice) composes over for the "My Schedule"
  `Id IN (...)` scope.
- **Walkthrough**: a primary-constructor class, base call only (`SessionService.cs:10-12`):
  `EntityServiceBase<SessionDTO, SessionIdentifierType>("sessions", httpClientFactory,
  tokenStorageService)`, with an empty body (`:13-14`).
- **Why it's built this way**: sessions need nothing beyond generic CRUD from the UI's point of view, so
  the empty subclass is enough to give DI a concrete type behind a named interface. The two session reads
  that *are* special, the speaker's own sessions and the offline-first public schedule, live in their own
  services ([`SpeakerDashboardService`](#speakerdashboardservice) and
  [`PublicSessionScheduleService`](#publicsessionscheduleservice)) rather than as overrides here.
- **Where it's used**: registered by the `AddUIModule<ConferenceUIModule>()` scan
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:29`), and injected
  as [`ISessionUIService`](#isessionuiservice) into [`SessionList`](#sessionlist)
  (`Pages/Session/SessionList.razor.cs:24`), [`SessionDetail`](#sessiondetail)
  (`Pages/Session/SessionDetail.razor.cs:23`), [`SessionCreate`](#sessioncreate)
  (`Pages/Session/SessionCreate.razor.cs:19`), [`PublicSessionDetail`](#publicsessiondetail)
  (`Pages/Public/PublicSessionDetail.razor.cs:24`), [`PublicSpeakerDetail`](#publicspeakerdetail)
  (`Pages/Public/PublicSpeakerDetail.razor.cs:23`), [`SpeakerDetail`](#speakerdetail)
  (`Pages/Speaker/SpeakerDetail.razor.cs:28`) and
  [`OrganizerSessionFeedback`](#organizersessionfeedback)
  (`Pages/Feedback/OrganizerSessionFeedback.razor.cs:20`). It is also consumed service-to-service by
  [`PublicSessionScheduleService`](#publicsessionscheduleservice)
  (`Services/PublicSessionScheduleService.cs:18`), which is how the public schedule reaches the API.

### SponsorService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Sponsors/SponsorService.cs:10` · Level 5 · class (sealed)

- **What it is**: a body-less concrete CRUD service for the `sponsors` WebAPI resource. It extends
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  over [`SponsorDTO`](group-17-conference-domain.md#sponsordto) and `SponsorIdentifierType`, passes the
  resource name to the base constructor, and implements the equally empty
  [`ISponsorUIService`](#isponsoruiservice) (`ISponsorUIService.cs:9-11`), inheriting the entire CRUD
  implementation with no added code (`SponsorService.cs:10-13`).
- **Depends on**:
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype);
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice);
  [`SponsorDTO`](group-17-conference-domain.md#sponsordto);
  [`ISponsorUIService`](#isponsoruiservice); the `SponsorIdentifierType` alias, an `int`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:21`);
  BCL `IHttpClientFactory`.
- **Concept**: the thin-leaf CRUD service taught at [`ActivityService`](#activityservice), over a
  different resource. `[Rubric §2, Design Patterns]`, `[Rubric §15, Best Practices & Code Quality]` (assesses what a
  new resource costs: here four lines plus an empty interface, with the verbs, retry, auth and error
  translation all inherited).
- **Walkthrough**: a primary-constructor class whose base call is the only content
  (`SponsorService.cs:10-12`):
  `EntityServiceBase<SponsorDTO, SponsorIdentifierType>("sponsors", httpClientFactory, tokenStorageService)`,
  with an empty body (`:13`). As with its siblings, the base's optional
  [`IUiReadCache`](group-15-common-ui-framework.md#iuireadcache) parameter is left at `null`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:43-47`), so reads go
  to the API and `GetCachedAsync` takes its no-cache path (`EntityServiceBase.cs:248-251`).
- **Why it's built this way**: sponsors need nothing beyond CRUD in the UI, so an empty subclass is the
  smallest concrete type that still gives DI a binding for
  [`ISponsorUIService`](#isponsoruiservice) and keeps the resource name in exactly one place.
- **Where it's used**: picked up automatically by the Scrutor scan inside
  `AddUIModule<ConferenceUIModule>()`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/DependencyInjection.cs:29`), so no
  explicit `AddScoped` line exists for it. Injected as [`ISponsorUIService`](#isponsoruiservice) into
  [`SponsorList`](#sponsorlist) (`Pages/Sponsor/SponsorList.razor.cs:23`),
  [`SponsorDetail`](#sponsordetail) (`Pages/Sponsor/SponsorDetail.razor.cs:22`),
  [`SponsorCreate`](#sponsorcreate) (`Pages/Sponsor/SponsorCreate.razor.cs:19`) and
  [`PublicSponsorList`](#publicsponsorlist) (`Pages/Public/PublicSponsorList.razor.cs:26`).

### OrganizerEventFeedback

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Feedback` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerEventFeedback.razor.cs:18` · Level 6 · class (Blazor code-behind)

- **What it is**: the organizer's read-and-moderate view of event feedback. It loads every question and
  every answer submitted for one event, groups the answers under their question, averages the rating
  questions, and lets the organizer delete an individual free-text answer.
- **Depends on**: [`IOrganizerEventFeedbackUIService`](#iorganizereventfeedbackuiservice) (line 18),
  [`IQuestionUIService`](#iquestionuiservice) (line 19),
  [`IEventLookupService`](#ieventlookupservice) (line 20) returning [`EventInfo`](#eventinfo),
  [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 21), and
  [`FeedbackQuestionLoader`](#feedbackquestionloader) (line 69); the
  [`QuestionDTO`](group-17-conference-domain.md#questiondto) and
  [`EventQuestionAnswerDTO`](group-17-conference-domain.md#eventquestionanswerdto) shapes;
  [`ConferenceRoutePaths`](#conferenceroutepaths); and
  [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Parse<T>` string extension
  (`MMCA.Common.Shared.Extensions`, line 5;
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Extensions/DomainHelper.cs:30`). Externals: Blazor
  `[Parameter]`, MudBlazor (`MudRating`, `MudCard`, `BreadcrumbItem`), and the `PageLoadingState` /
  `PageErrorState` components from `MMCA.Common.UI`.
- **Concept introduced, the inline page-level error state.** Unlike the create and detail pages, which
  toast their failures, this page keeps a `_loadError` string (line 31) and renders `PageErrorState`
  **instead of** the body when the load failed (`.../Pages/Feedback/OrganizerEventFeedback.razor:17-20`).
  The distinction is deliberate: a toast expires, and a feedback page that silently shows zero responses
  after a failed fetch reads as "nobody answered". A missing event sets the same field with
  `L["Error.EventNotFound"]` (line 63) rather than the generic message.
  `[Rubric §19, State Management & Data Flow]` assesses where view state lives and how failure is
  represented: loading, error, empty, and populated are four distinct rendered states driven by
  `IsLoading` (line 29), `_loadError`, and the two collections.
  `[Rubric §30, Compliance, Privacy & Data Governance]` assesses control over user-submitted content:
  answer deletion is the organizer's moderation lever over free-text feedback (BR-53, cited in the type's
  own doc comment, lines 12-15).
  `[Rubric §23, Front-End Performance & Rendering]`: aggregation happens client-side over one bulk answer
  fetch (line 80) rather than per-question round trips.
- **Walkthrough**
  - The route id arrives as `[Parameter] public string EventId` (line 23) and is converted to the typed
    alias with `EventId.Parse<EventIdentifierType>()` (line 48), so the page compiles unchanged whichever
    primitive the alias maps to (ADR-048, revisited in ADR-085).
  - `OnInitializedAsync` (lines 37-97) builds breadcrumbs (lines 39-44), resolves the event name from the
    lookup dictionary and bails with `Error.EventNotFound` when the id is unknown (lines 51-65), loads
    **every** event question through
    [`FeedbackQuestionLoader`](#feedbackquestionloader)`.LoadAllAsync(QuestionService, "Event", ...)`
    (lines 69-70), then loads all answers for the event (line 80). The `finally` always clears
    `IsLoading` (lines 93-96).
  - Rendering (`.../Pages/Feedback/OrganizerEventFeedback.razor:37-88`) pairs each question with
    `_answers.Where(a => a.QuestionId == question.Id)` (line 39). A question whose `QuestionType` is
    `"Rating"` (case-insensitive, line 55) parses the answer values to integers, drops the unparseable
    ones, and renders a read-only `MudRating` at the rounded average plus the average to one decimal and
    the ratings count (lines 57-69). Anything else renders each answer as pre-wrapped text with a delete
    icon button carrying an `aria-label` (lines 74-83). `[Rubric §21, Accessibility]`.
  - `DeleteAnswerAsync` (lines 99-124) deletes one answer, **refetches the whole answer set** (line 110),
    and toasts the outcome, so the page never hand-patches its local collection.
- **Why it's built this way**: the organizer needs one screen that answers "what did attendees say about
  this event", and the aggregate-versus-free-text split follows from the question model itself: ratings
  are only meaningful in aggregate, free text is only meaningful individually (and is the only thing that
  can need moderating).
- **Where it's used**: the `/events/{EventId}/feedback` route
  (`.../Pages/Feedback/OrganizerEventFeedback.razor:1-2`, organizer-only), reached from the "view
  feedback" button on [`EventDetail`](#eventdetail) (`.../Pages/Event/EventDetail.razor:135-136`). The
  attendee-facing counterpart lives in the Engagement module
  ([`EventFeedback`](group-22-engagement-module.md#eventfeedback)).
- **Caveats / not-in-source**: the delete affordance renders only in the non-rating branch
  (`.../Pages/Feedback/OrganizerEventFeedback.razor:74-83`), so a rating answer has no moderation button
  on this page.

### OrganizerSessionFeedback

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Feedback` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerSessionFeedback.razor.cs:18` · Level 6 · class (Blazor code-behind)

- **What it is**: the session-scoped twin of [`OrganizerEventFeedback`](#organizereventfeedback). Same
  load-group-aggregate-moderate flow, one level down the hierarchy: answers for a single session instead
  of a whole event.
- **Depends on**: [`IOrganizerSessionFeedbackUIService`](#iorganizersessionfeedbackuiservice) (line 18),
  [`IQuestionUIService`](#iquestionuiservice) (line 19), and [`ISessionUIService`](#isessionuiservice)
  (line 20) in place of the event lookup, plus
  [`IToastService`](group-15-common-ui-framework.md#itoastservice) (line 21) and
  [`FeedbackQuestionLoader`](#feedbackquestionloader) (line 66); the
  [`SessionQuestionAnswerDTO`](group-17-conference-domain.md#sessionquestionanswerdto) and
  [`QuestionDTO`](group-17-conference-domain.md#questiondto) shapes;
  [`ConferenceRoutePaths`](#conferenceroutepaths); and the same
  [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper) `Parse<T>` extension (line 5).
- **Concept introduced**: none new. The page-level error state, the rating-versus-text rendering split,
  and the refetch-after-delete rule are the ones taught in
  [`OrganizerEventFeedback`](#organizereventfeedback).
- **Walkthrough** (only the differences from its twin):
  - The route parameter is `[Parameter] public string SessionId` (line 23), parsed to
    `SessionIdentifierType` (line 48).
  - The title comes from the session itself rather than a lookup dictionary:
    `SessionService.GetByIdAsync(_parsedSessionId, false, ...)` with `includeChildren: false` (line 51),
    since only `session.Title` is needed (line 62).
  - **Failure is classified, not flattened.** The load distinguishes a genuine miss from any other error:
    `sessionResult.IsNotFound()` chooses `L["Error.SessionNotFound"]`, anything else keeps the generic
    `L["Error.LoadFailed"]` (lines 56-58), and the in-code comment (lines 54-55) records that this is the
    `Result`-based replacement for what used to arrive as a null success. The event twin cannot do this,
    because its miss is a dictionary lookup rather than a fetch.
  - The question filter is `"Session"` (line 67), the other half of the same question table that the
    event page filters on `"Event"`.
  - `DeleteAnswerAsync` (lines 96-121) takes a `SessionQuestionAnswerIdentifierType` and passes the
    parsed session id alongside it (line 100).
  - The template renders the session title as a `MudLink` back to its detail page
    (`.../Pages/Feedback/OrganizerSessionFeedback.razor:23`) where the event page renders plain text, and
    ends with a back button to the same route (line 92).
- **Why it's built this way**: session and event feedback are two instances of one questionnaire model,
  so the two pages stay structurally identical rather than sharing a parameterized component. The cost is
  duplication; the benefit is that each page's queries and route contract read literally. The genuinely
  shared part, the paged question read, was extracted into
  [`FeedbackQuestionLoader`](#feedbackquestionloader) rather than duplicated.
- **Where it's used**: the `/sessions/{SessionId}/feedback` route
  (`.../Pages/Feedback/OrganizerSessionFeedback.razor:1-2`), reached from the "view feedback" button on
  [`SessionDetail`](#sessiondetail) (`.../Pages/Session/SessionDetail.razor:161-162`). The
  attendee-facing counterpart is [`SessionFeedback`](group-22-engagement-module.md#sessionfeedback).

### PublicEventDetail
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Events/PublicEventDetail.razor.cs:19` · Level 8 · class (Blazor code-behind)

- **What it is**: the read-only public view of one event: venue information, rooms, support contacts, and the conference-day conveniences (copy the Wi-Fi details, open directions, a distance-to-venue hint, a QR code for the page itself). For a public visitor it is also the landing page of the whole conference, because [`PublicEventList`](#publiceventlist) redirects them here.
- **Depends on**: [`IEventUIService`](#ieventuiservice) (`:20`), [`EventDTO`](group-17-conference-domain.md#eventdto), [`IToastService`](group-15-common-ui-framework.md#itoastservice) (`:22`), [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience) (`:64`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:80`, `:170`, `:172`, `:174`), [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Id.Parse<T>` extension for the route string (`:118`, defined at `MMCA.Common/Source/Core/MMCA.Common.Shared/DomainHelper.cs:30`), and four device-capability abstractions: [`IClipboardService`](group-26-device-capability-layer.md#iclipboardservice), [`IMapNavigationService`](group-26-device-capability-layer.md#imapnavigationservice), [`IGeolocationService`](group-26-device-capability-layer.md#igeolocationservice), [`IGeocodingService`](group-26-device-capability-layer.md#igeocodingservice) (`:23-26`), whose [`GeoPoint`](group-26-device-capability-layer.md#geopoint) results supply the `DistanceKmTo` used at `:231`. It also reads `IConfiguration` for the host-wide support contacts (`:27`, `:56-57`).
- **Concept introduced, the generation counter, the audience-shaped breadcrumb trail, and best-effort progressive enhancement.** Three mechanisms are worth extracting.
  1. **Load once per id, and let the newest load win.** The route value arrives as `[Parameter] string Id` (`:29`), and `OnParametersSetAsync` compares it against `_loadedId` (`:99-108`) so a re-render does not refetch. On top of that, `_loadGeneration` (`:94`) is bumped at the top of every `LoadEventAsync` (`:113`) and re-checked after each await (`:120`, `:161`), so a superseded fetch drops its results. The field doc explains why the generation and not the route id is authoritative (`:88-93`): `_loadedId` is stamped synchronously before the await, so two rapid route changes would otherwise let the later-completing fetch paint the wrong event. The `finally` is guarded by the same test (`:159-164`), because an unconditional clear would let a superseded response switch off the spinner the newer load just turned on. `[Rubric §19, State Management & Data Flow]`.
  2. **The breadcrumb trail depends on the audience, and the audience is awaited first.** `OnInitializedAsync` resolves privileged status from role membership before building the trail (`:59-70`), then adds the "Events" crumb only for a privileged reader (`:78-81`). The doc comment states both halves of the reasoning (`:46-53`): a public visitor was redirected *to* this page by the event list, so an Events crumb would bounce them straight back here, and the access token hydrates asynchronously from the HttpOnly cookie, so reading roles synchronously would render the wrong trail and correct it on the next render. A failed auth read is treated as non-privileged (`:66-69`). `[Rubric §25, Navigation & Information Architecture]` (assesses that navigation affordances lead somewhere the reader can actually use) and `[Rubric §26, Front-End Security]` (fail closed to the narrower audience).
  3. **Every capability is optional.** `TryComputeDistanceAsync` (`:211-233`) returns early when geolocation or geocoding is unsupported or the venue address is blank (`:213-216`), and again on any null result or superseded generation (`:219`, `:225`), so a denied permission or an offline geocoder simply leaves the hint off. The doc comment states the rule plainly: this must never block the page (`:206-210`). `[Rubric §29, Resilience & Business Continuity]` (assesses degradation when an optional dependency is absent) and `[Rubric §26, Front-End Security]` (a location read is soft and unblocking, never a gate on content). These come from the device-capability layer of [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html).
  A fourth detail is a small but real configuration rule: a per-event `OrganizerContactEmail` wins over the host-wide `Support:Email`, and it is re-evaluated on every load so navigating between events never leaves the previous organizer's address on screen (`:139-144`). `[Rubric §15, Best Practices & Code Quality]`: a conference can publish its own contact without a redeploy.
- **Walkthrough**
  - `LoadEventAsync` (`:110-166`): parse the id (`:118`), fetch with children (`GetByIdAsync(eventId, true, ...)`, `:119`), and on failure clear `Event` so a failed navigation never leaves the previous event on screen, toasting the not-found wording for a 404 and the page's fixed load-failure key otherwise (`:125-134`); on success resolve the support address and kick off the distance hint (`:136-147`). `OperationCanceledException` is swallowed as expected teardown (`:149-152`) and a broad `catch` toasts the same load-failure key (`:153-156`).
  - `CopyWifiAsync` (`:178-189`): copies `Event.WiFiInfo` through the clipboard abstraction and reports success or failure with one toast whose severity flips on the result (`:185-188`).
  - `OpenDirectionsAsync` (`:191-204`): native heads launch the platform maps app, browsers open a maps site (`:198-199`); a false return raises a warning (`:200-203`).
  - `TryComputeDistanceAsync` (`:211-233`): geocodes the venue (`:218`), reads the current-or-last-known position (`:224`), converts kilometres to miles with an explicit named constant (`:230-231`), and calls `StateHasChanged()` (`:232`) because the value arrives after the render that requested it; the markup renders it to one decimal in the viewer's culture (`PublicEventDetail.razor:58-61`).
  - Navigation helpers (`:170-176`) route back to the list (privileged readers only, per the comment at `:168-169`), on to the public schedule, on to the activities page, and to the event feedback form. Disposal (`:237-257`) is the standard cancel-on-disposal pattern over the `CancellationTokenSource` at `:33`.
- **Why it's built this way**: the public event page is the one an attendee opens while standing in the building, so its extras (Wi-Fi, directions, distance) are worth having and none of them is worth failing the page over.
- **Where it's used**: the `/conference/events/{Id}` route (`PublicEventDetail.razor:1`), reached from [`PublicEventList`](#publiceventlist) either as a grid row (privileged) or as a `replace: true` redirect (everyone else); its markup also renders the `QrCodeButton` for this page's own public link (`PublicEventDetail.razor:30`).

### PublicActivityList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public.Activities` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Activities/PublicActivityList.razor.cs:21` · Level 9 · class (Blazor code-behind)

- **What it is**: the public social and networking programme. It lists the current (or next) event's activities (pre-conference party, coffee connect, after-party, closing ceremony) ordered by start time then display order, read-only and anonymous, BR-43 (class doc, `PublicActivityList.razor.cs:13-20`).
- **Depends on**: [`IActivityUIService`](#iactivityuiservice) and [`IEventLookupService`](#ieventlookupservice) (`:27-28`), [`ActivityDTO`](group-17-conference-domain.md#activitydto), [`EventInfo`](#eventinfo) (through the lookup), [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (`:54-59`), [`IMapNavigationService`](group-26-device-capability-layer.md#imapnavigationservice) (`:29`), and [`IToastService`](group-15-common-ui-framework.md#itoastservice) (`:30`). It derives from `ComponentBase` directly (`:20`), not from the list-page base.
- **Concept introduced, the bounded, deterministically ordered, single-shot read.** This page is not a data grid, and reading it next to [`PublicEventList`](#publiceventlist) is the clearest way to see when the base class is the wrong tool. An activity programme is a handful of items with a fixed narrative order (chronological), so there is nothing to page, sort or search.
  - **Bounded read**: `MaxActivities = 200` with the reasoning written on the constant, a conference schedules a handful, not thousands (`:22-24`). `[Rubric §12, Performance & Scalability]` (assesses that unbounded reads are avoided by design, not by luck).
  - **Deterministic order**: the server is asked for `StartTime` ascending (`:72-73`), and the result is re-ordered in memory by `StartTime`, then `SortOrder`, then `Name` (`:84-90`). The comment (`:81-83`) explains the layering: start time is the programme order, sort order breaks ties between activities that start together, and name is the final tiebreak so the list is deterministic rather than dependent on insertion order.
  - **Two independent non-critical reads.** Both the event lookup (`:52`) and the activity page (`:79`) are consumed through `TryGetValue`, and each failure has a stated fallback written next to it: without the lookup the list is simply not scoped to an event (`:51`), and a failed fetch leaves the page on its empty state (`:77-78`). Neither raises an error toast, and only `OperationCanceledException` is caught (`:93-96`) as expected teardown or an InteractiveAuto transition; the `finally` always clears `_isLoading` (`:97-100`). `[Rubric §29, Resilience & Business Continuity]`.
  - **Culture-aware time rendering**: `FormatTimeRange` (`:40-44`) formats start and end with `CultureInfo.CurrentCulture` and composes them through a localized `Text.TimeRange` resource, so both the times and the separator follow the viewer's culture. `[Rubric §27, Internationalization]` (assesses that formatting and phrasing are both localized, not just the strings).
  The class doc also draws the domain line that shapes the whole page (`:16-18`): activities are not sessions. They carry no room and no speakers, and an activity with its own venue offers the same directions affordance the public event page uses for the conference venue.
- **Walkthrough**
  - `OnInitializedAsync` (`:46-101`): load the event lookup (`:52`), resolve the current or next event through [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector)`.SelectCurrentOrNext` with the four accessors passed explicitly because the lookup returns [`EventInfo`](#eventinfo) rather than [`EventDTO`](group-17-conference-domain.md#eventdto) (`:54-59`), remember its id and name (`:61-62`), build an `EventId equals` filter when one resolved (`:65-67`), fetch one bounded page (`:69-75`), and materialize the ordered list (`:84-90`).
  - `OpenDirectionsAsync` (`:103-120`): does nothing for an activity with no venue address (`:105-108`), otherwise launches the platform maps app on native heads or a maps site in a browser (`:111-114`), labelling the pin with the venue name and falling back to the activity name when the venue is unnamed (`:113`); a false return raises one warning toast (`:116-119`).
  - Disposal (`:124-144`) is the standard cancel-on-disposal pattern over the `CancellationTokenSource` at `:32`.
- **Why it's built this way**: a fixed-order programme wants a readable timeline, not sortable columns, and the read is small enough that one bounded call beats the machinery of server paging.
- **Where it's used**: the `/conference/activities` route (`PublicActivityList.razor:1`, the same string as `ConferenceRoutePaths.PublicActivities` at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:50`), reached from [`PublicEventDetail`](#publiceventdetail)'s `ViewActivities` action (`PublicEventDetail.razor.cs:175`).
- **Caveats / not-in-source**: the page relies on the server scoping non-privileged callers to published events (class doc, `:14-16`); that scoping is enforced in the Conference API, not here.

### PublicEventList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Events/PublicEventList.razor.cs:31` · Level 9 · class (Blazor code-behind)

- **What it is**: the `/conference/events` route, where the audience decides whether a list is shown at all. A privileged reader (Organizer or ContentEditor) gets the full grid of published **and** unpublished events; every other visitor is redirected to the current or next event's detail page (class doc, `PublicEventList.razor.cs:14-30`).
- **Depends on**: extends [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) closed over [`EventDTO`](group-17-conference-domain.md#eventdto) (`:31`); [`IEventUIService`](#ieventuiservice) and [`IEventLookupService`](#ieventlookupservice) (`:35-36`), [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience) (`:77`), [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (`:102`), [`EventInfo`](#eventinfo) (`:92`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:114`, `:158`), [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) (`:46`, rendered at `PublicEventList.razor:23`), [`ListPageActions`](group-15-common-ui-framework.md#listpageactions) (`:132`), and [`Result`](group-01-result-error-handling.md#result) in the mobile fetch signature (`:148`). Server-side the audience split is enforced by [`PublishedEventSpecification`](group-18-conference-application.md#publishedeventspecification).
- **Concept introduced, the audience gate as a routing decision, and the three-state render.** This page is the sharpest example in the group of a UI decision that has to wait for identity.
  1. **Resolve the audience before deciding anything.** `OnInitializedAsync` awaits the cascading `Task<AuthenticationState>` and reads role membership first (`:72-83`). The comment (`:69-71`) and the class doc (`:22-26`) both name the failure this prevents: on all three heads (Blazor Server, WebAssembly, MAUI) the access token hydrates asynchronously from the HttpOnly cookie, so a synchronous role read would see an anonymous principal and bounce an organizer off their own list. A failed read is treated as non-privileged (`:79-82`). `[Rubric §11, Security]` and `[Rubric §26, Front-End Security]` (assess that an authorization-shaped branch reads a settled principal, and fails to the narrower audience).
  2. **Three states, and one of them renders nothing.** `_showGrid` (`:53`) opens the search box and the layout switch for a privileged reader (`:85-89`); `_showEmpty` (`:61`) is set only when nothing is published anywhere, so there is no redirect target and the page has to stay and say so (`:118-120`); and the redirect path deliberately leaves **both** false (`:109-116`), so the page stays blank until the navigation takes effect instead of flashing a list on the way out. The field doc spells this out (`:55-60`). `[Rubric §18, UI Architecture & Component Design]` (assesses that intermediate states are designed rather than incidental).
  3. **`replace: true` on the redirect.** The comment (`:111-113`) records the exact trap it prevents: left in the history stack, Back from the event detail would land here and redirect straight forward again, trapping the visitor on the detail page. `[Rubric §25, Navigation & Information Architecture]` (assesses that the Back button keeps working).
  The redirect target is computed with [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector)`.SelectCurrentOrNext`, passing the four accessors explicitly because the lookup returns [`EventInfo`](#eventinfo) rather than [`EventDTO`](group-17-conference-domain.md#eventdto), which the comment calls out (`:98-107`). It is the same live-window math every other landing surface uses, so a visitor always lands on the conference that is actually happening. A failed lookup is non-critical and leaves `events` null (`:91-96`), which falls through to the empty state rather than to a broken redirect.
- **Walkthrough**
  - `GridRef` (`:42`) exposes the captured grid so the base can restore rows-per-page and current page; `RetryLoadAsync` (`:45`) re-runs the fetch from the inline error state the base renders when `LoadFailed` is set (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:42`). `[Rubric §29, Resilience & Business Continuity]`.
  - `SaveFilters` / `RestoreFilters` (`:123-127`) persist the one search term; `OnSearchChanged` (`:129-133`) stores it and reloads whichever layout is active through [`ListPageActions`](group-15-common-ui-framework.md#listpageactions)`.ReloadActiveLayoutAsync` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/ListPageActions.cs:26`).
  - `LoadServerData` (`:135-145`) passes `showCancelSnackbar: false` (`:145`), so a superseded fetch (the reader typed another character) is silent rather than raising a toast, and turns the search string into a `Name contains` server filter (`:142-143`).
  - `FetchMobilePage` (`:148-155`) is the parallel infinite-scroll path, hard-sorted by `Name` ascending; `OnMobileCardClick` (`:157-158`) routes to [`PublicEventDetail`](#publiceventdetail).
- **Why it's built this way**: a public visitor cares about the conference that is running or coming up, not about a roster of past editions, while an organizer curating the catalog needs every row including the unpublished ones. One route serving both is cheaper than two, provided the audience is known before the branch is taken.
- **Where it's used**: the `/conference/events` route (`PublicEventList.razor:1`). Every non-privileged arrival leaves immediately for [`PublicEventDetail`](#publiceventdetail); privileged rows and cards navigate to the same page.
- **Caveats / not-in-source**: the published-only scoping of the underlying reads for non-privileged callers (BR-108, class doc `:27-28`) is enforced in the Conference API through [`PublishedEventSpecification`](group-18-conference-application.md#publishedeventspecification), not on this page.

### PublicSponsorList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Sponsors/PublicSponsorList.razor.cs:20` · Level 9 · class (Blazor code-behind)

- **What it is**: the public sponsor and exhibitor page. It groups the current (or next) event's sponsors by tier, orders them within each tier, and renders them as logo cards. Read-only and anonymous, BR-43 (class doc, `PublicSponsorList.razor.cs:12-19`).
- **Depends on**: [`ISponsorUIService`](#isponsoruiservice) and [`IEventLookupService`](#ieventlookupservice) (`:26-27`), [`SponsorDTO`](group-17-conference-domain.md#sponsordto) and [`SponsorTier`](group-17-conference-domain.md#sponsortier) (`:40`), [`EventInfo`](#eventinfo) (through the lookup), and [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (`:53-58`); MudBlazor and the page's `IStringLocalizer` (`PublicSponsorList.razor:3`). Like [`PublicActivityList`](#publicactivitylist) it derives from `ComponentBase` directly (`:19`).
- **Concept introduced, the deterministic grouped read and the graceful empty state.** Like [`PublicActivityList`](#publicactivitylist), this page is not a data grid: the roster is small and needs a fixed visual hierarchy, so the page fetches one bounded page and shapes it in memory.
  - **Bounded read**: `MaxSponsors = 200` with the reasoning stated on the constant, a conference sells dozens, not thousands (`:21-22`). `[Rubric §12, Performance & Scalability]`.
  - **Deterministic order**: sponsors are grouped by tier, tiers ordered ascending because that is package order (Platinum first), and each group ordered by `Sort` then `Name` (`:84-92`), so the strip does not depend on insertion order. The comment states the rule (`:81-83`).
  - **Empty state with no dead link**: when the event has no sponsors the page falls back to the sponsorship-packet call to action, and when the event publishes no packet URL that call to action is hidden entirely rather than offering a dead link (class doc `:15-17`, field doc `:33-36`, assigned at `:62`). `[Rubric §24, Forms, Validation & UX Safety]` and `[Rubric §25, Navigation & Information Architecture]`: a missing value removes an affordance instead of producing a broken one.
  - **Failure is non-fatal, and stated as such**: both reads are consumed through `TryGetValue` with the fallback written beside them (`:50`, `:77-78`), only `OperationCanceledException` is caught (`:95-98`) as expected teardown or an InteractiveAuto transition, and the `finally` always clears `_isLoading` (`:99-102`). `[Rubric §29, Resilience & Business Continuity]`.
- **Walkthrough**: `OnInitializedAsync` (`:45-103`) loads the event lookup (`:51`), resolves the current or next event with [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) passing the four accessors explicitly (`:53-58`), remembers its name and sponsorship packet URL (`:61-62`), builds an `EventId equals` filter when an event resolved (`:65-67`), fetches one page sorted by `Sort` ascending (`:69-75`), and materializes `_tiers` as an ordered list of tier-to-sponsors pairs (`:84-92`). `TierLabel` (`:43`) localizes each tier name through the page's `IStringLocalizer` with a `Tier.{tier}` key, so the tier enum never reaches the screen untranslated (`[Rubric §27, Internationalization]`). Disposal (`:107-127`) is the standard cancel-on-disposal pattern over the `CancellationTokenSource` at `:29`.
- **Why it's built this way**: the sponsor page is a marketing surface with a fixed hierarchy, so it wants deterministic grouping rather than sortable columns, and it must look intentional on an event that has not sold a sponsorship yet.
- **Where it's used**: the `/conference/sponsors` route (`PublicSponsorList.razor:1`, matching `ConferenceRoutePaths.PublicSponsors` at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:49`). The roster it renders is authored by the organizer through the sponsor admin pages in this module.
- **Caveats / not-in-source**: the page relies on the server scoping non-privileged callers to published events (class doc, `:13-15`); that scoping is enforced in the Conference API, not here.

### PublicSpeakerDetail
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Speakers/PublicSpeakerDetail.razor.cs:22` · Level 10 · class (Blazor code-behind)

- **What it is**: the public speaker profile: photo, bio, social links, and the sessions that speaker presents at the conference the reader is allowed to see. Email is deliberately **not** rendered, BR-66 (class doc, `PublicSpeakerDetail.razor.cs:18-21`).
- **Depends on**: [`ISpeakerUIService`](#ispeakeruiservice), [`ISessionUIService`](#isessionuiservice) and [`IEventUIService`](#ieventuiservice) (`:22-24`), `AuthenticationStateProvider` read directly rather than as a cascading task (`:25`), [`IToastService`](group-15-common-ui-framework.md#itoastservice) (`:27`), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) and [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience) (`:205`), [`CurrentEventDefaults`](group-17-conference-domain.md#currenteventdefaults) (`:212`), [`ConferenceRoutePaths`](#conferenceroutepaths) (`:216`, `:218`), and [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Id.Parse<T>` (`:98`).
- **Concept introduced, the prerender skip, the server-side filter that replaced an in-memory one, and fail-closed audience scoping.**
  1. **Prerender skip.** `OnParametersSetAsync` returns immediately when `!RendererInfo.IsInteractive` (`:76-79`): under InteractiveAuto the interactive instance re-runs the method, so without this guard every visit fetched the speaker and the session catalog twice. The prerender pass renders the loading skeleton, and the comment names the sibling pages that use the same guard (`:73-75`). `[Rubric §23, Front-End Performance & Rendering]` (assesses avoidable duplicate work per view).
  2. **Push the filter to the server.** `LoadSpeakerSessionsAsync` (`:157-194`) sends a `SpeakerId equals` filter with `includeChildren: false`, sorted by `StartsAt` ascending, capped at `MaxSpeakerSessions = 100` (`:31-32`, request at `:178-185`). The remarks block (`:147-152`) records what this replaced: the page used to pull the entire session catalog with all child collections and filter it in memory on `SessionSpeakers`, so viewing one speaker cost a full-catalog read. Since the page never renders those children, they are gone from the request too. `[Rubric §12, Performance & Scalability]` and `[Rubric §8, Data Architecture]` (a bounded page size instead of an unbounded read).
  3. **Fail closed on the audience scope.** `ResolveSessionEventScopeAsync` (`:202-214`) returns an unscoped result for a privileged reader (`:205-208`) and otherwise resolves the current or next event through [`CurrentEventDefaults`](group-17-conference-domain.md#currenteventdefaults) (`:212`); a failed events lookup returns `(false, null)`, an *unresolved* scope rather than a wide one, and the caller turns that into a load failure (`:167-170`). The comment states the leak it prevents (`:164-166`): without this, a speaker who also presented at past conferences leaked those sessions to attendees here. `[Rubric §11, Security]` and `[Rubric §26, Front-End Security]`.
  `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses deliberate handling of personal data): the speaker email exists on the DTO but is never rendered on the public page, and the class doc names the rule.
- **Walkthrough**
  - `OnInitialized` (`:40-49`) builds the Home / Speakers / Profile breadcrumbs; unlike [`PublicEventDetail`](#publiceventdetail) it is synchronous, because the speaker list is reachable by every audience and the trail does not vary.
  - `HasSocialLinks` (`:65-69`) collapses the four optional link fields into a single render guard, so the social row is absent rather than empty when a speaker supplied none.
  - `LoadSpeakerAsync` (`:90-141`): bump the generation (`:93`, field doc at `:53-58`), parse the id (`:98`), `GetByIdAsync(speakerId, true, ...)` (`:99`), clear `Speaker` and toast not-found-versus-load-failed on failure (`:105-115`), then load the sessions and toast one load failure if that resolver returned false (`:119-122`); `OperationCanceledException` is swallowed (`:124-127`) and the generation-guarded `finally` clears `IsLoading` (`:132-140`).
  - Navigation (`:216-218`) routes to a session or back to the speaker list. Disposal (`:222-242`) is the standard cancel-on-disposal pattern over the page's `CancellationTokenSource` (`:34`).
- **Why it's built this way**: a public profile is a read-only, cache-friendly page; keeping its fetches narrow (one speaker, that speaker's sessions for one event, no children) is what makes it cheap enough to serve to an anonymous crowd, and scoping those sessions to the reader's event keeps the profile consistent with the schedule they can actually browse.
- **Where it's used**: the `/conference/speakers/{Id}` route (`PublicSpeakerDetail.razor:1`), reached from [`PublicSpeakerList`](#publicspeakerlist) cards and from session pages. Its markup renders the `QrCodeButton` for its own link (`PublicSpeakerDetail.razor:45`).

### PublicSpeakerList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Speakers/PublicSpeakerList.razor.cs:33` · Level 10 · class (Blazor code-behind)

- **What it is**: the public speaker directory, rendered as a photo-forward responsive **card grid** with infinite scroll, the same layout on desktop and mobile. Read-only for everyone (BR-43), no emails (BR-66), and the server returns only speakers with a visible session in the listed event, or in any published event when no event filter is applied, BR-239 (class doc, `PublicSpeakerList.razor.cs:10-32`).
- **Depends on**: extends [`EventFilteredListPageBase<TDto>`](#eventfilteredlistpagebasetdto) closed over [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) (`:33`), which itself extends [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Common/EventFilteredListPageBase.cs:25`); [`ISpeakerUIService`](#ispeakeruiservice) (`:42`), [`ConferenceReadAudience`](group-17-conference-domain.md#conferencereadaudience) (`:101`), and [`InfiniteScrollSentinel`](group-15-common-ui-framework.md#infinitescrollsentinel) (`PublicSpeakerList.razor:144`). Note what is **absent**: no `MudDataGrid`, no `GridRef` override, no [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem).
- **Concept introduced, borrowing a base class's plumbing for a layout it was not written for.** A speaker is a face and a tagline, not a row of columns, so this page throws away the grid and keeps everything else. The class doc explains the trade (`:21-28`): paging keeps the page-based model of the base's mobile path (`MobileItems`, `MobileCurrentPage`, `MobileTotalItems`, `MobilePageSize`, declared at `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:49-52`), which already owns the cancellation token, the loading and failure flags, and the saved-state plumbing, and layers infinite scroll on top by **appending** each fetched page to `_loadedSpeakers` (`:55`, appended at `:161` and `:197`) rather than replacing, which is what the base's mobile path does on its own.
  The event-filter half is not hand-rolled either: [`EventFilteredListPageBase<TDto>`](#eventfilteredlistpagebasetdto) owns the events load, the `"all"` sentinel, the picker, and the `EventId` filter, and this page supplies four overrides. `EventFilterIsUserControlled => _isPrivileged` (`:53`) is the audience gate: only privileged readers pick their own event, so only their choice is persisted and restored, and everyone else is recomputed to the current or next event (doc at `:49-52`, base contract at `EventFilteredListPageBase.cs:57`). `OnEventsLoadingAsync` (`:91-107`) resolves privileged status *before* the events are fetched, because that decides whether a restored choice survives, with a failed read treated as non-privileged (`:104-106`). `ReloadForEventFilterAsync` (`:222`) and `SavePageFilters` / `RestorePageFilters` (`:73-77`) fill in the rest. `[Rubric §15, Best Practices & Code Quality]` and `[Rubric §1, SOLID]` (assess reuse of one tested mechanism rather than a parallel implementation); `[Rubric §11, Security]` and `[Rubric §26, Front-End Security]` for the persistence gate.
  Four correctness details make that borrowing safe, and they are the real lesson of this page.
  1. **A generation counter supersedes in-flight fetches.** `_generation` (`:65`) is bumped by every reset (search, event filter, breakpoint change, retry) inside `LoadSpeakersAsync` (`:143`), and both `LoadSpeakersAsync` (`:154-157`) and `LoadMoreSpeakersAsync` (`:186-188`, `:202-206`) discard their rows when a newer generation has taken over. Without it a slow page-1 fetch could append to the list a later query had already cleared. `[Rubric §19, State Management & Data Flow]`.
  2. **The list is cleared before the await, not after.** The comment (`:147-148`) states why: the grid, and with it the sentinel, is gone while page 1 is in flight, so a stray intersection-observer callback cannot ask for page 2 of the query being replaced. `[Rubric §18, UI Architecture & Component Design]`.
  3. **The page number is committed only on success.** `LoadMoreSpeakersAsync` saves `previousPage`, optimistically advances, and rolls back when `LoadFailed` is set (`:178-198`), so the retry button re-requests the same page instead of silently skipping it. `[Rubric §29, Resilience & Business Continuity]`.
  4. **An unscoped query is refused rather than issued.** `ScopeUnresolvedForPublicReader()` (`:135`) is true exactly when a non-privileged reader has no event scope *because the events fetch failed*. `FetchCurrentPageAsync` (`:113-132`) re-resolves the events first in that state (`:121-124`), which heals a transient failure on the retry path, and the fetch delegate then throws rather than falling through to an unscoped query that would show other conferences' speakers (`:127-130`). The comment records the invariant and its one deliberate exception (`:115-120`): a *successful* fetch that genuinely found no published events keeps the unscoped default, matching [`PublicSessionList`](#publicsessionlist). `[Rubric §11, Security]` and `[Rubric §26, Front-End Security]`.
- **Walkthrough**
  - `CardsPerPage = 12` (`:35-36`) is assigned to the base's `MobilePageSize` in the constructor (`:38`), with the reasoning on the constant: a multiple of 2, 3 and 4 so a full chunk fills whole rows at every breakpoint. `[Rubric §22, Responsive & Cross-Browser]`.
  - `HasMoreSpeakers` (`:71`) is true exactly while pages remain unfetched, and that is exactly when the sentinel renders (`PublicSpeakerList.razor:133-147`, comment at `:131-132`), so the trigger and the condition cannot disagree; the markup comment notes that the sentinel's absence *is* the "everything is loaded" signal, for the reader and for the tests.
  - `OnInitializedAsync` (`:79-85`) awaits the base first, because the base starts the events load before its own first await so the default event filter is resolved before the first speaker fetch, then runs `LoadSpeakersAsync`.
  - `FetchCurrentPageAsync` (`:113-132`) delegates to the base's `LoadMobileDataAsync` (`DataGridListPageBase.cs:727`) with a fixed `FullName` ascending sort; `ApplyFilters` (`:224-229`) emits `FullName contains` plus the base's `ApplyEventFilter` (`:228`, `EventFilteredListPageBase.cs:195`), which travels as the **virtual** `EventId` filter key that the speakers endpoint resolves through the EventSpeaker and SessionSpeaker joins, since a Speaker row has no `EventId` column (class doc, `:19-20`).
  - `OnMobileDataRequestedAsync` (`:214`) is the base's breakpoint-change hook (`DataGridListPageBase.cs:949`, invoked at `:313`), overridden here to restart the accumulation rather than fetch one replacement page.
  - `RetryLoadAsync` (`:211`), `OnSearchChanged` (`:216-220`) and `ReloadForEventFilterAsync` (`:222`) all funnel through `LoadSpeakersAsync`, which is the single reset entry point.
  - `Initials` (`:232-239`) builds the no-photo avatar text with spans, tolerating a blank first or last name; `HasSocialLinks` (`:241-245`) hides the social row when a speaker supplied none.
- **Why it's built this way**: attendees browse "the speakers at this conference", not a lifetime roster, so the default filter is the primary behavior and the picker is the privileged exception; and a directory of faces reads better as an endless wall of cards than as a pager. The class doc adds one more deliberate omission (`:29-31`): category chips are absent because the paged endpoint is called with `includeChildren=false`, so asking for them would both enlarge the payload and change the URL the output-cache warmup pins ([ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).
- **Where it's used**: the `/conference/speakers` route (`PublicSpeakerList.razor:1`, matching `ConferenceRoutePaths.PublicSpeakers` at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:47`); cards navigate to [`PublicSpeakerDetail`](#publicspeakerdetail).
- **Caveats / not-in-source**: the join-based resolution of the virtual `EventId` filter is asserted by the class doc comment; the resolution itself lives in the Conference API. A restored mobile page number is deliberately ignored (class doc, `:26-28`), so a reader returning to this page starts at page 1 rather than at the scroll depth they left.


---
[⬅ ADC Conference - API, gRPC Contracts & Service Host](group-20-conference-api-grpc.md)  •  [Index](00-index.md)  •  [ADC Engagement Module (Session Bookmarks) ➡](group-22-engagement-module.md)
