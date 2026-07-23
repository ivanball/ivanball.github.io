# 21. ADC Conference - UI

**What this chapter covers.** This is the **consumer half** of the "write-once UI, render everywhere" story (primer §2): the Blazor pages and per-page HTTP services that turn the Conference REST surface ([G20](group-20-conference-api-grpc.md)) into the screens an organizer, a speaker, or an anonymous attendee actually touches. Everything here lives in the per-module Razor Class Library `MMCA.ADC.Conference.UI` (under `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/`), which, like every consumer UI, assembles the reusable primitives taught in [G15 (Common UI Framework)](group-15-common-ui-framework.md) into concrete pages. There is almost no new *infrastructure* here; the value is in seeing how a real, ten-area feature surface (events, sessions, speakers, categories, questions, rooms, feedback, public browsing, session selection, and the conference landing page) is *composed* from the framework's list-page base, typed HTTP service base, device-capability abstractions, and module system. The headline lens is `[Rubric §18, UI Architecture & Component Design]` (assesses component reuse, separation of presentation from data access, and a coherent composition model). Because the very same Razor components compile into the Blazor Server, WebAssembly, and .NET MAUI hybrid heads, this one library renders the conference across Web, Android, iOS, macOS, and Windows with no per-platform reimplementation. `[Rubric §22, Responsive & Cross-Browser/Device]`.

