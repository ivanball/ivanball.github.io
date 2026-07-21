# 15. Common UI Framework (MudBlazor components, theme, base pages)

**What this chapter covers.** `MMCA.Common.UI` is the Blazor presentation package, the one
layer in the framework that, like `Grpc`, is allowed to reference **`Shared` only** (primer §1).
It depends on no Application/Domain/Infrastructure type so it can compile into a Blazor WebAssembly
bundle, and it ships the reusable building blocks every consumer UI assembles into pages: a
**server-paged data-grid list-page base class**, the brand **MudBlazor theme**, a **typed HTTP
service base** for talking to the WebAPI, the **client-side authentication + token-refresh seam**,
**list-page state preservation** across navigation, a **pluggable UI-module** contract, and a
turnkey **notification inbox / push** feature. This is the framework half of the "write-once UI,
render everywhere" story from primer §2, the per-app and per-module Razor pages (ADC's
Conference/Engagement/Identity UIs, group 21) derive from and consume these primitives, and the
same components render across Blazor Server, WebAssembly, and the .NET MAUI hybrid host with no
per-platform reimplementation. `[Rubric §18, UI Architecture & Component Design]` (assesses
component reuse, separation of presentation from data access, and a coherent composition model);
nearly every type here exists so a consumer page is *composed*, not hand-rolled.

