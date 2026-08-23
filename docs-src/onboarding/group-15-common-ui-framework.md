# 15. Common UI Framework (MudBlazor components, theme, base pages)

**What this chapter covers.** `MMCA.Common.UI` is the Blazor presentation package, and it is one of the
two layers (with `Grpc`) allowed to reference **`Shared` only**: its single `ProjectReference` is
`MMCA.Common.Shared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/MMCA.Common.UI.csproj:42`), and
every other dependency is a NuGet package (MudBlazor, Polly, SignalR client, Scrutor, QRCoder,
`System.IdentityModel.Tokens.Jwt`, `MMCA.Common.UI.csproj:19-37`). It touches no Application, Domain, or
Infrastructure type, which is exactly what lets it compile into a Blazor WebAssembly bundle and into a
.NET MAUI hybrid head (see [primer §1](00-primer.md#1-the-big-picture)). What it ships is the set of
reusable parts every consumer UI assembles pages from: a **server-paged data-grid list-page base class**,
the brand **MudBlazor theme**, a **typed HTTP service base** for talking to the WebAPI, the **client-side
authentication and token-refresh boundary**, **list-page state preservation** across navigation, a
**pluggable UI-module** contract, an end-to-end **localization** pipeline, and a turnkey **notification
inbox / push / live-channel** feature. A second, thinner package `MMCA.Common.UI.Web` sits above it and
holds the pieces that need an ASP.NET pipeline (server-side token storage, the Blazor
Content-Security-Policy provider). The per-app and per-module Razor pages in the consumer apps
([chapter 21](group-21-conference-ui.md)) derive from and consume these primitives, and the same
components render across Blazor Server, WebAssembly, and MAUI with no per-platform reimplementation.
`[Rubric §18, UI Architecture & Component Design]` assesses component reuse, separation of presentation
from data access, and whether there is a coherent composition model; nearly every type in this group
exists so a consumer page is *composed* rather than hand-rolled.

**The data-access boundary: `IEntityService` over one named HttpClient.** A page never touches
`HttpClient`. It depends on
[IEntityService<TEntityDTO, TIdentifierType>](#ientityservicetentitydto-tidentifiertype)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IEntityService.cs:12`), the CRUD
contract, and gets its behavior from the abstract
[EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:25`), which derives in
turn from [AuthenticatedServiceBase](#authenticatedservicebase)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/AuthenticatedServiceBase.cs:15`). That base
owns the cross-cutting concerns of an outbound API call. First, a **Polly** retry policy: 3 retries with
exponential backoff (2s, 4s, 8s) **plus up to one second of random jitter** so a fleet of clients does
not re-converge on the same instant (`AuthenticatedServiceBase.cs:26-32`), and the retryable set is
deliberate rather than "any 5xx", 501 and 505 are permanent verdicts and are excluded while 408 and 429
are explicit invitations to come back (`AuthenticatedServiceBase.cs:108-117`). Second, a helper that
creates a `"APIClient"` `HttpClient` from `IHttpClientFactory` and stamps the JWT Bearer token onto it
from [ITokenStorageService](#itokenstorageservice), swallowing the `InvalidOperationException` that JS
interop throws during SSR prerender (`AuthenticatedServiceBase.cs:59-78`); a sibling
`CreateClientWithToken` builds a client around an explicitly supplied token so a request the API answered
`401` can be replayed with one acquired straight from [ITokenRefresher](#itokenrefresher) rather than
resending the token the server just rejected (`AuthenticatedServiceBase.cs:88-95`). Retry and idempotency
are coupled on purpose: `NewIdempotencyKey()` (`AuthenticatedServiceBase.cs:51`) is generated **once per
logical write** and set as a default header on the single client that serves every attempt
(`EntityServiceBase.cs:135`, `EntityServiceBase.cs:193-200`), so a retried create dedupes on the server
instead of producing a duplicate row (the server half is
[IdempotencyHeaders](group-08-auth.md#idempotencyheaders) and
[IdempotentAttribute](group-12-api-hosting-mapping.md#idempotentattribute),
[ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)). Creates are the only verb
that carries a key: updates are full PUTs and deletes are naturally idempotent
(`EntityServiceBase.cs:128-130`). Responses come back in the same
[PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) /
[CollectionResult<T>](group-01-result-error-handling.md#collectionresultt) envelopes the API returns, and
`SendRequestAsync` runs [ServiceExceptionHelper](#serviceexceptionhelper) over a failed response *before*
`EnsureSuccessStatusCode` can throw a contextless exception (`EntityServiceBase.cs:210-211`): the helper
matches the ProblemDetails `title` the API emits ("Domain Exception", "Validation Exception", "Operation
failed") and rethrows it as a
[DomainInvariantViolationException](group-01-result-error-handling.md#domaininvariantviolationexception)
carrying the original message
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ServiceExceptionHelper.cs:49-56`), so a backend
`Result.Failure` reaches the page as a typed, displayable error. Many-to-many join endpoints, which have
POST and DELETE but no standalone reads, get their own thinner base,
[ChildEntityServiceBase](#childentityservicebase)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ChildEntityServiceBase.cs:17`), whose
`DeleteByIdAsync` maps a 404 to `false` instead of an exception (`ChildEntityServiceBase.cs:45-48`).
`[Rubric §3, Clean Architecture]` and `[Rubric §9, API & Contract Design]`: the UI binds to a DTO
contract and an interface, never to server internals, and the wire envelope is uniform across every
entity. `[Rubric §29, Resilience]` is the retry/jitter/idempotency triad.

**The list page: `DataGridListPageBase<TDto>`.** This is the most concept-dense type in the group and
the centerpiece of the compose-do-not-repeat thesis. Every list screen in every consumer app derives
from [DataGridListPageBase<TDto>](#datagridlistpagebasetdto)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:20`), a
`ComponentBase` that encapsulates what would otherwise be copy-pasted onto each page: server-side paging
against `MudDataGrid<T>`, `CancellationTokenSource` lifecycle, loading state, filter and sort extraction
from MudBlazor's `GridState<T>`, error surfacing through `ISnackbar`, a `LoadFailed` flag so a failed
fetch renders an inline retry instead of a misleading "no records" empty state
(`DataGridListPageBase.cs:40`, set at `:507` and `:565`), **viewport-driven mobile versus desktop
rendering** (it implements `IBrowserViewportObserver` and flips `IsMobile` through
[BreakpointConstants](#breakpointconstants) at the 960 px sidebar-collapse boundary,
`DataGridListPageBase.cs:44,267` and
`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/BreakpointConstants.cs:16-17`), a persisted
dense-density toggle (`DataGridListPageBase.cs:76`), and a careful `IAsyncDisposable`/`IDisposable`
teardown. It also solves a Blazor render-mode problem: grid data captured during SSR prerender is
persisted through `PersistentComponentState` as a [PersistedGridState](#persistedgridstate) record
(`DataGridListPageBase.cs:805`), restored on `OnInitialized` (`DataGridListPageBase.cs:130-140`) and
re-registered for persisting with an **explicit** `RenderMode.InteractiveAuto`, because a page that
inherits its render mode from `<Routes>` gives the framework nothing to associate the callback with
(`DataGridListPageBase.cs:146-159`). A `PrerenderFetchTimeoutMs` of 5000 caps how long prerender may
block on a cold backend before falling back to an empty grid the first interactive fetch refills
(`DataGridListPageBase.cs:82`, applied at `:528`).
`[Rubric §23, Front-End Performance & Rendering]` assesses render efficiency and avoided round-trips;
this persist-and-restore dance is that concern made concrete. The inline comments also record the
MudDataGrid v9 pager quirks the class works around, notably that `RowsPerPage` cannot be restored by
parameter without resetting `CurrentPage` (`DataGridListPageBase.cs:59-67`, `:359-411`).

**State preservation across navigation.** Paging, sort, filters, and density live in the URL query
string as the source of truth, encoded and decoded by
[ListPageQueryStateService](#listpagequerystateservice) under deliberately short reserved keys (`p`,
`ps`, `mp`, `s`, `sd`, `d`, `q`, `f:<name>`) with defaults omitted so a pristine list page has a clean
URL (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ListPageQueryStateService.cs:15-28`), so
deep links and browser back/forward replay correctly. The noisier scroll offset lives in
[ListPageStateService](#listpagestateservice)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ListPageStateService.cs:58`), a **per-circuit
scoped** service whose synchronous dictionary is the fast path and whose `HydrateFromSessionAsync`
(`ListPageStateService.cs:98`) / `PersistToSessionAsync` (`ListPageStateService.cs:133`) mirror entries
through `sessionStorage` via a `nav-interop.js` module (`ListPageStateService.cs:60`) so state survives
circuit teardown, `forceLoad` navigation, and the SSR to WASM transition. Every JS path there is
defensively caught (prerender, disconnected circuit, Safari private mode) so storage can never break the
page. The immutable [ListPageState](#listpagestate) record (`ListPageStateService.cs:9`) carries page,
page size, mobile page, scroll, sort, density, and a page-specific filter dictionary, and is updated with
`with` expressions. [NavigationHistoryService](#navigationhistoryservice)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/NavigationHistoryService.cs:12`)
bridges Blazor's `NavigationManager` to the browser history API so a detail page can perform a real
`history.back()` when a previous entry exists and fall back to a fixed path otherwise.
`[Rubric §19, State Management & Data Flow]` assesses a deliberate, scoped state model rather than
ambient globals: these are registered `Scoped`, so each circuit gets its own instance
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:86-88`).
`[Rubric §25, Navigation & Information Architecture]` covers the route catalogue
([RoutePaths](#routepaths), [NavItem](#navitem) with its role, claim, section and group facets, and the
[NavSection](#navsection) enum whose declaration order is the sidebar order,
`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NavSection.cs:7-17`) and the open-redirect guard
[ReturnUrlProtector](#returnurlprotector), which accepts only same-origin relative paths beginning with
a single forward slash and rejects protocol-relative forms, backslashes, control characters, and
anything that does not parse as a relative URI, replacing each with a fallback
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/ReturnUrlProtector.cs:18-59`).

**Authentication and the host-polymorphic token refresh.** Client-side auth is contracted by
[IAuthUIService](#iauthuiservice)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/IAuthUIService.cs:9`) and implemented by
[AuthUIService](#authuiservice)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:15`), which calls the
WebAPI `auth/*` endpoints, persists tokens through [ITokenStorageService](#itokenstorageservice), pushes
auth-state changes through [JwtAuthenticationStateProvider](#jwtauthenticationstateprovider) so
`AuthorizeView` reacts immediately, and coordinates push-registration through the device-capability
contract [IPushRegistrationService](group-26-device-capability-layer.md#ipushregistrationservice)
(`AuthUIService.cs:16-20`). Alongside login, register, OAuth code exchange, logout, refresh and change
password, it carries the self-service reset pair: `RequestPasswordResetAsync` POSTs to the anonymous
`auth/forgot-password` endpoint, which answers 202 for every well-formed address, so a `true` result
means "accepted" and never "an account exists" (`IAuthUIService.cs:36-41`, `AuthUIService.cs:285-305`),
and `ResetPasswordAsync` completes the reset against `auth/reset-password`, returning `false` with the
server's generic message in `LastError` for an invalid, expired, or already-consumed token
(`IAuthUIService.cs:43-48`, `AuthUIService.cs:307-328`,
[ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html)). The refresh is the
interesting part: one [ITokenRefresher](#itokenrefresher) abstraction
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/ITokenRefresher.cs:13`) has two
implementations picked per host, [SameOriginProxyTokenRefresher](#sameoriginproxytokenrefresher) for the
browser (the refresh token lives in an HttpOnly cookie and rotation happens server-side behind a
same-origin `/auth/session/token` proxy, so JS never sees it) and
[DirectApiTokenRefresher](#directapitokenrefresher) for MAUI (the refresh token sits in OS SecureStorage
and is exchanged directly against `auth/refresh`), documented at `ITokenRefresher.cs:3-11`. Storage is
host-polymorphic in the same way: [WasmTokenStorageService](#wasmtokenstorageservice) holds the access
token in memory only and single-flights its re-acquisition behind a lock
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/WasmTokenStorageService.cs:11-30`), while
[ServerTokenStorageService](#servertokenstorageservice) reads the HttpOnly cookie whenever a live
`HttpContext` exists (SSR prerender) and switches to the in-memory token on the interactive circuit
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:17,30-40`,
[ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)). The
[ISessionCookieSync](#isessioncookiesync) / [JsFetchSessionCookieSync](#jsfetchsessioncookiesync) pair
mirrors the in-memory access token into that cookie by firing the fetch **from the browser**, so the
`Set-Cookie` lands in the user's own jar under both render modes and falls silent when interop is
unavailable
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JsFetchSessionCookieSync.cs:11-26`). Both
storage implementations and both preference services agree on one 30-second expiry skew read through
[JwtTokenInfo](#jwttokeninfo)`.IsFresh`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JwtTokenInfo.cs:17-36`), which parses the
token client-side without validating its signature because the API validates every request. Every
outbound call also passes [AuthDelegatingHandler](#authdelegatinghandler), which attaches the stored
bearer token to requests that do not go through `CreateAuthenticatedClientAsync`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:9-24`). The
cross-service JWKS validation these tokens flow into is
[ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html).

**Front-end security beyond tokens.** `[Rubric §26, Front-End Security]` assesses token handling, XSS
exposure, and secret storage, and this group answers it in four places: keeping the refresh token out of
JS-reachable storage (above); [BlazorCspPolicyProvider](#blazorcsppolicyprovider), which pins
`connect-src` to `'self'` plus the configured API/Gateway origin (plus its `wss` form for the SignalR
hub) and degrades to a permissive `Report-Only` policy rather than hard-breaking on a misconfiguration
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:21,38-56`),
feeding the shared
[SecurityHeadersMiddleware](group-16-aspire-orchestration.md#securityheadersmiddleware) through
[ICspPolicyProvider](group-16-aspire-orchestration.md#icsppolicyprovider);
[WebApplicationExtensions](#webapplicationextensions)`.UseAuthenticatedNoStore`, which emits
`Cache-Control: no-store` on authenticated HTML so a logged-out user pressing Back never sees the
previous user's page out of the bfcache while anonymous pages stay bfcache-eligible
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Extensions/WebApplicationExtensions.cs:24-44`); and the
`returnUrl` sanitizer already covered. The shared auth forms sit on the same fence:
[LoginModel](#loginmodel), [RegisterModel](#registermodel), [ForgotPasswordModel](#forgotpasswordmodel)
and [ResetPasswordModel](#resetpasswordmodel) are plain data-annotation `EditForm` models, with
[PasswordComplexityAttribute](#passwordcomplexityattribute) mirroring the server's rule (at least 8
characters with upper, lower, digit, and a non-alphanumeric character) so the form gives the verdict the
API would, and deferring empty input to `[Required]` so a blank field shows one message rather than two
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/PasswordComplexityAttribute.cs:12,20-30`).
That client-side parity is the point of `[Rubric §24, Forms, Validation & UX Safety]`: the client
predicts, the server decides.

**Design system and theming.** Visual consistency is centralized in one static
[MMCATheme](#mmcatheme) `MudTheme` instance
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/MMCATheme.cs:11`) holding a light palette
(`:13-47`), a full dark palette (`:48-84`), an Inter-first typography scale (`:85-163`), and a 6 px
default border radius (`:164-167`). It is applied through the shared `MmcaThemeProviders` component,
which renders the four Mud providers every root layout needs exactly once and takes the theme as a
parameter defaulting to `MMCATheme.Instance`, so an app with its own brand passes a derived `MudTheme`
instead of duplicating the provider block
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/MmcaThemeProviders.razor:11-14,22`). The
palette itself comes from a single C# source of truth, [BrandColors](#brandcolors)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/BrandColors.cs:10`), whose doc comment states the
duplication contract plainly: the CSS custom properties in `wwwroot/app.css` must mirror these constants
because C# cannot read CSS at build time, and `BrandColorTokenTests` asserts the two stay in sync
(`BrandColors.cs:3-9`). Color choices carry explicit WCAG reasoning: Secondary is Teal 700 `#00796B` for
about 5.3:1 on light surfaces because the Teal 600 it replaced sat at about 4.0:1, under the AA 4.5:1
floor (`BrandColors.cs:21-26`), and `WarningContrastText` is overridden to `#212121` because MudBlazor's
default white on `#F57F17` measures about 2.65:1 and failed an axe scan on a "Pending Payment" chip
(`MMCATheme.cs:29-33`). `[Rubric §20, Design System, Theming & Consistency]` is the home category (one
token source, dark mode, consistent typography) and `[Rubric §21, Accessibility]` is woven into the
palette itself and into the chrome, down to the skip-to-content link the shared layout renders first
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/MainLayout.razor:17`).
`[Rubric §22, Responsive & Cross-Browser]` is named by [BreakpointConstants](#breakpointconstants) and
exercised by [MobileInfiniteScrollList<TItem>](#mobileinfinitescrolllisttitem), the mobile card list
whose IntersectionObserver sentinel, 500-item rendered cap, and generation-guarded supersession of
in-flight fetches keep a long list bounded
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/MobileInfiniteScrollList.razor.cs:17,38-43`).

**Dark mode is a service, not a flag.** [ThemeService](#themeservice)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ThemeService.cs:16`, registered `Scoped` at
`DependencyInjection.cs:91`) owns the preference: `InitializeAsync` reads the stored value through a
`theme.js` module and falls back to the OS `prefers-color-scheme` only when nothing is stored
(`ThemeService.cs:34-49`), `SetDarkModeAsync` persists through the same module and raises `OnChange`
(`ThemeService.cs:53-59`), and the JS module handle is held by [LazyJsModule](#lazyjsmodule)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/LazyJsModule.cs:20`), a single-flight importer
that caches the in-flight import under a lock so two concurrent callers cannot leak a second module
reference, and that drops a failed task so an import attempted during prerender does not poison the
module for the rest of the circuit (`LazyJsModule.cs:5-19`). `MmcaThemeProviders` subscribes to
`OnChange` and re-renders defensively, guarding the race where the event fires between disposal and
render dispatch (`MmcaThemeProviders.razor:40-68`). **Honest caveat:** unlike locale, the no-flash SSR
bootstrap is not wired for theme. `InitializeAsync` is called from `OnAfterRenderAsync(firstRender)`
because JS interop is unavailable during prerender (`MmcaThemeProviders.razor:29-38`), so the bound mode
is corrected just after hydration and a brief wrong-theme first paint is possible
([ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)).

**Internationalization: one culture decision, carried everywhere.** The framework serves `en-US` and
Spanish (`es`) plus a development-only pseudo locale, and the hard part is not the translations, it is
making one culture decision agree across the `InteractiveAuto` split (SSR prerender, then an
InteractiveServer circuit, then an InteractiveWebAssembly client) *and* across the cross-origin REST
services behind the Gateway, with no language flash and no hydration mismatch
([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html), which supersedes the
single-locale stance of [ADR-011](https://ivanball.github.io/docs/adr/011-single-locale-i18n.html)). A
single non-HttpOnly culture cookie is the source of truth. The WASM client reads it at startup through
[MmcaCultureBootstrap](#mmcaculturebootstrap)`.SetBrowserCultureAsync`, which assigns
`CultureInfo.DefaultThreadCurrent[UI]Culture` *before* `RunAsync()` and falls back to
[SupportedCultures](group-12-api-hosting-mapping.md#supportedcultures)`.Default`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/MmcaCultureBootstrap.cs:22-34`). Outbound API
calls forward the active culture as an `Accept-Language` header through
[CultureDelegatingHandler](#culturedelegatinghandler)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/CultureDelegatingHandler.cs:20-25`), wired into
the `"APIClient"` pipeline at `DependencyInjection.cs:60,82`, because the cross-origin Gateway does not
carry the cookie through to the services and that header is what makes a backend failure come back
localized. View strings are externalized to co-located `.resx` resolved by `IStringLocalizer<T>`
(`AddLocalization()` at `DependencyInjection.cs:42`), anchored by two marker types:
[SharedResource](#sharedresource) for cross-cutting chrome
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Resources/SharedResource.cs:9`, injected by the shared
layout at `MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/MainLayout.razor:12`) and
[MudTranslations](#mudtranslations) for MudBlazor's own component text (pager, filter menus, pickers,
`MMCA.Common/Source/Presentation/MMCA.Common.UI/Resources/MudTranslations.cs:10`), served through
[ResxMudLocalizer](#resxmudlocalizer), which `AddUIShared` `TryAdd`s because `AddMudServices` registers
no `MudLocalizer` of its own (`DependencyInjection.cs:51-55`) and whose values degrade to MudBlazor's
built-in English when a key is missing
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/ResxMudLocalizer.cs:7-17`). Applying a
switch is host-specific and sits behind [ICultureApplier](#icultureapplier): the web default
[EndpointCultureApplier](#endpointcultureapplier) force-loads the server `/culture/set` endpoint so the
server re-renders SSR under the new cookie and the WASM runtime re-reads it on startup
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EndpointCultureApplier.cs:18-32`), while a MAUI
hybrid head, having no ASP.NET pipeline, replaces it after `AddUIShared` with an in-process applier
([MauiCultureApplier](group-26-device-capability-layer.md#mauicultureapplier), chapter 26). The
development-only pseudo locale is the group's own i18n test harness:
[PseudoStringLocalizerFactory](#pseudostringlocalizerfactory) decorates `IStringLocalizerFactory`
unconditionally (`DependencyInjection.cs:49`,
`MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoStringLocalizerFactory.cs:11-19`) so
every `IStringLocalizer` in the host is wrapped in a [PseudoStringLocalizer](#pseudostringlocalizer) at
once, and [PseudoLocalizer](#pseudolocalizer) accents every letter, pads for the roughly 40% expansion
real translations need, and wraps the result in a bracket sentinel while leaving `{0}` placeholders
byte-identical
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoLocalizer.cs:20-30`), which makes
hard-coded strings, fixed-width layouts, and concatenated fragments all visible in one pass
(`PseudoLocalizer.cs:12-19`). Even the snackbar text is localized: [ErrorMessages](#errormessages) keeps
its static call sites but resolves each message from `SharedResource` once the root layout hands it a
localizer, falling back to the English format string until then
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/ErrorMessages.cs:17,26`).
`[Rubric §27, Internationalization]` is the home category here, and adding a locale is a `.es.resx`
sibling plus one allowlist entry, not new infrastructure.

**Per-user preference persistence.** A signed-in user's culture and theme follow them across devices via
the Identity profile. [IUserPreferenceWriter](#iuserpreferencewriter) /
[ApiUserPreferenceWriter](#apiuserpreferencewriter) PUT to `auth/preferences` over the shared
`"APIClient"`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ApiUserPreferenceWriter.cs:62-66`) using the
private [UserPreferencesRequest](#userpreferencesrequest) record (`ApiUserPreferenceWriter.cs:29`), and
[IUserPreferenceReader](#iuserpreferencereader) / [ApiUserPreferenceReader](#apiuserpreferencereader) GET
the same endpoint at login and return the immutable [UserPreferences](#userpreferences) record, whose
null fields mean "leave unchanged"
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/UserPreferences.cs:9`,
`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ApiUserPreferenceReader.cs:24-52`). The write is
strictly best-effort: the cookie is the device-local runtime channel and a failed persist never breaks
the in-page switch. Best-effort has a cost, though, and both sides guard it, first by refusing to send
when the token is missing, unreadable, or within 30 seconds of expiry via
[JwtTokenInfo](#jwttokeninfo)`.IsFresh` (`ApiUserPreferenceWriter.cs:27,47`,
`ApiUserPreferenceReader.cs:21,31`), and second by remembering the exact token the API last answered 401
to, so a revoked session costs one failed request rather than one per toggle
(`ApiUserPreferenceWriter.cs:37,55-58,68-71`). That is a `[Rubric §13, Observability & Operability]`
detail as much as a `[Rubric §19, State Management]` one: at low traffic, one 401 per theme toggle is
enough on its own to trip a failed-request alert rule.

**Pluggable UI modules.** The module system that organizes the back end
([IModule](group-14-module-system-composition.md#imodule), chapter 14) has a front-end counterpart in
[IUIModule](#iuimodule)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IUIModule.cs:10`). A module descriptor
exposes its navigation entries as [NavItem](#navitem) values, the `Assembly` holding its Razor pages so
the host can add it to `AdditionalAssemblies` for route discovery, and two defaulted collections of
component types to render in the app bar and at the root layout (`IUIModule.cs:13-22`). The registration
prologue is shared too: `AddUIModule<TModule>()` runs one Scrutor scan that picks up every
`IEntityService<,>` implementation in the module's assembly as scoped, then registers the descriptor as a
singleton (`DependencyInjection.cs:152-162`), so a module's own `Add{Module}UI()` no longer carries its
own copy of that scan and can still register services that must win afterwards.
[UIModuleConfiguration](#uimoduleconfiguration) lets a host switch a module off through
`Modules:{name}:Enabled`, defaulting to enabled when the section is absent
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/UIModuleConfiguration.cs:19-22`), and
[IHomePageContent](#ihomepagecontent) is the per-app landing-page hook behind the shared `/` route
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IHomePageContent.cs:8`). Adding a
feature module therefore wires its pages, its services, and its menu entries into the shell with no edit
to the shell. `[Rubric §18, UI Architecture]` and `[Rubric §1, SOLID]` (open/closed).

**A complete vertical slice shipped inside the framework: notifications.** Unlike the rest of the
package, which is base classes consumers extend, the `Notifications` area is a finished feature an app
switches on with one call. [NotificationUIModule](#notificationuimodule)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs:14`) contributes
a user-facing inbox nav entry plus an Organizer-gated push-notification entry
(`NotificationUIModule.cs:16-20`), the app-bar [NotificationBell](#notificationbell)
(`NotificationUIModule.cs:22`), and a root-layout listener component (`NotificationUIModule.cs:24`);
[NotificationInbox](#notificationinbox), [NotificationList](#notificationlist), and
[NotificationSend](#notificationsend) render it; [NotificationInboxService](#notificationinboxservice)
and [PushNotificationService](#pushnotificationservice) (behind
[INotificationInboxUIService](#inotificationinboxuiservice) and
[IPushNotificationUIService](#ipushnotificationuiservice)) call the API; and
[NotificationHubService](#notificationhubservice)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:26`)
holds the **SignalR** connection to the API's
[NotificationHub](group-10-notifications.md#notificationhub), retrying an initial connect up to 3 times
with doubling backoff and discarding a connection that never started so a later join is not blocked
forever (`NotificationHubService.cs:28,145-180`). The same connection carries ephemeral **live channel**
events: components join through `JoinChannelAsync` (`NotificationHubService.cs:192`), membership is
reference-counted per key by [ChannelReferenceCounter](#channelreferencecounter) so one subscriber
leaving does not cut the channel off for the others
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/ChannelReferenceCounter.cs:16`),
handlers are multicast through disposable [ChannelSubscription](#channelsubscription) handles
(`NotificationHubService.cs:412`), and every held channel is re-joined on `Reconnected` because SignalR
group membership does not survive a new connection (`NotificationHubService.cs:16-24`, `:143`). Which
notifications a user sees can be narrowed by [INotificationScopeProvider](#inotificationscopeprovider),
an app-supplied scope key such as `"event:2"` that both HTTP services consume so a send and the reads
that follow agree, defaulting to the unscoped
[NullNotificationScopeProvider](#nullnotificationscopeprovider) and contractually forbidden from
throwing, since a scope is a view filter and not a security boundary
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/INotificationScopeProvider.cs:9-21`).
Shared unread state lives in [NotificationState](#notificationstate), which also arbitrates a single
active-poller slot by owner reference rather than a counter, so a teardown that never unregisters cannot
strand the slot for the life of the circuit
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationState.cs:8,12-19`),
and the whole feature is wired by its own
[DependencyInjection](#dependencyinjection)`.AddNotificationUI()` in the `Notifications` namespace
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:20-42`), kept
separate so an app that does not want real-time notifications never pays for the SignalR plumbing.

**How it wires up at startup.** A host's `Program.cs` calls `AddUIShared(configuration)` once, a C#
`extension(IServiceCollection)` member (see [primer §4](00-primer.md#4-c-build-and-code-style-conventions))
on [DependencyInjection](#dependencyinjection)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:29-112`). In order it binds and
**validates on start** [ApiSettings](#apisettings), so a missing endpoint fails the host rather than the
first request (`DependencyInjection.cs:32-35`; the read-only face of those options is
[IApiSettings](#iapisettings), whose `WasmApiEndpoint` lets the server call an internal URL while the
browser is handed an external one,
`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/IApiSettings.cs:11-17`); binds
[LayoutSettings](#layoutsettings) *without* validation, deliberately optional so a host with no `Layout`
section still renders (`DependencyInjection.cs:38-39`); sets up localization and the pseudo/Mud localizer
decorators (`:42-55`); registers the auth and culture delegating handlers and the named `"APIClient"`
whose base address comes from `ApiSettings` and whose timeout is pinned to
[HttpResilienceDefaults](group-16-aspire-orchestration.md#httpresiliencedefaults)`.TotalRequestTimeout`
rather than the BCL's arbitrary 100s, so the transport never pre-empts the resilience budget
(`:59-82`); then `TryAdd`s [AuthUIService](#authuiservice), the list-page state services,
[NavigationHistoryService](#navigationhistoryservice), [ThemeService](#themeservice),
[EndpointCultureApplier](#endpointcultureapplier), the preference reader/writer, and a default
[IOAuthUISettings](#ioauthuisettings) ([DefaultOAuthUISettings](#defaultoauthuisettings)) that downstream
apps override with [ConfigurationOAuthUISettings](#configurationoauthuisettings), which reads provider
availability from the `OAuth` section for a server host and from pre-computed `Enabled` flags for a WASM
client (`:85-105`,
`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/ConfigurationOAuthUISettings.cs:13-28`);
and finally calls `AddDeviceCapabilityDefaults()` so every capability contract resolves on every head
(`:109`, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html),
chapter 26). The `TryAdd*` discipline is what lets a consumer pre-register its own implementation and
win. Browser hosts add `AddClientAuthSessionCookieSync()` (`:119-123`) and `AddWasmFormFactor()`
(`:131-132`); a Blazor Server head adds `AddCommonServerTokenStorage()`, `AddCommonBlazorCsp()` (before
`AddCommonSecurityHeaders`, so it beats the `TryAdd`ed static provider), and `AddCommonWebFormFactor()`
from `MMCA.Common.UI.Web`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:26-48`) plus the
`UseAuthenticatedNoStore()` middleware. [UISharedAssemblyReference](#uisharedassemblyreference)
(`DependencyInjection.cs:167`) is the marker other assemblies scan against.

The small Level-0 supporting cast fills in the rest: [NotificationRoutePaths](#notificationroutepaths)
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NotificationRoutePaths.cs:6`),
[QrErrorCorrectionLevel](#qrerrorcorrectionlevel), the framework's own enum for `QrCodeImage` so the
component's public API does not pin consumers to QRCoder's `ECCLevel`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/QrErrorCorrectionLevel.cs:9`), and
[MauiBackNavigationBridge](#mauibacknavigationbridge) with its
[BackNavigationResult](#backnavigationresult) for MAUI hardware-back handling, which reports both whether
`history.back()` fired and whether the WebView is at the root of its stack so a host can decide to exit
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/MauiBackNavigationBridge.cs:19,28`).
Form-factor detection has graduated into its own device-capability layer
([IFormFactor](group-26-device-capability-layer.md#iformfactor) and friends, chapter 26). The
presentational helper [MoneyExtensions](#moneyextensions) formats
[Money](group-02-domain-building-blocks.md#money) for display, grouping a mixed collection by currency so
unrelated amounts never collapse under whichever symbol came first
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Extensions/MoneyExtensions.cs:14,23-30`), keeping a
display concern out of the domain value object, exactly where Clean Architecture wants it.

Read the per-type sections that follow for the mechanics. The consumer-side module UIs live in the ADC
module-UI chapter ([chapter 21](group-21-conference-ui.md)), and the bUnit component tests plus the
Playwright/axe-core E2E suite that exercise this package are covered in the testing chapter
([chapter 27](group-27-testing-infrastructure.md)), which is where `[Rubric §28, Front-End Testing]`
lives.

### BreakpointConstants

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/BreakpointConstants.cs:9` · Level 0 · class (static)

- **What it is**: A single static helper that answers "is this viewport a mobile viewport?", so C# viewport detection lines up with the CSS media-query boundary used across the design system.
- **Depends on**: `MudBlazor.Breakpoint` (NuGet, imported at `BreakpointConstants.cs:1`); the CSS `@media` boundary in the shared stylesheet.
- **Concept introduced**: `[Rubric §22, Responsive & Cross-Browser]` assesses whether a codebase has one authoritative breakpoint definition rather than magic numbers scattered per component; this class embodies it by centralising the mobile/desktop split in one predicate. The doc comment (`BreakpointConstants.cs:11-15`) documents the threshold as "below the sidebar-collapse threshold (MudBlazor Xs or Sm, i.e. < 960 px)", so the C# side and the CSS side agree on one number.
- **Walkthrough**: The only member is `IsMobileBreakpoint(Breakpoint breakpoint)` (`BreakpointConstants.cs:16-17`), an expression-bodied method returning `true` when the MudBlazor breakpoint is `Xs` or `Sm`. That is the sole condition; anything `Md` or wider is treated as desktop.
- **Why it's built this way**: Static and dependency-free, so any Razor component can call it without DI, and so changing the mobile threshold is a one-line edit paired with one CSS rule rather than a hunt through component code.
- **Where it's used**: [DataGridListPageBase<TDto>](#datagridlistpagebasetdto) calls it from its viewport-change handler (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:267`) to set `IsMobile`, which is what swaps a desktop `MudDataGrid` for the mobile card layout.

---

### IApiSettings

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/IApiSettings.cs:6` · Level 0 · interface

- **What it is**: The read-only contract describing where the WebAPI backend lives, with a deliberate split between the URL the server uses and the URL served to the browser.
- **Depends on**: Nothing; implemented by [ApiSettings](#apisettings) and consumed by the HTTP-client setup in [DependencyInjection](#dependencyinjection).
- **Concept introduced**: `[Rubric §12, Performance & Scalability]` assesses whether the deployment can avoid unnecessary network hops; the dual-endpoint idea directly serves it. `ApiEndpoint` (`IApiSettings.cs:9`) is the base URL the host uses for its own calls, while `WasmApiEndpoint` (`IApiSettings.cs:17`) is the endpoint pushed to the WebAssembly client over `/client-config`. The doc comment (`IApiSettings.cs:11-16`) states the intent: the server may use an internal URL (faster, avoids public DNS) while the browser uses the external URL, and `WasmApiEndpoint` falls back to `ApiEndpoint` when null.
- **Walkthrough**: Two nullable string getters only, `ApiEndpoint` and `WasmApiEndpoint`. Both are `string?`, so the interface makes no promise that either is populated; validation lives on the concrete class.
- **Why it's built this way**: An interface (not the concrete class) is the read-only view HTTP-client configuration can bind against, keeping that setup decoupled from the options-binding mechanism and mockable in tests.
- **Where it's used**: [ApiSettings](#apisettings) implements it; the `/client-config` bootstrap serves `WasmApiEndpoint` to the browser.
- **Caveats / not-in-source**: [DependencyInjection](#dependencyinjection) `AddUIShared` registers a single named `"APIClient"` HttpClient whose factory reads the concrete `ApiSettings.ApiEndpoint` (`DependencyInjection.cs:63-71`). The `WasmApiEndpoint` fallback and its delivery to the browser happen outside this method (the `/client-config` endpoint), so this file defines the contract, not the two-endpoint wiring.

---

### IHomePageContent

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IHomePageContent.cs:8` · Level 0 · interface

- **What it is**: A hook that lets each consuming application supply its own landing-page component at the `/` route without forking the shared routing or layout.
- **Depends on**: `Microsoft.AspNetCore.Components.DynamicComponent` (named in the doc comment, `IHomePageContent.cs:6`) and each app's own landing-page Razor component.
- **Concept introduced**: `[Rubric §18, UI Architecture]` assesses how well shared UI infrastructure adapts to per-app content without duplication; this interface embodies it. The `/` route is declared once in the shared package (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Home.razor:1`), which injects `IEnumerable<IHomePageContent>` (`Home.razor:3`) and renders a `DynamicComponent` bound to the resolved type (`Home.razor:10`). A new app plugs in a home page by registering an implementation, not by editing the route.
- **Walkthrough**: Two read-only members: `ComponentType` (`IHomePageContent.cs:11`), the `System.Type` of the Razor component to render as the home-page body, and `PageTitle` (`IHomePageContent.cs:14`), the browser-tab title. Because `ComponentType` is a runtime `Type` handed to `DynamicComponent`, the shared page needs no compile-time reference to the app-specific component.
- **Why it's built this way**: Runtime `Type` binding keeps the shared package free of any dependency on downstream landing pages, which is what allows [DataGridListPageBase<TDto>](#datagridlistpagebasetdto) and the rest of the shared UI to ship as a NuGet package rather than as app source.
- **Where it's used**: Implemented per app and per head, for example `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs` and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/Pages/StoreHomePageContent.cs`.

---

### LayoutSettings

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/LayoutSettings.cs:7` · Level 0 · class (sealed)

- **What it is**: Strongly-typed options for light white-labeling: the navbar brand text and the footer text, bound from the `"Layout"` configuration section.
- **Depends on**: `Microsoft.Extensions.Configuration` (via options binding in [DependencyInjection](#dependencyinjection)); the shared navbar and footer components.
- **Concept introduced**: `[Rubric §10, Cross-Cutting Concerns]` assesses whether presentation constants are externalised rather than hard-coded; this class embodies it by moving brand and footer copy into configuration.
- **Walkthrough**: `SectionName = "Layout"` (`LayoutSettings.cs:10`) names the bound section. `BrandName` (`LayoutSettings.cs:13`) defaults to `"MMCA"` and shows in the top-left navbar link; `FooterText` (`LayoutSettings.cs:16`) defaults to `string.Empty`. Both are `init`-only.
- **Why it's built this way**: Sealed and `init`-only for immutability after binding; the defaults mean a host with no `Layout` section still renders sensibly, so rebranding is a config change rather than a code change.
- **Where it's used**: Bound in [DependencyInjection](#dependencyinjection) `AddUIShared` (`DependencyInjection.cs:38-39`), deliberately without validation; read by navbar and footer components through `IOptions<LayoutSettings>`.

---

### NavSection

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NavSection.cs:7` · Level 0 · enum

- **What it is**: Classifies a navigation entry into one of three sidebar groups by audience: everyone, authenticated users, or administrators.
- **Depends on**: Nothing; consumed by [NavItem](#navitem) and the shared nav menu.
- **Concept introduced**: `[Rubric §25, Navigation & Information Architecture]` assesses whether the menu structure is audience-aware and declarative; this enum embodies it. `[Rubric §11, Security]` also touches it, since section membership feeds the role-gated rendering of the sidebar, but note that the enum is a grouping hint, not an authorization check: the real gate is `RequiredRole`/`RequiredClaim` on [NavItem](#navitem) plus server-side authorization on the target page.
- **Walkthrough**: Three values in declaration order: `General` (`NavSection.cs:10`) for anonymous plus authenticated items, `User` (`NavSection.cs:13`) for authenticated non-admin items, and `Admin` (`NavSection.cs:16`) for admin and organizer items. The doc comment (`NavSection.cs:5`) states sections render in enum declaration order, so the ordering here is an implicit rendering contract.
- **Why it's built this way**: An enum (not a string) gives exhaustive switch coverage in the renderer and rules out typos when a module registers a nav item.
- **Where it's used**: The `Section` parameter of [NavItem](#navitem); `MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/NavMenu.razor` groups and filters items by it.

---

### NotificationRoutePaths

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NotificationRoutePaths.cs:6` · Level 0 · class (static)

- **What it is**: The route-path constants for the notification UI feature: the notifications list, the admin send page, and the inbox.
- **Depends on**: Nothing; referenced by the notification pages and by the notification module's nav registration.
- **Concept introduced**: Same "one source of truth for route strings" idea as [RoutePaths](#routepaths); this class is the notification-scoped instance of it, following the convention stated in `RoutePaths.cs:5` that module-specific paths live in their own `*RoutePaths` class.
- **Walkthrough**: Three `static readonly` strings: `Notifications = "/notifications"` (`NotificationRoutePaths.cs:8`), `NotificationSend = "/notifications/send"` (`NotificationRoutePaths.cs:9`), and `NotificationInbox = "/notifications/inbox"` (`NotificationRoutePaths.cs:10`).
- **Why it's built this way**: Kept separate from [RoutePaths](#routepaths) so an app that never enables the notification module carries no irrelevant constants, and so notification routes evolve independently of the shared set.
- **Where it's used**: The notification page code-behinds (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationList.razor.cs`, `.../NotificationSend.razor.cs`), the `NotificationBell` component, and `MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs` when it builds its [NavItem](#navitem) list.

---

### QrErrorCorrectionLevel

> MMCA.Common.UI · `MMCA.Common.UI.Components` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/QrErrorCorrectionLevel.cs:9` · Level 0 · enum

- **What it is**: The framework's own four-level error-correction scale for the `QrCodeImage` component, mirroring the QR standard's L/M/Q/H levels without exposing the encoder library's type.
- **Depends on**: Nothing at compile time; mapped onto `QRCoder.QRCodeGenerator.ECCLevel` inside the component (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/QrCodeImage.razor:77-83`).
- **Concept introduced**: `[Rubric §32, Dependency & Supply-Chain]` assesses whether third-party types leak into your public surface; this enum is a textbook anti-leak. The class comment (`QrErrorCorrectionLevel.cs:6-7`) says so outright: it is "declared as a framework enum rather than exposing QRCoder's own `ECCLevel`, so the component's public API does not pin consumers to the encoder package". `[Rubric §9, API & Contract Design]` applies for the same reason: swapping encoders becomes a change to one `switch`, not a break for every caller.
- **Walkthrough**: Four explicitly numbered members with the recovery percentage documented on each: `Low = 0` (about 7% recovery, densest code, `QrErrorCorrectionLevel.cs:12`), `Medium = 1` (about 15%, documented as the default, `:15`), `Quartile = 2` (about 25%, for printed sheets, `:18`), and `High = 3` (about 30%, for logo-overlaid or poorly-lit scans, `:21`). The trade-off in the type comment is the teaching point: higher levels survive more damage but pack fewer characters into the same module count, so the code grows denser.
- **Why it's built this way**: Explicit numeric values keep the enum stable if members are ever reordered, and the mapping method's `switch` uses `_ => ECCLevel.M` as its default arm (`QrCodeImage.razor:82`), so an unmapped value degrades to Medium rather than throwing at render time.
- **Where it's used**: The `ErrorCorrection` parameter of `QrCodeImage` (`QrCodeImage.razor:36`), defaulted to `Medium`; covered by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Components/QrCodeImageTests.cs` and exercised by ADC's speaker QR page tests.

---

### RoutePaths

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/RoutePaths.cs:7` · Level 0 · class (static)

- **What it is**: The shared route-path constants owned by the common UI package. Module-specific routes stay in their own `*RoutePaths` classes.
- **Depends on**: Nothing; referenced by `NavigationManager.NavigateTo` calls across the shared UI.
- **Concept introduced**: `[Rubric §25, Navigation & Information Architecture]` also covers URL and route hygiene; centralising cross-cutting routes here keeps literal path strings from scattering across components.
- **Walkthrough**: Currently one member, `Home = "/"` (`RoutePaths.cs:9`), a `static readonly` string. The class comment (`RoutePaths.cs:4-5`) states the intent: centralized paths shared across all UI modules and hosts, with module-specific paths kept elsewhere.
- **Why it's built this way**: `static readonly` (rather than `const`) is enough because these strings are used in navigation calls, not in attribute arguments; note the consequence, that a `@page` directive still needs its own literal, so `Home.razor:1` writes `@page "/"` directly and this constant covers the navigation side only.
- **Where it's used**: Navigation to the home route across the shared UI and the consuming hosts.

---

### UIModuleConfiguration

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/UIModuleConfiguration.cs:10` · Level 0 · class (static)

- **What it is**: A configuration reader that answers "is this UI module enabled?" against the same `Modules` section the server layer uses, so UI registration and server registration stay in step.
- **Depends on**: `Microsoft.Extensions.Configuration.IConfiguration` (`UIModuleConfiguration.cs:1`); conceptually paired with the Application layer's [ModulesSettings](group-14-module-system-composition.md#modulessettings), which reads the same section.
- **Concept introduced**: `[Rubric §10, Cross-Cutting Concerns]` assesses whether a single toggle governs a concern end to end; this helper embodies it by reading `Modules:{name}:Enabled` so there is one switch, not a server switch plus a separate UI switch.
- **Walkthrough**: `ModulesSectionName = "Modules"` (`UIModuleConfiguration.cs:12`) is the private section name. `IsModuleEnabled(IConfiguration configuration, string moduleName)` (`UIModuleConfiguration.cs:18`) resolves `Modules:{moduleName}` (`:20`) and returns `!section.Exists() || section.GetValue("Enabled", true)` (`:21`). Read that literally: a missing section is enabled, a present section with no `Enabled` key is enabled, and only an explicit `Enabled: false` turns a module off.
- **Why it's built this way**: Static because it is a pure configuration read with no DI dependency; default-enabled preserves backward compatibility for deployments that predate a `Modules` section (`UIModuleConfiguration.cs:7-8`).
- **Where it's used**: Every UI host guards its per-module registration with it, for example `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:79-88` (Identity, Conference, Engagement, Notification) and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:120-126` (Catalog, Sales, Identity), with the same guards repeated in the WASM client and MAUI heads.

---

### UISharedAssemblyReference

> MMCA.Common.UI · `MMCA.Common.UI` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:167` · Level 0 · class

- **What it is**: An empty marker class whose only purpose is to give code a stable `typeof(...).Assembly` handle on the shared UI assembly for reflection-based scanning.
- **Depends on**: Nothing.
- **Concept introduced**: The assembly-marker pattern. Rather than passing a fragile assembly-name string, code references a known type in the target assembly and reads `.Assembly` off it. Each layer in the framework ships an equivalent marker; this is the UI layer's, and its doc comment (`DependencyInjection.cs:166`) names Scrutor scanning as the motivating case.
- **Walkthrough**: A one-line declaration using the semicolon type body, `public class UISharedAssemblyReference;` (`DependencyInjection.cs:167`). It shares a file with the [DependencyInjection](#dependencyinjection) extension class but is declared at namespace scope beneath it, outside that class.
- **Why it's built this way**: A dedicated marker type makes assembly-scanning call sites refactor-safe (the compiler tracks the type reference) and self-documenting, and keeping it type-only means it carries no state anyone can accidentally depend on.
- **Where it's used**: Assembly-scanning registrations that need to enumerate types in `MMCA.Common.UI`. Note the contrast with `AddUIModule<TModule>` (`DependencyInjection.cs:152`), which takes the scan root from the module descriptor's own assembly rather than from a marker.

---

### ApiSettings

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/ApiSettings.cs:9` · Level 1 · class (sealed)

- **What it is**: The concrete options object bound to the `"Api"` configuration section and the sole implementation of [IApiSettings](#iapisettings).
- **Depends on**: [IApiSettings](#iapisettings); `System.ComponentModel.DataAnnotations` (`ApiSettings.cs:1`) for the `[Required]` attribute.
- **Concept introduced**: `[Rubric §33, Developer Experience]` assesses fail-fast configuration; this class embodies it. `ApiEndpoint` (`ApiSettings.cs:16`) carries `[Required]` (`ApiSettings.cs:15`), and because [DependencyInjection](#dependencyinjection) binds it with `.ValidateDataAnnotations().ValidateOnStart()` (`DependencyInjection.cs:34-35`), a missing endpoint fails the host at startup rather than at the first HTTP call, with a message that names the setting.
- **Walkthrough**: `SectionName = "Api"` (`ApiSettings.cs:12`) names the bound section. `ApiEndpoint` is an `init` string carrying the `[Required]` attribute; `WasmApiEndpoint` (`ApiSettings.cs:19`) is an optional `init` string that inherits its documentation from the interface via `<inheritdoc />`.
- **Why it's built this way**: Sealed and `init`-only for immutability after binding; putting the validation attribute on the concrete class (not the interface, which cannot carry it) is what lets the DI layer opt into startup validation.
- **Where it's used**: Bound and validated in [DependencyInjection](#dependencyinjection) `AddUIShared` (`DependencyInjection.cs:32-35`) and read via `IOptions<ApiSettings>` inside the `"APIClient"` factory when it sets the base address (`DependencyInjection.cs:65-71`).
- **Caveats / not-in-source**: `[Required]` on a `string?` rejects null and, under `ValidateDataAnnotations`, an empty string, but it does not check that the value parses as an absolute URI. That second check is the HttpClient factory's, which throws `InvalidOperationException` on a blank endpoint (`DependencyInjection.cs:66-69`) and then constructs `new Uri(..., UriKind.Absolute)` (`:71`).

---

### NavItem

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NavItem.cs:17` · Level 1 · record

- **What it is**: An immutable description of one sidebar entry a UI module contributes: title, href, icon, optional role and claim gates, its [NavSection](#navsection), an optional collapsible group, and an optional localization resource type.
- **Depends on**: [NavSection](#navsection); `System.Type` (BCL) for the optional resource type.
- **Concept introduced**: `[Rubric §25, Navigation & Information Architecture]` assesses modular, role-aware navigation; `NavItem` embodies it because modules contribute items and the sidebar renders them filtered by role and claim, mirroring the server-side [IModule](group-14-module-system-composition.md#imodule) "modules contribute their own surface" pattern. `[Rubric §27, Internationalization]` also applies: the record supports localized menu titles ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Walkthrough**: A positional record with eight parameters, all on one line (`NavItem.cs:17`): `Title`, `Href`, `Icon`, then `RequiredRole = null` (render only for users in that role), `RequiredClaim = null` (render only for users with that claim type), `Section = NavSection.General`, `Group = null` (nest inside a collapsible `MudNavGroup`), and `TitleResource = null`. The doc comment (`NavItem.cs:9-15`) spells out the localization rule: when `TitleResource` is set, `Title` and `Group` are treated as resource KEYS resolved against that resource type at render time (per-circuit, so the menu follows the active culture); when the key is missing, or `TitleResource` is null, the raw string renders as before, so literal-titled items keep working unchanged.
- **Why it's built this way**: A record gives value semantics and concise construction from a module's item list; making localization opt-in through a nullable `TitleResource` is what let [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) land without touching a single existing registration.
- **Where it's used**: Returned from the `NavItems` property of every [IUIModule](#iuimodule) implementation; rendered by `MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/NavMenu.razor`.
- **Caveats / not-in-source**: `RequiredRole` and `RequiredClaim` control rendering only. They hide a link; they do not authorize the destination. Page-level and API-level authorization remain the enforcing gates.

---

### IEntityService<TEntityDTO, TIdentifierType>

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IEntityService.cs:12` · Level 2 · interface

- **What it is**: The generic CRUD service contract every UI module page injects to talk to its API endpoints, so components depend on a typed abstraction rather than raw `HttpClient` calls.
- **Depends on**: [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (the `TEntityDTO` constraint at `IEntityService.cs:13`) and [BaseLookup<TIdentifierType>](group-12-api-hosting-mapping.md#baselookuptidentifiertype) (the lookup return type, `:33`), both from `MMCA.Common.Shared.DTOs` (`IEntityService.cs:1`); implemented by [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype).
- **Concept introduced**: `[Rubric §18, UI Architecture]` assesses clean separation between components and their data access; this interface embodies it. `[Rubric §9, API & Contract Design]` also applies, since the member set mirrors the REST surface the API exposes (list, paged query, lookup, get-by-id, create, update, delete). Note the layering rule this respects: `MMCA.Common.UI` may reference `MMCA.Common.Shared` only, which is why the DTO constraints come from `Shared` and not from Application or Domain. Two generic constraints (`IEntityService.cs:13-14`) bind the DTO to [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) and require `TIdentifierType : notnull`.
- **Walkthrough**: Seven async members, every one taking a trailing `CancellationToken` with a default.
  - `GetAllAsync` (`IEntityService.cs:17`) returns a nullable list, with `includeFKs` and `includeChildren` flags that map to API query options.
  - `GetPagedAsync` (`:23`) takes a `Dictionary<string, (string Operator, string Value)>` of dynamic filters plus page number, page size, sort column, and sort direction, and returns an `(Items, TotalItems)` tuple. That tuple is what makes server-side paging possible: the grid needs the total to size its pager without fetching the rest.
  - `GetAllForLookupAsync` (`:33`) takes the name property to project and returns lightweight `Id + Name` [BaseLookup<TIdentifierType>](group-12-api-hosting-mapping.md#baselookuptidentifiertype) items for dropdowns and autocompletes.
  - `GetByIdAsync` (`:38`) returns `null` on a 404 rather than throwing, so a page can render a not-found state without exception handling.
  - `AddAsync` (`:44`) returns the server-assigned DTO including its generated id; `UpdateAsync` (`:49`) and `DeleteAsync` (`:54`) return `bool` success.
- **Why it's built this way**: An interface keeps Blazor components testable (mock the service, no HTTP) and hides the API URL structure behind a typed surface. The paged signature exists so grids never fetch a whole table; the deliberate asymmetry (nullable list for get-all, `bool` for mutations) matches what the HTTP responses actually carry.
- **Where it's used**: Implemented by [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype); consumed by every module's CRUD page, including those built on [DataGridListPageBase<TDto>](#datagridlistpagebasetdto). `AddUIModule<TModule>` (`DependencyInjection.cs:155-159`) is what registers the implementations: a Scrutor scan over the module assembly picks up every class assignable to `IEntityService<,>` and registers it scoped as its implemented interfaces.

---

### IUIModule

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IUIModule.cs:10` · Level 2 · interface

- **What it is**: The UI-side counterpart to the server [IModule](group-14-module-system-composition.md#imodule). Each pluggable UI module declares its navigation, its assembly (for Blazor route discovery), and optional components it injects into the app bar and root layout.
- **Depends on**: [NavItem](#navitem); `System.Reflection.Assembly` (`IUIModule.cs:1`).
- **Concept introduced**: `[Rubric §18, UI Architecture]` assesses pluggable, discoverable UI composition; this interface embodies it. The Blazor host feeds each module's `Assembly` to `AddAdditionalAssemblies` so `@page` routes in that assembly are discovered at runtime, mirroring how the server discovers [IModule](group-14-module-system-composition.md#imodule) implementations. `[Rubric §25, Navigation & Information Architecture]` also applies, since nav items are contributed by modules rather than hard-coded in the layout.
- **Walkthrough**: `NavItems` (`IUIModule.cs:13`) is the module's list of [NavItem](#navitem) entries for the shared sidebar. `Assembly` (`IUIModule.cs:16`) is the Razor-component assembly used for route discovery. `AppBarComponentTypes` (`:19`) and `LayoutComponentTypes` (`:22`) are default interface members returning an empty collection expression (`[]`), so a module only overrides them when it contributes app-bar widgets (a cart icon, for example) or root-layout overlays (drawers).
- **Why it's built this way**: Default interface members mean a simple module implements two properties, not four; the assembly handle keeps route discovery reflection-based, so adding a module never requires a central route edit.
- **Where it's used**: Implemented by each app's UI module descriptors (Conference, Engagement, Identity, and the framework's own `NotificationUIModule` at `MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs`). Registered as a singleton by `AddUIModule<TModule>` (`DependencyInjection.cs:161`), which constrains `TModule : class, IUIModule` (`:153`); each module's own `Add{Module}UI()` is usually a one-liner over it, for example `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/DependencyInjection.cs:19`.

---

### MobileInfiniteScrollList<TItem>

> MMCA.Common.UI · `MMCA.Common.UI.Components` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/MobileInfiniteScrollList.razor.cs:17` · Level 5 · class (partial, Razor code-behind)

- **What it is**: The mobile counterpart to a desktop data grid: a card list that loads the next page when the user scrolls a sentinel element into view, caps how many items ever reach the DOM, and survives filter changes without leaking stale rows into the new result set.
- **Depends on**: `Microsoft.AspNetCore.Components` (`ComponentBase`, `RenderFragment<T>`, `ElementReference`), `Microsoft.JSInterop` (`IJSRuntime`, `IJSObjectReference`, `DotNetObjectReference`, `JSDisconnectedException`), `MudBlazor` (`ISnackbar`, `Icons`), `Microsoft.Extensions.Localization` with [SharedResource](#sharedresource) for its failure message, and the `infinite-scroll.js` module shipped as a static web asset at `./_content/MMCA.Common.UI/infinite-scroll.js` (`MobileInfiniteScrollList.razor.cs:86`).
- **Concept introduced**: **Generation-guarded supersession**, and it is worth learning here because it is the general answer to "an async result came back after the world changed". `[Rubric §23, Front-End Performance]` assesses bounded DOM growth and incremental loading; `[Rubric §19, State Management]` assesses correctness of in-flight async state; `[Rubric §24, Forms, Validation & UX Safety]` assesses whether failures surface as recoverable UI rather than as a crash or a spinner that never stops. All three converge in `LoadNextPageAsync`. The trap the code names explicitly (`:154-156`): `FetchPage` is consumer-supplied and may ignore the `CancellationToken` entirely, so cancellation alone cannot be trusted; the integer generation counter is authoritative.
- **Walkthrough**:
  - **Injected services** (`:19-21`): `IJSRuntime` for the observer interop, `ISnackbar` for the failure toast, and `IStringLocalizer<SharedResource>` for its text.
  - **Parameters** (`:23-43`): `CardTemplate` and `FetchPage` are both `[EditorRequired]`; `FetchPage` is a `Func<int, int, CancellationToken, Task<(IReadOnlyList<TItem> Items, int TotalItems)>>`, the same page/size/total shape [IEntityService<TEntityDTO, TIdentifierType>](#ientityservicetentitydto-tidentifiertype)`.GetPagedAsync` returns. `PageSize` defaults to 10 (`:30`), `EmptyMessage` is nullable so the shared empty-state component can fall back to its localized default (`:33-34`, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)), `EmptyIcon` defaults to `Icons.Material.Outlined.SearchOff` (`:36`), and `MaxRenderedItems` defaults to 500 (`:43`), the cap that bounds DOM and memory growth.
  - **State fields** (`:45-65`): the item list, `_totalCount`, `_currentPage`, the `_generation` counter (`:53`), the `_isInitialLoad`/`_isLoadingMore`/`_hasMore`/`_loadError` flags, the sentinel `ElementReference`, the JS module and `DotNetObjectReference` handles, a per-instance `_observerId` from `Guid.NewGuid().ToString("N")` (`:62`), the current `CancellationTokenSource`, and `_observerAttached`/`_disposed`.
  - **Lifecycle**: `OnInitializedAsync` (`:67`) loads page 1 then clears `_isInitialLoad`. `OnAfterRenderAsync` (`:73`) attaches the observer only once every precondition holds: not disposed, more pages exist, not already attached, at least one item rendered (the sentinel must exist), and the initial load is done.
  - **Interop**: `AttachObserverAsync` (`:81`) lazily imports the JS module and calls `observe(dotNetRef, sentinelRef, observerId)`; `DetachObserverAsync` (`:97`) calls `unobserve(observerId)`. Both swallow `JSDisconnectedException` (`:91`, `:105`), which is the expected outcome during prerendering and shutdown when the circuit is already gone.
  - **`OnSentinelVisible`** (`:114-127`) is the `[JSInvokable]` callback. It early-returns when a load is in flight, no pages remain, or the component is disposed, then marshals back onto the renderer's synchronization context via `InvokeAsync` before loading and calling `StateHasChanged`.
  - **`LoadNextPageAsync`** (`:129`) is the heart. It snapshots `int generation = _generation` (`:141`), publishes a fresh `CancellationTokenSource`, and computes `targetPage = _currentPage + 1` **without committing it** (`:148`): the counter only advances on a successful, non-superseded completion (`:162`), so a cancelled, failed, or superseded fetch leaves nothing to compensate and never re-requests a page. After awaiting `FetchPage`, it checks `_disposed || generation != _generation` (`:157`) and drops the results if the world moved. `_hasMore` is then `_items.Count < _totalCount && _items.Count < MaxRenderedItems` (`:168`), the line that enforces the cap. `OperationCanceledException` is swallowed as expected (`:170-173`); any other exception sets `_loadError` and, only on the initial load, raises a localized snackbar via `L["Grid.Snackbar.LoadFailed"]` (`:187`), deliberately not the raw exception text (neither translatable nor safe to surface). The `finally` block (`:190-206`) is guarded twice: `_isLoadingMore` is cleared only by the current generation (`:192`), and the token source is disposed only when `ReferenceEquals(_cts, cts)` still holds (`:199`), since a resetter that superseded this load already disposed the one it took over.
  - **`ResetAsync`** (`:219`) is the public entry point for a filter or search change. Order matters: bump `_generation` first (`:223`) so any awaiting fetch is already superseded, then cancel and dispose the stale token source (`:228-232`), then clear `_isLoadingMore` by hand (`:237`, because the superseded load will not clear it), then reset the list and all counters, detach the observer, render the cleared state, and reload page 1.
  - **`DisposeAsync`** (`:256`) is idempotent via `_disposed`, cancels and disposes the token source, detaches the observer, disposes the JS module inside a `JSDisconnectedException` guard, and disposes the `DotNetObjectReference`.
- **Why it's built this way**: An `IntersectionObserver` in JS is far cheaper than a Blazor scroll-event handler round-tripping over a circuit, and the DOM cap turns "infinite" into something bounded (`:38-42`). Every guard has a failure it prevents, and the source comments name them, which is why this component reads as a small case study in async UI correctness rather than as boilerplate.
- **Where it's used**: The mobile branch of every list page: ADC's session, speaker, room, event, question, sponsor, conference-category and user lists plus the check-in attendee search panel, and Store's product, category, order, inventory-item, shopping-cart and customer lists. It is also rendered in `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Pages/ComponentsGallery.razor` (the backend-less gallery the CI accessibility scan drives) and covered by [MobileInfiniteScrollListTests](group-27-testing-infrastructure.md#mobileinfinitescrolllisttests) `[Rubric §28, Front-End Testing]`.
- **Caveats / not-in-source**: `RetryAsync` (`:209`) is private and invoked from the `.razor` markup, not from this file, so the retry affordance itself (button, placement, text) is not visible in the code-behind.

---

### DependencyInjection

> MMCA.Common.UI · `MMCA.Common.UI` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:21` · Level 7 · class (static, with an `extension(IServiceCollection)` block)

- **What it is**: The one-call registration surface every UI host (Blazor Server, WebAssembly, MAUI) invokes to wire the shared UI infrastructure (settings, localization, the authenticated HttpClient, auth and state services, theme, culture, per-user preferences, device capabilities), plus the per-module registration helper each `Add{Module}UI()` delegates to.
- **Depends on**: [ApiSettings](#apisettings) and [LayoutSettings](#layoutsettings); [PseudoStringLocalizerFactory](#pseudostringlocalizerfactory) and [ResxMudLocalizer](#resxmudlocalizer); [AuthDelegatingHandler](#authdelegatinghandler) and [CultureDelegatingHandler](#culturedelegatinghandler); [IAuthUIService](#iauthuiservice), [ListPageStateService](#listpagestateservice), [ListPageQueryStateService](#listpagequerystateservice), [NavigationHistoryService](#navigationhistoryservice), [ThemeService](#themeservice), [ICultureApplier](#icultureapplier), [IOAuthUISettings](#ioauthuisettings), [ISessionCookieSync](#isessioncookiesync); [IFormFactor](group-26-device-capability-layer.md#iformfactor) and [WasmFormFactor](group-26-device-capability-layer.md#wasmformfactor); [HttpResilienceDefaults](group-16-aspire-orchestration.md#httpresiliencedefaults) from `MMCA.Common.Shared.Resilience`; [IUIModule](#iuimodule) and [IEntityService<TEntityDTO, TIdentifierType>](#ientityservicetentitydto-tidentifiertype); Scrutor, plus `Microsoft.Extensions.{Configuration, DependencyInjection, Localization, Options}`.
- **Concept introduced**: This is the composition root for the UI layer, and it uses the C# preview `extension(IServiceCollection services)` block (`DependencyInjection.cs:23`) rather than classic `this`-parameter extension methods (see [primer](00-primer.md#c-extensiont-types-read-this-once)). `[Rubric §15, Best Practices & Code Quality]` (one consistent DI idiom across every layer) and `[Rubric §33, Developer Experience]` (fail-fast startup, one call per host) both apply; `[Rubric §27, Internationalization]` and `[Rubric §20, Design System & Theming]` apply through the localization, culture and theme registrations ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html), [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)).
- **Walkthrough**: Four methods live in the extension block.
  - **`AddUIShared(IConfiguration configuration)`** (`:29`) binds [ApiSettings](#apisettings) with `.ValidateDataAnnotations().ValidateOnStart()` so a missing `ApiEndpoint` fails startup (`:32-35`), and binds [LayoutSettings](#layoutsettings) without validation because empty defaults are acceptable (`:38-39`). It calls `AddLocalization()` (`:42`) for `IStringLocalizer<T>`, then `Decorate<IStringLocalizerFactory, PseudoStringLocalizerFactory>()` (`:49`), registered unconditionally because the pseudo-locale transform is inert under every other culture ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) §8). `TryAddTransient<MudBlazor.MudLocalizer, ResxMudLocalizer>()` (`:55`) localizes MudBlazor's own component text; the comment (`:51-54`) explains why `TryAdd` is authoritative here, namely that `AddMudServices` registers no `MudLocalizer` of its own and a DI resolution test guards that assumption. Both delegating handlers register as transient (`:59-60`), then the named `"APIClient"` HttpClient (`:63`): its factory reads `IOptions<ApiSettings>`, throws `InvalidOperationException` when the endpoint is blank (`:66-69`), sets the absolute base address (`:71`), pins `client.Timeout` to `HttpResilienceDefaults.TotalRequestTimeout` (`:77`) so the transport never pre-empts the resilience budget mid-policy the way the BCL's arbitrary 100s default would (`:73-76`), clears default headers and adds `Accept: application/json` (`:78-79`), and chains [AuthDelegatingHandler](#authdelegatinghandler) then [CultureDelegatingHandler](#culturedelegatinghandler) (`:81-82`) so every outgoing call carries both the bearer token and the active UI culture as `Accept-Language`. A run of `TryAdd` calls follows so multiple composing hosts cannot double-register: [IAuthUIService](#iauthuiservice) (`:85`), [ListPageStateService](#listpagestateservice) and [ListPageQueryStateService](#listpagequerystateservice) (`:86-87`), [NavigationHistoryService](#navigationhistoryservice) (`:88`), [ThemeService](#themeservice) (`:91`, [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)), [ICultureApplier](#icultureapplier) defaulting to the endpoint-based applier (`:97`), the per-user preference writer and reader (`:100-101`), and a default no-op `IOAuthUISettings` (`:105`). It ends with `AddDeviceCapabilityDefaults()` (`:109`, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)) so every capability contract resolves on every head.
  - **`AddClientAuthSessionCookieSync()`** (`:119`) does one `TryAddScoped<ISessionCookieSync, JsFetchSessionCookieSync>()` (`:121`), the bridge that mirrors the client's in-memory tokens into the HttpOnly cookie read during server-side SSR prerender. Both the Blazor Server head and the WASM client call it.
  - **`AddWasmFormFactor()`** (`:131-132`) registers `IFormFactor -> WasmFormFactor` as a singleton; the doc comment (`:126-129`) names the alternatives, `AddCommonWebFormFactor()` on the Blazor Server head and `AddMauiFormFactor()` on the MAUI head.
  - **`AddUIModule<TModule>()`** (`:152`), constrained to `TModule : class, IUIModule` (`:153`), is the two-step prologue every module's own `Add{Module}UI()` opens with: a Scrutor scan `FromAssemblyOf<TModule>()` that registers every `IEntityService<,>` implementation scoped as its implemented interfaces (`:155-159`), then `AddSingleton<IUIModule, TModule>()` (`:161`). The doc comment (`:140-146`) explains the deliberate boundary: module-specific services stay with the caller afterwards, so a module whose service must beat a shared default still controls its own registration order.
- **Why it's built this way**: `TryAdd` throughout makes these methods safe to call from several composing hosts, and it is also the override mechanism, since a host that registers its own implementation before `AddUIShared` wins. Two ordering choices are called out in comments and are load-bearing in the opposite direction: [ICultureApplier](#icultureapplier)'s default round-trips a server `/culture/set` endpoint that a MAUI hybrid head does not have, so hybrids override it **after** `AddUIShared` (`:93-96`), and device-capability defaults register first precisely so MAUI and browser heads can override them afterwards under last-registration-wins (`:107-108`).
- **Where it's used**: Called once at startup by every consuming UI host (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs`, `.../MMCA.ADC.UI.Web.Client/Program.cs`, `.../MMCA.ADC.UI/MauiProgram.cs`, and the three Store equivalents), immediately followed by the per-module `Add{Module}UI()` calls that `UIModuleConfiguration.IsModuleEnabled` guards. The `"APIClient"` it configures is the client every [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype)-derived service resolves.

### ForgotPasswordModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ForgotPasswordModel.cs:9` · Level 0 · class (sealed)

- **What it is**: the `EditForm` backing model for the Forgot Password page, a single `Email` string carrying DataAnnotations for shape validation. Nothing else is collected, because nothing else is needed to start a reset.
- **Depends on**: `System.ComponentModel.DataAnnotations` (BCL): `[Required]`, `[EmailAddress]`. Nothing first-party.
- **Concept introduced, validation deliberately capped at "shape" because of an anti-enumeration contract.** `[Rubric §24, Forms, Validation & UX Safety]` (assesses whether a form gives a clear per-field verdict before submit) and `[Rubric §26, Front-End Security]` (assesses whether the front end avoids leaking information the back end withholds). Every other form in this group validates as much as it can client-side. This one deliberately stops at "is this a syntactically valid address", because the interesting question, does an account exist for it, is one the server refuses to answer: [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) Decision 3 has `ForgotPasswordHandlerBase` return success on *every* path (malformed address, no account, throttled, failed send), so a distinguishable client-side outcome would reintroduce exactly the account-enumeration oracle the endpoint is built to avoid. The doc comment (`ForgotPasswordModel.cs:5-8`) states that trade-off directly.
- **Walkthrough**: one `get; set;` property. `Email` (line 13) carries `[Required(ErrorMessage = "Email is required")]` and `[EmailAddress(ErrorMessage = "Enter a valid email address")]` (lines 11-12) and defaults to `string.Empty`.
- **Why it's built this way**: `sealed` and mutable (`set`, not `init`) because `EditForm` two-way-binds the input to the model; keeping the model to one field is what makes the page's anti-enumeration behavior easy to reason about, there is no second field whose validation could betray a lookup.
- **Where it's used**: instantiated as `_model` by `ForgotPassword.razor` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ForgotPassword.razor:66`) and bound by its `<EditForm Model="_model" OnValidSubmit="HandleRequestAsync">` + `<DataAnnotationsValidator />` (lines 34-35), with the field wired `For="@(() => _model.Email)"` at line 37 so the message attaches to that input. On valid submit `HandleRequestAsync` (lines 73-90) calls [`IAuthUIService`](#iauthuiservice)`.RequestPasswordResetAsync(_model.Email)` (line 79, contract at `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/IAuthUIService.cs:41`) inside a `try` whose `catch` is empty on purpose (lines 81-84) and whose `finally` sets `_isSubmitted = true` unconditionally (line 88), so the success alert (line 23) renders for every submitted address whether the call succeeded, failed, or threw. The page is reached from the "forgot password" link on the Login page (`Login.razor:64`).
- **Caveats / not-in-source**: `RequestPasswordResetAsync` returns `bool`, and the call site ignores it (line 79); that is the anti-enumeration rule, not an oversight, and the gallery E2E test pins it by asserting the confirmation appears against a stub service that always answers "not accepted" (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/ForgotPasswordPageE2ETests.cs:28`).

### LoginModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/LoginModel.cs:9` · Level 0 · class (sealed)

- **What it is**: the `EditForm` backing model for the Login page, two string properties (`Email`, `Password`) carrying DataAnnotations for field-level validation.
- **Depends on**: `System.ComponentModel.DataAnnotations` (BCL): `[Required]`, `[EmailAddress]`. Nothing first-party.
- **Concept introduced, the form-backing model + `DataAnnotationsValidator`.** `[Rubric §24, Forms, Validation & UX Safety]` (assesses whether forms validate at the field level with clear, inline messages before submit) and `[Rubric §26, Front-End Security]` (assesses that client-side checks are a UX convenience, not the trust boundary). A Blazor `EditForm` binds to a plain model; a `<DataAnnotationsValidator />` reads the attributes and surfaces a per-field message as the user types, so the submit handler only fires on a valid form. The doc comment (`LoginModel.cs:5-8`) is explicit that the server remains the authority on whether the credentials are actually valid, the form just prevents an obviously-malformed request.
- **Walkthrough**: two `get; set;` properties:
  - `Email` (line 13), `[Required(ErrorMessage = "Email is required")]` + `[EmailAddress(ErrorMessage = "Enter a valid email address")]` (lines 11-12), defaulting to `string.Empty`.
  - `Password` (line 16), `[Required(ErrorMessage = "Password is required")]` (line 15); deliberately no complexity rule here, login validates an *existing* credential, not a new one.
- **Why it's built this way**: `sealed` and mutable (`set`, not `init`) because `EditForm` two-way-binds each input to the model; the messages are authored inline so each field shows one clear verdict.
- **Where it's used**: instantiated as `_model` and bound by `Login.razor` (`<EditForm Model="_model" OnValidSubmit="HandleLoginAsync">` + `<DataAnnotationsValidator />`, `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:32-33`, field at line 134, inputs bound with `For="@(() => _model.Email)"` at lines 39 and 45 so each `MudTextField` shows its own message); on valid submit the page hands the credentials to the injected [`IAuthUIService`](#iauthuiservice) as a [`LoginRequest`](group-08-auth.md#loginrequest) (`Login.razor:177`). The same page carries the escape hatch for a user who cannot supply a password at all, a link to `/forgot-password` (`Login.razor:64`, backed by [`ForgotPasswordModel`](#forgotpasswordmodel)). Sibling of [`RegisterModel`](#registermodel).

### MudTranslations

> MMCA.Common.UI · `MMCA.Common.UI.Resources` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Resources/MudTranslations.cs:10` · Level 0 · class (sealed)

- **What it is**: an empty marker class that anchors a `.resx` resource pair for **MudBlazor's own built-in component text**, the data-grid pager and filter menus, pickers, table editing, pagination, snackbar/alert close buttons, and input adornments ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Depends on**: nothing first-party (the type has no members: it is a single declaration, `public sealed class MudTranslations;`, line 10). Its meaning comes from its co-located resources, whose keys mirror MudBlazor's own `LanguageResource` keys (v9.6.0) with the English values copied verbatim so en-US behavior is unchanged, and from [`ResxMudLocalizer`](#resxmudlocalizer), which injects `IStringLocalizer<MudTranslations>` and hands those strings to MudBlazor's localization interceptor.
- **Concept reinforced, the resource-anchor type.** The anchor-type idiom is introduced in full at [`SharedResource`](#sharedresource): ASP.NET Core's `IStringLocalizer<T>` resolves keys against the `.resx` whose base name matches `T`, so a dedicated empty class becomes the *name* of a shared string table. `MudTranslations` is the second anchor, scoped to third-party (MudBlazor) chrome rather than app chrome. `[Rubric §27, Internationalization]` (assesses whether *all* user-visible copy, including the component library's, follows the active culture) and `[Rubric §20, Design System & Theming]` (assesses a consistent design system; the pager reading "Filas por pagina" instead of "Rows per page" under `es` keeps the whole surface coherent).
- **Walkthrough**: there are no members. The whole contract is "be a public sealed type named `MudTranslations` in this namespace, with sibling `.resx` files whose keys match MudBlazor's `LanguageResource`." The doc comment (`MudTranslations.cs:3-9`) records the verbatim-English-mirror invariant.
- **Why it's built this way**: MudBlazor localizes its built-in strings through an injectable `MudLocalizer`, but only for non-English cultures, and it needs *some* resource base to read from; a separate anchor keeps the library's keys in their own table (mirroring the upstream names one-to-one), cleanly apart from the app's own [`SharedResource`](#sharedresource) chrome. This is the [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) way to translate a dependency you do not own.
- **Where it's used**: injected as `IStringLocalizer<MudTranslations>` by [`ResxMudLocalizer`](#resxmudlocalizer), which is registered as MudBlazor's `MudLocalizer` in `AddUIShared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:55`).
- **Caveats / not-in-source**: the `.resx` files and their per-key match to MudBlazor v9.6.0's `LanguageResource` are resources, not `.cs`; individual key contents are not enumerated here.

### PasswordComplexityAttribute

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/PasswordComplexityAttribute.cs:12` · Level 0 · class (sealed attribute)

- **What it is**: a custom `ValidationAttribute` that enforces the framework's password-strength rule on any form that sets a new password, at least 8 characters including an uppercase, a lowercase, a digit, and a special (non-alphanumeric) character.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`ValidationAttribute`, `ValidationResult`, `ValidationContext`) and `char.IsUpper`/`IsLower`/`IsDigit`/`IsLetterOrDigit` (BCL). Nothing first-party.
- **Concept introduced, extending DataAnnotations with a domain rule.** `[Rubric §24, Forms, Validation & UX Safety]` (assesses client-side validation parity with the server). Beyond the built-in `[Required]`/`[EmailAddress]`, a bespoke rule subclasses `ValidationAttribute` and overrides `IsValid`. The doc comment (`PasswordComplexityAttribute.cs:5-10`) states the intent: mirror the server's rule so the `EditForm` gives the same verdict the API would. The downstream server-side story, how an accepted password is then *hashed*, is [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html) (PBKDF2-HMAC-SHA512 with legacy-hash backward compatibility); this attribute is only the client-side gate, never the security boundary.
- **Walkthrough**:
  - `[AttributeUsage(AttributeTargets.Property, AllowMultiple = false)]` (line 11), applied as `[PasswordComplexity]` on a property.
  - Constructor (lines 14-17) seeds the base `ErrorMessage` with the full human-readable rule.
  - `IsValid(object?, ValidationContext)` (lines 19-39): returns `ValidationResult.Success` for a non-string or null/empty input (lines 21-24), deliberately deferring the "missing" message to `RequiredAttribute` so the field shows one message, not two; otherwise evaluates five predicates (`Length >= 8`, `Any(char.IsUpper)`, `Any(char.IsLower)`, `Any(char.IsDigit)`, `Any(c => !char.IsLetterOrDigit(c))`, lines 26-30) and, on failure, returns a `ValidationResult` scoped to the member name (lines 37-38) so the message attaches to the right field.
- **Why it's built this way**: a `ValidationAttribute` plugs straight into the same `DataAnnotationsValidator` that drives the rest of the form, so the complexity rule participates in the standard EditForm lifecycle with no extra wiring; emptiness is delegated to `[Required]` to avoid duplicate messages on one field. Because the rule is an attribute rather than a method, a second form that sets a password gets identical behavior by adding one line, which is exactly how the reset vertical picked it up.
- **Where it's used**: applied to `RegisterModel.Password` ([`RegisterModel`](#registermodel), `RegisterModel.cs:22`) and to `ResetPasswordModel.NewPassword` ([`ResetPasswordModel`](#resetpasswordmodel), `ResetPasswordModel.cs:20`); evaluated by the `<DataAnnotationsValidator />` in `Register.razor` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Register.razor:27`) and `ResetPassword.razor` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ResetPassword.razor:35`).
- **Caveats / not-in-source**: the doc comment (line 6) still describes the attribute as the rule "for the Register form" although the reset form now carries it too; the code is the wider truth. The comment also claims parity with the server's rule, but this file only encodes the client check, so whether the server rule is byte-identical is not verifiable from this source.

### PersistedGridState

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:805` · Level 0 · record (sealed, private, nested)

- **What it is**: a tiny serializable record `(List<TDto> Items, int TotalItems)` that carries the *grid's already-fetched data* from the SSR pre-render pass into the interactive circuit, so the first interactive `ServerData` call can return instantly instead of re-hitting the API.
- **Depends on**: `Microsoft.AspNetCore.Components.PersistentComponentState` (the Blazor mechanism that serializes it). Nested privately inside [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto).
- **Concept introduced, `PersistentComponentState` to skip the double fetch.** `[Rubric §19, State Management & Data Flow]` and `[Rubric §23, Front-End Performance & Rendering]` (assesses avoiding redundant work across render-mode transitions). Under InteractiveAuto a page renders multiple times, static SSR then interactive Server then WASM, and naively each transition would re-run the data fetch. Blazor's `PersistentComponentState` serializes chosen data into the pre-rendered HTML and rehydrates it in the interactive circuit; `PersistedGridState` is the payload for the grid's data slice, so the visible "fetch, cancel, re-fetch" cycle of the render-mode handoff disappears.
- **Walkthrough**: declared as `private sealed record PersistedGridState(List<TDto> Items, int TotalItems)` (line 805), at the very bottom of the file under a doc comment (lines 801-804). On the persisting side, the base's `RegisterOnPersisting` callback (`DataGridListPageBase.cs:149-159`) writes `new PersistedGridState([.. _lastSuccessfulGridData.Items], _lastSuccessfulGridData.TotalItems)` (line 154) keyed by `grid:{GetType().FullName}` (built at line 136). On the restoring side, the synchronous `OnInitialized` (lines 136-140) calls `ApplicationState.TryTakeFromJson<PersistedGridState>(persistKey, out var restored)` (line 137) and, if present, rebuilds a `GridData<TDto>` (line 139) that the first `LoadServerDataAsync` returns directly.
- **Why it's built this way**: `private` because the persistence is purely an implementation detail of the base class; `sealed record` for JSON-serialization friendliness and value semantics; the items are materialized into a fresh `List<TDto>` (`[.. ...]`, line 154) so the persisted snapshot is decoupled from the live grid data.
- **Where it's used**: exclusively inside [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto); every derived list page inherits the behavior for free.
- **Caveats / not-in-source**: the record is declared at the *bottom* of the file (line 805) though it is a Level-0 collaborator; the restore runs in the **synchronous** `OnInitialized`, and the persisting callback is registered with an explicit `Microsoft.AspNetCore.Components.Web.RenderMode.InteractiveAuto` (line 159) to satisfy the framework's "callback must be associated with a render mode" rule during the static prerender pass, because the page inherits its render mode from `<Routes @rendermode="InteractiveAuto">` rather than declaring one itself (the inline comment at lines 142-148 records the exact framework error this avoids).

### PseudoLocalizer

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoLocalizer.cs:20` · Level 0 · class (static)

- **What it is**: a pure string transform that "pseudo-localizes" text, it accents every letter, pads the result by roughly 40% to simulate real-translation expansion, and wraps it in `[!! ... !!]` bracket sentinels, while leaving composite-format placeholders (`{0}`, `{name}`) byte-identical so the string can still be formatted with arguments ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) §8).
- **Depends on**: `System.Text.StringBuilder` and `char.IsLetter` (BCL). Nothing first-party. It is consumed by [`PseudoStringLocalizer`](#pseudostringlocalizer).
- **Concept introduced, pseudo-localization as an i18n fitness test.** `[Rubric §27, Internationalization]` (assesses whether the app is genuinely translation-ready, not just wired for one extra language) and `[Rubric §28, Front-End Testing]` (assesses whether i18n defects are caught automatically). Pseudo-localization is a development-time technique that surfaces three classes of bug in a single visual pass, without needing a real second translation, and the `<remarks>` block (`PseudoLocalizer.cs:12-19`) enumerates exactly those three: (1) any string that stays plain ASCII was **hard-coded** rather than pulled from a resource, and stands out beside the accented text; (2) any UI that **truncates** the padded text has a fixed-width layout that a real (longer) translation would break; (3) any label built by **concatenating fragments** shows one sentinel per fragment, exposing the joins that translate badly.
- **Walkthrough**:
  - Three constants (lines 22-24): `OpenSentinel = "[!! "`, `CloseSentinel = " !!]"`, and `CombiningAcute` (the combining acute accent code point) appended after each base glyph so the letter stays readable while visibly altered.
  - `Transform(string value)` (lines 30-74): returns null/empty input unchanged (lines 32-35); pre-sizes a `StringBuilder` with slack for the padding (line 37) and appends the open sentinel (line 38); then walks each character in a `switch` (lines 42-66) tracking an `insidePlaceholder` flag toggled by `{` and `}` (lines 46-53) so placeholder bodies are copied verbatim, and for every letter *outside* a placeholder appends the combining accent and increments a `letters` counter (lines 54-64); finally computes the pad length as `Math.Max(1, letters * 2 / 5)` (about 40%, line 69), appends a separating space (line 70), that many `~` characters (line 71) and the close sentinel (line 72), and returns the string (line 73).
- **Why it's built this way**: keeping the transform **pure and static** (input string to output string, no culture check inside) makes it trivially unit-testable and lets the *culture gating* live one layer up in [`PseudoStringLocalizer`](#pseudostringlocalizer). Preserving `{...}` placeholders is essential: transforming them would corrupt `string.Format`, so pseudo-loc must accent the template and only then substitute arguments (see the two-step in `PseudoStringLocalizer`).
- **Where it's used**: called by [`PseudoStringLocalizer`](#pseudostringlocalizer) on every resolved string when the current UI culture is the pseudo locale ([`SupportedCultures.PseudoLocale`](group-12-api-hosting-mapping.md#supportedcultures), referenced in the doc comment at line 10); inert otherwise.

### RegisterModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/RegisterModel.cs:9` · Level 0 · class (sealed)

- **What it is**: the `EditForm` backing model for the Register page, name/email/password fields with DataAnnotations plus six optional address fields.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`[Required]`, `[EmailAddress]`, `[Compare]`) and the sibling first-party [`PasswordComplexityAttribute`](#passwordcomplexityattribute).
- **Concept reinforced, multi-field form validation with a cross-field compare.** `[Rubric §24, Forms, Validation & UX Safety]`. This builds on the [`LoginModel`](#loginmodel) shape with three richer rules: `[PasswordComplexity]` on the password, `[Compare(nameof(Password))]` on the confirmation (cross-field equality), and an address block left attribute-free (optional). The doc comment (`RegisterModel.cs:5-8`) notes the annotations mirror the server's rules so client and server agree.
- **Walkthrough**:
  - `FirstName`/`LastName` (lines 12, 15), each `[Required]` with its own message (lines 11, 14).
  - `Email` (line 19), `[Required]` + `[EmailAddress]` (lines 17-18).
  - `Password` (line 23), `[Required]` + `[PasswordComplexity]` (lines 21-22).
  - `ConfirmPassword` (line 27), `[Required]` + `[Compare(nameof(Password), ErrorMessage = "Passwords do not match")]` (lines 25-26), the cross-field check.
  - `AddressLine1` plus nullable `AddressLine2`/`City`/`State`/`ZipCode`/`Country` (lines 30-35), no validation attributes; the inline comment (line 29) states an empty Line 1 means "no address supplied".
- **Why it's built this way**: the address fields stay attribute-free so a user can register without supplying one; the model is a flat view-model that the page projects onto the wire DTO at submit time rather than reusing the domain type directly.
- **Where it's used**: instantiated as `_model` and bound by `Register.razor` (`<EditForm Model="_model" OnValidSubmit="HandleRegisterAsync">` + `<DataAnnotationsValidator />`, `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Register.razor:26-27`, field at line 122); on valid submit the page projects it into a [`RegisterRequest`](group-08-auth.md#registerrequest) (`Register.razor:161`), with the address fields folded into an [`Address`](group-02-domain-building-blocks.md#address) by `BuildAddressResult()` (`Register.razor:129`), which returns `null` when all six address fields are blank (lines 131-137) and otherwise `Address.Create(...)` (line 139). The accepted password is hashed server-side per [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html). Its password block is mirrored by [`ResetPasswordModel`](#resetpasswordmodel).

### ResetPasswordModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ResetPasswordModel.cs:10` · Level 0 · class (sealed)

- **What it is**: the `EditForm` backing model for the Reset Password page: the address and the emailed reset token that identify the request, plus the new password and its confirmation.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`[Required]`, `[EmailAddress]`, `[Compare]`) and the sibling first-party [`PasswordComplexityAttribute`](#passwordcomplexityattribute).
- **Concept reinforced, the same password block as registration, on a credential-carrying form.** `[Rubric §24, Forms, Validation & UX Safety]` and `[Rubric §26, Front-End Security]`. The password half is byte-for-byte the shape [`RegisterModel`](#registermodel) introduced (`[Required]` + `[PasswordComplexity]` on the new value, `[Required]` + `[Compare]` on the confirmation), which is the payoff of expressing the complexity rule as an attribute rather than page code. What is new is the top half: `Email` and `Token` are not things the user chooses, they are the credential minted by the server and mailed as a link. The client validates only that both are present and that the address is well-formed; every substantive rejection (unknown, expired, mismatched, or attempt-capped token) collapses into one server-side `Auth.InvalidResetToken` error by design, per [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) Decision 3, so the form must not try to pre-judge a token it cannot verify.
- **Walkthrough**: four `get; set;` properties, each defaulting to `string.Empty`:
  - `Email` (line 14), `[Required(ErrorMessage = "Email is required")]` + `[EmailAddress(ErrorMessage = "Enter a valid email address")]` (lines 12-13).
  - `Token` (line 17), `[Required(ErrorMessage = "Reset token is required")]` (line 16), and nothing more: length, encoding, and freshness are all server-side properties of the cache record.
  - `NewPassword` (line 21), `[Required]` + `[PasswordComplexity]` (lines 19-20).
  - `ConfirmPassword` (line 25), `[Required]` + `[Compare(nameof(NewPassword), ErrorMessage = "Passwords do not match")]` (lines 23-24), the cross-field check retargeted at `NewPassword`.
- **Why it's built this way**: the doc comment (lines 5-9) records the load-bearing choice, that `Email` and `Token` arrive prefilled from the reset link but stay **editable**, so a user who only has the raw token text from the email (no working deep link, which is the situation on the native heads) can paste it in by hand. Making those two ordinary bound fields rather than read-only parameters is what buys that fallback for free.
- **Where it's used**: instantiated as `_model` by `ResetPassword.razor` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ResetPassword.razor:94`) and bound by its `<EditForm Model="_model" OnValidSubmit="HandleResetAsync">` + `<DataAnnotationsValidator />` (lines 34-35), with the four inputs at lines 41, 50, 56, and 61. The page declares `[SupplyParameterFromQuery]` `Email` and `Token` properties (lines 88-92) and copies them into the model in `OnParametersSet` (lines 101-112), which fills a field **only when it is still blank** (lines 103, 108) so a value the user corrected by hand is not overwritten when parameters are set again. `HandleResetAsync` (lines 114-138) calls [`IAuthUIService`](#iauthuiservice)`.ResetPasswordAsync(_model.Email, _model.Token, _model.NewPassword)` (line 121, contract at `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/IAuthUIService.cs:48`), flips `_isCompleted` on true, and on false shows `AuthService.LastError` or the generic `Auth.Reset.GenericError` string (line 127). The prefill path is pinned by a gallery E2E test (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/ResetPasswordPageE2ETests.cs:31`), with a WCAG 2.1 AA scan alongside it (`:43`).
- **Caveats / not-in-source**: the model has no rule tying `Token` to the address; that pairing is enforced by the server's cache record (`pwdreset:token:{email}`, [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) Decision 1), not by anything visible here.

### SharedResource

> MMCA.Common.UI · `MMCA.Common.UI.Resources` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Resources/SharedResource.cs:9` · Level 0 · class (sealed)

- **What it is**: an empty marker class that anchors `IStringLocalizer<SharedResource>` over its co-located `.resx` files, the single home for cross-cutting UI chrome strings ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Depends on**: nothing first-party (the type is empty: `public sealed class SharedResource;`, line 9). Its meaning comes from the co-located resources `SharedResource.resx` (the en default) and `SharedResource.es.resx` (Spanish), named in the doc comment at line 7, and from the ASP.NET Core localization stack that binds `IStringLocalizer<T>` to the `.resx` named after `T`.
- **Concept introduced, the resource-anchor type.** `[Rubric §27, Internationalization]` (assesses whether user-facing copy is externalized to per-culture resources keyed stably, not hard-coded). ASP.NET Core's `IStringLocalizer<T>` convention resolves keys against the resource file whose base name matches the type `T`. So a dedicated empty class becomes the *name* that ties many components to one shared string table: injecting `IStringLocalizer<SharedResource>` anywhere reads the same dotted, stable keys (e.g. `Common.Error.Load`, `Grid.Snackbar.LoadCancelled`). The doc comment (`SharedResource.cs:3-8`) enumerates the chrome it covers: buttons, layout labels, snackbar/error templates, and the culture- and theme-switcher text. Its counterpart for library chrome is [`MudTranslations`](#mudtranslations).
- **Walkthrough**: there are no members. The whole contract is "be a public sealed type named `SharedResource` in this namespace, with sibling `.resx` files." The work lives in the `.resx` key/value pairs and the localization middleware that resolves them by culture.
- **Why it's built this way**: a marker type is the idiomatic ASP.NET Core way to scope a shared resource table without inventing a real class; one anchor keeps the chrome strings in a single table every component shares ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) supersedes the prior single-locale stance of [ADR-011](https://ivanball.github.io/docs/adr/011-single-locale-i18n.html)).
- **Where it's used**: injected as `IStringLocalizer<SharedResource>` by [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) (`DataGridListPageBase.cs:23`) for its cancellation snackbar, by the auth pages for their field labels and messages (`ForgotPassword.razor:5`, `ResetPassword.razor:5`), and handed to [`ErrorMessages.Configure`](#errormessages) from the root layout (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/MainLayout.razor:103`) so the static helper resolves the same table; broadly consumed by the layout, the culture switcher, and the theme toggle components.
- **Caveats / not-in-source**: the `.resx` files (`SharedResource.resx`, `SharedResource.es.resx`) are resources, not `.cs`; their per-key contents are not enumerated here.

### WebApplicationExtensions

> MMCA.Common.UI · `MMCA.Common.UI.Extensions` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Extensions/WebApplicationExtensions.cs:8` · Level 0 · class (static)

- **What it is**: a one-method middleware extension for Blazor Server / WASM hybrid hosts: `UseAuthenticatedNoStore()` emits `Cache-Control: no-store` on HTML responses to **authenticated** users, so a logged-out user pressing Back never sees the previous logged-in HTML.
- **Depends on**: `Microsoft.AspNetCore.Builder.IApplicationBuilder`, `HttpContext.User`, and `HttpResponse.OnStarting` (ASP.NET Core). Nothing first-party.
- **Concept introduced, the browser back-forward cache (bfcache) as an auth-leak boundary.** `[Rubric §26, Front-End Security]` (assesses whether the front end avoids leaking authenticated content and treats the browser as hostile storage) and `[Rubric §23, Front-End Performance & Rendering]` (assesses render/navigation cost; bfcache is a *performance* feature this deliberately gives up, but only where it is unsafe). A browser's bfcache restores a full DOM snapshot of a previous page on Back without issuing a request, so no server authorization check runs. Emitting `no-store` on a response makes that page bfcache-ineligible: Back re-requests it and the server re-renders under the current (possibly signed-out) identity. The scoping is the interesting part: anonymous pages keep their bfcache eligibility because the guard is `context.User.Identity?.IsAuthenticated is true` (line 30), and non-HTML responses (JSON, static assets, the Blazor framework files) are skipped by the `text/html` content-type check (lines 31-32), so nothing but authenticated pages pays the cost.
- **Walkthrough**: a static class holding a single C# `extension(IApplicationBuilder app)` block (line 10), the same `extension(T)` preview syntax the framework uses for DI registration (see [primer](00-primer.md)).
  - `UseAuthenticatedNoStore()` (lines 24-44) registers an inline `app.Use((context, next) => ...)` terminal-free middleware (line 26).
  - It does **not** inspect the response at request time: it hooks `context.Response.OnStarting` (line 28), the callback the server invokes just before the first byte of the response is written. That is what makes reading `context.User` and `context.Response.ContentType` meaningful, both are populated by then even though this middleware sits *ahead* of the authentication middleware in the pipeline.
  - When both conditions hold it sets `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` plus the HTTP/1.0-era `Pragma: no-cache` (lines 34-35), then returns `Task.CompletedTask` (line 37).
  - The middleware returns `next()` immediately (line 40), and the extension returns `app` (line 43) so it chains in the usual `app.UseX().UseY()` shape.
- **Why it's built this way**: an `IApplicationBuilder` extension is the idiomatic ASP.NET Core registration shape, and the `OnStarting` hook is what allows a single narrow registration to make an after-the-fact decision (was this response authenticated? was it HTML?) instead of duplicating the check at every page. The remarks (lines 19-23) state the one ordering constraint: register it **before** `MapRazorComponents` so it wraps every page response.
- **Where it's used**: both Blazor Web hosts call it once, immediately after `UseAntiforgery()` and before the cookie-session/auth middleware: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:131` and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:171`, each with the same three-line comment explaining the intent.
- **Caveats / not-in-source**: whether a given browser honors `no-store` as bfcache-ineligibility is browser behavior, not code, and cannot be verified from this source. This type is distinct from the same-named [`WebApplicationExtensions`](group-12-api-hosting-mapping.md#webapplicationextensions) in the API layer; they share a name across assemblies, not an implementation.

### PseudoStringLocalizer

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoStringLocalizer.cs:13` · Level 1 · class (sealed)

- **What it is**: an `IStringLocalizer` decorator that pseudo-localizes every resolved string, but *only* when the current UI culture is the pseudo locale; under every other culture it delegates unchanged to the wrapped localizer, so it is inert in production ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) §8).
- **Depends on**: [`PseudoLocalizer`](#pseudolocalizer) (the transform, Level 0), [`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures) (its `IsPseudoLocale` from `MMCA.Common.Shared.Globalization`), and `IStringLocalizer`/`LocalizedString`/`CultureInfo` (BCL/NuGet). Constructed with an `inner` `IStringLocalizer` via a primary constructor (line 13).
- **Concept introduced, the decorator that gates on culture.** `[Rubric §2, Design Patterns]` (assesses idiomatic use of patterns; this is a textbook **Decorator**, same interface in and out, wrapping behavior around a delegate) and `[Rubric §27, Internationalization]`. The key design move is that pseudo-localization is a *cross-cutting* transform applied to the localizer, not to any call site: because it implements `IStringLocalizer` and forwards to `inner`, it can be slid underneath every `IStringLocalizer<T>` in the app at once by decorating the *factory* ([`PseudoStringLocalizerFactory`](#pseudostringlocalizerfactory)), with zero changes to consumers.
- **Walkthrough**:
  - `IsPseudoActive` (lines 16-17), a private static bool that returns [`SupportedCultures.IsPseudoLocale`](group-12-api-hosting-mapping.md#supportedcultures)`(CultureInfo.CurrentUICulture.Name)`, the single gate every member checks.
  - `this[string name]` (lines 20-29): resolves `inner[name]` (line 24), then, if pseudo is active, returns a new `LocalizedString` whose value is [`PseudoLocalizer.Transform`](#pseudolocalizer)`(localized.Value)` while preserving `ResourceNotFound`/`SearchedLocation` (line 26); otherwise returns the inner value untouched (line 27).
  - `this[string name, params object[] arguments]` (lines 32-48): when pseudo is inactive, delegates straight to `inner[name, arguments]` (lines 36-39); when active it does the **two-step** that makes placeholders survive, transform the *raw template* first (lines 43-44), then `string.Format` the accented template with the arguments (line 45), so the substituted values are never accented or padded.
  - `GetAllStrings(bool includeParentCultures)` (lines 51-57): maps the transform over every string when active (line 55), passes them through otherwise (line 56).
- **Why it's built this way**: gating inside the decorator (rather than conditionally registering it) keeps DI wiring unconditional and simple, the decorator is always present and simply does nothing outside the pseudo locale, which per the doc comment (lines 10-11) is never an activatable request culture in production. Splitting the pure transform ([`PseudoLocalizer`](#pseudolocalizer)) from the culture-aware decorator keeps each single-responsibility and independently testable (`[Rubric §1, SOLID]`).
- **Where it's used**: produced by [`PseudoStringLocalizerFactory`](#pseudostringlocalizerfactory) around every localizer the inner factory creates, so it transparently wraps `IStringLocalizer<SharedResource>`, `IStringLocalizer<MudTranslations>`, and every other localizer in the host.

### ResxMudLocalizer

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/ResxMudLocalizer.cs:17` · Level 1 · class (sealed, internal)

- **What it is**: MudBlazor's `MudLocalizer` implementation that resolves the library's built-in component text from the [`MudTranslations`](#mudtranslations) resource pair, so MudBlazor chrome (pager, filter menus, pickers, close buttons) follows the active UI culture ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Depends on**: `MudBlazor.MudLocalizer` (the abstract base, NuGet), `IStringLocalizer<MudTranslations>` (injected via primary constructor, line 17), and [`MudTranslations`](#mudtranslations) (Level 0). Nothing else first-party.
- **Concept introduced, adapting a third-party localization hook.** `[Rubric §2, Design Patterns]` (this is an **Adapter**, bridging MudBlazor's `MudLocalizer` contract to the ASP.NET Core `IStringLocalizer` world) and `[Rubric §27, Internationalization]`. MudBlazor exposes exactly one extension point for translating its built-in strings: subclass `MudLocalizer` and override its indexer. This adapter routes that indexer straight to `IStringLocalizer<MudTranslations>`. MudBlazor's own `DefaultLocalizationInterceptor` consults this localizer only for non-English cultures and falls back to its built-in English whenever the returned `LocalizedString.ResourceNotFound` is true (per the doc comment, `ResxMudLocalizer.cs:9-12`), so any untranslated key degrades gracefully.
- **Walkthrough**: a one-member class. `internal sealed class ResxMudLocalizer(IStringLocalizer<MudTranslations> localizer) : MudLocalizer` (line 17) with a single `public override LocalizedString this[string key] => localizer[key];` (line 19). The doc comment (lines 13-15) also notes that because resolution flows through the DI `IStringLocalizerFactory`, the [`PseudoStringLocalizerFactory`](#pseudostringlocalizerfactory) decorator applies here too, so under the development-only `qps-Ploc` culture MudBlazor's chrome pseudo-localizes alongside the application text.
- **Why it's built this way**: `internal` because it is pure host wiring no consumer needs to name; delegating to the injected `IStringLocalizer<MudTranslations>` reuses the exact same `.resx`/factory pipeline as app strings (one localization mechanism, not two), which is what lets pseudo-loc reach MudBlazor for free.
- **Where it's used**: registered as MudBlazor's `MudLocalizer` in `AddUIShared` via `services.TryAddTransient<MudBlazor.MudLocalizer, ResxMudLocalizer>()` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:55`). `TryAdd` is authoritative because `AddMudServices` does not register a `MudLocalizer` of its own (guarded by a DI-resolution test, per the comment at `DependencyInjection.cs:51-54`), regardless of host registration order.

### ErrorMessages

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/ErrorMessages.cs:17` · Level 2 · class (static)

- **What it is**: a centralized factory of user-facing snackbar message strings (load/save/delete/not-found/validation/action), so every page code-behind reports an outcome with identical phrasing, resolved through a shared localizer when one is configured ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Depends on**: `IStringLocalizer`/`LocalizedString` (Microsoft.Extensions.Localization, NuGet), `string.Format` with `CultureInfo.CurrentCulture` (BCL), and the first-party [`DomainInvariantViolationException`](group-01-result-error-handling.md#domaininvariantviolationexception) (the one exception whose message is shown). The localizer it is handed is an `IStringLocalizer<SharedResource>` (per the doc comment, `ErrorMessages.cs:25`), so it shares the [`SharedResource`](#sharedresource) `.resx` keys.
- **Concept introduced, the static-helper-with-injected-localizer bridge plus a safe-exception carve-out.** `[Rubric §27, Internationalization]` (assesses whether user-facing copy resolves per UI culture from resources rather than hard-coded English), `[Rubric §16, Maintainability]` (assesses whether a wording change is localized to one place), and `[Rubric §24, Forms, Validation & UX Safety]` (assesses that raw error text is not leaked to the user). This type is the boundary where a *static* helper (callable from any page without DI) is back-filled with a culture-aware localizer: each method calls a private `Localize(key, fallbackFormat, args)` that returns the localized value when the localizer is set and the key resolves, else the inline English fallback, so the static call sites never change yet the output follows the current culture. The load-bearing subtlety is the exception carve-out: a [`DomainInvariantViolationException`](group-01-result-error-handling.md#domaininvariantviolationexception) has its `Message` shown **verbatim** (because [`ServiceExceptionHelper`](#serviceexceptionhelper) rethrows the API's Problem Details errors as that type and their text is curated, server-localized domain wording, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) Decisions 3 and 5), while every *other* exception's `Message` is deliberately **not** surfaced (raw exception text is neither localizable nor safe to show, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) Decision 9). The rationale is spelled out in the `LoadError` doc comment (lines 42-51).
- **Walkthrough**: a static class holding one mutable localizer field plus pure builders:
  - `_localizer` (line 19), a nullable `IStringLocalizer?`, null until configured.
  - `Configure(IStringLocalizer localizer)` (line 26), the one-time wiring point: assigns `_localizer`; idempotent; called from the root layout (see *Where it's used*).
  - `Localize(key, fallbackFormat, args)` (lines 28-40), the resolution core: if `_localizer` is set and the lookup's `ResourceNotFound` is false, returns `localized.Value` (lines 30-37); else `string.Format(CultureInfo.CurrentCulture, fallbackFormat, args)` (line 39).
  - `LoadError`/`SaveError`/`DeleteError` (lines 52-55, 58-61, 64-67), the three CRUD failure paths, each `ex is DomainInvariantViolationException ? ex.Message : Localize("Common.Error.Load"/`Save`/`Delete`, "Error loading {0}.", entityName, ex.Message)`: the curated domain message reaches the user, otherwise the localized entity-name template does. The two siblings carry `<inheritdoc cref="LoadError"/>` (lines 57, 63) rather than repeating the rationale.
  - `ActionError(Exception ex, string localizedFallback)` (lines 77-78), the whole-sentence variant for pages whose fallback is a full sentence key of their own resource pair rather than an entity-noun template: same carve-out, but the non-domain branch returns the caller's already-localized `localizedFallback`.
  - `DeleteFailed` (lines 80-81, key `Common.Error.DeleteFailed`), the "API returned a non-error but the delete did not happen" case, distinct from `DeleteError` (which carries an exception).
  - `NotFound` (lines 83-84, key `Common.Error.NotFound`), interpolates the entity name and the missing id.
  - `ValidationError` (lines 86-87, key `Common.Error.Validation`), a parameterless property, the only fixed message.
  - `Success(string entityName, string action)` (lines 98-99, key `Common.Success`) is marked `[Obsolete]` (line 97): it composes "{0} {1} successfully." from a noun and an English verb fragment, which cannot be translated correctly (Spanish gender/word agreement, "creado" vs "creada", breaks), a §27 red flag called out in its own doc comment (lines 89-95). The `#pragma warning disable S1133` around it (lines 96, 100) is the migration mechanism itself: the obsoletion turns every remaining call site into a build error under `TreatWarningsAsErrors` during the lockstep sweep, and the member is removed once all consumers migrate to a whole-sentence resource key.
- **Why it's built this way**: keeping the API static means existing call sites (`ErrorMessages.LoadError(Title, ex)`) do not move, while the `Configure` indirection adds localization without a breaking signature change. Surfacing only the `DomainInvariantViolationException` message lets curated domain rules reach the user while raw infrastructure errors stay generic, culture-correct, and safe; a page that needs a richer failure message shapes it through [`ServiceExceptionHelper`](#serviceexceptionhelper) (which produces that exception type) and its own resource pair.
- **Where it's used**: backed once per circuit/host by `ErrorMessages.Configure(L)` in the root layout (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/MainLayout.razor:103`); called by [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) on a fetch failure (`DataGridListPageBase.cs:506` desktop, `:564` mobile) and by every entity page code-behind across both ADC and Store via `Snackbar.Add(...)`.
- **Caveats / not-in-source**: the `.resx` payloads (`SharedResource.resx`, `SharedResource.es.resx`) are resources, not `.cs`; their per-key contents are not enumerated here. `ServiceExceptionHelper`'s rethrow-as-`DomainInvariantViolationException` behavior is referenced in the doc comment but lives in another file; this file only *consumes* that type.

### PseudoStringLocalizerFactory

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoStringLocalizerFactory.cs:11` · Level 2 · class (sealed)

- **What it is**: an `IStringLocalizerFactory` decorator that wraps *every* localizer the inner factory produces in a [`PseudoStringLocalizer`](#pseudostringlocalizer), so decorating this one factory pseudo-localizes every `IStringLocalizer<T>` and `IStringLocalizer` in the host at once ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) §8).
- **Depends on**: [`PseudoStringLocalizer`](#pseudostringlocalizer) (Level 1) and `IStringLocalizerFactory`/`IStringLocalizer` (Microsoft.Extensions.Localization, NuGet). Constructed with the `inner` factory via a primary constructor (line 11).
- **Concept introduced, decorate the factory to reach every product.** `[Rubric §2, Design Patterns]` (Decorator applied at the *factory* level) and `[Rubric §10, Cross-Cutting Concerns]` (assesses whether cross-cutting behavior is injected in one place rather than scattered). Because `StringLocalizer<T>` resolves its backing localizer through the `IStringLocalizerFactory`, wrapping the factory means every localizer the DI container ever hands out is already pseudo-aware, no per-type registration, no consumer change. This is the same "decorate the boundary, not the callers" idea the CQRS pipeline uses (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)), applied to localization.
- **Walkthrough**: two forwarding overrides, each wrapping the inner factory's product:
  - `Create(Type resourceSource)` (lines 14-15): `new PseudoStringLocalizer(inner.Create(resourceSource))`, the path used by `IStringLocalizer<T>`.
  - `Create(string baseName, string location)` (lines 18-19): `new PseudoStringLocalizer(inner.Create(baseName, location))`, the path used by name-based localizers.
- **Why it's built this way**: registering the wrapper on the factory is the minimal, DI-idiomatic way to make pseudo-loc universal; combined with the culture gate inside [`PseudoStringLocalizer`](#pseudostringlocalizer), it can be registered **unconditionally** because it is inert under every non-pseudo culture, so production wiring is not conditional on environment (the registration comment, `DependencyInjection.cs:44-48`, says exactly that: the pseudo locale is only ever activatable in Development).
- **Where it's used**: registered via `services.Decorate<IStringLocalizerFactory, PseudoStringLocalizerFactory>()` (Scrutor) in `AddUIShared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:49`), immediately after `services.AddLocalization()` (line 42). Its reach includes MudBlazor chrome through [`ResxMudLocalizer`](#resxmudlocalizer), which resolves its `IStringLocalizer<MudTranslations>` through this same factory.

### DataGridListPageBase<TDto>

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:20` · Level 5 · class (abstract)

- **What it is**: the abstract Blazor base for every server-paged `MudDataGrid<TDto>` list page. It folds the otherwise-copy-pasted concerns, cancellation lifecycle, loading and failure flags, mobile/desktop viewport detection, filter/sort extraction, error reporting, scroll restore, density toggle, URL + session + prerender state plumbing, and disposal, into one reusable component (`class DataGridListPageBase<TDto> : ComponentBase, IBrowserViewportObserver, IAsyncDisposable, IDisposable`, line 20).
- **Depends on**: [`ErrorMessages`](#errormessages) (Level 2), [`SharedResource`](#sharedresource) (Level 0, injected as `IStringLocalizer<SharedResource>`), [`ListPageState`](#listpagestate) (Level 0), [`PersistedGridState`](#persistedgridstate) (Level 0, nested), [`ListPageQueryStateService`](#listpagequerystateservice) (Level 1), [`ListPageStateService`](#listpagestateservice) (Level 1), [`BreakpointConstants`](#breakpointconstants) (Level 0); MudBlazor's `MudDataGrid<T>`, `GridState<T>`, `GridData<T>`, `IBrowserViewportObserver`/`IBrowserViewportService` (NuGet); Blazor's `PersistentComponentState`, `NavigationManager`, `IJSRuntime` (framework).
- **Concept introduced, a behavior-rich Blazor base component.** `[Rubric §18, UI Architecture & Component Design]` (assesses reuse; every list page inherits this behavior with zero copy-paste) and `[Rubric §23, Front-End Performance & Rendering]` (assesses server-side paging, only the requested page is fetched, never the whole table, plus the prerender cache that skips a redundant fetch). It also embodies several hard-won quality notes, each documented inline: the `MudDataGrid v9 RowsPerPage` bug (the v9 parameter setter always uses `resetPage: true` and clobbers `CurrentPage`, comment at lines 407-410), the disposed-CTS race (a debounced reload firing after disposal threw `ObjectDisposedException` and stuck the `blazor-error-ui` banner, lines 578-582), and the stale-write race (a late grid-state save landing after navigation stamped grid params onto the *next* page's URL and disposed it, lines 161-165), all worked around here, touching `[Rubric §22, Responsive & Cross-Browser]` and `[Rubric §28, Front-End Testing]` (these were E2E-discovered regressions). Its cancellation snackbar reads a localized string from [`SharedResource`](#sharedresource), the `[Rubric §27, Internationalization]` angle, and the `LoadFailed` flag is a `[Rubric §24, Forms, Validation & UX Safety]` detail: a failed fetch renders zero rows, which looks exactly like an empty list once the error snackbar expires, so derived pages branch on the flag to show an inline error-with-retry instead of the "no records" empty state (documented at lines 32-40).
- **Walkthrough**: in teaching order:
  - **Injected services and abstract surface** (lines 22-29): `ISnackbar` (line 22), `IStringLocalizer<SharedResource>` (line 23, the localized cancel message), `IBrowserViewportService` (line 24), the two state services (lines 25-26), `NavigationManager` (line 27), `IJSRuntime` (line 28), `PersistentComponentState` (line 29). Derived pages supply the abstract `Title` (line 41) and may override `GridRef` (line 121), `SaveFilters`/`RestoreFilters` (lines 108, 111), and `OnMobileDataRequestedAsync` (line 720).
  - **Public/protected state** (lines 31-76): `IsLoading` (line 31), `LoadFailed` (line 40), `IsMobile` (line 44), the mobile card-view block `MobileItems`/`MobileTotalItems`/`MobileCurrentPage`/`MobilePageSize` (lines 47-50), the bindable `CurrentPageState` (line 57, 0-indexed), `RowsPerPageState` (line 67, defaulting to 10 to match MudDataGrid v9's own default), and `DenseGrid` (line 76). `PrerenderFetchTimeoutMs = 5000` (line 82) bounds the SSR fetch.
  - **Private fields** (lines 84-99): the CTS (line 84), the `_disposed` guard (line 85), the scroll module and `DotNetObjectReference` (lines 86, 90), the persistence subscription (line 87), the prerender caches `_persistedGridData`/`_lastSuccessfulGridData` (lines 88-89), the saved-state mirror fields `_savedPage`/`_savedPageSize`/`_savedSortColumn`/`_savedSortDescending` (lines 92-95), the re-entrancy and deferral flags (lines 96-98), and the per-instance `_scrollTrackerId` GUID (line 99). The observer contract's `Id` and `ResizeOptions` (250 ms report rate) sit at lines 102 and 105; `_ownRoutePath`, the stale-write anchor, is declared later at line 705.
  - `OnInitialized` (lines 130-211), synchronously: (a) restores any [`PersistedGridState`](#persistedgridstate) from `PersistentComponentState` under the key `grid:{GetType().FullName}` (lines 136-140); (b) registers the persisting callback with an explicit `RenderMode.InteractiveAuto` (lines 149-159; the explicit mode is required because the page inherits its render mode from `<Routes @rendermode="InteractiveAuto">` and the framework otherwise cannot associate the callback); (c) pins `_ownRoutePath` to this page's route (line 166); (d) reads the URL via [`ListPageQueryStateService`](#listpagequerystateservice) (line 168) and falls back to the in-memory [`ListPageStateService`](#listpagestateservice) snapshot when the URL is pristine (lines 170-179); (e) primes `CurrentPageState`/`RowsPerPageState`/`MobileCurrentPage`/sort/`DenseGrid` and calls `RestoreFilters` (lines 181-193) so the grid's *first* `ServerData` call fetches the right page directly; (f) sets `_deferSessionPersist` when neither channel had state (line 199) and picks up a pending scroll position (lines 202-205); and (g) subscribes to `LocationChanged` (lines 207-208).
  - `OnLocationChanged` (lines 213-251): honors the one-shot `_suppressNextLocationChanged` flag (lines 215-219), reacts only to same-path back/forward (a different path returns early and is handled by disposal, lines 223-227), re-reads the URL into the mirror fields (lines 229-240), then applies `CurrentPage` to the live grid via the BL0005-suppressed `ApplyCurrentPageFromUrl` (line 246, helper at lines 253-260) and reloads (line 247).
  - `NotifyBrowserViewportChangeAsync` (lines 263-276): the `IBrowserViewportObserver` callback, recomputing `IsMobile` from [`BreakpointConstants.IsMobileBreakpoint`](#breakpointconstants) (line 267) and, on a desktop-to-mobile transition, resetting to page 1 and requesting mobile data (lines 269-273).
  - `OnAfterRenderAsync(firstRender)` (lines 284-340): on first render, hydrates session state now that interop is available (`HydrateFromSessionAsync`, line 292), runs the cross-circuit fallback (`needsSessionRestore` at line 298, `ApplyRestoredState` at line 302), clears the deferral (line 310), subscribes to viewport changes (line 312), imports `./_content/MMCA.Common.UI/list-page-scroll.js` (lines 314-316) and enables debounced (150 ms) scroll tracking through a `DotNetObjectReference` (lines 317-322), then calls `RestoreGridStateAsync` (line 324) and forces a sessionStorage sync (line 329). On every render it restores a pending scroll position once the grid has stopped loading (lines 333-337). The JS calls back into `[JSInvokable] OnScrollPositionChanged` (lines 346-348), which updates only the scroll field.
  - `RestoreGridStateAsync` and `RestoreCurrentPageAfterRowsPerPageReset` (lines 393-419 and 358-365), the MudDataGrid v9 workaround: force `SetRowsPerPageAsync(_savedPageSize, resetPage: false)` when the parameter did not take (lines 402-405), then re-restore `CurrentPage` from `_savedPage` because the v9 setter resets it to 0 (line 411), and reload when session hydration changed pagination after the grid's first fetch (lines 415-418).
  - `LoadServerDataAsync(state, fetchAsync, additionalFilters, showCancelSnackbar)` (lines 434-515), the heart of the desktop path: resets the CTS (line 440); returns the prerender cache on the first interactive call (lines 444-459, skipping a round-trip and still saving state); sets `IsLoading` and clears `LoadFailed` (lines 461-462); bounds the fetch with `CreateFetchCts` (line 469); extracts filters and sort **inside** the `try` (lines 474-488, so a throw from the caller's `additionalFilters` callback cannot strand `IsLoading` at true) with a saved-sort fallback for the first fetch (lines 484-488); calls the delegate with a 1-based page number (line 490) and caches the result (lines 491-493); maps `OperationCanceledException` to an empty grid plus a localized `Localizer["Grid.Snackbar.LoadCancelled"]` snackbar (lines 496-503); maps any other `Exception` to an empty grid plus [`ErrorMessages.LoadError`](#errormessages) and `LoadFailed = true` (lines 504-509); and always clears `IsLoading` in the `finally` (lines 510-514).
  - `CreateFetchCts` (lines 523-532): links to the active `_cts` (line 525) and, during **non-interactive** prerender (`!RendererInfo.IsInteractive`, line 526), calls `CancelAfter(PrerenderFetchTimeoutMs)` (line 528) so a cold or unreachable backend cannot block the page load indefinitely.
  - `LoadMobileDataAsync` (lines 538-574), the mobile-card equivalent with the same flag discipline; its error path also runs through [`ErrorMessages.LoadError`](#errormessages) and sets `LoadFailed` (lines 562-568), and cancellation is silently swallowed (lines 558-561).
  - `ResetCancellationTokenAsync` (lines 576-598): swaps in a fresh CTS *first* (lines 583-584), then tears down the previous one, tolerating `ObjectDisposedException` (lines 593-596, the disposed-CTS race fix).
  - `ExtractGridFilters` (lines 605-617) flattens MudDataGrid's filter definitions into a one-entry-per-column dictionary, grouping by property name and letting the **newest** row win (line 613) rather than throwing on the duplicate key that a second filter on the same column would produce; `ExtractSortParameters` (lines 619-623) takes the first sort definition.
  - `SaveCurrentState` (lines 625-662): guarded by `IsOwnRouteCurrent()` (line 629, the stale-write drop), it composes a new [`ListPageState`](#listpagestate) (lines 638-648, preserving the existing scroll position) and writes it to all three channels: the in-memory service (line 649), the URL (`ReplaceState`, line 654, with `_suppressNextLocationChanged` set at line 653 so it does not re-trigger its own `LocationChanged` handler), and sessionStorage (`PersistToSessionAsync`, lines 658-661, skipped during the deferred-hydration window).
  - `ToggleDensity`/`PersistDensity` (lines 669-674 and 682-702), the density toggle: flips `DenseGrid` and mirrors just that field through the same in-memory + URL + sessionStorage tail using a `with` expression on the existing state (line 692), under the same `IsOwnRouteCurrent` guard (line 685), so a density change made before the grid's first `ServerData` save is not lost.
  - **Route pinning**: `_ownRoutePath` (line 705), `GetRoutePath()` (line 707, falling back to the live URI only before init), and `IsOwnRouteCurrent()` (lines 713-714).
  - `CancelLoading` (line 722), the manual cancel hook a page can bind to a "stop" affordance.
  - `DisposeAsync`/`Dispose` (lines 725-768 and 770-784): dispose the persistence subscription, unsubscribe `LocationChanged` (helper at lines 786-793), disable scroll tracking and dispose the JS module (lines 737-741) guarded against shutdown-time JS races (`JSDisconnectedException`/`JSException`, lines 743-750), dispose the `DotNetObjectReference` in a `finally` (line 753), unsubscribe the viewport observer best-effort (lines 756-763), and cancel + dispose the CTS (lines 765-766). Both paths are `_disposed`-idempotent (lines 727-730, 772-773).
- **Why it's built this way**: every concern here was independently re-implemented (and re-broken) on individual pages before being lifted into one base; consolidating them means a single fix (the v9 paging bug, the prerender timeout, the disposed-CTS race, the stale-write race, the duplicate-filter crash) propagates to every list page at once. The four-channel persistence (URL + memory + sessionStorage + prerender cache) covers the full matrix of how a user can leave and return to a list: browser back, in-app navigation, refresh or forceLoad, and shareable link.
- **Where it's used**: base class for the list pages in both apps, including ADC's `UserList` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:16`), `SponsorList` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Sponsor/SponsorList.razor.cs:19`) and `AttendeeSearchPanel` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/CheckIn/AttendeeSearchPanel.razor.cs:16`), and Store's `OrderList` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/Order/OrderList.razor.cs:17`), `InventoryItemList`, `ShoppingCartList`, and `CustomerList` (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.UI/Pages/Customer/CustomerList.razor.cs:14`). The consumers' bUnit tests deliberately scope themselves to page-specific behavior and treat this base as already framework-tested (`MMCA.Store/Tests/Modules/Identity/MMCA.Store.Identity.UI.Tests/Pages/Customer/CustomerListTests.cs:17`).
- **Caveats / not-in-source**: two `BL0005` suppressions (lines 253 and 358) set `grid.CurrentPage` from outside the component; the justification (MudDataGrid v9 exposes no public method for arbitrary-page navigation and the setter is well-behaved) is inlined in both. The prerender optimization assumes the backend is warm in production; under a cold backend the prerender fetch times out at 5 s (`PrerenderFetchTimeoutMs`) and the interactive pass refills the grid. The `list-page-scroll.js` module (`enableScrollTracking`/`setScrollPosition`/`disableScrollTracking`) is JavaScript under `wwwroot`; this `.cs` file only invokes it by name, so its behavior is not verifiable from this source. Note the route comparison is `Ordinal` in `OnLocationChanged` (line 224) but `OrdinalIgnoreCase` in `IsOwnRouteCurrent` (line 714); the source does not state why they differ.

### MoneyExtensions

> MMCA.Common.UI · `MMCA.Common.UI.Extensions` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Extensions/MoneyExtensions.cs:14` · Level 5 · class (static)

- **What it is**: the presentation-layer formatter for money, turning a [`Money`](group-02-domain-building-blocks.md#money) value object into `$12.50 USD` and a collection of them into a per-currency range such as `$10.00 - $25.00 USD`.
- **Depends on**: [`Money`](group-02-domain-building-blocks.md#money) and its [`Currency`](group-02-domain-building-blocks.md#currency) (both `MMCA.Common.Shared.ValueObjects`), plus `CultureInfo.InvariantCulture` and `StringComparer.Ordinal` (BCL).
- **Concept introduced, formatting lives in the UI layer, not the value object.** `[Rubric §3, Clean Architecture]` (assesses whether presentation concerns stay out of the inner layers: `Money` knows amounts and currencies, it does not know what a price *looks like*) and `[Rubric §20, Design System & Theming]` (assesses consistent presentation of a recurring data shape; one formatter means every price on every page reads the same). It also shows the C# `extension(T)` preview syntax used for something other than DI: two blocks, one on `Money` and one on `IReadOnlyCollection<Money>`, sit in a single static class so both spellings (`price.ToDisplayString()` and `prices.ToDisplayRange()`) are available from one `using`.
- **Walkthrough**:
  - The class carries a file-level `[SuppressMessage("Naming", "CA1708")]` (lines 10-13): with two or more `extension(T)` blocks in one static class, CA1708 flags the compiler-generated grouping members as case-colliding. The justification records that no user-visible identifier differs only by case, a known analyzer trap of the preview syntax.
  - `extension(Money price)` (lines 16-21) exposes `ToDisplayString()` (lines 19-20), which delegates to `FormatGroup(price.Amount, price.Amount, price.Currency.Code)`: passing the same value as both bounds is what makes the shared helper render a single price rather than a degenerate range.
  - `extension(IReadOnlyCollection<Money> prices)` (lines 23-47) exposes `ToDisplayRange()` (lines 32-46): returns `string.Empty` for an empty collection (lines 34-37), then groups by `Currency.Code` with `StringComparer.Ordinal` (line 42) and formats each group from its own min and max (line 43), joining the groups with `", "` (line 45). Grouping is the load-bearing detail: a mixed-currency collection renders one range per currency, each with its own symbol, instead of collapsing unrelated amounts under whichever currency appeared first. The inline comment (lines 39-40) notes `GroupBy` preserves first-appearance order, so the single-currency case (every collection in practice today) is unchanged.
  - `Symbol(string code)` (lines 54-59), a private switch mapping `"USD"` to `$` and `"EUR"` to the escaped euro sign (line 57, escaped to keep the source file ASCII-only). Every other code, **including the empty code of the `Currency.None` sentinel behind `Money.Zero()`** (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Currency.cs:23`, `Money.cs:142`), renders with no symbol rather than falsely claiming dollars.
  - `FormatGroup(decimal min, decimal max, string code)` (lines 65-73), the single formatting path: `"N2"` with `CultureInfo.InvariantCulture` (lines 69-70) so two decimals and a thousands separator render identically regardless of server locale, a single price when `min == max` and a hyphen-separated range otherwise (line 68), and the trailing code appended only when it is non-empty (line 72).
- **Why it's built this way**: presentational formatting belongs above the domain, so `Money` stays display-agnostic and the same value can be rendered differently by a different head. `InvariantCulture` is a deliberate choice over `CurrentCulture`: prices are shown with an explicit ISO code (`USD`), so a locale-dependent decimal separator would produce `$12,50 USD` and read as an error. The empty-symbol fallback and the per-currency grouping are both "render the truth" decisions: never imply a currency the data does not carry.
- **Where it's used**: Store's Sales and Catalog UIs. `ToDisplayString()` renders order totals and line amounts (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/Order/OrderLinesPanel.razor:34`, `:39`, `:51`; `Pages/Order/OrderSummaryPanel.razor:54`; `Pages/Order/OrderList.razor:36`, `:102`) and the cart's order-created snackbar (`Pages/ShoppingCart/ShoppingCartDetail.razor.cs:265`); `ToDisplayRange()` renders the price span across a product's variants in catalog browse (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/Pages/Catalog/CatalogBrowse.razor.cs:303`, with the single-price helper alongside it at `:306`).
- **Caveats / not-in-source**: only `USD` and `EUR` have symbols; adding a currency means editing `Symbol`, there is no configuration-driven table. The `"N2"` format assumes a two-minor-unit currency, so a zero-decimal currency (JPY) would render two spurious decimals; no code guards that today.

### CultureDelegatingHandler

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/CultureDelegatingHandler.cs:13` · Level 0 · class (sealed)

- **What it is**: A one-method `DelegatingHandler` that stamps the active UI culture onto every outgoing API call as an `Accept-Language` header, so validation and error text come back from the backend in the language the user selected.
- **Depends on**: No first-party types. Externals: `System.Net.Http.DelegatingHandler`, `System.Globalization.CultureInfo`, and `System.Net.Http.Headers.StringWithQualityHeaderValue`. It rides the same named `"APIClient"` pipeline as [AuthDelegatingHandler](#authdelegatinghandler).
- **Concept introduced**: **Culture as a transport header, not just a cookie.** `[Rubric §27, Internationalization]` assesses whether locale is carried end to end rather than applied only at the rendering edge; this handler is the piece that closes that loop for server-produced strings. The class comment (`CultureDelegatingHandler.cs:8-11`) states the reason plainly: the cross-origin Gateway does not carry the ASP.NET culture cookie through to the services, so a cookie-only design would render the page in Spanish while the API answered in English. `[Rubric §10, Cross-Cutting Concerns]` also applies, because this is a concern every service call needs and no service call implements: it is attached once in the HttpClient pipeline instead of at each call site.
- **Walkthrough**: The only member is the `SendAsync` override (`CultureDelegatingHandler.cs:16`). It reads `CultureInfo.CurrentUICulture.Name` (`CultureDelegatingHandler.cs:20`) and does nothing when that is blank, so an unresolved culture sends no header rather than an empty one (`CultureDelegatingHandler.cs:21`). When there is a value it calls `AcceptLanguage.Clear()` before `Add(...)` (`CultureDelegatingHandler.cs:23-24`); the clear matters because a retried request object would otherwise accumulate a second language entry. Finally it returns `base.SendAsync(request, cancellationToken)` directly (`CultureDelegatingHandler.cs:27`) rather than awaiting it, so the handler adds no async state machine to the hot path.
- **Why it's built this way**: [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) makes the multi-locale story a whole-stack concern. Registering the behavior as a message handler means the culture travels on calls made by code that has never heard of localization. It is registered transient in [DependencyInjection](#dependencyinjection) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:60`) and appended to the `"APIClient"` pipeline after the auth handler (`DependencyInjection.cs:82`).
- **Where it's used**: Every request through the `"APIClient"` named client, which is every call made by [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype), [ChildEntityServiceBase](#childentityservicebase), [ApiUserPreferenceReader](#apiuserpreferencereader) and [ApiUserPreferenceWriter](#apiuserpreferencewriter).
- **Caveats / not-in-source**: It reads whatever ambient UI culture the head has already established. On a Blazor WebAssembly head that is set by [MmcaCultureBootstrap](#mmcaculturebootstrap) before the host runs; the handler itself makes no attempt to resolve or validate a culture.

---

### ICultureApplier

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ICultureApplier.cs:14` · Level 0 · interface

- **What it is**: The one-method contract for "switch the language and put the user back where they were", written as an abstraction because the mechanism differs per head.
- **Depends on**: Nothing. Implemented by [EndpointCultureApplier](#endpointcultureapplier) (the Blazor Web default) and by `MauiCultureApplier` in the device-capability layer ([MauiCultureApplier](group-26-device-capability-layer.md#mauicultureapplier)).
- **Concept introduced**: **A terminal call.** `[Rubric §18, UI Architecture]` assesses whether host-specific mechanics are hidden behind contracts the components can share; this interface is the clearest example in the UI package. The doc comment (`ICultureApplier.cs:5-12`) spells out both halves of the contract: a Blazor Web head round-trips the server `/culture/set` endpoint so the cookie, the SSR prerender and the WASM runtime all agree, while a MAUI Blazor Hybrid head has no ASP.NET pipeline and switches the process culture in place. Because each implementation owns landing the user back on the return path (a redirect on the web, a WebView reload on a hybrid head), callers must treat `ApplyAsync` as terminal and do no navigation of their own. `[Rubric §25, Navigation & Information Architecture]` applies for the same reason: navigation ownership is part of the contract rather than an afterthought at each call site.
- **Walkthrough**: `ApplyAsync(string culture, string returnPath, CancellationToken cancellationToken = default)` (`ICultureApplier.cs:27`). Two documented behaviors are part of the contract rather than any one implementation: a culture outside `SupportedCultures.All` is ignored by the underlying mechanism rather than throwing (`ICultureApplier.cs:19-22`), and an empty `returnPath` falls back to `"/"` (`ICultureApplier.cs:23-25`).
- **Why it's built this way**: [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html). Hard-coding the endpoint navigation into the culture switcher component would have made that component unusable on MAUI, where the URL matches no route and the Blazor `Router` renders the not-found page. The interface lets one shared component serve both heads.
- **Where it's used**: Injected by the shared `CultureSwitcher` component, which persists the choice first and then treats the applier call as the last thing it does (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/CultureSwitcher.razor:6` and `CultureSwitcher.razor:44-48`), and by the login page when reconciling a returning user's stored culture (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:14`).

---

### IUserPreferenceWriter

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/IUserPreferenceWriter.cs:9` · Level 0 · interface

- **What it is**: The write half of cross-device UI preferences: persists the signed-in user's culture and theme choice to the backend so it follows them to their next browser or device.
- **Depends on**: Nothing. Implemented by [ApiUserPreferenceWriter](#apiuserpreferencewriter); the read half is [IUserPreferenceReader](#iuserpreferencereader).
- **Concept introduced**: **Best-effort persistence over a local source of truth.** `[Rubric §19, State Management & Data Flow]` assesses where state lives and which copy wins; the doc comment (`IUserPreferenceWriter.cs:5-7`) answers both: the cookie and localStorage remain the runtime channel, this interface is a roaming convenience, and a failed or skipped persist must never break the in-page switch. Implementations must no-op for anonymous users. A `null` field means "leave unchanged", which is what lets the theme toggle and the culture switcher share one method without either clobbering the other's value.
- **Walkthrough**: `SaveAsync(string? culture, string? theme, CancellationToken cancellationToken = default)` (`IUserPreferenceWriter.cs:18`). Both arguments are nullable by design, per the null-means-unchanged rule stated at `IUserPreferenceWriter.cs:12-13`.
- **Why it's built this way**: [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) and [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html). Keeping it an interface is what lets a host that has no `auth/preferences` endpoint (the Helpdesk seed is the named example at `ApiUserPreferenceWriter.cs:11-12`) simply not register it: the callers resolve it with `GetService<T>` and skip the persist when it is absent.
- **Where it's used**: The theme toggle resolves it optionally and saves only the theme (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/ThemeToggle.razor:23-26`); the culture switcher does the same for culture before handing off to the applier (`CultureSwitcher.razor:38-41`).

---

### LazyJsModule

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/LazyJsModule.cs:20` · Level 0 · class (internal sealed)

- **What it is**: A tiny single-flight importer that owns one JavaScript module reference for a UI service: it imports on first use, shares one import across concurrent callers, and disposes the reference safely when the circuit ends.
- **Depends on**: `Microsoft.JSInterop` (`IJSRuntime`, `IJSObjectReference`, `JSDisconnectedException`) and the .NET 9+ `System.Threading.Lock` type. No first-party dependencies.
- **Concept introduced**: **Single-flight JS module import.** `[Rubric §23, Front-End Performance]` assesses whether the client loads only what it needs, when it needs it; deferring `import()` until first use is the lazy half of that, and collapsing concurrent imports into one is the correctness half. The class comment (`LazyJsModule.cs:6-13`) states the exact defect this replaces: an unguarded `_module ??= await import(...)` lets two concurrent callers each start an import, after which the browser holds two module instances and the later assignment leaks the earlier reference, which is never disposed. `[Rubric §15, Best Practices & Code Quality]` applies to the second half of the design: a failed import is dropped rather than cached, so an import attempted during SSR prerender (when JS interop does not exist yet) does not poison the module for the rest of the circuit.
- **Walkthrough**: The primary constructor takes the `IJSRuntime` and the module path (`LazyJsModule.cs:20`). State is three fields: a `Lock` (`LazyJsModule.cs:22`), the in-flight import task (`LazyJsModule.cs:24`), and the resolved module (`LazyJsModule.cs:25`). `IsImported` (`LazyJsModule.cs:28`) exists so disposal can skip work. `GetOrImportAsync` (`LazyJsModule.cs:34`) starts with a lock-free fast path returning the cached module (`LazyJsModule.cs:36-39`), then takes the lock only to publish or read the in-flight task (`LazyJsModule.cs:44-48`); the inline comment notes why holding a lock here is safe, since `ImportAsync` reaches its first await immediately and nothing slow runs under it. The awaited task is then shared by every caller (`LazyJsModule.cs:52`). The `finally` block is the subtle part (`LazyJsModule.cs:58-67`): it clears the field only when the task did **not** complete successfully, and only when the field still holds *this* task, because clearing unconditionally could drop a newer import started after this one completed and split the next set of callers. `ImportAsync` (`LazyJsModule.cs:71-79`) performs the actual `js.InvokeAsync<IJSObjectReference>("import", ...)` and assigns `_module`. `DisposeAsync` (`LazyJsModule.cs:82-99`) returns immediately when nothing was imported, nulls the field before awaiting, and swallows `JSDisconnectedException` (`LazyJsModule.cs:95-98`), since a torn-down circuit is the normal end of life for a scoped UI service.
- **Why it's built this way**: The remarks (`LazyJsModule.cs:14-19`) draw the responsibility line: this class deliberately does not swallow anything on the import path, so each consuming service keeps its own degradation contract (return a default, fall back to a navigation, no-op). That is why [ListPageStateService](#listpagestateservice) wraps its calls in a catch-and-ignore helper while [ThemeService](#themeservice) does not.
- **Where it's used**: [ThemeService](#themeservice) (`ThemeService.cs:19`), [ListPageStateService](#listpagestateservice) (`ListPageStateService.cs:64`), [NavigationHistoryService](#navigationhistoryservice) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/NavigationHistoryService.cs:16`), and [CapabilitiesJsModule](group-26-device-capability-layer.md#capabilitiesjsmodule) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Browser/CapabilitiesJsModule.cs:19`).
- **Caveats / not-in-source**: It is `internal`, so it is not part of the published package surface: consumer apps get the benefit through the services that use it, not by using it directly.

---

### ListPageState

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ListPageStateService.cs:9` · Level 0 · record (sealed)

- **What it is**: The immutable snapshot of everything a list page needs to look the same after you navigate away and come back: which page, how many rows, how far down, which sort, which density, and which filters.
- **Depends on**: Nothing first-party. It is the currency shared by [ListPageStateService](#listpagestateservice) (in-memory plus `sessionStorage`), [ListPageQueryStateService](#listpagequerystateservice) (URL encoding), and [DataGridListPageBase<TDto>](#datagridlistpagebasetdto) (the consumer).
- **Concept introduced**: **One state shape, three transports.** `[Rubric §19, State Management & Data Flow]` assesses whether UI state has a single defined shape rather than being reconstructed ad hoc per page; this record is that shape, and the fact that memory, session storage and the address bar all move the *same* record is what keeps the three from drifting. The record is documented as update-by-`with` (`ListPageStateService.cs:7`), so a caller changing scroll position cannot accidentally reset paging.
- **Walkthrough**: Eight `init` members. `Page` (`ListPageStateService.cs:13`) is the MudDataGrid 0-indexed page; `PageSize` (`ListPageStateService.cs:16`) the chosen rows per page; `MobilePage` (`ListPageStateService.cs:18`) the 1-indexed card-list page, and it is the only member with a non-default default (`= 1`), because a mobile page zero does not exist. `ScrollPosition` (`ListPageStateService.cs:21`) is a `double` of pixels read from `document.scrollingElement.scrollTop`. `SortColumn` (`ListPageStateService.cs:27`) holds the `SortBy` property name of the active sort definition and is null or empty when unsorted; `SortDescending` (`ListPageStateService.cs:33`) is ignored when it is. `DenseGrid` (`ListPageStateService.cs:41`) carries the compact-density opt-in, persisted alongside paging and sort so the chosen density survives navigation, refresh and shared links. `Filters` (`ListPageStateService.cs:47`) is an `IReadOnlyDictionary<string, string>` of page-specific named values (the doc gives `"search"` and `"status"` as examples) defaulting to an empty dictionary, so each page decides what it saves.
- **Why it's built this way**: A sealed record gives value equality and `with`-based copies for free, which is what makes the "update only scroll position" and "update only density" paths in the service one-liners.
- **Where it's used**: Produced and consumed by both list-page state services and by [DataGridListPageBase<TDto>](#datagridlistpagebasetdto); serialized to `sessionStorage` as JSON and encoded into the query string.

---

### UserPreferences

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/UserPreferences.cs:9` · Level 0 · record (sealed)

- **What it is**: The two-field result of reading a user's stored UI preferences: their culture and their theme.
- **Depends on**: Nothing. Returned by [IUserPreferenceReader](#iuserpreferencereader) and its implementation [ApiUserPreferenceReader](#apiuserpreferencereader).
- **Concept introduced**: Nothing new. It reuses the null-means-unset convention introduced by [IUserPreferenceWriter](#iuserpreferencewriter): the doc comment (`UserPreferences.cs:4-5`) states that a `null` field means the user never chose that preference, so the request default or the OS preference applies. `[Rubric §19, State Management & Data Flow]` applies in the small: "no stored value" and "stored value that happens to be the default" are distinguishable, which is what lets the login reconciliation skip a redundant culture round-trip.
- **Walkthrough**: A positional record with two members, `Culture` and `Theme`, both `string?` (`UserPreferences.cs:9`). There is no factory and no validation: values are whatever the backend returned.
- **Why it's built this way**: A positional record is the smallest thing that deserializes cleanly from the `auth/preferences` payload and compares by value.
- **Where it's used**: Returned by [ApiUserPreferenceReader](#apiuserpreferencereader), including its static `Empty` instance (`ApiUserPreferenceReader.cs:18`); consumed by the login page's preference reconciliation (`Login.razor:198-206`).

---

### UserPreferencesRequest

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ApiUserPreferenceWriter.cs:29` · Level 0 · record (private sealed, nested)

- **What it is**: The request body the writer PUTs to `auth/preferences`: the same culture and theme pair, in write direction.
- **Depends on**: Nothing. It is declared inside [ApiUserPreferenceWriter](#apiuserpreferencewriter) and used only there.
- **Concept introduced**: Nothing new; it is the wire-facing twin of [UserPreferences](#userpreferences). `[Rubric §9, API & Contract Design]` applies in the small: the request type is kept separate from the response type even though they currently have identical members, so the two directions can diverge without a breaking change, and it is declared `private` so it never becomes part of the package's public surface.
- **Walkthrough**: `private sealed record UserPreferencesRequest(string? Culture, string? Theme)` (`ApiUserPreferenceWriter.cs:29`). It is instantiated once, inline in the `PutAsJsonAsync` call (`ApiUserPreferenceWriter.cs:65`).
- **Why it's built this way**: Nesting it privately keeps a serialization detail from leaking into the package API, and a positional record needs no mapper.
- **Where it's used**: Only in `ApiUserPreferenceWriter.SaveAsync` (`ApiUserPreferenceWriter.cs:63-66`).

---

### ApiUserPreferenceWriter

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ApiUserPreferenceWriter.cs:22` · Level 1 · class (sealed)

- **What it is**: The default [IUserPreferenceWriter](#iuserpreferencewriter): it PUTs the culture/theme choice to `auth/preferences` through the shared `"APIClient"`, and it declines to make the call at all when the request is already known to be doomed.
- **Depends on**: [IUserPreferenceWriter](#iuserpreferencewriter) (implemented), [ITokenStorageService](#itokenstorageservice), [JwtTokenInfo](#jwttokeninfo), and the nested [UserPreferencesRequest](#userpreferencesrequest). Externals: `IHttpClientFactory` and `System.Net.Http.Json`.
- **Concept introduced**: **Best-effort writes still have a cost.** `[Rubric §13, Observability & Operability]` assesses whether the system's own traffic keeps its signals meaningful; the class comment (`ApiUserPreferenceWriter.cs:13-18`) makes the argument explicitly. Because the caller never learns the write failed, a doomed request cannot help the user and still lands in failed-request telemetry, and at low traffic one 401 per theme or culture toggle is enough on its own to trip a failed-request alert rule. So both guards below exist for the alerting story, not for the user's story. `[Rubric §11, Security]` also touches this: the writer never inspects or forwards the token itself, it only asks whether one is usable.
- **Walkthrough**: The primary constructor takes `IHttpClientFactory` and `ITokenStorageService` (`ApiUserPreferenceWriter.cs:22-24`). `ExpirySkew` is 30 seconds and is documented as matching the token-storage skew so this class agrees with the layer that does the refreshing (`ApiUserPreferenceWriter.cs:27`). `_rejectedToken` (`ApiUserPreferenceWriter.cs:37`) holds the token the API last refused, for the lifetime of this scoped writer. `SaveAsync` (`ApiUserPreferenceWriter.cs:40`) reads the access token (`ApiUserPreferenceWriter.cs:42`), then applies guard one: `JwtTokenInfo.IsFresh(token, ExpirySkew)` (`ApiUserPreferenceWriter.cs:47`), which the comment notes also covers null and unreadable tokens, making it the anonymous-user guard as well. Guard two compares the current token against `_rejectedToken` with `StringComparison.Ordinal` (`ApiUserPreferenceWriter.cs:55`); the comment explains why expiry alone is not enough, since a token can be unexpired and still rejected (revoked session, rotated signing key, a user the API now treats as gone). The call itself is a `PutAsJsonAsync` to the relative `auth/preferences` (`ApiUserPreferenceWriter.cs:63-66`), and a `401 Unauthorized` latches `_rejectedToken` (`ApiUserPreferenceWriter.cs:68-71`). Both `HttpRequestException` (`ApiUserPreferenceWriter.cs:73`) and `TaskCanceledException` (`ApiUserPreferenceWriter.cs:77`) are swallowed, each with a comment noting that the cookie already holds the choice for this device.
- **Why it's built this way**: [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) and [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html) make the local cookie the runtime channel and this write a roaming extra. Storing the rejected *token* rather than setting a boolean latch is the deliberate detail (`ApiUserPreferenceWriter.cs:33-36`): a fresh sign-in produces a different token, so writing resumes with no reset step and no staleness of its own.
- **Where it's used**: Registered with `TryAddScoped` in [DependencyInjection](#dependencyinjection) (`DependencyInjection.cs:100`); resolved optionally by the theme toggle (`ThemeToggle.razor:23-26`) and the culture switcher (`CultureSwitcher.razor:38-41`).

---

### AuthenticatedServiceBase

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/AuthenticatedServiceBase.cs:15` · Level 1 · class (abstract)

- **What it is**: The base class every UI-side HTTP service inherits: it supplies one shared Polly retry policy, a helper that hands back an `HttpClient` with the bearer token already attached, and the idempotency-key generator that makes those retries safe.
- **Depends on**: [ITokenStorageService](#itokenstorageservice); it also names [AuthDelegatingHandler](#authdelegatinghandler) in its documentation as the thing it deliberately bypasses. Externals: `IHttpClientFactory`, `Polly` / `Polly.Retry`.
- **Concept introduced**: **Why a base class and not just the handler pipeline.** `[Rubric §29, Resilience & Business Continuity]` assesses whether transient failures are absorbed rather than surfaced; the retry policy is that. The more interesting teaching is in the `CreateAuthenticatedClientAsync` doc comment (`AuthenticatedServiceBase.cs:51-56`): `IHttpClientFactory` creates its handlers in a **separate DI scope** from the Blazor circuit, so a `DelegatingHandler` cannot reach the circuit's `IJSRuntime` to read the in-memory access token. The base class works around that by reading the token from the circuit-scoped storage service itself and setting the header directly. `[Rubric §9, API & Contract Design]` covers the idempotency half: retrying a POST is only safe if the server can recognize the repeat, which is what [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) provides.
- **Walkthrough**: `RetryPolicy` is a `static readonly AsyncRetryPolicy<HttpResponseMessage>` (`AuthenticatedServiceBase.cs:26-32`): it handles `HttpRequestException` or a retryable response, retries 3 times with `2^attempt` seconds of backoff (2s, 4s, 8s) plus up to one second of random jitter so a fleet of clients does not re-converge on the same instant. The `S2245`/`CA5394` suppression above it (`AuthenticatedServiceBase.cs:19`) documents that the randomness only spaces retries and feeds no security decision. Both constructor arguments are null-checked into private fields (`AuthenticatedServiceBase.cs:35-36`). `NewIdempotencyKey()` (`AuthenticatedServiceBase.cs:49`) returns a compact `Guid.NewGuid().ToString("N")`, and its remarks (`AuthenticatedServiceBase.cs:41-47`) carry the load-bearing rule: the value is generated **once per logical operation and reused across every retry attempt**, because the server-side idempotency filter keys its cached response off it. Generating a new key per attempt would defeat the dedup entirely and let a retry create a duplicate record. `CreateAuthenticatedClientAsync()` (`AuthenticatedServiceBase.cs:57`) resolves the `"APIClient"`, reads the token (`AuthenticatedServiceBase.cs:63`), sets `Authorization: Bearer` when non-blank (`AuthenticatedServiceBase.cs:66-67`), and catches `InvalidOperationException` to proceed without a token during SSR prerender, when JS interop is unavailable (`AuthenticatedServiceBase.cs:70-73`). `IsRetryableResponse` (`AuthenticatedServiceBase.cs:89`) is the retry predicate: it first excludes `501 Not Implemented` and `505 HTTP Version Not Supported` (`AuthenticatedServiceBase.cs:91-94`) because, as the remarks explain, those are permanent verdicts and retrying only burns the budget and delays the error the caller needs to see, then accepts anything `>= 500` plus `408 Request Timeout` and `429 Too Many Requests` (`AuthenticatedServiceBase.cs:96-97`), the two codes where the server is explicitly inviting a later attempt.
- **Why it's built this way**: The scope mismatch is a real Blazor Server constraint, not a preference, so the workaround has to live somewhere every service shares. Putting the retry policy in a `static readonly` field means one policy instance for the whole app rather than one per service instance per circuit. The retry ceiling and jitter line up with the resilience posture in [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html).
- **Where it's used**: Inherited by [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:28`), [ChildEntityServiceBase](#childentityservicebase) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ChildEntityServiceBase.cs:20`) and [NotificationInboxService](#notificationinboxservice) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationInboxService.cs:19`), and through them by every module-level UI service in the consumer apps.

---

### EndpointCultureApplier

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EndpointCultureApplier.cs:18` · Level 1 · class (sealed)

- **What it is**: The Blazor Web implementation of [ICultureApplier](#icultureapplier): it force-navigates to the server's `GET /culture/set` endpoint, which writes the culture cookie and redirects the user back to where they were.
- **Depends on**: [ICultureApplier](#icultureapplier) (implemented) and `Microsoft.AspNetCore.Components.NavigationManager`. It pairs with the server endpoint mapped by `MapCultureEndpoint()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:162`, the `MapGet("/culture/set", ...)` at `WebApplicationExtensions.cs:167`) and with [MmcaCultureBootstrap](#mmcaculturebootstrap) on the WASM side.
- **Concept introduced**: **Why the full page reload is deliberate.** `[Rubric §27, Internationalization]` assesses whether a locale switch is coherent across every rendering path; the class comment (`EndpointCultureApplier.cs:8-10`) says the force-load is load-bearing, because the server has to re-render SSR under the new cookie and the WASM runtime has to re-read it on startup, which keeps prerender and hydration on the same culture. A soft, client-only switch would leave the two disagreeing and show a locale flash on the next full load.
- **Walkthrough**: `ApplyAsync` (`EndpointCultureApplier.cs:21`) rejects a null or whitespace culture up front with `ArgumentException.ThrowIfNullOrWhiteSpace` (`EndpointCultureApplier.cs:23`), falls back to `"/"` for an empty return path (`EndpointCultureApplier.cs:25`), and builds the URL with `Uri.EscapeDataString` on both values (`EndpointCultureApplier.cs:26`) so a return path containing a query string survives round-tripping. It then calls `navigation.NavigateTo(url, forceLoad: true)` (`EndpointCultureApplier.cs:30`) and returns `Task.CompletedTask` (`EndpointCultureApplier.cs:31`): the method is synchronous in substance, `Task`-shaped only because the interface must also fit asynchronous heads. The inline comment (`EndpointCultureApplier.cs:28-29`) notes that validating the culture is the endpoint's job: an unsupported value lands the user back on the same page unchanged rather than failing.
- **Why it's built this way**: [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html). The class comment (`EndpointCultureApplier.cs:12-15`) also records the boundary of its validity: a head with no ASP.NET pipeline would route `/culture/set` through the Blazor `Router`, match no page, and render the not-found page, which is exactly why MAUI heads register their own applier after `AddUIShared`.
- **Where it's used**: Registered as the default with `TryAddScoped<ICultureApplier, EndpointCultureApplier>()` (`DependencyInjection.cs:97`), with the comment there recording that `UseMauiDeviceCapabilities` overrides it afterwards. The MAUI replacement is [MauiCultureApplier](group-26-device-capability-layer.md#mauicultureapplier) (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/HostingDependencyInjection.cs:118`).

---

### IUserPreferenceReader

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/IUserPreferenceReader.cs:9` · Level 1 · interface

- **What it is**: The read half of cross-device preferences: fetches the signed-in user's stored culture and theme, used at login to reapply a returning user's choices on a new device.
- **Depends on**: [UserPreferences](#userpreferences) (its return type); implemented by [ApiUserPreferenceReader](#apiuserpreferencereader). The write half is [IUserPreferenceWriter](#iuserpreferencewriter).
- **Concept introduced**: Nothing new; it mirrors the best-effort contract the writer introduced. The doc comment (`IUserPreferenceReader.cs:5-7`) pins the failure mode: implementations return an empty `UserPreferences` (both fields null) for anonymous users or on any error, so a failed read never blocks login. `[Rubric §19, State Management & Data Flow]` applies, since this is the moment the roaming copy is reconciled against the local one.
- **Walkthrough**: `GetAsync(CancellationToken cancellationToken = default)` returning `Task<UserPreferences>` (`IUserPreferenceReader.cs:13`). There is no failure channel in the signature at all, which is the contract making itself unmistakable.
- **Why it's built this way**: [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) and [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html). A `Result<T>` here would invite a caller to surface an error the user cannot act on during a login they just completed successfully.
- **Where it's used**: Injected by the login page (`Login.razor:13`) and read once in `ApplyStoredPreferencesAndNavigateAsync` (`Login.razor:196-206`), which applies the theme through [ThemeService](#themeservice) and the culture through [ICultureApplier](#icultureapplier), skipping the culture round-trip when the stored value already matches the current one.

---

### ListPageQueryStateService

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ListPageQueryStateService.cs:28` · Level 1 · class (sealed)

- **What it is**: The two-way translator between a [ListPageState](#listpagestate) and the browser address bar, so browser back/forward, a refresh, and a link pasted into chat all restore the same filtered, sorted, paged view.
- **Depends on**: [ListPageState](#listpagestate); externals `NavigationManager`, `Microsoft.AspNetCore.WebUtilities.QueryHelpers`, and `StringValues`.
- **Concept introduced**: **The URL as shareable state.** `[Rubric §25, Navigation & Information Architecture]` assesses whether the address bar reflects what the user is looking at; this class is that contract for every list page. The remarks (`ListPageQueryStateService.cs:15-26`) document the reserved keys and why they are terse (they end up in shareable links): `p` (0-indexed desktop page), `ps` (page size), `mp` (1-indexed mobile page), `s` (sort column), `sd` (`desc` only, since ascending is the default), `d` (`1` only, since comfortable density is the default), `q` (free-text search) and `f:<name>` for any other named filter. Defaults are omitted entirely, so a pristine list page has a clean URL. `[Rubric §19, State Management & Data Flow]` applies because this is the second of the three transports the same record travels over.
- **Walkthrough**: The key names are private constants (`ListPageQueryStateService.cs:30-40`), including the `"search"` filter name that maps to `q` by convention and the `desc`/`1` markers. `ReadCurrent()` (`ListPageQueryStateService.cs:45-49`) is the instance entry point: it resolves the absolute URI from the injected `NavigationManager` and hands the query to the parser. `ParseQueryString` (`ListPageQueryStateService.cs:56`) is deliberately `static` and public, documented as a pure helper exposed for unit testing without a `NavigationManager`; it reads the three integers through `TryGetInt` (`ListPageQueryStateService.cs:212-222`, which parses with `CultureInfo.InvariantCulture` and falls back to the supplied default rather than throwing), treats a blank sort value as no sort (`ListPageQueryStateService.cs:65-72`), matches `desc` case-insensitively but the dense marker `1` ordinally (`ListPageQueryStateService.cs:77` and `ListPageQueryStateService.cs:83`), then walks every remaining key, folding `q` into the `search` filter and stripping the `f:` prefix off the rest (`ListPageQueryStateService.cs:87-103`). `BuildPath` (`ListPageQueryStateService.cs:122`) is the inverse and the omission rules are visible one by one: page only when `> 0` (`ListPageQueryStateService.cs:129`), mobile page only when `> 1` (`ListPageQueryStateService.cs:139`), `sd` only when a sort column exists and is descending (`ListPageQueryStateService.cs:144-151`), `d` only when dense (`ListPageQueryStateService.cs:153`); with no parameters at all it returns the bare base path (`ListPageQueryStateService.cs:175-177`). `ReplaceState` (`ListPageQueryStateService.cs:196`) writes the URL back using `NavigationOptions { ReplaceHistoryEntry = true }` (`ListPageQueryStateService.cs:209`) so filter changes do not pollute the back stack.
- **Why it's built this way**: The most instructive part is the guard in `ReplaceState` (`ListPageQueryStateService.cs:201-206`), which drops the write when the current path no longer matches the owning `basePath`. The remarks (`ListPageQueryStateService.cs:186-195`) record the diagnosed defect: a grid-state write is inherently deferred (a debounced search, a late `ServerData` completion), so it can land after the user has already navigated away. Building from the then-current URI used to stamp grid parameters onto the **next** page's URL and issue a spurious navigation that disposed it mid-load, and detail pages reached by clicking a list row had their first data fetch canceled about 66ms in, leaving them stuck on their loading state.
- **Where it's used**: Registered `TryAddScoped` (`DependencyInjection.cs:87`) and injected into [DataGridListPageBase<TDto>](#datagridlistpagebasetdto) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:26`), which reads the URL on initialization and on parameter changes (`DataGridListPageBase.cs:168` and `DataGridListPageBase.cs:229`) and writes it back after a grid or filter change (`DataGridListPageBase.cs:654` and `DataGridListPageBase.cs:696`).

---

### ListPageStateService

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ListPageStateService.cs:58` · Level 1 · class (sealed)

- **What it is**: The per-circuit memory of list-page state, keyed by route, with an optional write-through to `sessionStorage` so the state survives things a circuit-scoped dictionary cannot.
- **Depends on**: [ListPageState](#listpagestate) and [LazyJsModule](#lazyjsmodule); externals `IJSRuntime`, `IJSObjectReference`, and the `nav-interop.js` module shipped in the package's `wwwroot`.
- **Concept introduced**: **A synchronous fast path with an asynchronous durable path.** `[Rubric §19, State Management & Data Flow]` assesses how state survives lifecycle boundaries; this class answers with two tiers. The class comment (`ListPageStateService.cs:50-57`) names exactly what the durable tier buys: state survives circuit teardowns, `forceLoad: true` navigations, and the SSR to WASM render-mode transition. The synchronous dictionary matters just as much, because it is safe to read from `OnInitialized` during prerender, when JS interop does not exist yet.
- **Walkthrough**: Two constants set the contract: the module path `./_content/MMCA.Common.UI/nav-interop.js` (`ListPageStateService.cs:60`) and the `mmca.lps:` session-key prefix (`ListPageStateService.cs:61`). State is a plain `Dictionary<string, ListPageState>` (`ListPageStateService.cs:63`) plus one [LazyJsModule](#lazyjsmodule) (`ListPageStateService.cs:64`). `GetState` (`ListPageStateService.cs:71-72`) is a `GetValueOrDefault` and is documented as safe to call during SSR prerender. `SaveState` (`ListPageStateService.cs:79-80`) stores in memory only. `UpdateScrollPosition` (`ListPageStateService.cs:87-90`) is the fast path for scroll events: it uses a `with` expression to preserve every other field, and creates a minimal entry when none exists yet, for the case where the user scrolls before the grid has fired its first save. `HydrateFromSessionAsync` (`ListPageStateService.cs:98`) invokes `sessionGet` on the JS module (`ListPageStateService.cs:108`, the export at `MMCA.Common/Source/Presentation/MMCA.Common.UI/wwwroot/nav-interop.js:12`) and adopts any persisted snapshot; `PersistToSessionAsync` (`ListPageStateService.cs:133`) does the reverse through `sessionSet` (`ListPageStateService.cs:148`, `nav-interop.js:24`), returning early when there is nothing in memory to write. Both wrap the interop in the same three-catch shape: `InvalidOperationException` for prerender, `JSDisconnectedException` for a torn-down circuit, and `JSException` as the defensive catch for storage failures such as Safari Private mode or an exceeded quota (`ListPageStateService.cs:114-125` and `ListPageStateService.cs:150-161`). The private `GetModuleAsync` (`ListPageStateService.cs:164-178`) converts an unavailable runtime into a `null` module rather than an exception, which is what makes the two public methods' early returns read cleanly. `DisposeAsync` (`ListPageStateService.cs:181`) simply forwards to the module wrapper.
- **Why it's built this way**: The degradation contract here is "never let storage failures break the calling page", which is why this class swallows what [LazyJsModule](#lazyjsmodule) deliberately does not. Scoped registration means one instance per circuit, so the in-memory dictionary is naturally per-user without any keying by identity.
- **Where it's used**: Registered `TryAddScoped` (`DependencyInjection.cs:86`) and injected into [DataGridListPageBase<TDto>](#datagridlistpagebasetdto) (`DataGridListPageBase.cs:25`), which reads it during state restore (`DataGridListPageBase.cs:170`), hydrates from session on first render (`DataGridListPageBase.cs:292-297`), records scroll offsets (`DataGridListPageBase.cs:348`), and saves plus persists after grid and density changes (`DataGridListPageBase.cs:649-660` and `DataGridListPageBase.cs:691-700`).

---

### MmcaCultureBootstrap

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/MmcaCultureBootstrap.cs:14` · Level 1 · class (static)

- **What it is**: The Blazor WebAssembly culture bootstrap: it reads the same ASP.NET culture cookie the server used for SSR prerender and sets the WASM runtime's default thread cultures before the host starts running.
- **Depends on**: `SupportedCultures` from the Shared layer ([SupportedCultures](group-12-api-hosting-mapping.md#supportedcultures)) and the `culture.js` module in the package's `wwwroot`. Externals: `IJSRuntime`, `CultureInfo`.
- **Concept introduced**: **Closing the prerender/hydration culture gap.** `[Rubric §27, Internationalization]` assesses whether every rendering path resolves the same locale; the class comment (`MmcaCultureBootstrap.cs:8-12`) states the outcome this buys: the interactive client renders in the same language the server prerendered, with no locale flash and no prerender/hydration mismatch. `[Rubric §23, Front-End Performance]` applies too, because the alternative (letting the client discover the culture after first render) costs a visible re-render of the whole page.
- **Walkthrough**: One method, `SetBrowserCultureAsync(IJSRuntime jsRuntime)` (`MmcaCultureBootstrap.cs:22`), null-guarded at `MmcaCultureBootstrap.cs:24`. It imports `./_content/MMCA.Common.UI/culture.js` under an `await using` (`MmcaCultureBootstrap.cs:26-27`), so the module reference is released as soon as the one call is done: unlike the long-lived services, this runs once at startup and has no reason to hold it. It calls `getCulture` (`MmcaCultureBootstrap.cs:28`), whose JS side parses the `.AspNetCore.Culture` cookie's `uic=` segment and returns null when the cookie is absent or unparseable (`MMCA.Common/Source/Presentation/MMCA.Common.UI/wwwroot/culture.js:4-23`). The returned value is filtered through `SupportedCultures.IsSupported` and falls back to `SupportedCultures.Default` otherwise (`MmcaCultureBootstrap.cs:30`; the allowlist is `MMCA.Common/Source/Core/MMCA.Common.Shared/Globalization/SupportedCultures.cs:18` and the default `"en-US"` is at `SupportedCultures.cs:12`). It then assigns **only** `CultureInfo.DefaultThreadCurrentCulture` and `CultureInfo.DefaultThreadCurrentUICulture` (`MmcaCultureBootstrap.cs:32-33`), never `CurrentCulture`/`CurrentUICulture` directly: setting the defaults makes every subsequently created thread inherit the culture, which is what a later switch needs in order to take effect.
- **Why it's built this way**: [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html). The cookie is deliberately non-HttpOnly for exactly this reader, a decision recorded in the suppression comment on the server side (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:171`), which names `MmcaCultureBootstrap.SetBrowserCultureAsync` as the consumer. The doc comment (`MmcaCultureBootstrap.cs:11-12`) also pins the call ordering: it must run after `builder.Build()` and before `host.RunAsync()`.
- **Where it's used**: Both Blazor Web clients call it exactly as documented: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:86` and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:69`. Its MAUI counterpart is `MauiCultureInitializer` ([MauiCultureInitializer](group-26-device-capability-layer.md#mauicultureinitializer)), which the class comment there names as the hybrid equivalent.

---

### ThemeService

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ThemeService.cs:16` · Level 1 · class (sealed)

- **What it is**: The single owner of the Day/Dark preference: it holds the current mode, persists it, and raises an event so the theme provider and the toggle button never disagree about which mode is active.
- **Depends on**: [LazyJsModule](#lazyjsmodule) and the `theme.js` module; externals `IJSRuntime` and `IAsyncDisposable`.
- **Concept introduced**: **One source of truth plus an event, instead of cascading parameters.** `[Rubric §20, Design System & Theming]` assesses whether theming is centralized and switchable rather than scattered across components; this class is the switch point, and MudBlazor's `MudThemeProvider` is downstream of it. `[Rubric §19, State Management & Data Flow]` covers the notification shape: `OnChange` is a plain `EventHandler`, so any number of components can subscribe and re-render without the state having to be threaded through the component tree. The first-visit default is the OS `prefers-color-scheme`, used only when nothing is stored (`ThemeService.cs:8-9`).
- **Walkthrough**: The module path is `./_content/MMCA.Common.UI/theme.js` (`ThemeService.cs:18`) and the reference is held through a [LazyJsModule](#lazyjsmodule) (`ThemeService.cs:19`). `IsDarkMode` (`ThemeService.cs:22`) and `IsInitialized` (`ThemeService.cs:25`) both have private setters, so the only way to change the mode is through the methods; `OnChange` (`ThemeService.cs:28`) is the notification. `InitializeAsync` (`ThemeService.cs:34`) is idempotent by an early return on `IsInitialized` (`ThemeService.cs:36-39`), asks JS for the stored value (`ThemeService.cs:42`), compares it to `"dark"` case-insensitively, and only when nothing is stored falls back to `systemPrefersDark` (`ThemeService.cs:43-45`); it sets the flag and raises `OnChange` last (`ThemeService.cs:47-48`). `SetDarkModeAsync` (`ThemeService.cs:53`) updates the property first, then persists through the module's `set` export, then notifies (`ThemeService.cs:55-58`). `ToggleAsync` (`ThemeService.cs:62`) is `SetDarkModeAsync(!IsDarkMode)`. `DisposeAsync` (`ThemeService.cs:67`) forwards to the module wrapper. The JS side is worth reading with it: the value is written to a non-HttpOnly `mmca_theme` cookie with a one-year max-age and mirrored into localStorage (`MMCA.Common/Source/Presentation/MMCA.Common.UI/wwwroot/theme.js:23-31`), and the read prefers the cookie, falling back to localStorage (`theme.js:5-21`). The cookie is what lets SSR pick the right theme for a no-flash first paint (`theme.js:1-2`).
- **Why it's built this way**: [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html). The doc comment (`ThemeService.cs:11-13`) states the one lifecycle rule that matters: JS interop is only available after the first interactive render, so `InitializeAsync` must be called from `OnAfterRenderAsync(firstRender: true)` and never during SSR prerender.
- **Where it's used**: Registered `TryAddScoped` (`DependencyInjection.cs:91`). `MmcaThemeProviders.razor` owns the lifecycle in one place: it subscribes on initialize (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/MmcaThemeProviders.razor:20`) and calls `InitializeAsync` on first render (`MmcaThemeProviders.razor:27-28`). `ThemeToggle.razor` subscribes and toggles (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/ThemeToggle.razor:16` and `ThemeToggle.razor:20`), then best-effort persists the new theme through [IUserPreferenceWriter](#iuserpreferencewriter) (`ThemeToggle.razor:23-26`). The login page uses `SetDarkModeAsync` to apply a returning user's stored theme (`Login.razor:202`).
- **Caveats / not-in-source**: Unlike [ListPageStateService](#listpagestateservice), this class does not swallow JS interop failures: `GetModuleAsync` (`ThemeService.cs:64`) delegates straight to the module wrapper, so calling `InitializeAsync` during prerender surfaces the exception to the caller. The render-timing rule is a contract the components have to honor, not something the service defends against.

---

### ApiUserPreferenceReader

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ApiUserPreferenceReader.cs:14` · Level 2 · class (sealed)

- **What it is**: The default [IUserPreferenceReader](#iuserpreferencereader): a GET of `auth/preferences` through the shared `"APIClient"` that degrades to empty preferences on every failure path.
- **Depends on**: [IUserPreferenceReader](#iuserpreferencereader) (implemented), [UserPreferences](#userpreferences), [ITokenStorageService](#itokenstorageservice), [JwtTokenInfo](#jwttokeninfo). Externals: `IHttpClientFactory` and `System.Net.Http.Json`.
- **Concept introduced**: Nothing new; it is the read-side mirror of [ApiUserPreferenceWriter](#apiuserpreferencewriter) and reuses the same freshness guard for the same reason. The comment at `ApiUserPreferenceReader.cs:28-30` makes the symmetry explicit: an expired or unreadable token buys a guaranteed 401, and because this read is best-effort the caller cannot act on the failure either way, so the request is not worth making. `[Rubric §13, Observability & Operability]` applies for the same telemetry-hygiene reason the writer documents at length.
- **Walkthrough**: A static `Empty` instance (`ApiUserPreferenceReader.cs:18`) is the single degraded return value, so every failure path returns the same object rather than allocating. `ExpirySkew` is 30 seconds, again documented as matching the token-storage skew (`ApiUserPreferenceReader.cs:21`). `GetAsync` (`ApiUserPreferenceReader.cs:24`) reads the token (`ApiUserPreferenceReader.cs:26`), returns `Empty` when `JwtTokenInfo.IsFresh` says no, which also covers the anonymous null case (`ApiUserPreferenceReader.cs:31-34`), and otherwise calls `GetFromJsonAsync<UserPreferences>` against the relative `auth/preferences` (`ApiUserPreferenceReader.cs:39-41`). A `null` deserialization result coalesces to `Empty` (`ApiUserPreferenceReader.cs:42`), and `HttpRequestException` and `TaskCanceledException` each return `Empty` rather than propagating (`ApiUserPreferenceReader.cs:44-51`).
- **Why it's built this way**: [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) and [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html). Login reconciliation is a nicety layered on a successful sign-in; the shape of this class guarantees it can never turn into a login failure.
- **Where it's used**: Registered `TryAddScoped` (`DependencyInjection.cs:101`); injected into the login page (`Login.razor:13`) and read once per login in `ApplyStoredPreferencesAndNavigateAsync` (`Login.razor:198`).
- **Caveats / not-in-source**: Unlike the writer it keeps no rejected-token memory, which is a reasonable asymmetry given it runs once per login rather than once per toggle, but it is a difference between the two classes rather than a shared pattern.

### ServiceExceptionHelper
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ServiceExceptionHelper.cs:11` · Level 2 · class (static)

- **What it is**: the client-side half of the API error contract. It inspects a non-success HTTP
  response body for the Problem Details payloads the WebAPI emits and re-throws them as a
  [`DomainInvariantViolationException`](group-01-result-error-handling.md#domaininvariantviolationexception)
  carrying the server's own message, so a page can show "Session already has that speaker" instead of
  "Response status code does not indicate success".
- **Depends on**:
  [`DomainInvariantViolationException`](group-01-result-error-handling.md#domaininvariantviolationexception)
  (`ServiceExceptionHelper.cs:2`); `System.Text.Json` (BCL) for the parse. Nothing else: it is a static
  class with no state and no DI surface, which is why every UI service base can call it for free.
- **Concept introduced, reading the Problem Details contract from the client side.**
  `[Rubric §9, API & Contract Design]` assesses whether errors travel as a structured, versionable
  payload rather than a status code plus prose. The server side of that contract has three producers
  and this helper branches on the `title` each one writes: `"Domain Exception"` from
  [`DomainExceptionHandler`](group-12-api-hosting-mapping.md#domainexceptionhandler)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/DomainExceptionHandler.cs:40`),
  `"Validation Exception"` from
  [`ValidationExceptionHandler`](group-12-api-hosting-mapping.md#validationexceptionhandler)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ValidationExceptionHandler.cs:41`), and
  `"Operation failed"` from
  [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase)`.HandleFailure` when an
  [`Error`](group-01-result-error-handling.md#error) list comes back from a handler
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:43`). The title
  string is the discriminator, matched with `StringComparison.Ordinal`
  (`ServiceExceptionHelper.cs:49,52,55`), so the three producers and this consumer are coupled by an
  exact literal on both ends. `[Rubric §10, Cross-Cutting Concerns]` also applies: error translation
  lives in one place instead of in each page's `catch`.
- **Walkthrough**
  - `ThrowIfDomainExceptionAsync(HttpResponseMessage, CancellationToken)` (`ServiceExceptionHelper.cs:17`)
    is the only public member. It null-guards the response (line 19), returns immediately when there is
    no content or the body is blank (lines 21-26), and reads the body as a string (line 24).
  - The parse is defensive: `JsonDocument.Parse` is wrapped in a `try` that swallows `JsonException`
    and returns (lines 29-38). The comment names the cases that reach it, a bare 401 challenge or an
    HTML error page, and states the contract with the caller: a non-JSON failure falls through to the
    caller's own `EnsureSuccessStatusCode()`. Nothing is thrown here that the caller was not already
    going to throw.
  - `using (document)` (line 40) disposes the parsed document on every exit path, including the throw
    paths below, because the exception is constructed from strings already extracted.
  - No `title` property means "not one of ours": return and let the caller decide (lines 44-45).
  - `"Domain Exception"` takes the simple path, `ExtractDetailMessage(root, "A domain error occurred.")`
    (line 50), which reads `detail` or falls back (lines 60-63).
  - `"Validation Exception"` goes through `ExtractValidationMessage` (lines 65-83). The server writes
    `errors` as an object keyed by property name whose values are arrays of messages, so the helper
    walks `EnumerateObject()` then `EnumerateArray()` (lines 72-76) and joins every message with a
    single space (line 79). The joined string replaces the `detail` fallback only when at least one
    message was found (line 78).
  - `"Operation failed"` goes through `ExtractOperationFailedMessage` (lines 85-98), which expects a
    different shape: `errors` is a JSON **array** of error objects, not an object of arrays (line 89).
    `CollectErrorMessages` (lines 100-114) pulls the `message` property off each element, skipping
    blanks. That shape is what `ErrorHttpMapping.BuildErrorsExtension` projects from an `Error` list
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:47-55`), which is
    why the two `errors` branches cannot share code.
- **Why it's built this way**: the alternative is a shared error DTO deserialized with a strongly typed
  model, but the three payloads differ in the shape of `errors` and the helper must stay tolerant of
  bodies that are not Problem Details at all (proxies, gateways, auth challenges). Reading the document
  loosely and returning quietly on anything unrecognized means the helper can be called
  unconditionally before `EnsureSuccessStatusCode()` without ever changing behavior for responses it
  does not understand. Collapsing all three onto one exception type is deliberate too: pages catch one
  thing and display `ex.Message`.
- **Where it's used**: called on every non-success response by both service bases in this group,
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](#entityservicebasetentitydto-tidentifiertype)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:211`) and
  [`ChildEntityServiceBase`](#childentityservicebase)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ChildEntityServiceBase.cs:31,52`), plus the
  hand-written services that use neither base:
  [`NotificationInboxService`](#notificationinboxservice) in this package, and the module UI services in
  ADC (Engagement check-in, points, feedback, bookmarks, live polls) and Store (cart state). Its
  behavior is pinned by
  [`ServiceExceptionHelperTests`](group-27-testing-infrastructure.md#serviceexceptionhelpertests).
- **Caveats**: the whole body is buffered into a string before parsing (line 24), so a very large error
  payload is fully materialized; error bodies are small in practice, but there is no size guard in
  source. The `title` match is exact and case-sensitive, so a producer that renames a title silently
  degrades every client to the generic `HttpRequestException` path.

### ChildEntityServiceBase
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ChildEntityServiceBase.cs:17` · Level 3 · class (abstract)

- **What it is**: the two-verb service base for join entities, the many-to-many rows a UI can create and
  delete but never lists or edits on their own. It offers exactly `PostAsync` and `DeleteByIdAsync` over
  the named `"APIClient"`, and nothing else.
- **Depends on**: [`AuthenticatedServiceBase`](#authenticatedservicebase) (base class, supplying the
  authenticated client factory and the retry policy), [`ITokenStorageService`](#itokenstorageservice)
  (constructor parameter, passed straight through), [`ServiceExceptionHelper`](#serviceexceptionhelper);
  `IHttpClientFactory` and `System.Net.Http.Json` (BCL).
- **Concept introduced, a base class shaped by the resource rather than by convention.**
  `[Rubric §18, UI Architecture & Component Design]` assesses whether the presentation layer talks to the
  backend through typed services rather than raw `HttpClient` calls in components. The interesting design
  choice here is what is **absent**: a join row like `SessionSpeaker` has no list page, no edit form and
  no lookup, so this base deliberately does not implement
  [`IEntityService<TEntityDTO, TIdentifierType>`](#ientityservicetentitydto-tidentifiertype). Giving join
  services the full CRUD surface would hand pages six operations of which four have no endpoint behind
  them. `[Rubric §1, SOLID]` reads this as interface segregation applied at the service-base level: the
  smaller base cannot promise what the API does not serve.
- **Walkthrough**
  - The primary constructor takes `IHttpClientFactory`, `ITokenStorageService` and a `string endpoint`,
    forwarding the first two to `AuthenticatedServiceBase` (`ChildEntityServiceBase.cs:17-20`). The
    endpoint is captured as a primary-constructor parameter rather than exposed as a property, so
    subclasses cannot rewrite it after construction; contrast
    [`EntityServiceBase<TEntityDTO, TIdentifierType>`](#entityservicebasetentitydto-tidentifiertype),
    which surfaces `protected string Endpoint { get; }` because its own methods build sub-paths from it.
  - `PostAsync<TRequest>(TRequest request, CancellationToken)` (line 24) creates an authenticated client
    with `using var` (line 26), POSTs the payload as JSON to the relative endpoint URI (line 27), calls
    [`ServiceExceptionHelper.ThrowIfDomainExceptionAsync`](#serviceexceptionhelper) on a non-success
    status (lines 29-32), then `EnsureSuccessStatusCode()` (line 34) and returns the raw
    `HttpResponseMessage`. Returning the response rather than a DTO is what lets each subclass decide how
    to read the body. `TRequest` is generic precisely because join payloads are usually anonymous objects
    (the doc comment says so at line 23).
  - `DeleteByIdAsync(string id, CancellationToken)` (line 39) builds `"{endpoint}/{id}"` (line 42) and
    treats `404 NotFound` as `false` rather than an exception (lines 45-48), so "already gone" is a
    result, not a failure. Other non-success statuses go through the same domain-error extraction and
    `EnsureSuccessStatusCode()` (lines 50-55) before returning `true`.
  - The id parameter is a `string`, not a generic identifier type: subclasses format their own typed id
    before calling, for example `id.ToString(CultureInfo.InvariantCulture)` in
    `EventSpeakerService.DeleteAsync`
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:24`).
- **Why it's built this way**: join endpoints sit behind `[Authorize]` exactly like their parent CRUD
  endpoints, so they need the same Bearer-token plumbing and the same domain-error translation, but none
  of the paging, filtering or lookup machinery. Deriving from
  [`AuthenticatedServiceBase`](#authenticatedservicebase) rather than from
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](#entityservicebasetentitydto-tidentifiertype)
  reuses the auth path while keeping the surface honest. Note the deliberate asymmetry with its sibling:
  `PostAsync` sends **no** `Idempotency-Key`, so a duplicate join is stopped by the domain invariant and
  the unique index behind it rather than by request deduplication (the opt-in server-side model is
  ADR-017, `Website/docs-src/adr/017-request-idempotency.md`).
- **Where it's used**: four ADC Conference join services derive from it,
  [`EventSpeakerService`](group-21-conference-ui.md#eventspeakerservice) on `eventspeakers`,
  [`SessionSpeakerService`](group-21-conference-ui.md#sessionspeakerservice) on `sessionspeakers`,
  [`SessionCategoryItemService`](group-21-conference-ui.md#sessioncategoryitemservice) on
  `sessioncategoryitems`, and
  [`SpeakerCategoryItemService`](group-21-conference-ui.md#speakercategoryitemservice) on
  `speakercategoryitems`, all four declared in
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:15,31,47,63`.
  Each adds a typed `AddAsync`/`DeleteAsync` pair over the two protected methods and implements its own
  module interface. The base is pinned by
  [`ChildEntityServiceBaseTests`](group-27-testing-infrastructure.md#childentityservicebasetests) through
  a minimal `MembershipService` subclass.
- **Caveats**: `PostAsync` returns the `HttpResponseMessage` after the client it was created from has
  been disposed by the enclosing `using var` (lines 26, 35). Reading the body afterwards works in every
  current subclass because the content is already buffered by the time the call returns, but the
  disposal ordering is a sharp edge a new subclass could cut itself on. Neither method routes through
  `RetryPolicy`: the policy is inherited from [`AuthenticatedServiceBase`](#authenticatedservicebase) but
  never invoked here, so joins are single-attempt.

### EntityServiceBase<TEntityDTO, TIdentifierType>
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:25` · Level 3 · class (abstract)

- **What it is**: the CRUD workhorse of the UI layer. It implements
  [`IEntityService<TEntityDTO, TIdentifierType>`](#ientityservicetentitydto-tidentifiertype) against a
  REST endpoint by turning each operation into a URL plus a one-line HTTP lambda, and funnels every one
  of them through a single dispatch method that owns retry, idempotency, error translation and
  deserialization.
- **Depends on**: [`AuthenticatedServiceBase`](#authenticatedservicebase) (base class),
  [`IEntityService<TEntityDTO, TIdentifierType>`](#ientityservicetentitydto-tidentifiertype)
  (implemented interface),
  [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (the
  `TEntityDTO` constraint, `EntityServiceBase.cs:29`),
  [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype),
  [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) and its
  [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata),
  [`IdempotencyHeaders`](group-08-auth.md#idempotencyheaders),
  [`ITokenStorageService`](#itokenstorageservice),
  [`ServiceExceptionHelper`](#serviceexceptionhelper); Polly (through the inherited `RetryPolicy`) and
  `System.Net.Http.Json` (BCL).
- **Concept introduced, one dispatch point for every cross-cutting HTTP concern.**
  `[Rubric §10, Cross-Cutting Concerns]` assesses whether retry, auth and error handling are applied in
  one place instead of repeated per call: here the six public methods contain only URL construction, and
  `SendRequestAsync<T>` (line 183) contains all of the policy. `[Rubric §19, State Management & Data
  Flow]` applies because components never touch `HttpClient`: they inject the typed interface and receive
  DTOs. `[Rubric §29, Resilience & Business Continuity]` applies through the inherited three-retry
  exponential-backoff-with-jitter policy
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/AuthenticatedServiceBase.cs:26-32`), whose
  predicate retries 5xx plus 408 and 429 but not 501 or 505 (`AuthenticatedServiceBase.cs:108-117`).
- **Concept introduced, retry safety for a non-idempotent verb.** `[Rubric §9, API & Contract Design]`
  assesses whether the client and server share an explicit protocol for duplicate writes. A retry policy
  that re-issues a POST is a correctness hazard: if the first attempt reached the server and only the
  response was lost, the retry creates a second record. `AddAsync` is the one method that passes an
  idempotency key (`EntityServiceBase.cs:135`), generated once per logical operation by
  `AuthenticatedServiceBase.NewIdempotencyKey()` as a compact GUID (`AuthenticatedServiceBase.cs:51`).
  The key is set as a **default request header** on the client (line 199) rather than on an individual
  request, and that one client instance serves every retry attempt, so all attempts carry the identical
  value (the comment at lines 195-198 spells out that this is the point). The server side of the protocol
  is the opt-in [`IdempotencyFilter`](group-12-api-hosting-mapping.md#idempotencyfilter), and both ends
  read the header name from the shared
  [`IdempotencyHeaders`](group-08-auth.md#idempotencyheaders) constant rather than hard-coding the literal
  twice (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/IdempotencyHeaders.cs:19`). Reads, full-PUT
  updates and deletes send no key because they are naturally idempotent (comment at
  `EntityServiceBase.cs:128-130`).
- **Walkthrough**
  - The primary constructor takes `endpoint`, `IHttpClientFactory` and `ITokenStorageService`
    (lines 25-28); note the parameter order differs from
    [`ChildEntityServiceBase`](#childentityservicebase). The endpoint is republished as
    `protected string Endpoint { get; }` (line 32) because the read methods append sub-paths to it. Both
    type parameters are constrained: `TEntityDTO : IBaseDTO<TIdentifierType>` and
    `TIdentifierType : notnull` (lines 29-30).
  - `GetAllAsync(includeFKs, includeChildren, ct)` (line 34) builds a two-parameter query string and
    deserializes into `PagedCollectionResult<TEntityDTO>`, returning `Items` or an empty list
    (lines 46-50). The "all" endpoint returns the paged envelope, not a bare array.
  - `GetPagedAsync(filters, pageNumber, pageSize, sortColumn, sortDirection, includeChildren, ct)`
    (line 53) is the one with real work. Page numbers are formatted with
    `string.Create(CultureInfo.InvariantCulture, ...)` (lines 64-65) so a comma-decimal locale cannot
    corrupt the query, and every filter property, operator and value is passed through
    `Uri.EscapeDataString` (lines 77-79). Filters serialize as `filters[Property].operator=` plus an
    optional `filters[Property].value=`, and a filter whose operator is blank is skipped entirely
    (line 75), which is how a grid clears a column filter. It targets `{Endpoint}/paged` (line 84) and
    returns a tuple of items plus `PaginationMetadata.TotalItemCount` (line 89), the two things a
    server-side data grid needs.
  - `GetAllForLookupAsync(nameProperty, ct)` (line 92) hits `{Endpoint}/lookup` and deserializes
    `CollectionResult<BaseLookup<TIdentifierType>>` (line 97), the lightweight id-plus-name shape that
    feeds dropdowns and autocompletes.
  - `GetByIdAsync(id, includeChildren, ct)` (line 104) is the only read that passes
    `treatNotFoundAsDefault: true` (line 118), so a 404 becomes `null` instead of an exception.
  - `AddAsync(entity, ct)` (line 122) POSTs with `throwIfNull: true` and the idempotency key
    (lines 134-135), and throws again at the call site if the dispatch still returned null (line 136).
  - `UpdateAsync(entity, ct)` (line 139) PUTs to `{Endpoint}/{GetEntityId(entity)}` with
    `expectContent: false` (line 147) and always returns `true`; `DeleteAsync(id, ct)` (line 152) does the
    same for DELETE (lines 157-162). Both rely on the dispatch to throw on failure, so `true` means "no
    exception", not "the server reported a change".
  - `GetEntityId(entity)` (line 165) is `protected virtual` and simply returns `entity.Id`, the hook a
    subclass overrides when the route key is not the DTO's own id.
  - `SendRequestAsync<T>(httpAction, ct, treatNotFoundAsDefault, throwIfNull, expectContent, idempotencyKey)`
    (line 183) is the center of the class. It creates the authenticated client (line 191), attaches the
    idempotency header when one was supplied (lines 193-200), executes the caller's lambda through
    `RetryPolicy` with the cancellation token threaded in so a cancelled operation does not sleep out its
    backoff (lines 202-204), short-circuits 404 to `default` when asked (lines 206-207), calls
    [`ServiceExceptionHelper.ThrowIfDomainExceptionAsync`](#serviceexceptionhelper) **before**
    `EnsureSuccessStatusCode()` so a domain failure surfaces as a readable message (lines 209-213),
    returns `default` when no body is expected (lines 215-216), and finally deserializes and optionally
    null-checks the payload (lines 218-221).
- **Why it's built this way**: passing the HTTP call as a `Func<HttpClient, Task<HttpResponseMessage>>`
  lets each verb stay a two-line method while every policy decision lives once. The ordering inside the
  dispatch is the load-bearing part: domain-error extraction has to run before `EnsureSuccessStatusCode()`
  or the readable message is lost inside a generic `HttpRequestException`, and the idempotency header has
  to be set on the client rather than per request or each retry would carry a different key. All six
  public methods are `virtual`, so a module service overrides only the one that needs domain-specific
  behavior and inherits the rest.
- **Where it's used**: it is the base of essentially every module CRUD service. In this package,
  [`PushNotificationService`](#pushnotificationservice)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/PushNotificationService.cs:19`).
  In ADC Conference, [`EventService`](group-21-conference-ui.md#eventservice),
  [`SessionService`](group-21-conference-ui.md#sessionservice),
  [`SpeakerService`](group-21-conference-ui.md#speakerservice) and
  [`SponsorService`](group-21-conference-ui.md#sponsorservice) among others; in ADC Identity,
  [`UserService`](group-24-identity-module.md#userservice). In Store, `ProductService`, `CategoryService`,
  `OrderService`, `ShoppingCartService`, `InventoryItemService` and `CustomerService`. Behavior is pinned
  by [`EntityServiceBaseTests`](group-27-testing-infrastructure.md#entityservicebasetests) and, for the
  write-safety half, by
  [`EntityServiceBaseIdempotencyRetryTests`](group-27-testing-infrastructure.md#entityservicebaseidempotencyretrytests),
  which asserts the key is emitted on creates only and stays identical across attempts.
- **Caveats**: `UpdateAsync` and `DeleteAsync` return a hard-coded `true` with no path that returns
  `false`, so a caller cannot distinguish "updated" from "server accepted a no-op". `GetAllAsync` has no
  page-size bound in source: it asks the "all" endpoint for everything and materializes the result, which
  is why grids use `GetPagedAsync` instead. The bearer token is applied by
  [`AuthenticatedServiceBase`](#authenticatedservicebase)`.CreateAuthenticatedClientAsync` rather than by
  the [`AuthDelegatingHandler`](#authdelegatinghandler), because handlers created by `IHttpClientFactory`
  live in a different DI scope than the Blazor circuit that holds the token
  (`AuthenticatedServiceBase.cs:53-58`).

### BackNavigationResult
> MMCA.Common.UI · `MMCA.Common.UI.Services.Navigation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/MauiBackNavigationBridge.cs:19` · Level 0 · record (sealed)

- **What it is**: the outcome of a hardware-back or WebView-back attempt routed through
  [`MauiBackNavigationBridge`](#mauibacknavigationbridge): whether the WebView consumed the gesture,
  and whether the WebView is sitting at the root of its history stack.
- **Depends on**: nothing first-party. It is a two-field positional record produced and consumed by
  [`MauiBackNavigationBridge`](#mauibacknavigationbridge).
- **Concept introduced, the interop return contract.** This record is also the wire shape of a single
  JS interop call: `nav-interop.js`'s `tryGoBack()` returns an object that deserializes straight into
  it (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/MauiBackNavigationBridge.cs:45`),
  so the C# type and the JS return value are one contract.
- **Walkthrough**: `public sealed record BackNavigationResult(bool Handled, bool AtRoot)`
  (`MauiBackNavigationBridge.cs:19`). `Handled` is `true` when the WebView's history stack contained a
  previous entry and `history.back()` fired (`MauiBackNavigationBridge.cs:9-13`); `AtRoot` is `true`
  when no previous entry exists, and the doc comment records that MAUI hosts typically exit the app on
  Android when that is reported (`MauiBackNavigationBridge.cs:14-18`).
- **Why it's built this way**: a `sealed record` buys structural equality and positional
  deconstruction for free, and it is the smallest thing that can carry the two facts the native host
  needs. Modeling the answer as data (rather than throwing, or mutating shared state) keeps the interop
  call pure and trivially testable.
- **Where it's used**: returned by
  [`MauiBackNavigationBridge.HandleBackPressedAsync`](#mauibacknavigationbridge); consumed by MAUI host
  `ContentPage.OnBackButtonPressed` handlers.

### BrandColors
> MMCA.Common.UI · `MMCA.Common.UI.Theme` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/BrandColors.cs:10` · Level 0 · class (static)

- **What it is**: the single C# source of truth for the brand palette: six hex constants (a primary
  triad and a secondary triad) that [`MMCATheme`](#mmcatheme) reads for both its light and dark
  MudBlazor variants.
- **Depends on**: nothing first-party. It is mirrored by the CSS custom properties in
  `wwwroot/app.css` (`--mmca-primary`, `--mmca-primary-dark`, `--mmca-secondary`,
  `--mmca-secondary-dark`, named in the doc comments at `BrandColors.cs:5-8,12,15,22,28`).
- **Concept introduced, a fitness-tested duplication.** `[Rubric §20, Design System & Theming]`
  assesses whether visual tokens are centralized rather than scattered as literals; here the palette
  lives in exactly one C# class. `[Rubric §34, Architecture Governance & Documentation]` assesses
  whether *necessary* duplication is monitored: C# cannot read CSS at build time, so the same colors
  must exist in both `BrandColors` and `app.css`, and `BrandColorTokenTests` in `MMCA.Common.UI.Tests`
  asserts the two stay in sync so the copy cannot silently drift (`BrandColors.cs:6-8`).
  `[Rubric §21, Accessibility (a11y)]` also lands here rather than only in the theme: the `Secondary`
  constant carries its own contrast math in source, Teal 700 `#00796B` holding about 5.3:1 on light
  surfaces, replacing the Teal 600 `#00897B` that measured about 4.0:1 and sat under the WCAG 2.1 AA
  4.5:1 floor for normal text (`BrandColors.cs:21-26`).
- **Walkthrough**: six `public const string` fields. The primary triad: `Primary = "#1565C0"`
  (`BrandColors.cs:13`), `PrimaryDark = "#0D47A1"` (line 16), `PrimaryLight = "#42A5F5"` used for
  accents and dark-mode contrast (line 19). The secondary triad: `Secondary = "#00796B"` (line 26,
  with the contrast rationale above it), `SecondaryDark = "#00695C"` (line 29), and
  `SecondaryLight = "#4DB6AC"` (line 32).
- **Why it's built this way**: `const` rather than `static readonly` means the values can appear in
  contexts that require compile-time constants; the governance is the fitness test, not the language
  keyword. Keeping the palette in one class means a rebrand touches one file plus the mirrored CSS,
  and the accessibility reasoning travels with the value it justifies instead of living in a review
  comment.
- **Where it's used**: the [`MMCATheme`](#mmcatheme) light and dark palettes
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/MMCATheme.cs:18-24,52-61`);
  `BrandColorTokenTests`; any component that references a brand color programmatically.

### ChannelReferenceCounter
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/ChannelReferenceCounter.cs:16` · Level 0 · class (internal, sealed)

- **What it is**: a small self-synchronized counter that tracks how many outstanding joins the circuit
  holds for each live-channel key, so [`NotificationHubService`](#notificationhubservice) tells the
  SignalR server to join a group on the first join and to leave it only on the last matching leave.
- **Depends on**: nothing first-party. It is a `System.Threading.Lock` plus a `Dictionary<string, int>`
  (BCL). It is owned as a private field by [`NotificationHubService`](#notificationhubservice)
  (`NotificationHubService.cs:42`), and sits beside (not inside) the separate handler bookkeeping that
  [`ChannelSubscription`](#channelsubscription) unwinds.
- **Concept introduced, reference-counted group membership.** `[Rubric §19, State Management & Data
  Flow]` assesses how a shared per-circuit resource is owned when more than one component holds it at
  once. A live channel is exactly that resource: an invisible layout listener and a page can both be
  watching `event:1`. The class remarks state why a set is the wrong structure
  (`ChannelReferenceCounter.cs:5-10`): with set semantics the first leaver removes the only entry and
  cuts the channel off for every other subscriber still holding it. Counting joins per key turns
  membership into two edges, 0 to 1 and 1 to 0, and only those two moments need to reach the server.
  `[Rubric §29, Resilience & Business Continuity]` applies as well, because `Snapshot()` is the replay
  list the hub service re-joins after an automatic reconnect.
- **Walkthrough**: two fields, the `Lock` (`ChannelReferenceCounter.cs:18`) and the outstanding-join
  `Dictionary<string, int>` (line 22, whose default string comparer is ordinal, matching the hub's
  group-name semantics, lines 20-21).
  - `AddRef(channelKey)` (line 30) reads the current count, writes `current + 1`, and returns
    `current == 0`, so only the 0-to-1 transition reports "the server must be told to join"
    (lines 34-36).
  - `Release(channelKey)` (line 49) returns `false` for a key that was never joined (lines 53-56),
    removes the entry and returns `true` when the decrement reaches zero or below (lines 58-63), and
    otherwise stores the decremented value and returns `false` (lines 65-66). The count therefore never
    goes negative and an unpaired leave is a no-op.
  - `Snapshot()` (line 74) returns `[.. _counts.Keys]` under the lock: the distinct keys with at least
    one outstanding join, so a channel held twice is re-joined once.
  - `RefCountFor(channelKey)` (line 85) returns the outstanding count, or zero when the channel is not
    held.
  - Every method takes the lock, because joins and leaves arrive from component lifecycle callbacks on
    different render batches (lines 11-14).
- **Why it's built this way**: the counter is a separate type rather than inline state, and it is
  `internal` with an `InternalsVisibleTo` for the test project; the project file records exactly why
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/MMCA.Common.UI.csproj:12-15`): the ref-count
  semantics cannot be reached through the public API, since `JoinChannelAsync` starts a real
  `HubConnection`, so a join-based test would need a live server and a multi-second backoff.
  [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) decided the shape this
  implements: one hub, `JoinChannel`/`LeaveChannel` mapping a connection into a SignalR group,
  multicast subscriptions so an invisible listener and a page can observe the same channel
  concurrently, and a re-join on `Reconnected` because group membership does not survive a new
  connection. The ADR says the hub service tracks membership; this class is *how* that tracking is done
  so two concurrent holders cannot evict each other.
- **Where it's used**: three call sites, all inside [`NotificationHubService`](#notificationhubservice):
  `AddRef` in `JoinChannelAsync` (`NotificationHubService.cs:197`, deliberately counted before the
  connection is started so the replay inside `StartAsync` sees it, line 196), `Release` in
  `LeaveChannelAsync` (line 229), and `Snapshot` in `RejoinChannelsAsync` (line 351). Covered directly
  by `ChannelReferenceCounterTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Notifications/NotificationHubServiceTests.cs:320`,
  whose summary names the H13 regression it locks down, lines 314-319). The two concurrent holders it
  exists for are real: [`LiveEventListener`](group-22-engagement-module.md#liveeventlistener) and the
  [`HappeningNow`](group-23-engagement-live-layer.md#happeningnow) page both join the same event
  channel key.
- **Caveats / not-in-source**: it counts joins only; it knows nothing about handlers. Subscriptions
  live in a separate `_channelSubscriptions` dictionary under a different lock
  (`NotificationHubService.cs:36,43`), so disposing a [`ChannelSubscription`](#channelsubscription)
  does not decrement the count, and leaving a channel does not remove handlers
  (`NotificationHubService.cs:216-224` states that pairing requirement).

### INotificationScopeProvider
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/INotificationScopeProvider.cs:14` · Level 0 · interface

- **What it is**: a one-method contract that supplies the *scope key* the notification UI should send
  and read under, so an application can narrow its notifications to whatever it considers "current"
  (a conference event, a tenant, a season) without the framework knowing what that is.
- **Depends on**: nothing first-party. The single member returns `Task<string?>` and takes a
  `CancellationToken` (BCL). Implemented in the framework by
  [`NullNotificationScopeProvider`](#nullnotificationscopeprovider) and consumed by both notification
  HTTP services, [`NotificationInboxService`](#notificationinboxservice) and
  [`PushNotificationService`](#pushnotificationservice).
- **Concept introduced, the opaque scope key.** The framework ships the notification feature but has
  no vocabulary for *what* notifications belong to, so it inverts the question: the app answers with a
  string and the framework treats it as opaque (`INotificationScopeProvider.cs:3-8`). The value of
  putting one provider behind both HTTP services is agreement: a send and the reads that follow it
  resolve through the same instance, so the inbox, the unread badge and a bulk mark-read cannot
  disagree about which slice the user is looking at.
  - `[Rubric §9, API & Contract Design]` assesses contract minimality and the meaning of defaults. The
    interface is one method with a nullable return, and null carries a defined meaning ("unscoped"),
    which is what lets the scoped and unscoped worlds share one code path instead of branching.
  - `[Rubric §11, Security]` assesses where authorization decisions live, and this contract is
    explicit that it is *not* one: the remarks state a scope is a view filter, never a security
    boundary, and require implementations never to throw, because the safe direction on any failure is
    null (`INotificationScopeProvider.cs:9-13`). Degrading to unscoped restores pre-scope behavior
    rather than breaking the bell or the inbox; ownership filtering stays on the server.
- **Walkthrough**: one member, `Task<string?> GetCurrentScopeKeyAsync(CancellationToken ct = default)`
  (`INotificationScopeProvider.cs:21`), documented to return the key currently in force (the example in
  source is `"event:2"`) or null when the application is unscoped (lines 16-20).
- **Why it's built this way**: an interface rather than a settings value, because the answer is
  dynamic (it changes as the app's current context changes) and may need an async lookup. Keeping the
  key a plain string keeps the framework free of any domain concept, and the never-throw rule in the
  contract is what makes the degrade-to-unscoped guarantee real rather than aspirational. See
  [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html), which records the
  optional `ScopeKey` travelling with a send.
- **Where it's used**: injected into [`NotificationInboxService`](#notificationinboxservice)
  (`NotificationInboxService.cs:18`) and [`PushNotificationService`](#pushnotificationservice)
  (`PushNotificationService.cs:18`); registered with `TryAddScoped` against
  [`NullNotificationScopeProvider`](#nullnotificationscopeprovider) by `AddNotificationUI()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:24`). In
  MMCA.ADC the real implementation is
  [`CurrentEventNotificationScopeProvider`](group-22-engagement-module.md#currenteventnotificationscopeprovider),
  which returns `event:{EventId}` for the conference event currently in focus
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/CurrentEventNotificationScopeProvider.cs:54`).

### NotificationState
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationState.cs:8` · Level 0 · class (sealed)

- **What it is**: the scoped shared state for the notification unread count, and the coordination point
  between the notification bell, real-time push, and background polling.
- **Depends on**: nothing first-party; it holds an `int` count and two `EventHandler` events. Consumed
  by [`NotificationBell`](#notificationbell) and the inbox page
  ([`NotificationInbox`](#notificationinbox)).
- **Concept introduced, a scoped state store with an active-poller guard.** `[Rubric §19, State
  Management & Data Flow]` assesses how shared UI state is owned and observed without threading it
  through the component tree. `NotificationState` is registered scoped
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:33`), so each
  Blazor circuit gets its own instance and components subscribe to its events instead of receiving
  cascading parameters. The subtle part is duplicate suppression: [`NotificationBell`](#notificationbell)
  can render in more than one DOM location (desktop header and mobile drawer), and every instance would
  otherwise start its own poll loop. `TryRegisterPoller` uses `Interlocked.Increment` so only the first
  caller returns `true` (`NotificationState.cs:51`); the rest skip polling.
  `[Rubric §23, Front-End Performance]` follows directly: the guard is what keeps a live badge from
  becoming a request amplifier in a dual-placement layout.
- **Walkthrough**: members in teaching order.
  - `_pollerCount`, the `Interlocked` reference count (`NotificationState.cs:10`).
  - `UnreadCount` with a private setter (line 13), and the `OnChange` / `OnRefreshRequested` events
    (`EventHandler`, lines 16 and 22; the second is documented as the "a push arrived, refetch the
    authoritative count" signal, lines 18-21).
  - `SetUnreadCount(int)` (lines 25-34) sets an absolute value and raises `OnChange` **only** when the
    value actually changes (the early return at lines 27-30 suppresses no-op re-renders).
  - `IncrementUnreadCount()` (lines 37-41) bumps by one for an optimistic real-time update and always
    raises `OnChange`.
  - `RequestRefresh()` (line 44) raises `OnRefreshRequested` so a subscriber refetches from the API.
  - `TryRegisterPoller()` (line 51) and `UnregisterPoller()` (line 54) bracket the active-poller
    lifetime, the second decrementing so the next bell to register can take over.
- **Why it's built this way**: scoped because the count is per-user-session; event-based because
  subscribers live at arbitrary render-tree depth. The private setter funnels every mutation through
  the three named methods, so no change can bypass the change-notification path.
- **Where it's used**: injected into [`NotificationBell`](#notificationbell) and
  [`NotificationInbox`](#notificationinbox); driven by real-time pushes that arrive over
  [`NotificationHubService`](#notificationhubservice).

### ReturnUrlProtector
> MMCA.Common.UI · `MMCA.Common.UI.Services.Navigation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/ReturnUrlProtector.cs:9` · Level 0 · class (static)

- **What it is**: a pure sanitizer for `returnUrl` query parameters: it accepts only same-origin
  relative paths and replaces anything else with a safe fallback, closing the open-redirect hole in
  post-login and post-action redirects.
- **Depends on**: nothing first-party; `System.Uri` (BCL) supplies the final relative-URI parse guard.
- **Concept introduced, open-redirect defense.** `[Rubric §26, Front-End Security]` assesses whether
  user-controlled navigation targets are validated before use. An open redirect lets an attacker craft
  `/login?returnUrl=https://evil.com` so the victim lands on an attacker site *after* authenticating, a
  classic phishing amplifier. `Sanitize` rejects every off-host form rather than trying to enumerate
  attacks, and the ordered guards read as a documented threat model.
- **Walkthrough**: `Sanitize(string? candidate, string fallback = "/")` (`ReturnUrlProtector.cs:18`)
  runs a sequence of cheap, regex-free checks (a regex here would invite ReDoS), each returning
  `fallback` on failure:
  - null or empty (line 20);
  - must start with `/`, which rules out scheme-prefixed absolutes such as `http://` and
    `javascript:` (lines 25-30);
  - must not be `//` or `/\`, which browsers read as the start of an authority component and would
    send the user off-host (lines 32-37);
  - no backslash anywhere, since some browsers normalize `\` to `/` (the source names
    `"/\\evil.com"` becoming `//evil.com` in Chrome, lines 39-44);
  - no control characters, which are header-injection, response-splitting and cookie-smuggling
    vectors (lines 46-51);
  - and finally it must parse as a well-formed relative URI (`Uri.TryCreate(..., UriKind.Relative)`,
    lines 53-57).
  Only a candidate that survives all six is returned unchanged (line 59).
- **Why it's built this way**: a static pure function whose only input is the candidate is trivially
  unit-testable across every attack vector, and calling it centrally means no page hand-rolls its own
  redirect validation.
- **Where it's used**: login and post-authentication redirects sanitize the `returnUrl` they read from
  the query string; [`NavigationHistoryService.GoBackAsync`](#navigationhistoryservice) also runs its
  fallback path through it (`NavigationHistoryService.cs:82`), so even the "safe" branch cannot be
  turned into a redirect vector.

### MauiBackNavigationBridge
> MMCA.Common.UI · `MMCA.Common.UI.Services.Navigation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/MauiBackNavigationBridge.cs:28` · Level 1 · class (static)

- **What it is**: a static bridge that routes a native MAUI back gesture (Android hardware back, iOS
  swipe) into the BlazorWebView's internal history stack, so pressing back inside a hybrid app behaves
  like a web back rather than tearing down the page.
- **Depends on**: [`BackNavigationResult`](#backnavigationresult) (its return type);
  `Microsoft.JSInterop` (`IJSRuntime`, `IJSObjectReference`, `JSDisconnectedException`, `JSException`)
  and the `nav-interop.js` module shipped as static web assets of this package.
- **Concept introduced, MAUI-to-WebView interop.** `[Rubric §22, Responsive & Cross-Browser]` extends
  to hybrid hosts here: the same Blazor UI runs inside a MAUI WebView, and native chrome events must be
  reconciled with web navigation. The class doc states the required call site precisely, from
  `ContentPage.OnBackButtonPressed` via `BlazorWebView.TryDispatchAsync`, so the call runs on the
  renderer thread with access to the WebView's `IJSRuntime`
  (`MauiBackNavigationBridge.cs:21-27`).
- **Walkthrough**: `HandleBackPressedAsync(IJSRuntime js)` (line 38) null-checks the runtime
  (`ArgumentNullException.ThrowIfNull`, line 40), dynamically imports
  `./_content/MMCA.Common.UI/nav-interop.js` (`ModulePath`, line 30) and invokes its `tryGoBack()`
  helper, deserializing the answer into a [`BackNavigationResult`](#backnavigationresult)
  (lines 44-46). Three interop failure modes are caught explicitly and collapse to the same safe value
  `new BackNavigationResult(Handled: false, AtRoot: true)`: `InvalidOperationException` when Blazor is
  not yet hydrated (lines 48-52), `JSDisconnectedException` (lines 53-56), and `JSException`
  (lines 57-60). A not-yet-ready WebView therefore reports "at root, not handled" and the host falls
  back to its default back behavior.
- **Why it's built this way**: a static helper with no state fits a one-shot interop call, and
  returning a data record instead of throwing keeps the native handler branch-free. Swallowing the
  three JS exception types into one safe default means an unhydrated or disconnected circuit never
  crashes the native back button.
- **Where it's used**: MAUI host projects call it from their page back-button handler; the returned
  [`BackNavigationResult`](#backnavigationresult) tells the host whether to exit the app.
- **Caveats / not-in-source**: the `nav-interop.js` `tryGoBack()` implementation and the MAUI host
  wiring live outside this unit; only the C# side of the bridge is visible here.

### NavigationHistoryService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Navigation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/NavigationHistoryService.cs:12` · Level 1 · class (sealed)

- **What it is**: a per-circuit service that bridges Blazor's `NavigationManager` with the browser
  history API, so a "Back" button can perform a real `history.back()` when an in-history entry exists
  and fall back to an explicit route otherwise.
- **Depends on**: [`ReturnUrlProtector`](#returnurlprotector) (sanitizes the fallback) and
  [`LazyJsModule`](#lazyjsmodule) (the shared single-flight JS module importer, held as `_module`,
  `NavigationHistoryService.cs:16`); `NavigationManager` and `IJSRuntime` arrive through the primary
  constructor (line 12). Implements `IAsyncDisposable`.
- **Concept introduced, honoring real browser history.** `[Rubric §25, Navigation, Routing &
  Information Architecture]` assesses predictable, source-aware navigation. A hard-coded "back to list"
  link ignores where the user actually came from; this service instead asks the browser whether a
  previous entry exists and navigates to it, falling back to a route only when it does not
  (`NavigationHistoryService.cs:50-54`). `[Rubric §26, Front-End Security]` applies to the fallback:
  it is sanitized rather than trusted (line 82).
- **Walkthrough**:
  - `ModulePath` (line 14) names `./_content/MMCA.Common.UI/nav-interop.js`, the same module the MAUI
    bridge imports; `_module` wraps it in a [`LazyJsModule`](#lazyjsmodule) (line 16) so concurrent
    callers share one import.
  - `CanGoBackAsync()` (lines 23-48) resolves the module, returns `false` when it is unavailable
    (lines 28-31), then invokes `historyLength` and reports `length > 1` (lines 33-34). Interop
    failures during SSR prerender or after a disconnect are swallowed as `false`
    (`InvalidOperationException`, `JSDisconnectedException`, `JSException`, lines 36-47).
  - `GoBackAsync(string fallback = "/")` (lines 55-83) calls `historyBack` when history is available
    and returns (lines 57-66); every interop failure falls through the three catch blocks
    (lines 68-79) to the single exit at line 82,
    `navigation.NavigateTo(ReturnUrlProtector.Sanitize(fallback))`. The method therefore always ends in
    a navigation.
  - `GetModuleAsync()` (lines 85-99) delegates to `_module.GetOrImportAsync()` and turns a prerender or
    disconnect failure into `null` rather than an exception.
  - `DisposeAsync()` (line 102) forwards to the module wrapper, releasing the imported JS reference
    with the circuit.
- **Why it's built this way**: sealed and scoped per circuit, because the cached JS module reference
  and history semantics are per-connection. Delegating the import to [`LazyJsModule`](#lazyjsmodule)
  removes a real bug class, an unguarded `_module ??= await import(...)` lets two concurrent callers
  each start an import and leaks the loser reference
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/LazyJsModule.cs:5-13`). Routing the
  fallback through [`ReturnUrlProtector`](#returnurlprotector) means even the safe branch cannot be
  turned into a redirect vector, and the layered exception handling guarantees `GoBackAsync` never
  strands the user.
- **Where it's used**: injected into detail-page "Back" buttons; the same `nav-interop.js` primitives
  back the MAUI hardware-back path through
  [`MauiBackNavigationBridge`](#mauibacknavigationbridge).

### NullNotificationScopeProvider
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NullNotificationScopeProvider.cs:8` · Level 1 · class (sealed)

- **What it is**: the framework's default [`INotificationScopeProvider`](#inotificationscopeprovider):
  a no-op that always reports "unscoped", so an application that never scopes its notifications keeps
  exactly the behavior it had before the scope key existed.
- **Depends on**: [`INotificationScopeProvider`](#inotificationscopeprovider) (the interface it
  implements); `Task.FromResult` (BCL).
- **Concept reinforced, the Null Object pattern as a registration default.** Rather than making the
  scope provider optional and null-checking it in both HTTP services, the framework registers a
  do-nothing implementation and lets the consumers depend on the interface unconditionally.
  `[Rubric §2, Design Patterns]` assesses whether a pattern is used where it removes branching, which
  is exactly what happens here: [`NotificationInboxService`](#notificationinboxservice) and
  [`PushNotificationService`](#pushnotificationservice) contain no "is a provider registered" test.
  `[Rubric §16, Maintainability]` follows: the feature was additive, and an app that ignores it sees a
  byte-identical request.
- **Walkthrough**: the whole type is one expression-bodied member,
  `GetCurrentScopeKeyAsync(CancellationToken ct = default) => Task.FromResult<string?>(null)`
  (`NullNotificationScopeProvider.cs:11-12`). The class doc records the registration contract: it is
  the default wired by `AddNotificationUI`, and an app that scopes registers its own implementation,
  which wins (`NullNotificationScopeProvider.cs:3-7`).
- **Why it's built this way**: the "wins" part is mechanical, not conventional.
  `AddNotificationUI()` registers this type with `TryAddScoped`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:24`), and the
  source comment states the reason: `TryAdd` means an app that registers its own provider wins
  whichever order the two registration calls run in (lines 22-23). A plain `AddScoped` would have made
  host startup ordering load-bearing.
- **Where it's used**: resolved as [`INotificationScopeProvider`](#inotificationscopeprovider) by
  [`NotificationInboxService`](#notificationinboxservice) and
  [`PushNotificationService`](#pushnotificationservice) in every host that has not registered its own;
  MMCA.ADC replaces it with
  [`CurrentEventNotificationScopeProvider`](group-22-engagement-module.md#currenteventnotificationscopeprovider).

### ChannelSubscription
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:412` · Level 2 · class (private, sealed, nested)

- **What it is**: the disposable handle returned when a caller subscribes to a live channel on
  [`NotificationHubService`](#notificationhubservice); disposing it removes the handler from the
  channel's subscriber list.
- **Depends on**: its owning [`NotificationHubService`](#notificationhubservice) (a back-reference), a
  channel-key string, and a `Func<string, string, Task>` handler; implements `IDisposable`.
- **Concept introduced, subscription-as-token.** This is the classic "return an `IDisposable` to
  unsubscribe" pattern. Instead of exposing an `Unsubscribe(handler)` method (which forces callers to
  hold and match the exact delegate), `OnChannelEvent` returns a `ChannelSubscription`; when the
  component disposes it, the subscription calls back into the owner to unregister itself.
  `[Rubric §1, SOLID]` shows in the encapsulation: only the hub service can construct one, and only it
  knows how to remove one, so the bookkeeping has a single owner.
- **Walkthrough**: a primary-constructor nested class capturing `owner`, `channelKey` and `handler`
  (`NotificationHubService.cs:412`), exposing `ChannelKey` (line 414) and `Handler` (line 416) as
  get-only properties. `Dispose()` (line 418) simply calls `owner.RemoveSubscription(this)`, which
  takes the shared `_channelSync` lock, removes the entry, and prunes the channel's list once it
  empties (lines 373-386). The `Handler` property is what
  `DispatchChannelEventAsync` invokes on each delivery (line 339).
- **Why it's built this way**: nesting it privately inside
  [`NotificationHubService`](#notificationhubservice) keeps subscription bookkeeping fully
  encapsulated, and the `IDisposable` shape lets Blazor components tie unsubscription to their own
  lifetime.
- **Where it's used**: constructed and returned by
  [`NotificationHubService.OnChannelEvent`](#notificationhubservice) (line 260); disposed by the
  component that subscribed.
- **Caveats / not-in-source**: disposing a subscription unregisters the *handler* only. It does not
  release a channel join: those are counted separately by
  [`ChannelReferenceCounter`](#channelreferencecounter), and the source states the pairing requirement
  explicitly (`NotificationHubService.cs:220-222`).

### INotificationInboxUIService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/INotificationInboxUIService.cs:9` · Level 2 · interface

- **What it is**: the UI-side contract for the per-user notification inbox: paged retrieval, unread
  count, mark-one-read, and mark-all-read.
- **Depends on**: [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt)
  and [`UserNotificationDTO`](group-10-notifications.md#usernotificationdto) (its return shapes), plus
  the `UserNotificationIdentifierType` alias (`INotificationInboxUIService.cs:18`).
- **Concept introduced, the UI service abstraction.** `[Rubric §18, UI Architecture & Component
  Design]` assesses whether components talk to typed services rather than raw `HttpClient`. Components
  depend on this interface, not on the HTTP implementation, so a bell or an inbox page can be tested
  against a stub. `[Rubric §9, API & Contract Design]` shows in the paged signature: the inbox is
  fetched a page at a time with sane defaults, never as one unbounded dump.
- **Walkthrough**: four members (`INotificationInboxUIService.cs:11-21`).
  `GetInboxAsync(pageNumber = 1, pageSize = 20, cancellationToken)` returns a **nullable**
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) of
  [`UserNotificationDTO`](group-10-notifications.md#usernotificationdto) (line 12);
  `GetUnreadCountAsync` returns a plain `int` (line 15); `MarkReadAsync(id, ct)` (line 18) and
  `MarkAllReadAsync(ct)` (line 21) are the two mutations, both returning a bare `Task`.
- **Why it's built this way**: a thin interface at the presentation edge keeps components decoupled
  from transport and makes the inbox mockable in bUnit tests. Note the contract deliberately says
  nothing about scoping: the scope key is resolved inside the implementation through
  [`INotificationScopeProvider`](#inotificationscopeprovider), so adding scoping did not change this
  interface or any caller.
- **Where it's used**: implemented by [`NotificationInboxService`](#notificationinboxservice);
  consumed by [`NotificationBell`](#notificationbell) (for the unread count) and the
  [`NotificationInbox`](#notificationinbox) page.

### IPushNotificationUIService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/IPushNotificationUIService.cs:9` · Level 2 · interface

- **What it is**: the UI-side contract for admin push operations: broadcast a notification and read
  paginated send history.
- **Depends on**: [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
  [`PushNotificationDTO`](group-10-notifications.md#pushnotificationdto), and
  [`SendPushNotificationRequest`](group-10-notifications.md#sendpushnotificationrequest).
- **Concept reinforced**: the same UI-service abstraction as
  [`INotificationInboxUIService`](#inotificationinboxuiservice) (`[Rubric §18, UI Architecture &
  Component Design]`). The difference is audience: this is the organizer/admin surface (send plus
  history), not the per-user inbox, and splitting the two keeps each page's dependency surface minimal.
- **Walkthrough**: two members (`IPushNotificationUIService.cs:11-15`).
  `SendAsync(SendPushNotificationRequest, ct)` returns the created
  [`PushNotificationDTO`](group-10-notifications.md#pushnotificationdto) (line 12);
  `GetHistoryAsync(pageNumber = 1, pageSize = 10, ct)` returns a paged history (line 15). Both returns
  are nullable, so a caller must handle "no body".
- **Why it's built this way**: separating the admin contract from the inbox contract lets an app that
  never sends notifications avoid taking a dependency on the send path at all, and keeps the two
  registrations independent.
- **Where it's used**: implemented by [`PushNotificationService`](#pushnotificationservice); consumed
  by the admin pages [`NotificationList`](#notificationlist) and
  [`NotificationSend`](#notificationsend).

### MMCATheme
> MMCA.Common.UI · `MMCA.Common.UI.Theme` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/MMCATheme.cs:9` · Level 2 · class (static)

- **What it is**: the single application-wide MudBlazor `MudTheme` instance, defining the brand palette
  (light and dark), typography, and layout radius, applied once via `MudThemeProvider` in the root
  layout.
- **Depends on**: [`BrandColors`](#brandcolors) (the palette source of truth); MudBlazor (NuGet:
  `MudTheme`, `PaletteLight`, `PaletteDark`, `Typography`, `LayoutProperties`).
- **Concept introduced, one theme, accessibility-justified.** `[Rubric §20, Design System & Theming]`
  assesses whether an app has a single coherent theme rather than per-page overrides;
  `MMCATheme.Instance` is that one object (`MMCATheme.cs:11`), and the dark palette is what drives
  `MudThemeProvider`'s `IsDarkMode` (the comment at lines 50-51 says so explicitly).
  `[Rubric §21, Accessibility (a11y)]` is unusually visible here, because several color choices carry
  inline WCAG 2.1 AA contrast math:
  - light `WarningContrastText = "#212121"` (line 33), because MudBlazor's default white on amber
    `#F57F17` is about 2.65:1 and failed the gated admin-order-list axe scan on a "Pending Payment"
    chip; dark text is about 7.9:1 (lines 29-32);
  - dark `PrimaryContrastText = "rgba(0,0,0,0.87)"` (line 58), because white on the lightened
    dark-mode primary `#42A5F5` is about 2.65:1 while dark text is about 6.6:1 (lines 55-57);
  - dark `WarningContrastText` (line 67), white on `#FFA726` being about 2.0:1 against about 10.8:1
    (line 66);
  - dark `ErrorContrastText` (line 71), white on `#EF5350` being about 3.5:1 against about 5.5:1
    (lines 69-70).
  The `Secondary` contrast rationale is deliberately *not* repeated here: line 21 points at
  [`BrandColors`](#brandcolors), where the value and its justification live together.
- **Walkthrough**: a single `static MudTheme Instance { get; }` (line 11) initialized with four blocks.
  `PaletteLight` (lines 13-47) reads its primary and secondary triads straight from
  [`BrandColors`](#brandcolors) (lines 18-24) and then fixes app-chrome colors (appbar `#1A2035`,
  background `#FAFBFC`, drawer, text and divider tones, lines 35-46). `PaletteDark` (lines 48-84)
  lightens the primary for contrast on dark surfaces (`Primary = BrandColors.PrimaryLight`, line 52)
  and darkens the surface stack (lines 72-83). `Typography` (lines 85-137) sets the Inter font stack
  with Segoe UI / Helvetica Neue / Arial / sans-serif fallbacks (line 89) plus H1 to H6 sizes and
  weights (lines 91-120) and body line heights (lines 129-136). `LayoutProperties` sets
  `DefaultBorderRadius = "6px"` (lines 138-141).
- **Why it's built this way**: a static get-only property means the theme is constructed once and
  shared by every `MudThemeProvider`. Sourcing the brand hues from [`BrandColors`](#brandcolors)
  rather than re-typing hex is what lets `BrandColorTokenTests` police C#-versus-CSS drift, and the
  per-color contrast comments turn accessibility decisions into reviewable source rather than tribal
  knowledge.
- **Where it's used**: applied in the root layout of the Blazor Web and MAUI hosts via
  `MudThemeProvider Theme="MMCATheme.Instance"`.

### NotificationHubService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:26` · Level 2 · class (sealed, partial)

- **What it is**: the client-side SignalR connection manager. It opens a connection to
  `/hubs/notifications` after login, invokes a callback for received notifications, and carries the
  ephemeral live-channel events that components join and subscribe to.
- **Depends on**: [`ApiSettings`](#apisettings) (for the hub URL, via `IOptions<ApiSettings>`) and
  [`ITokenStorageService`](#itokenstorageservice) (for the bearer token);
  [`ChannelReferenceCounter`](#channelreferencecounter) (membership counting) and
  [`ChannelSubscription`](#channelsubscription) (its subscription handle). Externals:
  `Microsoft.AspNetCore.SignalR.Client` (`HubConnection`, `HubConnectionBuilder`), `ILogger<T>` with
  `[LoggerMessage]` source generation, `System.Threading.Lock` and `SemaphoreSlim`; implements
  `IAsyncDisposable`.
- **Concept introduced, resilient client-side real-time with re-joinable channels.**
  `[Rubric §6, CQRS & Event-Driven]` extends to the browser here: the server pushes notifications and
  channel events over SignalR instead of the client polling for everything.
  `[Rubric §29, Resilience & Business Continuity]` shows in four distinct mechanisms, each with its
  rationale in source:
  - the initial connect retries with exponential backoff up to `MaxRetries = 3` starting at
    `InitialRetryDelay` of 2 seconds and doubling (lines 28, 71, 145-179), so a token-not-yet-ready or
    API-still-starting race recovers;
  - `WithAutomaticReconnect()` (line 128) keeps long sessions alive, and because SignalR group
    membership does not survive a new connection, `Reconnected` re-joins every held channel
    (lines 141-143, `RejoinChannelsAsync` lines 348-371);
  - a terminal start failure **discards** the connection object (`DiscardUnstartedConnectionAsync`,
    lines 310-319) instead of leaving it in the field, because the null guard at line 121 would
    otherwise make every later `StartAsync` a permanent no-op (the comment at lines 169-171 records
    exactly this);
  - `StartAsync` is serialized by a `SemaphoreSlim` (line 40), since two components calling
    `JoinChannelAsync` at once on Blazor Server (which has no single synchronization context) could
    both see a null connection, both build one, and leak the loser socket with duplicate server
    registrations (lines 76-83).
  `[Rubric §13, Observability & Operability]` applies too: every outcome is a source-generated
  structured log (lines 388-410), and failures on the channel paths are logged, never thrown.
- **Walkthrough**:
  - Constants and fields: the four hub method names (lines 29-32), `_channelSync` guarding the
    subscription dictionary (line 36), `_startSync` guarding start (line 40, a `SemaphoreSlim` rather
    than a `Lock` because the guarded body awaits, lines 38-39), the
    [`ChannelReferenceCounter`](#channelreferencecounter) (line 42), and
    `_channelSubscriptions` mapping a channel key to its handler list (line 43).
  - `NotificationCallback` (line 51) is a settable `Func<string, string, Task>?` the host assigns to
    surface a snackbar; `IsConnected` (line 65) reports the connection state.
  - The constructor (lines 53-62) builds `_hubUrl` from `ApiSettings.ApiEndpoint` trimmed of its
    trailing slash plus `/hubs/notifications` (line 61), throwing if the options are absent (line 60).
  - `StartAsync` (lines 85-117) bails when disposed (lines 87-90), takes `_startSync`
    (tolerating `ObjectDisposedException`, lines 92-100), runs `StartCoreAsync`, and releases in a
    `finally` that tolerates the same disposal race (lines 106-116).
  - `StartCoreAsync` (lines 119-181) returns immediately when a connection already exists (line 121),
    builds the `HubConnection` with an `AccessTokenProvider` bound to
    `ITokenStorageService.GetAccessTokenAsync` (line 127), registers `ReceiveNotification` fanning out
    to `NotificationCallback` (lines 131-137) and `ReceiveChannelEvent` to `DispatchChannelEventAsync`
    (line 139), wires the reconnect re-join (line 143), then runs the retry loop, which on success also
    replays any channel joins requested before the connection came up (line 160).
  - `JoinChannelAsync(channelKey)` (lines 192-214) counts the join **before** starting the connection
    so the replay inside `StartAsync` sees it (lines 196-197), then invokes the server `JoinChannel`
    only on the first join and only when connected (lines 202-213).
  - `LeaveChannelAsync(channelKey)` (lines 225-244) is the mirror: it invokes `LeaveChannel` only when
    `Release` reports the last outstanding leave (lines 229-243).
  - `OnChannelEvent(channelKey, handler)` (lines 255-273) creates a
    [`ChannelSubscription`](#channelsubscription) and appends it to the channel's handler list under
    the lock, returning the subscription as the unsubscribe token. Subscribing deliberately does not
    join the channel; the doc says to call `JoinChannelAsync` as well (lines 249-250).
  - `DispatchChannelEventAsync` (lines 321-346) snapshots the subscriber list under the lock
    (line 331), then invokes each handler in isolation, logging (never rethrowing) a failure so one bad
    subscriber cannot starve the rest (lines 334-345).
  - `StopAsync` (lines 278-285) disposes and clears the connection; `DisposeAsync` (lines 288-303) sets
    `_disposed`, stops, and disposes the semaphore. The comment at lines 298-301 records the deliberate
    choice not to wait for an in-flight start: it can be sitting in a multi-second backoff, and
    blocking a Blazor circuit teardown on it would be worse.
- **Why it's built this way**: sealed and scoped per circuit, because a connection and its channel
  membership are per-user-session. Best-effort semantics (join, leave and handler failures are logged,
  not thrown) match the reality that live updates are a convenience layered over the authoritative API,
  not a correctness guarantee, and isolating handler invocations protects the fan-out. The overall
  shape is the client half of
  [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html), with push notifications
  themselves covered by
  [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html).
- **Where it's used**: registered as a scoped service by `AddNotificationUI()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:36`); started
  after login and stopped on logout; its notification callback drives
  [`NotificationState`](#notificationstate) and MudBlazor snackbars, and its channel API is what
  [`LiveEventListener`](group-22-engagement-module.md#liveeventlistener) and the
  [`HappeningNow`](group-23-engagement-live-layer.md#happeningnow) page use. The server side is
  [`NotificationHub`](group-10-notifications.md#notificationhub).

### NotificationInboxService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationInboxService.cs:15` · Level 3 · class (sealed)

- **What it is**: the HTTP implementation of the inbox contract. It calls the `notifications/inbox`
  WebAPI resource for paged retrieval, unread count, and the two mark-read operations, stamping every
  scopeable read with the application's current scope key.
- **Depends on**: [`AuthenticatedServiceBase`](#authenticatedservicebase) (its base, supplying the
  authenticated client, the retry policy and the error helper),
  [`INotificationInboxUIService`](#inotificationinboxuiservice) (the contract it implements),
  [`ITokenStorageService`](#itokenstorageservice),
  [`INotificationScopeProvider`](#inotificationscopeprovider) (the third constructor dependency),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
  [`UserNotificationDTO`](group-10-notifications.md#usernotificationdto), and
  [`ServiceExceptionHelper`](#serviceexceptionhelper) for surfacing domain errors. Externals:
  `IHttpClientFactory`, `System.Net.Http.Json`, `CultureInfo.InvariantCulture`.
- **Concept introduced, a typed HTTP UI service over a non-CRUD resource.**
  `[Rubric §18, UI Architecture & Component Design]` assesses UI-to-API access through typed services.
  This is the same HTTP-service shape as
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](#entityservicebasetentitydto-tidentifiertype), but
  for a resource whose verbs are read and mark rather than create/update/delete. Each call builds an
  authenticated client from the base, wraps the send in the shared `RetryPolicy`, and routes
  non-success responses through `ServiceExceptionHelper.ThrowIfDomainExceptionAsync` so a domain error
  reaches the user as its real message (`NotificationInboxService.cs:36-40`).
  `[Rubric §12, Performance & Scalability]` shows in the paging defaults, and
  `[Rubric §30, Compliance, Privacy & Data Governance]` in the scope query: the scope is what keeps a
  bulk mark-read from silently clearing notifications the user is not currently looking at.
- **Walkthrough**:
  - A primary constructor forwards `IHttpClientFactory` and
    [`ITokenStorageService`](#itokenstorageservice) to
    [`AuthenticatedServiceBase`](#authenticatedservicebase) and keeps `scopeProvider`
    (`NotificationInboxService.cs:15-19`); `Endpoint` is the constant `"notifications/inbox"`
    (line 21).
  - `ScopeQueryAsync(separator, ct)` (lines 107-114) is the shared helper: it asks
    [`INotificationScopeProvider`](#inotificationscopeprovider) for the current key and returns either
    an empty string (leaving the request byte-identical to the pre-scope one, lines 99-102) or
    `{separator}scope={Uri.EscapeDataString(scopeKey)}` (line 113). The separator parameter is `"&"`
    for a URL that already carries query parameters and `"?"` for one that does not (lines 103-105).
  - `GetInboxAsync` (lines 24-44) resolves the scope with `"&"` (line 29), builds an
    invariant-culture query (line 31), sends through `RetryPolicy` (lines 33-34), raises domain errors
    (lines 36-40), and deserializes a
    [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) (lines
    42-43).
  - `GetUnreadCountAsync` (lines 47-62) resolves the scope with `"?"` and, on **any** non-success
    response, returns `0` rather than throwing (lines 56-59): a badge should degrade quietly.
  - `MarkReadAsync` (lines 65-80) PUTs to `{Endpoint}/{id}/read`. It is the one method that sends no
    scope: the id already identifies a single notification.
  - `MarkAllReadAsync` (lines 83-97) PUTs to `{Endpoint}/read-all` **with** the scope query
    (lines 85-87), so a bulk operation is bounded by the same filter the list was read under.
- **Why it's built this way**: inheriting from [`AuthenticatedServiceBase`](#authenticatedservicebase)
  removes per-method boilerplate for auth, retry and error translation. The deliberate exception is the
  unread count, which returns `0` rather than throwing so a transient failure never breaks the header
  badge. Routing the scope through a provider (rather than a parameter on every call) is what keeps the
  UI contract unchanged while the inbox, badge and mark-all agree on one slice
  (`NotificationInboxService.cs:9-14`).
- **Where it's used**: registered against
  [`INotificationInboxUIService`](#inotificationinboxuiservice) as scoped by `AddNotificationUI()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:30`); consumed
  by [`NotificationBell`](#notificationbell) and the
  [`NotificationInbox`](#notificationinbox) page.

### PushNotificationService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/PushNotificationService.cs:15` · Level 4 · class (sealed)

- **What it is**: the HTTP implementation of the admin push contract: send a notification and read
  paginated send history against the `notifications` WebAPI resource, stamping a send with the
  application's current scope key when the caller did not name one.
- **Depends on**:
  [`EntityServiceBase<TEntityDTO, TIdentifierType>`](#entityservicebasetentitydto-tidentifiertype)
  (its base, typed on `PushNotificationDTO` / `PushNotificationIdentifierType`),
  [`IPushNotificationUIService`](#ipushnotificationuiservice) (the contract),
  [`ITokenStorageService`](#itokenstorageservice),
  [`INotificationScopeProvider`](#inotificationscopeprovider),
  [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
  [`PushNotificationDTO`](group-10-notifications.md#pushnotificationdto), and
  [`SendPushNotificationRequest`](group-10-notifications.md#sendpushnotificationrequest).
- **Concept reinforced, the base-class HTTP service pattern at its cleanest**
  (`[Rubric §18, UI Architecture & Component Design]`). Where
  [`NotificationInboxService`](#notificationinboxservice) hand-builds each request, this one leans on
  [`EntityServiceBase`](#entityservicebasetentitydto-tidentifiertype)'s `SendRequestAsync` helper, so
  each method reduces to one send. `[Rubric §9, API & Contract Design]` appears in the scope
  precedence rule: an explicit caller choice outranks the ambient one, which is the difference between
  a default and an override.
- **Walkthrough**:
  - The primary constructor passes the resource name `"notifications"` plus the factory and token
    service to [`EntityServiceBase`](#entityservicebasetentitydto-tidentifiertype) (which exposes
    `Endpoint`) and keeps `scopeProvider` (`PushNotificationService.cs:15-21`).
  - `SendAsync(request, ct)` (lines 23-48) null-guards the request (line 27), then applies scoping
    conditionally: a request that already carries a `ScopeKey` is sent unchanged, and only an unscoped
    one picks up the ambient key via a `record with` expression (lines 31-39, rationale at lines
    29-30). It then POSTs through `SendRequestAsync<PushNotificationDTO>` with `throwIfNull: true`
    (lines 41-47), so a missing body is an error rather than a silent null.
  - `GetHistoryAsync(pageNumber = 1, pageSize = 10, ct)` (lines 51-60) builds an invariant-culture
    `pageNumber`/`pageSize` query (line 56) and deserializes a
    [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt)
    (lines 57-59). Note it does **not** send a scope: history is the admin's full send log.
- **Why it's built this way**: delegating transport, auth, retry and error handling to
  [`EntityServiceBase`](#entityservicebasetentitydto-tidentifiertype) keeps this class down to two
  short methods, matching the framework's "UI services are typed HTTP clients, never raw `HttpClient`"
  convention. Reading the scope through the same
  [`INotificationScopeProvider`](#inotificationscopeprovider) the inbox service uses is what makes a
  send and the reads that follow it resolve to one scope
  (`PushNotificationService.cs:9-14`); the wire-level `ScopeKey` on the request is recorded in
  [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html).
- **Where it's used**: registered against
  [`IPushNotificationUIService`](#ipushnotificationuiservice) as scoped by `AddNotificationUI()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:27`); injected
  into the admin pages [`NotificationList`](#notificationlist) and
  [`NotificationSend`](#notificationsend).

### BlazorCspPolicyProvider

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Security` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:21` · Level 2 · class (internal, sealed)

- **What it is**: the Content-Security-Policy provider for a Blazor Web host. It computes one CSP string at construction, pinning `connect-src` to `'self'` plus the configured API/Gateway origin (https and its matching WebSocket origin), and hands it to the shared security-headers middleware on every request.
- **Depends on**: first-party: [ICspPolicyProvider](group-16-aspire-orchestration.md#icsppolicyprovider) (the contract it implements, `BlazorCspPolicyProvider.cs:21`), [CspPolicy](group-16-aspire-orchestration.md#csppolicy) (the value it returns, a policy string plus an `Enforce` flag), [SecurityHeadersMiddleware](group-16-aspire-orchestration.md#securityheadersmiddleware) (its only consumer, named in the class doc at line 12), and [ApiSettings](#apisettings) (the endpoint source, injected as `IOptions<ApiSettings>` at line 26). Externals: `Microsoft.Extensions.Options` (`IOptions<T>`), `Microsoft.AspNetCore.Hosting` (`IWebHostEnvironment`), `Microsoft.AspNetCore.Http` (`HttpContext`), BCL `Uri`.
- **Concept introduced, a computed CSP that fails open on the value and closed on enforcement.** `[Rubric §26, Front-End Security]` assesses whether the browser is told which origins may load scripts and open connections. A static CSP cannot express "this deployment's API origin", because that origin is configuration, so the policy is *built* rather than hard-coded. The two directives that matter for exfiltration are locked: `script-src 'self' 'wasm-unsafe-eval'` (line 75, the WASM allowance is what lets the Blazor WebAssembly runtime instantiate) and the computed `connect-src` (line 55). The load-bearing design decision is what happens when the origin cannot be determined: instead of shipping a broken enforced policy (which would break the running app) or shipping nothing, the provider returns a permissive policy with `Enforce: false` (line 49), so the browser still *reports* violations while nothing is blocked. That is fail-open on the policy value and fail-closed on intent.
  - `[Rubric §11, Security]` assesses the wider defense posture; this class is one control in a chain that also includes the session-cookie auth design and the security-headers middleware, and it is deliberately `internal` (line 21) so the only supported way to get it is the registration call, not a hand-wired `new`.
- **Walkthrough**
  - `_policy` (line 24) is a single `CspPolicy` field computed once. The constructor (lines 26-31) null-guards both injected dependencies and calls `BuildCsp(apiOptions.Value, environment.IsDevelopment())` (line 30). Because the type is registered as a singleton, this runs exactly once per process.
  - `GetPolicy(HttpContext context)` (line 34) ignores the context and returns the cached policy, so the per-request cost is a field read.
  - `BuildCsp` (lines 38-67) resolves the endpoint as `api.WasmApiEndpoint ?? api.ApiEndpoint` (line 40). The guard on lines 44-47 rejects a blank value, a non-absolute URI, and any scheme that is not http or https; the comment on lines 42-43 records why the scheme check is not redundant: on Linux a rooted path such as `/relative/path` parses as an absolute `file://` URI and would otherwise sail through `Uri.TryCreate`. A rejected endpoint returns the Report-Only fallback (line 49).
  - With a valid endpoint it derives `origin` via `apiUri.GetLeftPart(UriPartial.Authority)` (line 53, `scheme://host:port`), picks `wss` or `ws` to match (line 54), and composes `connect-src 'self' {origin} {wsScheme}://{authority}` (line 55). The WebSocket origin is there for the SignalR notification hub, so the live push channel is allowed without opening `connect-src` to the world.
  - Development only (lines 61-64) appends `http://localhost:*` and `ws://localhost:*` for Visual Studio Browser Link and Hot Reload, whose ports change per run; the production policy is untouched.
  - `BuildPolicy` (lines 73-82) assembles the directive list: `default-src 'self'`, the `script-src` above plus `'unsafe-inline'` **in Development only** (line 75, for the injected Hot Reload bootstrap), `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: https:` (line 77, deliberately open because profile pictures and content images come from arbitrary external hosts, per the comment on lines 69-72), `font-src 'self'`, the computed `connect-src`, `base-uri 'self'`, `form-action 'self'`, and `frame-ancestors 'none'` (line 82, clickjacking protection).
- **Why it's built this way**: computing once and caching keeps the hot path free, and returning a `CspPolicy` record rather than writing a header directly keeps the provider testable and lets one middleware own header emission. Registering it with `AddSingleton` (not `TryAdd`) is what makes it *replace* the default static provider, which is why the ordering rule in the class doc (lines 18-19) matters: call `AddCommonBlazorCsp()` before `AddCommonSecurityHeaders`.
- **Where it's used**: registered by `AddCommonBlazorCsp()` in the `MMCA.Common.UI.Web` [DependencyInjection](#dependencyinjection) (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:39-40`); the policy it returns is emitted by [SecurityHeadersMiddleware](group-16-aspire-orchestration.md#securityheadersmiddleware). The class doc notes it was hoisted out of the app Blazor Web hosts where it had been byte-identical (line 18).

### NotificationBell

> MMCA.Common.UI · `MMCA.Common.UI.Components.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Notifications/NotificationBell.razor.cs:14` · Level 3 · class (partial, component)

- **What it is**: the code-behind for the app-bar notification bell. It renders an unread badge from the scoped [NotificationState](#notificationstate), and the first instance to render elects itself the single active poller so a bell placed in two layout slots never doubles the API traffic.
- **Depends on**: first-party: [NotificationState](#notificationstate) (badge value, change event, refresh signal, and the poller election), [INotificationInboxUIService](#inotificationinboxuiservice) (the unread-count call), [NotificationRoutePaths](#notificationroutepaths) (the inbox route), and [SharedResource](#sharedresource) (the resx anchor for the injected localizer). Externals: `Microsoft.AspNetCore.Components` (`[Inject]`, `NavigationManager`, `LocationChangedEventArgs`, `OnAfterRenderAsync`, `InvokeAsync`, `StateHasChanged`), `Microsoft.Extensions.Localization` (`IStringLocalizer<T>`), BCL `PeriodicTimer`, `CancellationTokenSource`, `IDisposable`.
- **Concept introduced, single-poller election across duplicate renders.** `[Rubric §19, State Management & Data Flow]` assesses how shared UI state is coordinated. The bell is a component, so a responsive layout can legitimately render it twice at once (desktop app bar and mobile drawer). Without coordination each copy would start its own 30-second timer and its own navigation refresh, doubling the unread-count endpoint's load for no user benefit. The fix is an election, not a singleton service: on first render the component calls `State.TryRegisterPoller()` (line 40), which is an `Interlocked.Increment` returning true only for the first caller (`NotificationState.cs:51`), and only the winner subscribes to `LocationChanged` and starts the timer (lines 41-48). The loser still renders and still re-renders on `OnChange`, so both bells show the same badge.
  - `[Rubric §23, Front-End Performance]` assesses avoidable network work; the election removes an entire duplicate polling stream in dual-placement layouts, and the poll interval itself (30 seconds, line 16) is a deliberate ceiling on background chatter given that a SignalR push already covers the low-latency path.
  - `[Rubric §21, Accessibility]` assesses whether icon-only controls are announced; the bell button carries an explicit localized `aria-label="@L["Notif.Bell.Aria"]"` in the markup (`NotificationBell.razor:10`), which is what the injected `IStringLocalizer<SharedResource> L` (line 21) is for.
  - **Fire-and-forget from a synchronous event handler.** Both `OnLocationChanged` (lines 68-69) and `HandleRefreshRequested` (lines 76-77) are `EventHandler`-shaped, so they cannot be `async Task`. Rather than `async void` (which turns an unobserved exception into a process crash, VSTHRD100, per the comment on lines 66-67), they discard the task with `_ =` and rely on the callee catching everything itself.
- **Walkthrough**
  - Fields: `PollInterval` (line 16, a `static readonly TimeSpan` of 30 seconds), the injected `State`, `InboxService`, `NavigationManager`, `L` (lines 18-21), a per-component `CancellationTokenSource _cts` (line 23), the `PeriodicTimer? _pollTimer` (line 24), and the two flags `_isActivePoller` / `_disposed` (lines 25-26).
  - `OnAfterRenderAsync(bool firstRender)` (lines 28-49) returns immediately on subsequent renders (lines 30-33), subscribes to `State.OnChange` and `State.OnRefreshRequested` (lines 35-36), then attempts the election (line 40). The winner hooks `NavigationManager.LocationChanged` (line 43), does an immediate refresh (line 44), creates the `PeriodicTimer` (line 46) and launches `PollLoopAsync` with an explicit discard (line 47).
  - `PollLoopAsync` (lines 51-64) awaits `_pollTimer!.WaitForNextTickAsync(_cts.Token)` in a loop (line 55) and refreshes each tick; the `OperationCanceledException` catch (lines 60-63) is the expected exit path on disposal, not an error.
  - `RefreshUnreadCountAsync` (lines 79-110) is the one place that touches the network: it bails when `_disposed` (lines 81-84), calls `InboxService.GetUnreadCountAsync(_cts.Token)` (line 88), and re-checks `_disposed` before marshalling `State.SetUnreadCount(count)` plus `StateHasChanged()` back onto the renderer with `InvokeAsync` (lines 89-96). It then catches three tiers: `OperationCanceledException` (disposal), `ObjectDisposedException` (disposed during the async gap), and a bare `catch` for network or deserialization failures, where the badge simply keeps its last value (lines 98-109). That catch-all is what makes the discards above safe.
  - `HandleStateChanged` (lines 112-113) discards into `RerenderSafeAsync` (lines 115-130), which re-renders through `InvokeAsync(StateHasChanged)` and tolerates a dispose that lands between the event firing and the render dispatch.
  - `NavigateToInbox` (line 132) sends the click to `NotificationRoutePaths.NotificationInbox`.
  - `Dispose(bool disposing)` (lines 134-154) sets `_disposed` first (line 141), unsubscribes both state events (lines 142-143), and, **only if it was the active poller**, unhooks `LocationChanged` and calls `State.UnregisterPoller()` (lines 145-149) so a later bell can take over the election; it then disposes the timer and cancels/disposes the `_cts` (lines 151-153). `Dispose()` (lines 156-160) is the public half with `GC.SuppressFinalize`.
- **Why it's built this way**: a live unread badge is a genuinely useful affordance, but a naive implementation is a request amplifier (one timer per rendered copy, per circuit). The election keeps the affordance and removes the amplification with two `Interlocked` operations and no extra service. Releasing the poller slot on dispose (rather than latching it for the circuit's lifetime) means a layout that swaps bells on a breakpoint change still polls.
- **Where it's used**: contributed to the shell as an app-bar component by [NotificationUIModule](#notificationuimodule) (`NotificationUIModule.cs:22`); it reads the same [NotificationState](#notificationstate) that [NotificationInbox](#notificationinbox) writes after a mark-read, so the badge stays consistent with the inbox without either component knowing about the other.

### NotificationUIModule

> MMCA.Common.UI · `MMCA.Common.UI.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs:14` · Level 4 · class (sealed)

- **What it is**: the notification feature's `IUIModule` descriptor. It declares the two nav entries (user inbox, admin push notifications), the app-bar component, the layout component, and the assembly to scan for routable pages.
- **Depends on**: first-party: [IUIModule](#iuimodule) (the contract, line 14), [NavItem](#navitem) and [NavSection](#navsection) (the nav item shape and its placement enum), [NotificationRoutePaths](#notificationroutepaths) (the two routes), [RoleNames](group-08-auth.md#rolenames) (the `Organizer` gate), plus the `NotificationBell` and `NotificationListener` components in the same package (lines 22, 24). Externals: `MudBlazor` (`Icons.Material.Filled.*`), `System.Reflection` (`Assembly`).
- **Concept introduced, the UI module pattern (the client-side counterpart to [IModule](group-14-module-system-composition.md#imodule)).** `[Rubric §25, Navigation, Routing & Information Architecture]` assesses how navigation is composed and how routes are discovered. Server modules declare their registrations and dependencies through `IModule`; UI features do the same for the shell. Nothing here calls into a layout: the module *declares* nav items and component types as data, and the host discovers every registered `IUIModule` and assembles the menu, app bar, and layout from those declarations. Adding a feature therefore never edits a shared `MainLayout.razor` or a central menu file.
  - `[Rubric §18, UI Architecture & Component Design]` applies to the two component collections: `AppBarComponentTypes` and `LayoutComponentTypes` are `Type` handles, so the shell renders them dynamically without a compile-time reference to the feature.
  - `[Rubric §11, Security]` applies to the role gate: the admin entry carries `RoleNames.Organizer` (line 19) on the nav item itself, so the authorization fact lives next to the thing it protects rather than in a layout `if`.
- **Walkthrough**
  - `NavItems` (lines 16-20) is an immutable `IReadOnlyList<NavItem>` with two entries: "Notification Inbox" to `NotificationRoutePaths.NotificationInbox` with the `Inbox` icon in `NavSection.User` (line 18, no role, so any authenticated user sees it), and "Push Notifications" to `NotificationRoutePaths.Notifications` with the `NotificationsActive` icon, gated on `RoleNames.Organizer`, in `NavSection.Admin` and grouped under "Notifications" (line 19).
  - `AppBarComponentTypes` (line 22) is `[typeof(NotificationBell)]`, the badge the shell injects into the top bar.
  - `LayoutComponentTypes` (line 24) is `[typeof(NotificationListener)]`, mounted once per layout so the SignalR callback wiring has exactly one owner.
  - `Assembly` (line 26) returns `typeof(NotificationUIModule).Assembly`, which the host adds to the Blazor router's additional assemblies so the pages in this package become routable in the consumer app.
- **Why it's built this way**: expressing contributions as data (collections of records and `Type`s) keeps the shell open for extension and closed for modification, and it is what allows a package to ship a complete feature (routes, nav, app-bar widget, background listener) that a host enables with one DI call. The class is `sealed` and every member is a get-only auto-property initialized inline, so the descriptor is safely shared as a singleton.
- **Where it's used**: registered as a singleton `IUIModule` by `AddNotificationUI()` in the notifications [DependencyInjection](#dependencyinjection) (`Notifications/DependencyInjection.cs:39`); enumerated by the host shell at startup to build navigation and to discover this package's routable components.

### ServerTokenStorageService

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:17` · Level 4 · class (sealed)

- **What it is**: the Blazor **Server** implementation of [ITokenStorageService](#itokenstorageservice): a cookie-only token store with no `localStorage`. During SSR prerender it reads the access token from the HttpOnly session cookie; on the live interactive circuit it holds the access token in memory only and re-acquires it from those cookies through a same-origin refresh endpoint. The refresh token is never readable from JavaScript.
- **Depends on**: first-party: [ITokenStorageService](#itokenstorageservice) (the contract, line 21), [CookieTokenReader](group-08-auth.md#cookietokenreader) (reads the access/refresh cookies off the request), [ISessionCookieSync](#isessioncookiesync) (seeds and clears the HttpOnly cookies), [ITokenRefresher](#itokenrefresher) (acquires a fresh access token from `/auth/session/token`), and [JwtTokenInfo](#jwttokeninfo) (client-side freshness check). Its WASM sibling is [WasmTokenStorageService](#wasmtokenstorageservice) (named in the class doc, line 14). Externals: `Microsoft.AspNetCore.Http` (`IHttpContextAccessor`, `HttpContext`), BCL `Lock`, `Task`, `TimeSpan`.
- **Concept introduced, the two-world token store (SSR request versus interactive circuit).** A Blazor Web page runs twice: first as a server-side prerender inside a live HTTP request, where an `HttpContext` exists and JS interop does not, and then as a stateful circuit with no `HttpContext`. One store has to serve both worlds, and this class branches on `httpContextAccessor.HttpContext is not null` (line 34) to decide which source of truth applies.
  - **SSR prerender** (lines 34-37): the request's HttpOnly cookie wins, read via `cookieTokenReader.ReadAccessToken()` (line 36), because the middleware may have just refreshed it in place on this navigation.
  - **Interactive circuit** (lines 39-71): the token lives in the `_accessToken` field (line 27). If `JwtTokenInfo.IsFresh(_accessToken, ExpirySkew)` (line 40) says it survives the 30-second skew (line 23), it is returned as is; otherwise it is re-acquired.
  - `[Rubric §26, Front-End Security]` assesses how credentials are held in the browser. This is a deliberate XSS-hardening design: the long-lived refresh token stays in an HttpOnly cookie unreachable from script, the access token exists only in circuit memory and is never persisted, and the refresh token transits JS exactly once, for the same-origin POST that seeds the cookies at login (`SetTokensAsync`, lines 81-87).
  - `[Rubric §11, Security]` assesses the wider auth model; this store is one edge of the browser session-cookie design ([ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)), the piece that decides *where* a bearer token is read on each side of the prerender boundary.
  - `[Rubric §12, Performance & Scalability]` shows up in the single-flight hydrate: a Blazor circuit is genuinely multi-threaded, and several consumers (the delegating handler, the auth-state provider, the SignalR connection) can all miss the cache at once.
- **Walkthrough**
  - The primary constructor (lines 17-21) takes `IHttpContextAccessor`, [CookieTokenReader](group-08-auth.md#cookietokenreader), [ISessionCookieSync](#isessioncookiesync), and [ITokenRefresher](#itokenrefresher). The type is `sealed` and carries no app-specific state, which is why it could be hoisted out of both app hosts (class doc, lines 13-15).
  - Fields: `ExpirySkew` (line 23, `static readonly TimeSpan` of 30 seconds), the `Lock _hydrateSync` (line 25, the .NET 9+ dedicated lock object), the in-memory `_accessToken` (line 27), and `_hydrateInFlight` (line 28), the shared acquisition task.
  - `GetAccessTokenAsync` (lines 30-72): the SSR/circuit branch, then the **single-flight** guard. `_hydrateInFlight ??= HydrateAsync()` executes *inside* `lock (_hydrateSync)` (lines 50-54) and the resulting task is copied to a local before the lock is released. The comment on lines 45-48 records exactly why the naive unguarded `??=` was not enough: two callers could each start a hydrate and the later completion would overwrite the other's token; `HydrateAsync` reaches its first await immediately, so nothing slow runs under the lock. The `finally` (lines 60-71) clears `_hydrateInFlight` **only when it is still reference-equal to the task this caller awaited** (line 66), so a newer hydrate started after this one completed is not dropped, which would split the next set of callers again.
  - `GetRefreshTokenAsync` (lines 74-79): returns `cookieTokenReader.ReadRefreshToken()` during SSR and `null` on the circuit, because the HttpOnly refresh cookie is unreadable there; it wraps the value in `Task.FromResult` rather than being `async` (no await needed).
  - `SetTokensAsync` (lines 81-87): caches the access token in memory (line 83) and calls `sessionCookieSync.SyncAsync(accessToken, refreshToken)` (line 86) to seed the HttpOnly cookies at login.
  - `ClearTokensAsync` (lines 89-93): nulls the in-memory token and calls `sessionCookieSync.ClearAsync()` on logout.
  - `HydrateAsync` (lines 95-99): the private acquisition, `_accessToken = await tokenRefresher.AcquireAccessTokenAsync()` (line 97), caching and returning the new token.
- **Why it's built this way**: Blazor Server's split lifecycle breaks the naive "read a token from storage" store, which would either fail during prerender (no JS) or leak the refresh token to script if it used `localStorage`. Branching on `HttpContext` presence and keeping the refresh token cookie-only resolves both. The locked single-flight is the correction of a real concurrency defect in the simpler `??=` version, and it is worth reading as a small case study in why "good enough" atomicity on a circuit is not good enough. See [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html).
- **Where it's used**: registered as the scoped [ITokenStorageService](#itokenstorageservice) by `AddCommonServerTokenStorage()` in the `MMCA.Common.UI.Web` [DependencyInjection](#dependencyinjection) (`DependencyInjection.cs:26-30`); consumer hosts call that instead of shipping their own copy.
- **Caveats / not-in-source**: the cookie names, lifetimes, and the `/auth/session/token` endpoint itself are not in this file; they live in the `MMCA.Common.API` session-cookie plumbing referenced by the doc comment (lines 12-15).

### DependencyInjection

> MMCA.Common.UI · `MMCA.Common.UI.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:12` · Level 5 · class (static)

- **What it is**: the notification-UI registration entry point, a single `AddNotificationUI()` extension on `IServiceCollection` that wires the two typed HTTP services, the shared per-circuit state, the SignalR client, the scope provider, and the `IUIModule` descriptor.
- **Depends on**: first-party: [INotificationScopeProvider](#inotificationscopeprovider) + [NullNotificationScopeProvider](#nullnotificationscopeprovider), [IPushNotificationUIService](#ipushnotificationuiservice) + [PushNotificationService](#pushnotificationservice), [INotificationInboxUIService](#inotificationinboxuiservice) + [NotificationInboxService](#notificationinboxservice), [NotificationState](#notificationstate), [NotificationHubService](#notificationhubservice), and [IUIModule](#iuimodule) + [NotificationUIModule](#notificationuimodule). Externals: `Microsoft.Extensions.DependencyInjection` (`IServiceCollection`, `AddScoped`, `AddSingleton`) and `Microsoft.Extensions.DependencyInjection.Extensions` (`TryAddScoped`).
- **Concept**: the C# `extension(IServiceCollection services)` registration idiom used package-wide (see [primer](00-primer.md#c-extensiont-types--read-this-once)); the block opens at line 14 and the method inside it is an ordinary extension method in the new form. Note this is one of several `DependencyInjection` classes in the UI packages: this one is specifically the **Notifications** registrar, the sibling of the `MMCA.Common.UI.Web` host registrar below.
  - `[Rubric §33, Developer Experience & Inner Loop]` assesses how much a consumer must know to switch a feature on; the answer here is one call.
  - `[Rubric §3, Clean Architecture]` assesses where composition lives; the feature owns its own DI, so nothing about notifications leaks into a host's `Program.cs` beyond the single line.
  - **`TryAdd` versus `Add` is a deliberate signal.** The scope provider is registered with `TryAddScoped` (line 24) precisely so an app that registers its own [INotificationScopeProvider](#inotificationscopeprovider) wins regardless of the order the two registration calls run in (the comment on lines 22-23 says so); everything else uses plain `AddScoped`/`AddSingleton` because this package owns those contracts.
- **Walkthrough**: inside the extension block (line 14), `AddNotificationUI()` (line 20) registers, in order, [INotificationScopeProvider](#inotificationscopeprovider) to [NullNotificationScopeProvider](#nullnotificationscopeprovider) via `TryAddScoped` (line 24, the default no-op scope consumed by both HTTP services), `IPushNotificationUIService` to `PushNotificationService` (scoped, line 27), `INotificationInboxUIService` to `NotificationInboxService` (scoped, line 30), [NotificationState](#notificationstate) as a concrete scoped type (line 33, one unread-count owner per Blazor circuit), [NotificationHubService](#notificationhubservice) (scoped SignalR client, line 36), and finally [NotificationUIModule](#notificationuimodule) as a **singleton** [IUIModule](#iuimodule) (line 39), because the descriptor is immutable shell metadata rather than per-circuit state. It returns `services` for chaining (line 41).
- **Why it's built this way**: the scoped-versus-singleton split is the load-bearing part. HTTP services, state, and the hub connection are per-circuit (a Blazor circuit is a DI scope, and the unread count belongs to one user's session), while the nav/shell descriptor is process-wide and immutable. Bundling all six behind one extension keeps host startup honest and makes the feature's dependency surface reviewable in one screen.
- **Where it's used**: called from the `Program.cs` of each consuming host (Blazor Web and MAUI) that opts into the notification UI; it complements the main `MMCA.Common.UI` registration rather than replacing it.

### DependencyInjection

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:14` · Level 5 · class (static)

- **What it is**: the registration extensions for the server-side Blazor Web host pieces this package ships: three `IServiceCollection` methods a host calls from `Program.cs` instead of registering app-local copies of the token store, the CSP provider, and the form factor.
- **Depends on**: first-party: [ServerTokenStorageService](#servertokenstorageservice) + [ITokenStorageService](#itokenstorageservice), [BlazorCspPolicyProvider](#blazorcsppolicyprovider) + [ICspPolicyProvider](group-16-aspire-orchestration.md#icsppolicyprovider), and [WebFormFactor](group-26-device-capability-layer.md#webformfactor) + [IFormFactor](group-26-device-capability-layer.md#iformfactor). Externals: `Microsoft.Extensions.DependencyInjection` (`IServiceCollection`, `AddScoped`, `AddSingleton`, `AddHttpContextAccessor`).
- **Concept**: same `extension(IServiceCollection services)` block idiom as its notifications sibling (line 16, see [primer](00-primer.md#c-extensiont-types--read-this-once)). What is worth studying here is that the XML docs carry **operational rules that the compiler cannot enforce**, and they are the only place those rules are written down next to the code.
  - `[Rubric §15, Best Practices & Code Quality]` assesses idiom consistency; every `MMCA.Common.*` package registers services through the same extension shape, so a reader who has seen one registrar has seen them all.
  - `[Rubric §26, Front-End Security]` assesses browser hardening wiring; `AddCommonBlazorCsp()` is what actually puts [BlazorCspPolicyProvider](#blazorcsppolicyprovider) in front of the default static provider, and its doc (lines 35-37) encodes the ordering rule: call it **before** `AddCommonSecurityHeaders`, because the default is registered with `TryAdd` and would otherwise win.
- **Walkthrough**
  - `AddCommonServerTokenStorage()` (lines 26-30): calls `services.AddHttpContextAccessor()` (line 28), the accessor [ServerTokenStorageService](#servertokenstorageservice) needs to tell SSR from circuit, then registers it as the **scoped** [ITokenStorageService](#itokenstorageservice) (line 29). Scoped is the right lifetime: a circuit is a DI scope, so the in-memory access token is per-session state. The doc (lines 22-24) names the two companions this registration assumes, `AddServerAuthSessionCookie` / `UseCookieSessionRefresh` from `MMCA.Common.API`, plus a registered `ITokenRefresher`.
  - `AddCommonBlazorCsp()` (lines 39-40): registers [BlazorCspPolicyProvider](#blazorcsppolicyprovider) as a **singleton** [ICspPolicyProvider](group-16-aspire-orchestration.md#icsppolicyprovider), matching the provider's compute-once constructor. `AddSingleton` (not `TryAdd`) is what makes the replacement deterministic.
  - `AddCommonWebFormFactor()` (lines 47-48): registers [WebFormFactor](group-26-device-capability-layer.md#webformfactor) as a **singleton** [IFormFactor](group-26-device-capability-layer.md#iformfactor), which reports "Web" plus the server OS description; the doc (lines 44-45) notes the WASM client registers `AddWasmFormFactor()` from `MMCA.Common.UI` instead, so the same abstraction resolves differently per host kind.
- **Why it's built this way**: all three pieces are host-level infrastructure that carried no app-specific state, so they were hoisted into `MMCA.Common.UI.Web` and exposed as one-line registrations. That keeps every consumer's `Program.cs` free of duplicated token-store, CSP, and form-factor wiring, which is the reusable-building-blocks charter of this group. See [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html) for the session design the first method plugs into.
- **Where it's used**: called from the `Program.cs` of the server-interactive Blazor Web hosts in the consumer apps (MMCA.ADC, MMCA.Store).

### NotificationInbox

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationInbox.razor.cs:17` · Level 5 · class (partial, page)

- **What it is**: the code-behind for the per-user notification inbox, routed at `@page "/notifications/inbox"` (`NotificationInbox.razor:1`). It fetches the signed-in user's notifications a page at a time, renders each as a read/unread row, lets the user mark items read individually or all at once, and reloads the current page when a real-time push asks for a refresh.
- **Depends on**: first-party: [INotificationInboxUIService](#inotificationinboxuiservice) (the typed read-side HTTP service), [NotificationState](#notificationstate) (the per-circuit unread-count store and refresh signal), [UserNotificationDTO](group-10-notifications.md#usernotificationdto) (the row shape), [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) (the paged envelope the inbox service returns), [ErrorMessages](#errormessages) (centralized snackbar copy), and [SharedResource](#sharedresource) (the resx anchor for the localizer). Externals: `MudBlazor` (`ISnackbar`, `BreadcrumbItem`, `Icons`, `Severity`), `Microsoft.AspNetCore.Components` (`[Inject]`, `OnInitializedAsync`, `InvokeAsync`, `StateHasChanged`), `Microsoft.Extensions.Localization` (`IStringLocalizer<T>`), BCL `CancellationTokenSource`, `IDisposable`, `Math.Ceiling`, `DateTime.UtcNow`.
- **Concept introduced, the Blazor code-behind page pattern (`.razor` plus `.razor.cs` partial class).** The three notification pages in this unit are authored as *partial classes* split across two files: the `.razor` holds declarative MudBlazor markup and the route, the `.razor.cs` holds the C# (`public partial class NotificationInbox`, line 17), the injected services, the view state, and the handlers. The framework constructs the component, calls `OnInitializedAsync` (line 39) once, and re-renders when a handler mutates a field. Four habits recur across all three pages and are worth learning once here:
  - **Disposal-safe async with a per-component `CancellationTokenSource`.** A `readonly CancellationTokenSource _cts` (line 26) is created with the component and its token is passed to every service call. `Dispose(bool)` (lines 180-192) cancels and disposes it behind the classic `_disposed` guard (line 178). Every async handler swallows `OperationCanceledException` silently (for example lines 93-96) because that is the *expected* outcome when the user navigates away mid-fetch; only genuine exceptions reach a snackbar.
  - **Busy flags gate the UI.** `IsLoading` and `IsSaving` (lines 32-33) are `protected` with private setters; the markup shows progress while loading and sets `Disabled="IsSaving"` on the action controls (`NotificationInbox.razor:17,59`) so a double click cannot double-post.
  - **Push-driven refresh via an event subscription.** `OnInitializedAsync` subscribes to `NotificationState.OnRefreshRequested` (line 49) and `Dispose(bool)` unsubscribes (line 186). `HandleRefreshRequested` (lines 54-62) bounces onto the render thread with `InvokeAsync(RefreshFromPushAsync)` (line 61), and `RefreshFromPushAsync` (lines 64-75) coalesces overlapping refreshes by returning early when disposed or already loading (lines 68-71) before reloading and calling `StateHasChanged` (line 74). The list stays live with no polling of its own.
  - **Centralized, localized error copy** through [ErrorMessages](#errormessages), for example `ErrorMessages.LoadError(L["Entity.Notifications"], ex)` (line 99), instead of inline English.
  - `[Rubric §18, UI Architecture & Component Design]` assesses component cohesion; this page keeps markup in `.razor` and behavior in `.razor.cs`, talks only to an injected abstraction rather than an `HttpClient`, and does one job.
  - `[Rubric §19, State Management & Data Flow]` assesses where state lives; transient view state stays in private fields (`_notifications`, `_currentPage`, `_totalPages`, lines 35-37) while the *shared* unread count is written back into the scoped [NotificationState](#notificationstate) (line 129) and its refresh signal is read. Local stays local, shared stays shared.
  - `[Rubric §21, Accessibility]` assesses keyboard and screen-reader support; the icon-only mark-read control carries an explicit localized `aria-label` (`NotificationInbox.razor:57`).
  - `[Rubric §27, Internationalization & Localization]` assesses whether user-facing text resolves per culture from one catalog. This page holds no literal English: the injected `IStringLocalizer<SharedResource> L` (line 24) resolves the title (line 28), the breadcrumbs, and every snackbar (`L["Notif.AllMarkedRead"]`, line 162). The breadcrumb trail is built inside `OnInitializedAsync` (lines 43-47), not in a field initializer, so the injected localizer is available and labels re-resolve per circuit under the active culture (the comment on lines 41-42 cites [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Walkthrough**
  - `PageSize` (line 19) is `const int 20`: fixed-size server-side pagination, not infinite scroll.
  - Injected `InboxService`, `NotificationState`, `Snackbar`, `L` (lines 21-24) as `[Inject]` auto-properties; the `= default!` suppresses nullability because DI guarantees the value.
  - `Title` (line 28) is a computed property over `L["Notif.Inbox.Title"].Value`; `_breadcrumbs` (line 30) starts empty and is filled in `OnInitializedAsync`, with the leaf crumb `disabled: true` to mark the current page (line 46).
  - `LoadNotificationsAsync` (lines 77-105): sets `IsLoading`, calls `GetInboxAsync(_currentPage, PageSize, _cts.Token)` (line 82), materializes `result.Items` into `_notifications` (line 85), and computes `_totalPages` from `result.PaginationMetadata.TotalItemCount` with `Math.Ceiling` (line 86), clamped to a floor of 1 (lines 87-90) so an empty inbox never renders a zero-page pager. `IsLoading` is cleared in `finally` (lines 101-104).
  - `OnPageChangedAsync(int page)` (lines 107-111): records the page and reloads.
  - `MarkReadAsync(UserNotificationDTO)` (lines 113-143): calls `MarkReadAsync(notification.Id, _cts.Token)` (line 118), then **optimistically patches local state**, locating the row with `FindIndex` (line 121) and replacing it via a `record with`-expression, `notification with { IsRead = true, ReadOn = DateTime.UtcNow }` (line 124). It then refetches the authoritative unread count (line 128) and pushes it into `NotificationState.SetUnreadCount` (line 129) so the bell badge follows without a full reload.
  - `MarkAllReadAsync` (lines 145-176): one service call (line 150), a loop flipping every unread row in place (lines 153-159), then `SetUnreadCount(0)` (line 161) and a localized success snackbar (line 162).
  - Disposal: `_disposed` (line 178), `Dispose(bool)` (lines 180-192) unsubscribing the refresh event and cancelling the `_cts`, `Dispose()` (lines 194-198) with `GC.SuppressFinalize`.
- **Why it's built this way**: the page is a *thin* view over [INotificationInboxUIService](#inotificationinboxuiservice), so all HTTP and JSON live in the service and the component stays testable against a stub. Patching local state after a mark-read (rather than refetching the page) keeps the interaction snappy while still reconciling the shared badge from the server, and the event-driven refresh keeps the list current when a push lands. Shipping the whole inbox from `MMCA.Common.UI` is the group's charter: every consumer app gets it for free.
- **Where it's used**: rendered at `/notifications/inbox` for authenticated users; the route constant and nav entry come from [NotificationRoutePaths](#notificationroutepaths) and [NotificationUIModule](#notificationuimodule). [NotificationBell](#notificationbell) reads the same [NotificationState](#notificationstate) this page writes, and the layout-mounted `NotificationListener` raises the `OnRefreshRequested` signal it consumes. Its admin siblings are [NotificationList](#notificationlist) and [NotificationSend](#notificationsend).

### NotificationList

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationList.razor.cs:16` · Level 5 · class (partial, page)

- **What it is**: the code-behind for the **admin/organizer** push-notification history page, routed at `@page "/notifications"` (`NotificationList.razor:1`). It loads previously sent broadcasts and renders them in a status table, with a button onward to the compose page.
- **Depends on**: first-party: [IPushNotificationUIService](#ipushnotificationuiservice) (the send/history HTTP service), [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) (the row shape, carrying status and recipient count), [NotificationRoutePaths](#notificationroutepaths) (the route constants), [ErrorMessages](#errormessages), and [SharedResource](#sharedresource). Externals: `MudBlazor` (`ISnackbar`, `BreadcrumbItem`, `Icons`, `Severity`), `Microsoft.AspNetCore.Components` (`NavigationManager`, `[Inject]`), `Microsoft.Extensions.Localization`.
- **Concept reinforced, the same code-behind shape as [NotificationInbox](#notificationinbox).** Same `[Inject]` service set (lines 18-21), same `readonly CancellationTokenSource _cts` plus dispose pattern (lines 23, 76-95), same `IsLoading` gate (line 29), same cancellation-swallowing load (lines 60-63), same localized `ErrorMessages.LoadError` snackbar (line 66). It differs only in *what* it loads and *how much* of it.
  - `[Rubric §25, Navigation, Routing & Information Architecture]` assesses route structure and inter-page flow; navigation goes through [NotificationRoutePaths](#notificationroutepaths) constants (`NavigateToSend` targets `NotificationRoutePaths.NotificationSend`, line 74) rather than a literal URL, so a route change happens in exactly one file.
  - `[Rubric §27, Internationalization & Localization]` picks up an extra trick here: `DisplayStatus(string status)` (lines 34-38) looks up `L[$"Notif.Status.{status}"]` and falls back to the raw wire value when `localized.ResourceNotFound` (line 37). The *comparison* value stays the untranslated wire string while only the displayed chip text localizes, which keeps transport values and presentation separate and means a newly added server status renders (untranslated) instead of blanking (the comment on line 33 cites [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Walkthrough**
  - Injected `NotificationService`, `NavigationManager`, `Snackbar`, `L` (lines 18-21); `Title` reads `L["Notif.List.Title"].Value` (line 25); `_breadcrumbs` (line 27) is built Home to Push Notifications in `OnInitializedAsync` (lines 43-47).
  - `_notifications` is an `IReadOnlyCollection<PushNotificationDTO>` initialized empty (line 31).
  - `OnInitializedAsync` (lines 40-50) builds the breadcrumbs then awaits `LoadNotificationsAsync`.
  - `LoadNotificationsAsync` (lines 52-72): calls `GetHistoryAsync(pageNumber: 1, pageSize: 50, _cts.Token)` (line 57) and copies `result?.Items` into `_notifications`, defaulting to an empty collection when either is null (line 58). This page fetches **one fixed 50-row page** and lets MudBlazor page that buffer client-side; unlike the inbox there is no server round-trip per page.
  - `NavigateToSend` (line 74) sends the "send new" button to the compose page.
  - Disposal mirrors the family: `_disposed` (line 76), `Dispose(bool)` cancelling the `_cts` (lines 78-89), `Dispose()` (lines 91-95).
- **Why it's built this way**: broadcast history is low-volume admin data, so one 50-row fetch with client-side paging is simpler and adequate, and it avoids server-side paging plumbing that would earn nothing. Keeping HTTP behind [IPushNotificationUIService](#ipushnotificationuiservice) mirrors the inbox and keeps the component a thin view. The shared `[Rubric §18, UI Architecture & Component Design]` story is told under [NotificationInbox](#notificationinbox).
- **Where it's used**: rendered at `/notifications` for organizer/admin roles (the nav entry from [NotificationUIModule](#notificationuimodule) is gated on [RoleNames](group-08-auth.md#rolenames)`.Organizer`); it links onward to [NotificationSend](#notificationsend).
- **Caveats / not-in-source**: the 50-row ceiling is a client-side choice in this file; what the server does when more than 50 broadcasts exist (whether the page silently truncates the history) is not visible here.

### NotificationSend

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationSend.razor.cs:16` · Level 5 · class (partial, page)

- **What it is**: the code-behind for the compose-and-broadcast form, routed at `@page "/notifications/send"` (`NotificationSend.razor:1`). It collects a title and a message, validates them through a `MudForm`, sends one broadcast through the Notification API, reports the recipient count, and returns to the history page.
- **Depends on**: first-party: [IPushNotificationUIService](#ipushnotificationuiservice) (the `SendAsync` call), [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) (the request record built from the two fields), [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) (the result carrying `RecipientCount`), [NotificationRoutePaths](#notificationroutepaths), [ErrorMessages](#errormessages), and [SharedResource](#sharedresource). Externals: `MudBlazor` (`MudForm`, `ISnackbar`, `BreadcrumbItem`, `Icons`, `Severity`), `Microsoft.AspNetCore.Components` (`NavigationManager`, `OnInitialized`), `Microsoft.Extensions.Localization`.
- **Concept introduced, `MudForm`-driven validation with a `@ref` handle.** This is the family's *form* page. The markup declares `<MudForm @ref="_form">` (`NotificationSend.razor:21-42`) with two required fields carrying localized `RequiredError` text and `MaxLength` limits (200 for the title, 2000 for the message, lines 24-26 and 34-37 of the markup). The C# holds the form by reference (`MudForm? _form`, line 34) and **explicitly drives validation** before sending: `await _form.ValidateAsync()` then a guard on `_form.IsValid` (lines 50-55). That is the imperative half of MudBlazor's two-way validation contract: declarative rules in markup, an explicit gate in code, so an invalid form never reaches the API. The bound fields are plain strings (lines 32-33) rather than a model object because the form is tiny; they are deliberately *not* named `_title`, to avoid colliding with the localized `Title` page property (the comment on line 31 cites SonarAnalyzer S4275).
  - `[Rubric §24, Forms, Validation & UX Safety]` assesses input validation, double-submit protection, and feedback. All three are present: client-side required/length rules, an `IsSaving` flag (line 29) bound to `Disabled` on both buttons (`NotificationSend.razor:49,56`) so the send cannot be fired twice, a warning snackbar `ErrorMessages.ValidationError` on a failed gate (line 53), and a success snackbar naming the recipient count (line 65).
  - `[Rubric §27, Internationalization & Localization]`: every string resolves through `IStringLocalizer<SharedResource> L` (line 21), including the success message `L["Notif.Send.SentTo", result.RecipientCount]` (line 65), which passes the count as a **format argument** so pluralization and word order stay in the resource file rather than being concatenated in C#. As with its siblings the breadcrumb trail is built in an initialization hook, here the synchronous `OnInitialized` (lines 36-43, comment citing [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Walkthrough**
  - Injected `NotificationService`, `NavigationManager`, `Snackbar`, `L` (lines 18-21); `_cts` (line 23); `Title` (line 25); `_breadcrumbs` (line 27) built Home to Push Notifications to Send (lines 38-43), where the middle crumb is a real link via `NotificationRoutePaths.Notifications` (line 41) and the leaf is `disabled: true` (line 42).
  - `SendNotificationAsync` (lines 45-81): null-guards `_form` (lines 47-48); validates and warns on failure (lines 50-55); then under `IsSaving` builds `new SendPushNotificationRequest(_notificationTitle, _notificationBody)` (line 60) and awaits `SendAsync(request, _cts.Token)` (line 61). On a non-null [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) it raises the success snackbar with `result.RecipientCount` (line 65) and navigates back to the list (line 66). The cancellation catch here additionally names the `InteractiveAuto` render-mode transition (comment on line 71), the case where the WebAssembly runtime takes over mid-call; `IsSaving` is cleared in `finally` (lines 77-80).
  - `NavigateToList` (line 83) is the Cancel button's handler, back to `NotificationRoutePaths.Notifications`.
  - Disposal mirrors the family: `_disposed` (line 85), `Dispose(bool)` (lines 87-98), `Dispose()` (lines 100-104).
- **Why it's built this way**: a deliberately small form. There is no unsaved-changes guard because the page is create-only and one-shot, validation stays in `MudForm` because the only rules are required plus length (a FluentValidation round-trip would buy nothing at this size), and HTTP stays behind [IPushNotificationUIService](#ipushnotificationuiservice) so the component is unit-testable. The send is fire-and-confirm: the server fans out to recipients through the push pipeline (see [Group 10](group-10-notifications.md)) and returns only the aggregate count.
- **Where it's used**: rendered at `/notifications/send` for organizer/admin roles, reached from the button on [NotificationList](#notificationlist). The server-side validator for [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) enforces the same rules a second time, so client validation is a UX affordance rather than the security boundary.


---
[⬅ Module System, Composition & Configuration](group-14-module-system-composition.md)  •  [Index](00-index.md)  •  [Aspire Orchestration & Service Defaults ➡](group-16-aspire-orchestration.md)
