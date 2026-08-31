# ADR-056: Blazor Render-Mode Strategy for the Web Heads

## Status
Accepted (2026-07-28). Revised 2026-08-14: re-anchored the host, base-class and AppHost citations to
their current lines; scoped the "only `@rendermode` attributes" enumeration to the repos this ADR
governs (the workspace now also holds `InteractiveServer`-only sample and workshop heads); corrected the
list-page inheritor count from sixteen to eighteen; and narrowed the Helpdesk `MudTable` claim to its
list page. Revised 2026-08-23: re-anchored the ADC `App.razor`, `ADCHome`, AppHost and ADR-051
citations to their current lines, and set the list-page inheritor count to nineteen (thirteen in ADC,
six in Store), eighteen of them routable.

## Context
Both web applications are Blazor Web Apps: a static server-rendered (SSR) prerender pass produces the
first HTML, then an interactive runtime takes over, either a Blazor Server SignalR circuit or a
WebAssembly runtime downloaded into the browser. Which of those runtimes takes over, and whether the
prerender pass happens at all, is a per-application choice with consequences that reach into
authentication, localization, theming, data fetching, and the test suite.

Four accepted ADRs already reason about that transition and each treats it as **given context** rather
than deciding it: ADR-022 solves `[Authorize]` on fresh GETs by reading an HttpOnly cookie "during SSR
prerender" (`022-browser-session-cookie-auth.md:18`); ADR-027 states that its hard part is flowing one
culture decision through "a Blazor `InteractiveAuto` app (SSR prerender, InteractiveServer circuit,
InteractiveWebAssembly client)" (`027-multi-locale-i18n.md:13-16`); ADR-028 repeats the same three-phase
premise for the theme and records that "there is no free no-flash for InteractiveAuto"
(`028-dark-theme-mode.md:11-15`, `028-dark-theme-mode.md:64-66`); ADR-051 builds the whole client token
lifecycle around three heads with three storage stories and ends with "UI code never branches on render
mode" (`051-client-auth-token-lifecycle.md:13-28`, `051-client-auth-token-lifecycle.md:36`). ADR-042
covers the MAUI head and never mentions render modes at all. So four decisions depend on a render-mode
policy that no ADR states, and the policy itself is only discoverable by reading two `App.razor` files,
two AppHosts, two CI workflows, and one framework base class. This ADR states it.

## Decision
Run **one render mode for the entire routable component tree**, chosen at the application root, default
`InteractiveAuto`, with prerendering left on and the resulting double fetch removed at the data-fetch
layer rather than by weakening the render mode.