**The data-access seam: `IEntityService` over a named HttpClient.** A UI never calls
`HttpClient` directly. It depends on
[`IEntityService<TEntityDTO, TIdentifierType>`](#ientityservicetentitydto-tidentifiertype),
the CRUD contract (`GetAllAsync`, `GetPagedAsync`, `GetByIdAsync`, `AddAsync`, `UpdateAsync`,
`DeleteAsync`, plus a `GetAllForLookupAsync` for dropdowns), and gets behaviour for free from the
abstract
[`EntityServiceBase<TEntityDTO, TIdentifierType>`](#entityservicebasetentitydto-tidentifiertype).
That base derives from
[`AuthenticatedServiceBase`](#authenticatedservicebase), which
owns the two cross-cutting concerns of an outbound API call: a **Polly** exponential-backoff retry
policy (3 retries on `HttpRequestException` or 5xx, backoff 2s/4s/8s,
`AuthenticatedServiceBase.cs:22-25`) and a helper that stamps the JWT Bearer token onto a freshly
created `"APIClient"` `HttpClient` from `IHttpClientFactory`
(`AuthenticatedServiceBase.cs:36-55`). The named `"APIClient"` is wired once in
[`AddUIShared`](#dependencyinjection) with its base address and an
[`AuthDelegatingHandler`](#authdelegatinghandler) message handler
(`DependencyInjection.cs:61-74`). Responses come back wrapped in the same
[`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) /
[`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt) envelopes the API
returns, and `EntityServiceBase.SendRequestAsync` pulls domain/validation errors out of a failed
response body via
[`ServiceExceptionHelper`](#serviceexceptionhelper) *before*
`EnsureSuccessStatusCode` can throw a contextless exception (`EntityServiceBase.cs:185-189`), so a
back-end `Result.Failure` surfaces to the page as a typed, displayable error. `[Rubric §3, Clean
Architecture]` and `[Rubric §9, API & Contract Design]`: the UI binds to a DTO contract and an
interface, never to the server's internals, and the wire envelope is uniform across every entity.

**The list page: `DataGridListPageBase<TDto>`.** This is the most concept-dense type in the group
and the centrepiece of the "compose, don't repeat" thesis. Every list screen in every consumer app
derives from
[`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto), a
`ComponentBase` that encapsulates what was otherwise copy-pasted onto each page: server-side paging
against `MudDataGrid<T>`, `CancellationTokenSource` lifecycle, loading state, filter/sort extraction
from MudBlazor's `GridState<T>`, error surfacing through `ISnackbar`, **viewport-driven mobile vs.
desktop rendering** (it implements `IBrowserViewportObserver`, switching to a card list below the
960 px sidebar-collapse breakpoint), and a careful `IAsyncDisposable`/`IDisposable` teardown
(`DataGridListPageBase.cs:20`). Crucially it also solves a Blazor render-mode problem: it persists
the grid data captured during SSR pre-render via `PersistentComponentState` into a
[`PersistedGridState`](#persistedgridstate) record, then restores it
on the first interactive `ServerData` call (`DataGridListPageBase.cs:122-150`) so the InteractiveAuto
SSR→Server→WASM transition doesn't flash an empty grid and re-fetch. `[Rubric §23, Front-End
Performance & Rendering]` (assesses render efficiency, avoiding redundant fetches/round-trips), this
state-persistence dance is exactly that concern made concrete; the inline comments cite the
MudDataGrid v9 pager quirks the code works around (see also the team memory on the
`RowsPerPage`/`CurrentPage` setter bug).

**State preservation across navigation: `ListPageStateService` + query state.** Paging, sort, and
filter are kept in the URL query string as the source of truth (so deep-links and browser
back/forward replay correctly), while the noisier scroll position lives in
[`ListPageStateService`](#listpagestateservice), a **per-circuit
scoped** service backed by an in-memory dictionary that mirrors entries through `sessionStorage`
(via a `nav-interop.js` module) so state survives circuit teardowns, `forceLoad` navigations, and
the SSR→WASM transition (`ListPageStateService.cs:98-162`). The immutable
[`ListPageState`](#listpagestate) record carries page/pageSize/scroll
/sort/filters and is updated with `with` expressions. The companion
[`ListPageQueryStateService`](#listpagequerystateservice) handles the
URL half, and [`NavigationHistoryService`](#navigationhistoryservice)
tracks an in-app history stack for "back" affordances. `[Rubric §19, State Management & Data Flow]`
(assesses a deliberate, scoped state model rather than ambient globals), note these are registered
`Scoped` so each Blazor circuit/user session gets its own instance, and `[Rubric §25, Navigation,
Routing & Information Architecture]` for the history/return-URL handling (see
[`ReturnUrlProtector`](#returnurlprotector) and the
[`RoutePaths`](#routepaths)/[`NavItem`](#navitem)
route catalogue).

**Authentication and the token-refresh seam.** Client-side auth is contracted by
[`IAuthUIService`](#iauthuiservice) (login, register, OAuth-code
exchange, logout, refresh, change-password) and implemented by
[`AuthUIService`](#authuiservice), which calls the WebAPI `auth/*`
endpoints, persists tokens through
[`ITokenStorageService`](#itokenstorageservice), and pushes auth-state
changes through
[`JwtAuthenticationStateProvider`](#jwtauthenticationstateprovider)
so Blazor's `AuthorizeView`/`<CascadingAuthenticationState>` reacts instantly (`AuthUIService.cs:8-18`).
The clever part is the **host-polymorphic token refresh**: the single
[`ITokenRefresher`](#itokenrefresher) abstraction has two
implementations chosen per host,
[`SameOriginProxyTokenRefresher`](#sameoriginproxytokenrefresher)
for the browser (the refresh token lives in an **HttpOnly cookie**, rotation happens server-side via
a same-origin `/auth/session/token` proxy, so JS never sees the refresh token) and
[`DirectApiTokenRefresher`](#directapitokenrefresher) for MAUI (the
refresh token sits in OS SecureStorage and is exchanged directly against `auth/refresh`)
(`ITokenRefresher.cs:3-12`). `[Rubric §26, Front-End Security]` (assesses token handling, XSS
exposure, secret storage): keeping the refresh token out of JS-reachable storage in the browser is a
deliberate XSS-mitigation; the OAuth **code-exchange** indirection keeps tokens out of the address
bar (ADR-004 covers the cross-service JWKS validation these tokens flow into). The
[`ISessionCookieSync`](#isessioncookiesync) /
[`JsFetchSessionCookieSync`](#jsfetchsessioncookiesync) pair mirrors
the in-memory access token into the HttpOnly cookie that the SSR prerender reads, so the very first
server render of an authenticated page already knows who you are.

**Design system and theming: `MMCATheme` + `BrandColors`.** Visual consistency is centralized in
one static [`MMCATheme`](#mmcatheme) `MudTheme` (light and dark
palettes, Inter typography scale, a 6 px border radius, `MMCATheme.cs:11`), applied via
`MudThemeProvider` from the shared `MmcaThemeProviders` component that the root layout renders once
(`MmcaThemeProviders.razor:11`). The brand palette is sourced from a single C# source of truth,
[`BrandColors`](#brandcolors); the CSS custom properties in
`app.css` must mirror it, and a `BrandColorTokenTests` fitness test asserts the two stay in sync
(`MMCATheme.cs:15-17`). The colour choices carry explicit WCAG-contrast reasoning in the comments
(e.g. teal bumped to `#00796B` for a ~5.3:1 ratio on light surfaces, `MMCATheme.cs:21-24`).
`[Rubric §20, Design System, Theming & Consistency]` (assesses a single source of truth for tokens,
dark-mode support, consistent typography) is the home category here, and `[Rubric §21,
Accessibility (a11y)]` is woven into the palette itself, colour decisions are made to clear the
4.5:1 normal-text floor, complementing the axe-core WCAG 2.1 AA scans run in the UI E2E suite.
[`BreakpointConstants`](#breakpointconstants) names the responsive
thresholds that `DataGridListPageBase` and consumer layouts switch on. `[Rubric §22, Responsive &
Cross-Browser/Device]`.

**Internationalization: one culture cookie, end to end.** The framework now serves `en-US` (default)
and Spanish (`es`), and the hard part is not the translation files, it is making one culture decision
agree across the `InteractiveAuto` split (SSR prerender → InteractiveServer circuit →
InteractiveWebAssembly client) *and* across the cross-origin REST services behind the Gateway, with no
flash of the wrong language and no prerender/hydration mismatch (ADR-027, which supersedes the prior
single-locale stance of ADR-011). A single non-HttpOnly culture cookie is the source of truth: the WASM
client reads it on startup through
[`MmcaCultureBootstrap`](#mmcaculturebootstrap)`.SetBrowserCultureAsync`,
which sets `CultureInfo.DefaultThreadCurrent[UI]Culture` *before* `RunAsync()` (falling back to
[`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures)`.Default`,
`MmcaCultureBootstrap.cs:22-34`) so prerender and hydration render the same language. Outbound API calls
then forward the active culture as an `Accept-Language` header via
[`CultureDelegatingHandler`](#culturedelegatinghandler)
(`CultureDelegatingHandler.cs:20-25`), wired into the `"APIClient"` pipeline in
[`AddUIShared`](#dependencyinjection) (`DependencyInjection.cs:58,74`),
because the cross-origin Gateway does not carry the cookie through to the services, so that header is
what makes a backend `Result.Failure` come back localized. View and chrome strings are externalized to
co-located `.resx` looked up by `IStringLocalizer<T>` (`AddLocalization()` at `DependencyInjection.cs:40`);
[`SharedResource`](#sharedresource) (`SharedResource.cs:9`) is the marker
type whose `IStringLocalizer<SharedResource>` anchors the cross-cutting chrome strings the shared layout
renders (`MainLayout.razor:12`).
[`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures) (group 12) is the canonical
allowlist; adding a locale is adding a `.es.resx` sibling and one allowlist entry, not new
infrastructure. `[Rubric §27, Internationalization]` (assesses externalized strings, a culture flow that
survives the render-mode boundary, and server-side localized errors) is the home category here.

**Per-user preference persistence.** A signed-in user's culture choice follows them across devices: it
is persisted to the Identity profile (`User.PreferredCulture`) through
[`IUserPreferenceWriter`](#iuserpreferencewriter) /
[`ApiUserPreferenceWriter`](#apiuserpreferencewriter), which PUTs to
`auth/preferences` over the shared `"APIClient"` (`ApiUserPreferenceWriter.cs:34-35`). The write is
strictly **best-effort and anonymous-no-op** (`ApiUserPreferenceWriter.cs:25-29`): the cookie/localStorage
is the device-local runtime channel, the DB value is the cross-device source of truth, and a failed or
skipped persist never breaks the in-page switch. The write payload is the private
[`UserPreferencesRequest`](#userpreferencesrequest) record
(`ApiUserPreferenceWriter.cs:19`); the login-time read side,
[`ApiUserPreferenceReader`](#apiuserpreferencereader) behind
[`IUserPreferenceReader`](#iuserpreferencereader), GETs the same
endpoint and returns the immutable
[`UserPreferences`](#userpreferences) record, whose `null` fields mean
"leave unchanged" (`ApiUserPreferenceReader.cs:18-35`). `[Rubric §19, State Management & Data Flow]` (a deliberate, scoped channel for user
state rather than ambient globals).

**Dark mode: binding the palette that was always there.**
[`MMCATheme`](#mmcatheme) has always declared a complete `PaletteDark`
(`MMCATheme.cs:50-86`) beside the light palette, but the provider was once hard-wired to light: designed,
then never connected. [`ThemeService`](#themeservice) (`ThemeService.cs:16`,
registered `Scoped` in `AddUIShared` at `DependencyInjection.cs:83`) now owns the preference. The shared
`MainLayout` renders one `MmcaThemeProviders` component (`MainLayout.razor:14`) that binds
`<MudThemeProvider Theme="MMCATheme.Instance" @bind-IsDarkMode>` (`MmcaThemeProviders.razor:11`), and the
service persists the choice to a non-HttpOnly cookie + `localStorage` through a `theme.js` interop module
(`ThemeService.cs:53-59`), defaulting to the OS `prefers-color-scheme` (its `systemPrefersDark` interop)
only when nothing is stored (`ThemeService.cs:42-45`). It raises an `OnChange` event (`ThemeService.cs:28`)
so the app-bar toggle and the layout stay in sync, and the same per-user seam carries the choice to
`User.PreferredTheme` (ADR-028, which reuses ADR-027's cookie/profile/bootstrap machinery rather than
inventing a parallel one). The `ThemeToggle` component ships in that shared `MainLayout` beside the
`CultureSwitcher` in the `appbar-icon-actions` slot (`MainLayout.razor:32-35`), so every consumer host
gets both controls with no per-host wiring. `[Rubric §20, Design System, Theming & Consistency]`
(dark-mode support over a single token source) and `[Rubric §19, State Management]` are the home
categories. **Honest caveat:** unlike locale, the **no-flash SSR bootstrap is not yet wired for theme**,
`MmcaThemeProviders` calls `ThemeService.InitializeAsync` from `OnAfterRenderAsync(firstRender)` and
deliberately does not read the stored value during SSR prerender (`MmcaThemeProviders.razor:21-30`,
`ThemeService.cs:34-49`), so the bound mode is corrected just after hydration and a brief wrong-theme
flash on first paint is currently possible (tracked as an ADR-028 follow-up).

**Pluggable UI modules: `IUIModule`.** The module system that organizes the back end (primer §2;
[`IModule`](group-14-module-system-composition.md#imodule), group 14) has a UI counterpart in
[`IUIModule`](#iuimodule). Each consumer module exposes its
navigation entries ([`NavItem`](#navitem) list), the `Assembly`
holding its Razor pages (so the host can `AddAdditionalAssemblies` for route discovery), and
optional app-bar / root-layout component types (`IUIModule.cs:10-23`). The host enumerates the
registered `IUIModule`s to build the sidebar and discover routes, so adding a feature module wires
its pages and menu items into the shell with no edits to the shell itself, the vertical-slice and
open/closed ideas applied to the front end. `[Rubric §18, UI Architecture]` and `[Rubric §1,
SOLID]` (Open/Closed).

**A complete vertical slice shipped in the framework: notifications.** Unlike the rest of the
package (which is base classes consumers extend), the `Notifications` area is a *finished* feature
that any app can switch on: the
[`NotificationUIModule`](#notificationuimodule) (an `IUIModule`)
contributes the inbox route and an app-bar bell; the
[`NotificationInbox`](#notificationinbox)/[`NotificationList`](#notificationlist)/[`NotificationSend`](#notificationsend)
Razor components render it; [`NotificationInboxService`](#notificationinboxservice)
(behind [`INotificationInboxUIService`](#inotificationinboxuiservice))
fetches the inbox over HTTP; [`PushNotificationService`](#pushnotificationservice)
(behind [`IPushNotificationUIService`](#ipushnotificationuiservice))
manages opt-in; and [`NotificationHubService`](#notificationhubservice)
holds a **SignalR** connection to the API's notification hub, reconnecting with exponential backoff
and invoking a callback that surfaces incoming notifications as MudBlazor snackbars
(`NotificationHubService.cs:9-43`). Shared mutable UI state lives in
[`NotificationState`](#notificationstate); the whole feature is
wired by its own
[`DependencyInjection`](#dependencyinjection) in the `Notifications`
namespace, kept separate so apps that don't want real-time notifications never pay for the SignalR
plumbing.

**How it all wires up at startup.** A host's `Program.cs` calls
[`AddUIShared(configuration)`](#dependencyinjection) (a C#
`extension(IServiceCollection)` member, per primer §4) once: it binds and *validates on start*
[`ApiSettings`](#apisettings) (fail-fast on missing config,
`DependencyInjection.cs:29-33`), binds [`LayoutSettings`](#layoutsettings)
without validation (deliberately optional, defaulting to `BrandName = "MMCA"` / empty footer,
`DependencyInjection.cs:36-37`, `LayoutSettings.cs:7-17`),
registers the `"APIClient"` HttpClient with its auth and culture handlers, and `TryAdd`s the auth service, the
list-page state services, the navigation history service, the [`ThemeService`](#themeservice),
and a default [`IOAuthUISettings`](#ioauthuisettings) that downstream apps override, then finally
`AddDeviceCapabilityDefaults()` so a form-factor contract resolves on every head (ADR-042)
(`DependencyInjection.cs:27-97`). The use of `TryAdd*` is what lets a consumer pre-register its own
implementations before this runs. Server hosts additionally call `AddClientAuthSessionCookieSync`
and the [`WebApplicationExtensions.UseAuthenticatedNoStore`](#webapplicationextensions)
middleware, which emits `Cache-Control: no-store` on authenticated HTML responses so a logged-out
user pressing Back never sees a previous user's logged-in page from the bfcache
(`WebApplicationExtensions.cs:25-45`), another `[Rubric §26, Front-End Security]` touch. The
small Level-0 supporting cast, [`ErrorMessages`](#errormessages),
[`NavSection`](#navsection),
[`NotificationRoutePaths`](#notificationroutepaths),
[`UIModuleConfiguration`](#uimoduleconfiguration),
[`IHomePageContent`](#ihomepagecontent),
[`JwtTokenInfo`](#jwttokeninfo),
[`MauiBackNavigationBridge`](#mauibacknavigationbridge) and friends,
fills in route catalogues, home-page content, and MAUI back-button bridging that the higher-level
services lean on; form-factor detection has since graduated into its own device-capability layer
([`IFormFactor`](group-26-device-capability-layer.md#iformfactor) and friends, ADR-042, group 26). The presentational helper
[`MoneyExtensions`](#moneyextensions) formats
[`Money`](group-02-domain-building-blocks.md#money) for display (culture-invariant, so `$12.50 USD`
never becomes `$12,50 USD` on a European host), display concerns kept out of the domain value
object, exactly where Clean Architecture wants them.

Read the per-type sections that follow for the mechanics. The companion consumer-side UI lives in
the ADC module-UI chapters (group 21), and the bUnit/Playwright tests that exercise this package are
covered in the testing chapter (group 25).

### BreakpointConstants

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/BreakpointConstants.cs:9` · Level 0 · class (static)

- **What it is**: A single static helper that answers "is this viewport a mobile viewport?" so C# viewport detection lines up with the CSS media-query boundary used across the design system.
- **Depends on**: `MudBlazor.Breakpoint` (NuGet); the CSS `@media` boundary at 960px in the shared stylesheet.
- **Concept introduced**: `[Rubric §22, Responsive & Cross-Browser]` assesses whether a codebase has one authoritative breakpoint definition rather than magic numbers scattered per component; this class embodies it by centralising the mobile/desktop split in one predicate. The class comment (`BreakpointConstants.cs:12`) documents the "< 960 px" threshold so the C# side and the CSS side share one number.
- **Walkthrough**: The only member is `IsMobileBreakpoint(Breakpoint breakpoint)` (`BreakpointConstants.cs:16`), an expression-bodied method returning `true` when the MudBlazor breakpoint is `Xs` or `Sm`. That is the sole condition; anything `Md` or wider is treated as desktop.
- **Why it's built this way**: Static and dependency-free so any Razor component can call it without DI, and so changing the mobile threshold is a one-line edit paired with one CSS rule rather than a hunt through component code.
- **Where it's used**: [DataGridListPageBase<TDto>](#datagridlistpagebasetdto) and other layout-aware components that switch between a desktop `MudDataGrid` and a mobile card layout on viewport change.

---

### IApiSettings

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/IApiSettings.cs:6` · Level 0 · interface

- **What it is**: The read-only contract describing where the WebAPI backend lives, with a deliberate split between the URL the server uses and the URL served to the browser.
- **Depends on**: Nothing; implemented by [ApiSettings](#apisettings) and consumed by the named `HttpClient` setup in [DependencyInjection](#dependencyinjection).
- **Concept introduced**: `[Rubric §12, Performance & Scalability]` assesses whether the deployment can avoid unnecessary network hops; the dual-endpoint idea directly serves it. `ApiEndpoint` (`IApiSettings.cs:9`) is the base URL the host uses for its own calls, while `WasmApiEndpoint` (`IApiSettings.cs:17`) is the endpoint pushed to the WebAssembly client over `/client-config`. The doc comment states the intent: the server may use an internal URL (faster, no public DNS) while the browser uses the external URL, and `WasmApiEndpoint` falls back to `ApiEndpoint` when null.
- **Walkthrough**: Two nullable string getters only: `ApiEndpoint` and `WasmApiEndpoint`. Both are `string?`; the interface makes no promise that either is populated, so validation lives on the concrete class.
- **Why it's built this way**: An interface (not the concrete class) is what HTTP-client configuration binds against, keeping that setup mockable in tests and decoupled from the options binding mechanism.
- **Where it's used**: [ApiSettings](#apisettings) implements it; the `/client-config` bootstrap serves `WasmApiEndpoint` to the browser.
- **Caveats / not-in-source**: The current [DependencyInjection](#dependencyinjection) `AddUIShared` registers a single named `"APIClient"` HttpClient bound to `ApiEndpoint`; the `WasmApiEndpoint` fallback and its browser delivery happen outside this method (the `/client-config` endpoint), so this file only defines the contract, not the two-client wiring.

---

### IHomePageContent

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IHomePageContent.cs:8` · Level 0 · interface

- **What it is**: A hook that lets each consuming application supply its own landing-page component at the `/` route without forking the shared routing or layout.
- **Depends on**: `Microsoft.AspNetCore.Components.DynamicComponent` (referenced in the doc comment) and each app's own landing-page Razor component.
- **Concept introduced**: `[Rubric §18, UI Architecture]` assesses how well shared UI infrastructure adapts to per-app content without duplication; this interface embodies it. The `/` route is defined once in the shared package and renders a `DynamicComponent` bound to `ComponentType`, so a new app plugs in a home page by registering an implementation rather than editing the route.
- **Walkthrough**: Two read-only members: `ComponentType` (`IHomePageContent.cs:11`), the `System.Type` of the Razor component to render as the home-page body, and `PageTitle` (`IHomePageContent.cs:14`), the browser-tab title. `ComponentType` is passed to `DynamicComponent` at runtime, so the shared page needs no compile-time reference to the app-specific component.
- **Why it's built this way**: Runtime `Type` binding via `DynamicComponent` keeps the shared package free of any dependency on downstream landing pages.
- **Where it's used**: The shared home-page component in `MMCA.Common.UI`; each consumer (ADC, Store) registers its own implementation in DI.

---

### LayoutSettings

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/LayoutSettings.cs:7` · Level 0 · class (sealed)

- **What it is**: Strongly-typed options for light white-labeling: the navbar brand text and the footer text, bound from the `"Layout"` configuration section.
- **Depends on**: `Microsoft.Extensions.Configuration` (via options binding); the shared navbar and footer components.
- **Concept introduced**: `[Rubric §10, Cross-Cutting Concerns]` assesses whether presentation constants are externalised rather than hard-coded; this class embodies it by moving brand/footer copy into configuration.
- **Walkthrough**: `SectionName = "Layout"` (`LayoutSettings.cs:10`) names the bound section. `BrandName` (`LayoutSettings.cs:13`) defaults to `"MMCA"` and shows in the top-left navbar link; `FooterText` (`LayoutSettings.cs:16`) defaults to `string.Empty`. Both are `init`-only.
- **Why it's built this way**: Sealed and `init`-only for immutability after binding; the defaults mean a host with no `Layout` section still renders sensibly, so rebranding is a config change, not a code change.
- **Where it's used**: Bound in [DependencyInjection](#dependencyinjection) `AddUIShared` (`DependencyInjection.cs:36`); read by navbar/footer components through `IOptions<LayoutSettings>`.

---

### NavSection

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NavSection.cs:7` · Level 0 · enum

- **What it is**: Classifies a navigation entry into one of three sidebar groups by audience: everyone, authenticated users, or administrators.
- **Depends on**: Nothing; consumed by [NavItem](#navitem) and the navbar component.
- **Concept introduced**: `[Rubric §25, Navigation & Information Architecture]` assesses whether the menu structure is audience-aware and declarative; this enum embodies it. `[Rubric §11, Security]` also applies, since section membership feeds the role-gated rendering of the sidebar.
- **Walkthrough**: Three values in declaration order: `General` (`NavSection.cs:10`) for anonymous plus authenticated items, `User` (`NavSection.cs:13`) for authenticated non-admin items, `Admin` (`NavSection.cs:16`) for admin/organizer items. The comment at `NavSection.cs:5` notes sections render in declaration order, so the enum order is an implicit rendering contract.
- **Why it's built this way**: An enum (not a string) gives exhaustive switch coverage in the renderer and rules out typos when a module registers a nav item.
- **Where it's used**: The `Section` parameter on [NavItem](#navitem); the navbar groups and filters items by `NavSection`.

---

### NotificationRoutePaths

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NotificationRoutePaths.cs:6` · Level 0 · class (static)

- **What it is**: The route-path constants for the notification UI feature: the notifications list, the admin send page, and the inbox.
- **Depends on**: Nothing; referenced by notification Razor components and nav-item registration.
- **Concept introduced**: Same "one source of truth for route strings" idea as [RoutePaths](#routepaths); this class is the notification-scoped instance of it, following the codebase convention that module-specific paths live in their own `*RoutePaths` class rather than in the shared [RoutePaths](#routepaths).
- **Walkthrough**: Three `static readonly` strings: `Notifications = "/notifications"` (`NotificationRoutePaths.cs:8`), `NotificationSend = "/notifications/send"` (`NotificationRoutePaths.cs:9`), and `NotificationInbox = "/notifications/inbox"` (`NotificationRoutePaths.cs:10`).
- **Why it's built this way**: Isolated from [RoutePaths](#routepaths) so an app that never enables notifications does not carry an irrelevant constant set, and so notification routes evolve independently.
- **Where it's used**: Notification page components; navbar registration for the notification bell and the admin "send" link.

---

### RoutePaths

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/RoutePaths.cs:7` · Level 0 · class (static)

- **What it is**: The shared route-path constants owned by the common UI package. Module-specific routes stay in their own `*RoutePaths` classes.
- **Depends on**: Nothing; referenced by `@page` directives and `NavigationManager.NavigateTo` calls.
- **Concept introduced**: `[Rubric §25, Navigation & Information Architecture]` also covers URL/route hygiene; centralising cross-cutting routes here keeps literal path strings from scattering across components.
- **Walkthrough**: Currently one member, `Home = "/"` (`RoutePaths.cs:9`), a `static readonly` string. The class comment (`RoutePaths.cs:5`) states additional shared routes are added here as the package grows.
- **Why it's built this way**: `static readonly` (not `const`) is sufficient because these strings are used in navigation calls rather than attribute arguments; one shared class avoids hard-coded duplicates.
- **Where it's used**: Navigation calls to the home route across the shared UI and consuming apps.

---

### UIModuleConfiguration

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/UIModuleConfiguration.cs:10` · Level 0 · class (static)

- **What it is**: A configuration reader that answers "is this UI module enabled?" against the same `Modules` section the server layer uses, so UI registration and server registration stay in step.
- **Depends on**: `Microsoft.Extensions.Configuration.IConfiguration`; conceptually paired with the Application layer's [ModulesSettings](group-14-module-system-composition.md#modulessettings), which reads the same section.
- **Concept introduced**: `[Rubric §10, Cross-Cutting Concerns]` assesses whether a single toggle governs a concern end to end; this helper embodies it by reading `Modules:{name}:Enabled` so there is one switch, not one server switch and a separate UI switch.
- **Walkthrough**: `ModulesSectionName = "Modules"` (`UIModuleConfiguration.cs:12`) is the private section name. `IsModuleEnabled(IConfiguration configuration, string moduleName)` (`UIModuleConfiguration.cs:18`) reads `Modules:{moduleName}`; it returns `true` when that section does not exist and otherwise reads `Enabled` with a default of `true` (`UIModuleConfiguration.cs:20-21`). Only an explicit `Enabled: false` turns a module off.
- **Why it's built this way**: Static because it is a pure configuration read with no DI dependency; default-enabled preserves backward compatibility for deployments that predate a `Modules` section.
- **Where it's used**: Per-module UI registration extensions guard their service and route registrations with `IsModuleEnabled`.

---

### UISharedAssemblyReference

> MMCA.Common.UI · `MMCA.Common.UI` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:123` · Level 0 · class

- **What it is**: An empty marker class whose only purpose is to give code a stable `typeof(...).Assembly` handle on the UI assembly for reflection-based scanning (for example Scrutor component discovery).
- **Depends on**: Nothing.
- **Concept introduced**: The assembly-marker pattern: rather than passing a fragile assembly-name string, code references a known type in the target assembly and reads `.Assembly` off it. Each layer in the framework has an equivalent marker; this is the UI layer's.
- **Walkthrough**: A one-line class declaration, `public class UISharedAssemblyReference;` (`DependencyInjection.cs:123`), sharing the file with the [DependencyInjection](#dependencyinjection) extension class but declared at namespace scope beneath it.
- **Why it's built this way**: A dedicated marker type makes assembly-scanning call sites refactor-safe (the compiler tracks the type reference) and self-documenting.
- **Where it's used**: Assembly-scanning registrations that enumerate UI components and services.

---

### WebApplicationExtensions

> MMCA.Common.UI · `MMCA.Common.UI.Extensions` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Extensions/WebApplicationExtensions.cs:9` · Level 0 · class (static)

- **What it is**: Provides `UseAuthenticatedNoStore()`, middleware that stamps `Cache-Control: no-store` on HTML responses to authenticated users so the browser back-forward cache cannot restore a logged-in page after logout.
- **Depends on**: `Microsoft.AspNetCore.Builder.IApplicationBuilder` and `Microsoft.AspNetCore.Http`; it reads `HttpContext.User.Identity.IsAuthenticated`.
- **Concept introduced**: `[Rubric §26, Front-End Security]` assesses defenses against stale-session exposure in the browser; this middleware embodies it. Back-forward cache (bfcache) restores a full DOM snapshot without a new request, so without `no-store` a user who logs out and presses Back could see the previous authenticated HTML. The doc comment (`WebApplicationExtensions.cs:13-24`) spells out both goals: block bfcache restore and force a fresh server render on authenticated back-navigation.
- **Walkthrough**: The single member is declared inside an `extension(IApplicationBuilder app)` block (`WebApplicationExtensions.cs:11`), the C# preview extension syntax (see [primer §4](00-primer.md#c-extensiont-types-read-this-once)). `UseAuthenticatedNoStore()` (`WebApplicationExtensions.cs:25`) registers an inline middleware that hooks `Response.OnStarting` (`WebApplicationExtensions.cs:29`); the callback only sets headers when the user is authenticated and the content type starts with `text/html` (`WebApplicationExtensions.cs:31-33`), then writes `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` and `Pragma: no-cache` (`WebApplicationExtensions.cs:35-36`). Anonymous pages stay bfcache-eligible.
- **Why it's built this way**: Scoping the header to authenticated HTML avoids penalising anonymous-page performance; the comment (`WebApplicationExtensions.cs:23`) warns it must be registered before `MapRazorComponents` so it wraps every page response.
- **Where it's used**: Each consuming host's startup pipeline, after authentication is wired.

---

### ApiSettings

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/ApiSettings.cs:9` · Level 1 · class (sealed)

- **What it is**: The concrete options object bound to the `"Api"` configuration section and the sole implementation of [IApiSettings](#iapisettings).
- **Depends on**: [IApiSettings](#iapisettings); `System.ComponentModel.DataAnnotations` for the `[Required]` attribute.
- **Concept introduced**: `[Rubric §33, Developer Experience]` assesses fail-fast configuration; this class embodies it. `ApiEndpoint` (`ApiSettings.cs:16`) carries `[Required]` (`ApiSettings.cs:15`), and because [DependencyInjection](#dependencyinjection) binds it with `ValidateDataAnnotations().ValidateOnStart()`, a missing endpoint fails the host at startup rather than at the first HTTP call.
- **Walkthrough**: `SectionName = "Api"` (`ApiSettings.cs:12`) names the bound section. `ApiEndpoint` is a required `init` string; `WasmApiEndpoint` (`ApiSettings.cs:19`) is an optional `init` string carrying `<inheritdoc/>` from the interface.
- **Why it's built this way**: Sealed and `init`-only for immutability after binding; validation attributes on the concrete class let the DI layer opt into startup validation.
- **Where it's used**: Bound and validated in [DependencyInjection](#dependencyinjection) `AddUIShared` (`DependencyInjection.cs:30-33`) and read via `IOptions<ApiSettings>` when the named HttpClient sets its base address.

---

### NavItem

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NavItem.cs:17` · Level 1 · record

- **What it is**: An immutable description of one sidebar entry a UI module contributes: title, href, icon, optional role/claim gates, its [NavSection](#navsection), an optional collapsible group, and an optional localization resource type.
- **Depends on**: [NavSection](#navsection); `System.Type` (BCL) for the optional resource type.
- **Concept introduced**: `[Rubric §25, Navigation & Information Architecture]` assesses modular, role-aware navigation; `NavItem` embodies it because modules contribute items and the sidebar renders them filtered by role and claim, mirroring the server-side [IModule](group-14-module-system-composition.md#imodule) "modules contribute their own surface" pattern. `[Rubric §27, Internationalization]` also applies: the record supports localized menu titles (ADR-027).
- **Walkthrough**: A positional record with eight parameters (`NavItem.cs:17`): `Title`, `Href`, `Icon`, then `RequiredRole = null` (render only for that role), `RequiredClaim = null` (render only for that claim type), `Section = NavSection.General`, `Group = null` (nest inside a collapsible `MudNavGroup`), and `TitleResource = null`. The doc comment (`NavItem.cs:10-15`) explains the localization rule: when `TitleResource` is set, `Title` and `Group` are treated as resource KEYS resolved against that resource type at render time (per-circuit, so the menu follows the active culture); when the key is missing or `TitleResource` is null, the raw string renders as before, keeping existing literal-titled items working.
- **Why it's built this way**: A record gives value semantics and concise construction; making localization opt-in through a nullable `TitleResource` means the ADR-027 support was added without breaking any existing literal-titled registration.
- **Where it's used**: Returned in the `NavItems` list of each [IUIModule](#iuimodule); rendered by the shared sidebar/menu component.

---

### IEntityService<TEntityDTO, TIdentifierType>

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IEntityService.cs:12` · Level 2 · interface

- **What it is**: The generic CRUD service contract every UI module page injects to talk to its API endpoints, so components depend on an abstraction rather than a raw `HttpClient` call.
- **Depends on**: [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (the `TEntityDTO` constraint at `IEntityService.cs:13`) and [BaseLookup<TIdentifierType>](group-12-api-hosting-mapping.md#baselookuptidentifiertype) (the lookup return type); implemented by [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype).
- **Concept introduced**: `[Rubric §18, UI Architecture]` assesses clean separation between components and their data access; this interface embodies it. `[Rubric §9, API & Contract Design]` also applies, since the method set mirrors the REST surface (list, paged query, lookup, get-by-id, create, update, delete) the API exposes. Two generic constraints (`IEntityService.cs:13-14`) bind the DTO to [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) and require `TIdentifierType : notnull`.
- **Walkthrough**: Seven async members. `GetAllAsync` (`IEntityService.cs:17`) with optional FK and child inclusion flags. `GetPagedAsync` (`IEntityService.cs:23`) takes a filter dictionary of `(Operator, Value)` pairs plus page number/size and sort column/direction, and returns an `(Items, TotalItems)` tuple for server-side paging. `GetAllForLookupAsync` (`IEntityService.cs:33`) returns lightweight `Id + Name` [BaseLookup<TIdentifierType>](group-12-api-hosting-mapping.md#baselookuptidentifiertype) items for dropdowns. `GetByIdAsync` (`IEntityService.cs:38`) returns null on a 404. `AddAsync` (`IEntityService.cs:44`) returns the server-assigned DTO including its generated id. `UpdateAsync` (`IEntityService.cs:49`) and `DeleteAsync` (`IEntityService.cs:54`) return `bool` success.
- **Why it's built this way**: An interface keeps Blazor components testable (mock the service) and hides the API URL structure behind a typed surface; the paged-query signature exists so grids never fetch a whole table.
- **Where it's used**: Implemented by [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype) (Level 3); consumed by every module's CRUD page components, including those built on [DataGridListPageBase<TDto>](#datagridlistpagebasetdto).

---

### IUIModule

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IUIModule.cs:10` · Level 2 · interface

- **What it is**: The UI-side counterpart to the server [IModule](group-14-module-system-composition.md#imodule): each pluggable UI module declares its navigation, its assembly (for Blazor route discovery), and optional components it injects into the app bar and root layout.
- **Depends on**: [NavItem](#navitem); `System.Reflection.Assembly` (BCL).
- **Concept introduced**: `[Rubric §18, UI Architecture]` assesses pluggable, discoverable UI composition; this interface embodies it. The Blazor host feeds each module's `Assembly` to `AddAdditionalAssemblies` so routes are discovered at runtime, mirroring how the server discovers [IModule](group-14-module-system-composition.md#imodule) implementations. `[Rubric §25, Navigation & Information Architecture]` also applies, since nav items are contributed by modules rather than hard-coded in the layout.
- **Walkthrough**: `NavItems` (`IUIModule.cs:13`) is the module's list of [NavItem](#navitem) entries for the shared sidebar. `Assembly` (`IUIModule.cs:16`) is the Razor-component assembly used for route discovery. `AppBarComponentTypes` (`IUIModule.cs:19`) and `LayoutComponentTypes` (`IUIModule.cs:22`) are default-implemented to return an empty array (`[]`), so a module only overrides them when it contributes app-bar widgets (for example a cart icon) or root-layout overlays (for example drawers).
- **Why it's built this way**: Default interface members mean a simple module implements two properties, not four; the assembly handle keeps route discovery reflection-based so adding a module needs no central route edit.
- **Where it's used**: Implemented by each app's UI module classes (Conference/Engagement/Identity/Notification UI modules); consumed by the Blazor host during composition.

---

### MoneyExtensions

> MMCA.Common.UI · `MMCA.Common.UI.Extensions` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Extensions/MoneyExtensions.cs:9` · Level 5 · class (static)

- **What it is**: Two formatting helpers that turn [Money](group-02-domain-building-blocks.md#money) value objects into user-facing price strings: a single price and a price range.
- **Depends on**: [Money](group-02-domain-building-blocks.md#money) and its [Currency](group-02-domain-building-blocks.md#currency) (via `MMCA.Common.Shared.ValueObjects`); `System.Globalization.CultureInfo`.
- **Concept introduced**: `[Rubric §20, Design System & Theming]` covers consistent, presentational formatting; keeping display formatting here rather than on the domain [Money](group-02-domain-building-blocks.md#money) embodies the Clean Architecture rule that the domain stays display-agnostic.
- **Walkthrough**: `ToDisplayString(this Money price)` (`MoneyExtensions.cs:12`) formats the amount with `"N2"` under `CultureInfo.InvariantCulture` and appends the currency code, yielding e.g. `$12.50 USD`. `ToDisplayRange(this IReadOnlyCollection<Money> prices)` (`MoneyExtensions.cs:19`) returns an empty string for an empty collection (`MoneyExtensions.cs:21-24`), computes min and max amounts (`MoneyExtensions.cs:26-27`), takes the currency code from the first element (`MoneyExtensions.cs:28`), and renders a single price when min equals max or a range otherwise (`MoneyExtensions.cs:30-32`).
- **Why it's built this way**: `CultureInfo.InvariantCulture` guarantees a stable `$12.50` style regardless of server locale (never `$12,50`); collapsing an equal min/max into one price avoids showing a pointless `$10.00 - $10.00`.
- **Where it's used**: Price display in product-listing and cart components in the Store UI.
- **Caveats / not-in-source**: `ToDisplayRange` reads the currency from `prices.First()` and does not verify all prices share a currency; a mixed-currency collection would render the range with the first element's code. That single-currency assumption is an application-level invariant, not enforced here.

---

### DependencyInjection

> MMCA.Common.UI · `MMCA.Common.UI` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:19` · Level 7 · class (static, with `extension(IServiceCollection)` block)

- **What it is**: The one-call registration surface every UI host (Blazor Server, WebAssembly, MAUI) invokes to wire the shared UI infrastructure: API settings, the localization stack, the authenticated HttpClient, auth and state services, theme, per-user preferences, OAuth defaults, and device-capability defaults.
- **Depends on**: [ApiSettings](#apisettings) / [LayoutSettings](#layoutsettings); [AuthDelegatingHandler](#authdelegatinghandler) and the culture handler; [IAuthUIService](#iauthuiservice), [ListPageStateService](#listpagestateservice), [ListPageQueryStateService](#listpagequerystateservice), [NavigationHistoryService](#navigationhistoryservice), [ThemeService](#themeservice); the localization decorators and `MudBlazor.MudLocalizer`; [IFormFactor](group-26-device-capability-layer.md#iformfactor) (via `AddWasmFormFactor`); `Microsoft.Extensions.Configuration`, `DependencyInjection`, `Localization`, and `Options`.
- **Concept introduced**: This is the composition root for the UI layer, and it leans on the C# preview `extension(IServiceCollection services)` syntax (`DependencyInjection.cs:21`) instead of classic `this`-parameter extension methods (see [primer §4](00-primer.md#c-extensiont-types-read-this-once)). `[Rubric §15, Best Practices & Code Quality]` (consistent DI patterns across the codebase) and `[Rubric §33, Developer Experience]` (fail-fast startup) both apply; `[Rubric §27, Internationalization]` and `[Rubric §20, Design System & Theming]` apply through the localization and theme registrations (ADR-027, ADR-028).
- **Walkthrough**: Three methods live in the extension block.
  - **`AddUIShared(IConfiguration configuration)`** (`DependencyInjection.cs:27`): binds [ApiSettings](#apisettings) with `.ValidateDataAnnotations().ValidateOnStart()` so a missing `ApiEndpoint` fails startup (`DependencyInjection.cs:30-33`); binds [LayoutSettings](#layoutsettings) without validation (`DependencyInjection.cs:36-37`). Adds resource localization (`AddLocalization`, `DependencyInjection.cs:40`) and decorates `IStringLocalizerFactory` with `PseudoStringLocalizerFactory` (`DependencyInjection.cs:47`) for the pseudo-locale (ADR-027, inert under every other culture). `TryAddTransient` registers a `ResxMudLocalizer` for MudBlazor's built-in component text (`DependencyInjection.cs:53`). Registers [AuthDelegatingHandler](#authdelegatinghandler) and `CultureDelegatingHandler` as transient (`DependencyInjection.cs:57-58`), then the named `"APIClient"` HttpClient (`DependencyInjection.cs:61`) whose factory reads `ApiSettings.ApiEndpoint`, throws if it is blank (`DependencyInjection.cs:64-67`), sets the base address and `Accept: application/json`, and chains both message handlers (`DependencyInjection.cs:73-74`) so every outgoing call carries the bearer token and the active UI culture as `Accept-Language`. A run of `TryAdd` calls follows so multiple hosts can compose without duplicate registrations: `IAuthUIService` (`DependencyInjection.cs:77`), [ListPageStateService](#listpagestateservice) and [ListPageQueryStateService](#listpagequerystateservice) (`DependencyInjection.cs:78-79`), [NavigationHistoryService](#navigationhistoryservice) (`DependencyInjection.cs:80`), [ThemeService](#themeservice) (`DependencyInjection.cs:83`, ADR-028 day/dark preference), the per-user preference reader/writer (`DependencyInjection.cs:86-87`, ADR-027/028), a default no-op `IOAuthUISettings` (`DependencyInjection.cs:91`), and finally `AddDeviceCapabilityDefaults()` (`DependencyInjection.cs:95`, ADR-042) so every capability contract resolves on every head.
  - **`AddClientAuthSessionCookieSync()`** (`DependencyInjection.cs:105`): `TryAddScoped` for `ISessionCookieSync -> JsFetchSessionCookieSync`, the bridge that mirrors the client's in-memory tokens into the HttpOnly cookie read by server-side SSR prerender. Called from both the Blazor Server head and the WASM client.
  - **`AddWasmFormFactor()`** (`DependencyInjection.cs:117`): registers the WebAssembly [IFormFactor](group-26-device-capability-layer.md#iformfactor) implementation; the Blazor Server and MAUI heads register their own instead.
- **Why it's built this way**: `TryAdd` throughout makes the method safe to call from multiple composing hosts; the comments note deliberate ordering choices, for example that device-capability defaults register first so MAUI/browser heads override afterward with last-registration-wins (`DependencyInjection.cs:93-95`), and that the `MudLocalizer` `TryAdd` is authoritative because `AddMudServices` registers none of its own (`DependencyInjection.cs:49-52`).
- **Where it's used**: Called once at startup by each consuming UI host; the auth/culture handlers it registers are consumed by every [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype)-derived service through the `"APIClient"` HttpClient.

### LoginModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/LoginModel.cs:9` · Level 0 · class (sealed)

- **What it is**: the `EditForm` backing model for the Login page, two string properties (`Email`, `Password`) carrying DataAnnotations for field-level validation.
- **Depends on**: `System.ComponentModel.DataAnnotations` (BCL): `[Required]`, `[EmailAddress]`. Nothing first-party.
- **Concept introduced, the form-backing model + `DataAnnotationsValidator`.** `[Rubric §24, Forms, Validation & UX Safety]` (assesses whether forms validate at the field level with clear, inline messages before submit) and `[Rubric §26, Front-End Security]` (assesses that client-side checks are a UX convenience, not the trust boundary). A Blazor `EditForm` binds to a plain model; a `<DataAnnotationsValidator />` reads the attributes and surfaces a per-field message as the user types, so the submit handler only fires on a valid form. The doc comment (`LoginModel.cs:5-7`) is explicit that the server remains the authority on whether the credentials are actually valid, the form just prevents an obviously-malformed request.
- **Walkthrough**: two `get; set;` properties:
  - `Email` (line 13), `[Required(ErrorMessage = "Email is required")]` + `[EmailAddress(ErrorMessage = "Enter a valid email address")]`, defaulting to `string.Empty`.
  - `Password` (line 16), `[Required(ErrorMessage = "Password is required")]`; deliberately no complexity rule here, login validates an *existing* credential, not a new one.
- **Why it's built this way**: `sealed` and mutable (`set`, not `init`) because `EditForm` two-way-binds each input to the model; the messages are authored inline so each field shows one clear verdict.
- **Where it's used**: instantiated as `_model` and bound by `Login.razor` (`<EditForm Model="_model" OnValidSubmit="HandleLoginAsync">` + `<DataAnnotationsValidator />`, `Login.razor:31-32`, field at line 129); on valid submit the page hands the credentials to the injected [`IAuthUIService`](#iauthuiservice) as a `LoginRequest` (`Login.razor:172`). Sibling of [`RegisterModel`](#registermodel).

### MudTranslations

> MMCA.Common.UI · `MMCA.Common.UI.Resources` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Resources/MudTranslations.cs:10` · Level 0 · class (sealed)

- **What it is**: an empty marker class that anchors a `.resx` resource pair for **MudBlazor's own built-in component text**, the data-grid pager and filter menus, pickers, table editing, pagination, snackbar/alert close buttons, and input adornments (ADR-027).
- **Depends on**: nothing first-party (the type has no members). Its meaning comes from its co-located resources, whose keys mirror MudBlazor's own `LanguageResource` keys (v9.6.0) with the English values copied verbatim so en-US behavior is unchanged, and from [`ResxMudLocalizer`](#resxmudlocalizer), which injects `IStringLocalizer<MudTranslations>` and hands those strings to MudBlazor's localization interceptor.
- **Concept reinforced, the resource-anchor type.** The anchor-type idiom is introduced in full at [`SharedResource`](#sharedresource): ASP.NET Core's `IStringLocalizer<T>` resolves keys against the `.resx` whose base name matches `T`, so a dedicated empty class becomes the *name* of a shared string table. `MudTranslations` is the second anchor, scoped to third-party (MudBlazor) chrome rather than app chrome. `[Rubric §27, Internationalization]` (assesses whether *all* user-visible copy, including the component library's, follows the active culture) and `[Rubric §20, Design System & Theming]` (assesses a consistent design system; the pager reading "Filas por página" instead of "Rows per page" under `es` keeps the whole surface coherent).
- **Walkthrough**: there are no members. The whole contract is "be a public sealed type named `MudTranslations` in this namespace, with sibling `.resx` files whose keys match MudBlazor's `LanguageResource`." The doc comment (`MudTranslations.cs:3-9`) records the verbatim-English-mirror invariant.
- **Why it's built this way**: MudBlazor localizes its built-in strings through an injectable `MudLocalizer`, but only for non-English cultures, and it needs *some* resource base to read from; a separate anchor keeps the library's keys in their own table (mirroring the upstream names one-to-one), cleanly apart from the app's own [`SharedResource`](#sharedresource) chrome. This is the ADR-027 way to translate a dependency you do not own.
- **Where it's used**: injected as `IStringLocalizer<MudTranslations>` by [`ResxMudLocalizer`](#resxmudlocalizer), which is registered as MudBlazor's `MudLocalizer` in `DependencyInjection.AddUIShared` (`DependencyInjection.cs:53`).
- **Caveats / not-in-source**: the `.resx` files and their per-key match to MudBlazor v9.6.0's `LanguageResource` are resources, not `.cs`; individual key contents are not enumerated here.

### PasswordComplexityAttribute

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/PasswordComplexityAttribute.cs:12` · Level 0 · class (sealed attribute)

- **What it is**: a custom `ValidationAttribute` that enforces the Register form's password-strength rule, at least 8 characters including an uppercase, a lowercase, a digit, and a special (non-alphanumeric) character.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`ValidationAttribute`, `ValidationResult`, `ValidationContext`) and `char.IsUpper`/`IsLower`/`IsDigit`/`IsLetterOrDigit` (BCL). Nothing first-party.
- **Concept introduced, extending DataAnnotations with a domain rule.** `[Rubric §24, Forms, Validation & UX Safety]` (assesses client-side validation parity with the server). Beyond the built-in `[Required]`/`[EmailAddress]`, a bespoke rule subclasses `ValidationAttribute` and overrides `IsValid`. The doc comment (`PasswordComplexityAttribute.cs:5-9`) states the intent: mirror the server's rule so the `EditForm` gives the same verdict the API would. The downstream server-side story, how an accepted password is then *hashed*, is ADR-032 (PBKDF2-HMAC-SHA512 with legacy-hash backward compatibility); this attribute is only the client-side gate, never the security boundary.
- **Walkthrough**:
  - `[AttributeUsage(AttributeTargets.Property, AllowMultiple = false)]` (line 11), applied as `[PasswordComplexity]` on a property.
  - Constructor (lines 14-17) seeds the base `ErrorMessage` with the full human-readable rule.
  - `IsValid(object?, ValidationContext)` (lines 19-39): returns `ValidationResult.Success` for null/empty input (lines 21-24), deliberately deferring the "missing" message to `RequiredAttribute` so the field shows one message, not two; otherwise evaluates five LINQ predicates (`Length >= 8`, `Any(char.IsUpper)`, `Any(char.IsLower)`, `Any(char.IsDigit)`, `Any(c => !char.IsLetterOrDigit(c))`, lines 26-30) and, on failure, returns a `ValidationResult` scoped to the member name (lines 37-38) so the message attaches to the right field.
- **Why it's built this way**: a `ValidationAttribute` plugs straight into the same `DataAnnotationsValidator` that drives the rest of the form, so the complexity rule participates in the standard EditForm lifecycle with no extra wiring; emptiness is delegated to `[Required]` to avoid duplicate messages on one field.
- **Where it's used**: applied to `RegisterModel.Password` ([`RegisterModel`](#registermodel), `RegisterModel.cs:22`); evaluated by the `<DataAnnotationsValidator />` in `Register.razor` (`Register.razor:26`).
- **Caveats / not-in-source**: the doc comment claims parity with the server's rule; this file only encodes the client check, so whether the server rule is byte-identical is not verifiable from this source.

### PersistedGridState

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:778` · Level 0 · record (sealed, private)

- **What it is**: a tiny serializable record `(List<TDto> Items, int TotalItems)` that carries the *grid's already-fetched data* from the SSR pre-render pass into the interactive circuit, so the first interactive `ServerData` call can return instantly instead of re-hitting the API.
- **Depends on**: `Microsoft.AspNetCore.Components.PersistentComponentState` (the Blazor mechanism that serializes it). Nested privately inside [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto).
- **Concept introduced, `PersistentComponentState` to skip the double fetch.** `[Rubric §19, State Management & Data Flow]` and `[Rubric §23, Front-End Performance & Rendering]` (assesses avoiding redundant work across render-mode transitions). Under InteractiveAuto a page renders multiple times, static SSR then interactive Server then WASM, and naively each transition would re-run the data fetch. Blazor's `PersistentComponentState` serializes chosen data into the pre-rendered HTML and rehydrates it in the interactive circuit; `PersistedGridState` is the payload for the grid's data slice, so the visible "fetch, cancel, re-fetch" flicker of the render-mode handoff disappears.
- **Walkthrough**: declared as `private sealed record PersistedGridState(List<TDto> Items, int TotalItems)` (line 778). On the persisting side, the base's `RegisterOnPersisting` callback (`DataGridListPageBase.cs:140-150`) writes `new PersistedGridState([.. _lastSuccessfulGridData.Items], _lastSuccessfulGridData.TotalItems)` (line 145) keyed by `grid:{GetType().FullName}` (built at line 127). On the restoring side, the synchronous `OnInitialized` (lines 127-131) calls `ApplicationState.TryTakeFromJson<PersistedGridState>(persistKey, out var restored)` and, if present, rebuilds a `GridData<TDto>` (line 130) that the first `LoadServerDataAsync` returns directly.
- **Why it's built this way**: `private` because the persistence is purely an implementation detail of the base class; `sealed record` for JSON-serialization friendliness and value semantics; the items are materialized into a fresh `List<TDto>` (`[.. …]`) so the persisted snapshot is decoupled from the live grid data.
- **Where it's used**: exclusively inside [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto); every derived list page inherits the behavior for free.
- **Caveats / not-in-source**: the record is nested at the *bottom* of the file (line 778) though it is a Level-0 collaborator; the restore runs in the **synchronous** `OnInitialized`, and the persisting callback is registered with an explicit `Microsoft.AspNetCore.Components.Web.RenderMode.InteractiveAuto` (line 150) to satisfy the framework's "callback must be associated with a render mode" rule during the static prerender pass, because the page inherits its render mode from `<Routes @rendermode="InteractiveAuto">` rather than declaring one itself.

### PseudoLocalizer

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoLocalizer.cs:20` · Level 0 · class (static)

- **What it is**: a pure string transform that "pseudo-localizes" text, it accents every letter, pads the result by roughly 40% to simulate real-translation expansion, and wraps it in `[!! … !!]` bracket sentinels, while leaving composite-format placeholders (`{0}`, `{name}`) byte-identical so the string can still be formatted with arguments (ADR-027 §8).
- **Depends on**: `System.Text.StringBuilder` and `char.IsLetter` (BCL). Nothing first-party. It is consumed by [`PseudoStringLocalizer`](#pseudostringlocalizer).
- **Concept introduced, pseudo-localization as an i18n fitness test.** `[Rubric §27, Internationalization]` (assesses whether the app is genuinely translation-ready, not just wired for one extra language) and `[Rubric §28, Front-End Testing]` (assesses whether i18n defects are caught automatically). Pseudo-localization is a development-time technique that surfaces three classes of bug in a single visual pass, without needing a real second translation: (1) any string that stays plain ASCII was **hard-coded** rather than pulled from a resource, and stands out beside the accented text; (2) any UI that **truncates** the padded text has a fixed-width layout that a real (longer) translation would break; (3) any label built by **concatenating fragments** shows one sentinel per fragment, exposing the joins that translate badly. The MMCA CI pipeline runs a pseudo-loc E2E gate over this exact transform.
- **Walkthrough**:
  - Three constants (lines 22-24): `OpenSentinel = "[!! "`, `CloseSentinel = " !!]"`, and `CombiningAcute` (the combining acute accent code point) appended after each base glyph so the letter stays readable while visibly altered.
  - `Transform(string value)` (lines 30-74): returns null/empty input unchanged (lines 32-35); pre-sizes a `StringBuilder` with slack for the padding (line 37) and appends the open sentinel (line 38); then walks each character (lines 42-66) tracking an `insidePlaceholder` flag toggled by `{` and `}` (lines 46-53) so placeholder bodies are copied verbatim, and for every letter *outside* a placeholder appends the combining accent and increments a `letters` counter (lines 56-62); finally computes the pad length as `Max(1, letters * 2 / 5)` (~40%, line 69), appends that many `~` characters (lines 70-71) and the close sentinel (line 72), and returns the string (line 73).
- **Why it's built this way**: keeping the transform **pure and static** (input string to output string, no culture check inside) makes it trivially unit-testable and lets the *culture gating* live one layer up in [`PseudoStringLocalizer`](#pseudostringlocalizer). Preserving `{…}` placeholders is essential: transforming them would corrupt `string.Format`, so pseudo-loc must accent the template and only then substitute arguments (see the two-step in `PseudoStringLocalizer`).
- **Where it's used**: called by [`PseudoStringLocalizer`](#pseudostringlocalizer) on every resolved string when the current UI culture is the pseudo locale ([`SupportedCultures.PseudoLocale`](group-12-api-hosting-mapping.md#supportedcultures), `"qps-Ploc"`); inert otherwise.

### RegisterModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/RegisterModel.cs:9` · Level 0 · class (sealed)

- **What it is**: the `EditForm` backing model for the Register page, name/email/password fields with DataAnnotations plus six optional address fields.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`[Required]`, `[EmailAddress]`, `[Compare]`) and the sibling first-party [`PasswordComplexityAttribute`](#passwordcomplexityattribute).
- **Concept reinforced, multi-field form validation with a cross-field compare.** `[Rubric §24, Forms, Validation & UX Safety]`. This builds on the [`LoginModel`](#loginmodel) shape with three richer rules: `[PasswordComplexity]` on the password, `[Compare(nameof(Password))]` on the confirmation (cross-field equality), and an address block left attribute-free (optional). The doc comment (`RegisterModel.cs:5-7`) notes the annotations mirror the server's rules so client and server agree.
- **Walkthrough**:
  - `FirstName`/`LastName` (lines 12,15), each `[Required]`.
  - `Email` (line 19), `[Required]` + `[EmailAddress]`.
  - `Password` (line 23), `[Required]` + `[PasswordComplexity]` (line 22).
  - `ConfirmPassword` (line 27), `[Required]` + `[Compare(nameof(Password), ErrorMessage = "Passwords do not match")]` (line 26), the cross-field check.
  - `AddressLine1` plus nullable `AddressLine2`/`City`/`State`/`ZipCode`/`Country` (lines 30-35), no validation attributes; the inline comment (line 29) states an empty Line 1 means "no address supplied".
- **Why it's built this way**: the address fields stay attribute-free so a user can register without supplying one; the model is a flat view-model that the page projects onto the wire DTO at submit time rather than reusing the domain type directly.
- **Where it's used**: instantiated as `_model` and bound by `Register.razor` (`<EditForm Model="_model" OnValidSubmit="HandleRegisterAsync">`, `Register.razor:25`, field at line 121); on valid submit the page projects it into a [`RegisterRequest`](group-08-auth.md#registerrequest) (`Register.razor:145`), with the address fields folded into an [`Address`](group-02-domain-building-blocks.md#address) via a `BuildAddress()` helper (`Register.razor:125`, `Address.Create` at line 130). The accepted password is hashed server-side per ADR-032.

### SharedResource

> MMCA.Common.UI · `MMCA.Common.UI.Resources` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Resources/SharedResource.cs:9` · Level 0 · class (sealed)

- **What it is**: an empty marker class that anchors `IStringLocalizer<SharedResource>` over its co-located `.resx` files, the single home for cross-cutting UI chrome strings (ADR-027).
- **Depends on**: nothing first-party (the type is empty). Its meaning comes from the co-located resources `SharedResource.resx` (the en default) and `SharedResource.es.resx` (Spanish), and from the ASP.NET Core localization stack that binds `IStringLocalizer<T>` to the `.resx` named after `T`.
- **Concept introduced, the resource-anchor type.** `[Rubric §27, Internationalization]` (assesses whether user-facing copy is externalized to per-culture resources keyed stably, not hard-coded). ASP.NET Core's `IStringLocalizer<T>` convention resolves keys against the resource file whose base name matches the type `T`. So a dedicated empty class becomes the *name* that ties many components to one shared string table: injecting `IStringLocalizer<SharedResource>` anywhere reads the same dotted, stable keys (e.g. `Common.Error.Load`, `Grid.Snackbar.LoadCancelled`). The doc comment (`SharedResource.cs:3-7`) enumerates the chrome it covers: buttons, layout labels, snackbar/error templates, and the culture- and theme-switcher text. Its counterpart for library chrome is [`MudTranslations`](#mudtranslations).
- **Walkthrough**: there are no members. The whole contract is "be a public sealed type named `SharedResource` in this namespace, with sibling `.resx` files." The work lives in the `.resx` key/value pairs and the localization middleware that resolves them by culture.
- **Why it's built this way**: a marker type is the idiomatic ASP.NET Core way to scope a shared resource table without inventing a real class; one anchor keeps the chrome strings in a single table every component shares (ADR-027 supersedes the prior single-locale stance of ADR-011).
- **Where it's used**: injected as `IStringLocalizer<SharedResource>` by [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) (`DataGridListPageBase.cs:23`) for its cancellation snackbar, and handed to [`ErrorMessages.Configure`](#errormessages) from the root layout (`MainLayout.razor:102`) so the static helper resolves the same table; broadly consumed by the layout, the culture switcher, and the theme toggle components.
- **Caveats / not-in-source**: the `.resx` files (`SharedResource.resx`, `SharedResource.es.resx`) are resources, not `.cs`; their per-key contents are not enumerated here.

### PseudoStringLocalizer

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoStringLocalizer.cs:13` · Level 1 · class (sealed)

- **What it is**: an `IStringLocalizer` decorator that pseudo-localizes every resolved string, but *only* when the current UI culture is the pseudo locale; under every other culture it delegates unchanged to the wrapped localizer, so it is inert in production (ADR-027 §8).
- **Depends on**: [`PseudoLocalizer`](#pseudolocalizer) (the transform, Level 0), [`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures) (its `PseudoLocale`/`IsPseudoLocale` from `MMCA.Common.Shared.Globalization`), and `IStringLocalizer`/`LocalizedString`/`CultureInfo` (BCL/NuGet). Constructed with an `inner` `IStringLocalizer` via a primary constructor.
- **Concept introduced, the decorator that gates on culture.** `[Rubric §2, Design Patterns]` (assesses idiomatic use of patterns; this is a textbook **Decorator**, same interface in and out, wrapping behavior around a delegate) and `[Rubric §27, Internationalization]`. The key design move is that pseudo-localization is a *cross-cutting* transform applied to the localizer, not to any call site: because it implements `IStringLocalizer` and forwards to `inner`, it can be slid underneath every `IStringLocalizer<T>` in the app at once by decorating the *factory* ([`PseudoStringLocalizerFactory`](#pseudostringlocalizerfactory)), with zero changes to consumers.
- **Walkthrough**:
  - `IsPseudoActive` (lines 16-17), a private static bool that returns [`SupportedCultures.IsPseudoLocale`](group-12-api-hosting-mapping.md#supportedcultures)`(CultureInfo.CurrentUICulture.Name)`, the single gate every member checks.
  - `this[string name]` (lines 20-29): resolves `inner[name]`, then, if pseudo is active, returns a new `LocalizedString` whose value is [`PseudoLocalizer.Transform`](#pseudolocalizer)`(localized.Value)` while preserving `ResourceNotFound`/`SearchedLocation` (line 26); otherwise returns the inner value untouched.
  - `this[string name, params object[] arguments]` (lines 32-48): when pseudo is inactive, delegates straight to `inner[name, arguments]` (lines 36-39); when active it does the **two-step** that makes placeholders survive, transform the *raw template* first (line 44), then `string.Format` the accented template with the arguments (line 45), so the substituted values are never accented or padded.
  - `GetAllStrings(bool includeParentCultures)` (lines 51-57): maps the transform over every string when active, passes them through otherwise.
- **Why it's built this way**: gating inside the decorator (rather than conditionally registering it) keeps DI wiring unconditional and simple, the decorator is always present and simply does nothing outside the pseudo locale, which is only ever activatable in Development. Splitting the pure transform ([`PseudoLocalizer`](#pseudolocalizer)) from the culture-aware decorator keeps each single-responsibility and independently testable (§1 SOLID).
- **Where it's used**: produced by [`PseudoStringLocalizerFactory`](#pseudostringlocalizerfactory) around every localizer the inner factory creates, so it transparently wraps `IStringLocalizer<SharedResource>`, `IStringLocalizer<MudTranslations>`, and every other localizer in the host.

### ResxMudLocalizer

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/ResxMudLocalizer.cs:17` · Level 1 · class (sealed, internal)

- **What it is**: MudBlazor's `MudLocalizer` implementation that resolves the library's built-in component text from the [`MudTranslations`](#mudtranslations) resource pair, so MudBlazor chrome (pager, filter menus, pickers, close buttons) follows the active UI culture (ADR-027).
- **Depends on**: `MudBlazor.MudLocalizer` (the abstract base, NuGet), `IStringLocalizer<MudTranslations>` (injected via primary constructor), and [`MudTranslations`](#mudtranslations) (Level 0). Nothing else first-party.
- **Concept introduced, adapting a third-party localization hook.** `[Rubric §2, Design Patterns]` (this is an **Adapter**, bridging MudBlazor's `MudLocalizer` contract to the ASP.NET Core `IStringLocalizer` world) and `[Rubric §27, Internationalization]`. MudBlazor exposes exactly one extension point for translating its built-in strings: subclass `MudLocalizer` and override its indexer. This adapter routes that indexer straight to `IStringLocalizer<MudTranslations>`. MudBlazor's own `DefaultLocalizationInterceptor` consults this localizer only for non-English cultures and falls back to its built-in English whenever the returned `LocalizedString.ResourceNotFound` is true (per the doc comment, `ResxMudLocalizer.cs:9-12`), so any untranslated key degrades gracefully.
- **Walkthrough**: a one-line class. `internal sealed class ResxMudLocalizer(IStringLocalizer<MudTranslations> localizer) : MudLocalizer` (line 17) with a single `public override LocalizedString this[string key] => localizer[key];` (line 19). The doc comment (lines 13-15) also notes that because resolution flows through the DI `IStringLocalizerFactory`, the [`PseudoStringLocalizerFactory`](#pseudostringlocalizerfactory) decorator applies here too, so under the pseudo locale MudBlazor's chrome pseudo-localizes alongside the application text.
- **Why it's built this way**: `internal` because it is pure host wiring no consumer needs to name; delegating to the injected `IStringLocalizer<MudTranslations>` reuses the exact same `.resx`/factory pipeline as app strings (one localization mechanism, not two), which is what lets pseudo-loc reach MudBlazor for free.
- **Where it's used**: registered as MudBlazor's `MudLocalizer` in `DependencyInjection.AddUIShared` via `services.TryAddTransient<MudBlazor.MudLocalizer, ResxMudLocalizer>()` (`DependencyInjection.cs:53`). `TryAdd` is authoritative because `AddMudServices` does not register a `MudLocalizer` of its own (guarded by a DI-resolution test, per the comment at `DependencyInjection.cs:50-52`), regardless of host registration order.

### ErrorMessages

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/ErrorMessages.cs:17` · Level 2 · class (static)

- **What it is**: a centralized factory of user-facing snackbar message strings (load/save/delete/not-found/validation/action), so every page code-behind reports an outcome with identical phrasing, resolved through a shared localizer when one is configured (ADR-027).
- **Depends on**: `IStringLocalizer`/`LocalizedString` (Microsoft.Extensions.Localization, NuGet), `string.Format` with `CultureInfo.CurrentCulture` (BCL), and the first-party [`DomainInvariantViolationException`](group-01-result-error-handling.md#domaininvariantviolationexception) (the one exception whose message is shown). The localizer it is handed is an `IStringLocalizer<SharedResource>` (per the doc comment, `ErrorMessages.cs:25`), so it shares the [`SharedResource`](#sharedresource) `.resx` keys.
- **Concept introduced, the static-helper-with-injected-localizer bridge plus a safe-exception carve-out.** `[Rubric §27, Internationalization]` (assesses whether user-facing copy resolves per UI culture from resources rather than hard-coded English), `[Rubric §16, Maintainability]` (assesses whether a wording change is localized to one place), and `[Rubric §24, Forms, Validation & UX Safety]` (assesses that raw error text is not leaked to the user). This type is the boundary where a *static* helper (callable from any page without DI) is back-filled with a culture-aware localizer: each method calls a private `Localize(key, fallbackFormat, args)` that returns the localized value when the localizer is set and the key resolves, else the inline English fallback, so the static call sites never change yet the output follows the current culture. The load-bearing subtlety is the exception carve-out: a [`DomainInvariantViolationException`](group-01-result-error-handling.md#domaininvariantviolationexception) has its `Message` shown **verbatim** (because `ServiceExceptionHelper` rethrows the API's Problem Details errors as that type and their text is curated, server-localized domain wording, ADR-027 Decisions 3 and 5), while every *other* exception's `Message` is deliberately **not** surfaced (raw exception text is neither localizable nor safe to show, ADR-027 Decision 9).
- **Walkthrough**: a static class holding one mutable localizer field plus pure builders:
  - `_localizer` (line 19), a nullable `IStringLocalizer?`, null until configured.
  - `Configure(IStringLocalizer localizer)` (line 26), the one-time wiring point: assigns `_localizer`; idempotent; called from the root layout (see *Where it's used*).
  - `Localize(key, fallbackFormat, args)` (lines 28-40), the resolution core: if `_localizer` is set and the lookup's `ResourceNotFound` is false, returns `localized.Value` (lines 30-37); else `string.Format(CultureInfo.CurrentCulture, fallbackFormat, args)` (line 39).
  - `LoadError`/`SaveError`/`DeleteError` (lines 52-67), the three CRUD failure paths, each `ex is DomainInvariantViolationException ? ex.Message : Localize("Common.Error.Load"/`Save`/`Delete`, "Error loading {0}.", entityName, ex.Message)` (lines 52-55 and the two `<inheritdoc>` siblings): the curated domain message reaches the user, otherwise the localized entity-name template does.
  - `ActionError(Exception ex, string localizedFallback)` (lines 77-78), the whole-sentence variant for pages whose fallback is a full sentence key of their own resource pair rather than an entity-noun template: same carve-out, but the non-domain branch returns the caller's already-localized `localizedFallback`.
  - `DeleteFailed` (lines 80-81, key `Common.Error.DeleteFailed`), the "API returned a non-error but the delete didn't happen" case, distinct from `DeleteError` (which carries an exception).
  - `NotFound` (lines 83-84, key `Common.Error.NotFound`), interpolates the missing id.
  - `ValidationError` (lines 86-87, key `Common.Error.Validation`), a parameterless property, the only fixed message.
  - `Success(string entityName, string action)` (lines 98-99, key `Common.Success`) is marked `[Obsolete]` (line 97): it composes "{0} {1} successfully." from a noun and an English verb fragment, which cannot be translated correctly (Spanish gender/word agreement, "creado" vs "creada", breaks), a §27 red flag called out in its own doc comment (lines 89-95). The `#pragma warning disable S1133` around it (lines 96, 100) is the migration mechanism itself: the obsoletion turns every remaining call site into a build error under `TreatWarningsAsErrors` during the lockstep sweep, and the member is removed once all consumers migrate to a whole-sentence resource key.
- **Why it's built this way**: keeping the API static means existing call sites (`ErrorMessages.LoadError(Title, ex)`) do not move, while the `Configure` indirection adds localization without a breaking signature change. Surfacing only the `DomainInvariantViolationException` message lets curated domain rules reach the user while raw infrastructure errors stay generic, culture-correct, and safe; a page that needs a richer failure message shapes it through [`ServiceExceptionHelper`](#serviceexceptionhelper) (which produces that exception type) and its own resource pair.
- **Where it's used**: backed once per circuit/host by `ErrorMessages.Configure(L)` in the root layout (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/MainLayout.razor:102`); called by [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) on a fetch failure (`DataGridListPageBase.cs:493,549`) and by every entity page code-behind across both ADC and Store via `Snackbar.Add(...)`.
- **Caveats / not-in-source**: the `.resx` payloads (`SharedResource.resx`, `SharedResource.es.resx`) are resources, not `.cs`; their per-key contents are not enumerated here. `ServiceExceptionHelper`'s rethrow-as-`DomainInvariantViolationException` behavior is referenced in the doc comment but lives in another file; this file only *consumes* that type.

### PseudoStringLocalizerFactory

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoStringLocalizerFactory.cs:11` · Level 2 · class (sealed)

- **What it is**: an `IStringLocalizerFactory` decorator that wraps *every* localizer the inner factory produces in a [`PseudoStringLocalizer`](#pseudostringlocalizer), so decorating this one factory pseudo-localizes every `IStringLocalizer<T>` and `IStringLocalizer` in the host at once (ADR-027 §8).
- **Depends on**: [`PseudoStringLocalizer`](#pseudostringlocalizer) (Level 1) and `IStringLocalizerFactory`/`IStringLocalizer` (Microsoft.Extensions.Localization, NuGet). Constructed with the `inner` factory via a primary constructor.
- **Concept introduced, decorate the factory to reach every product.** `[Rubric §2, Design Patterns]` (Decorator applied at the *factory* level) and `[Rubric §10, Cross-Cutting Concerns]` (assesses whether cross-cutting behavior is injected in one place rather than scattered). Because `StringLocalizer<T>` resolves its backing localizer through the `IStringLocalizerFactory`, wrapping the factory means every localizer the DI container ever hands out is already pseudo-aware, no per-type registration, no consumer change. This is the same "decorate the boundary, not the callers" idea the CQRS pipeline uses (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)), applied to localization.
- **Walkthrough**: two forwarding overrides, each wrapping the inner factory's product:
  - `Create(Type resourceSource)` (lines 14-15): `new PseudoStringLocalizer(inner.Create(resourceSource))`, the path used by `IStringLocalizer<T>`.
  - `Create(string baseName, string location)` (lines 18-19): `new PseudoStringLocalizer(inner.Create(baseName, location))`, the path used by name-based localizers.
- **Why it's built this way**: registering the wrapper on the factory is the minimal, DI-idiomatic way to make pseudo-loc universal; combined with the culture gate inside [`PseudoStringLocalizer`](#pseudostringlocalizer), it can be registered **unconditionally** because it is inert under every non-pseudo culture, so production wiring is not conditional on environment.
- **Where it's used**: registered via `services.Decorate<IStringLocalizerFactory, PseudoStringLocalizerFactory>()` (Scrutor) in `DependencyInjection.AddUIShared` (`DependencyInjection.cs:47`), immediately after `AddLocalization()` (line 40). Its reach includes MudBlazor chrome through [`ResxMudLocalizer`](#resxmudlocalizer), which resolves its `IStringLocalizer<MudTranslations>` through this same factory.

### DataGridListPageBase<TDto>

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:20` · Level 3 · class (abstract)

- **What it is**: the abstract Blazor base for every server-paged `MudDataGrid<TDto>` list page. It folds the otherwise-copy-pasted concerns, cancellation lifecycle, loading flag, mobile/desktop viewport detection, filter/sort extraction, error reporting, scroll restore, density toggle, URL+session+prerender state plumbing, and disposal, into one reusable component.
- **Depends on**: [`ErrorMessages`](#errormessages) (Level 2), [`SharedResource`](#sharedresource) (Level 0, injected as `IStringLocalizer<SharedResource>`), [`ListPageState`](#listpagestate) (Level 0), [`PersistedGridState`](#persistedgridstate) (Level 0, nested), [`ListPageQueryStateService`](#listpagequerystateservice) (Level 1), [`ListPageStateService`](#listpagestateservice) (Level 1), [`BreakpointConstants`](#breakpointconstants) (Level 0); MudBlazor's `MudDataGrid<T>`, `GridState<T>`, `GridData<T>`, `IBrowserViewportObserver`/`IBrowserViewportService` (NuGet); Blazor's `PersistentComponentState`, `NavigationManager`, `IJSRuntime` (framework).
- **Concept introduced, a behavior-rich Blazor base component.** `[Rubric §18, UI Architecture & Component Design]` (assesses reuse; every list page inherits this behavior with zero copy-paste) and `[Rubric §23, Front-End Performance & Rendering]` (assesses server-side paging, only the requested page is fetched, never the whole table, plus the prerender-cache that skips a redundant fetch). It also embodies several hard-won quality notes: the `MudDataGrid v9 RowsPerPage` bug (the v9 parameter setter clobbers `CurrentPage`), the disposed-CTS race (a debounced reload firing after disposal threw `ObjectDisposedException` and stuck the `blazor-error-ui` banner onto the next page), and the stale-write race (a late grid-state save landing after navigation stamped grid params onto the *next* page's URL and disposed it), all worked around here, touching `[Rubric §22, Responsive & Cross-Browser]` and `[Rubric §28, Front-End Testing]` (these were E2E-discovered regressions). Its cancellation snackbar reads a localized string from [`SharedResource`](#sharedresource), the `[Rubric §27, Internationalization]` angle.
- **Walkthrough**: in teaching order:
  - **Injected services & abstract surface** (lines 22-32), `ISnackbar` (line 22), `IStringLocalizer<SharedResource>` (line 23, the localized cancel message), `IBrowserViewportService` (line 24), the two state services (lines 25-26), `NavigationManager` (line 27), `IJSRuntime` (line 28), `PersistentComponentState` (line 29); derived pages supply the abstract `Title` (line 32) and may override `GridRef` (line 112), `SaveFilters`/`RestoreFilters` (lines 99,102), and `OnMobileDataRequestedAsync` (line 693).
  - **State fields** (lines 75-90), the CTS (line 75), the `_disposed` guard (line 76), the prerender caches (`_persistedGridData`/`_lastSuccessfulGridData`, lines 79-80), the scroll module/`DotNetObjectReference` (lines 77,81), the saved-state mirror fields (`_savedPage`, `_savedPageSize`, `_savedSortColumn`, …, lines 83-86), and the `_ownRoutePath` pin (line 678). The bindable `CurrentPageState` (line 48), `RowsPerPageState` (line 58, defaulting to 10 to match MudDataGrid v9), and `DenseGrid` (line 67) sit above; `PrerenderFetchTimeoutMs = 5000` (line 73) bounds the SSR fetch.
  - `OnInitialized` (lines 121-202), synchronously (a) restores any [`PersistedGridState`](#persistedgridstate) from `PersistentComponentState` (lines 127-131), (b) registers the persisting callback with an explicit `RenderMode.InteractiveAuto` (lines 140-150; the explicit mode is required because the page inherits its render mode from `<Routes @rendermode="InteractiveAuto">` and the framework otherwise cannot associate the callback), (c) pins `_ownRoutePath` to this page's route (line 157, the stale-write guard's anchor), (d) reads the URL via [`ListPageQueryStateService`](#listpagequerystateservice) (line 159) and falls back to the in-memory [`ListPageStateService`](#listpagestateservice) snapshot when the URL is pristine (lines 161-170), (e) primes `CurrentPageState`/`RowsPerPageState`/`DenseGrid` (lines 172-184) so the grid's *first* `ServerData` call fetches the right page directly, and (f) subscribes to `LocationChanged` (line 198).
  - `OnLocationChanged` (lines 204-242), reacts only to same-path back/forward (different paths are handled by disposal, lines 214-218), re-reads the URL, applies `CurrentPage` to the live grid via the BL0005-suppressed `ApplyCurrentPageFromUrl` (lines 244-251), and reloads (line 238).
  - `OnAfterRenderAsync(firstRender)` (lines 275-331), on first render, hydrates session state now that interop is available (`HydrateFromSessionAsync`, line 283), runs the cross-circuit fallback (`needsSessionRestore`, lines 289-294), subscribes to viewport changes (line 303), imports `list-page-scroll.js` (lines 305-307) and enables debounced scroll tracking via a `DotNetObjectReference` (lines 308-313), then calls `RestoreGridStateAsync` (line 315). On every render it restores a pending scroll position once the grid has stopped loading (lines 324-328).
  - `LoadServerDataAsync(state, fetchAsync, …)` (lines 425-501), the heart of the desktop path: resets the CTS (line 431), returns the prerender cache on the first interactive call (lines 435-450, skipping a round-trip), extracts filters/sort from `GridState<TDto>` with a saved-sort fallback (lines 455-467), bounds the fetch with `CreateFetchCts` (lines 509-518, during **non-interactive** prerender it `CancelAfter(PrerenderFetchTimeoutMs)` at line 514 so a cold/unreachable backend cannot block the page load indefinitely), maps `OperationCanceledException` to an empty grid plus a localized `Localizer["Grid.Snackbar.LoadCancelled"]` snackbar (lines 483-490), and maps any other `Exception` to an empty grid plus [`ErrorMessages.LoadError`](#errormessages) (line 493).
  - `LoadMobileDataAsync` (lines 524-558), the mobile-card equivalent, error path also via [`ErrorMessages.LoadError`](#errormessages) (line 549).
  - `ResetCancellationTokenAsync` (lines 560-582), swaps in a fresh CTS *first*, then tears down the previous one, tolerating `ObjectDisposedException` (lines 577-580, the disposed-CTS race fix noted above).
  - `SaveCurrentState` (lines 598-635), guarded by `IsOwnRouteCurrent()` (line 602, the stale-write drop) then writes the new [`ListPageState`](#listpagestate) to all three channels: the in-memory service (line 622), the URL (`ReplaceState`, line 627, with `_suppressNextLocationChanged` set at line 626 so it does not re-trigger its own `LocationChanged` handler), and sessionStorage (`PersistToSessionAsync`, line 633, skipped during the deferred-hydration window).
  - `ToggleDensity`/`PersistDensity` (lines 642-647 and 655-675), the density toggle: flips `DenseGrid` and mirrors just that field through the same in-memory + URL + sessionStorage tail (with the same `IsOwnRouteCurrent` guard, line 658), so a density change made before the grid's first `ServerData` save is not lost.
  - `RestoreGridStateAsync`/`RestoreCurrentPageAfterRowsPerPageReset` (lines 384-410 and 349-356), the MudDataGrid v9 workaround: force `SetRowsPerPageAsync(size, resetPage: false)` (line 395) if the parameter setter did not take, then re-restore `CurrentPage` from `_savedPage` because the v9 setter resets it to 0.
  - `DisposeAsync`/`Dispose` (lines 698-772), unsubscribes `LocationChanged`, disables scroll tracking, unsubscribes the viewport observer, and cancels+disposes the CTS, all guarded against shutdown-time JS races (`JSDisconnectedException`/`JSException`, lines 716-723).
- **Why it's built this way**: every concern here was independently re-implemented (and re-broken) on individual pages before being lifted into one base; consolidating them means a single fix (the v9 paging bug, the prerender timeout, the disposed-CTS race, the stale-write race) propagates to every list page at once. The four-channel persistence (URL + memory + sessionStorage + prerender cache) covers the full matrix of how a user can leave and return to a list.
- **Where it's used**: base class for every list page in ADC (`EventListPage`, `SessionListPage`, `SpeakerListPage`, …) and Store.
- **Caveats / not-in-source**: two `BL0005` suppressions (lines 244, 349) set `grid.CurrentPage` from outside the component; the justification (MudDataGrid v9 exposes no public method for arbitrary-page navigation and the setter is well-behaved) is inlined. The persisted-grid optimization assumes the backend is warm in production; under a cold backend the prerender fetch times out at 5s (`PrerenderFetchTimeoutMs`) and the interactive pass refills the grid. The `list-page-scroll.js` module (`enableScrollTracking`/`setScrollPosition`) is JavaScript under `wwwroot`; this `.cs` file only invokes it by name, so its behavior is not verifiable from this source.

### CultureDelegatingHandler
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/CultureDelegatingHandler.cs:13` · Level 0 · class (sealed)

- **What it is**: a `DelegatingHandler` that stamps the active UI culture onto every outgoing API
  request as an `Accept-Language` header, so the server localizes its error messages to the user's
  chosen language (ADR-027).
- **Depends on**: BCL only (`System.Globalization.CultureInfo`, `System.Net.Http.Headers`,
  `System.Net.Http.DelegatingHandler`).
- **Concept introduced, the outbound i18n channel across origins.** `[Rubric §27, Internationalization]`
  assesses whether the app carries locale end to end rather than localizing only the shell. The doc
  comment (`CultureDelegatingHandler.cs:6-11`) states the reason this handler must exist: the
  cross-origin Gateway does not forward the culture cookie to the backend services, so the header is
  the one channel that makes backend (`Result`) failure text come back in the selected language.
  `[Rubric §18, UI Architecture]` also applies: cross-cutting request behavior lives in an HttpClient
  pipeline stage, not scattered through call sites.
- **Walkthrough**: `SendAsync` (`CultureDelegatingHandler.cs:16`) reads `CultureInfo.CurrentUICulture.Name`
  (line 20); when it is non-blank it clears any existing `AcceptLanguage` values and adds a single
  `StringWithQualityHeaderValue` for that culture (lines 21-25), then defers to `base.SendAsync`
  (line 27). It is synchronous apart from returning the base task (no `async` state machine).
- **Why it's built this way**: a message handler runs once per request regardless of which page or
  service issued it, so the locale contract is enforced uniformly. Registered in the `"APIClient"`
  HttpClient pipeline via `AddHttpMessageHandler`.
- **Where it's used**: the `"APIClient"` named HttpClient shared by the UI service base classes in this
  group ([`AuthenticatedServiceBase`](#authenticatedservicebase),
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](#entityservicebasetentitydto-tidentifiertype),
  and the preference readers/writers).

### IUserPreferenceWriter
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/IUserPreferenceWriter.cs:9` · Level 0 · interface

- **What it is**: the contract for persisting a signed-in user's culture/theme choice to the backend so
  it follows them across devices (ADR-027 / ADR-028).
- **Depends on**: nothing first-party.
- **Concept introduced, best-effort server persistence over a cookie runtime channel.**
  `[Rubric §19, State Management]` assesses where UI state actually lives and how it survives sessions.
  The doc comment (`IUserPreferenceWriter.cs:3-7`) is precise about the design contract: the cookie and
  localStorage remain the *runtime* channel that drives the live switch, so this server persist is a
  durability upgrade only. Implementations must be best-effort and a no-op for anonymous users, so a
  failed or skipped persist never breaks the in-page toggle. `[Rubric §26, Front-End Security]` is
  implied by the anonymous-user carve-out (no profile write without a token).
- **Walkthrough**: one method, `SaveAsync(string? culture, string? theme, CancellationToken)`
  (`IUserPreferenceWriter.cs:18`). Either argument may be `null`, meaning "leave that preference
  unchanged", so a theme-only change does not clobber the stored culture.
- **Why it's built this way**: separating the write contract from its implementation lets a host that
  lacks the `auth/preferences` endpoint (the Helpdesk seed) simply not register a writer, while
  full apps bind [`ApiUserPreferenceWriter`](#apiuserpreferencewriter).
- **Where it's used**: implemented by [`ApiUserPreferenceWriter`](#apiuserpreferencewriter); called from
  the theme toggle and culture picker after a successful in-page switch.

### ListPageState
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ListPageStateService.cs:9` · Level 0 · record (sealed)

- **What it is**: an immutable snapshot of a list page's UI state (paging, scroll, sort, density, and
  named filters) that is captured and restored around navigation.
- **Depends on**: nothing first-party (uses only BCL collection types).
- **Concept introduced, the list-page state snapshot.** `[Rubric §19, State Management]` assesses
  whether transient UI state is modeled explicitly rather than reconstructed by luck.
  `[Rubric §25, Navigation & IA]` assesses whether back/forward and refresh land the user where they
  were. This record is the vocabulary both mechanisms share: an in-memory service
  ([`ListPageStateService`](#listpagestateservice)) and a URL codec
  ([`ListPageQueryStateService`](#listpagequerystateservice)) both read and produce it.
- **Walkthrough**: seven `init` properties. `Page` (`ListPageStateService.cs:12`) is the MudDataGrid
  0-indexed page; `PageSize` (line 15) the rows per page; `MobilePage` (line 18) the card-list 1-indexed
  page (defaulting to `1`); `ScrollPosition` (line 21) the document scroll offset in pixels; `SortColumn`
  (line 27) the active `SortBy` property name (`null`/empty when unsorted); `SortDescending` (line 33)
  the direction, ignored when there is no sort column; `DenseGrid` (line 41) the opt-in compact density;
  and `Filters` (line 47) a read-only `string -> string` dictionary of page-specific named filters,
  defaulting to an empty dictionary. Being a `record`, updates use `with` expressions (as
  [`ListPageStateService.UpdateScrollPosition`](#listpagestateservice) does).
- **Why it's built this way**: immutability makes the snapshot safe to hand between the in-memory cache,
  `sessionStorage`, and the URL without defensive copies; the `init`-only shape means a restored state
  can never be half-mutated by a stray write.
- **Where it's used**: produced/consumed by [`ListPageStateService`](#listpagestateservice) and
  [`ListPageQueryStateService`](#listpagequerystateservice); bound by
  [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) via `Dense="@DenseGrid"` and the paging/sort
  hooks.

### ThemeService
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ThemeService.cs:16` · Level 0 · class (sealed)

- **What it is**: the circuit-scoped owner of the Day/Dark theme preference (ADR-028). It holds the
  current mode, persists it to a non-HttpOnly cookie plus localStorage (via `theme.js`), and raises an
  event so the root `MudThemeProvider` and the app-bar toggle stay in sync.
- **Depends on**: `Microsoft.JSInterop` (`IJSRuntime`, `IJSObjectReference`, `JSDisconnectedException`);
  implements `IAsyncDisposable`.
- **Concept introduced, JS-backed UI preference with an event notification.**
  `[Rubric §20, Design System & Theming]` assesses a single theme source rather than per-page overrides:
  this service is that single owner of the light/dark toggle. `[Rubric §19, State Management]` assesses
  render-mode-safe initialization: the doc comment (`ThemeService.cs:10-13`) warns that JS interop is
  only available after the first interactive render, so `InitializeAsync` must run from
  `OnAfterRenderAsync(firstRender: true)`, never during SSR prerender.
- **Walkthrough**
  - State: `IsDarkMode` (`ThemeService.cs:22`, private-set) and `IsInitialized` (line 25) plus the
    `OnChange` event (line 28) subscribers re-render on.
  - `InitializeAsync` (`ThemeService.cs:34`): idempotent (returns early once `IsInitialized`), imports
    the `theme.js` module, reads the stored value via `get`; if a value exists it matches `"dark"`
    case-insensitively, otherwise it falls back to the OS `systemPrefersDark` (lines 42-45), then sets
    `IsInitialized` and fires `OnChange`.
  - `SetDarkModeAsync(bool)` (`ThemeService.cs:53`): updates the flag, persists `"dark"`/`"light"` via
    the module's `set`, and notifies. `ToggleAsync` (line 62) is `SetDarkModeAsync(!IsDarkMode)`.
  - `GetModuleAsync` (`ThemeService.cs:64`): lazily imports and caches the module reference.
  - `DisposeAsync` (`ThemeService.cs:68`): disposes the cached module, swallowing
    `JSDisconnectedException` because a closed circuit has nothing left to dispose.
- **Why it's built this way**: a cookie (readable server-side) plus localStorage lets the server
  prerender the correct theme with no flash, while the event keeps every live subscriber consistent from
  one source. The first-visit default deferring to `prefers-color-scheme` respects the OS setting.
- **Where it's used**: injected into the root layout's `MudThemeProvider` and the app-bar theme toggle;
  its persisted choice is what [`IUserPreferenceWriter`](#iuserpreferencewriter) later mirrors to the
  backend for cross-device durability.

### UserPreferences
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/UserPreferences.cs:9` · Level 0 · record (sealed)

- **What it is**: a two-field DTO carrying a user's persisted UI preferences (ADR-027 / ADR-028), where
  a `null` field means "not chosen, use the request default or OS preference".
- **Depends on**: nothing first-party.
- **Concept**: a trivial positional record, the read-side counterpart to the write parameters of
  [`IUserPreferenceWriter`](#iuserpreferencewriter). `[Rubric §9, API & Contract Design]` (a small,
  explicit contract on the wire) is the only category that meaningfully applies.
- **Walkthrough**: `sealed record UserPreferences(string? Culture, string? Theme)`
  (`UserPreferences.cs:9`); the doc comment (lines 3-8) fixes the null-means-unset semantics.
- **Where it's used**: returned by [`IUserPreferenceReader.GetAsync`](#iuserpreferencereader) and
  deserialized from `auth/preferences` by [`ApiUserPreferenceReader`](#apiuserpreferencereader) (which
  keeps a shared `Empty = new(null, null)` instance).

### UserPreferencesRequest
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ApiUserPreferenceWriter.cs:19` · Level 0 · record (private sealed, nested)

- **What it is**: the write-side payload PUT to `auth/preferences`, a private nested record inside
  [`ApiUserPreferenceWriter`](#apiuserpreferencewriter) with the same two nullable fields as
  [`UserPreferences`](#userpreferences).
- **Depends on**: nothing first-party; serialized by `System.Net.Http.Json`.
- **Walkthrough**: `private sealed record UserPreferencesRequest(string? Culture, string? Theme)`
  (`ApiUserPreferenceWriter.cs:19`). It is separate from [`UserPreferences`](#userpreferences) only
  because it is the request body, not the response body; the fields are identical.
- **Why it's built this way**: keeping the request type private to the writer signals it is an
  implementation detail of the PUT and not a shared contract.
- **Where it's used**: constructed once inside
  [`ApiUserPreferenceWriter.SaveAsync`](#apiuserpreferencewriter) (`ApiUserPreferenceWriter.cs:36`).

### ApiUserPreferenceWriter
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ApiUserPreferenceWriter.cs:15` · Level 1 · class (sealed)

- **What it is**: the default [`IUserPreferenceWriter`](#iuserpreferencewriter): it PUTs a
  [`UserPreferencesRequest`](#userpreferencesrequest) to `auth/preferences` over the shared `"APIClient"`,
  no-ops for anonymous users, and swallows transport errors so persistence stays best-effort.
- **Depends on**: [`IUserPreferenceWriter`](#iuserpreferencewriter),
  [`ITokenStorageService`](#itokenstorageservice); BCL `IHttpClientFactory` and `System.Net.Http.Json`.
- **Concept, best-effort side-channel persistence.** `[Rubric §19, State Management]` (the durable
  server copy is layered on top of the authoritative cookie channel) and `[Rubric §26, Front-End
  Security]` (no write is attempted without a signed-in token). The doc comment
  (`ApiUserPreferenceWriter.cs:6-11`) makes the fallback explicit: hosts without the endpoint just do not
  register this writer.
- **Walkthrough**: `SaveAsync` (`ApiUserPreferenceWriter.cs:22`) first reads the access token via
  [`ITokenStorageService`](#itokenstorageservice); a null/blank token returns immediately (anonymous
  users have no profile, lines 25-29). Otherwise it creates the `"APIClient"` and PUTs the request
  (lines 33-37), catching `HttpRequestException` (line 39) and `TaskCanceledException` (line 43) and
  swallowing both, because the cookie/localStorage already hold the choice for this device.
- **Why it's built this way**: the shared `"APIClient"` already attaches the bearer token and
  Accept-Language (via [`CultureDelegatingHandler`](#culturedelegatinghandler)), so the writer adds no
  auth logic of its own; swallowing transport faults keeps a background persistence concern from ever
  surfacing as a page error.
- **Where it's used**: registered as [`IUserPreferenceWriter`](#iuserpreferencewriter) in full apps;
  invoked after a [`ThemeService`](#themeservice) toggle or culture change.

### AuthenticatedServiceBase
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/AuthenticatedServiceBase.cs:14` · Level 1 · class (abstract)

- **What it is**: the shared base for Blazor circuit-scoped HTTP services. It supplies a ready-built
  Polly retry policy and a `CreateAuthenticatedClientAsync()` helper that manually attaches the JWT
  bearer token, working around a DI-scope issue in Blazor Server.
- **Depends on**: [`ITokenStorageService`](#itokenstorageservice); `Polly` / `Polly.Retry` (NuGet) and
  `System.Net.Http.Headers` (BCL).
- **Concept introduced, manual token attachment for the circuit scope.** `[Rubric §19, State
  Management]` (auth state read from the circuit-scoped store) and `[Rubric §29, Resilience & Business
  Continuity]` (a uniform retry policy on transient API failures). The doc comment
  (`AuthenticatedServiceBase.cs:30-35`) explains the workaround: `IHttpClientFactory` builds its
  `DelegatingHandler`s in a *separate* DI scope from the Blazor circuit, so the cookie/JS-backed
  [`AuthDelegatingHandler`](#authdelegatinghandler) cannot reach the circuit's `IJSRuntime` to read the
  in-memory access token. This base sidesteps that by reading the token from the circuit-scoped
  [`ITokenStorageService`](#itokenstorageservice) and setting `Authorization` directly.
- **Walkthrough**
  - `RetryPolicy` (`AuthenticatedServiceBase.cs:22`): a `static readonly` Polly policy handling
    `HttpRequestException` or any 5xx result, with three retries at exponential backoff (2s, 4s, 8s via
    `Math.Pow(2, attempt)`).
  - Constructor guards: both injected dependencies are null-checked into `_httpClientFactory` /
    `_tokenStorageService` (lines 27-28).
  - `CreateAuthenticatedClientAsync` (`AuthenticatedServiceBase.cs:36`): creates the `"APIClient"`, reads
    the access token, and (when present) sets `Authorization: Bearer <token>` (lines 38-47); an
    `InvalidOperationException` from JS interop during SSR prerender is caught and the client is returned
    without a token (lines 49-52).
- **Why it's built this way**: centralizing retry and token attachment means every derived service gets
  resilience and auth for free and consistently; catching the prerender exception keeps a service usable
  during server-side render.
- **Where it's used**: base of [`EntityServiceBase<TEntityDTO, TIdentifierType>`](#entityservicebasetentitydto-tidentifiertype)
  and [`ChildEntityServiceBase`](#childentityservicebase), and thus of every module UI service in the
  downstream apps.

### IUserPreferenceReader
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/IUserPreferenceReader.cs:9` · Level 1 · interface

- **What it is**: the read contract for a returning user's persisted culture/theme, applied at login so a
  choice made on one device follows to another (ADR-027 / ADR-028).
- **Depends on**: [`UserPreferences`](#userpreferences).
- **Concept, best-effort read that never blocks login.** `[Rubric §19, State Management]` (cross-device
  preference reconciliation) and `[Rubric §27, Internationalization]` (a returning user's locale is
  restored, not re-guessed). The doc comment (`IUserPreferenceReader.cs:3-8`) mandates the failure mode:
  return an empty [`UserPreferences`](#userpreferences) (both `null`) for anonymous users or on any
  error, so a failed read is invisible to the login flow.
- **Walkthrough**: one method, `GetAsync(CancellationToken)` returning `Task<UserPreferences>`
  (`IUserPreferenceReader.cs:13`).
- **Where it's used**: implemented by [`ApiUserPreferenceReader`](#apiuserpreferencereader); called by
  the login reconciliation step that then applies the stored culture/theme through
  [`ThemeService`](#themeservice) and the culture cookie.

### ListPageQueryStateService
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ListPageQueryStateService.cs:28` · Level 1 · class (sealed)

- **What it is**: the URL codec for [`ListPageState`](#listpagestate). It encodes state into short query
  keys and decodes them back, giving list pages deterministic, shareable, bookmarkable filter/sort/paging
  state through the address bar.
- **Depends on**: [`ListPageState`](#listpagestate); ASP.NET Core `NavigationManager`,
  `Microsoft.AspNetCore.WebUtilities.QueryHelpers`, `Microsoft.Extensions.Primitives.StringValues`, and
  `System.Globalization`.
- **Concept introduced, address-bar as state store.** `[Rubric §25, Navigation & IA]` (browser
  back/forward/refresh and shareable links restore the exact view) and `[Rubric §19, State Management]`
  (the URL is a first-class, durable state channel). The doc comment (`ListPageQueryStateService.cs:14-26`)
  documents the reserved keys, deliberately short because they end up in shared links: `p` desktop page,
  `ps` page size, `mp` mobile page, `s` sort column, `sd` sort direction (`desc` only), `d` dense (`1`
  only), `q` free-text search, and `f:<name>` for any other filter. Default values are omitted so a
  pristine list page has a clean URL.
- **Walkthrough**
  - `ReadCurrent` (`ListPageQueryStateService.cs:45`): resolves the absolute URI from the injected
    `NavigationManager` and hands its query to `ParseQueryString`.
  - `ParseQueryString(string?)` (`ListPageQueryStateService.cs:56`): a `static` pure helper (testable
    without a `NavigationManager`). It parses via `QueryHelpers.ParseQuery`, reads the integer keys with
    the culture-invariant `TryGetInt` helper (lines 60-62, 212-222), resolves the optional sort column,
    matches `sd` against `desc` case-insensitively (lines 74-78), matches `d` against the literal `1`
    ordinally (lines 80-84), then reassembles the filter dictionary, mapping the reserved `q` to the
    `search` filter name and stripping the `f:` prefix from the rest (lines 86-103).
  - `BuildPath(string, ListPageState)` (`ListPageQueryStateService.cs:122`): a `static` inverse that emits
    only non-default values (page > 0, mobile page > 1, a present sort column, dense true, non-empty
    filters), formatting integers with `CultureInfo.InvariantCulture`, and returns the bare `basePath`
    when nothing needs encoding.
  - `ReplaceState(string, ListPageState)` (`ListPageQueryStateService.cs:196`): writes the encoded URL
    with `NavigationOptions.ReplaceHistoryEntry = true` so filter churn does not pollute the back stack.
    Critically, it **drops the write** when the current path no longer matches `basePath` (lines 201-206):
    the remarks (lines 186-195) record an E2E-diagnosed bug where a deferred grid-state write (debounced
    search, a late `ServerData` completion) landed after the user had navigated away, stamping grid
    params onto the next page's URL and canceling that page's first data fetch mid-load.
- **Why it's built this way**: making the parse/build methods `static` and pure keeps them unit-testable
  and side-effect-free; anchoring `ReplaceState` to the owning `basePath` is the guard that turns an
  inherently deferred write into a safe one.
- **Where it's used**: paired with [`ListPageStateService`](#listpagestateservice) inside
  [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto); the URL is the shareable channel while the
  session store is the fast in-memory one.
- **Caveats / not-in-source**: `ParseQueryString` and `BuildPath` are inverses only for the keys they
  model; unrecognized query keys are ignored on read and never emitted on build.

### ListPageStateService
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ListPageStateService.cs:58` · Level 1 · class (sealed)

- **What it is**: the per-circuit scoped keeper of [`ListPageState`](#listpagestate) across in-app
  navigation. A synchronous in-memory dictionary is the fast path; two async methods mirror entries
  through `sessionStorage` so state survives circuit teardowns, `forceLoad` navigations, and the
  SSR to WASM render-mode transition.
- **Depends on**: [`ListPageState`](#listpagestate); `Microsoft.JSInterop` (`IJSRuntime`,
  `IJSObjectReference`, `JSDisconnectedException`, `JSException`).
- **Concept, dual-layer (memory + sessionStorage) UI state.** `[Rubric §19, State Management]` (explicit
  survival across render modes and reloads) and `[Rubric §23, Front-End Performance]` (a synchronous
  in-memory read on the render path, JS interop only on the slower hydrate/persist edges). The doc
  comment (`ListPageStateService.cs:50-57`) frames the memory dictionary as the fast path and the
  `sessionStorage` mirror (via the lazily imported `nav-interop.js`) as the durability layer.
- **Walkthrough**
  - Fields: the private `Dictionary<string, ListPageState>` keyed by route path (`ListPageStateService.cs:63`),
    a lazily imported `_module` reference, and the `SessionKeyPrefix` / `ModulePath` constants
    (lines 60-64).
  - `GetState(routePath)` (`ListPageStateService.cs:71`): synchronous `GetValueOrDefault`, safe to call
    from `OnInitialized` during prerender.
  - `SaveState` (line 79) and `UpdateScrollPosition` (line 87): the latter is a scroll fast path that uses
    a `with` expression to patch only `ScrollPosition`, creating a minimal [`ListPageState`](#listpagestate)
    if the grid has not yet saved one.
  - `HydrateFromSessionAsync(routePath)` (`ListPageStateService.cs:98`): loads persisted state from
    `sessionStorage` into memory, meant for `OnAfterRenderAsync(firstRender: true)`. Every JS call is
    guarded: `InvalidOperationException` (prerender), `JSDisconnectedException` (circuit torn down), and
    `JSException` (storage failures like Safari Private mode / quota) are each caught and treated as a
    silent no-op (lines 114-125).
  - `PersistToSessionAsync(routePath)` (`ListPageStateService.cs:133`): writes the current in-memory state
    back through `sessionSet`, with the same three-way exception guard.
  - `GetModuleAsync` (`ListPageStateService.cs:164`): imports and caches `nav-interop.js`, returning `null`
    (rather than throwing) when interop is unavailable, so callers degrade gracefully.
- **Why it's built this way**: reading state synchronously keeps the render path off the JS interop
  round-trip, while the defensive try/catch around every interop call means a storage or lifecycle
  failure never breaks the calling page. Lazy module import avoids paying for `nav-interop.js` until a
  list page needs it.
- **Where it's used**: injected into [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) alongside
  [`ListPageQueryStateService`](#listpagequerystateservice); together they restore a list page's exact
  position after navigation.

### MmcaCultureBootstrap
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/MmcaCultureBootstrap.cs:14` · Level 1 · class (static)

- **What it is**: the Blazor WebAssembly culture bootstrap (ADR-027). It reads the same ASP.NET culture
  cookie the server used during SSR prerender and sets the thread default cultures *before* the WASM host
  runs, so the interactive client renders in the language the server prerendered, with no locale flash
  and no prerender/hydration mismatch.
- **Depends on**: [`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures);
  `Microsoft.JSInterop` and `System.Globalization`.
- **Concept, prerender/hydration locale parity.** `[Rubric §27, Internationalization]` (the client and
  server agree on locale from the first frame) and `[Rubric §23, Front-End Performance]` (avoiding a
  visible re-render when the client would otherwise default to a different culture). The doc comment
  (`MmcaCultureBootstrap.cs:7-13`) states the calling contract: invoke it in the `.Client`
  `Program.cs` after `builder.Build()` and before `host.RunAsync()`.
- **Walkthrough**: `SetBrowserCultureAsync(IJSRuntime)` (`MmcaCultureBootstrap.cs:22`) null-checks the
  runtime, imports `culture.js`, and reads the cookie value via `getCulture` (lines 26-28). It then
  validates that value with [`SupportedCultures.IsSupported`](group-12-api-hosting-mapping.md#supportedcultures),
  falling back to `SupportedCultures.Default` when unsupported (line 30), and assigns the resolved
  `CultureInfo` to both `CultureInfo.DefaultThreadCurrentCulture` and `DefaultThreadCurrentUICulture`
  (lines 31-33). The imported module is disposed via `await using`.
- **Why it's built this way**: setting the *default thread* cultures before the host starts means every
  component the WASM host creates inherits the correct locale, rather than each component correcting
  itself after render. Routing the allow-list decision through
  [`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures) keeps the client and server on
  one source of truth for which locales exist.
- **Where it's used**: the WASM `.Client` startup of the downstream apps; the server-side counterpart is
  the culture cookie set by the API, and the outbound header is
  [`CultureDelegatingHandler`](#culturedelegatinghandler).

### ApiUserPreferenceReader
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ApiUserPreferenceReader.cs:14` · Level 2 · class (sealed)

- **What it is**: the default [`IUserPreferenceReader`](#iuserpreferencereader): it GETs
  `auth/preferences` over the shared `"APIClient"` and returns [`UserPreferences`](#userpreferences),
  degrading to empty preferences for anonymous users or on any transport error.
- **Depends on**: [`IUserPreferenceReader`](#iuserpreferencereader), [`UserPreferences`](#userpreferences),
  [`ITokenStorageService`](#itokenstorageservice); `IHttpClientFactory` and `System.Net.Http.Json`.
- **Concept**: the read-side mirror of [`ApiUserPreferenceWriter`](#apiuserpreferencewriter), same
  best-effort discipline. `[Rubric §19, State Management]` (login-time cross-device reconciliation) and
  `[Rubric §26, Front-End Security]` (no fetch without a token).
- **Walkthrough**: a shared `static readonly UserPreferences Empty = new(null, null)`
  (`ApiUserPreferenceReader.cs:18`) is the degraded return. `GetAsync` (line 21) reads the access token;
  a blank token returns `Empty` (lines 23-27); otherwise it creates the `"APIClient"`, GETs the JSON,
  returns the deserialized value or `Empty` (lines 31-35), and catches `HttpRequestException` (line 37)
  and `TaskCanceledException` (line 41), returning `Empty` from both.
- **Why it's built this way**: the single reusable `Empty` instance avoids allocating a no-preference
  object on every anonymous or failed call, and swallowing transport faults keeps a returning-user
  optimization from ever blocking login.
- **Where it's used**: registered as [`IUserPreferenceReader`](#iuserpreferencereader) in full apps;
  its result is applied to [`ThemeService`](#themeservice) and the culture cookie at login.

### ServiceExceptionHelper
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ServiceExceptionHelper.cs:11` · Level 2 · class (static)

- **What it is**: a static helper that inspects a non-success HTTP response for the WebAPI's
  ProblemDetails-style error payloads and re-throws them as
  [`DomainInvariantViolationException`](group-01-result-error-handling.md#domaininvariantviolationexception),
  so UI pages can display the original server error message instead of a generic transport failure.
- **Depends on**: [`DomainInvariantViolationException`](group-01-result-error-handling.md#domaininvariantviolationexception)
  (via `MMCA.Common.Shared.Exceptions`); `System.Text.Json`.
- **Concept introduced, translating the server error contract at the UI edge.** `[Rubric §9, API &
  Contract Design]` (clients rely on the server's structured error shape) and `[Rubric §24,
  Forms/Validation/UX Safety]` (the user sees the real validation message, not "server error"). The
  server returns RFC 9457 ProblemDetails; this helper branches on the `title` field and extracts the
  human message for each known kind.
- **Walkthrough**: `ThrowIfDomainExceptionAsync(HttpResponseMessage, CancellationToken)`
  (`ServiceExceptionHelper.cs:17`) null-checks the response, returns early on a null/blank body
  (lines 21-26), and tries to parse the body as JSON, returning quietly when it is not JSON (a bare 401
  challenge or HTML error page, lines 28-38) so the caller's `EnsureSuccessStatusCode()` handles it.
  It then reads `title` (lines 44-47) and branches ordinally: `"Domain Exception"` extracts `detail`
  (`ExtractDetailMessage`, line 60); `"Validation Exception"` joins the `errors` object's messages
  (`ExtractValidationMessage`, line 65); `"Operation failed"` joins the `errors` array's `message`
  fields (`ExtractOperationFailedMessage`, line 85, via `CollectErrorMessages`, line 100). Each throws a
  [`DomainInvariantViolationException`](group-01-result-error-handling.md#domaininvariantviolationexception)
  carrying the extracted text (lines 49-56).
- **Why it's built this way**: parsing the body *before* `EnsureSuccessStatusCode()` is what lets a
  domain/validation failure surface as a meaningful message rather than a generic
  `HttpRequestException`; the JSON-parse guard means a non-JSON error page never crashes the helper.
- **Where it's used**: called by
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](#entityservicebasetentitydto-tidentifiertype) and
  [`ChildEntityServiceBase`](#childentityservicebase) on every non-success response before they enforce
  the status code.

### ChildEntityServiceBase
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ChildEntityServiceBase.cs:17` · Level 3 · class (abstract)

- **What it is**: the base HTTP service for join/child entities that support POST (add) and DELETE
  (remove) but no standalone reads, the many-to-many sibling of
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](#entityservicebasetentitydto-tidentifiertype).
- **Depends on**: [`AuthenticatedServiceBase`](#authenticatedservicebase) (base),
  [`ServiceExceptionHelper`](#serviceexceptionhelper), [`ITokenStorageService`](#itokenstorageservice);
  `System.Net.Http.Json` and `System.Net`.
- **Concept, the two-verb join-entity service.** `[Rubric §18, UI Architecture]` (join operations behind
  a typed service, not raw `HttpClient` in components) and `[Rubric §9, API & Contract Design]` (a
  DELETE that distinguishes not-found from failure). It inherits the authenticated client and retry
  behavior from [`AuthenticatedServiceBase`](#authenticatedservicebase) and extracts domain errors via
  [`ServiceExceptionHelper`](#serviceexceptionhelper), since join endpoints sit behind `[Authorize]` like
  their parent CRUD endpoints.
- **Walkthrough**
  - Constructor takes the two DI dependencies plus a relative `endpoint` string, forwarding the first two
    to [`AuthenticatedServiceBase`](#authenticatedservicebase) (`ChildEntityServiceBase.cs:17-20`).
  - `PostAsync<TRequest>(request, ct)` (`ChildEntityServiceBase.cs:24`): builds an authenticated client,
    POSTs the payload, and on a non-success response calls
    [`ServiceExceptionHelper.ThrowIfDomainExceptionAsync`](#serviceexceptionhelper) before
    `EnsureSuccessStatusCode()` (lines 26-35).
  - `DeleteByIdAsync(id, ct)` (`ChildEntityServiceBase.cs:39`): DELETEs `endpoint/id`, returns `false` on
    `HttpStatusCode.NotFound` (lines 45-48), otherwise runs the same domain-error extraction and returns
    `true` (lines 50-56).
- **Why it's built this way**: modeling a join as add/remove-only (no GET) matches its lack of identity
  as a standalone resource, and returning `false` for a missing row lets a caller treat "already gone" as
  success rather than an error.
- **Where it's used**: subclassed by module-specific join services that supply their endpoint and add
  typed `AddAsync`/`DeleteAsync` wrappers over `PostAsync` / `DeleteByIdAsync`.

### EntityServiceBase<TEntityDTO, TIdentifierType>
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:23` · Level 3 · class (abstract)

- **What it is**: the abstract base for every module UI CRUD service. It implements
  [`IEntityService<TEntityDTO, TIdentifierType>`](#ientityservicetentitydto-tidentifiertype) over the
  named `"APIClient"`, with a Polly retry policy, automatic domain-error extraction, and one central HTTP
  dispatch method.
- **Depends on**: [`AuthenticatedServiceBase`](#authenticatedservicebase) (base),
  [`IEntityService<TEntityDTO, TIdentifierType>`](#ientityservicetentitydto-tidentifiertype),
  [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype),
  [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype),
  [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
  [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata),
  [`ServiceExceptionHelper`](#serviceexceptionhelper),
  [`ITokenStorageService`](#itokenstorageservice).
- **Concept introduced, the Blazor UI service layer as a typed HTTP client.** `[Rubric §18, UI
  Architecture]` (components depend on an interface, not raw `HttpClient`) and `[Rubric §19, State
  Management]` (data flows through typed services). `[Rubric §29, Resilience]` applies through the
  inherited retry, and `[Rubric §24, Forms/Validation/UX Safety]` through the pre-`EnsureSuccessStatusCode`
  domain-error extraction. The generic constraints bind `TEntityDTO` to
  [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) and
  `TIdentifierType` to `notnull` (`EntityServiceBase.cs:27-28`), so `GetEntityId` can read `entity.Id`
  generically (line 158).
- **Walkthrough**
  - `GetAllAsync` (`EntityServiceBase.cs:32`): appends `includeFKs`/`includeChildren`, unwraps a
    [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), and returns
    its `Items`.
  - `GetPagedAsync` (`EntityServiceBase.cs:51`): composes the full paging/sort/filter query string,
    `Uri.EscapeDataString`-encoding every property, operator, and value, formats the integer parts with
    `CultureInfo.InvariantCulture`, GETs `/paged`, and returns items plus
    [`PaginationMetadata.TotalItemCount`](group-01-result-error-handling.md#paginationmetadata).
  - `GetAllForLookupAsync` (`EntityServiceBase.cs:90`): GETs `/lookup` and unwraps a
    [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt) of
    [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype).
  - `GetByIdAsync` (line 102, `treatNotFoundAsDefault: true`), `AddAsync` (line 120, `throwIfNull: true`),
    `UpdateAsync` (line 132, `expectContent: false`), `DeleteAsync` (line 145, `expectContent: false`):
    the CRUD verbs, each delegating to the central dispatcher with a flag tuned to its response shape.
  - `SendRequestAsync<T>` (`EntityServiceBase.cs:171`): the one dispatch method. It builds an
    authenticated client, runs the HTTP action through the inherited `RetryPolicy` (line 180), converts
    404 to `default` when `treatNotFoundAsDefault` (line 182), extracts domain errors via
    [`ServiceExceptionHelper`](#serviceexceptionhelper) *before* `EnsureSuccessStatusCode()` (lines
    186-189), skips deserialization when `expectContent` is false (lines 191-192), and can throw when a
    required result is null (lines 196-197).
- **Why it's built this way**: routing every verb through one dispatcher means retry, auth, and
  structured-error handling are applied identically across all CRUD, and subclasses override only for
  domain-specific operations. The `virtual` methods leave that door open without forcing it.
- **Where it's used**: base class of the module UI services (Conference, Identity, Engagement) in the
  downstream apps; those services back the pages built on
  [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto).

### IOAuthUISettings
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/IOAuthUISettings.cs:9` · Level 0 · interface

- **What it is**: the UI-layer contract that declares which external OAuth providers are available so
  the shared login page can conditionally render social-login buttons.
- **Depends on**: nothing first-party.
- **Concept introduced, safe-by-default via default interface members.** `[Rubric §18, UI
  Architecture]` (assesses how presentation configuration is surfaced without leaking backend
  concerns) and `[Rubric §26, Front-End Security]` (assesses that optional auth surfaces are opt-in).
  Both members are **default interface members**: `bool GoogleEnabled => false`
  (`IOAuthUISettings.cs:12`) and `bool GitHubEnabled => false` (`IOAuthUISettings.cs:15`). An app that
  registers no implementation, or the no-op [`DefaultOAuthUISettings`](#defaultoauthuisettings), gets
  "no social login": the buttons stay hidden. Turning a provider on is additive, an implementation
  returns `true` for the property it enables, with no change to the shared login component.
- **Walkthrough**: two boolean getter members, both defaulting to `false`. The login Razor component
  reads `IOAuthUISettings` from DI to decide whether to render each provider's button.
- **Why it's built this way**: default interface members remove the need for a separate no-op class
  while still shipping a usable, secure default (social login off until deliberately enabled).
- **Where it's used**: implemented by the no-op [`DefaultOAuthUISettings`](#defaultoauthuisettings)
  and the config-driven [`ConfigurationOAuthUISettings`](#configurationoauthuisettings); consumed by
  the login page.

### ISessionCookieSync
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/ISessionCookieSync.cs:8` · Level 0 · interface

- **What it is**: the contract for keeping the browser's HttpOnly auth cookie in step with the
  client's in-memory tokens, so a server-side prerender can recognize an already-authenticated user.
- **Depends on**: nothing first-party.
- **Concept introduced, the prerender/interactive cookie boundary.** `[Rubric §18, UI Architecture]`
  (assesses how the SSR prerender pass and the interactive circuit share auth state) and `[Rubric §26,
  Front-End Security]` (assesses that the refresh secret stays in an HttpOnly cookie, not JS). The doc
  comment (`ISessionCookieSync.cs:3-7`) states the exact failure this prevents: the interactive
  circuit's in-memory access token is unreachable from the server, so without a synced cookie a
  right-click "Open in new tab" on an `[Authorize]` page (which prerenders on the server) redirects to
  `/login`. This is the client half of the dual-fetch auth model (ADR-004).
- **Walkthrough**: two methods, `SyncAsync(string accessToken, string refreshToken)`
  (`ISessionCookieSync.cs:10`), called after login and each refresh to write the cookie, and
  `ClearAsync()` (`ISessionCookieSync.cs:12`), called on logout to delete it.
- **Why it's built this way**: keeping this an interface lets each host supply the right mechanism, a
  browser fetch on the web heads ([`JsFetchSessionCookieSync`](#jsfetchsessioncookiesync)) and a no-op
  on MAUI (no SSR, no cookie).
- **Where it's used**: implemented by [`JsFetchSessionCookieSync`](#jsfetchsessioncookiesync); driven
  by [`WasmTokenStorageService`](#wasmtokenstorageservice) at login and logout.

### ITokenRefresher
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/ITokenRefresher.cs:13` · Level 0 · interface

- **What it is**: the contract that acquires a fresh JWT access token, abstracting over where the
  refresh credential lives per host.
- **Depends on**: nothing first-party.
- **Concept introduced, host-agnostic token refresh.** `[Rubric §11, Security]` and `[Rubric §26,
  Front-End Security]` (both assess that the refresh token, the high-value secret, is handled by the
  safest mechanism per platform). The doc comment (`ITokenRefresher.cs:3-12`) names the two concrete
  paths this single method hides: on the browser hosts (Server + WASM),
  [`SameOriginProxyTokenRefresher`](#sameoriginproxytokenrefresher) calls the same-origin
  `/auth/session/token` endpoint where the refresh token sits in an HttpOnly cookie and rotates
  server-side (never exposed to JS); on MAUI, [`DirectApiTokenRefresher`](#directapitokenrefresher)
  exchanges the refresh token held in OS SecureStorage directly against `auth/refresh`.
- **Walkthrough**: one method, `Task<string?> AcquireAccessTokenAsync(CancellationToken = default)`
  (`ITokenRefresher.cs:20`). It returns a fresh access token, or `null` when no valid session exists
  (missing, expired, or revoked credential), a clean null convention so callers redirect to login
  rather than catch exceptions.
- **Why it's built this way**: a one-method contract with a null-means-reauthenticate convention lets
  the storage layer stay identical across hosts while the refresh-token persistence differs at the
  edges (ADR-004).
- **Where it's used**: implemented by [`SameOriginProxyTokenRefresher`](#sameoriginproxytokenrefresher)
  and [`DirectApiTokenRefresher`](#directapitokenrefresher); consumed by
  [`WasmTokenStorageService`](#wasmtokenstorageservice) and [`AuthUIService`](#authuiservice).

### ITokenStorageService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/ITokenStorageService.cs:8` · Level 0 · interface

- **What it is**: the platform-agnostic contract for persisting the JWT access/refresh pair, letting
  each host use the safe storage mechanism for its platform.
- **Depends on**: nothing first-party.
- **Concept introduced, platform-abstracted token persistence.** `[Rubric §26, Front-End Security]`
  and `[Rubric §11, Security]` (assess that tokens are held in the safest store per platform). The doc
  comment (`ITokenStorageService.cs:3-7`) fixes the policy the implementations honor: browser hosts
  keep the access token **in memory** and mirror the refresh token to an HttpOnly cookie, never
  `localStorage`; MAUI uses OS SecureStorage. Managing both tokens through one abstraction means no
  page component ever touches a raw storage API.
- **Walkthrough**: four methods, `GetAccessTokenAsync()` (`ITokenStorageService.cs:11`) and
  `GetRefreshTokenAsync()` (`ITokenStorageService.cs:14`) each returning `Task<string?>` (async
  because SecureStorage is async on MAUI); `SetTokensAsync(accessToken, refreshToken)`
  (`ITokenStorageService.cs:17`), an atomic write of both after login or refresh; and
  `ClearTokensAsync()` (`ITokenStorageService.cs:20`) on logout.
- **Why it's built this way**: an interface (not a base class) keeps the platform-specific
  implementation in its own host with no shared code dependency; writing both tokens together avoids
  partial-update bugs (a fresh access token paired with a stale refresh token).
- **Where it's used**: implemented by [`WasmTokenStorageService`](#wasmtokenstorageservice) (and a
  Blazor Server sibling `ServerTokenStorageService` noted in the WASM doc comment); read by
  [`AuthDelegatingHandler`](#authdelegatinghandler),
  [`JwtAuthenticationStateProvider`](#jwtauthenticationstateprovider), and
  [`AuthUIService`](#authuiservice).

### JwtTokenInfo
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JwtTokenInfo.cs:9` · Level 0 · class (static)

- **What it is**: a static helper that inspects a JWT client-side (expiry only, no signature check) so
  token storage can decide when to re-acquire an access token.
- **Depends on**: BCL only (`System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler`).
- **Concept introduced, deliberate signature-free client inspection.** `[Rubric §26, Front-End
  Security]` (assesses that trust decisions stay server-side) and `[Rubric §12, Performance &
  Scalability]` (assesses avoiding a doomed round-trip). The doc comment (`JwtTokenInfo.cs:5-7`) is
  explicit: there is **no signature validation** here, the API validates every request. The only job
  is to read expiry locally and refresh proactively, avoiding an API call that would come back 401.
- **Walkthrough**: `IsFresh(string? token, TimeSpan skew)` (`JwtTokenInfo.cs:16`): returns `false`
  immediately for null/blank (`JwtTokenInfo.cs:18-21`); returns `false` if `CanReadToken` says the
  string is not a readable JWT (`JwtTokenInfo.cs:24-27`); otherwise returns whether
  `ReadJwtToken(token).ValidTo > DateTime.UtcNow + skew` (`JwtTokenInfo.cs:31`), so a token within
  `skew` of expiry is already treated as stale. A narrow catch of `ArgumentException`/`FormatException`
  (`JwtTokenInfo.cs:33-36`) yields `false` on a malformed token rather than throwing.
- **Why it's built this way**: a pure static method with no dependencies is trivially unit-testable by
  passing token strings and needs no DI. The `skew` argument makes proactive refresh a caller policy,
  not a hard-coded constant.
- **Where it's used**: [`WasmTokenStorageService.GetAccessTokenAsync`](#wasmtokenstorageservice) gates
  its in-memory access token on `JwtTokenInfo.IsFresh(_accessToken, ExpirySkew)` before returning it
  (`WasmTokenStorageService.cs:22`).

### AuthDelegatingHandler
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:9` · Level 1 · class (sealed)

- **What it is**: an `HttpClient` message handler that attaches the stored JWT Bearer token to every
  outgoing API request.
- **Depends on**: [`ITokenStorageService`](#itokenstorageservice) (Level 0); BCL
  (`System.Net.Http.Headers`).
- **Concept introduced, the delegating-handler auth interceptor.** `[Rubric §11, Security]` and
  `[Rubric §18, UI Architecture]` (assess where the outbound auth header is centralized). A
  `DelegatingHandler` is the `HttpClient` analogue of ASP.NET middleware: it wraps a request before it
  goes on the wire. This one reads the access token from
  [`ITokenStorageService`](#itokenstorageservice) and sets `Authorization: Bearer {token}`, so no call
  site has to remember to authenticate.
- **Walkthrough**: `SendAsync` (`AuthDelegatingHandler.cs:13`): awaits `GetAccessTokenAsync`
  (`AuthDelegatingHandler.cs:17`); if the token is non-blank, sets
  `request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token)`
  (`AuthDelegatingHandler.cs:18-21`); then delegates to `base.SendAsync`
  (`AuthDelegatingHandler.cs:23`). With no token the request goes unauthenticated (the API answers 401
  where auth is required).
- **Why it's built this way**: centralizing the header on the handler keeps every service call
  uniformly authenticated without per-call code. The class is `sealed` and constructor-injects its
  one dependency.
- **Where it's used**: registered in the `"APIClient"` named-client pipeline via
  `AddHttpMessageHandler` (per its doc comment, `AuthDelegatingHandler.cs:5-7`). Note that
  [`AuthUIService`](#authuiservice) sets the header manually on some calls because of a Blazor Server
  DI scope issue (`AuthUIService.cs:263`).

### ConfigurationOAuthUISettings
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/ConfigurationOAuthUISettings.cs:13` · Level 1 · class (sealed)

- **What it is**: an [`IOAuthUISettings`](#ioauthuisettings) implementation that reads provider
  availability from the `OAuth` configuration section, covering both host shapes (server and WASM)
  with one class.
- **Depends on**: [`IOAuthUISettings`](#ioauthuisettings) (Level 0); NuGet
  (`Microsoft.Extensions.Configuration.IConfiguration`).
- **Concept introduced, config-driven provider gating that never ships the client id to the browser.**
  `[Rubric §18, UI Architecture]` (assesses configuration-driven UI without backend leakage) and
  `[Rubric §26, Front-End Security]` (assesses that a secret-bearing key stays server-side). The doc
  comment (`ConfigurationOAuthUISettings.cs:5-12`) explains the dual shape: a server host declares a
  provider enabled when its `OAuth:{Provider}:ClientId` is configured; a WASM client instead receives
  a pre-computed `OAuth:{Provider}Enabled` flag through its runtime config (`/client-config`), which
  never carries the client id itself.
- **Walkthrough**: the constructor (`ConfigurationOAuthUISettings.cs:21`) null-guards `configuration`,
  reads the `OAuth` section, and computes `GoogleEnabled`/`GitHubEnabled` once
  (`ConfigurationOAuthUISettings.cs:25-27`) into get-only properties
  (`ConfigurationOAuthUISettings.cs:16,19`). `IsProviderEnabled`
  (`ConfigurationOAuthUISettings.cs:30`) returns `true` when either the `{Provider}Enabled` flag parses
  to `true` **or** a non-empty `{Provider}:ClientId` is present
  (`ConfigurationOAuthUISettings.cs:32-33`), so the flag path (WASM) and the client-id path (server)
  both light up the button.
- **Why it's built this way**: folding both host shapes into one predicate avoids two near-identical
  settings classes and keeps the "browser never sees the client id" rule in one place; computing the
  flags in the constructor makes the instance immutable and cheap to read.
- **Where it's used**: registered as a singleton (per its doc comment,
  `ConfigurationOAuthUISettings.cs:7`) to replace the no-op
  [`DefaultOAuthUISettings`](#defaultoauthuisettings); consumed by the login page.

### DefaultOAuthUISettings
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/DefaultOAuthUISettings.cs:7` · Level 1 · class (internal sealed)

- **What it is**: the no-op [`IOAuthUISettings`](#ioauthuisettings) implementation that disables all
  OAuth providers, a single-line type: `internal sealed class DefaultOAuthUISettings :
  IOAuthUISettings;` (`DefaultOAuthUISettings.cs:7`).
- **Depends on**: [`IOAuthUISettings`](#ioauthuisettings) (Level 0).
- **Concept, the Null Object / default-registration pattern.** `[Rubric §2, Design Patterns]`
  (assesses using a benign default rather than a nullable dependency). Because
  [`IOAuthUISettings`](#ioauthuisettings) supplies default members returning `false`, this class needs
  no body: it inherits "all providers off". Registering it guarantees the interface is always
  resolvable, so the login page can inject it unconditionally; a downstream app overrides the
  registration with [`ConfigurationOAuthUISettings`](#configurationoauthuisettings) to enable
  providers.
- **Walkthrough**: no members. All behavior comes from the interface's default members.
- **Where it's used**: the framework's fallback registration; superseded by
  [`ConfigurationOAuthUISettings`](#configurationoauthuisettings) when an app configures OAuth.

### DirectApiTokenRefresher
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/DirectApiTokenRefresher.cs:11` · Level 1 · class (sealed)

- **What it is**: the MAUI [`ITokenRefresher`](#itokenrefresher): it exchanges the refresh token held
  in OS SecureStorage directly against the API's `auth/refresh` endpoint and persists the rotated pair
  back to storage.
- **Depends on**: [`ITokenRefresher`](#itokenrefresher) (Level 0),
  [`ITokenStorageService`](#itokenstorageservice) (Level 0),
  [`RefreshTokenRequest`](group-08-auth.md#refreshtokenrequest),
  [`AuthenticationResponse`](group-08-auth.md#authenticationresponse); BCL/NuGet
  (`IHttpClientFactory`, `System.Net.Http.Json`).
- **Concept, per-host refresh strategy.** `[Rubric §11, Security]` (assesses matching the refresh
  mechanism to the platform's threat surface). The doc comment (`DirectApiTokenRefresher.cs:6-9`)
  justifies handling the refresh token directly: MAUI has no browser DOM and therefore no XSS surface,
  so exchanging a SecureStorage-held token straight against the cross-origin API is acceptable. The
  browser hosts use [`SameOriginProxyTokenRefresher`](#sameoriginproxytokenrefresher) instead.
- **Walkthrough**: `AcquireAccessTokenAsync` (`DirectApiTokenRefresher.cs:17`): reads both tokens
  (`DirectApiTokenRefresher.cs:19-20`); returns `null` if either is missing
  (`DirectApiTokenRefresher.cs:22-25`); POSTs a
  [`RefreshTokenRequest`](group-08-auth.md#refreshtokenrequest) to the relative `auth/refresh`
  (`DirectApiTokenRefresher.cs:27-29`); on a non-success status returns `null`
  (`DirectApiTokenRefresher.cs:31-34`); otherwise reads
  [`AuthenticationResponse`](group-08-auth.md#authenticationresponse), returns `null` on a blank access
  token, then persists the rotated pair via `SetTokensAsync` and returns the new access token
  (`DirectApiTokenRefresher.cs:36-43`).
- **Why it's built this way**: constructor-injecting the storage service and HTTP factory keeps the
  refresher stateless; the null-on-failure convention matches [`ITokenRefresher`](#itokenrefresher) so
  a caller treats null as "re-login".
- **Where it's used**: registered as the [`ITokenRefresher`](#itokenrefresher) on the MAUI host;
  reached through [`AuthUIService.TryRefreshTokenAsync`](#authuiservice).

### JsFetchSessionCookieSync
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JsFetchSessionCookieSync.cs:11` · Level 1 · class (sealed)

- **What it is**: the [`ISessionCookieSync`](#isessioncookiesync) implementation that syncs the
  HttpOnly auth cookie by firing a browser `fetch` through JS interop.
- **Depends on**: [`ISessionCookieSync`](#isessioncookiesync) (Level 0); NuGet
  (`Microsoft.JSInterop.IJSRuntime`).
- **Concept, browser-issued cookie writes.** `[Rubric §26, Front-End Security]` and `[Rubric §18, UI
  Architecture]` (assess crossing the Server/WASM prerender boundary safely). The doc comment
  (`JsFetchSessionCookieSync.cs:5-9`) explains why the fetch is issued from the browser and not the
  server: only then does the resulting `Set-Cookie` land in the user's cookie jar, and it works in
  both Blazor Server interactive mode and WebAssembly. When JS interop is unavailable (SSR prerender,
  a render-mode transition), the calls fall silent rather than throw.
- **Walkthrough**: `SyncAsync` (`JsFetchSessionCookieSync.cs:16`) invokes `mmcaAuthCookie.set` with
  both tokens; `ClearAsync` (`JsFetchSessionCookieSync.cs:28`) invokes `mmcaAuthCookie.clear`. Both
  wrap the interop call and swallow the interop-unavailable exception family via the shared
  `IsInteropUnavailable` predicate (`JsFetchSessionCookieSync.cs:13-14`), which matches
  `InvalidOperationException`, `JSDisconnectedException`, `JSException`, and
  `OperationCanceledException`. The catch comments note the cookie will be re-synced on the next write.
- **Why it's built this way**: keeping the JS mechanics behind the interface lets MAUI drop in a
  no-op; swallowing interop failures during prerender keeps a login flow from crashing when the circuit
  is not yet interactive.
- **Where it's used**: registered on the web heads as [`ISessionCookieSync`](#isessioncookiesync);
  driven by [`WasmTokenStorageService`](#wasmtokenstorageservice) at login and logout.

### JwtAuthenticationStateProvider
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JwtAuthenticationStateProvider.cs:12` · Level 1 · class (sealed)

- **What it is**: a custom Blazor `AuthenticationStateProvider` that derives auth state from the JWT
  held by [`ITokenStorageService`](#itokenstorageservice), reading claims client-side for
  responsiveness while the API validates fully on every request.
- **Depends on**: [`ITokenStorageService`](#itokenstorageservice) (Level 0); NuGet/BCL
  (`Microsoft.AspNetCore.Components.Authorization.AuthenticationStateProvider`, `System.Security.Claims`,
  `JwtSecurityTokenHandler`).
- **Concept introduced, client-side auth-state projection.** `[Rubric §18, UI Architecture]` (assesses
  how Blazor's `AuthorizeView`/`CascadingAuthenticationState` learns who is signed in), `[Rubric §11,
  Security]` (assesses that client-side claims drive only rendering, not trust), and `[Rubric §19,
  State Management]` (assesses pushing state changes without a page reload). The doc comment
  (`JwtAuthenticationStateProvider.cs:7-11`) states the split: claims are extracted client-side without
  server validation to keep the UI responsive; the WebAPI does the real validation.
- **Walkthrough**
  - A shared `AnonymousState` (`JwtAuthenticationStateProvider.cs:14-15`) is an empty
    `ClaimsPrincipal`, the fallback for every unauthenticated path.
  - `GetAuthenticationStateAsync` (`JwtAuthenticationStateProvider.cs:22`): reads the token; returns
    anonymous on blank (`:27-30`), on an unreadable token (`CanReadToken`, `:33-36`), or on an expired
    token (`ValidTo < DateTime.UtcNow`, `:39-42`). Otherwise it builds a `ClaimsIdentity` with the
    `"jwt"` authentication type (`:45`), which is what makes `IsAuthenticated == true`, and returns the
    principal. A bare `catch` (`:49-52`) falls back to anonymous on any failure (corrupt data, interop
    unavailable).
  - `NotifyUserAuthentication(string token)` (`:59`) builds a principal from the token and calls
    `NotifyAuthenticationStateChanged` so `CascadingAuthenticationState` consumers update immediately
    after login/refresh, with no page reload; `NotifyUserLogout()` (`:71`) pushes `AnonymousState`.
- **Why it's built this way**: deriving state from the stored token (rather than a server round-trip)
  keeps the UI instant, and the explicit notify methods let [`AuthUIService`](#authuiservice) drive
  state transitions on login, refresh, and logout. The `"jwt"` auth-type string is load-bearing: an
  identity built with no auth type reports `IsAuthenticated == false`.
- **Where it's used**: registered as the Blazor `AuthenticationStateProvider`;
  [`AuthUIService`](#authuiservice) pattern-matches it to call
  `NotifyUserAuthentication`/`NotifyUserLogout`.

### SameOriginProxyTokenRefresher
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/SameOriginProxyTokenRefresher.cs:11` · Level 1 · class (sealed)

- **What it is**: the browser (Blazor Server + WebAssembly) [`ITokenRefresher`](#itokenrefresher): it
  calls the same-origin `POST /auth/session/token` endpoint via JS `fetch` so the browser sends its
  HttpOnly cookies and the UI host refreshes server-side, returning only the access token.
- **Depends on**: [`ITokenRefresher`](#itokenrefresher) (Level 0); NuGet
  (`Microsoft.JSInterop.IJSRuntime`).
- **Concept, refresh-token isolation from JS.** `[Rubric §11, Security]` and `[Rubric §26, Front-End
  Security]` (assess that the refresh token never enters JS-reachable memory). The doc comment
  (`SameOriginProxyTokenRefresher.cs:5-10`) explains the mechanism: the JS fetch uses
  `credentials:'same-origin'`, which sends the HttpOnly auth cookie to the same-origin UI host; the
  host validates-or-refreshes server-side and hands back only the access token. This is the browser
  half of the dual-fetch model (ADR-004).
- **Walkthrough**: `AcquireAccessTokenAsync` (`SameOriginProxyTokenRefresher.cs:13`) invokes
  `mmcaAuthSession.getToken` (`:17`), returning `null` for a blank result (`:18`). It catches the JS
  interop exception family (`InvalidOperationException`, `JSDisconnectedException`, `JSException`,
  `OperationCanceledException`, `:20-25`) and returns `null`, the comment noting the server-side cookie
  path covers SSR-prerender and disconnected-circuit phases.
- **Why it's built this way**: routing the refresh through a same-origin JS fetch keeps the
  high-value refresh token in the HttpOnly cookie and out of JS memory, exactly the isolation §26
  rewards.
- **Where it's used**: registered as the [`ITokenRefresher`](#itokenrefresher) on the web server and
  WASM hosts; consumed by [`WasmTokenStorageService`](#wasmtokenstorageservice) and
  [`AuthUIService`](#authuiservice).

### WasmTokenStorageService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/WasmTokenStorageService.cs:11` · Level 1 · class (sealed)

- **What it is**: the WebAssembly [`ITokenStorageService`](#itokenstorageservice): it holds the access
  token **in memory only** (never `localStorage`) and hydrates or refreshes it on demand from the
  HttpOnly cookies through an [`ITokenRefresher`](#itokenrefresher).
- **Depends on**: [`ITokenStorageService`](#itokenstorageservice) (Level 0),
  [`ISessionCookieSync`](#isessioncookiesync) (Level 0), [`ITokenRefresher`](#itokenrefresher)
  (Level 0), [`JwtTokenInfo`](#jwttokeninfo) (Level 0).
- **Concept introduced, in-memory-plus-cookie token custody with single-flight refresh.** `[Rubric
  §26, Front-End Security]` (assesses keeping the access token out of persistent, JS-readable storage),
  `[Rubric §11, Security]` (assesses that the refresh token is never client-readable), `[Rubric §12,
  Performance & Scalability]`, and `[Rubric §19, State Management]` (assess deduplicating concurrent
  token acquisition). The doc comment (`WasmTokenStorageService.cs:3-10`) states the model: cookie-only,
  the access token lives in memory and is rehydrated from the HttpOnly cookies via the same-origin
  `/auth/session/token` endpoint; the refresh token is never readable by JS; and the class is hoisted
  from the app WASM clients because it carries no app-specific state (its Blazor Server sibling is
  `ServerTokenStorageService`).
- **Walkthrough**
  - Fields: a static `ExpirySkew` of 30 seconds (`WasmTokenStorageService.cs:15`), the in-memory
    `_accessToken` (`:17`), and an `_hydrateInFlight` task handle (`:18`) that backs the single-flight
    guard.
  - `GetAccessTokenAsync` (`:20`): returns the cached token immediately if
    `JwtTokenInfo.IsFresh(_accessToken, ExpirySkew)` (`:22-25`); otherwise it starts (or joins) one
    `HydrateAsync` via `_hydrateInFlight ??= HydrateAsync()` so concurrent callers (the delegating
    handler, auth-state provider, SignalR) share a single acquisition (`:27-36`), clearing the handle
    in a `finally`.
  - `GetRefreshTokenAsync` (`:40`): always returns `null`, the refresh token lives only in the HttpOnly
    cookie.
  - `SetTokensAsync` (`:42`): stores the access token in memory and seeds the HttpOnly cookies via
    [`ISessionCookieSync.SyncAsync`](#isessioncookiesync); the comment notes the refresh token transits
    JS only for that one same-origin POST and is never persisted (`:44-47`).
  - `ClearTokensAsync` (`:50`): nulls the in-memory token and clears the cookies.
  - `HydrateAsync` (`:56`): calls [`ITokenRefresher.AcquireAccessTokenAsync`](#itokenrefresher), caches
    the result in `_accessToken`, and returns it.
- **Why it's built this way**: holding the access token in process memory (not `localStorage`) shrinks
  the XSS blast radius, and the single-flight `_hydrateInFlight` guard prevents a thundering herd of
  parallel refreshes when several components ask for a token at once (ADR-004).
- **Where it's used**: registered as the [`ITokenStorageService`](#itokenstorageservice) on the WASM
  host; read by [`AuthDelegatingHandler`](#authdelegatinghandler),
  [`JwtAuthenticationStateProvider`](#jwtauthenticationstateprovider), and
  [`AuthUIService`](#authuiservice).
- **Caveats / not-in-source**: the `finally` clears `_hydrateInFlight` after the first awaiter
  completes, so single-flight coalesces callers that overlap the acquisition window, not every call
  across the token's lifetime; a caller arriving after the window starts a fresh hydration.

### IAuthUIService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/IAuthUIService.cs:9` · Level 5 · interface

- **What it is**: the client-side authentication contract that ties together token storage, HTTP calls
  to the `auth/*` WebAPI endpoints, and Blazor auth-state notifications.
- **Depends on**: [`AuthenticationResponse`](group-08-auth.md#authenticationresponse),
  [`LoginRequest`](group-08-auth.md#loginrequest),
  [`RegisterRequest`](group-08-auth.md#registerrequest) (via `MMCA.Common.Shared.Auth`).
- **Concept, the UI-layer auth boundary.** `[Rubric §3, Clean Architecture]` (assesses that the UI
  auth surface depends only on Shared DTOs, never Application/Domain) and `[Rubric §11, Security]`
  (assesses token handling behind a service abstraction, not in page components). This interface lives
  in `MMCA.Common.UI` and references only `MMCA.Common.Shared.Auth` request/response records, so page
  components talk to it without pulling in any backend layer.
- **Walkthrough**: a `LastError` string property (`IAuthUIService.cs:12`, the last failure message, or
  null), plus `LoginAsync` (`:15`), `RegisterAsync` (`:18`), `ExchangeOAuthCodeAsync` (`:25`, which
  swaps a single-use OAuth completion code for the token pair via `auth/oauth/exchange`, keeping tokens
  out of the address bar), `LogoutAsync` (`:28`), `TryRefreshTokenAsync` (`:31`), and
  `ChangePasswordAsync` (`:34`). The `LoginAsync`/`RegisterAsync`/`ExchangeOAuthCodeAsync` methods
  return a nullable [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) (null on
  failure).
- **Why it's built this way**: exposing auth as a UI-layer contract keeps components free of HTTP and
  token mechanics and preserves the layered dependency rule (UI depends on Shared only).
- **Where it's used**: implemented by [`AuthUIService`](#authuiservice); injected into the login,
  register, profile, and session-refresh Blazor components.

### AuthUIService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:15` · Level 6 · class (sealed)

- **What it is**: the concrete [`IAuthUIService`](#iauthuiservice): it drives the full client auth
  lifecycle (login, register, OAuth exchange, logout, refresh, password change) by calling the
  `auth/*` endpoints, persisting tokens via [`ITokenStorageService`](#itokenstorageservice), and
  pushing state through [`JwtAuthenticationStateProvider`](#jwtauthenticationstateprovider).
- **Depends on**: [`IAuthUIService`](#iauthuiservice) (Level 5),
  [`ITokenStorageService`](#itokenstorageservice) (Level 0),
  [`ITokenRefresher`](#itokenrefresher) (Level 0),
  [`JwtAuthenticationStateProvider`](#jwtauthenticationstateprovider) (Level 1),
  [`IPushRegistrationService`](group-26-device-capability-layer.md#ipushregistrationservice),
  [`AuthenticationResponse`](group-08-auth.md#authenticationresponse),
  [`LoginRequest`](group-08-auth.md#loginrequest),
  [`RegisterRequest`](group-08-auth.md#registerrequest),
  [`OAuthCodeExchangeRequest`](group-08-auth.md#oauthcodeexchangerequest),
  [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest); NuGet/BCL
  (`IHttpClientFactory`, `System.Net.Http.Json`, `ProblemDetails`, Blazor
  `AuthenticationStateProvider`).
- **Concept, centralized UI auth orchestration.** `[Rubric §11, Security]` and `[Rubric §26, Front-End
  Security]` (assess that token storage/refresh flow through service abstractions, never raw storage in
  page code), `[Rubric §19, State Management]` (assesses coordinating auth-state notifications), and
  `[Rubric §29, Resilience & Business Continuity]` (assesses best-effort side effects that never block
  the primary flow). The doc comment (`AuthUIService.cs:9-13`) notes it also guards
  `InvalidOperationException` around JS interop during SSR prerender.
- **Walkthrough**
  - `LoginAsync` (`AuthUIService.cs:26`) and `RegisterAsync` (`:72`) follow one shape: POST the request
    to `auth/login`/`auth/register`; on a non-success status, read a `ProblemDetails` body into
    `LastError` (falling back to a generic message) and return `null` (`:32-46`, `:78-92`); on success,
    read [`AuthenticationResponse`](group-08-auth.md#authenticationresponse), bail on a blank access
    token, persist the pair via `SetTokensAsync` inside a `try/catch (InvalidOperationException)` for
    prerender, then call `NotifyUserAuthentication` when the provider is a
    [`JwtAuthenticationStateProvider`](#jwtauthenticationstateprovider) (`:48-69`, `:94-114`).
  - `ExchangeOAuthCodeAsync` (`:117`): rejects a blank code up front (`:121-125`), then POSTs an
    [`OAuthCodeExchangeRequest`](group-08-auth.md#oauthcodeexchangerequest) to `auth/oauth/exchange` and
    follows the same success/failure handling, keeping tokens out of the URL.
  - `LogoutAsync` (`:172`): first best-effort `pushRegistration.UnregisterAsync()` while the token is
    still valid (native-push cleanup, ADR-044), wrapped in a `CA1031`-suppressed catch so a failure
    never blocks sign-out (`:177-186`); then a best-effort authenticated `auth/revoke` POST
    (`:188-205`); then `ClearTokensAsync` and `NotifyUserLogout` (`:207-219`).
  - `TryRefreshTokenAsync` (`:222`): delegates to
    [`ITokenRefresher.AcquireAccessTokenAsync`](#itokenrefresher); a null result means the session
    cannot be refreshed, so it clears tokens, notifies logout, and returns `false`; a token notifies
    authentication and returns `true` (`:227-253`).
  - `ChangePasswordAsync` (`:256`): manually attaches the Bearer token from circuit-scoped storage
    (the comment at `:263` notes `AuthDelegatingHandler` has Blazor Server scope issues), then PUTs a
    [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest) to `auth/password` and returns
    the success flag.
- **Why it's built this way**: routing every auth operation through one service keeps components free
  of HTTP and token mechanics; the pervasive `InvalidOperationException` guards keep an operation from
  crashing when JS interop is unavailable during prerender; and the best-effort push/revoke steps
  ensure sign-out always completes locally even when a remote call fails (ADR-044).
- **Where it's used**: registered as the [`IAuthUIService`](#iauthuiservice) implementation on the web
  and MAUI heads; injected into login, register, profile, and session-refresh components. The
  `NoOpAuthUIService` in the component gallery is the backend-less stand-in for gallery rendering.
- **Caveats / not-in-source**: several catch blocks around `ProblemDetails` parsing and `auth/revoke`
  swallow all exceptions deliberately (a failed error-detail read or revoke must not derail the flow);
  the concrete `AuthenticationStateProvider` is injected by its base type and pattern-matched to
  [`JwtAuthenticationStateProvider`](#jwtauthenticationstateprovider) at each notification site, so a
  different provider registration would silently skip the notify calls.

### BackNavigationResult

> MMCA.Common.UI · `MMCA.Common.UI.Services.Navigation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/MauiBackNavigationBridge.cs:19` · Level 0 · record (sealed)

- **What it is**: The outcome of a hardware-back or WebView-back attempt routed through [`MauiBackNavigationBridge`](#mauibacknavigationbridge): whether the WebView consumed the gesture and whether the WebView is sitting at the root of its history stack.
- **Depends on**: Nothing first-party; it is a two-field positional record. Produced and consumed by [`MauiBackNavigationBridge`](#mauibacknavigationbridge).
- **Concept introduced**: This is the value returned across the JS interop boundary. `nav-interop.js`'s `tryGoBack()` returns a shape that deserializes into `BackNavigationResult`, so the record is also the wire contract for that single interop call.
- **Walkthrough**: `public sealed record BackNavigationResult(bool Handled, bool AtRoot)` (`MauiBackNavigationBridge.cs:19`). `Handled` is `true` when the WebView's history stack had a previous entry and `history.back()` fired; `AtRoot` is `true` when there was no previous entry. The two flags together let a MAUI `ContentPage` decide whether to exit the app (Android convention: exit when back is pressed at the root).
- **Why it's built this way**: A `sealed record` gives structural equality and a positional deconstruction for free, and it is the smallest thing that can carry the two facts the native host needs. Modeling the result as data (rather than throwing or mutating shared state) keeps the interop call pure and trivially testable.
- **Where it's used**: Returned by [`MauiBackNavigationBridge.HandleBackPressedAsync`](#mauibacknavigationbridge); consumed by MAUI host `ContentPage.OnBackButtonPressed` handlers.

---

### BrandColors

> MMCA.Common.UI · `MMCA.Common.UI.Theme` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/BrandColors.cs:10` · Level 0 · class (static)

- **What it is**: The single C# source of truth for the brand palette: three hex constants that [`MMCATheme`](#mmcatheme) reads for both its light and dark MudBlazor variants.
- **Depends on**: Nothing first-party. It is mirrored by the CSS custom properties `--mmca-primary` and `--mmca-primary-dark` in `wwwroot/app.css`.
- **Concept introduced: a fitness-tested duplication.** [Rubric §20, Design System & Theming] assesses whether visual tokens are centralized rather than scattered as literals; here the palette lives in exactly one C# class. [Rubric §34, Architecture Governance & Documentation] assesses whether necessary duplication is *monitored*: because C# cannot read CSS at build time, the same colors must exist in both `BrandColors` and `app.css`, and `BrandColorTokenTests` (in `MMCA.Common.UI.Tests`) asserts the two stay in sync so the copy cannot silently drift (`BrandColors.cs:6-8`).
- **Walkthrough**: Three `public const string` fields: `Primary = "#1565C0"` (CSS `--mmca-primary`, `BrandColors.cs:13`), `PrimaryDark = "#0D47A1"` (CSS `--mmca-primary-dark`, line 16), and `PrimaryLight = "#42A5F5"` (accents and dark-mode contrast, line 19).
- **Why it's built this way**: `const` (not `static readonly`) means the values can appear in contexts that require compile-time constants; the governance is the fitness test, not the language keyword. Keeping the palette in one class means a rebrand touches one file plus the mirrored CSS.
- **Where it's used**: [`MMCATheme`](#mmcatheme) light and dark palettes; `BrandColorTokenTests`; any component that references a brand color programmatically.

---

### NotificationState

> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationState.cs:8` · Level 0 · class (sealed)

- **What it is**: The scoped shared state for the notification unread count, and the coordination point between the notification bell, real-time push, and background polling.
- **Depends on**: Nothing first-party; it holds an `int` count and two `EventHandler` events. Consumed by [`NotificationBell`](#notificationbell).
- **Concept introduced: a scoped state store with an active-poller guard.** [Rubric §19, State Management] assesses how shared UI state is owned and observed without threading it through the component tree. `NotificationState` is registered scoped, so each Blazor circuit gets its own instance; components subscribe to its events instead of receiving cascading parameters. The subtle part is duplicate suppression: [`NotificationBell`](#notificationbell) can render in more than one DOM location (desktop header and mobile drawer), and every instance would otherwise start its own poll loop. `TryRegisterPoller` uses `Interlocked.Increment` so only the first caller returns `true` (`NotificationState.cs:51`); the rest skip polling.
- **Walkthrough**: Fields and members in teaching order: `_pollerCount` (the `Interlocked` reference count, line 10); `UnreadCount` with a private setter (line 13); `OnChange` and `OnRefreshRequested` events (`EventHandler`, lines 16 and 22). `SetUnreadCount(int)` sets an absolute value and raises `OnChange` only when the value actually changes (lines 25-34); `IncrementUnreadCount()` bumps by one for an optimistic real-time update (lines 37-41); `RequestRefresh()` raises `OnRefreshRequested` so a subscriber refetches the authoritative count (line 44); `TryRegisterPoller()` / `UnregisterPoller()` bracket the active-poller lifetime (lines 51 and 54).
- **Why it's built this way**: Scoped because the count is per-user-session; event-based because subscribers live at arbitrary render-tree depth. The private setter keeps mutation funneled through the three named methods so every change goes through the change-notification path.
- **Where it's used**: Injected into [`NotificationBell`](#notificationbell); driven by [`NotificationHubService`](#notificationhubservice) push events (which call `IncrementUnreadCount` / `RequestRefresh`).

---

### ReturnUrlProtector

> MMCA.Common.UI · `MMCA.Common.UI.Services.Navigation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/ReturnUrlProtector.cs:9` · Level 0 · class (static)

- **What it is**: A pure sanitizer for `returnUrl` query parameters: it accepts only same-origin relative paths and replaces anything else with a safe fallback, closing the open-redirect hole in every post-login redirect.
- **Depends on**: `System.Uri` (BCL) for the final relative-URI parse guard.
- **Concept introduced: open-redirect defense.** [Rubric §26, Front-End Security] assesses whether user-controlled navigation targets are validated before use. An open redirect lets an attacker craft `/login?returnUrl=https://evil.com`, so the victim lands on an attacker site after authenticating (a classic phishing amplifier). `Sanitize` rejects every off-host form rather than trying to allow-list attacks.
- **Walkthrough**: `Sanitize(string? candidate, string fallback = "/")` runs a sequence of cheap, regex-free guards (regex here would invite ReDoS): empty/null returns the fallback (`ReturnUrlProtector.cs:20`); the path must start with a single `/` (line 27); it must not start with `//` or `/\`, which browsers treat as the start of an authority and would send the user off-host (line 34); no backslash anywhere, since some browsers normalize `\` to `/` (line 41); no control characters, which are header-injection and response-splitting vectors (line 48); and finally it must parse as a well-formed relative URI (line 54). Any failure returns `fallback`.
- **Why it's built this way**: A static pure function with the candidate as its only input is trivially unit-testable across every attack vector, and the ordered inline checks read as a documented threat model. It is called centrally so no page hand-rolls its own redirect validation.
- **Where it's used**: The login page reads `returnUrl` from the query string and sanitizes before redirecting; [`NavigationHistoryService.GoBackAsync`](#navigationhistoryservice) also runs the fallback path through it (`NavigationHistoryService.cs:82`).

---

### MauiBackNavigationBridge

> MMCA.Common.UI · `MMCA.Common.UI.Services.Navigation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/MauiBackNavigationBridge.cs:28` · Level 1 · class (static)

- **What it is**: A static bridge that routes a native MAUI back gesture (Android hardware back, iOS swipe) into the BlazorWebView's internal history stack, so pressing back inside a hybrid app behaves like a web back rather than tearing down the page.
- **Depends on**: [`BackNavigationResult`](#backnavigationresult) (its return type); `Microsoft.JSInterop.IJSRuntime` and the `nav-interop.js` module (externals).
- **Concept introduced: MAUI-to-WebView interop.** [Rubric §22, Responsive & Cross-Browser] extends to hybrid hosts here: the same Blazor UI runs inside a MAUI WebView, and native chrome events must be reconciled with web navigation. The call is meant to run from `ContentPage.OnBackButtonPressed` via `BlazorWebView.TryDispatchAsync` so it executes on the renderer thread with access to the WebView's `IJSRuntime` (`MauiBackNavigationBridge.cs:22-27`).
- **Walkthrough**: `HandleBackPressedAsync(IJSRuntime js)` (line 38) null-checks the runtime, dynamically imports `./_content/MMCA.Common.UI/nav-interop.js` (`ModulePath`, line 30), and invokes its `tryGoBack()` helper, deserializing the result into a [`BackNavigationResult`](#backnavigationresult) (lines 44-46). Every interop failure mode is caught explicitly (`InvalidOperationException` when Blazor is not yet hydrated, `JSDisconnectedException`, `JSException`) and collapses to `new BackNavigationResult(Handled: false, AtRoot: true)` (lines 48-60), so a not-yet-ready WebView reports "at root, not handled" and the host falls back to its default back behavior.
- **Why it's built this way**: A static helper with no state fits a one-shot interop call; returning a data record instead of throwing keeps the native handler branch-free. Swallowing the three JS exception types into a safe default means an unhydrated or disconnected circuit never crashes the native back button.
- **Where it's used**: MAUI host projects call it from their page back-button handler; the returned [`BackNavigationResult`](#backnavigationresult) tells the host whether to exit the app.
- **Caveats / not-in-source**: The `nav-interop.js` `tryGoBack()` implementation and the MAUI host wiring live outside this unit; only the C# side of the bridge is visible here.

---

### MobileInfiniteScrollList<TItem>

> MMCA.Common.UI · `MMCA.Common.UI.Components` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/MobileInfiniteScrollList.razor.cs:15` · Level 1 · class (generic component)

- **What it is**: The code-behind for the mobile card list that fetches pages on demand as the user scrolls, using an IntersectionObserver sentinel, and caps how many items ever reach the DOM.
- **Depends on**: `IJSRuntime`, MudBlazor's `ISnackbar`, and `IStringLocalizer<SharedResource>` (all `[Inject]`ed, lines 17-19); the `infinite-scroll.js` interop module; `IAsyncDisposable` (BCL). The `FetchPage` delegate typically wraps a first-party UI service such as [`EntityServiceBase<TEntityDTO, TIdentifierType>`](#entityservicebasetentitydto-tidentifiertype).
- **Concept introduced: sentinel-driven infinite scroll with a rendered-item cap.** [Rubric §23, Front-End Performance] assesses whether the UI bounds work and memory under large result sets. Rather than render everything, the component observes a single DOM sentinel; when it scrolls into view, JS calls back into .NET to fetch the next page. Crucially it stops fetching once `_items.Count` reaches `MaxRenderedItems` (default `500`, line 41), so DOM growth and memory stay bounded even for huge lists (`MobileInfiniteScrollList.razor.cs:145-147`). [Rubric §24, Forms/Validation/UX Safety] also applies: a failed load surfaces a *localized, sanitized* snackbar (`L["Grid.Snackbar.LoadFailed"]`, line 162) instead of raw exception text (ADR-027).
- **Walkthrough**: Parameters: the required `CardTemplate` render fragment and `FetchPage` delegate (`Func<int,int,CancellationToken,Task<(IReadOnlyList<TItem>,int)>>`, lines 21-27), `PageSize` (default 10, line 28), `MaxRenderedItems` (line 41). State fields track pagination and lifecycle (`_items`, `_currentPage`, `_hasMore`, `_loadError`, the `_cts` cancellation source, and the `_observerId`, lines 43-56). `OnInitializedAsync` loads page one (line 58); `OnAfterRenderAsync` attaches the observer once items exist and there is more to load (lines 64-70); `AttachObserverAsync` imports `infinite-scroll.js` and calls `observe` with a `DotNetObjectReference` (lines 72-86). The JS-invokable `OnSentinelVisible` (line 105) guards against re-entrancy (`_isLoadingMore`, `_hasMore`, `_disposed`) and dispatches `LoadNextPageAsync` on the renderer via `InvokeAsync`. `LoadNextPageAsync` cancels any superseded fetch before starting a new `CancellationTokenSource` (lines 130-136), decrements the page on cancel/error, and recomputes `_hasMore` against both the total and the cap (line 147). `ResetAsync` clears state and reloads from page one when filters change (lines 181-198); `DisposeAsync` cancels, detaches the observer, and disposes the JS module and .NET reference (lines 200-232).
- **Why it's built this way**: The IntersectionObserver lives in JS because that is where the browser exposes it; the .NET side stays declarative. Per-fetch cancellation prevents a slow earlier page from overwriting a newer one, and the rendered-item cap is a deliberate performance ceiling rather than truly unbounded scroll. Full `IAsyncDisposable` cleanup avoids leaking observers and interop references across navigations.
- **Where it's used**: Mobile list views in consuming apps that supply a `CardTemplate` and a paged `FetchPage`; the desktop equivalent is the grid-based list page base.
- **Caveats / not-in-source**: The `infinite-scroll.js` `observe`/`unobserve` implementation is outside this unit.

---

### NavigationHistoryService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Navigation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/NavigationHistoryService.cs:12` · Level 1 · class (sealed)

- **What it is**: A per-circuit service that bridges Blazor's `NavigationManager` with the browser history API so a "Back" button can perform a real `history.back()` when an in-history entry exists, and fall back to an explicit route otherwise.
- **Depends on**: [`ReturnUrlProtector`](#returnurlprotector) (sanitizes the fallback); `NavigationManager` and `IJSRuntime` (constructor-injected, line 12); the `nav-interop.js` module.
- **Concept introduced: honoring real browser history.** [Rubric §25, Navigation & Information Architecture] assesses predictable, source-aware navigation. A hard-coded "back to list" link ignores where the user actually came from; this service instead asks the browser whether a previous entry exists and navigates to it, only falling back to a route when it does not.
- **Walkthrough**: `CanGoBackAsync()` imports the module and returns `historyLength() > 1` (lines 23-48), swallowing interop failures (SSR prerender, disconnect) as `false`. `GoBackAsync(string fallback = "/")` calls `historyBack` when history is available (lines 55-80) and, on any interop failure or when history is empty, falls through to `navigation.NavigateTo(ReturnUrlProtector.Sanitize(fallback))` (line 82) so the fallback route itself is open-redirect-safe. `GetModuleAsync` memoizes the imported `IJSObjectReference` in `_module` (lines 85-105).
- **Why it's built this way**: Sealed and scoped per circuit because the cached JS module reference and history semantics are per-connection. Routing the fallback through [`ReturnUrlProtector`](#returnurlprotector) means even the "safe" branch cannot be turned into a redirect vector. The layered exception handling guarantees `GoBackAsync` always ends in a navigation.
- **Where it's used**: Injected into detail-page "Back" buttons; the same history primitives back the MAUI hardware-back path.

---

### BlazorCspPolicyProvider

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Security` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:21` · Level 2 · class (internal, sealed)

- **What it is**: The Content-Security-Policy provider for a Blazor Web host: it builds the CSP once at startup, pinning `connect-src` to `'self'` plus the configured API/Gateway origin, and hands it to the shared security-headers middleware.
- **Depends on**: [`ICspPolicyProvider`](group-16-aspire-orchestration.md#icsppolicyprovider) and [`CspPolicy`](group-16-aspire-orchestration.md#csppolicy) (the abstraction and value it implements/returns), [`SecurityHeadersMiddleware`](group-16-aspire-orchestration.md#securityheadersmiddleware) (its consumer), and `ApiSettings` (the endpoint source, `BlazorCspPolicyProvider.cs:6`); `IWebHostEnvironment` and `System.Uri` (BCL).
- **Concept introduced: a computed, fail-open CSP.** [Rubric §26, Front-End Security] assesses whether the browser is told which origins may execute scripts and open connections. This provider locks `script-src` to `'self' 'wasm-unsafe-eval'` and `connect-src` to `'self'` plus the exact API origin and its WebSocket origin, so an injected script cannot exfiltrate to an arbitrary host. The deliberate design choice is fail-open on the *policy value*, not on enforcement: if the endpoint cannot be resolved, the CSP degrades to a permissive `Report-Only` policy so a misconfiguration can never hard-break production (`BlazorCspPolicyProvider.cs:14-17`).
- **Walkthrough**: The constructor computes the policy once (registered as a singleton) via `BuildCsp` (lines 26-31); `GetPolicy(HttpContext)` just returns the cached [`CspPolicy`](group-16-aspire-orchestration.md#csppolicy) (line 34). `BuildCsp` reads `WasmApiEndpoint ?? ApiEndpoint` (line 40) and, if it is missing or not an absolute http(s) URI, returns a `Report-Only`, non-enforced policy (`Enforce: false`, line 49), the scheme check matters on Linux, where a rooted path parses as a `file://` URI. When the origin is valid it derives `scheme://host:port` plus the matching `ws`/`wss` origin for the SignalR notification hub (lines 53-55). In Development only it additionally allows `http://localhost:*` / `ws://localhost:*` for Visual Studio Browser Link and Hot Reload (lines 61-64), and `BuildPolicy` adds `'unsafe-inline'` to `script-src` for the injected Hot Reload bootstrap (line 75), so the hardened production policy is never loosened. `img-src` allows any https source because profile pictures come from arbitrary hosts, while the exfiltration-relevant `script-src`/`connect-src` stay locked (lines 69-82).
- **Why it's built this way**: Computing once and caching keeps per-request cost at zero. `internal` because it is registered through `AddCommonBlazorCsp()` and never touched directly by consumers. Fail-open policy value plus fail-closed intent (Report-Only when unsure) is the pragmatic middle: security teams still get violation reports without risking an outage from a bad connection string.
- **Where it's used**: Registered by `AddCommonBlazorCsp()` before `AddCommonSecurityHeaders`; the policy it returns is emitted by [`SecurityHeadersMiddleware`](group-16-aspire-orchestration.md#securityheadersmiddleware).

---

### ChannelSubscription

> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:329` · Level 2 · class (private, sealed, nested)

- **What it is**: The disposable handle returned when a caller subscribes to a live channel on [`NotificationHubService`](#notificationhubservice); disposing it removes the handler from the channel's subscriber list.
- **Depends on**: Its owning [`NotificationHubService`](#notificationhubservice) (back-reference), a channel key string, and a `Func<string, string, Task>` handler; implements `IDisposable`.
- **Concept introduced: subscription-as-token.** This is the classic "return an `IDisposable` to unsubscribe" pattern. Instead of exposing an `Unsubscribe(handler)` method (which forces callers to hold and match the exact delegate), `OnChannelEvent` returns a `ChannelSubscription`; when the component disposes it, the subscription calls back into the owner to unregister itself. It captures the owner, the `ChannelKey`, and the `Handler` (`NotificationHubService.cs:331-333`).
- **Walkthrough**: A primary-constructor nested class (line 329) exposing `ChannelKey` and `Handler` as read-only properties; `Dispose()` simply calls `owner.RemoveSubscription(this)` (line 335), which locks the shared `_channelSync` and removes the entry (and prunes the channel list when it empties, lines 290-303).
- **Why it's built this way**: Nesting it privately inside [`NotificationHubService`](#notificationhubservice) keeps the subscription bookkeeping encapsulated: only the hub service can construct one, and only it knows how to remove one. The `IDisposable` shape lets Blazor components tie unsubscription to their own lifetime with `using` or an explicit dispose.
- **Where it's used**: Constructed and returned by [`NotificationHubService.OnChannelEvent`](#notificationhubservice); disposed by the component that subscribed.

---

### INotificationInboxUIService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/INotificationInboxUIService.cs:9` · Level 2 · interface

- **What it is**: The UI-side contract for the notification inbox: paged retrieval, unread count, mark-one-read, and mark-all-read.
- **Depends on**: [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) and [`UserNotificationDTO`](group-10-notifications.md#usernotificationdto) (its return shapes).
- **Concept introduced: the UI service abstraction.** [Rubric §18, UI Architecture & Component Design] assesses whether components talk to typed services rather than raw `HttpClient`. Components depend on this interface, not on the HTTP implementation, so a bell or inbox page can be tested against a stub. [Rubric §9, API & Contract Design] shows in the paged inbox signature: the inbox is fetched a page at a time, never as one unbounded dump.
- **Walkthrough**: Four members (`INotificationInboxUIService.cs:12-21`): `GetInboxAsync(pageNumber = 1, pageSize = 20, ct)` returns a nullable [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt); `GetUnreadCountAsync(ct)` returns an `int`; `MarkReadAsync(id, ct)` and `MarkAllReadAsync(ct)` are the two mutations.
- **Why it's built this way**: A thin interface at the presentation edge keeps components decoupled from transport and makes the inbox mockable in bUnit tests.
- **Where it's used**: Implemented by [`NotificationInboxService`](#notificationinboxservice); consumed by [`NotificationBell`](#notificationbell) (for the unread count) and the inbox page.

---

### IPushNotificationUIService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/IPushNotificationUIService.cs:9` · Level 2 · interface

- **What it is**: The UI-side contract for admin push operations: broadcast a notification and read paginated send history.
- **Depends on**: [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), [`PushNotificationDTO`](group-10-notifications.md#pushnotificationdto), and [`SendPushNotificationRequest`](group-10-notifications.md#sendpushnotificationrequest).
- **Concept introduced**: The same UI-service-abstraction idea as [`INotificationInboxUIService`](#inotificationinboxuiservice); [Rubric §18, UI Architecture]. The difference is audience: this is the organizer/admin surface (send + history), not the per-user inbox.
- **Walkthrough**: Two members (`IPushNotificationUIService.cs:12-15`): `SendAsync(SendPushNotificationRequest, ct)` returns the created [`PushNotificationDTO`](group-10-notifications.md#pushnotificationdto); `GetHistoryAsync(pageNumber = 1, pageSize = 10, ct)` returns a paged history.
- **Why it's built this way**: Splitting the admin contract from the inbox contract keeps each component's dependency surface minimal and lets apps that never send notifications avoid referencing the send path.
- **Where it's used**: Implemented by [`PushNotificationService`](#pushnotificationservice); consumed by the admin send/history pages.

---

### MMCATheme

> MMCA.Common.UI · `MMCA.Common.UI.Theme` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/MMCATheme.cs:9` · Level 2 · class (static)

- **What it is**: The single application-wide MudBlazor `MudTheme` instance, defining the brand palette (light and dark), typography, and layout radius, applied once via `MudThemeProvider` in the root layout.
- **Depends on**: [`BrandColors`](#brandcolors) (the palette source of truth); MudBlazor (NuGet).
- **Concept introduced: one theme, accessibility-justified.** [Rubric §20, Design System & Theming] assesses whether the app has a single coherent theme rather than per-page overrides; `MMCATheme.Instance` is that one object (`MMCATheme.cs:11`). [Rubric §21, Accessibility] is unusually visible here: several color choices carry inline WCAG 2.1 AA contrast math. `Secondary` was moved from Teal 600 `#00897B` (~4.0:1, below the 4.5:1 floor for normal text) to Teal 700 `#00796B` (~5.3:1) for muted helper text (lines 21-24); `WarningContrastText` is darkened to `#212121` because white on amber `#F57F17` is only ~2.65:1 and failed the gated axe scan on filled Warning chips (lines 31-35); and in the dark palette `PrimaryContrastText` and `ErrorContrastText` are set to near-black for the same reason (lines 57-73). The dark palette itself lightens the primary for contrast on dark surfaces and drives `MudThemeProvider`'s `IsDarkMode` (lines 50-54).
- **Walkthrough**: A single `static MudTheme Instance { get; }` initialized with a `PaletteLight` (lines 13-49), a `PaletteDark` (lines 50-86), a `Typography` block (Inter font stack plus heading sizes/weights, lines 87-139), and `LayoutProperties` with `DefaultBorderRadius = "6px"` (lines 140-143). The light and dark `Primary`/`PrimaryDarken`/`PrimaryLighten` entries read straight from [`BrandColors`](#brandcolors).
- **Why it's built this way**: A static readonly instance means the theme is constructed once and shared by every `MudThemeProvider`. Sourcing the brand hues from [`BrandColors`](#brandcolors) (rather than re-typing hex) is what lets `BrandColorTokenTests` police C#/CSS drift. The per-color contrast comments turn accessibility decisions into reviewable, testable source rather than tribal knowledge.
- **Where it's used**: Applied in the root layout of the Blazor Web and MAUI hosts via `MudThemeProvider Theme="MMCATheme.Instance"`.

---

### NotificationHubService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:24` · Level 2 · class (sealed, partial)

- **What it is**: The client-side SignalR connection manager: it opens a connection to `/hubs/notifications` after login, invokes a callback for received notifications, and also carries ephemeral live-channel events that components join and subscribe to.
- **Depends on**: [`ApiSettings`](#apisettings) (for the hub URL) and [`ITokenStorageService`](#itokenstorageservice) (for the bearer token); [`ChannelSubscription`](#channelsubscription) (its subscription handle); `Microsoft.AspNetCore.SignalR.Client` (NuGet); `IAsyncDisposable`.
- **Concept introduced: resilient client-side real-time with re-joinable channels.** [Rubric §6, CQRS & Event-Driven] extends to the browser here: the server pushes notifications and channel events over SignalR instead of the client polling for everything. [Rubric §29, Resilience & Business Continuity] shows in two mechanisms: the initial connect retries with exponential backoff (up to `MaxRetries = 3`, starting at 2s, doubling each attempt, `NotificationHubService.cs:26-31,92-121`) so a token-not-yet-ready or API-still-starting race recovers, and `WithAutomaticReconnect()` (line 75) keeps long sessions alive. The load-bearing subtlety is that SignalR group membership does not survive a reconnect, so joined channels are tracked in `_joinedChannels` and re-joined automatically on `Reconnected` (lines 88-90, `RejoinChannelsAsync` lines 262-288).
- **Walkthrough**: The constructor builds the hub URL from `ApiSettings.ApiEndpoint + "/hubs/notifications"` (lines 48-57). `StartAsync` builds the `HubConnection` with an `AccessTokenProvider` that pulls the current token (line 74), registers the `ReceiveNotification` handler that fans out to the settable `NotificationCallback` (lines 78-84), registers `ReceiveChannelEvent` → `DispatchChannelEventAsync` (line 86), wires the `Reconnected` re-join (line 90), then runs the retry loop (lines 92-121). `JoinChannelAsync` records the channel under a `Lock`, ensures the connection is up, and invokes the server `JoinChannel` (lines 131-155); `LeaveChannelAsync` is the mirror (lines 163-185). `OnChannelEvent` registers a handler and returns a disposable [`ChannelSubscription`](#channelsubscription) (lines 196-214), multicast, so an invisible listener and a page can watch the same channel. `DispatchChannelEventAsync` snapshots subscribers under the lock and invokes each in isolation, logging (never rethrowing) a failing handler so one bad subscriber cannot starve the rest (lines 235-260). `StopAsync`/`DisposeAsync` tear the connection down (lines 219-233). Structured logging uses `[LoggerMessage]` source generation, which is why the class is `partial` (lines 305-327).
- **Why it's built this way**: Sealed and scoped per circuit because a connection and its channel membership are per-user-session. Best-effort semantics (join/leave/handler failures are logged, not thrown) match the reality that live updates are a convenience layered over the authoritative API, not a correctness guarantee. Isolating handler invocations protects the fan-out.
- **Where it's used**: Registered as a scoped service in Blazor UI hosts; started after login and stopped on logout; its notification callback drives [`NotificationState`](#notificationstate) and MudBlazor snackbars.

---

### NotificationBell

> MMCA.Common.UI · `MMCA.Common.UI.Components.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Notifications/NotificationBell.razor.cs:14` · Level 3 · class (component)

- **What it is**: The code-behind for the header notification bell: it renders the unread badge from the scoped [`NotificationState`](#notificationstate), and the first rendered instance elects itself the single active poller so duplicate bell placements never duplicate API traffic.
- **Depends on**: [`NotificationState`](#notificationstate) (badge state and the poller guard), [`INotificationInboxUIService`](#inotificationinboxuiservice) (unread count), [`NotificationRoutePaths`](#notificationroutepaths) (inbox route), `NavigationManager`, and `IStringLocalizer<SharedResource>` (`[Inject]`ed, lines 18-21); implements `IDisposable`.
- **Concept introduced: single-poller election across duplicate renders.** [Rubric §19, State Management] assesses coordinated shared UI state. A bell can appear in both the desktop header and the mobile drawer at once; without coordination each would run its own 30-second poll and its own navigation refresh. `NotificationBell` calls `State.TryRegisterPoller()` on first render (line 40) and only the winner starts the `PeriodicTimer` and subscribes to `LocationChanged` (lines 41-48). [Rubric §23, Front-End Performance] applies too: this halves-or-better the badge's API load in dual-placement layouts.
- **Walkthrough**: `PollInterval` is 30 seconds (line 16). `OnAfterRenderAsync(firstRender)` subscribes to `State.OnChange`/`State.OnRefreshRequested` (lines 35-36), then attempts poller registration; the winner refreshes immediately and starts `PollLoopAsync` off a `PeriodicTimer` (lines 44-48). `PollLoopAsync` awaits `WaitForNextTickAsync` on the `_cts` token and swallows the expected cancellation on dispose (lines 51-64). `OnLocationChanged` and `HandleRefreshRequested` both fire a discarded `RefreshUnreadCountAsync` (lines 68-77), a deliberate discard, since the refresh catches its own failures and this avoids the async-void process-crash mode (VSTHRD100, see the source comment). `RefreshUnreadCountAsync` fetches the count, then marshals `State.SetUnreadCount` + `StateHasChanged` back onto the renderer via `InvokeAsync`, catching cancellation/disposal/network errors so the badge just holds its last value (lines 79-110). `Dispose(bool)` unsubscribes, unregisters the poller if it was the active one, and disposes the timer and `_cts` (lines 134-154).
- **Why it's built this way**: The poller-election guard keeps a genuinely useful UX affordance (a live badge) from becoming a request amplifier. The careful catch-all-and-discard pattern is the correct way to launch fire-and-forget refreshes from synchronous event handlers without risking an unobserved async-void crash. Full `IDisposable` cleanup releases the timer, token source, and event subscriptions on navigation.
- **Where it's used**: Rendered in app layout headers/drawers; clicking it navigates to `NotificationRoutePaths.NotificationInbox` (line 132).

---

### NotificationInboxService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationInboxService.cs:12` · Level 3 · class (sealed)

- **What it is**: The HTTP implementation of the notification inbox contract: it calls the `notifications/inbox` WebAPI resource for paged retrieval, unread count, and the two mark-read operations.
- **Depends on**: [`AuthenticatedServiceBase`](#authenticatedservicebase) (its base, supplying the authenticated client, retry policy, and error helper), [`INotificationInboxUIService`](#inotificationinboxuiservice) (the contract it implements), [`ITokenStorageService`](#itokenstorageservice), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), [`UserNotificationDTO`](group-10-notifications.md#usernotificationdto), and [`ServiceExceptionHelper`](#serviceexceptionhelper) (via the base, for surfacing server errors).
- **Concept introduced: a typed HTTP UI service over a non-CRUD resource.** [Rubric §18, UI Architecture] assesses UI-to-API access through typed services. This is the same HTTP-service shape as [`EntityServiceBase<TEntityDTO, TIdentifierType>`](#entityservicebasetentitydto-tidentifiertype), but for a resource whose verbs are read and mark (not create/update). Each call builds an authenticated client from the base, wraps the send in the shared `RetryPolicy`, and routes non-success responses through `ServiceExceptionHelper.ThrowIfDomainExceptionAsync` so a domain error reaches the user as its real message.
- **Walkthrough**: A primary constructor forwards `IHttpClientFactory` and `ITokenStorageService` to [`AuthenticatedServiceBase`](#authenticatedservicebase) (lines 12-15). `GetInboxAsync` builds an invariant-culture query string and deserializes a [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) (lines 20-39). `GetUnreadCountAsync` returns `0` on any non-success response (a badge should degrade quietly, not throw, lines 42-56). `MarkReadAsync` PUTs to `{id}/read` and `MarkAllReadAsync` PUTs to `read-all`, both surfacing domain errors via the helper (lines 59-90).
- **Why it's built this way**: Inheriting from [`AuthenticatedServiceBase`](#authenticatedservicebase) removes per-method boilerplate for auth, retry, and error translation. The deliberate exception is the unread count, which returns `0` rather than throwing so a transient failure never breaks the header badge.
- **Where it's used**: Registered against [`INotificationInboxUIService`](#inotificationinboxuiservice); consumed by [`NotificationBell`](#notificationbell) and the inbox page.

---

### PushNotificationService

> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/PushNotificationService.cs:13` · Level 4 · class (sealed)

- **What it is**: The HTTP implementation of the admin push contract: send a notification and read paginated send history against the `notifications` WebAPI resource.
- **Depends on**: [`EntityServiceBase<TEntityDTO, TIdentifierType>`](#entityservicebasetentitydto-tidentifiertype) (its base, typed on `PushNotificationDTO`/`PushNotificationIdentifierType`), [`IPushNotificationUIService`](#ipushnotificationuiservice) (the contract), [`ITokenStorageService`](#itokenstorageservice), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), [`PushNotificationDTO`](group-10-notifications.md#pushnotificationdto), and [`SendPushNotificationRequest`](group-10-notifications.md#sendpushnotificationrequest).
- **Concept introduced**: The base-class HTTP service pattern taken to its cleanest form; [Rubric §18, UI Architecture]. Where [`NotificationInboxService`](#notificationinboxservice) hand-builds each request, this one leans on [`EntityServiceBase`](#entityservicebasetentitydto-tidentifiertype)'s `SendRequestAsync` helper so each method is a single expression.
- **Walkthrough**: The primary constructor passes the resource name `"notifications"` plus the factory and token service to [`EntityServiceBase<PushNotificationDTO, PushNotificationIdentifierType>`](#entityservicebasetentitydto-tidentifiertype) (lines 13-17), which exposes `Endpoint`. `SendAsync` POSTs the request via `PostAsJsonAsync` and returns the created DTO with `throwIfNull: true` (lines 20-29). `GetHistoryAsync` builds an invariant-culture `pageNumber`/`pageSize` query and deserializes a [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) (lines 32-41).
- **Why it's built this way**: Delegating transport, auth, retry, and error handling to [`EntityServiceBase`](#entityservicebasetentitydto-tidentifiertype) keeps this class down to two expression-bodied methods, matching the framework's "UI services are typed HTTP clients, never raw `HttpClient`" convention.
- **Where it's used**: Registered against [`IPushNotificationUIService`](#ipushnotificationuiservice); injected into the admin send and history pages.

### NotificationInbox

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationInbox.razor.cs:17` · Level 3 · class

- **What it is**: the code-behind for the per-user notification inbox, routed at `@page "/notifications/inbox"` (`NotificationInbox.razor:1`). It fetches the signed-in user's notifications a page at a time, renders each as a read/unread card, lets the user mark items read individually or all at once, and reloads the current page when a real-time push asks it to refresh.
- **Depends on**: first-party: [INotificationInboxUIService](#inotificationinboxuiservice) (the typed read-side HTTP service), [NotificationState](#notificationstate) (the per-circuit unread-count store and refresh signal), [UserNotificationDTO](group-10-notifications.md#usernotificationdto) (the row shape), [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) (the paged envelope the inbox service returns), [ErrorMessages](#errormessages) (centralized snackbar copy), and [SharedResource](#sharedresource) (the resx anchor type for the injected localizer). Externals: `MudBlazor` (`ISnackbar`, `BreadcrumbItem`, `Icons`), `Microsoft.AspNetCore.Components` (`[Inject]`, `OnInitializedAsync`, `InvokeAsync`, `StateHasChanged`), `Microsoft.Extensions.Localization` (`IStringLocalizer<T>`), BCL `CancellationTokenSource` / `IDisposable` / `Math.Ceiling` / `DateTime.UtcNow`.
- **Concept introduced, the Blazor code-behind page pattern (`.razor` + `.razor.cs` partial class).** The three notification pages in this file family are authored as *partial classes* split across two files: the `.razor` holds declarative MudBlazor markup, the `.razor.cs` holds the C# (`public partial class NotificationInbox`, line 17), injected services, state fields, and event handlers. The framework instantiates the component, calls `OnInitializedAsync` (line 39) once, and re-renders when handlers mutate fields. Several patterns recur across all three pages and are worth learning here once:
  - **Disposal-safe async with a per-component `CancellationTokenSource`.** A `readonly CancellationTokenSource _cts` (line 26) is created with the component and passed to every service call (`_cts.Token`). `Dispose(bool)` (lines 180-192) cancels and disposes it via the classic dispose-pattern guard (`_disposed` flag, line 178). Every async handler swallows `OperationCanceledException` silently (e.g. lines 93-96) because that is the *expected* outcome when the user navigates away mid-fetch; only genuine exceptions reach the snackbar.
  - **`IsLoading` / `IsSaving` busy flags** (lines 32-33) gate the UI: the markup shows a progress indicator while loading and disables the action buttons while saving, preventing double-submits.
  - **Real-time push refresh via an event subscription.** In `OnInitializedAsync` the page subscribes to `NotificationState.OnRefreshRequested` (line 49) and unsubscribes in `Dispose(bool)` (line 186). When a push arrives, `HandleRefreshRequested` (lines 54-62) bounces onto the render thread with `InvokeAsync(RefreshFromPushAsync)` (line 61), and `RefreshFromPushAsync` (lines 64-75) coalesces overlapping refreshes (it returns early when already loading or disposed, lines 68-71) then reloads and calls `StateHasChanged` (line 74). This keeps the inbox live without polling.
  - **Centralized, localized error copy** via [ErrorMessages](#errormessages), e.g. `ErrorMessages.LoadError(L["Entity.Notifications"], ex)` (line 99), instead of inline strings.
  - `[Rubric §18, UI Architecture & Component Design]` assesses component cohesion and separation of concerns; this page keeps presentation in `.razor` and behavior in `.razor.cs`, talks only to an injected abstraction ([INotificationInboxUIService](#inotificationinboxuiservice)) rather than `HttpClient` directly, and is single-responsibility (inbox only).
  - `[Rubric §19, State Management & Data Flow]` assesses how UI state is held and shared; the page owns transient view state in private fields (`_notifications`, `_currentPage`, `_totalPages`, lines 35-37) but writes the *shared* unread count back into the scoped [NotificationState](#notificationstate) and *reads* its refresh signal, keeping local state local and shared state shared.
  - `[Rubric §21, Accessibility (a11y)]` assesses keyboard/screen-reader support; the mark-read control is a MudBlazor icon button carrying an explicit localized `aria-label` in the markup (`NotificationInbox.razor`) so the icon-only action is announced.
  - `[Rubric §27, Internationalization & Localization]` assesses whether user-facing text resolves per-culture from a single catalog. This page holds no literal English: an injected `IStringLocalizer<SharedResource> L` (line 24) resolves the title, empty-state and mark-all labels, and every snackbar (`L["Notif.AllMarkedRead"]`, line 162). The breadcrumb trail is deliberately built inside `OnInitializedAsync` (lines 43-47), not in a field initializer, so the injected localizer is available and the labels re-resolve per circuit under the active culture (the comment on lines 41-42 cites ADR-027).
- **Walkthrough**,
  - `PageSize` (line 19) is a `const int 20`; the page is fixed-size server-paginated, not infinite-scroll.
  - Injected members: `InboxService`, `NotificationState`, `Snackbar`, `L` (lines 21-24) via `[Inject]` auto-properties (the `= default!;` silences nullability, DI guarantees non-null).
  - `Title` (line 28) is a computed property reading `L["Notif.Inbox.Title"].Value`; `_breadcrumbs` (line 30) starts empty and is populated in `OnInitializedAsync`, the leaf crumb `disabled: true` marks the current page.
  - `OnInitializedAsync` (line 39) builds the localized Home to Inbox trail (lines 43-47), subscribes to `NotificationState.OnRefreshRequested` (line 49), then calls `LoadNotificationsAsync` (line 51).
  - `LoadNotificationsAsync` (lines 77-105): sets `IsLoading`, calls `GetInboxAsync(_currentPage, PageSize, token)` (line 82), materializes `result.Items` into `_notifications` (line 85), and computes `_totalPages` from `result.PaginationMetadata.TotalItemCount` with `Math.Ceiling` (line 86), clamped to a floor of 1 (lines 87-90) so the pager never shows zero pages.
  - `OnPageChangedAsync` (lines 107-111): records the page and reloads.
  - `MarkReadAsync(notification)` (lines 113-143): calls `InboxService.MarkReadAsync` (line 118), then **optimistically patches local state**: finds the row (`FindIndex`, line 121) and replaces it with `notification with { IsRead = true, ReadOn = DateTime.UtcNow }` (line 124, a `record with`-expression), then refetches the authoritative unread count via `GetUnreadCountAsync` and pushes it into `NotificationState.SetUnreadCount` (lines 128-129) so the bell badge updates without a full reload.
  - `MarkAllReadAsync` (lines 145-176): one service call (line 150), loops the local list flipping unread rows to read (lines 153-159), then `SetUnreadCount(0)` (line 161) and a localized success snackbar (line 162).
- **Why it's built this way**: the page is a *thin* view over [INotificationInboxUIService](#inotificationinboxuiservice); all HTTP/JSON lives in the service so the component stays testable with a stub. The optimistic local-state patch (rather than re-fetching the whole page on every mark-read) keeps the UI responsive while still reconciling the shared badge count from the server, and the event-driven refresh keeps the list current when a real-time push lands. This whole notification UI ships from `MMCA.Common.UI` precisely so every consumer app gets the inbox for free, a reusable building block, the charter of this group.
- **Where it's used**: rendered at `/notifications/inbox` for authenticated users; the route and nav entry are contributed by [NotificationUIModule](#notificationuimodule). The companion notification-bell component reads the same [NotificationState](#notificationstate) this page writes, and the layout-mounted `NotificationListener` pushes the `OnRefreshRequested` signal this page consumes. Its siblings are the admin pages [NotificationList](#notificationlist) and [NotificationSend](#notificationsend).

### NotificationList

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationList.razor.cs:16` · Level 3 · class

- **What it is**: the code-behind for the **admin/organizer** push-notification history page, routed at `@page "/notifications"` (`NotificationList.razor:1`). It loads previously sent broadcast notifications and renders them in a status table; a button routes onward to the compose page.
- **Depends on**: first-party: [IPushNotificationUIService](#ipushnotificationuiservice) (the send/history HTTP service), [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) (the table row shape, carrying `RecipientCount` / `Status` / `CreatedOn`), [NotificationRoutePaths](#notificationroutepaths) (route constants), [ErrorMessages](#errormessages), and [SharedResource](#sharedresource) (localizer anchor). Externals: `MudBlazor` (`ISnackbar`, `BreadcrumbItem`, `Icons`), `Microsoft.AspNetCore.Components` (`NavigationManager`, `[Inject]`), `Microsoft.Extensions.Localization`.
- **Concept reinforced, the same code-behind page shape as [NotificationInbox](#notificationinbox).** Same `[Inject]` services (lines 18-21), same `readonly CancellationTokenSource _cts` + dispose-pattern (lines 23, 78-95), same `IsLoading` gate (line 29), same `OperationCanceledException`-swallowing load (lines 60-63), same localized `ErrorMessages.LoadError` snackbar (line 66). It differs only in *what* it loads and *how* it renders.
  - `[Rubric §25, Navigation, Routing & Information Architecture]` assesses route structure and inter-page flow; navigation here is centralized through [NotificationRoutePaths](#notificationroutepaths) constants (`NavigateToSend` sends to `NotificationRoutePaths.NotificationSend`, line 74) rather than hard-coded URL strings, so route changes happen in one place.
  - `[Rubric §27, Internationalization & Localization]`, beyond the localized title and breadcrumbs (lines 25, 43-47), this page adds a small **status-localization** helper: `DisplayStatus(string status)` (lines 34-38) looks up `L[$"Notif.Status.{status}"]` and, when the key is missing (`localized.ResourceNotFound`), falls back to the raw wire value (line 37). The status *comparison* stays on the untranslated wire string while only the displayed chip text localizes, a clean separation of transport value from presentation (the comment on line 33 cites ADR-027).
- **Walkthrough**,
  - Injected `NotificationService`, `NavigationManager`, `Snackbar`, `L` (lines 18-21); `Title` reads `L["Notif.List.Title"].Value` (line 25); `_breadcrumbs` built Home to Push-Notifications in `OnInitializedAsync` (lines 43-47).
  - `_notifications` is an `IReadOnlyCollection<PushNotificationDTO>` initialized empty (line 31).
  - `OnInitializedAsync` (line 40) sends to `LoadNotificationsAsync`.
  - `LoadNotificationsAsync` (lines 52-72): calls `GetHistoryAsync(pageNumber: 1, pageSize: 50, token)` (line 57) and copies `result.Items` into `_notifications`, defaulting to `[]` when the result or its items are null (line 58). This page requests a **single fixed 50-row page** and lets MudBlazor's client-side pager paginate that buffer locally, unlike the inbox there is no server round-trip per page.
  - `NavigateToSend` (line 74): `NavigationManager.NavigateTo(NotificationRoutePaths.NotificationSend)`, bound to the "Send New Notification" button.
- **Why it's built this way**: broadcast history is low-volume admin data, so a single 50-row fetch with client-side paging is simpler and adequate (no server-side paging plumbing). Keeping HTTP behind [IPushNotificationUIService](#ipushnotificationuiservice) mirrors the inbox page and keeps the component a thin view. See [NotificationInbox](#notificationinbox) for the shared `[Rubric §18, UI Architecture & Component Design]` story.
- **Where it's used**: rendered at `/notifications` for organizer/admin roles; entry and route contributed by [NotificationUIModule](#notificationuimodule). Sibling of the compose page [NotificationSend](#notificationsend), to which it links.

### NotificationSend

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationSend.razor.cs:16` · Level 3 · class

- **What it is**: the code-behind for the compose-and-broadcast form, routed at `@page "/notifications/send"` (`NotificationSend.razor:1`). It collects a title and body, validates them via a `MudForm`, sends a single broadcast to all recipients through the Notification API, then reports the recipient count and returns to the list.
- **Depends on**: first-party: [IPushNotificationUIService](#ipushnotificationuiservice) (the `SendAsync` HTTP call), [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) (the request record built from the form fields), [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) (the send result carrying `RecipientCount`), [NotificationRoutePaths](#notificationroutepaths), [ErrorMessages](#errormessages), and [SharedResource](#sharedresource). Externals: `MudBlazor` (`MudForm`, `ISnackbar`, `BreadcrumbItem`, `Icons`), `Microsoft.AspNetCore.Components` (`NavigationManager`), `Microsoft.Extensions.Localization`.
- **Concept introduced, `MudForm`-driven validation with a `@ref` handle.** This is the family's *form* page. The markup declares a `<MudForm @ref="_form">` with two required text fields carrying localized `RequiredError` and length constraints (`NotificationSend.razor`). The C# holds the form by reference (`MudForm? _form`, line 34) and, on submit, **explicitly drives validation** before sending: `await _form.ValidateAsync()` then a guard on `_form.IsValid` (lines 50-55). This is the imperative half of MudBlazor's two-way validation contract, declarative rules in markup, an explicit `ValidateAsync` gate in code so an invalid form never reaches the API. The bound fields are plain `string _notificationTitle` / `_notificationBody` (lines 32-33), not a model object, because the form is tiny; note they are deliberately *not* named `_title` so they do not collide with the localized `Title` page property (the comment on line 31 cites SonarAnalyzer S4275).
  - `[Rubric §24, Forms, Validation & UX Safety]` assesses input validation, double-submit protection, and feedback. This page embodies all three: client-side required/length validation, an `IsSaving` flag (line 29) that disables the Send button while a send is in flight to block double submits, and a localized warning snackbar `ErrorMessages.ValidationError` (line 53) on a failed gate plus a success snackbar naming the recipient count.
  - `[Rubric §27, Internationalization & Localization]`, every string here resolves through `IStringLocalizer<SharedResource> L` (line 21): the compose labels, the required-error text, and the success message `L["Notif.Send.SentTo", result.RecipientCount]` (line 65), which passes the count as a format argument so pluralization/word-order stay in the resource file. Like its siblings the breadcrumb trail is built in an initialization hook, here the synchronous `OnInitialized` (lines 36-43, the comment cites ADR-027), so the injected localizer is available.
- **Walkthrough**,
  - Injected `NotificationService`, `NavigationManager`, `Snackbar`, `L` (lines 18-21); `_breadcrumbs` Home to Push-Notifications to Send (lines 38-43, the middle crumb is a real link via `NotificationRoutePaths.Notifications`).
  - `SendNotificationAsync` (lines 45-81): null-guards `_form` (lines 47-48); validates (lines 50-55, warning snackbar `ErrorMessages.ValidationError` on failure); under `IsSaving`, builds `new SendPushNotificationRequest(_notificationTitle, _notificationBody)` (line 60) and awaits `SendAsync(request, token)` (line 61); on a non-null [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) result, raises a success snackbar interpolating `result.RecipientCount` (line 65) and navigates back to the list (line 66).
  - Same disposal-safe pattern as its siblings, `_cts` cancelled in `Dispose` (lines 87-98); the cancel-catch comment here additionally notes the `InteractiveAuto` render-mode transition (line 71), the case where the WebAssembly runtime takes over mid-call.
  - `NavigateToList` (line 83): the Cancel button's handler, back to `NotificationRoutePaths.Notifications`.
- **Why it's built this way**: a deliberately small form: no edit/unsaved-changes guard (it is create-only and one-shot), validation kept in `MudForm` rather than a FluentValidation round-trip because the only rules are required + length, and HTTP kept behind [IPushNotificationUIService](#ipushnotificationuiservice) so the component is unit-testable. The send is fire-and-confirm, the server fans out to recipients via the SignalR push pipeline (see [Group 10](group-10-notifications.md)) and returns only the aggregate count.
- **Where it's used**: rendered at `/notifications/send` for organizer/admin roles; reached from the "Send New Notification" button on [NotificationList](#notificationlist). The server-side validator for [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) enforces the same rules a second time.

### NotificationUIModule

> MMCA.Common.UI · `MMCA.Common.UI.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs:14` · Level 4 · class (sealed)

- **What it is**: the notification feature's `IUIModule` descriptor: it contributes the inbox + admin nav items, the app-bar bell component, and the layout-level real-time listener component, plus its own assembly for component discovery.
- **Depends on**: [IUIModule](#iuimodule) (the contract it implements, Level 2), [NavItem](#navitem) (Level 1), [NavSection](#navsection) (Level 0), [NotificationRoutePaths](#notificationroutepaths) (Level 0), and [RoleNames](group-08-auth.md#rolenames) (Level 0); the `NotificationBell` and `NotificationListener` Razor components (same package); `MudBlazor` `Icons` for the material icons; `System.Reflection` for `Assembly`.
- **Concept introduced, the UI module pattern (client-side counterpart to `IModule`).** `[Rubric §25, Navigation, Routing & Information Architecture]` (assesses modular, role-aware navigation composition). Just as server modules implement [IModule](group-14-module-system-composition.md#imodule), each UI feature implements `IUIModule` to *declare*, not hard-code into a central menu, its nav items, app-bar components, and layout components. The host discovers all `IUIModule` singletons and assembles the shell, so adding a feature never edits the shared layout. `[Rubric §18, UI Architecture & Component Design]` and `[Rubric §11, Security]` also apply: nav items carry role gates so the admin "Push Notifications" entry only renders for organizers.
- **Walkthrough**
  - `NavItems` (lines 16-20), two `NavItem`s: an inbox entry pointing at `NotificationRoutePaths.NotificationInbox` in `NavSection.User` (any authenticated user, line 18) and a `RoleNames.Organizer`-gated "Push Notifications" admin entry in `NavSection.Admin` grouped under "Notifications" (line 19).
  - `AppBarComponentTypes` (line 22), `[typeof(NotificationBell)]`, injected into the top bar.
  - `LayoutComponentTypes` (line 24), `[typeof(NotificationListener)]`, mounted once in the layout to own the SignalR callback wiring.
  - `Assembly` (line 26), `typeof(NotificationUIModule).Assembly`, used by the host to scan this package's routable components.
- **Why it's built this way**: declarative contribution (collections of nav items / component `Type`s) keeps the shell open for extension and closed for modification; expressing role gates *on the nav item* keeps authorization next to the thing it protects.
- **Where it's used**: registered as an `IUIModule` singleton by [AddNotificationUI](#dependencyinjection); enumerated by the host's navigation and shell composition at startup.

### ServerTokenStorageService

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:17` · Level 4 · class (sealed)

- **What it is**: the Blazor **Server** implementation of [ITokenStorageService](#itokenstorageservice), a cookie-only token store (no `localStorage`). During SSR prerender it reads the access token from the HttpOnly session cookie; on the live interactive circuit it holds the access token in memory only and re-hydrates it from that cookie through a same-origin refresh endpoint. The HttpOnly refresh token is never readable by JavaScript.
- **Depends on**: first-party: [ITokenStorageService](#itokenstorageservice) (the interface it implements), [CookieTokenReader](group-08-auth.md#cookietokenreader) (reads access/refresh tokens out of the request cookies), [ISessionCookieSync](#isessioncookiesync) (writes/clears the HttpOnly session cookies), [ITokenRefresher](#itokenrefresher) (acquires a fresh access token from the same-origin endpoint), and [JwtTokenInfo](#jwttokeninfo) (client-side expiry inspection). Its WASM counterpart is [WasmTokenStorageService](#wasmtokenstorageservice). Externals: `Microsoft.AspNetCore.Http` (`IHttpContextAccessor`, `HttpContext`), BCL `Task` / `TimeSpan`.
- **Concept introduced, the two-world token store (SSR request vs. interactive circuit).** A Blazor Web app runs a page twice: first as a server-side prerender inside a live HTTP request (an `HttpContext` exists, JS interop does not), then as a stateful SignalR *circuit* with no `HttpContext` (JS interop is available). A single token store must serve both worlds, and this class does it by branching on `httpContextAccessor.HttpContext is not null`:
  - **SSR prerender** (line 32): the request's HttpOnly cookie is the source of truth (it may have just been refreshed in place by the `UseCookieSessionRefresh` middleware), so `GetAccessTokenAsync` returns `cookieTokenReader.ReadAccessToken()` (line 34) with no interop.
  - **Interactive circuit** (lines 37-52): the token lives in the `_accessToken` field (line 25). If [JwtTokenInfo](#jwttokeninfo)`.IsFresh` says it is still valid beyond a 30-second skew (`ExpirySkew`, line 23) it is returned directly (lines 39-41); otherwise it is re-acquired from the HttpOnly cookie via the same-origin refresh endpoint.
  - `[Rubric §26, Front-End Security]` assesses protection of credentials in the browser. The design is a deliberate XSS-hardening choice: the long-lived refresh token stays in an HttpOnly cookie (unreachable from JS), the access token is held only in circuit memory and never persisted to `localStorage`, and the refresh token transits JS exactly once, for the same-origin POST that seeds the cookies at login (`SetTokensAsync`, lines 62-68).
  - `[Rubric §11, Security]` assesses the wider auth model; this store is one edge of the dual-fetch/JWKS session design (ADR-022), the piece that decides *where* a token is read on each side of the prerender boundary.
- **Walkthrough**,
  - The primary constructor (lines 17-21) takes `IHttpContextAccessor`, [CookieTokenReader](group-08-auth.md#cookietokenreader), [ISessionCookieSync](#isessioncookiesync), and [ITokenRefresher](#itokenrefresher); it is `sealed`, carrying no app-specific state (the XML doc notes it was hoisted out of the app hosts so both consumer apps share one copy).
  - Fields: `ExpirySkew` (line 23, a `static readonly TimeSpan` of 30 seconds), the in-memory `_accessToken` (line 25), and `_hydrateInFlight` (line 26), a `Task<string?>?` used for single-flight de-duplication.
  - `GetAccessTokenAsync` (lines 28-53): the SSR/circuit branch described above. The refresh path uses a **single-flight** guard, `_hydrateInFlight ??= HydrateAsync()` (line 44), so that concurrent callers on one circuit (the delegating handler, the auth-state provider, the SignalR connection) share one acquisition rather than stampeding the refresh endpoint; the `finally` clears the field (line 51) so the next expiry triggers a new fetch.
  - `GetRefreshTokenAsync` (lines 55-60): returns the cookie value only during SSR; on the circuit the HttpOnly refresh token is unreadable, so it returns `null`.
  - `SetTokensAsync` (lines 62-68): caches the access token in memory (line 63) and calls `sessionCookieSync.SyncAsync(accessToken, refreshToken)` (line 67) to seed the HttpOnly cookies at login.
  - `ClearTokensAsync` (lines 70-74): nulls the in-memory token and calls `sessionCookieSync.ClearAsync()` on logout.
  - `HydrateAsync` (lines 76-80): the private refresh, `_accessToken = await tokenRefresher.AcquireAccessTokenAsync()` (line 78), caches and returns the new token.
- **Why it's built this way**: Blazor Server's split lifecycle means a naive "read a token from storage" store would either break during prerender (no JS) or leak the refresh token to JS if it used `localStorage`. Branching on `HttpContext` presence and keeping the refresh token cookie-only resolves both, and the single-flight hydrate keeps the refresh endpoint from being hammered by the several components that all need the bearer token at once. See ADR-022 for the session-token design.
- **Where it's used**: registered as the scoped `ITokenStorageService` for Blazor Web (server-interactive) hosts by `AddCommonServerTokenStorage()` in [DependencyInjection](#dependencyinjection); the app's `Program.cs` calls that instead of registering a local copy.

### DependencyInjection

> MMCA.Common.UI · `MMCA.Common.UI.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:11` · Level 5 · class (static)

- **What it is**: the notification-UI registration entry point: a single `AddNotificationUI()` extension on `IServiceCollection` that wires every notification UI service, the shared state, the SignalR client, and the `IUIModule` descriptor.
- **Depends on**: [IPushNotificationUIService](#ipushnotificationuiservice) + [PushNotificationService](#pushnotificationservice), [INotificationInboxUIService](#inotificationinboxuiservice) + [NotificationInboxService](#notificationinboxservice), [NotificationState](#notificationstate), [NotificationHubService](#notificationhubservice), and [IUIModule](#iuimodule) + [NotificationUIModule](#notificationuimodule); `Microsoft.Extensions.DependencyInjection`.
- **Concept**: the C# `extension(IServiceCollection)` registration idiom (see [primer](00-primer.md#c-extensiont-types--read-this-once)). `[Rubric §33, Developer Experience & Inner Loop]` (assesses one-call feature wiring) and `[Rubric §3, Clean Architecture]` (the feature's DI is co-located with the feature, not scattered into a host's `Program.cs`). Note this is one of several distinct `DependencyInjection` classes in the UI package; it is specifically the **Notifications** registrar, the sibling of the `MMCA.Common.UI.Web` host registrar below.
- **Walkthrough**: inside the `extension(IServiceCollection services)` block (line 13), `AddNotificationUI()` (line 19) registers, in order: `IPushNotificationUIService → PushNotificationService` (scoped, line 22), `INotificationInboxUIService → NotificationInboxService` (scoped, line 25), `NotificationState` (scoped, one unread-count owner per circuit, line 28), `NotificationHubService` (scoped SignalR client, line 31), and `IUIModule → NotificationUIModule` as a **singleton** (line 34, because the module descriptor is immutable shell metadata, not per-circuit state), then returns `services` for chaining (line 36).
- **Why it's built this way**: the deliberate scoped-vs-singleton split matters: the HTTP services, state, and hub connection are per-Blazor-circuit, while the nav/shell descriptor is process-wide; bundling them behind one extension keeps host startup to a single `services.AddNotificationUI()` call.
- **Where it's used**: called from each consuming host's `Program.cs` (Blazor Web and MAUI) that opts into the notification UI feature; complements the main `MMCA.Common.UI` shared registration.

### DependencyInjection

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:14` · Level 5 · class (static)

- **What it is**: the registration extensions for the server-side Blazor Web host pieces this package ships, three `IServiceCollection` methods a host calls from `Program.cs` instead of registering app-local copies of the token store, the CSP provider, and the form factor.
- **Depends on**: first-party: [ServerTokenStorageService](#servertokenstorageservice) and [ITokenStorageService](#itokenstorageservice) (the token-store registration), [BlazorCspPolicyProvider](#blazorcsppolicyprovider) and [ICspPolicyProvider](group-16-aspire-orchestration.md#icsppolicyprovider) (the CSP registration), and [WebFormFactor](group-26-device-capability-layer.md#webformfactor) + [IFormFactor](group-26-device-capability-layer.md#iformfactor) (the form-factor registration). Externals: `Microsoft.Extensions.DependencyInjection` (`IServiceCollection`, `AddScoped`, `AddSingleton`, `AddHttpContextAccessor`).
- **Concept**: uses the C# preview `extension(IServiceCollection services)` block (line 16, see [primer](00-primer.md#c-extensiont-types--read-this-once)) rather than classic `this`-parameter extension methods, the package-wide DI-registration idiom. The three methods inside the block are semantically ordinary extension methods declared in the new form.
  - `[Rubric §15, Best Practices & Code Quality]` assesses idiom consistency; every `MMCA.Common.*` package registers services through the same `extension(IServiceCollection)` shape, and this class follows it.
  - `[Rubric §26, Front-End Security]` assesses browser-side hardening; `AddCommonBlazorCsp()` wires the dynamic Content-Security-Policy that pins `connect-src` to the configured API/Gateway origin, and the doc comment encodes a **load-bearing ordering rule** (call it *before* `AddCommonSecurityHeaders`) so this provider wins over the default static one, which is registered with `TryAdd`.
- **Walkthrough**,
  - `AddCommonServerTokenStorage()` (lines 26-30): calls `services.AddHttpContextAccessor()` (line 28, the accessor [ServerTokenStorageService](#servertokenstorageservice) needs to detect the SSR-vs-circuit boundary), then registers [ServerTokenStorageService](#servertokenstorageservice) as the **scoped** [ITokenStorageService](#itokenstorageservice) (line 29). Scoped is correct here: a Blazor circuit is a DI scope, so the in-memory access token is per-user-session state.
  - `AddCommonBlazorCsp()` (lines 39-40): registers [BlazorCspPolicyProvider](#blazorcsppolicyprovider) as a **singleton** [ICspPolicyProvider](group-16-aspire-orchestration.md#icsppolicyprovider) (the policy is computed once from `ApiSettings`, so a singleton is right). Because it uses `AddSingleton` (not `TryAdd`), it deterministically replaces the default provider, which is why the "register before `AddCommonSecurityHeaders`" ordering matters.
  - `AddCommonWebFormFactor()` (lines 47-48): registers [WebFormFactor](group-26-device-capability-layer.md#webformfactor) as a **singleton** [IFormFactor](group-26-device-capability-layer.md#iformfactor); it reports "Web" plus the server OS description. The XML doc notes the WASM client registers `AddWasmFormFactor()` from `MMCA.Common.UI` instead, so the same `IFormFactor` abstraction resolves differently per host kind.
- **Why it's built this way**: all three pieces are host-level infrastructure that carried no app-specific state, so they were hoisted into `MMCA.Common.UI.Web` and exposed as one-line registrations, keeping every consumer's `Program.cs` free of duplicated token-store, CSP, and form-factor wiring (the reusable-building-blocks charter of this group). The comment on `AddCommonServerTokenStorage` also names its companions in `MMCA.Common.API` (`AddServerAuthSessionCookie` / `UseCookieSessionRefresh`) and the required `ITokenRefresher` registration, so the full session-cookie plumbing is discoverable from one place (ADR-022).
- **Where it's used**: called from the `Program.cs` of the server-interactive Blazor Web hosts in the consumer apps (MMCA.ADC, MMCA.Store) to register the shared token store, CSP provider, and form factor.

### NotificationInbox

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationInbox.razor.cs:15` · Level 3 · class

- **What it is**: the code-behind for the per-user notification inbox, routed at `@page "/notifications/inbox"` (`NotificationInbox.razor:1`). It fetches the signed-in user's notifications a page at a time, renders each as a read/unread card, and lets the user mark items read individually or all at once.
- **Depends on**: first-party: [INotificationInboxUIService](#inotificationinboxuiservice) (the typed read-side HTTP service), [NotificationState](#notificationstate) (the per-circuit unread-count store), [UserNotificationDTO](group-10-notifications.md#usernotificationdto) (the row shape), [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) (the paged envelope the inbox service returns), [ErrorMessages](#errormessages) (centralized snackbar copy), and [SharedResource](#sharedresource) (the resx anchor type for the injected localizer). Externals: `MudBlazor` (`ISnackbar`, `BreadcrumbItem`, `MudPagination`, `MudCard`, `MudProgressLinear`, `MudIconButton`), `Microsoft.AspNetCore.Components` (`[Inject]`, `OnInitializedAsync`), `Microsoft.Extensions.Localization` (`IStringLocalizer<T>`), BCL `CancellationTokenSource` / `IDisposable` / `Math.Ceiling`.
- **Concept introduced, the Blazor code-behind page pattern (`.razor` + `.razor.cs` partial class).** The three notification pages in this file family are authored as *partial classes* split across two files: the `.razor` holds declarative MudBlazor markup, the `.razor.cs` holds the C# (`public partial class NotificationInbox`, line 15), injected services, state fields, and event handlers. The framework instantiates the component, calls `OnInitializedAsync` (line 37) once, and re-renders when handlers mutate fields. Three patterns recur across all three pages and are worth learning here once:
  - **Disposal-safe async with a per-component `CancellationTokenSource`.** A `readonly CancellationTokenSource _cts` (line 24) is created with the component and passed to every service call (`_cts.Token`). `Dispose(bool)` (lines 153-164) cancels and disposes it via the classic dispose-pattern guard (`_disposed` flag, line 151). Every async handler swallows `OperationCanceledException` silently (e.g. lines 66-69) because that is the *expected* outcome when the user navigates away mid-fetch, only genuine exceptions reach the snackbar.
  - **`IsLoading` / `IsSaving` busy flags** (lines 30-31) gate the UI: the markup shows a `MudProgressLinear` while loading (`NotificationInbox.razor:21-24`) and disables the action buttons while saving, preventing double-submits.
  - **Centralized, localized error copy** via [ErrorMessages](#errormessages), e.g. `ErrorMessages.LoadError(L["Entity.Notifications"], ex)` (line 72), instead of inline strings.
  - `[Rubric §18, UI Architecture & Component Design]` assesses component cohesion and separation of concerns; this page keeps presentation in `.razor` and behavior in `.razor.cs`, talks only to an injected abstraction ([INotificationInboxUIService](#inotificationinboxuiservice)) rather than `HttpClient` directly, and is single-responsibility (inbox only).
  - `[Rubric §19, State Management & Data Flow]` assesses how UI state is held and shared; the page owns transient view state in private fields (`_notifications`, `_currentPage`, `_totalPages`, lines 33-35) but writes the *shared* unread count back into the scoped [NotificationState](#notificationstate) so the nav-bar bell stays in sync, local state local, shared state shared.
  - `[Rubric §21, Accessibility (a11y)]` assesses keyboard/screen-reader support; the mark-read control is a `MudIconButton` carrying an explicit localized `aria-label="@L["Notif.MarkRead.Aria"]"` (`NotificationInbox.razor:55`) so the icon-only action is announced.
  - `[Rubric §27, Internationalization & Localization]` assesses whether user-facing text resolves per-culture from a single catalog. This page holds no literal English: an injected `IStringLocalizer<SharedResource> L` (line 22) resolves the title, empty-state and mark-all labels, and every snackbar (`L["Notif.AllMarkedRead"]`, line 135). The breadcrumb trail is deliberately built inside `OnInitializedAsync` (lines 41-45), not in a field initializer, so the injected localizer is available and the labels re-resolve per circuit under the active culture (the comment on line 39-40 cites ADR-027).
- **Walkthrough**,
  - `PageSize` (line 17) is a `const int 20`; the page is fixed-size server-paginated, not infinite-scroll.
  - Injected members: `InboxService`, `NotificationState`, `Snackbar`, `L` (lines 19-22) via `[Inject]` auto-properties (the `= default!;` silences nullability, DI guarantees non-null).
  - `Title` (line 26) is a computed property reading `L["Notif.Inbox.Title"].Value`; `_breadcrumbs` (line 28) starts empty and is populated in `OnInitializedAsync`, the leaf crumb `disabled: true` marks the current page.
  - `OnInitializedAsync` (line 37) builds the localized Home to Inbox trail (lines 41-45), then calls `LoadNotificationsAsync` (line 47).
  - `LoadNotificationsAsync` (lines 50-78): sets `IsLoading`, calls `GetInboxAsync(_currentPage, PageSize, token)` (line 55), materializes `result.Items` into `_notifications` (line 58), and computes `_totalPages` from `result.PaginationMetadata.TotalItemCount` with `Math.Ceiling` (line 59), clamped to a floor of 1 (lines 60-63) so the pager never shows zero pages.
  - `OnPageChangedAsync` (lines 80-84): bound to `MudPagination.SelectedChanged` (`NotificationInbox.razor:75`); records the page and reloads.
  - `MarkReadAsync(notification)` (lines 86-116): calls `InboxService.MarkReadAsync` (line 91), then **optimistically patches local state**, finds the row (`FindIndex`, line 94) and replaces it with `notification with { IsRead = true, ReadOn = DateTime.UtcNow }` (line 97, a `record with`-expression), then refetches the authoritative unread count via `GetUnreadCountAsync` and pushes it into `NotificationState.SetUnreadCount` (lines 101-102) so the bell badge updates without a full reload.
  - `MarkAllReadAsync` (lines 118-149): one service call (line 123), loops the local list flipping unread rows to read (lines 126-132), then `SetUnreadCount(0)` (line 134) and a localized success snackbar (line 135).
- **Why it's built this way**: the page is a *thin* view over [INotificationInboxUIService](#inotificationinboxuiservice); all HTTP/JSON lives in the service so the component stays testable with a stub. The optimistic local-state patch (rather than re-fetching the whole page on every mark-read) keeps the UI responsive while still reconciling the shared badge count from the server. This whole notification UI ships from `MMCA.Common.UI` precisely so every consumer app gets the inbox for free, a reusable building block, the charter of this group.
- **Where it's used**: rendered at `/notifications/inbox` for authenticated users; the route and nav entry are contributed by the notification UI module. The companion notification-bell component reads the same [NotificationState](#notificationstate) this page writes. Its siblings are the admin pages [NotificationList](#notificationlist) and [NotificationSend](#notificationsend).

### NotificationList

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationList.razor.cs:16` · Level 3 · class

- **What it is**: the code-behind for the **admin/organizer** push-notification history page, routed at `@page "/notifications"` (`NotificationList.razor:1`). It loads previously sent broadcast notifications and renders them in a status table; a button routes onward to the compose page.
- **Depends on**: first-party: [IPushNotificationUIService](#ipushnotificationuiservice) (the send/history HTTP service), [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) (the table row shape, carrying `RecipientCount` / `Status` / `CreatedOn`), [NotificationRoutePaths](#notificationroutepaths) (route constants), [ErrorMessages](#errormessages), and [SharedResource](#sharedresource) (localizer anchor). Externals: `MudBlazor` (`MudTable`, `MudTablePager`, `MudChip`, `ISnackbar`, `BreadcrumbItem`), `Microsoft.AspNetCore.Components` (`NavigationManager`, `[Inject]`), `Microsoft.Extensions.Localization`.
- **Concept reinforced, the same code-behind page shape as [NotificationInbox](#notificationinbox).** Same `[Inject]` services (lines 18-21), same `readonly CancellationTokenSource _cts` + dispose-pattern (lines 23, 78-95), same `IsLoading` gate (line 29), same `OperationCanceledException`-swallowing load (lines 60-63), same localized `ErrorMessages.LoadError` snackbar (line 66). It differs only in *what* it loads and *how* it renders.
  - `[Rubric §25, Navigation, Routing & Information Architecture]` assesses route structure and inter-page flow; navigation here is centralized through [NotificationRoutePaths](#notificationroutepaths) constants (`NavigateToSend` sends to `NotificationRoutePaths.NotificationSend`, line 74) rather than hard-coded URL strings, so route changes happen in one place.
  - `[Rubric §27, Internationalization & Localization]`, beyond the localized title and breadcrumbs (lines 25, 43-47), this page adds a small **status-localization** helper: `DisplayStatus(string status)` (lines 34-38) looks up `L[$"Notif.Status.{status}"]` and, when the key is missing (`localized.ResourceNotFound`), falls back to the raw wire value. The status *comparison* stays on the untranslated wire string (`context.Status == "Sent"` in the markup) while only the displayed chip text localizes, a clean separation of transport value from presentation (ADR-027).
- **Walkthrough**,
  - Injected `NotificationService`, `NavigationManager`, `Snackbar`, `L` (lines 18-21); `Title` reads `L["Notif.List.Title"].Value` (line 25); `_breadcrumbs` built Home to Push-Notifications in `OnInitializedAsync` (lines 43-47).
  - `_notifications` is an `IReadOnlyCollection<PushNotificationDTO>` initialized empty (line 31).
  - `OnInitializedAsync` (line 40) sends to `LoadNotificationsAsync`.
  - `LoadNotificationsAsync` (lines 52-72): calls `GetHistoryAsync(pageNumber: 1, pageSize: 50, token)` (line 57) and copies `result.Items` into `_notifications`, defaulting to `[]` when the result or its items are null (line 58). This page requests a **single fixed 50-row page** and lets MudBlazor's client-side `MudTablePager` (`NotificationList.razor:61`) paginate that buffer locally, unlike the inbox, there is no server round-trip per page.
  - `NavigateToSend` (line 74): `NavigationManager.NavigateTo(NotificationRoutePaths.NotificationSend)`, bound to the "Send New Notification" button.
  - The markup colors the `Status` cell with a `MudChip`, green `Sent`, red `Failed`, amber otherwise (`NotificationList.razor:45-56`), each rendering `DisplayStatus(context.Status)` as its label.
- **Why it's built this way**: broadcast history is low-volume admin data, so a single 50-row fetch with client-side paging is simpler and adequate (no server-side paging plumbing). Keeping HTTP behind [IPushNotificationUIService](#ipushnotificationuiservice) mirrors the inbox page and keeps the component a thin view. See [NotificationInbox](#notificationinbox) for the shared `[Rubric §18, UI Architecture & Component Design]` story.
- **Where it's used**: rendered at `/notifications` for organizer/admin roles; entry and route contributed by the notification UI module. Sibling of the compose page [NotificationSend](#notificationsend), to which it links.

### NotificationSend

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationSend.razor.cs:16` · Level 3 · class

- **What it is**: the code-behind for the compose-and-broadcast form, routed at `@page "/notifications/send"` (`NotificationSend.razor:1`). It collects a title and body, validates them via a `MudForm`, sends a single broadcast to all recipients through the Notification API, then reports the recipient count and returns to the list.
- **Depends on**: first-party: [IPushNotificationUIService](#ipushnotificationuiservice) (the `SendAsync` HTTP call), [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) (the request record built from the form fields), [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) (the send result carrying `RecipientCount`), [NotificationRoutePaths](#notificationroutepaths), [ErrorMessages](#errormessages), and [SharedResource](#sharedresource). Externals: `MudBlazor` (`MudForm`, `MudTextField`, `ISnackbar`, `BreadcrumbItem`), `Microsoft.AspNetCore.Components` (`NavigationManager`), `Microsoft.Extensions.Localization`.
- **Concept introduced, `MudForm`-driven validation with a `@ref` handle.** This is the family's *form* page. The markup declares `<MudForm @ref="_form">` (`NotificationSend.razor:19`) with two `MudTextField`s carrying `Required="true"` + localized `RequiredError` and `MaxLength`/`Counter` constraints (`NotificationSend.razor:20-39`). The C# holds the form by reference (`MudForm? _form`, line 34) and, on submit, **explicitly drives validation** before sending: `await _form.ValidateAsync()` then a guard on `_form.IsValid` (lines 50-55). This is the imperative half of MudBlazor's two-way validation contract, declarative rules in markup, an explicit `ValidateAsync` gate in code so an invalid form never reaches the API. The bound fields are plain `string _notificationTitle` / `_notificationBody` (lines 32-33), not a model object, because the form is tiny; note they are deliberately *not* named `_title` so they do not collide with the localized `Title` page property (the comment on line 31 cites SonarAnalyzer S4275).
  - `[Rubric §24, Forms, Validation & UX Safety]` assesses input validation, double-submit protection, and feedback. This page embodies all three: client-side required/length validation with `Immediate="true"` live feedback (`NotificationSend.razor:26,37`), an `IsSaving` flag (line 29) that disables the Send button and flips its label to the localized "Sending..." (`NotificationSend.razor:47-48`) to block double submits, and a localized warning snackbar `ErrorMessages.ValidationError` (line 53) on a failed gate plus a success snackbar naming the recipient count.
  - `[Rubric §27, Internationalization & Localization]`, every string here resolves through `IStringLocalizer<SharedResource> L` (line 21): the compose labels, the required-error text, and the success message `L["Notif.Send.SentTo", result.RecipientCount]` (line 65), which passes the count as a format argument so pluralization/word-order stay in the resource file (ADR-027). Like its siblings the breadcrumb trail is built in an initialization hook, here the synchronous `OnInitialized` (lines 36-43), so the injected localizer is available.
- **Walkthrough**,
  - Injected `NotificationService`, `NavigationManager`, `Snackbar`, `L` (lines 18-21); `_breadcrumbs` Home to Push-Notifications to Send (lines 38-43, the middle crumb is a real link via `NotificationRoutePaths.Notifications`).
  - `SendNotificationAsync` (lines 45-81): null-guards `_form` (lines 47-48); validates (lines 50-55, warning snackbar `ErrorMessages.ValidationError` on failure); under `IsSaving`, builds `new SendPushNotificationRequest(_notificationTitle, _notificationBody)` (line 60) and awaits `SendAsync(request, token)` (line 61); on a non-null [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) result, raises a success snackbar interpolating `result.RecipientCount` (line 65) and navigates back to the list (line 66).
  - Same disposal-safe pattern as its siblings, `_cts` cancelled in `Dispose` (lines 87-98); the cancel-catch comment here additionally notes the `InteractiveAuto` render-mode transition (line 71), the case where the WebAssembly runtime takes over mid-call.
  - `NavigateToList` (line 83): the Cancel button's handler, back to `NotificationRoutePaths.Notifications`.
- **Why it's built this way**: a deliberately small form: no edit/unsaved-changes guard (it is create-only and one-shot), validation kept in `MudForm` rather than a FluentValidation round-trip because the only rules are required + length, and HTTP kept behind [IPushNotificationUIService](#ipushnotificationuiservice) so the component is unit-testable. The send is fire-and-confirm, the server fans out to recipients via the SignalR push pipeline (see [Group 10](group-10-notifications.md)) and returns only the aggregate count.
- **Where it's used**: rendered at `/notifications/send` for organizer/admin roles; reached from the "Send New Notification" button on [NotificationList](#notificationlist). The server-side validator for [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) (notifications group) enforces the same rules a second time.

### ServerTokenStorageService

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:17` · Level 4 · class

- **What it is**: the Blazor **Server** implementation of [ITokenStorageService](#itokenstorageservice), a cookie-only token store (no `localStorage`). During SSR prerender it reads the access token from the HttpOnly session cookie; on the live interactive circuit it holds the access token in memory only and re-hydrates it from that cookie through a same-origin refresh endpoint. The HttpOnly refresh token is never readable by JavaScript.
- **Depends on**: first-party: [ITokenStorageService](#itokenstorageservice) (the interface it implements), [CookieTokenReader](group-08-auth.md#cookietokenreader) (reads access/refresh tokens out of the request cookies), [ISessionCookieSync](#isessioncookiesync) (writes/clears the HttpOnly session cookies), [ITokenRefresher](#itokenrefresher) (acquires a fresh access token from the same-origin endpoint), and [JwtTokenInfo](#jwttokeninfo) (client-side expiry inspection). Its WASM counterpart is [WasmTokenStorageService](#wasmtokenstorageservice). Externals: `Microsoft.AspNetCore.Http` (`IHttpContextAccessor`, `HttpContext`), BCL `Task` / `TimeSpan`.
- **Concept introduced, the two-world token store (SSR request vs. interactive circuit).** A Blazor Web app runs a page twice: first as a server-side prerender inside a live HTTP request (an `HttpContext` exists, JS interop does not), then as a stateful SignalR *circuit* with no `HttpContext` (JS interop is available). A single token store must serve both worlds, and this class does it by branching on `httpContextAccessor.HttpContext is not null`:
  - **SSR prerender** (line 32): the request's HttpOnly cookie is the source of truth (it may have just been refreshed in place by the `UseCookieSessionRefresh` middleware), so `GetAccessTokenAsync` returns `cookieTokenReader.ReadAccessToken()` (line 34) with no interop.
  - **Interactive circuit** (lines 37-52): the token lives in the `_accessToken` field (line 25). If [JwtTokenInfo.IsFresh](#jwttokeninfo) says it is still valid beyond a 30-second skew (`ExpirySkew`, line 23) it is returned directly (lines 38-41); otherwise it is re-acquired from the HttpOnly cookie via the same-origin refresh endpoint.
  - `[Rubric §26, Front-End Security]` assesses protection of credentials in the browser. The design is a deliberate XSS-hardening choice: the long-lived refresh token stays in an HttpOnly cookie (unreachable from JS), the access token is held only in circuit memory and never persisted to `localStorage`, and the refresh token transits JS exactly once, for the same-origin POST that seeds the cookies at login (`SetTokensAsync`, lines 62-68).
  - `[Rubric §11, Security]` assesses the wider auth model; this store is one edge of the dual-fetch/JWKS session design (ADR-022), the piece that decides *where* a token is read on each side of the prerender boundary.
- **Walkthrough**,
  - The primary constructor (lines 17-21) takes `IHttpContextAccessor`, [CookieTokenReader](group-08-auth.md#cookietokenreader), [ISessionCookieSync](#isessioncookiesync), and [ITokenRefresher](#itokenrefresher); it is `sealed`, carrying no app-specific state (the XML doc notes it was hoisted out of the app hosts so both consumer apps share one copy).
  - Fields: `ExpirySkew` (line 23, a `static readonly TimeSpan` of 30 seconds), the in-memory `_accessToken` (line 25), and `_hydrateInFlight` (line 26), a `Task<string?>?` used for single-flight de-duplication.
  - `GetAccessTokenAsync` (lines 28-53): the SSR/circuit branch described above. The refresh path uses a **single-flight** guard, `_hydrateInFlight ??= HydrateAsync()` (line 44), so that concurrent callers on one circuit (the delegating handler, the auth-state provider, the SignalR connection) share one acquisition rather than stampeding the refresh endpoint; the `finally` clears the field (line 51) so the next expiry triggers a new fetch.
  - `GetRefreshTokenAsync` (lines 55-60): returns the cookie value only during SSR; on the circuit the HttpOnly refresh token is unreadable, so it returns `null`.
  - `SetTokensAsync` (lines 62-68): caches the access token in memory (line 63) and calls `sessionCookieSync.SyncAsync(accessToken, refreshToken)` (line 67) to seed the HttpOnly cookies at login.
  - `ClearTokensAsync` (lines 70-74): nulls the in-memory token and calls `sessionCookieSync.ClearAsync()` on logout.
  - `HydrateAsync` (lines 76-80): the private refresh, `_accessToken = await tokenRefresher.AcquireAccessTokenAsync()` (line 78), caches and returns the new token.
- **Why it's built this way**: Blazor Server's split lifecycle means a naive "read a token from storage" store would either break during prerender (no JS) or leak the refresh token to JS if it used `localStorage`. Branching on `HttpContext` presence and keeping the refresh token cookie-only resolves both, and the single-flight hydrate keeps the refresh endpoint from being hammered by the several components that all need the bearer token at once. See ADR-022 for the session-token design.
- **Where it's used**: registered as the scoped `ITokenStorageService` for Blazor Web (server-interactive) hosts by `AddCommonServerTokenStorage()` in [DependencyInjection](#dependencyinjection); the app's `Program.cs` calls that instead of registering a local copy.

### DependencyInjection

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:13` · Level 5 · class

- **What it is**: the registration extensions for the server-side Blazor Web host pieces this package ships, two `IServiceCollection` methods that a host calls from `Program.cs` instead of registering app-local copies of the token store and CSP provider.
- **Depends on**: first-party: [ServerTokenStorageService](#servertokenstorageservice) and [ITokenStorageService](#itokenstorageservice) (the token-store registration), [BlazorCspPolicyProvider](#blazorcsppolicyprovider) and [ICspPolicyProvider](group-16-aspire-orchestration.md#icsppolicyprovider) (the CSP registration). Externals: `Microsoft.Extensions.DependencyInjection` (`IServiceCollection`, `AddScoped`, `AddSingleton`, `AddHttpContextAccessor`).
- **Concept**: uses the C# preview `extension(IServiceCollection services)` block (line 15, see [primer §4](00-primer.md#c-extensiont-types--read-this-once)) rather than classic `this`-parameter extension methods, the package-wide DI-registration idiom. The two methods inside the block are semantically ordinary extension methods declared in the new form.
  - `[Rubric §15, Best Practices & Code Quality]` assesses idiom consistency; every `MMCA.Common.*` package registers services through the same `extension(IServiceCollection)` shape, and this class follows it.
  - `[Rubric §26, Front-End Security]` assesses browser-side hardening; `AddCommonBlazorCsp()` wires the dynamic Content-Security-Policy that pins `connect-src` to the configured API/Gateway origin, and the doc comment encodes a **load-bearing ordering rule** (call it *before* `AddCommonSecurityHeaders`) so this provider wins over the default static one, which is registered with `TryAdd`.
- **Walkthrough**,
  - `AddCommonServerTokenStorage()` (lines 25-29): calls `services.AddHttpContextAccessor()` (line 27, the accessor [ServerTokenStorageService](#servertokenstorageservice) needs to detect the SSR-vs-circuit boundary), then registers [ServerTokenStorageService](#servertokenstorageservice) as the **scoped** [ITokenStorageService](#itokenstorageservice) (line 28). Scoped is correct here: a Blazor circuit is a DI scope, so the in-memory access token is per-user-session state.
  - `AddCommonBlazorCsp()` (lines 38-39): registers [BlazorCspPolicyProvider](#blazorcsppolicyprovider) as a **singleton** [ICspPolicyProvider](group-16-aspire-orchestration.md#icsppolicyprovider) (the policy is computed once from `ApiSettings`, so a singleton is right). Because it uses `AddSingleton` (not `TryAdd`), it deterministically replaces the default provider, which is why the "register before `AddCommonSecurityHeaders`" ordering matters.
- **Why it's built this way**: both pieces are host-level infrastructure that carried no app-specific state, so they were hoisted into `MMCA.Common.UI.Web` and exposed as one-line registrations, keeping every consumer's `Program.cs` free of duplicated token-store and CSP wiring (the reusable-building-blocks charter of this group). The comment on `AddCommonServerTokenStorage` also names its companions in `MMCA.Common.API` (`AddServerAuthSessionCookie` / `UseCookieSessionRefresh`) and the required `ITokenRefresher` registration, so the full session-cookie plumbing is discoverable from one place (ADR-022).
- **Where it's used**: called from the `Program.cs` of the server-interactive Blazor Web hosts in the consumer apps (MMCA.ADC, MMCA.Store) to register the shared token store and CSP provider.


---
[⬅ Module System, Composition & Configuration](group-14-module-system-composition.md)  •  [Index](00-index.md)  •  [Aspire Orchestration & Service Defaults ➡](group-16-aspire-orchestration.md)
