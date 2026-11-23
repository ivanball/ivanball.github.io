# ADR-056: Blazor Render-Mode Strategy for the Web Heads

## Status
Accepted (2026-07-28). Revised 2026-08-14: re-anchored the host, base-class and AppHost citations to
their current lines; scoped the "only `@rendermode` attributes" enumeration to the repos this ADR
governs (the workspace now also holds `InteractiveServer`-only sample and workshop heads); corrected the
list-page inheritor count from sixteen to eighteen; and narrowed the Helpdesk `MudTable` claim to its
list page. Revised 2026-08-23: re-anchored the ADC `App.razor`, `ADCHome`, AppHost and ADR-051
citations to their current lines, and set the list-page inheritor count to nineteen (thirteen in ADC,
six in Store), eighteen of them routable. Revised 2026-09-03: re-anchored the host, WASM client,
AppHost, Helpdesk, gallery, cross-ADR and E2E citations to their current lines and folders (Engagement
`CheckIns`, Conference `Public/Sessions` and `Public/Speakers`, Sales `Orders` and `ShoppingCarts`); split
the prerender-skip guard into the three reasons its pages now state and listed the pages that were
missing from it; and quoted ADR-051's invariant verbatim. Revised 2026-09-19: recounted the list-page
inheritors from source and set the count to twenty (thirteen in ADC, seven in Store), nineteen of them
routable, matching the inventory ADR-094 records. Revised 2026-10-01: split the prerender-skip guard
into four stated reasons and re-anchored the citations. Revised 2026-10-06: corrected the rationale for
skipping the prerender fetch on detail pages, recorded the framework's `UserAdminList` as a further
inheritor of the list-page base, and re-anchored the citations to current source. Revised 2026-10-07:
anchors refreshed after the v1.233.0 release. Revised 2026-10-21: the sponsor-visit and room check-in
pages now post from `OnParametersSetAsync` behind a compound guard that posts once per new scan and skips a re-render of the id last posted, the
`E2E__ForceServer` injection and its environment-variable gate now live in the shared
`WithE2eForceServer` extension that both AppHosts call, and the citations were re-anchored to current
source. Revised 2026-10-26: recorded the third anti-double-fetch mechanism (ADC's public event,
session and speaker detail pages persist their prerendered DTO through `[PersistentState]`, so the
session and speaker pages no longer skip the prerender fetch), noted that those prerender fetches carry
no prerender timeout, and re-anchored the citations to current source. Revised 2026-10-28: anchors
refreshed against current source; no decision, count or adoption changed. Revised 2026-11-12: recorded
the composed `AddMmcaBlazorWebHost` / `UseMmcaBlazorWebPipeline` web-host calls (render-mode registration
stays per head), the framework-owned `E2eRenderMode` switch both heads now call, and the page bases'
`PageToken`; re-anchored the citations in the touched bullets. Revised 2026-11-23: the ADC, Store and
Helpdesk heads now render the shared `/Error` page as static SSR (render mode `null` for a request that
does not accept interactive routing; the gallery keeps its literal `InteractiveServer`), grid and Store
page persistence is held to a per-key and a page-wide JSON byte budget, Store hand-rolls the persist
pattern on three pages rather than one, the sponsor-visit and room check-in pages post only on the
attendee's tap (the room guard keys on the check-in code too), ADC bounds its prerender events lookup,
and Helpdesk resolves its mode through a property; citations re-anchored to current source.

## Context
Both web applications are Blazor Web Apps: a static server-rendered (SSR) prerender pass produces the
first HTML, then an interactive runtime takes over, either a Blazor Server SignalR circuit or a
WebAssembly runtime downloaded into the browser. Which of those runtimes takes over, and whether the
prerender pass happens at all, is a per-application choice with consequences that reach into
authentication, localization, theming, data fetching, and the test suite.

Four accepted ADRs already reason about that transition and each treats it as **given context** rather
than deciding it: ADR-022 solves `[Authorize]` on fresh GETs by reading an HttpOnly cookie "during SSR
prerender" (`022-browser-session-cookie-auth.md:32-33`); ADR-027 states that its hard part is flowing one
culture decision through "a Blazor `InteractiveAuto` app (SSR prerender -> InteractiveServer circuit ->
InteractiveWebAssembly client)" (`027-multi-locale-i18n.md:13-16`); ADR-028 repeats the same three-phase
premise for the theme and records that "there is no free no-flash for InteractiveAuto"
(`028-dark-theme-mode.md:18-20`, `028-dark-theme-mode.md:178`); ADR-051 builds the whole client token
lifecycle around three heads with three storage stories and ends with "the UI code above them never
branches on render mode" (`051-client-auth-token-lifecycle.md:35-44`,
`051-client-auth-token-lifecycle.md:57`). ADR-042 covers the MAUI head and never mentions render modes at
all. So four decisions depend on a render-mode policy that no ADR states, and the policy itself is only
discoverable by reading two `App.razor` files, two AppHosts, two CI workflows, and one framework base
class. This ADR states it.

## Decision
Run **one render mode for every interactively routed page**, chosen at the application root, default
`InteractiveAuto`, with prerendering left on and the resulting double fetch removed at the data-fetch
layer rather than by weakening the render mode. The one exception is the shared `/Error` page, which
opts out of interactive routing and renders as static SSR.

