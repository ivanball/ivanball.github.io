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
refreshed against current source; no decision, count or adoption changed.

## Context
Both web applications are Blazor Web Apps: a static server-rendered (SSR) prerender pass produces the
first HTML, then an interactive runtime takes over, either a Blazor Server SignalR circuit or a
WebAssembly runtime downloaded into the browser. Which of those runtimes takes over, and whether the
prerender pass happens at all, is a per-application choice with consequences that reach into
authentication, localization, theming, data fetching, and the test suite.

Four accepted ADRs already reason about that transition and each treats it as **given context** rather
than deciding it: ADR-022 solves `[Authorize]` on fresh GETs by reading an HttpOnly cookie "during SSR
prerender" (`022-browser-session-cookie-auth.md:29-30`); ADR-027 states that its hard part is flowing one
culture decision through "a Blazor `InteractiveAuto` app (SSR prerender -> InteractiveServer circuit ->
InteractiveWebAssembly client)" (`027-multi-locale-i18n.md:13-16`); ADR-028 repeats the same three-phase
premise for the theme and records that "there is no free no-flash for InteractiveAuto"
(`028-dark-theme-mode.md:16-18`, `028-dark-theme-mode.md:143`); ADR-051 builds the whole client token
lifecycle around three heads with three storage stories and ends with "the UI code above them never
branches on render mode" (`051-client-auth-token-lifecycle.md:35-44`,
`051-client-auth-token-lifecycle.md:57`). ADR-042 covers the MAUI head and never mentions render modes at
all. So four decisions depend on a render-mode policy that no ADR states, and the policy itself is only
discoverable by reading two `App.razor` files, two AppHosts, two CI workflows, and one framework base
class. This ADR states it.

## Decision
Run **one render mode for the entire routable component tree**, chosen at the application root, default
`InteractiveAuto`, with prerendering left on and the resulting double fetch removed at the data-fetch
layer rather than by weakening the render mode.

- **The mode is set once, at the root, on the shared router.** Each app's `App.razor` applies the same
  mode expression to `HeadOutlet` and to `Routes`
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Components/App.razor:45`, `App.razor:49`;
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Components/App.razor:23`, `App.razor:27`), and `Routes`
  is the single framework-owned router shared by both apps
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Routes.razor:12-56`). **No page or component in either app
  declares its own `@rendermode`**: across the repos this ADR governs (MMCA.ADC, MMCA.Store,
  MMCA.Helpdesk, plus the MMCA.Common gallery) the only `@rendermode` attributes are those four plus the
  two in each `InteractiveServer`-only host, and no `[RenderModeInteractive*]` attribute exists anywhere.
  The workspace also carries local sample solutions that are `InteractiveServer`-only heads of the same
  shape; they are outside this ADR's scope and are not counted here.
- **`InteractiveAuto` is the default for both web heads.** Each `App.razor` resolves an `AppRenderMode`
  property that returns `InteractiveAuto` unless an E2E flag is set
  (`MMCA.ADC/.../App.razor:71-82`, `MMCA.Store/.../App.razor:46-49`). Both hosts register both runtimes on
  both sides of the pipeline: `AddInteractiveServerComponents()` + `AddInteractiveWebAssemblyComponents()`
  at service registration and `AddInteractiveServerRenderMode()` + `AddInteractiveWebAssemblyRenderMode()`
  on `MapRazorComponents<App>()`
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:78-80`, `Program.cs:337-339`;
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:84-86`, `Program.cs:286-288`).
- **Prerendering stays enabled.** No host anywhere in the workspace passes `prerender: false` or
  constructs a render mode with prerendering disabled; every render mode in use is the stock static
  instance. Prerender is what ADR-022's SSR cookie scheme exists to serve, so it is kept and its cost is
  paid down elsewhere.
- **The SSR/interactive double fetch is removed once, in the shared list-page base.**
  `DataGridListPageBase<TDto>` injects `PersistentComponentState`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:32`), restores a
  per-page-type key `grid:{TypeFullName}` in `OnInitialized` (`DataGridListPageBase.cs:202-206`), and
  registers a persist callback so the prerender pass hands its rows forward
  (`DataGridListPageBase.cs:215-225`). The first interactive `ServerData` call returns that snapshot and
  clears it instead of issuing a redundant API round-trip (`DataGridListPageBase.cs:686-702`), which the
  base's own comment records as the fix for the visible cancel-retry cycle caused by the
  SSR to Server to WASM transition (`DataGridListPageBase.cs:198-201`). The payload is a
  `PersistedGridState` record of items plus total (`DataGridListPageBase.cs:1372`). **Twenty types
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
  (`DataGridListPageBase.cs:225`) because a page that inherits its mode from
  `<Routes @rendermode="...">` declares none of its own, and the callback would otherwise fail render-mode
  inference during the static prerender pass; the reasoning is recorded inline
  (`DataGridListPageBase.cs:208-214`).
