# 15. Common UI Framework (MudBlazor components, theme, base pages)

**What this chapter covers.** `MMCA.Common.UI` is the Blazor presentation package, and it is one of
the two layers (with `Grpc`) allowed to reference **`Shared` only**: its single `ProjectReference` is
`MMCA.Common.Shared` (`MMCA.Common.UI/MMCA.Common.UI.csproj:42`), and every other dependency is a
NuGet package (MudBlazor, Polly, the SignalR client, Scrutor, QRCoder, FeatureManagement,
`System.IdentityModel.Tokens.Jwt`, `MMCA.Common.UI.csproj:19-37`). It touches no Application, Domain
or Infrastructure type, which is exactly what lets it compile into a Blazor WebAssembly bundle and
into a .NET MAUI hybrid head (see [primer §1](00-primer.md#1-the-big-picture)). What it ships is the
set of reusable parts every consumer UI assembles pages from: a **server-paged data-grid list-page
base class**, the brand **MudBlazor theme**, a **Result-returning typed HTTP service base** for
talking to the WebAPI, a **client-side read cache**, the **authentication and token-refresh
boundary**, **list-page state preservation** across navigation, **vendor-neutral toast and dialog
facades**, a **pluggable UI-module** contract, an end-to-end **localization** pipeline, and a turnkey
**notification inbox / push / live-channel** feature. A second, thinner package `MMCA.Common.UI.Web`
sits above it and holds the pieces that need an ASP.NET pipeline (server-side token storage, the
Blazor Content-Security-Policy provider). The per-app and per-module Razor pages in the consumer apps
([chapter 21](group-21-conference-ui.md)) derive from and consume these primitives, and the same
components render across Blazor Server, WebAssembly and MAUI with no per-platform reimplementation.
`[Rubric §18, UI Architecture & Component Design]` assesses component reuse, separation of
presentation from data access, and whether there is a coherent composition model; nearly every type
in this group exists so a consumer page is *composed* rather than hand-rolled, which is the shape
[ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html) records.

**The data-access boundary: a Result contract over one named HttpClient.** A page never touches
`HttpClient`, and it never catches an exception to learn what the server said. It depends on
[`IEntityService<TEntityDTO, TIdentifierType>`](#ientityservicetentitydto-tidentifiertype)
(`MMCA.Common.UI/Common/Interfaces/IEntityService.cs:20`), whose seven CRUD members every one return
a [`Result`](group-01-result-error-handling.md#result) or `Result<T>`
(`IEntityService.cs:25-66`), and it gets its behavior from the abstract
[`EntityServiceBase<TEntityDTO, TIdentifierType>`](#entityservicebasetentitydto-tidentifiertype)
(`MMCA.Common.UI/Services/EntityServiceBase.cs:43`), which derives in turn from
[`AuthenticatedServiceBase`](#authenticatedservicebase)
(`MMCA.Common.UI/Services/AuthenticatedServiceBase.cs:15`). That base owns the cross-cutting concerns
of an outbound call. First, a **Polly** retry policy: 3 retries with exponential backoff (2s, 4s, 8s)
plus up to one second of random jitter so a fleet of clients does not re-converge on the same instant
(`AuthenticatedServiceBase.cs:25`, `:114-116`), over a deliberate retryable set rather than "any
5xx", since 501 and 505 are permanent verdicts and are excluded while 408 and 429 are explicit
invitations to come back (`AuthenticatedServiceBase.cs:100-109`); the policy's `onRetry` disposes each
superseded response, because Polly hands the caller only the final outcome and an undisposed 5xx
leaks its content buffer and holds its connection out of the pool under exactly the sustained failure
the retries exist to survive (`AuthenticatedServiceBase.cs:131-134`). Second, a helper that creates a
`"APIClient"` `HttpClient` from `IHttpClientFactory` and stamps the JWT Bearer token onto it from
[`ITokenStorageService`](#itokenstorageservice), swallowing the `InvalidOperationException` that JS
interop throws during SSR prerender (`AuthenticatedServiceBase.cs:51-70`); a sibling
`CreateClientWithToken` builds a client around an explicitly supplied token so a request the API
answered `401` can be replayed with one acquired straight from [`ITokenRefresher`](#itokenrefresher)
rather than resending the token the server just rejected (`AuthenticatedServiceBase.cs:80-87`).

Retry and idempotency are coupled on purpose: `NewIdempotencyKey()`
(`AuthenticatedServiceBase.cs:43`) is generated **once per logical write** and set as a default header
on the single client that serves every attempt (`EntityServiceBase.cs:159-163`, `:376-397`), so a
retried create dedupes on the server instead of producing a duplicate row (the server half is
[`IdempotencyHeaders`](group-08-auth.md#idempotencyheaders) and
[`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute),
[ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)). Creates are the only
verb that carries a key: updates are full PUTs and deletes are naturally idempotent
(`EntityServiceBase.cs:156-158`). Updates instead carry a precondition: `ConcurrencyTagOf` renders a
DTO's `RowVersion` as a weak entity tag when the DTO implements
[`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware), and that tag travels as the
`If-Match` header on the same per-operation client, so every retry states the same precondition
instead of a later attempt succeeding against a version the user never saw
(`EntityServiceBase.cs:197-200`, `:389-395`,
[ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). Responses come back
in the same [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt) /
[`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt) envelopes the API
returns, and both `SendRequestAsync` overloads read the response through
[`ProblemDetailsResultReader`](group-08-auth.md#problemdetailsresultreader)
(`EntityServiceBase.cs:324-342`, `:354-370`), so a 404 arrives as an
[`ErrorType`](group-01-result-error-handling.md#errortype)`.NotFound` failure, a rejection as
`Validation`, a 500 as `Unexpected`, each carrying the server's own text. What the reader cannot
convert is the *absence* of a response, and that is
[`HttpResultExecutor`](#httpresultexecutor)'s job
(`MMCA.Common.UI/Services/HttpResultExecutor.cs:31`): it wraps each call, turns a refused connection,
a broken stream or an unreadable body into `Http.TransportFailure` and a client-side timeout into
`Http.Timeout` (`HttpResultExecutor.cs:34`, `:37`, `:121-122`), and rethrows an
`OperationCanceledException` **only** when the caller's own token asked for it, because a page owns
its cancellation and must not have a disposed component reported back as an error to render
(`HttpResultExecutor.cs:65-72`). Many-to-many join endpoints, which have POST and DELETE but no
standalone reads, get their own thinner base, [`ChildEntityServiceBase`](#childentityservicebase)
(`MMCA.Common.UI/Services/ChildEntityServiceBase.cs:19`), whose `DeleteByIdAsync` reports a missing
join row as a `NotFound` failure so "nothing to remove" stays distinguishable from "the remove
failed" (`ChildEntityServiceBase.cs:62-79`). The page-side half of the same transport is
[`ResultUiExtensions`](#resultuiextensions)
(`MMCA.Common.UI/Common/ResultUiExtensions.cs:63`): `TryGetValue` unwraps inside a conditional the way
`Dictionary.TryGetValue` does, branching on `IsFailure` rather than on a null so a failed
`(Items, TotalItems)` tuple is not read as a success (`ResultUiExtensions.cs:82-97`), and the
rendering helpers look every message up as a resource key with pass-through, de-duplicate ordinally,
and order most severe first so a real 403 leads and an incidental validation line never buries it
(`ResultUiExtensions.cs:18-29`). `[Rubric §3, Clean Architecture]` and `[Rubric §9, API & Contract
Design]`: the UI binds to a DTO contract and an interface, never to server internals, and the wire
envelope is uniform across every entity. `[Rubric §29, Resilience]` is the retry, jitter, idempotency
and precondition set. The contract itself is recorded in
[ADR-094](https://ivanball.github.io/docs/adr/094-client-entity-data-access.html), and the retirement
of the old exception-throwing UI deviation in
[ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html).

**A third caching tier, on the client.** [`IUiReadCache`](#iuireadcache)
(`MMCA.Common.UI/Services/Caching/IUiReadCache.cs:32`) is a read-through cache sitting in front of the
API client, so a list re-read twice within a few seconds (a grid re-mounted by navigation, a lookup
rendered in two components) costs one round trip. Its four members are `TryGetFresh`, `Set`,
`InvalidatePrefix` and `Clear` (`IUiReadCache.cs:42`, `:51`, `:59`, `:66`), and the key is
**deliberately the relative URL, path plus the full query string**, which is the same key shape the
server's authenticated output cache uses, so a filter, page or sort change misses on both tiers
rather than being served stale by one of them (`IUiReadCache.cs:9-15`,
[ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).
[`UiReadCache`](#uireadcache) (`MMCA.Common.UI/Services/Caching/UiReadCache.cs:18`) implements it as a
lock-guarded ordinal dictionary (`UiReadCache.cs:20`, `:25`) with **lazy** expiry, dropping a stale
entry when it is next read instead of running a sweep timer over the few dozen entries a circuit ever
holds (`UiReadCache.cs:11-14`, `:50-52`), and TTL resolution picks the **longest** matching route
prefix so a child route can state a different budget than the endpoint it sits under
(`UiReadCache.cs:120-135`). Staleness is configuration, not accident:
[`UiReadCacheOptions`](#uireadcacheoptions)
(`MMCA.Common.UI/Common/Settings/UiReadCacheOptions.cs:13`) binds the `UiReadCache` section with an
`Enabled` escape hatch, a 60-second `DefaultTtl` and the per-prefix override map
(`UiReadCacheOptions.cs:16`, `:24`, `:32`, `:41`). `EntityServiceBase` takes the cache as an
**optional** constructor argument, so a service registered without one behaves exactly like a plain
GET (`EntityServiceBase.cs:47`, `:58`, `:241-268`); only successes are stored, because caching a
failure would pin a transient outage in front of the user for the whole TTL and let a 404 survive the
create that fixed it (`EntityServiceBase.cs:260-265`); and every successful write invalidates its own
endpoint prefix (`EntityServiceBase.cs:281-287`). The one cross-cutting hazard is scope: the cache is
scoped, which is per-circuit on Blazor Server but per **app lifetime** on WebAssembly and MAUI, so
[`AuthUIService`](#authuiservice)`.LogoutAsync` clears it explicitly rather than trusting the scope to
end with the session (`MMCA.Common.UI/Services/Auth/AuthUIService.cs:124-127`, and again on an
unrefreshable session at `:156`). `[Rubric §12, Performance & Scalability]` and `[Rubric §19, State
Management]` both land here, and the tier is recorded in
[ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html).

**The list page: `DataGridListPageBase<TDto>`.** This is the most concept-dense type in the group and
the centerpiece of the compose-do-not-repeat thesis. Every list screen in every consumer app derives
from [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto)
(`MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:22`), a `ComponentBase` that encapsulates what
would otherwise be copy-pasted onto each page: server-side paging against `MudDataGrid<T>`,
`CancellationTokenSource` lifecycle, loading state, filter and sort extraction from MudBlazor's
`GridState<T>`, error surfacing through the toast facade, a `LoadFailed` flag so a failed fetch
renders an inline retry instead of a misleading "no records" empty state
(`DataGridListPageBase.cs:42`, set at `:549` and `:571`), **viewport-driven mobile versus desktop
rendering** (it implements `IBrowserViewportObserver` and flips `IsMobile` through
[`BreakpointConstants`](#breakpointconstants) at the 960 px sidebar-collapse boundary,
`DataGridListPageBase.cs:46`, `:308`, and
`MMCA.Common.UI/Common/BreakpointConstants.cs:16-17`), a persisted dense-density toggle
(`DataGridListPageBase.cs:78`), and a careful `IAsyncDisposable`/`IDisposable` teardown. The fetch
path is Result-shaped end to end: a failed page toasts through
`NotifyOnFailure(Toast, Localizer)` and returns an empty grid rather than throwing
(`DataGridListPageBase.cs:546-551`). It also solves a Blazor render-mode problem: grid data captured
during SSR prerender is persisted through `PersistentComponentState` as a private
[`PersistedGridState`](#persistedgridstate) record (`DataGridListPageBase.cs:1034`), restored in
`OnInitialized` (`:171-175`) and re-registered for persisting with an **explicit**
`RenderMode.InteractiveAuto`, because a page that inherits its render mode from `<Routes>` gives the
framework nothing to associate the callback with (`DataGridListPageBase.cs:177-194`,
[ADR-056](https://ivanball.github.io/docs/adr/056-blazor-render-mode-strategy.html)). A
`PrerenderFetchTimeoutMs` of 5000 caps how long prerender may block on a cold backend before falling
back to an empty grid the first interactive fetch refills (`DataGridListPageBase.cs:84`, applied at
`:717`). `[Rubric §23, Front-End Performance & Rendering]` assesses render efficiency and avoided
round-trips; this persist-and-restore dance is that concern made concrete. Around the base sit three
smaller helpers that are deliberately *not* members of it, so a page composing its own layout can
still use them: [`ListPageActions`](#listpageactions)
(`MMCA.Common.UI/Pages/Common/ListPageActions.cs:14`) holds the mobile-versus-desktop reload dispatch
and the confirm-delete-reload flow every organizer list page repeats (`:25-38`, `:56`);
[`LatestLoadGuard`](#latestloadguard) (`MMCA.Common.UI/Common/LatestLoadGuard.cs:38`) gives each load
a generation and a token and cancels the previous one, which is what keeps a routed detail component
(reused by Blazor across route-parameter changes) from rendering entity 100's late answer after the
user has navigated to 101 (`LatestLoadGuard.cs:50-59`, `:67`); and
[`OfflineFirstPageSnapshot<TItem>`](#offlinefirstpagesnapshottitem)
(`MMCA.Common.UI/Pages/Common/OfflineFirstPageSnapshot.cs:21`) records the first page of a list into
[`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore) as a private
[`CachedPage`](#cachedpage) record (`:26`) and serves it back **only** when the device reports itself
offline and only for page 1, so the live path is untouched
(`OfflineFirstPageSnapshot.cs:30`, `:36-46`, `:54-65`). `[Rubric §22, Responsive &
Cross-Browser]` is named by `BreakpointConstants` and exercised by
[`MobileInfiniteScrollList<TItem>`](#mobileinfinitescrolllisttitem)
(`MMCA.Common.UI/Components/MobileInfiniteScrollList.razor.cs:20`), the mobile card list whose
IntersectionObserver sentinel, 500-item rendered cap (`:53`, `:213`) and generation-guarded
supersession of in-flight fetches keep a long list bounded; a page that wants infinite scroll without
giving up its own card markup renders [`InfiniteScrollSentinel`](#infinitescrollsentinel) alone
(`MMCA.Common.UI/Components/InfiniteScrollSentinel.razor.cs:21`), which owns just the observer and is
disposed by the renderer the moment the host stops rendering it (`:6-20`).

**State preservation across navigation.** Paging, sort, filters and density live in the URL query
string as the source of truth, encoded and decoded by
[`ListPageQueryStateService`](#listpagequerystateservice) under deliberately short reserved keys (`p`,
`ps`, `mp`, `s`, `sd`, `d`, `q`, `f:<name>`) with defaults omitted so a pristine list page has a clean
URL (`MMCA.Common.UI/Services/ListPageQueryStateService.cs:15-40`), so deep links and browser
back/forward replay correctly. The noisier scroll offset lives in
[`ListPageStateService`](#listpagestateservice)
(`MMCA.Common.UI/Services/ListPageStateService.cs:63`), a **per-circuit scoped** service whose
synchronous dictionary is the fast path and whose `HydrateFromSessionAsync`
(`ListPageStateService.cs:103`) / `PersistToSessionAsync` (`:138`) mirror entries through
`sessionStorage` via a `nav-interop.js` module (`:65`) so state survives circuit teardown, `forceLoad`
navigation and the SSR to WASM transition. Every JS path there is defensively caught (prerender,
disconnected circuit, Safari private mode) so storage can never break the page. The immutable
[`ListPageState`](#listpagestate) record (`ListPageStateService.cs:9`) carries page, page size, mobile
page, scroll, sort, density and a page-specific filter dictionary, and is updated with `with`
expressions. [`NavigationHistoryService`](#navigationhistoryservice)
(`MMCA.Common.UI/Services/Navigation/NavigationHistoryService.cs:12`) bridges Blazor's
`NavigationManager` to the browser history API so a detail page can perform a real `history.back()`
when a previous entry exists and fall back to a fixed path otherwise. `[Rubric §19, State Management &
Data Flow]` assesses a deliberate, scoped state model rather than ambient globals: these are
registered `Scoped`, so each circuit gets its own instance
(`MMCA.Common.UI/DependencyInjection.cs:110-112`). `[Rubric §25, Navigation & Information
Architecture]` covers the route catalogue ([`RoutePaths`](#routepaths)
(`MMCA.Common.UI/Common/RoutePaths.cs:7`), [`NavItem`](#navitem) with its role, claim, section and
group facets plus resource-key titles resolved per circuit
(`MMCA.Common.UI/Common/NavItem.cs:16`), and the [`NavSection`](#navsection) enum whose declaration
order is the sidebar order, `MMCA.Common.UI/Common/NavSection.cs:7-17`) and the open-redirect guard
[`ReturnUrlProtector`](#returnurlprotector), which accepts only same-origin relative paths beginning
with a single forward slash and rejects protocol-relative forms, backslashes, control characters and
anything that does not parse as a relative URI, replacing each with a fallback
(`MMCA.Common.UI/Services/Navigation/ReturnUrlProtector.cs:18-60`).

**Authentication, the host-polymorphic token refresh, and the devices page.** Client-side auth is
contracted by [`IAuthUIService`](#iauthuiservice)
(`MMCA.Common.UI/Services/Auth/IAuthUIService.cs:16`), whose members are Result-returning like the
entity services, and implemented by [`AuthUIService`](#authuiservice)
(`MMCA.Common.UI/Services/Auth/AuthUIService.cs:34`), which calls the WebAPI `auth/*` endpoints,
persists tokens through [`ITokenStorageService`](#itokenstorageservice), pushes auth-state changes
through [`JwtAuthenticationStateProvider`](#jwtauthenticationstateprovider) so `AuthorizeView` reacts
immediately, and coordinates push-registration through the device-capability contract
[`IPushRegistrationService`](group-26-device-capability-layer.md#ipushregistrationservice)
(`AuthUIService.cs:34-40`). Two named codes make its local-only failures legible rather than null:
`Auth.TokenStorageUnavailable` when the sign-in succeeded but JS interop could not persist the tokens,
and `Auth.MissingAccessToken` when a 2xx carried no usable token, which means the response shape
drifted (`AuthUIService.cs:46`, `:52`). Alongside login, register, OAuth exchange, logout, refresh and
change-password, it carries the self-service reset pair (`IAuthUIService.cs:55`, `:62`,
[ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html)) and the
multi-device session pair: `GetSessionsAsync` lists the caller's live refresh sessions newest first
and `RevokeSessionAsync` ends one of them (`IAuthUIService.cs:70`, `:79`,
[ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html)). Those two are
rendered by the framework-owned [`Sessions`](#sessions) page
(`MMCA.Common.UI/Pages/Auth/Sessions.razor.cs:26`), reachable at `/profile/sessions`
(`RoutePaths.cs:16`), which deliberately offers **two** revoke paths: a per-row sign-out that ends one
other device's session, and a page-level sign-out-everywhere that also ends the caller's own and is
therefore followed by the local logout and a redirect. The current device's row carries no button at
all, since revoking it from here would leave the app signed in on a dead session until the access
token expired (`Sessions.razor.cs:16-24`, `:33`, `:55`). Each row is labelled from
[`UserAgentSummary`](#useragentsummary) (`MMCA.Common.UI/Services/Auth/UserAgentSummary.cs:18`), which
extracts a browser and a platform from the raw header with the most specific token winning (every
Chromium browser also says "Chrome", and Chrome and Edge both say "Safari",
`UserAgentSummary.cs:20-38`) and returns the two parts **separately**, because composing "Chrome on
Windows" in code would hard-code English word order (`UserAgentSummary.cs:13-16`).

The refresh is the interesting part: one [`ITokenRefresher`](#itokenrefresher) abstraction
(`MMCA.Common.UI/Services/Auth/ITokenRefresher.cs:13`) has two implementations picked per host,
[`SameOriginProxyTokenRefresher`](#sameoriginproxytokenrefresher) for the browser (the refresh token
lives in an HttpOnly cookie and rotation happens server-side behind a same-origin
`/auth/session/token` proxy, so JS never sees it) and
[`DirectApiTokenRefresher`](#directapitokenrefresher) for MAUI (the refresh token sits in OS
SecureStorage and is exchanged directly against `auth/refresh`). Storage is host-polymorphic in the
same way: [`WasmTokenStorageService`](#wasmtokenstorageservice) holds the access token in memory only
and single-flights its re-acquisition behind a lock, since an unguarded `??=` lets two callers each
start a hydrate and the later one overwrite the other's token
(`MMCA.Common.UI/Services/Auth/WasmTokenStorageService.cs:11`, `:22-38`), while
[`ServerTokenStorageService`](#servertokenstorageservice) reads the HttpOnly cookie through
[`CookieTokenReader`](group-08-auth.md#cookietokenreader) whenever a live `HttpContext` exists (SSR
prerender) and switches to the in-memory token on the interactive circuit
(`MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:17`, `:30-43`,
[ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)). A third
contract, [`ISecureTokenStore`](#isecuretokenstore)
(`MMCA.Common.UI/Services/Auth/ISecureTokenStore.cs:16`), is raw persistence with **no** freshness
semantics, and it exists to keep the MAUI graph acyclic: storage depends on the refresher, the
refresher depends on the raw store, and there is no loop (`ISecureTokenStore.cs:5-14`). The
[`ISessionCookieSync`](#isessioncookiesync) / [`JsFetchSessionCookieSync`](#jsfetchsessioncookiesync)
pair mirrors the in-memory access token into the cookie by firing the fetch **from the browser**, so
the `Set-Cookie` lands in the user's own jar under both render modes. All three storage services agree
on one 30-second expiry skew read through [`JwtTokenInfo`](#jwttokeninfo)`.IsFresh`
(`MMCA.Common.UI/Services/Auth/JwtTokenInfo.cs:16-37`, used at `WasmTokenStorageService.cs:15,24` and
`ServerTokenStorageService.cs:23,40`), which parses the token client-side **without validating its
signature**, because the API validates every request. Every outbound call also passes
[`AuthDelegatingHandler`](#authdelegatinghandler), which attaches the stored bearer token to requests
that do not go through `CreateAuthenticatedClientAsync`
(`MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:9`). The lifecycle across render modes is
[ADR-051](https://ivanball.github.io/docs/adr/051-client-auth-token-lifecycle.html); the cross-service
JWKS validation these tokens flow into is
[ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html).

**Front-end security beyond tokens.** `[Rubric §26, Front-End Security]` assesses token handling, XSS
exposure and secret storage, and this group answers it in four places: keeping the refresh token out
of JS-reachable storage (above); [`BlazorCspPolicyProvider`](#blazorcsppolicyprovider), which pins
`connect-src` to `'self'` plus the configured API/Gateway origin and its `wss` form for the SignalR
hub (`MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:24`, `:41-60`) and, when the endpoint
cannot be parsed, **fails closed**: `connect-src` narrows to `'self'` and the policy stays *enforced*,
so a misconfiguration surfaces immediately as blocked calls in the console rather than as a
Report-Only header that protects nothing and nobody notices (`BlazorCspPolicyProvider.cs:16-20`,
`:52-54`), feeding the shared
[`SecurityHeadersMiddleware`](group-16-aspire-orchestration.md#securityheadersmiddleware) through
[`ICspPolicyProvider`](group-16-aspire-orchestration.md#icsppolicyprovider);
[`WebApplicationExtensions`](#webapplicationextensions)`.UseAuthenticatedNoStore`, which emits
`Cache-Control: no-store` on authenticated HTML so a logged-out user pressing Back never sees the
previous user's page out of the bfcache while anonymous pages stay bfcache-eligible
(`MMCA.Common.UI/Extensions/WebApplicationExtensions.cs:24-44`); and the `returnUrl` sanitizer already
covered.

**Forms declare their rules once.** The shared auth forms ([`LoginModel`](#loginmodel),
[`RegisterModel`](#registermodel), [`ForgotPasswordModel`](#forgotpasswordmodel),
[`ResetPasswordModel`](#resetpasswordmodel)) are plain data-annotation `EditForm` models, with
[`PasswordComplexityAttribute`](#passwordcomplexityattribute) mirroring the server's rule (at least 8
characters with upper, lower, digit and a non-alphanumeric character) so the form gives the verdict
the API would, and deferring empty input to `[Required]` so a blank field shows one message rather
than two (`MMCA.Common.UI/Pages/Auth/PasswordComplexityAttribute.cs:12`, `:21-30`).
[`AbsoluteUrlAttribute`](#absoluteurlattribute)
(`MMCA.Common.UI/Validation/AbsoluteUrlAttribute.cs:26`) is the same parity argument with sharper
stakes: it requires an absolute `http`/`https` URL (`:39-52`) because these values are rendered
straight into an image source or a link target, so accepting `javascript:` or `data:` on the client
and rejecting it on the server would leave a round trip as the only thing between a pasted script URL
and the page (`AbsoluteUrlAttribute.cs:5-11`). Beyond the auth pages, MudBlazor fields bind their
`Validation` parameter to a delegate from [`ModelValidation`](#modelvalidation)`.For`
(`MMCA.Common.UI/Validation/ModelValidation.cs:26`, `:43-49`), which hands the model and the member
path MudBlazor supplies to an [`IModelValidator`](#imodelvalidator)
(`MMCA.Common.UI/Validation/IModelValidator.cs:13`). That indirection is the extension point: the
in-box [`DataAnnotationsModelValidator`](#dataannotationsmodelvalidator)
(`MMCA.Common.UI/Validation/DataAnnotationsModelValidator.cs:21`) runs the attributes on the model and
resolves every produced message as a resource key with pass-through, so a model can declare
`ErrorMessage = "Validation.AbsoluteUrl"` and a plain-English message still renders verbatim
(`DataAnnotationsModelValidator.cs:13-19`, `:36-41`); a consumer that keeps its rules in
FluentValidation supplies its own implementation and `MMCA.Common.UI` never references a validation
library. That client-side parity is the point of `[Rubric §24, Forms, Validation & UX Safety]`: the
client predicts, the server decides.

**The component library is behind two facades.** [`IToastService`](#itoastservice)
(`MMCA.Common.UI/Common/Interfaces/IToastService.cs:37`) and
[`IAppDialogService`](#iappdialogservice)
(`MMCA.Common.UI/Common/Interfaces/IAppDialogService.cs:14`) are the only way page code raises a
transient notification or asks a yes/no question. The toast contract carries the four named severities
plus a runtime-severity `Show`, a two-line `ShowPersistent` that stays until dismissed (the
push-notification shape: a message that arrived unprompted must not expire before the user looks at
the screen, `IToastService.cs:64-72`) and a `ShowAction` that renders a button for the undo/view/retry
case, with the explicit warning that the callback runs outside any render callback so a caller whose
work can fail must guard it (`IToastService.cs:74-101`); severity itself is the framework's own
[`ToastSeverity`](#toastseverity) enum (`IToastService.cs:8`).
[`MudToastService`](#mudtoastservice) (`MMCA.Common.UI/Services/MudToastService.cs:12`) and
[`MudAppDialogService`](#mudappdialogservice) (`MMCA.Common.UI/Services/MudAppDialogService.cs:11`)
are the **only two types in the framework that name MudBlazor's `ISnackbar` and `IDialogService`**,
and even the severity projection is written out as a switch rather than cast, because the two enums
agreeing numerically today is not a dependency worth taking silently
(`MudToastService.cs:80-93`). The dialog facade collapses a dismissal (backdrop click, escape) onto
`false`, so a caller only ever branches on `true` (`MudAppDialogService.cs:14-26`). Both are
registered by their own `AddCommonUiFacades()` (`MMCA.Common.UI/DependencyInjection.cs:158-163`),
separate from `AddUIShared` so a bUnit harness can resolve exactly these two without the rest of the
shared-UI surface. `[Rubric §1, SOLID]` (dependency inversion) and `[Rubric §14, Testability]`: a
component test records toasts instead of driving a rendered snackbar host.

**Design system and theming.** Visual consistency is centralized in one static
[`MMCATheme`](#mmcatheme) `MudTheme` instance (`MMCA.Common.UI/Theme/MMCATheme.cs:9`, `:11`) holding a
light palette (`:13-47`), a full dark palette (`:48-84`), an Inter-first typography scale (`:85-163`)
and a 6 px default border radius (`:164-167`). It is applied through the shared `MmcaThemeProviders`
component, which renders the four Mud providers every root layout needs exactly once and takes the
theme as a parameter defaulting to `MMCATheme.Instance`, so an app with its own brand passes a derived
`MudTheme` instead of duplicating the provider block
(`MMCA.Common.UI/Components/MmcaThemeProviders.razor:12-15`, `:23`). The palette itself comes from a
single C# source of truth, [`BrandColors`](#brandcolors) (`MMCA.Common.UI/Theme/BrandColors.cs:10`),
whose doc comment states the duplication contract plainly: the CSS custom properties in
`wwwroot/app.css` must mirror these constants because C# cannot read CSS at build time, and
`BrandColorTokenTests` asserts the two stay in sync (`BrandColors.cs:3-9`). Color choices carry
explicit WCAG reasoning: Secondary is Teal 700 `#00796B` for about 5.3:1 on light surfaces because the
Teal 600 it replaced sat at about 4.0:1, under the AA 4.5:1 floor (`BrandColors.cs:21-26`), and
`WarningContrastText` is overridden to `#212121` because MudBlazor's default white on `#F57F17`
measures about 2.65:1 and failed an axe scan on a "Pending Payment" chip (`MMCATheme.cs:29-33`).
`[Rubric §20, Design System, Theming & Consistency]` is the home category (one token source, dark
mode, consistent typography) and `[Rubric §21, Accessibility]` is woven into the palette itself and
into the chrome, down to the skip-to-content link the shared layout renders first
(`MMCA.Common.UI/Layout/MainLayout.razor:17`).

**Dark mode is a service, not a flag.** [`ThemeService`](#themeservice)
(`MMCA.Common.UI/Services/ThemeService.cs:16`, registered `Scoped` at `DependencyInjection.cs:115`)
owns the preference: `InitializeAsync` reads the stored value through a `theme.js` module and falls
back to the OS `prefers-color-scheme` only when nothing is stored (`ThemeService.cs:18`, `:34`),
`SetDarkModeAsync` persists through the same module and raises `OnChange` (`ThemeService.cs:28`,
`:53`), and the JS module handle is held by [`LazyJsModule`](#lazyjsmodule)
(`MMCA.Common.UI/Services/LazyJsModule.cs:20`), a single-flight importer that caches the in-flight
import under a lock so two concurrent callers cannot leak a second module reference, and that drops a
failed task so an import attempted during prerender does not poison the module for the rest of the
circuit (`LazyJsModule.cs:5-19`, `:22-25`). `MmcaThemeProviders` subscribes to `OnChange` and
re-renders (`MmcaThemeProviders.razor:28`, `:30-41`). **Honest caveat:** unlike locale, the no-flash
SSR bootstrap is not wired for theme. `InitializeAsync` is called from `OnAfterRenderAsync(firstRender)`
because JS interop is unavailable during prerender (`MmcaThemeProviders.razor:30-37`), so the bound
mode is corrected just after hydration and a brief wrong-theme first paint is possible
([ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)).

**Internationalization: one culture decision, carried everywhere.** The framework serves `en-US` and
Spanish (`es`) plus a development-only pseudo locale, and the hard part is not the translations, it is
making one culture decision agree across the `InteractiveAuto` split (SSR prerender, then an
InteractiveServer circuit, then an InteractiveWebAssembly client) *and* across the cross-origin REST
services behind the Gateway, with no language flash and no hydration mismatch
([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html), which supersedes the
single-locale stance of [ADR-011](https://ivanball.github.io/docs/adr/011-single-locale-i18n.html)). A
single non-HttpOnly culture cookie is the source of truth. The WASM client reads it at startup through
[`MmcaCultureBootstrap`](#mmcaculturebootstrap)`.SetBrowserCultureAsync`, which assigns
`CultureInfo.DefaultThreadCurrent[UI]Culture` *before* `RunAsync()` and falls back to
[`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures)`.Default`
(`MMCA.Common.UI/Services/MmcaCultureBootstrap.cs:22-34`). Outbound API calls forward the active
culture as an `Accept-Language` header through
[`CultureDelegatingHandler`](#culturedelegatinghandler)
(`MMCA.Common.UI/Services/CultureDelegatingHandler.cs:13`, `:20-25`), wired into the `"APIClient"`
pipeline at `DependencyInjection.cs:78,102`, because the cross-origin Gateway does not carry the
cookie through to the services and that header is what makes a backend failure come back localized.
View strings are externalized to co-located `.resx` resolved by `IStringLocalizer<T>`
(`AddLocalization()` at `DependencyInjection.cs:60`), anchored by two marker types:
[`SharedResource`](#sharedresource) for cross-cutting chrome
(`MMCA.Common.UI/Resources/SharedResource.cs:9`) and [`MudTranslations`](#mudtranslations) for
MudBlazor's own component text (pager, filter menus, pickers,
`MMCA.Common.UI/Resources/MudTranslations.cs:10`), served through
[`ResxMudLocalizer`](#resxmudlocalizer), which `AddUIShared` `TryAdd`s because `AddMudServices`
registers no `MudLocalizer` of its own (`DependencyInjection.cs:69-73`) and whose values degrade to
MudBlazor's built-in English when a key reports `ResourceNotFound`
(`MMCA.Common.UI/Globalization/ResxMudLocalizer.cs:7-19`). Applying a switch is host-specific and sits
behind [`ICultureApplier`](#icultureapplier): the web default
[`EndpointCultureApplier`](#endpointcultureapplier) force-loads the server `/culture/set` endpoint so
the server re-renders SSR under the new cookie and the WASM runtime re-reads it on startup
(`MMCA.Common.UI/Services/EndpointCultureApplier.cs:18-32`), while a MAUI hybrid head, having no
ASP.NET pipeline, replaces it after `AddUIShared` with an in-process applier
([`MauiCultureApplier`](group-26-device-capability-layer.md#mauicultureapplier), chapter 26). The
development-only pseudo locale is the group's own i18n test harness:
[`PseudoStringLocalizerFactory`](#pseudostringlocalizerfactory) decorates `IStringLocalizerFactory`
unconditionally (`DependencyInjection.cs:67`,
`MMCA.Common.UI/Globalization/PseudoStringLocalizerFactory.cs:11`) so every `IStringLocalizer` in the
host is wrapped in a [`PseudoStringLocalizer`](#pseudostringlocalizer) at once, and
[`PseudoLocalizer`](#pseudolocalizer) accents every letter, pads the text and wraps the result in a
bracket sentinel while leaving `{ }` placeholders verbatim
(`MMCA.Common.UI/Globalization/PseudoLocalizer.cs:20-30`), which makes hard-coded strings,
fixed-width layouts and concatenated fragments all visible in one pass (`PseudoLocalizer.cs:12-19`).
Even the snackbar text is localized: [`ErrorMessages`](#errormessages) keeps its static call sites but
resolves each message from `SharedResource` once the root layout hands it a localizer, falling back to
the English format string until then (`MMCA.Common.UI/Pages/Common/ErrorMessages.cs:24`, `:33`), and
it never renders an exception's own `Message`, because raw exception text is neither localizable nor
safe to surface (`ErrorMessages.cs:14-22`). `[Rubric §27, Internationalization]` is the home category
here, and adding a locale is a `.es.resx` sibling plus one allowlist entry, not new infrastructure.

**Per-user preference persistence.** A signed-in user's culture and theme follow them across devices
via the Identity profile. [`IUserPreferenceWriter`](#iuserpreferencewriter) /
[`ApiUserPreferenceWriter`](#apiuserpreferencewriter) PUT to `auth/preferences` over the shared
`"APIClient"` (`MMCA.Common.UI/Services/ApiUserPreferenceWriter.cs:22`, `:62-66`) using the private
[`UserPreferencesRequest`](#userpreferencesrequest) record (`:29`), and
[`IUserPreferenceReader`](#iuserpreferencereader) /
[`ApiUserPreferenceReader`](#apiuserpreferencereader) GET the same endpoint at login and return the
immutable [`UserPreferences`](#userpreferences) record, whose null fields mean "leave unchanged"
(`MMCA.Common.UI/Services/UserPreferences.cs:9`,
`MMCA.Common.UI/Services/ApiUserPreferenceReader.cs:14`, `:21-31`). The write is strictly
best-effort: the cookie is the device-local runtime channel and a failed persist never breaks the
in-page switch. Best-effort has a cost, though, and both sides guard it, first by refusing to send
when the token is missing, unreadable or within 30 seconds of expiry via `JwtTokenInfo.IsFresh`
(`ApiUserPreferenceWriter.cs:27`, `:47`; `ApiUserPreferenceReader.cs:21`, `:31`), and second by
remembering the exact token the API last answered 401 to, so a revoked session costs one failed
request rather than one per toggle (`ApiUserPreferenceWriter.cs:31-37`, `:55-58`, `:68-71`).
Comparing the token rather than setting a latch is what lets a fresh sign-in resume writing with no
reset step. That is a `[Rubric §13, Observability & Operability]` detail as much as a `[Rubric §19,
State Management]` one: at low traffic, one 401 per theme toggle is enough on its own to trip a
failed-request alert rule.

**Pluggable UI modules.** The module system that organizes the back end
([`IModule`](group-14-module-system-composition.md#imodule), chapter 14) has a front-end counterpart in
[`IUIModule`](#iuimodule) (`MMCA.Common.UI/Common/Interfaces/IUIModule.cs:10`). A module descriptor
exposes its navigation entries as [`NavItem`](#navitem) values, the `Assembly` holding its Razor pages
so the host can add it to `AdditionalAssemblies` for route discovery, and two defaulted collections of
component types to render in the app bar and at the root layout (`IUIModule.cs:12-22`). The
registration prologue is shared too: `AddUIModule<TModule>()` runs one Scrutor scan that picks up
every `IEntityService<,>` implementation in the module's assembly as scoped, then registers the
descriptor as a singleton (`MMCA.Common.UI/DependencyInjection.cs:203-213`), so a module's own
`Add{Module}UI()` no longer carries its own copy of that scan and can still register services that
must win afterwards. [`UIModuleConfiguration`](#uimoduleconfiguration) lets a host switch a module off
through `Modules:{name}:Enabled`, defaulting to enabled when the section is absent
(`MMCA.Common.UI/Common/Settings/UIModuleConfiguration.cs:18-22`), and
[`IHomePageContent`](#ihomepagecontent) is the per-app landing-page hook behind the shared `/` route,
naming the component type and the page title
(`MMCA.Common.UI/Common/Interfaces/IHomePageContent.cs:8-15`). Adding a feature module therefore wires
its pages, its services and its menu entries into the shell with no edit to the shell.
`[Rubric §18, UI Architecture]` and `[Rubric §1, SOLID]` (open/closed).

**A complete vertical slice shipped inside the framework: notifications.** Unlike the rest of the
package, which is base classes consumers extend, the `Notifications` area is a finished feature an app
switches on with one call. [`NotificationUIModule`](#notificationuimodule)
(`MMCA.Common.UI/Notifications/NotificationUIModule.cs:15`) contributes a user-facing inbox nav entry
plus an Organizer-gated push-notification entry (`:17-21`), the app-bar
[`NotificationBell`](#notificationbell) (`:23`) and a root-layout listener component (`:25`);
[`NotificationInbox`](#notificationinbox), [`NotificationList`](#notificationlist) and
[`NotificationSend`](#notificationsend) (with its [`NotificationSendModel`](#notificationsendmodel)
form model) render it; [`NotificationInboxService`](#notificationinboxservice) and
[`PushNotificationService`](#pushnotificationservice) (behind
[`INotificationInboxUIService`](#inotificationinboxuiservice) and
[`IPushNotificationUIService`](#ipushnotificationuiservice)) call the API; and
[`NotificationHubService`](#notificationhubservice)
(`MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:26`) holds the **SignalR**
connection to the API's [`NotificationHub`](group-10-notifications.md#notificationhub), retrying an
initial connect up to 3 times with doubling backoff and discarding a connection that never started so
a later join is not blocked forever (`NotificationHubService.cs:28`, `:146-176`). The same connection
carries ephemeral **live channel** events
([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)): components join through
`JoinChannelAsync` (`NotificationHubService.cs:192`), membership is reference-counted per key by
[`ChannelReferenceCounter`](#channelreferencecounter)
(`MMCA.Common.UI/Services/Notifications/ChannelReferenceCounter.cs:16`) so one subscriber leaving does
not cut the channel off for the others, handlers are multicast through disposable
[`ChannelSubscription`](#channelsubscription) handles (`NotificationHubService.cs:412`), and every held
channel is re-joined on `Reconnected` because SignalR group membership does not survive a new
connection (`NotificationHubService.cs:143`). Which notifications a user sees can be narrowed by
[`INotificationScopeProvider`](#inotificationscopeprovider), an app-supplied scope key such as
`"event:2"` that both HTTP services consume so a send and the reads that follow agree, defaulting to
the unscoped [`NullNotificationScopeProvider`](#nullnotificationscopeprovider) and contractually
forbidden from throwing, with the further instruction to fail *closed* (return the last known key)
rather than degrade to null, since a null silently widens the view to every notification
(`MMCA.Common.UI/Services/Notifications/INotificationScopeProvider.cs:9-22`). Shared unread state
lives in [`NotificationState`](#notificationstate)
(`MMCA.Common.UI/Services/Notifications/NotificationState.cs:18`), which stamps when the count was
last established so a subscriber can ask `IsStale` instead of re-fetching on every trigger (`:7-12`)
and arbitrates a single active-poller slot by **owner reference** rather than a counter, so a teardown
that never unregisters cannot strand the slot for the life of the circuit (`:23-29`). Both of the
badge's timings are configuration rather than compiled-in constants:
[`NotificationBellOptions`](#notificationbelloptions)
(`MMCA.Common.UI/Common/Settings/NotificationBellOptions.cs:12`) binds a 30-second default
`PollInterval` and a 30-second `NavigationRefreshMaxAge`, so a deployment paying per API call widens
the poll and a page change within the window keeps the count it has (`:22`, `:29`), read by the bell
through `IOptions` and a `TimeProvider`
(`MMCA.Common.UI/Components/Notifications/NotificationBell.razor.cs:30`, `:36-37`). The bell also
registers strictly symmetrically, because hosts render it twice inside `<AuthorizeView>` and a routine
token refresh tears both instances down and rebuilds them (`NotificationBell.razor.cs:22-29`). The
whole feature is wired by its own `AddNotificationUI()`
(`MMCA.Common.UI/Notifications/DependencyInjection.cs:12`, `:20-42`), kept separate so an app that does
not want real-time notifications never pays for the SignalR plumbing.

**How it wires up at startup.** A host's `Program.cs` calls `AddUIShared(configuration)` once, a C#
`extension(IServiceCollection)` member (see
[primer §4](00-primer.md#4-c-build-and-code-style-conventions)) on
[`DependencyInjection`](#dependencyinjection) (`MMCA.Common.UI/DependencyInjection.cs:22`, `:30-142`).
In order it binds and **validates on start** [`ApiSettings`](#apisettings), so a missing endpoint
fails the host rather than the first request (`:33-36`; the read-only face of those options is
[`IApiSettings`](#iapisettings), whose `WasmApiEndpoint` lets the server call an internal URL while
the browser is handed an external one, `MMCA.Common.UI/Common/Settings/IApiSettings.cs:11-17`); binds
[`LayoutSettings`](#layoutsettings), `UiReadCacheOptions` and `NotificationBellOptions` *without*
validation, deliberately optional so a host that configures none of them keeps the compiled-in
defaults (`:38-48`); `TryAdd`s `TimeProvider.System` as the clock those staleness policies are
measured against and the read cache itself (`:52`, `:57`); sets up localization and the pseudo/Mud
localizer decorators (`:60-73`); registers the auth and culture delegating handlers and the named
`"APIClient"` whose base address comes from `ApiSettings` and whose timeout is pinned to
[`HttpResilienceDefaults`](group-16-aspire-orchestration.md#httpresiliencedefaults)`.TotalRequestTimeout`
rather than the BCL's arbitrary 100s, so the transport never pre-empts the resilience budget
(`:77-102`); calls `AddCommonUiFacades()` for the toast and dialog pair (`:106`); then `TryAdd`s
[`AuthUIService`](#authuiservice), the two list-page state services,
[`NavigationHistoryService`](#navigationhistoryservice), [`ThemeService`](#themeservice),
[`EndpointCultureApplier`](#endpointcultureapplier),
[`NavigationPublicLinkBuilder`](#navigationpubliclinkbuilder) behind
[`IPublicLinkBuilder`](#ipubliclinkbuilder) (share-sheet and QR links resolved against the browser
origin, which a MAUI head replaces because its WebView origin is a virtual host nobody else can open,
`MMCA.Common.UI/Services/IPublicLinkBuilder.cs:9`,
`MMCA.Common.UI/Services/NavigationPublicLinkBuilder.cs:11`), the preference reader and writer, and a
default [`IOAuthUISettings`](#ioauthuisettings) ([`DefaultOAuthUISettings`](#defaultoauthuisettings))
that downstream apps override with
[`ConfigurationOAuthUISettings`](#configurationoauthuisettings), which reads provider availability
from the `OAuth` section for a server host and from pre-computed `Enabled` flags for a WASM client
(`:109-135`, `MMCA.Common.UI/Services/Auth/ConfigurationOAuthUISettings.cs:13`, `:24-30`); and finally
calls `AddDeviceCapabilityDefaults()` so every capability contract resolves on every head (`:139`,
[ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html), chapter 26).
The `TryAdd*` discipline is what lets a consumer pre-register its own implementation and win. Browser
hosts add `AddClientAuthSessionCookieSync()` (`:170-174`) and `AddWasmFormFactor()` (`:182-183`); a
Blazor Server head adds `AddCommonServerTokenStorage()`, `AddCommonBlazorCsp()` (before
`AddCommonSecurityHeaders`, so it beats the `TryAdd`ed static provider) and
`AddCommonWebFormFactor()` from `MMCA.Common.UI.Web`
(`MMCA.Common.UI.Web/DependencyInjection.cs:14`, `:26-48`) plus the `UseAuthenticatedNoStore()`
middleware. [`UISharedAssemblyReference`](#uisharedassemblyreference)
(`MMCA.Common.UI/DependencyInjection.cs:218`) is the marker other assemblies scan against.

The small Level-0 supporting cast fills in the rest: [`NotificationRoutePaths`](#notificationroutepaths)
(`MMCA.Common.UI/Common/NotificationRoutePaths.cs:8`), whose deep-link builder formats invariantly
because the route's `:int` constraint is the validation boundary (`:14-20`);
[`QrErrorCorrectionLevel`](#qrerrorcorrectionlevel), the framework's own enum for `QrCodeImage` so the
component's public API does not pin consumers to QRCoder's `ECCLevel`
(`MMCA.Common.UI/Components/QrErrorCorrectionLevel.cs:9`);
[`ApiFileDownloadButton`](#apifiledownloadbutton)
(`MMCA.Common.UI/Components/ApiFileDownloadButton.razor.cs:14`), which gives browsers a plain download
link and native heads a fetch-stage-share flow, stripping directory segments from the supplied file
name so a value built from entity data cannot steer the write out of the temp directory (`:21-30`);
and [`MauiBackNavigationBridge`](#mauibacknavigationbridge) with its
[`BackNavigationResult`](#backnavigationresult) for MAUI hardware-back handling, which reports both
whether `history.back()` fired and whether the WebView is at the root of its stack so a host can decide
to exit (`MMCA.Common.UI/Services/Navigation/MauiBackNavigationBridge.cs:19`, `:28`). Form-factor
detection has graduated into its own device-capability layer
([`IFormFactor`](group-26-device-capability-layer.md#iformfactor) and friends, chapter 26). The
presentational helper [`MoneyExtensions`](#moneyextensions) formats
[`Money`](group-02-domain-building-blocks.md#money) for display, grouping a mixed collection by
currency so unrelated amounts never collapse under whichever symbol came first
(`MMCA.Common.UI/Extensions/MoneyExtensions.cs:14`, `:23-32`), keeping a display concern out of the
domain value object, exactly where Clean Architecture wants it.

Read the per-type sections that follow for the mechanics. The consumer-side module UIs live in the ADC
module-UI chapter ([chapter 21](group-21-conference-ui.md)), and the bUnit component tests plus the
Playwright/axe-core E2E suite that exercise this package are covered in the testing chapter
([chapter 27](group-27-testing-infrastructure.md)), which is where `[Rubric §28, Front-End Testing]`
lives.

### BreakpointConstants

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/BreakpointConstants.cs:9` · Level 0 · class (static)

- **What it is**: a one-method static helper that answers "is this viewport a mobile viewport?", so C# viewport detection and the CSS media-query boundary agree on one number.
- **Depends on**: `MudBlazor.Breakpoint` (NuGet, imported at `BreakpointConstants.cs:1`). Nothing first-party.
- **Concept introduced, the single authoritative breakpoint.** `[Rubric §22, Responsive & Cross-Browser]` assesses whether a codebase has one definition of "small screen" rather than a magic number re-chosen per component; this class embodies it by making the mobile/desktop split a named predicate. The doc comment (`BreakpointConstants.cs:11-15`) pins the threshold as "below the sidebar-collapse threshold (MudBlazor Xs or Sm, i.e. < 960 px)", which is the same boundary the shared stylesheet collapses the sidebar at. `[Rubric §20, Design System & Theming]` applies for the same reason: one threshold keeps the layout, the nav drawer and the list pages switching modes together instead of at three slightly different widths.
- **Walkthrough**: the type has exactly one member. `IsMobileBreakpoint(Breakpoint breakpoint)` (`BreakpointConstants.cs:16-17`) is expression-bodied and returns `breakpoint is Breakpoint.Xs or Breakpoint.Sm`. That pattern is the whole rule: `Md` and wider is desktop, and there is no third state.
- **Why it's built this way**: static and dependency-free, so a component can call it without injecting anything, and moving the mobile threshold is a one-line edit paired with one CSS rule rather than a hunt through component code.
- **Where it's used**: exactly one production call site, [DataGridListPageBase<TDto>](#datagridlistpagebasetdto)'s viewport-change handler `NotifyBrowserViewportChangeAsync` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:303`), which sets `IsMobile` from it at line 308 and, on a desktop-to-mobile transition, resets `MobileCurrentPage` to 1 and re-requests the mobile data (`DataGridListPageBase.cs:310-314`). That single assignment is what swaps a desktop `MudDataGrid` for the [MobileInfiniteScrollList<TItem>](#mobileinfinitescrolllisttitem) card layout on every list page in both consumer apps.

---

### IAppDialogService

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IAppDialogService.cs:14` · Level 0 · interface

- **What it is**: the framework's modal-confirmation contract, one method that asks a yes/no question and resolves once the user answers. It exists so page code never names the component library that draws the dialog.
- **Depends on**: nothing first-party (the file carries no `using` directives at all). Implemented by [MudAppDialogService](#mudappdialogservice) over MudBlazor's `IDialogService`.
- **Concept introduced, the vendor-neutral UI facade.** `[Rubric §32, Dependency & Supply-Chain]` assesses whether a third-party dependency is contained behind your own contract or spread across call sites; `[Rubric §14, Testability]` assesses whether a unit of behavior can be exercised without its infrastructure; `[Rubric §1, SOLID]` covers the dependency-inversion half of the same idea. The framework applies all three the same way twice: this interface and its sibling [IToastService](#itoastservice) are the only shapes pages depend on, and their two implementations are the only types in the framework that name MudBlazor's `IDialogService` / `ISnackbar` ([MudAppDialogService](#mudappdialogservice) at `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/MudAppDialogService.cs:11`, doc comment at `:6-10`). The payoff is concrete: a bUnit test answers a confirmation prompt with a stub instead of rendering, driving and dismissing a real dialog. The doc comment (`IAppDialogService.cs:3-13`) also states the deliberate scope limit: only the yes/no shape is abstracted, and richer entity-specific dialogs (`DeleteConfirmation`) stay component-side rather than growing this contract.
- **Walkthrough**: one member. `ConfirmAsync(string title, string message, string confirmText, string cancelText)` returns `Task<bool>` (`IAppDialogService.cs:26`). Two contract details are stated in the XML doc and honored by the implementation. First, every string parameter is documented as "already-localized" (`:21-24`): the facade never touches `IStringLocalizer`, the caller resolves its own copy, which is what keeps the resource key next to the page that owns it ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). Second, dismissing the dialog without choosing counts as declining (`:17-19`), so a caller only ever has to branch on `true`. [MudAppDialogService](#mudappdialogservice) implements exactly that by collapsing MudBlazor's tri-state answer with `return confirmed is true;` (`MudAppDialogService.cs:25`), because `ShowMessageBoxAsync` answers `null` for a backdrop click or an escape key press (`MudAppDialogService.cs:16-18`).
- **Why it's built this way**: a four-string method with a `bool` answer is the smallest contract that covers every destructive-action prompt in the framework, and keeping it that small is what makes the vendor genuinely swappable: the whole surface an alternative renderer must satisfy is one method. It is registered by `AddCommonUiFacades()` alongside the toast facade ([DependencyInjection](#dependencyinjection), `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:161`), scoped to match the MudBlazor services it wraps. See [ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html), whose 2026-08-29 revision records the vendor choice and these two facades, and whose 2026-08-31 revision records their move into their own registration call.
- **Where it's used**: injected by the shared framework surfaces that ask before doing something lossy: [DataGridListPageBase<TDto>](#datagridlistpagebasetdto), the notification list, send and inbox pages, `ListPageActions`, the signed-in-devices page (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Sessions.razor.cs`), and the `UnsavedChangesGuard` component. Registered for component tests by the shipped bUnit base's `Services.AddCommonUiFacades()` call (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:53`), which uses `TryAdd` semantics so a test that wants a recording double registers one afterwards (`BunitComponentTestBase.cs:50-52`).

---

### IHomePageContent

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IHomePageContent.cs:8` · Level 0 · interface

- **What it is**: the hook that lets each consuming application supply its own landing page at the `/` route without forking the shared routing or layout.
- **Depends on**: `System.Type` (BCL) and, at the consuming end, `Microsoft.AspNetCore.Components.DynamicComponent`, which the doc comment names as the rendering mechanism (`IHomePageContent.cs:3-7`).
- **Concept introduced, late-bound content injection into a packaged shell.** `[Rubric §18, UI Architecture & Component Design]` assesses whether shared UI infrastructure adapts to per-app content without duplication. The shared package owns the route: `Home.razor` declares `@page "/"` once (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Home.razor:1`), injects `IEnumerable<IHomePageContent>` (`Home.razor:3`), and renders `<DynamicComponent Type="_contentType" />` when a provider resolved (`Home.razor:8-11`). Because the component arrives as a runtime `Type` rather than a compile-time reference, the framework package renders an app's landing page without referencing the app. When no implementation is registered the page falls back to a localized welcome panel (`Home.razor:12-21`), so a brand-new host still renders something coherent.
- **Walkthrough**: two read-only members. `ComponentType` (`IHomePageContent.cs:11`) is the `System.Type` of the Razor component to render as the home-page body. `PageTitle` (`IHomePageContent.cs:14`) is the browser-tab title, bound by `Home.razor:6`.
- **Why it's built this way**: an inverted dependency (the app registers into the framework, never the reverse) is what lets the whole shell ship as a NuGet package. Compare the sibling mechanism in [IUIModule](#iuimodule): both hand the framework a `Type` or an `Assembly` and let reflection do the binding, and both exist for the same reason ([ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html)).
- **Where it's used**: implemented once per app and registered once per head. ADC registers `ADCHomePageContent` as a singleton in all three heads (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:60`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:49`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:122`), with two separate implementations, one for the web heads (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:11`) and one for MAUI (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/Pages/ADCHomePageContent.cs:8`). Store does the same with `StoreHomePageContent` (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:101`, `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:41`, `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:76`).
- **Caveats / not-in-source**: the injection point is `IEnumerable<IHomePageContent>`, so several registrations do not fail; which one wins is decided by `Home.razor`'s selection code (`Home.razor:23` onward), not by this interface. Every current host registers exactly one.

---

### LatestLoadGuard

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/LatestLoadGuard.cs:38` · Level 0 · class (sealed, `IDisposable`)

- **What it is**: a small per-page helper that keeps a routed component showing the load it asked for **last**, by giving every load a generation number and a cancellation token and cancelling the previous one as the next begins.
- **Depends on**: `System.Threading.CancellationTokenSource` and `ObjectDisposedException.ThrowIf` (BCL). Nothing first-party.
- **Concept introduced, generation-guarded supersession.** `[Rubric §19, State Management & Data Flow]` assesses the correctness of in-flight asynchronous state, and this is the canonical bug it looks for. The doc comment states it precisely (`LatestLoadGuard.cs:5-10`): Blazor **reuses a routed component instance** across route-parameter changes, so a page that opens entity 100 (slow response) and then navigates to entity 101 (fast response) receives 100's late answer after 101 has already rendered. Assigning it unconditionally leaves the URL on 101 while the page holds 100, and any action bound to the loaded entity then fires against the wrong record. Cancellation alone does not fix this, because a fetch that ignores its token still completes; the integer generation is the authoritative check. The same pattern appears at component scope inside [MobileInfiniteScrollList<TItem>](#mobileinfinitescrolllisttitem), which snapshots a generation before awaiting and drops the result if the world moved; `LatestLoadGuard` is that idea extracted into a reusable object so a detail page gets it in three lines. `[Rubric §16, Maintainability]` applies: the alternative is every page hand-rolling a token source, a counter and a dispose path.
- **Walkthrough**: three private fields (`LatestLoadGuard.cs:40-42`): the current `CancellationTokenSource?`, the `int _generation`, and a `_disposed` flag.
  - `Begin()` (`:50-59`) is the entry point. It throws if the guard is disposed (`:52`), cancels and disposes the previous load through the private `CancelAndDisposeCurrent()` (`:54`), publishes a fresh token source (`:55`), increments the generation (`:56`), and returns the pair `(CancellationToken Token, int Generation)` (`:58`). Returning a tuple rather than exposing two properties is what makes the generation a **snapshot**: the caller holds the value it started with, so a later `Begin()` cannot retroactively change what it compares against.
  - `IsCurrent(int generation)` (`:67`) is the check after the await: `!_disposed && generation == _generation`. Disposal counts as not-current, so a component torn down mid-fetch also drops its answer instead of assigning into a dead render tree.
  - `Dispose()` (`:70-79`) is idempotent via the `_disposed` early return (`:72-75`) and cancels the in-flight load on the way out.
  - `CancelAndDisposeCurrent()` (`:81-91`) null-guards, then cancels, disposes and nulls the source, so the guard never double-disposes a token source and never leaks one.
  - The usage shape is spelled out as a `<code>` block in the doc comment (`:15-31`): a `private readonly LatestLoadGuard _load = new();` field, `var (token, generation) = _load.Begin();` at the top of `OnParametersSetAsync`, an `if (!_load.IsCurrent(generation)) { return; }` immediately after the await, and `public void Dispose() => _load.Dispose();`.
- **Why it's built this way**: deliberately **not thread-safe**, and the doc comment says so in bold (`:32-36`). It is built for the renderer's synchronization context, where component lifecycle methods and event callbacks are already serialized, so the fields need no interlocking and the type stays allocation-cheap. That is a contract, not an oversight: sharing one instance across threads is documented as unsupported.
- **Where it's used**: no production call site yet. The type is public and exercised by [LatestLoadGuardTests](group-27-testing-infrastructure.md#latestloadguardtests) (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Common/LatestLoadGuardTests.cs:11`, six test methods covering `Begin` cancelling the prior token, generation advance, `IsCurrent` after supersession, and behavior after disposal) `[Rubric §28, Front-End Testing]`, and it is still listed in `PublicAPI.Unshipped.txt`, meaning it has been added to the public surface but not yet baselined into a shipped release.
- **Caveats / not-in-source**: the doc comment presents the guard as the answer for detail pages, but as of this source no page in the framework or in either consumer app calls `Begin()` / `IsCurrent()` (the only references are the type's own file and its test class). Treat it as shipped-and-tested infrastructure awaiting adoption, not as the pattern currently in force on the detail pages.

---

### NavSection

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NavSection.cs:7` · Level 0 · enum

- **What it is**: classifies a sidebar entry into one of three audience groups: everyone, signed-in users, or administrators.
- **Depends on**: nothing. Consumed by [NavItem](#navitem) and by the shared nav menu.
- **Concept introduced, audience as a first-class navigation axis.** `[Rubric §25, Navigation & Information Architecture]` assesses whether the menu structure is declarative and audience-aware rather than a hand-maintained pile of conditionals. `[Rubric §11, Security]` touches it too, but with an important distinction worth internalizing early: the section is a **grouping hint, not an authorization check**. What actually hides a link is `RequiredRole` / `RequiredClaim` on [NavItem](#navitem), evaluated by the menu (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/NavMenu.razor:198-199`), and what actually protects the destination is page-level and API-level authorization.
- **Walkthrough**: three values in declaration order, and the order is itself a contract because the doc comment states sections render in enum declaration order (`NavSection.cs:5`). `General` (`:10`) is for items visible to everyone, anonymous and authenticated alike. `User` (`:13`) is for signed-in non-admin items. `Admin` (`:16`) is for administrator and organizer items.
- **Why it's built this way**: an enum rather than a string gives the renderer exhaustive, typo-proof matching, which is exactly what `NavMenu.razor` relies on when it partitions the flattened item list into three collections with `i.Section is NavSection.General` / `User` / `Admin` (`NavMenu.razor:202-204`). It is a plain C# enum rather than a smart enumeration because no member needs to carry data or behavior, which is the default this codebase commits to ([ADR-104](https://ivanball.github.io/docs/adr/104-smart-enums-as-opt-in-capability.html)).
- **Where it's used**: the `Section` parameter of [NavItem](#navitem) (`NavItem.cs:16`, defaulting to `General`), and the three-way partition at `NavMenu.razor:202-204`. [NotificationUIModule](#notificationuimodule) shows both non-default values in one file: its inbox item is `Section: NavSection.User` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs:19`) and its push-management item is `Section: NavSection.Admin` (`:20`).

---

### RoutePaths

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/RoutePaths.cs:7` · Level 0 · class (static)

- **What it is**: the route-path constants owned by the shared UI package itself. Module-specific routes live in their own `*RoutePaths` classes.
- **Depends on**: nothing.
- **Concept introduced, one source of truth for route strings.** `[Rubric §25, Navigation & Information Architecture]` also covers URL hygiene: a literal `"/profile/sessions"` typed into four components is four places to get a rename wrong. The class comment (`RoutePaths.cs:3-6`) states both halves of the convention: centralized paths shared across all UI modules and hosts live here, and module-specific paths live in their own class. That convention is followed consistently across the workspace, by [NotificationRoutePaths](#notificationroutepaths) in this package and by `ConferenceRoutePaths`, `EngagementRoutePaths` and `IdentityRoutePaths` in the consumer modules.
- **Walkthrough**: two `public static readonly string` members.
  - `Home = "/"` (`RoutePaths.cs:9`).
  - `Sessions = "/profile/sessions"` (`:16`), the signed-in-devices page. Its doc comment (`:11-15`) records why it belongs to the framework rather than to an app: the page is framework-owned (`MMCA.Common.UI.Pages.Auth.Sessions`), lists the user's live refresh sessions with per-device and account-wide sign-out, and is reachable from the shared nav menu's authenticated section, so a consuming app gets it without doing any routing work.
- **Why it's built this way**: `static readonly` rather than `const` is sufficient because these strings are consumed in navigation and `Href` expressions, not in attribute arguments. That has one consequence worth knowing: a `@page` directive still needs its own literal, so `Home.razor:1` writes `@page "/"` directly and this constant covers only the linking and navigating side. `Sessions` shows the cost of the convention: the route literal appears in the page's own `@page` directive and again here, and only the tests hold the two together.
- **Where it's used**: `RoutePaths.Home` backs the navbar brand link (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/NavMenu.razor:18`), the Home nav link (`NavMenu.razor:58`), and the first breadcrumb of the sessions page (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Sessions.razor.cs:65`). `RoutePaths.Sessions` backs the authenticated-section nav link (`NavMenu.razor:142`) and is asserted by name in both repos' component tests: `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Layout/NavMenuTests.cs:70` pins that the link renders inside `.nav-auth-section`, `:75` pins its position, `:88` pins that it is absent for an anonymous user, and `MMCA.Store/Tests/Modules/Identity/MMCA.Store.Identity.UI.Tests/Pages/Profile/ProfileTests.cs:67` pins that the profile page links to it.
- **Caveats / not-in-source**: `Sessions` is still listed in `PublicAPI.Unshipped.txt` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/PublicAPI.Unshipped.txt:339`) while `Home` is baselined in `PublicAPI.Shipped.txt:916`, so the two members sit at different points in the public-API baseline cycle.

---

### ToastSeverity

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IToastService.cs:8` · Level 0 · enum

- **What it is**: the framework's own five-level scale for how prominent a toast is, and therefore which color and icon the host renders it with.
- **Depends on**: nothing. Declared above [IToastService](#itoastservice) in the same file.
- **Concept reinforced, keeping the vendor enum out of call sites.** The facade idea is taught at [IAppDialogService](#iappdialogservice); this enum is the part of it that is easy to skip. A contract that abstracts the snackbar but takes `MudBlazor.Severity` as a parameter has not abstracted anything, because every caller still references the vendor assembly. The doc comment says exactly that (`IToastService.cs:3-7`): the five levels mirror what every component library exposes, so a host maps them one-to-one without losing anything, and "naming them here is what keeps the vendor's own severity enum out of page code". `[Rubric §32, Dependency & Supply-Chain]` and `[Rubric §9, API & Contract Design]` both apply: the mapping to `MudBlazor.Severity` lives in one private method inside [MudToastService](#mudtoastservice), so swapping renderers is a change to one `switch`.
- **Walkthrough**: five explicitly numbered members, each documented by what it means for the user rather than by color. `Normal = 0` (`IToastService.cs:11`), neutral with no color emphasis. `Info = 1` (`:14`), something happened that the user did not ask for. `Success = 2` (`:17`), the action the user asked for completed. `Warning = 3` (`:20`), completed partially or with something worth knowing. `Error = 4` (`:23`), the action failed. The explicit values keep the enum stable if members are ever reordered.
- **Why it's built this way**: five levels rather than four, because `Normal` (an uncolored toast) is a distinct affordance from `Info`, and not more, because there is no shape beyond these that the framework raises. `Info` is the default parameter value on both `ShowPersistent` and `ShowAction` (`:72`, `:100`), which is the neutral choice for an unprompted message.
- **Where it's used**: the `severity` parameter of `IToastService.Show`, `ShowPersistent` and `ShowAction`; the `severity` parameter of [ResultUiExtensions](#resultuiextensions)`.NotifyOnFailure`, where it defaults to `ToastSeverity.Error` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:269`); and [MudToastService](#mudtoastservice), the one type that maps it to `MudBlazor.Severity` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/MudToastService.cs:27`).

---

### UISharedAssemblyReference

> MMCA.Common.UI · `MMCA.Common.UI` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:218` · Level 0 · class

- **What it is**: an empty marker class whose only job is to give code a compile-checked `typeof(...).Assembly` handle on the shared UI assembly.
- **Depends on**: nothing.
- **Concept introduced, the assembly-marker type.** Reflection over an assembly needs an `Assembly` instance, and there are two ways to get one: a string (`Assembly.Load("MMCA.Common.UI")`, which fails at run time when someone renames the project) or a type reference (`typeof(UISharedAssemblyReference).Assembly`, which fails at compile time and is carried along by a rename refactoring). Every layer of the framework ships an equivalent marker; this is the UI layer's. `[Rubric §15, Best Practices & Code Quality]` assesses exactly this kind of refactor-safety over stringly-typed lookups.
- **Walkthrough**: a single declaration using the semicolon type body, `public class UISharedAssemblyReference;` (`DependencyInjection.cs:218`), with its doc comment on line 217. It shares a file with [DependencyInjection](#dependencyinjection) but is declared at namespace scope **beneath** it, outside that static class, because a type nested inside a static class could not serve as a public marker the same way. It carries no members, so nothing can accidentally depend on state it does not have.
- **Why it's built this way**: type-only, public and empty is the whole point. It is the assembly's identity expressed as a symbol the compiler tracks.
- **Where it's used**: the architecture fitness suite is the real consumer. `CommonArchitectureMap` registers the assembly as the framework's UI layer with `Framework(Layer.Ui, typeof(Common.UI.UISharedAssemblyReference).Assembly)` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/CommonArchitectureMap.cs:27`), which is what lets the shared layer-dependency rules know which assembly *is* the UI layer; `AnonymousEndpointTests` includes it in the assemblies it scans (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/AnonymousEndpointTests.cs:19`); and `NavigationContractTests` enumerates its types with `typeof(UI.UISharedAssemblyReference).Assembly.GetTypes()` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/NavigationContractTests.cs:105`). `[Rubric §34, Architecture Governance & Documentation]` applies: this one-line type is what makes a layer boundary machine-checkable.
- **Caveats / not-in-source**: the doc comment (`DependencyInjection.cs:217`) offers "e.g., for Scrutor scanning" as the motivating case, but no Scrutor registration in this repo takes its scan root from this marker. `AddUIModule<TModule>()` scans `FromAssemblyOf<TModule>()` (`DependencyInjection.cs:207`), taking the root from the module descriptor's own assembly instead. Trust the call sites: the current consumers are the architecture tests.

---

### IToastService

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IToastService.cs:37` · Level 1 · interface

- **What it is**: the framework's contract for transient user notifications ("toasts"), covering four named severities, a runtime-chosen severity, a persistent two-line notification, and a toast that carries a clickable action.
- **Depends on**: [ToastSeverity](#toastseverity) (same file). Implemented by [MudToastService](#mudtoastservice) over MudBlazor's `ISnackbar`.
- **Concept introduced, fire-and-forget by design.** The facade rationale is taught at [IAppDialogService](#iappdialogservice); what is specific here is that every method returns `void`. The doc comment explains why (`IToastService.cs:31-35`): during server-side prerender there is no toast host at all, so the call is a silent no-op, and a contract that reported whether the message rendered would force every call site to handle a condition it can do nothing about. `[Rubric §24, Forms, Validation & UX Safety]` assesses whether outcomes surface to the user in a recoverable way; `[Rubric §27, Internationalization]` applies because every parameter is documented as **already localized**, which pushes resource resolution out to the page that owns the key. That last rule is enforced, not merely documented: an architecture fitness regex fails the build on a literal first argument to any toast method (`Toast\.(?:Success|Info|Warning|Error|Show|ShowPersistent|ShowAction)\(\s*\$?"`, at `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.LocalizedText.cs:14`, with the comment at `:12-13` recording that it is the same guard that previously watched direct `ISnackbar` use at `:9`).
- **Walkthrough**: seven members, in three tiers.
  - **The four named severities**, `Success` (`IToastService.cs:41`), `Info` (`:45`), `Warning` (`:49`) and `Error` (`:53`), each taking one already-localized message. [MudToastService](#mudtoastservice) implements each as a one-line `snackbar.Add(message, Severity.X)` (`MudToastService.cs:15-24`).
  - **`Show(string message, ToastSeverity severity)`** (`:62`) is the same thing with the level as a parameter, and the doc comment names its motivating caller: [ResultUiExtensions](#resultuiextensions)`.NotifyOnFailure`, which carries the severity through as an argument rather than picking one of the four (`:55-58`).
  - **`ShowPersistent(string title, string body, ToastSeverity severity = ToastSeverity.Info)`** (`:72`) is the push-notification shape: an emphasized title above a body, staying on screen until dismissed. The reasoning (`:64-67`) is that a message arriving unprompted must not expire before the user has looked at the screen. [MudToastService](#mudtoastservice) builds it as a render fragment, a `<strong>` title, a `<br>`, then the body (`MudToastService.cs:30-40`).
  - **`ShowAction(string message, string actionText, Func<Task> onAction, ToastSeverity severity = ToastSeverity.Info, bool requireInteraction = false)`** (`:96-101`) is the undo / view-it / retry shape a bare message cannot express. Two contract details are documented rather than enforced. First, the callback runs outside any render callback, so nothing catches what it throws: a caller whose work can fail must guard it and raise its own failure toast (`:78-81`, restated at `:86-88`). Second, `requireInteraction: true` pins the toast open until the user dismisses it or takes the action, and the MudBlazor implementation additionally renders it filled, following the same emphasis convention `ShowPersistent` uses, "because a toast that waits for the user has to look like it is waiting" (`:90-95`).
- **Why it's built this way**: a small, `void`-returning, already-localized contract is what allows the vendor to appear in exactly one class. It is registered scoped by `AddCommonUiFacades()` ([DependencyInjection](#dependencyinjection), `DependencyInjection.cs:160`) to match the lifetime of the MudBlazor `ISnackbar` it wraps. See [ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html).
- **Where it's used**: essentially everywhere a page reports an outcome. Inside the framework package: [DataGridListPageBase<TDto>](#datagridlistpagebasetdto), [MobileInfiniteScrollList<TItem>](#mobileinfinitescrolllisttitem), `ListPageActions`, the three notification pages, the sessions page, and the `UnsavedChangesGuard`, `SharePageButton`, `ApiFileDownloadButton` and `NotificationListener` components. Outside it, every consumer page reaches it indirectly through [ResultUiExtensions](#resultuiextensions)`.NotifyOnFailure`. Component tests resolve it from the shipped bUnit base (`BunitComponentTestBase.cs:53`, whose comment at `:50-51` records that without it a consumer's component test fails to resolve `IToastService` and each repo ends up re-registering the same pair).

---

### NavItem

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NavItem.cs:16` · Level 1 · record

- **What it is**: the immutable description of one sidebar entry a UI module contributes: title, href, icon, the resource type its title resolves against, optional role and claim gates, its [NavSection](#navsection), and an optional collapsible group.
- **Depends on**: [NavSection](#navsection); `System.Type` (BCL).
- **Concept introduced, navigation as data contributed by modules.** `[Rubric §25, Navigation & Information Architecture]` assesses modular, role-aware navigation. The shared menu never knows which modules exist: it injects `IEnumerable<IUIModule>`, flattens every module's `NavItems`, filters, partitions and renders (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/NavMenu.razor:197-204`). That mirrors the server-side [IModule](group-14-module-system-composition.md#imodule) contract one layer up ([ADR-059](https://ivanball.github.io/docs/adr/059-module-contract-and-composition.html) for the server, [ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html) for this one). `[Rubric §27, Internationalization]` applies through `TitleResource` ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Walkthrough**: a positional record declared on one line (`NavItem.cs:16`) with eight parameters, four of them optional:
  - `Title`, `Href`, `Icon`: required, positional.
  - `Type TitleResource`: **required**, and the fourth positional parameter. This is the localization contract, and the doc comment states it precisely (`NavItem.cs:9-14`): `Title` and `Group` are resource **keys**, resolved against `TitleResource` at render time, per-circuit, so the menu follows the active culture. A key the resource type does not declare renders as the raw string, which is what makes a not-yet-translated entry legible instead of blank. `NavMenu.razor` implements exactly that, calling `LocalizerFactory.Create(item.TitleResource)[item.Title]` for an item (`NavMenu.razor:166-170`) and `LocalizerFactory.Create(group.First().TitleResource)[group.Key]` for a group heading (`NavMenu.razor:172-180`), with the ADR-027 rule restated in a code comment at `:163-165`.
  - `string? RequiredRole = null` and `string? RequiredClaim = null`: render gates. The menu applies them as `item.RequiredRole is null || _user?.IsInRole(item.RequiredRole) == true` and the equivalent claim-type test (`NavMenu.razor:198-199`).
  - `NavSection Section = NavSection.General`: which sidebar group the item lands in (`NavMenu.razor:202-204`).
  - `string? Group = null`: nests the item inside a collapsible `MudNavGroup`; the menu groups by it with `GroupBy(i => i.Group)` in each of the three sections (`NavMenu.razor:60`, `:83`, `:110`).
- **Why it's built this way**: a positional record gives value semantics and a one-line construction per entry, which is what makes a module's `NavItems` read as a small declarative list. Making `TitleResource` a **required positional** parameter rather than an optional nullable one is the load-bearing design choice: there is no way to register a nav item that bypasses localization, so "all visible text follows the selected language" holds for the menu by construction rather than by review. [ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html) records the shape at this exact line (`NavItem.cs:16`).
- **Where it's used**: returned from the `NavItems` property of every [IUIModule](#iuimodule) implementation and rendered by `NavMenu.razor`. [NotificationUIModule](#notificationuimodule) is the framework's own example and shows both the minimal and the maximal form: `new("Nav.NotificationInbox", NotificationRoutePaths.NotificationInbox, Icons.Material.Filled.Inbox, typeof(SharedResource), Section: NavSection.User)` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs:19`) and `new("Nav.PushNotifications", NotificationRoutePaths.Notifications, Icons.Material.Filled.NotificationsActive, typeof(SharedResource), RoleNames.Organizer, Section: NavSection.Admin, Group: "Notifications")` (`:20`). Covered by [NavMenuTests](group-27-testing-infrastructure.md#navmenutests) (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Layout/NavMenuTests.cs`), which drives the menu through a `StubUiModule(IReadOnlyList<NavItem> navItems)` (`:198`).
- **Caveats / not-in-source**: `RequiredRole` and `RequiredClaim` control **rendering only**. They hide a link; they do not authorize the destination. The menu keeps a section-level authentication check alongside the per-item one deliberately (`NavMenu.razor:104-105`), but page-level and API-level authorization remain the enforcing gates.

---

### IUIModule

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IUIModule.cs:10` · Level 2 · interface

- **What it is**: the UI-side counterpart to the server's [IModule](group-14-module-system-composition.md#imodule). A pluggable UI module declares its navigation entries, its Razor assembly for route discovery, and optionally components it injects into the top app bar and the root layout.
- **Depends on**: [NavItem](#navitem); `System.Reflection.Assembly` (`IUIModule.cs:1`).
- **Concept introduced, plugging into a packaged application shell.** `[Rubric §18, UI Architecture & Component Design]` assesses whether there is a coherent composition model. [ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html) states the problem this solves: before it, every Blazor head owned its own `App` / `Routes` / layout / nav markup, so adding a module meant editing the host (a new nav link, a new assembly in the router, a new drawer in the layout), and two apps built on the same framework drifted apart in shell behavior even where they agreed. The framework already shipped the shell; what was missing was a contract letting a module contribute **into** it. Resolution is `IEnumerable<IUIModule>` from DI, so the shell composes whatever is registered without naming any module. `[Rubric §25, Navigation & Information Architecture]` applies because nav is contributed rather than hard-coded, and `[Rubric §7, Microservices Readiness]` applies in the same spirit as the server contract: a module that can be added or removed by one registration line is a module that can move.
- **Walkthrough**: four members, two of them defaulted.
  - `IReadOnlyList<NavItem> NavItems` (`IUIModule.cs:13`): the module's contribution to the shared sidebar. Flattened by `NavMenu.razor:197` with `.SelectMany(m => m.NavItems)`.
  - `Assembly Assembly` (`:16`): the assembly containing the module's Razor pages. The router consumes it as `AdditionalAssemblies="UIModules.Select(m => m.Assembly)"` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Routes.razor:8`), which is what makes a module's `@page` routes discoverable at run time with no central route table to edit.
  - `IReadOnlyList<Type> AppBarComponentTypes => []` (`:19`): a **default interface member** returning an empty collection expression. Components listed here render inside the top app bar (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/MainLayout.razor:98`, also gathered by `NavMenu.razor:194`).
  - `IReadOnlyList<Type> LayoutComponentTypes => []` (`:22`): the same idea at the root-layout level, for drawers, overlays and headless listeners (`MainLayout.razor:99`).
- **Why it's built this way**: the two default interface members are what keep the simple case simple. A module that only contributes navigation implements two properties, not four, and can gain app-bar or layout contributions later without a breaking change to anything already written. Passing an `Assembly` rather than a list of page types keeps route discovery reflective, so adding a page is never a framework edit.
- **Where it's used**: implemented by module descriptors across the workspace: the framework's own [NotificationUIModule](#notificationuimodule) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs:15`), ADC's `ConferenceUIModule` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/ConferenceUIModule.cs:14`), `EngagementUIModule` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/EngagementUIModule.cs:17`), `IdentityUIModule` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/IdentityUIModule.cs:13`) and the MAUI-head-only `DeviceUIModule` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/DeviceUIModule.cs:19`), plus Store's `CatalogUIModule` (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/CatalogUIModule.cs:13`), `SalesUIModule` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/SalesUIModule.cs:16`), `IdentityUIModule` (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.UI/IdentityUIModule.cs:13`) and `MauiUIModule` (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiUIModule.cs:14`). The optional members earn their keep in practice: `NotificationUIModule` contributes `NotificationBell` to the app bar and `NotificationListener` to the layout (`NotificationUIModule.cs:23-25`), Store's `SalesUIModule` contributes `CartButton` plus `CartDrawer` and `OrphanOrderRecovery` (`SalesUIModule.cs:30-32`), ADC's `EngagementUIModule` contributes `LiveEventListener` (`EngagementUIModule.cs:31`), and ADC's `DeviceUIModule` contributes five headless native listeners at once (`DeviceUIModule.cs:33`). Registration goes through `AddUIModule<TModule>()` (see [DependencyInjection](#dependencyinjection)), which each module's own one-line `Add{Module}UI()` delegates to, for example `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/DependencyInjection.cs:19`. A stub implementation drives the menu tests (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Layout/NavMenuTests.cs:198`) and another drives the backend-less component gallery (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/GalleryUIModule.cs:14`).

---

### IEntityService<TEntityDTO, TIdentifierType>

> MMCA.Common.UI · `MMCA.Common.UI.Common.Interfaces` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IEntityService.cs:20` · Level 3 · interface

- **What it is**: the generic CRUD contract every module page injects to talk to its API endpoints. Seven asynchronous members, every one of them returning a [Result](group-01-result-error-handling.md#result).
- **Depends on**: [Result](group-01-result-error-handling.md#result) and [ErrorType](group-01-result-error-handling.md#errortype) from `MMCA.Common.Shared.Abstractions` (`IEntityService.cs:1`); [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) as the `TEntityDTO` constraint (`:21`) and [BaseLookup<TIdentifierType>](group-12-api-hosting-mapping.md#baselookuptidentifiertype) as a return type (`:41`), both from `MMCA.Common.Shared.DTOs` (`:2`). Implemented by [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype).
- **Concept introduced, the Result railway crossing the HTTP boundary intact.** `[Rubric §18, UI Architecture & Component Design]` assesses separation of components from their data access, and `[Rubric §9, API & Contract Design]` assesses whether the client contract mirrors the server surface. But the teaching point is the second paragraph of the doc comment (`IEntityService.cs:10-16`): every member returns "the same railway type the server produced, read back from its Problem Details response with the original `ErrorType` intact". A page therefore **branches on the outcome instead of catching an exception**. That is what makes a 404 renderable as an empty state and a 401 as a redirect without pattern-matching message text, and it is why the sibling helper [ResultUiExtensions](#resultuiextensions) exists. [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)'s 2026-08-27 revision records this as the retirement of the UI-layer deviation, and [ADR-094](https://ivanball.github.io/docs/adr/094-client-entity-data-access.html) records the surrounding data-access contract. Note also the layering rule this respects: `MMCA.Common.UI` may reference `MMCA.Common.Shared` only, which is why both constraints come from `Shared` and never from Application or Domain `[Rubric §3, Clean Architecture]`.
- **Walkthrough**: two generic constraints (`:21-22`) bind `TEntityDTO` to [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) and require `TIdentifierType : notnull`. Then seven members, every one ending in a defaulted `CancellationToken`:
  - `GetAllAsync(bool includeFKs, bool includeChildren, CancellationToken)` (`:25-28`) returns `Result<IReadOnlyList<TEntityDTO>>`; the two flags map to API query options.
  - `GetPagedAsync(Dictionary<string, (string Operator, string Value)> filters, int pageNumber, int pageSize, string? sortColumn, string? sortDirection, bool includeChildren, CancellationToken)` (`:31-38`) returns `Result<(IReadOnlyList<TEntityDTO> Items, int TotalItems)>`. The `TotalItems` half of that tuple is what makes server-side paging work at all: a grid needs the total to size its pager without fetching the rest of the table. The filter dictionary is the client half of the dynamic query contract ([ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html)).
  - `GetAllForLookupAsync(string nameProperty, CancellationToken)` (`:41-43`) returns lightweight `Id + Name` [BaseLookup<TIdentifierType>](group-12-api-hosting-mapping.md#baselookuptidentifiertype) items for dropdowns and autocompletes, so a picker never pulls whole entities.
  - `GetByIdAsync(TIdentifierType id, bool includeChildren, CancellationToken)` (`:50-53`) returns `Result<TEntityDTO>`, and the doc comment (`:45-49`) pins the contract that used to be ambiguous: a missing entity is an `ErrorType.NotFound` **failure**, never a success carrying null. That is what lets a detail page write `if (result.IsNotFound())` instead of a null check that cannot distinguish "absent" from "the call failed".
  - `AddAsync(TEntityDTO entity, CancellationToken)` (`:56-58`) returns the server-assigned DTO including its generated id.
  - `UpdateAsync(TEntityDTO entity, CancellationToken)` (`:61-63`) and `DeleteAsync(TIdentifierType id, CancellationToken)` (`:66-68`) return the non-generic `Result`, because there is no value to carry back, only a verdict.
- **Why it's built this way**: an interface keeps Blazor components testable (mock the contract, no HTTP) and hides the API URL structure behind a typed surface. The generic-over-DTO shape is the client mirror of the server's generic controller layer ([ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html)), which is why one base class implements it for every entity in the system. The uniform `Result` return is deliberate rather than convenient: mixing nullable returns for reads with `bool` for writes forces each call site to invent its own error story, whereas returning `Result` everywhere means one small set of helpers covers all seven members.
- **Where it's used**: implemented for every entity by [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:43-47`, which also composes an optional [IUiReadCache](#iuireadcache)) and consumed by every module CRUD page, most of them through [DataGridListPageBase<TDto>](#datagridlistpagebasetdto). Registration is automatic: `AddUIModule<TModule>()` runs a Scrutor scan over the module's assembly that picks up every class assignable to `IEntityService<,>` and registers it scoped as its implemented interfaces ([DependencyInjection](#dependencyinjection), `DependencyInjection.cs:206-210`). The `(Items, TotalItems)` shape of `GetPagedAsync` is also the shape [MobileInfiniteScrollList<TItem>](#mobileinfinitescrolllisttitem)'s page-fetch delegate expects.

---

### ResultUiExtensions

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:63` · Level 3 · class (static, extension methods)

- **What it is**: the page-side half of the Result transport. It is the four things a Blazor page ever does with a failed [Result](group-01-result-error-handling.md#result), written once so no page hand-rolls them again: unwrap the value, push the message into an inline alert, raise it as a toast, or branch on **why** it failed.
- **Depends on**: [Result](group-01-result-error-handling.md#result), [Error](group-01-result-error-handling.md#error), [ErrorType](group-01-result-error-handling.md#errortype) and [ErrorTypeSeverity](group-01-result-error-handling.md#errortypeseverity) from `MMCA.Common.Shared.Abstractions` (`ResultUiExtensions.cs:3`); [IToastService](#itoastservice) and [ToastSeverity](#toastseverity) (`:4`); `Microsoft.Extensions.Localization.IStringLocalizer` (`:2`); `System.Diagnostics.CodeAnalysis.NotNullWhenAttribute` (`:1`).
- **Concept introduced, localize-with-pass-through, and severity-ordered deduplication.** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether a failure reaches the user as one clear, actionable sentence; `[Rubric §27, Internationalization]` assesses whether that sentence follows the active culture; `[Rubric §16, Maintainability]` assesses whether the same five lines get re-typed per page. Two mechanisms carry all three.
  - **Pass-through localization** (`:17-23`): every message is looked up as a resource key, and one the localizer does not declare renders **verbatim**. That is what lets a single call site handle both an API error whose text the server already localized and a client-side error whose `Message` is a resource key.
  - **Severity-ordered deduplication** (`:24-29`): messages are made distinct with `StringComparer.Ordinal` and ordered most-severe-first via [ErrorTypeSeverity](group-01-result-error-handling.md#errortypeseverity), so a real 403 or 500 leads and an incidental validation message never buries it. The shape this guards against is common once `Result.Combine` aggregates invariants: the same sentence arriving under several codes now reads as one sentence. This is the client mirror of the server-side status selection recorded in [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html), using the very same ranking type hoisted into `Shared` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ErrorTypeSeverity.cs:57`) so both edges classify one aggregate identically.

  The class doc even ships a before/after pair (`:31-62`) contrasting the old `try` / `catch (Exception ex)` shape with `if (result.TryGetValue(out var dto)) { ... } else { result.NotifyOnFailure(Toast, L); }`.
- **Walkthrough**: eleven public members plus one private helper, in four tiers.
  - **Unwrapping.** `TryGetValue<T>(this Result<T>, [NotNullWhen(true)] out T? value)` (`:82-97`) reads like `Dictionary.TryGetValue` so the success and failure branches sit side by side. The implementation carries a subtle correctness note in its comment (`:86-88`): the failure branch is decided by `result.IsFailure`, **not** by whether the value is null, because for a value type (a `(Items, TotalItems)` tuple, an `int` count) `default` is never null and a null test alone would report every failure as a success. The three-argument overload (`:116-133`) hands the errors back on the failing branch and documents one edge honestly (`:102-109`): a *success* carrying a null value also takes the failing branch, and a success has no errors, so `errors` comes back empty. The framework's own services never produce that shape (a 2xx with no value fails with `Http.EmptyResponse`), but a caller switching on the error list should not assume it is non-empty.
  - **Composing the message.** `LocalizedErrorMessages(this Result, IStringLocalizer?)` (`:145-159`) returns an empty list for a success, so a caller can bind it without a null or success check, and otherwise orders by `ErrorTypeSeverity.Rank` descending, localizes, drops blanks, and takes ordinal-distinct values (`:154-158`). `LocalizedErrorMessage` (`:169-173`) joins that list with a space and returns `null` for a success. `LocalizeDistinct(IEnumerable<string>?, IStringLocalizer?)` (`:185-197`) gives the same treatment to a plain message list, specifically the `MudForm.Errors` shape whose entries are resource keys produced by the model's DataAnnotations; it preserves original order rather than re-ranking, since those entries carry no `ErrorType`.
  - **Rendering.** `OnFailureSetError(this Result, Action<string?> setError, IStringLocalizer?)` (`:226-233`) hands the composed message to the page's own error field, the one an inline `MudAlert` or `PageErrorState` renders, and **clears it on success** by passing `null` (`:231`), which is why a retry that succeeds does not leave a stale alert on screen. `NotifyOnFailure(this Result, IToastService, IStringLocalizer?, ToastSeverity = Error)` (`:265-281`) raises the composed message as **one** toast, never one per error, calling `toast.Show(message, severity)` only when the composed message is non-null (`:274-278`). Both return the same result instance so the call can sit inline, and both have a `Result<T>` overload that delegates to the non-generic one and returns the typed result (`:237-241`, `:285-293`), which is what keeps `(await Service.AddAsync(dto, token)).NotifyOnFailure(Toast, L)` chainable.
  - **Branching on why.** `HasErrorType(this Result, ErrorType)` (`:303-307`) is the general predicate; the doc comment (`:295-299`) notes the category survives the HTTP round trip through [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader), which is what makes this meaningful client-side at all. `IsNotFound()` (`:315`) and `IsUnauthorized()` (`:323`) are the two named cases, and their doc comments state the intended UI reaction: a 404 becomes a "not found" state rather than an error alert, a 401 becomes a redirect to the login route.
  - **The private helper.** `Localize(string message, IStringLocalizer?)` (`:325-334`) is where pass-through actually happens: a null localizer or a blank message returns the input unchanged, otherwise it indexes the localizer and returns `localized.ResourceNotFound ? message : localized.Value` (`:333`).
- **Why it's built this way**: extension methods on `Result` rather than an injectable service, because there is no state and nothing to resolve, so a page uses them without a constructor parameter and a unit test calls them directly. Every rendering helper returns the result it was given, which is what allows the fluent one-liner style the class doc advertises. The nullable `IStringLocalizer?` parameter everywhere means the helpers work from a context that has no localizer (they then render verbatim) rather than forcing one in.
- **Where it's used**: by every page and component that calls an [IEntityService<TEntityDTO, TIdentifierType>](#ientityservicetentitydto-tidentifiertype) member, across the framework package and both consumer apps, plus the shared deduplicating error-summary component. Covered by [ResultUiExtensionsTests](group-27-testing-infrastructure.md#resultuiextensionstests) (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Common/ResultUiExtensionsTests.cs:17`) `[Rubric §28, Front-End Testing]`.
- **Caveats / not-in-source**: the class doc opens with "the Result transport (ADR-030)" (`ResultUiExtensions.cs:9`), but ADR-030 is `030-startup-sole-migrator.md`. The Result-pattern record, including the 2026-08-27 revision that names `ResultUiExtensions` and its exact member list, is [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html); the client data-access half is [ADR-094](https://ivanball.github.io/docs/adr/094-client-entity-data-access.html). Trust the ADR index over the comment.

---

### NotificationRoutePaths

> MMCA.Common.UI · `MMCA.Common.UI.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/NotificationRoutePaths.cs:8` · Level 5 · class (static)

- **What it is**: the route constants for the framework's own notification feature, three literal paths plus one typed deep-link builder for a single inbox item.
- **Depends on**: `System.Globalization.CultureInfo` (`NotificationRoutePaths.cs:1`) and the `UserNotificationIdentifierType` alias, which resolves to `int` (`MMCA.Common/Source/Core/MMCA.Common.Shared/GlobalUsings.NotificationIdentifierType.cs:2`). That alias dependency is why an otherwise Level 0-looking constants class sits at Level 5.
- **Concept introduced, formatting a URL segment invariantly.** The "one source of truth for route strings" idea is taught at [RoutePaths](#routepaths); what is new here is the builder method and why it pins a culture. `[Rubric §27, Internationalization]` assesses whether culture-sensitive formatting is applied deliberately rather than by default, and this is the case where the correct answer is to opt **out**. The doc comment (`:14-18`) spells it out: the route's `:int` constraint is the validation boundary, so a culture that renders digit groups (`1,234`) or non-ASCII digits would produce a URL the constraint rejects. A route segment is machine-readable data, not user-facing text.
- **Walkthrough**: three `public static readonly string` members and one method.
  - `Notifications = "/notifications"` (`:10`), the admin push-management list.
  - `NotificationSend = "/notifications/send"` (`:11`), the admin send page.
  - `NotificationInbox = "/notifications/inbox"` (`:12`), the per-user inbox.
  - `NotificationInboxItem(UserNotificationIdentifierType id)` (`:21-22`) composes the deep link with `string.Create(CultureInfo.InvariantCulture, $"{NotificationInbox}/{id}")`. The target route exists: `NotificationInbox.razor` carries both `@page "/notifications/inbox"` and `@page "/notifications/inbox/{Id:int}"` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationInbox.razor:1-2`).
- **Why it's built this way**: kept separate from [RoutePaths](#routepaths) so an app that never enables the notification module carries no irrelevant constants, and so notification routes evolve on their own. `string.Create` with an explicit culture, rather than plain string interpolation, is the analyzer-friendly way to state "this formatting is deliberate" in a repo where every analyzer is an error.
- **Where it's used**: the notification surfaces navigate by these constants rather than by literals: `NotificationSend.razor.cs:61` (its breadcrumb back to the list), `:117` (post-send navigation) and `:136` (the cancel path), `NotificationList.razor.cs:77` (navigate to send), and `NotificationBell.razor.cs:238` (`NavigateToInbox`). [NotificationUIModule](#notificationuimodule) builds its two [NavItem](#navitem) entries from `NotificationInbox` and `Notifications` (`NotificationUIModule.cs:19-20`). ADC's `AppActionRouteMapTests` asserts that a push action resolves to `NotificationRoutePaths.NotificationInbox` (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.UI.Tests/Services/AppActionRouteMapTests.cs:39`).
- **Caveats / not-in-source**: `NotificationInboxItem` has **no call site** in any of the four repos as of this source; it is listed in `PublicAPI.Unshipped.txt` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/PublicAPI.Unshipped.txt:315`, recorded there with its resolved signature `NotificationInboxItem(int id)`), while the three string constants are baselined in `PublicAPI.Shipped.txt:913-915`. The `{Id:int}` route it targets is live; the typed builder for it is shipped but not yet adopted.

---

### DependencyInjection

> MMCA.Common.UI · `MMCA.Common.UI` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:22` · Level 7 · class (static, with one `extension(IServiceCollection)` block)

- **What it is**: the composition root of the UI layer. One `AddUIShared(configuration)` call wires the shared UI infrastructure every head needs (Blazor Server, WebAssembly, MAUI), and four smaller methods cover the per-head and per-module registrations.
- **Depends on**: nearly the whole group. Settings: [ApiSettings](#apisettings), [LayoutSettings](#layoutsettings), [UiReadCacheOptions](#uireadcacheoptions), [NotificationBellOptions](#notificationbelloptions). Caching: [IUiReadCache](#iuireadcache) / [UiReadCache](#uireadcache). Localization: [PseudoStringLocalizerFactory](#pseudostringlocalizerfactory), [ResxMudLocalizer](#resxmudlocalizer). HTTP: [AuthDelegatingHandler](#authdelegatinghandler), [CultureDelegatingHandler](#culturedelegatinghandler), [HttpResilienceDefaults](group-16-aspire-orchestration.md#httpresiliencedefaults). Facades: [IToastService](#itoastservice) / [MudToastService](#mudtoastservice), [IAppDialogService](#iappdialogservice) / [MudAppDialogService](#mudappdialogservice). Services: [IAuthUIService](#iauthuiservice), [ListPageStateService](#listpagestateservice), [ListPageQueryStateService](#listpagequerystateservice), [NavigationHistoryService](#navigationhistoryservice), [ThemeService](#themeservice), [ICultureApplier](#icultureapplier) / [EndpointCultureApplier](#endpointcultureapplier), [IPublicLinkBuilder](#ipubliclinkbuilder) / [NavigationPublicLinkBuilder](#navigationpubliclinkbuilder), [IUserPreferenceWriter](#iuserpreferencewriter), [IUserPreferenceReader](#iuserpreferencereader), [IOAuthUISettings](#ioauthuisettings) / [DefaultOAuthUISettings](#defaultoauthuisettings), [ISessionCookieSync](#isessioncookiesync) / [JsFetchSessionCookieSync](#jsfetchsessioncookiesync). Capabilities: [IFormFactor](group-26-device-capability-layer.md#iformfactor) / [WasmFormFactor](group-26-device-capability-layer.md#wasmformfactor). Composition: [IUIModule](#iuimodule), [IEntityService<TEntityDTO, TIdentifierType>](#ientityservicetentitydto-tidentifiertype). Externals: Scrutor (`Decorate`, `Scan`), MudBlazor, and `Microsoft.Extensions.{Configuration, DependencyInjection, Localization, Options}` (`DependencyInjection.cs:1-14`).
- **Concept introduced, the composition root written as an `extension(T)` block.** The whole registration surface lives inside `extension(IServiceCollection services)` (`DependencyInjection.cs:24`) rather than as classic `this`-parameter extension methods; see [primer, C# extension(T) types](00-primer.md#c-extensiont-types-read-this-once) for the language mechanics, taught once. `[Rubric §15, Best Practices & Code Quality]` assesses one consistent idiom across layers, and this file matches the other `DependencyInjection` classes in every layer of the workspace. `[Rubric §33, Developer Experience]` assesses fail-fast startup and a small number of calls per host. `[Rubric §10, Cross-Cutting Concerns]` assesses whether concerns are wired once, centrally: localization, culture forwarding, authentication, resilience and caching are all configured here rather than per page.
- **Walkthrough**: five methods in the extension block.
  - **`AddUIShared(IConfiguration configuration)`** (`:30-142`), in order:
    - **Options.** [ApiSettings](#apisettings) binds with `.ValidateDataAnnotations().ValidateOnStart()` (`:33-36`), so a missing `ApiEndpoint` fails the host at startup rather than at the first HTTP call. [LayoutSettings](#layoutsettings) binds without validation because empty defaults are acceptable (`:39-40`). [UiReadCacheOptions](#uireadcacheoptions) (`:44-45`) and [NotificationBellOptions](#notificationbelloptions) (`:47-48`) bind the client-side staleness policy; the comment (`:42-43`) records that both sections are optional and an absent section leaves the compiled-in defaults, which is what a host gets without configuring anything.
    - **Clock and read cache.** `TryAddSingleton(TimeProvider.System)` (`:52`), with a comment explaining both directions of the `TryAdd` (`:50-51`): a host that already registered one, as `AddInfrastructure` does, keeps it, and a test substitutes a `FakeTimeProvider`. `TryAddScoped<IUiReadCache, UiReadCache>()` (`:57`) is scoped so it is per-circuit on Blazor Server; the comment (`:54-56`) records the consequence on the other heads, where the scope is the app lifetime, which is why the sign-out path clears it explicitly, otherwise one account's reads would outlive its session `[Rubric §26, Front-End Security]`.
    - **Localization** ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). `AddLocalization()` (`:60`) for `IStringLocalizer<T>`, then `Decorate<IStringLocalizerFactory, PseudoStringLocalizerFactory>()` (`:67`), registered unconditionally because the pseudo-locale transform is inert under every other culture and the pseudo locale is only ever activatable in Development (`:62-66`). `TryAddTransient<MudBlazor.MudLocalizer, ResxMudLocalizer>()` (`:73`) localizes MudBlazor's own component text; the comment (`:69-72`) records why `TryAdd` is authoritative regardless of host registration order, namely that `AddMudServices` registers no `MudLocalizer` of its own and a DI resolution test guards that assumption.
    - **The one HTTP client.** Both delegating handlers register transient (`:77-78`), then the named `"APIClient"` (`:81-102`). Its factory resolves `IOptions<ApiSettings>` and sets `client.BaseAddress = new Uri(apiSettings.ApiEndpoint!, UriKind.Absolute)` (`:88-91`). There is deliberately **no** hand-written endpoint guard, and the comment says why (`:83-87`): resolving `.Value` runs the `ValidateDataAnnotations` rules registered above, so a missing `[Required]` endpoint already fails as an `OptionsValidationException`, and a second check would only give the same failure a different, less informative exception. `client.Timeout` is pinned to [HttpResilienceDefaults](group-16-aspire-orchestration.md#httpresiliencedefaults)`.TotalRequestTimeout` (`:97`) because the BCL's own 100-second default was chosen with no knowledge of the resilience budget and would cut a call off mid-policy at an arbitrary point (`:93-96`) `[Rubric §29, Resilience & Business Continuity]`. Default headers are cleared and `Accept: application/json` added (`:98-99`), and the two handlers chain in order (`:101-102`) so every outgoing call carries both the bearer token and the active UI culture as `Accept-Language`.
    - **Facades.** `services.AddCommonUiFacades()` (`:106`), factored out so a bUnit harness can register exactly these two without pulling in the whole shared-UI surface (`:104-105`).
    - **Scoped services**, all via `TryAdd` so several composing hosts cannot double-register: [IAuthUIService](#iauthuiservice) (`:109`), [ListPageStateService](#listpagestateservice) (`:110`), [ListPageQueryStateService](#listpagequerystateservice) (`:111`), [NavigationHistoryService](#navigationhistoryservice) (`:112`), [ThemeService](#themeservice) (`:115`, [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)), [ICultureApplier](#icultureapplier) defaulting to [EndpointCultureApplier](#endpointcultureapplier) (`:121`), [IPublicLinkBuilder](#ipubliclinkbuilder) defaulting to [NavigationPublicLinkBuilder](#navigationpubliclinkbuilder) (`:127`), and the per-user preference writer and reader (`:130-131`), documented as best-effort and a no-op for an anonymous user (`:129`). `TryAddSingleton<IOAuthUISettings, DefaultOAuthUISettings>()` (`:135`) supplies a no-op default that a downstream app replaces.
    - **Capabilities.** `AddDeviceCapabilityDefaults()` (`:139`, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)) so every capability contract resolves on every head, registered here specifically so MAUI and browser hosts can override afterwards under last-registration-wins (`:137-138`).
  - **`AddCommonUiFacades()`** (`:158-163`): two `TryAddScoped` calls, [IToastService](#itoastservice) to [MudToastService](#mudtoastservice) (`:160`) and [IAppDialogService](#iappdialogservice) to [MudAppDialogService](#mudappdialogservice) (`:161`). Its doc comment (`:144-157`) is the clearest statement of the facade rule anywhere in the codebase: these two implementations are the ONLY types in the framework that name MudBlazor's `ISnackbar` / `IDialogService`, they are scoped to match the MudBlazor services they wrap, and the method is called both by `AddUIShared` and by the shipped bUnit base so a component test resolves the facades without the rest of the shared-UI surface.
  - **`AddClientAuthSessionCookieSync()`** (`:170-174`): one `TryAddScoped<ISessionCookieSync, JsFetchSessionCookieSync>()` (`:172`), the bridge that mirrors the client's in-memory tokens into the HttpOnly cookie read during server-side SSR prerender. Called from both the Blazor Server host and the WebAssembly client (`:165-169`).
  - **`AddWasmFormFactor()`** (`:182-183`): registers [IFormFactor](group-26-device-capability-layer.md#iformfactor) to [WasmFormFactor](group-26-device-capability-layer.md#wasmformfactor) as a singleton. The doc comment names the two alternatives (`:176-181`): `AddCommonWebFormFactor()` from `MMCA.Common.UI.Web` on the Blazor Server head, `AddMauiFormFactor()` from `MMCA.Common.UI.Maui` on the MAUI head.
  - **`AddUIModule<TModule>()`** (`:203-213`), constrained to `TModule : class, IUIModule` (`:204`): a Scrutor scan `FromAssemblyOf<TModule>()` registering every [IEntityService<TEntityDTO, TIdentifierType>](#ientityservicetentitydto-tidentifiertype) implementation scoped as its implemented interfaces (`:206-210`), then `AddSingleton<IUIModule, TModule>()` (`:212`). The doc comment (`:192-197`) records the deliberate boundary: this is the two-step prologue every module's `Add{Module}UI()` opens with, and module-specific services stay with the caller **afterwards**, so a module whose service must beat a shared default still controls its own registration order. The type-parameter doc (`:199-202`) states the constraint that follows from using the descriptor's assembly as the scan root: it must live alongside the module's entity services and Razor pages.
- **Why it's built this way**: `TryAdd` throughout is both a safety property (several composing hosts calling `AddUIShared` cannot double-register) and the override mechanism (a host that registers its own implementation **before** the call wins). Two ordering choices push in the opposite direction and are called out in comments because they are load-bearing: [ICultureApplier](#icultureapplier)'s default round-trips a server `/culture/set` endpoint that a MAUI hybrid head does not have, so hybrids override it **after** `AddUIShared` (`:117-120`), and [IPublicLinkBuilder](#ipubliclinkbuilder)'s default resolves against the browser origin, which is wrong for a MAUI WebView whose origin is a virtual host nobody else can open, so that is overridden after as well (`:123-126`). Read together, the file encodes a rule worth carrying into any new registration: a contract whose correct implementation depends on the *head* is defaulted here and replaced later, while a contract that is the same everywhere is `TryAdd`ed and left alone.
- **Where it's used**: called once at startup by all six consuming UI hosts (ADC's `MMCA.ADC.UI.Web`, `MMCA.ADC.UI.Web.Client` and MAUI `MMCA.ADC.UI`, plus the three Store equivalents), each followed by the per-module `Add{Module}UI()` calls, which are usually one-liners over `AddUIModule<TModule>()`, for example `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.UI/DependencyInjection.cs:19` and `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/DependencyInjection.cs:23`. `AddCommonUiFacades()` has a second caller outside any host, the shipped bUnit base (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:53`). The `"APIClient"` configured here is the client every [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype)-derived service resolves. The assembly this class lives in is also the one [UISharedAssemblyReference](#uisharedassemblyreference) (declared at `:218`, just below) names for the architecture fitness suite.

### ApiFileDownloadButton

> MMCA.Common.UI · `MMCA.Common.UI.Components` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/ApiFileDownloadButton.razor.cs:14` · Level 0 · class (partial component)

- **What it is**: a payload-agnostic icon button that hands the user a file produced by an API endpoint. On a browser it is a plain download link to the endpoint; on a native (MAUI) head, where the WebView cannot download, it fetches the bytes over the API client, stages a temp file, and opens the OS share sheet. Callers supply the endpoint, the file name, the MIME type and the labels; the button knows nothing about what the payload is (`ApiFileDownloadButton.razor.cs:6-13`).
- **Depends on**: [`IExternalLinkService`](group-26-device-capability-layer.md#iexternallinkservice) and [`IShareService`](group-26-device-capability-layer.md#ishareservice) (the device-capability abstractions), [`IToastService`](#itoastservice), [`ApiSettings`](#apisettings) through `IOptions<ApiSettings>`, and `IStringLocalizer<ApiFileDownloadButton>` over the component's own `.resx` pair, all injected in the markup file (`Components/ApiFileDownloadButton.razor:4-9`). Externals: `IHttpClientFactory`, `System.IO.File`/`Path`, and MudBlazor's `MudIconButton`.
- **Concept introduced, one component, two heads, one contract.** `[Rubric §18, UI Architecture]` (assesses whether components have a single clear responsibility and keep host differences out of pages) and `[Rubric §26, Front-End Security]` (assesses whether the front end treats caller-supplied data as untrusted). The head split is decided by a *capability query*, not by a compilation symbol: the markup branches on `ExternalLink.InterceptsLinks` (`ApiFileDownloadButton.razor:18`), and both branches render the same `MudIconButton` with the same icon, size and accessible name, so the affordance looks identical while the mechanism differs ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). The security concept is **path containment**: a file name built from entity data must not be able to steer a filesystem write, which is what `ResolveStagedFileName` exists to prevent.
- **Walkthrough**:
  - Parameters (lines 17-80). Three are `[EditorRequired]`: `RelativeApiPath` (line 19), `FileName` (line 30) and `ShareTitle` (line 35). `ContentType` defaults to `application/octet-stream` (line 43) and is what the share sheet uses to pick target apps. `Icon` defaults to the generic download glyph (line 47), `Size` to `Size.Small` (line 51). `AriaLabel`, `UnavailableMessage` and `FailureMessage` (lines 59, 66, 73) are nullable overrides over localized defaults. `HttpClientName` defaults to `"APIClient"` (line 80), the framework's bearer-token plus culture-header client.
  - `AccessibleLabel` (line 84) resolves `AriaLabel ?? L["Button.Download.Aria"].Value`, and the markup binds it to BOTH `aria-label` and `title` on either branch (`ApiFileDownloadButton.razor:22-23`, `:31-32`), so an icon-only control always carries a name. The default key lives in the component's own resource file (`Components/ApiFileDownloadButton.resx:15`).
  - `BrowserDownloadUrl` (lines 89-98) is the browser branch's `Href`. It prefers `WasmApiEndpoint` over `ApiEndpoint` (line 93) because the browser needs the externally reachable gateway URL: on the Server head `ApiEndpoint` may be a container-internal name, and on the WASM head `ApiEndpoint` is already the browser-reachable value fetched from `/client-config` (lines 86-88). With no base URL configured it falls back to the relative path (lines 94-95); otherwise it composes an absolute URI (line 96).
  - `ShareDownloadedFileAsync` (lines 100-149) is the native branch. It re-entrancy-guards on `_isExporting` and an empty path (lines 102-105), sanitizes the file name **before** the fetch so an unusable name costs no download (lines 110-116), creates the named client and pulls the bytes (lines 118-119), stages the file (line 121), and calls `Share.ShareFileAsync` (line 123), toasting a warning when no share surface accepted it (line 125). Three catch blocks all surface a toast rather than throwing: `HttpRequestException` (line 128), `OperationCanceledException` (line 132, which here is the `HttpClient` timeout, not a disposal, since no token is passed), and a bare `Exception` (line 138) covering the staging write and the share sheet, because this runs in an `OnClick` callback where an unhandled exception is fatal to a native host (lines 140-143). The `finally` clears the guard (line 147).
  - `ResolveStagedFileName` (lines 162-171) reduces the caller's name to a bare file name with `Path.GetFileName` and rejects `.` and `..` (lines 164-170), returning null when nothing usable remains. The remarks (lines 155-161) state the exact hazard: `Path.Combine` discards its first argument outright when the second is rooted, and `..` segments walk out of the temp root, so an unsanitized name would decide where the delete and the write land.
  - `StageFileAsync` (lines 180-192) writes into `Path.GetTempPath()` under the already-sanitized name (line 182), deleting any leftover first (lines 184-187) so a truncated previous copy is never shared. It deliberately does **not** delete after sharing: on Android the share intent returns as soon as it launches, so deleting would race the receiving app (lines 174-178).
- **Why it's built this way**: the download mechanics are the part every consumer would otherwise re-implement per file type, and they are exactly the part that differs per head, so they belong in the framework behind a capability query ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). Keeping the wording out of the component (labels are parameters with localized fallbacks) is what lets one button serve a calendar file, an export, or a receipt without the framework knowing any of those words.
- **Where it's used**: ADC wraps it in a thin calendar affordance, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Components/AddToCalendarButton.razor:8-17`, which supplies `ContentType="text/calendar"`, the calendar glyph, and its own localized aria-label and failure messages while the download and share mechanics stay here. Covered by [`ApiFileDownloadButtonTests`](group-27-testing-infrastructure.md#apifiledownloadbuttontests).
- **Caveats / not-in-source**: the doc comment on `AriaLabel` (line 54) tags the icon-only accessible-name rule as "ADR-021", but ADR-021 in the current set is `021-consumer-inbox-idempotency`; the accessibility contract the rule belongs to is [ADR-063](https://ivanball.github.io/docs/adr/063-accessibility-conformance-gate.html). Which apps a native share sheet offers for a given MIME type is OS behavior and not determinable from this source.

### IApiSettings

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/IApiSettings.cs:6` · Level 0 · interface

- **What it is**: a two-property read-only view of the API configuration a UI host needs: the base URL it calls, and the base URL it hands to a browser.
- **Depends on**: nothing. Two `string?` getters and no using directives.
- **Concept introduced, split-horizon endpoints.** `[Rubric §7, Microservices Readiness]` (assesses whether a component copes with the topology it is deployed into rather than assuming one address space). A Blazor Web host and the browser it serves do not see the gateway the same way. `ApiEndpoint` (line 9) is what the *server* calls, which in production is a container-internal or service-discovery name that resolves nowhere in a browser. `WasmApiEndpoint` (lines 11-17) is the externally reachable URL served to the WebAssembly client through the `/client-config` endpoint. Splitting them lets the server take the faster internal path while the browser gets a name it can resolve, from one configuration section.
- **Walkthrough**: `string? ApiEndpoint { get; }` (line 9) and `string? WasmApiEndpoint { get; }` (line 17). Both are nullable, because the interface itself imposes no requirement; the `[Required]` rule lives on the implementation ([`ApiSettings`](#apisettings)).
- **Why it's built this way**: a read-only interface over an options class is the shape that lets a consumer state "I only read configuration" instead of taking a mutable settings object. It also documents the contract in one place while `ApiSettings` carries the binding and validation attributes.
- **Where it's used**: implemented by [`ApiSettings`](#apisettings) (`Common/Settings/ApiSettings.cs:9`). The two endpoint values are read through `IOptions<ApiSettings>` at the `/client-config` endpoints and in the API client factory, not through this interface.
- **Caveats / not-in-source**: no injection site resolves `IApiSettings` today: a repo-wide search finds the interface only at its declaration and on the `ApiSettings` class. The doc comment (line 15) says `WasmApiEndpoint` "falls back to `ApiEndpoint` when null", which is true of Store's endpoint (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:190`) but not of ADC's, which throws an `InvalidOperationException` naming the missing key rather than handing the browser an unresolvable name (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:155-158`). The fallback is host policy, not a property of the contract.

### InfiniteScrollSentinel

> MMCA.Common.UI · `MMCA.Common.UI.Components` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/InfiniteScrollSentinel.razor.cs:21` · Level 0 · class (partial component)

- **What it is**: a bottom-of-list marker that raises `OnVisible` when it scrolls near the viewport, so the hosting page can fetch and append its next page. It owns the IntersectionObserver and nothing else: the item markup, the fetch, and the accumulated list stay with the page.
- **Depends on**: `IJSRuntime` and the shared JS module `_content/MMCA.Common.UI/infinite-scroll.js` (`wwwroot/infinite-scroll.js`), `DotNetObjectReference`, `ElementReference`, and MudBlazor's `MudProgressCircular` in the markup. Nothing first-party; it is a sibling of [`MobileInfiniteScrollList<TItem>`](#mobileinfinitescrolllisttitem), which drives the same JS module.
- **Concept introduced, the observer as a child component so disposal is correct.** `[Rubric §23, Front-End Performance]` (assesses render and network cost: paging on demand instead of loading everything, and detaching observers so they stop costing anything), `[Rubric §21, Accessibility]` (assesses whether dynamic content changes are announced without hijacking focus) and `[Rubric §18, UI Architecture]`. The design point recorded in the doc comment (lines 14-19) is a lifecycle one: a page deriving from [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) cannot hook async disposal because its `DisposeAsync` is not virtual, whereas a child component is disposed by the renderer the moment the host stops rendering it. Rendering the sentinel only while more pages exist therefore makes "detach the observer" a rendering decision rather than a bookkeeping one, and a filter reset that refills the list gets a fresh instance with a fresh observer.
- **Walkthrough**:
  - Parameters: `OnVisible` (line 26), `IsLoading` (line 29) which renders the inline progress row, and `LoadingLabel` (line 32), the localized accessible name for that row.
  - State (lines 34-39): a per-instance `_observerId` (a `Guid` "N" string, line 34), the `_sentinelRef` element reference, the imported `_module`, the `_dotNetRef` self-reference handed to JS, plus `_observing` and `_disposed` flags.
  - `OnSentinelVisible()` (lines 45-47) is the `[JSInvokable]` callback. Its name is fixed by the shared JS module, which calls it by string (lines 41-44). It returns immediately when disposed, otherwise marshals onto the renderer with `InvokeAsync` before invoking `OnVisible`.
  - `OnAfterRenderAsync` (lines 50-58) attaches the observer once, on the first render only.
  - `AttachObserverAsync` (lines 98-113) imports the module lazily (lines 102-103), creates the `DotNetObjectReference` (line 104), calls `observe` with the reference, the element and the id (line 105), and sets `_observing`. A `JSDisconnectedException` is swallowed (lines 108-112): during prerendering or circuit teardown there is no JS to talk to, and the list simply stops at the pages already loaded rather than failing the render.
  - `DisposeAsync` (lines 61-96) suppresses finalization, guards re-entry with `_disposed`, calls `unobserve` when it was observing (lines 76-79), disposes the module (line 81), tolerates both `JSDisconnectedException` and `JSException` (lines 84-91), and disposes the `DotNetObjectReference` in a `finally` (line 94) so the .NET side is released even if the JS side already went away.
  - The markup (`Components/InfiniteScrollSentinel.razor:4-13`) is a single `div` carrying the element reference, with the progress row rendered only while `IsLoading`. That row is `role="status" aria-live="polite" aria-busy="true"` (line 9), matching `PageLoadingState`'s politeness so a screen reader hears that more items are loading without the announcement interrupting reading.
  - The JS side is deliberately tiny: `observe` disconnects any prior observer for the id, creates an `IntersectionObserver` with `rootMargin: '200px'` and invokes `OnSentinelVisible` on intersection (`wwwroot/infinite-scroll.js:3-14`); `unobserve` disconnects and forgets the id (lines 16-22). The 200px margin is what makes the next page start loading slightly *before* the sentinel is on screen.
- **Why it's built this way**: extracting just the observer is what lets a page keep its own cards, empty state and error state and still get infinite scroll (lines 10-13). The alternative, folding the behavior into the list component, would force any page that wants infinite scroll to also adopt that component's layout.
- **Where it's used**: ADC's public speaker list renders it below the card grid while more pages exist, wiring `OnVisible` to its own loader and passing a localized loading label (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/PublicSpeakerList.razor:144-145`, inside [`PublicSpeakerList`](group-21-conference-ui.md#publicspeakerlist)). Covered by [`InfiniteScrollSentinelTests`](group-27-testing-infrastructure.md#infinitescrollsentineltests).

### LayoutSettings

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/LayoutSettings.cs:9` · Level 0 · class (sealed)

- **What it is**: the three strings that make the shared shell look like a specific application: the navbar brand text, an optional brand logo URL, and the footer text.
- **Depends on**: nothing first-party. `System.Diagnostics.CodeAnalysis.SuppressMessage` (BCL) for one analyzer waiver, and the `Microsoft.Extensions.Options` binder at registration time.
- **Concept introduced, a settings section as a bound options class.** `[Rubric §10, Cross-Cutting Concerns]` (assesses whether configuration is centralized and typed rather than read ad hoc) and `[Rubric §20, Design System and Theming]` (assesses whether the look of the app is expressed once rather than repeated per page). The shape repeats across every settings class in this namespace: a `public static readonly string SectionName` naming the configuration section (line 12), `init`-only properties with compiled-in defaults, and one `services.AddOptions<T>().Bind(configuration.GetSection(T.SectionName))` call in `AddUIShared` (`DependencyInjection.cs:39-40`). Because every property has a default, an absent section is not an error: the host simply gets the compiled-in values. Components then take `IOptions<LayoutSettings>` and read `.Value`, so nothing in the shell parses configuration itself.
- **Walkthrough**:
  - `SectionName = "Layout"` (line 12).
  - `BrandName` (line 15) defaults to `"MMCA"`. `NavMenu` renders it as the brand link's text and folds it into the link's localized accessible name (`Layout/NavMenu.razor:18`, `:26`).
  - `FooterText` (line 18) defaults to `string.Empty`, and `MainLayout` renders the footer block only when it is non-blank (`Layout/MainLayout.razor:72-76`). An empty default therefore means "no footer", not "an empty footer".
  - `BrandLogoUrl` (line 30) defaults to empty, which renders the text-only brand. When set, `NavMenu` emits an `img` beside the brand text with `alt=""` and `aria-hidden="true"` (`Layout/NavMenu.razor:22-24`): the image is decorative because the brand link already carries its own accessible name, so alt text here would only repeat it to a screen reader (lines 20-24). The property carries a `[SuppressMessage]` for CA1056 (lines 26-29) whose justification records why it is a `string` and not a `Uri`: the value is usually a host-relative path such as `/img/logo.svg`, which `System.Uri` cannot represent without `RelativeOrAbsolute` round-tripping.
- **Why it's built this way**: the shell ships in the framework package, so the only way a consuming app can brand it without forking is configuration. Keeping the branding in `appsettings.json` also means a deployment can rebrand without a rebuild.
- **Where it's used**: injected as `IOptions<LayoutSettings>` by `Layout/NavMenu.razor:12` and `Layout/MainLayout.razor:11`. Configured by every UI host, for example `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:15-18`. Covered by [`NavMenuTests`](group-27-testing-infrastructure.md#navmenutests).

### NotificationBellOptions

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/NotificationBellOptions.cs:12` · Level 0 · class (sealed)

- **What it is**: the two numbers that define how stale the unread-notification badge is allowed to be: how often it re-reads the API, and how old its count may be before a navigation re-reads it.
- **Depends on**: nothing first-party. `TimeSpan` (BCL). Bound with the same options shape [`LayoutSettings`](#layoutsettings) introduces.
- **Concept introduced, staleness as a stated policy.** `[Rubric §19, State Management]` (assesses whether client-side state has an explicit freshness contract) and `[Rubric §31, Cost and FinOps]` (assesses whether the design lets an operator trade money against latency). Both numbers are host decisions rather than compiled constants: a deployment paying per API call widens the poll, one where an unread count must feel instant narrows it (lines 6-10). The framing in the doc comment is important for reading the code: the periodic read is the **backstop** behind the real-time push, not the primary path, so `PollInterval` is the budget for "how long a missed push may go unnoticed" (lines 17-21).
- **Walkthrough**:
  - `SectionName = "NotificationBell"` (line 15).
  - `PollInterval` (line 22), default 30 seconds. [`NotificationBell`](#notificationbell) builds its `PeriodicTimer` from it (`Components/Notifications/NotificationBell.razor.cs:92`), against the injected clock rather than the ambient one.
  - `NavigationRefreshMaxAge` (line 29), default 30 seconds. On a page change the bell accepts the count it already holds unless it is older than this window (`NotificationBell.razor.cs:155`, via `State.IsStale(...)`). That is what keeps a user clicking through five pages in ten seconds from issuing five reads of a number that has not moved (lines 24-28).
- **Why it's built this way**: both values are pure policy with no correct universal answer, so they belong in configuration; and because both have defaults, a host that says nothing keeps the framework's chosen 30-second budgets.
- **Where it's used**: bound in `AddUIShared` (`DependencyInjection.cs:47-48`) and injected as `IOptions<NotificationBellOptions>` by [`NotificationBell`](#notificationbell) (`Components/Notifications/NotificationBell.razor.cs:36`). Covered indirectly by [`NotificationBellTests`](group-27-testing-infrastructure.md#notificationbelltests).

### PseudoLocalizer

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoLocalizer.cs:20` · Level 0 · class (static)

- **What it is**: a pure string transform that "pseudo-localizes" text. It accents every letter, pads the result by roughly 40% to simulate real-translation expansion, and wraps it in `[!! ... !!]` bracket sentinels, while leaving composite-format placeholders (`{0}`, `{name}`) byte-identical so the string can still be formatted with arguments ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) §8).
- **Depends on**: `System.Text.StringBuilder` and `char.IsLetter` (BCL). Nothing first-party. It is consumed by [`PseudoStringLocalizer`](#pseudostringlocalizer).
- **Concept introduced, pseudo-localization as an i18n fitness test.** `[Rubric §27, Internationalization]` (assesses whether the app is genuinely translation-ready, not just wired for one extra language) and `[Rubric §28, Front-End Testing]` (assesses whether i18n defects are caught automatically). Pseudo-localization is a development-time technique that surfaces three classes of bug in a single visual pass, without needing a real second translation, and the `<remarks>` block (`PseudoLocalizer.cs:12-19`) enumerates exactly those three: (1) any string that stays plain ASCII was **hard-coded** rather than pulled from a resource, and stands out beside the accented text; (2) any UI that **truncates** the padded text has a fixed-width layout that a real (longer) translation would break; (3) any label built by **concatenating fragments** shows one sentinel per fragment, exposing the joins that translate badly.
- **Walkthrough**:
  - Three constants (lines 22-24): `OpenSentinel = "[!! "`, `CloseSentinel = " !!]"`, and `CombiningAcute` (the combining acute accent code point) appended after each base glyph so the letter stays readable while visibly altered.
  - `Transform(string value)` (lines 30-74): returns null/empty input unchanged (lines 32-35); pre-sizes a `StringBuilder` with slack for the padding (line 37) and appends the open sentinel (line 38); then walks each character in a `switch` (lines 42-66) tracking an `insidePlaceholder` flag toggled by `{` and `}` (lines 46-53) so placeholder bodies are copied verbatim, and for every letter *outside* a placeholder appends the combining accent and increments a `letters` counter (lines 54-64); finally computes the pad length as `Math.Max(1, letters * 2 / 5)` (about 40%, line 69), appends a separating space (line 70), that many `~` characters (line 71) and the close sentinel (line 72), and returns the string (line 73).
- **Why it's built this way**: keeping the transform **pure and static** (input string to output string, no culture check inside) makes it trivially unit-testable and lets the *culture gating* live one layer up in [`PseudoStringLocalizer`](#pseudostringlocalizer). Preserving `{...}` placeholders is essential: transforming them would corrupt `string.Format`, so pseudo-loc must accent the template and only then substitute arguments (see the two-step in `PseudoStringLocalizer`).
- **Where it's used**: called by [`PseudoStringLocalizer`](#pseudostringlocalizer) on every resolved string when the current UI culture is the pseudo locale ([`SupportedCultures.PseudoLocale`](group-12-api-hosting-mapping.md#supportedcultures), referenced in the doc comment at line 10); inert otherwise. Covered by [`PseudoLocalizationTests`](group-27-testing-infrastructure.md#pseudolocalizationtests).

### QrErrorCorrectionLevel

> MMCA.Common.UI · `MMCA.Common.UI.Components` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/QrErrorCorrectionLevel.cs:9` · Level 0 · enum

- **What it is**: the four QR error-correction strengths the framework's QR components expose. Higher levels survive more damage or occlusion but pack fewer characters into the same module count, so the code grows denser (lines 4-5).
- **Depends on**: nothing. It is a bare enum with no using directives.
- **Concept introduced, a framework-owned enum instead of a re-exported vendor type.** `[Rubric §9, API and Contract Design]` (assesses whether a public surface is expressed in types the owner controls) and `[Rubric §32, Dependency and Supply-Chain]` (assesses whether third-party types leak into contracts consumers must compile against). The doc comment states the decision outright (lines 6-7): declaring this rather than exposing QRCoder's own `ECCLevel` keeps the component's public API from pinning consumers to the encoder package. The mapping to the vendor type is a private detail of the component, a one-line `switch` in `Components/QrCodeImage.razor:77-82`, so replacing the encoder would not be a breaking change for any page that names this enum.
- **Walkthrough**: four members with explicit values and a stated recovery budget each: `Low = 0` (line 12, about 7% recovery, densest code, short payloads on clean screens), `Medium = 1` (line 15, about 15%, the usual screen and print trade-off), `Quartile = 2` (line 18, about 25%, printed sheets that may get scuffed) and `High = 3` (line 21, about 30%, codes overlaid with a logo or scanned in poor light). The explicit values matter because the enum is bound as a component parameter and compared for change detection.
- **Why it's built this way**: the recovery percentages are properties of the QR standard, not of the encoder, so documenting them on a framework enum keeps the decision (how much damage must this code survive?) at the call site where the physical context is known.
- **Where it's used**: `QrCodeImage` takes it as a parameter defaulting to `Medium` (`Components/QrCodeImage.razor:36`) and maps it to `QRCodeGenerator.ECCLevel` before encoding (`:77-82`); `QrCodeButton` defaults to `Quartile` (`Components/QrCodeButton.razor:65`). ADC passes `Medium` explicitly on the attendee badge (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/CheckIn/MyBadge.razor:36`) and the speaker QR page (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerQr.razor:29`). Covered by [`QrCodeImageTests`](group-27-testing-infrastructure.md#qrcodeimagetests).

### UIModuleConfiguration

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/UIModuleConfiguration.cs:10` · Level 0 · class (static)

- **What it is**: a one-method helper that answers "is this UI module enabled in this host?" by reading `Modules:{moduleName}:Enabled` from configuration, defaulting to enabled when nothing is configured.
- **Depends on**: `Microsoft.Extensions.Configuration.IConfiguration` (`GetSection`, `Exists`, `GetValue`). Nothing first-party, which is what lets a host call it before any DI registration has happened.
- **Concept introduced, composing a UI host from configuration.** `[Rubric §7, Microservices Readiness]` (assesses whether the same codebase can be deployed as different subsets) and `[Rubric §10, Cross-Cutting Concerns]`. The server-side module system registers [`IModule`](group-14-module-system-composition.md#imodule) implementations in topological order; the UI side has its own analogue, [`IUIModule`](#iuimodule), registered by each module's `AddXUI()` extension ([ADR-067](https://ivanball.github.io/docs/adr/067-ui-module-shell-composition.html)). This helper is the gate in front of those calls: a host that switches a module off never calls `AddXUI()`, so no `IUIModule` descriptor is registered, and the shell composes without that module's routes, nav entries or services. The default-on behavior (lines 7-8) is a compatibility choice: a host with no `Modules` section behaves exactly as it did before the section existed.
- **Walkthrough**: `ModulesSectionName = "Modules"` (line 12) and `IsModuleEnabled(IConfiguration configuration, string moduleName)` (lines 18-22). It walks two section levels, `Modules` then the module name (line 20), and returns `!section.Exists() || section.GetValue("Enabled", true)` (line 21). Read carefully, that is two independent defaults: an absent module entry is enabled, and a present entry missing the `Enabled` key is also enabled. Only an explicit `false` turns a module off.
- **Why it's built this way**: a static helper over `IConfiguration` (rather than a bound options class) is what makes it usable at the exact point it is needed, inside `Program.cs`/`MauiProgram.cs` before the service provider exists. Keeping the check in the framework rather than hand-rolling `builder.Configuration["Modules:X:Enabled"]` per host is what keeps the default-on semantics identical across all six heads.
- **Where it's used**: all six UI hosts gate their module registrations with it. ADC: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:79-89`, `MMCA.ADC.UI.Web.Client/Program.cs:59-68`, `MMCA.ADC.UI/MauiProgram.cs:125-134` (Identity, Conference, Engagement, Notification). Store: `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:120-126`, `MMCA.Store.UI.Web.Client/Program.cs:51-57`, `MMCA.Store.UI/MauiProgram.cs:83-89` (Catalog, Sales, Identity). The corresponding configuration block is `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:9-14`.

### UiReadCacheOptions

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/UiReadCacheOptions.cs:13` · Level 0 · class (sealed)

- **What it is**: the client-side staleness policy for [`IUiReadCache`](#iuireadcache): a master on/off switch, a default freshness budget, and per-route-prefix overrides.
- **Depends on**: nothing first-party. `TimeSpan` and `Dictionary<string, TimeSpan>` (BCL), plus the options binder at registration.
- **Concept introduced, client-side freshness as a recorded decision.** `[Rubric §19, State Management]` (assesses whether cached client state has an explicit lifetime), `[Rubric §12, Performance and Scalability]` and `[Rubric §31, Cost and FinOps]`. The doc comment states the intent precisely (lines 6-11): the point of writing staleness into configuration is that it becomes a decision a host records, rather than an accident of how often a component happens to re-render. This is the client-side analogue of the server caching strategy ([ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html)) applied to the entity data-access contract ([ADR-094](https://ivanball.github.io/docs/adr/094-client-entity-data-access.html)).
- **Walkthrough**:
  - `SectionName = "UiReadCache"` (line 16).
  - `Enabled` (line 24), default `true`. Setting it false turns every lookup into a miss and every store into a no-op (lines 19-22), so the services behave exactly as they would with no cache registered. The cache honors it on both paths (`Services/Caching/UiReadCache.cs:36`, `:74`), which is the framework's escape hatch for a host that wants no client-side staleness at all.
  - `DefaultTtl` (line 32), default 60 seconds, applied to any read whose URL matches no configured prefix. The comment records the reasoning for the number (lines 27-31): short enough that a stale list corrects itself within one user's attention span, long enough to collapse the burst of identical reads a page issues while it mounts.
  - `RoutePrefixTtls` (line 41), a getter-only `Dictionary<string, TimeSpan>` keyed by the leading part of a relative URL (for example `countries`). Getter-only is deliberate: the configuration binder populates the instance the defaults created, which is how bindable collections are shaped across this namespace (lines 37-39). **The longest matching prefix wins**, so a specific child route can state a stricter budget than the endpoint above it whatever order configuration enumerates in; that resolution is implemented in `UiReadCache.ResolveTtl` (`Services/Caching/UiReadCache.cs:120-135`).
- **Why it's built this way**: a single global TTL would force one budget on reference data that changes hourly and on lists that change constantly, so the per-prefix table is what makes one cache usable for both. Longest-match rather than first-match removes any dependence on configuration ordering, which JSON does not guarantee.
- **Where it's used**: bound in `AddUIShared` (`DependencyInjection.cs:44-45`) and injected into [`UiReadCache`](#uireadcache) (`Services/Caching/UiReadCache.cs:18`, snapshotted to a field at `:27`). Covered by [`UiReadCacheTests`](group-27-testing-infrastructure.md#uireadcachetests).

### WebApplicationExtensions

> MMCA.Common.UI · `MMCA.Common.UI.Extensions` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Extensions/WebApplicationExtensions.cs:8` · Level 0 · class (static)

- **What it is**: a one-method middleware extension for Blazor Server / WASM hybrid hosts. `UseAuthenticatedNoStore()` emits `Cache-Control: no-store` on HTML responses to **authenticated** users, so a logged-out user pressing Back never sees the previous logged-in HTML.
- **Depends on**: `Microsoft.AspNetCore.Builder.IApplicationBuilder`, `HttpContext.User`, and `HttpResponse.OnStarting` (ASP.NET Core). Nothing first-party.
- **Concept introduced, the browser back-forward cache (bfcache) as an auth-leak boundary.** `[Rubric §26, Front-End Security]` (assesses whether the front end avoids leaking authenticated content and treats the browser as hostile storage) and `[Rubric §23, Front-End Performance]` (assesses render and navigation cost; bfcache is a *performance* feature this deliberately gives up, but only where it is unsafe). A browser's bfcache restores a full DOM snapshot of a previous page on Back without issuing a request, so no server authorization check runs. Emitting `no-store` on a response makes that page bfcache-ineligible: Back re-requests it and the server re-renders under the current (possibly signed-out) identity. The scoping is the interesting part: anonymous pages keep their bfcache eligibility because the guard is `context.User.Identity?.IsAuthenticated is true` (line 30), and non-HTML responses (JSON, static assets, the Blazor framework files) are skipped by the `text/html` content-type check (lines 31-32), so nothing but authenticated pages pays the cost.
- **Walkthrough**: a static class holding a single C# `extension(IApplicationBuilder app)` block (line 10), the same `extension(T)` preview syntax the framework uses for DI registration (see [primer](00-primer.md)).
  - `UseAuthenticatedNoStore()` (lines 24-44) registers an inline `app.Use((context, next) => ...)` middleware (line 26).
  - It does **not** inspect the response at request time: it hooks `context.Response.OnStarting` (line 28), the callback the server invokes just before the first byte of the response is written. That is what makes reading `context.User` and `context.Response.ContentType` meaningful, both are populated by then even though this middleware sits *ahead* of the authentication middleware in the pipeline.
  - When both conditions hold it sets `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` plus the HTTP/1.0-era `Pragma: no-cache` (lines 34-35), then returns `Task.CompletedTask` (line 37).
  - The middleware returns `next()` immediately (line 40), and the extension returns `app` (line 43) so it chains in the usual `app.UseX().UseY()` shape.
- **Why it's built this way**: an `IApplicationBuilder` extension is the idiomatic ASP.NET Core registration shape, and the `OnStarting` hook is what allows a single narrow registration to make an after-the-fact decision (was this response authenticated? was it HTML?) instead of duplicating the check at every page. The remarks (lines 19-23) state the one ordering constraint: register it **before** `MapRazorComponents` so it wraps every page response.
- **Where it's used**: both Blazor Web hosts call it once: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:131` and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:171`.
- **Caveats / not-in-source**: whether a given browser honors `no-store` as bfcache-ineligibility is browser behavior, not code, and cannot be verified from this source. This type is distinct from the same-named [`WebApplicationExtensions`](group-12-api-hosting-mapping.md#webapplicationextensions) in the API layer; they share a name across assemblies, not an implementation.

### ApiSettings

> MMCA.Common.UI · `MMCA.Common.UI.Common.Settings` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/ApiSettings.cs:9` · Level 1 · class (sealed)

- **What it is**: the bound implementation of [`IApiSettings`](#iapisettings): the `"Api"` configuration section, validated at startup so a host with no API endpoint fails immediately instead of at the first request.
- **Depends on**: [`IApiSettings`](#iapisettings) (the read-only contract it implements) and `System.ComponentModel.DataAnnotations.RequiredAttribute` (BCL).
- **Concept introduced, fail-fast configuration.** `[Rubric §10, Cross-Cutting Concerns]` and `[Rubric §15, Best Practices and Code Quality]`. The class is three lines of data, but the behavior lives in how it is registered: `AddOptions<ApiSettings>().Bind(...).ValidateDataAnnotations().ValidateOnStart()` (`DependencyInjection.cs:33-36`). `ValidateDataAnnotations` turns the `[Required]` attribute into an options validator, and `ValidateOnStart` runs that validator during host startup rather than lazily on first resolution, so a missing `Api:ApiEndpoint` surfaces as an `OptionsValidationException` naming the key before the host accepts traffic ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)). That is what licenses the null-forgiving `apiSettings.ApiEndpoint!` in the client factory (`DependencyInjection.cs:91`): the validator, not a local check, is the guarantee.
- **Walkthrough**:
  - `SectionName = "Api"` (line 12), the same convention every settings class here uses.
  - `[Required] public string? ApiEndpoint { get; init; }` (lines 15-16). Nullable so the binder can leave it unset, `[Required]` so leaving it unset fails validation. `init`-only, so a bound instance is immutable after construction.
  - `WasmApiEndpoint { get; init; }` (line 19) carries `<inheritdoc />` and no `[Required]`: it is optional at the contract level, and each host decides whether an absent value is acceptable.
- **Why it's built this way**: `sealed` plus `init` gives an immutable snapshot of configuration that cannot drift while the app runs. Putting the validation attribute on the options class rather than writing a guard in the `HttpClient` factory keeps one failure mode with one message: the comment at `DependencyInjection.cs:83-87` records that a second hand-written check would only give the same failure a different, less informative exception.
- **Where it's used**: bound in `AddUIShared` (`DependencyInjection.cs:33-36`); read by the named `"APIClient"` `HttpClient` factory to set `BaseAddress` (`DependencyInjection.cs:88-91`, alongside the 90-second total-request timeout at `:97`); read by [`ApiFileDownloadButton`](#apifiledownloadbutton) for its browser download URL (`Components/ApiFileDownloadButton.razor.cs:93`); and served to the WebAssembly client by each Server head's `/client-config` endpoint (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:145-158` and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:185-191`).

### PseudoStringLocalizer

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoStringLocalizer.cs:13` · Level 1 · class (sealed)

- **What it is**: an `IStringLocalizer` decorator that pseudo-localizes every resolved string, but *only* when the current UI culture is the pseudo locale; under every other culture it delegates unchanged to the wrapped localizer, so it is inert in production ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) §8).
- **Depends on**: [`PseudoLocalizer`](#pseudolocalizer) (the transform, Level 0), [`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures) (its `IsPseudoLocale` from `MMCA.Common.Shared.Globalization`), and `IStringLocalizer`/`LocalizedString`/`CultureInfo` (BCL and NuGet). Constructed with an `inner` `IStringLocalizer` via a primary constructor (line 13).
- **Concept introduced, the decorator that gates on culture.** `[Rubric §2, Design Patterns]` (assesses idiomatic use of patterns; this is a textbook **Decorator**, same interface in and out, wrapping behavior around a delegate) and `[Rubric §27, Internationalization]`. The key design move is that pseudo-localization is a *cross-cutting* transform applied to the localizer, not to any call site: because it implements `IStringLocalizer` and forwards to `inner`, it can be slid underneath every `IStringLocalizer<T>` in the app at once by decorating the *factory* ([`PseudoStringLocalizerFactory`](#pseudostringlocalizerfactory)), with zero changes to consumers.
- **Walkthrough**:
  - `IsPseudoActive` (lines 16-17), a private static bool that returns [`SupportedCultures.IsPseudoLocale`](group-12-api-hosting-mapping.md#supportedcultures)`(CultureInfo.CurrentUICulture.Name)`, the single gate every member checks.
  - `this[string name]` (lines 20-29): resolves `inner[name]` (line 24), then, if pseudo is active, returns a new `LocalizedString` whose value is [`PseudoLocalizer.Transform`](#pseudolocalizer)`(localized.Value)` while preserving `ResourceNotFound`/`SearchedLocation` (line 26); otherwise returns the inner value untouched (line 27).
  - `this[string name, params object[] arguments]` (lines 32-48): when pseudo is inactive, delegates straight to `inner[name, arguments]` (lines 36-39); when active it does the **two-step** that makes placeholders survive, transform the *raw template* first (lines 43-44), then `string.Format` the accented template with the arguments (line 45), so the substituted values are never accented or padded.
  - `GetAllStrings(bool includeParentCultures)` (lines 51-57): maps the transform over every string when active (line 55), passes them through otherwise (line 56).
- **Why it's built this way**: gating inside the decorator (rather than conditionally registering it) keeps DI wiring unconditional and simple, the decorator is always present and simply does nothing outside the pseudo locale, which per the doc comment (lines 10-11) is never an activatable request culture in production. Splitting the pure transform ([`PseudoLocalizer`](#pseudolocalizer)) from the culture-aware decorator keeps each single-responsibility and independently testable (`[Rubric §1, SOLID]`).
- **Where it's used**: produced by [`PseudoStringLocalizerFactory`](#pseudostringlocalizerfactory) around every localizer the inner factory creates, so it transparently wraps `IStringLocalizer<`[`SharedResource`](#sharedresource)`>`, `IStringLocalizer<`[`MudTranslations`](#mudtranslations)`>`, and every other localizer in the host.

### ResxMudLocalizer

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/ResxMudLocalizer.cs:17` · Level 1 · class (sealed, internal)

- **What it is**: MudBlazor's `MudLocalizer` implementation that resolves the library's built-in component text from the [`MudTranslations`](#mudtranslations) resource pair, so MudBlazor chrome (pager, filter menus, pickers, close buttons) follows the active UI culture ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Depends on**: `MudBlazor.MudLocalizer` (the abstract base, NuGet), `IStringLocalizer<MudTranslations>` (injected via primary constructor, line 17), and [`MudTranslations`](#mudtranslations) (Level 0). Nothing else first-party.
- **Concept introduced, adapting a third-party localization hook.** `[Rubric §2, Design Patterns]` (this is an **Adapter**, bridging MudBlazor's `MudLocalizer` contract to the ASP.NET Core `IStringLocalizer` world) and `[Rubric §27, Internationalization]`. MudBlazor exposes exactly one extension point for translating its built-in strings: subclass `MudLocalizer` and override its indexer. This adapter routes that indexer straight to `IStringLocalizer<MudTranslations>`. MudBlazor's own `DefaultLocalizationInterceptor` consults this localizer only for non-English cultures and falls back to its built-in English whenever the returned `LocalizedString.ResourceNotFound` is true (per the doc comment, `ResxMudLocalizer.cs:9-12`), so any untranslated key degrades gracefully.
- **Walkthrough**: a one-member class. `internal sealed class ResxMudLocalizer(IStringLocalizer<MudTranslations> localizer) : MudLocalizer` (line 17) with a single `public override LocalizedString this[string key] => localizer[key];` (line 19). The doc comment (lines 13-15) also notes that because resolution flows through the DI `IStringLocalizerFactory`, the [`PseudoStringLocalizerFactory`](#pseudostringlocalizerfactory) decorator applies here too, so under the development-only `qps-Ploc` culture MudBlazor's chrome pseudo-localizes alongside the application text.
- **Why it's built this way**: `internal` because it is pure host wiring no consumer needs to name; delegating to the injected `IStringLocalizer<MudTranslations>` reuses the exact same `.resx`/factory pipeline as app strings (one localization mechanism, not two), which is what lets pseudo-loc reach MudBlazor for free.
- **Where it's used**: registered as MudBlazor's `MudLocalizer` in `AddUIShared` via `services.TryAddTransient<MudBlazor.MudLocalizer, ResxMudLocalizer>()` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:73`). `TryAdd` is authoritative because `AddMudServices` does not register a `MudLocalizer` of its own (guarded by a DI-resolution test, per the comment at `DependencyInjection.cs:69-72`), regardless of host registration order. Covered by [`ResxMudLocalizerTests`](group-27-testing-infrastructure.md#resxmudlocalizertests).

### PseudoStringLocalizerFactory

> MMCA.Common.UI · `MMCA.Common.UI.Globalization` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoStringLocalizerFactory.cs:11` · Level 2 · class (sealed)

- **What it is**: an `IStringLocalizerFactory` decorator that wraps *every* localizer the inner factory produces in a [`PseudoStringLocalizer`](#pseudostringlocalizer), so decorating this one factory pseudo-localizes every `IStringLocalizer<T>` and `IStringLocalizer` in the host at once ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) §8).
- **Depends on**: [`PseudoStringLocalizer`](#pseudostringlocalizer) (Level 1) and `IStringLocalizerFactory`/`IStringLocalizer` (Microsoft.Extensions.Localization, NuGet). Constructed with the `inner` factory via a primary constructor (line 11).
- **Concept introduced, decorate the factory to reach every product.** `[Rubric §2, Design Patterns]` (Decorator applied at the *factory* level) and `[Rubric §10, Cross-Cutting Concerns]` (assesses whether cross-cutting behavior is injected in one place rather than scattered). Because `StringLocalizer<T>` resolves its backing localizer through the `IStringLocalizerFactory`, wrapping the factory means every localizer the DI container ever hands out is already pseudo-aware: no per-type registration, no consumer change. This is the same "decorate the boundary, not the callers" idea the CQRS pipeline uses (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)), applied to localization.
- **Walkthrough**: two forwarding overrides, each wrapping the inner factory's product:
  - `Create(Type resourceSource)` (lines 14-15): `new PseudoStringLocalizer(inner.Create(resourceSource))`, the path used by `IStringLocalizer<T>`.
  - `Create(string baseName, string location)` (lines 18-19): `new PseudoStringLocalizer(inner.Create(baseName, location))`, the path used by name-based localizers.
- **Why it's built this way**: registering the wrapper on the factory is the minimal, DI-idiomatic way to make pseudo-loc universal; combined with the culture gate inside [`PseudoStringLocalizer`](#pseudostringlocalizer), it can be registered **unconditionally** because it is inert under every non-pseudo culture, so production wiring is not conditional on environment (the registration comment, `DependencyInjection.cs:62-66`, says exactly that: the pseudo locale is only ever activatable in Development).
- **Where it's used**: registered via `services.Decorate<IStringLocalizerFactory, PseudoStringLocalizerFactory>()` (Scrutor) in `AddUIShared` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:67`), after `services.AddLocalization()` (line 60). Its reach includes MudBlazor chrome through [`ResxMudLocalizer`](#resxmudlocalizer), which resolves its `IStringLocalizer<MudTranslations>` through this same factory.

### MobileInfiniteScrollList<TItem>

> MMCA.Common.UI · `MMCA.Common.UI.Components` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/MobileInfiniteScrollList.razor.cs:20` · Level 3 · class (generic partial component)

- **What it is**: the mobile card list every list page falls back to on a narrow viewport. It owns the whole loop: an IntersectionObserver sentinel that asks for the next page, an accumulated item list rendered through a caller-supplied card template, a rendered-item cap that bounds DOM growth, generation-guarded supersession of in-flight fetches, and localized load-failure handling with a Retry button.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and its generic form (the fetch delegate's return type), [`IToastService`](#itoastservice), [`SharedResource`](#sharedresource) through `IStringLocalizer<SharedResource>`, [`ResultUiExtensions.LocalizedErrorMessage`](#resultuiextensions), the `EmptyState` component, and the shared `_content/MMCA.Common.UI/infinite-scroll.js` module it shares with [`InfiniteScrollSentinel`](#infinitescrollsentinel). Externals: `IJSRuntime`, `DotNetObjectReference`, `CancellationTokenSource`, MudBlazor primitives.
- **Concept introduced, generation-guarded supersession.** `[Rubric §19, State Management]` (assesses whether concurrent updates to client state have a defined winner) and `[Rubric §23, Front-End Performance]`. The hard problem in an infinite list is not fetching, it is what happens when the user changes the filter while a fetch is in flight. Cancellation alone is not enough: the fetch delegate is consumer-supplied and may ignore its `CancellationToken` entirely, so a superseded call can still complete successfully and try to append rows to a list that was cleared. The answer here is a monotonically increasing `_generation` counter (line 63). A load snapshots it before awaiting and discards its results if the value moved while it waited (lines 174-176, 192). The token cancellation is still issued (it stops work that *does* honor it), but the generation, not the token, is authoritative (lines 189-191). The second half of the pattern is that **the page counter is computed, not committed**: `targetPage = _currentPage + 1` (line 183) and `_currentPage` only advances on a successful, non-superseded completion (line 207), so a cancelled, failed or superseded fetch leaves nothing to compensate back and no page is ever re-requested (lines 180-182).
- **Walkthrough**:
  - Injected services (lines 22-24) and parameters (lines 26-53). `CardTemplate` is an `[EditorRequired]` `RenderFragment<TItem>` (line 28). `FetchPageResult` (line 38) is the fetch delegate in the shape every Result-returning UI service already has, `(page, pageSize, cancellationToken)` returning `Result<(IReadOnlyList<TItem> Items, int TotalItems)>`, which is [`IEntityService<TEntityDTO, TIdentifierType>`](#ientityservicetentitydto-tidentifiertype)`.GetPagedAsync` minus the filter and sort arguments. `PageSize` defaults to 10 (line 40), `MaxRenderedItems` to 500 (line 53).
  - State (lines 55-83): `_items`, `_totalCount`, `_currentPage`, `_generation`, the four render flags (`_isInitialLoad`, `_isLoadingMore`, `_hasMore`, `_loadError`), `_loadErrorMessage`, and the interop handles (`_sentinelRef`, `_jsModule`, `_dotNetRef`, `_observerId`, `_cts`, `_observerAttached`, `_disposed`).
  - `OnInitializedAsync` (lines 85-91) validates the delegate then loads page 1. `ValidateFetchParameter` (lines 98-105) throws an `InvalidOperationException` when `FetchPageResult` is null, deliberately *before* the load, so a misconfigured call site fails loudly instead of rendering as a load failure with a Retry button that can never succeed (lines 93-97).
  - `OnAfterRenderAsync` (lines 107-113) attaches the observer only once there are items to scroll past and the initial load is done (line 109). `AttachObserverAsync` (lines 115-129) and `DetachObserverAsync` (lines 131-146) import and call the same `observe`/`unobserve` module functions the sentinel component uses, tolerating `JSDisconnectedException` on both paths.
  - `OnSentinelVisible()` (lines 148-161), the `[JSInvokable]` entry point, early-returns when already loading, exhausted or disposed (lines 151-154), then loads on the renderer's context and re-renders.
  - `LoadNextPageAsync(bool isInitial)` (lines 163-245) is the core. It guards re-entry (lines 165-168), clears the error state (lines 171-172), snapshots the generation and publishes a fresh `CancellationTokenSource` (lines 176-178), computes `targetPage` (line 183), and awaits the delegate (line 187). After the await it checks disposal and generation (line 192), unwraps the `Result` with `TryGetValue` and routes a failure to `SetLoadFailed` (lines 197-203), and only then commits: advance the page, append the items, record the total (lines 207-209), and recompute `_hasMore` as `_items.Count < _totalCount && _items.Count < MaxRenderedItems` (line 213), which is where the DOM cap stops the loop. `OperationCanceledException` is swallowed as a normal supersession (lines 215-218); any other exception raises the generic failure, again only for the current generation (lines 219-227). The `finally` (lines 228-244) is careful about ownership: only the current generation may clear `_isLoadingMore` (a superseding reset already cleared it and may have set it again), and only the still-current `CancellationTokenSource` is disposed here (`ReferenceEquals`, line 237), because a resetter that took one over already cancelled and disposed it.
  - `SetLoadFailed` (lines 258-267) sets the inline error state and, on the initial load only, also raises a toast, because an initial failure renders as an empty state and the toast is otherwise the only signal the user gets (lines 247-251). The message comes from `failure?.LocalizedErrorMessage(L)` (line 261); a raw exception passes `null`, because exception text is neither translatable nor safe to surface (lines 253-257), and the generic resource string is used instead.
  - `ResetAsync()` (lines 279-315) is the public API a page calls when filters change. Order matters and is commented: bump the generation *first* so any in-flight fetch is already superseded (line 283), then cancel and dispose the stale token source (lines 285-292), then clear `_isLoadingMore` explicitly (lines 294-297, because the superseded load will not clear it), then reset the list and every flag (lines 299-305), detach the observer (lines 307-308), and reload from page 1 (lines 312-314).
  - `DisposeAsync` (lines 317-349) guards re-entry, cancels and disposes the token source, detaches the observer, disposes the JS module tolerating `JSDisconnectedException`, and disposes the `DotNetObjectReference`.
  - The markup (`Components/MobileInfiniteScrollList.razor:1-43`) renders one of three shapes: an indeterminate progress bar on the initial load (lines 3-6), `EmptyState` when the list came back empty (lines 7-10), or the keyed `MudCard` stack with the caller's template (lines 13-22). Below the cards it renders the sentinel `div` only while `_hasMore` (lines 24-34) and the inline error plus Retry button when a later page failed (lines 36-42).
- **Why it's built this way**: the component encapsulates the part of infinite scroll that is genuinely hard to get right (supersession, cancellation ownership, disposal, the DOM cap) and leaves the part that is app-specific (what a card looks like, where the data comes from) to parameters. The `Result`-returning delegate rather than a raw `Task<List<T>>` is what makes a *localized* failure message reachable without the component knowing any error catalogue.
- **Where it's used**: the mobile branch of nearly every list page. ADC: `SessionList.razor:56`, `SpeakerList.razor:41`, `SponsorList.razor:41`, `RoomList.razor:41`, `EventList.razor:31`, `ActivityList.razor:41`, `QuestionList.razor:27`, `ConferenceCategoryList.razor:27`, the public views `PublicSessionListView.razor:6` and `PublicEventList.razor:23`, the check-in `AttendeeSearchPanel.razor:27`, and `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/User/UserList.razor:27`. Store: `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/Order/OrderList.razor:26` and `Pages/ShoppingCart/ShoppingCartList.razor:19`. It is also exercised in the component gallery (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Pages/ComponentsGallery.razor:57`) and covered by [`MobileInfiniteScrollListTests`](group-27-testing-infrastructure.md#mobileinfinitescrolllisttests).
- **Caveats / not-in-source**: `MaxRenderedItems` bounds the DOM but there is no virtualization, so 500 rendered cards remain in the DOM; whether that is acceptable on a given device is not determinable from source. A consumer fetch delegate that ignores its `CancellationToken` still runs to completion after a reset: the generation guard discards its results, but the request itself is not stopped.

### MoneyExtensions

> MMCA.Common.UI · `MMCA.Common.UI.Extensions` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Extensions/MoneyExtensions.cs:14` · Level 5 · class (static)

- **What it is**: the presentation-layer formatter for money, turning a [`Money`](group-02-domain-building-blocks.md#money) value object into `$12.50 USD` and a collection of them into a per-currency range such as `$10.00 - $25.00 USD`.
- **Depends on**: [`Money`](group-02-domain-building-blocks.md#money) and its [`Currency`](group-02-domain-building-blocks.md#currency) (both `MMCA.Common.Shared.ValueObjects`), plus `CultureInfo.InvariantCulture` and `StringComparer.Ordinal` (BCL).
- **Concept introduced, formatting lives in the UI layer, not the value object.** `[Rubric §3, Clean Architecture]` (assesses whether presentation concerns stay out of the inner layers: `Money` knows amounts and currencies, it does not know what a price *looks like*) and `[Rubric §20, Design System and Theming]` (assesses consistent presentation of a recurring data shape; one formatter means every price on every page reads the same). It also shows the C# `extension(T)` preview syntax used for something other than DI: two blocks, one on `Money` and one on `IReadOnlyCollection<Money>`, sit in a single static class so both spellings (`price.ToDisplayString()` and `prices.ToDisplayRange()`) are available from one `using`.
- **Walkthrough**:
  - The class carries a file-level `[SuppressMessage("Naming", "CA1708")]` (lines 10-13): with two or more `extension(T)` blocks in one static class, CA1708 flags the compiler-generated grouping members as case-colliding. The justification records that no user-visible identifier differs only by case, a known analyzer trap of the preview syntax.
  - `extension(Money price)` (lines 16-21) exposes `ToDisplayString()` (lines 19-20), which delegates to `FormatGroup(price.Amount, price.Amount, price.Currency.Code)`: passing the same value as both bounds is what makes the shared helper render a single price rather than a degenerate range.
  - `extension(IReadOnlyCollection<Money> prices)` (lines 23-47) exposes `ToDisplayRange()` (lines 32-46): returns `string.Empty` for an empty collection (lines 34-37), then groups by `Currency.Code` with `StringComparer.Ordinal` (line 42) and formats each group from its own min and max (line 43), joining the groups with `", "` (line 45). Grouping is the load-bearing detail: a mixed-currency collection renders one range per currency, each with its own symbol, instead of collapsing unrelated amounts under whichever currency appeared first. The inline comment (lines 39-40) notes `GroupBy` preserves first-appearance order, so the single-currency case (every collection in practice today) is unchanged.
  - `Symbol(string code)` (lines 54-59), a private switch mapping `"USD"` to `$` and `"EUR"` to the escaped euro sign (line 57, escaped to keep the source file ASCII-only). Every other code, **including the empty code of the `Currency.None` sentinel behind `Money.Zero()`** (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Currency.cs:23`, `Money.cs:142`), renders with no symbol rather than falsely claiming dollars.
  - `FormatGroup(decimal min, decimal max, string code)` (lines 65-73), the single formatting path: `"N2"` with `CultureInfo.InvariantCulture` (lines 69-70) so two decimals and a thousands separator render identically regardless of server locale, a single price when `min == max` and a hyphen-separated range otherwise (line 68), and the trailing code appended only when it is non-empty (line 72).
- **Why it's built this way**: presentational formatting belongs above the domain, so `Money` stays display-agnostic and the same value can be rendered differently by a different head. `InvariantCulture` is a deliberate choice over `CurrentCulture`: prices are shown with an explicit ISO code (`USD`), so a locale-dependent decimal separator would produce `$12,50 USD` and read as an error. The empty-symbol fallback and the per-currency grouping are both "render the truth" decisions: never imply a currency the data does not carry.
- **Where it's used**: Store's Sales and Catalog UIs. `ToDisplayString()` renders order totals and line amounts (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/Order/OrderLinesPanel.razor:34`, `:39`, `:51`; `Pages/Order/OrderSummaryPanel.razor:54`; `Pages/Order/OrderList.razor:36`, `:102`) and the cart's order-created snackbar (`Pages/ShoppingCart/ShoppingCartDetail.razor.cs:354`); `ToDisplayRange()` renders the price span across a product's variants in catalog browse (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/Pages/Catalog/CatalogBrowse.CardFormatting.razor.cs:38`, with the single-price helper alongside it at `:41`) and on the catalog product detail page (`Pages/Catalog/CatalogProductDetail.razor.cs:266`, `:269`). Covered by [`MoneyExtensionsTests`](group-27-testing-infrastructure.md#moneyextensionstests).
- **Caveats / not-in-source**: only `USD` and `EUR` have symbols; adding a currency means editing `Symbol`, there is no configuration-driven table. The `"N2"` format assumes a two-minor-unit currency, so a zero-decimal currency (JPY) would render two spurious decimals; no code guards that today.

### CachedPage

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/OfflineFirstPageSnapshot.cs:26` · Level 0 · record (sealed, private, nested)

- **What it is**: the on-disk shape of an offline list snapshot, a two-field record `(List<TItem> Items, int TotalItems)` nested privately inside [`OfflineFirstPageSnapshot<TItem>`](#offlinefirstpagesnapshottitem). It is what actually gets serialized when a list page remembers its first page for a dead network.
- **Depends on**: nothing first-party. It is round-tripped through [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore), whose `SetAsync`/`GetAsync<T>` do the JSON work (`OfflineFirstPageSnapshot.cs:43-44`, `:63`).
- **Concept introduced, the private nested cache payload.** `[Rubric §19, State Management & Data Flow]` assesses whether client-held state has an explicit, owned shape rather than being smeared across ad-hoc dictionaries; `[Rubric §29, Resilience & Business Continuity]` assesses whether a surface degrades instead of failing when a dependency is gone. Declaring the payload as a `private sealed record` inside the only type that reads and writes it makes the snapshot format an implementation detail: no consumer can take a dependency on the field names, so the shape can change without a public-API break. The trade-off is the flip side of that: because the format is private and unversioned, a shape change silently orphans whatever is already in the device store.
- **Walkthrough**: one line. `private sealed record CachedPage(List<TItem> Items, int TotalItems);` (line 26). Written by `RememberAsync`, which materializes the fetched rows into a fresh list with a collection expression, `new CachedPage([.. fetched.Items], fetched.TotalItems)` (line 44), so the cached copy is decoupled from the caller's live list. Read back by `TryReadAsync` as `store.GetAsync<CachedPage>(cacheKey, cancellationToken)` (line 63) and immediately destructured into the tuple the grid expects, `(cached.Items, cached.TotalItems)` (line 64).
- **Why it's built this way**: a `record` gives value semantics and a positional constructor for free, which is all a serialization payload needs; `List<TItem>` rather than `IReadOnlyList<TItem>` is the concrete collection the round-trip materializes into. Nesting it privately keeps the type out of the package's public surface entirely.
- **Where it's used**: only inside [`OfflineFirstPageSnapshot<TItem>`](#offlinefirstpagesnapshottitem). Its round-trip is covered end to end by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Common/OfflineFirstPageSnapshotTests.cs:14`.
- **Caveats / not-in-source**: the doc comment states that `TItem` "must be JSON round-trippable" (`OfflineFirstPageSnapshot.cs:13`), but nothing in this file enforces that; a DTO the store's serializer cannot handle fails at runtime, not at compile time.

### ErrorMessages

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/ErrorMessages.cs:24` · Level 0 · class (static)

- **What it is**: a small factory of user-facing failure strings (load, save, delete, delete-failed, not-found, validation) so every page code-behind reports an outcome with identical, culture-correct phrasing, resolved through a shared localizer once one is configured ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Depends on**: `IStringLocalizer` / `LocalizedString` (Microsoft.Extensions.Localization, NuGet) and `string.Format` with `CultureInfo.CurrentCulture` (BCL). No first-party types at all. The localizer it is handed is an `IStringLocalizer<SharedResource>` (doc comment, `ErrorMessages.cs:32`), so it shares the [`SharedResource`](#sharedresource) `.resx` keys.
- **Concept introduced, the static helper back-filled with an injected localizer, and the "never show raw exception text" rule.** `[Rubric §27, Internationalization]` assesses whether user-facing copy resolves per UI culture from resources instead of being hard-coded English; `[Rubric §16, Maintainability]` assesses whether a wording change lands in one place; `[Rubric §24, Forms, Validation & UX Safety]` assesses that internal error text never leaks to the user. The mechanism is the interesting part: the API is `static`, so any page can call `ErrorMessages.LoadError(Title, ex)` without taking a DI dependency, yet the output is culture-aware because the root layout hands the class one shared localizer at startup. Every method routes through a private `Localize(key, fallbackFormat, args)` that returns the resource value when the localizer is set and the key resolves, and the inline English format string otherwise. The scope note in the class comment (lines 14-22) is what pins the responsibility boundary: a server answer reaches a page as a `Result` and is rendered by [`ResultUiExtensions`](#resultuiextensions) (`NotifyOnFailure`, `OnFailureSetError`), so these helpers only cover the exceptions a page can still see, which are its own faults (a JS-interop failure, a mapping bug, a callback the page supplied). Such an exception's `Message` is never rendered: raw exception text is neither localizable nor safe to surface ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) Decision 9).
- **Walkthrough**: one mutable static field plus pure builders.
  - `_localizer` (line 26), a nullable `IStringLocalizer?`, null until configured.
  - `Configure(IStringLocalizer localizer)` (line 33), the single wiring point: an expression-bodied assignment, idempotent, called once from the root layout.
  - `Localize(key, fallbackFormat, args)` (lines 35-47), the resolution core: when `_localizer` is set and the lookup's `ResourceNotFound` is false it returns `localized.Value` (lines 37-44); otherwise `string.Format(CultureInfo.CurrentCulture, fallbackFormat, args)` (line 46).
  - `LoadError`/`SaveError`/`DeleteError` (lines 56-57, 60-61, 64-65), the three CRUD failure paths, keyed `Common.Error.Load`/`Save`/`Delete`. Each passes the entity name **and** `ex.Message` as format arguments, and the shipped templates deliberately ignore the second one (doc comment, lines 49-55), so the exception text is available to a resource that wants it while the shipped copy never prints it. The two siblings carry `<inheritdoc cref="LoadError"/>` (lines 59, 63) rather than repeating the rationale.
  - `DeleteFailed(string entityName)` (lines 67-68, key `Common.Error.DeleteFailed`), the "the call returned but the delete did not happen" case, distinct from `DeleteError`, which carries an exception.
  - `NotFound(string entityName, object id)` (lines 70-71, key `Common.Error.NotFound`), interpolating the entity name and the missing id.
  - `ValidationError` (lines 73-74, key `Common.Error.Validation`), a parameterless property and the only fixed sentence.
- **Why it's built this way**: keeping the API static means call sites never move, while the `Configure` indirection adds localization without a signature change anywhere. The uniform "template only" answer is what makes the class safe to call from any `catch`: there is no branch on exception type, so no curated-message path can accidentally become a leak path. The mutable static is a deliberate, single exception to the framework's no-static-state rule and is named explicitly in the architecture fitness allowlist (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/StateManagementConventionTests.cs:22`, with the reasoning at lines 16-21: write-once wiring, not per-user state).
- **Where it's used**: configured once per host by `ErrorMessages.Configure(L)` in the root layout (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/MainLayout.razor:103`). Called by [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) on the two non-`Result` failure paths (`DataGridListPageBase.cs:570` paged, `:665` virtualized, `:767` mobile), by `NotificationSend` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationSend.razor.cs:103`), and by the Store entity pages for `NotFound` and `ValidationError` (for example `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/Pages/Product/ProductDetail.razor.cs:99` and `:200`).
- **Caveats / not-in-source**: the `.resx` payloads (`SharedResource.resx`, `SharedResource.es.resx`) are resources, not `.cs`, so per-key contents are not enumerable here; a shipped template that *did* consume `{1}` would print the exception text, and only the unit tests pin that it does not (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Common/ErrorMessagesTests.cs:11`, including the explicit case that even a `DomainInvariantViolationException` gets the plain template, `:45`).

### ForgotPasswordModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ForgotPasswordModel.cs:9` · Level 0 · class (sealed)

- **What it is**: the `EditForm` backing model for the Forgot Password page: one `Email` string carrying DataAnnotations for shape validation. Nothing else is collected, because nothing else is needed to start a reset.
- **Depends on**: `System.ComponentModel.DataAnnotations` (BCL): `[Required]`, `[EmailAddress]`. Nothing first-party.
- **Concept introduced, validation deliberately capped at "shape" because of an anti-enumeration contract.** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether a form gives a clear per-field verdict before submit; `[Rubric §26, Front-End Security]` assesses whether the front end avoids leaking information the back end withholds. Every other form in this group validates as much as it can client-side. This one stops at "is this a syntactically valid address", because the interesting question, does an account exist for it, is one the server refuses to answer: [ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) Decision 3 has the reset request succeed on every path (malformed address, no account, throttled, failed send), so a distinguishable client-side outcome would reintroduce exactly the account-enumeration oracle the endpoint exists to avoid. The doc comment (`ForgotPasswordModel.cs:5-8`) states that trade-off directly.
- **Walkthrough**: one `get; set;` property. `Email` (line 13) carries `[Required(ErrorMessage = "Email is required")]` and `[EmailAddress(ErrorMessage = "Enter a valid email address")]` (lines 11-12) and defaults to `string.Empty`.
- **Why it's built this way**: `sealed` and mutable (`set`, not `init`) because `EditForm` two-way-binds the input to the model; keeping the model to one field is what makes the page's anti-enumeration behavior easy to reason about, since there is no second field whose validation could betray a lookup.
- **Where it's used**: instantiated as `_model` by `ForgotPassword.razor` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ForgotPassword.razor:66`) and bound by its `<EditForm Model="_model" OnValidSubmit="HandleRequestAsync">` plus `<DataAnnotationsValidator />` (lines 34-35), with the field wired `For="@(() => _model.Email)"` (line 37) so the message attaches to that input. On valid submit `HandleRequestAsync` (lines 75-92) calls [`IAuthUIService`](#iauthuiservice)`.RequestPasswordResetAsync(_model.Email)` (line 81, contract at `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/IAuthUIService.cs:55`) inside a `try` whose `catch` is empty on purpose (lines 83-86) and whose `finally` sets `_isSubmitted = true` unconditionally (line 90), so the confirmation renders for every submitted address whether the call succeeded, failed, or threw.
- **Caveats / not-in-source**: `RequestPasswordResetAsync` returns a `Result` and the call site never inspects it (line 81); the comment block above the method (lines 70-74) records that this is the anti-enumeration rule rather than a dropped result. The gallery E2E suite pins the behavior by asserting the confirmation appears with no backend at all (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/ForgotPasswordPageE2ETests.cs:28`), with WCAG 2.1 AA scans on both the form and the confirmation state (`:41`, `:50`).

### LoginModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/LoginModel.cs:9` · Level 0 · class (sealed)

- **What it is**: the `EditForm` backing model for the Login page: two string properties (`Email`, `Password`) carrying DataAnnotations for field-level validation.
- **Depends on**: `System.ComponentModel.DataAnnotations` (BCL): `[Required]`, `[EmailAddress]`. Nothing first-party.
- **Concept introduced, the form-backing model plus `DataAnnotationsValidator`.** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether forms validate at the field level with clear inline messages before submit; `[Rubric §26, Front-End Security]` assesses that client-side checks are a UX convenience, not the trust boundary. A Blazor `EditForm` binds to a plain model, a `<DataAnnotationsValidator />` reads the attributes and surfaces a per-field message as the user types, and the submit handler only fires on a valid form. The doc comment (`LoginModel.cs:5-8`) is explicit that the server remains the authority on whether the credentials are actually valid: the form only prevents an obviously malformed request.
- **Walkthrough**: two `get; set;` properties.
  - `Email` (line 13), `[Required(ErrorMessage = "Email is required")]` plus `[EmailAddress(ErrorMessage = "Enter a valid email address")]` (lines 11-12), defaulting to `string.Empty`.
  - `Password` (line 16), `[Required(ErrorMessage = "Password is required")]` (line 15). There is deliberately no complexity rule here: login validates an *existing* credential, not a new one, and rejecting a legacy password client-side would lock a user out of their own account.
- **Why it's built this way**: `sealed` and mutable because `EditForm` two-way-binds each input; the messages are authored inline so each field shows exactly one verdict.
- **Where it's used**: instantiated as `_model` and bound by `Login.razor` (`<EditForm Model="_model" OnValidSubmit="HandleLoginAsync">` plus `<DataAnnotationsValidator />`, `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:33-34`, field at line 159, inputs bound `For="@(() => _model.Email)"` and `For="@(() => _model.Password)"` at lines 40 and 46 so each `MudTextField` shows its own message). On valid submit the page hands the credentials to [`IAuthUIService`](#iauthuiservice) as a [`LoginRequest`](group-08-auth.md#loginrequest) (`Login.razor:204`). Sibling of [`RegisterModel`](#registermodel); its shape rules are unit-tested alongside the other auth models in `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Auth/AuthModelValidationTests.cs:11`.

### MudTranslations

> MMCA.Common.UI · `MMCA.Common.UI.Resources` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Resources/MudTranslations.cs:10` · Level 0 · class (sealed)

- **What it is**: an empty marker class that anchors a `.resx` resource pair for **MudBlazor's own built-in component text**: the data-grid pager and filter menus, pickers, table editing, pagination, snackbar and alert close buttons, and input adornments ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Depends on**: nothing first-party. The type has no members: it is the single declaration `public sealed class MudTranslations;` (line 10). Its meaning comes from its co-located resources, whose keys mirror MudBlazor's own `LanguageResource` keys (v9.6.0) with the English values copied verbatim so en-US behavior is unchanged, and from [`ResxMudLocalizer`](#resxmudlocalizer), which injects `IStringLocalizer<MudTranslations>` and hands those strings to MudBlazor's localization interceptor.
- **Concept reinforced, the resource-anchor type.** The idiom is introduced in full at [`SharedResource`](#sharedresource): ASP.NET Core's `IStringLocalizer<T>` resolves keys against the `.resx` whose base name matches `T`, so a dedicated empty class becomes the *name* of a shared string table. `MudTranslations` is the second anchor, scoped to third-party chrome rather than app chrome. `[Rubric §27, Internationalization]` assesses whether *all* user-visible copy follows the active culture, including the component library's; `[Rubric §20, Design System & Theming]` assesses a coherent design system, and a pager that still reads "Rows per page" under an `es` UI would break that coherence at exactly the surface the user interacts with most.
- **Walkthrough**: there are no members. The whole contract is "be a public sealed type named `MudTranslations` in this namespace, with sibling `.resx` files whose keys match MudBlazor's `LanguageResource`". The doc comment (lines 3-9) records the verbatim-English-mirror invariant.
- **Why it's built this way**: MudBlazor exposes exactly one extension point for translating its built-in strings (an injectable `MudLocalizer`), and it needs some resource base to read from. A separate anchor keeps the library's keys in their own table, mirroring the upstream names one to one, cleanly apart from the app's own [`SharedResource`](#sharedresource) chrome. This is the [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) way to translate a dependency you do not own.
- **Where it's used**: injected as `IStringLocalizer<MudTranslations>` by [`ResxMudLocalizer`](#resxmudlocalizer), which `AddUIShared` registers as MudBlazor's `MudLocalizer` via `TryAddTransient` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:73`). Because resolution flows through the DI `IStringLocalizerFactory`, the [`PseudoStringLocalizerFactory`](#pseudostringlocalizerfactory) decorator registered at `DependencyInjection.cs:67` reaches these strings too.
- **Caveats / not-in-source**: the `.resx` files and their per-key match to MudBlazor v9.6.0's `LanguageResource` are resources, not `.cs`; individual key contents are not enumerated here.

### PasswordComplexityAttribute

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/PasswordComplexityAttribute.cs:12` · Level 0 · class (sealed attribute)

- **What it is**: a custom `ValidationAttribute` that enforces the framework's password-strength rule on any form that sets a new password: at least 8 characters including an uppercase, a lowercase, a digit, and a special (non-alphanumeric) character.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`ValidationAttribute`, `ValidationResult`, `ValidationContext`) and `char.IsUpper`/`IsLower`/`IsDigit`/`IsLetterOrDigit` (BCL). Nothing first-party.
- **Concept introduced, extending DataAnnotations with a domain rule.** `[Rubric §24, Forms, Validation & UX Safety]` assesses client-side validation parity with the server. Beyond the built-in `[Required]` and `[EmailAddress]`, a bespoke rule subclasses `ValidationAttribute` and overrides `IsValid`, which plugs it straight into the same `DataAnnotationsValidator` that drives the rest of the form. The doc comment (lines 5-9) states the intent: mirror the server's rule so the `EditForm` gives the same verdict the API would. What happens to an accepted password server-side (PBKDF2-HMAC-SHA512 hashing with legacy-hash compatibility) is [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html); this attribute is only the client-side gate, never the security boundary.
- **Walkthrough**:
  - `[AttributeUsage(AttributeTargets.Property, AllowMultiple = false)]` (line 11), so it is applied as `[PasswordComplexity]` on a single property.
  - The constructor (lines 14-17) seeds the base `ErrorMessage` with the full human-readable rule, so a form that does not override the message still shows something actionable.
  - `IsValid(object?, ValidationContext)` (lines 19-39): returns `ValidationResult.Success` for a non-string or a null/empty input (lines 21-24), deliberately deferring the "missing" message to `RequiredAttribute` so the field shows one message rather than two. Otherwise it evaluates five predicates in one boolean (`Length >= 8`, `Any(char.IsUpper)`, `Any(char.IsLower)`, `Any(char.IsDigit)`, `Any(c => !char.IsLetterOrDigit(c))`, lines 26-30) and, on failure, returns a `ValidationResult` scoped to the member name (lines 37-38) so the message attaches to the right input.
- **Why it's built this way**: because the rule is an attribute rather than page code, a second form that sets a password gets identical behavior by adding one line, which is exactly how the reset vertical picked it up. Delegating emptiness to `[Required]` is what keeps one field from stacking two errors.
- **Where it's used**: applied to `RegisterModel.Password` ([`RegisterModel`](#registermodel), `RegisterModel.cs:22`) and to `ResetPasswordModel.NewPassword` ([`ResetPasswordModel`](#resetpasswordmodel), `ResetPasswordModel.cs:20`); evaluated by the `<DataAnnotationsValidator />` in `Register.razor` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Register.razor:28`) and `ResetPassword.razor` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ResetPassword.razor:36`).
- **Caveats / not-in-source**: the doc comment (line 6) still describes the attribute as the rule "for the Register form" although the reset form carries it too; the code is the wider truth. The comment also claims parity with the server's rule, but this file encodes only the client check, so whether the server rule is byte-identical is not verifiable from this source.

### PersistedGridState

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:1034` · Level 0 · record (sealed, private, nested)

- **What it is**: a tiny serializable record `(List<TDto> Items, int TotalItems)` that carries the grid's already-fetched rows from the SSR pre-render pass into the interactive circuit, so the first interactive `ServerData` call can answer instantly instead of re-hitting the API.
- **Depends on**: `Microsoft.AspNetCore.Components.PersistentComponentState` (the Blazor mechanism that serializes it). Nested privately inside [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto).
- **Concept introduced, `PersistentComponentState` to skip the double fetch.** `[Rubric §19, State Management & Data Flow]` and `[Rubric §23, Front-End Performance & Rendering]` assess whether redundant work is avoided across render-mode transitions. Under InteractiveAuto a page renders more than once (static SSR, then interactive Server, then WebAssembly), and naively each transition re-runs the data fetch, which the user sees as a fetch-cancel-refetch flicker. Blazor's `PersistentComponentState` serializes chosen data into the pre-rendered HTML and rehydrates it in the interactive circuit; `PersistedGridState` is the payload for the grid's data slice, so that cycle disappears.
- **Walkthrough**: declared as `private sealed record PersistedGridState(List<TDto> Items, int TotalItems)` (line 1034) at the very bottom of the file, under a doc comment (lines 1030-1033). On the persisting side, the callback registered in `OnInitialized` writes `new PersistedGridState([.. _lastSuccessfulGridData.Items], _lastSuccessfulGridData.TotalItems)` (line 189) under the key `grid:{GetType().FullName}` (built at line 171), and only when a successful fetch has actually happened (line 187). On the restoring side, the synchronous `OnInitialized` calls `ApplicationState.TryTakeFromJson<PersistedGridState>(persistKey, out var restored)` (line 172) and, when present, rebuilds a `GridData<TDto>` into `_persistedGridData` (line 174) that the first `LoadServerDataAsync` returns directly (lines 513-522).
- **Why it's built this way**: `private` because the persistence is purely an implementation detail of the base class; a `sealed record` for JSON friendliness and value semantics; the items are materialized into a fresh `List<TDto>` with a collection expression (line 189) so the persisted snapshot is decoupled from the live grid data.
- **Where it's used**: exclusively inside [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto), so every derived list page inherits the behavior with no wiring of its own.
- **Caveats / not-in-source**: the persisting callback is registered with an explicit `Microsoft.AspNetCore.Components.Web.RenderMode.InteractiveAuto` (line 194) to satisfy the framework's "callback must be associated with a render mode" rule during the static prerender pass, because the page inherits its render mode from `<Routes @rendermode="InteractiveAuto">` rather than declaring one itself; the inline comment (lines 177-183) quotes the exact framework error this avoids. The restore runs in the **synchronous** `OnInitialized`, before any async lifecycle work.

### RegisterModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/RegisterModel.cs:9` · Level 0 · class (sealed)

- **What it is**: the `EditForm` backing model for the Register page: name, email, and password fields with DataAnnotations, plus six optional address fields.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`[Required]`, `[EmailAddress]`, `[Compare]`) and the sibling first-party [`PasswordComplexityAttribute`](#passwordcomplexityattribute).
- **Concept reinforced, multi-field form validation with a cross-field compare.** `[Rubric §24, Forms, Validation & UX Safety]`. This builds on the [`LoginModel`](#loginmodel) shape with three richer rules: `[PasswordComplexity]` on the password, `[Compare(nameof(Password))]` on the confirmation (a cross-field equality check the validator resolves by property name), and an address block left attribute-free because it is optional. The doc comment (lines 5-8) notes the annotations mirror the server's rules so client and server agree.
- **Walkthrough**:
  - `FirstName` / `LastName` (lines 12, 15), each `[Required]` with its own message (lines 11, 14).
  - `Email` (line 19), `[Required]` plus `[EmailAddress]` (lines 17-18).
  - `Password` (line 23), `[Required]` plus `[PasswordComplexity]` (lines 21-22).
  - `ConfirmPassword` (line 27), `[Required]` plus `[Compare(nameof(Password), ErrorMessage = "Passwords do not match")]` (lines 25-26).
  - `AddressLine1` plus nullable `AddressLine2`/`City`/`State`/`ZipCode`/`Country` (lines 30-35), with no validation attributes; the inline comment (line 29) states that an empty Line 1 means "no address supplied".
- **Why it's built this way**: the address fields stay attribute-free so a user can register without supplying one; the model is a flat view-model that the page projects onto the wire DTO at submit time rather than reusing a domain type directly, which is what lets the optional-address rule live in page code instead of leaking into the contract.
- **Where it's used**: instantiated as `_model` and bound by `Register.razor` (`<EditForm Model="_model" OnValidSubmit="HandleRegisterAsync">` plus `<DataAnnotationsValidator />`, `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Register.razor:27-28`, field at line 123). On valid submit the page projects it into a [`RegisterRequest`](group-08-auth.md#registerrequest) (`Register.razor:162`), folding the address fields into an [`Address`](group-02-domain-building-blocks.md#address) through `BuildAddressResult()`, which returns `null` when all six are blank (lines 132-138) and otherwise calls `Address.Create(...)` (line 140). Its password block is mirrored by [`ResetPasswordModel`](#resetpasswordmodel); the accepted password is hashed server-side per [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html). Rendering and validation behavior are covered by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Auth/RegisterFormTests.cs` and the gallery E2E suite (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/RegisterPageE2ETests.cs`).

### ResetPasswordModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ResetPasswordModel.cs:10` · Level 0 · class (sealed)

- **What it is**: the `EditForm` backing model for the Reset Password page: the address and the emailed reset token that identify the request, plus the new password and its confirmation.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`[Required]`, `[EmailAddress]`, `[Compare]`) and the sibling first-party [`PasswordComplexityAttribute`](#passwordcomplexityattribute).
- **Concept reinforced, the same password block as registration, on a credential-carrying form.** `[Rubric §24, Forms, Validation & UX Safety]` and `[Rubric §26, Front-End Security]`. The password half is exactly the shape [`RegisterModel`](#registermodel) introduced, which is the payoff of expressing the complexity rule as an attribute rather than page code. What is new is the top half: `Email` and `Token` are not values the user chooses, they are the credential the server minted and mailed. The client validates only that both are present and that the address is well formed; every substantive rejection (unknown, expired, mismatched, or attempt-capped token) collapses into one server-side error by design ([ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) Decision 3), so the form must not try to pre-judge a token it cannot verify.
- **Walkthrough**: four `get; set;` properties, each defaulting to `string.Empty`.
  - `Email` (line 14), `[Required(ErrorMessage = "Email is required")]` plus `[EmailAddress(ErrorMessage = "Enter a valid email address")]` (lines 12-13).
  - `Token` (line 17), `[Required(ErrorMessage = "Reset token is required")]` (line 16) and nothing more: length, encoding, and freshness are all properties of the server-side cache record.
  - `NewPassword` (line 21), `[Required]` plus `[PasswordComplexity]` (lines 19-20).
  - `ConfirmPassword` (line 25), `[Required]` plus `[Compare(nameof(NewPassword), ErrorMessage = "Passwords do not match")]` (lines 23-24), the cross-field check retargeted at `NewPassword`.
- **Why it's built this way**: the doc comment (lines 5-9) records the load-bearing choice, that `Email` and `Token` arrive prefilled from the reset link but stay **editable**, so a user who only has the raw token text from the email (the situation on a native head with no working deep link) can paste it by hand. Making those two ordinary bound fields rather than read-only parameters buys that fallback for free.
- **Where it's used**: instantiated as `_model` by `ResetPassword.razor` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/ResetPassword.razor:95`) and bound by its `<EditForm Model="_model" OnValidSubmit="HandleResetAsync">` plus `<DataAnnotationsValidator />` (lines 35-36). The page declares `[SupplyParameterFromQuery]` `Email` and `Token` properties (lines 89-93) and copies them into the model in `OnParametersSet` (lines 102-113), filling a field **only when it is still blank** (lines 104, 109) so a value the user corrected by hand is not overwritten when parameters are set again. `HandleResetAsync` (lines 115-140) calls [`IAuthUIService`](#iauthuiservice)`.ResetPasswordAsync(_model.Email, _model.Token, _model.NewPassword)` (line 122, contract at `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/IAuthUIService.cs:62`), flips `_isCompleted` on success, and on failure renders `result.LocalizedErrorMessage(L)` or the generic `Auth.Reset.GenericError` string (line 129). The prefill path is pinned by a gallery E2E test (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/ResetPasswordPageE2ETests.cs:31`), with a WCAG 2.1 AA scan alongside it (`:43`).
- **Caveats / not-in-source**: the model has no rule tying `Token` to the address; that pairing is enforced by the server's cache record ([ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html) Decision 1), not by anything visible here.

### SharedResource

> MMCA.Common.UI · `MMCA.Common.UI.Resources` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Resources/SharedResource.cs:9` · Level 0 · class (sealed)

- **What it is**: an empty marker class that anchors `IStringLocalizer<SharedResource>` over its co-located `.resx` files, the single home for cross-cutting UI chrome strings ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Depends on**: nothing first-party. The type is empty: `public sealed class SharedResource;` (line 9). Its meaning comes from the co-located resources `SharedResource.resx` (the English default) and `SharedResource.es.resx` (Spanish), named in the doc comment (line 7), and from the ASP.NET Core localization stack that binds `IStringLocalizer<T>` to the `.resx` named after `T`.
- **Concept introduced, the resource-anchor type.** `[Rubric §27, Internationalization]` assesses whether user-facing copy is externalized to per-culture resources keyed stably rather than hard-coded. ASP.NET Core's `IStringLocalizer<T>` convention resolves keys against the resource file whose base name matches the type `T`, so a dedicated empty class becomes the *name* that ties many components to one shared string table: injecting `IStringLocalizer<SharedResource>` anywhere reads the same dotted, stable keys (`Common.Error.Load`, `Grid.Snackbar.LoadCancelled`, `Auth.Sessions.Title`). The doc comment (lines 3-8) enumerates the chrome it covers: buttons, layout labels, snackbar and error templates, and the culture- and theme-switcher text. Its counterpart for library chrome is [`MudTranslations`](#mudtranslations).
- **Walkthrough**: there are no members. The whole contract is "be a public sealed type named `SharedResource` in this namespace, with sibling `.resx` files". The work lives in the key/value pairs and in the localization middleware that resolves them by culture.
- **Why it's built this way**: a marker type is the idiomatic ASP.NET Core way to scope a shared resource table without inventing a real class, and one anchor keeps the chrome strings in a single table every component shares ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Where it's used**: injected as `IStringLocalizer<SharedResource>` by [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) for its cancellation toast and its `Result` error rendering (`DataGridListPageBase.cs:25`), by [`Sessions`](#sessions) for every label on the devices page (`Sessions.razor.cs:31`), by the auth pages for their field labels and messages, and handed to [`ErrorMessages.Configure`](#errormessages) from the root layout (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Layout/MainLayout.razor:103`) so the static helper resolves the same table.
- **Caveats / not-in-source**: the `.resx` files are resources, not `.cs`; their per-key contents are not enumerated here.

### OfflineFirstPageSnapshot<TItem>

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/OfflineFirstPageSnapshot.cs:21` · Level 1 · class (sealed, generic)

- **What it is**: a small helper that keeps the last successful **first page** of a list on the device and hands it back when a fetch fails while the device is offline, so a dead venue network still shows content instead of an empty grid ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
- **Depends on**: [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore) and [`IConnectivityStatusService`](group-26-device-capability-layer.md#iconnectivitystatusservice), both taken through the primary constructor along with a `string cacheKey` (lines 21-24), plus the private nested [`CachedPage`](#cachedpage) payload. No external NuGet dependency at all.
- **Concept introduced, offline-first read-through with a deliberately tiny blast radius.** `[Rubric §29, Resilience & Business Continuity]` assesses whether a surface degrades gracefully when a dependency is unreachable; `[Rubric §19, State Management & Data Flow]` assesses where client-side state lives and who owns it; `[Rubric §22, Responsive & Cross-Browser]` applies because the behavior is head-dependent by design. The teaching point is how narrowly the fallback is scoped. Three conditions must all hold before a cached row is ever shown (`CanServe`, line 30): the device reports itself offline, the store is available on this head, and the grid asked for page 1. That means the live path is untouched: an online user never reads the cache, a paged-past-page-1 user never reads it, and a head with no local store (Blazor Server, where SSR always has the live API) never reads it because [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore) reports itself unavailable there. The class comment (lines 5-11) states exactly that contract.
- **Walkthrough**: three public members over a primary constructor.
  - `CanServe(int page)` (line 30): the single predicate, `!connectivity.IsOnline && store.IsAvailable && page == 1`. It is public so a caller can also use it as an exception filter, which is how the ADC consumer avoids swallowing a throw it has nothing to answer with.
  - `RememberAsync((IReadOnlyList<TItem> Items, int TotalItems) fetched, int page, CancellationToken)` (lines 36-46): writes only when `page == 1 && store.IsAvailable` (line 41), materializing a [`CachedPage`](#cachedpage) and handing it to `store.SetAsync(cacheKey, ..., cancellationToken)` (lines 43-44). Any other page is silently left alone, so a user who paged deep does not overwrite the snapshot of page 1 with page 7.
  - `TryReadAsync(int page, CancellationToken)` (lines 54-65): returns `null` immediately unless `CanServe(page)` (lines 58-61), then reads `store.GetAsync<CachedPage>(cacheKey, ...)` (line 63) and projects it back into the same tuple shape the fetch delegate returns (line 64), so the caller substitutes it without reshaping anything.
- **Why it's built this way**: it is a plain class constructed by the consuming service rather than a DI-registered singleton, because the `cacheKey` is per surface and cannot be resolved from the container. The doc comment on that parameter (lines 16-20) states the invariant plainly: the key must be unique per list surface (and per scope, when one head shows the same list for different tenants or events), since a shared key would let one page serve another page's rows. Returning `null` rather than an empty page keeps "nothing cached" distinguishable from "cached and genuinely empty", which is what lets the caller fall through to the real failure.
- **Where it's used**: composed by ADC's `PublicSessionScheduleService`, which builds one instance with a per-surface constant key (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/PublicSessionScheduleService.cs:26-29`) and wires all three members into one fetch: `RememberAsync` on every success (`:42`), a snapshot read when the live query returns a failed `Result` (`:49-50`), and `CanServe` as the exception filter on the guarded `catch` (`:52-59`) so a throw from the store itself is rethrown when there is nothing cached to answer with. Behavior is pinned by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Common/OfflineFirstPageSnapshotTests.cs:14`, including the per-key isolation case (`:97-98`).
- **Caveats / not-in-source**: the snapshot has no expiry, no size cap, and no versioning; how long a stale first page can be served is a property of [`ILocalCacheStore`](group-26-device-capability-layer.md#ilocalcachestore) and of the head's storage, not of this file. The class is best-effort by design: a store write failure inside `RememberAsync` is not caught here.

### DataGridListPageBase<TDto>

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:22` · Level 3 · class (abstract)

- **What it is**: the abstract Blazor base for every server-paged `MudDataGrid<TDto>` list page. It folds the otherwise copy-pasted concerns (cancellation lifecycle, loading and failure flags, mobile/desktop viewport detection, filter and sort extraction, error reporting, scroll tracking and restore, density toggle, URL plus session plus prerender state plumbing, an opt-in virtualization funnel, and disposal) into one reusable component: `class DataGridListPageBase<TDto> : ComponentBase, IBrowserViewportObserver, IAsyncDisposable, IDisposable` (line 22).
- **Depends on**: [`IToastService`](#itoastservice), [`SharedResource`](#sharedresource) (as `IStringLocalizer<SharedResource>`), [`ListPageState`](#listpagestate), [`ListPageStateService`](#listpagestateservice), [`ListPageQueryStateService`](#listpagequerystateservice), [`BreakpointConstants`](#breakpointconstants), [`ErrorMessages`](#errormessages), [`ResultUiExtensions`](#resultuiextensions) (`NotifyOnFailure`), [`Result`](group-01-result-error-handling.md#result), and the nested [`PersistedGridState`](#persistedgridstate). Externals: MudBlazor's `MudDataGrid<T>`, `GridState<T>`, `GridStateVirtualize<T>`, `GridData<T>`, `IBrowserViewportObserver` / `IBrowserViewportService`, and Blazor's `PersistentComponentState`, `NavigationManager`, `IJSRuntime`.
- **Concept introduced, a behavior-rich Blazor base component.** `[Rubric §18, UI Architecture & Component Design]` assesses reuse, and every list page in both apps inherits this behavior with no copy-paste. `[Rubric §23, Front-End Performance & Rendering]` assesses render and fetch cost: only the requested page is ever fetched, the prerender cache skips a redundant round trip, and the opt-in virtualization funnel keeps the DOM small for large sets. `[Rubric §19, State Management & Data Flow]` covers the four-channel persistence (URL, in-memory, sessionStorage, prerender cache). `[Rubric §27, Internationalization]` applies because the cancellation toast and every `Result` failure message resolve through [`SharedResource`](#sharedresource). `[Rubric §24, Forms, Validation & UX Safety]` shows up in the `LoadFailed` flag: a failed fetch renders zero rows, which is visually identical to a genuinely empty list once the error toast expires, so derived pages branch on the flag to show an inline error-with-retry instead of the "no records" empty state (documented at lines 35-41). Several hard-won defect fixes live here too, each with the diagnosis inline: the MudDataGrid v9 `RowsPerPage` setter that always resets `CurrentPage` (lines 470-473), the disposed-CTS race that stuck the `blazor-error-ui` banner (lines 781-785), and the stale-write race where a late grid-state save stamped grid parameters onto the *next* page's URL (lines 196-200), all of which were E2E-discovered, touching `[Rubric §28, Front-End Testing]`.
- **Walkthrough**, in teaching order:
  - **Injected services and abstract surface** (lines 24-31): [`IToastService`](#itoastservice) (line 24, the only `protected` one, so derived pages toast through the same abstraction), `IStringLocalizer<SharedResource>` (line 25), `IBrowserViewportService` (line 26), the two state services (lines 27-28), `NavigationManager` (line 29), `IJSRuntime` (line 30), `PersistentComponentState` (line 31). Derived pages supply the abstract `Title` (line 43) and may override `SaveFilters` / `RestoreFilters` (lines 114, 117), `GridRef` (line 127), `OnMobileDataRequestedAsync` (line 949), and the three virtualization knobs.
  - **Public and protected state** (lines 33-78): `IsLoading` (line 33), `LoadFailed` (line 42), `IsMobile` (line 46), the mobile card-view block `MobileItems` / `MobileTotalItems` / `MobileCurrentPage` / `MobilePageSize` (lines 49-52), the bindable `CurrentPageState` (line 59, 0-indexed), `RowsPerPageState` (line 69, defaulting to 10 to match MudDataGrid v9's own default), and `DenseGrid` (line 78).
  - **Constants** (lines 84, 88): `PrerenderFetchTimeoutMs = 5000` bounds the SSR fetch, and `VirtualizedScrollContainerSelector = ".mud-table-container"` records where a virtualized grid actually scrolls (the grid's own height-bound viewport, not the document).
  - **Private fields** (lines 90-105): the CTS, the `_disposed` guard, the scroll module and its `DotNetObjectReference`, the persistence subscription, the prerender caches `_persistedGridData` / `_lastSuccessfulGridData`, `_pendingScrollRestore`, the saved-state mirrors `_savedPage` / `_savedPageSize` / `_savedSortColumn` / `_savedSortDescending`, the re-entrancy and deferral flags, and a per-instance `_scrollTrackerId` GUID. The observer contract's `Id` and `ResizeOptions` (a 250 ms report rate) sit at lines 108 and 111; `_ownRoutePath`, the stale-write anchor, is declared later at line 934.
  - **The virtualization opt-in** (lines 140, 148, 156): `VirtualizeGrid` defaults to `false`, so every existing page keeps its pager untouched. A page that overrides it to `true` binds `Virtualize`, `Height="@VirtualizedGridHeight"` (default `70vh`), `ItemSize="VirtualizedItemSize"` (default 52, the comfortable-density row height) and `VirtualizeServerData` **instead of** `ServerData`: the doc comment (lines 129-139) records that MudBlazor v9 accepts only one of the two funnels and that binding both leaves the grid fetching through a pager it no longer renders. Turning it on also disables the pager-restore machinery, which has no meaning without a pager; sort, filter, and density persistence still apply.
  - `OnInitialized` (lines 165-246), synchronously: (a) restores any [`PersistedGridState`](#persistedgridstate) under the key `grid:{GetType().FullName}` (lines 171-175); (b) registers the persisting callback with an explicit `RenderMode.InteractiveAuto` (lines 184-194); (c) pins `_ownRoutePath` to this page's route (line 201); (d) reads the URL through [`ListPageQueryStateService`](#listpagequerystateservice) (line 203) and falls back to the in-memory [`ListPageStateService`](#listpagestateservice) snapshot when the URL carries no state (lines 207-214); (e) primes `CurrentPageState`, `RowsPerPageState`, `MobileCurrentPage`, sort, and `DenseGrid`, then calls `RestoreFilters` (lines 216-228) so the grid's *first* `ServerData` call already fetches the right page; (f) sets `_deferSessionPersist` when neither channel had state (line 234) and picks up a pending scroll position (lines 237-240); and (g) subscribes to `LocationChanged` (lines 242-243).
  - `OnLocationChanged` (lines 248-292): honors the one-shot `_suppressNextLocationChanged` flag (lines 250-254), reacts only to same-path back/forward navigation (a different path returns early and is handled by disposal, lines 258-262), re-reads the URL into the mirror fields (lines 264-275), then re-applies `CurrentPage` to the live grid through the BL0005-suppressed `ApplyCurrentPageFromUrl` (line 285, helper at lines 294-301) and reloads (line 288). The virtualized path skips the page re-apply entirely (lines 281-286), because there is no pager to move.
  - `NotifyBrowserViewportChangeAsync` (lines 304-317): the `IBrowserViewportObserver` callback, recomputing `IsMobile` from [`BreakpointConstants.IsMobileBreakpoint`](#breakpointconstants) (line 308) and, on a desktop-to-mobile transition only, resetting to page 1 and requesting mobile data (lines 310-314).
  - `OnAfterRenderAsync(firstRender)` (lines 325-382): on first render it hydrates session state now that interop is available (`HydrateFromSessionAsync`, line 333), runs the cross-circuit fallback (`needsSessionRestore` at line 339, `ApplyRestoredState` at line 343), clears the deferral (line 351), subscribes to viewport changes (line 353), imports `./_content/MMCA.Common.UI/list-page-scroll.js` (lines 355-357) and enables debounced (150 ms) scroll tracking through a `DotNetObjectReference` scoped to `ScrollContainerSelector` (lines 358-364), then calls `RestoreGridStateAsync` (line 366) and forces a sessionStorage sync (line 371). On every render it restores a pending scroll position once the grid has stopped loading (lines 375-379). JS calls back into `[JSInvokable] OnScrollPositionChanged` (lines 395-397), which updates only the scroll field so page, page size, and filters are untouched.
  - `RestoreGridStateAsync` (lines 442-482) is the single entry point for the pager-restore machinery, so virtualization opts out in **one** place (lines 448-456, still honoring a session-driven reload). Otherwise it forces `SetRowsPerPageAsync(_savedPageSize, resetPage: false)` when the parameter did not take (lines 465-468), then calls `RestoreCurrentPageAfterRowsPerPageReset` (lines 407-414) because the v9 setter clobbers `CurrentPage` to 0, and finally reloads when session hydration changed pagination after the grid's first fetch (lines 478-481).
  - `LoadServerDataAsync(state, fetchAsync, additionalFilters, showCancelSnackbar)` (lines 503-579), the paged path and the heart of the class. It resets the CTS (line 509); returns the prerender cache on the first interactive call, still saving state (lines 513-522); sets `IsLoading` and clears `LoadFailed` (lines 524-526); bounds the fetch with `CreateFetchCts` (line 533); extracts filters and sort **inside** the `try` (lines 540-543, because the caller's `additionalFilters` callback is arbitrary page code and a throw from it used to strand `IsLoading` at `true`, comment at lines 535-537); calls the delegate with a 1-based page number (line 545); and then branches on the `Result` rather than on an exception: a failed result goes to `fetched.NotifyOnFailure(Toast, Localizer)`, sets `LoadFailed`, and returns an empty grid (lines 546-551), while a success caches `_lastSuccessfulGridData` and calls `SaveCurrentState` (lines 553-555). `OperationCanceledException` maps to an empty grid plus an optional localized `Grid.Snackbar.LoadCancelled` toast (lines 558-565); any other exception maps to an empty grid plus [`ErrorMessages.LoadError`](#errormessages) and `LoadFailed = true` (lines 566-573); and `IsLoading` is always cleared in the `finally` (lines 574-578).
  - `LoadVirtualizedServerDataAsync(state, fetchAsync, additionalFilters, cancellationToken)` (lines 606-674), the `VirtualizeServerData` counterpart. It manages loading, failure, and error toasts identically, but maps the row window MudBlazor asks for onto the **same** page-based fetch delegate, so a page can switch to virtualization without a second API contract. When the requested window straddles two pages it fetches the following page too and concatenates (lines 640-651), then trims to exactly the requested count (line 654). Cancellation here is always silent (lines 658-662): a virtualized grid supersedes its own in-flight fetch on every scroll burst, so a cancel toast would fire continuously and say nothing actionable (remarks at lines 601-605). It also forwards MudBlazor's own per-window token into `CreateFetchCts` (line 621) so a superseded fetch stops at the API boundary.
  - `ComputeVirtualWindow(startIndex, count)` (lines 689-698), the pure arithmetic behind that mapping and the reason it is testable: the window's own size becomes the page size, so an aligned window is exactly one page and an unaligned one spills into the next (`offset > 0`). It is `internal static` precisely so the unit tests can drive it directly.
  - `CreateFetchCts(additionalToken)` (lines 710-721): links to the active `_cts`, plus the caller's token when one can be cancelled (lines 712-714), and during **non-interactive** prerender (`!RendererInfo.IsInteractive`, line 715) calls `CancelAfter(PrerenderFetchTimeoutMs)` so a cold or unreachable backend cannot block the page load indefinitely.
  - `LoadMobileDataAsync` (lines 727-777), the mobile-card equivalent with the same flag discipline and the same `Result` branch (lines 743-750); cancellation is silently swallowed (lines 761-764). Its `SaveCurrentState(0, 0, ...)` call is deliberate (comment at lines 755-758): persisting the mobile page size would overwrite the desktop grid's `RowsPerPage`, so a user who chose 50 rows and then narrowed the viewport would come back to 10.
  - `ResetCancellationTokenAsync` (lines 779-801): swaps in a fresh CTS **first** (lines 786-787) so the caller always has a valid token, then tears down the previous one, tolerating `ObjectDisposedException` (lines 796-799).
  - `ExtractGridFilters` (lines 813-826) flattens MudDataGrid's filter definitions into a one-entry-per-column dictionary, grouping by property name and letting the **newest** row win (line 822) rather than throwing on the duplicate key a second filter on the same column would produce; it takes the definition collection rather than the state object so the paged and virtualized funnels share one implementation (remarks at lines 808-812). `ExtractSortParameters` (lines 828-833) takes the first sort definition, and `ResolveSortParameters` (lines 840-852) adds the first-fetch fallback: when MudDataGrid has not yet picked up a `SortDefinition`, the sort restored from the query string is used, so the data lands sorted from the very first request.
  - `SaveCurrentState` (lines 854-891): guarded by `IsOwnRouteCurrent()` (line 858, the stale-write drop), it composes a new [`ListPageState`](#listpagestate) preserving the existing scroll position (lines 867-877) and writes it to all three channels: the in-memory service (line 878), the URL via `ReplaceState` with `_suppressNextLocationChanged` set first so it does not re-trigger its own handler (lines 882-883), and sessionStorage (lines 887-890), skipped during the deferred-hydration window.
  - `ToggleDensity` / `PersistDensity` (lines 898-903 and 911-931): flips `DenseGrid` and mirrors just that one field through the same three channels using a `with` expression on the existing state (line 921), under the same `IsOwnRouteCurrent` guard (line 914), so a density change made before the grid's first `ServerData` save is not lost.
  - **Route pinning**: `_ownRoutePath` (line 934), `GetRoutePath()` (line 936, falling back to the live URI only before initialization), and `IsOwnRouteCurrent()` (lines 942-943).
  - `CancelLoading` (line 951), the manual cancel hook a page can bind to a stop affordance.
  - `DisposeAsync` / `Dispose` (lines 954-997 and 999-1013): dispose the persistence subscription, unsubscribe `LocationChanged` (helper at lines 1015-1022), disable scroll tracking and dispose the JS module guarded against shutdown-time races (`JSDisconnectedException` / `JSException`, lines 972-979), dispose the `DotNetObjectReference` in a `finally` (line 982), unsubscribe the viewport observer best-effort (lines 985-992), and cancel plus dispose the CTS (lines 994-995). Both paths are `_disposed`-idempotent (lines 956-959, 1001-1002).
- **Why it's built this way**: every concern here was independently re-implemented (and re-broken) on individual pages before being lifted into one base, so a single fix now propagates to every list page at once. The four-channel persistence covers the full matrix of how a user can leave and return to a list: browser back, in-app navigation, refresh or `forceLoad`, and a shared link. The delegate signature deliberately mirrors [`IEntityService<TEntityDTO, TIdentifierType>`](#ientityservicetentitydto-tidentifiertype)`.GetPagedAsync` exactly (remarks at lines 497-502), so a page still passes a method group with no adapter, and the move to a `Result`-returning delegate means a server failure is handled on the same terms an exception used to be, with the API's own localized wording reaching the toast through [`ResultUiExtensions`](#resultuiextensions).
- **Where it's used**: base class for the list pages in both apps, including ADC's `UserList` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:16`) and `SessionList` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Session/SessionList.razor.cs:19`), and Store's `OrderList` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/Order/OrderList.razor.cs:19`), alongside the Catalog, Identity, and Engagement list pages. The virtualized funnel is exercised by the backend-less gallery page `GridGallery` (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Pages/GridGallery.razor:44`, `:50`), which the deploy-gating E2E suite uses to assert that far fewer rows render than the data set holds and that scrolling happens inside the grid's own viewport (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/GridPageE2ETests.cs:34`, `:52`, with a WCAG 2.1 AA scan at `:77`). The base's own behavior is covered by bUnit tests at `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Common/DataGridListPageBaseTests.cs:22`.
- **Caveats / not-in-source**: two `BL0005` suppressions (lines 294 and 407) set `grid.CurrentPage` from outside the component; the justification (MudDataGrid v9 exposes no public method for arbitrary-page navigation and the setter is well behaved) is inlined at both. The prerender optimization assumes a warm backend; under a cold one the prerender fetch times out at 5 s and the interactive pass refills the grid. The `list-page-scroll.js` module (`enableScrollTracking` / `setScrollPosition` / `disableScrollTracking`) is JavaScript under `wwwroot`, invoked here only by name, so its behavior is not verifiable from this `.cs` file. Note also that the route comparison is `Ordinal` in `OnLocationChanged` (line 259) but `OrdinalIgnoreCase` in `IsOwnRouteCurrent` (line 943); the source does not state why the two differ.

### ListPageActions

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Common` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/ListPageActions.cs:14` · Level 4 · class (static)

- **What it is**: two static helpers that every list page shares: reload whichever layout (mobile list or desktop grid) is currently rendered, and run the confirm-delete-toast-reload flow.
- **Depends on**: [`MobileInfiniteScrollList<TItem>`](#mobileinfinitescrolllisttitem), [`IToastService`](#itoastservice), [`Result`](group-01-result-error-handling.md#result), and the `DeleteConfirmation` dialog component (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/DeleteConfirmation.razor:27`). Externals: MudBlazor's `MudDataGrid<T>`.
- **Concept introduced, the shared page helper that stays out of the base class.** `[Rubric §16, Maintainability]` assesses whether a repeated flow exists once; `[Rubric §24, Forms, Validation & UX Safety]` assesses that destructive actions confirm first and that failures surface to the user. The placement argument is in the class comment (lines 8-13) and is the interesting part: these are kept as plain statics rather than members on [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) so that a page which composes its own layout, or holds several grids, can reuse them **without inheriting anything**. Inheritance would have forced every consumer into the base class's whole lifecycle just to get two flows.
- **Walkthrough**: two static methods.
  - `ReloadActiveLayoutAsync<TDto>(bool isMobile, MobileInfiniteScrollList<TDto>? mobileList, MudDataGrid<TDto>? dataGrid)` (lines 25-38). When the mobile layout is active and its ref is bound it calls `mobileList.ResetAsync()` (line 32); otherwise it calls `dataGrid.ReloadServerData()` when that ref is bound (line 36). Both refs are nullable **by design**: only one layout is in the render tree at a time, so the other `@ref` is genuinely null, which makes the null checks the mechanism rather than defensive noise (`[Rubric §22, Responsive & Cross-Browser]`).
  - `DeleteWithConfirmationAsync(...)` (lines 56-93) takes the page's `DeleteConfirmation` ref, the entity display name, a `Func<Task<Result>>` delete call, the toast service, a localized success message, a `Func<Result, string>` error mapper, and a reload callback. It guards every reference argument with `ArgumentNullException.ThrowIfNull` (lines 65-69), shows the dialog, and returns immediately unless the answer is exactly `true` (lines 71-75): a dialog dismissed with `null` is a cancel, not a confirm. On confirm it awaits the delete and branches on the `Result` (lines 79-87): a failure toasts the mapped error and returns without reloading, a success toasts and reloads. The single `catch (OperationCanceledException)` (lines 89-92) is swallowed with a comment naming the two causes, component disposal and the InteractiveAuto render-mode transition where a Server-rendered circuit is torn down as WebAssembly takes over.
- **Why it's built this way**: passing the localized strings and the error mapper in as parameters keeps this class free of any resource dependency, so each page supplies its own translated text ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)) while the flow itself stays identical everywhere. The `errorMessage` delegate is what lets a page choose between a fixed sentence and the API's own wording via `result.LocalizedErrorMessage(L)`, which the parameter doc (lines 50-54) spells out.
- **Where it's used**: sixteen list pages across both apps in current source. ADC calls both methods from Identity's `UserList` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:39`, `:77`), from Conference's `EventList`, `SessionList`, `SpeakerList`, `RoomList`, `QuestionList`, `ConferenceCategoryList`, `SponsorList`, `ActivityList`, `PublicEventList`, and `PublicSessionListView`, and from Engagement's `AttendeeSearchPanel` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/CheckIn/AttendeeSearchPanel.razor.cs:60`). Store calls them from `ProductList` (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/Pages/Product/ProductList.razor.cs:38`, `:72`, `:79`), `CategoryList`, `OrderList`, and `CustomerList`. Covered by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Common/ListPageActionsTests.cs:19`.
- **Caveats / not-in-source**: `DeleteWithConfirmationAsync` catches only `OperationCanceledException`; any other throw from the caller's `deleteAsync` or `reloadAsync` delegate propagates to the page's own handler, which is not visible from this file.

### Sessions

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Sessions.razor.cs:26` · Level 6 · class (partial, page code-behind)

- **What it is**: the code-behind for the signed-in devices page at `/profile/sessions`: one row per live refresh session, with a per-device sign-out and a sign-out-everywhere.
- **Depends on**: [`IAuthUIService`](#iauthuiservice) (line 28), [`IToastService`](#itoastservice) (line 30), [`SharedResource`](#sharedresource) as `IStringLocalizer<SharedResource>` (line 31), [`RefreshSessionSummaryResponse`](group-08-auth.md#refreshsessionsummaryresponse) (the row DTO, line 38), [`Result`](group-01-result-error-handling.md#result) (line 41), [`ResultUiExtensions`](#resultuiextensions) (`IsNotFound`, `NotifyOnFailure`), [`UserAgentSummary`](#useragentsummary) (line 181), and [`RoutePaths`](#routepaths) (line 65). Externals: Blazor's `NavigationManager` and MudBlazor's `BreadcrumbItem` / `MudTable`.
- **Concept introduced, two revoke paths with deliberately different endings.** `[Rubric §11, Security]` assesses whether a user can see and end their own live credentials; `[Rubric §25, Navigation & IA]` assesses whether a destructive action leaves the app in a coherent place. The class comment (lines 16-24) states the model: a row's button calls the per-session revoke, which ends one *other* device's session and leaves this one alone, while the page-level button is the account-wide revoke, which also ends the session the caller is using and therefore must be followed by the normal local sign-out and a redirect. The consequence is visible in the markup: the row for the current device offers no button at all (`Sessions.razor:62-69`), because revoking it from a row would leave the app signed in on a dead session until the access token expired, which reads to a user as a broken sign-out.
- **Concept introduced (2), a single in-flight gate over two different operations.** `[Rubric §18, UI Architecture & Component Design]`. `IsBusy` (line 55) is `_revokingSessionId is not null || IsRevokingAll`, and every button in the markup reads it (`Sessions.razor:74`, `:90`). One flag over both operations is what stops a second click from starting a concurrent revoke while the list is about to be rebuilt underneath it, and `_revokingSessionId` doubles as the per-row spinner selector (`Sessions.razor:77`).
- **Walkthrough**:
  - **State** (lines 33-58): a component-scoped `CancellationTokenSource` (line 35) passed into every service call and cancelled on dispose, `_breadcrumbs`, `_sessions`, the nullable `_loadResult` that carries the last load outcome for inline rendering (line 41), `_revokingSessionId`, `IsLoading` (line 49), `IsBusy` (line 55), and `IsRevokingAll` (line 58). `LoginRoute` is a `const` (line 33).
  - `OnInitializedAsync` (lines 60-70): builds the breadcrumbs **here rather than in a field initializer** so the injected localizer is available (comment at line 62, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)), then loads.
  - `LoadSessionsAsync` (lines 72-101): stores the whole `Result` in `_loadResult` (line 80) so the markup can render the failure inline with a retry button rather than as a toast (`Sessions.razor:16`, `:22-29`; the comment at `Sessions.razor:14-15` explains why: an empty table and a failed load look identical once a toast expires). On failure it **empties** `_sessions` deliberately (lines 87-91), so a stale device list can never be left on screen for a user to act on. `OperationCanceledException` is swallowed as expected-on-disposal (lines 93-96) and `IsLoading` clears in the `finally`.
  - `RevokeSessionAsync(session)` (lines 108-147): refuses to run while busy or for the current device (lines 110-113, a second guard behind the markup's), marks the row in flight, and then treats three outcomes distinctly. Success toasts (line 123). A not-found result, which means the session is already gone (a duplicate click, or the device signed itself out), toasts at *info* severity instead (lines 125-130), because the user's intent is satisfied and there is nothing to correct. Any other failure goes through `result.NotifyOnFailure(Toast, L)` and returns without reloading (lines 131-135). On either satisfied outcome it reloads the list from the server rather than removing the row locally (line 137), because the server is the authority on what is still live and a reload also catches a session that expired while the page sat open (doc comment, lines 103-107).
  - `RevokeAllAsync` (lines 154-172): guards on `IsBusy`, calls [`IAuthUIService`](#iauthuiservice)`.LogoutAsync()` (line 165), which is exactly the account-wide revoke *plus* the local token clear and auth-state notification, and then navigates to `/login` with `forceLoad: true` (line 166) so the circuit and any cached client state are rebuilt rather than kept alive against a revoked identity.
  - `DescribeDevice(session)` (lines 179-190): parses browser and platform out of the user agent via [`UserAgentSummary.Parse`](#useragentsummary) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/UserAgentSummary.cs:66`) and composes them through a **resource format string** in the both-known case (line 185), so the word order translates rather than being concatenated in English order; a single known part is returned as is, and neither known falls back to an explicit "unknown device" string (line 188). `[Rubric §27, Internationalization]`.
  - `FormatInstant(DateTime)` (lines 196-197): stamps the incoming value as UTC, converts to local time, and formats with `CultureInfo.CurrentCulture` general short pattern, because the endpoint reports UTC and "signed in at 03:14" only means something on the clock the reader uses.
  - `Dispose(bool)` / `Dispose()` (lines 199-219): the standard idempotent pattern, cancelling and disposing the CTS.
- **Why it's built this way**: rendering the load failure inline instead of as a toast is a deliberate `[Rubric §24, Forms, Validation & UX Safety]` choice for a page whose empty state is indistinguishable from its failure state, and it is the same reasoning [`DataGridListPageBase<TDto>`](#datagridlistpagebasetdto) encodes in its `LoadFailed` flag. Treating "already revoked" as an informational outcome rather than an error avoids punishing a user for a double click on an idempotent action.
- **Where it's used**: routed at `/profile/sessions` behind `[Authorize]` with `[StreamRendering(false)]` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Sessions.razor:1-6`), reachable in any host that maps the framework's UI pages. Its component behavior is covered by bUnit tests (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Auth/SessionsTests.cs:27`) and its rendered accessibility by the gallery E2E WCAG 2.1 AA scan (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/SessionsPageE2ETests.cs:21`).
- **Caveats / not-in-source**: `RevokeAllAsync` has no `catch`, so a throw from `LogoutAsync` propagates out of the handler with `IsRevokingAll` reset by the `finally` but no toast; whether the local sign-out completed in that case is a property of [`IAuthUIService`](#iauthuiservice), not of this file. The accessibility markers the page relies on (the text-variant "this device" chip at `Sessions.razor:52-53`, chosen so the marker does not depend on color alone, and the per-button `aria-label`s at `:76` and `:92`) live in the markup half, not in this code-behind.

### CultureDelegatingHandler

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/CultureDelegatingHandler.cs:13` · Level 0 · class (sealed)

- **What it is**: a one-method `DelegatingHandler` that stamps the active UI culture onto every
  outgoing API call as an `Accept-Language` header, so validation and error text come back from the
  backend in the language the user selected.
- **Depends on**: no first-party types. Externals: `System.Net.Http.DelegatingHandler`,
  `System.Globalization.CultureInfo`, and `System.Net.Http.Headers.StringWithQualityHeaderValue`. It
  rides the same named `"APIClient"` pipeline as
  [AuthDelegatingHandler](#authdelegatinghandler).
- **Concept introduced, culture as a transport header rather than only a cookie.**
  `[Rubric §27, Internationalization]` assesses whether locale is carried end to end instead of being
  applied only at the rendering edge; this handler is the piece that closes that loop for
  server-produced strings. The class comment (`CultureDelegatingHandler.cs:7-11`) states the reason
  plainly: the cross-origin Gateway does not carry the ASP.NET culture cookie through to the services,
  so a cookie-only design would render the page in Spanish while the API answered in English.
  `[Rubric §10, Cross-Cutting Concerns]` also applies, because this is a concern every service call
  needs and no service call implements: it is attached once in the HttpClient pipeline instead of at
  each call site.
- **Walkthrough**
  - The only member is the `SendAsync` override (`CultureDelegatingHandler.cs:16`).
  - It reads `CultureInfo.CurrentUICulture.Name` (`CultureDelegatingHandler.cs:20`) and does nothing
    when that is blank (`CultureDelegatingHandler.cs:21`), so an unresolved culture sends no header
    rather than an empty one.
  - When there is a value it calls `AcceptLanguage.Clear()` before `Add(...)`
    (`CultureDelegatingHandler.cs:23-24`); the clear matters because a retried request object would
    otherwise accumulate a second language entry.
  - It returns `base.SendAsync(request, cancellationToken)` directly
    (`CultureDelegatingHandler.cs:27`) rather than awaiting it, so the handler adds no async state
    machine to the hot path.
- **Why it's built this way**: [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)
  makes multi-locale a whole-stack concern. Registering the behavior as a message handler means the
  culture travels on calls made by code that has never heard of localization. It is registered
  transient in [DependencyInjection](#dependencyinjection)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:78`) and appended to the
  `"APIClient"` pipeline after the auth handler (`DependencyInjection.cs:101-102`).
- **Where it's used**: every request through the `"APIClient"` named client, which is every call made
  by [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype),
  [ChildEntityServiceBase](#childentityservicebase),
  [ApiUserPreferenceReader](#apiuserpreferencereader) and
  [ApiUserPreferenceWriter](#apiuserpreferencewriter).
- **Caveats / not-in-source**: it reads whatever ambient UI culture the head has already established.
  On a Blazor WebAssembly head that is set by [MmcaCultureBootstrap](#mmcaculturebootstrap) before the
  host runs; the handler itself makes no attempt to resolve or validate a culture.

---

### ICultureApplier

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ICultureApplier.cs:14` · Level 0 · interface

- **What it is**: the one-method contract for "switch the language and put the user back where they
  were", written as an abstraction because the mechanism differs per head.
- **Depends on**: nothing. Implemented by [EndpointCultureApplier](#endpointcultureapplier) (the Blazor
  Web default) and by
  [MauiCultureApplier](group-26-device-capability-layer.md#mauicultureapplier) in the device-capability
  layer.
- **Concept introduced, a terminal call.** `[Rubric §18, UI Architecture]` assesses whether
  host-specific mechanics are hidden behind contracts the components can share; this interface is the
  clearest example in the UI package. The doc comment (`ICultureApplier.cs:3-13`) spells out both
  halves of the contract: a Blazor Web head round-trips the server `/culture/set` endpoint so the
  cookie, the SSR prerender and the WASM runtime all agree, while a MAUI Blazor Hybrid head has no
  ASP.NET pipeline and switches the process culture in place. Because each implementation owns landing
  the user back on the return path (a redirect on the web, a WebView reload on a hybrid head), callers
  must treat `ApplyAsync` as terminal and do no navigation of their own.
  `[Rubric §25, Navigation & Information Architecture]` applies for the same reason: navigation
  ownership is part of the contract rather than an afterthought at each call site.
- **Walkthrough**
  - `ApplyAsync(string culture, string returnPath, CancellationToken cancellationToken = default)`
    (`ICultureApplier.cs:27`) is the whole surface.
  - Two documented behaviors belong to the contract rather than to any one implementation: a culture
    outside `SupportedCultures.All` is ignored by the underlying mechanism rather than throwing
    (`ICultureApplier.cs:19-22`), and an empty `returnPath` falls back to `"/"`
    (`ICultureApplier.cs:23-25`).
- **Why it's built this way**:
  [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html). Hard-coding the endpoint
  navigation into the culture switcher component would have made that component unusable on MAUI,
  where the URL matches no route and the Blazor `Router` renders the not-found page. The interface
  lets one shared component serve both heads.
- **Where it's used**: injected by the shared `CultureSwitcher` component, which persists the choice
  first and then treats the applier call as the last thing it does
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/CultureSwitcher.razor:6` and
  `CultureSwitcher.razor:44-48`), and by the login page when reconciling a returning user's stored
  culture (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:15` and
  `Login.razor:239-244`).

---

### IPublicLinkBuilder

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/IPublicLinkBuilder.cs:9` · Level 0 · interface

- **What it is**: a one-method abstraction that turns an app-relative path into an absolute, publicly
  shareable URL (`IPublicLinkBuilder.cs:9-13`). It exists so share sheets, copy-link buttons and QR
  payloads produce a URL that still works once it leaves the app.
- **Depends on**: nothing first-party. BCL `Uri` and `string`. Implemented by
  [NavigationPublicLinkBuilder](#navigationpubliclinkbuilder) in this package and by
  [MauiPublicLinkBuilder](group-26-device-capability-layer.md#mauipubliclinkbuilder) on the hybrid
  head.
- **Concept introduced, head-agnostic absolute link building.** `[Rubric §18, UI Architecture]`
  assesses whether shared components stay host-agnostic instead of branching on the host they run in,
  and `[Rubric §25, Navigation & Information Architecture]` assesses whether outbound links are built
  from one authority rather than string-concatenated per call site. The doc comment
  (`IPublicLinkBuilder.cs:3-8`) states the problem exactly: web heads can derive a shareable origin
  from the browser, but the MAUI head cannot, because its internal origin is the WebView's virtual
  host. Encoding that virtual origin into a QR code or a shared link would produce a URL nobody
  outside the app can open. One interface with two implementations moves the head-specific knowledge
  to the composition root and lets the pages stay identical on every head.
- **Walkthrough**
  - A single member, `Uri BuildAbsolute(string relativePath)` (`IPublicLinkBuilder.cs:13`). It returns
    a `Uri` rather than a `string`, so callers that need text do the `ToString()` themselves, and the
    doc comment gives `/sessions/42` as the shape of the argument (`IPublicLinkBuilder.cs:11`).
  - The default binding resolves the path against `NavigationManager.BaseUri`
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/NavigationPublicLinkBuilder.cs:25`),
    after rejecting a blank path (`NavigationPublicLinkBuilder.cs:23`).
  - The hybrid binding resolves against the `PublicSite:BaseUrl` key pinned in the head's embedded
    configuration
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Services/MauiPublicLinkBuilder.cs:17` and
    `MauiPublicLinkBuilder.cs:28-32`), and throws `InvalidOperationException` at construction when the
    key is missing, so a misconfigured head fails at startup instead of shipping unusable links.
- **Why it's built this way**: the default is registered with `TryAddScoped`
  (`DependencyInjection.cs:127`) and the comment above it (`DependencyInjection.cs:123-126`) records
  the override rule: the hybrid head calls `AddCommonMauiPublicLinkBuilder()` after `AddUIShared`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:118-119`, invoked at
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:141`) and the last registration wins. That is
  the same head-override composition convention
  [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) establishes
  for the device capability layer.
- **Where it's used**: the shared `SharePageButton` component
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/SharePageButton.razor:4` and
  `SharePageButton.razor:43`), the shared `QrCodeButton` component (`QrCodeButton.razor:1` and
  `QrCodeButton.razor:79`), and app pages such as ADC's speaker QR page
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerQr.razor.cs:21` and
  `SpeakerQr.razor.cs:55`). A bUnit test pins the default registration to the browser-origin builder
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/NavigationPublicLinkBuilderTests.cs:59`).

---

### IUserPreferenceWriter

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/IUserPreferenceWriter.cs:9` · Level 0 · interface

- **What it is**: the write half of cross-device UI preferences. It persists the signed-in user's
  culture and theme choice to the backend so the choice follows them to their next browser or device.
- **Depends on**: nothing. Implemented by [ApiUserPreferenceWriter](#apiuserpreferencewriter); the read
  half is [IUserPreferenceReader](#iuserpreferencereader).
- **Concept introduced, best-effort persistence over a local source of truth.**
  `[Rubric §19, State Management & Data Flow]` assesses where state lives and which copy wins; the doc
  comment (`IUserPreferenceWriter.cs:3-8`) answers both. The cookie and localStorage remain the runtime
  channel, this interface is a roaming convenience, and a failed or skipped persist must never break
  the in-page switch. Implementations must no-op for anonymous users. A `null` field means "leave
  unchanged" (`IUserPreferenceWriter.cs:11-13`), which is what lets the theme toggle and the culture
  switcher share one method without either clobbering the other's value.
- **Walkthrough**
  - `SaveAsync(string? culture, string? theme, CancellationToken cancellationToken = default)`
    (`IUserPreferenceWriter.cs:18`). Both value arguments are nullable by design, per the
    null-means-unchanged rule stated at `IUserPreferenceWriter.cs:15-16`.
- **Why it's built this way**:
  [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) and
  [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html). Keeping it an interface is
  what lets a host with no `auth/preferences` endpoint (the Helpdesk seed is the named example at
  `ApiUserPreferenceWriter.cs:11-12`) simply not register it: the callers resolve it with
  `GetService<T>` and skip the persist when it is absent.
- **Where it's used**: the theme toggle resolves it optionally and saves only the theme
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/ThemeToggle.razor:23-27`); the culture
  switcher does the same for culture before handing off to the applier
  (`CultureSwitcher.razor:38-42`).

---

### LazyJsModule

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/LazyJsModule.cs:20` · Level 0 · class (internal sealed)

- **What it is**: a small single-flight importer that owns one JavaScript module reference for a UI
  service: it imports on first use, shares one import across concurrent callers, and disposes the
  reference safely when the circuit ends.
- **Depends on**: `Microsoft.JSInterop` (`IJSRuntime`, `IJSObjectReference`, `JSDisconnectedException`)
  and the .NET `System.Threading.Lock` type. No first-party dependencies.
- **Concept introduced, single-flight JS module import.** `[Rubric §23, Front-End Performance]`
  assesses whether the client loads only what it needs, when it needs it; deferring `import()` until
  first use is the lazy half of that, and collapsing concurrent imports into one is the correctness
  half. The class comment (`LazyJsModule.cs:5-13`) states the exact defect this replaces: an unguarded
  `_module ??= await import(...)` lets two concurrent callers each start an import, after which the
  browser holds two module instances and the later assignment leaks the earlier reference, which is
  never disposed. `[Rubric §15, Best Practices & Code Quality]` applies to the second half of the
  design: a failed import is dropped rather than cached, so an import attempted during SSR prerender
  (when JS interop does not exist yet) does not poison the module for the rest of the circuit.
- **Walkthrough**
  - The primary constructor takes the `IJSRuntime` and the module path (`LazyJsModule.cs:20`). State is
    three fields: a `Lock` (`LazyJsModule.cs:22`), the in-flight import task (`LazyJsModule.cs:24`) and
    the resolved module (`LazyJsModule.cs:25`). `IsImported` (`LazyJsModule.cs:28`) exists so disposal
    can skip work.
  - `GetOrImportAsync` (`LazyJsModule.cs:34`) starts with a lock-free fast path returning the cached
    module (`LazyJsModule.cs:36-39`), then takes the lock only to publish or read the in-flight task
    (`LazyJsModule.cs:44-48`); the inline comment (`LazyJsModule.cs:41-42`) notes why holding a lock
    there is safe, since `ImportAsync` reaches its first await immediately and nothing slow runs under
    it. The awaited task is then shared by every caller (`LazyJsModule.cs:52`).
  - The `finally` block is the subtle part (`LazyJsModule.cs:54-68`): it clears the field only when the
    task did **not** complete successfully (`LazyJsModule.cs:58`), and only when the field still holds
    this task (`LazyJsModule.cs:62`), because clearing unconditionally could drop a newer import
    started after this one completed and split the next set of callers.
  - `ImportAsync` (`LazyJsModule.cs:71-79`) performs the actual
    `js.InvokeAsync<IJSObjectReference>("import", ...)` and assigns `_module`.
  - `DisposeAsync` (`LazyJsModule.cs:82-99`) returns immediately when nothing was imported
    (`LazyJsModule.cs:84-87`), nulls the field before awaiting (`LazyJsModule.cs:89`), and swallows
    `JSDisconnectedException` (`LazyJsModule.cs:95-98`), since a torn-down circuit is the normal end of
    life for a scoped UI service.
- **Why it's built this way**: the remarks (`LazyJsModule.cs:14-19`) draw the responsibility line. This
  class deliberately does not swallow anything on the import path, so each consuming service keeps its
  own degradation contract (return a default, fall back to a navigation, no-op). That is why
  [ListPageStateService](#listpagestateservice) wraps its calls in catch-and-ignore blocks while
  [MmcaCultureBootstrap](#mmcaculturebootstrap), which does not use this type at all, imports its
  module directly under an `await using`.
- **Where it's used**: [ThemeService](#themeservice) (`ThemeService.cs:19`),
  [ListPageStateService](#listpagestateservice) (`ListPageStateService.cs:69`),
  [NavigationHistoryService](#navigationhistoryservice)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/NavigationHistoryService.cs:16`)
  and [CapabilitiesJsModule](group-26-device-capability-layer.md#capabilitiesjsmodule)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Capabilities/Browser/CapabilitiesJsModule.cs:19`).
- **Caveats / not-in-source**: it is `internal` (`LazyJsModule.cs:20`), so it is not part of the
  published package surface: consumer apps get the benefit through the services that use it, not by
  using it directly.

---

### ListPageState

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ListPageStateService.cs:9` · Level 0 · record (sealed)

- **What it is**: the immutable snapshot of everything a list page needs to look the same after you
  navigate away and come back: which page, how many rows, how far down, which sort, which density and
  which filters.
- **Depends on**: nothing first-party. It is the currency shared by
  [ListPageStateService](#listpagestateservice) (in-memory plus `sessionStorage`),
  [ListPageQueryStateService](#listpagequerystateservice) (URL encoding) and
  [DataGridListPageBase<TDto>](#datagridlistpagebasetdto) (the consumer).
- **Concept introduced, one state shape over three transports.**
  `[Rubric §19, State Management & Data Flow]` assesses whether UI state has a single defined shape
  rather than being reconstructed ad hoc per page; this record is that shape, and the fact that memory,
  session storage and the address bar all move the same record is what keeps the three from drifting.
  The record is documented as update-by-`with` (`ListPageStateService.cs:5-7`), so a caller changing
  scroll position cannot accidentally reset paging.
- **Walkthrough**
  - Eight `init` members, all with defaults, so `new ListPageState()` is a valid pristine state.
  - `Page` (`ListPageStateService.cs:12`) is the MudDataGrid 0-indexed page; `PageSize`
    (`ListPageStateService.cs:15`) the chosen rows per page; `MobilePage`
    (`ListPageStateService.cs:18`) the 1-indexed card-list page, and it is the only member with a
    non-default default (`= 1`), because a mobile page zero does not exist.
  - `ScrollPosition` (`ListPageStateService.cs:26`) is a `double` of pixels, and its doc comment
    (`ListPageStateService.cs:20-25`) names which element it measures: the document
    (`document.scrollingElement.scrollTop`) for a normal paged list page, and the grid's own
    height-bound viewport (`.mud-table-container`) for a page that opts into grid virtualization, where
    the document itself does not scroll.
  - `SortColumn` (`ListPageStateService.cs:32`) holds the `SortBy` property name of the active sort
    definition and is null or empty when unsorted; `SortDescending` (`ListPageStateService.cs:38`) is
    documented as ignored when it is.
  - `DenseGrid` (`ListPageStateService.cs:46`) carries the compact-density opt-in, persisted alongside
    paging and sort so the chosen density survives navigation, refresh and shared links.
  - `Filters` (`ListPageStateService.cs:52`) is an `IReadOnlyDictionary<string, string>` of
    page-specific named values (the doc gives `"search"` and `"status"` as examples) defaulting to an
    empty dictionary, so each page decides what it saves.
- **Why it's built this way**: a sealed record gives value equality and `with`-based copies for free,
  which is what makes the "update only scroll position" and "update only density" paths in the
  services one-liners.
- **Where it's used**: produced and consumed by both list-page state services and by
  [DataGridListPageBase<TDto>](#datagridlistpagebasetdto) (`DataGridListPageBase.cs:416` and
  `DataGridListPageBase.cs:420`); serialized to `sessionStorage` as JSON and encoded into the query
  string.

---

### UserPreferences

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/UserPreferences.cs:9` · Level 0 · record (sealed)

- **What it is**: the two-field result of reading a user's stored UI preferences, their culture and
  their theme.
- **Depends on**: nothing. Returned by [IUserPreferenceReader](#iuserpreferencereader) and its
  implementation [ApiUserPreferenceReader](#apiuserpreferencereader).
- **Concept introduced**: nothing new. It reuses the null-means-unset convention introduced by
  [IUserPreferenceWriter](#iuserpreferencewriter): the doc comment (`UserPreferences.cs:3-6`) states
  that a `null` field means the user never chose that preference, so the request default or the OS
  preference applies. `[Rubric §19, State Management & Data Flow]` applies in the small, because "no
  stored value" and "stored value that happens to be the default" stay distinguishable, which is what
  lets the login reconciliation skip a redundant culture round-trip.
- **Walkthrough**
  - A positional record with two members, `Culture` and `Theme`, both `string?`
    (`UserPreferences.cs:9`). There is no factory and no validation: the values are whatever the
    backend returned.
- **Why it's built this way**: a positional record is the smallest thing that deserializes cleanly from
  the `auth/preferences` payload and compares by value.
- **Where it's used**: returned by [ApiUserPreferenceReader](#apiuserpreferencereader), including its
  static `Empty` instance (`ApiUserPreferenceReader.cs:18`); consumed by the login page's preference
  reconciliation (`Login.razor:228-247`).

---

### UserPreferencesRequest

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ApiUserPreferenceWriter.cs:29` · Level 0 · record (private sealed, nested)

- **What it is**: the request body the writer PUTs to `auth/preferences`, the same culture and theme
  pair in the write direction.
- **Depends on**: nothing. It is declared inside [ApiUserPreferenceWriter](#apiuserpreferencewriter)
  and used only there.
- **Concept introduced**: nothing new; it is the wire-facing twin of
  [UserPreferences](#userpreferences). `[Rubric §9, API & Contract Design]` applies in the small: the
  request type is kept separate from the response type even though the two currently have identical
  members, so the directions can diverge without a breaking change, and it is declared `private` so it
  never becomes part of the package's public surface.
- **Walkthrough**
  - `private sealed record UserPreferencesRequest(string? Culture, string? Theme)`
    (`ApiUserPreferenceWriter.cs:29`). It is instantiated once, inline in the `PutAsJsonAsync` call
    (`ApiUserPreferenceWriter.cs:65`).
- **Why it's built this way**: nesting it privately keeps a serialization detail from leaking into the
  package API, and a positional record needs no mapper.
- **Where it's used**: only in `ApiUserPreferenceWriter.SaveAsync`
  (`ApiUserPreferenceWriter.cs:63-66`).

---

### ApiUserPreferenceWriter

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ApiUserPreferenceWriter.cs:22` · Level 1 · class (sealed)

- **What it is**: the default [IUserPreferenceWriter](#iuserpreferencewriter). It PUTs the
  culture/theme choice to `auth/preferences` through the shared `"APIClient"`, and it declines to make
  the call at all when the request is already known to be doomed.
- **Depends on**: [IUserPreferenceWriter](#iuserpreferencewriter) (implemented),
  [ITokenStorageService](#itokenstorageservice), [JwtTokenInfo](#jwttokeninfo) and the nested
  [UserPreferencesRequest](#userpreferencesrequest). Externals: `IHttpClientFactory` and
  `System.Net.Http.Json`.
- **Concept introduced, best-effort writes still have a cost.**
  `[Rubric §13, Observability & Operability]` assesses whether the system's own traffic keeps its
  signals meaningful; the class comment (`ApiUserPreferenceWriter.cs:13-18`) makes the argument
  explicitly. Because the caller never learns the write failed, a doomed request cannot help the user
  and still lands in failed-request telemetry, and at low traffic one 401 per theme or culture toggle
  is enough on its own to trip a failed-request alert rule. Both guards below therefore exist for the
  alerting story, not the user's story. `[Rubric §11, Security]` also touches this: the writer never
  inspects or forwards the token itself, it only asks whether one is usable.
- **Walkthrough**
  - The primary constructor takes `IHttpClientFactory` and `ITokenStorageService`
    (`ApiUserPreferenceWriter.cs:22-24`). `ExpirySkew` is 30 seconds and is documented as matching the
    token-storage skew so this class agrees with the layer that does the refreshing
    (`ApiUserPreferenceWriter.cs:26-27`). `_rejectedToken` (`ApiUserPreferenceWriter.cs:37`) holds the
    token the API last refused, for the lifetime of this scoped writer.
  - `SaveAsync` (`ApiUserPreferenceWriter.cs:40`) reads the access token
    (`ApiUserPreferenceWriter.cs:42`), then applies guard one:
    `JwtTokenInfo.IsFresh(token, ExpirySkew)` (`ApiUserPreferenceWriter.cs:47`, the helper at
    `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JwtTokenInfo.cs:16`). The comment
    (`ApiUserPreferenceWriter.cs:44-46`) notes that `IsFresh` also covers null and unreadable tokens,
    which makes this the anonymous-user guard as well.
  - Guard two compares the current token against `_rejectedToken` with `StringComparison.Ordinal`
    (`ApiUserPreferenceWriter.cs:55`); the comment (`ApiUserPreferenceWriter.cs:52-54`) explains why
    expiry alone is not enough, since a token can be unexpired and still rejected (revoked session,
    rotated signing key, a user the API now treats as gone).
  - The call itself is a `PutAsJsonAsync` to the relative `auth/preferences`
    (`ApiUserPreferenceWriter.cs:62-66`), and a `401 Unauthorized` latches `_rejectedToken`
    (`ApiUserPreferenceWriter.cs:68-71`).
  - Both `HttpRequestException` (`ApiUserPreferenceWriter.cs:73`) and `TaskCanceledException`
    (`ApiUserPreferenceWriter.cs:77`) are swallowed, each with a comment noting that the cookie already
    holds the choice for this device.
- **Why it's built this way**:
  [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) and
  [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html) make the local cookie the
  runtime channel and this write a roaming extra. Storing the rejected token rather than setting a
  boolean latch is the deliberate detail (`ApiUserPreferenceWriter.cs:31-36`): a fresh sign-in produces
  a different token, so writing resumes with no reset step and no staleness of its own.
- **Where it's used**: registered with `TryAddScoped` in [DependencyInjection](#dependencyinjection)
  (`DependencyInjection.cs:130`); resolved optionally by the theme toggle
  (`ThemeToggle.razor:23-27`) and the culture switcher (`CultureSwitcher.razor:38-42`).

---

### AuthenticatedServiceBase

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/AuthenticatedServiceBase.cs:15` · Level 1 · class (abstract)

- **What it is**: the base class every UI-side HTTP service inherits. It supplies one shared Polly
  retry policy, two ways to get an `HttpClient` with a bearer token already attached, and the
  idempotency-key generator that makes those retries safe.
- **Depends on**: [ITokenStorageService](#itokenstorageservice); its documentation also names
  [AuthDelegatingHandler](#authdelegatinghandler) as the thing it deliberately bypasses and
  [ITokenRefresher](#itokenrefresher) as the source of the replay token. Externals:
  `IHttpClientFactory`, `Polly` and `Polly.Retry`.
- **Concept introduced, why a base class and not just the handler pipeline.**
  `[Rubric §29, Resilience & Business Continuity]` assesses whether transient failures are absorbed
  rather than surfaced; the retry policy is that. The sharper teaching is in the
  `CreateAuthenticatedClientAsync` doc comment (`AuthenticatedServiceBase.cs:45-50`):
  `IHttpClientFactory` creates its handlers in a separate DI scope from the Blazor circuit, so a
  `DelegatingHandler` cannot reach the circuit's `IJSRuntime` to read the in-memory access token. The
  base class works around that by reading the token from the circuit-scoped storage service itself and
  setting the header directly. `[Rubric §9, API & Contract Design]` covers the idempotency half:
  retrying a POST is only safe if the server can recognize the repeat, which is what
  [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) provides.
- **Walkthrough**
  - `RetryPolicy` is a `protected static readonly AsyncRetryPolicy<HttpResponseMessage>` built once from
    the shipped backoff (`AuthenticatedServiceBase.cs:25`), so one policy instance serves the whole app
    rather than one per service instance per circuit. `ApiClientName` pins the named client to
    `"APIClient"` (`AuthenticatedServiceBase.cs:27`), and both constructor arguments are null-checked
    into private fields (`AuthenticatedServiceBase.cs:29-30`).
  - `NewIdempotencyKey()` (`AuthenticatedServiceBase.cs:43`) returns a compact
    `Guid.NewGuid().ToString("N")`, and its remarks (`AuthenticatedServiceBase.cs:35-41`) carry the
    load-bearing rule: the value is generated once per logical operation and reused across every retry
    attempt, because the server-side idempotency filter keys its cached response off it. Generating a
    new key per attempt would defeat the dedup entirely and let a retry create a duplicate record.
  - `CreateAuthenticatedClientAsync()` (`AuthenticatedServiceBase.cs:51`) resolves the `"APIClient"`
    (`AuthenticatedServiceBase.cs:53`), reads the token (`AuthenticatedServiceBase.cs:57`), sets
    `Authorization: Bearer` when non-blank (`AuthenticatedServiceBase.cs:58-62`), and catches
    `InvalidOperationException` to proceed without a token during SSR prerender, when JS interop is
    unavailable (`AuthenticatedServiceBase.cs:64-67`).
  - `CreateClientWithToken(string accessToken)` (`AuthenticatedServiceBase.cs:80`) is the replay path.
    Its doc comment (`AuthenticatedServiceBase.cs:72-78`) explains why it exists: after the API answers
    `401`, the stored token still looks fresh by the client clock, so re-reading storage would just
    resend the token the server has already rejected. The caller passes the token it acquired straight
    from [ITokenRefresher](#itokenrefresher); the method rejects a blank one
    (`AuthenticatedServiceBase.cs:82`) and stamps the header unconditionally
    (`AuthenticatedServiceBase.cs:85`).
  - `IsRetryableResponse` (`AuthenticatedServiceBase.cs:100`) is the retry predicate. It first excludes
    `501 Not Implemented` and `505 HTTP Version Not Supported` (`AuthenticatedServiceBase.cs:102-105`)
    because, as the remarks say (`AuthenticatedServiceBase.cs:94-99`), those are permanent verdicts and
    retrying only burns the budget and delays the error the caller needs to see. It then accepts
    anything `>= 500` plus `408 Request Timeout` and `429 Too Many Requests`
    (`AuthenticatedServiceBase.cs:107-108`), the two codes where the server is explicitly inviting a
    later attempt.
  - `DefaultBackoff` (`AuthenticatedServiceBase.cs:114-116`) is the shipped schedule: `2^attempt`
    seconds (2s, 4s, 8s) plus up to one second of random jitter, so a fleet of clients does not
    re-converge on the same instant. The `S2245`/`CA5394` suppression around it
    (`AuthenticatedServiceBase.cs:111`) documents that the randomness only spaces retries and feeds no
    security decision.
  - `BuildRetryPolicy(Func<int, TimeSpan> backoff)` (`AuthenticatedServiceBase.cs:131-134`) is
    `internal` and backoff-injectable so a test can exercise the disposal contract without waiting out
    the real delays. Its `onRetry` disposes the retried attempt's response
    (`AuthenticatedServiceBase.cs:134`); the remarks (`AuthenticatedServiceBase.cs:123-130`) explain
    that Polly hands the caller only the final outcome, so without this every intermediate 5xx, 408 or
    429 response leaks its content buffer and keeps its connection out of the handler pool until
    finalization, exactly under the sustained backend failure the retries exist to survive. A retried
    `HttpRequestException` carries no result, hence the null-conditional, and the final response is not
    disposed here because the caller owns it.
- **Why it's built this way**: the DI scope mismatch is a real Blazor Server constraint, not a
  preference, so the workaround has to live somewhere every service shares. The retry ceiling and
  jitter line up with the resilience posture in
  [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html).
- **Where it's used**: inherited by
  [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:47`),
  [ChildEntityServiceBase](#childentityservicebase)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ChildEntityServiceBase.cs:22`) and
  [NotificationInboxService](#notificationinboxservice)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationInboxService.cs:33`),
  and through them by every module-level UI service in the consumer apps. The members show up as
  `NewIdempotencyKey()` on writes (`EntityServiceBase.cs:162`), `RetryPolicy.ExecuteAsync` around each
  call (`EntityServiceBase.cs:338` and `EntityServiceBase.cs:366`) and `CreateClientWithToken` on the
  401 replay (`NotificationInboxService.cs:147`).

---

### EndpointCultureApplier

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EndpointCultureApplier.cs:18` · Level 1 · class (sealed)

- **What it is**: the Blazor Web implementation of [ICultureApplier](#icultureapplier). It
  force-navigates to the server's `GET /culture/set` endpoint, which writes the culture cookie and
  redirects the user back to where they were.
- **Depends on**: [ICultureApplier](#icultureapplier) (implemented) and
  `Microsoft.AspNetCore.Components.NavigationManager`. It pairs with the server endpoint mapped by
  `MapCultureEndpoint()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:100`, the
  `MapGet("/culture/set", ...)` at `WebApplicationExtensions.cs:105`) and with
  [MmcaCultureBootstrap](#mmcaculturebootstrap) on the WASM side.
- **Concept introduced, why the full page reload is deliberate.**
  `[Rubric §27, Internationalization]` assesses whether a locale switch is coherent across every
  rendering path; the class comment (`EndpointCultureApplier.cs:8-10`) says the force-load is
  load-bearing, because the server has to re-render SSR under the new cookie and the WASM runtime has
  to re-read it on startup, which keeps prerender and hydration on the same culture. A soft,
  client-only switch would leave the two disagreeing and show a locale flash on the next full load.
- **Walkthrough**
  - `ApplyAsync` (`EndpointCultureApplier.cs:21`) rejects a null or whitespace culture up front with
    `ArgumentException.ThrowIfNullOrWhiteSpace` (`EndpointCultureApplier.cs:23`).
  - It falls back to `"/"` for an empty return path (`EndpointCultureApplier.cs:25`) and builds the URL
    with `Uri.EscapeDataString` on both values (`EndpointCultureApplier.cs:26`), so a return path
    containing a query string survives round-tripping.
  - It then calls `navigation.NavigateTo(url, forceLoad: true)` (`EndpointCultureApplier.cs:30`) and
    returns `Task.CompletedTask` (`EndpointCultureApplier.cs:31`): the method is synchronous in
    substance and `Task`-shaped only because the interface must also fit asynchronous heads.
  - The inline comment (`EndpointCultureApplier.cs:28-29`) notes that validating the culture is the
    endpoint's job: an unsupported value lands the user back on the same page unchanged rather than
    failing.
- **Why it's built this way**:
  [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html). The class comment
  (`EndpointCultureApplier.cs:11-15`) also records the boundary of its validity: a head with no ASP.NET
  pipeline would route `/culture/set` through the Blazor `Router`, match no page and render the
  not-found page, which is exactly why MAUI heads register their own applier after `AddUIShared`.
- **Where it's used**: registered as the default with
  `TryAddScoped<ICultureApplier, EndpointCultureApplier>()` (`DependencyInjection.cs:121`), with the
  comment above it (`DependencyInjection.cs:117-120`) recording that a hybrid head overrides it
  afterwards. The MAUI replacement is
  [MauiCultureApplier](group-26-device-capability-layer.md#mauicultureapplier).

---

### IUserPreferenceReader

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/IUserPreferenceReader.cs:9` · Level 1 · interface

- **What it is**: the read half of cross-device preferences. It fetches the signed-in user's stored
  culture and theme, used at login to reapply a returning user's choices on a new device.
- **Depends on**: [UserPreferences](#userpreferences) (its return type); implemented by
  [ApiUserPreferenceReader](#apiuserpreferencereader). The write half is
  [IUserPreferenceWriter](#iuserpreferencewriter).
- **Concept introduced**: nothing new; it mirrors the best-effort contract the writer introduced. The
  doc comment (`IUserPreferenceReader.cs:3-8`) pins the failure mode: implementations return an empty
  `UserPreferences` (both fields null) for anonymous users or on any error, so a failed read never
  blocks login. `[Rubric §19, State Management & Data Flow]` applies, since this is the moment the
  roaming copy is reconciled against the local one.
- **Walkthrough**
  - `GetAsync(CancellationToken cancellationToken = default)` returning `Task<UserPreferences>`
    (`IUserPreferenceReader.cs:13`). There is no failure channel in the signature at all, which is the
    contract making itself unmistakable.
- **Why it's built this way**:
  [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) and
  [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html). A `Result<T>` here would
  invite a caller to surface an error the user cannot act on during a login they just completed
  successfully.
- **Where it's used**: injected by the login page (`Login.razor:14`) and read once in
  `ApplyStoredPreferencesAndNavigateAsync` (`Login.razor:228-230`), which applies the theme through
  [ThemeService](#themeservice) (`Login.razor:232-235`) and the culture through
  [ICultureApplier](#icultureapplier) (`Login.razor:243`), skipping the culture round-trip when the
  stored value already matches the current one (`Login.razor:237-238`).

---

### ListPageQueryStateService

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ListPageQueryStateService.cs:28` · Level 1 · class (sealed)

- **What it is**: the two-way translator between a [ListPageState](#listpagestate) and the browser
  address bar, so browser back/forward, a refresh and a link pasted into chat all restore the same
  filtered, sorted, paged view.
- **Depends on**: [ListPageState](#listpagestate); externals `NavigationManager`,
  `Microsoft.AspNetCore.WebUtilities.QueryHelpers` and `StringValues`.
- **Concept introduced, the URL as shareable state.**
  `[Rubric §25, Navigation & Information Architecture]` assesses whether the address bar reflects what
  the user is looking at; this class is that contract for every list page. The remarks
  (`ListPageQueryStateService.cs:14-27`) document the reserved keys and why they are terse (they end up
  in shareable links): `p` (0-indexed desktop page), `ps` (page size), `mp` (1-indexed mobile page),
  `s` (sort column), `sd` (`desc` only, since ascending is the default), `d` (`1` only, since
  comfortable density is the default), `q` (free-text search) and `f:<name>` for any other named
  filter. Defaults are omitted entirely, so a pristine list page has a clean URL.
  `[Rubric §19, State Management & Data Flow]` applies because this is the second of the three
  transports the same record travels over.
- **Walkthrough**
  - The key names are private constants (`ListPageQueryStateService.cs:30-40`), including the
    `"search"` filter name that maps to `q` by convention and the `desc`/`1` markers.
  - `ReadCurrent()` (`ListPageQueryStateService.cs:45-49`) is the instance entry point: it resolves the
    absolute URI from the injected `NavigationManager` and hands the query to the parser.
  - `ParseQueryString` (`ListPageQueryStateService.cs:56`) is deliberately `static` and public,
    documented as a pure helper exposed for unit testing without a `NavigationManager`
    (`ListPageQueryStateService.cs:51-55`). It reads the three integers through `TryGetInt`
    (`ListPageQueryStateService.cs:212-222`, which parses with `CultureInfo.InvariantCulture` and falls
    back to the supplied default rather than throwing), treats a blank sort value as no sort
    (`ListPageQueryStateService.cs:65-72`), matches `desc` case-insensitively
    (`ListPageQueryStateService.cs:77`) but the dense marker `1` ordinally
    (`ListPageQueryStateService.cs:83`), then walks every remaining key, folding `q` into the `search`
    filter and stripping the `f:` prefix off the rest (`ListPageQueryStateService.cs:87-103`).
  - `BuildPath` (`ListPageQueryStateService.cs:122`) is the inverse, and the omission rules are visible
    one by one: page only when `> 0` (`ListPageQueryStateService.cs:129`), page size only when `> 0`
    (`ListPageQueryStateService.cs:134`), mobile page only when `> 1`
    (`ListPageQueryStateService.cs:139`), `sd` only when a sort column exists and is descending
    (`ListPageQueryStateService.cs:144-151`), `d` only when dense
    (`ListPageQueryStateService.cs:153-156`); with no parameters at all it returns the bare base path
    (`ListPageQueryStateService.cs:175-177`).
  - `ReplaceState` (`ListPageQueryStateService.cs:196`) writes the URL back using
    `NavigationOptions { ReplaceHistoryEntry = true }` (`ListPageQueryStateService.cs:209`) so filter
    changes do not pollute the back stack.
- **Why it's built this way**: the most instructive part is the guard in `ReplaceState`
  (`ListPageQueryStateService.cs:201-206`), which drops the write when the current path no longer
  matches the owning `basePath`. The remarks (`ListPageQueryStateService.cs:186-195`) record the
  diagnosed defect: a grid-state write is inherently deferred (a debounced search, a late `ServerData`
  completion), so it can land after the user has already navigated away. Building from the then-current
  URI used to stamp grid parameters onto the next page's URL and issue a spurious navigation that
  disposed it mid-load, and detail pages reached by clicking a list row had their first data fetch
  canceled about 66ms in, leaving them stuck on their loading state.
- **Where it's used**: registered `TryAddScoped` (`DependencyInjection.cs:111`) and injected into
  [DataGridListPageBase<TDto>](#datagridlistpagebasetdto)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:28`), which
  reads the URL on initialization and on parameter changes (`DataGridListPageBase.cs:203` and
  `DataGridListPageBase.cs:264`) and writes it back after a grid or filter change
  (`DataGridListPageBase.cs:883` and `DataGridListPageBase.cs:925`).

---

### ListPageStateService

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ListPageStateService.cs:63` · Level 1 · class (sealed)

- **What it is**: the per-circuit memory of list-page state, keyed by route, with an optional
  write-through to `sessionStorage` so the state survives things a circuit-scoped dictionary cannot.
- **Depends on**: [ListPageState](#listpagestate) and [LazyJsModule](#lazyjsmodule); externals
  `IJSRuntime`, `IJSObjectReference` and the `nav-interop.js` module shipped in the package's
  `wwwroot`.
- **Concept introduced, a synchronous fast path with an asynchronous durable path.**
  `[Rubric §19, State Management & Data Flow]` assesses how state survives lifecycle boundaries; this
  class answers with two tiers. The class comment (`ListPageStateService.cs:55-62`) names exactly what
  the durable tier buys: state survives circuit teardowns, `forceLoad: true` navigations and the SSR to
  WASM render-mode transition. The synchronous dictionary matters just as much, because it is safe to
  read from `OnInitialized` during prerender, when JS interop does not exist yet.
- **Walkthrough**
  - Two constants set the contract: the module path `./_content/MMCA.Common.UI/nav-interop.js`
    (`ListPageStateService.cs:65`) and the `mmca.lps:` session-key prefix
    (`ListPageStateService.cs:66`). State is a plain `Dictionary<string, ListPageState>`
    (`ListPageStateService.cs:68`) plus one [LazyJsModule](#lazyjsmodule)
    (`ListPageStateService.cs:69`).
  - `GetState` (`ListPageStateService.cs:76-77`) is a `GetValueOrDefault` and is documented as safe to
    call during SSR prerender (`ListPageStateService.cs:71-75`). `SaveState`
    (`ListPageStateService.cs:84-85`) stores in memory only.
  - `UpdateScrollPosition` (`ListPageStateService.cs:92-95`) is the fast path for scroll events: it
    uses a `with` expression to preserve every other field, and creates a minimal entry when none
    exists yet, for the case where the user scrolls before the grid has fired its first save.
  - `HydrateFromSessionAsync` (`ListPageStateService.cs:103`) invokes `sessionGet` on the JS module
    (`ListPageStateService.cs:113`, the export at
    `MMCA.Common/Source/Presentation/MMCA.Common.UI/wwwroot/nav-interop.js:12`) and adopts any
    persisted snapshot (`ListPageStateService.cs:114-117`).
  - `PersistToSessionAsync` (`ListPageStateService.cs:138`) does the reverse through `sessionSet`
    (`ListPageStateService.cs:153`, `nav-interop.js:24`), returning early when there is nothing in
    memory to write (`ListPageStateService.cs:140-143`).
  - Both wrap the interop in the same three-catch shape: `InvalidOperationException` for prerender,
    `JSDisconnectedException` for a torn-down circuit and `JSException` as the defensive catch for
    storage failures such as Safari Private mode or an exceeded quota
    (`ListPageStateService.cs:119-130` and `ListPageStateService.cs:155-166`).
  - The private `GetModuleAsync` (`ListPageStateService.cs:169-183`) converts an unavailable runtime
    into a `null` module rather than an exception, which is what makes the two public methods' early
    returns read cleanly. `DisposeAsync` (`ListPageStateService.cs:186`) simply forwards to the module
    wrapper.
- **Why it's built this way**: the degradation contract here is "never let storage failures break the
  calling page", which is why this class swallows what [LazyJsModule](#lazyjsmodule) deliberately does
  not. Scoped registration means one instance per circuit, so the in-memory dictionary is naturally
  per-user without any keying by identity.
- **Where it's used**: registered `TryAddScoped` (`DependencyInjection.cs:110`) and injected into
  [DataGridListPageBase<TDto>](#datagridlistpagebasetdto) (`DataGridListPageBase.cs:27`), which reads
  it during state restore (`DataGridListPageBase.cs:205`), hydrates from session on first render
  (`DataGridListPageBase.cs:333-338`), records scroll offsets (`DataGridListPageBase.cs:397`), and
  saves plus persists after grid and density changes (`DataGridListPageBase.cs:864-889` and
  `DataGridListPageBase.cs:920-929`).

---

### MmcaCultureBootstrap

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/MmcaCultureBootstrap.cs:14` · Level 1 · class (static)

- **What it is**: the Blazor WebAssembly culture bootstrap. It reads the same ASP.NET culture cookie the
  server used for SSR prerender and sets the WASM runtime's default thread cultures before the host
  starts running.
- **Depends on**: [SupportedCultures](group-12-api-hosting-mapping.md#supportedcultures) from the
  Shared layer and the `culture.js` module in the package's `wwwroot`. Externals: `IJSRuntime` and
  `CultureInfo`.
- **Concept introduced, closing the prerender/hydration culture gap.**
  `[Rubric §27, Internationalization]` assesses whether every rendering path resolves the same locale;
  the class comment (`MmcaCultureBootstrap.cs:7-13`) states the outcome this buys: the interactive
  client renders in the same language the server prerendered, with no locale flash and no
  prerender/hydration mismatch. `[Rubric §23, Front-End Performance]` applies too, because the
  alternative (letting the client discover the culture after first render) costs a visible re-render of
  the whole page.
- **Walkthrough**
  - One method, `SetBrowserCultureAsync(IJSRuntime jsRuntime)` (`MmcaCultureBootstrap.cs:22`),
    null-guarded at `MmcaCultureBootstrap.cs:24`.
  - It imports `./_content/MMCA.Common.UI/culture.js` under an `await using`
    (`MmcaCultureBootstrap.cs:26-27`), so the module reference is released as soon as the one call is
    done: unlike the long-lived services, this runs once at startup and has no reason to hold it.
  - It calls `getCulture` (`MmcaCultureBootstrap.cs:28`), whose JS side parses the
    `.AspNetCore.Culture` cookie's `uic=` segment and returns null when the cookie is absent or
    unparseable (`MMCA.Common/Source/Presentation/MMCA.Common.UI/wwwroot/culture.js:4`).
  - The returned value is filtered through `SupportedCultures.IsSupported` and falls back to
    `SupportedCultures.Default` otherwise (`MmcaCultureBootstrap.cs:30`; the predicate is at
    `MMCA.Common/Source/Core/MMCA.Common.Shared/Globalization/SupportedCultures.cs:35`, the allowlist
    at `SupportedCultures.cs:18`, and the `"en-US"` default at `SupportedCultures.cs:12`).
  - It then assigns only `CultureInfo.DefaultThreadCurrentCulture` and
    `CultureInfo.DefaultThreadCurrentUICulture` (`MmcaCultureBootstrap.cs:32-33`), never
    `CurrentCulture`/`CurrentUICulture` directly: setting the defaults makes every subsequently created
    thread inherit the culture, which is what a later switch needs in order to take effect.
- **Why it's built this way**:
  [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html). The cookie is deliberately
  non-HttpOnly for exactly this reader, a decision recorded in the suppression comment on the server
  side (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:109`,
  written at `WebApplicationExtensions.cs:118`), which names
  `MmcaCultureBootstrap.SetBrowserCultureAsync` as the consumer. The doc comment
  (`MmcaCultureBootstrap.cs:11-12`) also pins the call ordering: it must run after `builder.Build()`
  and before `host.RunAsync()`.
- **Where it's used**: both Blazor Web clients call it exactly as documented:
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:86` and
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:69`. Its MAUI counterpart is
  [MauiCultureInitializer](group-26-device-capability-layer.md#mauicultureinitializer).

---

### MudAppDialogService

> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/MudAppDialogService.cs:11` · Level 1 · class (internal sealed)

- **What it is**: the MudBlazor-backed implementation of the framework's confirm-prompt facade. It asks
  MudBlazor's message box for a yes/no answer and reduces it to a single `bool`.
- **Depends on**: [IAppDialogService](#iappdialogservice) (implemented) and MudBlazor's `IDialogService`
  (`MudAppDialogService.cs:1-2`). It has no other state.
- **Concept introduced, quarantining the component library behind a facade.**
  `[Rubric §16, Maintainability]` assesses how much of the codebase would have to change if a vendor
  dependency changed; the class comment (`MudAppDialogService.cs:6-9`) records the answer for dialogs:
  this type and [MudToastService](#mudtoastservice) are the only two types in the framework that name a
  component-library service. `[Rubric §14, Testability]` is the other half of the payoff, spelled out
  on the interface (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IAppDialogService.cs:8-12`):
  a test can answer the prompt with a stub instead of driving a rendered dialog.
- **Walkthrough**
  - The primary constructor takes MudBlazor's `IDialogService` (`MudAppDialogService.cs:11`); the class
    is `internal`, so consumers only ever see the interface.
  - `ConfirmAsync(string title, string message, string confirmText, string cancelText)`
    (`MudAppDialogService.cs:14`) forwards to `ShowMessageBoxAsync` with the confirm label as `yesText`
    and the decline label as `cancelText` (`MudAppDialogService.cs:19-23`). The labels are already
    localized by the caller, per the interface doc (`IAppDialogService.cs:21-24`).
  - The return is `confirmed is true` (`MudAppDialogService.cs:25`). The comment above it
    (`MudAppDialogService.cs:16-18`) states the contract: `ShowMessageBoxAsync` answers `null` when the
    user dismissed the dialog without choosing (backdrop click, escape), and collapsing that onto
    `false` means only an active confirmation counts as one, so callers never have to branch on three
    outcomes.
- **Why it's built this way**: the interface deliberately exposes only the one shape the framework needs
  (a yes/no question before something irreversible or lossy), leaving richer entity-specific dialogs
  component-side (`IAppDialogService.cs:3-7`). Keeping the implementation `internal` and registered by
  `AddUIShared` means an app cannot accidentally depend on the MudBlazor type through this path.
- **Where it's used**: registered with
  `TryAddScoped<IAppDialogService, MudAppDialogService>()` (`DependencyInjection.cs:161`, under the
  facade-registration doc at `DependencyInjection.cs:145-147`). Consumers resolve the interface: the
  shared `UnsavedChangesGuard` component
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/UnsavedChangesGuard.razor:14` and
  `UnsavedChangesGuard.razor:57`) and the Helpdesk seed's ticket pages
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/Pages/Tickets.razor:104` and
  `Components/Pages/TicketDetail.razor:348`). A bUnit test pins the registration to this implementation
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Infrastructure/BunitComponentTestBaseFacadeTests.cs:32`).

---

### NavigationPublicLinkBuilder
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/NavigationPublicLinkBuilder.cs:11` · Level 1 · class (sealed)

- **What it is**: the default [IPublicLinkBuilder](#ipubliclinkbuilder). It turns an app-relative route
  such as `sessions/42` into an absolute URL by resolving it against the origin the browser is
  currently served from, which is what a share sheet, a copy-link button or a QR payload needs.
- **Depends on**: [IPublicLinkBuilder](#ipubliclinkbuilder) (the contract it implements,
  `NavigationPublicLinkBuilder.cs:11`); `Microsoft.AspNetCore.Components.NavigationManager` (ASP.NET
  Core Blazor, `NavigationPublicLinkBuilder.cs:1,13`) for the origin. Nothing else: no HTTP, no
  configuration, no JS interop.
- **Concept introduced, the origin a link is built from is a per-head decision, not a per-page one.**
  `[Rubric §25, Navigation, Routing & Information Architecture]` assesses whether routes and the URLs
  built from them are modelled once rather than reconstructed ad hoc at each call site. A page that
  wants to share itself has two candidate origins available, and only one of them is right: the
  in-process origin the component is rendering under, and the public web origin a recipient can open.
  On the Server and WebAssembly heads those coincide, so `NavigationManager.BaseUri` is the correct
  answer and this class is a two-line adapter over it. On the MAUI Blazor Hybrid head they do not: the
  WebView serves the app from an internal virtual host, so an absolute URL built from `BaseUri` there
  would be unopenable anywhere else (the class comment records exactly this at lines 5-10). Hoisting
  the decision behind an interface is what lets the shared `SharePageButton` and `QrCodeButton` stay
  head-agnostic (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/SharePageButton.razor:4`,
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/QrCodeButton.razor:1`).
  `[Rubric §18, UI Architecture & Component Design]` reads the same choice from the component side:
  the shared components inject a contract, never a `NavigationManager`.
- **Walkthrough**
  - One readonly field, `_navigationManager` (line 13), assigned by an expression-bodied constructor
    (lines 17-18). The class is `sealed` and holds no other state, so a scoped instance costs a
    reference.
  - `BuildAbsolute(string relativePath)` (line 21) rejects a blank path outright with
    `ArgumentException.ThrowIfNullOrWhiteSpace` (line 23): an empty share link is a caller bug, not a
    condition to render, and this is the one place cheap enough to catch it.
  - The build itself is one expression (line 25):
    `new Uri(new Uri(_navigationManager.BaseUri, UriKind.Absolute), relativePath)`. The inner `Uri`
    forces the base to be parsed as absolute, and the outer resolution applies standard URI reference
    resolution to the path.
  - The behavior callers rely on is pinned rather than assumed:
    [NavigationPublicLinkBuilderTests](group-27-testing-infrastructure.md#navigationpubliclinkbuildertests)
    asserts that `"/sessions/42"` and `"sessions/42"` both resolve to `http://localhost/sessions/42`
    against the bUnit origin
    (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/NavigationPublicLinkBuilderTests.cs:21-25`),
    that a query string survives (`:27-29`), and that a blank path throws (`:31-41`).
- **Why it's built this way**: `AddUIShared` registers this implementation with `TryAddScoped`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:127`), so every head gets a
  working builder without opting in, and the one head that must differ replaces it afterwards:
  `AddCommonMauiPublicLinkBuilder()` registers
  [MauiPublicLinkBuilder](group-26-device-capability-layer.md#mauipubliclinkbuilder) over the
  configured public site URL
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:119`). The registration
  shape is itself asserted, implementation type and lifetime, so a refactor that changes the default is
  a red test rather than a silently wrong share link (`NavigationPublicLinkBuilderTests.cs:43-62`).
- **Where it's used**: injected by the framework's share affordances, `SharePageButton` and
  `QrCodeButton`, and by ADC's [SpeakerQr](group-21-conference-ui.md#speakerqr) page, which encodes the
  absolute public URL into the badge QR rather than the WebView origin
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerQr.razor.cs:21`).
  The bUnit harnesses in both repos register it explicitly so component tests exercise the real builder
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/BunitTestBase.cs:40`,
  `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/BunitTestBase.cs:30`).
- **Caveats**: `BuildAbsolute` performs no allow-list check on `relativePath`, and nothing in the class
  restricts the result to the app's own origin, so a path value that came from user input should be
  sanitized upstream.

### ThemeService
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ThemeService.cs:16` · Level 1 · class (sealed)

- **What it is**: the single owner of the Day/Dark preference (ADR-028). It holds the current mode for
  the circuit, persists a change through a small JS module to a cookie plus `localStorage`, and raises
  an event so every subscriber re-renders together.
- **Depends on**: [LazyJsModule](#lazyjsmodule) (single-flight importer for its JS module,
  `ThemeService.cs:19`); `Microsoft.JSInterop.IJSRuntime` (ASP.NET Core, primary-constructor parameter
  at line 16); the asset it imports,
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/wwwroot/theme.js`, which owns the cookie and
  `localStorage` access (`theme.js:5,23,33`). `IAsyncDisposable` (BCL) is implemented so the module
  reference is released with the circuit.
- **Concept introduced, one scoped service as the theme's single source of truth.**
  `[Rubric §20, Design System, Theming & UI Consistency]` assesses whether theming is a first-class,
  centrally owned concern rather than per-page CSS toggling. Here exactly one scoped service holds
  `IsDarkMode` (line 22); the toggle button, the `MudThemeProvider` wrapper and, on MAUI, the native
  chrome all read from it and all subscribe to `OnChange` (line 28). Nothing else stores a copy.
  `[Rubric §19, State Management & Data Flow]` is the same fact viewed as state: an event-plus-property
  service is the framework's pattern for cross-component UI state that is not routed, and the cost of
  that pattern is unsubscription discipline in every consumer.
- **Concept introduced, JS interop is not available during prerender.**
  `[Rubric §18, UI Architecture & Component Design]` covers the render-mode contract a Blazor component
  must respect (ADR-056, `Website/docs-src/adr/056-blazor-render-mode-strategy.md`). Reading a cookie
  or `localStorage` requires a live browser, so `InitializeAsync` can only run after the first
  interactive render; the class documents that requirement on itself (`ThemeService.cs:10-13`) rather
  than guarding it internally, and the component that owns the lifecycle calls it from
  `OnAfterRenderAsync(firstRender)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/MmcaThemeProviders.razor:35`).
- **Walkthrough**
  - `ModulePath` is the `_content/MMCA.Common.UI/theme.js` static-web-asset path (line 18), wrapped in
    a [LazyJsModule](#lazyjsmodule) field (line 19). Two components resolving the same scoped service
    therefore share one import rather than racing two.
  - `IsDarkMode` (line 22) and `IsInitialized` (line 25) are public with a private setter: subscribers
    read the state, only this class writes it. `OnChange` (line 28) is a plain `EventHandler?`.
  - `InitializeAsync()` (line 34) is idempotent by an early return on `IsInitialized` (lines 36-39).
    It imports the module (line 41), asks `get` for the stored value (line 42), and resolves the mode:
    a stored value wins by an ordinal case-insensitive compare against `"dark"` (lines 43-44),
    otherwise it falls back to the OS setting through `systemPrefersDark` (line 45), which reads
    `prefers-color-scheme` (`theme.js:33-35`). Only then does it set `IsInitialized` and raise
    `OnChange` (lines 47-48), so the first notification carries the resolved answer, not the default.
  - `SetDarkModeAsync(bool)` (line 53) writes the field first, then persists through `set` (line 57),
    then notifies (line 58). The JS side writes a non-HttpOnly cookie with a one-year `max-age` and
    `samesite=lax` and mirrors it to `localStorage`, guarding the mirror in a `try` because private
    browsing can refuse storage (`theme.js:23-31`). The cookie is deliberately readable by the server,
    which is how SSR can paint the right theme on the first response (`theme.js:1-2`).
  - `ToggleAsync()` (line 62) is `SetDarkModeAsync(!IsDarkMode)`, the entire body of the app-bar
    toggle's click handler.
  - `DisposeAsync()` (line 67) forwards to the module wrapper, which is where the guarded release of a
    torn-down circuit's `IJSObjectReference` lives.
- **Why it's built this way**: ADR-028 (`Website/docs-src/adr/028-dark-theme-mode.md`) requires the
  preference to survive a reload and to be visible to the server for a no-flash first paint, which is
  why the value goes to a cookie and `localStorage` rather than to component state, and why the service
  holds no `MudTheme` of its own: it publishes a boolean and lets the theme providers decide what that
  means visually. Not gating `InitializeAsync` on `RendererInfo` is also deliberate and pinned: the
  prerender test uses the `get` invocation as proof that the first render ran at all
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Components/MmcaThemeProvidersPrerenderTests.cs:29-33`).
- **Where it's used**: registered by `AddUIShared` as scoped
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:115`) and consumed by
  `MmcaThemeProviders`, which subscribes in `OnInitialized`, initializes on first render and
  unsubscribes on dispose
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/MmcaThemeProviders.razor:28,35,119`), by
  `ThemeToggle` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/ThemeToggle.razor:2,7`), by
  the MAUI head's `NativeThemeSync`, which mirrors the in-app choice onto the native chrome
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Components/NativeThemeSync.razor:17,41,52`),
  and by the login flow, which applies a returning user's stored theme
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:232-234`). Hosts that compose
  their own DI register it directly, for example MMCA.Helpdesk
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Program.cs:23`). Behavior is pinned through the
  two components that drive it,
  [MmcaThemeProvidersTests](group-27-testing-infrastructure.md#mmcathemeproviderstests) and
  [ThemeToggleTests](group-27-testing-infrastructure.md#themetoggletests), and end to end by
  `DarkModeE2ETests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/DarkModeE2ETests.cs:54`).
- **Caveats**: no test file in `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services` is named
  for this type; its behavior is covered only through those components, so a change to
  `InitializeAsync` surfaces as a component-test failure rather than a direct one. `OnChange` is a
  plain event with no weak-reference handling, so a subscriber that fails to unsubscribe outlives its
  component for the life of the circuit; both in-framework subscribers unsubscribe on dispose and both
  have a test asserting it. `SetDarkModeAsync` sets `IsDarkMode` before the JS write completes, so a
  failed `set` leaves the in-memory mode and the persisted mode disagreeing until the next initialize;
  nothing in source reconciles that.

### ApiUserPreferenceReader
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ApiUserPreferenceReader.cs:14` · Level 2 · class (sealed)

- **What it is**: the default [IUserPreferenceReader](#iuserpreferencereader). It GETs
  `auth/preferences` with the signed-in user's bearer token and hands back the culture and theme the
  user chose on some other device, or empty preferences when there is nothing to read.
- **Depends on**: [IUserPreferenceReader](#iuserpreferencereader) (the contract,
  `ApiUserPreferenceReader.cs:16`), [UserPreferences](#userpreferences) (the two-nullable-field record
  it returns, line 18), [ITokenStorageService](#itokenstorageservice) (primary-constructor parameter,
  line 15), [JwtTokenInfo](#jwttokeninfo) (the freshness check, line 31); `IHttpClientFactory` and
  `System.Net.Http.Json` (BCL) for the named `"APIClient"`.
- **Concept introduced, a best-effort read that cannot fail its caller.**
  `[Rubric §10, Cross-Cutting Concerns]` assesses whether a secondary concern is prevented from
  changing the outcome of the primary operation. Applying a stored preference is a nicety attached to
  login; a network hiccup while reading it must not turn a successful sign-in into an error page. This
  class encodes that as a type-level promise: `GetAsync` returns `UserPreferences` rather than a
  [Result](group-01-result-error-handling.md#result), and there is no path out of it that reports a
  failure. That is the posture ADR-096 records for side effects generally
  (`Website/docs-src/adr/096-best-effort-side-effects.md`), applied on the read side.
  `[Rubric §26, Front-End Security]` also applies, in a small but real way: the class refuses to spend
  a round trip on a token it can already see is stale.
- **Walkthrough**
  - Two statics carry the whole configuration. `Empty` is a single shared
    `new UserPreferences(null, null)` (line 18), so the failure paths allocate nothing, and
    `ExpirySkew` is `TimeSpan.FromSeconds(30)` (line 21) with a comment stating why the value is
    duplicated here: it must agree with the token-storage layer that does the refreshing, or the two
    would disagree about when a token is still usable.
  - `GetAsync(CancellationToken)` (line 24) reads the access token (line 26) and gates on
    `JwtTokenInfo.IsFresh(token, ExpirySkew)` (line 31). The comment (lines 28-30) spells out the two
    cases this covers: an expired or unreadable token buys a guaranteed 401, and `IsFresh` also covers
    the anonymous (null) case. Both return `Empty` (line 33).
  - The request itself is three lines: resolve the named `"APIClient"` (line 38), which already carries
    the bearer and `Accept-Language` handlers
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:101-102`), then
    `GetFromJsonAsync<UserPreferences>` against the relative URI `auth/preferences` (lines 39-41).
  - Null-coalescing on the deserialized value (line 42) means a body of literal `null` is the same as
    no preference.
  - Two catch blocks, `HttpRequestException` (line 44) and `TaskCanceledException` (line 48), both
    return `Empty`. Note what is not caught: anything else, including a `JsonException` from a
    malformed body, still escapes, so a contract break is loud while a transport failure is quiet.
- **Why it's built this way**: ADR-027 (`Website/docs-src/adr/027-multi-locale-i18n.md`) and ADR-028
  make the stored culture and theme a per-user server-side value so the choice follows a user between
  devices, and login is the one moment where reading it is worth a round trip. Catching narrowly and
  returning a shared empty record is what makes the reconciliation safe to await unconditionally in the
  login flow. It is the read half of a pair: [ApiUserPreferenceWriter](#apiuserpreferencewriter) is the
  write half, and the two are registered together
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:130-131`).
- **Where it's used**: registered by `AddUIShared` with `TryAddScoped`
  (`DependencyInjection.cs:131`) and injected by exactly one page, the framework's login page
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:14`). Its
  `ApplyStoredPreferencesAndNavigateAsync` calls `GetAsync`, applies a stored theme through
  [ThemeService](#themeservice), and, when the stored culture differs from the current one, hands the
  rest of the navigation to [ICultureApplier](#icultureapplier), which owns the head-specific switch
  (`Login.razor:228-248`).
- **Caveats**: no test under `MMCA.Common/Tests` names this type, while its sibling writer has
  [ApiUserPreferenceWriterTests](group-27-testing-infrastructure.md#apiuserpreferencewritertests); the
  reader's guard and its two catch paths are unpinned. Because `TaskCanceledException` is caught
  unconditionally, a caller that cancels its own token receives `Empty` rather than an
  `OperationCanceledException`, which is the opposite of the convention
  [HttpResultExecutor](#httpresultexecutor) enforces elsewhere in this package; the single caller
  passes no token (`Login.razor:230`), so the difference is invisible in current use.

### HttpResultExecutor
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/HttpResultExecutor.cs:31` · Level 3 · class (static)

- **What it is**: the wrapper every UI service call runs inside. It converts the faults that survive
  after a response has been handled, a refused connection, a DNS failure, a broken stream, a client
  timeout, into failed [Result](group-01-result-error-handling.md#result) values, so a service method
  typed as returning a `Result` really does return one.
- **Depends on**: [Result](group-01-result-error-handling.md#result) and its generic sibling
  `Result<T>`, plus [Error](group-01-result-error-handling.md#error) for the failure it mints
  (`HttpResultExecutor.cs:2,127,130`); `System.Text.Json` and `System.Net.Http` (BCL) for the fault set
  it recognizes. It is `static` and holds no state, so anything can call it, including services that
  derive from none of this package's bases.
- **Concept introduced, the two halves of "a client call never throws".**
  `[Rubric §9, API & Contract Design]` assesses whether the error channel between client and server is
  explicit and typed. The framework's answer has two pieces and this is the second one. The first,
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader), converts a **response**:
  it reads the server's ProblemDetails body back into errors with the original
  [ErrorType](group-01-result-error-handling.md#errortype) intact. This class converts the **absence**
  of a response, and the class comment states the split outright (lines 11-16). Only with both does a
  page get to branch on a `Result` instead of writing a `catch`, which is what ADR-013 asks for
  (`Website/docs-src/adr/013-result-pattern.md`) and what ADR-094 records as the client contract
  (`Website/docs-src/adr/094-client-entity-data-access.md:82-94`).
  `[Rubric §29, Resilience, Reliability & Business Continuity]` applies because this is the boundary
  where an infrastructure fault stops being an exception and becomes something the UI can render.
- **Concept introduced, cancellation is not a failure.** `[Rubric §24, Forms, Validation & UX Safety]`
  assesses whether the user-facing outcome of an interaction is honest. A page cancels its own work all
  the time: a disposed component, a grid fetch superseded by the next keystroke. Reporting that back as
  an error would paint a message for something the user never did. The class therefore distinguishes
  two identically typed exceptions by inspecting the token, and documents the rule on itself
  (lines 17-23).
- **Walkthrough**
  - Two public constants name the failures it can mint, `TransportErrorCode = "Http.TransportFailure"`
    (line 34) and `TimeoutErrorCode = "Http.Timeout"` (line 37). They are public because they are the
    branch a page uses when it needs different wording; the messages themselves are private constants
    (lines 39-43).
  - `ExecuteAsync(Func<Task<Result>>, CancellationToken)` (line 52) and its generic twin
    `ExecuteAsync<T>(Func<Task<Result<T>>>, CancellationToken)` (line 87) are the whole public surface.
    Both are structurally identical, and both start with `ArgumentNullException.ThrowIfNull` (lines 54,
    89) and `cancellationToken.ThrowIfCancellationRequested()` (lines 59, 94). The pre-check is
    explained in the source (lines 56-58): an already-abandoned call must never reach the network, and
    the propagation contract has to hold even for an operation that would complete without ever
    observing the token.
  - The `try` simply awaits the caller's operation (lines 63, 98). Everything interesting is in the
    three catch clauses, and their order is the design.
  - `catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)` rethrows
    (lines 65-68, 100-103). This filter is the entire mechanism: the caller's token being cancelled is
    what identifies the exception as the caller's own.
  - The unfiltered `catch (OperationCanceledException)` (lines 69, 104) is therefore the other case:
    `HttpClient` gave up on its own timeout, which raises the same exception type with the token not
    cancelled. That one becomes a failure carrying `TimeoutError()` (lines 71, 106).
  - `catch (Exception exception) when (IsTransportFault(exception))` (lines 73, 108) filters rather
    than catching broadly, so nothing outside the recognized set is swallowed. `IsTransportFault`
    (line 121) admits exactly three types: `HttpRequestException`, `IOException` and `JsonException`
    (line 122). The comment above it draws the line explicitly (lines 114-119): anything else is a
    programming fault and keeps travelling as an exception.
  - `TransportError` (line 124) puts the exception's own text on the error's `Source` rather than its
    `Message` (lines 125-127), because that text is diagnostic detail: not localizable, and not safe to
    render verbatim. `TimeoutError` (line 129) carries no detail at all.
- **Why it's built this way**: the class comment records the third consequence of the split (lines
  24-29): a transport failure never reached a server, so nothing localized it on the way back, which is
  why the two messages are English literals and why the codes are public. A page that needs translated
  wording branches on the code or supplies its own resource key rather than displaying the synthesized
  message. Keeping the type static and dependency-free is what lets services outside this package's
  hierarchy, including a consumer app's hand-written client, adopt the same contract with one call.
- **Where it's used**: it wraps every dispatch in this package,
  [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:332,362`),
  [ChildEntityServiceBase](#childentityservicebase)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ChildEntityServiceBase.cs:37,53,71`),
  [AuthUIService](#authuiservice)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:179,192,213,228,241,264`)
  and [NotificationInboxService](#notificationinboxservice)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationInboxService.cs:42,60,80,97`).
  Outside the framework it is called directly by services that sit outside the base hierarchy: Store's
  cart and lookup services
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/Cart/CartStateService.cs:101,141,175,207,261,299`,
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/CustomerLookupService.cs:26,47,93`,
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/ProductVariantLookupService.cs:26,74`)
  and Helpdesk's single API client
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Services/HelpdeskApiClient.cs:30,50,64,84,95,109,122,138,149`).
  Its own behavior is pinned by
  [HttpResultExecutorTests](group-27-testing-infrastructure.md#httpresultexecutortests), including the
  code literals
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/HttpResultExecutorTests.cs:25-26`),
  the timeout-versus-cancellation split (`:150,164,178`) and the rethrow paths
  (`:192,206,219,230,240`).
- **Caveats**: a `JsonException` is classified as a transport fault, so a server that answers 200 with
  a body the client cannot deserialize produces the same generic "check the connection" message as a
  refused socket; the distinction is available in the error's `Source` but not in its code. The two
  user-facing messages are hard-coded English by design, so a fully localized app still shows them
  untranslated unless the page branches on the code itself.

### ChildEntityServiceBase
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/ChildEntityServiceBase.cs:19` · Level 4 · class (abstract)

- **What it is**: the two-verb service base for join entities, the many-to-many rows a UI can create
  and delete but never lists or edits on their own. It offers `PostAsync` (in two shapes) and
  `DeleteByIdAsync` over the named `"APIClient"`, and nothing else.
- **Depends on**: [AuthenticatedServiceBase](#authenticatedservicebase) (base class, supplying the
  authenticated client factory, `ChildEntityServiceBase.cs:22`),
  [ITokenStorageService](#itokenstorageservice) (constructor parameter, passed straight through,
  line 21), [HttpResultExecutor](#httpresultexecutor) (lines 37, 53, 71),
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader) (lines 42, 58, 77),
  [Result](group-01-result-error-handling.md#result) and
  [ErrorType](group-01-result-error-handling.md#errortype) (line 2); `IHttpClientFactory` and
  `System.Net.Http.Json` (BCL).
- **Concept introduced, a base class shaped by the resource rather than by convention.**
  `[Rubric §18, UI Architecture & Component Design]` assesses whether the presentation layer talks to
  the backend through typed services rather than raw `HttpClient` calls in components. The interesting
  design choice here is what is absent: a join row like `SessionSpeaker` has no list page, no edit form
  and no lookup, so this base deliberately does not implement
  [IEntityService<TEntityDTO, TIdentifierType>](#ientityservicetentitydto-tidentifiertype). Giving join
  services the full CRUD surface would hand pages six operations of which four have no endpoint behind
  them. `[Rubric §1, SOLID Principles]` reads this as interface segregation applied at the service-base
  level: the smaller base cannot promise what the API does not serve.
- **Walkthrough**
  - The primary constructor takes `IHttpClientFactory`, `ITokenStorageService` and a `string endpoint`,
    forwarding the first two to `AuthenticatedServiceBase` (lines 19-22). The endpoint is captured as a
    primary-constructor parameter rather than exposed as a property, so subclasses cannot rewrite it;
    contrast
    [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype),
    which surfaces `protected string Endpoint { get; }` because its own methods build sub-paths from it.
  - `PostAsync<TResponse>(object request, CancellationToken)` (line 36) is for an endpoint that answers
    with the created DTO. Inside a `HttpResultExecutor.ExecuteAsync` wrapper (line 37) it creates an
    authenticated client (line 40), POSTs the payload as JSON to the relative endpoint (line 41), and
    hands the response to `ProblemDetailsResultReader.ReadAsync<TResponse>` (line 42). The `request`
    parameter is typed `object` on purpose, and the doc comment explains why (lines 28-33): join
    payloads are anonymous objects, `System.Text.Json` serializes the runtime type for an `object`
    declaration, and a generic request parameter would force a caller to name a type it cannot spell.
  - `PostAsync(object request, CancellationToken)` (line 52) is the same call for an endpoint that
    answers 204, returning a non-generic `Result` through the reader's body-less overload (line 58).
    The two overloads exist because the reader treats a missing body as a failure on the generic path.
  - `DeleteByIdAsync(string id, CancellationToken)` (line 70) builds `"{endpoint}/{id}"` (line 75) and
    DELETEs it (line 76). A join row that is not there answers 404, which arrives as an
    `ErrorType.NotFound` failure rather than a bare `false`, so a caller can still separate "nothing to
    remove" from "the remove failed" (documented at lines 62-66).
  - The id parameter is a `string`, not a typed identifier: subclasses format their own key before
    calling. ADC's four join services route it through one helper that also appends the parent key as a
    query parameter, `ChildEntityDeletePath.For`
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:76-87`),
    which is why the whole difference between a removal that works and one the API answers 404 to sits
    in a single place.
- **Why it's built this way**: join endpoints sit behind `[Authorize]` exactly like their parent CRUD
  endpoints, so they need the same bearer plumbing and the same error contract, but none of the paging,
  filtering or lookup machinery. Deriving from [AuthenticatedServiceBase](#authenticatedservicebase)
  rather than from
  [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype) reuses
  the auth path while keeping the surface honest. Two deliberate asymmetries with that sibling are
  recorded in ADR-094 (`Website/docs-src/adr/094-client-entity-data-access.md:95-106`): these calls run
  **outside** `RetryPolicy`, so a join add or remove is single-attempt, and `PostAsync` sends **no**
  `Idempotency-Key`, so a duplicate join is stopped by the domain invariant and the unique index behind
  it rather than by request deduplication (ADR-017,
  `Website/docs-src/adr/017-request-idempotency.md`).
- **Where it's used**: four ADC Conference join services derive from it, all in one file,
  [EventSpeakerService](group-21-conference-ui.md#eventspeakerservice) on `eventspeakers`,
  [SessionSpeakerService](group-21-conference-ui.md#sessionspeakerservice) on `sessionspeakers`,
  [SessionCategoryItemService](group-21-conference-ui.md#sessioncategoryitemservice) on
  `sessioncategoryitems` and
  [SpeakerCategoryItemService](group-21-conference-ui.md#speakercategoryitemservice) on
  `speakercategoryitems`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:22,35,48,61`).
  Each adds a typed `AddAsync`/`DeleteAsync` pair over the two protected methods and implements its own
  module interface (for example `:25-29`). The base is pinned by
  [ChildEntityServiceBaseTests](group-27-testing-infrastructure.md#childentityservicebasetests).
- **Caveats**: because there is no retry, a transient 503 on a join add surfaces to the user as a
  failure that the equivalent CRUD call would have retried away; that is a decision, not an oversight,
  but it is invisible from the subclass. Neither `PostAsync` overload exposes the response headers, so
  an endpoint answering `201 Created` with a `Location` header gives the caller no way to read it.

### EntityServiceBase<TEntityDTO, TIdentifierType>
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:43` · Level 4 · class (abstract)

- **What it is**: the CRUD workhorse of the UI layer. It implements
  [IEntityService<TEntityDTO, TIdentifierType>](#ientityservicetentitydto-tidentifiertype) against a
  REST endpoint by turning each operation into a URL plus a one-line HTTP lambda, and funnels every one
  of them through two dispatch methods that own retry, idempotency, conditional writes, error
  translation and deserialization. An optional read cache sits in front of the four reads.
- **Depends on**: [AuthenticatedServiceBase](#authenticatedservicebase) (base class, line 47),
  [IEntityService<TEntityDTO, TIdentifierType>](#ientityservicetentitydto-tidentifiertype) (implemented
  interface, line 47),
  [IBaseDTO<TIdentifierType>](group-12-api-hosting-mapping.md#ibasedtotidentifiertype) (the `TEntityDTO`
  constraint, line 48),
  [BaseLookup<TIdentifierType>](group-12-api-hosting-mapping.md#baselookuptidentifiertype) (line 120),
  [CollectionResult<T>](group-01-result-error-handling.md#collectionresultt) and
  [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) with its
  [PaginationMetadata](group-01-result-error-handling.md#paginationmetadata) (lines 73, 116, 125),
  [IUiReadCache](#iuireadcache) (optional constructor parameter, line 47),
  [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware) and
  [ConcurrencyETag](group-08-auth.md#concurrencyetag) (lines 197-199, 394),
  [IdempotencyHeaders](group-08-auth.md#idempotencyheaders) (line 386),
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader) (lines 339, 367),
  [HttpResultExecutor](#httpresultexecutor) (lines 332, 362) and
  [ITokenStorageService](#itokenstorageservice) (line 46); Polly through the inherited `RetryPolicy`,
  and `System.Net.Http.Json` (BCL).
- **Concept introduced, one dispatch point for every cross-cutting HTTP concern.**
  `[Rubric §10, Cross-Cutting Concerns]` assesses whether retry, auth and error handling are applied in
  one place instead of repeated per call: the six public methods contain only URL construction, and the
  two `SendRequestAsync` overloads (lines 324 and 354) contain all of the policy.
  `[Rubric §19, State Management & Data Flow]` applies because components never touch `HttpClient`:
  they inject the typed interface and receive DTOs wrapped in a `Result`.
  `[Rubric §29, Resilience, Reliability & Business Continuity]` applies through the inherited
  three-retry exponential-backoff-with-jitter policy
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/AuthenticatedServiceBase.cs:25`), whose
  predicate retries 5xx plus 408 and 429 but not 501 or 505 (`AuthenticatedServiceBase.cs:100`).
- **Concept introduced, retry safety for a non-idempotent verb.** `[Rubric §9, API & Contract Design]`
  assesses whether client and server share an explicit protocol for duplicate writes. A retry policy
  that re-issues a POST is a correctness hazard: if the first attempt reached the server and only the
  response was lost, the retry creates a second record. `AddAsync` is the one method that passes a key
  (line 162), minted by `AuthenticatedServiceBase.NewIdempotencyKey()` as a compact GUID
  (`AuthenticatedServiceBase.cs:43`). The key is set as a **default request header on the client**
  (line 386) rather than per request, and that one client instance serves every retry attempt, so all
  attempts carry the identical value (the comment at lines 382-385 says exactly that). The server side
  is the opt-in [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter), and both ends
  read the header name from the shared [IdempotencyHeaders](group-08-auth.md#idempotencyheaders)
  constant. Reads, full-PUT updates and deletes send no key because they are naturally idempotent
  (comment at lines 156-158).
- **Concept introduced, the conditional write.** `[Rubric §24, Forms, Validation & UX Safety]` assesses
  whether the UI protects a user from silently overwriting somebody else's work. `UpdateAsync` sends
  the DTO's concurrency token as an `If-Match` entity tag (line 184), and that header is the only route
  the token travels (remarks at lines 170-175). A DTO carrying no token sends no header, and the server
  answers `428 Precondition Required` rather than accepting a blind write. `ConcurrencyTagOf` (line
  197) is the whole rule: a DTO that implements
  [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware) with a non-empty `RowVersion`
  is formatted by `ConcurrencyETag.Format`, anything else yields `null` (lines 198-200). This is
  ADR-035 (`Website/docs-src/adr/035-optimistic-concurrency.md`) seen from the client.
- **Concept introduced, a read-through cache keyed by the request URL.**
  `[Rubric §23, Front-End Performance & Rendering]` assesses whether the client avoids work it has
  already done. `GetCachedAsync` (line 241) is the client half of ADR-040
  (`Website/docs-src/adr/040-authenticated-output-caching-for-public-reads.md`): the relative URL, path
  plus full query string, **is** the cache key, deliberately matching the server-side output cache's
  `QueryKeys = "*"` shape, and the `CA1054` suppression at lines 237-240 exists to keep it a verbatim
  string rather than a re-encoded `System.Uri`.
- **Walkthrough**
  - The primary constructor takes `endpoint`, `IHttpClientFactory`, `ITokenStorageService` and an
    optional [IUiReadCache](#iuireadcache) (lines 43-47); note the parameter order differs from
    [ChildEntityServiceBase](#childentityservicebase). Both type parameters are constrained,
    `TEntityDTO : IBaseDTO<TIdentifierType>` and `TIdentifierType : notnull` (lines 48-49). `Endpoint`
    is republished as a protected property (line 51) because the read methods append sub-paths to it,
    and `ReadCache` likewise (line 58) so a derived service can invalidate a prefix its own custom
    write touched. With no cache registered, every read goes to the API and the class behaves exactly
    as it did before the cache existed (constructor docs, lines 37-42).
  - `GetAllAsync(includeFKs, includeChildren, ct)` (line 61) builds a two-parameter query string
    (lines 66-72), goes through the cache (line 73), and maps the paged envelope down to its items
    (line 75). The "all" endpoint answers with the paged envelope, not a bare array.
  - `GetPagedAsync(filters, pageNumber, pageSize, sortColumn, sortDirection, includeChildren, ct)`
    (line 79) is the one with real work. Page numbers are formatted with
    `string.Create(CultureInfo.InvariantCulture, ...)` (lines 90-91) so a comma-decimal locale cannot
    corrupt the query, and every filter property, operator and value goes through
    `Uri.EscapeDataString` (lines 103-105). Filters serialize as `filters[Property].operator=` plus an
    optional `filters[Property].value=`, and a filter whose operator is blank is skipped entirely
    (line 101), which is how a grid clears a column filter. It targets `{Endpoint}/paged` (line 110)
    and maps the envelope to the `(Items, TotalItems)` tuple a server-side data grid binds to
    (lines 115-116).
  - `GetAllForLookupAsync(nameProperty, ct)` (line 120) hits `{Endpoint}/lookup` (line 124) and maps a
    `CollectionResult<BaseLookup<TIdentifierType>>` to its items (lines 125-127), the lightweight
    id-plus-name shape that feeds dropdowns and autocompletes.
  - `GetByIdAsync(id, includeChildren, ct)` (line 131) is a plain cached GET (line 146). A missing
    entity is a `NotFound` failure, not a null, and the comment records both halves of why
    (lines 143-145): the caller can tell it apart from a transport failure via
    [ResultUiExtensions](#resultuiextensions)`.IsNotFound`, and a failure is never cached, so a 404 is
    re-asked every time.
  - `AddAsync(entity, ct)` (line 150) POSTs with the idempotency key (lines 159-163) and then calls
    `InvalidateOnSuccess` (line 165). `UpdateAsync(entity, ct)` (line 176) PUTs to
    `{Endpoint}/{GetEntityId(entity)}` with the `If-Match` tag (lines 180-185); `DeleteAsync(id, ct)`
    (line 203) DELETEs `{Endpoint}/{id}` (lines 207-211). All three invalidate on success.
  - `GetEntityId(entity)` (line 217) is `protected virtual` and returns `entity.Id`, the hook a
    subclass overrides when the route key is not the DTO's own id.
  - `GetCachedAsync<T>(url, ct, bypassCache)` (line 241) guards the url (line 246), goes straight to the
    network when no cache is registered or the caller asked to bypass (lines 248-251), answers from a
    fresh entry when there is one (lines 253-256), and otherwise fetches and stores. Only a success
    with a non-null value is stored (lines 262-265), because caching a failure would pin a transient
    outage in front of the user for the whole TTL and a cached 404 would survive the create that fixed
    it. `bypassCache` exists for a read the user explicitly asked to be current, a refresh button or a
    re-poll after a push (documented at lines 231-235).
  - `InvalidateOnSuccess` (line 281) drops this endpoint's cached reads by prefix, and only on success
    (lines 283-286): a rejected write changed nothing, so invalidating there would throw away entries
    that are still accurate. `AsReadOnlyList` (line 293) presents a deserialized `Items` collection
    without assuming the JSON reader produced a list (lines 296-298).
  - `SendRequestAsync<T>` (line 324) and `SendRequestAsync` (line 354) are the center of the class and
    are structurally identical: null-guard the lambda (lines 330, 360), wrap everything in
    [HttpResultExecutor](#httpresultexecutor) (lines 332, 362), build a client for this one logical
    operation (lines 337, 365), execute the caller's lambda through `RetryPolicy` with the cancellation
    token threaded in so a cancelled operation does not sleep out its backoff (lines 338, 366), and
    hand the response to [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader)
    (lines 339, 367). The generic overload fails a 2xx with no body via the reader's
    `EmptyResponseCode`, which is why the body-less overload exists at all (documented at lines
    319-323). The client is kept in scope across the read on purpose (comment at lines 335-336).
  - `CreateRequestClientAsync(idempotencyKey, ifMatch)` (line 376) is where both conditional headers are
    attached (lines 380-395), each with a comment stating the retry property it preserves: the same key
    on every attempt, and the same precondition on every attempt so a write that lost the race fails
    consistently instead of succeeding on a later attempt against a version the caller never saw.
- **Why it's built this way**: passing the HTTP call as a `Func<HttpClient, Task<HttpResponseMessage>>`
  lets each verb stay a two-line method while every policy decision lives once. The composition inside
  the dispatch is the load-bearing part, and ADR-094 records it as the client contract
  (`Website/docs-src/adr/094-client-entity-data-access.md:60-94`): the executor outside, the retry
  policy in the middle, the reader innermost. Nothing here throws for a server answer, so a 404, a
  validation rejection and a 500 are all failures a page can branch on; the only exception that still
  escapes is the caller's own cancellation (class comment, lines 25-30). All six public methods are
  `virtual`, so a module service overrides only the one that needs domain-specific behavior and
  inherits the rest.
- **Where it's used**: it is the base of essentially every module CRUD service. ADR-094's inventory as
  of 2026-08-31 counts sixteen production subclasses: nine in ADC Conference including
  [EventService](group-21-conference-ui.md#eventservice) and
  [SessionService](group-21-conference-ui.md#sessionservice), six in Store (`ProductService`,
  `CategoryService`, `OrderService`, `ShoppingCartService`, `InventoryItemService`, `CustomerService`),
  and one inside the framework itself, [PushNotificationService](#pushnotificationservice)
  (`Website/docs-src/adr/094-client-entity-data-access.md:107-118`). ADC Identity's
  [UserService](group-24-identity-module.md#userservice) takes the auth root directly instead. The
  consumer on the page side is [DataGridListPageBase<TDto>](#datagridlistpagebasetdto), which is handed
  a `GetPagedAsync` call as its fetch delegate. Behavior is pinned by
  [EntityServiceBaseTests](group-27-testing-infrastructure.md#entityservicebasetests),
  [EntityServiceBaseCachingTests](group-27-testing-infrastructure.md#entityservicebasecachingtests) and
  [EntityServiceBaseIdempotencyRetryTests](group-27-testing-infrastructure.md#entityservicebaseidempotencyretrytests),
  which asserts the key is emitted on creates only and stays identical across attempts.
- **Caveats**: `GetAllAsync` has no page-size bound in source; it asks the "all" endpoint for
  everything and materializes the result, which is why grids use `GetPagedAsync` instead. The read
  cache is keyed by URL alone and holds nothing about who fetched it, so it is only safe while
  [IUiReadCache](#iuireadcache) stays a per-circuit registration. `GetPagedAsync` accepts a `filters`
  dictionary that the signature does not declare nullable (line 80), yet the body null-checks it
  (line 97): defensive against a caller the signature says cannot exist.

### MudToastService
> MMCA.Common.UI · `MMCA.Common.UI.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/MudToastService.cs:12` · Level 5 · class (internal sealed)

- **What it is**: the MudBlazor-backed [IToastService](#itoastservice). It is one of only two types in
  the framework that name a component-library service, the other being its sibling
  [MudAppDialogService](#mudappdialogservice).
- **Depends on**: [IToastService](#itoastservice) (the contract, `MudToastService.cs:12`) and
  [ToastSeverity](#toastseverity) (the vendor-neutral level, line 27); MudBlazor's `ISnackbar`,
  `Severity`, `Variant`, `Color` and `SnackbarOptions` (lines 2, 12, 47, 63), and
  `Microsoft.AspNetCore.Components.Rendering.RenderTreeBuilder` (ASP.NET Core) for the one method that
  renders markup (lines 32-40).
- **Concept introduced, the vendor boundary.** `[Rubric §20, Design System, Theming & UI Consistency]`
  assesses whether the app depends on its own design vocabulary rather than on a specific component
  library's API. Every page, component and `Result` helper in both applications depends on
  `IToastService`; only this class and `MudAppDialogService` know that MudBlazor exists, and the DI
  comment says so outright
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:146-149`).
  `[Rubric §14, Testability & Test Strategy]` is the practical payoff: a test records toasts against
  the interface without rendering a snackbar host, which is how
  [ResultUiExtensions](#resultuiextensions)`.NotifyOnFailure` can be tested at all
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:265,277`).
  `[Rubric §1, SOLID Principles]` covers the shape: an internal implementation behind a public
  interface means no consumer can name the concrete type even by accident.
- **Walkthrough**
  - Four one-liners cover the common levels: `Success`, `Info`, `Warning` and `Error` (lines 15-24),
    each a direct `snackbar.Add(message, Severity.X)`. `Show(message, severity)` (line 27) is the same
    call with the level chosen at runtime.
  - `ShowPersistent(title, body, severity)` (line 30) is the push-notification shape. It renders a
    two-line body through a `RenderTreeBuilder` (a bolded title, a line break, then the body,
    lines 34-39) and sets `RequireInteraction = true` with `Variant.Filled` (lines 46-47). The comment
    states the rule (lines 44-45): the message arrived unprompted, so it must survive until the user
    has actually looked at the screen rather than expiring on the default timer.
  - `ShowAction(message, actionText, onAction, severity, requireInteraction)` (line 51) is the
    undo-style toast. It sets `Action` and `ActionColor` (lines 62-63) and adapts MudBlazor's click
    signature to the caller's parameterless delegate by discarding the `Snackbar` instance MudBlazor
    passes (line 67). `requireInteraction` is opt-in: when false the options are left untouched so the
    host's own snackbar timing applies, and when true both `RequireInteraction` and `Variant.Filled`
    are stated outright rather than relying on MudBlazor's null default (comment at lines 71-74).
  - `Map(ToastSeverity)` (line 85) projects the neutral enum onto MudBlazor's with an explicit switch
    over all five members plus a `Normal` default (lines 87-92). It is written out rather than cast on
    purpose: the two enums agree numerically today, and an implicit dependency on that would break
    silently the day either side gains a member (comment at lines 80-84).
  - Nothing wraps `onAction`. The absence is a documented contract, pinned by a test that asserts a
    throwing callback propagates
    (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/MudToastServiceTests.cs:49-59`): a
    caller whose work can fail guards it instead of discovering the failure as a swallowed no-op.
- **Why it's built this way**: keeping the vendor type behind a facade is what makes the component
  library swappable in principle and mockable in practice, and it is the reason the framework ships
  `AddCommonUiFacades()` as its own registration
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:158-163`), factored out so a
  bUnit harness can register exactly these two services without pulling in the whole shared-UI surface
  (comment at lines 144-157). Every method returns `void`: a toast is fire-and-forget by design, and
  MudBlazor's `ISnackbar.Add` is synchronous.
- **Where it's used**: registered by `AddCommonUiFacades` with `TryAddScoped`
  (`DependencyInjection.cs:160`), which `AddUIShared` calls for every host
  (`DependencyInjection.cs:106`). Consumers resolve `IToastService`, never this type: the framework's
  `NotificationListener` raises an incoming push as a persistent toast
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Notifications/NotificationListener.razor:49`),
  [ResultUiExtensions](#resultuiextensions)`.NotifyOnFailure` turns a failed
  [Result](group-01-result-error-handling.md#result) into one
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:277`), and ADC's
  [LiveEventListener](group-22-engagement-module.md#liveeventlistener) uses the action shape for its
  reconnect prompt
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Components/LiveEventListener.razor.cs:79,164`).
  Its own behavior is pinned by
  [MudToastServiceTests](group-27-testing-infrastructure.md#mudtoastservicetests), which captures the
  options lambda and applies it to a fresh `SnackbarOptions` carrying MudBlazor's defaults, so the
  assertions see exactly what a rendered snackbar would
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/MudToastServiceTests.cs:114`).
- **Caveats**: `ShowPersistent` renders the title and body as content in a render fragment, so both are
  escaped by the renderer, but neither string is length-bounded in source: a long push body produces a
  correspondingly tall toast. `Show`, `Success` and the rest pass the caller's string straight to
  MudBlazor, so any localization has to happen before the call; the facade does not touch
  `IStringLocalizer`.

### IOAuthUISettings
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/IOAuthUISettings.cs:9` · Level 0 · interface

- **What it is**: three booleans that tell the shared login page which external identity providers this
  host can actually use, so a social login button renders only where the provider is really wired up.
- **Depends on**: nothing first-party. Implemented in the framework by
  [`DefaultOAuthUISettings`](#defaultoauthuisettings) and
  [`ConfigurationOAuthUISettings`](#configurationoauthuisettings); consumed by the shared `Login` page.
- **Concept introduced, default interface members as a safe-off baseline.** All three members carry a
  body returning `false` (`IOAuthUISettings.cs:12,15,18`), so an implementation can be an empty class
  and still compile with every provider hidden. That is what makes the framework's default a
  seven-line file rather than a stub with three properties.
  - `[Rubric §18, UI Architecture & Component Design]` assesses whether a component asks a typed
    contract rather than reaching into configuration. The login page injects this interface and never
    touches `IConfiguration`, so the same markup works on a host that has no OAuth at all.
  - `[Rubric §26, Front-End Security]` assesses what the client is told. The contract carries
    availability only: no client id, no secret, no redirect URI. The class docs state the intent
    directly, that implementations declare availability so the login page can conditionally render
    social buttons (`IOAuthUISettings.cs:3-8`).
- **Walkthrough**: three get-only members, `GoogleEnabled` (`IOAuthUISettings.cs:12`), `GitHubEnabled`
  (line 15) and `AppleEnabled` (line 18), each declared as `bool X => false`.
- **Why it's built this way**: external login is optional per host, and the decision has to be readable
  from the render tree. Making the interface the question (rather than a settings object) lets the
  framework register a no-op default and lets a host swap in a real answer without any page change.
  The federated login flow the flags gate is recorded in
  [ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html), and the mobile callback
  variant in [ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html).
- **Where it's used**: `AddUIShared()` registers the no-op default with `TryAddSingleton`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:135`, with the override
  instructions in the comment at lines 133-134). The shared login page injects it
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:11`), guards each provider
  button on it (lines 86, 107, 128) and folds the three flags into one `_hasExternalProviders` value
  that decides whether the whole external-login block renders (line 167). MMCA.ADC registers
  [`ConfigurationOAuthUISettings`](#configurationoauthuisettings) on all three heads
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:52`,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:42`,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:97`).

### ISecureTokenStore
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/ISecureTokenStore.cs:16` · Level 0 · interface

- **What it is**: raw token persistence with no freshness semantics. It reads back exactly what was
  written and never triggers a refresh, which is what separates it from the storage contract callers
  actually consume, [`ITokenStorageService`](#itokenstorageservice).
- **Depends on**: nothing first-party. Implemented by
  [`MauiSecureTokenStore`](group-26-device-capability-layer.md#mauisecuretokenstore) over OS
  SecureStorage; consumed by [`DirectApiTokenRefresher`](#directapitokenrefresher) and by
  [`MauiTokenStorageService`](group-26-device-capability-layer.md#mauitokenstorageservice).
- **Concept introduced, splitting storage from freshness to keep the graph acyclic.** This interface
  exists for a dependency-graph reason that the source states in full
  (`ISecureTokenStore.cs:4-9`): [`ITokenStorageService`](#itokenstorageservice), the layer callers
  consume, depends on [`ITokenRefresher`](#itokenrefresher); the refresher in turn depends on this raw
  store. The chain runs storage, then refresher, then raw store, with no loop. Collapse the two
  storage interfaces into one and the refresher would depend on the very acquisition that invoked it,
  which is a re-entrancy hazard at runtime, not just a diagram problem.
  - `[Rubric §1, SOLID]` assesses whether a single interface has one reason to change. Here two
    responsibilities that look identical from the outside (read a token, write a token) are separated
    precisely because one of them is allowed to go to the network and the other is not.
  - `[Rubric §11, Security]` assesses where credentials rest. The remarks record that only hosts which
    persist tokens themselves implement it: MAUI backs it with OS SecureStorage, while the browser
    hosts hold the access token in memory and keep the refresh token in an HttpOnly cookie, so they
    have no raw store to expose (`ISecureTokenStore.cs:10-14`).
- **Walkthrough**: four members, all verbatim.
  - `GetAccessTokenAsync()` reads the stored access token or `null` (`ISecureTokenStore.cs:19`).
  - `GetRefreshTokenAsync()` does the same for the refresh token (line 22).
  - `SetTokensAsync(accessToken, refreshToken)` persists both, replacing whatever was there (line 25).
  - `ClearTokensAsync()` removes both, the logout path (line 28).
- **Why it's built this way**: the interface is deliberately dumber than the one above it. Because it
  promises no freshness, an implementation can be a thin wrapper over a platform API with no policy,
  and the single-flight hydration policy lives once, higher up, in the storage services.
- **Where it's used**: registered on the MAUI head only,
  `services.AddScoped<ISecureTokenStore, MauiSecureTokenStore>()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/DependencyInjection.cs:83`, with the rationale
  at lines 66-77). Injected into [`DirectApiTokenRefresher`](#directapitokenrefresher)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/DirectApiTokenRefresher.cs:20`) and
  mocked directly in `DirectApiTokenRefresherTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/DirectApiTokenRefresherTests.cs:31`).
- **Caveats / not-in-source**: no browser host implements it. Resolving it on a Blazor Server or WASM
  head is a DI failure by design, not an oversight.

### ISessionCookieSync
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/ISessionCookieSync.cs:8` · Level 0 · interface

- **What it is**: a two-method contract for mirroring the client's in-memory tokens into the browser's
  HttpOnly auth cookies, and for clearing them again on logout.
- **Depends on**: nothing first-party. Implemented by
  [`JsFetchSessionCookieSync`](#jsfetchsessioncookiesync); consumed by
  [`WasmTokenStorageService`](#wasmtokenstorageservice) and by
  [`ServerTokenStorageService`](#servertokenstorageservice)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:20`).
- **Concept introduced, the prerender visibility gap.** A Blazor Web App renders a server-side pass
  before the interactive circuit exists. During that pass there is no `Authorization` header and no
  way to read the interactive client's in-memory access token, so an `[Authorize]` page opened by a
  deep link, an F5, or right-click "open in new tab" would bounce to `/login` even for a signed-in
  user. The interface doc says exactly that (`ISessionCookieSync.cs:3-7`). The cookie is the one thing
  both sides can see, so keeping it in step with the in-memory token is what makes fresh GETs work.
  - `[Rubric §26, Front-End Security]` assesses where browser credentials live. The target is an
    HttpOnly cookie, unreadable from JS, rather than `localStorage`.
  - `[Rubric §25, Navigation, Routing & Information Architecture]` assesses whether deep links behave.
    This contract is the reason a bookmarked authorized route renders instead of redirecting.
- **Walkthrough**: two members, both returning a bare `Task` because neither has anything to report.
  `SyncAsync(accessToken, refreshToken)` writes the pair (`ISessionCookieSync.cs:10`) and
  `ClearAsync()` removes it (line 12).
- **Why it's built this way**: the shape is the client half of
  [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html), which decided
  the BFF-style `mmca_auth_access` / `mmca_auth_refresh` HttpOnly cookie pair and the
  `/auth/session/token` hydration endpoint. Keeping it an interface (rather than calling JS interop
  inline from token storage) is what lets a bUnit or unit test drive the storage services with a mock
  and no browser, which `WasmTokenStorageServiceTests` does
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/WasmTokenStorageServiceTests.cs:26`).
- **Where it's used**: registered by the dedicated extension
  `AddClientAuthSessionCookieSync()`, which `TryAddScoped`s
  [`JsFetchSessionCookieSync`](#jsfetchsessioncookiesync)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:170-174`); the doc there
  records that both the Blazor Server host and the WebAssembly client call it (lines 165-169).

### ITokenRefresher
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/ITokenRefresher.cs:13` · Level 0 · interface

- **What it is**: a one-method contract for acquiring a fresh JWT access token, abstracting over the
  fact that each host holds its refresh credential somewhere completely different.
- **Depends on**: nothing first-party. Implemented by
  [`SameOriginProxyTokenRefresher`](#sameoriginproxytokenrefresher) on the browser heads and
  [`DirectApiTokenRefresher`](#directapitokenrefresher) on MAUI; consumed by
  [`WasmTokenStorageService`](#wasmtokenstorageservice),
  [`ServerTokenStorageService`](#servertokenstorageservice),
  [`MauiTokenStorageService`](group-26-device-capability-layer.md#mauitokenstorageservice) and
  [`AuthUIService`](#authuiservice).
- **Concept introduced, one contract over two materially different security models.** The interface
  doc enumerates both (`ITokenRefresher.cs:4-11`): on the browser the refresh token lives in an
  HttpOnly cookie and rotation happens server-side behind the same-origin `/auth/session/token`
  endpoint, so the refresh token is never exposed to JS; on MAUI the refresh token sits in OS
  SecureStorage and is exchanged directly against the API's cross-origin `auth/refresh`.
  - `[Rubric §11, Security]` assesses whether the strongest available mechanism is used per platform.
    A browser has an XSS surface and gets the cookie proxy; a native app has no DOM and gets direct
    token handling. The abstraction is what lets both be correct without a shared lowest common
    denominator.
  - `[Rubric §7, Microservices Readiness]` shows in the fact that the two implementations talk to two
    different origins (the UI host for one, the API for the other) behind one signature.
- **Walkthrough**: a single member,
  `Task<string?> AcquireAccessTokenAsync(CancellationToken cancellationToken = default)`
  (`ITokenRefresher.cs:20`). The nullable return is the whole error model: `null` means no valid
  session exists, whether the refresh credential is missing, expired, or revoked (lines 15-19). There
  is no exception path a caller has to know about.
- **Why it's built this way**: null-rather-than-throw matches how the callers use it. Token storage
  calls this on a hot path (every outgoing request may hydrate) and "the session is gone" is an
  ordinary outcome, not an exceptional one. Modelling it as an exception would force a `try` around
  every hydrate.
- **Where it's used**: registered per host,
  `AddScoped<ITokenRefresher, SameOriginProxyTokenRefresher>()` on the Blazor Server and WASM heads
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:115`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:45`) and
  `AddScoped<ITokenRefresher, DirectApiTokenRefresher>()` on MAUI
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:97`).

### ITokenStorageService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/ITokenStorageService.cs:8` · Level 0 · interface

- **What it is**: the platform-agnostic token contract every other UI type depends on. Anything that
  needs a bearer token asks this, and never asks where the token is kept.
- **Depends on**: nothing first-party. Implemented by [`WasmTokenStorageService`](#wasmtokenstorageservice),
  [`ServerTokenStorageService`](#servertokenstorageservice) and
  [`MauiTokenStorageService`](group-26-device-capability-layer.md#mauitokenstorageservice).
- **Concept introduced, the freshness-checking storage layer.** It shares its four member signatures
  with [`ISecureTokenStore`](#isecuretokenstore), and the difference is entirely in the promise:
  this one may go and acquire a token, the raw store may not. Reading the two interfaces side by side
  is the fastest way to understand the auth layering in this package.
  - `[Rubric §3, Clean Architecture]` assesses whether presentation code depends on abstractions
    rather than platform APIs. Nothing above this line names `SecureStorage`, `HttpContext`, or a
    cookie.
  - `[Rubric §11, Security]` assesses the storage decision itself, and the doc makes it explicit:
    browser hosts hold the access token in memory and mirror the refresh token to an HttpOnly cookie,
    never `localStorage`; MAUI uses OS SecureStorage (`ITokenStorageService.cs:3-7`).
- **Walkthrough**: `GetAccessTokenAsync()` (`ITokenStorageService.cs:11`),
  `GetRefreshTokenAsync()` (line 14), `SetTokensAsync(accessToken, refreshToken)` called after a
  successful login or refresh (line 17), and `ClearTokensAsync()` for logout (line 20).
- **Why it's built this way**: four methods is the smallest surface that covers the whole client auth
  lifecycle, and keeping it free of any freshness parameter means the policy (skew, single-flight)
  belongs to the implementation, where it can differ per host.
- **Where it's used**: injected into [`AuthDelegatingHandler`](#authdelegatinghandler),
  [`JwtAuthenticationStateProvider`](#jwtauthenticationstateprovider),
  [`AuthUIService`](#authuiservice),
  [`AuthenticatedServiceBase`](#authenticatedservicebase) (which uses it for the direct-token path
  that bypasses the delegating handler,
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/AuthenticatedServiceBase.cs:47`) and
  [`NotificationHubService`](#notificationhubservice) for the SignalR access-token provider. Test
  hosts substitute `StubTokenStorageService` and `NullTokenStorageService`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/NullTokenStorageService.cs:7`).

### JwtTokenInfo
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JwtTokenInfo.cs:9` · Level 0 · class (static)

- **What it is**: one static predicate, `IsFresh`, that answers whether a cached access token is still
  worth using or whether the caller should go and re-acquire one.
- **Depends on**: nothing first-party. Externals: `System.IdentityModel.Tokens.Jwt`
  (`JwtSecurityTokenHandler`) and `DateTime.UtcNow`.
- **Concept introduced, unvalidated client-side token inspection.** Reading a JWT without checking its
  signature looks alarming until you see what the answer is used for: it decides whether to call the
  refresher, nothing else. The class doc states the boundary plainly, no signature validation because
  the API validates every request (`JwtTokenInfo.cs:5-7`).
  - `[Rubric §11, Security]` assesses where trust decisions are made. A forged token that passed this
    check would still be rejected by the API on the first call, so the client-side read is an
    optimization, not an authorization.
  - `[Rubric §12, Performance & Scalability]` assesses avoidable round trips. Without this check every
    outgoing request would have to hydrate; with it, a live token short-circuits the whole refresh
    path.
- **Walkthrough**: `IsFresh(string? token, TimeSpan skew)` (`JwtTokenInfo.cs:16`) runs four guards and
  returns `false` on all of them, so every uncertain case biases toward refreshing:
  - a null, empty, or whitespace token (lines 18-21);
  - a token `JwtSecurityTokenHandler.CanReadToken` rejects, meaning it is not a readable JWT
    (lines 23-27);
  - otherwise it reads the token and compares `ValidTo > DateTime.UtcNow + skew` (line 31), so the
    skew is a proactive margin: the token is called stale slightly before it truly expires;
  - and a parse blowing up as `ArgumentException` or `FormatException` is caught and reported as not
    fresh (lines 33-36).
- **Why it's built this way**: a static pure function of two arguments is trivially testable and has
  no lifetime to manage, and the deliberate fail-to-false makes every failure mode converge on the one
  safe action (refresh). The exception filter is narrow on purpose: only the two malformed-input types
  are swallowed, so a genuinely unexpected failure still surfaces.
- **Where it's used**: [`WasmTokenStorageService.GetAccessTokenAsync`](#wasmtokenstorageservice) with a
  30-second skew (`WasmTokenStorageService.cs:15,24`), and the same pattern in
  [`ServerTokenStorageService`](#servertokenstorageservice)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:23`).

### UserAgentSummary
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/UserAgentSummary.cs:18` · Level 0 · class (internal, static)

- **What it is**: a deliberately tiny `User-Agent` reader that returns the two words a person
  recognizes their own device by, the browser and the platform, for the signed-in-devices page.
- **Depends on**: nothing first-party; only `string.Contains` with `StringComparison.OrdinalIgnoreCase`.
- **Concept introduced, scoping a parser to the question actually asked.** The class doc argues the
  design rather than describing it (`UserAgentSummary.cs:6-12`): a device list only has to let someone
  answer "is that me?", so a full UA database buys precision nobody reads, while the
  browser-and-platform pair separates a phone from a work laptop. Anything unrecognized reports
  `null`, and the page supplies its own "unknown device" wording rather than dumping the raw header,
  which is neither readable nor localizable.
  - `[Rubric §27, Internationalization & Localization]` assesses whether user-visible text survives
    translation. This is the sharpest example in the package: the two parts are returned separately
    and never joined, because composing "Chrome on Windows" in code would hard-code English word
    order. The caller formats them through a resource string (`UserAgentSummary.cs:13-16`, and
    ADR-027 is named there).
  - `[Rubric §32, Dependency & Supply-Chain]` applies to what is absent: no UA-parsing library and no
    data file to keep current, which is a real dependency avoided for a cosmetic feature.
- **Walkthrough**:
  - `Browsers`, eleven `(Token, Name)` pairs in most-specific-first order
    (`UserAgentSummary.cs:25-38`). Order is load-bearing and the comment says why (lines 20-24): every
    Chromium browser also says "Chrome", and Chrome and Edge both say "Safari", so `Edg/`, `EdgiOS/`
    and `EdgA/` come before `OPR/`, which comes before `CriOS/` and `Chrome/`, which come before
    `Safari/`.
  - `Platforms`, ten pairs with the same rule (lines 44-56): `Windows Phone` before `Windows`,
    `Mac OS X` and `Macintosh` before `Linux`, because an iPad reports "Macintosh" in desktop mode and
    Android reports "Linux" (lines 40-43).
  - `Parse(string? userAgent)` (line 66) returns `(null, null)` for a missing or blank header
    (lines 68-71), otherwise runs the shared matcher over each table and returns the pair (line 73).
  - `Match(userAgent, candidates)` (line 76) walks the table in order and returns the first name whose
    token appears case-insensitively, or `null` (lines 78-86).
- **Why it's built this way**: two ordered tables plus one loop is the entire implementation, so
  adding a browser is one line and the ordering rule is visible at the point it matters. It is
  `internal` because nothing outside the package should treat it as a UA parser.
- **Where it's used**: exactly one call site,
  [`Sessions.DescribeDevice`](#sessions)
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Sessions.razor.cs:181`), whose `switch`
  covers all four null combinations and falls back to a localized "unknown device" string
  (lines 183-189). Pinned by `UserAgentSummaryTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/UserAgentSummaryTests.cs:13`).
  The page itself is the UI half of
  [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html).

### AuthDelegatingHandler
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:9` · Level 1 · class (sealed)

- **What it is**: the `DelegatingHandler` that attaches the stored JWT as a `Bearer` header on every
  outgoing API request, so no UI service ever sets an `Authorization` header by hand.
- **Depends on**: [`ITokenStorageService`](#itokenstorageservice) (its only constructor parameter);
  externals `System.Net.Http.Headers.AuthenticationHeaderValue` and `DelegatingHandler`.
- **Concept introduced, the HTTP message-handler pipeline.** `HttpClient` composes handlers into a
  chain, each free to inspect or mutate a request before passing it to the next. Registering this one
  on the named `"APIClient"` client means auth is applied once, at the transport, for every typed
  service built on top of it.
  - `[Rubric §10, Cross-Cutting Concerns]` assesses whether concerns like auth are centralized rather
    than repeated per call. This is the client-side twin of the server's middleware pipeline: one
    registration covers every request.
  - `[Rubric §1, SOLID]` shows in the single responsibility. The handler knows nothing about login,
    refresh, or expiry; it asks storage for whatever token exists and moves on.
- **Walkthrough**: `SendAsync(request, cancellationToken)` (`AuthDelegatingHandler.cs:13`) awaits
  `GetAccessTokenAsync()` (line 17), and only when the result is non-blank sets
  `request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token)` (lines 18-21)
  before delegating to `base.SendAsync` (line 23). An anonymous call therefore goes out with no header
  at all rather than an empty one, which matters for the endpoints that are deliberately anonymous.
  Note the freshness work happens inside the token service: by the time this handler sees a token,
  a stale one has already been re-acquired.
- **Why it's built this way**: a handler rather than a base-class helper, because the pipeline applies
  to everything the named client sends, including calls made by code that never inherits from a
  framework base. It is registered `AddTransient`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:77`), the lifetime
  `AddHttpMessageHandler` expects.
- **Where it's used**: added to the `"APIClient"` pipeline alongside the culture handler
  (`DependencyInjection.cs:101-102`, with the intent stated at lines 75-76). One documented bypass
  exists: [`AuthenticatedServiceBase`](#authenticatedservicebase) builds a client with the token set
  directly for the cases where the pipeline is not in play
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/AuthenticatedServiceBase.cs:47`). Covered
  by `AuthDelegatingHandlerTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/AuthDelegatingHandlerTests.cs:15`)
  and by a DI resolution test that exists because the pipeline must be able to construct it
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/ApiClientRegistrationTests.cs:29`).

### ConfigurationOAuthUISettings
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/ConfigurationOAuthUISettings.cs:13` · Level 1 · class (sealed)

- **What it is**: the real [`IOAuthUISettings`](#ioauthuisettings): it computes provider availability
  once at construction from the `OAuth` configuration section, and covers both a server host and a
  WASM client with a single class.
- **Depends on**: [`IOAuthUISettings`](#ioauthuisettings) (the contract it implements); externally
  `Microsoft.Extensions.Configuration` (`IConfiguration`, `IConfigurationSection`).
- **Concept introduced, one class over two configuration shapes.** A server host holds the actual
  OAuth client ids, so "is Google available" is answered by whether `OAuth:Google:ClientId` is
  populated. A WASM client must never receive a client id, so it is handed pre-computed
  `OAuth:GoogleEnabled` flags through its runtime configuration endpoint instead
  (`ConfigurationOAuthUISettings.cs:5-12`). The class accepts either signal.
  - `[Rubric §26, Front-End Security]` assesses what configuration reaches the browser. The WASM path
    carries availability flags only, never the client id, and the class shape is what makes that
    possible without a second implementation.
  - `[Rubric §16, Maintainability]` assesses duplication. One class, one rule, three providers.
- **Walkthrough**: three get-only auto-properties (`ConfigurationOAuthUISettings.cs:16,19,22`) set in
  the constructor (line 24), which null-guards the configuration (line 26), takes the `OAuth` section
  (line 28) and evaluates each provider through the shared helper (lines 29-31).
  `IsProviderEnabled(oauth, provider)` (line 34) is the whole rule: parse `{provider}Enabled` as a
  bool (line 36), and return true when that flag is set **or** when `{provider}:ClientId` is non-empty
  (line 37). Because the values are read once into properties, a render pass never re-walks
  configuration.
- **Why it's built this way**: the flag-or-client-id disjunction is what lets the same type serve both
  hosts. The server side of the pairing is documented from the API package, which notes that the same
  `OAuth:{Provider}:ClientId` keys the API reads are what this class reads for its `GoogleEnabled` /
  `GitHubEnabled` answers
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authentication/ExternalAuthExtensions.cs:17`). The
  federated-login design behind the flags is
  [ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html).
- **Where it's used**: MMCA.ADC registers it with `AddSingleton` (which replaces the framework's
  `TryAddSingleton` default regardless of ordering) on the Blazor Server head
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:52`), the WASM client
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:42`) and MAUI
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:97`, whose comment at line 78 explains that
  the MAUI registration goes before `AddUIShared` because that call `TryAdd`s the default). The
  server head also projects the resolved flags to the WASM client through its `/client-config`
  endpoint (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:145`).

### DefaultOAuthUISettings
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/DefaultOAuthUISettings.cs:7` · Level 1 · class (internal, sealed)

- **What it is**: the framework's no-op [`IOAuthUISettings`](#ioauthuisettings), which reports every
  provider as unavailable so an app that has not configured external login shows no social buttons.
- **Depends on**: [`IOAuthUISettings`](#ioauthuisettings) only.
- **Concept reinforced, the Null Object as a registration default** (the same move
  [`NullNotificationScopeProvider`](#nullnotificationscopeprovider) makes for notification scoping).
  `[Rubric §2, Design Patterns]` assesses whether a pattern removes branching: because a default is
  always registered, the login page injects the interface unconditionally and never tests whether one
  exists.
- **Walkthrough**: the entire type is one line,
  `internal sealed class DefaultOAuthUISettings : IOAuthUISettings;`
  (`DefaultOAuthUISettings.cs:7`). It has no members because
  [`IOAuthUISettings`](#ioauthuisettings) gives all three properties `false`-returning default
  implementations; the class doc records the contract, that downstream apps override this registration
  to enable specific providers (lines 3-6).
- **Why it's built this way**: `internal` because nothing outside the package should name it, and a
  semicolon body because the default interface members already say everything. It is registered with
  `TryAddSingleton` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:135`), so
  a host that registers first keeps its own, and a host that registers afterwards with `AddSingleton`
  wins the resolution.
- **Where it's used**: resolved as [`IOAuthUISettings`](#ioauthuisettings) in every host that has not
  registered its own, which today is all of MMCA.Store's UI heads and MMCA.Helpdesk.

### DirectApiTokenRefresher
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/DirectApiTokenRefresher.cs:18` · Level 1 · class (sealed)

- **What it is**: the MAUI [`ITokenRefresher`](#itokenrefresher). It reads the token pair out of OS
  SecureStorage, exchanges it against the API's cross-origin `auth/refresh` endpoint, and writes the
  rotated pair back.
- **Depends on**: [`ISecureTokenStore`](#isecuretokenstore) (deliberately, not
  [`ITokenStorageService`](#itokenstorageservice)),
  [`RefreshTokenRequest`](group-08-auth.md#refreshtokenrequest) and
  [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) from `MMCA.Common.Shared.Auth`;
  externals `IHttpClientFactory` and `System.Net.Http.Json`.
- **Concept introduced, direct token handling where there is no DOM.** The class doc justifies the
  choice: MAUI has no browser and thus no XSS surface, so holding a refresh token client-side and
  posting it is acceptable there in a way it is not in a browser
  (`DirectApiTokenRefresher.cs:6-9`). This is the counterpart to
  [`SameOriginProxyTokenRefresher`](#sameoriginproxytokenrefresher), and reading the two together is
  the clearest statement of the framework's per-platform threat model.
  - `[Rubric §11, Security]` assesses per-platform credential handling, exactly as above.
  - `[Rubric §1, SOLID]`, dependency direction: the second doc paragraph is unusually explicit
    (lines 10-16). Every operation it performs is a raw read or write, so it takes the raw store;
    taking [`ITokenStorageService`](#itokenstorageservice) instead would close the loop and let a
    refresh re-enter the acquisition that started it.
- **Walkthrough**: `AcquireAccessTokenAsync(cancellationToken)` (`DirectApiTokenRefresher.cs:24`) is a
  straight line of early returns, each producing `null` rather than an exception:
  - read both tokens from the store (lines 26-27), and bail when either is blank (lines 29-32), so a
    never-logged-in device costs one storage read and no network call;
  - create the named `"APIClient"` (`ApiClientName`, line 22) and POST a
    [`RefreshTokenRequest`](group-08-auth.md#refreshtokenrequest) carrying both tokens to the relative
    `auth/refresh` (lines 34-36);
  - bail on any non-success status (lines 38-41), which is how a revoked or reused refresh token
    arrives;
  - deserialize an [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) and bail when
    the access token came back blank (lines 43-47);
  - persist the rotated pair through [`ISecureTokenStore.SetTokensAsync`](#isecuretokenstore) and
    return the new access token (lines 49-50).
- **Why it's built this way**: the rotation-on-refresh shape it participates in is
  [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html), which made
  refresh sessions hashed, rotating and per device: writing the returned pair back is not an
  optimization, it is required, because the old refresh token is dead after the exchange. The
  `using var httpClient` (line 34) and the relative `Uri` both lean on the named client configured
  once in `AddUIShared` (`DependencyInjection.cs:81-102`).
- **Where it's used**: registered on the MAUI head,
  `AddScoped<ITokenRefresher, DirectApiTokenRefresher>()`
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:97`). Covered by
  `DirectApiTokenRefresherTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/DirectApiTokenRefresherTests.cs:17`),
  which mocks the store and the HTTP handler (lines 22-34).

### JsFetchSessionCookieSync
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JsFetchSessionCookieSync.cs:11` · Level 1 · class (sealed)

- **What it is**: the [`ISessionCookieSync`](#isessioncookiesync) implementation. It calls two small JS
  helpers that issue a browser-side `fetch`, so the resulting `Set-Cookie` lands in the user's cookie
  jar on both Blazor Server and WebAssembly.
- **Depends on**: [`ISessionCookieSync`](#isessioncookiesync) (the contract) and `IJSRuntime`
  (`Microsoft.JSInterop`), plus the `mmcaAuthCookie` object defined in the package's static web asset
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/wwwroot/mmca-auth-cookie.js:4`.
- **Concept introduced, why the fetch has to come from the browser.** On Blazor Server the code runs on
  the server, so a server-issued HTTP call would put the cookie in the server's own handler, not the
  user's browser. Routing the call through JS interop makes the browser the one issuing the request,
  which is the only way the `Set-Cookie` reaches the right cookie jar
  (`JsFetchSessionCookieSync.cs:5-9`).
  - `[Rubric §26, Front-End Security]` again: the tokens transit JS only for this one same-origin POST
    and are never persisted anywhere JS can read afterwards.
  - `[Rubric §29, Resilience & Business Continuity]` assesses degradation. Every interop failure is
    absorbed, so a prerender pass or a disconnected circuit cannot throw out of a token write.
- **Walkthrough**:
  - `IsInteropUnavailable(ex)` (`JsFetchSessionCookieSync.cs:13`) is the shared exception filter,
    naming the four types that mean "there is no live JS runtime right now":
    `InvalidOperationException`, `JSDisconnectedException`, `JSException` and
    `OperationCanceledException` (line 14).
  - `SyncAsync(accessToken, refreshToken)` (line 16) invokes `mmcaAuthCookie.set` with both tokens
    (line 20) and swallows an interop failure, the comment noting the cookie will be synced on the
    next write (lines 22-25).
  - `ClearAsync()` (line 28) invokes `mmcaAuthCookie.clear` (line 32) under the same filter, the
    comment noting the cookie will still be cleared when the user next logs in or the token expires
    (lines 34-37).
- **Why it's built this way**: a shared static filter rather than two duplicated `when` clauses keeps
  the definition of "interop unavailable" in one place, and swallowing rather than rethrowing matches
  the fact that this is a mirror of state that already exists in memory. The cookie contract itself
  belongs to [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html).
- **Where it's used**: `TryAddScoped` behind [`ISessionCookieSync`](#isessioncookiesync) by
  `AddClientAuthSessionCookieSync()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:172`); consumed by
  [`WasmTokenStorageService`](#wasmtokenstorageservice) and
  [`ServerTokenStorageService`](#servertokenstorageservice).
- **Caveats / not-in-source**: the `mmcaAuthCookie.set` / `.clear` JS implementations live in
  `mmca-auth-cookie.js`, outside this unit; only the C# side is described here.

### JwtAuthenticationStateProvider
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JwtAuthenticationStateProvider.cs:12` · Level 1 · class (sealed)

- **What it is**: the custom `AuthenticationStateProvider` that turns the stored JWT into the
  `ClaimsPrincipal` Blazor's `AuthorizeView` and `[Authorize]` read, and pushes a new state
  immediately on login and logout.
- **Depends on**: [`ITokenStorageService`](#itokenstorageservice) (its only constructor parameter);
  externals `Microsoft.AspNetCore.Components.Authorization.AuthenticationStateProvider`,
  `System.Security.Claims` and `JwtSecurityTokenHandler`.
- **Concept introduced, Blazor's auth-state contract.** Blazor does not know about JWTs; it asks an
  `AuthenticationStateProvider` for an `AuthenticationState` and re-renders every
  `CascadingAuthenticationState` consumer when the provider says the state changed. This class is the
  adapter between "there is a token in storage" and that framework contract.
  - `[Rubric §19, State Management & Data Flow]` assesses how a cross-cutting piece of UI state
    propagates. Notifying rather than reloading is the whole point: a sign-in updates the navbar and
    every guarded fragment without a page refresh (lines 55-58).
  - `[Rubric §11, Security]` assesses the trust boundary, and the class doc draws it: claims are
    extracted client-side without server validation to keep the UI responsive, and the WebAPI performs
    full token validation on every request (lines 7-11).
- **Walkthrough**:
  - `AnonymousState`, a single static `AuthenticationState` over an empty `ClaimsIdentity`
    (`JwtAuthenticationStateProvider.cs:14-15`). Because a `ClaimsIdentity` with no authentication
    type reports `IsAuthenticated == false`, this one shared instance is the "signed out" answer.
  - `GetAuthenticationStateAsync()` (line 22) reads the token (line 26) and returns the anonymous
    state on a blank token (lines 27-30), an unreadable token (lines 33-36), or an expired one
    (`ValidTo < DateTime.UtcNow`, lines 39-42). On success it builds a `ClaimsIdentity` from the
    token's claims with the authentication type `"jwt"`, and the comment at line 44 records why that
    string matters: naming an authentication type is what makes the identity `IsAuthenticated`. A
    bare `catch` (lines 49-52) turns any remaining failure, including JS interop being unavailable,
    into anonymous rather than an exception inside a render.
  - `NotifyUserAuthentication(token)` (line 59) rebuilds the principal the same way and calls the base
    `NotifyAuthenticationStateChanged` (line 65). It does not consult storage, because the caller has
    just been handed the token.
  - `NotifyUserLogout()` (line 71) pushes `AnonymousState` back out.
- **Why it's built this way**: falling back to anonymous on every failure is the safe direction for a
  UI gate, since the API rejects anything the client wrongly let through. Keeping the two notify
  methods public (rather than internal to the auth service) is what lets
  [`AuthUIService`](#authuiservice) drive the state transition at the exact moment tokens change; it
  does so behind an `is JwtAuthenticationStateProvider` type test
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:129,158,166,300`),
  so a host that registered a different provider still works.
- **Where it's used**: registered against `AuthenticationStateProvider` on every head
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:116`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:46`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiProgram.cs:98`). Covered by
  `JwtAuthenticationStateProviderTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/JwtAuthenticationStateProviderTests.cs:13`);
  `AuthUIServiceTests` constructs a real one rather than a double, precisely because the type test
  above would not match a mock
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/AuthUIServiceTests.cs:63-65`).

### SameOriginProxyTokenRefresher
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/SameOriginProxyTokenRefresher.cs:11` · Level 1 · class (sealed)

- **What it is**: the browser [`ITokenRefresher`](#itokenrefresher), used by both Blazor Server and
  WebAssembly. It asks a JS helper to POST the same-origin `/auth/session/token` endpoint and returns
  whatever access token comes back.
- **Depends on**: [`ITokenRefresher`](#itokenrefresher) (the contract) and `IJSRuntime`, plus the
  `mmcaAuthSession` helper in
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/wwwroot/mmca-auth-cookie.js:32`, whose `getToken`
  issues the `fetch` (line 35).
- **Concept introduced, the BFF hop.** The refresh token never enters this process. The browser sends
  its HttpOnly cookies with `credentials:'same-origin'`, the UI host validates or refreshes
  server-side, and only the access token comes back over the wire
  (`SameOriginProxyTokenRefresher.cs:5-9`). The server half is
  `SessionCookieEndpoints`, which maps `POST /auth/session/token`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:45`).
  - `[Rubric §26, Front-End Security]` assesses whether a long-lived credential is reachable from
    scripts. It is not: an XSS on this page can steal an access token that expires in minutes, not the
    refresh token behind it.
  - `[Rubric §7, Microservices Readiness]` shows in the origin choice. The call goes to the UI host,
    not the API, so it stays same-origin and needs no CORS or cross-site cookie policy.
- **Walkthrough**: the entire class is one method.
  `AcquireAccessTokenAsync(cancellationToken)` (`SameOriginProxyTokenRefresher.cs:13`) invokes
  `mmcaAuthSession.getToken` through interop (line 17) and normalizes a blank result to `null`
  (line 18). The same four interop-unavailable exception types
  [`JsFetchSessionCookieSync`](#jsfetchsessioncookiesync) filters on are caught here inline
  (line 20) and reported as `null`, with the comment recording that the server-side cookie path
  already covers the prerender and disconnected phases (lines 22-24).
- **Why it's built this way**: a proxy hop instead of a direct API call is the decision recorded in
  [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html), including the
  `SameSite=Lax` plus `Sec-Fetch-Site` check that hardens the refresh endpoint. Returning `null`
  rather than throwing satisfies the [`ITokenRefresher`](#itokenrefresher) contract, so token storage
  never has to distinguish "no session" from "interop not ready".
- **Where it's used**: registered on both browser heads
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:115` and
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:45`); consumed indirectly by
  [`WasmTokenStorageService`](#wasmtokenstorageservice) and
  [`ServerTokenStorageService`](#servertokenstorageservice). Covered by
  `SameOriginProxyTokenRefresherTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/SameOriginProxyTokenRefresherTests.cs:14`).

### WasmTokenStorageService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/WasmTokenStorageService.cs:11` · Level 1 · class (sealed)

- **What it is**: the WebAssembly [`ITokenStorageService`](#itokenstorageservice). The access token
  lives in memory only and is hydrated on demand from the HttpOnly cookies; there is no `localStorage`
  anywhere in it.
- **Depends on**: [`ISessionCookieSync`](#isessioncookiesync) and
  [`ITokenRefresher`](#itokenrefresher) (both constructor parameters,
  `WasmTokenStorageService.cs:11-13`), plus [`JwtTokenInfo`](#jwttokeninfo) for the freshness check;
  externals `System.Threading.Lock`.
- **Concept introduced, single-flight hydration.** Several callers can ask for a token in the same
  instant: the [`AuthDelegatingHandler`](#authdelegatinghandler) on an outgoing request, the
  [`JwtAuthenticationStateProvider`](#jwtauthenticationstateprovider) during a render, and
  [`NotificationHubService`](#notificationhubservice)'s access-token provider. Without coordination
  each would start its own refresh, and the last one to finish would overwrite the others' token. The
  fix is to share one in-flight `Task`, and the source is explicit that the lock, not a `??=`, is what
  makes it single (lines 29-32).
  - `[Rubric §19, State Management & Data Flow]` assesses ownership of shared per-circuit state; the
    in-memory token and its in-flight hydration are exactly that.
  - `[Rubric §12, Performance & Scalability]` assesses redundant work: a burst of concurrent callers
    costs one network round trip, not one each.
  - `[Rubric §11, Security]` assesses at-rest exposure. The refresh token is never held client-side,
    the comment at line 58 saying it lives only in the HttpOnly cookie.
- **Walkthrough**:
  - `ExpirySkew`, 30 seconds (`WasmTokenStorageService.cs:15`), the proactive margin handed to
    [`JwtTokenInfo.IsFresh`](#jwttokeninfo).
  - `_hydrateSync` (line 17), the `Lock`; `_accessToken` (line 19), the in-memory token; and
    `_hydrateInFlight` (line 20), the shared hydration task.
  - `GetAccessTokenAsync()` (line 22) returns the cached token immediately when it is fresh
    (lines 24-27). Otherwise it takes the lock only long enough to publish or read the in-flight task
    (lines 33-38), which is safe because `HydrateAsync` reaches its first `await` immediately so
    nothing slow runs under the lock (line 32). It then awaits the shared task (line 42) and, in a
    `finally`, clears `_hydrateInFlight` **only if it is still the same task**
    (`ReferenceEquals`, lines 48-54). That guard is the subtle half: an unguarded clear can drop a
    newer hydrate started after this one completed, splitting the next set of callers all over again
    (lines 46-47).
  - `GetRefreshTokenAsync()` (line 59) returns `null` unconditionally, an honest answer rather than a
    stub: in the browser there is nothing to return.
  - `SetTokensAsync(accessToken, refreshToken)` (line 61) stores the access token in memory and seeds
    the HttpOnly cookies through [`ISessionCookieSync.SyncAsync`](#isessioncookiesync) (line 66); the
    comment records that the refresh token transits JS only for that same-origin POST (lines 64-65).
  - `ClearTokensAsync()` (line 69) nulls the field and clears the cookies (lines 71-72).
  - `HydrateAsync()` (line 75) is one line of work: call
    [`ITokenRefresher.AcquireAccessTokenAsync`](#itokenrefresher), store the result, return it
    (lines 77-78).
- **Why it's built this way**: the class doc records that it was hoisted out of the app WASM clients
  because it carries no app-specific state, and names its Blazor Server sibling
  [`ServerTokenStorageService`](#servertokenstorageservice) in
  MMCA.Common.UI.Web (lines 3-10). The two share the skew constant, the `Lock`, and the same
  single-flight shape; the server one adds an `HttpContext` branch for the prerender pass. The
  cookie-only storage model is [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html).
- **Where it's used**: registered on the WASM client,
  `AddScoped<ITokenStorageService, WasmTokenStorageService>()`
  (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:44`). Covered by
  `WasmTokenStorageServiceTests`, which drives the concurrency path directly
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/WasmTokenStorageServiceTests.cs:15,103`).

### IAuthUIService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/IAuthUIService.cs:16` · Level 5 · interface

- **What it is**: the single client-side authentication contract: login, register, OAuth code
  exchange, logout, refresh, the three password flows, and the signed-in-devices list with revoke.
  Every auth page in the framework talks to this and nothing else.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and its generic form from
  `MMCA.Common.Shared.Abstractions`; the `MMCA.Common.Shared.Auth` contracts
  [`LoginRequest`](group-08-auth.md#loginrequest),
  [`RegisterRequest`](group-08-auth.md#registerrequest),
  [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) and
  [`RefreshSessionSummaryResponse`](group-08-auth.md#refreshsessionsummaryresponse); and
  [`ErrorType`](group-01-result-error-handling.md#errortype) for the failure kinds it documents.
  Implemented by [`AuthUIService`](#authuiservice).
- **Concept introduced, the failure travels with the call.** The interface doc states the rule
  (`IAuthUIService.cs:9-14`): every call that talks to the API returns a
  [`Result`](group-01-result-error-handling.md#result) carrying the server's own errors, so the
  failure arrives with the call rather than on a `LastError` property that the next call would
  overwrite. Pages render it through `MMCA.Common.UI.Common.ResultUiExtensions`
  ([`ResultUiExtensions`](#resultuiextensions)).
  - `[Rubric §9, API & Contract Design]` assesses whether return types carry meaning. Three different
    shapes appear here on purpose, and each deviation is argued in source rather than assumed.
  - `[Rubric §24, Forms, Validation & UX Safety]` assesses whether a form can show the server's real
    message. Because the failure is the return value, a login page can bind the error next to the
    field without a second lookup.
  - `[Rubric §11, Security]` shows in two documented behaviors: the anti-enumeration contract on
    password reset, and the OAuth exchange keeping tokens out of the address bar.
- **Walkthrough**: eleven members, in the order they appear.
  - `LoginAsync(LoginRequest, ct)` and `RegisterAsync(RegisterRequest, ct)` both return
    `Result<AuthenticationResponse>` and both store tokens on success
    (`IAuthUIService.cs:19,22`).
  - `ExchangeOAuthCodeAsync(code, ct)` (line 29) trades a single-use completion code carried in the
    redirect URL for the token pair through `auth/oauth/exchange`, stores the tokens and notifies auth
    state; the doc's closing sentence names the reason for the indirection, keeping tokens out of the
    address bar (lines 24-28).
  - `LogoutAsync()` (line 37) is the deliberate no-`Result` member: it revokes the server-side refresh
    sessions and clears local storage, and returns nothing because the local sign-out happens whatever
    the server answered. A user who asked to leave must never be kept signed in by a failed network
    call (lines 31-36).
  - `TryRefreshTokenAsync(ct)` (line 45) is the deliberate `bool` member: it makes no API call of its
    own, since the host's [`ITokenRefresher`](#itokenrefresher) owns the exchange, and its two states
    ("session still live", "session gone") are not errors to render (lines 39-44).
  - `ChangePasswordAsync(currentPassword, newPassword, ct)` (line 48) hits `auth/password`.
  - `RequestPasswordResetAsync(email, ct)` (line 55) hits the anonymous `auth/forgot-password`. The
    doc pins the semantics: the endpoint answers 202 for every well-formed address as an
    anti-enumeration measure, so a success means "accepted", never "an account exists"
    (lines 50-54).
  - `ResetPasswordAsync(email, token, newPassword, ct)` (line 62) completes the reset via the
    anonymous `auth/reset-password`; an invalid, expired or already-consumed token comes back as a
    failure carrying the server's generic message (lines 57-61).
  - `GetSessionsAsync(ct)` (line 70) returns
    `Result<IReadOnlyList<RefreshSessionSummaryResponse>>` from `auth/my-sessions`, newest first, and
    documents that exactly one row can carry `IsCurrent`, resolved server-side from the access token's
    `sid` claim (lines 64-69).
  - `RevokeSessionAsync(sessionId, ct)` (line 79) signs one device out via `auth/revoke/{sessionId}`;
    another account's session id (or a nonexistent one) answers 404 and arrives as an
    [`ErrorType`](group-01-result-error-handling.md#errortype)`.NotFound` failure, while revoking an
    already-revoked session succeeds (lines 72-76).
- **Why it's built this way**: the interface is where the three return shapes are justified, and each
  justification is a behavior rule rather than a style preference. Keeping all eleven operations on
  one contract (rather than splitting sessions or password flows onto their own) matches how they are
  consumed: the shipped auth pages are themselves framework types, so there is one implementation and
  one registration. The device-list and revoke members are the UI surface of
  [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html); the OAuth
  exchange is the client end of
  [ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html) and
  [ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html).
- **Where it's used**: registered `TryAddScoped` against [`AuthUIService`](#authuiservice) by
  `AddUIShared()` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:109`, the
  comment at line 108 noting `TryAdd` prevents duplicate registration when several hosts call in);
  injected by the shipped auth pages, including `Login`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor`) and
  [`Sessions`](#sessions).

### AuthUIService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Auth` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:34` · Level 6 · class (sealed)

- **What it is**: the one client-side service that owns a user's session on a Blazor or MAUI head. It
  calls the WebAPI `auth/*` endpoints (sign in, register, OAuth code exchange, change password, forgot
  and reset password, list and revoke devices, sign out), persists the returned token pair, and tells
  Blazor's authentication state that something changed, so `AuthorizeView` and `[Authorize]` routes
  react without a page reload. Every method that talks to the API hands back a
  [Result](group-01-result-error-handling.md#result) carrying the server's own error text, so no page
  has to interpret an `HttpResponseMessage`.
- **Depends on**: first-party
  [IAuthUIService](#iauthuiservice) (the contract it implements, `AuthUIService.cs:40`),
  [ITokenStorageService](#itokenstorageservice) (token persistence, injected at `AuthUIService.cs:36`),
  [ITokenRefresher](#itokenrefresher) (the host-specific renewal path, `AuthUIService.cs:37`),
  [JwtAuthenticationStateProvider](#jwtauthenticationstateprovider) (injected as the framework
  `AuthenticationStateProvider` base type at `AuthUIService.cs:38` and pattern-matched back down),
  [IPushRegistrationService](group-26-device-capability-layer.md#ipushregistrationservice) (native push
  cleanup, `AuthUIService.cs:39`),
  [IUiReadCache](#iuireadcache) (optional, defaulted to `null` at `AuthUIService.cs:40`),
  [HttpResultExecutor](#httpresultexecutor) (transport-fault translation),
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader) (response translation), and
  the shared auth contracts
  [LoginRequest](group-08-auth.md#loginrequest),
  [RegisterRequest](group-08-auth.md#registerrequest),
  [OAuthCodeExchangeRequest](group-08-auth.md#oauthcodeexchangerequest),
  [ChangePasswordRequest](group-08-auth.md#changepasswordrequest),
  [ForgotPasswordRequest](group-08-auth.md#forgotpasswordrequest),
  [ResetPasswordRequest](group-08-auth.md#resetpasswordrequest),
  [AuthenticationResponse](group-08-auth.md#authenticationresponse) and
  [RefreshSessionSummaryResponse](group-08-auth.md#refreshsessionsummaryresponse).
  Externals: `IHttpClientFactory`, `System.Net.Http.Json` (`PostAsJsonAsync`, `PutAsJsonAsync`),
  `System.Net.Http.Headers.AuthenticationHeaderValue`, and
  `Microsoft.AspNetCore.Components.Authorization.AuthenticationStateProvider`.
- **Concept introduced, the client-side session lifecycle as one service, with a sign-out that cannot
  fail.** Everything a session needs on the client (acquire a token pair, hold it, renew it, publish the
  identity to the component tree, and tear all of that down) lives behind a single injectable interface,
  so no component ever touches `localStorage`, a Bearer header, or a token string.
  `[Rubric §26, Front-End Security]` assesses whether credentials are confined to a narrow, auditable
  surface in the browser: here the only code that reads or writes tokens is this service plus
  [AuthDelegatingHandler](#authdelegatinghandler), both of them going through
  [ITokenStorageService](#itokenstorageservice) rather than doing JS interop of their own.
  `[Rubric §11, Security]` assesses the end-to-end auth design: sign-out is deliberately **local-first**,
  the remote revoke is best effort, and both the server call and the local clear are wrapped so a dropped
  connection can never strand a user inside a session they asked to leave (`AuthUIService.cs:100-133`).
  `[Rubric §19, State Management]` assesses who owns mutable client state and when it is invalidated:
  this service is the single writer of auth state, and it is also the thing that empties the read cache,
  because on WebAssembly and MAUI the DI scope is the app lifetime, so cached rows would otherwise
  outlive the account that fetched them (`AuthUIService.cs:29-33`, `124-127`).
  `[Rubric §18, UI Architecture]` sees the same shape the entity services use, a typed service over the
  named `"APIClient"` returning `Result`, so pages render failures with
  [ResultUiExtensions](#resultuiextensions) instead of catching exceptions.
  `[Rubric §14, Testability]` is served by taking all five collaborators through the primary constructor
  with no statics: [AuthUIServiceTests](group-27-testing-infrastructure.md#authuiservicetests) drives the
  whole class through a stub `HttpMessageHandler`.
- **Walkthrough**
  - Two public error codes head the class. `TokenStorageUnavailableCode = "Auth.TokenStorageUnavailable"`
    (`AuthUIService.cs:46`) is reported when authentication succeeded but the tokens could not be written
    because JS interop was unavailable (SSR prerender, or a render-mode transition), and
    `MissingAccessTokenCode = "Auth.MissingAccessToken"` (`AuthUIService.cs:52`) covers a 2xx whose body
    carried no access token, which means the response shape drifted. Both are `const string`, so tests
    and pages branch on them without duplicating literals. The private `ApiClientName = "APIClient"`
    (`AuthUIService.cs:54`) names the shared client registered in
    `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:80`.
  - `LoginAsync` and `RegisterAsync` are one-liners over the private `AuthenticateAsync`, differing only
    in the relative URL, `auth/login` and `auth/register` (`AuthUIService.cs:57-62`).
  - `ExchangeOAuthCodeAsync` (`AuthUIService.cs:65`) guards the code client-side first: a blank code
    returns `Error.Validation("Auth.OAuth.MissingCode", ...)` without a round trip
    (`AuthUIService.cs:67-71`), then it posts an
    [OAuthCodeExchangeRequest](group-08-auth.md#oauthcodeexchangerequest) to `auth/oauth/exchange`
    (`AuthUIService.cs:73`). The single-use code arrives in the redirect URL, which is what keeps the
    tokens themselves out of the address bar (ADR-036,
    `Website/docs-src/adr/036-external-oauth-login.md`).
  - `AuthenticateAsync` (`AuthUIService.cs:259`) is the shared body of all three. It posts the credential
    through [HttpResultExecutor](#httpresultexecutor) and reads the response with
    `ProblemDetailsResultReader.ReadAsync<AuthenticationResponse>` (`AuthUIService.cs:264-271`), returns
    early on failure (`273-276`), then checks the access token is actually present and fails with
    `MissingAccessTokenCode` if it is not (`279-283`). Only then does it call
    `tokenStorageService.SetTokensAsync` inside a `try` that converts an `InvalidOperationException` into
    a `TokenStorageUnavailableCode` failure carrying the exception message as detail (`285-298`). The
    point of that branch is that valid credentials nothing can hold are a failure, not a silent no-op.
    Finally it pattern-matches the injected `AuthenticationStateProvider` down to
    [JwtAuthenticationStateProvider](#jwtauthenticationstateprovider) and calls
    `NotifyUserAuthentication(accessToken)` (`300-303`, and
    `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/JwtAuthenticationStateProvider.cs:59`).
    The `is` test rather than a cast is what lets a host register a different provider without breaking
    sign-in.
  - `LogoutAsync` (`AuthUIService.cs:77`) runs four steps, each isolated so a failure cannot stop the
    next. First `pushRegistration.UnregisterAsync()` inside a bare `catch` (`82-91`): the Devices DELETE
    is authenticated, so it has to happen while the access token is still valid, and it is a no-op on web
    heads (ADR-044, `Website/docs-src/adr/044-native-push-delivery.md`). Second, if a token can be read,
    a Bearer header is attached and `auth/revoke` is posted, again inside a `catch` (`93-113`). Third,
    `tokenStorageService.ClearTokensAsync()` under `catch (InvalidOperationException)` for the
    interop-unavailable case (`115-122`). Fourth, `readCache?.Clear()` (`127`) and `NotifyUserLogout()`
    (`129-132`, and `.../Services/Auth/JwtAuthenticationStateProvider.cs:71`). The two
    `#pragma warning disable CA1031` blocks (`86-88`, `107-109`) are deliberate and annotated in place:
    catching everything is the correct policy for a best-effort cleanup step.
  - `TryRefreshTokenAsync` (`AuthUIService.cs:136`) makes no HTTP call of its own. It asks
    `tokenRefresher.AcquireAccessTokenAsync` for a token (`141`); browser hosts renew through the
    same-origin cookie proxy so the refresh token never reaches JS
    ([SameOriginProxyTokenRefresher](#sameoriginproxytokenrefresher)) and MAUI renews straight from
    secure storage ([DirectApiTokenRefresher](#directapitokenrefresher)). A null or blank answer means
    the session is gone, which this method treats exactly like a sign-out: clear tokens, clear the read
    cache, notify logout, return `false` (`143-164`). A token that comes back is published with
    `NotifyUserAuthentication` and answered with `true` (`166-171`). The `bool` return is the honest type
    here, because neither outcome is an error a page would render (`IAuthUIService.cs:39-45`).
  - The password trio all wrap [HttpResultExecutor](#httpresultexecutor).
    `ChangePasswordAsync` (`175`) is the only one that authenticates: it builds a
    [ChangePasswordRequest](group-08-auth.md#changepasswordrequest) and `PUT`s it to `auth/password`
    (`179-188`). `RequestPasswordResetAsync` (`191`) and `ResetPasswordAsync` (`208`) deliberately use
    the plain factory client with no Bearer header (`197`, `216`), because a reset must not be bound to
    whatever session happens to be open. The comment at `201-202` records the contract that matters:
    `auth/forgot-password` answers 202 for every well-formed address, so a success never means "this
    account exists".
  - The two session methods back the devices page. `GetSessionsAsync` (`226`) `GET`s `auth/my-sessions`
    and reads it with the **generic** reader into `IReadOnlyList<RefreshSessionSummaryResponse>`
    (`234-235`). `RevokeSessionAsync` (`240`) posts `auth/revoke/{sessionId}` and reads it with the
    **non-generic** reader (`249-250`), because that endpoint answers 204 and
    [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader)'s generic overload turns an
    empty 2xx body into an `EmptyResponseCode` failure
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ProblemDetailsResultReader.cs:274-279`). Picking
    the wrong overload there would turn every successful revoke into an error.
  - Two private helpers close the class. `CreateAuthenticatedClientAsync` (`314`) creates the APIClient
    and sets `DefaultRequestHeaders.Authorization` from the stored token; its doc comment states plainly
    that it mirrors [AuthenticatedServiceBase](#authenticatedservicebase) and cannot inherit it, because
    this is not an entity service and takes a different dependency set (`308-313`).
    `ReadAccessTokenAsync` (`327`) swallows `InvalidOperationException` from the store and returns `null`,
    so an SSR prerender proceeds tokenless and lets the API answer 401 like any other failure
    (`333-338`).
- **Why it's built this way**: ADR-051 (`Website/docs-src/adr/051-client-auth-token-lifecycle.md`) is the
  record behind the split visible in the constructor: storage, renewal and orchestration are three
  different abstractions because each render mode (SSR prerender, Blazor Server, WebAssembly, MAUI) can
  hold and renew a credential differently, while the orchestration above them stays identical. The
  refresh path itself is server-side rotation with reuse detection (ADR-050,
  `Website/docs-src/adr/050-jwt-refresh-token-rotation.md`), generalized to one row per device by ADR-097
  (`Website/docs-src/adr/097-multi-device-refresh-sessions.md`), which is what gives `GetSessionsAsync`
  and `RevokeSessionAsync` something to list and revoke. Browser hosts keep the refresh token in an
  HttpOnly cookie rather than in reachable storage (ADR-022,
  `Website/docs-src/adr/022-browser-session-cookie-auth.md`), which is exactly why `TryRefreshTokenAsync`
  delegates instead of calling a refresh endpoint itself. Returning `Result` instead of throwing keeps
  every auth failure renderable: the API's Problem Details payload already carries the server's own
  wording and [ErrorType](group-01-result-error-handling.md#errortype), so the page shows that rather
  than a client-invented message.
- **Where it's used**: registered `TryAddScoped<IAuthUIService, AuthUIService>()` in
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:109`, so every host that adds
  the shared UI gets it. Consumers inside the shared UI are the auth pages
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Login.razor:204`,
  `Pages/Auth/Register.razor:161`, `Pages/Auth/OAuthComplete.razor:65`,
  `Pages/Auth/ForgotPassword.razor:81`, `Pages/Auth/ResetPassword.razor:122`), the devices page
  [Sessions](#sessions) (`Pages/Auth/Sessions.razor.cs:79`, `119`, `165`), and both shells
  (`Layout/MainLayout.razor:108`, `Layout/NavMenu.razor:185`, which call `LogoutAsync`). Downstream, the
  ADC and Store profile pages call `ChangePasswordAsync`
  ([Profile](group-24-identity-module.md#profile),
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor.cs:220` and
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.UI/Pages/Profile/Profile.razor.cs:252`). Note
  how `ForgotPassword.razor` consumes it: it discards the `Result` and swallows exceptions
  (`Pages/Auth/ForgotPassword.razor:75-92`), because the page must look identical whether or not the
  address exists. The component gallery substitutes
  [NoOpAuthUIService](group-27-testing-infrastructure.md#noopauthuiservice), and
  [AuthUIServiceTests](group-27-testing-infrastructure.md#authuiservicetests)
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Auth/AuthUIServiceTests.cs:34`) pins the
  behavior end to end, including the storage-unavailable and missing-token branches
  (`AuthUIServiceTests.cs:210`, `229`).
- **Caveats**: `TryRefreshTokenAsync` has no production call site in the workspace; the only callers are
  [AuthUIServiceTests](group-27-testing-infrastructure.md#authuiservicetests) (`AuthUIServiceTests.cs:440`,
  `454`) and the gallery stub. Renewal in a running app happens further down, inside the storage service
  and the refreshers, so this method is a public entry point that nothing currently enters. The
  `auth/revoke` call in `LogoutAsync` is described in the comment as "fire-and-forget" but is in fact
  awaited (`AuthUIService.cs:105`); the accurate reading is best-effort-and-ignored, and on a bad network
  the awaited call can add its full timeout to a sign-out. That same call passes no `CancellationToken`,
  because `LogoutAsync` takes none by design (`IAuthUIService.cs:37`). Finally,
  `CreateAuthenticatedClientAsync` sets a `DefaultRequestHeaders` Bearer while
  [AuthDelegatingHandler](#authdelegatinghandler) is already attaching one to every APIClient request
  from the same store (`DependencyInjection.cs:101`, `Services/Auth/AuthDelegatingHandler.cs:17-21`), so
  the header is computed twice per authenticated call; both values come from the same source, so this is
  redundancy rather than a defect.

### BackNavigationResult
> MMCA.Common.UI · `MMCA.Common.UI.Services.Navigation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/MauiBackNavigationBridge.cs:19` · Level 0 · record (sealed)

- **What it is**: the outcome of a hardware-back or WebView-back attempt routed through
  [MauiBackNavigationBridge](#mauibacknavigationbridge): whether the WebView consumed the gesture, and
  whether the WebView is sitting at the root of its history stack.
- **Depends on**: nothing first-party. It is a two-field positional record produced and consumed by
  [MauiBackNavigationBridge](#mauibacknavigationbridge).
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
  [MauiBackNavigationBridge](#mauibacknavigationbridge)`.HandleBackPressedAsync`; consumed by MAUI host
  `ContentPage.OnBackButtonPressed` handlers.

### ChannelReferenceCounter
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/ChannelReferenceCounter.cs:16` · Level 0 · class (internal, sealed)

- **What it is**: a small self-synchronized counter that tracks how many outstanding joins the circuit
  holds for each live-channel key, so [NotificationHubService](#notificationhubservice) tells the
  SignalR server to join a group on the first join and to leave it only on the last matching leave.
- **Depends on**: nothing first-party. It is a `System.Threading.Lock` plus a `Dictionary<string, int>`
  (BCL). It is owned as a private field by [NotificationHubService](#notificationhubservice)
  (`NotificationHubService.cs:42`), and sits beside (not inside) the separate handler bookkeeping that
  [ChannelSubscription](#channelsubscription) unwinds.
- **Concept introduced, reference-counted group membership.** `[Rubric §19, State Management & Data
  Flow]` assesses how a shared per-circuit resource is owned when more than one component holds it at
  once. A live channel is exactly that resource: an invisible layout listener and a page can both be
  watching `event:1`. The class remarks state why a set is the wrong structure
  (`ChannelReferenceCounter.cs:5-10`): with set semantics the first leaver removes the only entry and
  cuts the channel off for every other subscriber still holding it. Counting joins per key turns
  membership into two edges, 0 to 1 and 1 to 0, and only those two moments need to reach the server.
  `[Rubric §29, Resilience & Business Continuity]` applies as well, because `Snapshot()` is the replay
  list the hub service re-joins after an automatic reconnect.
  - `[Rubric §14, Testability]` shows in the visibility choice: the type is `internal` with an
    `InternalsVisibleTo` for the test project, and the project file records exactly why
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/MMCA.Common.UI.csproj:11-16`): the ref-count
    semantics cannot be reached through the public API, since `JoinChannelAsync` starts a real
    `HubConnection`, so a join-based test would need a live server and a multi-second backoff.
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
- **Why it's built this way**:
  [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) decided the shape this
  implements: one hub, `JoinChannel`/`LeaveChannel` mapping a connection into a SignalR group,
  multicast subscriptions so an invisible listener and a page can observe the same channel
  concurrently, and a re-join on `Reconnected` because group membership does not survive a new
  connection. The ADR says the hub service tracks membership; this class is *how* that tracking is done
  so two concurrent holders cannot evict each other.
- **Where it's used**: three call sites, all inside [NotificationHubService](#notificationhubservice):
  `AddRef` in `JoinChannelAsync` (`NotificationHubService.cs:197`, deliberately counted before the
  connection is started so the replay inside `StartAsync` sees it, line 196), `Release` in
  `LeaveChannelAsync` (line 229), and `Snapshot` in `RejoinChannelsAsync` (line 351). Covered directly
  by `ChannelReferenceCounterTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Notifications/NotificationHubServiceTests.cs:320`,
  whose summary names the H13 regression it locks down, lines 314-319). The two concurrent holders it
  exists for are real: [LiveEventListener](group-22-engagement-module.md#liveeventlistener) and the
  [HappeningNow](group-23-engagement-live-layer.md#happeningnow) page both join the same event
  channel key.
- **Caveats / not-in-source**: it counts joins only; it knows nothing about handlers. Subscriptions
  live in a separate `_channelSubscriptions` dictionary under a different lock
  (`NotificationHubService.cs:36,43`), so disposing a [ChannelSubscription](#channelsubscription)
  does not decrement the count, and leaving a channel does not remove handlers
  (`NotificationHubService.cs:221-222` states that pairing requirement).

### INotificationScopeProvider
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/INotificationScopeProvider.cs:15` · Level 0 · interface

- **What it is**: the contract that supplies the *scope key* the notification UI sends and reads under,
  plus an optional human-readable name for that scope, so an application can narrow its notifications
  to whatever it considers "current" (a conference event, a tenant, a season) without the framework
  knowing what that is.
- **Depends on**: nothing first-party. Both members return `Task<string?>` and take a
  `CancellationToken` (BCL). Implemented in the framework by
  [NullNotificationScopeProvider](#nullnotificationscopeprovider) and consumed by both notification
  HTTP services, [NotificationInboxService](#notificationinboxservice) and
  [PushNotificationService](#pushnotificationservice).
- **Concept introduced, the opaque scope key.** The framework ships the notification feature but has
  no vocabulary for *what* notifications belong to, so it inverts the question: the app answers with a
  string and the framework treats it as opaque (`INotificationScopeProvider.cs:3-8`). The value of
  putting one provider behind both HTTP services is agreement: a send and the reads that follow it
  resolve through the same instance, so the inbox, the unread badge and a bulk mark-read cannot
  disagree about which slice the user is looking at.
  - `[Rubric §9, API & Contract Design]` assesses contract minimality and the meaning of defaults. Both
    members return a nullable string, and null carries a defined meaning ("unscoped", "no caption"),
    which is what lets the scoped and unscoped worlds share one code path instead of branching.
  - **A default interface method as a non-breaking extension.**
    `GetCurrentScopeDisplayNameAsync` is declared with a body,
    `=> Task.FromResult<string?>(null)` (`INotificationScopeProvider.cs:39`), so an application with no
    display name, and every implementation written before the member existed, keeps compiling untouched
    (the rationale is stated in the doc at lines 29-35). `[Rubric §16, Maintainability]` assesses
    whether a contract can grow without a coordinated sweep across every implementor; a default member
    is the language feature that makes that possible here.
  - `[Rubric §11, Security]` assesses where authorization decisions live, and this contract is explicit
    that it is *not* one. The remarks require implementations never to throw, and they state the
    direction to fail in: in an application whose notifications are all scoped, **fail closed**, that
    is, return the last known scope key or fail the operation, rather than returning null, because
    degrading to null silently widens the view to every notification
    (`INotificationScopeProvider.cs:9-14`). Null is reserved for an application that genuinely runs
    unscoped. Ownership filtering itself stays on the server: a scope is a view filter, not a
    permission.
  - The display-name member fails closed differently, and the source says so: a missing caption hides
    information, while a wrong one would state the wrong audience, so returning null is the safe
    direction there (`INotificationScopeProvider.cs:32-35`).
- **Walkthrough**: two members.
  - `Task<string?> GetCurrentScopeKeyAsync(CancellationToken ct = default)`
    (`INotificationScopeProvider.cs:22`) returns the key currently in force (the example in source is
    `"event:2"`) or null when the application is unscoped (lines 17-21).
  - `Task<string?> GetCurrentScopeDisplayNameAsync(CancellationToken ct = default)` (line 39) returns a
    human-readable name for that scope (the conference event's title, the tenant's name). The send page
    uses it to caption who a notification will actually reach, so an operator can see the auto-applied
    target rather than infer it (lines 24-28); the one call site is
    `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationSend.razor.cs:77`.
- **Why it's built this way**: an interface rather than a settings value, because the answer is dynamic
  (it changes as the app's current context changes) and may need an async lookup. Keeping the key a
  plain string keeps the framework free of any domain concept, and the never-throw rule written into
  the contract is what makes the fail-closed guarantee real rather than aspirational. See
  [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html), which records the
  optional `ScopeKey` travelling with a send.
- **Where it's used**: injected into [NotificationInboxService](#notificationinboxservice)
  (`NotificationInboxService.cs:31`) and [PushNotificationService](#pushnotificationservice)
  (`PushNotificationService.cs:18`); registered with `TryAddScoped` against
  [NullNotificationScopeProvider](#nullnotificationscopeprovider) by `AddNotificationUI()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:24`). In
  MMCA.ADC the real implementation is
  [CurrentEventNotificationScopeProvider](group-22-engagement-module.md#currenteventnotificationscopeprovider).

### IUiReadCache
> MMCA.Common.UI · `MMCA.Common.UI.Services.Caching` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Caching/IUiReadCache.cs:32` · Level 0 · interface

- **What it is**: the contract for a per-circuit read-through cache sitting in front of the API client,
  so a page that re-reads the same list twice within a few seconds (a grid re-mounted by navigation, a
  lookup rendered in two components) does not pay for two round trips.
- **Depends on**: nothing first-party in its signature. Its freshness policy lives in
  [UiReadCacheOptions](#uireadcacheoptions) (named in the doc at `IUiReadCache.cs:17`); its only
  framework implementation is [UiReadCache](#uireadcache). Externals: `System.Diagnostics.CodeAnalysis`
  for the analyzer suppression at lines 28-31.
- **Concept introduced, a two-tier cache whose key shape is deliberately shared with the server.**
  `[Rubric §23, Front-End Performance]` assesses avoidable network work in the browser, and
  `[Rubric §12, Performance & Scalability]` the same question for the API behind it. The load-bearing
  design decision is not that a cache exists, it is what a key *is*: the relative URL, path plus the
  **full** query string, used verbatim (`IUiReadCache.cs:9-15`). That is the same key shape the
  server's authenticated output cache uses, whose policy sets `CacheVaryByRules.QueryKeys = "*"` so
  every query-string variant is its own entry
  ([ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).
  Mirroring the shape means the two tiers agree on what "the same read" is: a filter, page or sort
  change misses on both sides rather than being served a stale answer by one of them.
  - `[Rubric §26, Front-End Security]` and `[Rubric §30, Compliance, Privacy & Data Governance]` both
    land on `Clear()`. The cache is registered scoped, which is one instance per Blazor Server circuit
    but **one per app lifetime** on WebAssembly and MAUI, where the scope outlives a sign-out. The
    contract therefore states that the sign-out path calls `Clear` so one account's reads can never be
    served to the next (`IUiReadCache.cs:22-26,61-65`).
  - `[Rubric §29, Resilience & Business Continuity]` shows in the storage rule: only successful reads
    are stored, so a transient outage cannot pin an error in front of the user (`IUiReadCache.cs:19-20`).
  - **Why the parameter is a `string` and not a `Uri`.** The `CA1054` suppression (lines 28-31) is
    worth reading as a small design argument: the parameter is a cache *key* that happens to be spelled
    as a relative URL, it is compared by ordinal prefix and stored verbatim, and `System.Uri` would
    re-encode and re-normalize it, which is exactly what must not happen to a key when the point is
    matching the server's key byte for byte.
- **Walkthrough**: four members.
  - `bool TryGetFresh<T>(string url, out T? value)` (line 42) reports a fresh hit; a miss, an expired
    entry, or a disabled cache all read as `false`, and the doc notes that a hit stored under a
    different type also reads as a miss (line 37).
  - `void Set<T>(string url, T value)` (line 51) stores a successfully read value stamped with the
    current time, and is a no-op when caching is disabled. The doc is explicit that only success values
    are ever passed here (line 50).
  - `void InvalidatePrefix(string routePrefix)` (line 59) drops every entry whose key starts with the
    prefix, ordinally. That is how one endpoint's create, update or delete clears that endpoint's list,
    paged, lookup and by-id entries in a single call (lines 53-58).
  - `void Clear()` (line 66) drops everything, for the sign-out case above.
- **Why it's built this way**: an interface (rather than a concrete helper) is what lets the whole
  feature be optional. Both consumers take `IUiReadCache?` with a `null` default, so a host that
  registers nothing gets exactly the plain GET the read methods issued before a cache existed
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:47`,
  `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthUIService.cs:40`). Prefix
  invalidation rather than per-key invalidation matches how the framework's endpoints are shaped: one
  resource owns one route prefix, so a write knows what it invalidated without enumerating the reads.
- **Where it's used**: registered `TryAddScoped` against [UiReadCache](#uireadcache) by `AddUIShared`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:57`). Read through by
  [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype)'s
  `GetCachedAsync` (`EntityServiceBase.cs:248-268`) and invalidated by its `InvalidateOnSuccess`
  (`EntityServiceBase.cs:281-287`); cleared on sign-out and on an unrefreshable session by
  `AuthUIService` (`AuthUIService.cs:127,156`).
- **Caveats / not-in-source**: nothing here is shared between users or between tabs. It is an in-memory
  per-scope cache, so a second browser tab on WebAssembly has its own instance and its own entries.

### NotificationState
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationState.cs:18` · Level 0 · class (sealed)

- **What it is**: the scoped shared state for the notification unread count. It holds the count, the
  timestamp of when that count was last established, and the single active-poller slot that keeps
  duplicate notification bells from each running their own poll loop.
- **Depends on**: nothing first-party. Externals: BCL `TimeProvider` (injected, defaulting to
  `TimeProvider.System`, `NotificationState.cs:18,21`), `System.Threading.Lock`, and three
  `EventHandler` events. Consumed by [NotificationBell](#notificationbell) and the inbox page
  [NotificationInbox](#notificationinbox).
- **Concept introduced, a scoped state store that owns both the value and its freshness.**
  `[Rubric §19, State Management & Data Flow]` assesses how shared UI state is owned and observed
  without threading it through the component tree. `NotificationState` is registered scoped
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:33`), so each
  Blazor circuit gets its own instance and components subscribe to its events instead of receiving
  cascading parameters. Two mechanisms are worth studying.
  - **The staleness stamp.** `LastFetchedUtc` (line 41) records *when* the count was established, which
    is the state half of the client's staleness policy: a subscriber that fires on an ambient trigger
    (a navigation, a re-render) asks `IsStale(maxAge)` instead of re-reading the API every time the
    trigger happens to fire (lines 77-85). The subtle rule is stamped in `SetUnreadCount`: the stamp is
    written **before** the unchanged-count early return (line 66), because an API read that came back
    with the same number is still a read. Without that ordering, a quiet inbox (where the count almost
    never changes, so almost every read is the no-op read) would look permanently stale and re-fetch
    forever (lines 63-65). `[Rubric §23, Front-End Performance]` is the payoff.
  - **The active-poller slot as an owner reference, not a counter.** `_pollerOwner` (line 29) holds the
    component instance that currently polls, or null when the slot is free, and the field's own doc
    explains why a counter was the wrong shape: a counter leaks one increment per teardown that never
    unregisters, and once it leaks no bell can ever win the slot again for the life of the circuit
    (lines 23-28). An owner reference makes register and unregister symmetric.
  - `[Rubric §14, Testability]` shows in the constructor: the clock is a `TimeProvider?` parameter
    defaulting to `TimeProvider.System` (lines 14-18,21), so a test drives `IsStale` with a fake clock
    while an existing host keeps the previous no-argument constructor shape.
- **Walkthrough**: members in teaching order.
  - Fields: the `Lock _pollerSync` (line 20), the resolved `_timeProvider` (line 21), and the nullable
    `_pollerOwner` (line 29).
  - `UnreadCount` with a private setter (line 32) and `LastFetchedUtc` with a private setter (line 41).
  - Three events: `OnChange` when the count changes (line 44), `OnRefreshRequested` when a real-time
    notification arrives and the badge should refetch the authoritative count (lines 46-50), and
    `OnPollerSlotFreed` when the active-poller slot becomes free so a surviving bell can take polling
    over (lines 52-57).
  - `SetUnreadCount(int)` (lines 61-75) stamps `LastFetchedUtc` first (line 66), returns early when the
    value is unchanged (lines 68-71), and otherwise assigns and raises `OnChange`.
  - `IsStale(TimeSpan maxAge)` (lines 84-85) is `true` when there is no stamp at all or the stamp is
    older than `maxAge`; `MarkStale()` (line 92) discards the stamp outright, for a subscriber that
    learned the data moved (a real-time push) and knows age is no longer evidence of freshness.
  - `IncrementUnreadCount()` (lines 95-99) bumps by one for an optimistic real-time update and always
    raises `OnChange`. `RequestRefresh()` (line 102) raises `OnRefreshRequested`.
  - `TryRegisterPoller(object owner)` (lines 111-125) null-guards, takes `_pollerSync`, and returns
    `false` only when a *different* owner already holds the slot (lines 117-120); a caller that already
    holds it gets `true` again, so the call is idempotent.
  - `UnregisterPoller(object owner)` (lines 133-150) releases the slot only when the caller is the
    holder (lines 139-142), so a non-owner disposing cannot evict the live poller. `OnPollerSlotFreed`
    is raised **outside** the lock (lines 147-149), because a subscriber claims the slot from its
    handler and would otherwise re-enter the lock on the disposing component's thread.
- **Why it's built this way**: scoped because the count is per-user-session; event-based because
  subscribers live at arbitrary render-tree depth. The private setters funnel every mutation through
  the named methods, so no change can bypass the change-notification path or the freshness stamp. The
  owner-keyed slot plus the freed event is what survives the real lifecycle in a Blazor shell, where
  the desktop and mobile bell placements are rebuilt independently whenever the authentication state
  changes (lines 52-56).
- **Where it's used**: injected into [NotificationBell](#notificationbell), which claims the slot with
  `TryRegisterPoller(this)`, listens on `OnPollerSlotFreed` to take over, and gates its navigation
  refresh on `IsStale`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Notifications/NotificationBell.razor.cs:53,56,107,119,155,173,256`),
  and into [NotificationInbox](#notificationinbox); driven by real-time pushes that arrive over
  [NotificationHubService](#notificationhubservice). Covered by `NotificationStateTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Notifications/NotificationStateTests.cs:13`).

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
  - null or empty (lines 20-23);
  - must start with `/`, which rules out scheme-prefixed absolutes such as `http://` and
    `javascript:` (lines 25-30);
  - the second character must not be `/` or `\`, which browsers read as the start of an authority
    component and would send the user off-host (lines 32-37);
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
  the query string; [NavigationHistoryService](#navigationhistoryservice)`.GoBackAsync` also runs its
  fallback path through it (`NavigationHistoryService.cs:82`), so even the "safe" branch cannot be
  turned into a redirect vector.

### MauiBackNavigationBridge
> MMCA.Common.UI · `MMCA.Common.UI.Services.Navigation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/MauiBackNavigationBridge.cs:28` · Level 1 · class (static)

- **What it is**: a static bridge that routes a native MAUI back gesture (Android hardware back, iOS
  swipe) into the BlazorWebView's internal history stack, so pressing back inside a hybrid app behaves
  like a web back rather than tearing down the page.
- **Depends on**: [BackNavigationResult](#backnavigationresult) (its return type);
  `Microsoft.JSInterop` (`IJSRuntime`, `IJSObjectReference`, `JSDisconnectedException`, `JSException`)
  and the `nav-interop.js` module shipped as static web assets of this package.
- **Concept introduced, MAUI-to-WebView interop.** `[Rubric §22, Responsive & Cross-Browser]` extends
  to hybrid hosts here: the same Blazor UI runs inside a MAUI WebView, and native chrome events must be
  reconciled with web navigation. The class doc states the required call site precisely, from
  `ContentPage.OnBackButtonPressed` via `BlazorWebView.TryDispatchAsync`, so the call runs on the
  renderer thread with access to the WebView's `IJSRuntime` (`MauiBackNavigationBridge.cs:21-27`).
- **Walkthrough**: `HandleBackPressedAsync(IJSRuntime js)` (line 38) null-checks the runtime
  (`ArgumentNullException.ThrowIfNull`, line 40), dynamically imports
  `./_content/MMCA.Common.UI/nav-interop.js` (`ModulePath`, line 30) and invokes its `tryGoBack()`
  helper, deserializing the answer into a [BackNavigationResult](#backnavigationresult)
  (lines 44-46). Three interop failure modes are caught explicitly and collapse to the same safe value
  `new BackNavigationResult(Handled: false, AtRoot: true)`: `InvalidOperationException` when Blazor is
  not yet hydrated (lines 48-52), `JSDisconnectedException` (lines 53-56), and `JSException`
  (lines 57-60). A not-yet-ready WebView therefore reports "at root, not handled" and the host falls
  back to its default back behavior.
- **Why it's built this way**: a static helper with no state fits a one-shot interop call, and
  returning a data record instead of throwing keeps the native handler branch-free. Collapsing the
  three JS exception types into one safe default means an unhydrated or disconnected circuit never
  crashes the native back button.
- **Where it's used**: MAUI host projects call it from their page back-button handler; the returned
  [BackNavigationResult](#backnavigationresult) tells the host whether to exit the app.
- **Caveats / not-in-source**: the `nav-interop.js` `tryGoBack()` implementation and the MAUI host
  wiring live outside this unit; only the C# side of the bridge is visible here.

### NavigationHistoryService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Navigation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Navigation/NavigationHistoryService.cs:12` · Level 1 · class (sealed)

- **What it is**: a per-circuit service that bridges Blazor's `NavigationManager` with the browser
  history API, so a "Back" button can perform a real `history.back()` when an in-history entry exists
  and fall back to an explicit route otherwise.
- **Depends on**: [ReturnUrlProtector](#returnurlprotector) (sanitizes the fallback) and
  [LazyJsModule](#lazyjsmodule) (the shared single-flight JS module importer, held as `_module`,
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
    bridge imports; `_module` wraps it in a [LazyJsModule](#lazyjsmodule) (line 16) so concurrent
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
  and history semantics are per-connection. Delegating the import to [LazyJsModule](#lazyjsmodule)
  removes a real bug class: an unguarded `_module ??= await import(...)` lets two concurrent callers
  each start an import and leaks the loser's reference
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/LazyJsModule.cs:5-13`). Routing the
  fallback through [ReturnUrlProtector](#returnurlprotector) means even the safe branch cannot be
  turned into a redirect vector, and the layered exception handling guarantees `GoBackAsync` never
  strands the user.
- **Where it's used**: injected into detail-page "Back" buttons; the same `nav-interop.js` primitives
  back the MAUI hardware-back path through
  [MauiBackNavigationBridge](#mauibacknavigationbridge).

### NullNotificationScopeProvider
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NullNotificationScopeProvider.cs:8` · Level 1 · class (sealed)

- **What it is**: the framework's default [INotificationScopeProvider](#inotificationscopeprovider):
  a no-op that always reports "unscoped", so an application that never scopes its notifications keeps
  exactly the behavior it had before the scope key existed.
- **Depends on**: [INotificationScopeProvider](#inotificationscopeprovider) (the interface it
  implements); `Task.FromResult` (BCL).
- **Concept reinforced, the Null Object pattern as a registration default.** Rather than making the
  scope provider optional and null-checking it in both HTTP services, the framework registers a
  do-nothing implementation and lets the consumers depend on the interface unconditionally.
  `[Rubric §2, Design Patterns]` assesses whether a pattern is used where it removes branching, which
  is exactly what happens here: [NotificationInboxService](#notificationinboxservice) and
  [PushNotificationService](#pushnotificationservice) contain no "is a provider registered" test.
  `[Rubric §16, Maintainability]` follows: the feature was additive, and an app that ignores it sees a
  byte-identical request.
- **Walkthrough**: the whole type is one expression-bodied member,
  `GetCurrentScopeKeyAsync(CancellationToken ct = default) => Task.FromResult<string?>(null)`
  (`NullNotificationScopeProvider.cs:10-12`). It does not override
  `GetCurrentScopeDisplayNameAsync`, which is why that member was added to the interface with a default
  body: the null object inherits the interface's own null answer unchanged. The class doc records the
  registration contract: it is the default wired by `AddNotificationUI`, and an app that scopes
  registers its own implementation, which wins (`NullNotificationScopeProvider.cs:3-7`).
- **Why it's built this way**: the "wins" part is mechanical, not conventional.
  `AddNotificationUI()` registers this type with `TryAddScoped`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:24`), and the
  source comment states the reason: `TryAdd` means an app that registers its own provider wins
  whichever order the two registration calls run in (lines 22-23). A plain `AddScoped` would have made
  host startup ordering load-bearing.
- **Where it's used**: resolved as [INotificationScopeProvider](#inotificationscopeprovider) by
  [NotificationInboxService](#notificationinboxservice) and
  [PushNotificationService](#pushnotificationservice) in every host that has not registered its own;
  MMCA.ADC replaces it with
  [CurrentEventNotificationScopeProvider](group-22-engagement-module.md#currenteventnotificationscopeprovider).

### UiReadCache
> MMCA.Common.UI · `MMCA.Common.UI.Services.Caching` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Caching/UiReadCache.cs:18` · Level 1 · class (internal, sealed)

- **What it is**: the default [IUiReadCache](#iuireadcache): an in-memory dictionary keyed by the
  relative request URL, guarded by a lock, with lazy TTL expiry and a longest-prefix TTL lookup.
- **Depends on**: [IUiReadCache](#iuireadcache) (the contract it implements) and
  [UiReadCacheOptions](#uireadcacheoptions) (the staleness policy, taken as
  `IOptions<UiReadCacheOptions>` and unwrapped once at construction, `UiReadCache.cs:27`). Externals:
  BCL `TimeProvider`, `System.Threading.Lock`, `Dictionary<string, (object, DateTimeOffset)>`, and
  `Microsoft.Extensions.Options`.
- **Concept introduced, lazy expiry and why there is no sweeper.** The remarks state the reasoning
  directly (`UiReadCache.cs:11-15`): an entry past its TTL is removed when it is next read, not by a
  timer, because a UI cache holds tens of entries for the life of a circuit, so a sweeping timer would
  cost more than the entries it reclaims, and a stale entry that is never read again is never served
  either. `[Rubric §23, Front-End Performance]` assesses exactly this kind of trade: the cheapest
  correct expiry policy for the actual entry count.
  - **Why a lock at all.** Circuit code is not single-threaded: a periodic poll, a SignalR push handler
    and a user-driven page load can all reach the same instance (lines 7-9). `[Rubric §19, State
    Management & Data Flow]` covers the resulting ownership rule, that every dictionary touch happens
    under `_sync`.
  - **Ordinal comparison as a correctness requirement.** The comment at lines 22-24 makes the point
    that two URLs differing only in case are two different requests to the server, so they must be two
    different entries here. That is why the default `Dictionary<string, ...>` comparer is left alone
    and every prefix check passes `StringComparison.Ordinal` explicitly (lines 95, 127).
  - `[Rubric §14, Testability]` shows in the injected `TimeProvider` (line 16): TTL behavior is
    exercised with a fake clock rather than by sleeping, in `UiReadCacheTests`.
- **Walkthrough**:
  - Fields: the `Lock _sync` (line 20), the entry dictionary mapping URL to a
    `(object Value, DateTimeOffset StoredAt)` tuple (line 25), the null-guarded `_timeProvider`
    (line 26), and the eagerly unwrapped `_options` (line 27). Storing the value as `object` is what
    lets one dictionary hold every read shape the app makes.
  - `TryGetFresh<T>` (lines 30-67) guards the URL, sets `value = default`, and short-circuits to
    `false` when `_options.Enabled` is off (lines 36-39). It then takes the lock and applies three
    exits: no entry (lines 45-48); an entry older than `ResolveTtl(url)`, which is **removed** on the
    way out (lines 50-54); and an entry whose stored value is not a `T`, which is also removed, because
    the same URL read back as a different type means the caller changed shape and the stored value can
    no longer answer the question (lines 56-62). Only then is it a hit (lines 64-65).
  - `Set<T>` (lines 70-85) is a no-op when caching is disabled **or the value is null** (line 74),
    stamps `GetUtcNow()` outside the lock, and assigns inside it (lines 79-84).
  - `InvalidatePrefix` (lines 88-103) materializes the matching keys into a list under the lock before
    removing them (lines 94-101), because removing while enumerating the same dictionary would throw.
  - `Clear` (lines 106-112) empties the dictionary under the lock.
  - `ResolveTtl` (lines 120-135) is the freshness lookup: it starts from
    `UiReadCacheOptions.DefaultTtl` and scans every configured route prefix, keeping the TTL of the
    **longest** prefix the URL starts with (lines 125-132). The doc says why longest-match rather than
    first-match (lines 114-118): a nested route can state a stricter budget than the endpoint above it,
    whatever order the configuration happens to enumerate in.
- **Why it's built this way**: `internal` because the interface is the supported surface and the DI
  registration is the only supported way to get one
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:57` registers it
  `TryAddScoped`, so a host can substitute its own implementation). The clock is registered alongside
  it with `TryAddSingleton(TimeProvider.System)` (`DependencyInjection.cs:52`), which the comment notes
  is a `TryAdd` so a host that already registered one (as `AddInfrastructure` does) keeps it and a test
  substitutes a `FakeTimeProvider`. The defaults come from the options object rather than constants:
  caching is `Enabled` by default with a 60-second `DefaultTtl`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/UiReadCacheOptions.cs:24,32`), long
  enough to collapse the burst of identical reads a page issues while it mounts and short enough that a
  stale list corrects itself within one user's attention span.
- **Where it's used**: resolved as [IUiReadCache](#iuireadcache) by
  [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype) and
  `AuthUIService`; covered by `UiReadCacheTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Caching/UiReadCacheTests.cs:15`).

### ChannelSubscription
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:412` · Level 2 · class (private, sealed, nested)

- **What it is**: the disposable handle returned when a caller subscribes to a live channel on
  [NotificationHubService](#notificationhubservice); disposing it removes the handler from the
  channel's subscriber list.
- **Depends on**: its owning [NotificationHubService](#notificationhubservice) (a back-reference), a
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
  empties (lines 373-386). The `Handler` property is what `DispatchChannelEventAsync` invokes on each
  delivery (line 339).
- **Why it's built this way**: nesting it privately inside
  [NotificationHubService](#notificationhubservice) keeps subscription bookkeeping fully encapsulated,
  and the `IDisposable` shape lets Blazor components tie unsubscription to their own lifetime.
- **Where it's used**: constructed and returned by
  [NotificationHubService](#notificationhubservice)`.OnChannelEvent` (line 260); disposed by the
  component that subscribed.
- **Caveats / not-in-source**: disposing a subscription unregisters the *handler* only. It does not
  release a channel join: those are counted separately by
  [ChannelReferenceCounter](#channelreferencecounter), and the source states the pairing requirement
  explicitly (`NotificationHubService.cs:221-222`).

### NotificationHubService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:26` · Level 2 · class (sealed, partial)

- **What it is**: the client-side SignalR connection manager. It opens a connection to
  `/hubs/notifications` after login, invokes a callback for received notifications, and carries the
  ephemeral live-channel events that components join and subscribe to.
- **Depends on**: [ApiSettings](#apisettings) (for the hub URL, via `IOptions<ApiSettings>`) and
  [ITokenStorageService](#itokenstorageservice) (for the bearer token);
  [ChannelReferenceCounter](#channelreferencecounter) (membership counting) and
  [ChannelSubscription](#channelsubscription) (its subscription handle). Externals:
  `Microsoft.AspNetCore.SignalR.Client` (`HubConnection`, `HubConnectionBuilder`), `ILogger<T>` with
  `[LoggerMessage]` source generation, `System.Threading.Lock` and `SemaphoreSlim`; implements
  `IAsyncDisposable`.
- **Concept introduced, resilient client-side real-time with re-joinable channels.**
  `[Rubric §6, CQRS & Event-Driven]` extends to the browser here: the server pushes notifications and
  channel events over SignalR instead of the client polling for everything.
  `[Rubric §29, Resilience & Business Continuity]` shows in four distinct mechanisms, each with its
  rationale in source:
  - the initial connect retries with exponential backoff up to `MaxRetries = 3` starting at
    `InitialRetryDelay` of 2 seconds and doubling (lines 28, 71, 145-180), so a token-not-yet-ready or
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
    [ChannelReferenceCounter](#channelreferencecounter) (line 42), and `_channelSubscriptions` mapping
    a channel key to its handler list (line 43).
  - `NotificationCallback` (line 51) is a settable `Func<string, string, Task>?` the host assigns to
    surface a snackbar; `IsConnected` (line 65) reports the connection state; `InitialRetryDelay`
    (line 71) is `internal` and settable so a test can exercise the terminal-failure path without
    waiting out the real multi-second backoff (lines 67-70).
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
    [ChannelSubscription](#channelsubscription) and appends it to the channel's handler list under
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
  [NotificationState](#notificationstate) and MudBlazor snackbars, and its channel API is what
  [LiveEventListener](group-22-engagement-module.md#liveeventlistener) and the
  [HappeningNow](group-23-engagement-live-layer.md#happeningnow) page use. The server side is
  [NotificationHub](group-10-notifications.md#notificationhub).

### INotificationInboxUIService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/INotificationInboxUIService.cs:11` · Level 3 · interface

- **What it is**: the UI-side contract for the per-user notification inbox: paged retrieval, unread
  count, mark-one-read, and mark-all-read. Every member returns a [Result](group-01-result-error-handling.md#result)
  carrying the API's own errors.
- **Depends on**: [Result](group-01-result-error-handling.md#result) and its generic form `Result<T>`,
  [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt), and
  [UserNotificationDTO](group-10-notifications.md#usernotificationdto) (its return shapes), plus the
  `UserNotificationIdentifierType` alias (`INotificationInboxUIService.cs:26`).
- **Concept introduced, the Result pattern carried all the way to the component.**
  `[Rubric §18, UI Architecture & Component Design]` assesses whether components talk to typed services
  rather than raw `HttpClient`; components depend on this interface, not on the HTTP implementation, so
  a bell or an inbox page can be tested against a stub. The sharper point is the return shape: every
  member is `Task<Result...>`, so a caller can tell a real answer apart from a failure **without
  catching anything** (`INotificationInboxUIService.cs:6-10`). See the primer's Result section for the
  pattern itself; this is where it crosses the presentation boundary.
  - `[Rubric §24, Forms, Validation & UX Safety]` shows in the unread-count doc (lines 16-21), which
    defines what a failure *means* to a caller: the count could not be established (expired session,
    transient failure) and must be treated as "unknown". Callers leave the displayed count untouched,
    because reporting zero would erase a badge that a real-time push had just incremented. That is a
    contract-level statement about UI behavior, not just about data.
  - `[Rubric §9, API & Contract Design]` shows in the paged signature: the inbox is fetched a page at a
    time with sane defaults, never as one unbounded dump.
- **Walkthrough**: four members (`INotificationInboxUIService.cs:13-29`).
  `GetInboxAsync(pageNumber = 1, pageSize = 20, cancellationToken)` returns a
  `Result<PagedCollectionResult<UserNotificationDTO>>` (line 14); `GetUnreadCountAsync` returns
  `Result<int>` (line 23); `MarkReadAsync(id, ct)` (line 26) and `MarkAllReadAsync(ct)` (line 29) are
  the two mutations, both returning a bare
  [Result](group-01-result-error-handling.md#result).
- **Why it's built this way**: a thin interface at the presentation edge keeps components decoupled
  from transport and makes the inbox mockable in bUnit tests. Note the contract deliberately says
  nothing about scoping: the scope key is resolved inside the implementation through
  [INotificationScopeProvider](#inotificationscopeprovider), so adding scoping did not change this
  interface or any caller.
- **Where it's used**: implemented by [NotificationInboxService](#notificationinboxservice);
  consumed by [NotificationBell](#notificationbell) (for the unread count) and the
  [NotificationInbox](#notificationinbox) page.

### IPushNotificationUIService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/IPushNotificationUIService.cs:10` · Level 3 · interface

- **What it is**: the UI-side contract for admin push operations: broadcast a notification and read
  paginated send history, both returning a [Result](group-01-result-error-handling.md#result).
- **Depends on**: [Result](group-01-result-error-handling.md#result),
  [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt),
  [PushNotificationDTO](group-10-notifications.md#pushnotificationdto), and
  [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest).
- **Concept reinforced**: the same Result-returning UI-service abstraction as
  [INotificationInboxUIService](#inotificationinboxuiservice) (`[Rubric §18, UI Architecture &
  Component Design]`), with the same "errors are values the API described, not exceptions the caller
  catches" rule stated in the doc (`IPushNotificationUIService.cs:6-9`). The difference is audience:
  this is the organizer/admin surface (send plus history), not the per-user inbox, and splitting the
  two keeps each page's dependency surface minimal.
- **Walkthrough**: two members (`IPushNotificationUIService.cs:12-16`).
  `SendAsync(SendPushNotificationRequest, ct)` returns
  `Result<PushNotificationDTO>` for the created notification (line 13);
  `GetHistoryAsync(pageNumber = 1, pageSize = 10, ct)` returns
  `Result<PagedCollectionResult<PushNotificationDTO>>` (line 16).
- **Why it's built this way**: separating the admin contract from the inbox contract lets an app that
  never sends notifications avoid taking a dependency on the send path at all, and keeps the two
  registrations independent.
- **Where it's used**: implemented by [PushNotificationService](#pushnotificationservice); consumed
  by the admin pages [NotificationList](#notificationlist) and
  [NotificationSend](#notificationsend).

### NotificationInboxService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationInboxService.cs:28` · Level 4 · class (sealed)

- **What it is**: the HTTP implementation of the inbox contract. It calls the `notifications/inbox`
  WebAPI resource for paged retrieval, unread count, and the two mark-read operations, stamping every
  scopeable request with the application's current scope key and giving the two reads one forced
  token refresh and replay when the API answers `401`.
- **Depends on**: [AuthenticatedServiceBase](#authenticatedservicebase) (its base, supplying
  `CreateAuthenticatedClientAsync`, `CreateClientWithToken` and the shared static `RetryPolicy`),
  [INotificationInboxUIService](#inotificationinboxuiservice) (the contract it implements),
  [ITokenStorageService](#itokenstorageservice),
  [INotificationScopeProvider](#inotificationscopeprovider),
  [ITokenRefresher](#itokenrefresher) (optional, defaulted to null),
  [HttpResultExecutor](#httpresultexecutor) (turns a thrown transport failure into a failed
  [Result](group-01-result-error-handling.md#result)),
  [ProblemDetailsResultReader](group-08-auth.md#problemdetailsresultreader) (turns the response into a
  Result carrying the API's own `ProblemDetails` errors),
  [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt), and
  [UserNotificationDTO](group-10-notifications.md#usernotificationdto). Externals:
  `IHttpClientFactory`, `System.Net.HttpStatusCode`, `CultureInfo.InvariantCulture`.
- **Concept introduced, a typed HTTP UI service over a non-CRUD resource.**
  `[Rubric §18, UI Architecture & Component Design]` assesses UI-to-API access through typed services.
  This is a sibling of
  [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype) for a
  resource whose verbs are read and mark rather than create/update/delete, so it inherits only the
  authenticated-client half. Every method has the same three-layer shape: `HttpResultExecutor.ExecuteAsync`
  on the outside (exceptions become failed Results), the shared `RetryPolicy` in the middle, and
  `ProblemDetailsResultReader.ReadAsync` at the end (a non-success response becomes the failure the API
  described).
  - **The 401 refresh-and-replay, and why only reads get it.**
    `SendReadWithAuthRefreshAsync` (lines 124-149) is the interesting mechanism: a badge poll or an
    inbox load that lands on an access token the server has already rejected gets one forced token
    refresh and one replay, instead of surfacing as an empty inbox or a blanked badge (lines 16-19).
    The doc states the constraint that makes it safe (lines 117-121): only the reads use it, because
    they are safe to replay, whereas a mark-read PUT is left with its existing single-shot behavior.
    `[Rubric §29, Resilience & Business Continuity]` is the category; `[Rubric §11, Security]` is the
    reason it is bounded, one attempt, no loop.
  - **A failure is "unknown", deliberately not zero.** The comment on the unread count (lines 69-71)
    records the defect this shape fixed: reporting zero let a rejected token or a transient failure
    erase a badge that a real-time push had just incremented. Now the failure travels as a failed
    Result and the caller keeps the displayed count.
    `[Rubric §24, Forms, Validation & UX Safety]` covers this class of "what does the UI show when the
    read failed" decision.
  - `[Rubric §30, Compliance, Privacy & Data Governance]` shows in the scope query: the scope is what
    keeps a bulk mark-read from silently clearing notifications the user is not currently looking at.
- **Walkthrough**:
  - A primary constructor forwards `IHttpClientFactory` and
    [ITokenStorageService](#itokenstorageservice) to
    [AuthenticatedServiceBase](#authenticatedservicebase) and keeps `scopeProvider` and the optional
    `tokenRefresher` (`NotificationInboxService.cs:28-33`); `Endpoint` is the constant
    `"notifications/inbox"` (line 35). The refresher's default of `null` is documented as the
    graceful-degradation path: a host that registers none simply skips the retry, and the read reports
    failure rather than a fabricated empty result (lines 24-27).
  - `ScopeQueryAsync(separator, ct)` (lines 178-185) is the shared helper: it asks
    [INotificationScopeProvider](#inotificationscopeprovider) for the current key and returns either an
    empty string (leaving the request byte-identical to the pre-scope one, lines 170-173) or
    `{separator}scope={Uri.EscapeDataString(scopeKey)}` (line 184). The separator parameter is `"&"`
    for a URL that already carries query parameters and `"?"` for one that does not (lines 174-176).
  - `GetInboxAsync` (lines 38-56) resolves the scope with `"&"` (line 45), builds an invariant-culture
    relative URL (lines 46-48), sends through `SendReadWithAuthRefreshAsync` (lines 50-51), and reads
    a `Result<PagedCollectionResult<UserNotificationDTO>>` (lines 53-54).
  - `GetUnreadCountAsync` (lines 59-74) resolves the scope with `"?"` (line 63), goes through the same
    read path, and reads a `Result<int>` (line 72).
  - `MarkReadAsync` (lines 77-93) PUTs to `{Endpoint}/{id}/read` (line 84) on a plain authenticated
    client. It is the one method that sends no scope: the id already identifies a single notification.
  - `MarkAllReadAsync` (lines 96-111) PUTs to `{Endpoint}/read-all` **with** the scope query
    (lines 100-102), so a bulk operation is bounded by the same filter the list was read under.
  - Both mutations pass the `cancellationToken` **into** the retry policy as well as the request
    (lines 86-89, 104-107), and the comment says why: without it an abandoned mark-read sleeps out its
    full backoff budget instead of aborting.
  - `SendReadWithAuthRefreshAsync` (lines 124-149) runs the send under the retry policy inside a
    `using` for the first client (lines 129-132), returns the response untouched when it is not a `401`
    or no refresher was registered (lines 134-137), and otherwise acquires a token, disposes the first
    response, and replays on a client built with the new token (lines 139-148). The doc notes the
    response content is fully buffered before the send task completes, which is what makes it legal to
    read the body after the client that produced it is disposed (lines 119-120).
  - `TryAcquireRefreshedTokenAsync` (lines 156-168) forces one re-acquisition and returns `null` for a
    blank token or when JS interop is unavailable during SSR prerender (lines 163-167), which is a
    "no refresh is possible here", not an error.
- **Why it's built this way**: inheriting from [AuthenticatedServiceBase](#authenticatedservicebase)
  removes per-method boilerplate for auth and retry, and wrapping every body in
  [HttpResultExecutor](#httpresultexecutor) means no method has to hand-write a try/catch to honor the
  Result-returning contract. Routing the scope through a provider (rather than a parameter on every
  call) is what keeps the UI contract unchanged while the inbox, badge and mark-all agree on one slice
  (`NotificationInboxService.cs:10-15`).
- **Where it's used**: registered against
  [INotificationInboxUIService](#inotificationinboxuiservice) as scoped by `AddNotificationUI()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:30`); consumed
  by [NotificationBell](#notificationbell) and the [NotificationInbox](#notificationinbox) page.

### PushNotificationService
> MMCA.Common.UI · `MMCA.Common.UI.Services.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/PushNotificationService.cs:15` · Level 5 · class (sealed)

- **What it is**: the HTTP implementation of the admin push contract: send a notification and read
  paginated send history against the `notifications` WebAPI resource, stamping a send with the
  application's current scope key when the caller did not name one.
- **Depends on**:
  [EntityServiceBase<TEntityDTO, TIdentifierType>](#entityservicebasetentitydto-tidentifiertype)
  (its base, typed on `PushNotificationDTO` / `PushNotificationIdentifierType`, which supplies
  `Endpoint` and the Result-returning `SendRequestAsync`),
  [IPushNotificationUIService](#ipushnotificationuiservice) (the contract),
  [ITokenStorageService](#itokenstorageservice),
  [INotificationScopeProvider](#inotificationscopeprovider),
  [Result](group-01-result-error-handling.md#result),
  [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt),
  [PushNotificationDTO](group-10-notifications.md#pushnotificationdto), and
  [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest).
- **Concept reinforced, the base-class HTTP service pattern at its cleanest**
  (`[Rubric §18, UI Architecture & Component Design]`). Where
  [NotificationInboxService](#notificationinboxservice) hand-builds each request because its resource
  is not CRUD-shaped, this one leans on
  [EntityServiceBase](#entityservicebasetentitydto-tidentifiertype)'s `SendRequestAsync`, so each
  method reduces to one send that already returns a
  [Result](group-01-result-error-handling.md#result). `[Rubric §9, API & Contract Design]` appears in
  the scope precedence rule: an explicit caller choice outranks the ambient one, which is the
  difference between a default and an override.
- **Walkthrough**:
  - The primary constructor passes the resource name `"notifications"` plus the factory and token
    service to [EntityServiceBase](#entityservicebasetentitydto-tidentifiertype) and keeps
    `scopeProvider` (`PushNotificationService.cs:15-21`).
  - `SendAsync(request, ct)` (lines 23-47) null-guards the request (line 27), then applies scoping
    conditionally: a request that already carries a `ScopeKey` is sent unchanged, and only an unscoped
    one picks up the ambient key via a `record with` expression (lines 31-39, rationale at lines
    29-30). It then POSTs through `SendRequestAsync<PushNotificationDTO>` (lines 41-46).
  - `GetHistoryAsync(pageNumber = 1, pageSize = 10, ct)` (lines 50-59) builds an invariant-culture
    `pageNumber`/`pageSize` query (line 55) and sends a GET through the same helper (lines 56-58).
    Note it does **not** send a scope: history is the admin's full send log.
- **Why it's built this way**: delegating transport, auth, retry and error translation to
  [EntityServiceBase](#entityservicebasetentitydto-tidentifiertype) keeps this class down to two short
  methods, matching the framework's "UI services are typed HTTP clients, never raw `HttpClient`"
  convention. Reading the scope through the same
  [INotificationScopeProvider](#inotificationscopeprovider) the inbox service uses is what makes a
  send and the reads that follow it resolve to one scope
  (`PushNotificationService.cs:9-14`); the wire-level `ScopeKey` on the request is recorded in
  [ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html).
- **Where it's used**: registered against
  [IPushNotificationUIService](#ipushnotificationuiservice) as scoped by `AddNotificationUI()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:27`); injected
  into the admin pages [NotificationList](#notificationlist) and
  [NotificationSend](#notificationsend).
- **Caveats / not-in-source**: `SendAsync` does not read
  `GetCurrentScopeDisplayNameAsync`; that member exists for the send page's caption and is consumed by
  [NotificationSend](#notificationsend) directly
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationSend.razor.cs:77`),
  not by this service.

### AbsoluteUrlAttribute

> MMCA.Common.UI · `MMCA.Common.UI.Validation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Validation/AbsoluteUrlAttribute.cs:26` · Level 0 · class (sealed, `ValidationAttribute`)

- **What it is**: a DataAnnotations rule that a string property must be an absolute `http` or `https` URL. It is the client-side twin of the server's `AbsoluteUrlRules` in MMCA.Common.Application, so a form gives the same verdict the API would (doc comment, `AbsoluteUrlAttribute.cs:6-8`).
- **Depends on**: nothing first-party. Externals: `System.ComponentModel.DataAnnotations` (`ValidationAttribute`, `ValidationResult`, `ValidationContext`, `RequiredAttribute`), BCL `Uri`. It is consumed by [DataAnnotationsModelValidator](#dataannotationsmodelvalidator), which is the thing that actually runs it on a MudBlazor field.
- **Concept introduced, validation parity as a security control, not just a UX nicety.** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether the rules a form enforces match the rules the server enforces. Most parity gaps cost only a wasted round trip. This one is different, and the doc comment says why (lines 8-11): the values this rule guards get rendered straight into an image `src` or a link `href`, so accepting `javascript:` or `data:` on the client and rejecting it on the server means the only thing between a pasted script URL and the rendered page is a network hop.
  - `[Rubric §26, Front-End Security]` assesses browser-side hardening. Restricting the accepted schemes to exactly `http` and `https` (lines 44-46) is the narrow allowlist that keeps a `javascript:` URL out of an anchor target in the first place.
  - **Optionality is the caller's decision.** Null, empty, and whitespace all pass (line 39). The attribute deliberately does not imply "required": a mandatory field pairs this with `[Required]`, which is what keeps a blank required field showing one clear message instead of two (lines 12-16).
  - **The message is a resource key channel.** `ErrorMessage` is returned unchanged rather than run through `string.Format` (line 52), which is what lets a model declare `ErrorMessage = "Validation.AbsoluteUrl"`; [DataAnnotationsModelValidator](#dataannotationsmodelvalidator) resolves every message it receives against the page's localizer and passes an unknown key through untouched, so a plain-English message still renders as written (lines 17-23). See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) for the localization model.
- **Walkthrough**
  - `[AttributeUsage(AttributeTargets.Property, AllowMultiple = false)]` (line 25): properties only, once each.
  - The parameterless constructor (lines 29-32) passes the default English message `"The value must be an absolute http or https URL."` to the `ValidationAttribute` base, so a model that declares no `ErrorMessage` still says something useful.
  - `IsValid(object?, ValidationContext)` (lines 35-53) null-guards the context (line 37), then returns `ValidationResult.Success` for anything that is not a non-blank string (lines 39-42). That single guard is what implements the "optional by default" contract above.
  - The accept path (lines 44-49): `Uri.TryCreate(url, UriKind.Absolute, out Uri? uri)` combined with an ordinal scheme comparison against `Uri.UriSchemeHttp` and `Uri.UriSchemeHttps`. `UriKind.Absolute` alone is not enough, because plenty of non-web schemes parse as absolute URIs; the scheme equality check is the actual gate.
  - The reject path (lines 51-52) builds the member-name array from `validationContext.MemberName` when one is present and returns `new ValidationResult(ErrorMessage, members)`, so MudBlazor can attribute the failure to the right field.
- **Why it's built this way**: expressing the rule as an attribute means it travels with the model property rather than with a page, so every form that binds that property inherits it, and the same model can be validated on the server by `Validator.TryValidateProperty`. Comparing with `StringComparison.Ordinal` against the BCL scheme constants avoids the culture-sensitive comparison trap and matches how `Uri` normalizes schemes to lowercase.
- **Where it's used**: applied to URL-bearing properties on shared form and request models, and executed by [DataAnnotationsModelValidator](#dataannotationsmodelvalidator) through the [ModelValidation](#modelvalidation) bridge.
- **Caveats / not-in-source**: the exact set of consumer models carrying this attribute is not visible from this file; the server-side `AbsoluteUrlRules` it mirrors lives in MMCA.Common.Application and is only named in the doc comment (line 7).

### BrandColors

> MMCA.Common.UI · `MMCA.Common.UI.Theme` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/BrandColors.cs:10` · Level 0 · class (static)

- **What it is**: the single C# source of truth for the brand palette: six hex constants (a primary triad and a secondary triad) that [MMCATheme](#mmcatheme) reads for both its light and dark MudBlazor variants.
- **Depends on**: nothing first-party. It is mirrored by the CSS custom properties in `wwwroot/app.css` (`--mmca-primary`, `--mmca-primary-dark`, `--mmca-primary-light`, `--mmca-secondary`, `--mmca-secondary-dark`, named in the doc comments at `BrandColors.cs:5-8,12,15,18,22,28`).
- **Concept introduced, a fitness-tested duplication.** `[Rubric §20, Design System & Theming]` assesses whether visual tokens are centralized rather than scattered as literals; here the palette lives in exactly one C# class. `[Rubric §34, Architecture Governance & Documentation]` assesses whether *necessary* duplication is monitored: C# cannot read CSS at build time, so the same colors must exist in both `BrandColors` and `app.css`, and `BrandColorTokenTests` in MMCA.Common.UI.Tests asserts the two stay in sync so the copy cannot silently drift (`BrandColors.cs:6-8`).
  - `[Rubric §21, Accessibility]` lands here rather than only in the theme: the `Secondary` constant carries its own contrast math in source, Teal 700 `#00796B` holding about 5.3:1 on light surfaces, replacing the Teal 600 `#00897B` that measured about 4.0:1 and sat under the WCAG 2.1 AA 4.5:1 floor for normal text (`BrandColors.cs:21-26`).
- **Walkthrough**: six `public const string` fields. The primary triad: `Primary = "#1565C0"` (line 13), `PrimaryDark = "#0D47A1"` (line 16), `PrimaryLight = "#42A5F5"` used for accents and dark-mode contrast (line 19). The secondary triad: `Secondary = "#00796B"` (line 26, with the contrast rationale immediately above it at lines 21-25), `SecondaryDark = "#00695C"` (line 29), and `SecondaryLight = "#4DB6AC"` (line 32).
- **Why it's built this way**: `const` rather than `static readonly` means the values can appear in contexts that require compile-time constants; the governance is the fitness test, not the language keyword. Keeping the palette in one class means a rebrand touches one file plus the mirrored CSS, and the accessibility reasoning travels with the value it justifies instead of living in a review comment.
- **Where it's used**: the [MMCATheme](#mmcatheme) light and dark palettes (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/MMCATheme.cs:18-24,52-61`); `BrandColorTokenTests`; any component that references a brand color programmatically.

### IModelValidator

> MMCA.Common.UI · `MMCA.Common.UI.Validation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Validation/IModelValidator.cs:13` · Level 0 · interface

- **What it is**: a one-method contract that validates a single property of a form model and returns that property's error messages. It is the pluggable rule engine behind [ModelValidation](#modelvalidation)`.For`.
- **Depends on**: nothing. Its in-box implementation is [DataAnnotationsModelValidator](#dataannotationsmodelvalidator) (named in the doc comment, line 8); its only caller is [ModelValidation](#modelvalidation).
- **Concept introduced, the shape MudBlazor forces and the abstraction that exploits it.** MudBlazor hands a field's `Validation` delegate two arguments: the form model and the dotted path of the member being edited. That is exactly the shape a rule engine needs, so the interface simply names it: `IEnumerable<string> Validate(object model, string propertyPath)` (line 27).
  - `[Rubric §1, SOLID]` assesses dependency direction and interface size. This is a one-method, dependency-free interface, and the doc comment (lines 8-10) states the payoff plainly: a consumer that keeps its rules in FluentValidation supplies its own implementation, so MMCA.Common.UI never has to reference a validation library. The abstraction exists to keep a NuGet dependency *out* of a shipped UI package, not to satisfy a pattern.
  - `[Rubric §24, Forms, Validation & UX Safety]` assesses where form rules live. By making the engine pluggable, the framework can offer a default (attributes on the model) without forcing it on a consumer whose rules already live somewhere else.
  - **Two contract details are load-bearing and documented rather than typed.** The `propertyPath` is dotted and relative to the model, for example `"Title"` or `"Address.City"` (lines 19-23), which is what MudBlazor derives from a field's `For` expression. And the return value is never null (line 25): an empty sequence means valid, so no caller has to null-check.
- **Walkthrough**: a single member, `Validate(object model, string propertyPath)` (line 27), returning `IEnumerable<string>`. `object` rather than a generic type parameter is deliberate: MudBlazor's `Validation` parameter is itself untyped at that position, so a generic interface would only add a cast at the boundary.
- **Why it's built this way**: the smallest possible extension point that still matches the host framework's calling convention. Anything wider (a "validate the whole model" method, a result type) would be unused by the one thing that calls it.
- **Where it's used**: accepted by [ModelValidation](#modelvalidation)`.For` (`ModelValidation.cs:43`), which wraps it in the delegate a MudBlazor field's `Validation` parameter expects; implemented by [DataAnnotationsModelValidator](#dataannotationsmodelvalidator).

### DataAnnotationsModelValidator

> MMCA.Common.UI · `MMCA.Common.UI.Validation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Validation/DataAnnotationsModelValidator.cs:21` · Level 1 · class (sealed)

- **What it is**: the in-box [IModelValidator](#imodelvalidator), backed by `System.ComponentModel.DataAnnotations`. It validates one property against the attributes declared on the model and localizes every message it produces, so the rules a shared request or form model already carries are the only place those rules are written and markup stops repeating `Required` / `MaxLength` per field.
- **Depends on**: first-party: [IModelValidator](#imodelvalidator) (the contract it implements, line 21), and it executes rules such as [AbsoluteUrlAttribute](#absoluteurlattribute). Externals: `System.ComponentModel.DataAnnotations` (`Validator`, `ValidationContext`, `ValidationResult`), `System.Reflection` (`PropertyInfo`, `BindingFlags`, `AmbiguousMatchException`), `Microsoft.Extensions.Localization` (`IStringLocalizer`, `LocalizedString`).
- **Concept introduced, message-as-resource-key with pass-through fallback.** `[Rubric §27, Internationalization & Localization]` assesses whether user-facing text resolves per culture from one catalog. Every message this validator produces is looked up against the injected `IStringLocalizer` (line 149) and returned as the raw message when `localized.ResourceNotFound` (line 150). That single line is what makes the design safe to adopt incrementally: a model can declare `ErrorMessage = "Some.Resource.Key"` and get a localized string, or declare plain English and get plain English, with no flag to set. See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) for the localization model this plugs into.
  - `[Rubric §24, Forms, Validation & UX Safety]` assesses single-declaration rules; the model's attributes are the declaration and this class is the only executor.
  - **Reflection that fails silently, on purpose.** `TryResolveOwner` returns false when a link in a dotted path is null or the member does not exist (lines 95-98, 106-110). The comment (lines 77-79) gives the reasoning: an unreachable path carries no rules, so it cannot fail, and a partially built model never throws mid-keystroke. A validator that threw while the user was typing would be worse than one that says nothing.
  - **A real reflection edge case is handled rather than ignored.** `FindProperty` (lines 118-129) catches `AmbiguousMatchException` and retries with `BindingFlags.DeclaredOnly`, because a `new`-shadowed property matches twice under `FlattenHierarchy`; the comment (line 126) records the tie-break rule, the most-derived declaration is the one bound in markup.
- **Walkthrough**
  - `PropertyLookup` (lines 23-24) is the shared `BindingFlags` set: `Public | Instance | FlattenHierarchy`.
  - The constructor (lines 36-41) requires an `IStringLocalizer` and null-guards it. The parameter doc (lines 31-35) tells callers to pass the page's own `IStringLocalizer<TResource>` precisely so that unknown keys fall through unchanged.
  - `Validate(object model, string propertyPath)` (lines 44-55) is the [IModelValidator](#imodelvalidator) implementation: guard, resolve the owner and `PropertyInfo`, return an empty array when unresolvable (line 51), then validate the value the model currently holds via `property.GetValue(owner)` (line 54).
  - `ValidateValue(object model, string propertyPath, object? value)` (lines 66-74) is the sibling used when the *candidate* value has not been written to the model yet, which is the case for the single-field bridge [ModelValidation](#modelvalidation)`.ForProperty`.
  - `TryResolveOwner` (lines 81-116) is `internal static` so [ModelValidation](#modelvalidation)`.IsRequired` can reuse it (`ModelValidation.cs:97`). It splits the path on `.` with `RemoveEmptyEntries` (line 90) and walks segment by segment, returning the last segment's `PropertyInfo` plus the object that declares it (lines 100-104). `[NotNullWhen(true)]` on both `out` parameters (lines 84-85) is what lets callers dereference them without a null check after a true return.
  - `ValidateResolved` (lines 131-140) builds a `ValidationContext(owner) { MemberName = property.Name }`, calls `Validator.TryValidateProperty` (line 135), and projects the results through `Localize`, dropping empties (lines 137-139).
  - `Localize` (lines 142-151) is the resource-key resolution described above.
- **Why it's built this way**: reusing the BCL validator rather than writing a rule interpreter means every DataAnnotations attribute (in-box or custom, such as [AbsoluteUrlAttribute](#absoluteurlattribute)) works with no registration. Splitting `Validate` from `ValidateValue` is the difference between "check what the model holds" and "check what the user just typed", and both are needed because MudBlazor's two binding styles deliver the value at different times.
- **Where it's used**: constructed inline on a page over that page's localizer and handed to [ModelValidation](#modelvalidation)`.For`, exactly as [NotificationSend](#notificationsend) does (`NotificationSend.razor.cs:66`).

### NotificationSendModel

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationSendModel.cs:19` · Level 1 · class (sealed)

- **What it is**: the two-property form model for the push-notification compose page. Its DataAnnotations are the single declaration of that form's field rules.
- **Depends on**: first-party: [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) (the endpoint contract, whose length constants it reuses, lines 23 and 28). Externals: `System.ComponentModel.DataAnnotations` (`RequiredAttribute`, `MaxLengthAttribute`). It is consumed by [NotificationSend](#notificationsend) through [ModelValidation](#modelvalidation) and [DataAnnotationsModelValidator](#dataannotationsmodelvalidator).
- **Concept introduced, one number shared by the cap, the message, and the server invariant.** The lengths are *not* declared here. `MaxLength(SendPushNotificationRequest.TitleMaxLength)` (line 23) and `MaxLength(SendPushNotificationRequest.BodyMaxLength)` (line 28) point at the shared request contract, which fixes them at 200 and 2000 (`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/PushNotifications/SendPushNotificationRequest.cs:15,21`). The same constants drive the input cap and the character counter in the markup (`NotificationSend.razor:49-50,61-62`), and the server-side validator enforces the same numbers.
  - `[Rubric §24, Forms, Validation & UX Safety]` assesses whether client and server agree. Here they cannot disagree, because there is one literal and everything else is a reference to it.
  - `[Rubric §9, API & Contract Design]` assesses whether contract facts live with the contract; putting the length constants on the request record (the type the endpoint binds) rather than on the form model is what makes the sharing possible in the first place.
  - `[Rubric §27, Internationalization & Localization]`: each `ErrorMessage` is a resource key (`"Notif.Send.Field.Title.Required"`, line 22, and its three siblings), resolved by the page's localizing [DataAnnotationsModelValidator](#dataannotationsmodelvalidator) per [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html). This is the concrete case the pass-through localization in that validator was designed for.
- **Walkthrough**: two mutable `string` properties, both initialized to `string.Empty` so a fresh model binds cleanly. `Title` (line 24) carries `[Required]` with key `Notif.Send.Field.Title.Required` (line 22) and `[MaxLength(200)]` with key `Notif.Send.Field.Title.MaxLength` (line 23). `Body` (line 29) carries the matching pair, `Notif.Send.Field.Message.Required` (line 27) and `Notif.Send.Field.Message.MaxLength` with the 2000-character cap (line 28).
- **Why it's built this way**: a settable class rather than a record with `init` accessors, because MudBlazor two-way binding (`@bind-Value="_model.Title"`) writes back into the instance. It is a separate type from [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) because the form model is mutable and carries presentation rules, while the request record is the immutable wire contract; the page maps one to the other in a single line (`NotificationSend.razor.cs:110`).
- **Where it's used**: held as `private readonly NotificationSendModel _model = new()` by [NotificationSend](#notificationsend) (`NotificationSend.razor.cs:35`) and bound by both fields in its markup.

### BlazorCspPolicyProvider

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Security` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:24` · Level 2 · class (internal, sealed)

- **What it is**: the Content-Security-Policy provider for a Blazor Web host. It computes one CSP string at construction, pinning `connect-src` to `'self'` plus the configured API or Gateway origin (https and its matching WebSocket origin), and hands it to the shared security-headers middleware on every request.
- **Depends on**: first-party: [ICspPolicyProvider](group-16-aspire-orchestration.md#icsppolicyprovider) (the contract it implements, line 24), [CspPolicy](group-16-aspire-orchestration.md#csppolicy) (the value it returns, a policy string plus an `Enforce` flag), [SecurityHeadersMiddleware](group-16-aspire-orchestration.md#securityheadersmiddleware) (its only consumer, named in the class doc at line 12), and [ApiSettings](#apisettings) (the endpoint source, injected as `IOptions<ApiSettings>` at line 29). Externals: `Microsoft.Extensions.Options` (`IOptions<T>`), `Microsoft.AspNetCore.Hosting` (`IWebHostEnvironment`), `Microsoft.AspNetCore.Http` (`HttpContext`), BCL `Uri`.
- **Concept introduced, a computed CSP that fails closed.** `[Rubric §26, Front-End Security]` assesses whether the browser is told which origins may load scripts and open connections. A static CSP cannot express "this deployment's API origin", because that origin is configuration, so the policy is *built* rather than hard-coded. The two directives that matter for exfiltration are locked: `script-src 'self' 'wasm-unsafe-eval'` (line 80, where the WASM allowance is what lets the Blazor WebAssembly runtime instantiate) and the computed `connect-src` (line 60). The load-bearing decision is what happens when the origin cannot be determined. The provider narrows `connect-src` to `'self'`, keeps the rest of the policy unchanged, and stays **enforced** (`Enforce: true`, line 54). A misconfigured endpoint therefore surfaces immediately as blocked API calls in the browser console rather than as a permissive header that protects nothing and that nobody notices, and the class doc states the reasoning outright: a security response header that quietly stops being enforced is the worse failure mode (lines 16-20).
  - `[Rubric §11, Security]` assesses the wider defense posture; this class is one control in a chain that also includes the session-cookie auth design and the security-headers middleware, and it is deliberately `internal` (line 24) so the only supported way to get it is the registration call, not a hand-wired `new`.
- **Walkthrough**
  - `_policy` (line 27) is a single `CspPolicy` field computed once. The constructor (lines 29-34) null-guards both injected dependencies and calls `BuildCsp(apiOptions.Value, environment.IsDevelopment())` (line 33). Because the type is registered as a singleton, this runs exactly once per process.
  - `GetPolicy(HttpContext context)` (line 37) ignores the context and returns the cached policy, so the per-request cost is a field read.
  - `BuildCsp` (lines 41-72) resolves the endpoint as `api.WasmApiEndpoint ?? api.ApiEndpoint` (line 43). The guard on lines 47-50 rejects a blank value, a non-absolute URI, and any scheme that is not http or https; the comment on lines 45-46 records why the scheme check is not redundant: on Linux a rooted path such as `/relative/path` parses as an absolute `file://` URI and would otherwise sail through `Uri.TryCreate`. A rejected endpoint returns the enforced `connect-src 'self'` policy (line 54).
  - With a valid endpoint it derives `origin` via `apiUri.GetLeftPart(UriPartial.Authority)` (line 58, `scheme://host:port`), picks `wss` or `ws` to match (line 59), and composes `connect-src 'self' {origin} {wsScheme}://{authority}` (line 60). The WebSocket origin is there for the SignalR notification hub, so the live push channel is allowed without opening `connect-src` to the world.
  - Development only (lines 66-69) appends `http://localhost:*` and `ws://localhost:*` for Visual Studio Browser Link and Hot Reload, whose ports change per run (comment, lines 62-65); the production policy is untouched.
  - `BuildPolicy` (lines 78-87) assembles the directive list: `default-src 'self'`, the `script-src` above plus `'unsafe-inline'` **in Development only** (line 80, for the injected Hot Reload bootstrap), `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: https:` (line 82, deliberately open because profile pictures and content images come from arbitrary external hosts, per the comment on lines 74-77), `font-src 'self'`, the computed `connect-src`, `base-uri 'self'`, `form-action 'self'`, and `frame-ancestors 'none'` (line 87, clickjacking protection).
- **Why it's built this way**: computing once and caching keeps the hot path free, and returning a [CspPolicy](group-16-aspire-orchestration.md#csppolicy) record rather than writing a header directly keeps the provider testable and lets one middleware own header emission. Registering it with `AddSingleton` (not `TryAdd`) is what makes it *replace* the default static provider, which is why the ordering rule in the class doc (lines 21-22) matters: call `AddCommonBlazorCsp()` before `AddCommonSecurityHeaders`.
- **Where it's used**: registered by `AddCommonBlazorCsp()` in the `MMCA.Common.UI.Web` [DependencyInjection](#dependencyinjection) (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:39-40`); the policy it returns is emitted by [SecurityHeadersMiddleware](group-16-aspire-orchestration.md#securityheadersmiddleware). The class doc notes it was hoisted out of the app Blazor Web hosts where it had been byte-identical (line 21).
- **Caveats / not-in-source**: the registration method's own XML doc still describes the fallback as a "permissive Report-Only fallback on misconfiguration" (`MMCA.Common.UI.Web/DependencyInjection.cs:35`). The code is the truth: the fallback is enforced and narrowed to `'self'` (line 54). Treat that doc line as stale.

### MMCATheme

> MMCA.Common.UI · `MMCA.Common.UI.Theme` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Theme/MMCATheme.cs:9` · Level 2 · class (static)

- **What it is**: the single application-wide MudBlazor `MudTheme` instance, defining the brand palette (light and dark), typography, and layout radius, applied once via `MudThemeProvider` in the root layout.
- **Depends on**: [BrandColors](#brandcolors) (the palette source of truth); MudBlazor (NuGet: `MudTheme`, `PaletteLight`, `PaletteDark`, `Typography`, `LayoutProperties`).
- **Concept introduced, one theme, accessibility-justified.** `[Rubric §20, Design System & Theming]` assesses whether an app has a single coherent theme rather than per-page overrides; `MMCATheme.Instance` is that one object (line 11), and the dark palette is what drives `MudThemeProvider`'s `IsDarkMode` (the comment at lines 50-51 says so explicitly). `[Rubric §21, Accessibility]` is unusually visible here, because several color choices carry inline WCAG 2.1 AA contrast math:
  - light `WarningContrastText = "#212121"` (line 33), because MudBlazor's default white on amber `#F57F17` is about 2.65:1 and failed the gated admin-order-list axe scan on a "Pending Payment" chip; dark text is about 7.9:1 (lines 29-32);
  - dark `PrimaryContrastText = "rgba(0,0,0,0.87)"` (line 58), because white on the lightened dark-mode primary `#42A5F5` is about 2.65:1 while dark text is about 6.6:1 (lines 55-57);
  - dark `WarningContrastText` (line 67), white on `#FFA726` being about 2.0:1 against about 10.8:1 (line 66);
  - dark `ErrorContrastText` (line 71), white on `#EF5350` being about 3.5:1 against about 5.5:1 (lines 69-70).

  The `Secondary` contrast rationale is deliberately *not* repeated here: line 21 points at [BrandColors](#brandcolors), where the value and its justification live together.
- **Walkthrough**: a single `static MudTheme Instance { get; }` (line 11) initialized with four blocks.
  - `PaletteLight` (lines 13-47) reads its primary and secondary triads straight from [BrandColors](#brandcolors) (lines 18-24), sets the semantic colors (`Tertiary`, `Info`, `Success`, `Warning`, `Error`, lines 25-34), and then fixes app chrome: appbar `#1A2035`, background `#FAFBFC`, surface white, the drawer tones, text and divider values (lines 35-46).
  - `PaletteDark` (lines 48-84) lightens the primary for contrast on dark surfaces (`Primary = BrandColors.PrimaryLight`, line 52), keeps the same appbar and drawer chrome so the shell reads identically in both modes (lines 72-78), and darkens the surface stack (`Background = "#1A2027"`, `Surface = "#27303A"`, lines 74-75) with light text and dark dividers (lines 79-83).
  - `Typography` (lines 85-163). `Default` sets the font stack `Inter, Segoe UI, Helvetica Neue, Arial, sans-serif` (line 92); the comment above it (lines 89-91) records that Inter is self-hosted by this RCL (`wwwroot/fonts` plus an `@font-face` block in `wwwroot/app.css`) and that before those faces existed the stack silently fell through to Segoe UI, so the two must stay in step. `H1` through `H4` (lines 98-125) use display weights 800/800/700/700 with slight negative letter spacing, which the comment (lines 94-97) explains is how Inter is meant to be set at large sizes; `H5` and `H6` stay at weight 600 with no negative tracking (lines 126-137). `Subtitle1`/`Subtitle2` sit at weight 500 (lines 138-145), `Body1`/`Body2` set line heights 1.6 and 1.5 (lines 146-153), and `Button` (lines 157-162) sets `TextTransform = "none"`, because MudBlazor's default uppercasing wrecks localized strings (German compounds, accented capitals) and reads dated; weight 600 keeps the label as prominent as the shouting did (comment, lines 154-156).
  - `LayoutProperties` sets `DefaultBorderRadius = "6px"` (lines 164-167).
- **Why it's built this way**: a static get-only property means the theme is constructed once and shared by every `MudThemeProvider`. Sourcing the brand hues from [BrandColors](#brandcolors) rather than re-typing hex is what lets `BrandColorTokenTests` police C# versus CSS drift, and the per-color contrast comments turn accessibility decisions into reviewable source rather than tribal knowledge. The button-casing override is a small but instructive case of `[Rubric §27, Internationalization & Localization]` reaching into theming: a purely visual default became a localization problem.
- **Where it's used**: applied in the root layout of the Blazor Web and MAUI hosts via `MudThemeProvider Theme="MMCATheme.Instance"`.

### ModelValidation

> MMCA.Common.UI · `MMCA.Common.UI.Validation` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Validation/ModelValidation.cs:26` · Level 2 · class (static)

- **What it is**: the bridge that turns a form model's declared rules into the delegate MudBlazor's field `Validation` parameter expects, so a page declares its rules once (on the model) instead of scattering `Required` and `MaxLength` across the markup and re-checking them by hand.
- **Depends on**: first-party: [IModelValidator](#imodelvalidator) (the pluggable engine taken by `For`) and [DataAnnotationsModelValidator](#dataannotationsmodelvalidator) (taken concretely by `ForProperty`, and reused via its `internal static` `TryResolveOwner` in `IsRequired`, line 97). Externals: `System.Linq.Expressions` (`Expression<Func<,>>`, `MemberExpression`, `UnaryExpression`, `ParameterExpression`), `System.ComponentModel.DataAnnotations` (`RequiredAttribute`), `System.Reflection` (`PropertyInfo`).
- **Concept introduced, adapting a model's rules onto a UI library's callback shape.** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether validation is declared once and enforced consistently. MudBlazor's contract is a delegate; DataAnnotations' contract is attributes on a type. This class is the two-line adapter between them, and the usage block in the doc comment (lines 14-24) is the canonical example a page copies: `_validate = ModelValidation.For(_model, new DataAnnotationsModelValidator(L))` in `OnInitialized`, then `Validation="@_validate"` on every field.
  - **One delegate serves the whole form.** `For` returns a closure that ignores nothing and dispatches on the path MudBlazor passes (line 48), so a fifteen-field form still assigns the same single delegate to every field. The fallback `instance ?? model` on that line is the small robustness detail: MudBlazor normally passes its own `MudForm.Model` back, and the captured instance covers the case where it does not, so a field still validates outside a form (parameter doc, lines 33-36).
  - `[Rubric §16, Maintainability]` assesses rename safety. `ForProperty` names the property by expression rather than by string (line 71), so a rename becomes a compile error instead of a silently dead rule.
  - `[Rubric §21, Accessibility]`: `IsRequired` exists so a field's `Required` parameter (the asterisk and the `aria-required` affordance) can be read off the same model that supplies the rules, rather than being typed a second time in markup where it can drift from the rule (doc, lines 83-87). It is explicitly *not* a second rule: MudBlazor's own required message is unused when a `Validation` delegate is present, so the localized message from the model is the one shown.
- **Walkthrough**
  - `For(object model, IModelValidator validator)` (lines 43-49): null-guards both arguments, then returns `(instance, propertyPath) => validator.Validate(instance ?? model, propertyPath)` (line 48). This is the model-wide bridge, and it is what almost every page wants.
  - `ForProperty<TModel, TValue>(TModel model, Expression<Func<TModel, TValue>> property, DataAnnotationsModelValidator validator)` (lines 69-81): resolves the dotted path once at setup via `GetPropertyPath` (line 79) and returns `value => validator.ValidateValue(model, path, value)` (line 80). Note the parameter type is the concrete validator, not the interface: the doc (lines 55-58) says why, the value being validated has not necessarily been written to the model yet, so the rules must come from DataAnnotations directly rather than from an arbitrary engine reading the model's current state.
  - `IsRequired(object model, string propertyPath)` (lines 92-99): resolves the property through [DataAnnotationsModelValidator](#dataannotationsmodelvalidator)`.TryResolveOwner` and reports `property.IsDefined(typeof(RequiredAttribute), inherit: true)` (line 98).
  - `GetPropertyPath<TModel, TValue>` (lines 109-133) renders an expression as the dotted path MudBlazor's `For` would produce. It first unwraps the `Convert` node the compiler inserts when `TValue` is a value type boxed to object (lines 114-116, with the comment saying so), then walks `MemberExpression` links pushing each name onto a `Stack<string>` (lines 118-123), which reverses `m => m.Address.City` into `Address.City` on `string.Join` (line 132). Anything that is not a chain of property accesses rooted at the lambda parameter throws `ArgumentException` with a message showing the expected shape (lines 125-130).
- **Why it's built this way**: a static class with no state, because the bridge is pure translation. Offering both a model-wide and a single-field entry point matches the two ways MudBlazor fields actually bind, and pushing the expensive part (expression parsing) into setup rather than into the per-keystroke delegate keeps validation cheap on the typing path.
- **Where it's used**: [NotificationSend](#notificationsend) builds its `_validate` delegate with `For` (`NotificationSend.razor.cs:66`) and reads its two `Required` affordances with `IsRequired` (`NotificationSend.razor:47,58`). It is public API of `MMCA.Common.UI`, so consumer app forms use the same bridge.

### NotificationInbox

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationInbox.razor.cs:26` · Level 4 · class (partial, page)

- **What it is**: the code-behind for the per-user notification inbox, routed at both `@page "/notifications/inbox"` and `@page "/notifications/inbox/{Id:int}"` (`NotificationInbox.razor:1-2`). It fetches the signed-in user's notifications a page at a time, renders each as a read or unread card, lets the user mark items read individually or all at once, highlights and scrolls to a deep-linked notification, and reloads the current page when a real-time push asks for a refresh.
- **Depends on**: first-party: [INotificationInboxUIService](#inotificationinboxuiservice) (the typed read-side HTTP service), [NotificationState](#notificationstate) (the per-circuit unread-count store and refresh signal), [UserNotificationDTO](group-10-notifications.md#usernotificationdto) (the row shape), [IToastService](#itoastservice) (the toast abstraction), [ResultUiExtensions](#resultuiextensions) (the `NotifyOnFailure` helper), and [SharedResource](#sharedresource) (the resx anchor for the localizer). Externals: `MudBlazor` (`IScrollManager`, `ScrollBehavior`, `BreadcrumbItem`, `Icons`), `Microsoft.AspNetCore.Components` (`[Inject]`, `[Parameter]`, `OnInitializedAsync`, `OnParametersSet`, `OnAfterRenderAsync`, `InvokeAsync`, `StateHasChanged`), `Microsoft.Extensions.Localization` (`IStringLocalizer<T>`), BCL `CancellationTokenSource`, `IDisposable`, `Math.Ceiling`, `CultureInfo.InvariantCulture`.
- **Concept introduced, the Blazor code-behind page pattern (`.razor` plus `.razor.cs` partial class).** The three notification pages in this unit are authored as *partial classes* split across two files: the `.razor` holds declarative MudBlazor markup and the routes, the `.razor.cs` holds the C# (`public partial class NotificationInbox`, line 26), the injected services, the view state, and the handlers. The framework constructs the component, calls `OnInitializedAsync` (line 73) once, and re-renders when a handler mutates a field. Four habits recur across all three pages and are worth learning once here:
  - **Disposal-safe async with a per-component `CancellationTokenSource`.** A `readonly CancellationTokenSource _cts` (line 45) is created with the component and its token is passed to every service call. `Dispose(bool)` (lines 338-350) cancels and disposes it behind the classic `_disposed` guard (line 336). Every async handler swallows `OperationCanceledException` silently (for example lines 241-244) because that is the *expected* outcome when the user navigates away mid-fetch.
  - **Result-typed failures, not exceptions.** The service calls return a `Result`, so the page branches on `TryGetValue` (line 220) and routes the failure through `result.NotifyOnFailure(Toast, L)` (line 238). The comment there (lines 236-237) records the rule that makes this safe: one toast, and the list is left as it was rather than blanked, so a transient failure does not erase what is on screen.
  - **Busy flags gate the UI.** `IsLoading` and `IsSaving` (lines 51-52) are `protected` with private setters; the markup shows progress while loading and sets `Disabled="IsSaving"` on the action controls (`NotificationInbox.razor:18`) so a double click cannot double-post.
  - **Push-driven refresh via an event subscription.** `OnInitializedAsync` subscribes to `NotificationState.OnRefreshRequested` (line 83) and `Dispose(bool)` unsubscribes (line 344).
  - `[Rubric §19, State Management & Data Flow]` assesses where state lives; transient view state stays in private fields (`_notifications`, `_currentPage`, `_totalPages`, lines 54-56) while the *shared* unread count is written back into the scoped [NotificationState](#notificationstate) (lines 289, 323) and its refresh signal is read. Local stays local, shared stays shared.
  - `[Rubric §25, Navigation, Routing & Information Architecture]` assesses route structure. The second `@page` directive is a **typed deep link**: a push payload or an email can point straight at one notification. The class doc (lines 18-24) states the two design rules that follow from it: the `:int` route constraint is the validation boundary, so a malformed id never reaches the component (the router renders `NotFound` instead), and an id that is simply not on the loaded page degrades silently to the plain inbox rather than raising an error the user can do nothing about.
  - `[Rubric §21, Accessibility]`: the icon-only mark-read control carries an explicit localized `aria-label` (`NotificationInbox.razor:59`).
  - `[Rubric §27, Internationalization & Localization]`: this page holds no literal English. The injected `IStringLocalizer<SharedResource> L` (line 33) resolves the title (line 47), the breadcrumbs, and every toast (`L["Notif.AllMarkedRead"]`, line 324). The breadcrumb trail is built inside `OnInitializedAsync` (lines 77-81), not in a field initializer, so the injected localizer is available and labels re-resolve per circuit under the active culture (comment, lines 75-76, citing [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Walkthrough**
  - `PageSize` (line 28) is `const int 20`: fixed-size server-side pagination, not infinite scroll. Injected `InboxService`, `NotificationState`, `Toast`, `L`, and MudBlazor's `ScrollManager` (lines 30-34).
  - `[Parameter] public int? Id` (line 43) is the deep-link route parameter. The doc (lines 36-42) explains the type choice: `UserNotificationIdentifierType` is an `int` alias, and a route parameter's type must be written out for the `:int` constraint to bind, so the parameter is declared `int?` and converted where it is used.
  - **Deep-link state is four separate fields, and each exists for a distinct reason** (lines 62-71): `_highlightedId` (found on the loaded page), `_pendingScrollId` (a scroll the next render owes), `_scrolledId` (already scrolled, so a re-render or push-driven reload never scrolls twice), and `_appliedId` (the `Id` the state was last computed for, to detect a re-navigation).
  - `OnParametersSet` (lines 94-103) clears the `_scrolledId` latch when `_appliedId != Id` and then recomputes the target. The doc (lines 88-93) records the bug this prevents: navigating from `/notifications/inbox/5` to `/notifications/inbox/9` reuses the component instance, so without clearing the latch the second deep link would highlight but never move the viewport.
  - `OnAfterRenderAsync` (lines 106-118) is the only place a scroll happens. It returns unless a scroll is pending and the component is alive, clears `_pendingScrollId` and sets `_scrolledId` **before** the await (comment, line 113, so a re-entrant render cannot queue the same scroll twice), and calls `ScrollManager.ScrollIntoViewAsync(CardSelector(id), ScrollBehavior.Smooth)` (line 117).
  - `ApplyDeepLinkTarget` (lines 126-140) matches the route id against what the loaded page actually holds: `Id is not { } id || id <= 0 || !_notifications.Exists(n => n.Id == id)` clears both the highlight and the pending scroll (lines 128-133). The doc (lines 120-125) is the "no toast" decision, a deep link the user cannot act on is not an error they caused.
  - The card-chrome helpers: `IsDeepLinkTarget` (line 142); `CardElementId` (lines 144-147, formatting `notification-{id}` with `CultureInfo.InvariantCulture` because it becomes a DOM id) and `CardSelector` (line 149); `CardElevation` (lines 152-160, 4 when deep-linked, else 1 for unread and 0 for read); `CardClass` (lines 162-168); and `CardStyle` (lines 175-183), which builds the unread left border and the deep-link ring from MudBlazor palette variables (`var(--mud-palette-primary)`, `var(--mud-palette-secondary)`) rather than literal hex, so both themes stay legible (comment, lines 170-174). `[Rubric §20, Design System & Theming]` shows up here: even inline styles source their colors from the theme's CSS custom properties.
  - **Push coalescing.** `HandleRefreshRequested` (lines 185-193) is `EventHandler`-shaped so it cannot be `async Task`; it discards into `InvokeAsync(RefreshFromPushAsync)` (line 192). `RefreshFromPushAsync` (lines 195-212) sets `_refreshPending = true` and returns when a load is already in flight (lines 202-208); the comment (lines 204-205) states the invariant, never drop the push, so overlapping pushes coalesce into exactly one trailing reload instead of vanishing.
  - `LoadNotificationsAsync` (lines 214-258): sets `IsLoading`, calls `GetInboxAsync(_currentPage, PageSize, _cts.Token)` (line 219), and on success materializes `page.Items` (line 222), computes `_totalPages` from `page.PaginationMetadata.TotalItemCount` with `Math.Ceiling` (line 223) clamped to a floor of 1 (lines 224-227) so an empty inbox never renders a zero-page pager, then recomputes the deep-link highlight (line 232, only a successful load can decide whether the id is present). The tail (lines 253-257) drains `_refreshPending` with one more `RefreshFromPushAsync`; the comment (lines 250-252) explains why the recursion is bounded, the flag is cleared first, so a push arriving during *this* reload queues one more and no further.
  - `OnPageChangedAsync(int page)` (lines 260-264): records the page and reloads.
  - `MarkReadAsync(UserNotificationDTO)` (lines 266-300): calls `MarkReadAsync(notification.Id, _cts.Token)` (line 271), returns early on failure after a toast (lines 272-276), then **optimistically patches local state**, locating the row with `FindIndex` (line 279) and replacing it via a `record with`-expression, `notification with { IsRead = true, ReadOn = DateTime.UtcNow }` (line 282). It then refetches the authoritative unread count (line 286) and pushes it into `NotificationState.SetUnreadCount` only when the count call succeeded (lines 287-290); a failed count means "unknown", so the badge keeps its value (comment, line 285).
  - `MarkAllReadAsync` (lines 302-334): one service call (line 307), a loop flipping every unread row in place (lines 315-321), then `SetUnreadCount(0)` (line 323) and a localized success toast (line 324).
  - Disposal: `_disposed` (line 336), `Dispose(bool)` (lines 338-350) unsubscribing the refresh event and cancelling the `_cts`, `Dispose()` (lines 352-356) with `GC.SuppressFinalize`.
- **Why it's built this way**: the page is a *thin* view over [INotificationInboxUIService](#inotificationinboxuiservice), so all HTTP and JSON live in the service and the component stays testable against a stub. Patching local state after a mark-read (rather than refetching the page) keeps the interaction snappy while still reconciling the shared badge from the server, and the coalescing refresh keeps the list current when pushes arrive in bursts. The deep-link machinery is worth reading as a case study in idempotent side effects: a scroll is a one-shot action in a component model that re-renders freely, so it needs the "owed" and "already done" flags to be correct under re-render, re-navigation, and disposal.
- **Where it's used**: rendered at `/notifications/inbox` (and `/notifications/inbox/{Id:int}`) for authenticated users; the route constant and nav entry come from [NotificationRoutePaths](#notificationroutepaths) and [NotificationUIModule](#notificationuimodule). [NotificationBell](#notificationbell) reads the same [NotificationState](#notificationstate) this page writes, and the layout-mounted `NotificationListener` raises the `OnRefreshRequested` signal it consumes. Its admin siblings are [NotificationList](#notificationlist) and [NotificationSend](#notificationsend).

### ServerTokenStorageService

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web.Services` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:17` · Level 4 · class (sealed)

- **What it is**: the Blazor **Server** implementation of [ITokenStorageService](#itokenstorageservice): a cookie-only token store with no `localStorage`. During SSR prerender it reads the access token from the HttpOnly session cookie; on the live interactive circuit it holds the access token in memory only and re-acquires it from those cookies through a same-origin refresh endpoint. The refresh token is never readable from JavaScript.
- **Depends on**: first-party: [ITokenStorageService](#itokenstorageservice) (the contract, line 21), [CookieTokenReader](group-08-auth.md#cookietokenreader) (reads the access and refresh cookies off the request), [ISessionCookieSync](#isessioncookiesync) (seeds and clears the HttpOnly cookies), [ITokenRefresher](#itokenrefresher) (acquires a fresh access token from `/auth/session/token`), and [JwtTokenInfo](#jwttokeninfo) (client-side freshness check). Its WASM sibling is [WasmTokenStorageService](#wasmtokenstorageservice) (named in the class doc, line 14). Externals: `Microsoft.AspNetCore.Http` (`IHttpContextAccessor`, `HttpContext`), BCL `Lock`, `Task`, `TimeSpan`.
- **Concept introduced, the two-world token store (SSR request versus interactive circuit).** A Blazor Web page runs twice: first as a server-side prerender inside a live HTTP request, where an `HttpContext` exists and JS interop does not, and then as a stateful circuit with no `HttpContext`. One store has to serve both worlds, and this class branches on `httpContextAccessor.HttpContext is not null` (line 34) to decide which source of truth applies.
  - **SSR prerender** (lines 34-37): the request's HttpOnly cookie wins, read via `cookieTokenReader.ReadAccessToken()` (line 36), because the middleware may have just refreshed it in place on this navigation (comment, lines 32-33).
  - **Interactive circuit** (lines 39-71): the token lives in the `_accessToken` field (line 27). If `JwtTokenInfo.IsFresh(_accessToken, ExpirySkew)` (line 40) says it survives the 30-second skew (line 23), it is returned as is; otherwise it is re-acquired.
  - `[Rubric §26, Front-End Security]` assesses how credentials are held in the browser. This is a deliberate XSS-hardening design: the long-lived refresh token stays in an HttpOnly cookie unreachable from script, the access token exists only in circuit memory and is never persisted, and the refresh token transits JS exactly once, for the same-origin POST that seeds the cookies at login (`SetTokensAsync`, lines 81-87).
  - `[Rubric §11, Security]` assesses the wider auth model; this store is one edge of the browser session-cookie design ([ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)), the piece that decides *where* a bearer token is read on each side of the prerender boundary.
  - `[Rubric §12, Performance & Scalability]` shows up in the single-flight hydrate: a Blazor circuit is genuinely multi-threaded, and several consumers (the delegating handler, the auth-state provider, the SignalR connection) can all miss the cache at once.
- **Walkthrough**
  - The primary constructor (lines 17-21) takes `IHttpContextAccessor`, [CookieTokenReader](group-08-auth.md#cookietokenreader), [ISessionCookieSync](#isessioncookiesync), and [ITokenRefresher](#itokenrefresher). The type is `sealed` and carries no app-specific state, which is why it could be hoisted out of both app hosts (class doc, lines 13-15).
  - Fields: `ExpirySkew` (line 23, a `static readonly TimeSpan` of 30 seconds), the `Lock _hydrateSync` (line 25, the .NET 9+ dedicated lock object), the in-memory `_accessToken` (line 27), and `_hydrateInFlight` (line 28), the shared acquisition task.
  - `GetAccessTokenAsync` (lines 30-72): the SSR/circuit branch, then the **single-flight** guard. `_hydrateInFlight ??= HydrateAsync()` executes *inside* `lock (_hydrateSync)` (lines 50-54) and the resulting task is copied to a local before the lock is released. The comment on lines 45-48 records exactly why the naive unguarded `??=` was not enough: two callers could each start a hydrate and the later completion would overwrite the other's token; `HydrateAsync` reaches its first await immediately, so nothing slow runs under the lock. The `finally` (lines 60-71) clears `_hydrateInFlight` **only when it is still reference-equal to the task this caller awaited** (line 66), so a newer hydrate started after this one completed is not dropped, which would split the next set of callers again.
  - `GetRefreshTokenAsync` (lines 74-79): returns `cookieTokenReader.ReadRefreshToken()` during SSR and `null` on the circuit, because the HttpOnly refresh cookie is unreadable there; it wraps the value in `Task.FromResult` rather than being `async` (no await needed).
  - `SetTokensAsync` (lines 81-87): caches the access token in memory (line 83) and calls `sessionCookieSync.SyncAsync(accessToken, refreshToken)` (line 86) to seed the HttpOnly cookies at login.
  - `ClearTokensAsync` (lines 89-93): nulls the in-memory token and calls `sessionCookieSync.ClearAsync()` on logout.
  - `HydrateAsync` (lines 95-99): the private acquisition, `_accessToken = await tokenRefresher.AcquireAccessTokenAsync()` (line 97), caching and returning the new token.
- **Why it's built this way**: Blazor Server's split lifecycle breaks the naive "read a token from storage" store, which would either fail during prerender (no JS) or leak the refresh token to script if it used `localStorage`. Branching on `HttpContext` presence and keeping the refresh token cookie-only resolves both. The locked single-flight is the correction of a real concurrency defect in the simpler `??=` version, and it is worth reading as a small case study in why "good enough" atomicity on a circuit is not good enough. See [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html).
- **Where it's used**: registered as the scoped [ITokenStorageService](#itokenstorageservice) by `AddCommonServerTokenStorage()` in the `MMCA.Common.UI.Web` [DependencyInjection](#dependencyinjection) (`DependencyInjection.cs:26-30`); consumer hosts call that instead of shipping their own copy.
- **Caveats / not-in-source**: the cookie names, lifetimes, and the `/auth/session/token` endpoint itself are not in this file; they live in the `MMCA.Common.API` session-cookie plumbing referenced by the doc comment (lines 12-15).

### DependencyInjection

> MMCA.Common.UI.Web · `MMCA.Common.UI.Web` · `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:14` · Level 5 · class (static)

- **What it is**: the registration extensions for the server-side Blazor Web host pieces this package ships: three `IServiceCollection` methods a host calls from `Program.cs` instead of registering app-local copies of the token store, the CSP provider, and the form factor.
- **Depends on**: first-party: [ServerTokenStorageService](#servertokenstorageservice) + [ITokenStorageService](#itokenstorageservice), [BlazorCspPolicyProvider](#blazorcsppolicyprovider) + [ICspPolicyProvider](group-16-aspire-orchestration.md#icsppolicyprovider), and [WebFormFactor](group-26-device-capability-layer.md#webformfactor) + [IFormFactor](group-26-device-capability-layer.md#iformfactor). Externals: `Microsoft.Extensions.DependencyInjection` (`IServiceCollection`, `AddScoped`, `AddSingleton`, `AddHttpContextAccessor`).
- **Concept**: the same `extension(IServiceCollection services)` block idiom used package-wide (line 16, see [primer](00-primer.md#c-extensiont-types-read-this-once)). What is worth studying here is that the XML docs carry **operational rules the compiler cannot enforce**, and they are the only place those rules are written down next to the code.
  - `[Rubric §15, Best Practices & Code Quality]` assesses idiom consistency; every `MMCA.Common.*` package registers services through the same extension shape, so a reader who has seen one registrar has seen them all.
  - `[Rubric §26, Front-End Security]` assesses browser hardening wiring; `AddCommonBlazorCsp()` is what actually puts [BlazorCspPolicyProvider](#blazorcsppolicyprovider) in front of the default static provider, and its doc (lines 35-37) encodes the ordering rule: call it **before** `AddCommonSecurityHeaders`, because the default is registered with `TryAdd` and would otherwise win.
- **Walkthrough**
  - `AddCommonServerTokenStorage()` (lines 26-30): calls `services.AddHttpContextAccessor()` (line 28), the accessor [ServerTokenStorageService](#servertokenstorageservice) needs to tell SSR from circuit, then registers it as the **scoped** [ITokenStorageService](#itokenstorageservice) (line 29). Scoped is the right lifetime: a circuit is a DI scope, so the in-memory access token is per-session state. The doc (lines 22-24) names the two companions this registration assumes, `AddServerAuthSessionCookie` and `UseCookieSessionRefresh` from `MMCA.Common.API`, plus a registered [ITokenRefresher](#itokenrefresher).
  - `AddCommonBlazorCsp()` (lines 39-40): registers [BlazorCspPolicyProvider](#blazorcsppolicyprovider) as a **singleton** [ICspPolicyProvider](group-16-aspire-orchestration.md#icsppolicyprovider), matching the provider's compute-once constructor. `AddSingleton` (not `TryAdd`) is what makes the replacement deterministic.
  - `AddCommonWebFormFactor()` (lines 47-48): registers [WebFormFactor](group-26-device-capability-layer.md#webformfactor) as a **singleton** [IFormFactor](group-26-device-capability-layer.md#iformfactor), which reports "Web" plus the server OS description; the doc (lines 44-45) notes the WASM client registers `AddWasmFormFactor()` from `MMCA.Common.UI` instead, so the same abstraction resolves differently per host kind.
- **Why it's built this way**: all three pieces are host-level infrastructure that carried no app-specific state, so they were hoisted into `MMCA.Common.UI.Web` and exposed as one-line registrations (class doc, lines 11-12). That keeps every consumer's `Program.cs` free of duplicated token-store, CSP, and form-factor wiring, which is the reusable-building-blocks charter of this group. See [ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html) for the session design the first method plugs into.
- **Where it's used**: called from the `Program.cs` of the server-interactive Blazor Web hosts in the consumer apps (MMCA.ADC, MMCA.Store).
- **Caveats / not-in-source**: the `AddCommonBlazorCsp()` doc (line 35) describes a "permissive Report-Only fallback on misconfiguration"; the provider it registers now fails closed and stays enforced (`BlazorCspPolicyProvider.cs:52-54`). The code is authoritative.

### NotificationBell

> MMCA.Common.UI · `MMCA.Common.UI.Components.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Notifications/NotificationBell.razor.cs:30` · Level 6 · class (partial, component)

- **What it is**: the code-behind for the app-bar notification bell. It renders an unread badge from the scoped [NotificationState](#notificationstate), and exactly one instance at a time holds the single active-poller slot, so a bell placed in two layout slots never doubles the API traffic.
- **Depends on**: first-party: [NotificationState](#notificationstate) (badge value, change and refresh events, staleness clock, and the poller slot), [INotificationInboxUIService](#inotificationinboxuiservice) (the unread-count call), [NotificationBellOptions](#notificationbelloptions) (the two intervals), [NotificationRoutePaths](#notificationroutepaths) (the inbox route), and [SharedResource](#sharedresource) (the resx anchor for the injected localizer). Externals: `Microsoft.AspNetCore.Components` (`[Inject]`, `NavigationManager`, `LocationChangedEventArgs`, `OnAfterRenderAsync`, `InvokeAsync`, `StateHasChanged`), `Microsoft.Extensions.Options` (`IOptions<T>`), `Microsoft.Extensions.Localization` (`IStringLocalizer<T>`), BCL `TimeProvider`, `PeriodicTimer`, `CancellationTokenSource`, `IDisposable`.
- **Concept introduced, a poller slot with symmetric registration and handover.** `[Rubric §19, State Management & Data Flow]` assesses how shared UI state is coordinated. The bell is a component, so a responsive layout can legitimately render it twice at once (desktop app bar and mobile drawer). Without coordination each copy would start its own timer and its own navigation refresh, doubling the unread-count endpoint's load for no user benefit. The design is a *slot* held by an owner object, not a bare counter: `State.TryRegisterPoller(this)` (line 56) takes the slot only when it is free or already this instance's (`NotificationState.cs:111-124`), and `State.UnregisterPoller(this)` releases it only when this instance actually holds it and then raises `OnPollerSlotFreed` (`NotificationState.cs:133-149`).
  - **Why owner identity matters here.** The class remarks (lines 22-28) name the real scenario: hosts render the bell inside `<AuthorizeView>`, which tears the children down and rebuilds them on every authentication-state change, including a routine access-token refresh. Registration is therefore strictly symmetric (every instance unregisters on dispose, whether or not it was polling, line 256), and the surviving instance claims the freed slot through `OnPollerSlotFreed` (line 53), so the circuit never ends up with a badge that nobody refreshes.
  - `[Rubric §23, Front-End Performance]` assesses avoidable network work. Two mechanisms cut it. The slot removes an entire duplicate polling stream in dual-placement layouts. And the navigation trigger is throttled by staleness rather than firing per click: `OnLocationChanged` reads only when `State.IsStale(Options.Value.NavigationRefreshMaxAge)` (line 155), because navigation is an ambient trigger, not evidence that the count moved (doc, lines 143-148). The defaults are 30 seconds for both the poll interval and the navigation max age (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/NotificationBellOptions.cs:22,29`), and both are configuration, not constants.
  - **The staleness policy has exactly three tiers, and they are deliberate.** The first read and every periodic tick are unconditional; a navigation reads only past the configured window; a real-time push calls `State.MarkStale()` first and then reads regardless (lines 171-175), because the server has just said the data changed, so the age of the number carries no information any more (doc, lines 165-169). That is the one path that must never be throttled.
  - `[Rubric §14, Testability]` assesses whether time-dependent behavior can be driven deterministically. Both the timer and the age comparison run off the injected `TimeProvider Clock` (line 37), and the `PeriodicTimer` is constructed with the `TimeProvider` overload (line 92) precisely so a test drives the loop instead of waiting out a real interval (comment, lines 90-91).
  - `[Rubric §21, Accessibility]`: the bell button carries an explicit localized `aria-label="@L["Notif.Bell.Aria"]"` in the markup (`NotificationBell.razor:10`), which is what the injected `IStringLocalizer<SharedResource> L` (line 35) is for.
  - **Fire-and-forget from a synchronous event handler.** `HandlePollerSlotFreed` (lines 98-99), `OnLocationChanged` (lines 153-159), and `HandleRefreshRequested` (lines 171-175) are all `EventHandler`-shaped, so they cannot be `async Task`. Rather than `async void` (which turns an unobserved exception into a process crash, VSTHRD100, per the comments at lines 96-97 and 149-152), they discard the task with `_ =` and rely on the callee observing its own failures.
- **Walkthrough**
  - Injected members (lines 32-37): `State`, `InboxService`, `NavigationManager`, `L`, `IOptions<NotificationBellOptions> Options`, and `TimeProvider Clock`. Fields (lines 39-42): a per-component `CancellationTokenSource _cts`, the `PeriodicTimer? _pollTimer`, and the two flags `_isActivePoller` and `_disposed`.
  - `OnAfterRenderAsync(bool firstRender)` (lines 44-60) returns immediately on subsequent renders (lines 46-49), subscribes to all three state events (lines 51-53), then tries for the slot and, on success, calls `BecomeActivePollerAsync()` (lines 56-59).
  - `BecomeActivePollerAsync` (lines 68-94) is the double-start-guarded start: it bails on `_disposed || _isActivePoller` (lines 70-73), latches `_isActivePoller`, hooks `LocationChanged` (line 76), does the unconditional first read (line 79), then **re-checks `_disposed` after that await** (lines 85-88). The comment (lines 81-84) explains what that guard prevents: `Dispose` may have run during the read, having already disposed the then-null timer and the token source, so starting the loop now would leak a `PeriodicTimer` nothing disposes and fault the discarded task on a disposed `_cts`. Only then does it create the timer from `Options.Value.PollInterval` and the injected clock (line 92) and launch `PollLoopAsync` with an explicit discard (line 93). The method doc (lines 62-67) notes it always runs on the renderer's synchronization context, which is what makes the simple `_isActivePoller` guard sufficient rather than needing an interlocked operation.
  - `TryTakeOverPollingAsync` (lines 105-121) is the handover path: it re-checks the guards and claims the slot (line 107), then marshals the actual start onto this component's renderer with `InvokeAsync(BecomeActivePollerAsync)` (line 114), because the event was raised synchronously from the disposing bell's thread (doc, lines 101-104). If that dispatch hits `ObjectDisposedException` it hands the slot straight back (lines 116-120) so another bell can claim it.
  - `PollLoopAsync` (lines 123-141) awaits `_pollTimer!.WaitForNextTickAsync(_cts.Token)` in a loop (line 127) and refreshes each tick. It catches `OperationCanceledException` (the expected disposal exit) and `ObjectDisposedException` (disposed between timer creation and the first wait, where reading `_cts.Token` throws rather than cancelling, comment lines 137-139).
  - `RefreshUnreadCountAsync` (lines 177-216) is the one place that touches the network: it bails when `_disposed` (lines 179-182), calls `InboxService.GetUnreadCountAsync(_cts.Token)` (line 186), and **returns without touching the badge when the result is a failure** (lines 187-193). That early return is load-bearing: the comment (lines 189-192) records that zeroing the badge on an unknown count is what used to erase a push increment, and that a failed read is silent by design because the bell has no surface to report it on. On success it re-checks `_disposed` and marshals `State.SetUnreadCount(unread)` plus `StateHasChanged()` back onto the renderer with `InvokeAsync` (lines 195-202). Three catch tiers follow (lines 204-215): cancellation, disposal during the async gap, and a bare `catch` for network or deserialization failures where the badge keeps its last value. That catch-all is what makes the discards above safe.
  - `HandleStateChanged` (lines 218-219) discards into `RerenderSafeAsync` (lines 221-236), which re-renders through `InvokeAsync(StateHasChanged)` and tolerates a dispose landing between the event firing and the render dispatch.
  - `NavigateToInbox` (line 238) sends the click to `NotificationRoutePaths.NotificationInbox`.
  - `Dispose(bool disposing)` (lines 240-261) sets `_disposed` first (line 247), unsubscribes all three state events and `LocationChanged` (lines 248-251), then calls `State.UnregisterPoller(this)` **unconditionally** (line 256). The comment (lines 253-255) states both halves of why that is safe: a bell that claimed the slot but was torn down before it started polling still frees it, and a bell that never held it cannot evict the live poller, because the state object checks owner identity. It then disposes the timer and cancels and disposes the `_cts` (lines 258-260). `Dispose()` (lines 263-267) is the public half with `GC.SuppressFinalize`.
- **Why it's built this way**: a live unread badge is a genuinely useful affordance, but a naive implementation is a request amplifier (one timer per rendered copy, per circuit) and a fragile one under `<AuthorizeView>` churn. Owner-identity registration plus a freed-slot event keeps the affordance, removes the amplification, and survives the teardown-rebuild cycle that a plain counter would leave stuck. Making both intervals options and both clocks injected turns the polling policy into something a host can tune and a test can drive.
- **Where it's used**: contributed to the shell as an app-bar component by [NotificationUIModule](#notificationuimodule) (`NotificationUIModule.cs:23`); it reads the same [NotificationState](#notificationstate) that [NotificationInbox](#notificationinbox) writes after a mark-read, so the badge stays consistent with the inbox without either component knowing about the other.

### NotificationList

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationList.razor.cs:16` · Level 6 · class (partial, page)

- **What it is**: the code-behind for the **admin/organizer** push-notification history page, routed at `@page "/notifications"` (`NotificationList.razor:1`). It loads previously sent broadcasts and renders them in a status table, with a button onward to the compose page.
- **Depends on**: first-party: [IPushNotificationUIService](#ipushnotificationuiservice) (the send and history HTTP service), [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) (the row shape, carrying status and recipient count), [NotificationRoutePaths](#notificationroutepaths) (the route constants), [IToastService](#itoastservice), [ResultUiExtensions](#resultuiextensions) (`NotifyOnFailure`), and [SharedResource](#sharedresource). Externals: `MudBlazor` (`BreadcrumbItem`, `Icons`), `Microsoft.AspNetCore.Components` (`NavigationManager`, `[Inject]`), `Microsoft.Extensions.Localization`.
- **Concept reinforced, the same code-behind shape as [NotificationInbox](#notificationinbox).** Same `[Inject]` service set (lines 18-21), same `readonly CancellationTokenSource _cts` plus dispose pattern (lines 23, 79-98), same `IsLoading` gate (line 29), same cancellation-swallowing load (lines 67-70), same `result.NotifyOnFailure(Toast, L)` failure surface (line 64). It differs only in *what* it loads and *how much* of it.
  - `[Rubric §25, Navigation, Routing & Information Architecture]` assesses route structure and inter-page flow; navigation goes through [NotificationRoutePaths](#notificationroutepaths) constants (`NavigateToSend` targets `NotificationRoutePaths.NotificationSend`, line 77) rather than a literal URL, so a route change happens in exactly one file.
  - `[Rubric §27, Internationalization & Localization]` picks up an extra trick here: `DisplayStatus(string status)` (lines 34-38) looks up `L[$"Notif.Status.{status}"]` and falls back to the raw wire value when `localized.ResourceNotFound` (line 37). The *comparison* value stays the untranslated wire string while only the displayed chip text localizes, which keeps transport values and presentation separate and means a newly added server status renders (untranslated) instead of blanking (the comment on line 33 cites [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). This is the same pass-through-on-unknown-key discipline that [DataAnnotationsModelValidator](#dataannotationsmodelvalidator) applies to error messages.
- **Walkthrough**
  - Injected `NotificationService`, `NavigationManager`, `Toast`, `L` (lines 18-21); `Title` reads `L["Notif.List.Title"].Value` (line 25); `_breadcrumbs` (line 27) is built Home to Push Notifications in `OnInitializedAsync` (lines 43-47), with the leaf crumb `disabled: true` to mark the current page (line 46).
  - `_notifications` is an `IReadOnlyCollection<PushNotificationDTO>` initialized empty (line 31).
  - `OnInitializedAsync` (lines 40-50) builds the breadcrumbs then awaits `LoadNotificationsAsync`.
  - `LoadNotificationsAsync` (lines 52-75): calls `GetHistoryAsync(pageNumber: 1, pageSize: 50, _cts.Token)` (line 57) and copies `history.Items` into `_notifications` on success (line 60), otherwise raises the localized failure toast (line 64). This page fetches **one fixed 50-row page** and lets MudBlazor page that buffer client-side; unlike the inbox there is no server round-trip per page.
  - `NavigateToSend` (line 77) sends the "send new" button to the compose page.
  - Disposal mirrors the family: `_disposed` (line 79), `Dispose(bool)` cancelling the `_cts` (lines 81-92), `Dispose()` (lines 94-98).
- **Why it's built this way**: broadcast history is low-volume admin data, so one 50-row fetch with client-side paging is simpler and adequate, and it avoids server-side paging plumbing that would earn nothing. Keeping HTTP behind [IPushNotificationUIService](#ipushnotificationuiservice) mirrors the inbox and keeps the component a thin view. The shared `[Rubric §18, UI Architecture & Component Design]` story is told under [NotificationInbox](#notificationinbox).
- **Where it's used**: rendered at `/notifications` for organizer and admin roles (the nav entry from [NotificationUIModule](#notificationuimodule) is gated on [RoleNames](group-08-auth.md#rolenames)`.Organizer`); it links onward to [NotificationSend](#notificationsend).
- **Caveats / not-in-source**: the 50-row ceiling is a client-side choice in this file; what the server does when more than 50 broadcasts exist (whether the page silently truncates the history) is not visible here.

### NotificationSend

> MMCA.Common.UI · `MMCA.Common.UI.Pages.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationSend.razor.cs:19` · Level 6 · class (partial, page)

- **What it is**: the code-behind for the compose-and-broadcast form, routed at `@page "/notifications/send"` (`NotificationSend.razor:1`). It collects a title and a message into [NotificationSendModel](#notificationsendmodel), validates them against that model's own annotations, sends one broadcast through the Notification API, reports the recipient count, and returns to the history page.
- **Depends on**: first-party: [IPushNotificationUIService](#ipushnotificationuiservice) (the `SendAsync` call), [NotificationSendModel](#notificationsendmodel) (the form model), [ModelValidation](#modelvalidation) + [DataAnnotationsModelValidator](#dataannotationsmodelvalidator) (the validation bridge), [INotificationScopeProvider](#inotificationscopeprovider) (the targeting caption), [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) (the wire contract), [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) (the result carrying `RecipientCount`), [Result](group-01-result-error-handling.md#result), [NotificationRoutePaths](#notificationroutepaths), [ErrorMessages](#errormessages), [IToastService](#itoastservice), [ResultUiExtensions](#resultuiextensions), and [SharedResource](#sharedresource). Externals: `MudBlazor` (`MudForm`, `BreadcrumbItem`, `Icons`), `Microsoft.AspNetCore.Components` (`NavigationManager`, `OnInitialized`, `OnInitializedAsync`), `Microsoft.Extensions.Localization`.
- **Concept introduced, `MudForm` validation driven entirely by the model.** This is the family's *form* page, and it is the worked example of the validation stack in this unit. The markup declares `<MudForm @ref="_form" Model="_model">` with two fields that set `For`, `Validation="@_validate"`, and read their affordances off the same model (`NotificationSend.razor:43-66`). **No rule is declared in markup**: the comment above the form (lines 38-42 of the markup) spells out the division, `Required` drives the asterisk and `aria-required` while its message still comes from the model, `MaxLength` caps the input, and `Counter` shows the budget from the shared request contract so the numbers cannot drift from the server. The C# holds the form by reference (`MudForm? _form`, line 36) and explicitly drives validation before sending: `await _form.ValidateAsync()` then a guard on `_form.IsValid` (lines 98-105). MudForm has no `OnValidSubmit`, so that explicit pass is the gate (comment, lines 96-97).
  - `[Rubric §24, Forms, Validation & UX Safety]` assesses input validation, double-submit protection, and feedback. All four are present: model-declared rules run through the shared delegate, an `IsSaving` flag (line 33) bound to `Disabled` on both buttons (`NotificationSend.razor:73,80`) so the send cannot be fired twice, a warning toast `ErrorMessages.ValidationError` on a failed gate (line 103), and a success toast naming the recipient count (line 116).
  - **Two failure surfaces, deliberately not one.** `_sendResult` (line 42) holds the last attempt's outcome and is rendered inline by the shared `ErrorSummary` component (`NotificationSend.razor:36`), while the toast stays the transient cue. The markup comment (lines 31-35) records the design constraint: the summary is deliberately *not* fed `MudForm.Errors`, because every field already renders its own message inline and MudBlazor contributes a generic "Required" of its own that would stack on top of the model's wording. `_sendResult` is nulled at the start of every attempt (line 94), so the summary never shows a stale failure.
  - `[Rubric §21, Accessibility]` and `[Rubric §18, UI Architecture & Component Design]` meet in the `ErrorSummary`: a failure that only appeared as a toast would time out on a long form and be unrecoverable for a screen-reader user who missed it (comment, lines 121-122).
  - `[Rubric §27, Internationalization & Localization]`: every string resolves through `IStringLocalizer<SharedResource> L` (line 24), including the success message `L["Notif.Send.SentTo", sent.RecipientCount]` (line 116), which passes the count as a **format argument** so pluralization and word order stay in the resource file rather than being concatenated in C#. As with its siblings the breadcrumb trail is built in an initialization hook, here the synchronous `OnInitialized` (lines 55-67, comment citing [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Walkthrough**
  - Injected `NotificationService`, `NavigationManager`, `Toast`, `L`, and `ScopeProvider` (lines 21-25); `_cts` (line 27); `Title` (line 29); `_breadcrumbs` (line 31) built Home to Push Notifications to Send (lines 58-63), where the middle crumb is a real link via `NotificationRoutePaths.Notifications` (line 61) and the leaf is `disabled: true` (line 62).
  - `_model` (line 35) is a `readonly NotificationSendModel` created with the component; `_validate` (line 46) is the single `Func<object, string, IEnumerable<string>>` MudBlazor calls with `(model, member path)`, wired in `OnInitialized` as `ModelValidation.For(_model, new DataAnnotationsModelValidator(L))` (line 66). One delegate serves both fields, and no rule is written twice (comment, lines 44-45).
  - `OnInitializedAsync` (lines 69-87) resolves the optional scope caption: `ScopeProvider.GetCurrentScopeDisplayNameAsync(_cts.Token)` (line 77), and only when the name is non-blank does it build `_scopeCaption` (lines 78-81). The field doc (lines 48-53) and the async doc (lines 71-74) give the reasoning: a scoped application applies its scope to the send automatically, so without a caption the operator would be composing a broadcast with no visible statement of who receives it, and when there is no scope the page renders no caption at all rather than an empty line. `[Rubric §24, Forms, Validation & UX Safety]` again: making an implicit targeting decision visible is part of a safe destructive-ish action.
  - `SendNotificationAsync` (lines 89-134): null-guards `_form` (lines 91-92), clears `_sendResult` (line 94), validates and warns on failure (lines 98-105); then under `IsSaving` builds `new SendPushNotificationRequest(_model.Title, _model.Body)` (line 110) and awaits `SendAsync(request, _cts.Token)` (line 111), storing the result for the summary (line 112). On a non-null [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) it raises the success toast with `sent.RecipientCount` (line 116) and navigates back to the list (line 117); otherwise `result.NotifyOnFailure(Toast, L)` (line 123). The cancellation catch (lines 126-129) additionally names the `InteractiveAuto` render-mode transition, the case where the WebAssembly runtime takes over mid-call; `IsSaving` is cleared in `finally` (lines 130-133).
  - `NavigateToList` (line 136) is the Cancel button's handler, back to `NotificationRoutePaths.Notifications`.
  - Disposal mirrors the family: `_disposed` (line 138), `Dispose(bool)` (lines 140-151), `Dispose()` (lines 153-157).
- **Why it's built this way**: a deliberately small form that still demonstrates the full pattern. There is no unsaved-changes guard because the page is create-only and one-shot; the rules live on [NotificationSendModel](#notificationsendmodel) so the client cap, the client message, and the server invariant all read the same constants; and HTTP stays behind [IPushNotificationUIService](#ipushnotificationuiservice) so the component is unit-testable. The send is fire-and-confirm: the server fans out to recipients through the push pipeline (see [Group 10](group-10-notifications.md)) and returns only the aggregate count.
- **Where it's used**: rendered at `/notifications/send` for organizer and admin roles, reached from the button on [NotificationList](#notificationlist). The server-side validator for [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) enforces the same rules a second time, so client validation is a UX affordance rather than the security boundary.

### NotificationUIModule

> MMCA.Common.UI · `MMCA.Common.UI.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs:15` · Level 7 · class (sealed)

- **What it is**: the notification feature's [IUIModule](#iuimodule) descriptor. It declares the two nav entries (user inbox, admin push notifications), the app-bar component, the layout component, and the assembly to scan for routable pages.
- **Depends on**: first-party: [IUIModule](#iuimodule) (the contract, line 15), [NavItem](#navitem) and [NavSection](#navsection) (the nav item shape and its placement enum), [NotificationRoutePaths](#notificationroutepaths) (the two routes), [SharedResource](#sharedresource) (the resx type each nav label resolves against), [RoleNames](group-08-auth.md#rolenames) (the `Organizer` gate), plus the [NotificationBell](#notificationbell) and `NotificationListener` components in the same package (lines 23, 25). Externals: `MudBlazor` (`Icons.Material.Filled.*`), `System.Reflection` (`Assembly`).
- **Concept introduced, the UI module pattern (the client-side counterpart to [IModule](group-14-module-system-composition.md#imodule)).** `[Rubric §25, Navigation, Routing & Information Architecture]` assesses how navigation is composed and how routes are discovered. Server modules declare their registrations and dependencies through `IModule`; UI features do the same for the shell. Nothing here calls into a layout: the module *declares* nav items and component types as data, and the host discovers every registered [IUIModule](#iuimodule) and assembles the menu, app bar, and layout from those declarations. Adding a feature therefore never edits a shared `MainLayout.razor` or a central menu file.
  - `[Rubric §18, UI Architecture & Component Design]` applies to the two component collections: `AppBarComponentTypes` and `LayoutComponentTypes` are `Type` handles, so the shell renders them dynamically without a compile-time reference to the feature.
  - `[Rubric §11, Security]` applies to the role gate: the admin entry carries `RoleNames.Organizer` (line 20) on the nav item itself, so the authorization fact lives next to the thing it protects rather than in a layout `if`.
  - `[Rubric §27, Internationalization & Localization]`: the nav labels are **resource keys plus a resource type**, `"Nav.NotificationInbox"` and `"Nav.PushNotifications"` with `typeof(SharedResource)` (lines 19-20), not literal English. A descriptor is a singleton built once at startup, so it cannot hold a localized string; carrying the key and the resx anchor instead is what lets the shell resolve the label per circuit under the active culture.
- **Walkthrough**
  - `NavItems` (lines 17-21) is an immutable `IReadOnlyList<NavItem>` with two entries: the inbox key `Nav.NotificationInbox` to `NotificationRoutePaths.NotificationInbox` with the `Inbox` icon in `NavSection.User` (line 19, no role, so any authenticated user sees it), and `Nav.PushNotifications` to `NotificationRoutePaths.Notifications` with the `NotificationsActive` icon, gated on `RoleNames.Organizer`, in `NavSection.Admin` and grouped under `"Notifications"` (line 20).
  - `AppBarComponentTypes` (line 23) is `[typeof(NotificationBell)]`, the badge the shell injects into the top bar.
  - `LayoutComponentTypes` (line 25) is `[typeof(NotificationListener)]`, mounted once per layout so the SignalR callback wiring has exactly one owner.
  - `Assembly` (line 27) returns `typeof(NotificationUIModule).Assembly`, which the host adds to the Blazor router's additional assemblies so the pages in this package become routable in the consumer app.
- **Why it's built this way**: expressing contributions as data (collections of records and `Type`s) keeps the shell open for extension and closed for modification, and it is what allows a package to ship a complete feature (routes, nav, app-bar widget, background listener) that a host enables with one DI call. The class is `sealed` and every member is a get-only auto-property initialized inline, so the descriptor is safely shared as a singleton.
- **Where it's used**: registered as a singleton [IUIModule](#iuimodule) by `AddNotificationUI()` in the notifications [DependencyInjection](#dependencyinjection) (`Notifications/DependencyInjection.cs:39`); enumerated by the host shell at startup to build navigation and to discover this package's routable components.

### DependencyInjection

> MMCA.Common.UI · `MMCA.Common.UI.Notifications` · `MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/DependencyInjection.cs:12` · Level 8 · class (static)

- **What it is**: the notification-UI registration entry point, a single `AddNotificationUI()` extension on `IServiceCollection` that wires the two typed HTTP services, the shared per-circuit state, the SignalR client, the scope provider, and the [IUIModule](#iuimodule) descriptor.
- **Depends on**: first-party: [INotificationScopeProvider](#inotificationscopeprovider) + [NullNotificationScopeProvider](#nullnotificationscopeprovider), [IPushNotificationUIService](#ipushnotificationuiservice) + [PushNotificationService](#pushnotificationservice), [INotificationInboxUIService](#inotificationinboxuiservice) + [NotificationInboxService](#notificationinboxservice), [NotificationState](#notificationstate), [NotificationHubService](#notificationhubservice), and [IUIModule](#iuimodule) + [NotificationUIModule](#notificationuimodule). Externals: `Microsoft.Extensions.DependencyInjection` (`IServiceCollection`, `AddScoped`, `AddSingleton`) and `Microsoft.Extensions.DependencyInjection.Extensions` (`TryAddScoped`).
- **Concept**: the C# `extension(IServiceCollection services)` registration idiom used package-wide (see [primer](00-primer.md#c-extensiont-types-read-this-once)); the block opens at line 14 and the method inside it is an ordinary extension method in the new form. Note this is one of several `DependencyInjection` classes in the UI packages: this one is specifically the **Notifications** registrar, the sibling of the `MMCA.Common.UI.Web` host registrar above.
  - `[Rubric §33, Developer Experience & Inner Loop]` assesses how much a consumer must know to switch a feature on; the answer here is one call.
  - `[Rubric §3, Clean Architecture]` assesses where composition lives; the feature owns its own DI, so nothing about notifications leaks into a host's `Program.cs` beyond the single line.
  - **`TryAdd` versus `Add` is a deliberate signal.** The scope provider is registered with `TryAddScoped` (line 24) precisely so an app that registers its own [INotificationScopeProvider](#inotificationscopeprovider) wins regardless of the order the two registration calls run in (the comment on lines 22-23 says so); everything else uses plain `AddScoped`/`AddSingleton` because this package owns those contracts.
- **Walkthrough**: inside the extension block (line 14), `AddNotificationUI()` (line 20) registers, in order, [INotificationScopeProvider](#inotificationscopeprovider) to [NullNotificationScopeProvider](#nullnotificationscopeprovider) via `TryAddScoped` (line 24, the default no-op scope consumed by both HTTP services and read for the caption on [NotificationSend](#notificationsend)), [IPushNotificationUIService](#ipushnotificationuiservice) to [PushNotificationService](#pushnotificationservice) (scoped, line 27), [INotificationInboxUIService](#inotificationinboxuiservice) to [NotificationInboxService](#notificationinboxservice) (scoped, line 30), [NotificationState](#notificationstate) as a concrete scoped type (line 33, one unread-count owner per Blazor circuit), [NotificationHubService](#notificationhubservice) (scoped SignalR client, line 36), and finally [NotificationUIModule](#notificationuimodule) as a **singleton** [IUIModule](#iuimodule) (line 39), because the descriptor is immutable shell metadata rather than per-circuit state. It returns `services` for chaining (line 41).
- **Why it's built this way**: the scoped-versus-singleton split is the load-bearing part. HTTP services, state, and the hub connection are per-circuit (a Blazor circuit is a DI scope, and the unread count belongs to one user's session), while the nav and shell descriptor is process-wide and immutable. Bundling all six behind one extension keeps host startup honest and makes the feature's dependency surface reviewable in one screen.
- **Where it's used**: called from the `Program.cs` of each consuming host (Blazor Web and MAUI) that opts into the notification UI; it complements the main `MMCA.Common.UI` registration rather than replacing it.
- **Caveats / not-in-source**: this method does not register [NotificationBellOptions](#notificationbelloptions). The bell injects `IOptions<NotificationBellOptions>` (`NotificationBell.razor.cs:36`) and the options type supplies its own defaults (`NotificationBellOptions.cs:22,29`), so the unconfigured case works, but where a host binds the `NotificationBell` configuration section is not visible from this file.


---
[⬅ Module System, Composition & Configuration](group-14-module-system-composition.md)  •  [Index](00-index.md)  •  [Aspire Orchestration & Service Defaults ➡](group-16-aspire-orchestration.md)