- **The mode is set once, at the root, on the shared router.** Each app's `App.razor` applies the same
  mode expression to `HeadOutlet` and to `Routes`
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Components/App.razor:53`, `App.razor:57`;
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Components/App.razor:34`, `App.razor:38`), and `Routes`
  is the single framework-owned router shared by both apps
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Routes.razor:10-56`). **No page or component in either app
  declares its own `@rendermode`**: across the repos this ADR governs (MMCA.ADC, MMCA.Store,
  MMCA.Helpdesk, plus the MMCA.Common gallery) the only `@rendermode` attributes are those four plus the
  two in each `InteractiveServer`-only host, and no `[RenderModeInteractive*]` attribute exists anywhere.
  The workspace also carries local sample solutions that are `InteractiveServer`-only heads of the same
  shape; they are outside this ADR's scope and are not counted here.
- **The shared `/Error` page is the one static page.** It declares `[ExcludeFromInteractiveRouting]`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Components/Pages/Error.razor:8`), and the ADC,
  Store and Helpdesk root mode expressions return `null` (static SSR) for a request that does not accept
  interactive routing, so the page renders statically instead of being handed to an interactive router
  that does not know it (`E2eRenderMode.cs:49-66`; Helpdesk's own expression does the same,
  `MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/App.razor:39-40`). The framework
  gallery is the exception: it applies the literal `InteractiveServer` with no `null` branch and does
  not add the `MMCA.Common.UI.Web` assembly, so it does not route `/Error` at all
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Components/App.razor:21`, `App.razor:25`,
  `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/GalleryHost.cs:167-169`).
- **`InteractiveAuto` is the default for both web heads.** ADC's `App.razor` resolves a `PageRenderMode`
  property and Store's an `AppRenderMode` property through the framework's
  `E2eRenderMode.Resolve(IConfiguration, HttpContext)`, passing the cascading `HttpContext`
  (`MMCA.ADC/.../App.razor:81`, `:85`; `MMCA.Store/.../App.razor:56`, `:60`;
  `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hosting/E2eRenderMode.cs:60-66`). That overload
  returns `null` when the request does not accept interactive routing and otherwise the configuration
  overload, which returns `InteractiveAuto` unless an E2E flag is set (`E2eRenderMode.cs:35-47`). Both
  hosts register both runtimes on both sides of the pipeline: `AddInteractiveServerComponents()` inside
  the composed `AddMmcaBlazorWebHost` call (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs:91-92`),
  `AddInteractiveWebAssemblyComponents()` passed by each head through that call's `ConfigureRazorComponents`
  callback (`BlazorWebHostExtensions.cs:93`; `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:54`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:54`), and `AddInteractiveServerRenderMode()` +
  `AddInteractiveWebAssemblyRenderMode()` on each head's own `MapRazorComponents<App>()` chain
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:162-165`;
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:121-124`).
- **The shared web-host registrations and pipeline are one composed call; render-mode registration stays
  per head.** `MMCA.Common.UI.Web` carries
  `AddMmcaBlazorWebHost` and `UseMmcaBlazorWebPipeline`
  (`BlazorWebHostExtensions.cs:75`, `BlazorWebHostExtensions.cs:181`). The first owns the registration
  order, from the configuration-source callback and Serilog through the server-side interactive
  components, bounded circuits and the UI rate limiter, MudBlazor, the shared UI services, the
  trusted-caller header, session-cookie authentication, the same-origin proxy, the antiforgery cookie
  policy and the CSP ahead of the security headers (`BlazorWebHostExtensions.cs:82-158`); the second owns
  the pipeline order, from forwarded headers through the static-asset and service-worker endpoints
  (`BlazorWebHostExtensions.cs:185-213`). Which render modes a head adds stays the head's own code or a
  head callback: the WebAssembly components arrive through `ConfigureRazorComponents`, WebAssembly
  debugging through `DevelopmentPipeline` (`BlazorWebHostExtensions.cs:189-192`;
  `MMCA.Store/.../Program.cs:94`; ADC passes it only on its `net10.0` line and none on `net11.0`,
  `MMCA.ADC/.../Program.cs:125-135`), and the head maps its own `MapRazorComponents<App>()` chain after
  the pipeline call, passing `GetMmcaRazorComponentAssemblies` as the additional assemblies
  (`BlazorWebHostExtensions.cs:175-176`, `BlazorWebHostExtensions.cs:225-243`). The type's summary
  records that split and that it keeps the package free of a WebAssembly server dependency
  (`BlazorWebHostExtensions.cs:32-39`). Both web heads adopt it (`MMCA.ADC/.../Program.cs:26`,
  `MMCA.Store/.../Program.cs:30`).
- **Prerendering stays enabled.** No host anywhere in the workspace passes `prerender: false` or
  constructs a render mode with prerendering disabled; every render mode in use is the stock static
  instance. Prerender is what ADR-022's SSR cookie scheme exists to serve, so it is kept and its cost is
  paid down elsewhere.
- **The SSR/interactive double fetch is removed once, in the shared list-page base.**
  `DataGridListPageBase<TDto>` injects `PersistentComponentState`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:33`), restores a
  per-page-type key `grid:{TypeFullName}` in `OnInitialized` (`DataGridListPageBase.cs:231-235`), and
  registers a persist callback so the prerender pass hands its rows forward
  (`DataGridListPageBase.cs:244-257`). The callback persists only within the framework's prerender
  state budget (`TryPersistAsJsonWithinBudget`, default `PrerenderStateBudget.MaxJsonBytes` = 14 KB;
  `DataGridListPageBase.cs:252`,
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/PrerenderStateBudget.cs:30`, `:71-75`), plus a
  page-wide running total, `MaxTotalJsonBytes` = 16 KB, across every key persisted through that method
  into one `PersistentComponentState`, so a key under 14 KB is still skipped when it would push the page
  past 16 KB, for example a catalog page and a grid beside it (`PrerenderStateBudget.cs:45`, `:85-91`).
  Over either budget nothing is persisted and the first interactive load fetches
  (`DataGridListPageBase.cs:247-249`).
  The first interactive `ServerData` call returns that snapshot and clears it instead of issuing a
  redundant API round-trip (`DataGridListPageBase.cs:1023-1029`), which the base's own comment records
  as the fix for the visible cancel-retry cycle caused by the SSR to Server to WASM transition
  (`DataGridListPageBase.cs:227-230`). The payload is a `PersistedGridState` record of items plus total
  (`DataGridListPageBase.cs:1907`). **Twenty types
  inherit this base** (thirteen in ADC, seven in Store), nineteen of them routable list pages plus ADC's
  non-routable Engagement `AttendeeSearchPanel`
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/CheckIns/AttendeeSearchPanel.razor.cs:16`),
  so the policy is written once and adopted by inheritance. The framework's own non-routable
  `UserAdminList<TUser>` inherits it too
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Administration/UserAdminList.razor:4`), and both
  apps' user list pages host that component
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Users/UserList.razor:8`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.UI/Pages/Users/UserList/UserList.razor:12`), so
  the same policy reaches those two pages by composition.
- **The persist callback declares `InteractiveAuto` explicitly.** The base passes
  `RenderMode.InteractiveAuto` as the second argument to `RegisterOnPersisting`
  (`DataGridListPageBase.cs:257`) because a page that inherits its mode from
  `<Routes @rendermode="...">` declares none of its own, and the callback would otherwise fail render-mode
  inference during the static prerender pass; the reasoning is recorded inline
  (`DataGridListPageBase.cs:237-243`).
- **The list-page prerender fetch is time-bounded so a cold backend cannot block the page.**
  `CreateFetchCts` links to the request token and, when `RendererInfo.IsInteractive` is false, cancels
  after `PrerenderFetchTimeoutMs` (5000 ms) (`DataGridListPageBase.cs:113`,
  `DataGridListPageBase.cs:1427-1438`). On timeout the page returns an empty grid that the first
  interactive call refills (`DataGridListPageBase.cs:109-112`, `DataGridListPageBase.cs:1113`,
  `DataGridListPageBase.cs:1351-1358`). ADC applies a separate 5-second bound to the prerender events
  lookup of its event-filtered list pages and its public session catalog
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Common/PrerenderLookupBudget.cs:17`,
  `.../Pages/Common/EventFilteredListPageBase.cs:165`,
  `.../Pages/Public/Sessions/PublicSessionEventCatalog.cs:75`); the detail-page prerender fetches below
  carry no prerender timeout.