- **The list-page prerender fetch is time-bounded so a cold backend cannot block the page.**
  `CreateFetchCts` links to the request token and, when `RendererInfo.IsInteractive` is false, cancels
  after `PrerenderFetchTimeoutMs` (5000 ms) (`DataGridListPageBase.cs:112`,
  `DataGridListPageBase.cs:984-995`). On timeout the page returns an empty grid that the first
  interactive call refills (`DataGridListPageBase.cs:108-111`, `DataGridListPageBase.cs:760`,
  `DataGridListPageBase.cs:899-913`). The bound lives in the list-page base only; the detail-page
  prerender fetches below carry no prerender timeout.
- **Most detail and dashboard pages skip the prerender fetch entirely.** A
  `RendererInfo.IsInteractive` check in `OnParametersSetAsync` / `OnInitializedAsync` (an early return,
  or in `SpeakerDashboard` a ternary that returns a completed task) appears across both apps, with four
  different stated reasons. Most of them avoid the doubled reads under `InteractiveAuto`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerDashboard.razor.cs:95`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLive.razor.cs:81`,
  `.../Pages/SessionLive/PresenterView.razor.cs:67`;
  `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/Pages/Catalog/CatalogProductDetail.razor.cs:75`,
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/ShoppingCarts/ShoppingCartDetail.razor.cs:60`).
  ADC's public session and speaker detail pages split the difference: the prerender branch fetches only
  the primary DTO and persists it (see the `[PersistentState]` bullet below), while the expensive
  lookups stay interactive-only
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Sessions/PublicSessionDetail.razor.cs:107-110`,
  `.../Pages/Public/Speakers/PublicSpeakerDetail.razor.cs:85-88`).
  Store's `OrderDetail` states the second reason: no auth token can be read at prerender time, so every
  authenticated call would 401 (`.../Pages/Orders/OrderDetail.razor.cs:129-132`). The third is that a write or
  a hub join must not run on a pass the interactive instance repeats: ADC's sponsor-visit and room check-in
  pages post from `OnParametersSetAsync` behind a compound guard that also skips the id it last posted, so
  each new scan of a sponsor or room posts once and a re-render of the same id posts nothing
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/CheckIns/Sponsors/SponsorVisit.razor.cs:61-68`,
  `.../Pages/CheckIns/Rooms/RoomCheckIn.razor.cs:58-66`), and `HappeningNow` gates its SignalR join on the same
  flag, in `OnAfterRenderAsync` rather than an initialization method
  (`.../Pages/HappeningNow/HappeningNow.razor.cs:139`). The fourth is that an un-timed call to a cold or
  unreachable backend would block the prerender, and with it the page load and the post-login navigation:
  ADC's home page skips its event fetch and countdown timer at prerender for that reason
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:145-150`).
- **Three ADC public detail pages persist their prerendered DTO declaratively.** `PublicEventDetail`,
  `PublicSessionDetail` and `PublicSpeakerDetail` each carry a pair of .NET 10 `[PersistentState]`
  properties, the DTO plus the route id it was fetched for, which the interactive instance reads at most
  once and only for the same id
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Events/PublicEventDetail.razor.cs:87-92`,
  `.../Pages/Public/Sessions/PublicSessionDetail.razor.cs:73-78`,
  `.../Pages/Public/Speakers/PublicSpeakerDetail.razor.cs:62-67`). The session and speaker pages fill it
  from a dedicated prerender branch (`PublicSessionDetail.razor.cs:125-140`); the event page has no
  prerender branch, runs its full load on both passes, and writes the pair on every successful load so
  the interactive pass reuses the event instead of fetching it again (`PublicEventDetail.razor.cs:120-122`,
  `PublicEventDetail.razor.cs:139-140`). The session and speaker fetches pass the page's lifetime token
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DetailPageBase.cs:38`,
  `PublicSessionDetail.razor.cs:129`, `PublicSpeakerDetail.razor.cs:107`); the event fetch passes the
  per-load token its `BeginLoad` call issues (`PublicEventDetail.razor.cs:110`, `:122`), which comes
  from a fresh `CancellationTokenSource` per load
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/LatestLoadGuard.cs:55-58`). None of the three
  applies a prerender timeout.
- **One further page outside the grid family repeats the list-page pattern by hand.** Store's `CatalogBrowse`
  persists its prerendered products, categories and filter tuple and rehydrates them when the interactive
  pass starts on the same filter combination
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/Pages/Catalog/CatalogBrowse.razor.cs:82-90`,
  `CatalogBrowse.razor.cs:99-125`, `CatalogBrowse.razor.cs:133-167`, `CatalogBrowse.razor.cs:169-181`),
  using the single-argument `RegisterOnPersisting` overload (`CatalogBrowse.razor.cs:135`) rather than the
  explicit-render-mode form the base needs. It is a copy of the policy, not an instance of it.