- **The mode is set once, at the root, on the shared router.** Each app's `App.razor` applies the same
  mode expression to `HeadOutlet` and to `Routes`
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Components/App.razor:41`, `App.razor:45`;
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Components/App.razor:17`, `App.razor:21`), and `Routes`
  is the single framework-owned router shared by both apps
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Routes.razor:7`). **No page or component in either app
  declares its own `@rendermode`**: across the repos this ADR governs (MMCA.ADC, MMCA.Store,
  MMCA.Helpdesk, plus the MMCA.Common gallery) the only `@rendermode` attributes are those four plus the
  two in each `InteractiveServer`-only host, and no `[RenderModeInteractive*]` attribute exists anywhere.
  The workspace also carries local sample and workshop solutions that are `InteractiveServer`-only heads
  of the same shape (MMCA.ECommerce and the Contoso.Support workshop seed); they are outside this ADR's
  scope and are not counted here.
- **`InteractiveAuto` is the default for both web heads.** Each `App.razor` resolves an `AppRenderMode`
  property that returns `InteractiveAuto` unless an E2E flag is set
  (`MMCA.ADC/.../App.razor:66-77`, `MMCA.Store/.../App.razor:39-42`). Both hosts register both runtimes on
  both sides of the pipeline: `AddInteractiveServerComponents()` + `AddInteractiveWebAssemblyComponents()`
  at service registration and `AddInteractiveServerRenderMode()` + `AddInteractiveWebAssemblyRenderMode()`
  on `MapRazorComponents<App>()`
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:43-45`, `Program.cs:206-208`;
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:85-87`, `Program.cs:204-206`).
- **Prerendering stays enabled.** No host anywhere in the workspace passes `prerender: false` or
  constructs a render mode with prerendering disabled; every render mode in use is the stock static
  instance. Prerender is what ADR-022's SSR cookie scheme exists to serve, so it is kept and its cost is
  paid down elsewhere.
- **The SSR/interactive double fetch is removed once, in the shared list-page base.**
  `DataGridListPageBase<TDto>` injects `PersistentComponentState`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:31`), restores a
  per-page-type key `grid:{TypeFullName}` in `OnInitialized` (`DataGridListPageBase.cs:136-140`), and
  registers a persist callback so the prerender pass hands its rows forward
  (`DataGridListPageBase.cs:151-161`). The first interactive `ServerData` call returns that snapshot and
  clears it instead of issuing a redundant API round-trip (`DataGridListPageBase.cs:452-461`), which the
  base's own comment records as the fix for the visible cancel-retry cycle caused by the
  SSR to Server to WASM transition (`DataGridListPageBase.cs:134-137`). The payload is a
  `PersistedGridState` record of items plus total (`DataGridListPageBase.cs:834`). **Nineteen types
  inherit this base** (thirteen in ADC, six in Store), eighteen of them routable list pages plus ADC's
  non-routable Engagement `AttendeeSearchPanel`
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/CheckIn/AttendeeSearchPanel.razor.cs:16`),
  so the policy is written once and adopted by inheritance.
- **The persist callback declares `InteractiveAuto` explicitly.** The base passes
  `RenderMode.InteractiveAuto` as the second argument to `RegisterOnPersisting`
  (`DataGridListPageBase.cs:161`) because a page that inherits its mode from
  `<Routes @rendermode="...">` declares none of its own, and the callback would otherwise fail render-mode
  inference during the static prerender pass; the reasoning is recorded inline
  (`DataGridListPageBase.cs:144-150`).
- **The prerender fetch is time-bounded so a cold backend cannot block the page.** `CreateFetchCts` links
  to the request token and, when `RendererInfo.IsInteractive` is false, cancels after
  `PrerenderFetchTimeoutMs` (5000 ms) (`DataGridListPageBase.cs:84`, `DataGridListPageBase.cs:525-534`).
  On timeout the page returns an empty grid that the first interactive call refills
  (`DataGridListPageBase.cs:496-503`).
- **Detail and dashboard pages take the other route: they skip the prerender fetch entirely.** An early
  `if (!RendererInfo.IsInteractive) return;` guard in `OnParametersSetAsync` / `OnInitializedAsync` appears
  across both apps, with two different stated reasons: avoiding the doubled reads under `InteractiveAuto`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSessionDetail.razor.cs:88-95`,
  `.../Pages/Public/PublicSpeakerDetail.razor.cs:59`, `.../Pages/Home/ADCHome.razor.cs:116`,
  `.../Pages/Speaker/SpeakerDashboard.razor.cs:65`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLive.razor.cs:69`,
  `.../Pages/SessionLive/PresenterView.razor.cs:56`) and the fact that no auth token can be read at
  prerender time so every authenticated call would 401
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/Order/OrderDetail.razor.cs:68-77`,
  `.../Pages/ShoppingCart/ShoppingCartDetail.razor.cs:63`).