- **Most detail and dashboard pages skip the prerender fetch entirely.** A
  `RendererInfo.IsInteractive` check in `OnParametersSetAsync` / `OnInitializedAsync` (an early return,
  or in `SpeakerDashboard` a ternary that returns a completed task) appears across both apps, with four
  different stated reasons. Most of them avoid the doubled reads under `InteractiveAuto`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerDashboard.razor.cs:96`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLive.razor.cs:87`,
  `.../Pages/SessionLive/PresenterView.razor.cs:74`;
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/ShoppingCarts/ShoppingCartDetail.razor.cs:60`).
  ADC's public session and speaker detail pages split the difference: the prerender branch fetches only
  the primary DTO and persists it (see the `[PersistentState]` bullet below), while the expensive
  lookups stay interactive-only
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Sessions/PublicSessionDetail.razor.cs:107`,
  `.../Pages/Public/Speakers/PublicSpeakerDetail.razor.cs:85`).
  Store's `OrderDetail` states the second reason: no auth token can be read at prerender time, so every
  authenticated call would 401 (`.../Pages/Orders/OrderDetail.razor.cs:157-160`). The third is that a write or
  a hub join must not run on a pass the interactive instance repeats: ADC's sponsor-visit and room check-in
  pages arm their write from `OnParametersSetAsync` behind a compound guard that also skips the scan they
  last armed (the sponsor id; the room id together with the check-in code). A new scan only resets the
  page to its Confirm state with a fresh attempt key, nothing is posted until the attendee taps the
  button (`ConfirmAsync`), and a re-render of the same scan changes nothing
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/CheckIns/Sponsors/SponsorVisit.razor.cs:67-82`,
  `SponsorVisit.razor.cs:86`, `.../Pages/CheckIns/Rooms/RoomCheckIn.razor.cs:75-92`, `RoomCheckIn.razor.cs:96`),
  and `HappeningNow` gates its SignalR join on the same
  flag, in `OnAfterRenderAsync` rather than an initialization method
  (`.../Pages/HappeningNow/HappeningNow.razor.cs:138`, `:144`). The fourth is that an un-timed call to a cold or
  unreachable backend would block the prerender, and with it the page load and the post-login navigation:
  ADC's home page skips its event fetch and countdown timer at prerender for that reason
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:146-151`).
- **Three ADC public detail pages persist their prerendered DTO declaratively.** `PublicEventDetail`,
  `PublicSessionDetail` and `PublicSpeakerDetail` each carry a pair of .NET 10 `[PersistentState]`
  properties, the DTO plus the route id it was fetched for, which the interactive instance reads at most
  once and only for the same id
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Events/PublicEventDetail.razor.cs:88-93`,
  `.../Pages/Public/Sessions/PublicSessionDetail.razor.cs:73-78`,
  `.../Pages/Public/Speakers/PublicSpeakerDetail.razor.cs:62-67`). The session and speaker pages fill it
  from a dedicated prerender branch (`PublicSessionDetail.razor.cs:125-140`); the event page has no
  prerender branch, runs its full load on both passes, and writes the pair on every successful load so
  the interactive pass reuses the event instead of fetching it again (`PublicEventDetail.razor.cs:121-123`,
  `PublicEventDetail.razor.cs:140-141`). The session and speaker fetches pass the page's `PageToken`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/CancellablePageBase.cs:27`,
  `PublicSessionDetail.razor.cs:129`, `PublicSpeakerDetail.razor.cs:107`); the event fetch passes the
  per-load token its `BeginLoad` call issues (`PublicEventDetail.razor.cs:111`, `:123`), which comes
  from a fresh `CancellationTokenSource` per load
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/LatestLoadGuard.cs:55-58`). None of the three
  applies a prerender timeout.
- **A page base's token ends with the page instance, render-mode handover included.**
  `CancellablePageBase` exposes `PageToken`, cancelled when the page is disposed, so a navigation away or
  an `InteractiveAuto` render-mode transition cancels the in-flight work instead of completing into a
  component that is gone (`CancellablePageBase.cs:21-27`, `CancellablePageBase.cs:41-55`). `DetailPageBase`
  and `CreatePageBase` derive from it (`DetailPageBase.cs:27`, `CreatePageBase.cs:21`); `CreatePageBase`
  passes it to its save (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/CreatePageBase.cs:85`),
  and the detail base states as a convention, which nothing enforces, that a derived page passes it to
  every awaited call outside its guarded load (`DetailPageBase.cs:16-20`).
  The page bases themselves are ADR-146 (`146-ui-page-bases-and-list-shell.md`).