**The layering inside the UI: a page never touches `HttpClient`.** Each page is a `.razor` + `.razor.cs` code-behind pair that depends only on a *UI service interface*, never on `HttpClient`, never on the API's internals. The CRUD-shaped entities (events, sessions, speakers, categories, category items, questions, rooms) each get a service deriving from Common's [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype) and exposing the [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype) contract: [`EventService`](#eventservice), [`SessionService`](#sessionservice), [`SpeakerService`](#speakerservice), [`ConferenceCategoryService`](#conferencecategoryservice), [`CategoryItemService`](#categoryitemservice), [`QuestionService`](#questionservice), and [`RoomService`](#roomservice). They inherit `GetAllAsync`/`GetPagedAsync`/`GetByIdAsync`/`AddAsync`/`UpdateAsync`/`DeleteAsync` and only *add* the handful of bespoke verbs the conference needs. `EventService` is the canonical example: it layers `PublishAsync`, `UnpublishAsync`, and `RefreshFromSessionizeAsync` onto the inherited CRUD (`MMCA.ADC.Conference.UI/Services/EventService.cs:16`, `:30`, `:44`), each routed through the inherited `SendRequestAsync` helper so a back-end `Result.Failure` is unwrapped into a typed, displayable error via [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper) before `EnsureSuccessStatusCode` can throw something contextless. `[Rubric §3, Clean Architecture]` and `[Rubric §9, API & Contract Design]`: the page binds to a DTO contract ([`EventDTO`](group-17-conference-domain.md#eventdto), [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto)) and an interface, and the wire envelope is the uniform [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) / [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt) the API returns for every entity. Each entity also gets its own per-feature interface, [`IEventUIService`](#ieventuiservice), [`ISessionUIService`](#isessionuiservice), [`ISpeakerUIService`](#ispeakeruiservice), [`IConferenceCategoryUIService`](#iconferencecategoryuiservice), [`ICategoryItemUIService`](#icategoryitemuiservice), [`IQuestionUIService`](#iquestionuiservice), [`IRoomUIService`](#iroomuiservice), which extends the generic contract and declares only the entity's extra verbs.

**The list pages: derive from `DataGridListPageBase<TDto>`, get everything for free.** Every list screen, organizer [`EventList`](#eventlist), [`SessionList`](#sessionlist), [`SpeakerList`](#speakerlist), [`ConferenceCategoryList`](#conferencecategorylist), [`QuestionList`](#questionlist), [`RoomList`](#roomlist), and the public [`PublicEventList`](#publiceventlist) / [`PublicSessionList`](#publicsessionlist) / [`PublicSpeakerList`](#publicspeakerlist), inherits [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto). That base supplies server-side paging against `MudDataGrid<T>`, cancellation lifecycle, loading and load-failed state, filter/sort extraction from MudBlazor's `GridState<T>`, `ISnackbar` error surfacing, saved page/rows-per-page/scroll restoration, and viewport-driven mobile rendering that swaps the grid for a [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem). A concrete page therefore reduces to overriding `Title`, `GridRef`, `SaveFilters`/`RestoreFilters`, and a `LoadServerData` delegate that calls its service's `GetPagedAsync` and folds in page-specific filters: `MMCA.ADC.Conference.UI/Pages/Event/EventList.razor.cs:48` is the roughly ten-line canonical example, with the mobile path reusing the same service call through `FetchMobilePage` (`EventList.razor.cs:60`) and delete-with-confirmation delegated to the shared [`ListPageActions`](group-24-identity-module.md#listpageactions) helper (`EventList.razor.cs:71`). `[Rubric §23, Front-End Performance & Rendering]` (avoiding redundant fetches and round-trips) and `[Rubric §19, State Management & Data Flow]` (paging, sort, and filter state persisted across navigation). This is the "compose, don't repeat" thesis of [G15](group-15-common-ui-framework.md) made concrete across nine list pages.

**Container and presentational split.** The behaviour-heavy screens no longer keep everything in one code-behind: the page stays the *container* (data fetching, filter and paging state, service calls) and hands rendering to *presentational* children that receive parameters and raise callbacks. [`PublicSessionList`](#publicsessionlist) is the fullest example, splitting into [`PublicSessionListFilterBar`](#publicsessionlistfilterbar) (organizer event picker or locked chip, debounced search, All Sessions / My Schedule toggle, share action, `MMCA.ADC.Conference.UI/Pages/Public/PublicSessionListFilterBar.razor.cs:15`) and [`PublicSessionListView`](#publicsessionlistview) (the mobile card list and the desktop grid plus the inline bookmark stars, `PublicSessionListView.razor.cs:21`). The view exposes `Grid` and `ReloadAsync` back to the page (`PublicSessionListView.razor.cs:83`, `:86`) so the base class's grid plumbing keeps working unchanged, and it patches the container-owned bookmark dictionary in place when a star is toggled (`PublicSessionListView.razor.cs:132`, `:147`). The same split shows up on the speaker detail page via [`SpeakerCategoryItemsPanel`](#speakercategoryitemspanel) (`MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerCategoryItemsPanel.razor.cs:16`, raising `Changed` so the page reloads the speaker) and on the selection dashboard via [`SessionSelectionSpeakerOverlap`](#sessionselectionspeakeroverlap) and [`SessionSelectionAiScores`](#sessionselectionaiscores). The pure display and filter-matching rules those children share (locality-tier detection, status and score chip colors, score-tier and status predicates) live in the static [`SessionSelectionDisplay`](#sessionselectiondisplay) (`MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionDisplay.cs:11`), testable without rendering anything. `[Rubric §18, UI Architecture]` and `[Rubric §28, Front-End Testing]`.

**Child-and-join entities: a thin POST/DELETE base.** Sessions, speakers, and events own *join* relationships (a speaker added to a session, a category item to a speaker) that the generic CRUD base cannot model because the write carries a *parent* id. These get four near-identical services ([`EventSpeakerService`](#eventspeakerservice), [`SessionSpeakerService`](#sessionspeakerservice), [`SessionCategoryItemService`](#sessioncategoryitemservice), [`SpeakerCategoryItemService`](#speakercategoryitemservice)) over the shared, purpose-built [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase), which was **hoisted out of this module into `MMCA.Common.UI`** so every consumer module can reuse it (the note is left in place at `MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:75`). Each Conference join service reduces to supplying its endpoint and adding typed `AddAsync`/`DeleteAsync` wrappers over the base's two verbs (`ChildEntityServices.cs:14`, `:30`, `:46`, `:62`). Their interfaces ([`IEventSpeakerUIService`](#ieventspeakeruiservice), [`ISessionSpeakerUIService`](#isessionspeakeruiservice), [`ISessionCategoryItemUIService`](#isessioncategoryitemuiservice), [`ISpeakerCategoryItemUIService`](#ispeakercategoryitemuiservice)) live together in `MMCA.ADC.Conference.UI/Services/IChildEntityUIService.cs`. Note the hard-won detail: the add payload always names the parent explicitly (`new { EventId = eventId, SpeakerId = speakerId }`, `ChildEntityServices.cs:19`), because a controller that binds a `parentId` from the query string will 404 a remove that sends only the child id. `[Rubric §24, Forms, Validation & UX Safety]`.

**Display-enrichment lookups: the GetAll-vs-GetById populator gap, worked around in the UI.** Because the API's list endpoints do not always populate every cross-entity navigation, several pages need a cheap id-to-name map to render speaker names beside a session or an event name beside a room. Three lookup services fill that role, [`SpeakerLookupService`](#speakerlookupservice), [`EventLookupService`](#eventlookupservice), and [`CategoryItemLookupService`](#categoryitemlookupservice) (behind [`ISpeakerLookupService`](#ispeakerlookupservice), [`IEventLookupService`](#ieventlookupservice), [`ICategoryItemLookupService`](#icategoryitemlookupservice)). Each does one large `pageSize=10000` fetch and folds the result into a `Dictionary` of lightweight projection records, [`SpeakerInfo`](#speakerinfo), [`EventInfo`](#eventinfo), [`CategoryItemInfo`](#categoryiteminfo) (`MMCA.ADC.Conference.UI/Services/SpeakerLookupService.cs:19`, `MMCA.ADC.Conference.UI/Services/EventLookupService.cs:20`, `MMCA.ADC.Conference.UI/Services/CategoryItemLookupService.cs:33`); the category-item lookup makes a second, unpaged call first so each item can carry its owning category's title (`CategoryItemLookupService.cs:19`, `:41`). `PublicSessionList` fetches the speaker lookup once while resolving its event filter (`MMCA.ADC.Conference.UI/Pages/Public/PublicSessionList.razor.cs:170`) and the view joins each session's `SessionSpeakers` against it to display names (`PublicSessionListView.razor.cs:153`). This is a deliberate client-side join over the [navigation-populator](group-11-navigation-populators.md) (ADR-002) gap between the API's list and by-id read shapes.

**Three feature areas that go beyond CRUD.** First, the **speaker self-service dashboard**: [`SpeakerDashboard`](#speakerdashboard) is gated on the `speaker_id` JWT claim (read from `AuthenticationStateProvider` and parsed as a `Guid`, `MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerDashboard.razor.cs:70`) and shows the linked speaker's sessions for the current or next event, per-session bookmark counts, and feedback, with inline profile editing (BR-214). It leans on [`SpeakerDashboardService`](#speakerdashboardservice) (behind [`ISpeakerDashboardUIService`](#ispeakerdashboarduiservice)), whose session read appends a per-call cache-bust query parameter so it is a guaranteed miss against the shared sessions output cache and a just-made speaker assignment shows immediately (`MMCA.ADC.Conference.UI/Services/SpeakerDashboardService.cs:31`), and whose bookmark counts come back from one batched endpoint rather than one cross-service hop per session (`SpeakerDashboardService.cs:63`). It derives from Common's [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) so its calls carry the bearer token and the shared retry policy. Second, **organizer feedback moderation** (BR-53): [`OrganizerEventFeedback`](#organizereventfeedback) / [`OrganizerSessionFeedback`](#organizersessionfeedback) let organizers review and delete answers via [`OrganizerEventFeedbackService`](#organizereventfeedbackservice) / [`OrganizerSessionFeedbackService`](#organizersessionfeedbackservice) (interfaces [`IOrganizerEventFeedbackUIService`](#iorganizereventfeedbackuiservice) / [`IOrganizerSessionFeedbackUIService`](#iorganizersessionfeedbackuiservice)); organizers get the unscoped server-side view, and each delete passes the parent id explicitly on the query string to satisfy the controller's binding (`MMCA.ADC.Conference.UI/Services/OrganizerFeedbackService.cs:48`, `:95`), unwrapping domain failures through `ServiceExceptionHelper` before throwing (`OrganizerFeedbackService.cs:53`, `:100`). `[Rubric §11, Security]`: the scoping is server-side, not a client-side hide.

**Session-selection decision support, the asynchronous edge.** The most behaviour-rich page is the organizer-only [`SessionSelectionDashboard`](#sessionselectiondashboard), which renders category distribution, speaker overlap, locality breakdown, and AI content-similarity scoring over an event's session pool via [`SessionSelectionService`](#sessionselectionservice) (behind [`ISessionSelectionUIService`](#isessionselectionuiservice)). It defaults the event picker to the live-or-next event through the shared [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector) (`MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionDashboard.razor.cs:71`) and derives its five filter option lists from the returned [`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto) itself (`SessionSelectionDashboard.razor.cs:161`). `GetDashboardAsync` reads that DTO through the inherited `RetryPolicy` (`MMCA.ADC.Conference.UI/Services/SessionSelectionService.cs:23`); `ScoreSessionsAsync` POSTs to the scoring endpoint and **handles `202 Accepted` explicitly**: because AI scoring of every eligible session can take minutes, the API runs the [`ScoreEventSessionsCommand`](group-18-conference-application.md#scoreeventsessionscommand) in a background scope and returns `202` immediately, so the UI service maps that to a sentinel [`ScoreEventSessionsResultDTO`](group-17-conference-domain.md#scoreeventsessionsresultdto) with `SessionsScored = -1` to signal "started in background" rather than a completed count (`SessionSelectionService.cs:42`). The page then starts a fire-and-forget poll loop on an 8-second cadence (`SessionSelectionDashboard.razor.cs:242`, `:258`), and the decision logic for that loop is factored out into the pure state machine [`ScorePollTracker`](#scorepolltracker), which turns each observation into a [`ScorePollSignal`](#scorepollsignal): keep polling, apply-and-continue, all sessions scored, counts stable long enough, or no scores at all within the zero-progress budget (`MMCA.ADC.Conference.UI/Pages/SessionSelection/ScorePollTracker.cs:74`). Its budgets are explicit constants: 225 polls (a 30-minute cap, `ScorePollTracker.cs:34`), 5 consecutive fetch failures (`ScorePollTracker.cs:41`), 10 zero-progress polls (`ScorePollTracker.cs:48`), and 3 stable polls before completion (`ScorePollTracker.cs:51`). `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §29, Resilience]`: the fire-and-forget contract is honoured on both sides, transient poll failures are absorbed rather than wedging the Score button, and the dashboard read goes through the retry policy so a blip self-heals.

**Public vs authenticated rendering, and the device-capability path.** A recurring `[Rubric §11, Security]` pattern: the same conference entity is exposed through *two* page families. The public family ([`PublicEventList`](#publiceventlist)/[`PublicEventDetail`](#publiceventdetail), [`PublicSessionList`](#publicsessionlist)/[`PublicSessionDetail`](#publicsessiondetail), [`PublicSpeakerList`](#publicspeakerlist)/[`PublicSpeakerDetail`](#publicspeakerdetail)) is anonymous-readable and output-cached at the API; the organizer family exposes edit controls behind role gating. `PublicSessionList` shows the nuance well. It is read-only for anonymous users (BR-43), but an authenticated user gets inline bookmark stars and a My Schedule toggle wired through the *optional* [`ISessionBookmarkUIService`](group-22-engagement-module.md#isessionbookmarkuiservice); because Blazor's `[Inject]` has no optional mode (an unregistered service throws at render), the page declares that dependency as a nullable property and resolves it via `IServiceProvider.GetService` (`PublicSessionList.razor.cs:38`, resolved at `:114`), so it stays null when the Engagement module is disabled. `[Rubric §7, Microservices Readiness]`. Non-organizers are always locked server-side to the computed current or next event via [`CurrentEventDefaults`](group-17-conference-domain.md#currenteventdefaults), so a shared organizer URL cannot pin an attendee to a different or unpublished event (`PublicSessionList.razor.cs:186`, `:193`). My Schedule is a true server-side paged fetch, scoping the query with an `Id IN (...)` filter over the bookmarked ids rather than over-fetching and filtering in memory (`PublicSessionList.razor.cs:296`). The page also participates in the device-capability layer ([G26](group-26-device-capability-layer.md), ADR-042): the last successful first page is written to [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore) as a `CachedSessionPage` record and replayed when [`IConnectivityStatusService`](group-26-device-capability-layer.md#iconnectivitystatusservice) reports offline (`PublicSessionList.razor.cs:316`, `:325`, record at `:342`), the star toggle fires [`IHapticFeedbackService`](group-26-device-capability-layer.md#ihapticfeedbackservice) (`PublicSessionListView.razor.cs:105`), the filter bar shares a schedule screenshot through [`IScreenshotService`](group-26-device-capability-layer.md#iscreenshotservice) and [`IShareService`](group-26-device-capability-layer.md#ishareservice) (`PublicSessionListFilterBar.razor.cs:50`), and `/conference/sessions?mine=true` is a deep link the MAUI head's home-screen quick action targets (`PublicSessionList.razor.cs:65`). Each of those is a no-op on the web heads, so one page serves both worlds. `[Rubric §29, Resilience]` and `[Rubric §22, Responsive & Cross-Browser/Device]`.

**The landing page.** [`ADCHome`](#adchome) is the conference front door, shared by the Web and MAUI heads with only the static-asset base path differing per head (`MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:27`). It fetches the events list through the named `"APIClient"` and features the live-or-next published event via `CurrentEventSelector` (`ADCHome.razor.cs:144`, `:148`), deserializing into two private API models, [`ADCCollectionResult`](#adccollectionresult) and [`ADCEventInfo`](#adceventinfo) (`ADCHome.razor.cs:218`, `:220`). Two rendering decisions are worth internalizing. First, during SSR prerender it skips the backend fetch and the timer entirely and renders the static fallback, because an untimed server-side call to a cold backend would block the prerender and therefore the post-login navigation (`ADCHome.razor.cs:85`). Second, the per-second countdown ticking lives in a child component behind a render fence, so this page arms only a single one-shot `Timer` for the Live-to-Ended flip (`ADCHome.razor.cs:111`), classifying the moment into the [`EventPhase`](#eventphase) enum Upcoming/Live/Ended from the event's own time zone (`ADCHome.razor.cs:170`). `[Rubric §23, Front-End Performance & Rendering]`. The editorial content it renders (keynote, track catalog, sponsor tiers) is held as static records, [`KeynoteSpeakerInfo`](#keynotespeakerinfo), [`ConferenceTrackInfo`](#conferencetrackinfo), [`SponsorTierInfo`](#sponsortierinfo), and [`SponsorInfo`](#sponsorinfo) (`ADCHome.razor.cs:326` to `:329`), with the surrounding chrome, including the pluralized per-tier sponsor heading, resolved through resources (`ADCHome.razor.cs:313`).

**Routes and navigation.** All paths are centralized in [`ConferenceRoutePaths`](#conferenceroutepaths), a static catalogue of literal routes and id-parameterized builder methods (`EventDetails(id)`, `PublicSessionDetails(id)`, `EventFeedbackOrganizer(id)`, and so on) typed against the module's identifier aliases and formatted culture-invariantly; pages navigate with `NavigationManager.NavigateTo(ConferenceRoutePaths.EventDetails(id))` rather than hand-building URL strings, so a route change happens in one file (`MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:10` to `:50`). `[Rubric §25, Navigation, Routing & Information Architecture]`. Public share links are built through the injectable [`IPublicLinkBuilder`](#ipubliclinkbuilder), whose default [`NavigationPublicLinkBuilder`](#navigationpubliclinkbuilder) resolves against the browser origin (`MMCA.ADC.Conference.UI/Services/NavigationPublicLinkBuilder.cs:19`), with the MAUI head overriding the registration after module registration so shared links always point at the web app (`MMCA.ADC.Conference.UI/DependencyInjection.cs:49`). User-facing strings are **not** inline English: every page resolves its labels and snackbar messages through an injected `IStringLocalizer` (the `L["..."]` calls in each code-behind, for example the title in `MMCA.ADC.Conference.UI/Pages/Event/EventList.razor.cs:18` and the delete toast at `EventList.razor.cs:77`, or the breadcrumbs in `SpeakerDashboard.razor.cs:55`) over co-located `.resx` resources. Where a string is deliberately left untranslated (the conference brand name, a postal address, the English-only editorial content on the landing page) the code carries an explicit `// i18n: allow` marker with a reason (`ADCHome.razor.cs:48`, `:52`, `:231`). `[Rubric §27, Internationalization & Localization]` assesses externalized strings and culture-aware formatting; this area embodies it under ADR-027, which superseded the single-locale ADR-011 (primer §6).

**How it all plugs into the shell.** Two registration types wire the area in. [`ConferenceUIModule`](#conferenceuimodule) implements Common's [`IUIModule`](group-15-common-ui-framework.md#iuimodule) (the front-end counterpart of the [`IModule`](group-14-module-system-composition.md#imodule) back-end contract): it declares the module's eleven [`NavItem`](group-15-common-ui-framework.md#navitem) entries, whose labels are ADR-027 resource *keys* (`Nav.Events`, `Nav.Dashboard`, and so on) each carrying a `TitleResource` so the shared NavMenu localizes them at render time against the co-located `ConferenceUIModule.resx` pair (`MMCA.ADC.Conference.UI/ConferenceUIModule.cs:18` to `:36`): three public entries for everyone, a `speaker_id`-claim-gated Dashboard in the user section (`ConferenceUIModule.cs:26`), and an `Organizer`-role-gated admin group of seven (Events, Sessions, Speakers, Categories, Questions, Rooms, Session Selection, `ConferenceUIModule.cs:29` to `:35`), and it exposes its assembly so the host can discover the Razor routes (`ConferenceUIModule.cs:38`). The companion [`DependencyInjection`](#dependencyinjection) extension `AddConferenceUI()` (a C# `extension(IServiceCollection)` member, primer §4) is the one call a host makes: it Scrutor-scans the assembly to register every `IEntityService<,>` implementation as scoped (`DependencyInjection.cs:22`), then explicitly registers the four child-entity services, the speaker dashboard, the two organizer feedback services, session selection, the three lookup services, and the public-link builder, and finally registers `ConferenceUIModule` as a singleton `IUIModule` so the shell folds its nav items and routes in with no edit to the shell itself (`DependencyInjection.cs:29` to `:55`). `[Rubric §1, SOLID]` (Open/Closed) and `[Rubric §18, UI Architecture]`. Read the per-type sections that follow for the mechanics of each page and service; the bUnit and Playwright tests that exercise this library live in the testing chapter ([G27](group-27-testing-infrastructure.md)).

### ADCEventInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:220` · Level 0 · record (sealed, private)

- **What it is**: the deserialization-only projection of one published event as the landing page needs it. It is declared `private sealed record` inside [ADCHome](#adchome) (`:220`), so it is not a shared contract: it exists purely to give `System.Text.Json` a shape to bind the `events` response into.
- **Depends on**: no first-party types. BCL only (`DateOnly` for the two dates).
- **Concept introduced: the page-local wire model.** [Rubric §9, API & Contract Design] assesses whether consumers bind to explicit, minimal contracts rather than reaching for the server's internal types. The landing page needs eight fields (`Id`, `Name`, `Description?`, `StartDate`, `EndDate`, `TimeZone`, `VenueAddress?`, `VenueMapUrl?`, `:221-228`) out of the much larger `EventDTO` the API serves, so it declares exactly those and lets the serializer ignore the rest. Because the record is private to the component, no other page can accidentally couple to it; a second consumer would declare its own projection. Note that every optional field is nullable (`Description`, `VenueAddress`, `VenueMapUrl`), which is what lets the page fall back to its hard-coded defaults without null checks scattered through the markup.
- **Walkthrough**: a positional record with no methods. `Name` feeds the `EventName` property and therefore `HeroTitleParts()` (`:48`, `:62`); `Description` feeds `EventDescription`, falling back to the localized `Fallback.EventDescription` resource (`:50`); `StartDate`/`EndDate`/`TimeZone` are the three inputs `UpdateCountdown()` converts into the UTC live window (`:172-182`); `VenueAddress` backs the venue block and the Google Maps search URL (`:52-55`).
- **Why it's built this way**: the page must render before, during, and after the API call, so it stores a single nullable `ADCEventInfo? _event` (`:37`) and every derived property is written as `_event?.X ?? <default>`. One nullable field is the whole "loaded or not" state machine, with no extra flags.
- **Where it's used**: the `Items` list of [ADCCollectionResult](#adccollectionresult) (`:218`), selected by `CurrentEventSelector.SelectCurrentOrNext` in `LoadEventAsync` (`:148`), and read by every derived display property on [ADCHome](#adchome).

### ConferenceRoutePaths
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI` · `MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:8` · Level 0 · class (static)

- **What it is**: one static class holding every Conference UI route, as `public static readonly string` constants for fixed paths and small factory methods for id-bearing paths. It covers both the organizer-management routes and the public attendee routes, so no `@page` directive or `NavigateTo` call has to hard-code a URL.
- **Depends on**: no first-party types. It uses the module's identifier aliases (`EventIdentifierType`, `SessionIdentifierType`, `SpeakerIdentifierType`, `ConferenceCategoryIdentifierType`, `QuestionIdentifierType`, `RoomIdentifierType`) that the Conference Shared project declares as `global using` (primer §2), plus `System.Globalization.CultureInfo` (`:1`).
- **Concept introduced: a centralized navigation vocabulary.** [Rubric §25, Navigation, Routing & Information Architecture] assesses whether routes form a coherent, role-aware information architecture instead of scattered magic strings; this class is that story in miniature. The paths split into two deliberate namespaces mirroring the module's two audiences: organizers work under bare prefixes (`/events` `:10`, `/sessions` `:14`, `/speakers` `:18`, `/conferencecategories` `:22`, `/questions` `:26`, `/rooms` `:30`) while attendees work under a `/conference/...` prefix (`PublicSessions` `:35`, `PublicEvents` `:36`, `PublicSpeakers` `:39`). Detail routes are methods rather than constants because they interpolate a typed id: `EventDetails(EventIdentifierType id)` (`:12`) builds `/events/{id}` with `string.Create(CultureInfo.InvariantCulture, ...)` so an integer id can never be formatted with a culture-specific group separator. [Rubric §27, Internationalization] shows up here as the negative case: URLs are the one place culture-aware formatting must be suppressed.
- **Walkthrough**: the file is a flat list grouped by entity, each group contributing a list route, a create route, and a details factory: events (`:10-12`), sessions (`:14-16`), speakers (`:18-20`), conference categories (`:22-24`), questions (`:26-28`), rooms (`:30-32`). The public attendee block follows (`:35-40`), then three routes that sit outside the entity families: the claim-gated `SpeakerDashboard` (`:43`), the two organizer feedback factories `EventFeedbackOrganizer` / `SessionFeedbackOrganizer` that nest feedback under the parent entity (`:46-47`), and `SessionSelectionDashboard` (`:50`). Two factories differ from the rest: `SpeakerDetails` (`:20`) and `PublicSpeakerDetails` (`:40`) use plain interpolation rather than `string.Create(CultureInfo.InvariantCulture, ...)`, because `SpeakerIdentifierType` is a `Guid` whose `ToString()` is already culture-invariant.
- **Why it's built this way**: if the admin prefix ever moves (say `/events` becomes `/admin/events`), editing the one constant propagates the change to every navigation call, with no grep-and-replace and no risk of a stale link. Keeping the parameterized routes as methods typed against the identifier aliases means a wrong-entity id is a compile error, not a 404.
- **Where it's used**: every Conference UI Blazor page's `@page` directive and `NavigationManager.NavigateTo` call, and the `NavItems` collection in [ConferenceUIModule](#conferenceuimodule), which reads `PublicEvents`, `PublicSessions`, `PublicSpeakers`, `SpeakerDashboard`, the six admin list routes, and `SessionSelectionDashboard` (`ConferenceUIModule.cs:21-35`).

### ConferenceTrackInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:327` · Level 0 · record (sealed, private)

- **What it is**: one row of the landing page's track catalogue: a track `Name`, an `Icon` (a MudBlazor icon path constant), and a `Topics` string listing the track's subject areas.
- **Depends on**: no first-party types. The `Icon` values are MudBlazor `Icons.Material.Filled.*` constants (external).
- **Concept introduced**: this is the second of the four static-content records on the landing page; the pattern is introduced under [KeynoteSpeakerInfo](#keynotespeakerinfo).
- **Walkthrough**: a three-property positional record (`:327`). The whole catalogue is a `private static readonly ConferenceTrackInfo[] Tracks` initialized inline with twelve entries (`:245-271`), from "AI Applications and Intelligent Systems" through "Cloud and AI Foundations". Storing the icon as a `string` (rather than a `RenderFragment` or an enum) is what keeps the record a plain data type: the markup passes it straight to `<MudIcon Icon="@track.Icon">`.
- **Why it's built this way**: the track list changes once per conference cycle and is editorial rather than transactional, so it lives in the assembly instead of behind an API call or a CMS. The array is `static readonly`, so it is allocated once per process, not per render.
- **Where it's used**: the `Tracks` array on [ADCHome](#adchome) (`:245`), rendered as the track grid in `ADCHome.razor`.

### EventPhase
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:41` · Level 0 · enum (private)

- **What it is**: the three-state classification of the featured event relative to now: `Upcoming`, `Live`, `Ended` (`:41-46`). It is the single switch the landing page's hero renders from.
- **Depends on**: nothing.
- **Concept introduced: deriving a render state from a clock instead of storing it.** [Rubric §19, State Management and Data Flow] assesses whether UI state is derived from a single source of truth or duplicated into flags. There is no `IsLive` boolean anywhere on the page: `UpdateCountdown()` recomputes `_phase` from `DateTime.UtcNow` against the converted UTC window every time it runs (`:191-196`), and the markup branches on that one field. Recomputing rather than storing means a stale phase is impossible after a timer callback, a parameter change, or the interactive render pass that follows prerender.
- **Walkthrough**: the assignment is a switch expression over `now` (`:191-196`): `now < _startUtc` gives `Upcoming`, `now < _endUtc` gives `Live`, anything later gives `Ended`. `ArmPhaseTimerForEventEnd()` reads it as its guard, returning immediately unless the phase is `Live` (`:113-116`), which is what makes the Live-to-Ended timer a single one-shot rather than a recurring tick. In the markup, `Upcoming` renders the `HomeCountdown` child, `Live` renders the "event live" chip plus a link to `/happening-now`, and `Ended` renders the post-event chip (`ADCHome.razor:34-56`).
- **Why it's built this way**: three named states read far better at the call site than nested date comparisons, and keeping the enum private to the component signals it is a view concern, not a domain concept. The domain's own notion of a live window lives server-side and in [CurrentEventSelector](group-17-conference-domain.md#currenteventselector).
- **Where it's used**: the `_phase` field on [ADCHome](#adchome) (`:36`) and its Razor markup only.

### KeynoteSpeakerInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:326` · Level 0 · record (sealed, private)

- **What it is**: the keynote block's content: the speaker's `Name`, `Title` (their role), the `TalkTitle`, and `BioParagraphs` as a `string[]`.
- **Depends on**: no first-party types. BCL only.
- **Concept introduced: the two-tier content model of a landing page.** The page splits its content into *dynamic* data fetched from the API (dates, venue, name, via [ADCEventInfo](#adceventinfo)) and *editorial* data compiled into the assembly (keynote, tracks, sponsors, via this record and its three siblings). [Rubric §23, Front-End Performance and Rendering] is the payoff: the keynote, the twelve-track grid, and the sponsor wall render on the first frame with zero network dependency, so a cold or unreachable backend degrades only the countdown, never the page. [Rubric §27, Internationalization] is the deliberate exception: the block carries an explicit `// i18n: allow` marker with a written reason (`:231-232`) recording that this English-only editorial content is the same copy the API would serve, while the chrome around it is localized. That marker convention is how ADR-027 distinguishes "not yet translated" from "intentionally untranslated".
- **Walkthrough**: a four-property positional record (`:326`). The single instance is a `private static readonly KeynoteSpeakerInfo Keynote` initialized inline (`:233-243`) with a five-paragraph biography. `BioParagraphs` is an array rather than one string so the template can emit each paragraph in its own element instead of relying on whitespace preservation. The keynote portrait is not part of the record: it is composed from the head-specific `ImageBasePath` parameter through `KeynoteImageSrc` (`:30`), because the Web and MAUI heads serve static assets from different roots.
- **Why it's built this way**: the keynote changes once per conference cycle, so a database round-trip and an admin screen would be pure overhead. Keeping it `static readonly` also means it is shared by every circuit on the server head rather than re-allocated per user.
- **Where it's used**: the `Keynote` field on [ADCHome](#adchome) (`:233`), rendered in the keynote section of `ADCHome.razor`.

### SponsorInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:329` · Level 0 · record (sealed, private)

- **What it is**: one sponsor logo entry: `Name`, `LogoUrl` (an absolute URL to the sponsor's logo asset), and `Url` (the sponsor's site).
- **Depends on**: no first-party types. BCL only.
- **Concept introduced**: shares the static-editorial-content pattern taught under [KeynoteSpeakerInfo](#keynotespeakerinfo). Worth noting for [Rubric §15, Best Practices and Code Quality]: the containing `SponsorTiers` array carries an explicit, justified analyzer suppression, `[SuppressMessage("Minor Code Smell", "S1075:URIs should not be hardcoded", ...)]` with the reason "Sponsor logo and link URLs are external constants" (`:273`). Under this workspace's analyzers-as-errors policy a suppression is the only way past S1075, and the convention is that it must carry a written justification rather than a blanket file-level disable.
- **Walkthrough**: a three-property positional record (`:329`). Four instances exist today, three under the Platinum tier (`:278-289`) and one under Swag (`:295-298`); the logos are absolute `https://atlcloudconf.com/assets/img/sponsors/...` URLs, so they are fetched from the existing conference site rather than copied into this repo's static assets.
- **Why it's built this way**: sponsors change annually and the logo assets are already hosted by the conference; pointing at them avoids a duplicate asset pipeline. The tradeoff is a third-party origin in the rendered page, which is a [Rubric §26, Front-End Security] consideration for the host's content-security policy rather than something this record controls.
- **Where it's used**: nested inside [SponsorTierInfo](#sponsortierinfo) instances in the `SponsorTiers` array on [ADCHome](#adchome) (`:274-300`).
- **Caveats / not-in-source**: whether the host's CSP allows the `atlcloudconf.com` image origin is decided by the host's policy provider, not by this file.

### ADCCollectionResult
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:218` · Level 1 · record (sealed, private)

- **What it is**: the one-property envelope the landing page deserializes the `events` response into: `List<ADCEventInfo>? Items` (`:218`). It exists because the API returns a collection *envelope*, not a bare array.
- **Depends on**: [ADCEventInfo](#adceventinfo) (its element type), which is what puts it one level above the plain records.
- **Concept introduced: mirroring only the slice of the envelope you consume.** The API's uniform collection contract is [CollectionResult<T>](group-01-result-error-handling.md#collectionresultt), which carries more than a list. Rather than referencing that type, the page declares a minimal structural twin containing just `Items`, keeping the landing page free of any dependency on the API's shared contract assembly. [Rubric §9, API and Contract Design]: the wire format is honoured, the coupling is not.
- **Walkthrough**: consumed in exactly one place, `LoadEventAsync` (`:144`): `await client.GetFromJsonAsync<ADCCollectionResult>("events", ApiJsonOptions, _cts!.Token)`. The `ApiJsonOptions` field is a `JsonSerializerOptions(JsonSerializerDefaults.Web)` allocated once as `static readonly` (`:17`), which is what makes the camelCase wire names bind to the PascalCase record properties. `Items` is nullable and immediately coalesced to an empty collection at the call site (`result?.Items ?? []`, `:149`), so a null body, a null `Items`, and an empty list all take the same path.
- **Why it's built this way**: `GetFromJsonAsync` returns `null` for an empty response body, so the nullable property plus the coalesce covers both failure shapes without a branch.
- **Where it's used**: [ADCHome](#adchome)`.LoadEventAsync` only (`:144`).

### SponsorTierInfo
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:328` · Level 1 · record (sealed, private)

- **What it is**: one sponsorship tier: its `Name` ("Platinum", "Gold", "Silver", "Swag"), a `Color` hex string for the tier accent, and the `IReadOnlyList<SponsorInfo> Sponsors` in that tier.
- **Depends on**: [SponsorInfo](#sponsorinfo) (its element type).
- **Concept introduced: pluralized, ordered localization of composed content.** The static tier data is English-only editorial content, but its *heading* is localized, and that is more subtle than a resource lookup. `GetTierHeading(SponsorTierInfo tier)` (`:313-324`) picks one of four label resource keys from a tuple switch over `(IsPartnerTier: tier.Name == "Swag", Singular: tier.Sponsors.Count == 1)` (`:315-321`), covering partner-singular, partner-plural, sponsor-singular, and sponsor-plural, then composes the final string through a *format* resource: `L["Sponsors.TierHeadingFormat", L["Sponsors.Tier." + tier.Name], L[labelKey]]` (`:323`). The format resource carries the per-language word order, so "Platinum Sponsors" and "Patrocinadores Platino" both come out right without the C# knowing either language's adjective placement. [Rubric §27, Internationalization and Localization] assesses exactly this: externalized strings plus grammar (order and plurality) owned by the resource, not by string concatenation in code. This follows ADR-027.
- **Walkthrough**: a three-property positional record (`:328`). The `SponsorTiers` array (`:274-300`) declares all four tiers in display order, two of them (`Gold`, `Silver`) with an empty sponsor list (`:291-292`) so the tier still renders its slot. `GetTierIcon(string tierName)` (`:302-309`) maps the tier name to a MudBlazor icon (Diamond, EmojiEvents, MilitaryTech, CardGiftcard) with `Icons.Material.Filled.Star` as the fallback arm.
- **Why it's built this way**: modelling tiers as data rather than as four hard-coded markup blocks means adding a tier is one array entry plus one resource key, and the empty-tier case falls out for free.
- **Where it's used**: the `SponsorTiers` field on [ADCHome](#adchome) (`:274`) and its `GetTierIcon` / `GetTierHeading` helpers, rendered as the sponsor wall in `ADCHome.razor`.

### ConferenceUIModule
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI` · `MMCA.ADC.Conference.UI/ConferenceUIModule.cs:14` · Level 3 · class (sealed)

- **What it is**: the Conference module's UI descriptor. It contributes the navigation items for the whole conference capability (public Events/Sessions/Speakers, the speaker Dashboard, and an organizer admin group covering Events, Sessions, Speakers, Categories, Questions, Rooms, Session Selection) and exposes its assembly so the host can discover the module's routable Blazor components.
- **Depends on**: [IUIModule](group-15-common-ui-framework.md#iuimodule) (the contract it implements), [NavItem](group-15-common-ui-framework.md#navitem) and [NavSection](group-15-common-ui-framework.md#navsection) (the nav vocabulary from `MMCA.Common.UI.Common`), [RoleNames](group-08-auth.md#rolenames) (the `Organizer` role string), [ConferenceRoutePaths](#conferenceroutepaths) (the URLs), plus MudBlazor `Icons` and `System.Reflection.Assembly` (externals) and the co-located `ConferenceUIModule.resx` pair.
- **Concept introduced: the modular-UI descriptor, the front-end analogue of `IModule`.** [Rubric §18, UI Architecture and Component Design] assesses whether UI is composed from cohesive, self-describing modules rather than a hard-coded master shell; a module declaring its own menu is exactly that, and it is the Open/Closed half of [Rubric §1, SOLID]: enabling a module adds its navigation with no edit to the shell. [Rubric §25, Navigation and Information Architecture] is served because the items are role- and claim-aware. [Rubric §11, Security] applies with an important caveat: hiding a nav item is UX only. The services still enforce authorization server-side, so the claim and role here are not the security boundary. Per ADR-027 the `Title` and `Group` strings are resource *keys*, not literals: `TitleResource: typeof(ConferenceUIModule)` on every item tells the shared NavMenu to resolve them against the co-located `.resx` at render time, which the file's own comment records (`:16-17`).
- **Walkthrough**: `NavItems` (`:18-36`) is an `IReadOnlyList<NavItem>` initialized with a collection expression in three tiers. Three public items for everyone, anonymous included, pointing at the `/conference/...` routes (`:21-23`). One claim-gated speaker Dashboard carrying `RequiredClaim: "speaker_id"` and `Section: NavSection.User` (`:26`), so it appears only for a user whose JWT links them to a speaker record. Seven organizer items, each carrying `RoleNames.Organizer`, `Section: NavSection.Admin`, and `Group: "Nav.Group.Conference"` so they fold into one labelled admin group (`:29-35`), ending with the Session Selection entry (`:35`). `Assembly` (`:38`) returns `typeof(ConferenceUIModule).Assembly` so the host's Blazor router can discover this library's routable components. Note that "Events", "Sessions", and "Speakers" each appear twice in the list, once public and once organizer, differing only in route and gating: the same label serves two audiences with two destinations.
- **Why it's built this way**: mirroring the backend `IModule` pattern on the UI side keeps the app extensible (see [group 14](group-14-module-system-composition.md#imodule)). A host that boots without the Conference module simply has no conference nav and no conference routes, with no conditional code anywhere in the shell.
- **Where it's used**: registered as a singleton `IUIModule` by this module's [DependencyInjection](#dependencyinjection) (`DependencyInjection.cs:55`) and aggregated by the shared UI navigation builder in [group 15](group-15-common-ui-framework.md#iuimodule).

### DependencyInjection
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI` · `MMCA.ADC.Conference.UI/DependencyInjection.cs:11` · Level 6 · class (static)

- **What it is**: the Conference UI composition root. Its single `AddConferenceUI()` method is the one call a host makes to register every Conference UI service (the per-entity CRUD services by assembly scan, the child-entity, dashboard, feedback, selection, and lookup services explicitly) plus the module descriptor.
- **Depends on**: Scrutor (the `Scan`/`AddClasses` assembly-scanning API, external NuGet), [IEntityService<TEntityDTO, TIdentifierType>](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype) (the scanned open-generic contract), [IUIModule](group-15-common-ui-framework.md#iuimodule) and [ConferenceUIModule](#conferenceuimodule), and this module's own service contracts including [IEventSpeakerUIService](#ieventspeakeruiservice), [ISessionSpeakerUIService](#isessionspeakeruiservice), [ISessionCategoryItemUIService](#isessioncategoryitemuiservice), [ISpeakerCategoryItemUIService](#ispeakercategoryitemuiservice), [ISpeakerDashboardUIService](#ispeakerdashboarduiservice), [IOrganizerEventFeedbackUIService](#iorganizereventfeedbackuiservice), [IOrganizerSessionFeedbackUIService](#iorganizersessionfeedbackuiservice), [ISessionSelectionUIService](#isessionselectionuiservice), [ISpeakerLookupService](#ispeakerlookupservice), [IEventLookupService](#ieventlookupservice), [ICategoryItemLookupService](#icategoryitemlookupservice), and [IPublicLinkBuilder](#ipubliclinkbuilder) / [NavigationPublicLinkBuilder](#navigationpubliclinkbuilder).
- **Concept introduced: the `extension(IServiceCollection)` registration block, half convention and half explicit.** [Rubric §3, Clean Architecture] and [Rubric §16, Maintainability] both come down to keeping wiring at the edges; this file is the module's one wiring point. It uses the C# preview extension-type syntax `extension(IServiceCollection services)` (`:13`) to hang `AddConferenceUI` (`:19`) off `IServiceCollection`, the same idiom every module's `DependencyInjection` uses (primer §4). The convention half is the Scrutor scan (`:22-26`): `FromAssemblyOf<ConferenceUIModule>()` then `AddClasses(classes => classes.AssignableTo(typeof(IEntityService<,>)))`, registered `AsImplementedInterfaces().WithScopedLifetime()`, so every entity CRUD service in the assembly is discovered by shape and adding a new entity service needs no edit here. Registering `AsImplementedInterfaces` is what makes a page able to inject the narrow per-entity interface rather than the open generic.
- **Walkthrough**: after the scan, the method registers by hand exactly the services the scan cannot see, because they do not implement `IEntityService<,>`. Four child-entity managers for the join relationships (`:29-32`), the speaker dashboard service (`:35`), the two BR-53 organizer-feedback moderation services (`:38-39`), the session-selection decision-support service (`:42`), and three cross-module lookup services (`:45-47`). It then registers [IPublicLinkBuilder](#ipubliclinkbuilder) as [NavigationPublicLinkBuilder](#navigationpubliclinkbuilder) (`:52`), and finally [ConferenceUIModule](#conferenceuimodule) as a singleton `IUIModule` (`:55`) before returning `services` for chaining (`:57`). Every service registration is `AddScoped`; only the descriptor is a singleton, which is correct because it is immutable data.
- **Why it's built this way**: scanning the uniform bulk and spelling out the one-off collaborators keeps registration short without hiding the non-trivial wiring. One such subtlety is documented inline (`:49-51`): the public share-link builder resolves against the browser origin by default, but the MAUI head re-registers `IPublicLinkBuilder` *after* this call so last-registration-wins points shared links at the configured public web URL. That ordering dependency is exactly the kind of thing that belongs in a comment next to the registration.
- **Where it's used**: called once during startup by each UI host (Web and MAUI) when the Conference module is enabled, alongside the other modules' `AddXxxUI()` extensions.

### ADCHome
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Home` · `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:15` · Level 7 · class (sealed partial component)

- **What it is**: the conference landing page: hero with a live countdown, keynote, track catalogue, sponsor wall, and venue block. It fetches the published events list to find which event to feature, classifies that event as Upcoming/Live/Ended, and renders the rest from compiled-in editorial content. It is shared verbatim by the Web and MAUI heads: each head's `ADCHomePageContent` resolves it as the home shell's component type and only the static-asset base path differs (`:9-14`).
- **Depends on**: [ADCCollectionResult](#adccollectionresult) and [ADCEventInfo](#adceventinfo) (the API models), [EventPhase](#eventphase), [KeynoteSpeakerInfo](#keynotespeakerinfo), [ConferenceTrackInfo](#conferencetrackinfo), [SponsorTierInfo](#sponsortierinfo), [SponsorInfo](#sponsorinfo) (the content records, all private inner types of this class), and [CurrentEventSelector](group-17-conference-domain.md#currenteventselector) from `MMCA.ADC.Conference.Shared.Events` (`:4`). Externals: `IHttpClientFactory` and `GetFromJsonAsync` (`:1`, `:21`), `IStringLocalizer<ADCHome>` injected in the markup as `L` (`ADCHome.razor:1`), `System.Threading.Timer`, `TimeZoneInfo`, MudBlazor, and the Blazor `RendererInfo` API. It composes one first-party child component, `HomeCountdown` (`ADCHome.razor:40`), which lives in the same folder and has no code-behind of its own.
- **Concept introduced: rendering correctly across the prerender and interactive passes.** [Rubric §23, Front-End Performance and Rendering] assesses whether a page avoids wasted renders and blocking work; this component is the chapter's clearest case study, and both of its decisions were learned the hard way, as the code comments record.
  - **Skip the fetch during prerender.** `OnInitializedAsync` checks `RendererInfo.IsInteractive` and, when false, sets `_isLoading = false`, computes the countdown from defaults, and returns without touching the network (`:85-90`). The comment (`:80-84`) states why: an untimed server-side call to a cold or unreachable backend would block the prerender, and therefore the page load *and* the post-login `NavigateTo("/")`, indefinitely. The static fallback renders immediately and the interactive pass loads the real event. [Rubric §29, Resilience] is the same point from the availability angle.
  - **Fence the per-second re-render.** The ticking digits live in the `HomeCountdown` child, which owns its own timer, so this page arms only a *single one-shot* `Timer` for the Live-to-Ended flip (`:111-126`). The comment at `:107-109` records the prior behaviour: a 1-second timer that re-rendered the entire landing page, the largest static page in the app, for the whole event, per circuit, just to catch one transition.
  Two more rubric threads run through it. [Rubric §22, Responsive and Cross-Browser/Device]: one component compiles into the Blazor Server, WebAssembly, and MAUI heads, with the per-head difference reduced to the `ImageBasePath` parameter (`:27-28`, consumed at `:30`). [Rubric §27, Internationalization]: user-facing chrome resolves through `L[...]`, while three strings carry explicit `// i18n: allow` markers with reasons (the brand name `:48`, the postal address `:52`, the editorial content block `:231-232`).
- **Walkthrough**, in lifecycle order:
  - **State** (`:32-39`): a `CancellationTokenSource`, the one-shot `_phaseTimer`, the computed `_startUtc`/`_endUtc`, `_phase`, the nullable `_event`, `_isLoading` (starting `true`), and a `_disposed` guard the timer callback checks.
  - **Derived display properties** (`:48-55`): `EventName`, `EventDescription`, `VenueAddress`, and `MapSearchUrl` are each `_event?.X ?? <fallback>`, so the page is fully renderable before and without a successful fetch. `MapSearchUrl` builds a Google Maps search URL with `Uri.EscapeDataString` over the address (`:54-55`).
  - **`HeroTitleParts()`** (`:62-74`): splits the event name so the hero can accent the keyword between "Atlanta " and " Conference" (in "2026 Atlanta Developers Conference" it accents "Developers"). It uses `IndexOf`/`LastIndexOf` with `StringComparison.Ordinal` and falls back to rendering the whole name plain when the name does not match the brand shape, which is why an arbitrary event name never renders broken markup.
  - **`OnInitializedAsync`** (`:76-97`): creates the CTS, takes the prerender short-circuit described above, otherwise awaits `LoadEventAsync()` and arms the phase timer.
  - **`LoadEventAsync`** (`:139-168`): creates the named `"APIClient"` from `IHttpClientFactory` (`:143`), deserializes into [ADCCollectionResult](#adccollectionresult) under the cancellation token (`:144`), and picks the event with `CurrentEventSelector.SelectCurrentOrNext(...)` passing four accessor lambdas plus `DateTime.UtcNow` (`:148-153`). The comment at `:146-147` is the reason it is not a `FirstOrDefault`: the anonymous endpoint returns published events unordered, so a naive first-item pick would pin the oldest seeded event. Two catch arms are deliberately silent: `OperationCanceledException` means the component was disposed mid-load (`:155`), `HttpRequestException` means the API is unavailable and the fallback content stands (`:159`). The `finally` block always clears `_isLoading` and recomputes the countdown (`:164-167`), so no failure path leaves a spinner on screen.
  - **`UpdateCountdown`** (`:170-197`): converts the event's local start and end into UTC using `TimeZoneInfo.FindSystemTimeZoneById(timeZoneId)` with `"America/New_York"` as the default (`:176-182`), treating the local values as UTC when the zone id is unknown (`:184-188`), then assigns `_phase` from the switch described under [EventPhase](#eventphase).
  - **Phase timing** (`:99-137`): `OnCountdownElapsedAsync` is the `EventCallback` the `HomeCountdown` child raises at zero, which recomputes the phase, re-arms, and calls `InvokeAsync(StateHasChanged)` (`:100-105`). `ArmPhaseTimerForEventEnd` returns unless the phase is `Live` and the remaining time is positive, then disposes any prior timer and schedules one callback at `untilEnd` with `Timeout.InfiniteTimeSpan` as the period, meaning fire once and never repeat (`:111-126`). `OnEventEnded` checks `_disposed` before re-rendering (`:128-137`).
  - **`FormatEventDate`** (`:199-206`): formats the date with a pattern read from a *resource* (`L["Hero.DateFormat"]`) against `CultureInfo.CurrentCulture`, so both the layout and the month names follow the selected language (ADR-027).
  - **`Dispose`** (`:208-215`): sets `_disposed`, cancels and disposes the CTS, and both stops (`Change(-1, -1)`) and disposes the phase timer. Stopping before disposing is what prevents a callback already in flight from touching a torn-down component.
- **Why it's built this way**: the landing page is the app's most-hit surface and the post-login destination, so its correctness budget is dominated by two failure modes that have nothing to do with its content: a slow backend blocking the prerender, and a per-second render loop multiplied by every connected circuit. Both are solved structurally (skip the fetch, fence the tick) rather than by tuning, and the fallback content path means the page is never blank.
- **Where it's used**: resolved as the home component by `ADCHomePageContent` in both `MMCA.ADC.UI` (`Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHomePageContent.cs:10`, with the MAUI head passing `ImageBasePath="_content/MMCA.Common.UI/images"` at `Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHome.razor:5`) and `MMCA.ADC.UI.Web.Client` (`Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:13`), which takes the default `"images"` base path.
- **Caveats / not-in-source**: the page's own countdown window is not identical to the selector's. `UpdateCountdown` starts the event at `EventStartTime = 08:00` local (`:18`, `:174`), while [CurrentEventSelector](group-17-conference-domain.md#currenteventselector)`.GetLiveWindowUtc` starts it at midnight (`MMCA.ADC.Conference.Shared/Events/CurrentEventSelector.cs:69`). Both end at midnight after the last day. So between midnight and 08:00 on day one, the selector already treats the event as live while the hero still shows a countdown. Whether that is intended is not determinable from source. Also note the two hard-coded fallbacks used when no event loads: the date `2026-10-17` (`:172`, `:201`) and the venue address (`:52`).

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

### ICategoryItemUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ICategoryItemUIService.cs:9` · Level 3 · interface

- **What it is**: the UI-service contract for the `categoryitems` REST resource. It is an empty
  marker interface, `public interface ICategoryItemUIService : IEntityService<CategoryItemDTO, CategoryItemIdentifierType>`
  (`ICategoryItemUIService.cs:9`), that adds no members of its own.
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  (the shared CRUD contract, Level 2) and [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto)
  (the transported shape, Level 1). `CategoryItemIdentifierType` is the module id alias.
- **Concept introduced, the per-entity marker UI-service interface.** `[Rubric §18, UI Architecture]`
  (assesses whether the front end talks to a typed service abstraction rather than raw
  `HttpClient`; here every Blazor page injects an *interface*, never the concrete HTTP class).
  `[Rubric §1, SOLID]` (the marker gives each aggregate its own injection point so a page depends only on the
  contract it needs, even though the shape is inherited). The generic CRUD surface (`GetPagedAsync`,
  `GetByIdAsync`, `CreateAsync`, `UpdateAsync`, `DeleteAsync`) all comes from
  [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype);
  see that type for the mechanism. The point of a body-less specialization is a distinct, injectable
  type so DI can bind one implementation per aggregate.
- **Walkthrough**: no members. The whole contract is "be an `IEntityService` bound to
  `CategoryItemDTO` + `CategoryItemIdentifierType`, under a name pages can inject". The doc comment
  (`ICategoryItemUIService.cs:6-8`) states plainly that it "uses generic CRUD".
- **Why it's built this way**: a named per-entity interface (rather than injecting the open generic
  directly) keeps DI registration unambiguous and lets a specific entity later grow an extra method
  without disturbing the others (exactly what [`IEventUIService`](#ieventuiservice),
  [`IRoomUIService`](#iroomuiservice), and [`ISpeakerUIService`](#ispeakeruiservice) did).
- **Where it's used**: implemented by [`CategoryItemService`](#categoryitemservice) (Level 4);
  injected into the Conference category-item Blazor pages (list/detail/create/edit).

### IConferenceCategoryUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IConferenceCategoryUIService.cs:9` · Level 3 · interface

- **What it is**: the UI-service contract for the `conferencecategories` REST resource, an empty
  marker over [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto)
  (`IConferenceCategoryUIService.cs:9`).
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  and [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto).
- **Concept**: identical shape to [`ICategoryItemUIService`](#icategoryitemuiservice); see it for the
  marker-interface rationale. `[Rubric §18, UI Architecture]` and `[Rubric §16, Maintainability]`
  (a new aggregate resource costs one empty interface plus one thin class).
- **Walkthrough**: no members (doc comment `IConferenceCategoryUIService.cs:6-8`).
- **Where it's used**: implemented by [`ConferenceCategoryService`](#conferencecategoryservice);
  injected into the conference-category Blazor pages.

### IEventUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IEventUIService.cs:10` · Level 3 · interface

- **What it is**: the UI-service contract for the `events` resource. Unlike the plain CRUD markers, it
  *extends* the generic surface with three event-specific operations: publish, unpublish, and a
  Sessionize refresh (`IEventUIService.cs:10-17`).
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [`EventDTO`](group-17-conference-domain.md#eventdto), and
  [`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto)
  (the refresh outcome, Level 0). BCL `Task`/`CancellationToken`.
- **Concept introduced, extending the generic UI service with resource-specific verbs.**
  `[Rubric §9, API & Contract Design]` (assesses whether non-CRUD state transitions get first-class,
  intention-revealing operations instead of being forced through a generic update). Publish and
  unpublish are lifecycle transitions on an event, and refresh triggers an external Sessionize sync,
  none of which is a CRUD `Update`, so they earn their own methods that map to dedicated WebAPI
  endpoints (the doc comment, `IEventUIService.cs:6-9`, says exactly this). `[Rubric §18, UI
  Architecture]`: the Blazor event pages inject this interface and call `PublishAsync` /
  `RefreshFromSessionizeAsync` directly, keeping the HTTP shape out of the component.
- **Walkthrough**: three declared members, each taking `EventIdentifierType id` and an optional
  `CancellationToken`. `PublishAsync` (line 12) and `UnpublishAsync` (line 14) return `Task<bool>`
  (success signal); `RefreshFromSessionizeAsync` (line 16) returns
  `Task<RefreshFromSessionizeResultDTO?>` (the sync summary, nullable when the call yields no body).
- **Why it's built this way**: the extra verbs live on the *interface* so the concrete
  [`EventService`](#eventservice) is the only place that knows the endpoint URLs; pages stay
  transport-agnostic.
- **Where it's used**: implemented by [`EventService`](#eventservice) (Level 4); injected into the
  event detail/edit Blazor pages that expose the publish/refresh actions.

### IQuestionUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IQuestionUIService.cs:9` · Level 3 · interface

- **What it is**: the UI-service contract for the `questions` resource, an empty marker over
  [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [`QuestionDTO`](group-17-conference-domain.md#questiondto) (`IQuestionUIService.cs:9`).
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  and [`QuestionDTO`](group-17-conference-domain.md#questiondto).
- **Concept**: same marker shape as [`ICategoryItemUIService`](#icategoryitemuiservice); see there.
  `[Rubric §18, UI Architecture]`.
- **Walkthrough**: no members (doc comment `IQuestionUIService.cs:6-8`).
- **Where it's used**: injected into the question Blazor pages; the concrete implementation is a thin
  `EntityServiceBase` subclass registered in DI.

### IRoomUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/IRoomUIService.cs:9` · Level 3 · interface

- **What it is**: the UI-service contract for the `rooms` resource. It extends the generic CRUD surface
  with a single specialized delete that also carries the owning event id (`IRoomUIService.cs:9-13`).
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [`RoomDTO`](group-17-conference-domain.md#roomdto). `EventIdentifierType` id alias.
- **Concept**: `[Rubric §9, API & Contract Design]` (assesses contracts that carry the parameters the
  server actually requires). A room is scoped to an event, so its delete needs the `EventIdentifierType`
  the WebAPI endpoint expects; the generic `DeleteAsync(id)` would omit it. The doc comment
  (`IRoomUIService.cs:11`) states the override "passes the required event ID to the API". This is the
  UI-side counterpart to the child-scoped delete used by the join and organizer-feedback services
  below.
- **Walkthrough**: one added member, `DeleteAsync(RoomIdentifierType roomId, EventIdentifierType eventId, CancellationToken)`
  (line 12), returning `Task<bool>`. It supplements the inherited single-arg delete with the
  event-aware form.
- **Where it's used**: injected into the room Blazor pages; the concrete implementation supplies the
  event id on the delete URL.

### ISessionUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ISessionUIService.cs:9` · Level 3 · interface

- **What it is**: the UI-service contract for the `sessions` resource, an empty marker over
  [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [`SessionDTO`](group-17-conference-domain.md#sessiondto) (`ISessionUIService.cs:9`).
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  and [`SessionDTO`](group-17-conference-domain.md#sessiondto).
- **Concept**: same marker shape as [`ICategoryItemUIService`](#icategoryitemuiservice).
  `[Rubric §18, UI Architecture]`. Note that the personalized speaker-facing session reads live on a
  *separate* contract, [`ISpeakerDashboardUIService`](#ispeakerdashboarduiservice), because they must
  bypass the shared output cache.
- **Walkthrough**: no members (doc comment `ISessionUIService.cs:6-8`).
- **Where it's used**: injected into the session Blazor pages.

### ISpeakerDashboardUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ISpeakerDashboardUIService.cs:9` · Level 3 · interface

- **What it is**: a bespoke (non-CRUD) UI-service contract for a speaker's personalized dashboard: the
  sessions the speaker presents, per-session bookmark counts, and per-session feedback
  (`ISpeakerDashboardUIService.cs:9-30`). It does **not** extend
  [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype);
  it is its own read-only interface.
- **Depends on**: [`SessionDTO`](group-17-conference-domain.md#sessiondto) and
  [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto). `SpeakerIdentifierType`
  and `SessionIdentifierType` id aliases.
- **Concept introduced, a cache-bypassing personalized read.** `[Rubric §23, Front-End Performance]`
  and `[Rubric §19, State Management]` (assess how the front end balances shared caching against
  read-your-writes freshness for a personalized view). The doc comment on `GetSpeakerSessionsAsync`
  (`ISpeakerDashboardUIService.cs:11-16`) is explicit and load-bearing: this read is fetched **fresh,
  bypassing the shared sessions output cache**, so a just-made speaker assignment shows immediately.
  Without the bypass, a read-populate-after-evict race on the output cache could leave a freshly
  assigned speaker seeing "no sessions". This is the UI-contract expression of the freshness-vs-cache
  decision; the public session list stays cached, the personalized dashboard does not.
- **Walkthrough**: four read methods, all `SpeakerIdentifierType`-scoped.
  - `GetSpeakerSessionsAsync(speakerId, ct)` (line 17): returns
    `Task<IReadOnlyList<SessionDTO>>`, the speaker's sessions, uncached.
  - `GetSessionBookmarkCountAsync(speakerId, sessionId, ct)` (line 21): returns `Task<int>`, the
    bookmark count for one of the speaker's sessions.
  - `GetSessionBookmarkCountsAsync(speakerId, sessionIds, ct)` (lines 31-34): returns
    `Task<IReadOnlyDictionary<SessionIdentifierType, int>>`, every requested session's active bookmark
    count in a single request (the doc comment at lines 26-30 records it replaces the dashboard's
    per-session fan-out; unbookmarked sessions map to 0).
  - `GetSessionFeedbackAsync(speakerId, sessionId, ct)` (line 36): returns
    `Task<SessionFeedbackDTO?>`, nullable when no feedback exists.
- **Why it's built this way**: keeping these on a dedicated interface (rather than folding them into
  [`ISessionUIService`](#isessionuiservice)) isolates the cache-bypass semantics to the personalized
  surface and keeps the generic session CRUD cache-friendly.
- **Where it's used**: injected into the speaker dashboard Blazor page; implemented by a concrete HTTP
  service registered in DI.

### ISpeakerUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ISpeakerUIService.cs:9` · Level 3 · interface

- **What it is**: the UI-service contract for the `speakers` resource, extending generic CRUD with two
  user-linking operations (`ISpeakerUIService.cs:9-14`).
- **Depends on**: [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype)
  bound to [`SpeakerDTO`](group-17-conference-domain.md#speakerdto). `SpeakerIdentifierType` and
  `UserIdentifierType` id aliases.
- **Concept**: `[Rubric §9, API & Contract Design]` (state-transition verbs over generic update; same
  rationale as [`IEventUIService`](#ieventuiservice)). Linking a speaker to a user account (the
  User-to-Speaker association from the ADC Identity module) is a distinct operation, not a field edit,
  so it gets `LinkUserAsync` / `UnlinkUserAsync`. `[Rubric §18, UI Architecture]`.
- **Walkthrough**: two added members.
  - `LinkUserAsync(SpeakerIdentifierType speakerId, UserIdentifierType userId, CancellationToken)`
    (line 11): returns `Task<bool>`.
  - `UnlinkUserAsync(SpeakerIdentifierType speakerId, CancellationToken)` (line 13): returns
    `Task<bool>`; unlink needs only the speaker id.
- **Where it's used**: injected into the speaker detail/edit Blazor pages that expose linking; the
  concrete `EntityServiceBase` subclass maps these to the speaker link/unlink endpoints.

### OrganizerEventFeedbackService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/OrganizerFeedbackService.cs:15` · Level 3 · class (sealed)

- **What it is**: an authenticated HTTP service that reads and deletes **event** feedback answers on
  behalf of an organizer, who sees all answers (`OrganizerFeedbackService.cs:15-57`). It implements
  [`IOrganizerEventFeedbackUIService`](#iorganizereventfeedbackuiservice).
- **Depends on**: [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase)
  (its base, supplies `CreateAuthenticatedClientAsync` and `RetryPolicy`),
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) (bearer-token source),
  [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper) (domain-error
  translation), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt)
  (the paged envelope), and [`EventQuestionAnswerDTO`](group-17-conference-domain.md#eventquestionanswerdto).
  BCL `IHttpClientFactory`, `System.Net.Http.Json`, `System.Globalization`.
- **Concept introduced, the authenticated organizer read-service over a token-carrying HttpClient.**
  `[Rubric §18, UI Architecture]` and `[Rubric §11, Security]` (assess how UI calls attach auth and
  handle failures). The class derives from
  [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) using a
  primary constructor that forwards `IHttpClientFactory` and
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) to the base
  (`OrganizerFeedbackService.cs:15-17`); every request goes through
  `CreateAuthenticatedClientAsync()` so the JWT is attached centrally rather than per call. The doc
  comment (`OrganizerFeedbackService.cs:11-14`) records the authorization intent: organizers see all
  answers because the server-side specification is null for organizer users, so this client simply
  requests the full paged set.
- **Walkthrough**
  - `Endpoint` (`OrganizerFeedbackService.cs:19`): the `const string "eventquestionanswers"` resource
    root.
  - `GetAllAnswersAsync(eventId, ct)` (line 21): builds a paged, `EventId`-filtered URL with
    `string.Create(CultureInfo.InvariantCulture, ...)` (culture-invariant so the numeric id renders
    stably, lines 27-28), asking for `pageSize=500&includeChildren=false`; runs the GET inside
    `RetryPolicy.ExecuteAsync` (lines 30-31), calls `EnsureSuccessStatusCode`, deserializes a
    [`PagedCollectionResult<EventQuestionAnswerDTO>`](group-01-result-error-handling.md#pagedcollectionresultt),
    and returns its `Items` (empty list when null, line 38).
  - `DeleteAnswerAsync(eventId, answerId, ct)` (line 41): builds `"{Endpoint}/{answerId}?eventId={eventId}"`
    (the event id is a required query argument, mirroring the child-scoped delete pattern), issues the
    DELETE through the retry policy, and on a non-success status routes the response through
    [`ServiceExceptionHelper.ThrowIfDomainExceptionAsync`](group-15-common-ui-framework.md#serviceexceptionhelper)
    (lines 52-53) so a domain error surfaces as a typed exception before the final
    `EnsureSuccessStatusCode`.
- **Why it's built this way**: inheriting the authenticated base means token attachment and the Polly
  retry live in one shared place; the service only owns the URL shapes and the organizer-sees-all
  read. Requesting `pageSize=500` in a single call keeps the organizer feedback grid simple (no
  client-side paging) at the cost of a hard ceiling, see the caveat.
- **Where it's used**: injected via [`IOrganizerEventFeedbackUIService`](#iorganizereventfeedbackuiservice)
  into the organizer event-feedback Blazor page.
- **Caveats / not-in-source**: the read is capped at `pageSize=500` (`OrganizerFeedbackService.cs:28`);
  an event with more than 500 answers would be truncated. There is no follow-on paging in this method.

### OrganizerSessionFeedbackService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/OrganizerFeedbackService.cs:62` · Level 3 · class (sealed)

- **What it is**: the **session** counterpart to [`OrganizerEventFeedbackService`](#organizereventfeedbackservice),
  structurally identical but keyed on `SessionId` and the `sessionquestionanswers` resource
  (`OrganizerFeedbackService.cs:62-104`). It implements
  [`IOrganizerSessionFeedbackUIService`](#iorganizersessionfeedbackuiservice).
- **Depends on**: same set as its event sibling, with
  [`SessionQuestionAnswerDTO`](group-17-conference-domain.md#sessionquestionanswerdto) in place of the
  event answer DTO; base [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase),
  [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt).
- **Concept**: see [`OrganizerEventFeedbackService`](#organizereventfeedbackservice) for the
  authenticated-read pattern; this class differs only in the entity it keys on. The two are the same
  shape at different resource roots.

  | Member | File:Line | Differs from the event sibling |
  |--------|-----------|--------------------------------|
  | `Endpoint` const | `OrganizerFeedbackService.cs:66` | `"sessionquestionanswers"` (vs `"eventquestionanswers"`) |
  | `GetAllAnswersAsync(sessionId, ct)` | `OrganizerFeedbackService.cs:68` | filters on `SessionId`; returns `SessionQuestionAnswerDTO` |
  | `DeleteAnswerAsync(sessionId, answerId, ct)` | `OrganizerFeedbackService.cs:88` | scopes the delete with `?sessionId={sessionId}` |

- **Walkthrough**: mechanically the same as the event service, the paged GET (line 68) uses the
  same `pageSize=500&includeChildren=false` shape and culture-invariant URL build, and the DELETE
  (line 88) routes non-success responses through
  [`ServiceExceptionHelper.ThrowIfDomainExceptionAsync`](group-15-common-ui-framework.md#serviceexceptionhelper)
  (lines 99-100) before `EnsureSuccessStatusCode`.
- **Where it's used**: injected via [`IOrganizerSessionFeedbackUIService`](#iorganizersessionfeedbackuiservice)
  into the organizer session-feedback Blazor page.
- **Caveats / not-in-source**: same `pageSize=500` ceiling as the event sibling
  (`OrganizerFeedbackService.cs:75`).

### SpeakerLookupService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/SpeakerLookupService.cs:11` · Level 3 · class (sealed)

- **What it is**: a small read service that fetches every speaker once and builds a speaker-keyed
  lookup dictionary (`SpeakerIdentifierType` to [`SpeakerInfo`](#speakerinfo)) so pages can enrich raw
  speaker ids with display names and profile pictures (`SpeakerLookupService.cs:11-34`). It implements
  [`ISpeakerLookupService`](#ispeakerlookupservice).
- **Depends on**: [`SpeakerInfo`](#speakerinfo) (the lightweight projection it emits),
  [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) (the wire shape it reads),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt); BCL
  `IHttpClientFactory` and `System.Net.Http.Json`. Note it takes only `IHttpClientFactory` (no
  token storage): this is an unauthenticated public read.
- **Concept introduced, the client-side denormalizing lookup.** `[Rubric §23, Front-End Performance]`
  (assesses avoiding N per-item round-trips). Session and event pages hold speaker *ids* but must show
  speaker *names*; rather than fetch each speaker individually, this service pulls the whole speaker
  set in one call and hands back an in-memory dictionary the page indexes locally. The doc comment
  (`SpeakerLookupService.cs:7-10`) states this use directly (used by Session and Event pages to enrich
  speaker ids with display names).
- **Walkthrough**: one method, `GetAllAsync(ct)` (line 14). It resolves the named `"APIClient"`
  `HttpClient` from the factory (line 17), GETs
  `speakers?includeFKs=false&includeChildren=false&pageSize=10000` (a deliberately large page to pull
  every speaker in one request, lines 19-21), takes `wrapper?.Items` (empty when null, line 23), then
  loops building a `Dictionary<SpeakerIdentifierType, SpeakerInfo>` where each entry is a
  [`SpeakerInfo`](#speakerinfo) carrying `Id`, `FullName`, and `ProfilePicture` (lines 25-30). It
  returns the dictionary as an `IReadOnlyDictionary`.
- **Why it's built this way**: one bulk fetch plus a local index is far cheaper than per-id lookups
  when a page renders many speaker references; the projection to [`SpeakerInfo`](#speakerinfo) keeps
  only the three display fields the UI needs, not the full [`SpeakerDTO`](group-17-conference-domain.md#speakerdto).
- **Where it's used**: injected via [`ISpeakerLookupService`](#ispeakerlookupservice) into Session and
  Event Blazor pages that render speaker names/avatars.
- **Caveats / not-in-source**: the `pageSize=10000` ceiling (`SpeakerLookupService.cs:20`) assumes the
  conference never exceeds 10,000 speakers; beyond that the lookup would silently miss speakers. The
  dictionary is built fresh per call (no memoization in this class).

### CategoryItemService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/CategoryItemService.cs:10` · Level 4 · class (sealed)

- **What it is**: the concrete HTTP service for the `categoryitems` resource, a body-less class that
  inherits all CRUD from the shared base and binds the endpoint name (`CategoryItemService.cs:10-14`).
  It implements [`ICategoryItemUIService`](#icategoryitemuiservice).
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  (its base), [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice),
  [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto); BCL `IHttpClientFactory`.
- **Concept introduced, the three-line concrete UI service.** `[Rubric §16, Maintainability]` and
  `[Rubric §18, UI Architecture]` (assess how cheaply a new typed HTTP service is added). The primary
  constructor forwards `IHttpClientFactory` and
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) plus the literal
  resource name `"categoryitems"` to
  [`EntityServiceBase<CategoryItemDTO, CategoryItemIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  (`CategoryItemService.cs:10-12`); the class body is empty. All of `GetPagedAsync`, `GetByIdAsync`,
  `CreateAsync`, `UpdateAsync`, `DeleteAsync` come from the base, which is where the auth, retry,
  serialization, and error-translation live, see
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  in Group 15.
- **Walkthrough**: no members. The whole class is the constructor forwarding the resource root
  `"categoryitems"` (`CategoryItemService.cs:11`) and declaring conformance to
  [`ICategoryItemUIService`](#icategoryitemuiservice).
- **Why it's built this way**: the endpoint name is the only thing that varies for a plain CRUD
  aggregate, so the concrete class carries exactly that and nothing else; DI binds
  [`ICategoryItemUIService`](#icategoryitemuiservice) to this type.
- **Where it's used**: registered in the Conference UI DI and injected (as its interface) into the
  category-item Blazor pages.

### ConferenceCategoryService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ConferenceCategoryService.cs:10` · Level 4 · class (sealed)

- **What it is**: the concrete HTTP service for the `conferencecategories` resource, structurally
  identical to [`CategoryItemService`](#categoryitemservice) but bound to
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto)
  (`ConferenceCategoryService.cs:10-14`). It implements
  [`IConferenceCategoryUIService`](#iconferencecategoryuiservice).
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype),
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice),
  [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto).
- **Concept**: identical to [`CategoryItemService`](#categoryitemservice); see it for the thin-class
  rationale. The only differences are the resource root `"conferencecategories"`
  (`ConferenceCategoryService.cs:11`), the DTO, and the interface it satisfies.
  `[Rubric §16, Maintainability]`.
- **Walkthrough**: no members; the constructor passes `"conferencecategories"` to the base
  (`ConferenceCategoryService.cs:10-12`).
- **Where it's used**: injected via [`IConferenceCategoryUIService`](#iconferencecategoryuiservice)
  into the conference-category Blazor pages.

### EventService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/EventService.cs:12` · Level 4 · class (sealed)

- **What it is**: the concrete HTTP service for the `events` resource. It inherits generic CRUD from
  the base and adds the three event-specific calls promised by
  [`IEventUIService`](#ieventuiservice): publish, unpublish, and Sessionize refresh
  (`EventService.cs:12-53`).
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype),
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice),
  [`EventDTO`](group-17-conference-domain.md#eventdto),
  [`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto);
  BCL `System.Net.Http.Json`.
- **Concept introduced, adding action endpoints on top of the CRUD base via `SendRequestAsync`.**
  `[Rubric §18, UI Architecture]` and `[Rubric §9, API & Contract Design]`. Where the plain CRUD
  services have empty bodies, this one implements the three extra verbs by calling the base helper
  `SendRequestAsync<T>` with a lambda that issues the actual HTTP POST, so the concrete class writes
  URL + verb and the base owns auth, retry, and deserialization. `Endpoint` (the resource root
  supplied to the base) is reused to build the action URLs.
- **Walkthrough**
  - Constructor (`EventService.cs:12-14`): forwards the factory, token storage, and `"events"` to
    [`EntityServiceBase<EventDTO, EventIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype).
  - `PublishAsync(id, ct)` (line 16): POSTs `"{Endpoint}/{id}/publish"` with no body via
    `SendRequestAsync<object>(..., expectContent: false)` (lines 20-26), returns `true`.
  - `UnpublishAsync(id, ct)` (line 30): the mirror POST to `"{Endpoint}/{id}/unpublish"`
    (lines 34-40), returns `true`.
  - `RefreshFromSessionizeAsync(id, ct)` (line 44): POSTs `"{Endpoint}/{id}/refresh"` and, unlike the
    publish pair, expects a body, deserializing the response into
    [`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto)
    (lines 47-52).
- **Why it's built this way**: the publish/unpublish/refresh transitions are distinct server actions,
  not CRUD updates, so they map to dedicated `/{id}/action` endpoints; routing them through
  `SendRequestAsync` keeps the auth/retry behavior consistent with the inherited CRUD.
- **Where it's used**: injected via [`IEventUIService`](#ieventuiservice) into the event detail/edit
  Blazor pages that expose the publish and Sessionize-refresh buttons.

### EventSpeakerService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:14` · Level 4 · class (sealed)

- **What it is**: the HTTP service for the `EventSpeaker` join entity, POST to add a speaker to an
  event and DELETE to remove one (`ChildEntityServices.cs:14-25`). It implements
  [`IEventSpeakerUIService`](#ieventspeakeruiservice). It is the first of a family of four
  structurally identical join-entity services in this file (the others,
  `SessionSpeakerService`/`SessionCategoryItemService`/`SpeakerCategoryItemService` at
  `ChildEntityServices.cs:30,46,62`, share the same shape and are documented with the other Conference
  UI join services).
- **Depends on**: [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase)
  (its base, which owns `PostAsync`/`DeleteByIdAsync`),
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice),
  [`EventSpeakerDTO`](group-17-conference-domain.md#eventspeakerdto); BCL `IHttpClientFactory`,
  `System.Net.Http.Json`, `System.Globalization`.
- **Concept introduced, the join-entity UI service.** `[Rubric §18, UI Architecture]` (assesses a
  consistent typed abstraction for many-to-many association edits). A join entity has no CRUD detail
  page; it is only ever added or removed, so it derives from the leaner
  [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase) rather than
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype).
  The constructor forwards the factory, token storage, and resource name `"eventspeakers"` to the base
  (`ChildEntityServices.cs:14-15`), which centralizes auth, domain-error translation, and the
  add/remove HTTP mechanics.
- **Walkthrough**
  - `AddAsync(eventId, speakerId, ct)` (line 17): calls the base `PostAsync` with an anonymous payload
    `{ EventId, SpeakerId }` and deserializes the created
    [`EventSpeakerDTO`](group-17-conference-domain.md#eventspeakerdto) from the response
    (lines 19-20).
  - `DeleteAsync(id, ct)` (line 23): delegates to the base `DeleteByIdAsync`, formatting the join id
    with `CultureInfo.InvariantCulture` (line 24) so the URL segment is culture-stable.
- **Why it's built this way**: all four join services in this file share the same add/remove contract,
  so the base holds the HTTP and error handling and each subclass supplies only the resource name and a
  strongly-typed `AddAsync` overload with the correct id fields. The trailing comment
  (`ChildEntityServices.cs:75-76`) notes the base was hoisted into the shared
  `MMCA.Common.UI.Services` namespace.
- **Where it's used**: injected via [`IEventSpeakerUIService`](#ieventspeakeruiservice) into the event
  detail page for associating speakers with an event.

### ISessionSelectionUIService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ISessionSelectionUIService.cs:8` · Level 4 · interface

- **What it is**: the UI-service contract for the session-selection decision-support dashboard: read
  the dashboard, and trigger a scoring pass over an event's sessions (`ISessionSelectionUIService.cs:8-17`).
  It is a bespoke (non-CRUD) interface.
- **Depends on**: [`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto)
  (the dashboard payload) and [`ScoreEventSessionsResultDTO`](group-17-conference-domain.md#scoreeventsessionsresultdto)
  (the scoring outcome). `EventIdentifierType` id alias.
- **Concept**: `[Rubric §18, UI Architecture]` (interface segregation for the UI service layer; the
  Blazor page depends only on these two methods and never sees the HTTP shape). The two operations map
  directly to the two endpoints on
  [`SessionSelectionController`](group-20-conference-api-grpc.md#sessionselectioncontroller) (Group 20):
  a read (dashboard) and a command (score).
- **Walkthrough**: two members, both `EventIdentifierType`-scoped.
  - `GetDashboardAsync(eventId, ct)` (line 10): returns `Task<SessionSelectionDashboardDTO?>`, nullable
    when the event has no dashboard.
  - `ScoreSessionsAsync(eventId, ct)` (line 14): returns `Task<ScoreEventSessionsResultDTO?>`, the
    result of a re-score.
- **Why it's built this way**: keeping decision-support on its own interface (rather than on
  [`ISessionUIService`](#isessionuiservice)) matches the fact that it is an organizer-only analytical
  surface backed by dedicated controller endpoints, not session CRUD.
- **Where it's used**: injected into the organizer session-selection Blazor page; implemented by a
  concrete HTTP service wired in DI (not part of this unit).

### QuestionService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/QuestionService.cs:10` · Level 4 · class (sealed)

- **What it is**: a **body-less** concrete CRUD service for the `questions` WebAPI resource. It extends
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  over [`QuestionDTO`](group-17-conference-domain.md#questiondto) / `QuestionIdentifierType`, passes the
  REST resource name to the base constructor, and implements the matching empty UI interface
  [`IQuestionUIService`](#iquestionuiservice), inheriting the *entire* CRUD implementation with no added
  code.
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  (Level 3, Common UI); [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice)
  (Level 0) for the circuit-scoped JWT; [`QuestionDTO`](group-17-conference-domain.md#questiondto);
  [`IQuestionUIService`](#iquestionuiservice); BCL `IHttpClientFactory`.
- **Concept introduced, the "3-line CRUD service" (Template Method with a supplied endpoint).** All
  behavior (`GetAllAsync` / `GetPagedAsync` / `GetByIdAsync` / `AddAsync` / `UpdateAsync` / `DeleteAsync`
  / `GetAllForLookupAsync`, plus the central `SendRequestAsync` dispatch with Polly retry and
  domain-error extraction) lives on
  [`EntityServiceBase`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:23`); this subclass only
  supplies the endpoint string and ties together the generic types. `[Rubric §2, Design Patterns]`
  (assesses whether a shared algorithm is factored once and specialized by leaves; here the base owns the
  CRUD algorithm and the leaf supplies the resource name, a textbook Template Method) and
  `[Rubric §16, Maintainability]` (assesses the cost of adding a like-for-like feature; a new plain-CRUD
  resource costs one tiny class).
- **Walkthrough**: a primary-constructor class whose base call is the only content
  (`QuestionService.cs:10-14`): `EntityServiceBase<QuestionDTO, QuestionIdentifierType>("questions",
  httpClientFactory, tokenStorageService)`. The body is empty.
- **Why it's built this way**: questions need nothing beyond CRUD in the UI, so an empty subclass is the
  smallest concrete type that still gives DI a binding for
  [`IQuestionUIService`](#iquestionuiservice).
- **Where it's used**: registered in the Conference UI `DependencyInjection` as
  [`IQuestionUIService`](#iquestionuiservice); injected into the Question list/detail/create/edit/delete
  pages.

### RoomService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/RoomService.cs:12` · Level 4 · class (sealed)

- **What it is**: the concrete Room CRUD service. It extends
  [`EntityServiceBase`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype) over
  `"rooms"` but **overrides `AddAsync`** to reshape the create payload, and adds the parent-scoped
  `DeleteAsync(roomId, eventId)` declared by [`IRoomUIService`](#iroomuiservice).
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  (Level 3) and its `Endpoint` / `SendRequestAsync` / `CreateAuthenticatedClientAsync` members;
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) (Level 0);
  [`RoomDTO`](group-17-conference-domain.md#roomdto); [`IRoomUIService`](#iroomuiservice); the
  `RoomIdentifierType` / `EventIdentifierType` aliases; BCL `System.Net.Http.Json`.
- **Concept**: cross-reference the "3-line CRUD service" pattern under
  [`QuestionService`](#questionservice) for the inherited-CRUD half. Two things make `RoomService` more
  than a 3-liner: (1) it **overrides** the base's `virtual AddAsync` because the create endpoint's
  `AddRoomRequest` contract expects a `RoomId` field, not the DTO's `Id`, so the override builds an
  anonymous body remapping `RoomId = dto.Id` alongside the remaining Room fields (`RoomService.cs:16-32`);
  this still routes through the base `SendRequestAsync`, so it keeps the Polly retry + domain-error
  extraction. `[Rubric §9, API & Contract Design]` (assesses whether the client honors the server's
  request contract; here it shapes its payload to `AddRoomRequest` rather than assuming symmetry with the
  DTO). (2) It implements the parent-scoped `DeleteAsync(roomId, eventId)`.
- **Walkthrough**:
  - `AddAsync(dto)` override (`RoomService.cs:16-32`): `SendRequestAsync<RoomDTO>` posting an anonymous
    object `{ RoomId = dto.Id, dto.EventId, dto.Name, dto.Sort, dto.Capacity, dto.Floor, dto.Location,
    dto.AccessibilityInfo }` to `Endpoint`; the trailing `!` asserts the base returns a non-null DTO.
  - `DeleteAsync(roomId, eventId)` (`RoomService.cs:35-43`): builds `{Endpoint}/{roomId}?eventId={eventId}`
    (parent id as a query param, mirroring the [`IRoomUIService`](#iroomuiservice) contract) and routes it
    through the base `SendRequestAsync<object>` with `expectContent: false`, exactly like the inherited
    CRUD deletes: Polly retry, `ServiceExceptionHelper` domain-error extraction, and a thrown exception on
    a non-success response, returning `true` on success.
- **Why it's built this way**: the create-payload remap keeps the UI honest about the server's
  `AddRoomRequest` shape; the parent-scoped delete is required because rooms belong to an event and the
  endpoint binds the parent id (the silent-404 footgun the interface guards against).
- **Where it's used**: registered as [`IRoomUIService`](#iroomuiservice); injected into the Room
  management pages under an Event (add form, delete button).
- **Caveats / not-in-source**: `DeleteAsync` returns a constant `true` (matching the base CRUD
  `DeleteAsync` contract): the `bool` carries no failure signal of its own, because failures, transient
  ones after the retries are exhausted, surface as thrown exceptions handled by the calling page.

### SessionCategoryItemService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:46` · Level 4 · class (sealed)

- **What it is**: the HTTP service for the **SessionCategoryItem join entity**, add (POST) / remove
  (DELETE) a category-item tag on a session. It is one of four structurally-identical join-entity
  services in `ChildEntityServices.cs`; its sibling [`EventSpeakerService`](#eventspeakerservice) (the
  same file, at line 14) teaches the shared shape. Implements
  [`ISessionCategoryItemUIService`](#isessioncategoryitemuiservice).
- **Depends on**: [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase)
  (Level 3, Common UI, hoisted into `MMCA.Common.UI.Services`, recorded by the trailing comment at
  `ChildEntityServices.cs:75-77`) for `PostAsync<TRequest>` / `DeleteByIdAsync` over the named
  `"APIClient"`; [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) (Level 0);
  [`SessionCategoryItemDTO`](group-17-conference-domain.md#sessioncategoryitemdto); the
  `SessionIdentifierType` / `CategoryItemIdentifierType` / `SessionCategoryItemIdentifierType` aliases;
  BCL `System.Net.Http.Json`, `CultureInfo.InvariantCulture`.
- **Concept**: cross-reference [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase)
  for the shared POST/DELETE mechanics. A **join (link/association) entity** has no rich lifecycle, you
  only create or remove the link, so it does not use the full-CRUD
  [`EntityServiceBase`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype); it
  uses the leaner child base, which extracts domain errors via
  [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper) and maps a 404 on
  delete to `false` (idempotent remove). `[Rubric §18, UI Architecture]` (assesses whether pages depend
  on well-factored typed services rather than raw `HttpClient`; the service owns the add/remove request
  lifecycle for the session's tag editor).
- **Walkthrough** (`ChildEntityServices.cs:46`):
  - `AddAsync(sessionId, categoryItemId)` (`ChildEntityServices.cs:49-53`): `PostAsync(new { SessionId,
    CategoryItemId })` to the `"sessioncategoryitems"` endpoint, then deserializes the created
    [`SessionCategoryItemDTO`](group-17-conference-domain.md#sessioncategoryitemdto) from the response
    body (nullable).
  - `DeleteAsync(id)` (`ChildEntityServices.cs:55-56`): `DeleteByIdAsync(id.ToString(InvariantCulture))`,
    which returns `false` on a 404 and `true` otherwise.
- **Why it's built this way**: modeling each many-to-many link as its own tiny service over a shared
  child base keeps the add/remove surface uniform and the per-link payload strongly typed, without the
  over-built CRUD surface a join row does not need.
- **Where it's used**: injected into the Session detail page's "categories on this session" editor.

### SessionService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/SessionService.cs:10` · Level 4 · class (sealed)

- **What it is**: a **body-less** concrete CRUD service for the `sessions` WebAPI resource, extending
  [`EntityServiceBase`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype) over
  [`SessionDTO`](group-17-conference-domain.md#sessiondto) / `SessionIdentifierType` and implementing
  [`ISessionUIService`](#isessionuiservice).
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  (Level 3); [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) (Level 0);
  [`SessionDTO`](group-17-conference-domain.md#sessiondto); [`ISessionUIService`](#isessionuiservice).
- **Concept**: cross-reference the "3-line CRUD service" pattern under
  [`QuestionService`](#questionservice); this is the same shape over a different resource. It inherits the
  full CRUD algorithm and supplies only the endpoint string. `[Rubric §2, Design Patterns]` (Template
  Method), `[Rubric §16, Maintainability]`.
- **Walkthrough**: primary-constructor class, empty body, base call only (`SessionService.cs:10-14`):
  `EntityServiceBase<SessionDTO, SessionIdentifierType>("sessions", httpClientFactory,
  tokenStorageService)`.
- **Why it's built this way**: sessions need nothing beyond generic CRUD in the UI, so the empty subclass
  is enough to give DI a concrete type and a named interface to bind.
- **Where it's used**: registered as [`ISessionUIService`](#isessionuiservice); injected into the Session
  list/detail/create/edit/delete pages. Note the speaker's own-sessions view uses the separate,
  cache-bypassing [`SpeakerDashboardService`](#speakerdashboardservice) instead of this generic CRUD
  read.

### SessionSpeakerService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:30` · Level 4 · class (sealed)

- **What it is**: the HTTP service for the **SessionSpeaker join entity**, add (POST) / remove (DELETE) a
  speaker on a session. It is the structural twin of
  [`SessionCategoryItemService`](#sessioncategoryitemservice) and
  [`EventSpeakerService`](#eventspeakerservice), differing only in endpoint, payload keys, and DTO.
  Implements [`ISessionSpeakerUIService`](#isessionspeakeruiservice).
- **Depends on**: [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase)
  (Level 3, Common UI); [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice)
  (Level 0); [`SessionSpeakerDTO`](group-17-conference-domain.md#sessionspeakerdto); the
  `SessionIdentifierType` / `SpeakerIdentifierType` / `SessionSpeakerIdentifierType` aliases; BCL
  `System.Net.Http.Json`, `CultureInfo.InvariantCulture`.
- **Concept**: cross-reference the join-entity POST/DELETE mechanics taught under
  [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase) and
  [`SessionCategoryItemService`](#sessioncategoryitemservice). `[Rubric §18, UI Architecture]`.
- **Walkthrough** (`ChildEntityServices.cs:30`):
  - `AddAsync(sessionId, speakerId)` (`ChildEntityServices.cs:33-37`): `PostAsync(new { SessionId,
    SpeakerId })` to the `"sessionspeakers"` endpoint, then deserializes the created
    [`SessionSpeakerDTO`](group-17-conference-domain.md#sessionspeakerdto) (nullable).
  - `DeleteAsync(id)` (`ChildEntityServices.cs:39-40`): `DeleteByIdAsync(id.ToString(InvariantCulture))`,
    `false` on 404, `true` otherwise.
- **Why it's built this way**: same rationale as the other join services, a tiny per-link service over
  the shared child base keeps the add/remove surface uniform and strongly typed.
- **Where it's used**: injected into the Session detail page's "speakers on this session" editor (and,
  server-side, the SessionSpeaker rows the speaker dashboard filters on).

### SpeakerCategoryItemService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:62` · Level 4 · class (sealed)

- **What it is**: the HTTP service for the **SpeakerCategoryItem join entity**, add (POST) / remove
  (DELETE) a category-item tag on a speaker (used for the speaker-locality categorization). It is the
  fourth structurally-identical join-entity service in `ChildEntityServices.cs`, differing from
  [`SessionCategoryItemService`](#sessioncategoryitemservice) only in endpoint, payload keys, and DTO.
  Implements [`ISpeakerCategoryItemUIService`](#ispeakercategoryitemuiservice).
- **Depends on**: [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase)
  (Level 3, Common UI); [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice)
  (Level 0); [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto); the
  `SpeakerIdentifierType` / `CategoryItemIdentifierType` / `SpeakerCategoryItemIdentifierType` aliases;
  BCL `System.Net.Http.Json`, `CultureInfo.InvariantCulture`.
- **Concept**: cross-reference the join-entity mechanics under
  [`ChildEntityServiceBase`](group-15-common-ui-framework.md#childentityservicebase) and
  [`SessionCategoryItemService`](#sessioncategoryitemservice). `[Rubric §18, UI Architecture]`.
- **Walkthrough** (`ChildEntityServices.cs:62`):
  - `AddAsync(speakerId, categoryItemId)` (`ChildEntityServices.cs:65-69`): `PostAsync(new { SpeakerId,
    CategoryItemId })` to the `"speakercategoryitems"` endpoint, then deserializes the created
    [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto) (nullable).
  - `DeleteAsync(id)` (`ChildEntityServices.cs:71-72`): `DeleteByIdAsync(id.ToString(InvariantCulture))`,
    `false` on 404, `true` otherwise.
- **Why it's built this way**: same shared-child-base rationale as the other three join services.
- **Where it's used**: injected into the Speaker detail page's "categories on this speaker" editor
  (including the speaker-locality tagging).

### SpeakerDashboardService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/SpeakerDashboardService.cs:15` · Level 4 · class (sealed)

- **What it is**: a bespoke **authenticated HTTP service** backing the speaker's own dashboard, four
  speaker-scoped reads: the sessions this speaker presents, how many attendees bookmarked one of those
  sessions (single and batched variants), and the aggregated feedback for a session. It extends
  [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) directly (not the
  CRUD base) and implements [`ISpeakerDashboardUIService`](#ispeakerdashboarduiservice).
- **Depends on**: [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase)
  (Level 1, Common UI) for `CreateAuthenticatedClientAsync()` and the shared Polly `RetryPolicy`;
  [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper) for domain-error
  extraction; [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) (Level 0);
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) for the
  paged-envelope deserialization; [`SessionDTO`](group-17-conference-domain.md#sessiondto) and
  [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto) (nullable feedback return);
  the `SpeakerIdentifierType` (`Guid`) / `SessionIdentifierType` (`int`) aliases; BCL
  `System.Net.Http.Json`, `CultureInfo.InvariantCulture`, `Guid`.
- **Concept introduced, the cache-bypassing dashboard/aggregate read service.** Unlike the CRUD services,
  this one does not fit
  [`EntityServiceBase`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype), it
  is a small set of computed/scoped reads, so it drops to the thinner authenticated base and hand-builds
  each request. `[Rubric §19, State Management]` (assesses how the UI keeps its data consistent with the
  server) and `[Rubric §12, Performance & Scalability]` / `[Rubric §23, Front-End Performance]`: the
  `GetSpeakerSessionsAsync` walkthrough is load-bearing, it reads **FRESH**, appending a unique
  `_={Guid:N}` cache-bust query param so the read is a guaranteed miss against the shared
  `conference:sessions` output cache; the cached public list can briefly lag a just-made speaker
  assignment (a read-populate-after-evict race, documented in the inline comment at
  `SpeakerDashboardService.cs:23-29`), which would otherwise leave a freshly-assigned speaker seeing "no
  sessions". The bookmark count is sourced server-side from the **Engagement** service across the
  gRPC/event boundary (ADR-007), but the UI sees only this single typed contract.
- **Walkthrough** (`SpeakerDashboardService.cs:15`):
  - Every read dispatches through the private `SendGetRequestAsync<T>` (`SpeakerDashboardService.cs:86-105`),
    the service's own copy of the `EntityServiceBase.SendRequestAsync` semantics (which live on the CRUD
    base this class does not extend): the request runs through the Polly `RetryPolicy`, a non-success
    response first goes through [`ServiceExceptionHelper`](group-15-common-ui-framework.md#serviceexceptionhelper)
    domain-error extraction and then `EnsureSuccessStatusCode()`, and only a success deserializes. A
    `treatNotFoundAsDefault` flag lets a caller map 404 to `default` instead of throwing.
  - `GetSpeakerSessionsAsync(speakerId)` (`SpeakerDashboardService.cs:19-40`): builds
    `sessions?includeFKs=false&includeChildren=true&_={cacheBust}` where `cacheBust =
    Guid.NewGuid().ToString("N")` (lines 30-31); deserializes a
    [`PagedCollectionResult<SessionDTO>`](group-01-result-error-handling.md#pagedcollectionresultt)
    (matching the paged envelope, not a bare array) and returns only the sessions whose `SessionSpeakers`
    contains this `speakerId` (lines 35-39). The inline note (lines 28-29) records that the base
    `/sessions` endpoint serves at most `MaxPageSize` (500) in one page, which covers a single
    conference's catalog.
  - `GetSessionBookmarkCountAsync(speakerId, sessionId)` (`SpeakerDashboardService.cs:42-49`): GETs
    `speakers/{speakerId}/sessions/{sessionId}/bookmarks/count` and returns the deserialized `int`.
  - `GetSessionBookmarkCountsAsync(speakerId, sessionIds)` (`SpeakerDashboardService.cs:51-63`): the
    batched variant; short-circuits an empty id list, GETs
    `speakers/{speakerId}/sessions/bookmarks/counts?sessionIds=...` (one repeated query param per id)
    and returns the deserialized per-session dictionary.
  - `GetSessionFeedbackAsync(speakerId, sessionId)` (`SpeakerDashboardService.cs:65-73`): GETs
    `speakers/{speakerId}/sessions/{sessionId}/feedback` with `treatNotFoundAsDefault: true`, so a 404
    ("no feedback captured yet", a legitimate domain state) returns `null` while other failures throw;
    else the deserialized [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto).
  - The leading `speakerId` scopes every call, and each URL is built with
    `string.Create(InvariantCulture, ...)` for culture-stable id formatting.
- **Why it's built this way**: aggregate dashboard reads do not fit the entity-CRUD or lookup shapes, so
  they get their own narrow service; the cache-bust on the sessions read trades one extra origin fetch for
  correctness (a speaker must see an assignment immediately), while the anonymous public list keeps its
  output cache untouched.
- **Where it's used**: registered as [`ISpeakerDashboardUIService`](#ispeakerdashboarduiservice);
  injected into the speaker dashboard / "My Sessions" page.
- **Caveats / not-in-source**: the retry/domain-error dispatch is a private copy of the
  `EntityServiceBase.SendRequestAsync` semantics rather than inherited behavior, because that dispatch
  lives on the CRUD base and `AuthenticatedServiceBase` does not carry it; a failed read now throws
  (after the retries are exhausted) and relies on the dashboard page's catch-and-snackbar handling. The
  500-per-page ceiling assumes a single conference's session count stays under `MaxPageSize`.

### SpeakerService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/SpeakerService.cs:12` · Level 4 · class (sealed)

- **What it is**: the concrete Speaker CRUD service. It extends
  [`EntityServiceBase`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype) over
  `"speakers"` (inheriting all CRUD) and adds the two Speaker-to-User linking operations declared by
  [`ISpeakerUIService`](#ispeakeruiservice): link and unlink.
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype)
  (Level 3) and its `Endpoint` / `SendRequestAsync` members;
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) (Level 0);
  [`SpeakerDTO`](group-17-conference-domain.md#speakerdto); [`ISpeakerUIService`](#ispeakeruiservice); the
  `SpeakerIdentifierType` / `UserIdentifierType` aliases; the `LinkUserRequest` payload; BCL
  `System.Net.Http.Json`.
- **Concept**: cross-reference the "3-line CRUD service" pattern under
  [`QuestionService`](#questionservice) for the inherited-CRUD half. The interesting half is how the two
  link operations reuse the base's `SendRequestAsync` dispatch (so they get Polly retry + domain-error
  extraction for free) while hitting a **verb-style sub-resource** of `{Endpoint}/{speakerId}/link`.
  `LinkUserAsync` / `UnlinkUserAsync` are the UI entry points for the **Speaker-to-User association**,
  the relationship that, server-side, raises `SpeakerLinkedToUser` / `SpeakerUnlinkedFromUser`
  integration events so the Identity module can set/clear `User.LinkedSpeakerId`.
  `[Rubric §7, Microservices Readiness]` (assesses whether cross-module coupling is done through
  async/decoupled edges; the page calls one REST endpoint and the cross-module consistency happens
  asynchronously behind it via the broker) and `[Rubric §9, API & Contract Design]` (the association is
  a named `PUT {id}/link` / `DELETE {id}/link`, not a field flip on the DTO).
- **Walkthrough**:
  - `LinkUserAsync(speakerId, userId)` (`SpeakerService.cs:16-29`): `SendRequestAsync<object>` issuing
    `PUT {Endpoint}/{speakerId}/link` with a `LinkUserRequest { UserId = userId }` body and
    `expectContent: false` (no response body), returns `true`.
  - `UnlinkUserAsync(speakerId)` (`SpeakerService.cs:31-42`): `SendRequestAsync<object>` issuing
    `DELETE {Endpoint}/{speakerId}/link` with `expectContent: false`, returns `true`.
- **Why it's built this way**: linking a speaker to a login is a deliberate admin action with its own
  endpoint, not a field edit, so it is named explicitly; routing it through the inherited
  `SendRequestAsync` keeps resilience and error-surfacing uniform with CRUD, and `expectContent: false`
  skips deserialization for these fire-and-confirm calls.
- **Where it's used**: registered as [`ISpeakerUIService`](#ispeakeruiservice); injected into the Speaker
  detail page's "link to user account" control and the Speaker list/create/edit pages.

### SessionSelectionService

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/SessionSelectionService.cs:12` · Level 5 · class (sealed)

- **What it is**: the bespoke **authenticated HTTP service** behind the organizer's session-selection
  decision-support dashboard, one read (fetch the dashboard) and one action (kick off AI scoring of an
  event's sessions). It extends
  [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) directly and
  implements [`ISessionSelectionUIService`](#isessionselectionuiservice).
- **Depends on**: [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase)
  (Level 1, Common UI) for `CreateAuthenticatedClientAsync()` + the static `RetryPolicy`;
  [`ITokenStorageService`](group-15-common-ui-framework.md#itokenstorageservice) (Level 0);
  [`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto) and
  [`ScoreEventSessionsResultDTO`](group-17-conference-domain.md#scoreeventsessionsresultdto); the
  `EventIdentifierType` alias; BCL `System.Net.Http.Json`, `CultureInfo.InvariantCulture`,
  `System.Net.HttpStatusCode`.
- **Concept**: cross-reference the bespoke-authenticated-service pattern taught under
  [`SpeakerDashboardService`](#speakerdashboardservice). What is distinctive here is the CQRS-shaped
  read/action split and the **202-Accepted sentinel**. `[Rubric §6, CQRS & Event-Driven]` (assesses
  whether reads and writes are cleanly separated; `GetDashboardAsync` is a pure query, `ScoreSessionsAsync`
  is a command that maps to the server's two `SessionSelectionController` endpoints, and the scoring path
  ultimately drives the Anthropic-backed session scorer). `[Rubric §29, Resilience]`: the dashboard read
  runs through the inherited Polly `RetryPolicy` (3 retries, exponential backoff on 5xx /
  `HttpRequestException`), while the scoring POST is deliberately **not** retried (a long-running
  background job should not be re-triggered on a slow response).
- **Walkthrough** (`SessionSelectionService.cs:12`):
  - `GetDashboardAsync(eventId)` (`SessionSelectionService.cs:16-30`): builds
    `sessionselection/dashboard/{eventId}` with `string.Create(InvariantCulture, ...)`, executes the GET
    **inside `RetryPolicy.ExecuteAsync`** (line 23), returns `null` on non-success, else deserializes a
    [`SessionSelectionDashboardDTO`](group-17-conference-domain.md#sessionselectiondashboarddto).
  - `ScoreSessionsAsync(eventId)` (`SessionSelectionService.cs:32-51`): POSTs (no body) to
    `sessionselection/score/{eventId}`; if the response is **`202 Accepted`** it returns a sentinel
    `ScoreEventSessionsResultDTO { SessionsScored = -1, SessionsFailed = 0 }` signaling "scoring started
    in background" (lines 42-45); on other non-success returns `null`; otherwise deserializes the real
    [`ScoreEventSessionsResultDTO`](group-17-conference-domain.md#scoreeventsessionsresultdto) summary.
- **Why it's built this way**: the decision-support dashboard is not an entity-CRUD surface, so it uses
  the authenticated base directly; the `202`-vs-`200` branch lets the same call model both a synchronous
  scoring result and an accepted-for-background-processing acknowledgement without a second endpoint.
- **Where it's used**: registered in the Conference UI `DependencyInjection` as
  [`ISessionSelectionUIService`](#isessionselectionuiservice); injected into the organizer's
  session-selection dashboard page.
- **Caveats / not-in-source**: `SessionsScored = -1` is an in-band sentinel for the async case, callers
  must special-case it rather than treat it as a real count. Neither call goes through
  `ServiceExceptionHelper`, so a domain error on the scoring POST surfaces only as a `null` return, not a
  typed exception.

### CachedSessionPage
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionList.razor.cs:346` · Level 3 · record (private sealed, nested)

- **What it is**: the tiny serialization payload for the offline session snapshot: a `List<SessionDTO> Items` plus the `int TotalItems` count. It is a private nested record inside [`PublicSessionList`](#publicsessionlist), used only to round-trip the last successful first page of the schedule through a local cache.
- **Depends on**: [`SessionDTO`](group-17-conference-domain.md#sessiondto); persisted by [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore).
- **Concept introduced, the offline read snapshot (ADR-042 Wave 3).** `[Rubric §23, Front-End Performance]` (assesses caching of read payloads so a slow or dead network still renders content) and `[Rubric §29, Resilience & Business Continuity]` (assesses graceful degradation, here a venue Wi-Fi outage on conference day). Conference day is exactly the scenario where the network is worst and the schedule matters most, so the page keeps the last good page-1 result in device storage and replays it when a live fetch throws while offline.
- **Walkthrough**: a one-line positional record: `private sealed record CachedSessionPage(List<SessionDTO> Items, int TotalItems)` (`PublicSessionList.razor.cs:346`). It is written on every successful page-1 fetch when the cache store is available (`PublicSessionList.razor.cs:320-324`), keyed by the constant `ScheduleCacheKey = "conference.publicSessions.page1"` (`PublicSessionList.razor.cs:43`), and read back only inside the exception filter `when (!Connectivity.IsOnline && CacheStore.IsAvailable && page == 1)` (`PublicSessionList.razor.cs:329-339`). If no snapshot exists the original exception is rethrown (`PublicSessionList.razor.cs:332-335`).
- **Why it's built this way**: a dedicated record (rather than caching the raw tuple) gives the cache a stable, serializable shape and pairs the items with their total so the grid's paging math still works when replaying from cache. Restricting the snapshot to page 1 keeps the stored payload bounded (the first page is the one an offline attendee lands on).
- **Where it's used**: read and written exclusively by [`PublicSessionList`](#publicsessionlist)'s `FetchSessionsAsync`; the `_showingCachedData` flag (`PublicSessionList.razor.cs:344`) drives the "showing cached data" banner in the markup.

---

### PublicSessionListFilterBar
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionListFilterBar.razor.cs:15` · Level 3 · class (partial component)

- **What it is**: the presentational filter bar for [`PublicSessionList`](#publicsessionlist): the organizer Filter-by-Event picker (or the locked "Showing" chip for everyone else), the debounced title search box, the All Sessions / My Schedule toggle, and the share-my-schedule action.
- **Depends on**: [`EventDTO`](group-17-conference-domain.md#eventdto); [`IScreenshotService`](group-26-device-capability-layer.md#iscreenshotservice), [`IShareService`](group-26-device-capability-layer.md#ishareservice), and MudBlazor's `ISnackbar`.
- **Concept introduced, the container/presentational split.** `[Rubric §18, UI Architecture]` (assesses component decomposition and separation of layout from behavior) and `[Rubric §19, State Management]` (assesses where mutable state lives). This component owns **no** filter state. Every value arrives as a `[Parameter]` and every change leaves through a matching `EventCallback`: `IsOrganizer` (`PublicSessionListFilterBar.razor.cs:22`), `Events` (`:25`), `SelectedEventId`/`SelectedEventIdChanged` (`:28-31`), `SearchString`/`SearchStringChanged` (`:34-37`), `ShowMyScheduleOnly`/`ShowMyScheduleOnlyChanged` (`:40-43`). The page stays the single source of truth; the bar is a pure view over it. This is the classic "smart container, dumb presentational child" decomposition, applied so the page can reuse the same filter chrome across its desktop grid and mobile card layouts.
- **Walkthrough**
  - `GetSelectedEventName()` (`PublicSessionListFilterBar.razor.cs:45`): resolves the chip label from the passed-in `Events` list, returning empty when nothing is selected.
  - `ShareScheduleAsync()` (`PublicSessionListFilterBar.razor.cs:48`): captures the current view to a file via [`IScreenshotService`](group-26-device-capability-layer.md#iscreenshotservice) and hands it to [`IShareService`](group-26-device-capability-layer.md#ishareservice); a null capture or a failed share surfaces a warning snackbar (`:51-55`). This is the share-my-schedule action, a native-head capability that no-ops gracefully on the web.
- **Why it's built this way**: pushing all state to the parent means the bar has no lifecycle of its own to keep in sync, so search, event filter, and the schedule toggle can never drift from the data the grid actually fetched.
- **Where it's used**: rendered by [`PublicSessionList`](#publicsessionlist)'s markup; its callbacks land on that page's `OnSearchChanged`/`OnEventFilterChanged`/`OnMyScheduleToggled` handlers.

---

### ConferenceCategoryCreate
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.ConferenceCategory` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryCreate.razor.cs:9` · Level 4 · class (partial component)

- **What it is**: the organizer code-behind for creating a conference category. It collects title/sort/type into a fresh [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto), validates through a `MudForm`, calls the UI service, and navigates to the new detail page.
- **Depends on**: [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto), [`IConferenceCategoryUIService`](#iconferencecategoryuiservice), [`ConferenceRoutePaths`](#conferenceroutepaths); MudBlazor (`MudForm`, `ISnackbar`, `BreadcrumbItem`) and `NavigationManager`.
- **Concept introduced, the create-page pattern (form, dirty tracking, disposal).** `[Rubric §24, Forms, Validation & UX Safety]` (assesses validate-before-submit and unsaved-change protection) and `[Rubric §18, UI Architecture]` (code-behind `partial class` keeping markup in `.razor` and logic here). Three ideas recur across every create/edit page in this group and are worth learning once here:
  - **Validate before mutate.** `CreateCategoryAsync` (`ConferenceCategoryCreate.razor.cs:41`) calls `await _form.ValidateAsync()` and bails with a warning snackbar if `!_form.IsValid` (`:48-53`) before ever touching the service.
  - **Dirty tracking for the unsaved-changes guard.** `_isDirty` (`:37`) is set by `MarkDirty()` (`:39`) on input and cleared the instant a save succeeds, before navigation (`:60`). `[Rubric §19, State Management]`.
  - **Cancellation tied to disposal.** A `CancellationTokenSource _cts` (`:15`) is passed into every service call and cancelled in the standard dispose pattern (`Dispose(bool)` at `:82`, `Dispose()` at `:98`); `OperationCanceledException` is caught and swallowed (`:64-67`) because it is the expected outcome when a component tears down mid-request (or during an InteractiveAuto render-mode transition).
- **Walkthrough**: `OnInitialized` builds the localized breadcrumb trail (`ConferenceCategoryCreate.razor.cs:20-29`); `CreateCategoryAsync` (`:41`) sets `IsSaving`, constructs `new ConferenceCategoryDTO { Id = default, ... }` (`:58`) so the server assigns the key, calls `CategoryService.AddAsync` (`:59`), and on success navigates to `ConferenceCategoryDetails(created.Id)` (`:62`). A note on `_categoryTitle` (`:33`): it is deliberately named to avoid colliding with the localized `Title` page property (SonarAnalyzer S4275).
- **Why it's built this way**: routing every mutation through [`IConferenceCategoryUIService`](#iconferencecategoryuiservice) (never a raw `HttpClient`) keeps the Clean Architecture layering intact inside the UI; the page knows a DTO and a service interface, nothing about transport.
- **Where it's used**: the category create route; navigates onward to [`ConferenceCategoryDetail`](#conferencecategorydetail).

---

### ConferenceCategoryList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.ConferenceCategory` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryList.razor.cs:10` · Level 4 · class (partial component)

- **What it is**: the organizer category list page. It extends [`DataGridListPageBase<ConferenceCategoryDTO>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) to get server-paged data, restored paging/filter/scroll state, a mobile card layout, and delete-with-confirmation, adding only the category-specific fetch and filter.
- **Depends on**: [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto), [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto), [`IConferenceCategoryUIService`](#iconferencecategoryuiservice), [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem), [`ConferenceRoutePaths`](#conferenceroutepaths), and the `DeleteConfirmation` dialog component.
- **Concept introduced, the list-page pattern.** `[Rubric §18, UI Architecture]` (assesses reuse of a shared page base over copy-pasted grid plumbing) and `[Rubric §22, Responsive & Cross-Browser]` (assesses a real mobile layout, not just CSS shrink). By inheriting the base, the page declares only *what* to show and *how* to fetch it:
  - `LoadServerData` (`ConferenceCategoryList.razor.cs:43`) delegates to the base `LoadServerDataAsync`, passing a fetch lambda over `CategoryService.GetPagedAsync` and a filter lambda that adds a `Title contains` filter when `_searchString` is set (`:48-52`).
  - `SaveFilters`/`RestoreFilters` (`:24-28`) persist just the search box; the base restores page, rows-per-page, and scroll.
  - The mobile branch `FetchMobilePage` (`:55`) reuses the same service with an explicit `"Title"/"asc"` sort for the infinite-scroll card list; `IsMobile` (from the base) picks the branch, and `OnMobileCardClick` (`:63`) navigates to the detail page. `[Rubric §25, Navigation & Information Architecture]`.
  - `DeleteCategoryAsync` (`:67`) shows the shared `DeleteConfirmation` dialog, then reloads whichever layout is active.
- **Why it's built this way**: six list pages in this module (categories, events, public events, speakers, rooms, questions) would otherwise repeat identical grid/paging/mobile/delete code; the base collapses that into one tested place and each page is a thin binding. This is the pattern every other list page in the group cross-references.
- **Where it's used**: the category list route; sibling list pages [`EventList`](#eventlist) and [`PublicEventList`](#publiceventlist) follow this same shape.

---

### PublicSessionListView
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionListView.razor.cs:20` · Level 4 · class (partial component)

- **What it is**: the presentational session-list view for [`PublicSessionList`](#publicsessionlist): the mobile infinite-scroll card list and the desktop server-paged data grid, including the inline bookmark stars and their toggle flow.
- **Depends on**: [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`ISessionBookmarkUIService`](group-22-engagement-module.md#isessionbookmarkuiservice) (optional), [`SpeakerInfo`](#speakerinfo), [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem), [`ConferenceRoutePaths`](#conferenceroutepaths); [`IHapticFeedbackService`](group-26-device-capability-layer.md#ihapticfeedbackservice), MudBlazor grid/snackbar, `NavigationManager`.
- **Concept, presentational child with in-place state patching.** `[Rubric §18, UI Architecture]` and `[Rubric §19, State Management]`. Like [`PublicSessionListFilterBar`](#publicsessionlistfilterbar), the view owns no fetch or filter state: the page passes its `ServerData` and `FetchPage` delegates (`PublicSessionListView.razor.cs:66,69`), its paging parameters (`CurrentPage`/`RowsPerPage`, `:33,39`), the speaker and room lookups (`:60,63`), and the shared `BookmarkedSessions` dictionary (`:57`). The one subtlety worth noting: the view mutates that container-owned dictionary **in place** when a star is toggled (`AddBookmarkAsync` writes `BookmarkedSessions[sessionId] = bookmark.Id` at `:152`; `RemoveBookmarkAsync` removes at `:137`), so the page's "My Schedule" fetch, which reads the same dictionary, sees the change without a round-trip. It also exposes the captured `Grid` `@ref` (`:79`) and `ReloadAsync()` (`:82`) so the page's [`DataGridListPageBase`](group-15-common-ui-framework.md#datagridlistpagebasetdto) plumbing keeps restoring rows-per-page and current-page unchanged.
- **Walkthrough**
  - `ReloadAsync` (`PublicSessionListView.razor.cs:82`): resets the mobile infinite list or reloads the desktop grid depending on `IsMobile`.
  - `CanBookmark` (`:97`): a session is bookmarkable only when authenticated, the bookmark service resolved, and the session is neither a service session nor Declined/Cancelled.
  - `ToggleBookmarkAsync` (`:104`): guards against double-taps via `_togglingSessionId`, fires haptic feedback (`Haptics.Click()`, `:110`, a no-op off native heads), then adds or removes the bookmark and surfaces a snackbar; failures roll back to an error snackbar (`:124-127`).
  - `GetSpeakerList` (`:158`): maps a session's `SessionSpeakers` to display names through the passed-in `Speakers` lookup.
- **Why it's built this way**: separating the data grid/card view from the page's fetch-and-filter logic lets the same bookmark and layout code serve both the desktop grid and the mobile list, and keeps the star-toggle interaction local while the page stays the owner of all state.
- **Where it's used**: rendered by [`PublicSessionList`](#publicsessionlist), which holds the `@ref` as `_view`.

---

### EventCreate
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Event` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Event/EventCreate.razor.cs:13` · Level 5 · class (partial component)

- **What it is**: the organizer event-creation form: name, dates, time zone (defaulting to `"America/New_York"`), Sessionize code, and optional venue fields, collected into a new [`EventDTO`](group-17-conference-domain.md#eventdto).
- **Depends on**: [`EventDTO`](group-17-conference-domain.md#eventdto), [`IEventUIService`](#ieventuiservice), [`ConferenceRoutePaths`](#conferenceroutepaths); MudBlazor and `NavigationManager`.
- **Concept**: the same create-page pattern taught at [`ConferenceCategoryCreate`](#conferencecategorycreate): `MudForm` validation before submit, `_isDirty` tracking (`EventCreate.razor.cs:48-50`), and `_cts` cancellation cleared on disposal. `[Rubric §24, Forms, Validation & UX Safety]`. The one addition is a second guard beyond the form: after `_form.ValidateAsync()` it explicitly rejects a missing start/end date with a localized warning (`EventCreate.razor.cs:64-68`) before constructing the DTO, then maps the `DateTime?` pickers to `DateOnly` via `DateOnly.FromDateTime` (`:78-79`) and posts `IsPublished = false` (`:85`) so a new event starts unpublished.
- **Walkthrough**: `CreateEventAsync` (`EventCreate.razor.cs:52`) validates, builds the `EventDTO` (`:73-86`), calls `EventService.AddAsync` (`:88`), clears `_isDirty` (`:89`), and navigates to `EventDetails(created.Id)` (`:91`); `OperationCanceledException` is swallowed as expected teardown (`:93-96`).
- **Where it's used**: the event create route (organizer); navigates to [`EventDetail`](#eventdetail).

---

### EventList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Event` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Event/EventList.razor.cs:15` · Level 5 · class (partial component)

- **What it is**: the organizer event list. It extends [`DataGridListPageBase<EventDTO>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) with a `Name contains` search, a mobile card layout, and delete-with-confirmation.
- **Depends on**: [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto), [`EventDTO`](group-17-conference-domain.md#eventdto), [`IEventUIService`](#ieventuiservice), [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem), [`ConferenceRoutePaths`](#conferenceroutepaths), `DeleteConfirmation`.
- **Concept**: the list-page pattern taught at [`ConferenceCategoryList`](#conferencecategorylist). `LoadServerData` (`EventList.razor.cs:48`) fetches through `EventService.GetPagedAsync` and filters on `Name` (`:53-57`); `FetchMobilePage` (`:60`) mirrors it with a `"Name"/"asc"` sort; `DeleteEventAsync` (`:71`) confirms then reloads the active layout. `[Rubric §18, UI Architecture]`, `[Rubric §22, Responsive & Cross-Browser]`, `[Rubric §25, Navigation & Information Architecture]` (`NavigateToCreate`/`NavigateToDetails`, `:102-106`).
- **Where it's used**: the organizer events route.

---

### PublicEventList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicEventList.razor.cs:15` · Level 5 · class (partial component)

- **What it is**: the public (no-login) event list, showing published events to attendees and anonymous users. Structurally identical to [`EventList`](#eventlist) minus the create/delete organizer actions.
- **Depends on**: the same [`DataGridListPageBase<EventDTO>`](group-15-common-ui-framework.md#datagridlistpagebasetdto), [`EventDTO`](group-17-conference-domain.md#eventdto), [`IEventUIService`](#ieventuiservice), [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem), and [`ConferenceRoutePaths`](#conferenceroutepaths).
- **Concept**: the list-page pattern ([`ConferenceCategoryList`](#conferencecategorylist)) with a security note: the client page fetches the same `EventService.GetPagedAsync` (`PublicEventList.razor.cs:46-56`), but the API enforces `PublishedEventSpecification` for non-organizer callers (BR-108, doc comment `:12`), so an anonymous request can only ever see published events. `[Rubric §11, Security]` (assesses that authorization is enforced server-side, not by hiding a button); the public page never has to trust the client to filter drafts. It passes `showCancelSnackbar: false` (`:56`) so a cancelled navigation does not flash an error to anonymous visitors.
- **Where it's used**: the public events route; cards navigate to [`PublicEventDetail`](#publiceventdetail).

---

### ConferenceCategoryDetail
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.ConferenceCategory` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryDetail.razor.cs:11` · Level 6 · class (partial component)

- **What it is**: the organizer category detail page: it loads a [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) by route id, supports inline edit and delete of the category, and hosts full CRUD over its [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto) children.
- **Depends on**: [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto), [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto), [`IConferenceCategoryUIService`](#iconferencecategoryuiservice), [`ICategoryItemUIService`](#icategoryitemuiservice), [`ConferenceRoutePaths`](#conferenceroutepaths); the `DeleteConfirmation` dialog and MMCA.Common's `Parse<T>` string extension.
- **Concept introduced, the detail-page pattern (load-by-id, edit toggle, disposal).** `[Rubric §18, UI Architecture]` and `[Rubric §24, Forms, Validation & UX Safety]`. Every detail page in this group shares three moves, learned here:
  - **Idempotent load guarded by `_loadedId`.** `OnParametersSetAsync` (`ConferenceCategoryDetail.razor.cs:64`) returns early when `Id == _loadedId` (`:66-69`) so a re-render with the same route parameter does not refetch; it parses the route string to the typed id via `Id.Parse<ConferenceCategoryIdentifierType>()` (`:76`, the culture-invariant `DomainHelper.Parse`) and calls `GetByIdAsync`.
  - **Edit as a local snapshot.** `StartEditing` (`:97`) copies the loaded values into `_edit*` fields and flips `_isEditing`; `SaveChangesAsync` (`:117`) validates the form, sends an update carrying `RowVersion` for optimistic concurrency (`:134`), then reloads. `CancelEditing` (`:111`) simply drops the snapshot. `[Rubric §19, State Management]`.
  - **Disposal-scoped cancellation.** The same `_cts` + `Dispose` pattern as the create pages (`:304-326`), with `OperationCanceledException` swallowed throughout.
- **Walkthrough, nested CategoryItem CRUD.** Beyond the category itself, the page manages child items with their own state block (`ConferenceCategoryDetail.razor.cs:53-62`): `AddItemAsync` (`:195`) validates the item form and posts a `CategoryItemDTO` with `CategoryId = Category.Id`; `UpdateItemAsync` (`:242`) edits an item selected by `_editingItemId`; `DeleteItemAsync` (`:278`) confirms then removes. After every child mutation it re-reads the parent via `CategoryService.GetByIdAsync(..., includeChildren: true)` (e.g. `:214,260,289`) so the rendered item list reflects the server truth rather than an optimistic local edit.
- **Why it's built this way**: reloading the aggregate after each child change trades a little chattiness for correctness: the category's item collection always matches persisted state, which matters because sort order and server-assigned ids come back from the service.
- **Where it's used**: the category detail route; reached from [`ConferenceCategoryList`](#conferencecategorylist) and [`ConferenceCategoryCreate`](#conferencecategorycreate). Sibling detail pages [`EventDetail`](#eventdetail), [`PublicEventDetail`](#publiceventdetail), and [`PublicSpeakerDetail`](#publicspeakerdetail) follow this pattern.

---

### EventDetail
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Event` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Event/EventDetail.razor.cs:15` · Level 6 · class (partial component)

- **What it is**: the organizer event detail page: inline edit of all event fields, publish/unpublish, and a Sessionize import refresh, over a loaded [`EventDTO`](group-17-conference-domain.md#eventdto).
- **Depends on**: [`EventDTO`](group-17-conference-domain.md#eventdto), [`IEventUIService`](#ieventuiservice), [`ConferenceRoutePaths`](#conferenceroutepaths); `DeleteConfirmation`, MMCA.Common's `Parse<T>`, and the `RefreshFromSessionizeResultDTO` returned by the import.
- **Concept**: the detail-page pattern taught at [`ConferenceCategoryDetail`](#conferencecategorydetail): `_loadedId`-guarded load (`EventDetail.razor.cs:72-82`), `_edit*` snapshot edit with `RowVersion`-carrying updates (`:141-200`), disposal-scoped `_cts`. Its extra behaviors:
  - **Publish / unpublish.** `PublishAsync` (`EventDetail.razor.cs:202`) and `UnpublishAsync` (`:230`) call the service and reload, gating an event's public visibility. This is the write side of the [`PublicEventList`](#publiceventlist)/BR-108 published-only read filter. `[Rubric §11, Security]`.
  - **Sessionize refresh.** `RefreshFromSessionizeAsync` (`:258`) first persists a changed Sessionize code, then calls `EventService.RefreshFromSessionizeAsync` and stores the `RefreshFromSessionizeResultDTO` for the summary UI (`:292`).
  - **Moderation default.** Editing round-trips `QuestionModerationDefault` (`:130,178`), the event-level default for whether live audience questions start moderated.
- **Where it's used**: the organizer event detail route.

---

### PublicEventDetail
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicEventDetail.razor.cs:14` · Level 6 · class (partial component)

- **What it is**: the read-only public event page: venue info, rooms, Wi-Fi, directions, and a best-effort "how far is the venue" distance hint.
- **Depends on**: [`EventDTO`](group-17-conference-domain.md#eventdto), [`IEventUIService`](#ieventuiservice), [`ConferenceRoutePaths`](#conferenceroutepaths); the device-capability services [`IClipboardService`](group-26-device-capability-layer.md#iclipboardservice), [`IMapNavigationService`](group-26-device-capability-layer.md#imapnavigationservice), [`IGeolocationService`](group-26-device-capability-layer.md#igeolocationservice), and [`IGeocodingService`](group-26-device-capability-layer.md#igeocodingservice); `IConfiguration` for support contact.
- **Concept**: the read-only detail-page pattern (load-by-id, no edit) plus first-class use of the device-capability layer. `[Rubric §23, Front-End Performance]`/`[Rubric §29, Resilience & Business Continuity]`: `TryComputeDistanceAsync` (`PublicEventDetail.razor.cs:134`) is a strictly best-effort hint (ADR-042 Wave 3): it short-circuits when geolocation or geocoding is unsupported or the venue address is blank (`:136-139`), and every failure path (no support, permission denied, geocoder offline) just leaves the hint off, it must never block the page.
- **Walkthrough**: `LoadEventAsync` (`PublicEventDetail.razor.cs:65`) loads the event then calls `TryComputeDistanceAsync`; `CopyWifiAsync` (`:101`) copies Wi-Fi via [`IClipboardService`](group-26-device-capability-layer.md#iclipboardservice); `OpenDirectionsAsync` (`:114`) launches the platform maps app on native heads or a maps site in a browser via [`IMapNavigationService`](group-26-device-capability-layer.md#imapnavigationservice); the distance math geocodes the address, reads a soft device location, and converts kilometers to miles with the `0.621371` factor (`:153-154`).
- **Where it's used**: the public event detail route; reached from [`PublicEventList`](#publiceventlist).

---

### PublicSpeakerDetail
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSpeakerDetail.razor.cs:14` · Level 6 · class (partial component)

- **What it is**: the read-only public speaker profile: bio, social links, and the speaker's sessions. Email is deliberately not shown (BR-66, PII).
- **Depends on**: [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`ISpeakerUIService`](#ispeakeruiservice), [`ISessionUIService`](#isessionuiservice), [`ConferenceRoutePaths`](#conferenceroutepaths), MMCA.Common's `Parse<T>`.
- **Concept**: the read-only detail-page pattern ([`ConferenceCategoryDetail`](#conferencecategorydetail)) with a privacy note. `[Rubric §11, Security]` / `[Rubric §30, Compliance, Privacy & Data Governance]`: the page renders a public content profile and omits the speaker's email entirely (doc comment `PublicSpeakerDetail.razor.cs:12`), matching the guidance that a public speaker profile is not treated as data-subject PII while the email still is.
- **Walkthrough**: `LoadSpeakerAsync` (`PublicSpeakerDetail.razor.cs:62`) parses the id and loads the speaker, then `LoadSpeakerSessionsAsync` (`:91`) fetches all sessions and filters to those whose `SessionSpeakers` include this speaker, ordered by `StartsAt` (`:94-97`). `HasSocialLinks` (`:45`) drives whether the social block renders.
- **Where it's used**: the public speaker detail route; reached from [`PublicSpeakerList`](#publicspeakerlist), and its session links go to [`PublicSessionDetail`](#publicsessiondetail).

---

### PublicSessionDetail
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionDetail.razor.cs:20` · Level 7 · class (partial component)

- **What it is**: the read-only public session page: speakers, categories, room wayfinding, an inline bookmark toggle and feedback link for authenticated users, a Live button when the live layer is active, and a text-to-speech "listen" action.
- **Depends on**: [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`RoomDTO`](group-17-conference-domain.md#roomdto), [`ISessionUIService`](#isessionuiservice), [`ISpeakerLookupService`](#ispeakerlookupservice), [`IRoomUIService`](#iroomuiservice), [`ICategoryItemLookupService`](#icategoryitemlookupservice), [`ISessionBookmarkUIService`](group-22-engagement-module.md#isessionbookmarkuiservice) (optional), [`ISessionLiveUIService`](group-23-engagement-live-layer.md#isessionliveuiservice) (optional); [`IHapticFeedbackService`](group-26-device-capability-layer.md#ihapticfeedbackservice) and [`ITextToSpeechService`](group-26-device-capability-layer.md#itexttospeechservice).
- **Concept introduced, optionally-registered cross-module services resolved via `GetService`.** `[Rubric §7, Microservices Readiness]` (assesses that a module degrades cleanly when a peer module is absent). Blazor's `[Inject]` has no optional mode: an unregistered service throws at render. So the two Engagement-owned dependencies are resolved manually in `OnInitialized` (`PublicSessionDetail.razor.cs:52-53`) via `ServiceProvider.GetService<T>()`, leaving `BookmarkService` and `SessionLive` null when the Engagement module is disabled. Every call site null-checks them (`CanBookmark` context, `ToggleBookmarkAsync` at `:181`), so the same page renders with or without the live/bookmark features, this is how the Conference UI stays runnable when only the Conference service is deployed.
- **Walkthrough**: `LoadSessionAsync` (`PublicSessionDetail.razor.cs:92`) loads the session, then resolves display data through the lookup services: `ResolveSpeakerNamesAsync` (`:124`), `ResolveCategoryNamesAsync` (`:132`, formatting `CategoryTitle: Name`), `ResolveRoomAsync` (`:144`, only when `RoomId.HasValue`, BR-94 wayfinding), and `LoadBookmarkStateAsync` (`:156`, reading the `user_id` claim). `ToggleBookmarkAsync` (`:179`) mirrors the view component's guarded add/remove with haptic feedback. `ToggleListenAsync` (`:226`) reads the description aloud via [`ITextToSpeechService`](group-26-device-capability-layer.md#itexttospeechservice) and the same button stops it. `IsStatusIneligible` (`:77`) hides bookmarking for Declined/Cancelled sessions.
- **Where it's used**: the public session detail route; reached from [`PublicSessionList`](#publicsessionlist), [`PublicSessionListView`](#publicsessionlistview) cards, and [`PublicSpeakerDetail`](#publicspeakerdetail).

---

### PublicSpeakerList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSpeakerList.razor.cs:23` · Level 7 · class (partial component)

- **What it is**: the public speaker browse page. It extends [`DataGridListPageBase<SpeakerDTO>`](group-15-common-ui-framework.md#datagridlistpagebasetdto) and adds a role-aware event filter: non-organizers are auto-locked to the current/next event's speakers, organizers get a clearable picker.
- **Depends on**: [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), [`ISpeakerUIService`](#ispeakeruiservice), [`IEventLookupService`](#ieventlookupservice), [`EventInfo`](#eventinfo), [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector), [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem), [`ConferenceRoutePaths`](#conferenceroutepaths), and `AuthenticationState`.
- **Concept introduced, role-gated default filter with a race-safe load.** `[Rubric §11, Security]` and `[Rubric §19, State Management]`. Two ideas:
  - **Organizer vs attendee filter policy.** `ResolveDefaultEventFilter` (`PublicSpeakerList.razor.cs:110`) lets an organizer keep a restored, still-existing event id but forces every non-organizer onto the computed current/next event via [`CurrentEventSelector.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventselector) (`:122-129`). `SaveFilters` only persists the event choice for organizers (`:49-53`), so a shared organizer URL can never pin an attendee to a different or unpublished event; the attendee's `/events` fetch is published-only server-side regardless.
  - **Load before first fetch.** `OnInitializedAsync` starts `_eventsLoadTask` before any await (`:75-81`) and both `LoadServerData` (`:165`) and `FetchMobilePage` (`:189`) await that same task before applying filters, so the grid's first `ServerData` call cannot race ahead of the resolved default event.
- **Walkthrough**: the event filter travels as a virtual `EventId` filter key (`ApplyFilters`, `PublicSpeakerList.razor.cs:180-186`) resolved server-side through the EventSpeaker/SessionSpeaker joins (a Speaker has no `EventId` column, doc comment `:18-20`). `OnEventFilterChanged` (`:151`) and `OnSearchChanged` (`:138`) reload the active layout.
- **Where it's used**: the public speakers route; cards navigate to [`PublicSpeakerDetail`](#publicspeakerdetail).

---

### PublicSessionList
> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Public` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionList.razor.cs:26` · Level 8 · class (partial component)

- **What it is**: the richest page in the group and the primary attendee entry point: a unified public session browser with event filtering, speaker/room lookups, inline bookmark stars, an All Sessions / My Schedule toggle, a mobile card layout, and an offline snapshot. It is the container in a container/presentational split, delegating rendering to [`PublicSessionListView`](#publicsessionlistview) and [`PublicSessionListFilterBar`](#publicsessionlistfilterbar).
- **Depends on**: [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto), [`SessionDTO`](group-17-conference-domain.md#sessiondto), [`EventDTO`](group-17-conference-domain.md#eventdto), [`ISessionUIService`](#isessionuiservice), [`IEventUIService`](#ieventuiservice), [`ISpeakerLookupService`](#ispeakerlookupservice), [`SpeakerInfo`](#speakerinfo), [`ISessionBookmarkUIService`](group-22-engagement-module.md#isessionbookmarkuiservice) (optional), [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore), [`IConnectivityStatusService`](group-26-device-capability-layer.md#iconnectivitystatusservice), [`CurrentEventDefaults`](group-17-conference-domain.md#currenteventdefaults), [`CachedSessionPage`](#cachedsessionpage), and `AuthenticationState`.
- **Concept, a container coordinating state, races, degradation, and offline.** `[Rubric §18, UI Architecture]`, `[Rubric §19, State Management]`, `[Rubric §23, Front-End Performance]`, `[Rubric §7, Microservices Readiness]`. This page pulls together every pattern the group teaches:
  - **Container/presentational.** It owns all filter/paging/bookmark state and passes it to the two child components; `GridRef` forwards the child view's grid (`PublicSessionList.razor.cs:71`) so the base's paging restoration still works.
  - **Optional Engagement bookmark service.** `BookmarkService` resolves via `ServiceProvider.GetService` (`:115`) and stays null when Engagement is disabled (same rationale as [`PublicSessionDetail`](#publicsessiondetail)).
  - **Race-safe eager loads.** `OnInitializedAsync` kicks off `_bookmarkLoadTask` and `_eventsLoadTask` before its first await (`:129,133`); `FetchSessionsAsync` re-awaits `_bookmarkLoadTask` (`:279-282`) so the grid's first `ServerData` call, which can run before init finishes (notably on in-app back-navigation), never evaluates the "My Schedule" branch against half-initialized auth state.
  - **My Schedule via client-side filter.** In My Schedule mode it fetches a large page (`pageSize: 500`) and filters to bookmarked sessions client-side (`:287-308`), because a user typically bookmarks fewer than 50, then pages the result in memory.
  - **Offline snapshot.** On a successful page-1 fetch it stores a [`CachedSessionPage`](#cachedsessionpage) (`:320-324`); when a fetch throws while `!Connectivity.IsOnline` it replays that snapshot and sets `_showingCachedData` (`:329-339`).
- **Walkthrough**: `RestoreFilters`/`SaveFilters` (`PublicSessionList.razor.cs:74-111`) persist search, My Schedule, and (organizers only) the event id; `LoadEventsAndResolveDefaultAsync` (`:143`) loads events, builds the room-name and speaker lookups, and resolves the default event via [`CurrentEventDefaults.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventdefaults) (`:194`); `ResolveDefaultEventFilter` (`:181`) applies the same organizer-vs-attendee policy as [`PublicSpeakerList`](#publicspeakerlist). The `Mine` deep-link query (`:66-67`, `/conference/sessions?mine=true`) beats saved state so the MAUI home-screen quick action lands straight in My Schedule (`:118-121`). `ApplyAdditionalFilters` (`:348`) adds the `Title` and `EventId` filter keys.
- **Why it's built this way**: the offline snapshot, client-side My Schedule filter, and optional bookmark service all target one reality: conference day, on a saturated venue network, where the schedule is the app. Each mechanism fails soft (cached data, no stars, no live layer) rather than blanking the page.
- **Where it's used**: the public sessions route, the attendee's main landing page; hands rendering to [`PublicSessionListView`](#publicsessionlistview) and [`PublicSessionListFilterBar`](#publicsessionlistfilterbar) and navigates to [`PublicSessionDetail`](#publicsessiondetail).

### OrganizerEventFeedback, OrganizerSessionFeedback

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Feedback` · Level 5 · classes (Blazor code-behind)

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `OrganizerEventFeedback` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerEventFeedback.razor.cs:16` | Keyed by `EventId`; loads the event name from the event lookup; reads `EventQuestionAnswerDTO`s. |
| `OrganizerSessionFeedback` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerSessionFeedback.razor.cs:15` | Keyed by `SessionId`; loads the session title from `ISessionUIService`; reads `SessionQuestionAnswerDTO`s. |

- **What they are**: the organizer-only moderation views for conference *feedback*. Each page loads
  every feedback answer for one entity (an event or a session), groups them by question, and lets the
  organizer delete an individual answer for moderation (BR-53). These are read-and-moderate pages, not
  editors: there is no create or inline-edit path.
- **Depends on**: [`IOrganizerEventFeedbackUIService`](#iorganizereventfeedbackuiservice) /
  [`IOrganizerSessionFeedbackUIService`](#iorganizersessionfeedbackuiservice) (the answer fetch/delete
  clients), [`IQuestionUIService`](#iquestionuiservice) (the question text lookup),
  [`IEventLookupService`](#ieventlookupservice) (event) or [`ISessionUIService`](#isessionuiservice)
  (session) for the heading, [`QuestionDTO`](group-17-conference-domain.md#questiondto),
  [`EventQuestionAnswerDTO`](group-17-conference-domain.md#eventquestionanswerdto) /
  [`SessionQuestionAnswerDTO`](group-17-conference-domain.md#sessionquestionanswerdto),
  [`ConferenceRoutePaths`](#conferenceroutepaths), and
  [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Id.Parse<T>` extension for the
  route-string id (`MMCA.Common.Shared.Extensions`). Externals: Blazor (`[Inject]`, `[Parameter]`),
  MudBlazor (`ISnackbar`, `BreadcrumbItem`).
- **Concept introduced, the organizer moderation read-view + cancel-on-disposal idiom.** Where the CRUD
  triad (create/list/detail, below) manages entities the organizer owns, these two pages are a *review*
  surface over user-submitted content. Both own a `CancellationTokenSource _cts`
  (`OrganizerEventFeedback.razor.cs:25`, `OrganizerSessionFeedback.razor.cs:24`) that is cancelled and
  disposed in `Dispose` (the standard cancel-on-disposal idiom, so an in-flight answer fetch cannot
  complete against a torn-down component). `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses
  deliberate handling and removal of user-generated content): the moderation delete
  (`DeleteAnswerAsync`, `OrganizerEventFeedback.razor.cs:88-104`) gives the organizer a first-class way to
  remove an inappropriate answer, then re-reads the list so the UI reflects the removal.
  `[Rubric §11, Security]`: these are organizer-scoped pages, only an organizer role reaches the
  "all answers" fetch (`GetAllAnswersAsync`) that returns every respondent's answer.
- **Walkthrough**
  - `OnInitializedAsync` (`OrganizerEventFeedback.razor.cs:37-86`) parses the route id
    (`EventId.Parse<EventIdentifierType>()`, line 48), resolves the event name from the lookup and bails to
    a `_loadError` state if the id is unknown (lines 51-60), loads the event's questions with a
    `QuestionEntity equals Event` server filter (lines 63-69), then loads *all* answers via
    `FeedbackService.GetAllAnswersAsync` (line 72). Errors set `_loadError`; the `finally` always clears
    `IsLoading`.
  - `OrganizerSessionFeedback` is the same shape keyed by session (`OrganizerSessionFeedback.razor.cs:36-83`):
    it reads the session title through `ISessionUIService.GetByIdAsync` (line 50) and filters questions by
    `QuestionEntity equals Session` (line 62).
  - `DeleteAnswerAsync` (`OrganizerEventFeedback.razor.cs:88-104`) deletes one answer by id, re-fetches the
    answer list, and snackbars the outcome; `OperationCanceledException` is swallowed as expected during
    disposal.
- **Why it's built this way**: feedback is user-generated content that an organizer needs to *see in full*
  and *prune*, not edit; a flat load-all-then-group-by-question view plus a per-answer delete is the
  minimal shape that supports that.
- **Where it's used**: organizer feedback routes reached from the event and session admin pages; they read
  the same questions authored through [`QuestionList`](#questionlist).

### QuestionCreate, RoomCreate, SessionCreate, SpeakerCreate

> MMCA.ADC.Conference.UI · Level 5 · classes (Blazor code-behind)

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `QuestionCreate` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Question/QuestionCreate.razor.cs:9` | Simplest form; int-keyed; no lookups. Client temp id via `RandomNumberGenerator.GetInt32(999_999_000, 999_999_999)`. |
| `RoomCreate` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Room/RoomCreate.razor.cs:9` | Loads the event lookup for the parent-event picker; auto-selects a sole event. Int temp id `GetInt32(100_000, int.MaxValue)`. |
| `SessionCreate` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Session/SessionCreate.razor.cs:14` | Loads event + room lookups; splits date/time into paired pickers and recombines on save. Int temp id. |
| `SpeakerCreate` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerCreate.razor.cs:13` | Widest form (bio/social); **Guid**-keyed, so it mints its real id with `Guid.NewGuid()`. |

- **What they are**: the organizer *create* leg of the Conference CRUD family: a `MudForm`-driven page per
  entity that collects fields, validates, posts a new record, and redirects to that record's detail page.
- **Depends on**: the matching UI service client ([`IQuestionUIService`](#iquestionuiservice),
  [`IRoomUIService`](#iroomuiservice), [`ISessionUIService`](#isessionuiservice),
  [`ISpeakerUIService`](#ispeakeruiservice)), the matching DTO
  ([`QuestionDTO`](group-17-conference-domain.md#questiondto),
  [`RoomDTO`](group-17-conference-domain.md#roomdto),
  [`SessionDTO`](group-17-conference-domain.md#sessiondto),
  [`SpeakerDTO`](group-17-conference-domain.md#speakerdto)),
  [`ConferenceRoutePaths`](#conferenceroutepaths), and
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages). The event-scoped forms also inject
  [`IEventLookupService`](#ieventlookupservice) (returning [`EventInfo`](#eventinfo)), and `SessionCreate`
  adds `IRoomUIService`. Externals: Blazor (`NavigationManager`, `[Inject]`), MudBlazor (`MudForm`,
  `ISnackbar`, `BreadcrumbItem`).
- **Concept introduced, the partial-class code-behind create form.** Every Conference page is split into a
  `.razor` template plus a `.razor.cs` partial that holds injected services, backing fields, and event
  handlers (the shared code-behind pattern this group's [overview](group-21-conference-ui.md) introduces).
  A create form adds three recurring mechanisms:
  1. **Cancel-on-disposal** (`IDisposable` + `CancellationTokenSource _cts`, e.g.
     `QuestionCreate.razor.cs:15,89-111`), so an in-flight save cannot resolve against a disposed component.
  2. **Validate-then-submit** (`await _form.ValidateAsync()` then an `IsValid` guard, e.g.
     `QuestionCreate.razor.cs:49-54`) with an `IsSaving` flag disabling the button during the round trip.
  3. **An unsaved-changes guard** (`_isDirty`, set by `MarkDirty()`), cleared *before* navigating on
     success (`QuestionCreate.razor.cs:69`) so the guard does not block the redirect.
  `[Rubric §24, Forms, Validation & UX Safety]` (assesses client validation, unsaved-change protection, and
  safe submits): all four forms validate before posting and track dirty state.
  `[Rubric §18, UI Architecture & Component Design]` (assesses logic separated from markup): the `.razor.cs`
  split keeps each page small and testable.
  A second concept these pages surface is the **client-minted identifier**. The int-keyed forms fabricate a
  temporary id with `RandomNumberGenerator.GetInt32(...)` before posting
  (`QuestionCreate.razor.cs:61`, `RoomCreate.razor.cs:81`, `SessionCreate.razor.cs:100`), while
  `SpeakerCreate` (Guid-keyed) mints a genuinely-unique id with `Guid.NewGuid()`
  (`SpeakerCreate.razor.cs:71`). The page always reads `created.Id` back from the server response, so it
  tolerates the server honoring or overwriting the client id. `[Rubric §8, Data Architecture]` (assesses a
  deliberate identity strategy): the per-entity identifier-type alias makes the key type
  (`int` vs `Guid`) invisible to the page logic, and the Guid entity needs no random-int workaround.
- **Walkthrough**
  - `QuestionCreate.CreateQuestionAsync` (`QuestionCreate.razor.cs:42-85`) is the baseline: validate, build a
    [`QuestionDTO`](group-17-conference-domain.md#questiondto), `AddAsync`, clear `_isDirty`, snackbar, and
    `NavigateTo(ConferenceRoutePaths.QuestionDetails(created.Id))`.
  - `RoomCreate.OnInitializedAsync` (`RoomCreate.razor.cs:35-60`) loads `_eventLookup` and auto-selects the
    only event when `Count == 1` (lines 47-50), a single-conference convenience; `CreateRoomAsync`
    (lines 62-107) builds a [`RoomDTO`](group-17-conference-domain.md#roomdto) with
    capacity/floor/location/accessibility fields.
  - `SessionCreate.OnInitializedAsync` (`SessionCreate.razor.cs:46-74`) loads the event lookup (auto-select)
    and fetches up to 500 rooms for the dropdown; `CreateSessionAsync` (lines 76-127) recombines the split
    date + time pickers into `StartsAt`/`EndsAt` **only when both parts are set** (lines 93-96), then builds
    the [`SessionDTO`](group-17-conference-domain.md#sessiondto).
  - `SpeakerCreate.CreateSpeakerAsync` (`SpeakerCreate.razor.cs:52-102`) composes `FullName` from
    first/last (line 74) and posts a [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) carrying all
    the optional profile/social fields.
- **Why it's built this way**: one create-form shape reused per entity keeps behavior uniform (validate →
  post → redirect-to-detail) while each page varies only in the fields and lookups it needs; the split
  date/time editing exists because MudBlazor has no single date-time picker, so `SessionCreate` composes two
  and recombines them safely.
- **Where it's used**: routed create pages reached from each entity's list page
  (`ConferenceRoutePaths.QuestionCreate`, `.RoomCreate`, `.SessionCreate`, `.SpeakerCreate`); each redirects
  to the matching detail page ([`QuestionDetail`](#questiondetail-roomdetail),
  [`RoomDetail`](#questiondetail-roomdetail), [`SessionDetail`](#sessiondetail),
  [`SpeakerDetail`](#speakerdetail)) on success.
- **Caveats / not-in-source**: whether the server honors or overwrites the client-minted id is a
  server-side decision not visible in these pages; they read `created.Id` from the response either way.

### QuestionList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Question` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Question/QuestionList.razor.cs:10` · Level 5 · class (Blazor code-behind)

- **What it is**: the organizer browse page for conference *questions*: a searchable, server-paged
  `MudDataGrid` with a mobile card fallback and delete-with-confirmation. It is the simplest of the
  Conference list pages (no entity filter), so it is the clearest place to teach the list-page shape the
  event-scoped lists below build on.
- **Depends on**: extends [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto)
  (the shared list scaffolding), [`IQuestionUIService`](#iquestionuiservice),
  [`QuestionDTO`](group-17-conference-domain.md#questiondto),
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages), the
  [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem)
  component, and the `DeleteConfirmation` dialog (both from `MMCA.Common.UI`). Externals: MudBlazor
  (`MudDataGrid`, `GridState`, `GridData`), Blazor (`NavigationManager`).
- **Concept introduced, the ADC list-page pattern over `DataGridListPageBase`.** The base owns
  search/pagination/sort plumbing and the **filter-persistence** contract; a concrete list page is a thin
  override that supplies four things:
  1. `Title` / `GridRef` overrides so the base can drive the grid (`QuestionList.razor.cs:13,19`).
  2. `SaveFilters`/`RestoreFilters` (lines 24-28), which serialize the search box so it survives navigation.
  3. A `LoadServerData` delegate (lines 43-52) that calls the base's `LoadServerDataAsync`, translating the
     search string into a server filter (`filters["QuestionText"] = ("contains", _searchString)`).
  4. A parallel mobile path, `FetchMobilePage` (lines 55-61), that feeds the infinite-scroll list.
  `[Rubric §22, Responsive & Cross-Browser]` (assesses one experience across viewports): the same data-load
  contract backs both a desktop `MudDataGrid` and a mobile card list, switched on `IsMobile`.
  `[Rubric §23, Front-End Performance & Rendering]`: paging and filtering are pushed server-side, so the grid
  never materializes the full table client-side. `[Rubric §25, Navigation & Information Architecture]`:
  persisted filters mean a back-navigation returns the organizer to the same search.
- **Walkthrough**
  - `OnSearchChanged` (lines 30-41) updates `_searchString` then reloads through the grid or the
    infinite-scroll list depending on `IsMobile`.
  - `LoadServerData` (lines 43-52) delegates to `LoadServerDataAsync`, passing the paged fetch delegate and a
    filter-builder that only adds the `QuestionText contains` filter when the search box is non-empty.
  - `DeleteQuestionAsync` (lines 67-96) confirms via the `DeleteConfirmation` dialog (`_deleteConfirm`),
    deletes by id, and reloads; `NavigateToCreate`/`OnMobileCardClick` route to the create and detail pages.
- **Why it's built this way**: pushing search, paging, and filter persistence into the shared base means
  each list page is a thin, consistent override; the mobile and desktop paths share one fetch delegate.
- **Where it's used**: the organizer questions route; its rows and create button reach
  [`QuestionDetail`](#questiondetail-roomdetail) and `QuestionCreate` (above). The same list-page shape
  recurs in [`RoomList`/`SpeakerList`](#roomlist-speakerlist) and [`SessionList`](#sessionlist), which add an
  event filter on top.

### QuestionDetail, RoomDetail

> MMCA.ADC.Conference.UI · Level 6 · classes (Blazor code-behind)

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `QuestionDetail` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Question/QuestionDetail.razor.cs:11` | Update DTO carries the original `RowVersion` (line 124), so a stale concurrent edit is rejected. |
| `RoomDetail` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Room/RoomDetail.razor.cs:12` | Resolves the parent event name from a lookup; its update DTO does **not** include `RowVersion` (lines 136-146). |

- **What they are**: the *detail* leg of the CRUD triad: each loads one record by route id, displays it,
  and supports inline edit and delete. Same shape, different fields.
- **Depends on**: [`IQuestionUIService`](#iquestionuiservice) / [`IRoomUIService`](#iroomuiservice), the
  matching DTO ([`QuestionDTO`](group-17-conference-domain.md#questiondto) /
  [`RoomDTO`](group-17-conference-domain.md#roomdto)),
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages), the `DeleteConfirmation` component, and
  [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Id.Parse<T>` for the route-string id;
  `RoomDetail` also injects [`IEventLookupService`](#ieventlookupservice) (returning
  [`EventInfo`](#eventinfo)) for the event-name display.
- **Concept introduced, route-id parsing, load-once-on-parameters, and inline edit with shadow fields.**
  The id arrives as a `[Parameter] string Id` (a route value). `OnParametersSetAsync` guards re-loads with a
  `_loadedId` comparison (`QuestionDetail.razor.cs:52-57`) so re-renders do not refetch, and parses the
  string to the typed id with `Id.Parse<QuestionIdentifierType>()` (line 63). Edit state is held in `_edit*`
  **shadow fields** seeded by `StartEditing` (lines 84-96) and discarded by `CancelEditing`, so a cancel
  cleanly reverts. `[Rubric §24, Forms, Validation & UX Safety]`: the shadow-field pattern means the live
  record is never mutated until a validated save succeeds. The two pages differ in one important respect:
  `QuestionDetail`'s update DTO re-sends the original `RowVersion` (`QuestionDetail.razor.cs:118,124`), the
  client half of the optimistic-concurrency token, so the server can reject a stale concurrent edit
  (`[Rubric §8, Data Architecture]`, concurrency control); `RoomDetail`'s update DTO
  (`RoomDetail.razor.cs:136-146`) omits `RowVersion`, so a room update is a last-writer-wins overwrite.
- **Walkthrough**
  - Load: `OnParametersSetAsync` → parse id → `GetByIdAsync` → `NotFound` snackbar if missing
    (`QuestionDetail.razor.cs:52-82`; `RoomDetail.razor.cs:58-91`, which additionally lazy-loads the event
    lookup with `_events ??= ...` and resolves names via `GetEventName`, lines 93-94).
  - Save: `SaveChangesAsync` validates, rebuilds the DTO from the `_edit*` fields, calls `UpdateAsync`,
    re-fetches, and snackbars (`QuestionDetail.razor.cs:104-149`; `RoomDetail.razor.cs:119-165`).
  - Delete: confirm via `_deleteConfirm`, then delete and navigate back to the list
    (`QuestionDetail.razor.cs:151-180`; `RoomDetail.razor.cs:167-196`). Note `RoomDetail` deletes with the
    room id and the cancellation token (`RoomService.DeleteAsync(Room.Id, _cts.Token)`, line 182), whereas
    [`RoomList`](#roomlist-speakerlist) deletes with the room id *and* its parent `EventId`.
- **Why it's built this way**: one detail-page shape (load → display → inline-edit → save → delete-with-confirm)
  reused per entity keeps behavior uniform and per-page code minimal.
- **Where it's used**: reached from the matching list pages and from create-page redirects.
- **Caveats / not-in-source**: the `RowVersion` omission in `RoomDetail`'s update is what the source shows;
  whether the room API enforces concurrency by another means is a server-side concern not visible here.

### SpeakerCategoryItemsPanel

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerCategoryItemsPanel.razor.cs:16` · Level 6 · class (Blazor code-behind)

- **What it is**: the presentational "Additional Info" panel extracted out of
  [`SpeakerDetail`](#speakerdetail): it renders a speaker's category items grouped by category and hosts the
  add/remove chip actions. The parent page keeps ownership of the speaker and the lookups; this panel calls
  the child-entity service directly and raises a callback so the page reloads.
- **Depends on**: [`ISpeakerCategoryItemUIService`](#ispeakercategoryitemuiservice) (the join-entity
  add/remove client), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto),
  [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto),
  [`CategoryItemInfo`](#categoryiteminfo), and the `CategoryItem`/`ConferenceCategory`/`SpeakerCategoryItem`
  identifier aliases. Externals: Blazor (`[Parameter]`, `EventCallback`), MudBlazor (`ISnackbar`).
- **Concept introduced, the container/presentational component split with `EventCallback`.** Rather than let
  the already-large `SpeakerDetail` own this whole sub-view, the panel is a **presentational** child: the
  page (the **container**) passes it the `Speaker` plus the `CategoryItems` and `CategoryTitles` lookups as
  `[Parameter]`s (`SpeakerCategoryItemsPanel.razor.cs:22-28`), and the panel signals state changes back up
  through the `Changed` `EventCallback` (line 31). After an add or remove, the panel calls
  `await Changed.InvokeAsync()` (lines 73,87) so the page reloads the speaker, exactly as it did before the
  split. `[Rubric §18, UI Architecture & Component Design]` (assesses cohesive, single-responsibility
  components): the split trims the parent page and gives the category-item sub-view one clear job.
  `[Rubric §19, State Management & Data Flow]` (assesses where state lives and how it flows): the panel holds
  no source-of-truth state (only the transient `_selectedCategoryItemId`); the speaker and lookups flow down
  as parameters, and mutations flow up via the callback, the canonical unidirectional Blazor data flow.
- **Walkthrough**
  - `GetCategoryItemsGroupedByCategory` (lines 42-50) groups the speaker's assigned items by their parent
    category id for display; `GetAvailableCategoryItems` (lines 52-59) excludes already-assigned items from
    the add dropdown. `GetCategoryTitle`/`GetCategoryItemName` (lines 36-40) resolve ids to display names
    with an invariant-culture id fallback.
  - `AddCategoryItemAsync` (lines 61-79) posts the selected item via the service, clears the selection,
    snackbars, and invokes `Changed`; `RemoveCategoryItemAsync` (lines 81-93) deletes by the join id and
    invokes `Changed`. The panel owns its own `CancellationTokenSource` cancelled in `Dispose`.
- **Why it's built this way**: the speaker editor grew large enough that carving the category-item view into
  a self-contained presentational component (owning the service call, delegating state to the page) both
  shrinks the parent and makes the sub-view independently testable, without changing observable behavior.
- **Where it's used**: rendered inside [`SpeakerDetail`](#speakerdetail), which supplies its parameters and
  handles the `Changed` callback by reloading the speaker.

### SpeakerDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerDetail.razor.cs:22` · Level 6 · class (Blazor code-behind)

- **What it is**: the organizer's full speaker editor and one of the most heavily-wired Conference UI
  pages. Beyond load/edit/delete it composes the speaker's category-item panel, displays question-answer
  text and the speaker's sessions, and runs the **link/unlink a User to this Speaker** flow.
- **Depends on**: [`ISpeakerUIService`](#ispeakeruiservice), [`ISessionUIService`](#isessionuiservice),
  [`IConferenceCategoryUIService`](#iconferencecategoryuiservice),
  [`ICategoryItemLookupService`](#icategoryitemlookupservice), [`IQuestionUIService`](#iquestionuiservice),
  and [`IUserUIService`](group-24-identity-module.md#iuseruiservice) (the Identity client);
  [`SpeakerDTO`](group-17-conference-domain.md#speakerdto),
  [`SessionDTO`](group-17-conference-domain.md#sessiondto),
  [`UserListDTO`](group-24-identity-module.md#userlistdto), [`CategoryItemInfo`](#categoryiteminfo),
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages). It hosts the
  [`SpeakerCategoryItemsPanel`](#speakercategoryitemspanel) child (passing it the lookups it owns), and uses
  the `Speaker`/`CategoryItem`/`ConferenceCategory`/`Question`/`Session` aliases. This is the only Conference
  UI page in this unit that reaches into the Identity module.
- **Concept introduced, the cross-module composition page.** A single page composes data from multiple module
  clients (Conference *and* Identity) plus several lookup caches resolved into display names.
  `[Rubric §7, Microservices Readiness]` (assesses that cross-module access goes through abstractions, not
  direct references): the Identity reach is via [`IUserUIService`](group-24-identity-module.md#iuseruiservice),
  an interface HTTP client, not a domain reference, so the UI tolerates Identity being an extracted service.
  `[Rubric §18, UI Architecture & Component Design]` (a high dependency count is a cohesion smell to watch):
  this page delegates the category-item sub-view to [`SpeakerCategoryItemsPanel`](#speakercategoryitemspanel)
  and holds the rest, its remaining size comes from orchestrating six service clients and three lookups.
- **Walkthrough**
  - `LoadAsync` (lines 91-121): `GetByIdAsync(speakerId, true, ...)` (children included), then lazily hydrate
    three lookups, category items (`_categoryItems`, line 104), category titles
    (`LoadCategoryTitlesAsync`, lines 132-137), and question texts (`LoadQuestionTextsAsync`, lines 139-144),
    and load the speaker's sessions (`LoadSpeakerSessionsAsync`, lines 123-130, filtered to sessions where
    the speaker presents). The category-item lookups are then handed to the child panel as parameters.
  - Standard edit/delete (lines 149-258) mirror the other detail pages, preserving `RowVersion` and
    `LinkedUserId` on update (lines 196,208) so a profile edit can't clear the org-managed link.
  - **User link/unlink** (lines 260-339): `SearchUsersAsync` (lines 261-293) is notable, because
    `GetPagedAsync` ANDs its filters server-side (in-code comment, lines 270-272), so a single call with
    email + firstName + lastName all set would return the *empty intersection*. The page instead **fans out
    three parallel calls** and unions the results by `UserId` with `DistinctBy` (lines 273-287).
    `OnUserPickedAsync` calls `LinkUserAsync`; `UnlinkUserAsync` calls `UnlinkUserAsync`, the flow that
    sets/clears the link consumed by [`SpeakerDashboard`](#speakerdashboard).
- **Why it's built this way**: the organizer needs a single console to fully administer a speaker, including
  wiring them to a login account; composing the views here (and delegating the category panel) trades page
  breadth for a one-stop editor. The three-call user search is a deliberate workaround for AND-only server
  filtering.
- **Where it's used**: the organizer speaker-admin route; the link flow feeds the
  [`SpeakerDashboard`](#speakerdashboard) self-service view, and it hosts
  [`SpeakerCategoryItemsPanel`](#speakercategoryitemspanel).
- **Caveats / not-in-source**: the AND-only behavior of `GetPagedAsync` is asserted by the in-code comment
  (lines 270-272); the server-side filter semantics live in the Identity API, not this page.

### RoomList, SpeakerList

> MMCA.ADC.Conference.UI · Level 7 · classes (Blazor code-behind)

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `RoomList` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Room/RoomList.razor.cs:11` | `EventId` is a real column filter; enriches each row with its event name; delete passes `Id` + `EventId`. |
| `SpeakerList` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerList.razor.cs:18` | `EventId` is a **virtual** filter the speakers/paged endpoint resolves through the EventSpeaker/SessionSpeaker joins (a Speaker has no `EventId` column); delete passes a single id. |
| `CurrentEventSelector` (used) | `group-17-conference-domain.md#currenteventselector` | Resolves the default (current or next) event filter from the event lookup. |

- **What they are**: the event-scoped list pages for *rooms* and *speakers*. Both build on the
  [`QuestionList`](#questionlist) list-page shape and add an **event filter** with a computed default, so an
  organizer lands on the current conference's records by default.
- **Depends on**: extend [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto);
  [`IRoomUIService`](#iroomuiservice) / [`ISpeakerUIService`](#ispeakeruiservice),
  [`IEventLookupService`](#ieventlookupservice) (returning [`EventInfo`](#eventinfo)),
  [`RoomDTO`](group-17-conference-domain.md#roomdto) / [`SpeakerDTO`](group-17-conference-domain.md#speakerdto),
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages),
  [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector), the
  [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem) and
  `DeleteConfirmation` components, and the `EventIdentifierType` alias.
- **Concept introduced, the default event filter with a startup race guard.** These pages add three things
  on top of the base list shape:
  1. A **persisted event filter** with an `"all"` sentinel (`RoomList.razor.cs:30-57`,
     `SpeakerList.razor.cs:37-64`): the sentinel distinguishes an explicit "show all events" from *no saved
     state* (which applies the computed default).
  2. A **computed default** via [`CurrentEventSelector.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventselector)
     (`RoomList.razor.cs:81-99`, `SpeakerList.razor.cs:88-106`): a restored id that still exists wins; a
     dangling one falls back to the current-or-next event rather than showing an empty grid.
  3. A **startup race guard**: `OnInitializedAsync` starts `_eventsLoadTask` *before* the first `await`, and
     both `LoadServerData` and `FetchMobilePage` `await _eventsLoadTask` before applying filters
     (`RoomList.razor.cs:59-65,131-137`, `SpeakerList.razor.cs:66-72,135-140`), because the `MudDataGrid`'s
     first `ServerData` call can race ahead of `OnInitializedAsync` completing, so the default filter must be
     resolved before the first fetch's `ApplyFilters` runs.
  `[Rubric §19, State Management & Data Flow]` (assesses deliberate view-state resolution): filter state is
  restored, defaulted, and reconciled against the live event set in one place.
  `[Rubric §23, Front-End Performance & Rendering]`: the event lookup is loaded once and reused; enrichment
  is a local dictionary lookup, not a per-row fetch. `[Rubric §25, Navigation & Information Architecture]`:
  persisted filters plus a sensible default keep the organizer oriented across navigations.
- **Walkthrough**
  - `RoomList.ApplyFilters` (`RoomList.razor.cs:145-151`) emits `Name contains` and `EventId equals` server
    filters; `GetEventName` (lines 101-102) resolves each row's event id to a name with an id fallback;
    `DeleteRoomAsync` (lines 168-197) passes both `room.Id` and `room.EventId` to the delete, the
    child-entity delete signature.
  - `SpeakerList.ApplyFilters` (`SpeakerList.razor.cs:149-155`) emits `FullName contains` and the virtual
    `EventId equals` filter (the class doc, lines 12-17, explains the endpoint resolves it through the
    speaker joins since a Speaker has no `EventId` column); `DeleteSpeakerAsync` (lines 171-200) deletes a
    speaker by its single id (a top-level entity, no parent id).
- **Why it's built this way**: rooms and speakers are both viewed per conference, so both default to the
  current/next event; the race guard exists specifically because MudDataGrid's first server fetch can beat
  component initialization, which would otherwise fetch an unfiltered (or empty) first page.
- **Where it's used**: the organizer room- and speaker-admin routes; rows and create buttons reach
  [`RoomDetail`](#questiondetail-roomdetail) / [`SpeakerDetail`](#speakerdetail) and the create pages.
- **Caveats / not-in-source**: the speakers/paged endpoint's join-based resolution of the virtual `EventId`
  filter is asserted by the class doc comment; the resolution itself lives in the Conference API, not this
  page.

### SessionDetail

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Session` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Session/SessionDetail.razor.cs:17` · Level 7 · class (Blazor code-behind)

- **What it is**: the organizer's full **session editor**: load / inline-edit / delete a session, plus
  manage its speakers and its category items, resolving event / room / speaker / category names from
  lookups. It is the join-heaviest detail page, managing two child-collection (join) entities from one page.
- **Depends on**: [`ISessionUIService`](#isessionuiservice), [`IEventLookupService`](#ieventlookupservice),
  [`ISpeakerLookupService`](#ispeakerlookupservice), [`ICategoryItemLookupService`](#icategoryitemlookupservice),
  [`ISessionSpeakerUIService`](#isessionspeakeruiservice),
  [`ISessionCategoryItemUIService`](#isessioncategoryitemuiservice), [`IRoomUIService`](#iroomuiservice);
  [`SessionDTO`](group-17-conference-domain.md#sessiondto),
  [`RoomDTO`](group-17-conference-domain.md#roomdto), [`EventInfo`](#eventinfo),
  [`SpeakerInfo`](#speakerinfo), [`CategoryItemInfo`](#categoryiteminfo),
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages), the `DeleteConfirmation` component, and
  [`DomainHelper`](group-02-domain-building-blocks.md#domainhelper)'s `Id.Parse<T>`. Uses the
  `Event`/`Room`/`Speaker`/`Session`/`SessionSpeaker`/`SessionCategoryItem`/`CategoryItem` aliases.
- **Concept introduced, managing two join collections from one detail page.** Where
  [`SpeakerDetail`](#speakerdetail) delegates its one join to a panel, `SessionDetail` manages **two** joins
  inline, session↔speaker and session↔category-item, each with its own add/remove pair and "available
  items" filter (`GetAvailableSpeakers` lines 265-272, `GetAvailableCategoryItems` lines 274-281). It reuses
  the same `_edit*`-shadow-fields + `StartEditing`/`SaveChangesAsync` shape as every detail page (including
  the split date/time recombination, lines 195-198, and the preserved `RowVersion`, line 203), so its size
  comes from breadth (more collections and lookups) rather than bespoke mechanics.
  `[Rubric §18, UI Architecture & Component Design]`: the repeated add/remove/available triple is the same
  pattern applied twice, not two new ones. `[Rubric §24, Forms, Validation & UX Safety]`: date/time is
  recombined only when both parts are set, and the update round-trips the concurrency token.
- **Walkthrough**
  - `LoadAsync` (lines 91-131): parse the id with `Id.Parse<SessionIdentifierType>()` (line 96),
    `GetByIdAsync(..., true, ...)` (children included), lazily hydrate the event / speaker / category-item
    lookups (lines 104-106), then load the event's rooms (filtered by `EventId`) into `_roomNames` +
    `_editableRooms` (lines 108-117). Name resolvers (lines 133-148) each fall back to the invariant-culture
    id.
  - Edit (lines 150-234): `StartEditing` seeds the `_edit*` fields including the split date/time pairs
    (lines 159-162); `SaveChangesAsync` recombines them (lines 195-198), rebuilds the
    [`SessionDTO`](group-17-conference-domain.md#sessiondto) **with `RowVersion`** plus
    status/accessibility/resource-link fields, updates, and re-fetches.
  - Joins: `AddSessionSpeakerAsync`/`RemoveSessionSpeakerAsync` (lines 283-315) call
    [`ISessionSpeakerUIService`](#isessionspeakeruiservice) and reload;
    `AddSessionCategoryItemAsync`/`RemoveSessionCategoryItemAsync` (lines 317-349) mirror that against
    [`ISessionCategoryItemUIService`](#isessioncategoryitemuiservice). Delete (lines 236-263) confirms then
    deletes.
- **Why it's built this way**: a session is the join-heavy aggregate of the program (speakers ×
  category-items × room × event × timing), so the organizer edits all of it in one place using the same
  reusable detail-page scaffolding, with breadth handled by repeated triples.
- **Where it's used**: reached from [`SessionList`](#sessionlist) rows, [`SpeakerDetail`](#speakerdetail)
  session links, and `SessionCreate` redirects.
- **Caveats / not-in-source**: reads use `includeChildren: true` so the join collections populate; the
  GetAll path's child population is a separate server-side concern not exercised here.

### SpeakerDashboard

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Speaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerDashboard.razor.cs:16` · Level 7 · class (Blazor code-behind)

- **What it is**: the **speaker's own** self-service dashboard (not an organizer page). It reads the linked
  speaker from the JWT `speaker_id` claim, shows that speaker's profile and their sessions (narrowed to the
  current/next event) with per-session bookmark counts and lazy-loaded per-session feedback, and lets the
  speaker edit their own bio/social profile (BR-214).
- **Depends on**: [`ISpeakerUIService`](#ispeakeruiservice),
  [`ISpeakerDashboardUIService`](#ispeakerdashboarduiservice) (sessions + bookmark counts + feedback),
  [`IEventLookupService`](#ieventlookupservice), `AuthenticationStateProvider` (Blazor auth),
  [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector),
  [`SpeakerDTO`](group-17-conference-domain.md#speakerdto),
  [`SessionDTO`](group-17-conference-domain.md#sessiondto),
  [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto), [`EventInfo`](#eventinfo). Uses
  the `Speaker`/`Session` aliases. Externals: `RendererInfo`.
- **Concept introduced, claim-driven identity scoping, prerender-safe loading, and lazy expand-on-demand.**
  Three ideas converge here:
  1. **Claim-driven scoping.** Instead of an id from the route, the page derives *who you are* from the auth
     token: `OnInitializedAsync` pulls `speaker_id` from `authState.User.FindFirst("speaker_id")` (lines
     71-77) and bails to a "not linked" state if the claim is absent. `[Rubric §11, Security]` and
     `[Rubric §26, Front-End Security]` (assess that authorization derives from trusted server-issued claims,
     not client-supplied ids): a speaker can only ever load *their own* dashboard because the id comes from
     the validated JWT, not a URL parameter.
  2. **Prerender-safe loading.** The method returns early during SSR prerender
     (`if (!RendererInfo.IsInteractive) return;`, lines 62-65), so the profile + sessions + per-session
     bookmark counts are not fetched twice per visit; the prerender pass shows the loading skeleton.
     `[Rubric §23, Front-End Performance & Rendering]`.
  3. **Lazy expand.** `ToggleFeedbackAsync` (lines 228-264) fetches a session's feedback only when its panel
     is first expanded and caches it in `_sessionFeedback`, so the page does not fan out a feedback call per
     session on first paint. `[Rubric §19, State Management & Data Flow]`.
- **Walkthrough**
  - Load (lines 51-142): read the claim → `GetByIdAsync(_speakerId, true, ...)` → read the speaker's sessions
    via `DashboardService.GetSpeakerSessionsAsync` (line 92, which the comment notes **bypasses the shared
    sessions output cache** so a just-made assignment shows immediately) → narrow to the current/next event
    resolved by `ResolveCurrentEventAsync` (lines 144-161, via
    [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector)), falling back to all
    sessions when none resolves → fetch all bookmark counts in **one batched request** via
    `DashboardService.GetSessionBookmarkCountsAsync` (lines 108-123; the in-code comment records that each
    count used to be its own cross-service hop, replaced by the batch endpoint's single grouped query); the
    count load is wrapped in its own best-effort catch so a failed count read never breaks the dashboard
    render.
  - Profile editing (lines 163-226): `StartEditingProfile` seeds `_edit*` fields; `SaveProfileAsync` rebuilds
    a [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) preserving `RowVersion`, `Email`,
    `ProfilePicture`, `FirstName`/`LastName`, and `LinkedUserId` (lines 195-206), so the self-edit cannot
    clear the org-managed fields, then re-fetches.
- **Why it's built this way**: the speaker portal is a distinct actor view; scoping by claim is the secure
  way to give a speaker exactly their own data without an authorization filter on every call, and the
  concurrent counts + prerender skip keep a cross-service-heavy page responsive.
- **Where it's used**: the speaker portal route (gated on the `speaker_id` claim, set when an organizer
  links a User to a Speaker via [`SpeakerDetail`](#speakerdetail)).
- **Caveats / not-in-source**: the output-cache bypass rationale is documented by the in-code comment
  (lines 89-91); the caching behavior itself lives in the Conference service, not this page.

### SessionList

> MMCA.ADC.Conference.UI · `MMCA.ADC.Conference.UI.Pages.Session` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Session/SessionList.razor.cs:18` · Level 8 · class (Blazor code-behind)

- **What it is**: the organizer browse page for *sessions*, the richest list in the Conference UI: it
  carries three filters (free-text search, session status, and event), enriches each row with room and
  speaker names, and color-codes the Sessionize status. It sits at the top level because it transitively
  depends on the most lookups and defaults.
- **Depends on**: extends [`DataGridListPageBase<TDto>`](group-15-common-ui-framework.md#datagridlistpagebasetdto);
  [`ISessionUIService`](#isessionuiservice), [`IEventUIService`](#ieventuiservice),
  [`ISpeakerLookupService`](#ispeakerlookupservice);
  [`SessionDTO`](group-17-conference-domain.md#sessiondto),
  [`EventDTO`](group-17-conference-domain.md#eventdto), [`SpeakerInfo`](#speakerinfo),
  [`ConferenceRoutePaths`](#conferenceroutepaths),
  [`ErrorMessages`](group-15-common-ui-framework.md#errormessages),
  [`CurrentEventDefaults`](group-17-conference-domain.md#currenteventdefaults) (the `EventDTO`-typed default
  selector), the [`MobileInfiniteScrollList<TItem>`](group-15-common-ui-framework.md#mobileinfinitescrolllisttitem)
  and `DeleteConfirmation` components, and the `Event`/`Room`/`Session`/`Speaker` aliases.
- **Concept introduced, the multi-filter enriched list.** `SessionList` layers three refinements on the
  [`RoomList`/`SpeakerList`](#roomlist-speakerlist) event-filtered shape:
  1. **A third filter**: `_searchString`, `_selectedStatus`, and `_selectedEventId` are all persisted
     together (`SaveFilters`/`RestoreFilters`, lines 41-70) and emitted as server filters by `ApplyFilters`
     (lines 223-231, `Title contains` / `Status equals` / `EventId equals`).
  2. **Enrichment from a single children-loaded fetch**: `LoadEventsAndResolveDefaultAsync` fetches events
     `includeChildren: true` and builds a room-name map (`PopulateRoomNames`, lines 121-135), while a
     separate speaker lookup backs `GetSpeakerList` (lines 137-145), so both room and speaker names render
     without per-row fetches. Its default event is resolved by
     [`CurrentEventDefaults.SelectCurrentOrNext`](group-17-conference-domain.md#currenteventdefaults) (line
     117), the `EventDTO`-typed sibling of the `EventInfo`-typed selector the room/speaker lists use.
  3. **Status color coding**: `GetStatusColor` (lines 147-156) maps the Sessionize status string
     (`Accepted`/`Waitlisted`/`Accept_Queue`/`Nominated`/`Decline_Queue`/`Declined`) to a MudBlazor `Color`.
  `[Rubric §18, UI Architecture & Component Design]`: the status filter surfaces the program-committee
  workflow inline. `[Rubric §23, Front-End Performance & Rendering]`: one children-loaded events fetch plus
  one speaker lookup replace per-row enrichment calls, and reads pass `includeChildren: true` so the row's
  speakers arrive with the page. `[Rubric §25, Navigation & Information Architecture]`: all three filters
  persist across navigation with the same `"all"`-sentinel event-default logic as the sibling lists.
- **Walkthrough**
  - `OnInitializedAsync` (lines 72-89) starts `_eventsLoadTask` before its first `await` (the startup race
    guard), loads the speaker lookup, then awaits the events task; `LoadServerData`/`FetchMobilePage` (lines
    198-221) both `await _eventsLoadTask` before applying filters so the default event filter is resolved
    first.
  - `ResolveDefaultEventFilter` (lines 107-119) keeps a restored id that still exists, else falls back to the
    computed current/next event; `OnStatusChanged`/`OnEventFilterChanged` (lines 171-196) reload the grid or
    infinite list.
  - `DeleteSessionAsync` (lines 236-265) confirms via `_deleteConfirm` then deletes by single id and reloads.
- **Why it's built this way**: sessions are the central editable entity of the program, so the list surfaces
  status and speaker context inline (color-coded) and defaults to the active conference; a single
  children-loaded events fetch keeps the enrichment cheap.
- **Where it's used**: the organizer session-admin route; rows navigate to [`SessionDetail`](#sessiondetail),
  and the create button reaches `SessionCreate`.
- **Caveats / not-in-source**: the prior guide edition noted a populator gap where the GetAll path could
  return empty `SessionSpeakers`; this page deliberately fetches events-with-children and a separate speaker
  lookup to build display names, so it does not depend on that GetAll-vs-GetById asymmetry.


---
[⬅ ADC Conference - API, gRPC Contracts & Service Host](group-20-conference-api-grpc.md)  •  [Index](00-index.md)  •  [ADC Engagement Module (Session Bookmarks) ➡](group-22-engagement-module.md)