- **Because any page may run in either runtime, both runtimes register the same services.** Each WASM
  client `Program.cs` mirrors its server host's registrations (MudBlazor, `AddUIShared`, browser device
  capabilities, the auth trio, the same conditional per-module UI registrations)
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:33-76` against
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:78-184`;
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:31-64` against
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:84-173`), and each client bootstraps its thread
  culture from the same cookie before running so hydration does not disagree with the prerender
  (`MMCA.ADC/.../MMCA.ADC.UI.Web.Client/Program.cs:83`,
  `MMCA.Store/.../MMCA.Store.UI.Web.Client/Program.cs:71`, ADR-027).
- **A build-time layer rule is what keeps the shared UI package runnable in the browser.**
  `MMCA.Common.UI` may not reference Domain, Application, Infrastructure or API, and the enforcement
  target says so in its failure text: "UI depends only on Shared for Blazor WASM compatibility"
  (`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:157-170`). Server-only components are
  hoisted out into `MMCA.Common.UI.Web` for exactly that reason, for example the shared `/Error` page,
  whose `HttpContext` cascading parameter cannot exist in the WASM-safe package
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Components/Pages/Error.razor:12-21`, `Error.razor:52-53`).
- **`InteractiveServer` is pinned only under E2E configuration flags, never in production or local dev.**
  `E2E:ForceServer` returns `InteractiveServer`; ADC additionally honors `E2E:ForceWebAssembly`, which
  returns `InteractiveWebAssembly` and wins if both are set (`MMCA.ADC/.../App.razor:71-82`,
  `MMCA.Store/.../App.razor:46-49`). Those config keys are injected only through the AppHosts, and only when
  the matching environment variable is present. ADC reads `E2E_FORCE_WASM` and sets
  `E2E__ForceWebAssembly` itself (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:421-425`); for
  `E2E__ForceServer` both AppHosts call the shared `WithE2eForceServer` extension, ADC passing
  `unlessAlso: forceWasm` so the WebAssembly flag wins
  (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:433`,
  `MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:432`), and that extension forwards the key
  only when `E2E_FORCE_SERVER` is `true`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:442-455`). In CI only `E2E_FORCE_SERVER` is
  exported (`MMCA.ADC/.github/workflows/e2e.yml:241`, `MMCA.Store/.github/workflows/e2e.yml:229`);
  ADC's workflow deliberately does **not** set `E2E_FORCE_WASM` and records why
  (`MMCA.ADC/.github/workflows/e2e.yml:226-233`). Both `App.razor` comments cite the same trace evidence:
  under `InteractiveAuto` each test's second page load switched to the background-downloaded WASM bundle,
  whose runtime boot on a shared 2-core runner exceeded every suite wait while the download starved the
  live circuits.