- **Three Store pages outside the grid family repeat the list-page pattern by hand.** `CatalogBrowse`
  persists its prerendered products, categories and filter tuple and rehydrates them when the interactive
  pass starts on the same filter combination; `CatalogProductDetail` loads on both passes and persists a
  `ProductStateSnapshot` the interactive pass takes instead of fetching the product again
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/Pages/Catalog/CatalogProductDetail.razor.cs:102-114`,
  `CatalogProductDetail.razor.cs:183`); and `StoreHome` persists its home state the same way. All three
  use the single-argument `RegisterOnPersisting` overload
  (`.../Pages/Catalog/CatalogBrowse.razor.cs:146`, `CatalogProductDetail.razor.cs:73`,
  `.../Pages/Home/StoreHome.razor.cs:81`) rather than the explicit-render-mode form the base needs, and
  all three persist through the same `TryPersistAsJsonWithinBudget` budget
  (`.../Pages/Catalog/CatalogBrowse.PrerenderState.razor.cs:40`, `CatalogProductDetail.razor.cs:183`,
  `StoreHome.razor.cs:184`). They are copies of the policy, not instances of it.
- **Because any page may run in either runtime, both runtimes register the same services.** Each WASM
  client `Program.cs` mirrors its server host's registrations (MudBlazor, `AddUIShared`, browser device
  capabilities, the auth trio, the same conditional per-module UI registrations), which on the server
  side come from the composed call plus the head's own module registrations
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:33-68` against
  `BlazorWebHostExtensions.cs:98-109` and `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:86-104`;
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:32-66` against
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:63-81`), and each client bootstraps its thread
  culture from the same cookie before running so hydration does not disagree with the prerender
  (`MMCA.ADC/.../MMCA.ADC.UI.Web.Client/Program.cs:86`,
  `MMCA.Store/.../MMCA.Store.UI.Web.Client/Program.cs:78`, ADR-027).
- **A build-time layer rule is what keeps the shared UI package runnable in the browser.**
  `MMCA.Common.UI` may not reference Domain, Application, Infrastructure or API, and the enforcement
  target says so in its failure text: "UI depends only on Shared for Blazor WASM compatibility"
  (`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:185-196`). Server-only components are
  hoisted out into `MMCA.Common.UI.Web` for exactly that reason, for example the shared `/Error` page,
  whose `HttpContext` cascading parameter cannot exist in the WASM-safe package
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Components/Pages/Error.razor:19-20`, `Error.razor:58`).
- **`InteractiveServer` is pinned only under E2E configuration flags, never in production or local dev.**
  The switch is the framework's `E2eRenderMode`: `Resolve` returns `InteractiveWebAssembly` when
  `E2E:ForceWebAssembly` is true, otherwise `InteractiveServer` when `E2E:ForceServer` is true, otherwise
  `InteractiveAuto`, so WebAssembly wins when both are set and the switch is inert when neither is
  (`E2eRenderMode.cs:20`, `E2eRenderMode.cs:26`, `E2eRenderMode.cs:35-47`). Both web heads call it from
  `App.razor` (`MMCA.ADC/.../App.razor:81`, `MMCA.Store/.../App.razor:56`), so both honor both keys. Those
  config keys are injected only through the AppHosts, and only when the matching environment variable is
  present: the shared `WithE2eForceWebAssembly` forwards `E2E__ForceWebAssembly` only when
  `E2E_FORCE_WASM` is true, and `WithE2eForceServer` forwards `E2E__ForceServer` only when
  `E2E_FORCE_SERVER` is true and `E2E_FORCE_WASM` is not, so the AppHost applies the same precedence
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:513-520`, `Extensions.cs:489-498`).
  Both AppHosts call both extensions unconditionally
  (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:406`, `Program.cs:414`;
  `MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:405`, `Program.cs:410`). In CI only
  `E2E_FORCE_SERVER` is exported (`MMCA.ADC/.github/workflows/e2e.yml:282`,
  `MMCA.Store/.github/workflows/e2e.yml:290`); ADC's workflow deliberately does **not** set
  `E2E_FORCE_WASM` and records why (`MMCA.ADC/.github/workflows/e2e.yml:267-274`). The
  `WithE2eForceServer` summary records the reason for the pin: under `InteractiveAuto` the post-login second
  page load switches to the background-downloaded WASM runtime, whose boot on a shared 2-core CI runner
  exceeds every suite wait (`Extensions.cs:476-480`).
- **Adoption is not uniform: two hosts are `InteractiveServer`-only.** MMCA.Helpdesk applies a
  `PageRenderMode` property to `HeadOutlet` and `Routes` that returns `InteractiveServer`, or `null`
  for a request that does not accept interactive routing, without calling `E2eRenderMode`
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/App.razor:23`, `App.razor:27`,
  `App.razor:39-40`), and registers only the server render mode
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Program.cs:17-18`, `Program.cs:85-86`). It has **no `.Client` project at
  all**, so `InteractiveAuto` is not available to it, and neither of its two ticket pages uses the shared
  list-page base: the list page renders a `MudTable` directly
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/Pages/Tickets.razor:50-90`) and the
  detail page is a plain MudBlazor form, so none of the persistence machinery above applies there. The framework's own component gallery is likewise
  `InteractiveServer`-only (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Components/App.razor:21`,
  `App.razor:25`, `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/GalleryHost.cs:55-56`, `GalleryHost.cs:167-168`). ADR-028
  already noted Helpdesk's status ("As an `InteractiveServer`-only host it has no WASM boundary",
  `028-dark-theme-mode.md:154`); this ADR makes it part of the record rather than an aside.

## Rationale
- **`InteractiveAuto` gets both halves without asking page authors to choose.** The first visit gets the
  Server circuit's immediate interactivity while the WASM bundle downloads in the background; return
  visits run client-side and stop consuming a server circuit. Because the mode is applied at the root
  router, no page has to opt in or know which runtime it is in, which is the same posture ADR-051 takes
  for tokens (`051-client-auth-token-lifecycle.md:57`).
- **Keeping prerender is not negotiable, so the double fetch had to be fixed instead.** Prerender is the
  entire reason ADR-022's SSR cookie scheme exists, and it is what makes public browse pages render
  without waiting on a runtime boot. Disabling it would have removed the duplicate fetch by removing the
  feature; persisting the prerender result keeps both.
- **Encoding the policy in a base class beats documenting it.** Twenty types inherit the
  persist/restore path, the explicit render-mode registration, and the bounded prerender fetch by
  inheriting one type; the alternative was the same 30 lines repeated per page, which is what
  the three hand-rolled Store pages show happening the moment a page falls outside the family.
- **Three anti-double-fetch mechanisms, matched to page shapes.** A list page has data worth carrying
  across the transition (the grid would otherwise flash empty), so it persists through the base's
  registered callback. Most detail and dashboard pages, public or authenticated, skip and render their
  loading state, so the interactive pass makes the only read; for `OrderDetail` skipping is also forced,
  because no token can be read at prerender time. ADC's three public detail pages persist just their
  primary DTO through `[PersistentState]`, which needs no callback registration, so the prerender carries
  the record; on the session and speaker pages the expensive lookups stay interactive-only, while the
  event page runs its full load, distance lookup included, on both passes
  (`PublicEventDetail.razor.cs:96-105`, `:153`). Persisting where skipping would do would
  only inflate the HTML.
- **The E2E pin is a runner concession, not a product decision.** Pinning `InteractiveServer` is confined
  to a config flag that only the AppHost sets and only CI exports, so the production and local-dev path
  is unchanged by it, and the flag's justification lives with the AppHost extension that forwards it and
  the workflow that exports it (`Extensions.cs:476-480`, `MMCA.ADC/.github/workflows/e2e.yml:267-282`).
  Because the selector is one framework type, both web heads that call it resolve the flags with the
  same precedence (`E2eRenderMode.cs:9-13`); Helpdesk does not call it and resolves `InteractiveServer`
  (or static SSR for a page excluded from interactive routing) in its own `App.razor`
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/App.razor:39-40`).