- **One page outside the grid family repeats the persistence pattern by hand.** Store's `CatalogBrowse`
  persists its prerendered products, categories and filter tuple and rehydrates them when the interactive
  pass starts on the same filter combination
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/Pages/Catalog/CatalogBrowse.razor.cs:66-72`,
  `CatalogBrowse.razor.cs:92-105`, `CatalogBrowse.razor.cs:124-139`, `CatalogBrowse.razor.cs:155-168`),
  using the single-argument `RegisterOnPersisting` overload (`CatalogBrowse.razor.cs:96`) rather than the
  explicit-render-mode form the base needs. It is a copy of the policy, not an instance of it.
- **Because any page may run in either runtime, both runtimes register the same services.** Each WASM
  client `Program.cs` mirrors its server host's registrations (MudBlazor, `AddUIShared`, browser device
  capabilities, the auth trio, the same conditional per-module UI registrations)
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:37-80` against
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:43-89`;
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:30-63` against
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:85-127`), and each client bootstraps its thread
  culture from the same cookie before running so hydration does not disagree with the prerender
  (`MMCA.ADC/.../MMCA.ADC.UI.Web.Client/Program.cs:86`,
  `MMCA.Store/.../MMCA.Store.UI.Web.Client/Program.cs:69`, ADR-027).
- **A build-time layer rule is what keeps the shared UI package runnable in the browser.**
  `MMCA.Common.UI` may not reference Domain, Application, Infrastructure or API, and the enforcement
  target says so in its failure text: "UI depends only on Shared for Blazor WASM compatibility"
  (`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:75-88`). Server-only components are
  hoisted out into `MMCA.Common.UI.Web` for exactly that reason, for example the shared `/Error` page,
  whose `HttpContext` cascading parameter cannot exist in the WASM-safe package
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Components/Pages/Error.razor:9-14`).
- **`InteractiveServer` is pinned only under E2E configuration flags, never in production or local dev.**
  `E2E:ForceServer` returns `InteractiveServer`; ADC additionally honors `E2E:ForceWebAssembly`, which
  returns `InteractiveWebAssembly` and wins if both are set (`MMCA.ADC/.../App.razor:66-77`,
  `MMCA.Store/.../App.razor:39-42`). Those config keys are injected only by the AppHosts, and only when the
  matching environment variable is present (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:363-390`,
  `MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:355-363`). In CI only `E2E_FORCE_SERVER` is
  exported (`MMCA.ADC/.github/workflows/e2e.yml:218`, `MMCA.Store/.github/workflows/e2e.yml:210`);
  ADC's workflow deliberately does **not** set `E2E_FORCE_WASM` and records why
  (`MMCA.ADC/.github/workflows/e2e.yml:203-210`). Both `App.razor` comments cite the same trace evidence:
  under `InteractiveAuto` each test's second page load switched to the background-downloaded WASM bundle,
  whose runtime boot on a shared 2-core runner exceeded every suite wait while the download starved the
  live circuits.
- **Adoption is not uniform: two hosts are `InteractiveServer`-only and hardcode it.** MMCA.Helpdesk pins
  the literal mode on `HeadOutlet` and `Routes`
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/App.razor:10`, `App.razor:14`) and
  registers only the server render mode
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Program.cs:14-15`, `Program.cs:97-98`). It has **no `.Client` project at
  all**, so `InteractiveAuto` is not available to it, and neither of its two ticket pages uses the shared
  list-page base: the list page renders a `MudTable` directly
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/Pages/Tickets.razor:32-66`) and the
  detail page is a plain MudBlazor form, so none of the persistence machinery above applies there. The framework's own component gallery is likewise
  `InteractiveServer`-only (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Components/App.razor:22`,
  `App.razor:26`, `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/GalleryHost.cs:123-124`). ADR-028
  already noted Helpdesk's status ("As an `InteractiveServer`-only host it has no WASM boundary",
  `028-dark-theme-mode.md:52`); this ADR makes it part of the record rather than an aside.

## Rationale
- **`InteractiveAuto` gets both halves without asking page authors to choose.** The first visit gets the
  Server circuit's immediate interactivity while the WASM bundle downloads in the background; return
  visits run client-side and stop consuming a server circuit. Because the mode is applied at the root
  router, no page has to opt in or know which runtime it is in, which is the same posture ADR-051 takes
  for tokens (`051-client-auth-token-lifecycle.md:36`).
- **Keeping prerender is not negotiable, so the double fetch had to be fixed instead.** Prerender is the
  entire reason ADR-022's SSR cookie scheme exists, and it is what makes public browse pages render
  without waiting on a runtime boot. Disabling it would have removed the duplicate fetch by removing the
  feature; persisting the prerender result keeps both.
- **Encoding the policy in a base class beats documenting it.** Nineteen types inherit the
  persist/restore path, the explicit render-mode registration, and the bounded prerender fetch by
  inheriting one type; the alternative was the same 30 lines repeated per page, which is what
  `CatalogBrowse` shows happening the moment a page falls outside the family.
- **Two anti-double-fetch mechanisms, matched to two page shapes.** A list page has data worth carrying
  across the transition (the grid would otherwise flash empty), so it persists. A detail page behind
  `[Authorize]` cannot even fetch at prerender time without a token, so it skips and renders its loading
  state. Persisting where skipping would do would only inflate the HTML.
- **The E2E pin is a runner concession, not a product decision.** Pinning `InteractiveServer` is confined
  to a config flag that only the AppHost sets and only CI exports, so the production and local-dev path
  is unchanged by it, and the flag's justification (with run ids) lives next to the code that reads it.

## Trade-offs
- **Everything shared has to run in both runtimes.** The WASM-compatibility layer rule
  (`MMCA.Common.LayerEnforcement.targets:75-88`) forbids the shared UI package from touching Domain,
  Application, Infrastructure or API, so anything server-only needs a second package
  (`MMCA.Common.UI.Web`) and an explicit `AddAdditionalAssemblies` entry in every host.
- **Service registration is duplicated per head and can drift.** The WASM client and the server host
  register the same MudBlazor, `AddUIShared`, capability and per-module services in two separate
  `Program.cs` files; nothing checks that the two lists agree, so a service added to one and not the other
  fails only in the runtime that missed it.
- **The double-fetch fix is opt-in per page, not a framework guarantee.** Only pages that inherit
  `DataGridListPageBase` or hand-roll the pattern (`CatalogBrowse`) or take the
  `RendererInfo.IsInteractive` guard avoid the duplicate work; a new page that does none of the three
  silently fetches twice on every load. No test or analyzer flags that.
- **Persisting grid rows inflates the prerendered HTML.** The full page of DTOs is serialized into the
  response so the interactive pass can reuse it (`DataGridListPageBase.cs:156`), trading response size for
  one fewer API round-trip; a large page size makes that trade worse.
- **The deploy-gating E2E suite measures a mode production does not run.** Because CI pins
  `InteractiveServer`, the chromium e2e-gate never exercises the `InteractiveAuto` transition it was pinned
  away from, so a regression specific to the WASM handover cannot be caught by that gate. The Core Web
  Vitals numbers carry the same caveat in their own remarks: they "reflect Server-mode
  prerender-then-hydrate under runner contention, not production's InteractiveAuto on real hardware"
  (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/WebVitalsTests.cs:10-13`). The pseudo-localization
  suite likewise had to route its activation through the culture cookie because the pinned circuit reads
  cookies but not the original query string
  (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/PseudoLocalizationTests.cs:22-31`).
- **Nothing enforces the root render mode.** There is no fitness test asserting that `Routes` carries
  `InteractiveAuto`, so a new host picks whatever it picks; Helpdesk and the gallery already differ
  (deliberately), and a fourth host could differ by accident.
- **A first-paint flash remains for anything restored after hydration.** ADR-028's theme read runs in
  `OnAfterRenderAsync` and deliberately not during prerender, so `InteractiveAuto` still permits a brief
  wrong-theme paint (`028-dark-theme-mode.md:33-40`, `028-dark-theme-mode.md:64-66`); the render-mode
  choice does not close that gap, it defines it.

## Related
ADR-022 (reads the HttpOnly session cookie during the SSR prerender pass this decision keeps enabled),
ADR-027 (flows one culture through the SSR to Server to WASM sequence this decision establishes, and owns
the WASM-side culture bootstrap both clients run), ADR-028 (the theme faces the same three-phase agreement
problem and records the residual `InteractiveAuto` flash), ADR-051 (the client token lifecycle whose three
storage stories exist because of this split, and whose "UI code never branches on render mode" invariant
this root-level choice makes possible), ADR-042 (the MAUI head, which hosts the same components in a
BlazorWebView and therefore sits outside the render-mode model entirely).