- **Adoption is not uniform: two hosts are `InteractiveServer`-only and hardcode it.** MMCA.Helpdesk pins
  the literal mode on `HeadOutlet` and `Routes`
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/App.razor:23`, `App.razor:27`) and
  registers only the server render mode
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Program.cs:16-17`, `Program.cs:84-85`). It has **no `.Client` project at
  all**, so `InteractiveAuto` is not available to it, and neither of its two ticket pages uses the shared
  list-page base: the list page renders a `MudTable` directly
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/Pages/Tickets.razor:50-90`) and the
  detail page is a plain MudBlazor form, so none of the persistence machinery above applies there. The framework's own component gallery is likewise
  `InteractiveServer`-only (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Components/App.razor:21`,
  `App.razor:25`, `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/GalleryHost.cs:53-54`, `GalleryHost.cs:138-139`). ADR-028
  already noted Helpdesk's status ("As an `InteractiveServer`-only host it has no WASM boundary",
  `028-dark-theme-mode.md:117`); this ADR makes it part of the record rather than an aside.

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
  `CatalogBrowse` shows happening the moment a page falls outside the family.
- **Three anti-double-fetch mechanisms, matched to page shapes.** A list page has data worth carrying
  across the transition (the grid would otherwise flash empty), so it persists through the base's
  registered callback. Most detail and dashboard pages, public or authenticated, skip and render their
  loading state, so the interactive pass makes the only read; for `OrderDetail` skipping is also forced,
  because no token can be read at prerender time. ADC's three public detail pages persist just their
  primary DTO through `[PersistentState]`, which needs no callback registration, so the prerender carries
  the record; on the session and speaker pages the expensive lookups stay interactive-only, while the
  event page runs its full load, distance lookup included, on both passes
  (`PublicEventDetail.razor.cs:96-105`, `:152`). Persisting where skipping would do would
  only inflate the HTML.
- **The E2E pin is a runner concession, not a product decision.** Pinning `InteractiveServer` is confined
  to a config flag that only the AppHost sets and only CI exports, so the production and local-dev path
  is unchanged by it, and the flag's justification (with run ids) lives next to the code that reads it.

## Trade-offs
- **Everything shared has to run in both runtimes.** The WASM-compatibility layer rule
  (`MMCA.Common.LayerEnforcement.targets:157-170`) forbids the shared UI package from touching Domain,
  Application, Infrastructure or API, so anything server-only needs a second package
  (`MMCA.Common.UI.Web`) and an explicit `AddAdditionalAssemblies` entry in every app host (the
  component gallery adds only `MMCA.Common.UI`, `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/GalleryHost.cs:140`).
- **Service registration is duplicated per head and can drift.** The WASM client and the server host
  register the same MudBlazor, `AddUIShared`, capability and per-module services in two separate
  `Program.cs` files; nothing checks that the two lists agree, so a service added to one and not the other
  fails only in the runtime that missed it.
- **The double-fetch fix is opt-in per page, not a framework guarantee.** Only pages that inherit
  `DataGridListPageBase`, hand-roll the pattern (`CatalogBrowse`), declare `[PersistentState]` (the three
  ADC public detail pages) or take the `RendererInfo.IsInteractive` guard avoid the duplicate work; a new
  page that does none of the four silently fetches twice on every load. No test or analyzer flags that.
- **Only the list-page prerender fetch is time-bounded.** The detail pages that fetch during prerender
  pass either the page's lifetime token (`DetailPageBase.cs:38`, `PublicSessionDetail.razor.cs:129`,
  `PublicSpeakerDetail.razor.cs:107`) or, on the event page, a per-load token
  (`PublicEventDetail.razor.cs:110`), with no `CancelAfter` on either, so a cold or unreachable backend can hold
  their prerender, which is the hazard `ADCHome` skips its fetch to avoid and `PrerenderFetchTimeoutMs`
  caps for the grids.
- **Persisting grid rows inflates the prerendered HTML.** The full page of DTOs is serialized into the
  response so the interactive pass can reuse it (`DataGridListPageBase.cs:220`), trading response size for
  one fewer API round-trip; a large page size makes that trade worse.
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
  wrong-theme paint (`028-dark-theme-mode.md:43-48`, `028-dark-theme-mode.md:143`); the render-mode
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

## Related
ADR-022 (reads the HttpOnly session cookie during the SSR prerender pass this decision keeps enabled),
ADR-027 (flows one culture through the SSR to Server to WASM sequence this decision establishes, and owns
the WASM-side culture bootstrap both clients run), ADR-028 (the theme faces the same three-phase agreement
problem and records the residual `InteractiveAuto` flash), ADR-051 (the client token lifecycle whose three
storage stories exist because of this split, and whose "the UI code above them never branches on render
mode" invariant this root-level choice makes possible), ADR-042 (the MAUI head, which hosts the same
components in a BlazorWebView and therefore sits outside the render-mode model entirely).