## Trade-offs
- **Everything shared has to run in both runtimes.** The WASM-compatibility layer rule
  (`MMCA.Common.LayerEnforcement.targets:185-196`) forbids the shared UI package from touching Domain,
  Application, Infrastructure or API, so anything server-only needs a second package
  (`MMCA.Common.UI.Web`) and an explicit `AddAdditionalAssemblies` entry in every app host (the
  component gallery adds only `MMCA.Common.UI`, `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/GalleryHost.cs:169`).
- **Service registration is duplicated per head and can drift.** The WASM client registers MudBlazor,
  `AddUIShared`, capability and per-module services in its own `Program.cs`, while the server host takes
  the shared ones from the composed call (`BlazorWebHostExtensions.cs:98-109`) and the per-module ones from
  its own `Program.cs`; nothing checks that the two lists agree, so a service added to one and not the
  other fails only in the runtime that missed it.
- **The double-fetch fix is opt-in per page, not a framework guarantee.** Only pages that inherit
  `DataGridListPageBase`, hand-roll the pattern (Store's `CatalogBrowse`, `CatalogProductDetail` and
  `StoreHome`), declare `[PersistentState]` (the three
  ADC public detail pages) or take the `RendererInfo.IsInteractive` guard avoid the duplicate work; a new
  page that does none of the four silently fetches twice on every load. No test or analyzer flags that.
- **Only the list-page prerender fetch and ADC's prerender events lookup are time-bounded.** The detail
  pages that fetch during prerender pass either the page's `PageToken` (`CancellablePageBase.cs:27`,
  `PublicSessionDetail.razor.cs:129`, `PublicSpeakerDetail.razor.cs:107`) or, on the event page, a
  per-load token (`PublicEventDetail.razor.cs:111`), with no `CancelAfter` on either, so a cold or unreachable backend can hold
  their prerender, which is the hazard `ADCHome` skips its fetch to avoid and `PrerenderFetchTimeoutMs`
  caps for the grids.
- **Persisting grid rows inflates the prerendered HTML, up to a budget.** The page of DTOs is serialized
  into the response so the interactive pass can reuse it, trading response size for one fewer API
  round-trip, but only when it fits the prerender state budget, both the 14 KB per key and the 16 KB
  page-wide total (`DataGridListPageBase.cs:252`, `PrerenderStateBudget.cs:30`, `:45`); a grid that
  outgrows either persists nothing and pays the second fetch instead (`DataGridListPageBase.cs:247-249`).
- **The deploy-gating E2E suite measures a mode production does not run.** Because CI pins
  `InteractiveServer`, the chromium e2e-gate never exercises the `InteractiveAuto` transition it was pinned
  away from, so a regression specific to the WASM handover cannot be caught by that gate. The Core Web
  Vitals numbers carry the same caveat in their own remarks: they "reflect Server-mode
  prerender-then-hydrate under runner contention, not production's InteractiveAuto on real hardware"
  (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/WebVitalsTests.cs:18-21`). The pseudo-localization
  suite likewise had to route its activation through the culture cookie because the pinned circuit reads
  cookies but not the original query string
  (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/PseudoLocalizationTests.cs:17-21`).
- **Nothing enforces the root render mode.** There is no fitness test asserting that `Routes` carries
  `InteractiveAuto`, so a new host picks whatever it picks; Helpdesk and the gallery already differ
  (deliberately), and a fourth host could differ by accident.
- **A first-paint flash remains for anything restored after hydration.** ADR-028's theme read runs in
  `OnAfterRenderAsync` and deliberately not during prerender, so `InteractiveAuto` still permits a brief
  wrong-theme paint (`028-dark-theme-mode.md:46-49`, `028-dark-theme-mode.md:178`); the render-mode
  choice does not close that gap, it defines it.

## Revision (2026-10-01)
No decision or rationale changed. The prerender-skip guard bullet now lists four stated reasons rather
than three: `ADCHome` skips its prerender fetch because an un-timed call to a cold or unreachable backend
would block the prerender and the post-login navigation
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:132-137`), not to
avoid doubled reads, so it moved out of the doubled-reads list. The empty-grid-on-timeout citation now
points at the intent comment, the `onCancelled: EmptyGridData` argument and the cancellation catch
(`DataGridListPageBase.cs:80-83`, `DataGridListPageBase.cs:545`, `DataGridListPageBase.cs:659-668`). The
remaining citations were re-anchored to their current lines: both web hosts' `App.razor`, `Program.cs`
registration and mapping ranges and WASM client ranges, `Routes.razor`, `DataGridListPageBase`
(`CreateFetchCts`, `PersistedGridState`), the detail-page guards, `OrderDetail`, `HappeningNow`, the layer
enforcement target, `Error.razor`, both AppHosts, both `e2e.yml` workflows, and the Helpdesk `App.razor`,
`Program.cs` and `Tickets.razor`.

## Revision (2026-10-06)
- The Rationale's two-page-shapes bullet no longer says detail pages skip because they sit behind
  `[Authorize]` without a token: most skipping pages (several of them public) skip to avoid doubled
  reads, and only `OrderDetail` states the token reason (`OrderDetail.razor.cs:124-127`).
- The list-page bullet now records that the framework's own non-routable `UserAdminList<TUser>` also
  inherits `DataGridListPageBase` (`UserAdminList.razor:4`) and reaches both apps' user list pages by
  composition.
- The guard bullet now says `HappeningNow` gates its hub join in `OnAfterRenderAsync`
  (`HappeningNow.razor.cs:120`), and the trade-off on `AddAdditionalAssemblies` is scoped to the app
  hosts, since the gallery adds only `MMCA.Common.UI` (`GalleryHost.cs:131`).
- Anchors in the live sections were re-verified against current source and re-anchored (both `App.razor`
  files, host `Program.cs` ranges, `Routes.razor`, `DataGridListPageBase`, the detail-page guards,
  `ADCHome`, the WASM client culture calls, `Error.razor`, both AppHosts, the gallery `App.razor` and
  `WebVitalsTests.cs`). The 2026-10-01 entry's anchors stand as recorded on that date.

## Revision (2026-10-07)
Re-verified against current source. No decision, rationale, count or adoption changed; only anchors
moved.

1. Anchors re-verified against current source: the ADC host `MapRazorComponents<App>()` mapping with
   both render modes (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:327-329`), the ADC AppHost
   E2E flag block (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:403-430`), the Core Web Vitals
   caveat quote (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/WebVitalsTests.cs:18-21`), and the
   cross-ADR quotes in ADR-022 (`022-browser-session-cookie-auth.md:23-24`), ADR-028
   (`028-dark-theme-mode.md:69`, `028-dark-theme-mode.md:84`) and ADR-051
   (`051-client-auth-token-lifecycle.md:22-31`, `051-client-auth-token-lifecycle.md:44`).

## Revision (2026-10-21)
Re-verified against current source. The render-mode decision, the persist/restore and bounded-prerender
behavior of the list-page base, the four stated guard reasons and the Helpdesk and gallery adoption are
unchanged; two descriptions of how the code does it moved.

1. The guard bullet: ADC's sponsor-visit and room check-in pages post from `OnParametersSetAsync`, not
   `OnInitializedAsync` (`OnInitialized` only builds breadcrumbs), and the guard is compound:
   `!RendererInfo.IsInteractive || SponsorId == _postedSponsorId` and
   `!RendererInfo.IsInteractive || RoomId == _postedRoomId`, so a re-render of the
   id last posted (the single `_postedSponsorId` / `_postedRoomId` field) posts nothing and each new
   scan posts once (`SponsorVisit.razor.cs:43`, `:58-62`, `:68`, `RoomCheckIn.razor.cs:40`, `:55-60`, `:66`).
2. The E2E bullet: the `E2E__ForceServer` injection and its `E2E_FORCE_SERVER` gate live in the shared
   `WithE2eForceServer` extension (`MMCA.Common.Aspire.Hosting/Extensions.cs:441-454`), which ADC calls
   with `unlessAlso: forceWasm` (`MMCA.ADC.AppHost/Program.cs:432`) and Store calls bare
   (`MMCA.Store.AppHost/Program.cs:430`); ADC still sets `E2E__ForceWebAssembly` itself
   (`MMCA.ADC.AppHost/Program.cs:420-424`).
3. Anchors re-verified against current source: `DataGridListPageBase` (`:32`, `:186-190`, `:199-209`,
   `:209`, `:192-198`, `:182-185`, `:663-678`, `:92-95`, `:96`, `:732`, `:854-868`, `:933-944`, `:1268`,
   and the trade-off's serialization at `:204`), the doubled-reads guards (`PublicSessionDetail.razor.cs:93-100`,
   `PublicSpeakerDetail.razor.cs:76`, `SpeakerDashboard.razor.cs:82`, `SessionLive.razor.cs:81`,
   `PresenterView.razor.cs:67`, `CatalogProductDetail.razor.cs:58`, `ShoppingCartDetail.razor.cs:64`),
   `OrderDetail.razor.cs:123-126`, the Helpdesk host (`Program.cs:15-16`, `Program.cs:80-81`), the gallery
   host (`GalleryHost.cs:53`, `GalleryHost.cs:134-135`, `GalleryHost.cs:136`), and the cross-ADR quotes in
   ADR-022 (`022-browser-session-cookie-auth.md:26-27`), ADR-028 (`028-dark-theme-mode.md:14-17`,
   `:41-47`, `:85`, `:105`) and ADR-051 (`051-client-auth-token-lifecycle.md:30-39`, `:52`).

## Revision (2026-10-26)
Re-verified against current source. The root render mode, the E2E pin, the list-page base's
persist/restore and bounded prerender fetch, the four stated guard reasons and the Helpdesk and gallery
adoption are unchanged; the detail-page side of the double-fetch fix moved.

1. The guard bullet: ADC's `PublicSessionDetail` and `PublicSpeakerDetail` no longer skip the prerender
   fetch. Their prerender branch fetches the primary DTO and persists it for the interactive instance
   (`PublicSessionDetail.razor.cs:107-110`, `:125-140`; `PublicSpeakerDetail.razor.cs:85-88`), so they
   left the doubled-reads skip list. `SpeakerDashboard` checks the flag in a ternary
   (`SpeakerDashboard.razor.cs:90`), not an early return.
2. A new Decision bullet records the third mechanism: `[PersistentState]` property pairs on
   `PublicEventDetail` (`PublicEventDetail.razor.cs:87-92`, written on every successful load at
   `:139-140`), `PublicSessionDetail` (`:73-78`) and `PublicSpeakerDetail` (`:62-67`). `CatalogBrowse`
   remains the only hand-rolled `RegisterOnPersisting` caller outside the base
   (`CatalogBrowse.razor.cs:101`). The Rationale's "two mechanisms" bullet and the opt-in trade-off now
   name all of them.
3. A new trade-off and a sentence in the bounded-fetch bullet: the `PrerenderFetchTimeoutMs` bound is
   list-page only. The session and speaker prerender fetches pass the page's lifetime token
   (`DetailPageBase.cs:38`, `PublicSessionDetail.razor.cs:129`, `PublicSpeakerDetail.razor.cs:107`) and
   the event page a per-load `BeginLoad` token (`PublicEventDetail.razor.cs:110`, `:122`;
   `LatestLoadGuard.cs:55-58`), none with a `CancelAfter`.
4. The ADR-027 quote now carries the arrows its source line uses, written as ASCII `->` in place of the
   source's Unicode arrow (`027-multi-locale-i18n.md:14`).
5. Anchors re-verified against current source: both host `Program.cs` registration and mapping chains
   (ADC `:77-79`, `:333-335`; Store `:83-85`, `:282-284`) and WASM-mirror ranges (ADC `:77-183`, Store
   `:83-172`), `DataGridListPageBase` (`:202-206`, `:215-225`, `:225`, `:208-214`, `:198-201`,
   `:686-702`, `:108-111`, `:112`, `:760`, `:899-913`, `:984-995`, `:1372`, and the serialization at
   `:220`), the guards (`SessionLive.razor.cs:81`, `PresenterView.razor.cs:67`,
   `CatalogProductDetail.razor.cs:57`, `ShoppingCartDetail.razor.cs:60`, `OrderDetail.razor.cs:119-122`,
   `ADCHome.razor.cs:145-150`, `SponsorVisit.razor.cs:61-68`, `RoomCheckIn.razor.cs:58-66`,
   `HappeningNow.razor.cs:132`), the layer target (`MMCA.Common.LayerEnforcement.targets:157-170`), the
   AppHosts (ADC `Program.cs:421-425`, `:433`; Store `Program.cs:432`; `Extensions.cs:442-455`), the
   workflows (ADC `e2e.yml:241`, `:226-233`), and the cross-ADR quotes in ADR-022
   (`022-browser-session-cookie-auth.md:28-29`), ADR-028 (`028-dark-theme-mode.md:104`, `:130`) and
   ADR-051 (`051-client-auth-token-lifecycle.md:34-43`, `:56`).

## Revision (2026-10-28)
Re-verified against current source. The root render mode, the E2E pin (ADC's `E2E:ForceWebAssembly`
still wins over `E2E:ForceServer`), the list-page base, the four stated guard reasons, the
`[PersistentState]` pages, `CatalogBrowse`'s hand-rolled single-argument `RegisterOnPersisting`, and
the Helpdesk and gallery `InteractiveServer`-only adoption are unchanged; only anchors moved.

1. Anchors re-verified against current source: both web hosts' `App.razor` (ADC `HeadOutlet` `:45`,
   `Routes` `:49`, `AppRenderMode` `:71-82`; Store `:23`, `:27`, `:46-49`), both host `Program.cs`
   registration and mapping chains (ADC `:78-80`, `:337-339`; Store `:84-86`, `:286-288`) and
   WASM-mirror server ranges (ADC `:78-184`, ending at `AddNotificationUI`; Store `:84-173`, ending at
   `AddIdentityUI`), the guards (`SpeakerDashboard.razor.cs:95`, `CatalogProductDetail.razor.cs:75`,
   `OrderDetail.razor.cs:129-132`, `HappeningNow.razor.cs:139`), `CatalogBrowse.razor.cs` (`:82-90`,
   `:99-125`, `:133-167`, `:169-181`, `RegisterOnPersisting` at `:135`), the Helpdesk host
   (`App.razor:23`, `:27`; `Program.cs:16-17`, `:84-85`), the gallery host (`GalleryHost.cs:53-54`,
   `:138-139`, `AddAdditionalAssemblies` at `:140`), and the cross-ADR quotes in ADR-022
   (`022-browser-session-cookie-auth.md:29-30`), ADR-028 (`028-dark-theme-mode.md:16-18`, `:43-48`,
   `:117`, `:143`) and ADR-051 (`051-client-auth-token-lifecycle.md:35-44`, `:57`).

## Revision (2026-11-23)
Re-verified against current source. The `InteractiveAuto` default, kept prerendering, the E2E pin and its
precedence, the list-page base's persist/restore and 5000 ms prerender bound, the four stated guard
reasons, the `[PersistentState]` pages and the Helpdesk and gallery `InteractiveServer`-only adoption are
unchanged; the static `/Error` exception, the persistence budget, the check-in pages' tap-to-post
write and the hand-rolled page count moved.

1. The Decision now scopes the single mode to interactively routed pages. The shared `/Error` page
   declares `[ExcludeFromInteractiveRouting]` (`MMCA.Common.UI.Web/Components/Pages/Error.razor:8`), and
   both web heads call `E2eRenderMode.Resolve(IConfiguration, HttpContext)`, which returns `null` (static
   SSR) when the request does not accept interactive routing (`E2eRenderMode.cs:60-66`; ADC
   `App.razor:81`, Store `App.razor:56`). ADC's property is named `PageRenderMode`. The framework
   gallery does not share the exception: it keeps the literal `InteractiveServer` and does not add the
   `MMCA.Common.UI.Web` assembly, so `/Error` is not routed there (`Gallery/Components/App.razor:21`,
   `:25`; `GalleryHost.cs:167-169`). The count of eight `@rendermode` attributes and the absence of any
   `[RenderModeInteractive*]` attribute are unchanged.
2. Helpdesk no longer pins a literal: its `PageRenderMode` returns `InteractiveServer` or `null` by the
   same interactive-routing test, without calling `E2eRenderMode` (`MMCA.Helpdesk.UI.Web/Components/App.razor:39-40`).
3. Grid persistence is budget-gated: the base persists through `TryPersistAsJsonWithinBudget` with the
   default `PrerenderStateBudget.MaxJsonBytes` of 14 KB per key and a page-wide running total of
   `MaxTotalJsonBytes` = 16 KB per `PersistentComponentState`, and persists nothing over either
   (`DataGridListPageBase.cs:247-252`, `PrerenderStateBudget.cs:30`, `:45`, `:71-75`, `:85-91`). The
   serialization trade-off now says so.
4. Store hand-rolls the persist pattern on three pages, not one: `CatalogBrowse.razor.cs:146`,
   `CatalogProductDetail.razor.cs:73` and `StoreHome.razor.cs:81`, all on the single-argument
   `RegisterOnPersisting` and all within the same budget. `CatalogProductDetail` left the doubled-reads
   skip list: it loads on both passes and takes the persisted snapshot (`CatalogProductDetail.razor.cs:102-114`).
5. The sponsor-visit and room check-in pages no longer post from `OnParametersSetAsync`: a new scan
   resets the page to its Confirm state with a fresh attempt key, and the write runs only when the
   attendee taps the button (`ConfirmAsync`; `SponsorVisit.razor.cs:67-82`, `:86`;
   `RoomCheckIn.razor.cs:75-92`, `:96`). The room guard keys on the room id and the check-in code
   (`RoomCheckIn.razor.cs:75-76`), so a rescan of the same room with a different code re-arms the Confirm
   state under a new key; the sponsor-visit guard stays id-only (`SponsorVisit.razor.cs:67`).
6. ADC also bounds its prerender events lookup with a 5-second `PrerenderLookupBudget`
   (`PrerenderLookupBudget.cs:17`, `EventFilteredListPageBase.cs:165`, `PublicSessionEventCatalog.cs:75`),
   so the bounded-fetch bullet and its trade-off no longer say the bound is list-page only.
7. The composed-call bullet names the UI rate limiter, the trusted-caller header and the antiforgery
   cookie policy in the registration order, and records that ADC passes `DevelopmentPipeline` only on its
   `net10.0` line (`MMCA.ADC.UI.Web/Program.cs:125-135`).
8. Anchors re-verified against current source: both `App.razor` files (ADC `:53`, `:57`, `:81`, `:85`;
   Store `:34`, `:38`, `:56`, `:60`), `Routes.razor:10-56`, `E2eRenderMode.cs` (`:9-13`, `:20`, `:26`,
   `:35-47`), `BlazorWebHostExtensions.cs` (`:32-39`, `:75`, `:82-158`, `:91-92`, `:93`, `:98-109`,
   `:175-176`, `:181`, `:185-213`, `:189-192`, `:225-243`), both host `Program.cs` files (ADC `:26`,
   `:54`, `:86-104`, `:162-165`; Store `:30`, `:54`, `:63-81`, `:94`, `:121-124`), `DataGridListPageBase.cs`
   (`:33`, `:109-112`, `:113`, `:227-230`, `:231-235`, `:237-243`, `:244-257`, `:257`, `:1023-1029`,
   `:1113`, `:1351-1358`, `:1427-1438`, `:1907`), the guards (`SpeakerDashboard.razor.cs:96`,
   `SessionLive.razor.cs:87`, `PresenterView.razor.cs:74`, `PublicSessionDetail.razor.cs:107`,
   `PublicSpeakerDetail.razor.cs:85`, `OrderDetail.razor.cs:157-160`, `HappeningNow.razor.cs:138`,
   `:144`, `ADCHome.razor.cs:146-151`), `PublicEventDetail.razor.cs` (`:88-93`, `:111`, `:121-123`,
   `:140-141`, `:153`), the WASM clients (ADC `:33-68`, `:86`; Store `:32-66`, `:78`), the layer target
   (`MMCA.Common.LayerEnforcement.targets:185-196`), `Error.razor` (`:19-20`, `:58`), `Extensions.cs`
   (`:476-480`, `:489-498`, `:513-520`), the AppHosts (ADC `Program.cs:406`, `:414`; Store
   `Program.cs:405`, `:410`), the workflows (ADC `e2e.yml:267-274`, `:282`; Store `e2e.yml:290`), the
   Helpdesk host (`Program.cs:17-18`, `:85-86`), the gallery host (`GalleryHost.cs:55-56`, `:167-169`),
   and the cross-ADR quotes in ADR-022 (`022-browser-session-cookie-auth.md:32-33`) and ADR-028
   (`028-dark-theme-mode.md:18-20`, `:46-49`, `:154`, `:178`).

## Related
ADR-022 (reads the HttpOnly session cookie during the SSR prerender pass this decision keeps enabled),
ADR-027 (flows one culture through the SSR to Server to WASM sequence this decision establishes, and owns
the WASM-side culture bootstrap both clients run), ADR-028 (the theme faces the same three-phase agreement
problem and records the residual `InteractiveAuto` flash), ADR-051 (the client token lifecycle whose three
storage stories exist because of this split, and whose "the UI code above them never branches on render
mode" invariant this root-level choice makes possible), ADR-042 (the MAUI head, which hosts the same
components in a BlazorWebView and therefore sits outside the render-mode model entirely), ADR-146 (the
UI page bases, including the `CancellablePageBase` whose `PageToken` ends with the page instance).
